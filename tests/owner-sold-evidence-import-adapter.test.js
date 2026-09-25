'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  MAX_CONTENT_BYTES,
  MAX_RECORDS,
  importOwnerSoldEvidence,
  mapRowToA5Candidate,
  summarizeOwnerSoldEvidenceImport
} = require('../validation/ownerSoldEvidenceImportAdapter');

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

test('A5.18 valid CSV and JSON map identically into A5.17 untrusted candidates', () => {
  const csvResult = importOwnerSoldEvidence(csvFromRows([baseRow]), { format: 'csv' });
  const jsonResult = importOwnerSoldEvidence([baseRow], { format: 'json' });

  assert.equal(csvResult.publicDiagnostics.format, 'csv');
  assert.equal(jsonResult.publicDiagnostics.format, 'json');
  assert.deepEqual(csvResult.candidates, jsonResult.candidates);
  assert.equal(csvResult.publicDiagnostics.parsedUntrustedCandidateCount, 1);
  assert.equal(jsonResult.publicDiagnostics.parsedUntrustedCandidateCount, 1);
  assert.equal(Object.hasOwn(csvResult.publicDiagnostics, 'acceptedCandidateCount'), false);
  assert.equal(Object.hasOwn(jsonResult.publicDiagnostics, 'acceptedCandidateCount'), false);
  assert.equal(csvResult.validation.publicDiagnostics.canonicalReadyCount, 0);
  assert.equal(jsonResult.validation.publicDiagnostics.canonicalReadyCount, 0);
  assert.equal(csvResult.validation.publicDiagnostics.reasonCodeCounts.owner_export_requires_trusted_verification, 1);
});

test('A5.18 malformed CSV and JSON fail closed', () => {
  const malformedCsv = importOwnerSoldEvidence('"source_class,price\nowner_supplied_export,42', { format: 'csv' });
  const malformedJson = importOwnerSoldEvidence('{bad json', { format: 'json' });
  const pathInput = importOwnerSoldEvidence({ path: '/tmp/secret-owner-file.csv' }, { format: 'csv' });
  const oversized = importOwnerSoldEvidence('x'.repeat(MAX_CONTENT_BYTES + 1), { format: 'csv' });

  assert.equal(malformedCsv.valid, false);
  assert.equal(malformedCsv.publicDiagnostics.parsingReasonCodeCounts.malformed_csv, 1);
  assert.equal(malformedJson.valid, false);
  assert.equal(malformedJson.publicDiagnostics.parsingReasonCodeCounts.invalid_json, 1);
  assert.equal(pathInput.valid, false);
  assert.equal(pathInput.publicDiagnostics.parsingReasonCodeCounts.file_path_rejected, 1);
  assert.equal(oversized.publicDiagnostics.parsingReasonCodeCounts.oversized_import, 1);
  assert.equal(malformedCsv.publicDiagnostics.parsedUntrustedCandidateCount, 0);
  assert.equal(malformedJson.publicDiagnostics.parsedUntrustedCandidateCount, 0);
});

test('A5.18 CSV parser preserves quoted commas, escaped quotes, and quoted newlines', () => {
  const row = {
    ...baseRow,
    source_provider_name: 'Owner, Spreadsheet "Provider"',
    parallel: 'Silver\nWave'
  };
  const result = importOwnerSoldEvidence(csvFromRows([row]), { format: 'csv' });

  assert.equal(result.publicDiagnostics.parsedUntrustedCandidateCount, 1);
  assert.equal(result.candidates[0].sourceProviderName, row.source_provider_name);
  assert.equal(result.candidates[0].identity.parallel, row.parallel);
  assert.equal(result.publicDiagnostics.totalRows, 1);
});

test('A5.18 rejects duplicate headers, unexpected nesting, oversized batches, and dangerous cells', () => {
  const duplicateHeader = importOwnerSoldEvidence('source_class,source_class\nowner_supplied_export,approved_api', { format: 'csv' });
  const nestedJson = importOwnerSoldEvidence([{ ...baseRow, nested: { script: 'nope' } }], { format: 'json' });
  const dangerousCsv = importOwnerSoldEvidence(csvFromRows([{ ...baseRow, final_sale_price: '=1+1' }]), { format: 'csv' });
  const tooMany = importOwnerSoldEvidence(Array.from({ length: MAX_RECORDS + 1 }, (_, index) => ({
    ...baseRow,
    transaction_id: `secret-${index}`
  })), { format: 'json' });

  assert.equal(duplicateHeader.publicDiagnostics.parsingReasonCodeCounts.duplicate_header, 1);
  assert.equal(nestedJson.publicDiagnostics.parsingReasonCodeCounts.unexpected_nesting, 1);
  assert.equal(dangerousCsv.publicDiagnostics.parsingReasonCodeCounts.dangerous_content_rejected, 1);
  assert.equal(tooMany.publicDiagnostics.parsingReasonCodeCounts.max_records_exceeded, 1);
  assert.equal(dangerousCsv.publicDiagnostics.parsedUntrustedCandidateCount, 0);
});

test('A5.18 unknown fields are reported as aggregate counts without echoing names', () => {
  const result = importOwnerSoldEvidence([{
    ...baseRow,
    'Secret Notes Column': 'raw private note',
    source_url: 'https://example.test/private'
  }], { format: 'json' });
  const serializedPublic = JSON.stringify(result.publicDiagnostics);

  assert.equal(result.publicDiagnostics.unknownFieldCount, 3);
  assert.equal(result.publicDiagnostics.rowsWithUnknownFields, 1);
  assert.equal(Object.hasOwn(result.publicDiagnostics, 'ignoredFieldNames'), false);
  assert.equal(result.internalDiagnostics.ignoredFieldNames.includes('Secret_Notes_Column'), true);
  assert.equal(serializedPublic.includes('raw private note'), false);
  assert.equal(serializedPublic.includes('https://example.test'), false);
  assert.equal(serializedPublic.includes('Secret_Notes_Column'), false);
  assert.equal(serializedPublic.includes('source_url'), false);
  assert.equal(result.publicDiagnostics.rowDiagnostics.some((row) => Object.hasOwn(row, 'ignoredFields')), false);
  assert.equal(result.candidates[0].raw_title, undefined);
});

test('A5.18 dangerous object keys are rejected in CSV and JSON without prototype pollution', () => {
  assert.equal(Object.prototype.polluted, undefined);
  const csvProto = importOwnerSoldEvidence('__proto__,source_class\npolluted,owner_supplied_export', { format: 'csv' });
  const csvConstructor = importOwnerSoldEvidence(' constructor ,source_class\npolluted,owner_supplied_export', { format: 'csv' });
  const jsonProto = importOwnerSoldEvidence(JSON.parse('{"__proto__":"polluted","source_class":"owner_supplied_export"}'), { format: 'json' });
  const jsonPrototype = importOwnerSoldEvidence([{ prototype: 'polluted', ...baseRow }], { format: 'json' });
  const jsonConstructor = importOwnerSoldEvidence([{ constructor: 'polluted', ...baseRow }], { format: 'json' });
  const serializedPublic = JSON.stringify(jsonProto.publicDiagnostics);

  assert.equal(csvProto.publicDiagnostics.parsingReasonCodeCounts.dangerous_object_key, 1);
  assert.equal(csvConstructor.publicDiagnostics.parsingReasonCodeCounts.dangerous_object_key, 1);
  assert.equal(jsonProto.publicDiagnostics.parsingReasonCodeCounts.dangerous_object_key, 1);
  assert.equal(jsonPrototype.publicDiagnostics.parsingReasonCodeCounts.dangerous_object_key, 1);
  assert.equal(jsonConstructor.publicDiagnostics.parsingReasonCodeCounts.dangerous_object_key, 1);
  assert.equal(jsonProto.publicDiagnostics.parsedUntrustedCandidateCount, 0);
  assert.equal(serializedPublic.includes('__proto__'), false);
  assert.equal(serializedPublic.includes('prototype'), false);
  assert.equal(serializedPublic.includes('constructor'), false);
  assert.equal(Object.prototype.polluted, undefined);
});

test('A5.18 imported trust claims and file-supplied trustedContext cannot create readiness', () => {
  const row = {
    ...baseRow,
    source_class: 'approved_api',
    provenance_categories: 'provider_api|platform_transaction_record',
    confirmation_status: 'confirmed_final_price',
    exact_identity_verified: 'true',
    identity_status: 'exact',
    retention_status: 'permanent_allowed',
    trustedContext: 'malicious'
  };
  const result = importOwnerSoldEvidence({ content: [row], trustedContext: { sourcePolicies: [{ malicious: true }] } }, { format: 'json' });

  assert.equal(result.validation.publicDiagnostics.canonicalReadyCount, 0);
  assert.equal(result.validation.publicDiagnostics.reasonCodeCounts.trusted_source_policy_missing, 1);
  assert.equal(result.validation.publicDiagnostics.reasonCodeCounts.trusted_identity_artifact_missing, 1);
  assert.equal(result.validation.publicDiagnostics.reasonCodeCounts.trusted_sale_confirmation_missing, 1);
  assert.equal(result.validation.publicDiagnostics.reasonCodeCounts.untrusted_identity_claim, 1);
  assert.equal(result.validation.publicDiagnostics.reasonCodeCounts.untrusted_confirmation_claim, 1);
  assert.equal(result.validation.publicDiagnostics.reasonCodeCounts.untrusted_permission_claim, 1);
  assert.equal(result.publicDiagnostics.parsingReasonCodeCounts.trusted_context_ignored, 1);
  assert.equal(result.publicDiagnostics.readinessCounts.canonicalReady, 0);
  assert.equal(result.publicDiagnostics.readinessCounts.rejected, 1);
});

test('A5.18 active, asking, estimated, and unconfirmed imports remain non-canonical', () => {
  const statuses = ['active_listing', 'asking_price', 'estimated', 'unconfirmed'];
  const result = importOwnerSoldEvidence(statuses.map((status, index) => ({
    ...baseRow,
    transaction_id: `status-${index}`,
    confirmation_status: status
  })), { format: 'json' });

  assert.equal(result.validation.publicDiagnostics.canonicalReadyCount, 0);
  assert.equal(result.validation.publicDiagnostics.reasonCodeCounts.active_or_asking_price_not_canonical_ready, 2);
  assert.equal(result.validation.publicDiagnostics.reasonCodeCounts.estimated_price_not_canonical_ready, 1);
  assert.equal(result.validation.publicDiagnostics.reasonCodeCounts.unconfirmed_price_not_canonical_ready, 1);
});

test('A5.18 duplicate imported rows do not inflate public readiness counts or expose stable fingerprints', () => {
  const result = importOwnerSoldEvidence([baseRow, baseRow], { format: 'json' });
  const serializedPublic = JSON.stringify(result.publicDiagnostics);

  assert.equal(result.publicDiagnostics.duplicateCount, 1);
  assert.equal(result.publicDiagnostics.parsingReasonCodeCounts.duplicate_row_detected, 1);
  assert.equal(result.publicDiagnostics.parsedUntrustedCandidateCount, 2);
  assert.equal(result.validation.publicDiagnostics.canonicalReadyCount, 0);
  assert.equal(result.internalDiagnostics.duplicateFingerprints.length, 1);
  assert.equal(Object.hasOwn(result.publicDiagnostics, 'duplicateFingerprints'), false);
  assert.equal(serializedPublic.includes(result.internalDiagnostics.duplicateFingerprints[0]), false);
  assert.equal(serializedPublic.includes('secret-transaction-123'), false);
});

test('A5.18 preserves input objects and summaries remain sanitized', () => {
  const input = [{ ...baseRow }];
  const before = JSON.stringify(input);
  const result = importOwnerSoldEvidence(input, { format: 'json' });
  const summary = summarizeOwnerSoldEvidenceImport(result);
  const serializedSummary = JSON.stringify(summary);

  assert.equal(JSON.stringify(input), before);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.publicDiagnostics), true);
  assert.equal(serializedSummary.includes(baseRow.transaction_id), false);
  assert.equal(serializedSummary.includes(baseRow.subject_name), false);
  assert.equal(serializedSummary.includes(baseRow.final_sale_price), false);
  assert.equal(serializedSummary.includes('SHOULD_NOT_APPEAR_PUBLICLY'), false);
});

test('A5.18 field mapping is explicit and conservative', () => {
  const candidate = mapRowToA5Candidate(baseRow);

  assert.equal(candidate.sourceClass, 'owner_supplied_export');
  assert.equal(candidate.sourceProviderName, baseRow.source_provider_name);
  assert.equal(candidate.externalTransactionId, baseRow.transaction_id);
  assert.equal(candidate.externalListingId, baseRow.listing_id);
  assert.equal(candidate.finalSalePrice, 42.5);
  assert.equal(candidate.confirmationStatus, 'owner_verified_final_price');
  assert.equal(candidate.identity.player, 'Anthony Hernandez');
  assert.equal(candidate.identity.brand, 'Panini');
  assert.equal(candidate.identity.cardNumber, '181');
  assert.equal(candidate.identity.rookie, true);
  assert.equal(candidate.identity.autograph, false);
  assert.deepEqual(candidate.provenanceCategories, ['owner_export', 'platform_transaction_record']);
});

test('A5.18 adapter imports no filesystem, network, persistence, runtime, or marketplace execution modules', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'validation', 'ownerSoldEvidenceImportAdapter.js'), 'utf8');
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
