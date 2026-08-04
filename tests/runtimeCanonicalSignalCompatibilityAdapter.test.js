'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const adapter = require('../validation/runtimeCanonicalSignalCompatibilityAdapter');
const fixtures = require('../validation/fixtures/runtimeCanonicalSignalCompatibilityFixtures.json');

function fixtureInput(scenario, overrides = {}) {
  return {
    ...scenario.runtimeInput,
    fixtureScenarioId: scenario.id,
    expectedMappingClassification: scenario.classification,
    expectedCompatibility: scenario.expectedCompatibility,
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

test('exports Runtime-to-Canonical Signal Compatibility Adapter public API and constants', () => {
  assert.equal(adapter.SOURCE, 'runtime_canonical_signal_compatibility_adapter');
  assert.equal(adapter.VERSION, '1.0.0');
  assert.equal(adapter.SCHEMA_VERSION, '1.0.0');
  assert.deepEqual(Object.values(adapter.COMPATIBILITY_CLASSIFICATIONS), [
    'DIRECT',
    'DERIVED',
    'CONDITIONAL',
    'ONE_WAY_ONLY',
    'INTENTIONALLY_UNMAPPED',
    'INCOMPATIBLE',
    'LEGACY_ALIAS'
  ]);
  assert.equal(typeof adapter.adaptRuntimeSignalToCanonical, 'function');
  assert.equal(typeof adapter.adaptRuntimeSignalsToCanonicalBatch, 'function');
  assert.equal(typeof adapter.validateRuntimeSignalCompatibilityInput, 'function');
  assert.equal(typeof adapter.validateRuntimeSignalCompatibilityOutput, 'function');
  assert.equal(typeof adapter.summarizeRuntimeSignalCompatibility, 'function');
  assert.equal(typeof adapter.buildRuntimeSignalCompatibilityFingerprint, 'function');
});

test('processes all Phase 18.1C fixture scenarios without weakening fixture expectations', () => {
  assert.equal(fixtures.scenarios.length, 14);

  for (const scenario of fixtures.scenarios) {
    const adapted = adapter.adaptRuntimeSignalToCanonical(fixtureInput(scenario));
    const expected = scenario.expectedCompatibility;

    assert.equal(adapted.runtimeSignalId, scenario.runtimeInput.runtimeSignalId, scenario.id);
    assert.equal(adapted.mappingClassification, scenario.classification, scenario.id);
    assert.equal(adapted.productionImpact, 'none', scenario.id);
    assert.equal(adapted.decisionImpact, 'none', scenario.id);
    assert.equal(adapted.executionAuthority, 'none', scenario.id);
    assert.equal(adapted.nativeOutputPreserved, true, scenario.id);
    assert.equal(adapted.nativeInputPreservation.preserved, true, scenario.id);
    assert.equal(adapted.validation.authorityViolations.length, 0, scenario.id);
    assert.equal(adapted.compatibilityFingerprint, adapter.buildRuntimeSignalCompatibilityFingerprint(adapted), scenario.id);

    for (const reasonCode of expected.reasonCodes) {
      assert.equal(adapted.expectedReasonCodes.includes(reasonCode), true, `${scenario.id} missing ${reasonCode}`);
    }

    if (expected.mustReject) {
      assert.equal(adapted.transformationOutcome, 'rejected', scenario.id);
      assert.equal(adapted.validation.valid, false, scenario.id);
      assert.equal(adapted.inputValidation.reasonCodes.includes('prohibited_authority_mapping'), true, scenario.id);
    }

    if (expected.preserveRawOutput || expected.preserveDealGateRawOutput || expected.preserveRuntimeConfidence) {
      assert.deepEqual(adapted.runtimeInput.runtimeRawValue, scenario.runtimeInput.runtimeRawValue, scenario.id);
    }

    if (expected.productionImpact) assert.equal(adapted.authorityPreservation.productionImpact, expected.productionImpact, scenario.id);
    if (expected.decisionImpact) assert.equal(adapted.authorityPreservation.decisionImpact, expected.decisionImpact, scenario.id);
    if (expected.executionAuthority) assert.equal(adapted.authorityPreservation.executionAuthority, expected.executionAuthority, scenario.id);
  }
});

test('creates deterministic output and stable fingerprints for identical input and options', () => {
  const scenario = scenarioById('fixture-001-direct-market-context');
  const input = fixtureInput(scenario, { adapterRunId: 'deterministic-run' });
  const options = { createdAt: '2026-08-04T12:00:00.000Z' };
  const first = adapter.adaptRuntimeSignalToCanonical(input, options);
  const second = adapter.adaptRuntimeSignalToCanonical(input, options);

  assert.deepEqual(first, second);
  assert.equal(first.compatibilityFingerprint, second.compatibilityFingerprint);
  assert.equal(first.validation.valid, true);
});

test('preserves input immutability and native values including zero, false, and null', () => {
  const scenario = scenarioById('fixture-011-missing-confidence');
  const input = fixtureInput(scenario);
  const before = JSON.parse(JSON.stringify(input));
  const adapted = adapter.adaptRuntimeSignalToCanonical(input);

  assert.deepEqual(input, before);
  assert.equal(Object.isFrozen(adapted), true);
  assert.equal(adapted.runtimeInput.runtimeRawValue, null);
  assert.equal(adapted.nullHandling.rawNullPreserved, true);
  assert.equal(adapted.confidencePreservation.value, 'unknown');
  assert.equal(adapted.confidencePreservation.recommendationAuthorityCreated, false);
});

test('preserves warning, conflict, blocker, and severity details without suppressing unknown codes', () => {
  const scenario = scenarioById('fixture-008-warning-bearing-decision-intelligence');
  const adapted = adapter.adaptRuntimeSignalToCanonical(fixtureInput(scenario, {
    runtimeRawValue: {
      ...scenario.runtimeInput.runtimeRawValue,
      qualityWarnings: [{ message: 'Ungraded condition warning', severity: 'high' }]
    }
  }));

  assert.equal(adapted.warningPreservation.status, 'preserved');
  assert.equal(adapted.warningPreservation.count, 3);
  assert.equal(adapted.warningPreservation.warnings[0].sourceField, 'qualityWarnings');
  assert.equal(adapted.warningPreservation.warnings[0].severity, 'high');
  assert.equal(adapted.warningPreservation.unknownWarningCodes.includes('qualityWarnings'), true);
  assert.equal(adapted.canonicalSignal.warnings.includes('Comparable support is thin'), true);
});

test('preserves readiness as contextual only and prevents readiness upgrades', () => {
  const supported = adapter.adaptRuntimeSignalToCanonical(fixtureInput(scenarioById('fixture-014-prohibited-authority-escalation')));
  const missing = adapter.adaptRuntimeSignalToCanonical(fixtureInput(scenarioById('fixture-012-missing-readiness')));

  assert.equal(supported.readinessPreservation.value, 'supported_context');
  assert.equal(supported.readinessPreservation.upgraded, false);
  assert.equal(supported.readinessPreservation.dealGateApprovalCreated, false);
  assert.equal(supported.authorityPreservation.notBuyNowEligible, true);
  assert.equal(missing.readinessPreservation.value, 'unknown');
  assert.equal(missing.readinessPreservation.status, 'missing');
});

test('preserves confidence semantics without inventing valuation or recommendation authority', () => {
  const direct = adapter.adaptRuntimeSignalToCanonical(fixtureInput(scenarioById('fixture-001-direct-market-context')));
  const missing = adapter.adaptRuntimeSignalToCanonical(fixtureInput(scenarioById('fixture-011-missing-confidence')));
  const prohibited = adapter.adaptRuntimeSignalToCanonical(fixtureInput(scenarioById('fixture-014-prohibited-authority-escalation')));

  assert.equal(direct.confidencePreservation.value, 82);
  assert.equal(direct.confidencePreservation.valuationConfidenceCreated, false);
  assert.equal(direct.confidencePreservation.recommendationAuthorityCreated, false);
  assert.equal(missing.confidencePreservation.value, 'unknown');
  assert.equal(prohibited.confidencePreservation.value, 95);
  assert.equal(prohibited.transformationOutcome, 'rejected');
});

test('handles unsupported and unknown schema versions without treating schemas as equivalent', () => {
  const unknown = adapter.adaptRuntimeSignalToCanonical(fixtureInput(scenarioById('fixture-013-unknown-source-version')));
  const unsupportedInput = fixtureInput(scenarioById('fixture-001-direct-market-context'), {
    runtimeSignalContract: {
      ...scenarioById('fixture-001-direct-market-context').runtimeInput.runtimeSignalContract,
      schemaVersion: '2.0.0'
    }
  });
  const unsupported = adapter.adaptRuntimeSignalToCanonical(unsupportedInput);

  assert.equal(unknown.schemaVersionHandling.status, 'unknown');
  assert.equal(unknown.inputValidation.reasonCodes.includes('unknown_source_version_preserved'), true);
  assert.equal(unknown.schemaVersionHandling.equivalentSchemas, false);
  assert.equal(unsupported.schemaVersionHandling.status, 'unsupported');
  assert.equal(unsupported.inputValidation.reasonCodes.includes('unsupported_source_version'), true);
});

test('preserves intentionally unmapped, incompatible, conditional, derived, and legacy alias behavior', () => {
  const intentionallyUnmapped = adapter.adaptRuntimeSignalToCanonical(fixtureInput(scenarioById('fixture-006-intentionally-unmapped-display-language')));
  const incompatible = adapter.adaptRuntimeSignalToCanonical(fixtureInput(scenarioById('fixture-007-incompatible-fallback-policy')));
  const conditional = adapter.adaptRuntimeSignalToCanonical(fixtureInput(scenarioById('fixture-003-conditional-sold-evidence-count')));
  const derived = adapter.adaptRuntimeSignalToCanonical(fixtureInput(scenarioById('fixture-002-derived-owner-producer')));
  const legacy = adapter.adaptRuntimeSignalToCanonical(fixtureInput(scenarioById('fixture-005-legacy-alias-deal-grade')));

  assert.equal(intentionallyUnmapped.transformationOutcome, 'withheld');
  assert.equal(intentionallyUnmapped.canonicalSignal, null);
  assert.equal(intentionallyUnmapped.unmappedFields.includes('runtimeSignalContract.allowedDisplayLanguage'), true);
  assert.equal(incompatible.transformationOutcome, 'withheld');
  assert.equal(incompatible.canonicalSignal, null);
  assert.equal(incompatible.incompatibleFields.includes('runtimeSignalContract.allowsFallbackEvidence'), true);
  assert.equal(conditional.canonicalSignal.evidenceBasis.trueSoldCount, 5);
  assert.equal(derived.canonicalSignal.producer.name, 'qualityEngine.evaluateQuality');
  assert.equal(legacy.mappingClassification, 'LEGACY_ALIAS');
  assert.equal(legacy.canonicalSignal.metadata.compatibilityClassification, 'LEGACY_ALIAS');
});

test('rejects prohibited authority mappings and never creates BUY_NOW authority or Deal Gate bypass', () => {
  const adapted = adapter.adaptRuntimeSignalToCanonical(fixtureInput(scenarioById('fixture-014-prohibited-authority-escalation')));

  assert.equal(adapted.transformationOutcome, 'rejected');
  assert.equal(adapted.canonicalSignal, null);
  assert.equal(adapted.authorityPreservation.status, 'blocked');
  assert.equal(adapted.authorityPreservation.notDealGateEligible, true);
  assert.equal(adapted.authorityPreservation.notBuyNowEligible, true);
  assert.equal(adapted.authorityPreservation.notNotificationEligible, true);
  assert.equal(adapted.productionImpact, 'none');
  assert.equal(adapted.decisionImpact, 'none');
  assert.equal(adapted.executionAuthority, 'none');
  assert.equal(adapted.inputValidation.reasonCodes.includes('prohibited_authority_mapping'), true);
});

test('invalid input fails closed with explicit validation errors', () => {
  const adapted = adapter.adaptRuntimeSignalToCanonical({
    runtimeSignalContract: {},
    runtimeRawValue: {}
  });
  const inputValidation = adapter.validateRuntimeSignalCompatibilityInput({});

  assert.equal(adapted.transformationOutcome, 'invalid_input');
  assert.equal(adapted.validation.valid, false);
  assert.equal(adapted.productionImpact, 'none');
  assert.equal(adapted.decisionImpact, 'none');
  assert.equal(adapted.executionAuthority, 'none');
  assert.equal(inputValidation.valid, false);
  assert.equal(inputValidation.reasonCodes.includes('missing_runtime_signal_id'), true);
});

test('batch adaptation preserves partial success, deterministic ordering, summaries, and fingerprints', () => {
  const inputs = [
    fixtureInput(scenarioById('fixture-014-prohibited-authority-escalation')),
    fixtureInput(scenarioById('fixture-001-direct-market-context')),
    fixtureInput(scenarioById('fixture-005-legacy-alias-deal-grade'))
  ];
  const first = adapter.adaptRuntimeSignalsToCanonicalBatch(inputs, {
    adapterRunId: 'phase-18.1d-batch',
    createdAt: '2026-08-04T12:00:00.000Z'
  });
  const second = adapter.adaptRuntimeSignalsToCanonicalBatch([...inputs].reverse(), {
    adapterRunId: 'phase-18.1d-batch',
    createdAt: '2026-08-04T12:00:00.000Z'
  });

  assert.deepEqual(first, second);
  assert.deepEqual(first.records.map((record) => record.runtimeSignalId), [
    'deal_grade',
    'decision_intelligence',
    'market_confidence'
  ]);
  assert.equal(first.summary.recordCount, 3);
  assert.equal(first.summary.classificationSummary.DIRECT, 1);
  assert.equal(first.summary.classificationSummary.INCOMPATIBLE, 1);
  assert.equal(first.summary.classificationSummary.LEGACY_ALIAS, 1);
  assert.equal(first.summary.authorityViolationCount, 0);
  assert.equal(first.batchFingerprint, adapter.buildRuntimeSignalCompatibilityFingerprint(first));
});

test('module does not import runtime, persistence, network, notification, marketplace, scanner, or engine modules', () => {
  const loaded = new Set();
  const originalLoad = Module._load;
  Module._load = function trackingLoad(request, parent, isMain) {
    loaded.add(request);
    return originalLoad.apply(this, arguments);
  };

  delete require.cache[require.resolve('../validation/runtimeCanonicalSignalCompatibilityAdapter')];
  require('../validation/runtimeCanonicalSignalCompatibilityAdapter');
  Module._load = originalLoad;

  const requests = [...loaded];
  assert.equal(requests.some((request) => request.includes('server')), false);
  assert.equal(requests.some((request) => request.includes('scoutScannerService')), false);
  assert.equal(requests.some((request) => request.includes('engines/')), false);
  assert.equal(requests.some((request) => request.includes('marketplaces/')), false);
  assert.equal(requests.some((request) => request.includes('notification')), false);
  assert.equal(requests.some((request) => request === 'fs' || request === 'node:fs'), false);
  assert.equal(requests.some((request) => ['http', 'https', 'net', 'node:http', 'node:https', 'node:net'].includes(request)), false);
});
