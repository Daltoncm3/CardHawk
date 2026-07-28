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
  validateAlignmentBatch,
  buildAlignmentBatchFingerprint
} = require('./signalAlignmentBatch');
const {
  validateSignalAlignmentRun,
  summarizeSignalAlignmentRun,
  buildSignalAlignmentRunFingerprint
} = require('./signalAlignmentEngine');
const {
  validateConflictAnalysis,
  buildConflictAnalysisFingerprint
} = require('./signalConflictAnalyzer');
const {
  validateSignalAlignmentReport,
  buildSignalAlignmentReportFingerprint
} = require('./signalAlignmentReport');
const {
  executeSignalMigrationLifecycle,
  summarizeSignalMigrationLifecycle,
  validateSignalMigrationLifecycle
} = require('./signalMigrationCore');
const {
  createSignalMigrationAdapter,
  validateSignalMigrationAdapter
} = require('./signalMigrationAdapterContract');
const {
  createSignalMigrationArtifact
} = require('./signalMigrationCoreContract');

const RANGE_FIRST_VALUATION_MIGRATION_SCHEMA_VERSION = '1.0.0';
const RANGE_FIRST_VALUATION_MIGRATION_SOURCE = 'range_first_valuation_signal_migration';
const RANGE_FIRST_VALUATION_SIGNAL_NAME = 'valuation.range_first.diagnostics';
const RANGE_FIRST_VALUATION_PRODUCER = 'rangeFirstValuationDiagnostics';
const RANGE_FIRST_VALUATION_PRODUCER_CATEGORY = 'offline_validation';
const DEFAULT_RANGE_FIRST_VALUATION_SIGNAL_VERSION = '1.0.0';

const REQUIRED_RANGE_FIRST_VALUATION_MIGRATION_FIELDS = Object.freeze([
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
  'adapter',
  'coreArtifact',
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
  return normalizeString(firstDefined(explicitVersion, nativeOutput.schemaVersion, nativeOutput.version, DEFAULT_RANGE_FIRST_VALUATION_SIGNAL_VERSION));
}

function confidenceLevelFromCap(nativeOutput = {}) {
  const cap = Number(asObject(nativeOutput.confidenceCapRecommendation).recommendedCap);
  if (!Number.isFinite(cap)) return UNKNOWN_VALUE;
  if (cap >= 75) return 'high';
  if (cap >= 45) return 'moderate';
  if (cap > 0) return 'low';
  return 'insufficient';
}

function evidenceQualityLevel(nativeOutput = {}) {
  const status = normalizeString(nativeOutput.valuationDiagnosticStatus);
  if (status === 'supported') return 'strong';
  if (status === 'supported_with_wide_range' || status === 'conditionally_supported') return 'adequate';
  if (status === 'weakly_supported') return 'limited';
  if (status === 'withheld') return 'weak';
  if (status === 'unavailable') return 'insufficient';
  return UNKNOWN_VALUE;
}

function buildEvidenceBasis(nativeOutput = {}) {
  const support = asObject(nativeOutput.supportingEvidenceSummary);
  const excluded = asObject(nativeOutput.excludedEvidenceSummary);
  return {
    trueSoldCount: firstDefined(support.trueSoldDepth, UNKNOWN_VALUE),
    activeListingCount: firstDefined(excluded.activeListingCount, UNKNOWN_VALUE),
    fallbackUsed: Number(firstDefined(excluded.fallbackEvidenceCount, 0)) > 0,
    staleCount: firstDefined(excluded.staleEvidenceCount, UNKNOWN_VALUE),
    rejectedCount: firstDefined(excluded.rejectedComparableCount, UNKNOWN_VALUE),
    transactionIneligibleCount: firstDefined(excluded.transactionIneligibleEvidenceCount, UNKNOWN_VALUE),
    sourceConcentration: clone(firstDefined(support.sourceConcentration, UNKNOWN_VALUE)),
    details: {
      exactComparableCount: firstDefined(support.exactComparableCount, UNKNOWN_VALUE),
      freshEvidenceCount: firstDefined(support.freshEvidenceCount, UNKNOWN_VALUE),
      comparableQualityScore: firstDefined(support.comparableQualityScore, UNKNOWN_VALUE),
      evidenceReadinessStatus: normalizeString(support.evidenceReadinessStatus),
      excludedEvidenceSummary: clone(excluded)
    }
  };
}

function buildNormalizedOutput(nativeOutput = {}) {
  const range = asObject(nativeOutput.rangeAssessment);
  const point = asObject(nativeOutput.pointEstimateAssessment);
  return {
    status: normalizeString(nativeOutput.valuationDiagnosticStatus),
    uncertaintyLevel: normalizeString(nativeOutput.uncertaintyLevel),
    pointEstimate: firstDefined(point.pointEstimate, UNKNOWN_VALUE),
    pointInsideSupportedRange: firstDefined(point.pointInsideSupportedRange, UNKNOWN_VALUE),
    lowerBound: firstDefined(range.lowerBound, UNKNOWN_VALUE),
    midpoint: firstDefined(range.midpoint, UNKNOWN_VALUE),
    upperBound: firstDefined(range.upperBound, UNKNOWN_VALUE),
    spreadPercentage: firstDefined(range.spreadPercentage, UNKNOWN_VALUE),
    shouldWithholdValuationDiagnostically: firstDefined(
      asObject(nativeOutput.valuationWithheldRecommendation).shouldWithholdValuationDiagnostically,
      UNKNOWN_VALUE
    ),
    confidenceCapRecommendation: clone(firstDefined(nativeOutput.confidenceCapRecommendation, UNKNOWN_VALUE)),
    recommendedReviewAction: normalizeString(nativeOutput.recommendedReviewAction)
  };
}

function createRangeFirstValuationAdapter(input = {}) {
  return createSignalMigrationAdapter({
    adapterId: firstDefined(input.adapterId, 'range-first-valuation-signal-adapter'),
    adapterVersion: firstDefined(input.adapterVersion, '1.0.0'),
    engineName: RANGE_FIRST_VALUATION_PRODUCER,
    supportedEngineVersions: [DEFAULT_RANGE_FIRST_VALUATION_SIGNAL_VERSION],
    signalName: RANGE_FIRST_VALUATION_SIGNAL_NAME,
    signalVersion: DEFAULT_RANGE_FIRST_VALUATION_SIGNAL_VERSION,
    producer: RANGE_FIRST_VALUATION_PRODUCER,
    producerVersion: DEFAULT_RANGE_FIRST_VALUATION_SIGNAL_VERSION,
    producerCategory: RANGE_FIRST_VALUATION_PRODUCER_CATEGORY,
    signalType: 'valuation',
    decisionRole: 'diagnostic_only',
    authorityLevel: 'shadow_observation',
    evidenceRole: 'diagnostic_context',
    nativeOutputAliases: ['nativeOutput', 'rangeFirstValuationOutput', 'diagnosticOutput', 'output'],
    nativeVersionAliases: ['schemaVersion', 'version'],
    requiredNativeFields: ['valuationDiagnosticStatus', 'uncertaintyLevel', 'pointEstimateAssessment', 'rangeAssessment'],
    optionalNativeFields: ['supportingEvidenceSummary', 'excludedEvidenceSummary', 'confidenceCapRecommendation', 'warnings', 'blockingReasons'],
    evidenceMapping: {
      kind: 'declarative',
      sourceFields: ['supportingEvidenceSummary', 'excludedEvidenceSummary'],
      targetFields: ['canonicalSignal.evidenceBasis', 'canonicalSignal.evidenceQuality'],
      semantics: 'range_first_diagnostic_evidence_support_context'
    },
    confidenceMapping: {
      kind: 'declarative',
      sourceFields: ['confidenceCapRecommendation'],
      targetFields: ['canonicalSignal.confidence', 'canonicalSignal.confidenceLevel'],
      semantics: 'confidence_cap_is_diagnostic_not_production_confidence'
    },
    uncertaintyMapping: {
      kind: 'declarative',
      sourceFields: ['uncertaintyLevel'],
      targetFields: ['canonicalSignal.uncertainty.level'],
      semantics: 'native_uncertainty_level_preserved'
    },
    statusMapping: {
      kind: 'declarative',
      sourceFields: ['valuationDiagnosticStatus'],
      targetFields: ['canonicalSignal.normalizedOutput.status'],
      semantics: 'native_valuation_diagnostic_status_preserved'
    },
    metadataMapping: {
      kind: 'declarative',
      sourceFields: ['source', 'schemaVersion'],
      targetFields: ['canonicalSignal.metadata.nativeSource', 'canonicalSignal.metadata.nativeVersion'],
      semantics: 'native_metadata_preserved'
    },
    normalizedOutputMapping: {
      kind: 'approved_handler',
      sourceFields: ['pointEstimateAssessment', 'rangeAssessment', 'valuationWithheldRecommendation'],
      targetFields: ['canonicalSignal.normalizedOutput'],
      handlerRef: 'validation/rangeFirstValuationSignalMigration#buildNormalizedOutput',
      semantics: 'range_first_summary_projection'
    },
    semanticParityRules: [
      {
        ruleId: 'range_first_raw_output_exact',
        kind: 'declarative',
        nativeFields: ['*'],
        shadowFields: ['canonicalSignal.rawOutput'],
        comparison: 'raw_output_must_match_exactly'
      },
      {
        ruleId: 'diagnostic_confidence_cap_semantic',
        kind: 'declarative',
        nativeFields: ['confidenceCapRecommendation.recommendedCap'],
        shadowFields: ['canonicalSignal.confidence.value'],
        comparison: 'confidence_cap_is_wrapped_as_diagnostic_confidence_value'
      }
    ],
    mismatchReasonCodes: [
      'changed_native_field',
      'changed_evidence_value',
      'changed_confidence_value',
      'changed_status_value',
      'changed_metadata_value',
      'missing_wrapper_field',
      'unexpected_wrapper_field'
    ],
    compatibilityNotes: ['wrapper-only migration preserves native Range-First Valuation diagnostic output'],
    createdAt: firstDefined(input.createdAt, UNKNOWN_VALUE)
  });
}

function resolveDefinition(registry, nativeOutput = {}) {
  if (!registry) return null;
  return getSignalDefinition(registry, RANGE_FIRST_VALUATION_SIGNAL_NAME, signalVersion(nativeOutput));
}

function getRegistryResolutionStatus(registry, definition) {
  if (!registry) return 'registry_missing';
  if (definition) return 'matched';
  if (asArray(registry.definitions).some((item) => item.signalName === RANGE_FIRST_VALUATION_SIGNAL_NAME)) return 'version_mismatch';
  return 'definition_missing';
}

function buildCanonicalRangeFirstValuationSignal(input = {}, definition = null) {
  const nativeOutput = clone(asObject(firstDefined(input.nativeOutput, input.rangeFirstValuationOutput, input.diagnosticOutput, input.output, {})));
  const sourceOutputFingerprint = buildSourceOutputFingerprint(nativeOutput, input.sourceOutputFingerprint);
  const producerVersion = signalVersion(nativeOutput, firstDefined(input.producerVersion, definition && definition.producerVersion));
  const confidenceCap = asObject(nativeOutput.confidenceCapRecommendation);
  return createCanonicalSignal({
    signalId: normalizeString(firstDefined(input.signalId, `${RANGE_FIRST_VALUATION_SIGNAL_NAME}:${sourceOutputFingerprint}`)),
    signalName: RANGE_FIRST_VALUATION_SIGNAL_NAME,
    producer: {
      producerId: RANGE_FIRST_VALUATION_PRODUCER,
      name: RANGE_FIRST_VALUATION_PRODUCER,
      module: 'validation/rangeFirstValuationDiagnostics.js',
      functionName: 'supplied_native_output',
      version: producerVersion,
      category: RANGE_FIRST_VALUATION_PRODUCER_CATEGORY,
      metadata: {
        migrationSource: RANGE_FIRST_VALUATION_MIGRATION_SOURCE,
        executesNativeEngine: false
      }
    },
    producerVersion,
    producerCategory: RANGE_FIRST_VALUATION_PRODUCER_CATEGORY,
    createdAt: normalizeDate(firstDefined(input.createdAt, UNKNOWN_VALUE)),
    signalType: 'valuation',
    decisionRole: 'diagnostic_only',
    authorityLevel: 'shadow_observation',
    confidence: {
      kind: 'derived',
      value: firstDefined(confidenceCap.recommendedCap, UNKNOWN_VALUE),
      scale: '0_100',
      basis: normalizeString(firstDefined(confidenceCap.reason, 'range_first_diagnostic_confidence_cap')),
      calibrated: false
    },
    confidenceLevel: confidenceLevelFromCap(nativeOutput),
    uncertainty: {
      level: normalizeString(nativeOutput.uncertaintyLevel),
      range: clone(firstDefined(nativeOutput.rangeAssessment, UNKNOWN_VALUE)),
      reasonCodes: unique([
        ...asArray(nativeOutput.warnings),
        ...asArray(nativeOutput.blockingReasons)
      ]).sort()
    },
    evidenceBasis: buildEvidenceBasis(nativeOutput),
    evidenceQuality: {
      level: evidenceQualityLevel(nativeOutput),
      score: firstDefined(asObject(nativeOutput.supportingEvidenceSummary).comparableQualityScore, UNKNOWN_VALUE),
      basis: 'range_first_valuation_diagnostic_status',
      details: clone(firstDefined(nativeOutput.supportingEvidenceSummary, UNKNOWN_VALUE))
    },
    evidenceReferences: asArray(input.evidenceReferences),
    supportingSignals: asArray(input.supportingSignals),
    conflictingSignals: asArray(input.conflictingSignals),
    warnings: asArray(nativeOutput.warnings),
    blockers: asArray(nativeOutput.blockingReasons),
    rawOutput: nativeOutput,
    normalizedOutput: buildNormalizedOutput(nativeOutput),
    sourceFingerprint: sourceOutputFingerprint,
    metadata: {
      nativeSource: normalizeString(nativeOutput.source),
      nativeVersion: producerVersion,
      migrationSchemaVersion: RANGE_FIRST_VALUATION_MIGRATION_SCHEMA_VERSION,
      wrapperOnly: true
    }
  });
}

function buildAlignment(input = {}, canonicalSignal, definition, registryResolutionStatus) {
  return createSignalAlignment({
    alignmentId: normalizeString(firstDefined(input.alignmentId, `alignment:${canonicalSignal.signalId}`)),
    createdAt: normalizeDate(firstDefined(input.createdAt, canonicalSignal.createdAt)),
    producer: RANGE_FIRST_VALUATION_PRODUCER,
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
    schemaVersion: RANGE_FIRST_VALUATION_MIGRATION_SCHEMA_VERSION,
    source: `${RANGE_FIRST_VALUATION_MIGRATION_SOURCE}:adapted_signal`,
    adaptationId: normalizeString(firstDefined(input.adaptationId, `adaptation:${canonicalSignal.signalId}`)),
    createdAt: normalizeDate(firstDefined(input.createdAt, canonicalSignal.createdAt)),
    producer: RANGE_FIRST_VALUATION_PRODUCER,
    signalName: RANGE_FIRST_VALUATION_SIGNAL_NAME,
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
    alignmentRunId: normalizeString(firstDefined(input.alignmentRunId, input.runId, `range-first-valuation-alignment-run:${adaptedSignal.sourceOutputFingerprint}`)),
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
      migrationSource: RANGE_FIRST_VALUATION_MIGRATION_SOURCE,
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
  if (!preserved) errors.push(validationIssue('native_output_parity_mismatch', 'Native Range-First Valuation diagnostic output was not preserved exactly.', 'nativeOutput'));
  return {
    parityStatus: preserved ? 'preserved' : 'changed',
    valid: preserved,
    errors,
    warnings: [],
    reasonCodes: unique(errors.map((error) => error.code)).sort()
  };
}

function summarizeRangeFirstValuationMigration(migration = {}) {
  return deepFreeze({
    ...summarizeSignalMigrationLifecycle(migration),
    schemaVersion: RANGE_FIRST_VALUATION_MIGRATION_SCHEMA_VERSION,
    migrationId: normalizeString(migration.migrationId),
    signalName: RANGE_FIRST_VALUATION_SIGNAL_NAME,
    producer: RANGE_FIRST_VALUATION_PRODUCER,
    nativeSource: normalizeString(migration.nativeOutput && migration.nativeOutput.source),
    nativeVersion: signalVersion(asObject(migration.nativeOutput)),
    valuationDiagnosticStatus: normalizeString(migration.nativeOutput && migration.nativeOutput.valuationDiagnosticStatus),
    uncertaintyLevel: normalizeString(migration.nativeOutput && migration.nativeOutput.uncertaintyLevel)
  });
}

function buildRangeFirstValuationMigrationFingerprint(migration = {}) {
  const projection = clone(migration);
  delete projection.migrationFingerprint;
  delete projection.rangeFirstValuationMigrationFingerprint;
  return buildFingerprintFromProjection(projection);
}

function buildCoreArtifact(migration = {}) {
  return createSignalMigrationArtifact({
    migrationId: migration.migrationId,
    createdAt: migration.createdAt,
    engineName: RANGE_FIRST_VALUATION_PRODUCER,
    engineVersion: signalVersion(asObject(migration.nativeOutput)),
    nativeOutputFingerprint: migration.sourceOutputFingerprint,
    canonicalSignalFingerprint: migration.canonicalSignal && migration.canonicalSignal.signalFingerprint,
    alignmentFingerprint: migration.alignment && migration.alignment.alignmentFingerprint,
    batchFingerprint: migration.alignmentBatch && migration.alignmentBatch.batchFingerprint,
    runFingerprint: migration.alignmentRun && migration.alignmentRun.runFingerprint,
    reportFingerprint: migration.alignmentReport && migration.alignmentReport.reportFingerprint,
    parityStatus: migration.parityStatus,
    registryStatus: migration.registryResolutionStatus,
    warnings: migration.warnings,
    errors: migration.errors,
    metadata: {
      source: RANGE_FIRST_VALUATION_MIGRATION_SOURCE
    }
  });
}

function validateRangeFirstValuationMigration(migration = {}) {
  const errors = [];
  const warnings = [];
  const authorityViolations = [];
  const fingerprintViolations = [];
  const missing = REQUIRED_RANGE_FIRST_VALUATION_MIGRATION_FIELDS.filter((field) => {
    const value = migration[field];
    return value === undefined || value === null || value === '';
  });

  for (const field of missing) errors.push(validationIssue('missing_required_field', `${field} is required.`, field));
  if (migration.schemaVersion !== RANGE_FIRST_VALUATION_MIGRATION_SCHEMA_VERSION) errors.push(validationIssue('invalid_schema_version', 'schemaVersion must match Range-First Valuation Signal Migration schema.', 'schemaVersion'));
  if (migration.source !== RANGE_FIRST_VALUATION_MIGRATION_SOURCE) errors.push(validationIssue('invalid_source', 'source must be range_first_valuation_signal_migration.', 'source'));

  const baseValidation = validateSignalMigrationLifecycle(migration, {
    adapter: migration.adapter,
    coreArtifact: migration.coreArtifact,
    verifyParity
  });
  if (!baseValidation.valid) errors.push(...baseValidation.errors);
  warnings.push(...baseValidation.warnings);
  authorityViolations.push(...baseValidation.authorityViolations);
  fingerprintViolations.push(...baseValidation.fingerprintViolations);

  for (const [prefix, validation] of [
    ['registry', migration.registry ? validateSignalRegistry(migration.registry) : { valid: true, errors: [], warnings: [], authorityViolations: [], fingerprintViolations: [] }],
    ['adapter', validateSignalMigrationAdapter(migration.adapter)],
    ['canonicalSignal', validateCanonicalSignal(migration.canonicalSignal)],
    ['alignment', validateSignalAlignment(migration.alignment)],
    ['alignmentBatch', validateAlignmentBatch(migration.alignmentBatch)],
    ['alignmentRun', validateSignalAlignmentRun(migration.alignmentRun)],
    ['conflictAnalysis', validateConflictAnalysis(migration.conflictAnalysis)],
    ['alignmentReport', validateSignalAlignmentReport(migration.alignmentReport)]
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
  if (migration.migrationFingerprint && buildRangeFirstValuationMigrationFingerprint(migration) !== migration.migrationFingerprint) {
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
    reportStatus: normalizeString(migration.reportStatus),
    parityStatus: verifyParity(migration.nativeOutput, migration).parityStatus,
    authorityViolations: unique(authorityViolations).sort(),
    fingerprintViolations: unique(fingerprintViolations).sort()
  };
}

function migrateRangeFirstValuationSignal(input = {}, options = {}) {
  const adapter = createRangeFirstValuationAdapter({ createdAt: firstDefined(input.createdAt, options.createdAt) });
  const migration = executeSignalMigrationLifecycle(input, options, {
    schemaVersion: RANGE_FIRST_VALUATION_MIGRATION_SCHEMA_VERSION,
    migrationSource: RANGE_FIRST_VALUATION_MIGRATION_SOURCE,
    nativeOutputAliases: ['nativeOutput', 'rangeFirstValuationOutput', 'diagnosticOutput', 'output'],
    defaultMigrationIdPrefix: 'range-first-valuation-signal-migration',
    defaultAlignmentBatchId: 'range-first-valuation-signal-alignment-batch',
    defaultConflictAnalysisId: 'range-first-valuation-signal-conflict-analysis',
    defaultReportId: 'range-first-valuation-signal-alignment-report',
    resolveDefinition,
    getRegistryResolutionStatus,
    buildCanonicalSignal: buildCanonicalRangeFirstValuationSignal,
    buildAlignment,
    buildAdaptedSignal,
    buildAlignmentRun,
    verifyParity,
    summarizeMigration: summarizeRangeFirstValuationMigration,
    validateMigration: (candidate) => validateRangeFirstValuationMigration({ ...candidate, adapter, coreArtifact: buildCoreArtifact(candidate) }),
    buildMigrationFingerprint: buildRangeFirstValuationMigrationFingerprint
  });
  const withCore = {
    ...migration,
    adapter,
    coreArtifact: buildCoreArtifact(migration)
  };
  const withValidation = {
    ...withCore,
    summary: summarizeRangeFirstValuationMigration(withCore)
  };
  return deepFreeze({
    ...withValidation,
    validation: validateRangeFirstValuationMigration(withValidation),
    migrationFingerprint: buildRangeFirstValuationMigrationFingerprint(withValidation)
  });
}

module.exports = {
  DEFAULT_RANGE_FIRST_VALUATION_SIGNAL_VERSION,
  RANGE_FIRST_VALUATION_MIGRATION_SCHEMA_VERSION,
  RANGE_FIRST_VALUATION_MIGRATION_SOURCE,
  RANGE_FIRST_VALUATION_PRODUCER,
  RANGE_FIRST_VALUATION_SIGNAL_NAME,
  REQUIRED_RANGE_FIRST_VALUATION_MIGRATION_FIELDS,
  buildRangeFirstValuationMigrationFingerprint,
  createRangeFirstValuationAdapter,
  migrateRangeFirstValuationSignal,
  summarizeRangeFirstValuationMigration,
  validateRangeFirstValuationMigration
};
