'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const legacyIdentityAdapter = require('../engines/legacyIdentityAdapter');
const {
  buildDisplayInterpretation,
  buildCanonicalIdentityDiagnostics,
  dealGate
} = require('../server');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function baseListing(overrides = {}) {
  return {
    ebayItemId: 'identity-runtime-1',
    title: '2020 Panini Prizm Joe Burrow RC #307 PSA 10',
    lane: 'football',
    price: 100,
    shipping: 5,
    totalCost: 105,
    estimatedValue: 175,
    estimatedProfit: 42,
    roi: 40,
    score: 82,
    marketConfidence: 78,
    investmentQuality: 84,
    qualityBucket: 'Good Flip Candidate',
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
      grade: '10',
      qualityTier: 'strong'
    },
    compData: {
      compCount: 5,
      trueSoldCompCount: 4,
      soldCompCount: 4,
      activeCompCount: 1
    },
    marketData: {
      source: 'sold_comps',
      soldCompCount: 4,
      activeCompCount: 1,
      marketValue: 175,
      confidence: 78
    },
    qualityData: {
      investmentQuality: 84,
      bucket: 'Good Flip Candidate'
    },
    dealGrade: {
      grade: 'B+',
      action: 'REVIEW',
      gradeScore: 82
    },
    roiData: {
      recommendation: 'REVIEW',
      netProfit: 42,
      roi: 40
    },
    dealGate: {
      passed: true,
      reasons: [],
      positives: ['Minimum sold comps available.'],
      gate: {
        soldCompCount: 4,
        estimatedProfit: 42,
        roiPercent: 40,
        score: 82
      },
      buyNowAllowed: true,
      decision: 'BUY_NOW'
    },
    ...overrides
  };
}

test('legacy adapter exposes standalone public API', () => {
  assert.equal(typeof legacyIdentityAdapter.buildCanonicalIdentityInput, 'function');
  assert.equal(typeof legacyIdentityAdapter.buildLegacyIdentityDiagnostics, 'function');
  assert.equal(typeof legacyIdentityAdapter.compareLegacyToCanonical, 'function');
  assert.equal(typeof buildCanonicalIdentityDiagnostics, 'function');
});

test('legacy parsed fields remain unchanged while canonical identity diagnostics are additive', () => {
  const listing = baseListing();
  const before = clone(listing);

  const displayListing = buildDisplayInterpretation(listing);

  assert.deepEqual(listing, before);
  assert.deepEqual(displayListing.parsed, before.parsed);
  assert.ok(displayListing.canonicalIdentity);
  assert.ok(displayListing.display.canonicalIdentityDiagnostics);
  assert.equal(displayListing.productionImpact, 'none');
  assert.equal(displayListing.decisionImpact, 'none');
  assert.equal(displayListing.exactCompEligible, displayListing.canonicalIdentity.eligibility.exactCompEligible);
  assert.equal(displayListing.valuationEligible, displayListing.canonicalIdentity.eligibility.valuationEligible);
  assert.equal(displayListing.overallIdentityConfidence, displayListing.canonicalIdentity.overallIdentityConfidence);
});

test('runtime decision fields remain byte-for-byte unchanged after diagnostics are attached', () => {
  const listing = baseListing();
  const before = clone({
    dealGate: listing.dealGate,
    score: listing.score,
    estimatedValue: listing.estimatedValue,
    estimatedProfit: listing.estimatedProfit,
    roi: listing.roi,
    qualityData: listing.qualityData,
    dealGrade: listing.dealGrade,
    roiData: listing.roiData
  });

  const displayListing = buildDisplayInterpretation(listing);
  const after = {
    dealGate: displayListing.dealGate,
    score: displayListing.score,
    estimatedValue: displayListing.estimatedValue,
    estimatedProfit: displayListing.estimatedProfit,
    roi: displayListing.roi,
    qualityData: displayListing.qualityData,
    dealGrade: displayListing.dealGrade,
    roiData: displayListing.roiData
  };

  assert.deepEqual(after, before);
  assert.deepEqual(dealGate({
    score: 90,
    estimatedProfit: 40,
    roi: 35,
    compData: { trueSoldCompCount: 4, soldCompCount: 4 },
    marketData: { soldCompCount: 4, source: 'sold_comps' }
  }), dealGate({
    score: 90,
    estimatedProfit: 40,
    roi: 35,
    compData: { trueSoldCompCount: 4, soldCompCount: 4 },
    marketData: { soldCompCount: 4, source: 'sold_comps' }
  }));
});

test('legacy identity comparison reports matching fields, conflicts, legacy-only fields, and confidence differences', () => {
  const listing = baseListing();
  const diagnostics = legacyIdentityAdapter.buildLegacyIdentityDiagnostics(listing, {
    canonicalSoldEvidenceIdentity: {
      identityType: 'sports_card',
      category: 'sports_card',
      marketSegment: 'sports',
      raw: { title: listing.title, source: 'verified_fixture' },
      normalized: {
        sport: 'Football',
        subject: { name: 'Josh Allen', aliases: [] },
        year: 2020,
        manufacturer: 'Panini',
        brand: 'Panini',
        product: 'Prizm',
        setName: 'Prizm',
        cardNumber: '307',
        parallel: 'Base',
        rookieDesignation: true,
        autograph: { state: false, type: null },
        memorabilia: { state: false, type: null },
        serialNumbered: false,
        rawOrGraded: 'graded',
        grading: { company: 'PSA', grade: '10' }
      }
    }
  });

  const comparison = diagnostics.legacyIdentityComparison;

  assert.ok(comparison.matchingFields.some((entry) => entry.field === 'cardNumber'));
  assert.ok(comparison.conflictingFields.some((entry) => entry.field === 'subject'));
  assert.ok(comparison.fieldsOnlyPresentInLegacyIdentity.some((entry) => entry.field === 'qualityTier'));
  assert.ok(comparison.confidenceDifferences.some((entry) => entry.field === 'subject'));
});

test('unknowns and warnings are reported without making the listing authoritative', () => {
  const diagnostics = legacyIdentityAdapter.buildLegacyIdentityDiagnostics({
    ebayItemId: 'identity-runtime-unknown',
    title: 'RARE SSP INVESTMENT MINT Joe Burrow Prizm RC',
    parsed: {
      sport: 'Football',
      player: 'Joe Burrow',
      year: 2020,
      brand: 'Panini',
      setName: 'Prizm',
      rookie: true,
      autograph: false,
      memorabilia: false,
      rawOrGraded: 'raw'
    }
  });

  assert.equal(diagnostics.exactCompEligible, false);
  assert.equal(diagnostics.valuationEligible, false);
  assert.equal(diagnostics.manualReviewRequired, true);
  assert.equal(diagnostics.contextOnly, true);
  assert.equal(diagnostics.unknownFields.includes('normalized.cardNumber'), true);
  assert.equal(diagnostics.normalizationWarnings.includes('missing_card_number'), true);
  assert.equal(diagnostics.normalizationWarnings.includes('seller_marketing_language_ignored'), true);
});

test('malformed listings do not crash and return context-only diagnostics', () => {
  const diagnostics = buildCanonicalIdentityDiagnostics({
    ebayItemId: 'malformed-identity-runtime',
    parsed: null
  });

  assert.equal(diagnostics.canonicalIdentity.identityType, 'unknown');
  assert.equal(diagnostics.canonicalIdentity.canonicalIdentityKey, 'ci:v1:unknown:unknown');
  assert.equal(diagnostics.exactCompEligible, false);
  assert.equal(diagnostics.valuationEligible, false);
  assert.equal(diagnostics.manualReviewRequired, true);
  assert.equal(diagnostics.contextOnly, true);
  assert.ok(Array.isArray(diagnostics.unknownFields));
});

test('canonical identity keys remain deterministic through the legacy adapter', () => {
  const listing = baseListing();

  const first = buildCanonicalIdentityDiagnostics(listing);
  const second = buildCanonicalIdentityDiagnostics(listing);

  assert.equal(first.canonicalIdentity.canonicalIdentityKey, second.canonicalIdentity.canonicalIdentityKey);
  assert.deepEqual(first.canonicalIdentity, second.canonicalIdentity);
});
