'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  EXISTING_VALUATION_TRUE_SOLD_MINIMUM,
  buildOwnerSoldEvidenceBatchFingerprint,
  buildTargetReadinessReport,
  importOwnerSoldEvidenceBatch,
  validateOwnerBatchRecord
} = require('../validation/ownerSoldEvidenceBatchIntake');
const {
  findSoldEvidenceByIdentity,
  loadSoldEvidenceStore
} = require('../utils/soldEvidenceStore');

const identity = Object.freeze({
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
});

const thinIdentity = Object.freeze({
  ...identity,
  player: 'Bo Nickal',
  cardNumber: '204'
});

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cardhawk-owner-batch-'));
}

function soldRecord(overrides = {}) {
  const saleId = overrides.marketplaceSaleId || 'owner-sale-001';
  return {
    marketplace: 'eBay',
    marketplaceSaleId: saleId,
    marketplaceListingId: overrides.marketplaceListingId || saleId.replace('sale', 'listing'),
    rawTitle: '2023 Panini Prizm UFC Anthony Hernandez #181 Silver Prizm RC',
    soldPrice: 8.5,
    shipping: 1.5,
    totalPaid: 10,
    currency: 'USD',
    soldAt: '2026-07-01T12:00:00.000Z',
    saleType: 'buy_it_now',
    url: `https://example.test/sold/${saleId}`,
    condition: 'raw',
    gradeCompany: 'raw',
    grade: 'unknown',
    parsedIdentity: identity,
    acquisitionMethod: 'owner_observed_manual_batch',
    verificationStatus: 'owner_verified',
    source: {
      adapter: 'owner_verified_batch',
      retrievalMethod: 'owner_observed_manual_batch',
      sourceReliability: 'verified_manual',
      acquiredAt: '2026-07-15T00:00:00.000Z'
    },
    retention: {
      status: 'permanent_allowed',
      sourceTerms: 'owner supplied transaction observations for internal CardHawk market history',
      notes: ['owner verified source page before import'],
      reviewedBy: 'Dalton',
      reviewedAt: '2026-07-15T00:05:00.000Z',
      sourceApprovalStatus: 'approved'
    },
    review: {
      status: 'owner_verified',
      reviewer: 'Dalton',
      reviewedAt: '2026-07-15T00:04:00.000Z'
    },
    ...overrides,
    source: {
      adapter: 'owner_verified_batch',
      retrievalMethod: 'owner_observed_manual_batch',
      sourceReliability: 'verified_manual',
      acquiredAt: '2026-07-15T00:00:00.000Z',
      ...(overrides.source || {})
    },
    retention: {
      status: 'permanent_allowed',
      sourceTerms: 'owner supplied transaction observations for internal CardHawk market history',
      notes: ['owner verified source page before import'],
      reviewedBy: 'Dalton',
      reviewedAt: '2026-07-15T00:05:00.000Z',
      sourceApprovalStatus: 'approved',
      ...(overrides.retention || {})
    }
  };
}

function batchForIdentity(targetIdentity, prefix, count) {
  return Array.from({ length: count }, (_, index) => soldRecord({
    marketplaceSaleId: `${prefix}-sale-${index + 1}`,
    marketplaceListingId: `${prefix}-listing-${index + 1}`,
    rawTitle: `${targetIdentity.year} Panini Prizm UFC ${targetIdentity.player} #${targetIdentity.cardNumber} ${targetIdentity.parallel} RC`,
    parsedIdentity: targetIdentity,
    url: `https://example.test/sold/${prefix}-${index + 1}`,
    soldAt: `2026-07-0${index + 1}T12:00:00.000Z`,
    soldPrice: 8 + index,
    totalPaid: 9 + index
  }));
}

test('valid verified owner batch transactions enter Canonical Sold Evidence and preserve provenance', () => {
  const result = importOwnerSoldEvidenceBatch({
    input: { ownerSoldRecords: batchForIdentity(identity, 'valid', 1) }
  });
  const matches = findSoldEvidenceByIdentity(result.store, identity);

  assert.equal(result.report.recordsSubmitted, 1);
  assert.equal(result.report.accepted, 1);
  assert.equal(result.report.trueSoldRecordsAdded, 1);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].evidenceType, 'true_sold');
  assert.equal(matches[0].source.adapter, 'owner_verified_batch');
  assert.equal(matches[0].retention.status, 'permanent_allowed');
  assert.equal(matches[0].retention.sourceApprovalStatus, 'approved');
});

test('invalid and incomplete owner records are quarantined with explicit reasons', () => {
  const result = importOwnerSoldEvidenceBatch({
    input: [
      soldRecord({ marketplaceSaleId: 'missing-price', soldPrice: 0 }),
      soldRecord({ marketplaceSaleId: 'missing-retention', retention: { status: 'unknown' } }),
      soldRecord({ marketplaceSaleId: 'missing-verification', verificationStatus: 'unreviewed', review: { status: 'unreviewed' } })
    ]
  });

  assert.equal(result.report.accepted, 0);
  assert.equal(result.report.quarantined, 3);
  assert.equal(result.report.rejectionReasons.missing_sold_price, 1);
  assert.equal(result.report.rejectionReasons['retention_not_permitted:unknown'], 1);
  assert.equal(result.report.rejectionReasons.missing_or_unverified_owner_verification_status, 1);
});

test('duplicate transactions do not inflate true sold comp counts', () => {
  const duplicate = soldRecord({
    marketplaceSaleId: 'dupe-sale-001',
    marketplaceListingId: 'dupe-listing-001'
  });
  const result = importOwnerSoldEvidenceBatch({
    input: [
      duplicate,
      {
        ...duplicate,
        rawTitle: 'Duplicate title with same sale id',
        soldPrice: 99
      }
    ]
  });
  const readiness = buildTargetReadinessReport(result.store);

  assert.equal(result.report.accepted, 1);
  assert.equal(result.report.duplicates, 1);
  assert.equal(findSoldEvidenceByIdentity(result.store, identity).length, 1);
  assert.equal(readiness.entries[0].trueSoldCount, 1);
});

test('canonical identity matching works across a mixed batch', () => {
  const result = importOwnerSoldEvidenceBatch({
    input: [
      ...batchForIdentity(identity, 'hernandez', 2),
      ...batchForIdentity(thinIdentity, 'nickal', 1)
    ]
  });

  assert.equal(result.report.accepted, 3);
  assert.equal(result.report.canonicalIdentitiesCreatedOrMatched.length, 2);
  assert.equal(findSoldEvidenceByIdentity(result.store, identity).length, 2);
  assert.equal(findSoldEvidenceByIdentity(result.store, thinIdentity).length, 1);
});

test('active listing data cannot enter the owner workflow as true sold evidence', () => {
  const active = soldRecord({
    marketplaceSaleId: 'active-listing-001',
    evidenceType: 'active_context',
    status: 'active',
    sold: false
  });
  const validation = validateOwnerBatchRecord(active);
  const result = importOwnerSoldEvidenceBatch({ input: [active] });

  assert.equal(validation.valid, false);
  assert.equal(validation.reasons.includes('not_true_sold_evidence'), true);
  assert.equal(result.report.accepted, 0);
  assert.equal(result.report.quarantined, 1);
  assert.equal(Object.keys(result.store.records).length, 0);
});

test('fixture and test evidence cannot become production Canonical Sold Evidence', () => {
  const fixture = soldRecord({
    marketplaceSaleId: 'fixture-sale-001',
    source: {
      adapter: 'offline_fixture_adapter',
      retrievalMethod: 'offline_fixture_acquisition',
      sourceReliability: 'offline_fixture',
      acquiredAt: '2026-07-15T00:00:00.000Z'
    }
  });
  const result = importOwnerSoldEvidenceBatch({ input: [fixture] });

  assert.equal(result.report.accepted, 0);
  assert.equal(result.report.quarantined, 1);
  assert.equal(result.report.rejectionReasons.fixture_or_test_evidence_not_production_evidence, 1);
});

test('retention and provenance restrictions survive import', () => {
  const result = importOwnerSoldEvidenceBatch({
    input: [soldRecord({
      marketplaceSaleId: 'restricted-sale-001',
      retention: {
        status: 'restricted',
        sourceTerms: 'internal use only',
        notes: ['do not redistribute'],
        reviewedBy: 'Dalton',
        reviewedAt: '2026-07-15T00:05:00.000Z',
        sourceApprovalStatus: 'approved_with_restrictions'
      }
    })]
  });
  const record = Object.values(result.store.records)[0];

  assert.equal(result.report.accepted, 1);
  assert.equal(record.retention.status, 'restricted');
  assert.equal(record.retention.sourceTerms, 'internal use only');
  assert.deepEqual(record.retention.retentionNotes, ['do not redistribute']);
});

test('target-readiness report counts only qualifying true sold evidence', () => {
  const result = importOwnerSoldEvidenceBatch({
    input: [
      ...batchForIdentity(identity, 'ready', EXISTING_VALUATION_TRUE_SOLD_MINIMUM),
      ...batchForIdentity(thinIdentity, 'below', EXISTING_VALUATION_TRUE_SOLD_MINIMUM - 1)
    ]
  });
  const report = result.report.targetReadiness;

  assert.equal(report.minimumTrueSoldComps, 3);
  assert.equal(report.readyIdentityCount, 1);
  assert.equal(report.belowMinimumIdentityCount, 1);
  assert.equal(report.readyIdentities[0].trueSoldCount, 3);
  assert.equal(report.readyIdentities[0].readyForTargetedDiscoveryLane, true);
  assert.equal(report.readyIdentities[0].discoveryLaneActivated, false);
  assert.equal(report.belowMinimumIdentities[0].trueSoldCount, 2);
  assert.equal(report.belowMinimumIdentities[0].readyForTargetedDiscoveryLane, false);
});

test('reaching the existing comp minimum does not activate discovery lanes or add authority', () => {
  const result = importOwnerSoldEvidenceBatch({
    input: batchForIdentity(identity, 'authority', 3)
  });

  assert.equal(result.productionImpact, 'none');
  assert.equal(result.decisionImpact, 'none');
  assert.equal(result.executionAuthority, 'none');
  assert.equal(result.report.targetReadiness.readyIdentities[0].discoveryLaneActivated, false);
  assert.equal(result.report.targetReadiness.laneActivationPerformed, false);
});

test('batch-file workflow writes through the configured canonical store path only', () => {
  const directory = tempDir();
  const inputPath = path.join(directory, 'owner-batch.json');
  const storePath = path.join(directory, 'sold-evidence.json');
  fs.writeFileSync(inputPath, JSON.stringify({ manualSoldRecords: batchForIdentity(identity, 'file', 3) }, null, 2));

  const result = importOwnerSoldEvidenceBatch({ inputPath, storePath });
  const loaded = loadSoldEvidenceStore(storePath);

  assert.equal(result.report.accepted, 3);
  assert.equal(loaded.stats.recordCount, 3);
  assert.equal(findSoldEvidenceByIdentity(loaded, identity).length, 3);
});

test('owner intake fingerprint is deterministic for identical reports', () => {
  const first = importOwnerSoldEvidenceBatch({
    input: batchForIdentity(identity, 'stable', 3)
  });
  const second = importOwnerSoldEvidenceBatch({
    input: batchForIdentity(identity, 'stable', 3)
  });

  assert.equal(first.batchFingerprint, buildOwnerSoldEvidenceBatchFingerprint({ report: first.report }));
  assert.equal(first.batchFingerprint, second.batchFingerprint);
});

test('module does not import marketplace execution, notification, or runtime authority', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'validation', 'ownerSoldEvidenceBatchIntake.js'), 'utf8');

  assert.equal(source.includes("require('../marketplaces/ebayMarketplace')"), false);
  assert.equal(source.includes("require('../services/scoutScannerService')"), false);
  assert.equal(source.includes("require('../services/targetedDiscoveryLaneService')"), false);
  assert.equal(source.includes("require('../server')"), false);
  assert.equal(source.includes('BUY_NOW'), false);
  assert.equal(source.includes('notification'), false);
});
