'use strict';

const investmentContract = require('../validation/investmentDecisionContract');
const strategyContract = require('../validation/strategyLaneContract');

const SOURCE = 'investment_decision_engine';
const VERSION = 'investment-decision-engine-v0.1';

const STAGE_NAMES = Object.freeze([
  'eligibilityAndEvidence',
  'downsideAndValuationSafety',
  'financialAttractiveness',
  'exitAndCapitalVelocity',
  'marketAndPortfolioContext'
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

function round(value, places = 2) {
  const factor = 10 ** places;
  return Math.round(toNumber(value, 0) * factor) / factor;
}

function getMoney(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  if (typeof value === 'object') {
    const number = Number(value.amount ?? value.value ?? value.price ?? value.maximum ?? value.offer);
    return Number.isFinite(number) ? number : fallback;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function money(amount, currency = 'USD') {
  return amount === null || amount === undefined
    ? { amount: null, currency }
    : { amount: round(amount), currency };
}

function unique(values = []) {
  return [...new Set(asArray(values).filter(Boolean))];
}

function getDealGateStatus(input = {}) {
  const gate = asObject(input.dealGate);
  return {
    passed: gate.passed === true,
    buyNowAllowed: gate.buyNowAllowed === true,
    decision: gate.decision || (gate.passed === true ? 'PASSED' : gate.passed === false ? 'REJECT' : 'UNKNOWN'),
    reasons: asArray(gate.reasons || gate.rejectionReasons),
    positives: asArray(gate.positives),
    authoritative: true
  };
}

function getTotalCost(input = {}) {
  const listing = asObject(input.listingSnapshot);
  const financial = asObject(input.financialContext);
  return getMoney(
    financial.totalCost ??
    financial.askingPrice ??
    listing.totalCost ??
    listing.price,
    null
  );
}

function getExpectedValue(input = {}) {
  const shadow = asObject(input.shadowValuation);
  const range = asObject(shadow.fairMarketRange);
  const production = asObject(input.productionValuation);
  return getMoney(
    shadow.recommendedMarketValue ??
    range.expectedValue ??
    production.estimatedValue ??
    production.marketValue,
    null
  );
}

function getMaximumBuyPrice(input = {}) {
  const financial = asObject(input.financialContext);
  const explicit = getMoney(financial.maximumBuyPrice, null);
  if (explicit !== null) return explicit;

  const shadow = asObject(input.shadowValuation);
  const range = asObject(shadow.fairMarketRange);
  const floor = getMoney(range.floorValue, null);
  const expected = getMoney(shadow.recommendedMarketValue ?? range.expectedValue, null);

  if (floor !== null && expected !== null) {
    return round(Math.min(floor, expected * 0.82));
  }
  if (floor !== null) return round(floor * 0.9);
  return null;
}

function getSuggestedOffer(input = {}, maximumBuyPrice = null) {
  const financial = asObject(input.financialContext);
  const explicit = getMoney(financial.suggestedOffer, null);
  if (explicit !== null && maximumBuyPrice !== null) return Math.min(explicit, maximumBuyPrice);
  if (explicit !== null) return explicit;
  if (maximumBuyPrice === null) return null;
  return round(maximumBuyPrice * 0.9);
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

function getRecentSoldCount(input = {}) {
  const canonical = asObject(input.canonicalSoldEvidence);
  return toNumber(canonical.recentSoldCount, 0);
}

function getStage(status, data = {}) {
  const blockers = unique(data.blockers);
  const cautions = unique(data.cautions);
  const supportingReasons = unique(data.supportingReasons);
  const missingInputs = unique(data.missingInputs);
  const readiness = blockers.length ? 'blocked' : cautions.length ? 'caution' : status;

  return {
    status,
    readiness,
    blockers,
    cautions,
    supportingReasons,
    missingInputs,
    explanation: data.explanation || (
      blockers.length
        ? 'This stage has blockers that prevent aggressive capital deployment.'
        : cautions.length
          ? 'This stage is usable but should reduce aggressiveness.'
          : 'This stage is ready for explanation-only investment review.'
    )
  };
}

function evaluateEligibilityAndEvidence(input = {}) {
  const dealGate = getDealGateStatus(input);
  const identity = asObject(input.canonicalIdentity);
  const shadow = asObject(input.shadowValuation);
  const exactMatchCount = getExactMatchCount(input);
  const blockers = [];
  const cautions = [];
  const supportingReasons = [];
  const missingInputs = [];

  if (dealGate.passed !== true) blockers.push('deal_gate_failed');
  else supportingReasons.push('Deal Gate passed before investment review.');

  if (!identity.canonicalIdentityKey) {
    blockers.push('canonical_identity_missing');
    missingInputs.push('canonicalIdentity');
  } else if (identity.eligibility?.exactCompEligible !== true) {
    blockers.push('canonical_identity_not_exact_comp_eligible');
  } else {
    supportingReasons.push('Canonical identity is exact-comp eligible.');
  }

  if (exactMatchCount < 3) blockers.push('fewer_than_three_exact_sold_matches');
  else supportingReasons.push(`${exactMatchCount} exact sold matches are available for shadow evidence.`);

  if (shadow.insufficientEvidence === true || shadow.recommendedMarketValue === null) {
    blockers.push(shadow.insufficientEvidenceReason || 'shadow_valuation_unavailable');
  } else {
    supportingReasons.push('Shadow Valuation is available from exact sold evidence.');
  }

  if (getRecentSoldCount(input) === 0 && exactMatchCount > 0) cautions.push('no_recent_canonical_sold_count_reported');

  return getStage(blockers.length ? 'blocked' : cautions.length ? 'limited' : 'ready', {
    blockers,
    cautions,
    supportingReasons,
    missingInputs,
    explanation: blockers.length
      ? 'Investment posture is capped because Deal Gate, exact identity, exact sold evidence, or Shadow Valuation support is missing.'
      : 'Deal Gate and exact evidence support are sufficient for explanation-only investment review.'
  });
}

function evaluateDownsideAndValuationSafety(input = {}, values = {}) {
  const totalCost = values.totalCost;
  const maximumBuyPrice = values.maximumBuyPrice;
  const expectedValue = values.expectedValue;
  const shadow = asObject(input.shadowValuation);
  const range = asObject(shadow.fairMarketRange);
  const floor = getMoney(range.floorValue, null);
  const blockers = [];
  const cautions = [];
  const supportingReasons = [];
  const missingInputs = [];

  if (maximumBuyPrice === null) {
    blockers.push('maximum_buy_price_unavailable');
    missingInputs.push('financialContext.maximumBuyPrice_or_shadowValuation.fairMarketRange');
  }
  if (expectedValue === null) {
    blockers.push('expected_value_unavailable');
    missingInputs.push('shadowValuation.recommendedMarketValue');
  }
  if (totalCost === null) {
    blockers.push('total_cost_unavailable');
    missingInputs.push('financialContext.totalCost_or_listingSnapshot.price');
  }

  if (totalCost !== null && maximumBuyPrice !== null && totalCost > maximumBuyPrice) {
    cautions.push('asking_price_above_maximum_buy_price');
  }
  if (totalCost !== null && floor !== null && totalCost > floor) {
    cautions.push('total_cost_above_conservative_floor');
  }
  if (!cautions.length && !blockers.length) {
    supportingReasons.push('Total cost is at or below the interpreted Maximum Buy Price.');
  }

  return getStage(blockers.length ? 'blocked' : cautions.length ? 'limited' : 'ready', {
    blockers,
    cautions,
    supportingReasons,
    missingInputs,
    explanation: blockers.length
      ? 'Downside safety cannot be explained without a supported value range, total cost, and Maximum Buy Price.'
      : cautions.length
        ? 'Downside safety supports negotiation rather than an aggressive buy posture.'
        : 'Downside and valuation safety are adequate for explanation-only investment review.'
  });
}

function evaluateFinancialAttractiveness(input = {}, values = {}) {
  const financial = asObject(input.financialContext);
  const production = asObject(input.productionValuation);
  const totalCost = values.totalCost;
  const expectedValue = values.expectedValue;
  const expectedNetProfit = getMoney(financial.expectedNetProfit ?? production.estimatedProfit, (
    totalCost !== null && expectedValue !== null ? round(expectedValue - totalCost) : null
  ));
  const roi = toNumber(financial.roi ?? production.roi, (
    totalCost && expectedNetProfit !== null ? expectedNetProfit / totalCost : 0
  ));
  const blockers = [];
  const cautions = [];
  const supportingReasons = [];
  const missingInputs = [];

  if (expectedNetProfit === null) {
    blockers.push('expected_net_profit_unavailable');
    missingInputs.push('financialContext.expectedNetProfit_or_productionValuation.estimatedProfit');
  } else if (expectedNetProfit <= 0) {
    blockers.push('expected_net_profit_not_positive');
  } else if (expectedNetProfit < 10) {
    cautions.push('expected_net_profit_small');
  } else {
    supportingReasons.push(`Expected net profit is positive (${round(expectedNetProfit)}).`);
  }

  if (roi <= 0) blockers.push('roi_not_positive');
  else if (roi < 0.2) cautions.push('roi_below_preferred_threshold');
  else supportingReasons.push(`ROI context is positive (${round(roi * 100, 1)}%).`);

  return {
    ...getStage(blockers.length ? 'blocked' : cautions.length ? 'limited' : 'ready', {
      blockers,
      cautions,
      supportingReasons,
      missingInputs,
      explanation: blockers.length
        ? 'Financial attractiveness is not sufficient for capital deployment.'
        : cautions.length
          ? 'Financial return is positive but should temper aggressiveness.'
          : 'Financial attractiveness is adequate for explanation-only investment review.'
    }),
    expectedNetProfit,
    roi
  };
}

function getLiquidityState(input = {}) {
  const intelligence = asObject(input.marketIntelligence);
  const financial = asObject(input.financialContext);
  return String(
    financial.liquidity ||
    intelligence.liquidity?.liquidityLevel ||
    intelligence.demandQuality?.demandQualityLevel ||
    'unknown'
  ).toLowerCase();
}

function evaluateExitAndCapitalVelocity(input = {}) {
  const financial = asObject(input.financialContext);
  const intelligence = asObject(input.marketIntelligence);
  const liquidity = getLiquidityState(input);
  const holdDays = toNumber(financial.expectedHoldDays ?? financial.expectedHoldTimeDays, NaN);
  const exitConfidence = String(financial.exitConfidence ?? intelligence.exitConfidence?.status ?? 'unknown').toLowerCase();
  const supplyPressure = String(intelligence.supplyPressure?.supplyPressureLevel || intelligence.supplyPressure?.riskLevel || '').toLowerCase();
  const blockers = [];
  const cautions = [];
  const supportingReasons = [];
  const missingInputs = [];

  if (liquidity === 'unknown') {
    cautions.push('liquidity_unknown');
    missingInputs.push('marketIntelligence.liquidity_or_financialContext.liquidity');
  } else if (['low', 'thin', 'weak', 'stale'].includes(liquidity)) {
    cautions.push('liquidity_weak');
  } else {
    supportingReasons.push(`Liquidity context is ${liquidity}.`);
  }

  if (!Number.isFinite(holdDays)) {
    cautions.push('expected_hold_time_unknown');
    missingInputs.push('financialContext.expectedHoldDays');
  } else if (holdDays > 180) {
    cautions.push('expected_hold_time_long');
  } else {
    supportingReasons.push(`Expected hold time is ${holdDays} days.`);
  }

  if (['low', 'weak', 'unknown'].includes(exitConfidence)) cautions.push('exit_confidence_not_strong');
  else supportingReasons.push(`Exit confidence is ${exitConfidence}.`);

  if (['high', 'severe'].includes(supplyPressure)) cautions.push('supply_pressure_high');

  return {
    ...getStage(blockers.length ? 'blocked' : cautions.length ? 'limited' : 'ready', {
      blockers,
      cautions,
      supportingReasons,
      missingInputs,
      explanation: cautions.length
        ? 'Exit confidence, liquidity, supply, or hold-time context should reduce aggressiveness.'
        : 'Exit and capital velocity context support the selected strategy lane.'
    }),
    liquidity,
    holdDays: Number.isFinite(holdDays) ? holdDays : null,
    exitConfidence
  };
}

function evaluateMarketAndPortfolioContext(input = {}, values = {}) {
  const financial = asObject(input.financialContext);
  const portfolio = asObject(input.portfolioContext);
  const intelligence = asObject(input.marketIntelligence);
  const totalCost = values.totalCost;
  const bankroll = getMoney(portfolio.availableCapital ?? portfolio.bankrollSize ?? financial.bankrollSize, null);
  const maxAllocation = getMoney(
    portfolio.maximumCapitalAllocationPerPosition ??
    portfolio.maxCapitalAllocationPerPosition,
    bankroll === null ? null : round(bankroll * 0.2)
  );
  const concentration = toNumber(portfolio.currentConcentrationPercentage ?? portfolio.positionConcentrationPercentage, 0);
  const regime = String(intelligence.marketRegime?.primaryRegime || intelligence.marketRegime?.regime || 'unknown').toLowerCase();
  const blockers = [];
  const cautions = [];
  const supportingReasons = [];
  const missingInputs = [];

  if (bankroll === null) {
    cautions.push('bankroll_unknown');
    missingInputs.push('portfolioContext.availableCapital');
  } else if (totalCost !== null && totalCost > bankroll) {
    blockers.push('total_cost_exceeds_available_capital');
  } else {
    supportingReasons.push('Available capital can cover the position.');
  }

  if (totalCost !== null && maxAllocation !== null && totalCost > maxAllocation) {
    cautions.push('position_size_exceeds_preferred_allocation');
  }

  if (concentration >= 25) cautions.push('portfolio_concentration_high');
  if (['falling', 'volatile', 'stale', 'hype_driven', 'thin'].includes(regime)) cautions.push(`market_regime_${regime}`);
  else if (regime !== 'unknown') supportingReasons.push(`Market regime context is ${regime}.`);
  else missingInputs.push('marketIntelligence.marketRegime');

  return getStage(blockers.length ? 'blocked' : cautions.length ? 'limited' : 'ready', {
    blockers,
    cautions,
    supportingReasons,
    missingInputs,
    explanation: blockers.length
      ? 'Portfolio or bankroll constraints block capital deployment.'
      : cautions.length
        ? 'Market or portfolio context should reduce aggressiveness.'
        : 'Market and portfolio context do not add major constraints.'
  });
}

function evaluateStrategyLane(strategyLane, stageReadiness = {}, input = {}) {
  const definition = strategyContract.getStrategyLaneDefinition(strategyLane);
  const financial = asObject(input.financialContext);
  const exit = asObject(stageReadiness.exitAndCapitalVelocity);
  const evidenceBlocked = stageReadiness.eligibilityAndEvidence?.readiness === 'blocked';
  const strengths = [];
  const weaknesses = [];

  if (!definition) {
    return {
      strategyLane,
      laneEligibility: 'invalid_lane',
      laneReadiness: 'blocked',
      laneStrengths: [],
      laneWeaknesses: ['Unknown strategy lane.'],
      recommendedHoldingWindow: null,
      preferredExitStyle: 'unknown',
      explanation: 'Unknown strategy lane.',
      productionImpact: 'none'
    };
  }

  if (evidenceBlocked) weaknesses.push('Evidence must be sufficient before this lane can support investment posture.');
  if (strategyLane === strategyContract.STRATEGY_LANES.QUICK_FLIP) {
    if (exit.exitConfidence === 'high' || exit.exitConfidence === 'strong') strengths.push('Quick flip lane has strong exit confidence.');
    else weaknesses.push('Quick flips require strong exit confidence.');
    if (exit.holdDays !== null && exit.holdDays <= 45) strengths.push('Expected hold time fits quick flip behavior.');
    else weaknesses.push('Expected hold time is not clearly quick-flip friendly.');
  }
  if (strategyLane === strategyContract.STRATEGY_LANES.MEDIUM_HOLD) {
    if (exit.holdDays !== null && exit.holdDays <= 180) strengths.push('Expected hold time fits medium-hold behavior.');
    else weaknesses.push('Medium hold needs a credible weeks-to-months exit window.');
  }
  if (strategyLane === strategyContract.STRATEGY_LANES.LONG_TERM_INVESTMENT) {
    if (evidenceBlocked) weaknesses.push('Long-term investing cannot excuse weak evidence.');
    if (financial.longTermThesis || financial.investmentThesis) strengths.push('Long-term thesis context is present.');
    else weaknesses.push('Long-term thesis context is missing.');
  }

  const laneReadiness = evidenceBlocked ? 'blocked' : weaknesses.length ? 'context_only' : 'strong_fit';
  return {
    strategyLane,
    laneEligibility: evidenceBlocked ? 'not_eligible_due_to_evidence' : 'eligible_context',
    laneReadiness,
    laneStrengths: strengths,
    laneWeaknesses: unique(weaknesses),
    recommendedHoldingWindow: financial.preferredHoldDuration || definition.preferredHoldTime,
    preferredExitStyle: strategyLane === strategyContract.STRATEGY_LANES.QUICK_FLIP
      ? 'fast_resale'
      : strategyLane === strategyContract.STRATEGY_LANES.MEDIUM_HOLD
        ? 'planned_resale'
        : 'thesis_driven_exit',
    explanation: `${strategyLane} is evaluated as context only; it cannot override Deal Gate, evidence quality, or Capital Score.`,
    productionImpact: 'none'
  };
}

function evaluateStrategyFit(input = {}, stageReadiness = {}) {
  const lanes = Object.values(strategyContract.STRATEGY_LANES)
    .map((lane) => evaluateStrategyLane(lane, stageReadiness, input));
  const preferred = asArray(input.strategyProfile?.preferredStrategyLanes);
  const bestFit = lanes.find((lane) => preferred.includes(lane.strategyLane) && lane.laneReadiness === 'strong_fit')
    || lanes.find((lane) => lane.laneReadiness === 'strong_fit')
    || lanes[0];

  return {
    productionImpact: 'none',
    preferredStrategyLanes: preferred,
    selectedContextLane: bestFit.strategyLane,
    laneEvaluations: lanes,
    explanation: 'Strategy lanes are context only and do not make production decisions.'
  };
}

function aggregateStageSignals(stageReadiness = {}) {
  const stages = Object.values(stageReadiness);
  return {
    blockers: unique(stages.flatMap((stage) => stage.blockers)),
    cautions: unique(stages.flatMap((stage) => stage.cautions)),
    supportingReasons: unique(stages.flatMap((stage) => stage.supportingReasons)),
    missingInputs: unique(stages.flatMap((stage) => stage.missingInputs))
  };
}

function choosePosture({ input = {}, stageSignals = {}, values = {}, strategyFit = {} } = {}) {
  const posture = investmentContract.INVESTMENT_POSTURES;
  const dealGate = getDealGateStatus(input);
  const hasEvidenceBlocker = stageSignals.blockers.some((reason) => [
    'canonical_identity_missing',
    'canonical_identity_not_exact_comp_eligible',
    'fewer_than_three_exact_sold_matches',
    'shadow_valuation_unavailable',
    'no_exact_sold_matches',
    'canonical_identity_not_exact_comp_eligible'
  ].includes(reason) || /shadow|exact|identity|valuation/.test(reason));

  if (dealGate.passed !== true) return posture.IGNORE;
  if (hasEvidenceBlocker) return posture.MONITOR;
  if (stageSignals.blockers.length) return posture.MONITOR;
  if (values.totalCost !== null && values.maximumBuyPrice !== null && values.totalCost > values.maximumBuyPrice) {
    return posture.NEGOTIATE;
  }
  if (stageSignals.cautions.includes('portfolio_concentration_high')) return posture.MONITOR;
  if (stageSignals.cautions.includes('position_size_exceeds_preferred_allocation')) return posture.NEGOTIATE;
  if (stageSignals.cautions.length >= 3) return posture.NEGOTIATE;

  const exactMatchCount = getExactMatchCount(input);
  const margin = values.marginOfSafety?.percentage ?? 0;
  const quickFlip = strategyFit.laneEvaluations?.find((lane) => lane.strategyLane === strategyContract.STRATEGY_LANES.QUICK_FLIP);
  if (exactMatchCount >= 5 && margin >= 20 && quickFlip?.laneReadiness === 'strong_fit') {
    return posture.PRIORITY_BUY;
  }
  return posture.BUY;
}

function getCapitalAction(posture) {
  return {
    IGNORE: 'do_not_allocate_capital',
    MONITOR: 'monitor_until_evidence_price_or_market_conditions_improve',
    NEGOTIATE: 'make_only_an_evidence_supported_offer_at_or_below_maximum_buy_price',
    BUY: 'eligible_for_capital_allocation_context_only',
    PRIORITY_BUY: 'highest_priority_context_only_pending_future_capital_score_validation'
  }[posture] || 'unknown';
}

function buildCapitalScore(stageSignals = {}) {
  return {
    capitalScoreStatus: 'not_scored',
    score: null,
    finalWeightsDefined: false,
    productionImpact: 'none',
    missingInputsBeforeScoringCanBeValid: unique([
      ...stageSignals.missingInputs,
      'validated_capital_score_weights',
      'validated_portfolio_policy',
      'validated_opportunity_cost_model'
    ]),
    explanation: 'Capital Score is intentionally not calculated in Phase 7.1A; staged readiness is explanation-only.'
  };
}

function summarizeInvestmentDecision(result = {}) {
  return `${result.investmentPosture}: ${result.capitalAction}. Production impact is none.`;
}

function evaluateInvestmentDecision(input = {}) {
  const inputValidation = investmentContract.validateInvestmentDecisionInput(input);
  const totalCost = getTotalCost(input);
  const expectedValue = getExpectedValue(input);
  const maximumBuyPrice = getMaximumBuyPrice(input);
  const suggestedOffer = getSuggestedOffer(input, maximumBuyPrice);
  const marginPercent = totalCost !== null && maximumBuyPrice !== null && maximumBuyPrice > 0
    ? round(((maximumBuyPrice - totalCost) / maximumBuyPrice) * 100, 1)
    : null;
  const values = {
    totalCost,
    expectedValue,
    maximumBuyPrice,
    suggestedOffer,
    marginOfSafety: {
      percentage: marginPercent,
      explanation: marginPercent === null
        ? 'Margin of safety unavailable without total cost and Maximum Buy Price.'
        : 'Margin of safety is interpreted from total cost versus Maximum Buy Price.'
    }
  };

  const stageReadiness = {
    eligibilityAndEvidence: evaluateEligibilityAndEvidence(input),
    downsideAndValuationSafety: evaluateDownsideAndValuationSafety(input, values),
    financialAttractiveness: evaluateFinancialAttractiveness(input, values),
    exitAndCapitalVelocity: evaluateExitAndCapitalVelocity(input),
    marketAndPortfolioContext: evaluateMarketAndPortfolioContext(input, values)
  };
  const strategyFit = evaluateStrategyFit(input, stageReadiness);
  const stageSignals = aggregateStageSignals(stageReadiness);

  if (!inputValidation.valid) {
    stageSignals.blockers = unique([...stageSignals.blockers, ...inputValidation.reasons]);
    stageSignals.missingInputs = unique([...stageSignals.missingInputs, ...inputValidation.reasons]);
  }

  if (getMoney(input.financialContext?.suggestedOffer, null) !== null && suggestedOffer !== getMoney(input.financialContext?.suggestedOffer, null)) {
    stageSignals.cautions = unique([...stageSignals.cautions, 'suggested_offer_capped_at_maximum_buy_price']);
  }

  const investmentPosture = choosePosture({ input, stageSignals, values, strategyFit });
  const capitalScore = buildCapitalScore(stageSignals);
  const financialStage = asObject(stageReadiness.financialAttractiveness);
  const output = {
    source: SOURCE,
    version: VERSION,
    productionImpact: 'none',
    decisionAuthority: 'non_production_explanation_only_deal_gate_remains_authoritative',
    dealGateStatus: getDealGateStatus(input),
    investmentPosture,
    capitalAction: getCapitalAction(investmentPosture),
    capitalScore,
    capitalScoreStatus: capitalScore.capitalScoreStatus,
    strategyFit,
    maximumBuyPrice: money(maximumBuyPrice),
    suggestedOffer: money(suggestedOffer),
    marginOfSafety: values.marginOfSafety,
    expectedNetProfitRange: {
      low: financialStage.expectedNetProfit === null ? null : round(financialStage.expectedNetProfit * 0.75),
      expected: financialStage.expectedNetProfit === undefined ? null : financialStage.expectedNetProfit,
      high: financialStage.expectedNetProfit === null ? null : round(financialStage.expectedNetProfit * 1.15),
      explanation: 'Prototype range is context only and depends on existing valuation inputs.'
    },
    expectedHoldTime: {
      days: stageReadiness.exitAndCapitalVelocity.holdDays,
      explanation: 'Expected hold time is consumed as context only.'
    },
    exitStrategy: {
      preferredExitStyle: strategyFit.laneEvaluations?.find((lane) => lane.strategyLane === strategyFit.selectedContextLane)?.preferredExitStyle || 'unknown',
      explanation: 'Exit strategy is explanation-only and does not modify recommendations.'
    },
    opportunityRank: {
      rank: null,
      comparedCount: asArray(input.competingOpportunities).length,
      explanation: 'Multi-opportunity ranking is not implemented in Phase 7.1A.'
    },
    opportunityCostAssessment: {
      status: asArray(input.competingOpportunities).length ? 'requires_future_ranking' : 'not_evaluated',
      explanation: 'Opportunity cost is identified but not scored in this prototype.'
    },
    portfolioFit: {
      status: stageReadiness.marketAndPortfolioContext.readiness,
      explanation: stageReadiness.marketAndPortfolioContext.explanation
    },
    aggressivenessLevel: investmentPosture === investmentContract.INVESTMENT_POSTURES.PRIORITY_BUY
      ? 'high_context_only'
      : investmentPosture === investmentContract.INVESTMENT_POSTURES.BUY
        ? 'moderate_context_only'
        : investmentPosture === investmentContract.INVESTMENT_POSTURES.NEGOTIATE
          ? 'reduced_negotiate_only'
          : 'low_or_none',
    uncertaintyAdjustment: {
      direction: stageSignals.cautions.length || stageSignals.blockers.length ? 'reduced_aggressiveness' : 'no_major_reduction',
      cautionsApplied: stageSignals.cautions,
      blockersApplied: stageSignals.blockers,
      explanation: 'Uncertainty only reduces aggressiveness in this prototype.'
    },
    supportingReasons: stageSignals.supportingReasons,
    cautionReasons: stageSignals.cautions,
    blockers: stageSignals.blockers,
    conflicts: stageSignals.cautions.filter((reason) => /exceeds|concentration|regime|pressure/.test(reason)),
    explanation: '',
    auditTrail: [
      {
        step: 'contract_input_validation',
        valid: inputValidation.valid,
        reasons: inputValidation.reasons
      },
      {
        step: 'stage_readiness_evaluation',
        stages: STAGE_NAMES
      },
      {
        step: 'capital_score',
        status: 'not_scored'
      }
    ],
    stageReadiness
  };

  output.explanation = summarizeInvestmentDecision(output);
  return output;
}

module.exports = {
  SOURCE,
  VERSION,
  STAGE_NAMES,
  evaluateInvestmentDecision,
  summarizeInvestmentDecision
};
