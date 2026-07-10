'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const soldEvidenceStore = require('../utils/soldEvidenceStore');

const anthonyIdentity = {
  category: 'sports_card',
  sport: 'ufc',
  player: 'Anthony Hernandez',
  year: 2023,
  brand: 'Panini',
  product: 'Prizm UFC',
  setName: 'Prizm',
  cardNumber: '#181',
  parallel: 'Silver Prizm',
  rookie: true,
  autograph: false,
  memorabilia: false,
  serialNumbered: false
};

function buildSale(overrides = {}) {
  return {
    marketplace: 'eBay',
    marketplaceSaleId: 'sale-123',
    marketplaceListingId: 'listing-123',
    rawTitle: '2023 Panini Prizm UFC Anthony Hernandez #181 Silver Prizm RC Rookie',
    soldPrice: 8.5,
    shipping: 1.25,
    soldAt: '2026-07-01T18:30:00.000Z',
    saleType: 'auction',
    url: 'https://example.test/sold/123',
    image: 'https://example.test/sold/123.jpg',
    condition: 'Raw',
    seller: {
      username: 'card-seller',
      feedbackScore: 1200,
      feedbackPercentage: 99.8,
      marketplaceSellerId: 'seller-123'
    },
    parsedIdentity: anthonyIdentity,
    identityConfidence: 0.94,
    priceConfidence: 0.97,
    soldDateConfidence: 0.96,
    evidenceQualityScore: 91,
    evidenceQualityLevel: 'strong',
    evidenceQuality: {
      score: 91,
      level: 'strong',
      reasons: ['verified sold price', 'matched card identity']
    },
    source: {
      adapter: 'fixture_adapter',
      acquiredAt: '2026-07-10T00:00:00.000Z',
      query: 'anthony hernandez 181 silver prizm',
      retrievalMethod: 'manual_import',
      sourceReliability: 'high'
    },
    ...overrides
  };
}

test('canonical sold evidence record creation normalizes permanent shape', () => {
  const record = soldEvidenceStore.createCanonicalSoldEvidenceRecord(buildSale());

  assert.equal(record.evidenceType, 'true_sold');
  assert.equal(record.marketplace, 'ebay');
  assert.equal(record.marketplaceLabel, 'eBay');
  assert.equal(record.soldPrice, 8.5);
  assert.equal(record.shipping, 1.25);
  assert.equal(record.totalPaid, 9.75);
  assert.equal(record.soldAt, '2026-07-01T18:30:00.000Z');
  assert.equal(record.saleType, 'auction');
  assert.equal(record.rawTitle, '2023 Panini Prizm UFC Anthony Hernandez #181 Silver Prizm RC Rookie');
  assert.equal(record.normalizedTitle, '2023 panini prizm ufc anthony hernandez 181 silver prizm rc rookie');
  assert.equal(record.parsedIdentity.cardNumber, '181');
  assert.equal(record.parsedIdentity.rookie, true);
  assert.equal(record.canonicalCardKey, 'sports-card:ufc:2023:panini:prizm:anthony-hernandez:181:silver-prizm:non-auto:non-mem:unnumbered');
  assert.equal(record.source.adapter, 'fixture_adapter');
  assert.ok(record.duplicateKeys.length >= 3);
});

test('normalization fills safe defaults for sparse adapter records', () => {
  const record = soldEvidenceStore.normalizeSoldEvidenceRecord({
    marketplace: 'COMC',
    title: 'Sparse Sold Card',
    price: '12.34',
    dateSold: '2026-06-01',
    identity: {
      category: 'sports_card',
      player: 'Sparse Player',
      year: '2024',
      set: 'Test Set',
      number: '7'
    }
  }, {
    acquiredAt: '2026-07-10T00:00:00.000Z'
  });

  assert.equal(record.marketplace, 'comc');
  assert.equal(record.soldPrice, 12.34);
  assert.equal(record.totalPaid, 12.34);
  assert.equal(record.currency, 'USD');
  assert.equal(record.saleType, 'unknown');
  assert.equal(record.condition, 'unknown');
  assert.equal(record.gradeCompany, 'unknown');
  assert.equal(record.status, 'active_evidence');
  assert.equal(record.source.adapter, 'manual_import');
  assert.ok(record.evidenceQualityScore > 0);
});

test('empty store behavior is safe and queryable', () => {
  const store = soldEvidenceStore.createEmptySoldEvidenceStore({
    createdAt: '2026-07-10T00:00:00.000Z',
    updatedAt: '2026-07-10T00:00:00.000Z'
  });

  assert.equal(store.source, 'sold_evidence_store');
  assert.equal(store.version, 1);
  assert.deepEqual(store.records, {});
  assert.deepEqual(store.duplicateIndex, {});
  assert.deepEqual(store.identityIndex, {});
  assert.equal(store.stats.recordCount, 0);
  assert.deepEqual(soldEvidenceStore.findSoldEvidenceByIdentity(store, anthonyIdentity), []);
});

test('deduplication prevents duplicate insertion by marketplace sale id', () => {
  const initial = soldEvidenceStore.createEmptySoldEvidenceStore();
  const first = soldEvidenceStore.addSoldEvidenceRecord(initial, buildSale());
  const second = soldEvidenceStore.addSoldEvidenceRecord(first.store, buildSale({
    rawTitle: 'Different title but same marketplace sale id',
    soldPrice: 99
  }));

  assert.equal(first.inserted, true);
  assert.equal(second.inserted, false);
  assert.equal(second.duplicate, true);
  assert.equal(second.duplicateOf, first.record.id);
  assert.equal(Object.keys(second.store.records).length, 1);
  assert.equal(second.store.stats.recordCount, 1);
  assert.equal(second.store.stats.duplicateInsertions, 1);
});

test('deduplication prevents duplicate insertion by fingerprint when sale id is missing', () => {
  const firstSale = buildSale({
    marketplaceSaleId: null,
    marketplaceListingId: null,
    url: '',
    seller: { username: 'same-seller' }
  });
  const duplicateSale = {
    ...firstSale,
    id: undefined,
    marketplaceSaleId: null,
    marketplaceListingId: null,
    url: '',
    seller: { username: 'same-seller' }
  };
  let result = soldEvidenceStore.addSoldEvidenceRecord(soldEvidenceStore.createEmptySoldEvidenceStore(), firstSale);
  result = soldEvidenceStore.addSoldEvidenceRecord(result.store, duplicateSale);

  assert.equal(result.inserted, false);
  assert.equal(result.duplicate, true);
  assert.equal(result.store.stats.recordCount, 1);
});

test('identity lookup returns active evidence for a canonical card identity', () => {
  const initial = soldEvidenceStore.createEmptySoldEvidenceStore();
  const { store } = soldEvidenceStore.addSoldEvidenceRecords(initial, [
    buildSale({ marketplaceSaleId: 'sale-1', marketplaceListingId: 'listing-1', url: 'https://example.test/sold/1', soldAt: '2026-07-01T00:00:00.000Z', soldPrice: 8 }),
    buildSale({ marketplaceSaleId: 'sale-2', marketplaceListingId: 'listing-2', url: 'https://example.test/sold/2', soldAt: '2026-07-05T00:00:00.000Z', soldPrice: 10 }),
    buildSale({
      marketplaceSaleId: 'sale-3',
      marketplaceListingId: 'listing-3',
      url: 'https://example.test/sold/3',
      soldAt: '2026-07-06T00:00:00.000Z',
      parsedIdentity: { ...anthonyIdentity, cardNumber: '182' },
      soldPrice: 12
    })
  ]);

  const matches = soldEvidenceStore.findSoldEvidenceByIdentity(store, anthonyIdentity);

  assert.equal(matches.length, 2);
  assert.equal(matches[0].marketplaceSaleId, 'sale-2');
  assert.equal(matches[1].marketplaceSaleId, 'sale-1');
});

test('evidence quality metadata is preserved exactly when provided', () => {
  const record = soldEvidenceStore.normalizeSoldEvidenceRecord(buildSale({
    evidenceQualityScore: 77,
    evidenceQualityLevel: 'good',
    evidenceQuality: {
      score: 77,
      level: 'good',
      reasons: ['licensed data source', 'image verified']
    }
  }));

  assert.equal(record.evidenceQualityScore, 77);
  assert.equal(record.evidenceQualityLevel, 'good');
  assert.deepEqual(record.evidenceQuality, {
    score: 77,
    level: 'good',
    reasons: ['licensed data source', 'image verified']
  });
});

test('store load and save use explicit temp files only', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cardhawk-sold-evidence-'));
  const filePath = path.join(directory, 'sold-evidence.json');

  const insert = soldEvidenceStore.addSoldEvidenceRecord(
    soldEvidenceStore.createEmptySoldEvidenceStore(),
    buildSale()
  );

  soldEvidenceStore.saveSoldEvidenceStore(filePath, insert.store);
  const loaded = soldEvidenceStore.loadSoldEvidenceStore(filePath);
  const matches = soldEvidenceStore.findSoldEvidenceByIdentity(loaded, anthonyIdentity);

  assert.equal(fs.existsSync(filePath), true);
  assert.equal(loaded.stats.recordCount, 1);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].marketplaceSaleId, 'sale-123');
});
