'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const registry = require('../validation/governanceArtifactRegistry');
const lifecycle = require('../validation/governanceArtifactLifecycleManager');
const sessions = require('../validation/governanceReviewSessionManager');
const orchestrator = require('../validation/governanceReviewWorkspaceOrchestrator');
const conformance = require('../validation/governanceReviewWorkspaceOrchestratorConformance');

function reviewPackage(overrides = {}) {
  return {
    schemaVersion: '1.0.0',
    source: 'real_listing_decision_review_contract',
    packageId: 'workspace-package-001',
    listingId: 'listing-001',
    marketplace: 'ebay',
    createdAt: '2026-07-29T19:00:00.000Z',
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
        expectedSignalCount: 3,
        coveredSignalCount: 3,
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
    packageFingerprint: 'workspace-package-fingerprint-001',
    ...overrides
  };
}

function buildContext(packages = [reviewPackage()]) {
  let reg = registry.createGovernanceArtifactRegistry({
    registryId: 'workspace-conformance-registry',
    createdAt: '2026-07-29T19:01:00.000Z'
  });
  for (const pkg of packages) {
    reg = registry.registerArtifact(reg, pkg, {
      registeredAt: '2026-07-29T19:02:00.000Z',
      artifactType: 'review_package'
    }).registry;
  }

  let life = lifecycle.createLifecycle({
    lifecycleId: 'workspace-conformance-lifecycle',
    registryId: reg.registryId,
    registryFingerprint: reg.registryFingerprint,
    createdAt: '2026-07-29T19:03:00.000Z'
  });
  for (const pkg of packages) {
    life = lifecycle.registerLifecycleEvent(life, {
      eventType: 'registered',
      artifactId: pkg.packageId,
      artifactFingerprint: pkg.packageFingerprint,
      eventAt: '2026-07-29T19:04:00.000Z'
    }, { registry: reg }).lifecycle;
    life = lifecycle.registerLifecycleEvent(life, {
      eventType: 'activated',
      artifactId: pkg.packageId,
      artifactFingerprint: pkg.packageFingerprint,
      eventAt: '2026-07-29T19:05:00.000Z'
    }, { registry: reg }).lifecycle;
  }

  let session = sessions.createReviewSession({
    sessionId: 'workspace-conformance-session',
    createdAt: '2026-07-29T19:06:00.000Z'
  });
  for (const pkg of packages) {
    session = sessions.attachReviewPackage(session, pkg, {
      registry: reg,
      lifecycle: life,
      attachedAt: '2026-07-29T19:07:00.000Z'
    }).session;
  }
  return { registry: reg, lifecycle: life, session };
}

test('exports Governance Review Workspace Orchestrator Conformance public APIs', () => {
  assert.equal(typeof conformance.validateWorkspaceOrchestratorConformance, 'function');
  assert.equal(typeof conformance.validateWorkspaceAssembly, 'function');
  assert.equal(typeof conformance.validateWorkspaceReadiness, 'function');
  assert.equal(typeof conformance.validateWorkspaceDeterminism, 'function');
  assert.equal(typeof conformance.validateWorkspaceIntegrity, 'function');
  assert.equal(typeof conformance.summarizeWorkspaceConformance, 'function');
});

test('validates a conformant immutable workspace review', () => {
  const context = buildContext();
  const review = orchestrator.createWorkspaceReview({
    workspaceReviewId: 'workspace-review-conformance-001',
    workspaceId: 'workspace-001',
    reviewSession: context.session,
    createdAt: '2026-07-29T19:10:00.000Z'
  }, context);
  const result = conformance.validateWorkspaceOrchestratorConformance(review, {
    reviewSession: context.session,
    registry: context.registry,
    lifecycle: context.lifecycle
  });

  assert.equal(result.valid, true);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(result.summary.failedStageCount, 0);
  assert.equal(result.stageResults.length, conformance.CONFORMANCE_STAGES.length);
  assert.equal(result.productionImpact, 'none');
});

test('validates workspace assembly through Review Session, Registry, and Lifecycle APIs', () => {
  const context = buildContext();
  const review = orchestrator.createWorkspaceReview({
    workspaceId: 'workspace-001',
    reviewSession: context.session,
    createdAt: '2026-07-29T19:10:00.000Z'
  }, context);
  const assembly = conformance.validateWorkspaceAssembly(review, context);

  assert.equal(assembly.valid, true);
  assert.deepEqual(assembly.assemblyViolations, []);
  assert.deepEqual(assembly.sessionViolations, []);
});

test('detects workspace summary assembly drift', () => {
  const context = buildContext();
  const review = orchestrator.createWorkspaceReview({
    workspaceId: 'workspace-001',
    reviewSession: context.session,
    createdAt: '2026-07-29T19:10:00.000Z'
  }, context);
  const drifted = {
    ...review,
    workspaceSummary: {
      ...review.workspaceSummary,
      aggregateCoverage: {
        ...review.workspaceSummary.aggregateCoverage,
        packageCount: 99
      }
    },
    workspaceFingerprint: orchestrator.buildWorkspaceReviewFingerprint({
      ...review,
      workspaceSummary: {
        ...review.workspaceSummary,
        aggregateCoverage: {
          ...review.workspaceSummary.aggregateCoverage,
          packageCount: 99
        }
      },
      workspaceFingerprint: undefined
    })
  };
  const assembly = conformance.validateWorkspaceAssembly(drifted, context);

  assert.equal(assembly.valid, false);
  assert.equal(assembly.reasonCodes.includes('workspace_summary_assembly_mismatch'), true);
});

test('certifies separate review readiness and certification readiness', () => {
  const base = reviewPackage();
  const context = buildContext([
    reviewPackage({
      signalGovernance: {
        ...base.signalGovernance,
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
    createdAt: '2026-07-29T19:10:00.000Z'
  }, context);
  const readiness = conformance.validateWorkspaceReadiness(review);

  assert.equal(readiness.valid, true);
  assert.equal(review.readiness.reviewReadiness, 'review_ready');
  assert.equal(review.readiness.certificationReadiness, 'blocked');
  assert.equal(orchestrator.listWorkspaceFindings(review, { category: 'validation' }).some((finding) => finding.readinessScope === 'certification'), true);
});

test('detects readiness mismatch that collapses certification blockers into review blockers', () => {
  const base = reviewPackage();
  const context = buildContext([
    reviewPackage({
      signalGovernance: {
        ...base.signalGovernance,
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
    createdAt: '2026-07-29T19:10:00.000Z'
  }, context);
  const invalid = {
    ...review,
    readiness: {
      ...review.readiness,
      reviewReadiness: 'blocked'
    },
    workspaceFingerprint: orchestrator.buildWorkspaceReviewFingerprint({
      ...review,
      readiness: {
        ...review.readiness,
        reviewReadiness: 'blocked'
      },
      workspaceFingerprint: undefined
    })
  };
  const readiness = conformance.validateWorkspaceReadiness(invalid);

  assert.equal(readiness.valid, false);
  assert.equal(readiness.reasonCodes.includes('workspace_readiness_mismatch'), true);
  assert.equal(readiness.reasonCodes.includes('review_certification_readiness_not_separated'), true);
});

test('preserves findings for unknowns, conflicts, supersession, expiration, provenance, validation, and authority', () => {
  const base = reviewPackage();
  const context = buildContext([
    reviewPackage({
      signalGovernance: {
        ...base.signalGovernance,
        readinessSummary: {
          packageReadiness: 'review_ready',
          certificationReadiness: 'blocked_invalid_report',
          nonBlockingWarnings: [{ code: 'validation_warning', message: 'Validation warning.' }]
        },
        reviewReportReference: { invalid: true },
        evidenceBundleReference: { ...base.signalGovernance.evidenceBundleReference, expired: true, expiresAt: '2026-07-28T00:00:00.000Z' },
        integritySummary: {
          authorityViolations: ['executionAuthority'],
          sourceReferenceViolations: ['bundleFingerprint']
        },
        conflicts: [{ code: 'conflict_visible', message: 'Conflict visible.' }],
        unknownValues: [{ code: 'unknown_visible', message: 'Unknown visible.' }],
        supersessionState: {
          bundleSuperseded: true,
          reportSuperseded: false
        }
      }
    })
  ]);
  const review = orchestrator.createWorkspaceReview({
    workspaceId: 'workspace-001',
    reviewSession: context.session,
    createdAt: '2026-07-29T19:10:00.000Z',
    asOf: '2026-07-29T19:10:00.000Z'
  }, context);
  const readiness = conformance.validateWorkspaceReadiness(review);
  const categories = new Set(orchestrator.listWorkspaceFindings(review).map((finding) => finding.category));

  assert.equal(readiness.valid, true);
  for (const category of ['unknown', 'conflict', 'supersession', 'expiration', 'provenance', 'validation', 'authority']) {
    assert.equal(categories.has(category), true);
  }
});

test('detects deterministic fingerprint drift and summary drift', () => {
  const context = buildContext();
  const review = orchestrator.createWorkspaceReview({
    workspaceId: 'workspace-001',
    reviewSession: context.session,
    createdAt: '2026-07-29T19:10:00.000Z'
  }, context);
  const drifted = {
    ...review,
    workspaceFingerprint: 'not-the-real-fingerprint'
  };
  const determinism = conformance.validateWorkspaceDeterminism(drifted, context);

  assert.equal(determinism.valid, false);
  assert.equal(determinism.reasonCodes.includes('workspace_fingerprint_mismatch'), true);
});

test('validates workspace integrity and source references', () => {
  const context = buildContext();
  const review = orchestrator.createWorkspaceReview({
    workspaceId: 'workspace-001',
    reviewSession: context.session,
    createdAt: '2026-07-29T19:10:00.000Z'
  }, context);
  const valid = conformance.validateWorkspaceIntegrity(review, context);
  const invalid = conformance.validateWorkspaceIntegrity({
    ...review,
    reviewSessionReference: {
      ...review.reviewSessionReference,
      sessionId: 'other-session'
    },
    workspaceFingerprint: orchestrator.buildWorkspaceReviewFingerprint({
      ...review,
      reviewSessionReference: {
        ...review.reviewSessionReference,
        sessionId: 'other-session'
      },
      workspaceFingerprint: undefined
    })
  }, context);

  assert.equal(valid.valid, true);
  assert.equal(invalid.valid, false);
  assert.equal(invalid.reasonCodes.includes('review_session_reference_mismatch'), true);
});

test('enforces non-authoritative behavior', () => {
  const context = buildContext();
  const review = orchestrator.createWorkspaceReview({
    workspaceId: 'workspace-001',
    reviewSession: context.session,
    createdAt: '2026-07-29T19:10:00.000Z'
  }, context);
  const result = conformance.validateWorkspaceOrchestratorConformance({
    ...review,
    productionImpact: 'changes_behavior'
  }, context);

  assert.equal(result.valid, false);
  assert.equal(result.reasonCodes.includes('authority_boundary_violation'), true);
});

test('summarizes conformance deterministically', () => {
  const context = buildContext();
  const review = orchestrator.createWorkspaceReview({
    workspaceId: 'workspace-001',
    reviewSession: context.session,
    createdAt: '2026-07-29T19:10:00.000Z'
  }, context);
  const result = conformance.validateWorkspaceOrchestratorConformance(review, context);
  const first = conformance.summarizeWorkspaceConformance(result);
  const second = conformance.summarizeWorkspaceConformance(result);

  assert.deepEqual(first, second);
  assert.equal(first.stageCount, conformance.CONFORMANCE_STAGES.length);
});

test('module remains offline and avoids runtime imports', () => {
  const loaded = new Set();
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    loaded.add(request);
    return originalLoad.apply(this, arguments);
  };
  try {
    delete require.cache[require.resolve('../validation/governanceReviewWorkspaceOrchestratorConformance')];
    require('../validation/governanceReviewWorkspaceOrchestratorConformance');
  } finally {
    Module._load = originalLoad;
  }

  assert.equal([...loaded].some((item) => item.includes('server.js')), false);
  assert.equal([...loaded].some((item) => item.includes('stateStore')), false);
  assert.equal([...loaded].some((item) => item.includes('scoutScannerService')), false);
});
