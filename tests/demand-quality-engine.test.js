'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const demandQualityEngine = require('../engines/demandQualityEngine');

function buildSoldSales(count = 8) {
  const sellers = ['seller-a', 'seller-b', 'seller-c', 'seller-d'];
  const sources = ['ebay', 'alt'];

  return Array.from({ length: count }, (_, index) => ({
    price: 95 + index,
    soldAt: `2026-06-${String(index + 1).padStart(2, '0')}`,
    seller: sellers[index % sellers.length],
    source: sources[index % sources.length],
    ageDays: index + 3
  }));
}

function buildInput(overrides = {}) {
  return {
    salesVelocityData: {
      salesVelocityScore: 78,
      soldLast7Days: 2,
      soldLast30Days: 7,
      soldLast90Days: 14,
      salesTrend: 'stable',
      demandStrength: 'strong',
      confidence: 78,
      details: {
        priceVolatility: 0.12,
        seasonalSpike: false,
        earlyMarket: false,
        duplicateSalesExcluded: 0,
        soldCount: 8,
        ...(overrides.salesVelocityData?.details || {})
      },
      ...(overrides.salesVelocityData || {})
    },
    trendData: {
      direction: 'Stable',
      percentChange: 2,
      trendScore: 58,
      confidence: 72,
      ...(overrides.trendData || {})
    },
    marketRegime: {
      primaryRegime: 'stable',
      secondaryRegimes: [],
      regimes: ['stable'],
      ...(overrides.marketRegime || {})
    },
    evidenceSummary: {
      trueSoldCount: 8,
      activeCount: 3,
      priceSpread: 0.22,
      volatility: 0.12,
      activeOnlyFlag: false,
      fallbackOnlyFlag: false,
      normalizedEvidence: buildSoldSales(8).map((sale) => ({
        ...sale,
        evidenceType: 'true_sold'
      })),
      ...(overrides.evidenceSummary || {})
    },
    soldSales: buildSoldSales(8),
    ...(overrides.root || {})
  };
}

test('exports demand quality public API', () => {
  assert.equal(typeof demandQualityEngine.evaluateDemandQuality, 'function');
  assert.equal(typeof demandQualityEngine.scoreDemandQuality, 'function');
  assert.equal(typeof demandQualityEngine.summarizeDemandQuality, 'function');
});

test('empty input returns unknown and unproven demand safely', () => {
  const result = demandQualityEngine.evaluateDemandQuality();

  assert.equal(result.source, 'demand_quality_engine');
  assert.equal(result.demandQualityLevel, 'unproven');
  assert.equal(result.durability, 'unknown');
  assert.equal(result.breadth, 'unknown');
  assert.equal(result.repeatability, 'unknown');
  assert.ok(result.demandQualityScore <= 20);
  assert.ok(result.warnings.length > 0);
  assert.equal(result.dimensions.soldDepth.status, 'unknown');
});

test('broad repeat sales return strong durable demand', () => {
  const result = demandQualityEngine.evaluateDemandQuality(buildInput());

  assert.ok(['strong', 'excellent'].includes(result.demandQualityLevel));
  assert.equal(result.durability, 'durable');
  assert.equal(result.breadth, 'broad');
  assert.equal(result.repeatability, 'repeatable');
  assert.equal(result.dimensions.buyerSellerBreadth.status, 'broad');
  assert.equal(result.dimensions.priceParticipation.status, 'controlled');
});

test('hype-driven clustered demand stays local to warnings and caps quality', () => {
  const result = demandQualityEngine.evaluateDemandQuality(buildInput({
    salesVelocityData: {
      soldLast7Days: 5,
      soldLast30Days: 8,
      soldLast90Days: 8,
      details: {
        seasonalSpike: true
      }
    },
    trendData: {
      direction: 'Strong Uptrend',
      percentChange: 36
    },
    marketRegime: {
      primaryRegime: 'hype_driven',
      secondaryRegimes: ['volatile'],
      regimes: ['hype_driven', 'volatile']
    }
  }));

  assert.equal(result.dimensions.hypeDistortion.status, 'high');
  assert.equal(result.dimensions.timeDistribution.status, 'clustered');
  assert.notEqual(result.demandQualityLevel, 'excellent');
  assert.match(result.warnings.join(' '), /hype/i);
});

test('one or two sold records are treated as thin and not durable', () => {
  const result = demandQualityEngine.evaluateDemandQuality(buildInput({
    salesVelocityData: {
      salesVelocityScore: 28,
      soldLast7Days: 0,
      soldLast30Days: 1,
      soldLast90Days: 1,
      demandStrength: 'weak',
      details: {
        soldCount: 1
      }
    },
    evidenceSummary: {
      trueSoldCount: 1,
      normalizedEvidence: [
        { evidenceType: 'true_sold', price: 100, seller: 'seller-a', source: 'ebay', ageDays: 20 }
      ]
    },
    root: {
      soldSales: [
        { price: 100, seller: 'seller-a', source: 'ebay', soldAt: '2026-06-20' }
      ]
    }
  }));

  assert.equal(result.dimensions.soldDepth.status, 'thin');
  assert.ok(['fragile', 'unproven'].includes(result.demandQualityLevel));
  assert.notEqual(result.durability, 'durable');
});

test('falling sales trend reduces durability', () => {
  const result = demandQualityEngine.evaluateDemandQuality(buildInput({
    salesVelocityData: {
      salesVelocityScore: 34,
      soldLast7Days: 0,
      soldLast30Days: 0,
      soldLast90Days: 9,
      salesTrend: 'falling',
      demandStrength: 'moderate'
    },
    trendData: {
      direction: 'Downtrend',
      percentChange: -18
    },
    marketRegime: {
      primaryRegime: 'falling',
      regimes: ['falling', 'cooling']
    }
  }));

  assert.equal(result.dimensions.repeatSalesPattern.status, 'weakening');
  assert.equal(result.durability, 'fragile');
  assert.notEqual(result.demandQualityLevel, 'strong');
});

test('duplicate-heavy sales lower score and flag duplicate noise', () => {
  const clean = demandQualityEngine.evaluateDemandQuality(buildInput());
  const noisy = demandQualityEngine.evaluateDemandQuality(buildInput({
    salesVelocityData: {
      details: {
        duplicateSalesExcluded: 5
      }
    }
  }));

  assert.equal(noisy.dimensions.duplicateNoise.status, 'high');
  assert.ok(noisy.demandQualityScore < clean.demandQualityScore);
  assert.match(noisy.warnings.join(' '), /duplicate/i);
});

test('single-seller concentration reduces demand breadth', () => {
  const concentratedEvidence = buildSoldSales(6).map((sale) => ({
    ...sale,
    seller: 'same-seller',
    source: 'ebay',
    evidenceType: 'true_sold'
  }));

  const result = demandQualityEngine.evaluateDemandQuality(buildInput({
    evidenceSummary: {
      trueSoldCount: 6,
      normalizedEvidence: concentratedEvidence
    },
    root: {
      soldSales: concentratedEvidence
    }
  }));

  assert.equal(result.dimensions.buyerSellerBreadth.status, 'concentrated');
  assert.equal(result.breadth, 'narrow');
  assert.ok(result.demandQualityScore <= 62);
});

test('high price volatility lowers price participation quality', () => {
  const result = demandQualityEngine.evaluateDemandQuality(buildInput({
    evidenceSummary: {
      priceSpread: 1.1,
      volatility: 0.7
    },
    salesVelocityData: {
      details: {
        priceVolatility: 0.7
      }
    }
  }));

  assert.equal(result.dimensions.priceParticipation.status, 'noisy');
  assert.match(result.warnings.join(' '), /volatility|spread/);
});

test('stale markets are flagged when no recent sales exist', () => {
  const result = demandQualityEngine.evaluateDemandQuality(buildInput({
    salesVelocityData: {
      soldLast7Days: 0,
      soldLast30Days: 0,
      soldLast90Days: 6
    },
    marketRegime: {
      primaryRegime: 'stale',
      regimes: ['stale']
    },
    evidenceSummary: {
      normalizedEvidence: buildSoldSales(6).map((sale) => ({
        ...sale,
        evidenceType: 'true_sold',
        ageDays: 220
      }))
    }
  }));

  assert.equal(result.dimensions.staleDemandRisk.status, 'high');
  assert.equal(result.durability, 'fragile');
  assert.match(result.warnings.join(' '), /stale/i);
});

test('missing trend, velocity, and regime signals use unknown where data is missing', () => {
  const result = demandQualityEngine.evaluateDemandQuality({
    evidenceSummary: {
      trueSoldCount: 4,
      normalizedEvidence: [
        { evidenceType: 'true_sold', price: 90 },
        { evidenceType: 'true_sold', price: 95 },
        { evidenceType: 'true_sold', price: 100 },
        { evidenceType: 'true_sold', price: 105 }
      ]
    }
  });

  assert.equal(result.dimensions.repeatSalesPattern.status, 'unknown');
  assert.equal(result.dimensions.hypeDistortion.status, 'unknown');
  assert.equal(result.repeatability, 'unknown');
});

test('evaluateDemandQuality does not mutate inputs', () => {
  const input = buildInput();
  const before = JSON.stringify(input);

  demandQualityEngine.evaluateDemandQuality(input);

  assert.equal(JSON.stringify(input), before);
});
