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

const DEAL_GATE_MIGRATION_SCHEMA_VERSION = '1.0.0';
const DEAL_GATE_MIGRATION_SOURCE = 'deal_gate_signal_migration';
const DEAL_GATE_SIGNAL_NAME = 'decision.deal_gate.diagnostics';
const DEAL_GATE_PRODUCER = 'dealGate';
const DEAL_GATE_PRODUCER_CATEGORY = 'production_engine';
const DEFAULT_DEAL_GATE_SIGNAL_VERSION = '1.0.0';

const REQUIRED_DEAL_GATE_MIGRATION_FIELDS = Object.freeze([
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

function toNumber(value, fallback = UNKNOWN_VALUE) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function buildSourceOutputFingerprint(nativeOutput = {}, explicitFingerprint) {
  if (known(explicitFingerprint)) return normalizeString(explicitFingerprint);
  if (known(nativeOutput.stableFingerprint)) return normalizeString(nativeOutput.stableFingerprint);
  if (known(nativeOutput.signalFingerprint)) return normalizeString(nativeOutput.signalFingerprint);
  return buildFingerprintFromProjection(nativeOutput);
}

function signalVersion(nativeOutput = {}, explicitVersion) {
  return normalizeString(firstDefined(explicitVersion, nativeOutput.schemaVersion, nativeOutput.version, DEFAULT_DEAL_GATE_SIGNAL_VERSION));
}

function gateSummary(nativeOutput = {}) {
  return asObject(firstDefined(nativeOutput.gate, nativeOutput.gateInputs, nativeOutput.thresholdSummary, {}));
}

function dealGateBreakdown(nativeOutput = {}) {
  return asObject(firstDefined(nativeOutput.dealGateBreakdown, nativeOutput.breakdown, nativeOutput.ruleBreakdown, {}));
}

function confidenceLevel(nativeOutput = {}) {
  const confidence = Number(firstDefined(gateSummary(nativeOutput).confidenceScore, nativeOutput.marketConfidence, nativeOutput.confidence));
  if (!Number.isFinite(confidence)) return UNKNOWN_VALUE;
  if (confidence >= 80) return 'high';
  if (confidence >= 65) return 'moderate';
  if (confidence >= 45) return 'low';
  return 'insufficient';
}

function uncertaintyLevel(nativeOutput = {}) {
  if (nativeOutput.passed === true && asArray(nativeOutput.reasons).length === 0) return 'low';
  if (nativeOutput.passed === false) return 'high';
  return UNKNOWN_VALUE;
}

function evidenceQualityLevel(nativeOutput = {}) {
  const soldCount = Number(firstDefined(gateSummary(nativeOutput).soldCompCount, gateSummary(nativeOutput).trueSoldCompCount, 0));
  if (soldCount >= 5) return 'strong';
  if (soldCount >= 3) return 'adequate';
  if (soldCount >= 1) return 'limited';
  return 'insufficient';
}

function buildEvidenceBasis(nativeOutput = {}) {
  const gate = gateSummary(nativeOutput);
  const breakdown = dealGateBreakdown(nativeOutput);
  return {
    trueSoldCount: toNumber(firstDefined(gate.soldCompCount, gate.trueSoldCompCount), UNKNOWN_VALUE),
    activeListingCount: UNKNOWN_VALUE,
    fallbackUsed: false,
    staleCount: UNKNOWN_VALUE,
    rejectedCount: UNKNOWN_VALUE,
    transactionIneligibleCount: UNKNOWN_VALUE,
    sourceConcentration: UNKNOWN_VALUE,
    details: {
      confidenceScore: firstDefined(gate.confidenceScore, UNKNOWN_VALUE),
      score: firstDefined(gate.score, UNKNOWN_VALUE),
      estimatedProfit: firstDefined(gate.estimatedProfit, UNKNOWN_VALUE),
      roi: firstDefined(gate.roi, UNKNOWN_VALUE),
      failedRuleCount: asArray(firstDefined(breakdown.failedRules, nativeOutput.failedRules)).length,
      passedRuleCount: asArray(firstDefined(breakdown.passedRules, nativeOutput.passedRules)).length,
      reasonCount: asArray(nativeOutput.reasons).length,
      positiveCount: asArray(nativeOutput.positives).length
    }
  };
}

function buildNormalizedOutput(nativeOutput = {}) {
  const gate = gateSummary(nativeOutput);
  const breakdown = dealGateBreakdown(nativeOutput);
  return {
    status: nativeOutput.passed === true ? 'passed' : nativeOutput.passed === false ? 'rejected' : UNKNOWN_VALUE,
    passed: firstDefined(nativeOutput.passed, UNKNOWN_VALUE),
    buyNowAllowed: firstDefined(nativeOutput.buyNowAllowed, UNKNOWN_VALUE),
    decision: normalizeString(firstDefined(nativeOutput.decision, nativeOutput.recommendation)),
    recommendation: normalizeString(firstDefined(nativeOutput.recommendation, nativeOutput.decision)),
    score: firstDefined(gate.score, UNKNOWN_VALUE),
    estimatedProfit: firstDefined(gate.estimatedProfit, UNKNOWN_VALUE),
    roi: firstDefined(gate.roi, UNKNOWN_VALUE),
    soldCompCount: firstDefined(gate.soldCompCount, UNKNOWN_VALUE),
    confidenceScore: firstDefined(gate.confidenceScore, UNKNOWN_VALUE),
    reasons: asArray(nativeOutput.reasons).map(String),
    positives: asArray(nativeOutput.positives).map(String),
    failedRules: asArray(firstDefined(breakdown.failedRules, nativeOutput.failedRules)).map(String),
    passedRules: asArray(firstDefined(breakdown.passedRules, nativeOutput.passedRules)).map(String)
  };
}

function createDealGateAdapter(input = {}) {
  return createSignalMigrationAdapter({
    adapterId: firstDefined(input.adapterId, 'deal-gate-signal-adapter'),
    adapterVersion: firstDefined(input.adapterVersion, '1.0.0'),
    engineName: DEAL_GATE_PRODUCER,
    supportedEngineVersions: [DEFAULT_DEAL_GATE_SIGNAL_VERSION],
    signalName: DEAL_GATE_SIGNAL_NAME,
    signalVersion: DEFAULT_DEAL_GATE_SIGNAL_VERSION,
    producer: DEAL_GATE_PRODUCER,
    producerVersion: DEFAULT_DEAL_GATE_SIGNAL_VERSION,
    producerCategory: DEAL_GATE_PRODUCER_CATEGORY,
    signalType: 'decision',
    decisionRole: 'diagnostic_only',
    authorityLevel: 'shadow_observation',
    evidenceRole: 'diagnostic_context',
    nativeOutputAliases: ['nativeOutput', 'dealGateOutput', 'dealGateDiagnosticOutput', 'output'],
    nativeVersionAliases: ['schemaVersion', 'version'],
    requiredNativeFields: ['passed', 'decision'],
    optionalNativeFields: ['buyNowAllowed', 'recommendation', 'reasons', 'positives', 'gate', 'dealGateBreakdown'],
    evidenceMapping: {
      kind: 'declarative',
      sourceFields: ['gate.soldCompCount', 'gate.confidenceScore', 'dealGateBreakdown'],
      targetFields: ['canonicalSignal.evidenceBasis', 'canonicalSignal.evidenceQuality'],
      semantics: 'deal_gate_evidence_and_threshold_context_only'
    },
    confidenceMapping: {
      kind: 'declarative',
      sourceFields: ['gate.confidenceScore'],
      targetFields: ['canonicalSignal.confidence', 'canonicalSignal.confidenceLevel'],
      semantics: 'deal_gate_confidence_score_preserved_as_diagnostic_context'
    },
    uncertaintyMapping: {
      kind: 'declarative',
      sourceFields: ['passed', 'reasons'],
      targetFields: ['canonicalSignal.uncertainty'],
      semantics: 'failed_gate_reasons_indicate_diagnostic_uncertainty'
    },
    statusMapping: {
      kind: 'declarative',
      sourceFields: ['passed', 'decision', 'buyNowAllowed'],
      targetFields: ['canonicalSignal.normalizedOutput'],
      semantics: 'native_deal_gate_decision_preserved_as_advisory_signal'
    },
    metadataMapping: {
      kind: 'declarative',
      sourceFields: ['source', 'schemaVersion'],
      targetFields: ['canonicalSignal.metadata.nativeSource', 'canonicalSignal.metadata.nativeVersion'],
      semantics: 'native_metadata_preserved'
    },
    normalizedOutputMapping: {
      kind: 'approved_handler',
      sourceFields: ['passed', 'decision', 'buyNowAllowed', 'gate', 'dealGateBreakdown'],
      targetFields: ['canonicalSignal.normalizedOutput'],
      handlerRef: 'validation/dealGateSignalMigration#buildNormalizedOutput',
      semantics: 'deal_gate_summary_projection'
    },
    semanticParityRules: [
      {
        ruleId: 'deal_gate_raw_output_exact',
        kind: 'declarative',
        nativeFields: ['*'],
        shadowFields: ['canonicalSignal.rawOutput'],
        comparison: 'raw_output_must_match_exactly'
      },
      {
        ruleId: 'deal_gate_authority_neutralized',
        kind: 'declarative',
        nativeFields: ['passed', 'decision', 'buyNowAllowed'],
        shadowFields: ['productionImpact', 'decisionImpact', 'executionAuthority'],
        comparison: 'native_decision_language_does_not_grant_signal_authority'
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
    compatibilityNotes: ['wrapper-only migration preserves native Deal Gate output without changing Deal Gate runtime authority'],
    createdAt: firstDefined(input.createdAt, UNKNOWN_VALUE)
  });
}

function resolveDefinition(registry, nativeOutput = {}) {
  if (!registry) return null;
  return getSignalDefinition(registry, DEAL_GATE_SIGNAL_NAME, signalVersion(nativeOutput));
}

function getRegistryResolutionStatus(registry, definition) {
  if (!registry) return 'registry_missing';
  if (definition) return 'matched';
  if (asArray(registry.definitions).some((item) => item.signalName === DEAL_GATE_SIGNAL_NAME)) return 'version_mismatch';
  return 'definition_missing';
}

function buildCanonicalDealGateSignal(input = {}, definition = null) {
  const nativeOutput = clone(asObject(firstDefined(input.nativeOutput, input.dealGateOutput, input.dealGateDiagnosticOutput, input.output, {})));
  const sourceOutputFingerprint = buildSourceOutputFingerprint(nativeOutput, input.sourceOutputFingerprint);
  const producerVersion = signalVersion(nativeOutput, firstDefined(input.producerVersion, definition && definition.producerVersion));
  const gate = gateSummary(nativeOutput);
  return createCanonicalSignal({
    signalId: normalizeString(firstDefined(input.signalId, `${DEAL_GATE_SIGNAL_NAME}:${sourceOutputFingerprint}`)),
    signalName: DEAL_GATE_SIGNAL_NAME,
    producer: {
      producerId: DEAL_GATE_PRODUCER,
      name: DEAL_GATE_PRODUCER,
      module: 'server.js',
      functionName: 'supplied_native_output',
      version: producerVersion,
      category: DEAL_GATE_PRODUCER_CATEGORY,
      metadata: {
        migrationSource: DEAL_GATE_MIGRATION_SOURCE,
        executesNativeEngine: false
      }
    },
    producerVersion,
    producerCategory: DEAL_GATE_PRODUCER_CATEGORY,
    createdAt: normalizeDate(firstDefined(input.createdAt, UNKNOWN_VALUE)),
    signalType: 'decision',
    decisionRole: 'diagnostic_only',
    authorityLevel: 'shadow_observation',
    confidence: {
      kind: 'reported',
      value: firstDefined(gate.confidenceScore, UNKNOWN_VALUE),
      scale: '0_100',
      basis: 'deal_gate_confidence_score',
      calibrated: false
    },
    confidenceLevel: confidenceLevel(nativeOutput),
    uncertainty: {
      level: uncertaintyLevel(nativeOutput),
      range: UNKNOWN_VALUE,
      reasonCodes: unique([...asArray(nativeOutput.reasons), ...asArray(nativeOutput.warnings)]).sort()
    },
    evidenceBasis: buildEvidenceBasis(nativeOutput),
    evidenceQuality: {
      level: evidenceQualityLevel(nativeOutput),
      score: firstDefined(gate.confidenceScore, UNKNOWN_VALUE),
      basis: 'deal_gate_sold_comp_and_threshold_context',
      details: clone(buildNormalizedOutput(nativeOutput))
    },
    evidenceReferences: asArray(input.evidenceReferences),
    supportingSignals: asArray(input.supportingSignals),
    conflictingSignals: asArray(input.conflictingSignals),
    warnings: asArray(nativeOutput.warnings),
    blockers: asArray(nativeOutput.reasons),
    rawOutput: nativeOutput,
    normalizedOutput: buildNormalizedOutput(nativeOutput),
    sourceFingerprint: sourceOutputFingerprint,
    metadata: {
      nativeSource: normalizeString(nativeOutput.source),
      nativeVersion: producerVersion,
      migrationSchemaVersion: DEAL_GATE_MIGRATION_SCHEMA_VERSION,
      wrapperOnly: true,
      productionDealGateAuthorityPreservedExternally: true
    }
  });
}

function buildAlignment(input = {}, canonicalSignal, definition, registryResolutionStatus) {
  return createSignalAlignment({
    alignmentId: normalizeString(firstDefined(input.alignmentId, `alignment:${canonicalSignal.signalId}`)),
    createdAt: normalizeDate(firstDefined(input.createdAt, canonicalSignal.createdAt)),
    producer: DEAL_GATE_PRODUCER,
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
    schemaVersion: DEAL_GATE_MIGRATION_SCHEMA_VERSION,
    source: `${DEAL_GATE_MIGRATION_SOURCE}:adapted_signal`,
    adaptationId: normalizeString(firstDefined(input.adaptationId, `adaptation:${canonicalSignal.signalId}`)),
    createdAt: normalizeDate(firstDefined(input.createdAt, canonicalSignal.createdAt)),
    producer: DEAL_GATE_PRODUCER,
    signalName: DEAL_GATE_SIGNAL_NAME,
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
    alignmentRunId: normalizeString(firstDefined(input.alignmentRunId, input.runId, `deal-gate-alignment-run:${adaptedSignal.sourceOutputFingerprint}`)),
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
      migrationSource: DEAL_GATE_MIGRATION_SOURCE,
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
  if (!preserved) errors.push(validationIssue('native_output_parity_mismatch', 'Native Deal Gate output was not preserved exactly.', 'nativeOutput'));
  return {
    parityStatus: preserved ? 'preserved' : 'changed',
    valid: preserved,
    errors,
    warnings: [],
    reasonCodes: unique(errors.map((error) => error.code)).sort()
  };
}

function summarizeDealGateMigration(migration = {}) {
  return deepFreeze({
    ...summarizeSignalMigrationLifecycle(migration),
    schemaVersion: DEAL_GATE_MIGRATION_SCHEMA_VERSION,
    migrationId: normalizeString(migration.migrationId),
    signalName: DEAL_GATE_SIGNAL_NAME,
    producer: DEAL_GATE_PRODUCER,
    nativeSource: normalizeString(migration.nativeOutput && migration.nativeOutput.source),
    nativeVersion: signalVersion(asObject(migration.nativeOutput)),
    gateStatus: normalizeString(migration.canonicalSignal && migration.canonicalSignal.normalizedOutput && migration.canonicalSignal.normalizedOutput.status),
    decision: normalizeString(migration.nativeOutput && firstDefined(migration.nativeOutput.decision, migration.nativeOutput.recommendation))
  });
}

function buildDealGateMigrationFingerprint(migration = {}) {
  const projection = clone(migration);
  delete projection.migrationFingerprint;
  delete projection.dealGateMigrationFingerprint;
  return buildFingerprintFromProjection(projection);
}

function buildCoreArtifact(migration = {}) {
  return createSignalMigrationArtifact({
    migrationId: migration.migrationId,
    createdAt: migration.createdAt,
    engineName: DEAL_GATE_PRODUCER,
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
      source: DEAL_GATE_MIGRATION_SOURCE
    }
  });
}

function validateDealGateMigration(migration = {}) {
  const errors = [];
  const warnings = [];
  const authorityViolations = [];
  const fingerprintViolations = [];
  const missing = REQUIRED_DEAL_GATE_MIGRATION_FIELDS.filter((field) => {
    const value = migration[field];
    return value === undefined || value === null || value === '';
  });

  for (const field of missing) errors.push(validationIssue('missing_required_field', `${field} is required.`, field));
  if (migration.schemaVersion !== DEAL_GATE_MIGRATION_SCHEMA_VERSION) errors.push(validationIssue('invalid_schema_version', 'schemaVersion must match Deal Gate Signal Migration schema.', 'schemaVersion'));
  if (migration.source !== DEAL_GATE_MIGRATION_SOURCE) errors.push(validationIssue('invalid_source', 'source must be deal_gate_signal_migration.', 'source'));

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
  if (migration.migrationFingerprint && buildDealGateMigrationFingerprint(migration) !== migration.migrationFingerprint) {
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

function migrateDealGateSignal(input = {}, options = {}) {
  const adapter = createDealGateAdapter({ createdAt: firstDefined(input.createdAt, options.createdAt) });
  const migration = executeSignalMigrationLifecycle(input, options, {
    schemaVersion: DEAL_GATE_MIGRATION_SCHEMA_VERSION,
    migrationSource: DEAL_GATE_MIGRATION_SOURCE,
    nativeOutputAliases: ['nativeOutput', 'dealGateOutput', 'dealGateDiagnosticOutput', 'output'],
    defaultMigrationIdPrefix: 'deal-gate-signal-migration',
    defaultAlignmentBatchId: 'deal-gate-signal-alignment-batch',
    defaultConflictAnalysisId: 'deal-gate-signal-conflict-analysis',
    defaultReportId: 'deal-gate-signal-alignment-report',
    resolveDefinition,
    getRegistryResolutionStatus,
    buildCanonicalSignal: buildCanonicalDealGateSignal,
    buildAlignment,
    buildAdaptedSignal,
    buildAlignmentRun,
    verifyParity,
    summarizeMigration: summarizeDealGateMigration,
    validateMigration: (candidate) => validateDealGateMigration({ ...candidate, adapter, coreArtifact: buildCoreArtifact(candidate) }),
    buildMigrationFingerprint: buildDealGateMigrationFingerprint
  });
  const withCore = {
    ...migration,
    adapter,
    coreArtifact: buildCoreArtifact(migration)
  };
  const withSummary = {
    ...withCore,
    summary: summarizeDealGateMigration(withCore)
  };
  return deepFreeze({
    ...withSummary,
    validation: validateDealGateMigration(withSummary),
    migrationFingerprint: buildDealGateMigrationFingerprint(withSummary)
  });
}

module.exports = {
  DEAL_GATE_MIGRATION_SCHEMA_VERSION,
  DEAL_GATE_MIGRATION_SOURCE,
  DEAL_GATE_PRODUCER,
  DEAL_GATE_SIGNAL_NAME,
  DEFAULT_DEAL_GATE_SIGNAL_VERSION,
  REQUIRED_DEAL_GATE_MIGRATION_FIELDS,
  buildDealGateMigrationFingerprint,
  createDealGateAdapter,
  migrateDealGateSignal,
  summarizeDealGateMigration,
  validateDealGateMigration
};
