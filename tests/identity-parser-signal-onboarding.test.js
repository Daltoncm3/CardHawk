'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const migration = require('../validation/identityParserSignalMigration');
const comparison = require('../validation/identityParserShadowComparison');
const registry = require('../validation/intelligenceSignalRegistry');
const signalContract = require('../validation/canonicalIntelligenceSignalContract');
const core = require('../validation/signalMigrationCore');
const comparisonCore = require('../validation/signalShadowComparisonCore');

function identityParserDefinition(overrides = {}) {
  return registry.createSignalDefinition({
    signalName: 'identity.parser.diagnostics',
    signalVersion: '1.0.0',
    producer: 'identityParserDiagnostics',
    producerVersion: '1.0.0',
    producerCategory: 'offline_validation',
    signalType: 'identity',
    decisionRole: 'diagnostic_only',
    authorityLevel: 'shadow_observation',
    evidenceRole: 'diagnostic_context',
    expectedInputTypes: ['identityParserDiagnosticOutput'],
    expectedOutputFields: [
      'identityEligibility',
      'diagnosticStatus',
      'ambiguityLevel',
      'parserCanonicalComparison',
      'fieldsConfirmed',
      'fieldsMissing',
      'fieldsConflicting',
      'fieldsInferred'
    ],
    confidenceSemantics: {
      kind: 'derived',
      scale: '0_100',
      basis: 'identity_diagnostic_status_ambiguity_and_eligibility'
    },
    uncertaintySemantics: {
      sourceField: 'ambiguityLevel'
    },
    evidenceRequirements: {
      identityEligibilityTracked: true,
      parserCanonicalComparisonRequired: true,
      diagnosticOnly: true
    },
    allowedStatuses: ['exact', 'strong_candidate', 'partial', 'ambiguous', 'unsupported', 'blocked'],
    downstreamConsumers: ['signalAlignmentReport', 'signalAlignmentValidationSuite'],
    governanceRequirements: { authorityBoundary: 'shadow_observation_only' },
    compatibilityNotes: ['wrapper-only migration preserves native Identity Parser Diagnostics output'],
    createdAt: '2026-07-28T22:00:00.000Z',
    ...overrides
  });
}

function signalRegistry(definitions = [identityParserDefinition()]) {
  return registry.createSignalRegistry({
    registryId: 'phase-14-identity-parser-registry',
    registryVersion: '1.0.0',
    createdAt: '2026-07-28T22:00:00.000Z',
    definitions
  });
}

function nativeIdentityParserOutput(overrides = {}) {
  return {
    source: 'identity_parser_diagnostics',
    schemaVersion: '1.0.0',
    productionImpact: 'none',
    decisionImpact: 'none',
    identityEligibility: {
      exactCompEligible: true,
      valuationEligible: true,
      manualReviewRequired: false,
      contextOnly: false
    },
    diagnosticStatus: 'exact',
    ambiguityLevel: 'none',
    blockingIssues: [],
    warnings: [],
    parserCanonicalComparison: {
      fields: {
        subject: {
          field: 'subject',
          parserValue: 'Anthony Volpe',
          canonicalValue: 'Anthony Volpe',
          status: 'confirmed'
        },
        year: {
          field: 'year',
          parserValue: 2023,
          canonicalValue: 2023,
          status: 'confirmed'
        }
      },
      legacyAdapterComparison: {
        status: 'aligned',
        mismatches: []
      }
    },
    fieldsConfirmed: [
      { field: 'subject', parserValue: 'Anthony Volpe', canonicalValue: 'Anthony Volpe', status: 'confirmed' },
      { field: 'year', parserValue: 2023, canonicalValue: 2023, status: 'confirmed' },
      { field: 'setName', parserValue: 'Topps Chrome', canonicalValue: 'Topps Chrome', status: 'confirmed' },
      { field: 'cardNumber', parserValue: 'RA-AV', canonicalValue: 'RA-AV', status: 'confirmed' },
      { field: 'rawOrGraded', parserValue: 'graded', canonicalValue: 'graded', status: 'confirmed' }
    ],
    fieldsMissing: [],
    fieldsConflicting: [],
    fieldsInferred: [],
    unsupportedIdentityFields: [],
    recommendedReviewAction: 'identity_diagnostic_complete',
    stableFingerprint: 'identity-parser-native-fingerprint',
    ...overrides
  };
}

function migrate(overrides = {}) {
  return migration.migrateIdentityParserSignal({
    migrationId: overrides.migrationId || 'identity-parser-migration',
    createdAt: overrides.createdAt || '2026-07-28T22:01:00.000Z',
    nativeOutput: overrides.nativeOutput || nativeIdentityParserOutput(),
    registry: overrides.registry || signalRegistry()
  });
}

function compare(overrides = {}) {
  return comparison.compareIdentityParserNativeToShadow({
    comparisonId: overrides.comparisonId || 'identity-parser-shadow-comparison',
    createdAt: overrides.createdAt || '2026-07-28T22:02:00.000Z',
    migration: overrides.migration || migrate(overrides)
  });
}

test('exports Identity Parser onboarding public APIs and constants', () => {
  assert.equal(migration.IDENTITY_PARSER_MIGRATION_SOURCE, 'identity_parser_signal_migration');
  assert.equal(migration.IDENTITY_PARSER_SIGNAL_NAME, 'identity.parser.diagnostics');
  assert.equal(typeof migration.createIdentityParserAdapter, 'function');
  assert.equal(typeof migration.migrateIdentityParserSignal, 'function');
  assert.equal(typeof migration.validateIdentityParserMigration, 'function');
  assert.equal(typeof migration.summarizeIdentityParserMigration, 'function');
  assert.equal(typeof migration.buildIdentityParserMigrationFingerprint, 'function');
  assert.equal(comparison.IDENTITY_PARSER_SHADOW_COMPARISON_SOURCE, 'identity_parser_shadow_comparison');
  assert.equal(typeof comparison.compareIdentityParserNativeToShadow, 'function');
  assert.equal(typeof comparison.validateIdentityParserShadowComparison, 'function');
});

test('migration uses shared Signal Migration Core and declarative adapter contract', () => {
  const result = migrate();
  const validation = migration.validateIdentityParserMigration(result);

  assert.equal(Object.isFrozen(result), true);
  assert.equal(validation.valid, true);
  assert.equal(result.registryResolutionStatus, 'matched');
  assert.equal(result.alignment.alignmentStatus, 'aligned');
  assert.equal(result.alignmentBatch.alignmentCount, 1);
  assert.equal(result.alignmentRun.adaptedSignalCount, 1);
  assert.equal(result.alignmentReport.alignments.length, 1);
  assert.equal(result.adapter.signalName, 'identity.parser.diagnostics');
  assert.equal(result.coreArtifact.lifecycleStatus, 'validated');
  assert.equal(core.validateSignalMigrationLifecycle(result, { adapter: result.adapter, coreArtifact: result.coreArtifact }).valid, true);
});

test('migration preserves native Identity Parser output exactly and does not mutate input', () => {
  const native = nativeIdentityParserOutput();
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

test('identity eligibility remains diagnostic context rather than production authority', () => {
  const result = migrate();

  assert.equal(result.canonicalSignal.normalizedOutput.valuationEligible, true);
  assert.equal(result.canonicalSignal.evidenceBasis.details.exactCompEligible, true);
  assert.equal(result.canonicalSignal.productionImpact, 'none');
  assert.equal(result.canonicalSignal.decisionImpact, 'none');
  assert.equal(result.canonicalSignal.executionAuthority, 'none');
  assert.equal(result.canonicalSignal.decisionRole, 'diagnostic_only');
});

test('missing registry definition remains explicit without production authority', () => {
  const result = migrate({ registry: signalRegistry([]) });
  const validation = migration.validateIdentityParserMigration(result);

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
    migrationId: 'deterministic-identity-parser-migration',
    createdAt: '2026-07-28T22:03:00.000Z',
    nativeOutput: nativeIdentityParserOutput(),
    registry: signalRegistry()
  };
  const first = migration.migrateIdentityParserSignal(input);
  const second = migration.migrateIdentityParserSignal(input);

  assert.deepEqual(first, second);
  assert.equal(first.migrationFingerprint, migration.buildIdentityParserMigrationFingerprint(first));
});

test('shadow comparison uses shared Signal Shadow Comparison Core with supplied migration', () => {
  const migrated = migrate();
  const result = compare({ migration: migrated });
  const validation = comparison.validateIdentityParserShadowComparison(result);

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
        diagnosticStatus: 'ambiguous'
      },
      normalizedOutput: {
        ...migrated.canonicalSignal.normalizedOutput,
        status: 'ambiguous'
      }
    }
  };
  const result = compare({ migration: tampered });

  assert.equal(result.mismatchCount > 0, true);
  assert.equal(result.mismatches.some((item) => item.code === 'changed_native_field'), true);
  assert.equal(migrated.canonicalSignal.rawOutput.diagnosticStatus, 'exact');
});

test('explicit unknown values remain explicit in migration and comparison', () => {
  const native = nativeIdentityParserOutput({
    identityEligibility: {
      exactCompEligible: true,
      valuationEligible: true,
      manualReviewRequired: 'unknown',
      contextOnly: false
    }
  });
  const migrated = migrate({ nativeOutput: native });
  const result = compare({ migration: migrated });

  assert.equal(migrated.canonicalSignal.normalizedOutput.manualReviewRequired, 'unknown');
  assert.equal(result.unknownValueComparison.status, 'exact_match');
});

test('migration and comparison do not import or execute Identity Parser diagnostics or production runtime', () => {
  const before = new Set(Object.keys(Module._cache));
  const result = compare({ migration: migrate() });
  const after = Object.keys(Module._cache).filter((key) => !before.has(key));

  assert.equal(result.validation.valid, true);
  assert.equal(after.some((key) => key.endsWith('/server.js')), false);
  assert.equal(after.some((key) => key.endsWith('/services/scoutScannerService.js')), false);
  assert.equal(after.some((key) => key.endsWith('/validation/identityParserDiagnostics.js')), false);
  assert.equal(after.some((key) => key.endsWith('/engines/canonicalIdentityEngine.js')), false);
  assert.equal(after.some((key) => key.endsWith('/engines/legacyIdentityAdapter.js')), false);
});
