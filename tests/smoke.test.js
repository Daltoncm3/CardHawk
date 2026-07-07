'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const appStore = require('../utils/appStore');
const engineMetricsEngine = require('../engines/engineMetricsEngine');
const listingIdentity = require('../utils/listingIdentity');
const mockMarketplace = require('../marketplaces/mockMarketplace');
const stateStore = require('../utils/stateStore');

function makeTempFile(name = 'state.json') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cardhawk-smoke-'));
  return {
    directory,
    filePath: path.join(directory, name)
  };
}

test('stateStore handles missing, saved, and corrupt JSON state safely', () => {
  const { directory, filePath } = makeTempFile('cardhawk-data.json');
  const fallback = { listings: {}, alerts: [], scans: [], rejections: [], settings: { minDealScore: 85 } };

  assert.deepEqual(stateStore.loadJsonState(filePath, fallback), fallback);

  const savedState = { ...fallback, alerts: [{ id: 'alert-1' }] };
  stateStore.saveJsonState(filePath, savedState);
  assert.deepEqual(stateStore.loadJsonState(filePath, fallback), savedState);

  fs.writeFileSync(filePath, '{ broken json');
  assert.deepEqual(stateStore.loadJsonState(filePath, fallback), fallback);

  const backups = fs.readdirSync(directory).filter((name) =>
    name.startsWith('cardhawk-data.json.corrupt-') && name.endsWith('.bak')
  );
  assert.equal(backups.length, 1);
});

test('appStore preserves CardHawk store shape and lookup compatibility', () => {
  const defaultStore = appStore.createDefaultStore();
  assert.deepEqual(Object.keys(defaultStore), ['listings', 'alerts', 'scans', 'rejections', 'settings']);
  assert.deepEqual(defaultStore.settings, {
    minDealScore: 85,
    minProfit: 20,
    minRoi: 0.25
  });

  const normalized = appStore.normalizeStore({
    listings: {
      legacy123: {
        ebayItemId: 'legacy123',
        listingId: 'canonical123',
        title: 'Smoke Test Card'
      }
    },
    alerts: [{ id: 'alert-1' }],
    scans: [{ id: 'scan-1' }],
    rejections: [{ id: 'reject-1' }],
    settings: {
      minDealScore: 91,
      minProfit: 25,
      minRoi: 0.35
    }
  });

  assert.equal(normalized.settings.minDealScore, 91);
  assert.equal(appStore.getStoredListingById(normalized, 'legacy123').title, 'Smoke Test Card');
  assert.equal(appStore.getStoredListingById(normalized, 'canonical123').title, 'Smoke Test Card');
  assert.equal(appStore.getStoredListingById(normalized, 'missing'), null);
});

test('appStore load/save uses temp files and does not touch production data', () => {
  const { filePath } = makeTempFile('cardhawk-data.json');
  const store = appStore.createDefaultStore();
  store.listings.smoke = { ebayItemId: 'smoke', title: 'Temp Path Only' };

  appStore.saveStore(filePath, store);
  const loaded = appStore.loadStore(filePath, appStore.createDefaultStore());

  assert.equal(loaded.listings.smoke.title, 'Temp Path Only');
});

test('listingIdentity resolves IDs in canonical priority order', () => {
  assert.equal(listingIdentity.getListingId({
    listingId: 'listing',
    marketplaceListingId: 'marketplace',
    ebayItemId: 'ebay',
    itemId: 'item',
    id: 'id'
  }), 'listing');

  assert.equal(listingIdentity.getListingId({ marketplaceListingId: 'marketplace', ebayItemId: 'ebay' }), 'marketplace');
  assert.equal(listingIdentity.getListingId({ ebayItemId: 'ebay', itemId: 'item' }), 'ebay');
  assert.equal(listingIdentity.getListingId({ itemId: 'item', id: 'id' }), 'item');
  assert.equal(listingIdentity.getListingId({ id: 'id' }), 'id');
  assert.equal(listingIdentity.getListingId('direct'), 'direct');
});

test('mock marketplace emits normalized listings with ebayItemId compatibility alias', async () => {
  const parsedTitle = { qualityTier: 'mock' };
  const listing = mockMarketplace.normalizeItem({
    itemId: 'mock-1',
    title: 'Mock Listing',
    price: 12,
    shipping: 3
  }, {
    parseCardTitle: () => parsedTitle
  });

  assert.equal(listing.listingId, 'mock-1');
  assert.equal(listing.marketplace, 'mock');
  assert.equal(listing.marketplaceListingId, 'mock-1');
  assert.equal(listing.marketplaceLabel, 'Mock Marketplace');
  assert.equal(listing.ebayItemId, 'mock-1');
  assert.equal(listing.totalCost, 15);
  assert.deepEqual(listing.parsed, parsedTitle);

  const results = await mockMarketplace.search('Smoke Card', 2);
  assert.equal(results.length, 2);
  assert.ok(results.every((item) => item.listingId && item.marketplace === 'mock' && item.ebayItemId));
});

test('engineMetricsEngine summarizes production counters safely', () => {
  const metrics = engineMetricsEngine.summarizeEngineMetrics({
    listings: { one: {}, two: {} },
    alerts: [{ id: 'alert-1' }],
    rejections: [{ id: 'reject-1' }, { id: 'reject-2' }],
    scans: [
      { status: 'completed', durationMs: 1000, listingsFound: 4, newAlerts: 1 },
      { status: 'failed', durationMs: 2000, listingsFound: 0, newAlerts: 0 },
      { status: 'rate_limited', rateLimited: true, durationMs: 3000, listingsFound: 1, newAlerts: 0 }
    ]
  }, {
    status: 'warning',
    engines: {
      scout: { name: 'scout', status: 'warning', updatedAt: '2026-01-01T00:00:00.000Z' }
    },
    data: { recentFailures: 2 }
  });

  assert.equal(metrics.source, 'engine_metrics_engine');
  assert.equal(metrics.scans.totalScans, 3);
  assert.equal(metrics.scans.completedScans, 1);
  assert.equal(metrics.scans.failedScans, 1);
  assert.equal(metrics.scans.rateLimitedScans, 1);
  assert.equal(metrics.alerts.totalAlerts, 1);
  assert.equal(metrics.alerts.totalRejections, 2);
  assert.equal(metrics.data.totalListings, 2);
  assert.equal(metrics.health.overallStatus, 'warning');
});

test('server route-method hardening remains in place without importing server.js', () => {
  const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

  assert.match(serverSource, /app\.get\("\/api\/alerts\/send-pending", \(req, res\) => \{\s+res\.setHeader\("Allow", "POST"\);\s+res\.status\(405\)/);
  assert.match(serverSource, /app\.post\("\/api\/alerts\/send-pending", async \(req, res\) => \{/);
  assert.match(serverSource, /app\.post\("\/api\/notifications\/test", async \(req, res\) => \{/);
  assert.match(serverSource, /app\.get\("\/api\/notifications\/test", \(req, res\) => \{\s+res\.setHeader\("Allow", "POST"\);\s+res\.status\(405\)/);
});
