'use strict';

const { asArray, asObject, unique } = require('./canonicalValidationCore');
const { buildFingerprintFromProjection } = require('./fingerprintProjection');
const { clone, firstDefined } = require('./phase8GovernanceCore');
const {
  GOVERNANCE_ARTIFACT_REGISTRY_SCHEMA_VERSION,
  GOVERNANCE_ARTIFACT_REGISTRY_SOURCE
} = require('./governanceArtifactRegistry');
const {
  GOVERNANCE_ARTIFACT_LIFECYCLE_SCHEMA_VERSION,
  GOVERNANCE_ARTIFACT_LIFECYCLE_SOURCE
} = require('./governanceArtifactLifecycleManager');
const {
  GOVERNANCE_REVIEW_SESSION_SCHEMA_VERSION,
  GOVERNANCE_REVIEW_SESSION_SOURCE
} = require('./governanceReviewSessionManager');
const {
  GOVERNANCE_REVIEW_WORKSPACE_SCHEMA_VERSION,
  GOVERNANCE_REVIEW_WORKSPACE_SOURCE
} = require('./governanceReviewWorkspaceOrchestrator');
const {
  GOVERNANCE_PIPELINE_E2E_SCHEMA_VERSION,
  GOVERNANCE_PIPELINE_E2E_SOURCE,
  validateGovernancePipeline,
  validatePipelineIntegrity
} = require('./governancePipelineEndToEndValidation');
const { validateRegistryConformance } = require('./governanceArtifactRegistryConformance');
const { validateLifecycleConformance } = require('./governanceArtifactLifecycleConformance');
const { validateReviewSessionConformance } = require('./governanceReviewSessionConformance');
const { validateWorkspaceOrchestratorConformance } = require('./governanceReviewWorkspaceOrchestratorConformance');

const GOVERNANCE_PIPELINE_BASELINE_SCHEMA_VERSION = '1.0.0';
const GOVERNANCE_PIPELINE_BASELINE_SOURCE = 'governance_pipeline_stability_baseline';
const GOVERNANCE_PIPELINE_CERTIFICATION_SOURCE = 'governance_pipeline_stability_certification';
const UNKNOWN_VALUE = 'unknown';

const CERTIFICATION_STATUSES = Object.freeze([
  'certified_offline',
  'certified_with_warnings',
  'not_certified',
  'invalid',
  UNKNOWN_VALUE
]);

const REQUIRED_VALIDATION_KEYS = Object.freeze([
  'registryConformance',
  'lifecycleConformance',
  'reviewSessionConformance',
  'workspaceConformance',
  'endToEndValidation'
]);

const COMPONENTS = Object.freeze([
  {
    componentName: 'Governance Artifact Registry',
    componentKey: 'registry',
    schemaVersion: GOVERNANCE_ARTIFACT_REGISTRY_SCHEMA_VERSION,
    source: GOVERNANCE_ARTIFACT_REGISTRY_SOURCE,
    publicApis: [
      'registerArtifact',
      'getArtifact',
      'getArtifactByFingerprint',
      'listArtifacts',
      'validateArtifactRegistration',
      'detectSupersession',
      'summarizeRegistry'
    ]
  },
  {
    componentName: 'Governance Artifact Lifecycle Manager',
    componentKey: 'lifecycle',
    schemaVersion: GOVERNANCE_ARTIFACT_LIFECYCLE_SCHEMA_VERSION,
    source: GOVERNANCE_ARTIFACT_LIFECYCLE_SOURCE,
    publicApis: [
      'registerLifecycleEvent',
      'validateLifecycleTransition',
      'getLifecycleState',
      'detectSupersededArtifacts',
      'summarizeLifecycle',
      'validateLifecycleIntegrity'
    ]
  },
  {
    componentName: 'Governance Review Session Manager',
    componentKey: 'reviewSession',
    schemaVersion: GOVERNANCE_REVIEW_SESSION_SCHEMA_VERSION,
    source: GOVERNANCE_REVIEW_SESSION_SOURCE,
    publicApis: [
      'createReviewSession',
      'validateReviewSession',
      'attachReviewPackage',
      'getReviewSessionState',
      'summarizeReviewSession',
      'validateReviewSessionIntegrity'
    ]
  },
  {
    componentName: 'Governance Review Workspace Orchestrator',
    componentKey: 'workspaceOrchestrator',
    schemaVersion: GOVERNANCE_REVIEW_WORKSPACE_SCHEMA_VERSION,
    source: GOVERNANCE_REVIEW_WORKSPACE_SOURCE,
    publicApis: [
      'createWorkspaceReview',
      'validateWorkspaceReview',
      'assembleWorkspaceSummary',
      'deriveWorkspaceReadiness',
      'listWorkspaceFindings',
      'summarizeWorkspaceReview'
    ]
  },
  {
    componentName: 'Governance Pipeline End-to-End Validation',
    componentKey: 'endToEndValidation',
    schemaVersion: GOVERNANCE_PIPELINE_E2E_SCHEMA_VERSION,
    source: GOVERNANCE_PIPELINE_E2E_SOURCE,
    publicApis: [
      'validateGovernancePipeline',
      'validatePipelineStages',
      'validateArtifactFlow',
      'validatePipelineDeterminism',
      'validatePipelineIntegrity',
      'summarizePipelineValidation'
    ]
  }
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

function normalizeString(value, fallback = UNKNOWN_VALUE) {
  if (!known(value)) return fallback;
  return String(value).trim() || fallback;
}

function normalizeDate(value, fallback = UNKNOWN_VALUE) {
  if (!known(value)) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function validationIssue(code, message, field = '') {
  return { code, message, field };
}

function collectReasonCodes(errors = [], warnings = []) {
  return unique([...asArray(errors), ...asArray(warnings)].map((issue) => issue.code)).sort();
}

function statusFromValidation(validation = {}) {
  if (!validation || Object.keys(asObject(validation)).length === 0) return 'missing';
  return validation.valid === true ? 'passed' : 'failed';
}

function resultSummary(validation = {}) {
  const input = asObject(validation);
  return {
    valid: input.valid === true,
    status: statusFromValidation(input),
    reasonCodes: asArray(input.reasonCodes).slice().sort(),
    errorCount: asArray(input.errors).length,
    warningCount: asArray(input.warnings).length,
    fingerprint: normalizeString(firstDefined(
      input.conformanceFingerprint,
      input.pipelineValidationFingerprint,
      input.validationFingerprint,
      input.fingerprint
    ))
  };
}

function buildComponentInventory() {
  return COMPONENTS
    .map((component) => ({
      ...clone(component),
      publicApis: asArray(component.publicApis).slice().sort(),
      productionImpact: 'none',
      decisionImpact: 'none',
      executionAuthority: 'none'
    }))
    .sort((left, right) => left.componentKey.localeCompare(right.componentKey));
}

function collectValidationResults(input = {}, options = {}) {
  const provided = asObject(input.validationResults || options.validationResults);
  const pipelineContext = {
    registry: input.registry || options.registry,
    lifecycle: input.lifecycle || options.lifecycle,
    reviewSession: input.reviewSession || input.session || options.reviewSession || options.session,
    workspaceReview: input.workspaceReview || input.workspace || options.workspaceReview || options.workspace,
    validationId: input.validationId || options.validationId
  };
  return {
    registryConformance: firstDefined(provided.registryConformance, provided.registry, pipelineContext.registry ? validateRegistryConformance(pipelineContext.registry) : null),
    lifecycleConformance: firstDefined(provided.lifecycleConformance, provided.lifecycle, pipelineContext.lifecycle ? validateLifecycleConformance(pipelineContext.lifecycle) : null),
    reviewSessionConformance: firstDefined(provided.reviewSessionConformance, provided.reviewSession, pipelineContext.reviewSession ? validateReviewSessionConformance(pipelineContext.reviewSession, pipelineContext) : null),
    workspaceConformance: firstDefined(provided.workspaceConformance, provided.workspace, pipelineContext.workspaceReview ? validateWorkspaceOrchestratorConformance(pipelineContext.workspaceReview, pipelineContext) : null),
    endToEndValidation: firstDefined(provided.endToEndValidation, provided.pipeline, pipelineContext.registry || pipelineContext.lifecycle || pipelineContext.reviewSession || pipelineContext.workspaceReview ? validateGovernancePipeline(pipelineContext) : null),
    crossComponentIntegrity: firstDefined(provided.crossComponentIntegrity, provided.integrity, pipelineContext.registry || pipelineContext.lifecycle || pipelineContext.reviewSession || pipelineContext.workspaceReview ? validatePipelineIntegrity(pipelineContext) : null)
  };
}

function summarizeValidationResults(validationResults = {}) {
  const summaries = {};
  for (const key of REQUIRED_VALIDATION_KEYS) {
    summaries[key] = resultSummary(validationResults[key]);
  }
  summaries.crossComponentIntegrity = resultSummary(validationResults.crossComponentIntegrity);
  return Object.fromEntries(Object.entries(summaries).sort(([left], [right]) => left.localeCompare(right)));
}

function buildStatusSummary(validationResults = {}) {
  const summaries = summarizeValidationResults(validationResults);
  const missingRequired = REQUIRED_VALIDATION_KEYS.filter((key) => summaries[key].status === 'missing');
  const failedRequired = REQUIRED_VALIDATION_KEYS.filter((key) => summaries[key].status === 'failed');
  const warningCount = Object.values(summaries).reduce((total, summary) => total + Number(summary.warningCount || 0), 0);
  const errorCount = Object.values(summaries).reduce((total, summary) => total + Number(summary.errorCount || 0), 0);
  const reasonCodes = unique(Object.values(summaries).flatMap((summary) => asArray(summary.reasonCodes))).sort();
  return {
    requiredValidationCount: REQUIRED_VALIDATION_KEYS.length,
    passedRequiredValidationCount: REQUIRED_VALIDATION_KEYS.filter((key) => summaries[key].status === 'passed').length,
    failedRequiredValidationCount: failedRequired.length,
    missingRequiredValidationCount: missingRequired.length,
    missingRequiredValidations: missingRequired,
    failedRequiredValidations: failedRequired,
    warningCount,
    errorCount,
    reasonCodes,
    allRequiredValidationsPassed: missingRequired.length === 0 && failedRequired.length === 0,
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
}

function buildGovernancePipelineBaseline(input = {}, options = {}) {
  const validationResults = collectValidationResults(input, options);
  const validationSummary = summarizeValidationResults(validationResults);
  const statusSummary = buildStatusSummary(validationResults);
  const knownWarnings = unique(asArray(firstDefined(input.knownWarnings, options.knownWarnings, []))).sort();
  const unresolvedPolicyQuestions = unique(asArray(firstDefined(input.unresolvedPolicyQuestions, options.unresolvedPolicyQuestions, []))).sort();
  const testMetadata = clone(asObject(firstDefined(input.testMetadata, options.testMetadata, {})));
  const core = {
    schemaVersion: GOVERNANCE_PIPELINE_BASELINE_SCHEMA_VERSION,
    source: GOVERNANCE_PIPELINE_BASELINE_SOURCE,
    baselineId: normalizeString(firstDefined(input.baselineId, options.baselineId, 'governance-pipeline-stability-baseline')),
    createdAt: normalizeDate(firstDefined(input.createdAt, options.createdAt, UNKNOWN_VALUE)),
    componentInventory: buildComponentInventory(),
    validationSummary,
    statusSummary,
    crossComponentIntegrityStatus: validationSummary.crossComponentIntegrity?.status || 'missing',
    offlineBoundaryStatus: statusSummary.reasonCodes.includes('runtime_import_detected') ? 'failed' : 'passed',
    nonAuthoritativeStatus: statusSummary.reasonCodes.includes('authority_boundary_violation') ? 'failed' : 'passed',
    testMetadata,
    knownWarnings,
    unresolvedPolicyQuestions,
    productionAuthorityStatement: 'Production authority remains in the Phase 12 governance chain and requires explicit Dalton approval.',
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
  return deepFreeze({
    ...core,
    baselineFingerprint: buildGovernancePipelineBaselineFingerprint(core)
  });
}

function buildGovernancePipelineBaselineFingerprint(baseline = {}) {
  const projection = clone(baseline);
  delete projection.baselineFingerprint;
  return buildFingerprintFromProjection(projection);
}

function validateGovernancePipelineBaseline(baseline = {}) {
  const input = asObject(baseline);
  const errors = [];
  const warnings = [];
  const missingRequiredFields = [];
  const fingerprintViolations = [];
  const authorityViolations = [];
  const statusViolations = [];

  for (const field of ['schemaVersion', 'source', 'baselineId', 'createdAt', 'componentInventory', 'validationSummary', 'statusSummary', 'crossComponentIntegrityStatus', 'offlineBoundaryStatus', 'nonAuthoritativeStatus', 'productionAuthorityStatement', 'productionImpact', 'decisionImpact', 'executionAuthority', 'baselineFingerprint']) {
    if (!known(input[field])) {
      errors.push(validationIssue('missing_required_field', `${field} is required.`, field));
      missingRequiredFields.push(field);
    }
  }
  if (input.schemaVersion !== GOVERNANCE_PIPELINE_BASELINE_SCHEMA_VERSION) {
    errors.push(validationIssue('invalid_baseline_schema_version', 'Baseline schemaVersion is unsupported.', 'schemaVersion'));
  }
  if (input.source !== GOVERNANCE_PIPELINE_BASELINE_SOURCE) {
    errors.push(validationIssue('invalid_baseline_source', 'Baseline source is unsupported.', 'source'));
  }
  for (const field of ['productionImpact', 'decisionImpact', 'executionAuthority']) {
    if (input[field] !== 'none') {
      errors.push(validationIssue('authority_boundary_violation', `${field} must remain none.`, field));
      authorityViolations.push(field);
    }
  }
  if (input.baselineFingerprint && buildGovernancePipelineBaselineFingerprint(input) !== input.baselineFingerprint) {
    errors.push(validationIssue('baseline_fingerprint_mismatch', 'Baseline fingerprint does not match baseline contents.', 'baselineFingerprint'));
    fingerprintViolations.push('baselineFingerprint');
  }
  const summary = asObject(input.statusSummary);
  if (summary.missingRequiredValidationCount > 0 || asArray(summary.missingRequiredValidations).length > 0) {
    warnings.push(validationIssue('required_validation_missing', 'One or more required validations are missing from the baseline.', 'statusSummary'));
    statusViolations.push('missingRequiredValidations');
  }
  if (input.offlineBoundaryStatus !== 'passed') {
    errors.push(validationIssue('offline_boundary_failed', 'Baseline offline boundary status must pass.', 'offlineBoundaryStatus'));
    statusViolations.push('offlineBoundaryStatus');
  }
  if (input.nonAuthoritativeStatus !== 'passed') {
    errors.push(validationIssue('non_authoritative_boundary_failed', 'Baseline non-authoritative status must pass.', 'nonAuthoritativeStatus'));
    statusViolations.push('nonAuthoritativeStatus');
  }

  return deepFreeze({
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes: collectReasonCodes(errors, warnings),
    missingRequiredFields: unique(missingRequiredFields).sort(),
    fingerprintViolations: unique(fingerprintViolations).sort(),
    authorityViolations: unique(authorityViolations).sort(),
    statusViolations: unique(statusViolations).sort()
  });
}

function compareGovernancePipelineBaseline(left = {}, right = {}) {
  const differences = [];
  const leftBaseline = asObject(left);
  const rightBaseline = asObject(right);
  for (const field of ['schemaVersion', 'source', 'componentInventory', 'validationSummary', 'statusSummary', 'crossComponentIntegrityStatus', 'offlineBoundaryStatus', 'nonAuthoritativeStatus', 'knownWarnings', 'unresolvedPolicyQuestions', 'productionImpact', 'decisionImpact', 'executionAuthority']) {
    if (JSON.stringify(leftBaseline[field]) !== JSON.stringify(rightBaseline[field])) differences.push(field);
  }
  return deepFreeze({
    equal: differences.length === 0,
    differences: differences.sort(),
    leftFingerprint: normalizeString(leftBaseline.baselineFingerprint),
    rightFingerprint: normalizeString(rightBaseline.baselineFingerprint),
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  });
}

function certificationStatusForBaseline(baseline = {}) {
  const validation = validateGovernancePipelineBaseline(baseline);
  if (!validation.valid) return 'invalid';
  const summary = asObject(baseline.statusSummary);
  if (summary.allRequiredValidationsPassed !== true || summary.failedRequiredValidationCount > 0 || summary.missingRequiredValidationCount > 0) return 'not_certified';
  if (Number(summary.warningCount || 0) > 0 || asArray(baseline.knownWarnings).length > 0 || asArray(baseline.unresolvedPolicyQuestions).length > 0) return 'certified_with_warnings';
  return 'certified_offline';
}

function buildGovernancePipelineCertification(baseline = {}, options = {}) {
  const status = certificationStatusForBaseline(baseline);
  const baselineValidation = validateGovernancePipelineBaseline(baseline);
  const core = {
    schemaVersion: GOVERNANCE_PIPELINE_BASELINE_SCHEMA_VERSION,
    source: GOVERNANCE_PIPELINE_CERTIFICATION_SOURCE,
    certificationId: normalizeString(firstDefined(options.certificationId, `governance-pipeline-certification:${baseline.baselineId || UNKNOWN_VALUE}`)),
    createdAt: normalizeDate(firstDefined(options.createdAt, baseline.createdAt, UNKNOWN_VALUE)),
    baselineId: normalizeString(baseline.baselineId),
    baselineFingerprint: normalizeString(baseline.baselineFingerprint),
    certificationStatus: status,
    certified: status === 'certified_offline' || status === 'certified_with_warnings',
    baselineValidationStatus: baselineValidation.valid ? 'passed' : 'failed',
    requiredValidationStatus: clone(asObject(baseline.statusSummary)),
    knownWarnings: clone(asArray(baseline.knownWarnings)),
    unresolvedPolicyQuestions: clone(asArray(baseline.unresolvedPolicyQuestions)),
    certificationRules: {
      offlineOnly: true,
      nonAuthoritative: true,
      productionApprovalGranted: false,
      failedRequiredValidationBlocksCertification: true,
      missingRequiredValidationBlocksCertification: true,
      warningsRemainVisible: true,
      productionAuthorityStatement: 'Production authority remains in the Phase 12 governance chain and requires explicit Dalton approval.'
    },
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
  return deepFreeze({
    ...core,
    certificationFingerprint: buildGovernancePipelineCertificationFingerprint(core)
  });
}

function buildGovernancePipelineCertificationFingerprint(certification = {}) {
  const projection = clone(certification);
  delete projection.certificationFingerprint;
  return buildFingerprintFromProjection(projection);
}

function validateGovernancePipelineCertification(certification = {}, options = {}) {
  const input = asObject(certification);
  const errors = [];
  const warnings = [];
  const missingRequiredFields = [];
  const fingerprintViolations = [];
  const authorityViolations = [];
  const baseline = asObject(options.baseline);

  for (const field of ['schemaVersion', 'source', 'certificationId', 'createdAt', 'baselineId', 'baselineFingerprint', 'certificationStatus', 'certified', 'baselineValidationStatus', 'requiredValidationStatus', 'certificationRules', 'productionImpact', 'decisionImpact', 'executionAuthority', 'certificationFingerprint']) {
    if (!known(input[field])) {
      errors.push(validationIssue('missing_required_field', `${field} is required.`, field));
      missingRequiredFields.push(field);
    }
  }
  if (input.schemaVersion !== GOVERNANCE_PIPELINE_BASELINE_SCHEMA_VERSION) {
    errors.push(validationIssue('invalid_certification_schema_version', 'Certification schemaVersion is unsupported.', 'schemaVersion'));
  }
  if (input.source !== GOVERNANCE_PIPELINE_CERTIFICATION_SOURCE) {
    errors.push(validationIssue('invalid_certification_source', 'Certification source is unsupported.', 'source'));
  }
  if (!CERTIFICATION_STATUSES.includes(input.certificationStatus)) {
    errors.push(validationIssue('invalid_certification_status', 'Certification status is unsupported.', 'certificationStatus'));
  }
  if (input.certified === true && !['certified_offline', 'certified_with_warnings'].includes(input.certificationStatus)) {
    errors.push(validationIssue('invalid_certified_flag', 'certified=true is only valid for passing offline certification statuses.', 'certified'));
  }
  if (input.certificationFingerprint && buildGovernancePipelineCertificationFingerprint(input) !== input.certificationFingerprint) {
    errors.push(validationIssue('certification_fingerprint_mismatch', 'Certification fingerprint does not match certification contents.', 'certificationFingerprint'));
    fingerprintViolations.push('certificationFingerprint');
  }
  for (const field of ['productionImpact', 'decisionImpact', 'executionAuthority']) {
    if (input[field] !== 'none') {
      errors.push(validationIssue('authority_boundary_violation', `${field} must remain none.`, field));
      authorityViolations.push(field);
    }
  }
  if (input.certificationRules?.productionApprovalGranted !== false) {
    errors.push(validationIssue('production_approval_boundary_violation', 'Certification must not grant production approval.', 'certificationRules.productionApprovalGranted'));
    authorityViolations.push('certificationRules.productionApprovalGranted');
  }
  if (Object.keys(baseline).length > 0) {
    if (input.baselineId !== baseline.baselineId || input.baselineFingerprint !== baseline.baselineFingerprint) {
      errors.push(validationIssue('baseline_binding_mismatch', 'Certification does not bind to the supplied baseline.', 'baselineFingerprint'));
      fingerprintViolations.push('baselineFingerprint');
    }
    const expectedStatus = certificationStatusForBaseline(baseline);
    if (input.certificationStatus !== expectedStatus) {
      errors.push(validationIssue('certification_status_mismatch', 'Certification status does not match supplied baseline.', 'certificationStatus'));
    }
  }
  if (asArray(input.knownWarnings).length > 0 || asArray(input.unresolvedPolicyQuestions).length > 0) {
    warnings.push(validationIssue('certification_contains_visible_warnings', 'Certification preserves warnings or unresolved policy questions.', 'knownWarnings'));
  }

  return deepFreeze({
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes: collectReasonCodes(errors, warnings),
    missingRequiredFields: unique(missingRequiredFields).sort(),
    fingerprintViolations: unique(fingerprintViolations).sort(),
    authorityViolations: unique(authorityViolations).sort()
  });
}

function summarizeGovernancePipelineBaseline(baseline = {}) {
  const input = asObject(baseline);
  const status = certificationStatusForBaseline(input);
  return deepFreeze({
    schemaVersion: GOVERNANCE_PIPELINE_BASELINE_SCHEMA_VERSION,
    source: GOVERNANCE_PIPELINE_BASELINE_SOURCE,
    baselineId: normalizeString(input.baselineId),
    componentCount: asArray(input.componentInventory).length,
    requiredValidationCount: Number(input.statusSummary?.requiredValidationCount || 0),
    passedRequiredValidationCount: Number(input.statusSummary?.passedRequiredValidationCount || 0),
    failedRequiredValidationCount: Number(input.statusSummary?.failedRequiredValidationCount || 0),
    missingRequiredValidationCount: Number(input.statusSummary?.missingRequiredValidationCount || 0),
    warningCount: Number(input.statusSummary?.warningCount || 0),
    crossComponentIntegrityStatus: normalizeString(input.crossComponentIntegrityStatus),
    offlineBoundaryStatus: normalizeString(input.offlineBoundaryStatus),
    nonAuthoritativeStatus: normalizeString(input.nonAuthoritativeStatus),
    certificationStatus: status,
    baselineFingerprint: normalizeString(input.baselineFingerprint),
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  });
}

module.exports = {
  CERTIFICATION_STATUSES,
  GOVERNANCE_PIPELINE_BASELINE_SCHEMA_VERSION,
  GOVERNANCE_PIPELINE_BASELINE_SOURCE,
  GOVERNANCE_PIPELINE_CERTIFICATION_SOURCE,
  buildGovernancePipelineBaseline,
  buildGovernancePipelineBaselineFingerprint,
  buildGovernancePipelineCertification,
  buildGovernancePipelineCertificationFingerprint,
  compareGovernancePipelineBaseline,
  summarizeGovernancePipelineBaseline,
  validateGovernancePipelineBaseline,
  validateGovernancePipelineCertification
};
