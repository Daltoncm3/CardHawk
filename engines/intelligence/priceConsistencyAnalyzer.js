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

function getListingPrice(listing = {}) {
  return pickFirstNumber(
    [listing],
    ['price', 'askingPrice', 'listPrice', 'currentPrice', 'purchasePrice', 'costBasis'],
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

function getMeanAbsoluteDeviation(values, reference) {
  const cleanValues = values
    .map((value) => toNumber(value, NaN))
    .filter((value) => Number.isFinite(value) && value > 0);

  if (!cleanValues.length || !reference || reference <= 0) return 0;

  const totalDeviation = cleanValues.reduce((sum, value) => {
    return sum + Math.abs(value - reference);
  }, 0);

  return totalDeviation / cleanValues.length;
}

function getPercentDifference(a, b) {
  if (!a || !b || a <= 0 || b <= 0) return 0;
  return Math.abs(a - b) / ((a + b) / 2);
}

function scoreMedianAverageAlignment(percentDifference) {
  if (percentDifference <= 0.05) return 100;
  if (percentDifference <= 0.1) return 85;
  if (percentDifference <= 0.18) return 65;
  if (percentDifference <= 0.3) return 40;
  return 20;
}

function scoreMeanDeviation(meanDeviationPercent) {
  if (meanDeviationPercent <= 0) return 45;
  if (meanDeviationPercent <= 0.12) return 100;
  if (meanDeviationPercent <= 0.2) return 85;
  if (meanDeviationPercent <= 0.35) return 60;
  if (meanDeviationPercent <= 0.5) return 35;
  return 20;
}

function scoreRangeWidth(rangePercent) {
  if (rangePercent <= 0) return 45;
  if (rangePercent <= 0.25) return 100;
  if (rangePercent <= 0.4) return 80;
  if (rangePercent <= 0.65) return 55;
  if (rangePercent <= 0.9) return 35;
  return 15;
}

function scoreListingAlignment(listingDifferencePercent) {
  if (listingDifferencePercent <= 0) return 45;
  if (listingDifferencePercent <= 0.08) return 100;
  if (listingDifferencePercent <= 0.15) return 80;
  if (listingDifferencePercent <= 0.25) return 55;
  if (listingDifferencePercent <= 0.4) return 35;
  return 15;
}

function getConsistencyLevel(score) {
  if (score >= 85) return 'excellent';
  if (score >= 70) return 'good';
  if (score >= 50) return 'fair';
  if (score >= 30) return 'weak';
  return 'unreliable';
}

function analyzePriceConsistency(input = {}) {
  const marketData = input.marketData || {};
  const soldSales = asArray(input.soldSales);
  const compData = input.compData || {};
  const roiData = input.roiData || {};
  const listing = input.listing || {};

  const soldPrices = soldSales
    .map(getSalePrice)
    .filter((price) => price > 0);

  const calculatedAveragePrice = getAverage(soldPrices);
  const calculatedMedianPrice = getMedian(soldPrices);

  const averagePrice = pickFirstNumber(
    [marketData, compData],
    ['averagePrice', 'avgPrice', 'averageSoldPrice', 'avgSoldPrice'],
    calculatedAveragePrice
  );

  const medianPrice = pickFirstNumber(
    [marketData, compData],
    ['medianPrice', 'medianSoldPrice'],
    calculatedMedianPrice || averagePrice
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

  const listingPrice = getListingPrice(listing);

  const projectedSalePrice = pickFirstNumber(
    [roiData, marketData, compData],
    ['targetSalePrice', 'expectedSalePrice', 'estimatedSalePrice', 'projectedSalePrice'],
    0
  );

  const referencePrice = medianPrice || averagePrice || projectedSalePrice;
  const medianAverageDifferencePercent = getPercentDifference(medianPrice, averagePrice);
  const meanAbsoluteDeviation = getMeanAbsoluteDeviation(soldPrices, referencePrice);
  const meanAbsoluteDeviationPercent = referencePrice > 0
    ? meanAbsoluteDeviation / referencePrice
    : 0;

  const rangePercent = referencePrice > 0
    ? (highPrice - lowPrice) / referencePrice
    : 0;

  const listingDifferencePercent = getPercentDifference(listingPrice, referencePrice);
  const projectedDifferencePercent = getPercentDifference(projectedSalePrice, referencePrice);

  const medianAverageScore = scoreMedianAverageAlignment(medianAverageDifferencePercent);
  const deviationScore = scoreMeanDeviation(meanAbsoluteDeviationPercent);
  const rangeScore = scoreRangeWidth(rangePercent);
  const listingScore = listingPrice > 0
    ? scoreListingAlignment(listingDifferencePercent)
    : 45;

  const score = Math.round(
    medianAverageScore * 0.3 +
    deviationScore * 0.3 +
    rangeScore * 0.25 +
    listingScore * 0.15
  );

  const warnings = [];
  const positives = [];

  if (soldPrices.length < 4) {
    warnings.push('Price consistency is hard to verify with fewer than four sold comps.');
  }

  if (!referencePrice || referencePrice <= 0) {
    warnings.push('No reliable reference price was available for consistency checks.');
  }

  if (medianAverageDifferencePercent > 0.18) {
    warnings.push('Average and median prices are not closely aligned.');
  }

  if (meanAbsoluteDeviationPercent > 0.35) {
    warnings.push('Sold prices deviate materially from the market reference.');
  }

  if (rangePercent > 0.65) {
    warnings.push('The market range is too wide for high-confidence pricing.');
  }

  if (listingPrice > 0 && listingDifferencePercent > 0.25) {
    warnings.push('Listing price is not closely aligned with the market reference.');
  }

  if (projectedSalePrice > 0 && projectedDifferencePercent > 0.25) {
    warnings.push('Projected sale price is not closely aligned with the market reference.');
  }

  if (soldPrices.length >= 6) {
    positives.push('Price consistency is supported by a useful sold-comps sample.');
  }

  if (medianAverageDifferencePercent > 0 && medianAverageDifferencePercent <= 0.1) {
    positives.push('Average and median prices are closely aligned.');
  }

  if (meanAbsoluteDeviationPercent > 0 && meanAbsoluteDeviationPercent <= 0.2) {
    positives.push('Sold prices cluster reasonably close to the market reference.');
  }

  if (listingPrice > 0 && listingDifferencePercent <= 0.15) {
    positives.push('Listing price is reasonably aligned with the market reference.');
  }

  return {
    score,
    level: getConsistencyLevel(score),
    compCount: soldPrices.length,
    referencePrice: Number(referencePrice.toFixed(2)),
    averagePrice: Number(averagePrice.toFixed(2)),
    medianPrice: Number(medianPrice.toFixed(2)),
    lowPrice,
    highPrice,
    listingPrice,
    projectedSalePrice,
    medianAverageDifferencePercent: Number(medianAverageDifferencePercent.toFixed(3)),
    meanAbsoluteDeviation: Number(meanAbsoluteDeviation.toFixed(2)),
    meanAbsoluteDeviationPercent: Number(meanAbsoluteDeviationPercent.toFixed(3)),
    rangePercent: Number(rangePercent.toFixed(3)),
    listingDifferencePercent: Number(listingDifferencePercent.toFixed(3)),
    projectedDifferencePercent: Number(projectedDifferencePercent.toFixed(3)),
    warnings,
    positives
  };
}

module.exports = {
  analyzePriceConsistency
};
