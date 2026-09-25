'use strict';

const {
  importOwnerSoldEvidence
} = require('./ownerSoldEvidenceImportAdapter');
const {
  buildOwnerSoldEvidenceVerificationPackage
} = require('./ownerSoldEvidenceVerificationPackage');
const {
  validateCanonicalSoldEvidenceImportBatch
} = require('./canonicalSoldEvidenceImportContract');
const {
  asArray,
  asObject,
  fingerprint,
  unique
} = require('./canonicalValidationCore');

const SOURCE = 'owner_sold_evidence_review_workflow';
const VERSION = '0.1.0';
const SCHEMA_VERSION = '1.0.0';
const MAX_ASSERTIONS = 100;
const MAX_ASSERTION_BYTES = 256 * 1024;
const MAX_ASSERTION_DEPTH = 8;
const MAX_ASSERTION_ENTRIES = 1000;

const DANGEROUS_KEYS = Object.freeze([
  '__proto__',
  'prototype',
  'constructor'
]);

const TRUST_INJECTION_KEYS = Object.freeze([
  'trustedcontext',
  'trustedidentityartifact',
  'trustedretentionpolicyartifact',
  'sourcepolicies',
  'identityartifacts',
  'saleconfirmationartifacts',
  'manualverificationartifacts',
  'testonly',
  'allowtestpolicy',
  'internaltrustedoptions'
]);

const WORKFLOW_STATUSES = Object.freeze([
  'review_ready',
  'review_blocked'
]);

const REASON_CODES = Object.freeze([
  'canonical_ready_false',
  'duplicate_row_detected',
  'empty_import',
  'import_parse_failed',
  'malformed_assertions',
  'missing_owner_assertion',
  'owner_attestation_incomplete',
  'owner_attestation_package_failed',
  'reconciliation_a5_17_count_mismatch',
  'reconciliation_assertion_package_mismatch',
  'reconciliation_candidate_offset_mismatch',
  'reconciliation_import_count_mismatch',
  'reconciliation_workflow_count_mismatch',
  'retention_permission_not_confirmed',
  'row_assertion_count_mismatch',
  'unsupported_assertion_payload',
  'assertion_payload_oversized',
  'assertion_payload_too_deep',
  'assertion_payload_too_large',
  'assertion_payload_dangerous_key',
  'assertion_payload_trust_injection_key',
  'trusted_context_rejected',
  'trusted_identity_unavailable',
  'unexpected_canonical_readiness_without_trusted_context'
]);

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function increment(map, key, amount = 1) {
  if (!key) return;
  map[key] = (map[key] || 0) + amount;
}

function sortedCountMap(map = {}) {
  return deepFreeze(Object.fromEntries(Object.entries(map)
    .filter(([key, value]) => key && Number(value) > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => [key, Math.max(0, Math.floor(Number(value) || 0))])));
}

function normalizedKey(key) {
  return String(key || '').trim().toLowerCase();
}

function validateAssertionNode(value, state, depth = 0) {
  if (depth > MAX_ASSERTION_DEPTH) {
    state.valid = false;
    state.reasons.add('assertion_payload_too_deep');
    return;
  }
  if (value === null) return;
  const type = typeof value;
  if (['string', 'number', 'boolean'].includes(type)) return;
  if (type !== 'object') {
    state.valid = false;
    state.reasons.add('unsupported_assertion_payload');
    return;
  }
  if (Array.isArray(value)) {
    state.entryCount += value.length;
    if (state.entryCount > MAX_ASSERTION_ENTRIES) {
      state.valid = false;
      state.reasons.add('assertion_payload_too_large');
      return;
    }
    for (const entry of value) validateAssertionNode(entry, state, depth + 1);
    return;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    state.valid = false;
    state.reasons.add('unsupported_assertion_payload');
    return;
  }
  const entries = Object.entries(value);
  state.entryCount += entries.length;
  if (state.entryCount > MAX_ASSERTION_ENTRIES) {
    state.valid = false;
    state.reasons.add('assertion_payload_too_large');
    return;
  }
  for (const [key, child] of entries) {
    const keyName = normalizedKey(key);
    if (DANGEROUS_KEYS.includes(keyName)) {
      state.valid = false;
      state.reasons.add('assertion_payload_dangerous_key');
      continue;
    }
    if (TRUST_INJECTION_KEYS.includes(keyName)) {
      state.valid = false;
      state.reasons.add('assertion_payload_trust_injection_key');
      continue;
    }
    validateAssertionNode(child, state, depth + 1);
  }
}

function validateAssertions(assertions = []) {
  const reasons = new Set();
  const fatalReasons = new Set();
  const validByIndex = new Map();
  let valid = true;
  let serialized = '';

  try {
    serialized = JSON.stringify(assertions);
  } catch (_error) {
    valid = false;
    reasons.add('unsupported_assertion_payload');
  }
  if (Buffer.byteLength(serialized || '', 'utf8') > MAX_ASSERTION_BYTES) {
    valid = false;
    reasons.add('assertion_payload_oversized');
    fatalReasons.add('assertion_payload_oversized');
  }
  if (assertions.length > MAX_ASSERTIONS) {
    valid = false;
    reasons.add('malformed_assertions');
    fatalReasons.add('malformed_assertions');
  }

  assertions.forEach((assertion, index) => {
    const state = {
      valid: true,
      reasons: new Set(),
      entryCount: 0
    };
    validateAssertionNode(assertion, state);
    validByIndex.set(index, state.valid);
    for (const reason of state.reasons) reasons.add(reason);
    if (!state.valid) valid = false;
  });

  return {
    valid,
    validByIndex,
    fatalReasons: [...fatalReasons].sort(),
    reasons: [...reasons].sort()
  };
}

function normalizedAssertions(input = {}, options = {}) {
  const candidate = options.ownerVerificationAssertions ??
    input.ownerVerificationAssertions ??
    input.verificationAssertions ??
    input.assertions ??
    [];
  return asArray(candidate);
}

function publicRowPackageDiagnostic(index, packageResult = null, reasonCodes = []) {
  return deepFreeze({
    index,
    ownerAttestationStatus: packageResult?.ownerAttestationStatus || 'owner_attestation_incomplete',
    evidenceVerificationStatus: packageResult?.evidenceVerificationStatus || 'evidence_content_not_independently_verified',
    canonicalReady: false,
    reasonCodes: unique([
      ...asArray(reasonCodes),
      ...asArray(packageResult?.reasonCodes)
    ]).sort()
  });
}

function sanitizedImportDiagnostics(importDiagnostics = {}) {
  return {
    format: importDiagnostics.format || 'unknown',
    totalRows: Number(importDiagnostics.totalRows) || 0,
    parsedUntrustedCandidateCount: Number(importDiagnostics.parsedUntrustedCandidateCount) || 0,
    rejectedParsingCount: Number(importDiagnostics.rejectedParsingCount) || 0,
    duplicateCount: Number(importDiagnostics.duplicateCount) || 0,
    sourceClassCounts: sortedCountMap(importDiagnostics.sourceClassCounts),
    parsingReasonCodeCounts: sortedCountMap(importDiagnostics.parsingReasonCodeCounts),
    readinessCounts: sortedCountMap(importDiagnostics.readinessCounts),
    unknownFieldCount: Number(importDiagnostics.unknownFieldCount) || 0,
    rowsWithUnknownFields: Number(importDiagnostics.rowsWithUnknownFields) || 0,
    nonPersistent: true,
    productionImpact: 'none',
    executionAuthority: 'none'
  };
}

function buildOwnerSoldEvidenceReviewWorkflow(input = {}, options = {}) {
  const originalInput = clone(input);
  const originalOptions = clone(options);
  const inputObject = asObject(input);
  const assertions = normalizedAssertions(inputObject, options);
  const assertionValidation = validateAssertions(assertions);
  const reasonCodeCounts = {};
  const rowPackageDiagnostics = [];
  const packages = [];
  const malformedAssertionIndexes = [];
  const rowsRequiringAdditionalEvidence = new Set();
  const rowsRequiringTrustedIdentityResolution = new Set();
  const rowsRequiringRetentionPermission = new Set();
  let trustedContextRejected = false;

  for (const reason of assertionValidation.reasons) {
    increment(reasonCodeCounts, reason);
  }

  if (inputObject.trustedContext || options.trustedContext ||
    inputObject.trustedIdentityArtifact || inputObject.trustedRetentionPolicyArtifact ||
    options.trustedIdentityArtifact || options.trustedRetentionPolicyArtifact) {
    trustedContextRejected = true;
    increment(reasonCodeCounts, 'trusted_context_rejected');
  }

  const importResult = importOwnerSoldEvidence(input, options);
  const importDiagnostics = asObject(importResult.publicDiagnostics);
  const totalImportedRows = importDiagnostics.totalRows || 0;
  const parsedUntrustedCandidateCount = importDiagnostics.parsedUntrustedCandidateCount || 0;
  const parsingRejectionCount = importDiagnostics.rejectedParsingCount || 0;
  const duplicateCount = importDiagnostics.duplicateCount || 0;

  for (const [reason, count] of Object.entries(asObject(importDiagnostics.parsingReasonCodeCounts))) {
    increment(reasonCodeCounts, reason, count);
  }
  if (!importResult.valid) increment(reasonCodeCounts, 'import_parse_failed');
  if (totalImportedRows === 0) increment(reasonCodeCounts, 'empty_import');
  if (duplicateCount > 0) increment(reasonCodeCounts, 'duplicate_row_detected', duplicateCount);

  const assertionCountMismatch = totalImportedRows !== assertions.length;
  if (assertionCountMismatch) increment(reasonCodeCounts, 'row_assertion_count_mismatch');
  const missingAssertionIndexes = [];

  let candidateOffset = 0;
  for (const rowDiagnostic of asArray(importDiagnostics.rowDiagnostics)) {
    const rowIndex = Number(rowDiagnostic.index);
    if (rowDiagnostic.parsedUntrustedCandidate !== true) {
      rowPackageDiagnostics.push(publicRowPackageDiagnostic(rowIndex, null, rowDiagnostic.reasonCodes));
      rowsRequiringAdditionalEvidence.add(rowIndex);
      continue;
    }

    const candidate = importResult.candidates[candidateOffset];
    candidateOffset += 1;
    const assertion = assertions[rowIndex];
    if (!assertion || typeof assertion !== 'object' || Array.isArray(assertion)) {
      missingAssertionIndexes.push(rowIndex);
      increment(reasonCodeCounts, 'missing_owner_assertion');
      rowPackageDiagnostics.push(publicRowPackageDiagnostic(rowIndex, null, ['missing_owner_assertion']));
      rowsRequiringAdditionalEvidence.add(rowIndex);
      continue;
    }
    if (assertionValidation.fatalReasons.length ||
      assertionValidation.validByIndex.get(rowIndex) !== true) {
      malformedAssertionIndexes.push(rowIndex);
      increment(reasonCodeCounts, 'malformed_assertions');
      rowPackageDiagnostics.push(publicRowPackageDiagnostic(rowIndex, null, assertionValidation.reasons));
      rowsRequiringAdditionalEvidence.add(rowIndex);
      continue;
    }

    const packageResult = buildOwnerSoldEvidenceVerificationPackage(candidate, assertion);
    packages.push(packageResult);
    rowPackageDiagnostics.push(publicRowPackageDiagnostic(rowIndex, packageResult));
    if (packageResult.ownerAttestationStatus !== 'owner_attestation_complete') {
      increment(reasonCodeCounts, 'owner_attestation_incomplete');
      rowsRequiringAdditionalEvidence.add(rowIndex);
    }
    if (packageResult.trustedIdentityStatus === 'trusted_identity_unavailable') {
      increment(reasonCodeCounts, 'trusted_identity_unavailable');
      rowsRequiringTrustedIdentityResolution.add(rowIndex);
    }
    if (packageResult.retentionPermissionStatus === 'retention_permission_not_confirmed') {
      increment(reasonCodeCounts, 'retention_permission_not_confirmed');
      rowsRequiringRetentionPermission.add(rowIndex);
    }
    if (packageResult.canonicalReady !== false) {
      increment(reasonCodeCounts, 'owner_attestation_package_failed');
    }
    for (const reason of asArray(packageResult.reasonCodes)) increment(reasonCodeCounts, reason);
  }

  const a5_17Validation = validateCanonicalSoldEvidenceImportBatch(importResult.candidates || []);
  const a5_17CanonicalReadyCount = a5_17Validation.publicDiagnostics?.canonicalReadyCount || 0;
  const a5_17RejectedCount = a5_17Validation.publicDiagnostics?.rejectedCount || 0;
  const canonicalReadyCount = a5_17CanonicalReadyCount;
  const rejectedCount = parsingRejectionCount + a5_17RejectedCount;
  const technicallyCompleteOwnerAttestationCount = packages
    .filter((packageResult) => packageResult.ownerAttestationStatus === 'owner_attestation_complete')
    .length;
  const incompleteOwnerAttestationCount = packages.length - technicallyCompleteOwnerAttestationCount;
  const reconciliationFailures = [];
  if (totalImportedRows !== parsedUntrustedCandidateCount + parsingRejectionCount) {
    reconciliationFailures.push('reconciliation_import_count_mismatch');
  }
  if (parsedUntrustedCandidateCount !== a5_17CanonicalReadyCount + a5_17RejectedCount) {
    reconciliationFailures.push('reconciliation_a5_17_count_mismatch');
  }
  if (parsedUntrustedCandidateCount !== packages.length + missingAssertionIndexes.length + malformedAssertionIndexes.length) {
    reconciliationFailures.push('reconciliation_assertion_package_mismatch');
  }
  if (canonicalReadyCount + rejectedCount !== totalImportedRows) {
    reconciliationFailures.push('reconciliation_workflow_count_mismatch');
  }
  if (candidateOffset !== parsedUntrustedCandidateCount) {
    reconciliationFailures.push('reconciliation_candidate_offset_mismatch');
  }
  if (a5_17CanonicalReadyCount > 0) {
    reconciliationFailures.push('unexpected_canonical_readiness_without_trusted_context');
  }
  for (const reason of reconciliationFailures) increment(reasonCodeCounts, reason);

  const workflowStatus = parsingRejectionCount === 0 &&
    !assertionCountMismatch &&
    missingAssertionIndexes.length === 0 &&
    malformedAssertionIndexes.length === 0 &&
    incompleteOwnerAttestationCount === 0 &&
    parsedUntrustedCandidateCount > 0 &&
    !trustedContextRejected &&
    reconciliationFailures.length === 0
    ? 'review_ready'
    : 'review_blocked';

  increment(reasonCodeCounts, 'canonical_ready_false', Math.max(1, totalImportedRows || 1));

  const publicDiagnostics = {
    source: SOURCE,
    version: VERSION,
    schemaVersion: SCHEMA_VERSION,
    workflowStatus,
    totalImportedRows,
    parsedUntrustedCandidateCount,
    parsingRejectionCount,
    ownerAttestationPackageCount: packages.length,
    rowsMissingOwnerAssertions: missingAssertionIndexes.length,
    rowsWithMalformedOwnerAssertions: malformedAssertionIndexes.length,
    technicallyCompleteOwnerAttestationCount,
    ownerAttestationTrustStatus: 'not_trusted_identity_not_retention_approved_not_independently_verified_not_canonical_ready',
    retentionPermissionUnconfirmedCount: packages.filter((packageResult) =>
      packageResult.retentionPermissionStatus === 'retention_permission_not_confirmed').length,
    trustedIdentityUnavailableCount: packages.filter((packageResult) =>
      packageResult.trustedIdentityStatus === 'trusted_identity_unavailable').length,
    canonicalReadyCount,
    rejectedCount,
    duplicateCount,
    reasonCodeFrequencies: sortedCountMap(reasonCodeCounts),
    workflowIntegrityReasonCodes: reconciliationFailures.sort(),
    rowsRequiringAdditionalEvidence: [...rowsRequiringAdditionalEvidence].sort((left, right) => left - right),
    rowsRequiringTrustedIdentityResolution: [...rowsRequiringTrustedIdentityResolution].sort((left, right) => left - right),
    rowsRequiringRetentionPermission: [...rowsRequiringRetentionPermission].sort((left, right) => left - right),
    rowPackageDiagnostics: rowPackageDiagnostics.sort((left, right) => left.index - right.index),
    nonPersistent: true,
    writesProductionStore: false,
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
  publicDiagnostics.workflowFingerprint = fingerprint(publicDiagnostics);

  const result = {
    source: SOURCE,
    version: VERSION,
    schemaVersion: SCHEMA_VERSION,
    valid: workflowStatus === 'review_ready',
    workflowStatus,
    importDiagnostics: sanitizedImportDiagnostics(importDiagnostics),
    canonicalValidationDiagnostics: {
      valid: a5_17Validation.valid === true,
      canonicalReadyCount: a5_17Validation.publicDiagnostics?.canonicalReadyCount || 0,
      rejectedCount: a5_17Validation.publicDiagnostics?.rejectedCount || 0,
      reasonCodeCounts: sortedCountMap(a5_17Validation.publicDiagnostics?.reasonCodeCounts),
      nonPersistent: true,
      productionImpact: 'none',
      executionAuthority: 'none'
    },
    publicDiagnostics,
    nonPersistent: true,
    writesProductionStore: false,
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };

  if (JSON.stringify(originalInput) !== JSON.stringify(input || {})) {
    throw new Error('owner_sold_evidence_review_workflow_mutated_input');
  }
  if (JSON.stringify(originalOptions) !== JSON.stringify(options || {})) {
    throw new Error('owner_sold_evidence_review_workflow_mutated_options');
  }

  return deepFreeze(result);
}

function summarizeOwnerSoldEvidenceReviewWorkflow(workflowResult = {}) {
  return deepFreeze(clone(asObject(workflowResult.publicDiagnostics)));
}

module.exports = {
  SOURCE,
  VERSION,
  SCHEMA_VERSION,
  WORKFLOW_STATUSES,
  REASON_CODES,
  buildOwnerSoldEvidenceReviewWorkflow,
  summarizeOwnerSoldEvidenceReviewWorkflow
};
