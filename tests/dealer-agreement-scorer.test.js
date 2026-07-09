'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const scorer = require('../validation/dealerAgreementScorer');

function buildResult(overrides = {}) {
  return {
    listing: {
      id: 'listing-1',
      title: 'Dealer Agreement Test Listing'
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

test('scores full dealer agreement for matching validation report results', () => {
  const scorecard = scorer.scoreDealerAgreement({
    source: 'decision_intelligence_live_validation_runner',
    results: [buildResult()]
  });

  assert.equal(scorecard.source, 'dealer_agreement_scorer');
  assert.equal(scorecard.mode, 'offline_validation');
  assert.equal(scorecard.overallScorecard.totalListings, 1);
  assert.equal(scorecard.overallScorecard.agreedListings, 1);
  assert.equal(scorecard.overallScorecard.dealerAgreementPercent, 100);
  assert.equal(scorecard.overallScorecard.explanationScoreAverage, 5);
  assert.equal(scorecard.perCategoryScorecard.posture.overallReadiness.agreementPercent, 100);
  assert.equal(scorecard.perCategoryScorecard.signals.blockers.agreementPercent, 100);
  assert.equal(scorecard.perCategoryScorecard.signals.cautionSignals.agreementPercent, 100);
  assert.equal(scorecard.perCategoryScorecard.signals.supportingSignals.agreementPercent, 100);
  assert.equal(scorecard.perCategoryScorecard.signals.conflicts.agreementPercent, 100);
  assert.deepEqual(scorecard.listingsRequiringManualReview, []);
});

test('captures posture and signal disagreements for manual review', () => {
  const scorecard = scorer.scoreDealerAgreement({
    results: [
      buildResult({
        listing: { id: 'listing-2', title: 'Mismatch Listing' },
        overallReadiness: 'limited_context',
        blockers: [{ source: 'evidence_sufficiency' }],
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
          explanationScore: 3
        }
      })
    ]
  });

  assert.equal(scorecard.overallScorecard.dealerAgreementPercent, 0);
  assert.equal(scorecard.perCategoryScorecard.posture.overallReadiness.agreementPercent, 0);
  assert.equal(scorecard.perCategoryScorecard.posture.evidencePosture.agreementPercent, 100);
  assert.equal(scorecard.perCategoryScorecard.signals.blockers.agreementPercent, 0);
  assert.equal(scorecard.listingsRequiringManualReview.length, 1);
  assert.deepEqual(scorecard.listingsRequiringManualReview[0].reasons, [
    'posture disagreement',
    'signal disagreement'
  ]);
  assert.match(scorecard.listingsRequiringManualReview[0].recommendation, /readiness thresholds/i);
});

test('tracks false positive and false negative rates', () => {
  const scorecard = scorer.scoreDealerAgreement({
    results: [
      buildResult({
        listing: { id: 'false-positive' },
        expected: {
          ...buildResult().expected,
          falsePositive: true
        }
      }),
      buildResult({
        listing: { id: 'false-negative' },
        expected: {
          ...buildResult().expected,
          falseNegative: true
        }
      })
    ]
  });

  assert.equal(scorecard.overallScorecard.falsePositiveCount, 1);
  assert.equal(scorecard.overallScorecard.falseNegativeCount, 1);
  assert.equal(scorecard.overallScorecard.falsePositiveRate, 50);
  assert.equal(scorecard.overallScorecard.falseNegativeRate, 50);
  assert.equal(scorecard.listingsRequiringManualReview.length, 2);
});

test('missing dealer expectations do not guess agreement', () => {
  const scorecard = scorer.scoreDealerAgreement({
    results: [
      {
        listing: { id: 'missing-labels' },
        overallReadiness: 'supported_context',
        supportingSignals: [],
        cautionSignals: [],
        blockers: [],
        conflicts: []
      }
    ]
  });

  assert.equal(scorecard.overallScorecard.dealerAgreementPercent, 0);
  assert.equal(scorecard.perCategoryScorecard.posture.overallReadiness.missingExpected, 1);
  assert.equal(scorecard.perCategoryScorecard.signals.supportingSignals.missingExpected, 1);
  assert.equal(scorecard.listingsRequiringManualReview.length, 1);
  assert.match(scorecard.listingsRequiringManualReview[0].recommendation, /dealer expectation labels/i);
});

test('confidence distribution buckets numeric and missing confidence', () => {
  const scorecard = scorer.scoreDealerAgreement({
    results: [
      buildResult({ listing: { id: 'low' }, confidence: 20 }),
      buildResult({ listing: { id: 'medium' }, confidence: 55 }),
      buildResult({ listing: { id: 'high' }, confidence: 80 }),
      buildResult({ listing: { id: 'very-high' }, confidence: 95 }),
      buildResult({ listing: { id: 'unknown' }, confidence: undefined })
    ]
  });

  assert.equal(scorecard.confidenceDistribution.low, 1);
  assert.equal(scorecard.confidenceDistribution.medium, 1);
  assert.equal(scorecard.confidenceDistribution.high, 1);
  assert.equal(scorecard.confidenceDistribution.very_high, 1);
  assert.equal(scorecard.confidenceDistribution.unknown, 1);
});

test('runDealerAgreementScoring consumes report JSON from disk', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cardhawk-dealer-agreement-'));
  const inputFile = path.join(tempDir, 'decision-validation-report.json');

  fs.writeFileSync(inputFile, `${JSON.stringify({ results: [buildResult()] }, null, 2)}\n`);

  const scorecard = scorer.runDealerAgreementScoring(inputFile);

  assert.equal(scorecard.overallScorecard.totalListings, 1);
  assert.equal(scorecard.overallScorecard.dealerAgreementPercent, 100);
});

test('collectSources normalizes string and object signal sources', () => {
  assert.deepEqual(
    scorer.collectSources([
      'b',
      { source: 'a' },
      { type: 'c' },
      { key: 'a' },
      null
    ]),
    ['a', 'b', 'c']
  );
});
