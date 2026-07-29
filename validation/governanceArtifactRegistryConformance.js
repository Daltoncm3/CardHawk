'use strict';

const { asArray, asObject, unique } = require('./canonicalValidationCore');
const { buildFingerprintFromProjection } = require('./fingerprintProjection');
const { clone, firstDefined } = require('./phase8GovernanceCore');
const {
  GOVERNANCE_ARTIFACT_REGISTRY_SCHEMA_VERSION,
  GOVERNANCE_ARTIFACT_REGISTRY_SOURCE,
  buildGovernanceArtifactRegistryFingerprint,
  buildRegistrationFingerprint,
  createGovernanceArtifactRegistry,
  detectSupersession,
  getArtifact,
  getArtifactByFingerprint,
  listArtifacts,
  normalizeRegistry,
  registerArtifact,
  summarizeRegistry,
  validateArtifactRegistration
} = require('./governanceArtifactRegistry');

const GOVERNANCE_ARTIFACT_REGISTRY_CONFORMANCE_SCHEMA_VERSION = '1.0.0';
const GOVERNANCE_ARTIFACT_REGISTRY_CONFORMANCE_SOURCE = 'governance_artifact_registry_conformance';
const UNKNOWN_VALUE = 'unknown';

const CONFORMANCE_STAGES = Object.freeze([
  'artifact_integrity',
  'fingerprint_consistency',
  'supersession_chain',
  'schema_compatibility',
  'registry_consistency',
  'duplicate_rejection',
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

function summarizeIssues(errors = [], warnings = []) {
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
    reasonCodes: summarizeIssues(errors, warnings),
    ...clone(asObject(extras))
  });
}

function normalizeForValidation(registry = {}) {
  return normalizeRegistry(registry);
}

function validateArtifactIntegrity(registry = {}) {
  const normalized = normalizeForValidation(registry);
  const errors = [];
  const warnings = [];
  const duplicateRegistrations = [];
  const invalidRegistrations = [];
  const immutableViolations = [];
  const idCounts = {};
  const fingerprintCounts = {};

  if (!Object.isFrozen(normalized)) {
    errors.push(validationIssue('registry_not_immutable', 'Registry object must be immutable.', 'registry'));
    immutableViolations.push('registry');
  }
  if (!Object.isFrozen(normalized.registrations)) {
    errors.push(validationIssue('registrations_not_immutable', 'Registry registrations array must be immutable.', 'registrations'));
    immutableViolations.push('registrations');
  }

  for (const [index, registration] of asArray(normalized.registrations).entries()) {
    const path = `registrations.${index}`;
    if (!Object.isFrozen(registration)) {
      errors.push(validationIssue('registration_not_immutable', 'Registration object must be immutable.', path));
      immutableViolations.push(path);
    }
    idCounts[registration.artifactId] = (idCounts[registration.artifactId] || 0) + 1;
    fingerprintCounts[registration.artifactFingerprint] = (fingerprintCounts[registration.artifactFingerprint] || 0) + 1;

    const validation = validateArtifactRegistration(registration);
    if (!validation.valid) {
      errors.push(validationIssue('invalid_artifact_registration', 'Registration failed registry validation.', path));
      invalidRegistrations.push(registration.registrationId || path);
    }
    for (const warning of asArray(validation.warnings)) warnings.push({ ...warning, field: warning.field || path });
  }

  for (const [artifactId, count] of Object.entries(idCounts)) {
    if (artifactId !== UNKNOWN_VALUE && count > 1) {
      errors.push(validationIssue('duplicate_artifact_id', 'Artifact ID appears more than once.', 'registrations'));
      duplicateRegistrations.push(artifactId);
    }
  }
  for (const [fingerprint, count] of Object.entries(fingerprintCounts)) {
    if (fingerprint !== UNKNOWN_VALUE && count > 1) {
      errors.push(validationIssue('duplicate_artifact_fingerprint', 'Artifact fingerprint appears more than once.', 'registrations'));
      duplicateRegistrations.push(fingerprint);
    }
  }

  return deepFreeze({
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes: summarizeIssues(errors, warnings),
    duplicateRegistrations: unique(duplicateRegistrations).sort(),
    invalidRegistrations: unique(invalidRegistrations).sort(),
    immutableViolations: unique(immutableViolations).sort()
  });
}

function validateFingerprintConsistency(registry = {}) {
  const input = asObject(registry);
  const normalized = normalizeForValidation(registry);
  const errors = [];
  const warnings = [];
  const fingerprintViolations = [];

  if (known(input.registryFingerprint) && buildGovernanceArtifactRegistryFingerprint(input) !== input.registryFingerprint) {
    errors.push(validationIssue('registry_fingerprint_mismatch', 'Registry fingerprint is not deterministic for supplied registry contents.', 'registryFingerprint'));
    fingerprintViolations.push('registryFingerprint');
  }
  if (buildGovernanceArtifactRegistryFingerprint(normalized) !== normalized.registryFingerprint) {
    errors.push(validationIssue('registry_fingerprint_mismatch', 'Registry fingerprint is not deterministic for registry contents.', 'registryFingerprint'));
    fingerprintViolations.push('registryFingerprint');
  }

  const firstSummary = summarizeRegistry(normalized);
  const secondSummary = summarizeRegistry(normalized);
  if (JSON.stringify(firstSummary) !== JSON.stringify(secondSummary)) {
    errors.push(validationIssue('summary_not_deterministic', 'Registry summary changed across repeated calls.', 'summary'));
    fingerprintViolations.push('summary');
  }

  const firstList = listArtifacts(normalized);
  const secondList = listArtifacts(normalized);
  if (JSON.stringify(firstList) !== JSON.stringify(secondList)) {
    errors.push(validationIssue('list_not_deterministic', 'Registry listing changed across repeated calls.', 'registrations'));
    fingerprintViolations.push('registrations');
  }

  for (const [index, registration] of firstList.entries()) {
    const path = `registrations.${index}`;
    if (buildRegistrationFingerprint(registration) !== registration.registrationFingerprint) {
      errors.push(validationIssue('registration_fingerprint_mismatch', 'Registration fingerprint does not match registration contents.', `${path}.registrationFingerprint`));
      fingerprintViolations.push(`${path}.registrationFingerprint`);
    }
    const byId = getArtifact(normalized, registration.artifactId);
    const byFingerprint = getArtifactByFingerprint(normalized, registration.artifactFingerprint);
    if (!byId || byId.registrationFingerprint !== registration.registrationFingerprint) {
      errors.push(validationIssue('artifact_id_lookup_unstable', 'Artifact ID lookup did not return the expected registration.', `${path}.artifactId`));
      fingerprintViolations.push(`${path}.artifactId`);
    }
    if (!byFingerprint || byFingerprint.registrationFingerprint !== registration.registrationFingerprint) {
      errors.push(validationIssue('artifact_fingerprint_lookup_unstable', 'Artifact fingerprint lookup did not return the expected registration.', `${path}.artifactFingerprint`));
      fingerprintViolations.push(`${path}.artifactFingerprint`);
    }
  }

  return deepFreeze({
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes: summarizeIssues(errors, warnings),
    fingerprintViolations: unique(fingerprintViolations).sort()
  });
}

function validateSupersessionChain(registry = {}) {
  const normalized = normalizeForValidation(registry);
  const errors = [];
  const warnings = [];
  const supersessionViolations = [];
  const registrations = listArtifacts(normalized);

  for (const [index, registration] of registrations.entries()) {
    const path = `registrations.${index}`;
    if (registration.supersedesArtifactId === registration.artifactId && registration.artifactId !== UNKNOWN_VALUE) {
      errors.push(validationIssue('self_supersession', 'Registration cannot supersede itself.', `${path}.supersedesArtifactId`));
      supersessionViolations.push(registration.artifactId);
    }
    if (registration.supersededByArtifactId === registration.artifactId && registration.artifactId !== UNKNOWN_VALUE) {
      errors.push(validationIssue('self_supersession', 'Registration cannot be superseded by itself.', `${path}.supersededByArtifactId`));
      supersessionViolations.push(registration.artifactId);
    }

    if (known(registration.supersedesArtifactId) && registration.supersedesArtifactId !== UNKNOWN_VALUE && !getArtifact(normalized, registration.supersedesArtifactId)) {
      errors.push(validationIssue('missing_superseded_artifact', 'supersedesArtifactId must reference a registered artifact.', `${path}.supersedesArtifactId`));
      supersessionViolations.push(registration.supersedesArtifactId);
    }
    if (known(registration.supersedesArtifactFingerprint) && registration.supersedesArtifactFingerprint !== UNKNOWN_VALUE && !getArtifactByFingerprint(normalized, registration.supersedesArtifactFingerprint)) {
      errors.push(validationIssue('missing_superseded_fingerprint', 'supersedesArtifactFingerprint must reference a registered artifact.', `${path}.supersedesArtifactFingerprint`));
      supersessionViolations.push(registration.supersedesArtifactFingerprint);
    }
    if (known(registration.supersededByArtifactId) && registration.supersededByArtifactId !== UNKNOWN_VALUE && !getArtifact(normalized, registration.supersededByArtifactId)) {
      errors.push(validationIssue('missing_superseding_artifact', 'supersededByArtifactId must reference a registered artifact.', `${path}.supersededByArtifactId`));
      supersessionViolations.push(registration.supersededByArtifactId);
    }
    if (known(registration.supersededByArtifactFingerprint) && registration.supersededByArtifactFingerprint !== UNKNOWN_VALUE && !getArtifactByFingerprint(normalized, registration.supersededByArtifactFingerprint)) {
      errors.push(validationIssue('missing_superseding_fingerprint', 'supersededByArtifactFingerprint must reference a registered artifact.', `${path}.supersededByArtifactFingerprint`));
      supersessionViolations.push(registration.supersededByArtifactFingerprint);
    }

    const supersession = detectSupersession(normalized, registration.artifactId);
    if (!supersession.found) {
      errors.push(validationIssue('supersession_lookup_failed', 'Supersession lookup could not find the target registration.', `${path}.artifactId`));
      supersessionViolations.push(registration.artifactId);
    }
  }

  return deepFreeze({
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes: summarizeIssues(errors, warnings),
    supersessionViolations: unique(supersessionViolations).sort()
  });
}

function validateSchemaCompatibility(registry = {}, options = {}) {
  const normalized = normalizeForValidation(registry);
  const errors = [];
  const warnings = [];
  const schemaViolations = [];
  const supportedRegistryVersions = asArray(firstDefined(options.supportedRegistryVersions, [GOVERNANCE_ARTIFACT_REGISTRY_SCHEMA_VERSION]));

  if (normalized.schemaVersion !== GOVERNANCE_ARTIFACT_REGISTRY_SCHEMA_VERSION) {
    errors.push(validationIssue('invalid_registry_schema_version', 'Registry schemaVersion is not supported.', 'schemaVersion'));
    schemaViolations.push('schemaVersion');
  }
  if (!supportedRegistryVersions.includes(normalized.registryVersion)) {
    warnings.push(validationIssue('unsupported_registry_version', 'Registry version is not in the supported version list.', 'registryVersion'));
    schemaViolations.push('registryVersion');
  }
  if (normalized.source !== GOVERNANCE_ARTIFACT_REGISTRY_SOURCE) {
    errors.push(validationIssue('invalid_registry_source', 'Registry source must be governance_artifact_registry.', 'source'));
    schemaViolations.push('source');
  }

  for (const [index, registration] of listArtifacts(normalized).entries()) {
    const path = `registrations.${index}`;
    if (registration.schemaVersion !== GOVERNANCE_ARTIFACT_REGISTRY_SCHEMA_VERSION) {
      errors.push(validationIssue('invalid_registration_schema_version', 'Registration schemaVersion is not supported.', `${path}.schemaVersion`));
      schemaViolations.push(`${path}.schemaVersion`);
    }
    if (!known(registration.artifactSchemaVersion)) {
      errors.push(validationIssue('missing_artifact_schema_version', 'Registered artifact schema version must be explicit.', `${path}.artifactSchemaVersion`));
      schemaViolations.push(`${path}.artifactSchemaVersion`);
    }
  }

  return deepFreeze({
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes: summarizeIssues(errors, warnings),
    schemaViolations: unique(schemaViolations).sort()
  });
}

function validateRegistryConsistency(registry = {}) {
  const normalized = normalizeForValidation(registry);
  const errors = [];
  const warnings = [];
  const consistencyViolations = [];
  const registrations = listArtifacts(normalized);
  const expectedSummary = summarizeRegistry(normalized);

  if (normalized.summary.artifactCount !== registrations.length) {
    errors.push(validationIssue('artifact_count_mismatch', 'Registry summary artifactCount does not match registrations.', 'summary.artifactCount'));
    consistencyViolations.push('summary.artifactCount');
  }
  if (expectedSummary.activeCount !== normalized.summary.activeCount) {
    errors.push(validationIssue('active_count_mismatch', 'Registry summary activeCount is not deterministic.', 'summary.activeCount'));
    consistencyViolations.push('summary.activeCount');
  }
  for (const registration of registrations) {
    if (normalized.indexes.byId[registration.artifactId] !== registration.registrationId) {
      errors.push(validationIssue('id_index_mismatch', 'ID index does not point to the expected registration.', `indexes.byId.${registration.artifactId}`));
      consistencyViolations.push(registration.artifactId);
    }
    if (normalized.indexes.byFingerprint[registration.artifactFingerprint] !== registration.registrationId) {
      errors.push(validationIssue('fingerprint_index_mismatch', 'Fingerprint index does not point to the expected registration.', `indexes.byFingerprint.${registration.artifactFingerprint}`));
      consistencyViolations.push(registration.artifactFingerprint);
    }
  }

  return deepFreeze({
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes: summarizeIssues(errors, warnings),
    consistencyViolations: unique(consistencyViolations).sort()
  });
}

function validateDuplicateRejection(registry = {}) {
  const normalized = normalizeForValidation(registry);
  const errors = [];
  const warnings = [];
  const duplicateViolations = [];
  const firstRegistration = listArtifacts(normalized)[0];

  if (!firstRegistration) {
    warnings.push(validationIssue('duplicate_rejection_not_exercised', 'Registry has no registrations to replay for duplicate rejection.', 'registrations'));
    return deepFreeze({
      valid: true,
      errors,
      warnings,
      reasonCodes: summarizeIssues(errors, warnings),
      duplicateViolations
    });
  }

  const exact = registerArtifact(normalized, firstRegistration.artifact || {}, {
    artifactId: firstRegistration.artifactId,
    artifactType: firstRegistration.artifactType,
    artifactSchemaVersion: firstRegistration.artifactSchemaVersion,
    artifactFingerprint: firstRegistration.artifactFingerprint,
    createdAt: firstRegistration.createdAt,
    registeredAt: firstRegistration.registeredAt
  });
  if (exact.registered !== false || !asArray(exact.validation.reasonCodes).includes('duplicate_existing_registration')) {
    errors.push(validationIssue('duplicate_existing_registration_not_rejected', 'Exact duplicate registration was not rejected.', 'registrations'));
    duplicateViolations.push(firstRegistration.artifactId);
  }

  const idConflict = registerArtifact(normalized, firstRegistration.artifact || {}, {
    artifactId: firstRegistration.artifactId,
    artifactType: firstRegistration.artifactType,
    artifactSchemaVersion: firstRegistration.artifactSchemaVersion,
    artifactFingerprint: `${firstRegistration.artifactFingerprint}:conflict`,
    createdAt: firstRegistration.createdAt,
    registeredAt: firstRegistration.registeredAt
  });
  if (idConflict.registered !== false || !asArray(idConflict.validation.reasonCodes).includes('duplicate_artifact_id')) {
    errors.push(validationIssue('duplicate_artifact_id_not_rejected', 'Duplicate artifact ID conflict was not rejected.', 'artifactId'));
    duplicateViolations.push(firstRegistration.artifactId);
  }

  const fingerprintConflict = registerArtifact(normalized, firstRegistration.artifact || {}, {
    artifactId: `${firstRegistration.artifactId}:conflict`,
    artifactType: firstRegistration.artifactType,
    artifactSchemaVersion: firstRegistration.artifactSchemaVersion,
    artifactFingerprint: firstRegistration.artifactFingerprint,
    createdAt: firstRegistration.createdAt,
    registeredAt: firstRegistration.registeredAt
  });
  if (fingerprintConflict.registered !== false || !asArray(fingerprintConflict.validation.reasonCodes).includes('duplicate_artifact_fingerprint')) {
    errors.push(validationIssue('duplicate_artifact_fingerprint_not_rejected', 'Duplicate artifact fingerprint conflict was not rejected.', 'artifactFingerprint'));
    duplicateViolations.push(firstRegistration.artifactFingerprint);
  }

  return deepFreeze({
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes: summarizeIssues(errors, warnings),
    duplicateViolations: unique(duplicateViolations).sort()
  });
}

function validateAuthorityBoundary(registry = {}) {
  const normalized = normalizeForValidation(registry);
  const errors = [];
  const warnings = [];
  const authorityViolations = [];

  for (const field of ['productionImpact', 'decisionImpact', 'executionAuthority']) {
    if (normalized[field] !== 'none') {
      errors.push(validationIssue('authority_boundary_violation', `${field} must remain none.`, field));
      authorityViolations.push(field);
    }
  }
  for (const [index, registration] of listArtifacts(normalized).entries()) {
    for (const field of ['productionImpact', 'decisionImpact', 'executionAuthority']) {
      if (registration[field] !== 'none') {
        const path = `registrations.${index}.${field}`;
        errors.push(validationIssue('authority_boundary_violation', `${path} must remain none.`, path));
        authorityViolations.push(path);
      }
    }
  }

  return deepFreeze({
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes: summarizeIssues(errors, warnings),
    authorityViolations: unique(authorityViolations).sort()
  });
}

function validateOfflineBoundary(options = {}) {
  const errors = [];
  const warnings = [];
  const loadedModules = asArray(options.loadedModules);
  const prohibited = ['server.js', 'stateStore', 'scoutScannerService'];
  const violations = loadedModules.filter((moduleName) => prohibited.some((name) => String(moduleName).includes(name)));
  for (const moduleName of violations) {
    errors.push(validationIssue('runtime_import_detected', 'Conformance validation must remain offline-only.', moduleName));
  }
  return deepFreeze({
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes: summarizeIssues(errors, warnings),
    offlineViolations: unique(violations).sort()
  });
}

function validateRegistryConformance(registry = createGovernanceArtifactRegistry(), options = {}) {
  const inputBefore = clone(registry);
  const normalized = normalizeForValidation(registry);
  const stageValidations = {
    artifact_integrity: validateArtifactIntegrity(normalized),
    fingerprint_consistency: validateFingerprintConsistency(normalized),
    supersession_chain: validateSupersessionChain(normalized),
    schema_compatibility: validateSchemaCompatibility(normalized, options),
    registry_consistency: validateRegistryConsistency(normalized),
    duplicate_rejection: validateDuplicateRejection(normalized),
    offline_boundary: validateOfflineBoundary(options),
    authority_boundary: validateAuthorityBoundary(normalized)
  };

  const stageResults = CONFORMANCE_STAGES.map((stageName) => buildStageResult(stageName, stageValidations[stageName]));
  const errors = stageResults.flatMap((stage) => stage.errors.map((error) => ({ ...error, stageName: stage.stageName })));
  const warnings = stageResults.flatMap((stage) => stage.warnings.map((warning) => ({ ...warning, stageName: stage.stageName })));
  const inputAfter = clone(registry);
  const immutabilityPreserved = JSON.stringify(inputBefore) === JSON.stringify(inputAfter);

  if (!immutabilityPreserved) {
    errors.push(validationIssue('registry_input_mutated', 'Conformance validation mutated the input registry.', 'registry'));
  }

  const core = {
    schemaVersion: GOVERNANCE_ARTIFACT_REGISTRY_CONFORMANCE_SCHEMA_VERSION,
    source: GOVERNANCE_ARTIFACT_REGISTRY_CONFORMANCE_SOURCE,
    conformanceId: normalizeString(firstDefined(options.conformanceId, `governance-artifact-registry-conformance:${normalized.registryId}`)),
    registryId: normalized.registryId,
    registryFingerprint: normalized.registryFingerprint,
    valid: errors.length === 0,
    stageResults,
    summary: summarizeConformanceResults({ stageResults, errors, warnings }),
    errors,
    warnings,
    reasonCodes: summarizeIssues(errors, warnings),
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };

  return deepFreeze({
    ...core,
    conformanceFingerprint: buildFingerprintFromProjection(core)
  });
}

function summarizeConformanceResults(result = {}) {
  const stageResults = asArray(result.stageResults);
  const summary = {
    stageCount: stageResults.length,
    passedStageCount: stageResults.filter((stage) => stage.valid).length,
    failedStageCount: stageResults.filter((stage) => !stage.valid).length,
    warningCount: asArray(result.warnings).length + stageResults.reduce((count, stage) => count + asArray(stage.warnings).length, 0),
    errorCount: asArray(result.errors).length + stageResults.reduce((count, stage) => count + asArray(stage.errors).length, 0),
    stageStatusSummary: {},
    reasonCodes: summarizeIssues(result.errors, result.warnings),
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
  GOVERNANCE_ARTIFACT_REGISTRY_CONFORMANCE_SCHEMA_VERSION,
  GOVERNANCE_ARTIFACT_REGISTRY_CONFORMANCE_SOURCE,
  summarizeConformanceResults,
  validateArtifactIntegrity,
  validateFingerprintConsistency,
  validateRegistryConformance,
  validateSchemaCompatibility,
  validateSupersessionChain
};
