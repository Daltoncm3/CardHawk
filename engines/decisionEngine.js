'use strict';

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(toNumber(value, 0))));
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function pickFirstValue(sources, keys, fallback = undefined) {
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;

    for (const key of keys) {
      if (source[key] !== undefined && source[key] !== null && source[key] !== '') {
        return source[key];
      }
    }
  }

  return fallback;
}

function pickFirstNumber(sources, keys, fallback = 0) {
  const value = pickFirstValue(sources, keys, undefined);
  return value === undefined ? fallback : toNumber(value, fallback);
}

function uniqueMessages(messages) {
  const seen = new Set();

  return asArray(messages)
    .filter(Boolean)
    .map((message) => String(message).trim())
    .filter((message) => {
      if (!message || seen.has(message)) return false;
      seen.add(message);
      return true;
    });
}

function getNested(input = {}, keys = []) {
  for (const key of keys) {
    if (input && typeof input === 'object' && input[key] && typeof input[key] === 'object') {
      return input[key];
    }
  }

  return {};
}

function getCompData(input = {}) {
  return getNested(input, ['compData', 'comps', 'compAnalysis', 'compEngine']);
}

function getMarketValueData(input = {}) {
  return getNested(input, ['marketValueData', 'marketData', 'valueData', 'marketValue', 'valuation']);
}

function getConfidenceData(input = {}) {
  return getNested(input, ['confidenceData', 'confidence', 'confidenceEngine']);
}

function getRoiData(input = {}) {
  return getNested(input, ['roiData', 'roi', 'roiEngine']);
}

function getRiskData(input = {}) {
  return getNested(input, ['riskData', 'risk', 'riskEngine']);
}

function getMarketIntelligenceData(input = {}) {
  return getNested(input, ['marketIntelligenceData', 'marketIntelligence', 'intelligence']);
}

function getPopulationData(input = {}) {
  return getNested(input, ['populationData', 'population', 'populationEngine']);
}

function getTrendData(input = {}) {
  return getNested(input, ['trendData', 'trend', 'trendEngine']);
}

function getQualityData(input = {}) {
  return getNested(input, ['qualityData', 'quality', 'qualityEngine']);
}

function getPricingVerificationData(input = {}) {
  return getNested(input, ['pricingVerificationData', 'pricingVerification', 'pricing']);
}

function getRiskLevel(input = {}) {
  const riskData = getRiskData(input);
  return normalize(
    pickFirstValue(
      [input, riskData],
      ['riskLevel', 'level'],
      ''
    )
  );
}

function getRiskSeverityScore(input = {}) {
  const riskData = getRiskData(input);
  const riskScore = pickFirstNumber([input, riskData], ['riskScore', 'score'], NaN);

  if (Number.isFinite(riskScore)) return clampScore(riskScore);

  const riskLevel = getRiskLevel(input);
  if (riskLevel === 'critical') return 92;
  if (riskLevel === 'high') return 70;
  if (riskLevel === 'medium') return 45;
  if (riskLevel === 'low') return 18;

  return 50;
}

function invertRiskScore(riskSeverityScore) {
  return clampScore(100 - riskSeverityScore);
}

function getSoldCompCount(input = {}) {
  const compData = getCompData(input);
  const marketValueData = getMarketValueData(input);
  const marketIntelligenceData = getMarketIntelligenceData(input);
  const pricingVerificationData = getPricingVerificationData(input);
  const soldSales = asArray(input.soldSales);

  return Math.max(
    soldSales.length,
    pickFirstNumber(
      [
        input,
        pricingVerificationData,
        compData,
        marketValueData,
        marketIntelligenceData,
        marketIntelligenceData.compQuality
      ],
      ['soldCompCount', 'soldCount', 'recentSoldCount', 'completedSales', 'salesCount'],
      0
    )
  );
}

function getUsableCompCount(input = {}) {
  const compData = getCompData(input);
  const marketValueData = getMarketValueData(input);
  const pricingVerificationData = getPricingVerificationData(input);
  const marketIntelligenceData = getMarketIntelligenceData(input);

  const trueUsableCount = pickFirstNumber(
    [pricingVerificationData, compData, marketValueData, marketValueData.compEngine, marketIntelligenceData.compQuality],
    ['usableCompCount', 'usableSoldCompCount', 'selectedCompCount'],
    NaN
  );

  if (Number.isFinite(trueUsableCount)) return Math.max(0, Math.round(trueUsableCount));

  const selectedComps = asArray(compData.selectedComps || marketValueData.selectedComps || pricingVerificationData.selectedComps);
  if (selectedComps.length) {
    return selectedComps.filter((comp) => {
      const status = normalize(comp.compStatus);
      const similarity = toNumber(comp.similarity, 0);
      return status === 'usable' || status === 'strong' || similarity >= 75;
    }).length;
  }

  return 0;
}

function getStrongCompCount(input = {}) {
  const compData = getCompData(input);
  const marketValueData = getMarketValueData(input);
  const pricingVerificationData = getPricingVerificationData(input);

  const explicit = pickFirstNumber(
    [pricingVerificationData, compData, marketValueData, marketValueData.compEngine],
    ['strongCompCount', 'eliteCompCount', 'highSimilarityCompCount'],
    NaN
  );

  if (Number.isFinite(explicit)) return Math.max(0, Math.round(explicit));

  const selectedComps = asArray(compData.selectedComps || marketValueData.selectedComps || pricingVerificationData.selectedComps);
  return selectedComps.filter((comp) => normalize(comp.compStatus) === 'strong' || toNumber(comp.similarity, 0) >= 90).length;
}

function getCappedCompCount(input = {}) {
  const compData = getCompData(input);
  const marketValueData = getMarketValueData(input);
  const pricingVerificationData = getPricingVerificationData(input);

  return pickFirstNumber(
    [pricingVerificationData, compData, marketValueData, marketValueData.compEngine],
    ['cappedCompCount', 'similarityCappedCompCount'],
    0
  );
}

function getRejectedCompCount(input = {}) {
  const compData = getCompData(input);
  const marketValueData = getMarketValueData(input);
  const pricingVerificationData = getPricingVerificationData(input);

  return pickFirstNumber(
    [pricingVerificationData, compData, marketValueData, marketValueData.compEngine],
    ['rejectedCompCount', 'identityRejectedCompCount'],
    Array.isArray(compData.rejectedComps) ? compData.rejectedComps.length : 0
  );
}

function getPricingSpread(input = {}) {
  const compData = getCompData(input);
  const marketValueData = getMarketValueData(input);
  const pricingVerificationData = getPricingVerificationData(input);
  const marketIntelligenceData = getMarketIntelligenceData(input);

  return pickFirstNumber(
    [pricingVerificationData, marketValueData, marketValueData.compEngine, compData, marketIntelligenceData],
    ['pricingSpread', 'priceSpread', 'spread', 'rangePercent'],
    0
  );
}

function getMarketConsistency(input = {}) {
  const compData = getCompData(input);
  const marketValueData = getMarketValueData(input);
  const pricingVerificationData = getPricingVerificationData(input);
  const marketIntelligenceData = getMarketIntelligenceData(input);

  return normalize(
    pickFirstValue(
      [pricingVerificationData, marketValueData, marketValueData.compEngine, compData, marketIntelligenceData],
      ['marketConsistency', 'pricingConsistency', 'consistency'],
      ''
    )
  );
}

function usesFallbackPricing(input = {}) {
  const compData = getCompData(input);
  const marketValueData = getMarketValueData(input);
  const marketIntelligenceData = getMarketIntelligenceData(input);
  const pricingVerificationData = getPricingVerificationData(input);

  if (pricingVerificationData.fallbackUsed === true) return true;
  if (compData.heuristicFallbackUsed === true || compData.fallbackUsed === true) return true;
  if (marketValueData.heuristicFallbackUsed === true || marketValueData.fallbackUsed === true) return true;
  if (marketValueData.compEngine && marketValueData.compEngine.heuristicFallbackUsed === true) return true;
  if (marketIntelligenceData.heuristicFallbackUsed === true) return true;

  const sourceText = [
    input.compSource,
    input.valueSource,
    compData.source,
    compData.method,
    marketValueData.source,
    marketValueData.method,
    marketValueData.valueSource,
    marketValueData.compEngine && marketValueData.compEngine.source,
    marketValueData.compEngine && marketValueData.compEngine.method,
    marketIntelligenceData.source,
    pricingVerificationData.source,
    pricingVerificationData.method
  ].map(normalize).join(' ');

  return sourceText.includes('heuristic') || sourceText.includes('fallback');
}

function getListingCost(input = {}) {
  const listing = input.listing || {};
  const roiData = getRoiData(input);

  const explicitCost = pickFirstNumber(
    [input, listing, roiData],
    ['totalCost', 'listingPrice', 'purchasePrice', 'costBasis', 'cost'],
    NaN
  );

  if (Number.isFinite(explicitCost) && explicitCost > 0) return explicitCost;

  const price = pickFirstNumber([listing, input], ['price', 'currentPrice', 'askingPrice', 'listPrice'], 0);
  const shipping = pickFirstNumber([listing, input], ['shipping', 'shippingCost'], 0);

  return price + shipping;
}

function getExpectedValues(input = {}) {
  const marketValueData = getMarketValueData(input);
  const pricingVerificationData = getPricingVerificationData(input);
  const roiData = getRoiData(input);

  const expectedValue = pickFirstNumber(
    [pricingVerificationData, marketValueData, roiData, input],
    ['expectedValue', 'verifiedMarketValue', 'marketValue', 'estimatedValue', 'estimatedSalePrice', 'targetSalePrice'],
    0
  );

  const expectedValueLow = pickFirstNumber(
    [pricingVerificationData, marketValueData],
    ['expectedValueLow'],
    expectedValue
  );

  const expectedValueHigh = pickFirstNumber(
    [pricingVerificationData, marketValueData],
    ['expectedValueHigh'],
    expectedValue
  );

  return {
    expectedValueLow,
    expectedValue,
    expectedValueHigh
  };
}

function calculateConservativeProfit(input = {}) {
  const roiData = getRoiData(input);
  const cost = getListingCost(input);
  const values = getExpectedValues(input);
  const fees = pickFirstNumber(
    [roiData, input],
    ['ebayFees', 'fees', 'estimatedFees', 'totalFees'],
    0
  );

  if (values.expectedValueLow > 0 && cost > 0) {
    return values.expectedValueLow - cost - fees;
  }

  return pickFirstNumber(
    [input, roiData],
    ['estimatedProfit', 'profit', 'netProfit', 'projectedProfit'],
    0
  );
}

function calculateConservativeRoi(input = {}) {
  const roiData = getRoiData(input);
  const cost = getListingCost(input);
  const conservativeProfit = calculateConservativeProfit(input);

  if (cost > 0 && getExpectedValues(input).expectedValueLow > 0) {
    return (conservativeProfit / cost) * 100;
  }

  return pickFirstNumber(
    [input, roiData],
    ['roi', 'roiPercent', 'returnOnInvestment'],
    0
  );
}

function scoreEvidenceStrength(input = {}) {
  const compData = getCompData(input);
  const marketValueData = getMarketValueData(input);
  const qualityData = getQualityData(input);
  const pricingVerificationData = getPricingVerificationData(input);

  const soldCompCount = getSoldCompCount(input);
  const usableCompCount = getUsableCompCount(input);
  const strongCompCount = getStrongCompCount(input);
  const cappedCompCount = getCappedCompCount(input);
  const rejectedCompCount = getRejectedCompCount(input);
  const averageSimilarity = pickFirstNumber(
    [pricingVerificationData, compData, marketValueData, qualityData],
    ['averageSimilarity', 'avgSimilarity', 'similarityScore'],
    0
  );
  const compConfidence = pickFirstNumber(
    [pricingVerificationData, compData, marketValueData, qualityData],
    ['confidence', 'confidenceScore', 'compConfidence', 'qualityScore'],
    0
  );

  let score = 0;

  if (usableCompCount >= 8) score += 38;
  else if (usableCompCount >= 5) score += 30;
  else if (usableCompCount >= 3) score += 22;
  else if (usableCompCount >= 1) score += 8;

  if (soldCompCount >= 10) score += 18;
  else if (soldCompCount >= 5) score += 12;
  else if (soldCompCount >= 3) score += 7;

  if (strongCompCount >= 4) score += 16;
  else if (strongCompCount >= 2) score += 10;
  else if (strongCompCount >= 1) score += 5;

  if (averageSimilarity >= 90) score += 24;
  else if (averageSimilarity >= 82) score += 18;
  else if (averageSimilarity >= 75) score += 10;
  else if (averageSimilarity > 0) score -= 8;

  if (compConfidence >= 80) score += 20;
  else if (compConfidence >= 65) score += 12;
  else if (compConfidence > 0 && compConfidence < 45) score -= 12;

  if (cappedCompCount > 0) score -= Math.min(18, cappedCompCount * 4);
  if (rejectedCompCount > 0) score -= Math.min(12, rejectedCompCount * 2);
  if (usesFallbackPricing(input)) score -= 24;

  return clampScore(score);
}

function scorePricingConfidence(input = {}) {
  const marketValueData = getMarketValueData(input);
  const confidenceData = getConfidenceData(input);
  const marketIntelligenceData = getMarketIntelligenceData(input);
  const pricingVerificationData = getPricingVerificationData(input);

  const explicitPricingScore = pickFirstNumber(
    [pricingVerificationData, marketValueData, marketIntelligenceData],
    ['pricingReliabilityScore', 'pricingConfidence', 'priceConfidence', 'confidence', 'confidenceScore'],
    0
  );

  const valueTrusted = pricingVerificationData.valueTrusted === true || marketValueData.valueTrusted === true;
  const fallbackUsed = usesFallbackPricing(input);
  const usableCompCount = getUsableCompCount(input);
  const pricingSpread = getPricingSpread(input);
  const marketConsistency = getMarketConsistency(input);

  let score = explicitPricingScore || pickFirstNumber(
    [confidenceData, marketIntelligenceData],
    ['confidenceScore', 'marketConfidence', 'confidence'],
    45
  );

  if (valueTrusted) score += 10;
  if (usableCompCount < 3) score -= 22;
  if (fallbackUsed) score -= 28;

  if (pricingSpread > 1) score = Math.min(score - 18, 45);
  else if (pricingSpread > 0.65) score = Math.min(score - 12, 55);
  else if (pricingSpread > 0.45) score -= 6;

  if (marketConsistency === 'volatile_market' || marketConsistency === 'volatile') {
    score = Math.min(score - 12, 55);
  } else if (marketConsistency === 'tight_market') {
    score += 4;
  }

  return clampScore(score);
}

function scoreExpectedProfit(input = {}) {
  const conservativeProfit = calculateConservativeProfit(input);

  if (conservativeProfit >= 150) return 100;
  if (conservativeProfit >= 100) return 86;
  if (conservativeProfit >= 60) return 72;
  if (conservativeProfit >= 35) return 58;
  if (conservativeProfit >= 15) return 42;
  if (conservativeProfit > 0) return 25;
  return 5;
}

function scoreRoi(input = {}) {
  const roi = calculateConservativeRoi(input);

  if (roi > 250) return 55;
  if (roi > 150) return 70;
  if (roi >= 80) return 100;
  if (roi >= 50) return 88;
  if (roi >= 30) return 70;
  if (roi >= 15) return 50;
  if (roi > 0) return 28;
  return 5;
}

function scoreInvestmentQuality(input = {}) {
  const roiData = getRoiData(input);
  const marketValueData = getMarketValueData(input);
  const marketIntelligenceData = getMarketIntelligenceData(input);

  const roiScore = scoreRoi(input);
  const profitScore = scoreExpectedProfit(input);
  const marginScore = pickFirstNumber(
    [roiData, marketValueData, marketIntelligenceData],
    ['investmentScore', 'dealScore', 'score', 'qualityScore'],
    0
  );

  let baseScore = marginScore > 0
    ? marginScore * 0.4 + roiScore * 0.3 + profitScore * 0.3
    : roiScore * 0.55 + profitScore * 0.45;

  if (getExpectedValues(input).expectedValueLow > 0) {
    if (calculateConservativeProfit(input) <= 0) baseScore = Math.min(baseScore, 35);
    else if (calculateConservativeRoi(input) < 15) baseScore = Math.min(baseScore, 45);
  }

  return clampScore(baseScore);
}

function scoreMarketQuality(input = {}) {
  const marketIntelligenceData = getMarketIntelligenceData(input);
  const marketValueData = getMarketValueData(input);
  const qualityData = getQualityData(input);

  return clampScore(
    pickFirstNumber(
      [marketIntelligenceData, marketValueData, qualityData],
      ['intelligenceScore', 'marketIntelligenceScore', 'marketScore', 'qualityScore', 'confidenceScore'],
      45
    )
  );
}

function scoreTrend(input = {}) {
  const trendData = getTrendData(input);
  const marketIntelligenceData = getMarketIntelligenceData(input);

  const explicitScore = pickFirstNumber(
    [trendData, marketIntelligenceData],
    ['trendScore', 'score', 'trend'],
    NaN
  );

  if (Number.isFinite(explicitScore)) return clampScore(explicitScore);

  const direction = normalize(
    pickFirstValue(
      [trendData, marketIntelligenceData],
      ['trendDirection', 'direction', 'trend'],
      ''
    )
  );

  if (['strong_up', 'up', 'rising', 'positive'].includes(direction)) return 78;
  if (['stable', 'flat', 'neutral'].includes(direction)) return 68;
  if (['down', 'falling', 'declining', 'negative'].includes(direction)) return 38;
  if (['volatile', 'sharp_down', 'strong_down'].includes(direction)) return 25;

  return 50;
}

function scoreLiquidity(input = {}) {
  const marketIntelligenceData = getMarketIntelligenceData(input);
  const trendData = getTrendData(input);
  const compData = getCompData(input);

  return clampScore(
    pickFirstNumber(
      [marketIntelligenceData, marketIntelligenceData.liquidity, trendData, compData],
      ['liquidity', 'liquidityScore', 'score'],
      45
    )
  );
}

function scorePopulationScarcity(input = {}) {
  const populationData = getPopulationData(input);

  const scarcityScore = pickFirstNumber(
    [populationData, input],
    ['scarcityScore', 'populationScore'],
    0
  );

  const confidence = pickFirstNumber(
    [populationData],
    ['confidence'],
    0
  );

  if (!scarcityScore) return 45;
  if (confidence > 0 && confidence < 45) return clampScore(scarcityScore * 0.55);

  return clampScore(scarcityScore);
}

function buildDecisionMatrix(input = {}) {
  const riskSeverityScore = getRiskSeverityScore(input);

  return {
    evidenceStrength: scoreEvidenceStrength(input),
    pricingConfidence: scorePricingConfidence(input),
    investmentQuality: scoreInvestmentQuality(input),
    risk: invertRiskScore(riskSeverityScore),
    marketQuality: scoreMarketQuality(input),
    trend: scoreTrend(input),
    liquidity: scoreLiquidity(input),
    populationScarcity: scorePopulationScarcity(input),
    expectedProfit: scoreExpectedProfit(input),
    roi: scoreRoi(input)
  };
}

function getBlockingFactors(input = {}, matrix = {}) {
  const pricingVerificationData = getPricingVerificationData(input);
  const marketIntelligenceData = getMarketIntelligenceData(input);
  const populationData = getPopulationData(input);

  const blockingFactors = [];
  const soldCompCount = getSoldCompCount(input);
  const usableCompCount = getUsableCompCount(input);
  const riskLevel = getRiskLevel(input);
  const fallbackUsed = usesFallbackPricing(input);
  const pricingConfidence = matrix.pricingConfidence;
  const evidenceStrength = matrix.evidenceStrength;
  const pricingSpread = getPricingSpread(input);
  const marketConsistency = getMarketConsistency(input);

  if (soldCompCount <= 0) {
    blockingFactors.push('No sold-comp evidence is available.');
  }

  if (soldCompCount === 1) {
    blockingFactors.push('Only one sold comp is available.');
  }

  if (usableCompCount < 3) {
    blockingFactors.push(`Only ${usableCompCount} usable comp${usableCompCount === 1 ? '' : 's'} support the valuation.`);
  }

  if (fallbackUsed) {
    blockingFactors.push('Pricing depends on fallback or heuristic support.');
  }

  if (['critical'].includes(riskLevel)) {
    blockingFactors.push('Risk engine marked the listing as critical risk.');
  }

  if (pricingConfidence < 35) {
    blockingFactors.push(`Pricing confidence is extremely low (${pricingConfidence}/100).`);
  }

  if (evidenceStrength < 35) {
    blockingFactors.push(`Evidence strength is weak (${evidenceStrength}/100).`);
  }

  if (pricingSpread > 0.85) {
    blockingFactors.push(`Pricing spread is too wide for a buy-now decision (${pricingSpread}).`);
  }

  if (marketConsistency === 'volatile_market' || marketConsistency === 'volatile') {
    blockingFactors.push('Market consistency is volatile.');
  }

  if (getExpectedValues(input).expectedValueLow > 0 && calculateConservativeProfit(input) <= 0) {
    blockingFactors.push('Deal is not profitable at conservative expected value.');
  }

  if (pricingVerificationData.valueTrusted === false) {
    blockingFactors.push('Pricing verification does not trust the estimated market value.');
  }

  if (marketIntelligenceData.recommendation === 'avoid') {
    blockingFactors.push('Market Intelligence recommends avoiding this market.');
  }

  if (populationData.populationUnavailable && matrix.populationScarcity >= 75) {
    blockingFactors.push('Population scarcity is unsupported by usable population data.');
  }

  return uniqueMessages(blockingFactors);
}

function buildPositives(input = {}, matrix = {}) {
  const positives = [];
  const soldCompCount = getSoldCompCount(input);
  const usableCompCount = getUsableCompCount(input);
  const strongCompCount = getStrongCompCount(input);

  if (matrix.evidenceStrength >= 70) positives.push('Evidence strength is strong.');
  if (matrix.pricingConfidence >= 70) positives.push('Pricing confidence is strong.');
  if (matrix.investmentQuality >= 70) positives.push('Investment quality is attractive at conservative value.');
  if (matrix.risk >= 70) positives.push('Risk profile is acceptable.');
  if (matrix.marketQuality >= 70) positives.push('Market quality is healthy.');
  if (matrix.trend >= 70) positives.push('Trend signal is favorable or stable.');
  if (matrix.liquidity >= 70) positives.push('Liquidity appears healthy.');
  if (matrix.populationScarcity >= 75) positives.push('Population scarcity adds upside support.');
  if (matrix.expectedProfit >= 70) positives.push('Expected profit is meaningful at conservative value.');
  if (matrix.roi >= 70) positives.push('ROI is attractive at conservative value.');
  if (soldCompCount >= 5) positives.push(`${soldCompCount} sold comps support the decision.`);
  if (usableCompCount >= 3) positives.push(`${usableCompCount} usable comps support the valuation.`);
  if (strongCompCount > 0) positives.push(`${strongCompCount} strong comp${strongCompCount === 1 ? '' : 's'} support the valuation.`);

  return positives;
}

function buildWarnings(input = {}, matrix = {}) {
  const warnings = [];
  const riskLevel = getRiskLevel(input);
  const soldCompCount = getSoldCompCount(input);
  const usableCompCount = getUsableCompCount(input);
  const cappedCompCount = getCappedCompCount(input);
  const rejectedCompCount = getRejectedCompCount(input);
  const pricingSpread = getPricingSpread(input);
  const marketConsistency = getMarketConsistency(input);

  if (matrix.evidenceStrength < 50) warnings.push('Evidence strength is limited.');
  if (matrix.pricingConfidence < 55) warnings.push('Pricing confidence is not strong enough for an aggressive buy.');
  if (matrix.investmentQuality < 45) warnings.push('Investment quality is weak at conservative value.');
  if (matrix.risk < 45) warnings.push(`Risk profile is concerning${riskLevel ? ` (${riskLevel})` : ''}.`);
  if (matrix.marketQuality < 50) warnings.push('Market quality is not strong.');
  if (matrix.trend < 40) warnings.push('Trend signal is unfavorable or volatile.');
  if (matrix.liquidity < 45) warnings.push('Liquidity is weak.');
  if (matrix.expectedProfit < 35) warnings.push('Expected profit is low at conservative value.');
  if (matrix.roi < 35) warnings.push('ROI is low at conservative value.');
  if (soldCompCount < 3) warnings.push('Sold-comp history is too thin for a buy-now decision.');
  if (usableCompCount < 3) warnings.push('Usable comp support is thin.');
  if (cappedCompCount > 0) warnings.push(`${cappedCompCount} comp${cappedCompCount === 1 ? '' : 's'} were similarity-capped.`);
  if (rejectedCompCount > 0) warnings.push(`${rejectedCompCount} comp${rejectedCompCount === 1 ? '' : 's'} were rejected by identity checks.`);
  if (pricingSpread > 0.65) warnings.push('Pricing spread is wide.');
  if (marketConsistency === 'volatile_market' || marketConsistency === 'volatile') warnings.push('Market consistency is volatile.');
  if (usesFallbackPricing(input)) warnings.push('Fallback pricing prevents high-conviction approval.');

  return warnings;
}

function calculateOpportunityScore(matrix = {}) {
  return clampScore(
    matrix.investmentQuality * 0.24 +
    matrix.expectedProfit * 0.22 +
    matrix.roi * 0.2 +
    matrix.marketQuality * 0.14 +
    matrix.trend * 0.1 +
    matrix.populationScarcity * 0.1
  );
}

function calculateEvidenceScore(matrix = {}) {
  return clampScore(
    matrix.evidenceStrength * 0.3 +
    matrix.pricingConfidence * 0.25 +
    matrix.risk * 0.18 +
    matrix.marketQuality * 0.12 +
    matrix.liquidity * 0.1 +
    matrix.trend * 0.05
  );
}

function calculateFinalScore(matrix = {}) {
  const evidenceScore = calculateEvidenceScore(matrix);
  const opportunityScore = calculateOpportunityScore(matrix);

  return clampScore(evidenceScore * 0.58 + opportunityScore * 0.42);
}

function getRecommendation(input = {}, matrix = {}, finalScore = 0, blockingFactors = []) {
  const riskLevel = getRiskLevel(input);
  const soldCompCount = getSoldCompCount(input);
  const usableCompCount = getUsableCompCount(input);
  const fallbackUsed = usesFallbackPricing(input);

  if (riskLevel === 'critical') return 'PASS';
  if (matrix.pricingConfidence < 30) return 'PASS';
  if (matrix.evidenceStrength < 25) return 'PASS';
  if (soldCompCount <= 0 && matrix.expectedProfit < 85) return 'PASS';

  if (
    finalScore >= 82 &&
    blockingFactors.length === 0 &&
    matrix.evidenceStrength >= 72 &&
    matrix.pricingConfidence >= 72 &&
    matrix.investmentQuality >= 70 &&
    matrix.expectedProfit >= 58 &&
    matrix.roi >= 50 &&
    matrix.risk >= 60 &&
    matrix.marketQuality >= 65 &&
    matrix.liquidity >= 55 &&
    soldCompCount >= 3 &&
    usableCompCount >= 3 &&
    !fallbackUsed
  ) {
    return 'BUY_NOW';
  }

  if (
    finalScore >= 68 &&
    matrix.evidenceStrength >= 55 &&
    matrix.pricingConfidence >= 55 &&
    matrix.investmentQuality >= 60 &&
    matrix.risk >= 45
  ) {
    return 'STRONG_WATCH';
  }

  if (
    finalScore >= 52 &&
    matrix.evidenceStrength >= 40 &&
    matrix.pricingConfidence >= 40
  ) {
    return 'WATCH';
  }

  if (
    matrix.marketQuality >= 55 ||
    matrix.trend >= 60 ||
    matrix.populationScarcity >= 70 ||
    matrix.investmentQuality >= 55
  ) {
    return 'MONITOR';
  }

  return 'PASS';
}

function calculateDecisionConfidence(matrix = {}, recommendation = 'PASS', blockingFactors = []) {
  const categoryValues = Object.keys(matrix).map((key) => clampScore(matrix[key]));
  const average = categoryValues.length ? getAverage(categoryValues) : 0;
  const spread = categoryValues.length
    ? Math.max(...categoryValues) - Math.min(...categoryValues)
    : 100;

  let confidence = average * 0.45 + (100 - spread) * 0.25;

  if (['BUY_NOW', 'PASS'].includes(recommendation)) confidence += 18;
  else if (recommendation === 'STRONG_WATCH') confidence += 10;
  else if (recommendation === 'WATCH') confidence += 5;

  confidence -= Math.min(24, blockingFactors.length * 6);

  return clampScore(confidence);
}

function getAverage(values) {
  const cleanValues = values
    .map((value) => toNumber(value, NaN))
    .filter((value) => Number.isFinite(value));

  if (!cleanValues.length) return 0;

  return cleanValues.reduce((sum, value) => sum + value, 0) / cleanValues.length;
}

function summarizeDecision(data = {}) {
  const recommendation = data.recommendation || data.decision || 'PASS';
  const matrix = data.decisionMatrix || {};
  const blockingFactors = asArray(data.blockingFactors);

  if (recommendation === 'BUY_NOW') {
    return 'BUY_NOW: the opportunity is attractive even at conservative value, and the evidence is strong enough to trust the valuation, risk, market quality, and liquidity.';
  }

  if (recommendation === 'STRONG_WATCH') {
    return 'STRONG_WATCH: the listing has real upside, but at least one evidence, pricing, liquidity, or risk signal is not strong enough for an immediate buy.';
  }

  if (recommendation === 'WATCH') {
    return 'WATCH: there is some opportunity, but the evidence is mixed and the listing needs manual review before acting.';
  }

  if (recommendation === 'MONITOR') {
    return 'MONITOR: the card or market may be interesting, but the current listing does not have enough confirmed opportunity or evidence.';
  }

  if (blockingFactors.length) {
    return `PASS: ${blockingFactors[0]}`;
  }

  if (matrix.investmentQuality >= 65 && matrix.evidenceStrength < 45) {
    return 'PASS: the opportunity looks tempting, but the evidence is too weak to trust the projected profit.';
  }

  if (matrix.evidenceStrength >= 65 && matrix.investmentQuality < 45) {
    return 'PASS: the evidence is acceptable, but the profit and ROI are not attractive enough at conservative value.';
  }

  return 'PASS: the combined evidence, pricing confidence, risk, market quality, and opportunity do not justify action.';
}

function evaluateDecision(input = {}) {
  const decisionMatrix = buildDecisionMatrix(input);
  const finalScore = calculateFinalScore(decisionMatrix);
  const evidenceScore = calculateEvidenceScore(decisionMatrix);
  const opportunityScore = calculateOpportunityScore(decisionMatrix);
  const blockingFactors = getBlockingFactors(input, decisionMatrix);
  const recommendation = getRecommendation(input, decisionMatrix, finalScore, blockingFactors);
  const decisionConfidence = calculateDecisionConfidence(decisionMatrix, recommendation, blockingFactors);

  const positives = uniqueMessages([
    ...buildPositives(input, decisionMatrix),
    ...asArray(input.positives),
    ...asArray(getCompData(input).positives),
    ...asArray(getMarketValueData(input).positives),
    ...asArray(getRoiData(input).positives),
    ...asArray(getRiskData(input).positives),
    ...asArray(getMarketIntelligenceData(input).positives),
    ...asArray(getPopulationData(input).positives),
    ...asArray(getTrendData(input).positives),
    ...asArray(getQualityData(input).positives)
  ]);

  const warnings = uniqueMessages([
    ...buildWarnings(input, decisionMatrix),
    ...asArray(input.warnings),
    ...asArray(getCompData(input).warnings),
    ...asArray(getMarketValueData(input).warnings),
    ...asArray(getRoiData(input).warnings),
    ...asArray(getRiskData(input).warnings),
    ...asArray(getMarketIntelligenceData(input).warnings),
    ...asArray(getPopulationData(input).warnings),
    ...asArray(getTrendData(input).warnings),
    ...asArray(getQualityData(input).warnings)
  ]);

  const result = {
    source: 'decision_engine',
    decision: recommendation,
    recommendation,
    action: recommendation,
    shouldBuy: recommendation === 'BUY_NOW',
    buyNowAllowed: recommendation === 'BUY_NOW',
    passed: recommendation === 'BUY_NOW',
    approved: recommendation === 'BUY_NOW',
    pass: recommendation === 'BUY_NOW',
    score: finalScore,
    decisionScore: finalScore,
    finalScore,
    evidenceScore,
    opportunityScore,
    decisionConfidence,
    confidence: decisionConfidence,
    decisionMatrix,
    componentScores: decisionMatrix,
    conservativeValue: getExpectedValues(input).expectedValueLow,
    conservativeProfit: Number(calculateConservativeProfit(input).toFixed(2)),
    conservativeRoi: Number(calculateConservativeRoi(input).toFixed(2)),
    positives,
    warnings,
    blockingFactors,
    reasons: uniqueMessages([...blockingFactors, ...warnings]),
    summary: ''
  };

  result.summary = summarizeDecision(result);

  return result;
}

function makeDecision(input = {}) {
  return evaluateDecision(input);
}

function decide(input = {}) {
  return evaluateDecision(input);
}

function getDecision(input = {}) {
  return evaluateDecision(input);
}

module.exports = {
  evaluateDecision,
  makeDecision,
  decide,
  getDecision,
  summarizeDecision
};
