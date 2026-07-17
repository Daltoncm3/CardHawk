'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const appStore = require('../utils/appStore');
const notificationEngine = require('../engines/notificationEngine');
const {
  buildListingCompactionSummary,
  compactMarketplaceListing,
  compactRetainedListing,
  estimateListingFootprint,
  validateCompactListing
} = require('../utils/listingCompaction');

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
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cardhawk-listing-compaction-'));
  return path.join(directory, name);
}

function rawPayload() {
  return {
    itemId: 'compact-1',
    title: '2026 Topps Chrome Jane Doe #12 Refractor PSA 10',
    itemWebUrl: 'https://example.test/item/compact-1',
    image: { imageUrl: 'https://example.test/item/compact-1.jpg' },
    thumbnailImages: [{ imageUrl: 'https://example.test/thumb.jpg' }],
    price: { value: '82.50', currency: 'USD' },
    shippingOptions: [{ shippingCost: { value: '5.00', currency: 'USD' } }],
    seller: {
      username: 'TrustedSeller',
      feedbackPercentage: '99.9',
      feedbackScore: 1234
    },
    buyingOptions: ['FIXED_PRICE'],
    itemEndDate: '2026-07-20T00:00:00.000Z',
    marketingPayload: 'x'.repeat(5000),
    categoryPath: 'Sports Trading Cards > Trading Card Singles',
    requestEcho: {
      query: 'jane doe refractor',
      headers: { authorization: 'Bearer should-not-persist' }
    }
  };
}

function legacyListing(overrides = {}) {
  return {
    listingId: 'compact-1',
    marketplace: 'ebay',
    marketplaceListingId: 'compact-1',
    marketplaceLabel: 'eBay',
    ebayItemId: 'compact-1',
    title: '2026 Topps Chrome Jane Doe #12 Refractor PSA 10',
    price: 82.5,
    shipping: 5,
    totalCost: 87.5,
    currency: 'USD',
    condition: 'PSA 10',
    url: 'https://example.test/item/compact-1',
    image: 'https://example.test/item/compact-1.jpg',
    sellerUsername: 'TrustedSeller',
    sellerFeedbackPercentage: 99.9,
    sellerFeedbackScore: 1234,
    buyingOptions: ['FIXED_PRICE'],
    itemEndDate: '2026-07-20T00:00:00.000Z',
    lane: 'baseball',
    query: 'jane doe refractor',
    parsed: {
      player: 'Jane Doe',
      year: 2026,
      brand: 'Topps',
      set: 'Chrome',
      cardNumber: '12',
      parallel: 'Refractor',
      gradingCompany: 'PSA',
      grade: '10',
      rookie: true,
      flags: {
        graded: true,
        rookie: true,
        refractor: true
      }
    },
    score: 91,
    estimatedValue: 140,
    estimatedProfit: 100,
    roi: 0.4,
    ebayFees: 18,
    compData: {
      source: 'test',
      compCount: 3,
      soldCompCount: 3,
      activeCompCount: 0,
      marketValue: 140,
      confidence: 82
    },
    marketData: {
      marketValue: 140,
      expectedValue: 140,
      confidence: 82
    },
    marketConfidence: 82,
    confidenceReasons: ['strong comps'],
    confidenceCap: 90,
    compCount: 3,
    compSource: 'test',
    qualityData: {
      investmentQuality: 88,
      bucket: 'strong'
    },
    investmentQuality: 88,
    qualityBucket: 'strong',
    liquidityScore: 76,
    riskLevel: 'low',
    qualityReasons: ['graded', 'image present'],
    qualityWarnings: [],
    dealGrade: {
      grade: 'A',
      action: 'BUY_NOW'
    },
    dealGate: {
      passed: true,
      decision: 'BUY_NOW',
      reasons: [],
      rejectionReasons: []
    },
    firstSeenAt: '2026-07-17T10:00:00.000Z',
    lastSeenAt: '2026-07-17T11:00:00.000Z',
    seenCount: 2,
    alertCreated: false,
    raw: rawPayload(),
    request: {
      query: 'jane doe refractor',
      headers: { authorization: 'Bearer should-not-persist' }
    },
    response: {
      status: 200,
      body: { itemSummaries: [rawPayload()] }
    },
    retryState: {
      attempts: 2,
      timers: ['not-real-timer']
    },
    ...overrides
  };
}

function decisionFields(scoring = {}) {
  return JSON.parse(JSON.stringify({
    score: scoring.score,
    estimatedValue: scoring.estimatedValue,
    estimatedProfit: scoring.estimatedProfit,
    roi: scoring.roi,
    marketConfidence: scoring.marketConfidence,
    compCount: scoring.compCount,
    compSource: scoring.compSource,
    riskLevel: scoring.riskLevel,
    investmentQuality: scoring.investmentQuality,
    qualityBucket: scoring.qualityBucket,
    dealGate: server.dealGate({ ...legacyListing(), ...scoring })
  }));
}

test('compact retained listing removes raw marketplace and scan-only payloads without mutating input', () => {
  const legacy = legacyListing();
  const before = JSON.stringify(legacy);
  const compact = compactRetainedListing(legacy);

  assert.equal(JSON.stringify(legacy), before);
  assert.equal(compact.raw, undefined);
  assert.equal(compact.request, undefined);
  assert.equal(compact.response, undefined);
  assert.equal(compact.retryState, undefined);
  assert.equal(compact.marketplaceProvenance.rawPayloadRemoved, true);
  assert.equal(compact.marketplaceProvenance.marketplaceListingId, 'compact-1');
  assert.equal(compact.listingCompaction.compacted, true);
  assert.equal(validateCompactListing(compact).valid, true);
});

test('compact listing preserves required production fields and notification compatibility', () => {
  const compact = compactRetainedListing(legacyListing());

  for (const field of [
    'listingId',
    'marketplace',
    'marketplaceListingId',
    'marketplaceLabel',
    'ebayItemId',
    'title',
    'price',
    'shipping',
    'totalCost',
    'currency',
    'condition',
    'url',
    'image',
    'sellerUsername',
    'sellerFeedbackPercentage',
    'sellerFeedbackScore',
    'buyingOptions',
    'itemEndDate',
    'parsed',
    'lane',
    'query',
    'score',
    'estimatedValue',
    'estimatedProfit',
    'roi',
    'compData',
    'marketData',
    'qualityData',
    'dealGate',
    'firstSeenAt',
    'lastSeenAt',
    'seenCount',
    'alertCreated'
  ]) {
    assert.notEqual(compact[field], undefined, `${field} should be preserved`);
  }

  assert.equal(notificationEngine.evaluateAlertRules(compact).passed, true);
  assert.match(notificationEngine.buildSmsBody(compact), /CardHawk BASEBALL/);
  assert.match(notificationEngine.buildEmailBody(compact), /TrustedSeller/);
});

test('compaction is deterministic, idempotent, and materially smaller for raw legacy listings', () => {
  const legacy = legacyListing();
  const first = compactRetainedListing(legacy);
  const second = compactRetainedListing(legacy);
  const third = compactRetainedListing(first);
  const footprint = estimateListingFootprint(legacy);
  const summary = buildListingCompactionSummary(legacy, first);

  assert.deepEqual(first, second);
  assert.deepEqual(first, third);
  assert.equal(summary.transientFieldsRemoved.includes('raw'), true);
  assert.equal(summary.transientFieldsRemoved.includes('request'), true);
  assert.equal(summary.transientFieldsRemoved.includes('response'), true);
  assert.equal(footprint.compactSerializedBytes < footprint.originalSerializedBytes, true);
  assert.equal(footprint.reductionRatio > 0.45, true);
});

test('compactMarketplaceListing supports legacy marketplace objects with raw-only fields', () => {
  const compact = compactMarketplaceListing({
    raw: rawPayload(),
    parsed: { player: 'Jane Doe' }
  });

  assert.equal(compact.ebayItemId, 'compact-1');
  assert.equal(compact.title, rawPayload().title);
  assert.equal(compact.totalCost, 87.5);
  assert.equal(compact.raw, undefined);
  assert.equal(validateCompactListing(compact).valid, true);
});

test('appStore compacts legacy listings during load and save while preserving lookup compatibility', () => {
  const filePath = tempFile();
  const store = appStore.createDefaultStore();
  store.listings['compact-1'] = legacyListing();

  appStore.saveStore(filePath, store);
  const savedJson = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert.equal(savedJson.listings['compact-1'].raw, undefined);
  assert.equal(savedJson.listings['compact-1'].marketplaceProvenance.rawPayloadRemoved, true);

  const legacyFile = tempFile();
  fs.writeFileSync(legacyFile, JSON.stringify(store, null, 2));
  const loaded = appStore.loadStore(legacyFile, appStore.createDefaultStore());
  const loadedListing = appStore.getStoredListingById(loaded, 'compact-1');

  assert.equal(loadedListing.raw, undefined);
  assert.equal(loadedListing.title, legacyListing().title);
  assert.equal(appStore.getStoredListingById(loaded, 'compact-1').ebayItemId, 'compact-1');
});

test('compact listings preserve scoring, valuation, Deal Gate, and BUY_NOW behavior', () => {
  const legacy = legacyListing();
  const compact = compactRetainedListing(legacy);
  const legacyScoring = server.scoreListing(legacy, [legacy]);
  const compactScoring = server.scoreListing(compact, [compact]);
  const legacyGate = server.dealGate({ ...legacy, ...legacyScoring });
  const compactGate = server.dealGate({ ...compact, ...compactScoring });

  assert.deepEqual(decisionFields(legacyScoring), decisionFields(compactScoring));
  assert.equal(legacyScoring.estimatedValue, compactScoring.estimatedValue);
  assert.equal(legacyScoring.roi, compactScoring.roi);
  assert.equal(legacyGate.passed, compactGate.passed);
  assert.equal(legacyGate.buyNowAllowed, compactGate.buyNowAllowed);
  assert.equal(legacyGate.decision, compactGate.decision);
});

test('compact listings remain JSON API serializable without raw payload leakage', () => {
  const compact = compactRetainedListing(legacyListing());
  const serialized = JSON.stringify({
    listing: {
      ebayItemId: compact.ebayItemId,
      title: compact.title,
      lane: compact.lane,
      price: compact.price,
      shipping: compact.shipping,
      totalCost: compact.totalCost,
      url: compact.url
    },
    display: server.buildDisplayInterpretation(compact).display
  });

  assert.equal(serialized.includes('marketingPayload'), false);
  assert.equal(serialized.includes('Bearer should-not-persist'), false);
  assert.equal(serialized.includes('compact-1'), true);
  assert.equal(serialized.includes('Jane Doe'), true);
});
