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

const DECISION_CONTEXT_MIGRATION_SCHEMA_VERSION = '1.0.0';
const DECISION_CONTEXT_MIGRATION_SOURCE = 'decision_context_signal_migration';
const DECISION_CONTEXT_SIGNAL_NAME = 'decision.context.diagnostics';
const DECISION_CONTEXT_PRODUCER = 'decisionIntelligenceEngine';
const DECISION_CONTEXT_PRODUCER_CATEGORY = 'production_engine';
const DEFAULT_DECISION_CONTEXT_SIGNAL_VERSION = '1.4';

const REQUIRED_DECISION_CONTEXT_MIGRATION_FIELDS = Object.freeze([
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
  return normalizeString(firstDefined(explicitVersion, nativeOutput.schemaVersion, nativeOutput.version, DEFAULT_DECISION_CONTEXT_SIGNAL_VERSION));
}

function decisionReadiness(nativeOutput = {}) {
  return normalizeString(firstDefined(nativeOutput.overallReadiness, nativeOutput.decisionReadiness, nativeOutput.status));
}

function decisionConfidence(nativeOutput = {}) {
  return firstDefined(nativeOutput.confidence, nativeOutput.confidenceScore, UNKNOWN_VALUE);
}

function confidenceLevel(nativeOutput = {}) {
  const explicit = normalizeString(nativeOutput.confidenceLevel, '');
  if (explicit) return explicit;
  const blockers = asArray(nativeOutput.blockers).length;
  const conflicts = asArray(nativeOutput.conflicts).length;
  const cautions = asArray(nativeOutput.cautionSignals).length;
  const readiness = decisionReadiness(nativeOutput);
  if (readiness === 'supported_context' && blockers === 0 && conflicts === 0) return 'high';
  if (readiness === 'cautious_context' || cautions > 0 || conflicts > 0) return 'moderate';
  if (readiness === 'limited_context') return 'low';
  if (readiness === 'not_ready' || blockers > 0) return 'insufficient';
  return UNKNOWN_VALUE;
}

function uncertaintyLevel(nativeOutput = {}) {
  const blockers = asArray(nativeOutput.blockers).length;
  const conflicts = asArray(nativeOutput.conflicts).length;
  const cautions = asArray(nativeOutput.cautionSignals).length;
  if (blockers > 0) return 'extreme';
  if (conflicts > 0) return 'high';
  if (cautions > 0 || decisionReadiness(nativeOutput) === 'cautious_context') return 'moderate';
  if (decisionReadiness(nativeOutput) === 'supported_context') return 'low';
  return UNKNOWN_VALUE;
}

function evidenceQualityLevel(nativeOutput = {}) {
  const posture = normalizeString(nativeOutput.evidencePosture);
  if (posture === 'strong') return 'strong';
  if (posture === 'adequate') return 'adequate';
  if (posture === 'thin' || posture === 'limited_context') return 'limited';
  if (posture === 'unreliable') return 'insufficient';
  return UNKNOWN_VALUE;
}

function signalMessages(items = []) {
  return asArray(items).map((item) => {
    if (typeof item === 'string') return item;
    return normalizeString(firstDefined(item.message, item.reason, item.code, item.source));
  }).filter((item) => item && item !== UNKNOWN_VALUE);
}

function buildEvidenceBasis(nativeOutput = {}) {
  return {
    trueSoldCount: UNKNOWN_VALUE,
    activeListingCount: UNKNOWN_VALUE,
    fallbackUsed: UNKNOWN_VALUE,
    staleCount: UNKNOWN_VALUE,
    rejectedCount: asArray(nativeOutput.blockers).length,
    transactionIneligibleCount: UNKNOWN_VALUE,
    sourceConcentration: UNKNOWN_VALUE,
    details: {
      overallReadiness: decisionReadiness(nativeOutput),
      evidencePosture: normalizeString(nativeOutput.evidencePosture),
      compPosture: normalizeString(nativeOutput.compPosture),
      valuationPosture: normalizeString(nativeOutput.valuationPosture),
      resalePressurePosture: normalizeString(nativeOutput.resalePressurePosture),
      supportingSignalCount: asArray(nativeOutput.supportingSignals).length,
      cautionSignalCount: asArray(nativeOutput.cautionSignals).length,
      blockerCount: asArray(nativeOutput.blockers).length,
      conflictCount: asArray(nativeOutput.conflicts).length,
      supportingSignals: clone(asArray(nativeOutput.supportingSignals)),
      cautionSignals: clone(asArray(nativeOutput.cautionSignals)),
      blockers: clone(asArray(nativeOutput.blockers)),
      conflicts: clone(asArray(nativeOutput.conflicts))
    }
  };
}

function buildNormalizedOutput(nativeOutput = {}) {
  return {
    source: normalizeString(nativeOutput.source),
    mode: normalizeString(nativeOutput.mode),
    recommendationImpact: normalizeString(firstDefined(nativeOutput.recommendationImpact, 'none')),
    overallReadiness: decisionReadiness(nativeOutput),
    evidencePosture: normalizeString(nativeOutput.evidencePosture),
    compPosture: normalizeString(nativeOutput.compPosture),
    valuationPosture: normalizeString(nativeOutput.valuationPosture),
    resalePressurePosture: normalizeString(nativeOutput.resalePressurePosture),
    supportingSignalCount: asArray(nativeOutput.supportingSignals).length,
    cautionSignalCount: asArray(nativeOutput.cautionSignals).length,
    blockerCount: asArray(nativeOutput.blockers).length,
    conflictCount: asArray(nativeOutput.conflicts).length,
    summary: normalizeString(nativeOutput.summary)
  };
}

function createDecisionContextAdapter(input = {}) {
  return createSignalMigrationAdapter({
    adapterId: firstDefined(input.adapterId, 'decision-context-signal-adapter'),
    adapterVersion: firstDefined(input.adapterVersion, '1.0.0'),
    engineName: DECISION_CONTEXT_PRODUCER,
    supportedEngineVersions: [DEFAULT_DECISION_CONTEXT_SIGNAL_VERSION],
    signalName: DECISION_CONTEXT_SIGNAL_NAME,
    signalVersion: DEFAULT_DECISION_CONTEXT_SIGNAL_VERSION,
    producer: DECISION_CONTEXT_PRODUCER,
    producerVersion: DEFAULT_DECISION_CONTEXT_SIGNAL_VERSION,
    producerCategory: DECISION_CONTEXT_PRODUCER_CATEGORY,
    signalType: 'decision',
    decisionRole: 'supporting_context',
    authorityLevel: 'shadow_observation',
    evidenceRole: 'diagnostic_context',
    nativeOutputAliases: ['nativeOutput', 'decisionContextOutput', 'decisionContext', 'decisionIntelligence', 'diagnosticOutput', 'output'],
    nativeVersionAliases: ['version', 'schemaVersion'],
    requiredNativeFields: ['source', 'version', 'mode', 'recommendationImpact', 'overallReadiness', 'summary'],
    optionalNativeFields: ['evidencePosture', 'compPosture', 'valuationPosture', 'resalePressurePosture', 'supportingSignals', 'cautionSignals', 'blockers', 'conflicts'],
    evidenceMapping: {
      kind: 'declarative',
      sourceFields: ['supportingSignals', 'cautionSignals', 'blockers', 'conflicts', 'evidencePosture'],
      targetFields: ['canonicalSignal.evidenceBasis', 'canonicalSignal.evidenceQuality'],
      semantics: 'decision_context_supporting_caution_blocker_and_conflict_lists_wrapped_as_diagnostic_context'
    },
    confidenceMapping: {
      kind: 'declarative',
      sourceFields: ['overallReadiness', 'supportingSignals', 'cautionSignals', 'blockers', 'conflicts'],
      targetFields: ['canonicalSignal.confidenceLevel', 'canonicalSignal.uncertainty'],
      semantics: 'decision_context_readiness_maps_to_observational_confidence_semantics_only'
    },
    uncertaintyMapping: {
      kind: 'declarative',
      sourceFields: ['blockers', 'conflicts', 'cautionSignals'],
      targetFields: ['canonicalSignal.uncertainty.level'],
      semantics: 'blockers_conflicts_and_cautions_map_to_context_uncertainty'
    },
    statusMapping: {
      kind: 'declarative',
      sourceFields: ['overallReadiness', 'mode', 'recommendationImpact', 'summary'],
      targetFields: ['canonicalSignal.normalizedOutput'],
      semantics: 'native_decision_context_status_fields_preserved'
    },
    metadataMapping: {
      kind: 'declarative',
      sourceFields: ['source', 'version'],
      targetFields: ['canonicalSignal.metadata.nativeSource', 'canonicalSignal.metadata.nativeVersion'],
      semantics: 'native_metadata_preserved'
    },
    normalizedOutputMapping: {
      kind: 'approved_handler',
      sourceFields: ['overallReadiness', 'evidencePosture', 'compPosture', 'valuationPosture', 'resalePressurePosture'],
      targetFields: ['canonicalSignal.normalizedOutput'],
      handlerRef: 'validation/decisionContextSignalMigration#buildNormalizedOutput',
      semantics: 'decision_context_summary_projection'
    },
    semanticParityRules: [
      {
        ruleId: 'decision_context_raw_output_exact',
        kind: 'declarative',
        nativeFields: ['*'],
        shadowFields: ['canonicalSignal.rawOutput'],
        comparison: 'raw_output_must_match_exactly'
      },
      {
        ruleId: 'decision_context_readiness_semantic',
        kind: 'declarative',
        nativeFields: ['overallReadiness', 'supportingSignals', 'cautionSignals', 'blockers', 'conflicts'],
        shadowFields: ['canonicalSignal.normalizedOutput', 'canonicalSignal.evidenceBasis'],
        comparison: 'decision_context_fields_are_wrapped_as_supporting_context'
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
    compatibilityNotes: ['wrapper-only migration preserves native Decision Context output'],
    createdAt: firstDefined(input.createdAt, UNKNOWN_VALUE)
  });
}

function resolveDefinition(registry, nativeOutput = {}) {
  if (!registry) return null;
  return getSignalDefinition(registry, DECISION_CONTEXT_SIGNAL_NAME, signalVersion(nativeOutput));
}

function getRegistryResolutionStatus(registry, definition) {
  if (!registry) return 'registry_missing';
  if (definition) return 'matched';
  if (asArray(registry.definitions).some((item) => item.signalName === DECISION_CONTEXT_SIGNAL_NAME)) return 'version_mismatch';
  return 'definition_missing';
}

function buildCanonicalDecisionContextSignal(input = {}, definition = null) {
  const nativeOutput = clone(asObject(firstDefined(input.nativeOutput, input.decisionContextOutput, input.decisionContext, input.decisionIntelligence, input.diagnosticOutput, input.output, {})));
  const sourceOutputFingerprint = buildSourceOutputFingerprint(nativeOutput, input.sourceOutputFingerprint);
  const producerVersion = signalVersion(nativeOutput, firstDefined(input.producerVersion, definition && definition.producerVersion));
  return createCanonicalSignal({
    signalId: normalizeString(firstDefined(input.signalId, `${DECISION_CONTEXT_SIGNAL_NAME}:${sourceOutputFingerprint}`)),
    signalName: DECISION_CONTEXT_SIGNAL_NAME,
    producer: {
      producerId: DECISION_CONTEXT_PRODUCER,
      name: DECISION_CONTEXT_PRODUCER,
      module: 'engines/decisionIntelligenceEngine.js',
      functionName: 'supplied_native_output',
      version: producerVersion,
      category: DECISION_CONTEXT_PRODUCER_CATEGORY,
      metadata: {
        migrationSource: DECISION_CONTEXT_MIGRATION_SOURCE,
        executesNativeEngine: false
      }
    },
    producerVersion,
    producerCategory: DECISION_CONTEXT_PRODUCER_CATEGORY,
    createdAt: normalizeDate(firstDefined(input.createdAt, UNKNOWN_VALUE)),
    signalType: 'decision',
    decisionRole: 'supporting_context',
    authorityLevel: 'shadow_observation',
    confidence: {
      kind: decisionConfidence(nativeOutput) === UNKNOWN_VALUE ? 'not_applicable' : 'reported',
      value: decisionConfidence(nativeOutput),
      scale: decisionConfidence(nativeOutput) === UNKNOWN_VALUE ? UNKNOWN_VALUE : '0_100',
      basis: 'native_decision_context',
      calibrated: false
    },
    confidenceLevel: confidenceLevel(nativeOutput),
    uncertainty: {
      level: uncertaintyLevel(nativeOutput),
      range: UNKNOWN_VALUE,
      reasonCodes: unique([
        ...signalMessages(nativeOutput.cautionSignals),
        ...signalMessages(nativeOutput.blockers),
        ...signalMessages(nativeOutput.conflicts)
      ]).sort()
    },
    evidenceBasis: buildEvidenceBasis(nativeOutput),
    evidenceQuality: {
      level: evidenceQualityLevel(nativeOutput),
      score: UNKNOWN_VALUE,
      basis: 'native_decision_context_evidence_posture',
      details: {
        evidencePosture: normalizeString(nativeOutput.evidencePosture),
        compPosture: normalizeString(nativeOutput.compPosture),
        valuationPosture: normalizeString(nativeOutput.valuationPosture),
        resalePressurePosture: normalizeString(nativeOutput.resalePressurePosture)
      }
    },
    evidenceReferences: asArray(input.evidenceReferences),
    supportingSignals: asArray(input.supportingSignals),
    conflictingSignals: asArray(input.conflictingSignals),
    warnings: signalMessages(nativeOutput.cautionSignals),
    blockers: signalMessages(nativeOutput.blockers),
    rawOutput: nativeOutput,
    normalizedOutput: buildNormalizedOutput(nativeOutput),
    sourceFingerprint: sourceOutputFingerprint,
    metadata: {
      nativeSource: normalizeString(nativeOutput.source),
      nativeVersion: producerVersion,
      migrationSchemaVersion: DECISION_CONTEXT_MIGRATION_SCHEMA_VERSION,
      wrapperOnly: true
    }
  });
}

function buildAlignment(input = {}, canonicalSignal, definition, registryResolutionStatus) {
  return createSignalAlignment({
    alignmentId: normalizeString(firstDefined(input.alignmentId, `alignment:${canonicalSignal.signalId}`)),
    createdAt: normalizeDate(firstDefined(input.createdAt, canonicalSignal.createdAt)),
    producer: DECISION_CONTEXT_PRODUCER,
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
      nativeReadiness: normalizeString(canonicalSignal.normalizedOutput && canonicalSignal.normalizedOutput.overallReadiness),
      wrapperOnly: true
    }
  });
}

function buildAdaptedSignal(input = {}, canonicalSignal, alignment, definition, registryResolutionStatus) {
  const core = {
    schemaVersion: DECISION_CONTEXT_MIGRATION_SCHEMA_VERSION,
    source: `${DECISION_CONTEXT_MIGRATION_SOURCE}:adapted_signal`,
    adaptationId: normalizeString(firstDefined(input.adaptationId, `adaptation:${canonicalSignal.signalId}`)),
    createdAt: normalizeDate(firstDefined(input.createdAt, canonicalSignal.createdAt)),
    producer: DECISION_CONTEXT_PRODUCER,
    signalName: DECISION_CONTEXT_SIGNAL_NAME,
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
    alignmentRunId: normalizeString(firstDefined(input.alignmentRunId, input.runId, `decision-context-alignment-run:${adaptedSignal.sourceOutputFingerprint}`)),
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
      migrationSource: DECISION_CONTEXT_MIGRATION_SOURCE,
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
  if (!preserved) errors.push(validationIssue('native_output_parity_mismatch', 'Native Decision Context output was not preserved exactly.', 'nativeOutput'));
  return {
    parityStatus: preserved ? 'preserved' : 'changed',
    valid: preserved,
    errors,
    warnings: [],
    reasonCodes: unique(errors.map((error) => error.code)).sort()
  };
}

function summarizeDecisionContextMigration(migration = {}) {
  return deepFreeze({
    ...summarizeSignalMigrationLifecycle(migration),
    schemaVersion: DECISION_CONTEXT_MIGRATION_SCHEMA_VERSION,
    migrationId: normalizeString(migration.migrationId),
    signalName: DECISION_CONTEXT_SIGNAL_NAME,
    producer: DECISION_CONTEXT_PRODUCER,
    nativeSource: normalizeString(migration.nativeOutput && migration.nativeOutput.source),
    nativeVersion: signalVersion(asObject(migration.nativeOutput)),
    overallReadiness: decisionReadiness(asObject(migration.nativeOutput)),
    blockerCount: asArray(migration.nativeOutput && migration.nativeOutput.blockers).length,
    conflictCount: asArray(migration.nativeOutput && migration.nativeOutput.conflicts).length
  });
}

function buildDecisionContextMigrationFingerprint(migration = {}) {
  const projection = clone(migration);
  delete projection.migrationFingerprint;
  delete projection.decisionContextMigrationFingerprint;
  return buildFingerprintFromProjection(projection);
}

function buildCoreArtifact(migration = {}) {
  return createSignalMigrationArtifact({
    migrationId: migration.migrationId,
    createdAt: migration.createdAt,
    engineName: DECISION_CONTEXT_PRODUCER,
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
      source: DECISION_CONTEXT_MIGRATION_SOURCE
    }
  });
}

function validateDecisionContextMigration(migration = {}) {
  const errors = [];
  const warnings = [];
  const authorityViolations = [];
  const fingerprintViolations = [];
  const missing = REQUIRED_DECISION_CONTEXT_MIGRATION_FIELDS.filter((field) => {
    const value = migration[field];
    return value === undefined || value === null || value === '';
  });

  for (const field of missing) errors.push(validationIssue('missing_required_field', `${field} is required.`, field));
  if (migration.schemaVersion !== DECISION_CONTEXT_MIGRATION_SCHEMA_VERSION) errors.push(validationIssue('invalid_schema_version', 'schemaVersion must match Decision Context Signal Migration schema.', 'schemaVersion'));
  if (migration.source !== DECISION_CONTEXT_MIGRATION_SOURCE) errors.push(validationIssue('invalid_source', 'source must be decision_context_signal_migration.', 'source'));

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
  if (migration.migrationFingerprint && buildDecisionContextMigrationFingerprint(migration) !== migration.migrationFingerprint) {
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

function migrateDecisionContextSignal(input = {}, options = {}) {
  const adapter = createDecisionContextAdapter({ createdAt: firstDefined(input.createdAt, options.createdAt) });
  const migration = executeSignalMigrationLifecycle(input, options, {
    schemaVersion: DECISION_CONTEXT_MIGRATION_SCHEMA_VERSION,
    migrationSource: DECISION_CONTEXT_MIGRATION_SOURCE,
    nativeOutputAliases: ['nativeOutput', 'decisionContextOutput', 'decisionContext', 'decisionIntelligence', 'diagnosticOutput', 'output'],
    defaultMigrationIdPrefix: 'decision-context-signal-migration',
    defaultAlignmentBatchId: 'decision-context-signal-alignment-batch',
    defaultConflictAnalysisId: 'decision-context-signal-conflict-analysis',
    defaultReportId: 'decision-context-signal-alignment-report',
    resolveDefinition,
    getRegistryResolutionStatus,
    buildCanonicalSignal: buildCanonicalDecisionContextSignal,
    buildAlignment,
    buildAdaptedSignal,
    buildAlignmentRun,
    verifyParity,
    summarizeMigration: summarizeDecisionContextMigration,
    validateMigration: (candidate) => validateDecisionContextMigration({ ...candidate, adapter, coreArtifact: buildCoreArtifact(candidate) }),
    buildMigrationFingerprint: buildDecisionContextMigrationFingerprint
  });
  const withCore = {
    ...migration,
    adapter,
    coreArtifact: buildCoreArtifact(migration)
  };
  const withSummary = {
    ...withCore,
    summary: summarizeDecisionContextMigration(withCore)
  };
  return deepFreeze({
    ...withSummary,
    validation: validateDecisionContextMigration(withSummary),
    migrationFingerprint: buildDecisionContextMigrationFingerprint(withSummary)
  });
}

module.exports = {
  DECISION_CONTEXT_MIGRATION_SCHEMA_VERSION,
  DECISION_CONTEXT_MIGRATION_SOURCE,
  DECISION_CONTEXT_PRODUCER,
  DECISION_CONTEXT_SIGNAL_NAME,
  DEFAULT_DECISION_CONTEXT_SIGNAL_VERSION,
  REQUIRED_DECISION_CONTEXT_MIGRATION_FIELDS,
  buildDecisionContextMigrationFingerprint,
  createDecisionContextAdapter,
  migrateDecisionContextSignal,
  summarizeDecisionContextMigration,
  validateDecisionContextMigration
};
