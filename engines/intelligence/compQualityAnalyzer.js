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

function pickFirstValue(source, keys, fallback = '') {
  if (!source || typeof source !== 'object') return fallback;

  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null && source[key] !== '') {
      return source[key];
    }
  }

  return fallback;
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function getSalePrice(sale = {}) {
  return pickFirstNumber(
    [sale],
    ['price', 'soldPrice', 'salePrice', 'amount', 'totalPrice', 'value'],
    0
  );
}

function getDaysOld(item = {}) {
  const explicitDaysOld = pickFirstNumber(
    [item],
    ['daysOld', 'ageDays', 'daysSinceSale', 'soldDaysAgo'],
    NaN
  );

  if (Number.isFinite(explicitDaysOld)) return Math.max(0, explicitDaysOld);

  const dateValue = pickFirstValue(item, ['soldDate', 'saleDate', 'dateSold', 'endedAt', 'endDate'], '');
  const timestamp = dateValue ? new Date(dateValue).getTime() : NaN;

  if (!Number.isFinite(timestamp)) return 0;

  const ageMs = Date.now() - timestamp;
  return ageMs > 0 ? Math.floor(ageMs / 86400000) : 0;
}

function getCondition(item = {}) {
  return normalizeText(pickFirstValue(item, ['condition', 'grade', 'itemCondition'], ''));
}

function getSource(item = {}) {
  return normalizeText(pickFirstValue(item, ['source', 'marketplace', 'platform', 'site'], ''));
}

function scoreCompCount(count) {
  if (count >= 20) return 100;
  if (count >= 12) return 85;
  if (count >= 6) return 70;
  if (count >= 3) return 45;
  if (count >= 1) return 25;
  return 10;
}

function scoreRecency(averageDaysOld) {
  if (!averageDaysOld || averageDaysOld <= 0) return 45;
  if (averageDaysOld <= 14) return 100;
  if (averageDaysOld <= 30) return 85;
  if (averageDaysOld <= 60) return 65;
  if (averageDaysOld <= 120) return 40;
  return 20;
}

function scoreConditionMatch(matchRate, knownConditionRate) {
  if (knownConditionRate < 0.35) return 45;
  if (matchRate >= 0.8) return 100;
  if (matchRate >= 0.6) return 80;
  if (matchRate >= 0.4) return 60;
  if (matchRate > 0) return 35;
  return 25;
}

function scoreSourceDiversity(sourceCount, compCount) {
  if (compCount < 3) return 35;
  if (sourceCount >= 3) return 100;
  if (sourceCount === 2) return 75;
  if (sourceCount === 1) return 45;
  return 30;
}

function getQualityLevel(score) {
  if (score >= 85) return 'excellent';
  if (score >= 70) return 'good';
  if (score >= 50) return 'fair';
  if (score >= 30) return 'weak';
  return 'unreliable';
}

function analyzeCompQuality(input = {}) {
  const soldSales = asArray(input.soldSales);
  const compData = input.compData || {};
  const listing = input.listing || {};

  const validComps = soldSales.filter((sale) => getSalePrice(sale) > 0);
  const compCount = validComps.length;

  const explicitCompCount = pickFirstNumber(
    [compData],
    ['compCount', 'validCompCount', 'soldCompCount', 'sampleSize'],
    compCount
  );

  const effectiveCompCount = Math.max(compCount, explicitCompCount);

  const daysOldValues = validComps
    .map(getDaysOld)
    .filter((daysOld) => Number.isFinite(daysOld) && daysOld > 0);

  const averageDaysOld = daysOldValues.length
    ? daysOldValues.reduce((sum, daysOld) => sum + daysOld, 0) / daysOldValues.length
    : pickFirstNumber([compData], ['averageCompAgeDays', 'avgCompAgeDays', 'averageDaysOld'], 0);

  const listingCondition = getCondition(listing);

  const knownConditionComps = validComps.filter((sale) => getCondition(sale));
  const matchingConditionComps = listingCondition
    ? knownConditionComps.filter((sale) => getCondition(sale) === listingCondition)
    : [];

  const knownConditionRate = effectiveCompCount > 0
    ? knownConditionComps.length / effectiveCompCount
    : 0;

  const conditionMatchRate = knownConditionComps.length > 0
    ? matchingConditionComps.length / knownConditionComps.length
    : 0;

  const sources = validComps
    .map(getSource)
    .filter(Boolean);

  const sourceCount = new Set(sources).size;

  const countScore = scoreCompCount(effectiveCompCount);
  const recencyScore = scoreRecency(averageDaysOld);
  const conditionScore = scoreConditionMatch(conditionMatchRate, knownConditionRate);
  const sourceScore = scoreSourceDiversity(sourceCount, effectiveCompCount);

  const score = Math.round(
    countScore * 0.35 +
    recencyScore * 0.25 +
    conditionScore * 0.25 +
    sourceScore * 0.15
  );

  const warnings = [];
  const positives = [];

  if (effectiveCompCount < 4) {
    warnings.push('Comp quality is limited because there are very few usable sold comps.');
  }

  if (averageDaysOld > 90) {
    warnings.push('Comparable sales may be stale for current market conditions.');
  }

  if (listingCondition && knownConditionRate >= 0.35 && conditionMatchRate < 0.4) {
    warnings.push('Few known-condition comps match the listing condition.');
  }

  if (knownConditionRate < 0.35) {
    warnings.push('Condition data is missing from many comps.');
  }

  if (effectiveCompCount >= 4 && sourceCount <= 1) {
    warnings.push('Comparable data appears concentrated in a single source.');
  }

  if (effectiveCompCount >= 6) {
    positives.push('Comp sample size is strong enough for a more reliable read.');
  }

  if (averageDaysOld > 0 && averageDaysOld <= 30) {
    positives.push('Comparable sales are recent.');
  }

  if (listingCondition && conditionMatchRate >= 0.6) {
    positives.push('A healthy share of known-condition comps match the listing condition.');
  }

  if (sourceCount >= 2) {
    positives.push('Comparable data includes more than one source.');
  }

  return {
    score,
    level: getQualityLevel(score),
    compCount: effectiveCompCount,
    usableSoldCompCount: compCount,
    averageDaysOld: Number(averageDaysOld.toFixed(1)),
    listingCondition,
    knownConditionCount: knownConditionComps.length,
    knownConditionRate: Number(knownConditionRate.toFixed(3)),
    conditionMatchCount: matchingConditionComps.length,
    conditionMatchRate: Number(conditionMatchRate.toFixed(3)),
    sourceCount,
    sources: Array.from(new Set(sources)),
    warnings,
    positives
  };
}

module.exports = {
  analyzeCompQuality
};
