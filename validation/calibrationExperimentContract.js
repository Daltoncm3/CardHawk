'use strict';

const {
  asArray,
  asObject,
  unique
} = require('./canonicalValidationCore');
const {
  buildFingerprintFromProjection
} = require('./fingerprintProjection');
const {
  buildOfflineAuthorityFlags,
  clone,
  firstDefined
} = require('./phase8GovernanceCore');

const CALIBRATION_EXPERIMENT_SCHEMA_VERSION = '1.0.0';
const CALIBRATION_EXPERIMENT_SOURCE = 'calibration_experiment_contract';
const UNKNOWN_VALUE = 'unknown';

const EXPERIMENT_TYPES = Object.freeze([
  'offline_replay',
  'offline_holdout',
  'shadow_observation',
  'shadow_runtime',
  UNKNOWN_VALUE
]);

const EXPERIMENT_STATUSES = Object.freeze({
  DRAFT: 'draft',
  APPROVAL_REQUIRED: 'approval_required',
  APPROVED_FOR_OFFLINE_RUN: 'approved_for_offline_run',
  READY_FOR_OFFLINE_RUN: 'ready_for_offline_run',
  OFFLINE_RUN_COMPLETE: 'offline_run_complete',
  RESULTS_ATTACHED: 'results_attached',
  REJECTED: 'rejected',
  ARCHIVED: 'archived'
});

const REQUIRED_EXPERIMENT_FIELDS = Object.freeze([
  'schemaVersion',
  'source',
  'experimentId',
  'experimentBatchId',
  'createdAt',
  'sourceRecommendationIds',
  'sourceRecommendationFingerprints',
  'experimentType',
  'targetSubsystem',
  'targetRule',
  'baselineBehavior',
  'proposedBehavior',
  'replayDatasetIds',
  'holdoutDatasetIds',
  'comparisonMetrics',
  'successCriteria',
  'failureCriteria',
  'regressionCriteria',
  'statisticalRequirements',
  'risks',
  'assumptions',
  'limitations',
  'rollbackPlan',
  'experimentStatus',
  'approvalArtifact',
  'resultArtifact',
  'productionImpact',
  'decisionImpact',
  'experimentFingerprint'
]);

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}

function known(value) {
  return value !== undefined && value !== null && value !== '';
}

function normalizeDate(value, fallback = UNKNOWN_VALUE) {
  if (!known(value)) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function normalizeString(value, fallback = UNKNOWN_VALUE) {
  if (!known(value)) return fallback;
  return String(value).trim() || fallback;
}

function normalizeEnum(value, allowedValues, fallback = UNKNOWN_VALUE) {
  const normalized = normalizeString(value, fallback).toLowerCase();
  return allowedValues.includes(normalized) ? normalized : normalized;
}

function normalizeStringArray(values = []) {
  return unique(asArray(values).map((value) => normalizeString(value, '')).filter(Boolean)).sort();
}

function missingRequiredFields(record = {}, fields = REQUIRED_EXPERIMENT_FIELDS) {
  const input = asObject(record);
  return fields.filter((field) => {
    const value = input[field];
    return value === undefined || value === null || value === '';
  });
}

function buildDefaultApprovalArtifact(input = {}) {
  const approval = asObject(input);
  return {
    required: approval.required !== false,
    approved: approval.approved === true,
    approver: known(approval.approver) ? String(approval.approver) : null,
    approvedAt: known(approval.approvedAt) ? normalizeDate(approval.approvedAt) : null,
    approvalScope: clone(firstDefined(approval.approvalScope, approval.scope, {})),
    approvalArtifactId: known(approval.approvalArtifactId) ? String(approval.approvalArtifactId) : null,
    approvalArtifactFingerprint: known(approval.approvalArtifactFingerprint) ? String(approval.approvalArtifactFingerprint) : null,
    notes: known(approval.notes) ? String(approval.notes) : '',
    productionImpact: 'none',
    decisionImpact: 'none'
  };
}

function buildDefaultResultArtifact(input = {}) {
  const result = asObject(input);
  return {
    available: result.available === true,
    resultArtifactId: known(result.resultArtifactId) ? String(result.resultArtifactId) : null,
    completedAt: known(result.completedAt) ? normalizeDate(result.completedAt) : null,
    resultStatus: normalizeString(result.resultStatus, UNKNOWN_VALUE),
    summary: clone(asObject(result.summary)),
    metrics: clone(asObject(result.metrics)),
    regressions: asArray(result.regressions).map((item) => clone(item)),
    counterEvidence: asArray(result.counterEvidence).map((item) => clone(item)),
    resultArtifactFingerprint: known(result.resultArtifactFingerprint) ? String(result.resultArtifactFingerprint) : null,
    productionImpact: 'none',
    decisionImpact: 'none'
  };
}

function buildCalibrationExperimentFingerprint(experiment = {}) {
  const projection = clone(experiment);
  delete projection.experimentFingerprint;
  return buildFingerprintFromProjection(projection);
}

function buildExperimentBatchFingerprint(batch = {}) {
  const projection = clone(batch);
  delete projection.experimentBatchFingerprint;
  return buildFingerprintFromProjection(projection);
}

function createCalibrationExperiment(input = {}, options = {}) {
  const experimentCore = {
    schemaVersion: CALIBRATION_EXPERIMENT_SCHEMA_VERSION,
    source: CALIBRATION_EXPERIMENT_SOURCE,
    experimentId: normalizeString(firstDefined(input.experimentId, options.experimentId, 'calibration-experiment')),
    experimentBatchId: normalizeString(firstDefined(input.experimentBatchId, options.experimentBatchId, 'calibration-experiment-batch')),
    createdAt: normalizeDate(firstDefined(input.createdAt, options.createdAt, UNKNOWN_VALUE)),
    sourceRecommendationIds: normalizeStringArray(input.sourceRecommendationIds),
    sourceRecommendationFingerprints: normalizeStringArray(input.sourceRecommendationFingerprints),
    experimentType: normalizeEnum(input.experimentType, EXPERIMENT_TYPES, 'offline_replay'),
    targetSubsystem: normalizeString(input.targetSubsystem),
    targetRule: normalizeString(input.targetRule),
    baselineBehavior: clone(asObject(input.baselineBehavior)),
    proposedBehavior: clone(asObject(input.proposedBehavior)),
    replayDatasetIds: normalizeStringArray(input.replayDatasetIds),
    holdoutDatasetIds: normalizeStringArray(input.holdoutDatasetIds),
    comparisonMetrics: asArray(input.comparisonMetrics).map((item) => clone(item)),
    successCriteria: clone(asObject(input.successCriteria)),
    failureCriteria: clone(asObject(input.failureCriteria)),
    regressionCriteria: clone(asObject(input.regressionCriteria)),
    statisticalRequirements: clone(asObject(input.statisticalRequirements)),
    risks: normalizeStringArray(input.risks),
    assumptions: normalizeStringArray(input.assumptions),
    limitations: normalizeStringArray(input.limitations),
    rollbackPlan: clone(asObject(input.rollbackPlan)),
    experimentStatus: normalizeEnum(input.experimentStatus, Object.values(EXPERIMENT_STATUSES), EXPERIMENT_STATUSES.DRAFT),
    approvalArtifact: buildDefaultApprovalArtifact(input.approvalArtifact),
    resultArtifact: buildDefaultResultArtifact(input.resultArtifact),
    authorityFlags: buildOfflineAuthorityFlags(input.authorityFlags),
    productionImpact: 'none',
    decisionImpact: 'none'
  };

  return deepFreeze({
    ...experimentCore,
    experimentFingerprint: buildCalibrationExperimentFingerprint(experimentCore)
  });
}

function cloneCalibrationExperiment(experiment = {}) {
  return clone(experiment);
}

function determineExperimentStatus(experiment = {}) {
  const object = asObject(experiment);
  if (Object.values(EXPERIMENT_STATUSES).includes(object.experimentStatus)) return object.experimentStatus;
  if (!Object.keys(object).length) return EXPERIMENT_STATUSES.DRAFT;
  if (object.resultArtifact?.available === true) return EXPERIMENT_STATUSES.RESULTS_ATTACHED;
  if (object.approvalArtifact?.approved === true) return EXPERIMENT_STATUSES.APPROVED_FOR_OFFLINE_RUN;
  return EXPERIMENT_STATUSES.APPROVAL_REQUIRED;
}

function rebuildExperimentWithFingerprint(experiment = {}) {
  const projection = clone(experiment);
  delete projection.experimentFingerprint;
  return deepFreeze({
    ...projection,
    experimentFingerprint: buildCalibrationExperimentFingerprint(projection)
  });
}

function attachApprovalArtifact(experiment = {}, approvalArtifact = {}, options = {}) {
  const nextStatus = options.experimentStatus || approvalArtifact.experimentStatus || experiment.experimentStatus;
  const nextExperiment = {
    ...clone(experiment),
    approvalArtifact: buildDefaultApprovalArtifact({
      ...asObject(experiment.approvalArtifact),
      ...asObject(approvalArtifact)
    }),
    experimentStatus: normalizeEnum(nextStatus, Object.values(EXPERIMENT_STATUSES), experiment.experimentStatus || EXPERIMENT_STATUSES.APPROVED_FOR_OFFLINE_RUN)
  };
  return rebuildExperimentWithFingerprint(nextExperiment);
}

function attachExperimentResults(experiment = {}, resultArtifact = {}, options = {}) {
  const nextStatus = options.experimentStatus || resultArtifact.experimentStatus || experiment.experimentStatus;
  const nextExperiment = {
    ...clone(experiment),
    resultArtifact: buildDefaultResultArtifact({
      ...asObject(experiment.resultArtifact),
      ...asObject(resultArtifact),
      available: true
    }),
    experimentStatus: normalizeEnum(nextStatus, Object.values(EXPERIMENT_STATUSES), experiment.experimentStatus || EXPERIMENT_STATUSES.RESULTS_ATTACHED)
  };
  return rebuildExperimentWithFingerprint(nextExperiment);
}

function validationError(code, message, field = '') {
  return { code, message, field };
}

function validateEnum(record, field, allowedValues, errors, invalidFields) {
  if (!allowedValues.includes(record[field])) {
    errors.push(validationError('invalid_enum_value', `${field} must be one of: ${allowedValues.join(', ')}`, field));
    invalidFields.push(field);
  }
}

function validateCalibrationExperiment(experiment = {}) {
  const errors = [];
  const warnings = [];
  const invalidFields = [];
  const missing = missingRequiredFields(experiment);

  for (const field of missing) {
    errors.push(validationError('missing_required_field', `${field} is required.`, field));
    invalidFields.push(field);
  }

  if (experiment.schemaVersion !== CALIBRATION_EXPERIMENT_SCHEMA_VERSION) {
    errors.push(validationError('invalid_schema_version', 'schemaVersion must match Calibration Experiment schema.', 'schemaVersion'));
    invalidFields.push('schemaVersion');
  }
  if (experiment.source !== CALIBRATION_EXPERIMENT_SOURCE) {
    errors.push(validationError('invalid_source', 'source must be calibration_experiment_contract.', 'source'));
    invalidFields.push('source');
  }
  validateEnum(experiment, 'experimentType', EXPERIMENT_TYPES, errors, invalidFields);
  validateEnum(experiment, 'experimentStatus', Object.values(EXPERIMENT_STATUSES), errors, invalidFields);

  if (!Array.isArray(experiment.sourceRecommendationIds)) {
    errors.push(validationError('invalid_source_recommendation_ids', 'sourceRecommendationIds must be an array.', 'sourceRecommendationIds'));
    invalidFields.push('sourceRecommendationIds');
  }
  if (!Array.isArray(experiment.sourceRecommendationFingerprints)) {
    errors.push(validationError('invalid_source_recommendation_fingerprints', 'sourceRecommendationFingerprints must be an array.', 'sourceRecommendationFingerprints'));
    invalidFields.push('sourceRecommendationFingerprints');
  }
  if (!Array.isArray(experiment.replayDatasetIds)) {
    errors.push(validationError('invalid_replay_dataset_ids', 'replayDatasetIds must be an array.', 'replayDatasetIds'));
    invalidFields.push('replayDatasetIds');
  }
  if (!Array.isArray(experiment.holdoutDatasetIds)) {
    errors.push(validationError('invalid_holdout_dataset_ids', 'holdoutDatasetIds must be an array.', 'holdoutDatasetIds'));
    invalidFields.push('holdoutDatasetIds');
  }
  if (!Array.isArray(experiment.comparisonMetrics)) {
    errors.push(validationError('invalid_comparison_metrics', 'comparisonMetrics must be an array.', 'comparisonMetrics'));
    invalidFields.push('comparisonMetrics');
  }

  if (experiment.productionImpact !== 'none') {
    errors.push(validationError('invalid_production_impact', 'productionImpact must remain none.', 'productionImpact'));
    invalidFields.push('productionImpact');
  }
  if (experiment.decisionImpact !== 'none') {
    errors.push(validationError('invalid_decision_impact', 'decisionImpact must remain none.', 'decisionImpact'));
    invalidFields.push('decisionImpact');
  }

  const approval = asObject(experiment.approvalArtifact);
  if (approval.productionImpact !== 'none') {
    errors.push(validationError('invalid_approval_production_impact', 'approvalArtifact must not affect production.', 'approvalArtifact.productionImpact'));
    invalidFields.push('approvalArtifact.productionImpact');
  }
  if (approval.decisionImpact !== 'none') {
    errors.push(validationError('invalid_approval_decision_impact', 'approvalArtifact must not affect decisions.', 'approvalArtifact.decisionImpact'));
    invalidFields.push('approvalArtifact.decisionImpact');
  }
  if (approval.approved === true && (!known(approval.approver) || !known(approval.approvedAt))) {
    warnings.push(validationError('approval_metadata_incomplete', 'Approved experiments should include approver and approvedAt.', 'approvalArtifact'));
  }

  const result = asObject(experiment.resultArtifact);
  if (result.productionImpact !== 'none') {
    errors.push(validationError('invalid_result_production_impact', 'resultArtifact must not affect production.', 'resultArtifact.productionImpact'));
    invalidFields.push('resultArtifact.productionImpact');
  }
  if (result.decisionImpact !== 'none') {
    errors.push(validationError('invalid_result_decision_impact', 'resultArtifact must not affect decisions.', 'resultArtifact.decisionImpact'));
    invalidFields.push('resultArtifact.decisionImpact');
  }
  if (result.available === true && !known(result.resultArtifactFingerprint)) {
    warnings.push(validationError('result_fingerprint_missing', 'Available experiment results should include resultArtifactFingerprint.', 'resultArtifact.resultArtifactFingerprint'));
  }

  if (experiment.experimentFingerprint && buildCalibrationExperimentFingerprint(experiment) !== experiment.experimentFingerprint) {
    errors.push(validationError('experiment_fingerprint_mismatch', 'experimentFingerprint does not match experiment contents.', 'experimentFingerprint'));
    invalidFields.push('experimentFingerprint');
  }

  const reasonCodes = unique([
    ...errors.map((error) => error.code),
    ...warnings.map((warning) => warning.code)
  ]);

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes,
    invalidFields: unique(invalidFields),
    missingRequiredFields: unique(missing)
  };
}

module.exports = {
  CALIBRATION_EXPERIMENT_SCHEMA_VERSION,
  CALIBRATION_EXPERIMENT_SOURCE,
  EXPERIMENT_STATUSES,
  EXPERIMENT_TYPES,
  REQUIRED_EXPERIMENT_FIELDS,
  UNKNOWN_VALUE,
  attachApprovalArtifact,
  attachExperimentResults,
  buildCalibrationExperimentFingerprint,
  buildExperimentBatchFingerprint,
  cloneCalibrationExperiment,
  createCalibrationExperiment,
  determineExperimentStatus,
  validateCalibrationExperiment
};
