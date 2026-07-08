'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const marketRegimeEngine = require('../engines/marketRegimeEngine');

function evaluate(overrides = {}) {
  return marketRegimeEngine.evaluateMarketRegime({
    trendData: {
      direction: 'Stable',
      trendScore: 55,
      percentChange: 1,
      velocityScore: 45,
      confidence: 70,
      ...(overrides.trendData || {})
    },
    salesVelocityData: {
      salesVelocityScore: 55,
      soldLast7Days: 1,
      soldLast30Days: 4,
      soldLast90Days: 12,
      salesTrend: 'stable',
      demandStrength: 'moderate',
      inventoryPressure: 'normal',
      confidence: 70,
      details: {
        priceVolatility: 0.12,
        seasonalSpike: false,
        earlyMarket: false,
        ...(overrides.salesVelocityData?.details || {})
      },
      ...(overrides.salesVelocityData || {})
    },
    evidenceSummary: {
      trueSoldCount: 6,
      activeCount: 3,
      priceSpread: 0.22,
      volatility: 0.12,
      activeOnlyFlag: false,
      fallbackOnlyFlag: false,
      normalizedEvidence: [
        { evidenceType: 'true_sold', price: 95, ageDays: 10 },
        { evidenceType: 'true_sold', price: 100, ageDays: 20 },
        { evidenceType: 'true_sold', price: 105, ageDays: 30 }
      ],
      ...(overrides.evidenceSummary || {})
    },
    evidenceSufficiency: {
      sufficiencyLevel: 'adequate',
      evidenceSufficiencyScore: 76,
      ...(overrides.evidenceSufficiency || {})
    },
    liquidityEvidence: {
      liquidityLevel: 'good',
      liquidityScore: 74,
      trueSoldCount: 6,
      activeCount: 3,
      ...(overrides.liquidityEvidence || {})
    },
    outlierAnalysis: {
      outlierRate: 0,
      extremeOutlierCount: 0,
      ...(overrides.outlierAnalysis || {})
    }
  });
}

test('empty input returns unknown market regime safely', () => {
  const result = marketRegimeEngine.evaluateMarketRegime();

  assert.equal(result.source, 'market_regime_engine');
  assert.equal(result.primaryRegime, 'unknown');
  assert.ok(result.regimes.includes('unknown'));
  assert.ok(result.confidence <= 35);
  assert.ok(result.summary);
});

test('stable trend and adequate evidence returns stable regime', () => {
  const result = evaluate();

  assert.equal(result.primaryRegime, 'stable');
  assert.deepEqual(result.secondaryRegimes, []);
  assert.equal(result.dimensions.priceDirection.status, 'stable');
  assert.equal(result.dimensions.salesMomentum.status, 'steady');
  assert.equal(result.dimensions.evidenceDepth.status, 'adequate');
});

test('rising trend with healthy activity returns rising regime', () => {
  const result = evaluate({
    trendData: {
      direction: 'Uptrend',
      trendScore: 74,
      percentChange: 14
    },
    salesVelocityData: {
      salesVelocityScore: 72,
      soldLast7Days: 2,
      soldLast30Days: 7,
      salesTrend: 'rising'
    }
  });

  assert.equal(result.primaryRegime, 'rising');
  assert.ok(result.regimes.includes('rising'));
  assert.equal(result.dimensions.priceDirection.status, 'rising');
  assert.equal(result.dimensions.salesMomentum.status, 'accelerating');
});

test('sharp rising volatile seasonal market returns overheated with multiple regimes', () => {
  const result = evaluate({
    trendData: {
      direction: 'Strong Uptrend',
      trendScore: 93,
      percentChange: 38
    },
    salesVelocityData: {
      salesVelocityScore: 86,
      soldLast7Days: 5,
      soldLast30Days: 14,
      salesTrend: 'rising',
      details: {
        seasonalSpike: true,
        priceVolatility: 0.64
      }
    },
    evidenceSummary: {
      priceSpread: 1.1,
      volatility: 0.62
    },
    outlierAnalysis: {
      outlierRate: 0.34
    }
  });

  assert.equal(result.primaryRegime, 'overheated');
  assert.ok(result.secondaryRegimes.includes('hype_driven'));
  assert.ok(result.secondaryRegimes.includes('volatile'));
  assert.equal(result.dimensions.hypeRisk.status, 'high');
  assert.equal(result.dimensions.volatilityState.status, 'high');
});

test('falling trend returns falling regime', () => {
  const result = evaluate({
    trendData: {
      direction: 'Downtrend',
      trendScore: 34,
      percentChange: -16
    },
    salesVelocityData: {
      salesTrend: 'falling',
      salesVelocityScore: 38,
      soldLast7Days: 0,
      soldLast30Days: 1,
      soldLast90Days: 8
    }
  });

  assert.equal(result.primaryRegime, 'falling');
  assert.ok(result.regimes.includes('falling'));
  assert.equal(result.dimensions.priceDirection.status, 'falling');
});

test('decelerating sales with stable price returns cooling regime', () => {
  const result = evaluate({
    salesVelocityData: {
      salesTrend: 'falling',
      salesVelocityScore: 36,
      soldLast7Days: 0,
      soldLast30Days: 0,
      soldLast90Days: 9
    }
  });

  assert.equal(result.primaryRegime, 'cooling');
  assert.ok(result.regimes.includes('cooling'));
  assert.equal(result.dimensions.salesMomentum.status, 'decelerating');
});

test('high price spread returns volatile regime', () => {
  const result = evaluate({
    evidenceSummary: {
      priceSpread: 1.25,
      volatility: 0.71
    }
  });

  assert.equal(result.primaryRegime, 'volatile');
  assert.equal(result.dimensions.volatilityState.status, 'high');
  assert.match(result.dimensions.volatilityState.explanation, /volatile market/);
});

test('low sold evidence and weak liquidity returns thin regime', () => {
  const result = evaluate({
    evidenceSummary: {
      trueSoldCount: 1,
      activeCount: 8,
      normalizedEvidence: [
        { evidenceType: 'true_sold', price: 100, ageDays: 22 }
      ]
    },
    evidenceSufficiency: {
      sufficiencyLevel: 'insufficient',
      evidenceSufficiencyScore: 32
    },
    liquidityEvidence: {
      liquidityLevel: 'thin',
      liquidityScore: 28,
      trueSoldCount: 1,
      activeCount: 8
    }
  });

  assert.equal(result.primaryRegime, 'thin');
  assert.ok(result.regimes.includes('thin'));
  assert.equal(result.dimensions.liquidityState.status, 'thin');
  assert.equal(result.dimensions.evidenceDepth.status, 'thin');
});

test('stale sold evidence and no recent velocity returns stale regime', () => {
  const result = evaluate({
    salesVelocityData: {
      salesVelocityScore: 20,
      soldLast7Days: 0,
      soldLast30Days: 0,
      soldLast90Days: 0,
      salesTrend: 'unknown'
    },
    evidenceSummary: {
      trueSoldCount: 3,
      normalizedEvidence: [
        { evidenceType: 'true_sold', price: 95, ageDays: 210 },
        { evidenceType: 'true_sold', price: 100, ageDays: 240 },
        { evidenceType: 'true_sold', price: 105, ageDays: 270 }
      ]
    }
  });

  assert.equal(result.primaryRegime, 'stale');
  assert.ok(result.regimes.includes('stale'));
  assert.equal(result.dimensions.staleRisk.status, 'high');
});

test('active-only evidence lowers confidence and returns unknown', () => {
  const result = evaluate({
    evidenceSummary: {
      trueSoldCount: 0,
      activeCount: 3,
      activeOnlyFlag: true,
      normalizedEvidence: [
        { evidenceType: 'active', price: 100, ageDays: 1 }
      ]
    },
    evidenceSufficiency: {
      sufficiencyLevel: 'unreliable',
      evidenceSufficiencyScore: 12
    },
    liquidityEvidence: {
      liquidityLevel: 'unknown',
      liquidityScore: 0,
      trueSoldCount: 0,
      activeCount: 3
    }
  });

  assert.equal(result.primaryRegime, 'unknown');
  assert.equal(result.dimensions.evidenceDepth.status, 'unreliable');
  assert.ok(result.confidence <= 28);
});

test('every regime dimension includes status, score, and explanation', () => {
  const result = evaluate();

  for (const dimension of Object.values(result.dimensions)) {
    assert.ok(Object.hasOwn(dimension, 'status'));
    assert.ok(Object.hasOwn(dimension, 'score'));
    assert.ok(Object.hasOwn(dimension, 'explanation'));
    assert.equal(typeof dimension.explanation, 'string');
  }
});

test('warnings remain local to market regime output', () => {
  const result = evaluate({
    evidenceSummary: {
      priceSpread: 1.4,
      volatility: 0.8
    }
  });

  assert.ok(result.warnings.length > 0);
  assert.match(result.warnings.join(' '), /volatilityState/);
});

test('engine does not mutate inputs', () => {
  const input = Object.freeze({
    trendData: Object.freeze({ direction: 'Stable', trendScore: 55, confidence: 70 }),
    salesVelocityData: Object.freeze({
      salesVelocityScore: 55,
      soldLast30Days: 4,
      details: Object.freeze({ seasonalSpike: false })
    }),
    evidenceSummary: Object.freeze({
      trueSoldCount: 3,
      activeCount: 2,
      normalizedEvidence: Object.freeze([
        Object.freeze({ evidenceType: 'true_sold', ageDays: 12 })
      ])
    }),
    evidenceSufficiency: Object.freeze({ sufficiencyLevel: 'adequate', evidenceSufficiencyScore: 75 })
  });
  const before = JSON.stringify(input);

  marketRegimeEngine.evaluateMarketRegime(input);

  assert.equal(JSON.stringify(input), before);
});

test('exports public market regime functions', () => {
  assert.equal(typeof marketRegimeEngine.evaluateMarketRegime, 'function');
  assert.equal(typeof marketRegimeEngine.classifyMarketRegime, 'function');
  assert.equal(typeof marketRegimeEngine.summarizeMarketRegime, 'function');
});
