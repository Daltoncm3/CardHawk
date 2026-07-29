'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const registry = require('../validation/governanceArtifactRegistry');
const lifecycle = require('../validation/governanceArtifactLifecycleManager');
const sessions = require('../validation/governanceReviewSessionManager');
const orchestrator = require('../validation/governanceReviewWorkspaceOrchestrator');
const pipeline = require('../validation/governancePipelineEndToEndValidation');

function reviewPackage(overrides = {}) {
  return {
    schemaVersion: '1.0.0',
    source: 'real_listing_decision_review_contract',
    packageId: 'pipeline-package-001',
    listingId: 'listing-001',
    marketplace: 'ebay',
    createdAt: '2026-07-29T20:00:00.000Z',
    signalGovernance: {
      bindingStatus: 'bound',
      readinessSummary: {
        packageReadiness: 'review_ready',
        certificationReadiness: 'certification_ready',
        nonBlockingWarnings: [],
        requiredFollowUps: []
      },
      evidenceBundleReference: {
        bundleId: 'bundle-001',
        bundleFingerprint: 'bundle-fingerprint-001'
      },
      reviewReportReference: {
        reportId: 'report-001',
        reportFingerprint: 'report-fingerprint-001'
      },
      coverageSummary: {
        expectedSignalCount: 4,
        coveredSignalCount: 4,
        missingSignalCount: 0,
        blockedSignalCount: 0,
        invalidSignalCount: 0
      },
      integritySummary: {
        authorityViolations: [],
        sourceReferenceViolations: []
      },
      conflicts: [],
      unknownValues: [],
      supersessionState: {
        bundleSuperseded: false,
        reportSuperseded: false
      }
    },
    productionImpact: 'none',
    decisionImpact: 'none',
    packageFingerprint: 'pipeline-package-fingerprint-001',
    ...overrides
  };
}

function buildContext(packages = [reviewPackage()]) {
  let reg = registry.createGovernanceArtifactRegistry({
    registryId: 'pipeline-registry',
    createdAt: '2026-07-29T20:01:00.000Z'
  });
  for (const pkg of packages) {
    reg = registry.registerArtifact(reg, pkg, {
      registeredAt: '2026-07-29T20:02:00.000Z',
      artifactType: 'review_package'
    }).registry;
  }

  let life = lifecycle.createLifecycle({
    lifecycleId: 'pipeline-lifecycle',
    registryId: reg.registryId,
    registryFingerprint: reg.registryFingerprint,
    createdAt: '2026-07-29T20:03:00.000Z'
  });
  for (const pkg of packages) {
    life = lifecycle.registerLifecycleEvent(life, {
      eventType: 'registered',
      artifactId: pkg.packageId,
      artifactFingerprint: pkg.packageFingerprint,
      eventAt: '2026-07-29T20:04:00.000Z'
    }, { registry: reg }).lifecycle;
    life = lifecycle.registerLifecycleEvent(life, {
      eventType: 'activated',
      artifactId: pkg.packageId,
      artifactFingerprint: pkg.packageFingerprint,
      eventAt: '2026-07-29T20:05:00.000Z'
    }, { registry: reg }).lifecycle;
  }

  let reviewSession = sessions.createReviewSession({
    sessionId: 'pipeline-session',
    createdAt: '2026-07-29T20:06:00.000Z'
  });
  for (const pkg of packages) {
    reviewSession = sessions.attachReviewPackage(reviewSession, pkg, {
      registry: reg,
      lifecycle: life,
      attachedAt: '2026-07-29T20:07:00.000Z'
    }).session;
  }

  const workspaceReview = orchestrator.createWorkspaceReview({
    workspaceReviewId: 'pipeline-workspace-review',
    workspaceId: 'pipeline-workspace',
    reviewSession,
    createdAt: '2026-07-29T20:08:00.000Z'
  }, { registry: reg, lifecycle: life, reviewSession });

  return {
    registry: reg,
    lifecycle: life,
    reviewSession,
    workspaceReview,
    createdAt: '2026-07-29T20:09:00.000Z'
  };
}

test('exports Governance Pipeline End-to-End Validation public APIs', () => {
  assert.equal(typeof pipeline.validateGovernancePipeline, 'function');
  assert.equal(typeof pipeline.validatePipelineStages, 'function');
  assert.equal(typeof pipeline.validateArtifactFlow, 'function');
  assert.equal(typeof pipeline.validatePipelineDeterminism, 'function');
  assert.equal(typeof pipeline.validatePipelineIntegrity, 'function');
  assert.equal(typeof pipeline.summarizePipelineValidation, 'function');
});

test('validates a complete governance pipeline from Registry through Workspace', () => {
  const context = buildContext();
  const result = pipeline.validateGovernancePipeline(context);

  assert.equal(result.valid, true);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(result.summary.failedStageCount, 0);
  assert.equal(result.stageResults.length, pipeline.PIPELINE_STAGES.length);
  assert.equal(result.registryId, context.registry.registryId);
  assert.equal(result.reviewSessionId, context.reviewSession.sessionId);
  assert.equal(result.workspaceReviewId, context.workspaceReview.workspaceReviewId);
});

test('validates pipeline stages deterministically', () => {
  const context = buildContext();
  const first = pipeline.validatePipelineStages(context);
  const second = pipeline.validatePipelineStages(context);

  assert.equal(first.valid, true);
  assert.deepEqual(first.stageResults, second.stageResults);
  assert.equal(first.pipelineValidationFingerprint, second.pipelineValidationFingerprint);
});

test('detects missing Registry artifact flow blockers', () => {
  const context = buildContext();
  const result = pipeline.validateGovernancePipeline({
    ...context,
    registry: null
  });

  assert.equal(result.valid, false);
  assert.equal(result.reasonCodes.includes('registry_missing'), true);
});

test('detects Review Session package references missing from Registry', () => {
  const pkg = reviewPackage();
  let reg = registry.createGovernanceArtifactRegistry({
    registryId: 'pipeline-empty-registry',
    createdAt: '2026-07-29T20:01:00.000Z'
  });
  const life = lifecycle.createLifecycle({
    lifecycleId: 'pipeline-empty-lifecycle',
    registryId: reg.registryId,
    registryFingerprint: reg.registryFingerprint,
    createdAt: '2026-07-29T20:03:00.000Z'
  });
  const reference = sessions.buildReviewPackageReference(pkg, {
    registryId: reg.registryId,
    registryFingerprint: reg.registryFingerprint,
    lifecycleState: 'unknown',
    reviewReadiness: 'review_ready',
    attachedAt: '2026-07-29T20:07:00.000Z'
  });
  const reviewSession = sessions.createReviewSession({
    sessionId: 'pipeline-session-unregistered',
    createdAt: '2026-07-29T20:06:00.000Z',
    reviewPackages: [reference]
  });
  const workspaceReview = orchestrator.createWorkspaceReview({
    workspaceReviewId: 'pipeline-workspace-unregistered',
    workspaceId: 'pipeline-workspace',
    reviewSession,
    createdAt: '2026-07-29T20:08:00.000Z'
  }, { registry: reg, lifecycle: life, reviewSession });
  const result = pipeline.validateArtifactFlow({ registry: reg, lifecycle: life, reviewSession, workspaceReview });

  assert.equal(result.valid, false);
  assert.equal(result.reasonCodes.includes('pipeline_artifact_not_registered'), true);
});

test('detects lifecycle state mismatches across pipeline artifacts', () => {
  const context = buildContext();
  const badReference = {
    ...context.reviewSession.reviewPackages[0],
    lifecycleState: 'superseded'
  };
  badReference.referenceFingerprint = sessions.buildReviewPackageReferenceFingerprint(badReference);
  const reviewSession = sessions.createReviewSession({
    ...context.reviewSession,
    reviewPackages: [badReference]
  });
  const workspaceReview = orchestrator.createWorkspaceReview({
    workspaceId: 'pipeline-workspace',
    reviewSession,
    createdAt: '2026-07-29T20:08:00.000Z'
  }, { registry: context.registry, lifecycle: context.lifecycle, reviewSession });
  const result = pipeline.validateGovernancePipeline({
    ...context,
    reviewSession,
    workspaceReview
  });

  assert.equal(result.valid, false);
  assert.equal(result.reasonCodes.includes('lifecycle_state_mismatch'), true);
});

test('detects workspace session fingerprint mismatch', () => {
  const context = buildContext();
  const workspaceReview = {
    ...context.workspaceReview,
    reviewSessionReference: {
      ...context.workspaceReview.reviewSessionReference,
      sessionFingerprint: 'wrong-session-fingerprint'
    }
  };
  workspaceReview.workspaceFingerprint = orchestrator.buildWorkspaceReviewFingerprint(workspaceReview);
  const result = pipeline.validateArtifactFlow({
    ...context,
    workspaceReview
  });

  assert.equal(result.valid, false);
  assert.equal(result.reasonCodes.includes('workspace_session_fingerprint_mismatch'), true);
});

test('detects cross-component integrity and authority violations', () => {
  const context = buildContext();
  const workspaceReview = {
    ...context.workspaceReview,
    executionAuthority: 'approve_changes'
  };
  workspaceReview.workspaceFingerprint = orchestrator.buildWorkspaceReviewFingerprint(workspaceReview);
  const result = pipeline.validatePipelineIntegrity({
    ...context,
    workspaceReview
  });

  assert.equal(result.valid, false);
  assert.equal(result.reasonCodes.includes('authority_boundary_violation'), true);
});

test('produces deterministic validation summaries and fingerprints', () => {
  const context = buildContext([
    reviewPackage(),
    reviewPackage({
      packageId: 'pipeline-package-002',
      packageFingerprint: 'pipeline-package-fingerprint-002',
      listingId: 'listing-002',
      marketplace: 'alt-market'
    })
  ]);
  const first = pipeline.validateGovernancePipeline(context);
  const second = pipeline.validateGovernancePipeline(context);
  const firstSummary = pipeline.summarizePipelineValidation(first);
  const secondSummary = pipeline.summarizePipelineValidation(first);

  assert.deepEqual(first, second);
  assert.deepEqual(firstSummary, secondSummary);
  assert.equal(first.pipelineValidationFingerprint, second.pipelineValidationFingerprint);
});

test('does not mutate pipeline inputs', () => {
  const context = buildContext();
  const before = JSON.stringify(context);
  const result = pipeline.validateGovernancePipeline(context);

  assert.equal(result.valid, true);
  assert.equal(JSON.stringify(context), before);
});

test('module remains offline and avoids runtime imports', () => {
  const loaded = new Set();
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    loaded.add(request);
    return originalLoad.apply(this, arguments);
  };
  try {
    delete require.cache[require.resolve('../validation/governancePipelineEndToEndValidation')];
    require('../validation/governancePipelineEndToEndValidation');
  } finally {
    Module._load = originalLoad;
  }

  assert.equal([...loaded].some((item) => item.includes('server.js')), false);
  assert.equal([...loaded].some((item) => item.includes('stateStore')), false);
  assert.equal([...loaded].some((item) => item.includes('scoutScannerService')), false);
});
