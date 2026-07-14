'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const contract = require('../validation/strategyLaneContract');

function validProfile(overrides = {}) {
  return {
    preferredStrategyLanes: [contract.STRATEGY_LANES.QUICK_FLIP],
    maximumCapitalAllocationPerPosition: { amount: 100, currency: 'USD' },
    maximumPortfolioConcentration: { percentage: 20 },
    minimumTargetNetProfit: { amount: 15, currency: 'USD' },
    minimumROI: { percentage: 25 },
    preferredHoldDuration: { maxDays: 30 },
    liquidityPreference: 'high',
    evidenceStrictness: 'strict',
    riskTolerance: 'low',
    bankrollSize: { amount: 500, currency: 'USD' },
    reserveCapitalPercentage: 30,
    ...overrides
  };
}

function validLaneOutput(overrides = {}) {
  return {
    strategyLane: contract.STRATEGY_LANES.QUICK_FLIP,
    laneEligibility: 'eligible_context',
    laneReadiness: 'ready_for_future_scoring',
    laneStrengths: ['High liquidity preference.'],
    laneWeaknesses: [],
    recommendedHoldingWindow: { minDays: 0, maxDays: 30 },
    preferredExitStyle: 'fast_resale',
    explanation: 'Strategy lane context only.',
    productionImpact: 'none',
    ...overrides
  };
}

test('strategy lane contract exposes the three initial lanes and architecture boundaries', () => {
  assert.equal(contract.CONTRACT_SCHEMA_VERSION, '1.0.0');
  assert.equal(contract.SOURCE, 'strategy_lane_contract');
  assert.deepEqual(Object.values(contract.STRATEGY_LANES), [
    'QUICK_FLIP',
    'MEDIUM_HOLD',
    'LONG_TERM_INVESTMENT'
  ]);
  assert.ok(contract.OUT_OF_SCOPE_RESPONSIBILITIES.includes('valuation'));
  assert.ok(contract.OUT_OF_SCOPE_RESPONSIBILITIES.includes('deal_gate'));
  assert.ok(contract.OUT_OF_SCOPE_RESPONSIBILITIES.includes('capital_score'));
  assert.ok(contract.ARCHITECTURAL_RULES.includes('strategy_lanes_never_override_deal_gate'));
  assert.ok(contract.ARCHITECTURAL_RULES.includes('long_term_investing_is_not_an_excuse_for_weak_evidence'));
});

test('all strategy lane definitions are valid and Constitution-compliant context only', () => {
  const validation = contract.validateStrategyLaneDefinitions();

  assert.equal(validation.valid, true);
  assert.deepEqual(validation.reasons, []);
  assert.equal(validation.reports.length, 3);

  for (const report of validation.reports) {
    const definition = contract.getStrategyLaneDefinition(report.lane);
    assert.equal(report.validation.valid, true);
    assert.equal(definition.productionImpact, 'none');
    assert.ok(definition.preferredEvidenceQuality.length > 0);
    assert.ok(definition.exitConfidenceExpectations.length > 0);
  }
});

test('strategy lane definitions require every philosophy field', () => {
  const invalid = {
    ...contract.getStrategyLaneDefinition(contract.STRATEGY_LANES.QUICK_FLIP)
  };
  delete invalid.primaryObjective;
  delete invalid.exitConfidenceExpectations;

  const validation = contract.validateStrategyLaneDefinition(invalid);

  assert.equal(validation.valid, false);
  assert.ok(validation.reasons.includes('missing_lane_primaryObjective'));
  assert.ok(validation.reasons.includes('missing_lane_exitConfidenceExpectations'));
});

test('invalid strategy lanes are rejected', () => {
  assert.equal(contract.isValidStrategyLane('QUICK_FLIP'), true);
  assert.equal(contract.isValidStrategyLane('AGGRESSIVE_SPECULATION'), false);

  const validation = contract.validateStrategyLaneDefinition({
    ...contract.getStrategyLaneDefinition(contract.STRATEGY_LANES.MEDIUM_HOLD),
    strategyLane: 'AGGRESSIVE_SPECULATION'
  });

  assert.equal(validation.valid, false);
  assert.ok(validation.reasons.includes('invalid_strategy_lane'));
});

test('productionImpact defaults to none for lane output and must remain none for definitions', () => {
  const output = validLaneOutput();
  delete output.productionImpact;

  const outputValidation = contract.validateStrategyLaneOutput(output);
  const definitionValidation = contract.validateStrategyLaneDefinition({
    ...contract.getStrategyLaneDefinition(contract.STRATEGY_LANES.LONG_TERM_INVESTMENT),
    productionImpact: 'changes_buy_now'
  });

  assert.equal(outputValidation.valid, true);
  assert.equal(outputValidation.normalizedOutput.productionImpact, 'none');
  assert.equal(definitionValidation.valid, false);
  assert.ok(definitionValidation.reasons.includes('production_impact_must_remain_none'));
});

test('strategy profile input contract validates configurable future preferences', () => {
  const valid = contract.validateStrategyProfileInput(validProfile());
  const invalid = contract.validateStrategyProfileInput({
    preferredStrategyLanes: ['AGGRESSIVE_SPECULATION']
  });

  assert.equal(valid.valid, true);
  assert.deepEqual(valid.reasons, []);
  assert.equal(valid.requiredFields.includes('reserveCapitalPercentage'), true);
  assert.equal(invalid.valid, false);
  assert.ok(invalid.reasons.includes('missing_strategy_profile_bankrollSize'));
  assert.ok(invalid.reasons.includes('invalid_preferred_strategy_lane:AGGRESSIVE_SPECULATION'));
});

test('strategy lane output contract validates required future output shape', () => {
  const valid = contract.validateStrategyLaneOutput(validLaneOutput());
  const invalid = contract.validateStrategyLaneOutput({
    strategyLane: contract.STRATEGY_LANES.QUICK_FLIP
  });

  assert.equal(valid.valid, true);
  assert.deepEqual(valid.reasons, []);
  assert.equal(invalid.valid, false);
  assert.ok(invalid.reasons.includes('missing_lane_output_laneEligibility'));
  assert.ok(invalid.reasons.includes('missing_lane_output_explanation'));
});

test('strategy lane validation is deterministic', () => {
  const first = contract.validateStrategyLaneDefinitions();
  const second = contract.validateStrategyLaneDefinitions();
  const outputFirst = contract.validateStrategyLaneOutput(validLaneOutput());
  const outputSecond = contract.validateStrategyLaneOutput(validLaneOutput());

  assert.deepEqual(second, first);
  assert.deepEqual(outputSecond, outputFirst);
});
