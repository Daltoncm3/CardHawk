'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { buildDisplayInterpretation, dealGate } = require('../server');

function strongGateInput(overrides = {}) {
  return {
    score: 92,
    estimatedProfit: 45,
    roi: 0.35,
    roiData: { roi: 0.35, roiPercent: 35 },
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

function listingWithGate(gateInput, overrides = {}) {
  const gate = dealGate(gateInput);
  return {
    ebayItemId: 'decision-ui-1',
    title: 'Production Decision UI Test Card',
    price: 100,
    totalCost: 100,
    estimatedValue: 145,
    estimatedProfit: gateInput.estimatedProfit,
    roi: gateInput.roi,
    score: gateInput.score,
    marketConfidence: gate.gate.confidenceScore,
    compCount: gate.gate.soldCompCount,
    investmentQuality: 82,
    qualityBucket: 'Strong Buy Candidate',
    qualityData: {
      investmentQuality: 82,
      bucket: 'Strong Buy Candidate'
    },
    dealGrade: {
      grade: 'A',
      action: 'BUY_NOW',
      gradeScore: 90
    },
    roiData: gateInput.roiData,
    compData: gateInput.compData,
    marketData: gateInput.marketData,
    marketIntelligenceData: gateInput.marketIntelligenceData,
    dealGate: gate,
    ...overrides
  };
}

test('rejected listings show authoritative Deal Gate rejection and failed reasons first', () => {
  const rejectedInput = strongGateInput({
    score: 68,
    estimatedProfit: -15,
    roi: -0.2,
    roiData: { roi: -0.2, roiPercent: -20 },
    compData: { trueSoldCompCount: 0, soldCompCount: 0, source: 'active_context' },
    marketData: { confidence: 45, soldCompCount: 0, source: 'active_context' },
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
  });
  const listing = listingWithGate(rejectedInput);
  const displayListing = buildDisplayInterpretation(listing);
  const explanation = displayListing.display.productionDecisionExplanation;

  assert.equal(displayListing.display.authoritativeDecisionSource, 'deal_gate');
  assert.equal(displayListing.display.authoritativeDecision, 'REJECTED');
  assert.equal(displayListing.display.primaryDecisionLabel, 'Rejected by Deal Gate');
  assert.equal(displayListing.display.primaryDecisionExplanation, 'Zero sold comps available.');
  assert.equal(explanation.decisionType, 'production_decision');
  assert.equal(explanation.authoritative, true);
  assert.equal(explanation.decision, 'REJECTED');
  assert.equal(explanation.failedReasons[0], 'Zero sold comps available.');
  assert.deepEqual(explanation.failedReasons, listing.dealGate.reasons);
  assert.deepEqual(displayListing.display.rejectionReasons, explanation.failedReasons);
  assert.deepEqual(explanation.reasonOrder, ['failedReasons', 'passedReasons']);
  assert.ok(explanation.ruleBreakdown.some((rule) => rule.ruleId === 'sold_comp_minimum' && rule.passed === false));
  assert.ok(explanation.sections.productionDecision.length > 0);
  assert.ok(explanation.sections.evidenceSupport.length > 0);
});

test('passed listings show authoritative pass and supporting reasons', () => {
  const listing = listingWithGate(strongGateInput());
  const displayListing = buildDisplayInterpretation(listing);
  const explanation = displayListing.display.productionDecisionExplanation;

  assert.equal(listing.dealGate.passed, true);
  assert.equal(displayListing.display.authoritativeDecision, 'BUY_NOW');
  assert.equal(displayListing.display.primaryDecisionLabel, 'BUY_NOW');
  assert.equal(displayListing.display.primaryDecisionExplanation, 'Supported by 8 sold comps.');
  assert.equal(explanation.label, 'Passed Deal Gate');
  assert.equal(explanation.decision, 'BUY_NOW');
  assert.equal(explanation.failedReasons.length, 0);
  assert.deepEqual(explanation.passedReasons, listing.dealGate.positives);
  assert.deepEqual(displayListing.display.passedReasons, listing.dealGate.positives);
  assert.ok(explanation.ruleBreakdown.every((rule) => Object.prototype.hasOwnProperty.call(rule, 'displayGroup')));
});

test('Deal Gate rule breakdown distinguishes production, financial, evidence, and context groups', () => {
  const listing = listingWithGate(strongGateInput({
    roi: 2.5,
    roiData: { roi: 2.5, roiPercent: 250 },
    compData: { trueSoldCompCount: 3, soldCompCount: 3, source: 'sold_market' },
    marketData: { confidence: 90, soldCompCount: 3, marketValue: 145, referencePrice: 140 }
  }));
  const displayListing = buildDisplayInterpretation(listing);
  const groups = new Set(displayListing.display.dealGateRuleBreakdown.map((rule) => rule.displayGroup));

  assert.ok(groups.has('production_decision'));
  assert.ok(groups.has('financial_context'));
  assert.ok(groups.has('evidence_support'));
  assert.ok(groups.has('legacy_context_signals'));
  assert.ok(displayListing.display.productionDecisionExplanation.sections.financialContext.some((rule) => rule.ruleId === 'excessive_roi_support'));
  assert.equal(displayListing.display.productionDecisionExplanation.failedReasons[0], 'ROI is excessive (250%) without very strong independent support.');
});

test('production decision explanation is additive and preserves Deal Gate, BUY_NOW, and raw values', () => {
  const listing = listingWithGate(strongGateInput({
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
  const before = JSON.parse(JSON.stringify(listing));
  const displayListing = buildDisplayInterpretation(listing);

  assert.deepEqual(listing, before);
  assert.equal(displayListing.dealGate.passed, before.dealGate.passed);
  assert.equal(displayListing.dealGate.buyNowAllowed, before.dealGate.buyNowAllowed);
  assert.equal(displayListing.dealGate.decision, before.dealGate.decision);
  assert.deepEqual(displayListing.dealGate.reasons, before.dealGate.reasons);
  assert.equal(displayListing.score, before.score);
  assert.equal(displayListing.estimatedValue, before.estimatedValue);
  assert.equal(displayListing.estimatedProfit, before.estimatedProfit);
  assert.equal(displayListing.roi, before.roi);
  assert.equal(displayListing.marketConfidence, before.marketConfidence);
  assert.deepEqual(displayListing.qualityData, before.qualityData);
  assert.deepEqual(displayListing.dealGrade, before.dealGrade);
  assert.deepEqual(displayListing.roiData, before.roiData);
});
