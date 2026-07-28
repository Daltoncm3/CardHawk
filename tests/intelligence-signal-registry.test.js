'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const registry = require('../validation/intelligenceSignalRegistry');

function definitionInput(overrides = {}) {
  return {
    signalName: 'valuation.production.point_estimate',
    signalVersion: '1.0.0',
    producer: 'marketValueEngine',
    producerVersion: '1.0.0',
    producerCategory: 'production_engine',
    signalType: 'valuation',
    decisionRole: 'supporting_context',
    authorityLevel: 'production_context',
    evidenceRole: 'supporting_evidence',
    expectedInputTypes: ['listing', 'comparables'],
    expectedOutputFields: ['estimatedValue', 'confidence'],
    confidenceSemantics: {
      scale: '0_100',
      meaning: 'reported production confidence'
    },
    uncertaintySemantics: {
      levels: ['low', 'moderate', 'high']
    },
    evidenceRequirements: {
      minimumTrueSoldCount: 3,
      activeListingsDoNotSatisfySoldMinimums: true
    },
    allowedStatuses: ['available', 'warning', 'blocked'],
    downstreamConsumers: ['Deal Gate', 'Production Intelligence Trace'],
    governanceRequirements: {
      wrapperFirst: true,
      productionAuthority: 'unchanged'
    },
    compatibilityNotes: ['wrap existing output without replacing it'],
    deprecationStatus: 'active',
    createdAt: '2026-07-27T21:00:00.000Z',
    metadata: {
      phase: '13.0D'
    },
    ...overrides
  };
}

function secondDefinition(overrides = {}) {
  return definitionInput({
    signalName: 'identity.parser.diagnostics',
    signalVersion: '1.0.0',
    producer: 'identityParserDiagnostics',
    producerCategory: 'offline_validation',
    signalType: 'identity',
    decisionRole: 'diagnostic_only',
    authorityLevel: 'offline_validation',
    evidenceRole: 'diagnostic_context',
    downstreamConsumers: ['Review Workspace'],
    ...overrides
  });
}

test('exports Intelligence Signal Registry public API and constants', () => {
  assert.equal(registry.INTELLIGENCE_SIGNAL_REGISTRY_SOURCE, 'intelligence_signal_registry');
  assert.equal(registry.INTELLIGENCE_SIGNAL_REGISTRY_SCHEMA_VERSION, '1.0.0');
  assert.equal(typeof registry.createSignalDefinition, 'function');
  assert.equal(typeof registry.validateSignalDefinition, 'function');
  assert.equal(typeof registry.createSignalRegistry, 'function');
  assert.equal(typeof registry.validateSignalRegistry, 'function');
  assert.equal(typeof registry.registerSignalDefinition, 'function');
  assert.equal(typeof registry.unregisterSignalDefinition, 'function');
  assert.equal(typeof registry.getSignalDefinition, 'function');
  assert.equal(typeof registry.listSignalDefinitions, 'function');
  assert.equal(typeof registry.filterSignalDefinitions, 'function');
  assert.equal(typeof registry.sortSignalDefinitions, 'function');
  assert.equal(typeof registry.summarizeSignalRegistry, 'function');
  assert.equal(typeof registry.exportSignalRegistry, 'function');
  assert.equal(typeof registry.importSignalRegistry, 'function');
  assert.equal(typeof registry.buildSignalDefinitionFingerprint, 'function');
  assert.equal(typeof registry.buildSignalRegistryFingerprint, 'function');
});

test('creates and validates a minimum signal definition with explicit unknown values', () => {
  const definition = registry.createSignalDefinition({}, {
    signalName: 'minimum.signal',
    createdAt: '2026-07-27T21:00:00.000Z'
  });
  const validation = registry.validateSignalDefinition(definition);

  assert.equal(definition.signalName, 'minimum.signal');
  assert.equal(definition.signalVersion, '1.0.0');
  assert.equal(definition.producer, 'unknown');
  assert.equal(definition.authorityLevel, 'advisory');
  assert.equal(definition.decisionRole, 'none');
  assert.equal(definition.productionImpact, 'none');
  assert.equal(definition.decisionImpact, 'none');
  assert.equal(definition.executionAuthority, 'none');
  assert.equal(definition.confidenceSemantics, 'unknown');
  assert.equal(Object.isFrozen(definition), true);
  assert.equal(validation.valid, true);
  assert.equal(validation.reasonCodes.includes('producer_unknown'), true);
});

test('creates complete deterministic definitions without mutating input', () => {
  const input = definitionInput();
  const before = JSON.parse(JSON.stringify(input));
  const first = registry.createSignalDefinition(input);
  const second = registry.createSignalDefinition(input);

  assert.deepEqual(input, before);
  assert.deepEqual(first, second);
  assert.equal(first.definitionFingerprint, registry.buildSignalDefinitionFingerprint(first));
  assert.equal(registry.validateSignalDefinition(first).valid, true);
});

test('creates an immutable registry with deterministic ordering and summaries', () => {
  const first = registry.createSignalDefinition(definitionInput());
  const second = registry.createSignalDefinition(secondDefinition());
  const signalRegistry = registry.createSignalRegistry({
    registryId: 'phase-13-signals',
    registryVersion: '1.0.0',
    createdAt: '2026-07-27T22:00:00.000Z',
    definitions: [second, first]
  });

  assert.equal(Object.isFrozen(signalRegistry), true);
  assert.deepEqual(signalRegistry.definitions.map((definition) => definition.signalName), [
    'identity.parser.diagnostics',
    'valuation.production.point_estimate'
  ]);
  assert.equal(signalRegistry.signalCount, 2);
  assert.equal(signalRegistry.producerSummary.marketValueEngine, 1);
  assert.equal(signalRegistry.categorySummary.identity, 1);
  assert.equal(signalRegistry.decisionRoleSummary.diagnostic_only, 1);
  assert.equal(signalRegistry.authoritySummary.production_context, 1);
  assert.equal(signalRegistry.deprecationSummary.active, 2);
  assert.equal(signalRegistry.registryFingerprint, registry.buildSignalRegistryFingerprint(signalRegistry));
  assert.equal(registry.validateSignalRegistry(signalRegistry).valid, true);
});

test('registration and removal return new registries without mutating originals', () => {
  const original = registry.createSignalRegistry({
    registryId: 'phase-13-signals',
    definitions: [definitionInput()]
  });
  const withSecond = registry.registerSignalDefinition(original, secondDefinition());
  const removed = registry.unregisterSignalDefinition(withSecond, 'valuation.production.point_estimate', '1.0.0');

  assert.notEqual(withSecond, original);
  assert.equal(original.signalCount, 1);
  assert.equal(withSecond.signalCount, 2);
  assert.equal(removed.signalCount, 1);
  assert.equal(registry.getSignalDefinition(removed, 'valuation.production.point_estimate', '1.0.0'), null);
  assert.equal(registry.getSignalDefinition(removed, 'identity.parser.diagnostics', '1.0.0').producer, 'identityParserDiagnostics');
});

test('lookup, filtering, and sorting return cloned deterministic results', () => {
  const signalRegistry = registry.createSignalRegistry({
    definitions: [definitionInput(), secondDefinition()]
  });
  const productionSignals = registry.filterSignalDefinitions(signalRegistry, {
    authorityLevel: 'production_context'
  });
  const sortedByProducer = registry.sortSignalDefinitions(signalRegistry.definitions, 'producer');
  const fetched = registry.getSignalDefinition(signalRegistry, 'valuation.production.point_estimate', '1.0.0');

  fetched.producer = 'mutated';
  assert.equal(productionSignals.length, 1);
  assert.equal(productionSignals[0].signalName, 'valuation.production.point_estimate');
  assert.deepEqual(sortedByProducer.map((definition) => definition.producer), [
    'identityParserDiagnostics',
    'marketValueEngine'
  ]);
  assert.equal(signalRegistry.definitions[1].producer, 'marketValueEngine');
});

test('validation detects duplicate definitions and stale registry fingerprints', () => {
  const definition = registry.createSignalDefinition(definitionInput());
  const signalRegistry = {
    ...registry.createSignalRegistry({
      definitions: [definition, definition]
    }),
    registryFingerprint: 'stale'
  };
  const validation = registry.validateSignalRegistry(signalRegistry);

  assert.equal(validation.valid, false);
  assert.deepEqual(validation.duplicateDefinitions, ['valuation.production.point_estimate@1.0.0']);
  assert.equal(validation.reasonCodes.includes('duplicate_signal_definition'), true);
  assert.equal(validation.reasonCodes.includes('registry_fingerprint_mismatch'), true);
  assert.equal(validation.fingerprintViolations.includes('registryFingerprint'), true);
});

test('validation rejects invalid enums, authority drift, missing required fields, and stale definition fingerprints', () => {
  const definition = registry.createSignalDefinition(definitionInput());
  const invalid = {
    ...definition,
    signalName: undefined,
    signalType: 'magic',
    evidenceRole: 'self_authorizing_evidence',
    productionImpact: 'changes',
    governanceFlags: {
      ...definition.governanceFlags,
      automaticStoreWriteAuthority: true
    },
    definitionFingerprint: 'stale'
  };
  const validation = registry.validateSignalDefinition(invalid);

  assert.equal(validation.valid, false);
  assert.equal(validation.missingRequiredFields.includes('signalName'), true);
  assert.equal(validation.reasonCodes.includes('invalid_enum_value'), true);
  assert.equal(validation.reasonCodes.includes('invalid_production_impact'), true);
  assert.equal(validation.reasonCodes.includes('invalid_governance_authority_flag'), true);
  assert.equal(validation.reasonCodes.includes('definition_fingerprint_mismatch'), true);
  assert.equal(validation.authorityViolations.includes('productionImpact'), true);
});

test('supports deprecation and valid supersession while preserving historical definitions', () => {
  const oldDefinition = registry.createSignalDefinition(definitionInput({
    signalName: 'valuation.range.legacy',
    deprecationStatus: 'superseded',
    supersededBySignalName: 'valuation.range.current'
  }));
  const currentDefinition = registry.createSignalDefinition(definitionInput({
    signalName: 'valuation.range.current',
    supersedesSignalName: 'valuation.range.legacy'
  }));
  const signalRegistry = registry.createSignalRegistry({
    definitions: [currentDefinition, oldDefinition]
  });
  const validation = registry.validateSignalRegistry(signalRegistry);
  const summary = registry.summarizeSignalRegistry(signalRegistry);

  assert.equal(validation.valid, true);
  assert.equal(validation.reasonCodes.includes('definition_not_active'), true);
  assert.equal(summary.activeSignals, 1);
  assert.equal(summary.deprecatedSignals, 1);
});

test('rejects self-supersession and circular supersession', () => {
  const selfSuperseding = registry.createSignalDefinition(definitionInput({
    signalName: 'identity.self',
    supersedesSignalName: 'identity.self'
  }));
  const selfValidation = registry.validateSignalDefinition(selfSuperseding);

  const first = registry.createSignalDefinition(definitionInput({
    signalName: 'identity.first',
    supersededBySignalName: 'identity.second'
  }));
  const second = registry.createSignalDefinition(definitionInput({
    signalName: 'identity.second',
    supersededBySignalName: 'identity.first'
  }));
  const signalRegistry = registry.createSignalRegistry({
    definitions: [first, second]
  });
  const registryValidation = registry.validateSignalRegistry(signalRegistry);

  assert.equal(selfValidation.valid, false);
  assert.equal(selfValidation.reasonCodes.includes('self_supersession'), true);
  assert.equal(registryValidation.valid, false);
  assert.equal(registryValidation.reasonCodes.includes('circular_supersession'), true);
});

test('export and import preserve registry validation and fingerprints', () => {
  const signalRegistry = registry.createSignalRegistry({
    registryId: 'phase-13-signals',
    definitions: [definitionInput(), secondDefinition()]
  });
  const exported = registry.exportSignalRegistry(signalRegistry);
  const imported = registry.importSignalRegistry(exported);

  assert.deepEqual(imported, signalRegistry);
  assert.equal(registry.validateSignalRegistry(imported).valid, true);
  assert.equal(imported.registryFingerprint, registry.buildSignalRegistryFingerprint(imported));
});

test('module does not execute engines or import production runtime modules', () => {
  const originalLoad = Module._load;
  const loaded = [];
  Module._load = function patchedLoad(request, parent, isMain) {
    loaded.push(request);
    if (request.includes('server') || request.includes('scoutScanner') || request.includes('../engines/') || request.startsWith('../engines')) {
      throw new Error(`Unexpected production import: ${request}`);
    }
    return originalLoad.apply(this, arguments);
  };

  try {
    delete require.cache[require.resolve('../validation/intelligenceSignalRegistry')];
    const fresh = require('../validation/intelligenceSignalRegistry');
    assert.equal(typeof fresh.createSignalRegistry, 'function');
    const signalRegistry = fresh.createSignalRegistry({
      definitions: [definitionInput()]
    });
    assert.equal(signalRegistry.signalCount, 1);
  } finally {
    Module._load = originalLoad;
    delete require.cache[require.resolve('../validation/intelligenceSignalRegistry')];
    require('../validation/intelligenceSignalRegistry');
  }

  assert.equal(loaded.some((request) => request.includes('server')), false);
});
