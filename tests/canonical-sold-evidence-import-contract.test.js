'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  SOURCE_CLASSES,
  TRUSTED_USE,
  normalizeImportCandidate,
  summarizeCanonicalSoldEvidenceImportValidation,
  validateCanonicalSoldEvidenceImportBatch,
  validateCanonicalSoldEvidenceImportCandidate
} = require('../validation/canonicalSoldEvidenceImportContract');

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

function baseRecord(overrides = {}) {
  return {
    sourceClass: 'approved_api',
    sourceProviderName: 'Approved Provider Secret Name',
    externalTransactionId: 'provider-secret-sale-id-123',
    externalListingId: 'provider-secret-listing-id-123',
    saleDate: '2026-09-20T00:00:00.000Z',
    currency: 'USD',
    finalSalePrice: 42.5,
    listingType: 'auction',
    confirmationStatus: 'confirmed_final_price',
    identity: exactIdentity,
    exactIdentityVerified: true,
    provenanceCategories: ['provider_api', 'platform_transaction_record'],
    acquiredAt: '2026-09-21T00:00:00.000Z',
    retentionStatus: 'permanent_allowed',
    permission: {
      sourceTerms: 'approved internal use only',
      sourceApprovalStatus: 'approved_for_internal_validation'
    },
    rawTitle: 'SHOULD_NOT_APPEAR_PUBLICLY',
    sourceUrl: 'https://example.test/secret-source-url',
    rawProviderPayload: { secret: 'RAW_PROVIDER_PAYLOAD_SHOULD_NOT_LEAK' },
    ...overrides
  };
}

function ownerExport(overrides = {}) {
  return baseRecord({
    sourceClass: 'owner_supplied_export',
    sourceProviderName: 'Owner Export',
    confirmationStatus: 'owner_verified_final_price',
    provenanceCategories: ['owner_export', 'platform_transaction_record'],
    externalTransactionId: 'owner-export-secret-id',
    ...overrides
  });
}

function manualRecord(overrides = {}) {
  return baseRecord({
    sourceClass: 'owner_manual_verification',
    sourceProviderName: 'Owner Manual Verification',
    confirmationStatus: 'owner_verified_final_price',
    provenanceCategories: ['manual_verification', 'receipt_or_invoice'],
    manualVerification: {
      verified: true,
      verifier: 'owner',
      verifiedAt: '2026-09-21T00:00:00.000Z'
    },
    externalTransactionId: 'manual-secret-id',
    ...overrides
  });
}

function trustedContextFor(record, overrides = {}) {
  const candidate = normalizeImportCandidate(record);
  const policyFingerprint = `policy-${candidate.importCandidateFingerprint}`;
  const identityArtifactFingerprint = `identity-${candidate.importCandidateFingerprint}`;
  const sourcePolicy = {
    sourceClass: candidate.sourceClass,
    sourceProviderName: candidate.sourceProviderName,
    allowedUses: [TRUSTED_USE],
    retentionStatus: 'permanent_allowed',
    sourceTerms: 'trusted offline policy',
    sourceApprovalStatus: 'trusted_policy_approved',
    policyVersion: 'policy-v1',
    policyFingerprint,
    active: true
  };
  const identityArtifact = {
    recordFingerprint: candidate.importCandidateFingerprint,
    artifactFingerprint: identityArtifactFingerprint,
    identityClassification: 'EXACT',
    integrityStatus: 'valid',
    consistencyStatus: 'consistent'
  };
  const saleConfirmationArtifact = {
    recordFingerprint: candidate.importCandidateFingerprint,
    artifactFingerprint: `sale-${candidate.importCandidateFingerprint}`,
    sourceClass: candidate.sourceClass,
    sourceProviderName: candidate.sourceProviderName,
    sourcePolicyFingerprint: policyFingerprint,
    confirmationStatus: 'confirmed_final_price',
    approvedAdapter: true,
    adapter: 'trusted_test_adapter',
    retrievalMethod: 'trusted_test_confirmation',
    sourceReliability: 'trusted_test_confirmed',
    completedTransactionEvidenceFingerprint: `completed-${candidate.importCandidateFingerprint}`,
    finalPriceEvidenceFingerprint: `price-${candidate.importCandidateFingerprint}`,
    integrityStatus: 'valid'
  };
  const manualVerificationArtifact = {
    recordFingerprint: candidate.importCandidateFingerprint,
    recordBindingFingerprint: candidate.importCandidateFingerprint,
    artifactFingerprint: `manual-${candidate.importCandidateFingerprint}`,
    sourcePolicyFingerprint: policyFingerprint,
    exactIdentityArtifactFingerprint: identityArtifactFingerprint,
    completedTransactionEvidenceFingerprint: `completed-${candidate.importCandidateFingerprint}`,
    finalPriceEvidenceFingerprint: `price-${candidate.importCandidateFingerprint}`,
    verificationMethod: 'owner_receipt_review',
    verifierCategory: 'owner',
    verifiedAt: '2026-09-21T00:00:00.000Z',
    verificationOutcome: 'verified',
    integrityStatus: 'valid'
  };
  return {
    sourcePolicies: [sourcePolicy],
    identityArtifacts: [identityArtifact],
    saleConfirmationArtifacts: candidate.sourceClass === 'owner_manual_verification' ? [] : [saleConfirmationArtifact],
    manualVerificationArtifacts: candidate.sourceClass === 'approved_api' ? [] : [manualVerificationArtifact],
    ...overrides
  };
}

test('A5.17 keeps all three source classes distinct without granting special authority', () => {
  const records = [baseRecord(), ownerExport(), manualRecord()];
  const trustedContext = {
    sourcePolicies: records.flatMap((record) => trustedContextFor(record).sourcePolicies),
    identityArtifacts: records.flatMap((record) => trustedContextFor(record).identityArtifacts),
    saleConfirmationArtifacts: records.flatMap((record) => trustedContextFor(record).saleConfirmationArtifacts),
    manualVerificationArtifacts: records.flatMap((record) => trustedContextFor(record).manualVerificationArtifacts)
  };
  const batch = validateCanonicalSoldEvidenceImportBatch(records, { trustedContext });
  const diagnostics = batch.publicDiagnostics;
  const serializedPublic = JSON.stringify(diagnostics);

  assert.equal(batch.valid, true);
  assert.deepEqual(Object.keys(diagnostics.sourceClassCounts).sort(), [...SOURCE_CLASSES].sort());
  assert.equal(diagnostics.canonicalReadyBySourceClass.approved_api, 1);
  assert.equal(diagnostics.canonicalReadyBySourceClass.owner_supplied_export, 1);
  assert.equal(diagnostics.canonicalReadyBySourceClass.owner_manual_verification, 1);
  assert.equal(serializedPublic.includes('provider-secret-sale-id'), false);
  assert.equal(serializedPublic.includes('owner-export-secret-id'), false);
  assert.equal(serializedPublic.includes('manual-secret-id'), false);
  assert.equal(serializedPublic.includes('SHOULD_NOT_APPEAR_PUBLICLY'), false);
  assert.equal(serializedPublic.includes('https://example.test'), false);
  assert.equal(serializedPublic.includes('RAW_PROVIDER_PAYLOAD_SHOULD_NOT_LEAK'), false);
  assert.equal(diagnostics.nonPersistent, true);
  assert.equal(diagnostics.productionImpact, 'none');
  assert.equal(diagnostics.executionAuthority, 'none');
});

test('A5.17 fully populated malicious rows cannot self-certify trust gates', () => {
  const row = baseRecord({
    exactIdentityVerified: true,
    identityVerificationStatus: 'exact',
    confirmationStatus: 'confirmed_final_price',
    retentionStatus: 'permanent_allowed',
    permission: {
      sourceApprovalStatus: 'approved_for_internal_validation',
      sourceTerms: 'row claims approval'
    }
  });
  const result = validateCanonicalSoldEvidenceImportCandidate(row);

  assert.equal(result.canonicalReady, false);
  assert.equal(result.reasonCodes.includes('trusted_identity_artifact_missing'), true);
  assert.equal(result.reasonCodes.includes('trusted_sale_confirmation_missing'), true);
  assert.equal(result.reasonCodes.includes('trusted_source_policy_missing'), true);
  assert.equal(result.reasonCodes.includes('untrusted_identity_claim'), true);
  assert.equal(result.reasonCodes.includes('untrusted_confirmation_claim'), true);
  assert.equal(result.reasonCodes.includes('untrusted_permission_claim'), true);
});

test('A5.17 selecting approved_api grants no trust without approved context', () => {
  const result = validateCanonicalSoldEvidenceImportCandidate(baseRecord({
    sourceClass: 'approved_api',
    provenanceCategories: ['provider_api', 'platform_transaction_record']
  }));

  assert.equal(result.canonicalReady, false);
  assert.equal(result.trustContextStatus.sourcePolicyTrusted, false);
  assert.equal(result.trustContextStatus.saleConfirmationTrusted, false);
  assert.equal(result.reasonCodes.includes('trusted_source_policy_missing'), true);
  assert.equal(result.reasonCodes.includes('trusted_sale_confirmation_missing'), true);
});

test('A5.17 malformed, incomplete, active, asking, estimated, and unconfirmed records fail closed', () => {
  const records = [
    baseRecord({ finalSalePrice: null }),
    baseRecord({ saleDate: 'not-a-date' }),
    baseRecord({ confirmationStatus: 'unconfirmed' }),
    baseRecord({ confirmationStatus: 'estimated' }),
    baseRecord({ confirmationStatus: 'asking_price' }),
    baseRecord({ confirmationStatus: 'active_listing' }),
    baseRecord({ sourceClass: 'unknown_source', provenanceCategories: ['unknown'] })
  ];
  const batch = validateCanonicalSoldEvidenceImportBatch(records);

  assert.equal(batch.valid, false);
  assert.equal(batch.publicDiagnostics.canonicalReadyCount, 0);
  assert.equal(batch.publicDiagnostics.reasonCodeCounts.missing_final_sale_price, 1);
  assert.equal(batch.publicDiagnostics.reasonCodeCounts.missing_sale_date, 1);
  assert.equal(batch.publicDiagnostics.reasonCodeCounts.unconfirmed_price_not_canonical_ready, 1);
  assert.equal(batch.publicDiagnostics.reasonCodeCounts.estimated_price_not_canonical_ready, 1);
  assert.equal(batch.publicDiagnostics.reasonCodeCounts.active_or_asking_price_not_canonical_ready, 2);
  assert.equal(batch.publicDiagnostics.reasonCodeCounts.unsupported_source_class, 1);
});

test('A5.17 ignores imported exact identity and retention claims as authority', () => {
  const exactClaim = validateCanonicalSoldEvidenceImportCandidate(baseRecord({
    exactIdentityVerified: true,
    identityStatus: 'exact'
  }));
  const retentionClaim = validateCanonicalSoldEvidenceImportCandidate(baseRecord({
    retentionStatus: 'permanent_allowed',
    permission: { sourceApprovalStatus: 'approved_by_row' }
  }));

  assert.equal(exactClaim.canonicalReady, false);
  assert.equal(exactClaim.reasonCodes.includes('untrusted_identity_claim'), true);
  assert.equal(exactClaim.reasonCodes.includes('trusted_identity_artifact_missing'), true);
  assert.equal(retentionClaim.canonicalReady, false);
  assert.equal(retentionClaim.reasonCodes.includes('untrusted_permission_claim'), true);
  assert.equal(retentionClaim.reasonCodes.includes('trusted_source_policy_missing'), true);
});

test('A5.17 prevents manual evidence and owner exports from masquerading as API evidence', () => {
  const manualWithoutVerification = validateCanonicalSoldEvidenceImportCandidate(manualRecord({
    manualVerification: { verified: false }
  }));
  const ownerExportWithProviderApi = validateCanonicalSoldEvidenceImportCandidate(ownerExport({
    provenanceCategories: ['owner_export', 'provider_api']
  }));

  assert.equal(manualWithoutVerification.canonicalReady, false);
  assert.equal(manualWithoutVerification.reasonCodes.includes('manual_verification_artifact_incomplete'), true);
  assert.equal(ownerExportWithProviderApi.canonicalReady, false);
  assert.equal(ownerExportWithProviderApi.reasonCodes.includes('owner_export_not_provider_confirmed'), true);
  assert.equal(ownerExportWithProviderApi.normalizedCandidate.sourceClass, 'owner_supplied_export');
});

test('A5.17 owner exports and incomplete manual artifacts fail closed without trusted verification', () => {
  const exportResult = validateCanonicalSoldEvidenceImportCandidate(ownerExport());
  const manual = manualRecord();
  const incompleteContext = trustedContextFor(manual, {
    manualVerificationArtifacts: [{
      ...trustedContextFor(manual).manualVerificationArtifacts[0],
      finalPriceEvidenceFingerprint: null
    }]
  });
  const manualResult = validateCanonicalSoldEvidenceImportCandidate(manual, { trustedContext: incompleteContext });

  assert.equal(exportResult.canonicalReady, false);
  assert.equal(exportResult.reasonCodes.includes('owner_export_requires_trusted_verification'), true);
  assert.equal(manualResult.canonicalReady, false);
  assert.equal(manualResult.reasonCodes.includes('manual_verification_artifact_incomplete'), true);
});

test('A5.17 mismatched artifacts fail closed', () => {
  const record = baseRecord();
  const trustedContext = trustedContextFor(record, {
    identityArtifacts: [{
      ...trustedContextFor(record).identityArtifacts[0],
      recordFingerprint: 'different-record'
    }]
  });
  const result = validateCanonicalSoldEvidenceImportCandidate(record, { trustedContext });

  assert.equal(result.canonicalReady, false);
  assert.equal(result.reasonCodes.includes('trusted_identity_artifact_missing'), true);
  assert.equal(result.reasonCodes.includes('identity_artifact_record_mismatch'), true);
});

test('A5.17 mismatched trusted source policy fails closed', () => {
  const record = baseRecord();
  const context = trustedContextFor(record);
  const result = validateCanonicalSoldEvidenceImportCandidate(record, {
    trustedContext: {
      ...context,
      sourcePolicies: [{
        ...context.sourcePolicies[0],
        sourceProviderName: 'Different Provider'
      }]
    }
  });

  assert.equal(result.canonicalReady, false);
  assert.equal(result.reasonCodes.includes('trusted_source_policy_missing'), true);
  assert.equal(result.reasonCodes.includes('trusted_source_policy_mismatch'), true);
});

test('A5.17 valid separately supplied trusted context authorizes a conforming record', () => {
  const record = baseRecord();
  const result = validateCanonicalSoldEvidenceImportCandidate(record, {
    trustedContext: trustedContextFor(record)
  });

  assert.equal(result.canonicalReady, true);
  assert.equal(result.reasonCodes.includes('canonical_ready'), true);
  assert.equal(result.trustContextStatus.sourcePolicyTrusted, true);
  assert.equal(result.trustContextStatus.identityArtifactTrusted, true);
  assert.equal(result.trustContextStatus.saleConfirmationTrusted, true);
  assert.equal(result.normalizedCanonicalRecord.retention.status, 'permanent_allowed');
});

test('A5.17 duplicate detection is deterministic and public diagnostics expose counts only', () => {
  const first = baseRecord({ externalTransactionId: 'duplicate-secret-id' });
  const second = baseRecord({ externalTransactionId: 'duplicate-secret-id' });
  const trustedContext = {
    sourcePolicies: [
      ...trustedContextFor(first).sourcePolicies,
      ...trustedContextFor(second).sourcePolicies
    ],
    identityArtifacts: [
      ...trustedContextFor(first).identityArtifacts,
      ...trustedContextFor(second).identityArtifacts
    ],
    saleConfirmationArtifacts: [
      ...trustedContextFor(first).saleConfirmationArtifacts,
      ...trustedContextFor(second).saleConfirmationArtifacts
    ]
  };
  const batch = validateCanonicalSoldEvidenceImportBatch([first, second], { trustedContext });
  const serializedPublic = JSON.stringify(batch.publicDiagnostics);

  assert.equal(batch.valid, false);
  assert.equal(batch.publicDiagnostics.duplicateCount, 1);
  assert.equal(batch.publicDiagnostics.reasonCodeCounts.duplicate_record_detected, 1);
  assert.equal(batch.internalDuplicateDiagnostics.duplicateFingerprints.length, 1);
  assert.equal(Object.hasOwn(batch.publicDiagnostics, 'duplicateFingerprints'), false);
  assert.equal(batch.publicDiagnostics.recordDiagnostics.every((entry) => !Object.hasOwn(entry, 'duplicateFingerprint')), true);
  assert.equal(batch.publicDiagnostics.recordDiagnostics.every((entry) => !Object.hasOwn(entry, 'candidateFingerprint')), true);
  assert.equal(serializedPublic.includes('duplicate-secret-id'), false);
});

test('A5.17 validation does not mutate inputs and summaries remain sanitized', () => {
  const input = baseRecord();
  const trustedContext = trustedContextFor(input);
  const before = JSON.stringify(input);
  const trustedBefore = JSON.stringify(trustedContext);
  const batch = validateCanonicalSoldEvidenceImportBatch([input], { trustedContext });
  const summary = summarizeCanonicalSoldEvidenceImportValidation(batch);

  assert.equal(JSON.stringify(input), before);
  assert.equal(JSON.stringify(trustedContext), trustedBefore);
  assert.deepEqual(Object.keys(summary).sort(), Object.keys(batch.publicDiagnostics).sort());
  assert.equal(JSON.stringify(summary).includes(input.externalTransactionId), false);
  assert.equal(Object.isFrozen(batch), true);
  assert.equal(Object.isFrozen(batch.results[0]), true);
});

test('A5.17 normalized candidate exposes the exact contract fields without persistence authority', () => {
  const normalized = normalizeImportCandidate(baseRecord());

  assert.deepEqual(Object.keys(normalized).filter((key) => [
    'sourceClass',
    'sourceProviderName',
    'externalTransactionId',
    'saleDate',
    'currency',
    'finalSalePrice',
    'listingType',
    'confirmationStatus',
    'identity',
    'provenanceCategories',
    'acquiredAt',
    'retentionStatus'
  ].includes(key)).sort(), [
    'acquiredAt',
    'confirmationStatus',
    'currency',
    'externalTransactionId',
    'finalSalePrice',
    'identity',
    'listingType',
    'provenanceCategories',
    'retentionStatus',
    'saleDate',
    'sourceClass',
    'sourceProviderName'
  ]);
  assert.equal(normalized.nonPersistent, true);
  assert.equal(normalized.writesProductionStore, false);
  assert.equal(normalized.productionImpact, 'none');
  assert.equal(normalized.decisionImpact, 'none');
  assert.equal(normalized.executionAuthority, 'none');
});

test('A5.17 module imports no runtime, network, persistence, notification, marketplace execution, or server code', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'validation', 'canonicalSoldEvidenceImportContract.js'), 'utf8');
  for (const forbidden of [
    'server.js',
    'fetch(',
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
