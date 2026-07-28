'use strict';

const { asArray, asObject, unique } = require('./canonicalValidationCore');
const { buildFingerprintFromProjection } = require('./fingerprintProjection');
const { clone, firstDefined } = require('./phase8GovernanceCore');
const { UNKNOWN_VALUE, validateCanonicalSignal, buildCanonicalSignalFingerprint } = require('./canonicalIntelligenceSignalContract');
const {
  migratePopulationSignal,
  validatePopulationMigration,
  buildPopulationMigrationFingerprint
} = require('./populationSignalMigration');
const {
  validateSignalAlignment,
  buildSignalAlignmentFingerprint
} = require('./signalAlignmentContract');
const {
  validateSignalAlignmentRun,
  buildSignalAlignmentRunFingerprint
} = require('./signalAlignmentEngine');
const {
  validateSignalAlignmentReport,
  buildSignalAlignmentReportFingerprint
} = require('./signalAlignmentReport');

const POPULATION_SHADOW_COMPARISON_SCHEMA_VERSION = '1.0.0';
const POPULATION_SHADOW_COMPARISON_SOURCE = 'population_shadow_comparison';

const PARITY_STATUSES = Object.freeze([
  'exact_match',
  'semantic_match',
  'mismatch',
  'incomplete',
  'invalid',
  'blocked'
]);

const REQUIRED_POPULATION_SHADOW_COMPARISON_FIELDS = Object.freeze([
  'schemaVersion',
  'source',
  'comparisonId',
  'createdAt',
  'migrationFingerprint',
  'nativeOutputFingerprint',
  'canonicalSignalFingerprint',
  'alignmentFingerprint',
  'reportFingerprint',
  'fieldComparisons',
  'evidenceComparison',
  'confidenceComparison',
  'statusComparison',
  'metadataComparison',
  'unknownValueComparison',
  'parityStatus',
  'mismatchCount',
  'mismatches',
  'warnings',
  'errors',
  'productionImpact',
  'decisionImpact',
  'executionAuthority',
  'comparisonFingerprint'
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

function stableEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function pathExists(source = {}, path = '') {
  let current = source;
  for (const part of String(path).split('.')) {
    if (!current || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, part)) return false;
    current = current[part];
  }
  return true;
}

function sortedObjectKeys(value = {}) {
  return Object.keys(asObject(value)).sort((left, right) => left.localeCompare(right));
}

function normalizeComparisonStatus(match, semanticMatch = false) {
  if (match) return 'exact_match';
  if (semanticMatch) return 'semantic_match';
  return 'mismatch';
}

function buildMismatch(code, field, message, nativeValue, shadowValue) {
  return {
    code,
    field,
    message,
    nativeValue: clone(nativeValue),
    shadowValue: clone(shadowValue)
  };
}

function compareNativeFields(nativeOutput = {}, canonicalSignal = {}) {
  const rawOutput = canonicalSignal.rawOutput;
  const comparisons = [];
  const mismatches = [];
  if (!rawOutput || rawOutput === UNKNOWN_VALUE) {
    return {
      status: 'incomplete',
      comparisons,
      mismatches: [buildMismatch('missing_wrapper_raw_output', 'canonicalSignal.rawOutput', 'Canonical signal rawOutput is missing.', nativeOutput, rawOutput)]
    };
  }

  const nativeKeys = sortedObjectKeys(nativeOutput);
  const rawKeys = sortedObjectKeys(rawOutput);
  for (const key of nativeKeys) {
    const nativeValue = nativeOutput[key];
    const shadowValue = rawOutput[key];
    const exists = Object.prototype.hasOwnProperty.call(rawOutput, key);
    const exactMatch = exists && stableEqual(nativeValue, shadowValue);
    comparisons.push({
      field: key,
      nativePath: key,
      shadowPath: `canonicalSignal.rawOutput.${key}`,
      status: exists ? normalizeComparisonStatus(exactMatch) : 'missing_wrapper_field',
      nativeValue: clone(nativeValue),
      shadowValue: clone(shadowValue)
    });
    if (!exists) {
      mismatches.push(buildMismatch('missing_wrapper_field', key, 'Native field is missing from canonical raw output.', nativeValue, shadowValue));
    } else if (!exactMatch) {
      mismatches.push(buildMismatch('changed_native_field', key, 'Native field value changed in canonical raw output.', nativeValue, shadowValue));
    }
  }
  for (const key of rawKeys) {
    if (!Object.prototype.hasOwnProperty.call(nativeOutput, key)) {
      const shadowValue = rawOutput[key];
      comparisons.push({
        field: key,
        nativePath: key,
        shadowPath: `canonicalSignal.rawOutput.${key}`,
        status: 'unexpected_wrapper_field',
        nativeValue: UNKNOWN_VALUE,
        shadowValue: clone(shadowValue)
      });
      mismatches.push(buildMismatch('unexpected_wrapper_field', key, 'Canonical raw output contains a field not present in native output.', UNKNOWN_VALUE, shadowValue));
    }
  }

  return {
    status: mismatches.length ? 'mismatch' : 'exact_match',
    comparisons: comparisons.sort((left, right) => left.field.localeCompare(right.field)),
    mismatches
  };
}

function compareEvidence(nativeOutput = {}, canonicalSignal = {}) {
  const evidenceBasis = asObject(canonicalSignal.evidenceBasis);
  const details = asObject(evidenceBasis.details);
  const evidenceQuality = asObject(canonicalSignal.evidenceQuality);
  const componentScores = asObject(nativeOutput.componentScores);
  const comparisons = [
    {
      field: 'populationCount',
      nativePath: 'populationCount',
      shadowPath: 'canonicalSignal.evidenceBasis.details.populationCount',
      status: normalizeComparisonStatus(stableEqual(firstDefined(nativeOutput.populationCount, UNKNOWN_VALUE), details.populationCount)),
      nativeValue: firstDefined(nativeOutput.populationCount, UNKNOWN_VALUE),
      shadowValue: clone(details.populationCount)
    },
    {
      field: 'higherGradeCount',
      nativePath: 'higherGradeCount',
      shadowPath: 'canonicalSignal.evidenceBasis.details.higherGradeCount',
      status: normalizeComparisonStatus(stableEqual(firstDefined(nativeOutput.higherGradeCount, UNKNOWN_VALUE), details.higherGradeCount)),
      nativeValue: firstDefined(nativeOutput.higherGradeCount, UNKNOWN_VALUE),
      shadowValue: clone(details.higherGradeCount)
    },
    {
      field: 'totalGradedCount',
      nativePath: 'totalGradedCount',
      shadowPath: 'canonicalSignal.evidenceBasis.details.totalGradedCount',
      status: normalizeComparisonStatus(stableEqual(firstDefined(nativeOutput.totalGradedCount, UNKNOWN_VALUE), details.totalGradedCount)),
      nativeValue: firstDefined(nativeOutput.totalGradedCount, UNKNOWN_VALUE),
      shadowValue: clone(details.totalGradedCount)
    },
    {
      field: 'gemRate',
      nativePath: 'gemRate',
      shadowPath: 'canonicalSignal.evidenceBasis.details.gemRate',
      status: normalizeComparisonStatus(stableEqual(firstDefined(nativeOutput.gemRate, UNKNOWN_VALUE), details.gemRate)),
      nativeValue: firstDefined(nativeOutput.gemRate, UNKNOWN_VALUE),
      shadowValue: clone(details.gemRate)
    },
    {
      field: 'populationSource',
      nativePath: 'populationSource',
      shadowPath: 'canonicalSignal.evidenceBasis.details.populationSource',
      status: normalizeComparisonStatus(stableEqual(normalizeString(nativeOutput.populationSource), details.populationSource)),
      nativeValue: normalizeString(nativeOutput.populationSource),
      shadowValue: clone(details.populationSource)
    },
    {
      field: 'lastPopulationUpdate',
      nativePath: 'lastPopulationUpdate',
      shadowPath: 'canonicalSignal.evidenceBasis.details.lastPopulationUpdate',
      status: normalizeComparisonStatus(stableEqual(normalizeString(nativeOutput.lastPopulationUpdate), details.lastPopulationUpdate)),
      nativeValue: normalizeString(nativeOutput.lastPopulationUpdate),
      shadowValue: clone(details.lastPopulationUpdate)
    },
    {
      field: 'evidenceQuality',
      nativePath: 'evidenceQuality',
      shadowPath: 'canonicalSignal.evidenceBasis.details.evidenceQuality',
      status: normalizeComparisonStatus(stableEqual(normalizeString(nativeOutput.evidenceQuality), details.evidenceQuality)),
      nativeValue: normalizeString(nativeOutput.evidenceQuality),
      shadowValue: clone(details.evidenceQuality)
    },
    {
      field: 'evidenceScore',
      nativePath: 'componentScores.evidenceScore',
      shadowPath: 'canonicalSignal.evidenceQuality.score',
      status: normalizeComparisonStatus(stableEqual(firstDefined(componentScores.evidenceScore, UNKNOWN_VALUE), evidenceQuality.score)),
      nativeValue: firstDefined(componentScores.evidenceScore, UNKNOWN_VALUE),
      shadowValue: clone(evidenceQuality.score)
    },
    {
      field: 'trueSoldCount',
      nativePath: 'population fields do not represent sold evidence',
      shadowPath: 'canonicalSignal.evidenceBasis.trueSoldCount',
      status: evidenceBasis.trueSoldCount === 0 ? 'semantic_match' : 'mismatch',
      nativeValue: 0,
      shadowValue: evidenceBasis.trueSoldCount,
      semanticReason: 'population_context_is_not_transaction_level_sold_evidence'
    },
    {
      field: 'activeListingCount',
      nativePath: 'population fields do not represent active listings',
      shadowPath: 'canonicalSignal.evidenceBasis.activeListingCount',
      status: evidenceBasis.activeListingCount === 0 ? 'semantic_match' : 'mismatch',
      nativeValue: 0,
      shadowValue: evidenceBasis.activeListingCount,
      semanticReason: 'population_context_is_not_active_listing_evidence'
    }
  ];
  const mismatches = comparisons
    .filter((comparison) => !['exact_match', 'semantic_match'].includes(comparison.status))
    .map((comparison) => buildMismatch('changed_evidence_value', comparison.field, 'Evidence representation differs between native and shadow wrapper.', comparison.nativeValue, comparison.shadowValue));

  return {
    status: mismatches.length ? 'mismatch' : (comparisons.some((item) => item.status === 'semantic_match') ? 'semantic_match' : 'exact_match'),
    comparisons,
    mismatches
  };
}

function compareConfidence(nativeOutput = {}, canonicalSignal = {}, alignment = {}) {
  const confidence = asObject(canonicalSignal.confidence);
  const mismatches = [];
  const comparisons = [
    {
      field: 'confidence',
      nativePath: 'confidence',
      shadowPath: 'canonicalSignal.confidence.value',
      status: pathExists(nativeOutput, 'confidence')
        ? normalizeComparisonStatus(stableEqual(nativeOutput.confidence, confidence.value))
        : 'semantic_match',
      nativeValue: pathExists(nativeOutput, 'confidence') ? clone(nativeOutput.confidence) : UNKNOWN_VALUE,
      shadowValue: clone(confidence.value),
      semanticReason: pathExists(nativeOutput, 'confidence') ? 'native_confidence_supplied' : 'native_population_confidence_unknown'
    },
    {
      field: 'confidenceLevel',
      nativePath: 'confidence',
      shadowPath: 'canonicalSignal.confidenceLevel',
      status: canonicalSignal.confidenceLevel ? 'semantic_match' : 'missing_wrapper_field',
      nativeValue: pathExists(nativeOutput, 'confidence') ? clone(nativeOutput.confidence) : UNKNOWN_VALUE,
      shadowValue: clone(canonicalSignal.confidenceLevel)
    },
    {
      field: 'confidenceAlignment',
      nativePath: 'populationVersion',
      shadowPath: 'alignment.confidenceAlignment',
      status: alignment.confidenceAlignment ? 'semantic_match' : 'missing_wrapper_field',
      nativeValue: clone(firstDefined(nativeOutput.populationVersion, nativeOutput.version, UNKNOWN_VALUE)),
      shadowValue: clone(alignment.confidenceAlignment)
    }
  ];

  if (pathExists(nativeOutput, 'confidence') && !stableEqual(nativeOutput.confidence, confidence.value)) {
    mismatches.push(buildMismatch('changed_confidence_value', 'confidence', 'Native confidence value changed in canonical wrapper.', nativeOutput.confidence, confidence.value));
  }
  if (!canonicalSignal.confidenceLevel) {
    mismatches.push(buildMismatch('missing_confidence_level', 'canonicalSignal.confidenceLevel', 'Canonical confidence level is missing.', UNKNOWN_VALUE, canonicalSignal.confidenceLevel));
  }
  if (!alignment.confidenceAlignment) {
    mismatches.push(buildMismatch('missing_confidence_alignment', 'alignment.confidenceAlignment', 'Alignment confidence metadata is missing.', UNKNOWN_VALUE, alignment.confidenceAlignment));
  }

  return {
    status: mismatches.length ? 'mismatch' : 'semantic_match',
    comparisons,
    mismatches
  };
}

function compareStatus(nativeOutput = {}, canonicalSignal = {}, alignment = {}, report = {}) {
  const normalized = asObject(canonicalSignal.normalizedOutput);
  const comparisons = [
    {
      field: 'scarcityLevel',
      nativePath: 'scarcityLevel',
      shadowPath: 'canonicalSignal.normalizedOutput.status',
      status: normalizeComparisonStatus(stableEqual(normalizeString(nativeOutput.scarcityLevel), normalized.status)),
      nativeValue: normalizeString(nativeOutput.scarcityLevel),
      shadowValue: clone(normalized.status)
    },
    {
      field: 'populationUnavailable',
      nativePath: 'populationUnavailable',
      shadowPath: 'canonicalSignal.normalizedOutput.populationUnavailable',
      status: normalizeComparisonStatus(stableEqual(nativeOutput.populationUnavailable === true, normalized.populationUnavailable)),
      nativeValue: nativeOutput.populationUnavailable === true,
      shadowValue: clone(normalized.populationUnavailable)
    },
    {
      field: 'alignmentStatus',
      nativePath: 'source',
      shadowPath: 'alignment.alignmentStatus',
      status: ['aligned', 'definition_missing', 'version_mismatch', 'blocked', 'aligned_with_warnings'].includes(alignment.alignmentStatus) ? 'semantic_match' : 'mismatch',
      nativeValue: normalizeString(nativeOutput.source),
      shadowValue: clone(alignment.alignmentStatus)
    },
    {
      field: 'reportStatus',
      nativePath: 'source',
      shadowPath: 'alignmentReport.reportValidation.valid',
      status: report.reportValidation && report.reportValidation.valid ? 'semantic_match' : 'mismatch',
      nativeValue: normalizeString(nativeOutput.source),
      shadowValue: clone(report.reportValidation && report.reportValidation.valid)
    }
  ];
  const mismatches = comparisons
    .filter((comparison) => !['exact_match', 'semantic_match'].includes(comparison.status))
    .map((comparison) => buildMismatch('changed_status_value', comparison.field, 'Status representation differs between native and shadow wrapper.', comparison.nativeValue, comparison.shadowValue));

  return {
    status: mismatches.length ? 'mismatch' : (comparisons.some((item) => item.status === 'semantic_match') ? 'semantic_match' : 'exact_match'),
    comparisons,
    mismatches
  };
}

function compareMetadata(nativeOutput = {}, canonicalSignal = {}, migration = {}) {
  const metadata = asObject(canonicalSignal.metadata);
  const producer = asObject(canonicalSignal.producer);
  const nativeVersion = normalizeString(firstDefined(nativeOutput.populationVersion, nativeOutput.version));
  const comparisons = [
    {
      field: 'source',
      nativePath: 'source',
      shadowPath: 'canonicalSignal.metadata.nativeSource',
      status: normalizeComparisonStatus(stableEqual(normalizeString(nativeOutput.source), metadata.nativeSource)),
      nativeValue: normalizeString(nativeOutput.source),
      shadowValue: clone(metadata.nativeSource)
    },
    {
      field: 'populationVersion',
      nativePath: 'populationVersion',
      shadowPath: 'canonicalSignal.metadata.nativeVersion',
      status: normalizeComparisonStatus(stableEqual(nativeVersion, metadata.nativeVersion)),
      nativeValue: nativeVersion,
      shadowValue: clone(metadata.nativeVersion)
    },
    {
      field: 'producer',
      nativePath: 'source',
      shadowPath: 'canonicalSignal.producer.name',
      status: producer.name === 'populationEngine' ? 'semantic_match' : 'mismatch',
      nativeValue: normalizeString(nativeOutput.source),
      shadowValue: clone(producer.name)
    },
    {
      field: 'migration',
      nativePath: 'source',
      shadowPath: 'migration.metadata.wrapperOnly',
      status: migration.metadata && migration.metadata.wrapperOnly === true ? 'semantic_match' : 'mismatch',
      nativeValue: normalizeString(nativeOutput.source),
      shadowValue: clone(migration.metadata && migration.metadata.wrapperOnly)
    }
  ];
  const mismatches = comparisons
    .filter((comparison) => !['exact_match', 'semantic_match'].includes(comparison.status))
    .map((comparison) => buildMismatch('changed_metadata_value', comparison.field, 'Metadata representation differs between native and shadow wrapper.', comparison.nativeValue, comparison.shadowValue));

  return {
    status: mismatches.length ? 'mismatch' : (comparisons.some((item) => item.status === 'semantic_match') ? 'semantic_match' : 'exact_match'),
    comparisons,
    mismatches
  };
}

function findUnknownPaths(value, prefix = '') {
  if (value === UNKNOWN_VALUE) return [prefix || '$'];
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, nested]) => findUnknownPaths(nested, prefix ? `${prefix}.${key}` : key));
}

function compareUnknownValues(nativeOutput = {}, canonicalSignal = {}) {
  const nativeUnknownFields = sortedObjectKeys(nativeOutput)
    .filter((field) => nativeOutput[field] === undefined || nativeOutput[field] === null || nativeOutput[field] === UNKNOWN_VALUE);
  const shadowUnknownPaths = findUnknownPaths({
    normalizedOutput: canonicalSignal.normalizedOutput,
    evidenceBasis: canonicalSignal.evidenceBasis,
    evidenceQuality: canonicalSignal.evidenceQuality,
    confidence: canonicalSignal.confidence,
    uncertainty: canonicalSignal.uncertainty
  });
  return {
    status: nativeUnknownFields.length === 0 || shadowUnknownPaths.length > 0 ? 'semantic_match' : 'mismatch',
    nativeUnknownFields,
    shadowUnknownPaths,
    mismatches: nativeUnknownFields.length > 0 && shadowUnknownPaths.length === 0
      ? [buildMismatch('unknown_value_not_preserved', 'unknownValues', 'Native unknown values were not preserved explicitly.', nativeUnknownFields, shadowUnknownPaths)]
      : []
  };
}

function determineParityStatus(parts = {}, validation = {}) {
  if (!validation.migrationValid || !validation.signalValid || !validation.alignmentValid || !validation.reportValid) return 'invalid';
  if (validation.alignmentStatus === 'blocked') return 'blocked';
  const mismatchCount = asArray(parts.mismatches).length;
  if (mismatchCount > 0) return 'mismatch';
  const statuses = [
    parts.fieldComparisons.status,
    parts.evidenceComparison.status,
    parts.confidenceComparison.status,
    parts.statusComparison.status,
    parts.metadataComparison.status,
    parts.unknownValueComparison.status
  ];
  if (statuses.includes('incomplete')) return 'incomplete';
  if (statuses.every((status) => status === 'exact_match')) return 'exact_match';
  return 'semantic_match';
}

function summarizePopulationShadowComparison(comparison = {}) {
  return deepFreeze({
    schemaVersion: POPULATION_SHADOW_COMPARISON_SCHEMA_VERSION,
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

function buildPopulationShadowComparisonFingerprint(comparison = {}) {
  const projection = clone(comparison);
  delete projection.comparisonFingerprint;
  delete projection.populationShadowComparisonFingerprint;
  return buildFingerprintFromProjection(projection);
}

function comparePopulationNativeToShadow(input = {}, options = {}) {
  const migration = firstDefined(input.migration, input.populationMigration)
    ? clone(firstDefined(input.migration, input.populationMigration))
    : migratePopulationSignal(input, options);
  const nativeOutput = clone(firstDefined(input.nativeOutput, migration.nativeOutput, {}));
  const canonicalSignal = asObject(migration.canonicalSignal);
  const alignment = asObject(migration.alignment);
  const alignmentReport = asObject(migration.alignmentReport);

  const fieldResult = compareNativeFields(nativeOutput, canonicalSignal);
  const evidenceComparison = compareEvidence(nativeOutput, canonicalSignal);
  const confidenceComparison = compareConfidence(nativeOutput, canonicalSignal, alignment);
  const statusComparison = compareStatus(nativeOutput, canonicalSignal, alignment, alignmentReport);
  const metadataComparison = compareMetadata(nativeOutput, canonicalSignal, migration);
  const unknownValueComparison = compareUnknownValues(nativeOutput, canonicalSignal);
  const mismatches = [
    ...fieldResult.mismatches,
    ...evidenceComparison.mismatches,
    ...confidenceComparison.mismatches,
    ...statusComparison.mismatches,
    ...metadataComparison.mismatches,
    ...unknownValueComparison.mismatches
  ].sort((left, right) => `${left.code}|${left.field}`.localeCompare(`${right.code}|${right.field}`));
  const migrationValidation = validatePopulationMigration(migration);
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
  const parityStatus = determineParityStatus({
    fieldComparisons: fieldResult,
    evidenceComparison,
    confidenceComparison,
    statusComparison,
    metadataComparison,
    unknownValueComparison,
    mismatches
  }, validationState);
  const errors = [
    ...(!migrationValidation.valid ? migrationValidation.errors.map((error) => ({ ...error, source: 'migration' })) : []),
    ...(!signalValidation.valid ? signalValidation.errors.map((error) => ({ ...error, source: 'canonicalSignal' })) : []),
    ...(!alignmentValidation.valid ? alignmentValidation.errors.map((error) => ({ ...error, source: 'alignment' })) : []),
    ...(!runValidation.valid ? runValidation.errors.map((error) => ({ ...error, source: 'alignmentRun' })) : []),
    ...(!reportValidation.valid ? reportValidation.errors.map((error) => ({ ...error, source: 'alignmentReport' })) : [])
  ];
  const warnings = unique([
    ...asArray(migrationValidation.warnings).map((warning) => warning.code),
    ...asArray(signalValidation.warnings).map((warning) => warning.code),
    ...asArray(alignmentValidation.warnings).map((warning) => warning.code),
    ...asArray(runValidation.warnings).map((warning) => warning.code),
    ...asArray(reportValidation.warnings).map((warning) => warning.code)
  ]).sort();
  const core = {
    schemaVersion: POPULATION_SHADOW_COMPARISON_SCHEMA_VERSION,
    source: POPULATION_SHADOW_COMPARISON_SOURCE,
    comparisonId: normalizeString(firstDefined(input.comparisonId, options.comparisonId, `population-shadow-comparison:${migration.sourceOutputFingerprint}`)),
    createdAt: normalizeDate(firstDefined(input.createdAt, options.createdAt, migration.createdAt, UNKNOWN_VALUE)),
    migrationFingerprint: normalizeString(migration.migrationFingerprint),
    nativeOutputFingerprint: normalizeString(firstDefined(migration.sourceOutputFingerprint, buildFingerprintFromProjection(nativeOutput))),
    canonicalSignalFingerprint: normalizeString(canonicalSignal.signalFingerprint),
    alignmentFingerprint: normalizeString(alignment.alignmentFingerprint),
    reportFingerprint: normalizeString(alignmentReport.reportFingerprint),
    fieldComparisons: fieldResult.comparisons,
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
      comparisonScope: 'population_native_to_phase_13_shadow'
    }
  };
  const withSummary = {
    ...core,
    summary: summarizePopulationShadowComparison(core)
  };
  const prevalidated = {
    ...withSummary,
    comparisonFingerprint: buildPopulationShadowComparisonFingerprint(withSummary)
  };
  const withValidation = {
    ...withSummary,
    validation: validatePopulationShadowComparison(prevalidated)
  };
  return deepFreeze({
    ...withValidation,
    comparisonFingerprint: buildPopulationShadowComparisonFingerprint(withValidation)
  });
}

function validatePopulationShadowComparison(comparison = {}) {
  const errors = [];
  const warnings = [];
  const authorityViolations = [];
  const fingerprintViolations = [];
  const sourceReferenceViolations = [];
  const missing = REQUIRED_POPULATION_SHADOW_COMPARISON_FIELDS.filter((field) => {
    const value = comparison[field];
    return value === undefined || value === null || value === '';
  });

  for (const field of missing) errors.push(validationIssue('missing_required_field', `${field} is required.`, field));
  if (comparison.schemaVersion !== POPULATION_SHADOW_COMPARISON_SCHEMA_VERSION) errors.push(validationIssue('invalid_schema_version', 'schemaVersion must match Population Shadow Comparison schema.', 'schemaVersion'));
  if (comparison.source !== POPULATION_SHADOW_COMPARISON_SOURCE) errors.push(validationIssue('invalid_source', 'source must be population_shadow_comparison.', 'source'));
  if (!PARITY_STATUSES.includes(comparison.parityStatus)) errors.push(validationIssue('invalid_parity_status', `parityStatus must be one of: ${PARITY_STATUSES.join(', ')}`, 'parityStatus'));
  if (comparison.mismatchCount !== asArray(comparison.mismatches).length) errors.push(validationIssue('mismatch_count_mismatch', 'mismatchCount must match mismatches length.', 'mismatchCount'));

  for (const field of ['productionImpact', 'decisionImpact', 'executionAuthority']) {
    if (comparison[field] !== 'none') {
      errors.push(validationIssue('authority_boundary_violation', `${field} must remain none.`, field));
      authorityViolations.push(field);
    }
  }

  const artifacts = asObject(comparison.sourceArtifacts);
  if (artifacts.migration) {
    const migrationValidation = validatePopulationMigration(artifacts.migration);
    if (!migrationValidation.valid) errors.push(...migrationValidation.errors.map((error) => ({ ...error, field: `sourceArtifacts.migration.${error.field || ''}` })));
    warnings.push(...migrationValidation.warnings.map((warning) => ({ ...warning, field: `sourceArtifacts.migration.${warning.field || ''}` })));
    authorityViolations.push(...migrationValidation.authorityViolations.map((field) => `sourceArtifacts.migration.${field}`));
    fingerprintViolations.push(...migrationValidation.fingerprintViolations.map((field) => `sourceArtifacts.migration.${field}`));
    if (comparison.migrationFingerprint !== artifacts.migration.migrationFingerprint) {
      errors.push(validationIssue('migration_fingerprint_reference_mismatch', 'migrationFingerprint does not match source migration.', 'migrationFingerprint'));
      sourceReferenceViolations.push('migrationFingerprint');
    }
    if (artifacts.migration.migrationFingerprint && buildPopulationMigrationFingerprint(artifacts.migration) !== artifacts.migration.migrationFingerprint) {
      fingerprintViolations.push('sourceArtifacts.migration.migrationFingerprint');
    }
  }

  const signal = firstDefined(artifacts.canonicalSignal, artifacts.migration && artifacts.migration.canonicalSignal);
  const alignment = firstDefined(artifacts.alignment, artifacts.migration && artifacts.migration.alignment);
  const alignmentRun = firstDefined(artifacts.alignmentRun, artifacts.migration && artifacts.migration.alignmentRun);
  const alignmentReport = firstDefined(artifacts.alignmentReport, artifacts.migration && artifacts.migration.alignmentReport);

  if (signal && signal.signalFingerprint) {
    if (comparison.canonicalSignalFingerprint !== signal.signalFingerprint) {
      errors.push(validationIssue('canonical_signal_fingerprint_reference_mismatch', 'canonicalSignalFingerprint does not match source canonical signal.', 'canonicalSignalFingerprint'));
      sourceReferenceViolations.push('canonicalSignalFingerprint');
    }
    if (buildCanonicalSignalFingerprint(signal) !== signal.signalFingerprint) fingerprintViolations.push('sourceArtifacts.canonicalSignal.signalFingerprint');
  }
  if (alignment && alignment.alignmentFingerprint) {
    if (comparison.alignmentFingerprint !== alignment.alignmentFingerprint) {
      errors.push(validationIssue('alignment_fingerprint_reference_mismatch', 'alignmentFingerprint does not match source alignment.', 'alignmentFingerprint'));
      sourceReferenceViolations.push('alignmentFingerprint');
    }
    if (buildSignalAlignmentFingerprint(alignment) !== alignment.alignmentFingerprint) fingerprintViolations.push('sourceArtifacts.alignment.alignmentFingerprint');
  }
  if (alignmentRun && alignmentRun.runFingerprint && buildSignalAlignmentRunFingerprint(alignmentRun) !== alignmentRun.runFingerprint) {
    fingerprintViolations.push('sourceArtifacts.alignmentRun.runFingerprint');
  }
  if (alignmentReport && alignmentReport.reportFingerprint) {
    if (comparison.reportFingerprint !== alignmentReport.reportFingerprint) {
      errors.push(validationIssue('report_fingerprint_reference_mismatch', 'reportFingerprint does not match source alignment report.', 'reportFingerprint'));
      sourceReferenceViolations.push('reportFingerprint');
    }
    if (buildSignalAlignmentReportFingerprint(alignmentReport) !== alignmentReport.reportFingerprint) fingerprintViolations.push('sourceArtifacts.alignmentReport.reportFingerprint');
  }

  if (comparison.comparisonFingerprint && buildPopulationShadowComparisonFingerprint(comparison) !== comparison.comparisonFingerprint) {
    errors.push(validationIssue('comparison_fingerprint_mismatch', 'comparisonFingerprint does not match comparison contents.', 'comparisonFingerprint'));
    fingerprintViolations.push('comparisonFingerprint');
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
    fingerprintViolations: unique(fingerprintViolations).sort(),
    sourceReferenceViolations: unique(sourceReferenceViolations).sort()
  };
}

module.exports = {
  PARITY_STATUSES,
  POPULATION_SHADOW_COMPARISON_SCHEMA_VERSION,
  POPULATION_SHADOW_COMPARISON_SOURCE,
  REQUIRED_POPULATION_SHADOW_COMPARISON_FIELDS,
  buildPopulationShadowComparisonFingerprint,
  comparePopulationNativeToShadow,
  summarizePopulationShadowComparison,
  validatePopulationShadowComparison
};
