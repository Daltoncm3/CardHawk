'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  extractManualSoldRecords,
  importManualSoldEvidence,
  prevalidateManualRecord,
  validateManualSoldRecord
} = require('../validation/manualSoldEvidenceImportHelper');
const {
  findSoldEvidenceByIdentity,
  loadSoldEvidenceStore
} = require('../utils/soldEvidenceStore');

const identity = {
  category: 'sports_card',
  sport: 'football',
  player: 'Joe Burrow',
  year: 2020,
  brand: 'Panini',
  product: 'Prizm',
  setName: 'Prizm',
  cardNumber: '307',
  parallel: 'Base',
  rookie: true,
  autograph: false,
  memorabilia: false,
  serialNumbered: false
};

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cardhawk-manual-sold-helper-'));
}

function deterministicClock() {
  let calls = 0;
  return () => {
    const value = calls === 0
      ? '2026-07-14T00:00:00.000Z'
      : '2026-07-14T00:00:01.000Z';
    calls += 1;
    return value;
  };
}

function soldRecord(overrides = {}) {
  return {
    marketplace: 'eBay',
    marketplaceSaleId: 'manual-sale-001',
    marketplaceListingId: 'manual-listing-001',
    rawTitle: '2020 Panini Prizm Joe Burrow RC #307 PSA 10',
    soldPrice: 125,
    shipping: 5,
    soldAt: '2026-07-04T12:00:00.000Z',
    saleType: 'buy_it_now',
    url: 'https://example.test/sold/manual-sale-001',
    image: 'https://example.test/sold/manual-sale-001.jpg',
    condition: 'PSA 10',
    gradeCompany: 'PSA',
    grade: '10',
    parsedIdentity: identity,
    evidenceQualityScore: 95,
    evidenceQualityLevel: 'strong',
    source: {
      adapter: 'manual_verified_fixture',
      retrievalMethod: 'manual_verified_batch',
      sourceReliability: 'dealer_verified',
      acquiredAt: '2026-07-10T00:00:00.000Z',
      query: 'manual joe burrow psa 10'
    },
    ...overrides
  };
}

test('manual helper imports valid manually verified records into the canonical store', () => {
  const result = importManualSoldEvidence({
    input: [soldRecord()],
    now: deterministicClock()
  });
  const matches = findSoldEvidenceByIdentity(result.store, identity);

  assert.equal(result.source, 'manual_sold_evidence_import_helper');
  assert.equal(result.version, '1.0.0');
  assert.equal(result.dryRun, false);
  assert.equal(result.report.totalRecords, 1);
  assert.equal(result.report.importedRecords, 1);
  assert.equal(result.report.rejectedRecords, 0);
  assert.equal(result.report.duplicateRecords, 0);
  assert.deepEqual(result.report.validationFailures, []);
  assert.equal(result.report.importedSaleIds[0], 'manual-sale-001');
  assert.equal(result.report.processingTime.durationMs, 1000);
  assert.equal(result.report.sourceSummary.marketplaces.ebay, 1);
  assert.equal(result.report.sourceSummary.adapters.manual_verified_fixture, 1);
  assert.equal(result.report.sourceSummary.sourceReliability.dealer_verified, 1);
  assert.equal(result.report.sourceSummary.retrievalMethods.manual_verified_batch, 1);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].evidenceType, 'true_sold');
  assert.equal(matches[0].marketplaceSaleId, 'manual-sale-001');
  assert.equal(matches[0].source.adapter, 'manual_verified_fixture');
});

test('manual helper rejects duplicate imports without overwriting the existing canonical record', () => {
  const result = importManualSoldEvidence({
    input: [
      soldRecord(),
      soldRecord({
        rawTitle: 'Duplicate with same sale id should not overwrite',
        soldPrice: 999
      })
    ],
    now: deterministicClock()
  });
  const records = Object.values(result.store.records);

  assert.equal(result.report.totalRecords, 2);
  assert.equal(result.report.importedRecords, 1);
  assert.equal(result.report.duplicateRecords, 1);
  assert.equal(result.report.rejectedRecords, 0);
  assert.equal(result.report.rejectionReasons.duplicate_record, 1);
  assert.equal(result.report.validationFailures[0].reasons[0], 'duplicate_record');
  assert.equal(records.length, 1);
  assert.equal(records[0].soldPrice, 125);
  assert.equal(records[0].rawTitle, '2020 Panini Prizm Joe Burrow RC #307 PSA 10');
});

test('manual helper rejects malformed and active/context records with clear reason codes', () => {
  const invalid = soldRecord({
    marketplaceSaleId: 'bad-active',
    evidenceType: 'active_context',
    status: 'context_only',
    sold: false,
    soldPrice: 0,
    soldAt: null
  });
  const validation = validateManualSoldRecord(invalid);
  const result = importManualSoldEvidence({
    input: [invalid],
    now: deterministicClock()
  });

  assert.equal(validation.valid, false);
  assert.equal(validation.reasons.includes('not_true_sold_evidence'), true);
  assert.equal(validation.reasons.includes('missing_sold_price'), true);
  assert.equal(validation.reasons.includes('missing_sold_date'), true);
  assert.equal(result.report.importedRecords, 0);
  assert.equal(result.report.rejectedRecords, 1);
  assert.equal(result.report.rejectionReasons.not_true_sold_evidence, 1);
  assert.equal(Object.keys(result.store.records).length, 0);
});

test('manual helper rejects records missing identity before canonical insertion', () => {
  const record = soldRecord({
    marketplaceSaleId: 'missing-identity',
    parsedIdentity: undefined,
    identity: undefined,
    parsed: undefined
  });
  const prevalidation = prevalidateManualRecord(record);
  const result = importManualSoldEvidence({
    input: [record],
    now: deterministicClock()
  });

  assert.equal(prevalidation.valid, false);
  assert.equal(prevalidation.reasons.includes('missing_identity'), true);
  assert.equal(result.report.importedRecords, 0);
  assert.equal(result.report.rejectedRecords, 1);
  assert.equal(result.report.rejectionReasons.missing_identity, 1);
});

test('manual helper rejects missing provenance instead of allowing normalization defaults to fill it', () => {
  const record = soldRecord({
    marketplaceSaleId: 'missing-provenance',
    source: {},
    url: ''
  });
  const validation = validateManualSoldRecord(record);

  assert.equal(validation.valid, false);
  assert.equal(validation.reasons.includes('missing_source_url'), true);
  assert.equal(validation.reasons.includes('missing_source_adapter'), true);
  assert.equal(validation.reasons.includes('missing_source_retrieval_method'), true);
  assert.equal(validation.reasons.includes('missing_source_reliability'), true);
  assert.equal(validation.reasons.includes('missing_source_acquired_at'), true);
});

test('manual helper reads incremental batch files and writes only the configured canonical store path', () => {
  const directory = makeTempDir();
  const inputPath = path.join(directory, 'manual-batch.json');
  const storePath = path.join(directory, 'canonical-sold-store.json');
  fs.writeFileSync(inputPath, JSON.stringify({ manualSoldRecords: [soldRecord()] }, null, 2));

  const result = importManualSoldEvidence({
    inputPath,
    storePath,
    now: deterministicClock()
  });
  const loaded = loadSoldEvidenceStore(storePath);

  assert.equal(result.report.importedRecords, 1);
  assert.equal(loaded.stats.recordCount, 1);
  assert.equal(findSoldEvidenceByIdentity(loaded, identity).length, 1);
});

test('manual helper dry-run validates imports without writing a store file', () => {
  const directory = makeTempDir();
  const inputPath = path.join(directory, 'manual-batch.json');
  const storePath = path.join(directory, 'canonical-sold-store.json');
  fs.writeFileSync(inputPath, JSON.stringify([soldRecord()], null, 2));

  const result = importManualSoldEvidence({
    inputPath,
    storePath,
    dryRun: true,
    now: deterministicClock()
  });

  assert.equal(result.dryRun, true);
  assert.equal(result.report.importedRecords, 1);
  assert.equal(fs.existsSync(storePath), false);
});

test('manual helper reports are deterministic for identical replay input', () => {
  const first = importManualSoldEvidence({
    input: [soldRecord()],
    now: deterministicClock()
  });
  const second = importManualSoldEvidence({
    input: [soldRecord()],
    now: deterministicClock()
  });

  assert.deepEqual(first.report, second.report);
});

test('manual helper extracts records from supported batch shapes', () => {
  const record = soldRecord();

  assert.deepEqual(extractManualSoldRecords([record]), [record]);
  assert.deepEqual(extractManualSoldRecords({ records: [record] }), [record]);
  assert.deepEqual(extractManualSoldRecords({ soldRecords: [record] }), [record]);
  assert.deepEqual(extractManualSoldRecords({ soldEvidence: [record] }), [record]);
  assert.deepEqual(extractManualSoldRecords({ verifiedSoldRecords: [record] }), [record]);
  assert.deepEqual(extractManualSoldRecords({ manualSoldRecords: [record] }), [record]);
  assert.deepEqual(extractManualSoldRecords({ nope: [record] }), []);
});
