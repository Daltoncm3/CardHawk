// engines/historyEngine.js
// CardHawk History Engine
// Tracks listings across scans, price movement, scan survival, and disappearance events.

const fs = require("fs");
const path = require("path");
const stateStore = require("../utils/stateStore");
const listingIdentity = require("../utils/listingIdentity");

const DATA_DIR = path.join(__dirname, "..", "data");
const HISTORY_FILE = path.join(DATA_DIR, "listingHistory.json");
const MAX_SCAN_RECORDS = 250;
const MAX_PRICE_POINTS_PER_LISTING = 100;
const MAX_PRICE_DROPS_PER_LISTING = 50;

function nowIso() {
  return new Date().toISOString();
}

function ensureHistoryFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  if (!fs.existsSync(HISTORY_FILE)) {
    saveHistory(createEmptyHistory());
  }
}

function createEmptyHistory() {
  return {
    version: 1,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    listings: {},
    scans: [],
    stats: {
      totalListingsTracked: 0,
      activeListings: 0,
      disappearedListings: 0,
      totalPriceDrops: 0,
      lastScanAt: null
    }
  };
}

function loadHistory() {
  try {
    ensureHistoryFile();
    const parsed = stateStore.loadJsonState(HISTORY_FILE, createEmptyHistory());

    return {
      ...createEmptyHistory(),
      ...parsed,
      listings: parsed.listings || {},
      scans: parsed.scans || [],
      stats: parsed.stats || createEmptyHistory().stats
    };
  } catch (error) {
    console.error("History Engine failed to load history file:", error.message);
    return createEmptyHistory();
  }
}

function saveHistory(history) {
  history.updatedAt = nowIso();
  stateStore.saveJsonState(HISTORY_FILE, history);
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function roundMoney(value) {
  return Math.round(toNumber(value) * 100) / 100;
}

function getItemId(listing) {
  return listingIdentity.getListingId(listing) || String(listing?.legacyItemId || "").trim();
}

function getTotalCost(listing) {
  if (Number.isFinite(Number(listing?.totalCost))) return roundMoney(listing.totalCost);
  return roundMoney(toNumber(listing?.price) + toNumber(listing?.shipping));
}

function compactListing(listing) {
  return {
    ebayItemId: getItemId(listing),
    title: listing?.title || "Untitled",
    lane: listing?.lane || "all",
    query: listing?.query || null,
    price: roundMoney(listing?.price),
    shipping: roundMoney(listing?.shipping),
    totalCost: getTotalCost(listing),
    condition: listing?.condition || "Unknown",
    url: listing?.url || listing?.itemWebUrl || "",
    image: listing?.image || "",
    sellerUsername: listing?.sellerUsername || "Unknown",
    score: toNumber(listing?.score),
    estimatedProfit: roundMoney(listing?.estimatedProfit),
    roi: toNumber(listing?.roi),
    parsed: listing?.parsed || null
  };
}

function createListingRecord(listing, observedAt, scanId) {
  const compact = compactListing(listing);

  return {
    ebayItemId: compact.ebayItemId,
    title: compact.title,
    lane: compact.lane,
    query: compact.query,
    condition: compact.condition,
    url: compact.url,
    image: compact.image,
    sellerUsername: compact.sellerUsername,
    parsed: compact.parsed,
    firstSeenAt: observedAt,
    lastSeenAt: observedAt,
    disappearedAt: null,
    status: "active",
    likelySoldOrEnded: false,
    seenCount: 1,
    scansSurvived: 1,
    firstPrice: compact.totalCost,
    currentPrice: compact.totalCost,
    lowestPrice: compact.totalCost,
    highestPrice: compact.totalCost,
    lastScore: compact.score,
    lastEstimatedProfit: compact.estimatedProfit,
    lastRoi: compact.roi,
    priceHistory: [createPricePoint(compact, observedAt, scanId)],
    priceDrops: []
  };
}

function createPricePoint(listing, observedAt, scanId) {
  return {
    observedAt,
    scanId,
    price: roundMoney(listing.price),
    shipping: roundMoney(listing.shipping),
    totalCost: roundMoney(listing.totalCost)
  };
}

function updateListingRecord(record, listing, observedAt, scanId) {
  const compact = compactListing(listing);
  const previousPrice = roundMoney(record.currentPrice);
  const currentPrice = roundMoney(compact.totalCost);
  const priceChanged = previousPrice !== currentPrice;
  const dropped = currentPrice < previousPrice;

  record.title = compact.title || record.title;
  record.lane = compact.lane || record.lane;
  record.query = compact.query || record.query;
  record.condition = compact.condition || record.condition;
  record.url = compact.url || record.url;
  record.image = compact.image || record.image;
  record.sellerUsername = compact.sellerUsername || record.sellerUsername;
  record.parsed = compact.parsed || record.parsed;
  record.lastSeenAt = observedAt;
  record.disappearedAt = null;
  record.status = "active";
  record.likelySoldOrEnded = false;
  record.seenCount = toNumber(record.seenCount) + 1;
  record.scansSurvived = toNumber(record.scansSurvived) + 1;
  record.currentPrice = currentPrice;
  record.lowestPrice = Math.min(toNumber(record.lowestPrice, currentPrice), currentPrice);
  record.highestPrice = Math.max(toNumber(record.highestPrice, currentPrice), currentPrice);
  record.lastScore = compact.score;
  record.lastEstimatedProfit = compact.estimatedProfit;
  record.lastRoi = compact.roi;

  if (priceChanged) {
    record.priceHistory.push(createPricePoint(compact, observedAt, scanId));
    record.priceHistory = record.priceHistory.slice(-MAX_PRICE_POINTS_PER_LISTING);
  }

  let priceDrop = null;

  if (dropped) {
    priceDrop = {
      ebayItemId: record.ebayItemId,
      title: record.title,
      lane: record.lane,
      url: record.url,
      fromPrice: previousPrice,
      toPrice: currentPrice,
      amountDropped: roundMoney(previousPrice - currentPrice),
      percentDropped: previousPrice > 0 ? roundMoney(((previousPrice - currentPrice) / previousPrice) * 100) : 0,
      detectedAt: observedAt,
      scanId
    };

    record.priceDrops.unshift(priceDrop);
    record.priceDrops = record.priceDrops.slice(0, MAX_PRICE_DROPS_PER_LISTING);
  }

  return { record, priceDrop, isNew: false };
}

function refreshStats(history) {
  const listings = Object.values(history.listings || {});
  const activeListings = listings.filter((listing) => listing.status === "active").length;
  const disappearedListings = listings.filter((listing) => listing.status === "disappeared").length;
  const totalPriceDrops = listings.reduce((sum, listing) => sum + (listing.priceDrops?.length || 0), 0);

  history.stats = {
    totalListingsTracked: listings.length,
    activeListings,
    disappearedListings,
    totalPriceDrops,
    lastScanAt: history.scans?.[0]?.finishedAt || history.stats?.lastScanAt || null
  };

  return history.stats;
}

function recordScan(listings, options = {}) {
  if (!Array.isArray(listings)) {
    throw new TypeError("historyEngine.recordScan expected an array of listings");
  }

  const history = loadHistory();
  const scanId = options.scanId || `scan-${Date.now()}`;
  const observedAt = options.observedAt || nowIso();
  const source = options.source || "unknown";
  const lane = options.lane || null;
  const seenIds = new Set();
  const newListings = [];
  const updatedListings = [];
  const priceDrops = [];

  for (const listing of listings) {
    const ebayItemId = getItemId(listing);
    if (!ebayItemId) continue;

    seenIds.add(ebayItemId);

    if (!history.listings[ebayItemId]) {
      const record = createListingRecord(listing, observedAt, scanId);
      history.listings[ebayItemId] = record;
      newListings.push(record);
      continue;
    }

    const update = updateListingRecord(history.listings[ebayItemId], listing, observedAt, scanId);
    history.listings[ebayItemId] = update.record;
    updatedListings.push(update.record);
    if (update.priceDrop) priceDrops.push(update.priceDrop);
  }

  const disappeared = [];

  for (const record of Object.values(history.listings)) {
    if (record.status !== "active") continue;
    if (lane && record.lane !== lane) continue;
    if (seenIds.has(record.ebayItemId)) continue;

    record.status = "disappeared";
    record.disappearedAt = observedAt;
    record.likelySoldOrEnded = true;
    disappeared.push(record);
  }

  const scanRecord = {
    scanId,
    source,
    lane,
    observedAt,
    finishedAt: nowIso(),
    observedCount: seenIds.size,
    newCount: newListings.length,
    updatedCount: updatedListings.length,
    priceDropCount: priceDrops.length,
    disappearedCount: disappeared.length
  };

  history.scans.unshift(scanRecord);
  history.scans = history.scans.slice(0, MAX_SCAN_RECORDS);
  refreshStats(history);
  saveHistory(history);

  return {
    scanId,
    observedCount: seenIds.size,
    trackedCount: Object.keys(history.listings).length,
    activeCount: history.stats.activeListings,
    newListings,
    updatedListings,
    priceDrops,
    disappeared,
    stats: history.stats
  };
}

function getListing(ebayItemId) {
  const history = loadHistory();
  return history.listings[String(ebayItemId)] || null;
}

function getActiveListings(limit = 100) {
  const history = loadHistory();
  return Object.values(history.listings)
    .filter((listing) => listing.status === "active")
    .sort((a, b) => new Date(b.lastSeenAt) - new Date(a.lastSeenAt))
    .slice(0, limit);
}

function getDisappearedListings(limit = 100) {
  const history = loadHistory();
  return Object.values(history.listings)
    .filter((listing) => listing.status === "disappeared")
    .sort((a, b) => new Date(b.disappearedAt || 0) - new Date(a.disappearedAt || 0))
    .slice(0, limit);
}

function getPriceDrops(filters = {}, limit = 100) {
  const history = loadHistory();
  const lane = filters.lane || null;

  return Object.values(history.listings)
    .flatMap((listing) => (listing.priceDrops || []).map((drop) => ({ ...drop, lane: listing.lane })))
    .filter((drop) => !lane || drop.lane === lane)
    .sort((a, b) => new Date(b.detectedAt) - new Date(a.detectedAt))
    .slice(0, limit);
}

function summarizeHistory() {
  const history = loadHistory();
  refreshStats(history);

  return {
    stats: history.stats,
    recentScans: history.scans.slice(0, 10),
    recentPriceDrops: getPriceDrops({}, 10),
    recentDisappeared: getDisappearedListings(10)
  };
}

module.exports = {
  recordScan,
  getListing,
  getActiveListings,
  getDisappearedListings,
  getPriceDrops,
  summarizeHistory,
  loadHistory,
  saveHistory
};
