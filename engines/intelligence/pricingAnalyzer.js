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

function getSpreadPercent(low, high, midpoint) {
  if (!midpoint || midpoint <= 0) return 0;
  return (high - low) / midpoint;
}

function getPricePosition(listingPrice, marketPrice) {
  if (!listingPrice || !marketPrice) return 0;
  return (listingPrice - marketPrice) / marketPrice;
}

function scoreMarketSpread(spreadPercent) {
  if (spreadPercent <= 0) return 45;
  if (spreadPercent <= 0.18) return 100;
  if (spreadPercent <= 0.3) return 85;
  if (spreadPercent <= 0.45) return 65;
  if (spreadPercent <= 0.65) return 40;
  return 20;
}

function scoreListingPosition(positionPercent) {
  const absolutePosition = Math.abs(positionPercent);

  if (absolutePosition <= 0.05) return 100;
  if (absolutePosition <= 0.1) return 85;
  if (absolutePosition <= 0.18) return 65;
  if (absolutePosition <= 0.3) return 40;
  return 20;
}

function scoreDataDepth(priceCount) {
  if (priceCount >= 20) return 100;
  if (priceCount >= 12) return 85;
  if (priceCount >= 6) return 65;
  if (priceCount >= 3) return 40;
  if (priceCount >= 1) return 25;
  return 10;
}

function getPricingLevel(score) {
  if (score >= 85) return 'excellent';
  if (score >= 70) return 'good';
  if (score >= 50) return 'fair';
  if (score >= 30) return 'weak';
  return 'unreliable';
}

function analyzePricing(input = {}) {
  const marketData = input.marketData || {};
  const soldSales = asArray(input.soldSales);
  const compData = input.compData || {};
  const roiData = input.roiData || {};
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

  const listingPrice = getListingPrice(listing);

  const targetPrice = pickFirstNumber(
    [roiData, marketData, compData],
    ['targetSalePrice', 'expectedSalePrice', 'estimatedSalePrice', 'projectedSalePrice'],
    marketMedianPrice || marketAveragePrice
  );

  const referencePrice = marketMedianPrice || marketAveragePrice || targetPrice;
  const spreadPercent = getSpreadPercent(marketLowPrice, marketHighPrice, referencePrice);
  const listingPositionPercent = getPricePosition(listingPrice, referencePrice);
  const targetPositionPercent = getPricePosition(targetPrice, referencePrice);

  const spreadScore = scoreMarketSpread(spreadPercent);
  const listingPositionScore = listingPrice > 0
    ? scoreListingPosition(listingPositionPercent)
    : 45;
  const dataDepthScore = scoreDataDepth(soldPrices.length);

  const score = Math.round(
    spreadScore * 0.4 +
    listingPositionScore * 0.35 +
    dataDepthScore * 0.25
  );

  const warnings = [];
  const positives = [];

  if (soldPrices.length < 4) {
    warnings.push('Pricing is based on limited sold-sale data.');
  }

  if (!referencePrice || referencePrice <= 0) {
    warnings.push('No reliable market reference price was available.');
  }

  if (spreadPercent > 0.65) {
    warnings.push('Comparable sale prices are widely spread, reducing pricing reliability.');
  }

  if (listingPrice > 0 && listingPositionPercent > 0.18) {
    warnings.push('Listing price appears meaningfully above the current market reference.');
  }

  if (targetPrice > 0 && targetPositionPercent > 0.18) {
    warnings.push('Projected sale price may be aggressive compared with market pricing.');
  }

  if (soldPrices.length >= 6) {
    positives.push('Pricing has a useful base of recent sold-sale data.');
  }

  if (spreadPercent > 0 && spreadPercent <= 0.3) {
    positives.push('Comparable sale prices are reasonably consistent.');
  }

  if (listingPrice > 0 && Math.abs(listingPositionPercent) <= 0.1) {
    positives.push('Listing price is close to the market reference price.');
  }

  return {
    score,
    level: getPricingLevel(score),
    listingPrice,
    targetPrice,
    marketAveragePrice: Number(marketAveragePrice.toFixed(2)),
    marketMedianPrice: Number(marketMedianPrice.toFixed(2)),
    marketLowPrice,
    marketHighPrice,
    spreadPercent: Number(spreadPercent.toFixed(3)),
    listingPositionPercent: Number(listingPositionPercent.toFixed(3)),
    targetPositionPercent: Number(targetPositionPercent.toFixed(3)),
    compPriceCount: soldPrices.length,
    warnings,
    positives
  };
}

module.exports = {
  analyzePricing
};
