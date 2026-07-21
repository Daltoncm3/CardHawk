// engines/historyEngine.js
// CardHawk History Engine
// Tracks listings across scans, price movement, scan survival, and disappearance events.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const stateStore = require("../utils/stateStore");
const listingIdentity = require("../utils/listingIdentity");

const DATA_DIR = path.join(__dirname, "..", "data");
const DEFAULT_HISTORY_FILE = path.join(DATA_DIR, "listingHistory.json");
const DEFAULT_ARCHIVE_DIR = path.join(DATA_DIR, "history-archive");
const HISTORY_SCHEMA_VERSION = 2;
const ARCHIVE_SEGMENT_SCHEMA_VERSION = 1;
const MAX_SCAN_RECORDS = 250;
const MAX_PRICE_POINTS_PER_LISTING = 100;
const MAX_PRICE_DROPS_PER_LISTING = 50;
const DEFAULT_HISTORY_RETENTION_POLICY = Object.freeze({
  maxActiveHistoryRecords: 5000,
  maxInactiveHistoryAgeDays: 180,
  minProtectedHistoryRecords: 500,
  archiveSegmentRecordLimit: 500
});

let historyFilePath = DEFAULT_HISTORY_FILE;
let archiveDirectoryPath = DEFAULT_ARCHIVE_DIR;

function nowIso() {
  return new Date().toISOString();
}

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function parseTime(value) {
  const time = new Date(value || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function toPositiveInteger(value, fallback) {
  const number = Number(value);
  const fallbackNumber = Number(fallback);
  const safeFallback = Number.isFinite(fallbackNumber) && fallbackNumber > 0 ? Math.floor(fallbackNumber) : 1;
  if (!Number.isFinite(number) || number <= 0) return safeFallback;
  return Math.floor(number);
}

function toOptionalPositiveInteger(value, fallback = null) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.floor(number);
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

function ensureDirectory(directoryPath) {
  if (!fs.existsSync(directoryPath)) fs.mkdirSync(directoryPath, { recursive: true });
}

function ensureHistoryFile() {
  ensureDirectory(path.dirname(historyFilePath));
  ensureDirectory(archiveDirectoryPath);

  if (!fs.existsSync(historyFilePath)) {
    writeJsonAtomic(historyFilePath, createEmptyHistory());
  }
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stableStringify(value[key])}`
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

function buildFingerprint(value) {
  return crypto.createHash("sha256").update(stableStringify(value)).digest("hex");
}

function writeJsonAtomic(filePath, value) {
  ensureDirectory(path.dirname(filePath));
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  fs.writeFileSync(tempPath, JSON.stringify(value));
  fs.renameSync(tempPath, filePath);
}

function createArchiveMetadata(input = {}) {
  const segments = Array.isArray(input.segments) ? input.segments : [];
  const segmentIds = new Set();
  const uniqueSegments = [];

  for (const segment of segments) {
    if (!segment?.segmentId || segmentIds.has(segment.segmentId)) continue;
    segmentIds.add(segment.segmentId);
    uniqueSegments.push(segment);
  }

  return {
    schemaVersion: 1,
    archiveDirectory: input.archiveDirectory || path.basename(archiveDirectoryPath),
    archivedRecordCount: toNumber(input.archivedRecordCount),
    archivedDisappearedCount: toNumber(input.archivedDisappearedCount),
    archivedPriceDropCount: toNumber(input.archivedPriceDropCount),
    segmentCount: uniqueSegments.length,
    lastArchiveAt: input.lastArchiveAt || null,
    segments: uniqueSegments
  };
}

function createEmptyHistory() {
  return {
    version: HISTORY_SCHEMA_VERSION,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    listings: {},
    scans: [],
    stats: {
      totalListingsTracked: 0,
      activeRecordCount: 0,
      archivedRecordCount: 0,
      activeListings: 0,
      disappearedListings: 0,
      totalPriceDrops: 0,
      lastScanAt: null,
      lastArchiveAt: null,
      archiveSegmentCount: 0
    },
    archive: createArchiveMetadata()
  };
}

function normalizeHistoryRetentionPolicy(policy = {}, env = process.env) {
  const base = {
    ...DEFAULT_HISTORY_RETENTION_POLICY,
    ...policy
  };

  return Object.freeze({
    maxActiveHistoryRecords: toPositiveInteger(
      env.CARDHAWK_MAX_ACTIVE_HISTORY_RECORDS ?? base.maxActiveHistoryRecords,
      DEFAULT_HISTORY_RETENTION_POLICY.maxActiveHistoryRecords
    ),
    maxInactiveHistoryAgeDays: toOptionalPositiveInteger(
      env.CARDHAWK_MAX_INACTIVE_HISTORY_AGE_DAYS ?? base.maxInactiveHistoryAgeDays,
      DEFAULT_HISTORY_RETENTION_POLICY.maxInactiveHistoryAgeDays
    ),
    minProtectedHistoryRecords: toPositiveInteger(
      env.CARDHAWK_MIN_PROTECTED_HISTORY_RECORDS ?? base.minProtectedHistoryRecords,
      DEFAULT_HISTORY_RETENTION_POLICY.minProtectedHistoryRecords
    ),
    archiveSegmentRecordLimit: toPositiveInteger(
      base.archiveSegmentRecordLimit,
      DEFAULT_HISTORY_RETENTION_POLICY.archiveSegmentRecordLimit
    )
  });
}

function normalizeHistory(parsed = {}) {
  const empty = createEmptyHistory();
  const archive = createArchiveMetadata(parsed.archive || {});

  return {
    ...empty,
    ...parsed,
    version: HISTORY_SCHEMA_VERSION,
    listings: isObject(parsed.listings) ? parsed.listings : {},
    scans: Array.isArray(parsed.scans) ? parsed.scans.slice(0, MAX_SCAN_RECORDS) : [],
    stats: {
      ...empty.stats,
      ...(isObject(parsed.stats) ? parsed.stats : {})
    },
    archive
  };
}

function loadActiveHistoryFile() {
  ensureHistoryFile();
  return normalizeHistory(stateStore.loadJsonState(historyFilePath, createEmptyHistory()));
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

function createPricePoint(listing, observedAt, scanId) {
  return {
    observedAt,
    scanId,
    price: roundMoney(listing.price),
    shipping: roundMoney(listing.shipping),
    totalCost: roundMoney(listing.totalCost)
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
    record.priceHistory = Array.isArray(record.priceHistory) ? record.priceHistory : [];
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

    record.priceDrops = Array.isArray(record.priceDrops) ? record.priceDrops : [];
    record.priceDrops.unshift(priceDrop);
    record.priceDrops = record.priceDrops.slice(0, MAX_PRICE_DROPS_PER_LISTING);
  }

  return { record, priceDrop, isNew: false };
}

function isActiveRecord(record = {}) {
  return String(record.status || "").toLowerCase() === "active";
}

function isInactiveRecord(record = {}) {
  return !isActiveRecord(record);
}

function getRecordTimestamp(record = {}) {
  return Math.max(
    parseTime(record.lastSeenAt),
    parseTime(record.disappearedAt),
    parseTime(record.firstSeenAt)
  );
}

function getRecordId(key, record = {}) {
  return String(record.ebayItemId || record.listingId || record.marketplaceListingId || key || "");
}

function sortOldestFirst(a, b) {
  if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
  return a.recordId.localeCompare(b.recordId) || a.key.localeCompare(b.key);
}

function sortNewestFirst(a, b) {
  if (b.timestamp !== a.timestamp) return b.timestamp - a.timestamp;
  return a.recordId.localeCompare(b.recordId) || a.key.localeCompare(b.key);
}

function buildRetentionEntries(history = {}, now = new Date(), policy = normalizeHistoryRetentionPolicy()) {
  const nowMs = parseTime(now);
  const entries = Object.entries(history.listings || {}).map(([key, record]) => {
    const timestamp = getRecordTimestamp(record);
    return {
      key,
      record,
      recordId: getRecordId(key, record),
      timestamp,
      active: isActiveRecord(record),
      inactive: isInactiveRecord(record),
      ageDays: timestamp > 0 && nowMs > 0 ? Math.max(0, Math.floor((nowMs - timestamp) / 86_400_000)) : null,
      protectedNewest: false,
      archiveReasons: []
    };
  });

  const newest = entries.slice().sort(sortNewestFirst);
  const protectedKeys = new Set(newest.slice(0, Math.min(policy.minProtectedHistoryRecords, newest.length)).map((entry) => entry.key));
  for (const entry of entries) {
    if (protectedKeys.has(entry.key)) {
      entry.protectedNewest = true;
      entry.archiveReasons.push("protected_newest_history_window");
    }
  }

  return entries;
}

function chooseArchiveEntries(history = {}, policy = normalizeHistoryRetentionPolicy(), options = {}) {
  const now = options.now || new Date();
  const entries = buildRetentionEntries(history, now, policy);
  const archiveKeys = new Set();

  if (policy.maxInactiveHistoryAgeDays !== null) {
    for (const entry of entries.filter((item) => item.inactive && !item.protectedNewest).sort(sortOldestFirst)) {
      if (entry.ageDays !== null && entry.ageDays > policy.maxInactiveHistoryAgeDays) {
        entry.archiveReasons.push("inactive_history_age_limit_exceeded");
        archiveKeys.add(entry.key);
      }
    }
  }

  let projectedCount = entries.length - archiveKeys.size;
  if (projectedCount > policy.maxActiveHistoryRecords) {
    const inactiveCandidates = entries
      .filter((entry) => entry.inactive && !entry.protectedNewest && !archiveKeys.has(entry.key))
      .sort(sortOldestFirst);

    for (const entry of inactiveCandidates) {
      if (projectedCount <= policy.maxActiveHistoryRecords) break;
      entry.archiveReasons.push("active_history_record_cap_exceeded");
      archiveKeys.add(entry.key);
      projectedCount -= 1;
    }
  }

  if (projectedCount > policy.maxActiveHistoryRecords) {
    const activeCandidates = entries
      .filter((entry) => entry.active && !entry.protectedNewest && !archiveKeys.has(entry.key))
      .sort(sortOldestFirst);

    for (const entry of activeCandidates) {
      if (projectedCount <= policy.maxActiveHistoryRecords) break;
      entry.archiveReasons.push("active_history_record_cap_exceeded_after_inactive_records");
      archiveKeys.add(entry.key);
      projectedCount -= 1;
    }
  }

  const archiveEntries = entries.filter((entry) => archiveKeys.has(entry.key)).sort(sortOldestFirst);
  const retainedEntries = entries.filter((entry) => !archiveKeys.has(entry.key)).sort((a, b) => a.key.localeCompare(b.key));
  const capExceeded = retainedEntries.length > policy.maxActiveHistoryRecords;

  return {
    archiveEntries,
    retainedEntries,
    capExceeded,
    totalBefore: entries.length,
    totalAfter: retainedEntries.length,
    warnings: capExceeded ? ["active_history_cap_not_met_because_protected_records_exceed_cap"] : []
  };
}

function buildArchiveSegment(records = [], context = {}) {
  const recordEntries = records.map((entry) => [entry.recordId, entry.record]);
  const segmentRecords = Object.fromEntries(recordEntries);
  const fingerprint = buildFingerprint(segmentRecords);
  const segmentId = `history-archive-${fingerprint.slice(0, 16)}`;

  return {
    source: "history_archive_segment",
    schemaVersion: ARCHIVE_SEGMENT_SCHEMA_VERSION,
    segmentId,
    createdAt: context.createdAt || nowIso(),
    archiveReason: context.archiveReason || "active_history_retention",
    recordCount: records.length,
    firstListingId: records[0]?.recordId || null,
    lastListingId: records[records.length - 1]?.recordId || null,
    fingerprint,
    records: segmentRecords
  };
}

function writeArchiveSegments(archiveEntries = [], policy = normalizeHistoryRetentionPolicy(), context = {}) {
  if (!archiveEntries.length) return [];
  ensureDirectory(archiveDirectoryPath);

  const createdAt = context.createdAt || nowIso();
  const segments = [];
  const limit = policy.archiveSegmentRecordLimit;

  for (let index = 0; index < archiveEntries.length; index += limit) {
    const chunk = archiveEntries.slice(index, index + limit);
    const segment = buildArchiveSegment(chunk, {
      createdAt,
      archiveReason: context.archiveReason || "active_history_retention"
    });
    const fileName = `${segment.segmentId}.json`;
    const filePath = path.join(archiveDirectoryPath, fileName);

    if (!fs.existsSync(filePath)) {
      writeJsonAtomic(filePath, segment);
    }

    const stat = fs.existsSync(filePath) ? fs.statSync(filePath) : { size: 0 };
    segments.push({
      segmentId: segment.segmentId,
      fileName,
      recordCount: segment.recordCount,
      firstListingId: segment.firstListingId,
      lastListingId: segment.lastListingId,
      fingerprint: segment.fingerprint,
      archivedAt: createdAt,
      byteSize: stat.size
    });
  }

  return segments;
}

function mergeArchiveMetadata(archive = createArchiveMetadata(), segmentMetadata = [], archiveEntries = [], archivedAt = nowIso()) {
  const next = createArchiveMetadata(archive);
  const existing = new Set(next.segments.map((segment) => segment.segmentId));
  let newRecordCount = 0;
  let newDisappearedCount = 0;
  let newPriceDropCount = 0;

  for (const segment of segmentMetadata) {
    if (existing.has(segment.segmentId)) continue;
    existing.add(segment.segmentId);
    next.segments.push(segment);
    newRecordCount += toNumber(segment.recordCount);
  }

  if (newRecordCount > 0) {
    const archivedRecords = archiveEntries.map((entry) => entry.record);
    newDisappearedCount = archivedRecords.filter((record) => String(record.status || "").toLowerCase() === "disappeared").length;
    newPriceDropCount = archivedRecords.reduce((sum, record) => sum + (Array.isArray(record.priceDrops) ? record.priceDrops.length : 0), 0);
    next.archivedRecordCount += newRecordCount;
    next.archivedDisappearedCount += newDisappearedCount;
    next.archivedPriceDropCount += newPriceDropCount;
    next.lastArchiveAt = archivedAt;
  }

  next.segmentCount = next.segments.length;
  return next;
}

function refreshStats(history) {
  let activeListings = 0;
  let disappearedInActiveSet = 0;
  let priceDropsInActiveSet = 0;
  let activeRecordCount = 0;

  for (const listing of Object.values(history.listings || {})) {
    activeRecordCount += 1;
    if (listing.status === "active") activeListings += 1;
    if (listing.status === "disappeared") disappearedInActiveSet += 1;
    priceDropsInActiveSet += Array.isArray(listing.priceDrops) ? listing.priceDrops.length : 0;
  }

  const archive = createArchiveMetadata(history.archive || {});
  history.archive = archive;
  history.stats = {
    totalListingsTracked: activeRecordCount + archive.archivedRecordCount,
    activeRecordCount,
    archivedRecordCount: archive.archivedRecordCount,
    activeListings,
    disappearedListings: disappearedInActiveSet + archive.archivedDisappearedCount,
    totalPriceDrops: priceDropsInActiveSet + archive.archivedPriceDropCount,
    lastScanAt: history.scans?.[0]?.finishedAt || history.stats?.lastScanAt || null,
    lastArchiveAt: archive.lastArchiveAt,
    archiveSegmentCount: archive.segmentCount
  };

  return history.stats;
}

function applyRetentionAndArchive(history, options = {}) {
  const policy = normalizeHistoryRetentionPolicy(options.policy, options.env || process.env);
  const retention = chooseArchiveEntries(history, policy, options);

  if (!retention.archiveEntries.length) {
    refreshStats(history);
    return { history, retention, archiveSegments: [] };
  }

  const archivedAt = options.nowIso || nowIso();
  const archiveSegments = writeArchiveSegments(retention.archiveEntries, policy, {
    createdAt: archivedAt,
    archiveReason: options.archiveReason
  });

  const nextListings = {};
  for (const entry of retention.retainedEntries) {
    nextListings[entry.key] = entry.record;
  }

  history.listings = nextListings;
  history.archive = mergeArchiveMetadata(history.archive, archiveSegments, retention.archiveEntries, archivedAt);
  refreshStats(history);

  return { history, retention, archiveSegments };
}

function saveActiveHistory(history) {
  history.updatedAt = nowIso();
  refreshStats(history);
  writeJsonAtomic(historyFilePath, history);
}

function loadHistory(options = {}) {
  try {
    const history = loadActiveHistoryFile();
    if (options.applyRetention === false) {
      refreshStats(history);
      return history;
    }

    const beforeCount = Object.keys(history.listings || {}).length;
    const result = applyRetentionAndArchive(history, {
      policy: options.policy,
      env: options.env,
      now: options.now,
      archiveReason: "legacy_history_migration"
    });

    if (result.retention.archiveEntries.length || beforeCount !== Object.keys(result.history.listings || {}).length) {
      saveActiveHistory(result.history);
    }

    return result.history;
  } catch (error) {
    console.error("History Engine failed to load history file:", error.message);
    return createEmptyHistory();
  }
}

function saveHistory(history, options = {}) {
  const normalized = normalizeHistory(history);
  const result = applyRetentionAndArchive(normalized, {
    policy: options.policy,
    env: options.env,
    now: options.now,
    archiveReason: options.archiveReason || "history_save_retention"
  });
  saveActiveHistory(result.history);
}

function recordScan(listings, options = {}) {
  if (!Array.isArray(listings)) {
    throw new TypeError("historyEngine.recordScan expected an array of listings");
  }

  const history = loadHistory({
    policy: options.retentionPolicy,
    env: options.env,
    now: options.now
  });
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

  const retentionResult = applyRetentionAndArchive(history, {
    policy: options.retentionPolicy,
    env: options.env,
    now: options.now,
    archiveReason: "record_scan_retention"
  });
  saveActiveHistory(retentionResult.history);

  return {
    scanId,
    observedCount: seenIds.size,
    trackedCount: retentionResult.history.stats.totalListingsTracked,
    activeCount: retentionResult.history.stats.activeListings,
    newListings,
    updatedListings,
    priceDrops,
    disappeared,
    stats: retentionResult.history.stats,
    archive: {
      archivedCount: retentionResult.retention.archiveEntries.length,
      segmentCount: retentionResult.archiveSegments.length,
      capExceeded: retentionResult.retention.capExceeded,
      warnings: retentionResult.retention.warnings
    }
  };
}

function readArchiveSegment(metadata = {}) {
  if (!metadata.fileName) return null;
  const filePath = path.join(archiveDirectoryPath, metadata.fileName);
  if (!fs.existsSync(filePath)) return null;
  return stateStore.loadJsonState(filePath, null);
}

function readArchiveSegmentsUntil(predicate, limit = 1) {
  const history = loadHistory({ applyRetention: false });
  const matches = [];
  const segments = (history.archive?.segments || []).slice().reverse();

  for (const metadata of segments) {
    const segment = readArchiveSegment(metadata);
    if (!segment?.records) continue;
    for (const record of Object.values(segment.records)) {
      if (!predicate(record)) continue;
      matches.push(record);
      if (matches.length >= limit) return matches;
    }
  }

  return matches;
}

function getListing(ebayItemId) {
  const history = loadHistory();
  const id = String(ebayItemId);
  if (history.listings[id]) return history.listings[id];
  return readArchiveSegmentsUntil((record) => getRecordId(record.ebayItemId, record) === id, 1)[0] || null;
}

function sortByDateDesc(field) {
  return (a, b) => new Date(b[field] || 0) - new Date(a[field] || 0);
}

function getActiveListings(limit = 100) {
  const history = loadHistory();
  return Object.values(history.listings)
    .filter((listing) => listing.status === "active")
    .sort(sortByDateDesc("lastSeenAt"))
    .slice(0, limit);
}

function collectPriceDrops(records = [], filters = {}) {
  const lane = filters.lane || null;
  return records
    .flatMap((listing) => (listing.priceDrops || []).map((drop) => ({ ...drop, lane: listing.lane })))
    .filter((drop) => !lane || drop.lane === lane);
}

function getDisappearedListingsFromActiveHistory(history = {}, limit = 100) {
  return Object.values(history.listings || {})
    .filter((listing) => listing.status === "disappeared")
    .sort(sortByDateDesc("disappearedAt"))
    .slice(0, limit);
}

function getPriceDropsFromActiveHistory(history = {}, filters = {}, limit = 100) {
  return collectPriceDrops(Object.values(history.listings || {}), filters)
    .sort(sortByDateDesc("detectedAt"))
    .slice(0, limit);
}

function getDisappearedListings(limit = 100) {
  const history = loadHistory();
  const activeMatches = getDisappearedListingsFromActiveHistory(history, limit);

  if (activeMatches.length >= limit) return activeMatches.slice(0, limit);

  const archiveMatches = readArchiveSegmentsUntil(
    (listing) => listing.status === "disappeared",
    limit - activeMatches.length
  ).sort(sortByDateDesc("disappearedAt"));

  return [...activeMatches, ...archiveMatches]
    .sort(sortByDateDesc("disappearedAt"))
    .slice(0, limit);
}

function getPriceDrops(filters = {}, limit = 100) {
  const history = loadHistory();
  const activeDrops = getPriceDropsFromActiveHistory(history, filters, limit);
  if (activeDrops.length >= limit) {
    return activeDrops.sort(sortByDateDesc("detectedAt")).slice(0, limit);
  }

  const archiveRecords = readArchiveSegmentsUntil(
    (listing) => Array.isArray(listing.priceDrops) && listing.priceDrops.length > 0,
    limit
  );
  return [...activeDrops, ...collectPriceDrops(archiveRecords, filters)]
    .sort(sortByDateDesc("detectedAt"))
    .slice(0, limit);
}

function summarizeHistory() {
  const history = loadHistory();
  refreshStats(history);

  return {
    stats: history.stats,
    archive: history.archive,
    recentScans: history.scans.slice(0, 10),
    recentPriceDrops: getPriceDropsFromActiveHistory(history, {}, 10),
    recentDisappeared: getDisappearedListingsFromActiveHistory(history, 10)
  };
}

function __setHistoryStorageForTests(options = {}) {
  historyFilePath = options.historyFile || DEFAULT_HISTORY_FILE;
  archiveDirectoryPath = options.archiveDir || DEFAULT_ARCHIVE_DIR;
}

function __resetHistoryStorageForTests() {
  historyFilePath = DEFAULT_HISTORY_FILE;
  archiveDirectoryPath = DEFAULT_ARCHIVE_DIR;
}

module.exports = {
  ARCHIVE_SEGMENT_SCHEMA_VERSION,
  DEFAULT_HISTORY_RETENTION_POLICY,
  HISTORY_SCHEMA_VERSION,
  createEmptyHistory,
  getActiveListings,
  getDisappearedListings,
  getListing,
  getPriceDrops,
  loadHistory,
  normalizeHistoryRetentionPolicy,
  recordScan,
  saveHistory,
  summarizeHistory,
  __resetHistoryStorageForTests,
  __setHistoryStorageForTests
};
