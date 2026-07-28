'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const migration = require('../validation/rangeFirstValuationSignalMigration');
const comparison = require('../validation/rangeFirstValuationShadowComparison');
const registry = require('../validation/intelligenceSignalRegistry');
const signalContract = require('../validation/canonicalIntelligenceSignalContract');
const core = require('../validation/signalMigrationCore');
const comparisonCore = require('../validation/signalShadowComparisonCore');

function rangeFirstDefinition(overrides = {}) {
  return registry.createSignalDefinition({
    signalName: 'valuation.range_first.diagnostics',
    signalVersion: '1.0.0',
    producer: 'rangeFirstValuationDiagnostics',
    producerVersion: '1.0.0',
    producerCategory: 'offline_validation',
    signalType: 'valuation',
    decisionRole: 'diagnostic_only',
    authorityLevel: 'shadow_observation',
    evidenceRole: 'diagnostic_context',
    expectedInputTypes: ['rangeFirstValuationDiagnosticOutput'],
    expectedOutputFields: [
      'valuationDiagnosticStatus',
      'uncertaintyLevel',
      'pointEstimateAssessment',
      'rangeAssessment',
      'supportingEvidenceSummary',
      'excludedEvidenceSummary',
      'confidenceCapRecommendation'
    ],
    confidenceSemantics: {
      kind: 'derived',
      scale: '0_100',
      basis: 'diagnostic_confidence_cap_recommendation'
    },
    uncertaintySemantics: {
      sourceField: 'uncertaintyLevel'
    },
    evidenceRequirements: {
      trueSoldDepthTracked: true,
      activeListingsDoNotSatisfyTrueSoldSupport: true,
      diagnosticOnly: true
    },
    allowedStatuses: [
      'supported',
      'supported_with_wide_range',
      'conditionally_supported',
      'weakly_supported',
      'withheld',
      'unavailable'
    ],
    downstreamConsumers: ['signalAlignmentReport', 'signalAlignmentValidationSuite'],
    governanceRequirements: { authorityBoundary: 'shadow_observation_only' },
    compatibilityNotes: ['wrapper-only migration preserves native Range-First Valuation diagnostics output'],
    createdAt: '2026-07-28T20:00:00.000Z',
    ...overrides
  });
}

function signalRegistry(definitions = [rangeFirstDefinition()]) {
  return registry.createSignalRegistry({
    registryId: 'phase-13-range-first-registry',
    registryVersion: '1.0.0',
    createdAt: '2026-07-28T20:00:00.000Z',
    definitions
  });
}

function nativeRangeFirstOutput(overrides = {}) {
  return {
    source: 'range_first_valuation_diagnostics',
    schemaVersion: '1.0.0',
    productionImpact: 'none',
    decisionImpact: 'none',
    valuationDiagnosticStatus: 'supported_with_wide_range',
    uncertaintyLevel: 'high',
    pointEstimateAssessment: {
      pointEstimate: 125,
      source: 'market_value_engine',
      method: 'weighted_true_sold',
      confidence: 72,
      pointInsideSupportedRange: true,
      position: 'inside_range',
      distanceFromRange: 0
    },
    rangeAssessment: {
      available: true,
      lowerBound: 95,
      midpoint: 125,
      upperBound: 175,
      spreadWidth: 80,
      spreadPercentage: 0.64,
      rangeQuality: 'wide',
      confidence: 62,
      rangeWarnings: ['valuation_uncertainty_high'],
      basis: {
        trueSoldCount: 4,
        exactComparableCount: 3
      },
      adjustments: {
        outlierAdjustment: 0
      }
    },
    supportingEvidenceSummary: {
      trueSoldDepth: 4,
      exactComparableCount: 3,
      freshEvidenceCount: 3,
      sourceConcentration: { dominantSource: 'canonical_sold_evidence', dominantShare: 0.75 },
      comparableQualityScore: 78,
      identityExactness: { diagnosticStatus: 'exact', valuationEligible: true },
      evidenceReadinessStatus: 'ready'
    },
    excludedEvidenceSummary: {
      activeListingCount: 6,
      fallbackEvidenceCount: 0,
      contextualComparableCount: 2,
      rejectedComparableCount: 1,
      staleEvidenceCount: 0,
      duplicateEvidenceCount: 0,
      transactionIneligibleEvidenceCount: 0
    },
    blockingReasons: [],
    warnings: ['valuation_uncertainty_high'],
    evidenceReadiness: {
      readinessStatus: 'ready',
      readinessLevel: 'strong',
      stableFingerprint: 'evidence-readiness-fingerprint'
    },
    outlierSensitivity: {
      outlierAdjustment: 0,
      outlierWarnings: []
    },
    valuationWithheldRecommendation: {
      shouldWithholdValuationDiagnostically: false,
      reason: 'valuation_support_satisfies_range_first_diagnostic_threshold'
    },
    confidenceCapRecommendation: {
      recommendedCap: 65,
      reason: 'range_first_diagnostic_limits_confident_interpretation'
    },
    recommendedReviewAction: 'review_range_uncertainty',
    stableFingerprint: 'range-first-native-fingerprint',
    ...overrides
  };
}

function migrate(overrides = {}) {
  return migration.migrateRangeFirstValuationSignal({
    migrationId: overrides.migrationId || 'range-first-migration',
    createdAt: overrides.createdAt || '2026-07-28T20:01:00.000Z',
    nativeOutput: overrides.nativeOutput || nativeRangeFirstOutput(),
    registry: overrides.registry || signalRegistry()
  });
}

function compare(overrides = {}) {
  return comparison.compareRangeFirstValuationNativeToShadow({
    comparisonId: overrides.comparisonId || 'range-first-shadow-comparison',
    createdAt: overrides.createdAt || '2026-07-28T20:02:00.000Z',
    migration: overrides.migration || migrate(overrides)
  });
}

test('exports Range-First Valuation onboarding public APIs and constants', () => {
  assert.equal(migration.RANGE_FIRST_VALUATION_MIGRATION_SOURCE, 'range_first_valuation_signal_migration');
  assert.equal(migration.RANGE_FIRST_VALUATION_SIGNAL_NAME, 'valuation.range_first.diagnostics');
  assert.equal(typeof migration.createRangeFirstValuationAdapter, 'function');
  assert.equal(typeof migration.migrateRangeFirstValuationSignal, 'function');
  assert.equal(typeof migration.validateRangeFirstValuationMigration, 'function');
  assert.equal(typeof migration.summarizeRangeFirstValuationMigration, 'function');
  assert.equal(typeof migration.buildRangeFirstValuationMigrationFingerprint, 'function');
  assert.equal(comparison.RANGE_FIRST_VALUATION_SHADOW_COMPARISON_SOURCE, 'range_first_valuation_shadow_comparison');
  assert.equal(typeof comparison.compareRangeFirstValuationNativeToShadow, 'function');
  assert.equal(typeof comparison.validateRangeFirstValuationShadowComparison, 'function');
});

test('migration uses shared Signal Migration Core and declarative adapter contract', () => {
  const result = migrate();
  const validation = migration.validateRangeFirstValuationMigration(result);

  assert.equal(Object.isFrozen(result), true);
  assert.equal(validation.valid, true);
  assert.equal(result.registryResolutionStatus, 'matched');
  assert.equal(result.alignment.alignmentStatus, 'aligned');
  assert.equal(result.alignmentBatch.alignmentCount, 1);
  assert.equal(result.alignmentRun.adaptedSignalCount, 1);
  assert.equal(result.alignmentReport.alignments.length, 1);
  assert.equal(result.adapter.signalName, 'valuation.range_first.diagnostics');
  assert.equal(result.coreArtifact.lifecycleStatus, 'validated');
  assert.equal(core.validateSignalMigrationLifecycle(result, { adapter: result.adapter, coreArtifact: result.coreArtifact }).valid, true);
});

test('migration preserves native Range-First Valuation output exactly and does not mutate input', () => {
  const native = nativeRangeFirstOutput();
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

test('missing registry definition remains explicit without production authority', () => {
  const result = migrate({ registry: signalRegistry([]) });
  const validation = migration.validateRangeFirstValuationMigration(result);

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
    migrationId: 'deterministic-range-first-migration',
    createdAt: '2026-07-28T20:03:00.000Z',
    nativeOutput: nativeRangeFirstOutput(),
    registry: signalRegistry()
  };
  const first = migration.migrateRangeFirstValuationSignal(input);
  const second = migration.migrateRangeFirstValuationSignal(input);

  assert.deepEqual(first, second);
  assert.equal(first.migrationFingerprint, migration.buildRangeFirstValuationMigrationFingerprint(first));
});

test('shadow comparison uses shared Signal Shadow Comparison Core with supplied migration', () => {
  const migrated = migrate();
  const result = compare({ migration: migrated });
  const validation = comparison.validateRangeFirstValuationShadowComparison(result);

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
        valuationDiagnosticStatus: 'withheld'
      }
    }
  };
  const result = compare({ migration: tampered });

  assert.equal(result.parityStatus, 'invalid');
  assert.equal(result.mismatches.some((item) => item.code === 'changed_native_field' && item.field === 'valuationDiagnosticStatus'), true);
  assert.equal(result.sourceArtifacts.migration.canonicalSignal.rawOutput.valuationDiagnosticStatus, 'withheld');
  assert.equal(migrated.canonicalSignal.rawOutput.valuationDiagnosticStatus, 'supported_with_wide_range');
});

test('explicit unknown values are preserved through migration and comparison', () => {
  const native = nativeRangeFirstOutput({
    pointEstimateAssessment: {
      pointEstimate: 'unknown',
      pointInsideSupportedRange: 'unknown'
    },
    stableFingerprint: 'range-first-unknown-fingerprint'
  });
  const migrated = migrate({ nativeOutput: native });
  const result = compare({ migration: migrated });

  assert.equal(migrated.canonicalSignal.rawOutput.pointEstimateAssessment.pointEstimate, 'unknown');
  assert.equal(migrated.canonicalSignal.normalizedOutput.pointInsideSupportedRange, 'unknown');
  assert.equal(result.unknownValueComparison.status, 'exact_match');
});

test('onboarding modules do not import or execute the native diagnostic engine or runtime', () => {
  const loaded = Object.keys(Module._cache).filter((file) => file.includes('/CardHawk/'));
  assert.equal(loaded.some((file) => file.endsWith('/validation/rangeFirstValuationDiagnostics.js')), false);
  assert.equal(loaded.some((file) => file.endsWith('/server.js')), false);
  assert.equal(loaded.some((file) => file.endsWith('/services/scoutScannerService.js')), false);
});
