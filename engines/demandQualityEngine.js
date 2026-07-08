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

function getPrice(item = {}) {
  return toNumber(
    item.price ??
      item.soldPrice ??
      item.salePrice ??
      item.amount ??
      item.totalPrice ??
      item.value,
    0
  );
}

function getSaleDate(item = {}) {
  return item.soldAt || item.dateSold || item.saleDate || item.date || item.endedAt || item.createdAt || null;
}

function getSeller(item = {}) {
  return normalize(item.seller || item.sellerName || item.sellerId || item.vendor || item.account);
}

function getSource(item = {}) {
  return normalize(item.source || item.marketplace || item.platform || item.channel);
}

function getRegimeNames(marketRegime = {}) {
  return [
    marketRegime.primaryRegime,
    ...asArray(marketRegime.secondaryRegimes),
    ...asArray(marketRegime.regimes)
  ].map(normalize).filter(Boolean);
}

function getSoldEvidence(input = {}) {
  const evidenceSummary = input.evidenceSummary || {};
  const normalizedEvidence = asArray(evidenceSummary.normalizedEvidence)
    .filter((item) => item && item.evidenceType === 'true_sold' && getPrice(item) > 0)
    .map((item) => ({ ...item, price: getPrice(item) }));

  if (normalizedEvidence.length) return normalizedEvidence;

  return asArray(input.soldSales)
    .map((item) => ({ ...item, price: getPrice(item), evidenceType: 'true_sold' }))
    .filter((item) => item.price > 0);
}

function getSoldCount(input = {}, soldEvidence = []) {
  return pickFirstNumber(
    [
      input.evidenceSummary || {},
      (input.salesVelocityData || {}).details || {},
      input.salesVelocityData || {}
    ],
    ['trueSoldCount', 'soldCount'],
    soldEvidence.length
  );
}

function getSoldDepth(input = {}, soldEvidence = []) {
  const trueSoldCount = getSoldCount(input, soldEvidence);

  if (trueSoldCount >= 10) {
    return createDimension('deep', 92, 'True sold evidence is deep enough to support durable demand interpretation.');
  }

  if (trueSoldCount >= 5) {
    return createDimension('adequate', 76, 'True sold evidence is adequate for demand interpretation.');
  }

  if (trueSoldCount >= 3) {
    return createDimension('limited', 54, 'True sold evidence exists, but the demand sample is still limited.');
  }

  if (trueSoldCount > 0) {
    return createDimension('thin', 32, 'Only one or two true sales are available, so demand may not be repeatable.');
  }

  return createDimension('unknown', 12, 'No true sold evidence is available to establish demand quality.');
}

function getRepeatSalesPattern(input = {}) {
  const salesVelocityData = input.salesVelocityData || {};
  const demandStrength = normalize(pickFirstValue([salesVelocityData], ['demandStrength'], ''));
  const salesTrend = normalize(pickFirstValue([salesVelocityData], ['salesTrend'], ''));
  const soldLast7Days = pickFirstNumber([salesVelocityData], ['soldLast7Days'], 0);
  const soldLast30Days = pickFirstNumber([salesVelocityData], ['soldLast30Days'], 0);
  const soldLast90Days = pickFirstNumber([salesVelocityData], ['soldLast90Days'], 0);
  const velocityScore = pickFirstNumber([salesVelocityData], ['salesVelocityScore'], 0);

  if (!demandStrength && !salesTrend && !soldLast7Days && !soldLast30Days && !soldLast90Days && !velocityScore) {
    return createDimension('unknown', 20, 'Sales velocity signals are missing, so repeat demand is unknown.');
  }

  if (
    ['very_strong', 'strong'].includes(demandStrength) ||
    (soldLast30Days >= 5 && soldLast90Days >= 8) ||
    velocityScore >= 75
  ) {
    return createDimension('repeatable', 88, 'Sales velocity indicates repeat buying activity rather than isolated demand.');
  }

  if (salesTrend === 'falling' || (soldLast90Days >= 4 && soldLast30Days === 0)) {
    return createDimension('weakening', 30, 'Sales velocity indicates repeat demand is weakening.');
  }

  if (soldLast30Days > 0 || soldLast90Days >= 3 || velocityScore >= 45 || demandStrength === 'moderate') {
    return createDimension('sporadic', 56, 'Demand appears real, but sales activity is not consistently repeatable yet.');
  }

  if (soldLast90Days > 0 || soldLast30Days > 0 || soldLast7Days > 0) {
    return createDimension('one_off', 28, 'Demand is based on isolated recent sale activity.');
  }

  return createDimension('unknown', 20, 'Sales velocity does not establish repeat demand.');
}

function getBuyerSellerBreadth(soldEvidence = []) {
  const sellers = new Set(soldEvidence.map(getSeller).filter(Boolean));
  const sources = new Set(soldEvidence.map(getSource).filter(Boolean));
  const sellerKnown = sellers.size > 0;
  const sourceKnown = sources.size > 0;

  if (!soldEvidence.length || (!sellerKnown && !sourceKnown)) {
    return createDimension('unknown', 35, 'Seller and marketplace breadth are unavailable.');
  }

  if (sellers.size >= 4 || (sellers.size >= 3 && sources.size >= 2)) {
    return createDimension('broad', 86, 'Sold evidence spans multiple sellers or marketplaces, suggesting broad demand.');
  }

  if (sellers.size >= 2 || sources.size >= 2) {
    return createDimension('moderate', 62, 'Sold evidence shows some breadth, but demand is not yet broadly distributed.');
  }

  if (soldEvidence.length >= 3 && sellers.size === 1) {
    return createDimension('concentrated', 26, 'Sold evidence is concentrated with one seller, so broad buyer demand is unproven.');
  }

  return createDimension('narrow', 40, 'Sold evidence breadth is narrow.');
}

function getTimeDistribution(input = {}, soldEvidence = []) {
  const salesVelocityData = input.salesVelocityData || {};
  const details = salesVelocityData.details || {};
  const seasonalSpike = details.seasonalSpike === true || salesVelocityData.seasonalSpike === true;
  const soldLast7Days = pickFirstNumber([salesVelocityData], ['soldLast7Days'], 0);
  const soldLast30Days = pickFirstNumber([salesVelocityData], ['soldLast30Days'], 0);
  const soldLast90Days = pickFirstNumber([salesVelocityData], ['soldLast90Days'], 0);
  const salesTrend = normalize(pickFirstValue([salesVelocityData], ['salesTrend'], ''));
  const datedSales = soldEvidence.filter((item) => getSaleDate(item));

  if (seasonalSpike) {
    return createDimension('clustered', 24, 'Sales velocity flagged a seasonal or event-driven spike, so demand may be clustered.');
  }

  if (salesTrend === 'falling' || (soldLast90Days >= 4 && soldLast30Days === 0)) {
    return createDimension('weakening', 30, 'Recent sales are absent or slowing compared with earlier activity.');
  }

  if (soldLast7Days >= 3 && soldLast30Days >= 5 && soldLast90Days <= soldLast30Days + 1) {
    return createDimension('burst', 36, 'Sales are heavily concentrated in a recent burst rather than spread over time.');
  }

  if ((soldLast30Days >= 3 && soldLast90Days >= soldLast30Days) || datedSales.length >= 5) {
    return createDimension('distributed', 78, 'Sales activity appears distributed enough to support repeat demand.');
  }

  if (soldLast90Days > 0 || soldLast30Days > 0 || datedSales.length > 0) {
    return createDimension('limited', 48, 'Some time-distribution evidence exists, but it is limited.');
  }

  return createDimension('unknown', 25, 'Sale timing data is unavailable.');
}

function getPriceParticipation(input = {}) {
  const evidenceSummary = input.evidenceSummary || {};
  const salesVelocityData = input.salesVelocityData || {};
  const details = salesVelocityData.details || {};
  const priceSpread = pickFirstNumber([evidenceSummary], ['priceSpread'], 0);
  const volatility = pickFirstNumber([evidenceSummary, details], ['volatility', 'priceVolatility'], 0);

  if (!priceSpread && !volatility) {
    return createDimension('unknown', 40, 'Price participation quality is unknown because spread and volatility are unavailable.');
  }

  if (priceSpread > 0.85 || volatility > 0.5) {
    return createDimension('noisy', 24, 'Wide price spread or high volatility suggests uneven buyer participation.');
  }

  if (priceSpread > 0.45 || volatility > 0.25) {
    return createDimension('mixed', 50, 'Buyer participation exists, but prices are uneven.');
  }

  return createDimension('controlled', 80, 'Sold prices appear controlled enough to suggest consistent buyer participation.');
}

function getHypeDistortion(input = {}) {
  const salesVelocityData = input.salesVelocityData || {};
  const details = salesVelocityData.details || {};
  const trendData = input.trendData || {};
  const regimes = getRegimeNames(input.marketRegime || {});
  const seasonalSpike = details.seasonalSpike === true || salesVelocityData.seasonalSpike === true;
  const earlyMarket = details.earlyMarket === true || salesVelocityData.earlyMarket === true;
  const percentChange = pickFirstNumber([trendData], ['percentChange'], 0);

  if (regimes.includes('hype_driven') || regimes.includes('overheated') || seasonalSpike || earlyMarket) {
    return createDimension('high', 20, 'Regime or sales velocity signals indicate hype, early-market, or event-driven distortion.');
  }

  if (percentChange >= 25 || regimes.includes('volatile')) {
    return createDimension('elevated', 42, 'Sharp trend or volatile regime signals create elevated hype risk.');
  }

  if (regimes.length || percentChange !== 0) {
    return createDimension('low', 78, 'Available regime and trend signals do not indicate hype-driven demand.');
  }

  return createDimension('unknown', 45, 'Hype distortion cannot be assessed from the available signals.');
}

function getStaleDemandRisk(input = {}, soldEvidence = []) {
  const salesVelocityData = input.salesVelocityData || {};
  const regimes = getRegimeNames(input.marketRegime || {});
  const soldLast30Days = pickFirstNumber([salesVelocityData], ['soldLast30Days'], 0);
  const soldLast90Days = pickFirstNumber([salesVelocityData], ['soldLast90Days'], 0);
  const staleSoldCount = soldEvidence.filter((item) => {
    const ageDays = toNumber(item.ageDays, NaN);
    return Number.isFinite(ageDays) && ageDays > 180;
  }).length;

  if (regimes.includes('stale')) {
    return createDimension('high', 18, 'Market regime signals classify demand as stale.');
  }

  if (soldLast90Days > 0 && soldLast30Days === 0) {
    return createDimension('elevated', 34, 'Sales exist historically, but recent activity is missing.');
  }

  if (soldEvidence.length > 0 && staleSoldCount >= soldEvidence.length && soldLast30Days === 0) {
    return createDimension('high', 18, 'All sold evidence appears stale and recent sales activity is absent.');
  }

  if (soldLast30Days > 0 || soldEvidence.some((item) => toNumber(item.ageDays, 9999) <= 45)) {
    return createDimension('low', 78, 'Recent sold activity reduces stale-demand risk.');
  }

  return createDimension('unknown', 35, 'Stale-demand risk cannot be established from the available evidence.');
}

function getDuplicateNoise(input = {}) {
  const salesVelocityData = input.salesVelocityData || {};
  const details = salesVelocityData.details || {};
  const duplicateSalesExcluded = pickFirstNumber([details, salesVelocityData], ['duplicateSalesExcluded'], NaN);

  if (!Number.isFinite(duplicateSalesExcluded)) {
    return createDimension('unknown', 50, 'Duplicate-sale noise was not reported by Sales Velocity.');
  }

  if (duplicateSalesExcluded >= 4) {
    return createDimension('high', 24, 'Sales Velocity excluded multiple duplicate sales, increasing noise risk.');
  }

  if (duplicateSalesExcluded > 0) {
    return createDimension('moderate', 56, 'Sales Velocity excluded some duplicate sales, creating moderate noise risk.');
  }

  return createDimension('low', 82, 'Sales Velocity did not report duplicate-sale noise.');
}

function buildDimensions(input = {}) {
  const soldEvidence = getSoldEvidence(input);

  return {
    soldDepth: getSoldDepth(input, soldEvidence),
    repeatSalesPattern: getRepeatSalesPattern(input),
    buyerSellerBreadth: getBuyerSellerBreadth(soldEvidence),
    timeDistribution: getTimeDistribution(input, soldEvidence),
    priceParticipation: getPriceParticipation(input),
    hypeDistortion: getHypeDistortion(input),
    staleDemandRisk: getStaleDemandRisk(input, soldEvidence),
    duplicateNoise: getDuplicateNoise(input)
  };
}

function scoreDemandQuality(input = {}) {
  const dimensions = input.dimensions || buildDimensions(input);
  const weights = {
    soldDepth: 0.18,
    repeatSalesPattern: 0.2,
    buyerSellerBreadth: 0.16,
    timeDistribution: 0.14,
    priceParticipation: 0.1,
    hypeDistortion: 0.1,
    staleDemandRisk: 0.08,
    duplicateNoise: 0.04
  };

  let weightedScore = 0;
  let weightTotal = 0;

  for (const [name, weight] of Object.entries(weights)) {
    const score = dimensions[name] && dimensions[name].score;
    if (!Number.isFinite(score)) continue;
    weightedScore += score * weight;
    weightTotal += weight;
  }

  let score = weightTotal > 0 ? weightedScore / weightTotal : 0;

  if (dimensions.soldDepth.status === 'unknown') score = Math.min(score, 20);
  if (dimensions.soldDepth.status === 'thin') score = Math.min(score, 42);
  if (dimensions.repeatSalesPattern.status === 'one_off') score = Math.min(score, 38);
  if (dimensions.hypeDistortion.status === 'high') score = Math.min(score, 64);
  if (dimensions.staleDemandRisk.status === 'high') score = Math.min(score, 45);
  if (dimensions.buyerSellerBreadth.status === 'concentrated') score = Math.min(score, 62);

  return clampScore(score);
}

function getDemandQualityLevel(score, dimensions) {
  if (dimensions.soldDepth.status === 'unknown') return 'unproven';
  if (score >= 85) return 'excellent';
  if (score >= 70) return 'strong';
  if (score >= 50) return 'real_but_thin';
  if (score >= 30) return 'fragile';
  return 'unproven';
}

function getDurability(dimensions) {
  if (
    dimensions.staleDemandRisk.status === 'high' ||
    dimensions.hypeDistortion.status === 'high' ||
    dimensions.repeatSalesPattern.status === 'weakening' ||
    dimensions.timeDistribution.status === 'weakening'
  ) {
    return 'fragile';
  }

  if (dimensions.soldDepth.status === 'unknown' || dimensions.repeatSalesPattern.status === 'unknown') {
    return 'unknown';
  }

  if (
    ['deep', 'adequate'].includes(dimensions.soldDepth.status) &&
    dimensions.repeatSalesPattern.status === 'repeatable' &&
    ['distributed', 'limited'].includes(dimensions.timeDistribution.status)
  ) {
    return 'durable';
  }

  if (['thin', 'limited'].includes(dimensions.soldDepth.status) || dimensions.repeatSalesPattern.status === 'sporadic') {
    return 'developing';
  }

  return 'unknown';
}

function getBreadth(dimensions) {
  const status = dimensions.buyerSellerBreadth.status;
  if (status === 'broad') return 'broad';
  if (status === 'moderate') return 'moderate';
  if (['narrow', 'concentrated'].includes(status)) return 'narrow';
  return 'unknown';
}

function getRepeatability(dimensions) {
  const status = dimensions.repeatSalesPattern.status;
  if (status === 'repeatable') return 'repeatable';
  if (['sporadic', 'weakening'].includes(status)) return 'sporadic';
  if (status === 'one_off') return 'one_off';
  return 'unknown';
}

function summarizeDemandQuality(data = {}) {
  const level = data.demandQualityLevel || 'unproven';

  if (level === 'excellent') return 'Demand quality appears excellent: broad, repeatable, and durable.';
  if (level === 'strong') return 'Demand quality appears strong, with repeat buying activity and usable breadth.';
  if (level === 'real_but_thin') return 'Demand appears real but still thin, so durability should be reviewed.';
  if (level === 'fragile') return 'Demand quality appears fragile because one or more demand signals are weak or distorted.';
  return 'Demand quality is unproven from the available intelligence signals.';
}

function evaluateDemandQuality(input = {}) {
  const dimensions = buildDimensions(input);
  const demandQualityScore = scoreDemandQuality({ dimensions });
  const demandQualityLevel = getDemandQualityLevel(demandQualityScore, dimensions);
  const warnings = [];
  const positives = [];

  for (const [name, dimension] of Object.entries(dimensions)) {
    if (['unknown', 'thin', 'limited', 'weakening', 'one_off', 'concentrated', 'narrow', 'clustered', 'burst', 'noisy', 'high', 'elevated'].includes(dimension.status)) {
      warnings.push(`${name}: ${dimension.explanation}`);
    }

    if (['deep', 'adequate', 'repeatable', 'broad', 'moderate', 'distributed', 'controlled', 'low'].includes(dimension.status)) {
      positives.push(`${name}: ${dimension.explanation}`);
    }
  }

  const result = {
    source: 'demand_quality_engine',
    version: '1.2',
    demandQualityScore,
    demandQualityLevel,
    durability: getDurability(dimensions),
    breadth: getBreadth(dimensions),
    repeatability: getRepeatability(dimensions),
    dimensions,
    warnings: uniqueMessages(warnings),
    positives: uniqueMessages(positives),
    summary: ''
  };

  result.summary = summarizeDemandQuality(result);
  return result;
}

module.exports = {
  evaluateDemandQuality,
  scoreDemandQuality,
  summarizeDemandQuality
};
