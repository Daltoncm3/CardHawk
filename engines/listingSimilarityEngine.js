'use strict';

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[#/,()[\]{}:;|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeCompact(value) {
  return normalize(value).replace(/\s+/g, '');
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

function getTitle(item = {}) {
  return String(pickFirstValue([item], ['title', 'name', 'listingTitle'], '') || '');
}

function getParsed(item = {}) {
  return item.parsed || item.parsedCard || item.card || {};
}

function tokenize(value) {
  return normalize(value).split(' ').filter((token) => token.length > 1);
}

function tokenOverlapScore(a, b) {
  const aTokens = new Set(tokenize(a));
  const bTokens = new Set(tokenize(b));
  if (!aTokens.size || !bTokens.size) return 0;

  let overlap = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) overlap += 1;
  }

  return overlap / Math.max(aTokens.size, bTokens.size);
}

function extractYear(item = {}) {
  const parsed = getParsed(item);
  const explicitYear = pickFirstValue([parsed, item], ['year', 'season'], '');
  if (explicitYear) return String(explicitYear).trim();

  const match = getTitle(item).match(/\b(19[5-9]\d|20[0-3]\d)\b/);
  return match ? match[1] : '';
}

function extractCardNumber(item = {}) {
  const parsed = getParsed(item);
  const explicitNumber = pickFirstValue([parsed, item], ['cardNumber', 'cardNo', 'number', 'card_num'], '');
  if (explicitNumber) return normalizeCompact(explicitNumber).replace(/^#/, '');

  const match = getTitle(item).match(/(?:#|card\s*)([a-z]{0,4}\d{1,5}[a-z]{0,4})\b/i);
  return match ? normalizeCompact(match[1]) : '';
}

function extractSubject(item = {}) {
  const parsed = getParsed(item);
  return normalize(pickFirstValue([parsed, item], ['player', 'subject', 'playerName', 'character', 'name'], ''));
}

function extractCategory(item = {}) {
  const parsed = getParsed(item);
  const title = normalize(getTitle(item));
  const explicitCategory = pickFirstValue([parsed, item], ['sport', 'category', 'game', 'franchise'], '');

  if (explicitCategory) return normalize(explicitCategory);
  if (/\bpokemon\b|\bpikachu\b|\bcharizard\b|\bsquirtle\b|\bblastoise\b|\bvenusaur\b/.test(title)) return 'pokemon';
  if (/\bbaseball\b|\bmlb\b/.test(title)) return 'baseball';
  if (/\bbasketball\b|\bnba\b/.test(title)) return 'basketball';
  if (/\bfootball\b|\bnfl\b/.test(title)) return 'football';
  if (/\bhockey\b|\bnhl\b/.test(title)) return 'hockey';
  if (/\bsoccer\b|\bfutbol\b/.test(title)) return 'soccer';
  if (/\bufc\b|\bmma\b/.test(title)) return 'ufc';

  return '';
}

function extractSetName(item = {}) {
  const parsed = getParsed(item);
  return normalize(pickFirstValue([parsed, item], ['set', 'cardSet', 'series', 'product', 'brand'], ''));
}

function extractVariation(item = {}) {
  const parsed = getParsed(item);
  const explicit = pickFirstValue([parsed, item], ['variation', 'parallel', 'color', 'insert'], '');
  if (explicit) return normalize(explicit);

  const title = normalize(getTitle(item));
  const terms = [
    'silver', 'gold', 'green', 'red', 'blue', 'pink', 'purple', 'orange', 'black',
    'mojo', 'cracked ice', 'fast break', 'optic', 'select', 'mosaic', 'cosmic',
    'zebra', 'checkerboard', 'wave', 'sapphire', 'atomic', 'xfractor', 'x-fractor',
    'superfractor', 'shimmer', 'velocity', 'laser', 'hyper', 'ice', 'sepia', 'aqua',
    'teal', 'lime', 'bronze', 'purple shock', 'orange ice'
  ];

  return terms.filter((term) => title.includes(term)).join(' ');
}

function pickBoolean(item = {}, keys = []) {
  const parsed = getParsed(item);
  const value = pickFirstValue([parsed, item], keys, undefined);

  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string' && value.trim()) {
    const normalized = normalize(value);
    if (['true', 'yes', 'y', '1'].includes(normalized)) return true;
    if (['false', 'no', 'n', '0'].includes(normalized)) return false;
  }

  return null;
}

function hasFeature(item = {}, feature) {
  const title = normalize(getTitle(item));
  const featureKeys = {
    rookie: ['rookie', 'rc', 'isRookie'],
    autograph: ['autograph', 'auto', 'signed', 'isAutograph'],
    memorabilia: ['patch', 'relic', 'memorabilia', 'jersey', 'isPatch', 'isRelic'],
    serialNumbered: ['serialNumbered', 'numbered', 'isNumbered'],
    sealed: ['sealed', 'wax', 'box', 'pack', 'case', 'isSealed'],
    lot: ['lot', 'bulk', 'collection', 'isLot'],
    reprint: ['reprint', 'proxy', 'custom', 'digital', 'facsimile', 'novelty']
  };
  const explicit = pickBoolean(item, featureKeys[feature] || []);

  if (explicit !== null) return explicit;
  if (feature === 'rookie') return /\brc\b|\brookie\b/.test(title);
  if (feature === 'autograph') return /\bauto\b|\bautograph\b|\bsigned\b/.test(title);
  if (feature === 'memorabilia') return /\bpatch\b|\brelic\b|\bjersey\b|\bmemorabilia\b/.test(title);
  if (feature === 'serialNumbered') return /\/\d{1,5}\b|\bnumbered\b|\bserial\b|\bssp\b|\bsp\b/.test(title);
  if (feature === 'sealed') return /\bsealed\b|\bwax\b|\bbox\b|\bpack\b|\bcase\b|\bbooster\b/.test(title);
  if (feature === 'lot') return /\blot\b|\bbulk\b|\bcollection\b|\b\d+\s*cards\b/.test(title);
  if (feature === 'reprint') return /\breprint\b|\bproxy\b|\bcustom\b|\bdigital\b|\bfacsimile\b|\bnovelty\b/.test(title);

  return false;
}

function extractSerialPrintRun(item = {}) {
  const parsed = getParsed(item);
  const explicitRun = pickFirstNumber(
    [parsed, item],
    ['printRun', 'serialPrintRun', 'numberedTo', 'serialNumberTotal'],
    0
  );

  if (explicitRun > 0) return explicitRun;

  const match = getTitle(item).match(/(?:^|\s|#)\d{1,5}\s*\/\s*(\d{1,5})(?:\s|$)/);
  return match ? toNumber(match[1], 0) : 0;
}

function extractGrader(item = {}) {
  const parsed = getParsed(item);
  const title = normalize(getTitle(item));
  const explicitGrader = pickFirstValue([parsed, item], ['gradingCompany', 'grader', 'grading', 'slabCompany'], '');

  if (explicitGrader) return normalize(explicitGrader);
  if (/\bpsa\b/.test(title)) return 'psa';
  if (/\bbgs\b|\bbeckett\b/.test(title)) return 'bgs';
  if (/\bsgc\b/.test(title)) return 'sgc';
  if (/\bcgc\b|\bcsg\b/.test(title)) return 'cgc';
  if (/\braw\b|\bungraded\b/.test(title)) return 'raw';

  return '';
}

function extractGrade(item = {}) {
  const parsed = getParsed(item);
  const title = normalize(getTitle(item));
  const explicitGrade = pickFirstValue([parsed, item], ['grade', 'conditionGrade'], '');

  if (explicitGrade) {
    const normalizedGrade = normalize(explicitGrade).replace(/^grade\s*/, '');
    if (normalizedGrade.includes('black label')) return 'black_label';
    if (normalizedGrade.includes('pristine')) return 'pristine';
    return normalizedGrade;
  }

  if (/\bblack label\b/.test(title)) return 'black_label';
  if (/\bpristine\b/.test(title)) return 'pristine';

  const match = title.match(/\b(?:psa|bgs|sgc|cgc|csg)\s*(10|9\.5|9|8\.5|8|7\.5|7|6\.5|6|5)?\b/i);
  if (match && match[1]) return match[1];

  if (/\braw\b|\bungraded\b/.test(title)) return 'raw';
  if (/\bdamaged\b|\bdmg\b/.test(title)) return 'damaged';
  if (/\bhp\b|\bheavily played\b/.test(title)) return 'hp';
  if (/\bmp\b|\bmoderately played\b/.test(title)) return 'mp';
  if (/\blp\b|\blightly played\b/.test(title)) return 'lp';
  if (/\bnm\b|\bnear mint\b/.test(title)) return 'nm';

  return '';
}

function extractCondition(item = {}) {
  const parsed = getParsed(item);
  const explicitCondition = pickFirstValue([parsed, item], ['condition', 'cardCondition'], '');
  if (explicitCondition) return normalize(explicitCondition);

  const grade = extractGrade(item);
  return ['raw', 'nm', 'lp', 'mp', 'hp', 'damaged'].includes(grade) ? grade : '';
}

function getRawGradedState(profile = {}) {
  if (profile.grader && profile.grader !== 'raw') return 'graded';
  if (profile.grade && !['raw', 'nm', 'lp', 'mp', 'hp', 'damaged'].includes(profile.grade)) return 'graded';
  if (profile.grader === 'raw' || ['raw', 'nm', 'lp', 'mp', 'hp', 'damaged'].includes(profile.grade)) return 'raw';
  return '';
}

function normalizeListingProfile(item = {}) {
  const title = getTitle(item);

  return {
    title,
    titleNormalized: normalize(title),
    subject: extractSubject(item),
    category: extractCategory(item),
    year: extractYear(item),
    setName: extractSetName(item),
    cardNumber: extractCardNumber(item),
    parallel: hasFeature(item, 'serialNumbered') || Boolean(extractVariation(item)),
    variation: extractVariation(item),
    rookie: hasFeature(item, 'rookie'),
    autograph: hasFeature(item, 'autograph'),
    memorabilia: hasFeature(item, 'memorabilia'),
    serialNumbered: hasFeature(item, 'serialNumbered'),
    serialPrintRun: extractSerialPrintRun(item),
    gradingCompany: extractGrader(item),
    grade: extractGrade(item),
    rawGradedState: '',
    condition: extractCondition(item),
    marketplace: normalize(pickFirstValue([getParsed(item), item], ['marketplace', 'source', 'platform'], '')),
    ageDays: pickFirstNumber([item], ['ageDays', 'daysOld', 'daysSinceSale', 'soldDaysAgo'], NaN),
    sealed: hasFeature(item, 'sealed'),
    lot: hasFeature(item, 'lot'),
    reprint: hasFeature(item, 'reprint')
  };
}

function finalizeProfile(profile) {
  return {
    ...profile,
    rawGradedState: getRawGradedState(profile)
  };
}

function createDimension(name, listingValue, comparableValue, status, score, explanation) {
  return {
    name,
    listingValue,
    comparableValue,
    matchStatus: status,
    score: score === null ? null : clampScore(score),
    explanation
  };
}

function compareTextDimension(name, listingValue, comparableValue, label, mismatchPenalty = true) {
  if (!listingValue && !comparableValue) {
    return createDimension(name, listingValue, comparableValue, 'missing', null, `${label} was unavailable on both listings.`);
  }

  if (!listingValue || !comparableValue) {
    return createDimension(name, listingValue, comparableValue, 'missing', 50, `${label} was missing on one listing, so this dimension is inconclusive.`);
  }

  if (listingValue === comparableValue) {
    return createDimension(name, listingValue, comparableValue, 'match', 100, `${label} matched exactly.`);
  }

  const overlap = tokenOverlapScore(listingValue, comparableValue);
  if (overlap >= 0.65) {
    return createDimension(name, listingValue, comparableValue, 'partial_match', 78, `${label} partially matched based on token overlap.`);
  }

  return createDimension(
    name,
    listingValue,
    comparableValue,
    'mismatch',
    mismatchPenalty ? 0 : 35,
    `${label} did not match.`
  );
}

function compareExactDimension(name, listingValue, comparableValue, label) {
  if (!listingValue && !comparableValue) {
    return createDimension(name, listingValue, comparableValue, 'missing', null, `${label} was unavailable on both listings.`);
  }

  if (!listingValue || !comparableValue) {
    return createDimension(name, listingValue, comparableValue, 'missing', 50, `${label} was missing on one listing, so this dimension is inconclusive.`);
  }

  if (listingValue === comparableValue) {
    return createDimension(name, listingValue, comparableValue, 'match', 100, `${label} matched exactly.`);
  }

  return createDimension(name, listingValue, comparableValue, 'mismatch', 0, `${label} did not match.`);
}

function compareBooleanDimension(name, listingValue, comparableValue, label) {
  if (listingValue === comparableValue) {
    return createDimension(name, listingValue, comparableValue, 'match', 100, `${label} matched.`);
  }

  return createDimension(name, listingValue, comparableValue, 'mismatch', 0, `${label} did not match.`);
}

function compareSerialDimension(listingProfile, comparableProfile) {
  if (listingProfile.serialNumbered !== comparableProfile.serialNumbered) {
    return createDimension(
      'serialNumbering',
      listingProfile.serialNumbered ? `numbered${listingProfile.serialPrintRun ? ` /${listingProfile.serialPrintRun}` : ''}` : 'not_numbered',
      comparableProfile.serialNumbered ? `numbered${comparableProfile.serialPrintRun ? ` /${comparableProfile.serialPrintRun}` : ''}` : 'not_numbered',
      'mismatch',
      0,
      'Serial-numbered status did not match.'
    );
  }

  if (!listingProfile.serialNumbered) {
    return createDimension('serialNumbering', 'not_numbered', 'not_numbered', 'match', 100, 'Both listings appear unnumbered.');
  }

  if (listingProfile.serialPrintRun > 0 && comparableProfile.serialPrintRun > 0) {
    if (listingProfile.serialPrintRun === comparableProfile.serialPrintRun) {
      return createDimension('serialNumbering', `/${listingProfile.serialPrintRun}`, `/${comparableProfile.serialPrintRun}`, 'match', 100, 'Serial print run matched exactly.');
    }

    const lowRun = Math.min(listingProfile.serialPrintRun, comparableProfile.serialPrintRun);
    const highRun = Math.max(listingProfile.serialPrintRun, comparableProfile.serialPrintRun);
    const ratio = highRun / lowRun;
    const score = ratio >= 5 ? 15 : ratio >= 2 ? 35 : 70;
    return createDimension('serialNumbering', `/${listingProfile.serialPrintRun}`, `/${comparableProfile.serialPrintRun}`, 'mismatch', score, 'Serial print run differed.');
  }

  return createDimension('serialNumbering', 'numbered', 'numbered', 'partial_match', 75, 'Both listings appear serial-numbered, but print run was incomplete.');
}

function compareGradeDimension(listingProfile, comparableProfile) {
  const listingGrade = listingProfile.grade;
  const comparableGrade = comparableProfile.grade;

  if (!listingGrade && !comparableGrade) {
    return createDimension('grade', listingGrade, comparableGrade, 'missing', null, 'Grade was unavailable on both listings.');
  }

  if (!listingGrade || !comparableGrade) {
    return createDimension('grade', listingGrade, comparableGrade, 'missing', 50, 'Grade was missing on one listing, so this dimension is inconclusive.');
  }

  if (listingGrade === comparableGrade) {
    return createDimension('grade', listingGrade, comparableGrade, 'match', 100, 'Grade matched exactly.');
  }

  const listingNumber = toNumber(listingGrade, NaN);
  const comparableNumber = toNumber(comparableGrade, NaN);

  if (Number.isFinite(listingNumber) && Number.isFinite(comparableNumber)) {
    const difference = Math.abs(listingNumber - comparableNumber);
    if (difference <= 0.5) {
      return createDimension('grade', listingGrade, comparableGrade, 'partial_match', 78, 'Numeric grades were close but not identical.');
    }

    if (difference <= 1) {
      return createDimension('grade', listingGrade, comparableGrade, 'mismatch', 45, 'Numeric grades differed by one point.');
    }
  }

  return createDimension('grade', listingGrade, comparableGrade, 'mismatch', 20, 'Grades did not match.');
}

function createContextDimension(name, listingValue, comparableValue, explanation) {
  return createDimension(name, listingValue, comparableValue, 'context_only', null, explanation);
}

function getSimilarityBand(score) {
  if (score >= 95) return 'exact';
  if (score >= 85) return 'strong';
  if (score >= 70) return 'usable';
  if (score >= 45) return 'weak';
  return 'reject';
}

function getMatchConfidence(dimensions) {
  const scored = Object.values(dimensions).filter((dimension) => Number.isFinite(dimension.score));
  const missing = Object.values(dimensions).filter((dimension) => dimension.matchStatus === 'missing');
  const criticalMismatch = ['subject', 'cardNumber', 'rawVsGraded', 'autograph', 'serialNumbering']
    .some((key) => dimensions[key] && dimensions[key].matchStatus === 'mismatch');

  if (criticalMismatch) return 'low';
  if (scored.length >= 10 && missing.length <= 2) return 'high';
  if (scored.length >= 6) return 'medium';
  return 'low';
}

function applyCaps(score, dimensions, caps, fatalMismatches) {
  let cappedScore = score;

  function capIf(condition, cap, reason, fatal = false) {
    if (!condition) return;
    cappedScore = Math.min(cappedScore, cap);
    caps.push({ cap, reason });
    if (fatal) fatalMismatches.push(reason);
  }

  capIf(dimensions.subject.matchStatus === 'mismatch', 35, 'subject mismatch', true);
  capIf(dimensions.cardNumber.matchStatus === 'mismatch', 45, 'card number mismatch', true);
  capIf(dimensions.rawVsGraded.matchStatus === 'mismatch', 45, 'raw/graded mismatch', true);
  capIf(dimensions.autograph.matchStatus === 'mismatch', 55, 'autograph mismatch', true);
  capIf(dimensions.serialNumbering.matchStatus === 'mismatch', 55, 'serial numbering mismatch', true);
  capIf(dimensions.parallel.matchStatus === 'mismatch', 62, 'base/parallel mismatch');
  capIf(dimensions.variation.matchStatus === 'mismatch', 62, 'parallel/variation mismatch');
  capIf(dimensions.grade.matchStatus === 'mismatch' && dimensions.grade.score <= 45, 72, 'grade mismatch');

  return clampScore(cappedScore);
}

function getDimensionWeights() {
  return {
    subject: 20,
    set: 10,
    cardNumber: 12,
    year: 8,
    parallel: 8,
    variation: 8,
    rookie: 5,
    autograph: 9,
    memorabilia: 5,
    serialNumbering: 8,
    gradingCompany: 5,
    grade: 8,
    rawVsGraded: 7,
    condition: 4
  };
}

function scoreListingSimilarity(input = {}) {
  const listingProfile = finalizeProfile(normalizeListingProfile(input.listing || input.target || {}));
  const comparableProfile = finalizeProfile(normalizeListingProfile(input.comp || input.comparable || input));

  const dimensions = {
    subject: compareTextDimension('subject', listingProfile.subject, comparableProfile.subject, 'Subject/player'),
    set: compareTextDimension('set', listingProfile.setName, comparableProfile.setName, 'Set/product', false),
    cardNumber: compareExactDimension('cardNumber', listingProfile.cardNumber, comparableProfile.cardNumber, 'Card number'),
    year: compareExactDimension('year', listingProfile.year, comparableProfile.year, 'Year'),
    parallel: compareBooleanDimension('parallel', listingProfile.parallel, comparableProfile.parallel, 'Base/parallel status'),
    variation: compareTextDimension('variation', listingProfile.variation, comparableProfile.variation, 'Parallel/variation', false),
    rookie: compareBooleanDimension('rookie', listingProfile.rookie, comparableProfile.rookie, 'Rookie designation'),
    autograph: compareBooleanDimension('autograph', listingProfile.autograph, comparableProfile.autograph, 'Autograph status'),
    memorabilia: compareBooleanDimension('memorabilia', listingProfile.memorabilia, comparableProfile.memorabilia, 'Memorabilia/relic status'),
    serialNumbering: compareSerialDimension(listingProfile, comparableProfile),
    gradingCompany: compareExactDimension('gradingCompany', listingProfile.gradingCompany, comparableProfile.gradingCompany, 'Grading company'),
    grade: compareGradeDimension(listingProfile, comparableProfile),
    rawVsGraded: compareExactDimension('rawVsGraded', listingProfile.rawGradedState, comparableProfile.rawGradedState, 'Raw vs graded state'),
    condition: compareTextDimension('condition', listingProfile.condition, comparableProfile.condition, 'Condition', false),
    recencyContext: createContextDimension('recencyContext', null, comparableProfile.ageDays, 'Sale recency is context only and does not affect identity similarity.'),
    marketplaceContext: createContextDimension('marketplaceContext', listingProfile.marketplace, comparableProfile.marketplace, 'Marketplace consistency is context only and does not affect identity similarity.'),
    imageSimilarity: createDimension('imageSimilarity', null, null, 'not_available', null, 'Image similarity is not implemented yet.')
  };

  const weights = getDimensionWeights();
  let weightedScore = 0;
  let totalWeight = 0;

  for (const [key, weight] of Object.entries(weights)) {
    const dimension = dimensions[key];
    if (!dimension || !Number.isFinite(dimension.score)) continue;
    weightedScore += dimension.score * weight;
    totalWeight += weight;
  }

  let similarityScore = totalWeight > 0 ? weightedScore / totalWeight : 0;
  const caps = [];
  const fatalMismatches = [];
  similarityScore = applyCaps(similarityScore, dimensions, caps, fatalMismatches);

  const warnings = [];
  const positives = [];

  for (const dimension of Object.values(dimensions)) {
    if (dimension.matchStatus === 'mismatch') warnings.push(dimension.explanation);
    if (dimension.matchStatus === 'match') positives.push(dimension.explanation);
  }

  if (caps.length) warnings.push('Similarity was capped because one or more high-impact dimensions did not match.');

  const result = {
    source: 'listing_similarity_engine',
    version: '1.2',
    similarityScore,
    similarityBand: getSimilarityBand(similarityScore),
    matchConfidence: getMatchConfidence(dimensions),
    dimensions,
    caps,
    fatalMismatches: uniqueMessages(fatalMismatches),
    warnings: uniqueMessages(warnings),
    positives: uniqueMessages(positives),
    summary: ''
  };

  result.summary = summarizeListingSimilarity(result);
  return result;
}

function summarizeListingSimilarity(data = {}) {
  const band = data.similarityBand || getSimilarityBand(data.similarityScore);

  if (band === 'exact') return 'Listing similarity is exact or near-exact across the available dimensions.';
  if (band === 'strong') return 'Listing similarity is strong, with only minor differences or missing details.';
  if (band === 'usable') return 'Listing similarity is usable as evidence, but dimension-level differences should be reviewed.';
  if (band === 'weak') return 'Listing similarity is weak and should remain directional evidence only.';
  return 'Listing similarity is rejected or too weak because high-impact dimensions do not match.';
}

function summarizeBatch(scoredComps) {
  if (!scoredComps.length) return 'No comparable listings were available for similarity evaluation.';
  const average = scoredComps.reduce((sum, comp) => sum + comp.similarityScore, 0) / scoredComps.length;
  const band = getSimilarityBand(average);
  if (band === 'exact' || band === 'strong') return 'Comparable listings show strong similarity to the target listing.';
  if (band === 'usable') return 'Comparable listings show usable but review-worthy similarity to the target listing.';
  return 'Comparable listings show weak similarity and should be reviewed cautiously.';
}

function evaluateListingSimilarity(input = {}) {
  const listing = input.listing || input.target || {};
  const comps = asArray(input.comps || input.comparables || input.selectedComps);

  if (!comps.length && (input.comp || input.comparable)) {
    return scoreListingSimilarity({
      listing,
      comp: input.comp || input.comparable,
      context: input.context
    });
  }

  const scoredComps = comps.map((comp) => scoreListingSimilarity({ listing, comp }));
  const distribution = {
    exact: 0,
    strong: 0,
    usable: 0,
    weak: 0,
    reject: 0
  };

  for (const scoredComp of scoredComps) {
    distribution[scoredComp.similarityBand] += 1;
  }

  const averageSimilarityScore = scoredComps.length
    ? clampScore(scoredComps.reduce((sum, comp) => sum + comp.similarityScore, 0) / scoredComps.length)
    : 0;

  return {
    source: 'listing_similarity_engine',
    version: '1.2',
    comparableCount: comps.length,
    averageSimilarityScore,
    similarityDistribution: distribution,
    scoredComps,
    warnings: uniqueMessages(scoredComps.flatMap((comp) => comp.warnings)),
    summary: summarizeBatch(scoredComps)
  };
}

module.exports = {
  evaluateListingSimilarity,
  scoreListingSimilarity,
  summarizeListingSimilarity,
  normalizeListingProfile
};
