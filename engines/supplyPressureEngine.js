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

function roundMetric(value, digits = 3) {
  const multiplier = 10 ** digits;
  return Math.round(toNumber(value, 0) * multiplier) / multiplier;
}

function roundMoney(value) {
  return Math.round(toNumber(value, 0) * 100) / 100;
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
    item.askingPrice ??
      item.askPrice ??
      item.price ??
      item.listPrice ??
      item.currentPrice ??
      item.amount ??
      item.totalPrice ??
      item.value,
    0
  );
}

function getSeller(item = {}) {
  return normalize(item.seller || item.sellerName || item.sellerId || item.vendor || item.account);
}

function getActiveEvidence(input = {}) {
  const evidenceSummary = input.evidenceSummary || {};
  const normalizedActive = asArray(evidenceSummary.normalizedEvidence)
    .filter((item) => item && item.evidenceType === 'active' && getPrice(item) > 0)
    .map((item) => ({ ...item, evidenceType: 'active', price: getPrice(item) }));

  const explicitActive = [
    ...asArray(input.activeComps),
    ...asArray(input.activeListings),
    ...asArray(input.marketData?.activeComps),
    ...asArray(input.marketData?.activeListings)
  ]
    .map((item) => ({ ...item, evidenceType: 'active', price: getPrice(item) }))
    .filter((item) => item.price > 0);

  return [...normalizedActive, ...explicitActive];
}

function getTrueSoldCount(input = {}) {
  return pickFirstNumber(
    [
      input.evidenceSummary || {},
      input.liquidityEvidence || {},
      input.liquidity || {},
      input.salesVelocityData?.details || {},
      input.salesVelocityData || {}
    ],
    ['trueSoldCount', 'soldCount', 'completedSales', 'recentSoldCount'],
    0
  );
}

function getActiveCount(input = {}, activeEvidence = []) {
  return Math.max(
    activeEvidence.length,
    pickFirstNumber(
      [
        input.evidenceSummary || {},
        input.liquidityEvidence || {},
        input.liquidity || {},
        input.salesVelocityData || {},
        input.marketData || {}
      ],
      ['activeCount', 'activeListings', 'availableCount', 'listingCount'],
      0
    )
  );
}

function getReferenceSoldValue(input = {}) {
  return pickFirstNumber(
    [
      input.evidenceSummary || {},
      input.valuationRange || {},
      input.marketData || {},
      input.compData || {}
    ],
    ['weightedSoldAverage', 'medianSold', 'expectedValue', 'marketValue', 'estimatedValue'],
    0
  );
}

function getRegimeNames(marketRegime = {}) {
  return [
    marketRegime.primaryRegime,
    ...asArray(marketRegime.secondaryRegimes),
    ...asArray(marketRegime.regimes)
  ].map(normalize).filter(Boolean);
}

function getActiveInventoryKnown(input = {}, activeCount = 0, activeEvidence = []) {
  const details = input.salesVelocityData?.details || {};
  const explicitQuality = input.activeInventoryQuality ||
    input.inventoryDataQuality ||
    input.marketData?.activeInventoryQuality ||
    input.marketData?.inventoryDataQuality;

  if (
    details.activeInventoryQualityKnown === true ||
    details.activeInventoryKnown === true ||
    input.salesVelocityData?.activeInventoryQualityKnown === true ||
    input.salesVelocityData?.activeInventoryKnown === true
  ) {
    return true;
  }

  if (['known', 'verified', 'fresh', 'good', 'excellent', 'trusted'].includes(normalize(explicitQuality))) {
    return true;
  }

  return activeCount > 0 && activeEvidence.length > 0;
}

function getInventoryDepth(activeCount, activeInventoryKnown) {
  if (!activeInventoryKnown && activeCount <= 0) {
    return createDimension('unknown', 45, 'Active inventory is unavailable, so supply pressure cannot be measured.');
  }

  if (activeCount >= 20) {
    return createDimension('severe', 94, 'Active inventory is very deep and could materially block resale.');
  }

  if (activeCount >= 10) {
    return createDimension('high', 82, 'Active inventory is high enough to create meaningful resale competition.');
  }

  if (activeCount >= 5) {
    return createDimension('elevated', 64, 'Active inventory is elevated and may require sharper pricing.');
  }

  if (activeCount >= 2) {
    return createDimension('normal', 42, 'Active inventory is visible but not unusually deep.');
  }

  return createDimension('low', 18, 'Active inventory appears low.');
}

function getActiveToSoldPressure(activeCount, trueSoldCount) {
  if (activeCount <= 0 && trueSoldCount <= 0) {
    return createDimension('unknown', 45, 'Active-to-sold pressure is unknown because active and true sold evidence are missing.');
  }

  if (activeCount > 0 && trueSoldCount <= 0) {
    return createDimension('severe', 96, 'Active listings exist without true sold support, creating severe resale-blocker risk.');
  }

  const ratio = activeCount / trueSoldCount;

  if (ratio >= 3) {
    return createDimension('severe', 92, 'Active inventory is more than three times true sold support.');
  }

  if (ratio >= 2) {
    return createDimension('high', 78, 'Active inventory is high relative to true sold support.');
  }

  if (ratio >= 1) {
    return createDimension('elevated', 60, 'Active inventory roughly matches or exceeds true sold support.');
  }

  if (ratio >= 0.4) {
    return createDimension('normal', 38, 'Active inventory appears manageable relative to true sold support.');
  }

  return createDimension('low', 18, 'True sold support is strong relative to active inventory.');
}

function getAskStackStats(activeEvidence = [], referenceSoldValue = 0) {
  const activePrices = activeEvidence.map(getPrice).filter((price) => price > 0).sort((a, b) => a - b);
  const nearMarketCount = referenceSoldValue > 0
    ? activePrices.filter((price) => price <= referenceSoldValue * 1.05).length
    : 0;
  const belowMarketCount = referenceSoldValue > 0
    ? activePrices.filter((price) => price < referenceSoldValue * 0.98).length
    : 0;
  const lowestAsk = activePrices.length ? activePrices[0] : 0;

  return {
    activePrices,
    nearMarketCount,
    belowMarketCount,
    lowestAsk
  };
}

function getAskStackPressure(stats, referenceSoldValue) {
  if (!stats.activePrices.length || referenceSoldValue <= 0) {
    return createDimension('unknown', 45, 'Ask-stack pressure is unknown because active ask prices or sold reference value are missing.');
  }

  if (stats.belowMarketCount >= 3 || stats.nearMarketCount >= 7) {
    return createDimension('severe', 92, 'Several active listings are already at or below the sold reference value.');
  }

  if (stats.belowMarketCount >= 2 || stats.nearMarketCount >= 4) {
    return createDimension('high', 78, 'The active ask stack is crowded near sold value.');
  }

  if (stats.belowMarketCount >= 1 || stats.nearMarketCount >= 2) {
    return createDimension('elevated', 58, 'Some active listings sit close enough to sold value to create undercut pressure.');
  }

  return createDimension('low', 20, 'Active asks are not tightly stacked around sold value.');
}

function getBelowMarketCompetition(stats, referenceSoldValue) {
  if (!stats.activePrices.length || referenceSoldValue <= 0) {
    return createDimension('unknown', 45, 'Below-market competition is unknown without active ask prices and sold reference value.');
  }

  const belowRate = stats.belowMarketCount / stats.activePrices.length;

  if (stats.belowMarketCount >= 3 || belowRate >= 0.4) {
    return createDimension('high', 86, 'Multiple active sellers are already priced below sold reference value.');
  }

  if (stats.belowMarketCount > 0) {
    return createDimension('elevated', 62, 'At least one active seller is already priced below sold reference value.');
  }

  return createDimension('low', 18, 'No active seller is priced below sold reference value.');
}

function getStaleInventoryRisk(input = {}, activeEvidence = []) {
  const sellThroughRate = pickFirstNumber(
    [input.liquidityEvidence || {}, input.liquidity || {}],
    ['sellThroughRate', 'sellThrough', 'salesToListingRatio'],
    NaN
  );
  const agedActive = activeEvidence.filter((item) => toNumber(item.ageDays, NaN) >= 90).length;
  const freshActive = activeEvidence.filter((item) => {
    const ageDays = toNumber(item.ageDays, NaN);
    return Number.isFinite(ageDays) && ageDays <= 14;
  }).length;

  if (!activeEvidence.length) {
    return createDimension('unknown', 45, 'Active listing age is unavailable.');
  }

  if (freshActive >= 3) {
    return createDimension('fresh_competition', 72, 'Several active listings are fresh, so sellers may still be actively competing.');
  }

  if (agedActive >= Math.max(3, Math.ceil(activeEvidence.length * 0.6)) && sellThroughRate < 0.25) {
    return createDimension('stale_blockers', 64, 'Most active listings appear stale while sell-through is weak.');
  }

  if (agedActive >= Math.ceil(activeEvidence.length * 0.6)) {
    return createDimension('stale', 38, 'Most active listings appear stale, which may reduce immediate undercut urgency.');
  }

  return createDimension('normal', 42, 'Active listing age does not indicate unusual stale-inventory pressure.');
}

function getSellerConcentration(activeEvidence = []) {
  const sellers = new Set(activeEvidence.map(getSeller).filter(Boolean));

  if (!activeEvidence.length || sellers.size <= 0) {
    return createDimension('unknown', 45, 'Active seller concentration is unavailable.');
  }

  if (sellers.size >= 5) {
    return createDimension('broad_competition', 78, 'Active competition spans many sellers, increasing undercut risk.');
  }

  if (sellers.size >= 2) {
    return createDimension('moderate_competition', 56, 'Active competition spans multiple sellers.');
  }

  if (activeEvidence.length >= 4) {
    return createDimension('concentrated', 38, 'Active inventory is concentrated with one seller, so competition breadth is limited.');
  }

  return createDimension('narrow', 28, 'Active seller competition appears narrow.');
}

function getSellThroughPressure(input = {}) {
  const liquidity = input.liquidityEvidence || input.liquidity || {};
  const salesVelocityData = input.salesVelocityData || {};
  const inventoryPressure = normalize(pickFirstValue([salesVelocityData], ['inventoryPressure'], ''));
  const sellThroughRate = pickFirstNumber(
    [liquidity],
    ['sellThroughRate', 'sellThrough', 'salesToListingRatio'],
    NaN
  );

  if (inventoryPressure === 'high' || (Number.isFinite(sellThroughRate) && sellThroughRate < 0.2)) {
    return createDimension('high', 84, 'Existing liquidity or sales velocity signals show weak sell-through versus active supply.');
  }

  if (inventoryPressure === 'elevated' || (Number.isFinite(sellThroughRate) && sellThroughRate < 0.4)) {
    return createDimension('elevated', 62, 'Existing liquidity or sales velocity signals show elevated supply pressure.');
  }

  if (inventoryPressure === 'low' || (Number.isFinite(sellThroughRate) && sellThroughRate >= 0.75)) {
    return createDimension('low', 18, 'Existing liquidity or sales velocity signals show healthy sell-through.');
  }

  if (Number.isFinite(sellThroughRate) || inventoryPressure) {
    return createDimension('normal', 40, 'Existing liquidity or sales velocity signals show normal sell-through pressure.');
  }

  return createDimension('unknown', 45, 'Sell-through pressure is unknown because liquidity and inventory-pressure signals are missing.');
}

function getRegimePressure(input = {}) {
  const marketRegime = input.marketRegime || {};
  const regimes = getRegimeNames(marketRegime);
  const supplyStatus = normalize(marketRegime.dimensions?.supplyPressure?.status);

  if (supplyStatus === 'high' || regimes.includes('thin') || regimes.includes('stale')) {
    return createDimension('high', 78, 'Market Regime signals indicate high supply, thin liquidity, or stale-market pressure.');
  }

  if (supplyStatus === 'elevated' || regimes.includes('cooling') || regimes.includes('falling')) {
    return createDimension('elevated', 60, 'Market Regime signals indicate elevated resale pressure.');
  }

  if (supplyStatus === 'low' || regimes.includes('stable') || regimes.includes('rising')) {
    return createDimension('low', 24, 'Market Regime signals do not indicate material supply pressure.');
  }

  if (supplyStatus || regimes.length) {
    return createDimension('normal', 40, 'Market Regime signals show no clear supply-pressure extreme.');
  }

  return createDimension('unknown', 45, 'Market Regime supply pressure is unavailable.');
}

function buildDimensions(input = {}) {
  const activeEvidence = getActiveEvidence(input);
  const activeCount = getActiveCount(input, activeEvidence);
  const trueSoldCount = getTrueSoldCount(input);
  const referenceSoldValue = getReferenceSoldValue(input);
  const activeInventoryKnown = getActiveInventoryKnown(input, activeCount, activeEvidence);
  const askStackStats = getAskStackStats(activeEvidence, referenceSoldValue);

  return {
    inventoryDepth: getInventoryDepth(activeCount, activeInventoryKnown),
    activeToSoldPressure: getActiveToSoldPressure(activeCount, trueSoldCount),
    askStackPressure: getAskStackPressure(askStackStats, referenceSoldValue),
    belowMarketCompetition: getBelowMarketCompetition(askStackStats, referenceSoldValue),
    staleInventoryRisk: getStaleInventoryRisk(input, activeEvidence),
    sellerConcentration: getSellerConcentration(activeEvidence),
    sellThroughPressure: getSellThroughPressure(input),
    regimePressure: getRegimePressure(input)
  };
}

function weightedScore(dimensions, weights) {
  let weighted = 0;
  let total = 0;

  for (const [name, weight] of Object.entries(weights)) {
    const score = dimensions[name] && dimensions[name].score;
    if (!Number.isFinite(score)) continue;
    weighted += score * weight;
    total += weight;
  }

  return total > 0 ? clampScore(weighted / total) : 0;
}

function scoreSupplyPressure(input = {}) {
  const dimensions = input.dimensions || buildDimensions(input);
  let score = weightedScore(dimensions, {
    inventoryDepth: 0.2,
    activeToSoldPressure: 0.22,
    askStackPressure: 0.16,
    belowMarketCompetition: 0.12,
    staleInventoryRisk: 0.08,
    sellerConcentration: 0.08,
    sellThroughPressure: 0.1,
    regimePressure: 0.04
  });

  if (dimensions.sellThroughPressure.status === 'high') score = Math.max(score, 45);
  if (dimensions.activeToSoldPressure.status === 'severe') score = Math.max(score, 75);

  return clampScore(score);
}

function scoreUndercutRisk(dimensions) {
  let score = weightedScore(dimensions, {
    askStackPressure: 0.3,
    belowMarketCompetition: 0.28,
    activeToSoldPressure: 0.16,
    sellerConcentration: 0.1,
    sellThroughPressure: 0.1,
    staleInventoryRisk: 0.06
  });

  if (
    dimensions.belowMarketCompetition.status === 'high' &&
    ['high', 'severe'].includes(dimensions.askStackPressure.status)
  ) {
    score = Math.max(score, 72);
  }

  return clampScore(score);
}

function getLevel(score) {
  if (score >= 85) return 'severe';
  if (score >= 70) return 'high';
  if (score >= 50) return 'elevated';
  if (score >= 30) return 'normal';
  return 'low';
}

function getResaleBlockerRisk(supplyPressureScore, undercutRiskScore) {
  const score = Math.max(supplyPressureScore, undercutRiskScore);
  if (score >= 70) return 'high';
  if (score >= 45) return 'moderate';
  if (score > 0) return 'low';
  return 'unknown';
}

function getEstimatedUndercut(stats, referenceSoldValue) {
  if (!stats.lowestAsk || referenceSoldValue <= 0) {
    return {
      estimatedUndercutPrice: 0,
      estimatedUndercutPercent: null
    };
  }

  const estimatedUndercutPrice = roundMoney(Math.max(0.01, stats.lowestAsk - 1));
  const estimatedUndercutPercent = estimatedUndercutPrice < referenceSoldValue
    ? roundMetric((referenceSoldValue - estimatedUndercutPrice) / referenceSoldValue, 3)
    : 0;

  return {
    estimatedUndercutPrice,
    estimatedUndercutPercent
  };
}

function summarizeSupplyPressure(data = {}) {
  if (data.pressureLevel === 'severe') return 'Supply pressure appears severe, with active inventory likely to block resale.';
  if (data.undercutRiskLevel === 'severe' || data.undercutRiskLevel === 'high') return 'Undercut risk appears high because active sellers are already near or below sold value.';
  if (data.pressureLevel === 'high') return 'Supply pressure appears high and may require aggressive resale pricing.';
  if (data.pressureLevel === 'elevated') return 'Supply pressure appears elevated but not extreme.';
  if (data.pressureLevel === 'low') return 'Supply pressure appears low from the available active-market evidence.';
  return 'Supply pressure is unclear from the available active-market evidence.';
}

function evaluateSupplyPressure(input = {}) {
  const activeEvidence = getActiveEvidence(input);
  const activeCount = getActiveCount(input, activeEvidence);
  const trueSoldCount = getTrueSoldCount(input);
  const referenceSoldValue = getReferenceSoldValue(input);
  const activeMedianAsk = pickFirstNumber([input.evidenceSummary || {}], ['activeMedianAsk'], 0);
  const activeToSoldRatio = trueSoldCount > 0 ? roundMetric(activeCount / trueSoldCount, 3) : null;
  const activeInventoryKnown = getActiveInventoryKnown(input, activeCount, activeEvidence);
  const askStackStats = getAskStackStats(activeEvidence, referenceSoldValue);
  const dimensions = buildDimensions(input);
  const supplyPressureScore = scoreSupplyPressure({ dimensions });
  const undercutRiskScore = scoreUndercutRisk(dimensions);
  const warnings = [];
  const positives = [];

  for (const [name, dimension] of Object.entries(dimensions)) {
    if (['unknown', 'elevated', 'high', 'severe', 'fresh_competition', 'stale_blockers', 'broad_competition'].includes(dimension.status)) {
      warnings.push(`${name}: ${dimension.explanation}`);
    }

    if (['low', 'normal', 'narrow', 'concentrated', 'stale'].includes(dimension.status)) {
      positives.push(`${name}: ${dimension.explanation}`);
    }
  }

  const result = {
    source: 'supply_pressure_engine',
    version: '1.2',
    supplyPressureScore,
    undercutRiskScore,
    pressureLevel: getLevel(supplyPressureScore),
    undercutRiskLevel: getLevel(undercutRiskScore),
    resaleBlockerRisk: getResaleBlockerRisk(supplyPressureScore, undercutRiskScore),
    activeInventoryKnown,
    activeCount,
    trueSoldCount,
    activeToSoldRatio,
    activeMedianAsk: roundMoney(activeMedianAsk || 0),
    referenceSoldValue: roundMoney(referenceSoldValue),
    ...getEstimatedUndercut(askStackStats, referenceSoldValue),
    dimensions,
    warnings: uniqueMessages(warnings),
    positives: uniqueMessages(positives),
    summary: ''
  };

  result.summary = summarizeSupplyPressure(result);
  return result;
}

module.exports = {
  evaluateSupplyPressure,
  scoreSupplyPressure,
  summarizeSupplyPressure
};
