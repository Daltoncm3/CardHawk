'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  addSoldEvidenceRecord,
  createEmptySoldEvidenceStore,
  normalizeSoldEvidenceRecord
} = require('../utils/soldEvidenceStore');
const {
  extractRecords,
  runSoldEvidenceStoreConformance,
  summarizeStoreConformance,
  validateCanonicalRecord,
  validateEvidenceType,
  validateIdentity,
  validateImportBatchConsistency,
  validateProvenance,
  validateStoreIndexes,
  validateTransactionEligibility,
  validateVersionCompatibility
} = require('../validation/soldEvidenceStoreConformance');

const identity = {
  category: 'sports_card',
  sport: 'mma',
  player: 'Anthony Hernandez',
  year: '2023',
  brand: 'Panini',
  product: 'Prizm UFC',
  setName: 'Prizm',
  cardNumber: '181',
  parallel: 'Silver Prizm',
  rookie: true,
  autograph: false,
  memorabilia: false,
  serialNumbered: false
};

function soldRecord(overrides = {}) {
  return {
    marketplace: 'eBay',
    marketplaceSaleId: 'sale-001',
    marketplaceListingId: 'listing-001',
    rawTitle: '2023 Panini Prizm UFC Anthony Hernandez #181 Silver Prizm RC',
    soldPrice: 7.5,
    shipping: 1.25,
    soldAt: '2026-07-01T12:00:00.000Z',
    saleType: 'buy_it_now',
    url: 'https://example.test/sold/anthony-hernandez-001',
    image: 'https://example.test/sold/anthony-hernandez-001.jpg',
    condition: 'raw',
    gradeCompany: 'raw',
    grade: 'unknown',
    parsedIdentity: identity,
    evidenceQualityScore: 92,
    evidenceQualityLevel: 'strong',
    source: {
      adapter: 'store_conformance_fixture',
      retrievalMethod: 'offline_conformance',
      sourceReliability: 'fixture',
      acquiredAt: '2026-07-10T00:00:00.000Z',
      query: 'anthony hernandez silver prizm'
    },
    ...overrides
  };
}

test('valid canonical sold evidence batch passes store conformance', () => {
  const report = runSoldEvidenceStoreConformance({
    records: [
      soldRecord(),
      soldRecord({
        marketplaceSaleId: 'sale-002',
        marketplaceListingId: 'listing-002',
        url: 'https://example.test/sold/anthony-hernandez-002',
        soldPrice: 8.25,
        soldAt: '2026-07-02T12:00:00.000Z'
      })
    ]
  });
  const summary = summarizeStoreConformance(report);

  assert.equal(report.passed, true);
  assert.equal(report.failedChecks, 0);
  assert.equal(report.summary.insertedRecords, 2);
  assert.equal(report.summary.storedRecords, 2);
  assert.equal(summary.passed, true);
});

test('store conformance detects missing identity and provenance fields', () => {
  const report = runSoldEvidenceStoreConformance({
    records: [
      soldRecord({
        marketplaceSaleId: 'bad-identity',
        marketplaceListingId: 'bad-identity-listing',
        url: '',
        parsedIdentity: {
          category: 'sports_card'
        },
        source: {
          adapter: '',
          retrievalMethod: '',
          sourceReliability: '',
          acquiredAt: 'not-a-date'
        }
      })
    ]
  });

  assert.equal(report.passed, false);
  assert.equal(report.failures.includes('identity_requirements'), true);
  assert.equal(report.failures.includes('provenance_requirements'), true);
  assert.equal(report.recordReports[0].validation.reasons.includes('missing_identity_year'), true);
  assert.equal(report.recordReports[0].validation.reasons.includes('missing_source_adapter'), true);
  assert.equal(report.recordReports[0].validation.reasons.includes('missing_source_url'), true);
});

test('store conformance rejects active and aggregate evidence types', () => {
  const report = runSoldEvidenceStoreConformance({
    records: [
      soldRecord({
        marketplaceSaleId: 'active-001',
        evidenceType: 'active_context',
        status: 'context_only',
        url: 'https://example.test/active/001'
      }),
      soldRecord({
        marketplaceSaleId: 'aggregate-001',
        evidenceType: 'aggregate_market_price',
        status: 'context_only',
        url: 'https://example.test/aggregate/001'
      })
    ]
  });

  assert.equal(report.passed, false);
  assert.equal(report.failures.includes('evidence_type_correctness'), true);
  assert.equal(report.recordReports[0].validation.checks.evidenceType.includes('not_true_sold_evidence'), true);
  assert.equal(report.recordReports[1].validation.checks.evidenceType.includes('not_true_sold_evidence'), true);
});

test('store conformance validates transaction-level sold eligibility', () => {
  const report = runSoldEvidenceStoreConformance({
    records: [
      soldRecord({
        marketplaceSaleId: 'missing-price',
        soldPrice: 0,
        url: 'https://example.test/sold/missing-price'
      }),
      soldRecord({
        marketplaceSaleId: 'missing-date',
        soldAt: null,
        url: 'https://example.test/sold/missing-date'
      })
    ]
  });

  assert.equal(report.passed, false);
  assert.equal(report.failures.includes('transaction_level_sold_eligibility'), true);
  assert.equal(report.recordReports[0].validation.checks.transactionEligibility.includes('missing_sold_price'), true);
  assert.equal(report.recordReports[1].validation.checks.transactionEligibility.includes('missing_sold_date'), true);
});

test('store conformance validates duplicate handling and import batch consistency', () => {
  const report = runSoldEvidenceStoreConformance({
    records: [
      soldRecord(),
      soldRecord({
        rawTitle: 'Duplicate with same sale id',
        soldPrice: 999
      })
    ]
  });

  assert.equal(report.passed, true);
  assert.equal(report.summary.duplicateRecords, 1);
  assert.equal(report.summary.storedRecords, 1);
  assert.equal(report.checks.find((check) => check.name === 'duplicate_handling').pass, true);
  assert.equal(report.checks.find((check) => check.name === 'import_batch_consistency').pass, true);
});

test('version compatibility detects incompatible stores', () => {
  const invalid = validateVersionCompatibility({
    source: 'old_store',
    version: 999
  });

  assert.equal(invalid.valid, false);
  assert.deepEqual(invalid.reasons, ['store_source_mismatch', 'store_version_mismatch']);
});

test('store index validation detects broken indexes and stats', () => {
  const insert = addSoldEvidenceRecord(createEmptySoldEvidenceStore(), soldRecord());
  const broken = JSON.parse(JSON.stringify(insert.store));
  const record = Object.values(broken.records)[0];
  broken.identityIndex = {};
  broken.duplicateIndex = {};
  broken.stats.recordCount = 99;

  const validation = validateStoreIndexes(broken);

  assert.equal(validation.valid, false);
  assert.equal(validation.reasons.includes(`identity_index_missing:${record.id}`), true);
  assert.equal(validation.reasons.includes('stats_record_count_mismatch'), true);
});

test('canonical record validation covers schema, identity, provenance, evidence, transaction, and immutable checks', () => {
  const valid = validateCanonicalRecord(normalizeSoldEvidenceRecord(soldRecord()));
  const invalid = validateCanonicalRecord({
    evidenceType: 'active_context',
    status: 'context_only',
    soldPrice: 0,
    parsedIdentity: {},
    source: {}
  });

  assert.equal(valid.valid, true);
  assert.equal(invalid.valid, false);
  assert.equal(invalid.checks.schema.length > 0, true);
  assert.equal(invalid.checks.identity.includes('missing_identity_year'), true);
  assert.equal(invalid.checks.provenance.includes('missing_source_adapter'), true);
  assert.equal(invalid.checks.evidenceType.includes('not_true_sold_evidence'), true);
  assert.equal(invalid.checks.transactionEligibility.includes('missing_sold_price'), true);
  assert.equal(invalid.checks.immutable.includes('missing_immutable_id'), true);
});

test('deterministic fixture replay passes for stable fixtures', () => {
  const report = runSoldEvidenceStoreConformance({
    records: [soldRecord()]
  });

  assert.equal(report.checks.find((check) => check.name === 'deterministic_fixture_replay').pass, true);
});

test('extractRecords supports array, wrapped batch, and store-shaped inputs', () => {
  const record = soldRecord();

  assert.equal(extractRecords([record]).length, 1);
  assert.equal(extractRecords({ verifiedSoldRecords: [record] }).length, 1);
  assert.equal(extractRecords({ records: { one: record } }).length, 1);
});

test('individual validators expose focused diagnostics', () => {
  const record = normalizeSoldEvidenceRecord(soldRecord());
  const active = { ...record, evidenceType: 'active_context', status: 'context_only' };
  const missingTransaction = { ...record, soldPrice: 0, soldAt: null };
  const batch = validateImportBatchConsistency([record], [{ id: record.id, inserted: false, duplicate: true }]);

  assert.equal(validateIdentity(record).valid, true);
  assert.equal(validateProvenance(record).valid, true);
  assert.equal(validateEvidenceType(active).valid, false);
  assert.equal(validateTransactionEligibility(missingTransaction).valid, false);
  assert.equal(batch.valid, false);
  assert.equal(batch.reasons.includes(`batch_duplicate_missing_target:${record.id}`), true);
});
