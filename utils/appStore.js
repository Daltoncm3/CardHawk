'use strict';

const fs = require('fs');
const listingIdentity = require('./listingIdentity');
const {
  compactStoreListings
} = require('./listingCompaction');
const {
  enforceActiveListingRetention
} = require('./activeListingRetention');
const {
  normalizeTargetedDiscoveryObservations
} = require('./targetedDiscoveryObservationStore');
const { loadJsonState, saveJsonState } = require('./stateStore');
const serializationInstrumentation = require('./serializationInstrumentation');

const MAX_SAVE_DIAGNOSTICS = 50;
let saveDiagnostics = [];

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stableStringify(value[key])}`
    ).join(',')}}`;
  }
  return JSON.stringify(value);
}

function createDefaultStore() {
  return {
    listings: {},
    alerts: [],
    scans: [],
    rejections: [],
    targetedDiscoveryObservations: [],
    settings: {
      minDealScore: 85,
      minProfit: 20,
      minRoi: 0.25
    }
  };
}

function normalizeStore(loaded = {}, options = {}) {
  const compactListings = compactStoreListings(loaded.listings || {});
  const retention = options.applyActiveListingRetention === false
    ? { residentListings: compactListings }
    : enforceActiveListingRetention(compactListings, options.activeListingRetentionPolicy, {
        env: options.env,
        now: options.now
      });

  return {
    listings: retention.residentListings,
    alerts: loaded.alerts || [],
    scans: loaded.scans || [],
    rejections: loaded.rejections || [],
    targetedDiscoveryObservations: normalizeTargetedDiscoveryObservations(
      loaded.targetedDiscoveryObservations,
      options.targetedDiscoveryObservationRetention || options
    ),
    settings: {
      minDealScore: loaded.settings?.minDealScore || 85,
      minProfit: loaded.settings?.minProfit || 20,
      minRoi: loaded.settings?.minRoi || 0.25
    }
  };
}

function buildStoreFingerprint(store = createDefaultStore(), options = {}) {
  const normalized = options.alreadyNormalized
    ? store
    : normalizeStore(store, options);
  return stableStringify(normalized);
}

function getCollectionCounts(store = {}) {
  return {
    listings: Object.keys(store.listings || {}).length,
    alerts: Array.isArray(store.alerts) ? store.alerts.length : 0,
    scans: Array.isArray(store.scans) ? store.scans.length : 0,
    rejections: Array.isArray(store.rejections) ? store.rejections.length : 0,
    targetedDiscoveryObservations: Array.isArray(store.targetedDiscoveryObservations)
      ? store.targetedDiscoveryObservations.length
      : 0,
    settings: store.settings && typeof store.settings === 'object'
      ? Object.keys(store.settings).length
      : 0
  };
}

function recordStoreSaveDiagnostic(input = {}) {
  const storeSnapshot = input.store || {};
  const diagnostic = {
    source: 'app_store_persistence',
    schemaVersion: '1.0.0',
    timestamp: input.timestamp || new Date().toISOString(),
    filePath: input.filePath || null,
    reason: input.reason || 'unspecified',
    context: input.context || null,
    executed: input.executed === true,
    skipped: input.skipped === true,
    skipReason: input.skipReason || null,
    serializedByteSize: Number.isFinite(Number(input.serializedByteSize)) ? Number(input.serializedByteSize) : 0,
    durationMs: Number.isFinite(Number(input.durationMs)) ? Number(input.durationMs) : 0,
    collectionCounts: getCollectionCounts(storeSnapshot),
    largestResidentCollectionCounts: {
      listings: Object.keys(storeSnapshot.listings || {}).length,
      rejections: Array.isArray(storeSnapshot.rejections) ? storeSnapshot.rejections.length : 0,
      alerts: Array.isArray(storeSnapshot.alerts) ? storeSnapshot.alerts.length : 0,
      scans: Array.isArray(storeSnapshot.scans) ? storeSnapshot.scans.length : 0,
      targetedDiscoveryObservations: Array.isArray(storeSnapshot.targetedDiscoveryObservations)
        ? storeSnapshot.targetedDiscoveryObservations.length
        : 0
    }
  };

  saveDiagnostics.push(diagnostic);
  saveDiagnostics = saveDiagnostics.slice(-MAX_SAVE_DIAGNOSTICS);
  return { ...diagnostic };
}

function getStoreSaveDiagnostics() {
  return saveDiagnostics.map((entry) => ({
    ...entry,
    collectionCounts: { ...(entry.collectionCounts || {}) },
    largestResidentCollectionCounts: { ...(entry.largestResidentCollectionCounts || {}) }
  }));
}

function resetStoreSaveDiagnostics() {
  saveDiagnostics = [];
}

function elapsedMs(startedAt) {
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000;
}

function loadStoreWithPersistencePlan(filePath, fallbackStore = createDefaultStore(), options = {}) {
  const fileExists = fs.existsSync(filePath);
  const loaded = loadJsonState(filePath, fallbackStore);
  const normalized = normalizeStore(loaded, options);
  const loadedFingerprint = stableStringify(loaded);
  const normalizedFingerprint = stableStringify(normalized);
  const persistenceReasons = [];

  if (!fileExists) persistenceReasons.push('store_file_missing');
  if (loadedFingerprint !== normalizedFingerprint) persistenceReasons.push('store_normalized_or_retained');

  return {
    store: normalized,
    fileExists,
    loadedFingerprint,
    normalizedFingerprint,
    persistenceRequired: persistenceReasons.length > 0,
    persistenceReasons
  };
}

function loadStore(filePath, fallbackStore = createDefaultStore(), options = {}) {
  return serializationInstrumentation.withSerializationGroup('AppStore', () =>
    loadStoreWithPersistencePlan(filePath, fallbackStore, options).store
  );
}

function saveStore(filePath, store = createDefaultStore(), options = {}) {
  return serializationInstrumentation.withSerializationGroup('AppStore', () => {
    const normalized = normalizeStore(store, options);
    const startedAt = process.hrtime.bigint();
    const result = saveJsonState(filePath, normalized);
    const durationMs = Math.round(elapsedMs(startedAt) * 1000) / 1000;
    const serializedByteSize = fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
    const savedAt = new Date().toISOString();
    return {
      ...result,
      diagnostics: recordStoreSaveDiagnostic({
        filePath,
        reason: options.reason || 'save_store',
        context: options.context || null,
        executed: true,
        skipped: false,
        serializedByteSize,
        durationMs,
        timestamp: savedAt,
        store: normalized
      })
    };
  });
}

function getStoredListingById(store, id) {
  const listingId = listingIdentity.getListingId(id);
  if (!listingId) return null;

  if (store.listings[listingId]) return store.listings[listingId];

  return Object.values(store.listings || {}).find((listing) =>
    listingIdentity.getListingId(listing) === listingId
  ) || null;
}

module.exports = {
  buildStoreFingerprint,
  createDefaultStore,
  getCollectionCounts,
  getStoreSaveDiagnostics,
  loadStoreWithPersistencePlan,
  normalizeStore,
  recordStoreSaveDiagnostic,
  resetStoreSaveDiagnostics,
  loadStore,
  saveStore,
  getStoredListingById
};
