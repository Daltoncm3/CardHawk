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
const { getSignalDefinition, validateSignalRegistry } = require('./intelligenceSignalRegistry');
const { createSignalAlignment, validateSignalAlignment, buildSignalAlignmentFingerprint } = require('./signalAlignmentContract');
const { validateAlignmentBatch, buildAlignmentBatchFingerprint } = require('./signalAlignmentBatch');
const { validateSignalAlignmentRun, summarizeSignalAlignmentRun, buildSignalAlignmentRunFingerprint } = require('./signalAlignmentEngine');
const { validateConflictAnalysis, buildConflictAnalysisFingerprint } = require('./signalConflictAnalyzer');
const { validateSignalAlignmentReport, buildSignalAlignmentReportFingerprint } = require('./signalAlignmentReport');
const {
  executeSignalMigrationLifecycle,
  summarizeSignalMigrationLifecycle,
  validateSignalMigrationLifecycle
} = require('./signalMigrationCore');
const { createSignalMigrationAdapter, validateSignalMigrationAdapter } = require('./signalMigrationAdapterContract');
const { createSignalMigrationArtifact } = require('./signalMigrationCoreContract');

const EVIDENCE_READINESS_MIGRATION_SCHEMA_VERSION = '1.0.0';
const EVIDENCE_READINESS_MIGRATION_SOURCE = 'evidence_readiness_signal_migration';
const EVIDENCE_READINESS_SIGNAL_NAME = 'evidence.readiness.diagnostics';
const EVIDENCE_READINESS_PRODUCER = 'evidenceReadinessDiagnostics';
const EVIDENCE_READINESS_PRODUCER_CATEGORY = 'offline_validation';
const DEFAULT_EVIDENCE_READINESS_SIGNAL_VERSION = '1.0.0';

const REQUIRED_EVIDENCE_READINESS_MIGRATION_FIELDS = Object.freeze([
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
  return normalizeString(firstDefined(explicitVersion, nativeOutput.schemaVersion, nativeOutput.version, DEFAULT_EVIDENCE_READINESS_SIGNAL_VERSION));
}

function confidenceLevelFromCap(nativeOutput = {}) {
  const cap = Number(asObject(nativeOutput.confidenceCapRecommendation).recommendedCap);
  if (!Number.isFinite(cap)) return UNKNOWN_VALUE;
  if (cap >= 75) return 'high';
  if (cap >= 45) return 'moderate';
  if (cap > 0) return 'low';
  return 'insufficient';
}

function uncertaintyLevel(nativeOutput = {}) {
  const status = normalizeString(nativeOutput.readinessStatus);
  if (status === 'ready') return 'low';
  if (status === 'conditionally_ready') return 'moderate';
  if (status === 'thin' || status === 'insufficient') return 'high';
  if (status === 'blocked' || status === 'unavailable') return 'extreme';
  return UNKNOWN_VALUE;
}

function evidenceQualityLevel(nativeOutput = {}) {
  const level = normalizeString(nativeOutput.readinessLevel);
  if (level === 'strong') return 'strong';
  if (level === 'adequate') return 'adequate';
  if (level === 'limited') return 'limited';
  if (level === 'insufficient') return 'insufficient';
  if (level === 'blocked') return 'weak';
  if (level === 'unavailable') return 'insufficient';
  return UNKNOWN_VALUE;
}

function buildEvidenceBasis(nativeOutput = {}) {
  const eligible = asObject(nativeOutput.eligibleEvidenceSummary);
  const excluded = asObject(nativeOutput.excludedEvidenceSummary);
  return {
    trueSoldCount: firstDefined(eligible.trueSoldEvidenceCount, UNKNOWN_VALUE),
    activeListingCount: firstDefined(excluded.activeListingCount, UNKNOWN_VALUE),
    fallbackUsed: Number(firstDefined(excluded.fallbackEvidenceCount, 0)) > 0,
    staleCount: firstDefined(excluded.staleEvidenceCount, UNKNOWN_VALUE),
    rejectedCount: firstDefined(excluded.rejectedComparableCount, UNKNOWN_VALUE),
    transactionIneligibleCount: firstDefined(excluded.transactionIneligibleEvidenceCount, UNKNOWN_VALUE),
    sourceConcentration: clone(firstDefined(eligible.sourceConcentration, UNKNOWN_VALUE)),
    details: {
      readinessStatus: normalizeString(nativeOutput.readinessStatus),
      readinessLevel: normalizeString(nativeOutput.readinessLevel),
      minimumTrueSoldRequired: firstDefined(eligible.minimumTrueSoldRequired, UNKNOWN_VALUE),
      exactComparableCount: firstDefined(eligible.exactComparableCount, UNKNOWN_VALUE),
      freshEvidenceCount: firstDefined(eligible.freshEvidenceCount, UNKNOWN_VALUE),
      contextualComparableCount: firstDefined(excluded.contextualComparableCount, UNKNOWN_VALUE),
      duplicateEvidenceCount: firstDefined(excluded.duplicateEvidenceCount, UNKNOWN_VALUE),
      valuationReadiness: clone(firstDefined(nativeOutput.valuationReadiness, UNKNOWN_VALUE))
    }
  };
}

function buildNormalizedOutput(nativeOutput = {}) {
  const eligible = asObject(nativeOutput.eligibleEvidenceSummary);
  const excluded = asObject(nativeOutput.excludedEvidenceSummary);
  const valuation = asObject(nativeOutput.valuationReadiness);
  const cap = asObject(nativeOutput.confidenceCapRecommendation);
  return {
    status: normalizeString(nativeOutput.readinessStatus),
    readinessLevel: normalizeString(nativeOutput.readinessLevel),
    trueSoldEvidenceCount: firstDefined(eligible.trueSoldEvidenceCount, UNKNOWN_VALUE),
    exactComparableCount: firstDefined(eligible.exactComparableCount, UNKNOWN_VALUE),
    activeListingCount: firstDefined(excluded.activeListingCount, UNKNOWN_VALUE),
    fallbackEvidenceCount: firstDefined(excluded.fallbackEvidenceCount, UNKNOWN_VALUE),
    contextualComparableCount: firstDefined(excluded.contextualComparableCount, UNKNOWN_VALUE),
    rejectedComparableCount: firstDefined(excluded.rejectedComparableCount, UNKNOWN_VALUE),
    staleEvidenceCount: firstDefined(excluded.staleEvidenceCount, UNKNOWN_VALUE),
    duplicateEvidenceCount: firstDefined(excluded.duplicateEvidenceCount, UNKNOWN_VALUE),
    transactionIneligibleEvidenceCount: firstDefined(excluded.transactionIneligibleEvidenceCount, UNKNOWN_VALUE),
    diagnosticallyReady: firstDefined(valuation.diagnosticallyReady, UNKNOWN_VALUE),
    shouldWithholdValuationDiagnostically: firstDefined(valuation.shouldWithholdValuationDiagnostically, UNKNOWN_VALUE),
    confidenceCapRecommendation: clone(firstDefined(nativeOutput.confidenceCapRecommendation, UNKNOWN_VALUE)),
    recommendedConfidenceCap: firstDefined(cap.recommendedCap, UNKNOWN_VALUE),
    recommendedReviewAction: normalizeString(nativeOutput.recommendedReviewAction)
  };
}

function createEvidenceReadinessAdapter(input = {}) {
  return createSignalMigrationAdapter({
    adapterId: firstDefined(input.adapterId, 'evidence-readiness-signal-adapter'),
    adapterVersion: firstDefined(input.adapterVersion, '1.0.0'),
    engineName: EVIDENCE_READINESS_PRODUCER,
    supportedEngineVersions: [DEFAULT_EVIDENCE_READINESS_SIGNAL_VERSION],
    signalName: EVIDENCE_READINESS_SIGNAL_NAME,
    signalVersion: DEFAULT_EVIDENCE_READINESS_SIGNAL_VERSION,
    producer: EVIDENCE_READINESS_PRODUCER,
    producerVersion: DEFAULT_EVIDENCE_READINESS_SIGNAL_VERSION,
    producerCategory: EVIDENCE_READINESS_PRODUCER_CATEGORY,
    signalType: 'evidence',
    decisionRole: 'diagnostic_only',
    authorityLevel: 'shadow_observation',
    evidenceRole: 'diagnostic_context',
    nativeOutputAliases: ['nativeOutput', 'evidenceReadinessOutput', 'diagnosticOutput', 'output'],
    nativeVersionAliases: ['schemaVersion', 'version'],
    requiredNativeFields: ['readinessStatus', 'readinessLevel', 'eligibleEvidenceSummary', 'excludedEvidenceSummary', 'valuationReadiness'],
    optionalNativeFields: ['blockingReasons', 'warnings', 'evidenceUsed', 'evidenceExcluded', 'comparableQuality', 'identityExactness', 'confidenceCapRecommendation'],
    evidenceMapping: {
      kind: 'declarative',
      sourceFields: ['eligibleEvidenceSummary', 'excludedEvidenceSummary', 'evidenceUsed', 'evidenceExcluded'],
      targetFields: ['canonicalSignal.evidenceBasis', 'canonicalSignal.evidenceQuality'],
      semantics: 'readiness_counts_and_exclusions_are_wrapped_as_diagnostic_evidence_context'
    },
    confidenceMapping: {
      kind: 'declarative',
      sourceFields: ['confidenceCapRecommendation'],
      targetFields: ['canonicalSignal.confidence', 'canonicalSignal.confidenceLevel'],
      semantics: 'confidence_cap_is_diagnostic_not_production_confidence'
    },
    uncertaintyMapping: {
      kind: 'declarative',
      sourceFields: ['readinessStatus'],
      targetFields: ['canonicalSignal.uncertainty.level'],
      semantics: 'readiness_status_maps_to_diagnostic_uncertainty'
    },
    statusMapping: {
      kind: 'declarative',
      sourceFields: ['readinessStatus', 'readinessLevel'],
      targetFields: ['canonicalSignal.normalizedOutput.status', 'canonicalSignal.normalizedOutput.readinessLevel'],
      semantics: 'native_readiness_status_and_level_preserved'
    },
    metadataMapping: {
      kind: 'declarative',
      sourceFields: ['source', 'schemaVersion'],
      targetFields: ['canonicalSignal.metadata.nativeSource', 'canonicalSignal.metadata.nativeVersion'],
      semantics: 'native_metadata_preserved'
    },
    normalizedOutputMapping: {
      kind: 'approved_handler',
      sourceFields: ['eligibleEvidenceSummary', 'excludedEvidenceSummary', 'valuationReadiness', 'confidenceCapRecommendation'],
      targetFields: ['canonicalSignal.normalizedOutput'],
      handlerRef: 'validation/evidenceReadinessSignalMigration#buildNormalizedOutput',
      semantics: 'evidence_readiness_summary_projection'
    },
    semanticParityRules: [
      {
        ruleId: 'evidence_readiness_raw_output_exact',
        kind: 'declarative',
        nativeFields: ['*'],
        shadowFields: ['canonicalSignal.rawOutput'],
        comparison: 'raw_output_must_match_exactly'
      },
      {
        ruleId: 'readiness_counts_semantic',
        kind: 'declarative',
        nativeFields: ['eligibleEvidenceSummary', 'excludedEvidenceSummary'],
        shadowFields: ['canonicalSignal.evidenceBasis'],
        comparison: 'readiness_counts_are_wrapped_as_evidence_basis'
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
    compatibilityNotes: ['wrapper-only migration preserves native Evidence Readiness diagnostic output'],
    createdAt: firstDefined(input.createdAt, UNKNOWN_VALUE)
  });
}

function resolveDefinition(registry, nativeOutput = {}) {
  if (!registry) return null;
  return getSignalDefinition(registry, EVIDENCE_READINESS_SIGNAL_NAME, signalVersion(nativeOutput));
}

function getRegistryResolutionStatus(registry, definition) {
  if (!registry) return 'registry_missing';
  if (definition) return 'matched';
  if (asArray(registry.definitions).some((item) => item.signalName === EVIDENCE_READINESS_SIGNAL_NAME)) return 'version_mismatch';
  return 'definition_missing';
}

function buildCanonicalEvidenceReadinessSignal(input = {}, definition = null) {
  const nativeOutput = clone(asObject(firstDefined(input.nativeOutput, input.evidenceReadinessOutput, input.diagnosticOutput, input.output, {})));
  const sourceOutputFingerprint = buildSourceOutputFingerprint(nativeOutput, input.sourceOutputFingerprint);
  const producerVersion = signalVersion(nativeOutput, firstDefined(input.producerVersion, definition && definition.producerVersion));
  const cap = asObject(nativeOutput.confidenceCapRecommendation);
  return createCanonicalSignal({
    signalId: normalizeString(firstDefined(input.signalId, `${EVIDENCE_READINESS_SIGNAL_NAME}:${sourceOutputFingerprint}`)),
    signalName: EVIDENCE_READINESS_SIGNAL_NAME,
    producer: {
      producerId: EVIDENCE_READINESS_PRODUCER,
      name: EVIDENCE_READINESS_PRODUCER,
      module: 'validation/evidenceReadinessDiagnostics.js',
      functionName: 'supplied_native_output',
      version: producerVersion,
      category: EVIDENCE_READINESS_PRODUCER_CATEGORY,
      metadata: {
        migrationSource: EVIDENCE_READINESS_MIGRATION_SOURCE,
        executesNativeEngine: false
      }
    },
    producerVersion,
    producerCategory: EVIDENCE_READINESS_PRODUCER_CATEGORY,
    createdAt: normalizeDate(firstDefined(input.createdAt, UNKNOWN_VALUE)),
    signalType: 'evidence',
    decisionRole: 'diagnostic_only',
    authorityLevel: 'shadow_observation',
    confidence: {
      kind: 'derived',
      value: firstDefined(cap.recommendedCap, UNKNOWN_VALUE),
      scale: '0_100',
      basis: normalizeString(firstDefined(cap.reason, 'evidence_readiness_diagnostic_confidence_cap')),
      calibrated: false
    },
    confidenceLevel: confidenceLevelFromCap(nativeOutput),
    uncertainty: {
      level: uncertaintyLevel(nativeOutput),
      range: UNKNOWN_VALUE,
      reasonCodes: unique([
        ...asArray(nativeOutput.blockingReasons),
        ...asArray(nativeOutput.warnings)
      ]).sort()
    },
    evidenceBasis: buildEvidenceBasis(nativeOutput),
    evidenceQuality: {
      level: evidenceQualityLevel(nativeOutput),
      score: firstDefined(asObject(nativeOutput.comparableQuality).averageComparableQualityScore, UNKNOWN_VALUE),
      basis: 'evidence_readiness_level',
      details: {
        eligibleEvidenceSummary: clone(firstDefined(nativeOutput.eligibleEvidenceSummary, UNKNOWN_VALUE)),
        excludedEvidenceSummary: clone(firstDefined(nativeOutput.excludedEvidenceSummary, UNKNOWN_VALUE))
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
      migrationSchemaVersion: EVIDENCE_READINESS_MIGRATION_SCHEMA_VERSION,
      wrapperOnly: true
    }
  });
}

function buildAlignment(input = {}, canonicalSignal, definition, registryResolutionStatus) {
  return createSignalAlignment({
    alignmentId: normalizeString(firstDefined(input.alignmentId, `alignment:${canonicalSignal.signalId}`)),
    createdAt: normalizeDate(firstDefined(input.createdAt, canonicalSignal.createdAt)),
    producer: EVIDENCE_READINESS_PRODUCER,
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
    schemaVersion: EVIDENCE_READINESS_MIGRATION_SCHEMA_VERSION,
    source: `${EVIDENCE_READINESS_MIGRATION_SOURCE}:adapted_signal`,
    adaptationId: normalizeString(firstDefined(input.adaptationId, `adaptation:${canonicalSignal.signalId}`)),
    createdAt: normalizeDate(firstDefined(input.createdAt, canonicalSignal.createdAt)),
    producer: EVIDENCE_READINESS_PRODUCER,
    signalName: EVIDENCE_READINESS_SIGNAL_NAME,
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
    alignmentRunId: normalizeString(firstDefined(input.alignmentRunId, input.runId, `evidence-readiness-alignment-run:${adaptedSignal.sourceOutputFingerprint}`)),
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
      migrationSource: EVIDENCE_READINESS_MIGRATION_SOURCE,
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
  if (!preserved) errors.push(validationIssue('native_output_parity_mismatch', 'Native Evidence Readiness diagnostic output was not preserved exactly.', 'nativeOutput'));
  return {
    parityStatus: preserved ? 'preserved' : 'changed',
    valid: preserved,
    errors,
    warnings: [],
    reasonCodes: unique(errors.map((error) => error.code)).sort()
  };
}

function summarizeEvidenceReadinessMigration(migration = {}) {
  return deepFreeze({
    ...summarizeSignalMigrationLifecycle(migration),
    schemaVersion: EVIDENCE_READINESS_MIGRATION_SCHEMA_VERSION,
    migrationId: normalizeString(migration.migrationId),
    signalName: EVIDENCE_READINESS_SIGNAL_NAME,
    producer: EVIDENCE_READINESS_PRODUCER,
    nativeSource: normalizeString(migration.nativeOutput && migration.nativeOutput.source),
    nativeVersion: signalVersion(asObject(migration.nativeOutput)),
    readinessStatus: normalizeString(migration.nativeOutput && migration.nativeOutput.readinessStatus),
    readinessLevel: normalizeString(migration.nativeOutput && migration.nativeOutput.readinessLevel)
  });
}

function buildEvidenceReadinessMigrationFingerprint(migration = {}) {
  const projection = clone(migration);
  delete projection.migrationFingerprint;
  delete projection.evidenceReadinessMigrationFingerprint;
  return buildFingerprintFromProjection(projection);
}

function buildCoreArtifact(migration = {}) {
  return createSignalMigrationArtifact({
    migrationId: migration.migrationId,
    createdAt: migration.createdAt,
    engineName: EVIDENCE_READINESS_PRODUCER,
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
      source: EVIDENCE_READINESS_MIGRATION_SOURCE
    }
  });
}

function validateEvidenceReadinessMigration(migration = {}) {
  const errors = [];
  const warnings = [];
  const authorityViolations = [];
  const fingerprintViolations = [];
  const missing = REQUIRED_EVIDENCE_READINESS_MIGRATION_FIELDS.filter((field) => {
    const value = migration[field];
    return value === undefined || value === null || value === '';
  });

  for (const field of missing) errors.push(validationIssue('missing_required_field', `${field} is required.`, field));
  if (migration.schemaVersion !== EVIDENCE_READINESS_MIGRATION_SCHEMA_VERSION) errors.push(validationIssue('invalid_schema_version', 'schemaVersion must match Evidence Readiness Signal Migration schema.', 'schemaVersion'));
  if (migration.source !== EVIDENCE_READINESS_MIGRATION_SOURCE) errors.push(validationIssue('invalid_source', 'source must be evidence_readiness_signal_migration.', 'source'));

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
  if (migration.migrationFingerprint && buildEvidenceReadinessMigrationFingerprint(migration) !== migration.migrationFingerprint) {
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

function migrateEvidenceReadinessSignal(input = {}, options = {}) {
  const adapter = createEvidenceReadinessAdapter({ createdAt: firstDefined(input.createdAt, options.createdAt) });
  const migration = executeSignalMigrationLifecycle(input, options, {
    schemaVersion: EVIDENCE_READINESS_MIGRATION_SCHEMA_VERSION,
    migrationSource: EVIDENCE_READINESS_MIGRATION_SOURCE,
    nativeOutputAliases: ['nativeOutput', 'evidenceReadinessOutput', 'diagnosticOutput', 'output'],
    defaultMigrationIdPrefix: 'evidence-readiness-signal-migration',
    defaultAlignmentBatchId: 'evidence-readiness-signal-alignment-batch',
    defaultConflictAnalysisId: 'evidence-readiness-signal-conflict-analysis',
    defaultReportId: 'evidence-readiness-signal-alignment-report',
    resolveDefinition,
    getRegistryResolutionStatus,
    buildCanonicalSignal: buildCanonicalEvidenceReadinessSignal,
    buildAlignment,
    buildAdaptedSignal,
    buildAlignmentRun,
    verifyParity,
    summarizeMigration: summarizeEvidenceReadinessMigration,
    validateMigration: (candidate) => validateEvidenceReadinessMigration({ ...candidate, adapter, coreArtifact: buildCoreArtifact(candidate) }),
    buildMigrationFingerprint: buildEvidenceReadinessMigrationFingerprint
  });
  const withCore = {
    ...migration,
    adapter,
    coreArtifact: buildCoreArtifact(migration)
  };
  const withSummary = {
    ...withCore,
    summary: summarizeEvidenceReadinessMigration(withCore)
  };
  return deepFreeze({
    ...withSummary,
    validation: validateEvidenceReadinessMigration(withSummary),
    migrationFingerprint: buildEvidenceReadinessMigrationFingerprint(withSummary)
  });
}

module.exports = {
  DEFAULT_EVIDENCE_READINESS_SIGNAL_VERSION,
  EVIDENCE_READINESS_MIGRATION_SCHEMA_VERSION,
  EVIDENCE_READINESS_MIGRATION_SOURCE,
  EVIDENCE_READINESS_PRODUCER,
  EVIDENCE_READINESS_SIGNAL_NAME,
  REQUIRED_EVIDENCE_READINESS_MIGRATION_FIELDS,
  buildEvidenceReadinessMigrationFingerprint,
  createEvidenceReadinessAdapter,
  migrateEvidenceReadinessSignal,
  summarizeEvidenceReadinessMigration,
  validateEvidenceReadinessMigration
};
