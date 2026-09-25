'use strict';

const crypto = require('node:crypto');

const {
  normalizeImportCandidate,
  validateCanonicalSoldEvidenceImportCandidate
} = require('./canonicalSoldEvidenceImportContract');
const {
  asArray,
  asObject,
  fingerprint,
  normalizeDate,
  unique
} = require('./canonicalValidationCore');

const SOURCE = 'owner_sold_evidence_verification_package';
const VERSION = '0.3.0';
const SCHEMA_VERSION = '1.0.0';

const VERIFICATION_METHODS = Object.freeze([
  'owner_receipt_review',
  'owner_platform_order_history_review',
  'owner_statement_reconciliation',
  'manual_source_document_review'
]);

const VERIFIER_CATEGORIES = Object.freeze([
  'owner',
  'authorized_owner_operator',
  'cardhawk_operator'
]);

const EVIDENCE_CATEGORIES = Object.freeze([
  'completed_transaction',
  'final_price'
]);

const OWNER_ATTESTATION_STATUSES = Object.freeze([
  'owner_attestation_complete',
  'owner_attestation_incomplete'
]);

const EVIDENCE_VERIFICATION_STATUSES = Object.freeze([
  'evidence_content_hash_computed',
  'evidence_content_not_independently_verified'
]);

const READINESS_STATUSES = Object.freeze([
  'trusted_identity_unavailable',
  'retention_permission_not_confirmed',
  'canonical_ready_false'
]);

const REASON_CODES = Object.freeze([
  'a5_17_validation_failed',
  'canonical_ready_false',
  'completed_transaction_evidence_missing',
  'completed_transaction_fingerprint_invalid',
  'cross_run_reuse_detection_unavailable',
  'evidence_category_missing',
  'evidence_content_hash_mismatch',
  'evidence_content_not_independently_verified',
  'final_price_evidence_missing',
  'final_price_fingerprint_invalid',
  'manual_verification_not_approved',
  'malformed_candidate',
  'owner_identity_artifact_ignored',
  'policy_inactive',
  'policy_mismatch',
  'policy_not_found',
  'record_binding_mismatch',
  'retention_permission_not_confirmed',
  'reused_artifact_fingerprint',
  'single_artifact_requires_explicit_categories',
  'source_class_not_supported',
  'trusted_identity_unavailable',
  'verification_method_unsupported',
  'verification_timestamp_invalid',
  'verifier_category_unsupported'
]);

const OWNER_VERIFICATION_POLICY_REGISTRY = Object.freeze({
  owner_manual_verification_v1: Object.freeze({
    policyId: 'owner_manual_verification_v1',
    policyVersion: '1.0.0',
    allowedSourceClass: 'owner_manual_verification',
    internalUseStatus: 'internal_validation_only',
    retentionClassification: 'restricted',
    retentionPermissionStatus: 'retention_permission_not_confirmed',
    requiredEvidenceCategories: Object.freeze(['completed_transaction', 'final_price']),
    allowedVerificationMethods: Object.freeze(['owner_receipt_review', 'owner_platform_order_history_review', 'owner_statement_reconciliation', 'manual_source_document_review']),
    active: true,
    legalPermissionAuthority: 'not_created_by_code_registry'
  }),
  owner_supplied_export_with_manual_verification_v1: Object.freeze({
    policyId: 'owner_supplied_export_with_manual_verification_v1',
    policyVersion: '1.0.0',
    allowedSourceClass: 'owner_supplied_export',
    internalUseStatus: 'internal_validation_only',
    retentionClassification: 'restricted',
    retentionPermissionStatus: 'retention_permission_not_confirmed',
    requiredEvidenceCategories: Object.freeze(['completed_transaction', 'final_price']),
    allowedVerificationMethods: Object.freeze(['owner_receipt_review', 'owner_platform_order_history_review', 'owner_statement_reconciliation', 'manual_source_document_review']),
    active: true,
    legalPermissionAuthority: 'not_created_by_code_registry'
  }),
  owner_supplied_export_inactive_v1: Object.freeze({
    policyId: 'owner_supplied_export_inactive_v1',
    policyVersion: '1.0.0',
    allowedSourceClass: 'owner_supplied_export',
    internalUseStatus: 'internal_validation_only',
    retentionClassification: 'restricted',
    retentionPermissionStatus: 'retention_permission_not_confirmed',
    requiredEvidenceCategories: Object.freeze(['completed_transaction', 'final_price']),
    allowedVerificationMethods: Object.freeze(['owner_receipt_review']),
    active: false,
  legalPermissionAuthority: 'not_created_by_code_registry'
  })
});

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function normalizeText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function boundedText(value) {
  return String(value || '').trim().slice(0, 120);
}

function isSha256(value) {
  return /^[a-f0-9]{64}$/i.test(String(value || '').trim());
}

function contentToBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (typeof value === 'string') return Buffer.from(value, 'utf8');
  if (value instanceof Uint8Array) return Buffer.from(value);
  return null;
}

function hashEvidenceContent(value) {
  const buffer = contentToBuffer(value);
  if (!buffer) return null;
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function sortedCountMap(map = {}) {
  return deepFreeze(Object.fromEntries(Object.entries(map)
    .filter(([key, value]) => key && Number(value) > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => [key, Math.max(0, Math.floor(Number(value) || 0))])));
}

function increment(map, key) {
  if (!key) return;
  map[key] = (map[key] || 0) + 1;
}

function policyFingerprint(policy = {}) {
  return fingerprint({
    policyId: policy.policyId,
    policyVersion: policy.policyVersion,
    allowedSourceClass: policy.allowedSourceClass,
    internalUseStatus: policy.internalUseStatus,
    retentionClassification: policy.retentionClassification,
    retentionPermissionStatus: policy.retentionPermissionStatus,
    requiredEvidenceCategories: [...asArray(policy.requiredEvidenceCategories)].sort(),
    allowedVerificationMethods: [...asArray(policy.allowedVerificationMethods)].sort(),
    active: policy.active === true,
    legalPermissionAuthority: policy.legalPermissionAuthority || null
  });
}

function policyRegistry() {
  return Object.fromEntries(Object.entries(OWNER_VERIFICATION_POLICY_REGISTRY)
    .map(([key, policy]) => [key, deepFreeze({
      ...policy,
      policyFingerprint: policyFingerprint(policy)
    })]));
}

function normalizeEvidenceArtifacts(input = {}) {
  return asArray(input.evidenceArtifacts)
    .map((artifact) => {
      const object = asObject(artifact);
      return {
        artifactReferencePresent: Boolean(object.artifactReference || object.reference || object.evidenceReference),
        artifactFingerprint: String(object.artifactFingerprint || object.evidenceFingerprint || '').trim().toLowerCase(),
        evidenceCategories: unique(asArray(object.evidenceCategories || object.categories)
          .map(normalizeText)
          .filter((category) => EVIDENCE_CATEGORIES.includes(category)))
          .sort()
      };
    })
    .filter((artifact) => artifact.artifactReferencePresent || artifact.artifactFingerprint || artifact.evidenceCategories.length);
}

function findArtifactByFingerprint(artifacts = [], fingerprintValue) {
  return artifacts.find((artifact) => artifact.artifactFingerprint === String(fingerprintValue || '').trim().toLowerCase()) || null;
}

function artifactHasCategory(artifacts = [], fingerprintValue, category) {
  const artifact = findArtifactByFingerprint(artifacts, fingerprintValue);
  return artifact ? artifact.evidenceCategories.includes(category) : false;
}

function resolvePolicy(candidate = {}, verificationInput = {}, reasons = []) {
  const registry = policyRegistry();
  const requestedPolicyId = boundedText(verificationInput.sourcePolicyId || verificationInput.policyId);
  const requestedPolicyVersion = boundedText(verificationInput.sourcePolicyVersion || verificationInput.policyVersion);
  const policy = registry[requestedPolicyId] || null;

  if (!policy) reasons.push('policy_not_found');
  if (policy && policy.policyVersion !== requestedPolicyVersion) reasons.push('policy_mismatch');
  if (policy && policy.active !== true) reasons.push('policy_inactive');
  if (policy && policy.allowedSourceClass !== candidate.sourceClass) reasons.push('policy_mismatch');

  return {
    policy: policy ? clone(policy) : null,
    policyKnown: Boolean(policy),
    policyActive: policy?.active === true,
    retentionPermissionStatus: 'retention_permission_not_confirmed'
  };
}

function validateVerificationInput(candidate = {}, verificationInput = {}) {
  const input = asObject(verificationInput);
  const reasons = [
    'canonical_ready_false',
    'cross_run_reuse_detection_unavailable',
    'retention_permission_not_confirmed',
    'trusted_identity_unavailable'
  ];
  const method = normalizeText(input.verificationMethod);
  const verifierCategory = normalizeText(input.verifierCategory);
  const outcome = normalizeText(input.verificationOutcome);
  const verifiedAt = normalizeDate(input.verificationTimestamp || input.verifiedAt);
  const ownerClaimedRecordBindingFingerprint = String(input.recordBindingFingerprint || '').trim();
  const artifacts = normalizeEvidenceArtifacts(input);
  const completedAttestedFingerprint = String(input.completedTransactionEvidenceFingerprint || '').trim().toLowerCase();
  const finalPriceAttestedFingerprint = String(input.finalPriceEvidenceFingerprint || '').trim().toLowerCase();
  const completedComputedFingerprint = hashEvidenceContent(input.completedTransactionEvidenceContent);
  const finalPriceComputedFingerprint = hashEvidenceContent(input.finalPriceEvidenceContent);
  const completedFingerprint = completedComputedFingerprint || completedAttestedFingerprint;
  const finalPriceFingerprint = finalPriceComputedFingerprint || finalPriceAttestedFingerprint;
  const ownerIdentityClaimed = Boolean(input.exactIdentityResolverArtifact ||
    input.identityArtifact ||
    input.exactIdentityResolverArtifactFingerprint ||
    input.identityStatus ||
    input.identityVerificationStatus ||
    input.exactIdentityVerified);

  if (ownerClaimedRecordBindingFingerprint && ownerClaimedRecordBindingFingerprint !== candidate.importCandidateFingerprint) {
    reasons.push('record_binding_mismatch');
  }
  if (!VERIFICATION_METHODS.includes(method)) reasons.push('verification_method_unsupported');
  if (!VERIFIER_CATEGORIES.includes(verifierCategory)) reasons.push('verifier_category_unsupported');
  if (!verifiedAt) reasons.push('verification_timestamp_invalid');
  if (outcome !== 'approved') reasons.push('manual_verification_not_approved');
  if (ownerIdentityClaimed) reasons.push('owner_identity_artifact_ignored');

  if (!input.completedTransactionEvidenceReference || !completedFingerprint) reasons.push('completed_transaction_evidence_missing');
  if (completedAttestedFingerprint && !isSha256(completedAttestedFingerprint)) reasons.push('completed_transaction_fingerprint_invalid');
  if (!input.finalPriceEvidenceReference || !finalPriceFingerprint) reasons.push('final_price_evidence_missing');
  if (finalPriceAttestedFingerprint && !isSha256(finalPriceAttestedFingerprint)) reasons.push('final_price_fingerprint_invalid');

  if (!completedComputedFingerprint || !finalPriceComputedFingerprint) {
    reasons.push('evidence_content_not_independently_verified');
  }
  if (completedComputedFingerprint && completedAttestedFingerprint && completedComputedFingerprint !== completedAttestedFingerprint) {
    reasons.push('evidence_content_hash_mismatch');
  }
  if (finalPriceComputedFingerprint && finalPriceAttestedFingerprint && finalPriceComputedFingerprint !== finalPriceAttestedFingerprint) {
    reasons.push('evidence_content_hash_mismatch');
  }

  if (completedFingerprint && finalPriceFingerprint && completedFingerprint === finalPriceFingerprint) {
    const shared = findArtifactByFingerprint(artifacts, completedFingerprint);
    if (!shared || !shared.evidenceCategories.includes('completed_transaction') || !shared.evidenceCategories.includes('final_price')) {
      reasons.push('single_artifact_requires_explicit_categories');
    }
  }
  if (completedFingerprint && !artifactHasCategory(artifacts, completedFingerprint, 'completed_transaction')) {
    reasons.push('evidence_category_missing');
  }
  if (finalPriceFingerprint && !artifactHasCategory(artifacts, finalPriceFingerprint, 'final_price')) {
    reasons.push('evidence_category_missing');
  }
  if (completedFingerprint && finalPriceFingerprint && completedFingerprint === finalPriceFingerprint) {
    reasons.push('reused_artifact_fingerprint');
  }

  if (candidate.sourceClass !== 'owner_manual_verification' && candidate.sourceClass !== 'owner_supplied_export') {
    reasons.push('source_class_not_supported');
  }

  const policy = resolvePolicy(candidate, input, reasons);
  if (policy.policy && !asArray(policy.policy.allowedVerificationMethods).includes(method)) reasons.push('policy_mismatch');

  const evidenceVerificationStatus = completedComputedFingerprint && finalPriceComputedFingerprint
    ? 'evidence_content_hash_computed'
    : 'evidence_content_not_independently_verified';
  const blockingReasons = unique(reasons)
    .filter((reason) => ![
      'canonical_ready_false',
      'cross_run_reuse_detection_unavailable',
      'retention_permission_not_confirmed',
      'trusted_identity_unavailable'
    ].includes(reason));
  const ownerAttestationStatus = blockingReasons.length === 0
    ? 'owner_attestation_complete'
    : 'owner_attestation_incomplete';

  return deepFreeze({
    valid: ownerAttestationStatus === 'owner_attestation_complete',
    reasonCodes: unique(reasons).filter((reason) => REASON_CODES.includes(reason)).sort(),
    method,
    verifierCategory,
    verifiedAt,
    outcome,
    completedFingerprint,
    finalPriceFingerprint,
    completedComputedFingerprint,
    finalPriceComputedFingerprint,
    ownerClaimedRecordBindingFingerprint,
    internallyComputedRecordBindingFingerprint: candidate.importCandidateFingerprint,
    evidenceVerificationStatus,
    ownerAttestationStatus,
    policy,
    artifacts: artifacts.map(clone)
  });
}

function publicDiagnosticsFor(input = {}) {
  const reasonCodeCounts = {};
  for (const reason of asArray(input.reasonCodes)) increment(reasonCodeCounts, reason);
  const publicDiagnostics = {
    source: SOURCE,
    version: VERSION,
    schemaVersion: SCHEMA_VERSION,
    ownerAttestationStatus: input.ownerAttestationStatus,
    evidenceVerificationStatus: input.evidenceVerificationStatus,
    trustedIdentityStatus: 'trusted_identity_unavailable',
    retentionPermissionStatus: 'retention_permission_not_confirmed',
    canonicalReadinessStatus: 'canonical_ready_false',
    crossRunReuseDetectionStatus: 'cross_run_reuse_detection_unavailable',
    sourceClass: input.sourceClass,
    verificationMethod: VERIFICATION_METHODS.includes(input.verificationMethod) ? input.verificationMethod : 'unknown',
    verifierCategory: VERIFIER_CATEGORIES.includes(input.verifierCategory) ? input.verifierCategory : 'unknown',
    evidenceCategoryPresence: {
      completed_transaction: input.hasCompletedTransactionEvidence === true,
      final_price: input.hasFinalPriceEvidence === true
    },
    evidenceCategoryCount: [input.hasCompletedTransactionEvidence, input.hasFinalPriceEvidence].filter(Boolean).length,
    reasonCodeCounts: sortedCountMap(reasonCodeCounts),
    a5_17CanonicalReadyCount: 0,
    a5_17CanonicalReadyStatus: 'not_canonical_ready',
    nonPersistent: true,
    writesProductionStore: false,
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
  publicDiagnostics.reportFingerprint = fingerprint(publicDiagnostics);
  return deepFreeze(publicDiagnostics);
}

function buildOwnerSoldEvidenceVerificationPackage(candidateInput = {}, ownerVerificationAssertion = {}) {
  const originalCandidate = clone(candidateInput);
  const originalVerification = clone(ownerVerificationAssertion);
  const candidate = normalizeImportCandidate(candidateInput);
  const validation = validateVerificationInput(candidate, ownerVerificationAssertion);
  const a5_17Validation = validateCanonicalSoldEvidenceImportCandidate(candidateInput);
  const reasonCodes = unique([
    ...validation.reasonCodes,
    ...(a5_17Validation.canonicalReady ? [] : ['a5_17_validation_failed'])
  ]).filter((reason) => REASON_CODES.includes(reason)).sort();
  const publicDiagnostics = publicDiagnosticsFor({
    reasonCodes,
    ownerAttestationStatus: validation.ownerAttestationStatus,
    evidenceVerificationStatus: validation.evidenceVerificationStatus,
    sourceClass: candidate.sourceClass,
    verificationMethod: validation.method,
    verifierCategory: validation.verifierCategory,
    hasCompletedTransactionEvidence: Boolean(validation.completedFingerprint),
    hasFinalPriceEvidence: Boolean(validation.finalPriceFingerprint)
  });
  const result = {
    source: SOURCE,
    version: VERSION,
    schemaVersion: SCHEMA_VERSION,
    valid: false,
    canonicalReady: false,
    ownerAttestationStatus: validation.ownerAttestationStatus,
    evidenceVerificationStatus: validation.evidenceVerificationStatus,
    trustedIdentityStatus: 'trusted_identity_unavailable',
    retentionPermissionStatus: 'retention_permission_not_confirmed',
    canonicalReadinessStatus: 'canonical_ready_false',
    candidate,
    verificationValidation: validation,
    a5_17Validation,
    reasonCodes,
    publicDiagnostics,
    packageFingerprint: fingerprint({
      source: SOURCE,
      schemaVersion: SCHEMA_VERSION,
      canonicalReady: false,
      ownerAttestationStatus: validation.ownerAttestationStatus,
      evidenceVerificationStatus: validation.evidenceVerificationStatus,
      completedComputedFingerprint: validation.completedComputedFingerprint ? 'present' : null,
      finalPriceComputedFingerprint: validation.finalPriceComputedFingerprint ? validation.finalPriceComputedFingerprint : null,
      reasonCodes,
      publicDiagnosticsFingerprint: publicDiagnostics.reportFingerprint
    }),
    nonPersistent: true,
    writesProductionStore: false,
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };

  if (JSON.stringify(originalCandidate) !== JSON.stringify(candidateInput || {})) {
    throw new Error('owner_sold_evidence_verification_package_mutated_candidate');
  }
  if (JSON.stringify(originalVerification) !== JSON.stringify(ownerVerificationAssertion || {})) {
    throw new Error('owner_sold_evidence_verification_package_mutated_verification_input');
  }

  return deepFreeze(result);
}

function summarizeOwnerSoldEvidenceVerificationPackage(packageResult = {}) {
  return deepFreeze(clone(asObject(packageResult.publicDiagnostics)));
}

module.exports = {
  SOURCE,
  VERSION,
  SCHEMA_VERSION,
  VERIFICATION_METHODS,
  VERIFIER_CATEGORIES,
  EVIDENCE_CATEGORIES,
  OWNER_ATTESTATION_STATUSES,
  EVIDENCE_VERIFICATION_STATUSES,
  READINESS_STATUSES,
  REASON_CODES,
  OWNER_VERIFICATION_POLICY_REGISTRY: policyRegistry(),
  buildOwnerSoldEvidenceVerificationPackage,
  summarizeOwnerSoldEvidenceVerificationPackage,
  validateVerificationInput
};
