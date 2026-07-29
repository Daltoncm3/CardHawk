'use strict';

const { asArray, asObject, unique } = require('./canonicalValidationCore');
const { buildFingerprintFromProjection } = require('./fingerprintProjection');
const { clone, firstDefined } = require('./phase8GovernanceCore');
const {
  getArtifact,
  listArtifacts,
  normalizeRegistry
} = require('./governanceArtifactRegistry');
const {
  getLifecycleState,
  validateLifecycleIntegrity
} = require('./governanceArtifactLifecycleManager');
const {
  createReviewSession,
  validateReviewSessionIntegrity
} = require('./governanceReviewSessionManager');
const {
  createWorkspaceReview,
  validateWorkspaceReview,
  summarizeWorkspaceReview
} = require('./governanceReviewWorkspaceOrchestrator');
const { validateRegistryConformance } = require('./governanceArtifactRegistryConformance');
const { validateLifecycleConformance } = require('./governanceArtifactLifecycleConformance');
const { validateReviewSessionConformance } = require('./governanceReviewSessionConformance');
const { validateWorkspaceOrchestratorConformance } = require('./governanceReviewWorkspaceOrchestratorConformance');

const GOVERNANCE_PIPELINE_E2E_SCHEMA_VERSION = '1.0.0';
const GOVERNANCE_PIPELINE_E2E_SOURCE = 'governance_pipeline_end_to_end_validation';
const UNKNOWN_VALUE = 'unknown';

const PIPELINE_STAGES = Object.freeze([
  'artifact_flow',
  'lifecycle_transitions',
  'review_session_coordination',
  'workspace_assembly',
  'cross_component_integrity',
  'pipeline_determinism',
  'offline_boundary',
  'authority_boundary'
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

function validationIssue(code, message, field = '') {
  return { code, message, field };
}

function collectReasonCodes(errors = [], warnings = []) {
  return unique([...asArray(errors), ...asArray(warnings)].map((issue) => issue.code)).sort();
}

function buildStageResult(stageName, validation = {}, extras = {}) {
  const errors = asArray(validation.errors);
  const warnings = asArray(validation.warnings);
  return deepFreeze({
    stageName,
    valid: validation.valid !== false && errors.length === 0,
    status: validation.valid !== false && errors.length === 0 ? 'passed' : 'failed',
    errors: clone(errors),
    warnings: clone(warnings),
    reasonCodes: collectReasonCodes(errors, warnings),
    ...clone(asObject(extras))
  });
}

function normalizeSession(session = {}) {
  return createReviewSession({
    sessionId: session.sessionId,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    reviewer: session.reviewer,
    sessionPurpose: session.sessionPurpose,
    sessionStatus: session.sessionStatus,
    reviewPackages: session.reviewPackages
  });
}

function normalizePipelineInput(input = {}) {
  const registry = input.registry ? normalizeRegistry(input.registry) : null;
  const lifecycle = input.lifecycle || null;
  const reviewSession = input.reviewSession || input.session
    ? normalizeSession(firstDefined(input.reviewSession, input.session))
    : null;
  const workspaceReview = input.workspaceReview || input.workspace
    ? firstDefined(input.workspaceReview, input.workspace)
    : (reviewSession ? createWorkspaceReview({
      workspaceReviewId: input.workspaceReviewId,
      workspaceId: input.workspaceId,
      createdAt: input.createdAt,
      asOf: input.asOf,
      reviewSession
    }, { registry, lifecycle, reviewSession }) : null);
  return { registry, lifecycle, reviewSession, workspaceReview };
}

function validateArtifactFlow(input = {}) {
  const pipeline = normalizePipelineInput(input);
  const errors = [];
  const warnings = [];
  const artifactFlowViolations = [];
  const fingerprintViolations = [];
  const registry = pipeline.registry;
  const session = pipeline.reviewSession;
  const workspace = pipeline.workspaceReview;

  if (!registry) {
    errors.push(validationIssue('registry_missing', 'Governance pipeline requires a Registry artifact.', 'registry'));
    artifactFlowViolations.push('registry');
  }
  if (!session) {
    errors.push(validationIssue('review_session_missing', 'Governance pipeline requires a Review Session artifact.', 'reviewSession'));
    artifactFlowViolations.push('reviewSession');
  }
  if (!workspace) {
    errors.push(validationIssue('workspace_review_missing', 'Governance pipeline requires a Workspace Review artifact.', 'workspaceReview'));
    artifactFlowViolations.push('workspaceReview');
  }

  if (registry && session) {
    for (const [index, reference] of asArray(session.reviewPackages).entries()) {
      const registration = getArtifact(registry, reference.packageId);
      if (!registration) {
        errors.push(validationIssue('pipeline_artifact_not_registered', 'Review Session package reference is missing from Registry.', `reviewSession.reviewPackages.${index}.packageId`));
        artifactFlowViolations.push(reference.packageId || UNKNOWN_VALUE);
      } else if (registration.artifactFingerprint !== reference.packageFingerprint) {
        errors.push(validationIssue('pipeline_artifact_fingerprint_mismatch', 'Review Session package fingerprint differs from Registry.', `reviewSession.reviewPackages.${index}.packageFingerprint`));
        fingerprintViolations.push(reference.packageId || UNKNOWN_VALUE);
      }
    }
  }

  if (session && workspace) {
    if (workspace.reviewSessionReference?.sessionId !== session.sessionId) {
      errors.push(validationIssue('workspace_session_id_mismatch', 'Workspace Review does not reference the supplied Review Session ID.', 'workspaceReview.reviewSessionReference.sessionId'));
      artifactFlowViolations.push('reviewSessionReference.sessionId');
    }
    if (workspace.reviewSessionReference?.sessionFingerprint !== session.sessionFingerprint) {
      errors.push(validationIssue('workspace_session_fingerprint_mismatch', 'Workspace Review does not preserve the supplied Review Session fingerprint.', 'workspaceReview.reviewSessionReference.sessionFingerprint'));
      fingerprintViolations.push('reviewSessionReference.sessionFingerprint');
    }
    const workspacePackageIds = new Set(asArray(workspace.workspaceSummary?.packageSummaries).map((summary) => summary.packageId));
    for (const reference of asArray(session.reviewPackages)) {
      if (!workspacePackageIds.has(reference.packageId)) {
        errors.push(validationIssue('workspace_package_missing', 'Workspace summary is missing a Review Session package.', reference.packageId));
        artifactFlowViolations.push(reference.packageId || UNKNOWN_VALUE);
      }
    }
  }

  return deepFreeze({
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes: collectReasonCodes(errors, warnings),
    artifactFlowViolations: unique(artifactFlowViolations).sort(),
    fingerprintViolations: unique(fingerprintViolations).sort(),
    artifactCount: registry ? listArtifacts(registry).length : 0,
    reviewPackageCount: session ? asArray(session.reviewPackages).length : 0
  });
}

function validateLifecycleTransitions(input = {}) {
  const pipeline = normalizePipelineInput(input);
  const errors = [];
  const warnings = [];
  const lifecycleViolations = [];
  const lifecycle = pipeline.lifecycle;
  const registry = pipeline.registry;
  const session = pipeline.reviewSession;

  if (!lifecycle) {
    errors.push(validationIssue('lifecycle_missing', 'Governance pipeline requires a Lifecycle artifact.', 'lifecycle'));
    lifecycleViolations.push('lifecycle');
  } else {
    const integrity = validateLifecycleIntegrity(lifecycle, registry ? { registry } : {});
    if (!integrity.valid) {
      errors.push(validationIssue('lifecycle_integrity_failed', 'Lifecycle integrity validation failed.', 'lifecycle'));
      lifecycleViolations.push(...asArray(integrity.lifecycleViolations));
    }
    const conformance = validateLifecycleConformance(lifecycle);
    if (!conformance.valid) {
      errors.push(validationIssue('lifecycle_conformance_failed', 'Lifecycle conformance validation failed.', 'lifecycle'));
      lifecycleViolations.push('lifecycle');
    }
  }

  if (lifecycle && session) {
    for (const reference of asArray(session.reviewPackages)) {
      const state = getLifecycleState(lifecycle, reference.packageId);
      if (reference.lifecycleState !== UNKNOWN_VALUE && reference.lifecycleState !== state.currentState) {
        errors.push(validationIssue('lifecycle_state_mismatch', 'Review Session package lifecycle state differs from Lifecycle Manager.', reference.packageId));
        lifecycleViolations.push(reference.packageId || UNKNOWN_VALUE);
      }
    }
  }

  return deepFreeze({
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes: collectReasonCodes(errors, warnings),
    lifecycleViolations: unique(lifecycleViolations).sort()
  });
}

function validateReviewSessionCoordination(input = {}) {
  const pipeline = normalizePipelineInput(input);
  const errors = [];
  const warnings = [];
  const sessionViolations = [];
  const session = pipeline.reviewSession;

  if (!session) {
    errors.push(validationIssue('review_session_missing', 'Governance pipeline requires a Review Session artifact.', 'reviewSession'));
    sessionViolations.push('reviewSession');
  } else {
    const integrity = validateReviewSessionIntegrity(session, {
      registry: pipeline.registry,
      lifecycle: pipeline.lifecycle
    });
    if (!integrity.valid) {
      errors.push(validationIssue('review_session_integrity_failed', 'Review Session integrity validation failed.', 'reviewSession'));
      sessionViolations.push(...asArray(integrity.invalidFields));
    }
    const conformance = validateReviewSessionConformance(session, {
      registry: pipeline.registry,
      lifecycle: pipeline.lifecycle
    });
    if (!conformance.valid) {
      errors.push(validationIssue('review_session_conformance_failed', 'Review Session conformance validation failed.', 'reviewSession'));
      sessionViolations.push('reviewSession');
    }
  }

  return deepFreeze({
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes: collectReasonCodes(errors, warnings),
    sessionViolations: unique(sessionViolations).sort()
  });
}

function validateWorkspaceAssembly(input = {}) {
  const pipeline = normalizePipelineInput(input);
  const errors = [];
  const warnings = [];
  const workspaceViolations = [];

  if (!pipeline.workspaceReview) {
    errors.push(validationIssue('workspace_review_missing', 'Governance pipeline requires a Workspace Review artifact.', 'workspaceReview'));
    workspaceViolations.push('workspaceReview');
  } else {
    const conformance = validateWorkspaceOrchestratorConformance(pipeline.workspaceReview, {
      registry: pipeline.registry,
      lifecycle: pipeline.lifecycle,
      reviewSession: pipeline.reviewSession
    });
    if (!conformance.valid) {
      errors.push(validationIssue('workspace_conformance_failed', 'Workspace Orchestrator conformance validation failed.', 'workspaceReview'));
      workspaceViolations.push('workspaceReview');
    }
    const validation = validateWorkspaceReview(pipeline.workspaceReview, {
      registry: pipeline.registry,
      lifecycle: pipeline.lifecycle,
      reviewSession: pipeline.reviewSession
    });
    if (!validation.valid) {
      errors.push(validationIssue('workspace_integrity_failed', 'Workspace Review integrity validation failed.', 'workspaceReview'));
      workspaceViolations.push(...asArray(validation.invalidFields));
    }
  }

  return deepFreeze({
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes: collectReasonCodes(errors, warnings),
    workspaceViolations: unique(workspaceViolations).sort()
  });
}

function validatePipelineIntegrity(input = {}) {
  const pipeline = normalizePipelineInput(input);
  const errors = [];
  const warnings = [];
  const integrityViolations = [];
  const authorityViolations = [];

  if (pipeline.registry && !validateRegistryConformance(pipeline.registry).valid) {
    errors.push(validationIssue('registry_conformance_failed', 'Registry conformance validation failed.', 'registry'));
    integrityViolations.push('registry');
  }
  if (pipeline.lifecycle && !validateLifecycleIntegrity(pipeline.lifecycle, pipeline.registry ? { registry: pipeline.registry } : {}).valid) {
    errors.push(validationIssue('lifecycle_integrity_failed', 'Lifecycle integrity validation failed.', 'lifecycle'));
    integrityViolations.push('lifecycle');
  }
  if (pipeline.reviewSession && !validateReviewSessionIntegrity(pipeline.reviewSession, {
    registry: pipeline.registry,
    lifecycle: pipeline.lifecycle
  }).valid) {
    errors.push(validationIssue('review_session_integrity_failed', 'Review Session integrity validation failed.', 'reviewSession'));
    integrityViolations.push('reviewSession');
  }
  if (pipeline.workspaceReview && !validateWorkspaceReview(pipeline.workspaceReview, {
    registry: pipeline.registry,
    lifecycle: pipeline.lifecycle,
    reviewSession: pipeline.reviewSession
  }).valid) {
    errors.push(validationIssue('workspace_integrity_failed', 'Workspace Review integrity validation failed.', 'workspaceReview'));
    integrityViolations.push('workspaceReview');
  }

  for (const [scope, artifact] of [
    ['registry', pipeline.registry],
    ['lifecycle', pipeline.lifecycle],
    ['reviewSession', pipeline.reviewSession],
    ['workspaceReview', pipeline.workspaceReview],
    ['workspaceSummary', pipeline.workspaceReview?.workspaceSummary]
  ]) {
    for (const field of ['productionImpact', 'decisionImpact', 'executionAuthority']) {
      if (known(asObject(artifact)[field]) && asObject(artifact)[field] !== 'none') {
        errors.push(validationIssue('authority_boundary_violation', `${scope}.${field} must remain none.`, `${scope}.${field}`));
        authorityViolations.push(`${scope}.${field}`);
      }
    }
  }

  return deepFreeze({
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes: collectReasonCodes(errors, warnings),
    integrityViolations: unique(integrityViolations).sort(),
    authorityViolations: unique(authorityViolations).sort()
  });
}

function buildPipelineValidationFingerprint(validation = {}) {
  const projection = clone(validation);
  delete projection.pipelineValidationFingerprint;
  return buildFingerprintFromProjection(projection);
}

function validatePipelineDeterminism(input = {}) {
  const pipeline = normalizePipelineInput(input);
  const errors = [];
  const warnings = [];
  const fingerprintViolations = [];
  const determinismViolations = [];

  if (pipeline.workspaceReview) {
    const firstSummary = summarizeWorkspaceReview(pipeline.workspaceReview);
    const secondSummary = summarizeWorkspaceReview(pipeline.workspaceReview);
    if (JSON.stringify(firstSummary) !== JSON.stringify(secondSummary)) {
      errors.push(validationIssue('workspace_summary_not_deterministic', 'Workspace summary changed across repeated calls.', 'workspaceReview'));
      determinismViolations.push('workspaceReview');
    }
  }

  const firstStages = validatePipelineStages(input);
  const secondStages = validatePipelineStages(input);
  if (JSON.stringify(firstStages.stageResults) !== JSON.stringify(secondStages.stageResults)) {
    errors.push(validationIssue('pipeline_stages_not_deterministic', 'Pipeline stage results changed across repeated validation.', 'stageResults'));
    determinismViolations.push('stageResults');
  }
  if (buildPipelineValidationFingerprint(firstStages) !== firstStages.pipelineValidationFingerprint) {
    errors.push(validationIssue('pipeline_fingerprint_mismatch', 'Pipeline validation fingerprint does not match stage result contents.', 'pipelineValidationFingerprint'));
    fingerprintViolations.push('pipelineValidationFingerprint');
  }

  return deepFreeze({
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes: collectReasonCodes(errors, warnings),
    fingerprintViolations: unique(fingerprintViolations).sort(),
    determinismViolations: unique(determinismViolations).sort()
  });
}

function validateOfflineBoundary(options = {}) {
  const errors = [];
  const warnings = [];
  const loadedModules = asArray(options.loadedModules);
  const prohibited = ['server.js', 'stateStore', 'scoutScannerService'];
  const violations = loadedModules.filter((moduleName) => prohibited.some((name) => String(moduleName).includes(name)));
  for (const moduleName of violations) {
    errors.push(validationIssue('runtime_import_detected', 'Governance pipeline end-to-end validation must remain offline-only.', moduleName));
  }
  return deepFreeze({
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes: collectReasonCodes(errors, warnings),
    offlineViolations: unique(violations).sort()
  });
}

function validateAuthorityBoundary(input = {}) {
  const integrity = validatePipelineIntegrity(input);
  return deepFreeze({
    valid: asArray(integrity.authorityViolations).length === 0,
    errors: integrity.errors.filter((error) => error.code === 'authority_boundary_violation'),
    warnings: [],
    reasonCodes: collectReasonCodes(integrity.errors.filter((error) => error.code === 'authority_boundary_violation'), []),
    authorityViolations: clone(asArray(integrity.authorityViolations))
  });
}

function validatePipelineStages(input = {}) {
  const stageValidations = {
    artifact_flow: validateArtifactFlow(input),
    lifecycle_transitions: validateLifecycleTransitions(input),
    review_session_coordination: validateReviewSessionCoordination(input),
    workspace_assembly: validateWorkspaceAssembly(input),
    cross_component_integrity: validatePipelineIntegrity(input),
    pipeline_determinism: { valid: true, errors: [], warnings: [], reasonCodes: [] },
    offline_boundary: validateOfflineBoundary(input),
    authority_boundary: validateAuthorityBoundary(input)
  };
  const stageResults = PIPELINE_STAGES.map((stageName) => buildStageResult(stageName, stageValidations[stageName]));
  const core = {
    schemaVersion: GOVERNANCE_PIPELINE_E2E_SCHEMA_VERSION,
    source: GOVERNANCE_PIPELINE_E2E_SOURCE,
    validationId: normalizeString(firstDefined(input.validationId, 'governance-pipeline-end-to-end-stage-validation')),
    stageResults,
    errors: stageResults.flatMap((stage) => stage.errors.map((error) => ({ ...error, stageName: stage.stageName }))),
    warnings: stageResults.flatMap((stage) => stage.warnings.map((warning) => ({ ...warning, stageName: stage.stageName }))),
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
  const withSummary = {
    ...core,
    valid: core.errors.length === 0,
    reasonCodes: collectReasonCodes(core.errors, core.warnings)
  };
  const finalCore = {
    ...withSummary,
    summary: summarizePipelineValidation(withSummary)
  };
  return deepFreeze({
    ...finalCore,
    pipelineValidationFingerprint: buildPipelineValidationFingerprint(finalCore)
  });
}

function validateGovernancePipeline(input = {}) {
  const inputBefore = clone(input);
  const stageValidation = validatePipelineStages(input);
  const determinism = validatePipelineDeterminism(input);
  const stageResults = stageValidation.stageResults.map((stage) => (
    stage.stageName === 'pipeline_determinism'
      ? buildStageResult('pipeline_determinism', determinism)
      : stage
  ));
  const errors = stageResults.flatMap((stage) => stage.errors.map((error) => ({ ...error, stageName: stage.stageName })));
  const warnings = stageResults.flatMap((stage) => stage.warnings.map((warning) => ({ ...warning, stageName: stage.stageName })));

  if (JSON.stringify(inputBefore) !== JSON.stringify(input)) {
    errors.push(validationIssue('pipeline_input_mutated', 'End-to-end pipeline validation mutated the input pipeline.', 'pipeline'));
  }

  const pipeline = normalizePipelineInput(input);
  const core = {
    schemaVersion: GOVERNANCE_PIPELINE_E2E_SCHEMA_VERSION,
    source: GOVERNANCE_PIPELINE_E2E_SOURCE,
    validationId: normalizeString(firstDefined(input.validationId, `governance-pipeline-end-to-end:${pipeline.workspaceReview?.workspaceReviewId || UNKNOWN_VALUE}`)),
    registryId: normalizeString(pipeline.registry?.registryId),
    registryFingerprint: normalizeString(pipeline.registry?.registryFingerprint),
    lifecycleId: normalizeString(pipeline.lifecycle?.lifecycleId),
    lifecycleFingerprint: normalizeString(pipeline.lifecycle?.lifecycleFingerprint),
    reviewSessionId: normalizeString(pipeline.reviewSession?.sessionId),
    reviewSessionFingerprint: normalizeString(pipeline.reviewSession?.sessionFingerprint),
    workspaceReviewId: normalizeString(pipeline.workspaceReview?.workspaceReviewId),
    workspaceFingerprint: normalizeString(pipeline.workspaceReview?.workspaceFingerprint),
    valid: errors.length === 0,
    stageResults,
    summary: summarizePipelineValidation({ stageResults, errors, warnings }),
    errors,
    warnings,
    reasonCodes: collectReasonCodes(errors, warnings),
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
  return deepFreeze({
    ...core,
    pipelineValidationFingerprint: buildPipelineValidationFingerprint(core)
  });
}

function summarizePipelineValidation(result = {}) {
  const stageResults = asArray(result.stageResults);
  const errors = asArray(result.errors);
  const warnings = asArray(result.warnings);
  const stageStatusSummary = {};
  for (const stage of stageResults) {
    const key = `${stage.stageName}:${stage.status}`;
    stageStatusSummary[key] = (stageStatusSummary[key] || 0) + 1;
  }
  return deepFreeze({
    schemaVersion: GOVERNANCE_PIPELINE_E2E_SCHEMA_VERSION,
    source: GOVERNANCE_PIPELINE_E2E_SOURCE,
    stageCount: stageResults.length,
    passedStageCount: stageResults.filter((stage) => stage.valid).length,
    failedStageCount: stageResults.filter((stage) => !stage.valid).length,
    errorCount: errors.length + stageResults.reduce((count, stage) => count + asArray(stage.errors).length, 0),
    warningCount: warnings.length + stageResults.reduce((count, stage) => count + asArray(stage.warnings).length, 0),
    stageStatusSummary: Object.fromEntries(Object.entries(stageStatusSummary).sort(([left], [right]) => left.localeCompare(right))),
    reasonCodes: collectReasonCodes(errors, warnings),
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  });
}

module.exports = {
  GOVERNANCE_PIPELINE_E2E_SCHEMA_VERSION,
  GOVERNANCE_PIPELINE_E2E_SOURCE,
  PIPELINE_STAGES,
  summarizePipelineValidation,
  validateArtifactFlow,
  validateGovernancePipeline,
  validatePipelineDeterminism,
  validatePipelineIntegrity,
  validatePipelineStages
};
