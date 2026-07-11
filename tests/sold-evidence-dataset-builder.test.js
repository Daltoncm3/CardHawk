'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  buildDatasetManifest,
  buildDatasetManifestFromFile,
  buildImportValidationReport,
  buildRandomAuditSample,
  extractRecords,
  normalizeDatasetRecord,
  runCli,
  validateImportRecord
} = require('../validation/soldEvidenceDatasetBuilder');

const baseIdentity = {
  category: 'sports_card',
  sport: 'basketball',
  player: 'Victor Wembanyama',
  year: 2023,
  brand: 'Panini',
  setName: 'Prizm',
  cardNumber: '136',
  parallel: 'Silver Prizm',
  rookie: true
};

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cardhawk-dataset-builder-'));
}

function soldRecord(overrides = {}) {
  return {
    marketplace: 'eBay',
    marketplaceSaleId: overrides.marketplaceSaleId || 'sale-001',
    marketplaceListingId: overrides.marketplaceListingId || 'listing-001',
    rawTitle: '2023 Panini Prizm Victor Wembanyama #136 Silver Prizm RC PSA 10',
    soldPrice: 120,
    shipping: 5,
    soldAt: '2026-06-20T12:00:00.000Z',
    saleType: 'buy_it_now',
    url: 'https://example.test/sold/001',
    condition: 'PSA 10',
    gradeCompany: 'PSA',
    grade: '10',
    parsedIdentity: baseIdentity,
    evidenceQualityScore: 92,
    evidenceQualityLevel: 'strong',
    source: {
      adapter: 'manual_import',
      retrievalMethod: 'manual_import',
      sourceReliability: 'verified_manual',
      acquiredAt: '2026-07-01T00:00:00.000Z'
    },
    review: {
      status: 'human_verified',
      reviewer: 'dealer-a',
      reviewedAt: '2026-07-02T00:00:00.000Z',
      notes: 'Exact title, card number, parallel, and slab match.'
    },
    ...overrides
  };
}

function secondIdentityRecord(overrides = {}) {
  return soldRecord({
    marketplace: 'COMC',
    marketplaceSaleId: 'comc-sale-001',
    marketplaceListingId: 'comc-listing-001',
    rawTitle: '2018 Topps Chrome Shohei Ohtani #150 Refractor RC PSA 9',
    soldPrice: 225,
    soldAt: '2026-05-10T12:00:00.000Z',
    url: 'https://example.test/sold/ohtani-001',
    grade: '9',
    parsedIdentity: {
      category: 'sports_card',
      sport: 'baseball',
      player: 'Shohei Ohtani',
      year: 2018,
      brand: 'Topps',
      setName: 'Chrome',
      cardNumber: '150',
      parallel: 'Refractor',
      rookie: true
    },
    source: {
      adapter: 'manual_import',
      retrievalMethod: 'manual_import',
      sourceReliability: 'verified_manual',
      acquiredAt: '2026-07-01T00:00:00.000Z'
    },
    ...overrides
  });
}

test('dataset builder creates manifest, metadata, coverage, statistics, and reviewer notes', () => {
  const manifest = buildDatasetManifest({
    metadata: {
      datasetId: 'phase-4.4b-pilot',
      name: 'Phase 4.4B Pilot Dataset',
      owner: 'CardHawk validation'
    },
    records: [
      soldRecord({ marketplaceSaleId: 'sale-001', marketplaceListingId: 'listing-001', soldPrice: 100 }),
      soldRecord({ marketplaceSaleId: 'sale-002', marketplaceListingId: 'listing-002', soldPrice: 120, url: 'https://example.test/sold/002' }),
      secondIdentityRecord()
    ]
  }, {
    asOf: '2026-07-10T00:00:00.000Z',
    sampleSize: 2,
    targets: {
      uniqueIdentities: 2,
      verifiedSoldRecords: 3,
      minimumSoldRecordsPerIdentity: 1
    }
  });

  assert.equal(manifest.source, 'cardhawk_sold_evidence_dataset_builder');
  assert.equal(manifest.mode, 'offline_governance');
  assert.equal(manifest.metadata.datasetId, 'phase-4.4b-pilot');
  assert.equal(manifest.coverageReport.uniqueIdentityCount, 2);
  assert.equal(manifest.coverageReport.verifiedSoldRecordCount, 3);
  assert.equal(manifest.coverageReport.targetProgress.readyForCanonicalValuationShadow, true);
  assert.equal(manifest.datasetStatistics.soldPrice.median, 120);
  assert.deepEqual(manifest.datasetStatistics.sourceMix, { ebay: 2, comc: 1 });
  assert.equal(manifest.reviewStatus.verifiedCount, 3);
  assert.equal(manifest.reviewStatus.reviewerNotes.length, 3);
  assert.equal(manifest.randomAuditSample.records.length, 2);
});

test('dataset builder reports bias and target gaps for concentrated or thin datasets', () => {
  const manifest = buildDatasetManifest({
    records: [
      soldRecord({ marketplaceSaleId: 'sale-001', marketplaceListingId: 'listing-001', soldPrice: 10 }),
      soldRecord({ marketplaceSaleId: 'sale-002', marketplaceListingId: 'listing-002', soldPrice: 12, url: 'https://example.test/sold/002' })
    ]
  }, {
    targets: {
      uniqueIdentities: 100,
      verifiedSoldRecords: 750,
      minimumSoldRecordsPerIdentity: 3
    }
  });

  assert.equal(manifest.coverageReport.targetProgress.readyForCanonicalValuationShadow, false);
  assert.equal(manifest.coverageReport.recordsPerIdentity.identitiesBelowMinimum.length, 1);
  assert.equal(manifest.biasReport.biasRiskLevel, 'high');
  assert.equal(manifest.biasReport.warnings.includes('marketplace_concentration_high'), true);
  assert.equal(manifest.biasReport.warnings.includes('dataset_below_shadow_threshold'), true);
});

test('provenance validation and import validation flag unsafe dataset records', () => {
  const manifest = buildDatasetManifest({
    records: [
      soldRecord({ marketplaceSaleId: 'good-001', marketplaceListingId: 'good-listing-001' }),
      soldRecord({
        marketplaceSaleId: 'active-001',
        marketplaceListingId: 'active-listing-001',
        evidenceType: 'active_context',
        status: 'context_only',
        url: 'https://example.test/active/001'
      }),
      soldRecord({
        marketplaceSaleId: 'missing-review',
        marketplaceListingId: 'missing-review-listing',
        soldPrice: 0,
        url: '',
        source: {
          adapter: '',
          retrievalMethod: '',
          sourceReliability: '',
          acquiredAt: null
        },
        review: {
          status: 'unreviewed'
        }
      })
    ]
  });

  assert.equal(manifest.importValidationReport.received, 3);
  assert.equal(manifest.importValidationReport.eligibleTrueSold, 1);
  assert.equal(manifest.importValidationReport.rejected, 2);
  assert.equal(manifest.importValidationReport.rejectionReasons.not_true_sold_evidence, 1);
  assert.equal(manifest.importValidationReport.rejectionReasons.missing_sold_price, 1);
  assert.equal(manifest.importValidationReport.rejectionReasons.not_human_verified, 1);
  assert.equal(manifest.provenanceValidation.invalidCount, 1);
  assert.equal(manifest.provenanceValidation.missingFieldCounts.sourceUrl, 1);
  assert.equal(manifest.provenanceValidation.missingFieldCounts['review.status'], 1);
});

test('duplicate risk report detects repeated duplicate keys before import', () => {
  const report = buildImportValidationReport([
    normalizeDatasetRecord(soldRecord({
      marketplaceSaleId: 'dup-sale',
      marketplaceListingId: 'dup-listing',
      url: 'https://example.test/sold/dup'
    })),
    normalizeDatasetRecord(soldRecord({
      marketplaceSaleId: 'dup-sale',
      marketplaceListingId: 'other-listing',
      url: 'https://example.test/sold/other'
    }))
  ]);

  assert.equal(report.duplicateRiskCount >= 1, true);
  assert.equal(report.rejected, 0);
});

test('random audit sample is deterministic for a supplied seed', () => {
  const records = [
    normalizeDatasetRecord(soldRecord({ marketplaceSaleId: 'sale-001', marketplaceListingId: 'listing-001' })),
    normalizeDatasetRecord(soldRecord({ marketplaceSaleId: 'sale-002', marketplaceListingId: 'listing-002', url: 'https://example.test/sold/002' })),
    normalizeDatasetRecord(secondIdentityRecord())
  ];
  const first = buildRandomAuditSample(records, { sampleSize: 2, seed: 'dealer-audit' });
  const second = buildRandomAuditSample(records, { sampleSize: 2, seed: 'dealer-audit' });

  assert.deepEqual(first, second);
  assert.equal(first.records.length, 2);
});

test('dataset builder reads array, wrapped records, and store-shaped payloads', () => {
  const record = soldRecord();

  assert.equal(extractRecords([record]).length, 1);
  assert.equal(extractRecords({ verifiedSoldRecords: [record] }).length, 1);
  assert.equal(extractRecords({ records: { one: record } }).length, 1);
});

test('validateImportRecord requires true sold evidence and human verification', () => {
  const good = normalizeDatasetRecord(soldRecord());
  const active = normalizeDatasetRecord(soldRecord({
    evidenceType: 'active_context',
    status: 'context_only'
  }));
  const unreviewed = normalizeDatasetRecord(soldRecord({
    review: { status: 'unreviewed' }
  }));

  assert.deepEqual(validateImportRecord(good), { valid: true, reasons: [] });
  assert.equal(validateImportRecord(active).valid, false);
  assert.equal(validateImportRecord(active).reasons.includes('not_true_sold_evidence'), true);
  assert.equal(validateImportRecord(unreviewed).reasons.includes('not_human_verified'), true);
});

test('dataset builder CLI writes manifest and prints concise summary', () => {
  const directory = makeTempDir();
  const inputPath = path.join(directory, 'dataset.json');
  const outPath = path.join(directory, 'manifest.json');
  fs.writeFileSync(inputPath, JSON.stringify({
    records: [soldRecord()]
  }, null, 2));

  const originalWrite = process.stdout.write;
  let output = '';
  process.stdout.write = (chunk) => {
    output += chunk;
    return true;
  };

  try {
    const manifest = runCli([
      '--input', inputPath,
      '--out', outPath,
      '--dataset-id', 'cli-dataset',
      '--sample-size', '1',
      '--target-identities', '1',
      '--target-records', '1'
    ]);

    const written = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    const summary = JSON.parse(output);

    assert.equal(fs.existsSync(outPath), true);
    assert.equal(manifest.metadata.datasetId, 'cli-dataset');
    assert.equal(written.dataset.recordCount, 1);
    assert.equal(summary.datasetId, 'cli-dataset');
    assert.equal(summary.readyForCanonicalValuationShadow, true);
  } finally {
    process.stdout.write = originalWrite;
  }
});
