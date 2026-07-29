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

const IDENTITY_PARSER_MIGRATION_SCHEMA_VERSION = '1.0.0';
const IDENTITY_PARSER_MIGRATION_SOURCE = 'identity_parser_signal_migration';
const IDENTITY_PARSER_SIGNAL_NAME = 'identity.parser.diagnostics';
const IDENTITY_PARSER_PRODUCER = 'identityParserDiagnostics';
const IDENTITY_PARSER_PRODUCER_CATEGORY = 'offline_validation';
const DEFAULT_IDENTITY_PARSER_SIGNAL_VERSION = '1.0.0';

const REQUIRED_IDENTITY_PARSER_MIGRATION_FIELDS = Object.freeze([
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
  return normalizeString(firstDefined(explicitVersion, nativeOutput.schemaVersion, nativeOutput.version, DEFAULT_IDENTITY_PARSER_SIGNAL_VERSION));
}

function confidenceValue(nativeOutput = {}) {
  const eligibility = asObject(nativeOutput.identityEligibility);
  const status = normalizeString(nativeOutput.diagnosticStatus);
  const ambiguity = normalizeString(nativeOutput.ambiguityLevel);
  if (eligibility.valuationEligible === true && status === 'exact' && ambiguity === 'none') return 95;
  if (eligibility.exactCompEligible === true && ['exact', 'strong_candidate'].includes(status)) return 82;
  if (status === 'partial') return 55;
  if (status === 'ambiguous') return 35;
  if (status === 'unsupported' || status === 'blocked') return 15;
  return UNKNOWN_VALUE;
}

function confidenceLevel(nativeOutput = {}) {
  const value = Number(confidenceValue(nativeOutput));
  if (!Number.isFinite(value)) return UNKNOWN_VALUE;
  if (value >= 80) return 'high';
  if (value >= 50) return 'moderate';
  if (value > 0) return 'low';
  return 'insufficient';
}

function uncertaintyLevel(nativeOutput = {}) {
  const ambiguity = normalizeString(nativeOutput.ambiguityLevel);
  if (ambiguity === 'none') return 'low';
  if (ambiguity === 'low') return 'moderate';
  if (ambiguity === 'medium' || ambiguity === 'high') return 'high';
  if (ambiguity === 'blocking') return 'extreme';
  return UNKNOWN_VALUE;
}

function evidenceQualityLevel(nativeOutput = {}) {
  const status = normalizeString(nativeOutput.diagnosticStatus);
  if (status === 'exact') return 'strong';
  if (status === 'strong_candidate') return 'adequate';
  if (status === 'partial') return 'limited';
  if (status === 'ambiguous') return 'weak';
  if (status === 'unsupported' || status === 'blocked') return 'insufficient';
  return UNKNOWN_VALUE;
}

function buildEvidenceBasis(nativeOutput = {}) {
  const eligibility = asObject(nativeOutput.identityEligibility);
  return {
    trueSoldCount: UNKNOWN_VALUE,
    activeListingCount: UNKNOWN_VALUE,
    fallbackUsed: false,
    staleCount: UNKNOWN_VALUE,
    rejectedCount: asArray(nativeOutput.fieldsConflicting).length,
    transactionIneligibleCount: UNKNOWN_VALUE,
    sourceConcentration: UNKNOWN_VALUE,
    details: {
      diagnosticStatus: normalizeString(nativeOutput.diagnosticStatus),
      ambiguityLevel: normalizeString(nativeOutput.ambiguityLevel),
      exactCompEligible: firstDefined(eligibility.exactCompEligible, UNKNOWN_VALUE),
      valuationEligible: firstDefined(eligibility.valuationEligible, UNKNOWN_VALUE),
      manualReviewRequired: firstDefined(eligibility.manualReviewRequired, UNKNOWN_VALUE),
      contextOnly: firstDefined(eligibility.contextOnly, UNKNOWN_VALUE),
      confirmedFieldCount: asArray(nativeOutput.fieldsConfirmed).length,
      missingFieldCount: asArray(nativeOutput.fieldsMissing).length,
      conflictingFieldCount: asArray(nativeOutput.fieldsConflicting).length,
      inferredFieldCount: asArray(nativeOutput.fieldsInferred).length,
      unsupportedFieldCount: asArray(nativeOutput.unsupportedIdentityFields).length
    }
  };
}

function buildNormalizedOutput(nativeOutput = {}) {
  const eligibility = asObject(nativeOutput.identityEligibility);
  return {
    status: normalizeString(nativeOutput.diagnosticStatus),
    ambiguityLevel: normalizeString(nativeOutput.ambiguityLevel),
    exactCompEligible: firstDefined(eligibility.exactCompEligible, UNKNOWN_VALUE),
    valuationEligible: firstDefined(eligibility.valuationEligible, UNKNOWN_VALUE),
    manualReviewRequired: firstDefined(eligibility.manualReviewRequired, UNKNOWN_VALUE),
    contextOnly: firstDefined(eligibility.contextOnly, UNKNOWN_VALUE),
    confirmedFieldCount: asArray(nativeOutput.fieldsConfirmed).length,
    missingFieldCount: asArray(nativeOutput.fieldsMissing).length,
    conflictingFieldCount: asArray(nativeOutput.fieldsConflicting).length,
    inferredFieldCount: asArray(nativeOutput.fieldsInferred).length,
    unsupportedFieldCount: asArray(nativeOutput.unsupportedIdentityFields).length,
    recommendedReviewAction: normalizeString(nativeOutput.recommendedReviewAction)
  };
}

function createIdentityParserAdapter(input = {}) {
  return createSignalMigrationAdapter({
    adapterId: firstDefined(input.adapterId, 'identity-parser-signal-adapter'),
    adapterVersion: firstDefined(input.adapterVersion, '1.0.0'),
    engineName: IDENTITY_PARSER_PRODUCER,
    supportedEngineVersions: [DEFAULT_IDENTITY_PARSER_SIGNAL_VERSION],
    signalName: IDENTITY_PARSER_SIGNAL_NAME,
    signalVersion: DEFAULT_IDENTITY_PARSER_SIGNAL_VERSION,
    producer: IDENTITY_PARSER_PRODUCER,
    producerVersion: DEFAULT_IDENTITY_PARSER_SIGNAL_VERSION,
    producerCategory: IDENTITY_PARSER_PRODUCER_CATEGORY,
    signalType: 'identity',
    decisionRole: 'diagnostic_only',
    authorityLevel: 'shadow_observation',
    evidenceRole: 'diagnostic_context',
    nativeOutputAliases: ['nativeOutput', 'identityParserOutput', 'identityParserDiagnosticsOutput', 'diagnosticOutput', 'output'],
    nativeVersionAliases: ['schemaVersion', 'version'],
    requiredNativeFields: ['identityEligibility', 'diagnosticStatus', 'ambiguityLevel', 'parserCanonicalComparison'],
    optionalNativeFields: ['fieldsConfirmed', 'fieldsMissing', 'fieldsConflicting', 'fieldsInferred', 'unsupportedIdentityFields', 'warnings', 'blockingIssues'],
    evidenceMapping: {
      kind: 'declarative',
      sourceFields: ['identityEligibility', 'fieldsConfirmed', 'fieldsMissing', 'fieldsConflicting', 'fieldsInferred'],
      targetFields: ['canonicalSignal.evidenceBasis', 'canonicalSignal.evidenceQuality'],
      semantics: 'identity_parser_quality_and_completeness_wrapped_as_diagnostic_context'
    },
    confidenceMapping: {
      kind: 'declarative',
      sourceFields: ['identityEligibility', 'diagnosticStatus', 'ambiguityLevel'],
      targetFields: ['canonicalSignal.confidence', 'canonicalSignal.confidenceLevel'],
      semantics: 'identity_confidence_is_diagnostic_not_production_confidence'
    },
    uncertaintyMapping: {
      kind: 'declarative',
      sourceFields: ['ambiguityLevel'],
      targetFields: ['canonicalSignal.uncertainty.level'],
      semantics: 'ambiguity_level_maps_to_diagnostic_uncertainty'
    },
    statusMapping: {
      kind: 'declarative',
      sourceFields: ['diagnosticStatus', 'ambiguityLevel'],
      targetFields: ['canonicalSignal.normalizedOutput.status', 'canonicalSignal.normalizedOutput.ambiguityLevel'],
      semantics: 'native_identity_status_and_ambiguity_preserved'
    },
    metadataMapping: {
      kind: 'declarative',
      sourceFields: ['source', 'schemaVersion'],
      targetFields: ['canonicalSignal.metadata.nativeSource', 'canonicalSignal.metadata.nativeVersion'],
      semantics: 'native_metadata_preserved'
    },
    normalizedOutputMapping: {
      kind: 'approved_handler',
      sourceFields: ['identityEligibility', 'diagnosticStatus', 'ambiguityLevel', 'recommendedReviewAction'],
      targetFields: ['canonicalSignal.normalizedOutput'],
      handlerRef: 'validation/identityParserSignalMigration#buildNormalizedOutput',
      semantics: 'identity_parser_diagnostic_summary_projection'
    },
    semanticParityRules: [
      {
        ruleId: 'identity_parser_raw_output_exact',
        kind: 'declarative',
        nativeFields: ['*'],
        shadowFields: ['canonicalSignal.rawOutput'],
        comparison: 'raw_output_must_match_exactly'
      },
      {
        ruleId: 'identity_parser_status_semantic',
        kind: 'declarative',
        nativeFields: ['diagnosticStatus', 'ambiguityLevel'],
        shadowFields: ['canonicalSignal.normalizedOutput.status', 'canonicalSignal.normalizedOutput.ambiguityLevel'],
        comparison: 'identity_status_and_ambiguity_are_preserved'
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
    compatibilityNotes: ['wrapper-only migration preserves native Identity Parser Diagnostics output'],
    createdAt: firstDefined(input.createdAt, UNKNOWN_VALUE)
  });
}

function resolveDefinition(registry, nativeOutput = {}) {
  if (!registry) return null;
  return getSignalDefinition(registry, IDENTITY_PARSER_SIGNAL_NAME, signalVersion(nativeOutput));
}

function getRegistryResolutionStatus(registry, definition) {
  if (!registry) return 'registry_missing';
  if (definition) return 'matched';
  if (asArray(registry.definitions).some((item) => item.signalName === IDENTITY_PARSER_SIGNAL_NAME)) return 'version_mismatch';
  return 'definition_missing';
}

function buildCanonicalIdentityParserSignal(input = {}, definition = null) {
  const nativeOutput = clone(asObject(firstDefined(input.nativeOutput, input.identityParserOutput, input.identityParserDiagnosticsOutput, input.diagnosticOutput, input.output, {})));
  const sourceOutputFingerprint = buildSourceOutputFingerprint(nativeOutput, input.sourceOutputFingerprint);
  const producerVersion = signalVersion(nativeOutput, firstDefined(input.producerVersion, definition && definition.producerVersion));
  return createCanonicalSignal({
    signalId: normalizeString(firstDefined(input.signalId, `${IDENTITY_PARSER_SIGNAL_NAME}:${sourceOutputFingerprint}`)),
    signalName: IDENTITY_PARSER_SIGNAL_NAME,
    producer: {
      producerId: IDENTITY_PARSER_PRODUCER,
      name: IDENTITY_PARSER_PRODUCER,
      module: 'validation/identityParserDiagnostics.js',
      functionName: 'supplied_native_output',
      version: producerVersion,
      category: IDENTITY_PARSER_PRODUCER_CATEGORY,
      metadata: {
        migrationSource: IDENTITY_PARSER_MIGRATION_SOURCE,
        executesNativeEngine: false
      }
    },
    producerVersion,
    producerCategory: IDENTITY_PARSER_PRODUCER_CATEGORY,
    createdAt: normalizeDate(firstDefined(input.createdAt, UNKNOWN_VALUE)),
    signalType: 'identity',
    decisionRole: 'diagnostic_only',
    authorityLevel: 'shadow_observation',
    confidence: {
      kind: 'derived',
      value: confidenceValue(nativeOutput),
      scale: '0_100',
      basis: 'identity_parser_diagnostic_status_and_ambiguity',
      calibrated: false
    },
    confidenceLevel: confidenceLevel(nativeOutput),
    uncertainty: {
      level: uncertaintyLevel(nativeOutput),
      range: UNKNOWN_VALUE,
      reasonCodes: unique([
        ...asArray(nativeOutput.blockingIssues),
        ...asArray(nativeOutput.warnings)
      ]).sort()
    },
    evidenceBasis: buildEvidenceBasis(nativeOutput),
    evidenceQuality: {
      level: evidenceQualityLevel(nativeOutput),
      score: confidenceValue(nativeOutput),
      basis: 'identity_parser_diagnostic_status',
      details: {
        identityEligibility: clone(firstDefined(nativeOutput.identityEligibility, UNKNOWN_VALUE)),
        ambiguityLevel: normalizeString(nativeOutput.ambiguityLevel)
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
      migrationSchemaVersion: IDENTITY_PARSER_MIGRATION_SCHEMA_VERSION,
      wrapperOnly: true
    }
  });
}

function buildAlignment(input = {}, canonicalSignal, definition, registryResolutionStatus) {
  return createSignalAlignment({
    alignmentId: normalizeString(firstDefined(input.alignmentId, `alignment:${canonicalSignal.signalId}`)),
    createdAt: normalizeDate(firstDefined(input.createdAt, canonicalSignal.createdAt)),
    producer: IDENTITY_PARSER_PRODUCER,
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
    schemaVersion: IDENTITY_PARSER_MIGRATION_SCHEMA_VERSION,
    source: `${IDENTITY_PARSER_MIGRATION_SOURCE}:adapted_signal`,
    adaptationId: normalizeString(firstDefined(input.adaptationId, `adaptation:${canonicalSignal.signalId}`)),
    createdAt: normalizeDate(firstDefined(input.createdAt, canonicalSignal.createdAt)),
    producer: IDENTITY_PARSER_PRODUCER,
    signalName: IDENTITY_PARSER_SIGNAL_NAME,
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
    alignmentRunId: normalizeString(firstDefined(input.alignmentRunId, input.runId, `identity-parser-alignment-run:${adaptedSignal.sourceOutputFingerprint}`)),
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
      migrationSource: IDENTITY_PARSER_MIGRATION_SOURCE,
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
  if (!preserved) errors.push(validationIssue('native_output_parity_mismatch', 'Native Identity Parser Diagnostics output was not preserved exactly.', 'nativeOutput'));
  return {
    parityStatus: preserved ? 'preserved' : 'changed',
    valid: preserved,
    errors,
    warnings: [],
    reasonCodes: unique(errors.map((error) => error.code)).sort()
  };
}

function summarizeIdentityParserMigration(migration = {}) {
  return deepFreeze({
    ...summarizeSignalMigrationLifecycle(migration),
    schemaVersion: IDENTITY_PARSER_MIGRATION_SCHEMA_VERSION,
    migrationId: normalizeString(migration.migrationId),
    signalName: IDENTITY_PARSER_SIGNAL_NAME,
    producer: IDENTITY_PARSER_PRODUCER,
    nativeSource: normalizeString(migration.nativeOutput && migration.nativeOutput.source),
    nativeVersion: signalVersion(asObject(migration.nativeOutput)),
    diagnosticStatus: normalizeString(migration.nativeOutput && migration.nativeOutput.diagnosticStatus),
    ambiguityLevel: normalizeString(migration.nativeOutput && migration.nativeOutput.ambiguityLevel)
  });
}

function buildIdentityParserMigrationFingerprint(migration = {}) {
  const projection = clone(migration);
  delete projection.migrationFingerprint;
  delete projection.identityParserMigrationFingerprint;
  return buildFingerprintFromProjection(projection);
}

function buildCoreArtifact(migration = {}) {
  return createSignalMigrationArtifact({
    migrationId: migration.migrationId,
    createdAt: migration.createdAt,
    engineName: IDENTITY_PARSER_PRODUCER,
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
      source: IDENTITY_PARSER_MIGRATION_SOURCE
    }
  });
}

function validateIdentityParserMigration(migration = {}) {
  const errors = [];
  const warnings = [];
  const authorityViolations = [];
  const fingerprintViolations = [];
  const missing = REQUIRED_IDENTITY_PARSER_MIGRATION_FIELDS.filter((field) => {
    const value = migration[field];
    return value === undefined || value === null || value === '';
  });

  for (const field of missing) errors.push(validationIssue('missing_required_field', `${field} is required.`, field));
  if (migration.schemaVersion !== IDENTITY_PARSER_MIGRATION_SCHEMA_VERSION) errors.push(validationIssue('invalid_schema_version', 'schemaVersion must match Identity Parser Signal Migration schema.', 'schemaVersion'));
  if (migration.source !== IDENTITY_PARSER_MIGRATION_SOURCE) errors.push(validationIssue('invalid_source', 'source must be identity_parser_signal_migration.', 'source'));

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
  if (migration.migrationFingerprint && buildIdentityParserMigrationFingerprint(migration) !== migration.migrationFingerprint) {
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

function migrateIdentityParserSignal(input = {}, options = {}) {
  const adapter = createIdentityParserAdapter({ createdAt: firstDefined(input.createdAt, options.createdAt) });
  const migration = executeSignalMigrationLifecycle(input, options, {
    schemaVersion: IDENTITY_PARSER_MIGRATION_SCHEMA_VERSION,
    migrationSource: IDENTITY_PARSER_MIGRATION_SOURCE,
    nativeOutputAliases: ['nativeOutput', 'identityParserOutput', 'identityParserDiagnosticsOutput', 'diagnosticOutput', 'output'],
    defaultMigrationIdPrefix: 'identity-parser-signal-migration',
    defaultAlignmentBatchId: 'identity-parser-signal-alignment-batch',
    defaultConflictAnalysisId: 'identity-parser-signal-conflict-analysis',
    defaultReportId: 'identity-parser-signal-alignment-report',
    resolveDefinition,
    getRegistryResolutionStatus,
    buildCanonicalSignal: buildCanonicalIdentityParserSignal,
    buildAlignment,
    buildAdaptedSignal,
    buildAlignmentRun,
    verifyParity,
    summarizeMigration: summarizeIdentityParserMigration,
    validateMigration: (candidate) => validateIdentityParserMigration({ ...candidate, adapter, coreArtifact: buildCoreArtifact(candidate) }),
    buildMigrationFingerprint: buildIdentityParserMigrationFingerprint
  });
  const withCore = {
    ...migration,
    adapter,
    coreArtifact: buildCoreArtifact(migration)
  };
  const withSummary = {
    ...withCore,
    summary: summarizeIdentityParserMigration(withCore)
  };
  return deepFreeze({
    ...withSummary,
    validation: validateIdentityParserMigration(withSummary),
    migrationFingerprint: buildIdentityParserMigrationFingerprint(withSummary)
  });
}

module.exports = {
  DEFAULT_IDENTITY_PARSER_SIGNAL_VERSION,
  IDENTITY_PARSER_MIGRATION_SCHEMA_VERSION,
  IDENTITY_PARSER_MIGRATION_SOURCE,
  IDENTITY_PARSER_PRODUCER,
  IDENTITY_PARSER_SIGNAL_NAME,
  REQUIRED_IDENTITY_PARSER_MIGRATION_FIELDS,
  buildIdentityParserMigrationFingerprint,
  createIdentityParserAdapter,
  migrateIdentityParserSignal,
  summarizeIdentityParserMigration,
  validateIdentityParserMigration
};
