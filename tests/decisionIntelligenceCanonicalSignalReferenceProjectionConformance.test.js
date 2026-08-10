'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const { createCanonicalSignal } = require('../validation/canonicalIntelligenceSignalContract');
const conformance = require('../validation/decisionIntelligenceCanonicalSignalReferenceProjectionConformance');

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
      confidence: 82
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
        preserved: true
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
      phase: '18.2D',
      sourceFixture: 'projection-conformance'
    },
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none',
    ...overrides
  };
}

function runFixture(records, options = {}) {
  return conformance.runDecisionIntelligenceCanonicalSignalReferenceProjectionConformance(records, {
    conformanceRunId: 'phase-18.2d-focused',
    createdAt: '2026-08-04T12:30:00.000Z',
    ...options
  });
}

test('exports required Projection Conformance public API and constants', () => {
  assert.equal(conformance.SOURCE, 'decision_intelligence_canonical_signal_reference_projection_conformance');
  assert.equal(conformance.VERSION, '1.0.0');
  assert.equal(conformance.SCHEMA_VERSION, 'decision_intelligence_canonical_signal_reference_projection_conformance.v1');
  assert.equal(conformance.CONFORMANCE_STAGES.length, 17);
  assert.deepEqual(conformance.CONFORMANCE_STATUSES, [
    'conformant',
    'conformant_with_warnings',
    'partially_conformant',
    'non_conformant',
    'invalid_input',
    'projection_failure',
    'unsupported_projection'
  ]);
  assert.equal(typeof conformance.runDecisionIntelligenceCanonicalSignalReferenceProjectionConformance, 'function');
  assert.equal(typeof conformance.validateDecisionIntelligenceCanonicalSignalReferenceProjectionConformance, 'function');
  assert.equal(typeof conformance.buildDecisionIntelligenceCanonicalSignalReferenceProjectionReport, 'function');
  assert.equal(typeof conformance.compareCanonicalSignalProjection, 'function');
  assert.equal(typeof conformance.summarizeDecisionIntelligenceCanonicalSignalReferenceProjectionConformance, 'function');
  assert.equal(typeof conformance.buildDecisionIntelligenceCanonicalSignalReferenceProjectionFingerprint, 'function');
});

test('validates projection identity, provenance, warning, readiness, confidence, schema, and authority preservation', () => {
  const report = runFixture([buildSourceArtifact()]);
  const record = report.perRecordResults[0];
  const stageNames = record.stages.map((stage) => stage.stage);

  assert.equal(report.validation.valid, true);
  assert.equal(record.status, 'conformant_with_warnings');
  for (const stage of conformance.CONFORMANCE_STAGES) {
    assert.equal(stageNames.includes(stage), true, `missing stage ${stage}`);
  }
  assert.equal(record.comparison.comparisons.find((item) => item.field === 'signalId').passed, true);
  assert.equal(record.comparison.comparisons.find((item) => item.field === 'provenance').passed, true);
  assert.equal(record.comparison.comparisons.find((item) => item.field === 'warnings').passed, true);
  assert.equal(record.comparison.comparisons.find((item) => item.field === 'readiness').passed, true);
  assert.equal(record.comparison.comparisons.find((item) => item.field === 'confidence').passed, true);
  assert.equal(record.comparison.comparisons.find((item) => item.field === 'schemaVersion').passed, true);
  assert.equal(record.projectionResult.productionImpact, 'none');
  assert.equal(record.projectionResult.decisionImpact, 'none');
  assert.equal(record.projectionResult.executionAuthority, 'none');
  assert.equal(record.projectionResult.eligibilityPropagation.buyNowEligible, false);
});

test('returns immutable conformance outputs without mutating source artifacts', () => {
  const sourceArtifact = buildSourceArtifact();
  const before = JSON.parse(JSON.stringify(sourceArtifact));
  const report = runFixture([sourceArtifact]);

  assert.deepEqual(sourceArtifact, before);
  assert.equal(Object.isFrozen(report), true);
  assert.equal(Object.isFrozen(report.perRecordResults), true);
  assert.equal(Object.isFrozen(report.perRecordResults[0].projectionResult), true);
  assert.throws(() => {
    report.perRecordResults.push({});
  }, TypeError);
});

test('deterministic replay, batch consistency, and fingerprints are stable', () => {
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
  const first = runFixture([confidence, evidence]);
  const second = runFixture([evidence, confidence]);

  assert.deepEqual(first, second);
  assert.equal(first.reportFingerprint, conformance.buildDecisionIntelligenceCanonicalSignalReferenceProjectionFingerprint(first));
  assert.equal(first.batchConsistency.passed, true);
  for (const record of first.perRecordResults) {
    assert.equal(record.conformanceFingerprint, conformance.buildDecisionIntelligenceCanonicalSignalReferenceProjectionFingerprint(record));
    assert.equal(record.stages.find((stage) => stage.stage === 'deterministic_replay').passed, true);
    assert.equal(record.stages.find((stage) => stage.stage === 'batch_consistency').passed, true);
  }
});

test('invalid input is reported explicitly without normalizing away failures', () => {
  const report = runFixture([{
    source: 'runtime_canonical_signal_compatibility_adapter',
    createdAt: '2026-08-04T12:00:00.000Z',
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  }]);
  const record = report.perRecordResults[0];

  assert.equal(record.status, 'invalid_input');
  assert.equal(record.projectionResult.projectionStatus, 'invalid_input');
  assert.equal(record.stages.find((stage) => stage.stage === 'input_validation').passed, false);
  assert.equal(record.stages.find((stage) => stage.stage === 'invalid_input_handling').passed, true);
  assert.equal(report.summary.statusTotals.invalid_input, 1);
  assert.equal(report.summary.projectionValidationReadiness, 'blocked_pending_projection_conformance_remediation');
});

test('unsupported projections are visible and do not create authority', () => {
  const unsupported = buildSourceArtifact({
    canonicalSignal: buildSignal({
      signalId: 'signal:notification',
      signalName: 'notification.eligibility',
      signalType: 'notification',
      warnings: []
    }),
    warnings: []
  });
  const report = runFixture([unsupported]);
  const record = report.perRecordResults[0];

  assert.equal(record.status, 'unsupported_projection');
  assert.equal(record.projectionResult.projectionStatus, 'withheld');
  assert.equal(record.projectionResult.unsupportedProjections[0].reasonCode, 'unsupported_signal_type');
  assert.equal(record.stages.find((stage) => stage.stage === 'unsupported_projection_handling').passed, true);
  assert.equal(record.projectionResult.eligibilityPropagation.dealGateEligible, false);
  assert.equal(record.projectionResult.eligibilityPropagation.buyNowEligible, false);
});

test('authority violations are reported as non-conformant and fail closed', () => {
  const report = runFixture([buildSourceArtifact({
    productionImpact: 'changes_runtime'
  })]);
  const record = report.perRecordResults[0];

  assert.equal(record.status, 'non_conformant');
  assert.equal(record.projectionResult.projectionStatus, 'invalid_input');
  assert.equal(record.projectionResult.authorityPreservation.authorityStatus, 'blocked');
  assert.equal(record.stages.find((stage) => stage.stage === 'authority_preservation').passed, false);
  assert.equal(record.stages.find((stage) => stage.stage === 'authority_preservation').reasonCodes.includes('source_authority_violation_detected'), true);
});

test('validation detects report, record, status, and authority drift', () => {
  const report = runFixture([buildSourceArtifact()]);
  const tampered = JSON.parse(JSON.stringify(report));
  tampered.perRecordResults[0].projectionResult.eligibilityPropagation.buyNowEligible = true;
  tampered.perRecordResults[0].status = 'production_ready';

  const validation = conformance.validateDecisionIntelligenceCanonicalSignalReferenceProjectionConformance(tampered);

  assert.equal(validation.valid, false);
  assert.equal(validation.reasonCodes.includes('invalid_conformance_status'), true);
  assert.equal(validation.reasonCodes.includes('buy_now_eligibility_granted'), true);
  assert.equal(validation.reasonCodes.includes('record_fingerprint_mismatch'), true);
  assert.equal(validation.reasonCodes.includes('report_fingerprint_mismatch'), true);
  assert.equal(validation.authorityViolations.some((field) => field.includes('buyNowEligible')), true);
});

test('summary reports deterministic status totals and readiness determination', () => {
  const report = runFixture([
    buildSourceArtifact({
      signalOverrides: { warnings: [] },
      warnings: []
    }),
    buildSourceArtifact({
      adapterRunId: 'adapter-run-unsupported',
      canonicalSignal: buildSignal({
        signalId: 'signal:notification',
        signalName: 'notification.eligibility',
        signalType: 'notification',
        warnings: []
      }),
      warnings: []
    })
  ]);
  const summary = conformance.summarizeDecisionIntelligenceCanonicalSignalReferenceProjectionConformance(report);

  assert.equal(summary.totalRecords, 2);
  assert.equal(summary.statusTotals.conformant, 1);
  assert.equal(summary.statusTotals.unsupported_projection, 1);
  assert.equal(summary.blockingFindingCount, 0);
  assert.equal(summary.projectionValidationReadiness, 'ready_for_decision_intelligence_projection_validation');
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

  delete require.cache[require.resolve('../validation/decisionIntelligenceCanonicalSignalReferenceProjectionConformance')];
  require('../validation/decisionIntelligenceCanonicalSignalReferenceProjectionConformance');
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
