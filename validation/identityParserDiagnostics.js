'use strict';

const canonicalIdentityEngine = require('../engines/canonicalIdentityEngine');
const legacyIdentityAdapter = require('../engines/legacyIdentityAdapter');
const listingSimilarityEngine = require('../engines/listingSimilarityEngine');

const {
  asArray,
  asObject,
  unique
} = require('./canonicalValidationCore');
const {
  buildFingerprintFromProjection
} = require('./fingerprintProjection');
const {
  clone,
  collectBlockingReasons,
  firstDefined
} = require('./phase8GovernanceCore');

const IDENTITY_PARSER_DIAGNOSTIC_SCHEMA_VERSION = '1.0.0';
const IDENTITY_PARSER_DIAGNOSTIC_SOURCE = 'identity_parser_diagnostics';
const UNKNOWN_VALUE = 'unknown';

const DIAGNOSTIC_STATUS = Object.freeze({
  EXACT: 'exact',
  STRONG_CANDIDATE: 'strong_candidate',
  PARTIAL: 'partial',
  AMBIGUOUS: 'ambiguous',
  UNSUPPORTED: 'unsupported',
  BLOCKED: 'blocked'
});

const AMBIGUITY_LEVEL = Object.freeze({
  NONE: 'none',
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  BLOCKING: 'blocking'
});

const REVIEW_ACTION = Object.freeze({
  NONE: 'identity_diagnostic_complete',
  REVIEW_BEFORE_EXACT_USE: 'review_before_exact_evidence_use',
  COLLECT_MISSING_FIELDS: 'collect_missing_identity_fields',
  MANUAL_IDENTITY_REVIEW: 'manual_identity_review_required',
  SCHEMA_REVIEW: 'route_to_identity_schema_review',
  RESOLVE_BLOCKERS: 'do_not_use_for_exact_identity_until_blockers_resolved'
});

const SUPPORTED_LEGACY_FIELDS = new Set([
  'sport',
  'category',
  'league',
  'team',
  'player',
  'subject',
  'playerName',
  'character',
  'name',
  'year',
  'season',
  'manufacturer',
  'brand',
  'product',
  'setName',
  'set',
  'cardSet',
  'series',
  'cardNumber',
  'cardNo',
  'number',
  'collectorNumber',
  'parallel',
  'color',
  'variation',
  'rookieDesignation',
  'rookie',
  'isRookie',
  'autograph',
  'auto',
  'isAutograph',
  'memorabilia',
  'relic',
  'patch',
  'isRelic',
  'serialNumbered',
  'numbered',
  'isNumbered',
  'printRun',
  'numberedTo',
  'rawOrGraded',
  'conditionState',
  'rawCondition',
  'condition',
  'gradeCompany',
  'grader',
  'gradingCompany',
  'grade',
  'conditionGrade',
  'certificationNumber',
  'certNumber',
  'cert',
  'game',
  'tcg',
  'franchise',
  'cardName',
  'rarity',
  'finishTreatment',
  'foilState',
  'language',
  'qualityTier',
  'flags',
  'parserVersion'
]);

const ESSENTIAL_FIELDS = [
  'subject',
  'year',
  'setName',
  'cardNumber',
  'rawOrGraded'
];

function normalize(value) {
  if (value === undefined || value === null || value === '') return UNKNOWN_VALUE;
  if (typeof value === 'boolean') return value;
  return String(value)
    .toLowerCase()
    .replace(/^#/, '')
    .replace(/[^a-z0-9\s/.'-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || UNKNOWN_VALUE;
}

function known(value) {
  return value !== undefined && value !== null && value !== '' && value !== UNKNOWN_VALUE;
}

function getPath(source = {}, path = '') {
  return String(path).split('.').reduce((current, part) => {
    if (!current || typeof current !== 'object') return undefined;
    return current[part];
  }, source);
}

function pickPath(sources = [], paths = []) {
  for (const source of sources) {
    for (const path of paths) {
      const value = getPath(source, path);
      if (known(value)) return value;
    }
  }
  return UNKNOWN_VALUE;
}

function getListing(input = {}) {
  return asObject(firstDefined(input.listing, input.productionListing, input.item, input.record, {}));
}

function getParsed(input = {}, listing = getListing(input)) {
  return asObject(firstDefined(input.parserOutput, input.parsed, input.legacyParsed, listing.parsed, listing.parsedCard, listing.card, {}));
}

function getCanonicalIdentity(input = {}, listing = getListing(input), parsed = getParsed(input, listing)) {
  const provided = firstDefined(input.canonicalIdentity, input.parsedIdentity, listing.canonicalIdentity, listing.parsedIdentity);
  if (provided && typeof provided === 'object') return clone(provided);

  return canonicalIdentityEngine.buildCanonicalIdentity(
    legacyIdentityAdapter.buildCanonicalIdentityInput(listing, {
      legacyParsed: parsed,
      parserVersion: firstDefined(input.parserVersion, parsed.parserVersion, listing.parserVersion, 'legacy_runtime_parser')
    })
  );
}

function getCanonicalSources(canonicalIdentity = {}) {
  const normalized = asObject(canonicalIdentity.normalized);
  return [normalized, canonicalIdentity];
}

function getCanonicalField(canonicalIdentity = {}, field) {
  const normalized = asObject(canonicalIdentity.normalized);
  const grading = asObject(normalized.grading);
  const subject = asObject(normalized.subject);
  const autograph = asObject(normalized.autograph);
  const memorabilia = asObject(normalized.memorabilia);

  const map = {
    subject: firstDefined(subject.name, normalized.player, normalized.cardName, canonicalIdentity.subject),
    year: normalized.year,
    setName: firstDefined(normalized.setName, normalized.product),
    product: firstDefined(normalized.product, normalized.setName),
    cardNumber: firstDefined(normalized.cardNumber, normalized.collectorNumber),
    parallel: firstDefined(normalized.imageVariation, normalized.variation, normalized.parallel, normalized.finishTreatment, normalized.rarity),
    autograph: autograph.state,
    memorabilia: memorabilia.state,
    serialNumbered: normalized.serialNumbered,
    printRun: normalized.printRun,
    rawOrGraded: normalized.rawOrGraded,
    gradingCompany: grading.company,
    grade: grading.grade,
    category: firstDefined(normalized.category, canonicalIdentity.category, canonicalIdentity.identityType)
  };

  return known(map[field]) ? map[field] : UNKNOWN_VALUE;
}

function getParsedField(parsed = {}, listing = {}, field) {
  const flags = asObject(parsed.flags);
  const map = {
    subject: pickPath([parsed, listing], ['player', 'subject', 'playerName', 'character', 'name']),
    year: pickPath([parsed, listing], ['year', 'season']),
    setName: pickPath([parsed, listing], ['setName', 'set', 'product', 'brand']),
    product: pickPath([parsed, listing], ['product', 'setName', 'set', 'brand']),
    cardNumber: pickPath([parsed, listing], ['cardNumber', 'cardNo', 'number', 'collectorNumber']),
    parallel: pickPath([parsed, listing], ['parallel', 'variation', 'color']),
    autograph: firstDefined(parsed.autograph, parsed.auto, parsed.isAutograph, flags.autograph, UNKNOWN_VALUE),
    memorabilia: firstDefined(parsed.memorabilia, parsed.relic, parsed.patch, parsed.isRelic, flags.relic, flags.patch, UNKNOWN_VALUE),
    serialNumbered: firstDefined(parsed.serialNumbered, parsed.numbered, parsed.isNumbered, flags.numbered, UNKNOWN_VALUE),
    printRun: firstDefined(parsed.printRun, parsed.numberedTo, UNKNOWN_VALUE),
    rawOrGraded: firstDefined(parsed.rawOrGraded, parsed.conditionState, flags.graded === true ? 'graded' : UNKNOWN_VALUE),
    gradingCompany: pickPath([parsed, listing], ['gradeCompany', 'grader', 'gradingCompany']),
    grade: pickPath([parsed, listing], ['grade', 'conditionGrade']),
    category: pickPath([parsed, listing], ['sport', 'category', 'game', 'franchise'])
  };

  return known(map[field]) ? map[field] : UNKNOWN_VALUE;
}

function normalizeBooleanLike(value) {
  if (typeof value === 'boolean') return value;
  const normalized = normalize(value);
  if (['true', 'yes', 'y', '1', 'auto', 'autograph', 'numbered', 'graded', 'relic', 'patch'].includes(normalized)) return true;
  if (['false', 'no', 'n', '0', 'non auto', 'non-auto', 'unnumbered', 'raw', 'non mem', 'non-mem'].includes(normalized)) return false;
  return UNKNOWN_VALUE;
}

function valuesConflict(field, parsedValue, canonicalValue) {
  if (!known(parsedValue) || !known(canonicalValue)) return false;
  if (['autograph', 'memorabilia', 'serialNumbered'].includes(field)) {
    const parsedBoolean = normalizeBooleanLike(parsedValue);
    const canonicalBoolean = normalizeBooleanLike(canonicalValue);
    return known(parsedBoolean) && known(canonicalBoolean) && parsedBoolean !== canonicalBoolean;
  }
  return normalize(parsedValue) !== normalize(canonicalValue);
}

function compareFields(parsed = {}, canonicalIdentity = {}, listing = {}) {
  const fields = [
    'subject',
    'year',
    'setName',
    'product',
    'cardNumber',
    'parallel',
    'autograph',
    'memorabilia',
    'serialNumbered',
    'printRun',
    'rawOrGraded',
    'gradingCompany',
    'grade'
  ];
  const confirmed = [];
  const missing = [];
  const conflicting = [];
  const comparison = {};

  for (const field of fields) {
    const parsedValue = getParsedField(parsed, listing, field);
    const canonicalValue = getCanonicalField(canonicalIdentity, field);
    const parserKnown = known(parsedValue);
    const canonicalKnown = known(canonicalValue);
    const record = {
      field,
      parserValue: parserKnown ? clone(parsedValue) : UNKNOWN_VALUE,
      canonicalValue: canonicalKnown ? clone(canonicalValue) : UNKNOWN_VALUE,
      status: 'unknown'
    };

    if (parserKnown && canonicalKnown && valuesConflict(field, parsedValue, canonicalValue)) {
      record.status = 'conflict';
      conflicting.push(record);
    } else if (parserKnown && canonicalKnown) {
      record.status = 'confirmed';
      confirmed.push(record);
    } else if (!parserKnown || !canonicalKnown) {
      record.status = 'missing';
      missing.push(record);
    }

    comparison[field] = record;
  }

  return { comparison, confirmed, missing, conflicting };
}

function getUnsupportedParsedFields(parsed = {}) {
  return Object.keys(parsed)
    .filter((key) => !SUPPORTED_LEGACY_FIELDS.has(key))
    .sort()
    .map((field) => ({
      field,
      value: clone(parsed[field])
    }));
}

function getInferredFields(canonicalIdentity = {}, options = {}) {
  const sourceFields = asObject(canonicalIdentity.sourceFields);
  const rawSource = normalize(firstDefined(canonicalIdentity.raw?.source, options.rawSource, ''));
  const inferred = [];

  for (const [path, source] of Object.entries(sourceFields)) {
    const normalizedSource = normalize(source);
    if (
      normalizedSource.includes('legacy') ||
      normalizedSource.includes('parser') ||
      normalizedSource.includes('title') ||
      rawSource.includes('legacy')
    ) {
      inferred.push({
        field: path.replace(/^normalized\./, ''),
        source
      });
    }
  }

  return inferred.sort((left, right) => left.field.localeCompare(right.field));
}

function hasTitleOnlyInference(input = {}, canonicalIdentity = {}, inferredFields = []) {
  const listing = getListing(input);
  const providedCanonical = Boolean(input.canonicalIdentity || listing.canonicalIdentity || input.parsedIdentity || listing.parsedIdentity);
  const rawSource = normalize(firstDefined(canonicalIdentity.raw?.source, input.rawSource, ''));
  return Boolean(
    !providedCanonical ||
    rawSource.includes('legacy') ||
    rawSource.includes('title') ||
    inferredFields.length > 0
  );
}

function getRiskFlags(parsed = {}, listing = {}) {
  const flags = asObject(parsed.flags);
  const title = normalize(firstDefined(listing.title, listing.rawTitle, parsed.title, ''));

  return {
    lotOrMultiCard: flags.lot === true || /\b(lot|bulk|collection|\d+\s*cards)\b/.test(title),
    reprintCustomProxy: flags.reprint === true || flags.custom === true || flags.digital === true || /\b(reprint|custom|proxy|facsimile|digital|novelty)\b/.test(title),
    gradedMentioned: flags.graded === true || /\b(psa|bgs|sgc|cgc|csg)\s*(10|9\.5|9|8\.5|8|7\.5|7|6|5)?\b/.test(title),
    rawMentioned: /\b(raw|ungraded)\b/.test(title),
    autoMentioned: flags.autograph === true || /\b(auto|autograph|signed)\b/.test(title),
    relicMentioned: flags.relic === true || flags.patch === true || /\b(relic|patch|memorabilia|jersey)\b/.test(title),
    numberedMentioned: flags.numbered === true || /\/\d{1,5}\b|\b(numbered|serial|ssp|sp)\b/.test(title)
  };
}

function evaluateSpecialRules({ parsed, canonicalIdentity, listing, fieldSets, unsupportedFields, inferredFields, input }) {
  const flags = getRiskFlags(parsed, listing);
  const blockingIssues = [];
  const warnings = [];
  const missingFields = fieldSets.missing.map((entry) => entry.field);
  const conflictingFields = fieldSets.conflicting.map((entry) => entry.field);
  const canonicalUnknownFields = asArray(canonicalIdentity.unknownFields);
  const similarity = input.listingSimilarity || input.listingSimilarityResult;

  if (flags.lotOrMultiCard) blockingIssues.push('lot_or_multi_card_identity_risk');
  if (flags.reprintCustomProxy) blockingIssues.push('reprint_custom_proxy_identity_risk');

  if (conflictingFields.includes('rawOrGraded')) blockingIssues.push('raw_versus_graded_conflict');
  else if (flags.gradedMentioned && getCanonicalField(canonicalIdentity, 'rawOrGraded') === UNKNOWN_VALUE) warnings.push('raw_versus_graded_ambiguity');
  else if (flags.gradedMentioned && flags.rawMentioned) warnings.push('raw_versus_graded_ambiguity');

  if (conflictingFields.includes('gradingCompany')) blockingIssues.push('grading_company_conflict');
  else if (flags.gradedMentioned && !known(getCanonicalField(canonicalIdentity, 'gradingCompany'))) warnings.push('grading_company_ambiguity');

  if (conflictingFields.includes('grade')) blockingIssues.push('grade_number_conflict');
  else if (flags.gradedMentioned && !known(getCanonicalField(canonicalIdentity, 'grade'))) warnings.push('grade_number_ambiguity');

  if (conflictingFields.includes('parallel')) warnings.push('base_versus_parallel_conflict');
  else if (missingFields.includes('parallel') || canonicalUnknownFields.includes('normalized.parallel')) warnings.push('base_versus_parallel_ambiguity');

  if (conflictingFields.includes('autograph')) blockingIssues.push('autograph_conflict');
  else if (flags.autoMentioned && !known(getCanonicalField(canonicalIdentity, 'autograph'))) warnings.push('autograph_ambiguity');

  if (conflictingFields.includes('memorabilia')) warnings.push('relic_ambiguity');
  else if (flags.relicMentioned && !known(getCanonicalField(canonicalIdentity, 'memorabilia'))) warnings.push('relic_ambiguity');

  if (conflictingFields.includes('serialNumbered') || conflictingFields.includes('printRun')) warnings.push('serial_number_conflict');
  else if (flags.numberedMentioned && (!known(getCanonicalField(canonicalIdentity, 'serialNumbered')) || !known(getCanonicalField(canonicalIdentity, 'printRun')))) warnings.push('serial_number_ambiguity');

  if (conflictingFields.includes('cardNumber')) blockingIssues.push('card_number_conflict');
  else if (missingFields.includes('cardNumber')) warnings.push('card_number_ambiguity');

  if (conflictingFields.includes('subject')) blockingIssues.push('subject_player_conflict');
  else if (missingFields.includes('subject')) warnings.push('subject_player_ambiguity');

  for (const field of ['year', 'setName', 'product']) {
    if (conflictingFields.includes(field)) warnings.push('year_set_product_conflict');
  }
  if (missingFields.some((field) => ['year', 'setName', 'product'].includes(field))) warnings.push('year_set_product_ambiguity');

  if (hasTitleOnlyInference(input, canonicalIdentity, inferredFields)) warnings.push('title_only_inference_risk');
  if (unsupportedFields.length) warnings.push('unsupported_identity_fields_present');

  if (similarity && asArray(similarity.fatalMismatches).length) {
    blockingIssues.push(...asArray(similarity.fatalMismatches).map((reason) => `similarity_fatal_mismatch:${reason}`));
  }

  return {
    blockingIssues: unique(blockingIssues),
    warnings: unique(warnings)
  };
}

function getCompleteness(parsed = {}, canonicalIdentity = {}, fieldSets = {}) {
  const parserFieldsKnown = ESSENTIAL_FIELDS.filter((field) => known(getParsedField(parsed, {}, field)));
  const canonicalFieldsKnown = ESSENTIAL_FIELDS.filter((field) => known(getCanonicalField(canonicalIdentity, field)));
  const missing = unique([
    ...ESSENTIAL_FIELDS.filter((field) => !parserFieldsKnown.includes(field)).map((field) => `parser.${field}`),
    ...ESSENTIAL_FIELDS.filter((field) => !canonicalFieldsKnown.includes(field)).map((field) => `canonical.${field}`),
    ...fieldSets.missing
      .filter((entry) => ESSENTIAL_FIELDS.includes(entry.field))
      .map((entry) => entry.field)
  ]);

  return {
    parserKnownFieldCount: parserFieldsKnown.length,
    canonicalKnownFieldCount: canonicalFieldsKnown.length,
    requiredFieldCount: ESSENTIAL_FIELDS.length,
    complete: missing.length === 0,
    missing
  };
}

function chooseStatus({ canonicalIdentity, completeness, fieldSets, blockingIssues, warnings, unsupportedFields }) {
  if (blockingIssues.length) return DIAGNOSTIC_STATUS.BLOCKED;
  if (unsupportedFields.length || !['sports_card', 'tcg_card'].includes(canonicalIdentity.identityType)) return DIAGNOSTIC_STATUS.UNSUPPORTED;
  if (fieldSets.conflicting.length || warnings.some((warning) => /conflict/.test(warning))) return DIAGNOSTIC_STATUS.AMBIGUOUS;
  if (!completeness.complete || asArray(canonicalIdentity.unknownFields).length > 0) return DIAGNOSTIC_STATUS.PARTIAL;
  if (warnings.some((warning) => /ambiguity/.test(warning))) return DIAGNOSTIC_STATUS.AMBIGUOUS;
  if (canonicalIdentity.eligibility?.valuationEligible === true && warnings.length === 0) return DIAGNOSTIC_STATUS.EXACT;
  if (canonicalIdentity.eligibility?.exactCompEligible === true || canonicalIdentity.overallIdentityConfidence >= 0.75) {
    return DIAGNOSTIC_STATUS.STRONG_CANDIDATE;
  }
  return DIAGNOSTIC_STATUS.PARTIAL;
}

function chooseAmbiguityLevel(status, warnings = [], blockingIssues = [], conflicts = []) {
  if (status === DIAGNOSTIC_STATUS.BLOCKED || blockingIssues.length) return AMBIGUITY_LEVEL.BLOCKING;
  if (status === DIAGNOSTIC_STATUS.UNSUPPORTED || conflicts.length >= 2) return AMBIGUITY_LEVEL.HIGH;
  if (status === DIAGNOSTIC_STATUS.AMBIGUOUS || warnings.length >= 3 || conflicts.length) return AMBIGUITY_LEVEL.MEDIUM;
  if (warnings.length || status === DIAGNOSTIC_STATUS.PARTIAL) return AMBIGUITY_LEVEL.LOW;
  return AMBIGUITY_LEVEL.NONE;
}

function chooseReviewAction(status) {
  if (status === DIAGNOSTIC_STATUS.BLOCKED) return REVIEW_ACTION.RESOLVE_BLOCKERS;
  if (status === DIAGNOSTIC_STATUS.UNSUPPORTED) return REVIEW_ACTION.SCHEMA_REVIEW;
  if (status === DIAGNOSTIC_STATUS.AMBIGUOUS) return REVIEW_ACTION.MANUAL_IDENTITY_REVIEW;
  if (status === DIAGNOSTIC_STATUS.PARTIAL) return REVIEW_ACTION.COLLECT_MISSING_FIELDS;
  if (status === DIAGNOSTIC_STATUS.STRONG_CANDIDATE) return REVIEW_ACTION.REVIEW_BEFORE_EXACT_USE;
  return REVIEW_ACTION.NONE;
}

function buildIdentityParserDiagnosticFingerprint(result = {}) {
  const projection = clone(result);
  delete projection.stableFingerprint;
  return buildFingerprintFromProjection(projection);
}

function evaluateIdentityParserDiagnostics(input = {}) {
  const listing = getListing(input);
  const parsed = getParsed(input, listing);
  const canonicalIdentity = getCanonicalIdentity(input, listing, parsed);
  const comparisonFromAdapter = legacyIdentityAdapter.compareLegacyToCanonical(parsed, canonicalIdentity);
  const fieldSets = compareFields(parsed, canonicalIdentity, listing);
  const unsupportedFields = getUnsupportedParsedFields(parsed);
  const inferredFields = getInferredFields(canonicalIdentity, input);
  const completeness = getCompleteness(parsed, canonicalIdentity, fieldSets);
  const ruleDiagnostics = evaluateSpecialRules({
    parsed,
    canonicalIdentity,
    listing,
    fieldSets,
    unsupportedFields,
    inferredFields,
    input
  });
  const blockingIssues = collectBlockingReasons(ruleDiagnostics.blockingIssues.map((reason) => ({ when: true, reason })));
  const warnings = unique([
    ...ruleDiagnostics.warnings,
    ...asArray(canonicalIdentity.normalizationWarnings)
  ]);
  const status = chooseStatus({
    canonicalIdentity,
    completeness,
    fieldSets,
    blockingIssues,
    warnings,
    unsupportedFields
  });
  const ambiguityLevel = chooseAmbiguityLevel(status, warnings, blockingIssues, fieldSets.conflicting);

  const result = {
    source: IDENTITY_PARSER_DIAGNOSTIC_SOURCE,
    schemaVersion: IDENTITY_PARSER_DIAGNOSTIC_SCHEMA_VERSION,
    productionImpact: 'none',
    decisionImpact: 'none',
    identityEligibility: {
      exactCompEligible: canonicalIdentity.eligibility?.exactCompEligible === true,
      valuationEligible: canonicalIdentity.eligibility?.valuationEligible === true,
      manualReviewRequired: canonicalIdentity.eligibility?.manualReviewRequired !== false,
      contextOnly: canonicalIdentity.eligibility?.contextOnly !== false
    },
    diagnosticStatus: status,
    ambiguityLevel,
    blockingIssues,
    warnings,
    parserCanonicalComparison: {
      fields: fieldSets.comparison,
      legacyAdapterComparison: comparisonFromAdapter
    },
    fieldsConfirmed: fieldSets.confirmed,
    fieldsMissing: unique([
      ...completeness.missing,
      ...fieldSets.missing.map((entry) => entry.field)
    ]),
    fieldsConflicting: fieldSets.conflicting,
    fieldsInferred: inferredFields,
    unsupportedIdentityFields: unsupportedFields,
    recommendedReviewAction: chooseReviewAction(status),
    stableFingerprint: ''
  };

  result.stableFingerprint = buildIdentityParserDiagnosticFingerprint(result);
  return Object.freeze(result);
}

function summarizeIdentityParserDiagnostics(result = {}) {
  const status = result.diagnosticStatus || DIAGNOSTIC_STATUS.PARTIAL;
  if (status === DIAGNOSTIC_STATUS.EXACT) return 'Identity diagnostics found exact identity support with no ambiguity.';
  if (status === DIAGNOSTIC_STATUS.STRONG_CANDIDATE) return 'Identity diagnostics found a strong candidate that still requires normal review.';
  if (status === DIAGNOSTIC_STATUS.AMBIGUOUS) return 'Identity diagnostics found ambiguity requiring manual identity review.';
  if (status === DIAGNOSTIC_STATUS.UNSUPPORTED) return 'Identity diagnostics found unsupported identity fields or identity type.';
  if (status === DIAGNOSTIC_STATUS.BLOCKED) return 'Identity diagnostics found blocker-level identity risk.';
  return 'Identity diagnostics found partial identity support with missing fields.';
}

module.exports = {
  AMBIGUITY_LEVEL,
  DIAGNOSTIC_STATUS,
  IDENTITY_PARSER_DIAGNOSTIC_SCHEMA_VERSION,
  IDENTITY_PARSER_DIAGNOSTIC_SOURCE,
  REVIEW_ACTION,
  UNKNOWN_VALUE,
  buildIdentityParserDiagnosticFingerprint,
  evaluateIdentityParserDiagnostics,
  summarizeIdentityParserDiagnostics,
  normalizeListingProfile: listingSimilarityEngine.normalizeListingProfile
};
