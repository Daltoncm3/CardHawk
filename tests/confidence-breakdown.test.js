'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { buildDisplayInterpretation, dealGate } = require('../server');

function activeOnlyListing(overrides = {}) {
  return {
    ebayItemId: 'confidence-active-only',
    title: 'Confidence Taxonomy Active Context Card',
    price: 10,
    totalCost: 10,
    score: 72,
    estimatedValue: 0,
    estimatedProfit: -10,
    roi: -0.2,
    marketConfidence: 86,
    confidenceCap: 86,
    confidenceReasons: [
      'active comps: 4',
      'avg similarity: 88',
      'seller trust: +10',
      'history signal: +8',
      'price sanity: +10',
      'strong card traits: +8'
    ],
    confidenceData: {
      confidence: 86,
      cap: 86,
      source: 'active_market',
      avgSimilarity: 88,
      compCount: 4,
      reasons: [
        'active comps: 4',
        'avg similarity: 88',
        'seller trust: +10',
        'history signal: +8',
        'price sanity: +10',
        'strong card traits: +8'
      ]
    },
    compCount: 4,
    compSource: 'active_market',
    compData: {
      compCount: 4,
      trueSoldCompCount: 0,
      soldCompCount: 0,
      activeCompCount: 4,
      source: 'active_market',
      averageSimilarity: 88
    },
    marketData: {
      source: 'active_market',
      method: 'active_context_only',
      confidence: 25,
      soldCompCount: 0,
      activeCompCount: 4
    },
    marketIntelligenceData: {
      intelligenceScore: 58,
      confidenceScore: 64,
      trustLevel: 'weak',
      recommendation: 'avoid',
      compStrength: 35,
      pricingReliability: 40,
      marketDepth: 25
    },
    decision: {
      recommendation: 'PASS',
      decisionConfidence: 42
    },
    dealGate: {
      passed: false,
      buyNowAllowed: false,
      decision: 'REJECT',
      reasons: ['Zero sold comps available.'],
      gate: {
        soldCompCount: 0,
        confidenceScore: 64
      }
    },
    ...overrides
  };
}

function strongGateInput(overrides = {}) {
  return {
    score: 92,
    estimatedProfit: 45,
    roi: 0.35,
    roiData: { roi: 0.35, roiPercent: 35 },
    condition: 'PSA 10',
    compData: { trueSoldCompCount: 8, soldCompCount: 8, source: 'sold_market' },
    marketData: { confidence: 90, soldCompCount: 8, marketValue: 145, referencePrice: 140, source: 'sold_market' },
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

test('confidenceBreakdown reconciles to existing raw confidence values', () => {
  const listing = activeOnlyListing();
  const before = JSON.parse(JSON.stringify(listing));
  const displayListing = buildDisplayInterpretation(listing);
  const breakdown = displayListing.display.confidenceBreakdown;

  assert.deepEqual(listing, before);
  assert.equal(breakdown.source, 'confidence_display_taxonomy');
  assert.equal(breakdown.decisionImpact, 'none');
  assert.equal(breakdown.rawFieldsPreserved, true);
  assert.equal(breakdown.productionDecisionSource, 'deal_gate');
  assert.equal(breakdown.dimensions.marketContextConfidence.rawValue, before.marketConfidence);
  assert.equal(breakdown.dimensions.valuationConfidence.rawValue, before.marketData.confidence);
  assert.equal(breakdown.dimensions.marketIntelligenceConfidence.rawValue, before.marketIntelligenceData.confidenceScore);
  assert.equal(breakdown.dimensions.soldEvidenceSupport.rawValue, before.dealGate.gate.soldCompCount);
  assert.equal(breakdown.dimensions.decisionConfidence.rawValue, before.decision.decisionConfidence);
});

test('display labels use the confidence taxonomy', () => {
  const displayListing = buildDisplayInterpretation(activeOnlyListing());

  assert.equal(displayListing.display.marketConfidenceLabel, 'Market Context Confidence');
  assert.equal(displayListing.display.soldEvidenceConfidenceLabel, 'Sold Evidence Support');
  assert.equal(displayListing.display.marketIntelligenceConfidenceLabel, 'Market Intelligence Confidence');
  assert.equal(displayListing.display.marketContextConfidence.label, 'Market Context Confidence');
  assert.equal(displayListing.display.soldEvidenceSupport.label, 'Sold Evidence Support');
  assert.equal(displayListing.display.marketIntelligenceConfidence.label, 'Market Intelligence Confidence');
  assert.equal(displayListing.display.marketContextConfidence.authority, 'context_only_non_authoritative');
  assert.equal(displayListing.display.soldEvidenceSupport.authority, 'evidence_only_non_authoritative');
  assert.equal(displayListing.display.marketIntelligenceConfidence.authority, 'context_only_non_authoritative');
});

test('sold evidence support stays separate from active-only market context confidence', () => {
  const displayListing = buildDisplayInterpretation(activeOnlyListing());
  const marketContext = displayListing.display.confidenceBreakdown.dimensions.marketContextConfidence;
  const soldSupport = displayListing.display.confidenceBreakdown.dimensions.soldEvidenceSupport;

  assert.equal(marketContext.rawValue, 86);
  assert.equal(marketContext.sourceDetails.activeContext, true);
  assert.equal(marketContext.sourceDetails.sellerTrust, true);
  assert.equal(marketContext.sourceDetails.listingHistory, true);
  assert.equal(marketContext.sourceDetails.priceSanity, true);
  assert.equal(marketContext.sourceDetails.cardTraits, true);
  assert.equal(marketContext.capApplied, 86);

  assert.equal(soldSupport.rawValue, 0);
  assert.deepEqual(soldSupport.evidenceSourcesAllowed, ['true_sold']);
  assert.equal(soldSupport.sourceDetails.trueSoldCompCount, 0);
  assert.equal(soldSupport.sourceDetails.activeCompCount, 4);
  assert.equal(soldSupport.sourceDetails.activeOnlyFlag, true);
  assert.equal(soldSupport.productionEligible, false);
});

test('confidence dimensions expose meaning, source policy, caps, and production eligibility', () => {
  const dimensions = buildDisplayInterpretation(activeOnlyListing({
    identityConfidence: 0.93
  })).display.confidenceBreakdown.dimensions;

  for (const dimension of Object.values(dimensions)) {
    assert.equal(typeof dimension.dimensionId, 'string');
    assert.equal(typeof dimension.label, 'string');
    assert.equal(typeof dimension.whatItMeasures, 'string');
    assert.equal(Array.isArray(dimension.evidenceSourcesAllowed), true);
    assert.equal(dimension.productionEligible, false);
    assert.ok(Object.prototype.hasOwnProperty.call(dimension, 'rawValue'));
    assert.ok(Object.prototype.hasOwnProperty.call(dimension, 'capApplied'));
    assert.ok(Object.prototype.hasOwnProperty.call(dimension, 'sourceDetails'));
  }

  assert.equal(dimensions.identityConfidence.rawValue, 0.93);
  assert.equal(dimensions.identityConfidence.sourceDetails.available, true);
});

test('confidenceBreakdown does not change Deal Gate or BUY_NOW behavior', () => {
  const gateBefore = dealGate(strongGateInput());
  const displayListing = buildDisplayInterpretation({
    ...activeOnlyListing(),
    dealGate: gateBefore
  });
  const gateAfter = dealGate(strongGateInput());

  assert.equal(gateBefore.passed, gateAfter.passed);
  assert.equal(gateBefore.buyNowAllowed, gateAfter.buyNowAllowed);
  assert.equal(gateBefore.decision, gateAfter.decision);
  assert.deepEqual(gateBefore.reasons, gateAfter.reasons);
  assert.equal(displayListing.display.confidenceBreakdown.decisionImpact, 'none');
  assert.equal(displayListing.display.authoritativeDecisionSource, 'deal_gate');
});
