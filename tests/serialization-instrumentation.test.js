'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createScoutScanner } = require('../services/scoutScannerService');
const appStore = require('../utils/appStore');
const stateStore = require('../utils/stateStore');
const serializationInstrumentation = require('../utils/serializationInstrumentation');

function tempFile(name = 'state.json') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cardhawk-serialization-instrumentation-'));
  return path.join(directory, name);
}

function silentScanInstrumentation() {
  return {
    beginSerializationScan: serializationInstrumentation.beginSerializationScan,
    endSerializationScan: (options = {}) =>
      serializationInstrumentation.endSerializationScan({ ...options, emit: false })
  };
}

function createScannerFixture(filePath) {
  const store = {
    listings: {},
    alerts: [],
    scans: [],
    rejections: [],
    settings: {
      minDealScore: 85,
      minProfit: 20,
      minRoi: 0.25
    }
  };

  const scanner = createScoutScanner({
    activeMarketplace: {
      config: {
        scanQueryLimit: 10,
        searchDelayMs: 0,
        laneDelayMs: 0
      },
      searchWithBackoff: async () => [
        { ebayItemId: 'serialization-1', title: 'Serialization Fixture One' },
        { ebayItemId: 'serialization-2', title: 'Serialization Fixture Two' }
      ],
      compactError: (error) => error.message || String(error),
      isRateLimitError: () => false
    },
    decisionValidationEngine: { recordOutcome() {} },
    getStore: () => store,
    historyEngine: {
      recordScan: () => ({
        observedCount: 2,
        trackedCount: 2,
        activeCount: 2,
        newListings: [],
        priceDrops: [],
        disappeared: []
      })
    },
    lanes: {
      all: { queries: [] },
      cards: { queries: ['serialization cards'] }
    },
    learningEngine: {
      recordListingOutcome() {},
      recordScanOutcome: () => ({ stale: [] })
    },
    listingIdentity: {
      getListingId: (listing) => listing.ebayItemId
    },
    parseCardTitle: () => ({}),
    persistenceCoordinator: null,
    predictionAccuracyEngine: { recordOutcome() {} },
    saveScoutedListing: (listing) => {
      store.listings[listing.ebayItemId] = { ...listing };
      return store.listings[listing.ebayItemId];
    },
    saveStore: () => stateStore.saveJsonState(filePath, store),
    serializationInstrumentation: silentScanInstrumentation(),
    sleep: async () => {},
    systemHealth: {
      finishScan() {},
      markScanSkipped() {},
      recordScanEngine() {},
      setEngine() {},
      startScan() {}
    }
  });

  return { scanner, store };
}

test('instrumented stringify records deterministic aggregate fields without changing output', () => {
  serializationInstrumentation.resetSerializationInstrumentation();
  serializationInstrumentation.beginSerializationScan({
    scanId: 'scan-serialization-1',
    source: 'test'
  });

  const value = { beta: 2, alpha: ['a', 'b'] };
  const actual = serializationInstrumentation.instrumentJsonStringify(value, null, 2, {
    sourceFile: 'tests/serialization-instrumentation.test.js',
    functionName: 'instrumentedStringify',
    serializationType: 'json_test_payload',
    group: 'TestGroup'
  });
  const expected = JSON.stringify(value, null, 2);
  const summary = serializationInstrumentation.endSerializationScan({ emit: false });

  assert.equal(actual, expected);
  assert.equal(summary.scanId, 'scan-serialization-1');
  assert.equal(summary.totalSerializations, 1);
  assert.equal(summary.totalBytes, Buffer.byteLength(expected, 'utf8'));
  assert.equal(summary.groups.TestGroup.writes, 1);
  assert.equal(summary.groups.TestGroup.bytes, summary.totalBytes);
  assert.equal(summary.largestSerialization.functionName, 'instrumentedStringify');
  assert.equal(typeof summary.largestSerialization.elapsedMs, 'number');
  assert.equal(typeof summary.largestSerialization.heapUsedBefore, 'number');
  assert.equal(typeof summary.largestSerialization.heapUsedAfter, 'number');
  assert.equal(typeof summary.largestSerialization.rssBefore, 'number');
  assert.equal(typeof summary.largestSerialization.rssAfter, 'number');
});

test('aggregation resets between scans', () => {
  serializationInstrumentation.resetSerializationInstrumentation();

  serializationInstrumentation.beginSerializationScan({ scanId: 'first' });
  serializationInstrumentation.instrumentJsonStringify({ first: true }, undefined, undefined, {
    sourceFile: 'test',
    functionName: 'first',
    group: 'First'
  });
  const first = serializationInstrumentation.endSerializationScan({ emit: false });

  serializationInstrumentation.beginSerializationScan({ scanId: 'second' });
  serializationInstrumentation.instrumentJsonStringify({ second: true }, undefined, undefined, {
    sourceFile: 'test',
    functionName: 'second',
    group: 'Second'
  });
  const second = serializationInstrumentation.endSerializationScan({ emit: false });

  assert.equal(first.totalSerializations, 1);
  assert.equal(second.totalSerializations, 1);
  assert.equal(second.groups.First, undefined);
  assert.equal(second.groups.Second.writes, 1);
  assert.deepEqual(
    serializationInstrumentation.getCompletedSerializationSummaries().map((summary) => summary.scanId),
    ['first', 'second']
  );
});

test('instrumented state persistence preserves exact file contents and API result shape', () => {
  serializationInstrumentation.resetSerializationInstrumentation();
  const filePath = tempFile();
  const state = {
    version: 1,
    records: [
      { id: 'record-1', amount: 12.34 },
      { id: 'record-2', amount: 56.78 }
    ]
  };

  serializationInstrumentation.beginSerializationScan({ scanId: 'state-save' });
  const result = stateStore.saveJsonState(filePath, state);
  const summary = serializationInstrumentation.endSerializationScan({ emit: false });

  assert.deepEqual(result, { ok: true, filePath });
  assert.equal(fs.readFileSync(filePath, 'utf8'), JSON.stringify(state, null, 2));
  assert.equal(summary.groups.StateStore.writes, 1);
  assert.equal(summary.groups.StateStore.bytes, Buffer.byteLength(JSON.stringify(state, null, 2), 'utf8'));
});

test('StateStore attribution preserves explicit caller groups and falls back only when unscoped', () => {
  serializationInstrumentation.resetSerializationInstrumentation();
  const directPath = tempFile('direct.json');
  const decisionPath = tempFile('decision.json');
  const predictionPath = tempFile('prediction.json');
  const directState = { source: 'direct', records: [1] };
  const decisionState = { source: 'decision', records: [{ id: 'decision-1' }] };
  const predictionState = { source: 'prediction', records: [{ id: 'prediction-1' }] };

  serializationInstrumentation.beginSerializationScan({ scanId: 'state-store-attribution' });
  stateStore.saveJsonState(directPath, directState);
  serializationInstrumentation.withSerializationGroup('DecisionValidation', () => {
    stateStore.saveJsonState(decisionPath, decisionState);
  });
  serializationInstrumentation.withSerializationGroup('PredictionAccuracy', () => {
    stateStore.saveJsonState(predictionPath, predictionState);
  });
  const summary = serializationInstrumentation.endSerializationScan({ emit: false });

  assert.equal(fs.readFileSync(directPath, 'utf8'), JSON.stringify(directState, null, 2));
  assert.equal(fs.readFileSync(decisionPath, 'utf8'), JSON.stringify(decisionState, null, 2));
  assert.equal(fs.readFileSync(predictionPath, 'utf8'), JSON.stringify(predictionState, null, 2));
  assert.equal(summary.totalSerializations, 3);
  assert.equal(summary.groups.StateStore.writes, 1);
  assert.equal(summary.groups.DecisionValidation.writes, 1);
  assert.equal(summary.groups.PredictionAccuracy.writes, 1);
  assert.equal(summary.totalBytes,
    summary.groups.StateStore.bytes +
    summary.groups.DecisionValidation.bytes +
    summary.groups.PredictionAccuracy.bytes
  );
});

test('AppStore save attribution remains separate from direct StateStore persistence', () => {
  serializationInstrumentation.resetSerializationInstrumentation();
  const appStorePath = tempFile('app-store.json');
  const directPath = tempFile('fallback.json');
  const store = appStore.createDefaultStore();
  const directState = { ok: true };

  serializationInstrumentation.beginSerializationScan({ scanId: 'app-store-attribution' });
  appStore.saveStore(appStorePath, store);
  stateStore.saveJsonState(directPath, directState);
  const summary = serializationInstrumentation.endSerializationScan({ emit: false });

  assert.equal(fs.readFileSync(appStorePath, 'utf8'), JSON.stringify(appStore.createDefaultStore(), null, 2));
  assert.equal(fs.readFileSync(directPath, 'utf8'), JSON.stringify(directState, null, 2));
  assert.equal(summary.groups.AppStore.writes, 1);
  assert.equal(summary.groups.StateStore.writes, 1);
  assert.equal(summary.totalSerializations, 2);
});

test('scan lifecycle emits one aggregate serialization summary and clears active scan state', async () => {
  serializationInstrumentation.resetSerializationInstrumentation();
  const filePath = tempFile();
  const { scanner, store } = createScannerFixture(filePath);

  const firstScan = await scanner.runScoutScan('automatic');
  const firstSummary = serializationInstrumentation.getCompletedSerializationSummaries().at(-1);
  const secondScan = await scanner.runScoutScan('manual');
  const secondSummary = serializationInstrumentation.getCompletedSerializationSummaries().at(-1);

  assert.equal(firstScan.status, 'completed');
  assert.equal(secondScan.status, 'completed');
  assert.equal(Object.keys(store.listings).length, 2);
  assert.equal(serializationInstrumentation.getActiveSerializationSummary(), null);
  assert.equal(firstSummary.totalSerializations, 1);
  assert.equal(secondSummary.totalSerializations, 1);
  assert.equal(firstSummary.groups.StateStore.writes, 1);
  assert.equal(secondSummary.groups.StateStore.writes, 1);
  assert.notEqual(firstSummary.scanId, secondSummary.scanId);
});

test('formatted summary is compact and grouped', () => {
  serializationInstrumentation.resetSerializationInstrumentation();
  serializationInstrumentation.beginSerializationScan({ scanId: 'format-test' });
  serializationInstrumentation.instrumentJsonStringify({ ok: true }, undefined, undefined, {
    sourceFile: 'test',
    functionName: 'format',
    group: 'Formatting'
  });
  const summary = serializationInstrumentation.endSerializationScan({ emit: false });

  const formatted = serializationInstrumentation.formatSerializationSummary(summary);

  assert.match(formatted, /=== Serialization Summary ===/);
  assert.match(formatted, /Formatting/);
  assert.match(formatted, /Total serialization bytes:/);
  assert.match(formatted, /Total writes: 1/);
});
