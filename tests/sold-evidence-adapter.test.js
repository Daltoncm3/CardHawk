'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  EVIDENCE_TYPES,
  createSoldEvidenceAdapter,
  normalizeAdapterRecord,
  normalizeCapabilities
} = require('../marketplaces/soldEvidenceAdapter');
const { createMockSoldEvidenceAdapter } = require('../marketplaces/mockSoldEvidenceAdapter');

const identity = {
  category: 'sports_card',
  sport: 'baseball',
  player: 'Shohei Ohtani',
  year: 2018,
  brand: 'Topps',
  setName: 'Chrome',
  cardNumber: '150',
  parallel: 'Refractor',
  rookie: true
};

function soldFixture(overrides = {}) {
  return {
    evidenceType: 'true_sold',
    marketplaceSaleId: 'sale-abc',
    marketplaceListingId: 'listing-abc',
    rawTitle: '2018 Topps Chrome Shohei Ohtani #150 Refractor RC PSA 10',
    soldPrice: 250,
    shipping: 6,
    soldAt: '2026-07-02T10:00:00.000Z',
    saleType: 'auction',
    bestOfferAccepted: false,
    url: 'https://example.test/sold/abc',
    image: 'https://example.test/sold/abc.jpg',
    condition: 'PSA 10',
    gradeCompany: 'PSA',
    grade: '10',
    parsedIdentity: identity,
    evidenceQualityScore: 92,
    evidenceQualityLevel: 'strong',
    ...overrides
  };
}

test('base sold evidence adapter exposes required source capability metadata', () => {
  const adapter = createSoldEvidenceAdapter({
    marketplace: 'fixture_market',
    marketplaceLabel: 'Fixture Market',
    sourceName: 'Fixture Sold API',
    adapterName: 'fixture_sold_adapter',
    capabilities: {
      transactionLevelSoldSupport: true,
      acceptedBestOfferSupport: true,
      shippingSupport: true,
      certificationSupport: true,
      accessMode: 'api',
      sourceReliability: 'official'
    }
  });

  assert.equal(adapter.marketplace, 'fixture_market');
  assert.equal(adapter.marketplaceLabel, 'Fixture Market');
  assert.equal(adapter.sourceName, 'Fixture Sold API');
  assert.equal(adapter.adapterName, 'fixture_sold_adapter');
  assert.equal(adapter.capabilities.transactionLevelSoldSupport, true);
  assert.equal(adapter.capabilities.acceptedBestOfferSupport, true);
  assert.equal(adapter.capabilities.shippingSupport, true);
  assert.equal(adapter.capabilities.certificationSupport, true);
  assert.equal(adapter.capabilities.accessMode, 'api');
  assert.equal(adapter.capabilities.sourceReliability, 'official');
  assert.equal(typeof adapter.searchSoldEvidence, 'function');
});

test('mock adapter returns fixture sold records normalized through soldEvidenceStore', async () => {
  const adapter = createMockSoldEvidenceAdapter({
    fixtures: [soldFixture()]
  });
  const result = await adapter.searchSoldEvidence('shohei ohtani refractor', { limit: 1 });
  const record = result.records[0];

  assert.equal(result.summary.returned, 1);
  assert.equal(result.summary.trueSoldCount, 1);
  assert.equal(record.evidenceType, EVIDENCE_TYPES.TRUE_SOLD);
  assert.equal(record.marketplace, 'mock-sold');
  assert.equal(record.marketplaceLabel, 'Mock Sold Evidence');
  assert.equal(record.soldPrice, 250);
  assert.equal(record.totalPaid, 256);
  assert.equal(record.soldAt, '2026-07-02T10:00:00.000Z');
  assert.equal(record.parsedIdentity.player, 'shohei ohtani');
  assert.equal(record.gradeCompany, 'PSA');
  assert.equal(record.source.adapter, 'mock_sold_evidence_adapter');
  assert.equal(record.source.capabilities.transactionLevelSoldSupport, true);
});

test('adapter clearly distinguishes true sold, aggregate market price, and active context records', async () => {
  const adapter = createMockSoldEvidenceAdapter({
    fixtures: [
      soldFixture({ evidenceType: 'true_sold', marketplaceSaleId: 'sold-1', soldPrice: 100 }),
      soldFixture({ evidenceType: 'aggregate_market_price', marketplaceSaleId: 'agg-1', soldPrice: 95, soldAt: '2026-07-03T00:00:00.000Z' }),
      soldFixture({ evidenceType: 'active_context', marketplaceSaleId: 'active-1', soldPrice: 110, soldAt: '2026-07-04T00:00:00.000Z' })
    ]
  });
  const result = await adapter.searchSoldEvidence('mixed evidence');

  assert.equal(result.summary.trueSoldCount, 1);
  assert.equal(result.summary.aggregateMarketPriceCount, 1);
  assert.equal(result.summary.activeContextCount, 1);
  assert.deepEqual(result.records.map((record) => record.evidenceType), [
    EVIDENCE_TYPES.TRUE_SOLD,
    EVIDENCE_TYPES.AGGREGATE_MARKET_PRICE,
    EVIDENCE_TYPES.ACTIVE_CONTEXT
  ]);
  assert.equal(result.records[1].status, 'context_only');
  assert.equal(result.records[2].status, 'context_only');
});

test('sources without transaction-level sold support never produce true sold evidence', async () => {
  const adapter = createMockSoldEvidenceAdapter({
    transactionLevelSoldSupport: false,
    fixtures: [soldFixture({ evidenceType: 'true_sold' })]
  });
  const result = await adapter.searchSoldEvidence('aggregate-only source');
  const record = result.records[0];

  assert.equal(result.summary.trueSoldCount, 0);
  assert.equal(result.summary.aggregateMarketPriceCount, 1);
  assert.equal(record.evidenceType, EVIDENCE_TYPES.AGGREGATE_MARKET_PRICE);
  assert.equal(record.status, 'context_only');
  assert.ok(record.warnings.includes('source_without_transaction_level_sold_support'));
});

test('source without transaction or aggregate support downgrades attempted true sold to active context', () => {
  const record = normalizeAdapterRecord(soldFixture(), {
    marketplace: 'active_only',
    marketplaceLabel: 'Active Only Source',
    sourceName: 'Active Only Source',
    adapterName: 'active_only_adapter',
    capabilities: normalizeCapabilities({
      transactionLevelSoldSupport: false,
      aggregateMarketPriceSupport: false,
      activeContextSupport: true,
      accessMode: 'scrape',
      sourceReliability: 'low'
    })
  });

  assert.equal(record.evidenceType, EVIDENCE_TYPES.ACTIVE_CONTEXT);
  assert.equal(record.status, 'context_only');
  assert.equal(record.source.sourceReliability, 'low');
  assert.ok(record.warnings.includes('source_without_transaction_level_sold_support'));
});

test('mock adapter supports Best Offer, shipping, and certification capability metadata', async () => {
  const adapter = createMockSoldEvidenceAdapter({
    acceptedBestOfferSupport: true,
    fixtures: [
      soldFixture({
        bestOfferAccepted: true,
        saleType: 'best_offer',
        shipping: 8,
        certificationNumber: '12345678'
      })
    ]
  });
  const result = await adapter.searchSoldEvidence('best offer slab');
  const record = result.records[0];

  assert.equal(adapter.capabilities.acceptedBestOfferSupport, true);
  assert.equal(adapter.capabilities.shippingSupport, true);
  assert.equal(adapter.capabilities.certificationSupport, true);
  assert.equal(record.bestOfferAccepted, true);
  assert.equal(record.saleType, 'best_offer');
  assert.equal(record.shipping, 8);
  assert.equal(record.certificationNumber, '12345678');
});

test('mock adapter is fixture-only and does not mutate fixture input', async () => {
  const fixture = soldFixture();
  const before = JSON.stringify(fixture);
  const adapter = createMockSoldEvidenceAdapter({ fixtures: [fixture] });

  await adapter.searchSoldEvidence('first call');
  await adapter.searchSoldEvidence('second call');

  assert.equal(JSON.stringify(fixture), before);
});
