'use strict';

const { asArray, asObject, unique } = require('./canonicalValidationCore');
const { buildFingerprintFromProjection } = require('./fingerprintProjection');
const { clone, firstDefined } = require('./phase8GovernanceCore');
const { UNKNOWN_VALUE } = require('./canonicalIntelligenceSignalContract');
const {
  migrateConfidenceCalibrationSignal,
  validateConfidenceCalibrationMigration
} = require('./confidenceCalibrationSignalMigration');
const {
  executeSignalShadowComparisonLifecycle
} = require('./signalShadowComparisonCore');

const CONFIDENCE_CALIBRATION_SHADOW_COMPARISON_SCHEMA_VERSION = '1.0.0';
const CONFIDENCE_CALIBRATION_SHADOW_COMPARISON_SOURCE = 'confidence_calibration_shadow_comparison';

const PARITY_STATUSES = Object.freeze([
  'exact_match',
  'semantic_match',
  'mismatch',
  'incomplete',
  'invalid',
  'blocked'
]);

const REQUIRED_CONFIDENCE_CALIBRATION_SHADOW_COMPARISON_FIELDS = Object.freeze([
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

  for (const key of sortedObjectKeys(nativeOutput)) {
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
    if (!exists) mismatches.push(buildMismatch('missing_wrapper_field', key, 'Native field is missing from canonical raw output.', nativeValue, shadowValue));
    else if (!exactMatch) mismatches.push(buildMismatch('changed_native_field', key, 'Native field value changed in canonical raw output.', nativeValue, shadowValue));
  }

  for (const key of sortedObjectKeys(rawOutput)) {
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
  const evidence = asObject(nativeOutput.evidenceSupport);
  const outcomes = asObject(nativeOutput.availableOutcomeMetrics);
  const observed = asObject(nativeOutput.observedAgreementMetrics);
  const basis = asObject(canonicalSignal.evidenceBasis);
  const quality = asObject(canonicalSignal.evidenceQuality);
  const qualityBySupport = {
    strong: 'strong',
    adequate: 'adequate',
    limited: 'limited',
    weak: 'weak',
    unsupported: 'insufficient',
    unknown: UNKNOWN_VALUE
  };
  const expectedQuality = qualityBySupport[normalizeString(nativeOutput.confidenceSupportLevel)] || UNKNOWN_VALUE;
  const comparisons = [
    {
      field: 'trueSoldDepth',
      nativePath: 'evidenceSupport.trueSoldDepth',
      shadowPath: 'canonicalSignal.evidenceBasis.trueSoldCount',
      status: normalizeComparisonStatus(stableEqual(firstDefined(evidence.trueSoldDepth, UNKNOWN_VALUE), basis.trueSoldCount)),
      nativeValue: firstDefined(evidence.trueSoldDepth, UNKNOWN_VALUE),
      shadowValue: clone(basis.trueSoldCount)
    },
    {
      field: 'sampleSize',
      nativePath: 'availableOutcomeMetrics.sampleSize',
      shadowPath: 'canonicalSignal.evidenceBasis.details.sampleSize',
      status: normalizeComparisonStatus(stableEqual(firstDefined(outcomes.sampleSize, UNKNOWN_VALUE), asObject(basis.details).sampleSize)),
      nativeValue: firstDefined(outcomes.sampleSize, UNKNOWN_VALUE),
      shadowValue: clone(asObject(basis.details).sampleSize)
    },
    {
      field: 'observedAgreementRate',
      nativePath: 'observedAgreementMetrics.overallAgreementRate',
      shadowPath: 'canonicalSignal.evidenceBasis.details.observedAgreementRate',
      status: normalizeComparisonStatus(stableEqual(firstDefined(observed.overallAgreementRate, UNKNOWN_VALUE), asObject(basis.details).observedAgreementRate)),
      nativeValue: firstDefined(observed.overallAgreementRate, UNKNOWN_VALUE),
      shadowValue: clone(asObject(basis.details).observedAgreementRate)
    },
    {
      field: 'evidenceQuality',
      nativePath: 'confidenceSupportLevel',
      shadowPath: 'canonicalSignal.evidenceQuality.level',
      status: normalizeComparisonStatus(stableEqual(expectedQuality, quality.level), String(expectedQuality) === String(quality.level)),
      nativeValue: normalizeString(nativeOutput.confidenceSupportLevel),
      shadowValue: clone(quality.level)
    }
  ];
  const mismatches = comparisons
    .filter((comparison) => !['exact_match', 'semantic_match'].includes(comparison.status))
    .map((comparison) => buildMismatch('changed_evidence_value', comparison.field, 'Evidence or reviewed-outcome representation differs between native and shadow wrapper.', comparison.nativeValue, comparison.shadowValue));
  return {
    status: mismatches.length ? 'mismatch' : (comparisons.some((item) => item.status === 'semantic_match') ? 'semantic_match' : 'exact_match'),
    comparisons,
    mismatches
  };
}

function compareConfidence(nativeOutput = {}, canonicalSignal = {}, alignment = {}) {
  const reported = asObject(nativeOutput.reportedConfidence);
  const cap = asObject(nativeOutput.recommendedConfidenceCap);
  const confidence = asObject(canonicalSignal.confidence);
  const comparisons = [
    {
      field: 'reportedConfidence',
      nativePath: 'reportedConfidence.confidence',
      shadowPath: 'canonicalSignal.confidence.value',
      status: normalizeComparisonStatus(
        stableEqual(firstDefined(reported.confidence, UNKNOWN_VALUE), confidence.value),
        String(firstDefined(reported.confidence, UNKNOWN_VALUE)) === String(confidence.value)
      ),
      nativeValue: firstDefined(reported.confidence, UNKNOWN_VALUE),
      shadowValue: clone(confidence.value),
      semanticReason: 'reported_confidence_wrapped_as_canonical_confidence_value'
    },
    {
      field: 'recommendedConfidenceCap',
      nativePath: 'recommendedConfidenceCap.recommendedCap',
      shadowPath: 'canonicalSignal.normalizedOutput.recommendedConfidenceCap.recommendedCap',
      status: normalizeComparisonStatus(
        stableEqual(firstDefined(cap.recommendedCap, UNKNOWN_VALUE), asObject(asObject(canonicalSignal.normalizedOutput).recommendedConfidenceCap).recommendedCap),
        String(firstDefined(cap.recommendedCap, UNKNOWN_VALUE)) === String(asObject(asObject(canonicalSignal.normalizedOutput).recommendedConfidenceCap).recommendedCap)
      ),
      nativeValue: firstDefined(cap.recommendedCap, UNKNOWN_VALUE),
      shadowValue: clone(asObject(asObject(canonicalSignal.normalizedOutput).recommendedConfidenceCap).recommendedCap)
    },
    {
      field: 'confidenceAlignment',
      nativePath: 'schemaVersion',
      shadowPath: 'alignment.confidenceAlignment.status',
      status: ['aligned', UNKNOWN_VALUE].includes(normalizeString(asObject(alignment.confidenceAlignment).status)) ? 'semantic_match' : 'mismatch',
      nativeValue: normalizeString(nativeOutput.schemaVersion),
      shadowValue: clone(asObject(alignment.confidenceAlignment).status)
    }
  ];
  const mismatches = comparisons
    .filter((comparison) => !['exact_match', 'semantic_match'].includes(comparison.status))
    .map((comparison) => buildMismatch('changed_confidence_value', comparison.field, 'Confidence representation differs between native and shadow wrapper.', comparison.nativeValue, comparison.shadowValue));
  return {
    status: mismatches.length ? 'mismatch' : (comparisons.some((item) => item.status === 'semantic_match') ? 'semantic_match' : 'exact_match'),
    comparisons,
    mismatches
  };
}

function compareStatus(nativeOutput = {}, canonicalSignal = {}, alignment = {}, alignmentReport = {}) {
  const normalized = asObject(canonicalSignal.normalizedOutput);
  const comparisons = [
    {
      field: 'calibrationStatus',
      nativePath: 'calibrationStatus',
      shadowPath: 'canonicalSignal.normalizedOutput.status',
      status: normalizeComparisonStatus(stableEqual(normalizeString(nativeOutput.calibrationStatus), normalized.status)),
      nativeValue: normalizeString(nativeOutput.calibrationStatus),
      shadowValue: clone(normalized.status)
    },
    {
      field: 'alignmentStatus',
      nativePath: 'schemaVersion',
      shadowPath: 'alignment.alignmentStatus',
      status: ['aligned', 'definition_missing', 'version_mismatch', UNKNOWN_VALUE].includes(normalizeString(alignment.alignmentStatus)) ? 'semantic_match' : 'mismatch',
      nativeValue: normalizeString(nativeOutput.schemaVersion),
      shadowValue: clone(alignment.alignmentStatus)
    },
    {
      field: 'reportStatus',
      nativePath: 'source',
      shadowPath: 'alignmentReport.reviewStatus',
      status: ['unreviewed', 'review_pending', 'reviewed', 'needs_follow_up', 'invalid', UNKNOWN_VALUE].includes(normalizeString(alignmentReport.reviewStatus)) ? 'semantic_match' : 'mismatch',
      nativeValue: normalizeString(nativeOutput.source),
      shadowValue: clone(alignmentReport.reviewStatus)
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

function compareMetadata(nativeOutput = {}, canonicalSignal = {}) {
  const metadata = asObject(canonicalSignal.metadata);
  const comparisons = [
    {
      field: 'nativeSource',
      nativePath: 'source',
      shadowPath: 'canonicalSignal.metadata.nativeSource',
      status: normalizeComparisonStatus(stableEqual(normalizeString(nativeOutput.source), metadata.nativeSource)),
      nativeValue: normalizeString(nativeOutput.source),
      shadowValue: clone(metadata.nativeSource)
    },
    {
      field: 'nativeVersion',
      nativePath: 'schemaVersion',
      shadowPath: 'canonicalSignal.metadata.nativeVersion',
      status: normalizeComparisonStatus(stableEqual(normalizeString(nativeOutput.schemaVersion), metadata.nativeVersion)),
      nativeValue: normalizeString(nativeOutput.schemaVersion),
      shadowValue: clone(metadata.nativeVersion)
    }
  ];
  const mismatches = comparisons
    .filter((comparison) => !['exact_match', 'semantic_match'].includes(comparison.status))
    .map((comparison) => buildMismatch('changed_metadata_value', comparison.field, 'Metadata representation differs between native and shadow wrapper.', comparison.nativeValue, comparison.shadowValue));
  return {
    status: mismatches.length ? 'mismatch' : 'exact_match',
    comparisons,
    mismatches
  };
}

function compareUnknownValues(nativeOutput = {}, canonicalSignal = {}) {
  const comparisons = [
    {
      field: 'calibrationGap',
      nativePath: 'calibrationGap.gap',
      shadowPath: 'canonicalSignal.normalizedOutput.calibrationGap',
      status: normalizeComparisonStatus(
        stableEqual(
          firstDefined(asObject(nativeOutput.calibrationGap).gap, UNKNOWN_VALUE),
          asObject(canonicalSignal.normalizedOutput).calibrationGap
        )
      ),
      nativeValue: firstDefined(asObject(nativeOutput.calibrationGap).gap, UNKNOWN_VALUE),
      shadowValue: clone(asObject(canonicalSignal.normalizedOutput).calibrationGap)
    }
  ];
  const mismatches = comparisons
    .filter((comparison) => comparison.status === 'mismatch')
    .map((comparison) => buildMismatch('changed_unknown_value', comparison.field, 'Unknown value preservation differs between native and shadow wrapper.', comparison.nativeValue, comparison.shadowValue));
  return {
    status: mismatches.length ? 'mismatch' : 'exact_match',
    comparisons,
    mismatches
  };
}

function determineParityStatus(parts = {}, validationState = {}) {
  if (!validationState.migrationValid || !validationState.signalValid || !validationState.alignmentValid || !validationState.runValid || !validationState.reportValid) return 'invalid';
  if (asArray(parts.mismatches).length > 0) return 'mismatch';
  if ([parts.evidenceComparison, parts.confidenceComparison, parts.statusComparison].some((part) => part && part.status === 'semantic_match')) return 'semantic_match';
  return 'exact_match';
}

function summarizeConfidenceCalibrationShadowComparison(comparison = {}) {
  return deepFreeze({
    schemaVersion: CONFIDENCE_CALIBRATION_SHADOW_COMPARISON_SCHEMA_VERSION,
    comparisonId: normalizeString(comparison.comparisonId),
    parityStatus: normalizeString(comparison.parityStatus),
    mismatchCount: Number(firstDefined(comparison.mismatchCount, 0)),
    fieldComparisonCount: asArray(comparison.fieldComparisons).length,
    evidenceStatus: normalizeString(comparison.evidenceComparison && comparison.evidenceComparison.status),
    confidenceStatus: normalizeString(comparison.confidenceComparison && comparison.confidenceComparison.status),
    statusComparisonStatus: normalizeString(comparison.statusComparison && comparison.statusComparison.status),
    metadataStatus: normalizeString(comparison.metadataComparison && comparison.metadataComparison.status),
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  });
}

function buildConfidenceCalibrationShadowComparisonFingerprint(comparison = {}) {
  const projection = clone(comparison);
  delete projection.comparisonFingerprint;
  delete projection.confidenceCalibrationShadowComparisonFingerprint;
  return buildFingerprintFromProjection(projection);
}

function validateConfidenceCalibrationShadowComparison(comparison = {}) {
  const errors = [];
  const warnings = [];
  const authorityViolations = [];
  const fingerprintViolations = [];
  const missing = REQUIRED_CONFIDENCE_CALIBRATION_SHADOW_COMPARISON_FIELDS.filter((field) => {
    const value = comparison[field];
    return value === undefined || value === null || value === '';
  });

  for (const field of missing) errors.push(validationIssue('missing_required_field', `${field} is required.`, field));
  if (comparison.schemaVersion !== CONFIDENCE_CALIBRATION_SHADOW_COMPARISON_SCHEMA_VERSION) errors.push(validationIssue('invalid_schema_version', 'schemaVersion must match Confidence Calibration Shadow Comparison schema.', 'schemaVersion'));
  if (comparison.source !== CONFIDENCE_CALIBRATION_SHADOW_COMPARISON_SOURCE) errors.push(validationIssue('invalid_source', 'source must be confidence_calibration_shadow_comparison.', 'source'));
  if (!PARITY_STATUSES.includes(comparison.parityStatus)) errors.push(validationIssue('invalid_parity_status', `parityStatus must be one of: ${PARITY_STATUSES.join(', ')}`, 'parityStatus'));

  for (const field of ['productionImpact', 'decisionImpact', 'executionAuthority']) {
    if (comparison[field] !== 'none') {
      errors.push(validationIssue('authority_boundary_violation', `${field} must remain none.`, field));
      authorityViolations.push(field);
    }
  }

  const migrationValidation = validateConfidenceCalibrationMigration(asObject(asObject(comparison.sourceArtifacts).migration));
  if (!migrationValidation.valid) errors.push(...asArray(migrationValidation.errors).map((error) => ({ ...error, field: `migration.${error.field || ''}` })));
  warnings.push(...asArray(migrationValidation.warnings).map((warning) => ({ ...warning, field: `migration.${warning.field || ''}` })));
  authorityViolations.push(...asArray(migrationValidation.authorityViolations).map((field) => `migration.${field}`));
  fingerprintViolations.push(...asArray(migrationValidation.fingerprintViolations).map((field) => `migration.${field}`));

  if (comparison.mismatchCount !== asArray(comparison.mismatches).length) {
    errors.push(validationIssue('mismatch_count_mismatch', 'mismatchCount must match mismatches length.', 'mismatchCount'));
  }
  if (comparison.comparisonFingerprint && buildConfidenceCalibrationShadowComparisonFingerprint(comparison) !== comparison.comparisonFingerprint) {
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
    sourceReferenceViolations: []
  };
}

function compareConfidenceCalibrationNativeToShadow(input = {}, options = {}) {
  return executeSignalShadowComparisonLifecycle(input, options, {
    schemaVersion: CONFIDENCE_CALIBRATION_SHADOW_COMPARISON_SCHEMA_VERSION,
    comparisonSource: CONFIDENCE_CALIBRATION_SHADOW_COMPARISON_SOURCE,
    migrationAliases: ['confidenceCalibrationMigration'],
    defaultComparisonIdPrefix: 'confidence-calibration-shadow-comparison',
    comparisonScope: 'confidence_calibration_native_to_phase_13_shadow',
    migrate: migrateConfidenceCalibrationSignal,
    compareNativeFields,
    compareEvidence,
    compareConfidence,
    compareStatus,
    compareMetadata,
    compareUnknownValues,
    determineParityStatus,
    validateMigration: validateConfidenceCalibrationMigration,
    summarizeComparison: summarizeConfidenceCalibrationShadowComparison,
    validateComparison: validateConfidenceCalibrationShadowComparison,
    buildComparisonFingerprint: buildConfidenceCalibrationShadowComparisonFingerprint
  });
}

module.exports = {
  CONFIDENCE_CALIBRATION_SHADOW_COMPARISON_SCHEMA_VERSION,
  CONFIDENCE_CALIBRATION_SHADOW_COMPARISON_SOURCE,
  PARITY_STATUSES,
  REQUIRED_CONFIDENCE_CALIBRATION_SHADOW_COMPARISON_FIELDS,
  buildConfidenceCalibrationShadowComparisonFingerprint,
  compareConfidenceCalibrationNativeToShadow,
  summarizeConfidenceCalibrationShadowComparison,
  validateConfidenceCalibrationShadowComparison
};
