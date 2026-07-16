'use strict';

const {
  asArray,
  asObject,
  unique
} = require('./canonicalValidationCore');
const {
  buildFingerprintFromProjection
} = require('./fingerprintProjection');
const {
  buildOfflineAuthorityFlags,
  clone,
  collectBlockingReasons,
  firstDefined,
  normalizeRequirement
} = require('./phase8GovernanceCore');

const SHADOW_PROMOTION_GOVERNANCE_SCHEMA_VERSION = '1.0.0';
const SHADOW_PROMOTION_GOVERNANCE_SOURCE = 'shadow_to_production_promotion_governance';
const UNKNOWN_VALUE = 'unknown';

const PROMOTION_READINESS_STATUS = Object.freeze({
  DRAFT: 'draft',
  BLOCKED: 'blocked',
  INSUFFICIENT_EVIDENCE: 'insufficient_evidence',
  READY_FOR_EXTENDED_SHADOW: 'ready_for_extended_shadow',
  READY_FOR_RELEASE_REVIEW: 'ready_for_release_review',
  APPROVED_FOR_LIMITED_PRODUCTION_TRIAL: 'approved_for_limited_production_trial',
  REJECTED: 'rejected'
});

const AUTHORITY_LEVEL = Object.freeze({
  CONTRACT_ONLY: 'contract_only',
  OFFLINE_DIAGNOSTIC: 'offline_diagnostic',
  SHADOW: 'shadow',
  DISPLAY_CONTEXT: 'display_context',
  LIMITED_PRODUCTION_TRIAL: 'limited_production_trial',
  PRODUCTION_AUTHORITY: 'production_authority',
  UNKNOWN: UNKNOWN_VALUE
});

const RECOMMENDED_ACTION = Object.freeze({
  COMPLETE_DRAFT: 'complete_promotion_candidate_draft',
  RESOLVE_BLOCKERS: 'resolve_blocking_promotion_issues',
  COLLECT_VALIDATION_EVIDENCE: 'collect_real_listing_shadow_and_operator_validation_evidence',
  CONTINUE_EXTENDED_SHADOW: 'continue_extended_shadow_observation',
  SUBMIT_FOR_RELEASE_REVIEW: 'submit_for_release_review',
  PREPARE_OPERATOR_REVIEWED_TRIAL: 'prepare_operator_reviewed_limited_production_trial_plan',
  DO_NOT_PROMOTE: 'do_not_promote_candidate'
});

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}

function known(value) {
  return value !== undefined && value !== null && value !== '' && value !== UNKNOWN_VALUE;
}

function toNumber(value, fallback = UNKNOWN_VALUE) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function toBoolean(value, fallback = UNKNOWN_VALUE) {
  if (value === true || value === false) return value;
  return fallback;
}

function getCandidate(input = {}) {
  const candidate = asObject(firstDefined(input.candidate, input.promotionCandidate, {}));
  return {
    candidateId: firstDefined(input.candidateId, candidate.candidateId, candidate.id, UNKNOWN_VALUE),
    candidateName: firstDefined(input.candidateName, candidate.candidateName, candidate.name, UNKNOWN_VALUE),
    candidateVersion: firstDefined(input.candidateVersion, candidate.candidateVersion, candidate.version, UNKNOWN_VALUE),
    componentType: firstDefined(input.componentType, candidate.componentType, candidate.type, UNKNOWN_VALUE),
    currentAuthority: firstDefined(input.currentAuthority, candidate.currentAuthority, AUTHORITY_LEVEL.UNKNOWN),
    proposedAuthority: firstDefined(input.proposedAuthority, candidate.proposedAuthority, AUTHORITY_LEVEL.UNKNOWN)
  };
}

function summarizeCoverage(source = {}, countKeys = []) {
  const object = asObject(source);
  const count = toNumber(firstDefined(...countKeys.map((key) => object[key])));
  const passed = toBoolean(firstDefined(object.passed, object.pass, object.success, object.ok));
  const available = Object.keys(object).length > 0;
  return {
    available,
    passed: available ? passed : UNKNOWN_VALUE,
    count,
    coverageLevel: firstDefined(object.coverageLevel, object.level, object.status, UNKNOWN_VALUE),
    fingerprint: firstDefined(object.fingerprint, object.stableFingerprint, object.reportFingerprint, UNKNOWN_VALUE),
    details: clone(object)
  };
}

function summarizeRateEvidence(source = {}) {
  const object = asObject(source);
  return {
    available: Object.keys(object).length > 0,
    falsePositiveRate: toNumber(firstDefined(object.falsePositiveRate, object.falsePositivePercent)),
    missedOpportunityRate: toNumber(firstDefined(object.missedOpportunityRate, object.falseNegativeRate, object.falseNegativePercent)),
    sampleSize: toNumber(firstDefined(object.sampleSize, object.total, object.totalReviewed, object.reviewedCount)),
    details: clone(object)
  };
}

function summarizeRealListingValidation(input = {}) {
  const source = asObject(firstDefined(input.realListingValidationResults, input.realListingValidation, {}));
  const metrics = asObject(firstDefined(source.metrics, source.summary, source.aggregate, source));
  return {
    available: Object.keys(source).length > 0,
    totalReviewed: toNumber(firstDefined(metrics.totalReviewed, metrics.reviewedCount, metrics.reviewed, metrics.total)),
    falsePositiveRate: toNumber(firstDefined(metrics.falsePositiveRate, metrics.falsePositivePercent)),
    missedOpportunityRate: toNumber(firstDefined(metrics.missedOpportunityRate, metrics.falseNegativeRate, metrics.falseNegativePercent)),
    outcomeAvailability: firstDefined(metrics.outcomeAvailability, metrics.outcomeStatus, UNKNOWN_VALUE),
    fingerprint: firstDefined(source.fingerprint, source.stableFingerprint, source.reportFingerprint, UNKNOWN_VALUE),
    details: clone(source)
  };
}

function summarizeDealerAgreement(input = {}) {
  const source = asObject(firstDefined(input.operatorDealerAgreement, input.dealerAgreement, input.dealerAgreementScoring, {}));
  const summary = asObject(firstDefined(source.summary, source.scorecard, source.aggregate, source));
  return {
    available: Object.keys(source).length > 0,
    agreementPercent: toNumber(firstDefined(summary.agreementPercent, summary.overallAgreementPercent, summary.agreementRate)),
    totalReviewed: toNumber(firstDefined(summary.totalReviewed, summary.total, summary.reviewedCount)),
    falsePositiveRate: toNumber(firstDefined(summary.falsePositiveRate, summary.falsePositivePercent)),
    missedOpportunityRate: toNumber(firstDefined(summary.missedOpportunityRate, summary.falseNegativeRate, summary.falseNegativePercent)),
    fingerprint: firstDefined(source.fingerprint, source.stableFingerprint, source.reportFingerprint, UNKNOWN_VALUE),
    details: clone(source)
  };
}

function summarizeConfidenceCalibration(input = {}) {
  const source = asObject(firstDefined(input.confidenceCalibration, input.confidenceCalibrationDiagnostics, {}));
  return {
    available: Object.keys(source).length > 0,
    calibrationStatus: firstDefined(source.calibrationStatus, source.status, UNKNOWN_VALUE),
    confidenceSupportLevel: firstDefined(source.confidenceSupportLevel, source.supportLevel, UNKNOWN_VALUE),
    sampleSize: toNumber(firstDefined(source.sampleSize, source.observedAgreementMetrics?.sampleSize, source.availableOutcomeMetrics?.sampleSize)),
    fingerprint: firstDefined(source.stableFingerprint, source.fingerprint, source.reportFingerprint, UNKNOWN_VALUE),
    details: clone(source)
  };
}

function summarizeShadowObservation(input = {}) {
  const source = asObject(firstDefined(input.shadowObservationPeriod, input.shadowObservation, {}));
  return {
    available: Object.keys(source).length > 0,
    startedAt: firstDefined(source.startedAt, source.startDate, UNKNOWN_VALUE),
    endedAt: firstDefined(source.endedAt, source.endDate, UNKNOWN_VALUE),
    durationDays: toNumber(firstDefined(source.durationDays, source.daysObserved)),
    observationCount: toNumber(firstDefined(source.observationCount, source.recordsObserved, source.totalObservations)),
    complete: toBoolean(firstDefined(source.complete, source.completed)),
    details: clone(source)
  };
}

function summarizeProductionComparison(input = {}) {
  const source = asObject(firstDefined(input.productionComparisonResults, input.productionComparison, input.shadowProductionComparison, {}));
  return {
    available: Object.keys(source).length > 0,
    comparedCount: toNumber(firstDefined(source.comparedCount, source.totalCompared, source.total)),
    disagreementCount: toNumber(firstDefined(source.disagreementCount, source.totalDisagreements)),
    materialDisagreements: toNumber(firstDefined(source.materialDisagreements, source.materialDisagreementCount)),
    fingerprint: firstDefined(source.stableFingerprint, source.fingerprint, source.reportFingerprint, UNKNOWN_VALUE),
    details: clone(source)
  };
}

function summarizeValidationEvidence(input = {}) {
  return {
    contractCompleteness: normalizeRequirement(firstDefined(input.contractCompleteness, input.contractCompletenessRequirement, {})),
    deterministicFixtureCoverage: summarizeCoverage(firstDefined(input.deterministicFixtureCoverage, input.fixtureCoverage, {}), ['fixtureCount', 'count', 'total']),
    focusedTestCoverage: summarizeCoverage(firstDefined(input.focusedTestCoverage, input.focusedTests, {}), ['testCount', 'count', 'total']),
    fullRegressionStatus: summarizeCoverage(firstDefined(input.fullRegressionStatus, input.fullRegression, {}), ['testCount', 'count', 'total']),
    realListingValidationResults: summarizeRealListingValidation(input),
    operatorDealerAgreement: summarizeDealerAgreement(input),
    outcomeRates: summarizeRateEvidence(firstDefined(input.outcomeRates, input.realListingValidationResults?.summary, {})),
    confidenceCalibration: summarizeConfidenceCalibration(input),
    shadowObservationPeriod: summarizeShadowObservation(input),
    productionComparisonResults: summarizeProductionComparison(input),
    documentedFailureModes: asArray(firstDefined(input.documentedFailureModes, input.failureModes)).map(String).sort(),
    rollbackReadiness: normalizeRequirement(firstDefined(input.rollbackReadiness, input.rollbackPlan, {})),
    featureFlagReadiness: normalizeRequirement(firstDefined(input.featureFlagReadiness, input.featureFlag, {})),
    releaseApproval: normalizeRequirement(firstDefined(input.releaseApproval, input.releaseReview, {})),
    productionBoundaryReview: normalizeRequirement(firstDefined(input.productionBoundaryReview, input.boundaryReview, {}))
  };
}

function buildApprovalRequirements(evidence = {}) {
  return {
    releaseApproval: {
      required: true,
      satisfied: evidence.releaseApproval.satisfied === true,
      details: clone(evidence.releaseApproval.details)
    },
    productionBoundaryReview: {
      required: true,
      satisfied: evidence.productionBoundaryReview.satisfied === true,
      details: clone(evidence.productionBoundaryReview.details)
    },
    operatorApproval: {
      required: true,
      satisfied: evidence.operatorDealerAgreement.available === true &&
        Number(evidence.operatorDealerAgreement.totalReviewed) > 0 &&
        known(evidence.operatorDealerAgreement.agreementPercent),
      details: clone(evidence.operatorDealerAgreement)
    },
    rollbackApproval: {
      required: true,
      satisfied: evidence.rollbackReadiness.satisfied === true,
      details: clone(evidence.rollbackReadiness.details)
    }
  };
}

function buildRollbackRequirements(evidence = {}) {
  return {
    rollbackPlanRequired: true,
    rollbackPlanReady: evidence.rollbackReadiness.satisfied === true,
    featureFlagRequired: true,
    featureFlagReady: evidence.featureFlagReadiness.satisfied === true,
    productionAuthorityRemainsUnchanged: true,
    details: {
      rollbackReadiness: clone(evidence.rollbackReadiness.details),
      featureFlagReadiness: clone(evidence.featureFlagReadiness.details)
    }
  };
}

function missingCoreIdentity(candidate = {}) {
  return [
    !known(candidate.candidateId) ? 'missing_candidate_id' : null,
    !known(candidate.candidateVersion) ? 'missing_candidate_version' : null,
    !known(candidate.currentAuthority) ? 'missing_current_authority' : null,
    !known(candidate.proposedAuthority) ? 'missing_proposed_authority' : null
  ].filter(Boolean);
}

function missingValidationEvidence(evidence = {}) {
  return [
    evidence.realListingValidationResults.available !== true ? 'missing_real_listing_validation_results' : null,
    evidence.operatorDealerAgreement.available !== true ? 'missing_operator_or_dealer_agreement' : null,
    evidence.confidenceCalibration.available !== true ? 'missing_confidence_calibration' : null,
    evidence.shadowObservationPeriod.available !== true ? 'missing_shadow_observation_period' : null,
    evidence.productionComparisonResults.available !== true ? 'missing_production_comparison_results' : null
  ].filter(Boolean);
}

function collectPromotionBlockingReasons({ candidate, evidence, approvalRequirements, rejected }) {
  return collectBlockingReasons([
    { when: rejected === true, reason: 'candidate_rejected' },
    { when: known(candidate.proposedAuthority) && candidate.proposedAuthority === AUTHORITY_LEVEL.PRODUCTION_AUTHORITY, reason: 'direct_production_authority_promotion_not_allowed_by_this_framework' },
    { when: evidence.contractCompleteness.satisfied !== true, reason: 'contract_completeness_not_satisfied' },
    { when: evidence.fullRegressionStatus.available && evidence.fullRegressionStatus.passed !== true, reason: 'full_regression_not_passing' },
    { when: evidence.rollbackReadiness.satisfied !== true, reason: 'rollback_readiness_not_satisfied' },
    { when: evidence.featureFlagReadiness.satisfied !== true, reason: 'feature_flag_readiness_not_satisfied' },
    { when: evidence.productionBoundaryReview.satisfied !== true, reason: 'production_boundary_review_not_approved' },
    { when: evidence.documentedFailureModes.length === 0, reason: 'documented_failure_modes_missing' },
    { when: approvalRequirements.releaseApproval.required && approvalRequirements.releaseApproval.satisfied !== true, reason: 'release_approval_missing' }
  ]);
}

function collectPromotionWarnings({ candidate, evidence, missingEvidence }) {
  return unique([
    ...missingEvidence.map((reason) => `validation_evidence_missing:${reason}`),
    evidence.deterministicFixtureCoverage.available && evidence.deterministicFixtureCoverage.passed !== true ? 'deterministic_fixture_coverage_not_passing' : null,
    evidence.focusedTestCoverage.available && evidence.focusedTestCoverage.passed !== true ? 'focused_test_coverage_not_passing' : null,
    evidence.realListingValidationResults.available && Number(evidence.realListingValidationResults.falsePositiveRate) > 10 ? 'false_positive_rate_above_10_percent' : null,
    evidence.realListingValidationResults.available && Number(evidence.realListingValidationResults.missedOpportunityRate) > 15 ? 'missed_opportunity_rate_above_15_percent' : null,
    evidence.operatorDealerAgreement.available && Number(evidence.operatorDealerAgreement.agreementPercent) < 80 ? 'operator_or_dealer_agreement_below_80_percent' : null,
    ['overconfident', 'underconfident', 'insufficient_sample', 'unavailable'].includes(evidence.confidenceCalibration.calibrationStatus) ? `confidence_calibration_${evidence.confidenceCalibration.calibrationStatus}` : null,
    known(candidate.proposedAuthority) && candidate.proposedAuthority === candidate.currentAuthority ? 'proposed_authority_matches_current_authority' : null
  ].filter(Boolean));
}

function hasOnlyArchitectureOrFixtureEvidence(evidence = {}) {
  const architectureOrFixtureEvidence =
    evidence.contractCompleteness.satisfied === true ||
    evidence.deterministicFixtureCoverage.available === true ||
    evidence.focusedTestCoverage.available === true;

  const realWorldEvidence =
    evidence.realListingValidationResults.available === true ||
    evidence.operatorDealerAgreement.available === true ||
    evidence.shadowObservationPeriod.available === true ||
    evidence.productionComparisonResults.available === true;

  return architectureOrFixtureEvidence && !realWorldEvidence;
}

function getReadinessStatus({ candidate, evidence, missingIdentity, missingEvidence, blockingReasons, rejected }) {
  if (rejected === true) return PROMOTION_READINESS_STATUS.REJECTED;
  if (missingIdentity.length) return PROMOTION_READINESS_STATUS.DRAFT;
  if (blockingReasons.includes('direct_production_authority_promotion_not_allowed_by_this_framework')) {
    return PROMOTION_READINESS_STATUS.BLOCKED;
  }
  if (hasOnlyArchitectureOrFixtureEvidence(evidence)) return PROMOTION_READINESS_STATUS.INSUFFICIENT_EVIDENCE;
  if (missingEvidence.length) return PROMOTION_READINESS_STATUS.READY_FOR_EXTENDED_SHADOW;
  if (blockingReasons.length) {
    const releaseOnly = blockingReasons.every((reason) => reason === 'release_approval_missing');
    return releaseOnly ? PROMOTION_READINESS_STATUS.READY_FOR_RELEASE_REVIEW : PROMOTION_READINESS_STATUS.BLOCKED;
  }
  if (candidate.proposedAuthority === AUTHORITY_LEVEL.LIMITED_PRODUCTION_TRIAL) {
    return PROMOTION_READINESS_STATUS.APPROVED_FOR_LIMITED_PRODUCTION_TRIAL;
  }
  return PROMOTION_READINESS_STATUS.READY_FOR_RELEASE_REVIEW;
}

function getRecommendedAction(status) {
  if (status === PROMOTION_READINESS_STATUS.DRAFT) return RECOMMENDED_ACTION.COMPLETE_DRAFT;
  if (status === PROMOTION_READINESS_STATUS.REJECTED) return RECOMMENDED_ACTION.DO_NOT_PROMOTE;
  if (status === PROMOTION_READINESS_STATUS.BLOCKED) return RECOMMENDED_ACTION.RESOLVE_BLOCKERS;
  if (status === PROMOTION_READINESS_STATUS.INSUFFICIENT_EVIDENCE) return RECOMMENDED_ACTION.COLLECT_VALIDATION_EVIDENCE;
  if (status === PROMOTION_READINESS_STATUS.READY_FOR_EXTENDED_SHADOW) return RECOMMENDED_ACTION.CONTINUE_EXTENDED_SHADOW;
  if (status === PROMOTION_READINESS_STATUS.READY_FOR_RELEASE_REVIEW) return RECOMMENDED_ACTION.SUBMIT_FOR_RELEASE_REVIEW;
  if (status === PROMOTION_READINESS_STATUS.APPROVED_FOR_LIMITED_PRODUCTION_TRIAL) {
    return RECOMMENDED_ACTION.PREPARE_OPERATOR_REVIEWED_TRIAL;
  }
  return RECOMMENDED_ACTION.COLLECT_VALIDATION_EVIDENCE;
}

function buildShadowPromotionAssessmentFingerprint(assessment = {}) {
  const projection = clone(assessment);
  delete projection.stableFingerprint;
  return buildFingerprintFromProjection(projection);
}

function assessShadowPromotionCandidate(input = {}) {
  const candidate = getCandidate(input);
  const evidence = summarizeValidationEvidence(input);
  const approvalRequirements = buildApprovalRequirements(evidence);
  const rollbackRequirements = buildRollbackRequirements(evidence);
  const rejected = input.rejected === true || input.qualificationStatus === PROMOTION_READINESS_STATUS.REJECTED;
  const missingIdentity = missingCoreIdentity(candidate);
  const missingEvidence = missingValidationEvidence(evidence);
  const blockingReasons = unique([
    ...missingIdentity,
    ...collectPromotionBlockingReasons({ candidate, evidence, approvalRequirements, rejected })
  ]);
  const warnings = collectPromotionWarnings({ candidate, evidence, missingEvidence });
  const readinessStatus = getReadinessStatus({
    candidate,
    evidence,
    missingIdentity,
    missingEvidence,
    blockingReasons,
    rejected
  });

  const assessment = {
    source: SHADOW_PROMOTION_GOVERNANCE_SOURCE,
    schemaVersion: SHADOW_PROMOTION_GOVERNANCE_SCHEMA_VERSION,
    productionImpact: 'none',
    decisionImpact: 'none',
    candidateId: candidate.candidateId,
    candidateName: candidate.candidateName,
    candidateVersion: candidate.candidateVersion,
    componentType: candidate.componentType,
    currentAuthority: candidate.currentAuthority,
    proposedAuthority: candidate.proposedAuthority,
    readinessStatus,
    blockingReasons,
    warnings,
    validationEvidenceSummary: evidence,
    approvalRequirements,
    rollbackRequirements,
    recommendedNextAction: getRecommendedAction(readinessStatus),
    promotionHasOccurred: false,
    productionAuthorityStatement: 'Promotion has not occurred. This assessment is offline governance only and does not change production scoring, valuation, ROI, confidence, Deal Gate, BUY_NOW, notifications, marketplace behavior, server.js, scan timing, or any shadow component authority.',
    authorityFlags: buildOfflineAuthorityFlags({
      productionApproval: false,
      productionPromotionAuthority: false,
      limitedProductionTrialAuthority: false
    }),
    stableFingerprint: ''
  };

  assessment.stableFingerprint = buildShadowPromotionAssessmentFingerprint(assessment);
  return deepFreeze(assessment);
}

function summarizeShadowPromotionAssessment(assessment = {}) {
  const status = assessment.readinessStatus || PROMOTION_READINESS_STATUS.DRAFT;
  return `Promotion readiness is ${status}; production authority has not changed.`;
}

module.exports = {
  AUTHORITY_LEVEL,
  PROMOTION_READINESS_STATUS,
  RECOMMENDED_ACTION,
  SHADOW_PROMOTION_GOVERNANCE_SCHEMA_VERSION,
  SHADOW_PROMOTION_GOVERNANCE_SOURCE,
  UNKNOWN_VALUE,
  assessShadowPromotionCandidate,
  buildShadowPromotionAssessmentFingerprint,
  summarizeShadowPromotionAssessment
};
