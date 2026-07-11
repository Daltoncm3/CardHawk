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
  runAcquisitionAdapterConformance,
  summarizeConformance,
  validateAcquisitionResultShape,
  validateRecords
} = require('../validation/acquisitionAdapterConformance');

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
    sourceId: overrides.sourceId || 'fixture_source',
    marketplace: overrides.marketplace || 'fixture_source',
    marketplaceLabel: 'Fixture Source',
    sourceName: 'Fixture Source',
    adapterName: overrides.adapterName || 'fixture_source_adapter',
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
      message: 'fixture ready'
    }))
  });
}

test('manual acquisition adapter passes the conformance harness as reference implementation', async () => {
  const adapter = createManualAcquisitionAdapter({
    batches: [
      {
        batchId: 'reference-batch',
        records: [soldRecord()]
      }
    ]
  });
  const report = await runAcquisitionAdapterConformance(adapter);
  const summary = summarizeConformance(report);

  assert.equal(report.passed, true);
  assert.equal(report.failedChecks, 0);
  assert.equal(report.totalChecks, 14);
  assert.equal(summary.adapterName, 'manual_dataset_acquisition_adapter');
  assert.equal(summary.passed, true);
});

test('conformance harness detects incomplete interface contracts', async () => {
  const report = await runAcquisitionAdapterConformance({
    sourceId: 'broken'
  });

  assert.equal(report.passed, false);
  assert.equal(report.failures.includes('interface_contract'), true);
  assert.equal(report.failures.includes('capability_metadata_required_fields'), true);
  assert.equal(report.failures.includes('adapter_versioning'), true);
});

test('conformance harness validates required capability metadata', async () => {
  const adapter = fixtureAdapter({
    capabilities: {
      identityFields: ['category'],
      provenanceFields: ['marketplace']
    }
  });
  const report = await runAcquisitionAdapterConformance(adapter);
  const identityCheck = report.checks.find((check) => check.name === 'identity_capability_metadata');
  const provenanceCheck = report.checks.find((check) => check.name === 'provenance_capability_metadata');

  assert.equal(report.passed, false);
  assert.equal(identityCheck.pass, false);
  assert.equal(identityCheck.details.missing.includes('year'), true);
  assert.equal(provenanceCheck.pass, false);
  assert.equal(provenanceCheck.details.missing.includes('adapter'), true);
});

test('conformance harness validates provenance and identity on returned records', async () => {
  const adapter = fixtureAdapter({
    acquire: async (request) => ({
      request,
      records: [
        soldRecord({
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
  const report = await runAcquisitionAdapterConformance(adapter);

  assert.equal(report.passed, false);
  assert.equal(report.failures.includes('provenance_enforcement'), true);
  assert.equal(report.failures.includes('identity_requirements'), true);
});

test('conformance harness confirms no-transaction adapters cannot emit true_sold', async () => {
  const adapter = fixtureAdapter();
  const noTransactionAdapter = fixtureAdapter({
    sourceId: 'aggregate_only',
    capabilities: {
      transactionLevelSoldSupport: false,
      aggregateMarketPriceSupport: true
    },
    acquire: async (request) => ({
      request,
      records: [soldRecord({ evidenceType: 'true_sold' })]
    })
  });
  const report = await runAcquisitionAdapterConformance(adapter, {
    noTransactionAdapter
  });
  const check = report.checks.find((entry) => entry.name === 'no_transaction_support_cannot_emit_true_sold');

  assert.equal(check.pass, true);
  assert.equal(check.details.emittedTrueSoldCount, 0);
});

test('conformance harness validates structured errors and partial failures', async () => {
  const adapter = fixtureAdapter();
  const partialFailureAdapter = fixtureAdapter({
    sourceId: 'partial_failure',
    acquire: async (request) => ({
      request,
      records: [soldRecord()],
      errors: [
        {
          code: 'source_timeout',
          message: 'One page failed',
          retryable: true
        }
      ],
      warnings: ['partial_result']
    })
  });
  const report = await runAcquisitionAdapterConformance(adapter, {
    partialFailureAdapter
  });
  const invalidRequestCheck = report.checks.find((entry) => entry.name === 'structured_errors_for_invalid_request');
  const partialCheck = report.checks.find((entry) => entry.name === 'partial_failure_structured_errors');

  assert.equal(invalidRequestCheck.pass, true);
  assert.equal(partialCheck.pass, true);
  assert.equal(partialCheck.details.errors[0].code, 'source_timeout');
});

test('conformance harness detects nondeterministic fixture replay', async () => {
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
  const report = await runAcquisitionAdapterConformance(adapter);

  assert.equal(report.passed, false);
  assert.equal(report.failures.includes('deterministic_fixture_replay'), true);
});

test('validateAcquisitionResultShape flags malformed adapter results', () => {
  const malformed = validateAcquisitionResultShape({
    records: {}
  });

  assert.equal(malformed.valid, false);
  assert.equal(malformed.reasons.includes('missing_source'), true);
  assert.equal(malformed.reasons.includes('missing_records_array'), true);
  assert.equal(malformed.reasons.includes('missing_validation_array'), true);
  assert.equal(malformed.reasons.includes('missing_summary_returned'), true);
});

test('validateRecords returns per-record provenance and identity diagnostics', () => {
  const adapter = fixtureAdapter();
  const diagnostics = validateRecords([
    soldRecord(),
    soldRecord({
      parsedIdentity: {},
      url: ''
    })
  ], adapter);

  assert.equal(diagnostics.length, 2);
  assert.equal(diagnostics[0].validation.valid, true);
  assert.equal(diagnostics[1].validation.valid, false);
  assert.equal(diagnostics[1].validation.reasons.includes('missing_identity_year'), true);
  assert.equal(diagnostics[1].validation.reasons.includes('missing_provenance_sourceUrl'), true);
});
