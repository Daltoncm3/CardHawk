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
const {
  UNKNOWN_VALUE,
  validateCanonicalSignal,
  buildCanonicalSignalFingerprint
} = require('./canonicalIntelligenceSignalContract');
const {
  validateSignalDefinition,
  buildSignalDefinitionFingerprint,
  buildSignalRegistryFingerprint
} = require('./intelligenceSignalRegistry');

const SIGNAL_ALIGNMENT_SCHEMA_VERSION = '1.0.0';
const SIGNAL_ALIGNMENT_SOURCE = 'signal_alignment_contract';

const ALIGNMENT_STATUSES = Object.freeze([
  'aligned',
  'aligned_with_warnings',
  'incomplete',
  'definition_missing',
  'version_mismatch',
  'invalid',
  'blocked'
]);

const STATUS_PRECEDENCE = Object.freeze([
  'blocked',
  'invalid',
  'definition_missing',
  'version_mismatch',
  'incomplete',
  'aligned_with_warnings',
  'aligned'
]);

const REQUIRED_SIGNAL_ALIGNMENT_FIELDS = Object.freeze([
  'schemaVersion',
  'source',
  'alignmentId',
  'createdAt',
  'producer',
  'producerVersion',
  'sourceOutputFingerprint',
  'registryId',
  'registryFingerprint',
  'signalDefinition',
  'canonicalSignal',
  'alignmentStatus',
  'authorityAlignment',
  'confidenceAlignment',
  'evidenceAlignment',
  'relationshipSummary',
  'warnings',
  'errors',
  'missingMetadata',
  'productionImpact',
  'decisionImpact',
  'executionAuthority',
  'alignmentFingerprint'
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

function firstKnown(...values) {
  return values.find((value) => known(value) && value !== UNKNOWN_VALUE);
}

function normalizeStringArray(values = []) {
  return unique(asArray(values).map((value) => normalizeString(value, '')).filter(Boolean)).sort();
}

function normalizeObject(value = {}, fallback = {}) {
  if (value === UNKNOWN_VALUE) return UNKNOWN_VALUE;
  if (value === undefined || value === null) return clone(fallback);
  return clone(asObject(value));
}

function normalizeStatus(value, fallback = 'incomplete') {
  const status = normalizeString(value, fallback).toLowerCase();
  return ALIGNMENT_STATUSES.includes(status) ? status : status;
}

function missingRequiredFields(record = {}, fields = REQUIRED_SIGNAL_ALIGNMENT_FIELDS) {
  const input = asObject(record);
  return fields.filter((field) => {
    const value = input[field];
    return value === undefined || value === null || value === '';
  });
}

function validationError(code, message, field = '') {
  return { code, message, field };
}

function buildSignalAlignmentFingerprint(alignment = {}) {
  const projection = clone(alignment);
  delete projection.alignmentFingerprint;
  return buildFingerprintFromProjection(projection);
}

function buildSignalAlignmentBatchFingerprint(batch = {}) {
  const projection = clone(batch);
  delete projection.signalAlignmentBatchFingerprint;
  delete projection.alignmentBatchFingerprint;
  delete projection.batchFingerprint;
  return buildFingerprintFromProjection(projection);
}

function normalizeDefinition(definition) {
  if (!known(definition) || definition === UNKNOWN_VALUE) return UNKNOWN_VALUE;
  return clone(definition);
}

function normalizeCanonicalSignal(signal) {
  if (!known(signal) || signal === UNKNOWN_VALUE) return UNKNOWN_VALUE;
  return clone(signal);
}

function normalizeRelationshipSummary(summary = {}) {
  const input = asObject(summary);
  return {
    supportingSignalCount: Number.isFinite(Number(input.supportingSignalCount)) ? Number(input.supportingSignalCount) : 0,
    conflictingSignalCount: Number.isFinite(Number(input.conflictingSignalCount)) ? Number(input.conflictingSignalCount) : 0,
    missingReferenceCount: Number.isFinite(Number(input.missingReferenceCount)) ? Number(input.missingReferenceCount) : 0,
    unresolvedReferenceCount: Number.isFinite(Number(input.unresolvedReferenceCount)) ? Number(input.unresolvedReferenceCount) : 0,
    supportingSignals: asArray(input.supportingSignals).map((reference) => clone(reference)),
    conflictingSignals: asArray(input.conflictingSignals).map((reference) => clone(reference)),
    missingReferences: normalizeStringArray(input.missingReferences),
    unresolvedReferences: normalizeStringArray(input.unresolvedReferences)
  };
}

function determineAuthorityAlignment(input = {}) {
  const alignment = asObject(input);
  const signal = asObject(alignment.canonicalSignal);
  const definition = asObject(alignment.signalDefinition);
  const violations = [];

  for (const [prefix, record] of [
    ['', alignment],
    ['canonicalSignal.', signal],
    ['signalDefinition.', definition]
  ]) {
    for (const field of ['productionImpact', 'decisionImpact', 'executionAuthority']) {
      if (record[field] !== undefined && record[field] !== 'none') {
        violations.push(`${prefix}${field}`);
      }
    }
    const flags = asObject(record.governanceFlags);
    for (const [field, value] of Object.entries(flags)) {
      if (field.endsWith('Authority') && value === true) {
        violations.push(`${prefix}governanceFlags.${field}`);
      }
    }
  }

  return {
    status: violations.length > 0 ? 'blocked' : 'aligned',
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none',
    authorityViolations: unique(violations).sort(),
    advisoryOnly: true
  };
}

function determineAlignmentStatus(input = {}) {
  const alignment = asObject(input);
  const explicitStatus = normalizeStatus(alignment.alignmentStatus, '');
  const statuses = [];

  if (ALIGNMENT_STATUSES.includes(explicitStatus)) statuses.push(explicitStatus);
  if (asArray(alignment.errors).length > 0) statuses.push('invalid');
  if (asArray(alignment.warnings).length > 0) statuses.push('aligned_with_warnings');
  if (asArray(alignment.missingMetadata).length > 0) statuses.push('incomplete');

  const authority = determineAuthorityAlignment(alignment);
  if (authority.authorityViolations.length > 0) statuses.push('blocked');

  if (!known(alignment.signalDefinition) || alignment.signalDefinition === UNKNOWN_VALUE) statuses.push('definition_missing');
  if (!known(alignment.canonicalSignal) || alignment.canonicalSignal === UNKNOWN_VALUE) statuses.push('incomplete');
  if (!known(alignment.registryFingerprint) || alignment.registryFingerprint === UNKNOWN_VALUE) statuses.push('incomplete');
  if (!known(alignment.sourceOutputFingerprint) || alignment.sourceOutputFingerprint === UNKNOWN_VALUE) statuses.push('incomplete');

  for (const status of STATUS_PRECEDENCE) {
    if (statuses.includes(status)) return status;
  }
  return 'aligned';
}

function createSignalAlignment(input = {}, options = {}) {
  const signalDefinition = normalizeDefinition(firstDefined(input.signalDefinition, input.matchedSignalDefinition, UNKNOWN_VALUE));
  const canonicalSignal = normalizeCanonicalSignal(firstDefined(input.canonicalSignal, UNKNOWN_VALUE));
  const core = {
    schemaVersion: SIGNAL_ALIGNMENT_SCHEMA_VERSION,
    source: SIGNAL_ALIGNMENT_SOURCE,
    alignmentId: normalizeString(firstDefined(input.alignmentId, options.alignmentId, 'signal-alignment')),
    createdAt: normalizeDate(firstDefined(input.createdAt, options.createdAt, UNKNOWN_VALUE)),
    producer: normalizeString(firstDefined(input.producer, input.sourceProducer, canonicalSignal && canonicalSignal.producer && canonicalSignal.producer.name)),
    producerVersion: normalizeString(firstDefined(input.producerVersion, input.sourceProducerVersion, canonicalSignal && canonicalSignal.producerVersion)),
    sourceOutputFingerprint: normalizeString(firstDefined(input.sourceOutputFingerprint, input.sourceFingerprint, canonicalSignal && canonicalSignal.sourceFingerprint)),
    registryId: normalizeString(input.registryId),
    registryFingerprint: normalizeString(input.registryFingerprint),
    signalDefinition,
    canonicalSignal,
    authorityAlignment: determineAuthorityAlignment({
      ...input,
      signalDefinition,
      canonicalSignal,
      productionImpact: 'none',
      decisionImpact: 'none',
      executionAuthority: 'none'
    }),
    confidenceAlignment: normalizeObject(firstDefined(input.confidenceAlignment, UNKNOWN_VALUE)),
    evidenceAlignment: normalizeObject(firstDefined(input.evidenceAlignment, UNKNOWN_VALUE)),
    relationshipSummary: normalizeRelationshipSummary(input.relationshipSummary),
    warnings: normalizeStringArray(input.warnings),
    errors: normalizeStringArray(input.errors),
    missingMetadata: normalizeStringArray(input.missingMetadata),
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none',
    metadata: clone(asObject(input.metadata))
  };
  const status = normalizeStatus(firstDefined(input.alignmentStatus, determineAlignmentStatus(core)), determineAlignmentStatus(core));
  const withStatus = {
    ...core,
    alignmentStatus: ALIGNMENT_STATUSES.includes(status) ? status : 'invalid'
  };

  return deepFreeze({
    ...withStatus,
    alignmentFingerprint: buildSignalAlignmentFingerprint(withStatus)
  });
}

function cloneSignalAlignment(alignment = {}) {
  return clone(alignment);
}

function rebuildAlignmentWithFingerprint(alignment = {}) {
  const projection = clone(alignment);
  delete projection.alignmentFingerprint;
  const status = determineAlignmentStatus(projection);
  const next = {
    ...projection,
    alignmentStatus: status,
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none',
    authorityAlignment: determineAuthorityAlignment(projection)
  };
  return deepFreeze({
    ...next,
    alignmentFingerprint: buildSignalAlignmentFingerprint(next)
  });
}

function attachRegistryReference(alignment = {}, registryReference = {}) {
  const reference = asObject(registryReference);
  const next = {
    ...clone(alignment),
    registryId: normalizeString(firstDefined(reference.registryId, alignment.registryId)),
    registryFingerprint: normalizeString(firstDefined(reference.registryFingerprint, reference.fingerprint, alignment.registryFingerprint)),
    signalDefinition: normalizeDefinition(firstDefined(reference.signalDefinition, reference.definition, alignment.signalDefinition)),
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
  return rebuildAlignmentWithFingerprint(next);
}

function attachCanonicalSignal(alignment = {}, canonicalSignal = {}) {
  const nextSignal = normalizeCanonicalSignal(canonicalSignal);
  const next = {
    ...clone(alignment),
    canonicalSignal: nextSignal,
    producer: normalizeString(firstKnown(alignment.producer, nextSignal && nextSignal.producer && nextSignal.producer.name)),
    producerVersion: normalizeString(firstKnown(alignment.producerVersion, nextSignal && nextSignal.producerVersion)),
    sourceOutputFingerprint: normalizeString(firstKnown(alignment.sourceOutputFingerprint, nextSignal && nextSignal.sourceFingerprint)),
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
  return rebuildAlignmentWithFingerprint(next);
}

function validateAuthority(alignment, errors, authorityViolations) {
  const authority = determineAuthorityAlignment(alignment);
  for (const field of authority.authorityViolations) {
    errors.push(validationError('authority_boundary_violation', `${field} must not grant production authority.`, field));
    authorityViolations.push(field);
  }
  for (const field of ['productionImpact', 'decisionImpact', 'executionAuthority']) {
    if (alignment[field] !== 'none') {
      errors.push(validationError(`invalid_${field.replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`)}`, `${field} must remain none.`, field));
      authorityViolations.push(field);
    }
  }
}

function validateSignalAlignment(alignment = {}) {
  const errors = [];
  const warnings = [];
  const authorityViolations = [];
  const fingerprintViolations = [];
  const metadataViolations = [];
  const missing = missingRequiredFields(alignment);

  for (const field of missing) {
    errors.push(validationError('missing_required_field', `${field} is required.`, field));
    metadataViolations.push(field);
  }

  if (alignment.schemaVersion !== SIGNAL_ALIGNMENT_SCHEMA_VERSION) {
    errors.push(validationError('invalid_schema_version', 'schemaVersion must match Signal Alignment schema.', 'schemaVersion'));
    metadataViolations.push('schemaVersion');
  }
  if (alignment.source !== SIGNAL_ALIGNMENT_SOURCE) {
    errors.push(validationError('invalid_source', 'source must be signal_alignment_contract.', 'source'));
    metadataViolations.push('source');
  }
  if (!ALIGNMENT_STATUSES.includes(alignment.alignmentStatus)) {
    errors.push(validationError('invalid_alignment_status', `alignmentStatus must be one of: ${ALIGNMENT_STATUSES.join(', ')}`, 'alignmentStatus'));
    metadataViolations.push('alignmentStatus');
  }

  validateAuthority(alignment, errors, authorityViolations);

  if (alignment.signalDefinition !== UNKNOWN_VALUE && known(alignment.signalDefinition)) {
    const definitionValidation = validateSignalDefinition(alignment.signalDefinition);
    if (!definitionValidation.valid) {
      errors.push(...definitionValidation.errors.map((error) => ({
        ...error,
        field: `signalDefinition.${error.field}`
      })));
      metadataViolations.push(...definitionValidation.invalidFields.map((field) => `signalDefinition.${field}`));
    }
    warnings.push(...definitionValidation.warnings.map((warning) => ({
      ...warning,
      field: `signalDefinition.${warning.field}`
    })));
    if (
      alignment.signalDefinition.definitionFingerprint &&
      buildSignalDefinitionFingerprint(alignment.signalDefinition) !== alignment.signalDefinition.definitionFingerprint
    ) {
      fingerprintViolations.push('signalDefinition.definitionFingerprint');
    }
  }

  if (alignment.canonicalSignal !== UNKNOWN_VALUE && known(alignment.canonicalSignal)) {
    const signalValidation = validateCanonicalSignal(alignment.canonicalSignal);
    if (!signalValidation.valid) {
      errors.push(...signalValidation.errors.map((error) => ({
        ...error,
        field: `canonicalSignal.${error.field}`
      })));
      metadataViolations.push(...signalValidation.invalidFields.map((field) => `canonicalSignal.${field}`));
    }
    warnings.push(...signalValidation.warnings.map((warning) => ({
      ...warning,
      field: `canonicalSignal.${warning.field}`
    })));
    if (
      alignment.canonicalSignal.signalFingerprint &&
      buildCanonicalSignalFingerprint(alignment.canonicalSignal) !== alignment.canonicalSignal.signalFingerprint
    ) {
      fingerprintViolations.push('canonicalSignal.signalFingerprint');
    }
  }

  if (alignment.registry && alignment.registryFingerprint && buildSignalRegistryFingerprint(alignment.registry) !== alignment.registryFingerprint) {
    errors.push(validationError('registry_fingerprint_mismatch', 'registryFingerprint does not match registry contents.', 'registryFingerprint'));
    fingerprintViolations.push('registryFingerprint');
  }

  if (alignment.alignmentFingerprint && buildSignalAlignmentFingerprint(alignment) !== alignment.alignmentFingerprint) {
    errors.push(validationError('alignment_fingerprint_mismatch', 'alignmentFingerprint does not match alignment contents.', 'alignmentFingerprint'));
    fingerprintViolations.push('alignmentFingerprint');
  }

  const expectedStatus = determineAlignmentStatus(alignment);
  if (alignment.alignmentStatus !== expectedStatus) {
    warnings.push(validationError('alignment_status_drift', `alignmentStatus should resolve to ${expectedStatus}.`, 'alignmentStatus'));
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
    authorityViolations: unique(authorityViolations).sort(),
    fingerprintViolations: unique(fingerprintViolations).sort(),
    metadataViolations: unique(metadataViolations).sort(),
    missingRequiredFields: unique(missing).sort()
  };
}

module.exports = {
  ALIGNMENT_STATUSES,
  REQUIRED_SIGNAL_ALIGNMENT_FIELDS,
  SIGNAL_ALIGNMENT_SCHEMA_VERSION,
  SIGNAL_ALIGNMENT_SOURCE,
  attachCanonicalSignal,
  attachRegistryReference,
  buildSignalAlignmentBatchFingerprint,
  buildSignalAlignmentFingerprint,
  cloneSignalAlignment,
  createSignalAlignment,
  determineAlignmentStatus,
  determineAuthorityAlignment,
  validateSignalAlignment
};
