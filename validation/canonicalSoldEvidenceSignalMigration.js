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

const CANONICAL_SOLD_EVIDENCE_MIGRATION_SCHEMA_VERSION = '1.0.0';
const CANONICAL_SOLD_EVIDENCE_MIGRATION_SOURCE = 'canonical_sold_evidence_signal_migration';
const CANONICAL_SOLD_EVIDENCE_SIGNAL_NAME = 'canonical.sold_evidence.store';
const CANONICAL_SOLD_EVIDENCE_PRODUCER = 'canonicalSoldEvidence';
const CANONICAL_SOLD_EVIDENCE_PRODUCER_CATEGORY = 'service';
const DEFAULT_CANONICAL_SOLD_EVIDENCE_SIGNAL_VERSION = '1.0.0';

const REQUIRED_CANONICAL_SOLD_EVIDENCE_MIGRATION_FIELDS = Object.freeze([
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
  if (known(nativeOutput.storeFingerprint)) return normalizeString(nativeOutput.storeFingerprint);
  return buildFingerprintFromProjection(nativeOutput);
}

function signalVersion(nativeOutput = {}, explicitVersion) {
  return normalizeString(firstDefined(explicitVersion, nativeOutput.schemaVersion, nativeOutput.version, DEFAULT_CANONICAL_SOLD_EVIDENCE_SIGNAL_VERSION));
}

function suppliedRecordCount(nativeOutput = {}) {
  const stats = asObject(nativeOutput.stats);
  return firstDefined(stats.recordCount, nativeOutput.recordCount, asArray(nativeOutput.records).length || UNKNOWN_VALUE);
}

function qualityScore(nativeOutput = {}) {
  return firstDefined(
    asObject(nativeOutput.evidenceQualitySummary).averageEvidenceQualityScore,
    asObject(nativeOutput.evidenceQualitySummary).score,
    asObject(nativeOutput.datasetQuality).score,
    UNKNOWN_VALUE
  );
}

function confidenceLevel(nativeOutput = {}) {
  const value = Number(qualityScore(nativeOutput));
  if (!Number.isFinite(value)) return UNKNOWN_VALUE;
  if (value >= 85) return 'high';
  if (value >= 65) return 'moderate';
  if (value > 0) return 'low';
  return 'insufficient';
}

function evidenceQualityLevel(nativeOutput = {}) {
  return normalizeString(firstDefined(
    asObject(nativeOutput.evidenceQualitySummary).level,
    asObject(nativeOutput.datasetQuality).level,
    UNKNOWN_VALUE
  ));
}

function uncertaintyLevel(nativeOutput = {}) {
  const status = normalizeString(nativeOutput.status);
  if (status === 'available' || status === 'active') return 'low';
  if (status === 'partial' || status === 'limited') return 'moderate';
  if (status === 'stale' || status === 'thin') return 'high';
  if (status === 'blocked' || status === 'unavailable') return 'extreme';
  return UNKNOWN_VALUE;
}

function buildEvidenceBasis(nativeOutput = {}) {
  const stats = asObject(nativeOutput.stats);
  const quality = asObject(nativeOutput.evidenceQualitySummary);
  const provenance = asObject(nativeOutput.provenanceSummary);
  return {
    trueSoldCount: suppliedRecordCount(nativeOutput),
    activeListingCount: firstDefined(stats.activeEvidenceCount, nativeOutput.activeEvidenceCount, 0),
    fallbackUsed: firstDefined(nativeOutput.fallbackUsed, false),
    staleCount: firstDefined(stats.staleEvidenceCount, quality.staleEvidenceCount, UNKNOWN_VALUE),
    rejectedCount: firstDefined(stats.rejectedRecordCount, stats.rejectedEvidenceCount, UNKNOWN_VALUE),
    transactionIneligibleCount: firstDefined(stats.transactionIneligibleEvidenceCount, UNKNOWN_VALUE),
    sourceConcentration: clone(firstDefined(provenance.sourceConcentration, nativeOutput.sourceConcentration, UNKNOWN_VALUE)),
    details: {
      status: normalizeString(nativeOutput.status),
      recordCount: suppliedRecordCount(nativeOutput),
      identityCount: firstDefined(stats.identityCount, UNKNOWN_VALUE),
      duplicateKeyCount: firstDefined(stats.duplicateKeyCount, UNKNOWN_VALUE),
      duplicateInsertions: firstDefined(stats.duplicateInsertions, UNKNOWN_VALUE),
      sourceCount: firstDefined(provenance.sourceCount, UNKNOWN_VALUE),
      primarySources: clone(firstDefined(provenance.primarySources, UNKNOWN_VALUE)),
      datasetQuality: clone(firstDefined(nativeOutput.datasetQuality, UNKNOWN_VALUE)),
      evidenceQualitySummary: clone(firstDefined(nativeOutput.evidenceQualitySummary, UNKNOWN_VALUE))
    }
  };
}

function buildNormalizedOutput(nativeOutput = {}) {
  const stats = asObject(nativeOutput.stats);
  const provenance = asObject(nativeOutput.provenanceSummary);
  return {
    status: normalizeString(nativeOutput.status),
    trueSoldCount: suppliedRecordCount(nativeOutput),
    recordCount: suppliedRecordCount(nativeOutput),
    identityCount: firstDefined(stats.identityCount, UNKNOWN_VALUE),
    duplicateKeyCount: firstDefined(stats.duplicateKeyCount, UNKNOWN_VALUE),
    duplicateInsertions: firstDefined(stats.duplicateInsertions, UNKNOWN_VALUE),
    activeEvidenceCount: firstDefined(stats.activeEvidenceCount, nativeOutput.activeEvidenceCount, 0),
    staleEvidenceCount: firstDefined(stats.staleEvidenceCount, UNKNOWN_VALUE),
    rejectedRecordCount: firstDefined(stats.rejectedRecordCount, stats.rejectedEvidenceCount, UNKNOWN_VALUE),
    transactionIneligibleEvidenceCount: firstDefined(stats.transactionIneligibleEvidenceCount, UNKNOWN_VALUE),
    sourceCount: firstDefined(provenance.sourceCount, UNKNOWN_VALUE),
    evidenceQualityLevel: evidenceQualityLevel(nativeOutput),
    averageEvidenceQualityScore: qualityScore(nativeOutput),
    canonicalStoreSource: normalizeString(nativeOutput.source),
    recommendedReviewAction: normalizeString(nativeOutput.recommendedReviewAction)
  };
}

function createCanonicalSoldEvidenceAdapter(input = {}) {
  return createSignalMigrationAdapter({
    adapterId: firstDefined(input.adapterId, 'canonical-sold-evidence-signal-adapter'),
    adapterVersion: firstDefined(input.adapterVersion, '1.0.0'),
    engineName: CANONICAL_SOLD_EVIDENCE_PRODUCER,
    supportedEngineVersions: [DEFAULT_CANONICAL_SOLD_EVIDENCE_SIGNAL_VERSION],
    signalName: CANONICAL_SOLD_EVIDENCE_SIGNAL_NAME,
    signalVersion: DEFAULT_CANONICAL_SOLD_EVIDENCE_SIGNAL_VERSION,
    producer: CANONICAL_SOLD_EVIDENCE_PRODUCER,
    producerVersion: DEFAULT_CANONICAL_SOLD_EVIDENCE_SIGNAL_VERSION,
    producerCategory: CANONICAL_SOLD_EVIDENCE_PRODUCER_CATEGORY,
    signalType: 'evidence',
    decisionRole: 'diagnostic_only',
    authorityLevel: 'shadow_observation',
    evidenceRole: 'diagnostic_context',
    nativeOutputAliases: ['nativeOutput', 'canonicalSoldEvidenceOutput', 'canonicalSoldEvidence', 'soldEvidenceOutput', 'output'],
    nativeVersionAliases: ['schemaVersion', 'version'],
    requiredNativeFields: ['source', 'schemaVersion', 'records', 'stats'],
    optionalNativeFields: ['provenanceSummary', 'evidenceQualitySummary', 'datasetQuality', 'identityIndex', 'duplicateIndex', 'recommendedReviewAction'],
    evidenceMapping: {
      kind: 'declarative',
      sourceFields: ['records', 'stats', 'provenanceSummary', 'evidenceQualitySummary'],
      targetFields: ['canonicalSignal.evidenceBasis', 'canonicalSignal.evidenceQuality'],
      semantics: 'canonical_sold_records_and_store_stats_wrapped_as_evidence_context'
    },
    confidenceMapping: {
      kind: 'declarative',
      sourceFields: ['evidenceQualitySummary', 'datasetQuality'],
      targetFields: ['canonicalSignal.confidence', 'canonicalSignal.confidenceLevel'],
      semantics: 'dataset_quality_score_is_diagnostic_not_production_confidence'
    },
    uncertaintyMapping: {
      kind: 'declarative',
      sourceFields: ['status'],
      targetFields: ['canonicalSignal.uncertainty.level'],
      semantics: 'canonical_sold_evidence_status_maps_to_diagnostic_uncertainty'
    },
    statusMapping: {
      kind: 'declarative',
      sourceFields: ['status'],
      targetFields: ['canonicalSignal.normalizedOutput.status'],
      semantics: 'native_canonical_sold_evidence_status_preserved'
    },
    metadataMapping: {
      kind: 'declarative',
      sourceFields: ['source', 'schemaVersion'],
      targetFields: ['canonicalSignal.metadata.nativeSource', 'canonicalSignal.metadata.nativeVersion'],
      semantics: 'native_metadata_preserved'
    },
    normalizedOutputMapping: {
      kind: 'approved_handler',
      sourceFields: ['stats', 'provenanceSummary', 'evidenceQualitySummary', 'datasetQuality'],
      targetFields: ['canonicalSignal.normalizedOutput'],
      handlerRef: 'validation/canonicalSoldEvidenceSignalMigration#buildNormalizedOutput',
      semantics: 'canonical_sold_evidence_summary_projection'
    },
    semanticParityRules: [
      {
        ruleId: 'canonical_sold_evidence_raw_output_exact',
        kind: 'declarative',
        nativeFields: ['*'],
        shadowFields: ['canonicalSignal.rawOutput'],
        comparison: 'raw_output_must_match_exactly'
      },
      {
        ruleId: 'canonical_sold_evidence_stats_semantic',
        kind: 'declarative',
        nativeFields: ['stats', 'records'],
        shadowFields: ['canonicalSignal.evidenceBasis', 'canonicalSignal.normalizedOutput'],
        comparison: 'supplied_store_stats_are_wrapped_as_evidence_basis'
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
    compatibilityNotes: ['wrapper-only migration preserves native Canonical Sold Evidence output'],
    createdAt: firstDefined(input.createdAt, UNKNOWN_VALUE)
  });
}

function resolveDefinition(registry, nativeOutput = {}) {
  if (!registry) return null;
  return getSignalDefinition(registry, CANONICAL_SOLD_EVIDENCE_SIGNAL_NAME, signalVersion(nativeOutput));
}

function getRegistryResolutionStatus(registry, definition) {
  if (!registry) return 'registry_missing';
  if (definition) return 'matched';
  if (asArray(registry.definitions).some((item) => item.signalName === CANONICAL_SOLD_EVIDENCE_SIGNAL_NAME)) return 'version_mismatch';
  return 'definition_missing';
}

function buildCanonicalSoldEvidenceSignal(input = {}, definition = null) {
  const nativeOutput = clone(asObject(firstDefined(input.nativeOutput, input.canonicalSoldEvidenceOutput, input.canonicalSoldEvidence, input.soldEvidenceOutput, input.output, {})));
  const sourceOutputFingerprint = buildSourceOutputFingerprint(nativeOutput, input.sourceOutputFingerprint);
  const producerVersion = signalVersion(nativeOutput, firstDefined(input.producerVersion, definition && definition.producerVersion));
  const score = qualityScore(nativeOutput);
  return createCanonicalSignal({
    signalId: normalizeString(firstDefined(input.signalId, `${CANONICAL_SOLD_EVIDENCE_SIGNAL_NAME}:${sourceOutputFingerprint}`)),
    signalName: CANONICAL_SOLD_EVIDENCE_SIGNAL_NAME,
    producer: {
      producerId: CANONICAL_SOLD_EVIDENCE_PRODUCER,
      name: CANONICAL_SOLD_EVIDENCE_PRODUCER,
      module: 'utils/soldEvidenceStore.js',
      functionName: 'supplied_native_output',
      version: producerVersion,
      category: CANONICAL_SOLD_EVIDENCE_PRODUCER_CATEGORY,
      metadata: {
        migrationSource: CANONICAL_SOLD_EVIDENCE_MIGRATION_SOURCE,
        executesNativeEngine: false
      }
    },
    producerVersion,
    producerCategory: CANONICAL_SOLD_EVIDENCE_PRODUCER_CATEGORY,
    createdAt: normalizeDate(firstDefined(input.createdAt, UNKNOWN_VALUE)),
    signalType: 'evidence',
    decisionRole: 'diagnostic_only',
    authorityLevel: 'shadow_observation',
    confidence: {
      kind: 'derived',
      value: score,
      scale: score === UNKNOWN_VALUE ? UNKNOWN_VALUE : '0_100',
      basis: 'canonical_sold_evidence_dataset_quality',
      calibrated: false
    },
    confidenceLevel: confidenceLevel(nativeOutput),
    uncertainty: {
      level: uncertaintyLevel(nativeOutput),
      range: UNKNOWN_VALUE,
      reasonCodes: unique([
        ...asArray(nativeOutput.warnings),
        ...asArray(nativeOutput.blockers),
        ...asArray(asObject(nativeOutput.evidenceQualitySummary).warnings)
      ]).sort()
    },
    evidenceBasis: buildEvidenceBasis(nativeOutput),
    evidenceQuality: {
      level: evidenceQualityLevel(nativeOutput),
      score,
      basis: 'canonical_sold_evidence_dataset_quality',
      details: {
        stats: clone(firstDefined(nativeOutput.stats, UNKNOWN_VALUE)),
        provenanceSummary: clone(firstDefined(nativeOutput.provenanceSummary, UNKNOWN_VALUE)),
        evidenceQualitySummary: clone(firstDefined(nativeOutput.evidenceQualitySummary, UNKNOWN_VALUE))
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
      migrationSchemaVersion: CANONICAL_SOLD_EVIDENCE_MIGRATION_SCHEMA_VERSION,
      wrapperOnly: true
    }
  });
}

function buildAlignment(input = {}, canonicalSignal, definition, registryResolutionStatus) {
  return createSignalAlignment({
    alignmentId: normalizeString(firstDefined(input.alignmentId, `alignment:${canonicalSignal.signalId}`)),
    createdAt: normalizeDate(firstDefined(input.createdAt, canonicalSignal.createdAt)),
    producer: CANONICAL_SOLD_EVIDENCE_PRODUCER,
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
    schemaVersion: CANONICAL_SOLD_EVIDENCE_MIGRATION_SCHEMA_VERSION,
    source: `${CANONICAL_SOLD_EVIDENCE_MIGRATION_SOURCE}:adapted_signal`,
    adaptationId: normalizeString(firstDefined(input.adaptationId, `adaptation:${canonicalSignal.signalId}`)),
    createdAt: normalizeDate(firstDefined(input.createdAt, canonicalSignal.createdAt)),
    producer: CANONICAL_SOLD_EVIDENCE_PRODUCER,
    signalName: CANONICAL_SOLD_EVIDENCE_SIGNAL_NAME,
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
    alignmentRunId: normalizeString(firstDefined(input.alignmentRunId, input.runId, `canonical-sold-evidence-alignment-run:${adaptedSignal.sourceOutputFingerprint}`)),
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
      migrationSource: CANONICAL_SOLD_EVIDENCE_MIGRATION_SOURCE,
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
  if (!preserved) errors.push(validationIssue('native_output_parity_mismatch', 'Native Canonical Sold Evidence output was not preserved exactly.', 'nativeOutput'));
  return {
    parityStatus: preserved ? 'preserved' : 'changed',
    valid: preserved,
    errors,
    warnings: [],
    reasonCodes: unique(errors.map((error) => error.code)).sort()
  };
}

function summarizeCanonicalSoldEvidenceMigration(migration = {}) {
  return deepFreeze({
    ...summarizeSignalMigrationLifecycle(migration),
    schemaVersion: CANONICAL_SOLD_EVIDENCE_MIGRATION_SCHEMA_VERSION,
    migrationId: normalizeString(migration.migrationId),
    signalName: CANONICAL_SOLD_EVIDENCE_SIGNAL_NAME,
    producer: CANONICAL_SOLD_EVIDENCE_PRODUCER,
    nativeSource: normalizeString(migration.nativeOutput && migration.nativeOutput.source),
    nativeVersion: signalVersion(asObject(migration.nativeOutput)),
    recordCount: firstDefined(asObject(migration.nativeOutput && migration.nativeOutput.stats).recordCount, UNKNOWN_VALUE),
    evidenceQualityLevel: evidenceQualityLevel(asObject(migration.nativeOutput))
  });
}

function buildCanonicalSoldEvidenceMigrationFingerprint(migration = {}) {
  const projection = clone(migration);
  delete projection.migrationFingerprint;
  delete projection.canonicalSoldEvidenceMigrationFingerprint;
  return buildFingerprintFromProjection(projection);
}

function buildCoreArtifact(migration = {}) {
  return createSignalMigrationArtifact({
    migrationId: migration.migrationId,
    createdAt: migration.createdAt,
    engineName: CANONICAL_SOLD_EVIDENCE_PRODUCER,
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
      source: CANONICAL_SOLD_EVIDENCE_MIGRATION_SOURCE
    }
  });
}

function validateCanonicalSoldEvidenceMigration(migration = {}) {
  const errors = [];
  const warnings = [];
  const authorityViolations = [];
  const fingerprintViolations = [];
  const missing = REQUIRED_CANONICAL_SOLD_EVIDENCE_MIGRATION_FIELDS.filter((field) => {
    const value = migration[field];
    return value === undefined || value === null || value === '';
  });

  for (const field of missing) errors.push(validationIssue('missing_required_field', `${field} is required.`, field));
  if (migration.schemaVersion !== CANONICAL_SOLD_EVIDENCE_MIGRATION_SCHEMA_VERSION) errors.push(validationIssue('invalid_schema_version', 'schemaVersion must match Canonical Sold Evidence Signal Migration schema.', 'schemaVersion'));
  if (migration.source !== CANONICAL_SOLD_EVIDENCE_MIGRATION_SOURCE) errors.push(validationIssue('invalid_source', 'source must be canonical_sold_evidence_signal_migration.', 'source'));

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
  if (migration.migrationFingerprint && buildCanonicalSoldEvidenceMigrationFingerprint(migration) !== migration.migrationFingerprint) {
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

function migrateCanonicalSoldEvidenceSignal(input = {}, options = {}) {
  const adapter = createCanonicalSoldEvidenceAdapter({ createdAt: firstDefined(input.createdAt, options.createdAt) });
  const migration = executeSignalMigrationLifecycle(input, options, {
    schemaVersion: CANONICAL_SOLD_EVIDENCE_MIGRATION_SCHEMA_VERSION,
    migrationSource: CANONICAL_SOLD_EVIDENCE_MIGRATION_SOURCE,
    nativeOutputAliases: ['nativeOutput', 'canonicalSoldEvidenceOutput', 'canonicalSoldEvidence', 'soldEvidenceOutput', 'output'],
    defaultMigrationIdPrefix: 'canonical-sold-evidence-signal-migration',
    defaultAlignmentBatchId: 'canonical-sold-evidence-signal-alignment-batch',
    defaultConflictAnalysisId: 'canonical-sold-evidence-signal-conflict-analysis',
    defaultReportId: 'canonical-sold-evidence-signal-alignment-report',
    resolveDefinition,
    getRegistryResolutionStatus,
    buildCanonicalSignal: buildCanonicalSoldEvidenceSignal,
    buildAlignment,
    buildAdaptedSignal,
    buildAlignmentRun,
    verifyParity,
    summarizeMigration: summarizeCanonicalSoldEvidenceMigration,
    validateMigration: (candidate) => validateCanonicalSoldEvidenceMigration({ ...candidate, adapter, coreArtifact: buildCoreArtifact(candidate) }),
    buildMigrationFingerprint: buildCanonicalSoldEvidenceMigrationFingerprint
  });
  const withCore = {
    ...migration,
    adapter,
    coreArtifact: buildCoreArtifact(migration)
  };
  const withSummary = {
    ...withCore,
    summary: summarizeCanonicalSoldEvidenceMigration(withCore)
  };
  return deepFreeze({
    ...withSummary,
    validation: validateCanonicalSoldEvidenceMigration(withSummary),
    migrationFingerprint: buildCanonicalSoldEvidenceMigrationFingerprint(withSummary)
  });
}

module.exports = {
  CANONICAL_SOLD_EVIDENCE_MIGRATION_SCHEMA_VERSION,
  CANONICAL_SOLD_EVIDENCE_MIGRATION_SOURCE,
  CANONICAL_SOLD_EVIDENCE_PRODUCER,
  CANONICAL_SOLD_EVIDENCE_SIGNAL_NAME,
  DEFAULT_CANONICAL_SOLD_EVIDENCE_SIGNAL_VERSION,
  REQUIRED_CANONICAL_SOLD_EVIDENCE_MIGRATION_FIELDS,
  buildCanonicalSoldEvidenceMigrationFingerprint,
  createCanonicalSoldEvidenceAdapter,
  migrateCanonicalSoldEvidenceSignal,
  summarizeCanonicalSoldEvidenceMigration,
  validateCanonicalSoldEvidenceMigration
};
