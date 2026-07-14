'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const shadowValuationEngine = require('../engines/shadowValuationEngine');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'shadow-valuation', 'valuation-fixtures.json');

function loadFixtures() {
  return JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));
}

function exactMatch(price, soldAt, id = `sale-${price}-${soldAt}`) {
  return {
    classification: 'exact_match',
    valuationEligible: true,
    recordId: id,
    marketplace: 'ebay',
    soldAt: `${soldAt}T00:00:00.000Z`,
    soldPrice: price,
    evidenceType: 'true_sold',
    canonicalIdentityKey: loadFixtures().targetIdentity.canonicalIdentityKey,
    confidence: {
      identityConfidence: 0.96,
      evidenceQualityScore: 90,
      priceConfidence: 0.94,
      soldDateConfidence: 0.94
    }
  };
}

function contextualMatch(price, id = `contextual-${price}`) {
  return {
    classification: 'contextual_match',
    valuationEligible: false,
    recordId: id,
    soldPrice: price,
    soldAt: '2026-07-01T00:00:00.000Z',
    evidenceType: 'true_sold',
    rejectionReasons: ['parallel_mismatch']
  };
}

function staleMatch(price, id = `stale-${price}`) {
  return {
    classification: 'stale_match',
    valuationEligible: false,
    recordId: id,
    soldPrice: price,
    soldAt: '2025-01-01T00:00:00.000Z',
    evidenceType: 'true_sold',
    rejectionReasons: ['stale_sale']
  };
}

function rejectedMatch(price, id = `rejected-${price}`) {
  return {
    classification: 'rejected_match',
    valuationEligible: false,
    recordId: id,
    soldPrice: price,
    soldAt: '2026-07-01T00:00:00.000Z',
    evidenceType: 'true_sold',
    rejectionReasons: ['subject_mismatch']
  };
}

function buildInput(fixture) {
  const library = loadFixtures();
  const exactMatches = (fixture.prices || []).map((price, index) => exactMatch(
    price,
    (fixture.dates || [])[index] || '2026-07-01',
    `${fixture.id}-exact-${index}`
  ));
  const contextualMatches = (fixture.contextualPrices || []).map((price, index) => contextualMatch(price, `${fixture.id}-contextual-${index}`));
  const staleMatches = (fixture.stalePrices || []).map((price, index) => staleMatch(price, `${fixture.id}-stale-${index}`));
  const rejectedMatches = fixture.malformed ? [rejectedMatch(100, `${fixture.id}-malformed`)] : [];

  return {
    asOf: library.asOf,
    canonicalIdentity: library.targetIdentity,
    canonicalSoldComparisonResults: {
      acceptedExactMatches: exactMatches,
      contextualMatches,
      rejectedMatches,
      staleMatches,
      insufficientIdentityMatches: []
    },
    canonicalSoldEvidenceRecords: [
      ...exactMatches,
      ...contextualMatches,
      ...staleMatches,
      ...rejectedMatches,
      {
        id: `${fixture.id}-active-listing`,
        evidenceType: 'active_context',
        price: 999
      }
    ]
  };
}

function fixtureById(id) {
  return loadFixtures().cases.find((fixture) => fixture.id === id);
}

test('exports stable standalone public API', () => {
  assert.equal(typeof shadowValuationEngine.evaluateShadowValuation, 'function');
  assert.equal(typeof shadowValuationEngine.calculateShadowValuation, 'function');
  assert.equal(typeof shadowValuationEngine.summarizeShadowValuation, 'function');
  assert.equal(shadowValuationEngine.SOURCE, 'shadow_valuation_engine');
  assert.equal(shadowValuationEngine.MIN_EXACT_SALES_FOR_VALUATION, 3);
});

test('fixture matrix covers required shadow valuation scenarios', () => {
  const categories = new Set(loadFixtures().cases.map((fixture) => fixture.category));

  for (const category of [
    'abundant recent sales',
    'thin markets',
    'rising markets',
    'cooling markets',
    'stale-only evidence',
    'conflicting evidence',
    'single exact sale',
    'no exact sales',
    'malformed evidence'
  ]) {
    assert.equal(categories.has(category), true, `${category} should be covered`);
  }
});

test('abundant recent exact sales produce deterministic evidence-based range', () => {
  const input = buildInput(fixtureById('abundant-recent-sales'));
  const first = shadowValuationEngine.evaluateShadowValuation(input);
  const second = shadowValuationEngine.evaluateShadowValuation(input);

  assert.deepEqual(second, first);
  assert.equal(first.insufficientEvidence, false);
  assert.ok(first.fairMarketRange.floorValue > 0);
  assert.ok(first.fairMarketRange.floorValue <= first.recommendedMarketValue);
  assert.ok(first.recommendedMarketValue <= first.fairMarketRange.ceilingValue);
  assert.equal(first.evidenceSummary.exactMatchCount, 6);
  assert.equal(first.evidenceSummary.contextualEvidenceUsed, false);
  assert.equal(first.evidenceSummary.rejectedEvidenceUsed, false);
  assert.equal(first.productionImpact, 'none');
  assert.equal(first.decisionImpact, 'none');
  assert.match(first.fairMarketRange.explanation, /median|percentile|trimmed/i);
});

test('engine never guesses when fewer than three exact sold matches exist', () => {
  for (const id of ['thin-market', 'single-exact-sale']) {
    const result = shadowValuationEngine.evaluateShadowValuation(buildInput(fixtureById(id)));

    assert.equal(result.insufficientEvidence, true);
    assert.equal(result.insufficientEvidenceReason, 'fewer_than_three_exact_sold_matches');
    assert.equal(result.fairMarketRange, null);
    assert.equal(result.recommendedMarketValue, null);
    assert.equal(result.valuationConfidence, 0);
  }
});

test('contextual, rejected, stale, active, and malformed evidence cannot create valuation', () => {
  for (const id of ['stale-only-evidence', 'no-exact-sales', 'malformed-evidence']) {
    const fixture = fixtureById(id);
    const result = shadowValuationEngine.evaluateShadowValuation(buildInput(fixture));

    assert.equal(result.insufficientEvidence, true);
    assert.equal(result.insufficientEvidenceReason, fixture.expectedReason);
    assert.equal(result.recommendedMarketValue, null);
    assert.equal(result.valuationDiagnostics.ignoredActiveListings, 1);
    assert.equal(result.evidenceSummary.activeEvidenceUsed, false);
  }
});

test('accepted exact matches are the only valuation input', () => {
  const abundant = buildInput(fixtureById('abundant-recent-sales'));
  const baseline = shadowValuationEngine.evaluateShadowValuation(abundant);
  const polluted = shadowValuationEngine.evaluateShadowValuation({
    ...abundant,
    canonicalSoldComparisonResults: {
      ...abundant.canonicalSoldComparisonResults,
      contextualMatches: [contextualMatch(1000, 'polluted-context')],
      rejectedMatches: [rejectedMatch(1, 'polluted-reject')],
      staleMatches: [staleMatch(999, 'polluted-stale')]
    },
    canonicalSoldEvidenceRecords: [
      ...abundant.canonicalSoldEvidenceRecords,
      { id: 'active-pollution', evidenceType: 'active_context', price: 5000 }
    ]
  });

  assert.equal(polluted.recommendedMarketValue, baseline.recommendedMarketValue);
  assert.deepEqual(polluted.fairMarketRange, baseline.fairMarketRange);
  assert.equal(polluted.evidenceSummary.contextualMatchCount, 1);
  assert.equal(polluted.evidenceSummary.rejectedMatchCount, 1);
  assert.equal(polluted.evidenceSummary.staleMatchCount, 1);
  assert.equal(polluted.evidenceSummary.contextualEvidenceUsed, false);
});

test('rising and cooling fixtures report trend context without changing production impact', () => {
  const rising = shadowValuationEngine.evaluateShadowValuation(buildInput(fixtureById('rising-market')));
  const cooling = shadowValuationEngine.evaluateShadowValuation(buildInput(fixtureById('cooling-market')));

  assert.equal(rising.marketTrendSummary.direction, 'rising');
  assert.equal(cooling.marketTrendSummary.direction, 'cooling');
  assert.match(rising.marketTrendSummary.explanation, /context only/i);
  assert.equal(rising.productionImpact, 'none');
  assert.equal(cooling.decisionImpact, 'none');
});

test('conflicting evidence widens diagnostics and lowers confidence relative to stable sales', () => {
  const stable = shadowValuationEngine.evaluateShadowValuation(buildInput(fixtureById('abundant-recent-sales')));
  const conflicting = shadowValuationEngine.evaluateShadowValuation(buildInput(fixtureById('conflicting-evidence')));

  assert.equal(conflicting.insufficientEvidence, false);
  assert.ok(conflicting.valuationDiagnostics.intermediateCalculations.priceSpreadRatio > stable.valuationDiagnostics.intermediateCalculations.priceSpreadRatio);
  assert.ok(conflicting.valuationConfidence < stable.valuationConfidence);
  assert.ok(
    (conflicting.fairMarketRange.ceilingValue - conflicting.fairMarketRange.floorValue) >
    (stable.fairMarketRange.ceilingValue - stable.fairMarketRange.floorValue)
  );
});

test('malformed or missing canonical identity returns insufficient evidence without crashing', () => {
  const input = buildInput(fixtureById('abundant-recent-sales'));
  const result = shadowValuationEngine.evaluateShadowValuation({
    ...input,
    canonicalIdentity: {}
  });

  assert.equal(result.insufficientEvidence, true);
  assert.equal(result.insufficientEvidenceReason, 'canonical_identity_missing');
  assert.equal(result.fairMarketRange, null);
  assert.equal(result.summary.includes('unavailable'), true);
});

test('output preserves intermediate calculations for future time weighting and market regime work', () => {
  const result = shadowValuationEngine.evaluateShadowValuation(buildInput(fixtureById('abundant-recent-sales')));
  const intermediate = result.valuationDiagnostics.intermediateCalculations;

  assert.deepEqual(intermediate.sortedPrices, [96, 100, 104, 108, 112, 116]);
  assert.equal(typeof intermediate.medianPrice, 'number');
  assert.equal(typeof intermediate.trimmedAverage, 'number');
  assert.equal(typeof intermediate.timeWeightedAverage, 'number');
  assert.equal(typeof intermediate.priceSpreadRatio, 'number');
  assert.equal(typeof result.marketTrendSummary.intermediate.olderAverage, 'number');
});
