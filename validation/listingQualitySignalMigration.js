'use strict';

const { asArray, asObject, unique } = require('./canonicalValidationCore');
const { buildFingerprintFromProjection } = require('./fingerprintProjection');
const { clone, firstDefined } = require('./phase8GovernanceCore');
const {
  UNKNOWN_VALUE,
  createCanonicalSignal,
  validateCanonicalSignal,
  buildCanonicalSignalFingerprint
} = require('./canonicalIntelligenceSignalContract');
const {
  getSignalDefinition,
  validateSignalRegistry
} = require('./intelligenceSignalRegistry');
const {
  createSignalAlignment,
  validateSignalAlignment,
  buildSignalAlignmentFingerprint
} = require('./signalAlignmentContract');
const {
  createAlignmentBatch,
  validateAlignmentBatch,
  summarizeAlignmentBatch,
  buildAlignmentBatchFingerprint
} = require('./signalAlignmentBatch');
const {
  validateSignalAlignmentRun,
  summarizeSignalAlignmentRun,
  buildSignalAlignmentRunFingerprint
} = require('./signalAlignmentEngine');
const {
  analyzeSignalConflicts,
  validateConflictAnalysis,
  buildConflictAnalysisFingerprint
} = require('./signalConflictAnalyzer');
const {
  createSignalAlignmentReport,
  validateSignalAlignmentReport,
  buildSignalAlignmentReportFingerprint
} = require('./signalAlignmentReport');

const LISTING_QUALITY_MIGRATION_SCHEMA_VERSION = '1.0.0';
const LISTING_QUALITY_MIGRATION_SOURCE = 'listing_quality_signal_migration';
const LISTING_QUALITY_SIGNAL_NAME = 'listing.quality.grading.diagnostics';
const LISTING_QUALITY_PRODUCER = 'listingQualityGradingDiagnostics';
const LISTING_QUALITY_PRODUCER_CATEGORY = 'offline_validation';
const DEFAULT_LISTING_QUALITY_SIGNAL_VERSION = '1.0.0';

const REQUIRED_LISTING_QUALITY_MIGRATION_FIELDS = Object.freeze([
  'schemaVersion',
  'source',
  'migrationId',
  'createdAt',
  'nativeOutput',
  'sourceOutputFingerprint',
  'registryResolutionStatus',
  'canonicalSignal',
  'alignment',
  'alignmentBatch',
  'alignmentRun',
  'conflictAnalysis',
  'alignmentReport',
  'summary',
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

function validationIssue(code, message, field = '') {
  return { code, message, field };
}

function buildSourceOutputFingerprint(nativeOutput = {}, explicitFingerprint) {
  if (known(explicitFingerprint)) return normalizeString(explicitFingerprint);
  if (known(nativeOutput.stableFingerprint)) return normalizeString(nativeOutput.stableFingerprint);
  if (known(nativeOutput.signalFingerprint)) return normalizeString(nativeOutput.signalFingerprint);
  return buildFingerprintFromProjection(nativeOutput);
}

function signalVersion(nativeOutput = {}, explicitVersion) {
  return normalizeString(firstDefined(explicitVersion, nativeOutput.schemaVersion, nativeOutput.version, DEFAULT_LISTING_QUALITY_SIGNAL_VERSION));
}

function uncertaintyLevel(value) {
  const risk = normalizeString(value);
  if (risk === 'low') return 'low';
  if (risk === 'medium' || risk === 'moderate') return 'moderate';
  if (risk === 'high') return 'high';
  if (risk === 'critical') return 'extreme';
  return UNKNOWN_VALUE;
}

function evidenceQualityLevel(nativeOutput = {}) {
  const status = normalizeString(nativeOutput.listingQualityStatus);
  if (status === 'strong') return 'strong';
  if (status === 'acceptable') return 'adequate';
  if (status === 'caution') return 'limited';
  if (status === 'high_risk' || status === 'blocked') return 'weak';
  if (status === 'unavailable') return 'insufficient';
  return UNKNOWN_VALUE;
}

function buildEvidenceBasis(nativeOutput = {}) {
  const soldSupport = asObject(nativeOutput.gradingSupportSummary && nativeOutput.gradingSupportSummary.soldSupport);
  const trueSoldCount = ['sameGradeCount', 'lowerGradeCount', 'higherGradeCount', 'rawCount']
    .reduce((total, field) => total + Number(firstDefined(soldSupport[field], 0)), 0);
  const listingSummary = asObject(nativeOutput.listingQualitySummary);
  return {
    trueSoldCount,
    activeListingCount: firstDefined(soldSupport.activeContextCount, UNKNOWN_VALUE),
    fallbackUsed: false,
    staleCount: UNKNOWN_VALUE,
    rejectedCount: UNKNOWN_VALUE,
    transactionIneligibleCount: UNKNOWN_VALUE,
    sourceConcentration: UNKNOWN_VALUE,
    details: {
      listingQualityStatus: normalizeString(nativeOutput.listingQualityStatus),
      gradingDiagnosticStatus: normalizeString(nativeOutput.gradingDiagnosticStatus),
      riskLevel: normalizeString(nativeOutput.riskLevel),
      imageCount: firstDefined(listingSummary.imageCount, UNKNOWN_VALUE),
      imageQuality: normalizeString(listingSummary.imageQuality),
      soldSupport: clone(soldSupport)
    }
  };
}

function buildNormalizedOutput(nativeOutput = {}) {
  return {
    status: normalizeString(nativeOutput.listingQualityStatus),
    gradingStatus: normalizeString(nativeOutput.gradingDiagnosticStatus),
    riskLevel: normalizeString(nativeOutput.riskLevel),
    blockingIssueCount: asArray(nativeOutput.blockingIssues).length,
    warningCount: asArray(nativeOutput.warnings).length,
    confirmedAttributeCount: asArray(nativeOutput.confirmedAttributes).length,
    ambiguousAttributeCount: asArray(nativeOutput.ambiguousAttributes).length,
    unsupportedAttributeCount: asArray(nativeOutput.unsupportedAttributes).length,
    recommendedReviewAction: normalizeString(nativeOutput.recommendedReviewAction),
    listingQualitySummary: clone(firstDefined(nativeOutput.listingQualitySummary, UNKNOWN_VALUE)),
    gradingSupportSummary: clone(firstDefined(nativeOutput.gradingSupportSummary, UNKNOWN_VALUE)),
    listingHistoryContext: clone(firstDefined(nativeOutput.listingHistoryContext, UNKNOWN_VALUE))
  };
}

function resolveDefinition(registry, nativeOutput = {}) {
  if (!registry) return null;
  return getSignalDefinition(registry, LISTING_QUALITY_SIGNAL_NAME, signalVersion(nativeOutput));
}

function getRegistryResolutionStatus(registry, definition) {
  if (!registry) return 'registry_missing';
  if (definition) return 'matched';
  const definitions = asArray(registry.definitions);
  if (definitions.some((item) => item.signalName === LISTING_QUALITY_SIGNAL_NAME)) return 'version_mismatch';
  return 'definition_missing';
}

function buildCanonicalListingQualitySignal(input = {}, definition = null) {
  const nativeOutput = clone(asObject(firstDefined(input.nativeOutput, input.listingQualityOutput, input.diagnosticOutput, input.output, {})));
  const sourceOutputFingerprint = buildSourceOutputFingerprint(nativeOutput, input.sourceOutputFingerprint);
  const producerVersion = signalVersion(nativeOutput, firstDefined(input.producerVersion, definition && definition.producerVersion));
  return createCanonicalSignal({
    signalId: normalizeString(firstDefined(input.signalId, `${LISTING_QUALITY_SIGNAL_NAME}:${sourceOutputFingerprint}`)),
    signalName: LISTING_QUALITY_SIGNAL_NAME,
    producer: {
      producerId: LISTING_QUALITY_PRODUCER,
      name: LISTING_QUALITY_PRODUCER,
      module: 'validation/listingQualityGradingDiagnostics.js',
      functionName: 'supplied_native_output',
      version: producerVersion,
      category: LISTING_QUALITY_PRODUCER_CATEGORY,
      metadata: {
        migrationSource: LISTING_QUALITY_MIGRATION_SOURCE,
        executesNativeEngine: false
      }
    },
    producerVersion,
    producerCategory: LISTING_QUALITY_PRODUCER_CATEGORY,
    createdAt: normalizeDate(firstDefined(input.createdAt, UNKNOWN_VALUE)),
    signalType: 'quality',
    decisionRole: 'diagnostic_only',
    authorityLevel: 'shadow_observation',
    confidence: {
      kind: UNKNOWN_VALUE,
      value: UNKNOWN_VALUE,
      scale: UNKNOWN_VALUE,
      basis: 'listing_quality_grading_diagnostics_do_not_report_confidence',
      calibrated: false
    },
    confidenceLevel: UNKNOWN_VALUE,
    uncertainty: {
      level: uncertaintyLevel(nativeOutput.riskLevel),
      range: UNKNOWN_VALUE,
      reasonCodes: unique([
        ...asArray(nativeOutput.warnings),
        ...asArray(nativeOutput.blockingIssues)
      ]).sort()
    },
    evidenceBasis: buildEvidenceBasis(nativeOutput),
    evidenceQuality: {
      level: evidenceQualityLevel(nativeOutput),
      score: UNKNOWN_VALUE,
      basis: 'listing_quality_grading_diagnostic_status',
      details: {
        listingQualityStatus: normalizeString(nativeOutput.listingQualityStatus),
        gradingDiagnosticStatus: normalizeString(nativeOutput.gradingDiagnosticStatus),
        riskLevel: normalizeString(nativeOutput.riskLevel)
      }
    },
    evidenceReferences: asArray(input.evidenceReferences),
    supportingSignals: asArray(input.supportingSignals),
    conflictingSignals: asArray(input.conflictingSignals),
    warnings: asArray(nativeOutput.warnings),
    blockers: asArray(nativeOutput.blockingIssues),
    rawOutput: nativeOutput,
    normalizedOutput: buildNormalizedOutput(nativeOutput),
    sourceFingerprint: sourceOutputFingerprint,
    metadata: {
      nativeSource: normalizeString(nativeOutput.source),
      nativeVersion: producerVersion,
      migrationSchemaVersion: LISTING_QUALITY_MIGRATION_SCHEMA_VERSION,
      wrapperOnly: true
    }
  });
}

function buildAlignment(input = {}, canonicalSignal, definition, registryResolutionStatus) {
  return createSignalAlignment({
    alignmentId: normalizeString(firstDefined(input.alignmentId, `alignment:${canonicalSignal.signalId}`)),
    createdAt: normalizeDate(firstDefined(input.createdAt, canonicalSignal.createdAt)),
    producer: LISTING_QUALITY_PRODUCER,
    producerVersion: canonicalSignal.producerVersion,
    sourceOutputFingerprint: canonicalSignal.sourceFingerprint,
    registryId: normalizeString(input.registry && input.registry.registryId),
    registryFingerprint: normalizeString(input.registry && input.registry.registryFingerprint),
    signalDefinition: definition || UNKNOWN_VALUE,
    canonicalSignal,
    confidenceAlignment: {
      status: definition ? 'aligned' : UNKNOWN_VALUE,
      confidenceSemantics: definition ? clone(definition.confidenceSemantics) : UNKNOWN_VALUE,
      suppliedConfidence: clone(canonicalSignal.confidence)
    },
    evidenceAlignment: {
      status: definition ? 'aligned' : UNKNOWN_VALUE,
      evidenceRole: definition ? definition.evidenceRole : UNKNOWN_VALUE,
      evidenceRequirements: definition ? clone(definition.evidenceRequirements) : UNKNOWN_VALUE,
      suppliedEvidenceBasis: clone(canonicalSignal.evidenceBasis)
    },
    relationshipSummary: {
      supportingSignalCount: asArray(canonicalSignal.supportingSignals).length,
      conflictingSignalCount: asArray(canonicalSignal.conflictingSignals).length,
      missingReferenceCount: 0,
      unresolvedReferenceCount: 0,
      supportingSignals: canonicalSignal.supportingSignals,
      conflictingSignals: canonicalSignal.conflictingSignals
    },
    warnings: registryResolutionStatus === 'matched' ? [] : [registryResolutionStatus],
    errors: [],
    missingMetadata: registryResolutionStatus === 'matched' ? [] : ['signalDefinition'],
    metadata: {
      registryResolutionStatus,
      nativeStatus: normalizeString(canonicalSignal.normalizedOutput && canonicalSignal.normalizedOutput.status),
      wrapperOnly: true
    }
  });
}

function buildAdaptedSignal(input = {}, canonicalSignal, alignment, definition, registryResolutionStatus) {
  const core = {
    schemaVersion: LISTING_QUALITY_MIGRATION_SCHEMA_VERSION,
    source: `${LISTING_QUALITY_MIGRATION_SOURCE}:adapted_signal`,
    adaptationId: normalizeString(firstDefined(input.adaptationId, `adaptation:${canonicalSignal.signalId}`)),
    createdAt: normalizeDate(firstDefined(input.createdAt, canonicalSignal.createdAt)),
    producer: LISTING_QUALITY_PRODUCER,
    signalName: LISTING_QUALITY_SIGNAL_NAME,
    signalVersion: canonicalSignal.producerVersion,
    sourceOutputFingerprint: canonicalSignal.sourceFingerprint,
    registryLookupStatus: registryResolutionStatus,
    signalDefinition: definition || UNKNOWN_VALUE,
    canonicalSignal,
    alignment,
    nativeOutput: clone(canonicalSignal.rawOutput),
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
  return deepFreeze({
    ...core,
    adaptationFingerprint: buildFingerprintFromProjection(core)
  });
}

function buildAlignmentRun(input = {}, adaptedSignal, alignmentBatch) {
  const summary = summarizeSignalAlignmentRun({ adaptedSignals: [adaptedSignal], alignmentBatch });
  const core = {
    schemaVersion: '1.0.0',
    source: 'signal_alignment_engine',
    alignmentRunId: normalizeString(firstDefined(input.alignmentRunId, input.runId, `listing-quality-alignment-run:${adaptedSignal.sourceOutputFingerprint}`)),
    createdAt: normalizeDate(firstDefined(input.createdAt, UNKNOWN_VALUE)),
    registryId: normalizeString(input.registry && input.registry.registryId),
    registryFingerprint: normalizeString(input.registry && input.registry.registryFingerprint),
    adaptedSignalCount: 1,
    alignedSignalCount: summary.alignedSignalCount,
    blockedSignalCount: summary.blockedSignalCount,
    adaptedSignals: [adaptedSignal],
    alignmentBatch,
    summary,
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none',
    metadata: {
      migrationSource: LISTING_QUALITY_MIGRATION_SOURCE,
      wrapperOnly: true
    }
  };
  const withValidation = {
    ...core,
    validation: validateSignalAlignmentRun({ ...core, runFingerprint: buildSignalAlignmentRunFingerprint(core) })
  };
  return deepFreeze({
    ...withValidation,
    runFingerprint: buildSignalAlignmentRunFingerprint(withValidation)
  });
}

function verifyParity(nativeOutput = {}, migration = {}) {
  const canonicalRaw = migration.canonicalSignal && migration.canonicalSignal.rawOutput;
  const adaptedRaw = migration.adaptedSignal && migration.adaptedSignal.nativeOutput;
  const preserved = JSON.stringify(nativeOutput) === JSON.stringify(canonicalRaw) &&
    JSON.stringify(nativeOutput) === JSON.stringify(adaptedRaw);
  const errors = [];
  if (!preserved) errors.push(validationIssue('native_output_parity_mismatch', 'Native Listing Quality diagnostic output was not preserved exactly.', 'nativeOutput'));
  return {
    parityStatus: preserved ? 'preserved' : 'changed',
    valid: preserved,
    errors,
    warnings: [],
    reasonCodes: unique(errors.map((error) => error.code)).sort()
  };
}

function summarizeListingQualityMigration(migration = {}) {
  const alignment = asObject(migration.alignment);
  const report = asObject(migration.alignmentReport);
  return deepFreeze({
    schemaVersion: LISTING_QUALITY_MIGRATION_SCHEMA_VERSION,
    migrationId: normalizeString(migration.migrationId),
    signalName: LISTING_QUALITY_SIGNAL_NAME,
    producer: LISTING_QUALITY_PRODUCER,
    registryResolutionStatus: normalizeString(migration.registryResolutionStatus),
    alignmentStatus: normalizeString(alignment.alignmentStatus),
    reportStatus: migration.reportStatus || (report.reportValidation && report.reportValidation.valid ? 'valid' : 'invalid'),
    parityStatus: normalizeString(migration.parityStatus),
    nativeSource: normalizeString(migration.nativeOutput && migration.nativeOutput.source),
    nativeVersion: signalVersion(asObject(migration.nativeOutput)),
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  });
}

function buildListingQualityMigrationFingerprint(migration = {}) {
  const projection = clone(migration);
  delete projection.migrationFingerprint;
  delete projection.listingQualityMigrationFingerprint;
  return buildFingerprintFromProjection(projection);
}

function validateListingQualityMigration(migration = {}) {
  const errors = [];
  const warnings = [];
  const authorityViolations = [];
  const fingerprintViolations = [];
  const missing = REQUIRED_LISTING_QUALITY_MIGRATION_FIELDS.filter((field) => {
    const value = migration[field];
    return value === undefined || value === null || value === '';
  });

  for (const field of missing) errors.push(validationIssue('missing_required_field', `${field} is required.`, field));
  if (migration.schemaVersion !== LISTING_QUALITY_MIGRATION_SCHEMA_VERSION) errors.push(validationIssue('invalid_schema_version', 'schemaVersion must match Listing Quality Signal Migration schema.', 'schemaVersion'));
  if (migration.source !== LISTING_QUALITY_MIGRATION_SOURCE) errors.push(validationIssue('invalid_source', 'source must be listing_quality_signal_migration.', 'source'));

  for (const field of ['productionImpact', 'decisionImpact', 'executionAuthority']) {
    if (migration[field] !== 'none') {
      errors.push(validationIssue('authority_boundary_violation', `${field} must remain none.`, field));
      authorityViolations.push(field);
    }
  }

  const registryValidation = migration.registry ? validateSignalRegistry(migration.registry) : { valid: true, errors: [], warnings: [], reasonCodes: [], authorityViolations: [] };
  const signalValidation = validateCanonicalSignal(migration.canonicalSignal);
  const alignmentValidation = validateSignalAlignment(migration.alignment);
  const batchValidation = validateAlignmentBatch(migration.alignmentBatch);
  const runValidation = validateSignalAlignmentRun(migration.alignmentRun);
  const conflictValidation = validateConflictAnalysis(migration.conflictAnalysis);
  const reportValidation = validateSignalAlignmentReport(migration.alignmentReport);
  const parity = verifyParity(migration.nativeOutput, migration);

  for (const [prefix, validation] of [
    ['registry', registryValidation],
    ['canonicalSignal', signalValidation],
    ['alignment', alignmentValidation],
    ['alignmentBatch', batchValidation],
    ['alignmentRun', runValidation],
    ['conflictAnalysis', conflictValidation],
    ['alignmentReport', reportValidation],
    ['parity', parity]
  ]) {
    if (!validation.valid) errors.push(...asArray(validation.errors).map((error) => ({ ...error, field: `${prefix}.${error.field || ''}` })));
    warnings.push(...asArray(validation.warnings).map((warning) => ({ ...warning, field: `${prefix}.${warning.field || ''}` })));
    authorityViolations.push(...asArray(validation.authorityViolations).map((field) => `${prefix}.${field}`));
    fingerprintViolations.push(...asArray(validation.fingerprintViolations).map((field) => `${prefix}.${field}`));
  }

  if (migration.canonicalSignal && migration.canonicalSignal.signalFingerprint && buildCanonicalSignalFingerprint(migration.canonicalSignal) !== migration.canonicalSignal.signalFingerprint) {
    fingerprintViolations.push('canonicalSignal.signalFingerprint');
  }
  if (migration.alignment && migration.alignment.alignmentFingerprint && buildSignalAlignmentFingerprint(migration.alignment) !== migration.alignment.alignmentFingerprint) {
    fingerprintViolations.push('alignment.alignmentFingerprint');
  }
  if (migration.alignmentBatch && migration.alignmentBatch.batchFingerprint && buildAlignmentBatchFingerprint(migration.alignmentBatch) !== migration.alignmentBatch.batchFingerprint) {
    fingerprintViolations.push('alignmentBatch.batchFingerprint');
  }
  if (migration.alignmentRun && migration.alignmentRun.runFingerprint && buildSignalAlignmentRunFingerprint(migration.alignmentRun) !== migration.alignmentRun.runFingerprint) {
    fingerprintViolations.push('alignmentRun.runFingerprint');
  }
  if (migration.conflictAnalysis && migration.conflictAnalysis.analysisFingerprint && buildConflictAnalysisFingerprint(migration.conflictAnalysis) !== migration.conflictAnalysis.analysisFingerprint) {
    fingerprintViolations.push('conflictAnalysis.analysisFingerprint');
  }
  if (migration.alignmentReport && migration.alignmentReport.reportFingerprint && buildSignalAlignmentReportFingerprint(migration.alignmentReport) !== migration.alignmentReport.reportFingerprint) {
    fingerprintViolations.push('alignmentReport.reportFingerprint');
  }
  if (migration.migrationFingerprint && buildListingQualityMigrationFingerprint(migration) !== migration.migrationFingerprint) {
    errors.push(validationIssue('migration_fingerprint_mismatch', 'migrationFingerprint does not match migration contents.', 'migrationFingerprint'));
    fingerprintViolations.push('migrationFingerprint');
  }

  const reasonCodes = unique([...errors.map((error) => error.code), ...warnings.map((warning) => warning.code)]).sort();
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes,
    registryResolutionStatus: normalizeString(migration.registryResolutionStatus),
    alignmentStatus: normalizeString(migration.alignment && migration.alignment.alignmentStatus),
    reportStatus: reportValidation.valid ? 'valid' : 'invalid',
    parityStatus: parity.parityStatus,
    authorityViolations: unique(authorityViolations).sort(),
    fingerprintViolations: unique(fingerprintViolations).sort()
  };
}

function migrateListingQualitySignal(input = {}, options = {}) {
  const nativeOutput = clone(asObject(firstDefined(input.nativeOutput, input.listingQualityOutput, input.diagnosticOutput, input.output, {})));
  const registry = firstDefined(input.registry, options.registry, null);
  const definition = resolveDefinition(registry, nativeOutput);
  const registryResolutionStatus = getRegistryResolutionStatus(registry, definition);
  const canonicalSignal = buildCanonicalListingQualitySignal({
    ...input,
    nativeOutput,
    registry
  }, definition);
  const alignment = buildAlignment({ ...input, registry }, canonicalSignal, definition, registryResolutionStatus);
  const adaptedSignal = buildAdaptedSignal(input, canonicalSignal, alignment, definition, registryResolutionStatus);
  const alignmentBatch = createAlignmentBatch({
    alignmentBatchId: normalizeString(firstDefined(input.alignmentBatchId, options.alignmentBatchId, 'listing-quality-signal-alignment-batch')),
    createdAt: normalizeDate(firstDefined(input.createdAt, options.createdAt, UNKNOWN_VALUE)),
    adaptedSignals: [adaptedSignal],
    metadata: { migrationSource: LISTING_QUALITY_MIGRATION_SOURCE }
  });
  const alignmentRun = buildAlignmentRun({
    ...input,
    registry,
    createdAt: normalizeDate(firstDefined(input.createdAt, options.createdAt, UNKNOWN_VALUE))
  }, adaptedSignal, alignmentBatch);
  const conflictAnalysis = analyzeSignalConflicts({
    analysisId: normalizeString(firstDefined(input.conflictAnalysisId, options.conflictAnalysisId, 'listing-quality-signal-conflict-analysis')),
    createdAt: normalizeDate(firstDefined(input.createdAt, options.createdAt, UNKNOWN_VALUE)),
    alignmentRun
  });
  const alignmentReport = createSignalAlignmentReport({
    reportId: normalizeString(firstDefined(input.reportId, options.reportId, 'listing-quality-signal-alignment-report')),
    createdAt: normalizeDate(firstDefined(input.createdAt, options.createdAt, UNKNOWN_VALUE)),
    alignmentRun,
    conflictAnalysis
  });
  const parity = verifyParity(nativeOutput, { canonicalSignal, adaptedSignal });
  const core = {
    schemaVersion: LISTING_QUALITY_MIGRATION_SCHEMA_VERSION,
    source: LISTING_QUALITY_MIGRATION_SOURCE,
    migrationId: normalizeString(firstDefined(input.migrationId, options.migrationId, `listing-quality-signal-migration:${canonicalSignal.sourceFingerprint}`)),
    createdAt: normalizeDate(firstDefined(input.createdAt, options.createdAt, UNKNOWN_VALUE)),
    nativeOutput,
    sourceOutputFingerprint: canonicalSignal.sourceFingerprint,
    registry,
    registryResolutionStatus,
    canonicalSignal,
    alignment,
    adaptedSignal,
    alignmentBatch,
    alignmentRun,
    conflictAnalysis,
    alignmentReport,
    parityStatus: parity.parityStatus,
    reportStatus: alignmentReport.reportValidation && alignmentReport.reportValidation.valid ? 'valid' : 'invalid',
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none',
    metadata: {
      wrapperOnly: true,
      nativeEngineExecuted: false,
      ...clone(asObject(input.metadata))
    }
  };
  const withSummary = {
    ...core,
    summary: summarizeListingQualityMigration(core)
  };
  const prevalidated = {
    ...withSummary,
    migrationFingerprint: buildListingQualityMigrationFingerprint(withSummary)
  };
  const withValidation = {
    ...withSummary,
    validation: validateListingQualityMigration(prevalidated)
  };
  return deepFreeze({
    ...withValidation,
    migrationFingerprint: buildListingQualityMigrationFingerprint(withValidation)
  });
}

module.exports = {
  DEFAULT_LISTING_QUALITY_SIGNAL_VERSION,
  LISTING_QUALITY_MIGRATION_SCHEMA_VERSION,
  LISTING_QUALITY_MIGRATION_SOURCE,
  LISTING_QUALITY_PRODUCER,
  LISTING_QUALITY_SIGNAL_NAME,
  REQUIRED_LISTING_QUALITY_MIGRATION_FIELDS,
  buildListingQualityMigrationFingerprint,
  migrateListingQualitySignal,
  summarizeListingQualityMigration,
  validateListingQualityMigration
};
