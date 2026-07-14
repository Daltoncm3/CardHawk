'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const investmentDecisionEngine = require('../engines/investmentDecisionEngine');
const investmentContract = require('../validation/investmentDecisionContract');
const strategyContract = require('../validation/strategyLaneContract');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'investment-decision', 'phase-7-1a-fixtures.json');
const fixtureLibrary = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));

function exactMatches(count) {
  return Array.from({ length: count }, (_, index) => ({
    classification: 'exact_match',
    valuationEligible: true,
    recordId: `exact-${index + 1}`,
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

  return {
    listingSnapshot: {
      itemId: 'investment-fixture',
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
      },
      overallIdentityConfidence: 96
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
      processingSummary: {
        exactMatchCount
      }
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
          valuationConfidence: 78,
          evidenceSummary: { exactMatchCount }
        },
    marketIntelligence: {
      supplyPressure: {
        supplyPressureLevel: overrides.supplyPressure || 'low'
      },
      marketRegime: {
        primaryRegime: overrides.marketRegime || 'stable'
      },
      liquidity: {
        liquidityLevel: overrides.liquidity || 'high'
      }
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
      exitConfidence: overrides.exitConfidence || 'high',
      investmentThesis: overrides.investmentThesis || ''
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

function buildFixtureInput(fixture) {
  return fixture.malformed ? {} : buildInput(fixture.overrides || {});
}

test('exports standalone Investment Decision public API', () => {
  assert.equal(investmentDecisionEngine.SOURCE, 'investment_decision_engine');
  assert.equal(typeof investmentDecisionEngine.evaluateInvestmentDecision, 'function');
  assert.equal(typeof investmentDecisionEngine.summarizeInvestmentDecision, 'function');
  assert.deepEqual(investmentDecisionEngine.STAGE_NAMES, [
    'eligibilityAndEvidence',
    'downsideAndValuationSafety',
    'financialAttractiveness',
    'exitAndCapitalVelocity',
    'marketAndPortfolioContext'
  ]);
});

test('fixture library covers required Phase 7.1A scenarios', () => {
  const ids = fixtureLibrary.fixtures.map((fixture) => fixture.id);

  for (const required of [
    'failed-deal-gate',
    'strong-quick-flip',
    'strong-medium-hold',
    'strong-long-term',
    'high-roi-weak-evidence',
    'positive-profit-no-shadow-valuation',
    'negotiate-case',
    'monitor-case',
    'limited-bankroll',
    'high-uncertainty',
    'portfolio-concentration',
    'malformed-input'
  ]) {
    assert.ok(ids.includes(required), `${required} fixture missing`);
  }
});

test('all fixtures produce deterministic contract-compliant outputs', () => {
  for (const fixture of fixtureLibrary.fixtures) {
    const input = buildFixtureInput(fixture);
    const first = investmentDecisionEngine.evaluateInvestmentDecision(input);
    const second = investmentDecisionEngine.evaluateInvestmentDecision(input);
    const validation = investmentContract.validateInvestmentDecisionOutput(first);

    assert.deepEqual(second, first, `${fixture.id} must be deterministic`);
    assert.equal(validation.valid, true, `${fixture.id} contract failed: ${validation.reasons.join(', ')}`);
    assert.equal(first.investmentPosture, fixture.expectedPosture, `${fixture.id} posture mismatch`);
    assert.equal(first.productionImpact, 'none');
    assert.equal(first.decisionAuthority, 'non_production_explanation_only_deal_gate_remains_authoritative');
  }
});

test('failed Deal Gate cannot produce BUY or PRIORITY_BUY', () => {
  const result = investmentDecisionEngine.evaluateInvestmentDecision(buildInput({
    dealGate: { passed: false, buyNowAllowed: false, decision: 'REJECT', reasons: ['No sold comps.'] },
    exactMatchCount: 6,
    totalCost: 40,
    maximumBuyPrice: 120,
    expectedNetProfit: 80,
    roi: 2
  }));

  assert.equal(result.investmentPosture, investmentContract.INVESTMENT_POSTURES.IGNORE);
  assert.equal(result.blockers.includes('deal_gate_failed'), true);
  assert.notEqual(result.investmentPosture, investmentContract.INVESTMENT_POSTURES.BUY);
  assert.notEqual(result.investmentPosture, investmentContract.INVESTMENT_POSTURES.PRIORITY_BUY);
});

test('weak evidence cannot be overridden by high ROI or profit', () => {
  const result = investmentDecisionEngine.evaluateInvestmentDecision(buildInput({
    exactMatchCount: 1,
    shadowInsufficientEvidence: true,
    shadowInsufficientEvidenceReason: 'fewer_than_three_exact_sold_matches',
    totalCost: 10,
    maximumBuyPrice: 100,
    expectedNetProfit: 90,
    roi: 9
  }));

  assert.equal(result.investmentPosture, investmentContract.INVESTMENT_POSTURES.MONITOR);
  assert.equal(result.blockers.includes('fewer_than_three_exact_sold_matches'), true);
  assert.equal(result.blockers.includes('fewer_than_three_exact_sold_matches'), true);
});

test('unavailable Shadow Valuation prevents unsupported buying recommendation', () => {
  const result = investmentDecisionEngine.evaluateInvestmentDecision(buildInput({
    exactMatchCount: 0,
    shadowInsufficientEvidence: true,
    shadowInsufficientEvidenceReason: 'no_exact_sold_matches',
    totalCost: 50,
    expectedNetProfit: 50,
    roi: 1
  }));

  assert.equal(result.investmentPosture, investmentContract.INVESTMENT_POSTURES.MONITOR);
  assert.equal(result.maximumBuyPrice.amount, 100);
  assert.equal(result.blockers.includes('no_exact_sold_matches'), true);
});

test('suggested offer is capped at Maximum Buy Price', () => {
  const result = investmentDecisionEngine.evaluateInvestmentDecision(buildInput({
    totalCost: 110,
    maximumBuyPrice: 100,
    suggestedOffer: 120
  }));

  assert.equal(result.suggestedOffer.amount, 100);
  assert.equal(result.maximumBuyPrice.amount, 100);
  assert.equal(result.cautionReasons.includes('suggested_offer_capped_at_maximum_buy_price'), true);
});

test('Capital Score remains explicitly uncalculated in the prototype', () => {
  const result = investmentDecisionEngine.evaluateInvestmentDecision(buildInput());

  assert.equal(result.capitalScoreStatus, 'not_scored');
  assert.equal(result.capitalScore.capitalScoreStatus, 'not_scored');
  assert.equal(result.capitalScore.score, null);
  assert.equal(result.capitalScore.finalWeightsDefined, false);
  assert.ok(result.capitalScore.missingInputsBeforeScoringCanBeValid.includes('validated_capital_score_weights'));
});

test('all strategy lane outputs remain Constitution-compliant context only', () => {
  const result = investmentDecisionEngine.evaluateInvestmentDecision(buildInput({
    preferredStrategyLanes: [
      strategyContract.STRATEGY_LANES.QUICK_FLIP,
      strategyContract.STRATEGY_LANES.MEDIUM_HOLD,
      strategyContract.STRATEGY_LANES.LONG_TERM_INVESTMENT
    ],
    investmentThesis: 'Fixture long-term thesis.'
  }));

  assert.equal(result.strategyFit.productionImpact, 'none');
  assert.equal(result.strategyFit.laneEvaluations.length, 3);
  for (const lane of result.strategyFit.laneEvaluations) {
    const validation = strategyContract.validateStrategyLaneOutput(lane);
    assert.equal(validation.valid, true, `${lane.strategyLane}: ${validation.reasons.join(', ')}`);
    assert.equal(lane.productionImpact, 'none');
    assert.match(lane.explanation, /context only/);
  }
});

test('stage readiness exposes all required stage fields', () => {
  const result = investmentDecisionEngine.evaluateInvestmentDecision(buildInput());

  for (const stageName of investmentDecisionEngine.STAGE_NAMES) {
    const stage = result.stageReadiness[stageName];
    assert.ok(stage, `${stageName} missing`);
    assert.equal(typeof stage.status, 'string');
    assert.equal(typeof stage.readiness, 'string');
    assert.ok(Array.isArray(stage.blockers));
    assert.ok(Array.isArray(stage.cautions));
    assert.ok(Array.isArray(stage.supportingReasons));
    assert.ok(Array.isArray(stage.missingInputs));
    assert.equal(typeof stage.explanation, 'string');
  }
});

test('engine does not mutate inputs or require runtime integration', () => {
  const input = buildInput();
  const before = JSON.parse(JSON.stringify(input));
  const result = investmentDecisionEngine.evaluateInvestmentDecision(input);

  assert.deepEqual(input, before);
  assert.equal(result.productionImpact, 'none');
  assert.equal(result.auditTrail.some((entry) => entry.step === 'capital_score' && entry.status === 'not_scored'), true);
});
