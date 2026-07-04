'use strict';

const SOURCE = 'sales_velocity_engine';

const DAY_MS = 24 * 60 * 60 * 1000;

function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}

function round(value, digits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const factor = 10 ** digits;
  return Math.round(number * factor) / factor;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function toNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function parseDate(value) {
  if (!value) return null;

  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : null;
  }

  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function normalizeText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function getSaleDate(sale = {}) {
  return parseDate(
    sale.soldAt ||
      sale.saleDate ||
      sale.dateSold ||
      sale.endTime ||
      sale.endedAt ||
      sale.completedAt ||
      sale.date
  );
}

function getSalePrice(sale = {}) {
  return toNumber(
    sale.soldPrice ??
      sale.salePrice ??
      sale.price ??
      sale.finalPrice ??
      sale.totalPrice,
    null
  );
}

function getSaleId(sale = {}) {
  return (
    sale.ebayItemId ||
    sale.itemId ||
    sale.listingId ||
    sale.id ||
    sale.saleId ||
    sale.transactionId ||
    null
  );
}

function getSaleUrl(sale = {}) {
  return sale.url || sale.link || sale.itemUrl || sale.listingUrl || null;
}

function getSeller(sale = {}) {
  return sale.seller || sale.sellerName || sale.sellerUsername || sale.user || null;
}

function getSaleFingerprint(sale = {}) {
  const id = getSaleId(sale);
  if (id) return `id:${String(id)}`;

  const url = getSaleUrl(sale);
  if (url) return `url:${normalizeText(url)}`;

  const title = normalizeText(sale.title || sale.name || sale.itemTitle);
  const price = Number.isFinite(sale.price) ? round(sale.price, 2) : '';
  const date = sale.soldAt ? sale.soldAt.toISOString().slice(0, 10) : '';
  const seller = normalizeText(getSeller(sale));

  if (title && price !== '' && date && seller) {
    return `seller-title-price-date:${seller}|${title}|${price}|${date}`;
  }

  if (title && price !== '' && date) {
    return `title-price-date:${title}|${price}|${date}`;
  }

  if (title && date) {
    return `title-date:${title}|${date}`;
  }

  return null;
}

function dedupeSales(sales = []) {
  const seen = new Set();
  const deduped = [];
  let duplicateCount = 0;

  for (const sale of sales) {
    const fingerprint = getSaleFingerprint(sale);

    if (fingerprint && seen.has(fingerprint)) {
      duplicateCount += 1;
      continue;
    }

    if (fingerprint) seen.add(fingerprint);
    deduped.push(sale);
  }

  return {
    sales: deduped,
    duplicateCount
  };
}

function normalizeSoldSales(input = {}, options = {}) {
  const now = parseDate(options.now || input.now || input.asOfDate) || new Date();

  const rawSales = Array.isArray(input)
    ? input
    : asArray(
        input.soldSales ||
          input.sales ||
          input.soldListings ||
          input.marketData?.soldSales ||
          input.compData?.selectedComps ||
          input.compData?.soldComps
      );

  const datedSales = rawSales
    .map((sale) => {
      const soldAt = getSaleDate(sale);
      return {
        ...sale,
        soldAt,
        price: getSalePrice(sale)
      };
    })
    .filter((sale) => sale.soldAt && sale.soldAt.getTime() <= now.getTime())
    .sort((a, b) => b.soldAt - a.soldAt);

  return dedupeSales(datedSales).sales;
}

function normalizeSoldSalesWithMetadata(input = {}, now = new Date()) {
  const rawSales = Array.isArray(input)
    ? input
    : asArray(
        input.soldSales ||
          input.sales ||
          input.soldListings ||
          input.marketData?.soldSales ||
          input.compData?.selectedComps ||
          input.compData?.soldComps
      );

  const mapped = rawSales.map((sale) => {
    const soldAt = getSaleDate(sale);
    return {
      ...sale,
      soldAt,
      price: getSalePrice(sale)
    };
  });

  const invalidDateCount = mapped.filter((sale) => !sale.soldAt).length;
  const futureDatedCount = mapped.filter((sale) => sale.soldAt && sale.soldAt.getTime() > now.getTime()).length;

  const validDatedSales = mapped
    .filter((sale) => sale.soldAt && sale.soldAt.getTime() <= now.getTime())
    .sort((a, b) => b.soldAt - a.soldAt);

  const deduped = dedupeSales(validDatedSales);

  return {
    sales: deduped.sales,
    duplicateCount: deduped.duplicateCount,
    invalidDateCount,
    futureDatedCount
  };
}

function daysBetween(later, earlier) {
  if (!later || !earlier) return null;
  return Math.max(0, (later.getTime() - earlier.getTime()) / DAY_MS);
}

function countSince(sales = [], now, days) {
  const cutoff = now.getTime() - days * DAY_MS;
  return sales.filter((sale) => {
    const time = sale.soldAt.getTime();
    return time >= cutoff && time <= now.getTime();
  }).length;
}

function averageDaysBetweenSales(sales = []) {
  if (sales.length < 2) return null;

  const ascending = [...sales].sort((a, b) => a.soldAt - b.soldAt);
  const gaps = [];

  for (let i = 1; i < ascending.length; i += 1) {
    const gap = daysBetween(ascending[i].soldAt, ascending[i - 1].soldAt);
    if (gap !== null) gaps.push(gap);
  }

  if (!gaps.length) return null;

  return round(gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length, 1);
}

function calculateTrend(sales = [], now) {
  if (sales.length < 4) return 'unknown';

  const recent30 = countSince(sales, now, 30);
  const prior30Start = now.getTime() - 60 * DAY_MS;
  const prior30End = now.getTime() - 30 * DAY_MS;

  const prior30 = sales.filter((sale) => {
    const time = sale.soldAt.getTime();
    return time >= prior30Start && time < prior30End;
  }).length;

  if (recent30 >= Math.max(3, prior30 * 1.35)) return 'rising';
  if (prior30 >= Math.max(3, recent30 * 1.35)) return 'falling';
  return 'stable';
}

function calculatePriceVolatility(sales = []) {
  const prices = sales
    .map((sale) => sale.price)
    .filter((price) => Number.isFinite(price) && price > 0);

  if (prices.length < 3) return 0;

  const average = prices.reduce((sum, price) => sum + price, 0) / prices.length;
  if (!average) return 0;

  const variance = prices.reduce((sum, price) => sum + ((price - average) ** 2), 0) / prices.length;
  const standardDeviation = Math.sqrt(variance);

  return clamp(standardDeviation / average, 0, 2);
}

function calculateSeasonalSpike(sales = [], now) {
  const soldLast7Days = countSince(sales, now, 7);
  const soldLast14Days = countSince(sales, now, 14);
  const soldLast30Days = countSince(sales, now, 30);
  const soldLast90Days = countSince(sales, now, 90);

  if (soldLast30Days < 4) return false;

  const expected7DayPace = soldLast30Days * (7 / 30);
  const expected14DayPace = soldLast30Days * (14 / 30);
  const recent7Spike = soldLast7Days >= Math.max(3, expected7DayPace * 2.25);
  const recent14Spike = soldLast14Days >= Math.max(4, expected14DayPace * 1.9);

  if (recent7Spike || recent14Spike) return true;

  if (soldLast90Days >= 8) {
    const expected30DayPace = soldLast90Days / 3;
    return soldLast30Days >= Math.max(5, expected30DayPace * 1.85);
  }

  return false;
}

function calculateEarlyMarket(sales = [], now, input = {}) {
  if (!sales.length) return false;

  if (
    input.isNewRelease === true ||
    input.newRelease === true ||
    input.marketData?.isNewRelease === true ||
    input.compData?.isNewRelease === true
  ) {
    return true;
  }

  const oldestSale = sales.reduce((oldest, sale) => {
    if (!oldest || sale.soldAt < oldest.soldAt) return sale;
    return oldest;
  }, null);

  const marketAgeDays = oldestSale ? daysBetween(now, oldestSale.soldAt) : null;
  const soldLast30Days = countSince(sales, now, 30);
  const soldLast90Days = countSince(sales, now, 90);

  return marketAgeDays !== null &&
    marketAgeDays <= 45 &&
    soldLast30Days >= Math.max(3, Math.ceil(soldLast90Days * 0.7));
}

function hasKnownInventoryQuality(input = {}) {
  const quality = normalizeText(
    input.inventoryDataQuality ||
      input.activeInventoryQuality ||
      input.marketData?.inventoryDataQuality ||
      input.marketData?.activeInventoryQuality ||
      input.compData?.inventoryDataQuality
  );

  return [
    'known',
    'verified',
    'fresh',
    'good',
    'excellent',
    'high',
    'trusted'
  ].includes(quality);
}

function calculateInventoryPressure(input = {}, soldLast30Days = 0) {
  const activeCount = toNumber(
    input.activeCount ??
      input.activeListings ??
      input.marketData?.activeCount ??
      input.marketData?.activeListings ??
      input.compData?.activeCompCount,
    null
  );

  const inventoryQualityKnown = hasKnownInventoryQuality(input);

  if (activeCount === null) {
    return {
      level: 'unknown',
      scoreImpact: 0,
      dataQualityKnown: false,
      explanation: 'Active inventory was unavailable, so inventory pressure could not be measured.'
    };
  }

  if (activeCount <= 0) {
    if (!inventoryQualityKnown) {
      return {
        level: 'unknown',
        scoreImpact: 0,
        dataQualityKnown: false,
        explanation: 'Active inventory was reported as zero, but inventory data quality was not verified.'
      };
    }

    return {
      level: 'low',
      scoreImpact: 4,
      dataQualityKnown: true,
      explanation: 'Verified active inventory appears to be zero, suggesting limited available supply.'
    };
  }

  const sellThroughRatio = soldLast30Days / activeCount;

  if (sellThroughRatio >= 1) {
    return {
      level: 'low',
      scoreImpact: 10,
      dataQualityKnown: inventoryQualityKnown,
      explanation: 'Recent sold volume is high relative to active inventory.'
    };
  }

  if (sellThroughRatio >= 0.35) {
    return {
      level: 'normal',
      scoreImpact: 4,
      dataQualityKnown: inventoryQualityKnown,
      explanation: 'Recent sold volume is reasonable relative to active inventory.'
    };
  }

  if (sellThroughRatio > 0) {
    return {
      level: 'elevated',
      scoreImpact: -8,
      dataQualityKnown: inventoryQualityKnown,
      explanation: 'Active inventory appears high relative to recent sold volume.'
    };
  }

  return {
    level: 'high',
    scoreImpact: -15,
    dataQualityKnown: inventoryQualityKnown,
    explanation: 'Active inventory exists, but no recent 30-day sales were detected.'
  };
}

function scoreVelocity({
  soldCount,
  soldLast7Days,
  soldLast30Days,
  soldLast90Days,
  averageGap,
  trend,
  volatility,
  seasonalSpike,
  earlyMarket,
  inventoryPressure
}) {
  let score = 0;

  if (soldCount <= 0) return 0;

  score += Math.min(35, soldLast30Days * 4);
  score += Math.min(20, soldLast90Days * 0.9);
  score += Math.min(10, soldLast7Days * 3);

  if (averageGap !== null) {
    if (averageGap <= 3) score += 20;
    else if (averageGap <= 7) score += 16;
    else if (averageGap <= 14) score += 11;
    else if (averageGap <= 30) score += 6;
    else if (averageGap <= 60) score += 2;
    else score -= 5;
  }

  if (trend === 'rising') score += 8;
  if (trend === 'falling') score -= 10;

  if (volatility >= 0.75) score -= 12;
  else if (volatility >= 0.45) score -= 7;
  else if (volatility >= 0.25) score -= 3;

  if (seasonalSpike) score -= 10;
  if (earlyMarket) score -= 6;

  score += inventoryPressure.scoreImpact || 0;

  if (soldCount < 3) score = Math.min(score, 34);
  if (soldCount < 5) score = Math.min(score, 49);
  if (soldLast90Days === 0) score = Math.min(score, 25);
  if (soldLast30Days === 0) score = Math.min(score, 42);
  if (seasonalSpike) score = Math.min(score, 74);
  if (earlyMarket) score = Math.min(score, 68);

  return Math.round(clamp(score, 0, 100));
}

function getLiquidityRating(score) {
  if (score >= 85) return 'excellent';
  if (score >= 70) return 'strong';
  if (score >= 50) return 'moderate';
  if (score >= 30) return 'thin';
  return 'illiquid';
}

function getDemandStrength(score, soldLast30Days, trend) {
  if (score >= 80 && soldLast30Days >= 10) return 'very_strong';
  if (score >= 65 && soldLast30Days >= 5) return 'strong';
  if (score >= 45 && soldLast30Days >= 2) return trend === 'falling' ? 'softening' : 'moderate';
  if (soldLast30Days > 0) return 'weak';
  return 'very_weak';
}

function estimateDaysToSell(score, averageGap, soldLast30Days, soldLast90Days) {
  if (score <= 0 || soldLast90Days <= 0) return null;

  if (averageGap !== null) {
    const liquidityAdjustment = score >= 70 ? 0.85 : score >= 50 ? 1 : score >= 30 ? 1.35 : 1.75;
    return Math.max(1, Math.round(averageGap * liquidityAdjustment));
  }

  if (soldLast30Days > 0) {
    return Math.max(1, Math.round(30 / soldLast30Days));
  }

  return Math.max(30, Math.round(90 / soldLast90Days));
}

function calculateConfidence(
  soldCount,
  soldLast90Days,
  trend,
  volatility,
  hasActiveInventoryData,
  options = {}
) {
  let confidence = 20;

  confidence += Math.min(35, soldCount * 4);
  confidence += Math.min(20, soldLast90Days * 2);

  if (trend !== 'unknown') confidence += 10;
  if (hasActiveInventoryData) confidence += 8;

  if (volatility >= 0.75) confidence -= 12;
  else if (volatility >= 0.45) confidence -= 7;

  if (options.duplicateCount > 0) confidence -= Math.min(12, options.duplicateCount * 3);
  if (options.futureDatedCount > 0) confidence -= Math.min(10, options.futureDatedCount * 3);
  if (options.seasonalSpike) confidence -= 15;
  if (options.earlyMarket) confidence -= 12;
  if (options.inventoryPressure?.level === 'unknown' && hasActiveInventoryData) confidence -= 5;

  if (soldCount < 3) confidence = Math.min(confidence, 38);
  if (soldCount < 5) confidence = Math.min(confidence, 55);
  if (options.seasonalSpike) confidence = Math.min(confidence, 62);
  if (options.earlyMarket) confidence = Math.min(confidence, 58);

  return Math.round(clamp(confidence, 0, 100));
}

function buildExplanation({
  sales,
  soldLast7Days,
  soldLast30Days,
  soldLast90Days,
  averageGap,
  estimatedDaysToSell,
  trend,
  volatility,
  seasonalSpike,
  earlyMarket,
  inventoryPressure,
  score,
  confidence,
  duplicateCount,
  futureDatedCount,
  invalidDateCount
}) {
  const explanation = [];

  if (!sales.length) {
    explanation.push('No dated sold history was available, so sales velocity could not be established.');
    explanation.push('Liquidity should be treated as unproven until real sold comps appear.');
    if (futureDatedCount > 0) explanation.push(`${futureDatedCount} future-dated sale${futureDatedCount === 1 ? '' : 's'} were excluded.`);
    if (invalidDateCount > 0) explanation.push(`${invalidDateCount} sale${invalidDateCount === 1 ? '' : 's'} had unusable dates.`);
    return explanation;
  }

  explanation.push(`${sales.length} dated sold sale${sales.length === 1 ? '' : 's'} were analyzed.`);
  explanation.push(`${soldLast7Days} sold in the last 7 days, ${soldLast30Days} in the last 30 days, and ${soldLast90Days} in the last 90 days.`);

  if (duplicateCount > 0) {
    explanation.push(`${duplicateCount} duplicate sale${duplicateCount === 1 ? '' : 's'} were excluded from velocity calculations.`);
  }

  if (futureDatedCount > 0) {
    explanation.push(`${futureDatedCount} future-dated sale${futureDatedCount === 1 ? '' : 's'} were excluded.`);
  }

  if (invalidDateCount > 0) {
    explanation.push(`${invalidDateCount} sale${invalidDateCount === 1 ? '' : 's'} had unusable dates and were excluded.`);
  }

  if (averageGap !== null) {
    explanation.push(`Average time between sales is about ${averageGap} day${averageGap === 1 ? '' : 's'}.`);
  } else {
    explanation.push('There are not enough dated sales to calculate a reliable average gap between sales.');
  }

  if (estimatedDaysToSell !== null) {
    explanation.push(`Estimated days to sell is approximately ${estimatedDaysToSell} day${estimatedDaysToSell === 1 ? '' : 's'} under current demand.`);
  }

  if (trend === 'rising') explanation.push('Recent sales pace is rising compared with the prior period.');
  if (trend === 'stable') explanation.push('Recent sales pace appears stable.');
  if (trend === 'falling') explanation.push('Recent sales pace is falling compared with the prior period.');
  if (trend === 'unknown') explanation.push('Sales trend is unknown because the market has limited dated sales.');

  if (volatility >= 0.75) {
    explanation.push('Sale prices appear highly volatile, so velocity confidence is reduced.');
  } else if (volatility >= 0.45) {
    explanation.push('Sale prices show moderate volatility.');
  }

  if (seasonalSpike) {
    explanation.push('Recent activity may reflect a temporary hype or seasonal spike, so score and confidence are capped conservatively.');
  }

  if (earlyMarket) {
    explanation.push('This appears to be an early-market or new-release style sales pattern, so velocity confidence is capped until more history develops.');
  }

  explanation.push(inventoryPressure.explanation);
  explanation.push(`Sales velocity score is ${score}/100 with ${confidence}/100 confidence.`);

  return explanation;
}

function evaluateSalesVelocity(input = {}) {
  const now = parseDate(input.now || input.asOfDate) || new Date();
  const normalized = normalizeSoldSalesWithMetadata(input, now);
  const sales = normalized.sales;

  const soldLast7Days = countSince(sales, now, 7);
  const soldLast30Days = countSince(sales, now, 30);
  const soldLast90Days = countSince(sales, now, 90);
  const averageGap = averageDaysBetweenSales(sales);
  const salesTrend = calculateTrend(sales, now);
  const volatility = calculatePriceVolatility(sales);
  const seasonalSpike = calculateSeasonalSpike(sales, now);
  const earlyMarket = calculateEarlyMarket(sales, now, input);
  const inventoryPressureData = calculateInventoryPressure(input, soldLast30Days);
  const hasActiveInventoryData =
    input.activeCount !== undefined ||
    input.activeListings !== undefined ||
    input.marketData?.activeCount !== undefined ||
    input.marketData?.activeListings !== undefined ||
    input.compData?.activeCompCount !== undefined;

  const salesVelocityScore = scoreVelocity({
    soldCount: sales.length,
    soldLast7Days,
    soldLast30Days,
    soldLast90Days,
    averageGap,
    trend: salesTrend,
    volatility,
    seasonalSpike,
    earlyMarket,
    inventoryPressure: inventoryPressureData
  });

  const estimatedDaysToSell = estimateDaysToSell(
    salesVelocityScore,
    averageGap,
    soldLast30Days,
    soldLast90Days
  );

  const confidence = calculateConfidence(
    sales.length,
    soldLast90Days,
    salesTrend,
    volatility,
    hasActiveInventoryData,
    {
      duplicateCount: normalized.duplicateCount,
      futureDatedCount: normalized.futureDatedCount,
      seasonalSpike,
      earlyMarket,
      inventoryPressure: inventoryPressureData
    }
  );

  const demandStrength = getDemandStrength(salesVelocityScore, soldLast30Days, salesTrend);

  return {
    source: SOURCE,
    salesVelocityScore,
    liquidityRating: getLiquidityRating(salesVelocityScore),
    averageDaysBetweenSales: averageGap,
    estimatedDaysToSell,
    soldLast7Days,
    soldLast30Days,
    soldLast90Days,
    salesTrend,
    demandStrength,
    inventoryPressure: inventoryPressureData.level,
    confidence,
    explanation: buildExplanation({
      sales,
      soldLast7Days,
      soldLast30Days,
      soldLast90Days,
      averageGap,
      estimatedDaysToSell,
      trend: salesTrend,
      volatility,
      seasonalSpike,
      earlyMarket,
      inventoryPressure: inventoryPressureData,
      score: salesVelocityScore,
      confidence,
      duplicateCount: normalized.duplicateCount,
      futureDatedCount: normalized.futureDatedCount,
      invalidDateCount: normalized.invalidDateCount
    }),
    details: {
      soldCount: sales.length,
      duplicateSalesExcluded: normalized.duplicateCount,
      futureDatedSalesExcluded: normalized.futureDatedCount,
      invalidDateSalesExcluded: normalized.invalidDateCount,
      priceVolatility: round(volatility, 3),
      seasonalSpike,
      earlyMarket,
      activeInventoryKnown: hasActiveInventoryData,
      activeInventoryQualityKnown: Boolean(inventoryPressureData.dataQualityKnown),
      asOfDate: now.toISOString()
    }
  };
}

function summarizeSalesVelocity(data = {}) {
  const result = data.source === SOURCE ? data : evaluateSalesVelocity(data);

  if (result.salesVelocityScore <= 0) {
    return 'Sales velocity is unknown because no dated sold history was available.';
  }

  return [
    `Sales velocity is ${result.liquidityRating} (${result.salesVelocityScore}/100).`,
    `${result.soldLast30Days} sold in the last 30 days and ${result.soldLast90Days} sold in the last 90 days.`,
    result.estimatedDaysToSell
      ? `Estimated days to sell is about ${result.estimatedDaysToSell}.`
      : 'Estimated days to sell is not reliable yet.',
    `Confidence is ${result.confidence}/100.`
  ].join(' ');
}

module.exports = {
  evaluateSalesVelocity,
  summarizeSalesVelocity,

  normalizeSoldSales,
  calculateTrend,
  averageDaysBetweenSales
};
