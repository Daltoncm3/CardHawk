'use strict';

const { analyzeLiquidity } = require('./intelligence/liquidityAnalyzer');
const { analyzePricing } = require('./intelligence/pricingAnalyzer');
const { analyzeOutliers } = require('./intelligence/outlierAnalyzer');
const { analyzeCompQuality } = require('./intelligence/compQualityAnalyzer');
const { analyzePriceConsistency } = require('./intelligence/priceConsistencyAnalyzer');
const { calculateConfidence } = require('./intelligence/confidenceCalculator');

function asArray(value) {
  return Array.isArray(value) ? value : [];
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

function getScore(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function buildFallbackSummary(data = {}) {
  const score = getScore(data.intelligenceScore || data.confidenceScore);
  const trustLevel = data.trustLevel || 'unreliable';
  const recommendation = data.recommendation || 'review';

  if (recommendation === 'do_not_trust') {
    return 'Market intelligence is unreliable and should not be trusted without deeper manual validation.';
  }

  if (recommendation === 'review') {
    return 'Market intelligence needs manual review before relying on the valuation.';
  }

  if (recommendation === 'trust_with_review') {
    return 'Market intelligence is usable, but conservative review is recommended before making a money decision.';
  }

  if (trustLevel === 'excellent') {
    return 'Market intelligence is strong across the available liquidity, pricing, comp, and consistency signals.';
  }

  if (score >= 70) {
    return 'Market intelligence is generally trustworthy based on the available analyzer signals.';
  }

  return 'Market intelligence is limited and should be treated conservatively.';
}

function summarizeMarketIntelligence(data = {}) {
  if (data.summary && typeof data.summary === 'string') {
    return data.summary;
  }

  return buildFallbackSummary(data);
}

function evaluateMarketIntelligence(input = {}) {
  const liquidityAnalysis = analyzeLiquidity(input);
  const pricingAnalysis = analyzePricing(input);
  const outlierAnalysis = analyzeOutliers(input);
  const compQualityAnalysis = analyzeCompQuality(input);
  const priceConsistencyAnalysis = analyzePriceConsistency(input);

  const confidenceAnalysis = calculateConfidence({
    liquidityAnalysis,
    pricingAnalysis,
    outlierAnalysis,
    compQualityAnalysis,
    priceConsistencyAnalysis
  });

  const warnings = uniqueMessages([
    ...asArray(confidenceAnalysis.warnings),
    ...asArray(liquidityAnalysis.warnings),
    ...asArray(pricingAnalysis.warnings),
    ...asArray(outlierAnalysis.warnings),
    ...asArray(compQualityAnalysis.warnings),
    ...asArray(priceConsistencyAnalysis.warnings)
  ]);

  const positives = uniqueMessages([
    ...asArray(confidenceAnalysis.positives),
    ...asArray(liquidityAnalysis.positives),
    ...asArray(pricingAnalysis.positives),
    ...asArray(outlierAnalysis.positives),
    ...asArray(compQualityAnalysis.positives),
    ...asArray(priceConsistencyAnalysis.positives)
  ]);

  const intelligenceScore = getScore(confidenceAnalysis.confidenceScore);
  const trustLevel = confidenceAnalysis.trustLevel || 'unreliable';
  const recommendation = confidenceAnalysis.recommendation || 'review';

  const result = {
    source: 'market_intelligence_engine',
    intelligenceScore,
    trustLevel,
    liquidity: liquidityAnalysis,
    pricing: pricingAnalysis,
    outlier: outlierAnalysis,
    compQuality: compQualityAnalysis,
    priceConsistency: priceConsistencyAnalysis,
    confidence: confidenceAnalysis,
    warnings,
    positives,
    recommendation,
    summary: confidenceAnalysis.summary
  };

  result.summary = summarizeMarketIntelligence(result);

  return result;
}

module.exports = {
  evaluateMarketIntelligence,
  summarizeMarketIntelligence
};
