'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const historyEngine = require('../engines/historyEngine');

function makeTempHistory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cardhawk-history-'));
  const historyFile = path.join(directory, 'listingHistory.json');
  const archiveDir = path.join(directory, 'history-archive');
  historyEngine.__setHistoryStorageForTests({ historyFile, archiveDir });
  return { directory, historyFile, archiveDir };
}

function record(id, overrides = {}) {
  const status = overrides.status || 'disappeared';
  const lastSeenAt = overrides.lastSeenAt || '2026-01-01T00:00:00.000Z';
  return {
    ebayItemId: id,
    title: `History Record ${id}`,
    lane: overrides.lane || 'baseball',
    query: 'history test',
    condition: 'Used',
    url: `https://example.invalid/${id}`,
    image: '',
    sellerUsername: 'seller',
    parsed: { player: `Player ${id}` },
    firstSeenAt: overrides.firstSeenAt || lastSeenAt,
    lastSeenAt,
    disappearedAt: status === 'disappeared' ? (overrides.disappearedAt || lastSeenAt) : null,
    status,
    likelySoldOrEnded: status !== 'active',
    seenCount: 1,
    scansSurvived: 1,
    firstPrice: 20,
    currentPrice: overrides.currentPrice || 20,
    lowestPrice: 20,
    highestPrice: 25,
    lastScore: 70,
    lastEstimatedProfit: 5,
    lastRoi: 0.25,
    priceHistory: overrides.priceHistory || [{
      observedAt: lastSeenAt,
      scanId: 'scan-fixture',
      price: 18,
      shipping: 2,
      totalCost: 20
    }],
    priceDrops: overrides.priceDrops || []
  };
}

function legacyHistory(records) {
  return {
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    listings: Object.fromEntries(records.map((entry) => [entry.ebayItemId, entry])),
    scans: [],
    stats: {
      totalListingsTracked: records.length,
      activeListings: records.filter((entry) => entry.status === 'active').length,
      disappearedListings: records.filter((entry) => entry.status === 'disappeared').length,
      totalPriceDrops: records.reduce((sum, entry) => sum + entry.priceDrops.length, 0),
      lastScanAt: null
    }
  };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function archiveFiles(archiveDir) {
  return fs.existsSync(archiveDir)
    ? fs.readdirSync(archiveDir).filter((name) => name.endsWith('.json')).sort()
    : [];
}

test.afterEach(() => {
  historyEngine.__resetHistoryStorageForTests();
});

test('legacy history migration keeps active working set bounded and archives inactive records first', () => {
  const { historyFile, archiveDir } = makeTempHistory();
  const records = [];
  for (let index = 0; index < 12; index += 1) {
    records.push(record(`gone-${index}`, {
      status: 'disappeared',
      lastSeenAt: `2026-01-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`
    }));
  }
  for (let index = 0; index < 4; index += 1) {
    records.push(record(`active-${index}`, {
      status: 'active',
      lastSeenAt: `2026-02-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`
    }));
  }
  fs.writeFileSync(historyFile, JSON.stringify(legacyHistory(records), null, 2));

  const loaded = historyEngine.loadHistory({
    env: {
      CARDHAWK_MAX_ACTIVE_HISTORY_RECORDS: '8',
      CARDHAWK_MIN_PROTECTED_HISTORY_RECORDS: '2',
      CARDHAWK_MAX_INACTIVE_HISTORY_AGE_DAYS: ''
    }
  });

  assert.equal(Object.keys(loaded.listings).length, 4);
  assert.equal(loaded.stats.totalListingsTracked, 16);
  assert.equal(loaded.stats.archivedRecordCount, 12);
  assert.equal(loaded.stats.archiveSegmentCount, 1);
  assert.equal(Object.values(loaded.listings).filter((entry) => entry.status === 'active').length, 4);
  assert.equal(archiveFiles(archiveDir).length, 1);

  const activeFile = readJson(historyFile);
  assert.equal(Object.keys(activeFile.listings).length, 4);
  assert.equal(activeFile.archive.archivedRecordCount, 12);
});

test('archive segments preserve identity, price history, and price drops for exact lookup', () => {
  const { historyFile, archiveDir } = makeTempHistory();
  const archivedDrop = {
    ebayItemId: 'gone-1',
    title: 'History Record gone-1',
    lane: 'baseball',
    fromPrice: 30,
    toPrice: 20,
    amountDropped: 10,
    percentDropped: 33.33,
    detectedAt: '2026-01-02T00:00:00.000Z',
    scanId: 'scan-fixture'
  };
  const records = [
    record('gone-1', { status: 'disappeared', priceDrops: [archivedDrop] }),
    record('gone-2', { status: 'disappeared' }),
    record('active-1', { status: 'active', lastSeenAt: '2026-03-01T00:00:00.000Z' })
  ];
  fs.writeFileSync(historyFile, JSON.stringify(legacyHistory(records), null, 2));

  historyEngine.loadHistory({
    env: {
      CARDHAWK_MAX_ACTIVE_HISTORY_RECORDS: '1',
      CARDHAWK_MIN_PROTECTED_HISTORY_RECORDS: '1',
      CARDHAWK_MAX_INACTIVE_HISTORY_AGE_DAYS: ''
    }
  });

  const segment = readJson(path.join(archiveDir, archiveFiles(archiveDir)[0]));
  assert.equal(segment.source, 'history_archive_segment');
  assert.equal(segment.schemaVersion, 1);
  assert.ok(segment.records['gone-1']);
  assert.deepEqual(segment.records['gone-1'].priceDrops, [archivedDrop]);
  assert.equal(segment.records['gone-1'].priceHistory.length, 1);

  const archived = historyEngine.getListing('gone-1');
  assert.equal(archived.ebayItemId, 'gone-1');
  assert.deepEqual(archived.priceDrops, [archivedDrop]);
});

test('archive segment names are deterministic and repeated loads do not duplicate archival', () => {
  const { historyFile, archiveDir } = makeTempHistory();
  const records = Array.from({ length: 10 }, (_, index) => record(`gone-${index}`, {
    status: 'disappeared',
    lastSeenAt: `2026-01-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`
  }));
  fs.writeFileSync(historyFile, JSON.stringify(legacyHistory(records), null, 2));

  const env = {
    CARDHAWK_MAX_ACTIVE_HISTORY_RECORDS: '4',
    CARDHAWK_MIN_PROTECTED_HISTORY_RECORDS: '1',
    CARDHAWK_MAX_INACTIVE_HISTORY_AGE_DAYS: ''
  };
  historyEngine.loadHistory({ env });
  const firstFiles = archiveFiles(archiveDir);
  const firstHistory = readJson(historyFile);

  historyEngine.loadHistory({ env });
  const secondFiles = archiveFiles(archiveDir);
  const secondHistory = readJson(historyFile);

  assert.deepEqual(secondFiles, firstFiles);
  assert.equal(secondHistory.archive.archivedRecordCount, firstHistory.archive.archivedRecordCount);
  assert.equal(secondHistory.archive.segmentCount, firstHistory.archive.segmentCount);
});

test('recordScan writes bounded active history and never one unbounded history payload', () => {
  const { historyFile } = makeTempHistory();
  const records = Array.from({ length: 60 }, (_, index) => record(`gone-${index}`, {
    status: 'disappeared',
    lastSeenAt: `2026-01-${String((index % 28) + 1).padStart(2, '0')}T00:00:00.000Z`
  }));
  fs.writeFileSync(historyFile, JSON.stringify(legacyHistory(records), null, 2));

  const writes = [];
  const originalWrite = fs.writeFileSync;
  fs.writeFileSync = function patchedWriteFileSync(filePath, data, ...args) {
    if (String(filePath).includes('listingHistory') || String(filePath).includes('history-archive')) {
      const text = String(data);
      const parsed = JSON.parse(text);
      const recordCount = parsed.records
        ? Object.keys(parsed.records).length
        : Object.keys(parsed.listings || {}).length;
      writes.push({ filePath: String(filePath), recordCount, byteLength: Buffer.byteLength(text) });
    }
    return originalWrite.call(this, filePath, data, ...args);
  };

  try {
    historyEngine.recordScan([{
      ebayItemId: 'new-active',
      title: 'New Active Listing',
      lane: 'baseball',
      price: 20,
      shipping: 2,
      totalCost: 22
    }], {
      scanId: 'scan-bounded',
      observedAt: '2026-07-21T00:00:00.000Z',
      env: {
        CARDHAWK_MAX_ACTIVE_HISTORY_RECORDS: '10',
        CARDHAWK_MIN_PROTECTED_HISTORY_RECORDS: '1',
        CARDHAWK_MAX_INACTIVE_HISTORY_AGE_DAYS: ''
      },
      retentionPolicy: {
        archiveSegmentRecordLimit: 10
      }
    });
  } finally {
    fs.writeFileSync = originalWrite;
  }

  assert.ok(writes.length > 0);
  assert.ok(writes.every((write) => write.recordCount <= 10), writes);
  const activeFile = readJson(historyFile);
  assert.ok(Object.keys(activeFile.listings).length <= 10);
  assert.equal(activeFile.stats.totalListingsTracked, 61);
  assert.equal(activeFile.archive.archivedRecordCount, 51);
});

test('normal bounded scans do not load archive segments and remain bounded over repetition', () => {
  const { historyFile, archiveDir } = makeTempHistory();
  const records = Array.from({ length: 14 }, (_, index) => record(`gone-${index}`, {
    status: 'disappeared',
    lastSeenAt: `2026-01-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`
  }));
  fs.writeFileSync(historyFile, JSON.stringify(legacyHistory(records), null, 2));
  const env = {
    CARDHAWK_MAX_ACTIVE_HISTORY_RECORDS: '5',
    CARDHAWK_MIN_PROTECTED_HISTORY_RECORDS: '1',
    CARDHAWK_MAX_INACTIVE_HISTORY_AGE_DAYS: ''
  };
  historyEngine.loadHistory({ env });
  const files = archiveFiles(archiveDir);
  assert.ok(files.length > 0);

  const originalRead = fs.readFileSync;
  const archiveReads = [];
  fs.readFileSync = function patchedReadFileSync(filePath, ...args) {
    if (String(filePath).includes('history-archive')) archiveReads.push(String(filePath));
    return originalRead.call(this, filePath, ...args);
  };

  try {
    for (let index = 0; index < 3; index += 1) {
      historyEngine.recordScan([{
        ebayItemId: `active-${index}`,
        title: `Active ${index}`,
        lane: 'baseball',
        price: 20 + index,
        shipping: 2,
        totalCost: 22 + index
      }], {
        scanId: `scan-${index}`,
        observedAt: `2026-07-2${index}T00:00:00.000Z`,
        env
      });
    }
  } finally {
    fs.readFileSync = originalRead;
  }

  assert.deepEqual(archiveReads, []);
  const activeFile = readJson(historyFile);
  assert.ok(Object.keys(activeFile.listings).length <= 5);
  assert.equal(activeFile.stats.totalListingsTracked, 17);
});

test('public history summary exposes active stats plus archive counters with compatible shape', () => {
  const { historyFile } = makeTempHistory();
  const records = [
    record('gone-1', { status: 'disappeared' }),
    record('gone-2', { status: 'disappeared' }),
    record('active-1', { status: 'active', lastSeenAt: '2026-04-01T00:00:00.000Z' })
  ];
  fs.writeFileSync(historyFile, JSON.stringify(legacyHistory(records), null, 2));

  historyEngine.loadHistory({
    env: {
      CARDHAWK_MAX_ACTIVE_HISTORY_RECORDS: '1',
      CARDHAWK_MIN_PROTECTED_HISTORY_RECORDS: '1',
      CARDHAWK_MAX_INACTIVE_HISTORY_AGE_DAYS: ''
    }
  });

  const summary = historyEngine.summarizeHistory();
  assert.ok(summary.stats);
  assert.ok(Array.isArray(summary.recentScans));
  assert.ok(Array.isArray(summary.recentPriceDrops));
  assert.ok(Array.isArray(summary.recentDisappeared));
  assert.ok(summary.archive);
  assert.equal(summary.stats.totalListingsTracked, 3);
  assert.equal(summary.stats.activeRecordCount, 1);
  assert.equal(summary.stats.archivedRecordCount, 2);
  assert.equal(summary.stats.archiveSegmentCount, 1);
});
