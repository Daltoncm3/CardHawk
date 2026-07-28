'use strict';

const { asArray, asObject, unique } = require('./canonicalValidationCore');
const { buildFingerprintFromProjection } = require('./fingerprintProjection');
const { clone, firstDefined } = require('./phase8GovernanceCore');
const { UNKNOWN_VALUE } = require('./canonicalIntelligenceSignalContract');
const { ALIGNMENT_STATUSES } = require('./signalAlignmentContract');
const { DEPRECATION_STATUSES } = require('./intelligenceSignalRegistry');

const SIGNAL_MIGRATION_CORE_SCHEMA_VERSION = '1.0.0';
const SIGNAL_MIGRATION_CORE_SOURCE = 'signal_migration_core_contract';

const MIGRATION_LIFECYCLE_STATUSES = Object.freeze([
  'initialized',
  'adapted',
  'aligned',
  'batched',
  'reported',
  'validated',
  'blocked',
  'invalid'
]);

const PARITY_STATUSES = Object.freeze([
  'preserved',
  'changed',
  'exact_match',
  'semantic_match',
  'mismatch',
  'incomplete',
  'invalid',
  'blocked',
  UNKNOWN_VALUE
]);

const REGISTRY_STATUSES = Object.freeze([
  'matched',
  'definition_missing',
  'version_mismatch',
  'registry_missing',
  'blocked',
  UNKNOWN_VALUE
]);

const REQUIRED_SIGNAL_MIGRATION_ARTIFACT_FIELDS = Object.freeze([
  'schemaVersion',
  'source',
  'migrationId',
  'createdAt',
  'engineName',
  'engineVersion',
  'nativeOutputFingerprint',
  'canonicalSignalFingerprint',
  'alignmentFingerprint',
  'batchFingerprint',
  'runFingerprint',
  'reportFingerprint',
  'parityStatus',
  'registryStatus',
  'lifecycleStatus',
  'warnings',
  'errors',
  'productionImpact',
  'decisionImpact',
  'executionAuthority',
  'migrationFingerprint'
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

function normalizeIssue(issue = {}) {
  if (typeof issue === 'string') {
    return {
      code: normalizeString(issue),
      message: normalizeString(issue),
      field: UNKNOWN_VALUE
    };
  }
  const input = asObject(issue);
  return {
    code: normalizeString(input.code),
    message: normalizeString(input.message),
    field: normalizeString(input.field)
  };
}

function validationIssue(code, message, field = '') {
  return { code, message, field };
}

function hasKnownFingerprint(value) {
  return known(value) && value !== UNKNOWN_VALUE;
}

function authorityViolationsFor(artifact = {}) {
  const violations = [];
  for (const field of ['productionImpact', 'decisionImpact', 'executionAuthority']) {
    if (artifact[field] !== undefined && artifact[field] !== 'none') violations.push(field);
  }
  return unique(violations).sort();
}

function determineMigrationLifecycleStatus(input = {}) {
  const artifact = asObject(input);
  const explicit = normalizeEnum(artifact.lifecycleStatus, MIGRATION_LIFECYCLE_STATUSES, '');
  const registryStatus = normalizeEnum(artifact.registryStatus, REGISTRY_STATUSES, UNKNOWN_VALUE);
  const parityStatus = normalizeEnum(artifact.parityStatus, PARITY_STATUSES, UNKNOWN_VALUE);

  if (!MIGRATION_LIFECYCLE_STATUSES.includes(explicit) && known(explicit)) return 'invalid';
  if (authorityViolationsFor(artifact).length > 0) return 'blocked';
  if (asArray(artifact.errors).length > 0) return 'invalid';
  if (['changed', 'mismatch', 'invalid'].includes(parityStatus)) return 'invalid';
  if (parityStatus === 'blocked' || registryStatus === 'blocked') return 'blocked';
  if (['definition_missing', 'version_mismatch', 'registry_missing'].includes(registryStatus)) return 'blocked';
  if (
    hasKnownFingerprint(artifact.reportFingerprint) &&
    registryStatus === 'matched' &&
    ['preserved', 'exact_match', 'semantic_match'].includes(parityStatus)
  ) {
    return 'validated';
  }
  if (hasKnownFingerprint(artifact.reportFingerprint)) return 'reported';
  if (hasKnownFingerprint(artifact.batchFingerprint) || hasKnownFingerprint(artifact.runFingerprint)) return 'batched';
  if (hasKnownFingerprint(artifact.alignmentFingerprint)) return 'aligned';
  if (hasKnownFingerprint(artifact.canonicalSignalFingerprint)) return 'adapted';
  return 'initialized';
}

function buildSignalMigrationFingerprint(artifact = {}) {
  const projection = clone(artifact);
  delete projection.migrationFingerprint;
  delete projection.signalMigrationFingerprint;
  return buildFingerprintFromProjection(projection);
}

function createSignalMigrationArtifact(input = {}, options = {}) {
  const core = {
    schemaVersion: SIGNAL_MIGRATION_CORE_SCHEMA_VERSION,
    source: SIGNAL_MIGRATION_CORE_SOURCE,
    migrationId: normalizeString(firstDefined(input.migrationId, input.id, options.migrationId, 'signal-migration-artifact')),
    createdAt: normalizeDate(firstDefined(input.createdAt, options.createdAt, UNKNOWN_VALUE)),
    engineName: normalizeString(firstDefined(input.engineName, input.producer, input.signalProducer)),
    engineVersion: normalizeString(firstDefined(input.engineVersion, input.producerVersion, UNKNOWN_VALUE)),
    nativeOutputFingerprint: normalizeString(firstDefined(input.nativeOutputFingerprint, input.sourceOutputFingerprint)),
    canonicalSignalFingerprint: normalizeString(firstDefined(input.canonicalSignalFingerprint, input.signalFingerprint)),
    alignmentFingerprint: normalizeString(input.alignmentFingerprint),
    batchFingerprint: normalizeString(firstDefined(input.batchFingerprint, input.alignmentBatchFingerprint)),
    runFingerprint: normalizeString(firstDefined(input.runFingerprint, input.alignmentRunFingerprint)),
    reportFingerprint: normalizeString(firstDefined(input.reportFingerprint, input.alignmentReportFingerprint)),
    parityStatus: normalizeEnum(input.parityStatus, PARITY_STATUSES, UNKNOWN_VALUE),
    registryStatus: normalizeEnum(firstDefined(input.registryStatus, input.registryResolutionStatus), REGISTRY_STATUSES, UNKNOWN_VALUE),
    lifecycleStatus: normalizeEnum(firstDefined(input.lifecycleStatus, input.status), MIGRATION_LIFECYCLE_STATUSES, 'initialized'),
    warnings: asArray(input.warnings).map(normalizeIssue).sort((left, right) => `${left.code}|${left.field}`.localeCompare(`${right.code}|${right.field}`)),
    errors: asArray(input.errors).map(normalizeIssue).sort((left, right) => `${left.code}|${left.field}`.localeCompare(`${right.code}|${right.field}`)),
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none',
    metadata: clone(asObject(input.metadata))
  };
  const withLifecycle = {
    ...core,
    lifecycleStatus: determineMigrationLifecycleStatus(core)
  };
  return deepFreeze({
    ...withLifecycle,
    migrationFingerprint: buildSignalMigrationFingerprint(withLifecycle)
  });
}

function cloneSignalMigrationArtifact(artifact = {}) {
  return clone(artifact);
}

function validateSignalMigrationArtifact(artifact = {}) {
  const errors = [];
  const warnings = [];
  const authorityViolations = [];
  const fingerprintViolations = [];
  const lifecycleViolations = [];
  const input = asObject(artifact);
  const missing = REQUIRED_SIGNAL_MIGRATION_ARTIFACT_FIELDS.filter((field) => {
    const value = input[field];
    return value === undefined || value === null || value === '';
  });

  for (const field of missing) errors.push(validationIssue('missing_required_field', `${field} is required.`, field));
  if (input.schemaVersion !== SIGNAL_MIGRATION_CORE_SCHEMA_VERSION) errors.push(validationIssue('invalid_schema_version', 'schemaVersion must match Signal Migration Core Contract schema.', 'schemaVersion'));
  if (input.source !== SIGNAL_MIGRATION_CORE_SOURCE) errors.push(validationIssue('invalid_source', 'source must be signal_migration_core_contract.', 'source'));

  if (!MIGRATION_LIFECYCLE_STATUSES.includes(input.lifecycleStatus)) {
    errors.push(validationIssue('invalid_lifecycle_status', `lifecycleStatus must be one of: ${MIGRATION_LIFECYCLE_STATUSES.join(', ')}`, 'lifecycleStatus'));
    lifecycleViolations.push('lifecycleStatus');
  }
  if (!PARITY_STATUSES.includes(input.parityStatus)) errors.push(validationIssue('invalid_parity_status', `parityStatus must be one of: ${PARITY_STATUSES.join(', ')}`, 'parityStatus'));
  if (!REGISTRY_STATUSES.includes(input.registryStatus)) errors.push(validationIssue('invalid_registry_status', `registryStatus must be one of: ${REGISTRY_STATUSES.join(', ')}`, 'registryStatus'));
  if (!Array.isArray(input.warnings)) errors.push(validationIssue('invalid_warnings', 'warnings must be an array.', 'warnings'));
  if (!Array.isArray(input.errors)) errors.push(validationIssue('invalid_errors', 'errors must be an array.', 'errors'));

  authorityViolations.push(...authorityViolationsFor(input));
  for (const field of authorityViolations) {
    errors.push(validationIssue('authority_boundary_violation', `${field} must remain none.`, field));
  }

  const expectedLifecycle = determineMigrationLifecycleStatus(input);
  if (MIGRATION_LIFECYCLE_STATUSES.includes(input.lifecycleStatus) && input.lifecycleStatus !== expectedLifecycle) {
    warnings.push(validationIssue('lifecycle_status_drift', `lifecycleStatus should resolve to ${expectedLifecycle}.`, 'lifecycleStatus'));
    lifecycleViolations.push('lifecycleStatus');
  }

  if (input.alignmentStatus && !ALIGNMENT_STATUSES.includes(input.alignmentStatus)) {
    warnings.push(validationIssue('unknown_alignment_status_reference', 'alignmentStatus is not a known Signal Alignment status.', 'alignmentStatus'));
  }
  if (input.definitionDeprecationStatus && !DEPRECATION_STATUSES.includes(input.definitionDeprecationStatus)) {
    warnings.push(validationIssue('unknown_deprecation_status_reference', 'definitionDeprecationStatus is not a known registry deprecation status.', 'definitionDeprecationStatus'));
  }

  if (input.migrationFingerprint && buildSignalMigrationFingerprint(input) !== input.migrationFingerprint) {
    errors.push(validationIssue('migration_fingerprint_mismatch', 'migrationFingerprint does not match artifact contents.', 'migrationFingerprint'));
    fingerprintViolations.push('migrationFingerprint');
  }

  const reasonCodes = unique([
    ...errors.map((error) => error.code),
    ...warnings.map((warning) => warning.code)
  ]).sort();

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes,
    authorityViolations: unique(authorityViolations).sort(),
    fingerprintViolations: unique(fingerprintViolations).sort(),
    lifecycleViolations: unique(lifecycleViolations).sort()
  };
}

module.exports = {
  MIGRATION_LIFECYCLE_STATUSES,
  PARITY_STATUSES,
  REGISTRY_STATUSES,
  REQUIRED_SIGNAL_MIGRATION_ARTIFACT_FIELDS,
  SIGNAL_MIGRATION_CORE_SCHEMA_VERSION,
  SIGNAL_MIGRATION_CORE_SOURCE,
  buildSignalMigrationFingerprint,
  cloneSignalMigrationArtifact,
  createSignalMigrationArtifact,
  determineMigrationLifecycleStatus,
  validateSignalMigrationArtifact
};
