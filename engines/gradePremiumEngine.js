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

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(toNumber(value, 0))));
}

function roundMoney(value) {
  return Math.round(toNumber(value, 0) * 100) / 100;
}

function roundMetric(value, digits = 3) {
  const multiplier = 10 ** digits;
  return Math.round(toNumber(value, 0) * multiplier) / multiplier;
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

function createDimension(status, score, explanation) {
  return {
    status,
    score: score === null ? null : clampScore(score),
    explanation
  };
}

function normalizeGrade(value) {
  const text = normalize(value).replace(/^grade\s*/, '');

  if (!text) return '';
  if (text === 'gem mint' || text === 'gem mt') return '10';
  if (text === 'mint') return '9';
  if (text === 'black label') return 'black_label';
  if (text === 'pristine') return 'pristine';
  if (['raw', 'ungraded'].includes(text)) return 'raw';
  if (['near mint', 'nm-mt', 'nm mt'].includes(text)) return 'nm';
  if (['lightly played'].includes(text)) return 'lp';
  if (['moderately played'].includes(text)) return 'mp';
  if (['heavily played'].includes(text)) return 'hp';

  const match = text.match(/\b(10|9\.5|9|8\.5|8|7\.5|7|6\.5|6|5|4|3|2|1)\b/);
  return match ? match[1] : text;
}

function normalizeGradingCompany(value) {
  const text = normalize(value);

  if (!text) return '';
  if (text.includes('psa')) return 'psa';
  if (text.includes('bgs') || text.includes('beckett')) return 'bgs';
  if (text.includes('sgc')) return 'sgc';
  if (text.includes('cgc')) return 'cgc';
  if (text.includes('csg')) return 'csg';
  if (text.includes('raw') || text.includes('ungraded')) return 'raw';
  return text;
}

function getParsed(item = {}) {
  return item.parsed || item.parsedCard || item.card || {};
}

function getTargetProfile(input = {}) {
  const listing = input.listing || {};
  const listingProfile = input.listingProfile || {};
  const population = input.populationEvidence || input.populationData || {};
  const parsed = getParsed(listing);
  const title = normalize(listing.title || '');
  let gradingCompany = normalizeGradingCompany(
    pickFirstValue(
      [listingProfile, parsed, listing, input, population],
      ['gradingCompany', 'grader', 'company', 'grading', 'slabCompany'],
      ''
    )
  );
  let grade = normalizeGrade(
    pickFirstValue(
      [listingProfile, parsed, listing, input, population],
      ['grade', 'conditionGrade', 'numericGrade'],
      ''
    )
  );

  if (!gradingCompany) {
    if (/\bpsa\b/.test(title)) gradingCompany = 'psa';
    else if (/\bbgs\b|\bbeckett\b/.test(title)) gradingCompany = 'bgs';
    else if (/\bsgc\b/.test(title)) gradingCompany = 'sgc';
    else if (/\bcgc\b|\bcsg\b/.test(title)) gradingCompany = 'cgc';
    else if (/\braw\b|\bungraded\b/.test(title)) gradingCompany = 'raw';
  }

  if (!grade) {
    const match = title.match(/\b(?:psa|bgs|sgc|cgc|csg)\s*(10|9\.5|9|8\.5|8|7\.5|7|6\.5|6|5|4|3|2|1)\b/);
    if (match) grade = normalizeGrade(match[1]);
    else if (/\braw\b|\bungraded\b/.test(title)) grade = 'raw';
  }

  const condition = normalize(
    pickFirstValue([listingProfile, parsed, listing, input], ['condition', 'cardCondition'], '')
  );
  const rawGradedState = normalize(
    pickFirstValue([listingProfile, parsed, listing, input], ['rawGradedState'], '')
  ) || getRawGradedState({ gradingCompany, grade });

  return {
    gradingCompany,
    grade,
    condition,
    rawGradedState
  };
}

function getRawGradedState(profile = {}) {
  if (profile.gradingCompany && profile.gradingCompany !== 'raw') return 'graded';
  if (profile.grade && !['raw', 'nm', 'lp', 'mp', 'hp', 'damaged', 'dmg'].includes(profile.grade)) return 'graded';
  if (profile.gradingCompany === 'raw' || ['raw', 'nm', 'lp', 'mp', 'hp', 'damaged', 'dmg'].includes(profile.grade)) return 'raw';
  return '';
}

function getPrice(item = {}) {
  return toNumber(
    item.price ??
      item.soldPrice ??
      item.salePrice ??
      item.amount ??
      item.totalPrice ??
      item.value,
    0
  );
}

function isSoldEvidence(item = {}) {
  const text = [
    item.evidenceType,
    item.status,
    item.source,
    item.type,
    item.recordType,
    item.saleStatus
  ].map(normalize).join(' ');

  return item.evidenceType === 'true_sold' ||
    item.sold === true ||
    item.isSold === true ||
    item.completed === true ||
    item.isCompleted === true ||
    Boolean(item.soldAt || item.dateSold) ||
    /\b(sold|completed|ended)\b/.test(text);
}

function normalizeComp(item = {}, fallback = {}) {
  const parsed = getParsed(item);

  return {
    ...item,
    price: getPrice(item),
    evidenceType: isSoldEvidence(item) ? 'true_sold' : normalize(item.evidenceType || fallback.evidenceType || ''),
    gradingCompany: normalizeGradingCompany(
      pickFirstValue([item, parsed, fallback], ['gradingCompany', 'grader', 'company', 'grading', 'slabCompany'], '')
    ),
    grade: normalizeGrade(
      pickFirstValue([item, parsed, fallback], ['grade', 'conditionGrade', 'numericGrade'], '')
    ),
    condition: normalize(pickFirstValue([item, parsed, fallback], ['condition', 'cardCondition'], '')),
    rawGradedState: normalize(pickFirstValue([item, parsed, fallback], ['rawGradedState'], ''))
  };
}

function soldOnly(items = [], fallback = {}) {
  return asArray(items)
    .map((item) => normalizeComp(item, fallback))
    .filter((item) => item.price > 0 && item.evidenceType === 'true_sold');
}

function getEvidenceComps(input = {}, targetProfile = {}) {
  const normalizedEvidence = asArray(input.evidenceSummary?.normalizedEvidence)
    .map((item) => normalizeComp(item));

  const sameGrade = [
    ...soldOnly(input.sameGradeComps, targetProfile),
    ...normalizedEvidence.filter((item) => {
      return item.evidenceType === 'true_sold' &&
        item.price > 0 &&
        item.grade === targetProfile.grade &&
        (!targetProfile.gradingCompany || !item.gradingCompany || item.gradingCompany === targetProfile.gradingCompany);
    })
  ];
  const lowerGrade = soldOnly(input.lowerGradeComps);
  const higherGrade = soldOnly(input.higherGradeComps);
  const raw = soldOnly(input.rawComps, { gradingCompany: 'raw', grade: 'raw', rawGradedState: 'raw' });
  const condition = soldOnly(input.conditionComps);
  const active = normalizedEvidence.filter((item) => item.evidenceType === 'active' && item.price > 0);

  return {
    sameGrade,
    lowerGrade,
    higherGrade,
    raw,
    condition,
    active
  };
}

function getMedian(values = []) {
  const clean = values
    .map((value) => toNumber(value, NaN))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);

  if (!clean.length) return 0;
  const middle = Math.floor(clean.length / 2);
  if (clean.length % 2) return clean[middle];
  return (clean[middle - 1] + clean[middle]) / 2;
}

function getMedianPrice(items = []) {
  return roundMoney(getMedian(items.map((item) => item.price)));
}

function getPercent(numerator, denominator) {
  if (!denominator || denominator <= 0 || !numerator) return null;
  return roundMetric((numerator - denominator) / denominator, 3);
}

function getPremiumMetrics(comps = {}) {
  const sameGradeMedian = getMedianPrice(comps.sameGrade);
  const lowerGradeMedian = getMedianPrice(comps.lowerGrade);
  const higherGradeMedian = getMedianPrice(comps.higherGrade);
  const rawMedian = getMedianPrice(comps.raw);
  const sameGradePremiumPercent = getPercent(sameGradeMedian, lowerGradeMedian);
  const rawToGradedPremiumPercent = getPercent(sameGradeMedian, rawMedian);
  const nextGradePremiumPercent = getPercent(higherGradeMedian, sameGradeMedian);
  const gradeCompressionPercent = higherGradeMedian > lowerGradeMedian && sameGradeMedian > 0
    ? roundMetric((sameGradeMedian - lowerGradeMedian) / (higherGradeMedian - lowerGradeMedian), 3)
    : null;

  return {
    sameGradeMedian,
    lowerGradeMedian,
    higherGradeMedian,
    rawMedian,
    sameGradePremiumPercent,
    rawToGradedPremiumPercent,
    nextGradePremiumPercent,
    gradeCompressionPercent
  };
}

function getSameGradeSupport(comps = {}) {
  const count = comps.sameGrade.length;

  if (count >= 6) return createDimension('strong', 88, 'Exact grade sold support is strong.');
  if (count >= 3) return createDimension('adequate', 72, 'Exact grade sold support is adequate.');
  if (count > 0) return createDimension('thin', 42, 'Exact grade sold support exists, but the sample is thin.');
  return createDimension('missing', 10, 'No exact grade true sold support is available.');
}

function getLowerGradeSpread(metrics = {}, sameGradeCount = 0) {
  const premium = metrics.sameGradePremiumPercent;

  if (sameGradeCount <= 0) {
    return createDimension('unknown', 20, 'Lower-grade spread cannot justify premium without same-grade sold support.');
  }

  if (premium === null) {
    return createDimension('unknown', 45, 'Lower-grade sold comparison is unavailable.');
  }

  if (premium <= 0) {
    return createDimension('unsupported', 18, 'Same-grade sold value does not exceed lower-grade sold value.');
  }

  if (premium > 2.5) {
    return createDimension('overextended', 28, 'Same-grade premium over lower-grade sales appears unusually high.');
  }

  if (premium > 1.25) {
    return createDimension('stretched', 50, 'Same-grade premium is large and should be reviewed.');
  }

  return createDimension('supported', 78, 'Same-grade sold value shows a supported premium over lower-grade sales.');
}

function getRawToGradedPremium(targetProfile = {}, metrics = {}, sameGradeCount = 0) {
  if (targetProfile.rawGradedState !== 'graded') {
    return createDimension('not_applicable', 60, 'Raw-to-graded premium does not apply to a raw target.');
  }

  if (sameGradeCount <= 0) {
    return createDimension('unknown', 20, 'Raw-to-graded premium cannot be justified without same-grade sold support.');
  }

  if (metrics.rawToGradedPremiumPercent === null) {
    return createDimension('unknown', 45, 'Raw sold comparison is unavailable.');
  }

  if (metrics.rawToGradedPremiumPercent <= 0) {
    return createDimension('unsupported', 20, 'Graded sold value does not exceed raw sold value.');
  }

  if (metrics.rawToGradedPremiumPercent > 5) {
    return createDimension('overextended', 28, 'Raw-to-graded premium appears unusually large.');
  }

  if (metrics.rawToGradedPremiumPercent > 3) {
    return createDimension('stretched', 52, 'Raw-to-graded premium is large and should be reviewed.');
  }

  return createDimension('supported', 78, 'Raw-to-graded sold spread supports a slab premium.');
}

function getPopulationSupport(input = {}, sameGradeCount = 0) {
  const population = input.populationEvidence || input.populationData || {};
  const evidenceQuality = normalize(population.evidenceQuality);
  const populationCount = pickFirstNumber([population], ['populationCount', 'popCount', 'gradePopulation'], 0);
  const higherGradeCount = pickFirstNumber([population], ['higherGradeCount', 'higherPopCount', 'popHigher'], 0);
  const gemRate = pickFirstNumber([population], ['gemRate', 'gemMintRate'], 0);
  const isGemGrade = population.isGemGrade === true;

  if (!populationCount && !higherGradeCount && !gemRate && !evidenceQuality) {
    return createDimension('unknown', 45, 'Population evidence is unavailable.');
  }

  if (sameGradeCount <= 0) {
    return createDimension('context_only_no_sold', 30, 'Population scarcity is context only because exact grade sold support is missing.');
  }

  if (populationCount > 0 && populationCount <= 50 && (higherGradeCount <= 5 || isGemGrade)) {
    return createDimension('scarcity_supported', 86, 'Population scarcity supports the grade premium alongside sold evidence.');
  }

  if (populationCount > 500 || gemRate > 0.5) {
    return createDimension('common_grade', 38, 'Population evidence suggests the grade is not especially scarce.');
  }

  if (['excellent', 'good'].includes(evidenceQuality) || (gemRate > 0 && gemRate <= 0.15)) {
    return createDimension('supported', 72, 'Population evidence supports the grade premium as context.');
  }

  return createDimension('limited', 55, 'Population evidence is present but does not strongly support or reject the premium.');
}

function getHigherGradeRisk(metrics = {}, population = {}) {
  const higherGradeCount = pickFirstNumber([population], ['higherGradeCount', 'higherPopCount', 'popHigher'], 0);

  if (metrics.higherGradeMedian > 0 && metrics.sameGradeMedian > 0) {
    if (metrics.higherGradeMedian <= metrics.sameGradeMedian * 1.12) {
      return createDimension('high', 28, 'Higher-grade sold value is close to this grade, which compresses premium upside.');
    }

    return createDimension('normal', 68, 'Higher-grade sold value leaves room for this grade premium.');
  }

  if (higherGradeCount >= 100) {
    return createDimension('high', 34, 'Many higher-grade copies may cap premium upside.');
  }

  if (higherGradeCount > 0) {
    return createDimension('normal', 60, 'Some higher-grade population exists, but premium cap risk is not extreme.');
  }

  return createDimension('unknown', 45, 'Higher-grade premium cap risk is unknown.');
}

function getConditionClarity(targetProfile = {}, input = {}) {
  const dimensions = input.listingSimilarity?.dimensions || {};
  const conditionDimension = dimensions.condition || {};
  const rawVsGradedDimension = dimensions.rawVsGraded || {};

  if (rawVsGradedDimension.matchStatus === 'mismatch') {
    return createDimension('high_risk', 18, 'Listing Similarity found a raw/graded mismatch.');
  }

  if (targetProfile.rawGradedState === 'graded') {
    return createDimension('clear', 82, 'Slab grade provides condition clarity.');
  }

  if (!targetProfile.condition || targetProfile.condition === 'unknown') {
    return createDimension('unclear', 24, 'Raw condition is unclear, so any condition premium is risky.');
  }

  if (conditionDimension.matchStatus === 'match') {
    return createDimension('clear', 72, 'Listing Similarity found matching condition evidence.');
  }

  if (conditionDimension.matchStatus === 'mismatch') {
    return createDimension('conflicted', 28, 'Listing Similarity found conflicting condition evidence.');
  }

  return createDimension('limited', 48, 'Raw condition exists but comparable condition support is limited.');
}

function getSlabLiquidity(targetProfile = {}, comps = {}, input = {}) {
  const valuationRange = input.valuationRange || {};
  const comparableQuality = input.comparableQuality || {};
  const comparableQualityScore = pickFirstNumber(
    [comparableQuality],
    ['averageComparableQualityScore', 'qualityScore', 'score'],
    0
  );
  const rangeQuality = normalize(valuationRange.rangeQuality);

  if (targetProfile.rawGradedState !== 'graded') {
    return createDimension('not_applicable', 55, 'Slab liquidity does not apply to a raw target.');
  }

  if (comps.sameGrade.length >= 5 && comparableQualityScore >= 70 && ['strong', 'usable'].includes(rangeQuality)) {
    return createDimension('liquid', 84, 'Exact-grade sold comps, comparable quality, and valuation range support slab liquidity.');
  }

  if (comps.sameGrade.length >= 3 || comparableQualityScore >= 60) {
    return createDimension('adequate', 64, 'Slab liquidity appears usable but not deep.');
  }

  if (comps.sameGrade.length > 0) {
    return createDimension('thin', 38, 'Slab liquidity is thin for this exact grade.');
  }

  return createDimension('unknown', 24, 'Slab liquidity cannot be established without exact-grade sold support.');
}

function getPremiumVolatility(input = {}) {
  const evidenceSummary = input.evidenceSummary || {};
  const valuationRange = input.valuationRange || {};
  const priceSpread = pickFirstNumber([evidenceSummary, valuationRange.basis || {}], ['priceSpread'], 0);
  const volatility = pickFirstNumber([evidenceSummary, valuationRange.basis || {}], ['volatility'], 0);
  const confidence = pickFirstNumber([valuationRange], ['confidence'], 0);

  if (!priceSpread && !volatility && !confidence) {
    return createDimension('unknown', 45, 'Premium volatility is unknown because spread and valuation confidence are unavailable.');
  }

  if (priceSpread > 0.85 || volatility > 0.5) {
    return createDimension('high', 28, 'Wide price spread or volatility makes the grade premium unstable.');
  }

  if (priceSpread > 0.45 || volatility > 0.25 || (confidence > 0 && confidence < 50)) {
    return createDimension('moderate', 52, 'Grade premium has moderate volatility or limited valuation confidence.');
  }

  return createDimension('controlled', 78, 'Grade premium volatility appears controlled.');
}

function buildDimensions(input = {}) {
  const targetProfile = getTargetProfile(input);
  const comps = getEvidenceComps(input, targetProfile);
  const metrics = getPremiumMetrics(comps);
  const population = input.populationEvidence || input.populationData || {};

  return {
    sameGradeSupport: getSameGradeSupport(comps),
    lowerGradeSpread: getLowerGradeSpread(metrics, comps.sameGrade.length),
    rawToGradedPremium: getRawToGradedPremium(targetProfile, metrics, comps.sameGrade.length),
    populationSupport: getPopulationSupport(input, comps.sameGrade.length),
    higherGradeRisk: getHigherGradeRisk(metrics, population),
    conditionClarity: getConditionClarity(targetProfile, input),
    slabLiquidity: getSlabLiquidity(targetProfile, comps, input),
    premiumVolatility: getPremiumVolatility(input)
  };
}

function scoreGradePremium(input = {}) {
  const dimensions = input.dimensions || buildDimensions(input);
  const weights = {
    sameGradeSupport: 0.22,
    lowerGradeSpread: 0.16,
    rawToGradedPremium: 0.14,
    populationSupport: 0.12,
    higherGradeRisk: 0.1,
    conditionClarity: 0.1,
    slabLiquidity: 0.1,
    premiumVolatility: 0.06
  };
  let weighted = 0;
  let total = 0;

  for (const [name, weight] of Object.entries(weights)) {
    const score = dimensions[name] && dimensions[name].score;
    if (!Number.isFinite(score)) continue;
    weighted += score * weight;
    total += weight;
  }

  let score = total > 0 ? weighted / total : 0;

  if (dimensions.sameGradeSupport.status === 'missing') score = Math.min(score, 30);
  if (dimensions.sameGradeSupport.status === 'thin') score = Math.min(score, 55);
  if (dimensions.populationSupport.status === 'context_only_no_sold') score = Math.min(score, 30);
  if (['overextended', 'unsupported'].includes(dimensions.lowerGradeSpread.status)) score = Math.min(score, 45);
  if (['overextended', 'unsupported'].includes(dimensions.rawToGradedPremium.status)) score = Math.min(score, 45);
  if (dimensions.conditionClarity.status === 'unclear') score = Math.min(score, 48);
  if (dimensions.higherGradeRisk.status === 'high') score = Math.min(score, 62);
  if (dimensions.premiumVolatility.status === 'high') score = Math.min(score, 62);

  return clampScore(score);
}

function getPremiumJustification(score, dimensions) {
  if (dimensions.sameGradeSupport.status === 'missing') return 'unproven';
  if (
    dimensions.lowerGradeSpread.status === 'overextended' ||
    dimensions.rawToGradedPremium.status === 'overextended'
  ) {
    return 'overextended';
  }

  if (score >= 75) return 'justified';
  if (score >= 55) return 'partially_justified';
  if (score >= 35) return 'unproven';
  return 'unknown';
}

function getPremiumRiskLevel(dimensions) {
  if (
    dimensions.sameGradeSupport.status === 'missing' ||
    dimensions.conditionClarity.status === 'unclear' ||
    dimensions.lowerGradeSpread.status === 'overextended' ||
    dimensions.rawToGradedPremium.status === 'overextended' ||
    dimensions.premiumVolatility.status === 'high'
  ) {
    return 'high';
  }

  if (
    dimensions.sameGradeSupport.status === 'thin' ||
    dimensions.higherGradeRisk.status === 'high' ||
    dimensions.slabLiquidity.status === 'thin'
  ) {
    return 'moderate';
  }

  if (dimensions.sameGradeSupport.status === 'strong' || dimensions.sameGradeSupport.status === 'adequate') {
    return 'low';
  }

  return 'unknown';
}

function summarizeGradePremium(data = {}) {
  if (data.premiumJustification === 'justified') return 'Grade premium appears justified by exact-grade sold evidence and supporting market context.';
  if (data.premiumJustification === 'partially_justified') return 'Grade premium is partially justified but should be reviewed before relying on upside.';
  if (data.premiumJustification === 'overextended') return 'Grade premium appears overextended relative to supporting sold evidence.';
  if (data.premiumJustification === 'unproven') return 'Grade premium is unproven because exact-grade sold support is missing or thin.';
  return 'Grade premium is unknown from the available evidence.';
}

function evaluateGradePremium(input = {}) {
  const targetProfile = getTargetProfile(input);
  const comps = getEvidenceComps(input, targetProfile);
  const premiumMetrics = getPremiumMetrics(comps);
  const dimensions = buildDimensions(input);
  const gradePremiumScore = scoreGradePremium({ dimensions });
  const premiumJustification = getPremiumJustification(gradePremiumScore, dimensions);
  const warnings = [];
  const positives = [];

  for (const [name, dimension] of Object.entries(dimensions)) {
    if (['missing', 'thin', 'unknown', 'unsupported', 'overextended', 'stretched', 'context_only_no_sold', 'common_grade', 'high', 'unclear', 'conflicted'].includes(dimension.status)) {
      warnings.push(`${name}: ${dimension.explanation}`);
    }

    if (['strong', 'adequate', 'supported', 'scarcity_supported', 'clear', 'liquid', 'controlled', 'normal'].includes(dimension.status)) {
      positives.push(`${name}: ${dimension.explanation}`);
    }
  }

  const result = {
    source: 'grade_premium_engine',
    version: '1.2',
    gradePremiumScore,
    premiumJustification,
    premiumRiskLevel: getPremiumRiskLevel(dimensions),
    targetGrade: targetProfile,
    premiumMetrics,
    soldSupport: {
      sameGradeCount: comps.sameGrade.length,
      lowerGradeCount: comps.lowerGrade.length,
      higherGradeCount: comps.higherGrade.length,
      rawCount: comps.raw.length,
      activeContextCount: comps.active.length
    },
    dimensions,
    warnings: uniqueMessages(warnings),
    positives: uniqueMessages(positives),
    summary: ''
  };

  result.summary = summarizeGradePremium(result);
  return result;
}

module.exports = {
  evaluateGradePremium,
  scoreGradePremium,
  summarizeGradePremium
};
