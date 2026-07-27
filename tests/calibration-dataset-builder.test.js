'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const test = require('node:test');

const calibration = require('../validation/calibrationDatasetBuilder');
const workspace = require('../validation/daltonReviewWorkspace');
const batchBuilder = require('../validation/realListingReviewBatchBuilder');
const reviewContract = require('../validation/realListingDecisionReviewContract');

function tempDir(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
}

function listingRecord(id, overrides = {}) {
  const supported = overrides.supported !== false;
  return {
    packageId: `pkg-${id}`,
    marketplace: 'ebay',
    createdAt: '2026-07-24T10:00:00.000Z',
    capturedAt: '2026-07-24T09:50:00.000Z',
    listingSnapshot: {
      ebayItemId: id,
      title: `Calibration Fixture ${id} PSA 10`,
      url: `https://example.test/calibration/${id}`,
      askingPrice: overrides.askingPrice ?? 100,
      shipping: 5,
      totalCost: (overrides.askingPrice ?? 100) + 5,
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
      canonicalIdentityKey: `ci:v1:calibration:${id}`,
      eligibility: { exactCompEligible: true, valuationEligible: true }
    },
    identityDiagnostics: {
      diagnosticStatus: overrides.identityStatus || 'exact',
      ambiguityLevel: 'none',
      fieldsConfirmed: ['subject', 'year', 'set'],
      fieldsMissing: [],
      fieldsConflicting: overrides.identityConflict ? ['subject'] : [],
      warnings: [],
      blockingIssues: []
    },
    productionValuation: {
      estimatedValue: overrides.productionValue ?? 180,
      marketValue: overrides.productionValue ?? 180,
      estimatedProfit: 30
    },
    roiData: { roi: 0.25, roiPercent: 25 },
    productionConfidence: { confidence: overrides.productionConfidence ?? 82 },
    dealGate: {
      passed: supported,
      buyNowAllowed: supported,
      decision: supported ? 'BUY_NOW' : 'REJECT',
      reasons: supported ? [] : ['fixture_rejection']
    },
    shadowSoldComparison: {
      acceptedExactMatches: [{ recordId: `${id}-sold-1` }],
      processingSummary: { exactMatchCount: 1 }
    },
    shadowValuation: {
      insufficientEvidence: false,
      recommendedMarketValue: overrides.shadowValue ?? 175,
      fairMarketRange: { expectedValue: overrides.shadowValue ?? 175 }
    },
    evidenceReadinessDiagnostics: { readinessStatus: overrides.evidenceStatus || 'ready' },
    confidenceCalibrationDiagnostics: { calibrationStatus: overrides.calibrationStatus || 'calibrated' },
    opportunityFalsePositiveDiagnostics: {
      falsePositiveRiskStatus: overrides.falsePositiveRiskStatus || 'low_risk',
      materialWarnings: overrides.falsePositiveRiskStatus ? ['fixture_warning'] : []
    },
    notificationEligibility: { eligible: supported },
    shadowRecommendationPosture: supported ? 'BUY_NOW' : 'REJECT'
  };
}

function reviewBatch(records, batchId = 'calibration-review-batch') {
  return batchBuilder.buildRealListingReviewBatch(records, {
    batchId,
    createdAt: '2026-07-24T10:05:00.000Z',
    requestedCandidateCount: records.length
  });
}

function humanReview(overrides = {}) {
  return reviewContract.createHumanReviewRecord({
    reviewer: 'Dalton',
    reviewedAt: '2026-07-24T12:00:00.000Z',
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
    reasonCategories: ['weak_evidence'],
    disagreementCategories: ['valuation_disagreement'],
    reviewConfidence: 90,
    notes: 'Calibration fixture review.',
    ...overrides
  });
}

function completedWorkspace(records, reviews, options = {}) {
  const dir = tempDir(options.name || 'calibration-workspace');
  const batch = reviewBatch(records, options.batchId || 'calibration-review-batch');
  workspace.writeDaltonReviewWorkspace(batch, dir, {
    workspaceId: options.workspaceId || `${batch.batchId}-workspace`,
    createdAt: '2026-07-24T10:10:00.000Z'
  });
  batch.packages.forEach((reviewPackage, index) => {
    workspace.attachCompletedHumanReviewRecord(dir, reviewPackage.packageId, reviews[index] || humanReview(), {
      updatedAt: '2026-07-24T12:10:00.000Z'
    });
  });
  return { dir, batch };
}

test('exports Calibration Dataset Builder public API and constants', () => {
  assert.equal(calibration.CALIBRATION_DATASET_SOURCE, 'calibration_dataset_builder');
  assert.equal(calibration.CALIBRATION_DATASET_SCHEMA_VERSION, '1.0.0');
  assert.equal(typeof calibration.buildCalibrationDataset, 'function');
  assert.equal(typeof calibration.validateCalibrationDataset, 'function');
  assert.equal(typeof calibration.mergeCalibrationDatasets, 'function');
  assert.equal(typeof calibration.filterCalibrationDataset, 'function');
  assert.equal(typeof calibration.summarizeCalibrationDataset, 'function');
  assert.equal(typeof calibration.exportCalibrationDataset, 'function');
  assert.equal(typeof calibration.importCalibrationDataset, 'function');
  assert.equal(typeof calibration.buildCalibrationDatasetFingerprint, 'function');
});

test('builds a minimum deterministic dataset from a completed Dalton workspace', () => {
  const { dir } = completedWorkspace([listingRecord('1001')], [humanReview()], {
    workspaceId: 'minimum-calibration-workspace'
  });
  const dataset = calibration.buildCalibrationDataset(dir, {
    datasetId: 'minimum-calibration-dataset',
    createdAt: '2026-07-24T13:00:00.000Z'
  });

  assert.equal(dataset.datasetId, 'minimum-calibration-dataset');
  assert.equal(dataset.reviewCount, 1);
  assert.equal(dataset.listingCount, 1);
  assert.equal(dataset.productionImpact, 'none');
  assert.equal(dataset.decisionImpact, 'none');
  assert.equal(dataset.records[0].productionImpact, 'none');
  assert.equal(dataset.records[0].decisionImpact, 'none');
  assert.deepEqual(dataset.records[0].productionOutputs.valuation, { estimatedValue: 180, marketValue: 180, estimatedProfit: 30 });
  assert.equal(dataset.datasetFingerprint, calibration.buildCalibrationDatasetFingerprint(dataset));
  assert.equal(calibration.validateCalibrationDataset(dataset).valid, true);
});

test('combines multiple workspaces in stable order without mutating inputs', () => {
  const first = completedWorkspace([listingRecord('2002')], [humanReview({ reviewedAt: '2026-07-24T12:00:00.000Z' })], {
    workspaceId: 'workspace-b',
    batchId: 'batch-b'
  });
  const second = completedWorkspace([listingRecord('1001')], [humanReview({ reviewedAt: '2026-07-24T12:05:00.000Z', wouldBuy: 'monitor' })], {
    workspaceId: 'workspace-a',
    batchId: 'batch-a'
  });
  const loadedBefore = workspace.loadDaltonReviewWorkspace(first.dir);
  const dataset = calibration.buildCalibrationDataset([first.dir, second.dir], {
    datasetId: 'multi-workspace-dataset',
    createdAt: '2026-07-24T13:00:00.000Z'
  });

  assert.deepEqual(dataset.sourceBatchIds, ['batch-a', 'batch-b']);
  assert.deepEqual(dataset.records.map((record) => record.listingId), ['1001', '2002']);
  assert.equal(dataset.agreementMetrics.wouldBuy.monitor, 1);
  assert.deepEqual(workspace.loadDaltonReviewWorkspace(first.dir).workspace, loadedBefore.workspace);
});

test('tracks duplicate listings, duplicate reviews, and duplicate fingerprints during validation', () => {
  const { dir } = completedWorkspace([listingRecord('dup')], [humanReview()], {
    workspaceId: 'duplicate-workspace'
  });
  const dataset = calibration.buildCalibrationDataset(dir, {
    datasetId: 'duplicate-dataset',
    createdAt: '2026-07-24T13:00:00.000Z'
  });
  const duplicateRecord = JSON.parse(JSON.stringify(dataset.records[0]));
  const invalid = {
    ...dataset,
    reviewCount: 2,
    records: [dataset.records[0], duplicateRecord],
    datasetFingerprint: undefined
  };
  invalid.datasetFingerprint = calibration.buildCalibrationDatasetFingerprint(invalid);
  const validation = calibration.validateCalibrationDataset(invalid);

  assert.equal(validation.valid, false);
  assert.deepEqual(validation.duplicateListings, ['dup']);
  assert.deepEqual(validation.duplicateReviews, [dataset.records[0].reviewFingerprint]);
  assert.deepEqual(validation.duplicateFingerprints, [dataset.records[0].recordFingerprint]);
});

test('merges datasets by retained record fingerprint', () => {
  const { dir } = completedWorkspace([listingRecord('merge')], [humanReview()], {
    workspaceId: 'merge-workspace'
  });
  const first = calibration.buildCalibrationDataset(dir, {
    datasetId: 'merge-a',
    createdAt: '2026-07-24T13:00:00.000Z'
  });
  const second = calibration.buildCalibrationDataset(dir, {
    datasetId: 'merge-b',
    createdAt: '2026-07-24T13:00:00.000Z'
  });
  const merged = calibration.mergeCalibrationDatasets([first, second], {
    datasetId: 'merged',
    createdAt: '2026-07-24T14:00:00.000Z'
  });

  assert.equal(merged.reviewCount, 1);
  assert.equal(merged.listingCount, 1);
  assert.deepEqual(merged.validationMetadata.mergedDatasetIds, ['merge-a', 'merge-b']);
  assert.equal(calibration.validateCalibrationDataset(merged).valid, true);
});

test('filters datasets deterministically by review evidence fields', () => {
  const { dir } = completedWorkspace([
    listingRecord('keep'),
    listingRecord('drop')
  ], [
    humanReview({ wouldBuy: 'monitor', shadowBetter: 'yes', reasonCategories: ['identity_error'] }),
    humanReview({ wouldBuy: 'yes', shadowBetter: 'no', reasonCategories: ['weak_evidence'] })
  ], { workspaceId: 'filter-workspace' });
  const dataset = calibration.buildCalibrationDataset(dir, {
    datasetId: 'filter-dataset',
    createdAt: '2026-07-24T13:00:00.000Z'
  });
  const filtered = calibration.filterCalibrationDataset(dataset, { wouldBuy: 'yes', reasonCategory: 'weak_evidence' }, {
    datasetId: 'filtered-dataset',
    createdAt: '2026-07-24T14:00:00.000Z'
  });

  assert.equal(filtered.reviewCount, 1);
  assert.equal(filtered.records[0].listingId, 'keep');
  assert.equal(filtered.validationMetadata.filters.wouldBuy, 'yes');
  assert.equal(calibration.validateCalibrationDataset(filtered).valid, true);
});

test('exports and imports calibration datasets without changing JSON shape', () => {
  const { dir } = completedWorkspace([listingRecord('export')], [humanReview()], {
    workspaceId: 'export-workspace'
  });
  const dataset = calibration.buildCalibrationDataset(dir, {
    datasetId: 'export-dataset',
    createdAt: '2026-07-24T13:00:00.000Z'
  });
  const serialized = calibration.exportCalibrationDataset(dataset);
  const imported = calibration.importCalibrationDataset(serialized);
  const output = path.join(tempDir('calibration-export'), 'dataset.json');
  const written = calibration.exportCalibrationDataset(dataset, output);

  assert.equal(serialized.endsWith('\n'), true);
  assert.deepEqual(imported.dataset, dataset);
  assert.equal(imported.validation.valid, true);
  assert.deepEqual(written, dataset);
  assert.deepEqual(JSON.parse(fs.readFileSync(output, 'utf8')), dataset);
});

test('validation reports missing fields, invalid records, and missing review data', () => {
  const validation = calibration.validateCalibrationDataset({
    schemaVersion: 'wrong',
    source: calibration.CALIBRATION_DATASET_SOURCE,
    datasetId: 'invalid',
    createdAt: '2026-07-24T13:00:00.000Z',
    sourceWorkspaces: [],
    sourceBatchIds: [],
    reviewCount: 1,
    listingCount: 1,
    categoryBreakdown: {},
    confidenceBreakdown: {},
    agreementMetrics: {},
    disagreementMetrics: {},
    calibrationCandidates: [],
    records: [{ recordId: 'broken' }],
    productionImpact: 'none',
    decisionImpact: 'none',
    validationMetadata: { missingReviewData: ['pkg-missing'] },
    datasetFingerprint: 'bad'
  });

  assert.equal(validation.valid, false);
  assert.equal(validation.errors.some((error) => error.code === 'invalid_schema_version'), true);
  assert.equal(validation.invalidRecords.length, 1);
  assert.deepEqual(validation.missingReviewData, ['broken', 'pkg-missing']);
});

test('build records preserve immutable snapshots and Dalton review without recomputing fields', () => {
  const sourceRecord = listingRecord('immutable', {
    productionValue: 222,
    shadowValue: 111,
    productionConfidence: 61
  });
  const review = humanReview({
    valuationReasonable: 'no',
    confidenceAppropriate: 'overconfident',
    productionCorrect: 'no',
    shadowBetter: 'yes',
    reviewConfidence: 77
  });
  const { dir } = completedWorkspace([sourceRecord], [review], {
    workspaceId: 'immutable-workspace'
  });
  const before = workspace.loadDaltonReviewWorkspace(dir);
  const dataset = calibration.buildCalibrationDataset(dir, {
    datasetId: 'immutable-dataset',
    createdAt: '2026-07-24T13:00:00.000Z'
  });

  assert.equal(dataset.records[0].productionOutputs.estimatedValue, 222);
  assert.equal(dataset.records[0].shadowOutputs.shadowValuation.recommendedMarketValue, 111);
  assert.equal(dataset.records[0].daltonReview.reviewFingerprint, review.reviewFingerprint);
  assert.equal(dataset.records[0].reviewMetadata.reviewConfidence, 77);
  assert.deepEqual(workspace.loadDaltonReviewWorkspace(dir).packages, before.packages);
});

test('summary returns aggregate evidence-only metrics', () => {
  const { dir } = completedWorkspace([listingRecord('summary')], [humanReview({
    productionCorrect: 'partial',
    shadowBetter: 'partial',
    reasonCategories: ['valuation_too_high'],
    disagreementCategories: ['confidence_disagreement']
  })], { workspaceId: 'summary-workspace' });
  const dataset = calibration.buildCalibrationDataset(dir, {
    datasetId: 'summary-dataset',
    createdAt: '2026-07-24T13:00:00.000Z'
  });
  const summary = calibration.summarizeCalibrationDataset(dataset);

  assert.equal(summary.datasetId, 'summary-dataset');
  assert.equal(summary.reviewCount, 1);
  assert.equal(summary.categoryBreakdown.reasonCategories.valuation_too_high, 1);
  assert.equal(summary.agreementMetrics.productionCorrect.partial, 1);
  assert.equal(summary.productionImpact, 'none');
  assert.equal(summary.decisionImpact, 'none');
});

test('module does not import production runtime or engine modules', () => {
  const originalLoad = Module._load;
  const loaded = [];
  Module._load = function patchedLoad(request, parent, isMain) {
    loaded.push(request);
    if (request.includes('server') || request.includes('scoutScanner') || request.includes('../engines/') || request.startsWith('../engines')) {
      throw new Error(`Unexpected production import: ${request}`);
    }
    return originalLoad.apply(this, arguments);
  };
  try {
    delete require.cache[require.resolve('../validation/calibrationDatasetBuilder')];
    const fresh = require('../validation/calibrationDatasetBuilder');
    assert.equal(typeof fresh.buildCalibrationDataset, 'function');
  } finally {
    Module._load = originalLoad;
    delete require.cache[require.resolve('../validation/calibrationDatasetBuilder')];
    require('../validation/calibrationDatasetBuilder');
  }
  assert.equal(loaded.some((request) => request.includes('server')), false);
});
