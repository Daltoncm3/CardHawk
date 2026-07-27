'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const test = require('node:test');

const workspace = require('../validation/daltonReviewWorkspace');
const batchBuilder = require('../validation/realListingReviewBatchBuilder');
const reviewContract = require('../validation/realListingDecisionReviewContract');

function tempWorkspace(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
}

function listingRecord(id, overrides = {}) {
  const supported = overrides.supported !== false;
  const productionValue = overrides.productionValue ?? 200;
  const shadowValue = overrides.shadowValue ?? 200;
  return {
    packageId: `pkg-${id}`,
    marketplace: 'ebay',
    createdAt: '2026-07-22T10:00:00.000Z',
    capturedAt: '2026-07-22T09:55:00.000Z',
    listingSnapshot: {
      ebayItemId: id,
      title: `2020 Panini Prizm Review Fixture ${id} PSA 10`,
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
      warnings: overrides.identityWarning ? ['fixture_identity_warning'] : [],
      blockingIssues: []
    },
    productionValuation: {
      estimatedValue: productionValue,
      marketValue: productionValue,
      estimatedProfit: 35
    },
    roiData: { roi: 0.28, roiPercent: 28 },
    productionConfidence: { confidence: 82 },
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

function reviewBatch(records = [listingRecord('1001')], overrides = {}) {
  return batchBuilder.buildRealListingReviewBatch(records, {
    batchId: overrides.batchId || 'dalton-review-batch',
    createdAt: overrides.createdAt || '2026-07-22T10:00:00.000Z',
    requestedCandidateCount: overrides.requestedCandidateCount || records.length
  });
}

function humanReview(overrides = {}) {
  return reviewContract.createHumanReviewRecord({
    reviewer: 'Dalton',
    reviewedAt: '2026-07-22T12:00:00.000Z',
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
    reviewConfidence: 88,
    notes: 'Fixture review.',
    ...overrides
  });
}

test('exports Dalton Review Workspace public API and constants', () => {
  assert.equal(workspace.DALTON_REVIEW_WORKSPACE_SOURCE, 'dalton_review_workspace');
  assert.equal(workspace.DALTON_REVIEW_WORKSPACE_SCHEMA_VERSION, '1.0.0');
  assert.equal(typeof workspace.buildDaltonReviewWorkspace, 'function');
  assert.equal(typeof workspace.validateDaltonReviewWorkspace, 'function');
  assert.equal(typeof workspace.writeDaltonReviewWorkspace, 'function');
  assert.equal(typeof workspace.loadDaltonReviewWorkspace, 'function');
  assert.equal(typeof workspace.generateMarkdownSummary, 'function');
  assert.equal(typeof workspace.generateReviewForm, 'function');
  assert.equal(typeof workspace.resumeDaltonReviewWorkspace, 'function');
  assert.equal(typeof workspace.attachCompletedHumanReviewRecord, 'function');
  assert.equal(typeof workspace.exportCompletedReviewedBatch, 'function');
});

test('builds a minimum valid workspace manifest without mutating source batch', () => {
  const batch = reviewBatch();
  const before = JSON.parse(JSON.stringify(batch));
  const manifest = workspace.buildDaltonReviewWorkspace(batch, {
    workspaceId: 'minimum-workspace',
    createdAt: '2026-07-22T10:05:00.000Z'
  });

  assert.equal(manifest.workspaceId, 'minimum-workspace');
  assert.equal(manifest.batchId, batch.batchId);
  assert.equal(manifest.packageCount, 1);
  assert.equal(manifest.reviewedCount, 0);
  assert.equal(manifest.pendingCount, 1);
  assert.equal(manifest.completionRate, 0);
  assert.equal(manifest.productionImpact, 'none');
  assert.equal(manifest.decisionImpact, 'none');
  assert.equal(manifest.workspaceFingerprint, workspace.buildWorkspaceFingerprint(manifest));
  assert.deepEqual(batch, before);
});

test('writes deterministic full workspace folder and validates file manifest', () => {
  const dir = tempWorkspace('dalton-full');
  const batch = reviewBatch([
    listingRecord('1001'),
    listingRecord('valuation', { productionValue: 100, shadowValue: 160 })
  ], { batchId: 'full-workspace-batch', requestedCandidateCount: 2 });
  const first = workspace.writeDaltonReviewWorkspace(batch, dir, {
    workspaceId: 'full-workspace',
    createdAt: '2026-07-22T10:05:00.000Z'
  });
  const loaded = workspace.loadDaltonReviewWorkspace(dir);

  assert.equal(fs.existsSync(path.join(dir, 'workspace.json')), true);
  assert.equal(fs.existsSync(path.join(dir, 'batch.json')), true);
  assert.equal(fs.existsSync(path.join(dir, 'README.md')), true);
  assert.equal(fs.existsSync(path.join(dir, 'batch-summary.md')), true);
  assert.equal(fs.existsSync(path.join(dir, 'progress.json')), true);
  assert.equal(fs.existsSync(path.join(dir, 'packages', `${first.packageReferences[0].packageId}.json`)), true);
  assert.equal(fs.existsSync(path.join(dir, 'summaries', `${first.packageReferences[0].packageId}.md`)), true);
  assert.equal(loaded.validation.valid, true);
  assert.equal(loaded.workspace.workspaceFingerprint, first.workspaceFingerprint);
  assert.equal(loaded.packages.length, 2);
});

test('workspace fingerprints and generated folder paths are deterministic', () => {
  const batch = reviewBatch([listingRecord('stable')], { batchId: 'stable-workspace-batch' });
  const first = workspace.buildDaltonReviewWorkspace(batch, {
    workspaceId: 'stable-workspace',
    createdAt: '2026-07-22T10:05:00.000Z'
  });
  const second = workspace.buildDaltonReviewWorkspace(batch, {
    workspaceId: 'stable-workspace',
    createdAt: '2026-07-22T10:05:00.000Z'
  });

  assert.deepEqual(first, second);
  assert.equal(first.fileManifest.packages[0].path, 'packages/pkg-stable.json');
  assert.equal(first.fileManifest.reviews[0].reviewPath, 'reviews/pkg-stable.review.json');
  assert.equal(first.fileManifest.summaries[0].path, 'summaries/pkg-stable.md');
});

test('generates human-friendly Markdown with explicit unknown values', () => {
  const batch = reviewBatch([{
    packageId: 'pkg-unknown',
    marketplace: 'ebay',
    createdAt: '2026-07-22T10:00:00.000Z',
    capturedAt: '2026-07-22T09:55:00.000Z',
    listingSnapshot: {
      ebayItemId: 'unknown',
      title: 'Unknown workspace fixture'
    }
  }]);
  const reviewPackage = batch.packages[0];
  const form = workspace.generateReviewForm(reviewPackage);
  const summary = workspace.generateMarkdownSummary(workspace.buildDaltonReviewWorkspace(batch), batch);

  assert.match(form, /Unknown workspace fixture/);
  assert.match(form, /Estimated value: unknown/);
  assert.match(form, /identityCorrect:/);
  assert.match(summary, /Dalton Review Workspace/);
});

test('reconstructs progress and resumes an interrupted session', () => {
  const dir = tempWorkspace('dalton-resume');
  const batch = reviewBatch([
    listingRecord('one'),
    listingRecord('two')
  ], { batchId: 'resume-batch', requestedCandidateCount: 2 });
  workspace.writeDaltonReviewWorkspace(batch, dir, {
    workspaceId: 'resume-workspace',
    createdAt: '2026-07-22T10:05:00.000Z'
  });
  workspace.attachCompletedHumanReviewRecord(dir, 'pkg-one', humanReview(), {
    updatedAt: '2026-07-22T12:00:00.000Z'
  });

  const resumed = workspace.resumeDaltonReviewWorkspace(dir);
  assert.equal(resumed.progress.reviewedPackages, 1);
  assert.equal(resumed.progress.pendingPackages, 1);
  assert.deepEqual(resumed.reviewedPackageIds, ['pkg-one']);
  assert.deepEqual(resumed.pendingPackageIds, ['pkg-two']);
  assert.equal(resumed.nextRecommendedPackageId, 'pkg-two');
  assert.equal(resumed.status, 'in_progress');
});

test('attaches valid reviews separately without mutating package snapshots', () => {
  const dir = tempWorkspace('dalton-attach');
  const batch = reviewBatch([listingRecord('attach')], { batchId: 'attach-batch' });
  workspace.writeDaltonReviewWorkspace(batch, dir, {
    workspaceId: 'attach-workspace',
    createdAt: '2026-07-22T10:05:00.000Z'
  });
  const packageBefore = JSON.parse(fs.readFileSync(path.join(dir, 'packages', 'pkg-attach.json'), 'utf8'));
  const result = workspace.attachCompletedHumanReviewRecord(dir, 'pkg-attach', humanReview(), {
    updatedAt: '2026-07-22T12:00:00.000Z'
  });
  const packageAfter = JSON.parse(fs.readFileSync(path.join(dir, 'packages', 'pkg-attach.json'), 'utf8'));
  const loaded = workspace.loadDaltonReviewWorkspace(dir);

  assert.equal(fs.existsSync(result.reviewPath), true);
  assert.deepEqual(packageAfter, packageBefore);
  assert.equal(result.reviewedPackage.reviewStatus, 'reviewed');
  assert.equal(loaded.validation.valid, true);
  assert.equal(loaded.progress.reviewedPackages, 1);
});

test('rejects invalid reviews and protects against conflicting review records', () => {
  const dir = tempWorkspace('dalton-conflict');
  const batch = reviewBatch([listingRecord('conflict')], { batchId: 'conflict-batch' });
  workspace.writeDaltonReviewWorkspace(batch, dir, {
    workspaceId: 'conflict-workspace',
    createdAt: '2026-07-22T10:05:00.000Z'
  });
  const invalid = reviewContract.createHumanReviewRecord(humanReview({ wouldBuy: 'auto_buy' }));

  assert.throws(() => workspace.attachCompletedHumanReviewRecord(dir, 'pkg-conflict', invalid), /Invalid human review record/);
  workspace.attachCompletedHumanReviewRecord(dir, 'pkg-conflict', humanReview({ notes: 'First review.' }));
  assert.throws(() => workspace.attachCompletedHumanReviewRecord(dir, 'pkg-conflict', humanReview({ notes: 'Different review.' })), /Conflicting review record/);
});

test('detects missing package and derived files, then regenerates missing derived summaries', () => {
  const dir = tempWorkspace('dalton-missing');
  const batch = reviewBatch([listingRecord('missing')], { batchId: 'missing-batch' });
  workspace.writeDaltonReviewWorkspace(batch, dir, {
    workspaceId: 'missing-workspace',
    createdAt: '2026-07-22T10:05:00.000Z'
  });
  fs.unlinkSync(path.join(dir, 'summaries', 'pkg-missing.md'));
  let validation = workspace.validateDaltonReviewWorkspace(dir);
  assert.equal(validation.valid, false);
  assert.equal(validation.missingFiles.includes('summaries/pkg-missing.md'), true);

  workspace.rebuildWorkspaceSummaries(dir);
  validation = workspace.validateDaltonReviewWorkspace(dir);
  assert.equal(validation.valid, true);

  fs.unlinkSync(path.join(dir, 'packages', 'pkg-missing.json'));
  validation = workspace.validateDaltonReviewWorkspace(dir);
  assert.equal(validation.valid, false);
  assert.equal(validation.missingFiles.includes('packages/pkg-missing.json'), true);
});

test('detects tampered package files, mismatched fingerprints, duplicate reviews, and unexpected files', () => {
  const dir = tempWorkspace('dalton-tamper');
  const batch = reviewBatch([listingRecord('tamper')], { batchId: 'tamper-batch' });
  workspace.writeDaltonReviewWorkspace(batch, dir, {
    workspaceId: 'tamper-workspace',
    createdAt: '2026-07-22T10:05:00.000Z'
  });
  workspace.attachCompletedHumanReviewRecord(dir, 'pkg-tamper', humanReview());
  fs.writeFileSync(path.join(dir, 'reviews', 'duplicate.review.json'), JSON.stringify({
    packageId: 'pkg-tamper',
    reviewRecord: humanReview({ notes: 'duplicate' })
  }, null, 2));
  fs.writeFileSync(path.join(dir, 'unexpected.txt'), 'unexpected');
  const packagePath = path.join(dir, 'packages', 'pkg-tamper.json');
  const tampered = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  tampered.listingSnapshot.title = 'Tampered title';
  fs.writeFileSync(packagePath, `${JSON.stringify(tampered, null, 2)}\n`);

  const validation = workspace.validateDaltonReviewWorkspace(dir);
  assert.equal(validation.valid, false);
  assert.equal(validation.fingerprintMismatches.includes('packages/pkg-tamper.json'), true);
  assert.equal(validation.duplicateReviewPackageIds.includes('pkg-tamper'), true);
  assert.equal(validation.unexpectedFiles.includes('unexpected.txt'), true);
});

test('exports completed reviewed batch only when all packages have valid reviews', () => {
  const dir = tempWorkspace('dalton-complete');
  const batch = reviewBatch([
    listingRecord('one'),
    listingRecord('two')
  ], { batchId: 'complete-batch', requestedCandidateCount: 2 });
  workspace.writeDaltonReviewWorkspace(batch, dir, {
    workspaceId: 'complete-workspace',
    createdAt: '2026-07-22T10:05:00.000Z'
  });

  let completed = workspace.exportCompletedReviewedBatch(dir, {
    completedAt: '2026-07-22T13:00:00.000Z'
  });
  assert.equal(completed.aggregateReviewStatus, 'incomplete');
  assert.equal(fs.existsSync(path.join(dir, 'completed', 'reviewed-batch.json')), false);

  workspace.attachCompletedHumanReviewRecord(dir, 'pkg-one', humanReview({ notes: 'one' }));
  workspace.attachCompletedHumanReviewRecord(dir, 'pkg-two', humanReview({ notes: 'two' }));
  completed = workspace.exportCompletedReviewedBatch(dir, {
    completedAt: '2026-07-22T13:00:00.000Z'
  });
  assert.equal(completed.aggregateReviewStatus, 'complete');
  assert.equal(completed.reviewedPackages.length, 2);
  assert.equal(completed.reviewedPackages.every((reviewPackage) => reviewPackage.reviewStatus === 'reviewed'), true);
  assert.equal(completed.completedBatchFingerprint, workspace.buildCompletedBatchFingerprint(completed));
  assert.equal(fs.existsSync(path.join(dir, 'completed', 'reviewed-batch.json')), true);
});

test('workspace module does not load production engines or runtime modules', () => {
  const loaded = new Set();
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    loaded.add(request);
    return originalLoad.apply(this, arguments);
  };

  try {
    delete require.cache[require.resolve('../validation/daltonReviewWorkspace')];
    const fresh = require('../validation/daltonReviewWorkspace');
    fresh.buildDaltonReviewWorkspace(reviewBatch([listingRecord('load-check')]), {
      workspaceId: 'load-check-workspace',
      createdAt: '2026-07-22T10:05:00.000Z'
    });
  } finally {
    Module._load = originalLoad;
    delete require.cache[require.resolve('../validation/daltonReviewWorkspace')];
    require('../validation/daltonReviewWorkspace');
  }

  assert.equal([...loaded].some((request) => request.includes('server.js')), false);
  assert.equal([...loaded].some((request) => request.includes('scoutScannerService')), false);
  assert.equal([...loaded].some((request) => request.includes('../engines/')), false);
});
