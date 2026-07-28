'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const reportModule = require('../validation/signalAlignmentReport');
const alignmentEngine = require('../validation/signalAlignmentEngine');
const conflictAnalyzer = require('../validation/signalConflictAnalyzer');
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
    compatibilityNotes: ['test definition'],
    createdAt: '2026-07-28T12:00:00.000Z',
    ...overrides
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
    allowedStatuses: ['ready', 'thin', 'blocked'],
    downstreamConsumers: ['review'],
    governanceRequirements: { authorityBoundary: 'advisory_only' },
    compatibilityNotes: ['test definition'],
    createdAt: '2026-07-28T12:00:00.000Z'
  });
}

function signalRegistry(definitions = [identityDefinition(), evidenceDefinition()]) {
  return registry.createSignalRegistry({
    registryId: 'phase-13-report-registry',
    registryVersion: '1.0.0',
    createdAt: '2026-07-28T12:00:00.000Z',
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
    stableFingerprint: 'identity-report-1',
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
    stableFingerprint: 'evidence-report-1',
    ...overrides
  };
}

function alignmentRun(overrides = {}) {
  const reg = overrides.registry || signalRegistry();
  return alignmentEngine.runSignalAlignmentBatch({
    alignmentRunId: overrides.alignmentRunId || 'report-run',
    createdAt: overrides.createdAt || '2026-07-28T12:01:00.000Z',
    registry: reg,
    diagnostics: overrides.diagnostics || [
      { nativeOutput: identityOutput(), registry: reg },
      { nativeOutput: evidenceOutput(), registry: reg }
    ]
  });
}

test('exports Signal Alignment Report public API and constants', () => {
  assert.equal(reportModule.SIGNAL_ALIGNMENT_REPORT_SOURCE, 'signal_alignment_report');
  assert.equal(reportModule.SIGNAL_ALIGNMENT_REPORT_SCHEMA_VERSION, '1.0.0');
  assert.deepEqual(reportModule.REVIEW_STATUSES, [
    'unreviewed',
    'review_pending',
    'reviewed',
    'needs_follow_up',
    'invalid'
  ]);
  assert.equal(typeof reportModule.createSignalAlignmentReport, 'function');
  assert.equal(typeof reportModule.validateSignalAlignmentReport, 'function');
  assert.equal(typeof reportModule.summarizeSignalAlignmentReport, 'function');
  assert.equal(typeof reportModule.filterSignalAlignmentReport, 'function');
  assert.equal(typeof reportModule.sortSignalAlignmentReport, 'function');
  assert.equal(typeof reportModule.exportSignalAlignmentReport, 'function');
  assert.equal(typeof reportModule.importSignalAlignmentReport, 'function');
  assert.equal(typeof reportModule.buildSignalAlignmentReportFingerprint, 'function');
});

test('creates a minimum immutable report from an empty alignment run', () => {
  const run = alignmentEngine.runSignalAlignmentBatch({
    alignmentRunId: 'empty-report-run',
    createdAt: '2026-07-28T12:02:00.000Z',
    registry: signalRegistry(),
    diagnostics: []
  });
  const report = reportModule.createSignalAlignmentReport({
    reportId: 'minimum-report',
    createdAt: '2026-07-28T12:03:00.000Z',
    alignmentRun: run
  });

  assert.equal(Object.isFrozen(report), true);
  assert.equal(report.alignmentRunId, 'empty-report-run');
  assert.equal(report.alignmentRunFingerprint, run.runFingerprint);
  assert.equal(report.alignments.length, 0);
  assert.equal(report.relationships.length, 0);
  assert.equal(report.reviewStatus, 'unreviewed');
  assert.equal(report.productionImpact, 'none');
  assert.equal(reportModule.validateSignalAlignmentReport(report).valid, true);
});

test('complete report includes alignment, validation, conflict, and source artifact summaries', () => {
  const run = alignmentRun();
  const conflicts = conflictAnalyzer.analyzeSignalConflicts({
    analysisId: 'report-conflicts',
    createdAt: '2026-07-28T12:04:00.000Z',
    alignmentRun: run
  });
  const report = reportModule.createSignalAlignmentReport({
    reportId: 'complete-report',
    createdAt: '2026-07-28T12:05:00.000Z',
    alignmentRun: run,
    conflictAnalysis: conflicts,
    reviewStatus: 'review_pending',
    reviewerNotes: [{ reviewer: 'Dalton', note: 'review identity/evidence disagreement only' }]
  });

  assert.equal(report.alignments.length, 2);
  assert.equal(report.relationships.length, 1);
  assert.equal(report.alignmentSummary.adaptedSignalCount, 2);
  assert.equal(report.conflictSummary.relationshipCount, 1);
  assert.equal(report.validationSummary.valid, true);
  assert.equal(report.sourceArtifacts.alignmentRun.runFingerprint, run.runFingerprint);
  assert.equal(report.sourceArtifacts.conflictAnalysis.analysisFingerprint, conflicts.analysisFingerprint);
  assert.equal(report.reviewerNotes[0].reviewer, 'Dalton');
});

test('missing definitions and version mismatches remain explicit', () => {
  const missingRun = alignmentRun({
    alignmentRunId: 'missing-definition-report-run',
    registry: signalRegistry([identityDefinition()]),
    diagnostics: [{ nativeOutput: evidenceOutput(), registry: signalRegistry([identityDefinition()]) }]
  });
  const mismatchRun = alignmentRun({
    alignmentRunId: 'version-mismatch-report-run',
    registry: signalRegistry([identityDefinition({ signalVersion: '2.0.0' })]),
    diagnostics: [{ nativeOutput: identityOutput(), registry: signalRegistry([identityDefinition({ signalVersion: '2.0.0' })]) }]
  });
  const missingReport = reportModule.createSignalAlignmentReport({ alignmentRun: missingRun });
  const mismatchReport = reportModule.createSignalAlignmentReport({ alignmentRun: mismatchRun });

  assert.equal(missingReport.missingDefinitions.length, 1);
  assert.equal(missingReport.missingDefinitions[0].registryLookupStatus, 'definition_missing');
  assert.equal(mismatchReport.versionMismatches.length, 1);
  assert.equal(mismatchReport.versionMismatches[0].registryLookupStatus, 'version_mismatch');
});

test('blocked alignments and unknown relationships are presented without resolution', () => {
  const run = alignmentRun({
    diagnostics: [{ nativeOutput: identityOutput(), registry: null }]
  });
  const alignment = {
    ...run.alignmentBatch.alignments[0],
    alignmentStatus: 'blocked',
    authorityAlignment: {
      ...run.alignmentBatch.alignments[0].authorityAlignment,
      status: 'blocked',
      authorityViolations: ['canonicalSignal.governanceFlags.productionAuthority']
    }
  };
  const report = reportModule.createSignalAlignmentReport({
    reportId: 'blocked-report',
    createdAt: '2026-07-28T12:06:00.000Z',
    alignments: [alignment, run.alignmentBatch.alignments[0]]
  });

  assert.equal(report.blockedAlignments.length, 1);
  assert.equal(report.unknownRelationships.length, 1);
  assert.equal(report.unknownRelationships[0].resolution, 'not_attempted');
  assert.equal(report.productionImpact, 'none');
});

test('reports preserve source artifacts and do not mutate inputs', () => {
  const run = alignmentRun();
  const before = JSON.parse(JSON.stringify(run));
  const report = reportModule.createSignalAlignmentReport({
    reportId: 'immutable-report',
    createdAt: '2026-07-28T12:07:00.000Z',
    alignmentRun: run
  });

  assert.deepEqual(run, before);
  assert.equal(Object.isFrozen(report), true);
  assert.equal(Object.isFrozen(report.sourceArtifacts.alignmentRun), true);
});

test('filtering and sorting return new immutable reports without mutating the original', () => {
  const run = alignmentRun();
  const report = reportModule.createSignalAlignmentReport({
    reportId: 'filter-report',
    createdAt: '2026-07-28T12:08:00.000Z',
    alignmentRun: run
  });
  const filtered = reportModule.filterSignalAlignmentReport(report, { signalName: 'identity.parser.diagnostics' });
  const sorted = reportModule.sortSignalAlignmentReport(report, 'producer');

  assert.notEqual(filtered, report);
  assert.equal(report.alignments.length, 2);
  assert.equal(filtered.alignments.length, 1);
  assert.equal(filtered.relationships.length, 0);
  assert.equal(sorted.alignments.length, 2);
  assert.equal(Object.isFrozen(filtered), true);
});

test('summaries, review statuses, and deterministic fingerprints remain stable', () => {
  const run = alignmentRun();
  const first = reportModule.createSignalAlignmentReport({
    reportId: 'fingerprint-report',
    createdAt: '2026-07-28T12:09:00.000Z',
    alignmentRun: run,
    reviewStatus: 'reviewed',
    reviewerNotes: ['reviewed as evidence only']
  });
  const second = reportModule.createSignalAlignmentReport({
    reportId: 'fingerprint-report',
    createdAt: '2026-07-28T12:09:00.000Z',
    alignmentRun: run,
    reviewStatus: 'reviewed',
    reviewerNotes: ['reviewed as evidence only']
  });
  const summary = reportModule.summarizeSignalAlignmentReport(first);

  assert.deepEqual(first, second);
  assert.equal(first.reportFingerprint, reportModule.buildSignalAlignmentReportFingerprint(first));
  assert.equal(summary.reviewStatus, 'reviewed');
  assert.equal(summary.alignmentCount, 2);
});

test('export and import preserve JSON shape and validation compatibility', () => {
  const report = reportModule.createSignalAlignmentReport({
    reportId: 'export-report',
    createdAt: '2026-07-28T12:10:00.000Z',
    alignmentRun: alignmentRun()
  });
  const exported = reportModule.exportSignalAlignmentReport(report);
  const imported = reportModule.importSignalAlignmentReport(exported);

  assert.deepEqual(imported, report);
  assert.equal(Object.isFrozen(imported), true);
  assert.equal(reportModule.validateSignalAlignmentReport(imported).valid, true);
});

test('validation detects authority violations, review status errors, source reference drift, and stale fingerprints', () => {
  const run = alignmentRun();
  const report = reportModule.createSignalAlignmentReport({
    reportId: 'invalid-report',
    createdAt: '2026-07-28T12:11:00.000Z',
    alignmentRun: run
  });
  const invalid = {
    ...report,
    alignmentRunFingerprint: 'wrong-run-fingerprint',
    reviewStatus: 'approved_for_production',
    productionImpact: 'changes',
    reportFingerprint: 'stale'
  };
  const validation = reportModule.validateSignalAlignmentReport(invalid);

  assert.equal(validation.valid, false);
  assert.equal(validation.reasonCodes.includes('invalid_review_status'), true);
  assert.equal(validation.reasonCodes.includes('invalid_production_impact'), true);
  assert.equal(validation.reasonCodes.includes('alignment_run_fingerprint_mismatch'), true);
  assert.equal(validation.reasonCodes.includes('report_fingerprint_mismatch'), true);
  assert.equal(validation.authorityViolations.includes('productionImpact'), true);
  assert.equal(validation.reviewStatusViolations.includes('reviewStatus'), true);
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
    delete require.cache[require.resolve('../validation/signalAlignmentReport')];
    const fresh = require('../validation/signalAlignmentReport');
    const report = fresh.createSignalAlignmentReport({ alignments: [] });
    assert.equal(report.alignments.length, 0);
  } finally {
    Module._load = originalLoad;
    delete require.cache[require.resolve('../validation/signalAlignmentReport')];
    require('../validation/signalAlignmentReport');
  }

  assert.equal(loaded.some((request) => request.includes('../engines')), false);
});
