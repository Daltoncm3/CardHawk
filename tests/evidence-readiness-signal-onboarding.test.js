'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const migration = require('../validation/evidenceReadinessSignalMigration');
const comparison = require('../validation/evidenceReadinessShadowComparison');
const registry = require('../validation/intelligenceSignalRegistry');
const signalContract = require('../validation/canonicalIntelligenceSignalContract');
const core = require('../validation/signalMigrationCore');
const comparisonCore = require('../validation/signalShadowComparisonCore');

function evidenceReadinessDefinition(overrides = {}) {
  return registry.createSignalDefinition({
    signalName: 'evidence.readiness.diagnostics',
    signalVersion: '1.0.0',
    producer: 'evidenceReadinessDiagnostics',
    producerVersion: '1.0.0',
    producerCategory: 'offline_validation',
    signalType: 'evidence',
    decisionRole: 'diagnostic_only',
    authorityLevel: 'shadow_observation',
    evidenceRole: 'diagnostic_context',
    expectedInputTypes: ['evidenceReadinessDiagnosticOutput'],
    expectedOutputFields: [
      'readinessStatus',
      'readinessLevel',
      'eligibleEvidenceSummary',
      'excludedEvidenceSummary',
      'valuationReadiness',
      'confidenceCapRecommendation'
    ],
    confidenceSemantics: {
      kind: 'derived',
      scale: '0_100',
      basis: 'diagnostic_confidence_cap_recommendation'
    },
    uncertaintySemantics: {
      sourceField: 'readinessStatus'
    },
    evidenceRequirements: {
      trueSoldDepthTracked: true,
      activeListingsDoNotSatisfyTrueSoldSupport: true,
      fallbackValuesDoNotSatisfyTrueSoldSupport: true,
      diagnosticOnly: true
    },
    allowedStatuses: ['ready', 'conditionally_ready', 'thin', 'insufficient', 'blocked', 'unavailable'],
    downstreamConsumers: ['signalAlignmentReport', 'signalAlignmentValidationSuite'],
    governanceRequirements: { authorityBoundary: 'shadow_observation_only' },
    compatibilityNotes: ['wrapper-only migration preserves native Evidence Readiness diagnostics output'],
    createdAt: '2026-07-28T21:00:00.000Z',
    ...overrides
  });
}

function signalRegistry(definitions = [evidenceReadinessDefinition()]) {
  return registry.createSignalRegistry({
    registryId: 'phase-14-evidence-readiness-registry',
    registryVersion: '1.0.0',
    createdAt: '2026-07-28T21:00:00.000Z',
    definitions
  });
}

function nativeEvidenceReadinessOutput(overrides = {}) {
  return {
    source: 'evidence_readiness_diagnostics',
    schemaVersion: '1.0.0',
    productionImpact: 'none',
    decisionImpact: 'none',
    readinessStatus: 'conditionally_ready',
    readinessLevel: 'adequate',
    eligibleEvidenceSummary: {
      minimumTrueSoldRequired: 3,
      trueSoldEvidenceCount: 4,
      exactComparableCount: 4,
      freshEvidenceCount: 3,
      sourceConcentration: {
        sourceCount: 2,
        sourceDistribution: {
          ebay: 3,
          myslabs: 1
        },
        dominantSource: 'ebay',
        dominantSourceShare: 0.75,
        concentrated: false
      }
    },
    excludedEvidenceSummary: {
      activeListingCount: 5,
      fallbackEvidenceCount: 0,
      contextualComparableCount: 2,
      rejectedComparableCount: 1,
      staleEvidenceCount: 1,
      duplicateEvidenceCount: 0,
      transactionIneligibleEvidenceCount: 0
    },
    blockingReasons: [],
    warnings: ['stale_evidence_excluded', 'contextual_comparables_excluded'],
    evidenceUsed: [
      {
        id: 'sold-1',
        evidenceType: 'true_sold',
        source: 'ebay',
        price: 120,
        ageDays: 14,
        exactComparable: true,
        qualityBand: 'strong',
        exclusionReasons: []
      },
      {
        id: 'sold-2',
        evidenceType: 'true_sold',
        source: 'ebay',
        price: 125,
        ageDays: 34,
        exactComparable: true,
        qualityBand: 'strong',
        exclusionReasons: []
      }
    ],
    evidenceExcluded: [
      {
        id: 'active-1',
        evidenceType: 'active',
        source: 'ebay',
        price: 160,
        ageDays: 'unknown',
        exactComparable: true,
        qualityBand: 'unknown',
        exclusionReasons: ['active_listing_context_only']
      }
    ],
    valuationReadiness: {
      diagnosticallyReady: true,
      shouldWithholdValuationDiagnostically: false,
      reason: 'minimum_evidence_readiness_satisfied',
      evidenceSufficiency: {
        status: 'sufficient',
        warnings: []
      }
    },
    comparableQuality: {
      averageComparableQualityScore: 82,
      comparableQualityStatus: 'strong',
      warnings: []
    },
    identityExactness: {
      exact: true,
      source: 'identity_parser_diagnostics',
      status: 'exact'
    },
    confidenceCapRecommendation: {
      recommendedCap: 75,
      reason: 'ready_with_evidence_warnings'
    },
    recommendedReviewAction: 'review_evidence_conditions_before_valuation_reliance',
    stableFingerprint: 'evidence-readiness-native-fingerprint',
    ...overrides
  };
}

function migrate(overrides = {}) {
  return migration.migrateEvidenceReadinessSignal({
    migrationId: overrides.migrationId || 'evidence-readiness-migration',
    createdAt: overrides.createdAt || '2026-07-28T21:01:00.000Z',
    nativeOutput: overrides.nativeOutput || nativeEvidenceReadinessOutput(),
    registry: overrides.registry || signalRegistry()
  });
}

function compare(overrides = {}) {
  return comparison.compareEvidenceReadinessNativeToShadow({
    comparisonId: overrides.comparisonId || 'evidence-readiness-shadow-comparison',
    createdAt: overrides.createdAt || '2026-07-28T21:02:00.000Z',
    migration: overrides.migration || migrate(overrides)
  });
}

test('exports Evidence Readiness onboarding public APIs and constants', () => {
  assert.equal(migration.EVIDENCE_READINESS_MIGRATION_SOURCE, 'evidence_readiness_signal_migration');
  assert.equal(migration.EVIDENCE_READINESS_SIGNAL_NAME, 'evidence.readiness.diagnostics');
  assert.equal(typeof migration.createEvidenceReadinessAdapter, 'function');
  assert.equal(typeof migration.migrateEvidenceReadinessSignal, 'function');
  assert.equal(typeof migration.validateEvidenceReadinessMigration, 'function');
  assert.equal(typeof migration.summarizeEvidenceReadinessMigration, 'function');
  assert.equal(typeof migration.buildEvidenceReadinessMigrationFingerprint, 'function');
  assert.equal(comparison.EVIDENCE_READINESS_SHADOW_COMPARISON_SOURCE, 'evidence_readiness_shadow_comparison');
  assert.equal(typeof comparison.compareEvidenceReadinessNativeToShadow, 'function');
  assert.equal(typeof comparison.validateEvidenceReadinessShadowComparison, 'function');
});

test('migration uses shared Signal Migration Core and declarative adapter contract', () => {
  const result = migrate();
  const validation = migration.validateEvidenceReadinessMigration(result);

  assert.equal(Object.isFrozen(result), true);
  assert.equal(validation.valid, true);
  assert.equal(result.registryResolutionStatus, 'matched');
  assert.equal(result.alignment.alignmentStatus, 'aligned');
  assert.equal(result.alignmentBatch.alignmentCount, 1);
  assert.equal(result.alignmentRun.adaptedSignalCount, 1);
  assert.equal(result.alignmentReport.alignments.length, 1);
  assert.equal(result.adapter.signalName, 'evidence.readiness.diagnostics');
  assert.equal(result.coreArtifact.lifecycleStatus, 'validated');
  assert.equal(core.validateSignalMigrationLifecycle(result, { adapter: result.adapter, coreArtifact: result.coreArtifact }).valid, true);
});

test('migration preserves native Evidence Readiness output exactly and does not mutate input', () => {
  const native = nativeEvidenceReadinessOutput();
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

test('active and fallback evidence remain diagnostic context rather than production authority', () => {
  const result = migrate();

  assert.equal(result.canonicalSignal.evidenceBasis.trueSoldCount, 4);
  assert.equal(result.canonicalSignal.evidenceBasis.activeListingCount, 5);
  assert.equal(result.canonicalSignal.evidenceBasis.fallbackUsed, false);
  assert.equal(result.canonicalSignal.productionImpact, 'none');
  assert.equal(result.canonicalSignal.decisionImpact, 'none');
  assert.equal(result.canonicalSignal.executionAuthority, 'none');
  assert.equal(result.canonicalSignal.decisionRole, 'diagnostic_only');
});

test('missing registry definition remains explicit without production authority', () => {
  const result = migrate({ registry: signalRegistry([]) });
  const validation = migration.validateEvidenceReadinessMigration(result);

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
    migrationId: 'deterministic-evidence-readiness-migration',
    createdAt: '2026-07-28T21:03:00.000Z',
    nativeOutput: nativeEvidenceReadinessOutput(),
    registry: signalRegistry()
  };
  const first = migration.migrateEvidenceReadinessSignal(input);
  const second = migration.migrateEvidenceReadinessSignal(input);

  assert.deepEqual(first, second);
  assert.equal(first.migrationFingerprint, migration.buildEvidenceReadinessMigrationFingerprint(first));
});

test('shadow comparison uses shared Signal Shadow Comparison Core with supplied migration', () => {
  const migrated = migrate();
  const result = compare({ migration: migrated });
  const validation = comparison.validateEvidenceReadinessShadowComparison(result);

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
        readinessStatus: 'blocked'
      },
      normalizedOutput: {
        ...migrated.canonicalSignal.normalizedOutput,
        status: 'blocked'
      }
    }
  };
  const result = compare({ migration: tampered });

  assert.equal(result.mismatchCount > 0, true);
  assert.equal(result.mismatches.some((item) => item.code === 'changed_native_field'), true);
  assert.equal(migrated.canonicalSignal.rawOutput.readinessStatus, 'conditionally_ready');
});

test('explicit unknown values remain explicit in migration and comparison', () => {
  const native = nativeEvidenceReadinessOutput({
    confidenceCapRecommendation: { recommendedCap: 'unknown', reason: 'unknown' },
    valuationReadiness: {
      diagnosticallyReady: true,
      shouldWithholdValuationDiagnostically: 'unknown',
      reason: 'operator_review_required'
    }
  });
  const migrated = migrate({ nativeOutput: native });
  const result = compare({ migration: migrated });

  assert.equal(migrated.canonicalSignal.confidence.value, 'unknown');
  assert.equal(migrated.canonicalSignal.normalizedOutput.shouldWithholdValuationDiagnostically, 'unknown');
  assert.equal(result.unknownValueComparison.status, 'exact_match');
});

test('migration and comparison do not import or execute Evidence Readiness diagnostics or production runtime', () => {
  const before = new Set(Object.keys(Module._cache));
  const result = compare({ migration: migrate() });
  const after = Object.keys(Module._cache).filter((key) => !before.has(key));

  assert.equal(result.validation.valid, true);
  assert.equal(after.some((key) => key.endsWith('/server.js')), false);
  assert.equal(after.some((key) => key.endsWith('/services/scoutScannerService.js')), false);
  assert.equal(after.some((key) => key.endsWith('/validation/evidenceReadinessDiagnostics.js')), false);
  assert.equal(after.some((key) => key.endsWith('/engines/evidenceSufficiencyEngine.js')), false);
});
