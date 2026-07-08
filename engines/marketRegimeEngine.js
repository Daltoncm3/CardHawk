'use strict';

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

function pickFirstNumber(sources, keys, fallback = 0) {
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;

    for (const key of keys) {
      if (source[key] !== undefined && source[key] !== null) {
        const value = toNumber(source[key], NaN);
        if (Number.isFinite(value)) return value;
      }
    }
  }

  return fallback;
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

function createDimension(status, score, explanation) {
  return {
    status,
    score: score === null ? null : clampScore(score),
    explanation
  };
}

function getStaleSoldCount(evidenceSummary = {}) {
  return asArray(evidenceSummary.normalizedEvidence).filter((item) => {
    return item &&
      item.evidenceType === 'true_sold' &&
      Number.isFinite(toNumber(item.ageDays, NaN)) &&
      toNumber(item.ageDays) > 180;
  }).length;
}

function getPriceDirection(input = {}) {
  const trendData = input.trendData || {};
  const direction = normalize(trendData.direction);
  const percentChange = pickFirstNumber([trendData], ['percentChange'], 0);
  const trendScore = pickFirstNumber([trendData], ['trendScore', 'score'], 50);

  if (direction === 'unknown' || (!direction && trendScore === 50 && percentChange === 0)) {
    return createDimension('unknown', 35, 'Trend data does not establish a current price direction.');
  }

  if (direction.includes('strong up') || percentChange >= 25 || trendScore >= 85) {
    return createDimension('sharp_rising', 92, 'Trend data indicates a sharp rising price environment.');
  }

  if (direction.includes('up') || percentChange >= 10 || trendScore >= 68) {
    return createDimension('rising', 76, 'Trend data indicates prices are rising.');
  }

  if (direction.includes('strong down') || percentChange <= -25 || trendScore <= 25) {
    return createDimension('sharp_falling', 12, 'Trend data indicates a sharp falling price environment.');
  }

  if (direction.includes('down') || percentChange <= -10 || trendScore <= 40) {
    return createDimension('falling', 28, 'Trend data indicates prices are falling.');
  }

  return createDimension('stable', 68, 'Trend data indicates prices are broadly stable.');
}

function getSalesMomentum(input = {}) {
  const salesVelocityData = input.salesVelocityData || {};
  const trendData = input.trendData || {};
  const salesTrend = normalize(pickFirstValue([salesVelocityData], ['salesTrend'], ''));
  const soldLast7Days = pickFirstNumber([salesVelocityData], ['soldLast7Days'], 0);
  const soldLast30Days = pickFirstNumber([salesVelocityData], ['soldLast30Days'], 0);
  const soldLast90Days = pickFirstNumber([salesVelocityData], ['soldLast90Days'], 0);
  const salesVelocityScore = pickFirstNumber([salesVelocityData, trendData], ['salesVelocityScore', 'velocityScore'], 0);

  if (!soldLast7Days && !soldLast30Days && !soldLast90Days && !salesVelocityScore) {
    return createDimension('unknown', 25, 'Sales velocity data is unavailable, so sales momentum is unknown.');
  }

  if (salesTrend === 'rising' || (soldLast7Days >= 3 && soldLast30Days >= 8) || salesVelocityScore >= 80) {
    return createDimension('accelerating', 88, 'Sales velocity indicates accelerating market activity.');
  }

  if (salesTrend === 'falling' || (soldLast90Days >= 5 && soldLast30Days === 0)) {
    return createDimension('decelerating', 26, 'Sales velocity indicates market activity is slowing.');
  }

  if (soldLast30Days > 0 || salesVelocityScore >= 45) {
    return createDimension('steady', 66, 'Sales velocity indicates ongoing market activity.');
  }

  return createDimension('quiet', 35, 'Sales velocity indicates limited recent market activity.');
}

function getLiquidityState(input = {}) {
  const liquidityEvidence = input.liquidityEvidence || input.liquidity || {};
  const evidenceSummary = input.evidenceSummary || {};
  const salesVelocityData = input.salesVelocityData || {};
  const level = normalize(pickFirstValue([liquidityEvidence], ['liquidityLevel', 'level', 'liquidityRating'], ''));
  const score = pickFirstNumber(
    [liquidityEvidence, salesVelocityData],
    ['liquidityScore', 'score', 'salesVelocityScore'],
    0
  );
  const trueSoldCount = pickFirstNumber([evidenceSummary, liquidityEvidence], ['trueSoldCount', 'soldCount'], 0);

  if (!level && !score && !trueSoldCount) {
    return createDimension('unknown', 25, 'Liquidity evidence is unavailable.');
  }

  if (['excellent', 'strong', 'good'].includes(level) || score >= 70 || trueSoldCount >= 8) {
    return createDimension('healthy', 84, 'Liquidity evidence indicates healthy market exitability.');
  }

  if (['thin', 'poor', 'illiquid'].includes(level) || score < 35 || trueSoldCount < 3) {
    return createDimension('thin', 25, 'Liquidity evidence indicates a thin or difficult resale market.');
  }

  return createDimension('normal', 60, 'Liquidity evidence indicates normal but review-worthy exitability.');
}

function getVolatilityState(input = {}) {
  const evidenceSummary = input.evidenceSummary || {};
  const salesVelocityData = input.salesVelocityData || {};
  const outlierAnalysis = input.outlierAnalysis || input.outlier || {};
  const priceSpread = pickFirstNumber([evidenceSummary], ['priceSpread'], 0);
  const volatility = pickFirstNumber(
    [evidenceSummary, salesVelocityData.details || {}, outlierAnalysis],
    ['volatility', 'priceVolatility', 'priceSpreadPercent'],
    0
  );
  const outlierRate = pickFirstNumber([outlierAnalysis], ['outlierRate'], 0);
  const extremeOutlierCount = pickFirstNumber([outlierAnalysis], ['extremeOutlierCount'], 0);

  if (!priceSpread && !volatility && !outlierRate && !extremeOutlierCount) {
    return createDimension('unknown', 45, 'Volatility evidence is limited or unavailable.');
  }

  if (priceSpread > 0.85 || volatility > 0.5 || outlierRate > 0.3 || extremeOutlierCount > 0) {
    return createDimension('high', 18, 'Price spread, volatility, or outlier evidence indicates a volatile market.');
  }

  if (priceSpread > 0.45 || volatility > 0.25 || outlierRate > 0.15) {
    return createDimension('moderate', 48, 'Market prices show moderate volatility.');
  }

  return createDimension('controlled', 82, 'Market prices appear reasonably controlled.');
}

function getSupplyPressure(input = {}) {
  const evidenceSummary = input.evidenceSummary || {};
  const salesVelocityData = input.salesVelocityData || {};
  const liquidityEvidence = input.liquidityEvidence || input.liquidity || {};
  const activeCount = pickFirstNumber([evidenceSummary, liquidityEvidence], ['activeCount'], 0);
  const trueSoldCount = pickFirstNumber([evidenceSummary, liquidityEvidence], ['trueSoldCount', 'soldCount'], 0);
  const inventoryPressure = normalize(pickFirstValue([salesVelocityData], ['inventoryPressure'], ''));

  if (!activeCount && !trueSoldCount && !inventoryPressure) {
    return createDimension('unknown', 45, 'Active supply pressure could not be established.');
  }

  if (inventoryPressure === 'high' || (activeCount >= 10 && trueSoldCount <= 2)) {
    return createDimension('high', 22, 'Active supply appears high relative to sold activity.');
  }

  if (inventoryPressure === 'elevated' || (activeCount >= 5 && trueSoldCount <= 3)) {
    return createDimension('elevated', 42, 'Active supply appears elevated relative to sold activity.');
  }

  if (inventoryPressure === 'low' || (trueSoldCount > 0 && activeCount <= trueSoldCount)) {
    return createDimension('low', 78, 'Sold activity appears healthy relative to active supply.');
  }

  return createDimension('normal', 62, 'Active supply pressure appears normal.');
}

function getEvidenceDepth(input = {}) {
  const evidenceSummary = input.evidenceSummary || {};
  const evidenceSufficiency = input.evidenceSufficiency || {};
  const trueSoldCount = pickFirstNumber([evidenceSummary], ['trueSoldCount'], 0);
  const level = normalize(pickFirstValue([evidenceSufficiency], ['sufficiencyLevel'], ''));
  const activeOnly = evidenceSummary.activeOnlyFlag === true;
  const fallbackOnly = evidenceSummary.fallbackOnlyFlag === true;

  if (activeOnly || fallbackOnly) {
    return createDimension('unreliable', 10, 'Evidence is active-only or fallback-only, so market regime confidence is limited.');
  }

  if (['strong', 'adequate'].includes(level) || trueSoldCount >= 5) {
    return createDimension('adequate', 82, 'Evidence depth is adequate for regime interpretation.');
  }

  if (trueSoldCount >= 3 || level === 'limited') {
    return createDimension('limited', 48, 'Evidence depth is limited but usable for cautious regime interpretation.');
  }

  if (trueSoldCount > 0 || level === 'insufficient') {
    return createDimension('thin', 25, 'Evidence depth is thin and regime interpretation is uncertain.');
  }

  return createDimension('unknown', 12, 'No true sold evidence is available for regime interpretation.');
}

function getHypeRisk(input = {}) {
  const trendData = input.trendData || {};
  const salesVelocityData = input.salesVelocityData || {};
  const details = salesVelocityData.details || {};
  const seasonalSpike = details.seasonalSpike === true || salesVelocityData.seasonalSpike === true;
  const earlyMarket = details.earlyMarket === true || salesVelocityData.earlyMarket === true;
  const percentChange = pickFirstNumber([trendData], ['percentChange'], 0);
  const soldLast7Days = pickFirstNumber([salesVelocityData], ['soldLast7Days'], 0);
  const soldLast30Days = pickFirstNumber([salesVelocityData], ['soldLast30Days'], 0);

  if (seasonalSpike || earlyMarket) {
    return createDimension('high', 20, 'Sales velocity flagged seasonal spike or early-market behavior.');
  }

  if (percentChange >= 25 && soldLast7Days >= 2 && soldLast30Days >= 5) {
    return createDimension('elevated', 38, 'Sharp price movement and recent sales activity suggest elevated hype risk.');
  }

  return createDimension('low', 78, 'No clear hype-driven pattern is present in the available inputs.');
}

function getStaleRisk(input = {}) {
  const evidenceSummary = input.evidenceSummary || {};
  const salesVelocityData = input.salesVelocityData || {};
  const trueSoldCount = pickFirstNumber([evidenceSummary], ['trueSoldCount'], 0);
  const staleSoldCount = getStaleSoldCount(evidenceSummary);
  const soldLast30Days = pickFirstNumber([salesVelocityData], ['soldLast30Days'], 0);
  const soldLast90Days = pickFirstNumber([salesVelocityData], ['soldLast90Days'], 0);

  if (!trueSoldCount && !soldLast90Days) {
    return createDimension('unknown', 20, 'No recent or historical sold activity is available to assess stale-market risk.');
  }

  if (trueSoldCount > 0 && staleSoldCount >= trueSoldCount && soldLast30Days === 0) {
    return createDimension('high', 18, 'Sold evidence appears stale and recent sales activity is absent.');
  }

  if (soldLast90Days > 0 && soldLast30Days === 0) {
    return createDimension('elevated', 38, 'Sales activity exists historically but has not appeared in the last 30 days.');
  }

  return createDimension('low', 76, 'Recent sales activity or fresh evidence reduces stale-market risk.');
}

function buildDimensions(input = {}) {
  return {
    priceDirection: getPriceDirection(input),
    salesMomentum: getSalesMomentum(input),
    liquidityState: getLiquidityState(input),
    volatilityState: getVolatilityState(input),
    supplyPressure: getSupplyPressure(input),
    evidenceDepth: getEvidenceDepth(input),
    hypeRisk: getHypeRisk(input),
    staleRisk: getStaleRisk(input)
  };
}

function addRegime(regimes, regime, reason) {
  if (!regimes.some((item) => item.regime === regime)) {
    regimes.push({ regime, reason });
  }
}

function classifyMarketRegime(input = {}) {
  const dimensions = input.dimensions || buildDimensions(input);
  const regimes = [];

  if (dimensions.evidenceDepth.status === 'unknown' || dimensions.evidenceDepth.status === 'unreliable') {
    addRegime(regimes, 'unknown', dimensions.evidenceDepth.explanation);
  }

  if (dimensions.staleRisk.status === 'high') {
    addRegime(regimes, 'stale', dimensions.staleRisk.explanation);
  }

  if (dimensions.evidenceDepth.status === 'thin' || dimensions.liquidityState.status === 'thin') {
    addRegime(regimes, 'thin', 'Evidence depth or liquidity indicates a thin market.');
  }

  if (dimensions.volatilityState.status === 'high') {
    addRegime(regimes, 'volatile', dimensions.volatilityState.explanation);
  }

  if (dimensions.hypeRisk.status === 'high' || dimensions.hypeRisk.status === 'elevated') {
    addRegime(regimes, 'hype_driven', dimensions.hypeRisk.explanation);
  }

  if (
    (dimensions.priceDirection.status === 'sharp_rising' && dimensions.volatilityState.status !== 'controlled') ||
    (dimensions.priceDirection.status === 'sharp_rising' && dimensions.hypeRisk.status !== 'low')
  ) {
    addRegime(regimes, 'overheated', 'Sharp rising price direction combined with volatility or hype risk suggests an overheated market.');
  }

  if (
    dimensions.priceDirection.status === 'falling' ||
    dimensions.priceDirection.status === 'sharp_falling'
  ) {
    addRegime(regimes, 'falling', dimensions.priceDirection.explanation);
  }

  if (
    dimensions.salesMomentum.status === 'decelerating' &&
    !regimes.some((item) => item.regime === 'falling')
  ) {
    addRegime(regimes, 'cooling', dimensions.salesMomentum.explanation);
  }

  if (
    (dimensions.priceDirection.status === 'rising' || dimensions.priceDirection.status === 'sharp_rising') &&
    !regimes.some((item) => ['overheated', 'hype_driven'].includes(item.regime))
  ) {
    addRegime(regimes, 'rising', dimensions.priceDirection.explanation);
  }

  if (
    dimensions.priceDirection.status === 'stable' &&
    dimensions.salesMomentum.status === 'steady' &&
    dimensions.volatilityState.status !== 'high' &&
    dimensions.evidenceDepth.status !== 'unknown'
  ) {
    addRegime(regimes, 'stable', 'Trend, sales momentum, and volatility indicate a stable market environment.');
  }

  if (!regimes.length) {
    addRegime(regimes, 'unknown', 'Available inputs do not clearly identify a market regime.');
  }

  const priority = [
    'unknown',
    'overheated',
    'hype_driven',
    'stale',
    'falling',
    'cooling',
    'volatile',
    'thin',
    'rising',
    'stable'
  ];

  const sorted = regimes.sort((a, b) => {
    return priority.indexOf(a.regime) - priority.indexOf(b.regime);
  });

  return {
    primaryRegime: sorted[0].regime,
    secondaryRegimes: sorted.slice(1).map((item) => item.regime),
    regimes: sorted.map((item) => item.regime),
    reasons: sorted.map((item) => item.reason)
  };
}

function getRegimeScore(dimensions) {
  const scores = [
    dimensions.priceDirection.score,
    dimensions.salesMomentum.score,
    dimensions.liquidityState.score,
    dimensions.volatilityState.score,
    dimensions.supplyPressure.score,
    dimensions.evidenceDepth.score,
    dimensions.hypeRisk.score,
    dimensions.staleRisk.score
  ].filter((score) => Number.isFinite(score));

  if (!scores.length) return 0;
  return clampScore(scores.reduce((sum, score) => sum + score, 0) / scores.length);
}

function getConfidence(dimensions, evidenceSufficiency = {}, trendData = {}, salesVelocityData = {}) {
  const knownCount = Object.values(dimensions)
    .filter((dimension) => dimension.status !== 'unknown')
    .length;
  const evidenceScore = pickFirstNumber(
    [evidenceSufficiency],
    ['evidenceSufficiencyScore'],
    dimensions.evidenceDepth.score || 0
  );
  const trendConfidence = pickFirstNumber([trendData], ['confidence'], 0);
  const velocityConfidence = pickFirstNumber([salesVelocityData], ['confidence'], 0);

  let confidence = knownCount * 7;
  confidence += Math.min(30, evidenceScore * 0.3);
  confidence += Math.min(18, trendConfidence * 0.18);
  confidence += Math.min(18, velocityConfidence * 0.18);

  if (dimensions.evidenceDepth.status === 'unknown') confidence = Math.min(confidence, 35);
  if (dimensions.evidenceDepth.status === 'unreliable') confidence = Math.min(confidence, 28);

  return clampScore(confidence);
}

function summarizeMarketRegime(data = {}) {
  const primary = data.primaryRegime || 'unknown';

  if (primary === 'overheated') return 'Market regime appears overheated, with sharp upside signals that need careful review.';
  if (primary === 'hype_driven') return 'Market regime appears hype-driven or temporarily distorted.';
  if (primary === 'rising') return 'Market regime appears rising based on current trend and activity evidence.';
  if (primary === 'falling') return 'Market regime appears falling based on current trend evidence.';
  if (primary === 'cooling') return 'Market regime appears cooling as sales momentum slows.';
  if (primary === 'volatile') return 'Market regime appears volatile, with unstable price behavior.';
  if (primary === 'thin') return 'Market regime appears thin, with limited liquidity or evidence depth.';
  if (primary === 'stale') return 'Market regime appears stale, with old sold evidence and little recent activity.';
  if (primary === 'stable') return 'Market regime appears stable based on the available intelligence signals.';
  return 'Market regime is unknown from the available intelligence signals.';
}

function evaluateMarketRegime(input = {}) {
  const dimensions = buildDimensions(input);
  const classification = classifyMarketRegime({ ...input, dimensions });
  const warnings = [];
  const positives = [];

  for (const [name, dimension] of Object.entries(dimensions)) {
    if (['high', 'elevated', 'thin', 'unreliable', 'unknown', 'sharp_falling', 'falling', 'decelerating'].includes(dimension.status)) {
      warnings.push(`${name}: ${dimension.explanation}`);
    }

    if (['healthy', 'adequate', 'controlled', 'low', 'stable', 'steady', 'rising'].includes(dimension.status)) {
      positives.push(`${name}: ${dimension.explanation}`);
    }
  }

  const result = {
    source: 'market_regime_engine',
    version: '1.2',
    primaryRegime: classification.primaryRegime,
    secondaryRegimes: classification.secondaryRegimes,
    regimes: classification.regimes,
    regimeScore: getRegimeScore(dimensions),
    confidence: getConfidence(
      dimensions,
      input.evidenceSufficiency || {},
      input.trendData || {},
      input.salesVelocityData || {}
    ),
    dimensions,
    warnings: uniqueMessages(warnings),
    positives: uniqueMessages(positives),
    reasons: uniqueMessages(classification.reasons),
    summary: ''
  };

  result.summary = summarizeMarketRegime(result);
  return result;
}

module.exports = {
  evaluateMarketRegime,
  classifyMarketRegime,
  summarizeMarketRegime
};
