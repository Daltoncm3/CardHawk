'use strict';

const POPULATION_VERSION = 'population_engine_v2';

const GEM_GRADES = {
  psa: 10,
  sgc: 10,
  cgc: 10,
  csg: 10,
  bgs: 9.5
};

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

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function titleCase(value) {
  return String(value || '')
    .trim()
    .replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
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

function normalizeGradingCompany(value) {
  const text = normalizeText(value);

  if (!text) return '';
  if (text.includes('psa') || text.includes('professional sports authenticator')) return 'PSA';
  if (text.includes('bgs') || text.includes('beckett')) return 'BGS';
  if (text.includes('sgc')) return 'SGC';
  if (text.includes('cgc')) return 'CGC';
  if (text.includes('csg')) return 'CSG';

  return titleCase(text);
}

function extractGradingCompany(input = {}) {
  const listing = input.listing || {};
  const parsed = input.parsed || listing.parsed || {};
  const gradingData = input.gradingData || {};
  const populationData = input.populationData || {};
  const title = normalizeText(listing.title || input.title || '');

  const explicit = pickFirstValue(
    [gradingData, populationData, parsed, listing, input],
    ['gradingCompany', 'grader', 'company', 'grading', 'slabCompany'],
    ''
  );

  if (explicit) return normalizeGradingCompany(explicit);

  if (/\bpsa\b/.test(title)) return 'PSA';
  if (/\bbgs\b|\bbeckett\b/.test(title)) return 'BGS';
  if (/\bsgc\b/.test(title)) return 'SGC';
  if (/\bcgc\b/.test(title)) return 'CGC';
  if (/\bcsg\b/.test(title)) return 'CSG';

  return '';
}

function normalizeGrade(value) {
  const text = normalizeText(value);

  if (!text) return '';
  if (text === 'gem mint' || text === 'gem mt') return '10';
  if (text === 'pristine') return '10';
  if (text === 'black label') return '10';
  if (text === 'mint') return '9';
  if (text === 'raw' || text === 'ungraded') return 'raw';

  const match = text.match(/\b(10|9\.5|9|8\.5|8|7\.5|7|6\.5|6|5|4|3|2|1)\b/);
  return match ? match[1] : text;
}

function extractGrade(input = {}) {
  const listing = input.listing || {};
  const parsed = input.parsed || listing.parsed || {};
  const gradingData = input.gradingData || {};
  const populationData = input.populationData || {};
  const title = normalizeText(listing.title || input.title || '');

  const explicit = pickFirstValue(
    [gradingData, populationData, parsed, listing, input],
    ['grade', 'conditionGrade', 'numericGrade'],
    ''
  );

  if (explicit) return normalizeGrade(explicit);

  const titleMatch = title.match(/\b(?:psa|bgs|sgc|cgc|csg)\s*(10|9\.5|9|8\.5|8|7\.5|7|6\.5|6|5|4|3|2|1)\b/i);
  return titleMatch ? normalizeGrade(titleMatch[1]) : '';
}

function isGemGrade(gradingCompany, grade) {
  const company = normalizeText(gradingCompany);
  const numericGrade = toNumber(grade, NaN);
  const gemGrade = GEM_GRADES[company];

  if (!Number.isFinite(numericGrade) || !gemGrade) return false;

  return numericGrade >= gemGrade;
}

function normalizeGemRate(value, populationCount, totalGradedCount, gradingCompany, grade) {
  const explicit = toNumber(value, NaN);

  if (Number.isFinite(explicit)) {
    if (explicit > 1) return explicit / 100;
    if (explicit >= 0) return explicit;
  }

  if (totalGradedCount > 0 && populationCount > 0 && isGemGrade(gradingCompany, grade)) {
    return populationCount / totalGradedCount;
  }

  return 0;
}

function normalizePopulationInput(input = {}) {
  const listing = input.listing || {};
  const parsed = input.parsed || listing.parsed || {};
  const gradingData = input.gradingData || {};
  const populationData = input.populationData || {};
  const marketData = input.marketData || {};
  const compData = input.compData || {};

  const gradingCompany = extractGradingCompany(input);
  const grade = extractGrade(input);

  const populationCount = pickFirstNumber(
    [populationData, gradingData, marketData, compData],
    ['populationCount', 'popCount', 'gradePopulation', 'population', 'pop'],
    0
  );

  const higherGradeCount = pickFirstNumber(
    [populationData, gradingData, marketData, compData],
    ['higherGradeCount', 'higherPopCount', 'popHigher', 'higherPopulation', 'populationHigher'],
    0
  );

  const totalGradedCount = pickFirstNumber(
    [populationData, gradingData, marketData, compData],
    ['totalGradedCount', 'totalPopulation', 'totalPop', 'totalGraded', 'certPopulation'],
    0
  );

  const explicitGemRate = pickFirstValue(
    [populationData, gradingData, marketData, compData],
    ['gemRate', 'gemMintRate', 'gemPercent', 'gemPercentage'],
    undefined
  );

  const gemRate = normalizeGemRate(
    explicitGemRate,
    populationCount,
    totalGradedCount,
    gradingCompany,
    grade
  );

  const normalized = {
    gradingCompany,
    grade,
    populationCount,
    higherGradeCount,
    totalGradedCount,
    gemRate,
    certNumber: String(pickFirstValue([populationData, gradingData, listing, input], ['certNumber', 'cert', 'certificationNumber'], '') || ''),
    populationSource: String(pickFirstValue([populationData, gradingData, marketData], ['populationSource', 'source', 'provider'], '') || ''),
    lastPopulationUpdate: String(pickFirstValue([populationData, gradingData], ['lastPopulationUpdate', 'lastUpdated', 'updatedAt', 'populationUpdatedAt'], '') || ''),
    registryDemand: pickFirstNumber([populationData, gradingData, marketData], ['registryDemand', 'registryDemandScore', 'setRegistryDemand'], 0),
    registryRank: pickFirstNumber([populationData, gradingData], ['registryRank', 'setRegistryRank', 'rank'], 0),
    crossCompanyPopulation: pickFirstNumber(
      [populationData, gradingData, marketData, compData],
      ['crossCompanyPopulation', 'combinedPopulation', 'allCompanyPopulation'],
      0
    ),
    populationVersion: String(pickFirstValue([populationData, gradingData], ['populationVersion', 'version'], POPULATION_VERSION) || POPULATION_VERSION),
    player: pickFirstValue([parsed, listing, input], ['player', 'subject', 'character', 'name'], ''),
    year: pickFirstValue([parsed, listing, input], ['year'], ''),
    set: pickFirstValue([parsed, listing, input], ['set', 'cardSet', 'series', 'product'], ''),
    cardNumber: pickFirstValue([parsed, listing, input], ['cardNumber', 'cardNo', 'number'], '')
  };

  normalized.populationUnavailable = !hasPopulationEvidence(normalized);
  normalized.isGemGrade = isGemGrade(normalized.gradingCompany, normalized.grade);
  normalized.evidenceQuality = getEvidenceQuality(normalized);

  return normalized;
}

function hasPopulationEvidence(normalized = {}) {
  return normalized.populationCount > 0 || normalized.higherGradeCount > 0 || normalized.totalGradedCount > 0;
}

function logScarcityScore(count, midpoint, steepness) {
  if (!count || count <= 0) return 0;

  const score = 100 - Math.log10(count + 1) * steepness + midpoint;
  return clampScore(score);
}

function scorePopulationScarcity(populationCount) {
  if (!populationCount || populationCount <= 0) return 0;

  return logScarcityScore(populationCount, 12, 31);
}

function scoreHigherGradeScarcity(higherGradeCount) {
  if (higherGradeCount <= 0) return 92;

  return logScarcityScore(higherGradeCount, 8, 28);
}

function scoreRelativeScarcity(populationCount, totalGradedCount) {
  if (!populationCount || !totalGradedCount || totalGradedCount <= 0) return 45;

  const share = populationCount / totalGradedCount;

  if (share <= 0.01) return 96;
  if (share <= 0.025) return 88;
  if (share <= 0.05) return 78;
  if (share <= 0.1) return 65;
  if (share <= 0.2) return 50;
  if (share <= 0.4) return 32;
  return 18;
}

function scoreGemRateScarcity(gemRate) {
  if (!gemRate || gemRate <= 0) return 45;
  if (gemRate <= 0.03) return 94;
  if (gemRate <= 0.08) return 84;
  if (gemRate <= 0.15) return 72;
  if (gemRate <= 0.3) return 55;
  if (gemRate <= 0.5) return 34;
  return 18;
}

function scoreGradeScarcity(gradingCompany, grade, populationEvidence) {
  const numericGrade = toNumber(grade, NaN);

  if (!Number.isFinite(numericGrade)) return 35;

  const company = normalizeText(gradingCompany);
  const gemGrade = GEM_GRADES[company] || 10;

  if (numericGrade >= gemGrade && populationEvidence) return 92;
  if (numericGrade >= gemGrade) return 70;
  if (numericGrade >= 9) return 58;
  if (numericGrade >= 8) return 42;
  return 25;
}

function scoreEvidenceQuality(normalized = {}) {
  if (!hasPopulationEvidence(normalized)) return 0;

  let score = 15;

  if (normalized.populationCount > 0) score += 30;
  if (normalized.totalGradedCount > 0) score += 18;
  if (normalized.populationSource) score += 16;
  if (normalized.lastPopulationUpdate) score += 12;
  if (normalized.gradingCompany) score += 8;
  if (normalized.grade && normalized.grade !== 'raw') score += 8;
  if (normalized.gemRate > 0) score += 5;
  if (normalized.certNumber) score += 3;

  return clampScore(score);
}

function getEvidenceQuality(normalized = {}) {
  const score = scoreEvidenceQuality(normalized);

  if (score >= 85) return 'excellent';
  if (score >= 70) return 'good';
  if (score >= 50) return 'fair';
  if (score >= 25) return 'weak';
  return 'unavailable';
}

function getComponentScores(normalized = {}) {
  const populationEvidence = normalized.populationCount > 0;

  return {
    populationScore: scorePopulationScarcity(normalized.populationCount),
    higherGradeScore: scoreHigherGradeScarcity(normalized.higherGradeCount),
    relativeScore: scoreRelativeScarcity(normalized.populationCount, normalized.totalGradedCount),
    gemRateScore: scoreGemRateScarcity(normalized.gemRate),
    gradeScore: scoreGradeScarcity(normalized.gradingCompany, normalized.grade, populationEvidence),
    evidenceScore: scoreEvidenceQuality(normalized)
  };
}

function calculateScarcityScore(normalized = {}) {
  if (!hasPopulationEvidence(normalized)) return 0;

  const componentScores = getComponentScores(normalized);

  // Scarcity should come from population evidence, not market interest. Registry fields stay metadata-only here.
  let score =
    componentScores.populationScore * 0.38 +
    componentScores.higherGradeScore * 0.19 +
    componentScores.relativeScore * 0.19 +
    componentScores.gemRateScore * 0.12 +
    componentScores.gradeScore * 0.12;

  if (!normalized.populationCount) score -= 26;
  if (!normalized.totalGradedCount) score -= 5;
  if (!normalized.gradingCompany) score -= 8;
  if (!normalized.grade || normalized.grade === 'raw') score -= 18;

  if (normalized.crossCompanyPopulation > 0 && normalized.populationCount > 0 && normalized.crossCompanyPopulation > normalized.populationCount * 4) {
    score -= 6;
  }

  // Evidence gating prevents partial metadata from creating high-scarcity claims.
  if (score >= 90 && normalized.populationCount <= 0) score = 74;
  if (score >= 90 && normalized.populationCount > 50) score = 89;
  if (score >= 75 && normalized.populationCount <= 0 && normalized.totalGradedCount <= 0) score = 54;
  if (score >= 75 && !hasPopulationEvidence(normalized)) score = 54;

  return clampScore(score);
}

function getScarcityLevel(scarcityScore, normalized = {}) {
  if (scarcityScore >= 90 && normalized.populationCount > 0) return 'Extremely Rare';
  if (scarcityScore >= 75 && (normalized.populationCount > 0 || normalized.totalGradedCount > 0)) return 'Rare';
  if (scarcityScore >= 55) return 'Scarce';
  if (scarcityScore >= 35) return 'Uncommon';
  return 'Common';
}

function calculateConfidence(normalized = {}) {
  if (!hasPopulationEvidence(normalized)) return 10;

  let confidence = 10;

  if (normalized.populationSource) confidence += 16;
  if (normalized.lastPopulationUpdate) confidence += 12;
  if (normalized.certNumber) confidence += 7;
  if (normalized.gradingCompany) confidence += 10;
  if (normalized.grade && normalized.grade !== 'raw') confidence += 12;
  if (normalized.populationCount > 0) confidence += 24;
  if (normalized.totalGradedCount > 0) confidence += 12;
  if (normalized.gemRate > 0) confidence += 7;
  if (normalized.crossCompanyPopulation > 0) confidence += 3;

  confidence = clampScore(confidence);

  if (!normalized.populationSource) confidence = Math.min(confidence, 58);
  if (!normalized.populationCount) confidence = Math.min(confidence, 55);
  if (!normalized.lastPopulationUpdate) confidence = Math.min(confidence, 82);

  return clampScore(confidence);
}

function summarizePopulation(data = {}) {
  const confidence = toNumber(data.confidence, 0);
  const scarcityLevel = data.scarcityLevel || 'Common';
  const populationCount = toNumber(data.populationCount, 0);
  const totalGradedCount = toNumber(data.totalGradedCount, 0);
  const higherGradeCount = toNumber(data.higherGradeCount, 0);
  const gemRate = toNumber(data.gemRate, 0);
  const evidenceQuality = data.evidenceQuality || 'unavailable';
  const grade = data.grade || '';
  const gradingCompany = data.gradingCompany || '';

  if (data.populationUnavailable || confidence < 25) {
    return 'Population scarcity is unsupported because reliable population data was not provided.';
  }

  const signals = [];

  if (populationCount > 0) {
    signals.push(`grade population is ${populationCount}`);
  } else {
    signals.push('grade-level population is missing');
  }

  if (higherGradeCount === 0 && populationCount > 0) {
    signals.push('no higher-grade population was reported');
  } else if (higherGradeCount > 0) {
    signals.push(`${higherGradeCount} higher-grade copies are reported`);
  }

  if (gemRate > 0) {
    signals.push(`gem-rate is ${(gemRate * 100).toFixed(1)}%`);
  } else {
    signals.push('gem-rate is unavailable');
  }

  if (totalGradedCount > 0 && populationCount > 0) {
    const share = ((populationCount / totalGradedCount) * 100).toFixed(1);
    signals.push(`this grade is ${share}% of total graded population`);
  }

  const identity = `${gradingCompany || 'Unknown grader'} ${grade || 'unknown grade'}`.trim();

  return `${scarcityLevel}: ${identity} has ${signals.join(', ')}. Evidence quality is ${evidenceQuality}.`;
}

function evaluatePopulation(input = {}) {
  const normalized = normalizePopulationInput(input);
  const componentScores = getComponentScores(normalized);
  const warnings = [];
  const positives = [];
  const reasons = [];

  if (!hasPopulationEvidence(normalized)) {
    warnings.push('No population data was provided.');
    reasons.push('Scarcity cannot be verified without population evidence.');
  }

  if (!normalized.gradingCompany) {
    warnings.push('Grading company is unknown.');
  } else {
    positives.push(`Grading company identified as ${normalized.gradingCompany}.`);
  }

  if (!normalized.grade || normalized.grade === 'raw') {
    warnings.push('Graded scarcity cannot be trusted without a graded slab grade.');
  } else {
    positives.push(`Grade identified as ${normalized.grade}.`);
  }

  if (normalized.populationCount > 0) {
    positives.push(`Grade-level population count is available (${normalized.populationCount}).`);
  } else if (hasPopulationEvidence(normalized)) {
    warnings.push('Grade-level population count is missing.');
  }

  if (normalized.totalGradedCount > 0 && normalized.populationCount > 0) {
    const relativeShare = normalized.populationCount / normalized.totalGradedCount;
    reasons.push(`Grade population represents ${(relativeShare * 100).toFixed(2)}% of total graded population.`);

    if (relativeShare <= 0.05) positives.push('Relative population share is low.');
    if (relativeShare > 0.4) warnings.push('Relative population share is high, reducing scarcity.');
  }

  if (normalized.higherGradeCount > 0) {
    reasons.push(`${normalized.higherGradeCount} higher-grade copies are known.`);
  } else if (normalized.populationCount > 0) {
    positives.push('No higher-grade population was reported.');
  }

  if (normalized.totalGradedCount > 0) {
    positives.push(`Total graded population is available (${normalized.totalGradedCount}).`);
  }

  if (normalized.gemRate > 0 && normalized.gemRate <= 0.08) {
    positives.push('Gem rate appears low, supporting scarcity.');
  } else if (normalized.gemRate > 0.45) {
    warnings.push('Gem rate appears high, reducing scarcity strength.');
  } else if (normalized.gemRate <= 0 && hasPopulationEvidence(normalized)) {
    warnings.push('Gem-rate data is unavailable.');
  }

  if (normalized.populationSource) {
    positives.push(`Population source provided (${normalized.populationSource}).`);
  } else if (hasPopulationEvidence(normalized)) {
    warnings.push('Population source is missing.');
  }

  if (normalized.lastPopulationUpdate) {
    positives.push(`Population update date provided (${normalized.lastPopulationUpdate}).`);
  } else if (hasPopulationEvidence(normalized)) {
    warnings.push('Population last-updated date is missing.');
  }

  if (normalized.crossCompanyPopulation > 0 && normalized.populationCount > 0) {
    reasons.push(`Cross-company population reference is ${normalized.crossCompanyPopulation}.`);
  }

  if (normalized.registryDemand > 0) {
    reasons.push(`Registry demand metadata is present (${normalized.registryDemand}) but is not used to create scarcity.`);
  }

  if (normalized.registryRank > 0) {
    reasons.push(`Registry rank metadata is present (${normalized.registryRank}) but is not used to create scarcity.`);
  }

  const scarcityScore = calculateScarcityScore(normalized);
  const scarcityLevel = getScarcityLevel(scarcityScore, normalized);
  const confidence = calculateConfidence(normalized);

  if (scarcityLevel === 'Extremely Rare' && normalized.populationCount <= 0) {
    warnings.push('Extremely Rare requires grade-level population count evidence.');
  }

  if (scarcityLevel === 'Rare' && normalized.populationCount <= 0 && normalized.totalGradedCount <= 0) {
    warnings.push('Rare requires population count or total graded population evidence.');
  }

  if (scarcityScore >= 75 && confidence < 60) {
    warnings.push('High scarcity score has limited confidence because population evidence is incomplete.');
  }

  const result = {
    source: 'population_engine',
    scarcityScore,
    scarcityLevel,
    confidence,
    gradingCompany: normalized.gradingCompany,
    grade: normalized.grade,
    populationCount: normalized.populationCount,
    higherGradeCount: normalized.higherGradeCount,
    totalGradedCount: normalized.totalGradedCount,
    gemRate: Number(normalized.gemRate.toFixed(4)),
    certNumber: normalized.certNumber,
    populationSource: normalized.populationSource,
    lastPopulationUpdate: normalized.lastPopulationUpdate,
    registryDemand: normalized.registryDemand,
    registryRank: normalized.registryRank,
    crossCompanyPopulation: normalized.crossCompanyPopulation,
    populationVersion: normalized.populationVersion || POPULATION_VERSION,
    populationUnavailable: normalized.populationUnavailable,
    evidenceQuality: normalized.evidenceQuality,
    isGemGrade: normalized.isGemGrade,
    componentScores,
    warnings: uniqueMessages(warnings),
    positives: uniqueMessages(positives),
    reasons: uniqueMessages(reasons),
    summary: ''
  };

  result.summary = summarizePopulation(result);

  return result;
}

module.exports = {
  evaluatePopulation,
  summarizePopulation,
  normalizePopulationInput,
  normalizeGradingCompany,
  normalizeGrade,
  calculateScarcityScore,
  calculateConfidence,
  getScarcityLevel,
  hasPopulationEvidence,
  isGemGrade
};
