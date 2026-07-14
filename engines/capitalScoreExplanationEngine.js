'use strict';

const investmentContract = require('../validation/investmentDecisionContract');

const SOURCE = 'capital_score_explanation_engine';
const VERSION = 'capital-score-explanation-engine-v0.1';
const CAPITAL_SCORE_STATUS = 'not_scored';

const READINESS_CATEGORIES = Object.freeze([
  'Evidence Readiness',
  'Downside Protection Readiness',
  'Financial Readiness',
  'Exit Confidence Readiness',
  'Portfolio Readiness',
  'Opportunity Cost Readiness',
  'Strategy Readiness',
  'Bankroll Readiness'
]);

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function getMoney(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  if (typeof value === 'object') {
    const amount = Number(value.amount ?? value.value ?? value.price ?? value.maximum ?? value.offer);
    return Number.isFinite(amount) ? amount : fallback;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function unique(values = []) {
  return [...new Set(asArray(values).filter(Boolean))];
}

function getReadinessCategory(status, data = {}) {
  const blockers = unique(data.blockers);
  const missingFactors = unique(data.missingFactors);
  const supportingFactors = unique(data.supportingFactors);
  const readiness = blockers.length
    ? 'blocked'
    : missingFactors.length
      ? 'partial'
      : status;

  return {
    status,
    readiness,
    supportingFactors,
    missingFactors,
    blockers,
    explanation: data.explanation || (
      blockers.length
        ? 'Capital Score readiness is blocked in this category.'
        : missingFactors.length
          ? 'Capital Score readiness is partial in this category.'
          : 'Capital Score readiness is available in this category.'
    )
  };
}

function getExactMatchCount(input = {}) {
  const comparison = asObject(input.shadowSoldComparison);
  const shadow = asObject(input.shadowValuation);
  const canonical = asObject(input.canonicalSoldEvidence);
  return Math.max(
    asArray(comparison.acceptedExactMatches).length,
    toNumber(comparison.processingSummary?.exactMatchCount, 0),
    toNumber(shadow.evidenceSummary?.exactMatchCount, 0),
    toNumber(canonical.trueSoldCount, 0)
  );
}

function explainEvidenceReadiness(input = {}) {
  const dealGate = asObject(input.dealGate);
  const identity = asObject(input.canonicalIdentity);
  const shadow = asObject(input.shadowValuation);
  const exactMatchCount = getExactMatchCount(input);
  const supportingFactors = [];
  const missingFactors = [];
  const blockers = [];

  if (dealGate.passed === true) supportingFactors.push('Deal Gate passed.');
  else blockers.push('deal_gate_not_passed');

  if (identity.canonicalIdentityKey && identity.eligibility?.exactCompEligible === true) {
    supportingFactors.push('Canonical identity is exact-comp eligible.');
  } else {
    blockers.push('canonical_identity_not_exact_comp_ready');
  }

  if (exactMatchCount >= 3) supportingFactors.push(`${exactMatchCount} exact sold matches are available.`);
  else blockers.push('insufficient_exact_sold_matches');

  if (shadow.insufficientEvidence === true || shadow.recommendedMarketValue === null) {
    blockers.push(shadow.insufficientEvidenceReason || 'shadow_valuation_not_available');
  } else {
    supportingFactors.push('Shadow Valuation is available.');
  }

  if (!input.canonicalSoldEvidence) missingFactors.push('canonicalSoldEvidence');

  return getReadinessCategory(blockers.length ? 'blocked' : 'ready', {
    supportingFactors,
    missingFactors,
    blockers,
    explanation: blockers.length
      ? 'Capital Score is withheld because evidence or Deal Gate readiness is not sufficient.'
      : 'Evidence readiness is sufficient for future Capital Score consideration, pending validated weights.'
  });
}

function explainDownsideProtectionReadiness(input = {}) {
  const investmentDecision = asObject(input.investmentDecision);
  const shadow = asObject(input.shadowValuation);
  const financial = asObject(input.financialContext);
  const range = asObject(shadow.fairMarketRange);
  const maximumBuyPrice = getMoney(investmentDecision.maximumBuyPrice ?? financial.maximumBuyPrice, null);
  const floorValue = getMoney(range.floorValue, null);
  const supportingFactors = [];
  const missingFactors = [];
  const blockers = [];

  if (maximumBuyPrice !== null) supportingFactors.push('Maximum Buy Price context is available.');
  else missingFactors.push('maximumBuyPrice');

  if (floorValue !== null) supportingFactors.push('Conservative floor value is available.');
  else missingFactors.push('shadowValuation.fairMarketRange.floorValue');

  if (shadow.insufficientEvidence === true) blockers.push('shadow_valuation_insufficient');

  return getReadinessCategory(blockers.length ? 'blocked' : missingFactors.length ? 'partial' : 'ready', {
    supportingFactors,
    missingFactors,
    blockers,
    explanation: 'Downside protection readiness explains whether future Capital Score can trust floor, margin, and Maximum Buy Price context.'
  });
}

function explainFinancialReadiness(input = {}) {
  const production = asObject(input.productionValuation);
  const financial = asObject(input.financialContext);
  const investmentDecision = asObject(input.investmentDecision);
  const expectedProfit = getMoney(financial.expectedNetProfit ?? production.estimatedProfit ?? investmentDecision.expectedNetProfitRange?.expected, null);
  const roi = toNumber(financial.roi ?? production.roi, NaN);
  const supportingFactors = [];
  const missingFactors = [];
  const blockers = [];

  if (expectedProfit !== null) supportingFactors.push('Expected net profit context is available.');
  else missingFactors.push('expectedNetProfit');

  if (Number.isFinite(roi)) supportingFactors.push('ROI context is available.');
  else missingFactors.push('roi');

  if (expectedProfit !== null && expectedProfit <= 0) blockers.push('expected_net_profit_not_positive');
  if (Number.isFinite(roi) && roi <= 0) blockers.push('roi_not_positive');

  return getReadinessCategory(blockers.length ? 'blocked' : missingFactors.length ? 'partial' : 'ready', {
    supportingFactors,
    missingFactors,
    blockers,
    explanation: 'Financial readiness identifies whether future Capital Score has net-profit and ROI context without treating them as sufficient by themselves.'
  });
}

function explainExitConfidenceReadiness(input = {}) {
  const financial = asObject(input.financialContext);
  const market = asObject(input.marketIntelligence);
  const liquidity = financial.liquidity || market.liquidity?.liquidityLevel || '';
  const exitConfidence = financial.exitConfidence || market.exitConfidence?.status || '';
  const holdDays = financial.expectedHoldDays ?? financial.expectedHoldTimeDays;
  const supportingFactors = [];
  const missingFactors = [];
  const blockers = [];

  if (liquidity) supportingFactors.push(`Liquidity context is available (${liquidity}).`);
  else missingFactors.push('liquidity');

  if (exitConfidence) supportingFactors.push(`Exit confidence context is available (${exitConfidence}).`);
  else missingFactors.push('exitConfidence');

  if (holdDays !== undefined && holdDays !== null) supportingFactors.push('Expected hold time context is available.');
  else missingFactors.push('expectedHoldTime');

  if (['low', 'weak'].includes(String(exitConfidence).toLowerCase())) blockers.push('exit_confidence_weak');

  return getReadinessCategory(blockers.length ? 'blocked' : missingFactors.length ? 'partial' : 'ready', {
    supportingFactors,
    missingFactors,
    blockers,
    explanation: 'Exit Confidence Readiness explains whether future Capital Score can estimate capital recycling reliability.'
  });
}

function explainPortfolioReadiness(input = {}) {
  const portfolio = asObject(input.portfolioContext);
  const supportingFactors = [];
  const missingFactors = [];
  const blockers = [];
  const concentration = toNumber(portfolio.currentConcentrationPercentage ?? portfolio.positionConcentrationPercentage, NaN);

  if (portfolio.availableCapital !== undefined || portfolio.bankrollSize !== undefined) supportingFactors.push('Available capital or bankroll context is available.');
  else missingFactors.push('availableCapital');

  if (Number.isFinite(concentration)) supportingFactors.push('Portfolio concentration context is available.');
  else missingFactors.push('portfolioConcentration');

  if (Number.isFinite(concentration) && concentration >= 30) blockers.push('portfolio_concentration_high');

  return getReadinessCategory(blockers.length ? 'blocked' : missingFactors.length ? 'partial' : 'ready', {
    supportingFactors,
    missingFactors,
    blockers,
    explanation: 'Portfolio Readiness explains whether future Capital Score can account for exposure and concentration risk.'
  });
}

function explainOpportunityCostReadiness(input = {}) {
  const opportunities = asArray(input.competingOpportunities);
  const missingFactors = [];
  const supportingFactors = [];

  if (opportunities.length) supportingFactors.push(`${opportunities.length} competing opportunities are available for future ranking.`);
  else missingFactors.push('competingOpportunities');

  return getReadinessCategory(missingFactors.length ? 'partial' : 'ready', {
    supportingFactors,
    missingFactors,
    blockers: [],
    explanation: opportunities.length
      ? 'Opportunity Cost Readiness has comparison context, but ranking remains unimplemented.'
      : 'Opportunity Cost Readiness is partial because no competing opportunities were supplied.'
  });
}

function explainStrategyReadiness(input = {}) {
  const strategyProfile = asObject(input.strategyProfile);
  const investmentDecision = asObject(input.investmentDecision);
  const strategyFit = asObject(investmentDecision.strategyFit);
  const lanes = asArray(strategyProfile.preferredStrategyLanes);
  const laneEvaluations = asArray(strategyFit.laneEvaluations);
  const supportingFactors = [];
  const missingFactors = [];

  if (lanes.length) supportingFactors.push('Preferred strategy lanes are available.');
  else missingFactors.push('strategyProfile.preferredStrategyLanes');

  if (laneEvaluations.length) supportingFactors.push('Strategy lane evaluations are available from Investment Decision output.');
  else missingFactors.push('investmentDecision.strategyFit.laneEvaluations');

  return getReadinessCategory(missingFactors.length ? 'partial' : 'ready', {
    supportingFactors,
    missingFactors,
    blockers: [],
    explanation: 'Strategy Readiness explains whether future Capital Score can interpret lane fit without letting strategy override evidence.'
  });
}

function explainBankrollReadiness(input = {}) {
  const portfolio = asObject(input.portfolioContext);
  const financial = asObject(input.financialContext);
  const bankroll = getMoney(portfolio.availableCapital ?? portfolio.bankrollSize, null);
  const totalCost = getMoney(financial.totalCost ?? input.listingSnapshot?.totalCost ?? input.listingSnapshot?.price, null);
  const reserve = toNumber(portfolio.reserveCapitalPercentage ?? input.strategyProfile?.reserveCapitalPercentage, NaN);
  const supportingFactors = [];
  const missingFactors = [];
  const blockers = [];

  if (bankroll !== null) supportingFactors.push('Bankroll context is available.');
  else missingFactors.push('bankrollSize_or_availableCapital');

  if (totalCost !== null) supportingFactors.push('Capital required context is available.');
  else missingFactors.push('capitalRequired');

  if (Number.isFinite(reserve)) supportingFactors.push('Reserve capital preference is available.');
  else missingFactors.push('reserveCapitalPercentage');

  if (bankroll !== null && totalCost !== null && totalCost > bankroll) blockers.push('capital_required_exceeds_bankroll');

  return getReadinessCategory(blockers.length ? 'blocked' : missingFactors.length ? 'partial' : 'ready', {
    supportingFactors,
    missingFactors,
    blockers,
    explanation: 'Bankroll Readiness explains whether future Capital Score can judge capital impact and reserve discipline.'
  });
}

function buildReadinessSummary(input = {}) {
  return {
    'Evidence Readiness': explainEvidenceReadiness(input),
    'Downside Protection Readiness': explainDownsideProtectionReadiness(input),
    'Financial Readiness': explainFinancialReadiness(input),
    'Exit Confidence Readiness': explainExitConfidenceReadiness(input),
    'Portfolio Readiness': explainPortfolioReadiness(input),
    'Opportunity Cost Readiness': explainOpportunityCostReadiness(input),
    'Strategy Readiness': explainStrategyReadiness(input),
    'Bankroll Readiness': explainBankrollReadiness(input)
  };
}

function getInputAvailability(input = {}, inputName) {
  const investmentDecision = asObject(input.investmentDecision);
  const shadow = asObject(input.shadowValuation);
  const comparison = asObject(input.shadowSoldComparison);
  const identity = asObject(input.canonicalIdentity);
  const financial = asObject(input.financialContext);
  const portfolio = asObject(input.portfolioContext);
  const market = asObject(input.marketIntelligence);
  const exactMatchCount = getExactMatchCount(input);

  const map = {
    deal_gate_status: input.dealGate?.passed === true ? 'available' : 'insufficient',
    evidence_quality: exactMatchCount >= 3 ? 'available' : 'insufficient',
    exact_identity_confidence: identity.canonicalIdentityKey && identity.eligibility?.exactCompEligible === true ? 'available' : 'insufficient',
    shadow_valuation_support: shadow.insufficientEvidence === false && shadow.recommendedMarketValue !== null ? 'available' : 'insufficient',
    expected_net_profit: getMoney(financial.expectedNetProfit ?? input.productionValuation?.estimatedProfit ?? investmentDecision.expectedNetProfitRange?.expected, null) !== null ? 'available' : 'unavailable',
    roi: Number.isFinite(Number(financial.roi ?? input.productionValuation?.roi)) ? 'available' : 'unavailable',
    margin_of_safety: investmentDecision.marginOfSafety || financial.marginOfSafety ? 'available' : 'unavailable',
    liquidity: financial.liquidity || market.liquidity ? 'available' : 'unavailable',
    expected_hold_time: financial.expectedHoldDays !== undefined || investmentDecision.expectedHoldTime?.days !== undefined ? 'available' : 'unavailable',
    supply_pressure: market.supplyPressure ? 'available' : 'unavailable',
    market_regime: market.marketRegime ? 'available' : 'unavailable',
    capital_required: getMoney(financial.totalCost ?? input.listingSnapshot?.totalCost ?? input.listingSnapshot?.price, null) !== null ? 'available' : 'unavailable',
    downside_risk: shadow.fairMarketRange || investmentDecision.maximumBuyPrice ? 'available' : 'unavailable',
    opportunity_cost: asArray(input.competingOpportunities).length ? 'available' : 'pending future implementation',
    portfolio_concentration: portfolio.currentConcentrationPercentage !== undefined || portfolio.positionConcentrationPercentage !== undefined ? 'available' : 'unavailable',
    strategy_fit: investmentDecision.strategyFit || input.strategyProfile ? 'available' : 'unavailable'
  };

  const status = map[inputName] || 'pending future implementation';
  return {
    input: inputName,
    status,
    available: status === 'available',
    explanation: status === 'available'
      ? `${inputName} is present for future Capital Score consideration.`
      : status === 'insufficient'
        ? `${inputName} is present or inferable but not strong enough for future Capital Score.`
        : status === 'unavailable'
          ? `${inputName} is missing from the current offline context.`
          : `${inputName} requires future scoring/ranking implementation.`
  };
}

function buildFutureCapitalScoreInputs(input = {}) {
  return investmentContract.CAPITAL_SCORE_INPUTS.map((inputName) => getInputAvailability(input, inputName));
}

function summarizeWhyWithheld(readinessSummary = {}, futureInputs = []) {
  const blockedCategories = Object.entries(readinessSummary)
    .filter(([, category]) => category.readiness === 'blocked')
    .map(([name]) => name);
  const partialCategories = Object.entries(readinessSummary)
    .filter(([, category]) => category.readiness === 'partial')
    .map(([name]) => name);
  const unavailableInputs = futureInputs
    .filter((entry) => entry.status !== 'available')
    .map((entry) => entry.input);

  return {
    blockedCategories,
    partialCategories,
    unavailableOrInsufficientInputs: unavailableInputs,
    explanation: [
      'Capital Score is withheld because final scoring weights have not been validated.',
      blockedCategories.length ? `Blocked readiness categories: ${blockedCategories.join(', ')}.` : '',
      partialCategories.length ? `Partial readiness categories: ${partialCategories.join(', ')}.` : '',
      unavailableInputs.length ? `Inputs still unavailable, insufficient, or pending: ${unavailableInputs.join(', ')}.` : '',
      'No score is fabricated or estimated in this phase.'
    ].filter(Boolean).join(' ')
  };
}

function explainCapitalScore(input = {}) {
  const readinessSummary = buildReadinessSummary(input);
  const futureCapitalScoreInputs = buildFutureCapitalScoreInputs(input);
  const withheld = summarizeWhyWithheld(readinessSummary, futureCapitalScoreInputs);

  return {
    capitalScoreExplanation: {
      source: SOURCE,
      version: VERSION,
      productionImpact: 'none',
      decisionImpact: 'none',
      capitalScoreStatus: CAPITAL_SCORE_STATUS,
      score: null,
      finalWeightsDefined: false,
      explanation: withheld.explanation,
      readinessSummary
    },
    futureCapitalScoreInputs,
    scoreWithheldReason: withheld
  };
}

module.exports = {
  CAPITAL_SCORE_STATUS,
  READINESS_CATEGORIES,
  SOURCE,
  VERSION,
  buildFutureCapitalScoreInputs,
  buildReadinessSummary,
  explainCapitalScore
};
