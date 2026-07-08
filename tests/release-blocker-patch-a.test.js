'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const compEngine = require('../engines/compEngine');

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

const { dealGate } = require('../server');

const listing = {
  title: '2024 Topps Chrome John Doe Rookie PSA 10',
  price: 50,
  totalCost: 55,
  condition: 'PSA 10',
  parsed: {
    year: 2024,
    player: 'John Doe',
    set: 'Topps Chrome',
    grade: '10',
    grader: 'psa',
    rookie: true
  }
};

function highSupportGateInput(overrides = {}) {
  return {
    score: 95,
    estimatedProfit: 100,
    roi: 0.5,
    condition: 'PSA 10',
    marketData: {
      confidence: 90,
      liquidityScore: 80,
      source: 'sold_market'
    },
    marketIntelligenceScore: 90,
    marketTrustLevel: 'good',
    marketRecommendation: 'trust',
    marketIntelligenceData: {
      liquidity: { score: 80, level: 'good' },
      priceConsistency: { score: 80, level: 'good' }
    },
    riskLevel: 'low',
    ...overrides
  };
}

test('active listing with price does not count as sold comp', () => {
  const result = compEngine.evaluateListing(listing, [
    {
      title: listing.title,
      price: 100,
      status: 'active',
      url: 'https://example.test/active-card'
    }
  ]);

  assert.equal(result.compCount, 1);
  assert.equal(result.trueSoldCompCount, 0);
  assert.equal(result.soldCompCount, 0);
  assert.equal(result.activeCompCount, 1);
  assert.equal(result.selectedComps[0].evidenceType, 'active');
});

test('sold-like record counts as sold comp', () => {
  const result = compEngine.evaluateListing(listing, [
    {
      title: listing.title,
      price: 100,
      soldAt: '2026-07-01T00:00:00.000Z',
      status: 'completed'
    }
  ]);

  assert.equal(result.compCount, 1);
  assert.equal(result.trueSoldCompCount, 1);
  assert.equal(result.soldCompCount, 1);
  assert.equal(result.activeCompCount, 0);
  assert.equal(result.selectedComps[0].evidenceType, 'true_sold');
});

test('Deal Gate cannot pass sold-comp requirement using only compData.compCount', () => {
  const gate = dealGate(highSupportGateInput({
    compData: {
      compCount: 10,
      confidence: 90,
      source: 'active_market'
    }
  }));

  assert.equal(gate.passed, false);
  assert.equal(gate.decision, 'REJECT');
  assert.equal(gate.gate.soldCompCount, 0);
  assert.match(gate.reasons.join(' '), /Zero sold comps available/);
});

test('fallback/active-only valuation cannot produce BUY_NOW without true sold support', () => {
  const compData = compEngine.evaluateListing(listing, [
    {
      title: listing.title,
      price: 100,
      status: 'active',
      url: 'https://example.test/active-card-1'
    },
    {
      title: listing.title,
      price: 105,
      isActive: true,
      url: 'https://example.test/active-card-2'
    },
    {
      title: listing.title,
      price: 95,
      listingStatus: 'live',
      url: 'https://example.test/active-card-3'
    }
  ]);

  const gate = dealGate(highSupportGateInput({
    estimatedValue: compData.marketValue,
    compData
  }));

  assert.equal(compData.compCount, 3);
  assert.equal(compData.trueSoldCompCount, 0);
  assert.equal(compData.activeCompCount, 3);
  assert.equal(gate.passed, false);
  assert.equal(gate.decision, 'REJECT');
  assert.equal(gate.gate.soldCompCount, 0);
});
