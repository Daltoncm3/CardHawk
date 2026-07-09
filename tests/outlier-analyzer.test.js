'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const outlierAnalyzer = require('../engines/intelligence/outlierAnalyzer');

test('legacy output fields are preserved', () => {
  const result = outlierAnalyzer.analyzeOutliers({
    soldSales: [
      { soldPrice: 95 },
      { soldPrice: 100 },
      { soldPrice: 105 }
    ],
    listing: { price: 100 }
  });

  const legacyFields = [
    'score',
    'level',
    'compCount',
    'outlierCount',
    'outlierRate',
    'moderateOutlierCount',
    'highOutlierCount',
    'extremeOutlierCount',
    'marketAveragePrice',
    'marketMedianPrice',
    'marketLowPrice',
    'marketHighPrice',
    'standardDeviation',
    'priceSpreadPercent',
    'listingPrice',
    'listingDeviationPercent',
    'listingClassification',
    'outliers',
    'warnings',
    'positives'
  ];

  for (const field of legacyFields) {
    assert.ok(Object.prototype.hasOwnProperty.call(result, field), `${field} should exist`);
  }

  assert.equal(result.compCount, 3);
  assert.equal(result.listingClassification, 'normal');
  assert.deepEqual(result.outliers, []);
});

test('canonical evidence-only fields are added as aliases and metadata', () => {
  const result = outlierAnalyzer.analyzeOutliers({
    soldSales: [
      { soldPrice: 95 },
      { soldPrice: 100 },
      { soldPrice: 105 }
    ],
    listing: { price: 100 }
  });

  assert.equal(result.source, 'outlier_analyzer');
  assert.equal(result.version, '1.5G');
  assert.equal(result.evidenceRole, 'evidence_only');
  assert.deepEqual(result.analysisScope, ['sold_market_distribution', 'listing_vs_market_reference']);
  assert.equal(result.outlierRiskScore, result.score);
  assert.equal(result.outlierRiskLevel, result.level);
  assert.equal(result.insufficientEvidence, false);
  assert.equal(result.referencePrice, 100);
  assert.equal(result.referencePriceBasis, 'median_sold');
  assert.deepEqual(result.saleOutlierSummary, {
    outlierCount: result.outlierCount,
    outlierRate: result.outlierRate,
    moderateCount: result.moderateOutlierCount,
    highCount: result.highOutlierCount,
    extremeCount: result.extremeOutlierCount
  });
  assert.deepEqual(result.listingOutlier, {
    price: result.listingPrice,
    deviationPercent: result.listingDeviationPercent,
    classification: result.listingClassification
  });
  assert.ok(Array.isArray(result.outlierEvidence));
  assert.ok(result.summary);
});

test('empty input returns safe evidence-only output', () => {
  const result = outlierAnalyzer.analyzeOutliers();

  assert.equal(result.compCount, 0);
  assert.equal(result.outlierCount, 0);
  assert.equal(result.outlierRate, 0);
  assert.equal(result.insufficientEvidence, true);
  assert.equal(result.referencePrice, 0);
  assert.equal(result.referencePriceBasis, 'unknown');
  assert.equal(result.listingClassification, 'unknown');
  assert.deepEqual(result.outliers, []);
  assert.deepEqual(result.outlierEvidence, []);
  assert.match(result.summary, /insufficient/i);
});

test('insufficient sold evidence is explicit without changing legacy score behavior', () => {
  const result = outlierAnalyzer.analyzeOutliers({
    soldSales: [
      { soldPrice: 100 },
      { soldPrice: 130 }
    ]
  });

  assert.equal(result.compCount, 2);
  assert.equal(result.score, 35);
  assert.equal(result.outlierRiskScore, 35);
  assert.equal(result.level, 'weak');
  assert.equal(result.insufficientEvidence, true);
  assert.match(result.warnings.join(' '), /not enough sold comps/i);
});

test('sale outliers are classified from sold evidence', () => {
  const result = outlierAnalyzer.analyzeOutliers({
    soldSales: [
      { title: 'Normal sold A', soldPrice: 100 },
      { title: 'Normal sold B', soldPrice: 105 },
      { title: 'Normal sold C', soldPrice: 110 },
      { title: 'Extreme sold', soldPrice: 300 }
    ]
  });

  assert.equal(result.compCount, 4);
  assert.equal(result.outlierCount, 1);
  assert.equal(result.extremeOutlierCount, 1);
  assert.equal(result.saleOutlierSummary.extremeCount, 1);
  assert.equal(result.outliers[0].classification, 'extreme');
  assert.equal(result.outlierEvidence.find((item) => item.price === 300).classification, 'extreme');
});

test('listing outlier classification is separate from sale outlier classification', () => {
  const result = outlierAnalyzer.analyzeOutliers({
    soldSales: [
      { soldPrice: 95 },
      { soldPrice: 100 },
      { soldPrice: 105 }
    ],
    listing: {
      price: 180
    }
  });

  assert.equal(result.outlierCount, 0);
  assert.equal(result.listingClassification, 'extreme');
  assert.equal(result.listingOutlier.classification, 'extreme');
  assert.equal(result.listingOutlier.price, 180);
  assert.match(result.warnings.join(' '), /listing price appears to be an outlier/i);
});

test('active listings are never treated as sold outlier evidence', () => {
  const result = outlierAnalyzer.analyzeOutliers({
    soldSales: [
      { soldPrice: 100 },
      { soldPrice: 102 },
      { soldPrice: 98 }
    ],
    activeListings: [
      { price: 500, status: 'active' },
      { price: 8, status: 'active' }
    ],
    compData: {
      selectedComps: [
        { price: 500, evidenceType: 'active' }
      ]
    }
  });

  assert.equal(result.compCount, 3);
  assert.equal(result.outlierCount, 0);
  assert.equal(result.outlierEvidence.length, 3);
  assert.ok(result.outlierEvidence.every((item) => item.price >= 98 && item.price <= 102));
});

test('normalizeOutlierEvidence only normalizes soldSales input', () => {
  const evidence = outlierAnalyzer.normalizeOutlierEvidence({
    referencePrice: 100,
    soldSales: [
      { soldPrice: 100 },
      { soldPrice: 180 }
    ],
    activeListings: [
      { price: 500 }
    ]
  });

  assert.equal(evidence.length, 2);
  assert.deepEqual(evidence.map((item) => item.price), [100, 180]);
  assert.equal(evidence[1].classification, 'extreme');
});

test('analyzeOutliers does not mutate inputs', () => {
  const input = {
    marketData: { medianPrice: 100 },
    compData: { averagePrice: 102 },
    listing: { price: 180 },
    soldSales: [
      { title: 'Sold A', soldPrice: 95 },
      { title: 'Sold B', soldPrice: 100 },
      { title: 'Sold C', soldPrice: 105 }
    ]
  };
  const before = JSON.stringify(input);

  outlierAnalyzer.analyzeOutliers(input);

  assert.equal(JSON.stringify(input), before);
});

test('public helper exports are available', () => {
  assert.equal(typeof outlierAnalyzer.analyzeOutliers, 'function');
  assert.equal(typeof outlierAnalyzer.classifyOutlier, 'function');
  assert.equal(typeof outlierAnalyzer.normalizeOutlierEvidence, 'function');
  assert.equal(typeof outlierAnalyzer.scoreOutlierRisk, 'function');
  assert.equal(typeof outlierAnalyzer.summarizeOutliers, 'function');
});
