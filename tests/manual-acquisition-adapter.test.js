'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  ACCESS_MODES,
  ADAPTER_STATUS,
  EVIDENCE_TYPES,
  createAcquisitionRegistry
} = require('../marketplaces/canonicalAcquisitionInterface');
const {
  DEFAULT_ADAPTER_NAME,
  DEFAULT_SOURCE_ID,
  buildManualAcquisitionPayload,
  createManualAcquisitionAdapter,
  loadManualBatches,
  recordMatchesRequest
} = require('../marketplaces/manualAcquisitionAdapter');

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

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cardhawk-manual-acquisition-'));
}

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
    currency: 'USD',
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
      acquiredAt: '2026-07-10T00:00:00.000Z',
      query: 'manual verified source'
    },
    review: {
      status: 'human_verified',
      reviewer: 'dealer-a',
      reviewedAt: '2026-07-10T13:00:00.000Z',
      notes: 'Exact subject, year, set, card number, Silver Prizm parallel, and rookie flag.'
    },
    ...overrides
  };
}

function writeBatch(directory, filename, records) {
  const filePath = path.join(directory, filename);
  fs.writeFileSync(filePath, JSON.stringify({
    batchId: filename.replace(/\.json$/, ''),
    records
  }, null, 2));
  return filePath;
}

test('manual acquisition adapter exposes canonical interface capabilities', async () => {
  const adapter = createManualAcquisitionAdapter();
  const capabilities = adapter.getCapabilities();
  const status = await adapter.getStatus();

  assert.equal(adapter.sourceId, DEFAULT_SOURCE_ID);
  assert.equal(adapter.adapterName, DEFAULT_ADAPTER_NAME);
  assert.equal(capabilities.capabilities.accessMode, ACCESS_MODES.MANUAL_IMPORT);
  assert.equal(capabilities.capabilities.transactionLevelSoldSupport, true);
  assert.equal(capabilities.capabilities.supportsIncrementalSync, true);
  assert.equal(capabilities.capabilities.supportsHistoricalBackfill, true);
  assert.equal(capabilities.capabilities.commercialUse.permitted, true);
  assert.equal(status.status, ADAPTER_STATUS.UNCONFIGURED);
  assert.equal(status.validRecords, 0);
});

test('manual adapter consumes incremental batch files and returns canonical acquisition results', async () => {
  const directory = makeTempDir();
  const firstBatch = writeBatch(directory, 'batch-001.json', [soldRecord()]);
  const secondBatch = writeBatch(directory, 'batch-002.json', [
    soldRecord({
      marketplaceSaleId: 'sale-002',
      marketplaceListingId: 'listing-002',
      sourceRecordId: 'source-row-002',
      rawTitle: '2023 Panini Prizm UFC Anthony Hernandez #181 Silver Prizm Rookie Card',
      soldPrice: 8.25,
      soldAt: '2026-07-02T12:00:00.000Z',
      url: 'https://example.test/sold/anthony-hernandez-002'
    })
  ]);
  const adapter = createManualAcquisitionAdapter({ batchFiles: [firstBatch, secondBatch] });
  const result = await adapter.acquireSoldEvidence({
    query: 'anthony hernandez',
    identity
  });

  assert.equal(result.source.sourceId, DEFAULT_SOURCE_ID);
  assert.equal(result.summary.returned, 2);
  assert.equal(result.summary.trueSoldCount, 2);
  assert.equal(result.summary.validRecordCount, 2);
  assert.equal(result.records[0].evidenceType, EVIDENCE_TYPES.TRUE_SOLD);
  assert.equal(result.records[0].source.adapter, DEFAULT_ADAPTER_NAME);
  assert.equal(result.records[0].source.capabilities.accessMode, ACCESS_MODES.MANUAL_IMPORT);
  assert.equal(result.metadata.manualDataset.batchCount, 2);
  assert.equal(result.metadata.manualDataset.validRecords, 2);
  assert.equal(result.metadata.validationReport.receivedRecords, 2);
});

test('manual adapter excludes invalid batch records but preserves diagnostics', async () => {
  const adapter = createManualAcquisitionAdapter({
    batches: [
      {
        batchId: 'mixed-batch',
        records: [
          soldRecord(),
          soldRecord({
            marketplaceSaleId: 'active-001',
            sourceRecordId: 'active-row-001',
            evidenceType: 'active_context',
            status: 'context_only',
            url: 'https://example.test/active/001',
            review: {
              status: 'needs_second_review'
            }
          }),
          soldRecord({
            marketplaceSaleId: 'missing-price',
            sourceRecordId: 'missing-price-row',
            soldPrice: 0,
            url: 'https://example.test/sold/missing-price'
          })
        ]
      }
    ]
  });
  const result = await adapter.acquireSoldEvidence({ query: 'anthony hernandez' });

  assert.equal(result.summary.returned, 1);
  assert.equal(result.summary.trueSoldCount, 1);
  assert.deepEqual(result.warnings, ['manual_batch_contains_invalid_records']);
  assert.equal(result.metadata.validationReport.invalidRecords, 2);
  assert.equal(result.metadata.validationReport.reasonCounts.not_true_sold_evidence, 1);
  assert.equal(result.metadata.validationReport.reasonCounts.missing_sold_price, 1);
});

test('manual adapter surfaces duplicate source and sale warnings from batch validation', async () => {
  const adapter = createManualAcquisitionAdapter({
    batches: [
      {
        batchId: 'batch-001',
        records: [soldRecord()]
      },
      {
        batchId: 'batch-002',
        records: [
          soldRecord({
            marketplaceListingId: 'listing-other',
            sourceRecordId: 'source-row-001',
            url: 'https://example.test/sold/anthony-hernandez-001'
          })
        ]
      }
    ]
  });
  const result = await adapter.acquireSoldEvidence({ query: 'anthony hernandez' });

  assert.equal(result.summary.returned, 2);
  assert.equal(result.warnings.includes('manual_batch_contains_duplicate_source_records'), true);
  assert.equal(result.warnings.includes('manual_batch_contains_duplicate_sales'), true);
  assert.equal(result.metadata.validationReport.duplicateSourceRecords.length, 1);
  assert.equal(result.metadata.validationReport.duplicateSales.length, 1);
});

test('manual adapter supports request filtering and limits without mutating batches', async () => {
  const batches = [
    {
      batchId: 'filter-batch',
      records: [
        soldRecord(),
        soldRecord({
          marketplaceSaleId: 'sale-002',
          marketplaceListingId: 'listing-002',
          sourceRecordId: 'source-row-002',
          rawTitle: '2018 Topps Chrome Shohei Ohtani #150 Refractor RC PSA 9',
          url: 'https://example.test/sold/ohtani-001',
          parsedIdentity: {
            category: 'sports_card',
            sport: 'baseball',
            player: 'Shohei Ohtani',
            year: '2018',
            brand: 'Topps',
            setName: 'Chrome',
            cardNumber: '150',
            parallel: 'Refractor',
            rookie: true,
            autograph: false,
            memorabilia: false,
            serialNumbered: false
          }
        })
      ]
    }
  ];
  const before = JSON.stringify(batches);
  const adapter = createManualAcquisitionAdapter({ batches });
  const filtered = await adapter.acquireSoldEvidence({ query: 'shohei ohtani', limit: 1 });
  const none = await adapter.acquireSoldEvidence({ query: 'nonexistent player' });

  assert.equal(filtered.summary.returned, 1);
  assert.equal(filtered.records[0].parsedIdentity.player, 'shohei ohtani');
  assert.equal(none.summary.returned, 0);
  assert.equal(JSON.stringify(batches), before);
});

test('manual adapter can acquire through the canonical registry', async () => {
  const registry = createAcquisitionRegistry();
  const adapter = createManualAcquisitionAdapter({
    batches: [
      {
        batchId: 'registry-batch',
        records: [soldRecord()]
      }
    ]
  });
  const registration = registry.registerAdapter(adapter);
  const result = await registry.acquire(DEFAULT_SOURCE_ID, {
    query: 'anthony hernandez',
    identity
  });

  assert.equal(registration.registered, true);
  assert.equal(result.summary.trueSoldCount, 1);
  assert.equal(result.source.adapterName, DEFAULT_ADAPTER_NAME);
});

test('manual adapter loader accepts file and object batch inputs', () => {
  const directory = makeTempDir();
  const filePath = writeBatch(directory, 'batch-001.json', [soldRecord()]);
  const batches = loadManualBatches([
    filePath,
    {
      batchId: 'object-batch',
      records: [soldRecord({ marketplaceSaleId: 'sale-002' })]
    }
  ]);

  assert.equal(batches.length, 2);
  assert.equal(batches[0].batchId, 'batch-001');
  assert.equal(batches[0].records.length, 1);
  assert.equal(batches[1].batchId, 'object-batch');
});

test('manual acquisition payload reuses existing batch validation report', () => {
  const payload = buildManualAcquisitionPayload([
    {
      batchId: 'payload-batch',
      records: [soldRecord()]
    }
  ], {
    query: 'anthony hernandez'
  });

  assert.equal(payload.records.length, 1);
  assert.equal(payload.metadata.manualDataset.receivedRecords, 1);
  assert.equal(payload.metadata.validationReport.validRecords, 1);
  assert.equal(payload.warnings.length, 0);
});

test('recordMatchesRequest supports canonical key and query filters conservatively', () => {
  const record = soldRecord({
    canonicalCardKey: 'sports-card:mma:2023:panini:prizm-ufc:anthony-hernandez:181:silver-prizm:non-auto:non-mem:unnumbered'
  });

  assert.equal(recordMatchesRequest(record, { query: 'anthony hernandez' }), true);
  assert.equal(recordMatchesRequest(record, { query: 'shohei ohtani' }), false);
  assert.equal(recordMatchesRequest(record, { canonicalCardKey: record.canonicalCardKey }), true);
  assert.equal(recordMatchesRequest(record, { canonicalCardKey: 'different-key' }), false);
});
