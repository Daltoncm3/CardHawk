'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const migration = require('../validation/gradePremiumSignalMigration');
const registry = require('../validation/intelligenceSignalRegistry');
const signalContract = require('../validation/canonicalIntelligenceSignalContract');
const alignmentContract = require('../validation/signalAlignmentContract');
const batch = require('../validation/signalAlignmentBatch');
const engine = require('../validation/signalAlignmentEngine');
const report = require('../validation/signalAlignmentReport');
const validationSuite = require('../validation/signalAlignmentValidationSuite');

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
    expectedOutputFields: [
      'gradePremiumScore',
      'premiumJustification',
      'premiumRiskLevel',
      'targetGrade',
      'premiumMetrics',
      'soldSupport',
      'dimensions'
    ],
    confidenceSemantics: {
      kind: 'not_reported',
      note: 'Grade Premium output exposes a score, not calibrated confidence.'
    },
    uncertaintySemantics: {
      sourceField: 'premiumRiskLevel'
    },
    evidenceRequirements: {
      exactGradeSoldSupportTracked: true,
      activeContextDoesNotEqualSoldSupport: true
    },
    allowedStatuses: ['justified', 'partially_justified', 'overextended', 'unproven', 'unknown'],
    downstreamConsumers: ['signalAlignmentReport', 'signalAlignmentValidationSuite'],
    governanceRequirements: { authorityBoundary: 'shadow_observation_only' },
    compatibilityNotes: ['wrapper-only migration preserves native Grade Premium output'],
    createdAt: '2026-07-28T14:00:00.000Z',
    ...overrides
  });
}

function signalRegistry(definitions = [gradePremiumDefinition()]) {
  return registry.createSignalRegistry({
    registryId: 'phase-13-grade-premium-registry',
    registryVersion: '1.0.0',
    createdAt: '2026-07-28T14:00:00.000Z',
    definitions
  });
}

function nativeGradePremiumOutput(overrides = {}) {
  return {
    source: 'grade_premium_engine',
    version: '1.2',
    gradePremiumScore: 82,
    premiumJustification: 'justified',
    premiumRiskLevel: 'low',
    targetGrade: {
      gradingCompany: 'psa',
      grade: '10',
      condition: '',
      rawGradedState: 'graded'
    },
    premiumMetrics: {
      sameGradeMedian: 150,
      lowerGradeMedian: 90,
      higherGradeMedian: 230,
      rawMedian: 50,
      sameGradePremiumPercent: 0.667,
      rawToGradedPremiumPercent: 2,
      nextGradePremiumPercent: 0.533,
      gradeCompressionPercent: 0.429
    },
    soldSupport: {
      sameGradeCount: 6,
      lowerGradeCount: 3,
      higherGradeCount: 1,
      rawCount: 3,
      activeContextCount: 0
    },
    dimensions: {
      sameGradeSupport: { status: 'strong', score: 88, explanation: 'Exact grade sold support is strong.' },
      lowerGradeSpread: { status: 'supported', score: 78, explanation: 'Same-grade sold value shows a supported premium over lower-grade sales.' },
      rawToGradedPremium: { status: 'supported', score: 78, explanation: 'Raw-to-graded sold spread supports a slab premium.' },
      populationSupport: { status: 'scarcity_supported', score: 86, explanation: 'Population scarcity supports the grade premium alongside sold evidence.' },
      higherGradeRisk: { status: 'normal', score: 68, explanation: 'Higher-grade sold value leaves room for this grade premium.' },
      conditionClarity: { status: 'clear', score: 82, explanation: 'Slab grade provides condition clarity.' },
      slabLiquidity: { status: 'liquid', score: 84, explanation: 'Exact-grade sold comps, comparable quality, and valuation range support slab liquidity.' },
      premiumVolatility: { status: 'controlled', score: 78, explanation: 'Grade premium volatility appears controlled.' }
    },
    warnings: [],
    positives: ['sameGradeSupport: Exact grade sold support is strong.'],
    summary: 'Grade premium appears justified by exact-grade sold evidence and supporting market context.',
    ...overrides
  };
}

function migrate(overrides = {}) {
  const reg = overrides.registry || signalRegistry();
  return migration.migrateGradePremiumSignal({
    migrationId: overrides.migrationId || 'grade-premium-migration',
    createdAt: overrides.createdAt || '2026-07-28T14:01:00.000Z',
    nativeOutput: overrides.nativeOutput || nativeGradePremiumOutput(),
    registry: reg
  });
}

test('exports Grade Premium Signal Migration public API and constants', () => {
  assert.equal(migration.GRADE_PREMIUM_MIGRATION_SOURCE, 'grade_premium_signal_migration');
  assert.equal(migration.GRADE_PREMIUM_MIGRATION_SCHEMA_VERSION, '1.0.0');
  assert.equal(migration.GRADE_PREMIUM_SIGNAL_NAME, 'grade.premium.engine');
  assert.equal(migration.GRADE_PREMIUM_PRODUCER, 'gradePremiumEngine');
  assert.equal(typeof migration.migrateGradePremiumSignal, 'function');
  assert.equal(typeof migration.validateGradePremiumMigration, 'function');
  assert.equal(typeof migration.summarizeGradePremiumMigration, 'function');
  assert.equal(typeof migration.buildGradePremiumMigrationFingerprint, 'function');
});

test('successful migration wraps native Grade Premium output through the full alignment pipeline', () => {
  const result = migrate();
  const validation = migration.validateGradePremiumMigration(result);

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

  assert.equal(result.canonicalSignal.signalName, 'grade.premium.engine');
  assert.equal(result.canonicalSignal.producer.name, 'gradePremiumEngine');
  assert.equal(result.canonicalSignal.signalType, 'grading');
  assert.equal(result.canonicalSignal.authorityLevel, 'shadow_observation');
  assert.equal(result.alignment.signalDefinition.definitionFingerprint, result.registry.definitions[0].definitionFingerprint);
  assert.equal(signalContract.validateCanonicalSignal(result.canonicalSignal).valid, true);
  assert.equal(alignmentContract.validateSignalAlignment(result.alignment).valid, true);
});

test('missing registry definition remains explicit without inventing signal authority', () => {
  const result = migrate({
    registry: signalRegistry([])
  });
  const validation = migration.validateGradePremiumMigration(result);

  assert.equal(result.registryResolutionStatus, 'definition_missing');
  assert.equal(result.alignment.alignmentStatus, 'definition_missing');
  assert.equal(result.alignment.signalDefinition, 'unknown');
  assert.equal(result.alignmentRun.summary.registryLookupFailureCount, 1);
  assert.equal(validation.valid, true);
  assert.equal(validation.registryResolutionStatus, 'definition_missing');
  assert.deepEqual(validation.authorityViolations, []);
});

test('migration preserves native Grade Premium output exactly and never mutates input', () => {
  const native = nativeGradePremiumOutput();
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
    migrationId: 'deterministic-grade-premium-migration',
    createdAt: '2026-07-28T14:02:00.000Z',
    nativeOutput: nativeGradePremiumOutput(),
    registry: signalRegistry()
  };
  const first = migration.migrateGradePremiumSignal(input);
  const second = migration.migrateGradePremiumSignal(input);

  assert.deepEqual(first, second);
  assert.equal(first.migrationFingerprint, migration.buildGradePremiumMigrationFingerprint(first));
  assert.equal(first.alignmentBatch.batchFingerprint, batch.buildAlignmentBatchFingerprint(first.alignmentBatch));
  assert.equal(first.alignmentRun.runFingerprint, engine.buildSignalAlignmentRunFingerprint(first.alignmentRun));
  assert.equal(first.alignmentReport.reportFingerprint, report.buildSignalAlignmentReportFingerprint(first.alignmentReport));
});

test('explicit unknown values are preserved in wrapper artifacts', () => {
  const result = migrate({
    nativeOutput: nativeGradePremiumOutput({
      premiumRiskLevel: undefined,
      soldSupport: undefined,
      warnings: ['premium risk unknown']
    })
  });

  assert.equal(result.canonicalSignal.normalizedOutput.riskLevel, 'unknown');
  assert.equal(result.canonicalSignal.evidenceBasis.activeListingCount, 'unknown');
  assert.equal(result.canonicalSignal.uncertainty.level, 'unknown');
  assert.equal(result.validation.valid, true);
});

test('authority enforcement blocks unsafe registry definitions', () => {
  const result = migrate({
    registry: signalRegistry([gradePremiumDefinition({
      governanceFlags: { productionAuthority: true }
    })])
  });
  const validation = migration.validateGradePremiumMigration(result);

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
    suiteId: 'empty-boundary-suite',
    scenarioResults: [],
    validation: { valid: true, reasonCodes: [], authorityViolations: [], fingerprintViolations: [] }
  });

  assert.equal(result.alignmentRun.source, 'signal_alignment_engine');
  assert.equal(result.alignmentReport.source, 'signal_alignment_report');
  assert.equal(summary.valid, true);
  assert.equal(summary.productionImpact, 'none');
});

test('module does not import or execute the Grade Premium Engine or production runtime', () => {
  const loaded = new Set();
  const originalLoad = Module._load;
  Module._load = function trackingLoad(request, parent, isMain) {
    loaded.add(request);
    return originalLoad.apply(this, arguments);
  };

  delete require.cache[require.resolve('../validation/gradePremiumSignalMigration')];
  require('../validation/gradePremiumSignalMigration');
  Module._load = originalLoad;

  assert.equal([...loaded].some((request) => request.includes('engines/gradePremiumEngine')), false);
  assert.equal([...loaded].some((request) => request.includes('server')), false);
  assert.equal([...loaded].some((request) => request.includes('scoutScannerService')), false);
});
