'use strict';

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
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

function scoreSalesVolume(soldCount) {
  if (soldCount >= 25) return 100;
  if (soldCount >= 15) return 85;
  if (soldCount >= 8) return 70;
  if (soldCount >= 4) return 50;
  if (soldCount >= 1) return 30;
  return 10;
}

function scoreSellThrough(sellThroughRate) {
  if (sellThroughRate >= 0.75) return 100;
  if (sellThroughRate >= 0.55) return 85;
  if (sellThroughRate >= 0.35) return 65;
  if (sellThroughRate >= 0.2) return 45;
  if (sellThroughRate > 0) return 25;
  return 10;
}

function scoreDaysToSell(daysToSell) {
  if (!daysToSell || daysToSell <= 0) return 45;
  if (daysToSell <= 7) return 100;
  if (daysToSell <= 14) return 85;
  if (daysToSell <= 30) return 65;
  if (daysToSell <= 60) return 40;
  return 20;
}

function getLiquidityLevel(score) {
  if (score >= 85) return 'excellent';
  if (score >= 70) return 'good';
  if (score >= 50) return 'fair';
  if (score >= 30) return 'thin';
  return 'poor';
}

function analyzeLiquidity(input = {}) {
  const marketData = input.marketData || {};
  const soldSales = asArray(input.soldSales);
  const compData = input.compData || {};
  const listing = input.listing || {};

  const activeCount = pickFirstNumber(
    [marketData, compData, listing],
    ['activeCount', 'activeListings', 'availableCount', 'listingCount'],
    0
  );

  const explicitSoldCount = pickFirstNumber(
    [marketData, compData],
    ['soldCount', 'completedSales', 'recentSoldCount', 'salesCount'],
    0
  );

  const soldCount = Math.max(explicitSoldCount, soldSales.length);

  const sellThroughRate = pickFirstNumber(
    [marketData, compData],
    ['sellThroughRate', 'sellThrough', 'salesToListingRatio'],
    activeCount > 0 ? soldCount / activeCount : 0
  );

  const daysToSell = pickFirstNumber(
    [marketData, compData],
    ['averageDaysToSell', 'avgDaysToSell', 'daysToSell', 'medianDaysToSell'],
    0
  );

  const volumeScore = scoreSalesVolume(soldCount);
  const sellThroughScore = scoreSellThrough(sellThroughRate);
  const velocityScore = scoreDaysToSell(daysToSell);

  const score = Math.round(
    volumeScore * 0.45 +
    sellThroughScore * 0.35 +
    velocityScore * 0.2
  );

  const warnings = [];
  const positives = [];

  if (soldCount < 4) {
    warnings.push('Limited recent sold data makes liquidity difficult to trust.');
  }

  if (activeCount > 0 && sellThroughRate < 0.2) {
    warnings.push('Sell-through appears weak relative to active market supply.');
  }

  if (daysToSell > 60) {
    warnings.push('Comparable items may take a long time to sell.');
  }

  if (soldCount >= 8) {
    positives.push('Recent sold volume is strong enough to support market confidence.');
  }

  if (sellThroughRate >= 0.55) {
    positives.push('Sell-through rate suggests healthy buyer demand.');
  }

  if (daysToSell > 0 && daysToSell <= 14) {
    positives.push('Market velocity appears strong based on days-to-sell data.');
  }

  return {
    score,
    level: getLiquidityLevel(score),
    soldCount,
    activeCount,
    sellThroughRate: Number(sellThroughRate.toFixed(3)),
    daysToSell,
    warnings,
    positives
  };
}

module.exports = {
  analyzeLiquidity
};
