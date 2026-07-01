// engines/soldSalesEngine.js
// CardHawk Sold Sales Engine v1
// Purpose: normalize, score, summarize, and prepare sold-sale evidence for Market Value Engine.
// This engine is intentionally conservative and backwards-compatible.

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

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s/.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

function daysBetween(dateValue, now = new Date()) {
  if (!dateValue) return null;
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return null;
  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24)));
}

function getParsed(item = {}) {
  return item.parsed || {};
}

function getFlags(item = {}) {
  return getParsed(item).flags || {};
}

function getPrice(item = {}) {
  const soldPrice = toNumber(item.soldPrice, NaN);
  if (Number.isFinite(soldPrice) && soldPrice > 0) return roundMoney(soldPrice);

  const totalCost = toNumber(item.totalCost, NaN);
  if (Number.isFinite(totalCost) && totalCost > 0) return roundMoney(totalCost);

  const price = toNumber(item.price, NaN);
  if (Number.isFinite(price) && price > 0) {
    return roundMoney(price + toNumber(item.shipping, 0));
  }

  return 0;
}

function getSoldDate(item = {}) {
  return item.soldAt || item.dateSold || item.endedAt || item.lastSeenAt || item.lastSeen || item.createdAt || null;
}

function titleHasAvoidTerms(title = "") {
  const normalized = normalizeText(title);
  return [
    "reprint",
    "custom",
    "digital",
    "proxy",
    "facsimile",
    "rp",
    "read description",
    "break credit",
    "case break",
    "team break",
    "box break",
    "pick your",
    "not card",
    "photo",
    "poster",
    "art card"
  ].some(term => normalized.includes(term));
}

function isSoldLike(item = {}) {
  const status = normalizeText(item.status || item.listingStatus || item.type || item.source);
  return Boolean(
    item.sold === true ||
    item.isSold === true ||
    item.soldAt ||
    item.dateSold ||
    status.includes("sold") ||
    status.includes("completed") ||
    status.includes("ended")
  );
}

function isAvoidListing(item = {}) {
  const flags = getFlags(item);
  return Boolean(
    flags.reprint ||
    flags.digital ||
    flags.custom ||
    flags.sealed ||
    flags.lot ||
    titleHasAvoidTerms(item.title)
  );
}

function extractShape(item = {}) {
  const parsed = getParsed(item);
  const flags = getFlags(item);

  return {
    lane: item.lane || parsed.lane || parsed.sport || null,
    player: parsed.player || item.player || null,
    year: parsed.year || item.year || null,
    brand: parsed.brand || item.brand || null,
    setName: parsed.setName || item.setName || null,
    gradeCompany: parsed.gradeCompany || item.gradeCompany || null,
    grade: parsed.grade || item.grade || null,
    numberedTo: parsed.numberedTo || item.numberedTo || null,
    rookie: Boolean(flags.rookie),
    autograph: Boolean(flags.autograph),
    graded: Boolean(flags.graded),
    numbered: Boolean(flags.numbered),
    firstBowman: Boolean(flags.firstBowman),
    refractor: Boolean(flags.refractor),
    pokemon: Boolean(flags.pokemon),
    title: normalizeText(item.title || "")
  };
}

function tokenOverlap(a = "", b = "") {
  const stopWords = new Set([
    "the", "and", "or", "with", "card", "cards", "rookie", "rc", "auto",
    "autograph", "signed", "psa", "bgs", "sgc", "cgc", "mint", "gem"
  ]);

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

function fieldMatchScore(targetValue, compValue, bonus, penalty = 0) {
  if (!targetValue || !compValue) return 0;
  return targetValue === compValue ? bonus : -penalty;
}

function booleanMatchScore(targetValue, compValue, bonus, penalty = 0) {
  if (typeof targetValue !== "boolean" || typeof compValue !== "boolean") return 0;
  return targetValue === compValue ? bonus : -penalty;
}

function scoreSoldSimilarity(targetListing = {}, soldItem = {}) {
  if (isAvoidListing(soldItem)) return 0;

  const target = extractShape(targetListing);
  const comp = extractShape(soldItem);

  let score = 0;

  score += fieldMatchScore(target.lane, comp.lane, 10, 8);
  score += fieldMatchScore(target.player, comp.player, 22, 12);
  score += fieldMatchScore(target.year, comp.year, 12, 8);
  score += fieldMatchScore(target.brand, comp.brand, 8, 4);
  score += fieldMatchScore(target.setName, comp.setName, 13, 8);
  score += fieldMatchScore(target.gradeCompany, comp.gradeCompany, 8, 6);
  score += fieldMatchScore(target.grade, comp.grade, 11, 12);
  score += fieldMatchScore(target.numberedTo, comp.numberedTo, 8, 5);

  score += booleanMatchScore(target.rookie, comp.rookie, 6, 5);
  score += booleanMatchScore(target.autograph, comp.autograph, 10, 12);
  score += booleanMatchScore(target.graded, comp.graded, 8, 10);
  score += booleanMatchScore(target.numbered, comp.numbered, 5, 4);
  score += booleanMatchScore(target.firstBowman, comp.firstBowman, 6, 5);
  score += booleanMatchScore(target.refractor, comp.refractor, 4, 3);
  score += booleanMatchScore(target.pokemon, comp.pokemon, 7, 8);

  score += Math.round(tokenOverlap(target.title, comp.title) * 30);

  return clamp(score, 0, 100);
}

function recencyBucket(days) {
  if (days === null) return "unknown";
  if (days <= 7) return "last_7_days";
  if (days <= 30) return "last_30_days";
  if (days <= 90) return "last_90_days";
  if (days <= 180) return "last_180_days";
  if (days <= 365) return "last_year";
  return "older";
}

function recencyWeight(days) {
  if (days === null) return 0.75;
  if (days <= 7) return 1.25;
  if (days <= 30) return 1.1;
  if (days <= 90) return 0.95;
  if (days <= 180) return 0.75;
  if (days <= 365) return 0.55;
  return 0.3;
}

function normalizeSoldItem(targetListing = {}, item = {}, options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const price = getPrice(item);
  const date = getSoldDate(item);
  const daysOld = daysBetween(date, now);
  const similarity = toNumber(item.similarity, scoreSoldSimilarity(targetListing, item));

  return {
    id: item.ebayItemId || item.itemId || item.id || null,
    title: item.title || "Untitled sold sale",
    price,
    soldPrice: price,
    shipping: toNumber(item.shipping, 0),
    url: item.url || item.itemWebUrl || "",
    image: item.image || "",
    soldAt: date,
    daysOld,
    recencyBucket: recencyBucket(daysOld),
    source: item.source || "sold_sales_engine",
    type: "sold",
    sold: true,
    isSold: true,
    similarity,
    raw: options.includeRaw ? item : undefined
  };
}

function removeOutliers(sales = [], options = {}) {
  if (sales.length < 5) return { kept: sales, removed: [] };

  const prices = sales.map(sale => sale.price).filter(price => price > 0).sort((a, b) => a - b);
  const med = median(prices);
  const minMultiplier = toNumber(options.minOutlierMultiplier, 0.35);
  const maxMultiplier = toNumber(options.maxOutlierMultiplier, 2.4);

  const kept = [];
  const removed = [];

  for (const sale of sales) {
    const low = med > 0 && sale.price < med * minMultiplier;
    const high = med > 0 && sale.price > med * maxMultiplier;
    if (low || high) removed.push({ ...sale, outlierReason: low ? "low_outlier" : "high_outlier" });
    else kept.push(sale);
  }

  return { kept, removed };
}

function calculatePriceTrend(sales = []) {
  const dated = sales
    .filter(sale => sale.price > 0 && sale.daysOld !== null)
    .sort((a, b) => b.daysOld - a.daysOld);

  if (dated.length < 4) {
    return {
      direction: "unknown",
      percentChange: 0,
      recentMedian: 0,
      olderMedian: 0,
      confidence: 0,
      note: "Not enough sold sales to calculate a reliable sold-price trend."
    };
  }

  const midpoint = Math.floor(dated.length / 2);
  const older = dated.slice(0, midpoint);
  const recent = dated.slice(midpoint);

  const olderMedian = median(older.map(sale => sale.price));
  const recentMedian = median(recent.map(sale => sale.price));
  const percentChange = olderMedian > 0 ? Math.round(((recentMedian - olderMedian) / olderMedian) * 1000) / 10 : 0;

  let direction = "flat";
  if (percentChange >= 8) direction = "up";
  else if (percentChange <= -8) direction = "down";

  return {
    direction,
    percentChange,
    recentMedian,
    olderMedian,
    confidence: clamp(Math.round(dated.length * 8), 0, 80),
    note: `Sold sales trend is ${direction} based on recent vs older median sale prices.`
  };
}

function confidenceFromSales({ saleCount, avgSimilarity, outliersRemoved, recentSaleCount }) {
  let confidence = 0;

  if (saleCount >= 1) confidence += 25;
  if (saleCount >= 3) confidence += 20;
  if (saleCount >= 5) confidence += 12;
  if (saleCount >= 8) confidence += 8;
  if (saleCount >= 12) confidence += 5;

  if (recentSaleCount >= 1) confidence += 5;
  if (recentSaleCount >= 3) confidence += 7;

  if (avgSimilarity >= 70) confidence += 8;
  if (avgSimilarity >= 82) confidence += 8;
  if (avgSimilarity >= 90) confidence += 5;

  confidence -= Math.min(10, outliersRemoved * 2);

  return clamp(Math.round(confidence), 0, 100);
}

function summarizeSoldSales(targetListing = {}, soldItems = [], options = {}) {
  const minSimilarity = toNumber(options.minSimilarity, 62);
  const limit = toNumber(options.limit, 50);

  const normalized = (Array.isArray(soldItems) ? soldItems : [])
    .filter(item => item)
    .filter(item => isSoldLike(item))
    .map(item => normalizeSoldItem(targetListing, item, options))
    .filter(sale => sale.price > 0)
    .filter(sale => sale.similarity >= minSimilarity)
    .sort((a, b) => {
      const weightA = (a.similarity / 100) * recencyWeight(a.daysOld);
      const weightB = (b.similarity / 100) * recencyWeight(b.daysOld);
      return weightB - weightA;
    })
    .slice(0, limit);

  const cleaned = removeOutliers(normalized, options);
  const sales = cleaned.kept;
  const prices = sales.map(sale => sale.price);

  const avgSimilarity = average(sales.map(sale => sale.similarity));
  const recentSaleCount = sales.filter(sale => sale.daysOld !== null && sale.daysOld <= 90).length;
  const trend = calculatePriceTrend(sales);
  const confidence = confidenceFromSales({
    saleCount: sales.length,
    avgSimilarity,
    outliersRemoved: cleaned.removed.length,
    recentSaleCount
  });

  return {
    source: "sold_sales_engine",
    saleCount: sales.length,
    recentSaleCount,
    outliersRemoved: cleaned.removed.length,
    averagePrice: average(prices),
    medianPrice: median(prices),
    lowPrice: prices.length ? roundMoney(Math.min(...prices)) : 0,
    highPrice: prices.length ? roundMoney(Math.max(...prices)) : 0,
    avgSimilarity,
    confidence,
    trend,
    sales,
    outliers: cleaned.removed,
    note: sales.length
      ? "Sold sales summary built from completed/sold evidence."
      : "No reliable sold sales found yet."
  };
}

function getMarketValueSoldComps(targetListing = {}, soldItems = [], options = {}) {
  const summary = summarizeSoldSales(targetListing, soldItems, options);

  return summary.sales.map(sale => ({
    ebayItemId: sale.id,
    id: sale.id,
    title: sale.title,
    price: sale.price,
    soldPrice: sale.price,
    shipping: sale.shipping,
    url: sale.url,
    image: sale.image,
    soldAt: sale.soldAt,
    dateSold: sale.soldAt,
    source: "sold_market",
    type: "sold",
    sold: true,
    isSold: true,
    similarity: sale.similarity
  }));
}

function summarizeForUI(summary = {}) {
  return {
    source: summary.source || "sold_sales_engine",
    saleCount: toNumber(summary.saleCount, 0),
    recentSaleCount: toNumber(summary.recentSaleCount, 0),
    medianPrice: roundMoney(summary.medianPrice || 0),
    averagePrice: roundMoney(summary.averagePrice || 0),
    lowPrice: roundMoney(summary.lowPrice || 0),
    highPrice: roundMoney(summary.highPrice || 0),
    confidence: toNumber(summary.confidence, 0),
    trend: summary.trend || {},
    note: summary.note || ""
  };
}

module.exports = {
  summarizeSoldSales,
  getMarketValueSoldComps,
  summarizeForUI,
  scoreSoldSimilarity,
  normalizeSoldItem,
  removeOutliers,
  calculatePriceTrend
};
