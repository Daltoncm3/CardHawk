'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const contract = require('../validation/signalMigrationAdapterContract');

function declarativeMapping(overrides = {}) {
  return {
    kind: 'declarative',
    sourceFields: ['native.score'],
    targetFields: ['normalizedOutput.score'],
    semantics: 'preserve_native_score',
    notes: ['wrapper only'],
    ...overrides
  };
}

function completeAdapter(overrides = {}) {
  return contract.createSignalMigrationAdapter({
    adapterId: 'listing-quality-diagnostics-adapter',
    adapterVersion: '1.0.0',
    engineName: 'listingQualityGradingDiagnostics',
    supportedEngineVersions: ['1.0.0', '1.1.0'],
    signalName: 'listing_quality_and_grading_diagnostic',
    signalVersion: '1.0.0',
    producer: 'listingQualityGradingDiagnostics',
    producerVersion: '1.0.0',
    producerCategory: 'offline_validation',
    signalType: 'diagnostic',
    decisionRole: 'diagnostic_only',
    authorityLevel: 'offline_validation',
    evidenceRole: 'diagnostic_context',
    nativeOutputAliases: ['listingQualityGradingDiagnostic'],
    nativeVersionAliases: ['v1'],
    requiredNativeFields: ['listingQualityStatus', 'gradingDiagnosticStatus', 'riskLevel'],
    optionalNativeFields: ['warnings', 'blockingIssues'],
    evidenceMapping: declarativeMapping({
      sourceFields: ['gradingSupportSummary', 'confirmedAttributes'],
      targetFields: ['evidenceBasis', 'evidenceReferences'],
      semantics: 'preserve_listing_quality_evidence'
    }),
    confidenceMapping: declarativeMapping({
      sourceFields: ['riskLevel'],
      targetFields: ['confidenceLevel'],
      semantics: 'preserve_reported_confidence_context'
    }),
    uncertaintyMapping: declarativeMapping({
      sourceFields: ['riskLevel', 'ambiguousAttributes'],
      targetFields: ['uncertainty'],
      semantics: 'preserve_native_uncertainty_context'
    }),
    statusMapping: declarativeMapping({
      sourceFields: ['listingQualityStatus', 'gradingDiagnosticStatus'],
      targetFields: ['normalizedOutput.status'],
      semantics: 'preserve_native_statuses'
    }),
    metadataMapping: declarativeMapping({
      sourceFields: ['listingHistoryContext'],
      targetFields: ['producerMetadata'],
      semantics: 'preserve_observational_metadata'
    }),
    normalizedOutputMapping: declarativeMapping({
      sourceFields: ['listingQualityStatus', 'gradingDiagnosticStatus', 'riskLevel'],
      targetFields: ['normalizedOutput'],
      semantics: 'wrap_without_recomputation'
    }),
    semanticParityRules: [
      {
        ruleId: 'native-fields-preserved',
        kind: 'declarative',
        nativeFields: ['listingQualityStatus', 'gradingDiagnosticStatus', 'riskLevel'],
        shadowFields: ['canonicalSignal.rawOutput'],
        comparison: 'deep_equal'
      }
    ],
    mismatchReasonCodes: ['changed_native_value', 'missing_wrapper_field'],
    compatibilityNotes: ['offline shadow migration only'],
    createdAt: '2026-07-28T22:00:00.000Z',
    ...overrides
  });
}

test('exports Signal Migration Adapter Contract public API and constants', () => {
  assert.equal(contract.SIGNAL_MIGRATION_ADAPTER_SOURCE, 'signal_migration_adapter_contract');
  assert.equal(contract.SIGNAL_MIGRATION_ADAPTER_SCHEMA_VERSION, '1.0.0');
  assert.deepEqual(contract.COMPATIBILITY_STATUSES, [
    'compatible',
    'compatible_with_warnings',
    'engine_version_unsupported',
    'signal_version_unsupported',
    'incomplete',
    'blocked',
    'invalid'
  ]);
  assert.equal(typeof contract.createSignalMigrationAdapter, 'function');
  assert.equal(typeof contract.validateSignalMigrationAdapter, 'function');
  assert.equal(typeof contract.cloneSignalMigrationAdapter, 'function');
  assert.equal(typeof contract.buildSignalMigrationAdapterFingerprint, 'function');
  assert.equal(typeof contract.determineAdapterCompatibility, 'function');
});

test('creates a minimum immutable adapter with explicit unknown values', () => {
  const adapter = contract.createSignalMigrationAdapter({
    adapterId: 'minimum-adapter',
    createdAt: 'unknown'
  });
  const validation = contract.validateSignalMigrationAdapter(adapter);

  assert.equal(Object.isFrozen(adapter), true);
  assert.equal(validation.valid, true);
  assert.equal(adapter.engineName, 'unknown');
  assert.equal(adapter.signalName, 'unknown');
  assert.equal(adapter.evidenceMapping.kind, 'unknown');
  assert.equal(adapter.productionImpact, 'none');
  assert.equal(adapter.decisionImpact, 'none');
  assert.equal(adapter.executionAuthority, 'none');
  assert.equal(contract.determineAdapterCompatibility(adapter).status, 'incomplete');
});

test('creates a complete deterministic adapter without mutating input', () => {
  const input = {
    adapterId: 'complete-adapter',
    engineName: 'gradePremiumEngine',
    supportedEngineVersions: ['1.0.0'],
    signalName: 'grade_premium',
    signalVersion: '1.0.0',
    evidenceMapping: declarativeMapping(),
    confidenceMapping: declarativeMapping(),
    uncertaintyMapping: declarativeMapping(),
    statusMapping: declarativeMapping(),
    metadataMapping: declarativeMapping(),
    normalizedOutputMapping: declarativeMapping(),
    semanticParityRules: [{ ruleId: 'preserve', comparison: 'deep_equal' }],
    mismatchReasonCodes: ['changed_native_value'],
    createdAt: '2026-07-28T22:01:00.000Z'
  };
  const before = JSON.parse(JSON.stringify(input));
  const first = contract.createSignalMigrationAdapter(input);
  const second = contract.createSignalMigrationAdapter(input);

  assert.deepEqual(input, before);
  assert.deepEqual(first, second);
  assert.equal(contract.validateSignalMigrationAdapter(first).valid, true);
  assert.equal(first.adapterFingerprint, contract.buildSignalMigrationAdapterFingerprint(first));
});

test('cloneSignalMigrationAdapter returns an independent copy', () => {
  const adapter = completeAdapter();
  const cloned = contract.cloneSignalMigrationAdapter(adapter);

  cloned.engineName = 'changed';
  cloned.evidenceMapping.details.extra = true;

  assert.equal(adapter.engineName, 'listingQualityGradingDiagnostics');
  assert.equal(adapter.evidenceMapping.details.extra, undefined);
  assert.equal(cloned.engineName, 'changed');
});

test('determines compatible engine and signal versions', () => {
  const adapter = completeAdapter();
  const compatibility = contract.determineAdapterCompatibility(adapter, {
    engineVersion: '1.1.0',
    signalVersion: '1.0.0'
  });

  assert.equal(compatibility.status, 'compatible');
  assert.deepEqual(compatibility.reasonCodes, []);
});

test('reports unsupported engine version deterministically', () => {
  const adapter = completeAdapter();
  const compatibility = contract.determineAdapterCompatibility(adapter, {
    engineVersion: '2.0.0',
    signalVersion: '1.0.0'
  });

  assert.equal(compatibility.status, 'engine_version_unsupported');
  assert.equal(compatibility.reasonCodes.includes('engine_version_unsupported'), true);
  assert.deepEqual(compatibility.compatibilityViolations, ['engineVersion']);
});

test('reports unsupported signal version deterministically', () => {
  const adapter = completeAdapter();
  const compatibility = contract.determineAdapterCompatibility(adapter, {
    engineVersion: '1.0.0',
    signalVersion: '2.0.0'
  });

  assert.equal(compatibility.status, 'signal_version_unsupported');
  assert.equal(compatibility.reasonCodes.includes('signal_version_unsupported'), true);
  assert.deepEqual(compatibility.compatibilityViolations, ['signalVersion']);
});

test('missing mappings remain explicit and produce incomplete compatibility', () => {
  const adapter = contract.createSignalMigrationAdapter({
    adapterId: 'missing-mappings',
    engineName: 'populationIntelligenceEngine',
    supportedEngineVersions: ['1.0.0'],
    signalName: 'population_intelligence',
    signalVersion: '1.0.0',
    createdAt: '2026-07-28T22:02:00.000Z'
  });
  const validation = contract.validateSignalMigrationAdapter(adapter);
  const compatibility = contract.determineAdapterCompatibility(adapter, {
    engineVersion: '1.0.0',
    signalVersion: '1.0.0'
  });

  assert.equal(validation.valid, true);
  assert.equal(validation.mappingViolations.includes('evidenceMapping'), true);
  assert.equal(validation.reasonCodes.includes('missing_semantic_mapping'), true);
  assert.equal(compatibility.status, 'incomplete');
});

test('validates declarative mappings and approved local handler references', () => {
  const adapter = completeAdapter({
    confidenceMapping: {
      kind: 'approved_handler',
      sourceFields: ['confidence'],
      targetFields: ['confidenceLevel'],
      handlerRef: 'validation/listingQualitySignalMigration#mapConfidence',
      semantics: 'approved local handler'
    }
  });

  assert.equal(contract.validateSignalMigrationAdapter(adapter).valid, true);
});

test('rejects executable and unapproved mapping definitions without executing them', () => {
  let executed = false;
  const adapter = completeAdapter({
    evidenceMapping: {
      kind: 'approved_handler',
      sourceFields: ['evidence'],
      targetFields: ['evidenceBasis'],
      handlerRef: 'http://example.test/run-me',
      semantics: 'unapproved',
      details: {
        mapper() {
          executed = true;
        }
      }
    }
  });
  const validation = contract.validateSignalMigrationAdapter(adapter);
  const tampered = {
    ...completeAdapter(),
    evidenceMapping: {
      ...completeAdapter().evidenceMapping,
      details: {
        mapper() {
          executed = true;
        }
      }
    }
  };
  const executableValidation = contract.validateSignalMigrationAdapter(tampered);

  assert.equal(executed, false);
  assert.equal(validation.valid, false);
  assert.equal(validation.reasonCodes.includes('invalid_handler_reference'), true);
  assert.equal(executableValidation.valid, false);
  assert.equal(executableValidation.reasonCodes.includes('executable_mapping_not_allowed'), true);
});

test('enforces authority boundaries', () => {
  const adapter = completeAdapter();
  const tampered = {
    ...adapter,
    productionImpact: 'changes_production',
    decisionImpact: 'changes_decision',
    executionAuthority: 'may_execute'
  };
  const validation = contract.validateSignalMigrationAdapter(tampered);
  const compatibility = contract.determineAdapterCompatibility(tampered, {
    engineVersion: '1.0.0',
    signalVersion: '1.0.0'
  });

  assert.equal(validation.valid, false);
  assert.deepEqual(validation.authorityViolations, ['decisionImpact', 'executionAuthority', 'productionImpact']);
  assert.equal(compatibility.status, 'blocked');
});

test('supports valid supersession and rejects self or circular supersession', () => {
  const valid = completeAdapter({
    adapterId: 'listing-quality-diagnostics-adapter-v2',
    supersedesAdapterId: 'listing-quality-diagnostics-adapter-v1'
  });
  const self = completeAdapter({
    adapterId: 'self-adapter',
    supersedesAdapterId: 'self-adapter'
  });
  const circular = completeAdapter({
    adapterId: 'middle-adapter',
    supersedesAdapterId: 'other-adapter',
    supersededByAdapterId: 'other-adapter'
  });

  assert.equal(contract.validateSignalMigrationAdapter(valid).valid, true);
  assert.equal(contract.validateSignalMigrationAdapter(self).reasonCodes.includes('self_supersession'), true);
  assert.equal(contract.validateSignalMigrationAdapter(circular).reasonCodes.includes('circular_supersession'), true);
});

test('validation reports stale fingerprints', () => {
  const adapter = completeAdapter();
  const tampered = {
    ...adapter,
    signalName: 'changed_signal_name'
  };
  const validation = contract.validateSignalMigrationAdapter(tampered);

  assert.equal(validation.valid, false);
  assert.equal(validation.fingerprintViolations.includes('adapterFingerprint'), true);
  assert.equal(validation.reasonCodes.includes('adapter_fingerprint_mismatch'), true);
});

test('module does not import runtime, scanner, engine, or existing migration modules', () => {
  const loaded = new Set();
  const originalLoad = Module._load;
  Module._load = function trackingLoad(request, parent, isMain) {
    loaded.add(request);
    return originalLoad.apply(this, arguments);
  };

  delete require.cache[require.resolve('../validation/signalMigrationAdapterContract')];
  require('../validation/signalMigrationAdapterContract');
  Module._load = originalLoad;

  assert.equal([...loaded].some((request) => request.includes('server')), false);
  assert.equal([...loaded].some((request) => request.includes('scoutScannerService')), false);
  assert.equal([...loaded].some((request) => request.includes('engines/')), false);
  assert.equal([...loaded].some((request) => request.includes('SignalMigration') && !request.includes('CoreContract')), false);
  assert.equal([...loaded].some((request) => request.includes('gradePremiumSignalMigration')), false);
  assert.equal([...loaded].some((request) => request.includes('populationSignalMigration')), false);
  assert.equal([...loaded].some((request) => request.includes('listingQualitySignalMigration')), false);
});
