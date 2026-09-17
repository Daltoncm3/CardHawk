'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { createScoutScanner } = require('../services/scoutScannerService');
const {
  buildTargetedDiscoveryQueries,
  createTargetedDiscoveryLaneConfig,
  createTargetedDiscoveryLaneService
} = require('../services/targetedDiscoveryLaneService');
const {
  DEFAULT_TARGETED_DISCOVERY_OBSERVATION_LIMIT,
  getTargetedDiscoveryObservation,
  listTargetedDiscoveryObservations,
  recordTargetedDiscoveryObservation
} = require('../utils/targetedDiscoveryObservationStore');

function listing(id, overrides = {}) {
  return {
    ebayItemId: id,
    marketplaceListingId: id,
    marketplace: 'ebay',
    title: '2023 Panini Prizm UFC Anthony Hernandez #181 Silver Prizm RC Rookie',
    price: 12,
    shipping: 1,
    totalCost: 13,
    currency: 'USD',
    buyingOptions: ['FIXED_PRICE'],
    itemCreationDate: '2026-07-10T11:00:00.000Z',
    url: `https://example.test/${id}`,
    ...overrides
  };
}

function createHarness(overrides = {}) {
  const saved = [];
  const calls = [];
  const store = overrides.store || {
    listings: {},
    alerts: [],
    scans: [],
    rejections: [],
    targetedDiscoveryObservations: []
  };
  const queries = buildTargetedDiscoveryQueries(createTargetedDiscoveryLaneConfig({}, {}));
  const pages = overrides.pages || {};
  const config = createTargetedDiscoveryLaneConfig({}, {
    enabled: true,
    pageLimit: 4,
    maxPages: 2,
    maxRequests: 4,
    maxResults: 20,
    ...overrides.config
  });
  const nowValues = [...(overrides.nowValues || ['2026-07-10T12:00:00.000Z'])];
  const now = () => nowValues.length > 1 ? nowValues.shift() : nowValues[0];

  const service = createTargetedDiscoveryLaneService({
    activeMarketplace: {
      config: { searchDelayMs: 0 },
      searchPageWithBackoff: async (query, limit, options) => {
        calls.push({ query, limit, options });
        return {
          query,
          offset: options.offset || 0,
          limit,
          items: pages[`${query}:${options.offset || 0}`] || []
        };
      },
      compactError: (error) => error.message,
      isRateLimitError: () => false
    },
    config,
    getStore: () => store,
    historyEngine: {
      getListing: (id) => overrides.historyRecords?.[id] || null
    },
    parseCardTitle: () => ({}),
    recordTargetedDiscoveryObservation: (input) => recordTargetedDiscoveryObservation(store, input, {
      limit: overrides.observationLimit
    }),
    saveScoutedListing: (item, query, lane) => {
      const savedListing = { ...item, query, lane };
      saved.push(savedListing);
      store.listings[item.ebayItemId] = savedListing;
      return savedListing;
    },
    sleep: async () => {},
    now
  });

  return { calls, queries, saved, service, store };
}

test('cheap-rejected targeted result creates a durable non-authoritative observation', async () => {
  const { queries, saved, service, store } = createHarness({
    pages: {
      [`${buildTargetedDiscoveryQueries(createTargetedDiscoveryLaneConfig({}, {}))[0]}:0`]: [
        listing('poster-1', {
          title: 'Anthony Hernandez UFC poster print',
          totalCost: 9
        })
      ]
    }
  });

  const result = await service.run({ scanId: 'scan-a2-3-rejected' });
  const observation = getTargetedDiscoveryObservation(store, {
    laneId: 'ufc_prizm_anthony_hernandez_silver_rookie',
    listingId: 'poster-1'
  });

  assert.equal(queries.length > 0, true);
  assert.equal(result.report.rawResults, 1);
  assert.equal(result.report.cheaplyRejectedListings, 1);
  assert.equal(result.report.candidatesPreserved, 0);
  assert.deepEqual(saved, []);
  assert.equal(observation.title, 'Anthony Hernandez UFC poster print');
  assert.equal(observation.cheapTriage.rejected, true);
  assert.equal(observation.cheapTriage.reason, 'excluded_keyword');
  assert.equal(observation.candidatePreserved, false);
  assert.equal(observation.productionImpact, 'none');
  assert.equal(observation.decisionImpact, 'none');
  assert.equal(observation.executionAuthority, 'none');
  assert.equal(observation.soldEvidenceImpact, 'none');
  assert.equal(observation.canonicalSoldEvidenceEligible, false);
  assert.equal(observation.valuationComparableEligible, false);
  assert.equal(observation.buyNowEligible, false);
});

test('accepted targeted result creates an observation and still follows saveScoutedListing', async () => {
  const baseQueries = buildTargetedDiscoveryQueries(createTargetedDiscoveryLaneConfig({}, {}));
  const { saved, service, store } = createHarness({
    pages: {
      [`${baseQueries[0]}:0`]: [listing('candidate-1')]
    }
  });

  const result = await service.run({ scanId: 'scan-a2-3-accepted' });
  const observation = getTargetedDiscoveryObservation(store, { listingId: 'candidate-1' });

  assert.equal(result.report.candidatesPreserved, 1);
  assert.equal(saved.length, 1);
  assert.equal(store.listings['candidate-1'].targetedDiscovery.laneId, 'ufc_prizm_anthony_hernandez_silver_rookie');
  assert.equal(observation.candidatePreserved, true);
  assert.equal(observation.cheapTriage.rejected, false);
  assert.equal(observation.price, 12);
  assert.equal(observation.totalCost, 13);
  assert.equal(observation.url, 'https://example.test/candidate-1');
  assert.equal(observation.listingType, 'FIXED_PRICE');
  assert.equal(observation.marketplaceStartTimestamp, '2026-07-10T11:00:00.000Z');
  assert.equal(observation.freshnessAvailable, true);
  assert.equal(observation.ageAtObservationMs, 3600000);
});

test('repeated observation deduplicates and preserves first-seen/last-seen semantics', async () => {
  const baseQueries = buildTargetedDiscoveryQueries(createTargetedDiscoveryLaneConfig({}, {}));
  const store = {
    listings: {},
    alerts: [],
    scans: [],
    rejections: [],
    targetedDiscoveryObservations: []
  };
  const first = createHarness({
    store,
    nowValues: ['2026-07-10T12:00:00.000Z'],
    pages: {
      [`${baseQueries[0]}:0`]: [listing('repeat-1')]
    }
  });
  await first.service.run({ scanId: 'scan-first' });

  const second = createHarness({
    store,
    nowValues: ['2026-07-10T12:05:00.000Z'],
    pages: {
      [`${baseQueries[0]}:0`]: [listing('repeat-1', { price: 11, totalCost: 12 })]
    }
  });
  await second.service.run({ scanId: 'scan-second' });

  const observations = listTargetedDiscoveryObservations(store, { listingId: 'repeat-1' });
  assert.equal(observations.length, 1);
  assert.equal(observations[0].firstObservedAt, '2026-07-10T12:00:00.000Z');
  assert.equal(observations[0].lastObservedAt, '2026-07-10T12:05:00.000Z');
  assert.equal(observations[0].observationCount, 2);
  assert.equal(observations[0].price, 11);
});

test('observation retention is bounded deterministically', () => {
  const store = { targetedDiscoveryObservations: [] };

  for (let index = 0; index < 6; index += 1) {
    recordTargetedDiscoveryObservation(store, {
      listing: listing(`bounded-${index}`),
      laneId: 'lane',
      laneName: 'Lane',
      query: 'query',
      observedAt: `2026-07-10T12:0${index}:00.000Z`,
      triage: { rejected: true, reason: 'test_rejection' }
    }, {
      limit: 3
    });
  }

  assert.equal(store.targetedDiscoveryObservations.length, 3);
  assert.deepEqual(
    store.targetedDiscoveryObservations.map((entry) => entry.listingId),
    ['bounded-5', 'bounded-4', 'bounded-3']
  );
  assert.equal(DEFAULT_TARGETED_DISCOVERY_OBSERVATION_LIMIT, 500);
});

test('observation persistence introduces no additional marketplace requests', async () => {
  const baseQueries = buildTargetedDiscoveryQueries(createTargetedDiscoveryLaneConfig({}, {}));
  const { calls, service } = createHarness({
    config: { maxRequests: 1 },
    pages: {
      [`${baseQueries[0]}:0`]: [
        listing('candidate-a'),
        listing('poster-a', { title: 'Anthony Hernandez poster print' })
      ]
    }
  });

  await service.run({ scanId: 'scan-no-extra-requests' });

  assert.equal(calls.length, 1);
});

test('scanner integration persists observation state through public targeted lane path without changing authority', async () => {
  const store = {
    listings: {},
    alerts: [],
    scans: [],
    rejections: [],
    targetedDiscoveryObservations: []
  };
  let dirtyReasons = [];
  const targetedDiscoveryLane = {
    isEnabled: () => true,
    run: async () => {
      recordTargetedDiscoveryObservation(store, {
        listing: listing('scanner-observed', { title: 'Anthony Hernandez poster print' }),
        laneId: 'ufc_prizm_anthony_hernandez_silver_rookie',
        laneName: 'UFC Prizm Anthony Hernandez Silver Rookie',
        query: 'query',
        observedAt: '2026-07-10T12:00:00.000Z',
        triage: { rejected: true, reason: 'excluded_keyword' }
      });
      return {
        report: {
          laneId: 'ufc_prizm_anthony_hernandez_silver_rookie',
          rawResults: 1,
          uniqueListings: 1,
          newListings: 0,
          previouslyObservedListings: 0,
          duplicateCount: 0,
          candidatesPreserved: 0,
          apiErrors: [],
          productionImpact: 'none',
          decisionImpact: 'none',
          executionAuthority: 'none'
        },
        savedListings: []
      };
    }
  };
  const scanner = createScoutScanner({
    activeMarketplace: {
      config: { scanQueryLimit: 8, searchDelayMs: 0, laneDelayMs: 0 },
      searchWithBackoff: async () => [],
      compactError: (error) => error.message || String(error),
      isRateLimitError: () => false
    },
    decisionValidationEngine: { recordOutcome() {}, beginPersistenceBatch() {}, flushPersistenceBatch() {} },
    getStore: () => store,
    historyEngine: {
      recordScan: () => ({ observedCount: 0, trackedCount: 0, activeCount: 0, newListings: [], priceDrops: [], disappeared: [] })
    },
    lanes: { all: { queries: [] }, broad: { queries: [] } },
    learningEngine: { recordListingOutcome() {}, recordScanOutcome: () => ({ stale: [] }), beginPersistenceBatch() {}, flushPersistenceBatch() {} },
    listingIdentity: { getListingId: (item) => item.ebayItemId },
    parseCardTitle: () => ({}),
    persistenceCoordinator: {
      beginPersistenceBatch() {},
      markStateDirty(reason) { dirtyReasons.push(reason); },
      flushPersistenceBatch() {}
    },
    predictionAccuracyEngine: { recordOutcome() {}, beginPersistenceBatch() {}, flushPersistenceBatch() {} },
    saveScoutedListing: () => {
      throw new Error('cheap-rejected observation must not be saved as candidate');
    },
    saveStore() {},
    shadowModeLogger: { beginPersistenceBatch() {}, flushPersistenceBatch() {} },
    sleep: async () => {},
    systemHealth: { finishScan() {}, markScanSkipped() {}, recordScanEngine() {}, setEngine() {}, startScan() {} },
    targetedDiscoveryLane
  });

  const scan = await scanner.runScoutScan('test');

  assert.equal(scan.status, 'completed');
  assert.equal(scan.targetedDiscovery.rawResults, 1);
  assert.equal(store.listings['scanner-observed'], undefined);
  assert.equal(store.rejections.length, 0);
  assert.equal(store.alerts.length, 0);
  assert.equal(getTargetedDiscoveryObservation(store, { listingId: 'scanner-observed' }).soldEvidenceImpact, 'none');
  assert.equal(dirtyReasons.includes('scan_finished'), true);
});
