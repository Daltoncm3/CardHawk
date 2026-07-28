'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const comparison = require('../validation/populationShadowComparison');
const migration = require('../validation/populationSignalMigration');
const registry = require('../validation/intelligenceSignalRegistry');

function populationDefinition(overrides = {}) {
  return registry.createSignalDefinition({
    signalName: 'population.intelligence.engine',
    signalVersion: 'population_engine_v2',
    producer: 'populationEngine',
    producerVersion: 'population_engine_v2',
    producerCategory: 'production_engine',
    signalType: 'context',
    decisionRole: 'diagnostic_only',
    authorityLevel: 'shadow_observation',
    evidenceRole: 'diagnostic_context',
    expectedInputTypes: ['populationEngineOutput'],
    expectedOutputFields: [
      'scarcityScore',
      'scarcityLevel',
      'confidence',
      'populationCount',
      'higherGradeCount',
      'totalGradedCount',
      'gemRate',
      'evidenceQuality'
    ],
    confidenceSemantics: {
      kind: 'reported',
      scale: '0_100',
      basis: 'population_scarcity_confidence'
    },
    uncertaintySemantics: { derivedFrom: 'confidence' },
    evidenceRequirements: {
      populationSourceTracked: true,
      populationDoesNotImplySoldEvidence: true
    },
    allowedStatuses: ['Extremely Rare', 'Rare', 'Scarce', 'Uncommon', 'Common'],
    downstreamConsumers: ['signalAlignmentReport'],
    governanceRequirements: { authorityBoundary: 'shadow_observation_only' },
    compatibilityNotes: ['shadow comparison fixture'],
    createdAt: '2026-07-28T17:00:00.000Z',
    ...overrides
  });
}

function signalRegistry(definitions = [populationDefinition()]) {
  return registry.createSignalRegistry({
    registryId: 'phase-13-population-comparison-registry',
    registryVersion: '1.0.0',
    createdAt: '2026-07-28T17:00:00.000Z',
    definitions
  });
}

function nativeOutput(overrides = {}) {
  return {
    source: 'population_engine',
    scarcityScore: 88,
    scarcityLevel: 'Rare',
    confidence: 81,
    gradingCompany: 'PSA',
    grade: '10',
    populationCount: 42,
    higherGradeCount: 0,
    totalGradedCount: 700,
    gemRate: 0.06,
    certNumber: '12345678',
    populationSource: 'PSA population report',
    lastPopulationUpdate: '2026-07-01',
    registryDemand: 72,
    registryRank: 14,
    crossCompanyPopulation: 95,
    populationVersion: 'population_engine_v2',
    populationUnavailable: false,
    evidenceQuality: 'excellent',
    isGemGrade: true,
    componentScores: {
      populationScore: 63,
      higherGradeScore: 92,
      relativeScore: 65,
      gemRateScore: 84,
      gradeScore: 92,
      evidenceScore: 95
    },
    warnings: [],
    positives: [
      'Grading company identified as PSA.',
      'Grade-level population count is available (42).'
    ],
    reasons: [
      'Grade population represents 6.00% of total graded population.',
      'Registry demand metadata is present (72) but is not used to create scarcity.'
    ],
    summary: 'Rare: PSA 10 has grade population is 42, no higher-grade population was reported, gem-rate is 6.0%, this grade is 6.0% of total graded population. Evidence quality is excellent.',
    ...overrides
  };
}

function migrationArtifact(overrides = {}) {
  const reg = overrides.registry || signalRegistry();
  return migration.migratePopulationSignal({
    migrationId: overrides.migrationId || 'population-shadow-migration',
    createdAt: overrides.createdAt || '2026-07-28T17:01:00.000Z',
    nativeOutput: overrides.nativeOutput || nativeOutput(),
    registry: reg
  });
}

function compare(overrides = {}) {
  return comparison.comparePopulationNativeToShadow({
    comparisonId: overrides.comparisonId || 'population-shadow-comparison',
    createdAt: overrides.createdAt || '2026-07-28T17:02:00.000Z',
    migration: overrides.migration || migrationArtifact(overrides)
  });
}

test('exports Population Shadow Comparison public API and constants', () => {
  assert.equal(comparison.POPULATION_SHADOW_COMPARISON_SOURCE, 'population_shadow_comparison');
  assert.equal(comparison.POPULATION_SHADOW_COMPARISON_SCHEMA_VERSION, '1.0.0');
  assert.deepEqual(comparison.PARITY_STATUSES, [
    'exact_match',
    'semantic_match',
    'mismatch',
    'incomplete',
    'invalid',
    'blocked'
  ]);
  assert.equal(typeof comparison.comparePopulationNativeToShadow, 'function');
  assert.equal(typeof comparison.validatePopulationShadowComparison, 'function');
  assert.equal(typeof comparison.summarizePopulationShadowComparison, 'function');
  assert.equal(typeof comparison.buildPopulationShadowComparisonFingerprint, 'function');
});

test('exact native-to-shadow raw output match is preserved inside a semantic wrapper comparison', () => {
  const result = compare();
  const validation = comparison.validatePopulationShadowComparison(result);

  assert.equal(Object.isFrozen(result), true);
  assert.equal(validation.valid, true);
  assert.equal(result.fieldComparisons.every((field) => field.status === 'exact_match'), true);
  assert.equal(result.parityStatus, 'semantic_match');
  assert.equal(result.mismatchCount, 0);
  assert.equal(result.productionImpact, 'none');
  assert.equal(result.decisionImpact, 'none');
  assert.equal(result.executionAuthority, 'none');
});

test('semantic match distinguishes population context from sold evidence authority', () => {
  const result = compare();

  assert.equal(result.statusComparison.status, 'semantic_match');
  assert.equal(result.confidenceComparison.status, 'semantic_match');
  assert.equal(result.metadataComparison.status, 'semantic_match');
  assert.equal(result.evidenceComparison.status, 'semantic_match');
  assert.equal(result.evidenceComparison.comparisons.find((item) => item.field === 'trueSoldCount').shadowValue, 0);
});

test('changed native value in canonical raw output is detected without repair', () => {
  const migrated = migrationArtifact();
  const tampered = {
    ...migrated,
    canonicalSignal: {
      ...migrated.canonicalSignal,
      rawOutput: {
        ...migrated.canonicalSignal.rawOutput,
        populationCount: 43
      }
    }
  };
  const result = compare({ migration: tampered });

  assert.equal(result.parityStatus, 'invalid');
  assert.equal(result.mismatches.some((mismatch) => mismatch.code === 'changed_native_field' && mismatch.field === 'populationCount'), true);
  assert.equal(result.sourceArtifacts.migration.canonicalSignal.rawOutput.populationCount, 43);
  assert.equal(migrated.canonicalSignal.rawOutput.populationCount, 42);
});

test('changed confidence representation is reported as a mismatch', () => {
  const migrated = migrationArtifact();
  const tampered = {
    ...migrated,
    canonicalSignal: {
      ...migrated.canonicalSignal,
      confidence: {
        ...migrated.canonicalSignal.confidence,
        value: 99
      }
    }
  };
  const result = compare({ migration: tampered });

  assert.equal(result.parityStatus, 'invalid');
  assert.equal(result.validation.valid, false);
  assert.equal(result.errors.some((error) => error.code === 'signal_fingerprint_mismatch'), true);
});

test('changed evidence projection is detected deterministically', () => {
  const migrated = migrationArtifact();
  const tampered = {
    ...migrated,
    canonicalSignal: {
      ...migrated.canonicalSignal,
      evidenceBasis: {
        ...migrated.canonicalSignal.evidenceBasis,
        details: {
          ...migrated.canonicalSignal.evidenceBasis.details,
          populationCount: 99
        }
      }
    }
  };
  const result = compare({ migration: tampered });

  assert.equal(result.evidenceComparison.status, 'mismatch');
  assert.equal(result.mismatches.some((mismatch) => mismatch.code === 'changed_evidence_value'), true);
});

test('changed status and metadata projections are reported separately', () => {
  const migrated = migrationArtifact();
  const tampered = {
    ...migrated,
    canonicalSignal: {
      ...migrated.canonicalSignal,
      normalizedOutput: {
        ...migrated.canonicalSignal.normalizedOutput,
        status: 'Common'
      },
      metadata: {
        ...migrated.canonicalSignal.metadata,
        nativeVersion: 'population_engine_v3'
      }
    }
  };
  const result = compare({ migration: tampered });

  assert.equal(result.statusComparison.status, 'mismatch');
  assert.equal(result.metadataComparison.status, 'mismatch');
  assert.equal(result.mismatches.some((mismatch) => mismatch.code === 'changed_status_value'), true);
  assert.equal(result.mismatches.some((mismatch) => mismatch.code === 'changed_metadata_value'), true);
});

test('missing and unexpected wrapper fields are surfaced explicitly', () => {
  const migrated = migrationArtifact();
  const tampered = {
    ...migrated,
    canonicalSignal: {
      ...migrated.canonicalSignal,
      rawOutput: {
        ...migrated.canonicalSignal.rawOutput,
        wrapperOnlyField: true
      }
    }
  };
  delete tampered.canonicalSignal.rawOutput.summary;
  const result = compare({ migration: tampered });

  assert.equal(result.fieldComparisons.some((item) => item.status === 'missing_wrapper_field'), true);
  assert.equal(result.fieldComparisons.some((item) => item.status === 'unexpected_wrapper_field'), true);
  assert.equal(result.mismatches.some((item) => item.code === 'missing_wrapper_field'), true);
  assert.equal(result.mismatches.some((item) => item.code === 'unexpected_wrapper_field'), true);
});

test('explicit unknown values remain explicit in comparison output', () => {
  const result = compare({
    nativeOutput: nativeOutput({
      confidence: undefined,
      populationSource: '',
      evidenceQuality: undefined,
      warnings: ['Population confidence is unknown.']
    })
  });

  assert.equal(result.unknownValueComparison.status, 'semantic_match');
  assert.equal(result.unknownValueComparison.shadowUnknownPaths.length > 0, true);
  assert.equal(result.confidenceComparison.comparisons.find((item) => item.field === 'confidence').shadowValue, 'unknown');
  assert.equal(result.evidenceComparison.comparisons.find((item) => item.field === 'populationSource').shadowValue, 'unknown');
});

test('comparison is immutable and fingerprints are deterministic', () => {
  const migrated = migrationArtifact();
  const before = JSON.parse(JSON.stringify(migrated));
  const first = compare({ comparisonId: 'deterministic-population-comparison', migration: migrated });
  const second = compare({ comparisonId: 'deterministic-population-comparison', migration: migrated });

  assert.deepEqual(migrated, before);
  assert.deepEqual(first, second);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(first.comparisonFingerprint, comparison.buildPopulationShadowComparisonFingerprint(first));
});

test('authority enforcement reports blocked source artifacts without granting authority', () => {
  const migrated = migrationArtifact({
    registry: signalRegistry([populationDefinition({
      governanceFlags: { productionAuthority: true }
    })])
  });
  const result = compare({ migration: migrated });
  const validation = comparison.validatePopulationShadowComparison(result);

  assert.equal(result.parityStatus, 'invalid');
  assert.equal(validation.valid, false);
  assert.equal(validation.authorityViolations.some((field) => field.includes('productionAuthority')), true);
});

test('invalid source artifact references and stale fingerprints are detected', () => {
  const result = compare();
  const tampered = {
    ...result,
    canonicalSignalFingerprint: 'not-the-signal-fingerprint'
  };
  const validation = comparison.validatePopulationShadowComparison(tampered);

  assert.equal(validation.valid, false);
  assert.equal(validation.sourceReferenceViolations.includes('canonicalSignalFingerprint'), true);
  assert.equal(validation.fingerprintViolations.includes('comparisonFingerprint'), true);
});

test('module does not import or execute Population Engine or production runtime', () => {
  const loaded = new Set();
  const originalLoad = Module._load;
  Module._load = function trackingLoad(request, parent, isMain) {
    loaded.add(request);
    return originalLoad.apply(this, arguments);
  };

  delete require.cache[require.resolve('../validation/populationShadowComparison')];
  require('../validation/populationShadowComparison');
  Module._load = originalLoad;

  assert.equal([...loaded].some((request) => request.includes('engines/populationEngine')), false);
  assert.equal([...loaded].some((request) => request.includes('server')), false);
  assert.equal([...loaded].some((request) => request.includes('scoutScannerService')), false);
});
