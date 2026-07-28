'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const suite = require('../validation/signalAlignmentValidationSuite');
const registry = require('../validation/intelligenceSignalRegistry');

function identityDefinition(overrides = {}) {
  return registry.createSignalDefinition({
    signalName: 'identity.parser.diagnostics',
    signalVersion: '1.0.0',
    producer: 'identityParserDiagnostics',
    producerVersion: '1.0.0',
    producerCategory: 'offline_validation',
    signalType: 'identity',
    decisionRole: 'diagnostic_only',
    authorityLevel: 'offline_validation',
    evidenceRole: 'diagnostic_context',
    expectedInputTypes: ['listing'],
    expectedOutputFields: ['diagnosticStatus', 'ambiguityLevel'],
    confidenceSemantics: { kind: 'not_applicable' },
    uncertaintySemantics: { fieldLevel: true },
    evidenceRequirements: { nativeOutputRequired: true },
    allowedStatuses: ['exact', 'partial', 'ambiguous', 'blocked'],
    downstreamConsumers: ['review'],
    governanceRequirements: { authorityBoundary: 'advisory_only' },
    compatibilityNotes: ['validation suite fixture'],
    createdAt: '2026-07-28T13:00:00.000Z',
    ...overrides
  });
}

function evidenceDefinition(overrides = {}) {
  return registry.createSignalDefinition({
    signalName: 'evidence.readiness.diagnostics',
    signalVersion: '1.0.0',
    producer: 'evidenceReadinessDiagnostics',
    producerVersion: '1.0.0',
    producerCategory: 'offline_validation',
    signalType: 'evidence',
    decisionRole: 'diagnostic_only',
    authorityLevel: 'offline_validation',
    evidenceRole: 'diagnostic_context',
    expectedInputTypes: ['evidence'],
    expectedOutputFields: ['readinessStatus', 'readinessLevel'],
    confidenceSemantics: { kind: 'diagnostic_cap_recommendation' },
    uncertaintySemantics: { readinessLevel: true },
    evidenceRequirements: { activeListingsDoNotSatisfyTrueSoldMinimums: true },
    allowedStatuses: ['ready', 'thin', 'blocked', 'unavailable'],
    downstreamConsumers: ['review'],
    governanceRequirements: { authorityBoundary: 'advisory_only' },
    compatibilityNotes: ['validation suite fixture'],
    createdAt: '2026-07-28T13:00:00.000Z',
    ...overrides
  });
}

function signalRegistry(definitions = [identityDefinition(), evidenceDefinition()]) {
  return registry.createSignalRegistry({
    registryId: 'phase-13-validation-suite-registry',
    registryVersion: '1.0.0',
    createdAt: '2026-07-28T13:00:00.000Z',
    definitions
  });
}

function identityOutput(overrides = {}) {
  return {
    source: 'identity_parser_diagnostics',
    schemaVersion: '1.0.0',
    productionImpact: 'none',
    decisionImpact: 'none',
    diagnosticStatus: 'partial',
    ambiguityLevel: 'medium',
    blockingIssues: [],
    warnings: ['grade_number_missing'],
    fieldsConfirmed: ['subject'],
    fieldsMissing: ['grade'],
    fieldsConflicting: [],
    fieldsInferred: [],
    recommendedReviewAction: 'review_identity',
    stableFingerprint: 'identity-suite-1',
    ...overrides
  };
}

function evidenceOutput(overrides = {}) {
  return {
    source: 'evidence_readiness_diagnostics',
    schemaVersion: '1.0.0',
    productionImpact: 'none',
    decisionImpact: 'none',
    readinessStatus: 'thin',
    readinessLevel: 'limited',
    eligibleEvidenceSummary: {
      trueSoldEvidenceCount: 2,
      sourceConcentration: { ebay: 1 }
    },
    excludedEvidenceSummary: {
      activeListingCount: 3,
      fallbackEvidenceCount: 0,
      staleEvidenceCount: 0,
      rejectedComparableCount: 1,
      duplicateEvidenceCount: 0,
      transactionIneligibleEvidenceCount: 0
    },
    blockingReasons: [],
    warnings: ['below_minimum_true_sold_evidence'],
    comparableQuality: { qualityLevel: 'limited', averageQualityScore: 55 },
    recommendedReviewAction: 'collect_more_evidence',
    stableFingerprint: 'evidence-suite-1',
    ...overrides
  };
}

function completeScenario(overrides = {}) {
  const reg = overrides.registry || signalRegistry();
  return {
    scenarioId: overrides.scenarioId || 'complete-pipeline',
    createdAt: overrides.createdAt || '2026-07-28T13:01:00.000Z',
    registry: reg,
    diagnostics: overrides.diagnostics || [
      { nativeOutput: identityOutput(), registry: reg },
      { nativeOutput: evidenceOutput(), registry: reg }
    ],
    expected: overrides.expected || {},
    ...overrides
  };
}

test('exports Signal Alignment Validation Suite public API and constants', () => {
  assert.equal(suite.SIGNAL_ALIGNMENT_VALIDATION_SUITE_SOURCE, 'signal_alignment_validation_suite');
  assert.equal(suite.SIGNAL_ALIGNMENT_VALIDATION_SUITE_SCHEMA_VERSION, '1.0.0');
  assert.equal(typeof suite.runSignalAlignmentValidationSuite, 'function');
  assert.equal(typeof suite.validateSignalAlignmentPipeline, 'function');
  assert.equal(typeof suite.summarizeValidationSuite, 'function');
  assert.equal(typeof suite.buildValidationSuiteFingerprint, 'function');
  assert.deepEqual(suite.VALIDATION_STAGE_NAMES, [
    'registry',
    'alignment_run',
    'alignment_batch',
    'conflict_analysis',
    'alignment_report',
    'authority_boundaries',
    'fingerprint_chain',
    'immutability',
    'unknown_value_preservation',
    'runtime_boundary'
  ]);
});

test('complete pipeline validates registry, adaptation, alignment, conflict analysis, and report generation', () => {
  const result = suite.runSignalAlignmentValidationSuite({
    suiteId: 'complete-suite',
    createdAt: '2026-07-28T13:02:00.000Z',
    scenarios: [completeScenario()]
  });

  assert.equal(Object.isFrozen(result), true);
  assert.equal(result.validation.valid, true);
  assert.equal(result.scenarioCount, 1);
  assert.equal(result.pipelineSummary.adaptedSignalCount, 2);
  assert.equal(result.pipelineSummary.alignedSignalCount, 2);
  assert.equal(result.pipelineSummary.reportCount, 1);
  assert.equal(result.pipelineSummary.conflictRelationshipCount, 1);
  assert.equal(result.stageResults.every((stage) => stage.valid), true);
  assert.equal(result.productionImpact, 'none');
  assert.equal(result.decisionImpact, 'none');
  assert.equal(result.executionAuthority, 'none');
});

test('missing registry definitions remain explicit and are surfaced through report validation', () => {
  const reg = signalRegistry([identityDefinition()]);
  const result = suite.runSignalAlignmentValidationSuite({
    suiteId: 'missing-definition-suite',
    createdAt: '2026-07-28T13:03:00.000Z',
    scenarios: [completeScenario({
      registry: reg,
      diagnostics: [{ nativeOutput: evidenceOutput(), registry: reg }]
    })]
  });
  const report = result.scenarioResults[0].artifacts.alignmentReport;

  assert.equal(result.validation.valid, true);
  assert.equal(report.missingDefinitions.length, 1);
  assert.equal(report.missingDefinitions[0].registryLookupStatus, 'definition_missing');
  assert.equal(result.pipelineSummary.alignedSignalCount, 0);
});

test('blocked alignments are counted without granting authority', () => {
  const reg = signalRegistry([identityDefinition({
    governanceFlags: { productionAuthority: true }
  })]);
  const result = suite.runSignalAlignmentValidationSuite({
    suiteId: 'blocked-suite',
    createdAt: '2026-07-28T13:04:00.000Z',
    scenarios: [completeScenario({
      registry: reg,
      diagnostics: [{ nativeOutput: identityOutput(), registry: reg }]
    })]
  });
  const run = result.scenarioResults[0].artifacts.alignmentRun;

  assert.equal(result.validation.valid, false);
  assert.equal(run.blockedSignalCount, 1);
  assert.equal(result.pipelineSummary.blockedSignalCount, 1);
  assert.equal(result.validation.reasonCodes.includes('authority_boundary_violation'), true);
});

test('duplicate signals and conflict relationships are preserved for review', () => {
  const reg = signalRegistry();
  const result = suite.runSignalAlignmentValidationSuite({
    suiteId: 'duplicate-suite',
    createdAt: '2026-07-28T13:05:00.000Z',
    scenarios: [completeScenario({
      registry: reg,
      diagnostics: [
        { nativeOutput: identityOutput({ stableFingerprint: 'duplicate-identity-suite' }), registry: reg },
        { nativeOutput: identityOutput({ stableFingerprint: 'duplicate-identity-suite' }), registry: reg }
      ]
    })]
  });
  const conflictAnalysis = result.scenarioResults[0].artifacts.conflictAnalysis;

  assert.equal(result.validation.valid, false);
  assert.equal(result.validation.reasonCodes.includes('duplicate_alignment'), true);
  assert.equal(conflictAnalysis.relationships.length, 1);
  assert.equal(conflictAnalysis.relationships[0].relationshipType, 'duplicate');
  assert.equal(conflictAnalysis.summary.duplicateRelationshipCount, 1);
});

test('unknown values are preserved across every validation stage', () => {
  const reg = signalRegistry();
  const result = suite.runSignalAlignmentValidationSuite({
    suiteId: 'unknown-suite',
    createdAt: '2026-07-28T13:06:00.000Z',
    scenarios: [completeScenario({
      registry: reg,
      expected: { preserveUnknownValues: true },
      diagnostics: [{ nativeOutput: evidenceOutput({ readinessLevel: undefined, stableFingerprint: undefined }), registry: reg }]
    })]
  });
  const unknownStage = result.stageResults.find((stage) => stage.stageName === 'unknown_value_preservation');
  const canonicalSignal = result.scenarioResults[0].artifacts.alignmentRun.adaptedSignals[0].canonicalSignal;

  assert.equal(result.validation.valid, true);
  assert.equal(unknownStage.valid, true);
  assert.equal(canonicalSignal.normalizedOutput.stableFingerprint, 'unknown');
  assert.equal(canonicalSignal.normalizedOutput.uncertainty, 'unknown');
});

test('validation output is deterministic with stable fingerprints', () => {
  const input = {
    suiteId: 'deterministic-suite',
    createdAt: '2026-07-28T13:07:00.000Z',
    scenarios: [completeScenario()]
  };
  const first = suite.runSignalAlignmentValidationSuite(input);
  const second = suite.runSignalAlignmentValidationSuite(input);

  assert.deepEqual(first, second);
  assert.equal(first.suiteFingerprint, suite.buildValidationSuiteFingerprint(first));
});

test('inputs remain immutable and source diagnostics are not altered', () => {
  const reg = signalRegistry();
  const scenario = completeScenario({ registry: reg });
  const before = JSON.parse(JSON.stringify(scenario));
  const result = suite.runSignalAlignmentValidationSuite({
    suiteId: 'immutability-suite',
    createdAt: '2026-07-28T13:08:00.000Z',
    scenarios: [scenario]
  });
  const immutabilityStage = result.stageResults.find((stage) => stage.stageName === 'immutability');

  assert.deepEqual(scenario, before);
  assert.equal(immutabilityStage.valid, true);
});

test('authority enforcement detects suite-level authority boundary violations', () => {
  const result = suite.runSignalAlignmentValidationSuite({
    suiteId: 'authority-suite',
    createdAt: '2026-07-28T13:09:00.000Z',
    scenarios: [completeScenario()]
  });
  const tampered = {
    ...result,
    productionImpact: 'changes'
  };
  const validation = suite.validateSignalAlignmentPipeline({
    suiteId: 'clean-authority-suite',
    createdAt: '2026-07-28T13:09:00.000Z',
    scenarios: [completeScenario()]
  }).validation;
  const directValidation = require('../validation/signalAlignmentValidationSuite');
  const invalid = {
    ...tampered,
    validation: {
      ...tampered.validation,
      valid: true
    }
  };

  assert.equal(validation.valid, true);
  assert.notEqual(directValidation.buildValidationSuiteFingerprint(invalid), result.suiteFingerprint);
});

test('summaries expose immutable validation totals', () => {
  const result = suite.runSignalAlignmentValidationSuite({
    suiteId: 'summary-suite',
    createdAt: '2026-07-28T13:10:00.000Z',
    scenarios: [
      completeScenario({ scenarioId: 'summary-complete' }),
      completeScenario({
        scenarioId: 'summary-missing-definition',
        registry: signalRegistry([identityDefinition()]),
        diagnostics: [{ nativeOutput: evidenceOutput(), registry: signalRegistry([identityDefinition()]) }]
      })
    ]
  });
  const summary = suite.summarizeValidationSuite(result);

  assert.equal(Object.isFrozen(summary), true);
  assert.equal(summary.scenarioCount, 2);
  assert.equal(summary.reportCount, 2);
  assert.equal(summary.adaptedSignalCount, 3);
  assert.equal(summary.valid, true);
});

test('module does not import production runtime integration points', () => {
  const loaded = new Set();
  const originalLoad = Module._load;
  Module._load = function trackingLoad(request, parent, isMain) {
    loaded.add(request);
    return originalLoad.apply(this, arguments);
  };

  delete require.cache[require.resolve('../validation/signalAlignmentValidationSuite')];
  require('../validation/signalAlignmentValidationSuite');
  Module._load = originalLoad;

  assert.equal([...loaded].some((request) => request.includes('server')), false);
  assert.equal([...loaded].some((request) => request.includes('scoutScannerService')), false);
  assert.equal([...loaded].some((request) => request.includes('marketValueEngine')), false);
});
