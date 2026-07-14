'use strict';

const CONTRACT_SCHEMA_VERSION = '1.0.0';
const SOURCE = 'strategy_lane_contract';
const CONTRACT_VERSION = 'strategy-lane-contract-v1';

const STRATEGY_LANES = Object.freeze({
  QUICK_FLIP: 'QUICK_FLIP',
  MEDIUM_HOLD: 'MEDIUM_HOLD',
  LONG_TERM_INVESTMENT: 'LONG_TERM_INVESTMENT'
});

const REQUIRED_LANE_FIELDS = Object.freeze([
  'strategyLane',
  'primaryObjective',
  'preferredEvidenceQuality',
  'acceptableUncertainty',
  'preferredLiquidity',
  'preferredHoldTime',
  'capitalVelocityExpectations',
  'preferredMarginOfSafety',
  'downsideTolerance',
  'preferredMarketRegime',
  'bankrollSuitability',
  'opportunityCostSensitivity',
  'portfolioConcentrationTolerance',
  'exitConfidenceExpectations',
  'productionImpact'
]);

const REQUIRED_PROFILE_INPUT_FIELDS = Object.freeze([
  'preferredStrategyLanes',
  'maximumCapitalAllocationPerPosition',
  'maximumPortfolioConcentration',
  'minimumTargetNetProfit',
  'minimumROI',
  'preferredHoldDuration',
  'liquidityPreference',
  'evidenceStrictness',
  'riskTolerance',
  'bankrollSize',
  'reserveCapitalPercentage'
]);

const REQUIRED_LANE_OUTPUT_FIELDS = Object.freeze([
  'strategyLane',
  'laneEligibility',
  'laneReadiness',
  'laneStrengths',
  'laneWeaknesses',
  'recommendedHoldingWindow',
  'preferredExitStyle',
  'explanation',
  'productionImpact'
]);

const OUT_OF_SCOPE_RESPONSIBILITIES = Object.freeze([
  'valuation',
  'deal_gate',
  'buy_now',
  'capital_score',
  'production_decisions',
  'notifications',
  'persistence'
]);

const ARCHITECTURAL_RULES = Object.freeze([
  'strategy_lanes_never_override_deal_gate',
  'strategy_lanes_never_override_capital_score',
  'strategy_lanes_only_provide_context_for_investment_decisions',
  'weak_evidence_cannot_become_acceptable_because_strategy_is_aggressive',
  'long_term_investing_is_not_an_excuse_for_weak_evidence',
  'quick_flips_require_strong_exit_confidence',
  'all_strategy_recommendations_must_be_constitution_compliant'
]);

const STRATEGY_LANE_DEFINITIONS = Object.freeze({
  [STRATEGY_LANES.QUICK_FLIP]: Object.freeze({
    strategyLane: STRATEGY_LANES.QUICK_FLIP,
    primaryObjective: 'Recycle capital quickly through evidence-backed buys with realistic near-term resale exits.',
    preferredEvidenceQuality: 'strong true-sold evidence with exact identity and recent transactions',
    acceptableUncertainty: 'low',
    preferredLiquidity: 'high',
    preferredHoldTime: 'days_to_weeks',
    capitalVelocityExpectations: 'high velocity; capital should return quickly for redeployment',
    preferredMarginOfSafety: 'strong enough to absorb fees, shipping, undercuts, and fast-exit friction',
    downsideTolerance: 'low',
    preferredMarketRegime: 'stable, rising, or liquid markets without hype distortion',
    bankrollSuitability: 'best for small and medium bankrolls that need repeatable capital recycling',
    opportunityCostSensitivity: 'very_high',
    portfolioConcentrationTolerance: 'low',
    exitConfidenceExpectations: 'very_high; quick flips require strong confidence in resale within the holding window',
    productionImpact: 'none'
  }),
  [STRATEGY_LANES.MEDIUM_HOLD]: Object.freeze({
    strategyLane: STRATEGY_LANES.MEDIUM_HOLD,
    primaryObjective: 'Balance meaningful profit with moderate hold time when evidence and market context support patience.',
    preferredEvidenceQuality: 'strong or good true-sold evidence with exact identity and usable market context',
    acceptableUncertainty: 'moderate_when_discounted_by_margin_of_safety',
    preferredLiquidity: 'moderate_to_high',
    preferredHoldTime: 'weeks_to_months',
    capitalVelocityExpectations: 'moderate velocity; capital can be tied up when expected net return justifies it',
    preferredMarginOfSafety: 'moderate to strong, adjusted for hold duration and market regime',
    downsideTolerance: 'moderate',
    preferredMarketRegime: 'stable, rising, or orderly cooling markets with durable demand',
    bankrollSuitability: 'best for medium and larger bankrolls with reserve capital available',
    opportunityCostSensitivity: 'high',
    portfolioConcentrationTolerance: 'moderate',
    exitConfidenceExpectations: 'high; expected exit should remain credible within the planned hold window',
    productionImpact: 'none'
  }),
  [STRATEGY_LANES.LONG_TERM_INVESTMENT]: Object.freeze({
    strategyLane: STRATEGY_LANES.LONG_TERM_INVESTMENT,
    primaryObjective: 'Deploy capital selectively into durable thesis-driven opportunities with strong downside support.',
    preferredEvidenceQuality: 'strong evidence, exact identity, durable demand, and conservative downside support',
    acceptableUncertainty: 'moderate_only_when_explicitly_supported_by_thesis_and_margin_of_safety',
    preferredLiquidity: 'moderate or better; thin markets require small sizing and stronger thesis support',
    preferredHoldTime: 'months_to_years',
    capitalVelocityExpectations: 'lower velocity accepted only when risk-adjusted upside and portfolio fit justify capital lockup',
    preferredMarginOfSafety: 'strong, with conservative floor support before upside thesis is considered',
    downsideTolerance: 'controlled',
    preferredMarketRegime: 'stable, structurally rising, or undervalued markets with non-hype demand',
    bankrollSuitability: 'best for larger bankrolls that can tolerate capital lockup and diversification needs',
    opportunityCostSensitivity: 'moderate_to_high',
    portfolioConcentrationTolerance: 'controlled_and_policy_limited',
    exitConfidenceExpectations: 'moderate to high; exit confidence must be explicit even when hold time is long',
    productionImpact: 'none'
  })
});

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function missingFields(record = {}, fields = []) {
  const input = asObject(record);
  return asArray(fields).filter((field) => {
    if (!Object.prototype.hasOwnProperty.call(input, field)) return true;
    const value = input[field];
    return value === undefined || value === null || value === '';
  });
}

function isValidStrategyLane(lane) {
  return Object.values(STRATEGY_LANES).includes(lane);
}

function normalizeStrategyLaneOutput(output = {}) {
  return {
    productionImpact: 'none',
    ...asObject(output)
  };
}

function validateStrategyLaneDefinition(definition = {}) {
  const lane = definition.strategyLane;
  const reasons = missingFields(definition, REQUIRED_LANE_FIELDS)
    .map((field) => `missing_lane_${field}`);

  if (!isValidStrategyLane(lane)) reasons.push('invalid_strategy_lane');
  if (definition.productionImpact !== 'none') reasons.push('production_impact_must_remain_none');

  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    source: SOURCE,
    valid: reasons.length === 0,
    reasons: [...new Set(reasons)],
    requiredFields: [...REQUIRED_LANE_FIELDS]
  };
}

function validateStrategyLaneDefinitions(definitions = STRATEGY_LANE_DEFINITIONS) {
  const laneDefinitions = asObject(definitions);
  const reports = Object.values(STRATEGY_LANES).map((lane) => ({
    lane,
    validation: validateStrategyLaneDefinition(laneDefinitions[lane])
  }));
  const reasons = reports.flatMap((report) => (
    report.validation.reasons.map((reason) => `${report.lane}:${reason}`)
  ));

  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    source: SOURCE,
    valid: reasons.length === 0,
    reasons,
    reports
  };
}

function validateStrategyProfileInput(input = {}) {
  const reasons = missingFields(input, REQUIRED_PROFILE_INPUT_FIELDS)
    .map((field) => `missing_strategy_profile_${field}`);
  const lanes = asArray(input.preferredStrategyLanes);

  for (const lane of lanes) {
    if (!isValidStrategyLane(lane)) reasons.push(`invalid_preferred_strategy_lane:${lane}`);
  }

  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    source: SOURCE,
    valid: reasons.length === 0,
    reasons: [...new Set(reasons)],
    requiredFields: [...REQUIRED_PROFILE_INPUT_FIELDS]
  };
}

function validateStrategyLaneOutput(output = {}) {
  const normalized = normalizeStrategyLaneOutput(output);
  const reasons = missingFields(normalized, REQUIRED_LANE_OUTPUT_FIELDS)
    .map((field) => `missing_lane_output_${field}`);

  if (!isValidStrategyLane(normalized.strategyLane)) reasons.push('invalid_strategy_lane');
  if (normalized.productionImpact !== 'none') reasons.push('production_impact_must_remain_none');

  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    source: SOURCE,
    valid: reasons.length === 0,
    reasons: [...new Set(reasons)],
    normalizedOutput: normalized,
    requiredFields: [...REQUIRED_LANE_OUTPUT_FIELDS]
  };
}

function getStrategyLaneDefinition(strategyLane) {
  return STRATEGY_LANE_DEFINITIONS[strategyLane] || null;
}

module.exports = {
  ARCHITECTURAL_RULES,
  CONTRACT_SCHEMA_VERSION,
  CONTRACT_VERSION,
  OUT_OF_SCOPE_RESPONSIBILITIES,
  REQUIRED_LANE_FIELDS,
  REQUIRED_LANE_OUTPUT_FIELDS,
  REQUIRED_PROFILE_INPUT_FIELDS,
  SOURCE,
  STRATEGY_LANE_DEFINITIONS,
  STRATEGY_LANES,
  getStrategyLaneDefinition,
  isValidStrategyLane,
  normalizeStrategyLaneOutput,
  validateStrategyLaneDefinition,
  validateStrategyLaneDefinitions,
  validateStrategyLaneOutput,
  validateStrategyProfileInput
};
