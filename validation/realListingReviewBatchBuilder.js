'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
  asArray,
  asObject,
  missingFields,
  unique
} = require('./canonicalValidationCore');
const {
  buildFingerprintFromProjection
} = require('./fingerprintProjection');
const {
  clone,
  firstDefined
} = require('./phase8GovernanceCore');
const reviewContract = require('./realListingDecisionReviewContract');

const REAL_LISTING_REVIEW_BATCH_SCHEMA_VERSION = '1.0.0';
const REAL_LISTING_REVIEW_BATCH_SOURCE = 'real_listing_review_batch_builder';
const DEFAULT_SELECTION_POLICY = 'learning_priority';
const DEFAULT_CANDIDATE_COUNT = 25;

const BATCH_CANDIDATE_CATEGORIES = Object.freeze([
  'production_shadow_disagreement',
  'identity_conflict',
  'valuation_conflict',
  'evidence_sufficiency_conflict',
  'confidence_conflict',
  'strong_evidence_rejected',
  'production_only_support',
  'shadow_only_support',
  'possible_false_positive',
  'possible_missed_opportunity',
  'buy_now_candidate',
  'notification_candidate',
  'learning_opportunity',
  'edge_case',
  'random_baseline'
]);

const CATEGORY_WEIGHTS = Object.freeze({
  production_shadow_disagreement: 100,
  possible_false_positive: 96,
  possible_missed_opportunity: 94,
  valuation_conflict: 90,
  identity_conflict: 88,
  evidence_sufficiency_conflict: 84,
  confidence_conflict: 80,
  strong_evidence_rejected: 78,
  production_only_support: 74,
  shadow_only_support: 72,
  buy_now_candidate: 68,
  notification_candidate: 62,
  edge_case: 58,
  learning_opportunity: 35,
  random_baseline: 25
});

const SELECTOR_CATEGORY_MAP = Object.freeze({
  production_vs_shadow_disagreement: 'production_shadow_disagreement',
  high_uncertainty: 'edge_case',
  weak_evidence: 'evidence_sufficiency_conflict',
  strong_evidence_rejected: 'strong_evidence_rejected',
  shadow_without_production_support: 'shadow_only_support',
  production_without_shadow_support: 'production_only_support',
  identity_conflict: 'identity_conflict',
  valuation_conflict: 'valuation_conflict',
  edge_case: 'edge_case',
  learning_opportunity: 'learning_opportunity'
});

const REQUIRED_BATCH_FIELDS = Object.freeze([
  'schemaVersion',
  'batchId',
  'createdAt',
  'source',
  'selectionPolicy',
  'requestedCandidateCount',
  'selectedCandidateCount',
  'packageCount',
  'reviewStatusSummary',
  'candidateCategorySummary',
  'productionImpact',
  'decisionImpact',
  'packages',
  'batchFingerprint'
]);

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}

function known(value) {
  return value !== undefined && value !== null && value !== '';
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeDate(value, fallback = 'not_provided') {
  if (!known(value)) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function normalizeRecords(recordsOrPayload = {}) {
  if (Array.isArray(recordsOrPayload)) return recordsOrPayload;
  const payload = asObject(recordsOrPayload);
  for (const key of ['records', 'listings', 'packages', 'items', 'results']) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  return [];
}

function getListing(record = {}) {
  return asObject(firstDefined(record.listingSnapshot, record.listing, record.productionListing, record.item, {}));
}

function getListingId(record = {}, index = 0) {
  const listing = getListing(record);
  return String(firstDefined(
    record.listingId,
    listing.ebayItemId,
    listing.marketplaceItemId,
    listing.itemId,
    listing.listingId,
    listing.id,
    `review-batch-listing-${index + 1}`
  ));
}

function getDealGate(record = {}) {
  return asObject(firstDefined(record.dealGateOutcome, record.dealGate, record.productionOutputs?.dealGateOutcome, record.productionOutputs?.dealGate, getListing(record).dealGate, {}));
}

function getProductionDecision(record = {}) {
  const gate = getDealGate(record);
  if (gate.passed === true || gate.buyNowAllowed === true || gate.decision === 'BUY_NOW') return 'supported';
  if (gate.passed === false || gate.buyNowAllowed === false) return 'rejected';
  return 'unknown';
}

function getShadowState(record = {}) {
  const shadow = asObject(firstDefined(record.shadowValuation, record.shadowOutputs?.shadowValuation, record.shadowSnapshot?.shadowValuation, {}));
  if (shadow.insufficientEvidence === true) return 'insufficient';
  if (Number.isFinite(Number(shadow.recommendedMarketValue ?? shadow.fairMarketRange?.expectedValue))) return 'supported';
  const posture = firstDefined(record.shadowRecommendationPosture, record.shadowOutputs?.shadowRecommendationPosture, record.shadowSnapshot?.shadowRecommendationPosture);
  return known(posture) ? String(posture).toLowerCase() : 'unknown';
}

function getProductionValue(record = {}) {
  const production = asObject(firstDefined(record.productionValuation, record.productionOutputs?.productionValuation, record.productionSnapshot?.valuation, {}));
  const value = production.estimatedValue ?? production.marketValue ?? record.estimatedValue ?? getListing(record).estimatedValue;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function getShadowValue(record = {}) {
  const shadow = asObject(firstDefined(record.shadowValuation, record.shadowOutputs?.shadowValuation, record.shadowSnapshot?.shadowValuation, {}));
  const value = shadow.recommendedMarketValue ?? shadow.fairMarketRange?.expectedValue;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function getExactSoldCount(record = {}) {
  const evidence = asObject(firstDefined(record.canonicalSoldEvidence, record.productionOutputs?.canonicalSoldEvidence, {}));
  const comparison = asObject(firstDefined(record.shadowSoldComparison, record.shadowOutputs?.shadowSoldComparison, {}));
  return Math.max(
    asArray(comparison.acceptedExactMatches).length,
    toNumber(comparison.processingSummary?.exactMatchCount, 0),
    toNumber(evidence.trueSoldCount, 0),
    toNumber(record.evidenceSummary?.trueSoldCount, 0)
  );
}

function mapSelectorCategories(candidate = {}) {
  return asArray(candidate.candidateCategories)
    .map((category) => SELECTOR_CATEGORY_MAP[category])
    .filter(Boolean);
}

function detectDirectCategories(record = {}) {
  const categories = [];
  const productionDecision = getProductionDecision(record);
  const shadowState = getShadowState(record);
  const productionValue = getProductionValue(record);
  const shadowValue = getShadowValue(record);
  const identityDiagnostics = asObject(firstDefined(record.identityDiagnostics, record.identityDiagnosticResult, record.identityParserDiagnostics, {}));
  const evidenceReadiness = asObject(firstDefined(record.evidenceReadinessDiagnostics, record.evidenceReadiness, {}));
  const confidence = asObject(firstDefined(record.confidenceCalibrationDiagnostics, record.confidenceCalibration, {}));
  const falsePositive = asObject(firstDefined(record.opportunityFalsePositiveDiagnostics, record.falsePositiveDiagnostics, {}));
  const dealGate = getDealGate(record);
  const notification = asObject(firstDefined(record.notificationEligibility, record.productionOutputs?.notificationEligibility, {}));
  const exactSoldCount = getExactSoldCount(record);

  if (productionDecision !== 'unknown' && shadowState !== 'unknown' && (
    (productionDecision === 'supported' && shadowState === 'insufficient') ||
    (productionDecision === 'rejected' && shadowState === 'supported') ||
    (productionDecision === 'supported' && !['supported', 'buy_now'].includes(shadowState))
  )) {
    categories.push('production_shadow_disagreement');
  }

  if (['ambiguous', 'unsupported', 'blocked', 'partial'].includes(identityDiagnostics.diagnosticStatus) || asArray(identityDiagnostics.fieldsConflicting).length > 0) {
    categories.push('identity_conflict');
  }
  if (productionValue !== null && shadowValue !== null && productionValue > 0 && Math.abs((shadowValue - productionValue) / productionValue) >= 0.25) {
    categories.push('valuation_conflict');
  }
  if (['thin', 'insufficient', 'blocked', 'unavailable'].includes(evidenceReadiness.readinessStatus)) {
    categories.push('evidence_sufficiency_conflict');
  }
  if (['overconfident', 'underconfident', 'under_review', 'insufficient_sample'].includes(confidence.calibrationStatus)) {
    categories.push('confidence_conflict');
  }
  if (productionDecision === 'rejected' && exactSoldCount >= 3 && shadowState === 'supported') {
    categories.push('strong_evidence_rejected');
  }
  if (productionDecision === 'supported' && ['insufficient', 'unknown'].includes(shadowState)) {
    categories.push('production_only_support');
  }
  if (productionDecision === 'rejected' && shadowState === 'supported') {
    categories.push('shadow_only_support');
    categories.push('possible_missed_opportunity');
  }
  if (['high_risk', 'likely_false_positive', 'elevated_risk'].includes(falsePositive.falsePositiveRiskStatus)) {
    categories.push('possible_false_positive');
  }
  if (dealGate.buyNowAllowed === true || dealGate.decision === 'BUY_NOW') categories.push('buy_now_candidate');
  if (notification.eligible === true) categories.push('notification_candidate');
  if (record.edgeCase === true || record.malformed === true) categories.push('edge_case');

  return unique(categories.filter((category) => BATCH_CANDIDATE_CATEGORIES.includes(category)));
}

function getCandidatePriority(categories = [], selectorCandidate = {}) {
  const selectorPriority = toNumber(selectorCandidate.learningPriority, 0);
  const categoryPriority = Math.max(...categories.map((category) => CATEGORY_WEIGHTS[category] || 0), CATEGORY_WEIGHTS.learning_opportunity);
  return Math.max(selectorPriority, categoryPriority);
}

function createCandidate(record = {}, index = 0, options = {}) {
  let selectorCandidate = {};
  if (options.useValidationCandidateSelector === true) {
    try {
      // Optional compatibility path only; default batch building uses supplied
      // diagnostics and does not load production engine-backed selectors.
      const validationCandidateSelector = require('./validationCandidateSelector');
      selectorCandidate = validationCandidateSelector.evaluateValidationCandidate(record, { ...options, index });
    } catch (_error) {
      selectorCandidate = {};
    }
  }

  const suppliedCategories = asArray(record.candidateCategories || record.validationCandidate?.candidateCategories)
    .filter((category) => BATCH_CANDIDATE_CATEGORIES.includes(category));
  const categories = unique([
    ...suppliedCategories,
    ...mapSelectorCategories(selectorCandidate),
    ...detectDirectCategories(record)
  ]);
  if (!categories.length && options.includeBaseline !== false) categories.push('learning_opportunity');
  if (options.includeRandomBaseline === true && !categories.includes('random_baseline')) categories.push('random_baseline');

  const primaryCategory = categories
    .slice()
    .sort((a, b) => (CATEGORY_WEIGHTS[b] || 0) - (CATEGORY_WEIGHTS[a] || 0) || a.localeCompare(b))[0] || 'learning_opportunity';
  const listingId = getListingId(record, index);

  return {
    candidateId: `${listingId}:${buildFingerprintFromProjection({ listingId, categories }).slice(0, 12)}`,
    listingId,
    candidateCategory: primaryCategory,
    candidateCategories: categories,
    learningPriority: getCandidatePriority(categories, selectorCandidate),
    reviewPriority: selectorCandidate.reviewPriority || (getCandidatePriority(categories, selectorCandidate) >= 80 ? 'high' : 'medium'),
    suggestedValidationFocus: unique([
      ...asArray(record.validationCandidate?.suggestedValidationFocus),
      ...asArray(selectorCandidate.suggestedValidationFocus),
      ...categories
    ]),
    sourceCandidate: clone(selectorCandidate || {})
  };
}

function selectReviewCandidates(records = [], options = {}) {
  const limit = Math.max(0, toNumber(options.requestedCandidateCount ?? options.limit, DEFAULT_CANDIDATE_COUNT));
  return asArray(records)
    .map((record, index) => ({
      index,
      record,
      candidate: createCandidate(record, index, options)
    }))
    .filter((entry) => entry.candidate.candidateCategories.length > 0)
    .sort((a, b) => (
      b.candidate.learningPriority - a.candidate.learningPriority ||
      a.candidate.candidateCategory.localeCompare(b.candidate.candidateCategory) ||
      a.candidate.listingId.localeCompare(b.candidate.listingId)
    ))
    .slice(0, limit);
}

function buildReviewPackageForCandidate(entry = {}, options = {}) {
  const candidate = entry.candidate || createCandidate(entry.record || {}, entry.index || 0, options);
  const record = entry.record || entry;
  return reviewContract.createRealListingDecisionReviewPackage({
    ...record,
    packageId: options.packageIdForCandidate ? options.packageIdForCandidate(candidate, record) : `${candidate.listingId}:real-listing-review`,
    reviewBatchId: options.batchId || record.reviewBatchId || 'real-listing-review-batch',
    createdAt: options.createdAt || record.createdAt || 'not_provided',
    validationCandidate: {
      ...(record.validationCandidate || {}),
      ...candidate,
      candidateCategories: candidate.candidateCategories,
      suggestedValidationFocus: candidate.suggestedValidationFocus
    },
    disagreementSnapshot: {
      ...(record.disagreementSnapshot || {}),
      suggestedValidationFocus: candidate.suggestedValidationFocus
    }
  }, {
    packageId: options.packageIdForCandidate ? options.packageIdForCandidate(candidate, record) : `${candidate.listingId}:real-listing-review`,
    reviewBatchId: options.batchId || record.reviewBatchId || 'real-listing-review-batch',
    createdAt: options.createdAt || record.createdAt || 'not_provided',
    capturedAt: record.capturedAt || options.capturedAt || 'not_provided'
  });
}

function sortReviewPackages(packages = []) {
  return asArray(packages)
    .slice()
    .sort((a, b) => (
      a.reviewStatus.localeCompare(b.reviewStatus) ||
      a.listingId.localeCompare(b.listingId) ||
      a.packageId.localeCompare(b.packageId) ||
      a.packageFingerprint.localeCompare(b.packageFingerprint)
    ));
}

function countBy(values = []) {
  return asArray(values).reduce((summary, value) => {
    const key = value || 'unknown';
    summary[key] = (summary[key] || 0) + 1;
    return summary;
  }, {});
}

function summarizeBatchComposition(batchOrPackages = {}) {
  const packages = Array.isArray(batchOrPackages) ? batchOrPackages : asArray(batchOrPackages.packages);
  const reviewStatusSummary = countBy(packages.map((reviewPackage) => reviewPackage.reviewStatus));
  const candidateCategorySummary = {};
  for (const reviewPackage of packages) {
    for (const category of asArray(reviewPackage.validationCandidate?.candidateCategories || reviewPackage.disagreementSnapshot?.suggestedValidationFocus)
      .filter((value) => BATCH_CANDIDATE_CATEGORIES.includes(value))) {
      candidateCategorySummary[category] = (candidateCategorySummary[category] || 0) + 1;
    }
  }
  return {
    reviewStatusSummary,
    candidateCategorySummary,
    packageCount: packages.length
  };
}

function buildReviewBatchFingerprint(batch = {}) {
  const projection = clone(batch);
  delete projection.batchFingerprint;
  return buildFingerprintFromProjection(projection);
}

function buildRealListingReviewBatch(recordsOrPackages = [], options = {}) {
  const inputRecords = normalizeRecords(recordsOrPackages);
  const selected = options.packages
    ? asArray(options.packages).map((reviewPackage) => ({ reviewPackage }))
    : selectReviewCandidates(inputRecords, options).map((entry) => ({
      candidate: entry.candidate,
      reviewPackage: buildReviewPackageForCandidate(entry, options)
    }));

  const packages = sortReviewPackages(selected.map((entry) => entry.reviewPackage || entry));
  const composition = summarizeBatchComposition(packages);
  const batchCore = {
    schemaVersion: REAL_LISTING_REVIEW_BATCH_SCHEMA_VERSION,
    batchId: options.batchId || 'real-listing-review-batch',
    createdAt: normalizeDate(options.createdAt || 'not_provided'),
    source: REAL_LISTING_REVIEW_BATCH_SOURCE,
    selectionPolicy: options.selectionPolicy || DEFAULT_SELECTION_POLICY,
    requestedCandidateCount: Math.max(0, toNumber(options.requestedCandidateCount ?? options.limit, DEFAULT_CANDIDATE_COUNT)),
    selectedCandidateCount: packages.length,
    packageCount: packages.length,
    reviewStatusSummary: composition.reviewStatusSummary,
    candidateCategorySummary: composition.candidateCategorySummary,
    productionImpact: 'none',
    decisionImpact: 'none',
    packages
  };

  return deepFreeze({
    ...batchCore,
    batchFingerprint: buildReviewBatchFingerprint(batchCore)
  });
}

function findDuplicates(values = []) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of asArray(values)) {
    if (!known(value)) continue;
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].sort();
}

function uniqueIndexes(indexes = []) {
  return [...new Set(asArray(indexes).filter((value) => Number.isInteger(value)))].sort((a, b) => a - b);
}

function validateRealListingReviewBatch(batch = {}) {
  const errors = [];
  const warnings = [];
  const reasonCodes = [];
  const invalidPackageIndexes = [];

  for (const field of missingFields(batch, REQUIRED_BATCH_FIELDS)) {
    errors.push({ code: 'missing_required_field', message: `${field} is required.`, path: field });
    reasonCodes.push(`missing_${field}`);
  }

  if (batch.schemaVersion !== REAL_LISTING_REVIEW_BATCH_SCHEMA_VERSION) {
    errors.push({ code: 'invalid_schema_version', message: 'schemaVersion must match Real Listing Review Batch schema.', path: 'schemaVersion' });
    reasonCodes.push('invalid_schema_version');
  }
  if (batch.source !== REAL_LISTING_REVIEW_BATCH_SOURCE) {
    errors.push({ code: 'invalid_source', message: 'source must be real_listing_review_batch_builder.', path: 'source' });
    reasonCodes.push('invalid_source');
  }
  if (batch.productionImpact !== 'none') {
    errors.push({ code: 'invalid_production_impact', message: 'productionImpact must remain none.', path: 'productionImpact' });
    reasonCodes.push('invalid_production_impact');
  }
  if (batch.decisionImpact !== 'none') {
    errors.push({ code: 'invalid_decision_impact', message: 'decisionImpact must remain none.', path: 'decisionImpact' });
    reasonCodes.push('invalid_decision_impact');
  }

  const packages = asArray(batch.packages);
  packages.forEach((reviewPackage, index) => {
    const validation = reviewContract.validateRealListingDecisionReviewPackage(reviewPackage);
    if (!validation.valid) {
      invalidPackageIndexes.push(index);
      validation.failures.forEach((failure) => {
        errors.push({ ...failure, path: `packages.${index}.${failure.path}` });
        reasonCodes.push(failure.code);
      });
    }
    if (reviewPackage.productionImpact !== 'none') reasonCodes.push('package_invalid_production_impact');
    if (reviewPackage.decisionImpact !== 'none') reasonCodes.push('package_invalid_decision_impact');
  });

  const duplicatePackageIds = findDuplicates(packages.map((reviewPackage) => reviewPackage.packageId));
  const duplicateSnapshotFingerprints = findDuplicates(packages.map((reviewPackage) => reviewPackage.snapshotFingerprint));
  if (duplicatePackageIds.length) {
    errors.push({ code: 'duplicate_package_ids', message: 'Duplicate package IDs detected.', path: 'packages' });
    reasonCodes.push('duplicate_package_ids');
  }
  if (duplicateSnapshotFingerprints.length) {
    warnings.push({ code: 'duplicate_snapshot_fingerprints', message: 'Duplicate snapshot fingerprints detected.', path: 'packages' });
    reasonCodes.push('duplicate_snapshot_fingerprints');
  }
  if (batch.batchFingerprint && buildReviewBatchFingerprint(batch) !== batch.batchFingerprint) {
    errors.push({ code: 'batch_fingerprint_mismatch', message: 'batchFingerprint does not match batch contents.', path: 'batchFingerprint' });
    reasonCodes.push('batch_fingerprint_mismatch');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes: unique(reasonCodes),
    invalidPackageIndexes: uniqueIndexes(invalidPackageIndexes),
    duplicatePackageIds,
    duplicateSnapshotFingerprints
  };
}

function filterReviewPackages(batchOrPackages = {}, filters = {}) {
  const packages = Array.isArray(batchOrPackages) ? batchOrPackages : asArray(batchOrPackages.packages);
  return packages.filter((reviewPackage) => {
    if (filters.reviewStatus && reviewPackage.reviewStatus !== filters.reviewStatus) return false;
    if (filters.candidateCategory) {
      const categories = asArray(reviewPackage.validationCandidate?.candidateCategories || reviewPackage.disagreementSnapshot?.suggestedValidationFocus);
      if (!categories.includes(filters.candidateCategory)) return false;
    }
    return true;
  });
}

function exportRealListingReviewBatch(batch = {}) {
  return `${JSON.stringify(batch, null, 2)}\n`;
}

function writeRealListingReviewBatch(batch = {}, outputPath) {
  if (!outputPath) return exportRealListingReviewBatch(batch);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, exportRealListingReviewBatch(batch));
  return batch;
}

function importRealListingReviewBatch(input) {
  const parsed = typeof input === 'string'
    ? JSON.parse(fs.existsSync(input) ? fs.readFileSync(input, 'utf8') : input)
    : clone(input);
  return {
    batch: parsed,
    validation: validateRealListingReviewBatch(parsed)
  };
}

module.exports = {
  BATCH_CANDIDATE_CATEGORIES,
  DEFAULT_CANDIDATE_COUNT,
  DEFAULT_SELECTION_POLICY,
  REAL_LISTING_REVIEW_BATCH_SCHEMA_VERSION,
  REAL_LISTING_REVIEW_BATCH_SOURCE,
  REQUIRED_BATCH_FIELDS,
  buildRealListingReviewBatch,
  buildReviewBatchFingerprint,
  buildReviewPackageForCandidate,
  exportRealListingReviewBatch,
  filterReviewPackages,
  importRealListingReviewBatch,
  selectReviewCandidates,
  sortReviewPackages,
  summarizeBatchComposition,
  validateRealListingReviewBatch,
  writeRealListingReviewBatch
};
