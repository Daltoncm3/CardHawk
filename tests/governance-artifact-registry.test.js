'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const registry = require('../validation/governanceArtifactRegistry');

function evidenceBundle(overrides = {}) {
  return {
    schemaVersion: '1.0.0',
    source: 'signal_governance_evidence_bundle',
    bundleId: 'bundle-001',
    createdAt: '2026-07-29T12:00:00.000Z',
    reviewReference: {
      reviewPackageId: 'review-package-001',
      reviewPackageFingerprint: 'review-package-fingerprint'
    },
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none',
    bundleFingerprint: 'bundle-fingerprint-001',
    ...overrides
  };
}

function reviewReport(overrides = {}) {
  return {
    schemaVersion: '1.0.0',
    source: 'signal_governance_review_report',
    reportId: 'report-001',
    createdAt: '2026-07-29T12:05:00.000Z',
    evidenceBundleReference: {
      bundleId: 'bundle-001',
      bundleFingerprint: 'bundle-fingerprint-001'
    },
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none',
    reportFingerprint: 'report-fingerprint-001',
    ...overrides
  };
}

test('exports offline Governance Artifact Registry public APIs', () => {
  assert.equal(typeof registry.registerArtifact, 'function');
  assert.equal(typeof registry.getArtifact, 'function');
  assert.equal(typeof registry.getArtifactByFingerprint, 'function');
  assert.equal(typeof registry.listArtifacts, 'function');
  assert.equal(typeof registry.validateArtifactRegistration, 'function');
  assert.equal(typeof registry.detectSupersession, 'function');
  assert.equal(typeof registry.summarizeRegistry, 'function');
});

test('registers immutable Evidence Bundle artifacts with deterministic lookups', () => {
  const base = registry.createGovernanceArtifactRegistry({
    registryId: 'phase-16-governance-registry',
    createdAt: '2026-07-29T12:10:00.000Z'
  });
  const artifact = evidenceBundle();
  const result = registry.registerArtifact(base, artifact, {
    registeredAt: '2026-07-29T12:11:00.000Z'
  });

  artifact.reviewReference.reviewPackageId = 'mutated-after-registration';

  assert.equal(result.registered, true);
  assert.equal(Object.isFrozen(result.registry), true);
  assert.equal(base.summary.artifactCount, 0);
  assert.equal(result.registry.summary.artifactCount, 1);
  assert.equal(registry.getArtifact(result.registry, 'bundle-001').artifact.reviewReference.reviewPackageId, 'review-package-001');
  assert.equal(registry.getArtifactByFingerprint(result.registry, 'bundle-fingerprint-001').artifactId, 'bundle-001');
  assert.equal(result.registry.registryFingerprint, registry.buildGovernanceArtifactRegistryFingerprint(result.registry));
});

test('registers Governance Review Reports and supports stable filtering', () => {
  const first = registry.registerArtifact(registry.createGovernanceArtifactRegistry({
    createdAt: '2026-07-29T12:00:00.000Z'
  }), evidenceBundle(), {
    registeredAt: '2026-07-29T12:01:00.000Z'
  });
  const second = registry.registerArtifact(first.registry, reviewReport(), {
    registeredAt: '2026-07-29T12:06:00.000Z'
  });
  const reports = registry.listArtifacts(second.registry, {
    artifactType: 'signal_governance_review_report'
  });

  assert.equal(second.registered, true);
  assert.equal(second.registry.summary.artifactCount, 2);
  assert.equal(reports.length, 1);
  assert.equal(reports[0].artifactId, 'report-001');
  assert.deepEqual(registry.listArtifacts(second.registry).map((item) => item.artifactId), ['bundle-001', 'report-001']);
});

test('detects duplicate IDs, duplicate fingerprints, and exact duplicate registrations', () => {
  const first = registry.registerArtifact(registry.createGovernanceArtifactRegistry(), evidenceBundle(), {
    registeredAt: '2026-07-29T12:00:00.000Z'
  });
  const exactDuplicate = registry.registerArtifact(first.registry, evidenceBundle(), {
    registeredAt: '2026-07-29T12:00:00.000Z'
  });
  const idConflict = registry.registerArtifact(first.registry, evidenceBundle({
    bundleFingerprint: 'different-fingerprint'
  }), {
    registeredAt: '2026-07-29T12:01:00.000Z'
  });
  const fingerprintConflict = registry.registerArtifact(first.registry, evidenceBundle({
    bundleId: 'bundle-002'
  }), {
    registeredAt: '2026-07-29T12:02:00.000Z'
  });

  assert.equal(exactDuplicate.registered, false);
  assert.equal(exactDuplicate.validation.reasonCodes.includes('duplicate_existing_registration'), true);
  assert.equal(idConflict.registered, false);
  assert.equal(idConflict.validation.reasonCodes.includes('duplicate_artifact_id'), true);
  assert.equal(fingerprintConflict.registered, false);
  assert.equal(fingerprintConflict.validation.reasonCodes.includes('duplicate_artifact_fingerprint'), true);
});

test('validates required fields, authority boundaries, and fingerprints', () => {
  const registration = registry.createArtifactRegistration(evidenceBundle(), {
    registeredAt: '2026-07-29T12:00:00.000Z'
  });
  const valid = registry.validateArtifactRegistration(registration);
  const malformed = registry.validateArtifactRegistration({ artifactId: 'bad' });
  const authorityDrift = registry.validateArtifactRegistration({
    ...registration,
    productionImpact: 'changes_runtime'
  });
  const fingerprintDrift = registry.validateArtifactRegistration({
    ...registration,
    artifactId: 'changed'
  });

  assert.equal(valid.valid, true);
  assert.equal(malformed.valid, false);
  assert.equal(malformed.reasonCodes.includes('missing_required_field'), true);
  assert.equal(authorityDrift.valid, false);
  assert.deepEqual(authorityDrift.authorityViolations, ['productionImpact']);
  assert.equal(fingerprintDrift.valid, false);
  assert.deepEqual(fingerprintDrift.fingerprintViolations, ['registrationFingerprint']);
});

test('tracks supersession relationships without mutating previous registrations', () => {
  const first = registry.registerArtifact(registry.createGovernanceArtifactRegistry(), evidenceBundle(), {
    registeredAt: '2026-07-29T12:00:00.000Z'
  });
  const second = registry.registerArtifact(first.registry, evidenceBundle({
    bundleId: 'bundle-002',
    bundleFingerprint: 'bundle-fingerprint-002'
  }), {
    registeredAt: '2026-07-29T12:05:00.000Z',
    supersedesArtifactId: 'bundle-001',
    supersedesArtifactFingerprint: 'bundle-fingerprint-001'
  });
  const supersession = registry.detectSupersession(second.registry, 'bundle-001');

  assert.equal(second.registered, true);
  assert.equal(supersession.found, true);
  assert.equal(supersession.superseded, true);
  assert.equal(supersession.supersededBy.length, 1);
  assert.equal(supersession.supersededBy[0].artifactId, 'bundle-002');
  assert.equal(registry.getArtifact(second.registry, 'bundle-001').supersededByArtifactId, 'unknown');
});

test('summary is deterministic and authority neutral', () => {
  const first = registry.registerArtifact(registry.createGovernanceArtifactRegistry({
    registryId: 'summary-registry',
    createdAt: '2026-07-29T12:00:00.000Z'
  }), reviewReport(), {
    registeredAt: '2026-07-29T12:01:00.000Z'
  });
  const summary = registry.summarizeRegistry(first.registry);

  assert.equal(Object.isFrozen(summary), true);
  assert.equal(summary.artifactCount, 1);
  assert.equal(summary.typeSummary.signal_governance_review_report, 1);
  assert.equal(summary.productionImpact, 'none');
  assert.equal(summary.decisionImpact, 'none');
  assert.equal(summary.executionAuthority, 'none');
});

test('module stays offline and does not import runtime or persistence systems', () => {
  const loaded = new Set();
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    loaded.add(request);
    return originalLoad.apply(this, arguments);
  };
  try {
    delete require.cache[require.resolve('../validation/governanceArtifactRegistry')];
    require('../validation/governanceArtifactRegistry');
  } finally {
    Module._load = originalLoad;
  }

  assert.equal([...loaded].some((item) => item.includes('server.js')), false);
  assert.equal([...loaded].some((item) => item.includes('stateStore')), false);
  assert.equal([...loaded].some((item) => item.includes('scoutScannerService')), false);
});
