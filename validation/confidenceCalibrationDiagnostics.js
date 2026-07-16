'use strict';

const confidenceEngine = require('../engines/confidenceEngine');
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
const {
  evaluateConfidenceCalibration
} = require('./confidenceCalibration');

const CONFIDENCE_CALIBRATION_DIAGNOSTIC_SCHEMA_VERSION = '1.0.0';
const CONFIDENCE_CALIBRATION_DIAGNOSTIC_SOURCE = 'confidence_calibration_diagnostics';
const UNKNOWN_VALUE = 'unknown';
const MINIMUM_CALIBRATION_SAMPLE_SIZE = 3;

const CALIBRATION_STATUS = Object.freeze({
  CALIBRATED: 'calibrated',
  PROVISIONALLY_CALIBRATED: 'provisionally_calibrated',
  UNDER_REVIEW: 'under_review',
  OVERCONFIDENT: 'overconfident',
  UNDERCONFIDENT: 'underconfident',
  INSUFFICIENT_SAMPLE: 'insufficient_sample',
  UNAVAILABLE: 'unavailable'
});

const CONFIDENCE_SUPPORT_LEVEL = Object.freeze({
  STRONG: 'strong',
  ADEQUATE: 'adequate',
  LIMITED: 'limited',
  WEAK: 'weak',
  UNSUPPORTED: 'unsupported',
  UNKNOWN: 'unknown'
});

const REVIEW_ACTION = Object.freeze({
  NONE: 'none',
  CONTINUE_OFFLINE_MONITORING: 'continue_offline_monitoring',
  COLLECT_MORE_OUTCOMES: 'collect_more_reviewed_outcomes',
  REVIEW_OVERCONFIDENCE: 'review_overconfidence_before_threshold_changes',
  REVIEW_UNDERCONFIDENCE: 'review_underconfidence_before_threshold_changes',
  PROVIDE_CONFIDENCE_AND_OUTCOMES: 'provide_confidence_and_reviewed_outcomes'
});

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }
  return value;
}

function known(value) {
  return value !== undefined && value !== null && value !== '' && value !== UNKNOWN_VALUE;
}

function toNumber(value, fallback = UNKNOWN_VALUE) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function isKnownNumber(value) {
  return Number.isFinite(Number(value));
}

function roundMetric(value) {
  if (!isKnownNumber(value)) return UNKNOWN_VALUE;
  return Math.round(Number(value) * 100) / 100;
}

function pick(sources = [], keys = [], fallback = UNKNOWN_VALUE) {
  for (const source of sources) {
    const object = asObject(source);
    for (const key of keys) {
      if (known(object[key])) {
        return typeof object[key] === 'object' ? clone(object[key]) : object[key];
      }
    }
  }
  return fallback;
}

function pickPositiveNumber(sources = [], keys = [], fallback = 0) {
  for (const source of sources) {
    const object = asObject(source);
    for (const key of keys) {
      if (isKnownNumber(object[key]) && Number(object[key]) > 0) return Number(object[key]);
    }
  }
  return fallback;
}

function getReportedConfidence(input = {}) {
  const confidenceSummary = asObject(firstDefined(input.confidenceSummary, input.confidenceData, input.confidence, {}));
  const marketData = asObject(firstDefined(input.marketData, input.valuationSummary, {}));
  const calibrationReport = asObject(firstDefined(input.confidenceCalibrationReport, input.calibrationReport, {}));
  const summary = asObject(calibrationReport.overallCalibrationSummary);
  return {
    confidence: toNumber(pick([input, confidenceSummary, marketData, summary], [
      'reportedConfidence',
      'confidence',
      'marketConfidence',
      'averageConfidence'
    ])),
    source: pick([confidenceSummary, marketData, input], ['source', 'confidenceSource']),
    cap: pick([confidenceSummary, input], ['cap', 'confidenceCap']),
    bucket: pick([input, confidenceSummary], ['bucket', 'confidenceBucket'])
  };
}

function canEvaluateCalibration(input = {}) {
  return Boolean(
    input.calibrationInput ||
      input.dealerAgreementReport ||
      input.validationReport ||
      input.accuracyValidationReport ||
      input.results ||
      input.records ||
      input.listingAgreementDetails
  );
}

function getCalibrationReport(input = {}) {
  const supplied = firstDefined(input.confidenceCalibrationReport, input.calibrationReport);
  if (supplied && typeof supplied === 'object') return clone(supplied);
  if (!canEvaluateCalibration(input)) return {};
  return evaluateConfidenceCalibration(firstDefined(
    input.calibrationInput,
    input.dealerAgreementReport,
    input.validationReport,
    input.accuracyValidationReport,
    input
  ));
}

function getEvidenceSupport(input = {}) {
  const readiness = asObject(firstDefined(input.evidenceReadinessDiagnosticResult, input.evidenceReadinessDiagnostics, {}));
  const eligible = asObject(readiness.eligibleEvidenceSummary);
  const excluded = asObject(readiness.excludedEvidenceSummary);
  const evidenceSummary = asObject(firstDefined(input.evidenceSummary, input.evidence, {}));
  return {
    readinessStatus: pick([readiness], ['readinessStatus']),
    readinessLevel: pick([readiness], ['readinessLevel']),
    trueSoldDepth: pickPositiveNumber([eligible, evidenceSummary], ['trueSoldEvidenceCount', 'exactComparableCount', 'trueSoldCount', 'soldCompCount'], 0),
    sourceConcentration: clone(asObject(eligible.sourceConcentration)),
    activeListingCount: pickPositiveNumber([excluded, evidenceSummary], ['activeListingCount', 'activeCount', 'activeCompCount'], 0),
    fallbackEvidenceCount: pickPositiveNumber([excluded, evidenceSummary], ['fallbackEvidenceCount', 'fallbackUnknownCount'], evidenceSummary.fallbackOnlyFlag === true ? 1 : 0)
  };
}

function getValuationUncertainty(input = {}) {
  const diagnostic = asObject(firstDefined(
    input.rangeFirstValuationDiagnosticResult,
    input.rangeFirstValuationDiagnostics,
    input.valuationDiagnosticResult,
    input.valuationDiagnostics,
    {}
  ));
  return {
    valuationDiagnosticStatus: pick([diagnostic], ['valuationDiagnosticStatus']),
    uncertaintyLevel: pick([diagnostic], ['uncertaintyLevel']),
    confidenceCapRecommendation: clone(asObject(diagnostic.confidenceCapRecommendation)),
    stableFingerprint: pick([diagnostic], ['stableFingerprint'])
  };
}

function getIdentitySummary(input = {}) {
  const diagnostic = asObject(firstDefined(input.identityDiagnosticResult, input.identityDiagnostics, input.identityParserDiagnostics, {}));
  return {
    diagnosticStatus: pick([diagnostic], ['diagnosticStatus']),
    ambiguityLevel: pick([diagnostic], ['ambiguityLevel']),
    identityEligibility: clone(asObject(diagnostic.identityEligibility)),
    stableFingerprint: pick([diagnostic], ['stableFingerprint'])
  };
}

function getComparableQuality(input = {}) {
  const readiness = asObject(firstDefined(input.evidenceReadinessDiagnosticResult, input.evidenceReadinessDiagnostics, {}));
  const quality = asObject(firstDefined(input.comparableQuality, readiness.comparableQuality, {}));
  return {
    averageComparableQualityScore: pick([quality], ['averageComparableQualityScore', 'comparableQualityScore', 'score']),
    scoredComparableCount: pick([quality], ['scoredComparableCount', 'comparableCount']),
    qualityDistribution: clone(asObject(quality.qualityDistribution)),
    warnings: asArray(quality.warnings).map(String)
  };
}

function getObservedAgreementMetrics(calibrationReport = {}) {
  const summary = asObject(calibrationReport.overallCalibrationSummary);
  return {
    totalListings: toNumber(pick([summary], ['totalListings']), 0),
    withConfidenceCount: toNumber(pick([summary], ['withConfidenceCount']), 0),
    missingConfidenceCount: toNumber(pick([summary], ['missingConfidenceCount']), 0),
    overallAgreementRate: toNumber(pick([summary], ['overallAgreementRate']), UNKNOWN_VALUE),
    averageConfidence: toNumber(pick([summary], ['averageConfidence']), UNKNOWN_VALUE),
    calibrationScore: toNumber(calibrationReport.calibrationScore, UNKNOWN_VALUE)
  };
}

function getOutcomeMetrics(input = {}, calibrationReport = {}) {
  const summary = asObject(calibrationReport.overallCalibrationSummary);
  const accuracy = asObject(firstDefined(input.accuracyValidationReport, input.realListingAccuracyReport, {}));
  const sampleSize = pickPositiveNumber([summary, accuracy], ['totalListings', 'decisiveReviewCount', 'totalListingsReviewed'], 0);
  const falsePositiveRate = toNumber(pick([summary, accuracy], ['falsePositiveRate']), UNKNOWN_VALUE);
  const falseNegativeRate = toNumber(pick([summary, accuracy], ['falseNegativeRate', 'missedOpportunityRate']), UNKNOWN_VALUE);
  const falsePositiveCount = toNumber(pick([summary, accuracy], ['falsePositiveCount']), 0);
  const falseNegativeCount = toNumber(pick([summary, accuracy], ['falseNegativeCount', 'missedOpportunityCount']), 0);
  return {
    outcomeAvailable: sampleSize > 0,
    sampleSize,
    falsePositiveCount,
    falsePositiveRate,
    falseNegativeCount,
    falseNegativeRate,
    missedOpportunityRate: toNumber(pick([accuracy], ['missedOpportunityRate']), falseNegativeRate),
    cardhawkVsDaltonAgreementRate: toNumber(pick([accuracy], ['cardhawkVsDaltonAgreementRate']), UNKNOWN_VALUE)
  };
}

function getCalibrationGap(reported = {}, observed = {}) {
  if (!isKnownNumber(reported.confidence) || !isKnownNumber(observed.overallAgreementRate)) {
    return {
      available: false,
      reportedConfidence: reported.confidence,
      observedAgreementRate: observed.overallAgreementRate,
      gap: UNKNOWN_VALUE,
      direction: UNKNOWN_VALUE
    };
  }

  const gap = roundMetric(Number(reported.confidence) - Number(observed.overallAgreementRate));
  return {
    available: true,
    reportedConfidence: roundMetric(reported.confidence),
    observedAgreementRate: roundMetric(observed.overallAgreementRate),
    gap,
    direction: gap > 0 ? 'reported_above_observed' : gap < 0 ? 'reported_below_observed' : 'aligned'
  };
}

function getConfidenceSupportLevel({ evidenceSupport, valuationUncertainty, identitySummary, comparableQuality }) {
  const readiness = evidenceSupport.readinessStatus;
  const uncertainty = valuationUncertainty.uncertaintyLevel;
  const identityStatus = identitySummary.diagnosticStatus;
  const qualityScore = Number(comparableQuality.averageComparableQualityScore);
  const trueSoldDepth = Number(evidenceSupport.trueSoldDepth || 0);

  if (!known(readiness) && !known(uncertainty) && !known(identityStatus) && !isKnownNumber(qualityScore)) {
    return CONFIDENCE_SUPPORT_LEVEL.UNKNOWN;
  }
  if (readiness === 'blocked' || readiness === 'insufficient' || trueSoldDepth <= 0) {
    return CONFIDENCE_SUPPORT_LEVEL.UNSUPPORTED;
  }
  if (readiness === 'thin' || uncertainty === 'extreme' || identityStatus === 'blocked') {
    return CONFIDENCE_SUPPORT_LEVEL.WEAK;
  }
  if (readiness === 'conditionally_ready' || uncertainty === 'high' || (isKnownNumber(qualityScore) && qualityScore < 60)) {
    return CONFIDENCE_SUPPORT_LEVEL.LIMITED;
  }
  if (trueSoldDepth >= 5 && uncertainty === 'low' && (!isKnownNumber(qualityScore) || qualityScore >= 75)) {
    return CONFIDENCE_SUPPORT_LEVEL.STRONG;
  }
  return CONFIDENCE_SUPPORT_LEVEL.ADEQUATE;
}

function getRiskIndicators({ calibrationReport, calibrationGap, outcomeMetrics, reportedConfidence }) {
  const reportOverconfidence = asArray(calibrationReport.overconfidenceIndicators);
  const reportUnderconfidence = asArray(calibrationReport.underconfidenceIndicators);
  const falsePositiveRate = Number(outcomeMetrics.falsePositiveRate);
  const falseNegativeRate = Number(outcomeMetrics.falseNegativeRate);
  const confidence = Number(reportedConfidence.confidence);
  const gap = Number(calibrationGap.gap);

  const overconfidenceIndicators = [
    ...reportOverconfidence.map((item) => clone(item)),
    calibrationGap.available && gap >= 20 ? { reason: 'reported_confidence_exceeds_observed_agreement_by_20_points', gap } : null,
    Number.isFinite(falsePositiveRate) && falsePositiveRate >= 25 ? { reason: 'false_positive_rate_at_or_above_25_percent', falsePositiveRate } : null,
    Number.isFinite(confidence) && confidence >= 75 && outcomeMetrics.outcomeAvailable === false ? { reason: 'high_confidence_without_reviewed_outcomes', confidence } : null
  ].filter(Boolean);

  const underconfidenceIndicators = [
    ...reportUnderconfidence.map((item) => clone(item)),
    calibrationGap.available && gap <= -20 ? { reason: 'reported_confidence_below_observed_agreement_by_20_points', gap } : null,
    Number.isFinite(falseNegativeRate) && falseNegativeRate >= 25 ? { reason: 'false_negative_or_missed_opportunity_rate_at_or_above_25_percent', falseNegativeRate } : null
  ].filter(Boolean);

  return {
    overconfidenceIndicators,
    underconfidenceIndicators
  };
}

function getStatus({ reportedConfidence, outcomeMetrics, calibrationGap, supportLevel, riskIndicators }) {
  const hasConfidence = isKnownNumber(reportedConfidence.confidence);
  const sampleSize = Number(outcomeMetrics.sampleSize || 0);
  const overRisk = riskIndicators.overconfidenceIndicators.length > 0;
  const underRisk = riskIndicators.underconfidenceIndicators.length > 0;

  if (!hasConfidence && !outcomeMetrics.outcomeAvailable) return CALIBRATION_STATUS.UNAVAILABLE;
  if (sampleSize > 0 && sampleSize < MINIMUM_CALIBRATION_SAMPLE_SIZE) return CALIBRATION_STATUS.INSUFFICIENT_SAMPLE;
  if (!outcomeMetrics.outcomeAvailable) return CALIBRATION_STATUS.UNDER_REVIEW;
  if (overRisk) return CALIBRATION_STATUS.OVERCONFIDENT;
  if (underRisk) return CALIBRATION_STATUS.UNDERCONFIDENT;
  if (supportLevel === CONFIDENCE_SUPPORT_LEVEL.STRONG && calibrationGap.available && Math.abs(Number(calibrationGap.gap)) <= 10) {
    return CALIBRATION_STATUS.CALIBRATED;
  }
  if (calibrationGap.available && Math.abs(Number(calibrationGap.gap)) <= 15) {
    return CALIBRATION_STATUS.PROVISIONALLY_CALIBRATED;
  }
  return CALIBRATION_STATUS.UNDER_REVIEW;
}

function getBlockingReasons({ reportedConfidence, outcomeMetrics, supportLevel }) {
  return collectBlockingReasons([
    { when: !isKnownNumber(reportedConfidence.confidence), reason: 'reported_confidence_missing' },
    { when: outcomeMetrics.outcomeAvailable !== true, reason: 'reviewed_outcomes_missing' },
    {
      when: outcomeMetrics.outcomeAvailable === true && Number(outcomeMetrics.sampleSize || 0) < MINIMUM_CALIBRATION_SAMPLE_SIZE,
      reason: 'sample_size_below_minimum_for_calibration'
    },
    { when: supportLevel === CONFIDENCE_SUPPORT_LEVEL.UNSUPPORTED, reason: 'confidence_not_supported_by_true_sold_evidence' },
    { when: supportLevel === CONFIDENCE_SUPPORT_LEVEL.UNKNOWN, reason: 'confidence_support_evidence_unknown' }
  ]);
}

function getWarnings({ calibrationReport, calibrationGap, supportLevel, valuationUncertainty, outcomeMetrics }) {
  return unique([
    ...asArray(calibrationReport.warnings).map(String),
    supportLevel === CONFIDENCE_SUPPORT_LEVEL.LIMITED ? 'confidence_support_limited_by_evidence_or_uncertainty' : null,
    supportLevel === CONFIDENCE_SUPPORT_LEVEL.WEAK ? 'confidence_support_weak' : null,
    valuationUncertainty.uncertaintyLevel === 'high' ? 'valuation_uncertainty_high' : null,
    valuationUncertainty.uncertaintyLevel === 'extreme' ? 'valuation_uncertainty_extreme' : null,
    calibrationGap.available && Math.abs(Number(calibrationGap.gap)) > 15 ? 'calibration_gap_exceeds_15_points' : null,
    outcomeMetrics.outcomeAvailable === true && Number(outcomeMetrics.sampleSize || 0) < MINIMUM_CALIBRATION_SAMPLE_SIZE ? 'calibration_sample_size_small' : null
  ].filter(Boolean));
}

function getRecommendedConfidenceCap({ status, reportedConfidence, supportLevel, valuationUncertainty }) {
  const reported = isKnownNumber(reportedConfidence.confidence) ? Number(reportedConfidence.confidence) : 0;
  const supportCap = {
    [CONFIDENCE_SUPPORT_LEVEL.STRONG]: 100,
    [CONFIDENCE_SUPPORT_LEVEL.ADEQUATE]: 85,
    [CONFIDENCE_SUPPORT_LEVEL.LIMITED]: 70,
    [CONFIDENCE_SUPPORT_LEVEL.WEAK]: 50,
    [CONFIDENCE_SUPPORT_LEVEL.UNSUPPORTED]: 25,
    [CONFIDENCE_SUPPORT_LEVEL.UNKNOWN]: 50
  }[supportLevel] || 50;
  const valuationCap = Number(asObject(valuationUncertainty.confidenceCapRecommendation).recommendedCap);
  const statusCap = {
    [CALIBRATION_STATUS.CALIBRATED]: 100,
    [CALIBRATION_STATUS.PROVISIONALLY_CALIBRATED]: 85,
    [CALIBRATION_STATUS.UNDER_REVIEW]: 70,
    [CALIBRATION_STATUS.OVERCONFIDENT]: 60,
    [CALIBRATION_STATUS.UNDERCONFIDENT]: 85,
    [CALIBRATION_STATUS.INSUFFICIENT_SAMPLE]: 50,
    [CALIBRATION_STATUS.UNAVAILABLE]: 0
  }[status] || 50;
  const caps = [supportCap, statusCap].filter(Number.isFinite);
  if (Number.isFinite(valuationCap)) caps.push(valuationCap);
  return {
    recommendedCap: Math.min(...caps),
    currentReportedConfidence: reported || UNKNOWN_VALUE,
    reason: status === CALIBRATION_STATUS.CALIBRATED
      ? 'offline_calibration_supports_reported_confidence'
      : 'offline_calibration_limits_confidence_interpretation'
  };
}

function getReviewAction(status) {
  if (status === CALIBRATION_STATUS.CALIBRATED) return REVIEW_ACTION.NONE;
  if (status === CALIBRATION_STATUS.PROVISIONALLY_CALIBRATED) return REVIEW_ACTION.CONTINUE_OFFLINE_MONITORING;
  if (status === CALIBRATION_STATUS.OVERCONFIDENT) return REVIEW_ACTION.REVIEW_OVERCONFIDENCE;
  if (status === CALIBRATION_STATUS.UNDERCONFIDENT) return REVIEW_ACTION.REVIEW_UNDERCONFIDENCE;
  if (status === CALIBRATION_STATUS.INSUFFICIENT_SAMPLE || status === CALIBRATION_STATUS.UNDER_REVIEW) {
    return REVIEW_ACTION.COLLECT_MORE_OUTCOMES;
  }
  return REVIEW_ACTION.PROVIDE_CONFIDENCE_AND_OUTCOMES;
}

function buildConfidenceCalibrationDiagnosticFingerprint(result = {}) {
  const projection = clone(result);
  delete projection.stableFingerprint;
  return buildFingerprintFromProjection(projection);
}

function evaluateConfidenceCalibrationDiagnostic(input = {}) {
  const reportedConfidence = getReportedConfidence(input);
  const calibrationReport = getCalibrationReport(input);
  const evidenceSupport = getEvidenceSupport(input);
  const valuationUncertainty = getValuationUncertainty(input);
  const identitySummary = getIdentitySummary(input);
  const comparableQuality = getComparableQuality(input);
  const confidenceSupportLevel = getConfidenceSupportLevel({
    evidenceSupport,
    valuationUncertainty,
    identitySummary,
    comparableQuality
  });
  const observedAgreementMetrics = getObservedAgreementMetrics(calibrationReport);
  const availableOutcomeMetrics = getOutcomeMetrics(input, calibrationReport);
  const calibrationGap = getCalibrationGap(reportedConfidence, observedAgreementMetrics);
  const riskIndicators = getRiskIndicators({
    calibrationReport,
    calibrationGap,
    outcomeMetrics: availableOutcomeMetrics,
    reportedConfidence
  });
  const calibrationStatus = getStatus({
    reportedConfidence,
    outcomeMetrics: availableOutcomeMetrics,
    calibrationGap,
    supportLevel: confidenceSupportLevel,
    riskIndicators
  });
  const blockingReasons = getBlockingReasons({
    reportedConfidence,
    outcomeMetrics: availableOutcomeMetrics,
    supportLevel: confidenceSupportLevel
  });
  const warnings = getWarnings({
    calibrationReport,
    calibrationGap,
    supportLevel: confidenceSupportLevel,
    valuationUncertainty,
    outcomeMetrics: availableOutcomeMetrics
  });

  const result = {
    source: CONFIDENCE_CALIBRATION_DIAGNOSTIC_SOURCE,
    schemaVersion: CONFIDENCE_CALIBRATION_DIAGNOSTIC_SCHEMA_VERSION,
    productionImpact: 'none',
    decisionImpact: 'none',
    calibrationStatus,
    confidenceSupportLevel,
    reportedConfidence,
    evidenceSupport,
    valuationUncertainty,
    identitySummary,
    comparableQuality,
    observedAgreementMetrics,
    availableOutcomeMetrics,
    calibrationGap,
    overconfidenceIndicators: riskIndicators.overconfidenceIndicators,
    underconfidenceIndicators: riskIndicators.underconfidenceIndicators,
    blockingReasons,
    warnings,
    recommendedConfidenceCap: {},
    recommendedReviewAction: getReviewAction(calibrationStatus),
    stableFingerprint: ''
  };

  result.recommendedConfidenceCap = getRecommendedConfidenceCap({
    status: calibrationStatus,
    reportedConfidence,
    supportLevel: confidenceSupportLevel,
    valuationUncertainty
  });
  result.stableFingerprint = buildConfidenceCalibrationDiagnosticFingerprint(result);

  if (typeof confidenceEngine.evaluateConfidence !== 'function') {
    result.warnings = unique([...result.warnings, 'confidence_engine_contract_unavailable']);
    result.stableFingerprint = buildConfidenceCalibrationDiagnosticFingerprint(result);
  }

  return deepFreeze(result);
}

function summarizeConfidenceCalibrationDiagnostic(result = {}) {
  const status = result.calibrationStatus || CALIBRATION_STATUS.UNAVAILABLE;
  if (status === CALIBRATION_STATUS.CALIBRATED) return 'Confidence is calibrated against the supplied offline reviewed outcomes.';
  if (status === CALIBRATION_STATUS.PROVISIONALLY_CALIBRATED) return 'Confidence is provisionally calibrated and should continue offline monitoring.';
  if (status === CALIBRATION_STATUS.OVERCONFIDENT) return 'Confidence appears overconfident relative to reviewed outcomes or evidence support.';
  if (status === CALIBRATION_STATUS.UNDERCONFIDENT) return 'Confidence appears underconfident relative to reviewed outcomes.';
  if (status === CALIBRATION_STATUS.INSUFFICIENT_SAMPLE) return 'Confidence calibration has reviewed outcomes but the sample is too small.';
  if (status === CALIBRATION_STATUS.UNDER_REVIEW) return 'Confidence calibration requires additional reviewed outcomes before interpretation.';
  return 'Confidence calibration is unavailable because confidence or reviewed outcomes are missing.';
}

module.exports = {
  CALIBRATION_STATUS,
  CONFIDENCE_CALIBRATION_DIAGNOSTIC_SCHEMA_VERSION,
  CONFIDENCE_CALIBRATION_DIAGNOSTIC_SOURCE,
  CONFIDENCE_SUPPORT_LEVEL,
  MINIMUM_CALIBRATION_SAMPLE_SIZE,
  REVIEW_ACTION,
  UNKNOWN_VALUE,
  buildConfidenceCalibrationDiagnosticFingerprint,
  evaluateConfidenceCalibrationDiagnostic,
  summarizeConfidenceCalibrationDiagnostic
};
