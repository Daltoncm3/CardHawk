'use strict';

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(toNumber(value, 0))));
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

function countFreshSoldEvidence(evidence) {
  return asArray(evidence).filter((item) => {
    return item &&
      item.evidenceType === 'true_sold' &&
      Number.isFinite(toNumber(item.ageDays, NaN)) &&
      toNumber(item.ageDays) <= 90;
  }).length;
}

function countStaleSoldEvidence(evidence) {
  return asArray(evidence).filter((item) => {
    return item &&
      item.evidenceType === 'true_sold' &&
      Number.isFinite(toNumber(item.ageDays, NaN)) &&
      toNumber(item.ageDays) > 180;
  }).length;
}

function getStatusFromScore(score) {
  if (score >= 85) return 'strong';
  if (score >= 68) return 'adequate';
  if (score >= 45) return 'limited';
  if (score >= 25) return 'insufficient';
  return 'unreliable';
}

function scoreSoldEvidence(evidenceSummary) {
  const trueSoldCount = toNumber(evidenceSummary.trueSoldCount, 0);
  const activeOnlyFlag = evidenceSummary.activeOnlyFlag === true;
  const fallbackOnlyFlag = evidenceSummary.fallbackOnlyFlag === true;
  const warnings = [];

  let score = 0;
  if (trueSoldCount >= 8) score = 96;
  else if (trueSoldCount >= 5) score = 82;
  else if (trueSoldCount >= 3) score = 68;
  else if (trueSoldCount >= 1) score = 35;
  else score = 5;

  if (activeOnlyFlag) warnings.push('Only active listing evidence is available; it is not sold support.');
  if (fallbackOnlyFlag) warnings.push('Only fallback or unknown evidence is available.');
  if (trueSoldCount > 0 && trueSoldCount < 3) warnings.push('Sold evidence sample is below the suggested minimum of 3.');
  if (trueSoldCount <= 0) warnings.push('No true sold evidence is available.');

  if (activeOnlyFlag || fallbackOnlyFlag) score = Math.min(score, 18);

  return {
    status: getStatusFromScore(score),
    score: clampScore(score),
    trueSoldCount,
    minimumSuggested: 3,
    activeOnlyFlag,
    fallbackOnlyFlag,
    warnings
  };
}

function scoreComparableQuality(comparableQuality) {
  const distribution = comparableQuality.qualityDistribution || {};
  const averageComparableQualityScore = toNumber(comparableQuality.averageComparableQualityScore, 0);
  const weakCount = toNumber(distribution.weak, 0);
  const rejectCount = toNumber(distribution.reject, 0);
  const scoredComparableCount = toNumber(comparableQuality.scoredComparableCount, 0);
  const warnings = [];

  let score = averageComparableQualityScore || 0;
  if (!scoredComparableCount) score = 0;
  if (weakCount > 0) warnings.push('Comparable quality includes weak comps.');
  if (rejectCount > 0) warnings.push('Comparable quality includes rejected comps.');
  if (rejectCount > 0) score -= Math.min(35, rejectCount * 12);
  if (weakCount > 0) score -= Math.min(20, weakCount * 5);

  score = clampScore(score);

  return {
    status: getStatusFromScore(score),
    score,
    averageComparableQualityScore,
    scoredComparableCount,
    weakCount,
    rejectCount,
    warnings: uniqueMessages([
      ...warnings,
      ...asArray(comparableQuality.warnings)
    ])
  };
}

function scoreRecency(evidenceSummary) {
  const evidence = asArray(evidenceSummary.normalizedEvidence);
  const freshSoldCount = countFreshSoldEvidence(evidence);
  const staleSoldCount = countStaleSoldEvidence(evidence);
  const trueSoldCount = toNumber(evidenceSummary.trueSoldCount, 0);
  const warnings = [];

  let score = 0;
  if (!trueSoldCount) score = 5;
  else if (freshSoldCount >= 3) score = 92;
  else if (freshSoldCount >= 1) score = 68;
  else if (staleSoldCount >= trueSoldCount) score = 28;
  else score = 48;

  if (trueSoldCount > 0 && freshSoldCount <= 0) warnings.push('No fresh true sold comps are available.');
  if (staleSoldCount > 0) warnings.push('Some true sold comps are stale.');

  return {
    status: getStatusFromScore(score),
    score: clampScore(score),
    freshSoldCount,
    staleSoldCount,
    warnings
  };
}

function scorePriceConsistency(evidenceSummary) {
  const priceSpread = toNumber(evidenceSummary.priceSpread, 0);
  const volatility = toNumber(evidenceSummary.volatility, 0);
  const warnings = [];

  let score = 88;
  if (priceSpread > 1.2) score -= 45;
  else if (priceSpread > 0.85) score -= 30;
  else if (priceSpread > 0.6) score -= 18;

  if (volatility > 0.75) score -= 35;
  else if (volatility > 0.5) score -= 24;
  else if (volatility > 0.35) score -= 12;

  if (priceSpread > 0.85) warnings.push('Sold price spread is wide.');
  if (volatility > 0.5) warnings.push('Sold price volatility is high.');

  if (toNumber(evidenceSummary.trueSoldCount, 0) < 3) {
    score = Math.min(score, 45);
    warnings.push('Price consistency is limited by thin sold evidence.');
  }

  return {
    status: getStatusFromScore(score),
    score: clampScore(score),
    priceSpread,
    volatility,
    warnings
  };
}

function scoreFallbackRisk(evidenceSummary) {
  const activeOnlyFlag = evidenceSummary.activeOnlyFlag === true;
  const fallbackOnlyFlag = evidenceSummary.fallbackOnlyFlag === true;
  const trueSoldCount = toNumber(evidenceSummary.trueSoldCount, 0);
  const warnings = [];
  let score = trueSoldCount > 0 ? 85 : 20;

  if (activeOnlyFlag) {
    score = 15;
    warnings.push('Active-only evidence cannot establish valuation sufficiency.');
  }

  if (fallbackOnlyFlag) {
    score = 8;
    warnings.push('Fallback-only evidence cannot establish valuation sufficiency.');
  }

  return {
    status: getStatusFromScore(score),
    score: clampScore(score),
    activeOnlyFlag,
    fallbackOnlyFlag,
    warnings
  };
}

function scoreEvidenceSufficiency(input = {}) {
  const evidenceSummary = input.evidenceSummary || {};
  const comparableQuality = input.comparableQuality || {};
  const soldEvidence = scoreSoldEvidence(evidenceSummary);
  const comparableQualityCheck = scoreComparableQuality(comparableQuality);
  const recency = scoreRecency(evidenceSummary);
  const priceConsistency = scorePriceConsistency(evidenceSummary);
  const fallbackRisk = scoreFallbackRisk(evidenceSummary);

  let score = clampScore(
    soldEvidence.score * 0.34 +
    comparableQualityCheck.score * 0.24 +
    recency.score * 0.16 +
    priceConsistency.score * 0.16 +
    fallbackRisk.score * 0.1
  );

  if (soldEvidence.trueSoldCount <= 0) score = Math.min(score, 20);
  else if (soldEvidence.trueSoldCount < soldEvidence.minimumSuggested) score = Math.min(score, 44);
  if (fallbackRisk.activeOnlyFlag || fallbackRisk.fallbackOnlyFlag) score = Math.min(score, 18);
  if (comparableQualityCheck.rejectCount > 0) score = Math.min(score, 64);

  return {
    score,
    checks: {
      soldEvidence,
      comparableQuality: comparableQualityCheck,
      recency,
      priceConsistency,
      fallbackRisk
    }
  };
}

function summarizeEvidenceSufficiency(data = {}) {
  const level = data.sufficiencyLevel || getStatusFromScore(data.evidenceSufficiencyScore);

  if (level === 'strong') {
    return 'Evidence sufficiency is strong enough to trust the valuation context.';
  }

  if (level === 'adequate') {
    return 'Evidence sufficiency is adequate, with enough support to trust the valuation context cautiously.';
  }

  if (level === 'limited') {
    return 'Evidence sufficiency is limited and should remain informational.';
  }

  if (level === 'insufficient') {
    return 'Evidence sufficiency is insufficient for valuation trust without manual review.';
  }

  return 'Evidence sufficiency is unreliable from the available evidence.';
}

function evaluateEvidenceSufficiency(input = {}) {
  const { score, checks } = scoreEvidenceSufficiency(input);
  const blockingConcerns = [];
  const positives = [];
  const warnings = uniqueMessages(Object.values(checks).flatMap((check) => check.warnings));

  if (checks.soldEvidence.trueSoldCount <= 0) blockingConcerns.push('No true sold evidence is available.');
  else if (checks.soldEvidence.trueSoldCount < checks.soldEvidence.minimumSuggested) {
    blockingConcerns.push('True sold evidence is below the suggested minimum of 3.');
  }

  if (checks.fallbackRisk.activeOnlyFlag) blockingConcerns.push('Evidence is active-only.');
  if (checks.fallbackRisk.fallbackOnlyFlag) blockingConcerns.push('Evidence is fallback-only.');
  if (checks.comparableQuality.rejectCount > 0) blockingConcerns.push('Comparable quality contains rejected comps.');

  if (checks.soldEvidence.trueSoldCount >= 3) positives.push('True sold evidence meets the suggested minimum.');
  if (checks.comparableQuality.averageComparableQualityScore >= 70) positives.push('Comparable quality is usable or better.');
  if (checks.recency.freshSoldCount >= 1) positives.push('Fresh true sold evidence is present.');
  if (checks.priceConsistency.score >= 68) positives.push('Sold prices are consistent enough for evidence review.');

  const sufficiencyLevel = getStatusFromScore(score);
  const result = {
    source: 'evidence_sufficiency_engine',
    version: '1.1',
    sufficientForValuation: score >= 68 && blockingConcerns.length === 0,
    sufficiencyLevel,
    evidenceSufficiencyScore: score,
    checks,
    blockingConcerns: uniqueMessages(blockingConcerns),
    warnings,
    positives: uniqueMessages(positives),
    summary: ''
  };

  result.summary = summarizeEvidenceSufficiency(result);
  return result;
}

module.exports = {
  evaluateEvidenceSufficiency,
  scoreEvidenceSufficiency,
  summarizeEvidenceSufficiency
};
