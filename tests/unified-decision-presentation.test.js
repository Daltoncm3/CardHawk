'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { buildDisplayInterpretation, dealGate } = require('../server');

const EXPECTED_HIERARCHY = [
  'deal_gate_production_decision',
  'production_decision_explanation',
  'sold_evidence_support',
  'valuation_financial_context',
  'evidence_readiness',
  'market_context_confidence',
  'legacy_context_score',
  'desirability_context',
  'legacy_deal_grade'
];

function decisionIntelligence(overrides = {}) {
  return {
    source: 'decision_intelligence_engine',
    mode: 'explanation_only',
    recommendationImpact: 'none',
    overallReadiness: 'supported_context',
    evidencePosture: 'adequate',
    compPosture: 'usable',
    valuationPosture: 'usable_range',
    resalePressurePosture: 'low',
    supportingSignals: [
      { source: 'valuation_range', message: 'Valuation range is usable for explanation.' }
    ],
    cautionSignals: [],
    blockers: [],
    conflicts: [],
    summary: 'Evidence, comp trust, valuation range, and resale pressure are aligned enough for supported context.',
    ...overrides
  };
}

function baseListing(overrides = {}) {
  return {
    ebayItemId: 'unified-decision-presentation',
    title: 'Unified Decision Presentation Test Card',
    price: 50,
    totalCost: 55,
    score: 84,
    estimatedValue: 105,
    estimatedProfit: 32,
    roi: 0.58,
    marketConfidence: 82,
    investmentQuality: 91,
    qualityBucket: 'Strong Buy Candidate',
    qualityData: {
      investmentQuality: 91,
      bucket: 'Strong Buy Candidate'
    },
    dealGrade: {
      grade: 'B+',
      action: 'BUY_NOW',
      gradeScore: 86
    },
    roiData: {
      recommendation: 'BUY_NOW'
    },
    compData: {
      trueSoldCompCount: 5,
      soldCompCount: 5,
      activeCompCount: 2
    },
    marketData: {
      source: 'sold_market',
      confidence: 82,
      soldCompCount: 5,
      activeCompCount: 2
    },
    marketIntelligenceScore: 86,
    marketTrustLevel: 'good',
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

test('unifiedDecisionPresentation exposes the required ordered hierarchy', () => {
  const presentation = buildDisplayInterpretation(baseListing()).display.unifiedDecisionPresentation;

  assert.equal(presentation.source, 'unified_decision_presentation');
  assert.deepEqual(presentation.hierarchy, EXPECTED_HIERARCHY);
  assert.deepEqual(presentation.sections.map((section) => section.sectionId), EXPECTED_HIERARCHY);
  assert.deepEqual(presentation.sections.map((section) => section.order), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(presentation.sections.map((section) => section.label), [
    'Deal Gate Production Decision',
    'Production Decision Explanation',
    'Sold Evidence Support',
    'Valuation and Financial Context',
    'Evidence Readiness',
    'Market Context Confidence',
    'Legacy Context Score',
    'Desirability Context',
    'Legacy Deal Grade'
  ]);
});

test('Deal Gate is always first and authoritative', () => {
  const presentation = buildDisplayInterpretation(baseListing()).display.unifiedDecisionPresentation;
  const first = presentation.sections[0];

  assert.equal(first.sectionId, 'deal_gate_production_decision');
  assert.equal(first.sectionType, 'production decision');
  assert.equal(first.authoritative, true);
  assert.equal(first.signalId, 'deal_gate');
  assert.equal(first.signalAnnotation.signalType, 'production_decision');
  assert.equal(presentation.authoritativeDecisionSource, 'deal_gate');
  assert.equal(presentation.productionDecisionSignal, 'deal_gate');
});

test('rejected listings show failed Deal Gate reasons before contextual signals', () => {
  const display = buildDisplayInterpretation(baseListing({
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
  })).display;
  const presentation = display.unifiedDecisionPresentation;

  assert.equal(display.authoritativeDecision, 'REJECTED');
  assert.equal(presentation.failedReasonsFirst, true);
  assert.equal(presentation.sections[0].content.primaryDecisionLabel, 'Rejected by Deal Gate');
  assert.deepEqual(presentation.sections[0].content.failedReasons, ['Estimated profit is not positive.']);
  assert.equal(presentation.sections[4].content.evidenceReadiness, 'supported_context');
  assert.equal(presentation.sections[4].content.productionImpact, 'none');
  assert.match(presentation.sections[4].content.contextualOnlyReason, /cannot override a Deal Gate rejection/i);
});

test('accepted listings preserve context information in lower hierarchy sections', () => {
  const display = buildDisplayInterpretation(baseListing()).display;
  const presentation = display.unifiedDecisionPresentation;

  assert.equal(display.authoritativeDecision, 'BUY_NOW');
  assert.equal(presentation.sections[2].sectionType, 'evidence support');
  assert.equal(presentation.sections[2].content.rawValue, 5);
  assert.equal(presentation.sections[3].sectionType, 'financial context');
  assert.equal(presentation.sections[3].content.estimatedProfit, 32);
  assert.equal(presentation.sections[4].content.evidenceReadiness, 'supported_context');
  assert.equal(presentation.sections[5].sectionType, 'market context');
  assert.equal(presentation.sections[6].sectionType, 'legacy/context only');
  assert.equal(presentation.sections[7].content.bucketLabel, 'Strong desirability context');
  assert.equal(presentation.sections[8].content.legacyGradeActionLabel, 'Legacy grade context');
});

test('unified presentation preserves all raw values', () => {
  const listing = baseListing();
  const before = JSON.parse(JSON.stringify(listing));
  const displayListing = buildDisplayInterpretation(listing);

  assert.deepEqual(listing, before);
  assert.equal(displayListing.score, before.score);
  assert.equal(displayListing.estimatedValue, before.estimatedValue);
  assert.equal(displayListing.estimatedProfit, before.estimatedProfit);
  assert.equal(displayListing.roi, before.roi);
  assert.equal(displayListing.marketConfidence, before.marketConfidence);
  assert.deepEqual(displayListing.qualityData, before.qualityData);
  assert.deepEqual(displayListing.dealGrade, before.dealGrade);
  assert.deepEqual(displayListing.roiData, before.roiData);
  assert.deepEqual(displayListing.marketIntelligenceData, before.marketIntelligenceData);
  assert.deepEqual(displayListing.dealGate, before.dealGate);
  assert.equal(displayListing.display.unifiedDecisionPresentation.rawFieldsPreserved, true);
});

test('unified presentation does not change Deal Gate or BUY_NOW behavior', () => {
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
  assert.equal(displayListing.display.unifiedDecisionPresentation.productionImpact, 'none');
  assert.equal(displayListing.display.unifiedDecisionPresentation.sections[0].authoritative, true);
});
