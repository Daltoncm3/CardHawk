'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const registry = require('../validation/governanceArtifactRegistry');
const conformance = require('../validation/governanceArtifactRegistryConformance');

function evidenceBundle(overrides = {}) {
  return {
    schemaVersion: '1.0.0',
    source: 'signal_governance_evidence_bundle',
    bundleId: 'bundle-001',
    createdAt: '2026-07-29T13:00:00.000Z',
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
    createdAt: '2026-07-29T13:05:00.000Z',
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

function validRegistry() {
  const first = registry.registerArtifact(registry.createGovernanceArtifactRegistry({
    registryId: 'conformance-registry',
    createdAt: '2026-07-29T13:10:00.000Z'
  }), evidenceBundle(), {
    registeredAt: '2026-07-29T13:11:00.000Z'
  });
  return registry.registerArtifact(first.registry, reviewReport({
    reportId: 'report-002',
    reportFingerprint: 'report-fingerprint-002'
  }), {
    registeredAt: '2026-07-29T13:12:00.000Z',
    supersedesArtifactId: 'bundle-001',
    supersedesArtifactFingerprint: 'bundle-fingerprint-001'
  }).registry;
}

test('exports Governance Artifact Registry conformance public APIs', () => {
  assert.equal(typeof conformance.validateRegistryConformance, 'function');
  assert.equal(typeof conformance.validateArtifactIntegrity, 'function');
  assert.equal(typeof conformance.validateFingerprintConsistency, 'function');
  assert.equal(typeof conformance.validateSupersessionChain, 'function');
  assert.equal(typeof conformance.validateSchemaCompatibility, 'function');
  assert.equal(typeof conformance.summarizeConformanceResults, 'function');
});

test('valid registry passes complete conformance without mutating inputs', () => {
  const input = validRegistry();
  const before = JSON.stringify(input);
  const report = conformance.validateRegistryConformance(input);

  assert.equal(report.valid, true);
  assert.equal(Object.isFrozen(report), true);
  assert.equal(report.stageResults.length, conformance.CONFORMANCE_STAGES.length);
  assert.equal(report.summary.failedStageCount, 0);
  assert.equal(report.productionImpact, 'none');
  assert.equal(report.decisionImpact, 'none');
  assert.equal(report.executionAuthority, 'none');
  assert.equal(JSON.stringify(input), before);
});

test('validates artifact integrity and stable lookups', () => {
  const input = validRegistry();
  const integrity = conformance.validateArtifactIntegrity(input);
  const fingerprints = conformance.validateFingerprintConsistency(input);

  assert.equal(integrity.valid, true);
  assert.equal(fingerprints.valid, true);
  assert.deepEqual(fingerprints.fingerprintViolations, []);
});

test('detects duplicate registrations in malformed registry snapshots', () => {
  const input = validRegistry();
  const duplicate = {
    ...input,
    registrations: [
      ...input.registrations,
      {
        ...input.registrations[0],
        registrationId: 'manually-duplicated-registration',
        registrationFingerprint: registry.buildRegistrationFingerprint({
          ...input.registrations[0],
          registrationId: 'manually-duplicated-registration',
          registrationFingerprint: undefined
        })
      }
    ]
  };

  const integrity = conformance.validateArtifactIntegrity(duplicate);
  assert.equal(integrity.valid, false);
  assert.equal(integrity.reasonCodes.includes('duplicate_artifact_id'), true);
  assert.equal(integrity.reasonCodes.includes('duplicate_artifact_fingerprint'), true);
});

test('detects fingerprint drift at registry and registration levels', () => {
  const input = validRegistry();
  const drifted = {
    ...input,
    registrations: [
      {
        ...input.registrations[0],
        artifactId: 'changed-id'
      },
      input.registrations[1]
    ]
  };
  const fingerprints = conformance.validateFingerprintConsistency(drifted);

  assert.equal(fingerprints.valid, false);
  assert.equal(fingerprints.reasonCodes.includes('registry_fingerprint_mismatch'), true);
  assert.equal(fingerprints.reasonCodes.includes('registration_fingerprint_mismatch'), true);
});

test('validates supersession chain integrity', () => {
  const input = validRegistry();
  const valid = conformance.validateSupersessionChain(input);
  const broken = conformance.validateSupersessionChain({
    ...input,
    registrations: [
      {
        ...input.registrations[0],
        supersedesArtifactId: 'missing-artifact',
        registrationFingerprint: registry.buildRegistrationFingerprint({
          ...input.registrations[0],
          supersedesArtifactId: 'missing-artifact'
        })
      },
      input.registrations[1]
    ]
  });

  assert.equal(valid.valid, true);
  assert.equal(broken.valid, false);
  assert.equal(broken.reasonCodes.includes('missing_superseded_artifact'), true);
});

test('validates schema compatibility and non-authoritative behavior', () => {
  const input = validRegistry();
  const schema = conformance.validateSchemaCompatibility(input);
  const authorityDrift = conformance.validateRegistryConformance({
    ...input,
    registrations: [
      {
        ...input.registrations[0],
        decisionImpact: 'changes_decision'
      },
      input.registrations[1]
    ]
  });

  assert.equal(schema.valid, true);
  assert.equal(authorityDrift.valid, false);
  assert.equal(authorityDrift.reasonCodes.includes('authority_boundary_violation'), true);
});

test('conformance exercises duplicate rejection behavior through registry API', () => {
  const input = validRegistry();
  const report = conformance.validateRegistryConformance(input);
  const duplicateStage = report.stageResults.find((stage) => stage.stageName === 'duplicate_rejection');

  assert.equal(duplicateStage.valid, true);
  assert.deepEqual(duplicateStage.reasonCodes, []);
});

test('summary is deterministic and structured', () => {
  const input = validRegistry();
  const first = conformance.validateRegistryConformance(input);
  const second = conformance.validateRegistryConformance(input);
  const summary = conformance.summarizeConformanceResults(first);

  assert.deepEqual(first.summary, second.summary);
  assert.equal(summary.stageCount, conformance.CONFORMANCE_STAGES.length);
  assert.equal(summary.productionImpact, 'none');
});

test('conformance module stays offline and avoids runtime imports', () => {
  const loaded = new Set();
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    loaded.add(request);
    return originalLoad.apply(this, arguments);
  };
  try {
    delete require.cache[require.resolve('../validation/governanceArtifactRegistryConformance')];
    require('../validation/governanceArtifactRegistryConformance');
  } finally {
    Module._load = originalLoad;
  }

  assert.equal([...loaded].some((item) => item.includes('server.js')), false);
  assert.equal([...loaded].some((item) => item.includes('stateStore')), false);
  assert.equal([...loaded].some((item) => item.includes('scoutScannerService')), false);
});
