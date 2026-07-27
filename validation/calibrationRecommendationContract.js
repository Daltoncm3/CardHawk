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

const CALIBRATION_RECOMMENDATION_SCHEMA_VERSION = '1.0.0';
const CALIBRATION_RECOMMENDATION_SOURCE = 'calibration_recommendation_contract';
const UNKNOWN_VALUE = 'unknown';

const RECOMMENDATION_CATEGORIES = Object.freeze([
  'identity_parsing_improvement',
  'canonical_identity_improvement',
  'evidence_sufficiency_adjustment',
  'valuation_methodology_adjustment',
  'confidence_calibration_adjustment',
  'risk_rule_adjustment',
  'grading_or_quality_adjustment',
  'deal_gate_rule_review',
  'buy_now_threshold_review',
  'notification_threshold_review',
  'false_positive_reduction',
  'missed_opportunity_reduction',
  'diagnostic_improvement',
  'insufficient_data_finding',
  'no_change_recommendation'
]);

const RECOMMENDATION_STATUSES = Object.freeze({
  OBSERVED: 'observed',
  DRAFTED: 'drafted',
  EVIDENCE_INSUFFICIENT: 'evidence_insufficient',
  CANDIDATE: 'candidate',
  REVIEWED: 'reviewed',
  REJECTED: 'rejected',
  APPROVED_FOR_OFFLINE_EXPERIMENT: 'approved_for_offline_experiment',
  APPROVED_FOR_SHADOW_EXPERIMENT: 'approved_for_shadow_experiment',
  SHADOW_VALIDATED: 'shadow_validated',
  REJECTED_AFTER_VALIDATION: 'rejected_after_validation',
  ELIGIBLE_FOR_PRODUCTION_PROPOSAL: 'eligible_for_production_proposal',
  PRODUCTION_PROPOSAL_APPROVED: 'production_proposal_approved',
  ARCHIVED: 'archived'
});

const CONFIDENCE_LEVELS = Object.freeze([
  'high',
  'moderate',
  'low',
  'insufficient',
  UNKNOWN_VALUE
]);

const EVIDENCE_STRENGTH_LEVELS = Object.freeze([
  'strong',
  'adequate',
  'limited',
  'weak',
  'insufficient',
  UNKNOWN_VALUE
]);

const REQUIRED_RECOMMENDATION_FIELDS = Object.freeze([
  'schemaVersion',
  'source',
  'recommendationId',
  'recommendationBatchId',
  'createdAt',
  'sourceDatasetIds',
  'sourceDatasetFingerprints',
  'recommendationCategory',
  'affectedSubsystem',
  'affectedRuleOrField',
  'finding',
  'evidenceSummary',
  'sampleSize',
  'coverage',
  'currentBehavior',
  'proposedBehavior',
  'expectedBenefit',
  'identifiedRisks',
  'confidence',
  'confidenceLevel',
  'evidenceStrength',
  'counterEvidence',
  'prerequisites',
  'validationPlan',
  'rollbackPlan',
  'recommendationStatus',
  'reviewerApproval',
  'productionImpact',
  'decisionImpact',
  'recommendationFingerprint'
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

function normalizeConfidence(value) {
  if (!known(value) || value === UNKNOWN_VALUE) return UNKNOWN_VALUE;
  const number = Number(value);
  return Number.isFinite(number) ? number : value;
}

function missingRequiredFields(record = {}, fields = REQUIRED_RECOMMENDATION_FIELDS) {
  const input = asObject(record);
  return fields.filter((field) => {
    const value = input[field];
    return value === undefined || value === null || value === '';
  });
}

function buildDefaultApproval(input = {}) {
  const approval = asObject(input);
  return {
    required: approval.required !== false,
    approved: approval.approved === true,
    reviewer: known(approval.reviewer) ? String(approval.reviewer) : null,
    approvedAt: known(approval.approvedAt) ? normalizeDate(approval.approvedAt) : null,
    approvalScope: clone(firstDefined(approval.approvalScope, approval.scope, {})),
    approvalArtifactFingerprint: known(approval.approvalArtifactFingerprint) ? String(approval.approvalArtifactFingerprint) : null,
    notes: known(approval.notes) ? String(approval.notes) : ''
  };
}

function buildCalibrationRecommendationFingerprint(recommendation = {}) {
  const projection = clone(recommendation);
  delete projection.recommendationFingerprint;
  return buildFingerprintFromProjection(projection);
}

function buildRecommendationBatchFingerprint(batch = {}) {
  const projection = clone(batch);
  delete projection.recommendationBatchFingerprint;
  return buildFingerprintFromProjection(projection);
}

function createCalibrationRecommendation(input = {}, options = {}) {
  const recommendationCore = {
    schemaVersion: CALIBRATION_RECOMMENDATION_SCHEMA_VERSION,
    source: CALIBRATION_RECOMMENDATION_SOURCE,
    recommendationId: normalizeString(firstDefined(input.recommendationId, options.recommendationId, 'calibration-recommendation')),
    recommendationBatchId: normalizeString(firstDefined(input.recommendationBatchId, options.recommendationBatchId, 'calibration-recommendation-batch')),
    createdAt: normalizeDate(firstDefined(input.createdAt, options.createdAt, UNKNOWN_VALUE)),
    sourceDatasetIds: normalizeStringArray(input.sourceDatasetIds),
    sourceDatasetFingerprints: normalizeStringArray(input.sourceDatasetFingerprints),
    recommendationCategory: normalizeEnum(input.recommendationCategory, RECOMMENDATION_CATEGORIES, 'insufficient_data_finding'),
    affectedSubsystem: normalizeString(input.affectedSubsystem),
    affectedRuleOrField: normalizeString(input.affectedRuleOrField),
    finding: clone(asObject(input.finding)),
    evidenceSummary: clone(asObject(input.evidenceSummary)),
    sampleSize: clone(asObject(input.sampleSize)),
    coverage: clone(asObject(input.coverage)),
    currentBehavior: clone(asObject(input.currentBehavior)),
    proposedBehavior: clone(asObject(input.proposedBehavior)),
    expectedBenefit: clone(asObject(input.expectedBenefit)),
    identifiedRisks: normalizeStringArray(input.identifiedRisks),
    confidence: normalizeConfidence(input.confidence),
    confidenceLevel: normalizeEnum(input.confidenceLevel, CONFIDENCE_LEVELS, 'insufficient'),
    evidenceStrength: normalizeEnum(input.evidenceStrength, EVIDENCE_STRENGTH_LEVELS, 'insufficient'),
    counterEvidence: asArray(input.counterEvidence).map((item) => clone(item)),
    prerequisites: asArray(input.prerequisites).map((item) => clone(item)),
    validationPlan: clone(asObject(input.validationPlan)),
    rollbackPlan: clone(asObject(input.rollbackPlan)),
    recommendationStatus: normalizeEnum(input.recommendationStatus, Object.values(RECOMMENDATION_STATUSES), RECOMMENDATION_STATUSES.DRAFTED),
    reviewerApproval: buildDefaultApproval(input.reviewerApproval),
    experimentReferences: asArray(input.experimentReferences).map((reference) => clone(reference)),
    authorityFlags: buildOfflineAuthorityFlags(input.authorityFlags),
    productionImpact: 'none',
    decisionImpact: 'none'
  };

  return deepFreeze({
    ...recommendationCore,
    recommendationFingerprint: buildCalibrationRecommendationFingerprint(recommendationCore)
  });
}

function cloneCalibrationRecommendation(recommendation = {}) {
  return clone(recommendation);
}

function determineRecommendationStatus(recommendation = {}) {
  const object = asObject(recommendation);
  if (Object.values(RECOMMENDATION_STATUSES).includes(object.recommendationStatus)) return object.recommendationStatus;
  if (!Object.keys(object).length) return RECOMMENDATION_STATUSES.OBSERVED;
  if (object.reviewerApproval?.approved === true) return RECOMMENDATION_STATUSES.REVIEWED;
  return RECOMMENDATION_STATUSES.DRAFTED;
}

function rebuildRecommendationWithFingerprint(recommendation = {}) {
  const projection = clone(recommendation);
  delete projection.recommendationFingerprint;
  return deepFreeze({
    ...projection,
    recommendationFingerprint: buildCalibrationRecommendationFingerprint(projection)
  });
}

function attachApprovalMetadata(recommendation = {}, approvalMetadata = {}, options = {}) {
  const nextStatus = options.recommendationStatus || approvalMetadata.recommendationStatus || recommendation.recommendationStatus;
  const nextRecommendation = {
    ...clone(recommendation),
    reviewerApproval: buildDefaultApproval({
      ...asObject(recommendation.reviewerApproval),
      ...asObject(approvalMetadata)
    }),
    recommendationStatus: normalizeEnum(nextStatus, Object.values(RECOMMENDATION_STATUSES), recommendation.recommendationStatus || RECOMMENDATION_STATUSES.REVIEWED)
  };
  return rebuildRecommendationWithFingerprint(nextRecommendation);
}

function attachExperimentReference(recommendation = {}, experimentReference = {}, options = {}) {
  const reference = {
    experimentId: normalizeString(firstDefined(experimentReference.experimentId, experimentReference.id)),
    experimentType: normalizeString(firstDefined(experimentReference.experimentType, experimentReference.type)),
    experimentStatus: normalizeString(firstDefined(experimentReference.experimentStatus, experimentReference.status)),
    experimentFingerprint: normalizeString(firstDefined(experimentReference.experimentFingerprint, experimentReference.fingerprint)),
    attachedAt: normalizeDate(firstDefined(experimentReference.attachedAt, options.attachedAt, UNKNOWN_VALUE)),
    productionImpact: 'none',
    decisionImpact: 'none',
    details: clone(asObject(experimentReference.details))
  };
  const nextRecommendation = {
    ...clone(recommendation),
    experimentReferences: [
      ...asArray(recommendation.experimentReferences).map((item) => clone(item)),
      reference
    ],
    recommendationStatus: normalizeEnum(
      options.recommendationStatus || recommendation.recommendationStatus,
      Object.values(RECOMMENDATION_STATUSES),
      recommendation.recommendationStatus || RECOMMENDATION_STATUSES.APPROVED_FOR_OFFLINE_EXPERIMENT
    )
  };
  return rebuildRecommendationWithFingerprint(nextRecommendation);
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

function validateCalibrationRecommendation(recommendation = {}) {
  const errors = [];
  const warnings = [];
  const invalidFields = [];
  const missing = missingRequiredFields(recommendation);

  for (const field of missing) {
    errors.push(validationError('missing_required_field', `${field} is required.`, field));
    invalidFields.push(field);
  }

  if (recommendation.schemaVersion !== CALIBRATION_RECOMMENDATION_SCHEMA_VERSION) {
    errors.push(validationError('invalid_schema_version', 'schemaVersion must match Calibration Recommendation schema.', 'schemaVersion'));
    invalidFields.push('schemaVersion');
  }
  if (recommendation.source !== CALIBRATION_RECOMMENDATION_SOURCE) {
    errors.push(validationError('invalid_source', 'source must be calibration_recommendation_contract.', 'source'));
    invalidFields.push('source');
  }
  validateEnum(recommendation, 'recommendationCategory', RECOMMENDATION_CATEGORIES, errors, invalidFields);
  validateEnum(recommendation, 'recommendationStatus', Object.values(RECOMMENDATION_STATUSES), errors, invalidFields);
  validateEnum(recommendation, 'confidenceLevel', CONFIDENCE_LEVELS, errors, invalidFields);
  validateEnum(recommendation, 'evidenceStrength', EVIDENCE_STRENGTH_LEVELS, errors, invalidFields);

  if (recommendation.productionImpact !== 'none') {
    errors.push(validationError('invalid_production_impact', 'productionImpact must remain none.', 'productionImpact'));
    invalidFields.push('productionImpact');
  }
  if (recommendation.decisionImpact !== 'none') {
    errors.push(validationError('invalid_decision_impact', 'decisionImpact must remain none.', 'decisionImpact'));
    invalidFields.push('decisionImpact');
  }

  if (!Array.isArray(recommendation.sourceDatasetIds)) {
    errors.push(validationError('invalid_source_dataset_ids', 'sourceDatasetIds must be an array.', 'sourceDatasetIds'));
    invalidFields.push('sourceDatasetIds');
  }
  if (!Array.isArray(recommendation.sourceDatasetFingerprints)) {
    errors.push(validationError('invalid_source_dataset_fingerprints', 'sourceDatasetFingerprints must be an array.', 'sourceDatasetFingerprints'));
    invalidFields.push('sourceDatasetFingerprints');
  }

  if (recommendation.confidence !== UNKNOWN_VALUE) {
    const confidence = Number(recommendation.confidence);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 100) {
      errors.push(validationError('invalid_confidence', 'confidence must be 0-100 or unknown.', 'confidence'));
      invalidFields.push('confidence');
    }
  }

  const approval = asObject(recommendation.reviewerApproval);
  if (approval.approved === true && (!known(approval.reviewer) || !known(approval.approvedAt))) {
    warnings.push(validationError('approval_metadata_incomplete', 'Approved recommendations should include reviewer and approvedAt.', 'reviewerApproval'));
  }

  for (const [index, reference] of asArray(recommendation.experimentReferences).entries()) {
    if (reference.productionImpact !== 'none') {
      errors.push(validationError('invalid_experiment_reference_production_impact', 'Experiment references must not affect production.', `experimentReferences.${index}.productionImpact`));
      invalidFields.push(`experimentReferences.${index}.productionImpact`);
    }
    if (reference.decisionImpact !== 'none') {
      errors.push(validationError('invalid_experiment_reference_decision_impact', 'Experiment references must not affect decisions.', `experimentReferences.${index}.decisionImpact`));
      invalidFields.push(`experimentReferences.${index}.decisionImpact`);
    }
  }

  if (recommendation.recommendationFingerprint && buildCalibrationRecommendationFingerprint(recommendation) !== recommendation.recommendationFingerprint) {
    errors.push(validationError('recommendation_fingerprint_mismatch', 'recommendationFingerprint does not match recommendation contents.', 'recommendationFingerprint'));
    invalidFields.push('recommendationFingerprint');
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
  CALIBRATION_RECOMMENDATION_SCHEMA_VERSION,
  CALIBRATION_RECOMMENDATION_SOURCE,
  CONFIDENCE_LEVELS,
  EVIDENCE_STRENGTH_LEVELS,
  RECOMMENDATION_CATEGORIES,
  RECOMMENDATION_STATUSES,
  REQUIRED_RECOMMENDATION_FIELDS,
  UNKNOWN_VALUE,
  attachApprovalMetadata,
  attachExperimentReference,
  buildCalibrationRecommendationFingerprint,
  buildRecommendationBatchFingerprint,
  cloneCalibrationRecommendation,
  createCalibrationRecommendation,
  determineRecommendationStatus,
  validateCalibrationRecommendation
};
