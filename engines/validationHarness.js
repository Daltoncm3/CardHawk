'use strict';

const SOURCE = 'validation_harness';

const RECOMMENDATIONS = ['BUY_NOW', 'STRONG_WATCH', 'WATCH', 'MONITOR', 'PASS'];

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function toNullableNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeRecommendation(value) {
  const recommendation = String(value || '').trim().toUpperCase();

  if (recommendation === 'REJECT' || recommendation === 'AVOID' || recommendation === 'DO_NOT_BUY') {
    return 'PASS';
  }

  if (recommendation === 'BUY' || recommendation === 'BUY_NOW_ALLOWED') {
    return 'BUY_NOW';
  }

  return RECOMMENDATIONS.includes(recommendation) ? recommendation : 'MONITOR';
}

function average(values) {
  const usable = asArray(values).map(toNullableNumber).filter((value) => value !== null);
  if (!usable.length) return null;
  return Math.round((usable.reduce((sum, value) => sum + value, 0) / usable.length) * 100) / 100;
}

function pickNumber(sources, keys, fallback = null) {
  for (const source of asArray(sources)) {
    const object = asObject(source);

    for (const key of asArray(keys)) {
      if (object[key] !== undefined && object[key] !== null && object[key] !== '') {
        const value = toNullableNumber(object[key]);
        if (value !== null) return value;
      }
    }
  }

  return fallback;
}

function pickString(sources, keys, fallback = '') {
  for (const source of asArray(sources)) {
    const object = asObject(source);

    for (const key of asArray(keys)) {
      if (object[key] !== undefined && object[key] !== null && object[key] !== '') {
        return String(object[key]);
      }
    }
  }

  return fallback;
}

function getListingId(listing = {}) {
  return (
    listing.listingId ||
    listing.ebayItemId ||
    listing.itemId ||
    listing.id ||
    listing.listing?.ebayItemId ||
    listing.listing?.itemId ||
    listing.listing?.id ||
    ''
  );
}

function getTitle(listing = {}) {
  return String(listing.title || listing.listing?.title || '');
}

function getDecisionData(listing = {}) {
  return asObject(listing.decision || listing.decisionData || listing.scoring?.decision || {});
}

function getDealGate(listing = {}) {
  return asObject(listing.dealGate || listing.gate || {});
}

function getMarketData(listing = {}) {
  return asObject(listing.marketData || listing.valueData || listing.scoring?.marketData || {});
}

function getCompData(listing = {}) {
  return asObject(listing.compData || listing.scoring?.compData || {});
}

function getFinalRecommendation(listing = {}) {
  const gate = getDealGate(listing);
  const decisionData = getDecisionData(listing);

  if (gate.passed === true || gate.buyNowAllowed === true || gate.shouldBuy === true) {
    return 'BUY_NOW';
  }

  if (gate.passed === false || gate.decision === 'REJECT' || gate.recommendation === 'reject') {
    return 'PASS';
  }

  return normalizeRecommendation(
    listing.finalRecommendation ||
      listing.recommendation ||
      listing.decisionRecommendation ||
      decisionData.recommendation ||
      decisionData.decision ||
      listing.decision
  );
}

function getDecisionScore(listing = {}) {
  const decisionData = getDecisionData(listing);

  return pickNumber([
    listing,
    decisionData
  ], [
    'decisionScore',
    'score'
  ], null);
}

function getDecisionConfidence(listing = {}) {
  const decisionData = getDecisionData(listing);

  return pickNumber([
    listing,
    decisionData,
    getMarketData(listing),
    getCompData(listing)
  ], [
    'decisionConfidence',
    'confidence',
    'marketConfidence',
    'pricingConfidence'
  ], null);
}

function getExpectedValue(listing = {}) {
  const marketData = getMarketData(listing);

  return pickNumber([
    listing,
    marketData
  ], [
    'expectedValue',
    'marketValue',
    'estimatedValue',
    'estimatedSalePrice'
  ], null);
}

function getExpectedValueLow(listing = {}) {
  return pickNumber([
    listing,
    getMarketData(listing)
  ], [
    'expectedValueLow'
  ], null);
}

function getExpectedValueHigh(listing = {}) {
  return pickNumber([
    listing,
    getMarketData(listing)
  ], [
    'expectedValueHigh'
  ], null);
}

function getListingCost(listing = {}) {
  return pickNumber([
    listing,
    listing.listing || {},
    listing.roiData || {},
    listing.scoring?.roiData || {}
  ], [
    'listingCost',
    'totalCost',
    'cost',
    'price',
    'currentPrice'
  ], null);
}

function getProjectedROI(listing = {}) {
  return pickNumber([
    listing,
    listing.roiData || {},
    listing.scoring?.roiData || {},
    getDecisionData(listing)
  ], [
    'projectedROI',
    'projectedRoi',
    'roi'
  ], null);
}

function getProjectedProfit(listing = {}) {
  return pickNumber([
    listing,
    listing.roiData || {},
    listing.scoring?.roiData || {},
    getDecisionData(listing)
  ], [
    'projectedProfit',
    'estimatedProfit',
    'profit'
  ], null);
}

function collectReasons(listing = {}) {
  const gate = getDealGate(listing);
  const decisionData = getDecisionData(listing);
  const qualityData = asObject(listing.qualityData || listing.scoring?.qualityData || {});
  const marketIntelligenceData = asObject(listing.marketIntelligenceData || listing.scoring?.marketIntelligenceData || {});

  const reasons = [
    ...asArray(gate.positives),
    ...asArray(decisionData.positives),
    ...asArray(decisionData.reasons),
    ...asArray(qualityData.positives),
    ...asArray(marketIntelligenceData.positives)
  ];

  return dedupeStrings(reasons).slice(0, 8);
}

function collectWarnings(listing = {}) {
  const gate = getDealGate(listing);
  const decisionData = getDecisionData(listing);
  const compData = getCompData(listing);
  const marketData = getMarketData(listing);
  const qualityData = asObject(listing.qualityData || listing.scoring?.qualityData || {});
  const riskData = asObject(listing.riskData || listing.scoring?.riskData || {});
  const marketIntelligenceData = asObject(listing.marketIntelligenceData || listing.scoring?.marketIntelligenceData || {});

  const warnings = [
    ...asArray(gate.reasons),
    ...asArray(gate.rejectionReasons),
    ...asArray(gate.warnings),
    ...asArray(decisionData.warnings),
    ...asArray(decisionData.blockingFactors),
    ...asArray(compData.warnings),
    ...asArray(marketData.warnings),
    ...asArray(qualityData.warnings),
    ...asArray(riskData.warnings),
    ...asArray(marketIntelligenceData.warnings)
  ];

  return dedupeStrings(warnings).slice(0, 10);
}

function dedupeStrings(values = []) {
  const seen = new Set();
  const result = [];

  for (const value of asArray(values)) {
    if (value === null || value === undefined || value === '') continue;

    const text = String(value).trim();
    const key = text.toLowerCase();

    if (!text || seen.has(key)) continue;

    seen.add(key);
    result.push(text);
  }

  return result;
}

function isFallbackValuation(listing = {}) {
  const marketData = getMarketData(listing);
  const compData = getCompData(listing);

  const sourceText = [
    listing.compSource,
    listing.marketSource,
    listing.valueSource,
    marketData.source,
    marketData.method,
    marketData.valueSource,
    marketData.valuationSource,
    compData.source,
    compData.method,
    compData.compSource
  ].join(' ').toLowerCase();

  return sourceText.includes('fallback') || sourceText.includes('heuristic');
}

function getUsableCompCount(listing = {}) {
  const compData = getCompData(listing);
  const marketData = getMarketData(listing);

  return pickNumber([
    compData,
    marketData,
    listing
  ], [
    'usableCompCount',
    'selectedCompCount',
    'strongCompCount',
    'soldCompCount',
    'compCount'
  ], 0);
}

function getPricingSpread(listing = {}) {
  const compData = getCompData(listing);
  const marketData = getMarketData(listing);

  return pickNumber([
    compData,
    marketData,
    listing
  ], [
    'pricingSpread',
    'priceSpread',
    'spread'
  ], 0);
}

function isWidePricingSpread(listing = {}) {
  const spread = getPricingSpread(listing);

  if (spread > 1) return spread >= 35;
  return spread >= 0.35;
}

function getMarketConsistency(listing = {}) {
  return pickString([
    getCompData(listing),
    getMarketData(listing),
    listing
  ], [
    'marketConsistency',
    'consistency',
    'pricingConsistency'
  ], '').toLowerCase();
}

function buildFlags(listing = {}, report = {}) {
  const flags = [];
  const isBuyNow = report.finalRecommendation === 'BUY_NOW';
  const confidence = toNumber(report.decisionConfidence, 0);
  const usableCompCount = getUsableCompCount(listing);
  const marketConsistency = getMarketConsistency(listing);

  if (isBuyNow && confidence > 0 && confidence < 70) {
    flags.push({
      type: 'low_confidence_buy_now',
      severity: 'high',
      message: `BUY_NOW has low decision confidence (${confidence}/100).`
    });
  }

  if (isBuyNow && usableCompCount < 3) {
    flags.push({
      type: 'thin_market_buy_now',
      severity: 'high',
      message: `BUY_NOW is supported by only ${usableCompCount} usable comp${usableCompCount === 1 ? '' : 's'}.`
    });
  }

  if (isBuyNow && isFallbackValuation(listing)) {
    flags.push({
      type: 'fallback_valuation_buy_now',
      severity: 'high',
      message: 'BUY_NOW uses fallback or heuristic valuation evidence.'
    });
  }

  if (isBuyNow && (isWidePricingSpread(listing) || marketConsistency === 'volatile')) {
    flags.push({
      type: 'wide_pricing_spread_buy_now',
      severity: 'medium',
      message: 'BUY_NOW has wide pricing spread or volatile market consistency.'
    });
  }

  return flags;
}

function evaluateListing(listing = {}) {
  const report = {
    source: SOURCE,
    listingId: getListingId(listing),
    title: getTitle(listing),
    finalRecommendation: getFinalRecommendation(listing),
    decisionScore: getDecisionScore(listing),
    decisionConfidence: getDecisionConfidence(listing),
    expectedValue: getExpectedValue(listing),
    expectedValueLow: getExpectedValueLow(listing),
    expectedValueHigh: getExpectedValueHigh(listing),
    listingCost: getListingCost(listing),
    projectedROI: getProjectedROI(listing),
    projectedProfit: getProjectedProfit(listing),
    keyReasons: collectReasons(listing),
    keyWarnings: collectWarnings(listing)
  };

  report.flags = buildFlags(listing, report);

  return report;
}

function evaluateBatch(listings = [], options = {}) {
  const safeListings = asArray(listings);
  const perListingReports = safeListings.map(evaluateListing);
  const aggregate = buildAggregateStats(perListingReports);
  const flaggedListings = perListingReports.filter((report) => report.flags.length > 0);

  return {
    source: SOURCE,
    generatedAt: new Date().toISOString(),
    listingCount: perListingReports.length,
    perListingReports,
    aggregate,
    flaggedListings,
    flags: summarizeFlags(flaggedListings),
    summary: buildSummary(perListingReports, aggregate, flaggedListings),
    options: asObject(options)
  };
}

function buildAggregateStats(reports = []) {
  const counts = {
    BUY_NOW: 0,
    STRONG_WATCH: 0,
    WATCH: 0,
    MONITOR: 0,
    PASS: 0
  };

  for (const report of asArray(reports)) {
    const recommendation = normalizeRecommendation(report.finalRecommendation);
    counts[recommendation] += 1;
  }

  return {
    ...counts,
    averageConfidence: average(reports.map((report) => report.decisionConfidence)),
    averageProjectedROI: average(reports.map((report) => report.projectedROI)),
    averageProjectedProfit: average(reports.map((report) => report.projectedProfit))
  };
}

function summarizeFlags(flaggedListings = []) {
  const counts = {
    lowConfidenceBuyNow: 0,
    thinMarketBuyNow: 0,
    fallbackValuationBuyNow: 0,
    widePricingSpreadBuyNow: 0
  };

  for (const report of asArray(flaggedListings)) {
    for (const flag of asArray(report.flags)) {
      if (flag.type === 'low_confidence_buy_now') counts.lowConfidenceBuyNow += 1;
      if (flag.type === 'thin_market_buy_now') counts.thinMarketBuyNow += 1;
      if (flag.type === 'fallback_valuation_buy_now') counts.fallbackValuationBuyNow += 1;
      if (flag.type === 'wide_pricing_spread_buy_now') counts.widePricingSpreadBuyNow += 1;
    }
  }

  return counts;
}

function buildSummary(reports = [], aggregate = {}, flaggedListings = []) {
  const total = reports.length;
  const buyNowCount = toNumber(aggregate.BUY_NOW, 0);
  const flagCount = flaggedListings.length;

  if (!total) {
    return 'Validation harness did not receive any scored listings.';
  }

  const parts = [
    `Validation harness reviewed ${total} scored listing${total === 1 ? '' : 's'}.`,
    `${buyNowCount} listing${buyNowCount === 1 ? '' : 's'} finished as BUY_NOW.`
  ];

  if (flagCount > 0) {
    parts.push(`${flagCount} listing${flagCount === 1 ? '' : 's'} had validation flags for review.`);
  } else {
    parts.push('No BUY_NOW validation flags were detected.');
  }

  return parts.join(' ');
}

function summarizeValidation(data = {}) {
  if (Array.isArray(data)) return evaluateBatch(data);
  return evaluateBatch(data.listings || data.records || data.items || []);
}

module.exports = {
  evaluateBatch,
  evaluateListing,
  summarizeValidation,

  buildAggregateStats,
  summarizeFlags,
  normalizeRecommendation
};
