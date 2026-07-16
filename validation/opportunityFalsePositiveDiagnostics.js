'use strict';

const roiEngine = require('../engines/roiEngine');
const riskEngine = require('../engines/riskEngine');
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

const OPPORTUNITY_FALSE_POSITIVE_DIAGNOSTIC_SCHEMA_VERSION = '1.0.0';
const OPPORTUNITY_FALSE_POSITIVE_DIAGNOSTIC_SOURCE = 'opportunity_false_positive_diagnostics';
const UNKNOWN_VALUE = 'unknown';

const FALSE_POSITIVE_RISK_STATUS = Object.freeze({
  LOW_RISK: 'low_risk',
  REVIEW: 'review',
  ELEVATED_RISK: 'elevated_risk',
  HIGH_RISK: 'high_risk',
  LIKELY_FALSE_POSITIVE: 'likely_false_positive',
  UNAVAILABLE: 'unavailable'
});

const FALSE_POSITIVE_RISK_LEVEL = Object.freeze({
  LOW: 'low',
  MODERATE: 'moderate',
  HIGH: 'high',
  CRITICAL: 'critical',
  UNKNOWN: 'unknown'
});

const REVIEW_ACTION = Object.freeze({
  NONE: 'none',
  MANUAL_REVIEW: 'manual_false_positive_review',
  RESOLVE_CRITICAL_BLOCKERS: 'resolve_critical_blockers_before_reliance',
  COLLECT_MISSING_DIAGNOSTICS: 'collect_missing_diagnostics_before_reliance',
  REVIEW_CONFLICTING_SIGNALS: 'review_conflicting_signals_before_reliance'
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

function isKnownNumber(value) {
  return Number.isFinite(Number(value));
}

function pick(sources = [], keys = [], fallback = UNKNOWN_VALUE) {
  for (const source of sources) {
    const object = asObject(source);
    for (const key of keys) {
      if (known(object[key])) return typeof object[key] === 'object' ? clone(object[key]) : object[key];
    }
  }
  return fallback;
}

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function getDiagnostic(input = {}, keys = []) {
  return asObject(firstDefined(...keys.map((key) => input[key]), {}));
}

function getDealGateOutcome(input = {}) {
  const dealGate = asObject(firstDefined(input.dealGateOutcome, input.dealGate, input.listing?.dealGate, {}));
  const outcomeAvailable = Object.keys(dealGate).length > 0;
  const decision = pick([dealGate], ['decision', 'recommendation']);
  const passed = outcomeAvailable && known(dealGate.passed) ? dealGate.passed === true : UNKNOWN_VALUE;
  const buyNowAllowed = outcomeAvailable && known(dealGate.buyNowAllowed)
    ? dealGate.buyNowAllowed === true
    : outcomeAvailable && (decision === 'BUY_NOW' || passed === true)
      ? true
      : outcomeAvailable
        ? false
        : UNKNOWN_VALUE;

  return {
    available: outcomeAvailable,
    passed,
    decision,
    recommendation: pick([dealGate], ['recommendation', 'decision']),
    buyNowAllowed,
    reasons: asArray(dealGate.reasons).map(String),
    positives: asArray(dealGate.positives).map(String),
    failedRules: asArray(dealGate.dealGateBreakdown?.failedRules).map(String)
  };
}

function getBuyNowEligibility(input = {}, dealGateOutcome = {}) {
  const supplied = firstDefined(input.buyNowEligibility, input.buyNow, input.buyNowAllowed);
  if (typeof supplied === 'object' && supplied !== null) {
    return {
      eligible: known(supplied.eligible) ? supplied.eligible === true : UNKNOWN_VALUE,
      source: pick([supplied], ['source', 'authority']),
      changesProductionBehavior: false
    };
  }

  return {
    eligible: known(supplied) ? supplied === true : dealGateOutcome.buyNowAllowed,
    source: known(supplied) ? 'supplied_buy_now_eligibility' : dealGateOutcome.available ? 'deal_gate' : UNKNOWN_VALUE,
    changesProductionBehavior: false
  };
}

function getRoiSummary(input = {}) {
  const supplied = asObject(firstDefined(input.roiSummary, input.roiData, input.roiResult, {}));
  return {
    available: Object.keys(supplied).length > 0,
    ...roiEngine.summarizeROI(supplied)
  };
}

function getRiskSummary(input = {}) {
  const supplied = asObject(firstDefined(input.riskSummary, input.riskData, {}));
  return riskEngine.summarizeRisk(supplied);
}

function getPriceContext(input = {}) {
  const listing = asObject(firstDefined(input.listing, input.productionListing, {}));
  const marketData = asObject(firstDefined(input.marketData, input.valuationSummary, input.valuation, {}));
  const acquisitionPrice = toNumber(pick([input, listing], ['acquisitionPrice', 'totalCost', 'price', 'currentPrice', 'askingPrice']));
  const productionEstimate = toNumber(pick([input, marketData], ['productionEstimate', 'estimatedValue', 'marketValue', 'expectedValue']));
  const ratio = isKnownNumber(acquisitionPrice) && isKnownNumber(productionEstimate) && Number(productionEstimate) > 0
    ? Math.round((Number(acquisitionPrice) / Number(productionEstimate)) * 1000) / 1000
    : UNKNOWN_VALUE;

  return {
    acquisitionPrice,
    productionEstimate,
    acquisitionToEstimateRatio: ratio,
    suspiciouslyLowPrice: isKnownNumber(ratio) && Number(ratio) < 0.2
  };
}

function collectIndicators({ identity, evidence, valuation, confidence, listingQuality, roiSummary, riskSummary, priceContext }) {
  const weakEvidenceIndicators = unique([
    ['thin', 'insufficient', 'blocked', 'unavailable'].includes(evidence.readinessStatus) ? `evidence_readiness_${evidence.readinessStatus}` : null,
    asObject(evidence.valuationReadiness).shouldWithholdValuationDiagnostically === true ? 'evidence_readiness_recommends_withholding' : null,
    ...asArray(evidence.blockingReasons)
  ].filter(Boolean));

  const identityRiskIndicators = unique([
    ['ambiguous', 'unsupported', 'blocked', 'partial'].includes(identity.diagnosticStatus) ? `identity_${identity.diagnosticStatus}` : null,
    identity.ambiguityLevel && !['none', 'low', UNKNOWN_VALUE].includes(identity.ambiguityLevel) ? `identity_ambiguity_${identity.ambiguityLevel}` : null,
    ...asArray(identity.blockingIssues)
  ].filter(Boolean));

  const valuationRiskIndicators = unique([
    ['weakly_supported', 'withheld', 'unavailable'].includes(valuation.valuationDiagnosticStatus) ? `valuation_${valuation.valuationDiagnosticStatus}` : null,
    ['high', 'extreme', 'unknown'].includes(valuation.uncertaintyLevel) ? `valuation_uncertainty_${valuation.uncertaintyLevel}` : null,
    valuation.pointEstimateAssessment?.pointInsideSupportedRange === false ? 'point_estimate_outside_supported_range' : null,
    ...asArray(valuation.blockingReasons)
  ].filter(Boolean));

  const confidenceRiskIndicators = unique([
    ['overconfident', 'insufficient_sample', 'unavailable', 'under_review'].includes(confidence.calibrationStatus) ? `confidence_${confidence.calibrationStatus}` : null,
    ['weak', 'unsupported', 'unknown'].includes(confidence.confidenceSupportLevel) ? `confidence_support_${confidence.confidenceSupportLevel}` : null,
    ...asArray(confidence.blockingReasons)
  ].filter(Boolean));

  const listingQualityGradingRiskIndicators = unique([
    ['blocked', 'high_risk', 'unavailable'].includes(listingQuality.listingQualityStatus) ? `listing_quality_${listingQuality.listingQualityStatus}` : null,
    ['ambiguous', 'unsupported', 'high_risk', 'unavailable'].includes(listingQuality.gradingDiagnosticStatus) ? `grading_${listingQuality.gradingDiagnosticStatus}` : null,
    ...asArray(listingQuality.blockingIssues)
  ].filter(Boolean));

  const roiAvailable = roiSummary.available === true;
  const roiFragilityIndicators = unique([
    roiAvailable && roiSummary.roiTier && ['weak', 'bad', 'unknown'].includes(roiSummary.roiTier) ? `roi_tier_${roiSummary.roiTier}` : null,
    roiAvailable && isKnownNumber(roiSummary.riskAdjustedProfit) && Number(roiSummary.riskAdjustedProfit) <= 0 ? 'risk_adjusted_profit_not_positive' : null,
    roiAvailable && isKnownNumber(roiSummary.marginOfSafetyPercent) && Number(roiSummary.marginOfSafetyPercent) < 8 ? 'margin_of_safety_below_8_percent' : null,
    roiAvailable && isKnownNumber(roiSummary.roiPercent) && Number(roiSummary.roiPercent) > 150 ? 'roi_above_150_percent_requires_strong_support' : null
  ].filter(Boolean));

  const suspiciousPriceIndicators = unique([
    priceContext.suspiciouslyLowPrice ? 'acquisition_price_below_20_percent_of_estimate' : null,
    roiAvailable && isKnownNumber(roiSummary.roiPercent) && Number(roiSummary.roiPercent) > 250 ? 'roi_above_250_percent_suspicious' : null
  ].filter(Boolean));

  const riskSummaryIndicators = unique([
    ['high', 'critical', 'severe', 'very_high'].includes(normalize(riskSummary.riskLevel)) ? `risk_level_${riskSummary.riskLevel}` : null
  ].filter(Boolean));

  return {
    weakEvidenceIndicators,
    identityRiskIndicators,
    valuationRiskIndicators,
    confidenceRiskIndicators,
    listingQualityGradingRiskIndicators,
    roiFragilityIndicators,
    suspiciousPriceIndicators,
    riskSummaryIndicators
  };
}

function getCriticalBlockers(indicators = {}) {
  return unique([
    ...indicators.weakEvidenceIndicators.filter((item) => /blocked|insufficient|withholding|active|fallback/i.test(item)),
    ...indicators.identityRiskIndicators.filter((item) => /blocked|unsupported|ambiguity_high|ambiguity_blocking/i.test(item)),
    ...indicators.valuationRiskIndicators.filter((item) => /withheld|unavailable|outside_supported_range|uncertainty_extreme/i.test(item)),
    ...indicators.confidenceRiskIndicators.filter((item) => /overconfident|unsupported|unavailable/i.test(item)),
    ...indicators.listingQualityGradingRiskIndicators.filter((item) => /blocked|high_risk|reprint|proxy|altered|lot|raw_vs_graded/i.test(item)),
    ...indicators.roiFragilityIndicators.filter((item) => /risk_adjusted_profit_not_positive|roi_above_150/i.test(item)),
    ...indicators.suspiciousPriceIndicators
  ]);
}

function getMaterialWarnings(indicators = {}, missingDiagnostics = []) {
  return unique([
    ...indicators.weakEvidenceIndicators,
    ...indicators.identityRiskIndicators,
    ...indicators.valuationRiskIndicators,
    ...indicators.confidenceRiskIndicators,
    ...indicators.listingQualityGradingRiskIndicators,
    ...indicators.roiFragilityIndicators,
    ...indicators.suspiciousPriceIndicators,
    ...indicators.riskSummaryIndicators,
    ...missingDiagnostics.map((item) => `missing_${item}`)
  ]);
}

function getSupportingFactors({ evidence, valuation, confidence, listingQuality, roiSummary, riskSummary }) {
  return unique([
    evidence.readinessStatus === 'ready' ? 'evidence_ready' : null,
    valuation.valuationDiagnosticStatus === 'supported' ? 'valuation_supported' : null,
    confidence.calibrationStatus === 'calibrated' ? 'confidence_calibrated' : null,
    listingQuality.listingQualityStatus === 'strong' ? 'listing_quality_strong' : null,
    listingQuality.gradingDiagnosticStatus === 'confirmed' ? 'grading_confirmed' : null,
    roiSummary.available === true && roiSummary.roiTier && ['good', 'excellent'].includes(roiSummary.roiTier) ? `roi_${roiSummary.roiTier}` : null,
    ['low', 'medium'].includes(normalize(riskSummary.riskLevel)) ? `risk_${riskSummary.riskLevel}` : null
  ].filter(Boolean));
}

function getMissingDiagnostics(input = {}) {
  const required = [
    ['identity_diagnostics', ['identityDiagnosticResult', 'identityDiagnostics', 'identityParserDiagnostics']],
    ['evidence_readiness_diagnostics', ['evidenceReadinessDiagnosticResult', 'evidenceReadinessDiagnostics']],
    ['range_first_valuation_diagnostics', ['rangeFirstValuationDiagnosticResult', 'rangeFirstValuationDiagnostics', 'valuationDiagnosticResult', 'valuationDiagnostics']],
    ['confidence_calibration_diagnostics', ['confidenceCalibrationDiagnosticResult', 'confidenceCalibrationDiagnostics']],
    ['listing_quality_grading_diagnostics', ['listingQualityGradingDiagnosticResult', 'listingQualityGradingDiagnostics']]
  ];

  return required
    .filter(([, keys]) => !keys.some((key) => input[key] && typeof input[key] === 'object'))
    .map(([name]) => name);
}

function getConflictingSignals({ dealGateOutcome, buyNowEligibility, criticalBlockers, materialWarnings, supportingFactors }) {
  const positiveGate = dealGateOutcome.passed === true || buyNowEligibility.eligible === true || dealGateOutcome.decision === 'BUY_NOW';
  return unique([
    positiveGate && criticalBlockers.length ? 'positive_deal_gate_or_buy_now_with_critical_diagnostic_blockers' : null,
    positiveGate && materialWarnings.length ? 'positive_deal_gate_or_buy_now_with_material_diagnostic_warnings' : null,
    supportingFactors.length && criticalBlockers.length ? 'supporting_factors_conflict_with_blockers' : null
  ].filter(Boolean));
}

function getStatus({ criticalBlockers, materialWarnings, missingDiagnostics, dealGateOutcome, buyNowEligibility }) {
  const positiveGate = dealGateOutcome.passed === true || buyNowEligibility.eligible === true || dealGateOutcome.decision === 'BUY_NOW';
  if (!dealGateOutcome.available && buyNowEligibility.eligible === UNKNOWN_VALUE && missingDiagnostics.length >= 5) {
    return FALSE_POSITIVE_RISK_STATUS.UNAVAILABLE;
  }
  if (positiveGate && criticalBlockers.length >= 2) return FALSE_POSITIVE_RISK_STATUS.LIKELY_FALSE_POSITIVE;
  if (criticalBlockers.length >= 2) return FALSE_POSITIVE_RISK_STATUS.HIGH_RISK;
  if (criticalBlockers.length === 1) return FALSE_POSITIVE_RISK_STATUS.ELEVATED_RISK;
  if (materialWarnings.length || missingDiagnostics.length) return FALSE_POSITIVE_RISK_STATUS.REVIEW;
  return FALSE_POSITIVE_RISK_STATUS.LOW_RISK;
}

function getRiskLevel(status) {
  if (status === FALSE_POSITIVE_RISK_STATUS.LIKELY_FALSE_POSITIVE) return FALSE_POSITIVE_RISK_LEVEL.CRITICAL;
  if (status === FALSE_POSITIVE_RISK_STATUS.HIGH_RISK || status === FALSE_POSITIVE_RISK_STATUS.ELEVATED_RISK) return FALSE_POSITIVE_RISK_LEVEL.HIGH;
  if (status === FALSE_POSITIVE_RISK_STATUS.REVIEW) return FALSE_POSITIVE_RISK_LEVEL.MODERATE;
  if (status === FALSE_POSITIVE_RISK_STATUS.LOW_RISK) return FALSE_POSITIVE_RISK_LEVEL.LOW;
  return FALSE_POSITIVE_RISK_LEVEL.UNKNOWN;
}

function getReviewAction(status, conflictingSignals = []) {
  if (status === FALSE_POSITIVE_RISK_STATUS.LOW_RISK) return REVIEW_ACTION.NONE;
  if (status === FALSE_POSITIVE_RISK_STATUS.UNAVAILABLE) return REVIEW_ACTION.COLLECT_MISSING_DIAGNOSTICS;
  if (status === FALSE_POSITIVE_RISK_STATUS.LIKELY_FALSE_POSITIVE || status === FALSE_POSITIVE_RISK_STATUS.HIGH_RISK) {
    return REVIEW_ACTION.RESOLVE_CRITICAL_BLOCKERS;
  }
  if (conflictingSignals.length) return REVIEW_ACTION.REVIEW_CONFLICTING_SIGNALS;
  return REVIEW_ACTION.MANUAL_REVIEW;
}

function buildOpportunityFalsePositiveFingerprint(result = {}) {
  const projection = clone(result);
  delete projection.stableFingerprint;
  return buildFingerprintFromProjection(projection);
}

function evaluateOpportunityFalsePositiveRisk(input = {}) {
  const identity = getDiagnostic(input, ['identityDiagnosticResult', 'identityDiagnostics', 'identityParserDiagnostics']);
  const evidence = getDiagnostic(input, ['evidenceReadinessDiagnosticResult', 'evidenceReadinessDiagnostics']);
  const valuation = getDiagnostic(input, ['rangeFirstValuationDiagnosticResult', 'rangeFirstValuationDiagnostics', 'valuationDiagnosticResult', 'valuationDiagnostics']);
  const confidence = getDiagnostic(input, ['confidenceCalibrationDiagnosticResult', 'confidenceCalibrationDiagnostics']);
  const listingQuality = getDiagnostic(input, ['listingQualityGradingDiagnosticResult', 'listingQualityGradingDiagnostics']);
  const dealGateOutcome = getDealGateOutcome(input);
  const buyNowEligibility = getBuyNowEligibility(input, dealGateOutcome);
  const roiSummary = getRoiSummary(input);
  const riskSummary = getRiskSummary(input);
  const priceContext = getPriceContext(input);
  const missingDiagnostics = getMissingDiagnostics(input);
  const indicators = collectIndicators({
    identity,
    evidence,
    valuation,
    confidence,
    listingQuality,
    roiSummary,
    riskSummary,
    priceContext
  });
  const criticalBlockers = getCriticalBlockers(indicators);
  const materialWarnings = getMaterialWarnings(indicators, missingDiagnostics);
  const supportingFactors = getSupportingFactors({ evidence, valuation, confidence, listingQuality, roiSummary, riskSummary });
  const conflictingSignals = getConflictingSignals({
    dealGateOutcome,
    buyNowEligibility,
    criticalBlockers,
    materialWarnings,
    supportingFactors
  });
  const falsePositiveRiskStatus = getStatus({
    criticalBlockers,
    materialWarnings,
    missingDiagnostics,
    dealGateOutcome,
    buyNowEligibility
  });
  const falsePositiveRiskLevel = getRiskLevel(falsePositiveRiskStatus);

  const result = {
    source: OPPORTUNITY_FALSE_POSITIVE_DIAGNOSTIC_SOURCE,
    schemaVersion: OPPORTUNITY_FALSE_POSITIVE_DIAGNOSTIC_SCHEMA_VERSION,
    productionImpact: 'none',
    decisionImpact: 'none',
    falsePositiveRiskStatus,
    falsePositiveRiskLevel,
    dealGateOutcome,
    buyNowEligibility,
    criticalBlockers,
    materialWarnings,
    supportingFactors,
    conflictingSignals,
    weakEvidenceIndicators: indicators.weakEvidenceIndicators,
    identityRiskIndicators: indicators.identityRiskIndicators,
    valuationRiskIndicators: indicators.valuationRiskIndicators,
    confidenceRiskIndicators: indicators.confidenceRiskIndicators,
    listingQualityAndGradingRiskIndicators: indicators.listingQualityGradingRiskIndicators,
    roiFragilityIndicators: indicators.roiFragilityIndicators,
    suspiciousPriceIndicators: indicators.suspiciousPriceIndicators,
    roiSummary,
    riskSummary,
    productionEstimateAndAcquisitionPriceContext: priceContext,
    missingDiagnostics,
    recommendedReviewAction: getReviewAction(falsePositiveRiskStatus, conflictingSignals),
    productionAuthorityStatement: 'Diagnostic only. Deal Gate remains the authoritative production BUY_NOW boundary; this result does not change production scoring, valuation, ROI, confidence, Deal Gate, BUY_NOW, notifications, marketplace behavior, server.js, or scan timing.',
    stableFingerprint: ''
  };

  result.stableFingerprint = buildOpportunityFalsePositiveFingerprint(result);
  return deepFreeze(result);
}

function summarizeOpportunityFalsePositiveRisk(result = {}) {
  const status = result.falsePositiveRiskStatus || FALSE_POSITIVE_RISK_STATUS.UNAVAILABLE;
  return `False-positive diagnostic status is ${status}; production authority remains Deal Gate.`;
}

module.exports = {
  FALSE_POSITIVE_RISK_LEVEL,
  FALSE_POSITIVE_RISK_STATUS,
  OPPORTUNITY_FALSE_POSITIVE_DIAGNOSTIC_SCHEMA_VERSION,
  OPPORTUNITY_FALSE_POSITIVE_DIAGNOSTIC_SOURCE,
  REVIEW_ACTION,
  UNKNOWN_VALUE,
  buildOpportunityFalsePositiveFingerprint,
  evaluateOpportunityFalsePositiveRisk,
  summarizeOpportunityFalsePositiveRisk
};
