'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const migration = require('../validation/decisionContextSignalMigration');
const comparison = require('../validation/decisionContextShadowComparison');
const registry = require('../validation/intelligenceSignalRegistry');
const signalContract = require('../validation/canonicalIntelligenceSignalContract');
const core = require('../validation/signalMigrationCore');
const comparisonCore = require('../validation/signalShadowComparisonCore');

function decisionContextDefinition(overrides = {}) {
  return registry.createSignalDefinition({
    signalName: 'decision.context.diagnostics',
    signalVersion: '1.4',
    producer: 'decisionIntelligenceEngine',
    producerVersion: '1.4',
    producerCategory: 'production_engine',
    signalType: 'decision',
    decisionRole: 'supporting_context',
    authorityLevel: 'shadow_observation',
    evidenceRole: 'diagnostic_context',
    expectedInputTypes: ['decisionIntelligence'],
    expectedOutputFields: [
      'source',
      'version',
      'mode',
      'recommendationImpact',
      'overallReadiness',
      'evidencePosture',
      'compPosture',
      'valuationPosture',
      'resalePressurePosture',
      'supportingSignals',
      'cautionSignals',
      'blockers',
      'conflicts',
      'summary'
    ],
    confidenceSemantics: {
      kind: 'derived',
      basis: 'overall_readiness_and_decision_context_signals'
    },
    uncertaintySemantics: {
      sourceFields: ['blockers', 'conflicts', 'cautionSignals']
    },
    evidenceRequirements: {
      supportingSignalsPreserved: true,
      cautionSignalsPreserved: true,
      blockersPreserved: true,
      conflictsPreserved: true,
      diagnosticOnly: true
    },
    allowedStatuses: ['supported_context', 'cautious_context', 'limited_context', 'not_ready'],
    downstreamConsumers: ['signalAlignmentReport', 'signalAlignmentValidationSuite'],
    governanceRequirements: { authorityBoundary: 'shadow_observation_only' },
    compatibilityNotes: ['wrapper-only migration preserves native Decision Context output'],
    createdAt: '2026-07-29T01:00:00.000Z',
    ...overrides
  });
}

function signalRegistry(definitions = [decisionContextDefinition()]) {
  return registry.createSignalRegistry({
    registryId: 'phase-14-decision-context-registry',
    registryVersion: '1.0.0',
    createdAt: '2026-07-29T01:00:00.000Z',
    definitions
  });
}

function nativeDecisionContextOutput(overrides = {}) {
  return {
    source: 'decision_intelligence_engine',
    version: '1.4',
    mode: 'explanation_only',
    recommendationImpact: 'none',
    overallReadiness: 'cautious_context',
    evidencePosture: 'adequate',
    compPosture: 'usable',
    valuationPosture: 'usable_range',
    resalePressurePosture: 'elevated',
    supportingSignals: [
      { source: 'evidence_sufficiency', message: 'Evidence sufficiency supports cautious market interpretation.' },
      { source: 'comparable_quality', message: 'Comparable quality is usable.' }
    ],
    cautionSignals: [
      { source: 'supply_pressure', message: 'Supply pressure is elevated.' }
    ],
    blockers: [],
    conflicts: [
      { source: 'valuation_vs_supply', message: 'Valuation range is usable, but active supply pressure could block resale or force undercutting.' }
    ],
    summary: 'Decision Intelligence is explanation-only with recommendation impact none. The evidence has useful support, but conflicts require caution.',
    stableFingerprint: 'decision-context-native-fingerprint',
    ...overrides
  };
}

function migrate(overrides = {}) {
  return migration.migrateDecisionContextSignal({
    migrationId: overrides.migrationId || 'decision-context-migration',
    createdAt: overrides.createdAt || '2026-07-29T01:01:00.000Z',
    nativeOutput: overrides.nativeOutput || nativeDecisionContextOutput(),
    registry: overrides.registry || signalRegistry()
  });
}

function compare(overrides = {}) {
  return comparison.compareDecisionContextNativeToShadow({
    comparisonId: overrides.comparisonId || 'decision-context-shadow-comparison',
    createdAt: overrides.createdAt || '2026-07-29T01:02:00.000Z',
    migration: overrides.migration || migrate(overrides)
  });
}

test('exports Decision Context onboarding public APIs and constants', () => {
  assert.equal(migration.DECISION_CONTEXT_MIGRATION_SOURCE, 'decision_context_signal_migration');
  assert.equal(migration.DECISION_CONTEXT_SIGNAL_NAME, 'decision.context.diagnostics');
  assert.equal(typeof migration.createDecisionContextAdapter, 'function');
  assert.equal(typeof migration.migrateDecisionContextSignal, 'function');
  assert.equal(typeof migration.validateDecisionContextMigration, 'function');
  assert.equal(typeof migration.summarizeDecisionContextMigration, 'function');
  assert.equal(typeof migration.buildDecisionContextMigrationFingerprint, 'function');
  assert.equal(comparison.DECISION_CONTEXT_SHADOW_COMPARISON_SOURCE, 'decision_context_shadow_comparison');
  assert.equal(typeof comparison.compareDecisionContextNativeToShadow, 'function');
  assert.equal(typeof comparison.validateDecisionContextShadowComparison, 'function');
});

test('migration uses shared Signal Migration Core and declarative adapter contract', () => {
  const result = migrate();
  const validation = migration.validateDecisionContextMigration(result);

  assert.equal(Object.isFrozen(result), true);
  assert.equal(validation.valid, true);
  assert.equal(result.registryResolutionStatus, 'matched');
  assert.equal(result.alignment.alignmentStatus, 'aligned');
  assert.equal(result.alignmentBatch.alignmentCount, 1);
  assert.equal(result.alignmentRun.adaptedSignalCount, 1);
  assert.equal(result.alignmentReport.alignments.length, 1);
  assert.equal(result.adapter.signalName, 'decision.context.diagnostics');
  assert.equal(result.coreArtifact.lifecycleStatus, 'validated');
  assert.equal(core.validateSignalMigrationLifecycle(result, { adapter: result.adapter, coreArtifact: result.coreArtifact }).valid, true);
});

test('migration preserves native Decision Context output exactly and does not mutate input', () => {
  const native = nativeDecisionContextOutput();
  const before = JSON.parse(JSON.stringify(native));
  const result = migrate({ nativeOutput: native });

  assert.deepEqual(native, before);
  assert.deepEqual(result.nativeOutput, before);
  assert.deepEqual(result.canonicalSignal.rawOutput, before);
  assert.deepEqual(result.adaptedSignal.nativeOutput, before);
  assert.equal(result.parityStatus, 'preserved');
  assert.equal(result.validation.parityStatus, 'preserved');
  assert.equal(signalContract.validateCanonicalSignal(result.canonicalSignal).valid, true);
});

test('decision context remains supporting context rather than production authority', () => {
  const result = migrate();

  assert.equal(result.canonicalSignal.normalizedOutput.overallReadiness, 'cautious_context');
  assert.equal(result.canonicalSignal.evidenceBasis.details.supportingSignalCount, 2);
  assert.equal(result.canonicalSignal.evidenceBasis.details.conflictCount, 1);
  assert.equal(result.canonicalSignal.decisionRole, 'supporting_context');
  assert.equal(result.canonicalSignal.authorityLevel, 'shadow_observation');
  assert.equal(result.canonicalSignal.productionImpact, 'none');
  assert.equal(result.canonicalSignal.decisionImpact, 'none');
  assert.equal(result.canonicalSignal.executionAuthority, 'none');
});

test('missing registry definition remains explicit without production authority', () => {
  const result = migrate({ registry: signalRegistry([]) });
  const validation = migration.validateDecisionContextMigration(result);

  assert.equal(result.registryResolutionStatus, 'definition_missing');
  assert.equal(result.alignment.alignmentStatus, 'definition_missing');
  assert.equal(result.alignment.signalDefinition, 'unknown');
  assert.equal(validation.valid, true);
  assert.deepEqual(validation.authorityViolations, []);
  assert.equal(result.productionImpact, 'none');
  assert.equal(result.decisionImpact, 'none');
  assert.equal(result.executionAuthority, 'none');
});

test('deterministic migration fingerprints and ordering are stable', () => {
  const input = {
    migrationId: 'deterministic-decision-context-migration',
    createdAt: '2026-07-29T01:03:00.000Z',
    nativeOutput: nativeDecisionContextOutput(),
    registry: signalRegistry()
  };
  const first = migration.migrateDecisionContextSignal(input);
  const second = migration.migrateDecisionContextSignal(input);

  assert.deepEqual(first, second);
  assert.equal(first.migrationFingerprint, migration.buildDecisionContextMigrationFingerprint(first));
});

test('shadow comparison uses shared Signal Shadow Comparison Core with supplied migration', () => {
  const migrated = migrate();
  const result = compare({ migration: migrated });
  const validation = comparison.validateDecisionContextShadowComparison(result);

  assert.equal(Object.isFrozen(result), true);
  assert.equal(validation.valid, true);
  assert.equal(result.parityStatus, 'semantic_match');
  assert.equal(result.mismatchCount, 0);
  assert.equal(result.sourceArtifacts.migration.migrationFingerprint, migrated.migrationFingerprint);
  assert.equal(comparisonCore.validateSignalShadowComparisonLifecycle(result).valid, true);
});

test('shadow comparison detects changed wrapper data without repairing artifacts', () => {
  const migrated = migrate();
  const tampered = {
    ...migrated,
    canonicalSignal: {
      ...migrated.canonicalSignal,
      rawOutput: {
        ...migrated.canonicalSignal.rawOutput,
        overallReadiness: 'supported_context'
      },
      normalizedOutput: {
        ...migrated.canonicalSignal.normalizedOutput,
        overallReadiness: 'supported_context'
      }
    }
  };
  const result = compare({ migration: tampered });

  assert.equal(result.mismatchCount > 0, true);
  assert.equal(result.mismatches.some((item) => item.code === 'changed_native_field'), true);
  assert.equal(migrated.canonicalSignal.rawOutput.overallReadiness, 'cautious_context');
});

test('explicit unknown values remain explicit in migration and comparison', () => {
  const native = nativeDecisionContextOutput({
    resalePressurePosture: 'unknown'
  });
  const result = migrate({ nativeOutput: native });
  const compared = compare({ migration: result });

  assert.equal(result.canonicalSignal.normalizedOutput.resalePressurePosture, 'unknown');
  assert.equal(compared.unknownValueComparison.status, 'exact_match');
  assert.equal(compared.validation.valid, true);
});

test('onboarding modules do not import production runtime or Decision Context engine', () => {
  const loaded = new Set();
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    loaded.add(request);
    return originalLoad.apply(this, arguments);
  };
  try {
    delete require.cache[require.resolve('../validation/decisionContextSignalMigration')];
    delete require.cache[require.resolve('../validation/decisionContextShadowComparison')];
    require('../validation/decisionContextSignalMigration');
    require('../validation/decisionContextShadowComparison');
  } finally {
    Module._load = originalLoad;
  }

  assert.equal([...loaded].some((item) => item.includes('server.js')), false);
  assert.equal([...loaded].some((item) => item.includes('scoutScannerService')), false);
  assert.equal([...loaded].some((item) => item.includes('decisionIntelligenceEngine')), false);
  assert.equal([...loaded].some((item) => item.includes('investmentDecisionEngine')), false);
  assert.equal([...loaded].some((item) => item.includes('marketValueEngine')), false);
  assert.equal([...loaded].some((item) => item.includes('dealGate')), false);
});
