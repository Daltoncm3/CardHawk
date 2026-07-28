'use strict';

const { asArray, asObject, unique } = require('./canonicalValidationCore');
const { buildFingerprintFromProjection } = require('./fingerprintProjection');
const { clone, firstDefined } = require('./phase8GovernanceCore');
const { UNKNOWN_VALUE } = require('./canonicalIntelligenceSignalContract');
const {
  validateSignalAlignment,
  buildSignalAlignmentFingerprint
} = require('./signalAlignmentContract');
const {
  createAlignmentBatch,
  validateAlignmentBatch
} = require('./signalAlignmentBatch');
const {
  validateSignalAlignmentRun
} = require('./signalAlignmentEngine');

const SIGNAL_CONFLICT_ANALYSIS_SCHEMA_VERSION = '1.0.0';
const SIGNAL_CONFLICT_ANALYZER_SOURCE = 'signal_conflict_analyzer';

const RELATIONSHIP_TYPES = Object.freeze([
  'agreement',
  'contradiction',
  'supporting',
  'independent',
  'duplicate',
  'unknown'
]);

const REQUIRED_CONFLICT_ANALYSIS_FIELDS = Object.freeze([
  'schemaVersion',
  'source',
  'analysisId',
  'createdAt',
  'alignmentCount',
  'relationshipCount',
  'alignments',
  'relationships',
  'summary',
  'productionImpact',
  'decisionImpact',
  'executionAuthority',
  'analysisFingerprint'
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

function alignmentSortKey(alignment = {}) {
  const signal = asObject(alignment.canonicalSignal);
  return [
    signal.signalName,
    alignment.producer,
    alignment.producerVersion,
    alignment.sourceOutputFingerprint,
    signal.signalFingerprint,
    alignment.alignmentFingerprint
  ].map((field) => normalizeString(field)).join('|');
}

function sortAlignments(alignments = []) {
  return asArray(alignments)
    .map((alignment) => clone(alignment))
    .sort((left, right) => alignmentSortKey(left).localeCompare(alignmentSortKey(right)));
}

function normalizeInputAlignments(input = {}) {
  if (Array.isArray(input)) return sortAlignments(input);
  if (Array.isArray(input.alignments)) return sortAlignments(input.alignments);
  if (input.alignmentBatch && Array.isArray(input.alignmentBatch.alignments)) return sortAlignments(input.alignmentBatch.alignments);
  if (input.alignmentRun && input.alignmentRun.alignmentBatch) return sortAlignments(input.alignmentRun.alignmentBatch.alignments);
  if (input.alignmentRun && Array.isArray(input.alignmentRun.adaptedSignals)) {
    return sortAlignments(input.alignmentRun.adaptedSignals.map((adapted) => adapted.alignment).filter(Boolean));
  }
  return [];
}

function signalName(alignment = {}) {
  return normalizeString(asObject(alignment.canonicalSignal).signalName);
}

function signalFingerprint(alignment = {}) {
  return normalizeString(asObject(alignment.canonicalSignal).signalFingerprint);
}

function normalizedStatus(alignment = {}) {
  return normalizeString(asObject(asObject(alignment.canonicalSignal).normalizedOutput).status);
}

function normalizedUncertainty(alignment = {}) {
  return normalizeString(asObject(asObject(alignment.canonicalSignal).normalizedOutput).uncertainty);
}

function hasUsableCanonicalSignal(alignment = {}) {
  if (['blocked', 'definition_missing', 'version_mismatch', 'incomplete', 'invalid'].includes(alignment.alignmentStatus)) return false;
  return known(alignment.canonicalSignal)
    && alignment.canonicalSignal !== UNKNOWN_VALUE
    && known(asObject(alignment.canonicalSignal).signalName)
    && asObject(alignment.canonicalSignal).signalName !== UNKNOWN_VALUE;
}

function referenceKeys(alignment = {}) {
  const signal = asObject(alignment.canonicalSignal);
  return unique([
    alignment.alignmentId,
    alignment.alignmentFingerprint,
    alignment.sourceOutputFingerprint,
    signal.signalId,
    signal.signalName,
    signal.signalFingerprint,
    signal.sourceFingerprint
  ].map((value) => normalizeString(value, '')).filter(Boolean)).sort();
}

function flattenReferences(values = []) {
  const references = [];
  for (const value of asArray(values)) {
    if (typeof value === 'string') {
      references.push(value);
    } else if (value && typeof value === 'object') {
      references.push(
        value.signalId,
        value.signalName,
        value.signalFingerprint,
        value.alignmentId,
        value.alignmentFingerprint,
        value.sourceOutputFingerprint,
        value.sourceFingerprint,
        value.fingerprint
      );
    }
  }
  return unique(references.map((value) => normalizeString(value, '')).filter(Boolean)).sort();
}

function supportingReferences(alignment = {}) {
  const signal = asObject(alignment.canonicalSignal);
  const summary = asObject(alignment.relationshipSummary);
  return unique([
    ...flattenReferences(signal.supportingSignals),
    ...flattenReferences(summary.supportingSignals)
  ]).sort();
}

function referencesAlignment(source = {}, target = {}) {
  const targetKeys = new Set(referenceKeys(target));
  return supportingReferences(source).some((reference) => targetKeys.has(reference));
}

function relationshipId(left = {}, right = {}) {
  return [
    normalizeString(left.alignmentFingerprint, alignmentSortKey(left)),
    normalizeString(right.alignmentFingerprint, alignmentSortKey(right))
  ].sort().join('::');
}

function classifySignalRelationship(left = {}, right = {}) {
  const leftAlignment = asObject(left);
  const rightAlignment = asObject(right);
  if (!hasUsableCanonicalSignal(leftAlignment) || !hasUsableCanonicalSignal(rightAlignment)) return 'unknown';
  if (
    normalizeString(leftAlignment.alignmentFingerprint) === normalizeString(rightAlignment.alignmentFingerprint)
    || (
      signalName(leftAlignment) === signalName(rightAlignment)
      && signalFingerprint(leftAlignment) === signalFingerprint(rightAlignment)
      && normalizeString(leftAlignment.sourceOutputFingerprint) === normalizeString(rightAlignment.sourceOutputFingerprint)
    )
  ) {
    return 'duplicate';
  }
  if (referencesAlignment(leftAlignment, rightAlignment) || referencesAlignment(rightAlignment, leftAlignment)) return 'supporting';
  if (signalName(leftAlignment) === signalName(rightAlignment)) {
    if (
      normalizedStatus(leftAlignment) !== UNKNOWN_VALUE
      && normalizedStatus(rightAlignment) !== UNKNOWN_VALUE
      && normalizedStatus(leftAlignment) === normalizedStatus(rightAlignment)
      && normalizedUncertainty(leftAlignment) === normalizedUncertainty(rightAlignment)
    ) {
      return 'agreement';
    }
    if (
      normalizedStatus(leftAlignment) !== UNKNOWN_VALUE
      && normalizedStatus(rightAlignment) !== UNKNOWN_VALUE
      && normalizedStatus(leftAlignment) !== normalizedStatus(rightAlignment)
    ) {
      return 'contradiction';
    }
    return 'unknown';
  }
  return 'independent';
}

function buildRelationship(left = {}, right = {}) {
  const type = classifySignalRelationship(left, right);
  const core = {
    relationshipId: relationshipId(left, right),
    relationshipType: type,
    leftAlignmentFingerprint: normalizeString(left.alignmentFingerprint),
    rightAlignmentFingerprint: normalizeString(right.alignmentFingerprint),
    leftSignalName: signalName(left),
    rightSignalName: signalName(right),
    leftStatus: normalizedStatus(left),
    rightStatus: normalizedStatus(right),
    evidenceOnly: true,
    resolution: 'not_attempted'
  };
  return {
    ...core,
    relationshipFingerprint: buildFingerprintFromProjection(core)
  };
}

function buildRelationships(alignments = []) {
  const sorted = sortAlignments(alignments);
  const relationships = [];
  for (let leftIndex = 0; leftIndex < sorted.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < sorted.length; rightIndex += 1) {
      relationships.push(buildRelationship(sorted[leftIndex], sorted[rightIndex]));
    }
  }
  return relationships.sort((left, right) => [
    left.relationshipType,
    left.leftSignalName,
    left.rightSignalName,
    left.relationshipId
  ].map((field) => normalizeString(field)).join('|').localeCompare([
    right.relationshipType,
    right.leftSignalName,
    right.rightSignalName,
    right.relationshipId
  ].map((field) => normalizeString(field)).join('|')));
}

function summarizeSignalConflicts(analysisOrRelationships = {}) {
  const relationships = Array.isArray(analysisOrRelationships)
    ? asArray(analysisOrRelationships)
    : asArray(analysisOrRelationships.relationships);
  const duplicateRelationships = relationships.filter((relationship) => relationship.relationshipType === 'duplicate');
  const unknownRelationships = relationships.filter((relationship) => relationship.relationshipType === 'unknown');
  return deepFreeze({
    schemaVersion: SIGNAL_CONFLICT_ANALYSIS_SCHEMA_VERSION,
    relationshipCount: relationships.length,
    relationshipSummary: buildCountSummary(relationships.map((relationship) => relationship.relationshipType)),
    duplicateRelationshipCount: duplicateRelationships.length,
    unknownRelationshipCount: unknownRelationships.length,
    contradictionCount: relationships.filter((relationship) => relationship.relationshipType === 'contradiction').length,
    supportingRelationshipCount: relationships.filter((relationship) => relationship.relationshipType === 'supporting').length,
    resolutionPolicy: 'not_attempted',
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  });
}

function buildConflictAnalysisFingerprint(analysis = {}) {
  const projection = clone(analysis);
  delete projection.analysisFingerprint;
  delete projection.conflictAnalysisFingerprint;
  return buildFingerprintFromProjection(projection);
}

function analyzeSignalConflicts(input = {}, options = {}) {
  const alignments = sortAlignments(normalizeInputAlignments(input));
  const relationships = buildRelationships(alignments);
  const summary = summarizeSignalConflicts(relationships);
  const alignmentBatch = createAlignmentBatch({
    alignmentBatchId: normalizeString(firstDefined(input.alignmentBatchId, options.alignmentBatchId, 'signal-conflict-analysis-batch')),
    createdAt: normalizeDate(firstDefined(input.createdAt, options.createdAt, UNKNOWN_VALUE)),
    alignments
  });
  const core = {
    schemaVersion: SIGNAL_CONFLICT_ANALYSIS_SCHEMA_VERSION,
    source: SIGNAL_CONFLICT_ANALYZER_SOURCE,
    analysisId: normalizeString(firstDefined(input.analysisId, options.analysisId, 'signal-conflict-analysis')),
    createdAt: normalizeDate(firstDefined(input.createdAt, options.createdAt, UNKNOWN_VALUE)),
    alignmentCount: alignments.length,
    relationshipCount: relationships.length,
    alignments,
    relationships,
    alignmentBatch,
    summary,
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none',
    metadata: clone(asObject(input.metadata))
  };
  const prevalidated = {
    ...core,
    analysisFingerprint: buildConflictAnalysisFingerprint(core)
  };
  const withValidation = {
    ...core,
    validation: validateConflictAnalysis(prevalidated)
  };
  return deepFreeze({
    ...withValidation,
    analysisFingerprint: buildConflictAnalysisFingerprint(withValidation)
  });
}

function validateAuthority(analysis = {}, errors, authorityViolations) {
  for (const field of ['productionImpact', 'decisionImpact', 'executionAuthority']) {
    if (analysis[field] !== 'none') {
      errors.push(validationError(`invalid_${field.replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`)}`, `${field} must remain none.`, field));
      authorityViolations.push(field);
    }
  }
}

function validateConflictAnalysis(analysis = {}) {
  const errors = [];
  const warnings = [];
  const authorityViolations = [];
  const missing = REQUIRED_CONFLICT_ANALYSIS_FIELDS.filter((field) => {
    const value = analysis[field];
    return value === undefined || value === null || value === '';
  });
  const alignments = asArray(analysis.alignments);
  const relationships = asArray(analysis.relationships);

  for (const field of missing) errors.push(validationError('missing_required_field', `${field} is required.`, field));
  if (analysis.schemaVersion !== SIGNAL_CONFLICT_ANALYSIS_SCHEMA_VERSION) errors.push(validationError('invalid_schema_version', 'schemaVersion must match Signal Conflict Analysis schema.', 'schemaVersion'));
  if (analysis.source !== SIGNAL_CONFLICT_ANALYZER_SOURCE) errors.push(validationError('invalid_source', 'source must be signal_conflict_analyzer.', 'source'));
  if (!Array.isArray(analysis.alignments)) errors.push(validationError('invalid_alignments', 'alignments must be an array.', 'alignments'));
  if (!Array.isArray(analysis.relationships)) errors.push(validationError('invalid_relationships', 'relationships must be an array.', 'relationships'));
  if (analysis.alignmentCount !== alignments.length) errors.push(validationError('alignment_count_mismatch', 'alignmentCount must match alignments length.', 'alignmentCount'));
  if (analysis.relationshipCount !== relationships.length) errors.push(validationError('relationship_count_mismatch', 'relationshipCount must match relationships length.', 'relationshipCount'));

  validateAuthority(analysis, errors, authorityViolations);

  alignments.forEach((alignment, index) => {
    const validation = validateSignalAlignment(alignment);
    if (!validation.valid) {
      errors.push(...validation.errors.map((error) => ({ ...error, field: `alignments.${index}.${error.field}` })));
    }
    warnings.push(...validation.warnings.map((warning) => ({ ...warning, field: `alignments.${index}.${warning.field}` })));
    authorityViolations.push(...validation.authorityViolations.map((field) => `alignments.${index}.${field}`));
    if (alignment.alignmentFingerprint && buildSignalAlignmentFingerprint(alignment) !== alignment.alignmentFingerprint) {
      errors.push(validationError('alignment_fingerprint_mismatch', 'alignmentFingerprint does not match alignment contents.', `alignments.${index}.alignmentFingerprint`));
    }
  });

  const batchValidation = analysis.alignmentBatch ? validateAlignmentBatch(analysis.alignmentBatch) : { valid: true, errors: [], warnings: [], authorityViolations: [] };
  if (!batchValidation.valid) errors.push(...batchValidation.errors.map((error) => ({ ...error, field: `alignmentBatch.${error.field}` })));
  warnings.push(...batchValidation.warnings.map((warning) => ({ ...warning, field: `alignmentBatch.${warning.field}` })));
  authorityViolations.push(...batchValidation.authorityViolations.map((field) => `alignmentBatch.${field}`));

  if (analysis.alignmentRun) {
    const runValidation = validateSignalAlignmentRun(analysis.alignmentRun);
    if (!runValidation.valid) errors.push(...runValidation.errors.map((error) => ({ ...error, field: `alignmentRun.${error.field}` })));
    warnings.push(...runValidation.warnings.map((warning) => ({ ...warning, field: `alignmentRun.${warning.field}` })));
    authorityViolations.push(...runValidation.authorityViolations.map((field) => `alignmentRun.${field}`));
  }

  const relationshipIds = new Set();
  const duplicateRelationships = [];
  const unknownRelationships = [];
  relationships.forEach((relationship, index) => {
    if (!RELATIONSHIP_TYPES.includes(relationship.relationshipType)) {
      errors.push(validationError('invalid_relationship_type', `relationshipType must be one of: ${RELATIONSHIP_TYPES.join(', ')}`, `relationships.${index}.relationshipType`));
    }
    if (relationshipIds.has(relationship.relationshipId)) duplicateRelationships.push(relationship.relationshipId);
    relationshipIds.add(relationship.relationshipId);
    if (relationship.relationshipType === 'unknown') unknownRelationships.push(relationship.relationshipId);
  });

  if (analysis.analysisFingerprint && buildConflictAnalysisFingerprint(analysis) !== analysis.analysisFingerprint) {
    errors.push(validationError('analysis_fingerprint_mismatch', 'analysisFingerprint does not match analysis contents.', 'analysisFingerprint'));
  }

  const reasonCodes = unique([...errors.map((error) => error.code), ...warnings.map((warning) => warning.code)]);
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes,
    relationshipSummary: clone(analysis.summary && analysis.summary.relationshipSummary),
    duplicateRelationships: unique(duplicateRelationships).sort(),
    unknownRelationships: unique(unknownRelationships).sort(),
    authorityViolations: unique(authorityViolations).sort()
  };
}

module.exports = {
  RELATIONSHIP_TYPES,
  REQUIRED_CONFLICT_ANALYSIS_FIELDS,
  SIGNAL_CONFLICT_ANALYSIS_SCHEMA_VERSION,
  SIGNAL_CONFLICT_ANALYZER_SOURCE,
  analyzeSignalConflicts,
  buildConflictAnalysisFingerprint,
  classifySignalRelationship,
  summarizeSignalConflicts,
  validateConflictAnalysis
};
