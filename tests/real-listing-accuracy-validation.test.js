'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const accuracy = require('../validation/realListingAccuracyValidation');
const reportCli = require('../validation/runRealListingAccuracyReport');

function cardhawkListing(overrides = {}) {
  return {
    ebayItemId: 'ebay-accuracy-1',
    title: '2023 Test Rookie Silver PSA 10',
    url: 'https://example.test/item/ebay-accuracy-1',
    marketplace: 'ebay',
    price: 40,
    totalCost: 46,
    estimatedValue: 90,
    estimatedProfit: 28,
    roi: 0.61,
    score: 82,
    investmentQuality: 88,
    qualityBucket: 'Strong desirability context',
    parsed: {
      year: '2023',
      player: 'Test Rookie',
      set: 'Test Set',
      cardNumber: '181',
      parallel: 'Silver',
      grade: 'PSA 10'
    },
    marketConfidence: 78,
    marketData: {
      confidence: 72,
      soldCompCount: 4
    },
    compData: {
      trueSoldCompCount: 4,
      soldCompCount: 4,
      activeCompCount: 3
    },
    marketIntelligenceData: {
      decisionIntelligence: {
        overallReadiness: 'supported_context',
        evidencePosture: 'adequate',
        compPosture: 'usable',
        valuationPosture: 'usable_range',
        resalePressurePosture: 'normal'
      }
    },
    dealGrade: {
      grade: 'B+',
      action: 'REVIEW',
      gradeScore: 84
    },
    dealGate: {
      passed: true,
      buyNowAllowed: true,
      decision: 'BUY_NOW',
      reasons: [],
      positives: ['Supported by 4 sold comps.']
    },
    display: {
      authoritativeDecision: 'BUY_NOW',
      primaryDecisionLabel: 'BUY_NOW',
      productionDecisionExplanation: {
        label: 'Passed Deal Gate',
        primaryExplanation: 'Supported by 4 sold comps.'
      },
      soldEvidenceCount: 4,
      soldEvidenceSupport: {
        label: 'Sold Evidence Support',
        rawValue: 4,
        sourceDetails: {
          trueSoldCompCount: 4,
          activeCompCount: 3
        }
      },
      valuationConfidence: {
        label: 'Valuation Confidence',
        rawValue: 72
      },
      marketContextConfidence: {
        label: 'Market Context Confidence',
        rawValue: 78
      },
      evidenceReadinessExplanation: {
        label: 'Evidence Readiness',
        productionImpact: 'none',
        evidenceReadiness: 'supported_context',
        evidencePosture: 'adequate',
        compPosture: 'usable',
        valuationPosture: 'usable_range',
        resalePressurePosture: 'normal'
      },
      legacyScoreLabel: 'Legacy Context Score',
      qualityScoreLabel: 'Desirability Context',
      qualityBucketLabel: 'Strong desirability context',
      dealGradeScoreLabel: 'Legacy Deal Grade',
      dealGradeLabel: 'B+',
      unifiedDecisionPresentation: {
        source: 'unified_decision_presentation',
        authoritativeDecisionSource: 'deal_gate'
      }
    },
    ...overrides
  };
}

function reviewedRecord({
  recordId,
  buyNow,
  daltonJudgment,
  estimatedValue = 90,
  expectedFairValue = 100,
  soldCount = 4,
  outcomeCategory = '',
  disagreementCategories = [],
  recurringFailurePattern = ''
}) {
  const listing = cardhawkListing({
    ebayItemId: recordId,
    estimatedValue,
    dealGate: {
      passed: buyNow,
      buyNowAllowed: buyNow,
      decision: buyNow ? 'BUY_NOW' : 'REJECT',
      reasons: buyNow ? [] : ['Rejected by Deal Gate for test.'],
      positives: buyNow ? ['Supported by sold comps.'] : []
    },
    display: {
      ...cardhawkListing().display,
      authoritativeDecision: buyNow ? 'BUY_NOW' : 'REJECTED',
      primaryDecisionLabel: buyNow ? 'BUY_NOW' : 'Rejected by Deal Gate',
      soldEvidenceCount: soldCount,
      soldEvidenceSupport: {
        label: 'Sold Evidence Support',
        rawValue: soldCount,
        sourceDetails: {
          trueSoldCompCount: soldCount,
          activeCompCount: 2
        }
      }
    }
  });
  const record = accuracy.createListingValidationRecord(listing, {
    recordId,
    capturedAt: '2026-07-13T00:00:00.000Z'
  });

  record.daltonReview = {
    judgment: daltonJudgment,
    expectedFairValue,
    judgmentConfidence: 85,
    agreementDisagreementReason: `${recordId} review reason`,
    notes: 'Reviewed from offline fixture.'
  };
  record.validation = {
    outcomeCategory: outcomeCategory || 'uncertain',
    disagreementCategories,
    recurringFailurePattern,
    reviewedAt: '2026-07-13T01:00:00.000Z'
  };

  return record;
}

test('creates a structured immutable validation record from CardHawk display output', () => {
  const record = accuracy.createListingValidationRecord(cardhawkListing(), {
    recordId: 'record-1',
    capturedAt: '2026-07-13T00:00:00.000Z'
  });

  assert.equal(record.schemaVersion, accuracy.SCHEMA_VERSION);
  assert.equal(record.listing.itemId, 'ebay-accuracy-1');
  assert.equal(record.listing.askingPrice, 40);
  assert.equal(record.listing.totalCost, 46);
  assert.equal(record.cardhawkSnapshot.dealGateDecision, 'BUY_NOW');
  assert.equal(record.cardhawkSnapshot.buyNow, true);
  assert.equal(record.cardhawkSnapshot.estimatedValue, 90);
  assert.equal(record.cardhawkSnapshot.estimatedProfit, 28);
  assert.equal(record.cardhawkSnapshot.roi, 0.61);
  assert.equal(record.cardhawkSnapshot.soldEvidenceSupport.rawValue, 4);
  assert.equal(record.cardhawkSnapshot.valuationConfidence.rawValue, 72);
  assert.equal(record.cardhawkSnapshot.marketContextConfidence.rawValue, 78);
  assert.equal(record.cardhawkSnapshot.evidenceReadiness.evidenceReadiness, 'supported_context');
  assert.equal(record.cardhawkSnapshot.legacyContextScore.rawValue, 82);
  assert.equal(record.cardhawkSnapshot.desirabilityContext.rawValue, 88);
  assert.equal(record.cardhawkSnapshot.legacyDealGrade.displayGrade, 'B+');
  assert.equal(record.snapshotHash, accuracy.fingerprint(record.cardhawkSnapshot));
  assert.equal(record.daltonReview.judgment, 'unreviewed');
});

test('validates immutable snapshots and detects tampering', () => {
  const record = accuracy.createListingValidationRecord(cardhawkListing(), {
    recordId: 'record-immutability',
    capturedAt: '2026-07-13T00:00:00.000Z'
  });

  assert.equal(accuracy.validateValidationRecord(record).valid, true);

  const tampered = JSON.parse(JSON.stringify(record));
  tampered.cardhawkSnapshot.estimatedValue = 10;

  const validation = accuracy.validateValidationRecord(tampered);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => /snapshotHash/.test(error)));
});

test('builds agreement, false-positive, missed-opportunity, and valuation metrics', () => {
  const records = [
    reviewedRecord({ recordId: 'correct-buy', buyNow: true, daltonJudgment: 'buy', expectedFairValue: 100 }),
    reviewedRecord({
      recordId: 'false-positive',
      buyNow: true,
      daltonJudgment: 'reject',
      estimatedValue: 140,
      expectedFairValue: 80,
      disagreementCategories: ['valuation', 'evidence'],
      recurringFailurePattern: 'overstated_value'
    }),
    reviewedRecord({ recordId: 'correct-reject', buyNow: false, daltonJudgment: 'reject', soldCount: 0 }),
    reviewedRecord({
      recordId: 'missed-opportunity',
      buyNow: false,
      daltonJudgment: 'buy',
      estimatedValue: 75,
      expectedFairValue: 110,
      disagreementCategories: ['display']
    }),
    reviewedRecord({ recordId: 'uncertain', buyNow: false, daltonJudgment: 'uncertain', expectedFairValue: null })
  ];
  const report = accuracy.buildAccuracyValidationReport(accuracy.buildValidationBatch(records), {
    generatedAt: '2026-07-13T02:00:00.000Z'
  });

  assert.equal(report.totalListings, 5);
  assert.equal(report.totalListingsReviewed, 5);
  assert.equal(report.decisiveReviewCount, 4);
  assert.equal(report.cardhawkVsDaltonAgreementRate, 50);
  assert.equal(report.falsePositiveCount, 1);
  assert.equal(report.falsePositiveRate, 25);
  assert.equal(report.missedOpportunityCount, 1);
  assert.equal(report.missedOpportunityRate, 25);
  assert.equal(report.outcomeCounts.correct_buy, 1);
  assert.equal(report.outcomeCounts.false_positive, 1);
  assert.equal(report.outcomeCounts.correct_rejection, 1);
  assert.equal(report.outcomeCounts.missed_opportunity, 1);
  assert.equal(report.outcomeCounts.uncertain, 1);
  assert.equal(report.valuationErrorSummary.comparedCount, 4);
  assert.equal(report.disagreementCategories.valuation, 1);
  assert.equal(report.disagreementCategories.evidence, 1);
  assert.equal(report.disagreementCategories.display, 1);
  assert.equal(report.recurringFailurePatterns.overstated_value, 1);
  assert.equal(report.breakdownByEvidenceLevel.sufficient_sold_support.total, 4);
  assert.equal(report.breakdownByEvidenceLevel.no_sold_support.total, 1);
  assert.equal(report.breakdownByPriceRange['25_to_99'].total, 5);
  assert.equal(report.validationIntegrity.invalidRecordCount, 0);
});

test('supports incremental review batches from disk and writes a report', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cardhawk-real-accuracy-'));
  const batchOnePath = path.join(tempDir, 'batch-001.json');
  const batchTwoPath = path.join(tempDir, 'batch-002.json');
  const reportPath = path.join(tempDir, 'report.json');
  const batchOne = accuracy.buildValidationBatch([
    reviewedRecord({ recordId: 'batch-one', buyNow: true, daltonJudgment: 'buy' })
  ], {
    batchId: 'batch-001',
    createdAt: '2026-07-13T00:00:00.000Z'
  });
  const batchTwo = accuracy.buildValidationBatch([
    reviewedRecord({ recordId: 'batch-two', buyNow: false, daltonJudgment: 'buy' })
  ], {
    batchId: 'batch-002',
    createdAt: '2026-07-13T00:10:00.000Z'
  });

  accuracy.writeJsonFile(batchOnePath, batchOne);
  accuracy.writeJsonFile(batchTwoPath, batchTwo);

  const report = accuracy.runAccuracyValidationReport([batchOnePath, batchTwoPath], reportPath, {
    generatedAt: '2026-07-13T03:00:00.000Z'
  });
  const written = JSON.parse(fs.readFileSync(reportPath, 'utf8'));

  assert.equal(report.totalListings, 2);
  assert.equal(report.missedOpportunityCount, 1);
  assert.equal(written.totalListings, 2);
  assert.equal(written.missedOpportunityCount, 1);
});

test('starter pilot batch is valid and documents an unreviewed placeholder', () => {
  const starter = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'validation', 'real-listing-accuracy', 'starter-pilot-batch.json'),
    'utf8'
  ));
  const report = accuracy.buildAccuracyValidationReport(starter, {
    generatedAt: '2026-07-13T04:00:00.000Z'
  });

  assert.equal(starter.targetListingCount, 25);
  assert.equal(starter.immutableSnapshots, true);
  assert.equal(report.totalListings, 1);
  assert.equal(report.totalListingsReviewed, 0);
  assert.equal(report.validationIntegrity.invalidRecordCount, 0);
});

test('report CLI parses arguments and prints concise summaries', () => {
  const parsed = reportCli.parseArgs(['batch-1.json', 'batch-2.json', '--out', 'report.json']);

  assert.deepEqual(parsed.inputs, ['batch-1.json', 'batch-2.json']);
  assert.equal(parsed.out, 'report.json');

  const summary = reportCli.printSummary({
    totalListingsReviewed: 2,
    totalListings: 3,
    cardhawkVsDaltonAgreementRate: 50,
    falsePositiveCount: 1,
    falsePositiveRate: 25,
    missedOpportunityCount: 0,
    missedOpportunityRate: 0,
    valuationErrorSummary: { comparedCount: 2 }
  });

  assert.match(summary, /2\/3 reviewed/);
  assert.match(summary, /Agreement: 50%/);
  assert.match(summary, /False positives: 1/);
});
