// engines/compEngine.js
// CardHawk Comp Engine v1
// Uses CardHawk's own observed listings/history as market evidence.
// This is intentionally conservative: active listings are asking prices, not sold prices.

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function roundMoney(value) {
  return Math.round(toNumber(value) * 100) / 100;
}

function median(numbers) {
  const clean = numbers.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!clean.length) return 0;
  const middle = Math.floor(clean.length / 2);
  if (clean.length % 2 === 0) return roundMoney((clean[middle - 1] + clean[middle]) / 2);
  return roundMoney(clean[middle]);
}

function average(numbers) {
  const clean = numbers.map(Number).filter(Number.isFinite);
  if (!clean.length) return 0;
  return roundMoney(clean.reduce((sum, value) => sum + value, 0) / clean.length);
}

function normalizeTitle(title) {
  return String(title || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s/.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOP_WORDS = new Set([
  "the", "and", "or", "a", "an", "with", "card", "cards", "sports", "sport",
  "rookie", "rc", "auto", "autograph", "signed", "psa", "sgc", "bgs", "cgc",
  "mint", "gem", "graded", "lot", "read", "rare", "hot", "wow", "🔥", "📈"
]);

function getTitleTokens(title) {
  return normalizeTitle(title)
    .split(" ")
    .map(token => token.trim())
    .filter(token => token.length >= 3)
    .filter(token => !STOP_WORDS.has(token));
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function buildFingerprint(listing = {}) {
  const parsed = listing.parsed || {};
  const flags = parsed.flags || {};
  const title = listing.title || "";

  return {
    lane: listing.lane || null,
    year: parsed.year || null,
    setName: parsed.setName && parsed.setName !== "Unknown" ? parsed.setName : null,
    gradeCompany: parsed.gradeCompany || null,
    grade: parsed.grade || null,
    numberedTo: parsed.numberedTo || null,
    autograph: Boolean(flags.autograph),
    rookie: Boolean(flags.rookie),
    graded: Boolean(flags.graded),
    numbered: Boolean(flags.numbered),
    firstBowman: Boolean(flags.firstBowman),
    refractor: Boolean(flags.refractor),
    pokemon: Boolean(flags.pokemon),
    lot: Boolean(flags.lot),
    sealed: Boolean(flags.sealed),
    reprint: Boolean(flags.reprint),
    digital: Boolean(flags.digital),
    custom: Boolean(flags.custom),
    tokens: unique(getTitleTokens(title))
  };
}

function getListingPrice(listing = {}) {
  const totalCost = toNumber(listing.totalCost, NaN);
  if (Number.isFinite(totalCost) && totalCost > 0) return totalCost;

  const price = toNumber(listing.price, 0);
  const shipping = toNumber(listing.shipping, 0);
  return roundMoney(price + shipping);
}

function hasAvoidFlags(fingerprint) {
  return fingerprint.lot || fingerprint.sealed || fingerprint.reprint || fingerprint.digital || fingerprint.custom;
}

function tokenOverlapScore(aTokens, bTokens) {
  const a = new Set(aTokens || []);
  const b = new Set(bTokens || []);
  if (!a.size || !b.size) return 0;

  let overlap = 0;
  for (const token of a) {
    if (b.has(token)) overlap += 1;
  }

  return overlap / Math.max(a.size, b.size);
}

function similarityScore(target, candidate) {
  if (!target || !candidate) return 0;
  if (hasAvoidFlags(candidate)) return 0;

  let score = 0;

  if (target.lane && candidate.lane && target.lane === candidate.lane) score += 15;
  if (target.year && candidate.year && target.year === candidate.year) score += 10;
  if (target.setName && candidate.setName && target.setName === candidate.setName) score += 15;
  if (target.gradeCompany && candidate.gradeCompany && target.gradeCompany === candidate.gradeCompany) score += 8;
  if (target.grade && candidate.grade && target.grade === candidate.grade) score += 10;
  if (target.numberedTo && candidate.numberedTo && target.numberedTo === candidate.numberedTo) score += 8;

  if (target.autograph === candidate.autograph) score += 8;
  if (target.rookie === candidate.rookie) score += 6;
  if (target.graded === candidate.graded) score += 6;
  if (target.numbered === candidate.numbered) score += 4;
  if (target.firstBowman === candidate.firstBowman) score += 6;
  if (target.refractor === candidate.refractor) score += 4;
  if (target.pokemon === candidate.pokemon) score += 8;

  score += Math.round(tokenOverlapScore(target.tokens, candidate.tokens) * 30);

  if (target.grade && candidate.grade && target.grade !== candidate.grade) score -= 18;
  if (target.gradeCompany && candidate.gradeCompany && target.gradeCompany !== candidate.gradeCompany) score -= 10;
  if (target.setName && candidate.setName && target.setName !== candidate.setName) score -= 12;
  if (target.year && candidate.year && Math.abs(target.year - candidate.year) > 1) score -= 8;
  if (target.autograph !== candidate.autograph) score -= 12;
  if (target.graded !== candidate.graded) score -= 10;
  if (target.rookie !== candidate.rookie) score -= 6;

  return Math.max(0, Math.min(100, score));
}

function findComparableListings(targetListing, universe = [], options = {}) {
  const minSimilarity = toNumber(options.minSimilarity, 58);
  const targetId = targetListing.ebayItemId || targetListing.id || null;
  const targetFingerprint = buildFingerprint(targetListing);
  const targetPrice = getListingPrice(targetListing);

  if (hasAvoidFlags(targetFingerprint)) return [];

  return (Array.isArray(universe) ? universe : [])
    .filter(candidate => candidate)
    .filter(candidate => (candidate.ebayItemId || candidate.id) !== targetId)
    .map(candidate => {
      const candidateFingerprint = buildFingerprint(candidate);
      const price = getListingPrice(candidate);
      const similarity = similarityScore(targetFingerprint, candidateFingerprint);

      return {
        ebayItemId: candidate.ebayItemId || candidate.id || null,
        title: candidate.title || "Untitled",
        lane: candidate.lane || null,
        price,
        url: candidate.url || candidate.itemWebUrl || "",
        image: candidate.image || "",
        lastSeenAt: candidate.lastSeenAt || candidate.lastSeen || null,
        similarity,
        fingerprint: candidateFingerprint
      };
    })
    .filter(comp => comp.price > 0)
    .filter(comp => comp.similarity >= minSimilarity)
    .filter(comp => {
      if (!targetPrice || targetPrice <= 0) return true;
      return comp.price >= targetPrice * 0.25 && comp.price <= targetPrice * 4;
    })
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, toNumber(options.limit, 12));
}

function calculateMarketValueFromComps(comps = []) {
  const prices = comps.map(comp => comp.price).filter(price => price > 0);
  if (!prices.length) return 0;

  const sorted = prices.slice().sort((a, b) => a - b);
  const trimmed = sorted.length >= 5 ? sorted.slice(1, -1) : sorted;

  // Active listings are asking prices, not sold prices. Discount them so CardHawk stays conservative.
  const activeMedian = median(trimmed);
  return roundMoney(activeMedian * 0.9);
}

function calculateConfidence(comps = [], source = "none") {
  if (!comps.length || source === "none") return 0;

  const avgSimilarity = average(comps.map(comp => comp.similarity));
  let confidence = 10;

  if (comps.length >= 3) confidence += 15;
  if (comps.length >= 5) confidence += 15;
  if (comps.length >= 8) confidence += 10;
  if (avgSimilarity >= 70) confidence += 15;
  if (avgSimilarity >= 82) confidence += 10;

  // Active-market comps are useful, but not as trustworthy as sold comps.
  if (source === "active_market") confidence = Math.min(confidence, 72);
  if (source === "heuristic_fallback") confidence = Math.min(confidence, 18);

  return Math.max(0, Math.min(100, Math.round(confidence)));
}

function evaluateListing(listing, universe = [], options = {}) {
  const comps = findComparableListings(listing, universe, options);
  let source = comps.length >= 3 ? "active_market" : "heuristic_fallback";
  let marketValue = calculateMarketValueFromComps(comps);

  if (!marketValue && typeof options.fallbackEstimator === "function") {
    marketValue = roundMoney(options.fallbackEstimator(listing));
  }

  if (!marketValue) {
    marketValue = getListingPrice(listing);
    source = "none";
  }

  const confidence = calculateConfidence(comps, source);

  return {
    source,
    marketValue: roundMoney(marketValue),
    confidence,
    compCount: comps.length,
    comps,
    fingerprint: buildFingerprint(listing),
    note: source === "active_market"
      ? "Based on similar active listings observed by CardHawk. Sold comps are not connected yet."
      : "Fallback estimate only. Needs sold comps before high-trust alerts."
  };
}

function summarizeComps(compData = {}) {
  return {
    source: compData.source || "none",
    marketValue: roundMoney(compData.marketValue || 0),
    confidence: toNumber(compData.confidence, 0),
    compCount: toNumber(compData.compCount, 0),
    note: compData.note || ""
  };
}

module.exports = {
  buildFingerprint,
  findComparableListings,
  evaluateListing,
  summarizeComps
};
