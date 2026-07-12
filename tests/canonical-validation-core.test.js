'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CANONICAL_RECORD_SCHEMA_VERSION,
  CERTIFICATION_ARTIFACT_SCHEMA,
  CERTIFICATION_ARTIFACT_SCHEMA_VERSION,
  FAILURE_CLASSIFICATIONS,
  FAILURE_STAGES,
  INGESTION_MANIFEST_SCHEMA,
  INGESTION_MANIFEST_SCHEMA_VERSION,
  REASON_CODES,
  REQUIRED_ACQUISITION_PROVENANCE_FIELDS,
  REQUIRED_CANONICAL_RECORD_FIELDS,
  REQUIRED_IDENTITY_FIELDS,
  REQUIRED_STORE_SOURCE_FIELDS,
  VALIDATION_RESULT_SCHEMA_VERSION,
  buildMissingReason,
  createValidationResult,
  fingerprint,
  reasonToFailureStage,
  stableStringify,
  validateOptionalSchemaVersion
} = require('../validation/canonicalValidationCore');
const {
  normalizeSoldEvidenceRecord
} = require('../utils/soldEvidenceStore');

test('canonical validation core exposes shared contract constants', () => {
  assert.equal(VALIDATION_RESULT_SCHEMA_VERSION, '1.0.0');
  assert.equal(CANONICAL_RECORD_SCHEMA_VERSION, 1);
  assert.equal(CERTIFICATION_ARTIFACT_SCHEMA_VERSION, '1.0.0');
  assert.equal(INGESTION_MANIFEST_SCHEMA_VERSION, '1.0.0');
  assert.equal(REQUIRED_IDENTITY_FIELDS.includes('setName'), true);
  assert.equal(REQUIRED_ACQUISITION_PROVENANCE_FIELDS.includes('marketplace'), true);
  assert.equal(REQUIRED_STORE_SOURCE_FIELDS.includes('retrievalMethod'), true);
  assert.equal(REQUIRED_CANONICAL_RECORD_FIELDS.includes('duplicateKeys'), true);
  assert.equal(FAILURE_CLASSIFICATIONS.RATE_LIMITED, 'rate_limited');
});

test('canonical reason codes map to canonical failure stages', () => {
  assert.equal(reasonToFailureStage('missing_identity_year'), FAILURE_STAGES.IDENTITY);
  assert.equal(reasonToFailureStage('canonical_card_key_mismatch'), FAILURE_STAGES.IDENTITY);
  assert.equal(reasonToFailureStage('missing_provenance_sourceUrl'), FAILURE_STAGES.PROVENANCE);
  assert.equal(reasonToFailureStage('missing_source_adapter'), FAILURE_STAGES.PROVENANCE);
  assert.equal(reasonToFailureStage('missing_schema_soldAt'), FAILURE_STAGES.SCHEMA);
  assert.equal(reasonToFailureStage('not_true_sold_evidence'), FAILURE_STAGES.EVIDENCE_TYPE);
  assert.equal(reasonToFailureStage('missing_sold_price'), FAILURE_STAGES.TRANSACTION);
  assert.equal(reasonToFailureStage('duplicate_sold_evidence_record'), FAILURE_STAGES.DUPLICATE_HANDLING);

  assert.equal(reasonToFailureStage('missing_sold_price', {
    transactionStage: FAILURE_STAGES.STORE_COMPATIBILITY
  }), FAILURE_STAGES.STORE_COMPATIBILITY);
  assert.equal(reasonToFailureStage('not_true_sold_evidence', {
    evidenceStage: FAILURE_STAGES.EVIDENCE_CLASSIFICATION
  }), FAILURE_STAGES.EVIDENCE_CLASSIFICATION);
});

test('canonical validation result schema is additive and stage-aware', () => {
  const result = createValidationResult({
    reasons: [
      buildMissingReason(REASON_CODES.MISSING_IDENTITY_PREFIX, 'year'),
      REASON_CODES.MISSING_SOLD_PRICE
    ],
    recordId: 'record-1',
    canonicalCardKey: 'sports-card-key'
  });

  assert.equal(result.schemaVersion, VALIDATION_RESULT_SCHEMA_VERSION);
  assert.equal(result.valid, false);
  assert.deepEqual(result.reasons, ['missing_identity_year', 'missing_sold_price']);
  assert.equal(result.failureStages.includes(FAILURE_STAGES.IDENTITY), true);
  assert.equal(result.failureStages.includes(FAILURE_STAGES.TRANSACTION), true);
  assert.equal(result.recordId, 'record-1');
  assert.equal(result.canonicalCardKey, 'sports-card-key');
});

test('certification artifact and ingestion manifest schemas are immutable contract descriptors', () => {
  assert.equal(CERTIFICATION_ARTIFACT_SCHEMA.immutable, true);
  assert.equal(CERTIFICATION_ARTIFACT_SCHEMA.schemaVersion, CERTIFICATION_ARTIFACT_SCHEMA_VERSION);
  assert.equal(CERTIFICATION_ARTIFACT_SCHEMA.requiredFields.includes('requirements'), true);
  assert.equal(CERTIFICATION_ARTIFACT_SCHEMA.requiredAdapterFields.includes('adapterVersion'), true);

  assert.equal(INGESTION_MANIFEST_SCHEMA.immutable, true);
  assert.equal(INGESTION_MANIFEST_SCHEMA.schemaVersion, INGESTION_MANIFEST_SCHEMA_VERSION);
  assert.equal(INGESTION_MANIFEST_SCHEMA.requiredFields.includes('fingerprints'), true);
  assert.equal(INGESTION_MANIFEST_SCHEMA.requiredFields.includes('batch'), true);
});

test('fingerprinting remains deterministic regardless of object key order', () => {
  const left = { b: 2, a: { d: 4, c: 3 } };
  const right = { a: { c: 3, d: 4 }, b: 2 };

  assert.equal(stableStringify(left), stableStringify(right));
  assert.equal(fingerprint(left), fingerprint(right));
  assert.equal(fingerprint(left).length, 64);
});

test('sold evidence records receive schemaVersion while old records remain compatible', () => {
  const normalized = normalizeSoldEvidenceRecord({
    marketplace: 'ebay',
    rawTitle: '2023 Panini Prizm UFC Anthony Hernandez Silver Prizm RC #181',
    soldPrice: 7.5,
    soldAt: '2026-07-01T00:00:00.000Z',
    url: 'https://example.test/sold/1',
    parsedIdentity: {
      category: 'sports_card',
      sport: 'mma',
      player: 'Anthony Hernandez',
      year: '2023',
      brand: 'Panini',
      setName: 'Prizm UFC',
      cardNumber: '181',
      parallel: 'Silver Prizm'
    }
  });

  assert.equal(normalized.schemaVersion, CANONICAL_RECORD_SCHEMA_VERSION);
  assert.equal(validateOptionalSchemaVersion(normalized.schemaVersion).valid, true);
  assert.equal(validateOptionalSchemaVersion(undefined).valid, true);
  assert.equal(validateOptionalSchemaVersion(undefined).supported, false);
  assert.equal(validateOptionalSchemaVersion(999).valid, false);
});
