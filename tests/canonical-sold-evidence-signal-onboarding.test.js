'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const migration = require('../validation/canonicalSoldEvidenceSignalMigration');
const comparison = require('../validation/canonicalSoldEvidenceShadowComparison');
const registry = require('../validation/intelligenceSignalRegistry');
const signalContract = require('../validation/canonicalIntelligenceSignalContract');
const core = require('../validation/signalMigrationCore');
const comparisonCore = require('../validation/signalShadowComparisonCore');

function canonicalSoldEvidenceDefinition(overrides = {}) {
  return registry.createSignalDefinition({
    signalName: 'canonical.sold_evidence.store',
    signalVersion: '1.0.0',
    producer: 'canonicalSoldEvidence',
    producerVersion: '1.0.0',
    producerCategory: 'service',
    signalType: 'evidence',
    decisionRole: 'diagnostic_only',
    authorityLevel: 'shadow_observation',
    evidenceRole: 'diagnostic_context',
    expectedInputTypes: ['canonicalSoldEvidenceOutput'],
    expectedOutputFields: [
      'source',
      'schemaVersion',
      'records',
      'stats',
      'provenanceSummary',
      'evidenceQualitySummary'
    ],
    confidenceSemantics: {
      kind: 'derived',
      scale: '0_100',
      basis: 'canonical_sold_evidence_dataset_quality'
    },
    uncertaintySemantics: {
      sourceField: 'status'
    },
    evidenceRequirements: {
      trueSoldRecordsPreserved: true,
      provenanceTracked: true,
      diagnosticOnly: true
    },
    allowedStatuses: ['available', 'active', 'partial', 'limited', 'stale', 'thin', 'blocked', 'unavailable'],
    downstreamConsumers: ['signalAlignmentReport', 'signalAlignmentValidationSuite'],
    governanceRequirements: { authorityBoundary: 'shadow_observation_only' },
    compatibilityNotes: ['wrapper-only migration preserves native Canonical Sold Evidence output'],
    createdAt: '2026-07-28T23:30:00.000Z',
    ...overrides
  });
}

function signalRegistry(definitions = [canonicalSoldEvidenceDefinition()]) {
  return registry.createSignalRegistry({
    registryId: 'phase-14-canonical-sold-evidence-registry',
    registryVersion: '1.0.0',
    createdAt: '2026-07-28T23:30:00.000Z',
    definitions
  });
}

function nativeCanonicalSoldEvidenceOutput(overrides = {}) {
  return {
    source: 'sold_evidence_store',
    schemaVersion: '1.0.0',
    version: '1.0.0',
    productionImpact: 'none',
    decisionImpact: 'none',
    status: 'available',
    createdAt: '2026-07-10T00:00:00.000Z',
    updatedAt: '2026-07-28T23:00:00.000Z',
    records: {
      'ebay:sale:sale-1': {
        schemaVersion: 1,
        id: 'ebay:sale:sale-1',
        evidenceType: 'true_sold',
        marketplace: 'ebay',
        marketplaceSaleId: 'sale-1',
        marketplaceListingId: 'listing-1',
        rawTitle: '2023 Panini Prizm UFC Anthony Hernandez #181 Silver Prizm PSA 10',
        soldPrice: 42,
        shipping: 4.5,
        totalPaid: 46.5,
        currency: 'USD',
        soldAt: '2026-07-01T18:30:00.000Z',
        saleType: 'auction',
        url: 'https://example.test/sold/1',
        parsedIdentity: {
          category: 'sports_card',
          sport: 'ufc',
          player: 'anthony hernandez',
          year: '2023',
          brand: 'panini',
          setName: 'prizm',
          cardNumber: '181',
          parallel: 'silver prizm'
        },
        canonicalCardKey: 'sports-card:ufc:2023:panini:prizm:anthony-hernandez:181:silver-prizm:non-auto:non-mem:unnumbered',
        identityConfidence: 0.94,
        priceConfidence: 0.97,
        soldDateConfidence: 0.96,
        evidenceQualityScore: 91,
        evidenceQualityLevel: 'strong',
        source: {
          adapter: 'manual_import',
          acquiredAt: '2026-07-10T00:00:00.000Z',
          retrievalMethod: 'manual_import',
          sourceReliability: 'high'
        },
        status: 'active_evidence',
        duplicateKeys: ['sale:ebay:sale-1'],
        warnings: [],
        rejectionReasons: []
      },
      'ebay:sale:sale-2': {
        schemaVersion: 1,
        id: 'ebay:sale:sale-2',
        evidenceType: 'true_sold',
        marketplace: 'ebay',
        marketplaceSaleId: 'sale-2',
        marketplaceListingId: 'listing-2',
        rawTitle: '2023 Panini Prizm UFC Anthony Hernandez #181 Silver Prizm PSA 10',
        soldPrice: 39,
        shipping: 4,
        totalPaid: 43,
        currency: 'USD',
        soldAt: '2026-07-05T18:30:00.000Z',
        saleType: 'buy_it_now',
        url: 'https://example.test/sold/2',
        parsedIdentity: {
          category: 'sports_card',
          sport: 'ufc',
          player: 'anthony hernandez',
          year: '2023',
          brand: 'panini',
          setName: 'prizm',
          cardNumber: '181',
          parallel: 'silver prizm'
        },
        canonicalCardKey: 'sports-card:ufc:2023:panini:prizm:anthony-hernandez:181:silver-prizm:non-auto:non-mem:unnumbered',
        identityConfidence: 0.92,
        priceConfidence: 0.96,
        soldDateConfidence: 0.94,
        evidenceQualityScore: 88,
        evidenceQualityLevel: 'strong',
        source: {
          adapter: 'manual_import',
          acquiredAt: '2026-07-10T00:00:00.000Z',
          retrievalMethod: 'manual_import',
          sourceReliability: 'high'
        },
        status: 'active_evidence',
        duplicateKeys: ['sale:ebay:sale-2'],
        warnings: [],
        rejectionReasons: []
      }
    },
    duplicateIndex: {
      'sale:ebay:sale-1': 'ebay:sale:sale-1',
      'sale:ebay:sale-2': 'ebay:sale:sale-2'
    },
    identityIndex: {
      'sports-card:ufc:2023:panini:prizm:anthony-hernandez:181:silver-prizm:non-auto:non-mem:unnumbered': [
        'ebay:sale:sale-1',
        'ebay:sale:sale-2'
      ]
    },
    stats: {
      recordCount: 2,
      identityCount: 1,
      duplicateKeyCount: 2,
      duplicateInsertions: 0,
      staleEvidenceCount: 0,
      rejectedRecordCount: 0,
      transactionIneligibleEvidenceCount: 0
    },
    provenanceSummary: {
      sourceCount: 1,
      primarySources: ['ebay'],
      sourceConcentration: {
        dominantSource: 'ebay',
        dominantShare: 1,
        concentrated: true
      }
    },
    evidenceQualitySummary: {
      averageEvidenceQualityScore: 89.5,
      level: 'strong',
      warnings: ['single_source_concentration']
    },
    datasetQuality: {
      score: 89.5,
      level: 'strong'
    },
    recommendedReviewAction: 'review_source_concentration_before_reliance',
    stableFingerprint: 'canonical-sold-evidence-native-fingerprint',
    ...overrides
  };
}

function migrate(overrides = {}) {
  return migration.migrateCanonicalSoldEvidenceSignal({
    migrationId: overrides.migrationId || 'canonical-sold-evidence-migration',
    createdAt: overrides.createdAt || '2026-07-28T23:31:00.000Z',
    nativeOutput: overrides.nativeOutput || nativeCanonicalSoldEvidenceOutput(),
    registry: overrides.registry || signalRegistry()
  });
}

function compare(overrides = {}) {
  return comparison.compareCanonicalSoldEvidenceNativeToShadow({
    comparisonId: overrides.comparisonId || 'canonical-sold-evidence-shadow-comparison',
    createdAt: overrides.createdAt || '2026-07-28T23:32:00.000Z',
    migration: overrides.migration || migrate(overrides)
  });
}

test('exports Canonical Sold Evidence onboarding public APIs and constants', () => {
  assert.equal(migration.CANONICAL_SOLD_EVIDENCE_MIGRATION_SOURCE, 'canonical_sold_evidence_signal_migration');
  assert.equal(migration.CANONICAL_SOLD_EVIDENCE_SIGNAL_NAME, 'canonical.sold_evidence.store');
  assert.equal(typeof migration.createCanonicalSoldEvidenceAdapter, 'function');
  assert.equal(typeof migration.migrateCanonicalSoldEvidenceSignal, 'function');
  assert.equal(typeof migration.validateCanonicalSoldEvidenceMigration, 'function');
  assert.equal(typeof migration.summarizeCanonicalSoldEvidenceMigration, 'function');
  assert.equal(typeof migration.buildCanonicalSoldEvidenceMigrationFingerprint, 'function');
  assert.equal(comparison.CANONICAL_SOLD_EVIDENCE_SHADOW_COMPARISON_SOURCE, 'canonical_sold_evidence_shadow_comparison');
  assert.equal(typeof comparison.compareCanonicalSoldEvidenceNativeToShadow, 'function');
  assert.equal(typeof comparison.validateCanonicalSoldEvidenceShadowComparison, 'function');
});

test('migration uses shared Signal Migration Core and declarative adapter contract', () => {
  const result = migrate();
  const validation = migration.validateCanonicalSoldEvidenceMigration(result);

  assert.equal(Object.isFrozen(result), true);
  assert.equal(validation.valid, true);
  assert.equal(result.registryResolutionStatus, 'matched');
  assert.equal(result.alignment.alignmentStatus, 'aligned');
  assert.equal(result.alignmentBatch.alignmentCount, 1);
  assert.equal(result.alignmentRun.adaptedSignalCount, 1);
  assert.equal(result.alignmentReport.alignments.length, 1);
  assert.equal(result.adapter.signalName, 'canonical.sold_evidence.store');
  assert.equal(result.coreArtifact.lifecycleStatus, 'validated');
  assert.equal(core.validateSignalMigrationLifecycle(result, { adapter: result.adapter, coreArtifact: result.coreArtifact }).valid, true);
});

test('migration preserves native Canonical Sold Evidence output exactly and does not mutate input', () => {
  const native = nativeCanonicalSoldEvidenceOutput();
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

test('sold evidence stats and provenance remain diagnostic context rather than production authority', () => {
  const result = migrate();

  assert.equal(result.canonicalSignal.evidenceBasis.trueSoldCount, 2);
  assert.equal(result.canonicalSignal.evidenceBasis.details.identityCount, 1);
  assert.equal(result.canonicalSignal.evidenceQuality.level, 'strong');
  assert.equal(result.canonicalSignal.normalizedOutput.sourceCount, 1);
  assert.equal(result.canonicalSignal.productionImpact, 'none');
  assert.equal(result.canonicalSignal.decisionImpact, 'none');
  assert.equal(result.canonicalSignal.executionAuthority, 'none');
  assert.equal(result.canonicalSignal.decisionRole, 'diagnostic_only');
});

test('missing registry definition remains explicit without production authority', () => {
  const result = migrate({ registry: signalRegistry([]) });
  const validation = migration.validateCanonicalSoldEvidenceMigration(result);

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
    migrationId: 'deterministic-canonical-sold-evidence-migration',
    createdAt: '2026-07-28T23:33:00.000Z',
    nativeOutput: nativeCanonicalSoldEvidenceOutput(),
    registry: signalRegistry()
  };
  const first = migration.migrateCanonicalSoldEvidenceSignal(input);
  const second = migration.migrateCanonicalSoldEvidenceSignal(input);

  assert.deepEqual(first, second);
  assert.equal(first.migrationFingerprint, migration.buildCanonicalSoldEvidenceMigrationFingerprint(first));
});

test('shadow comparison uses shared Signal Shadow Comparison Core with supplied migration', () => {
  const migrated = migrate();
  const result = compare({ migration: migrated });
  const validation = comparison.validateCanonicalSoldEvidenceShadowComparison(result);

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
        stats: {
          ...migrated.canonicalSignal.rawOutput.stats,
          recordCount: 1
        }
      },
      normalizedOutput: {
        ...migrated.canonicalSignal.normalizedOutput,
        recordCount: 1
      }
    }
  };
  const result = compare({ migration: tampered });

  assert.equal(result.mismatchCount > 0, true);
  assert.equal(result.mismatches.some((item) => item.code === 'changed_native_field'), true);
  assert.equal(migrated.canonicalSignal.rawOutput.stats.recordCount, 2);
});

test('explicit unknown values remain explicit in migration and comparison', () => {
  const native = nativeCanonicalSoldEvidenceOutput({
    stats: {
      recordCount: 2,
      identityCount: 1,
      duplicateKeyCount: 2,
      duplicateInsertions: 'unknown'
    }
  });
  const result = migrate({ nativeOutput: native });
  const compared = compare({ migration: result });

  assert.equal(result.canonicalSignal.normalizedOutput.duplicateInsertions, 'unknown');
  assert.equal(compared.unknownValueComparison.status, 'exact_match');
  assert.equal(compared.validation.valid, true);
});

test('onboarding modules do not import production runtime or Canonical Sold Evidence subsystem executors', () => {
  const loaded = new Set();
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    loaded.add(request);
    return originalLoad.apply(this, arguments);
  };
  try {
    delete require.cache[require.resolve('../validation/canonicalSoldEvidenceSignalMigration')];
    delete require.cache[require.resolve('../validation/canonicalSoldEvidenceShadowComparison')];
    require('../validation/canonicalSoldEvidenceSignalMigration');
    require('../validation/canonicalSoldEvidenceShadowComparison');
  } finally {
    Module._load = originalLoad;
  }

  assert.equal([...loaded].some((item) => item.includes('server.js')), false);
  assert.equal([...loaded].some((item) => item.includes('scoutScannerService')), false);
  assert.equal([...loaded].some((item) => item.includes('soldEvidenceStore')), false);
  assert.equal([...loaded].some((item) => item.includes('soldEvidenceService')), false);
  assert.equal([...loaded].some((item) => item.includes('canonicalSoldComparisonService')), false);
});
