'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const registry = require('../validation/governanceArtifactRegistry');
const lifecycle = require('../validation/governanceArtifactLifecycleManager');
const conformance = require('../validation/governanceArtifactLifecycleConformance');

function evidenceBundle(overrides = {}) {
  return {
    schemaVersion: '1.0.0',
    source: 'signal_governance_evidence_bundle',
    bundleId: 'bundle-001',
    createdAt: '2026-07-29T15:00:00.000Z',
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none',
    bundleFingerprint: 'bundle-fingerprint-001',
    ...overrides
  };
}

function buildRegistry() {
  const first = registry.registerArtifact(registry.createGovernanceArtifactRegistry({
    registryId: 'lifecycle-conformance-registry',
    createdAt: '2026-07-29T15:00:00.000Z'
  }), evidenceBundle(), {
    registeredAt: '2026-07-29T15:01:00.000Z'
  });
  return registry.registerArtifact(first.registry, evidenceBundle({
    bundleId: 'bundle-002',
    bundleFingerprint: 'bundle-fingerprint-002'
  }), {
    registeredAt: '2026-07-29T15:02:00.000Z',
    supersedesArtifactId: 'bundle-001',
    supersedesArtifactFingerprint: 'bundle-fingerprint-001'
  }).registry;
}

function buildLifecycle(reg) {
  const base = lifecycle.createLifecycle({
    lifecycleId: 'lifecycle-conformance-fixture',
    registryId: reg.registryId,
    registryFingerprint: reg.registryFingerprint,
    createdAt: '2026-07-29T15:03:00.000Z'
  });
  const registered = lifecycle.registerLifecycleEvent(base, {
    eventType: 'registered',
    artifactId: 'bundle-001',
    artifactFingerprint: 'bundle-fingerprint-001',
    eventAt: '2026-07-29T15:04:00.000Z'
  }, { registry: reg });
  return lifecycle.registerLifecycleEvent(registered.lifecycle, {
    eventType: 'activated',
    artifactId: 'bundle-001',
    artifactFingerprint: 'bundle-fingerprint-001',
    eventAt: '2026-07-29T15:05:00.000Z'
  }, { registry: reg }).lifecycle;
}

test('exports Governance Artifact Lifecycle Conformance public APIs', () => {
  assert.equal(typeof conformance.validateLifecycleConformance, 'function');
  assert.equal(typeof conformance.validateLifecycleStateModel, 'function');
  assert.equal(typeof conformance.validateTransitionIntegrity, 'function');
  assert.equal(typeof conformance.validateSupersessionConsistency, 'function');
  assert.equal(typeof conformance.validateLifecycleDeterminism, 'function');
  assert.equal(typeof conformance.summarizeLifecycleConformance, 'function');
});

test('valid lifecycle passes complete conformance without mutating inputs', () => {
  const reg = buildRegistry();
  const subject = buildLifecycle(reg);
  const before = JSON.stringify(subject);
  const report = conformance.validateLifecycleConformance(subject, { registry: reg });

  assert.equal(report.valid, true);
  assert.equal(Object.isFrozen(report), true);
  assert.equal(report.stageResults.length, conformance.CONFORMANCE_STAGES.length);
  assert.equal(report.summary.failedStageCount, 0);
  assert.equal(report.productionImpact, 'none');
  assert.equal(report.decisionImpact, 'none');
  assert.equal(report.executionAuthority, 'none');
  assert.equal(JSON.stringify(subject), before);
});

test('validates lifecycle state model and immutable history', () => {
  const reg = buildRegistry();
  const subject = buildLifecycle(reg);
  const state = conformance.validateLifecycleStateModel(subject);

  assert.equal(state.valid, true);
  assert.deepEqual(state.immutableViolations, []);
});

test('detects invalid state model drift', () => {
  const reg = buildRegistry();
  const subject = buildLifecycle(reg);
  const drifted = conformance.validateLifecycleStateModel({
    ...subject,
    events: [
      {
        ...subject.events[0],
        nextState: 'unsupported_state'
      },
      subject.events[1]
    ]
  });

  assert.equal(drifted.valid, false);
  assert.equal(drifted.reasonCodes.includes('invalid_lifecycle_state'), true);
});

test('validates transition integrity and invalid transition rejection', () => {
  const reg = buildRegistry();
  const subject = buildLifecycle(reg);
  const result = conformance.validateTransitionIntegrity(subject, { registry: reg });

  assert.equal(result.valid, true);
  assert.deepEqual(result.transitionViolations, []);
});

test('detects broken transition history', () => {
  const reg = buildRegistry();
  const subject = buildLifecycle(reg);
  const broken = conformance.validateTransitionIntegrity({
    ...subject,
    events: [
      subject.events[0],
      {
        ...subject.events[1],
        nextState: 'archived'
      },
      {
        ...subject.events[1],
        eventId: 'bad-reactivation',
        eventType: 'activated',
        eventAt: '2026-07-29T15:06:00.000Z',
        priorState: 'archived'
      }
    ]
  }, { registry: reg });

  assert.equal(broken.valid, false);
  assert.equal(broken.reasonCodes.includes('invalid_lifecycle_transition'), true);
});

test('validates supersession consistency deterministically', () => {
  const reg = buildRegistry();
  const subject = buildLifecycle(reg);
  const result = conformance.validateSupersessionConsistency(subject, reg);

  assert.equal(result.valid, true);
  assert.equal(result.supersededArtifacts.length, 1);
  assert.equal(result.supersededArtifacts[0].artifactId, 'bundle-001');
});

test('validates lifecycle determinism and fingerprint preservation', () => {
  const reg = buildRegistry();
  const subject = buildLifecycle(reg);
  const valid = conformance.validateLifecycleDeterminism(subject);
  const drifted = conformance.validateLifecycleDeterminism({
    ...subject,
    events: [
      {
        ...subject.events[0],
        artifactId: 'changed-id'
      },
      subject.events[1]
    ]
  });

  assert.equal(valid.valid, true);
  assert.equal(drifted.valid, false);
  assert.equal(drifted.reasonCodes.includes('lifecycle_fingerprint_mismatch'), true);
  assert.equal(drifted.reasonCodes.includes('event_fingerprint_mismatch'), true);
});

test('conformance reports authority boundary violations', () => {
  const reg = buildRegistry();
  const subject = buildLifecycle(reg);
  const report = conformance.validateLifecycleConformance({
    ...subject,
    productionImpact: 'changes_runtime'
  }, { registry: reg });

  assert.equal(report.valid, false);
  assert.equal(report.reasonCodes.includes('authority_boundary_violation'), true);
});

test('summary is deterministic and structured', () => {
  const reg = buildRegistry();
  const subject = buildLifecycle(reg);
  const first = conformance.validateLifecycleConformance(subject, { registry: reg });
  const second = conformance.validateLifecycleConformance(subject, { registry: reg });
  const summary = conformance.summarizeLifecycleConformance(first);

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
    delete require.cache[require.resolve('../validation/governanceArtifactLifecycleConformance')];
    require('../validation/governanceArtifactLifecycleConformance');
  } finally {
    Module._load = originalLoad;
  }

  assert.equal([...loaded].some((item) => item.includes('server.js')), false);
  assert.equal([...loaded].some((item) => item.includes('stateStore')), false);
  assert.equal([...loaded].some((item) => item.includes('scoutScannerService')), false);
});
