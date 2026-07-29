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

const COMPARABLE_QUALITY_MIGRATION_SCHEMA_VERSION = '1.0.0';
const COMPARABLE_QUALITY_MIGRATION_SOURCE = 'comparable_quality_signal_migration';
const COMPARABLE_QUALITY_SIGNAL_NAME = 'comparable.quality.diagnostics';
const COMPARABLE_QUALITY_PRODUCER = 'comparableQualityEngine';
const COMPARABLE_QUALITY_PRODUCER_CATEGORY = 'production_engine';
const DEFAULT_COMPARABLE_QUALITY_SIGNAL_VERSION = '1.0.0';

const REQUIRED_COMPARABLE_QUALITY_MIGRATION_FIELDS = Object.freeze([
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
  return normalizeString(firstDefined(explicitVersion, nativeOutput.schemaVersion, nativeOutput.version, DEFAULT_COMPARABLE_QUALITY_SIGNAL_VERSION));
}

function qualityScore(nativeOutput = {}) {
  return firstDefined(nativeOutput.averageComparableQualityScore, nativeOutput.qualityScore, UNKNOWN_VALUE);
}

function confidenceLevel(nativeOutput = {}) {
  const value = Number(qualityScore(nativeOutput));
  if (!Number.isFinite(value)) return UNKNOWN_VALUE;
  if (value >= 80) return 'high';
  if (value >= 55) return 'moderate';
  if (value > 0) return 'low';
  return 'insufficient';
}

function uncertaintyLevel(nativeOutput = {}) {
  const score = Number(qualityScore(nativeOutput));
  const rejectCount = Number(firstDefined(asObject(nativeOutput.qualityDistribution).reject, 0));
  if (!Number.isFinite(score)) return UNKNOWN_VALUE;
  if (rejectCount > 0 || score < 25) return 'extreme';
  if (score < 55) return 'high';
  if (score < 80) return 'moderate';
  return 'low';
}

function evidenceQualityLevel(nativeOutput = {}) {
  const score = Number(qualityScore(nativeOutput));
  if (!Number.isFinite(score)) return UNKNOWN_VALUE;
  if (score >= 80) return 'strong';
  if (score >= 55) return 'adequate';
  if (score >= 25) return 'limited';
  if (score > 0) return 'weak';
  return 'insufficient';
}

function buildEvidenceBasis(nativeOutput = {}) {
  const sampleDepth = asObject(nativeOutput.sampleDepth);
  const distribution = asObject(nativeOutput.qualityDistribution);
  return {
    trueSoldCount: firstDefined(sampleDepth.trueSoldCount, UNKNOWN_VALUE),
    activeListingCount: firstDefined(sampleDepth.activeCount, UNKNOWN_VALUE),
    fallbackUsed: Number(firstDefined(sampleDepth.fallbackUnknownCount, 0)) > 0,
    staleCount: UNKNOWN_VALUE,
    rejectedCount: firstDefined(distribution.reject, UNKNOWN_VALUE),
    transactionIneligibleCount: UNKNOWN_VALUE,
    sourceConcentration: clone(firstDefined(nativeOutput.sourceDiversity, UNKNOWN_VALUE)),
    details: {
      comparableCount: firstDefined(nativeOutput.comparableCount, UNKNOWN_VALUE),
      scoredComparableCount: firstDefined(nativeOutput.scoredComparableCount, UNKNOWN_VALUE),
      averageComparableQualityScore: qualityScore(nativeOutput),
      qualityDistribution: clone(firstDefined(nativeOutput.qualityDistribution, UNKNOWN_VALUE)),
      sampleDepth: clone(firstDefined(nativeOutput.sampleDepth, UNKNOWN_VALUE)),
      averageAgeDays: firstDefined(nativeOutput.averageAgeDays, UNKNOWN_VALUE),
      sourceDiversity: clone(firstDefined(nativeOutput.sourceDiversity, UNKNOWN_VALUE)),
      knownConditionRate: firstDefined(nativeOutput.knownConditionRate, UNKNOWN_VALUE),
      conditionMatchRate: firstDefined(nativeOutput.conditionMatchRate, UNKNOWN_VALUE)
    }
  };
}

function buildNormalizedOutput(nativeOutput = {}) {
  const sampleDepth = asObject(nativeOutput.sampleDepth);
  return {
    source: normalizeString(nativeOutput.source),
    comparableCount: firstDefined(nativeOutput.comparableCount, UNKNOWN_VALUE),
    scoredComparableCount: firstDefined(nativeOutput.scoredComparableCount, UNKNOWN_VALUE),
    averageComparableQualityScore: qualityScore(nativeOutput),
    qualityBand: evidenceQualityLevel(nativeOutput),
    trueSoldCount: firstDefined(sampleDepth.trueSoldCount, UNKNOWN_VALUE),
    activeCount: firstDefined(sampleDepth.activeCount, UNKNOWN_VALUE),
    fallbackUnknownCount: firstDefined(sampleDepth.fallbackUnknownCount, UNKNOWN_VALUE),
    averageAgeDays: firstDefined(nativeOutput.averageAgeDays, UNKNOWN_VALUE),
    sourceDiversity: clone(firstDefined(nativeOutput.sourceDiversity, UNKNOWN_VALUE)),
    knownConditionRate: firstDefined(nativeOutput.knownConditionRate, UNKNOWN_VALUE),
    conditionMatchRate: firstDefined(nativeOutput.conditionMatchRate, UNKNOWN_VALUE),
    qualityDistribution: clone(firstDefined(nativeOutput.qualityDistribution, UNKNOWN_VALUE)),
    warningCount: asArray(nativeOutput.warnings).length,
    summary: normalizeString(nativeOutput.summary)
  };
}

function createComparableQualityAdapter(input = {}) {
  return createSignalMigrationAdapter({
    adapterId: firstDefined(input.adapterId, 'comparable-quality-signal-adapter'),
    adapterVersion: firstDefined(input.adapterVersion, '1.0.0'),
    engineName: COMPARABLE_QUALITY_PRODUCER,
    supportedEngineVersions: [DEFAULT_COMPARABLE_QUALITY_SIGNAL_VERSION],
    signalName: COMPARABLE_QUALITY_SIGNAL_NAME,
    signalVersion: DEFAULT_COMPARABLE_QUALITY_SIGNAL_VERSION,
    producer: COMPARABLE_QUALITY_PRODUCER,
    producerVersion: DEFAULT_COMPARABLE_QUALITY_SIGNAL_VERSION,
    producerCategory: COMPARABLE_QUALITY_PRODUCER_CATEGORY,
    signalType: 'quality',
    decisionRole: 'diagnostic_only',
    authorityLevel: 'shadow_observation',
    evidenceRole: 'diagnostic_context',
    nativeOutputAliases: ['nativeOutput', 'comparableQualityOutput', 'comparableQuality', 'diagnosticOutput', 'output'],
    nativeVersionAliases: ['schemaVersion', 'version'],
    requiredNativeFields: ['source', 'comparableCount', 'scoredComparableCount', 'averageComparableQualityScore', 'qualityDistribution'],
    optionalNativeFields: ['scoredComps', 'sampleDepth', 'averageAgeDays', 'sourceDiversity', 'knownConditionRate', 'conditionMatchRate', 'warnings', 'summary'],
    evidenceMapping: {
      kind: 'declarative',
      sourceFields: ['sampleDepth', 'qualityDistribution', 'sourceDiversity', 'scoredComps'],
      targetFields: ['canonicalSignal.evidenceBasis', 'canonicalSignal.evidenceQuality'],
      semantics: 'comparable_quality_counts_similarity_and_coverage_wrapped_as_diagnostic_context'
    },
    confidenceMapping: {
      kind: 'declarative',
      sourceFields: ['averageComparableQualityScore'],
      targetFields: ['canonicalSignal.confidence', 'canonicalSignal.confidenceLevel'],
      semantics: 'average_comparable_quality_score_is_diagnostic_not_production_confidence'
    },
    uncertaintyMapping: {
      kind: 'declarative',
      sourceFields: ['averageComparableQualityScore', 'qualityDistribution'],
      targetFields: ['canonicalSignal.uncertainty.level'],
      semantics: 'quality_score_and_reject_distribution_map_to_diagnostic_uncertainty'
    },
    statusMapping: {
      kind: 'declarative',
      sourceFields: ['source', 'summary'],
      targetFields: ['canonicalSignal.normalizedOutput.source', 'canonicalSignal.normalizedOutput.summary'],
      semantics: 'native_comparable_quality_source_and_summary_preserved'
    },
    metadataMapping: {
      kind: 'declarative',
      sourceFields: ['source', 'schemaVersion'],
      targetFields: ['canonicalSignal.metadata.nativeSource', 'canonicalSignal.metadata.nativeVersion'],
      semantics: 'native_metadata_preserved'
    },
    normalizedOutputMapping: {
      kind: 'approved_handler',
      sourceFields: ['comparableCount', 'scoredComparableCount', 'averageComparableQualityScore', 'qualityDistribution', 'sampleDepth'],
      targetFields: ['canonicalSignal.normalizedOutput'],
      handlerRef: 'validation/comparableQualitySignalMigration#buildNormalizedOutput',
      semantics: 'comparable_quality_summary_projection'
    },
    semanticParityRules: [
      {
        ruleId: 'comparable_quality_raw_output_exact',
        kind: 'declarative',
        nativeFields: ['*'],
        shadowFields: ['canonicalSignal.rawOutput'],
        comparison: 'raw_output_must_match_exactly'
      },
      {
        ruleId: 'comparable_quality_coverage_semantic',
        kind: 'declarative',
        nativeFields: ['sampleDepth', 'qualityDistribution', 'averageComparableQualityScore'],
        shadowFields: ['canonicalSignal.evidenceBasis', 'canonicalSignal.evidenceQuality'],
        comparison: 'quality_and_coverage_fields_are_wrapped_as_diagnostic_context'
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
    compatibilityNotes: ['wrapper-only migration preserves native Comparable Quality output'],
    createdAt: firstDefined(input.createdAt, UNKNOWN_VALUE)
  });
}

function resolveDefinition(registry, nativeOutput = {}) {
  if (!registry) return null;
  return getSignalDefinition(registry, COMPARABLE_QUALITY_SIGNAL_NAME, signalVersion(nativeOutput));
}

function getRegistryResolutionStatus(registry, definition) {
  if (!registry) return 'registry_missing';
  if (definition) return 'matched';
  if (asArray(registry.definitions).some((item) => item.signalName === COMPARABLE_QUALITY_SIGNAL_NAME)) return 'version_mismatch';
  return 'definition_missing';
}

function buildCanonicalComparableQualitySignal(input = {}, definition = null) {
  const nativeOutput = clone(asObject(firstDefined(input.nativeOutput, input.comparableQualityOutput, input.comparableQuality, input.diagnosticOutput, input.output, {})));
  const sourceOutputFingerprint = buildSourceOutputFingerprint(nativeOutput, input.sourceOutputFingerprint);
  const producerVersion = signalVersion(nativeOutput, firstDefined(input.producerVersion, definition && definition.producerVersion));
  const score = qualityScore(nativeOutput);
  return createCanonicalSignal({
    signalId: normalizeString(firstDefined(input.signalId, `${COMPARABLE_QUALITY_SIGNAL_NAME}:${sourceOutputFingerprint}`)),
    signalName: COMPARABLE_QUALITY_SIGNAL_NAME,
    producer: {
      producerId: COMPARABLE_QUALITY_PRODUCER,
      name: COMPARABLE_QUALITY_PRODUCER,
      module: 'engines/comparableQualityEngine.js',
      functionName: 'supplied_native_output',
      version: producerVersion,
      category: COMPARABLE_QUALITY_PRODUCER_CATEGORY,
      metadata: {
        migrationSource: COMPARABLE_QUALITY_MIGRATION_SOURCE,
        executesNativeEngine: false
      }
    },
    producerVersion,
    producerCategory: COMPARABLE_QUALITY_PRODUCER_CATEGORY,
    createdAt: normalizeDate(firstDefined(input.createdAt, UNKNOWN_VALUE)),
    signalType: 'quality',
    decisionRole: 'diagnostic_only',
    authorityLevel: 'shadow_observation',
    confidence: {
      kind: 'derived',
      value: score,
      scale: score === UNKNOWN_VALUE ? UNKNOWN_VALUE : '0_100',
      basis: 'average_comparable_quality_score',
      calibrated: false
    },
    confidenceLevel: confidenceLevel(nativeOutput),
    uncertainty: {
      level: uncertaintyLevel(nativeOutput),
      range: UNKNOWN_VALUE,
      reasonCodes: unique([
        ...asArray(nativeOutput.warnings),
        normalizeString(nativeOutput.summary, '')
      ]).sort()
    },
    evidenceBasis: buildEvidenceBasis(nativeOutput),
    evidenceQuality: {
      level: evidenceQualityLevel(nativeOutput),
      score,
      basis: 'average_comparable_quality_score',
      details: {
        qualityDistribution: clone(firstDefined(nativeOutput.qualityDistribution, UNKNOWN_VALUE)),
        sampleDepth: clone(firstDefined(nativeOutput.sampleDepth, UNKNOWN_VALUE)),
        sourceDiversity: clone(firstDefined(nativeOutput.sourceDiversity, UNKNOWN_VALUE))
      }
    },
    evidenceReferences: asArray(input.evidenceReferences),
    supportingSignals: asArray(input.supportingSignals),
    conflictingSignals: asArray(input.conflictingSignals),
    warnings: asArray(nativeOutput.warnings),
    blockers: asArray(nativeOutput.blockers),
    rawOutput: nativeOutput,
    normalizedOutput: buildNormalizedOutput(nativeOutput),
    sourceFingerprint: sourceOutputFingerprint,
    metadata: {
      nativeSource: normalizeString(nativeOutput.source),
      nativeVersion: producerVersion,
      migrationSchemaVersion: COMPARABLE_QUALITY_MIGRATION_SCHEMA_VERSION,
      wrapperOnly: true
    }
  });
}

function buildAlignment(input = {}, canonicalSignal, definition, registryResolutionStatus) {
  return createSignalAlignment({
    alignmentId: normalizeString(firstDefined(input.alignmentId, `alignment:${canonicalSignal.signalId}`)),
    createdAt: normalizeDate(firstDefined(input.createdAt, canonicalSignal.createdAt)),
    producer: COMPARABLE_QUALITY_PRODUCER,
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
      nativeStatus: normalizeString(canonicalSignal.normalizedOutput && canonicalSignal.normalizedOutput.source),
      wrapperOnly: true
    }
  });
}

function buildAdaptedSignal(input = {}, canonicalSignal, alignment, definition, registryResolutionStatus) {
  const core = {
    schemaVersion: COMPARABLE_QUALITY_MIGRATION_SCHEMA_VERSION,
    source: `${COMPARABLE_QUALITY_MIGRATION_SOURCE}:adapted_signal`,
    adaptationId: normalizeString(firstDefined(input.adaptationId, `adaptation:${canonicalSignal.signalId}`)),
    createdAt: normalizeDate(firstDefined(input.createdAt, canonicalSignal.createdAt)),
    producer: COMPARABLE_QUALITY_PRODUCER,
    signalName: COMPARABLE_QUALITY_SIGNAL_NAME,
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
    alignmentRunId: normalizeString(firstDefined(input.alignmentRunId, input.runId, `comparable-quality-alignment-run:${adaptedSignal.sourceOutputFingerprint}`)),
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
      migrationSource: COMPARABLE_QUALITY_MIGRATION_SOURCE,
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
  if (!preserved) errors.push(validationIssue('native_output_parity_mismatch', 'Native Comparable Quality output was not preserved exactly.', 'nativeOutput'));
  return {
    parityStatus: preserved ? 'preserved' : 'changed',
    valid: preserved,
    errors,
    warnings: [],
    reasonCodes: unique(errors.map((error) => error.code)).sort()
  };
}

function summarizeComparableQualityMigration(migration = {}) {
  return deepFreeze({
    ...summarizeSignalMigrationLifecycle(migration),
    schemaVersion: COMPARABLE_QUALITY_MIGRATION_SCHEMA_VERSION,
    migrationId: normalizeString(migration.migrationId),
    signalName: COMPARABLE_QUALITY_SIGNAL_NAME,
    producer: COMPARABLE_QUALITY_PRODUCER,
    nativeSource: normalizeString(migration.nativeOutput && migration.nativeOutput.source),
    nativeVersion: signalVersion(asObject(migration.nativeOutput)),
    averageComparableQualityScore: qualityScore(asObject(migration.nativeOutput)),
    scoredComparableCount: firstDefined(migration.nativeOutput && migration.nativeOutput.scoredComparableCount, UNKNOWN_VALUE)
  });
}

function buildComparableQualityMigrationFingerprint(migration = {}) {
  const projection = clone(migration);
  delete projection.migrationFingerprint;
  delete projection.comparableQualityMigrationFingerprint;
  return buildFingerprintFromProjection(projection);
}

function buildCoreArtifact(migration = {}) {
  return createSignalMigrationArtifact({
    migrationId: migration.migrationId,
    createdAt: migration.createdAt,
    engineName: COMPARABLE_QUALITY_PRODUCER,
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
      source: COMPARABLE_QUALITY_MIGRATION_SOURCE
    }
  });
}

function validateComparableQualityMigration(migration = {}) {
  const errors = [];
  const warnings = [];
  const authorityViolations = [];
  const fingerprintViolations = [];
  const missing = REQUIRED_COMPARABLE_QUALITY_MIGRATION_FIELDS.filter((field) => {
    const value = migration[field];
    return value === undefined || value === null || value === '';
  });

  for (const field of missing) errors.push(validationIssue('missing_required_field', `${field} is required.`, field));
  if (migration.schemaVersion !== COMPARABLE_QUALITY_MIGRATION_SCHEMA_VERSION) errors.push(validationIssue('invalid_schema_version', 'schemaVersion must match Comparable Quality Signal Migration schema.', 'schemaVersion'));
  if (migration.source !== COMPARABLE_QUALITY_MIGRATION_SOURCE) errors.push(validationIssue('invalid_source', 'source must be comparable_quality_signal_migration.', 'source'));

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
  if (migration.migrationFingerprint && buildComparableQualityMigrationFingerprint(migration) !== migration.migrationFingerprint) {
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

function migrateComparableQualitySignal(input = {}, options = {}) {
  const adapter = createComparableQualityAdapter({ createdAt: firstDefined(input.createdAt, options.createdAt) });
  const migration = executeSignalMigrationLifecycle(input, options, {
    schemaVersion: COMPARABLE_QUALITY_MIGRATION_SCHEMA_VERSION,
    migrationSource: COMPARABLE_QUALITY_MIGRATION_SOURCE,
    nativeOutputAliases: ['nativeOutput', 'comparableQualityOutput', 'comparableQuality', 'diagnosticOutput', 'output'],
    defaultMigrationIdPrefix: 'comparable-quality-signal-migration',
    defaultAlignmentBatchId: 'comparable-quality-signal-alignment-batch',
    defaultConflictAnalysisId: 'comparable-quality-signal-conflict-analysis',
    defaultReportId: 'comparable-quality-signal-alignment-report',
    resolveDefinition,
    getRegistryResolutionStatus,
    buildCanonicalSignal: buildCanonicalComparableQualitySignal,
    buildAlignment,
    buildAdaptedSignal,
    buildAlignmentRun,
    verifyParity,
    summarizeMigration: summarizeComparableQualityMigration,
    validateMigration: (candidate) => validateComparableQualityMigration({ ...candidate, adapter, coreArtifact: buildCoreArtifact(candidate) }),
    buildMigrationFingerprint: buildComparableQualityMigrationFingerprint
  });
  const withCore = {
    ...migration,
    adapter,
    coreArtifact: buildCoreArtifact(migration)
  };
  const withSummary = {
    ...withCore,
    summary: summarizeComparableQualityMigration(withCore)
  };
  return deepFreeze({
    ...withSummary,
    validation: validateComparableQualityMigration(withSummary),
    migrationFingerprint: buildComparableQualityMigrationFingerprint(withSummary)
  });
}

module.exports = {
  COMPARABLE_QUALITY_MIGRATION_SCHEMA_VERSION,
  COMPARABLE_QUALITY_MIGRATION_SOURCE,
  COMPARABLE_QUALITY_PRODUCER,
  COMPARABLE_QUALITY_SIGNAL_NAME,
  DEFAULT_COMPARABLE_QUALITY_SIGNAL_VERSION,
  REQUIRED_COMPARABLE_QUALITY_MIGRATION_FIELDS,
  buildComparableQualityMigrationFingerprint,
  createComparableQualityAdapter,
  migrateComparableQualitySignal,
  summarizeComparableQualityMigration,
  validateComparableQualityMigration
};
