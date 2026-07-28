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
  UNKNOWN_VALUE
} = require('./canonicalIntelligenceSignalContract');
const {
  validateSignalAlignment,
  buildSignalAlignmentFingerprint
} = require('./signalAlignmentContract');

const SIGNAL_ALIGNMENT_BATCH_SCHEMA_VERSION = '1.0.0';
const SIGNAL_ALIGNMENT_BATCH_SOURCE = 'signal_alignment_batch';

const REQUIRED_ALIGNMENT_BATCH_FIELDS = Object.freeze([
  'schemaVersion',
  'source',
  'alignmentBatchId',
  'createdAt',
  'alignmentCount',
  'alignments',
  'summary',
  'productionImpact',
  'decisionImpact',
  'executionAuthority',
  'batchFingerprint'
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

function validationError(code, message, field = '') {
  return { code, message, field };
}

function normalizeAlignmentInput(input = {}) {
  if (input && input.alignment && input.alignment.alignmentFingerprint) return clone(input.alignment);
  return clone(input);
}

function alignmentKey(alignment = {}) {
  return [
    normalizeString(alignment.producer),
    normalizeString(alignment.producerVersion),
    normalizeString(alignment.canonicalSignal && alignment.canonicalSignal.signalName),
    normalizeString(alignment.canonicalSignal && alignment.canonicalSignal.signalFingerprint),
    normalizeString(alignment.sourceOutputFingerprint),
    normalizeString(alignment.alignmentFingerprint)
  ].join('|');
}

function sortAlignments(alignments = [], sortBy = 'canonicalSignal.signalName') {
  const sorted = asArray(alignments).map((alignment) => clone(alignment));
  return sorted.sort((left, right) => {
    const leftValue = resolvePath(left, sortBy);
    const rightValue = resolvePath(right, sortBy);
    const primary = normalizeString(leftValue).localeCompare(normalizeString(rightValue));
    return primary || alignmentKey(left).localeCompare(alignmentKey(right));
  });
}

function resolvePath(source = {}, path = '') {
  return String(path).split('.').reduce((current, part) => {
    if (!current || typeof current !== 'object') return undefined;
    return current[part];
  }, source);
}

function buildCountSummary(values = []) {
  const summary = {};
  for (const value of asArray(values)) {
    const key = normalizeString(value);
    summary[key] = (summary[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(summary).sort(([left], [right]) => left.localeCompare(right)));
}

function getDuplicateAlignments(alignments = []) {
  const seen = new Set();
  const duplicates = [];
  for (const alignment of asArray(alignments)) {
    const key = normalizeString(alignment.alignmentFingerprint, alignmentKey(alignment));
    if (seen.has(key)) duplicates.push(key);
    seen.add(key);
  }
  return unique(duplicates).sort();
}

function summarizeAlignmentBatch(batchOrAlignments = {}) {
  const alignments = Array.isArray(batchOrAlignments)
    ? batchOrAlignments
    : asArray(batchOrAlignments.alignments);
  const validations = alignments.map((alignment) => validateSignalAlignment(alignment));
  const authorityViolations = validations.flatMap((validation) => validation.authorityViolations);
  const fingerprintViolations = validations.flatMap((validation) => validation.fingerprintViolations);
  const duplicateAlignments = getDuplicateAlignments(alignments);

  return deepFreeze({
    schemaVersion: SIGNAL_ALIGNMENT_BATCH_SCHEMA_VERSION,
    alignmentCount: alignments.length,
    validCount: validations.filter((validation) => validation.valid).length,
    invalidCount: validations.filter((validation) => !validation.valid).length,
    statusSummary: buildCountSummary(alignments.map((alignment) => alignment.alignmentStatus)),
    producerSummary: buildCountSummary(alignments.map((alignment) => alignment.producer)),
    authoritySummary: buildCountSummary(alignments.map((alignment) => alignment.authorityAlignment && alignment.authorityAlignment.status)),
    signalSummary: buildCountSummary(alignments.map((alignment) => alignment.canonicalSignal && alignment.canonicalSignal.signalName)),
    warningCount: validations.reduce((total, validation) => total + validation.warnings.length, 0),
    errorCount: validations.reduce((total, validation) => total + validation.errors.length, 0),
    duplicateAlignmentCount: duplicateAlignments.length,
    authorityViolationCount: unique(authorityViolations).length,
    fingerprintViolationCount: unique(fingerprintViolations).length,
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  });
}

function buildAlignmentBatchFingerprint(batch = {}) {
  const projection = clone(batch);
  delete projection.batchFingerprint;
  delete projection.alignmentBatchFingerprint;
  delete projection.signalAlignmentBatchFingerprint;
  return buildFingerprintFromProjection(projection);
}

function createAlignmentBatch(input = {}, options = {}) {
  const rawAlignments = Array.isArray(input) ? input : asArray(firstDefined(input.alignments, input.adaptedSignals, []));
  const alignments = sortAlignments(rawAlignments.map((item) => normalizeAlignmentInput(item)));
  const core = {
    schemaVersion: SIGNAL_ALIGNMENT_BATCH_SCHEMA_VERSION,
    source: SIGNAL_ALIGNMENT_BATCH_SOURCE,
    alignmentBatchId: normalizeString(firstDefined(input.alignmentBatchId, options.alignmentBatchId, 'signal-alignment-batch')),
    createdAt: normalizeDate(firstDefined(input.createdAt, options.createdAt, UNKNOWN_VALUE)),
    alignmentCount: alignments.length,
    alignments,
    summary: summarizeAlignmentBatch(alignments),
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none',
    metadata: clone(asObject(input.metadata))
  };

  return deepFreeze({
    ...core,
    batchFingerprint: buildAlignmentBatchFingerprint(core)
  });
}

function addAlignmentToBatch(batch = {}, alignment = {}) {
  const current = createAlignmentBatch(batch);
  return createAlignmentBatch({
    ...current,
    alignments: [...current.alignments, normalizeAlignmentInput(alignment)]
  });
}

function removeAlignmentFromBatch(batch = {}, alignmentFingerprint) {
  const current = createAlignmentBatch(batch);
  const target = normalizeString(alignmentFingerprint);
  return createAlignmentBatch({
    ...current,
    alignments: current.alignments.filter((alignment) => normalizeString(alignment.alignmentFingerprint) !== target)
  });
}

function filterAlignmentBatch(batch = {}, filters = {}) {
  const input = asObject(filters);
  const current = createAlignmentBatch(batch);
  const alignments = current.alignments.filter((alignment) => {
    if (known(input.producer) && alignment.producer !== input.producer) return false;
    if (known(input.producerVersion) && alignment.producerVersion !== input.producerVersion) return false;
    if (known(input.alignmentStatus) && alignment.alignmentStatus !== input.alignmentStatus) return false;
    if (known(input.authorityStatus) && normalizeString(alignment.authorityAlignment && alignment.authorityAlignment.status) !== input.authorityStatus) return false;
    if (known(input.signalName) && normalizeString(alignment.canonicalSignal && alignment.canonicalSignal.signalName) !== input.signalName) return false;
    return true;
  });
  return createAlignmentBatch({
    ...current,
    alignments
  });
}

function sortAlignmentBatch(batch = {}, sortBy = 'canonicalSignal.signalName') {
  const current = createAlignmentBatch(batch);
  return createAlignmentBatch({
    ...current,
    alignments: sortAlignments(current.alignments, sortBy)
  });
}

function validateAuthority(batch = {}, errors, authorityViolations) {
  for (const field of ['productionImpact', 'decisionImpact', 'executionAuthority']) {
    if (batch[field] !== 'none') {
      errors.push(validationError(`invalid_${field.replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`)}`, `${field} must remain none.`, field));
      authorityViolations.push(field);
    }
  }
}

function validateAlignmentBatch(batch = {}) {
  const errors = [];
  const warnings = [];
  const authorityViolations = [];
  const fingerprintViolations = [];
  const missing = REQUIRED_ALIGNMENT_BATCH_FIELDS.filter((field) => {
    const value = batch[field];
    return value === undefined || value === null || value === '';
  });
  const alignments = asArray(batch.alignments);

  for (const field of missing) {
    errors.push(validationError('missing_required_field', `${field} is required.`, field));
  }

  if (batch.schemaVersion !== SIGNAL_ALIGNMENT_BATCH_SCHEMA_VERSION) {
    errors.push(validationError('invalid_schema_version', 'schemaVersion must match Signal Alignment Batch schema.', 'schemaVersion'));
  }
  if (batch.source !== SIGNAL_ALIGNMENT_BATCH_SOURCE) {
    errors.push(validationError('invalid_source', 'source must be signal_alignment_batch.', 'source'));
  }
  if (!Array.isArray(batch.alignments)) {
    errors.push(validationError('invalid_alignments', 'alignments must be an array.', 'alignments'));
  }
  if (batch.alignmentCount !== alignments.length) {
    errors.push(validationError('alignment_count_mismatch', 'alignmentCount must match alignments length.', 'alignmentCount'));
  }

  validateAuthority(batch, errors, authorityViolations);

  const duplicateAlignments = getDuplicateAlignments(alignments);
  for (const duplicate of duplicateAlignments) {
    errors.push(validationError('duplicate_alignment', `Duplicate alignment: ${duplicate}`, 'alignments'));
  }

  alignments.forEach((alignment, index) => {
    const validation = validateSignalAlignment(alignment);
    if (!validation.valid) {
      errors.push(...validation.errors.map((error) => ({
        ...error,
        field: `alignments.${index}.${error.field}`
      })));
    }
    warnings.push(...validation.warnings.map((warning) => ({
      ...warning,
      field: `alignments.${index}.${warning.field}`
    })));
    authorityViolations.push(...validation.authorityViolations.map((field) => `alignments.${index}.${field}`));
    fingerprintViolations.push(...validation.fingerprintViolations.map((field) => `alignments.${index}.${field}`));

    if (alignment.alignmentFingerprint && buildSignalAlignmentFingerprint(alignment) !== alignment.alignmentFingerprint) {
      errors.push(validationError('alignment_fingerprint_mismatch', 'alignmentFingerprint does not match alignment contents.', `alignments.${index}.alignmentFingerprint`));
      fingerprintViolations.push(`alignments.${index}.alignmentFingerprint`);
    }
  });

  if (batch.batchFingerprint && buildAlignmentBatchFingerprint(batch) !== batch.batchFingerprint) {
    errors.push(validationError('batch_fingerprint_mismatch', 'batchFingerprint does not match batch contents.', 'batchFingerprint'));
    fingerprintViolations.push('batchFingerprint');
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
    duplicateAlignments,
    authorityViolations: unique(authorityViolations).sort(),
    fingerprintViolations: unique(fingerprintViolations).sort(),
    missingRequiredFields: unique(missing).sort()
  };
}

module.exports = {
  SIGNAL_ALIGNMENT_BATCH_SCHEMA_VERSION,
  SIGNAL_ALIGNMENT_BATCH_SOURCE,
  addAlignmentToBatch,
  buildAlignmentBatchFingerprint,
  createAlignmentBatch,
  filterAlignmentBatch,
  removeAlignmentFromBatch,
  sortAlignmentBatch,
  summarizeAlignmentBatch,
  validateAlignmentBatch
};
