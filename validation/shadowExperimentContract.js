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

const SHADOW_EXPERIMENT_SCHEMA_VERSION = '1.0.0';
const SHADOW_EXPERIMENT_SOURCE = 'shadow_experiment_contract';
const UNKNOWN_VALUE = 'unknown';

const SHADOW_EXPERIMENT_STATUSES = Object.freeze({
  DRAFT: 'draft',
  BLOCKED: 'blocked',
  APPROVAL_REQUIRED: 'approval_required',
  APPROVED_FOR_SHADOW_OBSERVATION: 'approved_for_shadow_observation',
  ACTIVE_SHADOW_OBSERVATION: 'active_shadow_observation',
  OBSERVATION_COMPLETE: 'observation_complete',
  ANALYSIS_COMPLETE: 'analysis_complete',
  READY_FOR_PRODUCTION_PROPOSAL_REVIEW: 'ready_for_production_proposal_review',
  REJECTED: 'rejected',
  ARCHIVED: 'archived'
});

const REQUIRED_SHADOW_EXPERIMENT_FIELDS = Object.freeze([
  'schemaVersion',
  'source',
  'shadowExperimentId',
  'shadowExperimentBatchId',
  'createdAt',
  'sourceExperimentIds',
  'sourceExperimentFingerprints',
  'targetSubsystem',
  'observationScope',
  'productionBaselineReference',
  'shadowConfigurationReference',
  'observationMetrics',
  'comparisonMetrics',
  'regressionCriteria',
  'successCriteria',
  'statisticalRequirements',
  'monitoringRequirements',
  'rollbackPlan',
  'shadowExperimentStatus',
  'approvalArtifact',
  'shadowResultReference',
  'productionImpact',
  'decisionImpact',
  'shadowExperimentFingerprint'
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

function missingRequiredFields(record = {}, fields = REQUIRED_SHADOW_EXPERIMENT_FIELDS) {
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
    approvedObservationWindow: clone(asObject(approval.approvedObservationWindow)),
    approvedMetricPlan: clone(asObject(approval.approvedMetricPlan)),
    approvedRollbackPlan: clone(asObject(approval.approvedRollbackPlan)),
    authorityStatement: normalizeString(
      firstDefined(approval.authorityStatement, approval.authority),
      'shadow observation only; no production authority'
    ),
    approvalArtifactId: known(approval.approvalArtifactId) ? String(approval.approvalArtifactId) : null,
    approvalArtifactFingerprint: known(approval.approvalArtifactFingerprint) ? String(approval.approvalArtifactFingerprint) : null,
    limitations: normalizeStringArray(approval.limitations),
    notes: known(approval.notes) ? String(approval.notes) : '',
    productionImpact: 'none',
    decisionImpact: 'none'
  };
}

function buildDefaultShadowResultReference(input = {}) {
  const reference = asObject(input);
  return {
    available: reference.available === true,
    shadowResultId: known(reference.shadowResultId) ? String(reference.shadowResultId) : null,
    shadowExperimentId: known(reference.shadowExperimentId) ? String(reference.shadowExperimentId) : null,
    attachedAt: known(reference.attachedAt) ? normalizeDate(reference.attachedAt) : null,
    resultStatus: normalizeString(reference.resultStatus, UNKNOWN_VALUE),
    resultFingerprint: known(reference.resultFingerprint) ? String(reference.resultFingerprint) : null,
    summary: clone(asObject(reference.summary)),
    productionImpact: 'none',
    decisionImpact: 'none'
  };
}

function buildShadowExperimentFingerprint(shadowExperiment = {}) {
  const projection = clone(shadowExperiment);
  delete projection.shadowExperimentFingerprint;
  return buildFingerprintFromProjection(projection);
}

function buildShadowExperimentBatchFingerprint(batch = {}) {
  const projection = clone(batch);
  delete projection.shadowExperimentBatchFingerprint;
  return buildFingerprintFromProjection(projection);
}

function createShadowExperiment(input = {}, options = {}) {
  const shadowExperimentCore = {
    schemaVersion: SHADOW_EXPERIMENT_SCHEMA_VERSION,
    source: SHADOW_EXPERIMENT_SOURCE,
    shadowExperimentId: normalizeString(firstDefined(input.shadowExperimentId, options.shadowExperimentId, 'shadow-experiment')),
    shadowExperimentBatchId: normalizeString(firstDefined(input.shadowExperimentBatchId, options.shadowExperimentBatchId, 'shadow-experiment-batch')),
    createdAt: normalizeDate(firstDefined(input.createdAt, options.createdAt, UNKNOWN_VALUE)),
    sourceExperimentIds: normalizeStringArray(input.sourceExperimentIds),
    sourceExperimentFingerprints: normalizeStringArray(input.sourceExperimentFingerprints),
    targetSubsystem: normalizeString(input.targetSubsystem),
    observationScope: clone(asObject(input.observationScope)),
    productionBaselineReference: clone(asObject(input.productionBaselineReference)),
    shadowConfigurationReference: clone(asObject(input.shadowConfigurationReference)),
    observationMetrics: asArray(input.observationMetrics).map((metric) => clone(metric)),
    comparisonMetrics: asArray(input.comparisonMetrics).map((metric) => clone(metric)),
    regressionCriteria: clone(asObject(input.regressionCriteria)),
    successCriteria: clone(asObject(input.successCriteria)),
    statisticalRequirements: clone(asObject(input.statisticalRequirements)),
    monitoringRequirements: clone(asObject(input.monitoringRequirements)),
    rollbackPlan: clone(asObject(input.rollbackPlan)),
    shadowExperimentStatus: normalizeEnum(
      input.shadowExperimentStatus,
      Object.values(SHADOW_EXPERIMENT_STATUSES),
      SHADOW_EXPERIMENT_STATUSES.DRAFT
    ),
    approvalArtifact: buildDefaultApprovalArtifact(input.approvalArtifact),
    shadowResultReference: buildDefaultShadowResultReference(input.shadowResultReference),
    authorityFlags: buildOfflineAuthorityFlags(input.authorityFlags),
    productionImpact: 'none',
    decisionImpact: 'none'
  };

  return deepFreeze({
    ...shadowExperimentCore,
    shadowExperimentFingerprint: buildShadowExperimentFingerprint(shadowExperimentCore)
  });
}

function cloneShadowExperiment(shadowExperiment = {}) {
  return clone(shadowExperiment);
}

function determineShadowExperimentStatus(shadowExperiment = {}) {
  const object = asObject(shadowExperiment);
  if (Object.values(SHADOW_EXPERIMENT_STATUSES).includes(object.shadowExperimentStatus)) return object.shadowExperimentStatus;
  if (!Object.keys(object).length) return SHADOW_EXPERIMENT_STATUSES.DRAFT;
  if (object.shadowResultReference?.available === true) return SHADOW_EXPERIMENT_STATUSES.ANALYSIS_COMPLETE;
  if (object.approvalArtifact?.approved === true) return SHADOW_EXPERIMENT_STATUSES.APPROVED_FOR_SHADOW_OBSERVATION;
  return SHADOW_EXPERIMENT_STATUSES.APPROVAL_REQUIRED;
}

function rebuildShadowExperimentWithFingerprint(shadowExperiment = {}) {
  const projection = clone(shadowExperiment);
  delete projection.shadowExperimentFingerprint;
  return deepFreeze({
    ...projection,
    shadowExperimentFingerprint: buildShadowExperimentFingerprint(projection)
  });
}

function attachApprovalArtifact(shadowExperiment = {}, approvalArtifact = {}, options = {}) {
  const nextStatus = options.shadowExperimentStatus || approvalArtifact.shadowExperimentStatus || shadowExperiment.shadowExperimentStatus;
  const nextShadowExperiment = {
    ...clone(shadowExperiment),
    approvalArtifact: buildDefaultApprovalArtifact({
      ...asObject(shadowExperiment.approvalArtifact),
      ...asObject(approvalArtifact)
    }),
    shadowExperimentStatus: normalizeEnum(
      nextStatus,
      Object.values(SHADOW_EXPERIMENT_STATUSES),
      shadowExperiment.shadowExperimentStatus || SHADOW_EXPERIMENT_STATUSES.APPROVED_FOR_SHADOW_OBSERVATION
    )
  };
  return rebuildShadowExperimentWithFingerprint(nextShadowExperiment);
}

function attachShadowResultsReference(shadowExperiment = {}, shadowResultReference = {}, options = {}) {
  const nextStatus = options.shadowExperimentStatus || shadowResultReference.shadowExperimentStatus || shadowExperiment.shadowExperimentStatus;
  const nextShadowExperiment = {
    ...clone(shadowExperiment),
    shadowResultReference: buildDefaultShadowResultReference({
      ...asObject(shadowExperiment.shadowResultReference),
      ...asObject(shadowResultReference),
      available: true
    }),
    shadowExperimentStatus: normalizeEnum(
      nextStatus,
      Object.values(SHADOW_EXPERIMENT_STATUSES),
      shadowExperiment.shadowExperimentStatus || SHADOW_EXPERIMENT_STATUSES.ANALYSIS_COMPLETE
    )
  };
  return rebuildShadowExperimentWithFingerprint(nextShadowExperiment);
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

function validateShadowExperiment(shadowExperiment = {}) {
  const errors = [];
  const warnings = [];
  const invalidFields = [];
  const missing = missingRequiredFields(shadowExperiment);

  for (const field of missing) {
    errors.push(validationError('missing_required_field', `${field} is required.`, field));
    invalidFields.push(field);
  }

  if (shadowExperiment.schemaVersion !== SHADOW_EXPERIMENT_SCHEMA_VERSION) {
    errors.push(validationError('invalid_schema_version', 'schemaVersion must match Shadow Experiment schema.', 'schemaVersion'));
    invalidFields.push('schemaVersion');
  }
  if (shadowExperiment.source !== SHADOW_EXPERIMENT_SOURCE) {
    errors.push(validationError('invalid_source', 'source must be shadow_experiment_contract.', 'source'));
    invalidFields.push('source');
  }
  validateEnum(shadowExperiment, 'shadowExperimentStatus', Object.values(SHADOW_EXPERIMENT_STATUSES), errors, invalidFields);

  if (!Array.isArray(shadowExperiment.sourceExperimentIds)) {
    errors.push(validationError('invalid_source_experiment_ids', 'sourceExperimentIds must be an array.', 'sourceExperimentIds'));
    invalidFields.push('sourceExperimentIds');
  }
  if (!Array.isArray(shadowExperiment.sourceExperimentFingerprints)) {
    errors.push(validationError('invalid_source_experiment_fingerprints', 'sourceExperimentFingerprints must be an array.', 'sourceExperimentFingerprints'));
    invalidFields.push('sourceExperimentFingerprints');
  }
  if (!Array.isArray(shadowExperiment.observationMetrics)) {
    errors.push(validationError('invalid_observation_metrics', 'observationMetrics must be an array.', 'observationMetrics'));
    invalidFields.push('observationMetrics');
  }
  if (!Array.isArray(shadowExperiment.comparisonMetrics)) {
    errors.push(validationError('invalid_comparison_metrics', 'comparisonMetrics must be an array.', 'comparisonMetrics'));
    invalidFields.push('comparisonMetrics');
  }

  if (shadowExperiment.productionImpact !== 'none') {
    errors.push(validationError('invalid_production_impact', 'productionImpact must remain none.', 'productionImpact'));
    invalidFields.push('productionImpact');
  }
  if (shadowExperiment.decisionImpact !== 'none') {
    errors.push(validationError('invalid_decision_impact', 'decisionImpact must remain none.', 'decisionImpact'));
    invalidFields.push('decisionImpact');
  }

  const approval = asObject(shadowExperiment.approvalArtifact);
  if (approval.productionImpact !== 'none') {
    errors.push(validationError('invalid_approval_production_impact', 'approvalArtifact must not affect production.', 'approvalArtifact.productionImpact'));
    invalidFields.push('approvalArtifact.productionImpact');
  }
  if (approval.decisionImpact !== 'none') {
    errors.push(validationError('invalid_approval_decision_impact', 'approvalArtifact must not affect decisions.', 'approvalArtifact.decisionImpact'));
    invalidFields.push('approvalArtifact.decisionImpact');
  }
  if (approval.approved === true && (!known(approval.approver) || !known(approval.approvedAt))) {
    warnings.push(validationError('approval_metadata_incomplete', 'Approved shadow experiments should include approver and approvedAt.', 'approvalArtifact'));
  }

  const result = asObject(shadowExperiment.shadowResultReference);
  if (result.productionImpact !== 'none') {
    errors.push(validationError('invalid_result_production_impact', 'shadowResultReference must not affect production.', 'shadowResultReference.productionImpact'));
    invalidFields.push('shadowResultReference.productionImpact');
  }
  if (result.decisionImpact !== 'none') {
    errors.push(validationError('invalid_result_decision_impact', 'shadowResultReference must not affect decisions.', 'shadowResultReference.decisionImpact'));
    invalidFields.push('shadowResultReference.decisionImpact');
  }
  if (result.available === true && !known(result.resultFingerprint)) {
    warnings.push(validationError('result_fingerprint_missing', 'Available shadow result references should include resultFingerprint.', 'shadowResultReference.resultFingerprint'));
  }

  if (shadowExperiment.shadowExperimentFingerprint && buildShadowExperimentFingerprint(shadowExperiment) !== shadowExperiment.shadowExperimentFingerprint) {
    errors.push(validationError('shadow_experiment_fingerprint_mismatch', 'shadowExperimentFingerprint does not match shadow experiment contents.', 'shadowExperimentFingerprint'));
    invalidFields.push('shadowExperimentFingerprint');
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
  REQUIRED_SHADOW_EXPERIMENT_FIELDS,
  SHADOW_EXPERIMENT_SCHEMA_VERSION,
  SHADOW_EXPERIMENT_SOURCE,
  SHADOW_EXPERIMENT_STATUSES,
  UNKNOWN_VALUE,
  attachApprovalArtifact,
  attachShadowResultsReference,
  buildShadowExperimentBatchFingerprint,
  buildShadowExperimentFingerprint,
  cloneShadowExperiment,
  createShadowExperiment,
  determineShadowExperimentStatus,
  validateShadowExperiment
};
