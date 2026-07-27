'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const contract = require('../validation/calibrationExperimentContract');

function fullInput(overrides = {}) {
  return {
    experimentId: 'experiment-confidence-001',
    experimentBatchId: 'experiment-batch-001',
    createdAt: '2026-07-27T12:00:00.000Z',
    sourceRecommendationIds: ['rec-confidence-001'],
    sourceRecommendationFingerprints: ['recommendation-fingerprint-a'],
    experimentType: 'offline_replay',
    targetSubsystem: 'confidence',
    targetRule: 'reported_confidence_alignment',
    baselineBehavior: { description: 'Current production behavior is preserved as baseline.' },
    proposedBehavior: { description: 'Evaluate proposed confidence cap offline only.' },
    replayDatasetIds: ['dataset-a'],
    holdoutDatasetIds: ['dataset-holdout-a'],
    comparisonMetrics: [{ metric: 'false_positive_rate' }, { metric: 'missed_opportunity_rate' }],
    successCriteria: { falsePositiveRateDoesNotIncrease: true },
    failureCriteria: { missedOpportunityRegressionAllowed: false },
    regressionCriteria: { dealGateQualityMustNotDecline: true },
    statisticalRequirements: { minimumReviewedRecords: 30 },
    risks: ['missed_opportunity_rate_may_increase'],
    assumptions: ['dataset_is_reviewed_evidence_only'],
    limitations: ['offline_replay_only'],
    rollbackPlan: { requiredBeforeProductionProposal: true },
    experimentStatus: 'approval_required',
    approvalArtifact: { required: true, approved: false },
    resultArtifact: { available: false },
    ...overrides
  };
}

test('exports Calibration Experiment Contract public API and constants', () => {
  assert.equal(contract.CALIBRATION_EXPERIMENT_SOURCE, 'calibration_experiment_contract');
  assert.equal(contract.CALIBRATION_EXPERIMENT_SCHEMA_VERSION, '1.0.0');
  assert.equal(typeof contract.createCalibrationExperiment, 'function');
  assert.equal(typeof contract.validateCalibrationExperiment, 'function');
  assert.equal(typeof contract.cloneCalibrationExperiment, 'function');
  assert.equal(typeof contract.attachApprovalArtifact, 'function');
  assert.equal(typeof contract.attachExperimentResults, 'function');
  assert.equal(typeof contract.determineExperimentStatus, 'function');
  assert.equal(typeof contract.buildCalibrationExperimentFingerprint, 'function');
  assert.equal(typeof contract.buildExperimentBatchFingerprint, 'function');
});

test('creates and validates a minimum immutable experiment with explicit unknown values', () => {
  const experiment = contract.createCalibrationExperiment({}, {
    experimentId: 'minimum-experiment',
    experimentBatchId: 'minimum-experiment-batch',
    createdAt: '2026-07-27T12:00:00.000Z'
  });

  assert.equal(experiment.experimentId, 'minimum-experiment');
  assert.equal(experiment.experimentType, 'offline_replay');
  assert.equal(experiment.targetSubsystem, 'unknown');
  assert.equal(experiment.targetRule, 'unknown');
  assert.equal(experiment.productionImpact, 'none');
  assert.equal(experiment.decisionImpact, 'none');
  assert.equal(Object.isFrozen(experiment), true);
  assert.equal(Object.isFrozen(experiment.approvalArtifact), true);
  assert.equal(contract.validateCalibrationExperiment(experiment).valid, true);
});

test('creates a full deterministic experiment without mutating input', () => {
  const input = fullInput();
  const before = JSON.parse(JSON.stringify(input));
  const first = contract.createCalibrationExperiment(input);
  const second = contract.createCalibrationExperiment(input);

  assert.deepEqual(input, before);
  assert.deepEqual(first, second);
  assert.equal(first.experimentFingerprint, contract.buildCalibrationExperimentFingerprint(first));
  assert.equal(first.baselineBehavior.description, 'Current production behavior is preserved as baseline.');
  assert.equal(first.comparisonMetrics.length, 2);
  assert.equal(contract.validateCalibrationExperiment(first).valid, true);
});

test('rejects invalid enums with structured validation', () => {
  const experiment = {
    ...contract.createCalibrationExperiment(fullInput()),
    experimentType: 'production_trial',
    experimentStatus: 'production_changed',
    experimentFingerprint: 'stale'
  };
  const validation = contract.validateCalibrationExperiment(experiment);

  assert.equal(validation.valid, false);
  assert.equal(validation.reasonCodes.includes('invalid_enum_value'), true);
  assert.equal(validation.reasonCodes.includes('experiment_fingerprint_mismatch'), true);
  assert.equal(validation.invalidFields.includes('experimentType'), true);
  assert.equal(validation.invalidFields.includes('experimentStatus'), true);
});

test('validation rejects authority drift and missing required fields', () => {
  const experiment = contract.createCalibrationExperiment(fullInput());
  const invalid = {
    ...experiment,
    sourceRecommendationIds: undefined,
    productionImpact: 'changes_threshold',
    decisionImpact: 'changes_decision',
    approvalArtifact: {
      ...experiment.approvalArtifact,
      productionImpact: 'changes_production'
    },
    resultArtifact: {
      ...experiment.resultArtifact,
      decisionImpact: 'changes_decision'
    },
    experimentFingerprint: undefined
  };
  const validation = contract.validateCalibrationExperiment(invalid);

  assert.equal(validation.valid, false);
  assert.equal(validation.missingRequiredFields.includes('sourceRecommendationIds'), true);
  assert.equal(validation.missingRequiredFields.includes('experimentFingerprint'), true);
  assert.equal(validation.reasonCodes.includes('invalid_production_impact'), true);
  assert.equal(validation.reasonCodes.includes('invalid_decision_impact'), true);
  assert.equal(validation.reasonCodes.includes('invalid_approval_production_impact'), true);
  assert.equal(validation.reasonCodes.includes('invalid_result_decision_impact'), true);
});

test('approval artifact attachment returns a new immutable experiment without mutating original', () => {
  const experiment = contract.createCalibrationExperiment(fullInput({ experimentStatus: 'approval_required' }));
  const approved = contract.attachApprovalArtifact(experiment, {
    approved: true,
    approver: 'Dalton',
    approvedAt: '2026-07-27T13:00:00.000Z',
    approvalScope: { scope: 'offline_replay_only' },
    approvalArtifactId: 'approval-001',
    approvalArtifactFingerprint: 'approval-fingerprint',
    notes: 'Approved for offline run only.'
  }, {
    experimentStatus: 'approved_for_offline_run'
  });

  assert.notEqual(approved, experiment);
  assert.equal(experiment.approvalArtifact.approved, false);
  assert.equal(experiment.experimentStatus, 'approval_required');
  assert.equal(approved.approvalArtifact.approved, true);
  assert.equal(approved.experimentStatus, 'approved_for_offline_run');
  assert.equal(approved.productionImpact, 'none');
  assert.equal(approved.decisionImpact, 'none');
  assert.equal(approved.experimentFingerprint, contract.buildCalibrationExperimentFingerprint(approved));
  assert.equal(contract.validateCalibrationExperiment(approved).valid, true);
});

test('result artifact attachment returns a new immutable experiment without mutating original', () => {
  const experiment = contract.createCalibrationExperiment(fullInput({ experimentStatus: 'approved_for_offline_run' }));
  const withResults = contract.attachExperimentResults(experiment, {
    resultArtifactId: 'result-001',
    completedAt: '2026-07-27T14:00:00.000Z',
    resultStatus: 'offline_run_complete',
    summary: { result: 'candidate_improved_false_positive_rate' },
    metrics: { falsePositiveRateDelta: -4.2 },
    regressions: [],
    counterEvidence: [{ category: 'holdout_needed' }],
    resultArtifactFingerprint: 'result-fingerprint'
  }, {
    experimentStatus: 'results_attached'
  });

  assert.notEqual(withResults, experiment);
  assert.equal(experiment.resultArtifact.available, false);
  assert.equal(withResults.resultArtifact.available, true);
  assert.equal(withResults.resultArtifact.productionImpact, 'none');
  assert.equal(withResults.resultArtifact.decisionImpact, 'none');
  assert.equal(withResults.experimentStatus, 'results_attached');
  assert.equal(withResults.experimentFingerprint, contract.buildCalibrationExperimentFingerprint(withResults));
  assert.equal(contract.validateCalibrationExperiment(withResults).valid, true);
});

test('determineExperimentStatus preserves explicit statuses and falls back safely', () => {
  assert.equal(contract.determineExperimentStatus({ experimentStatus: 'offline_run_complete' }), 'offline_run_complete');
  assert.equal(contract.determineExperimentStatus({ resultArtifact: { available: true } }), 'results_attached');
  assert.equal(contract.determineExperimentStatus({ approvalArtifact: { approved: true } }), 'approved_for_offline_run');
  assert.equal(contract.determineExperimentStatus({ experimentId: 'needs-approval' }), 'approval_required');
  assert.equal(contract.determineExperimentStatus({}), 'draft');
});

test('cloneCalibrationExperiment returns an independent mutable copy of immutable data', () => {
  const experiment = contract.createCalibrationExperiment(fullInput());
  const copy = contract.cloneCalibrationExperiment(experiment);

  copy.baselineBehavior.description = 'changed locally';
  assert.equal(experiment.baselineBehavior.description, 'Current production behavior is preserved as baseline.');
  assert.equal(copy.baselineBehavior.description, 'changed locally');
});

test('experiment batch fingerprint is deterministic and excludes its own fingerprint field', () => {
  const experiment = contract.createCalibrationExperiment(fullInput());
  const batch = {
    schemaVersion: contract.CALIBRATION_EXPERIMENT_SCHEMA_VERSION,
    source: `${contract.CALIBRATION_EXPERIMENT_SOURCE}:batch`,
    experimentBatchId: 'batch-001',
    experiments: [experiment]
  };
  const first = contract.buildExperimentBatchFingerprint(batch);
  const second = contract.buildExperimentBatchFingerprint({
    ...batch,
    experimentBatchFingerprint: first
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
    delete require.cache[require.resolve('../validation/calibrationExperimentContract')];
    const fresh = require('../validation/calibrationExperimentContract');
    assert.equal(typeof fresh.createCalibrationExperiment, 'function');
  } finally {
    Module._load = originalLoad;
    delete require.cache[require.resolve('../validation/calibrationExperimentContract')];
    require('../validation/calibrationExperimentContract');
  }
  assert.equal(loaded.some((request) => request.includes('server')), false);
});
