'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const originalLoad = Module._load;
Module._load = function loadWithExpressStub(request, parent, isMain) {
  if (request === 'express') {
    const express = () => ({
      use() {},
      get() {},
      post() {},
      listen() {}
    });
    express.urlencoded = () => (_req, _res, next) => next && next();
    express.json = () => (_req, _res, next) => next && next();
    return express;
  }

  return originalLoad.call(this, request, parent, isMain);
};

const { dealGate } = require('../server');

const EXPECTED_RULE_IDS = [
  'sold_comp_minimum',
  'market_confidence_floor',
  'market_intelligence_floor',
  'liquidity_score_floor',
  'liquidity_level_allowed',
  'pricing_reliability_floor',
  'pricing_level_allowed',
  'risk_level_allowed',
  'market_trust_allowed',
  'market_recommendation_allowed',
  'grade_confidence_consistency',
  'heuristic_grade_consistency',
  'estimated_value_market_support',
  'profit_requires_sold_history',
  'excessive_roi_support',
  'heuristic_fallback_support',
  'unknown_condition_support',
  'final_no_rejection_reasons',
  'final_score_minimum',
  'final_profit_positive',
  'final_sold_comp_minimum',
  'final_confidence_minimum',
  'final_market_intelligence_minimum',
  'final_liquidity_minimum',
  'final_pricing_minimum',
  'final_market_trust_allowed',
  'final_liquidity_level_allowed',
  'final_pricing_level_allowed',
  'final_risk_level_allowed',
  'final_market_recommendation_allowed'
];

function strongGateInput(overrides = {}) {
  return {
    score: 92,
    estimatedProfit: 45,
    roi: 0.35,
    roiData: {
      roi: 0.35,
      roiPercent: 35
    },
    condition: 'PSA 10',
    compData: {
      trueSoldCompCount: 8,
      soldCompCount: 8,
      source: 'sold_market',
      compSource: 'sold_market'
    },
    marketData: {
      confidence: 90,
      soldCompCount: 8,
      marketValue: 145,
      referencePrice: 140,
      source: 'sold_market'
    },
    marketIntelligenceScore: 90,
    marketTrustLevel: 'good',
    marketRecommendation: 'trust',
    marketIntelligenceData: {
      intelligenceScore: 90,
      confidenceScore: 90,
      trustLevel: 'good',
      recommendation: 'trust',
      liquidity: { score: 80, level: 'good' },
      priceConsistency: { score: 80, level: 'good' }
    },
    riskLevel: 'low',
    ...overrides
  };
}

function ruleById(gate, ruleId) {
  return gate.dealGateBreakdown.rules.find((rule) => rule.ruleId === ruleId);
}

function withoutBreakdown(gate) {
  const clone = JSON.parse(JSON.stringify(gate));
  delete clone.dealGateBreakdown;
  return clone;
}

test('Deal Gate breakdown includes every current Deal Gate rule with diagnostic fields', () => {
  const gate = dealGate(strongGateInput());
  const breakdown = gate.dealGateBreakdown;

  assert.ok(breakdown);
  assert.equal(breakdown.source, 'deal_gate_breakdown');
  assert.equal(breakdown.version, '1.0.0');
  assert.equal(breakdown.decisionImpact, 'none');
  assert.deepEqual(
    breakdown.rules.map((rule) => rule.ruleId),
    EXPECTED_RULE_IDS
  );
  assert.equal(breakdown.diagnostic.totalRules, EXPECTED_RULE_IDS.length);
  assert.equal(breakdown.diagnostic.authoritativeDecisionSource, 'deal_gate');
  assert.equal(breakdown.diagnostic.productionBehaviorChanged, false);

  for (const rule of breakdown.rules) {
    assert.equal(typeof rule.category, 'string');
    assert.equal(typeof rule.label, 'string');
    assert.ok(Object.prototype.hasOwnProperty.call(rule, 'requiredValue'));
    assert.ok(Object.prototype.hasOwnProperty.call(rule, 'actualValue'));
    assert.equal(typeof rule.passed, 'boolean');
    assert.equal(typeof rule.applies, 'boolean');
    assert.ok(Object.prototype.hasOwnProperty.call(rule, 'reason'));
    assert.ok(Object.prototype.hasOwnProperty.call(rule, 'metadata'));
  }
});

test('Deal Gate breakdown reports passed rules and reasons for an approved listing', () => {
  const gate = dealGate(strongGateInput());
  const breakdown = gate.dealGateBreakdown;

  assert.equal(gate.passed, true);
  assert.equal(breakdown.passed, gate.passed);
  assert.equal(breakdown.buyNowAllowed, gate.buyNowAllowed);
  assert.deepEqual(breakdown.failedRules, []);
  assert.deepEqual(breakdown.failedReasons, gate.reasons);
  assert.deepEqual(breakdown.passedReasons, gate.positives);
  assert.ok(breakdown.passedRules.includes('sold_comp_minimum'));
  assert.ok(breakdown.passedRules.includes('final_no_rejection_reasons'));
  assert.equal(ruleById(gate, 'sold_comp_minimum').passed, true);
  assert.match(ruleById(gate, 'sold_comp_minimum').reason, /Supported by 8 sold comps/);
});

test('Deal Gate breakdown reports failed rules and rejection reasons for a rejected listing', () => {
  const gate = dealGate(strongGateInput({
    score: 68,
    estimatedProfit: -15,
    roi: -0.2,
    roiData: { roi: -0.2, roiPercent: -20 },
    compData: {
      trueSoldCompCount: 0,
      soldCompCount: 0,
      source: 'active_context',
      compSource: 'active_context'
    },
    marketData: {
      confidence: 45,
      soldCompCount: 0,
      source: 'active_context'
    },
    marketIntelligenceScore: 52,
    marketTrustLevel: 'weak',
    marketRecommendation: 'do_not_trust',
    marketIntelligenceData: {
      intelligenceScore: 52,
      confidenceScore: 45,
      trustLevel: 'weak',
      recommendation: 'do_not_trust',
      liquidity: { score: 42, level: 'thin' },
      priceConsistency: { score: 40, level: 'weak' }
    },
    riskLevel: 'high'
  }));

  assert.equal(gate.passed, false);
  assert.equal(gate.buyNowAllowed, false);
  assert.equal(gate.dealGateBreakdown.passed, false);
  assert.deepEqual(gate.dealGateBreakdown.failedReasons, gate.reasons);
  assert.ok(gate.dealGateBreakdown.failedRules.includes('sold_comp_minimum'));
  assert.ok(gate.dealGateBreakdown.failedRules.includes('final_no_rejection_reasons'));
  assert.ok(gate.dealGateBreakdown.failedRules.includes('final_score_minimum'));
  assert.ok(gate.dealGateBreakdown.failedRules.includes('final_profit_positive'));
  assert.equal(ruleById(gate, 'sold_comp_minimum').passed, false);
  assert.equal(ruleById(gate, 'market_confidence_floor').passed, false);
  assert.equal(ruleById(gate, 'market_recommendation_allowed').passed, false);
  assert.match(gate.reasons.join(' '), /Zero sold comps available/);
});

test('Deal Gate breakdown explains excessive ROI support failure without changing gate behavior', () => {
  const gate = dealGate(strongGateInput({
    roi: 2.5,
    roiData: { roi: 2.5, roiPercent: 250 },
    compData: {
      trueSoldCompCount: 3,
      soldCompCount: 3,
      source: 'sold_market',
      compSource: 'sold_market'
    },
    marketData: {
      confidence: 90,
      soldCompCount: 3,
      marketValue: 145,
      referencePrice: 140,
      source: 'sold_market'
    }
  }));

  const roiRule = ruleById(gate, 'excessive_roi_support');

  assert.equal(gate.passed, false);
  assert.equal(roiRule.applies, true);
  assert.equal(roiRule.passed, false);
  assert.match(roiRule.reason, /ROI is excessive \(250%\)/);
  assert.deepEqual(gate.dealGateBreakdown.failedReasons, gate.reasons);
  assert.match(gate.reasons.join(' '), /ROI is excessive \(250%\)/);
});

test('Deal Gate breakdown is additive and leaves BUY_NOW behavior unchanged', () => {
  const approvedGate = dealGate(strongGateInput());
  const rejectedGate = dealGate(strongGateInput({
    score: 70,
    estimatedProfit: 0,
    compData: { trueSoldCompCount: 2, soldCompCount: 2 },
    marketData: { confidence: 74, soldCompCount: 2 },
    marketIntelligenceData: {
      intelligenceScore: 79,
      confidenceScore: 74,
      trustLevel: 'good',
      recommendation: 'trust',
      liquidity: { score: 64, level: 'good' },
      priceConsistency: { score: 64, level: 'good' }
    }
  }));

  assert.equal(approvedGate.buyNowAllowed, true);
  assert.equal(approvedGate.decision, 'BUY_NOW');
  assert.equal(approvedGate.dealGateBreakdown.buyNowAllowed, approvedGate.buyNowAllowed);
  assert.equal(approvedGate.dealGateBreakdown.decision, approvedGate.decision);

  assert.equal(rejectedGate.buyNowAllowed, false);
  assert.equal(rejectedGate.decision, 'REJECT');
  assert.equal(rejectedGate.dealGateBreakdown.buyNowAllowed, rejectedGate.buyNowAllowed);
  assert.equal(rejectedGate.dealGateBreakdown.decision, rejectedGate.decision);

  assert.deepEqual(withoutBreakdown(approvedGate), {
    passed: approvedGate.passed,
    approved: approvedGate.approved,
    pass: approvedGate.pass,
    shouldBuy: approvedGate.shouldBuy,
    buyNowAllowed: approvedGate.buyNowAllowed,
    decision: approvedGate.decision,
    recommendation: approvedGate.recommendation,
    reasons: approvedGate.reasons,
    rejectionReasons: approvedGate.rejectionReasons,
    positives: approvedGate.positives,
    gate: approvedGate.gate
  });
});
