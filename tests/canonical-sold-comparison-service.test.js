'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const canonicalIdentityEngine = require('../engines/canonicalIdentityEngine');
const {
  CLASSIFICATIONS,
  compareSoldRecord,
  evaluateCanonicalSoldComparisons,
  summarizeCanonicalSoldComparison
} = require('../services/canonicalSoldComparisonService');

const IDENTITY_FIXTURE_PATH = path.join(__dirname, 'fixtures', 'canonical-identity', 'identity-fixtures.json');
const COMPARISON_FIXTURE_PATH = path.join(__dirname, 'fixtures', 'canonical-sold-comparison', 'comparison-fixtures.json');

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function getTargetIdentity() {
  const identityFixtures = loadJson(IDENTITY_FIXTURE_PATH);
  const comparisonFixtures = loadJson(COMPARISON_FIXTURE_PATH);
  const fixture = identityFixtures.fixtures.find((entry) => entry.id === comparisonFixtures.targetFixtureId);
  assert.ok(fixture, 'target identity fixture should exist');
  return clone(fixture.identity);
}

function rebuildIdentity(identity) {
  return canonicalIdentityEngine.buildCanonicalIdentity({
    canonicalSoldEvidenceIdentity: identity
  });
}

function identityVariant(targetIdentity, variant) {
  const identity = clone(targetIdentity);
  identity.raw = {
    ...identity.raw,
    title: `${identity.raw?.title || 'Fixture'} ${variant}`
  };

  if (variant === 'parallel') identity.normalized.parallel = 'silver prizm';
  if (variant === 'numbered') {
    identity.normalized.serialNumbered = true;
    identity.normalized.printRun = 99;
  }
  if (variant === 'autograph') identity.normalized.autograph = { state: true, type: 'auto' };
  if (variant === 'relic') identity.normalized.memorabilia = { state: true, type: 'patch' };
  if (variant === 'psa9') identity.normalized.grading.grade = '9';
  if (variant === 'player') identity.normalized.subject.name = 'justin herbert';
  if (variant === 'cardNumber') identity.normalized.cardNumber = '308';
  if (variant === 'year') identity.normalized.year = '2021';
  if (variant === 'incomplete') {
    delete identity.schemaVersion;
    delete identity.canonicalIdentityKey;
    identity.normalized = {};
  }

  if (variant === 'exact' || variant === 'stale' || variant === 'active_context') return identity;
  if (variant === 'malformed') return null;
  return rebuildIdentity(identity);
}

function soldRecord(targetIdentity, fixtureCase, overrides = {}) {
  const variantIdentity = identityVariant(targetIdentity, fixtureCase.variant);
  if (fixtureCase.variant === 'malformed') {
    return {
      id: fixtureCase.id,
      evidenceType: 'true_sold',
      status: 'active_evidence',
      rawTitle: '',
      soldPrice: 50,
      soldAt: '2026-07-01T00:00:00.000Z',
      ...overrides
    };
  }

  return {
    id: fixtureCase.id,
    marketplace: 'ebay',
    marketplaceSaleId: `sale-${fixtureCase.id}`,
    evidenceType: fixtureCase.variant === 'active_context' ? 'active_context' : 'true_sold',
    status: 'active_evidence',
    rawTitle: variantIdentity.raw?.title || `Sold fixture ${fixtureCase.id}`,
    soldPrice: 100,
    totalPaid: 105,
    soldAt: fixtureCase.variant === 'stale'
      ? '2025-01-01T00:00:00.000Z'
      : '2026-07-01T00:00:00.000Z',
    identityConfidence: 0.95,
    evidenceQualityScore: 90,
    priceConfidence: 0.92,
    soldDateConfidence: 0.91,
    canonicalIdentity: variantIdentity,
    ...overrides
  };
}

function getComparisonFixtureCases() {
  return loadJson(COMPARISON_FIXTURE_PATH).cases;
}

test('exports a stable evidence-only public API', () => {
  assert.equal(typeof compareSoldRecord, 'function');
  assert.equal(typeof evaluateCanonicalSoldComparisons, 'function');
  assert.equal(typeof summarizeCanonicalSoldComparison, 'function');
  assert.equal(CLASSIFICATIONS.EXACT_MATCH, 'exact_match');
});

test('fixture matrix covers required comparison scenarios', () => {
  const categories = new Set(getComparisonFixtureCases().map((entry) => entry.category));

  for (const category of [
    'exact matches',
    'base vs parallel',
    'numbered vs unnumbered',
    'autograph vs non-autograph',
    'relic vs non-relic',
    'grading differences',
    'player mismatches',
    'card-number mismatches',
    'year mismatches',
    'stale sales',
    'incomplete identities',
    'malformed sold records',
    'Constitution evidence safeguards'
  ]) {
    assert.equal(categories.has(category), true, `${category} should be covered`);
  }
});

test('each sold record is classified deterministically with explanations and rejection reasons', () => {
  const targetIdentity = getTargetIdentity();
  const comparisonFixtures = loadJson(COMPARISON_FIXTURE_PATH);

  for (const fixtureCase of comparisonFixtures.cases) {
    const record = soldRecord(targetIdentity, fixtureCase);
    const first = compareSoldRecord(targetIdentity, record, {
      asOf: comparisonFixtures.asOf,
      staleDays: comparisonFixtures.staleDays
    });
    const second = compareSoldRecord(targetIdentity, record, {
      asOf: comparisonFixtures.asOf,
      staleDays: comparisonFixtures.staleDays
    });

    assert.deepEqual(second, first, `${fixtureCase.id} should replay deterministically`);
    assert.equal(first.classification, fixtureCase.expectedClassification, `${fixtureCase.id} classification`);
    assert.equal(typeof first.explanation, 'string');
    assert.ok(first.explanation.length > 20, `${fixtureCase.id} should include a human explanation`);
    if (fixtureCase.expectedReason) {
      assert.equal(first.rejectionReasons.includes(fixtureCase.expectedReason), true, `${fixtureCase.id} reason`);
    }
  }
});

test('exact matches require matching canonical identity and are the only valuation-eligible comparisons', () => {
  const targetIdentity = getTargetIdentity();
  const exact = compareSoldRecord(targetIdentity, soldRecord(targetIdentity, { id: 'exact', variant: 'exact' }), {
    asOf: '2026-07-14T00:00:00.000Z'
  });
  const contextual = compareSoldRecord(targetIdentity, soldRecord(targetIdentity, { id: 'parallel', variant: 'parallel' }), {
    asOf: '2026-07-14T00:00:00.000Z'
  });

  assert.equal(exact.classification, 'exact_match');
  assert.equal(exact.valuationEligible, true);
  assert.equal(contextual.classification, 'contextual_match');
  assert.equal(contextual.valuationEligible, false);
  assert.match(contextual.explanation, /research-only|never valuation-eligible/i);
});

test('active context and aggregate-like non true-sold records cannot become exact support', () => {
  const targetIdentity = getTargetIdentity();
  const active = compareSoldRecord(targetIdentity, soldRecord(targetIdentity, { id: 'active', variant: 'active_context' }), {
    asOf: '2026-07-14T00:00:00.000Z'
  });
  const aggregate = compareSoldRecord(targetIdentity, soldRecord(targetIdentity, { id: 'aggregate', variant: 'exact' }, {
    evidenceType: 'aggregate_market_price'
  }), {
    asOf: '2026-07-14T00:00:00.000Z'
  });

  assert.equal(active.classification, 'rejected_match');
  assert.equal(active.rejectionReasons.includes('not_true_sold_evidence'), true);
  assert.equal(active.valuationEligible, false);
  assert.equal(aggregate.classification, 'rejected_match');
  assert.equal(aggregate.rejectionReasons.includes('not_true_sold_evidence'), true);
  assert.equal(aggregate.valuationEligible, false);
});

test('stale exact sales are separated from fresh exact matches', () => {
  const targetIdentity = getTargetIdentity();
  const stale = compareSoldRecord(targetIdentity, soldRecord(targetIdentity, { id: 'stale', variant: 'stale' }), {
    asOf: '2026-07-14T00:00:00.000Z',
    staleDays: 180
  });

  assert.equal(stale.classification, 'stale_match');
  assert.equal(stale.valuationEligible, false);
  assert.equal(stale.rejectionReasons.includes('stale_sale'), true);
  assert.match(stale.explanation, /stale/i);
});

test('batch output exposes deterministic buckets, statistics, diagnostics, and processing summary', () => {
  const targetIdentity = getTargetIdentity();
  const comparisonFixtures = loadJson(COMPARISON_FIXTURE_PATH);
  const records = comparisonFixtures.cases.map((fixtureCase) => soldRecord(targetIdentity, fixtureCase));

  const first = evaluateCanonicalSoldComparisons(targetIdentity, records, {
    asOf: comparisonFixtures.asOf,
    staleDays: comparisonFixtures.staleDays
  });
  const second = evaluateCanonicalSoldComparisons(targetIdentity, records, {
    asOf: comparisonFixtures.asOf,
    staleDays: comparisonFixtures.staleDays
  });

  assert.deepEqual(second, first);
  assert.equal(first.productionImpact, 'none');
  assert.equal(first.decisionImpact, 'none');
  assert.equal(first.evidenceOnly, true);
  assert.equal(first.acceptedExactMatches.length, 1);
  assert.equal(first.contextualMatches.length, 5);
  assert.equal(first.rejectedMatches.length, 4);
  assert.equal(first.staleMatches.length, 1);
  assert.equal(first.insufficientIdentityMatches.length, 2);
  assert.equal(first.rejectionStatistics.reasons.not_true_sold_evidence, 1);
  assert.equal(first.identityMismatchStatistics.subject, 1);
  assert.equal(first.identityMismatchStatistics.cardNumber, 1);
  assert.equal(first.identityMismatchStatistics.year, 1);
  assert.equal(first.comparisonDiagnostics.contextualMatchesValuationEligible, false);
  assert.equal(first.processingSummary.totalRecords, records.length);
  assert.equal(first.processingSummary.processedRecords, records.length);
  assert.match(first.summary, /exact canonical sold match/i);
});

test('insufficient target identity prevents exact support even when records look complete', () => {
  const targetIdentity = canonicalIdentityEngine.buildCanonicalIdentity({});
  const completeTarget = getTargetIdentity();
  const record = soldRecord(completeTarget, { id: 'exact', variant: 'exact' });
  const result = evaluateCanonicalSoldComparisons(targetIdentity, [record], {
    asOf: '2026-07-14T00:00:00.000Z'
  });

  assert.equal(result.acceptedExactMatches.length, 0);
  assert.equal(result.insufficientIdentityMatches.length, 1);
  assert.equal(result.insufficientIdentityMatches[0].rejectionReasons.includes('target_identity_insufficient'), true);
  assert.match(result.summary, /insufficient identity|rejected/i);
});
