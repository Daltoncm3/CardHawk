'use strict';

const {
  asArray,
  asObject,
  unique
} = require('./canonicalValidationCore');
const {
  buildFingerprintFromProjection
} = require('./fingerprintProjection');
const {
  clone,
  firstDefined
} = require('./phase8GovernanceCore');
const {
  UNKNOWN_VALUE,
  createCanonicalSignal,
  validateCanonicalSignal
} = require('./canonicalIntelligenceSignalContract');
const {
  getSignalDefinition,
  validateSignalDefinition,
  validateSignalRegistry
} = require('./intelligenceSignalRegistry');
const {
  createSignalAlignment,
  validateSignalAlignment
} = require('./signalAlignmentContract');

const SIGNAL_PRODUCER_ADAPTER_SCHEMA_VERSION = '1.0.0';
const SIGNAL_PRODUCER_ADAPTER_SOURCE = 'signal_producer_adapter';

const SUPPORTED_DIAGNOSTIC_PRODUCERS = Object.freeze({
  identityParserDiagnostics: Object.freeze({
    producer: 'identityParserDiagnostics',
    producerVersion: '1.0.0',
    producerCategory: 'offline_validation',
    signalName: 'identity.parser.diagnostics',
    signalVersion: '1.0.0',
    signalType: 'identity',
    decisionRole: 'diagnostic_only',
    authorityLevel: 'offline_validation',
    confidenceLevel: 'not_applicable',
    confidence: {
      kind: 'not_applicable',
      value: UNKNOWN_VALUE,
      scale: UNKNOWN_VALUE,
      basis: 'identity_parser_diagnostic',
      calibrated: false
    },
    evidenceQuality: {
      level: 'not_applicable',
      score: UNKNOWN_VALUE,
      basis: 'identity_parser_diagnostic'
    },
    evidenceBasis: {
      trueSoldCount: UNKNOWN_VALUE,
      activeListingCount: UNKNOWN_VALUE,
      fallbackUsed: false,
      staleCount: UNKNOWN_VALUE,
      rejectedCount: UNKNOWN_VALUE,
      transactionIneligibleCount: UNKNOWN_VALUE,
      sourceConcentration: UNKNOWN_VALUE
    },
    outputStatusField: 'diagnosticStatus',
    outputUncertaintyField: 'ambiguityLevel',
    warningField: 'warnings',
    blockerField: 'blockingIssues'
  }),
  evidenceReadinessDiagnostics: Object.freeze({
    producer: 'evidenceReadinessDiagnostics',
    producerVersion: '1.0.0',
    producerCategory: 'offline_validation',
    signalName: 'evidence.readiness.diagnostics',
    signalVersion: '1.0.0',
    signalType: 'evidence',
    decisionRole: 'diagnostic_only',
    authorityLevel: 'offline_validation',
    confidenceLevel: UNKNOWN_VALUE,
    confidence: {
      kind: UNKNOWN_VALUE,
      value: UNKNOWN_VALUE,
      scale: UNKNOWN_VALUE,
      basis: 'evidence_readiness_diagnostic',
      calibrated: false
    },
    evidenceQuality: {
      level: UNKNOWN_VALUE,
      score: UNKNOWN_VALUE,
      basis: 'evidence_readiness_diagnostic'
    },
    evidenceBasis: {
      trueSoldCount: UNKNOWN_VALUE,
      activeListingCount: UNKNOWN_VALUE,
      fallbackUsed: false,
      staleCount: UNKNOWN_VALUE,
      rejectedCount: UNKNOWN_VALUE,
      transactionIneligibleCount: UNKNOWN_VALUE,
      sourceConcentration: UNKNOWN_VALUE
    },
    outputStatusField: 'readinessStatus',
    outputUncertaintyField: 'readinessLevel',
    warningField: 'warnings',
    blockerField: 'blockingReasons'
  })
});

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

function normalizeStringArray(values = []) {
  return unique(asArray(values).map((value) => normalizeString(value, '')).filter(Boolean)).sort();
}

function buildAdaptationFingerprint(adaptation = {}) {
  const projection = clone(adaptation);
  delete projection.adaptationFingerprint;
  delete projection.batchFingerprint;
  return buildFingerprintFromProjection(projection);
}

function getProducerConfig(producer) {
  return SUPPORTED_DIAGNOSTIC_PRODUCERS[normalizeString(producer, '')] || null;
}

function resolveProducer(input = {}) {
  const nativeOutput = asObject(firstDefined(input.nativeOutput, input.diagnosticOutput, input.output, {}));
  const source = normalizeString(nativeOutput.source, '');
  if (source === 'identity_parser_diagnostics') return 'identityParserDiagnostics';
  if (source === 'evidence_readiness_diagnostics') return 'evidenceReadinessDiagnostics';
  return normalizeString(firstDefined(input.producer, input.sourceProducer));
}

function buildNativeOutputFingerprint(nativeOutput = {}, explicitFingerprint) {
  if (known(explicitFingerprint)) return normalizeString(explicitFingerprint);
  if (known(nativeOutput.stableFingerprint)) return normalizeString(nativeOutput.stableFingerprint);
  if (known(nativeOutput.signalFingerprint)) return normalizeString(nativeOutput.signalFingerprint);
  return buildFingerprintFromProjection(nativeOutput);
}

function getDefinition(registry, config) {
  if (!registry || !config) return null;
  return getSignalDefinition(registry, config.signalName, config.signalVersion);
}

function getRegistryLookupStatus(registry, definition, config) {
  if (!config) return 'unsupported_producer';
  if (!registry) return 'registry_missing';
  if (definition) return 'matched';
  const definitions = asArray(registry.definitions);
  if (definitions.some((item) => item.signalName === config.signalName)) return 'version_mismatch';
  return 'definition_missing';
}

function mapEvidenceBasis(nativeOutput = {}, config = {}) {
  if (config.producer !== 'evidenceReadinessDiagnostics') {
    return clone(config.evidenceBasis);
  }

  const eligible = asObject(nativeOutput.eligibleEvidenceSummary);
  const excluded = asObject(nativeOutput.excludedEvidenceSummary);
  return {
    trueSoldCount: firstDefined(eligible.trueSoldEvidenceCount, UNKNOWN_VALUE),
    activeListingCount: firstDefined(excluded.activeListingCount, UNKNOWN_VALUE),
    fallbackUsed: Number(firstDefined(excluded.fallbackEvidenceCount, 0)) > 0,
    staleCount: firstDefined(excluded.staleEvidenceCount, UNKNOWN_VALUE),
    rejectedCount: firstDefined(excluded.rejectedComparableCount, UNKNOWN_VALUE),
    transactionIneligibleCount: firstDefined(excluded.transactionIneligibleEvidenceCount, UNKNOWN_VALUE),
    sourceConcentration: firstDefined(eligible.sourceConcentration, UNKNOWN_VALUE),
    duplicateCount: firstDefined(excluded.duplicateEvidenceCount, UNKNOWN_VALUE),
    contextualComparableCount: firstDefined(excluded.contextualComparableCount, UNKNOWN_VALUE)
  };
}

function mapEvidenceQuality(nativeOutput = {}, config = {}) {
  if (config.producer !== 'evidenceReadinessDiagnostics') return clone(config.evidenceQuality);
  const quality = asObject(nativeOutput.comparableQuality);
  return {
    level: normalizeString(firstDefined(quality.qualityLevel, quality.overallQuality, UNKNOWN_VALUE)),
    score: firstDefined(quality.averageQualityScore, quality.qualityScore, UNKNOWN_VALUE),
    basis: 'evidence_readiness_comparable_quality'
  };
}

function mapUncertainty(nativeOutput = {}, config = {}) {
  const rawLevel = nativeOutput[config.outputUncertaintyField];
  const normalized = normalizeString(rawLevel);
  const levelMap = {
    none: 'low',
    low: 'low',
    medium: 'moderate',
    moderate: 'moderate',
    high: 'high',
    blocking: 'extreme',
    strong: 'low',
    adequate: 'moderate',
    limited: 'high',
    insufficient: 'high',
    blocked: 'extreme',
    unavailable: UNKNOWN_VALUE
  };
  return {
    level: levelMap[normalized] || UNKNOWN_VALUE,
    nativeLevel: normalized,
    reasonCodes: normalizeStringArray([
      ...asArray(nativeOutput[config.warningField]),
      ...asArray(nativeOutput[config.blockerField])
    ])
  };
}

function mapNormalizedOutput(nativeOutput = {}, config = {}) {
  return {
    status: normalizeString(nativeOutput[config.outputStatusField]),
    uncertainty: normalizeString(nativeOutput[config.outputUncertaintyField]),
    recommendedReviewAction: normalizeString(nativeOutput.recommendedReviewAction),
    stableFingerprint: normalizeString(nativeOutput.stableFingerprint)
  };
}

function buildCanonicalSignalInput(input = {}, config, nativeOutput, sourceOutputFingerprint) {
  return {
    signalId: normalizeString(firstDefined(input.signalId, `${config.signalName}:${sourceOutputFingerprint}`)),
    signalName: config.signalName,
    producer: {
      producerId: config.producer,
      name: config.producer,
      module: `validation/${config.producer}.js`,
      functionName: 'supplied_native_output',
      version: config.producerVersion,
      category: config.producerCategory,
      metadata: {
        adapterSource: SIGNAL_PRODUCER_ADAPTER_SOURCE,
        executesNativeEngine: false
      }
    },
    producerVersion: config.producerVersion,
    producerCategory: config.producerCategory,
    createdAt: normalizeDate(firstDefined(input.createdAt, nativeOutput.createdAt, nativeOutput.generatedAt, UNKNOWN_VALUE)),
    signalType: config.signalType,
    decisionRole: config.decisionRole,
    authorityLevel: config.authorityLevel,
    confidence: clone(config.confidence),
    confidenceLevel: config.confidenceLevel,
    uncertainty: mapUncertainty(nativeOutput, config),
    evidenceBasis: mapEvidenceBasis(nativeOutput, config),
    evidenceQuality: mapEvidenceQuality(nativeOutput, config),
    evidenceReferences: asArray(input.evidenceReferences),
    supportingSignals: asArray(input.supportingSignals),
    conflictingSignals: asArray(input.conflictingSignals),
    warnings: asArray(nativeOutput[config.warningField]),
    blockers: asArray(nativeOutput[config.blockerField]),
    rawOutput: clone(nativeOutput),
    normalizedOutput: mapNormalizedOutput(nativeOutput, config),
    sourceFingerprint: sourceOutputFingerprint,
    metadata: {
      nativeSource: normalizeString(nativeOutput.source),
      nativeSchemaVersion: normalizeString(nativeOutput.schemaVersion),
      adapterSchemaVersion: SIGNAL_PRODUCER_ADAPTER_SCHEMA_VERSION
    }
  };
}

function buildAlignmentInput(input = {}, config, nativeOutput, canonicalSignal, definition, registryLookupStatus, sourceOutputFingerprint) {
  return {
    alignmentId: normalizeString(firstDefined(input.alignmentId, `alignment:${canonicalSignal.signalId}`)),
    createdAt: normalizeDate(firstDefined(input.createdAt, canonicalSignal.createdAt, UNKNOWN_VALUE)),
    producer: config.producer,
    producerVersion: config.producerVersion,
    sourceOutputFingerprint,
    registryId: normalizeString(input.registryId),
    registryFingerprint: normalizeString(input.registryFingerprint),
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
    warnings: registryLookupStatus === 'matched' ? [] : [registryLookupStatus],
    errors: [],
    missingMetadata: registryLookupStatus === 'matched' ? [] : ['signalDefinition'],
    metadata: {
      registryLookupStatus,
      nativeStatus: normalizeString(nativeOutput[config.outputStatusField])
    }
  };
}

function validationError(code, message, field = '') {
  return { code, message, field };
}

function buildStructuredValidation(adapted = {}) {
  const errors = [];
  const warnings = [];
  const registryLookupStatus = normalizeString(adapted.registryLookupStatus, 'unknown');
  const alignmentStatus = adapted.alignment ? adapted.alignment.alignmentStatus : 'unknown';
  const authorityStatus = adapted.alignment && adapted.alignment.authorityAlignment ? adapted.alignment.authorityAlignment.status : 'unknown';

  if (registryLookupStatus !== 'matched') {
    warnings.push(validationError(registryLookupStatus, `Registry lookup status is ${registryLookupStatus}.`, 'registryLookupStatus'));
  }

  const signalValidation = adapted.canonicalSignal ? validateCanonicalSignal(adapted.canonicalSignal) : { valid: false, errors: [validationError('canonical_signal_missing', 'canonicalSignal is required.', 'canonicalSignal')], warnings: [] };
  const alignmentValidation = adapted.alignment ? validateSignalAlignment(adapted.alignment) : { valid: false, errors: [validationError('alignment_missing', 'alignment is required.', 'alignment')], warnings: [] };
  const definitionValidation = adapted.signalDefinition && adapted.signalDefinition !== UNKNOWN_VALUE
    ? validateSignalDefinition(adapted.signalDefinition)
    : { valid: registryLookupStatus !== 'matched', errors: [], warnings: [] };

  errors.push(...signalValidation.errors.map((error) => ({ ...error, field: `canonicalSignal.${error.field}` })));
  errors.push(...alignmentValidation.errors.map((error) => ({ ...error, field: `alignment.${error.field}` })));
  errors.push(...definitionValidation.errors.map((error) => ({ ...error, field: `signalDefinition.${error.field}` })));
  warnings.push(...signalValidation.warnings.map((warning) => ({ ...warning, field: `canonicalSignal.${warning.field}` })));
  warnings.push(...alignmentValidation.warnings.map((warning) => ({ ...warning, field: `alignment.${warning.field}` })));
  warnings.push(...definitionValidation.warnings.map((warning) => ({ ...warning, field: `signalDefinition.${warning.field}` })));

  const valid = errors.length === 0 && Boolean(adapted.canonicalSignal) && Boolean(adapted.alignment);
  const reasonCodes = unique([
    ...errors.map((error) => error.code),
    ...warnings.map((warning) => warning.code)
  ]);

  return {
    valid,
    errors,
    warnings,
    reasonCodes,
    registryLookupStatus,
    alignmentStatus,
    authorityStatus
  };
}

function adaptDiagnosticSignal(input = {}, options = {}) {
  const nativeOutput = clone(asObject(firstDefined(input.nativeOutput, input.diagnosticOutput, input.output, {})));
  const producer = resolveProducer({ ...input, nativeOutput });
  const config = getProducerConfig(producer);
  const sourceOutputFingerprint = buildNativeOutputFingerprint(nativeOutput, input.sourceOutputFingerprint);

  if (!config) {
    const result = {
      schemaVersion: SIGNAL_PRODUCER_ADAPTER_SCHEMA_VERSION,
      source: SIGNAL_PRODUCER_ADAPTER_SOURCE,
      adaptationId: normalizeString(firstDefined(input.adaptationId, `adaptation:unsupported:${sourceOutputFingerprint}`)),
      createdAt: normalizeDate(firstDefined(input.createdAt, options.createdAt, UNKNOWN_VALUE)),
      producer,
      signalName: UNKNOWN_VALUE,
      signalVersion: UNKNOWN_VALUE,
      sourceOutputFingerprint,
      registryLookupStatus: 'unsupported_producer',
      signalDefinition: UNKNOWN_VALUE,
      canonicalSignal: null,
      alignment: null,
      validation: {
        valid: false,
        errors: [validationError('unsupported_diagnostic_producer', 'Unsupported diagnostic producer.', 'producer')],
        warnings: [],
        reasonCodes: ['unsupported_diagnostic_producer'],
        registryLookupStatus: 'unsupported_producer',
        alignmentStatus: UNKNOWN_VALUE,
        authorityStatus: UNKNOWN_VALUE
      },
      productionImpact: 'none',
      decisionImpact: 'none',
      executionAuthority: 'none'
    };
    return deepFreeze({
      ...result,
      adaptationFingerprint: buildAdaptationFingerprint(result)
    });
  }

  const registryInput = firstDefined(input.registry, options.registry, null);
  const registryValidation = registryInput ? validateSignalRegistry(registryInput) : null;
  const definition = getDefinition(registryInput, config);
  const registryLookupStatus = getRegistryLookupStatus(registryInput, definition, config);
  const registryFingerprint = normalizeString(firstDefined(input.registryFingerprint, registryInput && registryInput.registryFingerprint));
  const registryId = normalizeString(firstDefined(input.registryId, registryInput && registryInput.registryId));
  const canonicalSignal = createCanonicalSignal(buildCanonicalSignalInput(input, config, nativeOutput, sourceOutputFingerprint));
  const alignmentArtifact = createSignalAlignment(buildAlignmentInput({
    ...input,
    registryId,
    registryFingerprint
  }, config, nativeOutput, canonicalSignal, definition, registryLookupStatus, sourceOutputFingerprint));
  const validationWarnings = registryValidation && !registryValidation.valid
    ? [validationError('registry_invalid', 'Registry validation failed.', 'registry')]
    : [];
  const core = {
    schemaVersion: SIGNAL_PRODUCER_ADAPTER_SCHEMA_VERSION,
    source: SIGNAL_PRODUCER_ADAPTER_SOURCE,
    adaptationId: normalizeString(firstDefined(input.adaptationId, `adaptation:${canonicalSignal.signalId}`)),
    createdAt: normalizeDate(firstDefined(input.createdAt, options.createdAt, canonicalSignal.createdAt)),
    producer: config.producer,
    signalName: config.signalName,
    signalVersion: config.signalVersion,
    sourceOutputFingerprint,
    registryLookupStatus,
    signalDefinition: definition || UNKNOWN_VALUE,
    canonicalSignal,
    alignment: alignmentArtifact,
    nativeOutput: clone(nativeOutput),
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
  const withValidation = {
    ...core,
    validation: buildStructuredValidation(core)
  };
  const withRegistryWarnings = validationWarnings.length
    ? {
        ...withValidation,
        validation: {
          ...withValidation.validation,
          warnings: [...withValidation.validation.warnings, ...validationWarnings],
          reasonCodes: unique([...withValidation.validation.reasonCodes, ...validationWarnings.map((warning) => warning.code)])
        }
      }
    : withValidation;

  return deepFreeze({
    ...withRegistryWarnings,
    adaptationFingerprint: buildAdaptationFingerprint(withRegistryWarnings)
  });
}

function validateAdaptedSignal(adapted = {}) {
  return buildStructuredValidation(adapted);
}

function sortAdaptedSignals(adaptedSignals = []) {
  return asArray(adaptedSignals)
    .map((item) => clone(item))
    .sort((left, right) => [
      left.signalName,
      left.signalVersion,
      left.producer,
      left.sourceOutputFingerprint
    ].map((field) => normalizeString(field)).join('|').localeCompare([
      right.signalName,
      right.signalVersion,
      right.producer,
      right.sourceOutputFingerprint
    ].map((field) => normalizeString(field)).join('|')));
}

function summarizeAdaptedSignals(adaptedSignals = []) {
  const items = asArray(adaptedSignals);
  const statusSummary = {};
  const registryLookupSummary = {};
  const authoritySummary = {};
  for (const item of items) {
    const alignmentStatus = normalizeString(item.alignment && item.alignment.alignmentStatus, UNKNOWN_VALUE);
    const lookupStatus = normalizeString(item.registryLookupStatus, UNKNOWN_VALUE);
    const authorityStatus = normalizeString(item.alignment && item.alignment.authorityAlignment && item.alignment.authorityAlignment.status, UNKNOWN_VALUE);
    statusSummary[alignmentStatus] = (statusSummary[alignmentStatus] || 0) + 1;
    registryLookupSummary[lookupStatus] = (registryLookupSummary[lookupStatus] || 0) + 1;
    authoritySummary[authorityStatus] = (authoritySummary[authorityStatus] || 0) + 1;
  }
  return deepFreeze({
    schemaVersion: SIGNAL_PRODUCER_ADAPTER_SCHEMA_VERSION,
    signalCount: items.length,
    validCount: items.filter((item) => item.validation && item.validation.valid).length,
    invalidCount: items.filter((item) => !item.validation || !item.validation.valid).length,
    statusSummary: Object.fromEntries(Object.entries(statusSummary).sort(([left], [right]) => left.localeCompare(right))),
    registryLookupSummary: Object.fromEntries(Object.entries(registryLookupSummary).sort(([left], [right]) => left.localeCompare(right))),
    authoritySummary: Object.fromEntries(Object.entries(authoritySummary).sort(([left], [right]) => left.localeCompare(right))),
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  });
}

function adaptSignalBatch(inputs = [], options = {}) {
  const adaptedSignals = sortAdaptedSignals(asArray(inputs).map((input) => adaptDiagnosticSignal({
    ...asObject(input),
    registry: firstDefined(input.registry, options.registry)
  }, options)));
  const summary = summarizeAdaptedSignals(adaptedSignals);
  const core = {
    schemaVersion: SIGNAL_PRODUCER_ADAPTER_SCHEMA_VERSION,
    source: `${SIGNAL_PRODUCER_ADAPTER_SOURCE}:batch`,
    adaptationBatchId: normalizeString(firstDefined(options.adaptationBatchId, 'signal-adaptation-batch')),
    createdAt: normalizeDate(firstDefined(options.createdAt, UNKNOWN_VALUE)),
    signalCount: adaptedSignals.length,
    adaptedSignals,
    summary,
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
  return deepFreeze({
    ...core,
    adaptationFingerprint: buildAdaptationFingerprint(core)
  });
}

module.exports = {
  SIGNAL_PRODUCER_ADAPTER_SCHEMA_VERSION,
  SIGNAL_PRODUCER_ADAPTER_SOURCE,
  SUPPORTED_DIAGNOSTIC_PRODUCERS,
  adaptDiagnosticSignal,
  adaptSignalBatch,
  buildAdaptationFingerprint,
  summarizeAdaptedSignals,
  validateAdaptedSignal
};
