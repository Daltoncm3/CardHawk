'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const calibration = require('../validation/confidenceCalibration');

function buildResult(overrides = {}) {
  return {
    listing: {
      id: 'listing-1',
      title: 'Confidence Calibration Test Listing'
    },
    overallReadiness: 'supported_context',
    evidencePosture: 'strong',
    compPosture: 'strong',
    valuationPosture: 'strong_range',
    resalePressurePosture: 'low',
    confidence: 88,
    supportingSignals: [
      { source: 'evidence_sufficiency' },
      { source: 'listing_similarity' },
      { source: 'comparable_quality' },
      { source: 'valuation_range' },
      { source: 'supply_pressure' }
    ],
    cautionSignals: [],
    blockers: [],
    conflicts: [],
    expected: {
      overallReadiness: 'supported_context',
      evidencePosture: 'strong',
      compPosture: 'strong',
      valuationPosture: 'strong_range',
      resalePressurePosture: 'low',
      supportingSignalSources: [
        'evidence_sufficiency',
        'listing_similarity',
        'comparable_quality',
        'valuation_range',
        'supply_pressure'
      ],
      cautionSignalSources: [],
      blockerSources: [],
      conflictSources: [],
      explanationScore: 5,
      falsePositive: false,
      falseNegative: false
    },
    ...overrides
  };
}

test('assigns confidence values to calibration buckets', () => {
  assert.equal(calibration.getBucketForConfidence(0), '0-24');
  assert.equal(calibration.getBucketForConfidence(24), '0-24');
  assert.equal(calibration.getBucketForConfidence(25), '25-49');
  assert.equal(calibration.getBucketForConfidence(50), '50-74');
  assert.equal(calibration.getBucketForConfidence(75), '75-100');
  assert.equal(calibration.getBucketForConfidence(100), '75-100');
  assert.equal(calibration.getBucketForConfidence(undefined), 'unknown');
});

test('calculates bucket agreement and false rates from validation report results', () => {
  const report = calibration.evaluateConfidenceCalibration({
    results: [
      buildResult({ listing: { id: 'low-agree' }, confidence: 20 }),
      buildResult({
        listing: { id: 'mid-fp' },
        confidence: 60,
        expected: {
          ...buildResult().expected,
          falsePositive: true
        }
      }),
      buildResult({
        listing: { id: 'high-disagree' },
        confidence: 90,
        overallReadiness: 'limited_context'
      }),
      buildResult({
        listing: { id: 'unknown-confidence' },
        confidence: undefined
      })
    ]
  });

  assert.equal(report.source, 'confidence_calibration');
  assert.equal(report.mode, 'offline_validation');
  assert.equal(report.overallCalibrationSummary.totalListings, 4);
  assert.equal(report.confidenceBucketDistribution['0-24'], 1);
  assert.equal(report.confidenceBucketDistribution['50-74'], 1);
  assert.equal(report.confidenceBucketDistribution['75-100'], 1);
  assert.equal(report.confidenceBucketDistribution.unknown, 1);
  assert.equal(report.perBucketStatistics['0-24'].agreementRate, 100);
  assert.equal(report.perBucketStatistics['50-74'].falsePositiveRate, 100);
  assert.equal(report.perBucketStatistics['75-100'].agreementRate, 0);
  assert.equal(report.overconfidenceIndicators.length, 1);
  assert.equal(report.underconfidenceIndicators.length, 1);
  assert.ok(report.calibrationScore >= 0);
  assert.ok(report.suggestedCalibrationAdjustments.some((item) => /high-confidence disagreements/i.test(item)));
});

test('reports false negative rate by confidence bucket', () => {
  const report = calibration.evaluateConfidenceCalibration({
    results: [
      buildResult({
        listing: { id: 'false-negative' },
        confidence: 40,
        expected: {
          ...buildResult().expected,
          falseNegative: true
        }
      })
    ]
  });

  assert.equal(report.perBucketStatistics['25-49'].falseNegativeRate, 100);
  assert.equal(report.overallCalibrationSummary.falseNegativeRate, 100);
});

test('consumes dealer agreement scorecards with listing-level details', () => {
  const report = calibration.evaluateConfidenceCalibration({
    source: 'dealer_agreement_scorer',
    listingAgreementDetails: [
      {
        listingId: 'scorecard-1',
        title: 'Scorecard Listing',
        agreed: true,
        confidence: 82,
        falsePositive: false,
        falseNegative: false
      }
    ]
  });

  assert.equal(report.confidenceBucketDistribution['75-100'], 1);
  assert.equal(report.perBucketStatistics['75-100'].agreementRate, 100);
});

test('aggregate-only dealer scorecards degrade safely with warning', () => {
  const report = calibration.evaluateConfidenceCalibration({
    source: 'dealer_agreement_scorer',
    overallScorecard: {
      totalListings: 10,
      dealerAgreementPercent: 80
    },
    confidenceDistribution: {
      high: 10
    },
    listingsRequiringManualReview: []
  });

  assert.equal(report.overallCalibrationSummary.totalListings, 0);
  assert.equal(report.calibrationScore, 0);
  assert.match(report.warnings.join(' '), /listing-level confidence detail/i);
  assert.ok(report.recommendations.some((item) => /listing-level confidence/i.test(item)));
});

test('runConfidenceCalibration reads report JSON from disk', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cardhawk-confidence-calibration-'));
  const inputFile = path.join(tempDir, 'decision-validation-report.json');

  fs.writeFileSync(inputFile, `${JSON.stringify({ results: [buildResult({ confidence: 80 })] }, null, 2)}\n`);

  const report = calibration.runConfidenceCalibration(inputFile);

  assert.equal(report.overallCalibrationSummary.totalListings, 1);
  assert.equal(report.confidenceBucketDistribution['75-100'], 1);
});

test('confidence calibration does not mutate input reports', () => {
  const input = {
    results: [buildResult({ confidence: 80 })]
  };
  const before = JSON.stringify(input);

  calibration.evaluateConfidenceCalibration(input);

  assert.equal(JSON.stringify(input), before);
});
