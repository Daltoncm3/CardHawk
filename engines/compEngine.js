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
  return normalize(value)
    .split(' ')
    .filter((token) => token.length > 1);
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
  const title = getTitle(item);

  const explicitYear = pickFirstValue([parsed, item], ['year', 'season'], '');
  if (explicitYear) return String(explicitYear).trim();

  const match = title.match(/\b(19[5-9]\d|20[0-3]\d)\b/);
  return match ? match[1] : '';
}

function extractCardNumber(item = {}) {
  const parsed = getParsed(item);
  const title = getTitle(item);

  const explicitNumber = pickFirstValue(
    [parsed, item],
    ['cardNumber', 'cardNo', 'number', 'card_num'],
    ''
  );

  if (explicitNumber) return normalize(explicitNumber).replace(/^#/, '');

  const match = title.match(/(?:#|card\s*)([a-z]{0,4}\d{1,5}[a-z]{0,4})\b/i);
  return match ? normalize(match[1]) : '';
}

function extractSerialNumbered(item = {}) {
  const parsed = getParsed(item);
  const title = normalize(getTitle(item));

  const explicitSerial = pickFirstValue(
    [parsed, item],
    ['serialNumbered', 'numbered', 'isNumbered'],
    undefined
  );

  if (typeof explicitSerial === 'boolean') return explicitSerial;

  return /\/\d{1,5}\b|\bnumbered\b|\bserial\b|\bssp\b|\bsp\b/.test(title);
}

function extractGrade(item = {}) {
  const parsed = getParsed(item);
  const title = normalize(getTitle(item));

  const explicitGrade = pickFirstValue([parsed, item], ['grade', 'conditionGrade'], '');
  if (explicitGrade) return normalize(explicitGrade).replace(/^grade\s*/, '');

  const match = title.match(/\b(?:psa|bgs|sgc|cgc|csg)\s*(10|9\.5|9|8\.5|8|7\.5|7|6\.5|6|5)\b/i);
  return match ? match[1] : '';
}

function extractGrader(item = {}) {
  const parsed = getParsed(item);
  const title = normalize(getTitle(item));

  const explicitGrader = pickFirstValue(
    [parsed, item],
    ['gradingCompany', 'grader', 'grading', 'slabCompany'],
    ''
  );

  if (explicitGrader) return normalize(explicitGrader);

  if (/\bpsa\b/.test(title)) return 'psa';
  if (/\bbgs\b|\bbeckett\b/.test(title)) return 'bgs';
  if (/\bsgc\b/.test(title)) return 'sgc';
  if (/\bcgc\b|\bcsg\b/.test(title)) return 'cgc';

  return '';
}

function extractSubject(item = {}) {
  const parsed = getParsed(item);

  return normalize(
    pickFirstValue(
      [parsed, item],
      ['player', 'subject', 'playerName', 'character', 'name'],
      ''
    )
  );
}

function extractSport(item = {}) {
  const parsed = getParsed(item);
  const title = normalize(getTitle(item));

  const explicitSport = pickFirstValue(
    [parsed, item],
    ['sport', 'category', 'game', 'franchise'],
    ''
  );

  if (explicitSport) return normalize(explicitSport);

  if (/\bpokemon\b|\bpikachu\b|\bcharizard\b|\bsquirtle\b|\bblastoise\b|\bvenusaur\b/.test(title)) return 'pokemon';
  if (/\bbaseball\b|\bmlb\b/.test(title)) return 'baseball';
  if (/\bbasketball\b|\bnba\b/.test(title)) return 'basketball';
  if (/\bfootball\b|\bnfl\b/.test(title)) return 'football';
  if (/\bhockey\b|\bnhl\b/.test(title)) return 'hockey';
  if (/\bsoccer\b|\bfutbol\b/.test(title)) return 'soccer';

  return '';
}

function extractSetName(item = {}) {
  const parsed = getParsed(item);

  return normalize(
    pickFirstValue(
      [parsed, item],
      ['set', 'cardSet', 'series', 'product', 'brand'],
      ''
    )
  );
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

  const keys = featureKeys[feature] || [];
  const explicitValue = pickFirstValue([parsed, item], keys, undefined);

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
  return pickFirstNumber(
    [comp],
    ['soldPrice', 'salePrice', 'price', 'amount', 'totalPrice', 'value'],
    0
  );
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
    return -Math.round(weight * 0.9);
  }

  return 0;
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
        score -= 18;
        details.push('subject mismatch');
      }
    }
  } else {
    score += Math.round(8 * tokenOverlapScore(listingProfile.title, compProfile.title));
  }

  if (listingProfile.year && compProfile.year) {
    if (listingProfile.year === compProfile.year) {
      score += 10;
      details.push('year matched');
    } else {
      score -= 10;
      details.push('year mismatch');
    }
  }

  if (hasText(listingProfile.sport) && hasText(compProfile.sport)) {
    if (listingProfile.sport === compProfile.sport) {
      score += 8;
      details.push('category matched');
    } else {
      score -= 16;
      details.push('category mismatch');
    }
  }

  if (hasText(listingProfile.setName) && hasText(compProfile.setName)) {
    const setOverlap = tokenOverlapScore(listingProfile.setName, compProfile.setName);
    score += Math.round(12 * setOverlap);
    if (setOverlap >= 0.65) details.push('set matched');
    if (setOverlap < 0.35) {
      score -= 8;
      details.push('set mismatch');
    }
  }

  if (listingProfile.cardNumber && compProfile.cardNumber) {
    if (listingProfile.cardNumber === compProfile.cardNumber) {
      score += 9;
      details.push('card number matched');
    } else {
      score -= 9;
      details.push('card number mismatch');
    }
  }

  score += compareExactFeature(listingProfile.rookie, compProfile.rookie, 7, 'rookie/RC', details);
  score += compareExactFeature(listingProfile.autograph, compProfile.autograph, 9, 'autograph', details);
  score += compareExactFeature(listingProfile.patch, compProfile.patch, 7, 'patch/relic', details);
  score += compareExactFeature(listingProfile.refractor, compProfile.refractor, 7, 'parallel/refractor', details);
  score += compareExactFeature(listingProfile.serialNumbered, compProfile.serialNumbered, 6, 'serial-numbered', details);

  if (listingProfile.grader && compProfile.grader) {
    if (listingProfile.grader === compProfile.grader) {
      score += 5;
      details.push('grading company matched');
    } else {
      score -= 7;
      details.push('grading company mismatch');
    }
  }

  if (listingProfile.grade && compProfile.grade) {
    const listingGrade = toNumber(listingProfile.grade, NaN);
    const compGrade = toNumber(compProfile.grade, NaN);

    if (Number.isFinite(listingGrade) && Number.isFinite(compGrade)) {
      const difference = Math.abs(listingGrade - compGrade);
      if (difference === 0) {
        score += 8;
        details.push('grade matched');
      } else if (difference <= 1) {
        score += 3;
        details.push('grade close');
      } else {
        score -= 8;
        details.push('grade mismatch');
      }
    } else if (listingProfile.grade === compProfile.grade) {
      score += 6;
      details.push('grade matched');
    }
  }

  const listingTypeFlags = [listingProfile.sealed, listingProfile.lot, listingProfile.reprint];
  const compTypeFlags = [compProfile.sealed, compProfile.lot, compProfile.reprint];

  if (listingTypeFlags.some(Boolean) !== compTypeFlags.some(Boolean)) {
    score -= 18;
    details.push('product type mismatch');
  }

  if (compProfile.reprint && !listingProfile.reprint) {
    score -= 35;
    details.push('comp appears reprint/custom/digital');
  }

  if (compProfile.sealed !== listingProfile.sealed) {
    score -= 18;
    details.push('sealed/wax mismatch');
  }

  if (compProfile.lot !== listingProfile.lot) {
    score -= 18;
    details.push('lot/single-card mismatch');
  }

  score += Math.round(12 * tokenOverlapScore(listingProfile.title, compProfile.title));

  return {
    similarity: Math.max(0, Math.min(100, Math.round(score))),
    details
  };
}

function getWeightedAverage(comps) {
  const weighted = comps
    .map((comp) => {
      const price = getSoldPrice(comp);
      if (!price || price <= 0) return null;

      const weight = Math.max(1, Math.pow(comp.similarity / 100, 2));
      return {
        price,
        weight
      };
    })
    .filter(Boolean);

  if (!weighted.length) return 0;

  const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0);
  const weightedValue = weighted.reduce((sum, item) => sum + item.price * item.weight, 0);

  return totalWeight > 0 ? weightedValue / totalWeight : 0;
}

function getConfidence(usableComps, strongCompCount, averageSimilarity, fallbackUsed) {
  if (fallbackUsed) return 25;
  if (!usableComps.length) return 0;

  let confidence = 30;

  confidence += Math.min(25, usableComps.length * 4);
  confidence += Math.min(25, strongCompCount * 7);
  confidence += Math.max(0, Math.min(20, (averageSimilarity - 75) * 1.3));

  return Math.max(0, Math.min(100, Math.round(confidence)));
}

function runFallbackEstimator(listing, options) {
  if (!options || typeof options.fallbackEstimator !== 'function') return null;

  try {
    const fallback = options.fallbackEstimator(listing);
    if (!fallback || typeof fallback !== 'object') return null;

    const value = toNumber(
      fallback.marketValue || fallback.value || fallback.estimatedValue,
      0
    );

    if (!value || value <= 0) return null;

    return {
      marketValue: value,
      fallback
    };
  } catch (error) {
    return null;
  }
}

function summarizeComps(data = {}) {
  const source = data.source || 'comp_engine';
  const confidence = toNumber(data.confidence, 0);
  const compCount = toNumber(data.compCount, 0);
  const strongCompCount = toNumber(data.strongCompCount, 0);

  if (source === 'heuristic_fallback') {
    return 'No usable sold comps were found; valuation uses a low-confidence heuristic fallback.';
  }

  if (compCount <= 0) {
    return 'No usable comparable sales were found.';
  }

  if (strongCompCount >= 3 && confidence >= 75) {
    return 'Comparable sales are strong and closely matched to the listing.';
  }

  if (strongCompCount >= 1 && confidence >= 60) {
    return 'Comparable sales are usable, with at least one strong match.';
  }

  return 'Comparable sales are limited or only moderately similar; valuation should be reviewed conservatively.';
}

function evaluateListing(listing = {}, compUniverse = [], options = {}) {
  const warnings = [];
  const positives = [];
  const listingProfile = getComparableProfile(listing);

  const scoredComps = asArray(compUniverse)
    .map((comp) => {
      const comparison = compareSimilarity(listingProfile, getComparableProfile(comp));
      const soldPrice = getSoldPrice(comp);

      return {
        ...comp,
        soldPrice,
        similarity: comparison.similarity,
        similarityDetails: comparison.details
      };
    })
    .filter((comp) => {
      if (!comp.soldPrice || comp.soldPrice <= 0) return false;
      if (comp.similarity < 60) return false;
      return true;
    })
    .sort((a, b) => {
      if (b.similarity !== a.similarity) return b.similarity - a.similarity;
      return b.soldPrice - a.soldPrice;
    });

  const usableComps = scoredComps.filter((comp) => comp.similarity >= 75);
  const strongComps = scoredComps.filter((comp) => comp.similarity >= 90);
  const selectedComps = usableComps.length ? usableComps : scoredComps.slice(0, 5);

  const compCount = selectedComps.length;
  const strongCompCount = strongComps.length;
  const averageSimilarity = compCount
    ? selectedComps.reduce((sum, comp) => sum + comp.similarity, 0) / compCount
    : 0;
  const bestSimilarity = selectedComps.length ? selectedComps[0].similarity : 0;

  let marketValue = getWeightedAverage(selectedComps);
  let source = 'comp_engine';
  let method = 'weighted_similarity_sold_comps';
  let confidence = getConfidence(selectedComps, strongCompCount, averageSimilarity, false);

  if (!usableComps.length) {
    warnings.push('No usable comps met the 75 similarity threshold.');
  }

  if (!selectedComps.length) {
    const fallbackResult = runFallbackEstimator(listing, options);

    if (fallbackResult) {
      marketValue = fallbackResult.marketValue;
      source = 'heuristic_fallback';
      method = 'fallback_estimator';
      confidence = getConfidence([], 0, 0, true);
      warnings.push('Using heuristic fallback because no usable sold comps were available.');
    } else {
      marketValue = 0;
      confidence = 0;
      warnings.push('No usable comps or fallback estimate were available.');
    }
  }

  if (strongCompCount > 0) {
    positives.push(`${strongCompCount} strong comp${strongCompCount === 1 ? '' : 's'} found.`);
  }

  if (compCount > 0) {
    positives.push(`${compCount} usable comp${compCount === 1 ? '' : 's'} selected.`);
  }

  if (averageSimilarity >= 85) {
    positives.push('Selected comps are highly similar on average.');
  } else if (averageSimilarity > 0 && averageSimilarity < 75) {
    warnings.push('Selected comps are below the normal usable similarity threshold.');
  }

  return {
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
      source: comp.source || comp.marketplace || comp.platform || ''
    })),
    summary: ''
  };
}

module.exports = {
  evaluateListing,
  summarizeComps
};
