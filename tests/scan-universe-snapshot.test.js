'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const appStore = require('../utils/appStore');
const { createScoutScanner } = require('../services/scoutScannerService');
const {
  createScanUniverseSnapshot,
  getScanUniverseListings,
  summarizeScanUniverseSnapshot,
  validateScanUniverseSnapshot
} = require('../utils/scanUniverseSnapshot');

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

function tempFile(name = 'cardhawk-data.json') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cardhawk-scan-universe-snapshot-'));
  return path.join(directory, name);
}

function listing(id, overrides = {}) {
  return {
    listingId: id,
    marketplace: 'ebay',
    marketplaceListingId: id,
    marketplaceLabel: 'eBay',
    ebayItemId: id,
    title: '2026 Topps Chrome Jane Doe #12 Refractor PSA 10',
    price: 80,
    shipping: 5,
    totalCost: 85,
    currency: 'USD',
    condition: 'PSA 10',
    url: `https://example.test/${id}`,
    image: `https://example.test/${id}.jpg`,
    sellerUsername: 'SnapshotSeller',
    sellerFeedbackPercentage: 99.8,
    sellerFeedbackScore: 1500,
    buyingOptions: ['FIXED_PRICE'],
    itemEndDate: '2026-07-20T00:00:00.000Z',
    parsed: {
      player: 'Jane Doe',
      year: 2026,
      brand: 'Topps',
      set: 'Chrome',
      cardNumber: '12',
      parallel: 'Refractor',
      gradingCompany: 'PSA',
      grade: '10',
      flags: {
        graded: true,
        refractor: true
      }
    },
    firstSeenAt: '2026-07-19T00:00:00.000Z',
    lastSeenAt: '2026-07-20T00:00:00.000Z',
    seenCount: 2,
    ...overrides
  };
}

function soldListing(id, price) {
  return listing(id, {
    title: '2026 Topps Chrome Jane Doe #12 Refractor PSA 10 SOLD',
    price,
    totalCost: price,
    shipping: 0,
    sold: true,
    status: 'sold',
    soldAt: '2026-07-10T00:00:00.000Z',
    source: 'sold_market'
  });
}

function buildUniverse() {
  return [
    soldListing('sold-1', 120),
    soldListing('sold-2', 126),
    soldListing('sold-3', 118),
    listing('active-1', { price: 110, totalCost: 115 }),
    listing('active-2', { price: 130, totalCost: 135 })
  ];
}

function projectDecisionOutput(scoring = {}) {
  const dealGrade = scoring.dealGrade
    ? { ...scoring.dealGrade, createdAt: undefined }
    : scoring.dealGrade;

  return JSON.parse(JSON.stringify({
    score: scoring.score,
    estimatedValue: scoring.estimatedValue,
    estimatedProfit: scoring.estimatedProfit,
    roi: scoring.roi,
    marketConfidence: scoring.marketConfidence,
    compCount: scoring.compCount,
    compSource: scoring.compSource,
    marketSource: scoring.marketSource,
    marketMethod: scoring.marketMethod,
    compData: scoring.compData,
    marketData: scoring.marketData,
    dealGrade
  }));
}

function createScannerFixture(overrides = {}) {
  const store = {
    listings: Object.fromEntries(buildUniverse().map((item) => [item.ebayItemId, item])),
    alerts: [],
    scans: [],
    rejections: []
  };
  const snapshots = [];
  const receivedSnapshots = [];
  const scanner = createScoutScanner({
    activeMarketplace: {
      config: {
        scanQueryLimit: 10,
        searchDelayMs: 0,
        laneDelayMs: 0
      },
      searchWithBackoff: async () => [
        listing('scan-new-1'),
        listing('scan-new-2'),
        listing('scan-new-3')
      ],
      compactError: (error) => error.message || String(error),
      isRateLimitError: () => false
    },
    createScanUniverseSnapshot: (listings, options) => {
      const snapshot = createScanUniverseSnapshot(listings, options);
      snapshots.push(snapshot);
      return snapshot;
    },
    decisionValidationEngine: { recordOutcome() {} },
    getStore: () => store,
    historyEngine: {
      recordScan: () => ({
        observedCount: 3,
        trackedCount: 3,
        activeCount: 3,
        newListings: [],
        priceDrops: [],
        disappeared: []
      })
    },
    lanes: {
      all: { queries: [] },
      cards: { queries: ['snapshot cards'] }
    },
    learningEngine: {
      recordListingOutcome() {},
      recordScanOutcome: () => ({ stale: [] })
    },
    listingIdentity: {
      getListingId: (item) => item.ebayItemId
    },
    parseCardTitle: () => ({}),
    persistenceCoordinator: null,
    predictionAccuracyEngine: { recordOutcome() {} },
    saveScoutedListing: (item, query, lane, context = {}) => {
      receivedSnapshots.push(context.scanUniverseSnapshot);
      store.listings[item.ebayItemId] = { ...item, query, lane };
      return store.listings[item.ebayItemId];
    },
    saveStore() {},
    sleep: async () => {},
    systemHealth: {
      finishScan() {},
      markScanSkipped() {},
      recordScanEngine() {},
      setEngine() {},
      startScan() {}
    },
    ...overrides
  });

  return { scanner, snapshots, receivedSnapshots, store };
}

test('createScanUniverseSnapshot returns an immutable deterministic snapshot', () => {
  const universe = Object.fromEntries(buildUniverse().map((item) => [item.ebayItemId, item]));
  const snapshot = createScanUniverseSnapshot(universe, {
    snapshotId: 'scan-1',
    createdAt: '2026-07-20T00:00:00.000Z'
  });

  assert.equal(snapshot.snapshotId, 'scan-1');
  assert.equal(snapshot.listingCount, 5);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.listings), true);
  assert.equal(validateScanUniverseSnapshot(snapshot).valid, true);
  assert.deepEqual(summarizeScanUniverseSnapshot(snapshot), {
    source: 'scan_universe_snapshot',
    schemaVersion: '1.0.0',
    snapshotId: 'scan-1',
    listingCount: 5,
    firstListingId: 'sold-1',
    lastListingId: 'active-2',
    immutable: true
  });
  assert.throws(() => {
    snapshot.listings.push(listing('late'));
  }, TypeError);
});

test('scanner creates one scan universe snapshot and reuses it for each processed listing', async () => {
  const { scanner, snapshots, receivedSnapshots } = createScannerFixture();

  const scan = await scanner.runScoutScan('automatic');

  assert.equal(scan.status, 'completed');
  assert.equal(snapshots.length, 1);
  assert.equal(receivedSnapshots.length, 3);
  assert.equal(receivedSnapshots.every((snapshot) => snapshot === snapshots[0]), true);
  assert.equal(snapshots[0].listingCount, 5);
});

test('scan service does not materialize store.listings inside the per-listing loop', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'services', 'scoutScannerService.js'), 'utf8');

  assert.equal(source.includes('Object.values(store.listings'), false);
  assert.match(source, /const scanUniverse = createScanUniverseSnapshot/);
  assert.match(source, /saveScoutedListing\(listing, query, laneKey, \{\s+scanUniverseSnapshot: scanUniverse/s);
});

test('snapshot scoring preserves valuation, Deal Gate, and BUY_NOW outputs', () => {
  const universe = buildUniverse();
  const store = appStore.createDefaultStore();
  store.listings = Object.fromEntries(universe.map((item) => [item.ebayItemId, item]));
  server.__setStoreForTest(store);

  const target = listing('target', { price: 75, totalCost: 80 });
  const baseline = server.scoreListing(target, universe, {
    soldSalesUniverse: universe
  });
  const snapshot = createScanUniverseSnapshot(store.listings, { snapshotId: 'score-snapshot' });
  const optimized = server.scoreListing(target, snapshot, {
    scanUniverseSnapshot: snapshot
  });
  const baselineGate = server.dealGate({ ...target, ...baseline });
  const optimizedGate = server.dealGate({ ...target, ...optimized });

  assert.deepEqual(projectDecisionOutput(optimized), projectDecisionOutput(baseline));
  assert.equal(optimizedGate.passed, baselineGate.passed);
  assert.equal(optimizedGate.buyNowAllowed, baselineGate.buyNowAllowed);
  assert.equal(optimizedGate.decision, baselineGate.decision);
  server.__setStoreForTest(appStore.createDefaultStore());
});

test('snapshot is compatible with bounded resident listing persistence and restart', () => {
  const filePath = tempFile();
  const store = appStore.createDefaultStore();
  store.listings = Object.fromEntries(buildUniverse().map((item) => [item.ebayItemId, item]));

  appStore.saveStore(filePath, store, {
    activeListingRetentionPolicy: {
      maxResidentListings: 4,
      minProtectedNewestListings: 1
    },
    env: {},
    now: '2026-07-20T00:00:00.000Z'
  });
  const loaded = appStore.loadStore(filePath, appStore.createDefaultStore(), {
    activeListingRetentionPolicy: {
      maxResidentListings: 4,
      minProtectedNewestListings: 1
    },
    env: {},
    now: '2026-07-20T00:00:00.000Z'
  });
  const snapshot = createScanUniverseSnapshot(loaded.listings, {
    snapshotId: 'restart-snapshot'
  });

  assert.equal(Object.keys(loaded.listings).length, 4);
  assert.equal(snapshot.listingCount, 4);
  assert.equal(getScanUniverseListings(snapshot), snapshot.listings);
  assert.equal(validateScanUniverseSnapshot(snapshot).valid, true);
});
