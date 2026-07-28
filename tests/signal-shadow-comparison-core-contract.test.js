'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const contract = require('../validation/signalShadowComparisonCoreContract');

function completeArtifact(overrides = {}) {
  return contract.createSignalShadowComparisonArtifact({
    comparisonId: 'grade-premium-shadow-core-comparison',
    createdAt: '2026-07-28T23:30:00.000Z',
    engineName: 'gradePremiumEngine',
    engineVersion: '1.2',
    signalName: 'grade.premium.engine',
    signalVersion: '1.2',
    nativeOutputFingerprint: 'native-fingerprint',
    migrationFingerprint: 'migration-fingerprint',
    canonicalSignalFingerprint: 'canonical-fingerprint',
    alignmentFingerprint: 'alignment-fingerprint',
    runFingerprint: 'run-fingerprint',
    reportFingerprint: 'report-fingerprint',
    exactParityStatus: 'exact_match',
    semanticParityStatus: 'exact_match',
    evidenceParityStatus: 'exact_match',
    confidenceParityStatus: 'exact_match',
    statusParityStatus: 'exact_match',
    metadataParityStatus: 'exact_match',
    authorityStatus: 'preserved',
    fingerprintStatus: 'valid',
    mismatchReasonCodes: [],
    warnings: [],
    errors: [],
    metadata: { wrapperOnly: true },
    ...overrides
  });
}

test('exports Signal Shadow Comparison Core Contract public API and constants', () => {
  assert.equal(contract.SIGNAL_SHADOW_COMPARISON_CORE_SOURCE, 'signal_shadow_comparison_core_contract');
  assert.equal(contract.SIGNAL_SHADOW_COMPARISON_CORE_SCHEMA_VERSION, '1.0.0');
  assert.deepEqual(contract.SHADOW_COMPARISON_STATUSES, [
    'initialized',
    'exact_match',
    'semantic_match',
    'mismatch',
    'blocked',
    'invalid'
  ]);
  assert.equal(typeof contract.createSignalShadowComparisonArtifact, 'function');
  assert.equal(typeof contract.validateSignalShadowComparisonArtifact, 'function');
  assert.equal(typeof contract.cloneSignalShadowComparisonArtifact, 'function');
  assert.equal(typeof contract.buildSignalShadowComparisonFingerprint, 'function');
  assert.equal(typeof contract.determineShadowComparisonStatus, 'function');
});

test('creates and validates a minimum comparison artifact with explicit unknown values', () => {
  const artifact = contract.createSignalShadowComparisonArtifact({
    comparisonId: 'minimum-shadow-comparison',
    createdAt: 'unknown'
  });
  const validation = contract.validateSignalShadowComparisonArtifact(artifact);

  assert.equal(Object.isFrozen(artifact), true);
  assert.equal(validation.valid, true);
  assert.equal(artifact.engineName, 'unknown');
  assert.equal(artifact.signalName, 'unknown');
  assert.equal(artifact.exactParityStatus, 'unknown');
  assert.equal(artifact.comparisonStatus, 'initialized');
  assert.equal(artifact.productionImpact, 'none');
  assert.equal(artifact.decisionImpact, 'none');
  assert.equal(artifact.executionAuthority, 'none');
});

test('creates a complete exact-match artifact with deterministic fingerprint', () => {
  const first = completeArtifact();
  const second = completeArtifact();
  const validation = contract.validateSignalShadowComparisonArtifact(first);

  assert.deepEqual(first, second);
  assert.equal(validation.valid, true);
  assert.equal(first.comparisonStatus, 'exact_match');
  assert.equal(first.comparisonFingerprint, contract.buildSignalShadowComparisonFingerprint(first));
});

test('semantic-match artifact remains distinct from exact-match artifact', () => {
  const artifact = completeArtifact({
    comparisonId: 'semantic-shadow-comparison',
    evidenceParityStatus: 'semantic_match',
    metadataParityStatus: 'semantic_match'
  });

  assert.equal(artifact.comparisonStatus, 'semantic_match');
  assert.equal(contract.validateSignalShadowComparisonArtifact(artifact).valid, true);
});

test('mismatch artifacts preserve mismatch reason-code ordering and evidence', () => {
  const artifact = completeArtifact({
    comparisonId: 'mismatch-shadow-comparison',
    exactParityStatus: 'mismatch',
    mismatchReasonCodes: ['z_reason', 'a_reason'],
    mismatches: [
      {
        code: 'z_reason',
        field: 'nativeOutput.populationCount',
        message: 'Changed native value.',
        nativeValue: 42,
        shadowValue: 43
      },
      {
        code: 'a_reason',
        field: 'canonicalSignal.rawOutput.source',
        message: 'Missing source.',
        nativeValue: 'population_engine',
        shadowValue: 'unknown'
      }
    ]
  });
  const validation = contract.validateSignalShadowComparisonArtifact(artifact);

  assert.equal(artifact.comparisonStatus, 'mismatch');
  assert.equal(artifact.mismatchCount, 2);
  assert.deepEqual(artifact.mismatchReasonCodes, ['a_reason', 'z_reason']);
  assert.deepEqual(artifact.mismatches.map((item) => item.code), ['a_reason', 'z_reason']);
  assert.equal(validation.valid, true);
});

test('blocked artifact is explicit and never grants authority', () => {
  const artifact = completeArtifact({
    comparisonId: 'blocked-shadow-comparison',
    exactParityStatus: 'blocked',
    authorityStatus: 'blocked'
  });

  assert.equal(artifact.comparisonStatus, 'blocked');
  assert.equal(artifact.productionImpact, 'none');
  assert.equal(artifact.decisionImpact, 'none');
  assert.equal(artifact.executionAuthority, 'none');
});

test('invalid parity and explicit errors produce invalid status', () => {
  const artifact = completeArtifact({
    comparisonId: 'invalid-shadow-comparison',
    exactParityStatus: 'invalid',
    errors: [{ code: 'invalid_source_reference', message: 'Source reference cannot be validated.', field: 'migrationFingerprint' }]
  });
  const validation = contract.validateSignalShadowComparisonArtifact(artifact);

  assert.equal(artifact.comparisonStatus, 'invalid');
  assert.equal(validation.valid, true);
});

test('cloneSignalShadowComparisonArtifact returns an independent mutable copy', () => {
  const artifact = completeArtifact({ metadata: { wrapperOnly: true } });
  const cloned = contract.cloneSignalShadowComparisonArtifact(artifact);

  cloned.engineName = 'changed';
  cloned.metadata.wrapperOnly = false;

  assert.equal(artifact.engineName, 'gradePremiumEngine');
  assert.equal(artifact.metadata.wrapperOnly, true);
  assert.equal(cloned.engineName, 'changed');
});

test('authority enforcement blocks unsafe comparison artifacts', () => {
  const artifact = completeArtifact();
  const tampered = {
    ...artifact,
    productionImpact: 'changes_production',
    decisionImpact: 'changes_decision',
    executionAuthority: 'may_execute'
  };
  const validation = contract.validateSignalShadowComparisonArtifact(tampered);

  assert.equal(contract.determineShadowComparisonStatus(tampered), 'blocked');
  assert.equal(validation.valid, false);
  assert.deepEqual(validation.authorityViolations, ['decisionImpact', 'executionAuthority', 'productionImpact']);
  assert.equal(validation.reasonCodes.includes('authority_boundary_violation'), true);
});

test('validation detects fingerprint mismatches and invalid comparison status', () => {
  const artifact = completeArtifact();
  const stale = {
    ...artifact,
    signalName: 'changed.signal'
  };
  const invalidStatus = {
    ...artifact,
    comparisonStatus: 'not_a_status'
  };
  const staleValidation = contract.validateSignalShadowComparisonArtifact(stale);
  const statusValidation = contract.validateSignalShadowComparisonArtifact(invalidStatus);

  assert.equal(staleValidation.valid, false);
  assert.equal(staleValidation.fingerprintViolations.includes('comparisonFingerprint'), true);
  assert.equal(staleValidation.reasonCodes.includes('comparison_fingerprint_mismatch'), true);
  assert.equal(statusValidation.valid, false);
  assert.equal(statusValidation.statusViolations.includes('comparisonStatus'), true);
  assert.equal(statusValidation.reasonCodes.includes('invalid_comparison_status'), true);
});

test('validation reports mismatch count and parity violations deterministically', () => {
  const artifact = {
    ...completeArtifact({
      exactParityStatus: 'not_real',
      mismatchReasonCodes: ['changed_native_field'],
      mismatches: [{ code: 'changed_native_field', field: 'score' }]
    }),
    mismatchCount: 0
  };
  const validation = contract.validateSignalShadowComparisonArtifact(artifact);

  assert.equal(validation.valid, false);
  assert.equal(validation.parityViolations.includes('exactParityStatus'), true);
  assert.equal(validation.mismatchViolations.includes('mismatchCount'), true);
});

test('module does not import runtime, engines, migrations, or existing comparison modules', () => {
  const loaded = new Set();
  const originalLoad = Module._load;
  Module._load = function trackingLoad(request, parent, isMain) {
    loaded.add(request);
    return originalLoad.apply(this, arguments);
  };

  delete require.cache[require.resolve('../validation/signalShadowComparisonCoreContract')];
  require('../validation/signalShadowComparisonCoreContract');
  Module._load = originalLoad;

  assert.equal([...loaded].some((request) => request.includes('server')), false);
  assert.equal([...loaded].some((request) => request.includes('scoutScannerService')), false);
  assert.equal([...loaded].some((request) => request.includes('engines/')), false);
  assert.equal([...loaded].some((request) => request.includes('gradePremiumSignalMigration')), false);
  assert.equal([...loaded].some((request) => request.includes('populationSignalMigration')), false);
  assert.equal([...loaded].some((request) => request.includes('gradePremiumShadowComparison')), false);
  assert.equal([...loaded].some((request) => request.includes('populationShadowComparison')), false);
});
