'use strict';

const listingCompaction = require('./listingCompaction');

const ACTIVE_LISTING_RETENTION_SOURCE = 'active_listing_retention';
const ACTIVE_LISTING_RETENTION_SCHEMA_VERSION = '1.0.0';

const DEFAULT_ACTIVE_LISTING_RETENTION_POLICY = Object.freeze({
  enabled: true,
  maxResidentListings: 1000,
  maxResidentAgeDays: null,
  minProtectedNewestListings: 100,
  evictDisappearedListings: true,
  evictStaleListings: true,
  preserveAlertedListings: true,
  preservePinnedListings: true
});

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  if (!isObject(value) && !Array.isArray(value)) return value;
  return JSON.parse(JSON.stringify(value));
}

function toPositiveInteger(value, fallback) {
  const number = Number(value);
  const fallbackNumber = Number(fallback);
  const safeFallback = Number.isFinite(fallbackNumber) && fallbackNumber > 0 ? Math.floor(fallbackNumber) : 1;
  if (!Number.isFinite(number) || number <= 0) return safeFallback;
  return Math.floor(number);
}

function toOptionalPositiveInteger(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.floor(number);
}

function toBoolean(value, fallback = true) {
  if (value === true || value === false) return value;
  if (typeof value === 'string') {
    const normalized = value.toLowerCase().trim();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  }
  return fallback;
}

function parseTimestamp(value) {
  const time = new Date(value || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

function getListingTimestamp(listing = {}) {
  return Math.max(
    parseTimestamp(listing.lastSeenAt),
    parseTimestamp(listing.updatedAt),
    parseTimestamp(listing.createdAt),
    parseTimestamp(listing.firstSeenAt),
    parseTimestamp(listing.itemEndDate)
  );
}

function getListingId(key, listing = {}) {
  return String(
    listing.listingId ||
    listing.marketplaceListingId ||
    listing.ebayItemId ||
    listing.itemId ||
    listing.id ||
    key ||
    ''
  );
}

function normalizeStatus(value) {
  return String(value || '').toLowerCase().trim();
}

function isPinnedListing(listing = {}) {
  return listing.retentionPinned === true ||
    listing.pinned === true ||
    listing.keepResident === true ||
    listing.requiredActive === true;
}

function isAlertedListing(listing = {}) {
  return listing.alertCreated === true ||
    Boolean(listing.alertId) ||
    Boolean(listing.notificationResult) ||
    Boolean(listing.notifiedAt);
}

function isDisappearedListing(listing = {}) {
  const status = normalizeStatus(listing.status || listing.lifecycleState);
  return listing.disappearedAt ||
    listing.disappeared === true ||
    status === 'disappeared' ||
    status === 'ended' ||
    status === 'inactive';
}

function isStaleListing(listing = {}) {
  const status = normalizeStatus(listing.status || listing.lifecycleState);
  return listing.staleAt ||
    listing.stale === true ||
    status === 'stale';
}

function normalizeRetentionPolicy(policy = {}, env = process.env) {
  const base = {
    ...DEFAULT_ACTIVE_LISTING_RETENTION_POLICY,
    ...policy
  };

  return Object.freeze({
    source: ACTIVE_LISTING_RETENTION_SOURCE,
    schemaVersion: ACTIVE_LISTING_RETENTION_SCHEMA_VERSION,
    enabled: toBoolean(base.enabled, DEFAULT_ACTIVE_LISTING_RETENTION_POLICY.enabled),
    maxResidentListings: toPositiveInteger(
      env.CARDHAWK_MAX_RESIDENT_LISTINGS ?? base.maxResidentListings,
      DEFAULT_ACTIVE_LISTING_RETENTION_POLICY.maxResidentListings
    ),
    maxResidentAgeDays: toOptionalPositiveInteger(
      env.CARDHAWK_MAX_RESIDENT_LISTING_AGE_DAYS ?? base.maxResidentAgeDays,
      DEFAULT_ACTIVE_LISTING_RETENTION_POLICY.maxResidentAgeDays
    ),
    minProtectedNewestListings: toPositiveInteger(
      env.CARDHAWK_MIN_PROTECTED_NEWEST_LISTINGS ?? base.minProtectedNewestListings,
      DEFAULT_ACTIVE_LISTING_RETENTION_POLICY.minProtectedNewestListings
    ),
    evictDisappearedListings: toBoolean(base.evictDisappearedListings, true),
    evictStaleListings: toBoolean(base.evictStaleListings, true),
    preserveAlertedListings: toBoolean(base.preserveAlertedListings, true),
    preservePinnedListings: toBoolean(base.preservePinnedListings, true)
  });
}

function buildEntries(listings = {}, now = new Date()) {
  const nowMs = parseTimestamp(now);
  return Object.entries(isObject(listings) ? listings : {}).map(([key, listing]) => {
    const compact = listingCompaction.compactRetainedListing(listing);
    const timestamp = getListingTimestamp(compact);

    return {
      key,
      listing: compact,
      listingId: getListingId(key, compact),
      timestamp,
      ageDays: timestamp > 0 && nowMs > 0 ? Math.max(0, Math.floor((nowMs - timestamp) / 86_400_000)) : null,
      required: false,
      protectedNewest: false,
      eligible: false,
      evictionReasons: []
    };
  });
}

function markProtectedAndEligible(entries = [], policy, now = new Date()) {
  const newest = entries.slice().sort((a, b) => {
    if (b.timestamp !== a.timestamp) return b.timestamp - a.timestamp;
    return a.listingId.localeCompare(b.listingId) || a.key.localeCompare(b.key);
  });
  const protectedCount = Math.min(policy.minProtectedNewestListings, newest.length);
  const protectedKeys = new Set(newest.slice(0, protectedCount).map((entry) => entry.key));
  const nowMs = parseTimestamp(now);

  for (const entry of entries) {
    const listing = entry.listing;

    if (policy.preserveAlertedListings && isAlertedListing(listing)) {
      entry.required = true;
      entry.evictionReasons.push('required_alert_or_notification_context');
    }

    if (policy.preservePinnedListings && isPinnedListing(listing)) {
      entry.required = true;
      entry.evictionReasons.push('required_pinned_listing');
    }

    if (protectedKeys.has(entry.key)) {
      entry.protectedNewest = true;
      entry.evictionReasons.push('protected_newest_resident_window');
    }

    const ageExpired = policy.maxResidentAgeDays !== null &&
      entry.timestamp > 0 &&
      nowMs > 0 &&
      entry.ageDays !== null &&
      entry.ageDays > policy.maxResidentAgeDays;
    const staleEligible = policy.evictStaleListings && isStaleListing(listing);
    const disappearedEligible = policy.evictDisappearedListings && isDisappearedListing(listing);

    if (ageExpired) entry.evictionReasons.push('resident_age_limit_exceeded');
    if (staleEligible) entry.evictionReasons.push('stale_listing_eligible');
    if (disappearedEligible) entry.evictionReasons.push('disappeared_listing_eligible');

    entry.eligible = !entry.required && !entry.protectedNewest && (
      ageExpired ||
      staleEligible ||
      disappearedEligible
    );
  }

  return entries;
}

function sortOldestFirst(a, b) {
  if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
  return a.listingId.localeCompare(b.listingId) || a.key.localeCompare(b.key);
}

function enforceActiveListingRetention(listings = {}, policyInput = {}, options = {}) {
  const policy = normalizeRetentionPolicy(policyInput, options.env || process.env);
  const now = options.now || new Date();
  const entries = markProtectedAndEligible(buildEntries(listings, now), policy, now);
  const totalBefore = entries.length;

  if (!policy.enabled) {
    return Object.freeze({
      source: ACTIVE_LISTING_RETENTION_SOURCE,
      schemaVersion: ACTIVE_LISTING_RETENTION_SCHEMA_VERSION,
      policy,
      residentListings: Object.fromEntries(entries.map((entry) => [entry.key, entry.listing])),
      evictedListings: [],
      evictedListingIds: [],
      retainedCount: totalBefore,
      evictedCount: 0,
      totalBefore,
      totalAfter: totalBefore,
      capExceeded: false,
      warnings: [],
      summary: `Active listing retention disabled; ${totalBefore} listing${totalBefore === 1 ? '' : 's'} retained.`
    });
  }

  const evictKeys = new Set();
  const eligible = entries.filter((entry) => entry.eligible).sort(sortOldestFirst);

  for (const entry of eligible) {
    if (entry.evictionReasons.includes('resident_age_limit_exceeded') ||
        entry.evictionReasons.includes('stale_listing_eligible') ||
        entry.evictionReasons.includes('disappeared_listing_eligible')) {
      evictKeys.add(entry.key);
    }
  }

  let projectedCount = totalBefore - evictKeys.size;
  if (projectedCount > policy.maxResidentListings) {
    const capCandidates = entries
      .filter((entry) => !entry.required && !entry.protectedNewest && !evictKeys.has(entry.key))
      .sort(sortOldestFirst);

    for (const entry of capCandidates) {
      if (projectedCount <= policy.maxResidentListings) break;
      entry.evictionReasons.push('resident_listing_cap_exceeded');
      evictKeys.add(entry.key);
      projectedCount -= 1;
    }
  }

  const residentListings = {};
  const evictedListings = [];
  for (const entry of entries) {
    if (evictKeys.has(entry.key)) {
      evictedListings.push({
        key: entry.key,
        listingId: entry.listingId,
        title: entry.listing.title || '',
        lastSeenAt: entry.listing.lastSeenAt || null,
        firstSeenAt: entry.listing.firstSeenAt || null,
        ageDays: entry.ageDays,
        evictionReasons: [...new Set(entry.evictionReasons.filter((reason) =>
          reason !== 'protected_newest_resident_window' &&
          !reason.startsWith('required_')
        ))].sort(),
        archiveEligible: true
      });
    } else {
      residentListings[entry.key] = entry.listing;
    }
  }

  evictedListings.sort((a, b) => a.listingId.localeCompare(b.listingId) || a.key.localeCompare(b.key));
  const unableToMeetCap = Object.keys(residentListings).length > policy.maxResidentListings;
  const warnings = [];
  if (unableToMeetCap) warnings.push('resident_listing_cap_not_met_because_required_or_protected_listings_exceed_cap');

  return Object.freeze({
    source: ACTIVE_LISTING_RETENTION_SOURCE,
    schemaVersion: ACTIVE_LISTING_RETENTION_SCHEMA_VERSION,
    policy,
    residentListings,
    evictedListings,
    evictedListingIds: evictedListings.map((entry) => entry.listingId),
    retainedCount: Object.keys(residentListings).length,
    evictedCount: evictedListings.length,
    totalBefore,
    totalAfter: Object.keys(residentListings).length,
    capExceeded: unableToMeetCap,
    warnings,
    summary: `Active listing retention kept ${Object.keys(residentListings).length} of ${totalBefore} resident listing${totalBefore === 1 ? '' : 's'}; ${evictedListings.length} archive-eligible listing${evictedListings.length === 1 ? '' : 's'} removed from active memory.`
  });
}

function applyActiveListingRetentionToStore(store = {}, policyInput = {}, options = {}) {
  const nextStore = {
    ...clone(store),
    listings: isObject(store.listings) ? { ...store.listings } : {}
  };
  const result = enforceActiveListingRetention(nextStore.listings, policyInput, options);
  nextStore.listings = result.residentListings;

  return Object.freeze({
    store: nextStore,
    retention: result
  });
}

module.exports = {
  ACTIVE_LISTING_RETENTION_SCHEMA_VERSION,
  ACTIVE_LISTING_RETENTION_SOURCE,
  DEFAULT_ACTIVE_LISTING_RETENTION_POLICY,
  applyActiveListingRetentionToStore,
  enforceActiveListingRetention,
  normalizeRetentionPolicy
};
