'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const conformance = require('../validation/runtimeCanonicalSignalCompatibilityConformance');
const adapter = require('../validation/runtimeCanonicalSignalCompatibilityAdapter');
const fixtures = require('../validation/fixtures/runtimeCanonicalSignalCompatibilityFixtures.json');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function fixtureInput(scenario, overrides = {}) {
  return {
    ...clone(scenario.runtimeInput),
    fixtureScenarioId: scenario.id,
    expectedMappingClassification: scenario.classification,
    expectedCompatibility: clone(scenario.expectedCompatibility),
    expectedReasonCodes: clone(scenario.expectedCompatibility?.reasonCodes || []),
    createdAt: '2026-08-04T12:00:00.000Z',
    provenance: {
      fixtureId: scenario.id,
      fixtureSource: fixtures.source
    },
    ...overrides
  };
}

function scenarioById(id) {
  return fixtures.scenarios.find((scenario) => scenario.id === id);
}

function representativeInput({
  runtimeSignalId,
  owner,
  rawValue,
  signalType = 'diagnostic',
  classification = 'CONDITIONAL',
  evidenceBasis = 'runtime_observation',
  decisionEligibility = 'context_only',
  sourceVersion = '1.0.0'
}) {
  return {
    runtimeSignalId,
    runtimeSignalContract: {
      signalId: runtimeSignalId,
      owner,
      schemaVersion: sourceVersion,
      signalType,
      decisionEligibility,
      evidenceBasis
    },
    runtimeRawValue: clone(rawValue),
    expectedMappingClassification: classification,
    expectedCompatibility: {
      reasonCodes: [`${runtimeSignalId}_representative_runtime_shape`]
    },
    createdAt: '2026-08-04T12:00:00.000Z',
    provenance: {
      source: 'repository-derived-test-shape',
      owner
    }
  };
}

function representativeInputs() {
  return [
    representativeInput({
      runtimeSignalId: 'grade_premium_runtime_shadow',
      owner: 'gradePremiumEngine.evaluateGradePremium',
      rawValue: { status: 'supported', score: 74, confidence: 72, summary: 'Grade premium preserved.', warnings: [] }
    }),
    representativeInput({
      runtimeSignalId: 'population_intelligence_runtime_shadow',
      owner: 'populationIntelligence.evaluatePopulation',
      rawValue: { status: 'supported', populationBand: 'low_pop', confidenceScore: 69, summary: 'Population scarcity context preserved.' }
    }),
    representativeInput({
      runtimeSignalId: 'listing_quality_runtime_shadow',
      owner: 'listingQualityGradingDiagnostics.evaluateListingQuality',
      rawValue: { status: 'warning', score: 71, qualityWarnings: [{ code: 'surface_visibility_limited', severity: 'medium' }] }
    }),
    representativeInput({
      runtimeSignalId: 'valuation_range_runtime_shadow',
      owner: 'rangeFirstValuationDiagnostics.evaluateRange',
      rawValue: { status: 'supported', confidence: 66, range: { low: 80, high: 110 }, summary: 'Range-first value preserved.' },
      signalType: 'valuation_context'
    }),
    representativeInput({
      runtimeSignalId: 'confidence_calibration_runtime_shadow',
      owner: 'confidenceCalibrationDiagnostics.evaluateCalibration',
      rawValue: { status: 'calibrated', confidenceScore: 70, confidenceLevel: 'medium', summary: 'Calibration context preserved.' },
      signalType: 'confidence_context'
    }),
    representativeInput({
      runtimeSignalId: 'deal_gate_diagnostics_runtime_shadow',
      owner: 'dealGateDiagnostics.observeGate',
      rawValue: { status: 'blocked', readinessStatus: 'blocked', rejectionReasons: ['insufficient_margin'], confidence: 61 },
      classification: 'ONE_WAY_ONLY',
      signalType: 'decision_observation',
      decisionEligibility: 'observational_only'
    }),
    representativeInput({
      runtimeSignalId: 'evidence_readiness_runtime_shadow',
      owner: 'evidenceReadinessDiagnostics.evaluateReadiness',
      rawValue: { readinessStatus: 'thin', trueSoldEvidenceCount: 2, minimumRequired: 3, confidence: 58 }
    }),
    representativeInput({
      runtimeSignalId: 'identity_parser_diagnostics_runtime_shadow',
      owner: 'identityParserDiagnostics.evaluateParserOutput',
      rawValue: { status: 'partial', confidence: 64, ambiguity: ['parallel_set_possible'], missing: ['cardNumber'] },
      signalType: 'identity_context'
    }),
    representativeInput({
      runtimeSignalId: 'false_positive_diagnostics_runtime_shadow',
      owner: 'falsePositiveDiagnostics.evaluateRisk',
      rawValue: { status: 'warning', riskLevel: 'moderate', confidenceScore: 62, warnings: [{ code: 'title_mismatch', severity: 'medium' }] },
      signalType: 'risk_context'
    }),
    representativeInput({
      runtimeSignalId: 'canonical_sold_evidence_runtime_shadow',
      owner: 'canonicalSoldEvidence.summarizeEvidence',
      rawValue: { status: 'supported', trueSoldEvidenceCount: 5, marketConfidence: 78, provenance: ['canonical_sold_evidence'] },
      signalType: 'evidence_context'
    }),
    representativeInput({
      runtimeSignalId: 'production_valuation_runtime_shadow',
      owner: 'productionValuation.observeValuation',
      rawValue: { status: 'valued', marketConfidence: 73, estimatedValue: 96.5, confidenceLevel: 'medium' },
      signalType: 'valuation_context'
    }),
    representativeInput({
      runtimeSignalId: 'comparable_quality_runtime_shadow',
      owner: 'comparableQualityEngine.evaluateComparables',
      rawValue: { status: 'supported', trueSoldCompCount: 6, confidence: 76, similarityBand: 'strong' },
      signalType: 'evidence_context'
    }),
    representativeInput({
      runtimeSignalId: 'decision_context_runtime_shadow',
      owner: 'decisionContextBuilder.observeDecisionContext',
      rawValue: { status: 'observed', confidence: 68, contributingFactors: ['margin', 'evidence_quality'], warnings: [] },
      signalType: 'decision_observation',
      decisionEligibility: 'advisory_only'
    }),
    {
      conformanceRecordId: 'insufficient:shadow-market-arbitrage',
      signalFamily: 'shadow_market_arbitrage',
      runtimeSignalId: 'shadow_market_arbitrage',
      insufficientSourceMaterial: true,
      provenance: {
        source: 'phase-18.1E-representative-coverage',
        reason: 'insufficient_source_material'
      }
    }
  ];
}

function approvedFixtureInputs() {
  return fixtures.scenarios.map(fixtureInput);
}

function allInputs() {
  return [...approvedFixtureInputs(), ...representativeInputs()];
}

function buildReport() {
  return conformance.runRuntimeCanonicalSignalCompatibilityConformance(allInputs(), {
    reportId: 'phase-18.1E-conformance-test-report',
    createdAt: '2026-08-04T12:00:00.000Z'
  });
}

function recordForFixture(report, fixtureId) {
  return report.perRecordResults.find((record) => record.adaptedOutput.runtimeInput?.fixtureScenarioId === fixtureId);
}

test('exports required public API, all stages, and all statuses', () => {
  assert.equal(conformance.SOURCE, 'runtime_canonical_signal_compatibility_conformance');
  assert.equal(conformance.VERSION, '1.0.0');
  assert.equal(conformance.SCHEMA_VERSION, '1.0.0');
  assert.deepEqual(conformance.CONFORMANCE_STAGES, [
    'input_validation',
    'adapter_execution',
    'native_input_preservation',
    'field_mapping',
    'vocabulary_mapping',
    'warning_preservation',
    'readiness_preservation',
    'confidence_preservation',
    'unknown_value_preservation',
    'null_preservation',
    'provenance_preservation',
    'schema_version_validation',
    'authority_preservation',
    'deterministic_replay',
    'fingerprint_integrity',
    'batch_consistency',
    'output_validation',
    'final_classification'
  ]);
  assert.deepEqual(conformance.CONFORMANCE_STATUSES, [
    'conformant',
    'conformant_with_warnings',
    'partially_conformant',
    'non_conformant',
    'invalid_input',
    'adapter_failure',
    'insufficient_evidence'
  ]);
  assert.equal(typeof conformance.runRuntimeCanonicalSignalCompatibilityConformance, 'function');
  assert.equal(typeof conformance.validateRuntimeCanonicalSignalCompatibilityConformance, 'function');
  assert.equal(typeof conformance.buildRuntimeCanonicalSignalCompatibilityReport, 'function');
  assert.equal(typeof conformance.compareRuntimeAndCanonicalSignal, 'function');
  assert.equal(typeof conformance.summarizeRuntimeCanonicalSignalCompatibilityConformance, 'function');
  assert.equal(typeof conformance.buildRuntimeCanonicalSignalCompatibilityConformanceFingerprint, 'function');
});

test('evaluates all approved fixtures and representative runtime-shaped signal families', () => {
  assert.equal(fixtures.scenarios.length, 14);
  assert.equal(representativeInputs().length, 14);

  const report = buildReport();
  assert.equal(report.totalRecords, 28);
  assert.equal(report.validation.valid, true);
  assert.equal(report.nonConformantCount, 0);
  assert.equal(report.invalidInputCount, 0);
  assert.equal(report.adapterFailureCount, 0);
  assert.equal(report.insufficientEvidenceCount, 1);
  assert.equal(report.adapterValidationReadiness, 'ready_for_additional_offline_validation');
  assert.equal(report.productionImpact, 'none');
  assert.equal(report.decisionImpact, 'none');
  assert.equal(report.executionAuthority, 'none');

  for (const record of report.perRecordResults) {
    assert.equal(record.stages.length, conformance.CONFORMANCE_STAGES.length, record.runtimeSignalId);
    assert.deepEqual(record.stages.map((stage) => stage.stage), conformance.CONFORMANCE_STAGES, record.runtimeSignalId);
  }
});

test('preserves native inputs and returns immutable report structures', () => {
  const inputs = allInputs();
  const before = clone(inputs);
  const report = buildReport();

  assert.deepEqual(inputs, before);
  assert.equal(Object.isFrozen(report), true);
  assert.equal(Object.isFrozen(report.perRecordResults[0]), true);
  assert.equal(Object.isFrozen(report.perRecordResults[0].adaptedOutput), true);
  assert.equal(report.perRecordResults.every((record) => record.adaptedOutput.nativeOutputPreserved === true), true);
  assert.equal(report.perRecordResults.every((record) => record.adaptedOutput.nativeInputPreservation?.preserved !== false), true);
});

test('preserves warnings, unknown warning codes, warning severity, provenance, unknowns, and nulls', () => {
  const report = buildReport();
  const warningRecord = recordForFixture(report, 'fixture-008-warning-bearing-decision-intelligence');
  const missingConfidence = recordForFixture(report, 'fixture-011-missing-confidence');
  const missingReadiness = recordForFixture(report, 'fixture-012-missing-readiness');
  const unknownStatus = recordForFixture(report, 'fixture-010-unknown-native-status');
  const structuredWarningReport = conformance.runRuntimeCanonicalSignalCompatibilityConformance([
    representativeInput({
      runtimeSignalId: 'structured_warning_probe',
      owner: 'listingQualityGradingDiagnostics.evaluateListingQuality',
      rawValue: { status: 'warning', qualityWarnings: [{ message: 'Photo angle limits grade confidence.', severity: 'high' }] }
    })
  ], { createdAt: '2026-08-04T12:00:00.000Z' });
  const structuredWarning = structuredWarningReport.perRecordResults[0];

  assert.equal(warningRecord.adaptedOutput.warningPreservation.status, 'preserved');
  assert.equal(warningRecord.adaptedOutput.warningPreservation.warnings.length, 2);
  assert.equal(warningRecord.stages.find((stage) => stage.stage === 'warning_preservation').passed, true);
  assert.equal(structuredWarning.adaptedOutput.warningPreservation.unknownWarningCodes.includes('qualityWarnings'), true);
  assert.equal(structuredWarning.adaptedOutput.warningPreservation.warnings[0].severity, 'high');
  assert.equal(missingConfidence.adaptedOutput.confidencePreservation.value, 'unknown');
  assert.equal(missingConfidence.adaptedOutput.nullHandling.rawNullPreserved, true);
  assert.equal(missingReadiness.adaptedOutput.readinessPreservation.value, 'unknown');
  assert.equal(unknownStatus.adaptedOutput.unknownFieldHandling.missingValuesRemainUnknown, true);
  assert.deepEqual(warningRecord.adaptedOutput.provenance.callerProvenance, warningRecord.adaptedOutput.runtimeInput.provenance);
});

test('keeps readiness and confidence non-authoritative without upgrades', () => {
  const report = buildReport();
  assert.equal(report.readinessFindings.upgraded, 0);
  assert.equal(report.confidenceFindings.invented, 0);

  for (const record of report.perRecordResults) {
    assert.equal(record.stages.find((stage) => stage.stage === 'readiness_preservation').blocking, false, record.runtimeSignalId);
    assert.equal(record.stages.find((stage) => stage.stage === 'confidence_preservation').blocking, false, record.runtimeSignalId);
    assert.equal(record.adaptedOutput.authorityPreservation.notDealGateEligible, true, record.runtimeSignalId);
    assert.equal(record.adaptedOutput.authorityPreservation.notBuyNowEligible, true, record.runtimeSignalId);
    assert.equal(record.adaptedOutput.authorityPreservation.notNotificationEligible, true, record.runtimeSignalId);
  }
});

test('reports intentionally unmapped fields, incompatible fields, one-way mappings, and legacy aliases', () => {
  const report = buildReport();
  const intentionallyUnmapped = recordForFixture(report, 'fixture-006-intentionally-unmapped-display-language');
  const incompatible = recordForFixture(report, 'fixture-007-incompatible-fallback-policy');
  const oneWay = recordForFixture(report, 'fixture-004-one-way-deal-gate-decision');
  const legacy = recordForFixture(report, 'fixture-005-legacy-alias-deal-grade');

  assert.equal(intentionallyUnmapped.adaptedOutput.mappingClassification, 'INTENTIONALLY_UNMAPPED');
  assert.equal(intentionallyUnmapped.adaptedOutput.unmappedFields.includes('runtimeSignalContract.allowedDisplayLanguage'), true);
  assert.equal(incompatible.adaptedOutput.mappingClassification, 'INCOMPATIBLE');
  assert.equal(incompatible.adaptedOutput.incompatibleFields.includes('runtimeSignalContract.allowsFallbackEvidence'), true);
  assert.equal(oneWay.adaptedOutput.mappingClassification, 'ONE_WAY_ONLY');
  assert.equal(legacy.adaptedOutput.mappingClassification, 'LEGACY_ALIAS');
});

test('records expected information loss and blocks unexpected information loss', () => {
  const report = buildReport();
  const oneWay = recordForFixture(report, 'fixture-004-one-way-deal-gate-decision');
  const oneWayDifferences = oneWay.comparison.materialDifferences.filter((difference) => difference.compatibilityClassification === 'ONE_WAY_ONLY');

  assert.equal(oneWay.status, 'conformant_with_warnings');
  assert.equal(oneWayDifferences.length > 0, true);
  assert.equal(oneWayDifferences.every((difference) => difference.expected === true), true);

  const tampered = clone(report);
  tampered.perRecordResults[0].comparison.differences.push({
    field: 'confidence',
    nativeValue: 82,
    canonicalValue: 'unknown',
    compatibilityClassification: 'CONDITIONAL',
    differenceType: 'dropped',
    expected: false,
    informationLoss: true,
    warningImpact: 'none',
    readinessImpact: 'none',
    confidenceImpact: 'changed',
    authorityImpact: 'none',
    blocking: true,
    reasonCode: 'unexpected_confidence_loss'
  });
  tampered.reportFingerprint = conformance.buildRuntimeCanonicalSignalCompatibilityConformanceFingerprint(tampered);
  const validation = conformance.validateRuntimeCanonicalSignalCompatibilityConformance(tampered);

  assert.equal(validation.valid, false);
  assert.equal(validation.reasonCodes.includes('unexpected_information_loss'), true);
});

test('detects authority escalation, Deal Gate, BUY_NOW, notification, and production-approved labeling violations', () => {
  const report = buildReport();
  const tampered = clone(report);
  tampered.perRecordResults[0].adaptedOutput.authorityPreservation.notDealGateEligible = false;
  tampered.perRecordResults[1].adaptedOutput.authorityPreservation.notBuyNowEligible = false;
  tampered.perRecordResults[2].adaptedOutput.authorityPreservation.notNotificationEligible = false;
  tampered.perRecordResults[3].adaptedOutput.productionImpact = 'production';
  tampered.perRecordResults[4].adaptedOutput.summary.productionApproved = true;
  tampered.adapterValidationReadiness = 'production_approved';
  tampered.reportFingerprint = conformance.buildRuntimeCanonicalSignalCompatibilityConformanceFingerprint(tampered);
  const validation = conformance.validateRuntimeCanonicalSignalCompatibilityConformance(tampered);

  assert.equal(validation.valid, false);
  assert.equal(validation.reasonCodes.includes('deal_gate_eligibility_granted'), true);
  assert.equal(validation.reasonCodes.includes('buy_now_eligibility_granted'), true);
  assert.equal(validation.reasonCodes.includes('notification_eligibility_granted'), true);
  assert.equal(validation.reasonCodes.includes('authority_boundary_violation'), true);
  assert.equal(validation.reasonCodes.includes('production_approved_label_rejected'), true);
  assert.equal(validation.reasonCodes.includes('prohibited_readiness_state'), true);
});

test('produces deterministic single-record and batch replays with valid fingerprints', () => {
  const input = fixtureInput(scenarioById('fixture-001-direct-market-context'));
  const first = conformance.buildRuntimeCanonicalSignalCompatibilityReport([input], {
    reportId: 'deterministic-single',
    createdAt: '2026-08-04T12:00:00.000Z'
  });
  const second = conformance.buildRuntimeCanonicalSignalCompatibilityReport([input], {
    reportId: 'deterministic-single',
    createdAt: '2026-08-04T12:00:00.000Z'
  });
  const batchA = buildReport();
  const batchB = buildReport();

  assert.deepEqual(first, second);
  assert.deepEqual(batchA, batchB);
  assert.equal(first.reportFingerprint, conformance.buildRuntimeCanonicalSignalCompatibilityConformanceFingerprint(first));
  assert.equal(batchA.reportFingerprint, conformance.buildRuntimeCanonicalSignalCompatibilityConformanceFingerprint(batchA));
  assert.equal(batchA.deterministicReplayFindings.failed, 0);
});

test('isolates record-level invalid input, adapter failure, and insufficient source material', () => {
  const badInput = { runtimeRawValue: { status: 'unknown' } };
  const adapterFailureInput = fixtureInput(scenarioById('fixture-001-direct-market-context'), {
    runtimeSignalId: 'adapter_failure_probe'
  });
  const failingAdapter = {
    ...adapter,
    adaptRuntimeSignalToCanonical() {
      throw new Error('adapter probe failure');
    }
  };
  const invalidReport = conformance.runRuntimeCanonicalSignalCompatibilityConformance([badInput], {
    createdAt: '2026-08-04T12:00:00.000Z'
  });
  const failureReport = conformance.runRuntimeCanonicalSignalCompatibilityConformance([adapterFailureInput], {
    adapter: failingAdapter,
    createdAt: '2026-08-04T12:00:00.000Z'
  });
  const partialBatch = conformance.runRuntimeCanonicalSignalCompatibilityConformance([
    fixtureInput(scenarioById('fixture-001-direct-market-context')),
    badInput,
    representativeInputs().at(-1)
  ], { createdAt: '2026-08-04T12:00:00.000Z' });

  assert.equal(invalidReport.invalidInputCount, 1);
  assert.equal(invalidReport.adapterValidationReadiness, 'remediation_required');
  assert.equal(failureReport.adapterFailureCount, 1);
  assert.equal(failureReport.perRecordResults[0].status, 'adapter_failure');
  assert.equal(partialBatch.totalRecords, 3);
  assert.equal(partialBatch.invalidInputCount, 1);
  assert.equal(partialBatch.insufficientEvidenceCount, 1);
  assert.equal(partialBatch.perRecordResults.find((record) => record.status === 'invalid_input').runtimeSignalId, 'unknown');
});

test('summarizes aggregate metrics and readiness deterministically', () => {
  const report = buildReport();
  const summary = conformance.summarizeRuntimeCanonicalSignalCompatibilityConformance(report);

  assert.deepEqual(summary.statusTotals, {
    conformant: 0,
    conformant_with_warnings: 27,
    partially_conformant: 0,
    non_conformant: 0,
    invalid_input: 0,
    adapter_failure: 0,
    insufficient_evidence: 1
  });
  assert.equal(summary.totalRecords, 28);
  assert.equal(summary.warningPreservationTotals.preserved, 28);
  assert.equal(summary.authorityFindings.preserved, 28);
  assert.equal(summary.deterministicReplayFindings.failed, 0);
  assert.equal(summary.adapterValidationReadiness, 'ready_for_additional_offline_validation');
});

test('does not import filesystem, network, runtime server, marketplace, service, or registration modules', () => {
  const modulePath = require.resolve('../validation/runtimeCanonicalSignalCompatibilityConformance');
  delete require.cache[modulePath];

  const prohibitedLoads = [];
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (
      ['fs', 'node:fs', 'http', 'node:http', 'https', 'node:https', 'net', 'node:net', 'child_process', 'node:child_process'].includes(request) ||
      request.includes('server') ||
      request.includes('marketplaces') ||
      request.includes('services')
    ) {
      prohibitedLoads.push(request);
    }
    return originalLoad.apply(this, arguments);
  };

  try {
    const fresh = require('../validation/runtimeCanonicalSignalCompatibilityConformance');
    fresh.runRuntimeCanonicalSignalCompatibilityConformance([fixtureInput(scenarioById('fixture-001-direct-market-context'))], {
      createdAt: '2026-08-04T12:00:00.000Z'
    });
  } finally {
    Module._load = originalLoad;
  }

  assert.deepEqual(prohibitedLoads, []);
});
