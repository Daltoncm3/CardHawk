'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const migration = require('../validation/populationSignalMigration');
const registry = require('../validation/intelligenceSignalRegistry');
const signalContract = require('../validation/canonicalIntelligenceSignalContract');
const alignmentContract = require('../validation/signalAlignmentContract');
const batch = require('../validation/signalAlignmentBatch');
const engine = require('../validation/signalAlignmentEngine');
const report = require('../validation/signalAlignmentReport');
const validationSuite = require('../validation/signalAlignmentValidationSuite');

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
    uncertaintySemantics: {
      derivedFrom: 'confidence'
    },
    evidenceRequirements: {
      populationSourceTracked: true,
      populationDoesNotImplySoldEvidence: true
    },
    allowedStatuses: ['Extremely Rare', 'Rare', 'Scarce', 'Uncommon', 'Common'],
    downstreamConsumers: ['signalAlignmentReport', 'signalAlignmentValidationSuite'],
    governanceRequirements: { authorityBoundary: 'shadow_observation_only' },
    compatibilityNotes: ['wrapper-only migration preserves native Population output'],
    createdAt: '2026-07-28T16:00:00.000Z',
    ...overrides
  });
}

function signalRegistry(definitions = [populationDefinition()]) {
  return registry.createSignalRegistry({
    registryId: 'phase-13-population-registry',
    registryVersion: '1.0.0',
    createdAt: '2026-07-28T16:00:00.000Z',
    definitions
  });
}

function nativePopulationOutput(overrides = {}) {
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

function migrate(overrides = {}) {
  const reg = overrides.registry || signalRegistry();
  return migration.migratePopulationSignal({
    migrationId: overrides.migrationId || 'population-migration',
    createdAt: overrides.createdAt || '2026-07-28T16:01:00.000Z',
    nativeOutput: overrides.nativeOutput || nativePopulationOutput(),
    registry: reg
  });
}

test('exports Population Signal Migration public API and constants', () => {
  assert.equal(migration.POPULATION_MIGRATION_SOURCE, 'population_signal_migration');
  assert.equal(migration.POPULATION_MIGRATION_SCHEMA_VERSION, '1.0.0');
  assert.equal(migration.POPULATION_SIGNAL_NAME, 'population.intelligence.engine');
  assert.equal(migration.POPULATION_PRODUCER, 'populationEngine');
  assert.equal(typeof migration.migratePopulationSignal, 'function');
  assert.equal(typeof migration.validatePopulationMigration, 'function');
  assert.equal(typeof migration.summarizePopulationMigration, 'function');
  assert.equal(typeof migration.buildPopulationMigrationFingerprint, 'function');
});

test('successful migration wraps native Population output through the full alignment pipeline', () => {
  const result = migrate();
  const validation = migration.validatePopulationMigration(result);

  assert.equal(Object.isFrozen(result), true);
  assert.equal(validation.valid, true);
  assert.equal(result.registryResolutionStatus, 'matched');
  assert.equal(result.alignment.alignmentStatus, 'aligned');
  assert.equal(result.alignmentBatch.alignmentCount, 1);
  assert.equal(result.alignmentRun.adaptedSignalCount, 1);
  assert.equal(result.alignmentReport.alignments.length, 1);
  assert.equal(result.alignmentReport.reportValidation.valid, true);
  assert.equal(result.productionImpact, 'none');
  assert.equal(result.decisionImpact, 'none');
  assert.equal(result.executionAuthority, 'none');
});

test('registry resolution creates a matched definition-backed canonical signal', () => {
  const result = migrate();

  assert.equal(result.canonicalSignal.signalName, 'population.intelligence.engine');
  assert.equal(result.canonicalSignal.producer.name, 'populationEngine');
  assert.equal(result.canonicalSignal.signalType, 'context');
  assert.equal(result.canonicalSignal.authorityLevel, 'shadow_observation');
  assert.equal(result.alignment.signalDefinition.definitionFingerprint, result.registry.definitions[0].definitionFingerprint);
  assert.equal(signalContract.validateCanonicalSignal(result.canonicalSignal).valid, true);
  assert.equal(alignmentContract.validateSignalAlignment(result.alignment).valid, true);
});

test('missing registry definition remains explicit without inventing signal authority', () => {
  const result = migrate({
    registry: signalRegistry([])
  });
  const validation = migration.validatePopulationMigration(result);

  assert.equal(result.registryResolutionStatus, 'definition_missing');
  assert.equal(result.alignment.alignmentStatus, 'definition_missing');
  assert.equal(result.alignment.signalDefinition, 'unknown');
  assert.equal(result.alignmentRun.summary.registryLookupFailureCount, 1);
  assert.equal(validation.valid, true);
  assert.equal(validation.registryResolutionStatus, 'definition_missing');
  assert.deepEqual(validation.authorityViolations, []);
});

test('migration preserves native Population output exactly and never mutates input', () => {
  const native = nativePopulationOutput();
  const before = JSON.parse(JSON.stringify(native));
  const result = migrate({ nativeOutput: native });

  assert.deepEqual(native, before);
  assert.deepEqual(result.nativeOutput, before);
  assert.deepEqual(result.canonicalSignal.rawOutput, before);
  assert.deepEqual(result.adaptedSignal.nativeOutput, before);
  assert.equal(result.parityStatus, 'preserved');
  assert.equal(result.validation.parityStatus, 'preserved');
});

test('deterministic fingerprints and ordering are stable for identical inputs', () => {
  const input = {
    migrationId: 'deterministic-population-migration',
    createdAt: '2026-07-28T16:02:00.000Z',
    nativeOutput: nativePopulationOutput(),
    registry: signalRegistry()
  };
  const first = migration.migratePopulationSignal(input);
  const second = migration.migratePopulationSignal(input);

  assert.deepEqual(first, second);
  assert.equal(first.migrationFingerprint, migration.buildPopulationMigrationFingerprint(first));
  assert.equal(first.alignmentBatch.batchFingerprint, batch.buildAlignmentBatchFingerprint(first.alignmentBatch));
  assert.equal(first.alignmentRun.runFingerprint, engine.buildSignalAlignmentRunFingerprint(first.alignmentRun));
  assert.equal(first.alignmentReport.reportFingerprint, report.buildSignalAlignmentReportFingerprint(first.alignmentReport));
});

test('explicit unknown values are preserved in wrapper artifacts', () => {
  const result = migrate({
    nativeOutput: nativePopulationOutput({
      confidence: undefined,
      populationSource: '',
      lastPopulationUpdate: '',
      evidenceQuality: undefined,
      warnings: ['Population confidence is unknown.']
    })
  });

  assert.equal(result.canonicalSignal.confidence.value, 'unknown');
  assert.equal(result.canonicalSignal.confidenceLevel, 'unknown');
  assert.equal(result.canonicalSignal.uncertainty.level, 'unknown');
  assert.equal(result.canonicalSignal.evidenceBasis.details.populationSource, 'unknown');
  assert.equal(result.canonicalSignal.evidenceQuality.level, 'unknown');
  assert.equal(result.validation.valid, true);
});

test('authority enforcement blocks unsafe registry definitions', () => {
  const result = migrate({
    registry: signalRegistry([populationDefinition({
      governanceFlags: { productionAuthority: true }
    })])
  });
  const validation = migration.validatePopulationMigration(result);

  assert.equal(result.alignment.alignmentStatus, 'blocked');
  assert.equal(validation.valid, false);
  assert.equal(validation.reasonCodes.includes('authority_boundary_violation'), true);
  assert.equal(validation.authorityViolations.some((field) => field.includes('productionAuthority')), true);
});

test('report generation remains compatible with Signal Alignment Report validation', () => {
  const result = migrate();
  const reportValidation = report.validateSignalAlignmentReport(result.alignmentReport);

  assert.equal(reportValidation.valid, true);
  assert.equal(result.alignmentReport.alignmentRunId, result.alignmentRun.alignmentRunId);
  assert.equal(result.alignmentReport.alignmentRunFingerprint, result.alignmentRun.runFingerprint);
  assert.equal(result.alignmentReport.relationships.length, 0);
});

test('migration output remains compatible with the Phase 13 validation-suite module boundary', () => {
  const result = migrate();
  const summary = validationSuite.summarizeValidationSuite({
    suiteId: 'empty-population-boundary-suite',
    scenarioResults: [],
    validation: { valid: true, reasonCodes: [], authorityViolations: [], fingerprintViolations: [] }
  });

  assert.equal(result.alignmentRun.source, 'signal_alignment_engine');
  assert.equal(result.alignmentReport.source, 'signal_alignment_report');
  assert.equal(summary.valid, true);
  assert.equal(summary.productionImpact, 'none');
});

test('module does not import or execute the Population Engine or production runtime', () => {
  const loaded = new Set();
  const originalLoad = Module._load;
  Module._load = function trackingLoad(request, parent, isMain) {
    loaded.add(request);
    return originalLoad.apply(this, arguments);
  };

  delete require.cache[require.resolve('../validation/populationSignalMigration')];
  require('../validation/populationSignalMigration');
  Module._load = originalLoad;

  assert.equal([...loaded].some((request) => request.includes('engines/populationEngine')), false);
  assert.equal([...loaded].some((request) => request.includes('server')), false);
  assert.equal([...loaded].some((request) => request.includes('scoutScannerService')), false);
});
