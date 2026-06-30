// engines/marketValueEngine.js
// CardHawk Market Value Engine v1
// Purpose: produce one trusted valuation object from multiple evidence sources.
// This engine is designed to be conservative, modular, and backward-compatible.

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function roundMoney(value) {
  return Math.round(toNumber(value) * 100) / 100;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function median(numbers = []) {
  const clean = numbers.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!clean.length) return 0;
  const middle = Math.floor(clean.length / 2);
  if (clean.length % 2 === 0) return roundMoney((clean[middle - 1] + clean[middle]) / 2);
  return roundMoney(clean[middle]);
}

function average(numbers = []) {
  const clean = numbers.map(Number).filter(Number.isFinite);
  if (!clean.length) return 0;
  return roundMoney(clean.reduce((sum, value) => sum + value, 0) / clean.length);
}

function weightedAverage(items = []) {
  const clean = items
    .map(item => ({ value: toNumber(item.value, 0), weight: toNumber(item.weight, 0) }))
    .filter(item => item.value > 0 && item.weight > 0);

  if (!clean.length) return 0;

  const totalWeight = clean.reduce((sum, item) => sum + item.weight, 0);
  const weightedTotal = clean.reduce((sum, item) => sum + item.value * item.weight, 0);
  return roundMoney(weightedTotal / totalWeight);
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s/.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function daysBetween(dateValue, now = new Date()) {
  if (!dateValue) return null;
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return null;
  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24)));
}

function getListingPrice(listing = {}) {
  const totalCost = toNumber(listing.totalCost, NaN);
  if (Number.isFinite(totalCost) && totalCost > 0) return roundMoney(totalCost);

  const price = toNumber(listing.price, 0);
  const shipping = toNumber(listing.shipping, 0);
  return roundMoney(price + shipping);
}

function getParsed(listing = {}) {
  return listing.parsed || {};
}

function getFlags(listing = {}) {
  return getParsed(listing).flags || {};
}

function getEvidencePrice(evidence = {}) {
  const soldPrice = toNumber(evidence.soldPrice, NaN);
  if (Number.isFinite(soldPrice) && soldPrice > 0) return roundMoney(soldPrice);

  const price = toNumber(evidence.price, NaN);
  if (Number.isFinite(price) && price > 0) {
    const shipping = toNumber(evidence.shipping, 0);
    return roundMoney(price + shipping);
  }

  const totalCost = toNumber(evidence.totalCost, NaN);
  if (Number.isFinite(totalCost) && totalCost > 0) return roundMoney(totalCost);

  return 0;
}

function isSoldEvidence(evidence = {}) {
  const status = normalizeText(evidence.status || evidence.listingStatus || evidence.type || evidence.source);
  return Boolean(
    evidence.sold === true ||
    evidence.isSold === true ||
    evidence.soldAt ||
    evidence.dateSold ||
    status.includes("sold") ||
    status.includes("completed")
  );
}

function getEvidenceDate(evidence = {}) {
  return evidence.soldAt || evidence.dateSold || evidence.endedAt || evidence.lastSeenAt || evidence.lastSeen || evidence.createdAt || null;
}

function titleContainsBadMarketTerms(title = "") {
  const normalized = normalizeText(title);
  const badTerms = [
    "reprint", "custom", "digital", "proxy", "facsimile", "rp", "read description",
    "break credit", "pick your", "case break", "team break", "box break", "not card"
  ];
  return badTerms.some(term => normalized.includes(term));
}

function hasAvoidFlags(listing = {}) {
  const flags = getFlags(listing);
  return Boolean(
    flags.lot ||
    flags.sealed ||
    flags.reprint ||
    flags.digital ||
    flags.custom ||
    titleContainsBadMarketTerms(listing.title)
  );
}

function fieldMatchBonus(targetValue, compValue, bonus, penalty = 0) {
  if (!targetValue || !compValue) return 0;
  return targetValue === compValue ? bonus : -penalty;
}

function booleanMatchBonus(targetValue, compValue, bonus, penalty = 0) {
  if (typeof targetValue !== "boolean" || typeof compValue !== "boolean") return 0;
  return targetValue === compValue ? bonus : -penalty;
}

function extractComparableShape(listing = {}) {
  const parsed = getParsed(listing);
  const flags = getFlags(listing);

  return {
    lane: listing.lane || parsed.lane || parsed.sport || null,
    player: parsed.player || listing.player || null,
    year: parsed.year || listing.year || null,
    brand: parsed.brand || listing.brand || null,
    setName: parsed.setName || listing.setName || null,
    gradeCompany: parsed.gradeCompany || listing.gradeCompany || null,
    grade: parsed.grade || listing.grade || null,
    numberedTo: parsed.numberedTo || listing.numberedTo || null,
    rookie: Boolean(flags.rookie),
    autograph: Boolean(flags.autograph),
    graded: Boolean(flags.graded),
    numbered: Boolean(flags.numbered),
    firstBowman: Boolean(flags.firstBowman),
    refractor: Boolean(flags.refractor),
    pokemon: Boolean(flags.pokemon),
    title: normalizeText(listing.title || "")
  };
}

function tokenOverlap(a = "", b = "") {
  const stopWords = new Set(["the", "and", "or", "a", "an", "card", "cards", "rc", "rookie", "auto", "autograph", "psa", "bgs", "sgc"]);
  const aTokens = normalizeText(a).split(" ").filter(token => token.length >= 3 && !stopWords.has(token));
  const bTokens = normalizeText(b).split(" ").filter(token => token.length >= 3 && !stopWords.has(token));
  if (!aTokens.length || !bTokens.length) return 0;

  const aSet = new Set(aTokens);
  const bSet = new Set(bTokens);
  let overlap = 0;
  for (const token of aSet) {
    if (bSet.has(token)) overlap += 1;
  }
  return overlap / Math.max(aSet.size, bSet.size);
}

function scoreEvidenceSimilarity(targetListing = {}, evidence = {}) {
  const target = extractComparableShape(targetListing);
  const comp = extractComparableShape(evidence);

  if (hasAvoidFlags(evidence)) return 0;

  let score = 0;
  score += fieldMatchBonus(target.lane, comp.lane, 10, 8);
  score += fieldMatchBonus(target.player, comp.player, 20, 10);
  score += fieldMatchBonus(target.year, comp.year, 12, 8);
  score += fieldMatchBonus(target.brand, comp.brand, 8, 4);
  score += fieldMatchBonus(target.setName, comp.setName, 12, 8);
  score += fieldMatchBonus(target.gradeCompany, comp.gradeCompany, 8, 6);
  score += fieldMatchBonus(target.grade, comp.grade, 10, 12);
  score += fieldMatchBonus(target.numberedTo, comp.numberedTo, 8, 4);

  score += booleanMatchBonus(target.rookie, comp.rookie, 6, 5);
  score += booleanMatchBonus(target.autograph, comp.autograph, 10, 12);
  score += booleanMatchBonus(target.graded, comp.graded, 8, 10);
  score += booleanMatchBonus(target.numbered, comp.numbered, 5, 4);
  score += booleanMatchBonus(target.firstBowman, comp.firstBowman, 6, 5);
  score += booleanMatchBonus(target.refractor, comp.refractor, 4, 3);
  score += booleanMatchBonus(target.pokemon, comp.pokemon, 6, 8);

  score += Math.round(tokenOverlap(target.title, comp.title) * 30);

  return clamp(score, 0, 100);
}

function recencyWeight(dateValue, now = new Date()) {
  const days = daysBetween(dateValue, now);
  if (days === null) return 0.75;
  if (days <= 7) return 1.25;
  if (days <= 30) return 1.1;
  if (days <= 90) return 0.95;
  if (days <= 180) return 0.75;
  if (days <= 365) return 0.55;
  return 0.35;
}

function sourceWeight(source = "") {
  const normalized = normalizeText(source);
  if (normalized.includes("sold")) return 1.35;
  if (normalized.includes("completed")) return 1.25;
  if (normalized.includes("active")) return 0.55;
  if (normalized.includes("history")) return 0.8;
  if (normalized.includes("manual")) return 1.0;
  return 0.75;
}

function buildSoldEvidence(listing, soldComps = [], options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const minSimilarity = toNumber(options.minSoldSimilarity, 62);

  return (Array.isArray(soldComps) ? soldComps : [])
    .map(comp => {
      const price = getEvidencePrice(comp);
      const similarity = toNumber(comp.similarity, scoreEvidenceSimilarity(listing, comp));
      const date = getEvidenceDate(comp);
      const source = comp.source || "sold_market";

      return {
        id: comp.ebayItemId || comp.id || comp.itemId || null,
        title: comp.title || "Untitled sold comp",
        price,
        url: comp.url || comp.itemWebUrl || "",
        date,
        source,
        type: "sold",
        similarity,
        weight: roundMoney((similarity / 100) * recencyWeight(date, now) * sourceWeight(source))
      };
    })
    .filter(comp => comp.price > 0)
    .filter(comp => comp.similarity >= minSimilarity)
    .sort((a, b) => b.weight - a.weight);
}

function buildActiveEvidence(activeCompData = {}) {
  const comps = Array.isArray(activeCompData.comps) ? activeCompData.comps : [];

  return comps
    .map(comp => ({
      id: comp.ebayItemId || comp.id || null,
      title: comp.title || "Untitled active comp",
      price: getEvidencePrice(comp),
      url: comp.url || comp.itemWebUrl || "",
      date: comp.lastSeenAt || comp.lastSeen || null,
      source: "active_market",
      type: "active",
      similarity: toNumber(comp.similarity, 0),
      weight: roundMoney((toNumber(comp.similarity, 0) / 100) * 0.55)
    }))
    .filter(comp => comp.price > 0)
    .filter(comp => comp.similarity >= 58)
    .sort((a, b) => b.weight - a.weight);
}

function removePriceOutliers(evidence = [], options = {}) {
  if (evidence.length < 5) {
    return { kept: evidence, removed: [] };
  }

  const prices = evidence.map(item => item.price).filter(price => price > 0).sort((a, b) => a - b);
  const med = median(prices);
  const maxMultiplier = toNumber(options.maxOutlierMultiplier, 2.4);
  const minMultiplier = toNumber(options.minOutlierMultiplier, 0.35);

  const kept = [];
  const removed = [];

  for (const item of evidence) {
    const highOutlier = med > 0 && item.price > med * maxMultiplier;
    const lowOutlier = med > 0 && item.price < med * minMultiplier;
    if (highOutlier || lowOutlier) removed.push(item);
    else kept.push(item);
  }

  return { kept, removed };
}

function applyTrendAdjustment(value, trendData = {}) {
  if (!value || value <= 0) return 0;

  const direction = normalizeText(trendData.direction || trendData.trend || trendData.marketDirection || "");
  const strength = toNumber(trendData.strength ?? trendData.score ?? trendData.confidence, 0);

  let adjustment = 0;
  if (direction.includes("up") || direction.includes("rising") || direction.includes("hot")) adjustment = clamp(strength / 1000, 0.01, 0.08);
  if (direction.includes("down") || direction.includes("falling") || direction.includes("cold")) adjustment = -clamp(strength / 1000, 0.01, 0.08);

  return roundMoney(value * (1 + adjustment));
}

function applyPopulationAdjustment(value, populationData = {}) {
  if (!value || value <= 0) return 0;

  const scarcity = normalizeText(populationData.scarcity || populationData.populationTier || populationData.tier || "");
  const popCount = toNumber(populationData.population ?? populationData.pop ?? populationData.estimatedPopulation, NaN);

  let adjustment = 0;
  if (scarcity.includes("ultra") || scarcity.includes("very low")) adjustment = 0.07;
  else if (scarcity.includes("low") || scarcity.includes("scarce")) adjustment = 0.04;
  else if (scarcity.includes("high") || scarcity.includes("common")) adjustment = -0.04;

  if (Number.isFinite(popCount)) {
    if (popCount > 0 && popCount <= 25) adjustment += 0.04;
    else if (popCount >= 1000) adjustment -= 0.03;
  }

  return roundMoney(value * (1 + clamp(adjustment, -0.08, 0.10)));
}

function calculateEvidenceConfidence({ soldEvidence, activeEvidence, source, outliersRemoved }) {
  let confidence = 0;

  const soldCount = soldEvidence.length;
  const activeCount = activeEvidence.length;
  const avgSoldSimilarity = average(soldEvidence.map(comp => comp.similarity));
  const avgActiveSimilarity = average(activeEvidence.map(comp => comp.similarity));

  if (source === "sold_market") confidence = 45;
  else if (source === "blended_market") confidence = 38;
  else if (source === "active_market") confidence = 22;
  else confidence = 8;

  if (soldCount >= 3) confidence += 15;
  if (soldCount >= 5) confidence += 10;
  if (soldCount >= 8) confidence += 8;
  if (activeCount >= 5) confidence += 5;
  if (activeCount >= 10) confidence += 4;
  if (avgSoldSimilarity >= 75) confidence += 8;
  if (avgSoldSimilarity >= 86) confidence += 7;
  if (!soldCount && avgActiveSimilarity >= 80) confidence += 6;
  if (outliersRemoved > 0) confidence -= Math.min(8, outliersRemoved * 2);

  if (source === "active_market") confidence = Math.min(confidence, 72);
  if (source === "fallback") confidence = Math.min(confidence, 25);

  return clamp(Math.round(confidence), 0, 100);
}

function buildPriceRange(value, confidence) {
  if (!value || value <= 0) return { low: 0, high: 0 };

  let spread = 0.25;
  if (confidence >= 85) spread = 0.08;
  else if (confidence >= 75) spread = 0.12;
  else if (confidence >= 60) spread = 0.18;
  else if (confidence >= 40) spread = 0.25;
  else spread = 0.35;

  return {
    low: roundMoney(value * (1 - spread)),
    high: roundMoney(value * (1 + spread))
  };
}

function calculateMarketValue(input = {}) {
  const listing = input.listing || input.targetListing || {};
  const activeCompData = input.activeCompData || input.compData || {};
  const soldComps = input.soldComps || [];
  const trendData = input.trendData || {};
  const populationData = input.populationData || {};
  const options = input.options || {};

  const listingPrice = getListingPrice(listing);
  const soldEvidenceRaw = buildSoldEvidence(listing, soldComps, options);
  const activeEvidenceRaw = buildActiveEvidence(activeCompData);

  const soldClean = removePriceOutliers(soldEvidenceRaw, options);
  const activeClean = removePriceOutliers(activeEvidenceRaw, options);

  const soldEvidence = soldClean.kept;
  const activeEvidence = activeClean.kept;
  const outliersRemoved = soldClean.removed.length + activeClean.removed.length;

  let baseValue = 0;
  let source = "fallback";
  let method = "fallback";

  if (soldEvidence.length >= 3) {
    baseValue = weightedAverage(soldEvidence.map(comp => ({ value: comp.price, weight: comp.weight })));
    source = "sold_market";
    method = "weightedSoldComps";
  } else if (soldEvidence.length >= 1 && activeEvidence.length >= 3) {
    const soldValue = weightedAverage(soldEvidence.map(comp => ({ value: comp.price, weight: comp.weight * 1.35 })));
    const activeValue = roundMoney(weightedAverage(activeEvidence.map(comp => ({ value: comp.price, weight: comp.weight }))) * 0.9);
    baseValue = weightedAverage([
      { value: soldValue, weight: 1.4 },
      { value: activeValue, weight: 0.6 }
    ]);
    source = "blended_market";
    method = "soldPlusActiveBlend";
  } else if (activeEvidence.length >= 3 || activeCompData.marketValue > 0) {
    baseValue = roundMoney(toNumber(activeCompData.marketValue, 0) || weightedAverage(activeEvidence.map(comp => ({ value: comp.price, weight: comp.weight }))) * 0.9);
    source = "active_market";
    method = "discountedActiveComps";
  } else if (typeof options.fallbackEstimator === "function") {
    baseValue = roundMoney(options.fallbackEstimator(listing));
    source = "fallback";
    method = "fallbackEstimator";
  } else {
    baseValue = listingPrice;
    source = "fallback";
    method = "listingPriceFallback";
  }

  let adjustedValue = baseValue;
  adjustedValue = applyPopulationAdjustment(adjustedValue, populationData);
  adjustedValue = applyTrendAdjustment(adjustedValue, trendData);

  const confidence = calculateEvidenceConfidence({
    soldEvidence,
    activeEvidence,
    source,
    outliersRemoved
  });

  const marketValue = roundMoney(adjustedValue);
  const priceRange = buildPriceRange(marketValue, confidence);
  const discountAmount = marketValue > 0 && listingPrice > 0 ? roundMoney(marketValue - listingPrice) : 0;
  const discountPercent = marketValue > 0 && listingPrice > 0 ? Math.round((discountAmount / marketValue) * 1000) / 10 : 0;

  return {
    source,
    method,
    marketValue,
    baseMarketValue: roundMoney(baseValue),
    confidence,
    compCount: soldEvidence.length + activeEvidence.length,
    soldCompCount: soldEvidence.length,
    activeCompCount: activeEvidence.length,
    outliersRemoved,
    priceRange,
    listingPrice,
    discountAmount,
    discountPercent,
    evidence: {
      sold: soldEvidence.slice(0, toNumber(options.evidenceLimit, 10)),
      active: activeEvidence.slice(0, toNumber(options.evidenceLimit, 10))
    },
    adjustments: {
      populationApplied: Boolean(populationData && Object.keys(populationData).length),
      trendApplied: Boolean(trendData && Object.keys(trendData).length)
    },
    note: source === "sold_market"
      ? "Market value based primarily on sold comp evidence."
      : source === "blended_market"
        ? "Market value blended from limited sold evidence and active-market evidence."
        : source === "active_market"
          ? "Market value based on discounted active-market comps. Sold comps should improve confidence."
          : "Fallback valuation only. Use low confidence until better evidence is available."
  };
}

function summarizeMarketValue(marketData = {}) {
  return {
    source: marketData.source || "fallback",
    method: marketData.method || "unknown",
    marketValue: roundMoney(marketData.marketValue || 0),
    confidence: toNumber(marketData.confidence, 0),
    compCount: toNumber(marketData.compCount, 0),
    soldCompCount: toNumber(marketData.soldCompCount, 0),
    activeCompCount: toNumber(marketData.activeCompCount, 0),
    priceRange: marketData.priceRange || { low: 0, high: 0 },
    discountAmount: roundMoney(marketData.discountAmount || 0),
    discountPercent: toNumber(marketData.discountPercent, 0),
    note: marketData.note || ""
  };
}

module.exports = {
  calculateMarketValue,
  summarizeMarketValue,
  scoreEvidenceSimilarity,
  buildSoldEvidence,
  buildActiveEvidence,
  removePriceOutliers
};
