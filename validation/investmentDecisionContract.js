'use strict';

const CONTRACT_SCHEMA_VERSION = '1.0.0';
const SOURCE = 'investment_decision_contract';
const CONTRACT_VERSION = 'investment-decision-contract-v1';

const INVESTMENT_POSTURES = Object.freeze({
  IGNORE: 'IGNORE',
  MONITOR: 'MONITOR',
  NEGOTIATE: 'NEGOTIATE',
  BUY: 'BUY',
  PRIORITY_BUY: 'PRIORITY_BUY'
});

const REQUIRED_INPUT_FIELDS = Object.freeze([
  'listingSnapshot',
  'dealGate',
  'productionValuation',
  'productionDecisionExplanation',
  'canonicalIdentity',
  'canonicalSoldEvidence',
  'shadowSoldComparison',
  'shadowValuation',
  'marketIntelligence',
  'confidenceBreakdown',
  'financialContext',
  'portfolioContext',
  'strategyProfile',
  'competingOpportunities'
]);

const REQUIRED_OUTPUT_FIELDS = Object.freeze([
  'source',
  'version',
  'productionImpact',
  'decisionAuthority',
  'dealGateStatus',
  'investmentPosture',
  'capitalAction',
  'capitalScore',
  'strategyFit',
  'maximumBuyPrice',
  'suggestedOffer',
  'marginOfSafety',
  'expectedNetProfitRange',
  'expectedHoldTime',
  'exitStrategy',
  'opportunityRank',
  'opportunityCostAssessment',
  'portfolioFit',
  'aggressivenessLevel',
  'uncertaintyAdjustment',
  'supportingReasons',
  'cautionReasons',
  'blockers',
  'conflicts',
  'explanation',
  'auditTrail'
]);

const ENGINE_RESPONSIBILITIES = Object.freeze([
  'capital_allocation',
  'opportunity_ranking',
  'maximum_buy_price_interpretation',
  'suggested_offer_interpretation',
  'liquidity_adjusted_aggressiveness',
  'evidence_adjusted_aggressiveness',
  'hold_strategy',
  'exit_strategy',
  'portfolio_fit',
  'opportunity_cost',
  'explain_why_eligible_listing_is_or_is_not_worth_capital'
]);

const OUT_OF_SCOPE_RESPONSIBILITIES = Object.freeze([
  'raw_valuation',
  'sold_comp_matching',
  'identity_matching',
  'deal_gate_pass_fail',
  'buy_now_thresholds',
  'production_scanning',
  'notifications',
  'persistence'
]);

const CAPITAL_SCORE_INPUTS = Object.freeze([
  'deal_gate_status',
  'evidence_quality',
  'exact_identity_confidence',
  'shadow_valuation_support',
  'expected_net_profit',
  'roi',
  'margin_of_safety',
  'liquidity',
  'expected_hold_time',
  'supply_pressure',
  'market_regime',
  'capital_required',
  'downside_risk',
  'opportunity_cost',
  'portfolio_concentration',
  'strategy_fit'
]);

const CAPITAL_SCORE_CONTRACT = Object.freeze({
  purpose: 'If capital is limited, how much priority should this opportunity receive compared with other opportunities?',
  distinctFrom: [
    'roi',
    'expected_profit',
    'legacy_context_score',
    'desirability_context',
    'legacy_deal_grade',
    'confidence',
    'deal_gate'
  ],
  inputs: CAPITAL_SCORE_INPUTS,
  finalWeightsDefined: false,
  weights: null
});

const ARCHITECTURAL_RULES = Object.freeze([
  'investment_decision_engine_can_never_override_failed_deal_gate',
  'may_only_restrict_rank_prioritize_monitor_or_recommend_negotiation_after_deal_gate',
  'uncertainty_must_reduce_aggressiveness',
  'weak_evidence_must_never_increase_expected_upside',
  'suggested_offer_must_not_exceed_maximum_buy_price',
  'contextual_sold_matches_must_never_be_exact_valuation_evidence',
  'production_influence_disabled_until_validated_and_approved',
  'every_output_must_be_explainable_and_constitution_compliant'
]);

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

function getMoney(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'object') {
    const amount = Number(value.amount ?? value.value ?? value.price ?? value.maximum ?? value.offer);
    return Number.isFinite(amount) ? amount : null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isDealGateFailed(dealGateStatus = {}) {
  const gate = asObject(dealGateStatus);
  return gate.passed === false || gate.buyNowAllowed === false || gate.status === 'failed' || gate.decision === 'REJECT';
}

function normalizeInvestmentDecisionOutput(output = {}) {
  return {
    source: SOURCE,
    version: CONTRACT_VERSION,
    productionImpact: 'none',
    decisionAuthority: 'deal_gate_remains_authoritative_production_safety_gate',
    ...asObject(output)
  };
}

function validateInvestmentDecisionInput(input = {}) {
  const reasons = missingFields(input, REQUIRED_INPUT_FIELDS)
    .map((field) => `missing_input_${field}`);

  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    source: SOURCE,
    valid: reasons.length === 0,
    reasons,
    requiredFields: [...REQUIRED_INPUT_FIELDS]
  };
}

function validateInvestmentDecisionOutput(output = {}) {
  const normalized = normalizeInvestmentDecisionOutput(output);
  const reasons = missingFields(normalized, REQUIRED_OUTPUT_FIELDS)
    .map((field) => `missing_output_${field}`);
  const posture = normalized.investmentPosture;

  if (!Object.values(INVESTMENT_POSTURES).includes(posture)) {
    reasons.push('invalid_investment_posture');
  }

  if (normalized.productionImpact !== 'none') {
    reasons.push('production_impact_must_remain_none');
  }

  if (
    isDealGateFailed(normalized.dealGateStatus) &&
    [INVESTMENT_POSTURES.BUY, INVESTMENT_POSTURES.PRIORITY_BUY].includes(posture)
  ) {
    reasons.push('failed_deal_gate_cannot_buy');
  }

  const suggestedOffer = getMoney(normalized.suggestedOffer);
  const maximumBuyPrice = getMoney(normalized.maximumBuyPrice);
  if (
    suggestedOffer !== null &&
    maximumBuyPrice !== null &&
    suggestedOffer > maximumBuyPrice
  ) {
    reasons.push('suggested_offer_exceeds_maximum_buy_price');
  }

  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    source: SOURCE,
    valid: reasons.length === 0,
    reasons: [...new Set(reasons)],
    normalizedOutput: normalized,
    requiredFields: [...REQUIRED_OUTPUT_FIELDS]
  };
}

function validateInvestmentDecisionContract({ input = {}, output = {} } = {}) {
  const inputValidation = validateInvestmentDecisionInput(input);
  const outputValidation = validateInvestmentDecisionOutput(output);
  const reasons = [
    ...inputValidation.reasons,
    ...outputValidation.reasons
  ];

  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    source: SOURCE,
    valid: reasons.length === 0,
    reasons,
    inputValidation,
    outputValidation
  };
}

module.exports = {
  ARCHITECTURAL_RULES,
  CAPITAL_SCORE_CONTRACT,
  CAPITAL_SCORE_INPUTS,
  CONTRACT_SCHEMA_VERSION,
  CONTRACT_VERSION,
  ENGINE_RESPONSIBILITIES,
  INVESTMENT_POSTURES,
  OUT_OF_SCOPE_RESPONSIBILITIES,
  REQUIRED_INPUT_FIELDS,
  REQUIRED_OUTPUT_FIELDS,
  SOURCE,
  normalizeInvestmentDecisionOutput,
  validateInvestmentDecisionContract,
  validateInvestmentDecisionInput,
  validateInvestmentDecisionOutput
};
