'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const contract = require('../validation/canonicalIntelligenceSignalContract');

function fullInput(overrides = {}) {
  return {
    signalId: 'market-value.production-point-estimate',
    signalName: 'Production Point Valuation',
    producer: {
      producerId: 'marketValueEngine.calculateMarketValue',
      name: 'Market Value Engine',
      module: 'engines/marketValueEngine.js',
      functionName: 'calculateMarketValue',
      version: '1.0.0',
      category: 'production_engine',
      metadata: { owner: 'valuation' }
    },
    producerVersion: '1.0.0',
    producerCategory: 'production_engine',
    createdAt: '2026-07-27T19:00:00.000Z',
    signalType: 'valuation',
    decisionRole: 'supporting_context',
    authorityLevel: 'production_context',
    confidence: {
      kind: 'reported',
      value: 82,
      scale: '0_100',
      basis: 'market_value_engine_output',
      calibrated: false,
      details: { capApplied: false }
    },
    confidenceLevel: 'moderate',
    uncertainty: {
      level: 'moderate',
      range: { low: 80, expected: 100, high: 125 },
      reasonCodes: ['range_available']
    },
    evidenceBasis: {
      trueSoldCount: 4,
      activeListingCount: 7,
      fallbackUsed: false,
      staleCount: 1,
      rejectedCount: 2,
      transactionIneligibleCount: 0,
      sourceConcentration: { ebay: 1 },
      asOf: '2026-07-27T00:00:00.000Z'
    },
    evidenceQuality: {
      level: 'adequate',
      score: 74,
      basis: 'comparable_quality_engine'
    },
    evidenceReferences: [
      {
        referenceId: 'evidence-summary-001',
        referenceType: 'canonical_sold_summary',
        source: 'canonical_sold_comparison',
        sourceFingerprint: 'evidence-fingerprint-a',
        attachedAt: '2026-07-27T19:01:00.000Z',
        evidenceRole: 'valuation_evidence'
      }
    ],
    supportingSignals: [
      {
        signalId: 'evidence-readiness.ready',
        signalFingerprint: 'supporting-fingerprint',
        relationship: 'supports'
      }
    ],
    conflictingSignals: [],
    warnings: ['wide_range_requires_review'],
    blockers: [],
    rawOutput: {
      marketValue: 100,
      estimatedValue: 100,
      confidence: 82,
      zeroValuePreserved: 0,
      falseValuePreserved: false
    },
    normalizedOutput: {
      value: 100,
      currency: 'USD'
    },
    sourceFingerprint: 'source-fingerprint-a',
    metadata: { reviewPriority: 'normal' },
    ...overrides
  };
}

test('exports Canonical Intelligence Signal Contract public API and constants', () => {
  assert.equal(contract.CANONICAL_INTELLIGENCE_SIGNAL_SOURCE, 'canonical_intelligence_signal_contract');
  assert.equal(contract.CANONICAL_INTELLIGENCE_SIGNAL_SCHEMA_VERSION, '1.0.0');
  assert.equal(typeof contract.createCanonicalSignal, 'function');
  assert.equal(typeof contract.validateCanonicalSignal, 'function');
  assert.equal(typeof contract.cloneCanonicalSignal, 'function');
  assert.equal(typeof contract.attachEvidenceReference, 'function');
  assert.equal(typeof contract.attachProducerMetadata, 'function');
  assert.equal(typeof contract.determineSignalStatus, 'function');
  assert.equal(typeof contract.determineSignalAuthority, 'function');
  assert.equal(typeof contract.determineSignalConfidence, 'function');
  assert.equal(typeof contract.buildCanonicalSignalFingerprint, 'function');
  assert.equal(typeof contract.buildCanonicalSignalBatchFingerprint, 'function');
});

test('creates and validates a minimum immutable signal with explicit unknown values', () => {
  const signal = contract.createCanonicalSignal({}, {
    signalId: 'minimum-signal',
    signalName: 'Minimum Signal',
    createdAt: '2026-07-27T19:00:00.000Z'
  });
  const validation = contract.validateCanonicalSignal(signal);

  assert.equal(signal.signalId, 'minimum-signal');
  assert.equal(signal.signalName, 'Minimum Signal');
  assert.equal(signal.signalType, 'unknown');
  assert.equal(signal.authorityLevel, 'advisory');
  assert.equal(signal.decisionRole, 'none');
  assert.equal(signal.productionImpact, 'none');
  assert.equal(signal.decisionImpact, 'none');
  assert.equal(signal.executionAuthority, 'none');
  assert.equal(signal.rawOutput, 'unknown');
  assert.equal(Object.isFrozen(signal), true);
  assert.equal(Object.isFrozen(signal.producer), true);
  assert.equal(validation.valid, true);
  assert.equal(validation.reasonCodes.includes('raw_output_unknown'), true);
});

test('creates a complete deterministic signal without mutating input or raw output', () => {
  const input = fullInput();
  const before = JSON.parse(JSON.stringify(input));
  const first = contract.createCanonicalSignal(input);
  const second = contract.createCanonicalSignal(input);

  assert.deepEqual(input, before);
  assert.deepEqual(first, second);
  assert.equal(first.signalFingerprint, contract.buildCanonicalSignalFingerprint(first));
  assert.equal(first.rawOutput.zeroValuePreserved, 0);
  assert.equal(first.rawOutput.falseValuePreserved, false);
  assert.equal(first.evidenceReferences[0].productionImpact, 'none');
  assert.equal(contract.validateCanonicalSignal(first).valid, true);
});

test('cloneCanonicalSignal returns an independent mutable copy of immutable data', () => {
  const signal = contract.createCanonicalSignal(fullInput());
  const copy = contract.cloneCanonicalSignal(signal);

  copy.rawOutput.marketValue = 200;
  copy.producer.metadata.owner = 'changed';
  assert.equal(signal.rawOutput.marketValue, 100);
  assert.equal(signal.producer.metadata.owner, 'valuation');
});

test('evidence reference attachment returns a new immutable signal without mutating original', () => {
  const signal = contract.createCanonicalSignal(fullInput());
  const attached = contract.attachEvidenceReference(signal, {
    referenceId: 'review-package-001',
    referenceType: 'real_listing_review_package',
    source: 'review_workspace',
    sourceFingerprint: 'review-fingerprint',
    evidenceRole: 'review_evidence',
    details: { reviewed: true }
  }, {
    attachedAt: '2026-07-27T20:00:00.000Z'
  });

  assert.notEqual(attached, signal);
  assert.equal(signal.evidenceReferences.length, 1);
  assert.equal(attached.evidenceReferences.length, 2);
  assert.equal(attached.evidenceReferences[1].attachedAt, '2026-07-27T20:00:00.000Z');
  assert.equal(attached.productionImpact, 'none');
  assert.equal(attached.decisionImpact, 'none');
  assert.equal(attached.executionAuthority, 'none');
  assert.equal(attached.signalFingerprint, contract.buildCanonicalSignalFingerprint(attached));
  assert.equal(contract.validateCanonicalSignal(attached).valid, true);
});

test('producer metadata attachment returns a new immutable signal and preserves authority boundary', () => {
  const signal = contract.createCanonicalSignal(fullInput());
  const updated = contract.attachProducerMetadata(signal, {
    version: '1.0.1',
    category: 'production_engine',
    metadata: {
      contractAdapter: 'phase13'
    }
  });

  assert.notEqual(updated, signal);
  assert.equal(signal.producer.version, '1.0.0');
  assert.equal(updated.producer.version, '1.0.1');
  assert.equal(updated.producer.metadata.owner, 'valuation');
  assert.equal(updated.producer.metadata.contractAdapter, 'phase13');
  assert.equal(updated.productionImpact, 'none');
  assert.equal(updated.signalFingerprint, contract.buildCanonicalSignalFingerprint(updated));
  assert.equal(contract.validateCanonicalSignal(updated).valid, true);
});

test('determines status, authority, and confidence without granting production authority', () => {
  const available = contract.createCanonicalSignal(fullInput({ warnings: [] }));
  const warning = contract.createCanonicalSignal(fullInput());
  const conflicted = contract.createCanonicalSignal(fullInput({
    warnings: [],
    conflictingSignals: [{ signalId: 'identity.ambiguous' }]
  }));
  const blocked = contract.createCanonicalSignal(fullInput({
    blockers: ['missing_true_sold_evidence']
  }));

  assert.equal(contract.determineSignalStatus(available), 'available');
  assert.equal(contract.determineSignalStatus(warning), 'warning');
  assert.equal(contract.determineSignalStatus(conflicted), 'conflicted');
  assert.equal(contract.determineSignalStatus(blocked), 'blocked');

  const authority = contract.determineSignalAuthority({
    authorityLevel: 'production_context',
    decisionRole: 'supporting_context',
    productionImpact: 'changes'
  });
  assert.equal(authority.authorityLevel, 'production_context');
  assert.equal(authority.decisionRole, 'supporting_context');
  assert.equal(authority.productionImpact, 'none');
  assert.equal(authority.executionAuthority, 'none');
  assert.equal(authority.advisoryOnly, true);

  const confidence = contract.determineSignalConfidence(available);
  assert.equal(confidence.kind, 'reported');
  assert.equal(confidence.value, 82);
  assert.equal(confidence.level, 'moderate');
});

test('validation rejects invalid enums, authority drift, invalid evidence, and stale fingerprints', () => {
  const signal = contract.createCanonicalSignal(fullInput());
  const invalid = {
    ...signal,
    signalType: 'magic_signal',
    authorityLevel: 'self_authorized',
    decisionRole: 'auto_buy',
    confidenceLevel: 'certain',
    confidence: {
      ...signal.confidence,
      value: 150
    },
    evidenceBasis: {
      ...signal.evidenceBasis,
      trueSoldCount: -1
    },
    productionImpact: 'changes_production',
    decisionImpact: 'changes_decision',
    executionAuthority: 'execute_change',
    governanceFlags: {
      ...signal.governanceFlags,
      automaticStoreWriteAuthority: true
    },
    evidenceReferences: [
      {
        ...signal.evidenceReferences[0],
        productionImpact: 'changes_production'
      }
    ],
    signalFingerprint: 'stale'
  };
  const validation = contract.validateCanonicalSignal(invalid);

  assert.equal(validation.valid, false);
  assert.equal(validation.reasonCodes.includes('invalid_enum_value'), true);
  assert.equal(validation.reasonCodes.includes('invalid_confidence_value'), true);
  assert.equal(validation.reasonCodes.includes('invalid_evidence_count'), true);
  assert.equal(validation.reasonCodes.includes('invalid_production_impact'), true);
  assert.equal(validation.reasonCodes.includes('invalid_governance_authority_flag'), true);
  assert.equal(validation.reasonCodes.includes('signal_fingerprint_mismatch'), true);
  assert.equal(validation.authorityViolations.includes('productionImpact'), true);
  assert.equal(validation.evidenceViolations.includes('evidenceBasis.trueSoldCount'), true);
  assert.equal(validation.fingerprintViolations.includes('signalFingerprint'), true);
});

test('validation reports missing required fields with structured failures', () => {
  const signal = contract.createCanonicalSignal(fullInput());
  const invalid = {
    ...signal,
    signalId: undefined,
    rawOutput: undefined,
    signalFingerprint: undefined
  };
  const validation = contract.validateCanonicalSignal(invalid);

  assert.equal(validation.valid, false);
  assert.equal(validation.missingRequiredFields.includes('signalId'), true);
  assert.equal(validation.missingRequiredFields.includes('rawOutput'), true);
  assert.equal(validation.missingRequiredFields.includes('signalFingerprint'), true);
  assert.equal(validation.reasonCodes.includes('missing_required_field'), true);
});

test('export and import through JSON preserves validation and fingerprint compatibility', () => {
  const signal = contract.createCanonicalSignal(fullInput());
  const exported = JSON.stringify(signal);
  const imported = JSON.parse(exported);

  assert.deepEqual(imported, signal);
  assert.equal(contract.validateCanonicalSignal(imported).valid, true);
  assert.equal(contract.buildCanonicalSignalFingerprint(imported), signal.signalFingerprint);
});

test('canonical signal batch fingerprint is deterministic and excludes batch fingerprint fields', () => {
  const signal = contract.createCanonicalSignal(fullInput());
  const batch = {
    schemaVersion: contract.CANONICAL_INTELLIGENCE_SIGNAL_SCHEMA_VERSION,
    source: `${contract.CANONICAL_INTELLIGENCE_SIGNAL_SOURCE}:batch`,
    signalBatchId: 'signal-batch-001',
    signals: [signal]
  };
  const first = contract.buildCanonicalSignalBatchFingerprint(batch);
  const second = contract.buildCanonicalSignalBatchFingerprint({
    ...batch,
    signalBatchFingerprint: first,
    batchFingerprint: 'legacy-field'
  });

  assert.equal(first, second);
});

test('module does not import production runtime or engine modules', () => {
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
    delete require.cache[require.resolve('../validation/canonicalIntelligenceSignalContract')];
    const fresh = require('../validation/canonicalIntelligenceSignalContract');
    assert.equal(typeof fresh.createCanonicalSignal, 'function');
  } finally {
    Module._load = originalLoad;
    delete require.cache[require.resolve('../validation/canonicalIntelligenceSignalContract')];
    require('../validation/canonicalIntelligenceSignalContract');
  }

  assert.equal(loaded.some((request) => request.includes('server')), false);
});
