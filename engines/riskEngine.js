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

function clampRiskScore(score) {
  return Math.max(0, Math.min(100, Math.round(toNumber(score, 0))));
}

function getRiskLevel(riskScore) {
  if (riskScore >= 80) return 'critical';
  if (riskScore >= 55) return 'high';
  if (riskScore >= 30) return 'medium';
  return 'low';
}

function getSalePrice(sale = {}) {
  return pickFirstNumber(
    [sale],
    ['price', 'soldPrice', 'salePrice', 'amount', 'totalPrice', 'value'],
    0
  );
}

function getListingPrice(listing = {}, roiData = {}) {
  return pickFirstNumber(
    [listing, roiData],
    ['price', 'currentPrice', 'askingPrice', 'listPrice', 'purchasePrice', 'costBasis', 'cost'],
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
    qualityData.source
  ].map(normalize).join(' ');

  return sourceText.includes('heuristic') || sourceText.includes('fallback');
}

function getConfidence(input = {}) {
  const marketData = input.marketData || {};
  const compData = input.compData || {};
  const qualityData = input.qualityData || {};
  const trendData = input.trendData || {};

  return pickFirstNumber(
    [input, marketData, compData, qualityData, trendData],
    ['confidence', 'confidenceScore', 'marketConfidence', 'marketConfidenceScore', 'qualityScore'],
    0
  );
}

function getSoldCompCount(input = {}) {
  const marketData = input.marketData || {};
  const soldSales = asArray(input.soldSales);
  const compData = input.compData || {};
  const qualityData = input.qualityData || {};

  return Math.max(
    soldSales.length,
    pickFirstNumber(
      [marketData, compData, qualityData],
      ['soldCount', 'recentSoldCount', 'completedSales', 'salesCount', 'compCount', 'usableSoldCompCount'],
      0
    )
  );
}

function getMarketReference(input = {}) {
  const marketData = input.marketData || {};
  const soldSales = asArray(input.soldSales);
  const compData = input.compData || {};

  const soldPrices = soldSales
    .map(getSalePrice)
    .filter((price) => price > 0);

  const averageSoldPrice = getAverage(soldPrices);
  const medianSoldPrice = getMedian(soldPrices);

  return pickFirstNumber(
    [marketData, compData],
    ['referencePrice', 'medianPrice', 'medianSoldPrice', 'averagePrice', 'avgPrice', 'averageSoldPrice', 'marketValue'],
    medianSoldPrice || averageSoldPrice
  );
}

function getPricingSpread(input = {}, referencePrice) {
  const marketData = input.marketData || {};
  const soldSales = asArray(input.soldSales);
  const compData = input.compData || {};

  const soldPrices = soldSales
    .map(getSalePrice)
    .filter((price) => price > 0);

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

  if (!referencePrice || referencePrice <= 0 || !lowPrice || !highPrice || highPrice <= lowPrice) {
    return 0;
  }

  return (highPrice - lowPrice) / referencePrice;
}

function hasSuspiciousListingData(listing = {}) {
  const title = normalize(listing.title);
  const sellerFeedback = pickFirstNumber(
    [listing, listing.seller || {}],
    ['sellerFeedback', 'feedbackScore', 'feedbackCount', 'sellerFeedbackScore'],
    NaN
  );

  const sellerPositivePercent = pickFirstNumber(
    [listing, listing.seller || {}],
    ['sellerPositivePercent', 'positiveFeedbackPercent', 'feedbackPercent'],
    NaN
  );

  const suspiciousTitleTerms = [
    'reprint',
    'proxy',
    'custom',
    'digital',
    'not original',
    'not authentic',
    'facsimile',
    'novelty'
  ];

  const suspiciousTitle = suspiciousTitleTerms.some((term) => title.includes(term));
  const veryLowFeedback = Number.isFinite(sellerFeedback) && sellerFeedback >= 0 && sellerFeedback < 5;
  const poorFeedbackPercent =
    Number.isFinite(sellerPositivePercent) &&
    sellerPositivePercent > 0 &&
    sellerPositivePercent < 95;

  return {
    suspiciousTitle,
    veryLowFeedback,
    poorFeedbackPercent
  };
}

function addRisk(points, message, state) {
  state.riskScore += points;
  state.reasons.push(message);

  if (points >= 20) {
    state.warnings.push(message);
  }
}

function addPositive(message, state) {
  state.positives.push(message);
}

function summarizeRisk(data = {}) {
  const riskLevel = data.riskLevel || getRiskLevel(data.riskScore);
  const riskScore = clampRiskScore(data.riskScore);

  if (riskLevel === 'critical') {
    return 'Critical risk: the listing has one or more dangerous signals that can materially distort expected profit.';
  }

  if (riskLevel === 'high') {
    return 'High risk: the listing may still be viable, but the evidence is not strong enough to trust without manual review.';
  }

  if (riskLevel === 'medium') {
    return 'Medium risk: the listing has some uncertainty, but no clear critical failure signal.';
  }

  if (riskScore <= 15) {
    return 'Low risk: available evidence is generally healthy for a card-flipping decision.';
  }

  return 'Low risk: no major risk signals were found in the available data.';
}

function evaluateRisk(input = {}) {
  const listing = input.listing || {};
  const roiData = input.roiData || {};
  const trendData = input.trendData || {};

  const state = {
    riskScore: 0,
    warnings: [],
    positives: [],
    reasons: []
  };

  const listingPrice = getListingPrice(listing, roiData);
  const estimatedProfit = pickFirstNumber(
    [roiData, listing, input],
    ['estimatedProfit', 'profit', 'netProfit', 'projectedProfit'],
    0
  );
  const roi = pickFirstNumber(
    [roiData, listing, input],
    ['roi', 'roiPercent', 'returnOnInvestment'],
    0
  );
  const estimatedValue = pickFirstNumber(
    [roiData, listing, input.marketData || {}, input.compData || {}],
    ['estimatedValue', 'estimatedSalePrice', 'targetSalePrice', 'projectedSalePrice', 'marketValue'],
    0
  );

  const soldCompCount = getSoldCompCount(input);
  const confidence = getConfidence(input);
  const referenceMarketValue = getMarketReference(input);
  const priceSpreadPercent = getPricingSpread(input, referenceMarketValue);
  const heuristicFallback = isHeuristicFallback(input);
  const condition = normalize(
    listing.condition ||
    (listing.parsed && (listing.parsed.condition || listing.parsed.grade)) ||
    pickFirstValue([input.qualityData || {}], ['condition', 'grade'], '')
  );

  const trendDirection = normalize(
    pickFirstValue([trendData], ['direction', 'trend', 'trendDirection'], '')
  );

  if (!listingPrice || listingPrice <= 0) {
    addRisk(85, 'Invalid or missing listing cost.', state);
  }

  if (soldCompCount <= 0 && estimatedProfit > 25) {
    addRisk(45, 'Projected profit exists without sold-comp support.', state);
  } else if (soldCompCount <= 0) {
    addRisk(25, 'No sold comps available.', state);
  } else if (soldCompCount < 3) {
    addRisk(14, `Only ${soldCompCount} sold comp${soldCompCount === 1 ? '' : 's'} available.`, state);
  } else if (soldCompCount >= 6) {
    addPositive(`Sold-comp support is healthy (${soldCompCount} comps).`, state);
  } else {
    addPositive(`Sold-comp support is usable (${soldCompCount} comps).`, state);
  }

  if (heuristicFallback && confidence > 0 && confidence < 60) {
    addRisk(40, `Heuristic fallback valuation has weak confidence (${confidence}/100).`, state);
  } else if (heuristicFallback) {
    addRisk(18, 'Valuation uses heuristic fallback support.', state);
  }

  if (confidence > 0 && confidence < 45) {
    addRisk(22, `Market confidence is weak (${confidence}/100).`, state);
  } else if (confidence >= 70) {
    addPositive(`Market confidence is acceptable (${confidence}/100).`, state);
  }

  if (roi > 250) {
    const hasStrongCompSupport = soldCompCount >= 8 && confidence >= 80 && !heuristicFallback;

    if (!hasStrongCompSupport) {
      addRisk(40, `ROI appears impossible (${roi}%) without strong comp support.`, state);
    } else {
      addRisk(12, `ROI is unusually high (${roi}%) and should be reviewed.`, state);
    }
  } else if (roi > 150) {
    const hasGoodSupport = soldCompCount >= 5 && confidence >= 70 && !heuristicFallback;

    if (!hasGoodSupport) {
      addRisk(24, `ROI is very high (${roi}%) without enough support.`, state);
    } else {
      addRisk(8, `ROI is high (${roi}%) and should be sanity checked.`, state);
    }
  } else if (roi > 0) {
    addPositive(`ROI is within a realistic range (${roi}%).`, state);
  }

  if (referenceMarketValue > 0 && estimatedValue > referenceMarketValue * 3) {
    addRisk(38, 'Estimated value is more than 3x supported market value.', state);
  } else if (referenceMarketValue > 0 && estimatedValue > referenceMarketValue * 2) {
    addRisk(20, 'Estimated value is more than 2x supported market value.', state);
  }

  if (priceSpreadPercent > 1.2) {
    addRisk(35, 'Severe pricing inconsistency across comparable sales.', state);
  } else if (priceSpreadPercent > 0.75) {
    addRisk(20, 'Wide pricing spread across comparable sales.', state);
  } else if (priceSpreadPercent > 0 && priceSpreadPercent <= 0.45) {
    addPositive('Comparable pricing is reasonably consistent.', state);
  }

  const suspiciousListing = hasSuspiciousListingData(listing);

  if (suspiciousListing.suspiciousTitle) {
    addRisk(45, 'Listing title contains authenticity or proxy warning terms.', state);
  }

  if (suspiciousListing.veryLowFeedback) {
    addRisk(18, 'Seller has very low feedback history.', state);
  }

  if (suspiciousListing.poorFeedbackPercent) {
    addRisk(22, 'Seller feedback percentage is weak.', state);
  }

  if (['sharp_down', 'strong_down', 'declining', 'down'].includes(trendDirection)) {
    addRisk(12, 'Market trend appears to be declining.', state);
  } else if (['up', 'strong_up', 'rising'].includes(trendDirection)) {
    addPositive('Market trend appears favorable.', state);
  }

  if (!condition || condition === 'unknown') {
    addRisk(6, 'Condition is unknown.', state);
  } else {
    addPositive('Condition data is present.', state);
  }

  if (estimatedProfit > 0 && listingPrice > 0) {
    addPositive('Projected profit and listing cost are present.', state);
  }

  const riskScore = clampRiskScore(state.riskScore);
  const riskLevel = getRiskLevel(riskScore);

  const result = {
    riskScore,
    riskLevel,
    warnings: uniqueMessages(state.warnings),
    positives: uniqueMessages(state.positives),
    reasons: uniqueMessages(state.reasons),
    summary: ''
  };

  result.summary = summarizeRisk(result);

  return result;
}

module.exports = {
  evaluateRisk,
  summarizeRisk
};
