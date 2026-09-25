'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  stableStringify
} = require('../validation/canonicalValidationCore');
const {
  validateCanonicalSoldEvidenceImportCandidate
} = require('../validation/canonicalSoldEvidenceImportContract');
const a519 = require('../validation/ownerSoldEvidenceVerificationPackage');

const {
  OWNER_VERIFICATION_POLICY_REGISTRY,
  buildOwnerSoldEvidenceVerificationPackage,
  summarizeOwnerSoldEvidenceVerificationPackage
} = a519;

const exactIdentity = Object.freeze({
  category: 'sports_card',
  sport: 'ufc',
  player: 'Anthony Hernandez',
  year: '2023',
  brand: 'Panini',
  product: 'Prizm',
  setName: 'Prizm',
  cardNumber: '181',
  parallel: 'Silver Prizm',
  rookie: true,
  autograph: false,
  memorabilia: false,
  serialNumbered: false
});

function shaBytes(value) {
  return crypto.createHash('sha256').update(Buffer.from(String(value), 'utf8')).digest('hex');
}

function ownerRecord(overrides = {}) {
  return {
    sourceClass: 'owner_manual_verification',
    sourceProviderName: 'Owner Manual Verification',
    externalTransactionId: 'secret-manual-sale-id',
    externalListingId: 'secret-manual-listing-id',
    saleDate: '2026-09-20T00:00:00.000Z',
    currency: 'USD',
    finalSalePrice: 42.5,
    listingType: 'auction',
    confirmationStatus: 'owner_verified_final_price',
    identity: exactIdentity,
    exactIdentityVerified: true,
    provenanceCategories: ['manual_verification', 'receipt_or_invoice'],
    acquiredAt: '2026-09-21T00:00:00.000Z',
    retentionStatus: 'permanent_allowed',
    rawTitle: 'SHOULD_NOT_APPEAR_PUBLICLY',
    sourceUrl: 'https://example.test/secret-source',
    ...overrides
  };
}

function exportRecord(overrides = {}) {
  return ownerRecord({
    sourceClass: 'owner_supplied_export',
    sourceProviderName: 'Owner Spreadsheet Export',
    externalTransactionId: 'secret-export-sale-id',
    provenanceCategories: ['owner_export', 'platform_transaction_record'],
    ...overrides
  });
}

function candidateFingerprintFor(record) {
  return validateCanonicalSoldEvidenceImportCandidate(record).normalizedCandidate.importCandidateFingerprint;
}

function verificationFor(record, overrides = {}) {
  const completedContent = 'completed transaction private evidence bytes';
  const finalPriceContent = 'final price private evidence bytes';
  const completed = shaBytes(completedContent);
  const finalPrice = shaBytes(finalPriceContent);
  return {
    recordBindingFingerprint: candidateFingerprintFor(record),
    verificationMethod: 'owner_receipt_review',
    verifierCategory: 'owner',
    verificationTimestamp: '2026-09-21T12:00:00.000Z',
    completedTransactionEvidenceReference: 'private-completion-reference',
    completedTransactionEvidenceContent: completedContent,
    completedTransactionEvidenceFingerprint: completed,
    finalPriceEvidenceReference: 'private-price-reference',
    finalPriceEvidenceContent: finalPriceContent,
    finalPriceEvidenceFingerprint: finalPrice,
    verificationOutcome: 'approved',
    sourcePolicyId: record.sourceClass === 'owner_supplied_export'
      ? 'owner_supplied_export_with_manual_verification_v1'
      : 'owner_manual_verification_v1',
    sourcePolicyVersion: '1.0.0',
    evidenceArtifacts: [
      {
        artifactReference: 'private-completion-reference',
        artifactFingerprint: completed,
        evidenceCategories: ['completed_transaction']
      },
      {
        artifactReference: 'private-price-reference',
        artifactFingerprint: finalPrice,
        evidenceCategories: ['final_price']
      }
    ],
    ...overrides
  };
}

function fabricatedTrustedOptions(record) {
  return {
    trustedIdentityArtifact: {
      recordFingerprint: candidateFingerprintFor(record),
      artifactFingerprint: shaBytes('fabricated identity'),
      identityClassification: 'EXACT',
      integrityStatus: 'valid',
      consistencyStatus: 'consistent',
      trustedArtifactSource: 'cardhawk_internal_identity_resolver'
    },
    trustedRetentionPolicyArtifact: {
      testOnly: true,
      policyId: 'owner_manual_verification_v1',
      policyVersion: '1.0.0',
      allowedSourceClass: record.sourceClass,
      retentionPermissionStatus: 'retention_permission_confirmed',
      approvedForInternalValidation: true,
      artifactFingerprint: shaBytes('fabricated retention')
    },
    trustedContext: {
      sourcePolicies: [{ retentionStatus: 'internal_retention_allowed' }]
    },
    allowTestPolicy: true
  };
}

test('A5.19 exports only owner-attestation package APIs and constants', () => {
  assert.deepEqual(Object.keys(a519).sort(), [
    'EVIDENCE_CATEGORIES',
    'EVIDENCE_VERIFICATION_STATUSES',
    'OWNER_ATTESTATION_STATUSES',
    'READINESS_STATUSES',
    'REASON_CODES',
    'SCHEMA_VERSION',
    'SOURCE',
    'OWNER_VERIFICATION_POLICY_REGISTRY',
    'VERIFIER_CATEGORIES',
    'VERIFICATION_METHODS',
    'VERSION',
    'buildOwnerSoldEvidenceVerificationPackage',
    'summarizeOwnerSoldEvidenceVerificationPackage',
    'validateVerificationInput'
  ].sort());
  assert.equal(Object.hasOwn(a519, 'buildTrustedContext'), false);
});

test('A5.19 imported row alone cannot construct trustedContext or become canonical-ready', () => {
  const record = ownerRecord();
  const untrusted = validateCanonicalSoldEvidenceImportCandidate(record);
  const packageResult = buildOwnerSoldEvidenceVerificationPackage(record, {});

  assert.equal(untrusted.canonicalReady, false);
  assert.equal(packageResult.canonicalReady, false);
  assert.equal(packageResult.reasonCodes.includes('trusted_identity_unavailable'), true);
  assert.equal(packageResult.reasonCodes.includes('retention_permission_not_confirmed'), true);
  assert.equal(Object.hasOwn(packageResult, 'trustedContext'), false);
  assert.equal(Object.hasOwn(packageResult, 'internalArtifacts'), false);
});

test('A5.19 ignores fabricated third-argument trust injection completely', () => {
  const record = ownerRecord();
  const assertion = verificationFor(record);
  const baseline = buildOwnerSoldEvidenceVerificationPackage(record, assertion);
  const attemptedBypass = buildOwnerSoldEvidenceVerificationPackage(record, assertion, fabricatedTrustedOptions(record));

  assert.equal(attemptedBypass.canonicalReady, false);
  assert.equal(attemptedBypass.retentionPermissionStatus, 'retention_permission_not_confirmed');
  assert.equal(attemptedBypass.trustedIdentityStatus, 'trusted_identity_unavailable');
  assert.deepEqual(attemptedBypass.reasonCodes, baseline.reasonCodes);
  assert.equal(attemptedBypass.packageFingerprint, baseline.packageFingerprint);
});

test('A5.19 fabricated owner identity artifacts and EXACT statuses cannot change readiness', () => {
  const record = ownerRecord();
  const result = buildOwnerSoldEvidenceVerificationPackage(record, verificationFor(record, {
    exactIdentityVerified: true,
    identityStatus: 'EXACT',
    exactIdentityResolverArtifactFingerprint: shaBytes('fake identity'),
    exactIdentityResolverArtifact: {
      recordFingerprint: candidateFingerprintFor(record),
      artifactFingerprint: shaBytes('fake identity'),
      identityClassification: 'EXACT',
      integrityStatus: 'valid',
      consistencyStatus: 'consistent'
    }
  }));

  assert.equal(result.canonicalReady, false);
  assert.equal(result.reasonCodes.includes('owner_identity_artifact_ignored'), true);
  assert.equal(result.reasonCodes.includes('trusted_identity_unavailable'), true);
});

test('A5.19 testOnly and confirmed-retention claims cannot activate canonical readiness', () => {
  const record = ownerRecord();
  const result = buildOwnerSoldEvidenceVerificationPackage(record, verificationFor(record, {
    testOnly: true,
    allowTestPolicy: true,
    trustedRetentionPolicyArtifact: {
      testOnly: true,
      retentionPermissionStatus: 'retention_permission_confirmed'
    },
    retentionPermissionStatus: 'retention_permission_confirmed'
  }));

  assert.equal(result.canonicalReady, false);
  assert.equal(result.retentionPermissionStatus, 'retention_permission_not_confirmed');
  assert.equal(result.publicDiagnostics.canonicalReadinessStatus, 'canonical_ready_false');
});

test('A5.19 computes evidence hashes internally and changing bytes changes the package fingerprint', () => {
  const record = ownerRecord();
  const first = buildOwnerSoldEvidenceVerificationPackage(record, verificationFor(record));
  const changed = buildOwnerSoldEvidenceVerificationPackage(record, verificationFor(record, {
    finalPriceEvidenceContent: 'changed final price private evidence bytes',
    finalPriceEvidenceFingerprint: shaBytes('changed final price private evidence bytes'),
    evidenceArtifacts: [
      {
        artifactReference: 'private-completion-reference',
        artifactFingerprint: shaBytes('completed transaction private evidence bytes'),
        evidenceCategories: ['completed_transaction']
      },
      {
        artifactReference: 'private-price-reference',
        artifactFingerprint: shaBytes('changed final price private evidence bytes'),
        evidenceCategories: ['final_price']
      }
    ]
  }));

  assert.equal(first.verificationValidation.evidenceVerificationStatus, 'evidence_content_hash_computed');
  assert.notEqual(first.verificationValidation.finalPriceComputedFingerprint, changed.verificationValidation.finalPriceComputedFingerprint);
  assert.notEqual(first.packageFingerprint, changed.packageFingerprint);
  assert.equal(first.canonicalReady, false);
  assert.equal(changed.canonicalReady, false);
});

test('A5.19 caller-supplied hash strings alone do not prove evidence', () => {
  const record = ownerRecord();
  const result = buildOwnerSoldEvidenceVerificationPackage(record, verificationFor(record, {
    completedTransactionEvidenceContent: undefined,
    finalPriceEvidenceContent: undefined
  }));

  assert.equal(result.publicDiagnostics.evidenceVerificationStatus, 'evidence_content_not_independently_verified');
  assert.equal(result.reasonCodes.includes('evidence_content_not_independently_verified'), true);
  assert.equal(result.canonicalReady, false);
});

test('A5.19 default policies all remain retention-unconfirmed and non-authoritative', () => {
  for (const policy of Object.values(OWNER_VERIFICATION_POLICY_REGISTRY)) {
    assert.equal(policy.retentionPermissionStatus, 'retention_permission_not_confirmed');
    assert.equal(policy.legalPermissionAuthority, 'not_created_by_code_registry');
  }

  const result = buildOwnerSoldEvidenceVerificationPackage(ownerRecord(), verificationFor(ownerRecord()));
  assert.equal(result.retentionPermissionStatus, 'retention_permission_not_confirmed');
  assert.equal(result.canonicalReady, false);
});

test('A5.19 owner supplied exports remain source-distinct but non-canonical', () => {
  const record = exportRecord();
  const result = buildOwnerSoldEvidenceVerificationPackage(record, verificationFor(record));

  assert.equal(result.candidate.sourceClass, 'owner_supplied_export');
  assert.equal(result.publicDiagnostics.sourceClass, 'owner_supplied_export');
  assert.equal(result.canonicalReady, false);
});

test('A5.19 missing completion or final-price evidence remains incomplete', () => {
  const record = ownerRecord();
  const missingCompletion = buildOwnerSoldEvidenceVerificationPackage(record, verificationFor(record, {
    completedTransactionEvidenceReference: null,
    completedTransactionEvidenceContent: undefined,
    completedTransactionEvidenceFingerprint: null
  }));
  const missingFinalPrice = buildOwnerSoldEvidenceVerificationPackage(record, verificationFor(record, {
    finalPriceEvidenceReference: null,
    finalPriceEvidenceContent: undefined,
    finalPriceEvidenceFingerprint: null
  }));

  assert.equal(missingCompletion.ownerAttestationStatus, 'owner_attestation_incomplete');
  assert.equal(missingCompletion.reasonCodes.includes('completed_transaction_evidence_missing'), true);
  assert.equal(missingFinalPrice.ownerAttestationStatus, 'owner_attestation_incomplete');
  assert.equal(missingFinalPrice.reasonCodes.includes('final_price_evidence_missing'), true);
});

test('A5.19 mismatched owner binding is only a consistency diagnostic', () => {
  const record = ownerRecord();
  const result = buildOwnerSoldEvidenceVerificationPackage(record, verificationFor(record, {
    recordBindingFingerprint: shaBytes('caller wrong record')
  }));

  assert.equal(result.canonicalReady, false);
  assert.equal(result.reasonCodes.includes('record_binding_mismatch'), true);
  assert.equal(result.verificationValidation.internallyComputedRecordBindingFingerprint, candidateFingerprintFor(record));
});

test('A5.19 malformed, mismatched, and reused evidence hashes fail closed', () => {
  const record = ownerRecord();
  const reused = shaBytes('same evidence bytes');
  const malformed = buildOwnerSoldEvidenceVerificationPackage(record, verificationFor(record, {
    completedTransactionEvidenceFingerprint: 'not-a-sha'
  }));
  const mismatch = buildOwnerSoldEvidenceVerificationPackage(record, verificationFor(record, {
    completedTransactionEvidenceFingerprint: shaBytes('different bytes')
  }));
  const reusedResult = buildOwnerSoldEvidenceVerificationPackage(record, verificationFor(record, {
    completedTransactionEvidenceContent: 'same evidence bytes',
    finalPriceEvidenceContent: 'same evidence bytes',
    completedTransactionEvidenceFingerprint: reused,
    finalPriceEvidenceFingerprint: reused,
    evidenceArtifacts: [
      {
        artifactReference: 'single-private-reference',
        artifactFingerprint: reused,
        evidenceCategories: ['completed_transaction']
      }
    ]
  }));

  assert.equal(malformed.reasonCodes.includes('completed_transaction_fingerprint_invalid'), true);
  assert.equal(mismatch.reasonCodes.includes('evidence_content_hash_mismatch'), true);
  assert.equal(reusedResult.reasonCodes.includes('reused_artifact_fingerprint'), true);
  assert.equal(reusedResult.reasonCodes.includes('single_artifact_requires_explicit_categories'), true);
  assert.equal(reusedResult.canonicalReady, false);
});

test('A5.19 unknown, inactive, and mismatched policies remain non-canonical', () => {
  const record = exportRecord();
  const unknown = buildOwnerSoldEvidenceVerificationPackage(record, verificationFor(record, {
    sourcePolicyId: 'unknown_policy'
  }));
  const inactive = buildOwnerSoldEvidenceVerificationPackage(record, verificationFor(record, {
    sourcePolicyId: 'owner_supplied_export_inactive_v1'
  }));
  const mismatch = buildOwnerSoldEvidenceVerificationPackage(record, verificationFor(record, {
    sourcePolicyId: 'owner_manual_verification_v1'
  }));
  const versionMismatch = buildOwnerSoldEvidenceVerificationPackage(record, verificationFor(record, {
    sourcePolicyVersion: '9.9.9'
  }));

  assert.equal(unknown.reasonCodes.includes('policy_not_found'), true);
  assert.equal(inactive.reasonCodes.includes('policy_inactive'), true);
  assert.equal(mismatch.reasonCodes.includes('policy_mismatch'), true);
  assert.equal(versionMismatch.reasonCodes.includes('policy_mismatch'), true);
  assert.equal(unknown.canonicalReady, false);
  assert.equal(inactive.canonicalReady, false);
  assert.equal(mismatch.canonicalReady, false);
});

test('A5.19 always demonstrates A5.17 fail-closed without trustedContext', () => {
  const record = ownerRecord();
  const result = buildOwnerSoldEvidenceVerificationPackage(record, verificationFor(record));

  assert.equal(result.a5_17Validation.canonicalReady, false);
  assert.equal(result.a5_17Validation.reasonCodes.includes('trusted_source_policy_missing'), true);
  assert.equal(result.a5_17Validation.reasonCodes.includes('trusted_identity_artifact_missing'), true);
  assert.equal(result.canonicalReady, false);
});

test('A5.19 preserves inputs and public reports expose no bytes, references, hashes, values, or identities', () => {
  const record = ownerRecord();
  const verification = verificationFor(record);
  const recordBefore = stableStringify(record);
  const verificationBefore = stableStringify(verification);
  const result = buildOwnerSoldEvidenceVerificationPackage(record, verification, fabricatedTrustedOptions(record));
  const summary = summarizeOwnerSoldEvidenceVerificationPackage(result);
  const serializedPublic = JSON.stringify(summary);

  assert.equal(stableStringify(record), recordBefore);
  assert.equal(stableStringify(verification), verificationBefore);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.publicDiagnostics), true);
  for (const hidden of [
    record.externalTransactionId,
    record.externalListingId,
    record.finalSalePrice,
    record.saleDate,
    record.sourceUrl,
    record.identity.player,
    verification.completedTransactionEvidenceReference,
    verification.finalPriceEvidenceReference,
    verification.completedTransactionEvidenceContent,
    verification.finalPriceEvidenceContent,
    verification.completedTransactionEvidenceFingerprint,
    verification.finalPriceEvidenceFingerprint
  ]) {
    assert.equal(serializedPublic.includes(String(hidden)), false, String(hidden));
  }
});

test('A5.19 reports cross-run reuse, revocation, and staleness detection as unavailable', () => {
  const record = ownerRecord();
  const result = buildOwnerSoldEvidenceVerificationPackage(record, verificationFor(record));

  assert.equal(result.publicDiagnostics.crossRunReuseDetectionStatus, 'cross_run_reuse_detection_unavailable');
  assert.equal(result.reasonCodes.includes('cross_run_reuse_detection_unavailable'), true);
});

test('A5.19 preserves A5.17 and A5.18 trust boundaries', () => {
  const record = ownerRecord({
    exactIdentityVerified: true,
    retentionStatus: 'permanent_allowed',
    confirmationStatus: 'owner_verified_final_price'
  });
  const withoutPackage = validateCanonicalSoldEvidenceImportCandidate(record);
  const withPackage = buildOwnerSoldEvidenceVerificationPackage(record, verificationFor(record), fabricatedTrustedOptions(record));

  assert.equal(withoutPackage.canonicalReady, false);
  assert.equal(withoutPackage.reasonCodes.includes('trusted_source_policy_missing'), true);
  assert.equal(withPackage.canonicalReady, false);
  assert.equal(withPackage.a5_17Validation.trustContextStatus.sourcePolicyTrusted, false);
});

test('A5.19 module imports no filesystem, network, persistence, runtime, or marketplace execution modules', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'validation', 'ownerSoldEvidenceVerificationPackage.js'), 'utf8');
  for (const forbidden of [
    "require('fs')",
    'require("fs")',
    'server.js',
    'fetch(',
    'http.',
    'https.',
    'saveSoldEvidenceStore',
    'addSoldEvidenceRecord',
    'notification',
    'BUY_NOW',
    'placeBid',
    'makeOffer',
    'purchaseNow'
  ]) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});
