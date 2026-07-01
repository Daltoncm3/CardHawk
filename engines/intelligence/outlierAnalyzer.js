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

function getSalePrice(sale = {}) {
  return pickFirstNumber(
    [sale],
    ['price', 'soldPrice', 'salePrice', 'amount', 'totalPrice', 'value'],
    0
  );
}

function getMedian(values) {
  const cleanValues = values
    .map((value) => toNumber(value, NaN))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);

  if (!cleanValues.length) return 0;

  const middle = Math.floor(cleanValues.length / 2);

  if (cleanValues.length % 2) {
    return cleanValues[middle];
  }

  return (cleanValues[middle - 1] + cleanValues[middle]) / 2;
}

function getAverage(values) {
  const cleanValues = values
    .map((value) => toNumber(value, NaN))
    .filter((value) => Number.isFinite(value) && value > 0);

  if (!cleanValues.length) return 0;

  return cleanValues.reduce((sum, value) => sum + value, 0) / cleanValues.length;
}

function getStandardDeviation(values, average) {
  const cleanValues = values
    .map((value) => toNumber(value, NaN))
    .filter((value) => Number.isFinite(value) && value > 0);

  if (cleanValues.length < 2) return 0;

  const variance = cleanValues.reduce((sum, value) => {
    return sum + Math.pow(value - average, 2);
  }, 0) / cleanValues.length;

  return Math.sqrt(variance);
}

function getDeviationPercent(value, reference) {
  if (!value || !reference || reference <= 0) return 0;
  return (value - reference) / reference;
}

function classifyOutlier(deviationPercent) {
  const absoluteDeviation = Math.abs(deviationPercent);

  if (absoluteDeviation >= 0.75) return 'extreme';
  if (absoluteDeviation >= 0.45) return 'high';
  if (absoluteDeviation >= 0.25) return 'moderate';
  return 'normal';
}

function scoreOutlierRisk(outlierRate, extremeOutlierCount, priceSpreadPercent, compCount) {
  if (compCount < 3) return 35;

  let score = 100;

  if (outlierRate > 0.45) score -= 45;
  else if (outlierRate > 0.3) score -= 30;
  else if (outlierRate > 0.18) score -= 15;

  if (extremeOutlierCount >= 2) score -= 25;
  else if (extremeOutlierCount === 1) score -= 12;

  if (priceSpreadPercent > 0.9) score -= 25;
  else if (priceSpreadPercent > 0.65) score -= 15;
  else if (priceSpreadPercent > 0.45) score -= 8;

  return Math.max(10, Math.min(100, Math.round(score)));
}

function getOutlierLevel(score) {
  if (score >= 85) return 'excellent';
  if (score >= 70) return 'good';
  if (score >= 50) return 'fair';
  if (score >= 30) return 'weak';
  return 'unreliable';
}

function analyzeOutliers(input = {}) {
  const marketData = input.marketData || {};
  const soldSales = asArray(input.soldSales);
  const compData = input.compData || {};
  const listing = input.listing || {};

  const soldPrices = soldSales
    .map(getSalePrice)
    .filter((price) => price > 0);

  const marketAveragePrice = pickFirstNumber(
    [marketData, compData],
    ['averagePrice', 'avgPrice', 'averageSoldPrice', 'avgSoldPrice'],
    getAverage(soldPrices)
  );

  const marketMedianPrice = pickFirstNumber(
    [marketData, compData],
    ['medianPrice', 'medianSoldPrice'],
    getMedian(soldPrices) || marketAveragePrice
  );

  const referencePrice = marketMedianPrice || marketAveragePrice;

  const marketLowPrice = pickFirstNumber(
    [marketData, compData],
    ['lowPrice', 'minPrice', 'lowestSoldPrice'],
    soldPrices.length ? Math.min(...soldPrices) : 0
  );

  const marketHighPrice = pickFirstNumber(
    [marketData, compData],
    ['highPrice', 'maxPrice', 'highestSoldPrice'],
    soldPrices.length ? Math.max(...soldPrices) : 0
  );

  const listingPrice = pickFirstNumber(
    [listing],
    ['price', 'askingPrice', 'listPrice', 'currentPrice', 'purchasePrice', 'costBasis'],
    0
  );

  const standardDeviation = getStandardDeviation(soldPrices, marketAveragePrice || referencePrice);
  const priceSpreadPercent = referencePrice > 0
    ? (marketHighPrice - marketLowPrice) / referencePrice
    : 0;

  const outliers = soldPrices
    .map((price) => {
      const deviationPercent = getDeviationPercent(price, referencePrice);
      const classification = classifyOutlier(deviationPercent);

      return {
        price,
        deviationPercent: Number(deviationPercent.toFixed(3)),
        classification
      };
    })
    .filter((item) => item.classification !== 'normal');

  const moderateOutlierCount = outliers.filter((item) => item.classification === 'moderate').length;
  const highOutlierCount = outliers.filter((item) => item.classification === 'high').length;
  const extremeOutlierCount = outliers.filter((item) => item.classification === 'extreme').length;
  const outlierCount = outliers.length;
  const compCount = soldPrices.length;
  const outlierRate = compCount > 0 ? outlierCount / compCount : 0;

  const listingDeviationPercent = getDeviationPercent(listingPrice, referencePrice);
  const listingClassification = listingPrice > 0 && referencePrice > 0
    ? classifyOutlier(listingDeviationPercent)
    : 'unknown';

  const score = scoreOutlierRisk(
    outlierRate,
    extremeOutlierCount,
    priceSpreadPercent,
    compCount
  );

  const warnings = [];
  const positives = [];

  if (compCount < 3) {
    warnings.push('There are not enough sold comps to confidently identify market outliers.');
  }

  if (outlierRate > 0.3) {
    warnings.push('A high share of comparable sales appear to be pricing outliers.');
  }

  if (extremeOutlierCount > 0) {
    warnings.push('Extreme sale-price outliers are present and should be reviewed manually.');
  }

  if (priceSpreadPercent > 0.65) {
    warnings.push('The observed market price range is wide, reducing confidence in valuation.');
  }

  if (listingClassification === 'high' || listingClassification === 'extreme') {
    warnings.push('The listing price appears to be an outlier versus the market reference.');
  }

  if (compCount >= 6 && outlierRate <= 0.18) {
    positives.push('Comparable sales show limited outlier pressure.');
  }

  if (priceSpreadPercent > 0 && priceSpreadPercent <= 0.45) {
    positives.push('Market sale prices are within a manageable range.');
  }

  if (listingClassification === 'normal') {
    positives.push('The listing price is not an obvious market outlier.');
  }

  return {
    score,
    level: getOutlierLevel(score),
    compCount,
    outlierCount,
    outlierRate: Number(outlierRate.toFixed(3)),
    moderateOutlierCount,
    highOutlierCount,
    extremeOutlierCount,
    marketAveragePrice: Number(marketAveragePrice.toFixed(2)),
    marketMedianPrice: Number(marketMedianPrice.toFixed(2)),
    marketLowPrice,
    marketHighPrice,
    standardDeviation: Number(standardDeviation.toFixed(2)),
    priceSpreadPercent: Number(priceSpreadPercent.toFixed(3)),
    listingPrice,
    listingDeviationPercent: Number(listingDeviationPercent.toFixed(3)),
    listingClassification,
    outliers,
    warnings,
    positives
  };
}

module.exports = {
  analyzeOutliers
};
