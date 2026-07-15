'use strict';

const fs = require('node:fs');

const {
  buildCanonicalCardKey,
  loadSoldEvidenceStore,
  normalizeSoldEvidenceRecord
} = require('../utils/soldEvidenceStore');
const {
  asArray,
  asObject,
  fingerprint,
  normalizeDate,
  stableStringify,
  toNumber,
  unique
} = require('./canonicalValidationCore');
const {
  buildBiasReport,
  buildCoverageReport,
  buildImportValidationReport,
  extractRecords,
  normalizeDatasetRecords
} = require('./soldEvidenceDatasetBuilder');
const {
  duplicateGroups,
  saleKey,
  sourceRecordKey,
  validateExactIdentity,
  validateRecordForPilot
} = require('./soldEvidenceDatasetPilot');
const {
  validateCanonicalRecord
} = require('./soldEvidenceStoreConformance');
const {
  isTrueSoldRecord
} = require('../services/soldEvidenceService');

const SOURCE = 'canonical_dataset_operations';
const DATASET_OPERATIONS_VERSION = '1.0.0';

const DEFAULT_TARGETS = Object.freeze({
  exactCanonicalIdentities: 100,
  verifiedSoldRecords: 750,
  minimumEvidencePerIdentity: 3,
  shadowEligibleEvidencePerIdentity: 5,
  deepEvidencePerIdentity: 10
});

const EVIDENCE_DEPTH = Object.freeze({
  NO_ELIGIBLE_EVIDENCE: 'no_eligible_evidence',
  THIN: 'thin',
  DEVELOPING: 'developing',
  SUFFICIENT_FOR_SHADOW_REVIEW: 'sufficient_for_shadow_review',
  DEEP: 'deep'
});

const RECOMMENDED_ACTION = Object.freeze({
  ADD_EXACT_SOLD_EVIDENCE: 'add_exact_sold_evidence',
  ADD_RECENT_SALES: 'add_recent_sales',
  RESOLVE_INVALID_RECORDS: 'resolve_invalid_records',
  REVIEW_DUPLICATES: 'review_duplicates',
  COMPLETE_MANUAL_REVIEW: 'complete_manual_review',
  DIVERSIFY_SOURCE_COVERAGE: 'diversify_source_coverage',
  READY_FOR_SHADOW_REVIEW: 'ready_for_shadow_review',
  MAINTAIN_COVERAGE: 'maintain_coverage'
});

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function round(value, decimals = 4) {
  const factor = 10 ** decimals;
  return Math.round(toNumber(value, 0) * factor) / factor;
}

function daysBetween(later, earlier) {
  const laterDate = new Date(later || '');
  const earlierDate = new Date(earlier || '');
  if (Number.isNaN(laterDate.getTime()) || Number.isNaN(earlierDate.getTime())) return null;
  return Math.floor((laterDate.getTime() - earlierDate.getTime()) / 86400000);
}

function loadCanonicalDataset(input = {}) {
  if (Array.isArray(input)) return normalizeDatasetRecords(input);
  if (input.records && typeof input.records === 'object' && !Array.isArray(input.records)) {
    return normalizeDatasetRecords(Object.values(input.records));
  }
  if (input.storePath) {
    return Object.values(loadSoldEvidenceStore(input.storePath).records || {});
  }
  if (input.datasetPath || input.filePath) {
    return normalizeDatasetRecords(extractRecords(readJsonFile(input.datasetPath || input.filePath)));
  }
  return normalizeDatasetRecords(extractRecords(input));
}

function identityKey(record = {}) {
  return record.canonicalCardKey || buildCanonicalCardKey(record.parsedIdentity || {});
}

function identitySummary(record = {}) {
  const identity = asObject(record.parsedIdentity);
  return {
    category: identity.category || 'unknown',
    sport: identity.sport || null,
    game: identity.game || null,
    player: identity.player || identity.subject || null,
    character: identity.character || null,
    year: identity.year || null,
    brand: identity.brand || null,
    product: identity.product || null,
    setName: identity.setName || null,
    cardNumber: identity.cardNumber || null,
    parallel: identity.parallel || null,
    rookie: identity.rookie === true,
    autograph: identity.autograph === true,
    memorabilia: identity.memorabilia === true,
    serialNumbered: identity.serialNumbered === true
  };
}

function isVerified(record = {}) {
  const status = String(record.review?.status || record.reviewStatus || '').toLowerCase();
  return ['human_verified', 'dealer_verified', 'second_review_verified', 'verified'].includes(status);
}

function isExactEligibleSold(record = {}) {
  return isTrueSoldRecord(record)
    && isVerified(record)
    && validateCanonicalRecord(record).valid
    && validateRecordForPilot(record).valid;
}

function isTransactionIneligible(record = {}) {
  const validation = validateRecordForPilot(record);
  return validation.reasons.some((reason) => [
    'not_true_sold_evidence',
    'inactive_or_context_record',
    'missing_sold_price',
    'missing_sold_date'
  ].includes(reason));
}

function classifyEvidenceDepth(exactEligibleSoldCount = 0, targets = DEFAULT_TARGETS) {
  const count = Number(exactEligibleSoldCount || 0);
  if (count <= 0) return EVIDENCE_DEPTH.NO_ELIGIBLE_EVIDENCE;
  if (count < targets.minimumEvidencePerIdentity) return EVIDENCE_DEPTH.THIN;
  if (count < targets.shadowEligibleEvidencePerIdentity) return EVIDENCE_DEPTH.DEVELOPING;
  if (count < targets.deepEvidencePerIdentity) return EVIDENCE_DEPTH.SUFFICIENT_FOR_SHADOW_REVIEW;
  return EVIDENCE_DEPTH.DEEP;
}

function priceRange(records = []) {
  const prices = asArray(records)
    .map((record) => toNumber(record.totalPaid || record.soldPrice, NaN))
    .filter(Number.isFinite)
    .filter((price) => price > 0)
    .sort((a, b) => a - b);
  return {
    minimum: prices.length ? prices[0] : null,
    maximum: prices.length ? prices[prices.length - 1] : null
  };
}

function recencyRange(records = []) {
  const dates = asArray(records)
    .map((record) => normalizeDate(record.soldAt))
    .filter(Boolean)
    .sort();
  return {
    oldest: dates[0] || null,
    newest: dates[dates.length - 1] || null
  };
}

function countBy(records = [], selector) {
  return asArray(records).reduce((counts, record) => {
    const key = selector(record) || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function distribution(records = [], selector) {
  const counts = countBy(records, selector);
  const total = records.length || 0;
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)).map(([key, count]) => [
    key,
    { count, share: total ? round(count / total) : 0 }
  ]));
}

function priceBucket(record = {}) {
  const price = toNumber(record.totalPaid || record.soldPrice, 0);
  if (price >= 1000) return '1000_plus';
  if (price >= 250) return '250_to_999';
  if (price >= 100) return '100_to_249';
  if (price >= 25) return '25_to_99';
  return 'under_25';
}

function recencyBucket(record = {}, asOf, staleDays) {
  const age = daysBetween(asOf, record.soldAt);
  if (age === null) return 'unknown';
  if (age <= 90) return 'fresh_0_to_90_days';
  if (age <= staleDays) return 'usable_91_to_stale_threshold';
  return 'stale';
}

function duplicateRecordIds(records = []) {
  const groups = [
    ...duplicateGroups(records, sourceRecordKey),
    ...duplicateGroups(records, saleKey)
  ];
  const ids = new Set();
  for (const group of groups) {
    for (const entry of asArray(group.entries)) {
      ids.add(entry.id);
    }
  }
  return {
    groups,
    ids
  };
}

function reviewCompleteness(records = []) {
  const total = records.length;
  const verified = records.filter(isVerified).length;
  return {
    total,
    verified,
    incomplete: total - verified,
    percent: total ? round(verified / total) : 0
  };
}

function blockingReasonsForIdentity(stats = {}) {
  const reasons = [];
  if (stats.exactEligibleSoldCount === 0) reasons.push('no_exact_eligible_sold_evidence');
  if (stats.exactEligibleSoldCount > 0 && stats.exactEligibleSoldCount < DEFAULT_TARGETS.minimumEvidencePerIdentity) {
    reasons.push('below_minimum_evidence_target');
  }
  if (stats.invalidOrIneligibleCount > 0) reasons.push('invalid_or_ineligible_records_present');
  if (stats.duplicateCount > 0) reasons.push('duplicate_records_present');
  if (stats.reviewCompleteness.incomplete > 0) reasons.push('manual_review_incomplete');
  if (stats.staleCount > 0 && stats.exactEligibleSoldCount < DEFAULT_TARGETS.shadowEligibleEvidencePerIdentity) {
    reasons.push('recent_sales_needed');
  }
  return reasons;
}

function recommendedActionForIdentity(report = {}) {
  if (report.duplicateCount > 0) return RECOMMENDED_ACTION.REVIEW_DUPLICATES;
  if (report.invalidOrIneligibleCount > 0) return RECOMMENDED_ACTION.RESOLVE_INVALID_RECORDS;
  if (report.reviewCompleteness.incomplete > 0) return RECOMMENDED_ACTION.COMPLETE_MANUAL_REVIEW;
  if (report.evidenceDepthClassification === EVIDENCE_DEPTH.NO_ELIGIBLE_EVIDENCE || report.evidenceDepthClassification === EVIDENCE_DEPTH.THIN) {
    return RECOMMENDED_ACTION.ADD_EXACT_SOLD_EVIDENCE;
  }
  if (report.staleCount > 0 && !report.shadowValuationEligible) return RECOMMENDED_ACTION.ADD_RECENT_SALES;
  if (report.shadowValuationEligible) return RECOMMENDED_ACTION.READY_FOR_SHADOW_REVIEW;
  return RECOMMENDED_ACTION.MAINTAIN_COVERAGE;
}

function buildIdentityReport(canonicalCardKey, records = [], options = {}) {
  const targets = { ...DEFAULT_TARGETS, ...asObject(options.targets) };
  const asOf = normalizeDate(options.asOf) || new Date().toISOString();
  const staleDays = Number(options.staleDays || 365);
  const duplicates = duplicateRecordIds(records);
  const validations = records.map((record) => ({
    id: record.id,
    canonical: validateCanonicalRecord(record),
    pilot: validateRecordForPilot(record),
    identity: validateExactIdentity(record)
  }));
  const exactEligibleSoldRecords = records.filter(isExactEligibleSold);
  const staleRecords = exactEligibleSoldRecords.filter((record) => {
    const age = daysBetween(asOf, record.soldAt);
    return age !== null && age > staleDays;
  });
  const invalidOrIneligibleRecords = records.filter((record, index) => (
    !validations[index].canonical.valid || !validations[index].pilot.valid || isTransactionIneligible(record)
  ));
  const summary = {
    canonicalCardKey,
    normalizedIdentitySummary: identitySummary(records[0] || {}),
    totalRecordCount: records.length,
    exactEligibleSoldCount: exactEligibleSoldRecords.length,
    staleCount: staleRecords.length,
    invalidOrIneligibleCount: invalidOrIneligibleRecords.length,
    duplicateCount: duplicates.ids.size,
    sourceDistribution: distribution(records, (record) => record.marketplace || record.source?.marketplace || 'unknown'),
    adapterDistribution: distribution(records, (record) => record.source?.adapter || 'unknown'),
    priceRange: priceRange(exactEligibleSoldRecords),
    recencyRange: recencyRange(exactEligibleSoldRecords),
    reviewCompleteness: reviewCompleteness(records),
    evidenceDepthClassification: classifyEvidenceDepth(exactEligibleSoldRecords.length, targets),
    shadowValuationEligible: exactEligibleSoldRecords.length >= targets.shadowEligibleEvidencePerIdentity,
    validationResults: validations.map((entry) => ({
      id: entry.id,
      valid: entry.canonical.valid && entry.pilot.valid && entry.identity.valid,
      reasons: unique([
        ...asArray(entry.canonical.reasons),
        ...asArray(entry.pilot.reasons),
        ...asArray(entry.identity.reasons)
      ])
    })),
    duplicateGroups: duplicates.groups,
    staleRecordIds: staleRecords.map((record) => record.id),
    invalidOrIneligibleRecordIds: invalidOrIneligibleRecords.map((record) => record.id)
  };
  summary.blockingReasons = blockingReasonsForIdentity(summary);
  summary.recommendedNextAcquisitionAction = recommendedActionForIdentity(summary);
  summary.identityFingerprint = fingerprint({
    canonicalCardKey,
    totalRecordCount: summary.totalRecordCount,
    exactEligibleSoldCount: summary.exactEligibleSoldCount,
    staleCount: summary.staleCount,
    invalidOrIneligibleCount: summary.invalidOrIneligibleCount,
    duplicateCount: summary.duplicateCount,
    evidenceDepthClassification: summary.evidenceDepthClassification,
    shadowValuationEligible: summary.shadowValuationEligible,
    blockingReasons: summary.blockingReasons
  });
  return summary;
}

function groupByIdentity(records = []) {
  return asArray(records).reduce((groups, record) => {
    const key = identityKey(record);
    if (!groups[key]) groups[key] = [];
    groups[key].push(record);
    return groups;
  }, {});
}

function progress(actual, target) {
  return {
    actual,
    target,
    percent: target ? round(actual / target) : 0
  };
}

function sourceConcentration(records = []) {
  const sourceMix = distribution(records, (record) => record.marketplace || 'unknown');
  const top = Object.entries(sourceMix).sort((left, right) => right[1].share - left[1].share)[0] || ['unknown', { count: 0, share: 0 }];
  return {
    distribution: sourceMix,
    dominantSource: top[0],
    dominantSourceShare: top[1].share
  };
}

function buildDatasetOperationsReport(input = {}, options = {}) {
  const records = loadCanonicalDataset(input);
  const targets = { ...DEFAULT_TARGETS, ...asObject(options.targets) };
  const asOf = normalizeDate(options.asOf) || new Date().toISOString();
  const staleDays = Number(options.staleDays || 365);
  const identityGroups = groupByIdentity(records);
  const perIdentityReports = Object.fromEntries(Object.entries(identityGroups)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, identityRecords]) => [key, buildIdentityReport(key, identityRecords, { ...options, targets, asOf, staleDays })]));
  const identityReports = Object.values(perIdentityReports);
  const exactEligibleRecords = records.filter(isExactEligibleSold);
  const duplicates = duplicateRecordIds(records);
  const importValidation = buildImportValidationReport(records);
  const coverageReport = buildCoverageReport(records, {
    ...options,
    targets: {
      uniqueIdentities: targets.exactCanonicalIdentities,
      verifiedSoldRecords: targets.verifiedSoldRecords,
      minimumSoldRecordsPerIdentity: targets.minimumEvidencePerIdentity
    },
    asOf,
    staleDays
  });
  const biasReport = buildBiasReport(records, coverageReport, options);
  const staleCount = exactEligibleRecords.filter((record) => {
    const age = daysBetween(asOf, record.soldAt);
    return age !== null && age > staleDays;
  }).length;
  const invalidOrIneligibleCount = records.filter((record) => !validateRecordForPilot(record).valid || !validateCanonicalRecord(record).valid).length;
  const depthCounts = countBy(identityReports, (report) => report.evidenceDepthClassification);
  const shadowEligible = identityReports.filter((report) => report.shadowValuationEligible);
  const source = sourceConcentration(exactEligibleRecords);
  const review = reviewCompleteness(records);
  const majorCoverageGaps = identityReports
    .filter((report) => report.blockingReasons.length)
    .map((report) => ({
      canonicalCardKey: report.canonicalCardKey,
      evidenceDepthClassification: report.evidenceDepthClassification,
      blockingReasons: report.blockingReasons,
      recommendedNextAcquisitionAction: report.recommendedNextAcquisitionAction
    }));
  const recommendedAcquisitionPriorities = majorCoverageGaps
    .slice()
    .sort((left, right) => {
      const order = {
        [EVIDENCE_DEPTH.NO_ELIGIBLE_EVIDENCE]: 0,
        [EVIDENCE_DEPTH.THIN]: 1,
        [EVIDENCE_DEPTH.DEVELOPING]: 2,
        [EVIDENCE_DEPTH.SUFFICIENT_FOR_SHADOW_REVIEW]: 3,
        [EVIDENCE_DEPTH.DEEP]: 4
      };
      return order[left.evidenceDepthClassification] - order[right.evidenceDepthClassification]
        || left.canonicalCardKey.localeCompare(right.canonicalCardKey);
    })
    .slice(0, Number(options.priorityLimit || 25));
  const aggregate = {
    totalRecords: records.length,
    validExactSoldRecords: exactEligibleRecords.length,
    exactIdentityCount: identityReports.filter((report) => report.exactEligibleSoldCount > 0).length,
    progressToward100Identities: progress(identityReports.filter((report) => report.exactEligibleSoldCount > 0).length, targets.exactCanonicalIdentities),
    progressToward750VerifiedSoldRecords: progress(exactEligibleRecords.length, targets.verifiedSoldRecords),
    identitiesByEvidenceDepthClassification: depthCounts,
    identitiesEligibleForShadowValuation: shadowEligible.map((report) => report.canonicalCardKey),
    sourceConcentration: source,
    adapterDistribution: distribution(records, (record) => record.source?.adapter || 'unknown'),
    categoryBalance: distribution(records, (record) => record.parsedIdentity?.category || 'unknown'),
    gradeBalance: distribution(records, (record) => `${record.gradeCompany || 'unknown'}:${record.grade || 'unknown'}`),
    priceRangeDistribution: distribution(exactEligibleRecords, priceBucket),
    currencyDistribution: distribution(records, (record) => record.currency || 'unknown'),
    recencyDistribution: distribution(exactEligibleRecords, (record) => recencyBucket(record, asOf, staleDays)),
    reviewBacklog: review.incomplete,
    duplicateCount: duplicates.ids.size,
    duplicateGroupCount: duplicates.groups.length,
    invalidCount: invalidOrIneligibleCount,
    staleCount,
    ineligibleCount: importValidation.rejected,
    majorCoverageGaps,
    datasetBiasWarnings: unique([
      ...asArray(biasReport.warnings),
      source.dominantSourceShare > 0.6 ? 'source_concentration_high' : null,
      review.incomplete > 0 ? 'manual_review_backlog_present' : null
    ]),
    recommendedAcquisitionPriorities
  };
  const report = {
    source: SOURCE,
    version: DATASET_OPERATIONS_VERSION,
    generatedAt: options.generatedAt || new Date().toISOString(),
    asOf,
    targets,
    milestoneNotice: 'Calibration milestones only; this report does not imply production readiness or promotion.',
    perIdentityReports,
    aggregate,
    sourceReports: {
      coverageReport,
      biasReport,
      importValidation
    }
  };
  report.reportFingerprint = fingerprint({
    source: report.source,
    version: report.version,
    asOf: report.asOf,
    targets: report.targets,
    perIdentityReports: Object.fromEntries(Object.entries(perIdentityReports).map(([key, value]) => [
      key,
      value.identityFingerprint
    ])),
    aggregate: report.aggregate
  });
  return report;
}

module.exports = {
  DATASET_OPERATIONS_VERSION,
  DEFAULT_TARGETS,
  EVIDENCE_DEPTH,
  RECOMMENDED_ACTION,
  SOURCE,
  buildDatasetOperationsReport,
  buildIdentityReport,
  classifyEvidenceDepth,
  loadCanonicalDataset,
  stableStringify
};
