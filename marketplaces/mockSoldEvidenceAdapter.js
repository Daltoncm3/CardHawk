'use strict';

const {
  createSoldEvidenceAdapter,
  summarizeEvidenceTypes
} = require('./soldEvidenceAdapter');

const DEFAULT_FIXTURES = [
  {
    evidenceType: 'true_sold',
    marketplaceSaleId: 'mock-sold-001',
    marketplaceListingId: 'mock-listing-001',
    rawTitle: '2023 Panini Prizm Mock Player #1 Silver Prizm RC PSA 10',
    soldPrice: 42,
    shipping: 4.99,
    soldAt: '2026-07-01T12:00:00.000Z',
    saleType: 'buy_it_now',
    url: 'https://example.invalid/mock-sold/001',
    image: 'https://example.invalid/mock-sold/001.jpg',
    gradeCompany: 'PSA',
    grade: '10',
    condition: 'PSA 10',
    parsedIdentity: {
      category: 'sports_card',
      sport: 'basketball',
      player: 'Mock Player',
      year: 2023,
      brand: 'Panini',
      setName: 'Prizm',
      cardNumber: '1',
      parallel: 'Silver Prizm',
      rookie: true
    },
    evidenceQualityScore: 90,
    evidenceQualityLevel: 'strong',
    evidenceQuality: {
      score: 90,
      level: 'strong',
      reasons: ['fixture transaction-level sold evidence']
    }
  }
];

function createMockSoldEvidenceAdapter(options = {}) {
  const fixtures = Array.isArray(options.fixtures) ? options.fixtures.map((fixture) => ({ ...fixture })) : DEFAULT_FIXTURES.map((fixture) => ({ ...fixture }));
  const adapter = createSoldEvidenceAdapter({
    marketplace: options.marketplace || 'mock_sold',
    marketplaceLabel: options.marketplaceLabel || 'Mock Sold Evidence',
    sourceName: options.sourceName || 'Mock Sold Evidence Adapter',
    adapterName: 'mock_sold_evidence_adapter',
    capabilities: {
      transactionLevelSoldSupport: options.transactionLevelSoldSupport !== false,
      acceptedBestOfferSupport: Boolean(options.acceptedBestOfferSupport),
      shippingSupport: options.shippingSupport !== false,
      certificationSupport: options.certificationSupport !== false,
      aggregateMarketPriceSupport: options.aggregateMarketPriceSupport !== false,
      activeContextSupport: options.activeContextSupport !== false,
      accessMode: 'fixture',
      sourceReliability: options.sourceReliability || 'fixture'
    }
  });

  return {
    ...adapter,

    async searchSoldEvidence(query = {}, searchOptions = {}) {
      const limit = Math.max(0, Number(searchOptions.limit ?? fixtures.length) || fixtures.length);
      const records = fixtures
        .slice(0, limit)
        .map((fixture) => adapter.normalizeRecord({
          ...fixture,
          source: {
            ...(fixture.source || {}),
            query: typeof query === 'string' ? query : query.query || ''
          }
        }, {
          includeRawRecord: Boolean(searchOptions.includeRawRecord)
        }));

      return {
        source: {
          marketplace: adapter.marketplace,
          marketplaceLabel: adapter.marketplaceLabel,
          sourceName: adapter.sourceName,
          adapterName: adapter.adapterName,
          capabilities: { ...adapter.capabilities }
        },
        query,
        records,
        summary: summarizeEvidenceTypes(records)
      };
    }
  };
}

module.exports = {
  DEFAULT_FIXTURES,
  createMockSoldEvidenceAdapter
};
