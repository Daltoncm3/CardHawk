'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  CALIBRATION_STATUS,
  CONFIDENCE_SUPPORT_LEVEL,
  buildConfidenceCalibrationDiagnosticFingerprint,
  evaluateConfidenceCalibrationDiagnostic,
  summarizeConfidenceCalibrationDiagnostic
} = require('../validation/confidenceCalibrationDiagnostics');
const {
  evaluateEvidenceReadiness
} = require('../validation/evidenceReadinessDiagnostics');
const {
  evaluateRangeFirstValuation
} = require('../validation/rangeFirstValuationDiagnostics');
const {
  createProductionIntelligenceTrace
} = require('../validation/productionIntelligenceTrace');

function soldRecord(id, overrides = {}) {
  return {
    id,
    evidenceType: 'true_sold',
    status: 'active_evidence',
    source: overrides.source || `source-${id}`,
    soldPrice: 100,
    soldAt: '2026-06-01T00:00:00.000Z',
    ageDays: 30,
    exactComparable: true,
    similarity: 95,
    qualityBand: 'excellent',
    ...overrides
  };
}

function calibrationReport(overrides = {}) {
  return {
    source: 'confidence_calibration',
    mode: 'offline_validation',
    overallCalibrationSummary: {
      totalListings: 5,
      withConfidenceCount: 5,
      missingConfidenceCount: 0,
      overallAgreementRate: 86,
      falsePositiveRate: 0,
      falseNegativeRate: 0,
      averageConfidence: 88,
      overconfidenceCount: 0,
      underconfidenceCount: 0,
      ...overrides.overallCalibrationSummary
    },
    calibrationScore: 94,
    overconfidenceIndicators: overrides.overconfidenceIndicators || [],
    underconfidenceIndicators: overrides.underconfidenceIndicators || [],
    warnings: overrides.warnings || []
  };
}

function supportedDiagnosticInput(overrides = {}) {
  const evidenceRecords = [
    soldRecord('1'),
    soldRecord('2'),
    soldRecord('3'),
    soldRecord('4'),
    soldRecord('5')
  ];
  const evidenceReadinessDiagnosticResult = evaluateEvidenceReadiness({
    evidenceRecords,
    identityDiagnosticResult: {
      identityEligibility: {
        valuationEligible: true,
        exactCompEligible: true
      },
      diagnosticStatus: 'exact'
    }
  });
  const rangeFirstValuationDiagnosticResult = evaluateRangeFirstValuation({
    marketData: {
      source: 'sold_market',
      method: 'weightedSoldComps',
      marketValue: 100,
      confidence: 88
    },
    valuationRange: {
      floorValue: 92,
      expectedValue: 100,
      ceilingValue: 108,
      confidence: 88,
      rangeQuality: 'usable'
    },
    evidenceReadinessDiagnosticResult,
    evidenceSummary: {
      trueSoldCount: 5
    },
    comparableQuality: {
      averageComparableQualityScore: 88,
      scoredComparableCount: 5
    }
  });

  return {
    confidenceSummary: {
      confidence: 88,
      source: 'sold_market',
      cap: 100
    },
    evidenceReadinessDiagnosticResult,
    rangeFirstValuationDiagnosticResult,
    identityDiagnosticResult: {
      diagnosticStatus: 'exact',
      ambiguityLevel: 'none',
      identityEligibility: {
        valuationEligible: true,
        exactCompEligible: true
      }
    },
    comparableQuality: {
      averageComparableQualityScore: 88,
      scoredComparableCount: 5,
      warnings: []
    },
    confidenceCalibrationReport: calibrationReport(),
    ...overrides
  };
}

test('confidence calibration diagnostics classify supported reviewed confidence as calibrated', () => {
  const result = evaluateConfidenceCalibrationDiagnostic(supportedDiagnosticInput());

  assert.equal(result.calibrationStatus, CALIBRATION_STATUS.CALIBRATED);
  assert.equal(result.confidenceSupportLevel, CONFIDENCE_SUPPORT_LEVEL.STRONG);
  assert.equal(result.reportedConfidence.confidence, 88);
  assert.equal(result.availableOutcomeMetrics.sampleSize, 5);
  assert.equal(result.calibrationGap.gap, 2);
  assert.equal(result.overconfidenceIndicators.length, 0);
  assert.equal(result.underconfidenceIndicators.length, 0);
  assert.equal(result.recommendedConfidenceCap.recommendedCap, 100);
  assert.equal(result.stableFingerprint, buildConfidenceCalibrationDiagnosticFingerprint(result));
  assert.match(summarizeConfidenceCalibrationDiagnostic(result), /calibrated/);
});

test('high confidence with poor agreement and false positives is overconfident', () => {
  const result = evaluateConfidenceCalibrationDiagnostic(supportedDiagnosticInput({
    confidenceSummary: {
      confidence: 90,
      source: 'sold_market',
      cap: 100
    },
    confidenceCalibrationReport: calibrationReport({
      overallCalibrationSummary: {
        totalListings: 4,
        withConfidenceCount: 4,
        overallAgreementRate: 50,
        falsePositiveRate: 50,
        falsePositiveCount: 2,
        averageConfidence: 90
      },
      overconfidenceIndicators: [
        { listingId: 'listing-1', confidence: 90, reasons: ['high confidence disagreement'] }
      ]
    })
  }));

  assert.equal(result.calibrationStatus, CALIBRATION_STATUS.OVERCONFIDENT);
  assert.equal(result.calibrationGap.gap, 40);
  assert.equal(result.overconfidenceIndicators.length >= 2, true);
  assert.equal(result.warnings.includes('calibration_gap_exceeds_15_points'), true);
  assert.equal(result.recommendedConfidenceCap.recommendedCap, 60);
});

test('low reported confidence with strong observed agreement is underconfident', () => {
  const result = evaluateConfidenceCalibrationDiagnostic(supportedDiagnosticInput({
    confidenceSummary: {
      confidence: 35,
      source: 'sold_market',
      cap: 100
    },
    confidenceCalibrationReport: calibrationReport({
      overallCalibrationSummary: {
        totalListings: 4,
        withConfidenceCount: 4,
        overallAgreementRate: 85,
        falseNegativeRate: 0,
        averageConfidence: 35
      }
    })
  }));

  assert.equal(result.calibrationStatus, CALIBRATION_STATUS.UNDERCONFIDENT);
  assert.equal(result.calibrationGap.direction, 'reported_below_observed');
  assert.equal(result.underconfidenceIndicators.some((item) => item.reason === 'reported_confidence_below_observed_agreement_by_20_points'), true);
  assert.equal(result.recommendedReviewAction, 'review_underconfidence_before_threshold_changes');
});

test('reviewed outcomes below the minimum sample remain insufficient sample', () => {
  const result = evaluateConfidenceCalibrationDiagnostic(supportedDiagnosticInput({
    confidenceCalibrationReport: calibrationReport({
      overallCalibrationSummary: {
        totalListings: 1,
        withConfidenceCount: 1,
        overallAgreementRate: 100,
        averageConfidence: 88
      }
    })
  }));

  assert.equal(result.calibrationStatus, CALIBRATION_STATUS.INSUFFICIENT_SAMPLE);
  assert.equal(result.blockingReasons.includes('sample_size_below_minimum_for_calibration'), true);
  assert.equal(result.availableOutcomeMetrics.sampleSize, 1);
  assert.equal(result.recommendedConfidenceCap.recommendedCap, 50);
});

test('missing reviewed outcomes remain missing and under review', () => {
  const input = supportedDiagnosticInput();
  delete input.confidenceCalibrationReport;
  const result = evaluateConfidenceCalibrationDiagnostic(input);

  assert.equal(result.calibrationStatus, CALIBRATION_STATUS.UNDER_REVIEW);
  assert.equal(result.availableOutcomeMetrics.outcomeAvailable, false);
  assert.equal(result.availableOutcomeMetrics.sampleSize, 0);
  assert.equal(result.blockingReasons.includes('reviewed_outcomes_missing'), true);
  assert.equal(result.calibrationGap.available, false);
});

test('empty input is unavailable without invented confidence or outcomes', () => {
  const result = evaluateConfidenceCalibrationDiagnostic({});

  assert.equal(result.calibrationStatus, CALIBRATION_STATUS.UNAVAILABLE);
  assert.equal(result.confidenceSupportLevel, CONFIDENCE_SUPPORT_LEVEL.UNKNOWN);
  assert.equal(result.reportedConfidence.confidence, 'unknown');
  assert.equal(result.availableOutcomeMetrics.outcomeAvailable, false);
  assert.equal(result.blockingReasons.includes('reported_confidence_missing'), true);
  assert.equal(result.blockingReasons.includes('reviewed_outcomes_missing'), true);
});

test('confidence calibration diagnostics are deterministic and do not mutate inputs', () => {
  const input = supportedDiagnosticInput();
  const before = JSON.parse(JSON.stringify(input));
  const first = evaluateConfidenceCalibrationDiagnostic(input);
  const second = evaluateConfidenceCalibrationDiagnostic(input);

  assert.deepEqual(input, before);
  assert.deepEqual(second, first);
  assert.equal(first.stableFingerprint, second.stableFingerprint);
});

test('production intelligence trace records supplied confidence calibration diagnostics additively', () => {
  const diagnostic = evaluateConfidenceCalibrationDiagnostic(supportedDiagnosticInput());
  const trace = createProductionIntelligenceTrace({
    traceId: 'trace-with-confidence-calibration',
    confidenceCalibrationDiagnosticResult: diagnostic,
    dealGateOutcome: {
      passed: false,
      decision: 'REJECT',
      reasons: ['test rejection']
    }
  });

  assert.equal(trace.confidenceCalibrationDiagnosticSummary.available, true);
  assert.equal(trace.confidenceCalibrationDiagnosticSummary.calibrationStatus, diagnostic.calibrationStatus);
  assert.equal(trace.confidenceCalibrationDiagnosticSummary.confidenceSupportLevel, diagnostic.confidenceSupportLevel);
  assert.equal(trace.confidenceCalibrationDiagnosticSummary.stableFingerprint, diagnostic.stableFingerprint);
  assert.equal(trace.confidenceCalibrationDiagnosticSummary.changesProductionBehavior, false);
  assert.equal(trace.dealGateOutcome.decision, 'REJECT');
  assert.equal(trace.buyNowEligibility.eligible, false);
});
