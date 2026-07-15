'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  createEmptySoldEvidenceStore,
  addSoldEvidenceRecord
} = require('../utils/soldEvidenceStore');
const {
  DATASET_OPERATIONS_VERSION,
  EVIDENCE_DEPTH,
  RECOMMENDED_ACTION,
  SOURCE,
  buildDatasetOperationsReport,
  classifyEvidenceDepth,
  loadCanonicalDataset
} = require('../validation/canonicalDatasetOperations');

const anthonyIdentity = {
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

const ohtaniIdentity = {
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
};

const curryIdentity = {
  category: 'sports_card',
  sport: 'basketball',
  player: 'Stephen Curry',
  year: '2009',
  brand: 'Topps',
  setName: 'Chrome',
  cardNumber: '101',
  parallel: 'Base',
  rookie: true,
  autograph: false,
  memorabilia: false,
  serialNumbered: false
};

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cardhawk-dataset-ops-'));
}

function soldRecord(identity, index, overrides = {}) {
  const saleId = overrides.marketplaceSaleId || `${identity.player || identity.character}-sale-${index}`.toLowerCase().replace(/[^a-z0-9-]+/g, '-');
  return {
    marketplace: overrides.marketplace || 'eBay',
    marketplaceSaleId: saleId,
    marketplaceListingId: overrides.marketplaceListingId || `${saleId}-listing`,
    sourceRecordId: overrides.sourceRecordId || `${saleId}-source`,
    evidenceType: 'true_sold',
    status: 'active_evidence',
    rawTitle: `${identity.year} ${identity.brand} ${identity.setName} ${identity.player || identity.character} #${identity.cardNumber} ${identity.parallel}`,
    soldPrice: overrides.soldPrice || 50 + index,
    shipping: overrides.shipping || 4,
    currency: overrides.currency || 'USD',
    soldAt: overrides.soldAt || `2026-06-${String(index).padStart(2, '0')}T12:00:00.000Z`,
    url: overrides.url || `https://example.test/sold/${saleId}`,
    condition: overrides.condition || 'raw',
    gradeCompany: overrides.gradeCompany || 'raw',
    grade: overrides.grade || 'unknown',
    parsedIdentity: identity,
    evidenceQualityScore: overrides.evidenceQualityScore || 90,
    evidenceQualityLevel: overrides.evidenceQualityLevel || 'strong',
    source: {
      adapter: overrides.adapter || 'manual_verified_dataset',
      retrievalMethod: 'manual_review',
      sourceReliability: 'verified_manual',
      acquiredAt: '2026-07-01T00:00:00.000Z'
    },
    review: {
      status: overrides.reviewStatus || 'human_verified',
      reviewer: overrides.reviewer || 'dealer-a',
      reviewedAt: overrides.reviewedAt || '2026-07-02T00:00:00.000Z'
    },
    ...overrides
  };
}

function fixtureDataset() {
  return [
    soldRecord(anthonyIdentity, 1),
    soldRecord(anthonyIdentity, 2, { marketplace: 'COMC', adapter: 'partner_verified_dataset', soldPrice: 58 }),
    soldRecord(anthonyIdentity, 3, { soldPrice: 59 }),
    soldRecord(anthonyIdentity, 4, { soldPrice: 61, gradeCompany: 'PSA', grade: '10', condition: 'graded' }),
    soldRecord(anthonyIdentity, 5, { soldPrice: 65 }),
    soldRecord(ohtaniIdentity, 1, { soldPrice: 220, gradeCompany: 'PSA', grade: '9', condition: 'graded' }),
    soldRecord(ohtaniIdentity, 2, { soldPrice: 225, marketplaceSaleId: 'ohtani-duplicate-sale', sourceRecordId: 'ohtani-duplicate-source' }),
    soldRecord(ohtaniIdentity, 3, { soldPrice: 230, marketplaceSaleId: 'ohtani-duplicate-sale', sourceRecordId: 'ohtani-duplicate-source-2' }),
    soldRecord(curryIdentity, 1, { soldPrice: 900, soldAt: '2025-01-01T12:00:00.000Z', currency: 'USD' }),
    soldRecord(curryIdentity, 2, { soldPrice: 950, soldAt: '2025-02-01T12:00:00.000Z', currency: 'USD' }),
    soldRecord(curryIdentity, 3, { soldPrice: 1000, soldAt: '2025-03-01T12:00:00.000Z', currency: 'USD' }),
    soldRecord(curryIdentity, 4, { soldPrice: 1050, soldAt: '2025-04-01T12:00:00.000Z', currency: 'USD' }),
    soldRecord(anthonyIdentity, 6, {
      marketplaceSaleId: 'active-context-001',
      sourceRecordId: 'active-context-source',
      evidenceType: 'active_context',
      status: 'context_only',
      reviewStatus: 'unreviewed'
    })
  ];
}

test('evidence-depth thresholds are explicit and isolated from production scoring', () => {
  assert.equal(classifyEvidenceDepth(0), EVIDENCE_DEPTH.NO_ELIGIBLE_EVIDENCE);
  assert.equal(classifyEvidenceDepth(1), EVIDENCE_DEPTH.THIN);
  assert.equal(classifyEvidenceDepth(2), EVIDENCE_DEPTH.THIN);
  assert.equal(classifyEvidenceDepth(3), EVIDENCE_DEPTH.DEVELOPING);
  assert.equal(classifyEvidenceDepth(4), EVIDENCE_DEPTH.DEVELOPING);
  assert.equal(classifyEvidenceDepth(5), EVIDENCE_DEPTH.SUFFICIENT_FOR_SHADOW_REVIEW);
  assert.equal(classifyEvidenceDepth(10), EVIDENCE_DEPTH.DEEP);
});

test('dataset operations produce per-identity coverage and shadow eligibility reports', () => {
  const report = buildDatasetOperationsReport({ records: fixtureDataset() }, {
    asOf: '2026-07-15T00:00:00.000Z',
    generatedAt: '2026-07-15T00:00:00.000Z'
  });
  const identities = Object.values(report.perIdentityReports);
  const anthony = identities.find((entry) => entry.normalizedIdentitySummary.player === 'anthony hernandez');
  const ohtani = identities.find((entry) => entry.normalizedIdentitySummary.player === 'shohei ohtani');
  const curry = identities.find((entry) => entry.normalizedIdentitySummary.player === 'stephen curry');

  assert.equal(report.source, SOURCE);
  assert.equal(report.version, DATASET_OPERATIONS_VERSION);
  assert.equal(anthony.exactEligibleSoldCount, 5);
  assert.equal(anthony.shadowValuationEligible, true);
  assert.equal(anthony.evidenceDepthClassification, EVIDENCE_DEPTH.SUFFICIENT_FOR_SHADOW_REVIEW);
  assert.equal(anthony.invalidOrIneligibleCount, 1);
  assert.equal(anthony.recommendedNextAcquisitionAction, RECOMMENDED_ACTION.RESOLVE_INVALID_RECORDS);
  assert.equal(ohtani.duplicateCount >= 1, true);
  assert.equal(ohtani.blockingReasons.includes('duplicate_records_present'), true);
  assert.equal(curry.staleCount, 4);
  assert.equal(curry.evidenceDepthClassification, EVIDENCE_DEPTH.DEVELOPING);
  assert.equal(curry.recommendedNextAcquisitionAction, RECOMMENDED_ACTION.ADD_RECENT_SALES);
  assert.equal(anthony.identityFingerprint.length, 64);
});

test('aggregate report tracks milestones, distributions, gaps, bias, and deterministic fingerprint', () => {
  const first = buildDatasetOperationsReport({ records: fixtureDataset() }, {
    asOf: '2026-07-15T00:00:00.000Z',
    generatedAt: '2026-07-15T00:00:00.000Z'
  });
  const second = buildDatasetOperationsReport({ records: fixtureDataset() }, {
    asOf: '2026-07-15T00:00:00.000Z',
    generatedAt: '2026-07-15T00:00:00.000Z'
  });

  assert.equal(first.aggregate.totalRecords, 13);
  assert.equal(first.aggregate.validExactSoldRecords, 12);
  assert.equal(first.aggregate.exactIdentityCount, 3);
  assert.equal(first.aggregate.progressToward100Identities.target, 100);
  assert.equal(first.aggregate.progressToward750VerifiedSoldRecords.target, 750);
  assert.equal(first.aggregate.identitiesByEvidenceDepthClassification.sufficient_for_shadow_review, 1);
  assert.equal(first.aggregate.identitiesEligibleForShadowValuation.length, 1);
  assert.equal(first.aggregate.adapterDistribution.manual_verified_dataset.count > 0, true);
  assert.equal(first.aggregate.categoryBalance['sports card'].count, 13);
  assert.equal(first.aggregate.gradeBalance['PSA:10'].count, 1);
  assert.equal(first.aggregate.priceRangeDistribution['1000_plus'].count, 2);
  assert.equal(first.aggregate.currencyDistribution.USD.count, 13);
  assert.equal(first.aggregate.recencyDistribution.stale.count, 4);
  assert.equal(first.aggregate.reviewBacklog, 1);
  assert.equal(first.aggregate.invalidCount, 1);
  assert.equal(first.aggregate.staleCount, 4);
  assert.equal(first.aggregate.ineligibleCount, 1);
  assert.equal(first.aggregate.majorCoverageGaps.length >= 2, true);
  assert.equal(first.aggregate.datasetBiasWarnings.includes('dataset_below_shadow_threshold'), true);
  assert.equal(first.reportFingerprint, second.reportFingerprint);
  assert.match(first.milestoneNotice, /Calibration milestones only/);
});

test('dataset loading supports arrays, wrapped datasets, store-shaped payloads, and store paths', () => {
  const records = fixtureDataset().slice(0, 2);
  const directory = tempDir();
  const datasetPath = path.join(directory, 'dataset.json');
  const storePath = path.join(directory, 'store.json');
  let store = createEmptySoldEvidenceStore();
  for (const record of records) {
    store = addSoldEvidenceRecord(store, record, { mutate: true }).store;
  }
  fs.writeFileSync(datasetPath, JSON.stringify({ records }, null, 2));
  fs.writeFileSync(storePath, JSON.stringify(store, null, 2));

  assert.equal(loadCanonicalDataset(records).length, 2);
  assert.equal(loadCanonicalDataset({ records }).length, 2);
  assert.equal(loadCanonicalDataset({ records: store.records }).length, 2);
  assert.equal(loadCanonicalDataset({ datasetPath }).length, 2);
  assert.equal(loadCanonicalDataset({ storePath }).length, 2);
});

test('report is read-only and does not mutate input records', () => {
  const records = fixtureDataset();
  const before = JSON.stringify(records);
  const report = buildDatasetOperationsReport({ records }, {
    asOf: '2026-07-15T00:00:00.000Z',
    generatedAt: '2026-07-15T00:00:00.000Z'
  });

  assert.equal(JSON.stringify(records), before);
  assert.equal(report.aggregate.recommendedAcquisitionPriorities.length > 0, true);
});
