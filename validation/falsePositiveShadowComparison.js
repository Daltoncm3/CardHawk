'use strict';

const { asArray, asObject, unique } = require('./canonicalValidationCore');
const { buildFingerprintFromProjection } = require('./fingerprintProjection');
const { clone, firstDefined } = require('./phase8GovernanceCore');
const { UNKNOWN_VALUE } = require('./canonicalIntelligenceSignalContract');
const {
  migrateFalsePositiveSignal,
  validateFalsePositiveMigration
} = require('./falsePositiveSignalMigration');
const { executeSignalShadowComparisonLifecycle } = require('./signalShadowComparisonCore');

const FALSE_POSITIVE_SHADOW_COMPARISON_SCHEMA_VERSION = '1.0.0';
const FALSE_POSITIVE_SHADOW_COMPARISON_SOURCE = 'false_positive_shadow_comparison';

const PARITY_STATUSES = Object.freeze([
  'exact_match',
  'semantic_match',
  'mismatch',
  'incomplete',
  'invalid',
  'blocked'
]);

const REQUIRED_FALSE_POSITIVE_SHADOW_COMPARISON_FIELDS = Object.freeze([
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

function normalizeComparisonStatus(match, semanticMatch = false) {
  if (match) return 'exact_match';
  if (semanticMatch) return 'semantic_match';
  return 'mismatch';
}

function sortedObjectKeys(value = {}) {
  return Object.keys(asObject(value)).sort((left, right) => left.localeCompare(right));
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

function expectedEvidenceQuality(nativeOutput = {}) {
  const level = normalizeString(nativeOutput.falsePositiveRiskLevel);
  if (level === 'critical' || level === 'high') return 'strong';
  if (level === 'moderate') return 'adequate';
  if (level === 'low') return 'limited';
  return UNKNOWN_VALUE;
}

function expectedRiskScore(nativeOutput = {}) {
  const level = normalizeString(nativeOutput.falsePositiveRiskLevel);
  if (level === 'critical') return 95;
  if (level === 'high') return 80;
  if (level === 'moderate') return 55;
  if (level === 'low') return 20;
  return UNKNOWN_VALUE;
}

function compareEvidence(nativeOutput = {}, canonicalSignal = {}) {
  const evidenceBasis = asObject(canonicalSignal.evidenceBasis);
  const details = asObject(evidenceBasis.details);
  const evidenceQuality = asObject(canonicalSignal.evidenceQuality);
  const comparisons = [
    {
      field: 'criticalBlockerCount',
      nativePath: 'criticalBlockers.length',
      shadowPath: 'canonicalSignal.evidenceBasis.rejectedCount',
      status: normalizeComparisonStatus(stableEqual(asArray(nativeOutput.criticalBlockers).length, evidenceBasis.rejectedCount)),
      nativeValue: asArray(nativeOutput.criticalBlockers).length,
      shadowValue: clone(evidenceBasis.rejectedCount)
    },
    {
      field: 'materialWarningCount',
      nativePath: 'materialWarnings.length',
      shadowPath: 'canonicalSignal.evidenceBasis.details.materialWarningCount',
      status: normalizeComparisonStatus(stableEqual(asArray(nativeOutput.materialWarnings).length, details.materialWarningCount)),
      nativeValue: asArray(nativeOutput.materialWarnings).length,
      shadowValue: clone(details.materialWarningCount)
    },
    {
      field: 'conflictingSignalCount',
      nativePath: 'conflictingSignals.length',
      shadowPath: 'canonicalSignal.evidenceBasis.details.conflictingSignalCount',
      status: normalizeComparisonStatus(stableEqual(asArray(nativeOutput.conflictingSignals).length, details.conflictingSignalCount)),
      nativeValue: asArray(nativeOutput.conflictingSignals).length,
      shadowValue: clone(details.conflictingSignalCount)
    },
    {
      field: 'evidenceQuality',
      nativePath: 'falsePositiveRiskLevel',
      shadowPath: 'canonicalSignal.evidenceQuality.level',
      status: normalizeComparisonStatus(stableEqual(expectedEvidenceQuality(nativeOutput), evidenceQuality.level), String(expectedEvidenceQuality(nativeOutput)) === String(evidenceQuality.level)),
      nativeValue: normalizeString(nativeOutput.falsePositiveRiskLevel),
      shadowValue: clone(evidenceQuality.level)
    }
  ];
  const mismatches = comparisons
    .filter((comparison) => !['exact_match', 'semantic_match'].includes(comparison.status))
    .map((comparison) => buildMismatch('changed_evidence_value', comparison.field, 'False-positive diagnostic evidence representation differs between native and shadow wrapper.', comparison.nativeValue, comparison.shadowValue));
  return {
    status: mismatches.length ? 'mismatch' : (comparisons.some((item) => item.status === 'semantic_match') ? 'semantic_match' : 'exact_match'),
    comparisons,
    mismatches
  };
}

function compareConfidence(nativeOutput = {}, canonicalSignal = {}, alignment = {}) {
  const confidence = asObject(canonicalSignal.confidence);
  const nativeValue = expectedRiskScore(nativeOutput);
  const comparisons = [
    {
      field: 'falsePositiveDiagnosticRiskScore',
      nativePath: 'falsePositiveRiskLevel',
      shadowPath: 'canonicalSignal.confidence.value',
      status: normalizeComparisonStatus(stableEqual(nativeValue, confidence.value), String(nativeValue) === String(confidence.value)),
      nativeValue: clone(nativeValue),
      shadowValue: clone(confidence.value),
      semanticReason: 'false_positive_risk_level_is_wrapped_as_diagnostic_risk_strength'
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
  const buyNow = asObject(nativeOutput.buyNowEligibility);
  const comparisons = [
    {
      field: 'falsePositiveRiskStatus',
      nativePath: 'falsePositiveRiskStatus',
      shadowPath: 'canonicalSignal.normalizedOutput.status',
      status: normalizeComparisonStatus(stableEqual(normalizeString(nativeOutput.falsePositiveRiskStatus), normalized.status)),
      nativeValue: normalizeString(nativeOutput.falsePositiveRiskStatus),
      shadowValue: clone(normalized.status)
    },
    {
      field: 'falsePositiveRiskLevel',
      nativePath: 'falsePositiveRiskLevel',
      shadowPath: 'canonicalSignal.normalizedOutput.riskLevel',
      status: normalizeComparisonStatus(stableEqual(normalizeString(nativeOutput.falsePositiveRiskLevel), normalized.riskLevel)),
      nativeValue: normalizeString(nativeOutput.falsePositiveRiskLevel),
      shadowValue: clone(normalized.riskLevel)
    },
    {
      field: 'buyNowEligible',
      nativePath: 'buyNowEligibility.eligible',
      shadowPath: 'canonicalSignal.normalizedOutput.buyNowEligible',
      status: normalizeComparisonStatus(stableEqual(firstDefined(buyNow.eligible, UNKNOWN_VALUE), normalized.buyNowEligible)),
      nativeValue: firstDefined(buyNow.eligible, UNKNOWN_VALUE),
      shadowValue: clone(normalized.buyNowEligible)
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
  const normalized = asObject(canonicalSignal.normalizedOutput);
  const buyNow = asObject(nativeOutput.buyNowEligibility);
  const comparisons = [
    {
      field: 'buyNowEligible',
      nativePath: 'buyNowEligibility.eligible',
      shadowPath: 'canonicalSignal.normalizedOutput.buyNowEligible',
      status: normalizeComparisonStatus(stableEqual(firstDefined(buyNow.eligible, UNKNOWN_VALUE), normalized.buyNowEligible)),
      nativeValue: firstDefined(buyNow.eligible, UNKNOWN_VALUE),
      shadowValue: clone(normalized.buyNowEligible)
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

function summarizeFalsePositiveShadowComparison(comparison = {}) {
  return deepFreeze({
    schemaVersion: FALSE_POSITIVE_SHADOW_COMPARISON_SCHEMA_VERSION,
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

function buildFalsePositiveShadowComparisonFingerprint(comparison = {}) {
  const projection = clone(comparison);
  delete projection.comparisonFingerprint;
  delete projection.falsePositiveShadowComparisonFingerprint;
  return buildFingerprintFromProjection(projection);
}

function validateFalsePositiveShadowComparison(comparison = {}) {
  const errors = [];
  const warnings = [];
  const authorityViolations = [];
  const fingerprintViolations = [];
  const missing = REQUIRED_FALSE_POSITIVE_SHADOW_COMPARISON_FIELDS.filter((field) => {
    const value = comparison[field];
    return value === undefined || value === null || value === '';
  });

  for (const field of missing) errors.push(validationIssue('missing_required_field', `${field} is required.`, field));
  if (comparison.schemaVersion !== FALSE_POSITIVE_SHADOW_COMPARISON_SCHEMA_VERSION) errors.push(validationIssue('invalid_schema_version', 'schemaVersion must match False-Positive Shadow Comparison schema.', 'schemaVersion'));
  if (comparison.source !== FALSE_POSITIVE_SHADOW_COMPARISON_SOURCE) errors.push(validationIssue('invalid_source', 'source must be false_positive_shadow_comparison.', 'source'));
  if (!PARITY_STATUSES.includes(comparison.parityStatus)) errors.push(validationIssue('invalid_parity_status', `parityStatus must be one of: ${PARITY_STATUSES.join(', ')}`, 'parityStatus'));

  for (const field of ['productionImpact', 'decisionImpact', 'executionAuthority']) {
    if (comparison[field] !== 'none') {
      errors.push(validationIssue('authority_boundary_violation', `${field} must remain none.`, field));
      authorityViolations.push(field);
    }
  }

  const migrationValidation = validateFalsePositiveMigration(asObject(asObject(comparison.sourceArtifacts).migration));
  if (!migrationValidation.valid) errors.push(...asArray(migrationValidation.errors).map((error) => ({ ...error, field: `migration.${error.field || ''}` })));
  warnings.push(...asArray(migrationValidation.warnings).map((warning) => ({ ...warning, field: `migration.${warning.field || ''}` })));
  authorityViolations.push(...asArray(migrationValidation.authorityViolations).map((field) => `migration.${field}`));
  fingerprintViolations.push(...asArray(migrationValidation.fingerprintViolations).map((field) => `migration.${field}`));

  if (comparison.mismatchCount !== asArray(comparison.mismatches).length) {
    errors.push(validationIssue('mismatch_count_mismatch', 'mismatchCount must match mismatches length.', 'mismatchCount'));
  }
  if (comparison.comparisonFingerprint && buildFalsePositiveShadowComparisonFingerprint(comparison) !== comparison.comparisonFingerprint) {
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

function compareFalsePositiveNativeToShadow(input = {}, options = {}) {
  return executeSignalShadowComparisonLifecycle(input, options, {
    schemaVersion: FALSE_POSITIVE_SHADOW_COMPARISON_SCHEMA_VERSION,
    comparisonSource: FALSE_POSITIVE_SHADOW_COMPARISON_SOURCE,
    migrationAliases: ['falsePositiveMigration', 'opportunityFalsePositiveMigration'],
    defaultComparisonIdPrefix: 'false-positive-shadow-comparison',
    comparisonScope: 'false_positive_native_to_phase_13_shadow',
    migrate: migrateFalsePositiveSignal,
    compareNativeFields,
    compareEvidence,
    compareConfidence,
    compareStatus,
    compareMetadata,
    compareUnknownValues,
    determineParityStatus,
    validateMigration: validateFalsePositiveMigration,
    summarizeComparison: summarizeFalsePositiveShadowComparison,
    validateComparison: validateFalsePositiveShadowComparison,
    buildComparisonFingerprint: buildFalsePositiveShadowComparisonFingerprint
  });
}

module.exports = {
  FALSE_POSITIVE_SHADOW_COMPARISON_SCHEMA_VERSION,
  FALSE_POSITIVE_SHADOW_COMPARISON_SOURCE,
  PARITY_STATUSES,
  REQUIRED_FALSE_POSITIVE_SHADOW_COMPARISON_FIELDS,
  buildFalsePositiveShadowComparisonFingerprint,
  compareFalsePositiveNativeToShadow,
  summarizeFalsePositiveShadowComparison,
  validateFalsePositiveShadowComparison
};
