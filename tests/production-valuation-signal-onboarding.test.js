'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const migration = require('../validation/productionValuationSignalMigration');
const comparison = require('../validation/productionValuationShadowComparison');
const registry = require('../validation/intelligenceSignalRegistry');
const signalContract = require('../validation/canonicalIntelligenceSignalContract');
const core = require('../validation/signalMigrationCore');
const comparisonCore = require('../validation/signalShadowComparisonCore');

function productionValuationDefinition(overrides = {}) {
  return registry.createSignalDefinition({
    signalName: 'production.valuation.market_value',
    signalVersion: '1.0.0',
    producer: 'marketValueEngine',
    producerVersion: '1.0.0',
    producerCategory: 'production_engine',
    signalType: 'valuation',
    decisionRole: 'diagnostic_only',
    authorityLevel: 'shadow_observation',
    evidenceRole: 'diagnostic_context',
    expectedInputTypes: ['productionValuationOutput'],
    expectedOutputFields: [
      'source',
      'method',
      'marketValue',
      'expectedValueLow',
      'expectedValue',
      'expectedValueHigh',
      'confidence',
      'compCount'
    ],
    confidenceSemantics: {
      kind: 'reported',
      scale: '0_100',
      basis: 'native_production_valuation_confidence'
    },
    uncertaintySemantics: {
      sourceField: 'source'
    },
    evidenceRequirements: {
      valueRangePreserved: true,
      productionFormulaNotRecomputed: true,
      diagnosticOnly: true
    },
    allowedStatuses: ['sold_market', 'blended_market', 'active_market', 'insufficient_evidence', 'fallback'],
    downstreamConsumers: ['signalAlignmentReport', 'signalAlignmentValidationSuite'],
    governanceRequirements: { authorityBoundary: 'shadow_observation_only' },
    compatibilityNotes: ['wrapper-only migration preserves native Production Valuation output'],
    createdAt: '2026-07-29T00:00:00.000Z',
    ...overrides
  });
}

function signalRegistry(definitions = [productionValuationDefinition()]) {
  return registry.createSignalRegistry({
    registryId: 'phase-14-production-valuation-registry',
    registryVersion: '1.0.0',
    createdAt: '2026-07-29T00:00:00.000Z',
    definitions
  });
}

function nativeProductionValuationOutput(overrides = {}) {
  return {
    source: 'sold_market',
    schemaVersion: '1.0.0',
    version: '1.0.0',
    productionImpact: 'none',
    decisionImpact: 'none',
    method: 'weightedSoldComps',
    marketValue: 124.5,
    expectedValueLow: 110.58,
    expectedValue: 124.5,
    expectedValueHigh: 138.42,
    baseMarketValue: 124.5,
    confidence: 82,
    compCount: 7,
    soldCompCount: 6,
    activeCompCount: 1,
    outliersRemoved: 1,
    priceRange: {
      low: 110.58,
      high: 138.42
    },
    activeMarketContext: {
      activeOnly: false,
      activeComparableCount: 1,
      unavailableForHeadlineValuation: false,
      warnings: []
    },
    listingPrice: 74.99,
    discountAmount: 49.51,
    discountPercent: 39.8,
    evidence: {
      sold: [
        { id: 'sold-1', price: 120, weight: 0.94, similarity: 91 },
        { id: 'sold-2', price: 128, weight: 0.9, similarity: 88 }
      ],
      active: [
        { id: 'active-1', price: 150, weight: 0.25, similarity: 84 }
      ]
    },
    compEngine: {
      source: 'compEngine',
      method: 'selectedComps',
      confidence: 78,
      usableCompCount: 7,
      strongCompCount: 5,
      pricingSpread: 0.12,
      marketConsistency: 'consistent',
      cappedCompCount: 1,
      rejectedCompCount: 2,
      selectedCompsUsed: true,
      heuristicFallbackUsed: false
    },
    adjustments: {
      populationApplied: true,
      trendApplied: true
    },
    note: 'Market value based primarily on sold comp evidence.',
    stableFingerprint: 'production-valuation-native-fingerprint',
    ...overrides
  };
}

function migrate(overrides = {}) {
  return migration.migrateProductionValuationSignal({
    migrationId: overrides.migrationId || 'production-valuation-migration',
    createdAt: overrides.createdAt || '2026-07-29T00:01:00.000Z',
    nativeOutput: overrides.nativeOutput || nativeProductionValuationOutput(),
    registry: overrides.registry || signalRegistry()
  });
}

function compare(overrides = {}) {
  return comparison.compareProductionValuationNativeToShadow({
    comparisonId: overrides.comparisonId || 'production-valuation-shadow-comparison',
    createdAt: overrides.createdAt || '2026-07-29T00:02:00.000Z',
    migration: overrides.migration || migrate(overrides)
  });
}

test('exports Production Valuation onboarding public APIs and constants', () => {
  assert.equal(migration.PRODUCTION_VALUATION_MIGRATION_SOURCE, 'production_valuation_signal_migration');
  assert.equal(migration.PRODUCTION_VALUATION_SIGNAL_NAME, 'production.valuation.market_value');
  assert.equal(typeof migration.createProductionValuationAdapter, 'function');
  assert.equal(typeof migration.migrateProductionValuationSignal, 'function');
  assert.equal(typeof migration.validateProductionValuationMigration, 'function');
  assert.equal(typeof migration.summarizeProductionValuationMigration, 'function');
  assert.equal(typeof migration.buildProductionValuationMigrationFingerprint, 'function');
  assert.equal(comparison.PRODUCTION_VALUATION_SHADOW_COMPARISON_SOURCE, 'production_valuation_shadow_comparison');
  assert.equal(typeof comparison.compareProductionValuationNativeToShadow, 'function');
  assert.equal(typeof comparison.validateProductionValuationShadowComparison, 'function');
});

test('migration uses shared Signal Migration Core and declarative adapter contract', () => {
  const result = migrate();
  const validation = migration.validateProductionValuationMigration(result);

  assert.equal(Object.isFrozen(result), true);
  assert.equal(validation.valid, true);
  assert.equal(result.registryResolutionStatus, 'matched');
  assert.equal(result.alignment.alignmentStatus, 'aligned');
  assert.equal(result.alignmentBatch.alignmentCount, 1);
  assert.equal(result.alignmentRun.adaptedSignalCount, 1);
  assert.equal(result.alignmentReport.alignments.length, 1);
  assert.equal(result.adapter.signalName, 'production.valuation.market_value');
  assert.equal(result.coreArtifact.lifecycleStatus, 'validated');
  assert.equal(core.validateSignalMigrationLifecycle(result, { adapter: result.adapter, coreArtifact: result.coreArtifact }).valid, true);
});

test('migration preserves native Production Valuation output exactly and does not mutate input', () => {
  const native = nativeProductionValuationOutput();
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

test('valuation amount, range, and confidence remain diagnostic context rather than production authority', () => {
  const result = migrate();

  assert.equal(result.canonicalSignal.normalizedOutput.marketValue, 124.5);
  assert.equal(result.canonicalSignal.normalizedOutput.expectedValueLow, 110.58);
  assert.equal(result.canonicalSignal.normalizedOutput.expectedValueHigh, 138.42);
  assert.equal(result.canonicalSignal.confidence.value, 82);
  assert.equal(result.canonicalSignal.productionImpact, 'none');
  assert.equal(result.canonicalSignal.decisionImpact, 'none');
  assert.equal(result.canonicalSignal.executionAuthority, 'none');
  assert.equal(result.canonicalSignal.decisionRole, 'diagnostic_only');
});

test('missing registry definition remains explicit without production authority', () => {
  const result = migrate({ registry: signalRegistry([]) });
  const validation = migration.validateProductionValuationMigration(result);

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
    migrationId: 'deterministic-production-valuation-migration',
    createdAt: '2026-07-29T00:03:00.000Z',
    nativeOutput: nativeProductionValuationOutput(),
    registry: signalRegistry()
  };
  const first = migration.migrateProductionValuationSignal(input);
  const second = migration.migrateProductionValuationSignal(input);

  assert.deepEqual(first, second);
  assert.equal(first.migrationFingerprint, migration.buildProductionValuationMigrationFingerprint(first));
});

test('shadow comparison uses shared Signal Shadow Comparison Core with supplied migration', () => {
  const migrated = migrate();
  const result = compare({ migration: migrated });
  const validation = comparison.validateProductionValuationShadowComparison(result);

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
        expectedValue: 99
      },
      normalizedOutput: {
        ...migrated.canonicalSignal.normalizedOutput,
        expectedValue: 99
      }
    }
  };
  const result = compare({ migration: tampered });

  assert.equal(result.mismatchCount > 0, true);
  assert.equal(result.mismatches.some((item) => item.code === 'changed_native_field'), true);
  assert.equal(migrated.canonicalSignal.rawOutput.expectedValue, 124.5);
});

test('explicit unknown values remain explicit in migration and comparison', () => {
  const native = nativeProductionValuationOutput({
    expectedValueHigh: 'unknown',
    priceRange: {
      low: 110.58,
      high: 'unknown'
    }
  });
  const result = migrate({ nativeOutput: native });
  const compared = compare({ migration: result });

  assert.equal(result.canonicalSignal.normalizedOutput.expectedValueHigh, 'unknown');
  assert.equal(compared.unknownValueComparison.status, 'exact_match');
  assert.equal(compared.validation.valid, true);
});

test('onboarding modules do not import production runtime or valuation engine', () => {
  const loaded = new Set();
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    loaded.add(request);
    return originalLoad.apply(this, arguments);
  };
  try {
    delete require.cache[require.resolve('../validation/productionValuationSignalMigration')];
    delete require.cache[require.resolve('../validation/productionValuationShadowComparison')];
    require('../validation/productionValuationSignalMigration');
    require('../validation/productionValuationShadowComparison');
  } finally {
    Module._load = originalLoad;
  }

  assert.equal([...loaded].some((item) => item.includes('server.js')), false);
  assert.equal([...loaded].some((item) => item.includes('scoutScannerService')), false);
  assert.equal([...loaded].some((item) => item.includes('marketValueEngine')), false);
  assert.equal([...loaded].some((item) => item.includes('valuationRangeEngine')), false);
  assert.equal([...loaded].some((item) => item.includes('riskEngine')), false);
});
