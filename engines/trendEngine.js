// engines/trendEngine.js
// CardHawk Trend Engine v1
// Measures market direction, sales velocity, and short-term momentum from observed comps/history.
// This engine is intentionally source-agnostic: it can use CardHawk history today and richer sold-comps later.

const DEFAULT_TTL_MS = 1000 * 60 * 30; // 30 minutes
const cache = new Map();

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min = 0, max = 100) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}

function roundMoney(value) {
  return Math.round(toNumber(value, 0) * 100) / 100;
}

function getTitle(card = {}) {
  return String(card.title || card.name || card.query || "");
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function buildTrendKey(card = {}) {
  const lane = String(card.lane || card.sport || "unknown").toLowerCase();
  const title = normalizeText(getTitle(card)).replace(/\s+/g, "-").slice(0, 140);
  const grade = card.parsed?.grade || card.grade || "raw";
  const numbered = card.parsed?.numberedTo || card.numberedTo || "na";
  return `${lane}:${grade}:${numbered}:${title}`;
}

function getPrice(item = {}) {
  return toNumber(
    item.soldPrice ??
      item.price ??
      item.totalCost ??
      item.currentPrice ??
      item.marketValue ??
      item.estimatedValue,
    0
  );
}

function getDate(item = {}) {
  const raw = item.soldAt || item.endedAt || item.lastSeenAt || item.createdAt || item.date || item.timestamp;
  const date = raw ? new Date(raw) : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
}

function daysBetween(a, b) {
  const da = a instanceof Date ? a : new Date(a);
  const db = b instanceof Date ? b : new Date(b);
  if (!Number.isFinite(da.getTime()) || !Number.isFinite(db.getTime())) return null;
  return Math.abs(db.getTime() - da.getTime()) / (1000 * 60 * 60 * 24);
}

function median(numbers = []) {
  const clean = numbers.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!clean.length) return 0;
  const mid = Math.floor(clean.length / 2);
  if (clean.length % 2 === 0) return roundMoney((clean[mid - 1] + clean[mid]) / 2);
  return roundMoney(clean[mid]);
}

function average(numbers = []) {
  const clean = numbers.map(Number).filter(Number.isFinite);
  if (!clean.length) return 0;
  return roundMoney(clean.reduce((sum, n) => sum + n, 0) / clean.length);
}

function splitRecentVsOlder(points = []) {
  const sorted = [...points]
    .filter((p) => Number.isFinite(p.price))
    .sort((a, b) => (a.date?.getTime?.() || 0) - (b.date?.getTime?.() || 0));

  if (sorted.length < 4) {
    const midpoint = Math.ceil(sorted.length / 2);
    return {
      older: sorted.slice(0, midpoint),
      recent: sorted.slice(midpoint),
    };
  }

  const midpoint = Math.floor(sorted.length / 2);
  return {
    older: sorted.slice(0, midpoint),
    recent: sorted.slice(midpoint),
  };
}

function extractTrendPoints(card = {}, context = {}) {
  const sources = [];

  if (Array.isArray(context.soldComps)) sources.push(...context.soldComps);
  if (Array.isArray(context.comps)) sources.push(...context.comps);
  if (Array.isArray(card.comps)) sources.push(...card.comps);

  // History Engine compatibility: observedPrices may be [{ price, observedAt }] or raw numbers.
  const observed = context.observedPrices || card.observedPrices || card.priceHistory || [];
  if (Array.isArray(observed)) {
    for (const item of observed) {
      if (typeof item === "number") {
        sources.push({ price: item, date: null, source: "history" });
      } else if (item && typeof item === "object") {
        sources.push({
          price: item.price ?? item.totalCost ?? item.value,
          date: item.observedAt || item.date || item.timestamp,
          source: "history",
        });
      }
    }
  }

  const currentPrice = getPrice(card);
  if (currentPrice > 0) {
    sources.push({ price: currentPrice, date: new Date(), source: "current_listing" });
  }

  return sources
    .map((item) => ({
      price: getPrice(item),
      date: getDate(item),
      source: item.source || item.compSource || "unknown",
    }))
    .filter((point) => point.price > 0);
}

function classifyTrend(percentChange = 0, velocity = 0, confidence = 0) {
  if (confidence < 25) return "Unknown";
  if (percentChange >= 25 && velocity >= 50) return "Strong Uptrend";
  if (percentChange >= 10) return "Uptrend";
  if (percentChange <= -25 && velocity >= 50) return "Strong Downtrend";
  if (percentChange <= -10) return "Downtrend";
  return "Stable";
}

function scoreTrend({ percentChange = 0, velocityScore = 0, confidence = 0 } = {}) {
  let score = 50;
  score += clamp(percentChange, -50, 50) * 0.55;
  score += (clamp(velocityScore, 0, 100) - 50) * 0.25;
  score += (clamp(confidence, 0, 100) - 50) * 0.2;
  return Math.round(clamp(score, 0, 100));
}

function getTrendBonus(trend = {}) {
  const score = toNumber(trend.trendScore, 50);
  const confidence = toNumber(trend.confidence, 0);

  if (confidence < 35) return 0;
  if (score >= 90) return 16;
  if (score >= 80) return 12;
  if (score >= 70) return 8;
  if (score >= 60) return 4;
  if (score <= 25) return -12;
  if (score <= 35) return -7;
  if (score <= 45) return -3;
  return 0;
}

function evaluateTrend(card = {}, context = {}) {
  const points = extractTrendPoints(card, context);
  const prices = points.map((p) => p.price);
  const now = new Date();
  const datedPoints = points.filter((p) => p.date);

  const { older, recent } = splitRecentVsOlder(points);
  const olderAvg = average(older.map((p) => p.price));
  const recentAvg = average(recent.map((p) => p.price));

  let percentChange = 0;
  if (olderAvg > 0 && recentAvg > 0) {
    percentChange = ((recentAvg - olderAvg) / olderAvg) * 100;
  }

  const newestDate = datedPoints.length
    ? new Date(Math.max(...datedPoints.map((p) => p.date.getTime())))
    : null;
  const oldestDate = datedPoints.length
    ? new Date(Math.min(...datedPoints.map((p) => p.date.getTime())))
    : null;

  const spanDays = newestDate && oldestDate ? Math.max(1, daysBetween(oldestDate, newestDate) || 1) : null;
  const salesPer30Days = spanDays ? roundMoney((datedPoints.length / spanDays) * 30) : 0;
  const velocityScore = clamp(salesPer30Days * 12, 0, 100);

  let confidence = 20;
  if (points.length >= 3) confidence += 15;
  if (points.length >= 6) confidence += 15;
  if (points.length >= 10) confidence += 15;
  if (datedPoints.length >= 3) confidence += 10;
  if (spanDays && spanDays >= 7) confidence += 10;
  if (spanDays && spanDays >= 21) confidence += 10;

  const trendScore = scoreTrend({ percentChange, velocityScore, confidence });
  const direction = classifyTrend(percentChange, velocityScore, confidence);
  const bonus = getTrendBonus({ trendScore, confidence });

  const reasons = [];
  const warnings = [];

  if (percentChange >= 10) reasons.push(`Recent average is up ${Math.round(percentChange)}%`);
  if (percentChange <= -10) warnings.push(`Recent average is down ${Math.abs(Math.round(percentChange))}%`);
  if (velocityScore >= 70) reasons.push("Strong observed sales velocity");
  if (velocityScore <= 20 && points.length >= 3) warnings.push("Slow observed sales velocity");
  if (confidence < 40) warnings.push("Limited trend evidence");
  if (!datedPoints.length) warnings.push("No dated sales/history points yet");

  return {
    source: datedPoints.length ? "observed_market" : "limited_estimate",
    direction,
    trendScore,
    scoreBonus: bonus,
    confidence: Math.round(clamp(confidence, 0, 95)),
    percentChange: roundMoney(percentChange),
    salesPer30Days,
    velocityScore: Math.round(velocityScore),
    observedCount: points.length,
    datedCount: datedPoints.length,
    medianPrice: median(prices),
    averagePrice: average(prices),
    olderAverage: olderAvg,
    recentAverage: recentAvg,
    oldestObservedAt: oldestDate ? oldestDate.toISOString() : null,
    newestObservedAt: newestDate ? newestDate.toISOString() : now.toISOString(),
    reasons,
    warnings,
    cacheHit: false,
    createdAt: now.toISOString(),
  };
}

function getTrend(card = {}, context = {}, options = {}) {
  const key = buildTrendKey(card);
  const cached = cache.get(key);

  if (!options.forceRefresh && cached && cached.expiresAt > Date.now()) {
    return {
      ...cached.value,
      cacheHit: true,
    };
  }

  const trend = evaluateTrend(card, context);
  cache.set(key, {
    value: trend,
    expiresAt: Date.now() + (options.ttlMs || DEFAULT_TTL_MS),
  });

  return trend;
}

function summarizeTrend(trend = {}) {
  return {
    source: trend.source || "unknown",
    direction: trend.direction || "Unknown",
    trendScore: trend.trendScore || 50,
    scoreBonus: trend.scoreBonus || 0,
    confidence: trend.confidence || 0,
    percentChange: trend.percentChange || 0,
    salesPer30Days: trend.salesPer30Days || 0,
    observedCount: trend.observedCount || 0,
    warnings: trend.warnings || [],
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

module.exports = {
  getTrend,
  evaluateTrend,
  summarizeTrend,
  scoreTrend,
  getTrendBonus,
  extractTrendPoints,
  buildTrendKey,
  clearExpiredCache,
};
