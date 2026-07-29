'use strict';

const { asArray, asObject, unique } = require('./canonicalValidationCore');
const { buildFingerprintFromProjection } = require('./fingerprintProjection');
const { clone, firstDefined } = require('./phase8GovernanceCore');
const {
  CERTIFICATION_READINESS,
  GOVERNANCE_REVIEW_WORKSPACE_SCHEMA_VERSION,
  GOVERNANCE_REVIEW_WORKSPACE_SOURCE,
  WORKSPACE_REVIEW_READINESS,
  assembleWorkspaceSummary,
  buildWorkspaceReviewFingerprint,
  createWorkspaceReview,
  deriveWorkspaceReadiness,
  listWorkspaceFindings,
  summarizeWorkspaceReview,
  validateWorkspaceReview
} = require('./governanceReviewWorkspaceOrchestrator');
const { validateRegistryConformance } = require('./governanceArtifactRegistryConformance');
const { validateLifecycleIntegrity } = require('./governanceArtifactLifecycleManager');
const { validateReviewSessionConformance } = require('./governanceReviewSessionConformance');

const GOVERNANCE_REVIEW_WORKSPACE_CONFORMANCE_SCHEMA_VERSION = '1.0.0';
const GOVERNANCE_REVIEW_WORKSPACE_CONFORMANCE_SOURCE = 'governance_review_workspace_orchestrator_conformance';
const UNKNOWN_VALUE = 'unknown';

const CONFORMANCE_STAGES = Object.freeze([
  'workspace_assembly',
  'workspace_readiness',
  'workspace_determinism',
  'workspace_integrity',
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

function optionReviewSession(options = {}) {
  return firstDefined(options.reviewSession, options.session);
}

function normalizeWorkspaceReview(workspaceReview = {}, options = {}) {
  if (known(workspaceReview.workspaceFingerprint)) return workspaceReview;
  return createWorkspaceReview({
    workspaceReviewId: workspaceReview.workspaceReviewId,
    workspaceId: workspaceReview.workspaceId,
    createdAt: workspaceReview.createdAt,
    asOf: workspaceReview.asOf,
    reviewSession: firstDefined(workspaceReview.reviewSession, optionReviewSession(options))
  }, options);
}

function validateWorkspaceAssembly(workspaceReview = {}, options = {}) {
  const normalized = normalizeWorkspaceReview(workspaceReview, options);
  const errors = [];
  const warnings = [];
  const assemblyViolations = [];
  const immutableViolations = [];
  const sessionViolations = [];

  if (normalized.schemaVersion !== GOVERNANCE_REVIEW_WORKSPACE_SCHEMA_VERSION) {
    errors.push(validationIssue('invalid_workspace_schema_version', 'Workspace review schemaVersion is unsupported.', 'schemaVersion'));
    assemblyViolations.push('schemaVersion');
  }
  if (normalized.source !== GOVERNANCE_REVIEW_WORKSPACE_SOURCE) {
    errors.push(validationIssue('invalid_workspace_source', 'Workspace review source is unsupported.', 'source'));
    assemblyViolations.push('source');
  }
  if (!Object.isFrozen(normalized)) {
    errors.push(validationIssue('workspace_review_not_immutable', 'Workspace review must be immutable.', 'workspaceReview'));
    immutableViolations.push('workspaceReview');
  }
  if (!Object.isFrozen(normalized.workspaceSummary)) {
    errors.push(validationIssue('workspace_summary_not_immutable', 'Workspace summary must be immutable.', 'workspaceSummary'));
    immutableViolations.push('workspaceSummary');
  }
  if (!Object.isFrozen(asArray(normalized.workspaceSummary?.packageSummaries))) {
    errors.push(validationIssue('package_summaries_not_immutable', 'Package summaries must be immutable.', 'workspaceSummary.packageSummaries'));
    immutableViolations.push('workspaceSummary.packageSummaries');
  }

  const reviewSession = optionReviewSession(options);
  const expectedSummary = assembleWorkspaceSummary({ reviewSession: reviewSession || {} }, options);
  if (reviewSession && JSON.stringify(expectedSummary) !== JSON.stringify(normalized.workspaceSummary)) {
    errors.push(validationIssue('workspace_summary_assembly_mismatch', 'Workspace summary does not match assembly from supplied Review Session.', 'workspaceSummary'));
    assemblyViolations.push('workspaceSummary');
  }
  if (reviewSession) {
    const sessionConformance = validateReviewSessionConformance(reviewSession, {
      registry: options.registry,
      lifecycle: options.lifecycle
    });
    if (!sessionConformance.valid) {
      errors.push(validationIssue('review_session_conformance_failed', 'Review Session failed conformance during workspace assembly.', 'reviewSession'));
      sessionViolations.push('reviewSession');
    }
  } else {
    warnings.push(validationIssue('review_session_not_supplied', 'Review Session integration conformance was not fully exercised.', 'reviewSession'));
  }

  return deepFreeze({
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes: collectReasonCodes(errors, warnings),
    assemblyViolations: unique(assemblyViolations).sort(),
    immutableViolations: unique(immutableViolations).sort(),
    sessionViolations: unique(sessionViolations).sort()
  });
}

function validateWorkspaceReadiness(workspaceReview = {}, options = {}) {
  const normalized = normalizeWorkspaceReview(workspaceReview, options);
  const errors = [];
  const warnings = [];
  const readinessViolations = [];
  const preservationViolations = [];
  const expected = deriveWorkspaceReadiness(normalized.workspaceSummary);

  if (JSON.stringify(expected) !== JSON.stringify(normalized.readiness)) {
    errors.push(validationIssue('workspace_readiness_mismatch', 'Workspace readiness must be derived deterministically from the workspace summary.', 'readiness'));
    readinessViolations.push('readiness');
  }
  if (!WORKSPACE_REVIEW_READINESS.includes(normalized.readiness?.reviewReadiness)) {
    errors.push(validationIssue('invalid_review_readiness', 'Review readiness is unsupported.', 'readiness.reviewReadiness'));
    readinessViolations.push('readiness.reviewReadiness');
  }
  if (!CERTIFICATION_READINESS.includes(normalized.readiness?.certificationReadiness)) {
    errors.push(validationIssue('invalid_certification_readiness', 'Certification readiness is unsupported.', 'readiness.certificationReadiness'));
    readinessViolations.push('readiness.certificationReadiness');
  }

  const summaries = asArray(normalized.workspaceSummary?.packageSummaries);
  const certificationOnlyBlockers = summaries.flatMap((summary) => asArray(summary.findings))
    .filter((finding) => finding.severity === 'blocking' && finding.readinessScope === 'certification');
  const reviewBlockers = summaries.flatMap((summary) => asArray(summary.findings))
    .filter((finding) => finding.severity === 'blocking' && finding.readinessScope !== 'certification');
  if (certificationOnlyBlockers.length > 0 && reviewBlockers.length === 0 && normalized.readiness.reviewReadiness === 'blocked') {
    errors.push(validationIssue('review_certification_readiness_not_separated', 'Certification-only blockers must not automatically block human review readiness.', 'readiness.reviewReadiness'));
    readinessViolations.push('readiness.reviewReadiness');
  }
  if (certificationOnlyBlockers.length > 0 && normalized.readiness.certificationReadiness !== 'blocked') {
    errors.push(validationIssue('certification_blocker_not_preserved', 'Certification-only blockers must remain visible in certification readiness.', 'readiness.certificationReadiness'));
    readinessViolations.push('readiness.certificationReadiness');
  }

  const findings = listWorkspaceFindings(normalized);
  for (const category of ['unknown', 'conflict', 'supersession', 'expiration', 'provenance', 'validation', 'authority']) {
    const count = findings.filter((finding) => finding.category === category).length;
    const summaryCount = summaries.reduce((total, summary) => total + asArray(summary.findings).filter((finding) => finding.category === category).length, 0);
    if (count !== summaryCount) {
      errors.push(validationIssue('workspace_finding_visibility_mismatch', `${category} findings must remain visible in workspace finding output.`, `findings.${category}`));
      preservationViolations.push(category);
    }
  }

  return deepFreeze({
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes: collectReasonCodes(errors, warnings),
    readinessViolations: unique(readinessViolations).sort(),
    preservationViolations: unique(preservationViolations).sort()
  });
}

function validateWorkspaceDeterminism(workspaceReview = {}, options = {}) {
  const normalized = normalizeWorkspaceReview(workspaceReview, options);
  const errors = [];
  const warnings = [];
  const fingerprintViolations = [];
  const determinismViolations = [];

  if (buildWorkspaceReviewFingerprint(normalized) !== normalized.workspaceFingerprint) {
    errors.push(validationIssue('workspace_fingerprint_mismatch', 'Workspace fingerprint does not match workspace contents.', 'workspaceFingerprint'));
    fingerprintViolations.push('workspaceFingerprint');
  }
  const reviewSession = optionReviewSession(options);
  const firstSummary = assembleWorkspaceSummary({ reviewSession: reviewSession || {} }, options);
  const secondSummary = assembleWorkspaceSummary({ reviewSession: reviewSession || {} }, options);
  if (JSON.stringify(firstSummary) !== JSON.stringify(secondSummary)) {
    errors.push(validationIssue('workspace_summary_not_deterministic', 'Workspace summary changed across repeated assembly.', 'workspaceSummary'));
    determinismViolations.push('workspaceSummary');
  }
  const firstFindings = listWorkspaceFindings(normalized);
  const secondFindings = listWorkspaceFindings(normalized);
  if (JSON.stringify(firstFindings) !== JSON.stringify(secondFindings)) {
    errors.push(validationIssue('workspace_findings_not_deterministic', 'Workspace findings changed across repeated calls.', 'findings'));
    determinismViolations.push('findings');
  }
  const firstReviewSummary = summarizeWorkspaceReview(normalized);
  const secondReviewSummary = summarizeWorkspaceReview(normalized);
  if (JSON.stringify(firstReviewSummary) !== JSON.stringify(secondReviewSummary)) {
    errors.push(validationIssue('workspace_review_summary_not_deterministic', 'Workspace review summary changed across repeated calls.', 'summary'));
    determinismViolations.push('summary');
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

function validateWorkspaceIntegrity(workspaceReview = {}, options = {}) {
  const normalized = normalizeWorkspaceReview(workspaceReview, options);
  const errors = [];
  const warnings = [];
  const integrityViolations = [];
  const registryViolations = [];
  const lifecycleViolations = [];
  const sessionViolations = [];
  const validationOptions = {
    ...options,
    reviewSession: optionReviewSession(options)
  };
  const validation = validateWorkspaceReview(normalized, validationOptions);

  if (!validation.valid) {
    errors.push(...validation.errors);
    integrityViolations.push(...asArray(validation.invalidFields));
    sessionViolations.push(...asArray(validation.sourceReferenceViolations).filter((field) => String(field).includes('Session')));
  }
  warnings.push(...asArray(validation.warnings));

  if (options.registry) {
    const registryConformance = validateRegistryConformance(options.registry);
    if (!registryConformance.valid) {
      errors.push(validationIssue('registry_conformance_failed', 'Registry failed conformance validation during workspace integrity checks.', 'registry'));
      registryViolations.push('registry');
    }
  } else {
    warnings.push(validationIssue('registry_not_supplied', 'Registry integration conformance was not fully exercised.', 'registry'));
  }
  if (options.lifecycle) {
    const lifecycleValidation = validateLifecycleIntegrity(options.lifecycle, options.registry ? { registry: options.registry } : {});
    if (!lifecycleValidation.valid) {
      errors.push(validationIssue('lifecycle_integrity_failed', 'Lifecycle failed integrity validation during workspace integrity checks.', 'lifecycle'));
      lifecycleViolations.push('lifecycle');
    }
  } else {
    warnings.push(validationIssue('lifecycle_not_supplied', 'Lifecycle integration conformance was not fully exercised.', 'lifecycle'));
  }

  return deepFreeze({
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes: collectReasonCodes(errors, warnings),
    integrityViolations: unique(integrityViolations).sort(),
    registryViolations: unique(registryViolations).sort(),
    lifecycleViolations: unique(lifecycleViolations).sort(),
    sessionViolations: unique(sessionViolations).sort()
  });
}

function validateOfflineBoundary(options = {}) {
  const errors = [];
  const warnings = [];
  const loadedModules = asArray(options.loadedModules);
  const prohibited = ['server.js', 'stateStore', 'scoutScannerService'];
  const violations = loadedModules.filter((moduleName) => prohibited.some((name) => String(moduleName).includes(name)));
  for (const moduleName of violations) {
    errors.push(validationIssue('runtime_import_detected', 'Workspace orchestrator conformance must remain offline-only.', moduleName));
  }
  return deepFreeze({
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes: collectReasonCodes(errors, warnings),
    offlineViolations: unique(violations).sort()
  });
}

function validateAuthorityBoundary(workspaceReview = {}) {
  const input = asObject(workspaceReview);
  const errors = [];
  const warnings = [];
  const authorityViolations = [];
  const scopes = [
    ['workspaceReview', input],
    ['workspaceSummary', input.workspaceSummary],
    ['workspaceReadiness', input.readiness]
  ];
  for (const [scope, artifact] of scopes) {
    for (const field of ['productionImpact', 'decisionImpact', 'executionAuthority']) {
      if (known(asObject(artifact)[field]) && asObject(artifact)[field] !== 'none') {
        errors.push(validationIssue('authority_boundary_violation', `${scope}.${field} must remain none.`, `${scope}.${field}`));
        authorityViolations.push(`${scope}.${field}`);
      }
    }
  }
  for (const [index, packageSummary] of asArray(input.workspaceSummary?.packageSummaries).entries()) {
    for (const field of ['productionImpact', 'decisionImpact', 'executionAuthority']) {
      if (known(packageSummary[field]) && packageSummary[field] !== 'none') {
        errors.push(validationIssue('authority_boundary_violation', `packageSummaries.${index}.${field} must remain none.`, `workspaceSummary.packageSummaries.${index}.${field}`));
        authorityViolations.push(`packageSummaries.${index}.${field}`);
      }
    }
  }
  return deepFreeze({
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes: collectReasonCodes(errors, warnings),
    authorityViolations: unique(authorityViolations).sort()
  });
}

function validateWorkspaceOrchestratorConformance(workspaceReview = {}, options = {}) {
  const inputBefore = clone(workspaceReview);
  const normalized = normalizeWorkspaceReview(workspaceReview, options);
  const stageValidations = {
    workspace_assembly: validateWorkspaceAssembly(normalized, options),
    workspace_readiness: validateWorkspaceReadiness(normalized, options),
    workspace_determinism: validateWorkspaceDeterminism(normalized, options),
    workspace_integrity: validateWorkspaceIntegrity(normalized, options),
    offline_boundary: validateOfflineBoundary(options),
    authority_boundary: validateAuthorityBoundary(normalized)
  };
  const stageResults = CONFORMANCE_STAGES.map((stageName) => buildStageResult(stageName, stageValidations[stageName]));
  const errors = stageResults.flatMap((stage) => stage.errors.map((error) => ({ ...error, stageName: stage.stageName })));
  const warnings = stageResults.flatMap((stage) => stage.warnings.map((warning) => ({ ...warning, stageName: stage.stageName })));

  if (JSON.stringify(inputBefore) !== JSON.stringify(workspaceReview)) {
    errors.push(validationIssue('workspace_input_mutated', 'Workspace orchestrator conformance validation mutated the input workspace review.', 'workspaceReview'));
  }

  const core = {
    schemaVersion: GOVERNANCE_REVIEW_WORKSPACE_CONFORMANCE_SCHEMA_VERSION,
    source: GOVERNANCE_REVIEW_WORKSPACE_CONFORMANCE_SOURCE,
    conformanceId: normalizeString(firstDefined(options.conformanceId, `governance-review-workspace-conformance:${normalized.workspaceReviewId}`)),
    workspaceReviewId: normalizeString(normalized.workspaceReviewId),
    workspaceFingerprint: normalizeString(normalized.workspaceFingerprint),
    valid: errors.length === 0,
    stageResults,
    summary: summarizeWorkspaceConformance({ stageResults, errors, warnings }),
    errors,
    warnings,
    reasonCodes: collectReasonCodes(errors, warnings),
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
  return deepFreeze({
    ...core,
    conformanceFingerprint: buildFingerprintFromProjection(core)
  });
}

function summarizeWorkspaceConformance(result = {}) {
  const stageResults = asArray(result.stageResults);
  const errors = asArray(result.errors);
  const warnings = asArray(result.warnings);
  const summary = {
    schemaVersion: GOVERNANCE_REVIEW_WORKSPACE_CONFORMANCE_SCHEMA_VERSION,
    source: GOVERNANCE_REVIEW_WORKSPACE_CONFORMANCE_SOURCE,
    stageCount: stageResults.length,
    passedStageCount: stageResults.filter((stage) => stage.valid).length,
    failedStageCount: stageResults.filter((stage) => !stage.valid).length,
    warningCount: warnings.length + stageResults.reduce((count, stage) => count + asArray(stage.warnings).length, 0),
    errorCount: errors.length + stageResults.reduce((count, stage) => count + asArray(stage.errors).length, 0),
    stageStatusSummary: {},
    reasonCodes: collectReasonCodes(errors, warnings),
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
  for (const stage of stageResults) {
    const key = `${stage.stageName}:${stage.status}`;
    summary.stageStatusSummary[key] = (summary.stageStatusSummary[key] || 0) + 1;
  }
  summary.stageStatusSummary = Object.fromEntries(Object.entries(summary.stageStatusSummary).sort(([left], [right]) => left.localeCompare(right)));
  return deepFreeze(summary);
}

module.exports = {
  CONFORMANCE_STAGES,
  GOVERNANCE_REVIEW_WORKSPACE_CONFORMANCE_SCHEMA_VERSION,
  GOVERNANCE_REVIEW_WORKSPACE_CONFORMANCE_SOURCE,
  summarizeWorkspaceConformance,
  validateWorkspaceAssembly,
  validateWorkspaceDeterminism,
  validateWorkspaceIntegrity,
  validateWorkspaceOrchestratorConformance,
  validateWorkspaceReadiness
};
