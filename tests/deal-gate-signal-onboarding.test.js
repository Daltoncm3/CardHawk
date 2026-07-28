'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const migration = require('../validation/dealGateSignalMigration');
const comparison = require('../validation/dealGateShadowComparison');
const registry = require('../validation/intelligenceSignalRegistry');
const signalContract = require('../validation/canonicalIntelligenceSignalContract');
const migrationCore = require('../validation/signalMigrationCore');
const comparisonCore = require('../validation/signalShadowComparisonCore');

function dealGateDefinition(overrides = {}) {
  return registry.createSignalDefinition({
    signalName: 'decision.deal_gate.diagnostics',
    signalVersion: '1.0.0',
    producer: 'dealGate',
    producerVersion: '1.0.0',
    producerCategory: 'production_engine',
    signalType: 'decision',
    decisionRole: 'diagnostic_only',
    authorityLevel: 'shadow_observation',
    evidenceRole: 'diagnostic_context',
    expectedInputTypes: ['dealGateOutput'],
    expectedOutputFields: ['passed', 'buyNowAllowed', 'decision', 'reasons', 'positives', 'gate', 'dealGateBreakdown'],
    confidenceSemantics: {
      kind: 'reported',
      scale: '0_100',
      basis: 'deal_gate_confidence_score'
    },
    uncertaintySemantics: {
      sourceFields: ['passed', 'reasons']
    },
    evidenceRequirements: {
      soldCompCountTracked: true,
      thresholdContextTracked: true,
      diagnosticOnly: true
    },
    allowedStatuses: ['passed', 'rejected', 'unknown'],
    downstreamConsumers: ['signalAlignmentReport', 'signalAlignmentValidationSuite'],
    governanceRequirements: { authorityBoundary: 'shadow_observation_only' },
    compatibilityNotes: ['wrapper-only migration preserves native Deal Gate output without changing runtime authority'],
    createdAt: '2026-07-28T22:00:00.000Z',
    ...overrides
  });
}

function signalRegistry(definitions = [dealGateDefinition()]) {
  return registry.createSignalRegistry({
    registryId: 'phase-13-deal-gate-registry',
    registryVersion: '1.0.0',
    createdAt: '2026-07-28T22:00:00.000Z',
    definitions
  });
}

function nativeDealGateOutput(overrides = {}) {
  return {
    source: 'deal_gate',
    schemaVersion: '1.0.0',
    passed: true,
    buyNowAllowed: true,
    decision: 'BUY_NOW',
    recommendation: 'BUY_NOW',
    reasons: [],
    positives: [
      'Supported by 8 sold comps.',
      'ROI and profit satisfy production thresholds.'
    ],
    gate: {
      score: 92,
      estimatedProfit: 45,
      roi: 0.35,
      soldCompCount: 8,
      confidenceScore: 90,
      riskLevel: 'low'
    },
    dealGateBreakdown: {
      passedRules: ['sold_comp_minimum', 'confidence_minimum', 'profit_minimum', 'roi_minimum'],
      failedRules: [],
      thresholds: {
        minimumSoldComps: 3,
        minimumConfidence: 70,
        minimumProfit: 20,
        minimumRoi: 0.2
      }
    },
    productionImpact: 'none',
    decisionImpact: 'none',
    stableFingerprint: 'deal-gate-native-fingerprint',
    ...overrides
  };
}

function migrate(overrides = {}) {
  return migration.migrateDealGateSignal({
    migrationId: overrides.migrationId || 'deal-gate-migration',
    createdAt: overrides.createdAt || '2026-07-28T22:01:00.000Z',
    nativeOutput: overrides.nativeOutput || nativeDealGateOutput(),
    registry: overrides.registry || signalRegistry()
  });
}

function compare(overrides = {}) {
  return comparison.compareDealGateNativeToShadow({
    comparisonId: overrides.comparisonId || 'deal-gate-shadow-comparison',
    createdAt: overrides.createdAt || '2026-07-28T22:02:00.000Z',
    migration: overrides.migration || migrate(overrides)
  });
}

test('exports Deal Gate onboarding public APIs and constants', () => {
  assert.equal(migration.DEAL_GATE_MIGRATION_SOURCE, 'deal_gate_signal_migration');
  assert.equal(migration.DEAL_GATE_SIGNAL_NAME, 'decision.deal_gate.diagnostics');
  assert.equal(typeof migration.createDealGateAdapter, 'function');
  assert.equal(typeof migration.migrateDealGateSignal, 'function');
  assert.equal(typeof migration.validateDealGateMigration, 'function');
  assert.equal(typeof migration.summarizeDealGateMigration, 'function');
  assert.equal(typeof migration.buildDealGateMigrationFingerprint, 'function');
  assert.equal(comparison.DEAL_GATE_SHADOW_COMPARISON_SOURCE, 'deal_gate_shadow_comparison');
  assert.equal(typeof comparison.compareDealGateNativeToShadow, 'function');
  assert.equal(typeof comparison.validateDealGateShadowComparison, 'function');
});

test('migration uses shared Signal Migration Core and declarative adapter contract', () => {
  const result = migrate();
  const validation = migration.validateDealGateMigration(result);

  assert.equal(Object.isFrozen(result), true);
  assert.equal(validation.valid, true);
  assert.equal(result.registryResolutionStatus, 'matched');
  assert.equal(result.alignment.alignmentStatus, 'aligned');
  assert.equal(result.alignmentBatch.alignmentCount, 1);
  assert.equal(result.alignmentRun.adaptedSignalCount, 1);
  assert.equal(result.alignmentReport.alignments.length, 1);
  assert.equal(result.adapter.signalName, 'decision.deal_gate.diagnostics');
  assert.equal(result.coreArtifact.lifecycleStatus, 'validated');
  assert.equal(migrationCore.validateSignalMigrationLifecycle(result, { adapter: result.adapter, coreArtifact: result.coreArtifact }).valid, true);
});

test('migration preserves native Deal Gate output exactly and does not mutate input', () => {
  const native = nativeDealGateOutput();
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

test('native production decision language does not grant canonical signal authority', () => {
  const result = migrate();

  assert.equal(result.nativeOutput.decision, 'BUY_NOW');
  assert.equal(result.nativeOutput.buyNowAllowed, true);
  assert.equal(result.canonicalSignal.decisionRole, 'diagnostic_only');
  assert.equal(result.canonicalSignal.authorityLevel, 'shadow_observation');
  assert.equal(result.canonicalSignal.productionImpact, 'none');
  assert.equal(result.canonicalSignal.decisionImpact, 'none');
  assert.equal(result.canonicalSignal.executionAuthority, 'none');
});

test('missing registry definition remains explicit without production authority', () => {
  const result = migrate({ registry: signalRegistry([]) });
  const validation = migration.validateDealGateMigration(result);

  assert.equal(result.registryResolutionStatus, 'definition_missing');
  assert.equal(result.alignment.alignmentStatus, 'definition_missing');
  assert.equal(result.alignment.signalDefinition, 'unknown');
  assert.equal(validation.valid, true);
  assert.deepEqual(validation.authorityViolations, []);
});

test('deterministic migration fingerprints and ordering are stable', () => {
  const input = {
    migrationId: 'deterministic-deal-gate-migration',
    createdAt: '2026-07-28T22:03:00.000Z',
    nativeOutput: nativeDealGateOutput(),
    registry: signalRegistry()
  };
  const first = migration.migrateDealGateSignal(input);
  const second = migration.migrateDealGateSignal(input);

  assert.deepEqual(first, second);
  assert.equal(first.migrationFingerprint, migration.buildDealGateMigrationFingerprint(first));
});

test('shadow comparison uses shared Signal Shadow Comparison Core with supplied migration', () => {
  const migrated = migrate();
  const result = compare({ migration: migrated });
  const validation = comparison.validateDealGateShadowComparison(result);

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
        decision: 'REJECTED'
      }
    }
  };
  const result = compare({ migration: tampered });

  assert.equal(result.parityStatus, 'invalid');
  assert.equal(result.mismatches.some((item) => item.code === 'changed_native_field' && item.field === 'decision'), true);
  assert.equal(result.sourceArtifacts.migration.canonicalSignal.rawOutput.decision, 'REJECTED');
  assert.equal(migrated.canonicalSignal.rawOutput.decision, 'BUY_NOW');
});

test('explicit unknown values are preserved through migration and comparison', () => {
  const native = nativeDealGateOutput({
    buyNowAllowed: 'unknown',
    stableFingerprint: 'deal-gate-unknown-fingerprint'
  });
  const migrated = migrate({ nativeOutput: native });
  const result = compare({ migration: migrated });

  assert.equal(migrated.canonicalSignal.rawOutput.buyNowAllowed, 'unknown');
  assert.equal(migrated.canonicalSignal.normalizedOutput.buyNowAllowed, 'unknown');
  assert.equal(result.unknownValueComparison.status, 'exact_match');
});

test('onboarding modules do not import or execute Deal Gate runtime or server integration', () => {
  const loaded = Object.keys(Module._cache).filter((file) => file.includes('/CardHawk/'));
  assert.equal(loaded.some((file) => file.endsWith('/server.js')), false);
  assert.equal(loaded.some((file) => file.endsWith('/services/scoutScannerService.js')), false);
  assert.equal(loaded.some((file) => file.endsWith('/engines/investmentDecisionEngine.js')), false);
});
