'use strict';

const SOURCE = 'shadow_valuation_engine';
const VERSION = 'shadow-valuation-engine-v1';
const MIN_EXACT_SALES_FOR_VALUATION = 3;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function roundMoney(value) {
  return Math.round(toNumber(value, 0) * 100) / 100;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function daysBetween(later, earlier) {
  const laterDate = normalizeDate(later);
  const earlierDate = normalizeDate(earlier);
  if (!laterDate || !earlierDate) return null;
  return Math.floor((laterDate.getTime() - earlierDate.getTime()) / 86400000);
}

function getPrice(record = {}) {
  return toNumber(record.soldPrice ?? record.totalPaid ?? record.price ?? record.value, 0);
}

function isUsableExactMatch(record = {}) {
  return record &&
    record.classification === 'exact_match' &&
    record.valuationEligible === true &&
    record.evidenceType !== 'active_context' &&
    record.evidenceType !== 'active' &&
    record.evidenceType !== 'aggregate_market_price' &&
    getPrice(record) > 0;
}

function getAcceptedExactMatches(comparisonResults = {}) {
  return asArray(comparisonResults.acceptedExactMatches).filter(isUsableExactMatch);
}

function percentile(values = [], p = 50) {
  const sorted = values
    .map((value) => toNumber(value, NaN))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);

  if (!sorted.length) return null;
  if (sorted.length === 1) return roundMoney(sorted[0]);

  const position = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const weight = position - lower;

  return roundMoney(sorted[lower] * (1 - weight) + sorted[upper] * weight);
}

function median(values = []) {
  return percentile(values, 50);
}

function trimmedMean(values = []) {
  const sorted = values
    .map((value) => toNumber(value, NaN))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);

  if (!sorted.length) return null;
  if (sorted.length < 5) {
    return roundMoney(sorted.reduce((sum, value) => sum + value, 0) / sorted.length);
  }

  const trimCount = Math.max(1, Math.floor(sorted.length * 0.15));
  const trimmed = sorted.slice(trimCount, sorted.length - trimCount);
  const sample = trimmed.length ? trimmed : sorted;
  return roundMoney(sample.reduce((sum, value) => sum + value, 0) / sample.length);
}

function recencyWeight(record = {}, asOf) {
  const ageDays = daysBetween(asOf, record.soldAt);
  if (ageDays === null || ageDays < 0) return 0.35;
  if (ageDays <= 30) return 1;
  if (ageDays <= 90) return 0.78;
  if (ageDays <= 180) return 0.5;
  return 0.22;
}

function weightedAverage(records = [], asOf) {
  let weightedTotal = 0;
  let totalWeight = 0;

  for (const record of records) {
    const price = getPrice(record);
    if (price <= 0) continue;

    const qualityWeight = clamp(toNumber(record.confidence?.evidenceQualityScore ?? record.evidenceQualityScore, 70) / 100, 0.2, 1);
    const weight = recencyWeight(record, asOf) * qualityWeight;
    weightedTotal += price * weight;
    totalWeight += weight;
  }

  if (!totalWeight) return null;
  return roundMoney(weightedTotal / totalWeight);
}

function summarizeTrend(records = [], asOf) {
  const sorted = records
    .filter((record) => normalizeDate(record.soldAt))
    .sort((a, b) => normalizeDate(a.soldAt) - normalizeDate(b.soldAt));

  if (sorted.length < 4) {
    return {
      direction: 'unknown',
      explanation: 'Not enough exact sold evidence to summarize directional movement.',
      intermediate: {
        olderAverage: null,
        recentAverage: null,
        percentageChange: null
      }
    };
  }

  const midpoint = Math.floor(sorted.length / 2);
  const older = sorted.slice(0, midpoint);
  const recent = sorted.slice(midpoint);
  const avg = (items) => roundMoney(items.reduce((sum, item) => sum + getPrice(item), 0) / items.length);
  const olderAverage = avg(older);
  const recentAverage = avg(recent);
  const percentageChange = olderAverage > 0 ? Math.round(((recentAverage - olderAverage) / olderAverage) * 1000) / 10 : null;
  let direction = 'stable';

  if (percentageChange !== null && percentageChange >= 12) direction = 'rising';
  else if (percentageChange !== null && percentageChange <= -12) direction = 'cooling';

  return {
    direction,
    explanation: `Recent exact sold evidence is ${direction}; this is reported as context only and does not alter the valuation formula yet.`,
    intermediate: {
      olderAverage,
      recentAverage,
      percentageChange
    }
  };
}

function getInsufficientReason({ canonicalIdentity = {}, exactMatches = [], comparisonResults = {} } = {}) {
  if (!canonicalIdentity || !canonicalIdentity.canonicalIdentityKey) return 'canonical_identity_missing';
  if (canonicalIdentity.eligibility?.exactCompEligible === false) return 'canonical_identity_not_exact_comp_eligible';
  if (!asArray(comparisonResults.acceptedExactMatches).length) {
    if (asArray(comparisonResults.staleMatches).length) return 'stale_only_exact_evidence';
    if (asArray(comparisonResults.contextualMatches).length) return 'contextual_matches_only';
    if (asArray(comparisonResults.rejectedMatches).length) return 'all_records_rejected';
    return 'no_exact_sold_matches';
  }
  if (exactMatches.length < MIN_EXACT_SALES_FOR_VALUATION) return 'fewer_than_three_exact_sold_matches';
  return '';
}

function getConfidence({ exactMatches = [], priceSpreadRatio = 0, trendSummary = {} } = {}) {
  let confidence = 32;

  confidence += Math.min(34, exactMatches.length * 6);
  confidence += Math.min(12, average(exactMatches.map((record) => record.confidence?.evidenceQualityScore ?? record.evidenceQualityScore ?? 0)) * 0.12);
  confidence += Math.min(8, average(exactMatches.map((record) => record.confidence?.identityConfidence ?? record.identityConfidence ?? 0)) * 0.08);

  if (priceSpreadRatio > 0.65) confidence -= 18;
  else if (priceSpreadRatio > 0.4) confidence -= 10;
  else if (priceSpreadRatio <= 0.18) confidence += 6;

  if (['rising', 'cooling'].includes(trendSummary.direction)) confidence -= 4;
  if (exactMatches.length < 5) confidence = Math.min(confidence, 68);

  return Math.max(0, Math.min(100, Math.round(confidence)));
}

function average(values = []) {
  const valid = values.map(Number).filter(Number.isFinite);
  if (!valid.length) return 0;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function makeInsufficientResult(input = {}, reason = '') {
  const canonicalIdentity = asObject(input.canonicalIdentity);
  const comparisonResults = asObject(input.canonicalSoldComparisonResults || input.comparisonResults);
  const exactMatchCount = asArray(comparisonResults.acceptedExactMatches).filter(isUsableExactMatch).length;

  return {
    source: SOURCE,
    version: VERSION,
    evidenceOnly: true,
    productionImpact: 'none',
    decisionImpact: 'none',
    canonicalIdentityKey: canonicalIdentity.canonicalIdentityKey || '',
    insufficientEvidence: true,
    insufficientEvidenceReason: reason,
    fairMarketRange: null,
    recommendedMarketValue: null,
    valuationConfidence: 0,
    evidenceSummary: {
      exactMatchCount,
      contextualMatchCount: asArray(comparisonResults.contextualMatches).length,
      rejectedMatchCount: asArray(comparisonResults.rejectedMatches).length,
      staleMatchCount: asArray(comparisonResults.staleMatches).length,
      insufficientIdentityMatchCount: asArray(comparisonResults.insufficientIdentityMatches).length,
      activeEvidenceUsed: false,
      contextualEvidenceUsed: false,
      rejectedEvidenceUsed: false
    },
    marketTrendSummary: {
      direction: 'unknown',
      explanation: 'No shadow valuation trend summary is available without sufficient exact sold evidence.',
      intermediate: {
        olderAverage: null,
        recentAverage: null,
        percentageChange: null
      }
    },
    valuationDiagnostics: {
      minimumExactSalesRequired: MIN_EXACT_SALES_FOR_VALUATION,
      exactMatchesUsed: [],
      ignoredContextualMatches: asArray(comparisonResults.contextualMatches).length,
      ignoredRejectedMatches: asArray(comparisonResults.rejectedMatches).length,
      ignoredStaleMatches: asArray(comparisonResults.staleMatches).length,
      ignoredActiveListings: asArray(input.canonicalSoldEvidenceRecords).filter((record) => /active/.test(String(record.evidenceType || ''))).length,
      method: 'exact_sold_only_no_estimate',
      intermediateCalculations: {}
    },
    summary: summarizeShadowValuation({ insufficientEvidence: true, insufficientEvidenceReason: reason })
  };
}

function calculateShadowValuation(input = {}) {
  const canonicalIdentity = asObject(input.canonicalIdentity);
  const comparisonResults = asObject(input.canonicalSoldComparisonResults || input.comparisonResults);
  const asOf = input.asOf || new Date().toISOString();
  const exactMatches = getAcceptedExactMatches(comparisonResults);
  const insufficientReason = getInsufficientReason({ canonicalIdentity, exactMatches, comparisonResults });

  if (insufficientReason) return makeInsufficientResult(input, insufficientReason);

  const prices = exactMatches.map(getPrice).filter((price) => price > 0).sort((a, b) => a - b);
  const medianPrice = median(prices);
  const lowerQuartile = percentile(prices, 25);
  const upperQuartile = percentile(prices, 75);
  const p10 = percentile(prices, 10);
  const p90 = percentile(prices, 90);
  const trimmedAverage = trimmedMean(prices);
  const timeWeightedAverage = weightedAverage(exactMatches, asOf);
  const recommendedMarketValue = roundMoney((medianPrice * 0.6) + (trimmedAverage * 0.25) + (timeWeightedAverage * 0.15));
  const spreadRatio = medianPrice > 0 ? roundMoney((p90 - p10) / medianPrice) : 0;
  const trendSummary = summarizeTrend(exactMatches, asOf);
  const confidence = getConfidence({ exactMatches, priceSpreadRatio: spreadRatio, trendSummary });
  const volatilityBuffer = clamp(spreadRatio * 0.12, 0.02, 0.16);
  const floorValue = roundMoney(Math.min(lowerQuartile, recommendedMarketValue * (1 - 0.08 - volatilityBuffer)));
  const ceilingValue = roundMoney(Math.max(upperQuartile, recommendedMarketValue * (1 + 0.08 + volatilityBuffer)));

  const result = {
    source: SOURCE,
    version: VERSION,
    evidenceOnly: true,
    productionImpact: 'none',
    decisionImpact: 'none',
    canonicalIdentityKey: canonicalIdentity.canonicalIdentityKey || '',
    insufficientEvidence: false,
    insufficientEvidenceReason: '',
    fairMarketRange: {
      floorValue,
      expectedValue: recommendedMarketValue,
      ceilingValue,
      explanation: 'Range is derived only from accepted exact canonical sold matches using median, percentile, trimmed-average, and recorded recency diagnostics.'
    },
    recommendedMarketValue,
    valuationConfidence: confidence,
    evidenceSummary: {
      exactMatchCount: exactMatches.length,
      contextualMatchCount: asArray(comparisonResults.contextualMatches).length,
      rejectedMatchCount: asArray(comparisonResults.rejectedMatches).length,
      staleMatchCount: asArray(comparisonResults.staleMatches).length,
      insufficientIdentityMatchCount: asArray(comparisonResults.insufficientIdentityMatches).length,
      activeEvidenceUsed: false,
      contextualEvidenceUsed: false,
      rejectedEvidenceUsed: false
    },
    marketTrendSummary: trendSummary,
    valuationDiagnostics: {
      minimumExactSalesRequired: MIN_EXACT_SALES_FOR_VALUATION,
      exactMatchesUsed: exactMatches.map((record) => ({
        recordId: record.recordId || record.id || record.marketplaceSaleId || null,
        soldAt: record.soldAt || null,
        soldPrice: getPrice(record),
        evidenceType: record.evidenceType || '',
        classification: record.classification || ''
      })),
      ignoredContextualMatches: asArray(comparisonResults.contextualMatches).length,
      ignoredRejectedMatches: asArray(comparisonResults.rejectedMatches).length,
      ignoredStaleMatches: asArray(comparisonResults.staleMatches).length,
      ignoredActiveListings: asArray(input.canonicalSoldEvidenceRecords).filter((record) => /active/.test(String(record.evidenceType || ''))).length,
      method: 'exact_canonical_sold_percentile_median_blend',
      intermediateCalculations: {
        sortedPrices: prices,
        medianPrice,
        lowerQuartile,
        upperQuartile,
        percentile10: p10,
        percentile90: p90,
        trimmedAverage,
        timeWeightedAverage,
        priceSpreadRatio: spreadRatio,
        volatilityBuffer
      }
    },
    summary: ''
  };

  result.summary = summarizeShadowValuation(result);
  return result;
}

function evaluateShadowValuation(input = {}) {
  return calculateShadowValuation(input);
}

function summarizeShadowValuation(result = {}) {
  if (result.insufficientEvidence) {
    return `Shadow valuation unavailable: ${result.insufficientEvidenceReason || 'insufficient exact sold evidence'}.`;
  }

  return `Shadow valuation uses ${result.evidenceSummary?.exactMatchCount || 0} accepted exact canonical sold matches; production impact is none.`;
}

module.exports = {
  SOURCE,
  VERSION,
  MIN_EXACT_SALES_FOR_VALUATION,
  calculateShadowValuation,
  evaluateShadowValuation,
  summarizeShadowValuation
};
