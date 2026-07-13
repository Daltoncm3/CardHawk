'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const compEngine = require('../engines/compEngine');

const listing = {
  listingId: 'target-1',
  marketplaceListingId: 'target-1',
  ebayItemId: 'target-1',
  marketplace: 'ebay',
  lane: 'football',
  title: '2020 Panini Prizm Joe Burrow Silver Prizm RC #307 PSA 10',
  price: 100,
  totalCost: 108,
  parsed: {
    year: 2020,
    player: 'Joe Burrow',
    sport: 'football',
    set: 'Panini Prizm',
    cardNumber: '307',
    parallel: 'silver',
    rookie: true,
    grader: 'psa',
    grade: '10'
  }
};

function soldComp(overrides = {}) {
  return {
    listingId: 'sold-1',
    marketplaceListingId: 'sold-1',
    marketplace: 'ebay',
    lane: 'football',
    title: '2020 Panini Prizm Joe Burrow Silver Prizm RC #307 PSA 10',
    price: 220,
    soldAt: '2026-07-01T00:00:00.000Z',
    status: 'completed',
    parsed: listing.parsed,
    ...overrides
  };
}

function activeComp(overrides = {}) {
  return {
    listingId: 'active-1',
    marketplaceListingId: 'active-1',
    marketplace: 'ebay',
    lane: 'football',
    title: '2020 Panini Prizm Joe Burrow Silver Prizm RC #307 PSA 10',
    price: 240,
    status: 'active',
    url: 'https://example.test/active-1',
    parsed: listing.parsed,
    ...overrides
  };
}

test('self listing is removed before comp scoring and cannot be accepted', () => {
  const result = compEngine.evaluateListing(listing, [
    { ...listing, price: 999, status: 'active', url: 'https://example.test/target-1' },
    soldComp()
  ]);

  assert.equal(result.compCount, 1);
  assert.equal(result.selectedComps.length, 1);
  assert.equal(result.selectedComps[0].title, soldComp().title);
  assert.notEqual(result.selectedComps[0].soldPrice, 999);

  assert.equal(result.compCandidateDiagnostics.selfMatchesRemoved, 1);
  assert.equal(result.compCandidateDiagnostics.totalCandidates, 1);
  assert.equal(result.compCandidateDiagnostics.productionImpact, 'none');
});

test('compCandidateDiagnostics reconcile evaluated candidates after self removal', () => {
  const wrongPlayer = soldComp({
    listingId: 'wrong-player',
    marketplaceListingId: 'wrong-player',
    title: '2020 Panini Prizm Justin Herbert Silver Prizm RC #307 PSA 10',
    parsed: {
      ...listing.parsed,
      player: 'Justin Herbert'
    }
  });
  const missingPrice = activeComp({
    listingId: 'missing-price',
    marketplaceListingId: 'missing-price',
    title: '2020 Panini Prizm Joe Burrow Silver Prizm RC #307 PSA 10 No Price',
    price: 0
  });

  const result = compEngine.evaluateListing(listing, [
    listing,
    activeComp(),
    soldComp(),
    wrongPlayer,
    missingPrice
  ]);

  const diagnostics = result.compCandidateDiagnostics;

  assert.equal(diagnostics.totalCandidates, 4);
  assert.equal(diagnostics.selfMatchesRemoved, 1);
  assert.equal(diagnostics.acceptedCandidateCount + diagnostics.rejectedCandidateCount, diagnostics.totalCandidates);
  assert.equal(
    diagnostics.activeCandidateCount + diagnostics.soldCandidateCount + diagnostics.fallbackCandidateCount,
    diagnostics.totalCandidates
  );
  assert.equal(diagnostics.evidenceTypeCounts.active, 2);
  assert.equal(diagnostics.evidenceTypeCounts.true_sold, 2);
  assert.equal(diagnostics.candidateSources.ebay, 4);
  assert.equal(diagnostics.laneBreakdown.football, 4);
  assert.ok(diagnostics.rejectionReasonBreakdown['missing price'] >= 1);
  assert.equal(diagnostics.parserIdentitySummary.subject, 'joe burrow');
  assert.equal(diagnostics.parserIdentitySummary.cardNumber, '307');
});

test('diagnostics preserve existing supported-comp behavior when no self match is present', () => {
  const result = compEngine.evaluateListing(listing, [soldComp()]);

  assert.equal(result.compCount, 1);
  assert.equal(result.trueSoldCompCount, 1);
  assert.equal(result.soldCompCount, 1);
  assert.equal(result.activeCompCount, 0);
  assert.equal(result.marketValue, 220);
  assert.equal(result.selectedComps[0].evidenceType, 'true_sold');

  assert.equal(result.compCandidateDiagnostics.totalCandidates, 1);
  assert.equal(result.compCandidateDiagnostics.acceptedCandidateCount, 1);
  assert.equal(result.compCandidateDiagnostics.rejectedCandidateCount, 0);
  assert.equal(result.compCandidateDiagnostics.candidateUniverseDescription.includes('Diagnostics are evidence-only'), true);
});

