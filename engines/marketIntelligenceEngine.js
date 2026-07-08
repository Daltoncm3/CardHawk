'use strict';

const comparableQualityEngine = require('./comparableQualityEngine');
const evidenceSufficiencyEngine = require('./evidenceSufficiencyEngine');
const valuationRangeEngine = require('./valuationRangeEngine');

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
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

function pickRoiPercent(sources) {
  const explicitPercent = pickFirstNumber(
    sources,
    ['roiPercent', 'projectedRoiPercent', 'projectedROIPercent'],
    NaN
  );

  if (Number.isFinite(explicitPercent)) return explicitPercent;

  const decimalRoi = pickFirstNumber(sources, ['roi', 'returnOnInvestment'], 0);
  return decimalRoi * 100;
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(toNumber(value, 0))));
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

function getSalePrice(sale = {}) {
  return pickFirstNumber(
    [sale],
    ['soldPrice', 'salePrice', 'price', 'amount', 'totalPrice', 'value'],
    0
  );
}

function getAverage(values) {
  const cleanValues = values
    .map((value) => toNumber(value, NaN))
    .filter((value) => Number.isFinite(value) && value > 0);

  if (!cleanValues.length) return 0;

  return cleanValues.reduce((sum, value) => sum + value, 0) / cleanValues.length;
}

function getMedian(values) {
  const cleanValues = values
    .map((value) => toNumber(value, NaN))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);

  if (!cleanValues.length) return 0;

  const middle = Math.floor(cleanValues.length / 2);
  if (cleanValues.length % 2) return cleanValues[middle];

  return (cleanValues[middle - 1] + cleanValues[middle]) / 2;
}

function getStandardDeviation(values, average) {
  const cleanValues = values
    .map((value) => toNumber(value, NaN))
    .filter((value) => Number.isFinite(value) && value > 0);

  if (cleanValues.length < 2 || !average) return 0;

  const variance = cleanValues.reduce((sum, value) => {
    return sum + Math.pow(value - average, 2);
  }, 0) / cleanValues.length;

  return Math.sqrt(variance);
}

function roundMoney(value) {
  return Math.round(toNumber(value, 0) * 100) / 100;
}

function roundMetric(value, digits = 3) {
  const multiplier = Math.pow(10, digits);
  return Math.round(toNumber(value, 0) * multiplier) / multiplier;
}

function getEvidenceText(evidence = {}) {
  return [
    evidence.evidenceType,
    evidence.status,
    evidence.listingStatus,
    evidence.source,
    evidence.type,
    evidence.recordType,
    evidence.marketState,
    evidence.saleStatus
  ].filter(Boolean).map(normalize).join(' ');
}

function getEvidenceType(evidence = {}) {
  const explicitType = normalize(evidence.evidenceType);
  if (explicitType === 'true_sold' || explicitType === 'active' || explicitType === 'fallback_unknown') {
    return explicitType;
  }

  const text = getEvidenceText(evidence);
  if (
    evidence.sold === true ||
    evidence.isSold === true ||
    evidence.completed === true ||
    evidence.isCompleted === true ||
    evidence.soldAt ||
    evidence.dateSold ||
    /\b(sold|completed|ended)\b/.test(text)
  ) {
    return 'true_sold';
  }

  if (
    evidence.active === true ||
    evidence.isActive === true ||
    Array.isArray(evidence.buyingOptions) ||
    /\b(active|live|listed|available|current|open)\b/.test(text)
  ) {
    return 'active';
  }

  return 'fallback_unknown';
}

function getEvidencePrice(evidence = {}) {
  return pickFirstNumber(
    [evidence],
    ['soldPrice', 'salePrice', 'price', 'askingPrice', 'askPrice', 'amount', 'totalPrice', 'value', 'marketValue'],
    0
  );
}

function getEvidenceAgeDays(evidence = {}) {
  const explicitAge = pickFirstNumber(
    [evidence],
    ['ageDays', 'daysOld', 'daysSinceSale', 'soldDaysAgo'],
    NaN
  );

  if (Number.isFinite(explicitAge)) return Math.max(0, explicitAge);

  const dateValue = pickFirstValue(
    [evidence],
    ['soldAt', 'dateSold', 'soldDate', 'saleDate', 'endedAt', 'endDate', 'lastSeenAt', 'createdAt'],
    ''
  );

  if (!dateValue) return null;

  const timestamp = new Date(dateValue).getTime();
  if (!Number.isFinite(timestamp)) return null;

  const ageMs = Date.now() - timestamp;
  return ageMs > 0 ? Math.floor(ageMs / 86400000) : 0;
}

function getEvidenceSaleType(evidence = {}) {
  const text = normalize(
    pickFirstValue([evidence], ['saleType', 'format', 'listingType', 'purchaseType', 'type'], '')
  );

  if (text.includes('auction')) return 'auction';
  if (text.includes('best') || text.includes('offer')) return 'best_offer';
  if (text.includes('buy') || text.includes('bin') || text.includes('fixed')) return 'buy_it_now';
  return 'unknown';
}

function normalizeEvidenceItem(evidence = {}, sourceGroup = '') {
  const price = getEvidencePrice(evidence);
  const ageDays = getEvidenceAgeDays(evidence);

  return {
    evidenceType: getEvidenceType(evidence),
    price: roundMoney(price),
    ageDays,
    similarity: pickFirstNumber([evidence], ['similarity', 'similarityScore', 'matchScore'], 0),
    source: pickFirstValue([evidence], ['source', 'marketplace', 'platform'], sourceGroup),
    saleType: getEvidenceSaleType(evidence),
    title: pickFirstValue([evidence], ['title', 'name', 'listingTitle'], '')
  };
}

function getEvidenceSources(input = {}) {
  const compData = input.compData || {};
  const marketData = input.marketData || {};

  return [
    ...asArray(input.soldSales).map((item) => ({ item, sourceGroup: 'sold_sales' })),
    ...asArray(compData.selectedComps).map((item) => ({ item, sourceGroup: 'selected_comps' })),
    ...asArray(compData.comps).map((item) => ({ item, sourceGroup: 'comp_data' })),
    ...asArray(marketData.soldComps).map((item) => ({ item, sourceGroup: 'market_sold_comps' })),
    ...asArray(marketData.activeComps).map((item) => ({ item, sourceGroup: 'market_active_comps' }))
  ];
}

function getRecencyWeight(ageDays) {
  if (!Number.isFinite(ageDays)) return 0.75;
  if (ageDays <= 30) return 1.2;
  if (ageDays <= 90) return 1;
  if (ageDays <= 180) return 0.75;
  return 0.5;
}

function getWeightedSoldAverage(soldEvidence) {
  const weighted = soldEvidence
    .map((evidence) => {
      const similarityWeight = evidence.similarity > 0 ? Math.max(0.35, evidence.similarity / 100) : 0.75;
      const weight = similarityWeight * getRecencyWeight(evidence.ageDays);
      return { price: evidence.price, weight };
    })
    .filter((item) => item.price > 0 && item.weight > 0);

  if (!weighted.length) return 0;

  const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0);
  const totalValue = weighted.reduce((sum, item) => sum + item.price * item.weight, 0);
  return totalWeight > 0 ? roundMoney(totalValue / totalWeight) : 0;
}

function calculateEvidenceQualityScore(evidence) {
  if (!evidence.length) return 0;

  const trueSoldCount = evidence.filter((item) => item.evidenceType === 'true_sold').length;
  const activeCount = evidence.filter((item) => item.evidenceType === 'active').length;
  const unknownCount = evidence.filter((item) => item.evidenceType === 'fallback_unknown').length;
  const similarityValues = evidence.map((item) => item.similarity).filter((value) => value > 0);
  const freshCount = evidence.filter((item) => Number.isFinite(item.ageDays) && item.ageDays <= 90).length;

  let score = 35;
  score += Math.min(30, trueSoldCount * 8);
  score += Math.min(10, activeCount * 2);
  score += Math.min(12, freshCount * 3);
  score -= Math.min(25, unknownCount * 7);

  if (similarityValues.length) {
    score += Math.min(13, Math.max(0, getAverage(similarityValues) - 75) * 0.5);
  }

  return clampScore(score);
}

function buildEvidenceSummary(input = {}) {
  const evidence = getEvidenceSources(input)
    .map(({ item, sourceGroup }) => normalizeEvidenceItem(item, sourceGroup))
    .filter((item) => item.price > 0);

  const trueSoldEvidence = evidence.filter((item) => item.evidenceType === 'true_sold');
  const activeEvidence = evidence.filter((item) => item.evidenceType === 'active');
  const fallbackUnknownEvidence = evidence.filter((item) => item.evidenceType === 'fallback_unknown');
  const soldPrices = trueSoldEvidence.map((item) => item.price).filter((price) => price > 0);
  const activePrices = activeEvidence.map((item) => item.price).filter((price) => price > 0);
  const medianSold = roundMoney(getMedian(soldPrices));
  const highSold = soldPrices.length ? Math.max(...soldPrices) : 0;
  const lowSold = soldPrices.length ? Math.min(...soldPrices) : 0;
  const priceSpread = medianSold > 0 && highSold > lowSold ? (highSold - lowSold) / medianSold : 0;
  const volatility = medianSold > 0 ? getStandardDeviation(soldPrices, getAverage(soldPrices) || medianSold) / medianSold : 0;

  return {
    evidenceCount: evidence.length,
    trueSoldCount: trueSoldEvidence.length,
    activeCount: activeEvidence.length,
    fallbackUnknownCount: fallbackUnknownEvidence.length,
    medianSold,
    weightedSoldAverage: getWeightedSoldAverage(trueSoldEvidence),
    activeMedianAsk: roundMoney(getMedian(activePrices)),
    priceSpread: roundMetric(priceSpread),
    volatility: roundMetric(volatility),
    evidenceQualityScore: calculateEvidenceQualityScore(evidence),
    activeOnlyFlag: activeEvidence.length > 0 && trueSoldEvidence.length === 0,
    fallbackOnlyFlag: fallbackUnknownEvidence.length > 0 && trueSoldEvidence.length === 0 && activeEvidence.length === 0,
    normalizedEvidence: evidence
  };
}

function getSoldCompCount(input = {}) {
  const marketData = input.marketData || {};
  const compData = input.compData || {};
  const qualityData = input.qualityData || {};
  const soldSales = asArray(input.soldSales);

  return Math.max(
    soldSales.length,
    pickFirstNumber(
      [marketData, compData, qualityData],
      ['soldCount', 'recentSoldCount', 'completedSales', 'salesCount', 'compCount', 'usableSoldCompCount'],
      0
    )
  );
}

function getActiveCompCount(input = {}) {
  const marketData = input.marketData || {};
  const compData = input.compData || {};

  return pickFirstNumber(
    [marketData, compData],
    ['activeCount', 'activeListings', 'availableCount', 'listingCount'],
    0
  );
}

function isHeuristicFallback(input = {}) {
  const listing = input.listing || {};
  const marketData = input.marketData || {};
  const compData = input.compData || {};
  const qualityData = input.qualityData || {};

  const sourceText = [
    listing.compSource,
    listing.valueSource,
    marketData.source,
    marketData.compSource,
    marketData.valueSource,
    marketData.valuationSource,
    compData.source,
    compData.compSource,
    qualityData.source,
    qualityData.method
  ].map(normalize).join(' ');

  return sourceText.includes('heuristic') || sourceText.includes('fallback');
}

function getMarketReference(input = {}) {
  const marketData = input.marketData || {};
  const compData = input.compData || {};
  const soldPrices = asArray(input.soldSales).map(getSalePrice).filter((price) => price > 0);

  const averageSoldPrice = getAverage(soldPrices);
  const medianSoldPrice = getMedian(soldPrices);

  return pickFirstNumber(
    [marketData, compData],
    ['referencePrice', 'medianPrice', 'medianSoldPrice', 'marketValue', 'averagePrice', 'avgPrice', 'averageSoldPrice'],
    medianSoldPrice || averageSoldPrice
  );
}

function getEstimatedValue(input = {}) {
  const listing = input.listing || {};
  const marketData = input.marketData || {};
  const roiData = input.roiData || {};
  const compData = input.compData || {};

  return pickFirstNumber(
    [roiData, listing, marketData, compData],
    ['estimatedValue', 'estimatedSalePrice', 'targetSalePrice', 'projectedSalePrice', 'marketValue'],
    0
  );
}

function getProjectedRoi(input = {}) {
  const listing = input.listing || {};
  const roiData = input.roiData || {};

  return pickRoiPercent([roiData, listing]);
}

function scoreSoldDepth(soldCount) {
  if (soldCount >= 25) return 100;
  if (soldCount >= 15) return 88;
  if (soldCount >= 8) return 75;
  if (soldCount >= 4) return 58;
  if (soldCount >= 3) return 45;
  if (soldCount >= 1) return 25;
  return 5;
}

function scoreLiquidity(soldCount, activeCount, sellThroughRate) {
  const depthScore = scoreSoldDepth(soldCount);

  let ratioScore = 45;
  if (sellThroughRate >= 1.25) ratioScore = 100;
  else if (sellThroughRate >= 0.8) ratioScore = 88;
  else if (sellThroughRate >= 0.5) ratioScore = 72;
  else if (sellThroughRate >= 0.25) ratioScore = 50;
  else if (sellThroughRate > 0) ratioScore = 28;

  if (!activeCount && soldCount >= 8) ratioScore = 65;
  if (!soldCount) ratioScore = 5;

  return clampScore(depthScore * 0.6 + ratioScore * 0.4);
}

function scoreVelocity(input = {}, soldCount) {
  const marketData = input.marketData || {};
  const trendData = input.trendData || {};

  const daysToSell = pickFirstNumber(
    [marketData, trendData],
    ['averageDaysToSell', 'avgDaysToSell', 'daysToSell', 'medianDaysToSell'],
    0
  );

  if (!soldCount) return 5;
  if (!daysToSell) return soldCount >= 8 ? 65 : 42;
  if (daysToSell <= 7) return 100;
  if (daysToSell <= 14) return 86;
  if (daysToSell <= 30) return 68;
  if (daysToSell <= 60) return 42;
  return 20;
}

function scoreTrend(input = {}) {
  const trendData = input.trendData || {};
  const trendDirection = normalize(
    pickFirstValue([trendData], ['direction', 'trend', 'trendDirection'], '')
  );

  const trendScore = pickFirstNumber(
    [trendData],
    ['score', 'trendScore', 'momentumScore'],
    NaN
  );

  if (Number.isFinite(trendScore)) return clampScore(trendScore);

  if (['strong_up', 'up', 'rising', 'positive'].includes(trendDirection)) return 82;
  if (['flat', 'stable', 'neutral'].includes(trendDirection)) return 68;
  if (['down', 'declining', 'negative'].includes(trendDirection)) return 42;
  if (['strong_down', 'sharp_down', 'crashing'].includes(trendDirection)) return 20;

  return 50;
}

function getPriceStats(input = {}) {
  const marketData = input.marketData || {};
  const compData = input.compData || {};
  const soldPrices = asArray(input.soldSales).map(getSalePrice).filter((price) => price > 0);
  const averagePrice = pickFirstNumber(
    [marketData, compData],
    ['averagePrice', 'avgPrice', 'averageSoldPrice', 'avgSoldPrice'],
    getAverage(soldPrices)
  );
  const medianPrice = pickFirstNumber(
    [marketData, compData],
    ['medianPrice', 'medianSoldPrice'],
    getMedian(soldPrices) || averagePrice
  );
  const lowPrice = pickFirstNumber(
    [marketData, compData],
    ['lowPrice', 'minPrice', 'lowestSoldPrice'],
    soldPrices.length ? Math.min(...soldPrices) : 0
  );
  const highPrice = pickFirstNumber(
    [marketData, compData],
    ['highPrice', 'maxPrice', 'highestSoldPrice'],
    soldPrices.length ? Math.max(...soldPrices) : 0
  );
  const referencePrice = medianPrice || averagePrice;
  const standardDeviation = getStandardDeviation(soldPrices, averagePrice || referencePrice);
  const volatility = referencePrice > 0 ? standardDeviation / referencePrice : 0;
  const spread = referencePrice > 0 && highPrice > lowPrice ? (highPrice - lowPrice) / referencePrice : 0;

  return {
    soldPrices,
    averagePrice,
    medianPrice,
    lowPrice,
    highPrice,
    referencePrice,
    standardDeviation,
    volatility,
    spread
  };
}

function scoreVolatility(volatility, spread, soldCount) {
  if (soldCount < 3) return 30;

  let volatilityScore = 100;
  if (volatility > 0.75) volatilityScore = 18;
  else if (volatility > 0.5) volatilityScore = 35;
  else if (volatility > 0.35) volatilityScore = 55;
  else if (volatility > 0.2) volatilityScore = 76;

  let spreadScore = 100;
  if (spread > 1.2) spreadScore = 12;
  else if (spread > 0.85) spreadScore = 28;
  else if (spread > 0.6) spreadScore = 48;
  else if (spread > 0.4) spreadScore = 70;

  return clampScore(volatilityScore * 0.55 + spreadScore * 0.45);
}

function scoreCompStrength(input = {}, soldCount) {
  const compData = input.compData || {};
  const qualityData = input.qualityData || {};

  const strongCompCount = pickFirstNumber(
    [compData, qualityData],
    ['strongCompCount', 'highSimilarityCompCount', 'excellentCompCount'],
    0
  );
  const averageSimilarity = pickFirstNumber(
    [compData, qualityData],
    ['averageSimilarity', 'avgSimilarity', 'similarityScore'],
    0
  );
  const compConfidence = pickFirstNumber(
    [compData, qualityData],
    ['confidence', 'confidenceScore', 'compConfidence', 'qualityScore'],
    0
  );

  if (compConfidence > 0) {
    let score = compConfidence;
    if (strongCompCount >= 3) score += 10;
    if (averageSimilarity >= 90) score += 8;
    if (soldCount < 3) score -= 20;
    return clampScore(score);
  }

  if (strongCompCount >= 4 && averageSimilarity >= 88) return 95;
  if (strongCompCount >= 2 && averageSimilarity >= 82) return 82;
  if (soldCount >= 6) return 68;
  if (soldCount >= 3) return 48;
  if (soldCount >= 1) return 25;
  return 5;
}

function scorePricingReliability(input = {}, priceStats, soldCount) {
  const qualityData = input.qualityData || {};
  const compData = input.compData || {};
  const referenceValue = getMarketReference(input);
  const estimatedValue = getEstimatedValue(input);
  const explicitConfidence = pickFirstNumber(
    [qualityData, compData, input.marketData || {}],
    ['pricingConfidence', 'confidence', 'confidenceScore', 'qualityScore'],
    0
  );

  let score = explicitConfidence || 55;

  if (soldCount >= 8) score += 16;
  else if (soldCount >= 3) score += 4;
  else score -= 25;

  if (priceStats.spread > 0.85) score -= 28;
  else if (priceStats.spread > 0.6) score -= 16;
  else if (priceStats.spread > 0 && priceStats.spread <= 0.4) score += 10;

  if (priceStats.volatility > 0.5) score -= 18;
  else if (priceStats.volatility > 0 && priceStats.volatility <= 0.25) score += 8;

  if (referenceValue > 0 && estimatedValue > 0) {
    const valueRatio = estimatedValue / referenceValue;
    if (valueRatio > 2.5) score -= 35;
    else if (valueRatio > 1.75) score -= 20;
    else if (valueRatio >= 0.75 && valueRatio <= 1.35) score += 10;
  }

  return clampScore(score);
}

function scoreMarketDepth(soldCount, activeCount) {
  if (soldCount >= 15 && activeCount >= 3) return 95;
  if (soldCount >= 8 && activeCount >= 2) return 82;
  if (soldCount >= 5) return 68;
  if (soldCount >= 3) return 50;
  if (soldCount >= 1) return 25;
  return 5;
}

function getTrustLevel(score) {
  if (score >= 85) return 'excellent';
  if (score >= 72) return 'good';
  if (score >= 55) return 'fair';
  if (score >= 35) return 'weak';
  return 'unreliable';
}

function getRecommendation(score, soldCount, fallbackUsed, warnings, componentScores) {
  if (soldCount <= 0) return 'avoid';
  if (score < 40) return 'avoid';
  if (fallbackUsed && score < 82) return 'avoid';
  if (soldCount < 3 && score < 78) return 'avoid';
  if (soldCount === 2) return 'watch';
if (soldCount < 2) return 'avoid';
  if (warnings.length >= 5 && score < 75) return 'watch';
  if (componentScores.pricingReliability < 45 || componentScores.compStrength < 40) return 'watch';
  if (score >= 86 && soldCount >= 8 && componentScores.liquidity >= 75 && componentScores.pricingReliability >= 75) {
    return 'strong_buy';
  }
  if (score >= 72 && soldCount >= 4 && componentScores.liquidity >= 65 && componentScores.pricingReliability >= 65) {
    return 'buy';
  }
  if (score >= 50) return 'watch';
  return 'avoid';
}

function summarizeMarketIntelligence(data = {}) {
  const recommendation = data.recommendation || 'avoid';
  const trustLevel = data.trustLevel || 'unreliable';

  if (recommendation === 'strong_buy') {
    return 'Market is highly investable: demand, comp quality, liquidity, and pricing reliability are all strong.';
  }

  if (recommendation === 'buy') {
    return 'Market appears investable, with enough supporting evidence to consider buying at the right price.';
  }

  if (recommendation === 'watch') {
    return 'Market has some investable signals, but the evidence is mixed or incomplete and should be reviewed.';
  }

  if (trustLevel === 'unreliable') {
    return 'Market is not investable from the available data because trust is too low.';
  }

  return 'Market does not currently have enough reliable support for an investable recommendation.';
}

function evaluateMarketIntelligence(input = {}) {
  const soldCount = getSoldCompCount(input);
  const activeCount = getActiveCompCount(input);
  const sellThroughRate = activeCount > 0 ? soldCount / activeCount : soldCount > 0 ? 1 : 0;
  const fallbackUsed = isHeuristicFallback(input);
  const confidenceRaw = getMarketConfidence(input);
  const priceStats = getPriceStats(input);
  const referenceValue = getMarketReference(input);
  const estimatedValue = getEstimatedValue(input);
  const projectedRoi = getProjectedRoi(input);
  const evidenceSummary = buildEvidenceSummary(input);
  const comparableQuality = comparableQualityEngine.evaluateComparableQuality({
    listing: input.listing,
    comps: evidenceSummary.normalizedEvidence,
    marketContext: {
      medianSold: evidenceSummary.medianSold,
      weightedSoldAverage: evidenceSummary.weightedSoldAverage,
      referenceMarketValue: referenceValue,
      marketValue: estimatedValue,
      priceSpread: evidenceSummary.priceSpread,
      volatility: evidenceSummary.volatility
    }
  });
  const evidenceSufficiency = evidenceSufficiencyEngine.evaluateEvidenceSufficiency({
    listing: input.listing,
    evidenceSummary,
    comparableQuality,
    marketData: input.marketData,
    compData: input.compData
  });
  const valuationRange = valuationRangeEngine.evaluateValuationRange({
    listing: input.listing,
    evidenceSummary,
    comparableQuality,
    evidenceSufficiency,
    marketData: input.marketData,
    compData: input.compData,
    soldSales: input.soldSales,
    activeComps: input.activeComps,
    activeListings: input.activeListings
  });

  const liquidity = scoreLiquidity(soldCount, activeCount, sellThroughRate);
  const demand = clampScore(liquidity * 0.75 + scoreSoldDepth(soldCount) * 0.25);
  const velocity = scoreVelocity(input, soldCount);
  const trend = scoreTrend(input);
  const volatility = scoreVolatility(priceStats.volatility, priceStats.spread, soldCount);
  const pricingReliability = scorePricingReliability(input, priceStats, soldCount);
  const compStrength = scoreCompStrength(input, soldCount);
  const marketDepth = scoreMarketDepth(soldCount, activeCount);

  const componentScores = {
    liquidity,
    demand,
    velocity,
    trend,
    volatility,
    pricingReliability,
    compStrength,
    marketDepth
  };

  let intelligenceScore = clampScore(
    liquidity * 0.17 +
    demand * 0.13 +
    velocity * 0.1 +
    trend * 0.08 +
    volatility * 0.13 +
    pricingReliability * 0.19 +
    compStrength * 0.14 +
    marketDepth * 0.06
  );

  const warnings = [];
  const positives = [];
  const reasons = [];

  if (soldCount <= 0) {
    warnings.push('No sold comps are available.');
    reasons.push('Zero sold comps makes the market unproven.');
    intelligenceScore -= 28;
  } else if (soldCount < 3) {
    warnings.push(`Only ${soldCount} sold comp${soldCount === 1 ? '' : 's'} available.`);
    reasons.push('Very limited sold history reduces investability.');
    intelligenceScore -= 15;
  } else {
    positives.push(`Sold history is present (${soldCount} sold comps).`);
  }

  if (activeCount > 0) {
    positives.push(`Active market supply is visible (${activeCount} active comps).`);
  }

  if (sellThroughRate >= 0.5) {
    positives.push('Sold-to-active ratio indicates healthy demand.');
  } else if (activeCount > 0 && sellThroughRate < 0.25) {
    warnings.push('Sold-to-active ratio suggests weak demand.');
    reasons.push('Active supply is high relative to sold activity.');
  }

  if (fallbackUsed) {
    warnings.push('Market value uses heuristic fallback support.');
    reasons.push('Fallback valuation lowers trust because it is not sold-comp driven.');

    const fallbackHasStrongSupport =
      soldCount >= 8 &&
      liquidity >= 80 &&
      pricingReliability >= 80 &&
      compStrength >= 80 &&
      confidenceRaw >= 80;

    if (!fallbackHasStrongSupport) {
      intelligenceScore -= 30;
    } else {
      intelligenceScore -= 10;
      positives.push('Heuristic fallback is partially offset by strong independent signals.');
    }
  }

  if (confidenceRaw > 0 && confidenceRaw < 50) {
    warnings.push(`Market data confidence is low (${confidenceRaw}/100).`);
    intelligenceScore -= 10;
  } else if (confidenceRaw >= 75) {
    positives.push(`Market data confidence is strong (${confidenceRaw}/100).`);
  }

  if (priceStats.spread > 0.85) {
    warnings.push('Price spread is wide enough to reduce market reliability.');
    reasons.push('Comparable prices do not cluster tightly.');
  } else if (priceStats.spread > 0 && priceStats.spread <= 0.4) {
    positives.push('Comparable prices are reasonably tight.');
  }

  if (priceStats.volatility > 0.5) {
    warnings.push('Price volatility is high.');
  } else if (priceStats.volatility > 0 && priceStats.volatility <= 0.25) {
    positives.push('Price volatility is controlled.');
  }

  if (referenceValue > 0 && estimatedValue > 0) {
    const estimatedValueRatio = estimatedValue / referenceValue;

    if (estimatedValueRatio > 2.5) {
      warnings.push('Estimated value is not defensible against current market support.');
      reasons.push('Estimated value is more than 2.5x the supported market reference.');
      intelligenceScore -= 22;
    } else if (estimatedValueRatio >= 0.75 && estimatedValueRatio <= 1.35) {
      positives.push('Estimated value is supported by the market reference.');
    }
  } else if (!referenceValue) {
    warnings.push('No defensible market reference value was available.');
    reasons.push('Market value cannot be validated from available data.');
    intelligenceScore -= 15;
  }

  if (projectedRoi > 150) {
    const roiBelievable =
      soldCount >= 8 &&
      compStrength >= 80 &&
      pricingReliability >= 75 &&
      liquidity >= 75 &&
      !fallbackUsed;

    if (!roiBelievable) {
      warnings.push(`Projected ROI is unusually high (${projectedRoi}%) without enough support.`);
      reasons.push('High ROI can indicate bad comps or an inflated value estimate.');
      intelligenceScore -= 18;
    } else {
      positives.push('High ROI is backed by strong market evidence.');
    }
  }

  if (liquidity >= 75) positives.push('Liquidity is strong.');
  if (pricingReliability >= 75) positives.push('Pricing reliability is strong.');
  if (compStrength >= 75) positives.push('Comp strength is good.');
  if (marketDepth >= 75) positives.push('Market depth is healthy.');

  intelligenceScore = clampScore(intelligenceScore);

  const trustLevel = fallbackUsed && intelligenceScore < 82
    ? getTrustLevel(Math.min(intelligenceScore, 45))
    : getTrustLevel(intelligenceScore);

  const recommendation = getRecommendation(
    intelligenceScore,
    soldCount,
    fallbackUsed,
    warnings,
    componentScores
  );

  const confidenceScore = clampScore(
    (confidenceRaw || intelligenceScore) * 0.35 +
    compStrength * 0.25 +
    pricingReliability * 0.25 +
    marketDepth * 0.15
  );

  const result = {
    source: fallbackUsed ? 'market_intelligence_v2_heuristic_fallback' : 'market_intelligence_v2',
    intelligenceScore,
    trustLevel,
    recommendation,
    confidenceScore,
    liquidity,
    demand,
    velocity,
    trend,
    volatility,
    pricingReliability,
    compStrength,
    marketDepth,
    warnings: uniqueMessages(warnings),
    positives: uniqueMessages(positives),
    reasons: uniqueMessages(reasons),
    summary: '',
    componentScores,
    soldCompCount: soldCount,
    activeCompCount: activeCount,
    soldToActiveRatio: Number(sellThroughRate.toFixed(3)),
    priceVolatility: Number(priceStats.volatility.toFixed(3)),
    priceSpread: Number(priceStats.spread.toFixed(3)),
    referenceMarketValue: Number(referenceValue.toFixed(2)),
    estimatedValue: Number(estimatedValue.toFixed(2)),
    projectedRoi,
    heuristicFallbackUsed: fallbackUsed,
    evidenceSummary,
    comparableQuality,
    evidenceSufficiency,
    valuationRange
  };

  result.summary = summarizeMarketIntelligence(result);

  return result;
}

function getMarketConfidence(input = {}) {
  const marketData = input.marketData || {};
  const compData = input.compData || {};
  const qualityData = input.qualityData || {};
  const trendData = input.trendData || {};

  return pickFirstNumber(
    [input, marketData, compData, qualityData, trendData],
    ['marketConfidence', 'confidence', 'confidenceScore', 'marketConfidenceScore', 'qualityScore'],
    0
  );
}

module.exports = {
  evaluateMarketIntelligence,
  summarizeMarketIntelligence
};
