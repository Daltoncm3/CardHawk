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
const calibrationDatasetBuilder = require('./calibrationDatasetBuilder');
const recommendationContract = require('./calibrationRecommendationContract');

const CALIBRATION_RECOMMENDATION_BUILDER_SCHEMA_VERSION = '1.0.0';
const CALIBRATION_RECOMMENDATION_BUILDER_SOURCE = 'calibration_recommendation_builder';
const UNKNOWN_VALUE = 'unknown';

const DEFAULT_EVIDENCE_GATES = Object.freeze({
  minimumReviewedRecords: 30,
  minimumEligibleRecords: 10,
  minimumReviewConfidence: 70,
  maximumSingleIdentityShare: 0.6,
  maximumUnknownReviewConfidenceShare: 0.35
});

const CATEGORY_ALIASES = Object.freeze({
  grading_quality_adjustment: 'grading_or_quality_adjustment',
  insufficient_data: 'insufficient_data_finding',
  no_change: 'no_change_recommendation'
});

const BUILDER_CATEGORIES = Object.freeze([
  ...recommendationContract.RECOMMENDATION_CATEGORIES,
  ...Object.keys(CATEGORY_ALIASES)
]);

const REQUIRED_BATCH_FIELDS = Object.freeze([
  'schemaVersion',
  'source',
  'recommendationBatchId',
  'createdAt',
  'sourceDatasetIds',
  'sourceDatasetFingerprints',
  'datasetCount',
  'findingCount',
  'recommendationCount',
  'recommendationStatusSummary',
  'recommendationCategorySummary',
  'affectedSubsystemSummary',
  'evidenceStrengthSummary',
  'insufficientEvidenceCount',
  'noChangeCount',
  'productionImpact',
  'decisionImpact',
  'recommendations',
  'findings',
  'batchFingerprint'
]);

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}

function known(value) {
  return value !== undefined && value !== null && value !== '' && value !== UNKNOWN_VALUE;
}

function normalizeDate(value, fallback = UNKNOWN_VALUE) {
  if (!known(value)) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function normalizeCategory(category = UNKNOWN_VALUE) {
  const normalized = String(category || UNKNOWN_VALUE).trim().toLowerCase();
  return CATEGORY_ALIASES[normalized] || normalized;
}

function stableString(value) {
  return String(value || UNKNOWN_VALUE);
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function percent(count, total) {
  if (!total) return 0;
  return Number(((count / total) * 100).toFixed(1));
}

function average(values = []) {
  const usable = asArray(values).map(Number).filter(Number.isFinite);
  if (!usable.length) return UNKNOWN_VALUE;
  return Number((usable.reduce((sum, value) => sum + value, 0) / usable.length).toFixed(2));
}

function countBy(values = []) {
  return asArray(values).reduce((summary, value) => {
    const key = value || UNKNOWN_VALUE;
    summary[key] = (summary[key] || 0) + 1;
    return summary;
  }, {});
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

function sortRecords(records = []) {
  return asArray(records).slice().sort((a, b) => (
    stableString(a.sourceBatchId).localeCompare(stableString(b.sourceBatchId)) ||
    stableString(a.listingId).localeCompare(stableString(b.listingId)) ||
    stableString(a.packageId).localeCompare(stableString(b.packageId)) ||
    stableString(a.reviewFingerprint).localeCompare(stableString(b.reviewFingerprint)) ||
    stableString(a.recordFingerprint).localeCompare(stableString(b.recordFingerprint))
  ));
}

function sortCalibrationDatasets(datasets = []) {
  return asArray(datasets).slice().sort((a, b) => (
    stableString(a.datasetId).localeCompare(stableString(b.datasetId)) ||
    stableString(a.datasetFingerprint).localeCompare(stableString(b.datasetFingerprint))
  ));
}

function sortCalibrationRecommendations(recommendations = []) {
  return asArray(recommendations).slice().sort((a, b) => (
    stableString(a.recommendationStatus).localeCompare(stableString(b.recommendationStatus)) ||
    stableString(a.recommendationCategory).localeCompare(stableString(b.recommendationCategory)) ||
    stableString(a.affectedSubsystem).localeCompare(stableString(b.affectedSubsystem)) ||
    stableString(a.recommendationId).localeCompare(stableString(b.recommendationId)) ||
    stableString(a.recommendationFingerprint).localeCompare(stableString(b.recommendationFingerprint))
  ));
}

function buildFindingFingerprint(finding = {}) {
  const projection = clone(finding);
  delete projection.findingFingerprint;
  return buildFingerprintFromProjection(projection);
}

function buildCalibrationRecommendationBatchFingerprint(batch = {}) {
  const projection = clone(batch);
  delete projection.batchFingerprint;
  return buildFingerprintFromProjection(projection);
}

function getDatasetInputs(datasetInputs = []) {
  return Array.isArray(datasetInputs) ? datasetInputs : [datasetInputs];
}

function normalizeDatasetInput(input) {
  const object = typeof input === 'string'
    ? calibrationDatasetBuilder.importCalibrationDataset(input).dataset
    : clone(input);
  return object;
}

function getSourceDatasetIds(datasets = []) {
  return unique(sortCalibrationDatasets(datasets).map((dataset) => dataset.datasetId)).sort();
}

function getSourceDatasetFingerprints(datasets = []) {
  return unique(sortCalibrationDatasets(datasets).map((dataset) => dataset.datasetFingerprint)).sort();
}

function getIdentityKey(record = {}) {
  return stableString(
    record.listingIdentity?.identitySnapshot?.canonicalIdentitySummary?.canonicalIdentityKey ||
      record.listingIdentity?.identitySnapshot?.canonicalIdentitySummary?.identityKey ||
      record.listingIdentity?.identitySnapshot?.canonicalIdentitySummary?.canonicalCardKey ||
      record.listingIdentity?.identitySnapshot?.identityFingerprint ||
      record.listingId
  );
}

function getProductKey(record = {}) {
  const listing = asObject(record.listingIdentity?.listingSnapshot);
  const parsed = asObject(listing.parsed);
  const canonical = asObject(record.listingIdentity?.identitySnapshot?.canonicalIdentitySummary);
  return stableString(firstDefined(
    canonical.setName,
    canonical.product,
    parsed.setName,
    parsed.set,
    listing.setName,
    listing.product
  ));
}

function getGradingCompany(record = {}) {
  const listing = asObject(record.listingIdentity?.listingSnapshot);
  const parsed = asObject(listing.parsed);
  const canonical = asObject(record.listingIdentity?.identitySnapshot?.canonicalIdentitySummary);
  return stableString(firstDefined(
    canonical.gradeCompany,
    canonical.gradingCompany,
    parsed.gradeCompany,
    parsed.gradingCompany,
    listing.gradeCompany,
    listing.gradingCompany
  )).toUpperCase();
}

function getSportOrCategory(record = {}) {
  const listing = asObject(record.listingIdentity?.listingSnapshot);
  const parsed = asObject(listing.parsed);
  const canonical = asObject(record.listingIdentity?.identitySnapshot?.canonicalIdentitySummary);
  return stableString(firstDefined(
    canonical.category,
    canonical.sport,
    parsed.category,
    parsed.sport,
    listing.category,
    listing.sport
  ));
}

function getCardType(record = {}) {
  const listing = asObject(record.listingIdentity?.listingSnapshot);
  const parsed = asObject(listing.parsed);
  const flags = asObject(parsed.flags);
  const types = [];
  if (flags.autograph || parsed.autograph || listing.autograph) types.push('autograph');
  if (flags.relic || parsed.relic || listing.relic) types.push('relic');
  if (flags.numbered || parsed.numbered || listing.numbered) types.push('numbered');
  if (flags.lot || parsed.lot || listing.lot) types.push('lot');
  if (flags.reprint || parsed.reprint || listing.reprint) types.push('reprint');
  if (flags.graded || parsed.grade || parsed.gradeCompany || listing.grade) types.push('graded');
  if (!types.length) types.push('unknown');
  return types.sort().join('+');
}

function summarizeCoverage(records = []) {
  const sorted = sortRecords(records);
  return {
    marketplace: countBy(sorted.map((record) => record.marketplace)),
    sportsOrCategories: countBy(sorted.map(getSportOrCategory)),
    products: countBy(sorted.map(getProductKey)),
    gradingCompanies: countBy(sorted.map(getGradingCompany)),
    cardTypes: countBy(sorted.map(getCardType)),
    identities: countBy(sorted.map(getIdentityKey)),
    listingCount: unique(sorted.map((record) => record.listingId)).length,
    recordCount: sorted.length
  };
}

function summarizeDuplicates(records = []) {
  return {
    duplicateListingIds: findDuplicates(records.map((record) => record.listingId)),
    duplicateReviewFingerprints: findDuplicates(records.map((record) => record.reviewFingerprint)),
    duplicateRecordFingerprints: findDuplicates(records.map((record) => record.recordFingerprint))
  };
}

function summarizeCorrelatedRecords(records = []) {
  const identityCounts = countBy(records.map(getIdentityKey));
  const sorted = Object.entries(identityCounts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const topIdentity = sorted[0] || [UNKNOWN_VALUE, 0];
  return {
    repeatedIdentityCount: sorted.filter(([, count]) => count > 1).length,
    topIdentityKey: topIdentity[0],
    topIdentityCount: topIdentity[1],
    topIdentityShare: records.length ? Number((topIdentity[1] / records.length).toFixed(3)) : 0
  };
}

function summarizeReviewConfidence(records = []) {
  const values = records.map((record) => record.daltonReview?.reviewConfidence);
  const knownValues = values.map(Number).filter(Number.isFinite);
  return {
    average: average(knownValues),
    knownCount: knownValues.length,
    unknownCount: records.length - knownValues.length,
    unknownShare: records.length ? Number(((records.length - knownValues.length) / records.length).toFixed(3)) : 0
  };
}

function summarizeClassBalance(records = []) {
  return {
    productionCorrect: countBy(records.map((record) => record.daltonReview?.productionCorrect)),
    shadowBetter: countBy(records.map((record) => record.daltonReview?.shadowBetter)),
    wouldBuy: countBy(records.map((record) => record.daltonReview?.wouldBuy)),
    buyNowQuality: countBy(records.map((record) => record.daltonReview?.buyNowQuality)),
    dealGateQuality: countBy(records.map((record) => record.daltonReview?.dealGateQuality))
  };
}

function recordMatchesCategory(record = {}, category) {
  const review = asObject(record.daltonReview);
  const reasons = asArray(review.reasonCategories);
  const disagreements = asArray(review.disagreementCategories);
  const focus = asArray(record.disagreementSummary?.suggestedValidationFocus);
  switch (normalizeCategory(category)) {
    case 'identity_parsing_improvement':
      return review.identityCorrect === 'no' || review.identityCorrect === 'partial' ||
        reasons.includes('identity_error') || disagreements.includes('identity_disagreement') ||
        focus.includes('identity_conflict');
    case 'canonical_identity_improvement':
      return disagreements.includes('identity_disagreement') || focus.includes('identity_conflict');
    case 'evidence_sufficiency_adjustment':
      return review.evidenceSufficient === 'no' || review.evidenceSufficient === 'partial' ||
        reasons.includes('weak_evidence') || reasons.includes('active_only_evidence') ||
        disagreements.includes('evidence_sufficiency_disagreement');
    case 'valuation_methodology_adjustment':
      return review.valuationReasonable === 'no' || review.valuationReasonable === 'partial' ||
        reasons.includes('valuation_too_high') || reasons.includes('valuation_too_low') ||
        disagreements.includes('valuation_disagreement') || focus.includes('valuation_conflict');
    case 'confidence_calibration_adjustment':
      return ['no', 'overconfident', 'underconfident'].includes(review.confidenceAppropriate) ||
        reasons.includes('confidence_too_high') || reasons.includes('confidence_too_low') ||
        disagreements.includes('confidence_disagreement') || focus.includes('confidence_conflict');
    case 'risk_rule_adjustment':
      return reasons.includes('seller_or_listing_risk') || reasons.includes('price_suspicious') ||
        disagreements.includes('false_positive_risk');
    case 'grading_or_quality_adjustment':
      return reasons.includes('grading_risk') || reasons.includes('listing_quality_risk') ||
        disagreements.includes('grading_or_quality_disagreement');
    case 'deal_gate_rule_review':
      return ['too_strict', 'too_loose', 'wrong_reason'].includes(review.dealGateQuality) ||
        reasons.includes('deal_gate_too_strict') || reasons.includes('deal_gate_too_loose') ||
        disagreements.includes('deal_gate_disagreement');
    case 'buy_now_threshold_review':
      return ['false_positive', 'missed_opportunity', 'too_aggressive', 'too_conservative'].includes(review.buyNowQuality) ||
        reasons.includes('buy_now_false_positive') || disagreements.includes('buy_now_disagreement');
    case 'notification_threshold_review':
      return reasons.includes('notification_should_have_sent') || reasons.includes('notification_should_not_have_sent') ||
        disagreements.includes('notification_disagreement');
    case 'false_positive_reduction':
      return review.buyNowQuality === 'false_positive' || review.wouldBuy === 'no' ||
        reasons.includes('buy_now_false_positive') || focus.includes('possible_false_positive');
    case 'missed_opportunity_reduction':
      return review.buyNowQuality === 'missed_opportunity' || reasons.includes('missed_opportunity') ||
        focus.includes('possible_missed_opportunity');
    case 'diagnostic_improvement':
      return reasons.includes('explanation_issue') || reasons.includes('unknown_or_insufficient_context');
    default:
      return false;
  }
}

function classifyRecommendationCategory(recordOrFinding = {}) {
  if (recordOrFinding.findingCategory) return normalizeCategory(recordOrFinding.findingCategory);
  for (const category of recommendationContract.RECOMMENDATION_CATEGORIES) {
    if (['insufficient_data_finding', 'no_change_recommendation'].includes(category)) continue;
    if (recordMatchesCategory(recordOrFinding, category)) return category;
  }
  const review = asObject(recordOrFinding.daltonReview);
  if (
    review.productionCorrect === 'yes' &&
    review.evidenceSufficient === 'yes' &&
    review.valuationReasonable === 'yes' &&
    review.confidenceAppropriate === 'yes' &&
    review.buyNowQuality === 'correct' &&
    review.dealGateQuality === 'correct'
  ) {
    return 'no_change_recommendation';
  }
  return 'insufficient_data_finding';
}

function determineAffectedSubsystem(category) {
  switch (normalizeCategory(category)) {
    case 'identity_parsing_improvement':
      return 'parser';
    case 'canonical_identity_improvement':
      return 'canonical_identity';
    case 'evidence_sufficiency_adjustment':
      return 'evidence_readiness';
    case 'valuation_methodology_adjustment':
      return 'valuation';
    case 'confidence_calibration_adjustment':
      return 'confidence';
    case 'risk_rule_adjustment':
      return 'risk';
    case 'grading_or_quality_adjustment':
      return 'grading_quality';
    case 'deal_gate_rule_review':
      return 'deal_gate';
    case 'buy_now_threshold_review':
      return 'buy_now';
    case 'notification_threshold_review':
      return 'notification';
    case 'false_positive_reduction':
      return 'opportunity_false_positive';
    case 'missed_opportunity_reduction':
      return 'opportunity_detection';
    case 'diagnostic_improvement':
      return 'diagnostics';
    case 'no_change_recommendation':
      return 'governance';
    default:
      return 'evidence_governance';
  }
}

function getAffectedRuleOrField(category) {
  switch (normalizeCategory(category)) {
    case 'confidence_calibration_adjustment':
      return 'reported_confidence_alignment';
    case 'deal_gate_rule_review':
      return 'deal_gate_reviewed_outcome_alignment';
    case 'buy_now_threshold_review':
      return 'buy_now_reviewed_outcome_alignment';
    case 'false_positive_reduction':
      return 'buy_now_false_positive_review';
    case 'missed_opportunity_reduction':
      return 'rejected_listing_missed_opportunity_review';
    case 'no_change_recommendation':
      return 'current_behavior_observed_support';
    default:
      return `${determineAffectedSubsystem(category)}_reviewed_evidence`;
  }
}

function getDatasetRecords(datasets = []) {
  return sortRecords(sortCalibrationDatasets(datasets).flatMap((dataset) => asArray(dataset.records).map((record) => ({
    ...clone(record),
    sourceDatasetId: dataset.datasetId,
    sourceDatasetFingerprint: dataset.datasetFingerprint
  }))));
}

function buildFindingCore(category, records, datasets, options = {}) {
  const sortedRecords = sortRecords(records);
  const sourceDatasetIds = getSourceDatasetIds(datasets);
  const sourceRecordFingerprints = unique(sortedRecords.map((record) => record.recordFingerprint)).sort();
  const duplicateSummary = summarizeDuplicates(sortedRecords);
  const correlatedRecordSummary = summarizeCorrelatedRecords(sortedRecords);
  const reviewConfidenceSummary = summarizeReviewConfidence(sortedRecords);
  const classBalance = summarizeClassBalance(sortedRecords);
  const coverage = summarizeCoverage(sortedRecords);
  const limitations = [];
  if (duplicateSummary.duplicateListingIds.length) limitations.push('duplicate_listing_ids_present');
  if (duplicateSummary.duplicateReviewFingerprints.length) limitations.push('duplicate_review_fingerprints_present');
  if (correlatedRecordSummary.topIdentityShare > (options.evidenceGates?.maximumSingleIdentityShare ?? DEFAULT_EVIDENCE_GATES.maximumSingleIdentityShare)) limitations.push('repeated_identity_dominates_sample');
  if (reviewConfidenceSummary.unknownShare > (options.evidenceGates?.maximumUnknownReviewConfidenceShare ?? DEFAULT_EVIDENCE_GATES.maximumUnknownReviewConfidenceShare)) limitations.push('review_confidence_sparse');
  const conflictSummary = detectConflictSummary(options.conflictRecords || sortedRecords, category);
  limitations.push(...conflictSummary.limitations);

  const findingBase = {
    findingId: `${normalizeCategory(category)}:${buildFingerprintFromProjection({ category: normalizeCategory(category), sourceRecordFingerprints }).slice(0, 12)}`,
    findingCategory: normalizeCategory(category),
    sourceDatasetIds,
    sourceRecordFingerprints,
    affectedSubsystem: determineAffectedSubsystem(category),
    affectedRuleOrField: getAffectedRuleOrField(category),
    observedBehavior: summarizeObservedBehavior(sortedRecords, category),
    reviewOutcome: summarizeReviewOutcome(sortedRecords),
    productionAgreement: classBalance.productionCorrect,
    shadowAgreement: classBalance.shadowBetter,
    sampleSize: {
      totalReviewedRecords: getDatasetRecords(datasets).length,
      categoryRecords: sortedRecords.length,
      sourceDatasetCount: sourceDatasetIds.length
    },
    eligibleSampleSize: sortedRecords.length,
    coverage,
    classBalance,
    duplicateSummary,
    correlatedRecordSummary,
    reviewConfidenceSummary,
    counterEvidence: conflictSummary.counterEvidence,
    limitations: unique(limitations).sort(),
    evidenceStrength: 'unknown',
    evidenceStatus: 'unknown'
  };

  const evaluated = evaluateRecommendationEvidence(findingBase, datasets, options);
  const finding = {
    ...findingBase,
    evidenceStrength: evaluated.evidenceStrength,
    evidenceStatus: evaluated.evidenceStatus
  };

  return deepFreeze({
    ...finding,
    findingFingerprint: buildFindingFingerprint(finding)
  });
}

function summarizeObservedBehavior(records = [], category) {
  return {
    category: normalizeCategory(category),
    reviewedRecordCount: records.length,
    sourceRecordFingerprints: unique(records.map((record) => record.recordFingerprint)).sort(),
    productionOutputsPreserved: true,
    shadowOutputsPreserved: true,
    recomputedProductionOutputs: false,
    recomputedShadowOutputs: false
  };
}

function summarizeReviewOutcome(records = []) {
  return {
    identityCorrect: countBy(records.map((record) => record.daltonReview?.identityCorrect)),
    evidenceSufficient: countBy(records.map((record) => record.daltonReview?.evidenceSufficient)),
    valuationReasonable: countBy(records.map((record) => record.daltonReview?.valuationReasonable)),
    confidenceAppropriate: countBy(records.map((record) => record.daltonReview?.confidenceAppropriate)),
    productionCorrect: countBy(records.map((record) => record.daltonReview?.productionCorrect)),
    shadowBetter: countBy(records.map((record) => record.daltonReview?.shadowBetter)),
    wouldBuy: countBy(records.map((record) => record.daltonReview?.wouldBuy)),
    buyNowQuality: countBy(records.map((record) => record.daltonReview?.buyNowQuality)),
    dealGateQuality: countBy(records.map((record) => record.daltonReview?.dealGateQuality))
  };
}

function detectConflictSummary(records = [], category = UNKNOWN_VALUE) {
  const reviewOutcome = summarizeReviewOutcome(records);
  const counterEvidence = [];
  const limitations = [];
  const falsePositiveCount = toNumber(reviewOutcome.buyNowQuality.false_positive) + records.filter((record) => asArray(record.daltonReview?.reasonCategories).includes('buy_now_false_positive')).length;
  const missedOpportunityCount = toNumber(reviewOutcome.buyNowQuality.missed_opportunity) + records.filter((record) => asArray(record.daltonReview?.reasonCategories).includes('missed_opportunity')).length;
  if (falsePositiveCount > 0 && missedOpportunityCount > 0) {
    counterEvidence.push({
      conflictType: 'false_positive_vs_missed_opportunity',
      falsePositiveCount,
      missedOpportunityCount
    });
    limitations.push('false_positive_and_missed_opportunity_tradeoff');
  }
  if (toNumber(reviewOutcome.productionCorrect.yes) > 0 && toNumber(reviewOutcome.shadowBetter.yes) > 0) {
    counterEvidence.push({
      conflictType: 'production_agreement_vs_shadow_agreement',
      productionCorrectCount: toNumber(reviewOutcome.productionCorrect.yes),
      shadowBetterCount: toNumber(reviewOutcome.shadowBetter.yes)
    });
    limitations.push('production_and_shadow_both_have_support');
  }
  if (['deal_gate_rule_review', 'buy_now_threshold_review'].includes(normalizeCategory(category)) &&
      toNumber(reviewOutcome.dealGateQuality.correct) > 0 &&
      toNumber(reviewOutcome.buyNowQuality.false_positive) > 0) {
    counterEvidence.push({
      conflictType: 'deal_gate_quality_vs_buy_now_quality',
      dealGateCorrectCount: toNumber(reviewOutcome.dealGateQuality.correct),
      buyNowFalsePositiveCount: toNumber(reviewOutcome.buyNowQuality.false_positive)
    });
    limitations.push('deal_gate_and_buy_now_quality_diverge');
  }
  return {
    counterEvidence,
    limitations
  };
}

function buildCalibrationFindings(datasetInputs = [], options = {}) {
  const datasets = sortCalibrationDatasets(getDatasetInputs(datasetInputs).map(normalizeDatasetInput));
  const allRecords = getDatasetRecords(datasets);
  const findings = [];

  for (const category of recommendationContract.RECOMMENDATION_CATEGORIES) {
    if (['insufficient_data_finding', 'no_change_recommendation'].includes(category)) continue;
    const records = allRecords.filter((record) => recordMatchesCategory(record, category));
    if (records.length) findings.push(buildFindingCore(category, records, datasets, { ...options, conflictRecords: allRecords }));
  }

  if (!findings.length && allRecords.length) {
    const stableRecords = allRecords.filter((record) => classifyRecommendationCategory(record) === 'no_change_recommendation');
    findings.push(buildFindingCore('no_change_recommendation', stableRecords.length ? stableRecords : allRecords, datasets, { ...options, conflictRecords: allRecords }));
  }

  if (!allRecords.length || allRecords.length < (options.evidenceGates?.minimumReviewedRecords ?? DEFAULT_EVIDENCE_GATES.minimumReviewedRecords)) {
    findings.push(buildFindingCore('insufficient_data_finding', allRecords, datasets, { ...options, conflictRecords: allRecords }));
  }

  return deepFreeze(sortFindings(uniqueByFingerprint(findings)));
}

function uniqueByFingerprint(findings = []) {
  const map = new Map();
  for (const finding of findings) {
    if (!map.has(finding.findingFingerprint)) map.set(finding.findingFingerprint, finding);
  }
  return [...map.values()];
}

function sortFindings(findings = []) {
  return asArray(findings).slice().sort((a, b) => (
    stableString(a.evidenceStatus).localeCompare(stableString(b.evidenceStatus)) ||
    stableString(a.findingCategory).localeCompare(stableString(b.findingCategory)) ||
    stableString(a.affectedSubsystem).localeCompare(stableString(b.affectedSubsystem)) ||
    stableString(a.findingId).localeCompare(stableString(b.findingId))
  ));
}

function evaluateRecommendationEvidence(finding = {}, datasets = [], options = {}) {
  const gates = {
    ...DEFAULT_EVIDENCE_GATES,
    ...asObject(options.evidenceGates)
  };
  const totalReviewed = toNumber(finding.sampleSize?.totalReviewedRecords, getDatasetRecords(datasets).length);
  const eligible = toNumber(finding.eligibleSampleSize, 0);
  const averageReviewConfidence = finding.reviewConfidenceSummary?.average;
  const duplicateCount = asArray(finding.duplicateSummary?.duplicateListingIds).length +
    asArray(finding.duplicateSummary?.duplicateReviewFingerprints).length +
    asArray(finding.duplicateSummary?.duplicateRecordFingerprints).length;
  const limitations = asArray(finding.limitations);
  const counterEvidence = asArray(finding.counterEvidence);

  if (totalReviewed === 0) {
    return {
      evidenceStatus: 'insufficient_evidence',
      evidenceStrength: 'insufficient',
      posture: 'insufficient_evidence',
      blockingReasons: ['no_reviewed_records']
    };
  }
  if (duplicateCount > 0 || limitations.some((value) => value.includes('tradeoff') || value.includes('diverge'))) {
    return {
      evidenceStatus: 'manual_investigation_required',
      evidenceStrength: eligible >= gates.minimumEligibleRecords ? 'limited' : 'weak',
      posture: 'manual_investigation_required',
      blockingReasons: ['conflicting_or_duplicate_review_evidence']
    };
  }
  if (totalReviewed < gates.minimumReviewedRecords || eligible < gates.minimumEligibleRecords) {
    return {
      evidenceStatus: totalReviewed < gates.minimumReviewedRecords ? 'insufficient_evidence' : 'continue_observation',
      evidenceStrength: 'insufficient',
      posture: totalReviewed < gates.minimumReviewedRecords ? 'insufficient_evidence' : 'continue_observation',
      blockingReasons: [
        totalReviewed < gates.minimumReviewedRecords ? 'minimum_reviewed_records_not_met' : null,
        eligible < gates.minimumEligibleRecords ? 'minimum_category_sample_not_met' : null
      ].filter(Boolean)
    };
  }
  if (Number.isFinite(Number(averageReviewConfidence)) && Number(averageReviewConfidence) < gates.minimumReviewConfidence) {
    return {
      evidenceStatus: 'continue_observation',
      evidenceStrength: 'limited',
      posture: 'continue_observation',
      blockingReasons: ['review_confidence_below_recommendation_gate']
    };
  }
  if (counterEvidence.length || limitations.length) {
    return {
      evidenceStatus: 'candidate_with_counterevidence',
      evidenceStrength: 'limited',
      posture: 'manual_investigation_required',
      blockingReasons: ['counterevidence_present']
    };
  }
  return {
    evidenceStatus: 'candidate',
    evidenceStrength: eligible >= gates.minimumEligibleRecords * 2 ? 'strong' : 'adequate',
    posture: finding.findingCategory === 'no_change_recommendation' ? 'no_change_recommended' : 'proposed_review',
    blockingReasons: []
  };
}

function confidenceForFinding(finding = {}) {
  if (finding.evidenceStrength === 'strong') return 82;
  if (finding.evidenceStrength === 'adequate') return 68;
  if (finding.evidenceStrength === 'limited') return 45;
  if (finding.evidenceStrength === 'weak') return 30;
  return 0;
}

function confidenceLevelForFinding(finding = {}) {
  if (finding.evidenceStrength === 'strong') return 'high';
  if (finding.evidenceStrength === 'adequate') return 'moderate';
  if (['limited', 'weak'].includes(finding.evidenceStrength)) return 'low';
  return 'insufficient';
}

function statusForFinding(finding = {}) {
  if (finding.findingCategory === 'no_change_recommendation') return 'candidate';
  if (['insufficient_evidence', 'continue_observation', 'manual_investigation_required'].includes(finding.evidenceStatus)) {
    return 'evidence_insufficient';
  }
  return 'candidate';
}

function proposedBehaviorForFinding(finding = {}, posture = null) {
  const effectivePosture = posture || evaluateRecommendationEvidence(finding).posture;
  if (finding.findingCategory === 'no_change_recommendation') {
    return {
      posture: 'no_change_recommended',
      description: 'Reviewed evidence supports continuing observation without proposing a behavior change.'
    };
  }
  if (['insufficient_evidence', 'continue_observation', 'manual_investigation_required'].includes(effectivePosture)) {
    return {
      posture: effectivePosture,
      description: 'Do not propose a production change from the available reviewed evidence.'
    };
  }
  return {
    posture: 'recommend_offline_review',
    description: `Review ${finding.affectedSubsystem} behavior using an offline experiment before any shadow or production proposal.`
  };
}

function buildRecommendationFromFinding(finding = {}, datasets = [], options = {}) {
  const evidence = evaluateRecommendationEvidence(finding, datasets, options);
  const sourceDatasetIds = getSourceDatasetIds(datasets);
  const sourceDatasetFingerprints = getSourceDatasetFingerprints(datasets);
  const recommendationId = `${finding.findingId}:recommendation`;
  return recommendationContract.createCalibrationRecommendation({
    recommendationId,
    recommendationBatchId: options.recommendationBatchId || 'calibration-recommendation-batch',
    createdAt: options.createdAt || UNKNOWN_VALUE,
    sourceDatasetIds,
    sourceDatasetFingerprints,
    recommendationCategory: normalizeCategory(finding.findingCategory),
    affectedSubsystem: finding.affectedSubsystem,
    affectedRuleOrField: finding.affectedRuleOrField,
    finding: clone(finding),
    evidenceSummary: {
      evidenceStatus: evidence.evidenceStatus,
      blockingReasons: evidence.blockingReasons,
      sourceRecordFingerprints: clone(finding.sourceRecordFingerprints),
      limitations: clone(finding.limitations)
    },
    sampleSize: clone(finding.sampleSize),
    coverage: clone(finding.coverage),
    currentBehavior: clone(finding.observedBehavior),
    proposedBehavior: proposedBehaviorForFinding(finding, evidence.posture),
    expectedBenefit: finding.findingCategory === 'no_change_recommendation'
      ? { posture: 'preserve_current_behavior', expectedChange: 'none' }
      : { posture: evidence.posture, expectedChange: evidence.posture === 'proposed_review' ? 'possible_after_validation' : 'none_without_more_evidence' },
    identifiedRisks: unique([
      ...asArray(finding.limitations),
      ...asArray(evidence.blockingReasons)
    ]).sort(),
    confidence: confidenceForFinding({ ...finding, evidenceStrength: evidence.evidenceStrength }),
    confidenceLevel: confidenceLevelForFinding({ ...finding, evidenceStrength: evidence.evidenceStrength }),
    evidenceStrength: evidence.evidenceStrength,
    counterEvidence: clone(finding.counterEvidence),
    prerequisites: [
      'dalton_review_required_before_experiment',
      evidence.evidenceStatus === 'candidate' ? 'offline_experiment_specification_required' : 'collect_more_reviewed_evidence'
    ],
    validationPlan: {
      required: true,
      type: evidence.evidenceStatus === 'candidate' ? 'offline_replay_before_shadow' : 'continued_observation',
      noProductionAuthority: true
    },
    rollbackPlan: {
      requiredBeforeProductionProposal: true,
      productionBehaviorChangedByThisRecommendation: false
    },
    recommendationStatus: statusForFinding({ ...finding, evidenceStatus: evidence.evidenceStatus }),
    reviewerApproval: {
      required: true,
      approved: false
    }
  });
}

function buildRecommendationsFromDataset(datasetInput = {}, options = {}) {
  const dataset = normalizeDatasetInput(datasetInput);
  const findings = buildCalibrationFindings([dataset], options);
  return deepFreeze(sortCalibrationRecommendations(findings.map((finding) => buildRecommendationFromFinding(finding, [dataset], options))));
}

function buildInsufficientEvidenceRecommendation(datasetInput = {}, options = {}) {
  const dataset = normalizeDatasetInput(datasetInput);
  const finding = buildFindingCore('insufficient_data_finding', getDatasetRecords([dataset]), [dataset], options);
  return buildRecommendationFromFinding(finding, [dataset], options);
}

function buildNoChangeRecommendation(datasetInput = {}, options = {}) {
  const dataset = normalizeDatasetInput(datasetInput);
  const records = getDatasetRecords([dataset]);
  const finding = buildFindingCore('no_change_recommendation', records, [dataset], {
    ...options,
    evidenceGates: {
      ...asObject(options.evidenceGates),
      minimumReviewedRecords: options.evidenceGates?.minimumReviewedRecords ?? 1,
      minimumEligibleRecords: options.evidenceGates?.minimumEligibleRecords ?? 1
    }
  });
  return buildRecommendationFromFinding(finding, [dataset], options);
}

function summarizeRecommendations(recommendations = []) {
  return {
    recommendationStatusSummary: countBy(recommendations.map((recommendation) => recommendation.recommendationStatus)),
    recommendationCategorySummary: countBy(recommendations.map((recommendation) => recommendation.recommendationCategory)),
    affectedSubsystemSummary: countBy(recommendations.map((recommendation) => recommendation.affectedSubsystem)),
    evidenceStrengthSummary: countBy(recommendations.map((recommendation) => recommendation.evidenceStrength)),
    insufficientEvidenceCount: recommendations.filter((recommendation) =>
      recommendation.proposedBehavior?.posture === 'insufficient_evidence' ||
      recommendation.proposedBehavior?.posture === 'continue_observation' ||
      recommendation.proposedBehavior?.posture === 'manual_investigation_required'
    ).length,
    noChangeCount: recommendations.filter((recommendation) => recommendation.recommendationCategory === 'no_change_recommendation').length
  };
}

function buildCalibrationRecommendationBatch(datasetInputs = [], options = {}) {
  const datasets = sortCalibrationDatasets(getDatasetInputs(datasetInputs).map(normalizeDatasetInput));
  const findings = buildCalibrationFindings(datasets, options);
  const recommendations = sortCalibrationRecommendations(findings.map((finding) => buildRecommendationFromFinding(finding, datasets, options)));
  const summaries = summarizeRecommendations(recommendations);
  const batchCore = {
    schemaVersion: CALIBRATION_RECOMMENDATION_BUILDER_SCHEMA_VERSION,
    source: CALIBRATION_RECOMMENDATION_BUILDER_SOURCE,
    recommendationBatchId: options.recommendationBatchId || 'calibration-recommendation-batch',
    createdAt: normalizeDate(options.createdAt || UNKNOWN_VALUE),
    sourceDatasetIds: getSourceDatasetIds(datasets),
    sourceDatasetFingerprints: getSourceDatasetFingerprints(datasets),
    datasetCount: datasets.length,
    findingCount: findings.length,
    recommendationCount: recommendations.length,
    ...summaries,
    productionImpact: 'none',
    decisionImpact: 'none',
    findings,
    recommendations
  };
  return deepFreeze({
    ...batchCore,
    batchFingerprint: buildCalibrationRecommendationBatchFingerprint(batchCore)
  });
}

function validateCalibrationRecommendationBatch(batch = {}) {
  const errors = [];
  const warnings = [];
  const invalidRecommendationIndexes = [];
  const invalidSourceDatasetReferences = [];
  const evidenceBoundaryViolations = [];
  const productionImpactViolations = [];
  const decisionImpactViolations = [];

  for (const field of missingFields(batch, REQUIRED_BATCH_FIELDS)) {
    errors.push({ code: 'missing_required_field', message: `${field} is required.`, path: field });
  }
  if (batch.schemaVersion !== CALIBRATION_RECOMMENDATION_BUILDER_SCHEMA_VERSION) {
    errors.push({ code: 'invalid_schema_version', message: 'schemaVersion must match Calibration Recommendation Builder schema.', path: 'schemaVersion' });
  }
  if (batch.source !== CALIBRATION_RECOMMENDATION_BUILDER_SOURCE) {
    errors.push({ code: 'invalid_source', message: 'source must be calibration_recommendation_builder.', path: 'source' });
  }
  if (batch.productionImpact !== 'none') {
    errors.push({ code: 'invalid_production_impact', message: 'productionImpact must remain none.', path: 'productionImpact' });
    productionImpactViolations.push('batch.productionImpact');
  }
  if (batch.decisionImpact !== 'none') {
    errors.push({ code: 'invalid_decision_impact', message: 'decisionImpact must remain none.', path: 'decisionImpact' });
    decisionImpactViolations.push('batch.decisionImpact');
  }
  if (batch.recommendationCount !== asArray(batch.recommendations).length) {
    errors.push({ code: 'recommendation_count_mismatch', message: 'recommendationCount must match recommendations length.', path: 'recommendationCount' });
  }
  if (batch.findingCount !== asArray(batch.findings).length) {
    errors.push({ code: 'finding_count_mismatch', message: 'findingCount must match findings length.', path: 'findingCount' });
  }
  if (!asArray(batch.sourceDatasetIds).length || !asArray(batch.sourceDatasetFingerprints).length) {
    invalidSourceDatasetReferences.push('missing_source_dataset_references');
  }

  asArray(batch.recommendations).forEach((recommendation, index) => {
    const validation = recommendationContract.validateCalibrationRecommendation(recommendation);
    if (!validation.valid) {
      invalidRecommendationIndexes.push(index);
      validation.errors.forEach((error) => errors.push({ ...error, path: `recommendations.${index}.${error.field || ''}` }));
    }
    if (recommendation.productionImpact !== 'none') productionImpactViolations.push(`recommendations.${index}.productionImpact`);
    if (recommendation.decisionImpact !== 'none') decisionImpactViolations.push(`recommendations.${index}.decisionImpact`);
    if (recommendation.reviewerApproval?.approved === true || asArray(recommendation.experimentReferences).length > 0) {
      evidenceBoundaryViolations.push(`recommendations.${index}.approval_or_experiment_reference`);
      warnings.push({ code: 'automatic_authority_artifact_present', message: 'Builder output should not automatically attach approvals or experiment references.', path: `recommendations.${index}` });
    }
    const sourceIds = asArray(recommendation.sourceDatasetIds);
    if (sourceIds.some((id) => !asArray(batch.sourceDatasetIds).includes(id))) {
      invalidSourceDatasetReferences.push(`recommendations.${index}.sourceDatasetIds`);
    }
  });

  const duplicateRecommendationIds = findDuplicates(asArray(batch.recommendations).map((recommendation) => recommendation.recommendationId));
  const duplicateRecommendationFingerprints = findDuplicates(asArray(batch.recommendations).map((recommendation) => recommendation.recommendationFingerprint));
  if (duplicateRecommendationIds.length) errors.push({ code: 'duplicate_recommendation_ids', message: 'Duplicate recommendation IDs detected.', path: 'recommendations' });
  if (duplicateRecommendationFingerprints.length) errors.push({ code: 'duplicate_recommendation_fingerprints', message: 'Duplicate recommendation fingerprints detected.', path: 'recommendations' });
  if (batch.batchFingerprint && buildCalibrationRecommendationBatchFingerprint(batch) !== batch.batchFingerprint) {
    errors.push({ code: 'batch_fingerprint_mismatch', message: 'batchFingerprint does not match batch contents.', path: 'batchFingerprint' });
  }

  const reasonCodes = unique([
    ...errors.map((error) => error.code),
    ...warnings.map((warning) => warning.code),
    invalidSourceDatasetReferences.length ? 'invalid_source_dataset_references' : null,
    evidenceBoundaryViolations.length ? 'evidence_boundary_violations' : null,
    productionImpactViolations.length ? 'production_impact_violations' : null,
    decisionImpactViolations.length ? 'decision_impact_violations' : null
  ].filter(Boolean));

  return {
    valid: errors.length === 0 && invalidSourceDatasetReferences.length === 0 && productionImpactViolations.length === 0 && decisionImpactViolations.length === 0,
    errors,
    warnings,
    reasonCodes,
    invalidRecommendationIndexes: [...new Set(invalidRecommendationIndexes)].sort((a, b) => a - b),
    duplicateRecommendationIds,
    duplicateRecommendationFingerprints,
    invalidSourceDatasetReferences: unique(invalidSourceDatasetReferences),
    evidenceBoundaryViolations: unique(evidenceBoundaryViolations),
    productionImpactViolations: unique(productionImpactViolations),
    decisionImpactViolations: unique(decisionImpactViolations)
  };
}

function summarizeCalibrationRecommendationBatch(batch = {}) {
  return deepFreeze({
    recommendationBatchId: batch.recommendationBatchId,
    datasetCount: batch.datasetCount || 0,
    findingCount: batch.findingCount || 0,
    recommendationCount: batch.recommendationCount || 0,
    recommendationStatusSummary: clone(batch.recommendationStatusSummary || {}),
    recommendationCategorySummary: clone(batch.recommendationCategorySummary || {}),
    affectedSubsystemSummary: clone(batch.affectedSubsystemSummary || {}),
    evidenceStrengthSummary: clone(batch.evidenceStrengthSummary || {}),
    insufficientEvidenceCount: batch.insufficientEvidenceCount || 0,
    noChangeCount: batch.noChangeCount || 0,
    productionImpact: batch.productionImpact,
    decisionImpact: batch.decisionImpact,
    batchFingerprint: batch.batchFingerprint
  });
}

function filterCalibrationRecommendations(recommendationsOrBatch = {}, filters = {}) {
  const recommendations = Array.isArray(recommendationsOrBatch) ? recommendationsOrBatch : asArray(recommendationsOrBatch.recommendations);
  return sortCalibrationRecommendations(recommendations.filter((recommendation) => {
    if (filters.recommendationStatus && recommendation.recommendationStatus !== filters.recommendationStatus) return false;
    if (filters.recommendationCategory && recommendation.recommendationCategory !== normalizeCategory(filters.recommendationCategory)) return false;
    if (filters.affectedSubsystem && recommendation.affectedSubsystem !== filters.affectedSubsystem) return false;
    if (filters.evidenceStrength && recommendation.evidenceStrength !== filters.evidenceStrength) return false;
    return true;
  }));
}

function exportCalibrationRecommendationBatch(batch = {}, outputPath) {
  const serialized = `${JSON.stringify(batch, null, 2)}\n`;
  if (!outputPath) return serialized;
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, serialized);
  return batch;
}

function importCalibrationRecommendationBatch(input) {
  const parsed = typeof input === 'string'
    ? JSON.parse(fs.existsSync(input) ? fs.readFileSync(input, 'utf8') : input)
    : clone(input);
  return {
    batch: parsed,
    validation: validateCalibrationRecommendationBatch(parsed)
  };
}

module.exports = {
  BUILDER_CATEGORIES,
  CALIBRATION_RECOMMENDATION_BUILDER_SCHEMA_VERSION,
  CALIBRATION_RECOMMENDATION_BUILDER_SOURCE,
  DEFAULT_EVIDENCE_GATES,
  REQUIRED_BATCH_FIELDS,
  buildCalibrationFindings,
  buildCalibrationRecommendationBatch,
  buildCalibrationRecommendationBatchFingerprint,
  buildInsufficientEvidenceRecommendation,
  buildNoChangeRecommendation,
  buildRecommendationsFromDataset,
  classifyRecommendationCategory,
  determineAffectedSubsystem,
  evaluateRecommendationEvidence,
  exportCalibrationRecommendationBatch,
  filterCalibrationRecommendations,
  importCalibrationRecommendationBatch,
  sortCalibrationRecommendations,
  summarizeCalibrationRecommendationBatch,
  validateCalibrationRecommendationBatch
};
