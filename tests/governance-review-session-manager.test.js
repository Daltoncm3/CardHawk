'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const registry = require('../validation/governanceArtifactRegistry');
const lifecycle = require('../validation/governanceArtifactLifecycleManager');
const sessions = require('../validation/governanceReviewSessionManager');

function reviewPackage(overrides = {}) {
  return {
    schemaVersion: '1.0.0',
    source: 'real_listing_decision_review_contract',
    packageId: 'review-package-001',
    listingId: 'listing-001',
    marketplace: 'ebay',
    createdAt: '2026-07-29T16:00:00.000Z',
    productionImpact: 'none',
    decisionImpact: 'none',
    packageFingerprint: 'review-package-fingerprint-001',
    ...overrides
  };
}

function buildRegistryAndLifecycle() {
  const first = registry.registerArtifact(registry.createGovernanceArtifactRegistry({
    registryId: 'review-session-registry',
    createdAt: '2026-07-29T16:01:00.000Z'
  }), reviewPackage(), {
    registeredAt: '2026-07-29T16:02:00.000Z',
    artifactType: 'review_package'
  });
  const second = registry.registerArtifact(first.registry, reviewPackage({
    packageId: 'review-package-002',
    packageFingerprint: 'review-package-fingerprint-002',
    listingId: 'listing-002'
  }), {
    registeredAt: '2026-07-29T16:03:00.000Z',
    artifactType: 'review_package'
  });
  const baseLifecycle = lifecycle.createLifecycle({
    lifecycleId: 'review-session-lifecycle',
    registryId: second.registry.registryId,
    registryFingerprint: second.registry.registryFingerprint,
    createdAt: '2026-07-29T16:04:00.000Z'
  });
  const firstEvent = lifecycle.registerLifecycleEvent(baseLifecycle, {
    eventType: 'registered',
    artifactId: 'review-package-001',
    artifactFingerprint: 'review-package-fingerprint-001',
    eventAt: '2026-07-29T16:05:00.000Z'
  }, { registry: second.registry });
  const active = lifecycle.registerLifecycleEvent(firstEvent.lifecycle, {
    eventType: 'activated',
    artifactId: 'review-package-001',
    artifactFingerprint: 'review-package-fingerprint-001',
    eventAt: '2026-07-29T16:06:00.000Z'
  }, { registry: second.registry });
  return { registry: second.registry, lifecycle: active.lifecycle };
}

test('exports Governance Review Session Manager public APIs', () => {
  assert.equal(typeof sessions.createReviewSession, 'function');
  assert.equal(typeof sessions.validateReviewSession, 'function');
  assert.equal(typeof sessions.attachReviewPackage, 'function');
  assert.equal(typeof sessions.getReviewSessionState, 'function');
  assert.equal(typeof sessions.summarizeReviewSession, 'function');
  assert.equal(typeof sessions.validateReviewSessionIntegrity, 'function');
});

test('creates immutable empty review sessions', () => {
  const session = sessions.createReviewSession({
    sessionId: 'session-001',
    createdAt: '2026-07-29T16:10:00.000Z',
    reviewer: 'Dalton'
  });

  assert.equal(Object.isFrozen(session), true);
  assert.equal(session.sessionStatus, 'empty');
  assert.equal(session.summary.packageCount, 0);
  assert.equal(session.productionImpact, 'none');
});

test('attaches immutable Review Package references through registry and lifecycle public APIs', () => {
  const { registry: reg, lifecycle: life } = buildRegistryAndLifecycle();
  const base = sessions.createReviewSession({
    sessionId: 'session-001',
    createdAt: '2026-07-29T16:10:00.000Z'
  });
  const result = sessions.attachReviewPackage(base, reviewPackage(), {
    registry: reg,
    lifecycle: life,
    attachedAt: '2026-07-29T16:11:00.000Z'
  });

  assert.equal(result.attached, true);
  assert.equal(base.summary.packageCount, 0);
  assert.equal(result.session.summary.packageCount, 1);
  assert.equal(result.reference.lifecycleState, 'active');
  assert.equal(result.reference.reviewReadiness, 'review_ready');
  assert.equal(Object.isFrozen(result.session), true);
});

test('supports multiple Review Packages per session deterministically', () => {
  const { registry: reg, lifecycle: life } = buildRegistryAndLifecycle();
  const base = sessions.createReviewSession({
    sessionId: 'session-001',
    createdAt: '2026-07-29T16:10:00.000Z'
  });
  const first = sessions.attachReviewPackage(base, reviewPackage(), {
    registry: reg,
    lifecycle: life,
    attachedAt: '2026-07-29T16:11:00.000Z'
  });
  const second = sessions.attachReviewPackage(first.session, reviewPackage({
    packageId: 'review-package-002',
    packageFingerprint: 'review-package-fingerprint-002',
    listingId: 'listing-002'
  }), {
    registry: reg,
    lifecycle: life,
    attachedAt: '2026-07-29T16:12:00.000Z'
  });

  assert.equal(second.attached, true);
  assert.deepEqual(second.session.reviewPackages.map((item) => item.packageId), ['review-package-001', 'review-package-002']);
  assert.equal(sessions.summarizeReviewSession(second.session).packageCount, 2);
});

test('rejects duplicate Review Package references', () => {
  const { registry: reg, lifecycle: life } = buildRegistryAndLifecycle();
  const base = sessions.createReviewSession({
    sessionId: 'session-001',
    createdAt: '2026-07-29T16:10:00.000Z'
  });
  const first = sessions.attachReviewPackage(base, reviewPackage(), {
    registry: reg,
    lifecycle: life,
    attachedAt: '2026-07-29T16:11:00.000Z'
  });
  const duplicate = sessions.attachReviewPackage(first.session, reviewPackage(), {
    registry: reg,
    lifecycle: life,
    attachedAt: '2026-07-29T16:12:00.000Z'
  });

  assert.equal(duplicate.attached, false);
  assert.equal(duplicate.validation.reasonCodes.includes('duplicate_review_package_id'), true);
  assert.equal(duplicate.validation.reasonCodes.includes('duplicate_review_package_fingerprint'), true);
});

test('validates missing registry and lifecycle mismatch failures', () => {
  const { registry: reg, lifecycle: life } = buildRegistryAndLifecycle();
  const base = sessions.createReviewSession({
    sessionId: 'session-001',
    createdAt: '2026-07-29T16:10:00.000Z'
  });
  const missing = sessions.attachReviewPackage(base, reviewPackage({
    packageId: 'missing-package',
    packageFingerprint: 'missing-fingerprint'
  }), {
    registry: reg,
    lifecycle: life,
    attachedAt: '2026-07-29T16:11:00.000Z'
  });
  const valid = sessions.attachReviewPackage(base, reviewPackage(), {
    registry: reg,
    lifecycle: life,
    attachedAt: '2026-07-29T16:11:00.000Z'
  });
  const drifted = sessions.validateReviewSession({
    ...valid.session,
    reviewPackages: [
      {
        ...valid.session.reviewPackages[0],
        lifecycleState: 'archived',
        referenceFingerprint: sessions.buildReviewPackageReferenceFingerprint({
          ...valid.session.reviewPackages[0],
          lifecycleState: 'archived'
        })
      }
    ]
  }, { registry: reg, lifecycle: life });

  assert.equal(missing.attached, false);
  assert.equal(missing.validation.reasonCodes.includes('package_not_registered'), true);
  assert.equal(drifted.valid, false);
  assert.equal(drifted.reasonCodes.includes('lifecycle_state_mismatch'), true);
});

test('derives deterministic review session state and summary', () => {
  const { registry: reg, lifecycle: life } = buildRegistryAndLifecycle();
  const attached = sessions.attachReviewPackage(sessions.createReviewSession({
    sessionId: 'session-001',
    createdAt: '2026-07-29T16:10:00.000Z'
  }), reviewPackage(), {
    registry: reg,
    lifecycle: life,
    attachedAt: '2026-07-29T16:11:00.000Z'
  });
  const state = sessions.getReviewSessionState(attached.session);
  const firstSummary = sessions.summarizeReviewSession(attached.session);
  const secondSummary = sessions.summarizeReviewSession(attached.session);

  assert.equal(state.sessionStatus, 'review_ready');
  assert.equal(state.readyPackages, 1);
  assert.deepEqual(firstSummary, secondSummary);
});

test('validates session integrity and fingerprint drift', () => {
  const { registry: reg, lifecycle: life } = buildRegistryAndLifecycle();
  const attached = sessions.attachReviewPackage(sessions.createReviewSession({
    sessionId: 'session-001',
    createdAt: '2026-07-29T16:10:00.000Z'
  }), reviewPackage(), {
    registry: reg,
    lifecycle: life,
    attachedAt: '2026-07-29T16:11:00.000Z'
  });
  const valid = sessions.validateReviewSessionIntegrity(attached.session, { registry: reg, lifecycle: life });
  const drifted = sessions.validateReviewSessionIntegrity({
    ...attached.session,
    reviewPackages: [
      {
        ...attached.session.reviewPackages[0],
        packageId: 'changed-package'
      }
    ]
  }, { registry: reg, lifecycle: life });

  assert.equal(valid.valid, true);
  assert.equal(drifted.valid, false);
  assert.equal(drifted.reasonCodes.includes('session_fingerprint_mismatch'), true);
  assert.equal(drifted.reasonCodes.includes('reference_fingerprint_mismatch'), true);
});

test('preserves non-authoritative session boundaries', () => {
  const session = sessions.createReviewSession({
    sessionId: 'session-001',
    createdAt: '2026-07-29T16:10:00.000Z'
  });
  const validation = sessions.validateReviewSession({
    ...session,
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
    delete require.cache[require.resolve('../validation/governanceReviewSessionManager')];
    require('../validation/governanceReviewSessionManager');
  } finally {
    Module._load = originalLoad;
  }

  assert.equal([...loaded].some((item) => item.includes('server.js')), false);
  assert.equal([...loaded].some((item) => item.includes('stateStore')), false);
  assert.equal([...loaded].some((item) => item.includes('scoutScannerService')), false);
});
