'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  EVIDENCE_TYPES,
  normalizeAdapterRecord,
  normalizeCapabilities
} = require('../marketplaces/soldEvidenceAdapter');
const { importSoldEvidence } = require('../validation/importSoldEvidence');
const soldEvidenceService = require('../services/soldEvidenceService');
const {
  addSoldEvidenceRecord,
  buildCanonicalCardKey,
  createEmptySoldEvidenceStore,
  loadSoldEvidenceStore,
  saveSoldEvidenceStore
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

const fixturePath = path.join(__dirname, 'fixtures', 'sold-evidence', 'anthony-hernandez-sold-pilot.json');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

function tempPaths() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cardhawk-anthony-sold-pilot-'));
  return {
    directory,
    inputPath: path.join(directory, 'anthony-hernandez-import.json'),
    storePath: path.join(directory, 'sold-evidence-store.json')
  };
}

function normalizeContextRecord(record, capabilities = {}) {
  return normalizeAdapterRecord(record, {
    marketplace: record.marketplace || 'fixture',
    marketplaceLabel: record.marketplace || 'Fixture',
    sourceName: 'Anthony Hernandez Sold Evidence Pilot',
    adapterName: 'anthony_hernandez_sold_pilot_adapter',
    capabilities: normalizeCapabilities({
      transactionLevelSoldSupport: false,
      acceptedBestOfferSupport: false,
      shippingSupport: true,
      certificationSupport: false,
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

function buildPilotStore() {
  const paths = tempPaths();
  fs.writeFileSync(paths.inputPath, JSON.stringify({
    verifiedSoldRecords: fixture.verifiedSoldRecords
  }, null, 2));

  const importResult = importSoldEvidence({
    inputPath: paths.inputPath,
    storePath: paths.storePath,
    sourceReliability: 'verified_manual'
  });

  const store = loadSoldEvidenceStore(paths.storePath);

  for (const contextRecord of fixture.contextRecords) {
    const evidenceType = contextRecord.evidenceType;
    const normalized = normalizeContextRecord(contextRecord, {
      transactionLevelSoldSupport: false,
      aggregateMarketPriceSupport: evidenceType === EVIDENCE_TYPES.AGGREGATE_MARKET_PRICE,
      activeContextSupport: evidenceType === EVIDENCE_TYPES.ACTIVE_CONTEXT
    });

    if (normalized.evidenceType === EVIDENCE_TYPES.TRUE_SOLD) {
      addSoldEvidenceRecord(store, normalized, { mutate: true });
    } else {
      insertContextRecord(store, normalized);
    }
  }

  saveSoldEvidenceStore(paths.storePath, store);

  return {
    paths,
    importResult,
    store: loadSoldEvidenceStore(paths.storePath)
  };
}

function buildActiveUniverse() {
  return [
    {
      ebayItemId: 'ah-active-comp-1',
      title: '2023 Panini Prizm UFC Anthony Hernandez #181 Silver Prizm RC Rookie',
      price: 49.99,
      shipping: 0,
      status: 'active'
    },
    {
      ebayItemId: 'ah-active-comp-2',
      title: 'Anthony Hernandez 2023 Panini Prizm UFC Silver Prizm #181 Rookie',
      price: 59.99,
      shipping: 0,
      status: 'active'
    }
  ];
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
    activeCompCount: data.activeCompCount
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
    return server.scoreListing(fixture.listing, buildActiveUniverse());
  } finally {
    server.__setCanonicalSoldEvidenceStoreForTest(null);
  }
}

function withFixedDate(isoDate, callback) {
  const RealDate = Date;
  const fixedTime = new RealDate(isoDate).getTime();

  global.Date = class FixedDate extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : [fixedTime]));
    }

    static now() {
      return fixedTime;
    }
  };

  try {
    return callback();
  } finally {
    global.Date = RealDate;
  }
}

test('Anthony Hernandez sold evidence pilot imports, queries, and surfaces canonical evidence end-to-end', () => {
  const { importResult, store } = buildPilotStore();
  const directQuery = soldEvidenceService.querySoldEvidence(
    store,
    fixture.listing.parsedIdentity,
    { trueSoldOnly: true },
    { asOf: fixture.asOf }
  );
  const runtimeScoring = withFixedDate(fixture.asOf, () => scoreWithStore(store));
  const canonical = runtimeScoring.marketIntelligenceData.canonicalSoldEvidence;

  assert.equal(importResult.summary.received, 4);
  assert.equal(importResult.summary.imported, 4);
  assert.equal(importResult.summary.duplicates, 0);
  assert.equal(importResult.summary.rejected, 0);
  assert.equal(directQuery.trueSoldCount, 4);
  assert.equal(directQuery.recentSoldCount, 4);
  assert.equal(directQuery.medianSold, 7.38);
  assert.equal(directQuery.weightedSoldAverage, 7.75);
  assert.equal(directQuery.newestSoldDate, '2026-07-01T18:30:00.000Z');
  assert.deepEqual(directQuery.sourceMix, {
    ebay: 3,
    comc: 1
  });

  assert.equal(canonical.canonicalCardKey, buildCanonicalCardKey(fixture.listing.parsedIdentity));
  assert.equal(canonical.trueSoldCount, directQuery.trueSoldCount);
  assert.equal(canonical.recentSoldCount, directQuery.recentSoldCount);
  assert.equal(canonical.medianSold, directQuery.medianSold);
  assert.equal(canonical.weightedSoldAverage, directQuery.weightedSoldAverage);
  assert.equal(canonical.newestSoldDate, directQuery.newestSoldDate);
  assert.deepEqual(canonical.sourceMix, directQuery.sourceMix);
  assert.equal(canonical.records.length, 4);
  assert.equal(canonical.decisionImpact, 'none');
});

test('Anthony Hernandez pilot context records never count as sold evidence', () => {
  const { store } = buildPilotStore();
  const allContext = soldEvidenceService.querySoldEvidence(
    store,
    fixture.listing.parsedIdentity,
    { trueSoldOnly: false },
    { asOf: fixture.asOf }
  );
  const trueSoldOnly = soldEvidenceService.querySoldEvidence(
    store,
    fixture.listing.parsedIdentity,
    { trueSoldOnly: true },
    { asOf: fixture.asOf }
  );

  assert.equal(allContext.records.length, 6);
  assert.equal(allContext.records.some((record) => record.evidenceType === EVIDENCE_TYPES.ACTIVE_CONTEXT), true);
  assert.equal(allContext.records.some((record) => record.evidenceType === EVIDENCE_TYPES.AGGREGATE_MARKET_PRICE), true);
  assert.equal(allContext.trueSoldCount, 4);
  assert.equal(trueSoldOnly.records.length, 4);
  assert.equal(trueSoldOnly.trueSoldCount, 4);
  assert.equal(trueSoldOnly.records.every((record) => record.evidenceType === EVIDENCE_TYPES.TRUE_SOLD), true);
});

test('Anthony Hernandez pilot does not change runtime decision-bearing outputs', () => {
  const { store } = buildPilotStore();
  const emptyScoring = scoreWithStore(createEmptySoldEvidenceStore());
  const evidenceScoring = scoreWithStore(store);

  assert.deepEqual(runtimeDecisionFields(evidenceScoring), runtimeDecisionFields(emptyScoring));
  assert.equal(evidenceScoring.marketIntelligenceData.canonicalSoldEvidence.trueSoldCount, 4);
  assert.equal(emptyScoring.marketIntelligenceData.canonicalSoldEvidence.trueSoldCount, 0);
  assert.deepEqual(evidenceScoring.marketIntelligenceData.warnings, emptyScoring.marketIntelligenceData.warnings);
  assert.deepEqual(evidenceScoring.marketIntelligenceData.positives, emptyScoring.marketIntelligenceData.positives);
  assert.deepEqual(evidenceScoring.marketIntelligenceData.reasons, emptyScoring.marketIntelligenceData.reasons);
});
