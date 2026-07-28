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

const CONFIDENCE_CALIBRATION_MIGRATION_SCHEMA_VERSION = '1.0.0';
const CONFIDENCE_CALIBRATION_MIGRATION_SOURCE = 'confidence_calibration_signal_migration';
const CONFIDENCE_CALIBRATION_SIGNAL_NAME = 'confidence.calibration.diagnostics';
const CONFIDENCE_CALIBRATION_PRODUCER = 'confidenceCalibrationDiagnostics';
const CONFIDENCE_CALIBRATION_PRODUCER_CATEGORY = 'offline_validation';
const DEFAULT_CONFIDENCE_CALIBRATION_SIGNAL_VERSION = '1.0.0';

const REQUIRED_CONFIDENCE_CALIBRATION_MIGRATION_FIELDS = Object.freeze([
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
  return normalizeString(firstDefined(explicitVersion, nativeOutput.schemaVersion, nativeOutput.version, DEFAULT_CONFIDENCE_CALIBRATION_SIGNAL_VERSION));
}

function confidenceLevel(nativeOutput = {}) {
  const support = normalizeString(nativeOutput.confidenceSupportLevel);
  if (support === 'strong') return 'high';
  if (support === 'adequate' || support === 'limited') return 'moderate';
  if (support === 'weak') return 'low';
  if (support === 'unsupported') return 'insufficient';
  return UNKNOWN_VALUE;
}

function uncertaintyLevel(nativeOutput = {}) {
  const status = normalizeString(nativeOutput.calibrationStatus);
  if (status === 'calibrated') return 'low';
  if (status === 'provisionally_calibrated' || status === 'under_review') return 'moderate';
  if (status === 'overconfident' || status === 'underconfident' || status === 'insufficient_sample') return 'high';
  if (status === 'unavailable') return 'extreme';
  return UNKNOWN_VALUE;
}

function evidenceQualityLevel(nativeOutput = {}) {
  const support = normalizeString(nativeOutput.confidenceSupportLevel);
  if (support === 'strong') return 'strong';
  if (support === 'adequate') return 'adequate';
  if (support === 'limited') return 'limited';
  if (support === 'weak') return 'weak';
  if (support === 'unsupported') return 'insufficient';
  return UNKNOWN_VALUE;
}

function buildEvidenceBasis(nativeOutput = {}) {
  const evidence = asObject(nativeOutput.evidenceSupport);
  const outcomes = asObject(nativeOutput.availableOutcomeMetrics);
  return {
    trueSoldCount: firstDefined(evidence.trueSoldDepth, UNKNOWN_VALUE),
    activeListingCount: firstDefined(evidence.activeListingCount, UNKNOWN_VALUE),
    fallbackUsed: Number(firstDefined(evidence.fallbackEvidenceCount, 0)) > 0,
    staleCount: UNKNOWN_VALUE,
    rejectedCount: UNKNOWN_VALUE,
    transactionIneligibleCount: UNKNOWN_VALUE,
    sourceConcentration: clone(firstDefined(evidence.sourceConcentration, UNKNOWN_VALUE)),
    details: {
      readinessStatus: normalizeString(evidence.readinessStatus),
      readinessLevel: normalizeString(evidence.readinessLevel),
      sampleSize: firstDefined(outcomes.sampleSize, UNKNOWN_VALUE),
      outcomeAvailable: firstDefined(outcomes.outcomeAvailable, UNKNOWN_VALUE),
      falsePositiveRate: firstDefined(outcomes.falsePositiveRate, UNKNOWN_VALUE),
      falseNegativeRate: firstDefined(outcomes.falseNegativeRate, UNKNOWN_VALUE),
      observedAgreementRate: firstDefined(asObject(nativeOutput.observedAgreementMetrics).overallAgreementRate, UNKNOWN_VALUE)
    }
  };
}

function buildNormalizedOutput(nativeOutput = {}) {
  const reported = asObject(nativeOutput.reportedConfidence);
  const gap = asObject(nativeOutput.calibrationGap);
  return {
    status: normalizeString(nativeOutput.calibrationStatus),
    confidenceSupportLevel: normalizeString(nativeOutput.confidenceSupportLevel),
    reportedConfidence: firstDefined(reported.confidence, UNKNOWN_VALUE),
    observedAgreementRate: firstDefined(asObject(nativeOutput.observedAgreementMetrics).overallAgreementRate, UNKNOWN_VALUE),
    sampleSize: firstDefined(asObject(nativeOutput.availableOutcomeMetrics).sampleSize, UNKNOWN_VALUE),
    calibrationGap: firstDefined(gap.gap, UNKNOWN_VALUE),
    calibrationGapDirection: normalizeString(gap.direction),
    overconfidenceIndicatorCount: asArray(nativeOutput.overconfidenceIndicators).length,
    underconfidenceIndicatorCount: asArray(nativeOutput.underconfidenceIndicators).length,
    recommendedConfidenceCap: clone(firstDefined(nativeOutput.recommendedConfidenceCap, UNKNOWN_VALUE)),
    recommendedReviewAction: normalizeString(nativeOutput.recommendedReviewAction)
  };
}

function createConfidenceCalibrationAdapter(input = {}) {
  return createSignalMigrationAdapter({
    adapterId: firstDefined(input.adapterId, 'confidence-calibration-signal-adapter'),
    adapterVersion: firstDefined(input.adapterVersion, '1.0.0'),
    engineName: CONFIDENCE_CALIBRATION_PRODUCER,
    supportedEngineVersions: [DEFAULT_CONFIDENCE_CALIBRATION_SIGNAL_VERSION],
    signalName: CONFIDENCE_CALIBRATION_SIGNAL_NAME,
    signalVersion: DEFAULT_CONFIDENCE_CALIBRATION_SIGNAL_VERSION,
    producer: CONFIDENCE_CALIBRATION_PRODUCER,
    producerVersion: DEFAULT_CONFIDENCE_CALIBRATION_SIGNAL_VERSION,
    producerCategory: CONFIDENCE_CALIBRATION_PRODUCER_CATEGORY,
    signalType: 'confidence',
    decisionRole: 'diagnostic_only',
    authorityLevel: 'shadow_observation',
    evidenceRole: 'diagnostic_context',
    nativeOutputAliases: ['nativeOutput', 'confidenceCalibrationOutput', 'diagnosticOutput', 'output'],
    nativeVersionAliases: ['schemaVersion', 'version'],
    requiredNativeFields: ['calibrationStatus', 'confidenceSupportLevel', 'reportedConfidence', 'calibrationGap'],
    optionalNativeFields: ['availableOutcomeMetrics', 'observedAgreementMetrics', 'recommendedConfidenceCap', 'warnings', 'blockingReasons'],
    evidenceMapping: {
      kind: 'declarative',
      sourceFields: ['evidenceSupport', 'availableOutcomeMetrics', 'observedAgreementMetrics'],
      targetFields: ['canonicalSignal.evidenceBasis', 'canonicalSignal.evidenceQuality'],
      semantics: 'confidence_calibration_evidence_and_reviewed_outcome_context'
    },
    confidenceMapping: {
      kind: 'declarative',
      sourceFields: ['reportedConfidence', 'recommendedConfidenceCap'],
      targetFields: ['canonicalSignal.confidence', 'canonicalSignal.confidenceLevel'],
      semantics: 'reported_confidence_preserved_with_diagnostic_cap_context'
    },
    uncertaintyMapping: {
      kind: 'declarative',
      sourceFields: ['calibrationStatus', 'calibrationGap'],
      targetFields: ['canonicalSignal.uncertainty'],
      semantics: 'calibration_status_and_gap_describe_uncertainty'
    },
    statusMapping: {
      kind: 'declarative',
      sourceFields: ['calibrationStatus'],
      targetFields: ['canonicalSignal.normalizedOutput.status'],
      semantics: 'native_calibration_status_preserved'
    },
    metadataMapping: {
      kind: 'declarative',
      sourceFields: ['source', 'schemaVersion'],
      targetFields: ['canonicalSignal.metadata.nativeSource', 'canonicalSignal.metadata.nativeVersion'],
      semantics: 'native_metadata_preserved'
    },
    normalizedOutputMapping: {
      kind: 'approved_handler',
      sourceFields: ['reportedConfidence', 'calibrationGap', 'availableOutcomeMetrics', 'recommendedConfidenceCap'],
      targetFields: ['canonicalSignal.normalizedOutput'],
      handlerRef: 'validation/confidenceCalibrationSignalMigration#buildNormalizedOutput',
      semantics: 'confidence_calibration_summary_projection'
    },
    semanticParityRules: [
      {
        ruleId: 'confidence_calibration_raw_output_exact',
        kind: 'declarative',
        nativeFields: ['*'],
        shadowFields: ['canonicalSignal.rawOutput'],
        comparison: 'raw_output_must_match_exactly'
      },
      {
        ruleId: 'reported_confidence_semantic',
        kind: 'declarative',
        nativeFields: ['reportedConfidence.confidence'],
        shadowFields: ['canonicalSignal.confidence.value'],
        comparison: 'reported_confidence_is_wrapped_as_canonical_confidence_value'
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
    compatibilityNotes: ['wrapper-only migration preserves native Confidence Calibration diagnostic output'],
    createdAt: firstDefined(input.createdAt, UNKNOWN_VALUE)
  });
}

function resolveDefinition(registry, nativeOutput = {}) {
  if (!registry) return null;
  return getSignalDefinition(registry, CONFIDENCE_CALIBRATION_SIGNAL_NAME, signalVersion(nativeOutput));
}

function getRegistryResolutionStatus(registry, definition) {
  if (!registry) return 'registry_missing';
  if (definition) return 'matched';
  if (asArray(registry.definitions).some((item) => item.signalName === CONFIDENCE_CALIBRATION_SIGNAL_NAME)) return 'version_mismatch';
  return 'definition_missing';
}

function buildCanonicalConfidenceCalibrationSignal(input = {}, definition = null) {
  const nativeOutput = clone(asObject(firstDefined(input.nativeOutput, input.confidenceCalibrationOutput, input.diagnosticOutput, input.output, {})));
  const sourceOutputFingerprint = buildSourceOutputFingerprint(nativeOutput, input.sourceOutputFingerprint);
  const producerVersion = signalVersion(nativeOutput, firstDefined(input.producerVersion, definition && definition.producerVersion));
  const reported = asObject(nativeOutput.reportedConfidence);
  const cap = asObject(nativeOutput.recommendedConfidenceCap);
  return createCanonicalSignal({
    signalId: normalizeString(firstDefined(input.signalId, `${CONFIDENCE_CALIBRATION_SIGNAL_NAME}:${sourceOutputFingerprint}`)),
    signalName: CONFIDENCE_CALIBRATION_SIGNAL_NAME,
    producer: {
      producerId: CONFIDENCE_CALIBRATION_PRODUCER,
      name: CONFIDENCE_CALIBRATION_PRODUCER,
      module: 'validation/confidenceCalibrationDiagnostics.js',
      functionName: 'supplied_native_output',
      version: producerVersion,
      category: CONFIDENCE_CALIBRATION_PRODUCER_CATEGORY,
      metadata: {
        migrationSource: CONFIDENCE_CALIBRATION_MIGRATION_SOURCE,
        executesNativeEngine: false
      }
    },
    producerVersion,
    producerCategory: CONFIDENCE_CALIBRATION_PRODUCER_CATEGORY,
    createdAt: normalizeDate(firstDefined(input.createdAt, UNKNOWN_VALUE)),
    signalType: 'confidence',
    decisionRole: 'diagnostic_only',
    authorityLevel: 'shadow_observation',
    confidence: {
      kind: 'reported',
      value: firstDefined(reported.confidence, UNKNOWN_VALUE),
      scale: '0_100',
      basis: normalizeString(firstDefined(reported.source, 'reported_confidence')),
      calibrated: nativeOutput.calibrationStatus === 'calibrated',
      diagnosticCap: firstDefined(cap.recommendedCap, UNKNOWN_VALUE)
    },
    confidenceLevel: confidenceLevel(nativeOutput),
    uncertainty: {
      level: uncertaintyLevel(nativeOutput),
      range: clone(firstDefined(nativeOutput.calibrationGap, UNKNOWN_VALUE)),
      reasonCodes: unique([
        ...asArray(nativeOutput.warnings),
        ...asArray(nativeOutput.blockingReasons)
      ]).sort()
    },
    evidenceBasis: buildEvidenceBasis(nativeOutput),
    evidenceQuality: {
      level: evidenceQualityLevel(nativeOutput),
      score: firstDefined(asObject(nativeOutput.observedAgreementMetrics).calibrationScore, UNKNOWN_VALUE),
      basis: 'confidence_support_level_and_reviewed_outcomes',
      details: {
        evidenceSupport: clone(firstDefined(nativeOutput.evidenceSupport, UNKNOWN_VALUE)),
        availableOutcomeMetrics: clone(firstDefined(nativeOutput.availableOutcomeMetrics, UNKNOWN_VALUE)),
        observedAgreementMetrics: clone(firstDefined(nativeOutput.observedAgreementMetrics, UNKNOWN_VALUE))
      }
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
      migrationSchemaVersion: CONFIDENCE_CALIBRATION_MIGRATION_SCHEMA_VERSION,
      wrapperOnly: true
    }
  });
}

function buildAlignment(input = {}, canonicalSignal, definition, registryResolutionStatus) {
  return createSignalAlignment({
    alignmentId: normalizeString(firstDefined(input.alignmentId, `alignment:${canonicalSignal.signalId}`)),
    createdAt: normalizeDate(firstDefined(input.createdAt, canonicalSignal.createdAt)),
    producer: CONFIDENCE_CALIBRATION_PRODUCER,
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
    schemaVersion: CONFIDENCE_CALIBRATION_MIGRATION_SCHEMA_VERSION,
    source: `${CONFIDENCE_CALIBRATION_MIGRATION_SOURCE}:adapted_signal`,
    adaptationId: normalizeString(firstDefined(input.adaptationId, `adaptation:${canonicalSignal.signalId}`)),
    createdAt: normalizeDate(firstDefined(input.createdAt, canonicalSignal.createdAt)),
    producer: CONFIDENCE_CALIBRATION_PRODUCER,
    signalName: CONFIDENCE_CALIBRATION_SIGNAL_NAME,
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
    alignmentRunId: normalizeString(firstDefined(input.alignmentRunId, input.runId, `confidence-calibration-alignment-run:${adaptedSignal.sourceOutputFingerprint}`)),
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
      migrationSource: CONFIDENCE_CALIBRATION_MIGRATION_SOURCE,
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
  if (!preserved) errors.push(validationIssue('native_output_parity_mismatch', 'Native Confidence Calibration diagnostic output was not preserved exactly.', 'nativeOutput'));
  return {
    parityStatus: preserved ? 'preserved' : 'changed',
    valid: preserved,
    errors,
    warnings: [],
    reasonCodes: unique(errors.map((error) => error.code)).sort()
  };
}

function summarizeConfidenceCalibrationMigration(migration = {}) {
  return deepFreeze({
    ...summarizeSignalMigrationLifecycle(migration),
    schemaVersion: CONFIDENCE_CALIBRATION_MIGRATION_SCHEMA_VERSION,
    migrationId: normalizeString(migration.migrationId),
    signalName: CONFIDENCE_CALIBRATION_SIGNAL_NAME,
    producer: CONFIDENCE_CALIBRATION_PRODUCER,
    nativeSource: normalizeString(migration.nativeOutput && migration.nativeOutput.source),
    nativeVersion: signalVersion(asObject(migration.nativeOutput)),
    calibrationStatus: normalizeString(migration.nativeOutput && migration.nativeOutput.calibrationStatus),
    confidenceSupportLevel: normalizeString(migration.nativeOutput && migration.nativeOutput.confidenceSupportLevel)
  });
}

function buildConfidenceCalibrationMigrationFingerprint(migration = {}) {
  const projection = clone(migration);
  delete projection.migrationFingerprint;
  delete projection.confidenceCalibrationMigrationFingerprint;
  return buildFingerprintFromProjection(projection);
}

function buildCoreArtifact(migration = {}) {
  return createSignalMigrationArtifact({
    migrationId: migration.migrationId,
    createdAt: migration.createdAt,
    engineName: CONFIDENCE_CALIBRATION_PRODUCER,
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
      source: CONFIDENCE_CALIBRATION_MIGRATION_SOURCE
    }
  });
}

function validateConfidenceCalibrationMigration(migration = {}) {
  const errors = [];
  const warnings = [];
  const authorityViolations = [];
  const fingerprintViolations = [];
  const missing = REQUIRED_CONFIDENCE_CALIBRATION_MIGRATION_FIELDS.filter((field) => {
    const value = migration[field];
    return value === undefined || value === null || value === '';
  });

  for (const field of missing) errors.push(validationIssue('missing_required_field', `${field} is required.`, field));
  if (migration.schemaVersion !== CONFIDENCE_CALIBRATION_MIGRATION_SCHEMA_VERSION) errors.push(validationIssue('invalid_schema_version', 'schemaVersion must match Confidence Calibration Signal Migration schema.', 'schemaVersion'));
  if (migration.source !== CONFIDENCE_CALIBRATION_MIGRATION_SOURCE) errors.push(validationIssue('invalid_source', 'source must be confidence_calibration_signal_migration.', 'source'));

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
  if (migration.migrationFingerprint && buildConfidenceCalibrationMigrationFingerprint(migration) !== migration.migrationFingerprint) {
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

function migrateConfidenceCalibrationSignal(input = {}, options = {}) {
  const adapter = createConfidenceCalibrationAdapter({ createdAt: firstDefined(input.createdAt, options.createdAt) });
  const migration = executeSignalMigrationLifecycle(input, options, {
    schemaVersion: CONFIDENCE_CALIBRATION_MIGRATION_SCHEMA_VERSION,
    migrationSource: CONFIDENCE_CALIBRATION_MIGRATION_SOURCE,
    nativeOutputAliases: ['nativeOutput', 'confidenceCalibrationOutput', 'diagnosticOutput', 'output'],
    defaultMigrationIdPrefix: 'confidence-calibration-signal-migration',
    defaultAlignmentBatchId: 'confidence-calibration-signal-alignment-batch',
    defaultConflictAnalysisId: 'confidence-calibration-signal-conflict-analysis',
    defaultReportId: 'confidence-calibration-signal-alignment-report',
    resolveDefinition,
    getRegistryResolutionStatus,
    buildCanonicalSignal: buildCanonicalConfidenceCalibrationSignal,
    buildAlignment,
    buildAdaptedSignal,
    buildAlignmentRun,
    verifyParity,
    summarizeMigration: summarizeConfidenceCalibrationMigration,
    validateMigration: (candidate) => validateConfidenceCalibrationMigration({ ...candidate, adapter, coreArtifact: buildCoreArtifact(candidate) }),
    buildMigrationFingerprint: buildConfidenceCalibrationMigrationFingerprint
  });
  const withCore = {
    ...migration,
    adapter,
    coreArtifact: buildCoreArtifact(migration)
  };
  const withSummary = {
    ...withCore,
    summary: summarizeConfidenceCalibrationMigration(withCore)
  };
  return deepFreeze({
    ...withSummary,
    validation: validateConfidenceCalibrationMigration(withSummary),
    migrationFingerprint: buildConfidenceCalibrationMigrationFingerprint(withSummary)
  });
}

module.exports = {
  CONFIDENCE_CALIBRATION_MIGRATION_SCHEMA_VERSION,
  CONFIDENCE_CALIBRATION_MIGRATION_SOURCE,
  CONFIDENCE_CALIBRATION_PRODUCER,
  CONFIDENCE_CALIBRATION_SIGNAL_NAME,
  DEFAULT_CONFIDENCE_CALIBRATION_SIGNAL_VERSION,
  REQUIRED_CONFIDENCE_CALIBRATION_MIGRATION_FIELDS,
  buildConfidenceCalibrationMigrationFingerprint,
  createConfidenceCalibrationAdapter,
  migrateConfidenceCalibrationSignal,
  summarizeConfidenceCalibrationMigration,
  validateConfidenceCalibrationMigration
};
