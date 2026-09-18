'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { createScoutScanner } = require('../services/scoutScannerService');
const {
  buildTargetedDiscoveryQueries,
  createMultiTargetedDiscoveryLaneService,
  classifyListingForCheapTriage,
  createTargetedDiscoveryLaneConfig,
  createTargetedDiscoveryLaneConfigs,
  createTargetedDiscoveryLaneService,
  evaluateLaneIdentityMatch,
  shouldAttachLaneParsedIdentity,
  summarizeFreshness
} = require('../services/targetedDiscoveryLaneService');

function listing(id, overrides = {}) {
  return {
    ebayItemId: id,
    marketplaceListingId: id,
    marketplace: 'ebay',
    title: '2023 Panini Prizm UFC Anthony Hernandez #181 Silver Prizm RC Rookie',
    price: 12,
    shipping: 1,
    totalCost: 13,
    buyingOptions: ['FIXED_PRICE'],
    itemCreationDate: '2026-07-10T11:00:00.000Z',
    url: `https://example.test/${id}`,
    ...overrides
  };
}

function createHarness(overrides = {}) {
  const saved = [];
  const calls = [];
  const historyRecords = new Map(Object.entries(overrides.historyRecords || {}));
  const store = overrides.store || { listings: {} };
  const pages = overrides.pages || {};
  const errors = overrides.errors || {};
  const config = createTargetedDiscoveryLaneConfig({}, {
    enabled: true,
    pageLimit: 2,
    maxPages: 3,
    maxRequests: 6,
    maxResults: 20,
    ...overrides.config
  });

  const service = createTargetedDiscoveryLaneService({
    activeMarketplace: {
      config: { searchDelayMs: 0 },
      searchPageWithBackoff: async (query, limit, options) => {
        calls.push({ query, limit, options });
        const key = `${query}:${options.offset || 0}`;
        if (errors[key]) throw new Error(errors[key]);
        return {
          query,
          offset: options.offset || 0,
          limit,
          items: pages[key] || []
        };
      },
      compactError: (error) => error.message,
      isRateLimitError: (error) => /rate/i.test(error.message || '')
    },
    config,
    getStore: () => store,
    historyEngine: {
      getListing: (id) => historyRecords.get(id) || null
    },
    parseCardTitle: () => ({}),
    saveScoutedListing: (item, query, lane) => {
      const savedListing = { ...item, query, lane };
      saved.push(savedListing);
      store.listings[item.ebayItemId] = savedListing;
      return savedListing;
    },
    sleep: async () => {},
    now: () => overrides.now || '2026-07-10T12:00:00.000Z'
  });

  return { calls, config, saved, service, store };
}

function createMultiHarness(overrides = {}) {
  const saved = [];
  const calls = [];
  const observations = [];
  const store = overrides.store || { listings: {} };
  const lanes = overrides.lanes || [
    createTargetedDiscoveryLaneConfig({}, {
      enabled: true,
      laneId: 'anthony_lane',
      laneName: 'Anthony Hernandez Lane',
      players: ['Anthony Hernandez'],
      year: '2023',
      product: 'Panini Prizm UFC',
      setName: 'Prizm',
      cardNumber: '181',
      keywords: ['Silver Prizm', 'rookie', 'RC'],
      pageLimit: 1,
      maxPages: 2,
      maxRequests: 2,
      maxResults: 10
    }),
    createTargetedDiscoveryLaneConfig({}, {
      enabled: true,
      laneId: 'brandon_lane',
      laneName: 'Brandon Miller Lane',
      sport: 'basketball',
      players: ['Brandon Miller'],
      year: '2023-24',
      product: 'Panini Prizm',
      setName: 'Prizm',
      cardNumber: '152',
      keywords: ['Silver Prizm', 'rookie', 'RC'],
      pageLimit: 1,
      maxPages: 2,
      maxRequests: 2,
      maxResults: 10
    })
  ];
  const service = createMultiTargetedDiscoveryLaneService({
    activeMarketplace: {
      config: { searchDelayMs: 0 },
      searchPageWithBackoff: async (query, limit, options) => {
        calls.push({ query, limit, options });
        const key = `${query}:${options.offset || 0}`;
        return {
          query,
          offset: options.offset || 0,
          limit,
          items: overrides.pages?.[key] || []
        };
      },
      compactError: (error) => error.message,
      isRateLimitError: () => false
    },
    config: {
      enabled: true,
      maxActiveLanes: overrides.maxActiveLanes ?? 3,
      maxTotalRequests: overrides.maxTotalRequests ?? 4
    },
    lanes,
    getStore: () => store,
    historyEngine: { getListing: () => null },
    parseCardTitle: () => ({}),
    recordTargetedDiscoveryObservation: (input) => {
      observations.push(input);
    },
    saveScoutedListing: (item, query, lane) => {
      const savedListing = {
        ...item,
        query,
        lane,
        marketData: item.marketData || { source: 'sold_market', soldCompCount: 3 },
        soldSales: item.soldSales || { saleCount: 3, sales: [{}, {}, {}] },
        dealGate: item.dealGate || { passed: false, gate: { soldCompCount: 3 } }
      };
      saved.push(savedListing);
      store.listings[item.ebayItemId] = savedListing;
      return savedListing;
    },
    sleep: async () => {},
    now: () => overrides.now || '2026-07-10T12:00:00.000Z'
  });

  return { calls, lanes, observations, saved, service, store };
}

test('A2 targeted lane configuration is disabled by default and preserves explicit scope', () => {
  const config = createTargetedDiscoveryLaneConfig({});

  assert.equal(config.enabled, false);
  assert.equal(config.laneId, 'ufc_prizm_anthony_hernandez_silver_rookie');
  assert.deepEqual(config.players, ['Anthony Hernandez']);
  assert.equal(config.priceMax, 25);
  assert.equal(config.sort, 'newlyListed');
});

test('A2 query generation is deterministic and scoped to the target identity', () => {
  const queries = buildTargetedDiscoveryQueries(createTargetedDiscoveryLaneConfig({}, {
    players: ['Anthony Hernandez'],
    year: '2023',
    product: 'Panini Prizm UFC',
    setName: 'Prizm',
    cardNumber: '181',
    keywords: ['Silver Prizm', 'rookie']
  }));

  assert.deepEqual(queries, [
    '2023 Panini Prizm UFC Anthony Hernandez #181 Silver Prizm rookie',
    'Anthony Hernandez 2023 Prizm #181 Silver Prizm rookie'
  ]);
});

test('A2 request budget and pagination stop deterministically', async () => {
  const baseConfig = createTargetedDiscoveryLaneConfig({}, { pageLimit: 2, maxPages: 3, maxRequests: 3 });
  const queries = buildTargetedDiscoveryQueries(baseConfig);
  const { calls, service } = createHarness({
    config: { maxRequests: 3 },
    pages: {
      [`${queries[0]}:0`]: [listing('page-1-a'), listing('page-1-b')],
      [`${queries[0]}:2`]: [listing('page-2-a'), listing('page-2-b')],
      [`${queries[0]}:4`]: [listing('page-3-a'), listing('page-3-b')]
    }
  });

  const result = await service.run({ scanId: 'scan-a2-budget' });

  assert.equal(calls.length, 3);
  assert.equal(result.report.apiRequests, 3);
  assert.equal(result.report.pagesRequested, 3);
  assert.equal(result.report.budget.budgetReached, true);
});

test('A2 duplicates across pages and queries are collapsed before saving', async () => {
  const queries = buildTargetedDiscoveryQueries(createTargetedDiscoveryLaneConfig({}, { pageLimit: 2 }));
  const { saved, service } = createHarness({
    pages: {
      [`${queries[0]}:0`]: [listing('dup-1'), listing('unique-1')],
      [`${queries[0]}:2`]: [listing('dup-1'), listing('unique-2')],
      [`${queries[1]}:0`]: [listing('unique-2'), listing('unique-3')]
    }
  });

  const result = await service.run({ scanId: 'scan-a2-dupes' });

  assert.equal(result.report.duplicateCount, 2);
  assert.deepEqual(saved.map((item) => item.ebayItemId).sort(), ['dup-1', 'unique-1', 'unique-2', 'unique-3']);
});

test('A2 new versus previously observed listing classification preserves first observation context', async () => {
  const queries = buildTargetedDiscoveryQueries(createTargetedDiscoveryLaneConfig({}, { pageLimit: 2 }));
  const { saved, service } = createHarness({
    historyRecords: {
      'seen-before': { ebayItemId: 'seen-before', firstSeenAt: '2026-07-09T12:00:00.000Z' }
    },
    pages: {
      [`${queries[0]}:0`]: [listing('seen-before'), listing('brand-new')]
    }
  });

  const result = await service.run({ scanId: 'scan-a2-history' });

  assert.equal(result.report.newListings, 1);
  assert.equal(result.report.previouslyObservedListings, 1);
  assert.equal(saved.find((item) => item.ebayItemId === 'seen-before').targetedDiscovery.firstObservedAt, '2026-07-09T12:00:00.000Z');
  assert.equal(saved.find((item) => item.ebayItemId === 'brand-new').targetedDiscovery.firstObservedAt, '2026-07-10T12:00:00.000Z');
});

test('A2 marketplace freshness is measured only when timestamps are available', async () => {
  const queries = buildTargetedDiscoveryQueries(createTargetedDiscoveryLaneConfig({}, { pageLimit: 2 }));
  const { saved, service } = createHarness({
    pages: {
      [`${queries[0]}:0`]: [
        listing('fresh-1', { itemCreationDate: '2026-07-10T11:30:00.000Z' }),
        listing('unknown-freshness', { itemCreationDate: null })
      ]
    }
  });

  const result = await service.run({ scanId: 'scan-a2-freshness' });

  assert.equal(result.report.freshness.available, true);
  assert.equal(result.report.freshness.minAgeMinutes, 30);
  assert.equal(saved.find((item) => item.ebayItemId === 'unknown-freshness').targetedDiscovery.ageAtFirstObservationMs, null);
  assert.equal(summarizeFreshness([]).available, false);
});

test('A2 cheap triage rejects obvious noise and preserves plausible ambiguity', () => {
  const config = createTargetedDiscoveryLaneConfig({}, {});

  assert.equal(classifyListingForCheapTriage(listing('bad-price', { price: 0, totalCost: 0 }), config).reason, 'missing_or_invalid_price');
  assert.equal(classifyListingForCheapTriage(listing('poster', { title: 'Anthony Hernandez UFC poster' }), config).reason, 'excluded_keyword');
  assert.equal(classifyListingForCheapTriage(listing('ambiguous', {
    title: 'Anthony Hernandez Silver Prizm Rookie UFC Card'
  }), config).rejected, false);
});

test('A2 API errors are isolated in the structured report', async () => {
  const queries = buildTargetedDiscoveryQueries(createTargetedDiscoveryLaneConfig({}, { pageLimit: 2 }));
  const { service } = createHarness({
    pages: {
      [`${queries[1]}:0`]: [listing('after-error')]
    },
    errors: {
      [`${queries[0]}:0`]: 'temporary api failure'
    }
  });

  const result = await service.run({ scanId: 'scan-a2-error' });

  assert.equal(result.report.status, 'completed_with_errors');
  assert.equal(result.report.apiErrors.length, 1);
  assert.equal(result.report.candidatesPreserved, 1);
});

test('A2 report contains discovery metrics and non-authoritative boundaries', async () => {
  const queries = buildTargetedDiscoveryQueries(createTargetedDiscoveryLaneConfig({}, { pageLimit: 2 }));
  const { service } = createHarness({
    config: { maxRequests: 1 },
    pages: {
      [`${queries[0]}:0`]: [listing('metric-1'), listing('metric-2')]
    }
  });

  const result = await service.run({ scanId: 'scan-a2-report' });

  assert.equal(result.report.runId, 'scan-a2-report:ufc_prizm_anthony_hernandez_silver_rookie');
  assert.equal(result.report.rawResults, 2);
  assert.equal(result.report.uniqueListings, 2);
  assert.equal(result.report.requestEfficiency.newListingsPerRequest, 2);
  assert.equal(result.report.productionImpact, 'none');
  assert.equal(result.report.decisionImpact, 'none');
  assert.equal(result.report.executionAuthority, 'none');
  assert.equal(Object.hasOwn(result.report, 'purchaseAutomation'), false);
  assert.equal(Object.hasOwn(result.report, 'bidAutomation'), false);
  assert.equal(Object.hasOwn(result.report, 'offerAutomation'), false);
});

test('A4 multiple targeted lanes execute in one bounded run with lane metrics', async () => {
  const { lanes } = createMultiHarness();
  const anthonyQuery = buildTargetedDiscoveryQueries(lanes[0])[0];
  const brandonQuery = buildTargetedDiscoveryQueries(lanes[1])[0];
  const { calls, observations, saved, service } = createMultiHarness({
    pages: {
      [`${anthonyQuery}:0`]: [listing('anthony-a4', {
        title: '2023 Panini Prizm UFC Anthony Hernandez #181 Silver Prizm RC Rookie'
      })],
      [`${brandonQuery}:0`]: [listing('brandon-a4', {
        title: '2023-24 Panini Prizm Brandon Miller #152 Silver Prizm RC Rookie'
      })]
    }
  });

  const result = await service.run({ scanId: 'scan-a4-multi' });

  assert.equal(calls.length, 4);
  assert.equal(result.report.lanesExecuted, 2);
  assert.equal(result.report.laneReports.length, 2);
  assert.equal(result.report.rawResults, 2);
  assert.equal(result.report.uniqueListings, 2);
  assert.equal(result.report.candidatesPreserved, 2);
  assert.equal(result.report.candidatePipeline.soldEvidenceLookupReached, 2);
  assert.equal(result.report.candidatePipeline.sufficientSoldEvidenceListings, 2);
  assert.deepEqual(saved.map((item) => item.targetedDiscovery.laneId).sort(), ['anthony_lane', 'brandon_lane']);
  assert.deepEqual(observations.map((item) => item.laneId).sort(), ['anthony_lane', 'brandon_lane']);
});

test('A4 total targeted-discovery request budget cannot be exceeded', async () => {
  const { lanes } = createMultiHarness();
  const anthonyQueries = buildTargetedDiscoveryQueries(lanes[0]);
  const { calls, service } = createMultiHarness({
    maxTotalRequests: 2,
    pages: {
      [`${anthonyQueries[0]}:0`]: [listing('a4-budget-1')],
      [`${anthonyQueries[0]}:1`]: [listing('a4-budget-2')]
    }
  });

  const result = await service.run({ scanId: 'scan-a4-total-budget' });

  assert.equal(calls.length, 2);
  assert.equal(result.report.apiRequests, 2);
  assert.equal(result.report.budget.maxTotalRequests, 2);
  assert.equal(result.report.budget.budgetReached, true);
  assert.equal(result.report.lanesExecuted, 1);
});

test('A4 per-lane request limit cannot be exceeded even when total budget remains', async () => {
  const { lanes } = createMultiHarness();
  const limitedLane = { ...lanes[0], maxRequests: 1, maxPages: 3 };
  const query = buildTargetedDiscoveryQueries(limitedLane)[0];
  const { calls, service } = createMultiHarness({
    lanes: [limitedLane],
    maxTotalRequests: 5,
    pages: {
      [`${query}:0`]: [listing('a4-per-lane-1')]
    }
  });

  const result = await service.run({ scanId: 'scan-a4-per-lane-budget' });

  assert.equal(calls.length, 1);
  assert.equal(result.report.apiRequests, 1);
  assert.equal(result.report.laneReports[0].budget.effectiveMaxRequests, 1);
});

test('A4 candidate identity does not leak between lanes', async () => {
  const { lanes } = createMultiHarness();
  const anthonyQuery = buildTargetedDiscoveryQueries(lanes[0])[0];
  const brandonQuery = buildTargetedDiscoveryQueries(lanes[1])[0];
  const { saved, service } = createMultiHarness({
    pages: {
      [`${anthonyQuery}:0`]: [listing('anthony-identity', {
        title: '2023 Panini Prizm UFC Anthony Hernandez #181 Silver Prizm RC Rookie'
      })],
      [`${brandonQuery}:0`]: [listing('brandon-identity', {
        title: '2023-24 Panini Prizm Brandon Miller #152 Silver Prizm RC Rookie'
      })]
    }
  });

  await service.run({ scanId: 'scan-a4-identity-isolation' });

  const anthony = saved.find((item) => item.ebayItemId === 'anthony-identity');
  const brandon = saved.find((item) => item.ebayItemId === 'brandon-identity');
  assert.equal(anthony.parsedIdentity.player, 'Anthony Hernandez');
  assert.equal(anthony.parsedIdentity.cardNumber, '181');
  assert.equal(brandon.parsedIdentity.player, 'Brandon Miller');
  assert.equal(brandon.parsedIdentity.cardNumber, '152');
});

test('A4 incompatible or ambiguous lane result cannot inherit exact parsed identity', () => {
  const config = createTargetedDiscoveryLaneConfig({}, { enabled: true });
  const ambiguous = listing('ambiguous-a4', {
    title: 'Anthony Hernandez Silver Prizm Rookie UFC Card'
  });
  const incompatible = listing('wrong-a4', {
    title: '2023 Panini Donruss UFC Wrong Player #999 Base RC Rookie'
  });
  const ambiguousTriage = classifyListingForCheapTriage(ambiguous, config);
  const incompatibleTriage = classifyListingForCheapTriage(incompatible, config);

  assert.equal(ambiguousTriage.rejected, false);
  assert.equal(evaluateLaneIdentityMatch(ambiguous, config).ambiguous, true);
  assert.equal(shouldAttachLaneParsedIdentity(ambiguous, config, ambiguousTriage), false);
  assert.equal(incompatibleTriage.rejected, true);
  assert.equal(evaluateLaneIdentityMatch(incompatible, config).compatible, false);
  assert.equal(shouldAttachLaneParsedIdentity(incompatible, config, incompatibleTriage), false);
});

test('A4 lane JSON configuration supports multiple explicit lane definitions', () => {
  const lanes = createTargetedDiscoveryLaneConfigs({
    CARDHAWK_TARGETED_DISCOVERY_ENABLED: 'true',
    CARDHAWK_TARGETED_DISCOVERY_LANES_JSON: JSON.stringify([
      { laneId: 'lane_one', players: ['Anthony Hernandez'], cardNumber: '181' },
      { laneId: 'lane_two', players: ['Brandon Miller'], sport: 'basketball', cardNumber: '152' }
    ])
  });

  assert.equal(lanes.length, 2);
  assert.equal(lanes[0].laneId, 'lane_one');
  assert.deepEqual(lanes[1].players, ['Brandon Miller']);
  assert.equal(lanes[1].enabled, true);
});

test('A2 disabled lane performs no marketplace requests and returns a disabled report', async () => {
  const service = createTargetedDiscoveryLaneService({
    activeMarketplace: {
      searchPageWithBackoff: async () => {
        throw new Error('should not be called');
      }
    },
    config: createTargetedDiscoveryLaneConfig({}, { enabled: false }),
    now: () => '2026-07-10T12:00:00.000Z'
  });

  const result = await service.run({ scanId: 'scan-a2-disabled' });

  assert.equal(service.isEnabled(), false);
  assert.equal(result.report.status, 'disabled');
  assert.equal(result.report.apiRequests, 0);
  assert.deepEqual(result.savedListings, []);
});

test('A2 broad scanner remains backwards compatible when targeted lane is disabled', async () => {
  const store = { listings: {}, alerts: [], scans: [], rejections: [] };
  let broadCalls = 0;
  let targetedCalls = 0;
  const scanner = createScoutScanner({
    activeMarketplace: {
      config: { scanQueryLimit: 8, searchDelayMs: 0, laneDelayMs: 0 },
      searchWithBackoff: async () => {
        broadCalls += 1;
        return [listing('broad-1')];
      },
      compactError: (error) => error.message || String(error),
      isRateLimitError: () => false
    },
    decisionValidationEngine: { recordOutcome() {}, beginPersistenceBatch() {}, flushPersistenceBatch() {} },
    getStore: () => store,
    historyEngine: {
      recordScan: () => ({ observedCount: 1, trackedCount: 1, activeCount: 1, newListings: [], priceDrops: [], disappeared: [] })
    },
    lanes: { all: { queries: [] }, broad: { queries: ['broad query'] } },
    learningEngine: { recordListingOutcome() {}, recordScanOutcome: () => ({ stale: [] }), beginPersistenceBatch() {}, flushPersistenceBatch() {} },
    listingIdentity: { getListingId: (item) => item.ebayItemId },
    parseCardTitle: () => ({}),
    predictionAccuracyEngine: { recordOutcome() {}, beginPersistenceBatch() {}, flushPersistenceBatch() {} },
    saveScoutedListing: (item) => {
      store.listings[item.ebayItemId] = item;
      return item;
    },
    saveStore() {},
    shadowModeLogger: { beginPersistenceBatch() {}, flushPersistenceBatch() {} },
    sleep: async () => {},
    systemHealth: { finishScan() {}, markScanSkipped() {}, recordScanEngine() {}, setEngine() {}, startScan() {} },
    targetedDiscoveryLane: {
      isEnabled: () => false,
      run: async () => {
        targetedCalls += 1;
        return { report: {}, savedListings: [] };
      }
    }
  });

  const scan = await scanner.runScoutScan('test');

  assert.equal(scan.status, 'completed');
  assert.equal(broadCalls, 1);
  assert.equal(targetedCalls, 0);
  assert.equal(scan.targetedDiscovery, undefined);
});
