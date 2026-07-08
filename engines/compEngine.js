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

function extractSerialPrintRun(item = {}) {
  const parsed = getParsed(item);
  const explicitRun = pickFirstNumber(
    [parsed, item],
    ['printRun', 'serialPrintRun', 'numberedTo', 'serialNumberTotal'],
    0
  );

  if (explicitRun > 0) return explicitRun;

  const title = getTitle(item);
  const match = title.match(/(?:^|\s|#)\d{1,5}\s*\/\s*(\d{1,5})(?:\s|$)/);
  return match ? toNumber(match[1], 0) : 0;
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
    'cosmic', 'zebra', 'tiger', 'checkerboard', 'wave', 'scope', 'disco',
    'sapphire', 'atomic', 'xfractor', 'x-fractor', 'superfractor', 'shimmer',
    'velocity', 'laser', 'hyper', 'ice', 'negative', 'sepia', 'aqua', 'teal',
    'lime', 'bronze', 'purple shock', 'orange ice'
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
  if (feature === 'refractor') return /\brefractor\b|\bparallel\b|\bprizm\b|\bholo\b|\bfoil\b|\bchrome\b|\bsilver\b|\bgold\b|\bcracked ice\b|\bmojo\b|\bsapphire\b|\bsuperfractor\b|\bshimmer\b/.test(title);
  if (feature === 'sealed') return /\bsealed\b|\bwax\b|\bbox\b|\bpack\b|\bcase\b|\bbooster\b/.test(title);
  if (feature === 'lot') return /\blot\b|\bbulk\b|\bcollection\b|\b\d+\s*cards\b/.test(title);
  if (feature === 'reprint') return /\breprint\b|\bproxy\b|\bcustom\b|\bdigital\b|\bfacsimile\b|\bnovelty\b/.test(title);

  return false;
}

function getSoldPrice(comp = {}) {
  return pickFirstNumber([comp], ['soldPrice', 'salePrice', 'price', 'amount', 'totalPrice', 'value'], 0);
}

function hasSoldDateSignal(comp = {}) {
  return Boolean(pickFirstValue([comp], ['soldAt', 'dateSold', 'soldDate', 'saleDate', 'completedAt'], ''));
}

function hasSoldTextSignal(comp = {}) {
  const text = normalize(
    [
      comp.status,
      comp.listingStatus,
      comp.source,
      comp.type,
      comp.recordType,
      comp.marketState,
      comp.saleStatus
    ].filter(Boolean).join(' ')
  );

  return /\b(sold|completed|ended)\b/.test(text);
}

function hasActiveTextSignal(comp = {}) {
  const text = normalize(
    [
      comp.status,
      comp.listingStatus,
      comp.source,
      comp.type,
      comp.recordType,
      comp.marketState,
      comp.saleStatus
    ].filter(Boolean).join(' ')
  );

  return /\b(active|live|listed|available|current|open)\b/.test(text);
}

function classifyEvidenceType(comp = {}) {
  if (
    comp.sold === true ||
    comp.isSold === true ||
    comp.completed === true ||
    comp.isCompleted === true ||
    hasSoldDateSignal(comp) ||
    hasSoldTextSignal(comp)
  ) {
    return 'true_sold';
  }

  if (
    comp.active === true ||
    comp.isActive === true ||
    hasActiveTextSignal(comp) ||
    Array.isArray(comp.buyingOptions) ||
    comp.itemWebUrl ||
    comp.url
  ) {
    return 'active';
  }

  return 'fallback_unknown';
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

function isRawProfile(profile = {}) {
  return profile.grader === 'raw' || profile.grade === 'raw' || profile.grade === 'nm' || profile.grade === 'lp' || profile.grade === 'mp' || profile.grade === 'hp' || profile.grade === 'damaged' || profile.grade === 'dmg';
}

function isGradedProfile(profile = {}) {
  if (!profile.grader || profile.grader === 'raw') return false;
  return profile.grader === 'psa' || profile.grader === 'bgs' || profile.grader === 'sgc' || profile.grader === 'cgc';
}

function isParallelProfile(profile = {}) {
  return Boolean(profile.refractor || profile.variation || profile.serialNumbered);
}

function normalizeGradeValue(profile = {}) {
  if (profile.grade === 'black_label') return 10.2;
  if (profile.grade === 'pristine') return profile.grader === 'bgs' ? 10.1 : 10;
  return toNumber(profile.grade, NaN);
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
    serialPrintRun: extractSerialPrintRun(item),
    variation: extractVariation(item),
    grader: extractGrader(item),
    grade: extractGrade(item),
    sealed: hasFeature(item, 'sealed'),
    lot: hasFeature(item, 'lot'),
    reprint: hasFeature(item, 'reprint')
  };
}

function applySimilarityCap(currentCap, newCap) {
  return Math.min(currentCap, newCap);
}

function evaluateIdentityGates(listingProfile, compProfile) {
  let cap = 100;
  const reasons = [];
  const fatal = [];

  if (listingProfile.reprint !== compProfile.reprint) {
    cap = applySimilarityCap(cap, 20);
    fatal.push('original/reprint-custom-digital mismatch');
  }

  if (listingProfile.lot !== compProfile.lot) {
    cap = applySimilarityCap(cap, 45);
    fatal.push('single-card/lot mismatch');
  }

  if (listingProfile.cardNumber && compProfile.cardNumber && listingProfile.cardNumber !== compProfile.cardNumber) {
    cap = applySimilarityCap(cap, 45);
    fatal.push('card number mismatch');
  }

  const listingRaw = isRawProfile(listingProfile);
  const compRaw = isRawProfile(compProfile);
  const listingGraded = isGradedProfile(listingProfile);
  const compGraded = isGradedProfile(compProfile);

  if ((listingRaw && compGraded) || (listingGraded && compRaw)) {
    cap = applySimilarityCap(cap, 45);
    fatal.push('raw/slabbed mismatch');
  }

  if (listingProfile.autograph !== compProfile.autograph) {
    cap = applySimilarityCap(cap, 55);
    fatal.push('autograph mismatch');
  }

  if (listingProfile.serialNumbered !== compProfile.serialNumbered) {
    cap = applySimilarityCap(cap, 55);
    fatal.push('numbered/unnumbered mismatch');
  }

  const listingParallel = isParallelProfile(listingProfile);
  const compParallel = isParallelProfile(compProfile);

  if (listingParallel !== compParallel) {
    cap = applySimilarityCap(cap, 58);
    reasons.push('base/parallel mismatch');
  }

  if (listingProfile.variation && compProfile.variation) {
    const overlap = tokenOverlapScore(listingProfile.variation, compProfile.variation);
    if (overlap < 0.35) {
      cap = applySimilarityCap(cap, 62);
      reasons.push('parallel/variation mismatch');
    }
  } else if (listingProfile.variation || compProfile.variation) {
    cap = applySimilarityCap(cap, 64);
    reasons.push('parallel/variation missing on one side');
  }

  if (listingProfile.serialPrintRun > 0 && compProfile.serialPrintRun > 0) {
    const lowRun = Math.min(listingProfile.serialPrintRun, compProfile.serialPrintRun);
    const highRun = Math.max(listingProfile.serialPrintRun, compProfile.serialPrintRun);
    const runRatio = highRun / lowRun;

    if (runRatio >= 5) {
      cap = applySimilarityCap(cap, 52);
      fatal.push(`serial print-run mismatch /${listingProfile.serialPrintRun} vs /${compProfile.serialPrintRun}`);
    } else if (runRatio >= 2) {
      cap = applySimilarityCap(cap, 65);
      reasons.push(`serial print-run differs /${listingProfile.serialPrintRun} vs /${compProfile.serialPrintRun}`);
    } else if (listingProfile.serialPrintRun !== compProfile.serialPrintRun) {
      cap = applySimilarityCap(cap, 78);
      reasons.push(`serial print-run slightly differs /${listingProfile.serialPrintRun} vs /${compProfile.serialPrintRun}`);
    }
  }

  if (listingGraded && compGraded && listingProfile.grader !== compProfile.grader) {
    cap = applySimilarityCap(cap, 82);
    reasons.push('grading company mismatch');
  }

  if (listingGraded && compGraded && listingProfile.grade && compProfile.grade) {
    if (listingProfile.grader === 'bgs' || compProfile.grader === 'bgs') {
      if (listingProfile.grade !== compProfile.grade) {
        if (listingProfile.grade === 'black_label' || compProfile.grade === 'black_label') {
          cap = applySimilarityCap(cap, 62);
          reasons.push('BGS Black Label mismatch');
        } else if (listingProfile.grade === 'pristine' || compProfile.grade === 'pristine') {
          cap = applySimilarityCap(cap, 68);
          reasons.push('BGS pristine grade mismatch');
        } else if (
          (listingProfile.grade === '10' && compProfile.grade === '9.5') ||
          (listingProfile.grade === '9.5' && compProfile.grade === '10')
        ) {
          cap = applySimilarityCap(cap, 72);
          reasons.push('BGS 10/BGS 9.5 mismatch');
        }
      }
    }

    const listingGradeValue = normalizeGradeValue(listingProfile);
    const compGradeValue = normalizeGradeValue(compProfile);

    if (Number.isFinite(listingGradeValue) && Number.isFinite(compGradeValue)) {
      const gradeDifference = Math.abs(listingGradeValue - compGradeValue);

      if (gradeDifference >= 1) {
        cap = applySimilarityCap(cap, 68);
        reasons.push('graded-card numeric grade mismatch');
      }

      if (
        listingProfile.grader === 'psa' &&
        compProfile.grader === 'psa' &&
        ((listingProfile.grade === '10' && compProfile.grade === '9') ||
          (listingProfile.grade === '9' && compProfile.grade === '10'))
      ) {
        cap = applySimilarityCap(cap, 62);
        reasons.push('PSA 10/PSA 9 mismatch');
      }
    }
  }

  return {
    cap,
    fatal,
    reasons,
    applied: cap < 100 || fatal.length > 0 || reasons.length > 0
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

function gradePenalty(listingProfile, compProfile, details) {
  const listingGrade = listingProfile.grade;
  const compGrade = compProfile.grade;

  if (!listingGrade || !compGrade) return 0;

  if (listingGrade === compGrade && listingProfile.grader === compProfile.grader) {
    details.push('grade and grader matched');
    return 12;
  }

  if (listingGrade === compGrade) {
    details.push('grade matched');
    return 7;
  }

  if (isRawProfile(listingProfile) || isRawProfile(compProfile)) {
    details.push('raw/slab grade mismatch');
    return -28;
  }

  const weakGrades = ['lp', 'mp', 'hp', 'damaged', 'dmg'];
  if (weakGrades.includes(listingGrade) || weakGrades.includes(compGrade)) {
    details.push('condition quality mismatch');
    return -22;
  }

  if (listingProfile.grader === 'bgs' || compProfile.grader === 'bgs') {
    if (listingGrade === 'black_label' || compGrade === 'black_label') {
      details.push('BGS Black Label mismatch');
      return -24;
    }

    if (listingGrade === 'pristine' || compGrade === 'pristine') {
      details.push('BGS pristine mismatch');
      return -18;
    }

    if (
      (listingGrade === '10' && compGrade === '9.5') ||
      (listingGrade === '9.5' && compGrade === '10')
    ) {
      details.push('BGS 10/BGS 9.5 mismatch');
      return -15;
    }
  }

  const listingNumeric = normalizeGradeValue(listingProfile);
  const compNumeric = normalizeGradeValue(compProfile);

  if (Number.isFinite(listingNumeric) && Number.isFinite(compNumeric)) {
    const difference = Math.abs(listingNumeric - compNumeric);

    if (
      listingProfile.grader === 'psa' &&
      compProfile.grader === 'psa' &&
      ((listingGrade === '10' && compGrade === '9') || (listingGrade === '9' && compGrade === '10'))
    ) {
      details.push('PSA 10/PSA 9 mismatch');
      return -22;
    }

    if (difference <= 0.5) {
      details.push('grade close');
      return 2;
    }

    if (difference <= 1) {
      details.push('grade differs by one point');
      return -10;
    }

    details.push('grade mismatch');
    return -18;
  }

  return -8;
}

function compareSimilarity(listingProfile, compProfile) {
  let score = 0;
  const details = [];
  const gate = evaluateIdentityGates(listingProfile, compProfile);

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
    else {
      score -= 11;
      details.push('year mismatch');
    }
  }

  if (listingProfile.sport && compProfile.sport) {
    if (listingProfile.sport === compProfile.sport) score += 8;
    else {
      score -= 18;
      details.push('category mismatch');
    }
  }

  if (listingProfile.setName && compProfile.setName) {
    const setOverlap = tokenOverlapScore(listingProfile.setName, compProfile.setName);
    score += Math.round(14 * setOverlap);
    if (setOverlap < 0.35) {
      score -= 9;
      details.push('set mismatch');
    }
  }

  if (listingProfile.cardNumber && compProfile.cardNumber) {
    if (listingProfile.cardNumber === compProfile.cardNumber) {
      score += 10;
      details.push('card number matched');
    } else {
      score -= 24;
      details.push('card number mismatch');
    }
  }

  score += compareExactFeature(listingProfile.rookie, compProfile.rookie, 8, 'rookie/RC', details);
  score += compareExactFeature(listingProfile.autograph, compProfile.autograph, 16, 'autograph', details);
  score += compareExactFeature(listingProfile.patch, compProfile.patch, 8, 'patch/relic', details);
  score += compareExactFeature(listingProfile.refractor, compProfile.refractor, 10, 'refractor/prizm/chrome', details);
  score += compareExactFeature(listingProfile.serialNumbered, compProfile.serialNumbered, 12, 'serial-numbered', details);

  if (listingProfile.variation && compProfile.variation) {
    const variationOverlap = tokenOverlapScore(listingProfile.variation, compProfile.variation);
    score += Math.round(10 * variationOverlap);
    if (variationOverlap < 0.35) {
      score -= 12;
      details.push('parallel/variation mismatch');
    } else {
      details.push('parallel/variation matched');
    }
  } else if (listingProfile.variation || compProfile.variation) {
    score -= 10;
    details.push('parallel/variation missing on one side');
  }

  if (listingProfile.serialPrintRun > 0 && compProfile.serialPrintRun > 0) {
    if (listingProfile.serialPrintRun === compProfile.serialPrintRun) {
      score += 8;
      details.push('serial print-run matched');
    } else {
      const lowRun = Math.min(listingProfile.serialPrintRun, compProfile.serialPrintRun);
      const highRun = Math.max(listingProfile.serialPrintRun, compProfile.serialPrintRun);
      const runRatio = highRun / lowRun;
      score -= runRatio >= 5 ? 20 : runRatio >= 2 ? 14 : 7;
      details.push(`serial print-run mismatch /${listingProfile.serialPrintRun} vs /${compProfile.serialPrintRun}`);
    }
  }

  if (listingProfile.grader && compProfile.grader) {
    if (listingProfile.grader === compProfile.grader) {
      score += 8;
      details.push('grading company matched');
    } else {
      score -= 12;
      details.push('grading company mismatch');
    }
  }

  score += gradePenalty(listingProfile, compProfile, details);

  if (listingProfile.reprint !== compProfile.reprint) {
    score -= 45;
    details.push('original/reprint-custom-digital mismatch');
  }

  if (listingProfile.sealed !== compProfile.sealed) {
    score -= 20;
    details.push('sealed/wax mismatch');
  }

  if (listingProfile.lot !== compProfile.lot) {
    score -= 28;
    details.push('single-card/lot mismatch');
  }

  score += Math.round(10 * tokenOverlapScore(listingProfile.title, compProfile.title));

  let similarity = Math.max(0, Math.min(100, Math.round(score)));

  if (gate.cap < 100) {
    similarity = Math.min(similarity, gate.cap);
    details.push(`similarity capped at ${gate.cap}: ${uniqueMessages([...gate.fatal, ...gate.reasons]).join('; ')}`);
  }

  return {
    similarity,
    details: uniqueMessages(details),
    identityCaps: uniqueMessages(gate.reasons),
    fatalMismatches: uniqueMessages(gate.fatal),
    similarityCap: gate.cap,
    rejectedByIdentityGate: similarity < 60 && gate.applied
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

function getCompWeight(comp = {}) {
  if (!comp.soldPrice || comp.soldPrice <= 0) return 0;

  const similarityWeight = Math.max(0.15, Math.pow(comp.similarity / 100, 2.35));
  const recencyWeight = getRecencyWeight(comp.ageDays);
  const saleTypeWeight = getSaleTypeWeight(comp.saleType);
  const capPenalty = comp.similarityCap && comp.similarityCap < 75 ? 0.55 : 1;

  return similarityWeight * recencyWeight * saleTypeWeight * capPenalty;
}

function getWeightedAverage(comps) {
  const weighted = comps
    .map((comp) => {
      const weight = getCompWeight(comp);
      if (!weight) return null;

      return { price: comp.soldPrice, weight };
    })
    .filter(Boolean);

  if (!weighted.length) return 0;

  const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0);
  const weightedValue = weighted.reduce((sum, item) => sum + item.price * item.weight, 0);

  return totalWeight > 0 ? weightedValue / totalWeight : 0;
}

function getWeightedCompCount(comps) {
  return comps.reduce((sum, comp) => sum + getCompWeight(comp), 0);
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
  const cappedCount = usableComps.filter((comp) => comp.similarityCap && comp.similarityCap < 100).length;

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
  confidence -= Math.min(16, cappedCount * 4);

  if (usableComps.length < 3) {
    confidence = Math.min(confidence, usableComps.length === 1 ? 38 : 48);
  }

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

function getCompStatus(comp = {}) {
  if (comp.rejectedByIdentityGate || comp.similarity < 60) return 'rejected';
  if (comp.similarityCap && comp.similarityCap < 100) return 'capped';
  if (comp.similarity >= 90) return 'strong';
  if (comp.similarity >= 75) return 'usable';
  return 'directional';
}

function getAcceptedReason(comp = {}) {
  const status = getCompStatus(comp);

  if (status === 'strong') return 'Strong comp: high similarity with no major identity cap.';
  if (status === 'usable') return 'Usable comp: meets similarity threshold for valuation support.';
  if (status === 'capped') return 'Capped comp: directionally useful but identity mismatch limits trust.';
  if (status === 'directional') return 'Directional comp: below usable threshold, included only because stronger comps were unavailable.';
  return 'Rejected comp: identity mismatch or similarity below minimum threshold.';
}

function getCapReasons(comp = {}) {
  return uniqueMessages([...(comp.fatalMismatches || []), ...(comp.identityCaps || [])]);
}

function addContributionMetadata(comps, marketValue) {
  const weighted = comps.map((comp) => ({
    comp,
    weight: getCompWeight(comp)
  }));

  const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0);

  return weighted.map((item) => {
    const contributionWeight = totalWeight > 0 ? item.weight / totalWeight : 0;
    const valueContribution = marketValue > 0 ? item.comp.soldPrice * contributionWeight : 0;

    return {
      ...item.comp,
      contributionWeight: Number(contributionWeight.toFixed(4)),
      valueContribution: Number(valueContribution.toFixed(2))
    };
  });
}

function evaluateListing(listing = {}, compUniverse = [], options = {}) {
  const warnings = [];
  const positives = [];
  const listingProfile = getComparableProfile(listing);

  const allScoredComps = asArray(compUniverse)
    .map((comp) => {
      const comparison = compareSimilarity(listingProfile, getComparableProfile(comp));
      const soldPrice = getSoldPrice(comp);
      const ageDays = getAgeDays(comp);
      const saleType = getSaleType(comp);
      const evidenceType = classifyEvidenceType(comp);

      return {
        ...comp,
        soldPrice,
        ageDays,
        saleType,
        evidenceType,
        recencyWeight: Number(getRecencyWeight(ageDays).toFixed(3)),
        saleTypeWeight: getSaleTypeWeight(saleType),
        similarity: comparison.similarity,
        similarityDetails: comparison.details,
        similarityCap: comparison.similarityCap,
        identityCaps: comparison.identityCaps,
        fatalMismatches: comparison.fatalMismatches,
        rejectedByIdentityGate: comparison.rejectedByIdentityGate
      };
    });

  const rejectedByIdentity = allScoredComps.filter((comp) => comp.soldPrice > 0 && comp.rejectedByIdentityGate);
  const cappedComps = allScoredComps.filter((comp) => comp.soldPrice > 0 && comp.similarityCap && comp.similarityCap < 100 && !comp.rejectedByIdentityGate);

  const scoredComps = allScoredComps
    .filter((comp) => comp.soldPrice > 0 && comp.similarity >= 60)
    .sort((a, b) => b.similarity - a.similarity || a.ageDays - b.ageDays);

  const usableCandidates = scoredComps.filter((comp) => comp.similarity >= 75);
  const outlierResult = detectOutliers(usableCandidates.length ? usableCandidates : scoredComps);
  const usableComps = outlierResult.kept.filter((comp) => comp.similarity >= 75);
  let selectedComps = (usableComps.length ? usableComps : outlierResult.kept).slice(0, 12);
  const strongCompCount = selectedComps.filter((comp) => comp.similarity >= 90).length;
  const compCount = selectedComps.length;
  const trueSoldCompCount = selectedComps.filter((comp) => comp.evidenceType === 'true_sold').length;
  const activeCompCount = selectedComps.filter((comp) => comp.evidenceType === 'active').length;
  const fallbackUnknownCompCount = selectedComps.filter((comp) => comp.evidenceType === 'fallback_unknown').length;
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

  let weightedCompCount = Number(getWeightedCompCount(selectedComps).toFixed(2));
  let pricingSpread = getPricingSpread(selectedComps, marketValue);
  let volatilityScore = getVolatilityScore(pricingSpread);
  let marketConsistency = getMarketConsistency(pricingSpread);
  let confidence = getConfidence(selectedComps, strongCompCount, averageSimilarity, pricingSpread, false);

  if (!usableComps.length) warnings.push('No usable comps met the 75 similarity threshold.');
  if (usableCompCount < 3 && usableCompCount > 0) warnings.push(`Thin comp market: only ${usableCompCount} usable comp${usableCompCount === 1 ? '' : 's'} support this value.`);
  if (activeCompCount > 0) warnings.push(`${activeCompCount} active comp${activeCompCount === 1 ? '' : 's'} preserved for valuation context, not sold support.`);
  if (fallbackUnknownCompCount > 0) warnings.push(`${fallbackUnknownCompCount} comp${fallbackUnknownCompCount === 1 ? '' : 's'} had unknown evidence type and do not count as sold support.`);
  if (selectedComps.length > 0 && selectedComps.length < 3) warnings.push(`Valuation is driven by only ${selectedComps.length} selected comp${selectedComps.length === 1 ? '' : 's'}.`);
  if (selectedComps.length < 3 && pricingSpread > 0.65) warnings.push('Selected comps are thin and pricing spread is high; valuation confidence is conservative.');
  if (outlierResult.ignored.length) warnings.push(`${outlierResult.ignored.length} pricing outlier${outlierResult.ignored.length === 1 ? '' : 's'} ignored.`);
  if (rejectedByIdentity.length) warnings.push(`${rejectedByIdentity.length} comp${rejectedByIdentity.length === 1 ? '' : 's'} rejected by identity mismatch gates.`);
  if (cappedComps.length) warnings.push(`${cappedComps.length} comp${cappedComps.length === 1 ? '' : 's'} similarity-capped for identity mismatch risk.`);

  if (!selectedComps.length) {
    const fallbackResult = runFallbackEstimator(listing, options);

    if (fallbackResult) {
      marketValue = fallbackResult.marketValue;
      source = 'heuristic_fallback';
      method = 'fallback_estimator';
      confidence = getConfidence([], 0, 0, 0, true);
      weightedCompCount = 0;
      pricingSpread = 0;
      volatilityScore = 25;
      marketConsistency = 'unknown';
      warnings.push('Using heuristic fallback because no usable sold comps were available.');
    } else {
      marketValue = 0;
      confidence = 0;
      weightedCompCount = 0;
      warnings.push('No usable comps or fallback estimate were available.');
    }
  }

  selectedComps = addContributionMetadata(selectedComps, marketValue);

  if (strongCompCount > 0) positives.push(`${strongCompCount} strong comp${strongCompCount === 1 ? '' : 's'} found.`);
  if (usableCompCount > 0) positives.push(`${usableCompCount} usable comp${usableCompCount === 1 ? '' : 's'} selected.`);
  if (averageAgeDays > 0 && averageAgeDays <= 60) positives.push('Selected comps are recent.');
  if (marketConsistency === 'tight_market') positives.push('Market spread is tight.');
  if (marketConsistency === 'volatile_market') warnings.push('Market spread is volatile.');
  if (selectedComps.some((comp) => comp.saleType === 'best_offer')) warnings.push('Best Offer comps were discounted for confidence.');

  const result = {
    compCount,
    trueSoldCompCount,
    soldCompCount: trueSoldCompCount,
    activeCompCount,
    fallbackUnknownCompCount,
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
      evidenceType: comp.evidenceType,
      ageDays: comp.ageDays,
      saleType: comp.saleType,
      recencyWeight: comp.recencyWeight,
      saleTypeWeight: comp.saleTypeWeight,
      similarityCap: comp.similarityCap,
      identityCaps: comp.identityCaps || [],
      fatalMismatches: comp.fatalMismatches || [],
      compStatus: getCompStatus(comp),
      acceptedReason: getAcceptedReason(comp),
      capReasons: getCapReasons(comp),
      contributionWeight: comp.contributionWeight,
      valueContribution: comp.valueContribution
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
      outlierReason: comp.outlierReason || 'price_outlier',
      similarityCap: comp.similarityCap,
      identityCaps: comp.identityCaps || [],
      fatalMismatches: comp.fatalMismatches || [],
      compStatus: 'outlier',
      rejectionReasons: uniqueMessages([comp.outlierReason || 'price_outlier', ...(comp.fatalMismatches || []), ...(comp.identityCaps || [])])
    })),
    rejectedComps: rejectedByIdentity.slice(0, 20).map((comp) => ({
      title: comp.title || comp.name || '',
      soldPrice: comp.soldPrice,
      similarity: comp.similarity,
      rejectionReasons: uniqueMessages([...(comp.fatalMismatches || []), ...(comp.identityCaps || [])]),
      similarityDetails: comp.similarityDetails || [],
      compStatus: 'rejected'
    })),
    cappedCompCount: cappedComps.length,
    rejectedCompCount: rejectedByIdentity.length,
    summary: ''
  };

  result.summary = summarizeComps(result);
  return result;
}

module.exports = {
  evaluateListing,
  summarizeComps
};
