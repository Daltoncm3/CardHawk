'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const appStore = require('../utils/appStore');
const {
  DEFAULT_ACTIVE_LISTING_RETENTION_POLICY,
  applyActiveListingRetentionToStore,
  enforceActiveListingRetention,
  normalizeRetentionPolicy
} = require('../utils/activeListingRetention');

const NOW = '2026-07-20T12:00:00.000Z';

function tempFile(name = 'cardhawk-data.json') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cardhawk-active-listing-retention-'));
  return path.join(directory, name);
}

function listing(id, daysAgo, overrides = {}) {
  const timestamp = new Date(Date.parse(NOW) - daysAgo * 86_400_000).toISOString();

  return {
    listingId: id,
    marketplace: 'ebay',
    marketplaceListingId: id,
    marketplaceLabel: 'eBay',
    ebayItemId: id,
    title: `2026 Retention Test Player #${id} PSA 10`,
    price: 25 + daysAgo,
    shipping: 5,
    totalCost: 30 + daysAgo,
    currency: 'USD',
    condition: 'PSA 10',
    url: `https://example.test/${id}`,
    image: `https://example.test/${id}.jpg`,
    sellerUsername: 'RetentionSeller',
    sellerFeedbackPercentage: 99.8,
    sellerFeedbackScore: 1200,
    buyingOptions: ['FIXED_PRICE'],
    itemEndDate: timestamp,
    parsed: {
      player: 'Retention Test Player',
      year: 2026,
      cardNumber: id,
      gradingCompany: 'PSA',
      grade: '10'
    },
    firstSeenAt: timestamp,
    lastSeenAt: timestamp,
    seenCount: 1,
    alertCreated: false,
    raw: {
      itemId: id,
      title: `Raw ${id}`,
      payload: 'x'.repeat(250)
    },
    request: {
      headers: { authorization: 'Bearer test-only' }
    },
    ...overrides
  };
}

function listingMap(count) {
  return Object.fromEntries(
    Array.from({ length: count }, (_, index) => {
      const id = `listing-${index + 1}`;
      return [id, listing(id, count - index)];
    })
  );
}

test('default active listing retention policy is bounded and configurable', () => {
  assert.equal(DEFAULT_ACTIVE_LISTING_RETENTION_POLICY.maxResidentListings, 1000);
  const policy = normalizeRetentionPolicy({}, {
    CARDHAWK_MAX_RESIDENT_LISTINGS: '42',
    CARDHAWK_MAX_RESIDENT_LISTING_AGE_DAYS: '14',
    CARDHAWK_MIN_PROTECTED_NEWEST_LISTINGS: '5'
  });

  assert.equal(policy.maxResidentListings, 42);
  assert.equal(policy.maxResidentAgeDays, 14);
  assert.equal(policy.minProtectedNewestListings, 5);
});

test('retention cap preserves newest listings and evicts oldest eligible listings', () => {
  const result = enforceActiveListingRetention(listingMap(5), {
    maxResidentListings: 3,
    minProtectedNewestListings: 1
  }, {
    env: {},
    now: NOW
  });

  assert.equal(result.retainedCount, 3);
  assert.deepEqual(Object.keys(result.residentListings).sort(), ['listing-3', 'listing-4', 'listing-5']);
  assert.deepEqual(result.evictedListingIds, ['listing-1', 'listing-2']);
  assert.equal(result.evictedListings.every((entry) => entry.archiveEligible), true);
  assert.equal(result.evictedListings[0].evictionReasons.includes('resident_listing_cap_exceeded'), true);
});

test('required alert and pinned listings are not evicted even when they exceed the cap', () => {
  const listings = listingMap(4);
  listings['listing-1'].alertCreated = true;
  listings['listing-2'].retentionPinned = true;

  const result = enforceActiveListingRetention(listings, {
    maxResidentListings: 2,
    minProtectedNewestListings: 1
  }, {
    env: {},
    now: NOW
  });

  assert.equal(result.residentListings['listing-1'].alertCreated, true);
  assert.equal(result.residentListings['listing-2'].retentionPinned, true);
  assert.equal(result.retainedCount, 3);
  assert.equal(result.capExceeded, true);
  assert.equal(result.warnings.includes('resident_listing_cap_not_met_because_required_or_protected_listings_exceed_cap'), true);
});

test('age, stale, and disappeared policies remove eligible historical residents', () => {
  const listings = {
    recent: listing('recent', 1),
    old: listing('old', 45),
    stale: listing('stale', 5, { status: 'stale' }),
    disappeared: listing('disappeared', 6, { status: 'disappeared' })
  };

  const result = enforceActiveListingRetention(listings, {
    maxResidentListings: 10,
    maxResidentAgeDays: 30,
    minProtectedNewestListings: 1
  }, {
    env: {},
    now: NOW
  });

  assert.deepEqual(Object.keys(result.residentListings), ['recent']);
  assert.deepEqual(result.evictedListingIds, ['disappeared', 'old', 'stale']);
  assert.equal(result.evictedListings.find((entry) => entry.listingId === 'old').evictionReasons.includes('resident_age_limit_exceeded'), true);
  assert.equal(result.evictedListings.find((entry) => entry.listingId === 'stale').evictionReasons.includes('stale_listing_eligible'), true);
  assert.equal(result.evictedListings.find((entry) => entry.listingId === 'disappeared').evictionReasons.includes('disappeared_listing_eligible'), true);
});

test('retention compacts legacy listings and preserves API/UI fields', () => {
  const result = enforceActiveListingRetention({
    legacy: listing('legacy', 0)
  }, {
    maxResidentListings: 10
  }, {
    env: {},
    now: NOW
  });
  const retained = result.residentListings.legacy;

  assert.equal(retained.raw, undefined);
  assert.equal(retained.request, undefined);
  assert.equal(retained.ebayItemId, 'legacy');
  assert.equal(retained.title.includes('Retention Test Player'), true);
  assert.equal(retained.price > 0, true);
  assert.equal(retained.totalCost > 0, true);
  assert.equal(retained.url, 'https://example.test/legacy');
  assert.equal(retained.listingCompaction.compacted, true);
});

test('retention output is deterministic', () => {
  const first = enforceActiveListingRetention(listingMap(8), {
    maxResidentListings: 4,
    minProtectedNewestListings: 2
  }, {
    env: {},
    now: NOW
  });
  const second = enforceActiveListingRetention(listingMap(8), {
    maxResidentListings: 4,
    minProtectedNewestListings: 2
  }, {
    env: {},
    now: NOW
  });

  assert.deepEqual(first, second);
});

test('appStore load/save enforces resident retention without changing store shape', () => {
  const filePath = tempFile();
  const store = appStore.createDefaultStore();
  store.listings = listingMap(5);
  store.alerts = [{ id: 'alert-1' }];
  store.scans = [{ id: 'scan-1' }];
  store.rejections = [{ id: 'rejection-1' }];

  appStore.saveStore(filePath, store, {
    activeListingRetentionPolicy: {
      maxResidentListings: 3,
      minProtectedNewestListings: 1
    },
    env: {},
    now: NOW
  });

  const persisted = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert.deepEqual(Object.keys(persisted), ['listings', 'alerts', 'scans', 'rejections', 'settings']);
  assert.equal(Object.keys(persisted.listings).length, 3);
  assert.equal(persisted.listings['listing-5'].title.includes('Retention Test Player'), true);

  const loaded = appStore.loadStore(filePath, appStore.createDefaultStore(), {
    activeListingRetentionPolicy: {
      maxResidentListings: 3,
      minProtectedNewestListings: 1
    },
    env: {},
    now: NOW
  });

  assert.deepEqual(Object.keys(loaded), ['listings', 'alerts', 'scans', 'rejections', 'settings']);
  assert.deepEqual(Object.keys(loaded.listings).sort(), ['listing-3', 'listing-4', 'listing-5']);
});

test('applyActiveListingRetentionToStore returns a compatible store copy without mutating input', () => {
  const store = appStore.createDefaultStore();
  store.listings = listingMap(4);
  const before = JSON.stringify(store);
  const result = applyActiveListingRetentionToStore(store, {
    maxResidentListings: 2,
    minProtectedNewestListings: 1
  }, {
    env: {},
    now: NOW
  });

  assert.equal(JSON.stringify(store), before);
  assert.deepEqual(Object.keys(result.store), ['listings', 'alerts', 'scans', 'rejections', 'settings']);
  assert.deepEqual(Object.keys(result.store.listings).sort(), ['listing-3', 'listing-4']);
  assert.equal(result.retention.evictedCount, 2);
});
