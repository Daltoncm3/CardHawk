'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const supplyPressureEngine = require('../engines/supplyPressureEngine');

function activeListing(price, overrides = {}) {
  return {
    evidenceType: 'active',
    price,
    seller: 'seller-a',
    source: 'ebay',
    ageDays: 7,
    ...overrides
  };
}

function buildInput(overrides = {}) {
  return {
    evidenceSummary: {
      trueSoldCount: 8,
      activeCount: 3,
      medianSold: 100,
      weightedSoldAverage: 102,
      activeMedianAsk: 118,
      normalizedEvidence: [
        activeListing(116, { seller: 'seller-a' }),
        activeListing(118, { seller: 'seller-b' }),
        activeListing(122, { seller: 'seller-c' })
      ],
      ...(overrides.evidenceSummary || {})
    },
    salesVelocityData: {
      soldLast30Days: 6,
      inventoryPressure: 'normal',
      details: {
        activeInventoryKnown: true,
        activeInventoryQualityKnown: true,
        ...(overrides.salesVelocityData?.details || {})
      },
      ...(overrides.salesVelocityData || {})
    },
    liquidityEvidence: {
      soldCount: 8,
      activeCount: 3,
      sellThroughRate: 0.75,
      level: 'good',
      score: 74,
      ...(overrides.liquidityEvidence || {})
    },
    marketRegime: {
      primaryRegime: 'stable',
      regimes: ['stable'],
      dimensions: {
        supplyPressure: {
          status: 'normal',
          score: 62,
          explanation: 'Active supply pressure appears normal.'
        }
      },
      ...(overrides.marketRegime || {})
    },
    valuationRange: {
      expectedValue: 101,
      ...(overrides.valuationRange || {})
    },
    ...(overrides.root || {})
  };
}

test('exports supply pressure public API', () => {
  assert.equal(typeof supplyPressureEngine.evaluateSupplyPressure, 'function');
  assert.equal(typeof supplyPressureEngine.scoreSupplyPressure, 'function');
  assert.equal(typeof supplyPressureEngine.summarizeSupplyPressure, 'function');
});

test('empty input returns safe unknown evidence output', () => {
  const result = supplyPressureEngine.evaluateSupplyPressure();

  assert.equal(result.source, 'supply_pressure_engine');
  assert.equal(result.activeCount, 0);
  assert.equal(result.trueSoldCount, 0);
  assert.equal(result.activeInventoryKnown, false);
  assert.equal(result.activeToSoldRatio, null);
  assert.ok(result.warnings.length > 0);
  assert.equal(result.dimensions.inventoryDepth.status, 'unknown');
});

test('high active inventory with low true sold support creates high pressure', () => {
  const active = Array.from({ length: 12 }, (_, index) => activeListing(100 + index, {
    seller: `seller-${index}`
  }));

  const result = supplyPressureEngine.evaluateSupplyPressure(buildInput({
    evidenceSummary: {
      trueSoldCount: 2,
      activeCount: 12,
      normalizedEvidence: active
    },
    liquidityEvidence: {
      soldCount: 2,
      activeCount: 12,
      sellThroughRate: 0.15
    },
    salesVelocityData: {
      inventoryPressure: 'high'
    }
  }));

  assert.ok(['high', 'severe'].includes(result.pressureLevel));
  assert.equal(result.dimensions.activeToSoldPressure.status, 'severe');
  assert.match(result.warnings.join(' '), /active inventory/i);
});

test('active asks below sold value create high undercut risk', () => {
  const result = supplyPressureEngine.evaluateSupplyPressure(buildInput({
    evidenceSummary: {
      trueSoldCount: 8,
      medianSold: 100,
      weightedSoldAverage: 100,
      normalizedEvidence: [
        activeListing(88, { seller: 'seller-a' }),
        activeListing(92, { seller: 'seller-b' }),
        activeListing(96, { seller: 'seller-c' }),
        activeListing(101, { seller: 'seller-d' })
      ]
    }
  }));

  assert.ok(['high', 'severe'].includes(result.undercutRiskLevel));
  assert.equal(result.dimensions.belowMarketCompetition.status, 'high');
  assert.ok(result.estimatedUndercutPrice < result.referenceSoldValue);
  assert.ok(result.estimatedUndercutPercent > 0);
});

test('active asks above sold value keep undercut risk lower despite visible inventory', () => {
  const result = supplyPressureEngine.evaluateSupplyPressure(buildInput({
    evidenceSummary: {
      trueSoldCount: 8,
      activeCount: 5,
      medianSold: 100,
      weightedSoldAverage: 100,
      normalizedEvidence: [
        activeListing(125, { seller: 'seller-a' }),
        activeListing(130, { seller: 'seller-b' }),
        activeListing(135, { seller: 'seller-c' }),
        activeListing(140, { seller: 'seller-d' }),
        activeListing(145, { seller: 'seller-e' })
      ]
    }
  }));

  assert.equal(result.dimensions.belowMarketCompetition.status, 'low');
  assert.equal(result.dimensions.askStackPressure.status, 'low');
  assert.ok(result.undercutRiskScore < 50);
});

test('stale active inventory is less urgent than fresh low-priced competition', () => {
  const stale = supplyPressureEngine.evaluateSupplyPressure(buildInput({
    evidenceSummary: {
      normalizedEvidence: [
        activeListing(110, { ageDays: 120, seller: 'seller-a' }),
        activeListing(112, { ageDays: 130, seller: 'seller-b' }),
        activeListing(114, { ageDays: 140, seller: 'seller-c' }),
        activeListing(116, { ageDays: 150, seller: 'seller-d' })
      ]
    },
    liquidityEvidence: {
      sellThroughRate: 0.5
    }
  }));
  const fresh = supplyPressureEngine.evaluateSupplyPressure(buildInput({
    evidenceSummary: {
      normalizedEvidence: [
        activeListing(92, { ageDays: 2, seller: 'seller-a' }),
        activeListing(94, { ageDays: 3, seller: 'seller-b' }),
        activeListing(96, { ageDays: 4, seller: 'seller-c' }),
        activeListing(98, { ageDays: 5, seller: 'seller-d' })
      ]
    }
  }));

  assert.equal(stale.dimensions.staleInventoryRisk.status, 'stale');
  assert.equal(fresh.dimensions.staleInventoryRisk.status, 'fresh_competition');
  assert.ok(fresh.undercutRiskScore > stale.undercutRiskScore);
});

test('strong sell-through lowers supply pressure', () => {
  const result = supplyPressureEngine.evaluateSupplyPressure(buildInput({
    liquidityEvidence: {
      sellThroughRate: 1.1
    },
    salesVelocityData: {
      inventoryPressure: 'low'
    }
  }));

  assert.equal(result.dimensions.sellThroughPressure.status, 'low');
  assert.ok(result.supplyPressureScore < 55);
});

test('weak sell-through raises supply pressure', () => {
  const result = supplyPressureEngine.evaluateSupplyPressure(buildInput({
    liquidityEvidence: {
      sellThroughRate: 0.1
    },
    salesVelocityData: {
      inventoryPressure: 'high'
    }
  }));

  assert.equal(result.dimensions.sellThroughPressure.status, 'high');
  assert.ok(result.supplyPressureScore >= 45);
});

test('market regime pressure remains local evidence only', () => {
  const result = supplyPressureEngine.evaluateSupplyPressure(buildInput({
    marketRegime: {
      primaryRegime: 'thin',
      regimes: ['thin', 'stale'],
      dimensions: {
        supplyPressure: {
          status: 'high',
          score: 22,
          explanation: 'Active supply appears high relative to sold activity.'
        }
      }
    }
  }));

  assert.equal(result.dimensions.regimePressure.status, 'high');
  assert.match(result.warnings.join(' '), /Market Regime/i);
});

test('active-only evidence is context only and never becomes sold support', () => {
  const result = supplyPressureEngine.evaluateSupplyPressure(buildInput({
    evidenceSummary: {
      trueSoldCount: 0,
      activeCount: 4,
      medianSold: 0,
      weightedSoldAverage: 0,
      activeOnlyFlag: true,
      normalizedEvidence: [
        activeListing(80),
        activeListing(82),
        activeListing(84),
        activeListing(86)
      ]
    },
    liquidityEvidence: {
      soldCount: 0,
      activeCount: 4,
      sellThroughRate: 0
    }
  }));

  assert.equal(result.trueSoldCount, 0);
  assert.equal(result.activeCount, 4);
  assert.equal(result.dimensions.activeToSoldPressure.status, 'severe');
});

test('missing active inventory quality stays cautious', () => {
  const result = supplyPressureEngine.evaluateSupplyPressure({
    evidenceSummary: {
      trueSoldCount: 6,
      medianSold: 100,
      weightedSoldAverage: 100
    },
    salesVelocityData: {
      soldLast30Days: 4
    },
    liquidityEvidence: {
      soldCount: 6
    }
  });

  assert.equal(result.activeInventoryKnown, false);
  assert.equal(result.dimensions.inventoryDepth.status, 'unknown');
});

test('evaluateSupplyPressure does not mutate inputs', () => {
  const input = buildInput();
  const before = JSON.stringify(input);

  supplyPressureEngine.evaluateSupplyPressure(input);

  assert.equal(JSON.stringify(input), before);
});
