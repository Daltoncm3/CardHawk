'use strict';

const { asArray, asObject, unique } = require('./canonicalValidationCore');
const { buildFingerprintFromProjection } = require('./fingerprintProjection');
const { clone, firstDefined } = require('./phase8GovernanceCore');
const {
  GOVERNANCE_REVIEW_SESSION_SCHEMA_VERSION,
  GOVERNANCE_REVIEW_SESSION_SOURCE,
  REVIEW_SESSION_STATUSES,
  attachReviewPackage,
  buildReviewPackageReferenceFingerprint,
  buildReviewSessionFingerprint,
  createReviewSession,
  getReviewSessionState,
  summarizeReviewSession,
  validateReviewSession,
  validateReviewSessionIntegrity
} = require('./governanceReviewSessionManager');
const { getArtifact, listArtifacts, normalizeRegistry } = require('./governanceArtifactRegistry');
const { getLifecycleState, validateLifecycleIntegrity } = require('./governanceArtifactLifecycleManager');
const { validateRegistryConformance } = require('./governanceArtifactRegistryConformance');

const GOVERNANCE_REVIEW_SESSION_CONFORMANCE_SCHEMA_VERSION = '1.0.0';
const GOVERNANCE_REVIEW_SESSION_CONFORMANCE_SOURCE = 'governance_review_session_conformance';
const UNKNOWN_VALUE = 'unknown';

const CONFORMANCE_STAGES = Object.freeze([
  'session_state_model',
  'package_bindings',
  'session_determinism',
  'session_integrity',
  'registry_integration',
  'lifecycle_integration',
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

function firstRegisteredReviewPackage(registry = {}) {
  const normalized = normalizeRegistry(registry);
  return listArtifacts(normalized)
    .find((registration) => ['review_package', 'review_package_signal_binding'].includes(registration.artifactType));
}

function validateSessionStateModel(session = {}) {
  const input = asObject(session);
  const normalized = normalizeSession(session);
  const errors = [];
  const warnings = [];
  const stateViolations = [];
  const immutableViolations = [];

  if (input.schemaVersion && input.schemaVersion !== GOVERNANCE_REVIEW_SESSION_SCHEMA_VERSION) {
    errors.push(validationIssue('invalid_session_schema_version', 'Review session schemaVersion is unsupported.', 'schemaVersion'));
    stateViolations.push('schemaVersion');
  }
  if (input.source && input.source !== GOVERNANCE_REVIEW_SESSION_SOURCE) {
    errors.push(validationIssue('invalid_session_source', 'Review session source is unsupported.', 'source'));
    stateViolations.push('source');
  }
  if (!REVIEW_SESSION_STATUSES.includes(normalized.sessionStatus)) {
    errors.push(validationIssue('invalid_session_status', 'Review session status is unsupported.', 'sessionStatus'));
    stateViolations.push('sessionStatus');
  }
  if (!Object.isFrozen(normalized)) {
    errors.push(validationIssue('session_not_immutable', 'Normalized review session must be immutable.', 'session'));
    immutableViolations.push('session');
  }
  if (!Object.isFrozen(normalized.reviewPackages)) {
    errors.push(validationIssue('review_packages_not_immutable', 'Review package references must be immutable.', 'reviewPackages'));
    immutableViolations.push('reviewPackages');
  }
  for (const [index, reference] of normalized.reviewPackages.entries()) {
    if (!Object.isFrozen(reference)) {
      errors.push(validationIssue('review_package_reference_not_immutable', 'Review package reference must be immutable.', `reviewPackages.${index}`));
      immutableViolations.push(`reviewPackages.${index}`);
    }
  }
  const state = getReviewSessionState(normalized);
  if (!REVIEW_SESSION_STATUSES.includes(state.sessionStatus)) {
    errors.push(validationIssue('invalid_derived_session_status', 'Derived review session status is unsupported.', 'sessionStatus'));
    stateViolations.push('sessionStatus');
  }

  return deepFreeze({
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes: collectReasonCodes(errors, warnings),
    stateViolations: unique(stateViolations).sort(),
    immutableViolations: unique(immutableViolations).sort()
  });
}

function validatePackageBindings(session = {}, options = {}) {
  const normalized = normalizeSession(session);
  const errors = [];
  const warnings = [];
  const bindingViolations = [];
  const registryViolations = [];
  const lifecycleViolations = [];
  const registry = options.registry ? normalizeRegistry(options.registry) : null;

  if (registry) {
    const fixtureRegistration = firstRegisteredReviewPackage(registry);
    if (fixtureRegistration) {
      const base = createReviewSession({
        sessionId: 'review-session-conformance-attachment-fixture',
        createdAt: '2026-07-29T17:00:00.000Z'
      });
      const attached = attachReviewPackage(base, fixtureRegistration.artifact || {}, {
        registry,
        lifecycle: options.lifecycle,
        artifactId: fixtureRegistration.artifactId,
        artifactFingerprint: fixtureRegistration.artifactFingerprint,
        packageId: fixtureRegistration.artifactId,
        packageFingerprint: fixtureRegistration.artifactFingerprint,
        packageSchemaVersion: fixtureRegistration.artifactSchemaVersion,
        attachedAt: '2026-07-29T17:01:00.000Z'
      });
      if (attached.attached !== true) {
        errors.push(validationIssue('valid_review_package_attachment_rejected', 'Review Session Manager rejected a valid package attachment fixture.', 'attachReviewPackage'));
        bindingViolations.push(fixtureRegistration.artifactId);
      } else {
        const duplicate = attachReviewPackage(attached.session, fixtureRegistration.artifact || {}, {
          registry,
          lifecycle: options.lifecycle,
          artifactId: fixtureRegistration.artifactId,
          artifactFingerprint: fixtureRegistration.artifactFingerprint,
          packageId: fixtureRegistration.artifactId,
          packageFingerprint: fixtureRegistration.artifactFingerprint,
          packageSchemaVersion: fixtureRegistration.artifactSchemaVersion,
          attachedAt: '2026-07-29T17:02:00.000Z'
        });
        if (duplicate.attached !== false || !asArray(duplicate.validation.reasonCodes).includes('duplicate_review_package_id')) {
          errors.push(validationIssue('duplicate_review_package_attachment_not_rejected', 'Review Session Manager did not reject duplicate package attachment.', 'attachReviewPackage'));
          bindingViolations.push(fixtureRegistration.artifactId);
        }
      }
    } else {
      warnings.push(validationIssue('no_review_package_fixture_available', 'Registry does not contain a review package artifact for attachment conformance.', 'registry'));
    }
  } else {
    warnings.push(validationIssue('registry_not_supplied', 'Registry binding conformance was not fully exercised.', 'registry'));
  }

  for (const [index, reference] of normalized.reviewPackages.entries()) {
    if (buildReviewPackageReferenceFingerprint(reference) !== reference.referenceFingerprint) {
      errors.push(validationIssue('reference_fingerprint_mismatch', 'Review package reference fingerprint is not deterministic.', `reviewPackages.${index}.referenceFingerprint`));
      bindingViolations.push(reference.packageId);
    }
    if (registry) {
      const registered = getArtifact(registry, reference.packageId);
      if (!registered) {
        errors.push(validationIssue('package_not_registered', 'Review package reference is not present in the registry.', `reviewPackages.${index}.packageId`));
        registryViolations.push(reference.packageId);
      } else if (registered.artifactFingerprint !== reference.packageFingerprint) {
        errors.push(validationIssue('registry_package_fingerprint_mismatch', 'Review package reference fingerprint differs from registry.', `reviewPackages.${index}.packageFingerprint`));
        registryViolations.push(reference.packageId);
      }
    }
    if (options.lifecycle) {
      const state = getLifecycleState(options.lifecycle, reference.packageId);
      if (reference.lifecycleState !== UNKNOWN_VALUE && reference.lifecycleState !== state.currentState) {
        errors.push(validationIssue('lifecycle_state_mismatch', 'Review package reference lifecycle state differs from lifecycle manager.', `reviewPackages.${index}.lifecycleState`));
        lifecycleViolations.push(reference.packageId);
      }
    }
  }

  return deepFreeze({
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes: collectReasonCodes(errors, warnings),
    bindingViolations: unique(bindingViolations).sort(),
    registryViolations: unique(registryViolations).sort(),
    lifecycleViolations: unique(lifecycleViolations).sort()
  });
}

function validateSessionDeterminism(session = {}) {
  const input = asObject(session);
  const normalized = normalizeSession(session);
  const errors = [];
  const warnings = [];
  const fingerprintViolations = [];
  const determinismViolations = [];

  if (known(input.sessionFingerprint) && buildReviewSessionFingerprint(input) !== input.sessionFingerprint) {
    errors.push(validationIssue('session_fingerprint_mismatch', 'Supplied session fingerprint does not match supplied session contents.', 'sessionFingerprint'));
    fingerprintViolations.push('sessionFingerprint');
  }
  if (buildReviewSessionFingerprint(normalized) !== normalized.sessionFingerprint) {
    errors.push(validationIssue('session_fingerprint_mismatch', 'Normalized session fingerprint does not match session contents.', 'sessionFingerprint'));
    fingerprintViolations.push('sessionFingerprint');
  }
  for (const [index, reference] of asArray(input.reviewPackages).entries()) {
    if (known(reference.referenceFingerprint) && buildReviewPackageReferenceFingerprint(reference) !== reference.referenceFingerprint) {
      errors.push(validationIssue('reference_fingerprint_mismatch', 'Supplied reference fingerprint does not match reference contents.', `reviewPackages.${index}.referenceFingerprint`));
      fingerprintViolations.push(`reviewPackages.${index}.referenceFingerprint`);
    }
  }

  const firstSummary = summarizeReviewSession(normalized);
  const secondSummary = summarizeReviewSession(normalized);
  if (JSON.stringify(firstSummary) !== JSON.stringify(secondSummary)) {
    errors.push(validationIssue('session_summary_not_deterministic', 'Review session summary changed across repeated calls.', 'summary'));
    determinismViolations.push('summary');
  }
  const firstState = getReviewSessionState(normalized);
  const secondState = getReviewSessionState(normalized);
  if (JSON.stringify(firstState) !== JSON.stringify(secondState)) {
    errors.push(validationIssue('session_state_not_deterministic', 'Review session state changed across repeated calls.', 'state'));
    determinismViolations.push('state');
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

function validateSessionIntegrity(session = {}, options = {}) {
  const errors = [];
  const warnings = [];
  const integrityViolations = [];
  const registryViolations = [];
  const lifecycleViolations = [];
  const authorityViolations = [];
  const validation = validateReviewSessionIntegrity(session, options);

  if (!validation.valid) {
    errors.push(...validation.errors);
    integrityViolations.push(...asArray(validation.invalidFields));
    registryViolations.push(...asArray(validation.registryViolations));
    lifecycleViolations.push(...asArray(validation.lifecycleViolations));
    authorityViolations.push(...asArray(validation.authorityViolations));
  }
  warnings.push(...asArray(validation.warnings));

  return deepFreeze({
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes: collectReasonCodes(errors, warnings),
    integrityViolations: unique(integrityViolations).sort(),
    registryViolations: unique(registryViolations).sort(),
    lifecycleViolations: unique(lifecycleViolations).sort(),
    authorityViolations: unique(authorityViolations).sort()
  });
}

function validateRegistryIntegration(options = {}) {
  const errors = [];
  const warnings = [];
  const registryViolations = [];
  if (!options.registry) {
    warnings.push(validationIssue('registry_not_supplied', 'Registry integration conformance was not exercised.', 'registry'));
    return deepFreeze({ valid: true, errors, warnings, reasonCodes: collectReasonCodes(errors, warnings), registryViolations });
  }
  const validation = validateRegistryConformance(options.registry);
  if (!validation.valid) {
    errors.push(validationIssue('registry_conformance_failed', 'Bound registry failed conformance validation.', 'registry'));
    registryViolations.push('registry');
  }
  return deepFreeze({
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes: collectReasonCodes(errors, warnings),
    registryViolations: unique(registryViolations).sort()
  });
}

function validateLifecycleIntegration(options = {}) {
  const errors = [];
  const warnings = [];
  const lifecycleViolations = [];
  if (!options.lifecycle) {
    warnings.push(validationIssue('lifecycle_not_supplied', 'Lifecycle integration conformance was not exercised.', 'lifecycle'));
    return deepFreeze({ valid: true, errors, warnings, reasonCodes: collectReasonCodes(errors, warnings), lifecycleViolations });
  }
  const validation = validateLifecycleIntegrity(options.lifecycle, options.registry ? { registry: options.registry } : {});
  if (!validation.valid) {
    errors.push(validationIssue('lifecycle_integrity_failed', 'Bound lifecycle failed integrity validation.', 'lifecycle'));
    lifecycleViolations.push('lifecycle');
  }
  return deepFreeze({
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes: collectReasonCodes(errors, warnings),
    lifecycleViolations: unique(lifecycleViolations).sort()
  });
}

function validateOfflineBoundary(options = {}) {
  const errors = [];
  const warnings = [];
  const loadedModules = asArray(options.loadedModules);
  const prohibited = ['server.js', 'stateStore', 'scoutScannerService'];
  const violations = loadedModules.filter((moduleName) => prohibited.some((name) => String(moduleName).includes(name)));
  for (const moduleName of violations) {
    errors.push(validationIssue('runtime_import_detected', 'Review session conformance must remain offline-only.', moduleName));
  }
  return deepFreeze({
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes: collectReasonCodes(errors, warnings),
    offlineViolations: unique(violations).sort()
  });
}

function validateAuthorityBoundary(session = {}) {
  const input = asObject(session);
  const normalized = normalizeSession(session);
  const errors = [];
  const warnings = [];
  const authorityViolations = [];
  for (const [scope, artifact] of [['session', input], ['normalizedSession', normalized]]) {
    for (const field of ['productionImpact', 'decisionImpact', 'executionAuthority']) {
      if (known(artifact[field]) && artifact[field] !== 'none') {
        errors.push(validationIssue('authority_boundary_violation', `${scope}.${field} must remain none.`, `${scope}.${field}`));
        authorityViolations.push(`${scope}.${field}`);
      }
    }
  }
  for (const [index, reference] of asArray(input.reviewPackages).entries()) {
    for (const field of ['productionImpact', 'decisionImpact', 'executionAuthority']) {
      if (known(reference[field]) && reference[field] !== 'none') {
        errors.push(validationIssue('authority_boundary_violation', `reviewPackages.${index}.${field} must remain none.`, `reviewPackages.${index}.${field}`));
        authorityViolations.push(`reviewPackages.${index}.${field}`);
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

function validateReviewSessionConformance(session = createReviewSession(), options = {}) {
  const inputBefore = clone(session);
  const normalized = normalizeSession(session);
  const stageValidations = {
    session_state_model: validateSessionStateModel(normalized),
    package_bindings: validatePackageBindings(normalized, options),
    session_determinism: validateSessionDeterminism(session),
    session_integrity: validateSessionIntegrity(normalized, options),
    registry_integration: validateRegistryIntegration(options),
    lifecycle_integration: validateLifecycleIntegration(options),
    offline_boundary: validateOfflineBoundary(options),
    authority_boundary: validateAuthorityBoundary(session)
  };
  const stageResults = CONFORMANCE_STAGES.map((stageName) => buildStageResult(stageName, stageValidations[stageName]));
  const errors = stageResults.flatMap((stage) => stage.errors.map((error) => ({ ...error, stageName: stage.stageName })));
  const warnings = stageResults.flatMap((stage) => stage.warnings.map((warning) => ({ ...warning, stageName: stage.stageName })));

  if (JSON.stringify(inputBefore) !== JSON.stringify(session)) {
    errors.push(validationIssue('session_input_mutated', 'Review session conformance validation mutated the input session.', 'session'));
  }

  const core = {
    schemaVersion: GOVERNANCE_REVIEW_SESSION_CONFORMANCE_SCHEMA_VERSION,
    source: GOVERNANCE_REVIEW_SESSION_CONFORMANCE_SOURCE,
    conformanceId: normalizeString(firstDefined(options.conformanceId, `governance-review-session-conformance:${normalized.sessionId}`)),
    sessionId: normalized.sessionId,
    sessionFingerprint: normalized.sessionFingerprint,
    valid: errors.length === 0,
    stageResults,
    summary: summarizeReviewSessionConformance({ stageResults, errors, warnings }),
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

function summarizeReviewSessionConformance(result = {}) {
  const stageResults = asArray(result.stageResults);
  const summary = {
    stageCount: stageResults.length,
    passedStageCount: stageResults.filter((stage) => stage.valid).length,
    failedStageCount: stageResults.filter((stage) => !stage.valid).length,
    warningCount: asArray(result.warnings).length + stageResults.reduce((count, stage) => count + asArray(stage.warnings).length, 0),
    errorCount: asArray(result.errors).length + stageResults.reduce((count, stage) => count + asArray(stage.errors).length, 0),
    stageStatusSummary: {},
    reasonCodes: collectReasonCodes(result.errors, result.warnings),
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
  GOVERNANCE_REVIEW_SESSION_CONFORMANCE_SCHEMA_VERSION,
  GOVERNANCE_REVIEW_SESSION_CONFORMANCE_SOURCE,
  summarizeReviewSessionConformance,
  validatePackageBindings,
  validateReviewSessionConformance,
  validateSessionDeterminism,
  validateSessionIntegrity,
  validateSessionStateModel
};
