// engines/populationEngine.js
// CardHawk Population Engine v1
// Estimates card population/rarity now; designed to support PSA/BGS/SGC live population sources later.

const DEFAULT_TTL_MS = 1000 * 60 * 60 * 24; // 24 hours
const cache = new Map();

function toText(value) {
  return String(value || "").toLowerCase();
}

function clamp(value, min = 0, max = 100) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}

function getTitle(card = {}) {
  return String(card.title || card.name || card.query || "");
}

function buildPopulationKey(card = {}) {
  const title = getTitle(card)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, "-");

  const lane = String(card.lane || card.sport || "unknown").toLowerCase();
  const grade = card.parsed?.grade || card.grade || "raw";
  const number = card.parsed?.numberedTo || card.numberedTo || "na";

  return `${lane}:${grade}:${number}:${title}`;
}

function parseNumberedTo(card = {}) {
  const parsed = card.parsed || {};
  if (Number.isFinite(Number(parsed.numberedTo))) return Number(parsed.numberedTo);
  if (Number.isFinite(Number(card.numberedTo))) return Number(card.numberedTo);

  const title = getTitle(card);
  const match = title.match(/\/(\d{1,5})(?!\d)/);
  if (!match) return null;

  const numberedTo = Number(match[1]);
  return Number.isFinite(numberedTo) ? numberedTo : null;
}

function detectGrade(card = {}) {
  const title = toText(getTitle(card));
  const parsed = card.parsed || {};
  const gradeCompany = toText(parsed.gradeCompany || card.gradeCompany);
  const gradeValue = Number(parsed.grade || card.grade || 0);

  if (gradeCompany.includes("psa") || /\bpsa\s*10\b/.test(title)) {
    return { company: "PSA", grade: gradeValue || (title.includes("psa 10") ? 10 : null) };
  }
  if (gradeCompany.includes("bgs") || /\bbgs\s*(9\.5|10)\b/.test(title)) {
    return { company: "BGS", grade: gradeValue || null };
  }
  if (gradeCompany.includes("sgc") || /\bsgc\s*(9\.5|10)\b/.test(title)) {
    return { company: "SGC", grade: gradeValue || null };
  }
  if (/\braw\b/.test(title) || title.includes("ungraded")) {
    return { company: "RAW", grade: null };
  }

  return { company: parsed.graded ? "GRADED" : "UNKNOWN", grade: gradeValue || null };
}

function detectTraits(card = {}) {
  const title = toText(getTitle(card));
  const parsed = card.parsed || {};
  const numberedTo = parseNumberedTo(card);
  const grade = detectGrade(card);

  return {
    numberedTo,
    grade,
    isLowNumbered: Number.isFinite(numberedTo) && numberedTo <= 25,
    isVeryLowNumbered: Number.isFinite(numberedTo) && numberedTo <= 10,
    isOneOfOne: Number.isFinite(numberedTo) && numberedTo === 1 || /\b1\/1\b|one of one/.test(title),
    isRookie: Boolean(parsed.rookie) || /\brc\b|rookie/.test(title),
    isAuto: Boolean(parsed.autograph) || /\bauto\b|autograph|signature/.test(title),
    isFirstBowman: Boolean(parsed.firstBowman) || /1st bowman|first bowman/.test(title),
    isRefractor: Boolean(parsed.refractor) || /refractor|prizm|holo|silver|optic|chrome/.test(title),
    isPremiumBrand: /bowman chrome|topps chrome|national treasures|flawless|immaculate|prizm|optic|select|contenders optic|sapphire/.test(title),
    isRaw: grade.company === "RAW" || title.includes("raw") || title.includes("ungraded"),
    isPSA10: grade.company === "PSA" && grade.grade === 10 || /\bpsa\s*10\b/.test(title),
  };
}

function estimatePopulation(card = {}) {
  const traits = detectTraits(card);
  let estimate = 750;
  let confidence = 55;
  const reasons = [];

  if (traits.isOneOfOne) {
    estimate = 1;
    confidence = 98;
    reasons.push("One-of-one card detected");
  } else if (traits.numberedTo) {
    // Graded population cannot exceed print run, but raw copies plus grading choices make this an estimate.
    estimate = traits.numberedTo;
    confidence = traits.numberedTo <= 25 ? 82 : 72;
    reasons.push(`Serial numbered /${traits.numberedTo}`);
  }

  if (traits.isPSA10) {
    estimate = Math.max(1, Math.round(estimate * 0.55));
    confidence += 8;
    reasons.push("PSA 10 narrows population");
  }

  if (traits.isAuto) {
    estimate = Math.max(1, Math.round(estimate * 0.65));
    confidence += 6;
    reasons.push("Autograph card narrows market supply");
  }

  if (traits.isFirstBowman) {
    estimate = Math.max(1, Math.round(estimate * 0.75));
    confidence += 4;
    reasons.push("1st Bowman demand trait detected");
  }

  if (traits.isRookie) {
    estimate = Math.max(1, Math.round(estimate * 0.9));
    confidence += 3;
    reasons.push("Rookie/RC trait detected");
  }

  if (traits.isRaw) {
    estimate = Math.max(50, Math.round(estimate * 1.8));
    confidence -= 12;
    reasons.push("Raw/ungraded card makes population less certain");
  }

  if (!traits.numberedTo && !traits.isOneOfOne) {
    reasons.push("No exact population source yet; using CardHawk estimate");
  }

  const rarity = getRarityTier(estimate);

  return {
    source: "estimate",
    population: estimate,
    confidence: clamp(confidence, 20, 95),
    rarity,
    scoreBonus: scorePopulation({ population: estimate, confidence }),
    traits,
    reasons,
    cachedAt: new Date().toISOString(),
  };
}

function getRarityTier(population) {
  const pop = Number(population);
  if (!Number.isFinite(pop)) return "Unknown";
  if (pop <= 1) return "One of One";
  if (pop <= 10) return "Extremely Rare";
  if (pop <= 25) return "Ultra Rare";
  if (pop <= 50) return "Very Rare";
  if (pop <= 100) return "Rare";
  if (pop <= 250) return "Limited";
  if (pop <= 750) return "Moderate";
  return "Common";
}

function scorePopulation(input = {}) {
  const population = Number(input.population);
  const confidence = Number(input.confidence || 50);
  if (!Number.isFinite(population)) return 0;

  let bonus = 0;
  if (population <= 1) bonus = 40;
  else if (population <= 10) bonus = 32;
  else if (population <= 25) bonus = 25;
  else if (population <= 50) bonus = 18;
  else if (population <= 100) bonus = 12;
  else if (population <= 250) bonus = 7;
  else if (population <= 750) bonus = 3;

  // Lower confidence means we use less of the bonus.
  return Math.round(bonus * clamp(confidence, 0, 100) / 100);
}

function isLowPopulation(population) {
  const pop = typeof population === "object" ? population.population : population;
  return Number(pop) <= 50;
}

function cachePopulation(card, population, ttlMs = DEFAULT_TTL_MS) {
  const key = buildPopulationKey(card);
  cache.set(key, {
    value: population,
    expiresAt: Date.now() + ttlMs,
  });
  return population;
}

function getPopulation(card = {}, options = {}) {
  const key = buildPopulationKey(card);
  const cached = cache.get(key);

  if (!options.forceRefresh && cached && cached.expiresAt > Date.now()) {
    return {
      ...cached.value,
      cacheHit: true,
    };
  }

  const estimated = estimatePopulation(card);
  cachePopulation(card, estimated, options.ttlMs || DEFAULT_TTL_MS);
  return {
    ...estimated,
    cacheHit: false,
  };
}

function clearExpiredCache() {
  const now = Date.now();
  let removed = 0;
  for (const [key, item] of cache.entries()) {
    if (!item || item.expiresAt <= now) {
      cache.delete(key);
      removed += 1;
    }
  }
  return { removed, remaining: cache.size };
}

function summarizePopulation(population = {}) {
  return {
    source: population.source || "unknown",
    population: population.population ?? null,
    rarity: population.rarity || "Unknown",
    confidence: population.confidence || 0,
    scoreBonus: population.scoreBonus || 0,
  };
}

module.exports = {
  getPopulation,
  scorePopulation,
  isLowPopulation,
  estimatePopulation,
  cachePopulation,
  clearExpiredCache,
  summarizePopulation,
  buildPopulationKey,
  detectTraits,
  getRarityTier,
};
