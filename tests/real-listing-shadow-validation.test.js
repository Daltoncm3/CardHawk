'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  buildListingValidationReport,
  extractListings,
  runRealListingShadowValidation
} = require('../validation/runRealListingShadowValidation');
const {
  createEmptySoldEvidenceStore
} = require('../utils/soldEvidenceStore');

const IDENTITY_FIXTURE_PATH = path.join(__dirname, 'fixtures', 'canonical-identity', 'identity-fixtures.json');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cardhawk-real-shadow-validation-'));
}

function targetIdentity() {
  const library = JSON.parse(fs.readFileSync(IDENTITY_FIXTURE_PATH, 'utf8'));
  return clone(library.fixtures.find((entry) => entry.id === 'sports-psa10-rookie-base').identity);
}

function deterministicClock() {
  return () => '2026-07-14T00:00:00.000Z';
}

function buildListing(overrides = {}) {
  const identity = overrides.canonicalIdentity || targetIdentity();
  return {
    ebayItemId: 'real-shadow-joe-burrow',
    title: '2020 Panini Prizm Joe Burrow RC #307 PSA 10',
    url: 'https://example.test/item/real-shadow-joe-burrow',
    marketplace: 'ebay',
    price: 90,
    shipping: 5,
    totalCost: 95,
    estimatedValue: 110,
    estimatedProfit: 7,
    roi: 0.0737,
    marketConfidence: 72,
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
    marketData: {
      marketValue: 110,
      confidence: 74
    },
    dealGate: {
      passed: true,
      buyNowAllowed: true,
      decision: 'BUY_NOW',
      reasons: [],
      positives: ['Fixture production pass.']
    },
    display: {
      authoritativeDecision: 'BUY_NOW',
      primaryDecisionLabel: 'BUY_NOW'
    },
    canonicalIdentity: identity,
    ...overrides
  };
}

function exactSoldRecord(identity, price, soldAt, id) {
  return {
    id,
    marketplace: 'ebay',
    marketplaceSaleId: id,
    evidenceType: 'true_sold',
    status: 'active_evidence',
    rawTitle: identity.raw.title,
    soldPrice: price,
    totalPaid: price,
    soldAt,
    identityConfidence: 0.98,
    evidenceQualityScore: 94,
    priceConfidence: 0.96,
    soldDateConfidence: 0.96,
    canonicalIdentity: identity,
    source: {
      adapter: 'real_shadow_validation_fixture',
      retrievalMethod: 'offline_fixture',
      sourceReliability: 'fixture',
      acquiredAt: '2026-07-10T00:00:00.000Z'
    }
  };
}

function listingWithEvidence(overrides = {}) {
  const identity = targetIdentity();
  return buildListing({
    canonicalIdentity: identity,
    canonicalSoldEvidence: {
      records: [
        exactSoldRecord(identity, 100, '2026-06-01T00:00:00.000Z', 'sale-100'),
        exactSoldRecord(identity, 110, '2026-06-15T00:00:00.000Z', 'sale-110'),
        exactSoldRecord(identity, 120, '2026-07-01T00:00:00.000Z', 'sale-120')
      ]
    },
    ...overrides
  });
}

test('real listing shadow validation produces a complete per-listing report with sufficient evidence', () => {
  const listing = listingWithEvidence();
  const report = buildListingValidationReport(listing, {
    store: createEmptySoldEvidenceStore(),
    generatedAt: '2026-07-14T00:00:00.000Z',
    now: '2026-07-14T00:00:00.000Z'
  });

  assert.equal(report.schemaVersion, '1.0.0');
  assert.equal(report.source, 'real_listing_shadow_validation');
  assert.equal(report.productionImpact, 'none');
  assert.equal(report.decisionImpact, 'none');
  assert.equal(report.listingIdentity.canonicalIdentityKey, listing.canonicalIdentity.canonicalIdentityKey);
  assert.deepEqual(report.productionOutputs, listing);
  assert.equal(report.productionValuation.estimatedValue, 110);
  assert.equal(report.dealGateDecision.passed, true);
  assert.equal(report.shadowSoldComparisonSummary.acceptedExactMatchCount, 3);
  assert.equal(report.shadowValuation.insufficientEvidence, false);
  assert.equal(report.shadowValuation.valuationPerformed, true);
  assert.ok(report.shadowValuation.recommendedMarketValue > 0);
  assert.equal(report.canonicalIdentitySummary.valuationEligible, true);
  assert.equal(report.daltonReview.judgment, 'unreviewed');
  assert.equal(report.missingEvidenceSummary.hasMissingEvidence, false);
  assert.equal(report.recommendedFollowUpAction, 'ready_for_dalton_review');
});

test('real listing shadow validation handles insufficient evidence without guessing a shadow value', () => {
  const listing = buildListing({
    ebayItemId: 'real-shadow-no-evidence',
    dealGate: {
      passed: false,
      buyNowAllowed: false,
      decision: 'REJECT',
      reasons: ['No sold evidence.'],
      positives: []
    },
    display: {
      authoritativeDecision: 'REJECTED',
      primaryDecisionLabel: 'Rejected by Deal Gate'
    }
  });
  const report = buildListingValidationReport(listing, {
    store: createEmptySoldEvidenceStore(),
    generatedAt: '2026-07-14T00:00:00.000Z',
    now: '2026-07-14T00:00:00.000Z'
  });

  assert.equal(report.shadowSoldComparisonSummary.acceptedExactMatchCount, 0);
  assert.equal(report.shadowValuation.insufficientEvidence, true);
  assert.equal(report.shadowValuation.recommendedMarketValue, null);
  assert.equal(report.missingEvidenceSummary.reasons.includes('no_canonical_sold_evidence_records'), true);
  assert.equal(report.agreementSummary.overallAgreement, 'aligned');
  assert.equal(report.recommendedFollowUpAction, 'import_verified_sold_evidence');
});

test('real listing shadow validation aggregate metrics are deterministic', () => {
  const input = {
    listings: [
      listingWithEvidence(),
      buildListing({
        ebayItemId: 'real-shadow-no-evidence',
        canonicalSoldEvidence: { records: [] },
        dealGate: {
          passed: false,
          buyNowAllowed: false,
          decision: 'REJECT',
          reasons: ['No sold evidence.'],
          positives: []
        }
      })
    ]
  };
  const options = {
    input,
    store: createEmptySoldEvidenceStore(),
    now: deterministicClock()
  };
  const first = runRealListingShadowValidation(options);
  const second = runRealListingShadowValidation(options);

  assert.deepEqual(second, first);
  assert.equal(first.aggregateMetrics.totalListings, 2);
  assert.equal(first.aggregateMetrics.listingsWithSufficientEvidence, 1);
  assert.equal(first.aggregateMetrics.listingsWithInsufficientEvidence, 1);
  assert.equal(first.aggregateMetrics.productionShadowAgreementRate, 100);
  assert.equal(first.aggregateMetrics.manualReviewRequiredCount, 1);
  assert.equal(first.aggregateMetrics.evidenceGaps.no_canonical_sold_evidence_records, 1);
});

test('real listing shadow validation reads batch files and writes offline reports only', () => {
  const directory = makeTempDir();
  const inputPath = path.join(directory, 'real-listings.json');
  const outPath = path.join(directory, 'report.json');
  const input = { snapshots: [listingWithEvidence()] };
  fs.writeFileSync(inputPath, JSON.stringify(input, null, 2));

  const report = runRealListingShadowValidation({
    inputPath,
    outPath,
    store: createEmptySoldEvidenceStore(),
    now: deterministicClock()
  });
  const written = JSON.parse(fs.readFileSync(outPath, 'utf8'));

  assert.equal(report.aggregateMetrics.totalListings, 1);
  assert.deepEqual(written, report);
});

test('real listing shadow validation supports documented batch wrapper shapes', () => {
  const listing = buildListing();

  assert.deepEqual(extractListings([listing]), [listing]);
  assert.deepEqual(extractListings({ listings: [listing] }), [listing]);
  assert.deepEqual(extractListings({ records: [listing] }), [listing]);
  assert.deepEqual(extractListings({ snapshots: [listing] }), [listing]);
  assert.deepEqual(extractListings({ items: [listing] }), [listing]);
  assert.deepEqual(extractListings({ noListings: [listing] }), []);
});
