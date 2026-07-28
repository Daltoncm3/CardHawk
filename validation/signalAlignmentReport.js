'use strict';

const { asArray, asObject, unique } = require('./canonicalValidationCore');
const { buildFingerprintFromProjection } = require('./fingerprintProjection');
const { clone, firstDefined } = require('./phase8GovernanceCore');
const { UNKNOWN_VALUE } = require('./canonicalIntelligenceSignalContract');
const {
  validateSignalAlignmentRun,
  summarizeSignalAlignmentRun,
  buildSignalAlignmentRunFingerprint
} = require('./signalAlignmentEngine');
const {
  createAlignmentBatch,
  validateAlignmentBatch,
  summarizeAlignmentBatch,
  buildAlignmentBatchFingerprint
} = require('./signalAlignmentBatch');
const {
  analyzeSignalConflicts,
  validateConflictAnalysis,
  summarizeSignalConflicts,
  buildConflictAnalysisFingerprint
} = require('./signalConflictAnalyzer');

const SIGNAL_ALIGNMENT_REPORT_SCHEMA_VERSION = '1.0.0';
const SIGNAL_ALIGNMENT_REPORT_SOURCE = 'signal_alignment_report';

const REVIEW_STATUSES = Object.freeze([
  'unreviewed',
  'review_pending',
  'reviewed',
  'needs_follow_up',
  'invalid'
]);

const REQUIRED_SIGNAL_ALIGNMENT_REPORT_FIELDS = Object.freeze([
  'schemaVersion',
  'source',
  'reportId',
  'createdAt',
  'alignmentRunId',
  'alignmentRunFingerprint',
  'registryId',
  'registryFingerprint',
  'alignmentSummary',
  'validationSummary',
  'conflictSummary',
  'alignments',
  'relationships',
  'missingDefinitions',
  'versionMismatches',
  'blockedAlignments',
  'unknownRelationships',
  'warnings',
  'errors',
  'reviewStatus',
  'reviewerNotes',
  'productionImpact',
  'decisionImpact',
  'executionAuthority',
  'reportFingerprint'
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

function normalizeReviewStatus(value) {
  const status = normalizeString(value, 'unreviewed');
  return REVIEW_STATUSES.includes(status) ? status : status;
}

function resolvePath(source = {}, path = '') {
  return String(path).split('.').reduce((current, part) => {
    if (!current || typeof current !== 'object') return undefined;
    return current[part];
  }, source);
}

function alignmentSortKey(alignment = {}) {
  return [
    alignment.canonicalSignal && alignment.canonicalSignal.signalName,
    alignment.producer,
    alignment.producerVersion,
    alignment.sourceOutputFingerprint,
    alignment.alignmentFingerprint
  ].map((field) => normalizeString(field)).join('|');
}

function sortAlignments(alignments = [], sortBy = '') {
  const sorted = asArray(alignments).map((alignment) => clone(alignment));
  return sorted.sort((left, right) => {
    if (known(sortBy)) {
      const primary = normalizeString(resolvePath(left, sortBy)).localeCompare(normalizeString(resolvePath(right, sortBy)));
      if (primary) return primary;
    }
    return alignmentSortKey(left).localeCompare(alignmentSortKey(right));
  });
}

function relationshipSortKey(relationship = {}) {
  return [
    relationship.relationshipType,
    relationship.leftSignalName,
    relationship.rightSignalName,
    relationship.relationshipId,
    relationship.relationshipFingerprint
  ].map((field) => normalizeString(field)).join('|');
}

function sortRelationships(relationships = [], sortBy = '') {
  const sorted = asArray(relationships).map((relationship) => clone(relationship));
  return sorted.sort((left, right) => {
    if (known(sortBy)) {
      const primary = normalizeString(resolvePath(left, sortBy)).localeCompare(normalizeString(resolvePath(right, sortBy)));
      if (primary) return primary;
    }
    return relationshipSortKey(left).localeCompare(relationshipSortKey(right));
  });
}

function extractAlignmentRun(input = {}) {
  return firstDefined(input.alignmentRun, input.run, null);
}

function extractAlignmentBatch(input = {}, alignmentRun = null) {
  return firstDefined(input.alignmentBatch, input.batch, alignmentRun && alignmentRun.alignmentBatch, null);
}

function extractAlignments(input = {}, alignmentBatch = null, alignmentRun = null) {
  if (Array.isArray(input.alignments)) return sortAlignments(input.alignments);
  if (alignmentBatch && Array.isArray(alignmentBatch.alignments)) return sortAlignments(alignmentBatch.alignments);
  if (alignmentRun && alignmentRun.alignmentBatch && Array.isArray(alignmentRun.alignmentBatch.alignments)) {
    return sortAlignments(alignmentRun.alignmentBatch.alignments);
  }
  return [];
}

function extractConflictAnalysis(input = {}, alignments = [], options = {}) {
  const analysis = firstDefined(input.conflictAnalysis, input.analysis, null);
  if (analysis) return clone(analysis);
  return analyzeSignalConflicts({
    analysisId: normalizeString(firstDefined(input.conflictAnalysisId, options.conflictAnalysisId, 'signal-alignment-report-conflicts')),
    createdAt: normalizeDate(firstDefined(input.createdAt, options.createdAt, UNKNOWN_VALUE)),
    alignments
  });
}

function extractMissingDefinitions(alignmentRun = null, alignments = []) {
  const fromRun = asArray(alignmentRun && alignmentRun.validation && alignmentRun.validation.registryLookupFailures)
    .filter((failure) => failure.registryLookupStatus === 'definition_missing');
  const fromAlignments = asArray(alignments)
    .filter((alignment) => alignment.alignmentStatus === 'definition_missing')
    .map((alignment) => ({
      producer: normalizeString(alignment.producer),
      signalName: normalizeString(alignment.canonicalSignal && alignment.canonicalSignal.signalName),
      registryLookupStatus: 'definition_missing',
      sourceOutputFingerprint: normalizeString(alignment.sourceOutputFingerprint)
    }));
  return unique([...fromRun, ...fromAlignments].map((item) => JSON.stringify(item))).sort().map((item) => JSON.parse(item));
}

function extractVersionMismatches(alignmentRun = null, alignments = []) {
  const fromRun = asArray(alignmentRun && alignmentRun.validation && alignmentRun.validation.registryLookupFailures)
    .filter((failure) => failure.registryLookupStatus === 'version_mismatch');
  const fromAlignments = asArray(alignments)
    .filter((alignment) => alignment.alignmentStatus === 'version_mismatch')
    .map((alignment) => ({
      producer: normalizeString(alignment.producer),
      signalName: normalizeString(alignment.canonicalSignal && alignment.canonicalSignal.signalName),
      registryLookupStatus: 'version_mismatch',
      sourceOutputFingerprint: normalizeString(alignment.sourceOutputFingerprint)
    }));
  return unique([...fromRun, ...fromAlignments].map((item) => JSON.stringify(item))).sort().map((item) => JSON.parse(item));
}

function extractBlockedAlignments(alignments = []) {
  return sortAlignments(asArray(alignments).filter((alignment) => {
    const authorityStatus = alignment.authorityAlignment && alignment.authorityAlignment.status;
    return alignment.alignmentStatus === 'blocked' || authorityStatus === 'blocked';
  })).map((alignment) => ({
    alignmentId: normalizeString(alignment.alignmentId),
    alignmentFingerprint: normalizeString(alignment.alignmentFingerprint),
    signalName: normalizeString(alignment.canonicalSignal && alignment.canonicalSignal.signalName),
    producer: normalizeString(alignment.producer),
    alignmentStatus: normalizeString(alignment.alignmentStatus),
    authorityStatus: normalizeString(alignment.authorityAlignment && alignment.authorityAlignment.status)
  }));
}

function extractUnknownRelationships(relationships = []) {
  return sortRelationships(asArray(relationships).filter((relationship) => relationship.relationshipType === 'unknown'));
}

function buildValidationSummary(runValidation = {}, batchValidation = {}, conflictValidation = {}) {
  const errors = [
    ...asArray(runValidation.errors).map((error) => ({ ...error, source: 'alignmentRun' })),
    ...asArray(batchValidation.errors).map((error) => ({ ...error, source: 'alignmentBatch' })),
    ...asArray(conflictValidation.errors).map((error) => ({ ...error, source: 'conflictAnalysis' }))
  ];
  const warnings = [
    ...asArray(runValidation.warnings).map((warning) => ({ ...warning, source: 'alignmentRun' })),
    ...asArray(batchValidation.warnings).map((warning) => ({ ...warning, source: 'alignmentBatch' })),
    ...asArray(conflictValidation.warnings).map((warning) => ({ ...warning, source: 'conflictAnalysis' }))
  ];
  return {
    valid: errors.length === 0,
    errorCount: errors.length,
    warningCount: warnings.length,
    reasonCodes: unique([
      ...errors.map((error) => error.code),
      ...warnings.map((warning) => warning.code)
    ]).sort(),
    errors,
    warnings,
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
}

function summarizeSignalAlignmentReport(report = {}) {
  const alignments = asArray(report.alignments);
  const relationships = asArray(report.relationships);
  return deepFreeze({
    schemaVersion: SIGNAL_ALIGNMENT_REPORT_SCHEMA_VERSION,
    alignmentCount: alignments.length,
    relationshipCount: relationships.length,
    missingDefinitionCount: asArray(report.missingDefinitions).length,
    versionMismatchCount: asArray(report.versionMismatches).length,
    blockedAlignmentCount: asArray(report.blockedAlignments).length,
    unknownRelationshipCount: asArray(report.unknownRelationships).length,
    warningCount: asArray(report.warnings).length,
    errorCount: asArray(report.errors).length,
    reviewStatus: normalizeReviewStatus(report.reviewStatus),
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  });
}

function buildSignalAlignmentReportFingerprint(report = {}) {
  const projection = clone(report);
  delete projection.reportFingerprint;
  delete projection.signalAlignmentReportFingerprint;
  return buildFingerprintFromProjection(projection);
}

function createSignalAlignmentReport(input = {}, options = {}) {
  const alignmentRun = extractAlignmentRun(input);
  const sourceAlignmentBatch = extractAlignmentBatch(input, alignmentRun);
  const alignments = extractAlignments(input, sourceAlignmentBatch, alignmentRun);
  const alignmentBatch = sourceAlignmentBatch
    ? clone(sourceAlignmentBatch)
    : createAlignmentBatch({
        alignmentBatchId: normalizeString(firstDefined(input.alignmentBatchId, options.alignmentBatchId, 'signal-alignment-report-batch')),
        createdAt: normalizeDate(firstDefined(input.createdAt, options.createdAt, UNKNOWN_VALUE)),
        alignments
      });
  const conflictAnalysis = extractConflictAnalysis(input, alignments, options);
  const relationships = sortRelationships(firstDefined(input.relationships, conflictAnalysis.relationships, []));
  const runValidation = alignmentRun ? validateSignalAlignmentRun(alignmentRun) : { valid: true, errors: [], warnings: [], reasonCodes: [], registryLookupFailures: [] };
  const batchValidation = validateAlignmentBatch(alignmentBatch);
  const conflictValidation = validateConflictAnalysis(conflictAnalysis);
  const alignmentSummary = alignmentRun
    ? summarizeSignalAlignmentRun(alignmentRun)
    : summarizeAlignmentBatch(alignmentBatch);
  const conflictSummary = summarizeSignalConflicts(relationships);
  const validationSummary = buildValidationSummary(runValidation, batchValidation, conflictValidation);
  const warnings = unique([
    ...asArray(validationSummary.warnings).map((warning) => warning.code),
    ...asArray(input.warnings).map((warning) => normalizeString(warning, '')).filter(Boolean)
  ]).sort();
  const errors = unique([
    ...asArray(validationSummary.errors).map((error) => error.code),
    ...asArray(input.errors).map((error) => normalizeString(error, '')).filter(Boolean)
  ]).sort();
  const core = {
    schemaVersion: SIGNAL_ALIGNMENT_REPORT_SCHEMA_VERSION,
    source: SIGNAL_ALIGNMENT_REPORT_SOURCE,
    reportId: normalizeString(firstDefined(input.reportId, options.reportId, 'signal-alignment-report')),
    createdAt: normalizeDate(firstDefined(input.createdAt, options.createdAt, UNKNOWN_VALUE)),
    alignmentRunId: normalizeString(alignmentRun && alignmentRun.alignmentRunId),
    alignmentRunFingerprint: normalizeString(alignmentRun && alignmentRun.runFingerprint),
    registryId: normalizeString(firstDefined(input.registryId, alignmentRun && alignmentRun.registryId, alignmentBatch.registryId)),
    registryFingerprint: normalizeString(firstDefined(input.registryFingerprint, alignmentRun && alignmentRun.registryFingerprint, alignmentBatch.registryFingerprint)),
    alignmentSummary,
    validationSummary,
    conflictSummary,
    alignments,
    relationships,
    missingDefinitions: extractMissingDefinitions(alignmentRun, alignments),
    versionMismatches: extractVersionMismatches(alignmentRun, alignments),
    blockedAlignments: extractBlockedAlignments(alignments),
    unknownRelationships: extractUnknownRelationships(relationships),
    warnings,
    errors,
    reviewStatus: normalizeReviewStatus(firstDefined(input.reviewStatus, options.reviewStatus, 'unreviewed')),
    reviewerNotes: clone(asArray(firstDefined(input.reviewerNotes, options.reviewerNotes, []))),
    sourceArtifacts: {
      alignmentRun: clone(alignmentRun || UNKNOWN_VALUE),
      alignmentBatch: clone(alignmentBatch),
      conflictAnalysis: clone(conflictAnalysis)
    },
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none',
    metadata: clone(asObject(input.metadata))
  };
  const prevalidated = {
    ...core,
    reportFingerprint: buildSignalAlignmentReportFingerprint(core)
  };
  const withValidation = {
    ...core,
    reportValidation: validateSignalAlignmentReport(prevalidated)
  };
  return deepFreeze({
    ...withValidation,
    reportFingerprint: buildSignalAlignmentReportFingerprint(withValidation)
  });
}

function validateAuthority(report = {}, errors, authorityViolations) {
  for (const field of ['productionImpact', 'decisionImpact', 'executionAuthority']) {
    if (report[field] !== 'none') {
      errors.push(validationError(`invalid_${field.replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`)}`, `${field} must remain none.`, field));
      authorityViolations.push(field);
    }
  }
}

function validateSignalAlignmentReport(report = {}) {
  const errors = [];
  const warnings = [];
  const authorityViolations = [];
  const fingerprintViolations = [];
  const sourceReferenceViolations = [];
  const reviewStatusViolations = [];
  const missing = REQUIRED_SIGNAL_ALIGNMENT_REPORT_FIELDS.filter((field) => {
    const value = report[field];
    return value === undefined || value === null || value === '';
  });

  for (const field of missing) errors.push(validationError('missing_required_field', `${field} is required.`, field));
  if (report.schemaVersion !== SIGNAL_ALIGNMENT_REPORT_SCHEMA_VERSION) errors.push(validationError('invalid_schema_version', 'schemaVersion must match Signal Alignment Report schema.', 'schemaVersion'));
  if (report.source !== SIGNAL_ALIGNMENT_REPORT_SOURCE) errors.push(validationError('invalid_source', 'source must be signal_alignment_report.', 'source'));
  if (!Array.isArray(report.alignments)) errors.push(validationError('invalid_alignments', 'alignments must be an array.', 'alignments'));
  if (!Array.isArray(report.relationships)) errors.push(validationError('invalid_relationships', 'relationships must be an array.', 'relationships'));
  if (!Array.isArray(report.reviewerNotes)) errors.push(validationError('invalid_reviewer_notes', 'reviewerNotes must be an array.', 'reviewerNotes'));
  if (!REVIEW_STATUSES.includes(report.reviewStatus)) {
    errors.push(validationError('invalid_review_status', `reviewStatus must be one of: ${REVIEW_STATUSES.join(', ')}`, 'reviewStatus'));
    reviewStatusViolations.push('reviewStatus');
  }

  validateAuthority(report, errors, authorityViolations);

  const sourceArtifacts = asObject(report.sourceArtifacts);
  if (sourceArtifacts.alignmentRun && sourceArtifacts.alignmentRun !== UNKNOWN_VALUE) {
    const runValidation = validateSignalAlignmentRun(sourceArtifacts.alignmentRun);
    if (!runValidation.valid) errors.push(...runValidation.errors.map((error) => ({ ...error, field: `sourceArtifacts.alignmentRun.${error.field}` })));
    warnings.push(...runValidation.warnings.map((warning) => ({ ...warning, field: `sourceArtifacts.alignmentRun.${warning.field}` })));
    authorityViolations.push(...runValidation.authorityViolations.map((field) => `sourceArtifacts.alignmentRun.${field}`));
    if (report.alignmentRunId !== sourceArtifacts.alignmentRun.alignmentRunId) {
      errors.push(validationError('alignment_run_id_mismatch', 'alignmentRunId does not match source alignment run.', 'alignmentRunId'));
      sourceReferenceViolations.push('alignmentRunId');
    }
    if (report.alignmentRunFingerprint !== sourceArtifacts.alignmentRun.runFingerprint) {
      errors.push(validationError('alignment_run_fingerprint_mismatch', 'alignmentRunFingerprint does not match source alignment run.', 'alignmentRunFingerprint'));
      sourceReferenceViolations.push('alignmentRunFingerprint');
    }
    if (sourceArtifacts.alignmentRun.runFingerprint && buildSignalAlignmentRunFingerprint(sourceArtifacts.alignmentRun) !== sourceArtifacts.alignmentRun.runFingerprint) {
      fingerprintViolations.push('sourceArtifacts.alignmentRun.runFingerprint');
    }
  }

  if (sourceArtifacts.alignmentBatch && sourceArtifacts.alignmentBatch !== UNKNOWN_VALUE) {
    const batchValidation = validateAlignmentBatch(sourceArtifacts.alignmentBatch);
    if (!batchValidation.valid) errors.push(...batchValidation.errors.map((error) => ({ ...error, field: `sourceArtifacts.alignmentBatch.${error.field}` })));
    warnings.push(...batchValidation.warnings.map((warning) => ({ ...warning, field: `sourceArtifacts.alignmentBatch.${warning.field}` })));
    authorityViolations.push(...batchValidation.authorityViolations.map((field) => `sourceArtifacts.alignmentBatch.${field}`));
    if (sourceArtifacts.alignmentBatch.batchFingerprint && buildAlignmentBatchFingerprint(sourceArtifacts.alignmentBatch) !== sourceArtifacts.alignmentBatch.batchFingerprint) {
      fingerprintViolations.push('sourceArtifacts.alignmentBatch.batchFingerprint');
    }
  }

  if (sourceArtifacts.conflictAnalysis && sourceArtifacts.conflictAnalysis !== UNKNOWN_VALUE) {
    const conflictValidation = validateConflictAnalysis(sourceArtifacts.conflictAnalysis);
    if (!conflictValidation.valid) errors.push(...conflictValidation.errors.map((error) => ({ ...error, field: `sourceArtifacts.conflictAnalysis.${error.field}` })));
    warnings.push(...conflictValidation.warnings.map((warning) => ({ ...warning, field: `sourceArtifacts.conflictAnalysis.${warning.field}` })));
    authorityViolations.push(...conflictValidation.authorityViolations.map((field) => `sourceArtifacts.conflictAnalysis.${field}`));
    if (sourceArtifacts.conflictAnalysis.analysisFingerprint && buildConflictAnalysisFingerprint(sourceArtifacts.conflictAnalysis) !== sourceArtifacts.conflictAnalysis.analysisFingerprint) {
      fingerprintViolations.push('sourceArtifacts.conflictAnalysis.analysisFingerprint');
    }
  }

  if (report.reportFingerprint && buildSignalAlignmentReportFingerprint(report) !== report.reportFingerprint) {
    errors.push(validationError('report_fingerprint_mismatch', 'reportFingerprint does not match report contents.', 'reportFingerprint'));
    fingerprintViolations.push('reportFingerprint');
  }

  const reasonCodes = unique([...errors.map((error) => error.code), ...warnings.map((warning) => warning.code)]);
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes,
    missingRequiredFields: unique(missing).sort(),
    authorityViolations: unique(authorityViolations).sort(),
    fingerprintViolations: unique(fingerprintViolations).sort(),
    sourceReferenceViolations: unique(sourceReferenceViolations).sort(),
    reviewStatusViolations: unique(reviewStatusViolations).sort()
  };
}

function rebuildReport(report = {}, overrides = {}) {
  return createSignalAlignmentReport({
    ...clone(report),
    ...clone(overrides),
    alignmentRun: report.sourceArtifacts && report.sourceArtifacts.alignmentRun !== UNKNOWN_VALUE ? report.sourceArtifacts.alignmentRun : null,
    alignmentBatch: report.sourceArtifacts && report.sourceArtifacts.alignmentBatch ? report.sourceArtifacts.alignmentBatch : null,
    conflictAnalysis: report.sourceArtifacts && report.sourceArtifacts.conflictAnalysis ? report.sourceArtifacts.conflictAnalysis : null
  });
}

function filterSignalAlignmentReport(report = {}, filters = {}) {
  const input = asObject(filters);
  const alignments = sortAlignments(report.alignments).filter((alignment) => {
    if (known(input.producer) && alignment.producer !== input.producer) return false;
    if (known(input.alignmentStatus) && alignment.alignmentStatus !== input.alignmentStatus) return false;
    if (known(input.signalName) && normalizeString(alignment.canonicalSignal && alignment.canonicalSignal.signalName) !== input.signalName) return false;
    return true;
  });
  const retained = new Set(alignments.map((alignment) => alignment.alignmentFingerprint));
  const relationships = sortRelationships(report.relationships).filter((relationship) => (
    retained.has(relationship.leftAlignmentFingerprint) && retained.has(relationship.rightAlignmentFingerprint)
  ));
  return rebuildReport(report, { alignments, relationships });
}

function sortSignalAlignmentReport(report = {}, sortBy = 'canonicalSignal.signalName') {
  return rebuildReport(report, {
    alignments: sortAlignments(report.alignments, sortBy),
    relationships: sortRelationships(report.relationships)
  });
}

function exportSignalAlignmentReport(report = {}) {
  return JSON.stringify(report, null, 2);
}

function importSignalAlignmentReport(serialized) {
  const parsed = typeof serialized === 'string' ? JSON.parse(serialized) : clone(serialized);
  return deepFreeze(parsed);
}

module.exports = {
  REQUIRED_SIGNAL_ALIGNMENT_REPORT_FIELDS,
  REVIEW_STATUSES,
  SIGNAL_ALIGNMENT_REPORT_SCHEMA_VERSION,
  SIGNAL_ALIGNMENT_REPORT_SOURCE,
  buildSignalAlignmentReportFingerprint,
  createSignalAlignmentReport,
  exportSignalAlignmentReport,
  filterSignalAlignmentReport,
  importSignalAlignmentReport,
  sortSignalAlignmentReport,
  summarizeSignalAlignmentReport,
  validateSignalAlignmentReport
};
