'use strict';

const { asArray, asObject, unique } = require('./canonicalValidationCore');
const { buildFingerprintFromProjection } = require('./fingerprintProjection');
const { clone, firstDefined } = require('./phase8GovernanceCore');

const GOVERNANCE_ARTIFACT_REGISTRY_SCHEMA_VERSION = '1.0.0';
const GOVERNANCE_ARTIFACT_REGISTRY_SOURCE = 'governance_artifact_registry';
const UNKNOWN_VALUE = 'unknown';

const ARTIFACT_TYPES = Object.freeze([
  'signal_governance_evidence_bundle',
  'signal_governance_review_report',
  'review_package_signal_binding',
  'review_package',
  'workspace_signal_summary',
  'governance_validation_result',
  UNKNOWN_VALUE
]);

const REQUIRED_REGISTRATION_FIELDS = Object.freeze([
  'schemaVersion',
  'source',
  'registrationId',
  'artifactId',
  'artifactType',
  'artifactSchemaVersion',
  'artifactFingerprint',
  'createdAt',
  'registeredAt',
  'productionImpact',
  'decisionImpact',
  'executionAuthority',
  'registrationFingerprint'
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

function normalizeType(value) {
  const normalized = normalizeString(value).toLowerCase();
  return ARTIFACT_TYPES.includes(normalized) ? normalized : normalized;
}

function validationIssue(code, message, field = '') {
  return { code, message, field };
}

function artifactId(artifact = {}, options = {}) {
  return normalizeString(firstDefined(
    options.artifactId,
    artifact.artifactId,
    artifact.bundleId,
    artifact.reportId,
    artifact.bindingId,
    artifact.packageId,
    artifact.workspaceSignalSummaryId,
    artifact.validationId,
    artifact.id
  ));
}

function artifactType(artifact = {}, options = {}) {
  return normalizeType(firstDefined(
    options.artifactType,
    artifact.artifactType,
    artifact.source,
    UNKNOWN_VALUE
  ));
}

function artifactSchemaVersion(artifact = {}, options = {}) {
  return normalizeString(firstDefined(options.artifactSchemaVersion, artifact.schemaVersion, artifact.version));
}

function artifactCreatedAt(artifact = {}, options = {}) {
  return normalizeDate(firstDefined(options.createdAt, artifact.createdAt, artifact.capturedAt));
}

function artifactFingerprint(artifact = {}, options = {}) {
  const explicit = firstDefined(
    options.artifactFingerprint,
    artifact.artifactFingerprint,
    artifact.bundleFingerprint,
    artifact.reportFingerprint,
    artifact.bindingFingerprint,
    artifact.packageFingerprint,
    artifact.summaryFingerprint,
    artifact.validationFingerprint,
    artifact.fingerprint
  );
  return known(explicit) ? normalizeString(explicit) : buildFingerprintFromProjection(artifact);
}

function buildRegistrationFingerprint(registration = {}) {
  const projection = clone(registration);
  delete projection.registrationFingerprint;
  return buildFingerprintFromProjection(projection);
}

function buildGovernanceArtifactRegistryFingerprint(registry = {}) {
  const projection = clone(registry);
  delete projection.registryFingerprint;
  return buildFingerprintFromProjection(projection);
}

function sortRegistrations(registrations = []) {
  return asArray(registrations)
    .map((registration) => clone(registration))
    .sort((left, right) => `${left.artifactId}|${left.artifactFingerprint}`.localeCompare(`${right.artifactId}|${right.artifactFingerprint}`));
}

function indexRegistrations(registrations = []) {
  const byId = {};
  const byFingerprint = {};
  for (const registration of sortRegistrations(registrations)) {
    if (known(registration.artifactId)) byId[registration.artifactId] = registration.registrationId;
    if (known(registration.artifactFingerprint)) byFingerprint[registration.artifactFingerprint] = registration.registrationId;
  }
  return { byId, byFingerprint };
}

function summarizeRegistrations(registrations = []) {
  const items = sortRegistrations(registrations);
  const typeSummary = {};
  let supersededCount = 0;
  for (const item of items) {
    typeSummary[item.artifactType] = (typeSummary[item.artifactType] || 0) + 1;
    if (known(item.supersededByArtifactId) && item.supersededByArtifactId !== UNKNOWN_VALUE) supersededCount += 1;
  }
  return {
    artifactCount: items.length,
    typeSummary,
    supersededCount,
    activeCount: items.length - supersededCount
  };
}

function createGovernanceArtifactRegistry(input = {}) {
  const registrations = sortRegistrations(input.registrations);
  const core = {
    schemaVersion: GOVERNANCE_ARTIFACT_REGISTRY_SCHEMA_VERSION,
    source: GOVERNANCE_ARTIFACT_REGISTRY_SOURCE,
    registryId: normalizeString(firstDefined(input.registryId, 'governance-artifact-registry')),
    registryVersion: normalizeString(firstDefined(input.registryVersion, GOVERNANCE_ARTIFACT_REGISTRY_SCHEMA_VERSION)),
    createdAt: normalizeDate(firstDefined(input.createdAt, UNKNOWN_VALUE)),
    updatedAt: normalizeDate(firstDefined(input.updatedAt, input.createdAt, UNKNOWN_VALUE)),
    registrations,
    indexes: indexRegistrations(registrations),
    summary: summarizeRegistrations(registrations),
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
  return deepFreeze({
    ...core,
    registryFingerprint: buildGovernanceArtifactRegistryFingerprint(core)
  });
}

function createArtifactRegistration(artifact = {}, options = {}) {
  const sourceArtifact = clone(asObject(artifact));
  const id = artifactId(sourceArtifact, options);
  const fingerprint = artifactFingerprint(sourceArtifact, options);
  const type = artifactType(sourceArtifact, options);
  const createdAt = artifactCreatedAt(sourceArtifact, options);
  const core = {
    schemaVersion: GOVERNANCE_ARTIFACT_REGISTRY_SCHEMA_VERSION,
    source: GOVERNANCE_ARTIFACT_REGISTRY_SOURCE,
    registrationId: normalizeString(firstDefined(options.registrationId, `governance-artifact-registration:${id}:${fingerprint}`)),
    artifactId: id,
    artifactType: type,
    artifactSchemaVersion: artifactSchemaVersion(sourceArtifact, options),
    artifactFingerprint: fingerprint,
    createdAt,
    registeredAt: normalizeDate(firstDefined(options.registeredAt, options.asOf, UNKNOWN_VALUE)),
    registeredBy: normalizeString(firstDefined(options.registeredBy, UNKNOWN_VALUE)),
    artifact: options.storeArtifact === false ? null : sourceArtifact,
    supersedesArtifactId: normalizeString(firstDefined(options.supersedesArtifactId, sourceArtifact.supersedesArtifactId, UNKNOWN_VALUE)),
    supersedesArtifactFingerprint: normalizeString(firstDefined(options.supersedesArtifactFingerprint, sourceArtifact.supersedesArtifactFingerprint, UNKNOWN_VALUE)),
    supersededByArtifactId: normalizeString(firstDefined(options.supersededByArtifactId, sourceArtifact.supersededByArtifactId, UNKNOWN_VALUE)),
    supersededByArtifactFingerprint: normalizeString(firstDefined(options.supersededByArtifactFingerprint, sourceArtifact.supersededByArtifactFingerprint, UNKNOWN_VALUE)),
    metadata: clone(asObject(options.metadata)),
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
  return deepFreeze({
    ...core,
    registrationFingerprint: buildRegistrationFingerprint(core)
  });
}

function validateArtifactRegistration(registration = {}, registry = null) {
  const input = asObject(registration);
  const errors = [];
  const warnings = [];
  const invalidFields = [];
  const duplicateRegistrations = [];
  const supersessionViolations = [];
  const fingerprintViolations = [];
  const authorityViolations = [];

  for (const field of REQUIRED_REGISTRATION_FIELDS) {
    if (!known(input[field])) {
      errors.push(validationIssue('missing_required_field', `${field} is required.`, field));
      invalidFields.push(field);
    }
  }

  if (input.schemaVersion !== GOVERNANCE_ARTIFACT_REGISTRY_SCHEMA_VERSION) {
    errors.push(validationIssue('invalid_schema_version', 'schemaVersion must match Governance Artifact Registry schema.', 'schemaVersion'));
    invalidFields.push('schemaVersion');
  }
  if (input.source !== GOVERNANCE_ARTIFACT_REGISTRY_SOURCE) {
    errors.push(validationIssue('invalid_source', 'source must be governance_artifact_registry.', 'source'));
    invalidFields.push('source');
  }
  for (const field of ['productionImpact', 'decisionImpact', 'executionAuthority']) {
    if (input[field] !== 'none') {
      errors.push(validationIssue('authority_boundary_violation', `${field} must remain none.`, field));
      authorityViolations.push(field);
    }
  }
  if (input.artifactType && !ARTIFACT_TYPES.includes(input.artifactType)) {
    warnings.push(validationIssue('unknown_artifact_type', 'artifactType is not one of the canonical registry types.', 'artifactType'));
  }
  if (input.supersedesArtifactId === input.artifactId && input.artifactId !== UNKNOWN_VALUE) {
    errors.push(validationIssue('self_supersession', 'Artifact cannot supersede itself.', 'supersedesArtifactId'));
    supersessionViolations.push('supersedesArtifactId');
  }
  if (input.supersededByArtifactId === input.artifactId && input.artifactId !== UNKNOWN_VALUE) {
    errors.push(validationIssue('self_supersession', 'Artifact cannot be superseded by itself.', 'supersededByArtifactId'));
    supersessionViolations.push('supersededByArtifactId');
  }
  if (input.registrationFingerprint && buildRegistrationFingerprint(input) !== input.registrationFingerprint) {
    errors.push(validationIssue('registration_fingerprint_mismatch', 'registrationFingerprint does not match registration contents.', 'registrationFingerprint'));
    fingerprintViolations.push('registrationFingerprint');
  }
  if (input.artifact && typeof input.artifact === 'object') {
    const expectedArtifactFingerprint = artifactFingerprint(input.artifact);
    if (known(input.artifactFingerprint) && input.artifactFingerprint !== expectedArtifactFingerprint) {
      errors.push(validationIssue('artifact_fingerprint_mismatch', 'artifactFingerprint does not match embedded artifact.', 'artifactFingerprint'));
      fingerprintViolations.push('artifactFingerprint');
    }
  }

  const registryInput = registry ? normalizeRegistry(registry) : null;
  if (registryInput) {
    const existingById = getArtifact(registryInput, input.artifactId);
    const existingByFingerprint = getArtifactByFingerprint(registryInput, input.artifactFingerprint);
    if (existingById && existingById.artifactFingerprint !== input.artifactFingerprint) {
      errors.push(validationIssue('duplicate_artifact_id', 'artifactId is already registered with a different fingerprint.', 'artifactId'));
      duplicateRegistrations.push(input.artifactId);
    }
    if (existingByFingerprint && existingByFingerprint.artifactId !== input.artifactId) {
      errors.push(validationIssue('duplicate_artifact_fingerprint', 'artifactFingerprint is already registered with a different artifactId.', 'artifactFingerprint'));
      duplicateRegistrations.push(input.artifactFingerprint);
    }
    if (existingById && existingById.artifactFingerprint === input.artifactFingerprint) {
      warnings.push(validationIssue('duplicate_existing_registration', 'artifactId and artifactFingerprint are already registered.', 'artifactId'));
      duplicateRegistrations.push(input.artifactId);
    }
  }

  const reasonCodes = unique([...errors.map((error) => error.code), ...warnings.map((warning) => warning.code)]).sort();
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes,
    invalidFields: unique(invalidFields).sort(),
    duplicateRegistrations: unique(duplicateRegistrations).sort(),
    supersessionViolations: unique(supersessionViolations).sort(),
    fingerprintViolations: unique(fingerprintViolations).sort(),
    authorityViolations: unique(authorityViolations).sort()
  };
}

function normalizeRegistry(registry = {}) {
  return createGovernanceArtifactRegistry({
    registryId: registry.registryId,
    registryVersion: registry.registryVersion,
    createdAt: registry.createdAt,
    updatedAt: registry.updatedAt,
    registrations: registry.registrations
  });
}

function registerArtifact(registry = createGovernanceArtifactRegistry(), artifact = {}, options = {}) {
  const normalized = normalizeRegistry(registry);
  const registration = createArtifactRegistration(artifact, options);
  const validation = validateArtifactRegistration(registration, normalized);

  if (!validation.valid || validation.reasonCodes.includes('duplicate_existing_registration')) {
    return {
      registered: false,
      registry: normalized,
      registration,
      validation
    };
  }

  const registrations = sortRegistrations([...normalized.registrations, registration]);
  const nextRegistry = createGovernanceArtifactRegistry({
    registryId: normalized.registryId,
    registryVersion: normalized.registryVersion,
    createdAt: normalized.createdAt,
    updatedAt: normalizeDate(firstDefined(options.updatedAt, options.registeredAt, options.asOf, UNKNOWN_VALUE)),
    registrations
  });

  return {
    registered: true,
    registry: nextRegistry,
    registration,
    validation
  };
}

function getArtifact(registry = {}, artifactIdValue = '') {
  const normalized = normalizeRegistry(registry);
  const registrationId = normalized.indexes.byId[normalizeString(artifactIdValue)];
  const registration = normalized.registrations.find((item) => item.registrationId === registrationId);
  return registration ? clone(registration) : null;
}

function getArtifactByFingerprint(registry = {}, fingerprintValue = '') {
  const normalized = normalizeRegistry(registry);
  const registrationId = normalized.indexes.byFingerprint[normalizeString(fingerprintValue)];
  const registration = normalized.registrations.find((item) => item.registrationId === registrationId);
  return registration ? clone(registration) : null;
}

function listArtifacts(registry = {}, filters = {}) {
  const normalized = normalizeRegistry(registry);
  return sortRegistrations(normalized.registrations).filter((registration) => {
    if (known(filters.artifactType) && registration.artifactType !== normalizeType(filters.artifactType)) return false;
    if (known(filters.schemaVersion) && registration.artifactSchemaVersion !== normalizeString(filters.schemaVersion)) return false;
    if (filters.activeOnly === true && known(registration.supersededByArtifactId) && registration.supersededByArtifactId !== UNKNOWN_VALUE) return false;
    return true;
  });
}

function detectSupersession(registry = {}, artifactOrId = {}) {
  const normalized = normalizeRegistry(registry);
  const id = typeof artifactOrId === 'string' ? normalizeString(artifactOrId) : artifactId(asObject(artifactOrId));
  const target = getArtifact(normalized, id);
  const supersedes = [];
  const supersededBy = [];

  for (const registration of normalized.registrations) {
    if (registration.artifactId === id) continue;
    if (registration.supersedesArtifactId === id || registration.supersedesArtifactFingerprint === (target && target.artifactFingerprint)) {
      supersededBy.push(clone(registration));
    }
    if (target && (target.supersedesArtifactId === registration.artifactId || target.supersedesArtifactFingerprint === registration.artifactFingerprint)) {
      supersedes.push(clone(registration));
    }
  }

  return {
    artifactId: id,
    found: Boolean(target),
    superseded: supersededBy.length > 0 || Boolean(target && known(target.supersededByArtifactId) && target.supersededByArtifactId !== UNKNOWN_VALUE),
    supersedes: sortRegistrations(supersedes),
    supersededBy: sortRegistrations(supersededBy),
    currentRegistration: target
  };
}

function summarizeRegistry(registry = {}) {
  const normalized = normalizeRegistry(registry);
  return deepFreeze({
    schemaVersion: GOVERNANCE_ARTIFACT_REGISTRY_SCHEMA_VERSION,
    source: GOVERNANCE_ARTIFACT_REGISTRY_SOURCE,
    registryId: normalized.registryId,
    registryVersion: normalized.registryVersion,
    artifactCount: normalized.summary.artifactCount,
    activeCount: normalized.summary.activeCount,
    supersededCount: normalized.summary.supersededCount,
    typeSummary: clone(normalized.summary.typeSummary),
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none',
    registryFingerprint: normalized.registryFingerprint
  });
}

module.exports = {
  ARTIFACT_TYPES,
  GOVERNANCE_ARTIFACT_REGISTRY_SCHEMA_VERSION,
  GOVERNANCE_ARTIFACT_REGISTRY_SOURCE,
  REQUIRED_REGISTRATION_FIELDS,
  buildGovernanceArtifactRegistryFingerprint,
  buildRegistrationFingerprint,
  createArtifactRegistration,
  createGovernanceArtifactRegistry,
  detectSupersession,
  getArtifact,
  getArtifactByFingerprint,
  listArtifacts,
  normalizeRegistry,
  registerArtifact,
  summarizeRegistry,
  validateArtifactRegistration
};
