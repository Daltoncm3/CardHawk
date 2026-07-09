'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_STORE_FILE = path.join(__dirname, '..', 'data', 'cardhawk-data.json');
const DECISION_INPUT_FIELDS = [
  'evidenceSufficiency',
  'listingSimilarity',
  'comparableQuality',
  'valuationRange',
  'supplyPressure'
];

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJsonFile(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function toTimestamp(value) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function sortByNewestListing(a, b) {
  return (
    (toTimestamp(b.lastSeenAt) || toTimestamp(b.createdAt) || 0) -
    (toTimestamp(a.lastSeenAt) || toTimestamp(a.createdAt) || 0)
  );
}

function getListings(store = {}) {
  return Object.values(asObject(store.listings)).filter((listing) => listing && typeof listing === 'object');
}

function getLatestScan(store = {}) {
  return asArray(store.scans)
    .filter((scan) => scan && typeof scan === 'object')
    .find((scan) => ['completed', 'rate_limited', 'failed'].includes(String(scan.status || '').toLowerCase())) || null;
}

function isWithinScanWindow(listing = {}, scan = {}) {
  const lastSeen = toTimestamp(listing.lastSeenAt);
  const startedAt = toTimestamp(scan.startedAt);
  const finishedAt = toTimestamp(scan.finishedAt);

  if (!lastSeen || !startedAt || !finishedAt) return false;
  return lastSeen >= startedAt && lastSeen <= finishedAt;
}

function selectListings(store = {}, options = {}) {
  const limit = Number.isFinite(Number(options.limit)) && Number(options.limit) > 0
    ? Number(options.limit)
    : 100;
  const listings = getListings(store);
  const latestScan = getLatestScan(store);
  const since = toTimestamp(options.since);

  if (options.all) {
    return {
      listings: listings.slice().sort(sortByNewestListing).slice(0, limit),
      strategy: 'all_recent',
      scan: latestScan,
      warnings: []
    };
  }

  if (since) {
    return {
      listings: listings
        .filter((listing) => {
          const lastSeen = toTimestamp(listing.lastSeenAt);
          return lastSeen && lastSeen >= since;
        })
        .sort(sortByNewestListing)
        .slice(0, limit),
      strategy: 'since_timestamp',
      scan: latestScan,
      warnings: []
    };
  }

  if (latestScan && toTimestamp(latestScan.startedAt) && toTimestamp(latestScan.finishedAt)) {
    const scanListings = listings
      .filter((listing) => isWithinScanWindow(listing, latestScan))
      .sort(sortByNewestListing)
      .slice(0, limit);

    return {
      listings: scanListings,
      strategy: 'latest_scan_window',
      scan: latestScan,
      warnings: scanListings.length
        ? []
        : ['No listings matched the latest scan timestamp window; export is empty.']
    };
  }

  return {
    listings: listings.slice().sort(sortByNewestListing).slice(0, limit),
    strategy: 'newest_listings_fallback',
    scan: latestScan,
    warnings: ['Latest scan window is unavailable or has invalid timestamps; exported newest listings by lastSeenAt.']
  };
}

function getEvidenceSources(listing = {}) {
  return [
    listing,
    listing.marketIntelligenceData,
    listing.marketIntelligence,
    listing.intelligence,
    listing.scoring && listing.scoring.marketIntelligenceData,
    listing.scoring && listing.scoring.marketIntelligence,
    listing.scoring && listing.scoring.intelligence
  ].map(asObject);
}

function pickEvidence(listing = {}, field) {
  for (const source of getEvidenceSources(listing)) {
    if (source[field] && typeof source[field] === 'object') return source[field];
  }

  return null;
}

function buildEvidenceAvailability(listing = {}) {
  const availability = {};
  const missing = [];

  for (const field of DECISION_INPUT_FIELDS) {
    const available = Boolean(pickEvidence(listing, field));
    availability[field] = available;
    if (!available) missing.push(field);
  }

  return {
    ...availability,
    complete: missing.length === 0,
    missing
  };
}

function compactListing(listing = {}) {
  const exported = {
    ebayItemId: listing.ebayItemId || listing.itemId || listing.listingId || listing.id || null,
    itemId: listing.itemId || listing.ebayItemId || listing.listingId || listing.id || null,
    title: listing.title || listing.name || '',
    url: listing.url || listing.itemWebUrl || listing.listingUrl || '',
    image: listing.image || listing.imageUrl || null,
    marketplace: listing.marketplace || listing.platform || listing.source || 'ebay',
    lane: listing.lane || '',
    query: listing.query || '',
    price: listing.price ?? listing.currentPrice ?? listing.listPrice ?? null,
    shipping: listing.shipping ?? null,
    totalCost: listing.totalCost ?? null,
    firstSeenAt: listing.firstSeenAt || null,
    lastSeenAt: listing.lastSeenAt || null,
    seenCount: listing.seenCount || 0,
    score: listing.score ?? null,
    estimatedValue: listing.estimatedValue ?? null,
    estimatedProfit: listing.estimatedProfit ?? null,
    roi: listing.roi ?? null,
    compCount: listing.compCount ?? null,
    compSource: listing.compSource || '',
    compData: listing.compData || null,
    qualityData: listing.qualityData || null,
    dealGate: listing.dealGate || null,
    parsed: listing.parsed || null,
    evidenceAvailability: buildEvidenceAvailability(listing)
  };

  for (const field of DECISION_INPUT_FIELDS) {
    const evidence = pickEvidence(listing, field);
    if (evidence) exported[field] = evidence;
  }

  if (listing.marketIntelligenceData && typeof listing.marketIntelligenceData === 'object') {
    exported.marketIntelligenceData = listing.marketIntelligenceData;
  }

  return exported;
}

function buildSelectionMetadata(selection = {}) {
  const scan = selection.scan || {};

  return {
    strategy: selection.strategy || 'unknown',
    scanId: scan.id || null,
    source: scan.source || null,
    status: scan.status || null,
    startedAt: scan.startedAt || null,
    finishedAt: scan.finishedAt || null,
    listingsFound: scan.listingsFound ?? null,
    newAlerts: scan.newAlerts ?? null
  };
}

function buildScanExport(store = {}, options = {}) {
  const selection = selectListings(store, options);
  const exportedListings = selection.listings.map(compactListing);
  const missingEvidenceCount = exportedListings.filter((listing) => !listing.evidenceAvailability.complete).length;

  return {
    source: 'cardhawk_scan_export',
    mode: 'offline_validation_input',
    exportedAt: options.exportedAt || new Date().toISOString(),
    inputStore: options.inputStore ? path.resolve(options.inputStore) : null,
    selection: buildSelectionMetadata(selection),
    listingCount: exportedListings.length,
    missingEvidenceCount,
    warnings: selection.warnings || [],
    listings: exportedListings
  };
}

function exportScanResults(inputFile = DEFAULT_STORE_FILE, outputFile, options = {}) {
  const store = readJsonFile(inputFile);
  const report = buildScanExport(store, {
    ...options,
    inputStore: inputFile
  });

  if (outputFile) {
    writeJsonFile(outputFile, report);
  }

  return report;
}

function parseArgs(argv = []) {
  const options = {};
  const positional = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--all') {
      options.all = true;
    } else if (arg === '--limit') {
      options.limit = Number(argv[index + 1]);
      index += 1;
    } else if (arg === '--since') {
      options.since = argv[index + 1];
      index += 1;
    } else if (arg === '--store') {
      options.inputFile = argv[index + 1];
      index += 1;
    } else if (arg === '--out') {
      options.outputFile = argv[index + 1];
      index += 1;
    } else {
      positional.push(arg);
    }
  }

  return {
    inputFile: options.inputFile || positional[0] || DEFAULT_STORE_FILE,
    outputFile: options.outputFile || positional[1] || null,
    options
  };
}

function main(argv = process.argv.slice(2)) {
  const parsed = parseArgs(argv);
  const report = exportScanResults(parsed.inputFile, parsed.outputFile, parsed.options);

  if (!parsed.outputFile) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  buildEvidenceAvailability,
  buildScanExport,
  compactListing,
  exportScanResults,
  getLatestScan,
  selectListings
};
