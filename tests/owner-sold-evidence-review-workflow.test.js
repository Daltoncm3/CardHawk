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
  buildOwnerSoldEvidenceReviewWorkflow,
  summarizeOwnerSoldEvidenceReviewWorkflow
} = require('../validation/ownerSoldEvidenceReviewWorkflow');

const baseRow = Object.freeze({
  source_class: 'owner_supplied_export',
  source_provider_name: 'Owner Spreadsheet Provider Secret',
  transaction_id: 'secret-transaction-123',
  listing_id: 'secret-listing-456',
  sale_date: '2026-09-20T00:00:00.000Z',
  currency: 'USD',
  final_sale_price: '42.50',
  listing_type: 'auction',
  confirmation_status: 'owner_verified_final_price',
  identity_category: 'sports_card',
  sport: 'ufc',
  subject_name: 'Anthony Hernandez',
  year: '2023',
  manufacturer: 'Panini',
  product: 'Prizm',
  set_name: 'Prizm',
  card_number: '181',
  parallel: 'Silver Prizm',
  rookie_designation: 'true',
  autograph_state: 'false',
  memorabilia_state: 'false',
  serial_numbered: 'false',
  provenance_categories: 'owner_export|platform_transaction_record',
  acquired_at: '2026-09-21T00:00:00.000Z',
  retention_status: 'permanent_allowed',
  source_approval_status: 'row_claims_approval',
  exact_identity_verified: 'true',
  raw_title: 'SHOULD_NOT_APPEAR_PUBLICLY',
  source_url: 'https://example.test/secret'
});

function shaBytes(value) {
  return crypto.createHash('sha256').update(Buffer.from(String(value), 'utf8')).digest('hex');
}

function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvFromRows(rows) {
  const headers = Object.keys(rows[0]);
  return [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(','))
  ].join('\n');
}

function ownerAssertion(overrides = {}) {
  const completedContent = 'completed transaction private evidence bytes';
  const finalPriceContent = 'final price private evidence bytes';
  const completed = shaBytes(completedContent);
  const finalPrice = shaBytes(finalPriceContent);
  return {
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
    sourcePolicyId: 'owner_supplied_export_with_manual_verification_v1',
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

function assertNoSensitivePublicContent(value) {
  const serialized = JSON.stringify(value);
  for (const hidden of [
    'secret-transaction-123',
    'secret-listing-456',
    'Owner Spreadsheet Provider Secret',
    'Anthony Hernandez',
    '42.50',
    '2026-09-20T00:00:00.000Z',
    'SHOULD_NOT_APPEAR_PUBLICLY',
    'https://example.test',
    'private-completion-reference',
    'private-price-reference',
    'completed transaction private evidence bytes',
    'final price private evidence bytes',
    shaBytes('completed transaction private evidence bytes'),
    shaBytes('final price private evidence bytes')
  ]) {
    assert.equal(serialized.includes(hidden), false, hidden);
  }
}

function freshWorkflowWithPatchedModules(patches = {}) {
  const workflowPath = require.resolve('../validation/ownerSoldEvidenceReviewWorkflow');
  const importPath = require.resolve('../validation/ownerSoldEvidenceImportAdapter');
  const packagePath = require.resolve('../validation/ownerSoldEvidenceVerificationPackage');
  const contractPath = require.resolve('../validation/canonicalSoldEvidenceImportContract');
  const originals = new Map();

  for (const [modulePath, patch] of [
    [importPath, patches.importAdapter],
    [packagePath, patches.verificationPackage],
    [contractPath, patches.importContract]
  ]) {
    if (!patch) continue;
    const cached = require.cache[modulePath];
    originals.set(modulePath, cached.exports);
    cached.exports = {
      ...cached.exports,
      ...patch
    };
  }

  delete require.cache[workflowPath];
  const workflow = require('../validation/ownerSoldEvidenceReviewWorkflow');
  delete require.cache[workflowPath];
  for (const [modulePath, exportsValue] of originals.entries()) {
    require.cache[modulePath].exports = exportsValue;
  }
  return workflow;
}

test('A5.20 builds a sanitized review workflow from A5.18, A5.19, and A5.17', () => {
  const result = buildOwnerSoldEvidenceReviewWorkflow(csvFromRows([baseRow]), {
    format: 'csv',
    ownerVerificationAssertions: [ownerAssertion()]
  });
  const summary = summarizeOwnerSoldEvidenceReviewWorkflow(result);

  assert.equal(result.valid, true);
  assert.equal(result.workflowStatus, 'review_ready');
  assert.equal(summary.totalImportedRows, 1);
  assert.equal(summary.parsedUntrustedCandidateCount, 1);
  assert.equal(summary.parsingRejectionCount, 0);
  assert.equal(summary.ownerAttestationPackageCount, 1);
  assert.equal(summary.rowsMissingOwnerAssertions, 0);
  assert.equal(summary.technicallyCompleteOwnerAttestationCount, 1);
  assert.equal(
    summary.ownerAttestationTrustStatus,
    'not_trusted_identity_not_retention_approved_not_independently_verified_not_canonical_ready'
  );
  assert.equal(summary.retentionPermissionUnconfirmedCount, 1);
  assert.equal(summary.trustedIdentityUnavailableCount, 1);
  assert.equal(summary.canonicalReadyCount, 0);
  assert.equal(summary.rejectedCount, 1);
  assert.deepEqual(summary.workflowIntegrityReasonCodes, []);
  assert.deepEqual(summary.rowsRequiringTrustedIdentityResolution, [0]);
  assert.deepEqual(summary.rowsRequiringRetentionPermission, [0]);
  assert.equal(summary.nonPersistent, true);
  assert.equal(summary.productionImpact, 'none');
  assert.equal(summary.executionAuthority, 'none');
  assert.equal(Object.hasOwn(result, 'ownerAttestationPackages'), false);
  assert.equal(Object.hasOwn(result, 'importResult'), false);
  assert.equal(Object.hasOwn(result, 'a5_17Validation'), false);
  assertNoSensitivePublicContent(result);
});

test('A5.20 reuses A5.18, A5.19, and A5.17 instead of duplicating them', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'validation', 'ownerSoldEvidenceReviewWorkflow.js'),
    'utf8'
  );

  assert.equal(source.includes('importOwnerSoldEvidence'), true);
  assert.equal(source.includes('buildOwnerSoldEvidenceVerificationPackage'), true);
  assert.equal(source.includes('validateCanonicalSoldEvidenceImportBatch'), true);
  assert.equal(source.includes('parseCsv'), false);
  assert.equal(source.includes('hashEvidenceContent'), false);
  assert.equal(source.includes('trustedContext:'), false);
});

test('A5.20 invokes A5.18, A5.19, and A5.17 through their existing module APIs', () => {
  const calls = {
    import: 0,
    package: 0,
    batch: 0
  };
  const realImport = require('../validation/ownerSoldEvidenceImportAdapter');
  const realPackage = require('../validation/ownerSoldEvidenceVerificationPackage');
  const realContract = require('../validation/canonicalSoldEvidenceImportContract');
  const workflow = freshWorkflowWithPatchedModules({
    importAdapter: {
      importOwnerSoldEvidence(...args) {
        calls.import += 1;
        return realImport.importOwnerSoldEvidence(...args);
      }
    },
    verificationPackage: {
      buildOwnerSoldEvidenceVerificationPackage(...args) {
        calls.package += 1;
        return realPackage.buildOwnerSoldEvidenceVerificationPackage(...args);
      }
    },
    importContract: {
      validateCanonicalSoldEvidenceImportBatch(...args) {
        calls.batch += 1;
        return realContract.validateCanonicalSoldEvidenceImportBatch(...args);
      }
    }
  });

  const result = workflow.buildOwnerSoldEvidenceReviewWorkflow([baseRow], {
    format: 'json',
    ownerVerificationAssertions: [ownerAssertion()]
  });

  assert.equal(result.publicDiagnostics.canonicalReadyCount, 0);
  assert.deepEqual(calls, {
    import: 1,
    package: 1,
    batch: 1
  });
});

test('A5.20 detects unexpected A5.17 canonical readiness instead of concealing it', () => {
  const realContract = require('../validation/canonicalSoldEvidenceImportContract');
  const workflow = freshWorkflowWithPatchedModules({
    importContract: {
      validateCanonicalSoldEvidenceImportBatch(...args) {
        const result = realContract.validateCanonicalSoldEvidenceImportBatch(...args);
        return {
          ...result,
          valid: true,
          publicDiagnostics: {
            ...result.publicDiagnostics,
            canonicalReadyCount: 1,
            rejectedCount: 0,
            reasonCodeCounts: {}
          }
        };
      }
    }
  });
  const result = workflow.buildOwnerSoldEvidenceReviewWorkflow([baseRow], {
    format: 'json',
    ownerVerificationAssertions: [ownerAssertion()]
  });

  assert.equal(result.publicDiagnostics.canonicalReadyCount, 1);
  assert.equal(result.publicDiagnostics.rejectedCount, 0);
  assert.equal(result.workflowStatus, 'review_blocked');
  assert.equal(result.valid, false);
  assert.deepEqual(result.publicDiagnostics.workflowIntegrityReasonCodes, [
    'unexpected_canonical_readiness_without_trusted_context'
  ]);
  assert.equal(
    result.publicDiagnostics.reasonCodeFrequencies.unexpected_canonical_readiness_without_trusted_context,
    1
  );
});

test('A5.20 imported trust claims and trusted-looking options cannot create canonical readiness', () => {
  const row = {
    ...baseRow,
    source_class: 'approved_api',
    provenance_categories: 'provider_api|platform_transaction_record',
    confirmation_status: 'confirmed_final_price',
    identity_status: 'EXACT',
    retention_status: 'permanent_allowed',
    trustedContext: 'file supplied trusted context'
  };
  const result = buildOwnerSoldEvidenceReviewWorkflow([row], {
    format: 'json',
    ownerVerificationAssertions: [ownerAssertion()],
    trustedContext: { sourcePolicies: [{ malicious: true }] },
    trustedIdentityArtifact: { identityClassification: 'EXACT' },
    trustedRetentionPolicyArtifact: { retentionPermissionStatus: 'retention_permission_confirmed' }
  });

  assert.equal(result.valid, false);
  assert.equal(result.publicDiagnostics.workflowStatus, 'review_blocked');
  assert.equal(result.publicDiagnostics.canonicalReadyCount, 0);
  assert.equal(result.publicDiagnostics.reasonCodeFrequencies.trusted_context_rejected, 1);
  assert.equal(result.canonicalValidationDiagnostics.canonicalReadyCount, 0);
  assertNoSensitivePublicContent(result.publicDiagnostics);
});

test('A5.20 missing and malformed owner assertions fail closed', () => {
  const missing = buildOwnerSoldEvidenceReviewWorkflow([baseRow], { format: 'json' });
  const malformed = buildOwnerSoldEvidenceReviewWorkflow([baseRow], {
    format: 'json',
    ownerVerificationAssertions: [{ verificationMethod: 'unsupported', verifierCategory: 'owner' }]
  });

  assert.equal(missing.valid, false);
  assert.equal(missing.publicDiagnostics.rowsMissingOwnerAssertions, 1);
  assert.equal(missing.publicDiagnostics.reasonCodeFrequencies.missing_owner_assertion, 1);
  assert.equal(missing.publicDiagnostics.canonicalReadyCount, 0);
  assert.equal(malformed.valid, false);
  assert.equal(malformed.publicDiagnostics.technicallyCompleteOwnerAttestationCount, 0);
  assert.equal(malformed.publicDiagnostics.reasonCodeFrequencies.owner_attestation_incomplete, 1);
  assert.equal(malformed.publicDiagnostics.reasonCodeFrequencies.verification_method_unsupported, 1);
  assert.equal(malformed.publicDiagnostics.canonicalReadyCount, 0);
});

test('A5.20 rejected rows do not shift original row-index assertion matching', () => {
  const rejectedFirstRow = {
    ...baseRow,
    final_sale_price: '=1+1'
  };
  const validSecondRow = {
    ...baseRow,
    transaction_id: 'secret-transaction-second'
  };
  const shiftedAssertionWouldFail = ownerAssertion({
    sourcePolicyId: 'owner_manual_verification_v1'
  });
  const validSecondAssertion = ownerAssertion();
  const result = buildOwnerSoldEvidenceReviewWorkflow([rejectedFirstRow, validSecondRow], {
    format: 'json',
    ownerVerificationAssertions: [shiftedAssertionWouldFail, validSecondAssertion]
  });

  assert.equal(result.publicDiagnostics.totalImportedRows, 2);
  assert.equal(result.publicDiagnostics.parsedUntrustedCandidateCount, 1);
  assert.equal(result.publicDiagnostics.parsingRejectionCount, 1);
  assert.equal(result.publicDiagnostics.ownerAttestationPackageCount, 1);
  assert.equal(result.publicDiagnostics.rowsMissingOwnerAssertions, 0);
  assert.equal(result.publicDiagnostics.technicallyCompleteOwnerAttestationCount, 1);
  assert.equal(result.publicDiagnostics.rejectedCount, 2);
  assert.equal(result.publicDiagnostics.reasonCodeFrequencies.policy_mismatch || 0, 0);
  assert.equal(result.publicDiagnostics.rowPackageDiagnostics[0].index, 0);
  assert.equal(result.publicDiagnostics.rowPackageDiagnostics[1].index, 1);
  assert.deepEqual(result.publicDiagnostics.workflowIntegrityReasonCodes, []);
});

test('A5.20 row and assertion count mismatches block review readiness', () => {
  const result = buildOwnerSoldEvidenceReviewWorkflow([baseRow, {
    ...baseRow,
    transaction_id: 'secret-transaction-789'
  }], {
    format: 'json',
    ownerVerificationAssertions: [ownerAssertion()]
  });

  assert.equal(result.valid, false);
  assert.equal(result.publicDiagnostics.workflowStatus, 'review_blocked');
  assert.equal(result.publicDiagnostics.reasonCodeFrequencies.row_assertion_count_mismatch, 1);
  assert.equal(result.publicDiagnostics.rowsMissingOwnerAssertions, 1);
  assert.equal(result.publicDiagnostics.canonicalReadyCount, 0);
});

test('A5.20 duplicate rows remain non-canonical and report aggregate duplicate counts only', () => {
  const result = buildOwnerSoldEvidenceReviewWorkflow([baseRow, baseRow], {
    format: 'json',
    ownerVerificationAssertions: [ownerAssertion(), ownerAssertion()]
  });
  const serialized = JSON.stringify(result);

  assert.equal(result.publicDiagnostics.duplicateCount, 1);
  assert.equal(result.publicDiagnostics.reasonCodeFrequencies.duplicate_row_detected, 2);
  assert.equal(result.publicDiagnostics.canonicalReadyCount, 0);
  assert.equal(result.publicDiagnostics.rejectedCount, 2);
  assert.equal(
    result.publicDiagnostics.canonicalReadyCount + result.publicDiagnostics.rejectedCount,
    result.publicDiagnostics.totalImportedRows
  );
  assert.equal(serialized.includes('duplicateFingerprints'), false);
  assertNoSensitivePublicContent(result);
});

test('A5.20 recursively rejects dangerous and trust-injection assertion keys without exposing them', () => {
  const dangerous = JSON.parse('{"nested":{"__proto__":"polluted"}}');
  const trustInjection = {
    nested: {
      sourcePolicies: [{ trusted: true }],
      trustedContext: { malicious: true }
    }
  };
  const dangerousResult = buildOwnerSoldEvidenceReviewWorkflow([baseRow], {
    format: 'json',
    ownerVerificationAssertions: [dangerous]
  });
  const trustResult = buildOwnerSoldEvidenceReviewWorkflow([baseRow], {
    format: 'json',
    ownerVerificationAssertions: [trustInjection]
  });
  const serialized = JSON.stringify([dangerousResult.publicDiagnostics, trustResult.publicDiagnostics]);

  assert.equal(dangerousResult.valid, false);
  assert.equal(dangerousResult.publicDiagnostics.rowsWithMalformedOwnerAssertions, 1);
  assert.equal(dangerousResult.publicDiagnostics.reasonCodeFrequencies.assertion_payload_dangerous_key, 1);
  assert.equal(trustResult.valid, false);
  assert.equal(trustResult.publicDiagnostics.reasonCodeFrequencies.assertion_payload_trust_injection_key, 1);
  assert.equal(serialized.includes('__proto__'), false);
  assert.equal(serialized.includes('sourcePolicies'), false);
  assert.equal(serialized.includes('trustedContext'), false);
  assert.equal(Object.prototype.polluted, undefined);
});

test('A5.20 oversized and deeply nested assertions fail closed', () => {
  const oversized = ownerAssertion({
    evidenceArtifacts: [{
      artifactReference: 'x'.repeat(260 * 1024),
      artifactFingerprint: shaBytes('large'),
      evidenceCategories: ['completed_transaction']
    }]
  });
  const deep = { level1: { level2: { level3: { level4: { level5: { level6: { level7: { level8: { level9: true } } } } } } } } };
  const oversizedResult = buildOwnerSoldEvidenceReviewWorkflow([baseRow], {
    format: 'json',
    ownerVerificationAssertions: [oversized]
  });
  const deepResult = buildOwnerSoldEvidenceReviewWorkflow([baseRow], {
    format: 'json',
    ownerVerificationAssertions: [deep]
  });

  assert.equal(oversizedResult.valid, false);
  assert.equal(oversizedResult.publicDiagnostics.reasonCodeFrequencies.assertion_payload_oversized, 1);
  assert.equal(oversizedResult.publicDiagnostics.ownerAttestationPackageCount, 0);
  assert.equal(deepResult.valid, false);
  assert.equal(deepResult.publicDiagnostics.reasonCodeFrequencies.assertion_payload_too_deep, 1);
  assert.equal(deepResult.publicDiagnostics.ownerAttestationPackageCount, 0);
});

test('A5.20 preserves inputs and produces deterministic fingerprints', () => {
  const input = [{ ...baseRow }];
  const options = {
    format: 'json',
    ownerVerificationAssertions: [ownerAssertion()]
  };
  const beforeInput = stableStringify(input);
  const beforeOptions = stableStringify(options);
  const first = buildOwnerSoldEvidenceReviewWorkflow(input, options);
  const second = buildOwnerSoldEvidenceReviewWorkflow(input, options);

  assert.equal(stableStringify(input), beforeInput);
  assert.equal(stableStringify(options), beforeOptions);
  assert.equal(first.publicDiagnostics.workflowFingerprint, second.publicDiagnostics.workflowFingerprint);
  assert.deepEqual(first.publicDiagnostics, second.publicDiagnostics);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.publicDiagnostics), true);
  assert.equal(Object.isFrozen(first.importDiagnostics), true);
  assert.equal(Object.isFrozen(first.canonicalValidationDiagnostics), true);
});

test('A5.20 empty and malformed imports fail closed without canonical readiness', () => {
  const empty = buildOwnerSoldEvidenceReviewWorkflow([], {
    format: 'json',
    ownerVerificationAssertions: []
  });
  const malformed = buildOwnerSoldEvidenceReviewWorkflow('{bad json', {
    format: 'json',
    ownerVerificationAssertions: []
  });

  assert.equal(empty.valid, false);
  assert.equal(empty.publicDiagnostics.reasonCodeFrequencies.empty_import, 1);
  assert.equal(empty.publicDiagnostics.canonicalReadyCount, 0);
  assert.equal(malformed.valid, false);
  assert.equal(malformed.publicDiagnostics.reasonCodeFrequencies.import_parse_failed, 1);
  assert.equal(malformed.publicDiagnostics.reasonCodeFrequencies.invalid_json, 1);
  assert.equal(malformed.publicDiagnostics.canonicalReadyCount, 0);
});

test('A5.20 public row diagnostics contain only bounded row indexes, statuses, booleans, and reason codes', () => {
  const result = buildOwnerSoldEvidenceReviewWorkflow([{
    ...baseRow,
    'Sensitive Private Header': 'private owner note'
  }], {
    format: 'json',
    ownerVerificationAssertions: [ownerAssertion()]
  });
  const [row] = result.publicDiagnostics.rowPackageDiagnostics;
  const serialized = JSON.stringify(row);

  assert.deepEqual(Object.keys(row).sort(), [
    'canonicalReady',
    'evidenceVerificationStatus',
    'index',
    'ownerAttestationStatus',
    'reasonCodes'
  ].sort());
  assert.equal(Number.isInteger(row.index), true);
  assert.equal(row.canonicalReady, false);
  assert.equal(serialized.includes('Sensitive Private Header'), false);
  assert.equal(serialized.includes('private owner note'), false);
  assertNoSensitivePublicContent(row);
});

test('A5.20 workflow imports no filesystem, network, persistence, runtime, or marketplace execution modules', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'validation', 'ownerSoldEvidenceReviewWorkflow.js'), 'utf8');
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
