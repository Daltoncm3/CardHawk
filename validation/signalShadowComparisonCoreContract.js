'use strict';

const { asArray, asObject, unique } = require('./canonicalValidationCore');
const { buildFingerprintFromProjection } = require('./fingerprintProjection');
const { clone, firstDefined } = require('./phase8GovernanceCore');
const { UNKNOWN_VALUE } = require('./canonicalIntelligenceSignalContract');
const {
  PARITY_STATUSES: MIGRATION_PARITY_STATUSES
} = require('./signalMigrationCoreContract');

const SIGNAL_SHADOW_COMPARISON_CORE_SCHEMA_VERSION = '1.0.0';
const SIGNAL_SHADOW_COMPARISON_CORE_SOURCE = 'signal_shadow_comparison_core_contract';

const SHADOW_COMPARISON_STATUSES = Object.freeze([
  'initialized',
  'exact_match',
  'semantic_match',
  'mismatch',
  'blocked',
  'invalid'
]);

const SHADOW_PARITY_STATUSES = Object.freeze(unique([
  ...MIGRATION_PARITY_STATUSES,
  'preserved',
  'changed',
  'exact_match',
  'semantic_match',
  'mismatch',
  'incomplete',
  'invalid',
  'blocked',
  UNKNOWN_VALUE
]).sort());

const AUTHORITY_STATUSES = Object.freeze([
  'preserved',
  'violated',
  'blocked',
  UNKNOWN_VALUE
]);

const FINGERPRINT_STATUSES = Object.freeze([
  'valid',
  'mismatch',
  'missing',
  UNKNOWN_VALUE
]);

const REQUIRED_SIGNAL_SHADOW_COMPARISON_FIELDS = Object.freeze([
  'schemaVersion',
  'source',
  'comparisonId',
  'createdAt',
  'engineName',
  'engineVersion',
  'signalName',
  'signalVersion',
  'nativeOutputFingerprint',
  'migrationFingerprint',
  'canonicalSignalFingerprint',
  'alignmentFingerprint',
  'runFingerprint',
  'reportFingerprint',
  'exactParityStatus',
  'semanticParityStatus',
  'evidenceParityStatus',
  'confidenceParityStatus',
  'statusParityStatus',
  'metadataParityStatus',
  'authorityStatus',
  'fingerprintStatus',
  'comparisonStatus',
  'mismatchCount',
  'mismatchReasonCodes',
  'warnings',
  'errors',
  'productionImpact',
  'decisionImpact',
  'executionAuthority',
  'comparisonFingerprint'
]);

const PARITY_FIELDS = Object.freeze([
  'exactParityStatus',
  'semanticParityStatus',
  'evidenceParityStatus',
  'confidenceParityStatus',
  'statusParityStatus',
  'metadataParityStatus'
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

function normalizeMismatch(mismatch = {}) {
  if (typeof mismatch === 'string') {
    return {
      code: normalizeString(mismatch),
      field: UNKNOWN_VALUE,
      message: normalizeString(mismatch),
      nativeValue: UNKNOWN_VALUE,
      shadowValue: UNKNOWN_VALUE
    };
  }
  const input = asObject(mismatch);
  return {
    code: normalizeString(input.code),
    field: normalizeString(input.field),
    message: normalizeString(input.message),
    nativeValue: clone(firstDefined(input.nativeValue, UNKNOWN_VALUE)),
    shadowValue: clone(firstDefined(input.shadowValue, UNKNOWN_VALUE))
  };
}

function validationIssue(code, message, field = '') {
  return { code, message, field };
}

function authorityViolationsFor(artifact = {}) {
  const violations = [];
  for (const field of ['productionImpact', 'decisionImpact', 'executionAuthority']) {
    if (artifact[field] !== undefined && artifact[field] !== 'none') violations.push(field);
  }
  return unique(violations).sort();
}

function normalizeMismatchReasonCodes(input = {}) {
  const explicit = normalizeStringArray(input.mismatchReasonCodes);
  const derived = asArray(input.mismatches).map((mismatch) => normalizeString(typeof mismatch === 'string' ? mismatch : mismatch.code, '')).filter(Boolean);
  return unique([...explicit, ...derived]).sort();
}

function parityStatusesFor(input = {}) {
  return PARITY_FIELDS.map((field) => normalizeEnum(input[field], SHADOW_PARITY_STATUSES, UNKNOWN_VALUE));
}

function determineShadowComparisonStatus(input = {}) {
  const artifact = asObject(input);
  const explicit = normalizeEnum(artifact.comparisonStatus, SHADOW_COMPARISON_STATUSES, '');
  const parityStatuses = parityStatusesFor(artifact);
  const mismatchCount = Number(firstDefined(artifact.mismatchCount, asArray(artifact.mismatches).length, 0));
  const mismatchReasonCodes = normalizeMismatchReasonCodes(artifact);

  if (known(explicit) && !SHADOW_COMPARISON_STATUSES.includes(explicit)) return 'invalid';
  if (authorityViolationsFor(artifact).length > 0) return 'blocked';
  if (['violated', 'blocked'].includes(normalizeEnum(artifact.authorityStatus, AUTHORITY_STATUSES, UNKNOWN_VALUE))) return 'blocked';
  if (normalizeEnum(artifact.fingerprintStatus, FINGERPRINT_STATUSES, UNKNOWN_VALUE) === 'mismatch') return 'invalid';
  if (asArray(artifact.errors).length > 0) return 'invalid';
  if (parityStatuses.includes('invalid') || parityStatuses.includes('changed')) return 'invalid';
  if (parityStatuses.includes('blocked')) return 'blocked';
  if (mismatchCount > 0 || mismatchReasonCodes.length > 0 || parityStatuses.includes('mismatch')) return 'mismatch';
  if (parityStatuses.some((status) => ['incomplete', UNKNOWN_VALUE].includes(status))) return 'initialized';
  if (parityStatuses.includes('semantic_match')) return 'semantic_match';
  if (parityStatuses.every((status) => status === 'exact_match' || status === 'preserved')) return 'exact_match';
  return 'initialized';
}

function buildSignalShadowComparisonFingerprint(comparison = {}) {
  const projection = clone(comparison);
  delete projection.comparisonFingerprint;
  delete projection.signalShadowComparisonFingerprint;
  return buildFingerprintFromProjection(projection);
}

function createSignalShadowComparisonArtifact(input = {}, options = {}) {
  const mismatches = asArray(input.mismatches).map(normalizeMismatch)
    .sort((left, right) => `${left.code}|${left.field}`.localeCompare(`${right.code}|${right.field}`));
  const core = {
    schemaVersion: SIGNAL_SHADOW_COMPARISON_CORE_SCHEMA_VERSION,
    source: SIGNAL_SHADOW_COMPARISON_CORE_SOURCE,
    comparisonId: normalizeString(firstDefined(input.comparisonId, input.id, options.comparisonId, 'signal-shadow-comparison')),
    createdAt: normalizeDate(firstDefined(input.createdAt, options.createdAt, UNKNOWN_VALUE)),
    engineName: normalizeString(firstDefined(input.engineName, input.producer, input.signalProducer)),
    engineVersion: normalizeString(firstDefined(input.engineVersion, input.producerVersion, UNKNOWN_VALUE)),
    signalName: normalizeString(firstDefined(input.signalName, options.signalName)),
    signalVersion: normalizeString(firstDefined(input.signalVersion, options.signalVersion, UNKNOWN_VALUE)),
    nativeOutputFingerprint: normalizeString(firstDefined(input.nativeOutputFingerprint, input.sourceOutputFingerprint)),
    migrationFingerprint: normalizeString(input.migrationFingerprint),
    canonicalSignalFingerprint: normalizeString(firstDefined(input.canonicalSignalFingerprint, input.signalFingerprint)),
    alignmentFingerprint: normalizeString(input.alignmentFingerprint),
    runFingerprint: normalizeString(firstDefined(input.runFingerprint, input.alignmentRunFingerprint)),
    reportFingerprint: normalizeString(firstDefined(input.reportFingerprint, input.alignmentReportFingerprint)),
    exactParityStatus: normalizeEnum(input.exactParityStatus, SHADOW_PARITY_STATUSES, UNKNOWN_VALUE),
    semanticParityStatus: normalizeEnum(input.semanticParityStatus, SHADOW_PARITY_STATUSES, UNKNOWN_VALUE),
    evidenceParityStatus: normalizeEnum(input.evidenceParityStatus, SHADOW_PARITY_STATUSES, UNKNOWN_VALUE),
    confidenceParityStatus: normalizeEnum(input.confidenceParityStatus, SHADOW_PARITY_STATUSES, UNKNOWN_VALUE),
    statusParityStatus: normalizeEnum(input.statusParityStatus, SHADOW_PARITY_STATUSES, UNKNOWN_VALUE),
    metadataParityStatus: normalizeEnum(input.metadataParityStatus, SHADOW_PARITY_STATUSES, UNKNOWN_VALUE),
    authorityStatus: normalizeEnum(input.authorityStatus, AUTHORITY_STATUSES, 'preserved'),
    fingerprintStatus: normalizeEnum(input.fingerprintStatus, FINGERPRINT_STATUSES, 'valid'),
    comparisonStatus: normalizeEnum(firstDefined(input.comparisonStatus, input.parityStatus, input.status), SHADOW_COMPARISON_STATUSES, 'initialized'),
    mismatchCount: Number(firstDefined(input.mismatchCount, mismatches.length, 0)),
    mismatchReasonCodes: normalizeMismatchReasonCodes({ ...input, mismatches }),
    mismatches,
    warnings: asArray(input.warnings).map(normalizeIssue).sort((left, right) => `${left.code}|${left.field}`.localeCompare(`${right.code}|${right.field}`)),
    errors: asArray(input.errors).map(normalizeIssue).sort((left, right) => `${left.code}|${left.field}`.localeCompare(`${right.code}|${right.field}`)),
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none',
    metadata: clone(asObject(input.metadata))
  };
  const withStatus = {
    ...core,
    comparisonStatus: determineShadowComparisonStatus(core)
  };
  return deepFreeze({
    ...withStatus,
    comparisonFingerprint: buildSignalShadowComparisonFingerprint(withStatus)
  });
}

function cloneSignalShadowComparisonArtifact(artifact = {}) {
  return clone(artifact);
}

function missingRequiredFields(record = {}, fields = []) {
  const input = asObject(record);
  return fields.filter((field) => {
    const value = input[field];
    return value === undefined || value === null || value === '';
  });
}

function validateSignalShadowComparisonArtifact(artifact = {}) {
  const input = asObject(artifact);
  const errors = [];
  const warnings = [];
  const missingRequiredFieldsList = missingRequiredFields(input, REQUIRED_SIGNAL_SHADOW_COMPARISON_FIELDS);
  const authorityViolations = [];
  const fingerprintViolations = [];
  const parityViolations = [];
  const statusViolations = [];
  const mismatchViolations = [];

  for (const field of missingRequiredFieldsList) {
    errors.push(validationIssue('missing_required_field', `${field} is required.`, field));
  }
  if (input.schemaVersion !== SIGNAL_SHADOW_COMPARISON_CORE_SCHEMA_VERSION) errors.push(validationIssue('invalid_schema_version', 'schemaVersion must match Signal Shadow Comparison Core Contract schema.', 'schemaVersion'));
  if (input.source !== SIGNAL_SHADOW_COMPARISON_CORE_SOURCE) errors.push(validationIssue('invalid_source', 'source must be signal_shadow_comparison_core_contract.', 'source'));

  for (const field of PARITY_FIELDS) {
    if (!SHADOW_PARITY_STATUSES.includes(input[field])) {
      errors.push(validationIssue('invalid_parity_status', `${field} must be one of: ${SHADOW_PARITY_STATUSES.join(', ')}`, field));
      parityViolations.push(field);
    }
  }
  if (!AUTHORITY_STATUSES.includes(input.authorityStatus)) {
    errors.push(validationIssue('invalid_authority_status', `authorityStatus must be one of: ${AUTHORITY_STATUSES.join(', ')}`, 'authorityStatus'));
    statusViolations.push('authorityStatus');
  }
  if (!FINGERPRINT_STATUSES.includes(input.fingerprintStatus)) {
    errors.push(validationIssue('invalid_fingerprint_status', `fingerprintStatus must be one of: ${FINGERPRINT_STATUSES.join(', ')}`, 'fingerprintStatus'));
    statusViolations.push('fingerprintStatus');
  }
  if (!SHADOW_COMPARISON_STATUSES.includes(input.comparisonStatus)) {
    errors.push(validationIssue('invalid_comparison_status', `comparisonStatus must be one of: ${SHADOW_COMPARISON_STATUSES.join(', ')}`, 'comparisonStatus'));
    statusViolations.push('comparisonStatus');
  }

  authorityViolations.push(...authorityViolationsFor(input));
  for (const field of authorityViolations) {
    errors.push(validationIssue('authority_boundary_violation', `${field} must remain none.`, field));
  }

  const expectedStatus = determineShadowComparisonStatus(input);
  if (SHADOW_COMPARISON_STATUSES.includes(input.comparisonStatus) && input.comparisonStatus !== expectedStatus) {
    warnings.push(validationIssue('comparison_status_drift', `comparisonStatus should resolve to ${expectedStatus}.`, 'comparisonStatus'));
    statusViolations.push('comparisonStatus');
  }

  const mismatchReasonCodes = normalizeStringArray(input.mismatchReasonCodes);
  const mismatches = asArray(input.mismatches);
  if (Number(input.mismatchCount) !== mismatches.length) {
    errors.push(validationIssue('mismatch_count_mismatch', 'mismatchCount must match mismatches length.', 'mismatchCount'));
    mismatchViolations.push('mismatchCount');
  }
  if (mismatches.length > 0 && mismatchReasonCodes.length === 0) {
    errors.push(validationIssue('missing_mismatch_reason_codes', 'Mismatch artifacts must include mismatchReasonCodes.', 'mismatchReasonCodes'));
    mismatchViolations.push('mismatchReasonCodes');
  }
  if (mismatchReasonCodes.length > 0 && Number(input.mismatchCount) === 0) {
    warnings.push(validationIssue('mismatch_reason_codes_without_count', 'mismatchReasonCodes are present while mismatchCount is zero.', 'mismatchReasonCodes'));
    mismatchViolations.push('mismatchReasonCodes');
  }

  if (input.fingerprintStatus === 'mismatch') {
    fingerprintViolations.push('fingerprintStatus');
  }
  if (input.comparisonFingerprint && buildSignalShadowComparisonFingerprint(input) !== input.comparisonFingerprint) {
    errors.push(validationIssue('comparison_fingerprint_mismatch', 'comparisonFingerprint does not match comparison contents.', 'comparisonFingerprint'));
    fingerprintViolations.push('comparisonFingerprint');
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
    missingRequiredFields: unique(missingRequiredFieldsList).sort(),
    authorityViolations: unique(authorityViolations).sort(),
    fingerprintViolations: unique(fingerprintViolations).sort(),
    parityViolations: unique(parityViolations).sort(),
    statusViolations: unique(statusViolations).sort(),
    mismatchViolations: unique(mismatchViolations).sort()
  };
}

module.exports = {
  AUTHORITY_STATUSES,
  FINGERPRINT_STATUSES,
  PARITY_FIELDS,
  REQUIRED_SIGNAL_SHADOW_COMPARISON_FIELDS,
  SHADOW_COMPARISON_STATUSES,
  SHADOW_PARITY_STATUSES,
  SIGNAL_SHADOW_COMPARISON_CORE_SCHEMA_VERSION,
  SIGNAL_SHADOW_COMPARISON_CORE_SOURCE,
  buildSignalShadowComparisonFingerprint,
  cloneSignalShadowComparisonArtifact,
  createSignalShadowComparisonArtifact,
  determineShadowComparisonStatus,
  validateSignalShadowComparisonArtifact
};
