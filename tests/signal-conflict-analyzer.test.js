'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const analyzer = require('../validation/signalConflictAnalyzer');
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
    expectedOutputFields: ['diagnosticStatus', 'ambiguityLevel'],
    confidenceSemantics: { kind: 'not_applicable' },
    uncertaintySemantics: { fieldLevel: true },
    evidenceRequirements: { nativeOutputRequired: true },
    allowedStatuses: ['exact', 'partial', 'ambiguous', 'blocked'],
    downstreamConsumers: ['review'],
    governanceRequirements: { authorityBoundary: 'advisory_only' },
    compatibilityNotes: ['test definition'],
    createdAt: '2026-07-28T11:00:00.000Z'
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
    expectedOutputFields: ['readinessStatus', 'readinessLevel'],
    confidenceSemantics: { kind: 'diagnostic_cap_recommendation' },
    uncertaintySemantics: { readinessLevel: true },
    evidenceRequirements: { activeListingsDoNotSatisfyTrueSoldMinimums: true },
    allowedStatuses: ['ready', 'conditionally_ready', 'thin', 'insufficient', 'blocked', 'unavailable'],
    downstreamConsumers: ['review'],
    governanceRequirements: { authorityBoundary: 'advisory_only' },
    compatibilityNotes: ['test definition'],
    createdAt: '2026-07-28T11:00:00.000Z'
  });
}

function signalRegistry(definitions = [identityDefinition(), evidenceDefinition()]) {
  return registry.createSignalRegistry({
    registryId: 'phase-13-conflict-registry',
    registryVersion: '1.0.0',
    createdAt: '2026-07-28T11:00:00.000Z',
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
    warnings: [],
    fieldsConfirmed: ['subject'],
    fieldsMissing: ['grade'],
    fieldsConflicting: [],
    fieldsInferred: [],
    recommendedReviewAction: 'review_identity',
    stableFingerprint: 'identity-conflict-1',
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
    warnings: [],
    comparableQuality: { qualityLevel: 'limited', averageQualityScore: 55 },
    recommendedReviewAction: 'collect_more_evidence',
    stableFingerprint: 'evidence-conflict-1',
    ...overrides
  };
}

function adaptedAlignment(nativeOutput, reg = signalRegistry(), input = {}) {
  return adapter.adaptDiagnosticSignal({
    nativeOutput,
    registry: reg,
    ...input
  }).alignment;
}

function relationshipTypes(analysis) {
  return analysis.relationships.map((relationship) => relationship.relationshipType);
}

test('exports Signal Conflict Analyzer public API and relationship constants', () => {
  assert.equal(analyzer.SIGNAL_CONFLICT_ANALYZER_SOURCE, 'signal_conflict_analyzer');
  assert.equal(analyzer.SIGNAL_CONFLICT_ANALYSIS_SCHEMA_VERSION, '1.0.0');
  assert.deepEqual(analyzer.RELATIONSHIP_TYPES, [
    'agreement',
    'contradiction',
    'supporting',
    'independent',
    'duplicate',
    'unknown'
  ]);
  assert.equal(typeof analyzer.analyzeSignalConflicts, 'function');
  assert.equal(typeof analyzer.summarizeSignalConflicts, 'function');
  assert.equal(typeof analyzer.classifySignalRelationship, 'function');
  assert.equal(typeof analyzer.buildConflictAnalysisFingerprint, 'function');
  assert.equal(typeof analyzer.validateConflictAnalysis, 'function');
});

test('classifies agreement for same signal with matching normalized status and uncertainty', () => {
  const reg = signalRegistry();
  const left = adaptedAlignment(identityOutput({ stableFingerprint: 'identity-agree-1' }), reg);
  const right = adaptedAlignment(identityOutput({ stableFingerprint: 'identity-agree-2' }), reg);
  const analysis = analyzer.analyzeSignalConflicts({
    analysisId: 'agreement-analysis',
    createdAt: '2026-07-28T11:01:00.000Z',
    alignments: [right, left]
  });

  assert.equal(analyzer.classifySignalRelationship(left, right), 'agreement');
  assert.deepEqual(relationshipTypes(analysis), ['agreement']);
  assert.equal(analysis.validation.valid, true);
});

test('classifies contradiction for same signal with conflicting normalized status', () => {
  const reg = signalRegistry();
  const left = adaptedAlignment(identityOutput({ stableFingerprint: 'identity-contradiction-1', diagnosticStatus: 'partial' }), reg);
  const right = adaptedAlignment(identityOutput({ stableFingerprint: 'identity-contradiction-2', diagnosticStatus: 'exact' }), reg);
  const analysis = analyzer.analyzeSignalConflicts({
    analysisId: 'contradiction-analysis',
    createdAt: '2026-07-28T11:02:00.000Z',
    alignments: [left, right]
  });

  assert.equal(analyzer.classifySignalRelationship(left, right), 'contradiction');
  assert.deepEqual(relationshipTypes(analysis), ['contradiction']);
  assert.equal(analysis.summary.contradictionCount, 1);
});

test('classifies supporting relationships from explicit supporting signal references', () => {
  const reg = signalRegistry();
  const evidence = adaptedAlignment(evidenceOutput({ stableFingerprint: 'supporting-evidence-1' }), reg);
  const identity = adaptedAlignment(identityOutput({ stableFingerprint: 'supporting-identity-1' }), reg, {
    supportingSignals: [{ signalFingerprint: evidence.canonicalSignal.signalFingerprint }]
  });
  const analysis = analyzer.analyzeSignalConflicts({
    analysisId: 'supporting-analysis',
    createdAt: '2026-07-28T11:03:00.000Z',
    alignments: [identity, evidence]
  });

  assert.equal(analyzer.classifySignalRelationship(identity, evidence), 'supporting');
  assert.deepEqual(relationshipTypes(analysis), ['supporting']);
  assert.equal(analysis.summary.supportingRelationshipCount, 1);
});

test('classifies independent relationships for unrelated signal families', () => {
  const reg = signalRegistry();
  const identity = adaptedAlignment(identityOutput({ stableFingerprint: 'independent-identity-1' }), reg);
  const evidence = adaptedAlignment(evidenceOutput({ stableFingerprint: 'independent-evidence-1' }), reg);
  const analysis = analyzer.analyzeSignalConflicts({
    analysisId: 'independent-analysis',
    createdAt: '2026-07-28T11:04:00.000Z',
    alignments: [identity, evidence]
  });

  assert.equal(analyzer.classifySignalRelationship(identity, evidence), 'independent');
  assert.deepEqual(relationshipTypes(analysis), ['independent']);
});

test('classifies duplicate relationships without resolving or removing duplicates', () => {
  const alignment = adaptedAlignment(identityOutput({ stableFingerprint: 'duplicate-identity-1' }));
  const analysis = analyzer.analyzeSignalConflicts({
    analysisId: 'duplicate-analysis',
    createdAt: '2026-07-28T11:05:00.000Z',
    alignments: [alignment, alignment]
  });
  const validation = analyzer.validateConflictAnalysis(analysis);

  assert.deepEqual(relationshipTypes(analysis), ['duplicate']);
  assert.equal(analysis.alignmentCount, 2);
  assert.equal(analysis.summary.duplicateRelationshipCount, 1);
  assert.equal(validation.duplicateRelationships.length, 0);
});

test('classifies unknown relationships when definitions or metadata are missing', () => {
  const alignment = adaptedAlignment(identityOutput({ stableFingerprint: 'unknown-identity-1' }), null);
  const evidence = adaptedAlignment(evidenceOutput({ stableFingerprint: 'unknown-evidence-1' }), signalRegistry());
  const analysis = analyzer.analyzeSignalConflicts({
    analysisId: 'unknown-analysis',
    createdAt: '2026-07-28T11:06:00.000Z',
    alignments: [alignment, evidence]
  });

  assert.equal(alignment.alignmentStatus, 'definition_missing');
  assert.deepEqual(relationshipTypes(analysis), ['unknown']);
  assert.equal(analysis.summary.unknownRelationshipCount, 1);
  assert.equal(analysis.validation.unknownRelationships.length, 1);
});

test('multiple alignments produce deterministic ordering, summaries, and fingerprints', () => {
  const reg = signalRegistry();
  const alignments = [
    adaptedAlignment(evidenceOutput({ stableFingerprint: 'multi-evidence-1' }), reg),
    adaptedAlignment(identityOutput({ stableFingerprint: 'multi-identity-1' }), reg),
    adaptedAlignment(identityOutput({ stableFingerprint: 'multi-identity-2' }), reg)
  ];
  const first = analyzer.analyzeSignalConflicts({
    analysisId: 'multi-analysis',
    createdAt: '2026-07-28T11:07:00.000Z',
    alignments
  });
  const second = analyzer.analyzeSignalConflicts({
    analysisId: 'multi-analysis',
    createdAt: '2026-07-28T11:07:00.000Z',
    alignments: [...alignments].reverse()
  });

  assert.deepEqual(first, second);
  assert.equal(first.relationshipCount, 3);
  assert.equal(first.analysisFingerprint, analyzer.buildConflictAnalysisFingerprint(first));
});

test('analysis preserves immutable inputs and explicit unknown values', () => {
  const alignment = adaptedAlignment(identityOutput({ stableFingerprint: undefined }));
  const before = JSON.parse(JSON.stringify(alignment));
  const analysis = analyzer.analyzeSignalConflicts({
    analysisId: 'immutable-analysis',
    createdAt: '2026-07-28T11:08:00.000Z',
    alignments: [alignment]
  });

  assert.deepEqual(alignment, before);
  assert.equal(Object.isFrozen(analysis), true);
  assert.equal(analysis.relationshipCount, 0);
  assert.equal(analysis.alignments[0].canonicalSignal.rawOutput.stableFingerprint, undefined);
});

test('validation detects authority violations, invalid relationships, and stale fingerprints', () => {
  const alignment = adaptedAlignment(identityOutput({ stableFingerprint: 'invalid-analysis-identity' }));
  const analysis = analyzer.analyzeSignalConflicts({
    analysisId: 'invalid-analysis',
    createdAt: '2026-07-28T11:09:00.000Z',
    alignments: [alignment, alignment]
  });
  const invalid = {
    ...analysis,
    productionImpact: 'changes',
    relationships: analysis.relationships.map((relationship) => ({
      ...relationship,
      relationshipType: 'winner'
    })),
    analysisFingerprint: 'stale'
  };
  const validation = analyzer.validateConflictAnalysis(invalid);

  assert.equal(validation.valid, false);
  assert.equal(validation.reasonCodes.includes('invalid_production_impact'), true);
  assert.equal(validation.reasonCodes.includes('invalid_relationship_type'), true);
  assert.equal(validation.reasonCodes.includes('analysis_fingerprint_mismatch'), true);
  assert.equal(validation.authorityViolations.includes('productionImpact'), true);
});

test('module does not import runtime modules or execute engines', () => {
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
    delete require.cache[require.resolve('../validation/signalConflictAnalyzer')];
    const fresh = require('../validation/signalConflictAnalyzer');
    const analysis = fresh.analyzeSignalConflicts({ alignments: [] });
    assert.equal(analysis.alignmentCount, 0);
  } finally {
    Module._load = originalLoad;
    delete require.cache[require.resolve('../validation/signalConflictAnalyzer')];
    require('../validation/signalConflictAnalyzer');
  }

  assert.equal(loaded.some((request) => request.includes('../engines')), false);
});
