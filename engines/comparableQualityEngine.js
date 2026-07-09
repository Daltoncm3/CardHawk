'use strict';

// Canonical Comparable Quality owner; aggregate sample fields are evidence-only.

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

function getEvidenceText(comp = {}) {
  return [
    comp.evidenceType,
    comp.status,
    comp.listingStatus,
    comp.source,
    comp.type,
    comp.recordType,
    comp.marketState,
    comp.saleStatus
  ].filter(Boolean).map(normalize).join(' ');
}

function getEvidenceType(comp = {}) {
  const explicitType = normalize(comp.evidenceType);
  if (explicitType === 'true_sold' || explicitType === 'active' || explicitType === 'fallback_unknown') {
    return explicitType;
  }

  const text = getEvidenceText(comp);
  if (
    comp.sold === true ||
    comp.isSold === true ||
    comp.completed === true ||
    comp.isCompleted === true ||
    comp.soldAt ||
    comp.dateSold ||
    /\b(sold|completed|ended)\b/.test(text)
  ) {
    return 'true_sold';
  }

  if (
    comp.active === true ||
    comp.isActive === true ||
    Array.isArray(comp.buyingOptions) ||
    /\b(active|live|listed|available|current|open)\b/.test(text)
  ) {
    return 'active';
  }

  return 'fallback_unknown';
}

function getAgeDays(comp = {}) {
  const explicitAge = pickFirstNumber(
    [comp],
    ['ageDays', 'daysOld', 'daysSinceSale', 'soldDaysAgo'],
    NaN
  );

  if (Number.isFinite(explicitAge)) return Math.max(0, explicitAge);

  const dateValue = pickFirstValue(
    [comp],
    ['soldAt', 'dateSold', 'soldDate', 'saleDate', 'endedAt', 'endDate', 'lastSeenAt', 'createdAt'],
    ''
  );

  if (!dateValue) return null;

  const timestamp = new Date(dateValue).getTime();
  if (!Number.isFinite(timestamp)) return null;

  const ageMs = Date.now() - timestamp;
  return ageMs > 0 ? Math.floor(ageMs / 86400000) : 0;
}

function scoreEvidenceStrength(evidenceType) {
  if (evidenceType === 'true_sold') return 100;
  if (evidenceType === 'active') return 45;
  return 18;
}

function scoreRecency(ageDays) {
  if (!Number.isFinite(ageDays)) return 45;
  if (ageDays <= 30) return 100;
  if (ageDays <= 90) return 82;
  if (ageDays <= 180) return 58;
  if (ageDays <= 365) return 35;
  return 18;
}

function scoreSaleType(saleType, evidenceType) {
  const normalized = normalize(saleType);
  if (evidenceType !== 'true_sold') return 35;
  if (normalized === 'auction') return 88;
  if (normalized === 'buy_it_now' || normalized === 'fixed_price') return 78;
  if (normalized === 'best_offer') return 68;
  return 55;
}

function scoreSource(source) {
  const normalized = normalize(source);
  if (!normalized) return 45;
  if (normalized.includes('sold') || normalized.includes('completed')) return 86;
  if (normalized.includes('ebay')) return 76;
  if (normalized.includes('active')) return 45;
  if (normalized.includes('manual')) return 62;
  return 55;
}

function getCondition(value = {}) {
  return normalize(pickFirstValue(
    [value],
    ['condition', 'grade', 'itemCondition', 'cardCondition', 'conditionName'],
    ''
  ));
}

function getSourceName(value = {}) {
  return normalize(pickFirstValue(
    [value],
    ['source', 'marketplace', 'platform', 'site'],
    ''
  ));
}

function scorePriceReliability(comp = {}, marketContext = {}) {
  const price = pickFirstNumber(
    [comp],
    ['soldPrice', 'salePrice', 'price', 'askingPrice', 'amount', 'totalPrice', 'value'],
    0
  );
  const referencePrice = pickFirstNumber(
    [marketContext],
    ['medianSold', 'weightedSoldAverage', 'referenceMarketValue', 'marketValue', 'medianPrice'],
    0
  );

  if (!price || !referencePrice) return 55;

  const ratio = price / referencePrice;
  if (ratio >= 0.8 && ratio <= 1.2) return 95;
  if (ratio >= 0.65 && ratio <= 1.4) return 78;
  if (ratio >= 0.5 && ratio <= 1.75) return 52;
  return 18;
}

function getQualityBand(score) {
  if (score >= 85) return 'excellent';
  if (score >= 70) return 'good';
  if (score >= 50) return 'usable';
  if (score >= 25) return 'weak';
  return 'reject';
}

function getIdentityScore(comp = {}) {
  if (comp.rejectedByIdentityGate) return 0;
  if (Array.isArray(comp.fatalMismatches) && comp.fatalMismatches.length) return 12;
  if (toNumber(comp.similarityCap, 100) < 60) return 25;
  return clampScore(pickFirstNumber([comp], ['similarity', 'similarityScore', 'matchScore'], 55));
}

function hasMismatch(comp = {}, pattern) {
  const text = [
    ...(asArray(comp.fatalMismatches)),
    ...(asArray(comp.identityCaps)),
    ...(asArray(comp.similarityDetails))
  ].map(normalize).join(' ');

  return pattern.test(text);
}

function scoreComparable(input = {}) {
  const comp = input.comp || input;
  const marketContext = input.marketContext || {};
  const evidenceType = getEvidenceType(comp);
  const ageDays = getAgeDays(comp);
  const identityScore = getIdentityScore(comp);
  const evidenceStrengthScore = scoreEvidenceStrength(evidenceType);
  const recencyScore = scoreRecency(ageDays);
  const priceReliabilityScore = scorePriceReliability(comp, marketContext);
  const sourceReliabilityScore = scoreSource(pickFirstValue([comp], ['source', 'marketplace', 'platform'], ''));
  const saleTypeReliabilityScore = scoreSaleType(
    pickFirstValue([comp], ['saleType', 'format', 'listingType', 'purchaseType', 'type'], ''),
    evidenceType
  );
  const warnings = [];
  const reasons = [];

  const flags = {
    activeOnly: evidenceType === 'active',
    fallbackUnknown: evidenceType === 'fallback_unknown',
    staleComp: Number.isFinite(ageDays) && ageDays > 180,
    priceOutlier: priceReliabilityScore <= 25,
    identityCapped: toNumber(comp.similarityCap, 100) < 100 || asArray(comp.identityCaps).length > 0,
    rejectedByIdentityGate: comp.rejectedByIdentityGate === true,
    rawSlabMismatch: hasMismatch(comp, /raw|slab|graded/),
    variationMismatch: hasMismatch(comp, /variation|parallel|base/),
    conditionMismatch: hasMismatch(comp, /condition|grade/)
  };

  if (flags.rejectedByIdentityGate) warnings.push('Comparable was rejected by identity gates.');
  if (flags.identityCapped) warnings.push('Comparable has identity mismatch caps.');
  if (flags.activeOnly) warnings.push('Active comparable is informational only and not sold evidence.');
  if (flags.fallbackUnknown) warnings.push('Comparable evidence type is unknown or fallback.');
  if (flags.staleComp) warnings.push('Comparable is stale.');
  if (flags.priceOutlier) warnings.push('Comparable price is far from market context.');

  if (evidenceType === 'true_sold') reasons.push('True sold evidence is present.');
  if (identityScore >= 85) reasons.push('Identity similarity is strong.');
  if (recencyScore >= 82) reasons.push('Comparable is recent.');

  let comparableQualityScore = clampScore(
    identityScore * 0.34 +
    evidenceStrengthScore * 0.24 +
    recencyScore * 0.14 +
    priceReliabilityScore * 0.14 +
    sourceReliabilityScore * 0.08 +
    saleTypeReliabilityScore * 0.06
  );

  if (flags.rejectedByIdentityGate) comparableQualityScore = Math.min(comparableQualityScore, 15);
  if (evidenceType === 'active') comparableQualityScore = Math.min(comparableQualityScore, 62);
  if (evidenceType === 'fallback_unknown') comparableQualityScore = Math.min(comparableQualityScore, 42);
  if (flags.identityCapped) comparableQualityScore = Math.min(comparableQualityScore, 58);
  if (flags.priceOutlier) comparableQualityScore = Math.min(comparableQualityScore, 55);

  comparableQualityScore = clampScore(comparableQualityScore);

  return {
    comparableQualityScore,
    qualityBand: flags.rejectedByIdentityGate ? 'reject' : getQualityBand(comparableQualityScore),
    evidenceType,
    trustFactors: {
      identityScore,
      evidenceStrengthScore,
      recencyScore,
      priceReliabilityScore,
      sourceReliabilityScore,
      saleTypeReliabilityScore
    },
    flags,
    reasons: uniqueMessages(reasons),
    warnings: uniqueMessages(warnings)
  };
}

function summarizeComparableQuality(data = {}) {
  const averageScore = toNumber(data.averageComparableQualityScore, 0);
  const distribution = data.qualityDistribution || {};

  if (!toNumber(data.scoredComparableCount, 0)) {
    return 'No comparable quality evidence was available.';
  }

  if ((distribution.reject || 0) > 0) {
    return 'Comparable quality includes rejected or identity-failed comps and should be reviewed.';
  }

  if (averageScore >= 80) {
    return 'Comparable quality is strong across the available evidence.';
  }

  if (averageScore >= 55) {
    return 'Comparable quality is usable but should remain evidence-only.';
  }

  return 'Comparable quality is weak or incomplete and should be treated cautiously.';
}

function getAggregateSampleQuality(input = {}) {
  const comps = asArray(input.comps);
  const listing = input.listing || {};
  const evidenceTypes = comps.map(getEvidenceType);
  const ageValues = comps
    .map(getAgeDays)
    .filter((ageDays) => Number.isFinite(ageDays) && ageDays >= 0);
  const sources = comps
    .map(getSourceName)
    .filter(Boolean);
  const listingCondition = getCondition(listing);
  const knownConditionComps = comps.filter((comp) => getCondition(comp));
  const matchingConditionComps = listingCondition
    ? knownConditionComps.filter((comp) => getCondition(comp) === listingCondition)
    : [];
  const sourceList = Array.from(new Set(sources));

  return {
    sampleDepth: {
      totalComparableCount: comps.length,
      trueSoldCount: evidenceTypes.filter((type) => type === 'true_sold').length,
      activeCount: evidenceTypes.filter((type) => type === 'active').length,
      fallbackUnknownCount: evidenceTypes.filter((type) => type === 'fallback_unknown').length
    },
    averageAgeDays: ageValues.length
      ? Number((ageValues.reduce((sum, ageDays) => sum + ageDays, 0) / ageValues.length).toFixed(1))
      : 0,
    sourceDiversity: {
      sourceCount: sourceList.length,
      sources: sourceList
    },
    knownConditionRate: comps.length
      ? Number((knownConditionComps.length / comps.length).toFixed(3))
      : 0,
    conditionMatchRate: knownConditionComps.length
      ? Number((matchingConditionComps.length / knownConditionComps.length).toFixed(3))
      : 0
  };
}

function evaluateComparableQuality(input = {}) {
  const comps = asArray(input.comps || input.comparables || input.selectedComps);
  const marketContext = input.marketContext || {};
  const scoredComps = comps.map((comp) => scoreComparable({ comp, marketContext }));
  const aggregateSampleQuality = getAggregateSampleQuality({ comps, listing: input.listing });
  const distribution = {
    excellent: 0,
    good: 0,
    usable: 0,
    weak: 0,
    reject: 0
  };

  for (const scoredComp of scoredComps) {
    distribution[scoredComp.qualityBand] += 1;
  }

  const averageComparableQualityScore = scoredComps.length
    ? clampScore(scoredComps.reduce((sum, comp) => sum + comp.comparableQualityScore, 0) / scoredComps.length)
    : 0;

  const result = {
    source: 'comparable_quality_engine',
    comparableCount: comps.length,
    scoredComparableCount: scoredComps.length,
    averageComparableQualityScore,
    qualityDistribution: distribution,
    scoredComps,
    sampleDepth: aggregateSampleQuality.sampleDepth,
    averageAgeDays: aggregateSampleQuality.averageAgeDays,
    sourceDiversity: aggregateSampleQuality.sourceDiversity,
    knownConditionRate: aggregateSampleQuality.knownConditionRate,
    conditionMatchRate: aggregateSampleQuality.conditionMatchRate,
    warnings: uniqueMessages(scoredComps.flatMap((comp) => comp.warnings)),
    summary: ''
  };

  result.summary = summarizeComparableQuality(result);
  return result;
}

module.exports = {
  evaluateComparableQuality,
  scoreComparable,
  summarizeComparableQuality
};
