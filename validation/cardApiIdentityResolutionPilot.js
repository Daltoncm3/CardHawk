'use strict';

const canonicalIdentityEngine = require('../engines/canonicalIdentityEngine');
const {
  EVIDENCE_TYPES,
  validateRawEvidenceRecord
} = require('../marketplaces/canonicalAcquisitionInterface');
const {
  translateCardApiSaleToRawCanonical
} = require('../marketplaces/cardApiAcquisitionAdapter');
const {
  asArray,
  asObject,
  fingerprint,
  toNumber,
  unique
} = require('./canonicalValidationCore');

const SOURCE = 'card_api_identity_resolution_pilot';
const VERSION = '0.1.0';

const RESOLUTION_CLASSIFICATIONS = Object.freeze({
  EXACT: 'EXACT',
  AMBIGUOUS: 'AMBIGUOUS',
  UNRESOLVED: 'UNRESOLVED'
});

const MATERIAL_FIELDS = Object.freeze([
  'sport',
  'subjectName',
  'year',
  'manufacturer',
  'setName',
  'cardNumber',
  'parallel',
  'autographState',
  'memorabiliaState',
  'serialNumbered',
  'rawOrGraded'
]);

const BRAND_PATTERNS = Object.freeze([
  ['Panini', /\bpanini\b/i],
  ['Topps', /\btopps\b/i],
  ['Bowman', /\bbowman\b/i],
  ['Upper Deck', /\bupper\s+deck\b/i],
  ['Fleer', /\bfleer\b/i]
]);

const PRODUCT_PATTERNS = Object.freeze([
  ['Topps Chrome', /\btopps\s+chrome\b/i],
  ['Topps Update', /\btopps\s+update\b/i],
  ['Topps Heritage', /\btopps\s+heritage\b/i],
  ['Topps', /\btopps\b/i],
  ['Bowman Chrome', /\bbowman\s+chrome\b/i],
  ['Bowman', /\bbowman\b/i],
  ['Panini Prizm', /\bpanini\s+prizm\b|\bprizm\b/i],
  ['Panini Select', /\bpanini\s+select\b|\bselect\b/i],
  ['Panini Optic', /\bpanini\s+optic\b|\boptic\b/i]
]);

const PARALLEL_PATTERNS = Object.freeze([
  ['Silver Prizm', /\bsilver\s+prizm\b/i],
  ['Refractor', /\brefractor\b/i],
  ['Gold', /\bgold\b/i],
  ['Blue', /\bblue\b/i],
  ['Red', /\bred\b/i],
  ['Green', /\bgreen\b/i],
  ['Orange', /\borange\b/i],
  ['Purple', /\bpurple\b/i],
  ['Pink', /\bpink\b/i],
  ['Sepia', /\bsepia\b/i],
  ['X-Fractor', /\bx[-\s]?fractor\b/i]
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s/#.'-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeComparable(value) {
  if (typeof value === 'boolean') return value;
  if (value === undefined || value === null || value === '' || value === 'unknown') return null;
  return normalizeText(value).replace(/^#/, '');
}

function hasKnown(value) {
  return value !== undefined && value !== null && value !== '' && value !== 'unknown';
}

function firstMatch(title, patterns) {
  const match = patterns.find(([, pattern]) => pattern.test(title));
  return match ? match[0] : null;
}

function detectSport(title = '') {
  const lower = normalizeText(title);
  if (/\bufc\b|\bmma\b/.test(lower)) return 'ufc';
  if (/\bmlb\b|\bbaseball\b|\bshohei\b|\bohtani\b/.test(lower)) return 'baseball';
  if (/\bnba\b|\bbasketball\b/.test(lower)) return 'basketball';
  if (/\bnfl\b|\bfootball\b/.test(lower)) return 'football';
  if (/\bnhl\b|\bhockey\b/.test(lower)) return 'hockey';
  if (/\bsoccer\b|\bfifa\b/.test(lower)) return 'soccer';
  return null;
}

function detectBoolean(title = '', positivePattern, negativePattern) {
  if (negativePattern.test(title)) return false;
  if (positivePattern.test(title)) return true;
  return 'unknown';
}

function parseGradeFromTitle(title = '') {
  const match = title.match(/\b(PSA|BGS|SGC|CGC)\s*([0-9](?:\.[0-9])?|10|AUTH)\b/i);
  if (!match) {
    if (/\braw\b|\bungraded\b/i.test(title)) {
      return { rawOrGraded: 'raw', company: 'raw', grade: 'unknown', certificationNumber: null };
    }
    return { rawOrGraded: 'unknown', company: 'unknown', grade: 'unknown', certificationNumber: null };
  }

  return {
    rawOrGraded: 'graded',
    company: match[1].toUpperCase(),
    grade: String(match[2]).toUpperCase(),
    certificationNumber: null
  };
}

function parseSubjectFromTitle(title = '') {
  const beforeNumber = String(title || '').split(/#\s*[A-Za-z0-9/-]+/)[0] || '';
  const cleaned = beforeNumber
    .replace(/\b(19\d{2}|20\d{2}(?:-\d{2})?)\b/gi, ' ')
    .replace(/\b(Panini|Topps|Bowman|Upper|Deck|Fleer|Chrome|Update|Heritage|Prizm|Select|Optic|UFC|MLB|NBA|NFL|NHL|Baseball|Basketball|Football|Hockey|Soccer)\b/gi, ' ')
    .replace(/\b(PSA|BGS|SGC|CGC|RC|Rookie|Auto|Autograph|Patch|Relic|Refractor|Silver|Gold|Blue|Red|Green|Orange|Purple|Pink|Sepia|Raw|Graded)\b/gi, ' ')
    .replace(/\b\d+(?:\.\d+)?\b/g, ' ')
    .replace(/[^A-Za-z\s'-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const words = cleaned.split(/\s+/).filter(Boolean);
  const genericWords = new Set(['baseball', 'basketball', 'football', 'hockey', 'soccer', 'card', 'cards', 'sale', 'raw', 'graded']);
  if (words.length && words.every((word) => genericWords.has(word.toLowerCase()))) return null;
  if (words.length < 2 || words.length > 4) return null;
  return words.join(' ');
}

function parseTitleIdentity(title = '') {
  const grade = parseGradeFromTitle(title);
  const serialMatch = title.match(/\/(\d{1,5})\b/);
  const cardNumberMatch = title.match(/#\s*([A-Za-z0-9/-]+)/);

  return {
    sport: detectSport(title),
    subjectName: parseSubjectFromTitle(title),
    year: (title.match(/\b(19\d{2}|20\d{2}(?:-\d{2})?)\b/) || [])[1] || null,
    manufacturer: firstMatch(title, BRAND_PATTERNS),
    product: firstMatch(title, PRODUCT_PATTERNS),
    setName: firstMatch(title, PRODUCT_PATTERNS),
    cardNumber: cardNumberMatch ? cardNumberMatch[1].replace(/^#/, '') : null,
    parallel: firstMatch(title, PARALLEL_PATTERNS),
    rookieDesignation: /\b(rc|rookie)\b/i.test(title) ? true : 'unknown',
    autographState: detectBoolean(title, /\b(auto|autograph|rpa)\b/i, /\b(non[-\s]?auto|no\s+auto)\b/i),
    memorabiliaState: detectBoolean(title, /\b(patch|relic|memorabilia|jersey|rpa)\b/i, /\b(non[-\s]?mem|no\s+(patch|relic|memorabilia|jersey))\b/i),
    serialNumbered: serialMatch ? true : detectBoolean(title, /\bnumbered\b/i, /\b(non[-\s]?numbered|unnumbered|not\s+numbered)\b/i),
    printRun: serialMatch ? Number(serialMatch[1]) : null,
    rawOrGraded: grade.rawOrGraded,
    gradeCompany: grade.company,
    grade: grade.grade,
    certificationNumber: grade.certificationNumber
  };
}

function getRawTitle(record = {}) {
  return record.rawTitle || record.title || record.raw?.title || '';
}

function isRawProviderSale(record = {}) {
  return Boolean(record.id && record.title && (record.sold_at || record.sale_date || record.listing_type));
}

function normalizeTransaction(record = {}) {
  if (record.source?.adapter === 'card_api_acquisition_adapter' || record.parsedIdentity || record.rawTitle) {
    return clone(record);
  }
  if (isRawProviderSale(record)) return translateCardApiSaleToRawCanonical(record);
  return clone(record);
}

function providerIdentityFromTransaction(record = {}) {
  const parsed = asObject(record.parsedIdentity);
  const providerPrintRun = parsed.printRun || null;

  return {
    sport: parsed.sport || parsed.league || null,
    subjectName: parsed.player || parsed.subject || parsed.character || null,
    year: parsed.year || null,
    manufacturer: parsed.brand || parsed.manufacturer || null,
    product: parsed.product || parsed.setName || null,
    setName: parsed.setName || parsed.product || null,
    cardNumber: parsed.cardNumber || null,
    parallel: parsed.parallel || parsed.variation || null,
    rookieDesignation: 'unknown',
    autographState: 'unknown',
    memorabiliaState: 'unknown',
    serialNumbered: providerPrintRun ? true : 'unknown',
    printRun: providerPrintRun,
    rawOrGraded: record.condition === 'graded' || hasKnown(record.gradeCompany) && record.gradeCompany !== 'unknown' ? 'graded' : 'unknown',
    gradeCompany: record.gradeCompany || 'unknown',
    grade: record.grade || 'unknown',
    certificationNumber: record.certificationNumber || null
  };
}

function chooseField(field, provider, title) {
  const providerValue = provider[field];
  const titleValue = title[field];
  const providerComparable = normalizeComparable(providerValue);
  const titleComparable = normalizeComparable(titleValue);

  if (providerComparable !== null && titleComparable !== null && providerComparable !== titleComparable) {
    return {
      value: providerValue,
      source: 'conflict_provider_preferred_for_review',
      conflict: {
        field,
        providerValue,
        titleValue,
        reason: 'provider_metadata_title_parse_conflict'
      }
    };
  }

  if (providerComparable !== null && titleComparable !== null) {
    return { value: providerValue, source: 'explicit_provider_metadata_and_title_confirmed' };
  }

  if (providerComparable !== null) return { value: providerValue, source: 'explicit_provider_metadata' };
  if (titleComparable !== null) return { value: titleValue, source: 'deterministic_title_parse' };
  return { value: 'unknown', source: 'unresolved' };
}

function resolveFields(providerIdentity = {}, titleIdentity = {}) {
  const resolved = {};
  const provenance = {};
  const conflicts = [];
  const fields = [
    'sport',
    'subjectName',
    'year',
    'manufacturer',
    'product',
    'setName',
    'cardNumber',
    'parallel',
    'rookieDesignation',
    'autographState',
    'memorabiliaState',
    'serialNumbered',
    'printRun',
    'rawOrGraded',
    'gradeCompany',
    'grade',
    'certificationNumber'
  ];

  for (const field of fields) {
    const result = chooseField(field, providerIdentity, titleIdentity);
    resolved[field] = result.value;
    provenance[field] = {
      source: result.source,
      providerValue: providerIdentity[field] === undefined ? null : providerIdentity[field],
      titleValue: titleIdentity[field] === undefined ? null : titleIdentity[field]
    };
    if (result.conflict) conflicts.push(result.conflict);
  }

  if (resolved.product === 'unknown' && hasKnown(resolved.setName)) resolved.product = resolved.setName;
  if (resolved.setName === 'unknown' && hasKnown(resolved.product)) resolved.setName = resolved.product;
  return { resolved, provenance, conflicts };
}

function buildCanonicalCandidateIdentity(resolved = {}, title = '') {
  return {
    identityType: 'sports_card',
    category: 'sports_card',
    marketSegment: 'sports',
    raw: {
      title,
      source: SOURCE
    },
    normalized: {
      sport: resolved.sport,
      league: 'unknown',
      team: 'unknown',
      subject: {
        name: resolved.subjectName,
        aliases: []
      },
      year: resolved.year,
      manufacturer: resolved.manufacturer,
      brand: resolved.manufacturer,
      product: resolved.product,
      setName: resolved.setName,
      subset: null,
      insertSet: null,
      cardNumber: resolved.cardNumber,
      parallel: resolved.parallel,
      variation: null,
      imageVariation: null,
      rookieDesignation: resolved.rookieDesignation,
      autograph: {
        state: resolved.autographState,
        type: resolved.autographState === true ? 'auto' : null
      },
      memorabilia: {
        state: resolved.memorabiliaState,
        type: resolved.memorabiliaState === true ? 'memorabilia' : null
      },
      serialNumbered: resolved.serialNumbered,
      serialNumber: null,
      printRun: resolved.printRun,
      rawOrGraded: resolved.rawOrGraded,
      rawCondition: null,
      grading: {
        company: resolved.gradeCompany,
        grade: resolved.grade,
        certificationNumber: resolved.certificationNumber
      }
    }
  };
}

function legacyParsedIdentityFromCanonical(identity = {}) {
  const normalized = asObject(identity.normalized);
  return {
    category: 'sports_card',
    sport: normalized.sport,
    player: normalized.subject?.name,
    year: normalized.year,
    brand: normalized.manufacturer,
    product: normalized.product,
    setName: normalized.setName,
    cardNumber: normalized.cardNumber,
    parallel: normalized.parallel,
    rookie: normalized.rookieDesignation,
    autograph: normalized.autograph?.state,
    memorabilia: normalized.memorabilia?.state,
    serialNumbered: normalized.serialNumbered,
    printRun: normalized.printRun,
    rawOrGraded: normalized.rawOrGraded,
    gradeCompany: normalized.grading?.company,
    grade: normalized.grading?.grade
  };
}

function missingMaterialFields(resolved = {}) {
  return MATERIAL_FIELDS.filter((field) => !hasKnown(resolved[field]) || resolved[field] === 'unknown');
}

function classifyResolution(canonicalIdentity = {}, conflicts = [], missingFields = []) {
  if (conflicts.length) return RESOLUTION_CLASSIFICATIONS.AMBIGUOUS;
  if (canonicalIdentity.eligibility?.exactCompEligible === true && missingFields.length === 0) {
    return RESOLUTION_CLASSIFICATIONS.EXACT;
  }

  const normalized = asObject(canonicalIdentity.normalized);
  const plausible = canonicalIdentity.identityType === 'sports_card' && (
    hasKnown(normalized.subject?.name) ||
    hasKnown(normalized.cardNumber) ||
    hasKnown(normalized.setName) ||
    hasKnown(normalized.year)
  );

  return plausible ? RESOLUTION_CLASSIFICATIONS.AMBIGUOUS : RESOLUTION_CLASSIFICATIONS.UNRESOLVED;
}

function evaluateCanonicalSoldEvidenceReadiness(record = {}, canonicalIdentity = {}) {
  const candidate = {
    ...record,
    parsedIdentity: legacyParsedIdentityFromCanonical(canonicalIdentity),
    evidenceType: record.evidenceType || EVIDENCE_TYPES.TRUE_SOLD,
    status: record.status || 'active_evidence'
  };
  const validation = validateRawEvidenceRecord(candidate, {
    marketplace: 'the_card_api',
    adapterName: 'card_api_acquisition_adapter',
    capabilities: {
      transactionLevelSoldSupport: true,
      aggregateMarketPriceSupport: false,
      activeContextSupport: false
    }
  });

  return {
    ready: validation.valid,
    reasons: asArray(validation.reasons).sort()
  };
}

function resolveCardApiTransactionIdentity(transaction = {}, options = {}) {
  const record = normalizeTransaction(transaction);
  const title = getRawTitle(record);
  const providerIdentity = providerIdentityFromTransaction(record);
  const titleIdentity = parseTitleIdentity(title);
  const { resolved, provenance, conflicts } = resolveFields(providerIdentity, titleIdentity);
  const canonicalCandidate = buildCanonicalCandidateIdentity(resolved, title);
  const canonicalIdentity = canonicalIdentityEngine.buildCanonicalIdentity({
    canonicalSoldEvidenceIdentity: canonicalCandidate,
    listing: {
      title
    },
    marketplace: {
      marketplace: record.marketplace || record.marketplaceLabel || 'the_card_api'
    },
    parserVersion: `${SOURCE}:${VERSION}`
  });
  const missingFields = missingMaterialFields(resolved);
  const classification = classifyResolution(canonicalIdentity, conflicts, missingFields);
  const readiness = evaluateCanonicalSoldEvidenceReadiness(record, canonicalIdentity);
  const structuralReadinessReasons = unique([
    ...readiness.reasons,
    ...missingFields.map((field) => `missing_material_identity_${field}`),
    ...(classification === RESOLUTION_CLASSIFICATIONS.EXACT ? [] : ['identity_resolution_not_exact'])
  ]).sort();
  const structurallyReady = readiness.ready &&
    classification === RESOLUTION_CLASSIFICATIONS.EXACT &&
    missingFields.length === 0 &&
    conflicts.length === 0;

  return Object.freeze({
    source: SOURCE,
    version: VERSION,
    transactionId: record.marketplaceSaleId || record.marketplaceListingId || null,
    marketplace: record.marketplace || 'the_card_api',
    classification,
    identityExact: classification === RESOLUTION_CLASSIFICATIONS.EXACT,
    canonicalIdentity,
    canonicalIdentityKey: canonicalIdentity.canonicalIdentityKey,
    fieldProvenance: provenance,
    conflicts: conflicts.sort((a, b) => a.field.localeCompare(b.field)),
    missingMaterialFields: missingFields.sort(),
    titleParsingUsed: Object.values(provenance).some((entry) => entry.source === 'deterministic_title_parse' || entry.source === 'explicit_provider_metadata_and_title_confirmed'),
    structuredProviderMetadataUsed: Object.values(provenance).some((entry) => entry.source === 'explicit_provider_metadata' || entry.source === 'explicit_provider_metadata_and_title_confirmed' || entry.source === 'conflict_provider_preferred_for_review'),
    canonicalSoldEvidenceStructurallyReady: structurallyReady,
    canonicalSoldEvidenceReadinessReasons: structuralReadinessReasons,
    retentionAuthority: {
      persistenceAllowed: false,
      blocker: 'free_tier_non_persistent_card_api_compatibility_posture',
      writesProductionStore: false
    },
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none',
    resolutionFingerprint: fingerprint({
      source: SOURCE,
      version: VERSION,
      transactionId: record.marketplaceSaleId || record.marketplaceListingId || null,
      classification,
      canonicalIdentityKey: canonicalIdentity.canonicalIdentityKey,
      conflicts,
      missingFields,
      options: asObject(options)
    })
  });
}

function resolveCardApiIdentityBatch(transactions = [], options = {}) {
  const records = asArray(transactions);
  const resolutions = records.map((transaction) => resolveCardApiTransactionIdentity(transaction, options));
  const summary = summarizeCardApiIdentityResolution(resolutions);

  return Object.freeze({
    source: SOURCE,
    version: VERSION,
    evaluated: resolutions.length,
    resolutions: Object.freeze(resolutions),
    summary,
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none',
    batchFingerprint: fingerprint({
      source: SOURCE,
      version: VERSION,
      resolutionFingerprints: resolutions.map((resolution) => resolution.resolutionFingerprint)
    })
  });
}

function summarizeCardApiIdentityResolution(resolutions = []) {
  const entries = asArray(resolutions);
  const counts = {
    evaluated: entries.length,
    exact: entries.filter((entry) => entry.classification === RESOLUTION_CLASSIFICATIONS.EXACT).length,
    ambiguous: entries.filter((entry) => entry.classification === RESOLUTION_CLASSIFICATIONS.AMBIGUOUS).length,
    unresolved: entries.filter((entry) => entry.classification === RESOLUTION_CLASSIFICATIONS.UNRESOLVED).length,
    conflicts: entries.reduce((sum, entry) => sum + asArray(entry.conflicts).length, 0),
    structurallyReady: entries.filter((entry) => entry.canonicalSoldEvidenceStructurallyReady === true).length,
    titleParsingUsed: entries.filter((entry) => entry.titleParsingUsed === true).length,
    structuredProviderMetadataUsed: entries.filter((entry) => entry.structuredProviderMetadataUsed === true).length
  };

  return Object.freeze({
    ...counts,
    canonicalKeysProduced: unique(entries.map((entry) => entry.canonicalIdentityKey).filter((key) => key && !key.includes('unknown'))).sort(),
    retentionBlocked: entries.filter((entry) => entry.retentionAuthority?.persistenceAllowed === false).length,
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  });
}

module.exports = {
  SOURCE,
  VERSION,
  RESOLUTION_CLASSIFICATIONS,
  MATERIAL_FIELDS,
  parseTitleIdentity,
  resolveCardApiTransactionIdentity,
  resolveCardApiIdentityBatch,
  summarizeCardApiIdentityResolution
};
