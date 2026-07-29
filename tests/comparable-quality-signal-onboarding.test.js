'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const migration = require('../validation/comparableQualitySignalMigration');
const comparison = require('../validation/comparableQualityShadowComparison');
const registry = require('../validation/intelligenceSignalRegistry');
const signalContract = require('../validation/canonicalIntelligenceSignalContract');
const core = require('../validation/signalMigrationCore');
const comparisonCore = require('../validation/signalShadowComparisonCore');

function comparableQualityDefinition(overrides = {}) {
  return registry.createSignalDefinition({
    signalName: 'comparable.quality.diagnostics',
    signalVersion: '1.0.0',
    producer: 'comparableQualityEngine',
    producerVersion: '1.0.0',
    producerCategory: 'production_engine',
    signalType: 'quality',
    decisionRole: 'diagnostic_only',
    authorityLevel: 'shadow_observation',
    evidenceRole: 'diagnostic_context',
    expectedInputTypes: ['comparableQualityOutput'],
    expectedOutputFields: [
      'source',
      'comparableCount',
      'scoredComparableCount',
      'averageComparableQualityScore',
      'qualityDistribution',
      'scoredComps',
      'sampleDepth'
    ],
    confidenceSemantics: {
      kind: 'derived',
      scale: '0_100',
      basis: 'average_comparable_quality_score'
    },
    uncertaintySemantics: {
      sourceField: 'averageComparableQualityScore'
    },
    evidenceRequirements: {
      comparableCoverageTracked: true,
      similarityAndTrustFactorsPreserved: true,
      diagnosticOnly: true
    },
    allowedStatuses: ['excellent', 'good', 'usable', 'weak', 'reject'],
    downstreamConsumers: ['signalAlignmentReport', 'signalAlignmentValidationSuite'],
    governanceRequirements: { authorityBoundary: 'shadow_observation_only' },
    compatibilityNotes: ['wrapper-only migration preserves native Comparable Quality output'],
    createdAt: '2026-07-29T01:00:00.000Z',
    ...overrides
  });
}

function signalRegistry(definitions = [comparableQualityDefinition()]) {
  return registry.createSignalRegistry({
    registryId: 'phase-14-comparable-quality-registry',
    registryVersion: '1.0.0',
    createdAt: '2026-07-29T01:00:00.000Z',
    definitions
  });
}

function nativeComparableQualityOutput(overrides = {}) {
  return {
    source: 'comparable_quality_engine',
    schemaVersion: '1.0.0',
    version: '1.0.0',
    productionImpact: 'none',
    decisionImpact: 'none',
    comparableCount: 4,
    scoredComparableCount: 4,
    averageComparableQualityScore: 73,
    qualityDistribution: {
      excellent: 1,
      good: 1,
      usable: 1,
      weak: 0,
      reject: 1
    },
    scoredComps: [
      {
        comparableQualityScore: 91,
        qualityBand: 'excellent',
        evidenceType: 'true_sold',
        trustFactors: {
          identityScore: 96,
          evidenceStrengthScore: 100,
          recencyScore: 100,
          priceReliabilityScore: 95,
          sourceReliabilityScore: 86,
          saleTypeReliabilityScore: 88
        },
        flags: {
          activeOnly: false,
          fallbackUnknown: false,
          staleComp: false,
          priceOutlier: false,
          identityCapped: false,
          rejectedByIdentityGate: false,
          rawSlabMismatch: false,
          variationMismatch: false,
          conditionMismatch: false
        },
        reasons: ['True sold evidence is present.', 'Identity similarity is strong.', 'Comparable is recent.'],
        warnings: []
      },
      {
        comparableQualityScore: 76,
        qualityBand: 'good',
        evidenceType: 'true_sold',
        trustFactors: {
          identityScore: 88,
          evidenceStrengthScore: 100,
          recencyScore: 82,
          priceReliabilityScore: 78,
          sourceReliabilityScore: 76,
          saleTypeReliabilityScore: 78
        },
        flags: {
          activeOnly: false,
          fallbackUnknown: false,
          staleComp: false,
          priceOutlier: false,
          identityCapped: false,
          rejectedByIdentityGate: false,
          rawSlabMismatch: false,
          variationMismatch: false,
          conditionMismatch: true
        },
        reasons: ['True sold evidence is present.', 'Identity similarity is strong.', 'Comparable is recent.'],
        warnings: []
      },
      {
        comparableQualityScore: 62,
        qualityBand: 'usable',
        evidenceType: 'active',
        trustFactors: {
          identityScore: 95,
          evidenceStrengthScore: 45,
          recencyScore: 100,
          priceReliabilityScore: 78,
          sourceReliabilityScore: 45,
          saleTypeReliabilityScore: 35
        },
        flags: {
          activeOnly: true,
          fallbackUnknown: false,
          staleComp: false,
          priceOutlier: false,
          identityCapped: false,
          rejectedByIdentityGate: false,
          rawSlabMismatch: false,
          variationMismatch: false,
          conditionMismatch: false
        },
        reasons: ['Identity similarity is strong.', 'Comparable is recent.'],
        warnings: ['Active comparable is informational only and not sold evidence.']
      },
      {
        comparableQualityScore: 15,
        qualityBand: 'reject',
        evidenceType: 'true_sold',
        trustFactors: {
          identityScore: 0,
          evidenceStrengthScore: 100,
          recencyScore: 100,
          priceReliabilityScore: 55,
          sourceReliabilityScore: 55,
          saleTypeReliabilityScore: 55
        },
        flags: {
          activeOnly: false,
          fallbackUnknown: false,
          staleComp: false,
          priceOutlier: false,
          identityCapped: true,
          rejectedByIdentityGate: true,
          rawSlabMismatch: false,
          variationMismatch: true,
          conditionMismatch: false
        },
        reasons: ['True sold evidence is present.', 'Comparable is recent.'],
        warnings: ['Comparable was rejected by identity gates.', 'Comparable has identity mismatch caps.']
      }
    ],
    sampleDepth: {
      totalComparableCount: 4,
      trueSoldCount: 3,
      activeCount: 1,
      fallbackUnknownCount: 0
    },
    averageAgeDays: 11.7,
    sourceDiversity: {
      sourceCount: 3,
      sources: ['ebay completed sold', 'pwcc completed sold', 'ebay active']
    },
    knownConditionRate: 0.75,
    conditionMatchRate: 0.667,
    warnings: [
      'Active comparable is informational only and not sold evidence.',
      'Comparable was rejected by identity gates.',
      'Comparable has identity mismatch caps.'
    ],
    summary: 'Comparable quality includes rejected or identity-failed comps and should be reviewed.',
    stableFingerprint: 'comparable-quality-native-fingerprint',
    ...overrides
  };
}

function migrate(overrides = {}) {
  return migration.migrateComparableQualitySignal({
    migrationId: overrides.migrationId || 'comparable-quality-migration',
    createdAt: overrides.createdAt || '2026-07-29T01:01:00.000Z',
    nativeOutput: overrides.nativeOutput || nativeComparableQualityOutput(),
    registry: overrides.registry || signalRegistry()
  });
}

function compare(overrides = {}) {
  return comparison.compareComparableQualityNativeToShadow({
    comparisonId: overrides.comparisonId || 'comparable-quality-shadow-comparison',
    createdAt: overrides.createdAt || '2026-07-29T01:02:00.000Z',
    migration: overrides.migration || migrate(overrides)
  });
}

test('exports Comparable Quality onboarding public APIs and constants', () => {
  assert.equal(migration.COMPARABLE_QUALITY_MIGRATION_SOURCE, 'comparable_quality_signal_migration');
  assert.equal(migration.COMPARABLE_QUALITY_SIGNAL_NAME, 'comparable.quality.diagnostics');
  assert.equal(typeof migration.createComparableQualityAdapter, 'function');
  assert.equal(typeof migration.migrateComparableQualitySignal, 'function');
  assert.equal(typeof migration.validateComparableQualityMigration, 'function');
  assert.equal(typeof migration.summarizeComparableQualityMigration, 'function');
  assert.equal(typeof migration.buildComparableQualityMigrationFingerprint, 'function');
  assert.equal(comparison.COMPARABLE_QUALITY_SHADOW_COMPARISON_SOURCE, 'comparable_quality_shadow_comparison');
  assert.equal(typeof comparison.compareComparableQualityNativeToShadow, 'function');
  assert.equal(typeof comparison.validateComparableQualityShadowComparison, 'function');
});

test('migration uses shared Signal Migration Core and declarative adapter contract', () => {
  const result = migrate();
  const validation = migration.validateComparableQualityMigration(result);

  assert.equal(Object.isFrozen(result), true);
  assert.equal(validation.valid, true);
  assert.equal(result.registryResolutionStatus, 'matched');
  assert.equal(result.alignment.alignmentStatus, 'aligned');
  assert.equal(result.alignmentBatch.alignmentCount, 1);
  assert.equal(result.alignmentRun.adaptedSignalCount, 1);
  assert.equal(result.alignmentReport.alignments.length, 1);
  assert.equal(result.adapter.signalName, 'comparable.quality.diagnostics');
  assert.equal(result.coreArtifact.lifecycleStatus, 'validated');
  assert.equal(core.validateSignalMigrationLifecycle(result, { adapter: result.adapter, coreArtifact: result.coreArtifact }).valid, true);
});

test('migration preserves native Comparable Quality output exactly and does not mutate input', () => {
  const native = nativeComparableQualityOutput();
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

test('quality, similarity, and coverage remain diagnostic context rather than production authority', () => {
  const result = migrate();

  assert.equal(result.canonicalSignal.evidenceBasis.trueSoldCount, 3);
  assert.equal(result.canonicalSignal.evidenceBasis.activeListingCount, 1);
  assert.equal(result.canonicalSignal.evidenceBasis.rejectedCount, 1);
  assert.equal(result.canonicalSignal.confidence.value, 73);
  assert.equal(result.canonicalSignal.productionImpact, 'none');
  assert.equal(result.canonicalSignal.decisionImpact, 'none');
  assert.equal(result.canonicalSignal.executionAuthority, 'none');
  assert.equal(result.canonicalSignal.decisionRole, 'diagnostic_only');
});

test('missing registry definition remains explicit without production authority', () => {
  const result = migrate({ registry: signalRegistry([]) });
  const validation = migration.validateComparableQualityMigration(result);

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
    migrationId: 'deterministic-comparable-quality-migration',
    createdAt: '2026-07-29T01:03:00.000Z',
    nativeOutput: nativeComparableQualityOutput(),
    registry: signalRegistry()
  };
  const first = migration.migrateComparableQualitySignal(input);
  const second = migration.migrateComparableQualitySignal(input);

  assert.deepEqual(first, second);
  assert.equal(first.migrationFingerprint, migration.buildComparableQualityMigrationFingerprint(first));
});

test('shadow comparison uses shared Signal Shadow Comparison Core with supplied migration', () => {
  const migrated = migrate();
  const result = compare({ migration: migrated });
  const validation = comparison.validateComparableQualityShadowComparison(result);

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
        averageComparableQualityScore: 44
      },
      normalizedOutput: {
        ...migrated.canonicalSignal.normalizedOutput,
        averageComparableQualityScore: 44
      }
    }
  };
  const result = compare({ migration: tampered });

  assert.equal(result.mismatchCount > 0, true);
  assert.equal(result.mismatches.some((item) => item.code === 'changed_native_field'), true);
  assert.equal(migrated.canonicalSignal.rawOutput.averageComparableQualityScore, 73);
});

test('explicit unknown values remain explicit in migration and comparison', () => {
  const native = nativeComparableQualityOutput({
    conditionMatchRate: 'unknown'
  });
  const result = migrate({ nativeOutput: native });
  const compared = compare({ migration: result });

  assert.equal(result.canonicalSignal.normalizedOutput.conditionMatchRate, 'unknown');
  assert.equal(compared.unknownValueComparison.status, 'exact_match');
  assert.equal(compared.validation.valid, true);
});

test('onboarding modules do not import production runtime or Comparable Quality engine', () => {
  const loaded = new Set();
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    loaded.add(request);
    return originalLoad.apply(this, arguments);
  };
  try {
    delete require.cache[require.resolve('../validation/comparableQualitySignalMigration')];
    delete require.cache[require.resolve('../validation/comparableQualityShadowComparison')];
    require('../validation/comparableQualitySignalMigration');
    require('../validation/comparableQualityShadowComparison');
  } finally {
    Module._load = originalLoad;
  }

  assert.equal([...loaded].some((item) => item.includes('server.js')), false);
  assert.equal([...loaded].some((item) => item.includes('scoutScannerService')), false);
  assert.equal([...loaded].some((item) => item.includes('comparableQualityEngine')), false);
  assert.equal([...loaded].some((item) => item.includes('marketValueEngine')), false);
  assert.equal([...loaded].some((item) => item.includes('dealGate')), false);
});
