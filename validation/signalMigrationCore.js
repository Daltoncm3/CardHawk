'use strict';

const { asArray, asObject, unique } = require('./canonicalValidationCore');
const { buildFingerprintFromProjection } = require('./fingerprintProjection');
const { clone, firstDefined } = require('./phase8GovernanceCore');
const { UNKNOWN_VALUE } = require('./canonicalIntelligenceSignalContract');
const {
  createAlignmentBatch,
  validateAlignmentBatch
} = require('./signalAlignmentBatch');
const {
  validateSignalAlignmentRun
} = require('./signalAlignmentEngine');
const {
  analyzeSignalConflicts,
  validateConflictAnalysis
} = require('./signalConflictAnalyzer');
const {
  createSignalAlignmentReport,
  validateSignalAlignmentReport
} = require('./signalAlignmentReport');
const {
  validateSignalMigrationArtifact
} = require('./signalMigrationCoreContract');
const {
  validateSignalMigrationAdapter
} = require('./signalMigrationAdapterContract');

const SIGNAL_MIGRATION_CORE_RUNTIME_SOURCE = 'signal_migration_core';

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

function extractNativeOutput(input = {}, aliases = []) {
  for (const alias of aliases) {
    if (input[alias] !== undefined) return clone(asObject(input[alias]));
  }
  return clone(asObject(firstDefined(input.nativeOutput, input.output, {})));
}

function callRequired(config = {}, name, ...args) {
  if (typeof config[name] !== 'function') {
    throw new Error(`Signal migration core requires ${name}.`);
  }
  return config[name](...args);
}

function buildAuthorityViolations(record = {}, prefix = '') {
  const violations = [];
  for (const field of ['productionImpact', 'decisionImpact', 'executionAuthority']) {
    if (record[field] !== undefined && record[field] !== 'none') violations.push(prefix ? `${prefix}.${field}` : field);
  }
  return violations;
}

function verifyExactNativeOutputParity(nativeOutput = {}, migration = {}, options = {}) {
  const canonicalRaw = migration.canonicalSignal && migration.canonicalSignal.rawOutput;
  const adaptedRaw = migration.adaptedSignal && migration.adaptedSignal.nativeOutput;
  const preserved = JSON.stringify(nativeOutput) === JSON.stringify(canonicalRaw) &&
    JSON.stringify(nativeOutput) === JSON.stringify(adaptedRaw);
  const errors = [];
  if (!preserved) {
    errors.push(validationIssue(
      firstDefined(options.reasonCode, 'native_output_parity_mismatch'),
      firstDefined(options.message, 'Native output was not preserved exactly.'),
      'nativeOutput'
    ));
  }
  return {
    parityStatus: preserved ? 'preserved' : 'changed',
    valid: preserved,
    errors,
    warnings: [],
    reasonCodes: unique(errors.map((error) => error.code)).sort()
  };
}

function buildSignalMigrationLifecycleFingerprint(lifecycle = {}) {
  const projection = clone(lifecycle);
  delete projection.lifecycleFingerprint;
  delete projection.signalMigrationLifecycleFingerprint;
  return buildFingerprintFromProjection(projection);
}

function executeSignalMigrationLifecycle(input = {}, options = {}, config = {}) {
  try {
    const nativeOutput = extractNativeOutput(input, firstDefined(config.nativeOutputAliases, []));
    const registry = firstDefined(input.registry, options.registry, null);
    const definition = callRequired(config, 'resolveDefinition', registry, nativeOutput, input, options);
    const registryResolutionStatus = callRequired(config, 'getRegistryResolutionStatus', registry, definition, nativeOutput, input, options);
    const createdAt = normalizeDate(firstDefined(input.createdAt, options.createdAt, UNKNOWN_VALUE));
    const canonicalSignal = callRequired(config, 'buildCanonicalSignal', {
      ...input,
      nativeOutput,
      registry
    }, definition, registryResolutionStatus, options);
    const alignment = callRequired(config, 'buildAlignment', {
      ...input,
      registry
    }, canonicalSignal, definition, registryResolutionStatus, options);
    const adaptedSignal = callRequired(config, 'buildAdaptedSignal', input, canonicalSignal, alignment, definition, registryResolutionStatus, options);
    const migrationSource = normalizeString(firstDefined(config.migrationSource, config.source));
    const alignmentBatch = createAlignmentBatch({
      alignmentBatchId: normalizeString(firstDefined(input.alignmentBatchId, options.alignmentBatchId, config.defaultAlignmentBatchId, 'signal-migration-alignment-batch')),
      createdAt,
      adaptedSignals: [adaptedSignal],
      metadata: {
        migrationSource
      }
    });
    const alignmentRun = callRequired(config, 'buildAlignmentRun', {
      ...input,
      registry,
      createdAt
    }, adaptedSignal, alignmentBatch, options);
    const conflictAnalysis = analyzeSignalConflicts({
      analysisId: normalizeString(firstDefined(input.conflictAnalysisId, options.conflictAnalysisId, config.defaultConflictAnalysisId, 'signal-migration-conflict-analysis')),
      createdAt,
      alignmentRun
    });
    const alignmentReport = createSignalAlignmentReport({
      reportId: normalizeString(firstDefined(input.reportId, options.reportId, config.defaultReportId, 'signal-migration-alignment-report')),
      createdAt,
      alignmentRun,
      conflictAnalysis
    });
    const parity = typeof config.verifyParity === 'function'
      ? config.verifyParity(nativeOutput, { canonicalSignal, adaptedSignal, alignment, alignmentBatch, alignmentRun, conflictAnalysis, alignmentReport })
      : verifyExactNativeOutputParity(nativeOutput, { canonicalSignal, adaptedSignal });
    const core = {
      schemaVersion: normalizeString(config.schemaVersion),
      source: migrationSource,
      migrationId: normalizeString(firstDefined(input.migrationId, options.migrationId, `${normalizeString(config.defaultMigrationIdPrefix, 'signal-migration')}:${canonicalSignal.sourceFingerprint}`)),
      createdAt,
      nativeOutput,
      sourceOutputFingerprint: canonicalSignal.sourceFingerprint,
      registry,
      registryResolutionStatus,
      canonicalSignal,
      alignment,
      adaptedSignal,
      alignmentBatch,
      alignmentRun,
      conflictAnalysis,
      alignmentReport,
      parityStatus: parity.parityStatus,
      reportStatus: alignmentReport.reportValidation && alignmentReport.reportValidation.valid ? 'valid' : 'invalid',
      productionImpact: 'none',
      decisionImpact: 'none',
      executionAuthority: 'none',
      metadata: {
        wrapperOnly: true,
        nativeEngineExecuted: false,
        ...clone(asObject(input.metadata))
      }
    };

    if (typeof config.summarizeMigration !== 'function' || typeof config.validateMigration !== 'function' || typeof config.buildMigrationFingerprint !== 'function') {
      return deepFreeze({
        ...core,
        lifecycleFingerprint: buildSignalMigrationLifecycleFingerprint(core)
      });
    }

    const withSummary = {
      ...core,
      summary: config.summarizeMigration(core)
    };
    const prevalidated = {
      ...withSummary,
      migrationFingerprint: config.buildMigrationFingerprint(withSummary)
    };
    const withValidation = {
      ...withSummary,
      validation: config.validateMigration(prevalidated)
    };
    return deepFreeze({
      ...withValidation,
      migrationFingerprint: config.buildMigrationFingerprint(withValidation)
    });
  } catch (error) {
    const createdAt = normalizeDate(firstDefined(input.createdAt, options.createdAt, UNKNOWN_VALUE));
    return deepFreeze({
      schemaVersion: normalizeString(config.schemaVersion),
      source: normalizeString(firstDefined(config.migrationSource, config.source, SIGNAL_MIGRATION_CORE_RUNTIME_SOURCE)),
      migrationId: normalizeString(firstDefined(input.migrationId, options.migrationId, 'signal-migration:blocked')),
      createdAt,
      nativeOutput: extractNativeOutput(input, firstDefined(config.nativeOutputAliases, [])),
      registry: firstDefined(input.registry, options.registry, null),
      registryResolutionStatus: 'blocked',
      parityStatus: 'blocked',
      reportStatus: 'invalid',
      productionImpact: 'none',
      decisionImpact: 'none',
      executionAuthority: 'none',
      errors: [validationIssue('signal_migration_lifecycle_failed', error.message, 'lifecycle')],
      warnings: [],
      lifecycleFingerprint: buildSignalMigrationLifecycleFingerprint({
        schemaVersion: normalizeString(config.schemaVersion),
        source: normalizeString(firstDefined(config.migrationSource, config.source, SIGNAL_MIGRATION_CORE_RUNTIME_SOURCE)),
        migrationId: normalizeString(firstDefined(input.migrationId, options.migrationId, 'signal-migration:blocked')),
        createdAt,
        parityStatus: 'blocked',
        reportStatus: 'invalid'
      })
    });
  }
}

function aggregateNestedValidation(migration = {}, options = {}) {
  const validations = asArray(options.validations);
  const errors = [];
  const warnings = [];
  const authorityViolations = [];
  const fingerprintViolations = [];

  for (const [prefix, validation] of validations) {
    if (!validation) continue;
    if (!validation.valid) errors.push(...asArray(validation.errors).map((error) => ({ ...error, field: `${prefix}.${error.field || ''}` })));
    warnings.push(...asArray(validation.warnings).map((warning) => ({ ...warning, field: `${prefix}.${warning.field || ''}` })));
    authorityViolations.push(...asArray(validation.authorityViolations).map((field) => `${prefix}.${field}`));
    fingerprintViolations.push(...asArray(validation.fingerprintViolations).map((field) => `${prefix}.${field}`));
  }

  authorityViolations.push(...buildAuthorityViolations(migration));
  return {
    errors,
    warnings,
    authorityViolations: unique(authorityViolations).sort(),
    fingerprintViolations: unique(fingerprintViolations).sort()
  };
}

function validateSignalMigrationLifecycle(migration = {}, options = {}) {
  const errors = [];
  const warnings = [];
  const authorityViolations = [];
  const fingerprintViolations = [];
  const nestedValidation = aggregateNestedValidation(migration, options);

  errors.push(...nestedValidation.errors);
  warnings.push(...nestedValidation.warnings);
  authorityViolations.push(...nestedValidation.authorityViolations);
  fingerprintViolations.push(...nestedValidation.fingerprintViolations);

  if (options.adapter) {
    const adapterValidation = validateSignalMigrationAdapter(options.adapter);
    if (!adapterValidation.valid) errors.push(...adapterValidation.errors.map((error) => ({ ...error, field: `adapter.${error.field || ''}` })));
    warnings.push(...adapterValidation.warnings.map((warning) => ({ ...warning, field: `adapter.${warning.field || ''}` })));
    authorityViolations.push(...adapterValidation.authorityViolations.map((field) => `adapter.${field}`));
    fingerprintViolations.push(...adapterValidation.fingerprintViolations.map((field) => `adapter.${field}`));
  }

  if (options.coreArtifact) {
    const artifactValidation = validateSignalMigrationArtifact(options.coreArtifact);
    if (!artifactValidation.valid) errors.push(...artifactValidation.errors.map((error) => ({ ...error, field: `coreArtifact.${error.field || ''}` })));
    warnings.push(...artifactValidation.warnings.map((warning) => ({ ...warning, field: `coreArtifact.${warning.field || ''}` })));
    authorityViolations.push(...artifactValidation.authorityViolations.map((field) => `coreArtifact.${field}`));
    fingerprintViolations.push(...artifactValidation.fingerprintViolations.map((field) => `coreArtifact.${field}`));
  }

  const parity = typeof options.verifyParity === 'function'
    ? options.verifyParity(migration.nativeOutput, migration)
    : verifyExactNativeOutputParity(migration.nativeOutput, migration);
  if (!parity.valid) errors.push(...parity.errors.map((error) => ({ ...error, field: `parity.${error.field || ''}` })));
  warnings.push(...parity.warnings.map((warning) => ({ ...warning, field: `parity.${warning.field || ''}` })));

  for (const [prefix, validation] of [
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

  const reasonCodes = unique([
    ...errors.map((error) => error.code),
    ...warnings.map((warning) => warning.code)
  ]).sort();

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes,
    registryResolutionStatus: normalizeString(migration.registryResolutionStatus),
    alignmentStatus: normalizeString(migration.alignment && migration.alignment.alignmentStatus),
    reportStatus: migration.reportStatus || UNKNOWN_VALUE,
    parityStatus: parity.parityStatus,
    authorityViolations: unique(authorityViolations).sort(),
    fingerprintViolations: unique(fingerprintViolations).sort()
  };
}

function summarizeSignalMigrationLifecycle(migration = {}) {
  return deepFreeze({
    schemaVersion: normalizeString(migration.schemaVersion),
    source: normalizeString(migration.source),
    migrationId: normalizeString(migration.migrationId),
    signalName: normalizeString(migration.canonicalSignal && migration.canonicalSignal.signalName),
    producer: normalizeString(migration.canonicalSignal && migration.canonicalSignal.producer && migration.canonicalSignal.producer.name),
    registryResolutionStatus: normalizeString(migration.registryResolutionStatus),
    alignmentStatus: normalizeString(migration.alignment && migration.alignment.alignmentStatus),
    reportStatus: normalizeString(migration.reportStatus),
    parityStatus: normalizeString(migration.parityStatus),
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  });
}

module.exports = {
  SIGNAL_MIGRATION_CORE_RUNTIME_SOURCE,
  buildSignalMigrationLifecycleFingerprint,
  executeSignalMigrationLifecycle,
  summarizeSignalMigrationLifecycle,
  validateSignalMigrationLifecycle,
  verifyExactNativeOutputParity
};
