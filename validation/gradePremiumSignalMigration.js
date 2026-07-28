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
  createAlignmentBatch,
  validateAlignmentBatch,
  summarizeAlignmentBatch,
  buildAlignmentBatchFingerprint
} = require('./signalAlignmentBatch');
const {
  validateSignalAlignmentRun,
  summarizeSignalAlignmentRun,
  buildSignalAlignmentRunFingerprint
} = require('./signalAlignmentEngine');
const {
  analyzeSignalConflicts,
  validateConflictAnalysis,
  buildConflictAnalysisFingerprint
} = require('./signalConflictAnalyzer');
const {
  createSignalAlignmentReport,
  validateSignalAlignmentReport,
  buildSignalAlignmentReportFingerprint
} = require('./signalAlignmentReport');
const {
  executeSignalMigrationLifecycle
} = require('./signalMigrationCore');

const GRADE_PREMIUM_MIGRATION_SCHEMA_VERSION = '1.0.0';
const GRADE_PREMIUM_MIGRATION_SOURCE = 'grade_premium_signal_migration';
const GRADE_PREMIUM_SIGNAL_NAME = 'grade.premium.engine';
const GRADE_PREMIUM_PRODUCER = 'gradePremiumEngine';
const GRADE_PREMIUM_PRODUCER_CATEGORY = 'production_engine';

const REQUIRED_GRADE_PREMIUM_MIGRATION_FIELDS = Object.freeze([
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

function mapRiskToUncertainty(riskLevel) {
  const risk = normalizeString(riskLevel);
  if (risk === 'low') return 'low';
  if (risk === 'moderate') return 'moderate';
  if (risk === 'high') return 'high';
  return UNKNOWN_VALUE;
}

function mapEvidenceQuality(nativeOutput = {}) {
  const sameGradeStatus = normalizeString(nativeOutput.dimensions && nativeOutput.dimensions.sameGradeSupport && nativeOutput.dimensions.sameGradeSupport.status);
  const qualityMap = {
    strong: 'strong',
    adequate: 'adequate',
    thin: 'limited',
    missing: 'insufficient',
    unknown: UNKNOWN_VALUE
  };
  return {
    level: qualityMap[sameGradeStatus] || UNKNOWN_VALUE,
    score: firstDefined(nativeOutput.dimensions && nativeOutput.dimensions.sameGradeSupport && nativeOutput.dimensions.sameGradeSupport.score, UNKNOWN_VALUE),
    basis: 'grade_premium_same_grade_support',
    details: clone(asObject(nativeOutput.soldSupport))
  };
}

function buildEvidenceBasis(nativeOutput = {}) {
  const soldSupport = asObject(nativeOutput.soldSupport);
  return {
    trueSoldCount: Number(firstDefined(soldSupport.sameGradeCount, 0)) +
      Number(firstDefined(soldSupport.lowerGradeCount, 0)) +
      Number(firstDefined(soldSupport.higherGradeCount, 0)) +
      Number(firstDefined(soldSupport.rawCount, 0)),
    activeListingCount: firstDefined(soldSupport.activeContextCount, UNKNOWN_VALUE),
    fallbackUsed: false,
    staleCount: UNKNOWN_VALUE,
    rejectedCount: UNKNOWN_VALUE,
    transactionIneligibleCount: UNKNOWN_VALUE,
    sourceConcentration: UNKNOWN_VALUE,
    details: clone(soldSupport)
  };
}

function buildNormalizedOutput(nativeOutput = {}) {
  return {
    status: normalizeString(nativeOutput.premiumJustification),
    riskLevel: normalizeString(nativeOutput.premiumRiskLevel),
    gradePremiumScore: firstDefined(nativeOutput.gradePremiumScore, UNKNOWN_VALUE),
    targetGrade: clone(firstDefined(nativeOutput.targetGrade, UNKNOWN_VALUE)),
    premiumMetrics: clone(firstDefined(nativeOutput.premiumMetrics, UNKNOWN_VALUE)),
    soldSupport: clone(firstDefined(nativeOutput.soldSupport, UNKNOWN_VALUE)),
    summary: normalizeString(nativeOutput.summary)
  };
}

function resolveDefinition(registry, nativeOutput = {}) {
  if (!registry) return null;
  return getSignalDefinition(
    registry,
    GRADE_PREMIUM_SIGNAL_NAME,
    normalizeString(firstDefined(nativeOutput.version, '1.0.0'))
  );
}

function getRegistryResolutionStatus(registry, definition, nativeOutput = {}) {
  if (!registry) return 'registry_missing';
  if (definition) return 'matched';
  const definitions = asArray(registry.definitions);
  if (definitions.some((item) => item.signalName === GRADE_PREMIUM_SIGNAL_NAME)) return 'version_mismatch';
  return 'definition_missing';
}

function buildCanonicalGradePremiumSignal(input = {}, definition = null) {
  const nativeOutput = clone(asObject(firstDefined(input.nativeOutput, input.gradePremiumOutput, input.output, {})));
  const sourceOutputFingerprint = buildSourceOutputFingerprint(nativeOutput, input.sourceOutputFingerprint);
  const producerVersion = normalizeString(firstDefined(nativeOutput.version, input.producerVersion, definition && definition.producerVersion, '1.0.0'));
  return createCanonicalSignal({
    signalId: normalizeString(firstDefined(input.signalId, `${GRADE_PREMIUM_SIGNAL_NAME}:${sourceOutputFingerprint}`)),
    signalName: GRADE_PREMIUM_SIGNAL_NAME,
    producer: {
      producerId: GRADE_PREMIUM_PRODUCER,
      name: GRADE_PREMIUM_PRODUCER,
      module: 'engines/gradePremiumEngine.js',
      functionName: 'supplied_native_output',
      version: producerVersion,
      category: GRADE_PREMIUM_PRODUCER_CATEGORY,
      metadata: {
        migrationSource: GRADE_PREMIUM_MIGRATION_SOURCE,
        executesNativeEngine: false
      }
    },
    producerVersion,
    producerCategory: GRADE_PREMIUM_PRODUCER_CATEGORY,
    createdAt: normalizeDate(firstDefined(input.createdAt, UNKNOWN_VALUE)),
    signalType: 'grading',
    decisionRole: 'diagnostic_only',
    authorityLevel: 'shadow_observation',
    confidence: {
      kind: UNKNOWN_VALUE,
      value: UNKNOWN_VALUE,
      scale: UNKNOWN_VALUE,
      basis: 'grade_premium_output_contains_score_not_confidence',
      calibrated: false
    },
    confidenceLevel: UNKNOWN_VALUE,
    uncertainty: {
      level: mapRiskToUncertainty(nativeOutput.premiumRiskLevel),
      range: UNKNOWN_VALUE,
      reasonCodes: asArray(nativeOutput.warnings)
    },
    evidenceBasis: buildEvidenceBasis(nativeOutput),
    evidenceQuality: mapEvidenceQuality(nativeOutput),
    evidenceReferences: asArray(input.evidenceReferences),
    supportingSignals: asArray(input.supportingSignals),
    conflictingSignals: asArray(input.conflictingSignals),
    warnings: asArray(nativeOutput.warnings),
    blockers: [],
    rawOutput: nativeOutput,
    normalizedOutput: buildNormalizedOutput(nativeOutput),
    sourceFingerprint: sourceOutputFingerprint,
    metadata: {
      nativeSource: normalizeString(nativeOutput.source),
      nativeVersion: normalizeString(nativeOutput.version),
      migrationSchemaVersion: GRADE_PREMIUM_MIGRATION_SCHEMA_VERSION,
      wrapperOnly: true
    }
  });
}

function buildAlignment(input = {}, canonicalSignal, definition, registryResolutionStatus) {
  return createSignalAlignment({
    alignmentId: normalizeString(firstDefined(input.alignmentId, `alignment:${canonicalSignal.signalId}`)),
    createdAt: normalizeDate(firstDefined(input.createdAt, canonicalSignal.createdAt)),
    producer: GRADE_PREMIUM_PRODUCER,
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
    schemaVersion: GRADE_PREMIUM_MIGRATION_SCHEMA_VERSION,
    source: `${GRADE_PREMIUM_MIGRATION_SOURCE}:adapted_signal`,
    adaptationId: normalizeString(firstDefined(input.adaptationId, `adaptation:${canonicalSignal.signalId}`)),
    createdAt: normalizeDate(firstDefined(input.createdAt, canonicalSignal.createdAt)),
    producer: GRADE_PREMIUM_PRODUCER,
    signalName: GRADE_PREMIUM_SIGNAL_NAME,
    signalVersion: normalizeString(firstDefined(canonicalSignal.producerVersion, '1.0.0')),
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
    alignmentRunId: normalizeString(firstDefined(input.alignmentRunId, input.runId, `grade-premium-alignment-run:${adaptedSignal.sourceOutputFingerprint}`)),
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
      migrationSource: GRADE_PREMIUM_MIGRATION_SOURCE,
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
  if (!preserved) {
    errors.push(validationIssue('native_output_parity_mismatch', 'Native Grade Premium output was not preserved exactly.', 'nativeOutput'));
  }
  return {
    parityStatus: preserved ? 'preserved' : 'changed',
    valid: preserved,
    errors,
    warnings: [],
    reasonCodes: unique(errors.map((error) => error.code)).sort()
  };
}

function summarizeGradePremiumMigration(migration = {}) {
  const alignment = asObject(migration.alignment);
  const report = asObject(migration.alignmentReport);
  return deepFreeze({
    schemaVersion: GRADE_PREMIUM_MIGRATION_SCHEMA_VERSION,
    migrationId: normalizeString(migration.migrationId),
    signalName: GRADE_PREMIUM_SIGNAL_NAME,
    producer: GRADE_PREMIUM_PRODUCER,
    registryResolutionStatus: normalizeString(migration.registryResolutionStatus),
    alignmentStatus: normalizeString(alignment.alignmentStatus),
    reportStatus: migration.reportStatus || (report.reportValidation && report.reportValidation.valid ? 'valid' : 'invalid'),
    parityStatus: normalizeString(migration.parityStatus),
    nativeSource: normalizeString(migration.nativeOutput && migration.nativeOutput.source),
    nativeVersion: normalizeString(migration.nativeOutput && migration.nativeOutput.version),
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  });
}

function buildGradePremiumMigrationFingerprint(migration = {}) {
  const projection = clone(migration);
  delete projection.migrationFingerprint;
  delete projection.gradePremiumMigrationFingerprint;
  return buildFingerprintFromProjection(projection);
}

function validateGradePremiumMigration(migration = {}) {
  const errors = [];
  const warnings = [];
  const authorityViolations = [];
  const fingerprintViolations = [];
  const missing = REQUIRED_GRADE_PREMIUM_MIGRATION_FIELDS.filter((field) => {
    const value = migration[field];
    return value === undefined || value === null || value === '';
  });

  for (const field of missing) errors.push(validationIssue('missing_required_field', `${field} is required.`, field));
  if (migration.schemaVersion !== GRADE_PREMIUM_MIGRATION_SCHEMA_VERSION) errors.push(validationIssue('invalid_schema_version', 'schemaVersion must match Grade Premium Signal Migration schema.', 'schemaVersion'));
  if (migration.source !== GRADE_PREMIUM_MIGRATION_SOURCE) errors.push(validationIssue('invalid_source', 'source must be grade_premium_signal_migration.', 'source'));

  for (const field of ['productionImpact', 'decisionImpact', 'executionAuthority']) {
    if (migration[field] !== 'none') {
      errors.push(validationIssue('authority_boundary_violation', `${field} must remain none.`, field));
      authorityViolations.push(field);
    }
  }

  const registryValidation = migration.registry ? validateSignalRegistry(migration.registry) : { valid: true, errors: [], warnings: [], reasonCodes: [], authorityViolations: [] };
  const signalValidation = validateCanonicalSignal(migration.canonicalSignal);
  const alignmentValidation = validateSignalAlignment(migration.alignment);
  const batchValidation = validateAlignmentBatch(migration.alignmentBatch);
  const runValidation = validateSignalAlignmentRun(migration.alignmentRun);
  const conflictValidation = validateConflictAnalysis(migration.conflictAnalysis);
  const reportValidation = validateSignalAlignmentReport(migration.alignmentReport);
  const parity = verifyParity(migration.nativeOutput, migration);

  for (const [prefix, validation] of [
    ['registry', registryValidation],
    ['canonicalSignal', signalValidation],
    ['alignment', alignmentValidation],
    ['alignmentBatch', batchValidation],
    ['alignmentRun', runValidation],
    ['conflictAnalysis', conflictValidation],
    ['alignmentReport', reportValidation],
    ['parity', parity]
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
  if (migration.migrationFingerprint && buildGradePremiumMigrationFingerprint(migration) !== migration.migrationFingerprint) {
    errors.push(validationIssue('migration_fingerprint_mismatch', 'migrationFingerprint does not match migration contents.', 'migrationFingerprint'));
    fingerprintViolations.push('migrationFingerprint');
  }

  const reasonCodes = unique([...errors.map((error) => error.code), ...warnings.map((warning) => warning.code)]);
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes,
    registryResolutionStatus: normalizeString(migration.registryResolutionStatus),
    alignmentStatus: normalizeString(migration.alignment && migration.alignment.alignmentStatus),
    reportStatus: reportValidation.valid ? 'valid' : 'invalid',
    authorityViolations: unique(authorityViolations).sort(),
    fingerprintViolations: unique(fingerprintViolations).sort(),
    parityStatus: parity.parityStatus
  };
}

function migrateGradePremiumSignal(input = {}, options = {}) {
  return executeSignalMigrationLifecycle(input, options, {
    schemaVersion: GRADE_PREMIUM_MIGRATION_SCHEMA_VERSION,
    migrationSource: GRADE_PREMIUM_MIGRATION_SOURCE,
    nativeOutputAliases: ['nativeOutput', 'gradePremiumOutput', 'output'],
    defaultMigrationIdPrefix: 'grade-premium-signal-migration',
    defaultAlignmentBatchId: 'grade-premium-signal-alignment-batch',
    defaultConflictAnalysisId: 'grade-premium-signal-conflict-analysis',
    defaultReportId: 'grade-premium-signal-alignment-report',
    resolveDefinition,
    getRegistryResolutionStatus,
    buildCanonicalSignal: buildCanonicalGradePremiumSignal,
    buildAlignment,
    buildAdaptedSignal,
    buildAlignmentRun,
    verifyParity,
    summarizeMigration: summarizeGradePremiumMigration,
    validateMigration: validateGradePremiumMigration,
    buildMigrationFingerprint: buildGradePremiumMigrationFingerprint
  });
}

module.exports = {
  GRADE_PREMIUM_MIGRATION_SCHEMA_VERSION,
  GRADE_PREMIUM_MIGRATION_SOURCE,
  GRADE_PREMIUM_PRODUCER,
  GRADE_PREMIUM_SIGNAL_NAME,
  REQUIRED_GRADE_PREMIUM_MIGRATION_FIELDS,
  buildGradePremiumMigrationFingerprint,
  migrateGradePremiumSignal,
  summarizeGradePremiumMigration,
  validateGradePremiumMigration
};
