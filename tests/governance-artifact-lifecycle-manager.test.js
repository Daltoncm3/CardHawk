'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const registry = require('../validation/governanceArtifactRegistry');
const lifecycle = require('../validation/governanceArtifactLifecycleManager');

function evidenceBundle(overrides = {}) {
  return {
    schemaVersion: '1.0.0',
    source: 'signal_governance_evidence_bundle',
    bundleId: 'bundle-001',
    createdAt: '2026-07-29T14:00:00.000Z',
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none',
    bundleFingerprint: 'bundle-fingerprint-001',
    ...overrides
  };
}

function buildRegistry() {
  const first = registry.registerArtifact(registry.createGovernanceArtifactRegistry({
    registryId: 'lifecycle-registry',
    createdAt: '2026-07-29T14:05:00.000Z'
  }), evidenceBundle(), {
    registeredAt: '2026-07-29T14:06:00.000Z'
  });
  const second = registry.registerArtifact(first.registry, evidenceBundle({
    bundleId: 'bundle-002',
    bundleFingerprint: 'bundle-fingerprint-002'
  }), {
    registeredAt: '2026-07-29T14:07:00.000Z',
    supersedesArtifactId: 'bundle-001',
    supersedesArtifactFingerprint: 'bundle-fingerprint-001'
  });
  return second.registry;
}

test('exports Governance Artifact Lifecycle Manager public APIs', () => {
  assert.equal(typeof lifecycle.registerLifecycleEvent, 'function');
  assert.equal(typeof lifecycle.validateLifecycleTransition, 'function');
  assert.equal(typeof lifecycle.getLifecycleState, 'function');
  assert.equal(typeof lifecycle.detectSupersededArtifacts, 'function');
  assert.equal(typeof lifecycle.summarizeLifecycle, 'function');
  assert.equal(typeof lifecycle.validateLifecycleIntegrity, 'function');
});

test('registers immutable lifecycle events without mutating prior lifecycle', () => {
  const reg = buildRegistry();
  const base = lifecycle.createLifecycle({
    lifecycleId: 'phase-16-lifecycle',
    registryId: reg.registryId,
    registryFingerprint: reg.registryFingerprint,
    createdAt: '2026-07-29T14:10:00.000Z'
  });
  const first = lifecycle.registerLifecycleEvent(base, {
    eventType: 'registered',
    artifactId: 'bundle-001',
    artifactFingerprint: 'bundle-fingerprint-001',
    eventAt: '2026-07-29T14:11:00.000Z'
  }, { registry: reg });

  assert.equal(first.registered, true);
  assert.equal(Object.isFrozen(first.lifecycle), true);
  assert.equal(base.summary.eventCount, 0);
  assert.equal(first.lifecycle.summary.eventCount, 1);
  assert.equal(lifecycle.getLifecycleState(first.lifecycle, 'bundle-001').currentState, 'registered');
});

test('supports active, superseded, and archived transitions deterministically', () => {
  const reg = buildRegistry();
  const base = lifecycle.createLifecycle({
    lifecycleId: 'phase-16-lifecycle',
    registryId: reg.registryId,
    registryFingerprint: reg.registryFingerprint,
    createdAt: '2026-07-29T14:10:00.000Z'
  });
  const registered = lifecycle.registerLifecycleEvent(base, {
    eventType: 'registered',
    artifactId: 'bundle-001',
    artifactFingerprint: 'bundle-fingerprint-001',
    eventAt: '2026-07-29T14:11:00.000Z'
  }, { registry: reg });
  const active = lifecycle.registerLifecycleEvent(registered.lifecycle, {
    eventType: 'activated',
    artifactId: 'bundle-001',
    artifactFingerprint: 'bundle-fingerprint-001',
    eventAt: '2026-07-29T14:12:00.000Z'
  }, { registry: reg });
  const superseded = lifecycle.registerLifecycleEvent(active.lifecycle, {
    eventType: 'superseded',
    artifactId: 'bundle-001',
    artifactFingerprint: 'bundle-fingerprint-001',
    eventAt: '2026-07-29T14:13:00.000Z',
    reason: 'bundle-002 supersedes bundle-001'
  }, { registry: reg });
  const archived = lifecycle.registerLifecycleEvent(superseded.lifecycle, {
    eventType: 'archived',
    artifactId: 'bundle-001',
    artifactFingerprint: 'bundle-fingerprint-001',
    eventAt: '2026-07-29T14:14:00.000Z'
  }, { registry: reg });

  assert.equal(active.registered, true);
  assert.equal(superseded.registered, true);
  assert.equal(archived.registered, true);
  assert.equal(lifecycle.getLifecycleState(archived.lifecycle, 'bundle-001').currentState, 'archived');
  assert.deepEqual(lifecycle.summarizeLifecycle(archived.lifecycle).stateSummary, { archived: 1 });
});

test('rejects invalid lifecycle transitions', () => {
  const reg = buildRegistry();
  const base = lifecycle.createLifecycle({
    registryId: reg.registryId,
    registryFingerprint: reg.registryFingerprint,
    createdAt: '2026-07-29T14:10:00.000Z'
  });
  const registered = lifecycle.registerLifecycleEvent(base, {
    eventType: 'registered',
    artifactId: 'bundle-001',
    artifactFingerprint: 'bundle-fingerprint-001',
    eventAt: '2026-07-29T14:11:00.000Z'
  }, { registry: reg });
  const archived = lifecycle.registerLifecycleEvent(registered.lifecycle, {
    eventType: 'archived',
    artifactId: 'bundle-001',
    artifactFingerprint: 'bundle-fingerprint-001',
    eventAt: '2026-07-29T14:12:00.000Z'
  }, { registry: reg });
  const invalid = lifecycle.registerLifecycleEvent(archived.lifecycle, {
    eventType: 'activated',
    artifactId: 'bundle-001',
    artifactFingerprint: 'bundle-fingerprint-001',
    eventAt: '2026-07-29T14:13:00.000Z'
  }, { registry: reg });

  assert.equal(invalid.registered, false);
  assert.equal(invalid.validation.reasonCodes.includes('invalid_lifecycle_transition'), true);
});

test('validates registry binding through public registry APIs', () => {
  const reg = buildRegistry();
  const base = lifecycle.createLifecycle({
    registryId: reg.registryId,
    registryFingerprint: reg.registryFingerprint,
    createdAt: '2026-07-29T14:10:00.000Z'
  });
  const missing = lifecycle.validateLifecycleTransition(base, {
    eventType: 'registered',
    artifactId: 'missing-bundle',
    artifactFingerprint: 'missing-fingerprint',
    eventAt: '2026-07-29T14:11:00.000Z'
  }, { registry: reg });
  const mismatch = lifecycle.validateLifecycleTransition(base, {
    eventType: 'registered',
    artifactId: 'bundle-001',
    artifactFingerprint: 'wrong-fingerprint',
    eventAt: '2026-07-29T14:11:00.000Z'
  }, { registry: reg });

  assert.equal(missing.valid, false);
  assert.equal(missing.reasonCodes.includes('artifact_not_registered'), true);
  assert.equal(mismatch.valid, false);
  assert.equal(mismatch.reasonCodes.includes('artifact_fingerprint_mismatch'), true);
});

test('detects superseded artifacts using registry supersession data', () => {
  const reg = buildRegistry();
  const base = lifecycle.createLifecycle({
    registryId: reg.registryId,
    registryFingerprint: reg.registryFingerprint,
    createdAt: '2026-07-29T14:10:00.000Z'
  });
  const registered = lifecycle.registerLifecycleEvent(base, {
    eventType: 'registered',
    artifactId: 'bundle-001',
    artifactFingerprint: 'bundle-fingerprint-001',
    eventAt: '2026-07-29T14:11:00.000Z'
  }, { registry: reg });
  const superseded = lifecycle.detectSupersededArtifacts(registered.lifecycle, reg);

  assert.equal(superseded.length, 1);
  assert.equal(superseded[0].artifactId, 'bundle-001');
  assert.equal(superseded[0].supersededBy[0].artifactId, 'bundle-002');
});

test('validates lifecycle integrity and fingerprint drift', () => {
  const reg = buildRegistry();
  const base = lifecycle.createLifecycle({
    registryId: reg.registryId,
    registryFingerprint: reg.registryFingerprint,
    createdAt: '2026-07-29T14:10:00.000Z'
  });
  const registered = lifecycle.registerLifecycleEvent(base, {
    eventType: 'registered',
    artifactId: 'bundle-001',
    artifactFingerprint: 'bundle-fingerprint-001',
    eventAt: '2026-07-29T14:11:00.000Z'
  }, { registry: reg });
  const valid = lifecycle.validateLifecycleIntegrity(registered.lifecycle, { registry: reg });
  const drifted = lifecycle.validateLifecycleIntegrity({
    ...registered.lifecycle,
    events: [
      {
        ...registered.lifecycle.events[0],
        artifactId: 'changed-id'
      }
    ]
  }, { registry: reg });

  assert.equal(valid.valid, true);
  assert.equal(drifted.valid, false);
  assert.equal(drifted.reasonCodes.includes('lifecycle_fingerprint_mismatch'), true);
  assert.equal(drifted.reasonCodes.includes('event_fingerprint_mismatch'), true);
});

test('preserves non-authoritative lifecycle boundaries', () => {
  const reg = buildRegistry();
  const base = lifecycle.createLifecycle({
    registryId: reg.registryId,
    registryFingerprint: reg.registryFingerprint,
    createdAt: '2026-07-29T14:10:00.000Z'
  });
  const validation = lifecycle.validateLifecycleIntegrity({
    ...base,
    productionImpact: 'changes_runtime'
  });

  assert.equal(base.productionImpact, 'none');
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
    delete require.cache[require.resolve('../validation/governanceArtifactLifecycleManager')];
    require('../validation/governanceArtifactLifecycleManager');
  } finally {
    Module._load = originalLoad;
  }

  assert.equal([...loaded].some((item) => item.includes('server.js')), false);
  assert.equal([...loaded].some((item) => item.includes('stateStore')), false);
  assert.equal([...loaded].some((item) => item.includes('scoutScannerService')), false);
});
