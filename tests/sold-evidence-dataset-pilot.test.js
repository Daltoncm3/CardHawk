'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  buildBatchValidationReport,
  buildDatasetPopulationPilot,
  runCli,
  saleKey,
  sourceRecordKey,
  validateExactIdentity,
  validateRecordForPilot
} = require('../validation/soldEvidenceDatasetPilot');

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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cardhawk-dataset-pilot-'));
}

function soldRecord(overrides = {}) {
  return {
    marketplace: 'eBay',
    marketplaceSaleId: 'sale-001',
    marketplaceListingId: 'listing-001',
    sourceRecordId: 'source-row-001',
    evidenceType: 'true_sold',
    status: 'active_evidence',
    rawTitle: '2023 Panini Prizm UFC Anthony Hernandez #181 Silver Prizm RC Rookie',
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
    provenance: {
      licenseType: 'manual_review_source_terms',
      allowedUses: {
        internalValidation: true,
        valuationModeling: false,
        redistribution: false,
        display: false
      }
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

test('pilot validates exact identity, sold price, sold date, provenance, and review status', () => {
  const valid = validateRecordForPilot(soldRecord());
  const invalid = validateRecordForPilot(soldRecord({
    evidenceType: 'active_context',
    soldPrice: 0,
    soldAt: null,
    url: '',
    parsedIdentity: {
      category: 'sports_card',
      sport: 'mma'
    },
    source: {
      adapter: '',
      retrievalMethod: '',
      sourceReliability: '',
      acquiredAt: null
    },
    review: {
      status: 'needs_second_review'
    }
  }));

  assert.deepEqual(valid, { valid: true, reasons: [] });
  assert.equal(invalid.valid, false);
  assert.equal(invalid.reasons.includes('not_true_sold_evidence'), true);
  assert.equal(invalid.reasons.includes('missing_sold_price'), true);
  assert.equal(invalid.reasons.includes('missing_sold_date'), true);
  assert.equal(invalid.reasons.includes('missing_source_url'), true);
  assert.equal(invalid.reasons.includes('not_human_verified'), true);
  assert.equal(invalid.reasons.includes('missing_source_adapter'), true);
  assert.equal(invalid.reasons.includes('missing_identity_cardNumber'), true);
  assert.equal(invalid.reasons.includes('missing_identity_parallel_or_base'), true);
});

test('exact identity validation requires dealer-critical card fields and flags', () => {
  const result = validateExactIdentity({
    parsedIdentity: {
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
    }
  });
  const missingFlags = validateExactIdentity({
    parsedIdentity: {
      category: 'sports_card',
      sport: 'mma',
      player: 'Anthony Hernandez',
      year: '2023',
      brand: 'Panini',
      setName: 'Prizm UFC',
      cardNumber: '181',
      parallel: 'Silver Prizm'
    }
  });

  assert.deepEqual(result, { valid: true, reasons: [] });
  assert.equal(missingFlags.valid, false);
  assert.equal(missingFlags.reasons.includes('missing_identity_rookie_flag'), true);
  assert.equal(missingFlags.reasons.includes('missing_identity_autograph_flag'), true);
  assert.equal(missingFlags.reasons.includes('missing_identity_memorabilia_flag'), true);
  assert.equal(missingFlags.reasons.includes('missing_identity_serial_numbered_flag'), true);
});

test('pilot supports incremental batch files and reuses Phase 4.4B manifest reports', () => {
  const report = buildDatasetPopulationPilot([
    {
      batchId: 'batch-001',
      records: [soldRecord()]
    },
    {
      batchId: 'batch-002',
      records: [soldRecord({
        marketplaceSaleId: 'sale-002',
        marketplaceListingId: 'listing-002',
        sourceRecordId: 'source-row-002',
        soldPrice: 8.25,
        soldAt: '2026-07-02T12:00:00.000Z',
        url: 'https://example.test/sold/anthony-hernandez-002'
      })]
    }
  ], {
    targets: {
      uniqueIdentities: 1,
      verifiedSoldRecords: 2,
      minimumSoldRecordsPerIdentity: 2
    },
    sampleSize: 1
  });

  assert.equal(report.mode, 'offline_manual_dataset_population');
  assert.equal(report.batchSummary.batchCount, 2);
  assert.equal(report.validationReport.receivedRecords, 2);
  assert.equal(report.validationReport.validRecords, 2);
  assert.equal(report.manifest.coverageReport.verifiedSoldRecordCount, 2);
  assert.equal(report.manifest.coverageReport.uniqueIdentityCount, 1);
  assert.equal(report.manifest.coverageReport.targetProgress.readyForCanonicalValuationShadow, true);
  assert.equal(report.manifest.randomAuditSample.records.length, 1);
});

test('pilot detects duplicate source records and duplicate sales across batches', () => {
  const duplicate = soldRecord({
    marketplaceSaleId: 'sale-001',
    marketplaceListingId: 'listing-999',
    sourceRecordId: 'source-row-001',
    url: 'https://example.test/sold/anthony-hernandez-001'
  });
  const report = buildBatchValidationReport([
    {
      batchId: 'batch-001',
      records: [soldRecord()]
    },
    {
      batchId: 'batch-002',
      records: [duplicate]
    }
  ]);

  assert.equal(report.duplicateSourceRecords.length, 1);
  assert.equal(report.duplicateSales.length, 1);
  assert.equal(report.validRecords, 2);
});

test('sourceRecordKey and saleKey are stable for equivalent source records', () => {
  const first = soldRecord();
  const second = soldRecord({
    rawTitle: 'Different title casing does not change source sale identity'
  });

  assert.equal(sourceRecordKey(first), sourceRecordKey(second));
  assert.equal(saleKey(first), saleKey(second));
});

test('pilot CLI reads multiple batch files and writes offline report only', () => {
  const directory = makeTempDir();
  const firstBatch = path.join(directory, 'batch-001.json');
  const secondBatch = path.join(directory, 'batch-002.json');
  const outputPath = path.join(directory, 'pilot-report.json');
  fs.writeFileSync(firstBatch, JSON.stringify({
    batchId: 'batch-001',
    records: [soldRecord()]
  }, null, 2));
  fs.writeFileSync(secondBatch, JSON.stringify({
    batchId: 'batch-002',
    records: [soldRecord({
      marketplaceSaleId: 'sale-002',
      marketplaceListingId: 'listing-002',
      sourceRecordId: 'source-row-002',
      url: 'https://example.test/sold/anthony-hernandez-002'
    })]
  }, null, 2));

  const originalWrite = process.stdout.write;
  let output = '';
  process.stdout.write = (chunk) => {
    output += chunk;
    return true;
  };

  try {
    const report = runCli([
      '--batch', firstBatch,
      '--batch', secondBatch,
      '--out', outputPath,
      '--dataset-id', 'pilot-cli',
      '--target-identities', '1',
      '--target-records', '2'
    ]);
    const written = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
    const summary = JSON.parse(output);

    assert.equal(report.manifest.metadata.datasetId, 'pilot-cli');
    assert.equal(fs.existsSync(outputPath), true);
    assert.equal(written.validationReport.receivedRecords, 2);
    assert.equal(summary.validRecords, 2);
    assert.equal(summary.readyForCanonicalValuationShadow, true);
  } finally {
    process.stdout.write = originalWrite;
  }
});
