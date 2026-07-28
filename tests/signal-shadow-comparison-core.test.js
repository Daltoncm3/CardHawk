'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const core = require('../validation/signalShadowComparisonCore');
const gradeMigration = require('../validation/gradePremiumSignalMigration');
const registry = require('../validation/intelligenceSignalRegistry');

function gradeDefinition() {
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
    expectedOutputFields: ['gradePremiumScore', 'premiumJustification'],
    confidenceSemantics: { kind: 'not_reported' },
    uncertaintySemantics: { sourceField: 'premiumRiskLevel' },
    evidenceRequirements: { exactGradeSoldSupportTracked: true },
    allowedStatuses: ['justified'],
    downstreamConsumers: ['signalAlignmentReport'],
    governanceRequirements: { authorityBoundary: 'shadow_observation_only' },
    compatibilityNotes: ['core test'],
    createdAt: '2026-07-28T23:45:00.000Z'
  });
}

function signalRegistry() {
  return registry.createSignalRegistry({
    registryId: 'signal-shadow-comparison-core-test-registry',
    registryVersion: '1.0.0',
    createdAt: '2026-07-28T23:45:00.000Z',
    definitions: [gradeDefinition()]
  });
}

function nativeOutput(overrides = {}) {
  return {
    source: 'grade_premium_engine',
    version: '1.2',
    gradePremiumScore: 82,
    premiumJustification: 'justified',
    premiumRiskLevel: 'low',
    targetGrade: { gradingCompany: 'psa', grade: '10' },
    soldSupport: { sameGradeCount: 6, lowerGradeCount: 3, higherGradeCount: 1, rawCount: 3 },
    dimensions: { sameGradeSupport: { status: 'strong', score: 88 } },
    warnings: [],
    summary: 'Grade premium appears justified.',
    ...overrides
  };
}

function migrationArtifact(output = nativeOutput()) {
  return gradeMigration.migrateGradePremiumSignal({
    migrationId: 'signal-shadow-core-migration',
    createdAt: '2026-07-28T23:46:00.000Z',
    nativeOutput: output,
    registry: signalRegistry()
  });
}

function validationOk() {
  return {
    valid: true,
    errors: [],
    warnings: [],
    reasonCodes: [],
    parityStatus: 'semantic_match',
    mismatchCount: 0,
    authorityViolations: [],
    fingerprintViolations: [],
    sourceReferenceViolations: []
  };
}

function config(overrides = {}) {
  return {
    schemaVersion: '1.0.0',
    comparisonSource: 'test_shadow_comparison',
    migrationAliases: ['gradePremiumMigration'],
    defaultComparisonIdPrefix: 'test-shadow-comparison',
    comparisonScope: 'test_native_to_shadow',
    migrate: () => {
      throw new Error('migration should not execute');
    },
    compareNativeFields: (native, signal) => ({
      status: 'exact_match',
      comparisons: [{
        field: 'gradePremiumScore',
        nativePath: 'gradePremiumScore',
        shadowPath: 'canonicalSignal.rawOutput.gradePremiumScore',
        status: native.gradePremiumScore === signal.rawOutput.gradePremiumScore ? 'exact_match' : 'mismatch',
        nativeValue: native.gradePremiumScore,
        shadowValue: signal.rawOutput.gradePremiumScore
      }],
      mismatches: native.gradePremiumScore === signal.rawOutput.gradePremiumScore ? [] : [{
        code: 'changed_native_field',
        field: 'gradePremiumScore',
        message: 'Native score changed.',
        nativeValue: native.gradePremiumScore,
        shadowValue: signal.rawOutput.gradePremiumScore
      }]
    }),
    compareEvidence: () => ({ status: 'exact_match', comparisons: [], mismatches: [] }),
    compareConfidence: () => ({ status: 'semantic_match', comparisons: [], mismatches: [] }),
    compareStatus: () => ({ status: 'semantic_match', comparisons: [], mismatches: [] }),
    compareMetadata: () => ({ status: 'semantic_match', comparisons: [], mismatches: [] }),
    compareUnknownValues: () => ({ status: 'semantic_match', nativeUnknownFields: [], shadowUnknownPaths: [], mismatches: [] }),
    determineParityStatus: (parts, validation) => {
      if (!validation.migrationValid || !validation.signalValid || !validation.alignmentValid || !validation.reportValid) return 'invalid';
      if (parts.mismatches.length > 0) return 'mismatch';
      return 'semantic_match';
    },
    validateMigration: gradeMigration.validateGradePremiumMigration,
    summarizeComparison: core.summarizeSignalShadowComparisonLifecycle,
    validateComparison: () => validationOk(),
    buildComparisonFingerprint: core.buildSignalShadowComparisonLifecycleFingerprint,
    ...overrides
  };
}

test('exports Signal Shadow Comparison Core public API', () => {
  assert.equal(core.SIGNAL_SHADOW_COMPARISON_CORE_SOURCE, 'signal_shadow_comparison_core');
  assert.equal(typeof core.executeSignalShadowComparisonLifecycle, 'function');
  assert.equal(typeof core.validateSignalShadowComparisonLifecycle, 'function');
  assert.equal(typeof core.summarizeSignalShadowComparisonLifecycle, 'function');
  assert.equal(typeof core.buildSignalShadowComparisonLifecycleFingerprint, 'function');
});

test('executes shared comparison lifecycle from supplied migration without executing migration hook', () => {
  const migration = migrationArtifact();
  const comparison = core.executeSignalShadowComparisonLifecycle({
    comparisonId: 'core-comparison',
    createdAt: '2026-07-28T23:47:00.000Z',
    migration
  }, {}, config());

  assert.equal(comparison.source, 'test_shadow_comparison');
  assert.equal(comparison.parityStatus, 'semantic_match');
  assert.equal(comparison.mismatchCount, 0);
  assert.equal(comparison.sourceArtifacts.migration.migrationFingerprint, migration.migrationFingerprint);
  assert.equal(comparison.productionImpact, 'none');
  assert.equal(comparison.decisionImpact, 'none');
  assert.equal(comparison.executionAuthority, 'none');
});

test('preserves immutable inputs and returns immutable comparison output', () => {
  const migration = migrationArtifact();
  const before = JSON.parse(JSON.stringify(migration));
  const comparison = core.executeSignalShadowComparisonLifecycle({ migration }, {}, config());

  assert.deepEqual(migration, before);
  assert.equal(Object.isFrozen(comparison), true);
  assert.throws(() => {
    comparison.sourceArtifacts.nativeOutput.gradePremiumScore = 1;
  }, /read only|Cannot assign/);
});

test('collects and sorts mismatch evidence deterministically', () => {
  const migration = migrationArtifact();
  const comparison = core.executeSignalShadowComparisonLifecycle({
    nativeOutput: { ...migration.nativeOutput, gradePremiumScore: 81 },
    migration
  }, {}, config({
    compareEvidence: () => ({
      status: 'mismatch',
      comparisons: [],
      mismatches: [{ code: 'z_evidence', field: 'evidence', message: 'Evidence changed.' }]
    }),
    compareMetadata: () => ({
      status: 'mismatch',
      comparisons: [],
      mismatches: [{ code: 'a_metadata', field: 'metadata', message: 'Metadata changed.' }]
    })
  }));

  assert.equal(comparison.parityStatus, 'mismatch');
  assert.deepEqual(comparison.mismatches.map((mismatch) => mismatch.code), ['a_metadata', 'changed_native_field', 'z_evidence']);
  assert.equal(comparison.mismatchCount, 3);
});

test('validation aggregates contract, nested, and authority violations', () => {
  const migration = migrationArtifact();
  const comparison = core.executeSignalShadowComparisonLifecycle({ migration }, {}, config());
  const contractArtifact = core.buildSignalShadowComparisonContractArtifact(comparison, {
    productionImpact: 'changes_production'
  });
  const validation = core.validateSignalShadowComparisonLifecycle({
    ...comparison,
    executionAuthority: 'may_execute'
  }, {
    contractArtifact,
    validations: [
      ['custom', {
        valid: false,
        errors: [{ code: 'custom_error', message: 'Custom validation failed.', field: 'field' }],
        warnings: [{ code: 'custom_warning', message: 'Custom warning.', field: 'warning' }],
        authorityViolations: ['decisionImpact'],
        fingerprintViolations: ['comparisonFingerprint']
      }]
    ]
  });

  assert.equal(validation.valid, false);
  assert.equal(validation.reasonCodes.includes('authority_boundary_violation'), true);
  assert.equal(validation.reasonCodes.includes('custom_error'), true);
  assert.equal(validation.reasonCodes.includes('custom_warning'), true);
  assert.equal(validation.authorityViolations.includes('executionAuthority'), true);
  assert.equal(validation.authorityViolations.includes('custom.decisionImpact'), true);
  assert.equal(validation.fingerprintViolations.includes('custom.comparisonFingerprint'), true);
});

test('contract artifact projection preserves explicit unknown values', () => {
  const migration = migrationArtifact(nativeOutput({ version: 'unknown' }));
  const comparison = core.executeSignalShadowComparisonLifecycle({ migration }, {}, config());
  const artifact = core.buildSignalShadowComparisonContractArtifact(comparison, {
    engineVersion: 'unknown',
    signalVersion: 'unknown'
  });

  assert.equal(artifact.engineVersion, 'unknown');
  assert.equal(artifact.signalVersion, 'unknown');
  assert.equal(artifact.productionImpact, 'none');
});

test('core fails closed for missing lifecycle hooks', () => {
  const comparison = core.executeSignalShadowComparisonLifecycle({
    migration: migrationArtifact()
  }, {}, {
    schemaVersion: '1.0.0',
    comparisonSource: 'test_shadow_comparison'
  });

  assert.equal(comparison.parityStatus, 'blocked');
  assert.equal(comparison.errors[0].code, 'signal_shadow_comparison_lifecycle_failed');
  assert.equal(comparison.executionAuthority, 'none');
});

test('module does not import runtime, native engines, migrations, or existing comparison modules', () => {
  const loaded = new Set();
  const originalLoad = Module._load;
  Module._load = function trackingLoad(request, parent, isMain) {
    loaded.add(request);
    return originalLoad.apply(this, arguments);
  };

  delete require.cache[require.resolve('../validation/signalShadowComparisonCore')];
  require('../validation/signalShadowComparisonCore');
  Module._load = originalLoad;

  assert.equal([...loaded].some((request) => request.includes('server')), false);
  assert.equal([...loaded].some((request) => request.includes('scoutScannerService')), false);
  assert.equal([...loaded].some((request) => request.includes('engines/')), false);
  assert.equal([...loaded].some((request) => request.includes('gradePremiumSignalMigration')), false);
  assert.equal([...loaded].some((request) => request.includes('populationSignalMigration')), false);
  assert.equal([...loaded].some((request) => request.includes('gradePremiumShadowComparison')), false);
  assert.equal([...loaded].some((request) => request.includes('populationShadowComparison')), false);
});
