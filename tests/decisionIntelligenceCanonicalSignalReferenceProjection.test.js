'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const {
  CANONICAL_INTELLIGENCE_SIGNAL_SOURCE,
  createCanonicalSignal
} = require('../validation/canonicalIntelligenceSignalContract');
const projection = require('../validation/decisionIntelligenceCanonicalSignalReferenceProjection');

function buildSignal(overrides = {}) {
  return createCanonicalSignal({
    signalId: 'signal:evidence-readiness:listing-001',
    signalName: 'evidence.readiness.diagnostics',
    signalVersion: '1.0.0',
    producer: {
      producerId: 'evidence-readiness-diagnostics',
      name: 'Evidence Readiness Diagnostics',
      version: '1.0.0',
      category: 'offline_validation'
    },
    producerVersion: '1.0.0',
    producerCategory: 'offline_validation',
    createdAt: '2026-08-04T12:00:00.000Z',
    signalType: 'evidence',
    decisionRole: 'supporting_context',
    authorityLevel: 'offline_validation',
    confidence: {
      kind: 'reported',
      value: 82,
      scale: '0_100',
      basis: 'Preserved diagnostic confidence.',
      calibrated: false
    },
    confidenceLevel: 'moderate',
    uncertainty: {
      level: 'moderate',
      reasonCodes: ['thin_sold_evidence']
    },
    evidenceBasis: {
      trueSoldCount: 4,
      activeListingCount: 2,
      asOf: '2026-08-04T12:00:00.000Z'
    },
    evidenceQuality: {
      level: 'adequate',
      score: 74,
      basis: 'Comparable evidence is usable for review.'
    },
    evidenceReferences: [{
      referenceId: 'sold-evidence:listing-001',
      referenceType: 'canonical_sold_evidence',
      source: 'canonical_sold_evidence',
      sourceFingerprint: 'sold-fingerprint-001',
      evidenceRole: 'supporting'
    }],
    warnings: ['Comparable support is thin'],
    blockers: [],
    rawOutput: {
      readinessStatus: 'review_ready_with_warnings',
      confidence: 82,
      unknownField: 'unknown'
    },
    normalizedOutput: {
      readinessStatus: 'review_ready_with_warnings'
    },
    governanceFlags: {
      advisoryOnly: true
    },
    sourceFingerprint: 'native-output-fingerprint-001',
    metadata: {
      unmappedRuntimeField: {
        preserved: true,
        value: 'native-display-only'
      }
    },
    ...overrides
  });
}

function buildSourceArtifact(overrides = {}) {
  const canonicalSignal = overrides.canonicalSignal || buildSignal(overrides.signalOverrides);
  return {
    schemaVersion: '1.0.0',
    source: 'runtime_canonical_signal_compatibility_adapter',
    sourceArtifactType: 'runtime_canonical_signal_compatibility_adapter_output',
    adapterRunId: 'adapter-run-001',
    createdAt: '2026-08-04T12:00:00.000Z',
    listingId: 'listing-001',
    canonicalSignal,
    sourceOutputFingerprint: 'native-output-fingerprint-001',
    compatibilityFingerprint: 'compatibility-fingerprint-001',
    conformanceFingerprint: 'conformance-fingerprint-001',
    alignmentId: 'alignment-001',
    alignmentFingerprint: 'alignment-fingerprint-001',
    migrationFingerprint: 'migration-fingerprint-001',
    shadowComparisonFingerprint: 'shadow-comparison-fingerprint-001',
    reportFingerprint: 'report-fingerprint-001',
    parityStatus: 'exact_match',
    readinessPreservation: {
      status: 'review_ready_with_warnings',
      value: 'review_ready_with_warnings',
      upgraded: false
    },
    confidencePreservation: {
      value: 82,
      status: 'preserved',
      valuationConfidenceCreated: false,
      recommendationAuthorityCreated: false
    },
    authorityPreservation: {
      status: 'preserved',
      notDealGateEligible: true,
      notBuyNowEligible: true,
      notNotificationEligible: true,
      productionImpact: 'none',
      decisionImpact: 'none',
      executionAuthority: 'none'
    },
    warnings: [{
      sourceField: 'qualityWarnings',
      message: 'Comparable support is thin',
      severity: 'medium'
    }],
    validation: {
      valid: true,
      errors: [],
      warnings: []
    },
    provenance: {
      phase: '18.2C',
      sourceFixture: 'decision-intelligence-canonical-signal-reference-projection'
    },
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none',
    ...overrides
  };
}

test('exports required Decision Intelligence Canonical Signal Reference Projection API', () => {
  assert.equal(projection.SOURCE, 'decision_intelligence_canonical_signal_reference_projection');
  assert.equal(projection.VERSION, '1.0.0');
  assert.equal(projection.SCHEMA_VERSION, 'decision_intelligence_canonical_signal_reference_projection.v1');
  assert.deepEqual(Object.values(projection.PROJECTION_STATUSES), [
    'projected',
    'projected_with_warnings',
    'partially_projected',
    'withheld',
    'invalid_input'
  ]);
  assert.equal(projection.PROJECTABLE_SIGNAL_TYPES.includes('evidence'), true);
  assert.equal(typeof projection.projectCanonicalSignalReference, 'function');
  assert.equal(typeof projection.projectCanonicalSignalReferenceBatch, 'function');
  assert.equal(typeof projection.validateCanonicalSignalReferenceProjection, 'function');
  assert.equal(typeof projection.summarizeCanonicalSignalReferenceProjection, 'function');
  assert.equal(typeof projection.buildCanonicalSignalReferenceProjectionFingerprint, 'function');
});

test('projects a canonical signal reference while preserving identity, schema versions, and fingerprints', () => {
  const sourceArtifact = buildSourceArtifact();
  const result = projection.projectCanonicalSignalReference(sourceArtifact, {
    projectionRunId: 'projection-run-001',
    createdAt: '2026-08-04T12:30:00.000Z'
  });

  assert.equal(result.schemaVersion, projection.SCHEMA_VERSION);
  assert.equal(result.source, projection.SOURCE);
  assert.equal(result.projectionStatus, 'projected_with_warnings');
  assert.equal(result.signalRefs.length, 1);
  assert.equal(result.signalRefs[0].signalName, sourceArtifact.canonicalSignal.signalName);
  assert.equal(result.signalRefs[0].signalId, sourceArtifact.canonicalSignal.signalId);
  assert.equal(result.signalRefs[0].signalFingerprint, sourceArtifact.canonicalSignal.signalFingerprint);
  assert.equal(result.signalRefs[0].sourceOutputFingerprint, 'native-output-fingerprint-001');
  assert.equal(result.sourceArtifactReferences[0].schemaVersion, '1.0.0');
  assert.equal(result.sourceArtifactReferences[0].signalFingerprint, sourceArtifact.canonicalSignal.signalFingerprint);
  assert.equal(result.projectionFingerprint, projection.buildCanonicalSignalReferenceProjectionFingerprint(result));
  assert.equal(result.validation.valid, true);
});

test('preserves provenance, warnings, readiness, confidence, eligibility, and authority metadata', () => {
  const sourceArtifact = buildSourceArtifact();
  const result = projection.projectCanonicalSignalReference(sourceArtifact);

  assert.deepEqual(result.provenance.sourceProvenance, sourceArtifact.provenance);
  assert.equal(result.warningPropagation.warningCount, 2);
  assert.equal(result.warningPropagation.warningsBySignalName['evidence.readiness.diagnostics'], 2);
  assert.equal(result.readinessPropagation.sourceReadiness.value, 'review_ready_with_warnings');
  assert.equal(result.readinessPropagation.projectionReadiness, 'review_ready_with_warnings');
  assert.equal(result.confidencePropagation.confidencePreserved, true);
  assert.equal(result.confidencePropagation.confidenceInvented, false);
  assert.equal(result.confidencePropagation.confidenceRecomputed, false);
  assert.equal(result.confidencePropagation.confidenceSources[0].confidence.value, 82);
  assert.equal(result.eligibilityPropagation.dealGateEligible, false);
  assert.equal(result.eligibilityPropagation.buyNowEligible, false);
  assert.equal(result.eligibilityPropagation.notificationEligible, false);
  assert.equal(result.authorityPreservation.authorityStatus, 'none');
  assert.equal(result.productionImpact, 'none');
  assert.equal(result.decisionImpact, 'none');
  assert.equal(result.executionAuthority, 'none');
});

test('preserves source and canonical artifacts without mutation', () => {
  const sourceArtifact = buildSourceArtifact();
  const before = JSON.parse(JSON.stringify(sourceArtifact));
  const result = projection.projectCanonicalSignalReference(sourceArtifact);

  assert.deepEqual(sourceArtifact, before);
  assert.deepEqual(result.preservedSourceArtifact, before);
  assert.deepEqual(result.preservedCanonicalSignal, before.canonicalSignal);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.signalRefs), true);
  assert.throws(() => {
    result.signalRefs.push({ signalName: 'mutated' });
  }, TypeError);
});

test('produces deterministic projections and stable fingerprints for identical inputs', () => {
  const sourceArtifact = buildSourceArtifact();
  const options = {
    projectionRunId: 'projection-run-001',
    createdAt: '2026-08-04T12:30:00.000Z'
  };
  const first = projection.projectCanonicalSignalReference(sourceArtifact, options);
  const second = projection.projectCanonicalSignalReference(sourceArtifact, options);

  assert.deepEqual(first, second);
  assert.equal(first.projectionFingerprint, second.projectionFingerprint);
});

test('preserves explicit unknown values instead of inventing missing confidence or readiness', () => {
  const unknownSignal = buildSignal({
    signalId: 'signal:unknown-confidence',
    signalName: 'unknown.confidence.signal',
    confidence: 'unknown',
    confidenceLevel: 'unknown',
    rawOutput: 'unknown',
    normalizedOutput: 'unknown',
    warnings: []
  });
  const result = projection.projectCanonicalSignalReference(buildSourceArtifact({
    canonicalSignal: unknownSignal,
    readinessPreservation: {
      status: 'missing',
      value: 'unknown',
      upgraded: false
    },
    confidencePreservation: {
      value: 'unknown',
      status: 'missing'
    },
    warnings: []
  }));

  assert.equal(result.confidencePropagation.confidenceSources[0].confidence.value, 'unknown');
  assert.equal(result.confidencePropagation.missingConfidenceSignals.includes('unknown.confidence.signal'), true);
  assert.equal(result.unknownValues.includes('confidence.value'), true);
  assert.equal(result.unknownValues.includes('readinessPreservation.value'), true);
});

test('withholds unsupported signal types without creating authority', () => {
  const unsupported = buildSignal({
    signalId: 'signal:notification',
    signalName: 'runtime.notification.eligibility',
    signalType: 'notification',
    warnings: []
  });
  const result = projection.projectCanonicalSignalReference(buildSourceArtifact({
    canonicalSignal: unsupported,
    warnings: []
  }));

  assert.equal(result.projectionStatus, 'withheld');
  assert.equal(result.signalRefs.length, 0);
  assert.equal(result.unsupportedProjections.length, 1);
  assert.equal(result.unsupportedProjections[0].reasonCode, 'unsupported_signal_type');
  assert.equal(result.eligibilityPropagation.notificationEligible, false);
  assert.equal(result.authorityPreservation.authorityStatus, 'none');
});

test('invalid input fails closed with structured validation and no eligibility', () => {
  const result = projection.projectCanonicalSignalReference({
    source: 'runtime_canonical_signal_compatibility_adapter',
    createdAt: '2026-08-04T12:00:00.000Z'
  });

  assert.equal(result.projectionStatus, 'invalid_input');
  assert.equal(result.signalRefs.length, 0);
  assert.equal(result.missingReferences.length, 1);
  assert.equal(result.validation.valid, false);
  assert.equal(result.validation.reasonCodes.includes('missing_canonical_signal'), true);
  assert.equal(result.eligibilityPropagation.dealGateEligible, false);
  assert.equal(result.eligibilityPropagation.buyNowEligible, false);
});

test('authority violations fail closed and preserve none authority on the projection', () => {
  const result = projection.projectCanonicalSignalReference(buildSourceArtifact({
    productionImpact: 'changes_runtime'
  }));

  assert.equal(result.projectionStatus, 'invalid_input');
  assert.equal(result.validation.valid, false);
  assert.equal(result.authorityPreservation.authorityStatus, 'blocked');
  assert.equal(result.authorityPreservation.authorityViolations.includes('productionImpact'), true);
  assert.equal(result.productionImpact, 'none');
  assert.equal(result.decisionImpact, 'none');
  assert.equal(result.executionAuthority, 'none');
});

test('batch projection preserves deterministic ordering, summaries, and fingerprints', () => {
  const evidence = buildSourceArtifact({
    adapterRunId: 'adapter-run-evidence',
    signalOverrides: {
      signalId: 'signal:evidence',
      signalName: 'evidence.readiness.diagnostics',
      warnings: []
    },
    warnings: []
  });
  const confidence = buildSourceArtifact({
    adapterRunId: 'adapter-run-confidence',
    signalOverrides: {
      signalId: 'signal:confidence',
      signalName: 'confidence.calibration.diagnostics',
      signalType: 'confidence',
      warnings: []
    },
    warnings: []
  });
  const unsupported = buildSourceArtifact({
    adapterRunId: 'adapter-run-notification',
    signalOverrides: {
      signalId: 'signal:notification',
      signalName: 'notification.eligibility',
      signalType: 'notification',
      warnings: []
    },
    warnings: []
  });
  const options = {
    projectionBatchId: 'projection-batch-001',
    createdAt: '2026-08-04T12:30:00.000Z'
  };
  const first = projection.projectCanonicalSignalReferenceBatch([unsupported, evidence, confidence], options);
  const second = projection.projectCanonicalSignalReferenceBatch([confidence, unsupported, evidence], options);

  assert.deepEqual(first, second);
  assert.deepEqual(first.summary.projectedSignalNames, [
    'confidence.calibration.diagnostics',
    'evidence.readiness.diagnostics'
  ]);
  assert.equal(first.summary.projectedCount, 2);
  assert.equal(first.summary.withheldCount, 1);
  assert.equal(first.batchFingerprint, projection.buildCanonicalSignalReferenceProjectionFingerprint(first));
  assert.equal(Object.isFrozen(first), true);
});

test('validation detects fingerprint drift without mutating the projection', () => {
  const result = projection.projectCanonicalSignalReference(buildSourceArtifact());
  const tampered = {
    ...JSON.parse(JSON.stringify(result)),
    signalRefs: [{
      ...result.signalRefs[0],
      signalName: 'tampered.signal'
    }]
  };
  const validation = projection.validateCanonicalSignalReferenceProjection(tampered);

  assert.equal(validation.valid, false);
  assert.equal(validation.fingerprintViolations.includes('projectionFingerprint'), true);
  assert.equal(validation.reasonCodes.includes('projection_fingerprint_mismatch'), true);
});

test('summary is deterministic and non-authoritative', () => {
  const result = projection.projectCanonicalSignalReference(buildSourceArtifact());
  const summary = projection.summarizeCanonicalSignalReferenceProjection(result);

  assert.equal(summary.projectionId, result.projectionId);
  assert.equal(summary.signalRefCount, 1);
  assert.equal(summary.warningCount, 2);
  assert.equal(summary.authorityStatus, 'none');
  assert.equal(summary.productionImpact, 'none');
  assert.equal(summary.decisionImpact, 'none');
  assert.equal(summary.executionAuthority, 'none');
});

test('module does not import runtime, persistence, network, notification, marketplace, scanner, or engine modules', () => {
  const loaded = new Set();
  const originalLoad = Module._load;
  Module._load = function trackingLoad(request, parent, isMain) {
    loaded.add(request);
    return originalLoad.apply(this, arguments);
  };

  delete require.cache[require.resolve('../validation/decisionIntelligenceCanonicalSignalReferenceProjection')];
  require('../validation/decisionIntelligenceCanonicalSignalReferenceProjection');
  Module._load = originalLoad;

  const requests = [...loaded];
  assert.equal(requests.some((request) => request.includes('server')), false);
  assert.equal(requests.some((request) => request.includes('scoutScannerService')), false);
  assert.equal(requests.some((request) => request.includes('engines/')), false);
  assert.equal(requests.some((request) => request.includes('marketplaces/')), false);
  assert.equal(requests.some((request) => request.includes('notification')), false);
  assert.equal(requests.some((request) => request.includes('persistence')), false);
  assert.equal(requests.some((request) => request === 'fs' || request === 'node:fs'), false);
  assert.equal(requests.some((request) => ['http', 'https', 'net', 'node:http', 'node:https', 'node:net'].includes(request)), false);
});
