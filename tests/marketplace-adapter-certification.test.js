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
  CERTIFICATION_LEVELS,
  buildCertificationSummary,
  calculateQualityMetrics,
  determineCertificationLevel,
  inferUnsupportedBehaviors,
  runMarketplaceAdapterCertification
} = require('../validation/marketplaceAdapterCertification');

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
    sourceId: overrides.sourceId || 'certification_fixture_source',
    marketplace: overrides.marketplace || 'certification_fixture',
    marketplaceLabel: 'Certification Fixture',
    sourceName: 'Certification Fixture',
    adapterName: overrides.adapterName || 'certification_fixture_adapter',
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
      supportsIncrementalSync: true,
      supportsHistoricalBackfill: true,
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
      message: 'certification fixture ready'
    }))
  });
}

test('manual acquisition adapter can be Certified but not Production Approved by default', async () => {
  const adapter = createManualAcquisitionAdapter({
    batches: [
      {
        batchId: 'certification-valid-batch',
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
  const report = await runMarketplaceAdapterCertification(adapter, {
    generatedAt: '2026-07-11T00:00:00.000Z'
  });

  assert.equal(report.certificationLevel, CERTIFICATION_LEVELS.CERTIFIED);
  assert.equal(report.passed, true);
  assert.equal(report.productionApproved, false);
  assert.equal(report.metrics.identityPassRate, 1);
  assert.equal(report.metrics.provenancePassRate, 1);
  assert.equal(report.metrics.eligibleRecords, 2);
  assert.equal(report.requirements.find((entry) => entry.name === 'production_approval_recorded').pass, false);
  assert.equal(report.harnessReports.acquisitionAdapterConformance.passed, true);
  assert.equal(report.harnessReports.acquisitionToStorePipeline.passed, true);
});

test('explicit approval metadata is required for Production Approved', async () => {
  const adapter = createManualAcquisitionAdapter({
    batches: [
      {
        batchId: 'certification-production-batch',
        records: [soldRecord()]
      }
    ]
  });
  const report = await runMarketplaceAdapterCertification(adapter, {
    productionApproval: {
      approved: true,
      approvedBy: 'CardHawk Release Owner',
      approvedAt: '2026-07-11T12:00:00.000Z',
      approvalTicket: 'CARDHAWK-CERT-001'
    }
  });

  assert.equal(report.certificationLevel, CERTIFICATION_LEVELS.PRODUCTION_APPROVED);
  assert.equal(report.productionApproved, true);
  assert.equal(report.summary.approvedForProduction, true);
});

test('duplicate store records can satisfy Candidate but not Certified', async () => {
  const adapter = createManualAcquisitionAdapter({
    batches: [
      {
        batchId: 'certification-duplicate-batch',
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
  const report = await runMarketplaceAdapterCertification(adapter);

  assert.equal(report.certificationLevel, CERTIFICATION_LEVELS.CANDIDATE);
  assert.equal(report.passed, false);
  assert.equal(report.metrics.eligibleRecords, 1);
  assert.equal(report.metrics.duplicateFailures, 1);
  assert.equal(report.summary.failedRequirements.includes('acquisition_to_store_pipeline_passed'), true);
});

test('broken adapter contracts remain Draft with contract and metadata failures', async () => {
  const report = await runMarketplaceAdapterCertification({
    sourceId: 'broken_certification_adapter'
  });

  assert.equal(report.certificationLevel, CERTIFICATION_LEVELS.DRAFT);
  assert.equal(report.passed, false);
  assert.equal(report.summary.failedRequirements.includes('adapter_contract_passed'), true);
  assert.equal(report.summary.failedRequirements.includes('capability_metadata_passed'), true);
});

test('source capability gaps and limitations are recorded in certification reports', async () => {
  const adapter = fixtureAdapter({
    sourceId: 'aggregate_only_certification_source',
    capabilities: {
      transactionLevelSoldSupport: false,
      aggregateMarketPriceSupport: true,
      activeContextSupport: false,
      acceptedBestOfferSupport: false,
      shippingSupport: false,
      certificationSupport: false,
      supportsIncrementalSync: false,
      supportsHistoricalBackfill: false,
      commercialUse: {
        permitted: true,
        requiresLicense: true,
        redistributionAllowed: false,
        displayAllowed: false
      }
    },
    acquire: async (request) => ({
      request,
      records: [soldRecord({ evidenceType: 'true_sold' })]
    })
  });
  const report = await runMarketplaceAdapterCertification(adapter, {
    knownUnsupportedBehaviors: ['accepted_best_offer_final_price_disclosure']
  });

  assert.equal(report.certificationLevel, CERTIFICATION_LEVELS.CANDIDATE);
  assert.equal(report.unsupportedBehaviors.includes('transaction_level_true_sold'), true);
  assert.equal(report.unsupportedBehaviors.includes('accepted_best_offer_prices'), true);
  assert.equal(report.unsupportedBehaviors.includes('accepted_best_offer_final_price_disclosure'), true);
  assert.equal(report.limitations.includes('commercial_use_requires_license'), true);
  assert.equal(report.summary.unsupportedBehaviors.includes('transaction_level_true_sold'), true);
});

test('identity and provenance thresholds prevent certification when manual rows fail review', async () => {
  const adapter = createManualAcquisitionAdapter({
    batches: [
      {
        batchId: 'certification-invalid-batch',
        records: [
          soldRecord(),
          soldRecord({
            marketplaceSaleId: 'invalid-row',
            sourceRecordId: 'invalid-row',
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
  const report = await runMarketplaceAdapterCertification(adapter);

  assert.equal(report.certificationLevel, CERTIFICATION_LEVELS.DRAFT);
  assert.equal(report.metrics.identityPassRate, 0.5);
  assert.equal(report.metrics.provenancePassRate, 0.5);
  assert.equal(report.summary.failedRequirements.includes('identity_threshold_met'), true);
  assert.equal(report.summary.failedRequirements.includes('provenance_threshold_met'), true);
});

test('nondeterministic fixture replay blocks Candidate and Certified levels', async () => {
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
            sourceRecordId: `source-row-${counter}`,
            url: `https://example.test/sold/${counter}`
          })
        ]
      };
    }
  });
  const report = await runMarketplaceAdapterCertification(adapter);

  assert.equal(report.certificationLevel, CERTIFICATION_LEVELS.DRAFT);
  assert.equal(report.summary.failedRequirements.includes('deterministic_fixture_replay_passed'), true);
});

test('certification helper functions expose stable summaries and level decisions', () => {
  const unsupported = inferUnsupportedBehaviors({
    transactionLevelSoldSupport: false,
    activeContextSupport: false,
    shippingSupport: false
  }, ['custom_gap']);
  const level = determineCertificationLevel([
    { name: 'adapter_contract_passed', pass: true },
    { name: 'capability_metadata_passed', pass: true },
    { name: 'acquisition_adapter_conformance_passed', pass: true },
    { name: 'candidate_identity_threshold_met', pass: true },
    { name: 'candidate_provenance_threshold_met', pass: true },
    { name: 'deterministic_fixture_replay_passed', pass: true },
    { name: 'capabilities_recorded', pass: true },
    { name: 'dry_run_only', pass: true }
  ]);
  const metrics = calculateQualityMetrics({
    summary: {
      emittedRecords: 2,
      eligibleRecords: 1,
      rejectedRecords: 1
    },
    pipeline: {
      stageSummary: {
        identity: 1,
        provenance: 0
      },
      deterministicReplay: {
        pass: true
      }
    },
    dryRun: true
  });
  const summary = buildCertificationSummary({
    certificationLevel: CERTIFICATION_LEVELS.CANDIDATE,
    passed: false,
    adapter: {
      adapterName: 'fixture',
      sourceId: 'fixture-source'
    },
    metrics,
    requirements: [
      {
        name: 'acquisition_to_store_pipeline_passed',
        pass: false,
        severity: 'mandatory'
      }
    ],
    unsupportedBehaviors: unsupported,
    limitations: ['fixture_only']
  });

  assert.equal(unsupported.includes('transaction_level_true_sold'), true);
  assert.equal(level, CERTIFICATION_LEVELS.CANDIDATE);
  assert.equal(metrics.identityPassRate, 0.5);
  assert.equal(summary.failedRequirements[0], 'acquisition_to_store_pipeline_passed');
  assert.equal(summary.limitations[0], 'fixture_only');
});
