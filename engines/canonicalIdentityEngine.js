'use strict';

const SCHEMA_VERSION = '1.0.0';
const ENGINE_VERSION = 'canonical-identity-engine-v1';

const UNKNOWN = 'unknown';

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeText(value, fallback = UNKNOWN) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s/.'-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized || fallback;
}

function normalizeTitle(value) {
  return normalizeText(value, '').replace(/\s+/g, ' ').trim();
}

function stableToken(value, fallback = UNKNOWN) {
  return String(value ?? fallback)
    .toLowerCase()
    .replace(/[^a-z0-9/.-]+/g, '-')
    .replace(/^-+|-+$/g, '') || fallback;
}

function hasKnown(value) {
  return value !== undefined && value !== null && value !== '' && value !== UNKNOWN;
}

function booleanOrUnknown(value) {
  if (typeof value === 'boolean') return value;
  if (value === UNKNOWN) return UNKNOWN;
  if (value === undefined || value === null || value === '') return UNKNOWN;

  const normalized = normalizeText(value, '');
  if (['true', 'yes', 'y', '1'].includes(normalized)) return true;
  if (['false', 'no', 'n', '0'].includes(normalized)) return false;
  return UNKNOWN;
}

function nullableText(value) {
  if (value === undefined || value === null || value === '') return null;
  const normalized = normalizeText(value, '');
  return normalized || null;
}

function canonicalValue(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

function getPath(source = {}, path) {
  return path.split('.').reduce((current, part) => {
    if (!current || typeof current !== 'object') return undefined;
    return current[part];
  }, source);
}

function firstPath(sources = [], paths = []) {
  for (const source of sources) {
    for (const path of paths) {
      const value = getPath(source, path);
      if (value !== undefined && value !== null && value !== '') return value;
    }
  }
  return undefined;
}

function setSource(metadata, path, source, rawValue, confidence) {
  metadata.rawExtractedValues[path] = rawValue === undefined ? null : rawValue;
  metadata.sourceFields[path] = source;
  metadata.fieldConfidence[path] = confidence;
}

function addUnknown(metadata, path) {
  if (!metadata.unknownFields.includes(path)) metadata.unknownFields.push(path);
}

function assignText(metadata, normalized, path, sources, sourceName, confidence, fallback = UNKNOWN) {
  const value = firstPath(sources, path.aliases);
  const normalizedValue = path.nullable ? nullableText(value) : normalizeText(value, fallback);
  normalized[path.key] = normalizedValue;

  if (path.nullable && normalizedValue === null) return;

  if (hasKnown(normalizedValue)) {
    setSource(metadata, `normalized.${path.key}`, sourceName, value, confidence);
  } else {
    setSource(metadata, `normalized.${path.key}`, UNKNOWN, value, 0);
    addUnknown(metadata, `normalized.${path.key}`);
  }
}

function assignNestedText(metadata, parent, path, value, sourceName, confidence, unknownPath) {
  const normalizedValue = path.nullable ? nullableText(value) : normalizeText(value, UNKNOWN);
  parent[path.key] = normalizedValue;

  if (path.nullable && normalizedValue === null) return;

  if (hasKnown(normalizedValue)) {
    setSource(metadata, unknownPath, sourceName, value, confidence);
  } else {
    setSource(metadata, unknownPath, UNKNOWN, value, 0);
    addUnknown(metadata, unknownPath);
  }
}

function assignBoolean(metadata, target, key, value, sourceName, confidence, unknownPath) {
  const normalizedValue = booleanOrUnknown(value);
  target[key] = normalizedValue;

  if (normalizedValue === UNKNOWN) {
    setSource(metadata, unknownPath, UNKNOWN, value, 0);
    addUnknown(metadata, unknownPath);
  } else {
    setSource(metadata, unknownPath, sourceName, value, confidence);
  }
}

function assignMaybeNumber(metadata, target, key, value, sourceName, confidence, unknownPath, options = {}) {
  if (value === undefined || value === null || value === '' || value === UNKNOWN) {
    target[key] = null;
    if (options.optional) return;
    setSource(metadata, unknownPath, UNKNOWN, value, 0);
    addUnknown(metadata, unknownPath);
    return;
  }

  const number = Number(value);
  target[key] = Number.isFinite(number) ? number : value;
  setSource(metadata, unknownPath, sourceName, value, confidence);
}

function normalizeIdentityType(value, normalized = {}) {
  const explicit = normalizeText(value, '');
  if (explicit === 'sports_card' || explicit === 'tcg_card') return explicit;
  if (normalized.game || normalized.cardName || normalized.collectorNumber) return 'tcg_card';
  if (normalized.sport || normalized.subject?.name || normalized.player || normalized.cardNumber) return 'sports_card';
  return UNKNOWN;
}

function normalizeCategory(value, identityType) {
  const explicit = normalizeText(value, '');
  if (explicit) return explicit;
  if (identityType === 'sports_card') return 'sports_card';
  if (identityType === 'tcg_card') return 'tcg_card';
  return UNKNOWN;
}

function normalizeMarketSegment(value, identityType) {
  const explicit = normalizeText(value, '');
  if (explicit) return explicit;
  if (identityType === 'sports_card') return 'sports';
  if (identityType === 'tcg_card') return 'tcg';
  return UNKNOWN;
}

function getSportsAutographPart(normalized = {}) {
  const autograph = asObject(normalized.autograph);
  if (autograph.state !== true) return 'non-auto';
  return stableToken(autograph.type && autograph.type.includes('patch') ? 'patch-auto' : 'auto');
}

function getSportsMemorabiliaPart(normalized = {}) {
  return asObject(normalized.memorabilia).state === true ? 'memorabilia' : 'non-mem';
}

function getSportsSerialPart(normalized = {}) {
  if (normalized.serialNumbered === true) return `numbered-${stableToken(normalized.printRun)}`;
  if (normalized.serialNumbered === false) return 'unnumbered';
  return 'unknown-numbering';
}

function buildSportsIdentityKey(identity = {}) {
  const normalized = asObject(identity.normalized);
  const grading = asObject(normalized.grading);
  const subject = asObject(normalized.subject).name || 'unknown-subject';
  const year = hasKnown(normalized.year) ? normalized.year : 'unknown-year';
  const number = hasKnown(normalized.cardNumber) ? normalized.cardNumber : 'unknown-number';
  const parallel = hasKnown(normalized.imageVariation)
    ? normalized.imageVariation
    : hasKnown(normalized.variation)
      ? normalized.variation
      : hasKnown(normalized.parallel)
        ? normalized.parallel
        : 'unknown-parallel';

  return [
    'ci:v1:sports',
    normalized.sport,
    year,
    normalized.manufacturer,
    normalized.product || normalized.setName,
    subject,
    number,
    parallel,
    getSportsAutographPart(normalized),
    getSportsMemorabiliaPart(normalized),
    getSportsSerialPart(normalized),
    normalized.rawOrGraded,
    `${grading.company || UNKNOWN}-${grading.grade || UNKNOWN}`
  ].map((part, index) => index === 0 ? part : stableToken(part)).join(':');
}

function getTcgIdentityPart(normalized = {}) {
  if (hasKnown(normalized.collectorNumber)) return normalized.collectorNumber;
  if (normalized.serialized === true && normalized.serialNumber && normalized.printRun) return `${normalized.serialNumber}/${normalized.printRun}`;
  return 'unknown-number';
}

function getTcgFinishPart(normalized = {}) {
  if (hasKnown(normalized.artVariant)) return normalized.artVariant;
  if (hasKnown(normalized.finishTreatment)) return normalized.finishTreatment;
  if (hasKnown(normalized.rarity)) return normalized.rarity;
  return 'unknown-finish';
}

function buildTcgIdentityKey(identity = {}) {
  const normalized = asObject(identity.normalized);
  const grading = asObject(normalized.grading);
  return [
    'ci:v1:tcg',
    normalized.game,
    normalized.setName,
    normalized.cardName,
    getTcgIdentityPart(normalized),
    getTcgFinishPart(normalized),
    normalized.language,
    normalized.rawOrGraded,
    `${grading.company || UNKNOWN}-${grading.grade || UNKNOWN}`
  ].map((part, index) => index === 0 ? part : stableToken(part)).join(':');
}

function buildCanonicalIdentityKey(identity = {}) {
  if (identity.identityType === 'sports_card') return buildSportsIdentityKey(identity);
  if (identity.identityType === 'tcg_card') return buildTcgIdentityKey(identity);
  return 'ci:v1:unknown:unknown';
}

function createMetadata() {
  return {
    rawExtractedValues: {},
    sourceFields: {},
    fieldConfidence: {},
    unknownFields: [],
    normalizationWarnings: []
  };
}

function collectInput(input = {}) {
  const listing = asObject(input.listing || input.listingMetadata);
  const marketplace = asObject(input.marketplace || input.marketplaceMetadata);
  const legacyParsed = asObject(input.legacyParsed || input.parsed || listing.parsed);
  const canonicalSoldEvidenceIdentity = asObject(
    input.canonicalSoldEvidenceIdentity ||
    input.soldEvidenceIdentity ||
    listing.canonicalIdentity ||
    listing.parsedIdentity
  );
  const structuredIdentity = asObject(input.identity || input.parsedIdentity || listing.identity);
  const normalizedIdentity = asObject(canonicalSoldEvidenceIdentity.normalized || canonicalSoldEvidenceIdentity);
  const fallbackIdentity = Object.keys(normalizedIdentity).length
    ? normalizedIdentity
    : asObject(structuredIdentity.normalized || structuredIdentity);

  return {
    listing,
    marketplace,
    legacyParsed,
    structuredIdentity,
    canonicalSoldEvidenceIdentity,
    normalizedIdentity: fallbackIdentity,
    title: input.rawTitle || listing.rawTitle || listing.title || canonicalSoldEvidenceIdentity.raw?.title || ''
  };
}

function buildSportsNormalized(collected, metadata, sourceName, confidence) {
  const sources = [collected.normalizedIdentity, collected.legacyParsed, collected.listing, collected.marketplace];
  const normalized = {};

  assignText(metadata, normalized, { key: 'sport', aliases: ['sport', 'leagueSport', 'category'] }, sources, sourceName, confidence);
  assignText(metadata, normalized, { key: 'league', aliases: ['league'] }, sources, sourceName, confidence);
  assignText(metadata, normalized, { key: 'team', aliases: ['team'] }, sources, sourceName, confidence);
  normalized.subject = { name: UNKNOWN, aliases: [] };
  assignNestedText(metadata, normalized.subject, { key: 'name' }, firstPath(sources, ['subject.name', 'player', 'subject', 'playerName', 'character', 'name']), sourceName, confidence, 'normalized.subject.name');
  normalized.subject.aliases = asArray(firstPath(sources, ['subject.aliases', 'aliases', 'playerAliases'])).map((value) => normalizeText(value)).filter(hasKnown);

  assignText(metadata, normalized, { key: 'year', aliases: ['year', 'season'] }, sources, sourceName, confidence);
  assignText(metadata, normalized, { key: 'manufacturer', aliases: ['manufacturer', 'brand'] }, sources, sourceName, confidence);
  assignText(metadata, normalized, { key: 'brand', aliases: ['brand', 'manufacturer'] }, sources, sourceName, confidence);
  assignText(metadata, normalized, { key: 'product', aliases: ['product', 'productName', 'setName', 'set'] }, sources, sourceName, confidence);
  assignText(metadata, normalized, { key: 'setName', aliases: ['setName', 'set', 'cardSet', 'product'] }, sources, sourceName, confidence);
  assignText(metadata, normalized, { key: 'subset', aliases: ['subset'], nullable: true }, sources, sourceName, confidence, null);
  assignText(metadata, normalized, { key: 'insertSet', aliases: ['insertSet', 'insert'], nullable: true }, sources, sourceName, confidence, null);
  assignText(metadata, normalized, { key: 'cardNumber', aliases: ['cardNumber', 'cardNo', 'number', 'collectorNumber'] }, sources, sourceName, confidence);
  assignText(metadata, normalized, { key: 'parallel', aliases: ['parallel', 'color', 'variation'] }, sources, sourceName, confidence);
  assignText(metadata, normalized, { key: 'variation', aliases: ['variation'], nullable: true }, sources, sourceName, confidence, null);
  assignText(metadata, normalized, { key: 'imageVariation', aliases: ['imageVariation'], nullable: true }, sources, sourceName, confidence, null);

  const rookie = canonicalValue(firstPath(sources, ['rookieDesignation']), firstPath(sources, ['rookie', 'isRookie']), collected.legacyParsed.flags?.rookie);
  normalized.rookieDesignation = rookie === undefined ? UNKNOWN : booleanOrUnknown(rookie);
  setSource(metadata, 'normalized.rookieDesignation', rookie === undefined ? UNKNOWN : sourceName, rookie, rookie === undefined ? 0 : confidence);
  if (normalized.rookieDesignation === UNKNOWN) addUnknown(metadata, 'normalized.rookieDesignation');

  normalized.autograph = { state: UNKNOWN, type: null };
  assignBoolean(metadata, normalized.autograph, 'state', canonicalValue(firstPath(sources, ['autograph.state']), firstPath(sources, ['autograph', 'auto', 'isAutograph']), collected.legacyParsed.flags?.autograph), sourceName, confidence, 'normalized.autograph.state');
  normalized.autograph.type = nullableText(firstPath(sources, ['autograph.type', 'autographType']));

  normalized.memorabilia = { state: UNKNOWN, type: null };
  assignBoolean(metadata, normalized.memorabilia, 'state', canonicalValue(firstPath(sources, ['memorabilia.state']), firstPath(sources, ['memorabilia', 'relic', 'patch', 'isRelic'])), sourceName, confidence, 'normalized.memorabilia.state');
  normalized.memorabilia.type = nullableText(firstPath(sources, ['memorabilia.type', 'memorabiliaType', 'relicType', 'patchType']));

  assignBoolean(metadata, normalized, 'serialNumbered', canonicalValue(firstPath(sources, ['serialNumbered', 'numbered', 'isNumbered']), collected.legacyParsed.flags?.numbered), sourceName, confidence, 'normalized.serialNumbered');
  assignText(metadata, normalized, { key: 'serialNumber', aliases: ['serialNumber'], nullable: true }, sources, sourceName, confidence, null);
  assignMaybeNumber(
    metadata,
    normalized,
    'printRun',
    firstPath(sources, ['printRun', 'numberedTo', 'serialPrintRun']),
    sourceName,
    confidence,
    'normalized.printRun',
    { optional: normalized.serialNumbered !== true }
  );

  assignText(metadata, normalized, { key: 'rawOrGraded', aliases: ['rawOrGraded', 'conditionState'] }, sources, sourceName, confidence);
  if (normalized.rawOrGraded === UNKNOWN) {
    const gradeCompany = firstPath(sources, ['grading.company', 'gradeCompany', 'grader', 'gradingCompany']);
    normalized.rawOrGraded = hasKnown(gradeCompany) && normalizeText(gradeCompany) !== 'raw' ? 'graded' : UNKNOWN;
  }
  assignText(metadata, normalized, { key: 'rawCondition', aliases: ['rawCondition', 'condition'], nullable: true }, sources, sourceName, confidence, null);
  normalized.grading = {
    company: normalizeText(firstPath(sources, ['grading.company', 'gradeCompany', 'grader', 'gradingCompany']), UNKNOWN),
    grade: normalizeText(firstPath(sources, ['grading.grade', 'grade', 'conditionGrade']), UNKNOWN),
    certificationNumber: normalizeText(firstPath(sources, ['grading.certificationNumber', 'certificationNumber', 'certNumber', 'cert']), UNKNOWN)
  };

  for (const [key, value] of Object.entries(normalized.grading)) {
    const path = `normalized.grading.${key}`;
    if (normalized.rawOrGraded === 'raw' && key === 'grade' && !hasKnown(value)) continue;
    if (key === 'certificationNumber' && !hasKnown(value)) continue;
    setSource(metadata, path, hasKnown(value) ? sourceName : UNKNOWN, value, hasKnown(value) ? confidence : 0);
    if (!hasKnown(value)) addUnknown(metadata, path);
  }

  return normalized;
}

function buildTcgNormalized(collected, metadata, sourceName, confidence) {
  const sources = [collected.normalizedIdentity, collected.legacyParsed, collected.listing, collected.marketplace];
  const normalized = {};

  for (const field of [
    ['game', ['game', 'tcg', 'franchise']],
    ['cardName', ['cardName', 'name', 'subject', 'character']],
    ['character', ['character', 'cardName', 'name'], true],
    ['franchise', ['franchise', 'game'], true],
    ['setName', ['setName', 'set', 'cardSet']],
    ['setCode', ['setCode', 'setId']],
    ['collectorNumber', ['collectorNumber', 'cardNumber', 'number']],
    ['rarity', ['rarity']],
    ['finishTreatment', ['finishTreatment', 'parallel', 'foilState']],
    ['foilState', ['foilState', 'foil']],
    ['artVariant', ['artVariant', 'variation'], true],
    ['language', ['language']],
    ['printing', ['printing']],
    ['releaseVariant', ['releaseVariant'], true],
    ['condition', ['condition'], true]
  ]) {
    assignText(metadata, normalized, { key: field[0], aliases: field[1], nullable: field[2] }, sources, sourceName, confidence, field[2] ? null : UNKNOWN);
  }

  assignBoolean(metadata, normalized, 'alternateArt', firstPath(sources, ['alternateArt', 'altArt']), sourceName, confidence, 'normalized.alternateArt');
  assignBoolean(metadata, normalized, 'firstEdition', firstPath(sources, ['firstEdition', 'firstEd']), sourceName, confidence, 'normalized.firstEdition');
  assignBoolean(metadata, normalized, 'serialized', firstPath(sources, ['serialized', 'serialNumbered']), sourceName, confidence, 'normalized.serialized');
  assignText(metadata, normalized, { key: 'serialNumber', aliases: ['serialNumber'], nullable: true }, sources, sourceName, confidence, null);
  assignMaybeNumber(
    metadata,
    normalized,
    'printRun',
    firstPath(sources, ['printRun', 'numberedTo', 'serialPrintRun']),
    sourceName,
    confidence,
    'normalized.printRun',
    { optional: normalized.serialized !== true }
  );
  assignText(metadata, normalized, { key: 'rawOrGraded', aliases: ['rawOrGraded', 'conditionState'] }, sources, sourceName, confidence);

  normalized.grading = {
    company: normalizeText(firstPath(sources, ['grading.company', 'gradeCompany', 'grader', 'gradingCompany']), normalized.rawOrGraded === 'raw' ? 'raw' : UNKNOWN),
    grade: normalizeText(firstPath(sources, ['grading.grade', 'grade', 'conditionGrade']), UNKNOWN),
    certificationNumber: normalizeText(firstPath(sources, ['grading.certificationNumber', 'certificationNumber', 'certNumber', 'cert']), UNKNOWN)
  };

  for (const [key, value] of Object.entries(normalized.grading)) {
    const path = `normalized.grading.${key}`;
    if (normalized.rawOrGraded === 'raw' && key === 'grade' && !hasKnown(value)) continue;
    if (key === 'certificationNumber' && !hasKnown(value)) continue;
    setSource(metadata, path, hasKnown(value) ? sourceName : UNKNOWN, value, hasKnown(value) ? confidence : 0);
    if (!hasKnown(value)) addUnknown(metadata, path);
  }

  return normalized;
}

function getSourceProfile(collected = {}) {
  if (Object.keys(collected.canonicalSoldEvidenceIdentity).length) {
    return { sourceName: 'canonical_sold_evidence_identity', confidence: 0.96 };
  }
  if (Object.keys(collected.structuredIdentity).length) {
    return { sourceName: 'structured_identity_metadata', confidence: 0.84 };
  }
  if (Object.keys(collected.legacyParsed).length) {
    return { sourceName: 'legacy_parsed_output', confidence: 0.72 };
  }
  if (Object.keys(collected.listing).length) {
    return { sourceName: 'listing_metadata', confidence: 0.62 };
  }
  return { sourceName: UNKNOWN, confidence: 0 };
}

function determineIdentityType(inputType, normalized) {
  return normalizeIdentityType(inputType, normalized);
}

function hasBlockingWarning(identity) {
  return asArray(identity.normalizationWarnings).some((warning) =>
    /missing|malformed|ambiguous|unknown_but/.test(warning)
  );
}

function computeExactCompEligible(identity) {
  const normalized = identity.normalized;
  if (identity.identityType === 'sports_card') {
    return Boolean(
      hasKnown(normalized.sport) &&
      hasKnown(normalized.subject?.name) &&
      hasKnown(normalized.year) &&
      hasKnown(normalized.setName) &&
      hasKnown(normalized.cardNumber) &&
      hasKnown(normalized.parallel) &&
      normalized.autograph?.state !== UNKNOWN &&
      normalized.memorabilia?.state !== UNKNOWN &&
      normalized.serialNumbered !== UNKNOWN &&
      hasKnown(normalized.rawOrGraded) &&
      identity.overallIdentityConfidence >= 0.9 &&
      !hasBlockingWarning(identity)
    );
  }

  if (identity.identityType === 'tcg_card') {
    return Boolean(
      hasKnown(normalized.game) &&
      hasKnown(normalized.cardName) &&
      hasKnown(normalized.setName) &&
      hasKnown(normalized.collectorNumber) &&
      hasKnown(normalized.finishTreatment) &&
      hasKnown(normalized.language) &&
      hasKnown(normalized.rawOrGraded) &&
      identity.overallIdentityConfidence >= 0.9 &&
      !hasBlockingWarning(identity)
    );
  }

  return false;
}

function computeValuationEligible(identity) {
  if (!computeExactCompEligible(identity)) return false;
  const normalized = identity.normalized;
  if (identity.identityType === 'sports_card') {
    return Boolean(
      normalized.autograph?.state !== UNKNOWN &&
      normalized.memorabilia?.state !== UNKNOWN &&
      normalized.serialNumbered !== UNKNOWN &&
      hasKnown(normalized.rawOrGraded) &&
      hasKnown(normalized.parallel)
    );
  }

  if (identity.identityType === 'tcg_card') {
    return Boolean(
      hasKnown(normalized.game) &&
      hasKnown(normalized.rarity) &&
      hasKnown(normalized.finishTreatment) &&
      hasKnown(normalized.language) &&
      (hasKnown(normalized.condition) || hasKnown(normalized.grading?.company))
    );
  }

  return false;
}

function scoreOverallIdentityConfidence(metadata = {}) {
  const values = Object.values(metadata.fieldConfidence)
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > 0);
  if (!values.length) return 0;
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  const unknownPenalty = Math.min(0.35, metadata.unknownFields.length * 0.015);
  const warningPenalty = Math.min(0.25, metadata.normalizationWarnings.length * 0.04);
  return Math.max(0, Math.min(1, Number((average - unknownPenalty - warningPenalty).toFixed(2))));
}

function addWarnings(identity, collected) {
  if (!identity.raw.title) identity.normalizationWarnings.push('missing_raw_title');
  if (identity.identityType === UNKNOWN) identity.normalizationWarnings.push('malformed_identity_input');
  if (identity.identityType === 'sports_card') {
    if (!hasKnown(identity.normalized.cardNumber)) identity.normalizationWarnings.push('missing_card_number');
    if (identity.normalized.serialNumbered === UNKNOWN) identity.normalizationWarnings.push('unknown_serial_numbered_state');
  }
  if (identity.identityType === 'tcg_card' && !hasKnown(identity.normalized.collectorNumber)) {
    identity.normalizationWarnings.push('missing_collector_number');
  }

  const title = normalizeText(collected.title, '');
  if (identity.identityType === 'sports_card' && /\b(rare|ssp|investment|mint)\b/.test(title)) {
    identity.normalizationWarnings.push('seller_marketing_language_ignored');
  }

  identity.normalizationWarnings = [...new Set(identity.normalizationWarnings)];
}

function buildCanonicalIdentity(input = {}) {
  const collected = collectInput(input);
  const metadata = createMetadata();
  const { sourceName, confidence } = getSourceProfile(collected);
  const candidateType = canonicalValue(
    collected.normalizedIdentity.identityType,
    collected.normalizedIdentity.category,
    input.identityType,
    input.category
  );

  let normalized = {};
  const initialType = determineIdentityType(candidateType, {
    ...collected.legacyParsed,
    ...collected.normalizedIdentity
  });
  if (initialType === 'tcg_card') normalized = buildTcgNormalized(collected, metadata, sourceName, confidence);
  else if (initialType === 'sports_card') normalized = buildSportsNormalized(collected, metadata, sourceName, confidence);

  const identityType = determineIdentityType(candidateType, normalized);
  if (identityType === UNKNOWN) {
    metadata.unknownFields.push('identityType', 'category', 'normalized');
  }

  const identity = {
    schemaVersion: SCHEMA_VERSION,
    identityType,
    category: normalizeCategory(canonicalValue(collected.normalizedIdentity.category, input.category), identityType),
    marketSegment: normalizeMarketSegment(canonicalValue(collected.normalizedIdentity.marketSegment, input.marketSegment), identityType),
    canonicalIdentityKey: '',
    raw: {
      title: String(collected.title || ''),
      source: collected.normalizedIdentity.raw?.source || input.rawSource || sourceName
    },
    normalizedTitle: normalizeTitle(collected.title),
    parserVersion: input.parserVersion || ENGINE_VERSION,
    normalized,
    rawExtractedValues: metadata.rawExtractedValues,
    sourceFields: metadata.sourceFields,
    fieldConfidence: metadata.fieldConfidence,
    overallIdentityConfidence: 0,
    unknownFields: [...new Set(metadata.unknownFields)],
    normalizationWarnings: [...new Set(metadata.normalizationWarnings)],
    eligibility: {
      exactCompEligible: false,
      valuationEligible: false,
      manualReviewRequired: true,
      contextOnly: true
    }
  };

  addWarnings(identity, collected);
  identity.overallIdentityConfidence = scoreOverallIdentityConfidence(identity);
  identity.canonicalIdentityKey = buildCanonicalIdentityKey(identity);
  identity.eligibility.exactCompEligible = computeExactCompEligible(identity);
  identity.eligibility.valuationEligible = computeValuationEligible(identity);
  identity.eligibility.manualReviewRequired = !identity.eligibility.exactCompEligible;
  identity.eligibility.contextOnly = !identity.eligibility.valuationEligible;

  return identity;
}

function normalizeCanonicalIdentity(input = {}) {
  return buildCanonicalIdentity(input);
}

function summarizeCanonicalIdentity(identity = {}) {
  if (!identity || typeof identity !== 'object') return 'Canonical identity unavailable.';
  if (identity.eligibility?.valuationEligible) return 'Canonical identity is exact-comp and valuation eligible.';
  if (identity.eligibility?.exactCompEligible) return 'Canonical identity is exact-comp eligible but not valuation eligible.';
  if (identity.eligibility?.manualReviewRequired) return 'Canonical identity requires manual review before exact comp use.';
  return 'Canonical identity is context only.';
}

module.exports = {
  SCHEMA_VERSION,
  ENGINE_VERSION,
  buildCanonicalIdentity,
  normalizeCanonicalIdentity,
  buildCanonicalIdentityKey,
  summarizeCanonicalIdentity
};
