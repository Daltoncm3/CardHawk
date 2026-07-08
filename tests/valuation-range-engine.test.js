'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const valuationRangeEngine = require('../engines/valuationRangeEngine');

function buildInput(overrides = {}) {
  return {
    evidenceSummary: {
      trueSoldCount: 5,
      activeCount: 2,
      medianSold: 100,
      weightedSoldAverage: 102,
      activeMedianAsk: 118,
      priceSpread: 0.22,
      volatility: 0.08,
      evidenceQualityScore: 86,
      activeOnlyFlag: false,
      fallbackOnlyFlag: false,
      normalizedEvidence: [
        { evidenceType: 'true_sold', price: 92, ageDays: 10, similarity: 94 },
        { evidenceType: 'true_sold', price: 98, ageDays: 20, similarity: 95 },
        { evidenceType: 'true_sold', price: 100, ageDays: 30, similarity: 96 },
        { evidenceType: 'true_sold', price: 104, ageDays: 40, similarity: 94 },
        { evidenceType: 'true_sold', price: 110, ageDays: 50, similarity: 93 },
        { evidenceType: 'active', price: 118, ageDays: 3, similarity: 92 }
      ],
      ...(overrides.evidenceSummary || {})
    },
    comparableQuality: {
      averageComparableQualityScore: 84,
      qualityDistribution: { excellent: 3, good: 2, usable: 0, weak: 0, reject: 0 },
      ...(overrides.comparableQuality || {})
    },
    evidenceSufficiency: {
      sufficiencyLevel: 'adequate',
      evidenceSufficiencyScore: 78,
      ...(overrides.evidenceSufficiency || {})
    },
    listingSimilarity: {
      averageSimilarityScore: 91,
      ...(overrides.listingSimilarity || {})
    },
    outlierAnalysis: {
      outlierRate: 0,
      extremeOutlierCount: 0,
      ...(overrides.outlierAnalysis || {})
    },
    marketRegime: {
      primaryRegime: 'stable',
      ...(overrides.marketRegime || {})
    },
    liquidityEvidence: {
      liquidityLevel: 'good',
      liquidityScore: 74,
      ...(overrides.liquidityEvidence || {})
    },
    marketData: {
      marketValue: 101,
      ...(overrides.marketData || {})
    },
    compData: {
      ...(overrides.compData || {})
    }
  };
}

test('empty evidence returns zero unreliable valuation range', () => {
  const result = valuationRangeEngine.evaluateValuationRange();

  assert.equal(result.source, 'valuation_range_engine');
  assert.equal(result.floorValue, 0);
  assert.equal(result.expectedValue, 0);
  assert.equal(result.ceilingValue, 0);
  assert.equal(result.rangeQuality, 'unreliable');
  assert.match(result.scenarios.conservativeExit.explanation, /No reliable true sold support/);
  assert.match(result.scenarios.normalExit.explanation, /requires true sold evidence/);
  assert.match(result.scenarios.optimisticExit.explanation, /cannot support upside/);
});

test('tight sold comps produce ordered usable valuation range', () => {
  const result = valuationRangeEngine.evaluateValuationRange(buildInput());

  assert.ok(result.floorValue > 0);
  assert.ok(result.floorValue <= result.expectedValue);
  assert.ok(result.expectedValue <= result.ceilingValue);
  assert.ok(['usable', 'strong'].includes(result.rangeQuality));
  assert.ok(result.confidence >= 60);
});

test('every valuation scenario includes an explanation', () => {
  const result = valuationRangeEngine.evaluateValuationRange(buildInput());

  assert.equal(typeof result.scenarios.conservativeExit.explanation, 'string');
  assert.equal(typeof result.scenarios.normalExit.explanation, 'string');
  assert.equal(typeof result.scenarios.optimisticExit.explanation, 'string');
  assert.ok(result.scenarios.conservativeExit.explanation.length > 0);
  assert.ok(result.scenarios.normalExit.explanation.length > 0);
  assert.ok(result.scenarios.optimisticExit.explanation.length > 0);
});

test('volatile sold comps widen the valuation range and warn', () => {
  const stable = valuationRangeEngine.evaluateValuationRange(buildInput());
  const volatile = valuationRangeEngine.evaluateValuationRange(buildInput({
    evidenceSummary: {
      medianSold: 100,
      weightedSoldAverage: 106,
      priceSpread: 1.35,
      volatility: 0.72,
      normalizedEvidence: [
        { evidenceType: 'true_sold', price: 40, ageDays: 10 },
        { evidenceType: 'true_sold', price: 80, ageDays: 20 },
        { evidenceType: 'true_sold', price: 100, ageDays: 30 },
        { evidenceType: 'true_sold', price: 150, ageDays: 40 },
        { evidenceType: 'true_sold', price: 180, ageDays: 50 }
      ]
    }
  }));

  assert.ok((volatile.ceilingValue - volatile.floorValue) > (stable.ceilingValue - stable.floorValue));
  assert.match(volatile.warnings.join(' '), /Wide sold-price spread/);
  assert.match(volatile.warnings.join(' '), /volatility/);
});

test('outlier pressure lowers confidence and caps ceiling', () => {
  const normal = valuationRangeEngine.evaluateValuationRange(buildInput());
  const outlier = valuationRangeEngine.evaluateValuationRange(buildInput({
    outlierAnalysis: {
      outlierRate: 0.42,
      extremeOutlierCount: 1
    }
  }));

  assert.ok(outlier.confidence < normal.confidence);
  assert.ok(outlier.ceilingValue <= outlier.expectedValue * 1.15 + 0.01);
  assert.equal(outlier.adjustments.outlierAdjustment, -0.08);
});

test('active-only evidence cannot create a valuation range', () => {
  const result = valuationRangeEngine.evaluateValuationRange(buildInput({
    evidenceSummary: {
      trueSoldCount: 0,
      activeCount: 3,
      medianSold: 0,
      weightedSoldAverage: 0,
      activeMedianAsk: 125,
      activeOnlyFlag: true,
      normalizedEvidence: [
        { evidenceType: 'active', price: 120 },
        { evidenceType: 'active', price: 125 },
        { evidenceType: 'active', price: 130 }
      ]
    },
    evidenceSufficiency: {
      sufficiencyLevel: 'unreliable',
      evidenceSufficiencyScore: 12
    }
  }));

  assert.equal(result.floorValue, 0);
  assert.equal(result.expectedValue, 0);
  assert.equal(result.ceilingValue, 0);
  assert.equal(result.rangeQuality, 'unreliable');
});

test('fallback-only evidence returns unreliable valuation range', () => {
  const result = valuationRangeEngine.evaluateValuationRange(buildInput({
    evidenceSummary: {
      trueSoldCount: 0,
      activeCount: 0,
      fallbackUnknownCount: 2,
      medianSold: 0,
      weightedSoldAverage: 0,
      fallbackOnlyFlag: true,
      normalizedEvidence: [
        { evidenceType: 'fallback_unknown', price: 100 },
        { evidenceType: 'fallback_unknown', price: 120 }
      ]
    }
  }));

  assert.equal(result.rangeQuality, 'unreliable');
  assert.equal(result.expectedValue, 0);
  assert.match(result.summary, /unreliable/);
});

test('low comparable quality reduces confidence', () => {
  const strong = valuationRangeEngine.evaluateValuationRange(buildInput());
  const weak = valuationRangeEngine.evaluateValuationRange(buildInput({
    comparableQuality: {
      averageComparableQualityScore: 36,
      qualityDistribution: { excellent: 0, good: 0, usable: 1, weak: 3, reject: 1 }
    }
  }));

  assert.ok(weak.confidence < strong.confidence);
  assert.ok(weak.rangeQuality !== 'strong');
});

test('thin market produces conservative range quality', () => {
  const result = valuationRangeEngine.evaluateValuationRange(buildInput({
    evidenceSummary: {
      trueSoldCount: 2,
      medianSold: 100,
      weightedSoldAverage: 101,
      normalizedEvidence: [
        { evidenceType: 'true_sold', price: 96, ageDays: 12 },
        { evidenceType: 'true_sold', price: 104, ageDays: 30 }
      ]
    },
    evidenceSufficiency: {
      sufficiencyLevel: 'insufficient',
      evidenceSufficiencyScore: 38
    },
    liquidityEvidence: {
      liquidityLevel: 'thin'
    }
  }));

  assert.equal(result.rangeQuality, 'thin');
  assert.ok(result.confidence <= 44);
  assert.match(result.warnings.join(' '), /fewer than 3/);
});

test('overheated regime limits optimistic ceiling', () => {
  const result = valuationRangeEngine.evaluateValuationRange(buildInput({
    marketRegime: {
      primaryRegime: 'overheated'
    },
    evidenceSummary: {
      priceSpread: 0.8,
      volatility: 0.4
    }
  }));

  assert.ok(result.ceilingValue <= result.expectedValue * 1.18 + 0.01);
  assert.equal(result.adjustments.regimeAdjustment, -0.04);
});

test('range values stay ordered across stressed inputs', () => {
  const result = valuationRangeEngine.evaluateValuationRange(buildInput({
    evidenceSummary: {
      trueSoldCount: 3,
      medianSold: 120,
      weightedSoldAverage: 90,
      priceSpread: 2,
      volatility: 1.1,
      normalizedEvidence: [
        { evidenceType: 'true_sold', price: 30 },
        { evidenceType: 'true_sold', price: 120 },
        { evidenceType: 'true_sold', price: 240 }
      ]
    },
    marketRegime: {
      primaryRegime: 'hype_driven'
    },
    outlierAnalysis: {
      outlierRate: 0.5,
      extremeOutlierCount: 1
    }
  }));

  assert.ok(result.floorValue <= result.expectedValue);
  assert.ok(result.expectedValue <= result.ceilingValue);
});

test('engine does not mutate inputs', () => {
  const input = Object.freeze({
    evidenceSummary: Object.freeze({
      trueSoldCount: 3,
      medianSold: 100,
      weightedSoldAverage: 102,
      normalizedEvidence: Object.freeze([
        Object.freeze({ evidenceType: 'true_sold', price: 98 }),
        Object.freeze({ evidenceType: 'true_sold', price: 100 }),
        Object.freeze({ evidenceType: 'true_sold', price: 104 })
      ])
    }),
    comparableQuality: Object.freeze({ averageComparableQualityScore: 82 }),
    evidenceSufficiency: Object.freeze({ sufficiencyLevel: 'adequate', evidenceSufficiencyScore: 76 })
  });
  const before = JSON.stringify(input);

  valuationRangeEngine.evaluateValuationRange(input);

  assert.equal(JSON.stringify(input), before);
});

test('exports public valuation range functions', () => {
  assert.equal(typeof valuationRangeEngine.evaluateValuationRange, 'function');
  assert.equal(typeof valuationRangeEngine.calculateValuationRange, 'function');
  assert.equal(typeof valuationRangeEngine.summarizeValuationRange, 'function');
});
