'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  ADAPTER_STATUS,
  createAcquisitionRegistry
} = require('../marketplaces/canonicalAcquisitionInterface');
const {
  ADAPTER_VERSION,
  DEFAULT_ADAPTER_NAME,
  buildEbayCapabilities,
  createEbayAcquisitionAdapter,
  mergeConfig,
  registerEbayAcquisitionAdapter,
  translateEbaySoldEvidenceRequest,
  translateEbaySoldEvidenceResponse,
  validateEbayMarketplaceRecord
} = require('../marketplaces/ebayAcquisitionAdapter');
const { runAcquisitionAdapterConformance } = require('../validation/acquisitionAdapterConformance');
const { runAcquisitionToStorePipelineConformance } = require('../validation/acquisitionToStorePipelineConformance');
const {
  CERTIFICATION_LEVELS,
  runMarketplaceAdapterCertification
} = require('../validation/marketplaceAdapterCertification');

const request = {
  requestId: 'ebay-skeleton-request',
  query: '2023 Panini Prizm UFC Anthony Hernandez Silver Prizm 181',
  identity: {
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
  },
  limit: 25
};

test('eBay adapter skeleton implements the canonical acquisition interface', async () => {
  const adapter = createEbayAcquisitionAdapter();
  const capabilities = await adapter.getCapabilities();
  const status = await adapter.getStatus();

  assert.equal(adapter.sourceId, 'ebay');
  assert.equal(adapter.adapterName, DEFAULT_ADAPTER_NAME);
  assert.equal(adapter.adapterVersion, ADAPTER_VERSION);
  assert.equal(typeof adapter.acquireSoldEvidence, 'function');
  assert.equal(typeof adapter.normalizeRecord, 'function');
  assert.equal(typeof adapter.translateRequest, 'function');
  assert.equal(typeof adapter.translateResponse, 'function');
  assert.equal(capabilities.capabilities.transactionLevelSoldSupport, false);
  assert.equal(capabilities.capabilities.accessMode, 'official_api');
  assert.equal(status.status, ADAPTER_STATUS.DISABLED);
  assert.equal(status.networkAccess, false);
});

test('eBay adapter declares configuration, authentication, rate-limit, retry, and pagination placeholders', async () => {
  const adapter = createEbayAcquisitionAdapter({
    config: {
      enabled: true,
      auth: {
        clientId: 'placeholder-client',
        scopes: ['placeholder.scope']
      },
      rateLimit: {
        requestsPerDay: 5000,
        requestsPerSecond: 5,
        burst: 10
      },
      retry: {
        maxAttempts: 3,
        backoffMs: 250,
        retryableStatusCodes: [429, 500, 503]
      },
      pagination: {
        pageSize: 100,
        maxPages: 2,
        cursorStrategy: 'offset_placeholder'
      }
    }
  });
  const capabilities = await adapter.getCapabilities();
  const status = await adapter.getStatus();

  assert.equal(status.status, ADAPTER_STATUS.UNCONFIGURED);
  assert.equal(capabilities.capabilities.rateLimit.requestsPerDay, 5000);
  assert.equal(capabilities.capabilities.ebay.authentication.placeholdersDeclared, true);
  assert.equal(capabilities.capabilities.ebay.retry.maxAttempts, 3);
  assert.equal(capabilities.capabilities.ebay.pagination.pageSize, 100);
  assert.equal(capabilities.capabilities.ebay.implemented, false);
});

test('eBay request translation is deterministic and performs no network selection', () => {
  const translated = translateEbaySoldEvidenceRequest(request, {
    marketplaceId: 'EBAY_US',
    pagination: {
      pageSize: 25,
      maxPages: 0,
      cursorStrategy: 'not_implemented'
    }
  });

  assert.equal(translated.implemented, false);
  assert.equal(translated.marketplaceId, 'EBAY_US');
  assert.equal(translated.query, request.query);
  assert.equal(translated.identity.cardNumber, '181');
  assert.equal(translated.endpoint, null);
  assert.equal(translated.authStrategy, 'oauth_placeholder');
  assert.equal(translated.notes.includes('This translator performs no network access.'), true);
});

test('eBay response translation and marketplace validation are explicit placeholders', () => {
  const response = translateEbaySoldEvidenceResponse({
    itemSummaries: [{ itemId: '123' }]
  }, {
    requestId: 'response-test'
  });
  const validation = validateEbayMarketplaceRecord({
    itemId: '123'
  });

  assert.equal(response.implemented, false);
  assert.deepEqual(response.records, []);
  assert.equal(response.errors[0].code, 'ebay_response_translation_not_implemented');
  assert.equal(response.rawResponseShape.hasItemSummaries, true);
  assert.equal(validation.valid, false);
  assert.equal(validation.reasons[0], 'ebay_marketplace_record_validation_not_implemented');
});

test('eBay acquisition returns structured not-implemented output without records', async () => {
  const adapter = createEbayAcquisitionAdapter();
  const result = await adapter.acquireSoldEvidence(request);

  assert.equal(result.records.length, 0);
  assert.equal(result.summary.returned, 0);
  assert.equal(result.summary.errorCount, 1);
  assert.equal(result.errors[0].code, 'ebay_acquisition_not_implemented');
  assert.equal(result.metadata.networkAccess, false);
  assert.equal(result.metadata.writesProductionStore, false);
  assert.equal(result.metadata.translatedRequest.implemented, false);
});

test('eBay adapter registers with the canonical acquisition registry', async () => {
  const registry = createAcquisitionRegistry();
  const { adapter, result } = registerEbayAcquisitionAdapter(registry);
  const listed = registry.listAdapters();
  const acquired = await registry.acquire(adapter.sourceId, request);

  assert.equal(result.registered, true);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].adapterName, DEFAULT_ADAPTER_NAME);
  assert.equal(acquired.errors[0].code, 'ebay_acquisition_not_implemented');
});

test('eBay skeleton passes adapter conformance where applicable without emitting true sold evidence', async () => {
  const adapter = createEbayAcquisitionAdapter();
  const report = await runAcquisitionAdapterConformance(adapter);

  assert.equal(report.passed, true);
  assert.equal(report.failedChecks, 0);
  assert.equal(report.diagnostics.validResultSummary.trueSoldCount, 0);
  assert.equal(report.diagnostics.validResultSummary.errorCount, 1);
});

test('eBay skeleton passes pipeline dry-run shape checks but has no store-eligible records', async () => {
  const adapter = createEbayAcquisitionAdapter();
  const report = await runAcquisitionToStorePipelineConformance(adapter);

  assert.equal(report.passed, true);
  assert.equal(report.dryRun, true);
  assert.equal(report.summary.emittedRecords, 0);
  assert.equal(report.summary.eligibleRecords, 0);
  assert.equal(report.summary.partialFailures, 1);
  assert.equal(report.checks.find((check) => check.name === 'dry_run_only').pass, true);
});

test('eBay skeleton certification remains Draft until live acquisition is implemented and approved', async () => {
  const adapter = createEbayAcquisitionAdapter();
  const report = await runMarketplaceAdapterCertification(adapter);

  assert.equal(report.certificationLevel, CERTIFICATION_LEVELS.DRAFT);
  assert.equal(report.passed, false);
  assert.equal(report.metrics.eligibleRecords, 0);
  assert.equal(report.summary.failedRequirements.includes('minimum_store_eligible_records_met'), true);
  assert.equal(report.summary.failedRequirements.includes('transaction_level_true_sold_supported'), true);
  assert.equal(report.unsupportedBehaviors.includes('transaction_level_true_sold'), true);
  assert.equal(report.limitations.includes('commercial_use_requires_license'), true);
});

test('eBay config merge and capability helpers are stable and do not mutate defaults', () => {
  const config = mergeConfig({
    pagination: {
      pageSize: 200
    }
  });
  const capabilities = buildEbayCapabilities(config);

  assert.equal(config.pagination.pageSize, 200);
  assert.equal(config.pagination.maxPages, 0);
  assert.equal(capabilities.maxBatchSize, 200);
  assert.equal(capabilities.commercialUse.requiresLicense, true);
});
