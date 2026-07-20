'use strict';

const SCAN_UNIVERSE_SNAPSHOT_SOURCE = 'scan_universe_snapshot';
const SCAN_UNIVERSE_SNAPSHOT_SCHEMA_VERSION = '1.0.0';

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function getListingId(listing = {}, fallback = '') {
  return String(
    listing.listingId ||
    listing.marketplaceListingId ||
    listing.ebayItemId ||
    listing.itemId ||
    listing.id ||
    fallback ||
    ''
  );
}

function normalizeListings(input = {}) {
  if (Array.isArray(input)) return input.slice();
  if (isScanUniverseSnapshot(input)) return input.listings.slice();
  if (isObject(input) && isObject(input.listings)) return Object.values(input.listings);
  if (isObject(input)) return Object.values(input);
  return [];
}

function createScanUniverseSnapshot(input = {}, options = {}) {
  const listings = normalizeListings(input).filter((listing) => listing && typeof listing === 'object');
  const listingIds = listings.map((listing, index) => getListingId(listing, `listing-${index}`));
  const snapshot = {
    source: SCAN_UNIVERSE_SNAPSHOT_SOURCE,
    schemaVersion: SCAN_UNIVERSE_SNAPSHOT_SCHEMA_VERSION,
    snapshotId: String(options.snapshotId || `scan-universe-${listingIds.length}`),
    createdAt: options.createdAt || null,
    listingCount: listings.length,
    listingIds: Object.freeze(listingIds.slice()),
    listings: Object.freeze(listings.slice())
  };

  return Object.freeze(snapshot);
}

function isScanUniverseSnapshot(value = {}) {
  return Boolean(
    isObject(value) &&
    value.source === SCAN_UNIVERSE_SNAPSHOT_SOURCE &&
    value.schemaVersion === SCAN_UNIVERSE_SNAPSHOT_SCHEMA_VERSION &&
    Array.isArray(value.listings)
  );
}

function getScanUniverseListings(value = {}) {
  if (isScanUniverseSnapshot(value)) return value.listings;
  if (Array.isArray(value)) return value;
  return normalizeListings(value);
}

function validateScanUniverseSnapshot(snapshot = {}) {
  const errors = [];
  const warnings = [];

  if (!isObject(snapshot)) errors.push('snapshot_not_object');
  if (snapshot.source !== SCAN_UNIVERSE_SNAPSHOT_SOURCE) errors.push('invalid_source');
  if (snapshot.schemaVersion !== SCAN_UNIVERSE_SNAPSHOT_SCHEMA_VERSION) errors.push('invalid_schemaVersion');
  if (!Array.isArray(snapshot.listings)) errors.push('missing_listings');
  if (!Array.isArray(snapshot.listingIds)) errors.push('missing_listingIds');
  if (Array.isArray(snapshot.listings) && snapshot.listingCount !== snapshot.listings.length) {
    errors.push('listing_count_mismatch');
  }
  if (Array.isArray(snapshot.listingIds) && Array.isArray(snapshot.listings) && snapshot.listingIds.length !== snapshot.listings.length) {
    errors.push('listing_id_count_mismatch');
  }
  if (Array.isArray(snapshot.listings) && !Object.isFrozen(snapshot.listings)) warnings.push('listings_array_not_frozen');
  if (Array.isArray(snapshot.listingIds) && !Object.isFrozen(snapshot.listingIds)) warnings.push('listing_ids_array_not_frozen');
  if (!Object.isFrozen(snapshot)) warnings.push('snapshot_not_frozen');

  return {
    valid: errors.length === 0,
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)]
  };
}

function summarizeScanUniverseSnapshot(snapshot = {}) {
  const listings = getScanUniverseListings(snapshot);
  const ids = isScanUniverseSnapshot(snapshot)
    ? snapshot.listingIds
    : listings.map((listing, index) => getListingId(listing, `listing-${index}`));

  return {
    source: SCAN_UNIVERSE_SNAPSHOT_SOURCE,
    schemaVersion: SCAN_UNIVERSE_SNAPSHOT_SCHEMA_VERSION,
    snapshotId: snapshot.snapshotId || null,
    listingCount: listings.length,
    firstListingId: ids[0] || null,
    lastListingId: ids[ids.length - 1] || null,
    immutable: isScanUniverseSnapshot(snapshot) && Object.isFrozen(snapshot) && Object.isFrozen(snapshot.listings)
  };
}

module.exports = {
  SCAN_UNIVERSE_SNAPSHOT_SCHEMA_VERSION,
  SCAN_UNIVERSE_SNAPSHOT_SOURCE,
  createScanUniverseSnapshot,
  getScanUniverseListings,
  isScanUniverseSnapshot,
  summarizeScanUniverseSnapshot,
  validateScanUniverseSnapshot
};
