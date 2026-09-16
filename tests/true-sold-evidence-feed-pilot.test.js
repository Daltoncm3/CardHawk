'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const {
  PILOT_STATUS,
  SOURCE_CLASSIFICATION,
  buildPilotIdentityScope,
  buildSoldEvidenceSourceInventory,
  getPreferredPilotSource,
  runTrueSoldEvidenceFeedPilot,
  summarizeTrueSoldEvidenceFeedPilot
} = require('../validation/trueSoldEvidenceFeedPilot');

const originalLoad = Module._load;
Module._load = function loadWithExpressStub(request, parent, isMain) {
  if (request === 'express') {
    const express = () => ({
      use() {},
      get() {},
      post() {},
      listen() {}
    });
    express.urlencoded = () => (_req, _res, next) => next && next();
    express.json = () => (_req, _res, next) => next && next();
    return express;
  }

  return originalLoad.call(this, request, parent, isMain);
};

const server = require('../server');

Module._load = originalLoad;

const listing = Object.freeze({
  ebayItemId: 'a1-pilot-target',
  title: '2023 Panini Prizm UFC Anthony Hernandez #181 Silver Prizm RC Rookie',
  price: 4.5,
  shipping: 0,
  totalCost: 4.5,
  condition: 'Raw',
  sellerFeedbackPercentage: 99.8,
  sellerFeedbackScore: 840,
  url: 'https://example.test/active/a1-pilot-target',
  parsedIdentity: {
    category: 'sports_card',
    sport: 'ufc',
    player: 'Anthony Hernandez',
    year: 2023,
    brand: 'Panini',
    product: 'Prizm UFC',
    setName: 'Prizm',
    cardNumber: '181',
    parallel: 'Silver Prizm',
    rookie: true,
    autograph: false,
    memorabilia: false,
    serialNumbered: false
  }
});

function soldRecord(id, overrides = {}) {
  return {
    evidenceType: 'true_sold',
    marketplace: 'eBay',
    marketplaceSaleId: `a1-ah-181-sold-${id}`,
    marketplaceListingId: `a1-ah-181-listing-${id}`,
    rawTitle: '2023 Panini Prizm UFC Anthony Hernandez #181 Silver Prizm RC Rookie',
    soldPrice: 7 + Number(id),
    shipping: 1,
    soldAt: `2026-07-0${id}T12:00:00.000Z`,
    saleType: 'buy_it_now',
    url: `https://example.test/sold/a1-ah-181-${id}`,
    image: `https://example.test/sold/a1-ah-181-${id}.jpg`,
    condition: 'Raw',
    gradeCompany: 'raw',
    grade: 'unknown',
    parsedIdentity: { ...listing.parsedIdentity },
    evidenceQualityScore: 90,
    evidenceQualityLevel: 'strong',
    source: {
      adapter: 'manual_verified_import',
      retrievalMethod: 'owner_supplied_verified_transaction',
      sourceReliability: 'verified_manual',
      acquiredAt: '2026-07-10T00:00:00.000Z',
      query: 'phase a1 pilot'
    },
    retention: {
      status: id === '3' ? 'unknown' : 'permanent_allowed',
      sourceTerms: id === '3' ? 'unknown' : 'owner supplied internal CardHawk validation',
      notes: ['Phase A1 owner-supplied verified transaction evidence'],
      reviewedBy: 'Dalton',
      reviewedAt: '2026-07-10T00:00:00.000Z',
      sourceApprovalStatus: 'manual_owner_supplied'
    },
    ...overrides
  };
}

function validRecords() {
  return [soldRecord('1'), soldRecord('2'), soldRecord('3')];
}

function runPilot(records = validRecords(), options = {}) {
  return runTrueSoldEvidenceFeedPilot({
    listing,
    records,
    asOf: '2026-07-10T00:00:00.000Z',
    now: () => '2026-07-10T00:00:00.000Z',
    ...options
  });
}

function scoreWithStore(store) {
  server.__setCanonicalSoldEvidenceStoreForTest(store);
  try {
    return server.scoreListing(listing, [
      {
        ebayItemId: 'a1-active-only-context',
        title: listing.title,
        price: 20,
        shipping: 0,
        status: 'active',
        parsed: { ...listing.parsedIdentity }
      }
    ]);
  } finally {
    server.__setCanonicalSoldEvidenceStoreForTest(null);
  }
}

test('A1 source inventory selects manual verified import as the safe legitimate path', () => {
  const inventory = buildSoldEvidenceSourceInventory();
  const selected = getPreferredPilotSource();
  const ebaySold = inventory.find((source) => source.sourceId === 'ebay_sold_acquisition_adapter');
  const activeSearch = inventory.find((source) => source.sourceId === 'ebay_browse_active_search');

  assert.equal(selected.classification, SOURCE_CLASSIFICATION.MANUAL_APPROVED);
  assert.equal(selected.canProvideTrueSoldEvidence, true);
  assert.equal(selected.networkAccess, false);
  assert.equal(ebaySold.classification, SOURCE_CLASSIFICATION.FIXTURE_ONLY);
  assert.equal(ebaySold.canProvideTrueSoldEvidence, false);
  assert.equal(activeSearch.classification, SOURCE_CLASSIFICATION.UNAVAILABLE);
  assert.equal(activeSearch.canProvideTrueSoldEvidence, false);
});

test('A1 pilot identity scope is deliberately narrow and exact', () => {
  const scope = buildPilotIdentityScope(listing);

  assert.equal(scope.sport, 'ufc');
  assert.equal(scope.player, 'Anthony Hernandez');
  assert.equal(scope.year, 2023);
  assert.equal(scope.setName, 'Prizm');
  assert.equal(scope.cardNumber, '181');
  assert.equal(scope.parallel, 'Silver Prizm');
  assert.equal(scope.rookie, true);
  assert.equal(scope.autograph, false);
});

test('A1 pilot ingests verified true sold records through canonical store and preserves retention', () => {
  const result = runPilot();

  assert.equal(result.status, PILOT_STATUS.READY);
  assert.equal(result.importReport.importedRecords, 3);
  assert.equal(result.importReport.rejectedRecords, 0);
  assert.equal(result.importReport.duplicateRecords, 0);
  assert.equal(result.queryResult.trueSoldCount, 3);
  assert.equal(result.queryResult.records.every((record) => record.evidenceType === 'true_sold'), true);
  assert.equal(result.queryResult.records.every((record) => record.status === 'active_evidence'), true);
  assert.equal(result.pilotSummary.retentionStatusSummary.permanent_allowed, 2);
  assert.equal(result.pilotSummary.retentionStatusSummary.unknown, 1);
  assert.equal(result.productionImpact, 'none');
  assert.equal(result.decisionImpact, 'none');
  assert.equal(result.executionAuthority, 'none');
});

test('A1 pilot rejects active listings and records missing transaction prices as sold evidence', () => {
  const active = soldRecord('1', {
    marketplaceSaleId: 'a1-active-contamination',
    evidenceType: 'active_context',
    sold: false,
    status: 'active',
    soldPrice: 99
  });
  const missingPrice = soldRecord('2', {
    marketplaceSaleId: 'a1-missing-price',
    soldPrice: 0
  });
  const result = runPilot([active, missingPrice, soldRecord('3')]);

  assert.equal(result.status, PILOT_STATUS.READY_WITH_WARNINGS);
  assert.equal(result.importReport.importedRecords, 1);
  assert.equal(result.importReport.rejectedRecords, 2);
  assert.equal(result.importReport.rejectionReasons.not_true_sold_evidence, 1);
  assert.equal(result.importReport.rejectionReasons.missing_sold_price, 1);
  assert.equal(result.queryResult.trueSoldCount, 1);
});

test('A1 pilot duplicate behavior is deterministic and preserves the first canonical transaction', () => {
  const duplicate = soldRecord('1', {
    rawTitle: 'Duplicate should not replace first record',
    soldPrice: 999
  });
  const result = runPilot([soldRecord('1'), duplicate]);
  const stored = Object.values(result.store.records);

  assert.equal(result.status, PILOT_STATUS.READY_WITH_WARNINGS);
  assert.equal(result.importReport.importedRecords, 1);
  assert.equal(result.importReport.duplicateRecords, 1);
  assert.equal(result.importReport.rejectionReasons.duplicate_record, 1);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].soldPrice, 8);
});

test('A1 exact identity matching excludes mismatched card families from production-readable comps', () => {
  const mismatch = soldRecord('4', {
    marketplaceSaleId: 'a1-wrong-player',
    rawTitle: '2023 Panini Prizm UFC Wrong Player #999 Silver Prizm RC Rookie',
    parsedIdentity: {
      ...listing.parsedIdentity,
      player: 'Wrong Player',
      cardNumber: '999'
    }
  });
  const result = runPilot([...validRecords(), mismatch]);

  assert.equal(result.importReport.importedRecords, 4);
  assert.equal(result.queryResult.trueSoldCount, 3);
  assert.equal(result.queryResult.records.some((record) => record.marketplaceSaleId === 'a1-wrong-player'), false);
});

test('A1 production-readable path feeds valuation and Deal Gate sold-comp count without weakening guards', () => {
  const result = runPilot();
  const scoring = scoreWithStore(result.store);
  const gate = server.dealGate({
    ...listing,
    ...scoring
  });

  assert.equal(scoring.marketData.source, 'sold_market');
  assert.equal(scoring.marketData.soldCompCount, 3);
  assert.equal(scoring.soldSales.saleCount, 3);
  assert.equal(gate.gate.soldCompCount, 3);
  assert.equal(gate.dealGateBreakdown.rules.some((rule) => (
    rule.ruleId === 'sold_comp_minimum' &&
    rule.actualValue === 3 &&
    rule.passed === true
  )), true);
  assert.equal(['BUY_NOW', 'REJECT'].includes(gate.decision), true);
});

test('A1 active-only valuation guard remains unchanged when no true sold pilot evidence is present', () => {
  const scoring = scoreWithStore(undefined);

  assert.equal(scoring.marketData.source, 'insufficient_evidence');
  assert.equal(scoring.marketData.soldCompCount, 0);
  assert.equal(scoring.marketData.marketValue, 0);
});

test('A1 summary is deterministic, non-authoritative, and contains no purchase authority', () => {
  const first = summarizeTrueSoldEvidenceFeedPilot(runPilot());
  const second = summarizeTrueSoldEvidenceFeedPilot(runPilot());

  assert.deepEqual(first, second);
  assert.equal(first.status, PILOT_STATUS.READY);
  assert.equal(first.trueSoldCount, 3);
  assert.equal(first.soldCompCount, 3);
  assert.equal(first.productionImpact, 'none');
  assert.equal(first.decisionImpact, 'none');
  assert.equal(first.executionAuthority, 'none');
});

test('A1 pilot does not expose automated purchase, bid, offer, notification, or persistence authority', () => {
  const result = runPilot();
  const summary = summarizeTrueSoldEvidenceFeedPilot(result);

  assert.equal(result.productionImpact, 'none');
  assert.equal(result.decisionImpact, 'none');
  assert.equal(result.executionAuthority, 'none');
  assert.equal(summary.productionImpact, 'none');
  assert.equal(summary.decisionImpact, 'none');
  assert.equal(summary.executionAuthority, 'none');
  assert.equal(Object.hasOwn(result, 'purchaseAutomation'), false);
  assert.equal(Object.hasOwn(result, 'bidAutomation'), false);
  assert.equal(Object.hasOwn(result, 'offerAutomation'), false);
  assert.equal(Object.hasOwn(result, 'notificationDispatch'), false);
  assert.equal(Object.hasOwn(result, 'productionPersistenceWrite'), false);
});
