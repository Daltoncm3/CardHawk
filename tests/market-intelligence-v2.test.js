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
