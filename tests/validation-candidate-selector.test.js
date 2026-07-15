'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const investmentDecisionEngine = require('../engines/investmentDecisionEngine');
const selector = require('../validation/validationCandidateSelector');
const strategyContract = require('../validation/strategyLaneContract');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'investment-decision', 'phase-7-1d-validation-candidates.json');
const fixtureLibrary = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));

function exactMatches(count) {
  return Array.from({ length: count }, (_, index) => ({
    classification: 'exact_match',
    valuationEligible: true,
    recordId: `candidate-exact-${index + 1}`,
    evidenceType: 'true_sold',
    soldPrice: 100 + index,
    soldAt: `2026-07-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
    confidence: {
      identityConfidence: 0.97,
      evidenceQualityScore: 92
    }
  }));
}

function buildInvestmentInput(overrides = {}) {
  const exactMatchCount = overrides.exactMatchCount ?? 4;
  const recentSoldCount = overrides.recentSoldCount ?? exactMatchCount;
  const totalCost = overrides.totalCost ?? 70;
  const maximumBuyPrice = overrides.maximumBuyPrice ?? 100;
  const expectedNetProfit = overrides.expectedNetProfit ?? 25;
  const roi = overrides.roi ?? 0.35;
  const shadowInsufficient = overrides.shadowInsufficientEvidence === true;
  const matches = exactMatches(exactMatchCount);
  const identityEligible = overrides.identityConflict === true ? false : true;
  const shadowMarketValue = overrides.shadowRecommendedMarketValue ?? totalCost + expectedNetProfit;

  return {
    listingSnapshot: {
      itemId: overrides.itemId || 'validation-candidate-fixture',
      title: '2020 Panini Prizm Joe Burrow RC #307 PSA 10',
      price: totalCost,
      totalCost
    },
    dealGate: overrides.dealGate || {
      passed: true,
      buyNowAllowed: true,
      decision: 'BUY_NOW',
      reasons: [],
      positives: ['Fixture Deal Gate pass.']
    },
    productionValuation: {
      estimatedValue: overrides.productionEstimatedValue ?? totalCost + expectedNetProfit,
      estimatedProfit: expectedNetProfit,
      roi
    },
    productionDecisionExplanation: {
      primaryExplanation: 'Fixture production explanation.'
    },
    canonicalIdentity: {
      canonicalIdentityKey: 'ci:v1:sports:football:2020:panini:prizm:joe-burrow:307:base:non-auto:non-mem:unnumbered:graded:psa-10',
      eligibility: {
        exactCompEligible: identityEligible,
        valuationEligible: identityEligible,
        manualReviewRequired: !identityEligible,
        contextOnly: !identityEligible
      },
      overallIdentityConfidence: identityEligible ? 96 : 52,
      unknownFields: identityEligible ? [] : ['parallel', 'variation', 'cardNumber'],
      normalizationWarnings: identityEligible ? [] : ['identity_requires_manual_review']
    },
    canonicalSoldEvidence: {
      trueSoldCount: exactMatchCount,
      recentSoldCount,
      records: matches
    },
    shadowSoldComparison: {
      acceptedExactMatches: matches,
      contextualMatches: [],
      rejectedMatches: [],
      staleMatches: [],
      insufficientIdentityMatches: identityEligible ? [] : [{ recordId: 'identity-conflict-record' }],
      processingSummary: { exactMatchCount }
    },
    shadowValuation: shadowInsufficient
      ? {
          insufficientEvidence: true,
          insufficientEvidenceReason: overrides.shadowInsufficientEvidenceReason || 'insufficient_exact_sold_evidence',
          recommendedMarketValue: null,
          fairMarketRange: null,
          evidenceSummary: { exactMatchCount }
        }
      : {
          insufficientEvidence: false,
          insufficientEvidenceReason: '',
          recommendedMarketValue: shadowMarketValue,
          fairMarketRange: {
            floorValue: maximumBuyPrice,
            expectedValue: shadowMarketValue,
            ceilingValue: shadowMarketValue + 20
          },
          valuationConfidence: 78,
          evidenceSummary: { exactMatchCount }
        },
    marketIntelligence: {
      supplyPressure: { supplyPressureLevel: overrides.supplyPressure || 'low' },
      marketRegime: { primaryRegime: overrides.marketRegime || 'stable' },
      liquidity: { liquidityLevel: overrides.liquidity || 'high' }
    },
    confidenceBreakdown: {
      soldEvidenceSupport: { rawValue: exactMatchCount },
      valuationConfidence: { rawValue: 78 }
    },
    financialContext: {
      totalCost,
      maximumBuyPrice,
      suggestedOffer: overrides.suggestedOffer ?? Math.round(maximumBuyPrice * 0.9),
      expectedNetProfit,
      roi,
      liquidity: overrides.liquidity || 'high',
      expectedHoldDays: overrides.expectedHoldDays === undefined ? 30 : overrides.expectedHoldDays,
      exitConfidence: overrides.exitConfidence || 'high'
    },
    portfolioContext: {
      availableCapital: overrides.availableCapital ?? 5000,
      maximumCapitalAllocationPerPosition: overrides.maximumCapitalAllocationPerPosition ?? 1000,
      currentConcentrationPercentage: overrides.currentConcentrationPercentage ?? 0
    },
    strategyProfile: {
      preferredStrategyLanes: overrides.preferredStrategyLanes || [strategyContract.STRATEGY_LANES.QUICK_FLIP]
    },
    competingOpportunities: overrides.competingOpportunities || []
  };
}

function buildSnapshotFromFixture(fixture) {
  if (fixture.malformed) {
    return {
      recordId: fixture.id,
      investmentDecisionInput: {},
      productionOutputs: {},
      shadowOutputs: {}
    };
  }

  const input = buildInvestmentInput({
    ...(fixture.overrides || {}),
    itemId: fixture.id
  });
  return {
    recordId: fixture.id,
    investmentDecisionInput: input,
    productionOutputs: {
      dealGate: input.dealGate,
      productionValuation: input.productionValuation
    },
    shadowOutputs: {
      shadowSoldComparison: input.shadowSoldComparison,
      shadowValuation: input.shadowValuation
    }
  };
}

test('exports Validation Candidate Selector public API and category contract', () => {
  assert.equal(selector.SOURCE, 'validation_candidate_selector');
  assert.equal(typeof selector.evaluateValidationCandidate, 'function');
  assert.equal(typeof selector.selectValidationCandidates, 'function');

  for (const category of [
    'production_vs_shadow_disagreement',
    'high_uncertainty',
    'weak_evidence',
    'strong_evidence_rejected',
    'shadow_without_production_support',
    'production_without_shadow_support',
    'identity_conflict',
    'valuation_conflict',
    'edge_case',
    'learning_opportunity'
  ]) {
    assert.ok(selector.CANDIDATE_CATEGORIES.includes(category), `${category} missing`);
  }
});

test('fixture library covers required validation candidate scenarios', () => {
  const ids = fixtureLibrary.fixtures.map((fixture) => fixture.id);

  for (const id of [
    'obvious-agreement',
    'strong-disagreement',
    'weak-evidence',
    'missing-sold-evidence',
    'identity-conflict',
    'valuation-conflict',
    'malformed-input'
  ]) {
    assert.ok(ids.includes(id), `${id} fixture missing`);
  }
});

test('each fixture produces deterministic category and explanation output', () => {
  for (const fixture of fixtureLibrary.fixtures) {
    const snapshot = buildSnapshotFromFixture(fixture);
    const first = selector.evaluateValidationCandidate(snapshot);
    const second = selector.evaluateValidationCandidate(snapshot);

    assert.deepEqual(second, first, `${fixture.id} must be deterministic`);
    assert.equal(first.candidateCategory, fixture.expectedCategory, `${fixture.id} category mismatch`);
    assert.equal(first.productionImpact, 'none');
    assert.equal(typeof first.recommendedReviewReason, 'string');
    assert.ok(first.recommendedReviewReason.includes(String(first.learningPriority)));
    assert.ok(Array.isArray(first.suggestedValidationFocus));
    assert.ok(first.suggestedValidationFocus.length >= 1);
  }
});

test('candidate output exposes required learning, evidence, disagreement, and uncertainty shape', () => {
  const candidate = selector.evaluateValidationCandidate(buildSnapshotFromFixture(
    fixtureLibrary.fixtures.find((fixture) => fixture.id === 'valuation-conflict')
  ));

  assert.equal(candidate.schemaVersion, selector.SCHEMA_VERSION);
  assert.equal(candidate.source, selector.SOURCE);
  assert.ok(candidate.candidateId);
  assert.equal(typeof candidate.learningPriority, 'number');
  assert.ok(['urgent', 'high', 'medium', 'low'].includes(candidate.reviewPriority));
  assert.equal(candidate.evidenceSummary.activeListingsTreatedAsSold, false);
  assert.equal(typeof candidate.disagreementSummary.productionDecision, 'string');
  assert.equal(typeof candidate.disagreementSummary.investmentPosture, 'string');
  assert.equal(typeof candidate.uncertaintySummary.uncertaintyLevel, 'string');
});

test('ranking is deterministic and prioritizes learning value over investment value', () => {
  const snapshots = fixtureLibrary.fixtures.map(buildSnapshotFromFixture);
  const first = selector.selectValidationCandidates(snapshots);
  const second = selector.selectValidationCandidates(snapshots);
  const ids = first.map((candidate) => candidate.listingId);

  assert.deepEqual(second, first);
  assert.equal(ids[0], 'missing-sold-evidence');
  assert.ok(first[0].learningPriority >= first[1].learningPriority);
  assert.equal(first[first.length - 1].listingId, 'obvious-agreement');
});

test('limit returns top-ranked validation candidates only', () => {
  const snapshots = fixtureLibrary.fixtures.map(buildSnapshotFromFixture);
  const limited = selector.selectValidationCandidates(snapshots, { limit: 3 });

  assert.equal(limited.length, 3);
  assert.ok(limited.every((candidate, index) => index === 0 || candidate.learningPriority <= limited[index - 1].learningPriority));
});

test('selector does not mutate snapshots or Investment Decision output', () => {
  const snapshot = buildSnapshotFromFixture(fixtureLibrary.fixtures[1]);
  const before = structuredClone(snapshot);
  const expectedInvestmentDecision = investmentDecisionEngine.evaluateInvestmentDecision(snapshot.investmentDecisionInput);
  const candidate = selector.evaluateValidationCandidate(snapshot);

  assert.deepEqual(snapshot, before);
  assert.equal(candidate.disagreementSummary.investmentPosture, expectedInvestmentDecision.investmentPosture);
  assert.equal(candidate.productionImpact, 'none');
});

test('malformed inputs remain safe edge cases without production impact', () => {
  const fixture = fixtureLibrary.fixtures.find((entry) => entry.id === 'malformed-input');
  const candidate = selector.evaluateValidationCandidate(buildSnapshotFromFixture(fixture));

  assert.equal(candidate.candidateCategory, 'edge_case');
  assert.equal(candidate.productionImpact, 'none');
  assert.ok(candidate.candidateCategories.includes('high_uncertainty'));
});
