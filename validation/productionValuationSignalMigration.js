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

const PRODUCTION_VALUATION_MIGRATION_SCHEMA_VERSION = '1.0.0';
const PRODUCTION_VALUATION_MIGRATION_SOURCE = 'production_valuation_signal_migration';
const PRODUCTION_VALUATION_SIGNAL_NAME = 'production.valuation.market_value';
const PRODUCTION_VALUATION_PRODUCER = 'marketValueEngine';
const PRODUCTION_VALUATION_PRODUCER_CATEGORY = 'production_engine';
const DEFAULT_PRODUCTION_VALUATION_SIGNAL_VERSION = '1.0.0';

const REQUIRED_PRODUCTION_VALUATION_MIGRATION_FIELDS = Object.freeze([
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
  return normalizeString(firstDefined(explicitVersion, nativeOutput.schemaVersion, nativeOutput.version, DEFAULT_PRODUCTION_VALUATION_SIGNAL_VERSION));
}

function valuationConfidence(nativeOutput = {}) {
  return firstDefined(nativeOutput.confidence, nativeOutput.marketConfidence, UNKNOWN_VALUE);
}

function confidenceLevel(nativeOutput = {}) {
  const value = Number(valuationConfidence(nativeOutput));
  if (!Number.isFinite(value)) return UNKNOWN_VALUE;
  if (value >= 75) return 'high';
  if (value >= 50) return 'moderate';
  if (value > 0) return 'low';
  return 'insufficient';
}

function uncertaintyLevel(nativeOutput = {}) {
  const source = normalizeString(nativeOutput.source);
  const confidence = Number(valuationConfidence(nativeOutput));
  if (source === 'sold_market' && confidence >= 75) return 'low';
  if (source === 'sold_market' || source === 'blended_market') return 'moderate';
  if (source === 'active_market' || source === 'insufficient_evidence') return 'high';
  if (source === 'fallback') return 'extreme';
  return UNKNOWN_VALUE;
}

function evidenceQualityLevel(nativeOutput = {}) {
  const source = normalizeString(nativeOutput.source);
  const soldCount = Number(firstDefined(nativeOutput.soldCompCount, 0));
  if (source === 'sold_market' && soldCount >= 5) return 'strong';
  if (source === 'sold_market' || source === 'blended_market') return 'adequate';
  if (source === 'active_market') return 'limited';
  if (source === 'insufficient_evidence') return 'insufficient';
  if (source === 'fallback') return 'weak';
  return UNKNOWN_VALUE;
}

function buildEvidenceBasis(nativeOutput = {}) {
  const compEngine = asObject(nativeOutput.compEngine);
  const activeContext = asObject(nativeOutput.activeMarketContext);
  return {
    trueSoldCount: firstDefined(nativeOutput.soldCompCount, UNKNOWN_VALUE),
    activeListingCount: firstDefined(nativeOutput.activeCompCount, activeContext.activeComparableCount, UNKNOWN_VALUE),
    fallbackUsed: normalizeString(nativeOutput.source) === 'fallback' || compEngine.heuristicFallbackUsed === true,
    staleCount: UNKNOWN_VALUE,
    rejectedCount: firstDefined(compEngine.rejectedCompCount, UNKNOWN_VALUE),
    transactionIneligibleCount: UNKNOWN_VALUE,
    sourceConcentration: UNKNOWN_VALUE,
    details: {
      valuationSource: normalizeString(nativeOutput.source),
      method: normalizeString(nativeOutput.method),
      compCount: firstDefined(nativeOutput.compCount, UNKNOWN_VALUE),
      soldCompCount: firstDefined(nativeOutput.soldCompCount, UNKNOWN_VALUE),
      activeCompCount: firstDefined(nativeOutput.activeCompCount, UNKNOWN_VALUE),
      outliersRemoved: firstDefined(nativeOutput.outliersRemoved, UNKNOWN_VALUE),
      compEngine: clone(firstDefined(nativeOutput.compEngine, UNKNOWN_VALUE)),
      activeMarketContext: clone(firstDefined(nativeOutput.activeMarketContext, UNKNOWN_VALUE))
    }
  };
}

function buildNormalizedOutput(nativeOutput = {}) {
  return {
    source: normalizeString(nativeOutput.source),
    method: normalizeString(nativeOutput.method),
    marketValue: firstDefined(nativeOutput.marketValue, UNKNOWN_VALUE),
    expectedValue: firstDefined(nativeOutput.expectedValue, nativeOutput.marketValue, UNKNOWN_VALUE),
    expectedValueLow: firstDefined(nativeOutput.expectedValueLow, UNKNOWN_VALUE),
    expectedValueHigh: firstDefined(nativeOutput.expectedValueHigh, UNKNOWN_VALUE),
    baseMarketValue: firstDefined(nativeOutput.baseMarketValue, UNKNOWN_VALUE),
    confidence: valuationConfidence(nativeOutput),
    compCount: firstDefined(nativeOutput.compCount, UNKNOWN_VALUE),
    soldCompCount: firstDefined(nativeOutput.soldCompCount, UNKNOWN_VALUE),
    activeCompCount: firstDefined(nativeOutput.activeCompCount, UNKNOWN_VALUE),
    outliersRemoved: firstDefined(nativeOutput.outliersRemoved, UNKNOWN_VALUE),
    listingPrice: firstDefined(nativeOutput.listingPrice, UNKNOWN_VALUE),
    discountAmount: firstDefined(nativeOutput.discountAmount, UNKNOWN_VALUE),
    discountPercent: firstDefined(nativeOutput.discountPercent, UNKNOWN_VALUE),
    priceRange: clone(firstDefined(nativeOutput.priceRange, UNKNOWN_VALUE)),
    note: normalizeString(nativeOutput.note)
  };
}

function createProductionValuationAdapter(input = {}) {
  return createSignalMigrationAdapter({
    adapterId: firstDefined(input.adapterId, 'production-valuation-signal-adapter'),
    adapterVersion: firstDefined(input.adapterVersion, '1.0.0'),
    engineName: PRODUCTION_VALUATION_PRODUCER,
    supportedEngineVersions: [DEFAULT_PRODUCTION_VALUATION_SIGNAL_VERSION],
    signalName: PRODUCTION_VALUATION_SIGNAL_NAME,
    signalVersion: DEFAULT_PRODUCTION_VALUATION_SIGNAL_VERSION,
    producer: PRODUCTION_VALUATION_PRODUCER,
    producerVersion: DEFAULT_PRODUCTION_VALUATION_SIGNAL_VERSION,
    producerCategory: PRODUCTION_VALUATION_PRODUCER_CATEGORY,
    signalType: 'valuation',
    decisionRole: 'diagnostic_only',
    authorityLevel: 'shadow_observation',
    evidenceRole: 'diagnostic_context',
    nativeOutputAliases: ['nativeOutput', 'productionValuationOutput', 'valuationOutput', 'marketData', 'valuation', 'output'],
    nativeVersionAliases: ['schemaVersion', 'version'],
    requiredNativeFields: ['source', 'method', 'marketValue', 'expectedValue', 'confidence', 'compCount'],
    optionalNativeFields: ['expectedValueLow', 'expectedValueHigh', 'baseMarketValue', 'soldCompCount', 'activeCompCount', 'priceRange', 'evidence', 'compEngine', 'adjustments', 'note'],
    evidenceMapping: {
      kind: 'declarative',
      sourceFields: ['soldCompCount', 'activeCompCount', 'compCount', 'compEngine', 'activeMarketContext'],
      targetFields: ['canonicalSignal.evidenceBasis', 'canonicalSignal.evidenceQuality'],
      semantics: 'production_valuation_evidence_counts_and_source_wrapped_as_diagnostic_context'
    },
    confidenceMapping: {
      kind: 'declarative',
      sourceFields: ['confidence'],
      targetFields: ['canonicalSignal.confidence', 'canonicalSignal.confidenceLevel'],
      semantics: 'native_valuation_confidence_preserved_as_reported_confidence'
    },
    uncertaintyMapping: {
      kind: 'declarative',
      sourceFields: ['source', 'confidence'],
      targetFields: ['canonicalSignal.uncertainty.level'],
      semantics: 'valuation_source_and_confidence_map_to_shadow_uncertainty'
    },
    statusMapping: {
      kind: 'declarative',
      sourceFields: ['source', 'method'],
      targetFields: ['canonicalSignal.normalizedOutput.source', 'canonicalSignal.normalizedOutput.method'],
      semantics: 'native_valuation_source_and_method_preserved'
    },
    metadataMapping: {
      kind: 'declarative',
      sourceFields: ['source', 'schemaVersion'],
      targetFields: ['canonicalSignal.metadata.nativeSource', 'canonicalSignal.metadata.nativeVersion'],
      semantics: 'native_metadata_preserved'
    },
    normalizedOutputMapping: {
      kind: 'approved_handler',
      sourceFields: ['source', 'method', 'marketValue', 'expectedValue', 'confidence', 'priceRange'],
      targetFields: ['canonicalSignal.normalizedOutput'],
      handlerRef: 'validation/productionValuationSignalMigration#buildNormalizedOutput',
      semantics: 'production_valuation_summary_projection'
    },
    semanticParityRules: [
      {
        ruleId: 'production_valuation_raw_output_exact',
        kind: 'declarative',
        nativeFields: ['*'],
        shadowFields: ['canonicalSignal.rawOutput'],
        comparison: 'raw_output_must_match_exactly'
      },
      {
        ruleId: 'production_valuation_value_range_semantic',
        kind: 'declarative',
        nativeFields: ['expectedValueLow', 'expectedValue', 'expectedValueHigh', 'priceRange'],
        shadowFields: ['canonicalSignal.normalizedOutput'],
        comparison: 'native_value_range_fields_are_preserved_as_shadow_context'
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
    compatibilityNotes: ['wrapper-only migration preserves native Production Valuation output'],
    createdAt: firstDefined(input.createdAt, UNKNOWN_VALUE)
  });
}

function resolveDefinition(registry, nativeOutput = {}) {
  if (!registry) return null;
  return getSignalDefinition(registry, PRODUCTION_VALUATION_SIGNAL_NAME, signalVersion(nativeOutput));
}

function getRegistryResolutionStatus(registry, definition) {
  if (!registry) return 'registry_missing';
  if (definition) return 'matched';
  if (asArray(registry.definitions).some((item) => item.signalName === PRODUCTION_VALUATION_SIGNAL_NAME)) return 'version_mismatch';
  return 'definition_missing';
}

function buildCanonicalProductionValuationSignal(input = {}, definition = null) {
  const nativeOutput = clone(asObject(firstDefined(input.nativeOutput, input.productionValuationOutput, input.valuationOutput, input.marketData, input.valuation, input.output, {})));
  const sourceOutputFingerprint = buildSourceOutputFingerprint(nativeOutput, input.sourceOutputFingerprint);
  const producerVersion = signalVersion(nativeOutput, firstDefined(input.producerVersion, definition && definition.producerVersion));
  return createCanonicalSignal({
    signalId: normalizeString(firstDefined(input.signalId, `${PRODUCTION_VALUATION_SIGNAL_NAME}:${sourceOutputFingerprint}`)),
    signalName: PRODUCTION_VALUATION_SIGNAL_NAME,
    producer: {
      producerId: PRODUCTION_VALUATION_PRODUCER,
      name: PRODUCTION_VALUATION_PRODUCER,
      module: 'engines/marketValueEngine.js',
      functionName: 'supplied_native_output',
      version: producerVersion,
      category: PRODUCTION_VALUATION_PRODUCER_CATEGORY,
      metadata: {
        migrationSource: PRODUCTION_VALUATION_MIGRATION_SOURCE,
        executesNativeEngine: false
      }
    },
    producerVersion,
    producerCategory: PRODUCTION_VALUATION_PRODUCER_CATEGORY,
    createdAt: normalizeDate(firstDefined(input.createdAt, UNKNOWN_VALUE)),
    signalType: 'valuation',
    decisionRole: 'diagnostic_only',
    authorityLevel: 'shadow_observation',
    confidence: {
      kind: 'reported',
      value: valuationConfidence(nativeOutput),
      scale: valuationConfidence(nativeOutput) === UNKNOWN_VALUE ? UNKNOWN_VALUE : '0_100',
      basis: 'native_production_valuation_confidence',
      calibrated: false
    },
    confidenceLevel: confidenceLevel(nativeOutput),
    uncertainty: {
      level: uncertaintyLevel(nativeOutput),
      range: clone(firstDefined(nativeOutput.priceRange, UNKNOWN_VALUE)),
      reasonCodes: unique([
        normalizeString(nativeOutput.source, ''),
        ...asArray(nativeOutput.warnings)
      ]).sort()
    },
    evidenceBasis: buildEvidenceBasis(nativeOutput),
    evidenceQuality: {
      level: evidenceQualityLevel(nativeOutput),
      score: valuationConfidence(nativeOutput),
      basis: 'production_valuation_source_and_comp_counts',
      details: {
        source: normalizeString(nativeOutput.source),
        method: normalizeString(nativeOutput.method),
        soldCompCount: firstDefined(nativeOutput.soldCompCount, UNKNOWN_VALUE),
        activeCompCount: firstDefined(nativeOutput.activeCompCount, UNKNOWN_VALUE)
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
      migrationSchemaVersion: PRODUCTION_VALUATION_MIGRATION_SCHEMA_VERSION,
      wrapperOnly: true
    }
  });
}

function buildAlignment(input = {}, canonicalSignal, definition, registryResolutionStatus) {
  return createSignalAlignment({
    alignmentId: normalizeString(firstDefined(input.alignmentId, `alignment:${canonicalSignal.signalId}`)),
    createdAt: normalizeDate(firstDefined(input.createdAt, canonicalSignal.createdAt)),
    producer: PRODUCTION_VALUATION_PRODUCER,
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
    schemaVersion: PRODUCTION_VALUATION_MIGRATION_SCHEMA_VERSION,
    source: `${PRODUCTION_VALUATION_MIGRATION_SOURCE}:adapted_signal`,
    adaptationId: normalizeString(firstDefined(input.adaptationId, `adaptation:${canonicalSignal.signalId}`)),
    createdAt: normalizeDate(firstDefined(input.createdAt, canonicalSignal.createdAt)),
    producer: PRODUCTION_VALUATION_PRODUCER,
    signalName: PRODUCTION_VALUATION_SIGNAL_NAME,
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
    alignmentRunId: normalizeString(firstDefined(input.alignmentRunId, input.runId, `production-valuation-alignment-run:${adaptedSignal.sourceOutputFingerprint}`)),
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
      migrationSource: PRODUCTION_VALUATION_MIGRATION_SOURCE,
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
  if (!preserved) errors.push(validationIssue('native_output_parity_mismatch', 'Native Production Valuation output was not preserved exactly.', 'nativeOutput'));
  return {
    parityStatus: preserved ? 'preserved' : 'changed',
    valid: preserved,
    errors,
    warnings: [],
    reasonCodes: unique(errors.map((error) => error.code)).sort()
  };
}

function summarizeProductionValuationMigration(migration = {}) {
  return deepFreeze({
    ...summarizeSignalMigrationLifecycle(migration),
    schemaVersion: PRODUCTION_VALUATION_MIGRATION_SCHEMA_VERSION,
    migrationId: normalizeString(migration.migrationId),
    signalName: PRODUCTION_VALUATION_SIGNAL_NAME,
    producer: PRODUCTION_VALUATION_PRODUCER,
    nativeSource: normalizeString(migration.nativeOutput && migration.nativeOutput.source),
    nativeVersion: signalVersion(asObject(migration.nativeOutput)),
    marketValue: firstDefined(migration.nativeOutput && migration.nativeOutput.marketValue, UNKNOWN_VALUE),
    confidence: valuationConfidence(asObject(migration.nativeOutput))
  });
}

function buildProductionValuationMigrationFingerprint(migration = {}) {
  const projection = clone(migration);
  delete projection.migrationFingerprint;
  delete projection.productionValuationMigrationFingerprint;
  return buildFingerprintFromProjection(projection);
}

function buildCoreArtifact(migration = {}) {
  return createSignalMigrationArtifact({
    migrationId: migration.migrationId,
    createdAt: migration.createdAt,
    engineName: PRODUCTION_VALUATION_PRODUCER,
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
      source: PRODUCTION_VALUATION_MIGRATION_SOURCE
    }
  });
}

function validateProductionValuationMigration(migration = {}) {
  const errors = [];
  const warnings = [];
  const authorityViolations = [];
  const fingerprintViolations = [];
  const missing = REQUIRED_PRODUCTION_VALUATION_MIGRATION_FIELDS.filter((field) => {
    const value = migration[field];
    return value === undefined || value === null || value === '';
  });

  for (const field of missing) errors.push(validationIssue('missing_required_field', `${field} is required.`, field));
  if (migration.schemaVersion !== PRODUCTION_VALUATION_MIGRATION_SCHEMA_VERSION) errors.push(validationIssue('invalid_schema_version', 'schemaVersion must match Production Valuation Signal Migration schema.', 'schemaVersion'));
  if (migration.source !== PRODUCTION_VALUATION_MIGRATION_SOURCE) errors.push(validationIssue('invalid_source', 'source must be production_valuation_signal_migration.', 'source'));

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
  if (migration.migrationFingerprint && buildProductionValuationMigrationFingerprint(migration) !== migration.migrationFingerprint) {
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

function migrateProductionValuationSignal(input = {}, options = {}) {
  const adapter = createProductionValuationAdapter({ createdAt: firstDefined(input.createdAt, options.createdAt) });
  const migration = executeSignalMigrationLifecycle(input, options, {
    schemaVersion: PRODUCTION_VALUATION_MIGRATION_SCHEMA_VERSION,
    migrationSource: PRODUCTION_VALUATION_MIGRATION_SOURCE,
    nativeOutputAliases: ['nativeOutput', 'productionValuationOutput', 'valuationOutput', 'marketData', 'valuation', 'output'],
    defaultMigrationIdPrefix: 'production-valuation-signal-migration',
    defaultAlignmentBatchId: 'production-valuation-signal-alignment-batch',
    defaultConflictAnalysisId: 'production-valuation-signal-conflict-analysis',
    defaultReportId: 'production-valuation-signal-alignment-report',
    resolveDefinition,
    getRegistryResolutionStatus,
    buildCanonicalSignal: buildCanonicalProductionValuationSignal,
    buildAlignment,
    buildAdaptedSignal,
    buildAlignmentRun,
    verifyParity,
    summarizeMigration: summarizeProductionValuationMigration,
    validateMigration: (candidate) => validateProductionValuationMigration({ ...candidate, adapter, coreArtifact: buildCoreArtifact(candidate) }),
    buildMigrationFingerprint: buildProductionValuationMigrationFingerprint
  });
  const withCore = {
    ...migration,
    adapter,
    coreArtifact: buildCoreArtifact(migration)
  };
  const withSummary = {
    ...withCore,
    summary: summarizeProductionValuationMigration(withCore)
  };
  return deepFreeze({
    ...withSummary,
    validation: validateProductionValuationMigration(withSummary),
    migrationFingerprint: buildProductionValuationMigrationFingerprint(withSummary)
  });
}

module.exports = {
  DEFAULT_PRODUCTION_VALUATION_SIGNAL_VERSION,
  PRODUCTION_VALUATION_MIGRATION_SCHEMA_VERSION,
  PRODUCTION_VALUATION_MIGRATION_SOURCE,
  PRODUCTION_VALUATION_PRODUCER,
  PRODUCTION_VALUATION_SIGNAL_NAME,
  REQUIRED_PRODUCTION_VALUATION_MIGRATION_FIELDS,
  buildProductionValuationMigrationFingerprint,
  createProductionValuationAdapter,
  migrateProductionValuationSignal,
  summarizeProductionValuationMigration,
  validateProductionValuationMigration
};
