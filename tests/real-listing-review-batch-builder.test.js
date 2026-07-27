'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const batchBuilder = require('../validation/realListingReviewBatchBuilder');
const reviewContract = require('../validation/realListingDecisionReviewContract');

function listingRecord(id, overrides = {}) {
  const supported = overrides.supported !== false;
  const productionValue = overrides.productionValue ?? 200;
  const shadowValue = overrides.shadowValue ?? 200;
  return {
    packageId: `pkg-${id}`,
    marketplace: 'ebay',
    createdAt: '2026-07-21T10:00:00.000Z',
    capturedAt: '2026-07-21T09:55:00.000Z',
    listingSnapshot: {
      ebayItemId: id,
      title: `2020 Panini Prizm Fixture ${id} PSA 10`,
      url: `https://example.test/item/${id}`,
      askingPrice: 120,
      shipping: 5,
      totalCost: 125,
      marketplace: 'ebay',
      parsed: {
        player: `Fixture ${id}`,
        year: '2020',
        setName: 'Prizm',
        cardNumber: id,
        gradeCompany: 'PSA',
        grade: 10
      }
    },
    canonicalIdentity: {
      canonicalIdentityKey: `ci:v1:test:${id}`,
      eligibility: { exactCompEligible: true, valuationEligible: true },
      overallIdentityConfidence: 95
    },
    identityDiagnostics: {
      diagnosticStatus: overrides.identityStatus || 'exact',
      ambiguityLevel: 'none',
      fieldsConfirmed: ['subject', 'year'],
      fieldsMissing: [],
      fieldsConflicting: overrides.identityConflict ? ['subject'] : [],
      warnings: [],
      blockingIssues: []
    },
    productionValuation: {
      estimatedValue: productionValue,
      marketValue: productionValue,
      estimatedProfit: 35
    },
    dealGate: {
      passed: supported,
      buyNowAllowed: supported,
      decision: supported ? 'BUY_NOW' : 'REJECT',
      reasons: supported ? [] : ['fixture rejection']
    },
    canonicalSoldEvidence: {
      trueSoldCount: overrides.trueSoldCount ?? 5,
      recentSoldCount: overrides.trueSoldCount ?? 5,
      records: Array.from({ length: overrides.trueSoldCount ?? 5 }, (_, index) => ({
        recordId: `${id}-sold-${index + 1}`,
        evidenceType: 'true_sold'
      }))
    },
    shadowSoldComparison: {
      acceptedExactMatches: Array.from({ length: overrides.trueSoldCount ?? 5 }, (_, index) => ({ recordId: `${id}-sold-${index + 1}` })),
      processingSummary: { exactMatchCount: overrides.trueSoldCount ?? 5 }
    },
    shadowValuation: {
      insufficientEvidence: overrides.shadowInsufficient === true,
      recommendedMarketValue: overrides.shadowInsufficient === true ? null : shadowValue,
      fairMarketRange: { expectedValue: shadowValue },
      evidenceSummary: { exactMatchCount: overrides.trueSoldCount ?? 5 }
    },
    evidenceReadinessDiagnostics: {
      readinessStatus: overrides.evidenceStatus || 'ready'
    },
    confidenceCalibrationDiagnostics: {
      calibrationStatus: overrides.confidenceStatus || 'calibrated'
    },
    opportunityFalsePositiveDiagnostics: {
      falsePositiveRiskStatus: overrides.falsePositiveStatus || 'low_risk',
      materialWarnings: overrides.falsePositiveStatus ? ['fixture_warning'] : []
    },
    notificationEligibility: {
      eligible: supported
    },
    shadowRecommendationPosture: overrides.shadowPosture || (supported ? 'BUY_NOW' : 'REJECT'),
    ...overrides.extra
  };
}

test('exports Real Listing Review Batch public API and constants', () => {
  assert.equal(batchBuilder.REAL_LISTING_REVIEW_BATCH_SOURCE, 'real_listing_review_batch_builder');
  assert.equal(batchBuilder.REAL_LISTING_REVIEW_BATCH_SCHEMA_VERSION, '1.0.0');
  assert.equal(typeof batchBuilder.selectReviewCandidates, 'function');
  assert.equal(typeof batchBuilder.buildReviewPackageForCandidate, 'function');
  assert.equal(typeof batchBuilder.buildRealListingReviewBatch, 'function');
  assert.equal(typeof batchBuilder.validateRealListingReviewBatch, 'function');
  assert.equal(typeof batchBuilder.summarizeBatchComposition, 'function');
  assert.equal(typeof batchBuilder.exportRealListingReviewBatch, 'function');
  assert.equal(typeof batchBuilder.importRealListingReviewBatch, 'function');
  assert.equal(typeof batchBuilder.filterReviewPackages, 'function');
});

test('builds and validates a minimum review batch', () => {
  const batch = batchBuilder.buildRealListingReviewBatch([
    listingRecord('1001')
  ], {
    batchId: 'minimum-review-batch',
    createdAt: '2026-07-21T10:00:00.000Z',
    requestedCandidateCount: 1
  });

  assert.equal(batch.schemaVersion, batchBuilder.REAL_LISTING_REVIEW_BATCH_SCHEMA_VERSION);
  assert.equal(batch.batchId, 'minimum-review-batch');
  assert.equal(batch.source, batchBuilder.REAL_LISTING_REVIEW_BATCH_SOURCE);
  assert.equal(batch.selectedCandidateCount, 1);
  assert.equal(batch.packageCount, 1);
  assert.equal(batch.productionImpact, 'none');
  assert.equal(batch.decisionImpact, 'none');
  assert.equal(batch.packages[0].reviewBatchId, 'minimum-review-batch');
  assert.equal(batch.batchFingerprint, batchBuilder.buildReviewBatchFingerprint(batch));
  assert.equal(batchBuilder.validateRealListingReviewBatch(batch).valid, true);
});

test('builds a full deterministic multi-package batch ordered by learning value', () => {
  const records = [
    listingRecord('low', { trueSoldCount: 5 }),
    listingRecord('false-positive', { falsePositiveStatus: 'likely_false_positive' }),
    listingRecord('valuation', { productionValue: 100, shadowValue: 160 }),
    listingRecord('identity', { identityConflict: true })
  ];
  const options = {
    batchId: 'full-review-batch',
    createdAt: '2026-07-21T10:00:00.000Z',
    requestedCandidateCount: 4
  };
  const first = batchBuilder.buildRealListingReviewBatch(records, options);
  const second = batchBuilder.buildRealListingReviewBatch(records, options);

  assert.deepEqual(first, second);
  assert.equal(first.packageCount, 4);
  assert.equal(first.candidateCategorySummary.possible_false_positive, 1);
  assert.equal(first.candidateCategorySummary.valuation_conflict, 1);
  assert.equal(first.candidateCategorySummary.identity_conflict, 1);
  assert.equal(first.reviewStatusSummary.unreviewed, 4);
  assert.equal(first.batchFingerprint, second.batchFingerprint);
});

test('candidate selection is deterministic and prioritizes learning value rather than price', () => {
  const records = [
    listingRecord('expensive-baseline', { extra: { listingSnapshot: { ebayItemId: 'expensive-baseline', title: 'Expensive baseline', totalCost: 10000 } } }),
    listingRecord('cheap-conflict', { productionValue: 80, shadowValue: 140, extra: { listingSnapshot: { ebayItemId: 'cheap-conflict', title: 'Cheap conflict', totalCost: 10 } } })
  ];
  const selected = batchBuilder.selectReviewCandidates(records, { requestedCandidateCount: 1 });

  assert.equal(selected.length, 1);
  assert.equal(selected[0].candidate.listingId, 'cheap-conflict');
  assert.equal(selected[0].candidate.candidateCategories.includes('valuation_conflict'), true);
});

test('explicit timestamps keep package and batch fingerprints stable', () => {
  const input = [listingRecord('stable')];
  const options = {
    batchId: 'stable-batch',
    createdAt: '2026-07-21T10:00:00.000Z',
    requestedCandidateCount: 1
  };
  const first = batchBuilder.buildRealListingReviewBatch(input, options);
  const second = batchBuilder.buildRealListingReviewBatch(input, options);

  assert.equal(first.packages[0].packageFingerprint, second.packages[0].packageFingerprint);
  assert.equal(first.packages[0].snapshotFingerprint, second.packages[0].snapshotFingerprint);
  assert.equal(first.batchFingerprint, second.batchFingerprint);
});

test('missing optional diagnostics remain explicit and unsupported categories are not invented', () => {
  const batch = batchBuilder.buildRealListingReviewBatch([
    {
      packageId: 'missing-diagnostics',
      marketplace: 'ebay',
      createdAt: '2026-07-21T10:00:00.000Z',
      capturedAt: '2026-07-21T09:55:00.000Z',
      listingSnapshot: {
        ebayItemId: 'missing-diagnostics',
        title: 'Missing diagnostics'
      },
      candidateCategories: ['unsupported_category']
    }
  ], {
    batchId: 'missing-diagnostics-batch',
    createdAt: '2026-07-21T10:00:00.000Z',
    requestedCandidateCount: 1
  });

  assert.equal(batch.packages[0].identitySnapshot.diagnosticStatus, 'unknown');
  assert.equal(batch.candidateCategorySummary.unsupported_category, undefined);
  assert.equal(batch.candidateCategorySummary.learning_opportunity, 1);
});

test('validation detects duplicate package IDs and duplicate snapshot fingerprints', () => {
  const packageA = reviewContract.createRealListingDecisionReviewPackage(listingRecord('dup'), {
    packageId: 'duplicate-package',
    reviewBatchId: 'duplicate-batch',
    createdAt: '2026-07-21T10:00:00.000Z'
  });
  const packageB = reviewContract.createRealListingDecisionReviewPackage(listingRecord('dup'), {
    packageId: 'duplicate-package',
    reviewBatchId: 'duplicate-batch',
    createdAt: '2026-07-21T10:00:00.000Z'
  });
  const batch = batchBuilder.buildRealListingReviewBatch([], {
    packages: [packageA, packageB],
    batchId: 'duplicate-batch',
    createdAt: '2026-07-21T10:00:00.000Z',
    requestedCandidateCount: 2
  });

  const validation = batchBuilder.validateRealListingReviewBatch(batch);
  assert.equal(validation.valid, false);
  assert.deepEqual(validation.duplicatePackageIds, ['duplicate-package']);
  assert.deepEqual(validation.duplicateSnapshotFingerprints, [packageA.snapshotFingerprint]);
  assert.equal(validation.reasonCodes.includes('duplicate_package_ids'), true);
  assert.equal(validation.reasonCodes.includes('duplicate_snapshot_fingerprints'), true);
});

test('validation reports invalid packages with structured failures and indexes', () => {
  const batch = batchBuilder.buildRealListingReviewBatch([listingRecord('invalid')], {
    batchId: 'invalid-batch',
    createdAt: '2026-07-21T10:00:00.000Z',
    requestedCandidateCount: 1
  });
  const mutable = JSON.parse(JSON.stringify(batch));
  mutable.packages[0].productionImpact = 'changed';
  mutable.packages[0].packageFingerprint = 'wrong';
  mutable.batchFingerprint = batchBuilder.buildReviewBatchFingerprint(mutable);

  const validation = batchBuilder.validateRealListingReviewBatch(mutable);
  assert.equal(validation.valid, false);
  assert.deepEqual(validation.invalidPackageIndexes, [0]);
  assert.equal(validation.errors.some((error) => error.path.startsWith('packages.0.')), true);
  assert.equal(validation.reasonCodes.includes('invalid_production_impact'), true);
});

test('filters packages by review status and candidate category', () => {
  const batch = batchBuilder.buildRealListingReviewBatch([
    listingRecord('buy-now'),
    listingRecord('valuation-filter', {
      supported: false,
      productionValue: 100,
      shadowValue: 150,
      shadowPosture: 'supported'
    })
  ], {
    batchId: 'filter-batch',
    createdAt: '2026-07-21T10:00:00.000Z',
    requestedCandidateCount: 2
  });

  assert.equal(batchBuilder.filterReviewPackages(batch, { reviewStatus: 'unreviewed' }).length, 2);
  assert.equal(batchBuilder.filterReviewPackages(batch, { candidateCategory: 'valuation_conflict' }).length, 1);
  assert.equal(batchBuilder.filterReviewPackages(batch.packages, { candidateCategory: 'buy_now_candidate' }).length, 1);
});

test('export and import preserve package structure and fingerprints', () => {
  const batch = batchBuilder.buildRealListingReviewBatch([listingRecord('round-trip')], {
    batchId: 'round-trip-batch',
    createdAt: '2026-07-21T10:00:00.000Z',
    requestedCandidateCount: 1
  });
  const exported = batchBuilder.exportRealListingReviewBatch(batch);
  const imported = batchBuilder.importRealListingReviewBatch(exported);

  assert.deepEqual(imported.batch, batch);
  assert.equal(imported.validation.valid, true);
  assert.equal(imported.batch.batchFingerprint, batch.batchFingerprint);
  assert.equal(imported.batch.packages[0].packageFingerprint, batch.packages[0].packageFingerprint);
});

test('source records are not mutated and generated packages are immutable', () => {
  const records = [listingRecord('immutable')];
  const before = JSON.parse(JSON.stringify(records));
  const batch = batchBuilder.buildRealListingReviewBatch(records, {
    batchId: 'immutable-batch',
    createdAt: '2026-07-21T10:00:00.000Z',
    requestedCandidateCount: 1
  });

  assert.deepEqual(records, before);
  assert.equal(Object.isFrozen(batch), true);
  assert.equal(Object.isFrozen(batch.packages[0]), true);
  assert.throws(() => {
    batch.packages[0].reviewStatus = 'reviewed';
  }, TypeError);
});

test('batch and packages enforce evidence-only production and decision boundaries', () => {
  const batch = batchBuilder.buildRealListingReviewBatch([listingRecord('boundary')], {
    batchId: 'boundary-batch',
    createdAt: '2026-07-21T10:00:00.000Z',
    requestedCandidateCount: 1
  });
  const mutable = JSON.parse(JSON.stringify(batch));
  mutable.productionImpact = 'changed';
  mutable.decisionImpact = 'changed';
  mutable.batchFingerprint = batchBuilder.buildReviewBatchFingerprint(mutable);

  const validation = batchBuilder.validateRealListingReviewBatch(mutable);
  assert.equal(batch.productionImpact, 'none');
  assert.equal(batch.decisionImpact, 'none');
  assert.equal(batch.packages[0].productionImpact, 'none');
  assert.equal(batch.packages[0].decisionImpact, 'none');
  assert.equal(validation.valid, false);
  assert.equal(validation.reasonCodes.includes('invalid_production_impact'), true);
  assert.equal(validation.reasonCodes.includes('invalid_decision_impact'), true);
});

test('batch builder does not load production engines or runtime modules', () => {
  const loaded = new Set();
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    loaded.add(request);
    return originalLoad.apply(this, arguments);
  };

  try {
    delete require.cache[require.resolve('../validation/realListingReviewBatchBuilder')];
    const fresh = require('../validation/realListingReviewBatchBuilder');
    fresh.buildRealListingReviewBatch([listingRecord('load-check')], {
      batchId: 'load-check-batch',
      createdAt: '2026-07-21T10:00:00.000Z',
      requestedCandidateCount: 1
    });
  } finally {
    Module._load = originalLoad;
    delete require.cache[require.resolve('../validation/realListingReviewBatchBuilder')];
    require('../validation/realListingReviewBatchBuilder');
  }

  assert.equal([...loaded].some((request) => request.includes('server.js')), false);
  assert.equal([...loaded].some((request) => request.includes('scoutScannerService')), false);
  assert.equal([...loaded].some((request) => request.includes('../engines/')), false);
});
