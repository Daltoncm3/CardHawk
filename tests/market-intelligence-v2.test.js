'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const marketIntelligenceEngine = require('../engines/marketIntelligenceEngine');

function evaluate(input = {}) {
  return marketIntelligenceEngine.evaluateMarketIntelligence({
    marketData: {
      confidence: 80,
      marketValue: 100,
      source: 'sold_market',
      ...(input.marketData || {})
    },
    compData: {
      source: 'sold_market',
      confidence: 80,
      ...(input.compData || {})
    },
    qualityData: {
      confidence: 80,
      ...(input.qualityData || {})
    },
    roiData: {
      roi: 0.35,
      roiPercent: 35,
      ...(input.roiData || {})
    },
    ...input
  });
}

test('evidenceSummary classifies true sold, active, and fallback unknown evidence separately', () => {
  const result = evaluate({
    soldSales: [
      {
        title: 'Sold comp',
        soldPrice: 100,
        soldAt: '2026-07-01T00:00:00.000Z',
        source: 'completed_sales'
      }
    ],
    compData: {
      selectedComps: [
        {
          title: 'Active comp',
          price: 110,
          status: 'active',
          evidenceType: 'active'
        },
        {
          title: 'Unknown comp',
          price: 95
        }
      ]
    }
  });

  assert.equal(result.evidenceSummary.trueSoldCount, 1);
  assert.equal(result.evidenceSummary.activeCount, 1);
  assert.equal(result.evidenceSummary.fallbackUnknownCount, 1);
  assert.deepEqual(
    result.evidenceSummary.normalizedEvidence.map((item) => item.evidenceType),
    ['true_sold', 'active', 'fallback_unknown']
  );
});

test('sold valuation metrics use true sold evidence only', () => {
  const result = evaluate({
    soldSales: [
      { soldPrice: 80, soldAt: '2026-07-01T00:00:00.000Z', similarity: 90 },
      { soldPrice: 100, status: 'sold', ageDays: 20, similarity: 100 },
      { soldPrice: 120, dateSold: '2026-06-01T00:00:00.000Z', similarity: 80 }
    ],
    compData: {
      selectedComps: [
        { price: 300, status: 'active', evidenceType: 'active', similarity: 100 }
      ]
    }
  });

  assert.equal(result.evidenceSummary.trueSoldCount, 3);
  assert.equal(result.evidenceSummary.activeCount, 1);
  assert.equal(result.evidenceSummary.medianSold, 100);
  assert.ok(result.evidenceSummary.weightedSoldAverage > 80);
  assert.ok(result.evidenceSummary.weightedSoldAverage < 120);
  assert.equal(result.evidenceSummary.activeMedianAsk, 300);
});

test('active-only and fallback-only evidence flags are informational and explicit', () => {
  const activeOnly = evaluate({
    compData: {
      selectedComps: [
        { price: 50, status: 'active' },
        { price: 60, isActive: true }
      ]
    }
  });

  assert.equal(activeOnly.evidenceSummary.trueSoldCount, 0);
  assert.equal(activeOnly.evidenceSummary.activeCount, 2);
  assert.equal(activeOnly.evidenceSummary.activeOnlyFlag, true);
  assert.equal(activeOnly.evidenceSummary.fallbackOnlyFlag, false);
  assert.equal(activeOnly.evidenceSummary.activeMedianAsk, 55);

  const fallbackOnly = evaluate({
    compData: {
      selectedComps: [
        { price: 70 },
        { price: 90 }
      ]
    }
  });

  assert.equal(fallbackOnly.evidenceSummary.trueSoldCount, 0);
  assert.equal(fallbackOnly.evidenceSummary.activeCount, 0);
  assert.equal(fallbackOnly.evidenceSummary.fallbackUnknownCount, 2);
  assert.equal(fallbackOnly.evidenceSummary.activeOnlyFlag, false);
  assert.equal(fallbackOnly.evidenceSummary.fallbackOnlyFlag, true);
});

test('evidenceSummary does not change existing Market Intelligence scoring outputs', () => {
  const base = evaluate({
    compData: {
      compCount: 3,
      soldCompCount: 3,
      confidence: 80
    }
  });

  const withEvidenceSummaryInputs = evaluate({
    compData: {
      compCount: 3,
      soldCompCount: 3,
      confidence: 80,
      selectedComps: [
        { price: 120, status: 'active', evidenceType: 'active', similarity: 95 },
        { price: 90 }
      ]
    }
  });

  assert.equal(withEvidenceSummaryInputs.intelligenceScore, base.intelligenceScore);
  assert.equal(withEvidenceSummaryInputs.trustLevel, base.trustLevel);
  assert.equal(withEvidenceSummaryInputs.recommendation, base.recommendation);
  assert.deepEqual(withEvidenceSummaryInputs.componentScores, base.componentScores);
  assert.ok(withEvidenceSummaryInputs.evidenceSummary);
});

test('comparableQuality exists in Market Intelligence output and uses evidenceSummary comps', () => {
  const result = evaluate({
    soldSales: [
      {
        title: 'Sold comp',
        soldPrice: 100,
        soldAt: '2026-07-01T00:00:00.000Z',
        source: 'completed_sales',
        similarity: 95
      }
    ],
    compData: {
      selectedComps: [
        {
          title: 'Active comp',
          price: 110,
          status: 'active',
          evidenceType: 'active',
          similarity: 95
        },
        {
          title: 'Unknown comp',
          price: 90,
          similarity: 95
        }
      ]
    }
  });

  assert.ok(result.comparableQuality);
  assert.equal(result.comparableQuality.source, 'comparable_quality_engine');
  assert.equal(result.comparableQuality.comparableCount, result.evidenceSummary.normalizedEvidence.length);
  assert.equal(result.comparableQuality.scoredComparableCount, 3);
});

test('empty evidence returns safe comparableQuality output', () => {
  const result = evaluate({
    marketData: { confidence: 0, marketValue: 0 },
    compData: { confidence: 0 },
    qualityData: { confidence: 0 }
  });

  assert.equal(result.evidenceSummary.evidenceCount, 0);
  assert.equal(result.comparableQuality.comparableCount, 0);
  assert.equal(result.comparableQuality.scoredComparableCount, 0);
  assert.equal(result.comparableQuality.averageComparableQualityScore, 0);
  assert.deepEqual(result.comparableQuality.scoredComps, []);
  assert.ok(result.comparableQuality.summary);
});

test('comparableQuality keeps active comps capped and fallback unknown comps flagged', () => {
  const result = evaluate({
    compData: {
      selectedComps: [
        {
          title: 'Active comp',
          price: 100,
          status: 'active',
          similarity: 99
        },
        {
          title: 'Fallback comp',
          price: 100,
          similarity: 99
        }
      ]
    }
  });

  const activeComp = result.comparableQuality.scoredComps.find((comp) => comp.evidenceType === 'active');
  const fallbackComp = result.comparableQuality.scoredComps.find((comp) => comp.evidenceType === 'fallback_unknown');

  assert.ok(activeComp);
  assert.ok(activeComp.comparableQualityScore <= 62);
  assert.equal(activeComp.flags.activeOnly, true);

  assert.ok(fallbackComp);
  assert.ok(fallbackComp.comparableQualityScore <= 42);
  assert.equal(fallbackComp.flags.fallbackUnknown, true);
});

test('comparableQuality does not change existing decision-bearing Market Intelligence fields', () => {
  const base = evaluate({
    compData: {
      compCount: 3,
      soldCompCount: 3,
      confidence: 80
    }
  });

  const withComparableQuality = evaluate({
    compData: {
      compCount: 3,
      soldCompCount: 3,
      confidence: 80,
      selectedComps: [
        { price: 100, status: 'active', evidenceType: 'active', similarity: 95 },
        { price: 100, similarity: 95 }
      ]
    }
  });

  assert.equal(withComparableQuality.intelligenceScore, base.intelligenceScore);
  assert.equal(withComparableQuality.confidenceScore, base.confidenceScore);
  assert.equal(withComparableQuality.trustLevel, base.trustLevel);
  assert.equal(withComparableQuality.recommendation, base.recommendation);
  assert.deepEqual(withComparableQuality.componentScores, base.componentScores);
  assert.ok(withComparableQuality.comparableQuality);
});
