'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  EVIDENCE_TYPES,
  normalizeAdapterRecord,
  normalizeCapabilities
} = require('../marketplaces/soldEvidenceAdapter');
const {
  addSoldEvidenceRecord,
  buildCanonicalCardKey,
  createEmptySoldEvidenceStore
} = require('../utils/soldEvidenceStore');
const {
  isTrueSoldRecord,
  querySoldEvidence,
  summarizeSoldEvidence
} = require('../services/soldEvidenceService');

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

function normalizeFixture(record, capabilities = {}) {
  return normalizeAdapterRecord(record, {
    marketplace: record.marketplace || 'fixture',
    marketplaceLabel: record.marketplace || 'Fixture',
    sourceName: 'Sold Evidence Service Test',
    adapterName: 'sold_evidence_service_test_adapter',
    capabilities: normalizeCapabilities({
      transactionLevelSoldSupport: true,
      acceptedBestOfferSupport: true,
      shippingSupport: true,
      certificationSupport: true,
      aggregateMarketPriceSupport: true,
      activeContextSupport: true,
      accessMode: 'fixture',
      sourceReliability: 'fixture',
      ...capabilities
    })
  }, {
    retrievalMethod: 'fixture'
  });
}

function sale(overrides = {}) {
  return {
    evidenceType: 'true_sold',
    marketplace: 'eBay',
    marketplaceSaleId: 'sale-1',
    rawTitle: '2023 Panini Prizm Victor Wembanyama #136 Silver Prizm RC PSA 10',
    soldPrice: 100,
    shipping: 5,
    soldAt: '2026-07-01T12:00:00.000Z',
    condition: 'PSA 10',
    gradeCompany: 'PSA',
    grade: '10',
    parsedIdentity: identity,
    evidenceQualityScore: 90,
    evidenceQualityLevel: 'strong',
    ...overrides
  };
}

function buildStore(records) {
  const store = createEmptySoldEvidenceStore();
  for (const record of records) {
    if (record.evidenceType === 'true_sold') {
      addSoldEvidenceRecord(store, record, { mutate: true });
      continue;
    }

    store.records[record.id] = record;
    if (!store.identityIndex[record.canonicalCardKey]) {
      store.identityIndex[record.canonicalCardKey] = [];
    }
    store.identityIndex[record.canonicalCardKey].push(record.id);
    for (const key of record.duplicateKeys || []) {
      store.duplicateIndex[key] = record.id;
    }
  }
  store.stats.recordCount = Object.keys(store.records).length;
  store.stats.identityCount = Object.keys(store.identityIndex).length;
  store.stats.duplicateKeyCount = Object.keys(store.duplicateIndex).length;
  return store;
}

function buildMixedStore() {
  return buildStore([
    normalizeFixture(sale({
      marketplaceSaleId: 'sale-1',
      soldPrice: 100,
      shipping: 5,
      soldAt: '2026-07-01T12:00:00.000Z',
      marketplace: 'eBay',
      evidenceQualityScore: 90
    })),
    normalizeFixture(sale({
      marketplaceSaleId: 'sale-2',
      soldPrice: 120,
      shipping: 0,
      soldAt: '2026-06-15T12:00:00.000Z',
      marketplace: 'COMC',
      condition: 'Raw',
      gradeCompany: 'raw',
      grade: 'unknown',
      evidenceQualityScore: 75,
      evidenceQualityLevel: 'good'
    })),
    normalizeFixture(sale({
      marketplaceSaleId: 'sale-3',
      soldPrice: 80,
      shipping: 4,
      soldAt: '2025-10-01T12:00:00.000Z',
      marketplace: 'eBay',
      evidenceQualityScore: 65,
      evidenceQualityLevel: 'usable'
    })),
    normalizeFixture(sale({
      evidenceType: 'active_context',
      marketplaceSaleId: 'active-1',
      soldPrice: 999,
      soldAt: '2026-07-05T12:00:00.000Z',
      marketplace: 'eBay'
    })),
    normalizeFixture(sale({
      evidenceType: 'true_sold',
      marketplaceSaleId: 'aggregate-1',
      soldPrice: 777,
      soldAt: '2026-07-06T12:00:00.000Z',
      marketplace: 'Aggregate Provider'
    }), {
      transactionLevelSoldSupport: false,
      aggregateMarketPriceSupport: true
    })
  ]);
}

test('querySoldEvidence queries by canonical card identity', () => {
  const store = buildMixedStore();
  const result = querySoldEvidence(store, identity, {}, { asOf: '2026-07-10T00:00:00.000Z' });

  assert.equal(result.canonicalCardKey, buildCanonicalCardKey(identity));
  assert.equal(result.matchingRecords.length, 3);
  assert.equal(result.trueSoldCount, 3);
  assert.deepEqual(result.matchingRecords.map((record) => record.marketplaceSaleId), ['sale-1', 'sale-2', 'sale-3']);
});

test('querySoldEvidence supports marketplace and date range filters', () => {
  const store = buildMixedStore();
  const result = querySoldEvidence(store, identity, {
    marketplace: 'eBay',
    dateFrom: '2026-01-01T00:00:00.000Z',
    dateTo: '2026-07-02T00:00:00.000Z'
  }, {
    asOf: '2026-07-10T00:00:00.000Z'
  });

  assert.equal(result.matchingRecords.length, 1);
  assert.equal(result.matchingRecords[0].marketplaceSaleId, 'sale-1');
  assert.equal(result.trueSoldCount, 1);
  assert.equal(result.newestSoldDate, '2026-07-01T12:00:00.000Z');
});

test('querySoldEvidence supports evidence quality and grade condition filters', () => {
  const store = buildMixedStore();
  const strongPsa = querySoldEvidence(store, identity, {
    minEvidenceQualityScore: 80,
    gradeCompany: 'PSA',
    grade: '10',
    condition: 'graded'
  }, {
    asOf: '2026-07-10T00:00:00.000Z'
  });
  const rawGood = querySoldEvidence(store, identity, {
    evidenceQualityLevel: 'good',
    condition: 'raw'
  });

  assert.equal(strongPsa.matchingRecords.length, 1);
  assert.equal(strongPsa.matchingRecords[0].marketplaceSaleId, 'sale-1');
  assert.equal(rawGood.matchingRecords.length, 1);
  assert.equal(rawGood.matchingRecords[0].marketplaceSaleId, 'sale-2');
});

test('querySoldEvidence returns sold summary metrics from true sold evidence only', () => {
  const store = buildMixedStore();
  const result = querySoldEvidence(store, identity, {}, { asOf: '2026-07-10T00:00:00.000Z' });

  assert.equal(result.trueSoldCount, 3);
  assert.equal(result.recentSoldCount, 2);
  assert.equal(result.medianSold, 105);
  assert.equal(result.weightedSoldAverage, 109.32);
  assert.equal(result.newestSoldDate, '2026-07-01T12:00:00.000Z');
  assert.equal(result.freshCount, 2);
  assert.equal(result.staleCount, 1);
  assert.deepEqual(result.sourceMix, {
    ebay: 2,
    comc: 1
  });
});

test('active_context and aggregate_market_price are never counted as true sold', () => {
  const store = buildMixedStore();
  const contextIncluded = querySoldEvidence(store, identity, { trueSoldOnly: false }, {
    asOf: '2026-07-10T00:00:00.000Z'
  });

  assert.equal(contextIncluded.matchingRecords.length, 5);
  assert.equal(contextIncluded.matchingRecords.some((record) => record.evidenceType === EVIDENCE_TYPES.ACTIVE_CONTEXT), true);
  assert.equal(contextIncluded.matchingRecords.some((record) => record.evidenceType === EVIDENCE_TYPES.AGGREGATE_MARKET_PRICE), true);
  assert.equal(contextIncluded.trueSoldCount, 3);
  assert.equal(contextIncluded.medianSold, 105);
  assert.equal(isTrueSoldRecord(contextIncluded.matchingRecords.find((record) => record.marketplaceSaleId === 'active-1')), false);
  assert.equal(isTrueSoldRecord(contextIncluded.matchingRecords.find((record) => record.marketplaceSaleId === 'aggregate-1')), false);
});

test('empty sold evidence query returns safe zero metrics', () => {
  const result = querySoldEvidence(createEmptySoldEvidenceStore(), identity);

  assert.equal(result.matchingRecords.length, 0);
  assert.equal(result.trueSoldCount, 0);
  assert.equal(result.recentSoldCount, 0);
  assert.equal(result.medianSold, null);
  assert.equal(result.weightedSoldAverage, null);
  assert.equal(result.newestSoldDate, null);
  assert.equal(result.freshCount, 0);
  assert.equal(result.staleCount, 0);
  assert.deepEqual(result.sourceMix, {});
});

test('sold evidence service is read-only and does not mutate the store', () => {
  const store = buildMixedStore();
  const before = JSON.stringify(store);

  querySoldEvidence(store, identity, { trueSoldOnly: false });
  summarizeSoldEvidence(Object.values(store.records));

  assert.equal(JSON.stringify(store), before);
});
