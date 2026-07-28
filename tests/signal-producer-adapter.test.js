'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const adapter = require('../validation/signalProducerAdapter');
const registry = require('../validation/intelligenceSignalRegistry');
const signalContract = require('../validation/canonicalIntelligenceSignalContract');
const alignmentContract = require('../validation/signalAlignmentContract');

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
    createdAt: '2026-07-27T23:00:00.000Z'
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
    createdAt: '2026-07-27T23:00:00.000Z'
  });
}

function signalRegistry(definitions = [identityDefinition(), evidenceDefinition()]) {
  return registry.createSignalRegistry({
    registryId: 'phase-13-diagnostic-signals',
    registryVersion: '1.0.0',
    createdAt: '2026-07-27T23:00:00.000Z',
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
    parserCanonicalComparison: {
      fields: []
    },
    fieldsConfirmed: ['subject', 'year'],
    fieldsMissing: ['cardNumber'],
    fieldsConflicting: [],
    fieldsInferred: ['title_only_subject'],
    unsupportedIdentityFields: [],
    recommendedReviewAction: 'collect_missing_identity_fields',
    stableFingerprint: 'identity-native-fingerprint-1',
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
    stableFingerprint: 'evidence-native-fingerprint-1',
    ...overrides
  };
}

test('exports Signal Producer Adapter public API and constants', () => {
  assert.equal(adapter.SIGNAL_PRODUCER_ADAPTER_SOURCE, 'signal_producer_adapter');
  assert.equal(adapter.SIGNAL_PRODUCER_ADAPTER_SCHEMA_VERSION, '1.0.0');
  assert.equal(typeof adapter.adaptDiagnosticSignal, 'function');
  assert.equal(typeof adapter.adaptSignalBatch, 'function');
  assert.equal(typeof adapter.validateAdaptedSignal, 'function');
  assert.equal(typeof adapter.summarizeAdaptedSignals, 'function');
  assert.equal(typeof adapter.buildAdaptationFingerprint, 'function');
});

test('adapts identityParserDiagnostics output without mutating native output', () => {
  const native = identityOutput();
  const before = JSON.parse(JSON.stringify(native));
  const adapted = adapter.adaptDiagnosticSignal({
    nativeOutput: native,
    registry: signalRegistry(),
    createdAt: '2026-07-27T23:01:00.000Z'
  });

  assert.deepEqual(native, before);
  assert.equal(Object.isFrozen(adapted), true);
  assert.equal(adapted.producer, 'identityParserDiagnostics');
  assert.equal(adapted.registryLookupStatus, 'matched');
  assert.equal(adapted.validation.valid, true);
  assert.equal(adapted.canonicalSignal.signalName, 'identity.parser.diagnostics');
  assert.equal(adapted.canonicalSignal.rawOutput.zeroPreserved, 0);
  assert.equal(adapted.canonicalSignal.rawOutput.falsePreserved, false);
  assert.equal(adapted.canonicalSignal.sourceFingerprint, 'identity-native-fingerprint-1');
  assert.equal(adapted.alignment.alignmentStatus, 'aligned');
  assert.equal(adapted.alignment.productionImpact, 'none');
  assert.equal(signalContract.validateCanonicalSignal(adapted.canonicalSignal).valid, true);
  assert.equal(alignmentContract.validateSignalAlignment(adapted.alignment).valid, true);
});

test('adapts evidenceReadinessDiagnostics output with evidence summaries preserved', () => {
  const adapted = adapter.adaptDiagnosticSignal({
    nativeOutput: evidenceOutput(),
    registry: signalRegistry(),
    createdAt: '2026-07-27T23:02:00.000Z'
  });

  assert.equal(adapted.producer, 'evidenceReadinessDiagnostics');
  assert.equal(adapted.signalName, 'evidence.readiness.diagnostics');
  assert.equal(adapted.registryLookupStatus, 'matched');
  assert.equal(adapted.validation.valid, true);
  assert.equal(adapted.canonicalSignal.evidenceBasis.trueSoldCount, 2);
  assert.equal(adapted.canonicalSignal.evidenceBasis.activeListingCount, 4);
  assert.equal(adapted.canonicalSignal.evidenceBasis.fallbackUsed, true);
  assert.equal(adapted.canonicalSignal.evidenceQuality.score, 58);
  assert.equal(adapted.canonicalSignal.rawOutput.readinessStatus, 'thin');
  assert.equal(adapted.alignment.evidenceAlignment.evidenceRole, 'diagnostic_context');
});

test('batch adaptation preserves deterministic ordering and fingerprints', () => {
  const reg = signalRegistry();
  const first = adapter.adaptSignalBatch([
    { nativeOutput: evidenceOutput(), registry: reg },
    { nativeOutput: identityOutput(), registry: reg }
  ], {
    adaptationBatchId: 'batch-1',
    createdAt: '2026-07-27T23:03:00.000Z',
    registry: reg
  });
  const second = adapter.adaptSignalBatch([
    { nativeOutput: identityOutput(), registry: reg },
    { nativeOutput: evidenceOutput(), registry: reg }
  ], {
    adaptationBatchId: 'batch-1',
    createdAt: '2026-07-27T23:03:00.000Z',
    registry: reg
  });

  assert.deepEqual(first, second);
  assert.deepEqual(first.adaptedSignals.map((item) => item.signalName), [
    'evidence.readiness.diagnostics',
    'identity.parser.diagnostics'
  ]);
  assert.equal(first.summary.signalCount, 2);
  assert.equal(first.summary.validCount, 2);
  assert.equal(first.adaptationFingerprint, adapter.buildAdaptationFingerprint(first));
});

test('registry lookup reports missing definitions without inventing them', () => {
  const adapted = adapter.adaptDiagnosticSignal({
    nativeOutput: evidenceOutput(),
    registry: signalRegistry([identityDefinition()])
  });
  const validation = adapter.validateAdaptedSignal(adapted);

  assert.equal(adapted.registryLookupStatus, 'definition_missing');
  assert.equal(adapted.signalDefinition, 'unknown');
  assert.equal(adapted.alignment.alignmentStatus, 'definition_missing');
  assert.equal(validation.valid, true);
  assert.equal(validation.reasonCodes.includes('definition_missing'), true);
});

test('unknown values remain explicit and unsupported producers are rejected safely', () => {
  const adapted = adapter.adaptDiagnosticSignal({
    producer: 'unknownDiagnostics',
    nativeOutput: {
      source: 'unknown_diagnostics',
      stableFingerprint: 'unknown-fingerprint'
    },
    registry: signalRegistry()
  });

  assert.equal(adapted.registryLookupStatus, 'unsupported_producer');
  assert.equal(adapted.canonicalSignal, null);
  assert.equal(adapted.alignment, null);
  assert.equal(adapted.validation.valid, false);
  assert.equal(adapted.validation.reasonCodes.includes('unsupported_diagnostic_producer'), true);
  assert.equal(adapted.productionImpact, 'none');
});

test('authority enforcement blocks unsafe native authority in wrapped canonical signals', () => {
  const adapted = adapter.adaptDiagnosticSignal({
    nativeOutput: identityOutput({
      productionImpact: 'changes_production',
      blockingIssues: ['authority_boundary_violation']
    }),
    registry: signalRegistry()
  });

  assert.equal(adapted.canonicalSignal.rawOutput.productionImpact, 'changes_production');
  assert.equal(adapted.canonicalSignal.productionImpact, 'none');
  assert.equal(adapted.alignment.authorityAlignment.status, 'aligned');
  assert.equal(adapted.productionImpact, 'none');
  assert.equal(adapted.validation.valid, true);
});

test('adapted signal validation detects tampered canonical signal fingerprints', () => {
  const adapted = adapter.adaptDiagnosticSignal({
    nativeOutput: identityOutput(),
    registry: signalRegistry()
  });
  const tampered = {
    ...adapted,
    canonicalSignal: {
      ...adapted.canonicalSignal,
      signalFingerprint: 'stale'
    }
  };
  const validation = adapter.validateAdaptedSignal(tampered);

  assert.equal(validation.valid, false);
  assert.equal(validation.reasonCodes.includes('signal_fingerprint_mismatch'), true);
});

test('module does not execute diagnostics, engines, server, scanner, or runtime modules', () => {
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
    delete require.cache[require.resolve('../validation/signalProducerAdapter')];
    const fresh = require('../validation/signalProducerAdapter');
    const adapted = fresh.adaptDiagnosticSignal({
      nativeOutput: identityOutput(),
      registry: signalRegistry()
    });
    assert.equal(adapted.producer, 'identityParserDiagnostics');
  } finally {
    Module._load = originalLoad;
    delete require.cache[require.resolve('../validation/signalProducerAdapter')];
    require('../validation/signalProducerAdapter');
  }

  assert.equal(loaded.some((request) => request.includes('../engines')), false);
});
