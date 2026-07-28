'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const core = require('../validation/signalMigrationCore');
const { buildFingerprintFromProjection } = require('../validation/fingerprintProjection');
const { createCanonicalSignal } = require('../validation/canonicalIntelligenceSignalContract');
const { createSignalDefinition, createSignalRegistry } = require('../validation/intelligenceSignalRegistry');
const { createSignalAlignment } = require('../validation/signalAlignmentContract');
const {
  summarizeSignalAlignmentRun,
  validateSignalAlignmentRun,
  buildSignalAlignmentRunFingerprint
} = require('../validation/signalAlignmentEngine');
const {
  createSignalMigrationAdapter
} = require('../validation/signalMigrationAdapterContract');

function definition() {
  return createSignalDefinition({
    signalName: 'test.shared.lifecycle',
    signalVersion: '1.0.0',
    producer: 'testSignalProducer',
    producerVersion: '1.0.0',
    producerCategory: 'offline_validation',
    signalType: 'diagnostic',
    decisionRole: 'diagnostic_only',
    authorityLevel: 'offline_validation',
    evidenceRole: 'diagnostic_context',
    expectedInputTypes: ['nativeOutput'],
    expectedOutputFields: ['status'],
    confidenceSemantics: { kind: 'not_applicable' },
    uncertaintySemantics: { kind: 'not_applicable' },
    evidenceRequirements: { nativeOutputRequired: true },
    allowedStatuses: ['ok', 'blocked'],
    downstreamConsumers: ['signalMigrationCore'],
    governanceRequirements: { authorityBoundary: 'advisory_only' },
    compatibilityNotes: ['test definition'],
    createdAt: '2026-07-28T23:00:00.000Z'
  });
}

function registry(definitions = [definition()]) {
  return createSignalRegistry({
    registryId: 'shared-core-registry',
    registryVersion: '1.0.0',
    createdAt: '2026-07-28T23:00:00.000Z',
    definitions
  });
}

function nativeOutput(overrides = {}) {
  return {
    source: 'test_native_output',
    version: '1.0.0',
    status: 'ok',
    confidence: 'unknown',
    stableFingerprint: 'test-native-output-fingerprint',
    productionImpact: 'none',
    decisionImpact: 'none',
    ...overrides
  };
}

function buildRun(input = {}, adaptedSignal, alignmentBatch) {
  const summary = summarizeSignalAlignmentRun({ adaptedSignals: [adaptedSignal], alignmentBatch });
  const body = {
    schemaVersion: '1.0.0',
    source: 'signal_alignment_engine',
    alignmentRunId: input.alignmentRunId || `test-run:${adaptedSignal.sourceOutputFingerprint}`,
    createdAt: input.createdAt || 'unknown',
    registryId: input.registry && input.registry.registryId,
    registryFingerprint: input.registry && input.registry.registryFingerprint,
    adaptedSignalCount: 1,
    alignedSignalCount: summary.alignedSignalCount,
    blockedSignalCount: summary.blockedSignalCount,
    adaptedSignals: [adaptedSignal],
    alignmentBatch,
    summary,
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none',
    metadata: { migrationSource: 'test_signal_migration' }
  };
  const withValidation = {
    ...body,
    validation: validateSignalAlignmentRun({ ...body, runFingerprint: buildSignalAlignmentRunFingerprint(body) })
  };
  return {
    ...withValidation,
    runFingerprint: buildSignalAlignmentRunFingerprint(withValidation)
  };
}

function lifecycleConfig(overrides = {}) {
  return {
    schemaVersion: '1.0.0',
    migrationSource: 'test_signal_migration',
    nativeOutputAliases: ['nativeOutput', 'testOutput', 'output'],
    defaultMigrationIdPrefix: 'test-signal-migration',
    defaultAlignmentBatchId: 'test-signal-alignment-batch',
    defaultConflictAnalysisId: 'test-signal-conflict-analysis',
    defaultReportId: 'test-signal-alignment-report',
    resolveDefinition: (signalRegistry, output) => {
      if (!signalRegistry) return null;
      return signalRegistry.definitions.find((item) => item.signalName === 'test.shared.lifecycle' && item.signalVersion === output.version) || null;
    },
    getRegistryResolutionStatus: (signalRegistry, signalDefinition) => {
      if (!signalRegistry) return 'registry_missing';
      return signalDefinition ? 'matched' : 'definition_missing';
    },
    buildCanonicalSignal: (input, signalDefinition) => createCanonicalSignal({
      signalId: `test.shared.lifecycle:${input.nativeOutput.stableFingerprint}`,
      signalName: 'test.shared.lifecycle',
      producer: {
        producerId: 'testSignalProducer',
        name: 'testSignalProducer',
        module: 'validation/signalMigrationCore.js',
        functionName: 'supplied_native_output',
        version: input.nativeOutput.version,
        category: 'offline_validation',
        metadata: { executesNativeEngine: false }
      },
      producerVersion: input.nativeOutput.version,
      producerCategory: 'offline_validation',
      createdAt: input.createdAt || 'unknown',
      signalType: 'diagnostic',
      decisionRole: 'diagnostic_only',
      authorityLevel: 'offline_validation',
      confidence: { kind: 'not_applicable', value: 'unknown', scale: 'unknown', basis: 'test', calibrated: false },
      confidenceLevel: 'unknown',
      uncertainty: { level: 'unknown', range: 'unknown', reasonCodes: [] },
      evidenceBasis: { trueSoldCount: 0, activeListingCount: 0, fallbackUsed: false, details: {} },
      evidenceQuality: { level: 'unknown', score: 'unknown', basis: 'test', details: {} },
      warnings: input.nativeOutput.warnings || [],
      rawOutput: input.nativeOutput,
      normalizedOutput: { status: input.nativeOutput.status },
      sourceFingerprint: input.nativeOutput.stableFingerprint,
      metadata: { definitionMatched: Boolean(signalDefinition) }
    }),
    buildAlignment: (input, canonicalSignal, signalDefinition, registryResolutionStatus) => createSignalAlignment({
      alignmentId: `alignment:${canonicalSignal.signalId}`,
      createdAt: input.createdAt || canonicalSignal.createdAt,
      producer: 'testSignalProducer',
      producerVersion: canonicalSignal.producerVersion,
      sourceOutputFingerprint: canonicalSignal.sourceFingerprint,
      registryId: input.registry && input.registry.registryId,
      registryFingerprint: input.registry && input.registry.registryFingerprint,
      signalDefinition: signalDefinition || 'unknown',
      canonicalSignal,
      confidenceAlignment: { status: signalDefinition ? 'aligned' : 'unknown' },
      evidenceAlignment: { status: signalDefinition ? 'aligned' : 'unknown' },
      relationshipSummary: {
        supportingSignalCount: 0,
        conflictingSignalCount: 0,
        missingReferenceCount: 0,
        unresolvedReferenceCount: 0,
        supportingSignals: [],
        conflictingSignals: []
      },
      warnings: registryResolutionStatus === 'matched' ? [] : [registryResolutionStatus],
      errors: [],
      missingMetadata: registryResolutionStatus === 'matched' ? [] : ['signalDefinition'],
      metadata: { registryResolutionStatus }
    }),
    buildAdaptedSignal: (input, canonicalSignal, alignment, signalDefinition, registryResolutionStatus) => {
      const body = {
        schemaVersion: '1.0.0',
        source: 'test_signal_migration:adapted_signal',
        adaptationId: `adaptation:${canonicalSignal.signalId}`,
        createdAt: input.createdAt || canonicalSignal.createdAt,
        producer: 'testSignalProducer',
        signalName: 'test.shared.lifecycle',
        signalVersion: canonicalSignal.producerVersion,
        sourceOutputFingerprint: canonicalSignal.sourceFingerprint,
        registryLookupStatus: registryResolutionStatus,
        signalDefinition: signalDefinition || 'unknown',
        canonicalSignal,
        alignment,
        nativeOutput: { ...canonicalSignal.rawOutput },
        productionImpact: 'none',
        decisionImpact: 'none',
        executionAuthority: 'none'
      };
      return { ...body, adaptationFingerprint: buildFingerprintFromProjection(body) };
    },
    buildAlignmentRun: buildRun,
    ...overrides
  };
}

test('exports Signal Migration Core public API', () => {
  assert.equal(core.SIGNAL_MIGRATION_CORE_RUNTIME_SOURCE, 'signal_migration_core');
  assert.equal(typeof core.executeSignalMigrationLifecycle, 'function');
  assert.equal(typeof core.validateSignalMigrationLifecycle, 'function');
  assert.equal(typeof core.summarizeSignalMigrationLifecycle, 'function');
  assert.equal(typeof core.buildSignalMigrationLifecycleFingerprint, 'function');
});

test('executes the complete shared lifecycle deterministically', () => {
  const input = {
    createdAt: '2026-07-28T23:01:00.000Z',
    nativeOutput: nativeOutput(),
    registry: registry()
  };
  const first = core.executeSignalMigrationLifecycle(input, {}, lifecycleConfig());
  const second = core.executeSignalMigrationLifecycle(input, {}, lifecycleConfig());

  assert.deepEqual(first, second);
  assert.equal(first.registryResolutionStatus, 'matched');
  assert.equal(first.alignmentBatch.alignmentCount, 1);
  assert.equal(first.alignmentRun.adaptedSignalCount, 1);
  assert.equal(first.conflictAnalysis.relationshipCount, 0);
  assert.equal(first.alignmentReport.alignmentRunId, first.alignmentRun.alignmentRunId);
  assert.equal(first.parityStatus, 'preserved');
  assert.equal(first.productionImpact, 'none');
  assert.equal(first.decisionImpact, 'none');
  assert.equal(first.executionAuthority, 'none');
});

test('preserves immutable inputs and returns immutable lifecycle output', () => {
  const input = {
    createdAt: '2026-07-28T23:02:00.000Z',
    nativeOutput: nativeOutput({ nested: { value: 1 } }),
    registry: registry()
  };
  const before = JSON.parse(JSON.stringify(input));
  const migration = core.executeSignalMigrationLifecycle(input, {}, lifecycleConfig());

  assert.deepEqual(input, before);
  assert.equal(Object.isFrozen(migration), true);
  assert.throws(() => {
    migration.nativeOutput.nested.value = 2;
  }, /read only|Cannot assign/);
  assert.equal(input.nativeOutput.nested.value, 1);
});

test('missing adapter remains non-fatal while invalid adapters aggregate validation errors', () => {
  const migration = core.executeSignalMigrationLifecycle({
    nativeOutput: nativeOutput(),
    registry: registry()
  }, {}, lifecycleConfig());
  const noAdapterValidation = core.validateSignalMigrationLifecycle(migration);
  const invalidAdapter = {
    ...createSignalMigrationAdapter({ adapterId: 'unsafe-adapter' }),
    executionAuthority: 'may_execute'
  };
  const invalidAdapterValidation = core.validateSignalMigrationLifecycle(migration, { adapter: invalidAdapter });

  assert.equal(noAdapterValidation.valid, true);
  assert.equal(invalidAdapterValidation.valid, false);
  assert.equal(invalidAdapterValidation.reasonCodes.includes('authority_boundary_violation'), true);
});

test('missing registry definition remains explicit and produces blocked alignment metadata', () => {
  const migration = core.executeSignalMigrationLifecycle({
    nativeOutput: nativeOutput({ version: '2.0.0' }),
    registry: registry()
  }, {}, lifecycleConfig());

  assert.equal(migration.registryResolutionStatus, 'definition_missing');
  assert.equal(migration.alignment.alignmentStatus, 'definition_missing');
  assert.deepEqual(migration.alignment.missingMetadata, ['signalDefinition']);
});

test('blocked registry resolution remains observable without granting authority', () => {
  const migration = core.executeSignalMigrationLifecycle({
    nativeOutput: nativeOutput(),
    registry: registry()
  }, {}, lifecycleConfig({
    getRegistryResolutionStatus: () => 'blocked'
  }));

  assert.equal(migration.registryResolutionStatus, 'blocked');
  assert.equal(migration.alignment.metadata.registryResolutionStatus, 'blocked');
  assert.equal(migration.alignment.warnings.includes('blocked'), true);
  assert.equal(migration.executionAuthority, 'none');
});

test('parity mismatch fails closed with structured errors', () => {
  const migration = core.executeSignalMigrationLifecycle({
    nativeOutput: nativeOutput(),
    registry: registry()
  }, {}, lifecycleConfig({
    buildAdaptedSignal: (input, canonicalSignal, alignment, signalDefinition, registryResolutionStatus) => {
      const adapted = lifecycleConfig().buildAdaptedSignal(input, canonicalSignal, alignment, signalDefinition, registryResolutionStatus);
      return { ...adapted, nativeOutput: { ...adapted.nativeOutput, status: 'changed' } };
    }
  }));
  const validation = core.validateSignalMigrationLifecycle(migration);

  assert.equal(migration.parityStatus, 'changed');
  assert.equal(validation.valid, false);
  assert.equal(validation.reasonCodes.includes('native_output_parity_mismatch'), true);
});

test('authority violations and nested validation aggregation are deterministic', () => {
  const migration = core.executeSignalMigrationLifecycle({
    nativeOutput: nativeOutput(),
    registry: registry()
  }, {}, lifecycleConfig());
  const validation = core.validateSignalMigrationLifecycle({
    ...migration,
    productionImpact: 'changes_production'
  }, {
    validations: [
      ['custom', {
        valid: false,
        errors: [{ code: 'custom_nested_error', message: 'Nested validation failed.', field: 'field' }],
        warnings: [{ code: 'custom_nested_warning', message: 'Nested warning.', field: 'warning' }],
        authorityViolations: ['executionAuthority'],
        fingerprintViolations: ['fingerprint']
      }]
    ]
  });

  assert.equal(validation.valid, false);
  assert.equal(validation.reasonCodes.includes('custom_nested_error'), true);
  assert.equal(validation.reasonCodes.includes('custom_nested_warning'), true);
  assert.equal(validation.authorityViolations.includes('productionImpact'), true);
  assert.equal(validation.authorityViolations.includes('custom.executionAuthority'), true);
  assert.equal(validation.fingerprintViolations.includes('custom.fingerprint'), true);
});

test('explicit unknown values remain explicit in summaries and lifecycle fingerprints', () => {
  const migration = core.executeSignalMigrationLifecycle({
    nativeOutput: nativeOutput({ stableFingerprint: 'unknown', status: 'unknown' })
  }, {}, lifecycleConfig());
  const summary = core.summarizeSignalMigrationLifecycle(migration);
  const fingerprint = core.buildSignalMigrationLifecycleFingerprint(summary);

  assert.equal(migration.registryResolutionStatus, 'registry_missing');
  assert.equal(summary.registryResolutionStatus, 'registry_missing');
  assert.equal(typeof fingerprint, 'string');
  assert.equal(fingerprint.length, 64);
});

test('module does not import runtime, scanner, native engines, or engine-specific migrations', () => {
  const loaded = new Set();
  const originalLoad = Module._load;
  Module._load = function trackingLoad(request, parent, isMain) {
    loaded.add(request);
    return originalLoad.apply(this, arguments);
  };

  delete require.cache[require.resolve('../validation/signalMigrationCore')];
  require('../validation/signalMigrationCore');
  Module._load = originalLoad;

  assert.equal([...loaded].some((request) => request.includes('server')), false);
  assert.equal([...loaded].some((request) => request.includes('scoutScannerService')), false);
  assert.equal([...loaded].some((request) => request.includes('engines/')), false);
  assert.equal([...loaded].some((request) => request.includes('gradePremiumSignalMigration')), false);
  assert.equal([...loaded].some((request) => request.includes('populationSignalMigration')), false);
  assert.equal([...loaded].some((request) => request.includes('listingQualitySignalMigration')), false);
});
