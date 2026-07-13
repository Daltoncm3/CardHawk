'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const gradingEngine = require('../engines/gradingEngine');
const { buildDisplayInterpretation, dealGate } = require('../server');

function gradeInput(overrides = {}) {
  return {
    title: '2024 Bowman Chrome 1st Bowman Rookie Auto Gold Refractor /50 PSA 10',
    image: 'https://example.test/card.jpg',
    totalCost: 100,
    estimatedProfit: 225,
    roi: 0.85,
    score: 96,
    marketConfidence: 92,
    compCount: 9,
    compSource: 'active_market',
    sellerFeedbackPercentage: 99.8,
    sellerFeedbackScore: 1200,
    parsed: {
      qualityTier: 'premium',
      flags: {
        graded: true,
        autograph: true,
        rookie: true,
        numbered: true,
        firstBowman: true
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

function stableDealGrade(dealGrade) {
  const clone = JSON.parse(JSON.stringify(dealGrade));
  delete clone.createdAt;
  delete clone.dealGradeBreakdown;
  return clone;
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

test('dealGradeBreakdown reconciles exactly to the existing Deal Grade score', () => {
  const dealGrade = gradingEngine.gradeDeal(gradeInput());
  const breakdown = dealGrade.dealGradeBreakdown;
  const contributionTotal = sum(breakdown.contributions.map((entry) => entry.value));

  assert.equal(dealGrade.grade, 'A+');
  assert.equal(dealGrade.gradeScore, 100);
  assert.equal(dealGrade.action, 'BUY_NOW');
  assert.equal(breakdown.source, 'deal_grade_breakdown');
  assert.equal(breakdown.decisionImpact, 'none');
  assert.equal(breakdown.preClampTotal, contributionTotal);
  assert.equal(breakdown.finalGradeScore, dealGrade.gradeScore);
  assert.equal(breakdown.finalLetterGrade, dealGrade.grade);
  assert.equal(breakdown.rawAction, dealGrade.action);
  assert.equal(breakdown.profit.contribution, 24);
  assert.equal(breakdown.roi.contribution, 18);
  assert.equal(breakdown.confidence.contribution, 20);
  assert.equal(breakdown.legacyContextScore.contribution, 16);
  assert.equal(breakdown.compSource.contribution, 8);
  assert.equal(breakdown.compCount.contribution, 8);
  assert.equal(breakdown.parsedCardTier.contribution, 10);
  assert.equal(breakdown.sellerTrust.contribution, 14);
  assert.ok(breakdown.listingQuality.contribution > 0);
  assert.ok(breakdown.cardTraits.contribution > 0);
});

test('dealGradeBreakdown exposes penalties while preserving raw grade fields', () => {
  const dealGrade = gradingEngine.gradeDeal(gradeInput({
    title: 'Custom Reprint Digital Mystery Lot',
    image: '',
    totalCost: 900,
    estimatedProfit: -20,
    roi: -0.25,
    score: 40,
    marketConfidence: 20,
    compCount: 0,
    compSource: 'heuristic_fallback',
    sellerFeedbackPercentage: 95,
    sellerFeedbackScore: 12,
    parsed: {
      qualityTier: 'avoid',
      flags: {
        lot: true,
        reprint: true,
        custom: true,
        digital: true
      }
    }
  }));
  const breakdown = dealGrade.dealGradeBreakdown;

  assert.equal(dealGrade.action, 'PASS');
  assert.equal(breakdown.rawAction, 'PASS');
  assert.equal(breakdown.profit.contribution, -8);
  assert.equal(breakdown.roi.contribution, -8);
  assert.equal(breakdown.confidence.contribution, -10);
  assert.equal(breakdown.legacyContextScore.contribution, -8);
  assert.equal(breakdown.compSource.contribution, -6);
  assert.equal(breakdown.compCount.contribution, -8);
  assert.equal(breakdown.parsedCardTier.contribution, -50);
  assert.ok(breakdown.listingRiskPenalties.contribution < 0);
  assert.equal(breakdown.capitalExposure.contribution, -12);
  assert.equal(stableDealGrade(dealGrade).action, 'PASS');
});

test('display reclassifies Deal Grade as non-authoritative legacy context', () => {
  const dealGrade = gradingEngine.gradeDeal(gradeInput());
  const listing = {
    score: 95,
    estimatedValue: 150,
    estimatedProfit: 50,
    roi: 0.5,
    marketConfidence: 90,
    investmentQuality: 85,
    qualityBucket: 'Strong Buy Candidate',
    qualityData: { investmentQuality: 85, bucket: 'Strong Buy Candidate' },
    dealGrade,
    roiData: { recommendation: 'BUY_NOW' },
    dealGate: dealGate(strongGateInput())
  };
  const before = JSON.parse(JSON.stringify(listing));
  const displayListing = buildDisplayInterpretation(listing);

  assert.deepEqual(listing, before);
  assert.equal(displayListing.dealGrade.action, 'BUY_NOW');
  assert.equal(displayListing.display.dealGradeScoreLabel, 'Legacy Deal Grade');
  assert.equal(displayListing.display.legacyGradeActionLabel, 'Legacy grade context');
  assert.equal(displayListing.display.legacyGradeActionAuthority, 'legacy_context_only');
  assert.equal(displayListing.display.signalAnnotations.deal_grade.signalType, 'legacy');
  assert.notEqual(displayListing.display.authoritativeDecisionSource, 'deal_grade');
  assert.equal(displayListing.display.authoritativeDecisionSource, 'deal_gate');
  assert.equal(/BUY_NOW|STRONG_REVIEW|REVIEW|WATCH|LOW_PRIORITY|PASS/.test(displayListing.display.legacyGradeActionLabel), false);
});

test('all Deal Grade raw actions display as neutral legacy context wording', () => {
  const actions = ['BUY_NOW', 'STRONG_REVIEW', 'REVIEW', 'WATCH', 'LOW_PRIORITY', 'PASS'];

  for (const action of actions) {
    const displayListing = buildDisplayInterpretation({
      dealGrade: { grade: 'B', gradeScore: 70, action },
      dealGate: { passed: true, reasons: [], positives: [] }
    });

    assert.equal(displayListing.dealGrade.action, action);
    assert.equal(displayListing.display.legacyGradeActionLabel, 'Legacy grade context');
    assert.equal(/BUY_NOW|STRONG_REVIEW|REVIEW|WATCH|LOW_PRIORITY|PASS/.test(displayListing.display.legacyGradeActionLabel), false);
  }
});

test('dealGradeBreakdown does not change Deal Gate or BUY_NOW behavior', () => {
  const dealGrade = gradingEngine.gradeDeal(gradeInput());
  const gateInput = strongGateInput({ dealGrade: dealGrade.grade });
  const gateWithBreakdown = dealGate(gateInput);
  const strippedDealGrade = { ...dealGrade };
  delete strippedDealGrade.dealGradeBreakdown;
  const gateWithoutBreakdown = dealGate({ ...gateInput, dealGrade: strippedDealGrade.grade });

  assert.equal(gateWithBreakdown.passed, gateWithoutBreakdown.passed);
  assert.equal(gateWithBreakdown.buyNowAllowed, gateWithoutBreakdown.buyNowAllowed);
  assert.equal(gateWithBreakdown.decision, gateWithoutBreakdown.decision);
  assert.deepEqual(gateWithBreakdown.reasons, gateWithoutBreakdown.reasons);
  assert.deepEqual(gateWithBreakdown.positives, gateWithoutBreakdown.positives);
});
