'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const capitalScoreExplanationEngine = require('../engines/capitalScoreExplanationEngine');
const investmentDecisionEngine = require('../engines/investmentDecisionEngine');
const investmentContract = require('../validation/investmentDecisionContract');
const strategyContract = require('../validation/strategyLaneContract');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'investment-decision', 'capital-score-explanation-fixtures.json');
const fixtureLibrary = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));

function exactMatches(count) {
  return Array.from({ length: count }, (_, index) => ({
    classification: 'exact_match',
    valuationEligible: true,
    recordId: `capital-exact-${index + 1}`,
    evidenceType: 'true_sold',
    soldPrice: 100 + index,
    soldAt: `2026-07-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
    confidence: {
      identityConfidence: 0.97,
      evidenceQualityScore: 92
    }
  }));
}

function buildInput(overrides = {}) {
  const exactMatchCount = overrides.exactMatchCount ?? 4;
  const recentSoldCount = overrides.recentSoldCount ?? exactMatchCount;
  const totalCost = overrides.totalCost ?? 70;
  const maximumBuyPrice = overrides.maximumBuyPrice ?? 100;
  const expectedNetProfit = overrides.expectedNetProfit ?? 25;
  const roi = overrides.roi ?? 0.35;
  const shadowInsufficient = overrides.shadowInsufficientEvidence === true;
  const matches = exactMatches(exactMatchCount);
  const input = {
    listingSnapshot: {
      itemId: 'capital-score-fixture',
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
      estimatedValue: totalCost + expectedNetProfit,
      estimatedProfit: expectedNetProfit,
      roi
    },
    productionDecisionExplanation: {
      primaryExplanation: 'Fixture production explanation.'
    },
    canonicalIdentity: {
      canonicalIdentityKey: 'ci:v1:sports:football:2020:panini:prizm:joe-burrow:307:base:non-auto:non-mem:unnumbered:graded:psa-10',
      eligibility: {
        exactCompEligible: true,
        valuationEligible: true,
        manualReviewRequired: false,
        contextOnly: false
      }
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
      insufficientIdentityMatches: [],
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
          recommendedMarketValue: totalCost + expectedNetProfit,
          fairMarketRange: {
            floorValue: maximumBuyPrice,
            expectedValue: totalCost + expectedNetProfit,
            ceilingValue: totalCost + expectedNetProfit + 20
          },
          evidenceSummary: { exactMatchCount }
        },
    marketIntelligence: {
      supplyPressure: { supplyPressureLevel: overrides.supplyPressure || 'low' },
      marketRegime: { primaryRegime: overrides.marketRegime || 'stable' },
      liquidity: { liquidityLevel: overrides.liquidity || 'high' }
    },
    confidenceBreakdown: {
      soldEvidenceSupport: { rawValue: exactMatchCount }
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
      currentConcentrationPercentage: overrides.currentConcentrationPercentage ?? 0,
      reserveCapitalPercentage: overrides.reserveCapitalPercentage
    },
    strategyProfile: {
      preferredStrategyLanes: overrides.preferredStrategyLanes || [strategyContract.STRATEGY_LANES.QUICK_FLIP],
      reserveCapitalPercentage: overrides.reserveCapitalPercentage
    },
    competingOpportunities: overrides.competingOpportunities || []
  };
  const investmentDecision = investmentDecisionEngine.evaluateInvestmentDecision(input);

  return {
    ...input,
    investmentDecision
  };
}

function buildFixtureInput(fixture) {
  if (fixture.malformed) return {};
  return buildInput(fixture.overrides || {});
}

test('exports Capital Score Explanation public API', () => {
  assert.equal(capitalScoreExplanationEngine.SOURCE, 'capital_score_explanation_engine');
  assert.equal(capitalScoreExplanationEngine.CAPITAL_SCORE_STATUS, 'not_scored');
  assert.equal(typeof capitalScoreExplanationEngine.explainCapitalScore, 'function');
  assert.equal(typeof capitalScoreExplanationEngine.buildReadinessSummary, 'function');
  assert.equal(typeof capitalScoreExplanationEngine.buildFutureCapitalScoreInputs, 'function');
  assert.deepEqual(capitalScoreExplanationEngine.READINESS_CATEGORIES, [
    'Evidence Readiness',
    'Downside Protection Readiness',
    'Financial Readiness',
    'Exit Confidence Readiness',
    'Portfolio Readiness',
    'Opportunity Cost Readiness',
    'Strategy Readiness',
    'Bankroll Readiness'
  ]);
});

test('fixture library covers required Capital Score explanation scenarios', () => {
  const ids = fixtureLibrary.fixtures.map((fixture) => fixture.id);

  for (const required of [
    'fully-ready-except-weights',
    'weak-evidence',
    'failed-deal-gate',
    'insufficient-shadow-valuation',
    'limited-bankroll',
    'no-competing-opportunities',
    'malformed-inputs'
  ]) {
    assert.ok(ids.includes(required), `${required} fixture missing`);
  }
});

test('all fixtures produce deterministic explanations with no score', () => {
  for (const fixture of fixtureLibrary.fixtures) {
    const input = buildFixtureInput(fixture);
    const first = capitalScoreExplanationEngine.explainCapitalScore(input);
    const second = capitalScoreExplanationEngine.explainCapitalScore(input);
    const explanation = first.capitalScoreExplanation;

    assert.deepEqual(second, first, `${fixture.id} must be deterministic`);
    assert.equal(explanation.capitalScoreStatus, 'not_scored');
    assert.equal(explanation.score, null);
    assert.equal(explanation.finalWeightsDefined, false);
    assert.equal(explanation.productionImpact, 'none');
    assert.match(explanation.explanation, /No score is fabricated or estimated/);
  }
});

test('readiness summary includes every required category and shape', () => {
  const result = capitalScoreExplanationEngine.explainCapitalScore(buildInput());
  const summary = result.capitalScoreExplanation.readinessSummary;

  for (const category of capitalScoreExplanationEngine.READINESS_CATEGORIES) {
    assert.ok(summary[category], `${category} missing`);
    assert.equal(typeof summary[category].status, 'string');
    assert.equal(typeof summary[category].readiness, 'string');
    assert.ok(Array.isArray(summary[category].supportingFactors));
    assert.ok(Array.isArray(summary[category].missingFactors));
    assert.ok(Array.isArray(summary[category].blockers));
    assert.equal(typeof summary[category].explanation, 'string');
  }
});

test('future Capital Score inputs cover every approved contract input', () => {
  const result = capitalScoreExplanationEngine.explainCapitalScore(buildInput({
    competingOpportunities: [{ id: 'alt-1' }],
    reserveCapitalPercentage: 25
  }));
  const names = result.futureCapitalScoreInputs.map((entry) => entry.input);

  assert.deepEqual(names, investmentContract.CAPITAL_SCORE_INPUTS);
  for (const entry of result.futureCapitalScoreInputs) {
    assert.ok(['available', 'unavailable', 'insufficient', 'pending future implementation'].includes(entry.status));
    assert.equal(typeof entry.explanation, 'string');
  }
});

test('ready fixture remains unscored because final weights are missing', () => {
  const fixture = fixtureLibrary.fixtures.find((entry) => entry.id === 'fully-ready-except-weights');
  const result = capitalScoreExplanationEngine.explainCapitalScore(buildFixtureInput(fixture));

  assert.deepEqual(result.scoreWithheldReason.blockedCategories, []);
  assert.equal(result.capitalScoreExplanation.score, null);
  assert.equal(result.capitalScoreExplanation.finalWeightsDefined, false);
  assert.match(result.capitalScoreExplanation.explanation, /final scoring weights have not been validated/);
});

test('weak evidence and failed Deal Gate block Evidence Readiness', () => {
  for (const id of ['weak-evidence', 'failed-deal-gate']) {
    const fixture = fixtureLibrary.fixtures.find((entry) => entry.id === id);
    const result = capitalScoreExplanationEngine.explainCapitalScore(buildFixtureInput(fixture));
    const evidence = result.capitalScoreExplanation.readinessSummary['Evidence Readiness'];

    assert.equal(evidence.readiness, 'blocked');
    assert.equal(result.scoreWithheldReason.blockedCategories.includes('Evidence Readiness'), true);
  }
});

test('limited bankroll blocks Bankroll Readiness', () => {
  const fixture = fixtureLibrary.fixtures.find((entry) => entry.id === 'limited-bankroll');
  const result = capitalScoreExplanationEngine.explainCapitalScore(buildFixtureInput(fixture));
  const bankroll = result.capitalScoreExplanation.readinessSummary['Bankroll Readiness'];

  assert.equal(bankroll.readiness, 'blocked');
  assert.equal(bankroll.blockers.includes('capital_required_exceeds_bankroll'), true);
});

test('no competing opportunities makes Opportunity Cost Readiness partial, not fabricated', () => {
  const fixture = fixtureLibrary.fixtures.find((entry) => entry.id === 'no-competing-opportunities');
  const result = capitalScoreExplanationEngine.explainCapitalScore(buildFixtureInput(fixture));
  const opportunity = result.capitalScoreExplanation.readinessSummary['Opportunity Cost Readiness'];
  const inputStatus = result.futureCapitalScoreInputs.find((entry) => entry.input === 'opportunity_cost');

  assert.equal(opportunity.readiness, 'partial');
  assert.equal(opportunity.missingFactors.includes('competingOpportunities'), true);
  assert.equal(inputStatus.status, 'pending future implementation');
});

test('malformed input remains safe and unscored', () => {
  const result = capitalScoreExplanationEngine.explainCapitalScore({});

  assert.equal(result.capitalScoreExplanation.score, null);
  assert.equal(result.capitalScoreExplanation.readinessSummary['Evidence Readiness'].readiness, 'blocked');
  assert.equal(result.capitalScoreExplanation.productionImpact, 'none');
});

test('engine does not mutate inputs or touch production behavior', () => {
  const input = buildInput();
  const before = structuredClone(input);
  const result = capitalScoreExplanationEngine.explainCapitalScore(input);

  assert.deepEqual(input, before);
  assert.equal(result.capitalScoreExplanation.productionImpact, 'none');
  assert.equal(result.capitalScoreExplanation.decisionImpact, 'none');
});
