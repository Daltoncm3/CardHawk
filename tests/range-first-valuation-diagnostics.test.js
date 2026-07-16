'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  UNCERTAINTY_LEVEL,
  VALUATION_DIAGNOSTIC_STATUS,
  buildRangeFirstValuationFingerprint,
  evaluateRangeFirstValuation,
  summarizeRangeFirstValuation
} = require('../validation/rangeFirstValuationDiagnostics');
const {
  evaluateEvidenceReadiness
} = require('../validation/evidenceReadinessDiagnostics');
const {
  createProductionIntelligenceTrace
} = require('../validation/productionIntelligenceTrace');

function soldRecord(id, overrides = {}) {
  return {
    id,
    evidenceType: 'true_sold',
    status: 'active_evidence',
    source: 'manual_verified',
    soldPrice: 100,
    soldAt: '2026-06-01T00:00:00.000Z',
    ageDays: 30,
    exactComparable: true,
    similarity: 95,
    qualityBand: 'excellent',
    ...overrides
  };
}

function supportedInput(overrides = {}) {
  const evidenceRecords = [
    soldRecord('sale-1', { soldPrice: 96, source: 'manual_a' }),
    soldRecord('sale-2', { soldPrice: 100, source: 'manual_b' }),
    soldRecord('sale-3', { soldPrice: 104, source: 'manual_c' })
  ];

  return {
    marketData: {
      source: 'sold_market',
      method: 'weightedSoldComps',
      marketValue: 100,
      expectedValueLow: 92,
      expectedValue: 100,
      expectedValueHigh: 108,
      confidence: 82
    },
    valuationRange: {
      floorValue: 92,
      expectedValue: 100,
      ceilingValue: 108,
      confidence: 82,
      rangeQuality: 'usable',
      basis: {
        trueSoldCount: 3,
        priceSpread: 0.16,
        volatility: 0.05
      }
    },
    evidenceRecords,
    identityDiagnosticResult: {
      identityEligibility: {
        valuationEligible: true,
        exactCompEligible: true
      },
      diagnosticStatus: 'exact'
    },
    comparableQuality: {
      averageComparableQualityScore: 88,
      scoredComparableCount: 3,
      warnings: []
    },
    ...overrides
  };
}

test('range-first valuation diagnostics classify supported point estimates inside a narrow range', () => {
  const result = evaluateRangeFirstValuation(supportedInput());

  assert.equal(result.valuationDiagnosticStatus, VALUATION_DIAGNOSTIC_STATUS.SUPPORTED);
  assert.equal(result.uncertaintyLevel, UNCERTAINTY_LEVEL.LOW);
  assert.equal(result.pointEstimateAssessment.pointEstimate, 100);
  assert.equal(result.pointEstimateAssessment.pointInsideSupportedRange, true);
  assert.equal(result.rangeAssessment.lowerBound, 92);
  assert.equal(result.rangeAssessment.midpoint, 100);
  assert.equal(result.rangeAssessment.upperBound, 108);
  assert.equal(result.supportingEvidenceSummary.trueSoldDepth, 3);
  assert.equal(result.valuationWithheldRecommendation.shouldWithholdValuationDiagnostically, false);
  assert.equal(result.confidenceCapRecommendation.recommendedCap, 100);
  assert.equal(result.stableFingerprint, buildRangeFirstValuationFingerprint(result));
  assert.match(summarizeRangeFirstValuation(result), /supported/);
});

test('wide supported ranges remain supported but receive high uncertainty', () => {
  const result = evaluateRangeFirstValuation(supportedInput({
    valuationRange: {
      floorValue: 60,
      expectedValue: 100,
      ceilingValue: 140,
      confidence: 65,
      rangeQuality: 'usable',
      warnings: ['Wide sold-price spread increases range uncertainty.']
    }
  }));

  assert.equal(result.valuationDiagnosticStatus, VALUATION_DIAGNOSTIC_STATUS.SUPPORTED_WITH_WIDE_RANGE);
  assert.equal(result.uncertaintyLevel, UNCERTAINTY_LEVEL.HIGH);
  assert.equal(result.rangeAssessment.spreadPercentage, 0.8);
  assert.equal(result.warnings.includes('valuation_uncertainty_high'), true);
  assert.equal(result.confidenceCapRecommendation.recommendedCap, 65);
});

test('point estimates outside the supported range are conditionally supported', () => {
  const result = evaluateRangeFirstValuation(supportedInput({
    marketData: {
      source: 'sold_market',
      method: 'weightedSoldComps',
      marketValue: 125,
      confidence: 78
    },
    valuationRange: {
      floorValue: 90,
      expectedValue: 100,
      ceilingValue: 110,
      confidence: 78,
      rangeQuality: 'usable'
    }
  }));

  assert.equal(result.valuationDiagnosticStatus, VALUATION_DIAGNOSTIC_STATUS.CONDITIONALLY_SUPPORTED);
  assert.equal(result.pointEstimateAssessment.pointInsideSupportedRange, false);
  assert.equal(result.pointEstimateAssessment.position, 'above_range');
  assert.equal(result.warnings.includes('point_estimate_outside_supported_range'), true);
  assert.equal(result.valuationWithheldRecommendation.shouldWithholdValuationDiagnostically, false);
});

test('thin true sold support is weakly supported and withheld diagnostically', () => {
  const result = evaluateRangeFirstValuation(supportedInput({
    evidenceRecords: [
      soldRecord('sale-1', { soldPrice: 99 }),
      soldRecord('sale-2', { soldPrice: 101 })
    ],
    valuationRange: {
      floorValue: 90,
      expectedValue: 100,
      ceilingValue: 112,
      confidence: 44,
      rangeQuality: 'thin'
    }
  }));

  assert.equal(result.valuationDiagnosticStatus, VALUATION_DIAGNOSTIC_STATUS.WEAKLY_SUPPORTED);
  assert.equal(result.supportingEvidenceSummary.trueSoldDepth, 2);
  assert.equal(result.blockingReasons.includes('evidence_readiness_recommends_withholding'), true);
  assert.equal(result.valuationWithheldRecommendation.shouldWithholdValuationDiagnostically, true);
  assert.equal(result.confidenceCapRecommendation.recommendedCap, 44);
});

test('active and fallback evidence never satisfy range-first true-sold support', () => {
  const result = evaluateRangeFirstValuation({
    marketData: {
      source: 'insufficient_evidence',
      method: 'activeOnlyNoSoldEvidence',
      marketValue: 0,
      confidence: 18
    },
    valuationRange: {
      floorValue: 0,
      expectedValue: 0,
      ceilingValue: 0,
      rangeQuality: 'unreliable'
    },
    evidenceRecords: [
      { id: 'active-1', evidenceType: 'active', source: 'active_market', price: 150, active: true, similarity: 95 },
      { id: 'fallback-1', evidenceType: 'fallback_unknown', source: 'heuristic_fallback', price: 140, similarity: 95 }
    ],
    identityDiagnosticResult: {
      identityEligibility: {
        valuationEligible: true,
        exactCompEligible: true
      }
    }
  });

  assert.equal(result.valuationDiagnosticStatus, VALUATION_DIAGNOSTIC_STATUS.WITHHELD);
  assert.equal(result.supportingEvidenceSummary.trueSoldDepth, 0);
  assert.equal(result.excludedEvidenceSummary.activeListingCount, 1);
  assert.equal(result.excludedEvidenceSummary.fallbackEvidenceCount, 1);
  assert.equal(result.blockingReasons.includes('active_listing_context_cannot_support_point_valuation'), true);
  assert.equal(result.blockingReasons.includes('fallback_evidence_cannot_support_point_valuation'), true);
  assert.equal(result.valuationWithheldRecommendation.shouldWithholdValuationDiagnostically, true);
});

test('supplied evidence summaries can report true-sold depth without immutable records', () => {
  const result = evaluateRangeFirstValuation({
    marketData: {
      source: 'sold_market',
      method: 'weightedSoldComps',
      marketValue: 100,
      confidence: 78
    },
    valuationRange: {
      floorValue: 90,
      expectedValue: 100,
      ceilingValue: 110,
      confidence: 78,
      rangeQuality: 'usable',
      basis: {
        trueSoldCount: 3
      }
    },
    evidenceSummary: {
      trueSoldCount: 3,
      activeCount: 2,
      activeOnlyFlag: false,
      fallbackOnlyFlag: false
    }
  });

  assert.equal(result.supportingEvidenceSummary.trueSoldDepth, 3);
  assert.equal(result.excludedEvidenceSummary.activeListingCount, 2);
  assert.equal(result.valuationDiagnosticStatus, VALUATION_DIAGNOSTIC_STATUS.SUPPORTED);
  assert.equal(result.blockingReasons.includes('true_sold_support_missing'), false);
});

test('missing point and range evidence remains unavailable without invented values', () => {
  const result = evaluateRangeFirstValuation({});

  assert.equal(result.valuationDiagnosticStatus, VALUATION_DIAGNOSTIC_STATUS.UNAVAILABLE);
  assert.equal(result.uncertaintyLevel, UNCERTAINTY_LEVEL.UNKNOWN);
  assert.equal(result.pointEstimateAssessment.pointEstimate, 'unknown');
  assert.equal(result.rangeAssessment.available, false);
  assert.equal(result.rangeAssessment.lowerBound, 'unknown');
  assert.equal(result.rangeAssessment.upperBound, 'unknown');
  assert.equal(result.blockingReasons.includes('missing_production_point_estimate'), true);
  assert.equal(result.blockingReasons.includes('missing_supported_valuation_range'), true);
});

test('diagnostics are deterministic and do not mutate inputs', () => {
  const input = supportedInput();
  const before = JSON.parse(JSON.stringify(input));
  const first = evaluateRangeFirstValuation(input);
  const second = evaluateRangeFirstValuation(input);

  assert.deepEqual(input, before);
  assert.deepEqual(second, first);
  assert.equal(first.stableFingerprint, second.stableFingerprint);
});

test('production intelligence trace records supplied range-first valuation diagnostics additively', () => {
  const evidenceReadinessDiagnosticResult = evaluateEvidenceReadiness(supportedInput());
  const diagnostic = evaluateRangeFirstValuation(supportedInput({
    evidenceReadinessDiagnosticResult
  }));
  const trace = createProductionIntelligenceTrace({
    traceId: 'trace-with-range-first-valuation',
    rangeFirstValuationDiagnosticResult: diagnostic,
    dealGateOutcome: {
      passed: false,
      decision: 'REJECT',
      reasons: ['test rejection']
    }
  });

  assert.equal(trace.rangeFirstValuationDiagnosticSummary.available, true);
  assert.equal(trace.rangeFirstValuationDiagnosticSummary.valuationDiagnosticStatus, diagnostic.valuationDiagnosticStatus);
  assert.equal(trace.rangeFirstValuationDiagnosticSummary.uncertaintyLevel, diagnostic.uncertaintyLevel);
  assert.equal(trace.rangeFirstValuationDiagnosticSummary.stableFingerprint, diagnostic.stableFingerprint);
  assert.equal(trace.rangeFirstValuationDiagnosticSummary.changesProductionBehavior, false);
  assert.equal(trace.dealGateOutcome.decision, 'REJECT');
  assert.equal(trace.buyNowEligibility.eligible, false);
});
