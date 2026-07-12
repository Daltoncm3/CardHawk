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
  createFixtureBackedResult,
  mergeConfig,
  registerEbayAcquisitionAdapter,
  translateEbaySoldEvidenceRequest,
  translateEbaySoldEvidenceResponse,
  validateEbayMarketplaceRecord
} = require('../marketplaces/ebayAcquisitionAdapter');
const {
  createEmptySoldEvidenceStore
} = require('../utils/soldEvidenceStore');
const { runAcquisitionAdapterConformance } = require('../validation/acquisitionAdapterConformance');
const { runAcquisitionToStorePipelineConformance } = require('../validation/acquisitionToStorePipelineConformance');
const {
  CERTIFICATION_LEVELS,
  runMarketplaceAdapterCertification
} = require('../validation/marketplaceAdapterCertification');
const {
  runLiveIngestionSafetyGate
} = require('../validation/liveIngestionSafetyGate');

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
  assert.equal(translated.notes.includes('This adapter performs no network access.'), true);
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

test('eBay fixture-backed mode returns canonical acquisition results without network access', async () => {
  const adapter = createEbayAcquisitionAdapter({
    config: {
      fixtureMode: {
        enabled: true,
        scenario: 'valid_subset',
        pageSize: 3
      }
    }
  });
  const status = await adapter.getStatus();
  const capabilities = await adapter.getCapabilities();
  const result = await adapter.acquireSoldEvidence(request);

  assert.equal(status.status, ADAPTER_STATUS.READY);
  assert.equal(status.networkAccess, false);
  assert.equal(status.fixtureOnly, true);
  assert.equal(capabilities.capabilities.accessMode, 'offline_fixture');
  assert.equal(capabilities.capabilities.transactionLevelSoldSupport, true);
  assert.equal(result.summary.returned, 3);
  assert.equal(result.summary.trueSoldCount, 3);
  assert.equal(result.errors.length, 0);
  assert.equal(result.metadata.fixtureOnly, true);
  assert.equal(result.metadata.networkAccess, false);
  assert.equal(result.metadata.writesProductionStore, false);
  assert.equal(result.records[0].source.adapter, DEFAULT_ADAPTER_NAME);
  assert.equal(Array.isArray(result.records[0].translationWarnings), true);
});

test('fixture-backed mode supports deterministic pagination and replay', async () => {
  const adapter = createEbayAcquisitionAdapter({
    config: {
      fixtureMode: {
        enabled: true,
        scenario: 'valid_all',
        pageSize: 2
      }
    }
  });
  const first = await adapter.acquireSoldEvidence({ ...request, limit: 2 });
  const replay = await adapter.acquireSoldEvidence({ ...request, limit: 2 });
  const second = await adapter.acquireSoldEvidence({ ...request, limit: 2, cursor: first.cursor });

  assert.deepEqual(first.records.map((record) => record.id), replay.records.map((record) => record.id));
  assert.equal(first.cursor, '2');
  assert.equal(second.records.length, 2);
  assert.notDeepEqual(first.records.map((record) => record.id), second.records.map((record) => record.id));
  assert.equal(second.metadata.pagination.cursor, 2);
});

test('fixture-backed mode supports invalid, duplicate, malformed, and partial-failure scenarios', async () => {
  const adapter = createEbayAcquisitionAdapter({
    config: {
      fixtureMode: {
        enabled: true,
        scenario: 'valid_subset'
      }
    }
  });
  const invalid = await adapter.acquireSoldEvidence({
    ...request,
    context: { fixtureScenario: 'invalid' }
  });
  const duplicates = await adapter.acquireSoldEvidence({
    ...request,
    context: { fixtureScenario: 'duplicates' }
  });
  const malformed = await adapter.acquireSoldEvidence({
    ...request,
    context: { fixtureScenario: 'malformed' }
  });
  const partial = await adapter.acquireSoldEvidence({
    ...request,
    context: { fixtureScenario: 'partial_failure' }
  });

  assert.equal(invalid.records.some((record) => record.evidenceType !== 'true_sold'), true);
  assert.equal(duplicates.records.length, 2);
  assert.equal(duplicates.records[0].marketplaceListingId, duplicates.records[1].marketplaceListingId);
  assert.equal(malformed.validation.some((entry) => !entry.valid), true);
  assert.equal(partial.errors[0].code, 'ebay_fixture_partial_failure');
  assert.equal(partial.summary.errorCount, 1);
});

test('fixture-backed mode passes acquisition conformance and acquisition-to-store conformance', async () => {
  const adapter = createEbayAcquisitionAdapter({
    config: {
      fixtureMode: {
        enabled: true,
        scenario: 'valid_subset',
        pageSize: 3
      }
    }
  });
  const adapterReport = await runAcquisitionAdapterConformance(adapter);
  const pipelineReport = await runAcquisitionToStorePipelineConformance(adapter);

  assert.equal(adapterReport.passed, true);
  assert.equal(adapterReport.diagnostics.validResultSummary.trueSoldCount, 3);
  assert.equal(pipelineReport.passed, true);
  assert.equal(pipelineReport.summary.eligibleRecords, 3);
  assert.equal(pipelineReport.summary.rejectedRecords, 0);
});

test('fixture-backed adapter can be Certified but never Production Approved by default', async () => {
  const adapter = createEbayAcquisitionAdapter({
    config: {
      fixtureMode: {
        enabled: true,
        scenario: 'valid_subset',
        pageSize: 3
      }
    }
  });
  const report = await runMarketplaceAdapterCertification(adapter);

  assert.equal(report.certificationLevel, CERTIFICATION_LEVELS.CERTIFIED);
  assert.equal(report.productionApproved, false);
  assert.equal(report.passed, true);
  assert.equal(report.capabilities.transactionLevelSoldSupport, true);
  assert.equal(report.limitations.includes('commercial_use_requires_license'), true);
});

test('fixture-backed adapter remains blocked by live ingestion safety gate without Production Approval', async () => {
  const adapter = createEbayAcquisitionAdapter({
    config: {
      fixtureMode: {
        enabled: true,
        scenario: 'valid_subset',
        pageSize: 3
      }
    }
  });
  const certificationArtifact = await runMarketplaceAdapterCertification(adapter);
  const acquisitionResult = await adapter.acquireSoldEvidence(request);
  const gate = runLiveIngestionSafetyGate({
    adapter,
    certificationArtifact,
    acquisitionResult,
    store: createEmptySoldEvidenceStore()
  }, {
    runId: 'ebay_fixture_gate_dry_run',
    createdAt: '2026-07-12T00:00:00.000Z',
    dryRun: true,
    sourcePermission: {
      status: 'approved',
      approvedBy: 'CardHawk Fixture Review',
      approvedAt: '2026-07-12T00:00:00.000Z',
      license: {
        id: 'offline-fixture-only',
        commercialUsePermitted: true,
        evidenceUse: 'offline_fixture_conformance_only'
      }
    },
    acquisitionMethod: {
      name: 'offline_fixture_acquisition',
      version: ADAPTER_VERSION,
      mode: 'offline_fixture'
    }
  });

  assert.equal(gate.dryRun, true);
  assert.equal(gate.storeWritesEnabled, false);
  assert.equal(gate.passed, false);
  assert.equal(gate.manifest.summary.certificationApproved, false);
  assert.equal(gate.rejectedRecords.length, acquisitionResult.records.length);
  assert.equal(gate.rejectedRecords.every((record) => record.reasons.includes('certification_gate_failed')), true);
  assert.equal(gate.nextStore.stats.recordCount, 0);
});

test('createFixtureBackedResult can be used directly for deterministic batch replay', () => {
  const config = mergeConfig({
    fixtureMode: {
      enabled: true,
      scenario: 'valid_all',
      pageSize: 2
    }
  });
  const first = createFixtureBackedResult({ ...request, limit: 2 }, config);
  const replay = createFixtureBackedResult({ ...request, limit: 2 }, config);

  assert.deepEqual(first.records.map((record) => record.marketplaceListingId), replay.records.map((record) => record.marketplaceListingId));
  assert.equal(first.metadata.pagination.nextCursor, '2');
  assert.equal(first.metadata.networkAccess, false);
});
