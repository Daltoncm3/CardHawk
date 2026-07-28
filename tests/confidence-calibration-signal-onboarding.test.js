'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const migration = require('../validation/confidenceCalibrationSignalMigration');
const comparison = require('../validation/confidenceCalibrationShadowComparison');
const registry = require('../validation/intelligenceSignalRegistry');
const signalContract = require('../validation/canonicalIntelligenceSignalContract');
const migrationCore = require('../validation/signalMigrationCore');
const comparisonCore = require('../validation/signalShadowComparisonCore');

function confidenceCalibrationDefinition(overrides = {}) {
  return registry.createSignalDefinition({
    signalName: 'confidence.calibration.diagnostics',
    signalVersion: '1.0.0',
    producer: 'confidenceCalibrationDiagnostics',
    producerVersion: '1.0.0',
    producerCategory: 'offline_validation',
    signalType: 'confidence',
    decisionRole: 'diagnostic_only',
    authorityLevel: 'shadow_observation',
    evidenceRole: 'diagnostic_context',
    expectedInputTypes: ['confidenceCalibrationDiagnosticOutput'],
    expectedOutputFields: [
      'calibrationStatus',
      'confidenceSupportLevel',
      'reportedConfidence',
      'evidenceSupport',
      'observedAgreementMetrics',
      'availableOutcomeMetrics',
      'calibrationGap',
      'recommendedConfidenceCap'
    ],
    confidenceSemantics: {
      kind: 'reported',
      scale: '0_100',
      basis: 'reported_confidence_with_offline_calibration_context'
    },
    uncertaintySemantics: {
      sourceFields: ['calibrationStatus', 'calibrationGap']
    },
    evidenceRequirements: {
      reviewedOutcomeMetricsTracked: true,
      evidenceSupportTracked: true,
      diagnosticOnly: true
    },
    allowedStatuses: [
      'calibrated',
      'provisionally_calibrated',
      'under_review',
      'overconfident',
      'underconfident',
      'insufficient_sample',
      'unavailable'
    ],
    downstreamConsumers: ['signalAlignmentReport', 'signalAlignmentValidationSuite'],
    governanceRequirements: { authorityBoundary: 'shadow_observation_only' },
    compatibilityNotes: ['wrapper-only migration preserves native Confidence Calibration diagnostics output'],
    createdAt: '2026-07-28T21:00:00.000Z',
    ...overrides
  });
}

function signalRegistry(definitions = [confidenceCalibrationDefinition()]) {
  return registry.createSignalRegistry({
    registryId: 'phase-13-confidence-calibration-registry',
    registryVersion: '1.0.0',
    createdAt: '2026-07-28T21:00:00.000Z',
    definitions
  });
}

function nativeConfidenceCalibrationOutput(overrides = {}) {
  return {
    source: 'confidence_calibration_diagnostics',
    schemaVersion: '1.0.0',
    productionImpact: 'none',
    decisionImpact: 'none',
    calibrationStatus: 'calibrated',
    confidenceSupportLevel: 'strong',
    reportedConfidence: {
      confidence: 88,
      source: 'sold_market',
      cap: 100,
      bucket: 'high'
    },
    evidenceSupport: {
      readinessStatus: 'ready',
      readinessLevel: 'strong',
      trueSoldDepth: 5,
      sourceConcentration: { dominantSource: 'canonical_sold_evidence', dominantShare: 0.8 },
      activeListingCount: 3,
      fallbackEvidenceCount: 0
    },
    valuationUncertainty: {
      valuationDiagnosticStatus: 'supported',
      uncertaintyLevel: 'low',
      confidenceCapRecommendation: {
        recommendedCap: 100,
        reason: 'range_first_diagnostic_supports_uncapped_interpretation'
      },
      stableFingerprint: 'range-first-fingerprint'
    },
    identitySummary: {
      diagnosticStatus: 'exact',
      ambiguityLevel: 'none',
      identityEligibility: { valuationEligible: true, exactCompEligible: true },
      stableFingerprint: 'identity-fingerprint'
    },
    comparableQuality: {
      averageComparableQualityScore: 88,
      scoredComparableCount: 5,
      qualityDistribution: { excellent: 5 },
      warnings: []
    },
    observedAgreementMetrics: {
      totalListings: 5,
      withConfidenceCount: 5,
      missingConfidenceCount: 0,
      overallAgreementRate: 86,
      averageConfidence: 88,
      calibrationScore: 94
    },
    availableOutcomeMetrics: {
      outcomeAvailable: true,
      sampleSize: 5,
      falsePositiveCount: 0,
      falsePositiveRate: 0,
      falseNegativeCount: 0,
      falseNegativeRate: 0,
      missedOpportunityRate: 0,
      cardhawkVsDaltonAgreementRate: 86
    },
    calibrationGap: {
      available: true,
      reportedConfidence: 88,
      observedAgreementRate: 86,
      gap: 2,
      direction: 'reported_above_observed'
    },
    overconfidenceIndicators: [],
    underconfidenceIndicators: [],
    blockingReasons: [],
    warnings: [],
    recommendedConfidenceCap: {
      recommendedCap: 100,
      currentReportedConfidence: 88,
      reason: 'offline_calibration_supports_reported_confidence'
    },
    recommendedReviewAction: 'none',
    stableFingerprint: 'confidence-calibration-native-fingerprint',
    ...overrides
  };
}

function migrate(overrides = {}) {
  return migration.migrateConfidenceCalibrationSignal({
    migrationId: overrides.migrationId || 'confidence-calibration-migration',
    createdAt: overrides.createdAt || '2026-07-28T21:01:00.000Z',
    nativeOutput: overrides.nativeOutput || nativeConfidenceCalibrationOutput(),
    registry: overrides.registry || signalRegistry()
  });
}

function compare(overrides = {}) {
  return comparison.compareConfidenceCalibrationNativeToShadow({
    comparisonId: overrides.comparisonId || 'confidence-calibration-shadow-comparison',
    createdAt: overrides.createdAt || '2026-07-28T21:02:00.000Z',
    migration: overrides.migration || migrate(overrides)
  });
}

test('exports Confidence Calibration onboarding public APIs and constants', () => {
  assert.equal(migration.CONFIDENCE_CALIBRATION_MIGRATION_SOURCE, 'confidence_calibration_signal_migration');
  assert.equal(migration.CONFIDENCE_CALIBRATION_SIGNAL_NAME, 'confidence.calibration.diagnostics');
  assert.equal(typeof migration.createConfidenceCalibrationAdapter, 'function');
  assert.equal(typeof migration.migrateConfidenceCalibrationSignal, 'function');
  assert.equal(typeof migration.validateConfidenceCalibrationMigration, 'function');
  assert.equal(typeof migration.summarizeConfidenceCalibrationMigration, 'function');
  assert.equal(typeof migration.buildConfidenceCalibrationMigrationFingerprint, 'function');
  assert.equal(comparison.CONFIDENCE_CALIBRATION_SHADOW_COMPARISON_SOURCE, 'confidence_calibration_shadow_comparison');
  assert.equal(typeof comparison.compareConfidenceCalibrationNativeToShadow, 'function');
  assert.equal(typeof comparison.validateConfidenceCalibrationShadowComparison, 'function');
});

test('migration uses shared Signal Migration Core and declarative adapter contract', () => {
  const result = migrate();
  const validation = migration.validateConfidenceCalibrationMigration(result);

  assert.equal(Object.isFrozen(result), true);
  assert.equal(validation.valid, true);
  assert.equal(result.registryResolutionStatus, 'matched');
  assert.equal(result.alignment.alignmentStatus, 'aligned');
  assert.equal(result.alignmentBatch.alignmentCount, 1);
  assert.equal(result.alignmentRun.adaptedSignalCount, 1);
  assert.equal(result.alignmentReport.alignments.length, 1);
  assert.equal(result.adapter.signalName, 'confidence.calibration.diagnostics');
  assert.equal(result.coreArtifact.lifecycleStatus, 'validated');
  assert.equal(migrationCore.validateSignalMigrationLifecycle(result, { adapter: result.adapter, coreArtifact: result.coreArtifact }).valid, true);
});

test('migration preserves native Confidence Calibration diagnostic output exactly and does not mutate input', () => {
  const native = nativeConfidenceCalibrationOutput();
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
  const validation = migration.validateConfidenceCalibrationMigration(result);

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
    migrationId: 'deterministic-confidence-calibration-migration',
    createdAt: '2026-07-28T21:03:00.000Z',
    nativeOutput: nativeConfidenceCalibrationOutput(),
    registry: signalRegistry()
  };
  const first = migration.migrateConfidenceCalibrationSignal(input);
  const second = migration.migrateConfidenceCalibrationSignal(input);

  assert.deepEqual(first, second);
  assert.equal(first.migrationFingerprint, migration.buildConfidenceCalibrationMigrationFingerprint(first));
});

test('shadow comparison uses shared Signal Shadow Comparison Core with supplied migration', () => {
  const migrated = migrate();
  const result = compare({ migration: migrated });
  const validation = comparison.validateConfidenceCalibrationShadowComparison(result);

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
        calibrationStatus: 'overconfident'
      }
    }
  };
  const result = compare({ migration: tampered });

  assert.equal(result.parityStatus, 'invalid');
  assert.equal(result.mismatches.some((item) => item.code === 'changed_native_field' && item.field === 'calibrationStatus'), true);
  assert.equal(result.sourceArtifacts.migration.canonicalSignal.rawOutput.calibrationStatus, 'overconfident');
  assert.equal(migrated.canonicalSignal.rawOutput.calibrationStatus, 'calibrated');
});

test('explicit unknown values are preserved through migration and comparison', () => {
  const native = nativeConfidenceCalibrationOutput({
    calibrationGap: {
      available: false,
      reportedConfidence: 'unknown',
      observedAgreementRate: 'unknown',
      gap: 'unknown',
      direction: 'unknown'
    },
    stableFingerprint: 'confidence-calibration-unknown-fingerprint'
  });
  const migrated = migrate({ nativeOutput: native });
  const result = compare({ migration: migrated });

  assert.equal(migrated.canonicalSignal.rawOutput.calibrationGap.gap, 'unknown');
  assert.equal(migrated.canonicalSignal.normalizedOutput.calibrationGap, 'unknown');
  assert.equal(result.unknownValueComparison.status, 'exact_match');
});

test('onboarding modules do not import or execute the native diagnostic engine or runtime', () => {
  const loaded = Object.keys(Module._cache).filter((file) => file.includes('/CardHawk/'));
  assert.equal(loaded.some((file) => file.endsWith('/validation/confidenceCalibrationDiagnostics.js')), false);
  assert.equal(loaded.some((file) => file.endsWith('/server.js')), false);
  assert.equal(loaded.some((file) => file.endsWith('/services/scoutScannerService.js')), false);
});
