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

const FALSE_POSITIVE_MIGRATION_SCHEMA_VERSION = '1.0.0';
const FALSE_POSITIVE_MIGRATION_SOURCE = 'false_positive_signal_migration';
const FALSE_POSITIVE_SIGNAL_NAME = 'opportunity.false_positive.diagnostics';
const FALSE_POSITIVE_PRODUCER = 'opportunityFalsePositiveDiagnostics';
const FALSE_POSITIVE_PRODUCER_CATEGORY = 'offline_validation';
const DEFAULT_FALSE_POSITIVE_SIGNAL_VERSION = '1.0.0';

const REQUIRED_FALSE_POSITIVE_MIGRATION_FIELDS = Object.freeze([
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
  return normalizeString(firstDefined(explicitVersion, nativeOutput.schemaVersion, nativeOutput.version, DEFAULT_FALSE_POSITIVE_SIGNAL_VERSION));
}

function riskScore(nativeOutput = {}) {
  const level = normalizeString(nativeOutput.falsePositiveRiskLevel);
  if (level === 'critical') return 95;
  if (level === 'high') return 80;
  if (level === 'moderate') return 55;
  if (level === 'low') return 20;
  return UNKNOWN_VALUE;
}

function riskEvidenceQuality(nativeOutput = {}) {
  const level = normalizeString(nativeOutput.falsePositiveRiskLevel);
  if (level === 'critical' || level === 'high') return 'strong';
  if (level === 'moderate') return 'adequate';
  if (level === 'low') return 'limited';
  return UNKNOWN_VALUE;
}

function uncertaintyLevel(nativeOutput = {}) {
  const status = normalizeString(nativeOutput.falsePositiveRiskStatus);
  if (status === 'low_risk') return 'low';
  if (status === 'review') return 'moderate';
  if (status === 'elevated_risk' || status === 'high_risk') return 'high';
  if (status === 'likely_false_positive') return 'extreme';
  if (status === 'unavailable') return UNKNOWN_VALUE;
  return UNKNOWN_VALUE;
}

function buildEvidenceBasis(nativeOutput = {}) {
  return {
    trueSoldCount: UNKNOWN_VALUE,
    activeListingCount: UNKNOWN_VALUE,
    fallbackUsed: false,
    staleCount: UNKNOWN_VALUE,
    rejectedCount: asArray(nativeOutput.criticalBlockers).length,
    transactionIneligibleCount: UNKNOWN_VALUE,
    sourceConcentration: UNKNOWN_VALUE,
    details: {
      falsePositiveRiskStatus: normalizeString(nativeOutput.falsePositiveRiskStatus),
      falsePositiveRiskLevel: normalizeString(nativeOutput.falsePositiveRiskLevel),
      criticalBlockerCount: asArray(nativeOutput.criticalBlockers).length,
      materialWarningCount: asArray(nativeOutput.materialWarnings).length,
      supportingFactorCount: asArray(nativeOutput.supportingFactors).length,
      conflictingSignalCount: asArray(nativeOutput.conflictingSignals).length,
      weakEvidenceIndicatorCount: asArray(nativeOutput.weakEvidenceIndicators).length,
      identityRiskIndicatorCount: asArray(nativeOutput.identityRiskIndicators).length,
      valuationRiskIndicatorCount: asArray(nativeOutput.valuationRiskIndicators).length,
      confidenceRiskIndicatorCount: asArray(nativeOutput.confidenceRiskIndicators).length,
      listingQualityAndGradingRiskIndicatorCount: asArray(nativeOutput.listingQualityAndGradingRiskIndicators).length,
      roiFragilityIndicatorCount: asArray(nativeOutput.roiFragilityIndicators).length,
      suspiciousPriceIndicatorCount: asArray(nativeOutput.suspiciousPriceIndicators).length,
      missingDiagnosticCount: asArray(nativeOutput.missingDiagnostics).length
    }
  };
}

function buildNormalizedOutput(nativeOutput = {}) {
  const dealGate = asObject(nativeOutput.dealGateOutcome);
  const buyNow = asObject(nativeOutput.buyNowEligibility);
  return {
    status: normalizeString(nativeOutput.falsePositiveRiskStatus),
    riskLevel: normalizeString(nativeOutput.falsePositiveRiskLevel),
    dealGatePassed: firstDefined(dealGate.passed, UNKNOWN_VALUE),
    dealGateDecision: normalizeString(firstDefined(dealGate.decision, dealGate.recommendation)),
    buyNowEligible: firstDefined(buyNow.eligible, UNKNOWN_VALUE),
    criticalBlockerCount: asArray(nativeOutput.criticalBlockers).length,
    materialWarningCount: asArray(nativeOutput.materialWarnings).length,
    conflictingSignalCount: asArray(nativeOutput.conflictingSignals).length,
    weakEvidenceIndicatorCount: asArray(nativeOutput.weakEvidenceIndicators).length,
    identityRiskIndicatorCount: asArray(nativeOutput.identityRiskIndicators).length,
    valuationRiskIndicatorCount: asArray(nativeOutput.valuationRiskIndicators).length,
    confidenceRiskIndicatorCount: asArray(nativeOutput.confidenceRiskIndicators).length,
    suspiciousPriceIndicatorCount: asArray(nativeOutput.suspiciousPriceIndicators).length,
    recommendedReviewAction: normalizeString(nativeOutput.recommendedReviewAction),
    productionAuthorityStatement: normalizeString(nativeOutput.productionAuthorityStatement)
  };
}

function createFalsePositiveAdapter(input = {}) {
  return createSignalMigrationAdapter({
    adapterId: firstDefined(input.adapterId, 'false-positive-signal-adapter'),
    adapterVersion: firstDefined(input.adapterVersion, '1.0.0'),
    engineName: FALSE_POSITIVE_PRODUCER,
    supportedEngineVersions: [DEFAULT_FALSE_POSITIVE_SIGNAL_VERSION],
    signalName: FALSE_POSITIVE_SIGNAL_NAME,
    signalVersion: DEFAULT_FALSE_POSITIVE_SIGNAL_VERSION,
    producer: FALSE_POSITIVE_PRODUCER,
    producerVersion: DEFAULT_FALSE_POSITIVE_SIGNAL_VERSION,
    producerCategory: FALSE_POSITIVE_PRODUCER_CATEGORY,
    signalType: 'risk',
    decisionRole: 'diagnostic_only',
    authorityLevel: 'shadow_observation',
    evidenceRole: 'diagnostic_context',
    nativeOutputAliases: ['nativeOutput', 'falsePositiveOutput', 'opportunityFalsePositiveOutput', 'diagnosticOutput', 'output'],
    nativeVersionAliases: ['schemaVersion', 'version'],
    requiredNativeFields: ['falsePositiveRiskStatus', 'falsePositiveRiskLevel', 'dealGateOutcome', 'buyNowEligibility'],
    optionalNativeFields: ['criticalBlockers', 'materialWarnings', 'supportingFactors', 'conflictingSignals', 'weakEvidenceIndicators', 'identityRiskIndicators', 'valuationRiskIndicators', 'confidenceRiskIndicators', 'listingQualityAndGradingRiskIndicators', 'roiFragilityIndicators', 'suspiciousPriceIndicators'],
    evidenceMapping: {
      kind: 'declarative',
      sourceFields: ['criticalBlockers', 'materialWarnings', 'supportingFactors', 'conflictingSignals'],
      targetFields: ['canonicalSignal.evidenceBasis', 'canonicalSignal.evidenceQuality'],
      semantics: 'false_positive_risk_indicators_wrapped_as_diagnostic_context'
    },
    confidenceMapping: {
      kind: 'declarative',
      sourceFields: ['falsePositiveRiskLevel'],
      targetFields: ['canonicalSignal.confidence', 'canonicalSignal.confidenceLevel'],
      semantics: 'risk_score_represents_diagnostic_risk_strength_not_production_confidence'
    },
    uncertaintyMapping: {
      kind: 'declarative',
      sourceFields: ['falsePositiveRiskStatus'],
      targetFields: ['canonicalSignal.uncertainty.level'],
      semantics: 'false_positive_status_maps_to_diagnostic_uncertainty'
    },
    statusMapping: {
      kind: 'declarative',
      sourceFields: ['falsePositiveRiskStatus', 'falsePositiveRiskLevel'],
      targetFields: ['canonicalSignal.normalizedOutput.status', 'canonicalSignal.normalizedOutput.riskLevel'],
      semantics: 'native_false_positive_status_and_risk_level_preserved'
    },
    metadataMapping: {
      kind: 'declarative',
      sourceFields: ['source', 'schemaVersion'],
      targetFields: ['canonicalSignal.metadata.nativeSource', 'canonicalSignal.metadata.nativeVersion'],
      semantics: 'native_metadata_preserved'
    },
    normalizedOutputMapping: {
      kind: 'approved_handler',
      sourceFields: ['falsePositiveRiskStatus', 'falsePositiveRiskLevel', 'dealGateOutcome', 'buyNowEligibility'],
      targetFields: ['canonicalSignal.normalizedOutput'],
      handlerRef: 'validation/falsePositiveSignalMigration#buildNormalizedOutput',
      semantics: 'false_positive_diagnostic_summary_projection'
    },
    semanticParityRules: [
      {
        ruleId: 'false_positive_raw_output_exact',
        kind: 'declarative',
        nativeFields: ['*'],
        shadowFields: ['canonicalSignal.rawOutput'],
        comparison: 'raw_output_must_match_exactly'
      },
      {
        ruleId: 'false_positive_status_semantic',
        kind: 'declarative',
        nativeFields: ['falsePositiveRiskStatus', 'falsePositiveRiskLevel'],
        shadowFields: ['canonicalSignal.normalizedOutput.status', 'canonicalSignal.normalizedOutput.riskLevel'],
        comparison: 'false_positive_status_and_risk_level_are_preserved'
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
    compatibilityNotes: ['wrapper-only migration preserves native False-Positive Diagnostics output'],
    createdAt: firstDefined(input.createdAt, UNKNOWN_VALUE)
  });
}

function resolveDefinition(registry, nativeOutput = {}) {
  if (!registry) return null;
  return getSignalDefinition(registry, FALSE_POSITIVE_SIGNAL_NAME, signalVersion(nativeOutput));
}

function getRegistryResolutionStatus(registry, definition) {
  if (!registry) return 'registry_missing';
  if (definition) return 'matched';
  if (asArray(registry.definitions).some((item) => item.signalName === FALSE_POSITIVE_SIGNAL_NAME)) return 'version_mismatch';
  return 'definition_missing';
}

function buildCanonicalFalsePositiveSignal(input = {}, definition = null) {
  const nativeOutput = clone(asObject(firstDefined(input.nativeOutput, input.falsePositiveOutput, input.opportunityFalsePositiveOutput, input.diagnosticOutput, input.output, {})));
  const sourceOutputFingerprint = buildSourceOutputFingerprint(nativeOutput, input.sourceOutputFingerprint);
  const producerVersion = signalVersion(nativeOutput, firstDefined(input.producerVersion, definition && definition.producerVersion));
  const score = riskScore(nativeOutput);
  return createCanonicalSignal({
    signalId: normalizeString(firstDefined(input.signalId, `${FALSE_POSITIVE_SIGNAL_NAME}:${sourceOutputFingerprint}`)),
    signalName: FALSE_POSITIVE_SIGNAL_NAME,
    producer: {
      producerId: FALSE_POSITIVE_PRODUCER,
      name: FALSE_POSITIVE_PRODUCER,
      module: 'validation/opportunityFalsePositiveDiagnostics.js',
      functionName: 'supplied_native_output',
      version: producerVersion,
      category: FALSE_POSITIVE_PRODUCER_CATEGORY,
      metadata: {
        migrationSource: FALSE_POSITIVE_MIGRATION_SOURCE,
        executesNativeEngine: false
      }
    },
    producerVersion,
    producerCategory: FALSE_POSITIVE_PRODUCER_CATEGORY,
    createdAt: normalizeDate(firstDefined(input.createdAt, UNKNOWN_VALUE)),
    signalType: 'risk',
    decisionRole: 'diagnostic_only',
    authorityLevel: 'shadow_observation',
    confidence: {
      kind: 'derived',
      value: score,
      scale: score === UNKNOWN_VALUE ? UNKNOWN_VALUE : '0_100',
      basis: 'false_positive_diagnostic_risk_level',
      calibrated: false
    },
    confidenceLevel: score === UNKNOWN_VALUE ? UNKNOWN_VALUE : score >= 80 ? 'high' : score >= 50 ? 'moderate' : 'low',
    uncertainty: {
      level: uncertaintyLevel(nativeOutput),
      range: UNKNOWN_VALUE,
      reasonCodes: unique([
        ...asArray(nativeOutput.criticalBlockers),
        ...asArray(nativeOutput.materialWarnings),
        ...asArray(nativeOutput.conflictingSignals)
      ]).sort()
    },
    evidenceBasis: buildEvidenceBasis(nativeOutput),
    evidenceQuality: {
      level: riskEvidenceQuality(nativeOutput),
      score,
      basis: 'false_positive_risk_level',
      details: {
        dealGateOutcome: clone(firstDefined(nativeOutput.dealGateOutcome, UNKNOWN_VALUE)),
        buyNowEligibility: clone(firstDefined(nativeOutput.buyNowEligibility, UNKNOWN_VALUE)),
        criticalBlockers: asArray(nativeOutput.criticalBlockers),
        materialWarnings: asArray(nativeOutput.materialWarnings)
      }
    },
    evidenceReferences: asArray(input.evidenceReferences),
    supportingSignals: asArray(input.supportingSignals),
    conflictingSignals: asArray(input.conflictingSignals),
    warnings: asArray(nativeOutput.materialWarnings),
    blockers: asArray(nativeOutput.criticalBlockers),
    rawOutput: nativeOutput,
    normalizedOutput: buildNormalizedOutput(nativeOutput),
    sourceFingerprint: sourceOutputFingerprint,
    metadata: {
      nativeSource: normalizeString(nativeOutput.source),
      nativeVersion: producerVersion,
      migrationSchemaVersion: FALSE_POSITIVE_MIGRATION_SCHEMA_VERSION,
      wrapperOnly: true
    }
  });
}

function buildAlignment(input = {}, canonicalSignal, definition, registryResolutionStatus) {
  return createSignalAlignment({
    alignmentId: normalizeString(firstDefined(input.alignmentId, `alignment:${canonicalSignal.signalId}`)),
    createdAt: normalizeDate(firstDefined(input.createdAt, canonicalSignal.createdAt)),
    producer: FALSE_POSITIVE_PRODUCER,
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
    schemaVersion: FALSE_POSITIVE_MIGRATION_SCHEMA_VERSION,
    source: `${FALSE_POSITIVE_MIGRATION_SOURCE}:adapted_signal`,
    adaptationId: normalizeString(firstDefined(input.adaptationId, `adaptation:${canonicalSignal.signalId}`)),
    createdAt: normalizeDate(firstDefined(input.createdAt, canonicalSignal.createdAt)),
    producer: FALSE_POSITIVE_PRODUCER,
    signalName: FALSE_POSITIVE_SIGNAL_NAME,
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
    alignmentRunId: normalizeString(firstDefined(input.alignmentRunId, input.runId, `false-positive-alignment-run:${adaptedSignal.sourceOutputFingerprint}`)),
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
      migrationSource: FALSE_POSITIVE_MIGRATION_SOURCE,
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
  if (!preserved) errors.push(validationIssue('native_output_parity_mismatch', 'Native False-Positive Diagnostics output was not preserved exactly.', 'nativeOutput'));
  return {
    parityStatus: preserved ? 'preserved' : 'changed',
    valid: preserved,
    errors,
    warnings: [],
    reasonCodes: unique(errors.map((error) => error.code)).sort()
  };
}

function summarizeFalsePositiveMigration(migration = {}) {
  return deepFreeze({
    ...summarizeSignalMigrationLifecycle(migration),
    schemaVersion: FALSE_POSITIVE_MIGRATION_SCHEMA_VERSION,
    migrationId: normalizeString(migration.migrationId),
    signalName: FALSE_POSITIVE_SIGNAL_NAME,
    producer: FALSE_POSITIVE_PRODUCER,
    nativeSource: normalizeString(migration.nativeOutput && migration.nativeOutput.source),
    nativeVersion: signalVersion(asObject(migration.nativeOutput)),
    falsePositiveRiskStatus: normalizeString(migration.nativeOutput && migration.nativeOutput.falsePositiveRiskStatus),
    falsePositiveRiskLevel: normalizeString(migration.nativeOutput && migration.nativeOutput.falsePositiveRiskLevel)
  });
}

function buildFalsePositiveMigrationFingerprint(migration = {}) {
  const projection = clone(migration);
  delete projection.migrationFingerprint;
  delete projection.falsePositiveMigrationFingerprint;
  return buildFingerprintFromProjection(projection);
}

function buildCoreArtifact(migration = {}) {
  return createSignalMigrationArtifact({
    migrationId: migration.migrationId,
    createdAt: migration.createdAt,
    engineName: FALSE_POSITIVE_PRODUCER,
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
      source: FALSE_POSITIVE_MIGRATION_SOURCE
    }
  });
}

function validateFalsePositiveMigration(migration = {}) {
  const errors = [];
  const warnings = [];
  const authorityViolations = [];
  const fingerprintViolations = [];
  const missing = REQUIRED_FALSE_POSITIVE_MIGRATION_FIELDS.filter((field) => {
    const value = migration[field];
    return value === undefined || value === null || value === '';
  });

  for (const field of missing) errors.push(validationIssue('missing_required_field', `${field} is required.`, field));
  if (migration.schemaVersion !== FALSE_POSITIVE_MIGRATION_SCHEMA_VERSION) errors.push(validationIssue('invalid_schema_version', 'schemaVersion must match False-Positive Signal Migration schema.', 'schemaVersion'));
  if (migration.source !== FALSE_POSITIVE_MIGRATION_SOURCE) errors.push(validationIssue('invalid_source', 'source must be false_positive_signal_migration.', 'source'));

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
  if (migration.migrationFingerprint && buildFalsePositiveMigrationFingerprint(migration) !== migration.migrationFingerprint) {
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

function migrateFalsePositiveSignal(input = {}, options = {}) {
  const adapter = createFalsePositiveAdapter({ createdAt: firstDefined(input.createdAt, options.createdAt) });
  const migration = executeSignalMigrationLifecycle(input, options, {
    schemaVersion: FALSE_POSITIVE_MIGRATION_SCHEMA_VERSION,
    migrationSource: FALSE_POSITIVE_MIGRATION_SOURCE,
    nativeOutputAliases: ['nativeOutput', 'falsePositiveOutput', 'opportunityFalsePositiveOutput', 'diagnosticOutput', 'output'],
    defaultMigrationIdPrefix: 'false-positive-signal-migration',
    defaultAlignmentBatchId: 'false-positive-signal-alignment-batch',
    defaultConflictAnalysisId: 'false-positive-signal-conflict-analysis',
    defaultReportId: 'false-positive-signal-alignment-report',
    resolveDefinition,
    getRegistryResolutionStatus,
    buildCanonicalSignal: buildCanonicalFalsePositiveSignal,
    buildAlignment,
    buildAdaptedSignal,
    buildAlignmentRun,
    verifyParity,
    summarizeMigration: summarizeFalsePositiveMigration,
    validateMigration: (candidate) => validateFalsePositiveMigration({ ...candidate, adapter, coreArtifact: buildCoreArtifact(candidate) }),
    buildMigrationFingerprint: buildFalsePositiveMigrationFingerprint
  });
  const withCore = {
    ...migration,
    adapter,
    coreArtifact: buildCoreArtifact(migration)
  };
  const withSummary = {
    ...withCore,
    summary: summarizeFalsePositiveMigration(withCore)
  };
  return deepFreeze({
    ...withSummary,
    validation: validateFalsePositiveMigration(withSummary),
    migrationFingerprint: buildFalsePositiveMigrationFingerprint(withSummary)
  });
}

module.exports = {
  DEFAULT_FALSE_POSITIVE_SIGNAL_VERSION,
  FALSE_POSITIVE_MIGRATION_SCHEMA_VERSION,
  FALSE_POSITIVE_MIGRATION_SOURCE,
  FALSE_POSITIVE_PRODUCER,
  FALSE_POSITIVE_SIGNAL_NAME,
  REQUIRED_FALSE_POSITIVE_MIGRATION_FIELDS,
  buildFalsePositiveMigrationFingerprint,
  createFalsePositiveAdapter,
  migrateFalsePositiveSignal,
  summarizeFalsePositiveMigration,
  validateFalsePositiveMigration
};
