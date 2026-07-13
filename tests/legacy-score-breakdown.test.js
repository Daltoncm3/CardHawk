'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { buildDisplayInterpretation, createLegacyScoreBreakdown, dealGate } = require('../server');

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

test('scoreBreakdown totals reconcile to the existing legacy Score formula', () => {
  const breakdown = createLegacyScoreBreakdown({
    parsed: {
      qualityTier: 'watch',
      grade: 10,
      setName: 'Prizm',
      flags: {
        firstBowman: true,
        numbered: true
      }
    },
    trendData: { scoreBonus: 8 },
    estimatedProfit: 80,
    roi: 0.7,
    combinedConfidence: 76,
    marketData: { source: 'sold_market' },
    listing: {
      totalCost: 50,
      sellerFeedbackPercentage: 99.5,
      sellerFeedbackScore: 500
    }
  });

  const contributionTotal = breakdown.contributions.reduce((sum, entry) => sum + entry.value, 0);

  assert.equal(breakdown.trend.contribution, 8);
  assert.equal(breakdown.parsedCardTier.contribution, 20);
  assert.equal(breakdown.profit.contribution, 40);
  assert.equal(breakdown.roi.contribution, 30);
  assert.equal(breakdown.confidence.contribution, 14);
  assert.equal(breakdown.marketSource.contribution, 8);
  assert.equal(breakdown.cardTraits.contribution, 28);
  assert.equal(breakdown.seller.contribution, 6);
  assert.equal(breakdown.preClampTotal, contributionTotal);
  assert.equal(breakdown.finalScore, clampScore(breakdown.preClampTotal));
  assert.equal(breakdown.finalScore, 100);
});

test('scoreBreakdown preserves legacy reset behavior for avoid and safety cases', () => {
  const breakdown = createLegacyScoreBreakdown({
    parsed: {
      qualityTier: 'avoid',
      grade: 10,
      setName: 'Prizm',
      flags: {
        reprint: true
      }
    },
    trendData: { scoreBonus: 12 },
    estimatedProfit: 100,
    roi: 0.8,
    combinedConfidence: 80,
    marketData: { source: 'fallback' },
    listing: {
      totalCost: 0,
      sellerFeedbackPercentage: 99.5,
      sellerFeedbackScore: 500
    }
  });

  assert.ok(breakdown.adjustments.some((entry) => entry.id === 'avoid'));
  assert.ok(breakdown.adjustments.some((entry) => entry.id === 'non_positive_total_cost'));
  assert.equal(breakdown.finalScore, 0);
  assert.equal(breakdown.preClampTotal, 0);
});

test('rejected listings retain raw Score for debugging but display it as legacy context', () => {
  const listing = {
    score: 88,
    estimatedValue: 0,
    estimatedProfit: -12,
    roi: -0.4,
    marketConfidence: 20,
    qualityBucket: 'Strong Buy Candidate',
    qualityData: {
      investmentQuality: 80,
      bucket: 'Strong Buy Candidate'
    },
    dealGate: {
      passed: false,
      reasons: ['Zero sold comps available.'],
      gate: { soldCompCount: 0 }
    },
    scoreBreakdown: {
      source: 'legacy_score_breakdown',
      preClampTotal: 88,
      finalScore: 88
    }
  };

  const before = JSON.parse(JSON.stringify(listing));
  const displayListing = buildDisplayInterpretation(listing);

  assert.deepEqual(listing, before);
  assert.equal(displayListing.score, 88);
  assert.equal(displayListing.scoreBreakdown.finalScore, 88);
  assert.equal(displayListing.display.legacyScoreLabel, 'Legacy Context Score');
  assert.equal(displayListing.display.legacyScoreAuthority, 'legacy_context_only');
  assert.equal(displayListing.display.signalAnnotations.legacy_score.rawValue, 88);
  assert.equal(displayListing.display.signalAnnotations.legacy_score.decisionEligibility, 'decision_support');
  assert.equal(displayListing.display.authoritativeDecision, 'REJECTED');
});

test('Deal Gate decision behavior is unchanged by scoreBreakdown presence', () => {
  const baseListing = {
    score: 95,
    estimatedProfit: 200,
    roi: 0.75,
    roiData: { roiPercent: 75 },
    marketConfidence: 90,
    marketIntelligenceScore: 90,
    marketTrustLevel: 'good',
    riskLevel: 'low',
    condition: 'PSA 10',
    marketData: {
      confidence: 90,
      source: 'sold_market',
      soldCompCount: 5
    },
    compData: {
      trueSoldCompCount: 5,
      soldCompCount: 5,
      compSource: 'sold_market'
    },
    marketIntelligenceData: {
      intelligenceScore: 90,
      confidenceScore: 90,
      trustLevel: 'good',
      liquidity: { score: 80, level: 'good' },
      priceConsistency: { score: 80, level: 'good' }
    }
  };

  const withoutBreakdown = dealGate(baseListing);
  const withBreakdown = dealGate({
    ...baseListing,
    scoreBreakdown: {
      source: 'legacy_score_breakdown',
      preClampTotal: 95,
      finalScore: 95
    }
  });

  assert.equal(withBreakdown.passed, withoutBreakdown.passed);
  assert.deepEqual(withBreakdown.reasons, withoutBreakdown.reasons);
  assert.equal(withBreakdown.gate.score, withoutBreakdown.gate.score);
});

