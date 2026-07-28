'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const engine = require('../validation/signalAlignmentEngine');
const registry = require('../validation/intelligenceSignalRegistry');

function identityDefinition() {
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
    expectedInputTypes: ['listing', 'parsedIdentity', 'canonicalIdentity'],
    expectedOutputFields: ['diagnosticStatus', 'ambiguityLevel'],
    confidenceSemantics: { kind: 'not_applicable' },
    uncertaintySemantics: { fieldLevel: true },
    evidenceRequirements: { nativeOutputRequired: true },
    allowedStatuses: ['exact', 'partial', 'ambiguous', 'blocked'],
    downstreamConsumers: ['realListingDecisionReviewContract'],
    governanceRequirements: { authorityBoundary: 'advisory_only' },
    compatibilityNotes: ['offline diagnostic wrapper only'],
    createdAt: '2026-07-28T10:00:00.000Z'
  });
}

function evidenceDefinition() {
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
    expectedInputTypes: ['evidenceSummary', 'comparableQuality', 'identityExactness'],
    expectedOutputFields: ['readinessStatus', 'readinessLevel'],
    confidenceSemantics: { kind: 'diagnostic_cap_recommendation' },
    uncertaintySemantics: { readinessLevel: true },
    evidenceRequirements: { activeListingsDoNotSatisfyTrueSoldMinimums: true },
    allowedStatuses: ['ready', 'conditionally_ready', 'thin', 'insufficient', 'blocked', 'unavailable'],
    downstreamConsumers: ['realListingDecisionReviewContract'],
    governanceRequirements: { authorityBoundary: 'advisory_only' },
    compatibilityNotes: ['offline diagnostic wrapper only'],
    createdAt: '2026-07-28T10:00:00.000Z'
  });
}

function signalRegistry(definitions = [identityDefinition(), evidenceDefinition()]) {
  return registry.createSignalRegistry({
    registryId: 'phase-13-alignment-engine-registry',
    registryVersion: '1.0.0',
    createdAt: '2026-07-28T10:00:00.000Z',
    definitions
  });
}

function identityOutput(overrides = {}) {
  return {
    source: 'identity_parser_diagnostics',
    schemaVersion: '1.0.0',
    productionImpact: 'none',
    decisionImpact: 'none',
    identityEligibility: {
      exactCompEligible: false,
      valuationEligible: false,
      manualReviewRequired: true,
      contextOnly: true
    },
    diagnosticStatus: 'partial',
    ambiguityLevel: 'medium',
    blockingIssues: [],
    warnings: ['grade_number_missing'],
    parserCanonicalComparison: { fields: [] },
    fieldsConfirmed: ['subject', 'year'],
    fieldsMissing: ['cardNumber'],
    fieldsConflicting: [],
    fieldsInferred: ['title_only_subject'],
    unsupportedIdentityFields: [],
    recommendedReviewAction: 'collect_missing_identity_fields',
    stableFingerprint: 'identity-native-fingerprint-engine-1',
    zeroPreserved: 0,
    falsePreserved: false,
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
      minimumTrueSoldRequired: 3,
      trueSoldEvidenceCount: 2,
      exactComparableCount: 2,
      freshEvidenceCount: 2,
      sourceConcentration: { ebay: 1 }
    },
    excludedEvidenceSummary: {
      activeListingCount: 4,
      fallbackEvidenceCount: 1,
      contextualComparableCount: 1,
      rejectedComparableCount: 2,
      staleEvidenceCount: 0,
      duplicateEvidenceCount: 1,
      transactionIneligibleEvidenceCount: 0
    },
    blockingReasons: [],
    warnings: ['below_minimum_true_sold_evidence'],
    evidenceUsed: [],
    evidenceExcluded: [],
    valuationReadiness: {
      diagnosticallyReady: false,
      shouldWithholdValuationDiagnostically: true
    },
    comparableQuality: {
      qualityLevel: 'limited',
      averageQualityScore: 58
    },
    identityExactness: 'exact',
    confidenceCapRecommendation: 60,
    recommendedReviewAction: 'collect_more_true_sold_evidence',
    stableFingerprint: 'evidence-native-fingerprint-engine-1',
    ...overrides
  };
}

test('exports Signal Alignment Engine public API and constants', () => {
  assert.equal(engine.SIGNAL_ALIGNMENT_ENGINE_SOURCE, 'signal_alignment_engine');
  assert.equal(engine.SIGNAL_ALIGNMENT_ENGINE_SCHEMA_VERSION, '1.0.0');
  assert.equal(typeof engine.runSignalAlignment, 'function');
  assert.equal(typeof engine.runSignalAlignmentBatch, 'function');
  assert.equal(typeof engine.validateSignalAlignmentRun, 'function');
  assert.equal(typeof engine.summarizeSignalAlignmentRun, 'function');
  assert.equal(typeof engine.buildSignalAlignmentRunFingerprint, 'function');
});

test('empty run produces immutable deterministic observation-only batch', () => {
  const run = engine.runSignalAlignmentBatch({
    alignmentRunId: 'empty-run',
    createdAt: '2026-07-28T10:01:00.000Z',
    registry: signalRegistry(),
    diagnostics: []
  });
  const validation = engine.validateSignalAlignmentRun(run);

  assert.equal(Object.isFrozen(run), true);
  assert.equal(run.adaptedSignalCount, 0);
  assert.equal(run.alignmentBatch.alignmentCount, 0);
  assert.equal(run.productionImpact, 'none');
  assert.equal(run.decisionImpact, 'none');
  assert.equal(run.executionAuthority, 'none');
  assert.equal(validation.valid, true);
});

test('single diagnostic is adapted, aligned, batched, and validated without mutating native output', () => {
  const native = identityOutput();
  const before = JSON.parse(JSON.stringify(native));
  const run = engine.runSignalAlignment({
    alignmentRunId: 'single-run',
    createdAt: '2026-07-28T10:02:00.000Z',
    nativeOutput: native,
    registry: signalRegistry()
  });

  assert.deepEqual(native, before);
  assert.equal(run.adaptedSignalCount, 1);
  assert.equal(run.alignedSignalCount, 1);
  assert.equal(run.blockedSignalCount, 0);
  assert.equal(run.adaptedSignals[0].canonicalSignal.rawOutput.zeroPreserved, 0);
  assert.equal(run.adaptedSignals[0].canonicalSignal.rawOutput.falsePreserved, false);
  assert.equal(run.alignmentBatch.alignments[0].alignmentFingerprint, run.adaptedSignals[0].alignment.alignmentFingerprint);
  assert.equal(engine.validateSignalAlignmentRun(run).valid, true);
});

test('multiple diagnostics produce deterministic ordering, summaries, and fingerprints', () => {
  const reg = signalRegistry();
  const first = engine.runSignalAlignmentBatch({
    alignmentRunId: 'multi-run',
    createdAt: '2026-07-28T10:03:00.000Z',
    registry: reg,
    diagnostics: [
      { nativeOutput: evidenceOutput(), registry: reg },
      { nativeOutput: identityOutput(), registry: reg }
    ]
  });
  const second = engine.runSignalAlignmentBatch({
    alignmentRunId: 'multi-run',
    createdAt: '2026-07-28T10:03:00.000Z',
    registry: reg,
    diagnostics: [
      { nativeOutput: identityOutput(), registry: reg },
      { nativeOutput: evidenceOutput(), registry: reg }
    ]
  });

  assert.deepEqual(first, second);
  assert.deepEqual(first.adaptedSignals.map((adapted) => adapted.signalName), [
    'evidence.readiness.diagnostics',
    'identity.parser.diagnostics'
  ]);
  assert.equal(first.summary.adaptedSignalCount, 2);
  assert.equal(first.summary.alignedSignalCount, 2);
  assert.equal(first.runFingerprint, engine.buildSignalAlignmentRunFingerprint(first));
});

test('registry lookup failures remain explicit without inventing definitions', () => {
  const reg = signalRegistry([identityDefinition()]);
  const run = engine.runSignalAlignmentBatch({
    alignmentRunId: 'missing-definition-run',
    createdAt: '2026-07-28T10:04:00.000Z',
    registry: reg,
    diagnostics: [
      { nativeOutput: evidenceOutput(), registry: reg }
    ]
  });
  const validation = engine.validateSignalAlignmentRun(run);

  assert.equal(run.adaptedSignalCount, 1);
  assert.equal(run.summary.registryLookupFailureCount, 1);
  assert.equal(run.summary.registryLookupFailures[0].registryLookupStatus, 'definition_missing');
  assert.equal(run.adaptedSignals[0].alignment.alignmentStatus, 'definition_missing');
  assert.equal(validation.valid, true);
  assert.equal(validation.registryLookupFailures.length, 1);
  assert.equal(validation.reasonCodes.includes('registry_lookup_failure'), true);
});

test('blocked alignment metadata and authority violations are reported without granting authority', () => {
  const reg = signalRegistry();
  const run = engine.runSignalAlignmentBatch({
    alignmentRunId: 'blocked-run',
    createdAt: '2026-07-28T10:05:00.000Z',
    registry: reg,
    diagnostics: [
      {
        nativeOutput: identityOutput({
          productionImpact: 'changes',
          governanceFlags: { productionAuthority: true }
        }),
        registry: reg
      }
    ]
  });
  const tampered = {
    ...run,
    adaptedSignals: run.adaptedSignals.map((adapted) => ({
      ...adapted,
      alignment: {
        ...adapted.alignment,
        alignmentStatus: 'blocked',
        authorityAlignment: {
          ...adapted.alignment.authorityAlignment,
          status: 'blocked',
          authorityViolations: ['canonicalSignal.governanceFlags.productionAuthority']
        }
      }
    })),
    alignmentBatch: {
      ...run.alignmentBatch,
      alignments: run.alignmentBatch.alignments.map((alignment) => ({
        ...alignment,
        alignmentStatus: 'blocked',
        authorityAlignment: {
          ...alignment.authorityAlignment,
          status: 'blocked',
          authorityViolations: ['canonicalSignal.governanceFlags.productionAuthority']
        }
      }))
    },
    blockedSignalCount: 1,
    productionImpact: 'changes',
    runFingerprint: 'stale'
  };
  const validation = engine.validateSignalAlignmentRun(tampered);

  assert.equal(run.productionImpact, 'none');
  assert.equal(engine.summarizeSignalAlignmentRun(tampered).blockedSignalCount, 1);
  assert.equal(validation.valid, false);
  assert.equal(validation.authorityViolations.length > 0, true);
});

test('validation catches stale run fingerprint and count drift', () => {
  const run = engine.runSignalAlignmentBatch({
    alignmentRunId: 'tamper-run',
    createdAt: '2026-07-28T10:06:00.000Z',
    registry: signalRegistry(),
    diagnostics: [{ nativeOutput: identityOutput() }]
  });
  const invalid = {
    ...run,
    adaptedSignalCount: 99,
    runFingerprint: 'stale'
  };
  const validation = engine.validateSignalAlignmentRun(invalid);

  assert.equal(validation.valid, false);
  assert.equal(validation.reasonCodes.includes('adapted_signal_count_mismatch'), true);
  assert.equal(validation.reasonCodes.includes('run_fingerprint_mismatch'), true);
});

test('summary can be rebuilt from adapted signals and preserves explicit unknown values', () => {
  const run = engine.runSignalAlignmentBatch({
    alignmentRunId: 'unknown-run',
    createdAt: '2026-07-28T10:07:00.000Z',
    diagnostics: [
      { nativeOutput: identityOutput({ stableFingerprint: undefined }) }
    ]
  });
  const summary = engine.summarizeSignalAlignmentRun(run);

  assert.equal(run.registryId, 'unknown');
  assert.equal(run.registryFingerprint, 'unknown');
  assert.equal(run.adaptedSignals[0].registryLookupStatus, 'registry_missing');
  assert.equal(summary.registryLookupFailureCount, 1);
  assert.equal(summary.productionImpact, 'none');
});

test('run artifacts are immutable and do not mutate source registry or diagnostics', () => {
  const reg = signalRegistry();
  const native = evidenceOutput();
  const regBefore = JSON.parse(JSON.stringify(reg));
  const nativeBefore = JSON.parse(JSON.stringify(native));
  const run = engine.runSignalAlignmentBatch({
    alignmentRunId: 'immutable-run',
    createdAt: '2026-07-28T10:08:00.000Z',
    registry: reg,
    diagnostics: [{ nativeOutput: native, registry: reg }]
  });

  assert.deepEqual(reg, regBefore);
  assert.deepEqual(native, nativeBefore);
  assert.equal(Object.isFrozen(run), true);
  assert.equal(Object.isFrozen(run.adaptedSignals[0]), true);
  assert.equal(Object.isFrozen(run.alignmentBatch), true);
});

test('module does not import runtime modules or execute diagnostic engines', () => {
  const originalLoad = Module._load;
  const loaded = [];
  Module._load = function patchedLoad(request, parent, isMain) {
    loaded.push(request);
    if (
      request.includes('server') ||
      request.includes('scoutScanner') ||
      request.includes('../engines/') ||
      request.startsWith('../engines') ||
      request.includes('identityParserDiagnostics') ||
      request.includes('evidenceReadinessDiagnostics')
    ) {
      throw new Error(`Unexpected runtime import: ${request}`);
    }
    return originalLoad.apply(this, arguments);
  };

  try {
    delete require.cache[require.resolve('../validation/signalAlignmentEngine')];
    const fresh = require('../validation/signalAlignmentEngine');
    const run = fresh.runSignalAlignmentBatch({
      diagnostics: [],
      registry: signalRegistry()
    });
    assert.equal(run.adaptedSignalCount, 0);
  } finally {
    Module._load = originalLoad;
    delete require.cache[require.resolve('../validation/signalAlignmentEngine')];
    require('../validation/signalAlignmentEngine');
  }

  assert.equal(loaded.some((request) => request.includes('../engines')), false);
});
