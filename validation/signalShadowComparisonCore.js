'use strict';

const { asArray, asObject, unique } = require('./canonicalValidationCore');
const { buildFingerprintFromProjection } = require('./fingerprintProjection');
const { clone, firstDefined } = require('./phase8GovernanceCore');
const { UNKNOWN_VALUE, validateCanonicalSignal } = require('./canonicalIntelligenceSignalContract');
const { validateSignalAlignment } = require('./signalAlignmentContract');
const { validateSignalAlignmentRun } = require('./signalAlignmentEngine');
const { validateSignalAlignmentReport } = require('./signalAlignmentReport');
const {
  createSignalShadowComparisonArtifact,
  validateSignalShadowComparisonArtifact
} = require('./signalShadowComparisonCoreContract');

const SIGNAL_SHADOW_COMPARISON_CORE_SOURCE = 'signal_shadow_comparison_core';

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

function requireFunction(config = {}, name) {
  if (typeof config[name] !== 'function') {
    throw new Error(`Signal shadow comparison core requires ${name}.`);
  }
  return config[name];
}

function resolveMigration(input = {}, options = {}, config = {}) {
  const aliases = asArray(config.migrationAliases);
  for (const alias of ['migration', ...aliases]) {
    if (input[alias]) return clone(input[alias]);
  }
  return requireFunction(config, 'migrate')(input, options);
}

function sortMismatches(mismatches = []) {
  return asArray(mismatches)
    .map((mismatch) => clone(mismatch))
    .sort((left, right) => `${left.code}|${left.field}`.localeCompare(`${right.code}|${right.field}`));
}

function collectWarnings(...validations) {
  return unique(validations.flatMap((validation) => asArray(validation.warnings).map((warning) => warning.code))).sort();
}

function collectErrors(validationsBySource = []) {
  return validationsBySource.flatMap(([source, validation]) => (
    validation && !validation.valid ? asArray(validation.errors).map((error) => ({ ...error, source })) : []
  ));
}

function executeSignalShadowComparisonLifecycle(input = {}, options = {}, config = {}) {
  try {
    const migration = resolveMigration(input, options, config);
    const nativeOutput = clone(firstDefined(input.nativeOutput, migration.nativeOutput, {}));
    const canonicalSignal = asObject(migration.canonicalSignal);
    const alignment = asObject(migration.alignment);
    const alignmentReport = asObject(migration.alignmentReport);

    const fieldResult = requireFunction(config, 'compareNativeFields')(nativeOutput, canonicalSignal, migration);
    const evidenceComparison = requireFunction(config, 'compareEvidence')(nativeOutput, canonicalSignal, alignment, migration);
    const confidenceComparison = requireFunction(config, 'compareConfidence')(nativeOutput, canonicalSignal, alignment, migration);
    const statusComparison = requireFunction(config, 'compareStatus')(nativeOutput, canonicalSignal, alignment, alignmentReport, migration);
    const metadataComparison = requireFunction(config, 'compareMetadata')(nativeOutput, canonicalSignal, migration);
    const unknownValueComparison = requireFunction(config, 'compareUnknownValues')(nativeOutput, canonicalSignal, migration);
    const mismatches = sortMismatches([
      ...asArray(fieldResult.mismatches),
      ...asArray(evidenceComparison.mismatches),
      ...asArray(confidenceComparison.mismatches),
      ...asArray(statusComparison.mismatches),
      ...asArray(metadataComparison.mismatches),
      ...asArray(unknownValueComparison.mismatches)
    ]);

    const migrationValidation = requireFunction(config, 'validateMigration')(migration);
    const signalValidation = validateCanonicalSignal(canonicalSignal);
    const alignmentValidation = validateSignalAlignment(alignment);
    const runValidation = validateSignalAlignmentRun(migration.alignmentRun);
    const reportValidation = validateSignalAlignmentReport(alignmentReport);
    const validationState = {
      migrationValid: migrationValidation.valid,
      signalValid: signalValidation.valid,
      alignmentValid: alignmentValidation.valid,
      runValid: runValidation.valid,
      reportValid: reportValidation.valid,
      alignmentStatus: normalizeString(alignment.alignmentStatus)
    };
    const parityStatus = requireFunction(config, 'determineParityStatus')({
      fieldComparisons: fieldResult,
      evidenceComparison,
      confidenceComparison,
      statusComparison,
      metadataComparison,
      unknownValueComparison,
      mismatches
    }, validationState);
    const errors = collectErrors([
      ['migration', migrationValidation],
      ['canonicalSignal', signalValidation],
      ['alignment', alignmentValidation],
      ['alignmentRun', runValidation],
      ['alignmentReport', reportValidation]
    ]);
    const warnings = collectWarnings(migrationValidation, signalValidation, alignmentValidation, runValidation, reportValidation);
    const core = {
      schemaVersion: normalizeString(config.schemaVersion),
      source: normalizeString(config.comparisonSource),
      comparisonId: normalizeString(firstDefined(input.comparisonId, options.comparisonId, `${normalizeString(config.defaultComparisonIdPrefix, 'signal-shadow-comparison')}:${migration.sourceOutputFingerprint}`)),
      createdAt: normalizeDate(firstDefined(input.createdAt, options.createdAt, migration.createdAt, UNKNOWN_VALUE)),
      migrationFingerprint: normalizeString(migration.migrationFingerprint),
      nativeOutputFingerprint: normalizeString(firstDefined(migration.sourceOutputFingerprint, buildFingerprintFromProjection(nativeOutput))),
      canonicalSignalFingerprint: normalizeString(canonicalSignal.signalFingerprint),
      alignmentFingerprint: normalizeString(alignment.alignmentFingerprint),
      reportFingerprint: normalizeString(alignmentReport.reportFingerprint),
      fieldComparisons: asArray(fieldResult.comparisons),
      evidenceComparison,
      confidenceComparison,
      statusComparison,
      metadataComparison,
      unknownValueComparison,
      parityStatus,
      mismatchCount: mismatches.length,
      mismatches,
      warnings,
      errors,
      sourceArtifacts: {
        migration,
        nativeOutput,
        canonicalSignal: clone(canonicalSignal),
        alignment: clone(alignment),
        alignmentRun: clone(migration.alignmentRun),
        alignmentReport: clone(alignmentReport)
      },
      productionImpact: 'none',
      decisionImpact: 'none',
      executionAuthority: 'none',
      metadata: {
        wrapperOnly: true,
        nativeEngineExecuted: false,
        comparisonScope: normalizeString(config.comparisonScope)
      }
    };

    const withSummary = {
      ...core,
      summary: requireFunction(config, 'summarizeComparison')(core)
    };
    const prevalidated = {
      ...withSummary,
      comparisonFingerprint: requireFunction(config, 'buildComparisonFingerprint')(withSummary)
    };
    const withValidation = {
      ...withSummary,
      validation: requireFunction(config, 'validateComparison')(prevalidated)
    };
    return deepFreeze({
      ...withValidation,
      comparisonFingerprint: requireFunction(config, 'buildComparisonFingerprint')(withValidation)
    });
  } catch (error) {
    const core = {
      schemaVersion: normalizeString(config.schemaVersion),
      source: normalizeString(firstDefined(config.comparisonSource, SIGNAL_SHADOW_COMPARISON_CORE_SOURCE)),
      comparisonId: normalizeString(firstDefined(input.comparisonId, options.comparisonId, 'signal-shadow-comparison:blocked')),
      createdAt: normalizeDate(firstDefined(input.createdAt, options.createdAt, UNKNOWN_VALUE)),
      parityStatus: 'blocked',
      mismatchCount: 0,
      mismatches: [],
      warnings: [],
      errors: [validationIssue('signal_shadow_comparison_lifecycle_failed', error.message, 'lifecycle')],
      productionImpact: 'none',
      decisionImpact: 'none',
      executionAuthority: 'none',
      metadata: {
        wrapperOnly: true,
        nativeEngineExecuted: false,
        comparisonScope: normalizeString(config.comparisonScope)
      }
    };
    return deepFreeze({
      ...core,
      comparisonFingerprint: buildFingerprintFromProjection(core)
    });
  }
}

function validateSignalShadowComparisonLifecycle(comparison = {}, options = {}) {
  const validation = options.contractArtifact
    ? validateSignalShadowComparisonArtifact(options.contractArtifact)
    : { valid: true, errors: [], warnings: [], reasonCodes: [], authorityViolations: [], fingerprintViolations: [], parityViolations: [], statusViolations: [], mismatchViolations: [] };
  const customValidations = asArray(options.validations);
  const errors = [...validation.errors];
  const warnings = [...validation.warnings];
  const authorityViolations = [...asArray(validation.authorityViolations)];
  const fingerprintViolations = [...asArray(validation.fingerprintViolations)];

  for (const [prefix, nestedValidation] of customValidations) {
    if (!nestedValidation) continue;
    if (!nestedValidation.valid) errors.push(...asArray(nestedValidation.errors).map((error) => ({ ...error, field: `${prefix}.${error.field || ''}` })));
    warnings.push(...asArray(nestedValidation.warnings).map((warning) => ({ ...warning, field: `${prefix}.${warning.field || ''}` })));
    authorityViolations.push(...asArray(nestedValidation.authorityViolations).map((field) => `${prefix}.${field}`));
    fingerprintViolations.push(...asArray(nestedValidation.fingerprintViolations).map((field) => `${prefix}.${field}`));
  }

  for (const field of ['productionImpact', 'decisionImpact', 'executionAuthority']) {
    if (comparison[field] !== undefined && comparison[field] !== 'none') {
      errors.push(validationIssue('authority_boundary_violation', `${field} must remain none.`, field));
      authorityViolations.push(field);
    }
  }

  const reasonCodes = unique([...errors.map((error) => error.code), ...warnings.map((warning) => warning.code)]).sort();
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes,
    parityStatus: normalizeString(comparison.parityStatus),
    mismatchCount: asArray(comparison.mismatches).length,
    authorityViolations: unique(authorityViolations).sort(),
    fingerprintViolations: unique(fingerprintViolations).sort()
  };
}

function summarizeSignalShadowComparisonLifecycle(comparison = {}) {
  return deepFreeze({
    schemaVersion: normalizeString(comparison.schemaVersion),
    source: normalizeString(comparison.source),
    comparisonId: normalizeString(comparison.comparisonId),
    parityStatus: normalizeString(comparison.parityStatus),
    mismatchCount: Number(firstDefined(comparison.mismatchCount, 0)),
    warningCount: asArray(comparison.warnings).length,
    errorCount: asArray(comparison.errors).length,
    fieldComparisonCount: asArray(comparison.fieldComparisons).length,
    nativeOutputFingerprint: normalizeString(comparison.nativeOutputFingerprint),
    canonicalSignalFingerprint: normalizeString(comparison.canonicalSignalFingerprint),
    alignmentFingerprint: normalizeString(comparison.alignmentFingerprint),
    reportFingerprint: normalizeString(comparison.reportFingerprint),
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  });
}

function buildSignalShadowComparisonLifecycleFingerprint(comparison = {}) {
  const projection = clone(comparison);
  delete projection.comparisonFingerprint;
  delete projection.signalShadowComparisonLifecycleFingerprint;
  return buildFingerprintFromProjection(projection);
}

function buildSignalShadowComparisonContractArtifact(comparison = {}, overrides = {}) {
  return createSignalShadowComparisonArtifact({
    comparisonId: comparison.comparisonId,
    createdAt: comparison.createdAt,
    engineName: comparison.sourceArtifacts && comparison.sourceArtifacts.canonicalSignal && comparison.sourceArtifacts.canonicalSignal.producer && comparison.sourceArtifacts.canonicalSignal.producer.name,
    engineVersion: comparison.sourceArtifacts && comparison.sourceArtifacts.canonicalSignal && comparison.sourceArtifacts.canonicalSignal.producerVersion,
    signalName: comparison.sourceArtifacts && comparison.sourceArtifacts.canonicalSignal && comparison.sourceArtifacts.canonicalSignal.signalName,
    signalVersion: comparison.sourceArtifacts && comparison.sourceArtifacts.canonicalSignal && comparison.sourceArtifacts.canonicalSignal.producerVersion,
    nativeOutputFingerprint: comparison.nativeOutputFingerprint,
    migrationFingerprint: comparison.migrationFingerprint,
    canonicalSignalFingerprint: comparison.canonicalSignalFingerprint,
    alignmentFingerprint: comparison.alignmentFingerprint,
    runFingerprint: comparison.sourceArtifacts && comparison.sourceArtifacts.alignmentRun && comparison.sourceArtifacts.alignmentRun.runFingerprint,
    reportFingerprint: comparison.reportFingerprint,
    exactParityStatus: comparison.fieldComparisons && asArray(comparison.fieldComparisons).every((item) => item.status === 'exact_match') ? 'exact_match' : comparison.parityStatus,
    semanticParityStatus: comparison.parityStatus,
    evidenceParityStatus: comparison.evidenceComparison && comparison.evidenceComparison.status,
    confidenceParityStatus: comparison.confidenceComparison && comparison.confidenceComparison.status,
    statusParityStatus: comparison.statusComparison && comparison.statusComparison.status,
    metadataParityStatus: comparison.metadataComparison && comparison.metadataComparison.status,
    authorityStatus: 'preserved',
    fingerprintStatus: 'valid',
    comparisonStatus: comparison.parityStatus,
    mismatchCount: comparison.mismatchCount,
    mismatchReasonCodes: asArray(comparison.mismatches).map((mismatch) => mismatch.code),
    mismatches: comparison.mismatches,
    warnings: comparison.warnings,
    errors: comparison.errors,
    ...overrides
  });
}

module.exports = {
  SIGNAL_SHADOW_COMPARISON_CORE_SOURCE,
  buildSignalShadowComparisonContractArtifact,
  buildSignalShadowComparisonLifecycleFingerprint,
  executeSignalShadowComparisonLifecycle,
  summarizeSignalShadowComparisonLifecycle,
  validateSignalShadowComparisonLifecycle
};
