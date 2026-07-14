'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const server = require('../server');
const { createEmptySoldEvidenceStore } = require('../utils/soldEvidenceStore');

const IDENTITY_FIXTURE_PATH = path.join(__dirname, 'fixtures', 'canonical-identity', 'identity-fixtures.json');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function targetIdentity() {
  const library = JSON.parse(fs.readFileSync(IDENTITY_FIXTURE_PATH, 'utf8'));
  return clone(library.fixtures.find((entry) => entry.id === 'sports-psa10-rookie-base').identity);
}

function buildListing(overrides = {}) {
  return {
    ebayItemId: 'shadow-valuation-target',
    title: '2020 Panini Prizm Joe Burrow RC #307 PSA 10',
    price: 90,
    shipping: 5,
    totalCost: 95,
    sellerFeedbackPercentage: 99.7,
    sellerFeedbackScore: 800,
    parsed: {
      sport: 'Football',
      player: 'Joe Burrow',
      year: 2020,
      brand: 'Panini',
      product: 'Prizm',
      setName: 'Prizm',
      cardNumber: '307',
      parallel: 'Base',
      rookie: true,
      autograph: false,
      memorabilia: false,
      serialNumbered: false,
      rawOrGraded: 'graded',
      gradeCompany: 'PSA',
      grade: '10'
    },
    ...overrides
  };
}

function buildUniverse() {
  return [
    {
      ebayItemId: 'legacy-sold-valuation-1',
      title: '2020 Panini Prizm Joe Burrow RC #307 PSA 10',
      price: 125,
      sold: true,
      status: 'sold',
      soldAt: '2026-07-01T00:00:00.000Z'
    },
    {
      ebayItemId: 'legacy-active-valuation-1',
      title: '2020 Panini Prizm Joe Burrow RC #307 PSA 10',
      price: 150,
      status: 'active'
    }
  ];
}

function productionProjection(scoring = {}) {
  const dealGrade = scoring.dealGrade
    ? Object.fromEntries(Object.entries(scoring.dealGrade).filter(([key]) => key !== 'createdAt'))
    : scoring.dealGrade;

  return JSON.parse(JSON.stringify({
    score: scoring.score,
    estimatedValue: scoring.estimatedValue,
    estimatedProfit: scoring.estimatedProfit,
    roi: scoring.roi,
    ebayFees: scoring.ebayFees,
    compData: scoring.compData,
    marketData: scoring.marketData,
    roiData: scoring.roiData,
    confidenceData: scoring.confidenceData,
    marketConfidence: scoring.marketConfidence,
    confidenceCap: scoring.confidenceCap,
    compCount: scoring.compCount,
    compSource: scoring.compSource,
    qualityData: scoring.qualityData,
    investmentQuality: scoring.investmentQuality,
    qualityBucket: scoring.qualityBucket,
    riskLevel: scoring.riskLevel,
    decision: scoring.decision,
    dealGrade,
    marketIntelligenceScore: scoring.marketIntelligenceScore,
    marketTrustLevel: scoring.marketTrustLevel,
    marketRecommendation: scoring.marketRecommendation
  }));
}

function exactMatch(price, soldAt, id) {
  return {
    classification: 'exact_match',
    valuationEligible: true,
    recordId: id,
    marketplace: 'ebay',
    soldAt,
    soldPrice: price,
    evidenceType: 'true_sold',
    confidence: {
      identityConfidence: 0.97,
      evidenceQualityScore: 92,
      priceConfidence: 0.95,
      soldDateConfidence: 0.95
    }
  };
}

function buildExactShadowSoldComparison(identity = targetIdentity()) {
  const exactMatches = [
    exactMatch(100, '2026-06-01T00:00:00.000Z', 'shadow-value-1'),
    exactMatch(110, '2026-06-15T00:00:00.000Z', 'shadow-value-2'),
    exactMatch(120, '2026-07-01T00:00:00.000Z', 'shadow-value-3')
  ];

  return {
    comparisonPerformed: true,
    comparisonSource: 'canonical_sold_comparison_service_shadow',
    canonicalIdentityKey: identity.canonicalIdentityKey,
    acceptedExactMatches: exactMatches,
    contextualMatches: [],
    rejectedMatches: [],
    staleMatches: [],
    insufficientIdentityMatches: [],
    confidenceSummary: { comparedRecordCount: 3 },
    processingSummary: { processedRecords: 3 },
    productionImpact: 'none',
    decisionImpact: 'none'
  };
}

test('scoreListing exposes shadowValuation as additive insufficient-evidence diagnostics when no canonical evidence exists', () => {
  server.__setCanonicalSoldEvidenceStoreForTest(createEmptySoldEvidenceStore());
  try {
    const scoring = server.scoreListing(buildListing(), buildUniverse());

    assert.ok(scoring.shadowValuation);
    assert.equal(scoring.shadowValuation.valuationSource, 'shadow_valuation_engine');
    assert.equal(scoring.shadowValuation.valuationPerformed, false);
    assert.equal(scoring.shadowValuation.insufficientEvidence, true);
    assert.equal(scoring.shadowValuation.recommendedMarketValue, null);
    assert.equal(scoring.shadowValuation.productionImpact, 'none');
    assert.equal(scoring.shadowValuation.decisionImpact, 'none');
  } finally {
    server.__setCanonicalSoldEvidenceStoreForTest(null);
  }
});

test('production valuation and runtime decisions remain byte-for-byte unchanged', () => {
  server.__setCanonicalSoldEvidenceStoreForTest(createEmptySoldEvidenceStore());
  try {
    const first = server.scoreListing(buildListing(), buildUniverse());
    const second = server.scoreListing(buildListing(), buildUniverse());

    assert.deepEqual(productionProjection(second), productionProjection(first));
    assert.deepEqual(first.decision, second.decision);
    assert.equal(first.shadowValuation.productionImpact, 'none');
    assert.equal(second.shadowValuation.decisionImpact, 'none');
  } finally {
    server.__setCanonicalSoldEvidenceStoreForTest(null);
  }
});

test('shadow valuation builder produces deterministic production-vs-shadow comparison metrics', () => {
  const identity = targetIdentity();
  const shadowSoldComparison = buildExactShadowSoldComparison(identity);
  const first = server.buildShadowValuation({
    listing: buildListing({ canonicalIdentity: identity }),
    canonicalSoldEvidence: { records: shadowSoldComparison.acceptedExactMatches },
    shadowSoldComparison,
    marketData: { marketValue: 100, confidence: 72 },
    compData: { compCount: 4, trueSoldCompCount: 3, soldCompCount: 3 },
    estimatedValue: 100,
    marketConfidence: 72
  });
  const second = server.buildShadowValuation({
    listing: buildListing({ canonicalIdentity: identity }),
    canonicalSoldEvidence: { records: shadowSoldComparison.acceptedExactMatches },
    shadowSoldComparison,
    marketData: { marketValue: 100, confidence: 72 },
    compData: { compCount: 4, trueSoldCompCount: 3, soldCompCount: 3 },
    estimatedValue: 100,
    marketConfidence: 72
  });

  assert.deepEqual(second, first);
  assert.equal(first.valuationPerformed, true);
  assert.equal(first.insufficientEvidence, false);
  assert.ok(first.recommendedMarketValue > 0);
  assert.ok(first.fairMarketRange.floorValue <= first.recommendedMarketValue);
  assert.ok(first.recommendedMarketValue <= first.fairMarketRange.ceilingValue);
  assert.equal(first.productionVsShadowValuation.productionEstimatedValue, 100);
  assert.equal(first.productionVsShadowValuation.shadowRecommendedValue, first.recommendedMarketValue);
  assert.equal(typeof first.productionVsShadowValuation.absoluteValueDifference, 'number');
  assert.equal(typeof first.productionVsShadowValuation.percentageDifference, 'number');
  assert.equal(first.productionVsShadowValuation.evidenceComparison.shadowExactMatchCount, 3);
});

test('insufficient shadow valuation never estimates or guesses a value', () => {
  const identity = targetIdentity();
  const result = server.buildShadowValuation({
    listing: buildListing({ canonicalIdentity: identity }),
    canonicalSoldEvidence: { records: [] },
    shadowSoldComparison: {
      comparisonPerformed: true,
      canonicalIdentityKey: identity.canonicalIdentityKey,
      acceptedExactMatches: [],
      contextualMatches: [],
      rejectedMatches: [],
      staleMatches: [],
      insufficientIdentityMatches: [],
      productionImpact: 'none',
      decisionImpact: 'none'
    },
    marketData: { marketValue: 999, confidence: 90 },
    compData: { compCount: 10, trueSoldCompCount: 0 },
    estimatedValue: 999,
    marketConfidence: 90
  });

  assert.equal(result.valuationPerformed, false);
  assert.equal(result.insufficientEvidence, true);
  assert.equal(result.fairMarketRange, null);
  assert.equal(result.recommendedMarketValue, null);
  assert.equal(result.productionVsShadowValuation.shadowRecommendedValue, null);
  assert.equal(result.productionVsShadowValuation.valuationEligibilityComparison.shadowValuationAvailable, false);
  assert.ok(result.productionVsShadowValuation.disagreementReasons.includes(result.insufficientEvidenceReason));
});
