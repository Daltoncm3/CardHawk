'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const {
  EVIDENCE_TYPES,
  normalizeAdapterRecord,
  normalizeCapabilities
} = require('../marketplaces/soldEvidenceAdapter');
const {
  addSoldEvidenceRecord,
  buildCanonicalCardKey,
  createEmptySoldEvidenceStore
} = require('../utils/soldEvidenceStore');

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

const identity = {
  category: 'sports_card',
  sport: 'basketball',
  player: 'John Doe',
  year: 2024,
  brand: 'Topps',
  setName: 'Chrome',
  cardNumber: '10',
  parallel: 'Refractor',
  rookie: true,
  autograph: false,
  memorabilia: false,
  serialNumbered: false
};

function buildListing(overrides = {}) {
  return {
    ebayItemId: 'canonical-runtime-target',
    title: '2024 Topps Chrome John Doe #10 Refractor Rookie PSA 10',
    price: 50,
    shipping: 5,
    totalCost: 55,
    sellerFeedbackPercentage: 99.8,
    sellerFeedbackScore: 500,
    url: 'https://example.test/canonical-runtime-target',
    parsedIdentity: identity,
    ...overrides
  };
}

function buildCompUniverse() {
  return [
    {
      ebayItemId: 'runtime-comp-sold-1',
      title: '2024 Topps Chrome John Doe #10 Refractor Rookie PSA 10',
      price: 110,
      soldAt: '2026-07-01T00:00:00.000Z',
      status: 'completed'
    },
    {
      ebayItemId: 'runtime-comp-sold-2',
      title: '2024 Topps Chrome John Doe #10 Refractor Rookie PSA 10',
      price: 115,
      sold: true,
      status: 'sold'
    },
    {
      ebayItemId: 'runtime-comp-active',
      title: '2024 Topps Chrome John Doe #10 Refractor Rookie PSA 10',
      price: 120,
      status: 'active'
    }
  ];
}

function normalizeSoldRecord(record, capabilities = {}) {
  return normalizeAdapterRecord(record, {
    marketplace: record.marketplace || 'fixture',
    marketplaceLabel: record.marketplace || 'Fixture',
    sourceName: 'Runtime Sold Evidence Test',
    adapterName: 'runtime_sold_evidence_test_adapter',
    capabilities: normalizeCapabilities({
      transactionLevelSoldSupport: true,
      acceptedBestOfferSupport: true,
      shippingSupport: true,
      certificationSupport: true,
      aggregateMarketPriceSupport: true,
      activeContextSupport: true,
      accessMode: 'fixture',
      sourceReliability: 'fixture',
      ...capabilities
    })
  }, {
    retrievalMethod: 'fixture'
  });
}

function soldRecord(overrides = {}) {
  return {
    evidenceType: 'true_sold',
    marketplace: 'eBay',
    marketplaceSaleId: 'canonical-sold-1',
    rawTitle: '2024 Topps Chrome John Doe #10 Refractor Rookie PSA 10',
    soldPrice: 125,
    shipping: 5,
    soldAt: '2026-07-05T12:00:00.000Z',
    condition: 'PSA 10',
    gradeCompany: 'PSA',
    grade: '10',
    parsedIdentity: identity,
    evidenceQualityScore: 94,
    evidenceQualityLevel: 'strong',
    ...overrides
  };
}

function insertContextRecord(store, record) {
  store.records[record.id] = record;
  if (!store.identityIndex[record.canonicalCardKey]) {
    store.identityIndex[record.canonicalCardKey] = [];
  }
  store.identityIndex[record.canonicalCardKey].push(record.id);
  for (const key of record.duplicateKeys || []) {
    store.duplicateIndex[key] = record.id;
  }
  store.stats.recordCount = Object.keys(store.records).length;
  store.stats.identityCount = Object.keys(store.identityIndex).length;
  store.stats.duplicateKeyCount = Object.keys(store.duplicateIndex).length;
}

function buildSoldEvidenceStore(records = []) {
  const store = createEmptySoldEvidenceStore();

  for (const record of records) {
    if (record.evidenceType === EVIDENCE_TYPES.TRUE_SOLD) {
      addSoldEvidenceRecord(store, record, { mutate: true });
    } else {
      insertContextRecord(store, record);
    }
  }

  return store;
}

function decisionBearingMarketIntelligence(data = {}) {
  return JSON.parse(JSON.stringify({
    source: data.source,
    intelligenceScore: data.intelligenceScore,
    trustLevel: data.trustLevel,
    recommendation: data.recommendation,
    confidenceScore: data.confidenceScore,
    liquidity: data.liquidity,
    demand: data.demand,
    velocity: data.velocity,
    trend: data.trend,
    volatility: data.volatility,
    pricingReliability: data.pricingReliability,
    compStrength: data.compStrength,
    marketDepth: data.marketDepth,
    warnings: data.warnings,
    positives: data.positives,
    reasons: data.reasons,
    summary: data.summary,
    componentScores: data.componentScores,
    soldCompCount: data.soldCompCount,
    activeCompCount: data.activeCompCount,
    recommendationImpact: data.recommendationImpact
  }));
}

function runtimeDecisionFields(scoring = {}) {
  const dealGrade = scoring.dealGrade
    ? Object.fromEntries(Object.entries(scoring.dealGrade).filter(([key]) => key !== 'createdAt'))
    : scoring.dealGrade;

  return JSON.parse(JSON.stringify({
    score: scoring.score,
    estimatedValue: scoring.estimatedValue,
    estimatedProfit: scoring.estimatedProfit,
    roi: scoring.roi,
    ebayFees: scoring.ebayFees,
    marketData: scoring.marketData,
    marketConfidence: scoring.marketConfidence,
    qualityData: scoring.qualityData,
    investmentQuality: scoring.investmentQuality,
    qualityBucket: scoring.qualityBucket,
    riskLevel: scoring.riskLevel,
    decision: scoring.decision,
    dealGrade,
    marketIntelligence: decisionBearingMarketIntelligence(scoring.marketIntelligenceData)
  }));
}

function scoreWithStore(store) {
  server.__setCanonicalSoldEvidenceStoreForTest(store);
  try {
    return server.scoreListing(buildListing(), buildCompUniverse());
  } finally {
    server.__setCanonicalSoldEvidenceStoreForTest(null);
  }
}

test('canonicalSoldEvidence appears in runtime Market Intelligence output', () => {
  const store = buildSoldEvidenceStore([
    normalizeSoldRecord(soldRecord())
  ]);
  const scoring = scoreWithStore(store);
  const canonical = scoring.marketIntelligenceData.canonicalSoldEvidence;

  assert.equal(canonical.canonicalCardKey, buildCanonicalCardKey(identity));
  assert.equal(canonical.trueSoldCount, 1);
  assert.equal(canonical.recentSoldCount, 1);
  assert.equal(canonical.medianSold, 130);
  assert.equal(canonical.weightedSoldAverage, 130);
  assert.equal(canonical.newestSoldDate, '2026-07-05T12:00:00.000Z');
  assert.deepEqual(canonical.sourceMix, { ebay: 1 });
  assert.equal(canonical.records.length, 1);
  assert.equal(canonical.decisionImpact, 'none');
});

test('Market Intelligence decision-bearing fields remain byte-for-byte identical', () => {
  const emptyScoring = scoreWithStore(createEmptySoldEvidenceStore());
  const evidenceScoring = scoreWithStore(buildSoldEvidenceStore([
    normalizeSoldRecord(soldRecord())
  ]));

  assert.equal(
    JSON.stringify(decisionBearingMarketIntelligence(evidenceScoring.marketIntelligenceData)),
    JSON.stringify(decisionBearingMarketIntelligence(emptyScoring.marketIntelligenceData))
  );
});

test('empty sold evidence degrades safely in runtime output', () => {
  const scoring = scoreWithStore(createEmptySoldEvidenceStore());
  const canonical = scoring.marketIntelligenceData.canonicalSoldEvidence;

  assert.equal(canonical.canonicalCardKey, buildCanonicalCardKey(identity));
  assert.equal(canonical.trueSoldCount, 0);
  assert.equal(canonical.recentSoldCount, 0);
  assert.equal(canonical.medianSold, 0);
  assert.equal(canonical.weightedSoldAverage, 0);
  assert.equal(canonical.newestSoldDate, null);
  assert.equal(canonical.staleCount, 0);
  assert.equal(canonical.freshCount, 0);
  assert.deepEqual(canonical.sourceMix, {});
  assert.deepEqual(canonical.records, []);
  assert.equal(canonical.decisionImpact, 'none');
});

test('active_context never becomes trueSold in runtime canonical evidence', () => {
  const activeContext = normalizeSoldRecord(soldRecord({
    evidenceType: 'true_sold',
    marketplaceSaleId: 'active-context-1',
    soldPrice: 999,
    status: 'active',
    sold: false
  }), {
    transactionLevelSoldSupport: false,
    aggregateMarketPriceSupport: false,
    activeContextSupport: true
  });
  const scoring = scoreWithStore(buildSoldEvidenceStore([activeContext]));
  const canonical = scoring.marketIntelligenceData.canonicalSoldEvidence;

  assert.equal(activeContext.evidenceType, EVIDENCE_TYPES.ACTIVE_CONTEXT);
  assert.equal(canonical.trueSoldCount, 0);
  assert.equal(canonical.records.length, 0);
});

test('aggregate_market_price never becomes trueSold in runtime canonical evidence', () => {
  const aggregateContext = normalizeSoldRecord(soldRecord({
    evidenceType: 'true_sold',
    marketplaceSaleId: 'aggregate-context-1',
    soldPrice: 888
  }), {
    transactionLevelSoldSupport: false,
    aggregateMarketPriceSupport: true,
    activeContextSupport: false
  });
  const scoring = scoreWithStore(buildSoldEvidenceStore([aggregateContext]));
  const canonical = scoring.marketIntelligenceData.canonicalSoldEvidence;

  assert.equal(aggregateContext.evidenceType, EVIDENCE_TYPES.AGGREGATE_MARKET_PRICE);
  assert.equal(canonical.trueSoldCount, 0);
  assert.equal(canonical.records.length, 0);
});

test('runtime behaves identically when sold evidence store is empty', () => {
  const unsetScoring = scoreWithStore(null);
  const emptyScoring = scoreWithStore(createEmptySoldEvidenceStore());

  assert.deepEqual(runtimeDecisionFields(emptyScoring), runtimeDecisionFields(unsetScoring));
});
