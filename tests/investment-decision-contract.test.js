'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const contract = require('../validation/investmentDecisionContract');

function validInput(overrides = {}) {
  return {
    listingSnapshot: { itemId: 'listing-1' },
    dealGate: { passed: true, buyNowAllowed: true },
    productionValuation: { estimatedValue: 100 },
    productionDecisionExplanation: { primaryExplanation: 'Passed Deal Gate.' },
    canonicalIdentity: { canonicalIdentityKey: 'ci:v1:sports:test' },
    canonicalSoldEvidence: { trueSoldCount: 4 },
    shadowSoldComparison: { acceptedExactMatches: [] },
    shadowValuation: { insufficientEvidence: false },
    marketIntelligence: { evidenceSummary: {} },
    confidenceBreakdown: { soldEvidenceSupport: {} },
    financialContext: { totalCost: 70 },
    portfolioContext: { availableCapital: 500 },
    strategyProfile: { strategy: 'quick_flip' },
    competingOpportunities: [],
    ...overrides
  };
}

function validOutput(overrides = {}) {
  return {
    source: 'investment_decision_engine',
    version: 'investment-decision-engine-v1',
    productionImpact: 'none',
    decisionAuthority: 'deal_gate_remains_authoritative_production_safety_gate',
    dealGateStatus: { passed: true, buyNowAllowed: true },
    investmentPosture: contract.INVESTMENT_POSTURES.NEGOTIATE,
    capitalAction: 'make_evidence_supported_offer',
    capitalScore: {
      score: null,
      weightsDefined: false
    },
    strategyFit: { profile: 'quick_flip', fit: 'moderate' },
    maximumBuyPrice: { amount: 80, currency: 'USD' },
    suggestedOffer: { amount: 72, currency: 'USD' },
    marginOfSafety: { percentage: 20 },
    expectedNetProfitRange: { low: 10, expected: 18, high: 25 },
    expectedHoldTime: { days: 30, confidence: 'unknown' },
    exitStrategy: { type: 'resell', explanation: 'Future contract placeholder.' },
    opportunityRank: { rank: null, comparedCount: 0 },
    opportunityCostAssessment: { status: 'not_evaluated' },
    portfolioFit: { status: 'not_evaluated' },
    aggressivenessLevel: 'moderate',
    uncertaintyAdjustment: { direction: 'reduced_aggressiveness' },
    supportingReasons: ['Deal Gate passed.'],
    cautionReasons: [],
    blockers: [],
    conflicts: [],
    explanation: 'Contract-valid explanation placeholder.',
    auditTrail: [],
    ...overrides
  };
}

test('investment decision contract exposes responsibilities, boundaries, postures, and Capital Score inputs', () => {
  assert.equal(contract.CONTRACT_SCHEMA_VERSION, '1.0.0');
  assert.equal(contract.SOURCE, 'investment_decision_contract');
  assert.deepEqual(Object.values(contract.INVESTMENT_POSTURES), [
    'IGNORE',
    'MONITOR',
    'NEGOTIATE',
    'BUY',
    'PRIORITY_BUY'
  ]);
  assert.ok(contract.ENGINE_RESPONSIBILITIES.includes('capital_allocation'));
  assert.ok(contract.ENGINE_RESPONSIBILITIES.includes('opportunity_ranking'));
  assert.ok(contract.OUT_OF_SCOPE_RESPONSIBILITIES.includes('raw_valuation'));
  assert.ok(contract.OUT_OF_SCOPE_RESPONSIBILITIES.includes('deal_gate_pass_fail'));
  assert.ok(contract.CAPITAL_SCORE_INPUTS.includes('opportunity_cost'));
  assert.ok(contract.CAPITAL_SCORE_INPUTS.includes('portfolio_concentration'));
  assert.equal(contract.CAPITAL_SCORE_CONTRACT.finalWeightsDefined, false);
  assert.equal(contract.CAPITAL_SCORE_CONTRACT.weights, null);
});

test('validates required Investment Decision input fields', () => {
  const valid = contract.validateInvestmentDecisionInput(validInput());
  const invalid = contract.validateInvestmentDecisionInput({
    listingSnapshot: {}
  });

  assert.equal(valid.valid, true);
  assert.deepEqual(valid.reasons, []);
  assert.equal(invalid.valid, false);
  assert.ok(invalid.reasons.includes('missing_input_dealGate'));
  assert.ok(invalid.reasons.includes('missing_input_shadowValuation'));
  assert.equal(valid.requiredFields.includes('competingOpportunities'), true);
});

test('validates required Investment Decision output fields and defaults productionImpact to none', () => {
  const output = validOutput();
  delete output.productionImpact;

  const validation = contract.validateInvestmentDecisionOutput(output);

  assert.equal(validation.valid, true);
  assert.equal(validation.normalizedOutput.productionImpact, 'none');
  assert.equal(validation.requiredFields.includes('auditTrail'), true);
});

test('rejects invalid investment postures', () => {
  const validation = contract.validateInvestmentDecisionOutput(validOutput({
    investmentPosture: 'STRONG_BUY'
  }));

  assert.equal(validation.valid, false);
  assert.ok(validation.reasons.includes('invalid_investment_posture'));
});

test('enforces Deal Gate ownership boundaries for failed Deal Gate outputs', () => {
  const failedBuy = contract.validateInvestmentDecisionOutput(validOutput({
    dealGateStatus: { passed: false, buyNowAllowed: false, decision: 'REJECT' },
    investmentPosture: contract.INVESTMENT_POSTURES.BUY
  }));
  const failedPriorityBuy = contract.validateInvestmentDecisionOutput(validOutput({
    dealGateStatus: { passed: false, buyNowAllowed: false, decision: 'REJECT' },
    investmentPosture: contract.INVESTMENT_POSTURES.PRIORITY_BUY
  }));
  const failedMonitor = contract.validateInvestmentDecisionOutput(validOutput({
    dealGateStatus: { passed: false, buyNowAllowed: false, decision: 'REJECT' },
    investmentPosture: contract.INVESTMENT_POSTURES.MONITOR
  }));

  assert.equal(failedBuy.valid, false);
  assert.ok(failedBuy.reasons.includes('failed_deal_gate_cannot_buy'));
  assert.equal(failedPriorityBuy.valid, false);
  assert.ok(failedPriorityBuy.reasons.includes('failed_deal_gate_cannot_buy'));
  assert.equal(failedMonitor.valid, true);
});

test('suggestedOffer cannot exceed maximumBuyPrice', () => {
  const validation = contract.validateInvestmentDecisionOutput(validOutput({
    maximumBuyPrice: { amount: 80, currency: 'USD' },
    suggestedOffer: { amount: 81, currency: 'USD' }
  }));

  assert.equal(validation.valid, false);
  assert.ok(validation.reasons.includes('suggested_offer_exceeds_maximum_buy_price'));
});

test('production influence remains disabled by contract', () => {
  const validation = contract.validateInvestmentDecisionOutput(validOutput({
    productionImpact: 'changes_buy_now'
  }));

  assert.equal(validation.valid, false);
  assert.ok(validation.reasons.includes('production_impact_must_remain_none'));
});

test('combined contract validation is deterministic', () => {
  const payload = {
    input: validInput(),
    output: validOutput()
  };
  const first = contract.validateInvestmentDecisionContract(payload);
  const second = contract.validateInvestmentDecisionContract(payload);

  assert.deepEqual(second, first);
  assert.equal(first.valid, true);
});

test('Capital Score contract defines no final weights yet', () => {
  assert.equal(contract.CAPITAL_SCORE_CONTRACT.finalWeightsDefined, false);
  assert.equal(contract.CAPITAL_SCORE_CONTRACT.weights, null);
  assert.equal(Object.prototype.hasOwnProperty.call(contract.CAPITAL_SCORE_CONTRACT, 'weightTable'), false);
});
