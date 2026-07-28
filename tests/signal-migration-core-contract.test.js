'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const contract = require('../validation/signalMigrationCoreContract');

function completeArtifact(overrides = {}) {
  return contract.createSignalMigrationArtifact({
    migrationId: 'grade-premium-core-artifact',
    createdAt: '2026-07-28T19:00:00.000Z',
    engineName: 'gradePremiumEngine',
    engineVersion: '1.2',
    nativeOutputFingerprint: 'native-fingerprint',
    canonicalSignalFingerprint: 'signal-fingerprint',
    alignmentFingerprint: 'alignment-fingerprint',
    batchFingerprint: 'batch-fingerprint',
    runFingerprint: 'run-fingerprint',
    reportFingerprint: 'report-fingerprint',
    parityStatus: 'preserved',
    registryStatus: 'matched',
    warnings: [],
    errors: [],
    metadata: {
      wrapperOnly: true,
      nativeEngineExecuted: false
    },
    ...overrides
  });
}

test('exports Signal Migration Core Contract public API and constants', () => {
  assert.equal(contract.SIGNAL_MIGRATION_CORE_SOURCE, 'signal_migration_core_contract');
  assert.equal(contract.SIGNAL_MIGRATION_CORE_SCHEMA_VERSION, '1.0.0');
  assert.deepEqual(contract.MIGRATION_LIFECYCLE_STATUSES, [
    'initialized',
    'adapted',
    'aligned',
    'batched',
    'reported',
    'validated',
    'blocked',
    'invalid'
  ]);
  assert.equal(typeof contract.createSignalMigrationArtifact, 'function');
  assert.equal(typeof contract.validateSignalMigrationArtifact, 'function');
  assert.equal(typeof contract.cloneSignalMigrationArtifact, 'function');
  assert.equal(typeof contract.buildSignalMigrationFingerprint, 'function');
  assert.equal(typeof contract.determineMigrationLifecycleStatus, 'function');
});

test('creates and validates a minimum immutable artifact with explicit unknown values', () => {
  const artifact = contract.createSignalMigrationArtifact({
    migrationId: 'minimum-core-artifact',
    createdAt: '2026-07-28T19:01:00.000Z',
    engineName: 'unknownEngine'
  });
  const validation = contract.validateSignalMigrationArtifact(artifact);

  assert.equal(Object.isFrozen(artifact), true);
  assert.equal(validation.valid, true);
  assert.equal(artifact.lifecycleStatus, 'initialized');
  assert.equal(artifact.engineVersion, 'unknown');
  assert.equal(artifact.nativeOutputFingerprint, 'unknown');
  assert.equal(artifact.canonicalSignalFingerprint, 'unknown');
  assert.equal(artifact.productionImpact, 'none');
  assert.equal(artifact.decisionImpact, 'none');
  assert.equal(artifact.executionAuthority, 'none');
});

test('creates a complete deterministic validated artifact without mutating input', () => {
  const input = {
    migrationId: 'complete-core-artifact',
    createdAt: '2026-07-28T19:02:00.000Z',
    engineName: 'populationEngine',
    engineVersion: 'population_engine_v2',
    nativeOutputFingerprint: 'native',
    canonicalSignalFingerprint: 'canonical',
    alignmentFingerprint: 'alignment',
    batchFingerprint: 'batch',
    runFingerprint: 'run',
    reportFingerprint: 'report',
    parityStatus: 'semantic_match',
    registryStatus: 'matched',
    warnings: [{ code: 'observational_warning', message: 'For review only.', field: 'metadata' }]
  };
  const before = JSON.parse(JSON.stringify(input));
  const first = contract.createSignalMigrationArtifact(input);
  const second = contract.createSignalMigrationArtifact(input);

  assert.deepEqual(input, before);
  assert.deepEqual(first, second);
  assert.equal(first.lifecycleStatus, 'validated');
  assert.equal(contract.validateSignalMigrationArtifact(first).valid, true);
  assert.equal(first.migrationFingerprint, contract.buildSignalMigrationFingerprint(first));
});

test('determines lifecycle transitions from available artifact fingerprints', () => {
  assert.equal(contract.determineMigrationLifecycleStatus({}), 'initialized');
  assert.equal(contract.determineMigrationLifecycleStatus({ canonicalSignalFingerprint: 'signal' }), 'adapted');
  assert.equal(contract.determineMigrationLifecycleStatus({ canonicalSignalFingerprint: 'signal', alignmentFingerprint: 'alignment' }), 'aligned');
  assert.equal(contract.determineMigrationLifecycleStatus({ canonicalSignalFingerprint: 'signal', alignmentFingerprint: 'alignment', batchFingerprint: 'batch' }), 'batched');
  assert.equal(contract.determineMigrationLifecycleStatus({ reportFingerprint: 'report', registryStatus: 'unknown', parityStatus: 'unknown' }), 'reported');
  assert.equal(contract.determineMigrationLifecycleStatus({ reportFingerprint: 'report', registryStatus: 'matched', parityStatus: 'preserved' }), 'validated');
  assert.equal(contract.determineMigrationLifecycleStatus({ reportFingerprint: 'report', registryStatus: 'definition_missing', parityStatus: 'preserved' }), 'blocked');
  assert.equal(contract.determineMigrationLifecycleStatus({ reportFingerprint: 'report', registryStatus: 'matched', parityStatus: 'changed' }), 'invalid');
});

test('cloneSignalMigrationArtifact returns an independent mutable copy', () => {
  const artifact = completeArtifact();
  const cloned = contract.cloneSignalMigrationArtifact(artifact);

  cloned.engineName = 'changed';
  cloned.metadata.wrapperOnly = false;

  assert.equal(artifact.engineName, 'gradePremiumEngine');
  assert.equal(artifact.metadata.wrapperOnly, true);
  assert.equal(cloned.engineName, 'changed');
});

test('validation rejects invalid enums and stale fingerprints', () => {
  const artifact = completeArtifact();
  const tampered = {
    ...artifact,
    parityStatus: 'not-real',
    registryStatus: 'also-not-real'
  };
  const validation = contract.validateSignalMigrationArtifact(tampered);

  assert.equal(validation.valid, false);
  assert.equal(validation.reasonCodes.includes('invalid_parity_status'), true);
  assert.equal(validation.reasonCodes.includes('invalid_registry_status'), true);
  assert.equal(validation.fingerprintViolations.includes('migrationFingerprint'), true);
});

test('validation reports lifecycle drift deterministically', () => {
  const artifact = completeArtifact();
  const tampered = {
    ...artifact,
    lifecycleStatus: 'reported'
  };
  const validation = contract.validateSignalMigrationArtifact(tampered);

  assert.equal(validation.valid, false);
  assert.equal(validation.reasonCodes.includes('lifecycle_status_drift'), true);
  assert.equal(validation.fingerprintViolations.includes('migrationFingerprint'), true);
  assert.equal(validation.lifecycleViolations.includes('lifecycleStatus'), true);
});

test('validation enforces authority boundaries without granting production authority', () => {
  const artifact = completeArtifact();
  const tampered = {
    ...artifact,
    productionImpact: 'changes_production',
    decisionImpact: 'changes_decision',
    executionAuthority: 'may_execute'
  };
  const validation = contract.validateSignalMigrationArtifact(tampered);

  assert.equal(validation.valid, false);
  assert.deepEqual(validation.authorityViolations, ['decisionImpact', 'executionAuthority', 'productionImpact']);
  assert.equal(validation.reasonCodes.includes('authority_boundary_violation'), true);
});

test('explicit unknown values remain explicit and deterministic', () => {
  const first = contract.createSignalMigrationArtifact({
    migrationId: 'unknown-core-artifact',
    createdAt: 'unknown',
    engineName: '',
    parityStatus: 'unknown',
    registryStatus: 'unknown'
  });
  const second = contract.createSignalMigrationArtifact({
    migrationId: 'unknown-core-artifact',
    createdAt: 'unknown',
    engineName: '',
    parityStatus: 'unknown',
    registryStatus: 'unknown'
  });

  assert.equal(first.engineName, 'unknown');
  assert.equal(first.createdAt, 'unknown');
  assert.equal(first.parityStatus, 'unknown');
  assert.equal(first.registryStatus, 'unknown');
  assert.deepEqual(first, second);
});

test('module does not import runtime, scanner, or engine modules', () => {
  const loaded = new Set();
  const originalLoad = Module._load;
  Module._load = function trackingLoad(request, parent, isMain) {
    loaded.add(request);
    return originalLoad.apply(this, arguments);
  };

  delete require.cache[require.resolve('../validation/signalMigrationCoreContract')];
  require('../validation/signalMigrationCoreContract');
  Module._load = originalLoad;

  assert.equal([...loaded].some((request) => request.includes('server')), false);
  assert.equal([...loaded].some((request) => request.includes('scoutScannerService')), false);
  assert.equal([...loaded].some((request) => request.includes('engines/')), false);
});
