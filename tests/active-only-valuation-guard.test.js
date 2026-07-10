'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const marketValueEngine = require('../engines/marketValueEngine');
const roiEngine = require('../engines/roiEngine');

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

const anthonyHernandezListing = {
  title: '2023 Panini Prizm UFC Anthony Hernandez #181 Silver Prizm RC Rookie',
  price: 4.49,
  shipping: 0,
  parsed: {
    year: 2023,
    player: 'Anthony Hernandez',
    setName: 'Panini Prizm UFC',
    flags: {
      rookie: true
    }
  }
};

function activeComp(price, overrides = {}) {
  return {
    title: anthonyHernandezListing.title,
    price,
    status: 'active',
    similarity: 92,
    contributionWeight: 0.8,
    url: `https://example.test/active-${price}`,
    ...overrides
  };
}

function soldComp(price, overrides = {}) {
  return {
    title: anthonyHernandezListing.title,
    price,
    soldAt: '2026-07-01T00:00:00.000Z',
    status: 'completed',
    similarity: 92,
    source: 'sold_market',
    ...overrides
  };
}

function activeOnlyCompData(overrides = {}) {
  return {
    marketValue: 81.18,
    confidence: 98,
    usableCompCount: 2,
    strongCompCount: 2,
    pricingSpread: 0.03,
    marketConsistency: 'stable_market',
    selectedComps: [
      activeComp(80),
      activeComp(82.36)
    ],
    ...overrides
  };
}

test('zero true sold comps plus active comps cannot produce headline marketValue', () => {
  const result = marketValueEngine.calculateMarketValue({
    listing: anthonyHernandezListing,
    activeCompData: activeOnlyCompData(),
    soldComps: []
  });

  assert.equal(result.source, 'insufficient_evidence');
  assert.equal(result.method, 'activeOnlyNoSoldEvidence');
  assert.equal(result.marketValue, 0);
  assert.equal(result.expectedValue, 0);
  assert.equal(result.baseMarketValue, 0);
  assert.equal(result.soldCompCount, 0);
  assert.equal(result.activeCompCount, 2);
  assert.equal(result.confidence <= 25, true);
});

test('active evidence remains available as valuation context', () => {
  const result = marketValueEngine.calculateMarketValue({
    listing: anthonyHernandezListing,
    activeCompData: activeOnlyCompData(),
    soldComps: []
  });

  assert.equal(result.evidence.active.length, 2);
  assert.equal(result.activeMarketContext.activeCompCount, 2);
  assert.equal(result.activeMarketContext.activeMedianAsk, 81.18);
  assert.equal(result.activeMarketContext.activeLowAsk, 80);
  assert.equal(result.activeMarketContext.activeHighAsk, 82.36);
  assert.equal(result.activeMarketContext.unavailableForHeadlineValuation, true);
  assert.match(result.activeMarketContext.warnings.join(' '), /context only/);
});

test('true sold evidence still produces marketValue normally', () => {
  const result = marketValueEngine.calculateMarketValue({
    listing: anthonyHernandezListing,
    activeCompData: {},
    soldComps: [
      soldComp(90),
      soldComp(100),
      soldComp(110)
    ],
    options: { now: '2026-07-10T00:00:00.000Z' }
  });

  assert.equal(result.source, 'sold_market');
  assert.equal(result.method, 'weightedSoldComps');
  assert.equal(result.marketValue, 100);
  assert.equal(result.expectedValue, 100);
  assert.equal(result.soldCompCount, 3);
  assert.equal(result.activeCompCount, 0);
});

test('mixed sold and active evidence prioritizes genuine sold evidence', () => {
  const result = marketValueEngine.calculateMarketValue({
    listing: anthonyHernandezListing,
    activeCompData: activeOnlyCompData({
      marketValue: 500,
      selectedComps: [
        activeComp(475),
        activeComp(500),
        activeComp(525)
      ]
    }),
    soldComps: [
      soldComp(90),
      soldComp(100),
      soldComp(110)
    ],
    options: { now: '2026-07-10T00:00:00.000Z' }
  });

  assert.equal(result.source, 'sold_market');
  assert.equal(result.marketValue, 100);
  assert.equal(result.baseMarketValue, 100);
  assert.equal(result.soldCompCount, 3);
  assert.equal(result.activeCompCount, 3);
});

test('Anthony Hernandez-style active-only valuation cannot create inflated ROI', () => {
  const marketData = marketValueEngine.calculateMarketValue({
    listing: anthonyHernandezListing,
    activeCompData: activeOnlyCompData(),
    soldComps: []
  });
  const roiData = roiEngine.evaluateROI({
    listing: anthonyHernandezListing,
    marketData
  });

  assert.equal(marketData.marketValue, 0);
  assert.equal(roiData.expectedSalePrice, 0);
  assert.equal(roiData.roi > 0, false);
  assert.equal(roiData.roiPercent > 0, false);
});

test('server scoring does not fall back to compData.marketValue for active-only valuation', () => {
  const scoring = server.scoreListing({
    ...anthonyHernandezListing,
    ebayItemId: 'anthony-hernandez-target',
    totalCost: 4.49,
    sellerFeedbackPercentage: 99.5,
    sellerFeedbackScore: 500
  }, [
    {
      ...activeComp(80),
      ebayItemId: 'anthony-hernandez-active-1'
    },
    {
      ...activeComp(82.36),
      ebayItemId: 'anthony-hernandez-active-2'
    }
  ]);

  assert.equal(scoring.marketData.source, 'insufficient_evidence');
  assert.equal(scoring.marketData.marketValue, 0);
  assert.equal(scoring.compData.marketValue > 0, true);
  assert.equal(scoring.estimatedValue, 0);
  assert.equal(scoring.roi > 0, false);
});

test('supported sold-comp behavior remains unchanged', () => {
  const result = marketValueEngine.calculateMarketValue({
    listing: anthonyHernandezListing,
    activeCompData: { confidence: 80, usableCompCount: 3, strongCompCount: 3 },
    soldComps: [
      soldComp(75),
      soldComp(100),
      soldComp(125)
    ],
    options: { now: '2026-07-10T00:00:00.000Z' }
  });

  assert.equal(result.source, 'sold_market');
  assert.equal(result.marketValue, 100);
  assert.equal(result.expectedValueLow > 0, true);
  assert.equal(result.expectedValueHigh > result.expectedValue, true);
  assert.equal(result.note, 'Market value based primarily on sold comp evidence.');
});
