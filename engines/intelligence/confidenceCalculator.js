'use strict';

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(toNumber(value, 0))));
}

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

function getAnalyzerScore(analysis) {
  if (!analysis || typeof analysis !== 'object') return 0;
  return clampScore(analysis.score);
}

function getTrustLevel(score) {
  if (score >= 85) return 'excellent';
  if (score >= 72) return 'good';
  if (score >= 55) return 'fair';
  if (score >= 35) return 'weak';
  return 'unreliable';
}

function getRecommendation(score, warningCount, criticalWarningCount) {
  if (criticalWarningCount > 0 || score < 35) return 'do_not_trust';
  if (score < 55 || warningCount >= 5) return 'review';
  if (score < 72 || warningCount >= 3) return 'trust_with_review';
  return 'trust';
}

function getCriticalWarnings(analyses) {
  const criticalWarnings = [];

  if (analyses.liquidity && analyses.liquidity.soldCount < 2) {
    criticalWarnings.push('Market liquidity is too thin to trust without manual review.');
  }

  if (analyses.compQuality && analyses.compQuality.compCount < 3) {
    criticalWarnings.push('Comp sample size is too small for a reliable confidence read.');
  }

  if (analyses.priceConsistency && analyses.priceConsistency.referencePrice <= 0) {
    criticalWarnings.push('No usable reference price is available.');
  }

  if (analyses.outlier && analyses.outlier.extremeOutlierCount >= 2) {
    criticalWarnings.push('Multiple extreme pricing outliers are present.');
  }

  return criticalWarnings;
}

function collectWarnings(analyses, criticalWarnings) {
  return uniqueMessages([
    ...criticalWarnings,
    ...asArray(analyses.liquidity && analyses.liquidity.warnings),
    ...asArray(analyses.pricing && analyses.pricing.warnings),
    ...asArray(analyses.outlier && analyses.outlier.warnings),
    ...asArray(analyses.compQuality && analyses.compQuality.warnings),
    ...asArray(analyses.priceConsistency && analyses.priceConsistency.warnings)
  ]);
}

function collectPositives(analyses) {
  return uniqueMessages([
    ...asArray(analyses.liquidity && analyses.liquidity.positives),
    ...asArray(analyses.pricing && analyses.pricing.positives),
    ...asArray(analyses.outlier && analyses.outlier.positives),
    ...asArray(analyses.compQuality && analyses.compQuality.positives),
    ...asArray(analyses.priceConsistency && analyses.priceConsistency.positives)
  ]);
}

function buildSummary(confidenceScore, trustLevel, recommendation, warnings) {
  if (recommendation === 'do_not_trust') {
    return 'Market intelligence is unreliable and should not be trusted without deeper manual validation.';
  }

  if (recommendation === 'review') {
    return 'Market intelligence is mixed and needs manual review before relying on the valuation.';
  }

  if (recommendation === 'trust_with_review') {
    return 'Market intelligence is usable, but key risk signals should be reviewed before making a money decision.';
  }

  if (trustLevel === 'excellent') {
    return 'Market intelligence is strong, with reliable support across liquidity, comps, pricing, and consistency checks.';
  }

  if (warnings.length > 0) {
    return 'Market intelligence is generally trustworthy, though some conservative review is still warranted.';
  }

  return 'Market intelligence is trustworthy based on the available analyzer signals.';
}

function calculateConfidence(input = {}) {
  const analyses = {
    liquidity: input.liquidity || input.liquidityAnalysis || {},
    pricing: input.pricing || input.pricingAnalysis || {},
    outlier: input.outlier || input.outlierAnalysis || {},
    compQuality: input.compQuality || input.compQualityAnalysis || {},
    priceConsistency: input.priceConsistency || input.priceConsistencyAnalysis || {}
  };

  const liquidityScore = getAnalyzerScore(analyses.liquidity);
  const pricingScore = getAnalyzerScore(analyses.pricing);
  const outlierScore = getAnalyzerScore(analyses.outlier);
  const compQualityScore = getAnalyzerScore(analyses.compQuality);
  const priceConsistencyScore = getAnalyzerScore(analyses.priceConsistency);

  const rawScore =
    liquidityScore * 0.2 +
    pricingScore * 0.2 +
    outlierScore * 0.18 +
    compQualityScore * 0.22 +
    priceConsistencyScore * 0.2;

  const criticalWarnings = getCriticalWarnings(analyses);
  const warnings = collectWarnings(analyses, criticalWarnings);
  const positives = collectPositives(analyses);

  const penalty = Math.min(20, criticalWarnings.length * 10 + Math.max(0, warnings.length - 4) * 2);
  const confidenceScore = clampScore(rawScore - penalty);
  const trustLevel = getTrustLevel(confidenceScore);
  const recommendation = getRecommendation(
    confidenceScore,
    warnings.length,
    criticalWarnings.length
  );

  return {
    confidenceScore,
    trustLevel,
    recommendation,
    componentScores: {
      liquidity: liquidityScore,
      pricing: pricingScore,
      outlier: outlierScore,
      compQuality: compQualityScore,
      priceConsistency: priceConsistencyScore
    },
    positives,
    warnings,
    summary: buildSummary(confidenceScore, trustLevel, recommendation, warnings)
  };
}

module.exports = {
  calculateConfidence
};
