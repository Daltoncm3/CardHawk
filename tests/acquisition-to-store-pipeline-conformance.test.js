'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  ACCESS_MODES,
  ADAPTER_STATUS,
  createCanonicalAcquisitionAdapter
} = require('../marketplaces/canonicalAcquisitionInterface');
const { createManualAcquisitionAdapter } = require('../marketplaces/manualAcquisitionAdapter');
const {
  DEFAULT_REQUEST,
  runAcquisitionToStorePipelineConformance,
  stageFromReason,
  summarizePipelineConformance
} = require('../validation/acquisitionToStorePipelineConformance');

const identity = {
  category: 'sports_card',
  sport: 'mma',
  player: 'Anthony Hernandez',
  year: '2023',
  brand: 'Panini',
  product: 'Prizm UFC',
  setName: 'Prizm UFC',
  cardNumber: '181',
  parallel: 'Silver Prizm',
  rookie: true,
  autograph: false,
  memorabilia: false,
  serialNumbered: false
};

function soldRecord(overrides = {}) {
  return {
    marketplace: 'eBay',
    marketplaceSaleId: 'sale-001',
    marketplaceListingId: 'listing-001',
    sourceRecordId: 'source-row-001',
    evidenceType: 'true_sold',
    status: 'active_evidence',
    rawTitle: '2023 Panini Prizm UFC Anthony Hernandez #181 Silver Prizm RC',
    soldPrice: 7.5,
    shipping: 1.25,
    soldAt: '2026-07-01T12:00:00.000Z',
    saleType: 'buy_it_now',
    url: 'https://example.test/sold/anthony-hernandez-001',
    image: 'https://example.test/sold/anthony-hernandez-001.jpg',
    condition: 'raw',
    gradeCompany: 'raw',
    grade: 'unknown',
    parsedIdentity: identity,
    evidenceQualityScore: 92,
    evidenceQualityLevel: 'strong',
    source: {
      adapter: 'manual_dataset_entry',
      retrievalMethod: 'manual_review',
      sourceReliability: 'verified_manual',
      acquiredAt: '2026-07-10T00:00:00.000Z'
    },
    review: {
      status: 'human_verified',
      reviewer: 'dealer-a',
      reviewedAt: '2026-07-10T13:00:00.000Z',
      notes: 'Exact card identity reviewed.'
    },
    ...overrides
  };
}

function fixtureAdapter(overrides = {}) {
  return createCanonicalAcquisitionAdapter({
    sourceId: overrides.sourceId || 'pipeline_fixture_source',
    marketplace: overrides.marketplace || 'pipeline_fixture',
    marketplaceLabel: 'Pipeline Fixture',
    sourceName: 'Pipeline Fixture',
    adapterName: overrides.adapterName || 'pipeline_fixture_adapter',
    adapterVersion: overrides.adapterVersion || '1.0.0',
    capabilities: {
      accessMode: ACCESS_MODES.OFFLINE_FIXTURE,
      sourceReliability: 'fixture',
      transactionLevelSoldSupport: true,
      aggregateMarketPriceSupport: true,
      activeContextSupport: true,
      acceptedBestOfferSupport: true,
      shippingSupport: true,
      certificationSupport: true,
      identityFields: ['category', 'year', 'setName', 'cardNumber', 'player'],
      provenanceFields: ['marketplace', 'adapter', 'retrievalMethod', 'sourceReliability', 'acquiredAt'],
      supportsHealthCheck: true,
      commercialUse: {
        permitted: true,
        requiresLicense: false,
        redistributionAllowed: false,
        displayAllowed: false
      },
      ...overrides.capabilities
    },
    acquire: overrides.acquire || (async (request) => ({
      request,
      records: [soldRecord()]
    })),
    healthCheck: overrides.healthCheck || (async () => ({
      status: ADAPTER_STATUS.READY,
      message: 'pipeline fixture ready'
    }))
  });
}

test('manual acquisition adapter passes the acquisition-to-store pipeline harness', async () => {
  const adapter = createManualAcquisitionAdapter({
    batches: [
      {
        batchId: 'pipeline-valid-batch',
        records: [
          soldRecord(),
          soldRecord({
            marketplaceSaleId: 'sale-002',
            marketplaceListingId: 'listing-002',
            sourceRecordId: 'source-row-002',
            soldPrice: 8.25,
            soldAt: '2026-07-02T12:00:00.000Z',
            url: 'https://example.test/sold/anthony-hernandez-002'
          })
        ]
      }
    ]
  });
  const report = await runAcquisitionToStorePipelineConformance(adapter);
  const summary = summarizePipelineConformance(report);

  assert.equal(report.passed, true);
  assert.equal(report.dryRun, true);
  assert.equal(report.failedChecks, 0);
  assert.equal(report.summary.emittedRecords, 2);
  assert.equal(report.summary.eligibleRecords, 2);
  assert.equal(report.store.summary.storedRecords, 2);
  assert.equal(summary.passed, true);
  assert.equal(summary.dryRun, true);
});

test('pipeline reports manual batch rows rejected before adapter output', async () => {
  const adapter = createManualAcquisitionAdapter({
    batches: [
      {
        batchId: 'pipeline-invalid-batch',
        records: [
          soldRecord(),
          soldRecord({
            marketplaceSaleId: 'bad-identity',
            sourceRecordId: 'bad-source-row',
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
            },
            review: {
              status: 'unreviewed'
            }
          })
        ]
      }
    ]
  });
  const report = await runAcquisitionToStorePipelineConformance(adapter);
  const rejected = report.pipeline.manualDataset.rejectedRecords[0];

  assert.equal(report.passed, false);
  assert.equal(report.failures.includes('manual_batch_rejections'), true);
  assert.equal(report.summary.emittedRecords, 1);
  assert.equal(report.summary.manualRejectedRecords, 1);
  assert.equal(rejected.status, 'rejected_before_adapter_output');
  assert.equal(rejected.failureStages.includes('identity'), true);
  assert.equal(rejected.failureStages.includes('provenance'), true);
  assert.equal(rejected.failureStages.includes('store_compatibility'), true);
});

test('pipeline identifies duplicate records at the store eligibility stage', async () => {
  const adapter = createManualAcquisitionAdapter({
    batches: [
      {
        batchId: 'pipeline-duplicate-batch',
        records: [
          soldRecord(),
          soldRecord({
            rawTitle: 'Duplicate Anthony Hernandez sale',
            soldPrice: 999
          })
        ]
      }
    ]
  });
  const report = await runAcquisitionToStorePipelineConformance(adapter);
  const duplicateOutcome = report.pipeline.recordOutcomes.find((outcome) => outcome.duplicate);

  assert.equal(report.passed, false);
  assert.equal(report.failures.includes('pipeline_store_eligibility'), true);
  assert.equal(report.summary.duplicateRecords, 1);
  assert.equal(report.pipeline.stageSummary.duplicate_handling, 1);
  assert.equal(duplicateOutcome.failureStages.includes('duplicate_handling'), true);
  assert.equal(duplicateOutcome.eligibleForStore, false);
});

test('pipeline pinpoints malformed acquisition output by identity, provenance, and store compatibility', async () => {
  const adapter = fixtureAdapter({
    acquire: async (request) => ({
      request,
      records: [
        soldRecord({
          marketplaceSaleId: 'malformed-001',
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
        })
      ]
    })
  });
  const report = await runAcquisitionToStorePipelineConformance(adapter);
  const outcome = report.pipeline.recordOutcomes[0];

  assert.equal(report.passed, false);
  assert.equal(report.failures.includes('acquisition_record_validation'), true);
  assert.equal(report.failures.includes('store_conformance'), true);
  assert.equal(outcome.failureStages.includes('identity'), true);
  assert.equal(outcome.failureStages.includes('provenance'), true);
  assert.equal(outcome.failureStages.includes('store_compatibility'), true);
});

test('pipeline carries structured partial failures without writing to the canonical store', async () => {
  const adapter = fixtureAdapter({
    acquire: async (request) => ({
      request,
      records: [soldRecord()],
      errors: [
        {
          code: 'source_page_timeout',
          message: 'One fixture page failed.',
          retryable: true
        }
      ],
      warnings: ['partial_result']
    })
  });
  const report = await runAcquisitionToStorePipelineConformance(adapter);

  assert.equal(report.passed, true);
  assert.equal(report.summary.partialFailures, 1);
  assert.equal(report.acquisition.partialFailures[0].code, 'source_page_timeout');
  assert.equal(report.checks.find((check) => check.name === 'dry_run_only').details.writesProductionStore, false);
  assert.equal(report.store.summary.storedRecords, 1);
});

test('pipeline rejects aggregate-only sources that cannot emit true sold store evidence', async () => {
  const adapter = fixtureAdapter({
    sourceId: 'aggregate_only_pipeline_fixture',
    capabilities: {
      transactionLevelSoldSupport: false,
      aggregateMarketPriceSupport: true
    },
    acquire: async (request) => ({
      request,
      records: [soldRecord({ evidenceType: 'true_sold' })]
    })
  });
  const report = await runAcquisitionToStorePipelineConformance(adapter);
  const outcome = report.pipeline.recordOutcomes[0];

  assert.equal(report.passed, false);
  assert.equal(report.summary.capabilityMetadataFailures, 0);
  assert.equal(outcome.evidenceType, 'aggregate_market_price');
  assert.equal(outcome.failureStages.includes('evidence_classification'), true);
  assert.equal(report.pipeline.stageSummary.evidence_classification, 1);
});

test('pipeline detects adapter contract and capability metadata failures', async () => {
  const report = await runAcquisitionToStorePipelineConformance({
    sourceId: 'broken_pipeline_adapter'
  });

  assert.equal(report.passed, false);
  assert.equal(report.failures.includes('adapter_contract'), true);
  assert.equal(report.failures.includes('capability_metadata'), true);
  assert.equal(report.pipeline.stageSummary.adapter_contract, 1);
  assert.equal(report.summary.adapterContractFailures, 1);
  assert.equal(report.summary.capabilityMetadataFailures > 0, true);
});

test('pipeline detects nondeterministic fixture replay', async () => {
  let counter = 0;
  const adapter = fixtureAdapter({
    acquire: async (request) => {
      counter += 1;
      return {
        request,
        records: [
          soldRecord({
            marketplaceSaleId: `sale-${counter}`,
            marketplaceListingId: `listing-${counter}`,
            sourceRecordId: `row-${counter}`,
            url: `https://example.test/sold/${counter}`
          })
        ]
      };
    }
  });
  const report = await runAcquisitionToStorePipelineConformance(adapter);

  assert.equal(report.passed, false);
  assert.equal(report.failures.includes('deterministic_fixture_replay'), true);
  assert.equal(report.pipeline.deterministicReplay.pass, false);
});

test('stage mapping keeps diagnostics in canonical pipeline buckets', () => {
  assert.equal(stageFromReason('missing_identity_year'), 'identity');
  assert.equal(stageFromReason('missing_source_adapter'), 'provenance');
  assert.equal(stageFromReason('not_true_sold_evidence'), 'evidence_classification');
  assert.equal(stageFromReason('missing_sold_price'), 'store_compatibility');
  assert.equal(DEFAULT_REQUEST.identity.cardNumber, '181');
});
