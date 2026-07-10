'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  importSoldEvidence,
  validateImportRecord
} = require('../validation/importSoldEvidence');
const {
  createEmptySoldEvidenceStore,
  findSoldEvidenceByIdentity,
  loadSoldEvidenceStore,
  saveSoldEvidenceStore
} = require('../utils/soldEvidenceStore');

const identity = {
  category: 'sports_card',
  sport: 'basketball',
  player: 'Victor Wembanyama',
  year: 2023,
  brand: 'Panini',
  setName: 'Prizm',
  cardNumber: '136',
  parallel: 'Silver Prizm',
  rookie: true
};

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cardhawk-sold-import-'));
}

function soldRecord(overrides = {}) {
  return {
    marketplace: 'eBay',
    marketplaceSaleId: 'sale-001',
    marketplaceListingId: 'listing-001',
    rawTitle: '2023 Panini Prizm Victor Wembanyama #136 Silver Prizm RC PSA 10',
    soldPrice: 120.5,
    shipping: 4.99,
    soldAt: '2026-07-04T12:00:00.000Z',
    saleType: 'buy it now',
    url: 'https://example.test/sold/001',
    image: 'https://example.test/sold/001.jpg',
    condition: 'PSA 10',
    gradeCompany: 'PSA',
    grade: '10',
    parsedIdentity: identity,
    source: {
      adapter: 'manual_fixture',
      retrievalMethod: 'manual_import',
      sourceReliability: 'verified'
    },
    evidenceQualityScore: 94,
    evidenceQualityLevel: 'strong',
    evidenceQuality: {
      score: 94,
      level: 'strong',
      reasons: ['dealer verified sale', 'matching card identity']
    },
    ...overrides
  };
}

test('manual import normalizes verified sold records into the canonical store', () => {
  const directory = makeTempDir();
  const inputPath = path.join(directory, 'sold-input.json');
  const storePath = path.join(directory, 'sold-store.json');
  fs.writeFileSync(inputPath, JSON.stringify({ verifiedSoldRecords: [soldRecord()] }, null, 2));

  const result = importSoldEvidence({ inputPath, storePath });
  const loaded = loadSoldEvidenceStore(storePath);
  const matches = findSoldEvidenceByIdentity(loaded, identity);

  assert.deepEqual(result.summary, {
    received: 1,
    imported: 1,
    duplicates: 0,
    rejected: 0,
    rejectionReasons: {},
    rejectedRecords: [],
    duplicateRecords: [],
    importedIds: [matches[0].id]
  });
  assert.equal(matches.length, 1);
  assert.equal(matches[0].evidenceType, 'true_sold');
  assert.equal(matches[0].marketplace, 'ebay');
  assert.equal(matches[0].soldPrice, 120.5);
  assert.equal(matches[0].soldAt, '2026-07-04T12:00:00.000Z');
});

test('manual import preserves source, identity, image, grade, condition, and evidence quality', () => {
  const result = importSoldEvidence({ input: [soldRecord()] });
  const record = Object.values(result.store.records)[0];

  assert.equal(record.marketplaceLabel, 'eBay');
  assert.equal(record.rawTitle, '2023 Panini Prizm Victor Wembanyama #136 Silver Prizm RC PSA 10');
  assert.equal(record.url, 'https://example.test/sold/001');
  assert.equal(record.image, 'https://example.test/sold/001.jpg');
  assert.equal(record.condition, 'graded');
  assert.equal(record.gradeCompany, 'PSA');
  assert.equal(record.grade, '10');
  assert.equal(record.parsedIdentity.player, 'victor wembanyama');
  assert.equal(record.source.sourceReliability, 'verified');
  assert.equal(record.evidenceQualityScore, 94);
  assert.deepEqual(record.evidenceQuality.reasons, ['dealer verified sale', 'matching card identity']);
});

test('manual import deduplicates before insertion', () => {
  const result = importSoldEvidence({
    input: [
      soldRecord(),
      soldRecord({ rawTitle: 'Duplicate with same sale id', soldPrice: 999 })
    ]
  });

  assert.equal(result.summary.received, 2);
  assert.equal(result.summary.imported, 1);
  assert.equal(result.summary.duplicates, 1);
  assert.equal(result.summary.rejected, 0);
  assert.equal(Object.keys(result.store.records).length, 1);
  assert.equal(result.summary.duplicateRecords[0].duplicateOf, Object.keys(result.store.records)[0]);
});

test('manual import rejects active listings as true sold evidence', () => {
  const active = soldRecord({
    marketplaceSaleId: 'active-001',
    evidenceType: 'active',
    status: 'active',
    sold: false
  });

  const validation = validateImportRecord(active);
  const result = importSoldEvidence({ input: [active] });

  assert.equal(validation.valid, false);
  assert.deepEqual(validation.reasons, ['active_listing_not_true_sold']);
  assert.equal(result.summary.imported, 0);
  assert.equal(result.summary.rejected, 1);
  assert.equal(result.summary.rejectionReasons.active_listing_not_true_sold, 1);
  assert.equal(Object.keys(result.store.records).length, 0);
});

test('manual import rejects records missing sold price or sold date', () => {
  const result = importSoldEvidence({
    input: [
      soldRecord({ marketplaceSaleId: 'missing-price', soldPrice: 0 }),
      soldRecord({ marketplaceSaleId: 'missing-date', soldAt: null })
    ]
  });

  assert.equal(result.summary.received, 2);
  assert.equal(result.summary.imported, 0);
  assert.equal(result.summary.rejected, 2);
  assert.equal(result.summary.rejectionReasons.missing_sold_price, 1);
  assert.equal(result.summary.rejectionReasons.missing_sold_date, 1);
  assert.equal(Object.keys(result.store.records).length, 0);
});

test('dry-run mode writes nothing to the store path', () => {
  const directory = makeTempDir();
  const inputPath = path.join(directory, 'sold-input.json');
  const storePath = path.join(directory, 'sold-store.json');
  saveSoldEvidenceStore(storePath, createEmptySoldEvidenceStore({
    createdAt: '2026-07-10T00:00:00.000Z',
    updatedAt: '2026-07-10T00:00:00.000Z'
  }));
  const before = fs.readFileSync(storePath, 'utf8');
  fs.writeFileSync(inputPath, JSON.stringify([soldRecord()], null, 2));

  const result = importSoldEvidence({ inputPath, storePath, dryRun: true });
  const after = fs.readFileSync(storePath, 'utf8');

  assert.equal(result.dryRun, true);
  assert.equal(result.summary.imported, 1);
  assert.equal(before, after);
  assert.equal(loadSoldEvidenceStore(storePath).stats.recordCount, 0);
});

test('manual import supports identity lookup after import', () => {
  const result = importSoldEvidence({
    input: [
      soldRecord({ marketplaceSaleId: 'sale-001', marketplaceListingId: 'listing-001', soldAt: '2026-07-04T12:00:00.000Z' }),
      soldRecord({ marketplaceSaleId: 'sale-002', marketplaceListingId: 'listing-002', url: 'https://example.test/sold/002', soldAt: '2026-07-05T12:00:00.000Z' })
    ]
  });
  const matches = findSoldEvidenceByIdentity(result.store, identity);

  assert.equal(result.summary.imported, 2);
  assert.equal(matches.length, 2);
  assert.equal(matches[0].marketplaceSaleId, 'sale-002');
  assert.equal(matches[1].marketplaceSaleId, 'sale-001');
});
