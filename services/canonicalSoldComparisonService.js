'use strict';

const canonicalIdentityEngine = require('../engines/canonicalIdentityEngine');

const SOURCE = 'canonical_sold_comparison_service';
const VERSION = 'canonical-sold-comparison-service-v1';

const CLASSIFICATIONS = Object.freeze({
  EXACT_MATCH: 'exact_match',
  CONTEXTUAL_MATCH: 'contextual_match',
  REJECTED_MATCH: 'rejected_match',
  STALE_MATCH: 'stale_match',
  INSUFFICIENT_IDENTITY: 'insufficient_identity'
});

const TRUE_SOLD = 'true_sold';
const ACTIVE_EVIDENCE = 'active_evidence';
const DEFAULT_STALE_DAYS = 180;

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeText(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s/.'-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeComparableValue(value) {
  if (value === undefined || value === null || value === '') return 'unknown';
  if (typeof value === 'boolean') return value;
  return normalizeText(value).replace(/^#/, '') || 'unknown';
}

function hasKnown(value) {
  return value !== undefined && value !== null && value !== '' && value !== 'unknown';
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function daysBetween(later, earlier) {
  const laterDate = normalizeDate(later);
  const earlierDate = normalizeDate(earlier);
  if (!laterDate || !earlierDate) return null;
  return Math.floor((laterDate.getTime() - earlierDate.getTime()) / 86400000);
}

function average(values = []) {
  const valid = values.map(Number).filter(Number.isFinite);
  if (!valid.length) return null;
  return Math.round((valid.reduce((sum, value) => sum + value, 0) / valid.length) * 100) / 100;
}

function getPath(source = {}, path = '') {
  return String(path).split('.').reduce((current, part) => {
    if (!current || typeof current !== 'object') return undefined;
    return current[part];
  }, source);
}

function isCanonicalIdentity(value = {}) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    value.schemaVersion &&
    value.canonicalIdentityKey &&
    value.normalized
  );
}

function normalizeCanonicalIdentity(identity = {}, role = 'target') {
  if (isCanonicalIdentity(identity)) return identity;
  const input = role === 'sold_record'
    ? {
        canonicalSoldEvidenceIdentity: identity.canonicalIdentity || identity.identity || null,
        identity: identity.parsedIdentity || identity.parsed || null,
        listing: {
          title: identity.rawTitle || identity.title || identity.normalizedTitle || '',
          marketplaceItemId: identity.marketplaceListingId || identity.itemId || identity.id || ''
        },
        marketplace: {
          marketplace: identity.marketplace || identity.marketplaceLabel || ''
        }
      }
    : {
        canonicalSoldEvidenceIdentity: identity,
        identity
      };

  return canonicalIdentityEngine.buildCanonicalIdentity(input);
}

function getRecordIdentity(record = {}) {
  if (isCanonicalIdentity(record.canonicalIdentity)) return record.canonicalIdentity;
  if (isCanonicalIdentity(record.identity)) return record.identity;
  if (record.parsedIdentity || record.parsed || record.rawTitle || record.title) {
    return normalizeCanonicalIdentity(record, 'sold_record');
  }
  return canonicalIdentityEngine.buildCanonicalIdentity({});
}

const SPORTS_FIELDS = [
  ['sport', 'normalized.sport'],
  ['subject', 'normalized.subject.name'],
  ['year', 'normalized.year'],
  ['manufacturer', 'normalized.manufacturer'],
  ['setName', 'normalized.setName'],
  ['cardNumber', 'normalized.cardNumber'],
  ['parallel', 'normalized.parallel'],
  ['rookieDesignation', 'normalized.rookieDesignation'],
  ['autograph', 'normalized.autograph.state'],
  ['memorabilia', 'normalized.memorabilia.state'],
  ['serialNumbered', 'normalized.serialNumbered'],
  ['printRun', 'normalized.printRun'],
  ['rawOrGraded', 'normalized.rawOrGraded'],
  ['gradingCompany', 'normalized.grading.company'],
  ['grade', 'normalized.grading.grade']
];

const TCG_FIELDS = [
  ['game', 'normalized.game'],
  ['cardName', 'normalized.cardName'],
  ['setName', 'normalized.setName'],
  ['collectorNumber', 'normalized.collectorNumber'],
  ['rarity', 'normalized.rarity'],
  ['finishTreatment', 'normalized.finishTreatment'],
  ['foilState', 'normalized.foilState'],
  ['alternateArt', 'normalized.alternateArt'],
  ['firstEdition', 'normalized.firstEdition'],
  ['language', 'normalized.language'],
  ['serialized', 'normalized.serialized'],
  ['rawOrGraded', 'normalized.rawOrGraded'],
  ['gradingCompany', 'normalized.grading.company'],
  ['grade', 'normalized.grading.grade']
];

const CONTEXT_FIELDS_BY_TYPE = {
  sports_card: ['subject', 'year', 'manufacturer', 'setName'],
  tcg_card: ['game', 'cardName', 'setName']
};

const FATAL_CONTEXT_MISMATCH_FIELDS = new Set([
  'subject',
  'cardName',
  'year',
  'cardNumber',
  'collectorNumber',
  'sport',
  'game',
  'setName'
]);

const REJECTION_REASON_BY_FIELD = {
  subject: 'subject_mismatch',
  cardName: 'card_name_mismatch',
  player: 'subject_mismatch',
  year: 'year_mismatch',
  cardNumber: 'card_number_mismatch',
  collectorNumber: 'collector_number_mismatch',
  parallel: 'parallel_mismatch',
  finishTreatment: 'finish_treatment_mismatch',
  autograph: 'autograph_mismatch',
  memorabilia: 'memorabilia_mismatch',
  serialNumbered: 'serial_numbered_mismatch',
  printRun: 'print_run_mismatch',
  rawOrGraded: 'raw_vs_graded_mismatch',
  gradingCompany: 'grading_company_mismatch',
  grade: 'grade_mismatch',
  sport: 'sport_mismatch',
  game: 'game_mismatch',
  setName: 'set_mismatch'
};

function getIdentityFields(identity = {}) {
  if (identity.identityType === 'tcg_card') return TCG_FIELDS;
  if (identity.identityType === 'sports_card') return SPORTS_FIELDS;
  return [];
}

function compareIdentityFields(targetIdentity = {}, recordIdentity = {}) {
  const fields = getIdentityFields(targetIdentity);
  const matchingFields = [];
  const conflictingFields = [];
  const unknownFields = [];

  for (const [field, path] of fields) {
    const targetRaw = getPath(targetIdentity, path);
    const recordRaw = getPath(recordIdentity, path);
    const targetValue = normalizeComparableValue(targetRaw);
    const recordValue = normalizeComparableValue(recordRaw);
    const targetKnown = hasKnown(targetValue);
    const recordKnown = hasKnown(recordValue);
    const entry = {
      field,
      targetValue: targetKnown ? targetRaw : 'unknown',
      recordValue: recordKnown ? recordRaw : 'unknown',
      path
    };

    if (targetKnown && recordKnown && targetValue === recordValue) {
      matchingFields.push(entry);
    } else if (targetKnown && recordKnown && targetValue !== recordValue) {
      conflictingFields.push(entry);
    } else if (!targetKnown || !recordKnown) {
      unknownFields.push(entry);
    }
  }

  return {
    matchingFields,
    conflictingFields,
    unknownFields
  };
}

function getMismatchReasons(fieldComparisons = {}) {
  return asArray(fieldComparisons.conflictingFields).map((entry) => (
    REJECTION_REASON_BY_FIELD[entry.field] || `${entry.field}_mismatch`
  ));
}

function hasContextualSimilarity(targetIdentity = {}, recordIdentity = {}, fieldComparisons = {}) {
  const contextFields = CONTEXT_FIELDS_BY_TYPE[targetIdentity.identityType] || [];
  if (!contextFields.length || targetIdentity.identityType !== recordIdentity.identityType) return false;
  if (asArray(fieldComparisons.conflictingFields).some((entry) => FATAL_CONTEXT_MISMATCH_FIELDS.has(entry.field))) {
    return false;
  }

  return contextFields.every((field) => (
    fieldComparisons.matchingFields.some((entry) => entry.field === field)
  ));
}

function isTrueSoldRecord(record = {}) {
  return record.evidenceType === TRUE_SOLD && (record.status || ACTIVE_EVIDENCE) === ACTIVE_EVIDENCE;
}

function isStale(record = {}, options = {}) {
  const asOf = options.asOf || new Date().toISOString();
  const staleDays = toNumber(options.staleDays, DEFAULT_STALE_DAYS);
  const ageDays = daysBetween(asOf, record.soldAt || record.dateSold || record.soldDate);
  return ageDays !== null && ageDays > staleDays;
}

function baseComparison(record = {}, recordIdentity = {}, fieldComparisons = {}, classification = '') {
  return {
    classification,
    recordId: record.id || record.marketplaceSaleId || record.marketplaceListingId || null,
    marketplace: record.marketplace || record.marketplaceLabel || 'unknown',
    soldAt: record.soldAt || record.dateSold || record.soldDate || null,
    soldPrice: record.totalPaid ?? record.soldPrice ?? record.price ?? null,
    evidenceType: record.evidenceType || 'unknown',
    canonicalIdentityKey: recordIdentity.canonicalIdentityKey || '',
    valuationEligible: false,
    explanation: '',
    rejectionReasons: [],
    fieldComparisons,
    confidence: {
      identityConfidence: toNumber(recordIdentity.overallIdentityConfidence ?? record.identityConfidence, 0),
      evidenceQualityScore: toNumber(record.evidenceQualityScore, 0),
      priceConfidence: toNumber(record.priceConfidence, 0),
      soldDateConfidence: toNumber(record.soldDateConfidence, 0)
    }
  };
}

function compareSoldRecord(canonicalIdentity = {}, soldRecord = {}, options = {}) {
  const targetIdentity = normalizeCanonicalIdentity(canonicalIdentity, 'target');
  const record = asObject(soldRecord);
  const recordIdentity = getRecordIdentity(record);
  const fieldComparisons = compareIdentityFields(targetIdentity, recordIdentity);
  const comparison = baseComparison(record, recordIdentity, fieldComparisons);

  if (!targetIdentity.eligibility?.exactCompEligible || !targetIdentity.canonicalIdentityKey || targetIdentity.identityType === 'unknown') {
    comparison.classification = CLASSIFICATIONS.INSUFFICIENT_IDENTITY;
    comparison.explanation = 'Target canonical identity is insufficient, so sold evidence cannot be compared as an exact match.';
    comparison.rejectionReasons = ['target_identity_insufficient'];
    return comparison;
  }

  if (!record || !Object.keys(record).length || recordIdentity.identityType === 'unknown' || !recordIdentity.canonicalIdentityKey) {
    comparison.classification = CLASSIFICATIONS.INSUFFICIENT_IDENTITY;
    comparison.explanation = 'Sold record identity is insufficient or malformed, so it cannot support valuation.';
    comparison.rejectionReasons = ['sold_record_identity_insufficient'];
    return comparison;
  }

  if (!isTrueSoldRecord(record)) {
    comparison.classification = CLASSIFICATIONS.REJECTED_MATCH;
    comparison.explanation = 'Record is not active transaction-level true sold evidence, so it cannot be an exact sold comp.';
    comparison.rejectionReasons = ['not_true_sold_evidence'];
    return comparison;
  }

  if (recordIdentity.canonicalIdentityKey === targetIdentity.canonicalIdentityKey) {
    if (isStale(record, options)) {
      comparison.classification = CLASSIFICATIONS.STALE_MATCH;
      comparison.explanation = 'Sold record matches the canonical identity but is stale and separated from fresh exact support.';
      comparison.rejectionReasons = ['stale_sale'];
      return comparison;
    }

    comparison.classification = CLASSIFICATIONS.EXACT_MATCH;
    comparison.valuationEligible = true;
    comparison.explanation = 'Sold record matches the target canonical identity exactly and is eligible as evidence-only exact sold support.';
    return comparison;
  }

  const mismatchReasons = getMismatchReasons(fieldComparisons);

  if (hasContextualSimilarity(targetIdentity, recordIdentity, fieldComparisons)) {
    comparison.classification = CLASSIFICATIONS.CONTEXTUAL_MATCH;
    comparison.explanation = 'Sold record shares broad identity context but is not an exact canonical identity match; it is research-only and never valuation-eligible.';
    comparison.rejectionReasons = mismatchReasons.length ? mismatchReasons : ['canonical_identity_key_mismatch'];
    return comparison;
  }

  comparison.classification = CLASSIFICATIONS.REJECTED_MATCH;
  comparison.explanation = 'Sold record conflicts with the target canonical identity and is rejected from sold-comp support.';
  comparison.rejectionReasons = mismatchReasons.length ? mismatchReasons : ['canonical_identity_key_mismatch'];
  return comparison;
}

function countByReason(comparisons = []) {
  return comparisons.reduce((stats, comparison) => {
    for (const reason of comparison.rejectionReasons || []) {
      stats[reason] = (stats[reason] || 0) + 1;
    }
    return stats;
  }, {});
}

function countIdentityMismatches(comparisons = []) {
  return comparisons.reduce((stats, comparison) => {
    for (const conflict of comparison.fieldComparisons?.conflictingFields || []) {
      stats[conflict.field] = (stats[conflict.field] || 0) + 1;
    }
    return stats;
  }, {});
}

function createEmptyResult(canonicalIdentity = {}, options = {}) {
  const identity = normalizeCanonicalIdentity(canonicalIdentity, 'target');
  return {
    source: SOURCE,
    version: VERSION,
    productionImpact: 'none',
    decisionImpact: 'none',
    evidenceOnly: true,
    targetCanonicalIdentityKey: identity.canonicalIdentityKey || '',
    targetIdentityType: identity.identityType || 'unknown',
    asOf: options.asOf || new Date().toISOString(),
    staleDays: toNumber(options.staleDays, DEFAULT_STALE_DAYS),
    acceptedExactMatches: [],
    contextualMatches: [],
    rejectedMatches: [],
    staleMatches: [],
    insufficientIdentityMatches: [],
    rejectionStatistics: {
      totalRejected: 0,
      reasons: {}
    },
    identityMismatchStatistics: {},
    confidenceSummary: {
      comparedRecordCount: 0,
      averageIdentityConfidence: null,
      averageEvidenceQualityScore: null,
      exactMatchAverageEvidenceQualityScore: null
    },
    comparisonDiagnostics: {
      targetExactCompEligible: identity.eligibility?.exactCompEligible === true,
      targetValuationEligible: identity.eligibility?.valuationEligible === true,
      contextualMatchesValuationEligible: false,
      unknownFields: asArray(identity.unknownFields),
      normalizationWarnings: asArray(identity.normalizationWarnings),
      classificationCounts: {
        exact_match: 0,
        contextual_match: 0,
        rejected_match: 0,
        stale_match: 0,
        insufficient_identity: 0
      }
    },
    processingSummary: {
      totalRecords: 0,
      processedRecords: 0,
      exactMatchCount: 0,
      contextualMatchCount: 0,
      rejectedMatchCount: 0,
      staleMatchCount: 0,
      insufficientIdentityCount: 0
    },
    summary: 'No sold evidence records were compared.'
  };
}

function evaluateCanonicalSoldComparisons(canonicalIdentity = {}, soldRecords = [], options = {}) {
  const result = createEmptyResult(canonicalIdentity, options);
  const records = asArray(soldRecords);
  result.processingSummary.totalRecords = records.length;

  for (const record of records) {
    const comparison = compareSoldRecord(canonicalIdentity, record, options);
    result.processingSummary.processedRecords += 1;
    result.comparisonDiagnostics.classificationCounts[comparison.classification] += 1;

    if (comparison.classification === CLASSIFICATIONS.EXACT_MATCH) {
      result.acceptedExactMatches.push(comparison);
    } else if (comparison.classification === CLASSIFICATIONS.CONTEXTUAL_MATCH) {
      result.contextualMatches.push(comparison);
    } else if (comparison.classification === CLASSIFICATIONS.STALE_MATCH) {
      result.staleMatches.push(comparison);
    } else if (comparison.classification === CLASSIFICATIONS.INSUFFICIENT_IDENTITY) {
      result.insufficientIdentityMatches.push(comparison);
    } else {
      result.rejectedMatches.push(comparison);
    }
  }

  result.processingSummary.exactMatchCount = result.acceptedExactMatches.length;
  result.processingSummary.contextualMatchCount = result.contextualMatches.length;
  result.processingSummary.rejectedMatchCount = result.rejectedMatches.length;
  result.processingSummary.staleMatchCount = result.staleMatches.length;
  result.processingSummary.insufficientIdentityCount = result.insufficientIdentityMatches.length;

  const nonAccepted = [
    ...result.rejectedMatches,
    ...result.contextualMatches,
    ...result.staleMatches,
    ...result.insufficientIdentityMatches
  ];
  result.rejectionStatistics = {
    totalRejected: nonAccepted.length,
    reasons: countByReason(nonAccepted)
  };
  result.identityMismatchStatistics = countIdentityMismatches(nonAccepted);

  const allComparisons = [
    ...result.acceptedExactMatches,
    ...result.contextualMatches,
    ...result.rejectedMatches,
    ...result.staleMatches,
    ...result.insufficientIdentityMatches
  ];
  result.confidenceSummary = {
    comparedRecordCount: allComparisons.length,
    averageIdentityConfidence: average(allComparisons.map((entry) => entry.confidence.identityConfidence)),
    averageEvidenceQualityScore: average(allComparisons.map((entry) => entry.confidence.evidenceQualityScore)),
    exactMatchAverageEvidenceQualityScore: average(result.acceptedExactMatches.map((entry) => entry.confidence.evidenceQualityScore))
  };
  result.summary = summarizeCanonicalSoldComparison(result);

  return result;
}

function summarizeCanonicalSoldComparison(result = {}) {
  const exact = asArray(result.acceptedExactMatches).length;
  const stale = asArray(result.staleMatches).length;
  const contextual = asArray(result.contextualMatches).length;
  const rejected = asArray(result.rejectedMatches).length;
  const insufficient = asArray(result.insufficientIdentityMatches).length;

  if (exact > 0) {
    return `${exact} exact canonical sold match${exact === 1 ? '' : 'es'} found; contextual, stale, and rejected records remain evidence-only diagnostics.`;
  }
  if (stale > 0) {
    return `No fresh exact canonical sold matches found; ${stale} stale exact match${stale === 1 ? '' : 'es'} separated from valuation support.`;
  }
  if (contextual > 0) {
    return `No exact canonical sold matches found; ${contextual} contextual match${contextual === 1 ? '' : 'es'} available for research only.`;
  }
  if (rejected > 0 || insufficient > 0) {
    return 'No exact canonical sold matches found; compared records were rejected or had insufficient identity.';
  }
  return 'No sold evidence records were compared.';
}

module.exports = {
  SOURCE,
  VERSION,
  DEFAULT_STALE_DAYS,
  CLASSIFICATIONS,
  compareSoldRecord,
  evaluateCanonicalSoldComparisons,
  summarizeCanonicalSoldComparison
};
