'use strict';

const valuationRangeEngine = require('../engines/valuationRangeEngine');
const marketValueEngine = require('../engines/marketValueEngine');
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
  READINESS_STATUS,
  UNKNOWN_VALUE,
  evaluateEvidenceReadiness
} = require('./evidenceReadinessDiagnostics');

const RANGE_FIRST_VALUATION_DIAGNOSTIC_SCHEMA_VERSION = '1.0.0';
const RANGE_FIRST_VALUATION_DIAGNOSTIC_SOURCE = 'range_first_valuation_diagnostics';

const VALUATION_DIAGNOSTIC_STATUS = Object.freeze({
  SUPPORTED: 'supported',
  SUPPORTED_WITH_WIDE_RANGE: 'supported_with_wide_range',
  CONDITIONALLY_SUPPORTED: 'conditionally_supported',
  WEAKLY_SUPPORTED: 'weakly_supported',
  WITHHELD: 'withheld',
  UNAVAILABLE: 'unavailable'
});

const UNCERTAINTY_LEVEL = Object.freeze({
  LOW: 'low',
  MODERATE: 'moderate',
  HIGH: 'high',
  EXTREME: 'extreme',
  UNKNOWN: 'unknown'
});

const REVIEW_ACTION = Object.freeze({
  NONE: 'none',
  REVIEW_RANGE_UNCERTAINTY: 'review_range_uncertainty',
  COLLECT_STRONGER_SOLD_EVIDENCE: 'collect_stronger_sold_evidence',
  WITHHOLD_POINT_VALUATION_INTERPRETATION: 'withhold_point_valuation_interpretation',
  PROVIDE_POINT_AND_RANGE_EVIDENCE: 'provide_point_and_range_evidence'
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
  return value !== undefined && value !== null && value !== '';
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
  return Math.round(Number(value) * 10000) / 10000;
}

function roundMoney(value) {
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

function normalizeString(value) {
  return String(value || '').trim().toLowerCase();
}

function getPointEstimate(input = {}) {
  const marketData = asObject(firstDefined(input.marketData, input.valuationSummary, input.valuation, {}));
  const marketSummary = typeof marketValueEngine.summarizeMarketValue === 'function'
    ? marketValueEngine.summarizeMarketValue(marketData)
    : marketData;
  const value = pick(
    [input, marketData, marketSummary],
    ['productionPointEstimate', 'pointEstimate', 'estimatedValue', 'marketValue', 'expectedValue'],
    UNKNOWN_VALUE
  );

  return {
    value: isKnownNumber(value) && Number(value) > 0 ? roundMoney(value) : UNKNOWN_VALUE,
    source: pick([input, marketData, marketSummary], ['pointEstimateSource', 'source', 'valuationSource']),
    method: pick([marketData, marketSummary], ['method']),
    confidence: pick([marketData, marketSummary], ['confidence', 'marketConfidence'])
  };
}

function getSuppliedRange(input = {}) {
  const marketData = asObject(firstDefined(input.marketData, input.valuationSummary, input.valuation, {}));
  const range = asObject(firstDefined(input.valuationRange, input.rangeFirstValuationRange, marketData.valuationRange, {}));
  const priceRange = asObject(firstDefined(range.priceRange, marketData.priceRange, {}));
  return {
    floorValue: pick([range, marketData, priceRange], ['floorValue', 'lowerBound', 'low', 'expectedValueLow']),
    expectedValue: pick([range, marketData], ['expectedValue', 'midpoint', 'marketValue']),
    ceilingValue: pick([range, marketData, priceRange], ['ceilingValue', 'upperBound', 'high', 'expectedValueHigh']),
    confidence: pick([range, marketData], ['confidence']),
    rangeQuality: pick([range], ['rangeQuality']),
    basis: clone(asObject(range.basis)),
    adjustments: clone(asObject(range.adjustments)),
    warnings: asArray(firstDefined(range.warnings, marketData.warnings)).map(String)
  };
}

function canEvaluateRange(input = {}) {
  if (input.evaluateValuationRange === false) return false;
  return Boolean(
    input.evidenceSummary ||
      input.soldSales ||
      input.soldComps ||
      input.comparableQuality ||
      input.evidenceSufficiency
  );
}

function getRange(input = {}) {
  const supplied = getSuppliedRange(input);
  const hasSuppliedBounds = isKnownNumber(supplied.floorValue) || isKnownNumber(supplied.expectedValue) || isKnownNumber(supplied.ceilingValue);
  if (hasSuppliedBounds) return supplied;
  if (!canEvaluateRange(input)) return supplied;
  return valuationRangeEngine.evaluateValuationRange(input);
}

function getEvidenceReadiness(input = {}) {
  const supplied = firstDefined(input.evidenceReadinessDiagnosticResult, input.evidenceReadinessDiagnostics);
  if (supplied && typeof supplied === 'object') return clone(supplied);
  return evaluateEvidenceReadiness(input);
}

function getComparableQualitySummary(input = {}, evidenceReadiness = {}) {
  const supplied = asObject(firstDefined(input.comparableQuality, evidenceReadiness.comparableQuality, {}));
  return {
    averageComparableQualityScore: pick([supplied], ['averageComparableQualityScore', 'score', 'comparableQualityScore']),
    scoredComparableCount: pick([supplied], ['scoredComparableCount', 'comparableCount']),
    qualityDistribution: clone(asObject(supplied.qualityDistribution)),
    warnings: asArray(supplied.warnings).map(String)
  };
}

function getRangeAssessment(range = {}) {
  const lowerBound = isKnownNumber(range.floorValue) ? roundMoney(range.floorValue) : UNKNOWN_VALUE;
  const midpoint = isKnownNumber(range.expectedValue) ? roundMoney(range.expectedValue) : UNKNOWN_VALUE;
  const upperBound = isKnownNumber(range.ceilingValue) ? roundMoney(range.ceilingValue) : UNKNOWN_VALUE;
  const hasRange = isKnownNumber(lowerBound) && isKnownNumber(upperBound) && Number(upperBound) > 0 && Number(lowerBound) > 0;
  const spreadWidth = hasRange ? roundMoney(Number(upperBound) - Number(lowerBound)) : UNKNOWN_VALUE;
  const spreadPercentage = hasRange && isKnownNumber(midpoint) && Number(midpoint) > 0
    ? roundMetric(spreadWidth / Number(midpoint))
    : UNKNOWN_VALUE;

  return {
    available: hasRange,
    lowerBound,
    midpoint,
    upperBound,
    spreadWidth,
    spreadPercentage,
    rangeQuality: pick([range], ['rangeQuality']),
    confidence: pick([range], ['confidence']),
    rangeWarnings: asArray(range.warnings).map(String),
    basis: clone(asObject(range.basis)),
    adjustments: clone(asObject(range.adjustments))
  };
}

function getPointEstimateAssessment(point = {}, rangeAssessment = {}) {
  const pointEstimate = point.value;
  const hasPoint = isKnownNumber(pointEstimate) && Number(pointEstimate) > 0;
  const hasRange = rangeAssessment.available === true;
  let pointInsideSupportedRange = UNKNOWN_VALUE;
  let position = UNKNOWN_VALUE;
  let distanceFromRange = UNKNOWN_VALUE;

  if (hasPoint && hasRange) {
    const pointValue = Number(pointEstimate);
    const lower = Number(rangeAssessment.lowerBound);
    const upper = Number(rangeAssessment.upperBound);
    pointInsideSupportedRange = pointValue >= lower && pointValue <= upper;
    if (pointInsideSupportedRange) {
      position = 'inside_range';
      distanceFromRange = 0;
    } else if (pointValue < lower) {
      position = 'below_range';
      distanceFromRange = roundMoney(lower - pointValue);
    } else {
      position = 'above_range';
      distanceFromRange = roundMoney(pointValue - upper);
    }
  }

  return {
    pointEstimate,
    source: point.source,
    method: point.method,
    confidence: point.confidence,
    pointInsideSupportedRange,
    position,
    distanceFromRange
  };
}

function getUncertaintyLevel(rangeAssessment = {}, readiness = {}) {
  if (!rangeAssessment.available || !isKnownNumber(rangeAssessment.spreadPercentage)) return UNCERTAINTY_LEVEL.UNKNOWN;

  const spreadPercentage = Number(rangeAssessment.spreadPercentage);
  const readinessStatus = readiness.readinessStatus;
  if (spreadPercentage > 0.8) return UNCERTAINTY_LEVEL.EXTREME;
  if (spreadPercentage > 0.45) return UNCERTAINTY_LEVEL.HIGH;
  if (spreadPercentage > 0.2) return UNCERTAINTY_LEVEL.MODERATE;
  if ([READINESS_STATUS.THIN, READINESS_STATUS.INSUFFICIENT, READINESS_STATUS.BLOCKED].includes(readinessStatus)) {
    return UNCERTAINTY_LEVEL.HIGH;
  }
  return UNCERTAINTY_LEVEL.LOW;
}

function getSupportingEvidenceSummary(readiness = {}, range = {}, input = {}) {
  const eligible = asObject(readiness.eligibleEvidenceSummary);
  const comparableQuality = asObject(readiness.comparableQuality);
  const identityExactness = asObject(readiness.identityExactness);
  const basis = asObject(range.basis);
  const evidenceSummary = asObject(input.evidenceSummary);
  const marketData = asObject(firstDefined(input.marketData, input.valuationSummary, input.valuation, {}));
  const trueSoldDepth = pickPositiveNumber([eligible, basis, evidenceSummary, marketData], ['trueSoldEvidenceCount', 'trueSoldCount', 'soldCompCount'], 0);
  const exactComparableCount = pickPositiveNumber([eligible, basis, evidenceSummary, marketData], ['exactComparableCount', 'trueSoldCount', 'soldCompCount'], trueSoldDepth);
  return {
    trueSoldDepth,
    exactComparableCount,
    freshEvidenceCount: pick([eligible], ['freshEvidenceCount'], 0),
    sourceConcentration: clone(asObject(eligible.sourceConcentration)),
    comparableQualityScore: pick([comparableQuality], ['averageComparableQualityScore', 'score', 'comparableQualityScore']),
    identityExactness: clone(identityExactness),
    evidenceReadinessStatus: pick([readiness], ['readinessStatus'])
  };
}

function getExcludedEvidenceSummary(readiness = {}, input = {}) {
  const excluded = asObject(readiness.excludedEvidenceSummary);
  const evidenceSummary = asObject(input.evidenceSummary);
  const marketData = asObject(firstDefined(input.marketData, input.valuationSummary, input.valuation, {}));
  return {
    activeListingCount: pickPositiveNumber([excluded, evidenceSummary, marketData], ['activeListingCount', 'activeCount', 'activeCompCount'], 0),
    fallbackEvidenceCount: pickPositiveNumber([excluded, evidenceSummary], ['fallbackEvidenceCount', 'fallbackUnknownCount'], evidenceSummary.fallbackOnlyFlag === true ? 1 : 0),
    contextualComparableCount: pick([excluded], ['contextualComparableCount'], 0),
    rejectedComparableCount: pick([excluded], ['rejectedComparableCount'], 0),
    staleEvidenceCount: pick([excluded], ['staleEvidenceCount'], 0),
    duplicateEvidenceCount: pick([excluded], ['duplicateEvidenceCount'], 0),
    transactionIneligibleEvidenceCount: pick([excluded], ['transactionIneligibleEvidenceCount'], 0)
  };
}

function hasExcludedOnlyEvidence(support = {}, excluded = {}) {
  return Number(support.trueSoldDepth || 0) <= 0 &&
    (Number(excluded.activeListingCount || 0) > 0 || Number(excluded.fallbackEvidenceCount || 0) > 0);
}

function getStatus({ pointAssessment, rangeAssessment, support, excluded, readiness, uncertaintyLevel }) {
  const readinessStatus = readiness.readinessStatus;
  const noPoint = !isKnownNumber(pointAssessment.pointEstimate);
  const noRange = rangeAssessment.available !== true;
  const hasAnyEvidence = Number(support.trueSoldDepth || 0) > 0 ||
    Object.values(excluded).some((value) => Number(value || 0) > 0);

  if (hasExcludedOnlyEvidence(support, excluded)) return VALUATION_DIAGNOSTIC_STATUS.WITHHELD;
  if ([READINESS_STATUS.BLOCKED, READINESS_STATUS.INSUFFICIENT].includes(readinessStatus)) {
    return VALUATION_DIAGNOSTIC_STATUS.WITHHELD;
  }
  if (noPoint && noRange && !hasAnyEvidence) return VALUATION_DIAGNOSTIC_STATUS.UNAVAILABLE;
  if (noPoint || noRange) return VALUATION_DIAGNOSTIC_STATUS.WITHHELD;
  if (readinessStatus === READINESS_STATUS.THIN) return VALUATION_DIAGNOSTIC_STATUS.WEAKLY_SUPPORTED;
  if (uncertaintyLevel === UNCERTAINTY_LEVEL.EXTREME) return VALUATION_DIAGNOSTIC_STATUS.WEAKLY_SUPPORTED;
  if (pointAssessment.pointInsideSupportedRange === false) return VALUATION_DIAGNOSTIC_STATUS.CONDITIONALLY_SUPPORTED;
  if (readinessStatus === READINESS_STATUS.CONDITIONALLY_READY) return VALUATION_DIAGNOSTIC_STATUS.CONDITIONALLY_SUPPORTED;
  if (uncertaintyLevel === UNCERTAINTY_LEVEL.HIGH) return VALUATION_DIAGNOSTIC_STATUS.SUPPORTED_WITH_WIDE_RANGE;
  return VALUATION_DIAGNOSTIC_STATUS.SUPPORTED;
}

function getWarnings({ pointAssessment, rangeAssessment, support, excluded, readiness, uncertaintyLevel, comparableQuality }) {
  return unique([
    ...asArray(rangeAssessment.rangeWarnings),
    ...asArray(readiness.warnings),
    ...asArray(comparableQuality.warnings),
    pointAssessment.pointInsideSupportedRange === false ? 'point_estimate_outside_supported_range' : null,
    uncertaintyLevel === UNCERTAINTY_LEVEL.MODERATE ? 'valuation_uncertainty_moderate' : null,
    uncertaintyLevel === UNCERTAINTY_LEVEL.HIGH ? 'valuation_uncertainty_high' : null,
    uncertaintyLevel === UNCERTAINTY_LEVEL.EXTREME ? 'valuation_uncertainty_extreme' : null,
    Number(support.trueSoldDepth || 0) > 0 && Number(support.trueSoldDepth || 0) < 3 ? 'true_sold_support_below_minimum' : null,
    Number(excluded.staleEvidenceCount || 0) > 0 ? 'stale_evidence_excluded' : null,
    normalizeString(rangeAssessment.rangeQuality) === 'thin' ? 'valuation_range_quality_thin' : null,
    normalizeString(rangeAssessment.rangeQuality) === 'unreliable' ? 'valuation_range_quality_unreliable' : null
  ].filter(Boolean));
}

function getBlockingReasons({ pointAssessment, rangeAssessment, support, excluded, readiness, uncertaintyLevel }) {
  return collectBlockingReasons([
    { when: !isKnownNumber(pointAssessment.pointEstimate), reason: 'missing_production_point_estimate' },
    { when: rangeAssessment.available !== true, reason: 'missing_supported_valuation_range' },
    { when: Number(support.trueSoldDepth || 0) <= 0, reason: 'true_sold_support_missing' },
    {
      when: Number(excluded.activeListingCount || 0) > 0 && Number(support.trueSoldDepth || 0) <= 0,
      reason: 'active_listing_context_cannot_support_point_valuation'
    },
    {
      when: Number(excluded.fallbackEvidenceCount || 0) > 0 && Number(support.trueSoldDepth || 0) <= 0,
      reason: 'fallback_evidence_cannot_support_point_valuation'
    },
    {
      when: readiness.valuationReadiness && readiness.valuationReadiness.shouldWithholdValuationDiagnostically === true,
      reason: 'evidence_readiness_recommends_withholding'
    },
    {
      when: asObject(support.identityExactness).valuationEligible === false,
      reason: 'identity_not_valuation_eligible'
    },
    {
      when: uncertaintyLevel === UNCERTAINTY_LEVEL.EXTREME,
      reason: 'valuation_uncertainty_extreme'
    }
  ]);
}

function getConfidenceCapRecommendation(status, uncertaintyLevel, readiness = {}) {
  const readinessCap = Number(asObject(readiness.confidenceCapRecommendation).recommendedCap);
  const uncertaintyCap = {
    [UNCERTAINTY_LEVEL.LOW]: 100,
    [UNCERTAINTY_LEVEL.MODERATE]: 85,
    [UNCERTAINTY_LEVEL.HIGH]: 65,
    [UNCERTAINTY_LEVEL.EXTREME]: 44,
    [UNCERTAINTY_LEVEL.UNKNOWN]: 50
  }[uncertaintyLevel] || 50;
  const statusCap = {
    [VALUATION_DIAGNOSTIC_STATUS.SUPPORTED]: 100,
    [VALUATION_DIAGNOSTIC_STATUS.SUPPORTED_WITH_WIDE_RANGE]: 65,
    [VALUATION_DIAGNOSTIC_STATUS.CONDITIONALLY_SUPPORTED]: 75,
    [VALUATION_DIAGNOSTIC_STATUS.WEAKLY_SUPPORTED]: 44,
    [VALUATION_DIAGNOSTIC_STATUS.WITHHELD]: 18,
    [VALUATION_DIAGNOSTIC_STATUS.UNAVAILABLE]: 0
  }[status];
  const caps = [uncertaintyCap, statusCap].filter((value) => Number.isFinite(value));
  if (Number.isFinite(readinessCap)) caps.push(readinessCap);
  const recommendedCap = Math.min(...caps);

  return {
    recommendedCap,
    reason: status === VALUATION_DIAGNOSTIC_STATUS.SUPPORTED
      ? 'range_first_diagnostic_supports_uncapped_interpretation'
      : 'range_first_diagnostic_limits_confident_interpretation'
  };
}

function getWithheldRecommendation(status, blockingReasons = []) {
  const shouldWithhold = [
    VALUATION_DIAGNOSTIC_STATUS.WEAKLY_SUPPORTED,
    VALUATION_DIAGNOSTIC_STATUS.WITHHELD,
    VALUATION_DIAGNOSTIC_STATUS.UNAVAILABLE
  ].includes(status);

  return {
    shouldWithholdValuationDiagnostically: shouldWithhold,
    reason: shouldWithhold
      ? firstDefined(blockingReasons[0], 'valuation_support_below_range_first_threshold')
      : 'valuation_support_satisfies_range_first_diagnostic_threshold'
  };
}

function getReviewAction(status) {
  if (status === VALUATION_DIAGNOSTIC_STATUS.SUPPORTED) return REVIEW_ACTION.NONE;
  if (status === VALUATION_DIAGNOSTIC_STATUS.SUPPORTED_WITH_WIDE_RANGE) return REVIEW_ACTION.REVIEW_RANGE_UNCERTAINTY;
  if (status === VALUATION_DIAGNOSTIC_STATUS.CONDITIONALLY_SUPPORTED) return REVIEW_ACTION.REVIEW_RANGE_UNCERTAINTY;
  if (status === VALUATION_DIAGNOSTIC_STATUS.WEAKLY_SUPPORTED) return REVIEW_ACTION.COLLECT_STRONGER_SOLD_EVIDENCE;
  if (status === VALUATION_DIAGNOSTIC_STATUS.WITHHELD) return REVIEW_ACTION.WITHHOLD_POINT_VALUATION_INTERPRETATION;
  return REVIEW_ACTION.PROVIDE_POINT_AND_RANGE_EVIDENCE;
}

function buildRangeFirstValuationFingerprint(result = {}) {
  const projection = clone(result);
  delete projection.stableFingerprint;
  return buildFingerprintFromProjection(projection);
}

function evaluateRangeFirstValuation(input = {}) {
  const point = getPointEstimate(input);
  const range = getRange(input);
  const readiness = getEvidenceReadiness(input);
  const comparableQuality = getComparableQualitySummary(input, readiness);
  const rangeAssessment = getRangeAssessment(range);
  const pointEstimateAssessment = getPointEstimateAssessment(point, rangeAssessment);
  const supportingEvidenceSummary = getSupportingEvidenceSummary(readiness, range, input);
  const excludedEvidenceSummary = getExcludedEvidenceSummary(readiness, input);
  const uncertaintyLevel = getUncertaintyLevel(rangeAssessment, readiness);
  const valuationDiagnosticStatus = getStatus({
    pointAssessment: pointEstimateAssessment,
    rangeAssessment,
    support: supportingEvidenceSummary,
    excluded: excludedEvidenceSummary,
    readiness,
    uncertaintyLevel
  });
  const blockingReasons = getBlockingReasons({
    pointAssessment: pointEstimateAssessment,
    rangeAssessment,
    support: supportingEvidenceSummary,
    excluded: excludedEvidenceSummary,
    readiness,
    uncertaintyLevel
  });
  const warnings = getWarnings({
    pointAssessment: pointEstimateAssessment,
    rangeAssessment,
    support: supportingEvidenceSummary,
    excluded: excludedEvidenceSummary,
    readiness,
    uncertaintyLevel,
    comparableQuality
  });

  const result = {
    source: RANGE_FIRST_VALUATION_DIAGNOSTIC_SOURCE,
    schemaVersion: RANGE_FIRST_VALUATION_DIAGNOSTIC_SCHEMA_VERSION,
    productionImpact: 'none',
    decisionImpact: 'none',
    valuationDiagnosticStatus,
    uncertaintyLevel,
    pointEstimateAssessment,
    rangeAssessment,
    supportingEvidenceSummary,
    excludedEvidenceSummary,
    blockingReasons,
    warnings,
    evidenceReadiness: {
      readinessStatus: readiness.readinessStatus || UNKNOWN_VALUE,
      readinessLevel: readiness.readinessLevel || UNKNOWN_VALUE,
      stableFingerprint: readiness.stableFingerprint || UNKNOWN_VALUE
    },
    outlierSensitivity: {
      outlierAdjustment: pick([range.adjustments], ['outlierAdjustment']),
      outlierWarnings: warnings.filter((warning) => /outlier/i.test(warning))
    },
    valuationWithheldRecommendation: getWithheldRecommendation(valuationDiagnosticStatus, blockingReasons),
    confidenceCapRecommendation: {},
    recommendedReviewAction: getReviewAction(valuationDiagnosticStatus),
    stableFingerprint: ''
  };

  result.confidenceCapRecommendation = getConfidenceCapRecommendation(valuationDiagnosticStatus, uncertaintyLevel, readiness);
  result.stableFingerprint = buildRangeFirstValuationFingerprint(result);
  return deepFreeze(result);
}

function summarizeRangeFirstValuation(result = {}) {
  const status = result.valuationDiagnosticStatus || VALUATION_DIAGNOSTIC_STATUS.UNAVAILABLE;
  if (status === VALUATION_DIAGNOSTIC_STATUS.SUPPORTED) return 'Point valuation is supported by the supplied range-first diagnostic.';
  if (status === VALUATION_DIAGNOSTIC_STATUS.SUPPORTED_WITH_WIDE_RANGE) return 'Point valuation is supported, but the range remains wide.';
  if (status === VALUATION_DIAGNOSTIC_STATUS.CONDITIONALLY_SUPPORTED) return 'Point valuation is conditionally supported and requires range review.';
  if (status === VALUATION_DIAGNOSTIC_STATUS.WEAKLY_SUPPORTED) return 'Point valuation is weakly supported and should be withheld diagnostically until stronger sold evidence exists.';
  if (status === VALUATION_DIAGNOSTIC_STATUS.WITHHELD) return 'Point valuation should be withheld diagnostically from confident interpretation.';
  return 'Range-first valuation diagnostic is unavailable because required point or range evidence is missing.';
}

module.exports = {
  RANGE_FIRST_VALUATION_DIAGNOSTIC_SCHEMA_VERSION,
  RANGE_FIRST_VALUATION_DIAGNOSTIC_SOURCE,
  REVIEW_ACTION,
  UNCERTAINTY_LEVEL,
  UNKNOWN_VALUE,
  VALUATION_DIAGNOSTIC_STATUS,
  buildRangeFirstValuationFingerprint,
  evaluateRangeFirstValuation,
  summarizeRangeFirstValuation
};
