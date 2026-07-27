'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const reviewContract = require('../validation/realListingDecisionReviewContract');

function fullInput(overrides = {}) {
  return {
    packageId: 'pkg-ebay-1001',
    reviewBatchId: 'batch-2026-07-20',
    marketplace: 'ebay',
    createdAt: '2026-07-20T10:00:00.000Z',
    capturedAt: '2026-07-20T09:55:00.000Z',
    listingSnapshot: {
      ebayItemId: '1001',
      title: '2020 Panini Prizm Anthony Edwards Silver PSA 10 #258',
      url: 'https://example.test/item/1001',
      askingPrice: 150,
      shipping: 5,
      totalCost: 155,
      marketplace: 'ebay',
      sellerSummary: { feedbackScore: 1200, positiveFeedbackPercent: 99.7 },
      listingState: 'active',
      imageSummary: { imageCount: 8 },
      provenance: { adapter: 'ebayMarketplace', scanId: 'scan-abc' },
      parsed: {
        player: 'Anthony Edwards',
        year: '2020',
        setName: 'Prizm',
        cardNumber: '258',
        gradeCompany: 'PSA',
        grade: 10
      }
    },
    canonicalIdentity: {
      canonicalIdentityKey: 'ci:v1:sports:basketball:2020:panini:prizm:anthony-edwards:258:silver:non-auto:non-mem:unnumbered:graded:psa-10',
      normalized: { subject: { name: 'Anthony Edwards' }, rawOrGraded: 'graded' },
      eligibility: { exactCompEligible: true, valuationEligible: true }
    },
    identityDiagnostics: {
      diagnosticStatus: 'exact',
      ambiguityLevel: 'none',
      fieldsConfirmed: ['subject', 'year', 'set', 'grade'],
      fieldsMissing: [],
      fieldsConflicting: [],
      fieldsInferred: ['parallel'],
      warnings: [],
      blockingIssues: []
    },
    productionValuation: {
      estimatedValue: 225,
      estimatedProfit: 45
    },
    roiData: { roi: 0.29, roiPercent: 29 },
    productionConfidence: { confidence: 82, label: 'strong' },
    evidenceSummary: { trueSoldCount: 5, activeCount: 4, activeOnlyFlag: false },
    comparableSummary: { exactComparableCount: 5, contextualComparableCount: 2 },
    gradingSummary: { gradeCompany: 'PSA', grade: 10, confirmed: true },
    riskSummary: { riskLevel: 'low' },
    qualitySummary: { listingQualityStatus: 'strong' },
    dealGateInputs: { soldCompCount: 5, confidenceScore: 82, riskLevel: 'low' },
    dealGateOutcome: { passed: true, buyNowAllowed: true, decision: 'BUY_NOW', reasons: [] },
    notificationEligibility: { eligible: true, reason: 'BUY_NOW' },
    explanationChain: ['Exact identity matched.', 'Sold evidence supports valuation.'],
    productionTraceFingerprint: 'trace-fingerprint-1',
    shadowSoldComparison: { acceptedExactMatches: [{ recordId: 'sold-1' }] },
    shadowValuation: { recommendedMarketValue: 220, valuationConfidence: 78 },
    evidenceReadinessDiagnostics: { readinessStatus: 'ready', readinessLevel: 'sufficient' },
    rangeFirstValuationDiagnostics: { valuationDiagnosticStatus: 'supported', uncertaintyLevel: 'low' },
    confidenceCalibrationDiagnostics: { calibrationStatus: 'provisionally_calibrated' },
    listingQualityGradingDiagnostics: { listingQualityStatus: 'strong', gradingDiagnosticStatus: 'confirmed' },
    opportunityFalsePositiveDiagnostics: { falsePositiveRiskStatus: 'low_risk', materialWarnings: [] },
    shadowConfidence: 78,
    shadowRecommendationPosture: 'BUY_NOW',
    shadowFingerprints: { shadowValuation: 'shadow-val-fp' },
    validationCandidate: { suggestedValidationFocus: ['identity', 'valuation'] },
    ...overrides
  };
}

function fullReview(overrides = {}) {
  return {
    reviewer: 'Dalton',
    reviewedAt: '2026-07-20T12:00:00.000Z',
    identityCorrect: 'yes',
    evidenceSufficient: 'yes',
    valuationReasonable: 'yes',
    confidenceAppropriate: 'yes',
    wouldBuy: 'yes',
    wouldNotify: 'yes',
    productionCorrect: 'yes',
    shadowBetter: 'no',
    buyNowQuality: 'correct',
    dealGateQuality: 'correct',
    reasonCategories: ['weak_evidence', 'identity_error'],
    disagreementCategories: ['valuation_disagreement'],
    reviewConfidence: 88,
    notes: 'Review fixture notes.',
    ...overrides
  };
}

test('exports Real Listing Decision Review public API and constants', () => {
  assert.equal(reviewContract.REAL_LISTING_DECISION_REVIEW_SOURCE, 'real_listing_decision_review_contract');
  assert.equal(reviewContract.REAL_LISTING_DECISION_REVIEW_SCHEMA_VERSION, '1.0.0');
  assert.equal(typeof reviewContract.createRealListingDecisionReviewPackage, 'function');
  assert.equal(typeof reviewContract.validateRealListingDecisionReviewPackage, 'function');
  assert.equal(typeof reviewContract.createHumanReviewRecord, 'function');
  assert.equal(typeof reviewContract.validateHumanReviewRecord, 'function');
  assert.equal(typeof reviewContract.attachHumanReviewRecord, 'function');
  assert.equal(typeof reviewContract.buildRealListingDecisionReviewPackageFingerprint, 'function');
  assert.equal(typeof reviewContract.buildRealListingDecisionReviewSnapshotFingerprint, 'function');
  assert.equal(typeof reviewContract.buildHumanReviewFingerprint, 'function');
  assert.equal(typeof reviewContract.determineReviewStatus, 'function');
});

test('builds and validates a minimum deterministic review package', () => {
  const input = {
    packageId: 'minimum-package',
    reviewBatchId: 'minimum-batch',
    marketplace: 'ebay',
    createdAt: '2026-07-20T10:00:00.000Z',
    capturedAt: '2026-07-20T09:55:00.000Z',
    listingSnapshot: {
      itemId: 'minimum-listing',
      title: 'Minimum listing fixture'
    }
  };
  const first = reviewContract.createRealListingDecisionReviewPackage(input);
  const second = reviewContract.createRealListingDecisionReviewPackage(input);

  assert.equal(first.schemaVersion, reviewContract.REAL_LISTING_DECISION_REVIEW_SCHEMA_VERSION);
  assert.equal(first.packageId, 'minimum-package');
  assert.equal(first.listingId, 'minimum-listing');
  assert.equal(first.reviewStatus, reviewContract.REVIEW_STATUSES.UNREVIEWED);
  assert.equal(first.productionImpact, 'none');
  assert.equal(first.decisionImpact, 'none');
  assert.equal(first.evidenceOnly, true);
  assert.equal(first.auditMetadata.recomputesProductionEngines, false);
  assert.equal(first.packageFingerprint, second.packageFingerprint);
  assert.equal(reviewContract.validateRealListingDecisionReviewPackage(first).valid, true);
});

test('builds a full review package with production, shadow, identity, and disagreement snapshots', () => {
  const reviewPackage = reviewContract.createRealListingDecisionReviewPackage(fullInput());

  assert.equal(reviewPackage.listingSnapshot.title, '2020 Panini Prizm Anthony Edwards Silver PSA 10 #258');
  assert.equal(reviewPackage.identitySnapshot.diagnosticStatus, 'exact');
  assert.equal(reviewPackage.identitySnapshot.fieldsConfirmed.includes('subject'), true);
  assert.equal(reviewPackage.productionSnapshot.estimatedValue, 225);
  assert.equal(reviewPackage.productionSnapshot.buyNowEligibility.eligible, true);
  assert.equal(reviewPackage.productionSnapshot.productionTraceFingerprint, 'trace-fingerprint-1');
  assert.equal(reviewPackage.shadowSnapshot.shadowValuation.recommendedMarketValue, 220);
  assert.equal(reviewPackage.shadowSnapshot.falsePositiveDiagnostics.falsePositiveRiskStatus, 'low_risk');
  assert.equal(reviewPackage.disagreementSnapshot.productionVersusShadowDecisionDisagreement, false);
  assert.equal(reviewPackage.disagreementSnapshot.valuationDisagreement, true);
  assert.equal(reviewPackage.snapshotFingerprint, reviewContract.buildRealListingDecisionReviewSnapshotFingerprint(fullInput()));
  assert.equal(reviewPackage.packageFingerprint, reviewContract.buildRealListingDecisionReviewPackageFingerprint(reviewPackage));
});

test('preserves missing optional sections and explicit unknown values', () => {
  const reviewPackage = reviewContract.createRealListingDecisionReviewPackage({
    packageId: 'unknown-package',
    reviewBatchId: 'unknown-batch',
    marketplace: 'ebay',
    createdAt: '2026-07-20T10:00:00.000Z',
    capturedAt: '2026-07-20T09:55:00.000Z',
    listingSnapshot: {
      itemId: 'unknown-listing',
      title: 'Unknown fixture'
    },
    productionValuation: {
      estimatedValue: 'unknown'
    }
  });

  assert.equal(reviewPackage.productionSnapshot.estimatedValue, 'unknown');
  assert.equal(reviewPackage.identitySnapshot.diagnosticStatus, 'unknown');
  assert.equal(reviewPackage.shadowSnapshot.shadowConfidence, 'unknown');
  assert.equal(reviewPackage.disagreementSnapshot.confidenceDisagreement, 'unknown');
  assert.equal(reviewPackage.auditMetadata.missingSections.includes('shadowSnapshot'), true);
});

test('rejects invalid productionImpact and decisionImpact values', () => {
  const reviewPackage = reviewContract.createRealListingDecisionReviewPackage(fullInput());
  const invalid = reviewContract.cloneRealListingDecisionReviewPackage(reviewPackage);
  invalid.productionImpact = 'changes_production';
  invalid.decisionImpact = 'changes_decision';

  const result = reviewContract.validateRealListingDecisionReviewPackage(invalid);
  assert.equal(result.valid, false);
  assert.equal(result.failures.some((failure) => failure.code === 'invalid_production_impact'), true);
  assert.equal(result.failures.some((failure) => failure.code === 'invalid_decision_impact'), true);
});

test('review packages are immutable and cloned copies do not mutate the original', () => {
  const reviewPackage = reviewContract.createRealListingDecisionReviewPackage(fullInput());

  assert.equal(Object.isFrozen(reviewPackage), true);
  assert.equal(Object.isFrozen(reviewPackage.listingSnapshot), true);
  assert.throws(() => {
    reviewPackage.listingSnapshot.title = 'mutated';
  }, TypeError);

  const clone = reviewContract.cloneRealListingDecisionReviewPackage(reviewPackage);
  clone.listingSnapshot.title = 'mutated clone';
  assert.notEqual(clone.listingSnapshot.title, reviewPackage.listingSnapshot.title);
});

test('builds and validates deterministic human review records', () => {
  const first = reviewContract.createHumanReviewRecord(fullReview());
  const second = reviewContract.createHumanReviewRecord(fullReview());

  assert.equal(first.reviewFingerprint, second.reviewFingerprint);
  assert.equal(first.reviewFingerprint, reviewContract.buildHumanReviewFingerprint(first));
  assert.equal(reviewContract.validateHumanReviewRecord(first).valid, true);
  assert.equal(reviewContract.determineReviewStatus(first), reviewContract.REVIEW_STATUSES.REVIEWED);
  assert.deepEqual(first.reasonCategories, ['identity_error', 'weak_evidence']);
});

test('rejects invalid review enum values, categories, and confidence', () => {
  const invalid = reviewContract.createHumanReviewRecord(fullReview({
    identityCorrect: 'mostly',
    evidenceSufficient: 'kind_of',
    wouldBuy: 'auto_buy',
    reasonCategories: ['not_a_reason'],
    disagreementCategories: ['not_a_disagreement'],
    reviewConfidence: 101
  }));

  const result = reviewContract.validateHumanReviewRecord(invalid);
  assert.equal(result.valid, false);
  assert.equal(result.failures.some((failure) => failure.code === 'invalid_enum_value' && failure.path === 'identityCorrect'), true);
  assert.equal(result.failures.some((failure) => failure.code === 'invalid_enum_value' && failure.path === 'wouldBuy'), true);
  assert.equal(result.failures.some((failure) => failure.code === 'invalid_category_value' && failure.path === 'reasonCategories'), true);
  assert.equal(result.failures.some((failure) => failure.code === 'invalid_category_value' && failure.path === 'disagreementCategories'), true);
  assert.equal(result.failures.some((failure) => failure.code === 'invalid_review_confidence'), true);
});

test('attaches review records without mutating immutable package snapshots', () => {
  const reviewPackage = reviewContract.createRealListingDecisionReviewPackage(fullInput());
  const originalFingerprint = reviewPackage.packageFingerprint;
  const reviewRecord = reviewContract.createHumanReviewRecord(fullReview());
  const reviewed = reviewContract.attachHumanReviewRecord(reviewPackage, reviewRecord);

  assert.equal(reviewPackage.reviewStatus, reviewContract.REVIEW_STATUSES.UNREVIEWED);
  assert.equal(reviewPackage.reviewRecord, undefined);
  assert.equal(reviewPackage.packageFingerprint, originalFingerprint);
  assert.equal(reviewed.reviewStatus, reviewContract.REVIEW_STATUSES.REVIEWED);
  assert.deepEqual(reviewed.reviewRecord, reviewRecord);
  assert.notEqual(reviewed.packageFingerprint, originalFingerprint);
  assert.equal(reviewed.snapshotFingerprint, reviewPackage.snapshotFingerprint);
  assert.deepEqual(reviewed.listingSnapshot, reviewPackage.listingSnapshot);
  assert.equal(reviewContract.validateRealListingDecisionReviewPackage(reviewed).valid, true);
});

test('validation returns structured failures for corrupted fingerprints and missing fields', () => {
  const reviewPackage = reviewContract.cloneRealListingDecisionReviewPackage(
    reviewContract.createRealListingDecisionReviewPackage(fullInput())
  );
  delete reviewPackage.packageId;
  reviewPackage.snapshotFingerprint = 'wrong';
  reviewPackage.packageFingerprint = 'wrong';

  const result = reviewContract.validateRealListingDecisionReviewPackage(reviewPackage);
  assert.equal(result.valid, false);
  assert.equal(result.failures.every((failure) => failure.code && failure.message), true);
  assert.equal(result.failures.some((failure) => failure.code === 'missing_required_field' && failure.path === 'packageId'), true);
  assert.equal(result.failures.some((failure) => failure.code === 'snapshot_fingerprint_mismatch'), true);
  assert.equal(result.failures.some((failure) => failure.code === 'package_fingerprint_mismatch'), true);
});

test('review status transitions remain explicit', () => {
  const reviewPackage = reviewContract.createRealListingDecisionReviewPackage(fullInput());
  const reviewRecord = reviewContract.createHumanReviewRecord(fullReview());

  assert.equal(reviewContract.determineReviewStatus({}), reviewContract.REVIEW_STATUSES.INCOMPLETE);
  assert.equal(reviewContract.determineReviewStatus(reviewPackage), reviewContract.REVIEW_STATUSES.UNREVIEWED);
  assert.equal(reviewContract.determineReviewStatus(reviewRecord), reviewContract.REVIEW_STATUSES.REVIEWED);
  assert.equal(reviewContract.determineReviewStatus(reviewContract.attachHumanReviewRecord(reviewPackage, reviewRecord)), reviewContract.REVIEW_STATUSES.REVIEWED);
});

test('contract module does not load production engines or runtime integration modules', () => {
  const loaded = new Set();
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    loaded.add(request);
    return originalLoad.apply(this, arguments);
  };

  try {
    delete require.cache[require.resolve('../validation/realListingDecisionReviewContract')];
    const fresh = require('../validation/realListingDecisionReviewContract');
    fresh.createRealListingDecisionReviewPackage(fullInput());
  } finally {
    Module._load = originalLoad;
    delete require.cache[require.resolve('../validation/realListingDecisionReviewContract')];
    require('../validation/realListingDecisionReviewContract');
  }

  assert.equal([...loaded].some((request) => request.includes('../engines/')), false);
  assert.equal([...loaded].some((request) => request.includes('server.js')), false);
  assert.equal([...loaded].some((request) => request.includes('scoutScannerService')), false);
});
