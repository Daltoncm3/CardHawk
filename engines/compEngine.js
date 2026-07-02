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

function pickFirstValue(sources, keys, fallback = undefined) {
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;
    for (const key of keys) {
      if (source[key] !== undefined && source[key] !== null && source[key] !== '') return source[key];
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

function getTitle(item = {}) {
  return String(pickFirstValue([item], ['title', 'name', 'listingTitle'], '') || '');
}

function getParsed(item = {}) {
  return item.parsed || item.parsedCard || item.card || {};
}

function hasText(value) {
  return normalize(value).length > 0;
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

function getMedian(values) {
  const cleanValues = values
    .map((value) => toNumber(value, NaN))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);

  if (!cleanValues.length) return 0;

  const middle = Math.floor(cleanValues.length / 2);
  return cleanValues.length % 2
    ? cleanValues[middle]
    : (cleanValues[middle - 1] + cleanValues[middle]) / 2;
}

function extractYear(item = {}) {
  const parsed = getParsed(item);
  const title = getTitle(item);
  const explicitYear = pickFirstValue([parsed, item], ['year', 'season'], '');
  if (explicitYear) return String(explicitYear).trim();

  const match = title.match(/\b(19[5-9]\d|20[0-3]\d)\b/);
  return match ? match[1] : '';
}

function extractCardNumber(item = {}) {
  const parsed = getParsed(item);
  const title = getTitle(item);
  const explicitNumber = pickFirstValue([parsed, item], ['cardNumber', 'cardNo', 'number', 'card_num'], '');

  if (explicitNumber) return normalize(explicitNumber).replace(/^#/, '');

  const match = title.match(/(?:#|card\s*)([a-z]{0,4}\d{1,5}[a-z]{0,4})\b/i);
  return match ? normalize(match[1]) : '';
}

function extractSerialNumbered(item = {}) {
  const parsed = getParsed(item);
  const title = normalize(getTitle(item));
  const explicitSerial = pickFirstValue([parsed, item], ['serialNumbered', 'numbered', 'isNumbered'], undefined);

  if (typeof explicitSerial === 'boolean') return explicitSerial;

  return /\/\d{1,5}\b|\bnumbered\b|\bserial\b|\bssp\b|\bsp\b/.test(title);
}

function extractGrade(item = {}) {
  const parsed = getParsed(item);
  const title = normalize(getTitle(item));
  const explicitGrade = pickFirstValue([parsed, item], ['grade', 'conditionGrade'], '');
  if (explicitGrade) return normalize(explicitGrade).replace(/^grade\s*/, '');

  const match = title.match(/\b(?:psa|bgs|sgc|cgc|csg|raw)\s*(10|9\.5|9|8\.5|8|7\.5|7|6\.5|6|5)?\b/i);
  if (match && match[1]) return match[1];

  if (/\braw\b|\bungraded\b/.test(title)) return 'raw';
  if (/\bdamaged\b|\bdmg\b/.test(title)) return 'damaged';
  if (/\bmp\b|\bmoderately played\b/.test(title)) return 'mp';
  if (/\blp\b|\blightly played\b/.test(title)) return 'lp';
  if (/\bnm\b|\bnear mint\b/.test(title)) return 'nm';

  return '';
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

function extractSubject(item = {}) {
  const parsed = getParsed(item);
  return normalize(pickFirstValue([parsed, item], ['player', 'subject', 'playerName', 'character', 'name'], ''));
}

function extractSport(item = {}) {
  const parsed = getParsed(item);
  const title = normalize(getTitle(item));
  const explicitSport = pickFirstValue([parsed, item], ['sport', 'category', 'game', 'franchise'], '');

  if (explicitSport) return normalize(explicitSport);
  if (/\bpokemon\b|\bpikachu\b|\bcharizard\b|\bsquirtle\b|\bblastoise\b|\bvenusaur\b/.test(title)) return 'pokemon';
  if (/\bbaseball\b|\bmlb\b/.test(title)) return 'baseball';
  if (/\bbasketball\b|\bnba\b/.test(title)) return 'basketball';
  if (/\bfootball\b|\bnfl\b/.test(title)) return 'football';
  if (/\bhockey\b|\bnhl\b/.test(title)) return 'hockey';
  if (/\bsoccer\b|\bfutbol\b/.test(title)) return 'soccer';
  if (/\bufc\b|\bmma\b/.test(title)) return 'ufc';
  if (/\bracing\b|\bnascar\b|\bf1\b|\bformula 1\b/.test(title)) return 'racing';

  return '';
}

function extractSetName(item = {}) {
  const parsed = getParsed(item);
  return normalize(pickFirstValue([parsed, item], ['set', 'cardSet', 'series', 'product', 'brand'], ''));
}

function extractVariation(item = {}) {
  const parsed = getParsed(item);
  const title = normalize(getTitle(item));
  const explicit = pickFirstValue([parsed, item], ['variation', 'parallel', 'color', 'insert'], '');
  if (explicit) return normalize(explicit);

  const variationTerms = [
    'silver', 'gold', 'green', 'red', 'blue', 'pink', 'purple', 'orange', 'black',
    'white', 'mojo', 'cracked ice', 'fast break', 'optic', 'select', 'mosaic',
    'cosmic', 'zebra', 'tiger', 'checkerboard', 'wave', 'scope', 'disco'
  ];

  return variationTerms.filter((term) => title.includes(term)).join(' ');
}

function hasFeature(item = {}, feature) {
  const parsed = getParsed(item);
  const title = normalize(getTitle(item));

  const featureKeys = {
    rookie: ['rookie', 'rc', 'isRookie'],
    autograph: ['autograph', 'auto', 'signed', 'isAutograph'],
    patch: ['patch', 'relic', 'memorabilia', 'jersey', 'isPatch', 'isRelic'],
    refractor: ['refractor', 'parallel', 'prizm', 'holo', 'foil', 'chrome', 'isRefractor', 'isParallel'],
    sealed: ['sealed', 'wax', 'box', 'pack', 'case', 'isSealed'],
    lot: ['lot', 'bulk', 'collection', 'isLot'],
    reprint: ['reprint', 'proxy', 'custom', 'digital', 'facsimile', 'novelty']
  };

  const explicitValue = pickFirstValue([parsed, item], featureKeys[feature] || [], undefined);

  if (typeof explicitValue === 'boolean') return explicitValue;
  if (typeof explicitValue === 'string' && explicitValue.trim()) {
    const value = normalize(explicitValue);
    if (['true', 'yes', 'y', '1'].includes(value)) return true;
    if (['false', 'no', 'n', '0'].includes(value)) return false;
  }

  if (feature === 'rookie') return /\brc\b|\brookie\b/.test(title);
  if (feature === 'autograph') return /\bauto\b|\bautograph\b|\bsigned\b/.test(title);
  if (feature === 'patch') return /\bpatch\b|\brelic\b|\bjersey\b|\bmemorabilia\b/.test(title);
  if (feature === 'refractor') return /\brefractor\b|\bparallel\b|\bprizm\b|\bholo\b|\bfoil\b|\bchrome\b|\bsilver\b|\bgold\b|\bcracked ice\b|\bmojo\b/.test(title);
  if (feature === 'sealed') return /\bsealed\b|\bwax\b|\bbox\b|\bpack\b|\bcase\b|\bbooster\b/.test(title);
  if (feature === 'lot') return /\blot\b|\bbulk\b|\bcollection\b|\b\d+\s*cards\b/.test(title);
  if (feature === 'reprint') return /\breprint\b|\bproxy\b|\bcustom\b|\bdigital\b|\bfacsimile\b|\bnovelty\b/.test(title);

  return false;
}

function getSoldPrice(comp = {}) {
  return pickFirstNumber([comp], ['soldPrice', 'salePrice', 'price', 'amount', 'totalPrice', 'value'], 0);
}

function getSoldDate(comp = {}) {
  const value = pickFirstValue([comp], ['soldDate', 'saleDate', 'dateSold', 'endedAt', 'endDate', 'timestamp'], '');
  const timestamp = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(timestamp) ? new Date(timestamp) : null;
}

function getAgeDays(comp = {}) {
  const explicitAge = pickFirstNumber([comp], ['ageDays', 'daysOld', 'daysSinceSale', 'soldDaysAgo'], NaN);
  if (Number.isFinite(explicitAge)) return Math.max(0, explicitAge);

  const soldDate = getSoldDate(comp);
  if (!soldDate) return 365;

  const ageMs = Date.now() - soldDate.getTime();
  return ageMs > 0 ? Math.floor(ageMs / 86400000) : 0;
}

function getRecencyWeight(ageDays) {
  if (ageDays <= 14) return 1.18;
  if (ageDays <= 30) return 1.08;
  if (ageDays <= 60) return 1;
  if (ageDays <= 90) return 0.88;
  if (ageDays <= 180) return 0.7;
  if (ageDays <= 365) return 0.5;
  return 0.32;
}

function getSaleType(comp = {}) {
  const source = normalize(
    pickFirstValue([comp], ['saleType', 'format', 'listingType', 'purchaseType', 'type'], '')
  );
  const title = normalize(getTitle(comp));

  if (source.includes('auction') || title.includes('auction')) return 'auction';
  if (source.includes('best') || source.includes('offer') || title.includes('best offer')) return 'best_offer';
  if (source.includes('buy') || source.includes('bin') || source.includes('fixed')) return 'buy_it_now';

  return 'unknown';
}

function getSaleTypeWeight(saleType) {
  if (saleType === 'auction') return 1.08;
  if (saleType === 'best_offer') return 0.78;
  if (saleType === 'buy_it_now') return 0.92;
  return 0.88;
}

function getComparableProfile(item = {}) {
  return {
    title: getTitle(item),
    titleNormalized: normalize(getTitle(item)),
    subject: extractSubject(item),
    year: extractYear(item),
    sport: extractSport(item),
    setName: extractSetName(item),
    cardNumber: extractCardNumber(item),
    rookie: hasFeature(item, 'rookie'),
    autograph: hasFeature(item, 'autograph'),
    patch: hasFeature(item, 'patch'),
    refractor: hasFeature(item, 'refractor'),
    serialNumbered: extractSerialNumbered(item),
    variation: extractVariation(item),
    grader: extractGrader(item),
    grade: extractGrade(item),
    sealed: hasFeature(item, 'sealed'),
    lot: hasFeature(item, 'lot'),
    reprint: hasFeature(item, 'reprint')
  };
}

function compareExactFeature(listingValue, compValue, weight, label, details) {
  if (listingValue === compValue) {
    details.push(`${label} matched`);
    return weight;
  }

  if (listingValue || compValue) {
    details.push(`${label} mismatch`);
    return -Math.round(weight * 1.1);
  }

  return 0;
}

function gradePenalty(listingGrade, compGrade, details) {
  if (!listingGrade || !compGrade) return 0;

  if (listingGrade === compGrade) {
    details.push('grade matched');
    return 10;
  }

  if (listingGrade === 'raw' || compGrade === 'raw') {
    details.push('raw/slab grade mismatch');
    return -22;
  }

  const weakGrades = ['lp', 'mp', 'hp', 'damaged', 'dmg'];
  if (weakGrades.includes(listingGrade) || weakGrades.includes(compGrade)) {
    details.push('condition quality mismatch');
    return -18;
  }

  const listingNumeric = toNumber(listingGrade, NaN);
  const compNumeric = toNumber(compGrade, NaN);

  if (Number.isFinite(listingNumeric) && Number.isFinite(compNumeric)) {
    const difference = Math.abs(listingNumeric - compNumeric);

    if (difference <= 0.5) {
      details.push('grade very close');
      return 6;
    }

    if (difference <= 1) {
      details.push('grade close');
      return 2;
    }

    details.push('grade mismatch');
    return -14;
  }

  return -6;
}

function compareSimilarity(listingProfile, compProfile) {
  let score = 0;
  const details = [];

  if (hasText(listingProfile.subject) && hasText(compProfile.subject)) {
    if (listingProfile.subject === compProfile.subject) {
      score += 24;
      details.push('subject matched');
    } else {
      const overlap = tokenOverlapScore(listingProfile.subject, compProfile.subject);
      score += Math.round(12 * overlap);
      if (overlap < 0.5) {
        score -= 22;
        details.push('subject mismatch');
      }
    }
  } else {
    score += Math.round(8 * tokenOverlapScore(listingProfile.title, compProfile.title));
  }

  if (listingProfile.year && compProfile.year) {
    if (listingProfile.year === compProfile.year) score += 10;
    else score -= 11;
  }

  if (listingProfile.sport && compProfile.sport) {
    if (listingProfile.sport === compProfile.sport) score += 8;
    else score -= 18;
  }

  if (listingProfile.setName && compProfile.setName) {
    const setOverlap = tokenOverlapScore(listingProfile.setName, compProfile.setName);
    score += Math.round(14 * setOverlap);
    if (setOverlap < 0.35) score -= 9;
  }

  if (listingProfile.cardNumber && compProfile.cardNumber) {
    if (listingProfile.cardNumber === compProfile.cardNumber) score += 10;
    else score -= 10;
  }

  score += compareExactFeature(listingProfile.rookie, compProfile.rookie, 8, 'rookie/RC', details);
  score += compareExactFeature(listingProfile.autograph, compProfile.autograph, 12, 'autograph', details);
  score += compareExactFeature(listingProfile.patch, compProfile.patch, 8, 'patch/relic', details);
  score += compareExactFeature(listingProfile.refractor, compProfile.refractor, 8, 'refractor/prizm/chrome', details);
  score += compareExactFeature(listingProfile.serialNumbered, compProfile.serialNumbered, 8, 'serial-numbered', details);

  if (listingProfile.variation && compProfile.variation) {
    const variationOverlap = tokenOverlapScore(listingProfile.variation, compProfile.variation);
    score += Math.round(8 * variationOverlap);
    if (variationOverlap < 0.35) score -= 8;
  } else if (listingProfile.variation || compProfile.variation) {
    score -= 5;
  }

  if (listingProfile.grader && compProfile.grader) {
    if (listingProfile.grader === compProfile.grader) score += 7;
    else score -= 10;
  }

  score += gradePenalty(listingProfile.grade, compProfile.grade, details);

  if (listingProfile.reprint !== compProfile.reprint) score -= 35;
  if (listingProfile.sealed !== compProfile.sealed) score -= 20;
  if (listingProfile.lot !== compProfile.lot) score -= 20;

  score += Math.round(10 * tokenOverlapScore(listingProfile.title, compProfile.title));

  return {
    similarity: Math.max(0, Math.min(100, Math.round(score))),
    details
  };
}

function detectOutliers(comps) {
  if (comps.length < 5) return { kept: comps, ignored: [] };

  const prices = comps.map((comp) => comp.soldPrice).filter((price) => price > 0);
  const median = getMedian(prices);

  if (!median) return { kept: comps, ignored: [] };

  const deviations = prices.map((price) => Math.abs(price - median));
  const medianDeviation = getMedian(deviations) || median * 0.25;

  const kept = [];
  const ignored = [];

  for (const comp of comps) {
    const ratio = comp.soldPrice / median;
    const robustDeviation = Math.abs(comp.soldPrice - median) / medianDeviation;

    const isOutlier =
      ratio >= 2.75 ||
      ratio <= 0.32 ||
      (robustDeviation > 4.5 && (ratio >= 1.9 || ratio <= 0.52));

    if (isOutlier) ignored.push({ ...comp, outlierReason: 'price_outlier' });
    else kept.push(comp);
  }

  return { kept, ignored };
}

function getWeightedAverage(comps) {
  const weighted = comps
    .map((comp) => {
      if (!comp.soldPrice || comp.soldPrice <= 0) return null;

      const similarityWeight = Math.max(0.15, Math.pow(comp.similarity / 100, 2.35));
      const recencyWeight = getRecencyWeight(comp.ageDays);
      const saleTypeWeight = getSaleTypeWeight(comp.saleType);
      const weight = similarityWeight * recencyWeight * saleTypeWeight;

      return { price: comp.soldPrice, weight };
    })
    .filter(Boolean);

  if (!weighted.length) return 0;

  const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0);
  const weightedValue = weighted.reduce((sum, item) => sum + item.price * item.weight, 0);

  return totalWeight > 0 ? weightedValue / totalWeight : 0;
}

function getWeightedCompCount(comps) {
  return comps.reduce((sum, comp) => {
    return sum + Math.max(0.15, Math.pow(comp.similarity / 100, 2.35)) * getRecencyWeight(comp.ageDays);
  }, 0);
}

function getPricingSpread(comps, marketValue) {
  if (!comps.length || !marketValue) return 0;

  const prices = comps.map((comp) => comp.soldPrice).filter((price) => price > 0);
  if (!prices.length) return 0;

  return (Math.max(...prices) - Math.min(...prices)) / marketValue;
}

function getMarketConsistency(pricingSpread) {
  if (pricingSpread <= 0) return 'unknown';
  if (pricingSpread <= 0.28) return 'tight_market';
  if (pricingSpread <= 0.65) return 'normal_market';
  return 'volatile_market';
}

function getVolatilityScore(pricingSpread) {
  if (pricingSpread <= 0) return 45;
  if (pricingSpread <= 0.28) return 95;
  if (pricingSpread <= 0.45) return 78;
  if (pricingSpread <= 0.65) return 60;
  if (pricingSpread <= 0.9) return 38;
  return 20;
}

function getConfidence(usableComps, strongCompCount, averageSimilarity, pricingSpread, fallbackUsed) {
  if (fallbackUsed) return 25;
  if (!usableComps.length) return 0;

  const averageAgeDays = usableComps.reduce((sum, comp) => sum + comp.ageDays, 0) / usableComps.length;
  const auctionCount = usableComps.filter((comp) => comp.saleType === 'auction').length;
  const bestOfferCount = usableComps.filter((comp) => comp.saleType === 'best_offer').length;

  let confidence = 24;
  confidence += Math.min(24, usableComps.length * 4);
  confidence += Math.min(22, strongCompCount * 7);
  confidence += Math.max(0, Math.min(18, (averageSimilarity - 75) * 1.1));
  confidence += Math.max(0, Math.min(12, getVolatilityScore(pricingSpread) / 8));

  if (averageAgeDays <= 30) confidence += 8;
  else if (averageAgeDays <= 90) confidence += 4;
  else if (averageAgeDays > 180) confidence -= 8;

  confidence += Math.min(6, auctionCount * 2);
  confidence -= Math.min(10, bestOfferCount * 3);

  return Math.max(0, Math.min(100, Math.round(confidence)));
}

function runFallbackEstimator(listing, options) {
  if (!options || typeof options.fallbackEstimator !== 'function') return null;

  try {
    const fallback = options.fallbackEstimator(listing);
    if (!fallback || typeof fallback !== 'object') return null;

    const value = toNumber(fallback.marketValue || fallback.value || fallback.estimatedValue, 0);
    if (!value || value <= 0) return null;

    return { marketValue: value, fallback };
  } catch (error) {
    return null;
  }
}

function summarizeComps(data = {}) {
  const source = data.source || 'comp_engine';
  const confidence = toNumber(data.confidence, 0);
  const compCount = toNumber(data.compCount, 0);
  const strongCompCount = toNumber(data.strongCompCount, 0);
  const marketConsistency = data.marketConsistency || 'unknown';

  if (source === 'heuristic_fallback') {
    return 'No usable sold comps were found; valuation uses a low-confidence heuristic fallback.';
  }

  if (compCount <= 0) return 'No usable comparable sales were found.';

  if (strongCompCount >= 3 && confidence >= 75 && marketConsistency === 'tight_market') {
    return 'Comparable sales are strong, recent, and tightly clustered.';
  }

  if (strongCompCount >= 1 && confidence >= 60) {
    return 'Comparable sales are usable, with enough similarity to support a cautious market value.';
  }

  return 'Comparable sales are limited, older, volatile, or only moderately similar; valuation should be reviewed conservatively.';
}

function evaluateListing(listing = {}, compUniverse = [], options = {}) {
  const warnings = [];
  const positives = [];
  const listingProfile = getComparableProfile(listing);

  const scoredComps = asArray(compUniverse)
    .map((comp) => {
      const comparison = compareSimilarity(listingProfile, getComparableProfile(comp));
      const soldPrice = getSoldPrice(comp);
      const ageDays = getAgeDays(comp);
      const saleType = getSaleType(comp);

      return {
        ...comp,
        soldPrice,
        ageDays,
        saleType,
        recencyWeight: Number(getRecencyWeight(ageDays).toFixed(3)),
        saleTypeWeight: getSaleTypeWeight(saleType),
        similarity: comparison.similarity,
        similarityDetails: comparison.details
      };
    })
    .filter((comp) => comp.soldPrice > 0 && comp.similarity >= 60)
    .sort((a, b) => b.similarity - a.similarity || a.ageDays - b.ageDays);

  const usableCandidates = scoredComps.filter((comp) => comp.similarity >= 75);
  const outlierResult = detectOutliers(usableCandidates.length ? usableCandidates : scoredComps);
  const usableComps = outlierResult.kept.filter((comp) => comp.similarity >= 75);
  const selectedComps = (usableComps.length ? usableComps : outlierResult.kept).slice(0, 12);
  const strongCompCount = selectedComps.filter((comp) => comp.similarity >= 90).length;
  const compCount = selectedComps.length;
  const usableCompCount = usableComps.length;

  const averageSimilarity = compCount
    ? selectedComps.reduce((sum, comp) => sum + comp.similarity, 0) / compCount
    : 0;

  const bestSimilarity = selectedComps.length ? selectedComps[0].similarity : 0;
  const averageAgeDays = compCount
    ? selectedComps.reduce((sum, comp) => sum + comp.ageDays, 0) / compCount
    : 0;

  let marketValue = getWeightedAverage(selectedComps);
  let source = 'comp_engine';
  let method = 'recency_similarity_weighted_sold_comps';

  const weightedCompCount = Number(getWeightedCompCount(selectedComps).toFixed(2));
  let pricingSpread = getPricingSpread(selectedComps, marketValue);
  let volatilityScore = getVolatilityScore(pricingSpread);
  let marketConsistency = getMarketConsistency(pricingSpread);
  let confidence = getConfidence(selectedComps, strongCompCount, averageSimilarity, pricingSpread, false);

  if (!usableComps.length) warnings.push('No usable comps met the 75 similarity threshold.');
  if (outlierResult.ignored.length) warnings.push(`${outlierResult.ignored.length} pricing outlier${outlierResult.ignored.length === 1 ? '' : 's'} ignored.`);

  if (!selectedComps.length) {
    const fallbackResult = runFallbackEstimator(listing, options);

    if (fallbackResult) {
      marketValue = fallbackResult.marketValue;
      source = 'heuristic_fallback';
      method = 'fallback_estimator';
      confidence = getConfidence([], 0, 0, 0, true);
      pricingSpread = 0;
      volatilityScore = 25;
      marketConsistency = 'unknown';
      warnings.push('Using heuristic fallback because no usable sold comps were available.');
    } else {
      marketValue = 0;
      confidence = 0;
      warnings.push('No usable comps or fallback estimate were available.');
    }
  }

  if (strongCompCount > 0) positives.push(`${strongCompCount} strong comp${strongCompCount === 1 ? '' : 's'} found.`);
  if (usableCompCount > 0) positives.push(`${usableCompCount} usable comp${usableCompCount === 1 ? '' : 's'} selected.`);
  if (averageAgeDays > 0 && averageAgeDays <= 60) positives.push('Selected comps are recent.');
  if (marketConsistency === 'tight_market') positives.push('Market spread is tight.');
  if (marketConsistency === 'volatile_market') warnings.push('Market spread is volatile.');
  if (selectedComps.some((comp) => comp.saleType === 'best_offer')) warnings.push('Best Offer comps were discounted for confidence.');

  const result = {
    compCount,
    strongCompCount,
    averageSimilarity: Number(averageSimilarity.toFixed(1)),
    bestSimilarity,
    marketValue: Number(marketValue.toFixed(2)),
    confidence,
    source,
    method,
    warnings: uniqueMessages(warnings),
    positives: uniqueMessages(positives),
    selectedComps: selectedComps.map((comp) => ({
      title: comp.title || comp.name || '',
      soldPrice: comp.soldPrice,
      similarity: comp.similarity,
      similarityDetails: comp.similarityDetails || [],
      source: comp.source || comp.marketplace || comp.platform || '',
      ageDays: comp.ageDays,
      saleType: comp.saleType,
      recencyWeight: comp.recencyWeight,
      saleTypeWeight: comp.saleTypeWeight
    })),
    averageAgeDays: Number(averageAgeDays.toFixed(1)),
    weightedCompCount,
    pricingSpread: Number(pricingSpread.toFixed(3)),
    volatilityScore,
    marketConsistency,
    usableCompCount,
    ignoredOutliers: outlierResult.ignored.map((comp) => ({
      title: comp.title || comp.name || '',
      soldPrice: comp.soldPrice,
      similarity: comp.similarity,
      outlierReason: comp.outlierReason || 'price_outlier'
    })),
    summary: ''
  };

  result.summary = summarizeComps(result);
  return result;
}

module.exports = {
  evaluateListing,
  summarizeComps
};
