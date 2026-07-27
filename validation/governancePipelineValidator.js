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
  clone,
  firstDefined
} = require('./phase8GovernanceCore');
const reviewContract = require('./realListingDecisionReviewContract');
const reviewBatchBuilder = require('./realListingReviewBatchBuilder');
const daltonReviewWorkspace = require('./daltonReviewWorkspace');
const calibrationDatasetBuilder = require('./calibrationDatasetBuilder');
const calibrationRecommendationContract = require('./calibrationRecommendationContract');
const calibrationExperimentContract = require('./calibrationExperimentContract');
const calibrationExperimentRunner = require('./calibrationExperimentRunner');
const shadowExperimentContract = require('./shadowExperimentContract');
const shadowExperimentRunner = require('./shadowExperimentRunner');
const productionProposalContract = require('./productionProposalContract');
const productionApprovalArtifact = require('./productionApprovalArtifact');
const deploymentValidationArtifact = require('./deploymentValidationArtifact');

const GOVERNANCE_PIPELINE_VALIDATOR_SCHEMA_VERSION = '1.0.0';
const GOVERNANCE_PIPELINE_VALIDATOR_SOURCE = 'governance_pipeline_validator';
const UNKNOWN_VALUE = 'unknown';

const PIPELINE_ARTIFACT_KEYS = Object.freeze([
  'reviewPackage',
  'reviewBatch',
  'reviewWorkspace',
  'calibrationDataset',
  'calibrationRecommendation',
  'offlineExperiment',
  'offlineExperimentResult',
  'shadowExperiment',
  'shadowResult',
  'productionProposal',
  'productionApprovalArtifact',
  'deploymentValidationArtifact'
]);

const READINESS_LEVELS = Object.freeze({
  VALID: 'valid',
  INCOMPLETE: 'incomplete',
  BLOCKED: 'blocked',
  INVALID: 'invalid'
});

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}

function known(value) {
  return value !== undefined && value !== null && value !== '';
}

function validationError(code, message, field = '', artifact = '') {
  return { code, message, field, artifact };
}

function getArtifact(input = {}, key) {
  const object = asObject(input);
  const aliases = {
    productionApprovalArtifact: ['productionApprovalArtifact', 'approvalArtifact', 'approval'],
    deploymentValidationArtifact: ['deploymentValidationArtifact', 'deploymentValidation', 'validationArtifact'],
    offlineExperiment: ['offlineExperiment', 'calibrationExperiment'],
    offlineExperimentResult: ['offlineExperimentResult', 'calibrationExperimentResult'],
    reviewWorkspace: ['reviewWorkspace', 'daltonReviewWorkspace'],
    calibrationRecommendation: ['calibrationRecommendation', 'recommendation']
  };
  for (const candidate of aliases[key] || [key]) {
    if (object[candidate]) return object[candidate];
  }
  return undefined;
}

function getArtifacts(pipeline = {}) {
  return PIPELINE_ARTIFACT_KEYS.reduce((artifacts, key) => {
    artifacts[key] = getArtifact(pipeline, key);
    return artifacts;
  }, {});
}

function normalizeValidationResult(result = {}, artifact = '') {
  const object = asObject(result);
  const errors = [
    ...asArray(object.errors),
    ...asArray(object.failures).map((failure) => ({
      code: failure.code || failure.message || 'validation_failure',
      message: failure.message || failure.code || 'Validation failure.',
      field: failure.field || failure.path || ''
    }))
  ].map((error) => ({ ...error, artifact }));
  const warnings = asArray(object.warnings).map((warning) => ({ ...warning, artifact }));
  return {
    valid: object.valid === true,
    errors,
    warnings,
    reasonCodes: unique([
      ...asArray(object.reasonCodes),
      ...errors.map((error) => error.code),
      ...warnings.map((warning) => warning.code)
    ].filter(Boolean))
  };
}

function pushValidation(collection, validation) {
  collection.errors.push(...validation.errors);
  collection.warnings.push(...validation.warnings);
  collection.reasonCodes.push(...validation.reasonCodes);
}

function validateLocalArtifacts(artifacts = {}) {
  const output = { errors: [], warnings: [], reasonCodes: [] };
  const validators = [
    ['reviewPackage', reviewContract.validateRealListingDecisionReviewPackage],
    ['reviewBatch', reviewBatchBuilder.validateRealListingReviewBatch],
    ['reviewWorkspace', daltonReviewWorkspace.validateDaltonReviewWorkspace],
    ['calibrationDataset', calibrationDatasetBuilder.validateCalibrationDataset],
    ['calibrationRecommendation', calibrationRecommendationContract.validateCalibrationRecommendation],
    ['offlineExperiment', calibrationExperimentContract.validateCalibrationExperiment],
    ['shadowExperiment', shadowExperimentContract.validateShadowExperiment],
    ['productionProposal', productionProposalContract.validateProductionProposal]
  ];

  for (const [key, validator] of validators) {
    if (!artifacts[key]) continue;
    pushValidation(output, normalizeValidationResult(validator(artifacts[key]), key));
  }
  if (artifacts.productionApprovalArtifact) {
    pushValidation(output, normalizeValidationResult(
      productionApprovalArtifact.validateProductionApprovalArtifact(
        artifacts.productionApprovalArtifact,
        artifacts.productionProposal ? { proposal: artifacts.productionProposal } : {}
      ),
      'productionApprovalArtifact'
    ));
  }
  if (artifacts.deploymentValidationArtifact) {
    pushValidation(output, normalizeValidationResult(
      deploymentValidationArtifact.validateDeploymentValidationArtifact(
        artifacts.deploymentValidationArtifact,
        artifacts.productionProposal || artifacts.productionApprovalArtifact
          ? {
              proposal: artifacts.productionProposal,
              approvalArtifact: artifacts.productionApprovalArtifact
            }
          : {}
      ),
      'deploymentValidationArtifact'
    ));
  }
  return {
    ...output,
    reasonCodes: unique(output.reasonCodes)
  };
}

function includesValue(values = [], value) {
  if (!known(value)) return false;
  return asArray(values).some((entry) => {
    if (String(entry) === String(value)) return true;
    const object = asObject(entry);
    return [
      object.id,
      object.sourceId,
      object.workspaceId,
      object.batchId,
      object.datasetId,
      object.fingerprint,
      object.sourceFingerprint,
      object.workspaceFingerprint,
      object.batchFingerprint,
      object.datasetFingerprint
    ].filter(known).map(String).includes(String(value));
  });
}

function bindingError(code, message, field, artifact) {
  return validationError(code, message, field, artifact);
}

function validateArtifactBindings(pipeline = {}) {
  const artifacts = getArtifacts(pipeline);
  const violations = [];
  const missingArtifacts = [];

  for (const key of PIPELINE_ARTIFACT_KEYS) {
    if (!artifacts[key]) missingArtifacts.push(key);
  }

  const reviewPackage = asObject(artifacts.reviewPackage);
  const reviewBatch = asObject(artifacts.reviewBatch);
  const workspace = asObject(artifacts.reviewWorkspace);
  const dataset = asObject(artifacts.calibrationDataset);
  const recommendation = asObject(artifacts.calibrationRecommendation);
  const offlineExperiment = asObject(artifacts.offlineExperiment);
  const offlineResult = asObject(artifacts.offlineExperimentResult?.result || artifacts.offlineExperimentResult);
  const shadowExperiment = asObject(artifacts.shadowExperiment);
  const shadowResult = asObject(artifacts.shadowResult?.result || artifacts.shadowResult);
  const proposal = asObject(artifacts.productionProposal);
  const approval = asObject(artifacts.productionApprovalArtifact);
  const validation = asObject(artifacts.deploymentValidationArtifact);

  if (artifacts.reviewPackage && artifacts.reviewBatch) {
    const matchingPackage = asArray(reviewBatch.packages).find((item) => item.packageId === reviewPackage.packageId);
    if (!matchingPackage) violations.push(bindingError('review_package_not_in_batch', 'Review batch must include the review package.', 'reviewBatch.packages', 'reviewBatch'));
    else if (matchingPackage.packageFingerprint !== reviewPackage.packageFingerprint) {
      violations.push(bindingError('review_package_fingerprint_mismatch', 'Review package fingerprint does not match batch entry.', 'reviewBatch.packages', 'reviewBatch'));
    }
  }
  if (artifacts.reviewBatch && artifacts.reviewWorkspace) {
    if (workspace.batchId !== reviewBatch.batchId) violations.push(bindingError('workspace_batch_id_mismatch', 'Review workspace batchId must match review batch.', 'reviewWorkspace.batchId', 'reviewWorkspace'));
    if (workspace.batchFingerprint !== reviewBatch.batchFingerprint) violations.push(bindingError('workspace_batch_fingerprint_mismatch', 'Review workspace batchFingerprint must match review batch.', 'reviewWorkspace.batchFingerprint', 'reviewWorkspace'));
  }
  if (artifacts.reviewWorkspace && artifacts.calibrationDataset) {
    if (!includesValue(dataset.sourceWorkspaces, workspace.workspaceId)) violations.push(bindingError('dataset_missing_workspace_reference', 'Calibration dataset must reference the review workspace.', 'calibrationDataset.sourceWorkspaces', 'calibrationDataset'));
    if (!includesValue(dataset.sourceBatchIds, workspace.batchId)) violations.push(bindingError('dataset_missing_batch_reference', 'Calibration dataset must reference the review batch ID.', 'calibrationDataset.sourceBatchIds', 'calibrationDataset'));
  }
  if (artifacts.calibrationDataset && artifacts.calibrationRecommendation) {
    if (!includesValue(recommendation.sourceDatasetIds, dataset.datasetId)) violations.push(bindingError('recommendation_missing_dataset_id', 'Recommendation must reference calibration dataset ID.', 'calibrationRecommendation.sourceDatasetIds', 'calibrationRecommendation'));
    if (!includesValue(recommendation.sourceDatasetFingerprints, dataset.datasetFingerprint)) violations.push(bindingError('recommendation_missing_dataset_fingerprint', 'Recommendation must reference calibration dataset fingerprint.', 'calibrationRecommendation.sourceDatasetFingerprints', 'calibrationRecommendation'));
  }
  if (artifacts.calibrationRecommendation && artifacts.offlineExperiment) {
    if (!includesValue(offlineExperiment.sourceRecommendationIds, recommendation.recommendationId)) violations.push(bindingError('offline_experiment_missing_recommendation_id', 'Offline experiment must reference recommendation ID.', 'offlineExperiment.sourceRecommendationIds', 'offlineExperiment'));
    if (!includesValue(offlineExperiment.sourceRecommendationFingerprints, recommendation.recommendationFingerprint)) violations.push(bindingError('offline_experiment_missing_recommendation_fingerprint', 'Offline experiment must reference recommendation fingerprint.', 'offlineExperiment.sourceRecommendationFingerprints', 'offlineExperiment'));
  }
  if (artifacts.calibrationDataset && artifacts.offlineExperiment) {
    if (!includesValue(offlineExperiment.replayDatasetIds, dataset.datasetId) && !includesValue(offlineExperiment.holdoutDatasetIds, dataset.datasetId)) {
      violations.push(bindingError('offline_experiment_missing_dataset_id', 'Offline experiment must reference calibration dataset ID.', 'offlineExperiment.replayDatasetIds', 'offlineExperiment'));
    }
  }
  if (artifacts.offlineExperiment && artifacts.offlineExperimentResult) {
    if (offlineResult.experimentId !== offlineExperiment.experimentId) violations.push(bindingError('offline_result_experiment_id_mismatch', 'Offline result experimentId must match offline experiment.', 'offlineExperimentResult.experimentId', 'offlineExperimentResult'));
  }
  if (artifacts.calibrationDataset && artifacts.offlineExperimentResult) {
    if (!includesValue(offlineResult.sourceDatasetIds, dataset.datasetId)) violations.push(bindingError('offline_result_missing_dataset_id', 'Offline result must reference calibration dataset ID.', 'offlineExperimentResult.sourceDatasetIds', 'offlineExperimentResult'));
    if (!includesValue(offlineResult.sourceDatasetFingerprints, dataset.datasetFingerprint)) violations.push(bindingError('offline_result_missing_dataset_fingerprint', 'Offline result must reference calibration dataset fingerprint.', 'offlineExperimentResult.sourceDatasetFingerprints', 'offlineExperimentResult'));
  }
  if (artifacts.calibrationRecommendation && artifacts.offlineExperimentResult) {
    if (!includesValue(offlineResult.sourceRecommendationIds, recommendation.recommendationId)) violations.push(bindingError('offline_result_missing_recommendation_id', 'Offline result must reference recommendation ID.', 'offlineExperimentResult.sourceRecommendationIds', 'offlineExperimentResult'));
    if (!includesValue(offlineResult.sourceRecommendationFingerprints, recommendation.recommendationFingerprint)) violations.push(bindingError('offline_result_missing_recommendation_fingerprint', 'Offline result must reference recommendation fingerprint.', 'offlineExperimentResult.sourceRecommendationFingerprints', 'offlineExperimentResult'));
  }
  if (artifacts.offlineExperiment && artifacts.shadowExperiment) {
    if (!includesValue(shadowExperiment.sourceExperimentIds, offlineExperiment.experimentId)) violations.push(bindingError('shadow_experiment_missing_offline_experiment_id', 'Shadow experiment must reference offline experiment ID.', 'shadowExperiment.sourceExperimentIds', 'shadowExperiment'));
    if (!includesValue(shadowExperiment.sourceExperimentFingerprints, offlineExperiment.experimentFingerprint)) violations.push(bindingError('shadow_experiment_missing_offline_experiment_fingerprint', 'Shadow experiment must reference offline experiment fingerprint.', 'shadowExperiment.sourceExperimentFingerprints', 'shadowExperiment'));
  }
  if (artifacts.shadowExperiment && artifacts.shadowResult) {
    if (shadowResult.shadowExperimentId !== shadowExperiment.shadowExperimentId) violations.push(bindingError('shadow_result_experiment_id_mismatch', 'Shadow result must reference shadow experiment ID.', 'shadowResult.shadowExperimentId', 'shadowResult'));
  }
  if (artifacts.calibrationRecommendation && artifacts.productionProposal) {
    if (!includesValue(proposal.sourceRecommendationIds, recommendation.recommendationId)) violations.push(bindingError('proposal_missing_recommendation_id', 'Production proposal must reference recommendation ID.', 'productionProposal.sourceRecommendationIds', 'productionProposal'));
    if (!includesValue(proposal.sourceRecommendationFingerprints, recommendation.recommendationFingerprint)) violations.push(bindingError('proposal_missing_recommendation_fingerprint', 'Production proposal must reference recommendation fingerprint.', 'productionProposal.sourceRecommendationFingerprints', 'productionProposal'));
  }
  if (artifacts.offlineExperiment && artifacts.productionProposal) {
    if (!includesValue(proposal.sourceOfflineExperimentIds, offlineExperiment.experimentId)) violations.push(bindingError('proposal_missing_offline_experiment_id', 'Production proposal must reference offline experiment ID.', 'productionProposal.sourceOfflineExperimentIds', 'productionProposal'));
    if (!includesValue(proposal.sourceOfflineExperimentFingerprints, offlineExperiment.experimentFingerprint)) violations.push(bindingError('proposal_missing_offline_experiment_fingerprint', 'Production proposal must reference offline experiment fingerprint.', 'productionProposal.sourceOfflineExperimentFingerprints', 'productionProposal'));
  }
  if (artifacts.shadowExperiment && artifacts.productionProposal) {
    if (!includesValue(proposal.sourceShadowExperimentIds, shadowExperiment.shadowExperimentId)) violations.push(bindingError('proposal_missing_shadow_experiment_id', 'Production proposal must reference shadow experiment ID.', 'productionProposal.sourceShadowExperimentIds', 'productionProposal'));
    if (!includesValue(proposal.sourceShadowExperimentFingerprints, shadowExperiment.shadowExperimentFingerprint)) violations.push(bindingError('proposal_missing_shadow_experiment_fingerprint', 'Production proposal must reference shadow experiment fingerprint.', 'productionProposal.sourceShadowExperimentFingerprints', 'productionProposal'));
  }
  if (artifacts.shadowResult && artifacts.productionProposal) {
    if (!includesValue(proposal.sourceShadowResultIds, shadowResult.shadowResultId)) violations.push(bindingError('proposal_missing_shadow_result_id', 'Production proposal must reference shadow result ID.', 'productionProposal.sourceShadowResultIds', 'productionProposal'));
    if (!includesValue(proposal.sourceShadowResultFingerprints, shadowResult.shadowResultFingerprint)) violations.push(bindingError('proposal_missing_shadow_result_fingerprint', 'Production proposal must reference shadow result fingerprint.', 'productionProposal.sourceShadowResultFingerprints', 'productionProposal'));
  }
  if (artifacts.productionProposal && artifacts.productionApprovalArtifact) {
    const binding = productionApprovalArtifact.validateProductionApprovalArtifact(approval, { proposal });
    if (!binding.valid) violations.push(...asArray(binding.errors).map((error) => ({ ...error, artifact: 'productionApprovalArtifact' })));
  }
  if (artifacts.productionProposal && artifacts.productionApprovalArtifact && artifacts.deploymentValidationArtifact) {
    const binding = deploymentValidationArtifact.verifyProposalApprovalBinding(validation, proposal, approval);
    if (!binding.valid) violations.push(...asArray(binding.errors).map((error) => ({ ...error, artifact: 'deploymentValidationArtifact' })));
  }

  return deepFreeze({
    valid: missingArtifacts.length === 0 && violations.length === 0,
    missingArtifacts,
    bindingViolations: violations,
    errors: [
      ...missingArtifacts.map((artifact) => validationError('missing_required_artifact', `${artifact} is required.`, artifact, artifact)),
      ...violations
    ],
    warnings: [],
    reasonCodes: unique([
      ...missingArtifacts.map((artifact) => `missing_${artifact}`),
      ...violations.map((error) => error.code)
    ])
  });
}

function getStatus(artifact = {}, fields = []) {
  const object = asObject(artifact);
  for (const field of fields) {
    if (known(object[field])) return object[field];
  }
  return UNKNOWN_VALUE;
}

function validateLifecycleStates(pipeline = {}) {
  const artifacts = getArtifacts(pipeline);
  const violations = [];
  const blockedStatuses = {
    reviewPackage: ['incomplete', 'invalid'],
    calibrationRecommendation: ['rejected', 'expired', 'superseded', 'archived'],
    offlineExperiment: ['rejected', 'expired', 'superseded', 'archived'],
    shadowExperiment: ['rejected', 'archived'],
    productionProposal: ['rejected', 'expired', 'superseded', 'archived'],
    productionApprovalArtifact: ['expired', 'superseded', 'revoked', 'archived'],
    deploymentValidationArtifact: ['failed', 'blocked', 'expired', 'superseded', 'archived']
  };
  const statusFields = {
    reviewPackage: ['reviewStatus'],
    calibrationRecommendation: ['recommendationStatus'],
    offlineExperiment: ['experimentStatus'],
    shadowExperiment: ['shadowExperimentStatus'],
    productionProposal: ['proposalStatus'],
    productionApprovalArtifact: ['approvalStatus'],
    deploymentValidationArtifact: ['validationStatus']
  };

  for (const [artifact, statuses] of Object.entries(blockedStatuses)) {
    if (!artifacts[artifact]) continue;
    const status = getStatus(artifacts[artifact], statusFields[artifact]);
    if (statuses.includes(status)) {
      violations.push(validationError('blocked_lifecycle_status', `${artifact} has blocked lifecycle status ${status}.`, statusFields[artifact][0], artifact));
    }
  }
  if (artifacts.reviewPackage && getStatus(artifacts.reviewPackage, ['reviewStatus']) !== reviewContract.REVIEW_STATUSES.REVIEWED) {
    violations.push(validationError('review_package_not_reviewed', 'Review package must have completed Dalton review evidence.', 'reviewStatus', 'reviewPackage'));
  }
  if (artifacts.productionApprovalArtifact) {
    const approval = asObject(artifacts.productionApprovalArtifact);
    if (approval.approvalDecision !== 'approved_for_implementation' || approval.approvalStatus !== 'final') {
      violations.push(validationError('approval_not_final_implementation_approval', 'Production approval must be final approved_for_implementation evidence.', 'approvalDecision', 'productionApprovalArtifact'));
    }
  }
  if (artifacts.deploymentValidationArtifact && artifacts.deploymentValidationArtifact.validationStatus !== 'passed') {
    violations.push(validationError('deployment_validation_not_passed', 'Deployment validation artifact must be passed evidence.', 'validationStatus', 'deploymentValidationArtifact'));
  }

  return deepFreeze({
    valid: violations.length === 0,
    lifecycleViolations: violations,
    errors: violations,
    warnings: [],
    reasonCodes: unique(violations.map((error) => error.code))
  });
}

function walkAuthority(value, artifact, path = '', violations = []) {
  if (!value || typeof value !== 'object') return violations;
  for (const [key, child] of Object.entries(value)) {
    const nextPath = path ? `${path}.${key}` : key;
    if (['productionImpact', 'decisionImpact', 'executionAuthority'].includes(key) && child !== 'none') {
      violations.push(validationError(`invalid_${key}`, `${key} must remain none.`, nextPath, artifact));
    }
    if (child && typeof child === 'object') walkAuthority(child, artifact, nextPath, violations);
  }
  return violations;
}

function validateAuthorityBoundaries(pipeline = {}) {
  const artifacts = getArtifacts(pipeline);
  const violations = [];
  for (const key of PIPELINE_ARTIFACT_KEYS) {
    if (artifacts[key]) walkAuthority(artifacts[key], key, key, violations);
  }
  return deepFreeze({
    valid: violations.length === 0,
    authorityViolations: violations,
    errors: violations,
    warnings: [],
    reasonCodes: unique(violations.map((error) => error.code))
  });
}

function validateFingerprintChain(pipeline = {}) {
  const artifacts = getArtifacts(pipeline);
  const violations = [];
  const fingerprintChecks = [
    ['reviewPackage', 'packageFingerprint', reviewContract.buildRealListingDecisionReviewPackageFingerprint],
    ['reviewBatch', 'batchFingerprint', reviewBatchBuilder.buildReviewBatchFingerprint],
    ['reviewWorkspace', 'workspaceFingerprint', daltonReviewWorkspace.buildWorkspaceFingerprint],
    ['calibrationDataset', 'datasetFingerprint', calibrationDatasetBuilder.buildCalibrationDatasetFingerprint],
    ['calibrationRecommendation', 'recommendationFingerprint', calibrationRecommendationContract.buildCalibrationRecommendationFingerprint],
    ['offlineExperiment', 'experimentFingerprint', calibrationExperimentContract.buildCalibrationExperimentFingerprint],
    ['offlineExperimentResult', 'resultFingerprint', calibrationExperimentRunner.buildExperimentResultFingerprint],
    ['shadowExperiment', 'shadowExperimentFingerprint', shadowExperimentContract.buildShadowExperimentFingerprint],
    ['shadowResult', 'shadowResultFingerprint', shadowExperimentRunner.buildShadowResultFingerprint],
    ['productionProposal', 'proposalFingerprint', productionProposalContract.buildProductionProposalFingerprint],
    ['productionApprovalArtifact', 'approvalFingerprint', productionApprovalArtifact.buildProductionApprovalFingerprint],
    ['deploymentValidationArtifact', 'validationFingerprint', deploymentValidationArtifact.buildDeploymentValidationFingerprint]
  ];

  for (const [key, fingerprintField, builder] of fingerprintChecks) {
    const artifact = key === 'offlineExperimentResult' || key === 'shadowResult'
      ? asObject(artifacts[key]?.result || artifacts[key])
      : asObject(artifacts[key]);
    if (!artifacts[key] || !known(artifact[fingerprintField])) continue;
    if (builder(artifact) !== artifact[fingerprintField]) {
      violations.push(validationError('fingerprint_mismatch', `${fingerprintField} does not match ${key} contents.`, fingerprintField, key));
    }
  }
  return deepFreeze({
    valid: violations.length === 0,
    fingerprintViolations: violations,
    errors: violations,
    warnings: [],
    reasonCodes: unique(violations.map((error) => `${error.artifact}_${error.code}`))
  });
}

function validateAuditHistoryChain(pipeline = {}) {
  const artifacts = getArtifacts(pipeline);
  const violations = [];
  for (const key of PIPELINE_ARTIFACT_KEYS) {
    const history = asArray(artifacts[key]?.auditHistory);
    if (!history.length) continue;
    const sorted = [...history].sort((a, b) => {
      const time = String(a.eventAt || '').localeCompare(String(b.eventAt || ''));
      if (time !== 0) return time;
      return String(a.eventId || '').localeCompare(String(b.eventId || ''));
    });
    if (JSON.stringify(history) !== JSON.stringify(sorted)) {
      violations.push(validationError('audit_history_not_deterministic', 'Audit history must be sorted deterministically by eventAt and eventId.', 'auditHistory', key));
    }
    for (const [index, event] of history.entries()) {
      if (event.productionImpact && event.productionImpact !== 'none') violations.push(validationError('audit_history_authority_violation', 'Audit event productionImpact must remain none.', `auditHistory.${index}.productionImpact`, key));
      if (event.decisionImpact && event.decisionImpact !== 'none') violations.push(validationError('audit_history_authority_violation', 'Audit event decisionImpact must remain none.', `auditHistory.${index}.decisionImpact`, key));
      if (event.executionAuthority && event.executionAuthority !== 'none') violations.push(validationError('audit_history_authority_violation', 'Audit event executionAuthority must remain none.', `auditHistory.${index}.executionAuthority`, key));
    }
  }
  return deepFreeze({
    valid: violations.length === 0,
    auditHistoryViolations: violations,
    errors: violations,
    warnings: [],
    reasonCodes: unique(violations.map((error) => error.code))
  });
}

function validateExpirationChain(pipeline = {}, options = {}) {
  const artifacts = getArtifacts(pipeline);
  const violations = [];
  const asOf = Date.parse(firstDefined(options.asOf, pipeline.asOf, new Date(0).toISOString()));
  for (const key of ['productionProposal', 'productionApprovalArtifact', 'deploymentValidationArtifact']) {
    const artifact = asObject(artifacts[key]);
    if (!artifacts[key] || !known(artifact.expiresAt) || artifact.expiresAt === UNKNOWN_VALUE) continue;
    const expires = Date.parse(artifact.expiresAt);
    if (Number.isFinite(asOf) && Number.isFinite(expires) && expires < asOf) {
      violations.push(validationError('artifact_expired_as_of', `${key} expired before pipeline validation asOf.`, 'expiresAt', key));
    }
  }
  return deepFreeze({
    valid: violations.length === 0,
    expirationViolations: violations,
    errors: violations,
    warnings: [],
    reasonCodes: unique(violations.map((error) => error.code))
  });
}

function validateSupersessionChain(pipeline = {}) {
  const artifacts = getArtifacts(pipeline);
  const violations = [];
  const supersessionFields = {
    productionProposal: ['supersedesProposalId', 'supersededByProposalId'],
    productionApprovalArtifact: ['supersedesApprovalId', 'supersededByApprovalId'],
    deploymentValidationArtifact: ['supersedesValidationArtifactId', 'supersededByValidationArtifactId']
  };
  for (const [key, fields] of Object.entries(supersessionFields)) {
    const artifact = asObject(artifacts[key]);
    if (!artifacts[key]) continue;
    for (const field of fields) {
      if (known(artifact[field])) violations.push(validationError('artifact_superseded_or_superseding', `${key} contains supersession linkage and needs manual chain review.`, field, key));
    }
  }
  return deepFreeze({
    valid: violations.length === 0,
    supersessionViolations: violations,
    errors: violations,
    warnings: [],
    reasonCodes: unique(violations.map((error) => error.code))
  });
}

function validateRequiredEvidence(pipeline = {}) {
  const artifacts = getArtifacts(pipeline);
  const violations = [];
  const dataset = asObject(artifacts.calibrationDataset);
  const recommendation = asObject(artifacts.calibrationRecommendation);
  const offlineExperiment = asObject(artifacts.offlineExperiment);
  const offlineResult = asObject(artifacts.offlineExperimentResult?.result || artifacts.offlineExperimentResult);
  const shadowExperiment = asObject(artifacts.shadowExperiment);
  const shadowResult = asObject(artifacts.shadowResult?.result || artifacts.shadowResult);
  const proposal = asObject(artifacts.productionProposal);
  const approval = asObject(artifacts.productionApprovalArtifact);
  const validation = asObject(artifacts.deploymentValidationArtifact);

  if (artifacts.calibrationDataset && Number(dataset.reviewCount || 0) <= 0) violations.push(validationError('missing_review_evidence', 'Calibration dataset must contain reviewed evidence.', 'reviewCount', 'calibrationDataset'));
  if (artifacts.calibrationRecommendation && asArray(recommendation.sourceDatasetFingerprints).length === 0) violations.push(validationError('missing_dataset_evidence', 'Recommendation must preserve dataset fingerprint evidence.', 'sourceDatasetFingerprints', 'calibrationRecommendation'));
  if (artifacts.offlineExperiment && asArray(offlineExperiment.sourceRecommendationFingerprints).length === 0) violations.push(validationError('missing_recommendation_evidence', 'Offline experiment must preserve recommendation fingerprint evidence.', 'sourceRecommendationFingerprints', 'offlineExperiment'));
  if (artifacts.offlineExperimentResult && (!known(offlineResult.resultFingerprint) || asArray(offlineResult.sourceDatasetFingerprints).length === 0)) violations.push(validationError('missing_offline_result_evidence', 'Offline result must preserve result and dataset fingerprints.', 'resultFingerprint', 'offlineExperimentResult'));
  if (artifacts.shadowExperiment && asArray(shadowExperiment.sourceExperimentFingerprints).length === 0) violations.push(validationError('missing_offline_experiment_evidence', 'Shadow experiment must preserve offline experiment fingerprint evidence.', 'sourceExperimentFingerprints', 'shadowExperiment'));
  if (artifacts.shadowResult && !known(shadowResult.shadowResultFingerprint)) violations.push(validationError('missing_shadow_result_evidence', 'Shadow result must preserve shadowResultFingerprint.', 'shadowResultFingerprint', 'shadowResult'));
  if (artifacts.productionProposal && (asArray(proposal.sourceShadowResultFingerprints).length === 0 || asArray(proposal.requiredTestEvidence).length === 0 || asArray(proposal.validationChecklist).length === 0)) violations.push(validationError('proposal_missing_required_evidence', 'Production proposal must preserve shadow result, test, and validation evidence references.', 'productionProposal', 'productionProposal'));
  if (artifacts.productionApprovalArtifact && (approval.approvalDecision !== 'approved_for_implementation' || !known(approval.approvedBy))) violations.push(validationError('approval_missing_human_decision', 'Production approval must preserve explicit human implementation approval evidence.', 'approvalDecision', 'productionApprovalArtifact'));
  if (artifacts.deploymentValidationArtifact && (validation.validationStatus !== 'passed' || asArray(validation.requiredTestResults).length === 0 || asArray(validation.validationChecklistResults).length === 0)) violations.push(validationError('deployment_validation_missing_test_evidence', 'Deployment validation must preserve passed checklist and required test evidence.', 'deploymentValidationArtifact', 'deploymentValidationArtifact'));

  return deepFreeze({
    valid: violations.length === 0,
    evidenceViolations: violations,
    errors: violations,
    warnings: [],
    reasonCodes: unique(violations.map((error) => error.code))
  });
}

function determinePipelineReadiness(validation = {}) {
  const object = asObject(validation);
  if (asArray(object.missingArtifacts).length > 0) return READINESS_LEVELS.INCOMPLETE;
  if (asArray(object.authorityViolations).length > 0 ||
    asArray(object.fingerprintViolations).length > 0 ||
    asArray(object.auditHistoryViolations).length > 0 ||
    asArray(object.bindingViolations).length > 0) {
    return READINESS_LEVELS.INVALID;
  }
  if (asArray(object.lifecycleViolations).length > 0 ||
    asArray(object.expirationViolations).length > 0 ||
    asArray(object.supersessionViolations).length > 0 ||
    asArray(object.evidenceViolations).length > 0 ||
    asArray(object.errors).length > 0) {
    return READINESS_LEVELS.BLOCKED;
  }
  return READINESS_LEVELS.VALID;
}

function collectPipelineResults(results = []) {
  const errors = [];
  const warnings = [];
  const reasonCodes = [];
  for (const result of results) {
    errors.push(...asArray(result.errors));
    warnings.push(...asArray(result.warnings));
    reasonCodes.push(...asArray(result.reasonCodes));
  }
  return { errors, warnings, reasonCodes: unique(reasonCodes) };
}

function validateGovernancePipeline(pipeline = {}, options = {}) {
  const artifacts = getArtifacts(pipeline);
  const localValidation = validateLocalArtifacts(artifacts);
  const binding = validateArtifactBindings(artifacts);
  const lifecycle = validateLifecycleStates(artifacts);
  const authority = validateAuthorityBoundaries(artifacts);
  const fingerprintChain = validateFingerprintChain(artifacts);
  const auditHistory = validateAuditHistoryChain(artifacts);
  const expiration = validateExpirationChain(artifacts, options);
  const supersession = validateSupersessionChain(artifacts);
  const evidence = validateRequiredEvidence(artifacts);
  const collected = collectPipelineResults([
    localValidation,
    binding,
    lifecycle,
    authority,
    fingerprintChain,
    auditHistory,
    expiration,
    supersession,
    evidence
  ]);
  const core = {
    schemaVersion: GOVERNANCE_PIPELINE_VALIDATOR_SCHEMA_VERSION,
    source: GOVERNANCE_PIPELINE_VALIDATOR_SOURCE,
    validatedAt: firstDefined(options.validatedAt, pipeline.validatedAt, UNKNOWN_VALUE),
    valid: false,
    readiness: READINESS_LEVELS.INVALID,
    errors: collected.errors,
    warnings: collected.warnings,
    reasonCodes: collected.reasonCodes,
    missingArtifacts: binding.missingArtifacts,
    bindingViolations: binding.bindingViolations,
    lifecycleViolations: lifecycle.lifecycleViolations,
    authorityViolations: authority.authorityViolations,
    expirationViolations: expiration.expirationViolations,
    supersessionViolations: supersession.supersessionViolations,
    fingerprintViolations: fingerprintChain.fingerprintViolations,
    auditHistoryViolations: auditHistory.auditHistoryViolations,
    evidenceViolations: evidence.evidenceViolations,
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
  core.readiness = determinePipelineReadiness(core);
  core.valid = core.readiness === READINESS_LEVELS.VALID;
  return deepFreeze({
    ...core,
    pipelineFingerprint: buildGovernancePipelineFingerprint({
      artifacts,
      validation: core
    })
  });
}

function summarizeGovernancePipeline(pipelineOrValidation = {}, options = {}) {
  const validation = known(pipelineOrValidation.readiness)
    ? pipelineOrValidation
    : validateGovernancePipeline(pipelineOrValidation, options);
  return deepFreeze({
    valid: validation.valid === true,
    readiness: validation.readiness,
    errorCount: asArray(validation.errors).length,
    warningCount: asArray(validation.warnings).length,
    missingArtifactCount: asArray(validation.missingArtifacts).length,
    bindingViolationCount: asArray(validation.bindingViolations).length,
    lifecycleViolationCount: asArray(validation.lifecycleViolations).length,
    authorityViolationCount: asArray(validation.authorityViolations).length,
    expirationViolationCount: asArray(validation.expirationViolations).length,
    supersessionViolationCount: asArray(validation.supersessionViolations).length,
    fingerprintViolationCount: asArray(validation.fingerprintViolations).length,
    auditHistoryViolationCount: asArray(validation.auditHistoryViolations).length,
    evidenceViolationCount: asArray(validation.evidenceViolations).length,
    reasonCodes: clone(asArray(validation.reasonCodes)),
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none',
    pipelineFingerprint: validation.pipelineFingerprint
  });
}

function buildGovernancePipelineFingerprint(pipeline = {}) {
  const projection = clone(pipeline);
  delete projection.pipelineFingerprint;
  delete projection.governancePipelineFingerprint;
  if (projection.validation) {
    delete projection.validation.pipelineFingerprint;
    delete projection.validation.governancePipelineFingerprint;
  }
  return buildFingerprintFromProjection(projection);
}

module.exports = {
  GOVERNANCE_PIPELINE_VALIDATOR_SCHEMA_VERSION,
  GOVERNANCE_PIPELINE_VALIDATOR_SOURCE,
  PIPELINE_ARTIFACT_KEYS,
  READINESS_LEVELS,
  UNKNOWN_VALUE,
  buildGovernancePipelineFingerprint,
  determinePipelineReadiness,
  summarizeGovernancePipeline,
  validateArtifactBindings,
  validateAuditHistoryChain,
  validateAuthorityBoundaries,
  validateExpirationChain,
  validateFingerprintChain,
  validateGovernancePipeline,
  validateLifecycleStates,
  validateRequiredEvidence,
  validateSupersessionChain
};
