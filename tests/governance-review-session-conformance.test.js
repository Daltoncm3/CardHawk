'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const registry = require('../validation/governanceArtifactRegistry');
const lifecycle = require('../validation/governanceArtifactLifecycleManager');
const sessions = require('../validation/governanceReviewSessionManager');
const conformance = require('../validation/governanceReviewSessionConformance');

function reviewPackage(overrides = {}) {
  return {
    schemaVersion: '1.0.0',
    source: 'real_listing_decision_review_contract',
    packageId: 'review-package-001',
    listingId: 'listing-001',
    marketplace: 'ebay',
    createdAt: '2026-07-29T17:00:00.000Z',
    productionImpact: 'none',
    decisionImpact: 'none',
    packageFingerprint: 'review-package-fingerprint-001',
    ...overrides
  };
}

function buildContext() {
  const first = registry.registerArtifact(registry.createGovernanceArtifactRegistry({
    registryId: 'review-session-conformance-registry',
    createdAt: '2026-07-29T17:01:00.000Z'
  }), reviewPackage(), {
    registeredAt: '2026-07-29T17:02:00.000Z',
    artifactType: 'review_package'
  });
  const second = registry.registerArtifact(first.registry, reviewPackage({
    packageId: 'review-package-002',
    packageFingerprint: 'review-package-fingerprint-002',
    listingId: 'listing-002'
  }), {
    registeredAt: '2026-07-29T17:03:00.000Z',
    artifactType: 'review_package'
  });
  const baseLifecycle = lifecycle.createLifecycle({
    lifecycleId: 'review-session-conformance-lifecycle',
    registryId: second.registry.registryId,
    registryFingerprint: second.registry.registryFingerprint,
    createdAt: '2026-07-29T17:04:00.000Z'
  });
  const registered = lifecycle.registerLifecycleEvent(baseLifecycle, {
    eventType: 'registered',
    artifactId: 'review-package-001',
    artifactFingerprint: 'review-package-fingerprint-001',
    eventAt: '2026-07-29T17:05:00.000Z'
  }, { registry: second.registry });
  const active = lifecycle.registerLifecycleEvent(registered.lifecycle, {
    eventType: 'activated',
    artifactId: 'review-package-001',
    artifactFingerprint: 'review-package-fingerprint-001',
    eventAt: '2026-07-29T17:06:00.000Z'
  }, { registry: second.registry });
  const session = sessions.attachReviewPackage(sessions.createReviewSession({
    sessionId: 'review-session-conformance-fixture',
    createdAt: '2026-07-29T17:07:00.000Z'
  }), reviewPackage(), {
    registry: second.registry,
    lifecycle: active.lifecycle,
    attachedAt: '2026-07-29T17:08:00.000Z'
  }).session;
  return { registry: second.registry, lifecycle: active.lifecycle, session };
}

test('exports Governance Review Session Conformance public APIs', () => {
  assert.equal(typeof conformance.validateReviewSessionConformance, 'function');
  assert.equal(typeof conformance.validateSessionStateModel, 'function');
  assert.equal(typeof conformance.validatePackageBindings, 'function');
  assert.equal(typeof conformance.validateSessionDeterminism, 'function');
  assert.equal(typeof conformance.validateSessionIntegrity, 'function');
  assert.equal(typeof conformance.summarizeReviewSessionConformance, 'function');
});

test('valid review session passes complete conformance without mutating inputs', () => {
  const context = buildContext();
  const before = JSON.stringify(context.session);
  const report = conformance.validateReviewSessionConformance(context.session, {
    registry: context.registry,
    lifecycle: context.lifecycle
  });

  assert.equal(report.valid, true);
  assert.equal(Object.isFrozen(report), true);
  assert.equal(report.stageResults.length, conformance.CONFORMANCE_STAGES.length);
  assert.equal(report.summary.failedStageCount, 0);
  assert.equal(report.productionImpact, 'none');
  assert.equal(report.decisionImpact, 'none');
  assert.equal(report.executionAuthority, 'none');
  assert.equal(JSON.stringify(context.session), before);
});

test('validates immutable session state model', () => {
  const { session } = buildContext();
  const result = conformance.validateSessionStateModel(session);

  assert.equal(result.valid, true);
  assert.deepEqual(result.immutableViolations, []);
});

test('detects invalid session state model drift', () => {
  const { session } = buildContext();
  const result = conformance.validateSessionStateModel({
    ...session,
    sessionStatus: 'unsupported_status'
  });

  assert.equal(result.valid, false);
  assert.equal(result.reasonCodes.includes('invalid_session_status'), true);
});

test('validates package bindings and duplicate rejection through public APIs', () => {
  const context = buildContext();
  const result = conformance.validatePackageBindings(context.session, {
    registry: context.registry,
    lifecycle: context.lifecycle
  });

  assert.equal(result.valid, true);
  assert.deepEqual(result.bindingViolations, []);
});

test('detects broken package binding references', () => {
  const context = buildContext();
  const result = conformance.validatePackageBindings({
    ...context.session,
    reviewPackages: [
      {
        ...context.session.reviewPackages[0],
        packageId: 'missing-package',
        referenceFingerprint: sessions.buildReviewPackageReferenceFingerprint({
          ...context.session.reviewPackages[0],
          packageId: 'missing-package'
        })
      }
    ]
  }, {
    registry: context.registry,
    lifecycle: context.lifecycle
  });

  assert.equal(result.valid, false);
  assert.equal(result.reasonCodes.includes('package_not_registered'), true);
  assert.equal(result.reasonCodes.includes('lifecycle_state_mismatch'), true);
});

test('validates deterministic state, summary, and fingerprints', () => {
  const { session } = buildContext();
  const valid = conformance.validateSessionDeterminism(session);
  const drifted = conformance.validateSessionDeterminism({
    ...session,
    reviewPackages: [
      {
        ...session.reviewPackages[0],
        packageId: 'changed-package'
      }
    ]
  });

  assert.equal(valid.valid, true);
  assert.equal(drifted.valid, false);
  assert.equal(drifted.reasonCodes.includes('session_fingerprint_mismatch'), true);
  assert.equal(drifted.reasonCodes.includes('reference_fingerprint_mismatch'), true);
});

test('validates session integrity through manager validator', () => {
  const context = buildContext();
  const valid = conformance.validateSessionIntegrity(context.session, {
    registry: context.registry,
    lifecycle: context.lifecycle
  });
  const invalid = conformance.validateSessionIntegrity({
    ...context.session,
    executionAuthority: 'approve_changes'
  }, {
    registry: context.registry,
    lifecycle: context.lifecycle
  });

  assert.equal(valid.valid, true);
  assert.equal(invalid.valid, false);
  assert.equal(invalid.reasonCodes.includes('authority_boundary_violation'), true);
});

test('conformance reports authority boundary violations', () => {
  const context = buildContext();
  const report = conformance.validateReviewSessionConformance({
    ...context.session,
    reviewPackages: [
      {
        ...context.session.reviewPackages[0],
        decisionImpact: 'changes_decision'
      }
    ]
  }, {
    registry: context.registry,
    lifecycle: context.lifecycle
  });

  assert.equal(report.valid, false);
  assert.equal(report.reasonCodes.includes('authority_boundary_violation'), true);
});

test('summary is deterministic and structured', () => {
  const context = buildContext();
  const first = conformance.validateReviewSessionConformance(context.session, {
    registry: context.registry,
    lifecycle: context.lifecycle
  });
  const second = conformance.validateReviewSessionConformance(context.session, {
    registry: context.registry,
    lifecycle: context.lifecycle
  });
  const summary = conformance.summarizeReviewSessionConformance(first);

  assert.deepEqual(first.summary, second.summary);
  assert.equal(summary.stageCount, conformance.CONFORMANCE_STAGES.length);
  assert.equal(summary.productionImpact, 'none');
});

test('conformance module remains offline and avoids runtime imports', () => {
  const loaded = new Set();
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    loaded.add(request);
    return originalLoad.apply(this, arguments);
  };
  try {
    delete require.cache[require.resolve('../validation/governanceReviewSessionConformance')];
    require('../validation/governanceReviewSessionConformance');
  } finally {
    Module._load = originalLoad;
  }

  assert.equal([...loaded].some((item) => item.includes('server.js')), false);
  assert.equal([...loaded].some((item) => item.includes('stateStore')), false);
  assert.equal([...loaded].some((item) => item.includes('scoutScannerService')), false);
});
