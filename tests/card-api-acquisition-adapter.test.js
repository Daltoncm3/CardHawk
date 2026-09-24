'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  API_KEY_ENV,
  CONTROL_CANONICAL_CARD_KEY,
  CONTROL_QUERY,
  DEFAULT_ADAPTER_NAME,
  LIVE_FLAG_ENV,
  MAX_COMPATIBILITY_LIMIT,
  PROVIDER_METADATA_FEATURE_CATEGORIES,
  OHTANI_CONTROL_QUERY,
  buildPreservedProviderIdentityMetadata,
  boundedLimit,
  buildCardApiSalesUrl,
  buildLocalCanonicalCardKey,
  createCardApiAcquisitionAdapter,
  executeCardApiSalesRequest,
  isCompletedSale,
  runCardApiCompatibilityPilot,
  summarizeCardApiCompatibility,
  translateCardApiSaleToRawCanonical
} = require('../marketplaces/cardApiAcquisitionAdapter');

function providerSale(overrides = {}) {
  return {
    id: 'ebay-387214905012',
    platform: 'eBay',
    listing_type: 'best_offer',
    title: '2023 Panini Prizm UFC Anthony Hernandez #181 Silver Prizm Rookie',
    sale_date: '2026-09-16',
    sold_at: '2026-09-16T00:00:00Z',
    price: 9.75,
    original_price: 12,
    currency: 'USD',
    price_confirmed: true,
    image_url: 'https://example.test/image.jpg',
    thumbnail_url: 'https://example.test/thumb.jpg',
    listing_url: 'https://www.ebay.com/itm/387214905012',
    card_set: 'Prizm',
    card_number: '181',
    year: 2023,
    sport: 'UFC',
    category: 'sports',
    features: ['Rookie'],
    print_run: null,
    shipping_price: 1.25,
    player: 'Anthony Hernandez',
    manufacturer: 'Panini',
    product: 'Prizm',
    parallel: 'Silver Prizm',
    grader: null,
    grade: null,
    ...overrides
  };
}

function env(overrides = {}) {
  return {
    [API_KEY_ENV]: '',
    [LIVE_FLAG_ENV]: '',
    ...overrides
  };
}

test('credential absence fails closed without exposing secrets', async () => {
  const adapter = createCardApiAcquisitionAdapter({ env: env() });
  const result = await adapter.acquireSoldEvidence({ query: CONTROL_QUERY, limit: 1 });
  const serialized = JSON.stringify(result);

  assert.equal(result.records.length, 0);
  assert.equal(result.errors[0].code, 'card_api_key_missing');
  assert.equal(serialized.includes('tca_'), false);
});

test('live flag absence fails closed even when API key exists', async () => {
  const result = await executeCardApiSalesRequest({ query: CONTROL_QUERY, limit: 1 }, {
    env: env({ [API_KEY_ENV]: 'tca_test_secret' })
  });
  const serialized = JSON.stringify(result);

  assert.equal(result.records.length, 0);
  assert.equal(result.errors[0].code, 'card_api_live_flag_missing');
  assert.equal(serialized.includes('tca_test_secret'), false);
});

test('API key is never exposed in provider error reports', async () => {
  const result = await executeCardApiSalesRequest({ query: CONTROL_QUERY, limit: 1 }, {
    env: env({
      [API_KEY_ENV]: 'tca_test_secret',
      [LIVE_FLAG_ENV]: 'true'
    }),
    fetchImpl: async () => ({
      ok: false,
      status: 401,
      headers: {
        get: (name) => (name === 'content-type' ? 'application/json' : null)
      },
      json: async () => ({ error: 'bad key tca_test_secret' })
    })
  });
  const serialized = JSON.stringify(result);

  assert.equal(result.errors[0].code, 'card_api_request_failed');
  assert.equal(result.errors[0].providerStatus, 401);
  assert.equal(serialized.includes('tca_test_secret'), false);
  assert.equal(result.metadata.diagnostics.request.authHeaderPresent, true);
  assert.equal(result.metadata.diagnostics.request.headerNames.includes('x-market-api-key'), true);
  assert.equal(result.metadata.diagnostics.response.providerBodySnippet.includes('[REDACTED_API_KEY]'), true);
});

test('valid provider transaction maps to CardHawk-compatible true sold candidate', () => {
  const mapped = translateCardApiSaleToRawCanonical(providerSale(), {
    acquiredAt: '2026-09-18T00:00:00.000Z'
  });

  assert.equal(mapped.evidenceType, 'true_sold');
  assert.equal(mapped.status, 'active_evidence');
  assert.equal(mapped.marketplace, 'eBay');
  assert.equal(mapped.marketplaceSaleId, 'ebay-387214905012');
  assert.equal(mapped.soldPrice, 9.75);
  assert.equal(mapped.shipping, 1.25);
  assert.equal(mapped.totalPaid, 11);
  assert.equal(mapped.saleType, 'best_offer');
  assert.equal(mapped.bestOfferAccepted, true);
  assert.equal(mapped.priceDisclosure, 'best_offer_reported_price');
  assert.equal(mapped.source.retrievalMethod, 'card_api_compatibility_pilot');
  assert.equal(mapped.retention.status, 'prohibited');
  assert.equal(mapped.providerCompatibility.completedSaleEvent, true);
  assert.equal(mapped.providerCompatibility.canonicalReadySoldPrice, true);
  assert.equal(mapped.providerCompatibility.priceConfirmed, true);
  assert.equal(mapped.providerCompatibility.priceConfirmationStatus, 'confirmed');
  assert.equal(mapped.providerCompatibility.priceConfirmationReasonCode, null);
});

test('A5.16A preserves documented provider identity metadata internally with bounded feature categories only', () => {
  const metadata = buildPreservedProviderIdentityMetadata(providerSale({
    cert: 'PSA-SECRET-CERT-123',
    condition: 'graded',
    grading_company: 'Professional Sports Authenticator',
    has_autograph_grade: true,
    has_grade_qualifier: true,
    label: '2023 Panini Prizm UFC Anthony Hernandez Silver Prizm #181 PSA 10',
    grade_qualifier: 'OC',
    autograph_grade: '10',
    team: 'Factory Team Value',
    features: [
      'Auto',
      'Rookie',
      'Patch',
      'Serial Numbered',
      'mystery provider-only value',
      { unsafe: true },
      'Auto'
    ]
  }));

  assert.equal(metadata.values.cert, 'PSA-SECRET-CERT-123');
  assert.equal(metadata.values.grading_company, 'Professional Sports Authenticator');
  assert.equal(metadata.availableFields.includes('cert'), true);
  assert.equal(metadata.manualReviewOnlyFields.includes('cert'), true);
  assert.equal(metadata.unusedFields.includes('cert'), true);
  assert.equal(metadata.forwardedFields.includes('grading_company'), true);
  assert.equal(metadata.forwardedFields.includes('team'), false);
  assert.deepEqual(metadata.featureCategories, [
    'autograph',
    'memorabilia',
    'rookie',
    'serial_numbered'
  ]);
  assert.deepEqual(
    metadata.featureCategories.filter((category) => PROVIDER_METADATA_FEATURE_CATEGORIES.includes(category)),
    metadata.featureCategories
  );
  assert.equal(JSON.stringify(metadata).includes('mystery provider-only value'), false);
});

test('A5.16A preserved metadata never changes provisional confirmed-price boundaries', () => {
  const mapped = translateCardApiSaleToRawCanonical(providerSale({
    price_confirmed: false,
    cert: 'PSA-SECRET-CERT-999',
    grading_company: 'PSA',
    features: ['Auto', 'Rookie']
  }));

  assert.equal(mapped.evidenceType, 'active_context');
  assert.equal(mapped.status, 'provisional_price_context');
  assert.equal(mapped.certificationNumber, null);
  assert.equal(mapped.providerCompatibility.canonicalReadySoldPrice, false);
  assert.equal(mapped.providerCompatibility.providerIdentityMetadata.availableFields.includes('cert'), true);
  assert.equal(mapped.providerCompatibility.providerIdentityMetadata.featureCategories.includes('autograph'), true);
});

test('unconfirmed Card API prices fail closed as provisional context, not canonical true sold evidence', () => {
  const cases = [
    {
      label: 'false',
      price_confirmed: false,
      reason: 'provider_price_unconfirmed'
    },
    {
      label: 'missing',
      removePriceConfirmed: true,
      reason: 'provider_price_confirmation_missing'
    },
    {
      label: 'malformed_object',
      price_confirmed: { confirmed: true },
      reason: 'provider_price_confirmation_malformed'
    },
    {
      label: 'string_true',
      price_confirmed: 'true',
      reason: 'provider_price_confirmation_malformed'
    }
  ];

  for (const input of cases) {
    const sale = providerSale({
      id: `ebay-${input.label}`,
      price_confirmed: input.price_confirmed
    });
    if (input.removePriceConfirmed) delete sale.price_confirmed;
    const mapped = translateCardApiSaleToRawCanonical(sale, {
      acquiredAt: '2026-09-18T00:00:00.000Z'
    });

    assert.equal(isCompletedSale(sale), true);
    assert.equal(mapped.evidenceType, 'active_context');
    assert.equal(mapped.status, 'provisional_price_context');
    assert.equal(mapped.providerCompatibility.completedSaleEvent, true);
    assert.equal(mapped.providerCompatibility.canonicalReadySoldPrice, false);
    assert.equal(mapped.providerCompatibility.priceConfirmed, false);
    assert.equal(mapped.providerCompatibility.priceConfirmationStatus, 'unconfirmed');
    assert.equal(mapped.providerCompatibility.priceConfirmationReasonCode, input.reason);
    assert.equal(mapped.providerCompatibility.missingProviderFields.includes('price_confirmed'), true);
    assert.equal(mapped.warnings.includes(input.reason), true);
    assert.equal(mapped.source.sourceReliability, 'provider_reported_unconfirmed_price');
    assert.equal(mapped.marketplaceSaleId, sale.id);
    assert.equal(mapped.url, sale.listing_url);
    assert.equal(JSON.stringify(mapped).includes('tca_'), false);
  }
});

test('unconfirmed Card API prices are excluded from canonical compatibility counts', () => {
  const confirmed = translateCardApiSaleToRawCanonical(providerSale({ id: 'confirmed-sale' }), {
    acquiredAt: '2026-09-18T00:00:00.000Z'
  });
  const unconfirmed = translateCardApiSaleToRawCanonical(providerSale({
    id: 'unconfirmed-sale',
    price: 999,
    sold_at: '2026-01-01T00:00:00.000Z',
    sale_date: '2026-01-01',
    price_confirmed: false
  }), {
    acquiredAt: '2026-09-18T00:00:00.000Z'
  });
  const report = summarizeCardApiCompatibility({
    records: [confirmed, unconfirmed],
    errors: [],
    metadata: { liveExecution: true }
  });

  assert.equal(report.transactionsReturned, 2);
  assert.equal(report.trueSoldTransactions, 1);
  assert.equal(report.minimumFieldCompatibleRecords, 1);
  assert.equal(report.canonicalizableRecords, 1);
  assert.deepEqual(report.soldPriceRange, { min: 9.75, max: 9.75 });
  assert.deepEqual(report.soldDateRange, {
    from: '2026-09-16T00:00:00.000Z',
    to: '2026-09-16T00:00:00.000Z'
  });
  assert.equal(report.anthonyHernandezControlMatches, 1);
  assert.equal(report.fieldAvailability.bestOfferRecordsPresent, true);
  assert.equal(report.fieldAvailability.acceptedPriceFieldAvailable, true);
  assert.equal(report.missingCardHawkRequiredFields.includes('price_confirmed'), true);
  assert.equal(report.technicalCompatibility, 'COMPATIBLE');
  assert.equal(JSON.stringify(report).includes('unconfirmed-sale'), false);
});

test('missing required provider fields are reported deterministically', () => {
  const mapped = translateCardApiSaleToRawCanonical(providerSale({
    id: '',
    title: '',
    price: null,
    sale_date: null,
    sold_at: null,
    listing_url: ''
  }));
  const report = summarizeCardApiCompatibility({ records: [mapped], errors: [], metadata: { liveExecution: true } });

  assert.equal(mapped.providerCompatibility.missingProviderFields.includes('id'), true);
  assert.equal(mapped.providerCompatibility.missingProviderFields.includes('title'), true);
  assert.equal(mapped.providerCompatibility.missingProviderFields.includes('price'), true);
  assert.equal(mapped.providerCompatibility.missingProviderFields.includes('sold_at'), true);
  assert.equal(report.missingCardHawkRequiredFields.includes('price'), true);
  assert.equal(report.missingCardHawkRequiredFields.includes('sold_at'), true);
});

test('completed sale versus non-sale distinction works', () => {
  assert.equal(isCompletedSale(providerSale()), true);
  assert.equal(isCompletedSale(providerSale({ status: 'active' })), false);
  assert.equal(isCompletedSale(providerSale({ price: 0 })), false);

  const active = translateCardApiSaleToRawCanonical(providerSale({ status: 'active' }));
  assert.equal(active.evidenceType, 'active_context');
  assert.equal(active.status, 'context_only');
});

test('exact Anthony Hernandez identity can canonicalize when sufficient fields exist', () => {
  const mapped = translateCardApiSaleToRawCanonical(providerSale());
  assert.equal(buildLocalCanonicalCardKey(mapped.parsedIdentity), CONTROL_CANONICAL_CARD_KEY);
});

test('incompatible identity does not become Anthony Hernandez', () => {
  const mapped = translateCardApiSaleToRawCanonical(providerSale({
    id: 'ebay-111',
    title: '2023 Panini Prizm UFC Bo Nickal #204 Silver Prizm Rookie',
    player: 'Bo Nickal',
    card_number: '204'
  }));

  assert.notEqual(buildLocalCanonicalCardKey(mapped.parsedIdentity), CONTROL_CANONICAL_CARD_KEY);
});

test('no persistence, notification, scanner, or marketplace execution modules are imported', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'marketplaces', 'cardApiAcquisitionAdapter.js'), 'utf8');

  for (const forbidden of [
    'addSoldEvidenceRecord',
    'saveSoldEvidenceStore',
    'saveScoutedListing',
    'appStore',
    'stateStore',
    'notification',
    'scoutScannerService',
    'targetedDiscoveryLaneService',
    'ebayMarketplace',
    'server.js',
    'BUY_NOW'
  ]) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});

test('no execution authority exists in adapter outputs', async () => {
  const pilot = await runCardApiCompatibilityPilot({
    env: env(),
    fetchImpl: async () => {
      throw new Error('must not run');
    }
  });

  assert.equal(pilot.report.nonPersistent, true);
  assert.equal(pilot.report.writesProductionStore, false);
  assert.equal(pilot.report.executedLive, false);
  assert.equal(pilot.report.technicalCompatibility, 'NOT_TESTED');
});

test('provider errors fail safely without response body exposure', async () => {
  const adapter = createCardApiAcquisitionAdapter({
    env: env({
      [API_KEY_ENV]: 'tca_test_secret',
      [LIVE_FLAG_ENV]: 'true'
    }),
    fetchImpl: async () => ({
      ok: false,
      status: 500,
      headers: {
        get: (name) => (name === 'content-type' ? 'application/json' : null)
      },
      json: async () => ({ raw: 'provider diagnostic message' })
    })
  });
  const result = await adapter.acquireSoldEvidence({ query: CONTROL_QUERY, limit: 1 });

  assert.equal(result.records.length, 0);
  assert.equal(result.errors[0].code, 'card_api_request_failed');
  assert.equal(result.metadata.diagnostics.request.method, 'GET');
  assert.equal(result.metadata.diagnostics.request.path, '/api/v1/market/sales');
  assert.equal(result.metadata.diagnostics.request.queryParameterNames.join(','), 'limit,q');
  assert.equal(result.metadata.diagnostics.response.status, 500);
  assert.equal(result.metadata.diagnostics.response.contentType, 'application/json');
  assert.equal(result.metadata.diagnostics.response.providerBodySnippet.includes('provider diagnostic message'), true);
});

test('bounded result and request behavior is enforced', async () => {
  let requestedUrl = null;
  const sales = Array.from({ length: 8 }, (_, index) => providerSale({
    id: `ebay-${index}`,
    title: `2023 Panini Prizm UFC Anthony Hernandez #181 Silver Prizm Rookie ${index}`
  }));
  const result = await executeCardApiSalesRequest({ query: CONTROL_QUERY, limit: 999 }, {
    env: env({
      [API_KEY_ENV]: 'tca_test_secret',
      [LIVE_FLAG_ENV]: 'true'
    }),
    fetchImpl: async (url) => {
      requestedUrl = new URL(url);
      return {
        ok: true,
        status: 200,
        headers: {
          get: (name) => (name === 'content-type' ? 'application/json' : null)
        },
        json: async () => ({ data: sales })
      };
    },
    acquiredAt: '2026-09-18T00:00:00.000Z'
  });

  assert.equal(requestedUrl.searchParams.get('limit'), String(MAX_COMPATIBILITY_LIMIT));
  assert.equal(result.records.length, MAX_COMPATIBILITY_LIMIT);
  assert.equal(result.metadata.diagnostics.request.limit, MAX_COMPATIBILITY_LIMIT);
  assert.equal(result.metadata.diagnostics.response.ok, true);
});

test('compatibility report is aggregate and redacted', async () => {
  const acquisition = await executeCardApiSalesRequest({ query: CONTROL_QUERY, limit: 2 }, {
    env: env({
      [API_KEY_ENV]: 'tca_test_secret',
      [LIVE_FLAG_ENV]: 'true'
    }),
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: {
        get: (name) => (name === 'content-type' ? 'application/json' : null)
      },
      json: async () => ({ data: [providerSale(), providerSale({ id: 'ebay-2', listing_type: 'auction', price: 11 })] })
    }),
    acquiredAt: '2026-09-18T00:00:00.000Z'
  });
  const report = summarizeCardApiCompatibility(acquisition);

  assert.equal(report.requestSucceeded, true);
  assert.equal(report.transactionsReturned, 2);
  assert.equal(report.trueSoldTransactions, 2);
  assert.equal(report.minimumFieldCompatibleRecords, 2);
  assert.equal(report.anthonyHernandezControlMatches, 2);
  assert.equal(report.fieldAvailability.bestOfferRecordsPresent, true);
  assert.equal(report.fieldAvailability.acceptedPriceFieldAvailable, true);
  assert.equal(report.fieldAvailability.shippingAvailable, true);
  assert.equal(report.fieldAvailability.stableTransactionIdAvailable, true);
  assert.equal(report.technicalCompatibility, 'COMPATIBLE');
  assert.equal(JSON.stringify(report).includes('2023 Panini Prizm UFC Anthony Hernandez'), false);
});

test('URL builder uses documented Card API sales endpoint and authentication remains header-only', () => {
  const url = buildCardApiSalesUrl({ query: CONTROL_QUERY, limit: 2 });

  assert.equal(url.origin, 'https://thecardapi.com');
  assert.equal(url.pathname, '/api/v1/market/sales');
  assert.equal(url.searchParams.get('q'), CONTROL_QUERY);
  assert.equal(url.searchParams.get('limit'), '2');
  assert.equal(url.toString().includes(API_KEY_ENV), false);
  assert.equal(boundedLimit(1000), MAX_COMPATIBILITY_LIMIT);
});

test('Ohtani control query is supported without changing Anthony Hernandez control defaults', async () => {
  let requestedUrl = null;
  const result = await executeCardApiSalesRequest({ query: OHTANI_CONTROL_QUERY, limit: 3 }, {
    env: env({
      [API_KEY_ENV]: 'tca_test_secret',
      [LIVE_FLAG_ENV]: 'true'
    }),
    fetchImpl: async (url) => {
      requestedUrl = new URL(url);
      return {
        ok: true,
        status: 200,
        headers: {
          get: (name) => (name === 'content-type' ? 'application/json' : null)
        },
        json: async () => ({ data: [] })
      };
    }
  });

  assert.equal(CONTROL_QUERY.includes('Anthony Hernandez'), true);
  assert.equal(requestedUrl.searchParams.get('q'), OHTANI_CONTROL_QUERY);
  assert.equal(requestedUrl.searchParams.get('limit'), '3');
  assert.equal(result.metadata.diagnostics.request.queryPresent, true);
  assert.equal(result.metadata.diagnostics.request.authHeaderPresent, true);
});

test('network exceptions include sanitized non-secret diagnostics only', async () => {
  const result = await executeCardApiSalesRequest({ query: OHTANI_CONTROL_QUERY, limit: 3 }, {
    env: env({
      [API_KEY_ENV]: 'tca_test_secret',
      [LIVE_FLAG_ENV]: 'true'
    }),
    fetchImpl: async () => {
      const error = new Error('upstream refused tca_test_secret');
      error.name = 'FetchError';
      throw error;
    }
  });

  assert.equal(result.records.length, 0);
  assert.equal(result.errors[0].code, 'card_api_request_exception');
  assert.equal(result.metadata.diagnostics.exception.classification, 'request_exception');
  assert.equal(result.metadata.diagnostics.exception.message.includes('[REDACTED_API_KEY]'), true);
  assert.equal(JSON.stringify(result).includes('tca_test_secret'), false);
});
