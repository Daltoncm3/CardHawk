'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { buildDisplayInterpretation, dealGate } = require('../server');

function decisionIntelligence(overrides = {}) {
  return {
    source: 'decision_intelligence_engine',
    version: '1.4',
    mode: 'explanation_only',
    recommendationImpact: 'none',
    overallReadiness: 'supported_context',
    evidencePosture: 'adequate',
    compPosture: 'usable',
    valuationPosture: 'usable_range',
    resalePressurePosture: 'low',
    supportingSignals: [
      { source: 'evidence_sufficiency', message: 'Evidence sufficiency supports cautious market interpretation.' }
    ],
    cautionSignals: [],
    blockers: [],
    conflicts: [],
    summary: 'Decision Intelligence is explanation-only with recommendation impact none.',
    ...overrides
  };
}

function baseListing(overrides = {}) {
  return {
    ebayItemId: 'evidence-readiness-display',
    title: 'Evidence Readiness Display Test Card',
    price: 40,
    totalCost: 45,
    score: 82,
    estimatedValue: 90,
    estimatedProfit: 30,
    roi: 0.67,
    marketConfidence: 80,
    compData: {
      trueSoldCompCount: 5,
      soldCompCount: 5,
      activeCompCount: 2
    },
    marketData: {
      confidence: 80,
      soldCompCount: 5,
      source: 'sold_market'
    },
    marketIntelligenceData: {
      intelligenceScore: 86,
      confidenceScore: 82,
      trustLevel: 'good',
      recommendation: 'buy',
      decisionIntelligence: decisionIntelligence()
    },
    dealGate: {
      passed: true,
      buyNowAllowed: true,
      decision: 'BUY_NOW',
      recommendation: 'buy_now',
      reasons: [],
      positives: ['Supported by 5 sold comps.'],
      gate: {
        soldCompCount: 5,
        confidenceScore: 82,
        marketIntelligenceScore: 86
      }
    },
    ...overrides
  };
}

function strongGateInput(overrides = {}) {
  return {
    score: 88,
    estimatedProfit: 35,
    roi: 0.4,
    roiData: { roi: 0.4, roiPercent: 40 },
    condition: 'PSA 10',
    compData: { trueSoldCompCount: 6, soldCompCount: 6, source: 'sold_market' },
    marketData: { confidence: 86, soldCompCount: 6, marketValue: 120, referencePrice: 115, source: 'sold_market' },
    marketIntelligenceScore: 88,
    marketTrustLevel: 'good',
    marketRecommendation: 'trust',
    marketIntelligenceData: {
      intelligenceScore: 88,
      confidenceScore: 86,
      trustLevel: 'good',
      recommendation: 'trust',
      liquidity: { score: 78, level: 'good' },
      priceConsistency: { score: 76, level: 'good' }
    },
    riskLevel: 'low',
    ...overrides
  };
}

test('raw Decision Intelligence remains unchanged', () => {
  const listing = baseListing();
  const before = JSON.parse(JSON.stringify(listing));
  const displayListing = buildDisplayInterpretation(listing);

  assert.deepEqual(listing, before);
  assert.deepEqual(
    displayListing.marketIntelligenceData.decisionIntelligence,
    before.marketIntelligenceData.decisionIntelligence
  );
  assert.deepEqual(
    displayListing.display.signalAnnotations.decision_intelligence.rawValue,
    before.marketIntelligenceData.decisionIntelligence
  );
});

test('display reclassifies Decision Intelligence as Evidence Readiness', () => {
  const display = buildDisplayInterpretation(baseListing()).display;

  assert.equal(display.decisionIntelligenceLabel, 'Evidence Readiness');
  assert.equal(display.evidenceReadinessLabel, 'Evidence Readiness');
  assert.equal(display.evidenceReadinessExplanation.label, 'Evidence Readiness');
  assert.equal(display.evidenceReadinessExplanation.readinessLabel, 'Evidence Readiness');
  assert.equal(display.evidenceReadinessExplanation.evidenceReadiness, 'supported_context');
  assert.equal(Object.prototype.hasOwnProperty.call(display.evidenceReadinessExplanation, 'buyReadiness'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(display.evidenceReadinessExplanation, 'productionReadiness'), false);
});

test('positive evidence readiness cannot override Deal Gate rejection', () => {
  const displayListing = buildDisplayInterpretation(baseListing({
    dealGate: {
      passed: false,
      buyNowAllowed: false,
      decision: 'REJECT',
      recommendation: 'reject',
      reasons: ['Estimated profit is not positive.'],
      positives: ['Supported by 5 sold comps.'],
      gate: {
        soldCompCount: 5,
        confidenceScore: 82,
        marketIntelligenceScore: 86
      }
    }
  }));
  const explanation = displayListing.display.evidenceReadinessExplanation;

  assert.equal(displayListing.display.authoritativeDecisionSource, 'deal_gate');
  assert.equal(displayListing.display.authoritativeDecision, 'REJECTED');
  assert.equal(displayListing.display.primaryDecisionLabel, 'Rejected by Deal Gate');
  assert.equal(explanation.evidenceReadiness, 'supported_context');
  assert.equal(explanation.productionImpact, 'none');
  assert.equal(explanation.contextualOnly, true);
  assert.match(explanation.contextualOnlyReason, /cannot override a Deal Gate rejection/i);
});

test('dealGateAlignment is calculated for aligned, conflicting, and not evaluated cases', () => {
  const acceptedSupported = buildDisplayInterpretation(baseListing()).display.evidenceReadinessExplanation;
  assert.equal(acceptedSupported.dealGateAlignment, 'aligned');

  const rejectedNotReady = buildDisplayInterpretation(baseListing({
    dealGate: {
      passed: false,
      reasons: ['Zero sold comps available.'],
      gate: { soldCompCount: 0 }
    },
    marketIntelligenceData: {
      ...baseListing().marketIntelligenceData,
      decisionIntelligence: decisionIntelligence({
        overallReadiness: 'not_ready',
        evidencePosture: 'unreliable',
        blockers: [{ source: 'evidence_sufficiency', message: 'No true sold evidence is available.' }]
      })
    }
  })).display.evidenceReadinessExplanation;
  assert.equal(rejectedNotReady.dealGateAlignment, 'aligned');

  const rejectedSupported = buildDisplayInterpretation(baseListing({
    dealGate: {
      passed: false,
      reasons: ['Estimated profit is not positive.'],
      gate: { soldCompCount: 5 }
    }
  })).display.evidenceReadinessExplanation;
  assert.equal(rejectedSupported.dealGateAlignment, 'conflicting');

  const notEvaluated = buildDisplayInterpretation(baseListing({ dealGate: null })).display.evidenceReadinessExplanation;
  assert.equal(notEvaluated.dealGateAlignment, 'not_evaluated');
});

test('evidenceReadinessExplanation exposes the required additive API shape', () => {
  const explanation = buildDisplayInterpretation(baseListing()).display.evidenceReadinessExplanation;

  assert.equal(explanation.authoritativeDecisionSource, 'deal_gate');
  assert.equal(explanation.productionImpact, 'none');
  assert.equal(explanation.explainsDealGate, false);
  assert.equal(explanation.evidencePosture, 'adequate');
  assert.equal(explanation.compPosture, 'usable');
  assert.equal(explanation.valuationPosture, 'usable_range');
  assert.equal(explanation.resalePressurePosture, 'low');
  assert.deepEqual(explanation.blockers, []);
  assert.deepEqual(explanation.cautions, []);
  assert.deepEqual(explanation.conflicts, []);
  assert.equal(explanation.supportingContext.length, 1);
  assert.equal(explanation.rawDecisionIntelligencePreserved, true);
});

test('evidence readiness display does not change Deal Gate or BUY_NOW behavior', () => {
  const gateBefore = dealGate(strongGateInput());
  const displayListing = buildDisplayInterpretation({
    ...baseListing(),
    dealGate: gateBefore
  });
  const gateAfter = dealGate(strongGateInput());

  assert.equal(gateBefore.passed, gateAfter.passed);
  assert.equal(gateBefore.buyNowAllowed, gateAfter.buyNowAllowed);
  assert.equal(gateBefore.decision, gateAfter.decision);
  assert.deepEqual(gateBefore.reasons, gateAfter.reasons);
  assert.equal(displayListing.display.evidenceReadinessExplanation.productionImpact, 'none');
  assert.equal(displayListing.display.authoritativeDecisionSource, 'deal_gate');
});
