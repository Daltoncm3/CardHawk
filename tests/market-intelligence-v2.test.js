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

test('evidenceSufficiency exists in Market Intelligence output', () => {
  const result = evaluate({
    soldSales: [
      { soldPrice: 100, soldAt: '2026-07-01T00:00:00.000Z', similarity: 95 },
      { soldPrice: 105, soldAt: '2026-06-15T00:00:00.000Z', similarity: 94 },
      { soldPrice: 98, soldAt: '2026-06-01T00:00:00.000Z', similarity: 93 }
    ]
  });

  assert.ok(result.evidenceSufficiency);
  assert.equal(result.evidenceSufficiency.source, 'evidence_sufficiency_engine');
  assert.equal(result.evidenceSufficiency.checks.soldEvidence.trueSoldCount, result.evidenceSummary.trueSoldCount);
});

test('empty evidence returns safe evidenceSufficiency output', () => {
  const result = evaluate({
    marketData: { confidence: 0, marketValue: 0 },
    compData: { confidence: 0 },
    qualityData: { confidence: 0 }
  });

  assert.equal(result.evidenceSummary.evidenceCount, 0);
  assert.equal(result.evidenceSufficiency.sufficientForValuation, false);
  assert.equal(result.evidenceSufficiency.sufficiencyLevel, 'unreliable');
  assert.ok(result.evidenceSufficiency.evidenceSufficiencyScore <= 20);
});

test('active-only evidenceSufficiency is insufficient or unreliable', () => {
  const result = evaluate({
    compData: {
      selectedComps: [
        { price: 100, status: 'active', similarity: 98 },
        { price: 110, isActive: true, similarity: 97 }
      ]
    }
  });

  assert.equal(result.evidenceSummary.activeOnlyFlag, true);
  assert.equal(result.evidenceSufficiency.sufficientForValuation, false);
  assert.ok(['insufficient', 'unreliable'].includes(result.evidenceSufficiency.sufficiencyLevel));
  assert.equal(result.evidenceSufficiency.checks.fallbackRisk.activeOnlyFlag, true);
});

test('fallback-only evidenceSufficiency is flagged', () => {
  const result = evaluate({
    compData: {
      selectedComps: [
        { price: 90, similarity: 96 },
        { price: 100, similarity: 96 }
      ]
    }
  });

  assert.equal(result.evidenceSummary.fallbackOnlyFlag, true);
  assert.equal(result.evidenceSufficiency.sufficientForValuation, false);
  assert.equal(result.evidenceSufficiency.checks.fallbackRisk.fallbackOnlyFlag, true);
  assert.match(result.evidenceSufficiency.blockingConcerns.join(' '), /fallback-only/i);
});

test('strong evidence returns adequate or strong evidenceSufficiency', () => {
  const result = evaluate({
    soldSales: [
      { soldPrice: 92, soldAt: '2026-07-01T00:00:00.000Z', similarity: 96 },
      { soldPrice: 98, soldAt: '2026-06-25T00:00:00.000Z', similarity: 95 },
      { soldPrice: 100, soldAt: '2026-06-18T00:00:00.000Z', similarity: 95 },
      { soldPrice: 104, soldAt: '2026-06-10T00:00:00.000Z', similarity: 94 },
      { soldPrice: 110, soldAt: '2026-06-01T00:00:00.000Z', similarity: 94 }
    ]
  });

  assert.equal(result.evidenceSufficiency.sufficientForValuation, true);
  assert.ok(['adequate', 'strong'].includes(result.evidenceSufficiency.sufficiencyLevel));
  assert.ok(result.evidenceSufficiency.evidenceSufficiencyScore >= 68);
});

test('evidenceSufficiency does not change existing decision-bearing Market Intelligence fields', () => {
  const base = evaluate({
    compData: {
      compCount: 3,
      soldCompCount: 3,
      confidence: 80
    }
  });

  const withEvidenceSufficiency = evaluate({
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

  assert.equal(withEvidenceSufficiency.intelligenceScore, base.intelligenceScore);
  assert.equal(withEvidenceSufficiency.confidenceScore, base.confidenceScore);
  assert.equal(withEvidenceSufficiency.trustLevel, base.trustLevel);
  assert.equal(withEvidenceSufficiency.recommendation, base.recommendation);
  assert.deepEqual(withEvidenceSufficiency.componentScores, base.componentScores);
  assert.deepEqual(withEvidenceSufficiency.warnings, base.warnings);
  assert.deepEqual(withEvidenceSufficiency.positives, base.positives);
  assert.deepEqual(withEvidenceSufficiency.reasons, base.reasons);
  assert.ok(withEvidenceSufficiency.evidenceSufficiency);
});

test('valuationRange exists in Market Intelligence output', () => {
  const result = evaluate({
    soldSales: [
      { soldPrice: 92, soldAt: '2026-07-01T00:00:00.000Z', similarity: 96 },
      { soldPrice: 98, soldAt: '2026-06-25T00:00:00.000Z', similarity: 95 },
      { soldPrice: 100, soldAt: '2026-06-18T00:00:00.000Z', similarity: 95 },
      { soldPrice: 104, soldAt: '2026-06-10T00:00:00.000Z', similarity: 94 },
      { soldPrice: 110, soldAt: '2026-06-01T00:00:00.000Z', similarity: 94 }
    ]
  });

  assert.ok(result.valuationRange);
  assert.equal(result.valuationRange.source, 'valuation_range_engine');
  assert.equal(result.valuationRange.basis.trueSoldCount, result.evidenceSummary.trueSoldCount);
  assert.ok(result.valuationRange.expectedValue > 0);
});

test('valuationRange does not change existing decision-bearing Market Intelligence fields', () => {
  const base = evaluate({
    compData: {
      compCount: 3,
      soldCompCount: 3,
      confidence: 80
    }
  });

  const withValuationRange = evaluate({
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

  assert.equal(withValuationRange.intelligenceScore, base.intelligenceScore);
  assert.equal(withValuationRange.confidenceScore, base.confidenceScore);
  assert.equal(withValuationRange.trustLevel, base.trustLevel);
  assert.equal(withValuationRange.recommendation, base.recommendation);
  assert.deepEqual(withValuationRange.componentScores, base.componentScores);
  assert.deepEqual(withValuationRange.warnings, base.warnings);
  assert.deepEqual(withValuationRange.positives, base.positives);
  assert.deepEqual(withValuationRange.reasons, base.reasons);
  assert.equal(withValuationRange.marketDepth, base.marketDepth);
  assert.equal(withValuationRange.referenceMarketValue, base.referenceMarketValue);
  assert.equal(withValuationRange.estimatedValue, base.estimatedValue);
  assert.ok(withValuationRange.valuationRange);
});

test('demandQuality exists in Market Intelligence output', () => {
  const result = evaluate({
    soldSales: [
      { soldPrice: 92, soldAt: '2026-07-01T00:00:00.000Z', similarity: 96, seller: 'seller-a', source: 'ebay' },
      { soldPrice: 98, soldAt: '2026-06-25T00:00:00.000Z', similarity: 95, seller: 'seller-b', source: 'ebay' },
      { soldPrice: 100, soldAt: '2026-06-18T00:00:00.000Z', similarity: 95, seller: 'seller-c', source: 'ebay' },
      { soldPrice: 104, soldAt: '2026-06-10T00:00:00.000Z', similarity: 94, seller: 'seller-d', source: 'alt' },
      { soldPrice: 110, soldAt: '2026-06-01T00:00:00.000Z', similarity: 94, seller: 'seller-e', source: 'alt' }
    ],
    salesVelocityData: {
      salesVelocityScore: 74,
      soldLast7Days: 1,
      soldLast30Days: 5,
      soldLast90Days: 12,
      salesTrend: 'stable',
      demandStrength: 'strong',
      details: {
        priceVolatility: 0.12,
        seasonalSpike: false,
        earlyMarket: false,
        duplicateSalesExcluded: 0,
        soldCount: 5
      }
    },
    trendData: {
      direction: 'Stable',
      percentChange: 2,
      trendScore: 58
    }
  });

  assert.ok(result.demandQuality);
  assert.equal(result.demandQuality.source, 'demand_quality_engine');
  assert.equal(result.demandQuality.dimensions.soldDepth.status, 'adequate');
  assert.ok(result.demandQuality.summary);
});

test('demandQuality does not change existing decision-bearing Market Intelligence fields', () => {
  const sharedLegacyInputs = {
    salesVelocityData: {
      salesVelocityScore: 70,
      soldLast7Days: 1,
      soldLast30Days: 4,
      soldLast90Days: 9,
      salesTrend: 'stable',
      demandStrength: 'moderate',
      details: {
        duplicateSalesExcluded: 0,
        priceVolatility: 0.12
      }
    },
    trendData: {
      direction: 'Stable',
      percentChange: 1
    }
  };
  const base = evaluate({
    compData: {
      compCount: 3,
      soldCompCount: 3,
      confidence: 80
    },
    ...sharedLegacyInputs
  });

  const withDemandQuality = evaluate({
    compData: {
      compCount: 3,
      soldCompCount: 3,
      confidence: 80,
      selectedComps: [
        { price: 100, status: 'active', evidenceType: 'active', similarity: 95 },
        { price: 100, similarity: 95 }
      ]
    },
    ...sharedLegacyInputs
  });

  assert.equal(withDemandQuality.intelligenceScore, base.intelligenceScore);
  assert.equal(withDemandQuality.confidenceScore, base.confidenceScore);
  assert.equal(withDemandQuality.trustLevel, base.trustLevel);
  assert.equal(withDemandQuality.recommendation, base.recommendation);
  assert.deepEqual(withDemandQuality.componentScores, base.componentScores);
  assert.deepEqual(withDemandQuality.warnings, base.warnings);
  assert.deepEqual(withDemandQuality.positives, base.positives);
  assert.deepEqual(withDemandQuality.reasons, base.reasons);
  assert.equal(withDemandQuality.marketDepth, base.marketDepth);
  assert.equal(withDemandQuality.referenceMarketValue, base.referenceMarketValue);
  assert.equal(withDemandQuality.estimatedValue, base.estimatedValue);
  assert.ok(withDemandQuality.demandQuality);
});

test('supplyPressure exists in Market Intelligence output', () => {
  const result = evaluate({
    soldSales: [
      { soldPrice: 92, soldAt: '2026-07-01T00:00:00.000Z', similarity: 96 },
      { soldPrice: 98, soldAt: '2026-06-25T00:00:00.000Z', similarity: 95 },
      { soldPrice: 100, soldAt: '2026-06-18T00:00:00.000Z', similarity: 95 }
    ],
    marketData: {
      activeComps: [
        { price: 110, status: 'active', evidenceType: 'active', seller: 'seller-a', ageDays: 6 },
        { price: 115, status: 'active', evidenceType: 'active', seller: 'seller-b', ageDays: 8 }
      ]
    },
    salesVelocityData: {
      soldLast30Days: 3,
      inventoryPressure: 'normal',
      details: {
        activeInventoryKnown: true,
        activeInventoryQualityKnown: true
      }
    },
    liquidityEvidence: {
      soldCount: 3,
      activeCount: 2,
      sellThroughRate: 0.6
    }
  });

  assert.ok(result.supplyPressure);
  assert.equal(result.supplyPressure.source, 'supply_pressure_engine');
  assert.equal(result.supplyPressure.trueSoldCount, result.evidenceSummary.trueSoldCount);
  assert.ok(result.supplyPressure.summary);
});

test('supplyPressure does not change existing decision-bearing Market Intelligence fields', () => {
  const sharedLegacyInputs = {
    salesVelocityData: {
      soldLast30Days: 4,
      inventoryPressure: 'normal',
      details: {
        activeInventoryKnown: true,
        activeInventoryQualityKnown: true
      }
    },
    liquidityEvidence: {
      soldCount: 3,
      activeCount: 2,
      sellThroughRate: 0.6
    }
  };
  const base = evaluate({
    compData: {
      compCount: 3,
      soldCompCount: 3,
      confidence: 80
    },
    ...sharedLegacyInputs
  });

  const withSupplyPressure = evaluate({
    compData: {
      compCount: 3,
      soldCompCount: 3,
      confidence: 80,
      selectedComps: [
        { price: 100, status: 'active', evidenceType: 'active', similarity: 95 },
        { price: 100, similarity: 95 }
      ]
    },
    ...sharedLegacyInputs
  });

  assert.equal(withSupplyPressure.intelligenceScore, base.intelligenceScore);
  assert.equal(withSupplyPressure.confidenceScore, base.confidenceScore);
  assert.equal(withSupplyPressure.trustLevel, base.trustLevel);
  assert.equal(withSupplyPressure.recommendation, base.recommendation);
  assert.deepEqual(withSupplyPressure.componentScores, base.componentScores);
  assert.deepEqual(withSupplyPressure.warnings, base.warnings);
  assert.deepEqual(withSupplyPressure.positives, base.positives);
  assert.deepEqual(withSupplyPressure.reasons, base.reasons);
  assert.equal(withSupplyPressure.marketDepth, base.marketDepth);
  assert.equal(withSupplyPressure.referenceMarketValue, base.referenceMarketValue);
  assert.equal(withSupplyPressure.estimatedValue, base.estimatedValue);
  assert.ok(withSupplyPressure.supplyPressure);
});

test('marketRegime exists in Market Intelligence output', () => {
  const result = evaluate({
    soldSales: [
      { soldPrice: 92, soldAt: '2026-07-01T00:00:00.000Z', similarity: 94 },
      { soldPrice: 100, soldAt: '2026-07-03T00:00:00.000Z', similarity: 96 },
      { soldPrice: 108, soldAt: '2026-07-05T00:00:00.000Z', similarity: 98 }
    ],
    trendData: {
      direction: 'up',
      percentChange: 12,
      confidence: 80
    },
    salesVelocityData: {
      soldLast7Days: 2,
      soldLast30Days: 6,
      soldLast90Days: 10,
      salesTrend: 'rising',
      confidence: 78,
      inventoryPressure: 'low'
    },
    liquidityEvidence: {
      liquidityLevel: 'good',
      liquidityScore: 76,
      soldCount: 3,
      activeCount: 2
    }
  });

  assert.ok(result.marketRegime);
  assert.equal(result.marketRegime.source, 'market_regime_engine');
  assert.ok(result.marketRegime.primaryRegime);
  assert.ok(result.marketRegime.summary);
  assert.ok(result.marketRegime.dimensions);
});

test('marketRegime does not change existing decision-bearing Market Intelligence fields', () => {
  const sharedIntelligenceInputs = {
    trendData: {
      direction: 'up',
      percentChange: 12,
      confidence: 80
    },
    salesVelocityData: {
      soldLast7Days: 2,
      soldLast30Days: 6,
      soldLast90Days: 10,
      salesTrend: 'rising',
      confidence: 78,
      inventoryPressure: 'low'
    },
    liquidityEvidence: {
      liquidityLevel: 'good',
      liquidityScore: 76,
      soldCount: 3,
      activeCount: 2
    }
  };
  const base = evaluate({
    compData: {
      compCount: 3,
      soldCompCount: 3,
      confidence: 80
    },
    ...sharedIntelligenceInputs
  });

  const withMarketRegime = evaluate({
    compData: {
      compCount: 3,
      soldCompCount: 3,
      confidence: 80,
      selectedComps: [
        { price: 100, status: 'active', evidenceType: 'active', similarity: 95 },
        { price: 100, similarity: 95 }
      ]
    },
    ...sharedIntelligenceInputs
  });

  assert.equal(withMarketRegime.intelligenceScore, base.intelligenceScore);
  assert.equal(withMarketRegime.confidenceScore, base.confidenceScore);
  assert.equal(withMarketRegime.trustLevel, base.trustLevel);
  assert.equal(withMarketRegime.recommendation, base.recommendation);
  assert.deepEqual(withMarketRegime.componentScores, base.componentScores);
  assert.deepEqual(withMarketRegime.warnings, base.warnings);
  assert.deepEqual(withMarketRegime.positives, base.positives);
  assert.deepEqual(withMarketRegime.reasons, base.reasons);
  assert.equal(withMarketRegime.marketDepth, base.marketDepth);
  assert.equal(withMarketRegime.referenceMarketValue, base.referenceMarketValue);
  assert.equal(withMarketRegime.estimatedValue, base.estimatedValue);
  assert.ok(withMarketRegime.marketRegime);
});
