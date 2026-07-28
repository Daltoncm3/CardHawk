'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const alignment = require('../validation/signalAlignmentContract');
const signalContract = require('../validation/canonicalIntelligenceSignalContract');
const registry = require('../validation/intelligenceSignalRegistry');

function signalDefinition(overrides = {}) {
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
    expectedOutputFields: ['diagnosticStatus', 'ambiguityLevel', 'warnings'],
    confidenceSemantics: { kind: 'not_applicable' },
    uncertaintySemantics: { fieldLevel: true },
    evidenceRequirements: { nativeOutputRequired: true },
    allowedStatuses: ['exact', 'partial', 'ambiguous', 'blocked'],
    downstreamConsumers: ['realListingDecisionReviewContract'],
    governanceRequirements: { authorityBoundary: 'advisory_only' },
    compatibilityNotes: ['offline diagnostic wrapper only'],
    createdAt: '2026-07-27T22:00:00.000Z',
    ...overrides
  });
}

function canonicalSignal(overrides = {}) {
  return signalContract.createCanonicalSignal({
    signalId: 'identity-parser-diagnostics:listing-1',
    signalName: 'identity.parser.diagnostics',
    producer: {
      producerId: 'identityParserDiagnostics',
      name: 'identityParserDiagnostics',
      module: 'validation/identityParserDiagnostics.js',
      functionName: 'buildIdentityParserDiagnostics',
      version: '1.0.0',
      category: 'offline_validation'
    },
    producerVersion: '1.0.0',
    producerCategory: 'offline_validation',
    createdAt: '2026-07-27T22:01:00.000Z',
    signalType: 'identity',
    decisionRole: 'diagnostic_only',
    authorityLevel: 'offline_validation',
    confidence: {
      kind: 'not_applicable',
      value: 'unknown',
      scale: 'unknown',
      basis: 'identity_diagnostic_status',
      calibrated: false
    },
    confidenceLevel: 'not_applicable',
    uncertainty: {
      level: 'moderate',
      reasonCodes: ['title_only_inference']
    },
    evidenceBasis: {
      trueSoldCount: 'unknown',
      activeListingCount: 'unknown',
      fallbackUsed: false,
      staleCount: 'unknown',
      rejectedCount: 'unknown',
      transactionIneligibleCount: 'unknown',
      sourceConcentration: 'unknown',
      asOf: '2026-07-27T22:00:00.000Z'
    },
    evidenceQuality: {
      level: 'not_applicable',
      score: 'unknown',
      basis: 'identity_diagnostic'
    },
    rawOutput: {
      diagnosticStatus: 'partial',
      ambiguityLevel: 'moderate',
      warnings: ['grade_number_missing'],
      zeroPreserved: 0,
      falsePreserved: false
    },
    normalizedOutput: {
      status: 'partial',
      ambiguityLevel: 'moderate'
    },
    warnings: ['grade_number_missing'],
    blockers: [],
    sourceFingerprint: 'native-output-fingerprint-1',
    ...overrides
  });
}

function registryReference(definition = signalDefinition()) {
  const signalRegistry = registry.createSignalRegistry({
    registryId: 'phase-13-signals',
    registryVersion: '1.0.0',
    createdAt: '2026-07-27T22:00:00.000Z',
    definitions: [definition]
  });
  return {
    registry: signalRegistry,
    registryId: signalRegistry.registryId,
    registryFingerprint: signalRegistry.registryFingerprint,
    signalDefinition: definition
  };
}

test('exports Signal Alignment Contract public API and constants', () => {
  assert.equal(alignment.SIGNAL_ALIGNMENT_SOURCE, 'signal_alignment_contract');
  assert.equal(alignment.SIGNAL_ALIGNMENT_SCHEMA_VERSION, '1.0.0');
  assert.equal(typeof alignment.createSignalAlignment, 'function');
  assert.equal(typeof alignment.validateSignalAlignment, 'function');
  assert.equal(typeof alignment.cloneSignalAlignment, 'function');
  assert.equal(typeof alignment.attachRegistryReference, 'function');
  assert.equal(typeof alignment.attachCanonicalSignal, 'function');
  assert.equal(typeof alignment.determineAlignmentStatus, 'function');
  assert.equal(typeof alignment.determineAuthorityAlignment, 'function');
  assert.equal(typeof alignment.buildSignalAlignmentFingerprint, 'function');
  assert.equal(typeof alignment.buildSignalAlignmentBatchFingerprint, 'function');
});

test('creates a minimum immutable alignment with explicit unknown values', () => {
  const result = alignment.createSignalAlignment({}, {
    alignmentId: 'minimum-alignment',
    createdAt: '2026-07-27T22:05:00.000Z'
  });
  const validation = alignment.validateSignalAlignment(result);

  assert.equal(result.alignmentId, 'minimum-alignment');
  assert.equal(result.producer, 'unknown');
  assert.equal(result.signalDefinition, 'unknown');
  assert.equal(result.canonicalSignal, 'unknown');
  assert.equal(result.alignmentStatus, 'definition_missing');
  assert.equal(result.productionImpact, 'none');
  assert.equal(result.decisionImpact, 'none');
  assert.equal(result.executionAuthority, 'none');
  assert.equal(Object.isFrozen(result), true);
  assert.equal(validation.valid, true);
  assert.equal(validation.reasonCodes.includes('alignment_status_drift'), false);
});

test('creates a complete deterministic alignment without mutating source artifacts', () => {
  const definition = signalDefinition();
  const signal = canonicalSignal();
  const sourceDefinition = JSON.parse(JSON.stringify(definition));
  const sourceSignal = JSON.parse(JSON.stringify(signal));
  const ref = registryReference(definition);
  const first = alignment.createSignalAlignment({
    alignmentId: 'alignment-1',
    createdAt: '2026-07-27T22:05:00.000Z',
    producer: 'identityParserDiagnostics',
    producerVersion: '1.0.0',
    sourceOutputFingerprint: 'native-output-fingerprint-1',
    registryId: ref.registryId,
    registryFingerprint: ref.registryFingerprint,
    signalDefinition: definition,
    canonicalSignal: signal,
    confidenceAlignment: {
      status: 'aligned',
      confidenceKind: 'not_applicable'
    },
    evidenceAlignment: {
      status: 'aligned',
      evidenceRole: 'diagnostic_context'
    },
    relationshipSummary: {
      supportingSignalCount: 0,
      conflictingSignalCount: 0
    }
  });
  const second = alignment.createSignalAlignment({
    ...alignment.cloneSignalAlignment(first),
    alignmentFingerprint: undefined
  });

  assert.deepEqual(definition, sourceDefinition);
  assert.deepEqual(signal, sourceSignal);
  assert.deepEqual(first, second);
  assert.equal(first.alignmentStatus, 'aligned');
  assert.equal(first.canonicalSignal.rawOutput.zeroPreserved, 0);
  assert.equal(first.canonicalSignal.rawOutput.falsePreserved, false);
  assert.equal(first.alignmentFingerprint, alignment.buildSignalAlignmentFingerprint(first));
  assert.equal(alignment.validateSignalAlignment(first).valid, true);
});

test('cloneSignalAlignment returns an independent mutable copy', () => {
  const result = alignment.createSignalAlignment({
    signalDefinition: signalDefinition(),
    canonicalSignal: canonicalSignal()
  });
  const copy = alignment.cloneSignalAlignment(result);

  copy.canonicalSignal.rawOutput.diagnosticStatus = 'changed';
  assert.equal(result.canonicalSignal.rawOutput.diagnosticStatus, 'partial');
});

test('registry attachment returns a new immutable alignment without mutating original', () => {
  const result = alignment.createSignalAlignment({
    alignmentId: 'alignment-registry',
    canonicalSignal: canonicalSignal(),
    sourceOutputFingerprint: 'native-output-fingerprint-1'
  });
  const ref = registryReference();
  const attached = alignment.attachRegistryReference(result, ref);

  assert.notEqual(attached, result);
  assert.equal(result.registryId, 'unknown');
  assert.equal(attached.registryId, 'phase-13-signals');
  assert.equal(attached.registryFingerprint, ref.registryFingerprint);
  assert.equal(attached.signalDefinition.signalName, 'identity.parser.diagnostics');
  assert.equal(attached.productionImpact, 'none');
  assert.equal(attached.alignmentFingerprint, alignment.buildSignalAlignmentFingerprint(attached));
});

test('canonical signal attachment returns a new immutable alignment without mutating original', () => {
  const result = alignment.createSignalAlignment({
    alignmentId: 'alignment-signal',
    signalDefinition: signalDefinition()
  });
  const signal = canonicalSignal();
  const attached = alignment.attachCanonicalSignal(result, signal);

  assert.notEqual(attached, result);
  assert.equal(result.canonicalSignal, 'unknown');
  assert.equal(attached.canonicalSignal.signalId, 'identity-parser-diagnostics:listing-1');
  assert.equal(attached.sourceOutputFingerprint, 'native-output-fingerprint-1');
  assert.equal(attached.canonicalSignal.signalFingerprint, signal.signalFingerprint);
  assert.equal(attached.productionImpact, 'none');
});

test('determineAlignmentStatus follows deterministic precedence', () => {
  assert.equal(alignment.determineAlignmentStatus({
    alignmentStatus: 'aligned',
    signalDefinition: signalDefinition(),
    canonicalSignal: canonicalSignal(),
    registryFingerprint: 'registry-fingerprint',
    sourceOutputFingerprint: 'source-fingerprint',
    warnings: ['metadata_optional']
  }), 'aligned_with_warnings');
  assert.equal(alignment.determineAlignmentStatus({
    alignmentStatus: 'aligned',
    signalDefinition: 'unknown',
    canonicalSignal: canonicalSignal(),
    registryFingerprint: 'registry-fingerprint',
    sourceOutputFingerprint: 'source-fingerprint'
  }), 'definition_missing');
  assert.equal(alignment.determineAlignmentStatus({
    alignmentStatus: 'aligned',
    signalDefinition: signalDefinition(),
    canonicalSignal: canonicalSignal(),
    registryFingerprint: 'registry-fingerprint',
    sourceOutputFingerprint: 'source-fingerprint',
    productionImpact: 'changes'
  }), 'blocked');
});

test('authority alignment enforces evidence-only boundaries', () => {
  const authority = alignment.determineAuthorityAlignment({
    productionImpact: 'changes',
    canonicalSignal: {
      productionImpact: 'none',
      decisionImpact: 'none',
      executionAuthority: 'none',
      governanceFlags: {
        automaticStoreWriteAuthority: true
      }
    },
    signalDefinition: {
      productionImpact: 'none',
      decisionImpact: 'none',
      executionAuthority: 'none'
    }
  });

  assert.equal(authority.status, 'blocked');
  assert.equal(authority.productionImpact, 'none');
  assert.equal(authority.decisionImpact, 'none');
  assert.equal(authority.executionAuthority, 'none');
  assert.equal(authority.authorityViolations.includes('productionImpact'), true);
  assert.equal(authority.authorityViolations.includes('canonicalSignal.governanceFlags.automaticStoreWriteAuthority'), true);
});

test('validation rejects authority drift, invalid status, missing fields, and stale fingerprints', () => {
  const result = alignment.createSignalAlignment({
    signalDefinition: signalDefinition(),
    canonicalSignal: canonicalSignal(),
    registryFingerprint: 'registry-fingerprint',
    sourceOutputFingerprint: 'native-output-fingerprint-1'
  });
  const invalid = {
    ...result,
    alignmentId: undefined,
    alignmentStatus: 'self_authorized',
    productionImpact: 'changes',
    alignmentFingerprint: 'stale'
  };
  const validation = alignment.validateSignalAlignment(invalid);

  assert.equal(validation.valid, false);
  assert.equal(validation.reasonCodes.includes('missing_required_field'), true);
  assert.equal(validation.reasonCodes.includes('invalid_alignment_status'), true);
  assert.equal(validation.reasonCodes.includes('authority_boundary_violation'), true);
  assert.equal(validation.reasonCodes.includes('alignment_fingerprint_mismatch'), true);
  assert.equal(validation.authorityViolations.includes('productionImpact'), true);
  assert.equal(validation.fingerprintViolations.includes('alignmentFingerprint'), true);
});

test('validation reuses canonical signal and registry definition validation', () => {
  const invalidSignal = {
    ...canonicalSignal(),
    signalFingerprint: 'stale'
  };
  const invalidDefinition = {
    ...signalDefinition(),
    definitionFingerprint: 'stale'
  };
  const result = alignment.createSignalAlignment({
    signalDefinition: invalidDefinition,
    canonicalSignal: invalidSignal,
    registryFingerprint: 'registry-fingerprint',
    sourceOutputFingerprint: 'native-output-fingerprint-1'
  });
  const validation = alignment.validateSignalAlignment(result);

  assert.equal(validation.valid, false);
  assert.equal(validation.reasonCodes.includes('signal_fingerprint_mismatch'), true);
  assert.equal(validation.reasonCodes.includes('definition_fingerprint_mismatch'), true);
  assert.equal(validation.fingerprintViolations.includes('canonicalSignal.signalFingerprint'), true);
  assert.equal(validation.fingerprintViolations.includes('signalDefinition.definitionFingerprint'), true);
});

test('alignment batch fingerprint is deterministic and excludes batch fingerprint fields', () => {
  const result = alignment.createSignalAlignment({
    signalDefinition: signalDefinition(),
    canonicalSignal: canonicalSignal(),
    registryFingerprint: 'registry-fingerprint',
    sourceOutputFingerprint: 'native-output-fingerprint-1'
  });
  const batch = {
    schemaVersion: alignment.SIGNAL_ALIGNMENT_SCHEMA_VERSION,
    alignmentBatchId: 'batch-1',
    results: [result]
  };
  const first = alignment.buildSignalAlignmentBatchFingerprint(batch);
  const second = alignment.buildSignalAlignmentBatchFingerprint({
    ...batch,
    signalAlignmentBatchFingerprint: first,
    alignmentBatchFingerprint: 'legacy',
    batchFingerprint: 'legacy-2'
  });

  assert.equal(first, second);
});

test('export and import through JSON preserves compatibility and fingerprints', () => {
  const result = alignment.createSignalAlignment({
    signalDefinition: signalDefinition(),
    canonicalSignal: canonicalSignal(),
    registryFingerprint: 'registry-fingerprint',
    sourceOutputFingerprint: 'native-output-fingerprint-1'
  });
  const imported = JSON.parse(JSON.stringify(result));

  assert.deepEqual(imported, result);
  assert.equal(alignment.validateSignalAlignment(imported).valid, true);
  assert.equal(alignment.buildSignalAlignmentFingerprint(imported), result.alignmentFingerprint);
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
    delete require.cache[require.resolve('../validation/signalAlignmentContract')];
    const fresh = require('../validation/signalAlignmentContract');
    assert.equal(typeof fresh.createSignalAlignment, 'function');
    const result = fresh.createSignalAlignment({
      canonicalSignal: canonicalSignal()
    });
    assert.equal(result.productionImpact, 'none');
  } finally {
    Module._load = originalLoad;
    delete require.cache[require.resolve('../validation/signalAlignmentContract')];
    require('../validation/signalAlignmentContract');
  }

  assert.equal(loaded.some((request) => request.includes('server')), false);
});
