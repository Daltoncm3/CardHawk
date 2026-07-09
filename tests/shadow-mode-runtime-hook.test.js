'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

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

function withShadowFlag(value, fn) {
  const previous = process.env.CARDHAWK_SHADOW_MODE_ENABLED;

  if (value === undefined) delete process.env.CARDHAWK_SHADOW_MODE_ENABLED;
  else process.env.CARDHAWK_SHADOW_MODE_ENABLED = value;

  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.CARDHAWK_SHADOW_MODE_ENABLED;
    else process.env.CARDHAWK_SHADOW_MODE_ENABLED = previous;
    server.__setShadowModeDecisionIntelligenceEvaluatorForTest(null);
    server.__setShadowModeDecisionLoggerForTest(null);
  }
}

function buildListing(overrides = {}) {
  return {
    ebayItemId: 'shadow-target',
    title: '2024 Topps Chrome John Doe Rookie PSA 10',
    price: 50,
    shipping: 5,
    totalCost: 55,
    sellerFeedbackPercentage: 99.8,
    sellerFeedbackScore: 500,
    url: 'https://example.test/shadow-target',
    ...overrides
  };
}

function buildCompUniverse() {
  return [
    {
      ebayItemId: 'shadow-comp-sold-1',
      title: '2024 Topps Chrome John Doe Rookie PSA 10',
      price: 110,
      soldAt: '2026-07-01T00:00:00.000Z',
      status: 'completed'
    },
    {
      ebayItemId: 'shadow-comp-sold-2',
      title: '2024 Topps Chrome John Doe Rookie PSA 10',
      price: 115,
      sold: true,
      status: 'sold'
    },
    {
      ebayItemId: 'shadow-comp-active',
      title: '2024 Topps Chrome John Doe Rookie PSA 10',
      price: 120,
      status: 'active'
    }
  ];
}

function projectRuntimeOutput(scoring = {}) {
  return {
    score: scoring.score,
    estimatedValue: scoring.estimatedValue,
    estimatedProfit: scoring.estimatedProfit,
    roi: scoring.roi,
    ebayFees: scoring.ebayFees,
    compCount: scoring.compCount,
    compSource: scoring.compSource,
    marketConfidence: scoring.marketConfidence,
    confidenceCap: scoring.confidenceCap,
    investmentQuality: scoring.investmentQuality,
    qualityBucket: scoring.qualityBucket,
    liquidityScore: scoring.liquidityScore,
    riskLevel: scoring.riskLevel,
    marketIntelligenceScore: scoring.marketIntelligenceScore,
    marketTrustLevel: scoring.marketTrustLevel,
    marketRecommendation: scoring.marketRecommendation,
    decision: scoring.decision,
    marketIntelligenceData: scoring.marketIntelligenceData
  };
}

test('Shadow Mode feature flag defaults to disabled', () => {
  withShadowFlag(undefined, () => {
    assert.equal(server.isShadowModeEnabled(), false);
  });
});

test('Decision Intelligence shadow hook is not executed when disabled', () => {
  withShadowFlag('false', () => {
    let calls = 0;
    let logCalls = 0;
    server.__setShadowModeDecisionIntelligenceEvaluatorForTest(() => {
      calls += 1;
    });
    server.__setShadowModeDecisionLoggerForTest(() => {
      logCalls += 1;
    });

    server.runShadowModeDecisionIntelligence({
      evidenceSufficiency: { sufficiencyLevel: 'strong' }
    });
    server.scoreListing(buildListing(), buildCompUniverse());

    assert.equal(calls, 0);
    assert.equal(logCalls, 0);
  });
});

test('Decision Intelligence shadow hook executes and logs when enabled while discarding output', () => {
  withShadowFlag('true', () => {
    const inputs = [];
    const logs = [];
    server.__setShadowModeDecisionIntelligenceEvaluatorForTest((input) => {
      inputs.push(input);
      return {
        recommendationImpact: 'none',
        summary: 'discarded shadow output'
      };
    });
    server.__setShadowModeDecisionLoggerForTest((input) => {
      logs.push(input);
    });

    const scoring = server.scoreListing(buildListing(), buildCompUniverse());

    assert.equal(inputs.length, 1);
    assert.ok(inputs[0].evidenceSufficiency);
    assert.ok(inputs[0].comparableQuality);
    assert.ok(inputs[0].valuationRange);
    assert.ok(inputs[0].supplyPressure);
    assert.equal(logs.length, 1);
    assert.equal(logs[0].listing.ebayItemId, 'shadow-target');
    assert.equal(logs[0].decisionIntelligence.summary, 'discarded shadow output');
    assert.equal(scoring.shadowModeDecisionIntelligence, undefined);
    assert.equal(scoring.shadowMode, undefined);
  });
});

test('runtime scoring outputs are unchanged with Shadow Mode enabled', () => {
  const disabled = withShadowFlag('false', () =>
    projectRuntimeOutput(server.scoreListing(buildListing(), buildCompUniverse()))
  );
  const enabled = withShadowFlag('true', () => {
    server.__setShadowModeDecisionIntelligenceEvaluatorForTest(() => ({
      recommendationImpact: 'none',
      summary: 'discarded shadow output'
    }));
    server.__setShadowModeDecisionLoggerForTest(() => {});

    return projectRuntimeOutput(server.scoreListing(buildListing(), buildCompUniverse()));
  });

  assert.deepEqual(enabled, disabled);
});

test('Shadow Mode evaluator failure does not change runtime scoring output', () => {
  const disabled = withShadowFlag('false', () =>
    projectRuntimeOutput(server.scoreListing(buildListing(), buildCompUniverse()))
  );
  const enabled = withShadowFlag('true', () => {
    server.__setShadowModeDecisionIntelligenceEvaluatorForTest(() => {
      throw new Error('shadow failure');
    });

    return projectRuntimeOutput(server.scoreListing(buildListing(), buildCompUniverse()));
  });

  assert.deepEqual(enabled, disabled);
});

test('Shadow Mode logger failure does not change runtime scoring output', () => {
  const disabled = withShadowFlag('false', () =>
    projectRuntimeOutput(server.scoreListing(buildListing(), buildCompUniverse()))
  );
  const enabled = withShadowFlag('true', () => {
    server.__setShadowModeDecisionIntelligenceEvaluatorForTest(() => ({
      recommendationImpact: 'none',
      summary: 'discarded shadow output'
    }));
    server.__setShadowModeDecisionLoggerForTest(() => {
      throw new Error('shadow logger failure');
    });

    return projectRuntimeOutput(server.scoreListing(buildListing(), buildCompUniverse()));
  });

  assert.deepEqual(enabled, disabled);
});
