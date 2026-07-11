'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  ACCESS_MODES,
  ADAPTER_STATUS,
  EVIDENCE_TYPES,
  INTERFACE_VERSION,
  assertAdapterContract,
  createAcquisitionRegistry,
  createAcquisitionRequest,
  createCanonicalAcquisitionAdapter,
  normalizeAcquisitionCapabilities,
  validateAcquisitionRequest,
  validateRawEvidenceRecord
} = require('../marketplaces/canonicalAcquisitionInterface');

const identity = {
  category: 'sports_card',
  sport: 'mma',
  player: 'Anthony Hernandez',
  year: '2023',
  brand: 'Panini',
  setName: 'Prizm UFC',
  cardNumber: '181',
  parallel: 'Silver Prizm',
  rookie: true,
  autograph: false,
  memorabilia: false,
  serialNumbered: false
};

function rawSoldRecord(overrides = {}) {
  return {
    evidenceType: 'true_sold',
    marketplace: 'licensed_source',
    marketplaceSaleId: 'sale-001',
    marketplaceListingId: 'listing-001',
    rawTitle: '2023 Panini Prizm UFC Anthony Hernandez #181 Silver Prizm RC',
    soldPrice: 7.5,
    shipping: 1.25,
    soldAt: '2026-07-01T12:00:00.000Z',
    saleType: 'buy_it_now',
    url: 'https://example.test/sold/001',
    condition: 'raw',
    gradeCompany: 'raw',
    grade: 'unknown',
    parsedIdentity: identity,
    evidenceQualityScore: 92,
    evidenceQualityLevel: 'strong',
    source: {
      adapter: 'licensed_source_adapter',
      retrievalMethod: ACCESS_MODES.LICENSED_FEED,
      sourceReliability: 'licensed',
      acquiredAt: '2026-07-10T00:00:00.000Z'
    },
    ...overrides
  };
}

function createFixtureAdapter(overrides = {}) {
  return createCanonicalAcquisitionAdapter({
    sourceId: overrides.sourceId || 'licensed_source',
    marketplace: overrides.marketplace || 'licensed_source',
    marketplaceLabel: 'Licensed Source',
    sourceName: 'Licensed Source Feed',
    adapterName: overrides.adapterName || 'licensed_source_adapter',
    adapterVersion: '0.1.0',
    capabilities: {
      accessMode: ACCESS_MODES.LICENSED_FEED,
      sourceReliability: 'licensed',
      transactionLevelSoldSupport: true,
      aggregateMarketPriceSupport: true,
      activeContextSupport: true,
      acceptedBestOfferSupport: true,
      shippingSupport: true,
      certificationSupport: true,
      identityFields: ['category', 'player', 'year', 'setName', 'cardNumber', 'parallel'],
      provenanceFields: ['marketplace', 'adapter', 'retrievalMethod', 'sourceReliability', 'acquiredAt', 'sourceUrl'],
      supportsIncrementalSync: true,
      supportsHistoricalBackfill: true,
      commercialUse: {
        permitted: true,
        requiresLicense: true,
        redistributionAllowed: false,
        displayAllowed: false,
        notes: 'Licensed internal valuation use only.'
      },
      ...overrides.capabilities
    },
    acquire: overrides.acquire || (async (request) => ({
      request,
      records: [rawSoldRecord()],
      cursor: null
    })),
    healthCheck: overrides.healthCheck || (async () => ({
      status: ADAPTER_STATUS.READY,
      message: 'fixture ready'
    }))
  });
}

test('canonical acquisition capabilities normalize source support and commercial terms', () => {
  const capabilities = normalizeAcquisitionCapabilities({
    accessMode: ACCESS_MODES.PARTNER_API,
    sourceReliability: 'official_partner',
    transactionLevelSoldSupport: true,
    aggregateMarketPriceSupport: true,
    identityFields: ['player', 'year'],
    commercialUse: {
      permitted: true,
      requiresLicense: true,
      redistributionAllowed: false,
      displayAllowed: false,
      notes: 'contract required'
    }
  });

  assert.equal(capabilities.acquisitionInterfaceVersion, INTERFACE_VERSION);
  assert.equal(capabilities.accessMode, ACCESS_MODES.PARTNER_API);
  assert.equal(capabilities.transactionLevelSoldSupport, true);
  assert.equal(capabilities.aggregateMarketPriceSupport, true);
  assert.deepEqual(capabilities.identityFields, ['player', 'year']);
  assert.equal(capabilities.commercialUse.permitted, true);
  assert.equal(capabilities.commercialUse.redistributionAllowed, false);
});

test('acquisition request schema supports query, identity, filters, windows, and evidence types', () => {
  const request = createAcquisitionRequest({
    requestId: 'req-001',
    query: 'Anthony Hernandez Silver Prizm',
    identity,
    filters: { marketplace: 'licensed_source' },
    dateFrom: '2026-01-01',
    dateTo: '2026-07-10',
    limit: 50,
    requestedEvidenceTypes: ['true_sold', 'aggregate_market_price']
  });

  assert.equal(request.requestId, 'req-001');
  assert.equal(request.query, 'Anthony Hernandez Silver Prizm');
  assert.equal(request.identity.player, 'Anthony Hernandez');
  assert.equal(request.filters.marketplace, 'licensed_source');
  assert.equal(request.window.dateFrom, '2026-01-01T00:00:00.000Z');
  assert.equal(request.window.dateTo, '2026-07-10T00:00:00.000Z');
  assert.equal(request.limit, 50);
  assert.deepEqual(request.requestedEvidenceTypes, ['true_sold', 'aggregate_market_price']);
});

test('acquisition request validation rejects empty requests and bad limits', () => {
  const empty = validateAcquisitionRequest({});
  const badLimit = validateAcquisitionRequest({ query: 'card', limit: -1 });

  assert.equal(empty.valid, false);
  assert.deepEqual(empty.reasons, ['missing_query_or_identity']);
  assert.equal(badLimit.valid, false);
  assert.deepEqual(badLimit.reasons, ['invalid_limit']);
});

test('canonical acquisition adapter exposes required contract, capabilities, and health', async () => {
  const adapter = createFixtureAdapter();
  const contract = assertAdapterContract(adapter);
  const capabilities = adapter.getCapabilities();
  const status = await adapter.getStatus();

  assert.deepEqual(contract, { valid: true, reasons: [] });
  assert.equal(adapter.interfaceVersion, INTERFACE_VERSION);
  assert.equal(capabilities.sourceId, 'licensed_source');
  assert.equal(capabilities.capabilities.transactionLevelSoldSupport, true);
  assert.equal(capabilities.capabilities.accessMode, ACCESS_MODES.LICENSED_FEED);
  assert.equal(status.status, ADAPTER_STATUS.READY);
  assert.equal(status.message, 'fixture ready');
});

test('adapter acquisition normalizes output, provenance, identity validation, and summary', async () => {
  const adapter = createFixtureAdapter();
  const result = await adapter.acquireSoldEvidence({
    query: 'Anthony Hernandez Silver Prizm',
    identity
  });
  const record = result.records[0];

  assert.equal(result.source.sourceId, 'licensed_source');
  assert.equal(result.summary.returned, 1);
  assert.equal(result.summary.trueSoldCount, 1);
  assert.equal(result.summary.validRecordCount, 1);
  assert.equal(result.summary.invalidRecordCount, 0);
  assert.equal(record.evidenceType, EVIDENCE_TYPES.TRUE_SOLD);
  assert.equal(record.status, 'active_evidence');
  assert.equal(record.soldPrice, 7.5);
  assert.equal(record.totalPaid, 8.75);
  assert.equal(record.source.adapter, 'licensed_source_adapter');
  assert.equal(record.source.capabilities.transactionLevelSoldSupport, true);
  assert.equal(result.validation[0].valid, true);
});

test('sources without transaction-level sold support cannot emit true sold evidence', async () => {
  const adapter = createFixtureAdapter({
    capabilities: {
      transactionLevelSoldSupport: false,
      aggregateMarketPriceSupport: true
    },
    acquire: async (request) => ({
      request,
      records: [rawSoldRecord({ evidenceType: 'true_sold' })]
    })
  });
  const result = await adapter.acquireSoldEvidence({ query: 'Anthony Hernandez Silver Prizm' });
  const record = result.records[0];

  assert.equal(result.summary.trueSoldCount, 0);
  assert.equal(result.summary.aggregateMarketPriceCount, 1);
  assert.equal(record.evidenceType, EVIDENCE_TYPES.AGGREGATE_MARKET_PRICE);
  assert.equal(record.status, 'context_only');
  assert.equal(record.warnings.includes('source_without_transaction_level_sold_support'), true);
});

test('raw evidence validation flags missing identity, sold price, sold date, and provenance', () => {
  const sourceMetadata = createFixtureAdapter();
  const validation = validateRawEvidenceRecord(rawSoldRecord({
    soldPrice: 0,
    soldAt: null,
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
  }), sourceMetadata);

  assert.equal(validation.valid, false);
  assert.equal(validation.reasons.includes('missing_identity_year'), true);
  assert.equal(validation.reasons.includes('missing_identity_setName'), true);
  assert.equal(validation.reasons.includes('missing_identity_cardNumber'), true);
  assert.equal(validation.reasons.includes('missing_identity_subject'), true);
  assert.equal(validation.reasons.includes('missing_sold_price'), true);
  assert.equal(validation.reasons.includes('missing_sold_date'), true);
  assert.equal(validation.reasons.includes('missing_provenance_sourceUrl'), true);
  assert.equal(validation.reasons.includes('invalid_provenance_acquiredAt'), true);
});

test('adapter returns structured errors for invalid requests and thrown acquisition failures', async () => {
  const missingRequestAdapter = createFixtureAdapter();
  const invalid = await missingRequestAdapter.acquireSoldEvidence({});
  const throwing = createFixtureAdapter({
    acquire: async () => {
      throw new Error('source unavailable');
    }
  });
  const failed = await throwing.acquireSoldEvidence({ query: 'valid request' });

  assert.equal(invalid.summary.errorCount, 1);
  assert.equal(invalid.errors[0].code, 'missing_query_or_identity');
  assert.equal(failed.summary.errorCount, 1);
  assert.equal(failed.errors[0].message, 'source unavailable');
  assert.equal(failed.errors[0].retryable, true);
  assert.deepEqual(failed.records, []);
});

test('registry registers adapters, lists capabilities, reports health, and acquires by source id', async () => {
  const registry = createAcquisitionRegistry();
  const adapter = createFixtureAdapter();
  const registration = registry.registerAdapter(adapter);
  const listed = registry.listAdapters();
  const statuses = await registry.getStatuses();
  const result = await registry.acquire('licensed_source', { query: 'Anthony Hernandez Silver Prizm' });

  assert.deepEqual(registration, {
    registered: true,
    sourceId: 'licensed_source',
    adapterName: 'licensed_source_adapter'
  });
  assert.equal(listed.length, 1);
  assert.equal(listed[0].sourceId, 'licensed_source');
  assert.equal(statuses.length, 1);
  assert.equal(statuses[0].status, ADAPTER_STATUS.READY);
  assert.equal(result.summary.trueSoldCount, 1);
});

test('registry rejects invalid adapter contracts and handles unknown source ids safely', async () => {
  const registry = createAcquisitionRegistry();
  const registration = registry.registerAdapter({ sourceId: 'bad_adapter' });
  const result = await registry.acquire('missing_source', { query: 'card' });

  assert.equal(registration.registered, false);
  assert.equal(registration.reasons.includes('missing_adapterName'), true);
  assert.equal(registration.reasons.includes('missing_getCapabilities'), true);
  assert.equal(result.summary.errorCount, 1);
  assert.equal(result.errors[0].code, 'unknown_adapter');
  assert.deepEqual(result.records, []);
});

test('base adapter without acquisition implementation is explicit and evidence-only', async () => {
  const adapter = createCanonicalAcquisitionAdapter({
    sourceId: 'manual_future',
    marketplace: 'manual_future',
    adapterName: 'manual_future_adapter',
    capabilities: {
      accessMode: ACCESS_MODES.MANUAL_IMPORT,
      sourceReliability: 'manual',
      transactionLevelSoldSupport: true
    }
  });
  const result = await adapter.acquireSoldEvidence({ query: 'manual import candidate' });

  assert.equal(result.summary.returned, 0);
  assert.equal(result.summary.warningCount, 1);
  assert.deepEqual(result.warnings, ['adapter_has_no_acquisition_implementation']);
});
