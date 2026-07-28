'use strict';

const { asArray, asObject, unique } = require('./canonicalValidationCore');
const { buildFingerprintFromProjection } = require('./fingerprintProjection');
const { clone, firstDefined } = require('./phase8GovernanceCore');
const { UNKNOWN_VALUE } = require('./canonicalIntelligenceSignalContract');
const {
  adaptDiagnosticSignal,
  adaptSignalBatch,
  validateAdaptedSignal,
  summarizeAdaptedSignals
} = require('./signalProducerAdapter');
const {
  createAlignmentBatch,
  validateAlignmentBatch,
  summarizeAlignmentBatch
} = require('./signalAlignmentBatch');

const SIGNAL_ALIGNMENT_ENGINE_SCHEMA_VERSION = '1.0.0';
const SIGNAL_ALIGNMENT_ENGINE_SOURCE = 'signal_alignment_engine';

const REQUIRED_SIGNAL_ALIGNMENT_RUN_FIELDS = Object.freeze([
  'schemaVersion',
  'source',
  'alignmentRunId',
  'createdAt',
  'registryId',
  'registryFingerprint',
  'adaptedSignalCount',
  'alignedSignalCount',
  'blockedSignalCount',
  'adaptedSignals',
  'alignmentBatch',
  'summary',
  'validation',
  'productionImpact',
  'decisionImpact',
  'executionAuthority',
  'runFingerprint'
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

function buildCountSummary(values = []) {
  const summary = {};
  for (const value of asArray(values)) {
    const key = normalizeString(value);
    summary[key] = (summary[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(summary).sort(([left], [right]) => left.localeCompare(right)));
}

function sortAdaptedSignals(adaptedSignals = []) {
  return asArray(adaptedSignals)
    .map((item) => clone(item))
    .sort((left, right) => [
      left.signalName,
      left.signalVersion,
      left.producer,
      left.sourceOutputFingerprint,
      left.adaptationFingerprint
    ].map((field) => normalizeString(field)).join('|').localeCompare([
      right.signalName,
      right.signalVersion,
      right.producer,
      right.sourceOutputFingerprint,
      right.adaptationFingerprint
    ].map((field) => normalizeString(field)).join('|')));
}

function extractAlignments(adaptedSignals = []) {
  return asArray(adaptedSignals)
    .map((adapted) => adapted && adapted.alignment)
    .filter(Boolean);
}

function getRegistryLookupFailures(adaptedSignals = []) {
  return unique(asArray(adaptedSignals)
    .filter((adapted) => normalizeString(adapted.registryLookupStatus, 'unknown') !== 'matched')
    .map((adapted) => JSON.stringify({
      producer: normalizeString(adapted.producer),
      signalName: normalizeString(adapted.signalName),
      registryLookupStatus: normalizeString(adapted.registryLookupStatus, 'unknown'),
      sourceOutputFingerprint: normalizeString(adapted.sourceOutputFingerprint)
    })))
    .sort()
    .map((item) => JSON.parse(item));
}

function getBlockedSignals(adaptedSignals = []) {
  return asArray(adaptedSignals).filter((adapted) => {
    const status = adapted.alignment && adapted.alignment.alignmentStatus;
    const authorityStatus = adapted.alignment && adapted.alignment.authorityAlignment && adapted.alignment.authorityAlignment.status;
    return status === 'blocked' || authorityStatus === 'blocked' || (adapted.validation && adapted.validation.authorityStatus === 'blocked');
  });
}

function summarizeSignalAlignmentRun(runOrInput = {}) {
  const adaptedSignals = Array.isArray(runOrInput)
    ? sortAdaptedSignals(runOrInput)
    : sortAdaptedSignals(runOrInput.adaptedSignals);
  const alignments = extractAlignments(adaptedSignals);
  const adaptedSummary = summarizeAdaptedSignals(adaptedSignals);
  const alignmentSummary = summarizeAlignmentBatch(alignments);
  const registryLookupFailures = getRegistryLookupFailures(adaptedSignals);
  const blockedSignals = getBlockedSignals(adaptedSignals);

  return deepFreeze({
    schemaVersion: SIGNAL_ALIGNMENT_ENGINE_SCHEMA_VERSION,
    adaptedSignalCount: adaptedSignals.length,
    alignedSignalCount: alignments.filter((alignment) => alignment.alignmentStatus === 'aligned' || alignment.alignmentStatus === 'aligned_with_warnings').length,
    blockedSignalCount: blockedSignals.length,
    invalidSignalCount: adaptedSignals.filter((adapted) => adapted.validation && !adapted.validation.valid).length,
    registryLookupFailureCount: registryLookupFailures.length,
    producerSummary: buildCountSummary(adaptedSignals.map((adapted) => adapted.producer)),
    signalSummary: buildCountSummary(adaptedSignals.map((adapted) => adapted.signalName)),
    registryLookupSummary: clone(adaptedSummary.registryLookupSummary),
    alignmentStatusSummary: clone(alignmentSummary.statusSummary),
    authoritySummary: clone(alignmentSummary.authoritySummary),
    batchFingerprint: normalizeString(runOrInput.alignmentBatch && runOrInput.alignmentBatch.batchFingerprint),
    registryLookupFailures,
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  });
}

function buildSignalAlignmentRunFingerprint(run = {}) {
  const projection = clone(run);
  delete projection.runFingerprint;
  delete projection.signalAlignmentRunFingerprint;
  return buildFingerprintFromProjection(projection);
}

function buildRunValidation(run = {}) {
  const errors = [];
  const warnings = [];
  const authorityViolations = [];
  const registryLookupFailures = getRegistryLookupFailures(run.adaptedSignals);
  const missing = REQUIRED_SIGNAL_ALIGNMENT_RUN_FIELDS.filter((field) => {
    const value = run[field];
    return value === undefined || value === null || value === '';
  });
  const adaptedSignals = asArray(run.adaptedSignals);
  const alignmentBatch = run.alignmentBatch || {};
  const batchValidation = validateAlignmentBatch(alignmentBatch);

  for (const field of missing) errors.push(validationError('missing_required_field', `${field} is required.`, field));
  if (run.schemaVersion !== SIGNAL_ALIGNMENT_ENGINE_SCHEMA_VERSION) errors.push(validationError('invalid_schema_version', 'schemaVersion must match Signal Alignment Engine schema.', 'schemaVersion'));
  if (run.source !== SIGNAL_ALIGNMENT_ENGINE_SOURCE) errors.push(validationError('invalid_source', 'source must be signal_alignment_engine.', 'source'));
  for (const field of ['productionImpact', 'decisionImpact', 'executionAuthority']) {
    if (run[field] !== 'none') {
      errors.push(validationError(`invalid_${field.replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`)}`, `${field} must remain none.`, field));
      authorityViolations.push(field);
    }
  }
  if (!Array.isArray(run.adaptedSignals)) errors.push(validationError('invalid_adapted_signals', 'adaptedSignals must be an array.', 'adaptedSignals'));

  adaptedSignals.forEach((adapted, index) => {
    const validation = validateAdaptedSignal(adapted);
    if (!validation.valid) {
      errors.push(...validation.errors.map((error) => ({ ...error, field: `adaptedSignals.${index}.${error.field}` })));
    }
    warnings.push(...validation.warnings.map((warning) => ({ ...warning, field: `adaptedSignals.${index}.${warning.field}` })));
    if (validation.registryLookupStatus !== 'matched') {
      warnings.push(validationError('registry_lookup_failure', `Registry lookup status is ${validation.registryLookupStatus}.`, `adaptedSignals.${index}.registryLookupStatus`));
    }
    if (validation.authorityStatus === 'blocked') authorityViolations.push(`adaptedSignals.${index}.authorityStatus`);
  });

  if (!batchValidation.valid) {
    errors.push(...batchValidation.errors.map((error) => ({ ...error, field: `alignmentBatch.${error.field}` })));
  }
  warnings.push(...batchValidation.warnings.map((warning) => ({ ...warning, field: `alignmentBatch.${warning.field}` })));
  authorityViolations.push(...batchValidation.authorityViolations.map((field) => `alignmentBatch.${field}`));

  if (run.adaptedSignalCount !== adaptedSignals.length) errors.push(validationError('adapted_signal_count_mismatch', 'adaptedSignalCount must match adaptedSignals length.', 'adaptedSignalCount'));
  if (run.alignedSignalCount !== asArray(alignmentBatch.alignments).filter((alignment) => alignment.alignmentStatus === 'aligned' || alignment.alignmentStatus === 'aligned_with_warnings').length) {
    errors.push(validationError('aligned_signal_count_mismatch', 'alignedSignalCount must match aligned alignments.', 'alignedSignalCount'));
  }
  if (run.blockedSignalCount !== getBlockedSignals(adaptedSignals).length) errors.push(validationError('blocked_signal_count_mismatch', 'blockedSignalCount must match blocked adapted signals.', 'blockedSignalCount'));
  if (run.runFingerprint && buildSignalAlignmentRunFingerprint(run) !== run.runFingerprint) errors.push(validationError('run_fingerprint_mismatch', 'runFingerprint does not match run contents.', 'runFingerprint'));

  const reasonCodes = unique([...errors.map((error) => error.code), ...warnings.map((warning) => warning.code)]);
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes,
    adaptedSignalCount: adaptedSignals.length,
    alignedSignalCount: asArray(alignmentBatch.alignments).filter((alignment) => alignment.alignmentStatus === 'aligned' || alignment.alignmentStatus === 'aligned_with_warnings').length,
    blockedSignalCount: getBlockedSignals(adaptedSignals).length,
    authorityViolations: unique(authorityViolations).sort(),
    registryLookupFailures
  };
}

function finalizeRun(core = {}) {
  const runCore = {
    ...core,
    validation: buildRunValidation({ ...core, validation: {} })
  };
  return deepFreeze({
    ...runCore,
    runFingerprint: buildSignalAlignmentRunFingerprint(runCore)
  });
}

function normalizeNativeInputs(input = {}) {
  if (Array.isArray(input)) return input;
  return asArray(firstDefined(input.diagnostics, input.nativeOutputs, input.signals, []));
}

function runSignalAlignment(input = {}, options = {}) {
  const adapted = adaptDiagnosticSignal({
    ...asObject(input),
    nativeOutput: firstDefined(input.nativeOutput, input.diagnosticOutput, input.output, input),
    registry: firstDefined(input.registry, options.registry)
  }, options);
  const batch = createAlignmentBatch({
    alignmentBatchId: normalizeString(firstDefined(input.alignmentBatchId, options.alignmentBatchId, 'signal-alignment-batch')),
    createdAt: normalizeDate(firstDefined(input.createdAt, options.createdAt, UNKNOWN_VALUE)),
    adaptedSignals: [adapted]
  });
  const summary = summarizeSignalAlignmentRun({ adaptedSignals: [adapted], alignmentBatch: batch });
  const core = {
    schemaVersion: SIGNAL_ALIGNMENT_ENGINE_SCHEMA_VERSION,
    source: SIGNAL_ALIGNMENT_ENGINE_SOURCE,
    alignmentRunId: normalizeString(firstDefined(input.alignmentRunId, options.alignmentRunId, `signal-alignment-run:${adapted.sourceOutputFingerprint}`)),
    createdAt: normalizeDate(firstDefined(input.createdAt, options.createdAt, UNKNOWN_VALUE)),
    registryId: normalizeString(firstDefined(input.registryId, options.registryId, options.registry && options.registry.registryId, input.registry && input.registry.registryId)),
    registryFingerprint: normalizeString(firstDefined(input.registryFingerprint, options.registryFingerprint, options.registry && options.registry.registryFingerprint, input.registry && input.registry.registryFingerprint)),
    adaptedSignalCount: 1,
    alignedSignalCount: summary.alignedSignalCount,
    blockedSignalCount: summary.blockedSignalCount,
    adaptedSignals: [adapted],
    alignmentBatch: batch,
    summary,
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none',
    metadata: clone(asObject(input.metadata))
  };
  return finalizeRun(core);
}

function runSignalAlignmentBatch(input = {}, options = {}) {
  const nativeInputs = normalizeNativeInputs(input);
  const registry = firstDefined(input.registry, options.registry);
  const adaptationBatch = adaptSignalBatch(nativeInputs.map((item) => ({
    ...asObject(item),
    registry: firstDefined(item.registry, registry)
  })), {
    ...options,
    registry,
    adaptationBatchId: normalizeString(firstDefined(input.adaptationBatchId, options.adaptationBatchId, 'signal-alignment-adaptation-batch')),
    createdAt: normalizeDate(firstDefined(input.createdAt, options.createdAt, UNKNOWN_VALUE))
  });
  const adaptedSignals = sortAdaptedSignals(adaptationBatch.adaptedSignals);
  const alignmentBatch = createAlignmentBatch({
    alignmentBatchId: normalizeString(firstDefined(input.alignmentBatchId, options.alignmentBatchId, 'signal-alignment-batch')),
    createdAt: normalizeDate(firstDefined(input.createdAt, options.createdAt, UNKNOWN_VALUE)),
    adaptedSignals,
    metadata: { adaptationBatchFingerprint: adaptationBatch.adaptationFingerprint }
  });
  const summary = summarizeSignalAlignmentRun({ adaptedSignals, alignmentBatch });
  const core = {
    schemaVersion: SIGNAL_ALIGNMENT_ENGINE_SCHEMA_VERSION,
    source: SIGNAL_ALIGNMENT_ENGINE_SOURCE,
    alignmentRunId: normalizeString(firstDefined(input.alignmentRunId, options.alignmentRunId, 'signal-alignment-run')),
    createdAt: normalizeDate(firstDefined(input.createdAt, options.createdAt, UNKNOWN_VALUE)),
    registryId: normalizeString(firstDefined(input.registryId, options.registryId, registry && registry.registryId)),
    registryFingerprint: normalizeString(firstDefined(input.registryFingerprint, options.registryFingerprint, registry && registry.registryFingerprint)),
    adaptedSignalCount: adaptedSignals.length,
    alignedSignalCount: summary.alignedSignalCount,
    blockedSignalCount: summary.blockedSignalCount,
    adaptedSignals,
    alignmentBatch,
    summary,
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none',
    metadata: {
      adaptationBatchFingerprint: adaptationBatch.adaptationFingerprint,
      ...clone(asObject(input.metadata))
    }
  };
  return finalizeRun(core);
}

function validateSignalAlignmentRun(run = {}) {
  return buildRunValidation(run);
}

module.exports = {
  REQUIRED_SIGNAL_ALIGNMENT_RUN_FIELDS,
  SIGNAL_ALIGNMENT_ENGINE_SCHEMA_VERSION,
  SIGNAL_ALIGNMENT_ENGINE_SOURCE,
  buildSignalAlignmentRunFingerprint,
  runSignalAlignment,
  runSignalAlignmentBatch,
  summarizeSignalAlignmentRun,
  validateSignalAlignmentRun
};
