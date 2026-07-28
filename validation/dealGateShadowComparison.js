'use strict';

const { asArray, asObject, unique } = require('./canonicalValidationCore');
const { buildFingerprintFromProjection } = require('./fingerprintProjection');
const { clone, firstDefined } = require('./phase8GovernanceCore');
const { UNKNOWN_VALUE } = require('./canonicalIntelligenceSignalContract');
const {
  migrateDealGateSignal,
  validateDealGateMigration
} = require('./dealGateSignalMigration');
const {
  executeSignalShadowComparisonLifecycle
} = require('./signalShadowComparisonCore');

const DEAL_GATE_SHADOW_COMPARISON_SCHEMA_VERSION = '1.0.0';
const DEAL_GATE_SHADOW_COMPARISON_SOURCE = 'deal_gate_shadow_comparison';

const PARITY_STATUSES = Object.freeze([
  'exact_match',
  'semantic_match',
  'mismatch',
  'incomplete',
  'invalid',
  'blocked'
]);

const REQUIRED_DEAL_GATE_SHADOW_COMPARISON_FIELDS = Object.freeze([
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

function gateSummary(nativeOutput = {}) {
  return asObject(firstDefined(nativeOutput.gate, nativeOutput.gateInputs, nativeOutput.thresholdSummary, {}));
}

function dealGateBreakdown(nativeOutput = {}) {
  return asObject(firstDefined(nativeOutput.dealGateBreakdown, nativeOutput.breakdown, nativeOutput.ruleBreakdown, {}));
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
  const gate = gateSummary(nativeOutput);
  const breakdown = dealGateBreakdown(nativeOutput);
  const basis = asObject(canonicalSignal.evidenceBasis);
  const quality = asObject(canonicalSignal.evidenceQuality);
  const soldCount = firstDefined(gate.soldCompCount, gate.trueSoldCompCount, UNKNOWN_VALUE);
  const expectedQuality = Number(soldCount) >= 5 ? 'strong' :
    Number(soldCount) >= 3 ? 'adequate' :
      Number(soldCount) >= 1 ? 'limited' :
        Number(soldCount) === 0 ? 'insufficient' : UNKNOWN_VALUE;
  const comparisons = [
    {
      field: 'soldCompCount',
      nativePath: 'gate.soldCompCount',
      shadowPath: 'canonicalSignal.evidenceBasis.trueSoldCount',
      status: normalizeComparisonStatus(stableEqual(soldCount, basis.trueSoldCount), String(soldCount) === String(basis.trueSoldCount)),
      nativeValue: clone(soldCount),
      shadowValue: clone(basis.trueSoldCount)
    },
    {
      field: 'failedRuleCount',
      nativePath: 'dealGateBreakdown.failedRules.length',
      shadowPath: 'canonicalSignal.evidenceBasis.details.failedRuleCount',
      status: normalizeComparisonStatus(stableEqual(asArray(firstDefined(breakdown.failedRules, nativeOutput.failedRules)).length, asObject(basis.details).failedRuleCount)),
      nativeValue: asArray(firstDefined(breakdown.failedRules, nativeOutput.failedRules)).length,
      shadowValue: clone(asObject(basis.details).failedRuleCount)
    },
    {
      field: 'evidenceQuality',
      nativePath: 'gate.soldCompCount',
      shadowPath: 'canonicalSignal.evidenceQuality.level',
      status: normalizeComparisonStatus(stableEqual(expectedQuality, quality.level), String(expectedQuality) === String(quality.level)),
      nativeValue: clone(soldCount),
      shadowValue: clone(quality.level)
    }
  ];
  const mismatches = comparisons
    .filter((comparison) => !['exact_match', 'semantic_match'].includes(comparison.status))
    .map((comparison) => buildMismatch('changed_evidence_value', comparison.field, 'Deal Gate evidence or threshold context differs between native and shadow wrapper.', comparison.nativeValue, comparison.shadowValue));
  return {
    status: mismatches.length ? 'mismatch' : (comparisons.some((item) => item.status === 'semantic_match') ? 'semantic_match' : 'exact_match'),
    comparisons,
    mismatches
  };
}

function compareConfidence(nativeOutput = {}, canonicalSignal = {}, alignment = {}) {
  const gate = gateSummary(nativeOutput);
  const confidence = asObject(canonicalSignal.confidence);
  const nativeValue = firstDefined(gate.confidenceScore, UNKNOWN_VALUE);
  const comparisons = [
    {
      field: 'confidenceScore',
      nativePath: 'gate.confidenceScore',
      shadowPath: 'canonicalSignal.confidence.value',
      status: normalizeComparisonStatus(stableEqual(nativeValue, confidence.value), String(nativeValue) === String(confidence.value)),
      nativeValue: clone(nativeValue),
      shadowValue: clone(confidence.value)
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
    .map((comparison) => buildMismatch('changed_confidence_value', comparison.field, 'Deal Gate confidence representation differs between native and shadow wrapper.', comparison.nativeValue, comparison.shadowValue));
  return {
    status: mismatches.length ? 'mismatch' : (comparisons.some((item) => item.status === 'semantic_match') ? 'semantic_match' : 'exact_match'),
    comparisons,
    mismatches
  };
}

function compareStatus(nativeOutput = {}, canonicalSignal = {}, alignment = {}, alignmentReport = {}) {
  const normalized = asObject(canonicalSignal.normalizedOutput);
  const expectedStatus = nativeOutput.passed === true ? 'passed' : nativeOutput.passed === false ? 'rejected' : UNKNOWN_VALUE;
  const comparisons = [
    {
      field: 'passed',
      nativePath: 'passed',
      shadowPath: 'canonicalSignal.normalizedOutput.passed',
      status: normalizeComparisonStatus(stableEqual(firstDefined(nativeOutput.passed, UNKNOWN_VALUE), normalized.passed)),
      nativeValue: firstDefined(nativeOutput.passed, UNKNOWN_VALUE),
      shadowValue: clone(normalized.passed)
    },
    {
      field: 'status',
      nativePath: 'passed',
      shadowPath: 'canonicalSignal.normalizedOutput.status',
      status: normalizeComparisonStatus(stableEqual(expectedStatus, normalized.status), String(expectedStatus) === String(normalized.status)),
      nativeValue: firstDefined(nativeOutput.passed, UNKNOWN_VALUE),
      shadowValue: clone(normalized.status)
    },
    {
      field: 'decision',
      nativePath: 'decision',
      shadowPath: 'canonicalSignal.normalizedOutput.decision',
      status: normalizeComparisonStatus(stableEqual(normalizeString(firstDefined(nativeOutput.decision, nativeOutput.recommendation)), normalized.decision)),
      nativeValue: normalizeString(firstDefined(nativeOutput.decision, nativeOutput.recommendation)),
      shadowValue: clone(normalized.decision)
    },
    {
      field: 'buyNowAllowed',
      nativePath: 'buyNowAllowed',
      shadowPath: 'canonicalSignal.normalizedOutput.buyNowAllowed',
      status: normalizeComparisonStatus(stableEqual(firstDefined(nativeOutput.buyNowAllowed, UNKNOWN_VALUE), normalized.buyNowAllowed)),
      nativeValue: firstDefined(nativeOutput.buyNowAllowed, UNKNOWN_VALUE),
      shadowValue: clone(normalized.buyNowAllowed)
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
    .map((comparison) => buildMismatch('changed_status_value', comparison.field, 'Deal Gate decision status differs between native and shadow wrapper.', comparison.nativeValue, comparison.shadowValue));
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
    .map((comparison) => buildMismatch('changed_metadata_value', comparison.field, 'Deal Gate metadata representation differs between native and shadow wrapper.', comparison.nativeValue, comparison.shadowValue));
  return {
    status: mismatches.length ? 'mismatch' : 'exact_match',
    comparisons,
    mismatches
  };
}

function compareUnknownValues(nativeOutput = {}, canonicalSignal = {}) {
  const comparisons = [
    {
      field: 'buyNowAllowed',
      nativePath: 'buyNowAllowed',
      shadowPath: 'canonicalSignal.normalizedOutput.buyNowAllowed',
      status: normalizeComparisonStatus(
        stableEqual(firstDefined(nativeOutput.buyNowAllowed, UNKNOWN_VALUE), asObject(canonicalSignal.normalizedOutput).buyNowAllowed)
      ),
      nativeValue: firstDefined(nativeOutput.buyNowAllowed, UNKNOWN_VALUE),
      shadowValue: clone(asObject(canonicalSignal.normalizedOutput).buyNowAllowed)
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

function summarizeDealGateShadowComparison(comparison = {}) {
  return deepFreeze({
    schemaVersion: DEAL_GATE_SHADOW_COMPARISON_SCHEMA_VERSION,
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

function buildDealGateShadowComparisonFingerprint(comparison = {}) {
  const projection = clone(comparison);
  delete projection.comparisonFingerprint;
  delete projection.dealGateShadowComparisonFingerprint;
  return buildFingerprintFromProjection(projection);
}

function validateDealGateShadowComparison(comparison = {}) {
  const errors = [];
  const warnings = [];
  const authorityViolations = [];
  const fingerprintViolations = [];
  const missing = REQUIRED_DEAL_GATE_SHADOW_COMPARISON_FIELDS.filter((field) => {
    const value = comparison[field];
    return value === undefined || value === null || value === '';
  });

  for (const field of missing) errors.push(validationIssue('missing_required_field', `${field} is required.`, field));
  if (comparison.schemaVersion !== DEAL_GATE_SHADOW_COMPARISON_SCHEMA_VERSION) errors.push(validationIssue('invalid_schema_version', 'schemaVersion must match Deal Gate Shadow Comparison schema.', 'schemaVersion'));
  if (comparison.source !== DEAL_GATE_SHADOW_COMPARISON_SOURCE) errors.push(validationIssue('invalid_source', 'source must be deal_gate_shadow_comparison.', 'source'));
  if (!PARITY_STATUSES.includes(comparison.parityStatus)) errors.push(validationIssue('invalid_parity_status', `parityStatus must be one of: ${PARITY_STATUSES.join(', ')}`, 'parityStatus'));

  for (const field of ['productionImpact', 'decisionImpact', 'executionAuthority']) {
    if (comparison[field] !== 'none') {
      errors.push(validationIssue('authority_boundary_violation', `${field} must remain none.`, field));
      authorityViolations.push(field);
    }
  }

  const migrationValidation = validateDealGateMigration(asObject(asObject(comparison.sourceArtifacts).migration));
  if (!migrationValidation.valid) errors.push(...asArray(migrationValidation.errors).map((error) => ({ ...error, field: `migration.${error.field || ''}` })));
  warnings.push(...asArray(migrationValidation.warnings).map((warning) => ({ ...warning, field: `migration.${warning.field || ''}` })));
  authorityViolations.push(...asArray(migrationValidation.authorityViolations).map((field) => `migration.${field}`));
  fingerprintViolations.push(...asArray(migrationValidation.fingerprintViolations).map((field) => `migration.${field}`));

  if (comparison.mismatchCount !== asArray(comparison.mismatches).length) {
    errors.push(validationIssue('mismatch_count_mismatch', 'mismatchCount must match mismatches length.', 'mismatchCount'));
  }
  if (comparison.comparisonFingerprint && buildDealGateShadowComparisonFingerprint(comparison) !== comparison.comparisonFingerprint) {
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

function compareDealGateNativeToShadow(input = {}, options = {}) {
  return executeSignalShadowComparisonLifecycle(input, options, {
    schemaVersion: DEAL_GATE_SHADOW_COMPARISON_SCHEMA_VERSION,
    comparisonSource: DEAL_GATE_SHADOW_COMPARISON_SOURCE,
    migrationAliases: ['dealGateMigration'],
    defaultComparisonIdPrefix: 'deal-gate-shadow-comparison',
    comparisonScope: 'deal_gate_native_to_phase_13_shadow',
    migrate: migrateDealGateSignal,
    compareNativeFields,
    compareEvidence,
    compareConfidence,
    compareStatus,
    compareMetadata,
    compareUnknownValues,
    determineParityStatus,
    validateMigration: validateDealGateMigration,
    summarizeComparison: summarizeDealGateShadowComparison,
    validateComparison: validateDealGateShadowComparison,
    buildComparisonFingerprint: buildDealGateShadowComparisonFingerprint
  });
}

module.exports = {
  DEAL_GATE_SHADOW_COMPARISON_SCHEMA_VERSION,
  DEAL_GATE_SHADOW_COMPARISON_SOURCE,
  PARITY_STATUSES,
  REQUIRED_DEAL_GATE_SHADOW_COMPARISON_FIELDS,
  buildDealGateShadowComparisonFingerprint,
  compareDealGateNativeToShadow,
  summarizeDealGateShadowComparison,
  validateDealGateShadowComparison
};
