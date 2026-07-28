'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const batchEngine = require('../validation/signalAlignmentBatch');
const adapter = require('../validation/signalProducerAdapter');
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
    expectedInputTypes: ['listing'],
    expectedOutputFields: ['diagnosticStatus'],
    confidenceSemantics: { kind: 'not_applicable' },
    uncertaintySemantics: { fieldLevel: true },
    evidenceRequirements: { nativeOutputRequired: true },
    allowedStatuses: ['partial'],
    downstreamConsumers: ['review'],
    governanceRequirements: { authorityBoundary: 'advisory_only' },
    compatibilityNotes: ['test definition'],
    createdAt: '2026-07-27T23:30:00.000Z'
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
    expectedInputTypes: ['evidence'],
    expectedOutputFields: ['readinessStatus'],
    confidenceSemantics: { kind: 'unknown' },
    uncertaintySemantics: { readinessLevel: true },
    evidenceRequirements: { activeListingsDoNotSatisfyTrueSoldMinimums: true },
    allowedStatuses: ['thin'],
    downstreamConsumers: ['review'],
    governanceRequirements: { authorityBoundary: 'advisory_only' },
    compatibilityNotes: ['test definition'],
    createdAt: '2026-07-27T23:30:00.000Z'
  });
}

function signalRegistry() {
  return registry.createSignalRegistry({
    registryId: 'phase-13-batch-registry',
    registryVersion: '1.0.0',
    createdAt: '2026-07-27T23:30:00.000Z',
    definitions: [identityDefinition(), evidenceDefinition()]
  });
}

function identityOutput(fingerprint = 'identity-fingerprint-1') {
  return {
    source: 'identity_parser_diagnostics',
    schemaVersion: '1.0.0',
    productionImpact: 'none',
    decisionImpact: 'none',
    diagnosticStatus: 'partial',
    ambiguityLevel: 'medium',
    blockingIssues: [],
    warnings: ['grade_missing'],
    fieldsMissing: ['grade'],
    recommendedReviewAction: 'collect_missing_identity_fields',
    stableFingerprint: fingerprint
  };
}

function evidenceOutput(fingerprint = 'evidence-fingerprint-1') {
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
    comparableQuality: { qualityLevel: 'limited', averageQualityScore: 60 },
    recommendedReviewAction: 'collect_more_true_sold_evidence',
    stableFingerprint: fingerprint
  };
}

function adaptedAlignments() {
  const reg = signalRegistry();
  return [
    adapter.adaptDiagnosticSignal({ nativeOutput: identityOutput(), registry: reg }).alignment,
    adapter.adaptDiagnosticSignal({ nativeOutput: evidenceOutput(), registry: reg }).alignment
  ];
}

test('exports Signal Alignment Batch public API and constants', () => {
  assert.equal(batchEngine.SIGNAL_ALIGNMENT_BATCH_SOURCE, 'signal_alignment_batch');
  assert.equal(batchEngine.SIGNAL_ALIGNMENT_BATCH_SCHEMA_VERSION, '1.0.0');
  assert.equal(typeof batchEngine.createAlignmentBatch, 'function');
  assert.equal(typeof batchEngine.validateAlignmentBatch, 'function');
  assert.equal(typeof batchEngine.addAlignmentToBatch, 'function');
  assert.equal(typeof batchEngine.removeAlignmentFromBatch, 'function');
  assert.equal(typeof batchEngine.summarizeAlignmentBatch, 'function');
  assert.equal(typeof batchEngine.filterAlignmentBatch, 'function');
  assert.equal(typeof batchEngine.sortAlignmentBatch, 'function');
  assert.equal(typeof batchEngine.buildAlignmentBatchFingerprint, 'function');
});

test('creates and validates an empty immutable batch with explicit unknown values', () => {
  const batch = batchEngine.createAlignmentBatch({}, {
    alignmentBatchId: 'empty-batch',
    createdAt: '2026-07-27T23:35:00.000Z'
  });
  const validation = batchEngine.validateAlignmentBatch(batch);

  assert.equal(batch.alignmentBatchId, 'empty-batch');
  assert.equal(batch.createdAt, '2026-07-27T23:35:00.000Z');
  assert.equal(batch.alignmentCount, 0);
  assert.equal(batch.summary.validCount, 0);
  assert.equal(batch.productionImpact, 'none');
  assert.equal(Object.isFrozen(batch), true);
  assert.equal(validation.valid, true);
});

test('creates a single-alignment batch without mutating the alignment', () => {
  const [alignment] = adaptedAlignments();
  const before = JSON.parse(JSON.stringify(alignment));
  const batch = batchEngine.createAlignmentBatch({
    alignmentBatchId: 'single-batch',
    createdAt: '2026-07-27T23:36:00.000Z',
    alignments: [alignment]
  });

  assert.deepEqual(alignment, before);
  assert.equal(batch.alignmentCount, 1);
  assert.equal(batch.alignments[0].alignmentFingerprint, alignment.alignmentFingerprint);
  assert.equal(batch.summary.producerSummary.identityParserDiagnostics, 1);
  assert.equal(batchEngine.validateAlignmentBatch(batch).valid, true);
});

test('multiple alignments sort deterministically and produce stable fingerprints', () => {
  const [identityAlignment, evidenceAlignment] = adaptedAlignments();
  const first = batchEngine.createAlignmentBatch({
    alignmentBatchId: 'multi-batch',
    createdAt: '2026-07-27T23:37:00.000Z',
    alignments: [identityAlignment, evidenceAlignment]
  });
  const second = batchEngine.createAlignmentBatch({
    alignmentBatchId: 'multi-batch',
    createdAt: '2026-07-27T23:37:00.000Z',
    alignments: [evidenceAlignment, identityAlignment]
  });

  assert.deepEqual(first, second);
  assert.deepEqual(first.alignments.map((alignment) => alignment.canonicalSignal.signalName), [
    'evidence.readiness.diagnostics',
    'identity.parser.diagnostics'
  ]);
  assert.equal(first.batchFingerprint, batchEngine.buildAlignmentBatchFingerprint(first));
});

test('add and remove operations return new immutable batches', () => {
  const [identityAlignment, evidenceAlignment] = adaptedAlignments();
  const original = batchEngine.createAlignmentBatch({ alignments: [identityAlignment] });
  const added = batchEngine.addAlignmentToBatch(original, evidenceAlignment);
  const removed = batchEngine.removeAlignmentFromBatch(added, identityAlignment.alignmentFingerprint);

  assert.notEqual(added, original);
  assert.equal(original.alignmentCount, 1);
  assert.equal(added.alignmentCount, 2);
  assert.equal(removed.alignmentCount, 1);
  assert.equal(removed.alignments[0].alignmentFingerprint, evidenceAlignment.alignmentFingerprint);
  assert.equal(batchEngine.validateAlignmentBatch(removed).valid, true);
});

test('filters and sorting preserve batch compatibility', () => {
  const batch = batchEngine.createAlignmentBatch({ alignments: adaptedAlignments() });
  const evidenceOnly = batchEngine.filterAlignmentBatch(batch, { signalName: 'evidence.readiness.diagnostics' });
  const identityOnly = batchEngine.filterAlignmentBatch(batch, { producer: 'identityParserDiagnostics' });
  const sortedByProducer = batchEngine.sortAlignmentBatch(batch, 'producer');

  assert.equal(evidenceOnly.alignmentCount, 1);
  assert.equal(evidenceOnly.alignments[0].producer, 'evidenceReadinessDiagnostics');
  assert.equal(identityOnly.alignmentCount, 1);
  assert.equal(identityOnly.alignments[0].canonicalSignal.signalName, 'identity.parser.diagnostics');
  assert.deepEqual(sortedByProducer.alignments.map((alignment) => alignment.producer), [
    'evidenceReadinessDiagnostics',
    'identityParserDiagnostics'
  ]);
});

test('summary reports statuses, producers, authority, and duplicate counts', () => {
  const alignments = adaptedAlignments();
  const summary = batchEngine.summarizeAlignmentBatch([...alignments, alignments[0]]);

  assert.equal(summary.alignmentCount, 3);
  assert.equal(summary.statusSummary.aligned, 3);
  assert.equal(summary.producerSummary.identityParserDiagnostics, 2);
  assert.equal(summary.authoritySummary.aligned, 3);
  assert.equal(summary.duplicateAlignmentCount, 1);
  assert.equal(summary.productionImpact, 'none');
});

test('validation detects duplicates, authority violations, stale fingerprints, and invalid count', () => {
  const [identityAlignment] = adaptedAlignments();
  const invalid = {
    ...batchEngine.createAlignmentBatch({ alignments: [identityAlignment, identityAlignment] }),
    alignmentCount: 99,
    productionImpact: 'changes',
    batchFingerprint: 'stale'
  };
  const validation = batchEngine.validateAlignmentBatch(invalid);

  assert.equal(validation.valid, false);
  assert.equal(validation.reasonCodes.includes('duplicate_alignment'), true);
  assert.equal(validation.reasonCodes.includes('alignment_count_mismatch'), true);
  assert.equal(validation.reasonCodes.includes('invalid_production_impact'), true);
  assert.equal(validation.reasonCodes.includes('batch_fingerprint_mismatch'), true);
  assert.equal(validation.duplicateAlignments.length, 1);
  assert.equal(validation.authorityViolations.includes('productionImpact'), true);
  assert.equal(validation.fingerprintViolations.includes('batchFingerprint'), true);
});

test('unknown values are preserved and individual alignments are not altered', () => {
  const unknownAlignment = {
    ...adaptedAlignments()[0],
    registryId: 'unknown',
    registryFingerprint: 'unknown'
  };
  const batch = batchEngine.createAlignmentBatch({ alignments: [unknownAlignment] });

  assert.equal(batch.alignments[0].registryId, 'unknown');
  assert.equal(batch.alignments[0].registryFingerprint, 'unknown');
  assert.notEqual(batch.alignments[0], unknownAlignment);
});

test('module does not execute producers or import runtime modules', () => {
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
    delete require.cache[require.resolve('../validation/signalAlignmentBatch')];
    const fresh = require('../validation/signalAlignmentBatch');
    const batch = fresh.createAlignmentBatch({ alignments: adaptedAlignments() });
    assert.equal(batch.alignmentCount, 2);
  } finally {
    Module._load = originalLoad;
    delete require.cache[require.resolve('../validation/signalAlignmentBatch')];
    require('../validation/signalAlignmentBatch');
  }

  assert.equal(loaded.some((request) => request.includes('../engines')), false);
});
