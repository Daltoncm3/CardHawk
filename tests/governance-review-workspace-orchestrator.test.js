'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const registry = require('../validation/governanceArtifactRegistry');
const lifecycle = require('../validation/governanceArtifactLifecycleManager');
const sessions = require('../validation/governanceReviewSessionManager');
const orchestrator = require('../validation/governanceReviewWorkspaceOrchestrator');

function reviewPackage(overrides = {}) {
  return {
    schemaVersion: '1.0.0',
    source: 'real_listing_decision_review_contract',
    packageId: 'review-package-001',
    listingId: 'listing-001',
    marketplace: 'ebay',
    createdAt: '2026-07-29T18:00:00.000Z',
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
        expectedSignalCount: 2,
        coveredSignalCount: 2,
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
    packageFingerprint: 'review-package-fingerprint-001',
    ...overrides
  };
}

function buildContext(packages = [reviewPackage()]) {
  let reg = registry.createGovernanceArtifactRegistry({
    registryId: 'workspace-registry',
    createdAt: '2026-07-29T18:01:00.000Z'
  });
  for (const pkg of packages) {
    reg = registry.registerArtifact(reg, pkg, {
      registeredAt: '2026-07-29T18:02:00.000Z',
      artifactType: 'review_package'
    }).registry;
  }
  let life = lifecycle.createLifecycle({
    lifecycleId: 'workspace-lifecycle',
    registryId: reg.registryId,
    registryFingerprint: reg.registryFingerprint,
    createdAt: '2026-07-29T18:03:00.000Z'
  });
  for (const pkg of packages) {
    life = lifecycle.registerLifecycleEvent(life, {
      eventType: 'registered',
      artifactId: pkg.packageId,
      artifactFingerprint: pkg.packageFingerprint,
      eventAt: '2026-07-29T18:04:00.000Z'
    }, { registry: reg }).lifecycle;
    life = lifecycle.registerLifecycleEvent(life, {
      eventType: 'activated',
      artifactId: pkg.packageId,
      artifactFingerprint: pkg.packageFingerprint,
      eventAt: '2026-07-29T18:05:00.000Z'
    }, { registry: reg }).lifecycle;
  }
  let session = sessions.createReviewSession({
    sessionId: 'workspace-session',
    createdAt: '2026-07-29T18:06:00.000Z'
  });
  for (const pkg of packages) {
    session = sessions.attachReviewPackage(session, pkg, {
      registry: reg,
      lifecycle: life,
      attachedAt: '2026-07-29T18:07:00.000Z'
    }).session;
  }
  return { registry: reg, lifecycle: life, session };
}

test('exports Governance Review Workspace Orchestrator public APIs', () => {
  assert.equal(typeof orchestrator.createWorkspaceReview, 'function');
  assert.equal(typeof orchestrator.validateWorkspaceReview, 'function');
  assert.equal(typeof orchestrator.assembleWorkspaceSummary, 'function');
  assert.equal(typeof orchestrator.deriveWorkspaceReadiness, 'function');
  assert.equal(typeof orchestrator.listWorkspaceFindings, 'function');
  assert.equal(typeof orchestrator.summarizeWorkspaceReview, 'function');
});

test('creates immutable workspace reviews from Review Sessions', () => {
  const context = buildContext();
  const review = orchestrator.createWorkspaceReview({
    workspaceReviewId: 'workspace-review-001',
    workspaceId: 'workspace-001',
    reviewSession: context.session,
    createdAt: '2026-07-29T18:10:00.000Z'
  }, context);

  assert.equal(Object.isFrozen(review), true);
  assert.equal(review.workspaceSummary.aggregateCoverage.packageCount, 1);
  assert.equal(review.readiness.reviewReadiness, 'review_ready');
  assert.equal(review.readiness.certificationReadiness, 'certification_ready');
  assert.equal(review.productionImpact, 'none');
});

test('supports multiple Review Packages with deterministic summaries', () => {
  const context = buildContext([
    reviewPackage(),
    reviewPackage({
      packageId: 'review-package-002',
      packageFingerprint: 'review-package-fingerprint-002',
      listingId: 'listing-002',
      marketplace: 'alt-market'
    })
  ]);
  const first = orchestrator.createWorkspaceReview({
    workspaceId: 'workspace-001',
    reviewSession: context.session,
    createdAt: '2026-07-29T18:10:00.000Z'
  }, context);
  const second = orchestrator.createWorkspaceReview({
    workspaceId: 'workspace-001',
    reviewSession: context.session,
    createdAt: '2026-07-29T18:10:00.000Z'
  }, context);

  assert.deepEqual(first.workspaceSummary, second.workspaceSummary);
  assert.equal(first.workspaceSummary.aggregateCoverage.packageCount, 2);
  assert.deepEqual(first.workspaceSummary.packageSummaries.map((item) => item.packageId), ['review-package-001', 'review-package-002']);
});

test('keeps review readiness and certification readiness separate', () => {
  const context = buildContext([
    reviewPackage({
      signalGovernance: {
        ...reviewPackage().signalGovernance,
        readinessSummary: {
          packageReadiness: 'review_ready',
          certificationReadiness: 'blocked_missing_report'
        },
        reviewReportReference: {}
      }
    })
  ]);
  const review = orchestrator.createWorkspaceReview({
    workspaceId: 'workspace-001',
    reviewSession: context.session,
    createdAt: '2026-07-29T18:10:00.000Z'
  }, context);

  assert.equal(review.readiness.reviewReadiness, 'review_ready');
  assert.equal(review.readiness.certificationReadiness, 'blocked');
  assert.equal(orchestrator.listWorkspaceFindings(review, { category: 'validation' }).some((finding) => finding.code === 'missing_governance_report'), true);
});

test('surfaces warnings, unknown values, conflicts, provenance, and authority findings', () => {
  const base = reviewPackage();
  const context = buildContext([
    reviewPackage({
      signalGovernance: {
        ...base.signalGovernance,
        readinessSummary: {
          packageReadiness: 'review_ready',
          certificationReadiness: 'certification_ready_with_warnings',
          nonBlockingWarnings: [{ code: 'coverage_warning', message: 'Optional signal missing.' }],
          requiredFollowUps: [{ code: 'dalton_follow_up', message: 'Review evidence gap.' }]
        },
        integritySummary: {
          authorityViolations: ['signal.executionAuthority'],
          sourceReferenceViolations: ['bundle.reviewPackageFingerprint']
        },
        conflicts: [{ code: 'valuation_conflict', message: 'Production and shadow disagree.' }],
        unknownValues: [{ code: 'unknown_grade', message: 'Grade is unknown.' }]
      }
    })
  ]);
  const review = orchestrator.createWorkspaceReview({
    workspaceId: 'workspace-001',
    reviewSession: context.session,
    createdAt: '2026-07-29T18:10:00.000Z'
  }, context);
  const findings = orchestrator.listWorkspaceFindings(review);

  assert.equal(review.readiness.reviewReadiness, 'blocked');
  assert.equal(findings.some((finding) => finding.category === 'authority'), true);
  assert.equal(findings.some((finding) => finding.category === 'provenance'), true);
  assert.equal(findings.some((finding) => finding.category === 'conflict'), true);
  assert.equal(findings.some((finding) => finding.category === 'unknown'), true);
  assert.equal(findings.some((finding) => finding.category === 'follow_up'), true);
});

test('detects supersession and archived lifecycle blockers', () => {
  const pkg = reviewPackage();
  const context = buildContext([pkg]);
  const archivedLife = lifecycle.registerLifecycleEvent(context.lifecycle, {
    eventType: 'archived',
    artifactId: pkg.packageId,
    artifactFingerprint: pkg.packageFingerprint,
    eventAt: '2026-07-29T18:08:00.000Z'
  }, { registry: context.registry }).lifecycle;
  const archivedSession = sessions.attachReviewPackage(sessions.createReviewSession({
    sessionId: 'workspace-session-archived',
    createdAt: '2026-07-29T18:09:00.000Z'
  }), pkg, {
    registry: context.registry,
    lifecycle: archivedLife,
    attachedAt: '2026-07-29T18:10:00.000Z'
  }).session;
  const review = orchestrator.createWorkspaceReview({
    workspaceId: 'workspace-001',
    reviewSession: archivedSession,
    createdAt: '2026-07-29T18:11:00.000Z'
  }, { registry: context.registry, lifecycle: archivedLife });

  assert.equal(review.readiness.reviewReadiness, 'blocked');
  assert.equal(orchestrator.listWorkspaceFindings(review, { category: 'archive' }).length, 1);
});

test('validates workspace review integrity and fingerprint drift', () => {
  const context = buildContext();
  const review = orchestrator.createWorkspaceReview({
    workspaceId: 'workspace-001',
    reviewSession: context.session,
    createdAt: '2026-07-29T18:10:00.000Z'
  }, context);
  const valid = orchestrator.validateWorkspaceReview(review, {
    reviewSession: context.session,
    registry: context.registry,
    lifecycle: context.lifecycle
  });
  const drifted = orchestrator.validateWorkspaceReview({
    ...review,
    workspaceId: 'changed-workspace'
  }, {
    reviewSession: context.session,
    registry: context.registry,
    lifecycle: context.lifecycle
  });

  assert.equal(valid.valid, true);
  assert.equal(drifted.valid, false);
  assert.equal(drifted.reasonCodes.includes('workspace_fingerprint_mismatch'), true);
});

test('produces deterministic reviewer-safe summaries and filtered findings', () => {
  const context = buildContext();
  const review = orchestrator.createWorkspaceReview({
    workspaceReviewId: 'workspace-review-001',
    workspaceId: 'workspace-001',
    reviewSession: context.session,
    createdAt: '2026-07-29T18:10:00.000Z'
  }, context);
  const first = orchestrator.summarizeWorkspaceReview(review);
  const second = orchestrator.summarizeWorkspaceReview(review);

  assert.deepEqual(first, second);
  assert.equal(first.packageCount, 1);
  assert.equal(orchestrator.listWorkspaceFindings(review, { severity: 'blocking' }).length, 0);
});

test('preserves non-authoritative workspace boundaries', () => {
  const context = buildContext();
  const review = orchestrator.createWorkspaceReview({
    workspaceId: 'workspace-001',
    reviewSession: context.session,
    createdAt: '2026-07-29T18:10:00.000Z'
  }, context);
  const validation = orchestrator.validateWorkspaceReview({
    ...review,
    executionAuthority: 'approve_changes'
  });

  assert.equal(validation.valid, false);
  assert.equal(validation.reasonCodes.includes('authority_boundary_violation'), true);
});

test('module remains offline and avoids runtime imports', () => {
  const loaded = new Set();
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    loaded.add(request);
    return originalLoad.apply(this, arguments);
  };
  try {
    delete require.cache[require.resolve('../validation/governanceReviewWorkspaceOrchestrator')];
    require('../validation/governanceReviewWorkspaceOrchestrator');
  } finally {
    Module._load = originalLoad;
  }

  assert.equal([...loaded].some((item) => item.includes('server.js')), false);
  assert.equal([...loaded].some((item) => item.includes('stateStore')), false);
  assert.equal([...loaded].some((item) => item.includes('scoutScannerService')), false);
});
