'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const contract = require('../validation/calibrationRecommendationContract');

function fullInput(overrides = {}) {
  return {
    recommendationId: 'rec-confidence-001',
    recommendationBatchId: 'rec-batch-001',
    createdAt: '2026-07-26T12:00:00.000Z',
    sourceDatasetIds: ['dataset-a'],
    sourceDatasetFingerprints: ['dataset-fingerprint-a'],
    recommendationCategory: 'confidence_calibration_adjustment',
    affectedSubsystem: 'confidence',
    affectedRuleOrField: 'market_confidence_interpretation',
    finding: { pattern: 'high_confidence_false_positive_cluster' },
    evidenceSummary: { reviewedCount: 42, falsePositiveCount: 6 },
    sampleSize: { totalReviewed: 42, affectedCategoryReviewed: 12 },
    coverage: { marketplace: ['ebay'], gradingCompany: ['PSA'] },
    currentBehavior: { description: 'Current production confidence is preserved as observed.' },
    proposedBehavior: { description: 'Review confidence cap in affected slice.' },
    expectedBenefit: { falsePositiveReduction: 'possible' },
    identifiedRisks: ['missed_opportunity_rate_may_increase'],
    confidence: 72,
    confidenceLevel: 'moderate',
    evidenceStrength: 'adequate',
    counterEvidence: [{ category: 'holdout_needed' }],
    prerequisites: [{ requirement: 'offline_experiment_specification' }],
    validationPlan: { type: 'offline_replay' },
    rollbackPlan: { required: true },
    recommendationStatus: 'candidate',
    reviewerApproval: { required: true, approved: false },
    ...overrides
  };
}

test('exports Calibration Recommendation Contract public API and constants', () => {
  assert.equal(contract.CALIBRATION_RECOMMENDATION_SOURCE, 'calibration_recommendation_contract');
  assert.equal(contract.CALIBRATION_RECOMMENDATION_SCHEMA_VERSION, '1.0.0');
  assert.equal(typeof contract.createCalibrationRecommendation, 'function');
  assert.equal(typeof contract.validateCalibrationRecommendation, 'function');
  assert.equal(typeof contract.cloneCalibrationRecommendation, 'function');
  assert.equal(typeof contract.attachApprovalMetadata, 'function');
  assert.equal(typeof contract.attachExperimentReference, 'function');
  assert.equal(typeof contract.determineRecommendationStatus, 'function');
  assert.equal(typeof contract.buildCalibrationRecommendationFingerprint, 'function');
  assert.equal(typeof contract.buildRecommendationBatchFingerprint, 'function');
});

test('creates and validates a minimum immutable recommendation with explicit unknown values', () => {
  const recommendation = contract.createCalibrationRecommendation({}, {
    recommendationId: 'minimum-rec',
    recommendationBatchId: 'minimum-batch',
    createdAt: '2026-07-26T12:00:00.000Z'
  });

  assert.equal(recommendation.recommendationId, 'minimum-rec');
  assert.equal(recommendation.recommendationCategory, 'insufficient_data_finding');
  assert.equal(recommendation.affectedSubsystem, 'unknown');
  assert.equal(recommendation.confidence, 'unknown');
  assert.equal(recommendation.productionImpact, 'none');
  assert.equal(recommendation.decisionImpact, 'none');
  assert.equal(Object.isFrozen(recommendation), true);
  assert.equal(Object.isFrozen(recommendation.reviewerApproval), true);
  assert.equal(contract.validateCalibrationRecommendation(recommendation).valid, true);
});

test('creates a full deterministic recommendation without mutating input', () => {
  const input = fullInput();
  const before = JSON.parse(JSON.stringify(input));
  const first = contract.createCalibrationRecommendation(input);
  const second = contract.createCalibrationRecommendation(input);

  assert.deepEqual(input, before);
  assert.deepEqual(first, second);
  assert.equal(first.recommendationFingerprint, contract.buildCalibrationRecommendationFingerprint(first));
  assert.equal(first.finding.pattern, 'high_confidence_false_positive_cluster');
  assert.deepEqual(first.identifiedRisks, ['missed_opportunity_rate_may_increase']);
  assert.equal(contract.validateCalibrationRecommendation(first).valid, true);
});

test('rejects invalid enums and invalid confidence values with structured validation', () => {
  const recommendation = {
    ...contract.createCalibrationRecommendation(fullInput()),
    recommendationCategory: 'auto_tune_everything',
    recommendationStatus: 'production_changed',
    confidenceLevel: 'certain',
    evidenceStrength: 'magic',
    confidence: 150,
    recommendationFingerprint: 'stale'
  };
  const validation = contract.validateCalibrationRecommendation(recommendation);

  assert.equal(validation.valid, false);
  assert.equal(validation.reasonCodes.includes('invalid_enum_value'), true);
  assert.equal(validation.reasonCodes.includes('invalid_confidence'), true);
  assert.equal(validation.reasonCodes.includes('recommendation_fingerprint_mismatch'), true);
  assert.equal(validation.invalidFields.includes('recommendationCategory'), true);
  assert.equal(validation.invalidFields.includes('confidence'), true);
});

test('validation rejects authority drift and missing required fields', () => {
  const recommendation = contract.createCalibrationRecommendation(fullInput());
  const invalid = {
    ...recommendation,
    sourceDatasetIds: undefined,
    productionImpact: 'changes_threshold',
    decisionImpact: 'changes_decision',
    recommendationFingerprint: undefined
  };
  const validation = contract.validateCalibrationRecommendation(invalid);

  assert.equal(validation.valid, false);
  assert.equal(validation.missingRequiredFields.includes('sourceDatasetIds'), true);
  assert.equal(validation.missingRequiredFields.includes('recommendationFingerprint'), true);
  assert.equal(validation.reasonCodes.includes('invalid_production_impact'), true);
  assert.equal(validation.reasonCodes.includes('invalid_decision_impact'), true);
});

test('approval metadata attachment returns a new immutable recommendation without mutating original', () => {
  const recommendation = contract.createCalibrationRecommendation(fullInput({ recommendationStatus: 'candidate' }));
  const approved = contract.attachApprovalMetadata(recommendation, {
    approved: true,
    reviewer: 'Dalton',
    approvedAt: '2026-07-26T13:00:00.000Z',
    approvalScope: { scope: 'offline_experiment_only' },
    approvalArtifactFingerprint: 'approval-fingerprint'
  }, {
    recommendationStatus: 'approved_for_offline_experiment'
  });

  assert.notEqual(approved, recommendation);
  assert.equal(recommendation.reviewerApproval.approved, false);
  assert.equal(recommendation.recommendationStatus, 'candidate');
  assert.equal(approved.reviewerApproval.approved, true);
  assert.equal(approved.recommendationStatus, 'approved_for_offline_experiment');
  assert.equal(approved.productionImpact, 'none');
  assert.equal(approved.decisionImpact, 'none');
  assert.equal(approved.recommendationFingerprint, contract.buildCalibrationRecommendationFingerprint(approved));
  assert.equal(contract.validateCalibrationRecommendation(approved).valid, true);
});

test('experiment references attach without mutation and preserve evidence-only boundaries', () => {
  const recommendation = contract.createCalibrationRecommendation(fullInput({
    recommendationStatus: 'approved_for_offline_experiment'
  }));
  const withExperiment = contract.attachExperimentReference(recommendation, {
    experimentId: 'experiment-001',
    experimentType: 'offline_replay',
    experimentStatus: 'planned',
    experimentFingerprint: 'experiment-fingerprint',
    attachedAt: '2026-07-26T14:00:00.000Z',
    details: { holdout: true }
  });

  assert.equal(recommendation.experimentReferences.length, 0);
  assert.equal(withExperiment.experimentReferences.length, 1);
  assert.equal(withExperiment.experimentReferences[0].productionImpact, 'none');
  assert.equal(withExperiment.experimentReferences[0].decisionImpact, 'none');
  assert.equal(withExperiment.recommendationFingerprint, contract.buildCalibrationRecommendationFingerprint(withExperiment));
  assert.equal(contract.validateCalibrationRecommendation(withExperiment).valid, true);
});

test('determineRecommendationStatus preserves explicit statuses and falls back safely', () => {
  assert.equal(contract.determineRecommendationStatus({ recommendationStatus: 'shadow_validated' }), 'shadow_validated');
  assert.equal(contract.determineRecommendationStatus({ reviewerApproval: { approved: true } }), 'reviewed');
  assert.equal(contract.determineRecommendationStatus({ recommendationId: 'draft' }), 'drafted');
  assert.equal(contract.determineRecommendationStatus({}), 'observed');
});

test('cloneCalibrationRecommendation returns an independent mutable copy of immutable data', () => {
  const recommendation = contract.createCalibrationRecommendation(fullInput());
  const copy = contract.cloneCalibrationRecommendation(recommendation);

  copy.finding.pattern = 'changed_locally';
  assert.equal(recommendation.finding.pattern, 'high_confidence_false_positive_cluster');
  assert.equal(copy.finding.pattern, 'changed_locally');
});

test('recommendation batch fingerprint is deterministic and excludes its own fingerprint field', () => {
  const recommendation = contract.createCalibrationRecommendation(fullInput());
  const batch = {
    schemaVersion: contract.CALIBRATION_RECOMMENDATION_SCHEMA_VERSION,
    source: `${contract.CALIBRATION_RECOMMENDATION_SOURCE}:batch`,
    recommendationBatchId: 'batch-001',
    recommendations: [recommendation]
  };
  const first = contract.buildRecommendationBatchFingerprint(batch);
  const second = contract.buildRecommendationBatchFingerprint({
    ...batch,
    recommendationBatchFingerprint: first
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
    delete require.cache[require.resolve('../validation/calibrationRecommendationContract')];
    const fresh = require('../validation/calibrationRecommendationContract');
    assert.equal(typeof fresh.createCalibrationRecommendation, 'function');
  } finally {
    Module._load = originalLoad;
    delete require.cache[require.resolve('../validation/calibrationRecommendationContract')];
    require('../validation/calibrationRecommendationContract');
  }
  assert.equal(loaded.some((request) => request.includes('server')), false);
});
