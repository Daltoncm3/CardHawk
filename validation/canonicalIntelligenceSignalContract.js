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
  buildOfflineAuthorityFlags,
  clone,
  firstDefined
} = require('./phase8GovernanceCore');

const CANONICAL_INTELLIGENCE_SIGNAL_SCHEMA_VERSION = '1.0.0';
const CANONICAL_INTELLIGENCE_SIGNAL_SOURCE = 'canonical_intelligence_signal_contract';
const UNKNOWN_VALUE = 'unknown';

const SIGNAL_TYPES = Object.freeze([
  'scan',
  'parser',
  'identity',
  'evidence',
  'valuation',
  'range',
  'confidence',
  'risk',
  'quality',
  'grading',
  'financial',
  'decision',
  'notification',
  'learning',
  'review',
  'calibration',
  'governance',
  'diagnostic',
  'context',
  UNKNOWN_VALUE
]);

const DECISION_ROLES = Object.freeze([
  'authoritative',
  'blocking_input',
  'supporting_context',
  'diagnostic_only',
  'review_only',
  'none',
  UNKNOWN_VALUE
]);

const AUTHORITY_LEVELS = Object.freeze([
  'production_decision',
  'production_context',
  'shadow_observation',
  'offline_validation',
  'governance',
  'display_metadata',
  'advisory',
  UNKNOWN_VALUE
]);

const PRODUCER_CATEGORIES = Object.freeze([
  'production_engine',
  'shadow_engine',
  'offline_validation',
  'governance',
  'service',
  'utility',
  'manual_review',
  UNKNOWN_VALUE
]);

const CONFIDENCE_LEVELS = Object.freeze([
  'high',
  'moderate',
  'low',
  'insufficient',
  'not_applicable',
  UNKNOWN_VALUE
]);

const CONFIDENCE_KINDS = Object.freeze([
  'reported',
  'derived',
  'calibrated',
  'reviewed',
  'not_applicable',
  UNKNOWN_VALUE
]);

const UNCERTAINTY_LEVELS = Object.freeze([
  'low',
  'moderate',
  'high',
  'extreme',
  'not_applicable',
  UNKNOWN_VALUE
]);

const EVIDENCE_QUALITY_LEVELS = Object.freeze([
  'strong',
  'adequate',
  'limited',
  'weak',
  'insufficient',
  'not_applicable',
  UNKNOWN_VALUE
]);

const SIGNAL_STATUSES = Object.freeze({
  AVAILABLE: 'available',
  BLOCKED: 'blocked',
  CONFLICTED: 'conflicted',
  WARNING: 'warning',
  UNAVAILABLE: 'unavailable'
});

const REQUIRED_CANONICAL_SIGNAL_FIELDS = Object.freeze([
  'schemaVersion',
  'source',
  'signalId',
  'signalName',
  'producer',
  'producerVersion',
  'producerCategory',
  'createdAt',
  'signalType',
  'decisionRole',
  'authorityLevel',
  'productionImpact',
  'decisionImpact',
  'executionAuthority',
  'confidence',
  'confidenceLevel',
  'uncertainty',
  'evidenceBasis',
  'evidenceQuality',
  'evidenceReferences',
  'supportingSignals',
  'conflictingSignals',
  'warnings',
  'blockers',
  'rawOutput',
  'normalizedOutput',
  'governanceFlags',
  'sourceFingerprint',
  'signalFingerprint'
]);

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}

function preserveClone(value) {
  return JSON.parse(JSON.stringify(value));
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

function normalizeSignalReference(reference = {}) {
  const input = typeof reference === 'string' ? { signalId: reference } : asObject(reference);
  return {
    signalId: normalizeString(firstDefined(input.signalId, input.id)),
    signalFingerprint: normalizeString(firstDefined(input.signalFingerprint, input.fingerprint)),
    relationship: normalizeString(firstDefined(input.relationship, input.reason, UNKNOWN_VALUE)),
    details: clone(asObject(input.details))
  };
}

function normalizeEvidenceReference(reference = {}, options = {}) {
  const input = asObject(reference);
  return {
    referenceId: normalizeString(firstDefined(input.referenceId, input.id)),
    referenceType: normalizeString(firstDefined(input.referenceType, input.type)),
    source: normalizeString(input.source),
    sourceFingerprint: normalizeString(firstDefined(input.sourceFingerprint, input.fingerprint)),
    attachedAt: normalizeDate(firstDefined(input.attachedAt, options.attachedAt, UNKNOWN_VALUE)),
    evidenceRole: normalizeString(firstDefined(input.evidenceRole, input.role)),
    productionImpact: 'none',
    decisionImpact: 'none',
    details: clone(asObject(input.details))
  };
}

function normalizeProducer(value = {}) {
  if (typeof value === 'string') {
    return {
      producerId: normalizeString(value),
      name: normalizeString(value),
      module: UNKNOWN_VALUE,
      functionName: UNKNOWN_VALUE,
      version: UNKNOWN_VALUE,
      category: UNKNOWN_VALUE,
      metadata: {}
    };
  }

  const input = asObject(value);
  const name = normalizeString(firstDefined(input.name, input.producerName, input.producerId, input.id));
  return {
    producerId: normalizeString(firstDefined(input.producerId, input.id, name)),
    name,
    module: normalizeString(firstDefined(input.module, input.file, input.owner)),
    functionName: normalizeString(firstDefined(input.functionName, input.function, input.method)),
    version: normalizeString(firstDefined(input.version, input.producerVersion)),
    category: normalizeEnum(input.category, PRODUCER_CATEGORIES, UNKNOWN_VALUE),
    metadata: clone(asObject(input.metadata))
  };
}

function normalizeConfidence(value = {}, confidenceLevel = UNKNOWN_VALUE) {
  if (!known(value) || value === UNKNOWN_VALUE) {
    return {
      kind: UNKNOWN_VALUE,
      value: UNKNOWN_VALUE,
      scale: UNKNOWN_VALUE,
      basis: UNKNOWN_VALUE,
      calibrated: false,
      level: normalizeEnum(confidenceLevel, CONFIDENCE_LEVELS, UNKNOWN_VALUE)
    };
  }

  if (typeof value === 'number' || typeof value === 'string') {
    const number = Number(value);
    return {
      kind: 'reported',
      value: Number.isFinite(number) ? number : normalizeString(value),
      scale: Number.isFinite(number) ? '0_100' : UNKNOWN_VALUE,
      basis: UNKNOWN_VALUE,
      calibrated: false,
      level: normalizeEnum(confidenceLevel, CONFIDENCE_LEVELS, UNKNOWN_VALUE)
    };
  }

  const input = asObject(value);
  const rawValue = firstDefined(input.value, input.confidence, input.score, UNKNOWN_VALUE);
  const number = Number(rawValue);
  return {
    kind: normalizeEnum(input.kind, CONFIDENCE_KINDS, 'reported'),
    value: Number.isFinite(number) ? number : normalizeString(rawValue),
    scale: normalizeString(firstDefined(input.scale, Number.isFinite(number) ? '0_100' : UNKNOWN_VALUE)),
    basis: normalizeString(input.basis),
    calibrated: input.calibrated === true,
    level: normalizeEnum(firstDefined(input.level, confidenceLevel), CONFIDENCE_LEVELS, UNKNOWN_VALUE),
    details: clone(asObject(input.details))
  };
}

function normalizeUncertainty(value = {}) {
  if (!known(value) || value === UNKNOWN_VALUE) {
    return {
      level: UNKNOWN_VALUE,
      range: UNKNOWN_VALUE,
      reasonCodes: []
    };
  }

  if (typeof value === 'string') {
    return {
      level: normalizeEnum(value, UNCERTAINTY_LEVELS, UNKNOWN_VALUE),
      range: UNKNOWN_VALUE,
      reasonCodes: []
    };
  }

  const input = asObject(value);
  return {
    level: normalizeEnum(input.level, UNCERTAINTY_LEVELS, UNKNOWN_VALUE),
    range: clone(firstDefined(input.range, UNKNOWN_VALUE)),
    reasonCodes: normalizeStringArray(input.reasonCodes),
    details: clone(asObject(input.details))
  };
}

function normalizeEvidenceBasis(value = {}) {
  const input = asObject(value);
  return {
    trueSoldCount: Number.isFinite(Number(input.trueSoldCount)) ? Number(input.trueSoldCount) : UNKNOWN_VALUE,
    activeListingCount: Number.isFinite(Number(input.activeListingCount)) ? Number(input.activeListingCount) : UNKNOWN_VALUE,
    fallbackUsed: input.fallbackUsed === true,
    staleCount: Number.isFinite(Number(input.staleCount)) ? Number(input.staleCount) : UNKNOWN_VALUE,
    rejectedCount: Number.isFinite(Number(input.rejectedCount)) ? Number(input.rejectedCount) : UNKNOWN_VALUE,
    transactionIneligibleCount: Number.isFinite(Number(input.transactionIneligibleCount)) ? Number(input.transactionIneligibleCount) : UNKNOWN_VALUE,
    sourceConcentration: clone(firstDefined(input.sourceConcentration, UNKNOWN_VALUE)),
    asOf: normalizeDate(firstDefined(input.asOf, input.evidenceAsOf, UNKNOWN_VALUE)),
    details: clone(asObject(input.details))
  };
}

function normalizeEvidenceQuality(value = {}) {
  if (typeof value === 'string') {
    return {
      level: normalizeEnum(value, EVIDENCE_QUALITY_LEVELS, UNKNOWN_VALUE),
      score: UNKNOWN_VALUE,
      basis: UNKNOWN_VALUE,
      details: {}
    };
  }

  const input = asObject(value);
  const rawScore = firstDefined(input.score, input.evidenceQualityScore, input.comparableQualityScore, UNKNOWN_VALUE);
  const number = Number(rawScore);
  return {
    level: normalizeEnum(input.level, EVIDENCE_QUALITY_LEVELS, UNKNOWN_VALUE),
    score: Number.isFinite(number) ? number : normalizeString(rawScore),
    basis: normalizeString(input.basis),
    details: clone(asObject(input.details))
  };
}

function missingRequiredFields(record = {}, fields = REQUIRED_CANONICAL_SIGNAL_FIELDS) {
  const input = asObject(record);
  return fields.filter((field) => {
    const value = input[field];
    return value === undefined || value === null || value === '';
  });
}

function buildCanonicalSignalFingerprint(signal = {}) {
  const projection = clone(signal);
  delete projection.signalFingerprint;
  return buildFingerprintFromProjection(projection);
}

function buildCanonicalSignalBatchFingerprint(batch = {}) {
  const projection = clone(batch);
  delete projection.signalBatchFingerprint;
  delete projection.batchFingerprint;
  return buildFingerprintFromProjection(projection);
}

function determineSignalStatus(signal = {}) {
  const input = asObject(signal);
  if (asArray(input.blockers).length > 0) return SIGNAL_STATUSES.BLOCKED;
  if (asArray(input.conflictingSignals).length > 0) return SIGNAL_STATUSES.CONFLICTED;
  if (asArray(input.warnings).length > 0) return SIGNAL_STATUSES.WARNING;
  if (!known(input.rawOutput) || input.rawOutput === UNKNOWN_VALUE) return SIGNAL_STATUSES.UNAVAILABLE;
  return SIGNAL_STATUSES.AVAILABLE;
}

function determineSignalAuthority(signal = {}) {
  const input = asObject(signal);
  return {
    authorityLevel: normalizeEnum(input.authorityLevel, AUTHORITY_LEVELS, 'advisory'),
    decisionRole: normalizeEnum(input.decisionRole, DECISION_ROLES, 'none'),
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none',
    advisoryOnly: true
  };
}

function determineSignalConfidence(signal = {}) {
  const input = asObject(signal);
  return normalizeConfidence(input.confidence, input.confidenceLevel);
}

function createCanonicalSignal(input = {}, options = {}) {
  const producer = normalizeProducer(input.producer);
  const confidenceLevel = normalizeEnum(input.confidenceLevel, CONFIDENCE_LEVELS, UNKNOWN_VALUE);
  const core = {
    schemaVersion: CANONICAL_INTELLIGENCE_SIGNAL_SCHEMA_VERSION,
    source: CANONICAL_INTELLIGENCE_SIGNAL_SOURCE,
    signalId: normalizeString(firstDefined(input.signalId, options.signalId, 'canonical-signal')),
    signalName: normalizeString(firstDefined(input.signalName, options.signalName, input.signalId, 'Canonical Signal')),
    producer,
    producerVersion: normalizeString(firstDefined(input.producerVersion, producer.version)),
    producerCategory: normalizeEnum(firstDefined(input.producerCategory, producer.category), PRODUCER_CATEGORIES, UNKNOWN_VALUE),
    createdAt: normalizeDate(firstDefined(input.createdAt, options.createdAt, UNKNOWN_VALUE)),
    signalType: normalizeEnum(input.signalType, SIGNAL_TYPES, UNKNOWN_VALUE),
    decisionRole: normalizeEnum(input.decisionRole, DECISION_ROLES, 'none'),
    authorityLevel: normalizeEnum(input.authorityLevel, AUTHORITY_LEVELS, 'advisory'),
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none',
    confidence: normalizeConfidence(input.confidence, confidenceLevel),
    confidenceLevel,
    uncertainty: normalizeUncertainty(input.uncertainty),
    evidenceBasis: normalizeEvidenceBasis(input.evidenceBasis),
    evidenceQuality: normalizeEvidenceQuality(input.evidenceQuality),
    evidenceReferences: asArray(input.evidenceReferences).map((reference) => normalizeEvidenceReference(reference)),
    supportingSignals: asArray(input.supportingSignals).map((reference) => normalizeSignalReference(reference)),
    conflictingSignals: asArray(input.conflictingSignals).map((reference) => normalizeSignalReference(reference)),
    warnings: normalizeStringArray(input.warnings),
    blockers: normalizeStringArray(input.blockers),
    rawOutput: known(input.rawOutput) ? preserveClone(input.rawOutput) : UNKNOWN_VALUE,
    normalizedOutput: known(input.normalizedOutput) ? preserveClone(input.normalizedOutput) : UNKNOWN_VALUE,
    governanceFlags: {
      ...buildOfflineAuthorityFlags(input.governanceFlags),
      productionImpact: 'none',
      decisionImpact: 'none',
      executionAuthority: 'none'
    },
    sourceFingerprint: normalizeString(input.sourceFingerprint),
    metadata: clone(asObject(input.metadata))
  };

  return deepFreeze({
    ...core,
    signalFingerprint: buildCanonicalSignalFingerprint(core)
  });
}

function cloneCanonicalSignal(signal = {}) {
  return clone(signal);
}

function rebuildSignalWithFingerprint(signal = {}) {
  const projection = clone(signal);
  delete projection.signalFingerprint;
  return deepFreeze({
    ...projection,
    signalFingerprint: buildCanonicalSignalFingerprint(projection)
  });
}

function attachEvidenceReference(signal = {}, evidenceReference = {}, options = {}) {
  const nextSignal = {
    ...clone(signal),
    evidenceReferences: [
      ...asArray(signal.evidenceReferences).map((reference) => clone(reference)),
      normalizeEvidenceReference(evidenceReference, options)
    ],
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
  return rebuildSignalWithFingerprint(nextSignal);
}

function attachProducerMetadata(signal = {}, producerMetadata = {}) {
  const currentProducer = normalizeProducer(signal.producer);
  const nextProducer = normalizeProducer({
    ...currentProducer,
    ...asObject(producerMetadata),
    metadata: {
      ...asObject(currentProducer.metadata),
      ...asObject(producerMetadata.metadata)
    }
  });
  const nextSignal = {
    ...clone(signal),
    producer: nextProducer,
    producerVersion: normalizeString(firstDefined(producerMetadata.producerVersion, producerMetadata.version, signal.producerVersion, nextProducer.version)),
    producerCategory: normalizeEnum(firstDefined(producerMetadata.producerCategory, producerMetadata.category, signal.producerCategory, nextProducer.category), PRODUCER_CATEGORIES, UNKNOWN_VALUE),
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
  return rebuildSignalWithFingerprint(nextSignal);
}

function validationError(code, message, field = '') {
  return { code, message, field };
}

function validateEnum(record, field, allowedValues, errors, invalidFields) {
  if (!allowedValues.includes(record[field])) {
    errors.push(validationError('invalid_enum_value', `${field} must be one of: ${allowedValues.join(', ')}`, field));
    invalidFields.push(field);
  }
}

function validateAuthority(signal, errors, invalidFields, authorityViolations) {
  for (const field of ['productionImpact', 'decisionImpact', 'executionAuthority']) {
    if (signal[field] !== 'none') {
      const code = `invalid_${field.replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`)}`;
      errors.push(validationError(code, `${field} must remain none.`, field));
      invalidFields.push(field);
      authorityViolations.push(field);
    }
  }

  const flags = asObject(signal.governanceFlags);
  for (const [field, value] of Object.entries(flags)) {
    if (field.endsWith('Authority') && value === true) {
      errors.push(validationError('invalid_governance_authority_flag', 'governanceFlags must not grant authority.', `governanceFlags.${field}`));
      invalidFields.push(`governanceFlags.${field}`);
      authorityViolations.push(`governanceFlags.${field}`);
    }
  }

  for (const [index, reference] of asArray(signal.evidenceReferences).entries()) {
    if (reference.productionImpact !== 'none') {
      errors.push(validationError('invalid_evidence_reference_production_impact', 'Evidence references must not affect production.', `evidenceReferences.${index}.productionImpact`));
      invalidFields.push(`evidenceReferences.${index}.productionImpact`);
      authorityViolations.push(`evidenceReferences.${index}.productionImpact`);
    }
    if (reference.decisionImpact !== 'none') {
      errors.push(validationError('invalid_evidence_reference_decision_impact', 'Evidence references must not affect decisions.', `evidenceReferences.${index}.decisionImpact`));
      invalidFields.push(`evidenceReferences.${index}.decisionImpact`);
      authorityViolations.push(`evidenceReferences.${index}.decisionImpact`);
    }
  }
}

function validateEvidence(signal, errors, invalidFields, evidenceViolations) {
  if (!Array.isArray(signal.evidenceReferences)) {
    errors.push(validationError('invalid_evidence_references', 'evidenceReferences must be an array.', 'evidenceReferences'));
    invalidFields.push('evidenceReferences');
    evidenceViolations.push('evidenceReferences');
  }
  if (!Array.isArray(signal.supportingSignals)) {
    errors.push(validationError('invalid_supporting_signals', 'supportingSignals must be an array.', 'supportingSignals'));
    invalidFields.push('supportingSignals');
    evidenceViolations.push('supportingSignals');
  }
  if (!Array.isArray(signal.conflictingSignals)) {
    errors.push(validationError('invalid_conflicting_signals', 'conflictingSignals must be an array.', 'conflictingSignals'));
    invalidFields.push('conflictingSignals');
    evidenceViolations.push('conflictingSignals');
  }

  const evidenceBasis = asObject(signal.evidenceBasis);
  for (const field of ['trueSoldCount', 'activeListingCount', 'staleCount', 'rejectedCount', 'transactionIneligibleCount']) {
    if (evidenceBasis[field] !== UNKNOWN_VALUE) {
      const number = Number(evidenceBasis[field]);
      if (!Number.isFinite(number) || number < 0) {
        errors.push(validationError('invalid_evidence_count', `${field} must be a non-negative number or unknown.`, `evidenceBasis.${field}`));
        invalidFields.push(`evidenceBasis.${field}`);
        evidenceViolations.push(`evidenceBasis.${field}`);
      }
    }
  }
}

function validateCanonicalSignal(signal = {}) {
  const errors = [];
  const warnings = [];
  const invalidFields = [];
  const authorityViolations = [];
  const fingerprintViolations = [];
  const evidenceViolations = [];
  const missing = missingRequiredFields(signal);

  for (const field of missing) {
    errors.push(validationError('missing_required_field', `${field} is required.`, field));
    invalidFields.push(field);
  }

  if (signal.schemaVersion !== CANONICAL_INTELLIGENCE_SIGNAL_SCHEMA_VERSION) {
    errors.push(validationError('invalid_schema_version', 'schemaVersion must match Canonical Intelligence Signal schema.', 'schemaVersion'));
    invalidFields.push('schemaVersion');
  }
  if (signal.source !== CANONICAL_INTELLIGENCE_SIGNAL_SOURCE) {
    errors.push(validationError('invalid_source', 'source must be canonical_intelligence_signal_contract.', 'source'));
    invalidFields.push('source');
  }

  validateEnum(signal, 'signalType', SIGNAL_TYPES, errors, invalidFields);
  validateEnum(signal, 'decisionRole', DECISION_ROLES, errors, invalidFields);
  validateEnum(signal, 'authorityLevel', AUTHORITY_LEVELS, errors, invalidFields);
  validateEnum(signal, 'producerCategory', PRODUCER_CATEGORIES, errors, invalidFields);
  validateEnum(signal, 'confidenceLevel', CONFIDENCE_LEVELS, errors, invalidFields);

  const confidence = asObject(signal.confidence);
  if (confidence.kind !== undefined && !CONFIDENCE_KINDS.includes(confidence.kind)) {
    errors.push(validationError('invalid_confidence_kind', `confidence.kind must be one of: ${CONFIDENCE_KINDS.join(', ')}`, 'confidence.kind'));
    invalidFields.push('confidence.kind');
  }
  if (confidence.value !== undefined && confidence.value !== UNKNOWN_VALUE && confidence.scale === '0_100') {
    const number = Number(confidence.value);
    if (!Number.isFinite(number) || number < 0 || number > 100) {
      errors.push(validationError('invalid_confidence_value', 'confidence.value must be 0-100 for 0_100 scale.', 'confidence.value'));
      invalidFields.push('confidence.value');
    }
  }

  const uncertainty = asObject(signal.uncertainty);
  if (uncertainty.level !== undefined && !UNCERTAINTY_LEVELS.includes(uncertainty.level)) {
    errors.push(validationError('invalid_uncertainty_level', `uncertainty.level must be one of: ${UNCERTAINTY_LEVELS.join(', ')}`, 'uncertainty.level'));
    invalidFields.push('uncertainty.level');
  }

  const evidenceQuality = asObject(signal.evidenceQuality);
  if (evidenceQuality.level !== undefined && !EVIDENCE_QUALITY_LEVELS.includes(evidenceQuality.level)) {
    errors.push(validationError('invalid_evidence_quality_level', `evidenceQuality.level must be one of: ${EVIDENCE_QUALITY_LEVELS.join(', ')}`, 'evidenceQuality.level'));
    invalidFields.push('evidenceQuality.level');
  }

  validateAuthority(signal, errors, invalidFields, authorityViolations);
  validateEvidence(signal, errors, invalidFields, evidenceViolations);

  if (asArray(signal.blockers).length > 0) {
    warnings.push(validationError('signal_has_blockers', 'Signal contains blockers and should remain review-only.', 'blockers'));
  }
  if (signal.rawOutput === UNKNOWN_VALUE) {
    warnings.push(validationError('raw_output_unknown', 'rawOutput is explicitly unknown.', 'rawOutput'));
  }

  if (signal.signalFingerprint && buildCanonicalSignalFingerprint(signal) !== signal.signalFingerprint) {
    errors.push(validationError('signal_fingerprint_mismatch', 'signalFingerprint does not match signal contents.', 'signalFingerprint'));
    invalidFields.push('signalFingerprint');
    fingerprintViolations.push('signalFingerprint');
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
    invalidFields: unique(invalidFields),
    authorityViolations: unique(authorityViolations),
    fingerprintViolations: unique(fingerprintViolations),
    evidenceViolations: unique(evidenceViolations),
    missingRequiredFields: unique(missing)
  };
}

module.exports = {
  AUTHORITY_LEVELS,
  CANONICAL_INTELLIGENCE_SIGNAL_SCHEMA_VERSION,
  CANONICAL_INTELLIGENCE_SIGNAL_SOURCE,
  CONFIDENCE_KINDS,
  CONFIDENCE_LEVELS,
  DECISION_ROLES,
  EVIDENCE_QUALITY_LEVELS,
  PRODUCER_CATEGORIES,
  REQUIRED_CANONICAL_SIGNAL_FIELDS,
  SIGNAL_STATUSES,
  SIGNAL_TYPES,
  UNCERTAINTY_LEVELS,
  UNKNOWN_VALUE,
  attachEvidenceReference,
  attachProducerMetadata,
  buildCanonicalSignalBatchFingerprint,
  buildCanonicalSignalFingerprint,
  cloneCanonicalSignal,
  createCanonicalSignal,
  determineSignalAuthority,
  determineSignalConfidence,
  determineSignalStatus,
  validateCanonicalSignal
};
