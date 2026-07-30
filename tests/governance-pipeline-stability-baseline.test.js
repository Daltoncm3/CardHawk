'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const registry = require('../validation/governanceArtifactRegistry');
const lifecycle = require('../validation/governanceArtifactLifecycleManager');
const sessions = require('../validation/governanceReviewSessionManager');
const orchestrator = require('../validation/governanceReviewWorkspaceOrchestrator');
const baseline = require('../validation/governancePipelineStabilityBaseline');

function reviewPackage(overrides = {}) {
  return {
    schemaVersion: '1.0.0',
    source: 'real_listing_decision_review_contract',
    packageId: 'baseline-package-001',
    listingId: 'listing-001',
    marketplace: 'ebay',
    createdAt: '2026-07-30T14:00:00.000Z',
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
    packageFingerprint: 'baseline-package-fingerprint-001',
    ...overrides
  };
}

function buildContext(packages = [reviewPackage()]) {
  let reg = registry.createGovernanceArtifactRegistry({
    registryId: 'baseline-registry',
    createdAt: '2026-07-30T14:01:00.000Z'
  });
  for (const pkg of packages) {
    reg = registry.registerArtifact(reg, pkg, {
      registeredAt: '2026-07-30T14:02:00.000Z',
      artifactType: 'review_package'
    }).registry;
  }

  let life = lifecycle.createLifecycle({
    lifecycleId: 'baseline-lifecycle',
    registryId: reg.registryId,
    registryFingerprint: reg.registryFingerprint,
    createdAt: '2026-07-30T14:03:00.000Z'
  });
  for (const pkg of packages) {
    life = lifecycle.registerLifecycleEvent(life, {
      eventType: 'registered',
      artifactId: pkg.packageId,
      artifactFingerprint: pkg.packageFingerprint,
      eventAt: '2026-07-30T14:04:00.000Z'
    }, { registry: reg }).lifecycle;
    life = lifecycle.registerLifecycleEvent(life, {
      eventType: 'activated',
      artifactId: pkg.packageId,
      artifactFingerprint: pkg.packageFingerprint,
      eventAt: '2026-07-30T14:05:00.000Z'
    }, { registry: reg }).lifecycle;
  }

  let reviewSession = sessions.createReviewSession({
    sessionId: 'baseline-session',
    createdAt: '2026-07-30T14:06:00.000Z'
  });
  for (const pkg of packages) {
    reviewSession = sessions.attachReviewPackage(reviewSession, pkg, {
      registry: reg,
      lifecycle: life,
      attachedAt: '2026-07-30T14:07:00.000Z'
    }).session;
  }

  const workspaceReview = orchestrator.createWorkspaceReview({
    workspaceReviewId: 'baseline-workspace-review',
    workspaceId: 'baseline-workspace',
    reviewSession,
    createdAt: '2026-07-30T14:08:00.000Z'
  }, { registry: reg, lifecycle: life, reviewSession });

  return { registry: reg, lifecycle: life, reviewSession, workspaceReview };
}

test('exports Governance Pipeline Stability Baseline public APIs', () => {
  assert.equal(typeof baseline.buildGovernancePipelineBaseline, 'function');
  assert.equal(typeof baseline.validateGovernancePipelineBaseline, 'function');
  assert.equal(typeof baseline.compareGovernancePipelineBaseline, 'function');
  assert.equal(typeof baseline.buildGovernancePipelineCertification, 'function');
  assert.equal(typeof baseline.validateGovernancePipelineCertification, 'function');
  assert.equal(typeof baseline.summarizeGovernancePipelineBaseline, 'function');
});

test('builds an immutable passing stability baseline', () => {
  const context = buildContext();
  const result = baseline.buildGovernancePipelineBaseline({
    ...context,
    baselineId: 'baseline-001',
    createdAt: '2026-07-30T14:10:00.000Z',
    testMetadata: {
      focusedTests: 'passed',
      fullSuite: 'passed'
    }
  });
  const validation = baseline.validateGovernancePipelineBaseline(result);

  assert.equal(Object.isFrozen(result), true);
  assert.equal(validation.valid, true);
  assert.equal(result.statusSummary.allRequiredValidationsPassed, true);
  assert.equal(result.offlineBoundaryStatus, 'passed');
  assert.equal(result.nonAuthoritativeStatus, 'passed');
  assert.equal(result.componentInventory.length >= 5, true);
});

test('builds an immutable non-authoritative certification for a passing baseline', () => {
  const context = buildContext();
  const built = baseline.buildGovernancePipelineBaseline({
    ...context,
    baselineId: 'baseline-001',
    createdAt: '2026-07-30T14:10:00.000Z'
  });
  const certification = baseline.buildGovernancePipelineCertification(built, {
    certificationId: 'certification-001',
    createdAt: '2026-07-30T14:11:00.000Z'
  });
  const validation = baseline.validateGovernancePipelineCertification(certification, { baseline: built });

  assert.equal(Object.isFrozen(certification), true);
  assert.equal(validation.valid, true);
  assert.equal(certification.certificationStatus, 'certified_with_warnings');
  assert.equal(certification.certified, true);
  assert.equal(certification.certificationRules.productionApprovalGranted, false);
  assert.equal(certification.executionAuthority, 'none');
});

test('preserves warnings and unresolved policy questions in certification', () => {
  const context = buildContext();
  const built = baseline.buildGovernancePipelineBaseline({
    ...context,
    createdAt: '2026-07-30T14:10:00.000Z',
    knownWarnings: ['manual_review_sample_size_small'],
    unresolvedPolicyQuestions: ['future_runtime_integration_gate']
  });
  const certification = baseline.buildGovernancePipelineCertification(built, {
    createdAt: '2026-07-30T14:11:00.000Z'
  });
  const validation = baseline.validateGovernancePipelineCertification(certification, { baseline: built });

  assert.equal(certification.certificationStatus, 'certified_with_warnings');
  assert.equal(validation.valid, true);
  assert.equal(validation.reasonCodes.includes('certification_contains_visible_warnings'), true);
  assert.deepEqual(certification.knownWarnings, ['manual_review_sample_size_small']);
});

test('missing required validation prevents passing certification', () => {
  const built = baseline.buildGovernancePipelineBaseline({
    baselineId: 'baseline-missing-validation',
    createdAt: '2026-07-30T14:10:00.000Z',
    validationResults: {
      registryConformance: { valid: true, errors: [], warnings: [], reasonCodes: [], conformanceFingerprint: 'registry-ok' }
    }
  });
  const certification = baseline.buildGovernancePipelineCertification(built, {
    createdAt: '2026-07-30T14:11:00.000Z'
  });

  assert.equal(built.statusSummary.missingRequiredValidationCount > 0, true);
  assert.equal(certification.certificationStatus, 'not_certified');
  assert.equal(certification.certified, false);
});

test('failed required validation prevents passing certification', () => {
  const context = buildContext();
  const badEndToEnd = {
    valid: false,
    errors: [{ code: 'pipeline_artifact_not_registered', message: 'Missing artifact.', field: 'registry' }],
    warnings: [],
    reasonCodes: ['pipeline_artifact_not_registered'],
    pipelineValidationFingerprint: 'failed-pipeline'
  };
  const built = baseline.buildGovernancePipelineBaseline({
    ...context,
    createdAt: '2026-07-30T14:10:00.000Z',
    validationResults: {
      endToEndValidation: badEndToEnd
    }
  });
  const certification = baseline.buildGovernancePipelineCertification(built, {
    createdAt: '2026-07-30T14:11:00.000Z'
  });

  assert.equal(built.statusSummary.failedRequiredValidations.includes('endToEndValidation'), true);
  assert.equal(certification.certificationStatus, 'not_certified');
});

test('detects baseline fingerprint drift and authority violations', () => {
  const context = buildContext();
  const built = baseline.buildGovernancePipelineBaseline({
    ...context,
    createdAt: '2026-07-30T14:10:00.000Z'
  });
  const drifted = {
    ...built,
    executionAuthority: 'approve_changes'
  };
  const validation = baseline.validateGovernancePipelineBaseline(drifted);

  assert.equal(validation.valid, false);
  assert.equal(validation.reasonCodes.includes('authority_boundary_violation'), true);
  assert.equal(validation.reasonCodes.includes('baseline_fingerprint_mismatch'), true);
});

test('compares baselines deterministically', () => {
  const context = buildContext();
  const first = baseline.buildGovernancePipelineBaseline({
    ...context,
    baselineId: 'baseline-001',
    createdAt: '2026-07-30T14:10:00.000Z'
  });
  const second = baseline.buildGovernancePipelineBaseline({
    ...context,
    baselineId: 'baseline-002',
    createdAt: '2026-07-30T14:10:00.000Z'
  });
  const same = baseline.compareGovernancePipelineBaseline(first, second);
  const changed = baseline.compareGovernancePipelineBaseline(first, {
    ...second,
    knownWarnings: ['new_warning']
  });

  assert.equal(same.equal, true);
  assert.equal(changed.equal, false);
  assert.deepEqual(changed.differences, ['knownWarnings']);
});

test('summarizes baseline certification readiness deterministically', () => {
  const context = buildContext([
    reviewPackage(),
    reviewPackage({
      packageId: 'baseline-package-002',
      packageFingerprint: 'baseline-package-fingerprint-002',
      listingId: 'listing-002',
      marketplace: 'alt-market'
    })
  ]);
  const built = baseline.buildGovernancePipelineBaseline({
    ...context,
    createdAt: '2026-07-30T14:10:00.000Z'
  });
  const first = baseline.summarizeGovernancePipelineBaseline(built);
  const second = baseline.summarizeGovernancePipelineBaseline(built);

  assert.deepEqual(first, second);
  assert.equal(first.certificationStatus, 'certified_with_warnings');
  assert.equal(first.componentCount >= 5, true);
});

test('detects invalid certification baseline binding and production approval violations', () => {
  const context = buildContext();
  const built = baseline.buildGovernancePipelineBaseline({
    ...context,
    createdAt: '2026-07-30T14:10:00.000Z'
  });
  const certification = baseline.buildGovernancePipelineCertification(built, {
    createdAt: '2026-07-30T14:11:00.000Z'
  });
  const invalid = {
    ...certification,
    baselineFingerprint: 'wrong-baseline-fingerprint',
    certificationRules: {
      ...certification.certificationRules,
      productionApprovalGranted: true
    }
  };
  invalid.certificationFingerprint = baseline.buildGovernancePipelineCertificationFingerprint(invalid);
  const validation = baseline.validateGovernancePipelineCertification(invalid, { baseline: built });

  assert.equal(validation.valid, false);
  assert.equal(validation.reasonCodes.includes('baseline_binding_mismatch'), true);
  assert.equal(validation.reasonCodes.includes('production_approval_boundary_violation'), true);
});

test('module remains offline and avoids runtime imports', () => {
  const loaded = new Set();
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    loaded.add(request);
    return originalLoad.apply(this, arguments);
  };
  try {
    delete require.cache[require.resolve('../validation/governancePipelineStabilityBaseline')];
    require('../validation/governancePipelineStabilityBaseline');
  } finally {
    Module._load = originalLoad;
  }

  assert.equal([...loaded].some((item) => item.includes('server.js')), false);
  assert.equal([...loaded].some((item) => item.includes('stateStore')), false);
  assert.equal([...loaded].some((item) => item.includes('scoutScannerService')), false);
});
