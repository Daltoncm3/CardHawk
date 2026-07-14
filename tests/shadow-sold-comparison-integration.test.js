'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const canonicalIdentityEngine = require('../engines/canonicalIdentityEngine');
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
    ebayItemId: 'shadow-sold-target',
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
      ebayItemId: 'legacy-sold-1',
      title: '2020 Panini Prizm Joe Burrow RC #307 PSA 10',
      price: 140,
      sold: true,
      status: 'sold',
      soldAt: '2026-07-01T00:00:00.000Z'
    },
    {
      ebayItemId: 'legacy-active-1',
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

function soldRecord(identity, overrides = {}) {
  return {
    id: overrides.id || 'canonical-sale-1',
    marketplace: 'ebay',
    marketplaceSaleId: overrides.marketplaceSaleId || overrides.id || 'canonical-sale-1',
    evidenceType: 'true_sold',
    status: 'active_evidence',
    rawTitle: identity.raw.title,
    soldPrice: 140,
    totalPaid: 145,
    soldAt: '2026-07-01T00:00:00.000Z',
    identityConfidence: 0.98,
    evidenceQualityScore: 92,
    priceConfidence: 0.95,
    soldDateConfidence: 0.95,
    canonicalIdentity: identity,
    ...overrides
  };
}

test('scoreListing exposes shadowSoldComparison as an additive runtime object with missing evidence handled safely', () => {
  server.__setCanonicalSoldEvidenceStoreForTest(createEmptySoldEvidenceStore());
  try {
    const scoring = server.scoreListing(buildListing(), buildUniverse());

    assert.ok(scoring.shadowSoldComparison);
    assert.equal(scoring.shadowSoldComparison.comparisonPerformed, false);
    assert.equal(scoring.shadowSoldComparison.comparisonSource, 'canonical_sold_comparison_service_shadow');
    assert.equal(scoring.shadowSoldComparison.productionImpact, 'none');
    assert.equal(scoring.shadowSoldComparison.decisionImpact, 'none');
    assert.deepEqual(scoring.shadowSoldComparison.acceptedExactMatches, []);
    assert.deepEqual(scoring.shadowSoldComparison.contextualMatches, []);
    assert.deepEqual(scoring.shadowSoldComparison.rejectedMatches, []);
    assert.equal(scoring.shadowSoldComparison.processingSummary.processedRecords, 0);
  } finally {
    server.__setCanonicalSoldEvidenceStoreForTest(null);
  }
});

test('shadow diagnostics are additive only and do not change production output fields', () => {
  server.__setCanonicalSoldEvidenceStoreForTest(createEmptySoldEvidenceStore());
  try {
    const scoring = server.scoreListing(buildListing(), buildUniverse());
    const beforeProjection = productionProjection(scoring);
    const shadow = scoring.shadowSoldComparison;
    const afterProjection = productionProjection({ ...scoring, shadowSoldComparison: shadow });

    assert.deepEqual(afterProjection, beforeProjection);
    assert.equal(shadow.productionImpact, 'none');
    assert.equal(shadow.decisionImpact, 'none');
  } finally {
    server.__setCanonicalSoldEvidenceStoreForTest(null);
  }
});

test('shadow sold comparison performs deterministic canonical comparison and contrasts legacy vs canonical systems', () => {
  const identity = targetIdentity();
  const listing = buildListing({ canonicalIdentity: identity });
  const exactRecord = soldRecord(identity, { id: 'canonical-sale-exact' });
  const contextualIdentity = clone(identity);
  contextualIdentity.normalized.parallel = 'silver prizm';
  const rebuiltContextualIdentity = canonicalIdentityEngine.buildCanonicalIdentity({
    canonicalSoldEvidenceIdentity: contextualIdentity
  });
  const contextualRecord = soldRecord(rebuiltContextualIdentity, {
    id: 'canonical-sale-contextual',
    marketplaceSaleId: 'canonical-sale-contextual'
  });
  const compData = {
    compCount: 1,
    trueSoldCompCount: 1,
    soldCompCount: 1,
    activeCompCount: 0,
    selectedComps: [
      {
        id: 'canonical-sale-exact',
        marketplaceSaleId: 'canonical-sale-exact'
      }
    ]
  };
  const canonicalSoldEvidence = {
    records: [exactRecord, contextualRecord]
  };

  const first = server.buildShadowSoldComparison({ listing, compData, canonicalSoldEvidence });
  const second = server.buildShadowSoldComparison({ listing, compData, canonicalSoldEvidence });

  assert.deepEqual(second, first);
  assert.equal(first.comparisonPerformed, true);
  assert.equal(first.canonicalIdentityKey, identity.canonicalIdentityKey);
  assert.equal(first.acceptedExactMatches.length, 1);
  assert.equal(first.contextualMatches.length, 1);
  assert.equal(first.contextualMatches[0].valuationEligible, false);
  assert.equal(first.comparisonSummary.includes('exact canonical sold match'), true);
  assert.equal(first.legacyVsCanonicalComparison.legacyCompEngine.acceptedComparableCount, 1);
  assert.equal(first.legacyVsCanonicalComparison.canonicalSoldComparisonService.exactMatchesFound, 1);
  assert.deepEqual(first.legacyVsCanonicalComparison.recordsAgreedByBoth, ['canonical-sale-exact']);
  assert.deepEqual(first.legacyVsCanonicalComparison.recordsOnlyFoundByCanonical, ['canonical-sale-contextual']);
});

test('shadow comparison never affects runtime decisions', () => {
  server.__setCanonicalSoldEvidenceStoreForTest(createEmptySoldEvidenceStore());
  try {
    const first = server.scoreListing(buildListing(), buildUniverse());
    const second = server.scoreListing(buildListing(), buildUniverse());

    assert.deepEqual(productionProjection(second), productionProjection(first));
    assert.equal(first.shadowSoldComparison.productionImpact, 'none');
    assert.equal(second.shadowSoldComparison.decisionImpact, 'none');
    assert.deepEqual(first.decision, second.decision);
  } finally {
    server.__setCanonicalSoldEvidenceStoreForTest(null);
  }
});
