'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { createScoutScanner } = require('../services/scoutScannerService');
const { createPersistenceCoordinator } = require('../utils/persistenceCoordinator');

function createCoordinator() {
  const calls = [];
  const coordinator = createPersistenceCoordinator({
    now: (() => {
      let tick = 0;
      return () => `2026-07-17T00:00:0${tick++}.000Z`;
    })(),
    idPrefix: 'test-batch',
    persist: (metadata) => {
      calls.push(JSON.parse(JSON.stringify(metadata)));
      return { ok: true, persisted: calls.length };
    }
  });

  return { coordinator, calls };
}

function createScanner(overrides = {}) {
  const store = {
    listings: {},
    alerts: [],
    scans: [],
    rejections: []
  };
  const saveCalls = [];
  const coordinator = overrides.persistenceCoordinator;
  const marketplace = {
    config: {
      scanQueryLimit: 10,
      searchDelayMs: 0,
      laneDelayMs: 0
    },
    searchWithBackoff: async () => [
      { ebayItemId: 'scan-1', title: 'Listing One' },
      { ebayItemId: 'scan-2', title: 'Listing Two' },
      { ebayItemId: 'scan-3', title: 'Listing Three' }
    ],
    compactError: (error) => error.message || String(error),
    isRateLimitError: () => false
  };

  const scanner = createScoutScanner({
    activeMarketplace: marketplace,
    decisionValidationEngine: {
      recordOutcome() {}
    },
    getStore: () => store,
    historyEngine: {
      recordScan: () => ({
        observedCount: 3,
        trackedCount: 3,
        activeCount: 3,
        newListings: [],
        priceDrops: [],
        disappeared: []
      })
    },
    lanes: {
      all: { queries: [] },
      cards: { queries: ['cards'] }
    },
    learningEngine: {
      recordListingOutcome() {},
      recordScanOutcome: () => ({ stale: [] })
    },
    listingIdentity: {
      getListingId: (listing) => listing.ebayItemId
    },
    parseCardTitle: () => ({}),
    persistenceCoordinator: coordinator,
    predictionAccuracyEngine: {
      recordOutcome() {}
    },
    saveScoutedListing: (listing) => {
      store.listings[listing.ebayItemId] = { ...listing };
      return store.listings[listing.ebayItemId];
    },
    saveStore: () => {
      saveCalls.push('saveStore');
    },
    sleep: async () => {},
    systemHealth: {
      finishScan() {},
      markScanSkipped() {},
      recordScanEngine() {},
      setEngine() {},
      startScan() {}
    },
    ...overrides
  });

  return { scanner, saveCalls, store };
}

test('coordinator collapses multiple dirty updates into one batch flush', () => {
  const { coordinator, calls } = createCoordinator();

  coordinator.beginPersistenceBatch('scan_started');
  coordinator.markStateDirty('listing_saved');
  coordinator.markStateDirty('listing_saved');
  coordinator.markStateDirty('rejection_saved');
  const result = coordinator.flushPersistenceBatch('scan_finished');

  assert.equal(result.flushed, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].dirtyReasons, ['listing_saved', 'rejection_saved']);
  assert.equal(calls[0].reason, 'scan_finished');
  assert.equal(coordinator.getPersistenceDiagnostics().dirty, false);
});

test('nested batches defer flush until the outer batch closes', () => {
  const { coordinator, calls } = createCoordinator();

  coordinator.beginPersistenceBatch('outer');
  coordinator.beginPersistenceBatch('inner');
  coordinator.markStateDirty('nested_update');
  const inner = coordinator.flushPersistenceBatch('inner_done');
  const outer = coordinator.flushPersistenceBatch('outer_done');

  assert.equal(inner.deferred, true);
  assert.equal(calls.length, 1);
  assert.equal(outer.flushed, true);
  assert.equal(calls[0].reason, 'outer_done');
});

test('empty batches do not persist duplicate state', () => {
  const { coordinator, calls } = createCoordinator();

  coordinator.beginPersistenceBatch('empty_scan');
  const result = coordinator.flushPersistenceBatch('empty_scan_finished');

  assert.equal(result.skipped, true);
  assert.equal(result.skipReason, 'state_not_dirty');
  assert.equal(calls.length, 0);
  assert.equal(coordinator.getPersistenceDiagnostics().stats.flushesSkipped, 1);
});

test('emergency flush persists immediately during an active batch without closing it', () => {
  const { coordinator, calls } = createCoordinator();

  coordinator.beginPersistenceBatch('scan_started');
  coordinator.markStateDirty('notification_result_saved');
  const immediate = coordinator.emergencyFlush('notification_result_saved');
  coordinator.markStateDirty('listing_saved_after_notification');
  const final = coordinator.flushPersistenceBatch('scan_finished');

  assert.equal(immediate.flushed, true);
  assert.equal(immediate.diagnostics.active, true);
  assert.equal(final.flushed, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].reason, 'notification_result_saved');
  assert.equal(calls[1].reason, 'scan_finished');
});

test('cancelled batches discard dirty state and avoid crash-recovery duplicate flushes', () => {
  const { coordinator, calls } = createCoordinator();

  coordinator.beginPersistenceBatch('scan_started');
  coordinator.markStateDirty('listing_saved');
  const cancelled = coordinator.cancelPersistenceBatch('scan_cancelled');
  const afterCancel = coordinator.flushPersistenceBatch('late_flush');

  assert.equal(cancelled.cancelled, true);
  assert.equal(afterCancel.skipped, true);
  assert.equal(afterCancel.skipReason, 'state_not_dirty');
  assert.equal(calls.length, 0);
  assert.equal(coordinator.getPersistenceDiagnostics().stats.batchesCancelled, 1);
});

test('flush ordering and statistics remain deterministic across repeated scans', () => {
  const { coordinator, calls } = createCoordinator();

  for (const reason of ['first_scan', 'second_scan']) {
    coordinator.beginPersistenceBatch(`${reason}_started`);
    coordinator.markStateDirty(`${reason}_listing_saved`);
    coordinator.flushPersistenceBatch(`${reason}_finished`);
  }

  assert.deepEqual(calls.map((call) => call.reason), ['first_scan_finished', 'second_scan_finished']);
  assert.deepEqual(
    calls.map((call) => call.batchId),
    ['test-batch-1', 'test-batch-2']
  );
  assert.equal(coordinator.getPersistenceDiagnostics().stats.flushesPerformed, 2);
});

test('scan lifecycle batches repeated listing mutations behind one persistence flush', async () => {
  const { coordinator, calls } = createCoordinator();
  const { scanner, saveCalls, store } = createScanner({ persistenceCoordinator: coordinator });

  const scan = await scanner.runScoutScan('automatic');

  assert.equal(scan.status, 'completed');
  assert.equal(Object.keys(store.listings).length, 3);
  assert.equal(saveCalls.length, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].reason, 'scout_scan_finished');
  assert.deepEqual(calls[0].dirtyReasons, ['scan_finished', 'scouted_listing_saved']);
});

test('scanner preserves existing saveStore fallback when no coordinator is supplied', async () => {
  const { scanner, saveCalls } = createScanner({ persistenceCoordinator: null });

  const scan = await scanner.runScoutScan('automatic');

  assert.equal(scan.status, 'completed');
  assert.equal(saveCalls.length, 1);
});

test('skipped overlapping scans use an immediate coordinated flush', async () => {
  const { coordinator, calls } = createCoordinator();
  let releaseSearch;
  const delayedSearch = new Promise((resolve) => {
    releaseSearch = () => resolve([]);
  });
  const marketplace = {
    config: {
      scanQueryLimit: 10,
      searchDelayMs: 0,
      laneDelayMs: 0
    },
    searchWithBackoff: async () => delayedSearch,
    compactError: (error) => error.message || String(error),
    isRateLimitError: () => false
  };
  const { scanner, saveCalls } = createScanner({
    activeMarketplace: marketplace,
    persistenceCoordinator: coordinator
  });

  const firstScan = scanner.runScoutScan('automatic');
  const skipped = await scanner.runScoutScan('manual');
  releaseSearch();
  const completed = await firstScan;

  assert.equal(skipped.status, 'skipped');
  assert.equal(completed.status, 'completed');
  assert.equal(saveCalls.length, 0);
  assert.deepEqual(calls.map((call) => call.reason), ['scan_skipped', 'scout_scan_finished']);
});
