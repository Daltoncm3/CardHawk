'use strict';

const listingIdentity = require('./listingIdentity');
const {
  compactStoreListings
} = require('./listingCompaction');
const {
  enforceActiveListingRetention
} = require('./activeListingRetention');
const { loadJsonState, saveJsonState } = require('./stateStore');

function createDefaultStore() {
  return {
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
    settings: {
      minDealScore: loaded.settings?.minDealScore || 85,
      minProfit: loaded.settings?.minProfit || 20,
      minRoi: loaded.settings?.minRoi || 0.25
    }
  };
}

function loadStore(filePath, fallbackStore = createDefaultStore(), options = {}) {
  return normalizeStore(loadJsonState(filePath, fallbackStore), options);
}

function saveStore(filePath, store = createDefaultStore(), options = {}) {
  return saveJsonState(filePath, normalizeStore(store, options));
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
  createDefaultStore,
  normalizeStore,
  loadStore,
  saveStore,
  getStoredListingById
};
