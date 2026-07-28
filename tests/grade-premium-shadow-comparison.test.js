'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const comparison = require('../validation/gradePremiumShadowComparison');
const migration = require('../validation/gradePremiumSignalMigration');
const registry = require('../validation/intelligenceSignalRegistry');

function gradePremiumDefinition(overrides = {}) {
  return registry.createSignalDefinition({
    signalName: 'grade.premium.engine',
    signalVersion: '1.2',
    producer: 'gradePremiumEngine',
    producerVersion: '1.2',
    producerCategory: 'production_engine',
    signalType: 'grading',
    decisionRole: 'diagnostic_only',
    authorityLevel: 'shadow_observation',
    evidenceRole: 'diagnostic_context',
    expectedInputTypes: ['gradePremiumEngineOutput'],
    expectedOutputFields: ['gradePremiumScore', 'premiumJustification', 'premiumRiskLevel', 'soldSupport'],
    confidenceSemantics: { kind: 'not_reported' },
    uncertaintySemantics: { sourceField: 'premiumRiskLevel' },
    evidenceRequirements: { exactGradeSoldSupportTracked: true },
    allowedStatuses: ['justified', 'partially_justified', 'overextended', 'unproven', 'unknown'],
    downstreamConsumers: ['signalAlignmentReport'],
    governanceRequirements: { authorityBoundary: 'shadow_observation_only' },
    compatibilityNotes: ['shadow comparison fixture'],
    createdAt: '2026-07-28T15:00:00.000Z',
    ...overrides
  });
}

function signalRegistry(definitions = [gradePremiumDefinition()]) {
  return registry.createSignalRegistry({
    registryId: 'phase-13-grade-premium-comparison-registry',
    registryVersion: '1.0.0',
    createdAt: '2026-07-28T15:00:00.000Z',
    definitions
  });
}

function nativeOutput(overrides = {}) {
  return {
    source: 'grade_premium_engine',
    version: '1.2',
    gradePremiumScore: 82,
    premiumJustification: 'justified',
    premiumRiskLevel: 'low',
    targetGrade: { gradingCompany: 'psa', grade: '10', rawGradedState: 'graded' },
    premiumMetrics: { sameGradeMedian: 150, lowerGradeMedian: 90 },
    soldSupport: {
      sameGradeCount: 6,
      lowerGradeCount: 3,
      higherGradeCount: 1,
      rawCount: 3,
      activeContextCount: 0
    },
    dimensions: {
      sameGradeSupport: { status: 'strong', score: 88, explanation: 'Exact grade sold support is strong.' }
    },
    warnings: [],
    positives: ['sameGradeSupport: Exact grade sold support is strong.'],
    summary: 'Grade premium appears justified by exact-grade sold evidence and supporting market context.',
    ...overrides
  };
}

function migrationArtifact(overrides = {}) {
  const reg = overrides.registry || signalRegistry();
  return migration.migrateGradePremiumSignal({
    migrationId: overrides.migrationId || 'grade-premium-shadow-migration',
    createdAt: overrides.createdAt || '2026-07-28T15:01:00.000Z',
    nativeOutput: overrides.nativeOutput || nativeOutput(),
    registry: reg
  });
}

function compare(overrides = {}) {
  return comparison.compareGradePremiumNativeToShadow({
    comparisonId: overrides.comparisonId || 'grade-premium-shadow-comparison',
    createdAt: overrides.createdAt || '2026-07-28T15:02:00.000Z',
    migration: overrides.migration || migrationArtifact(overrides)
  });
}

test('exports Grade Premium Shadow Comparison public API and constants', () => {
  assert.equal(comparison.GRADE_PREMIUM_SHADOW_COMPARISON_SOURCE, 'grade_premium_shadow_comparison');
  assert.equal(comparison.GRADE_PREMIUM_SHADOW_COMPARISON_SCHEMA_VERSION, '1.0.0');
  assert.deepEqual(comparison.PARITY_STATUSES, [
    'exact_match',
    'semantic_match',
    'mismatch',
    'incomplete',
    'invalid',
    'blocked'
  ]);
  assert.equal(typeof comparison.compareGradePremiumNativeToShadow, 'function');
  assert.equal(typeof comparison.validateGradePremiumShadowComparison, 'function');
  assert.equal(typeof comparison.summarizeGradePremiumShadowComparison, 'function');
  assert.equal(typeof comparison.buildGradePremiumShadowComparisonFingerprint, 'function');
});

test('exact native-to-shadow raw output match is preserved inside a semantic wrapper comparison', () => {
  const result = compare();
  const validation = comparison.validateGradePremiumShadowComparison(result);

  assert.equal(Object.isFrozen(result), true);
  assert.equal(validation.valid, true);
  assert.equal(result.fieldComparisons.every((field) => field.status === 'exact_match'), true);
  assert.equal(result.parityStatus, 'semantic_match');
  assert.equal(result.mismatchCount, 0);
  assert.equal(result.productionImpact, 'none');
  assert.equal(result.decisionImpact, 'none');
  assert.equal(result.executionAuthority, 'none');
});

test('semantic match distinguishes normalized wrapper projections from exact raw equality', () => {
  const result = compare();

  assert.equal(result.statusComparison.status, 'semantic_match');
  assert.equal(result.confidenceComparison.status, 'semantic_match');
  assert.equal(result.metadataComparison.status, 'semantic_match');
  assert.equal(result.evidenceComparison.status, 'exact_match');
});

test('changed native value in canonical raw output is detected without repair', () => {
  const migrated = migrationArtifact();
  const tampered = {
    ...migrated,
    canonicalSignal: {
      ...migrated.canonicalSignal,
      rawOutput: {
        ...migrated.canonicalSignal.rawOutput,
        gradePremiumScore: 81
      }
    }
  };
  const result = compare({ migration: tampered });

  assert.equal(result.parityStatus, 'invalid');
  assert.equal(result.mismatches.some((mismatch) => mismatch.code === 'changed_native_field' && mismatch.field === 'gradePremiumScore'), true);
  assert.equal(result.sourceArtifacts.migration.canonicalSignal.rawOutput.gradePremiumScore, 81);
  assert.equal(migrated.canonicalSignal.rawOutput.gradePremiumScore, 82);
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
  assert.equal(result.validation.reasonCodes.includes('comparison_fingerprint_mismatch'), false);
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
        trueSoldCount: 99
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
        status: 'unproven'
      },
      metadata: {
        ...migrated.canonicalSignal.metadata,
        nativeVersion: '2.0'
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
      premiumRiskLevel: undefined,
      soldSupport: undefined,
      warnings: ['premium risk unknown']
    })
  });

  assert.equal(result.unknownValueComparison.status, 'semantic_match');
  assert.equal(result.unknownValueComparison.nativeUnknownFields.includes('premiumRiskLevel'), false);
  assert.equal(result.unknownValueComparison.shadowUnknownPaths.length > 0, true);
  assert.equal(result.statusComparison.comparisons.find((item) => item.field === 'premiumRiskLevel').shadowValue, 'unknown');
});

test('comparison is immutable and fingerprints are deterministic', () => {
  const migrated = migrationArtifact();
  const before = JSON.parse(JSON.stringify(migrated));
  const first = compare({ comparisonId: 'deterministic-comparison', migration: migrated });
  const second = compare({ comparisonId: 'deterministic-comparison', migration: migrated });

  assert.deepEqual(migrated, before);
  assert.deepEqual(first, second);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(first.comparisonFingerprint, comparison.buildGradePremiumShadowComparisonFingerprint(first));
});

test('authority enforcement reports blocked source artifacts without granting authority', () => {
  const migrated = migrationArtifact({
    registry: signalRegistry([gradePremiumDefinition({
      governanceFlags: { productionAuthority: true }
    })])
  });
  const result = compare({ migration: migrated });
  const validation = comparison.validateGradePremiumShadowComparison(result);

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
  const validation = comparison.validateGradePremiumShadowComparison(tampered);

  assert.equal(validation.valid, false);
  assert.equal(validation.sourceReferenceViolations.includes('canonicalSignalFingerprint'), true);
  assert.equal(validation.fingerprintViolations.includes('comparisonFingerprint'), true);
});

test('module does not import or execute Grade Premium Engine or production runtime', () => {
  const loaded = new Set();
  const originalLoad = Module._load;
  Module._load = function trackingLoad(request, parent, isMain) {
    loaded.add(request);
    return originalLoad.apply(this, arguments);
  };

  delete require.cache[require.resolve('../validation/gradePremiumShadowComparison')];
  require('../validation/gradePremiumShadowComparison');
  Module._load = originalLoad;

  assert.equal([...loaded].some((request) => request.includes('engines/gradePremiumEngine')), false);
  assert.equal([...loaded].some((request) => request.includes('server')), false);
  assert.equal([...loaded].some((request) => request.includes('scoutScannerService')), false);
});
