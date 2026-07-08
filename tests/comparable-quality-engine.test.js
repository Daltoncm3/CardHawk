'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const comparableQualityEngine = require('../engines/comparableQualityEngine');

const marketContext = {
  medianSold: 100,
  weightedSoldAverage: 102
};

test('true sold comp with strong identity and recent sale gets high quality', () => {
  const result = comparableQualityEngine.scoreComparable({
    marketContext,
    comp: {
      title: '2024 Topps Chrome John Doe Rookie PSA 10',
      soldPrice: 100,
      soldAt: '2026-07-01T00:00:00.000Z',
      source: 'ebay completed sold',
      saleType: 'auction',
      similarity: 96
    }
  });

  assert.equal(result.evidenceType, 'true_sold');
  assert.ok(result.comparableQualityScore >= 85);
  assert.equal(result.qualityBand, 'excellent');
  assert.equal(result.trustFactors.evidenceStrengthScore, 100);
  assert.equal(result.flags.activeOnly, false);
  assert.equal(result.flags.fallbackUnknown, false);
});

test('active comp never receives sold-equivalent evidence strength', () => {
  const result = comparableQualityEngine.scoreComparable({
    marketContext,
    comp: {
      title: '2024 Topps Chrome John Doe Rookie PSA 10',
      price: 100,
      status: 'active',
      source: 'active_market',
      similarity: 98
    }
  });

  assert.equal(result.evidenceType, 'active');
  assert.equal(result.trustFactors.evidenceStrengthScore, 45);
  assert.ok(result.comparableQualityScore <= 62);
  assert.equal(result.flags.activeOnly, true);
  assert.match(result.warnings.join(' '), /informational only/);
});

test('fallback unknown comp is clearly flagged and capped', () => {
  const result = comparableQualityEngine.scoreComparable({
    marketContext,
    comp: {
      title: 'Ambiguous comp',
      price: 100,
      similarity: 90
    }
  });

  assert.equal(result.evidenceType, 'fallback_unknown');
  assert.equal(result.flags.fallbackUnknown, true);
  assert.ok(result.comparableQualityScore <= 42);
  assert.match(result.warnings.join(' '), /unknown or fallback/);
});

test('identity rejected comp lands in reject', () => {
  const result = comparableQualityEngine.scoreComparable({
    marketContext,
    comp: {
      title: 'Wrong card',
      soldPrice: 100,
      soldAt: '2026-07-01T00:00:00.000Z',
      rejectedByIdentityGate: true,
      fatalMismatches: ['card number mismatch'],
      similarity: 92
    }
  });

  assert.equal(result.qualityBand, 'reject');
  assert.ok(result.comparableQualityScore <= 15);
  assert.equal(result.flags.rejectedByIdentityGate, true);
});

test('stale sold comp is penalized but remains true sold evidence', () => {
  const result = comparableQualityEngine.scoreComparable({
    marketContext,
    comp: {
      title: 'Old sold comp',
      soldPrice: 100,
      ageDays: 420,
      sold: true,
      similarity: 92
    }
  });

  assert.equal(result.evidenceType, 'true_sold');
  assert.equal(result.flags.staleComp, true);
  assert.ok(result.trustFactors.recencyScore < 35);
  assert.match(result.warnings.join(' '), /stale/);
});

test('price outlier relative to market context is flagged', () => {
  const result = comparableQualityEngine.scoreComparable({
    marketContext,
    comp: {
      title: 'Outlier sold comp',
      soldPrice: 300,
      soldAt: '2026-07-01T00:00:00.000Z',
      status: 'sold',
      similarity: 95
    }
  });

  assert.equal(result.flags.priceOutlier, true);
  assert.ok(result.trustFactors.priceReliabilityScore <= 25);
  assert.ok(result.comparableQualityScore <= 55);
});

test('batch comparable quality returns distribution and summary', () => {
  const result = comparableQualityEngine.evaluateComparableQuality({
    marketContext,
    comps: [
      {
        soldPrice: 100,
        soldAt: '2026-07-01T00:00:00.000Z',
        source: 'ebay completed sold',
        similarity: 96
      },
      {
        price: 100,
        status: 'active',
        similarity: 96
      },
      {
        price: 100
      },
      {
        soldPrice: 100,
        soldAt: '2026-07-01T00:00:00.000Z',
        rejectedByIdentityGate: true
      }
    ]
  });

  assert.equal(result.source, 'comparable_quality_engine');
  assert.equal(result.comparableCount, 4);
  assert.equal(result.scoredComparableCount, 4);
  assert.equal(result.qualityDistribution.reject, 1);
  assert.ok(result.qualityDistribution.excellent >= 1);
  assert.ok(result.summary);
});

test('engine does not mutate input comps', () => {
  const comp = Object.freeze({
    title: 'Immutable comp',
    soldPrice: 100,
    soldAt: '2026-07-01T00:00:00.000Z',
    similarity: 95
  });
  const before = JSON.stringify(comp);

  comparableQualityEngine.scoreComparable({ marketContext, comp });

  assert.equal(JSON.stringify(comp), before);
});

test('exports public comparable quality functions', () => {
  assert.equal(typeof comparableQualityEngine.evaluateComparableQuality, 'function');
  assert.equal(typeof comparableQualityEngine.scoreComparable, 'function');
  assert.equal(typeof comparableQualityEngine.summarizeComparableQuality, 'function');
});
