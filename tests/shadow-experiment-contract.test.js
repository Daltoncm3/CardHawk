'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const contract = require('../validation/shadowExperimentContract');

function fullInput(overrides = {}) {
  return {
    shadowExperimentId: 'shadow-experiment-confidence-001',
    shadowExperimentBatchId: 'shadow-experiment-batch-001',
    createdAt: '2026-07-27T16:00:00.000Z',
    sourceExperimentIds: ['experiment-confidence-001'],
    sourceExperimentFingerprints: ['offline-experiment-fingerprint-a'],
    targetSubsystem: 'confidence',
    observationScope: {
      mode: 'live_shadow_observation',
      marketplace: 'ebay',
      minimumObservedListings: 50,
      productionAuthority: 'none'
    },
    productionBaselineReference: {
      baselineId: 'production-baseline-confidence-001',
      baselineFingerprint: 'production-baseline-fingerprint'
    },
    shadowConfigurationReference: {
      configurationId: 'shadow-confidence-candidate-001',
      configurationFingerprint: 'shadow-configuration-fingerprint',
      productionAuthority: 'none'
    },
    observationMetrics: [
      { metric: 'observed_listing_count' },
      { metric: 'production_shadow_agreement_rate' }
    ],
    comparisonMetrics: [
      { metric: 'false_positive_rate_delta' },
      { metric: 'missed_opportunity_rate_delta' }
    ],
    regressionCriteria: { falsePositiveRateDelta: { max: 0 } },
    successCriteria: { productionShadowAgreementRate: { min: 0.9 } },
    statisticalRequirements: { minimumObservedListings: 50, minimumReviewedListings: 20 },
    monitoringRequirements: { emitSummary: true, stopOnRegression: true },
    rollbackPlan: { disableShadowObservation: true, preservePartialArtifacts: true },
    shadowExperimentStatus: 'approval_required',
    approvalArtifact: { required: true, approved: false },
    shadowResultReference: { available: false },
    ...overrides
  };
}

test('exports Shadow Experiment Contract public API and constants', () => {
  assert.equal(contract.SHADOW_EXPERIMENT_SOURCE, 'shadow_experiment_contract');
  assert.equal(contract.SHADOW_EXPERIMENT_SCHEMA_VERSION, '1.0.0');
  assert.equal(typeof contract.createShadowExperiment, 'function');
  assert.equal(typeof contract.validateShadowExperiment, 'function');
  assert.equal(typeof contract.cloneShadowExperiment, 'function');
  assert.equal(typeof contract.attachApprovalArtifact, 'function');
  assert.equal(typeof contract.attachShadowResultsReference, 'function');
  assert.equal(typeof contract.determineShadowExperimentStatus, 'function');
  assert.equal(typeof contract.buildShadowExperimentFingerprint, 'function');
  assert.equal(typeof contract.buildShadowExperimentBatchFingerprint, 'function');
});

test('creates and validates a minimum immutable shadow experiment with explicit unknown values', () => {
  const shadowExperiment = contract.createShadowExperiment({}, {
    shadowExperimentId: 'minimum-shadow-experiment',
    shadowExperimentBatchId: 'minimum-shadow-batch',
    createdAt: '2026-07-27T16:00:00.000Z'
  });

  assert.equal(shadowExperiment.shadowExperimentId, 'minimum-shadow-experiment');
  assert.equal(shadowExperiment.targetSubsystem, 'unknown');
  assert.equal(shadowExperiment.productionImpact, 'none');
  assert.equal(shadowExperiment.decisionImpact, 'none');
  assert.equal(shadowExperiment.approvalArtifact.authorityStatement, 'shadow observation only; no production authority');
  assert.equal(Object.isFrozen(shadowExperiment), true);
  assert.equal(Object.isFrozen(shadowExperiment.approvalArtifact), true);
  assert.equal(contract.validateShadowExperiment(shadowExperiment).valid, true);
});

test('creates a full deterministic shadow experiment without mutating input', () => {
  const input = fullInput();
  const before = JSON.parse(JSON.stringify(input));
  const first = contract.createShadowExperiment(input);
  const second = contract.createShadowExperiment(input);

  assert.deepEqual(input, before);
  assert.deepEqual(first, second);
  assert.equal(first.shadowExperimentFingerprint, contract.buildShadowExperimentFingerprint(first));
  assert.equal(first.observationMetrics.length, 2);
  assert.equal(first.observationScope.minimumObservedListings, 50);
  assert.equal(contract.validateShadowExperiment(first).valid, true);
});

test('rejects invalid enums with structured validation', () => {
  const shadowExperiment = {
    ...contract.createShadowExperiment(fullInput()),
    shadowExperimentStatus: 'production_enabled',
    shadowExperimentFingerprint: 'stale'
  };
  const validation = contract.validateShadowExperiment(shadowExperiment);

  assert.equal(validation.valid, false);
  assert.equal(validation.reasonCodes.includes('invalid_enum_value'), true);
  assert.equal(validation.reasonCodes.includes('shadow_experiment_fingerprint_mismatch'), true);
  assert.equal(validation.invalidFields.includes('shadowExperimentStatus'), true);
});

test('validation rejects authority drift and missing required fields', () => {
  const shadowExperiment = contract.createShadowExperiment(fullInput());
  const invalid = {
    ...shadowExperiment,
    sourceExperimentIds: undefined,
    productionImpact: 'changes_threshold',
    decisionImpact: 'changes_decision',
    approvalArtifact: {
      ...shadowExperiment.approvalArtifact,
      productionImpact: 'changes_production'
    },
    shadowResultReference: {
      ...shadowExperiment.shadowResultReference,
      decisionImpact: 'changes_decision'
    },
    shadowExperimentFingerprint: undefined
  };
  const validation = contract.validateShadowExperiment(invalid);

  assert.equal(validation.valid, false);
  assert.equal(validation.missingRequiredFields.includes('sourceExperimentIds'), true);
  assert.equal(validation.missingRequiredFields.includes('shadowExperimentFingerprint'), true);
  assert.equal(validation.reasonCodes.includes('invalid_production_impact'), true);
  assert.equal(validation.reasonCodes.includes('invalid_decision_impact'), true);
  assert.equal(validation.reasonCodes.includes('invalid_approval_production_impact'), true);
  assert.equal(validation.reasonCodes.includes('invalid_result_decision_impact'), true);
});

test('approval artifact attachment returns a new immutable experiment without mutating original', () => {
  const shadowExperiment = contract.createShadowExperiment(fullInput({ shadowExperimentStatus: 'approval_required' }));
  const approved = contract.attachApprovalArtifact(shadowExperiment, {
    approved: true,
    approver: 'Dalton',
    approvedAt: '2026-07-27T17:00:00.000Z',
    approvalScope: { scope: 'shadow_observation_only' },
    approvedObservationWindow: { minimumListings: 50 },
    approvedMetricPlan: { metrics: ['production_shadow_agreement_rate'] },
    approvedRollbackPlan: { disableShadowObservation: true },
    approvalArtifactId: 'shadow-approval-001',
    approvalArtifactFingerprint: 'shadow-approval-fingerprint',
    limitations: ['no_production_authority'],
    notes: 'Approved for observation only.'
  }, {
    shadowExperimentStatus: 'approved_for_shadow_observation'
  });

  assert.notEqual(approved, shadowExperiment);
  assert.equal(shadowExperiment.approvalArtifact.approved, false);
  assert.equal(shadowExperiment.shadowExperimentStatus, 'approval_required');
  assert.equal(approved.approvalArtifact.approved, true);
  assert.equal(approved.shadowExperimentStatus, 'approved_for_shadow_observation');
  assert.equal(approved.productionImpact, 'none');
  assert.equal(approved.decisionImpact, 'none');
  assert.equal(approved.shadowExperimentFingerprint, contract.buildShadowExperimentFingerprint(approved));
  assert.equal(contract.validateShadowExperiment(approved).valid, true);
});

test('shadow result reference attachment returns a new immutable experiment without mutating original', () => {
  const shadowExperiment = contract.createShadowExperiment(fullInput({ shadowExperimentStatus: 'active_shadow_observation' }));
  const withResults = contract.attachShadowResultsReference(shadowExperiment, {
    shadowResultId: 'shadow-result-001',
    shadowExperimentId: 'shadow-experiment-confidence-001',
    attachedAt: '2026-07-27T18:00:00.000Z',
    resultStatus: 'analysis_complete',
    resultFingerprint: 'shadow-result-fingerprint',
    summary: { observedListingCount: 50 }
  }, {
    shadowExperimentStatus: 'analysis_complete'
  });

  assert.notEqual(withResults, shadowExperiment);
  assert.equal(shadowExperiment.shadowResultReference.available, false);
  assert.equal(withResults.shadowResultReference.available, true);
  assert.equal(withResults.shadowResultReference.productionImpact, 'none');
  assert.equal(withResults.shadowResultReference.decisionImpact, 'none');
  assert.equal(withResults.shadowExperimentStatus, 'analysis_complete');
  assert.equal(withResults.shadowExperimentFingerprint, contract.buildShadowExperimentFingerprint(withResults));
  assert.equal(contract.validateShadowExperiment(withResults).valid, true);
});

test('determineShadowExperimentStatus preserves explicit statuses and falls back safely', () => {
  assert.equal(contract.determineShadowExperimentStatus({ shadowExperimentStatus: 'observation_complete' }), 'observation_complete');
  assert.equal(contract.determineShadowExperimentStatus({ shadowResultReference: { available: true } }), 'analysis_complete');
  assert.equal(contract.determineShadowExperimentStatus({ approvalArtifact: { approved: true } }), 'approved_for_shadow_observation');
  assert.equal(contract.determineShadowExperimentStatus({ shadowExperimentId: 'needs-approval' }), 'approval_required');
  assert.equal(contract.determineShadowExperimentStatus({}), 'draft');
});

test('cloneShadowExperiment returns an independent mutable copy of immutable data', () => {
  const shadowExperiment = contract.createShadowExperiment(fullInput());
  const copy = contract.cloneShadowExperiment(shadowExperiment);

  copy.observationScope.minimumObservedListings = 100;
  assert.equal(shadowExperiment.observationScope.minimumObservedListings, 50);
  assert.equal(copy.observationScope.minimumObservedListings, 100);
});

test('shadow experiment batch fingerprint is deterministic and excludes its own fingerprint field', () => {
  const shadowExperiment = contract.createShadowExperiment(fullInput());
  const batch = {
    schemaVersion: contract.SHADOW_EXPERIMENT_SCHEMA_VERSION,
    source: `${contract.SHADOW_EXPERIMENT_SOURCE}:batch`,
    shadowExperimentBatchId: 'batch-001',
    shadowExperiments: [shadowExperiment]
  };
  const first = contract.buildShadowExperimentBatchFingerprint(batch);
  const second = contract.buildShadowExperimentBatchFingerprint({
    ...batch,
    shadowExperimentBatchFingerprint: first
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
    delete require.cache[require.resolve('../validation/shadowExperimentContract')];
    const fresh = require('../validation/shadowExperimentContract');
    assert.equal(typeof fresh.createShadowExperiment, 'function');
  } finally {
    Module._load = originalLoad;
    delete require.cache[require.resolve('../validation/shadowExperimentContract')];
    require('../validation/shadowExperimentContract');
  }
  assert.equal(loaded.some((request) => request.includes('server')), false);
});
