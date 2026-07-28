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

const POPULATION_MIGRATION_SCHEMA_VERSION = '1.0.0';
const POPULATION_MIGRATION_SOURCE = 'population_signal_migration';
const POPULATION_SIGNAL_NAME = 'population.intelligence.engine';
const POPULATION_PRODUCER = 'populationEngine';
const POPULATION_PRODUCER_CATEGORY = 'production_engine';
const DEFAULT_POPULATION_SIGNAL_VERSION = 'population_engine_v2';

const REQUIRED_POPULATION_MIGRATION_FIELDS = Object.freeze([
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

function signalVersion(nativeOutput = {}, explicitVersion) {
  return normalizeString(firstDefined(explicitVersion, nativeOutput.populationVersion, nativeOutput.version, DEFAULT_POPULATION_SIGNAL_VERSION));
}

function confidenceLevel(value) {
  const confidence = Number(value);
  if (!Number.isFinite(confidence)) return UNKNOWN_VALUE;
  if (confidence >= 75) return 'high';
  if (confidence >= 50) return 'moderate';
  if (confidence >= 25) return 'low';
  return 'insufficient';
}

function uncertaintyLevel(value) {
  const confidence = Number(value);
  if (!Number.isFinite(confidence)) return UNKNOWN_VALUE;
  if (confidence >= 75) return 'low';
  if (confidence >= 50) return 'moderate';
  if (confidence >= 25) return 'high';
  return 'extreme';
}

function evidenceQualityLevel(value) {
  const quality = normalizeString(value);
  if (quality === 'excellent') return 'strong';
  if (quality === 'good') return 'adequate';
  if (quality === 'fair') return 'limited';
  if (quality === 'weak') return 'weak';
  if (quality === 'unavailable') return 'insufficient';
  return UNKNOWN_VALUE;
}

function buildEvidenceBasis(nativeOutput = {}) {
  return {
    trueSoldCount: 0,
    activeListingCount: 0,
    fallbackUsed: false,
    staleCount: UNKNOWN_VALUE,
    rejectedCount: UNKNOWN_VALUE,
    transactionIneligibleCount: UNKNOWN_VALUE,
    sourceConcentration: UNKNOWN_VALUE,
    details: {
      populationCount: firstDefined(nativeOutput.populationCount, UNKNOWN_VALUE),
      higherGradeCount: firstDefined(nativeOutput.higherGradeCount, UNKNOWN_VALUE),
      totalGradedCount: firstDefined(nativeOutput.totalGradedCount, UNKNOWN_VALUE),
      gemRate: firstDefined(nativeOutput.gemRate, UNKNOWN_VALUE),
      populationSource: normalizeString(nativeOutput.populationSource),
      lastPopulationUpdate: normalizeString(nativeOutput.lastPopulationUpdate),
      evidenceQuality: normalizeString(nativeOutput.evidenceQuality),
      populationUnavailable: nativeOutput.populationUnavailable === true
    }
  };
}

function buildNormalizedOutput(nativeOutput = {}) {
  return {
    status: normalizeString(nativeOutput.scarcityLevel),
    scarcityScore: firstDefined(nativeOutput.scarcityScore, UNKNOWN_VALUE),
    confidence: firstDefined(nativeOutput.confidence, UNKNOWN_VALUE),
    gradingCompany: normalizeString(nativeOutput.gradingCompany),
    grade: normalizeString(nativeOutput.grade),
    populationCount: firstDefined(nativeOutput.populationCount, UNKNOWN_VALUE),
    higherGradeCount: firstDefined(nativeOutput.higherGradeCount, UNKNOWN_VALUE),
    totalGradedCount: firstDefined(nativeOutput.totalGradedCount, UNKNOWN_VALUE),
    gemRate: firstDefined(nativeOutput.gemRate, UNKNOWN_VALUE),
    populationSource: normalizeString(nativeOutput.populationSource),
    lastPopulationUpdate: normalizeString(nativeOutput.lastPopulationUpdate),
    evidenceQuality: normalizeString(nativeOutput.evidenceQuality),
    populationUnavailable: nativeOutput.populationUnavailable === true,
    summary: normalizeString(nativeOutput.summary)
  };
}

function resolveDefinition(registry, nativeOutput = {}) {
  if (!registry) return null;
  return getSignalDefinition(registry, POPULATION_SIGNAL_NAME, signalVersion(nativeOutput));
}

function getRegistryResolutionStatus(registry, definition) {
  if (!registry) return 'registry_missing';
  if (definition) return 'matched';
  const definitions = asArray(registry.definitions);
  if (definitions.some((item) => item.signalName === POPULATION_SIGNAL_NAME)) return 'version_mismatch';
  return 'definition_missing';
}

function buildCanonicalPopulationSignal(input = {}, definition = null) {
  const nativeOutput = clone(asObject(firstDefined(input.nativeOutput, input.populationOutput, input.output, {})));
  const sourceOutputFingerprint = buildSourceOutputFingerprint(nativeOutput, input.sourceOutputFingerprint);
  const producerVersion = signalVersion(nativeOutput, firstDefined(input.producerVersion, definition && definition.producerVersion));
  const warnings = asArray(nativeOutput.warnings);

  return createCanonicalSignal({
    signalId: normalizeString(firstDefined(input.signalId, `${POPULATION_SIGNAL_NAME}:${sourceOutputFingerprint}`)),
    signalName: POPULATION_SIGNAL_NAME,
    producer: {
      producerId: POPULATION_PRODUCER,
      name: POPULATION_PRODUCER,
      module: 'engines/populationEngine.js',
      functionName: 'supplied_native_output',
      version: producerVersion,
      category: POPULATION_PRODUCER_CATEGORY,
      metadata: {
        migrationSource: POPULATION_MIGRATION_SOURCE,
        executesNativeEngine: false
      }
    },
    producerVersion,
    producerCategory: POPULATION_PRODUCER_CATEGORY,
    createdAt: normalizeDate(firstDefined(input.createdAt, UNKNOWN_VALUE)),
    signalType: 'context',
    decisionRole: 'diagnostic_only',
    authorityLevel: 'shadow_observation',
    confidence: {
      kind: 'reported',
      value: firstDefined(nativeOutput.confidence, UNKNOWN_VALUE),
      scale: known(nativeOutput.confidence) ? '0_100' : UNKNOWN_VALUE,
      basis: 'population_scarcity_confidence',
      calibrated: false
    },
    confidenceLevel: confidenceLevel(nativeOutput.confidence),
    uncertainty: {
      level: uncertaintyLevel(nativeOutput.confidence),
      range: UNKNOWN_VALUE,
      reasonCodes: warnings
    },
    evidenceBasis: buildEvidenceBasis(nativeOutput),
    evidenceQuality: {
      level: evidenceQualityLevel(nativeOutput.evidenceQuality),
      score: firstDefined(nativeOutput.componentScores && nativeOutput.componentScores.evidenceScore, UNKNOWN_VALUE),
      basis: 'population_engine_evidence_quality',
      details: {
        populationSource: normalizeString(nativeOutput.populationSource),
        lastPopulationUpdate: normalizeString(nativeOutput.lastPopulationUpdate)
      }
    },
    evidenceReferences: asArray(input.evidenceReferences),
    supportingSignals: asArray(input.supportingSignals),
    conflictingSignals: asArray(input.conflictingSignals),
    warnings,
    blockers: [],
    rawOutput: nativeOutput,
    normalizedOutput: buildNormalizedOutput(nativeOutput),
    sourceFingerprint: sourceOutputFingerprint,
    metadata: {
      nativeSource: normalizeString(nativeOutput.source),
      nativeVersion: producerVersion,
      migrationSchemaVersion: POPULATION_MIGRATION_SCHEMA_VERSION,
      wrapperOnly: true
    }
  });
}

function buildAlignment(input = {}, canonicalSignal, definition, registryResolutionStatus) {
  return createSignalAlignment({
    alignmentId: normalizeString(firstDefined(input.alignmentId, `alignment:${canonicalSignal.signalId}`)),
    createdAt: normalizeDate(firstDefined(input.createdAt, canonicalSignal.createdAt)),
    producer: POPULATION_PRODUCER,
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
    schemaVersion: POPULATION_MIGRATION_SCHEMA_VERSION,
    source: `${POPULATION_MIGRATION_SOURCE}:adapted_signal`,
    adaptationId: normalizeString(firstDefined(input.adaptationId, `adaptation:${canonicalSignal.signalId}`)),
    createdAt: normalizeDate(firstDefined(input.createdAt, canonicalSignal.createdAt)),
    producer: POPULATION_PRODUCER,
    signalName: POPULATION_SIGNAL_NAME,
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
    alignmentRunId: normalizeString(firstDefined(input.alignmentRunId, input.runId, `population-alignment-run:${adaptedSignal.sourceOutputFingerprint}`)),
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
      migrationSource: POPULATION_MIGRATION_SOURCE,
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
    errors.push(validationIssue('native_output_parity_mismatch', 'Native Population output was not preserved exactly.', 'nativeOutput'));
  }
  return {
    parityStatus: preserved ? 'preserved' : 'changed',
    valid: preserved,
    errors,
    warnings: [],
    reasonCodes: unique(errors.map((error) => error.code)).sort()
  };
}

function summarizePopulationMigration(migration = {}) {
  const alignment = asObject(migration.alignment);
  const report = asObject(migration.alignmentReport);
  return deepFreeze({
    schemaVersion: POPULATION_MIGRATION_SCHEMA_VERSION,
    migrationId: normalizeString(migration.migrationId),
    signalName: POPULATION_SIGNAL_NAME,
    producer: POPULATION_PRODUCER,
    registryResolutionStatus: normalizeString(migration.registryResolutionStatus),
    alignmentStatus: normalizeString(alignment.alignmentStatus),
    reportStatus: migration.reportStatus || (report.reportValidation && report.reportValidation.valid ? 'valid' : 'invalid'),
    parityStatus: normalizeString(migration.parityStatus),
    nativeSource: normalizeString(migration.nativeOutput && migration.nativeOutput.source),
    nativeVersion: signalVersion(asObject(migration.nativeOutput)),
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  });
}

function buildPopulationMigrationFingerprint(migration = {}) {
  const projection = clone(migration);
  delete projection.migrationFingerprint;
  delete projection.populationMigrationFingerprint;
  return buildFingerprintFromProjection(projection);
}

function validatePopulationMigration(migration = {}) {
  const errors = [];
  const warnings = [];
  const authorityViolations = [];
  const fingerprintViolations = [];
  const missing = REQUIRED_POPULATION_MIGRATION_FIELDS.filter((field) => {
    const value = migration[field];
    return value === undefined || value === null || value === '';
  });

  for (const field of missing) errors.push(validationIssue('missing_required_field', `${field} is required.`, field));
  if (migration.schemaVersion !== POPULATION_MIGRATION_SCHEMA_VERSION) errors.push(validationIssue('invalid_schema_version', 'schemaVersion must match Population Signal Migration schema.', 'schemaVersion'));
  if (migration.source !== POPULATION_MIGRATION_SOURCE) errors.push(validationIssue('invalid_source', 'source must be population_signal_migration.', 'source'));

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
  if (migration.migrationFingerprint && buildPopulationMigrationFingerprint(migration) !== migration.migrationFingerprint) {
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
    reportStatus: reportValidation.valid ? 'valid' : 'invalid',
    parityStatus: parity.parityStatus,
    authorityViolations: unique(authorityViolations).sort(),
    fingerprintViolations: unique(fingerprintViolations).sort()
  };
}

function migratePopulationSignal(input = {}, options = {}) {
  return executeSignalMigrationLifecycle(input, options, {
    schemaVersion: POPULATION_MIGRATION_SCHEMA_VERSION,
    migrationSource: POPULATION_MIGRATION_SOURCE,
    nativeOutputAliases: ['nativeOutput', 'populationOutput', 'output'],
    defaultMigrationIdPrefix: 'population-signal-migration',
    defaultAlignmentBatchId: 'population-signal-alignment-batch',
    defaultConflictAnalysisId: 'population-signal-conflict-analysis',
    defaultReportId: 'population-signal-alignment-report',
    resolveDefinition,
    getRegistryResolutionStatus,
    buildCanonicalSignal: buildCanonicalPopulationSignal,
    buildAlignment,
    buildAdaptedSignal,
    buildAlignmentRun,
    verifyParity,
    summarizeMigration: summarizePopulationMigration,
    validateMigration: validatePopulationMigration,
    buildMigrationFingerprint: buildPopulationMigrationFingerprint
  });
}

module.exports = {
  DEFAULT_POPULATION_SIGNAL_VERSION,
  POPULATION_MIGRATION_SCHEMA_VERSION,
  POPULATION_MIGRATION_SOURCE,
  POPULATION_PRODUCER,
  POPULATION_SIGNAL_NAME,
  REQUIRED_POPULATION_MIGRATION_FIELDS,
  buildPopulationMigrationFingerprint,
  migratePopulationSignal,
  summarizePopulationMigration,
  validatePopulationMigration
};
