'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const decisionEngine = require('../engines/decisionEngine');
const marketIntelligenceEngine = require('../engines/marketIntelligenceEngine');
const riskEngine = require('../engines/riskEngine');

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

function strongGateInput(overrides = {}) {
  return {
    score: 95,
    estimatedProfit: 45,
    roi: 0.35,
    roiData: {
      roi: 0.35,
      roiPercent: 35
    },
    condition: 'PSA 10',
    compData: {
      soldCompCount: 8,
      source: 'sold_market'
    },
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

function marketGuardrailInput(roiData) {
  return {
    listing: {
      price: 100,
      totalCost: 100,
      condition: 'PSA 10'
    },
    roiData,
    marketData: {
      confidence: 80,
      marketValue: 130,
      source: 'sold_market'
    },
    compData: {
      soldCompCount: 3,
      compCount: 3,
      confidence: 80,
      source: 'sold_market'
    },
    soldSales: [
      { soldPrice: 120 },
      { soldPrice: 130 },
      { soldPrice: 140 }
    ],
    qualityData: {
      condition: 'PSA 10'
    }
  };
}

test('Deal Gate interprets normal decimal ROI as 35 percent, not 0.35 percent or 3500 percent', () => {
  const gate = dealGate(strongGateInput());

  assert.equal(gate.gate.roi, 0.35);
  assert.equal(gate.gate.roiPercent, 35);
  assert.equal(gate.passed, true);
  assert.doesNotMatch(gate.reasons.join(' '), /ROI is excessive/);
});

test('Deal Gate excessive ROI sanity check interprets decimal ROI as percent units', () => {
  const gate = dealGate(strongGateInput({
    roi: 2.5,
    roiData: {
      roi: 2.5,
      roiPercent: 250
    },
    compData: {
      soldCompCount: 3,
      source: 'sold_market'
    }
  }));

  assert.equal(gate.gate.roi, 2.5);
  assert.equal(gate.gate.roiPercent, 250);
  assert.equal(gate.passed, false);
  assert.match(gate.reasons.join(' '), /ROI is excessive \(250%\)/);
});

test('Risk and Market Intelligence excessive ROI checks use roiPercent over decimal roi', () => {
  const normalRisk = riskEngine.evaluateRisk(marketGuardrailInput({ roi: 0.35, roiPercent: 35, netProfit: 35 }));
  const normalIntelligence = marketIntelligenceEngine.evaluateMarketIntelligence(
    marketGuardrailInput({ roi: 0.35, roiPercent: 35, netProfit: 35 })
  );

  assert.match(normalRisk.positives.join(' '), /ROI is within a realistic range \(35%\)/);
  assert.doesNotMatch(normalRisk.warnings.join(' '), /ROI appears impossible|ROI is very high/);
  assert.equal(normalIntelligence.projectedRoi, 35);
  assert.doesNotMatch(normalIntelligence.warnings.join(' '), /Projected ROI is unusually high/);

  const extremeRisk = riskEngine.evaluateRisk(marketGuardrailInput({ roi: 2.51, roiPercent: 251, netProfit: 251 }));
  const extremeIntelligence = marketIntelligenceEngine.evaluateMarketIntelligence(
    marketGuardrailInput({ roi: 2.51, roiPercent: 251, netProfit: 251 })
  );

  assert.match(extremeRisk.warnings.join(' '), /ROI appears impossible \(251%\)/);
  assert.equal(extremeIntelligence.projectedRoi, 251);
  assert.match(extremeIntelligence.warnings.join(' '), /Projected ROI is unusually high \(251%\)/);
});

test('Decision Engine conservative ROI score uses percent units without changing thresholds', () => {
  const normalDecision = decisionEngine.evaluateDecision({
    roiData: { roi: 0.35, roiPercent: 35 },
    listing: { totalCost: 100 },
    estimatedProfit: 35
  });

  const extremeDecision = decisionEngine.evaluateDecision({
    roiData: { roi: 2.51, roiPercent: 251 },
    listing: { totalCost: 100 },
    estimatedProfit: 251
  });

  assert.equal(normalDecision.componentScores.roi, 70);
  assert.equal(normalDecision.conservativeRoi, 35);
  assert.equal(extremeDecision.componentScores.roi, 55);
  assert.equal(extremeDecision.conservativeRoi, 251);
});
