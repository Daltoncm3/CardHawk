'use strict';

const DEFAULT_LANE_ID = 'ufc_prizm_anthony_hernandez_silver_rookie';
const DEFAULT_SCHEMA_VERSION = '1.0.0';
const DEFAULT_MULTI_LANE_ID = 'multi_targeted_discovery';
const DEFAULT_MAX_ACTIVE_TARGETED_LANES = 3;

const DEFAULT_EXCLUDED_TERMS = Object.freeze([
  'poster',
  'photo',
  'photograph',
  'print',
  'shirt',
  'jersey',
  'break',
  'box break',
  'case break',
  'pack',
  'box',
  'lot',
  'custom',
  'reprint',
  'digital',
  'proxy'
]);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function toPositiveInteger(value, fallback) {
  const number = Number(value);
  const fallbackNumber = Number(fallback);
  const safeFallback = Number.isFinite(fallbackNumber) && fallbackNumber > 0 ? Math.floor(fallbackNumber) : 1;
  if (!Number.isFinite(number) || number <= 0) return safeFallback;
  return Math.floor(number);
}

function toOptionalNumber(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s#.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitEnvList(value, fallback = []) {
  if (value === undefined || value === null || value === '') return [...fallback];
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeBuyingOptions(listingTypes = []) {
  return asArray(listingTypes)
    .map((type) => String(type || '').trim().toUpperCase())
    .filter((type) => type === 'FIXED_PRICE' || type === 'AUCTION');
}

function parseJsonArray(value) {
  if (value === undefined || value === null || value === '') return [];
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function createTargetedDiscoveryLaneConfig(env = process.env, overrides = {}) {
  const lane = {
    enabled: String(env.CARDHAWK_TARGETED_DISCOVERY_ENABLED || 'false').toLowerCase() === 'true',
    laneId: env.CARDHAWK_TARGETED_DISCOVERY_LANE_ID || DEFAULT_LANE_ID,
    laneName: env.CARDHAWK_TARGETED_DISCOVERY_LANE_NAME || 'UFC Prizm Anthony Hernandez Silver Rookie',
    sport: env.CARDHAWK_TARGETED_DISCOVERY_SPORT || 'ufc',
    players: splitEnvList(env.CARDHAWK_TARGETED_DISCOVERY_PLAYERS, ['Anthony Hernandez']),
    year: env.CARDHAWK_TARGETED_DISCOVERY_YEAR || '2023',
    product: env.CARDHAWK_TARGETED_DISCOVERY_PRODUCT || 'Panini Prizm UFC',
    setName: env.CARDHAWK_TARGETED_DISCOVERY_SET || 'Prizm',
    cardNumber: env.CARDHAWK_TARGETED_DISCOVERY_CARD_NUMBER || '181',
    keywords: splitEnvList(env.CARDHAWK_TARGETED_DISCOVERY_KEYWORDS, ['Silver Prizm', 'rookie', 'RC']),
    gradedTerms: splitEnvList(env.CARDHAWK_TARGETED_DISCOVERY_GRADED_TERMS, []),
    priceMin: toOptionalNumber(env.CARDHAWK_TARGETED_DISCOVERY_PRICE_MIN, null),
    priceMax: toOptionalNumber(env.CARDHAWK_TARGETED_DISCOVERY_PRICE_MAX, 25),
    listingTypes: normalizeBuyingOptions(splitEnvList(env.CARDHAWK_TARGETED_DISCOVERY_LISTING_TYPES, ['FIXED_PRICE', 'AUCTION'])),
    excludedTerms: splitEnvList(env.CARDHAWK_TARGETED_DISCOVERY_EXCLUDED_TERMS, DEFAULT_EXCLUDED_TERMS),
    sort: env.CARDHAWK_TARGETED_DISCOVERY_SORT || 'newlyListed',
    pageLimit: toPositiveInteger(env.CARDHAWK_TARGETED_DISCOVERY_PAGE_LIMIT || env.EBAY_SCAN_QUERY_LIMIT, 8),
    maxPages: toPositiveInteger(env.CARDHAWK_TARGETED_DISCOVERY_MAX_PAGES, 2),
    maxRequests: toPositiveInteger(env.CARDHAWK_TARGETED_DISCOVERY_MAX_REQUESTS, 4),
    maxResults: toPositiveInteger(env.CARDHAWK_TARGETED_DISCOVERY_MAX_RESULTS, 40)
  };

  return {
    ...lane,
    ...overrides,
    players: splitEnvList(overrides.players, asArray(overrides.players).length ? overrides.players : lane.players),
    keywords: splitEnvList(overrides.keywords, asArray(overrides.keywords).length ? overrides.keywords : lane.keywords),
    gradedTerms: splitEnvList(overrides.gradedTerms, asArray(overrides.gradedTerms).length ? overrides.gradedTerms : lane.gradedTerms),
    excludedTerms: splitEnvList(overrides.excludedTerms, asArray(overrides.excludedTerms).length ? overrides.excludedTerms : lane.excludedTerms),
    listingTypes: normalizeBuyingOptions(overrides.listingTypes || lane.listingTypes),
    pageLimit: toPositiveInteger(overrides.pageLimit ?? lane.pageLimit, 8),
    maxPages: toPositiveInteger(overrides.maxPages ?? lane.maxPages, 2),
    maxRequests: toPositiveInteger(overrides.maxRequests ?? lane.maxRequests, 4),
    maxResults: toPositiveInteger(overrides.maxResults ?? lane.maxResults, 40)
  };
}

function createTargetedDiscoveryLaneConfigs(env = process.env, overrides = {}) {
  const laneOverrides = Array.isArray(overrides.lanes)
    ? overrides.lanes
    : parseJsonArray(env.CARDHAWK_TARGETED_DISCOVERY_LANES_JSON);
  const maxActiveLanes = toPositiveInteger(
    overrides.maxActiveLanes ?? env.CARDHAWK_TARGETED_DISCOVERY_MAX_ACTIVE_LANES,
    DEFAULT_MAX_ACTIVE_TARGETED_LANES
  );
  const base = createTargetedDiscoveryLaneConfig(env, overrides);

  if (!laneOverrides.length) return [base];

  return laneOverrides.slice(0, maxActiveLanes).map((lane, index) => createTargetedDiscoveryLaneConfig(env, {
    ...base,
    ...lane,
    laneId: lane.laneId || `${DEFAULT_MULTI_LANE_ID}_${index + 1}`,
    laneName: lane.laneName || lane.name || `Targeted Discovery Lane ${index + 1}`
  }));
}

function buildTargetedDiscoveryQueries(config = {}) {
  const lane = createTargetedDiscoveryLaneConfig({}, config);
  const player = lane.players[0] || '';
  const core = [lane.year, lane.product, player, lane.cardNumber ? `#${lane.cardNumber}` : '', ...lane.keywords]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  const secondary = [player, lane.year, lane.setName, lane.cardNumber ? `#${lane.cardNumber}` : '', ...lane.keywords]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  return Array.from(new Set([core, secondary].filter(Boolean)));
}

function normalizeLaneTerm(value) {
  return normalizeText(value).replace(/^#/, '');
}

function inferTargetedDiscoveryParallel(config = {}) {
  const keyword = asArray(config.keywords)
    .find((term) => /\bsilver\s+prizm\b/i.test(String(term || '')));
  if (keyword) return 'Silver Prizm';
  return config.parallel || config.variation || null;
}

function buildTargetedDiscoveryParsedIdentity(config = {}) {
  const lane = createTargetedDiscoveryLaneConfig({}, config);
  const player = lane.players[0] || null;
  const year = Number(lane.year);
  const product = lane.product || '';
  const brand = /\bpanini\b/i.test(product) ? 'Panini' : null;
  const normalizedKeywords = asArray(lane.keywords).map((keyword) => normalizeText(keyword));

  return {
    category: 'sports_card',
    sport: lane.sport || null,
    player,
    year: Number.isFinite(year) ? year : lane.year || null,
    brand,
    product: product || null,
    setName: lane.setName || null,
    cardNumber: lane.cardNumber || null,
    parallel: inferTargetedDiscoveryParallel(lane),
    rookie: normalizedKeywords.some((keyword) => keyword === 'rookie' || keyword === 'rc'),
    autograph: false,
    memorabilia: false,
    serialNumbered: false
  };
}

function getLaneRequiredTerms(config = {}) {
  return [
    ...asArray(config.players),
    config.year,
    config.setName || config.product,
    config.cardNumber
  ].filter(Boolean);
}

function evaluateLaneIdentityMatch(listing = {}, config = {}) {
  const normalizedTitle = normalizeText(listing.title || '');
  const requiredTerms = getLaneRequiredTerms(config);
  const missingTerms = requiredTerms.filter((term) => !normalizedTitle.includes(normalizeLaneTerm(term)));

  if (!requiredTerms.length) {
    return {
      compatible: false,
      exact: false,
      ambiguous: true,
      missingTerms,
      reason: 'missing_lane_identity_terms'
    };
  }

  if (missingTerms.length > 2) {
    return {
      compatible: false,
      exact: false,
      ambiguous: false,
      missingTerms,
      reason: 'clearly_irrelevant_lane_terms'
    };
  }

  return {
    compatible: true,
    exact: missingTerms.length === 0,
    ambiguous: missingTerms.length > 0,
    missingTerms,
    reason: missingTerms.length ? 'ambiguous_lane_identity_match' : 'exact_lane_identity_match'
  };
}

function shouldAttachLaneParsedIdentity(listing = {}, config = {}, triage = {}) {
  if (triage.rejected) return false;
  const match = evaluateLaneIdentityMatch(listing, config);
  return match.compatible && match.exact && !match.ambiguous;
}

function getListingId(listing = {}) {
  return String(listing.marketplaceListingId || listing.ebayItemId || listing.listingId || listing.itemId || '').trim();
}

function getListingType(listing = {}) {
  const options = asArray(listing.buyingOptions).map((option) => String(option || '').toUpperCase());
  if (options.includes('AUCTION')) return 'AUCTION';
  if (options.includes('FIXED_PRICE')) return 'FIXED_PRICE';
  return listing.listingType || listing.type || 'unknown';
}

function getMarketplaceStartTimestamp(listing = {}) {
  return listing.itemCreationDate ||
    listing.itemStartDate ||
    listing.listingStartDate ||
    listing.startTime ||
    listing.raw?.itemCreationDate ||
    listing.raw?.itemStartDate ||
    listing.raw?.listingStartDate ||
    null;
}

function parseTimestamp(value) {
  const time = new Date(value || 0).getTime();
  return Number.isFinite(time) && time > 0 ? time : null;
}

function calculateAgeMsAtObservation(listing = {}, observedAt) {
  const startMs = parseTimestamp(getMarketplaceStartTimestamp(listing));
  const observedMs = parseTimestamp(observedAt);
  if (!startMs || !observedMs || observedMs < startMs) return null;
  return observedMs - startMs;
}

function hasAnyTerm(text, terms = []) {
  const normalized = normalizeText(text);
  return terms.some((term) => normalized.includes(normalizeText(term)));
}

function classifyListingForCheapTriage(listing = {}, config = {}) {
  const price = toNumber(listing.totalCost || listing.price, 0);
  const title = listing.title || '';
  const normalizedTitle = normalizeText(title);

  if (!getListingId(listing)) return { rejected: true, reason: 'missing_listing_id' };
  if (!Number.isFinite(price) || price <= 0) return { rejected: true, reason: 'missing_or_invalid_price' };
  if (config.priceMin !== null && price < Number(config.priceMin)) return { rejected: true, reason: 'below_lane_price_floor' };
  if (config.priceMax !== null && price > Number(config.priceMax)) return { rejected: true, reason: 'above_lane_price_ceiling' };
  if (hasAnyTerm(title, config.excludedTerms)) return { rejected: true, reason: 'excluded_keyword' };

  const requiredTerms = getLaneRequiredTerms(config);

  const missingHardTerms = requiredTerms.filter((term) => !normalizedTitle.includes(normalizeLaneTerm(term)));
  if (missingHardTerms.length > 2) {
    return { rejected: true, reason: 'clearly_irrelevant_lane_terms', missingTerms: missingHardTerms };
  }

  return {
    rejected: false,
    reason: 'candidate_preserved',
    ambiguous: missingHardTerms.length > 0
  };
}

function summarizeFreshness(agesMs = []) {
  const sorted = agesMs.filter((age) => Number.isFinite(age) && age >= 0).sort((a, b) => a - b);
  if (!sorted.length) {
    return {
      available: false,
      count: 0,
      minAgeMinutes: null,
      medianAgeMinutes: null,
      maxAgeMinutes: null,
      limitation: 'marketplace_creation_timestamp_unavailable'
    };
  }

  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
  const toMinutes = (ms) => Math.round((ms / 60000) * 100) / 100;

  return {
    available: true,
    count: sorted.length,
    minAgeMinutes: toMinutes(sorted[0]),
    medianAgeMinutes: toMinutes(median),
    maxAgeMinutes: toMinutes(sorted[sorted.length - 1]),
    limitation: null
  };
}

function increment(summary, key) {
  const safeKey = key || 'unknown';
  summary[safeKey] = (summary[safeKey] || 0) + 1;
}

function getSavedSoldCompCount(listing = {}) {
  const candidates = [
    listing.marketData?.soldCompCount,
    listing.soldSales?.saleCount,
    Array.isArray(listing.soldSales?.sales) ? listing.soldSales.sales.length : undefined,
    listing.compData?.trueSoldCompCount,
    listing.dealGate?.gate?.soldCompCount
  ];

  for (const value of candidates) {
    const number = Number(value);
    if (Number.isFinite(number)) return Math.max(0, Math.round(number));
  }

  return 0;
}

function buildCandidatePipelineMetrics(savedListings = []) {
  const saved = asArray(savedListings);
  return {
    soldEvidenceLookupReached: saved.length,
    sufficientSoldEvidenceListings: saved.filter((listing) => getSavedSoldCompCount(listing) >= 3).length,
    supportedValuationListings: saved.filter((listing) => {
      const source = String(listing.marketData?.source || '');
      return source && source !== 'insufficient_evidence';
    }).length,
    dealGatePassedListings: saved.filter((listing) => listing.dealGate?.passed === true).length,
    dealGateRejectedListings: saved.filter((listing) => listing.dealGate?.passed === false).length
  };
}

function createDisabledReport(config = {}, nowIso) {
  const timestamp = nowIso();
  return {
    schemaVersion: DEFAULT_SCHEMA_VERSION,
    runId: `targeted-discovery-${Date.parse(timestamp) || Date.now()}`,
    laneId: config.laneId || DEFAULT_LANE_ID,
    laneName: config.laneName || 'Targeted Discovery Lane',
    status: 'disabled',
    startedAt: timestamp,
    completedAt: timestamp,
    durationMs: 0,
    queriesExecuted: 0,
    apiRequests: 0,
    pagesRequested: 0,
    rawResults: 0,
    uniqueListings: 0,
    newListings: 0,
    previouslyObservedListings: 0,
    cheaplyRejectedListings: 0,
    candidatesPreserved: 0,
    apiErrors: [],
    duplicateCount: 0,
    laneReports: [],
    lanesExecuted: 0,
    candidatePipeline: buildCandidatePipelineMetrics([]),
    listingTypeBreakdown: {},
    freshness: summarizeFreshness([]),
    requestEfficiency: {
      apiRequestsConsumed: 0,
      listingsReturnedPerRequest: 0,
      uniqueListingsPerRequest: 0,
      newListingsPerRequest: 0
    },
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
}

function createTargetedDiscoveryLaneService(dependencies = {}) {
  const {
    activeMarketplace,
    config = createTargetedDiscoveryLaneConfig(),
    historyEngine,
    getStore = () => ({}),
    parseCardTitle,
    recordTargetedDiscoveryObservation,
    saveScoutedListing,
    sleep = async () => {},
    now = () => new Date().toISOString()
  } = dependencies;

  function isEnabled() {
    return config.enabled === true;
  }

  async function searchPage(query, page, offset) {
    const options = {
      parseCardTitle,
      offset,
      sort: config.sort,
      listingTypes: config.listingTypes,
      priceMin: config.priceMin,
      priceMax: config.priceMax
    };

    if (typeof activeMarketplace.searchPageWithBackoff === 'function') {
      return activeMarketplace.searchPageWithBackoff(query, config.pageLimit, options);
    }

    const items = await activeMarketplace.searchWithBackoff(query, config.pageLimit, options);
    return {
      query,
      page,
      offset,
      limit: config.pageLimit,
      items: asArray(items),
      total: null,
      next: null
    };
  }

  async function run(options = {}) {
    if (!isEnabled()) {
      return {
        report: createDisabledReport(config, now),
        savedListings: []
      };
    }

    const startedAt = now();
    const startedMs = parseTimestamp(startedAt) || Date.now();
    const runId = options.scanId ? `${options.scanId}:${config.laneId}` : `targeted-discovery-${startedMs}`;
    const queries = buildTargetedDiscoveryQueries(config);
    const seenListingIds = new Set();
    const savedListings = [];
    const rejected = [];
    const freshnessAges = [];
    const listingTypeBreakdown = {};
    const apiErrors = [];
    const executedQueries = new Set();
    let apiRequests = 0;
    let pagesRequested = 0;
    let rawResults = 0;
    let duplicateCount = 0;
    let newListings = 0;
    let previouslyObservedListings = 0;
    let rawNewListings = 0;
    let rawPreviouslyObservedListings = 0;
    let budgetReached = false;
    const effectiveMaxRequests = Math.max(0, Math.min(
      toPositiveInteger(config.maxRequests, 1),
      Number.isFinite(Number(options.remainingRequestBudget))
        ? Math.max(0, Math.floor(Number(options.remainingRequestBudget)))
        : toPositiveInteger(config.maxRequests, 1)
    ));

    for (const query of queries) {
      for (let page = 0; page < config.maxPages; page++) {
        if (apiRequests >= effectiveMaxRequests || rawResults >= config.maxResults) {
          budgetReached = true;
          break;
        }

        const offset = page * config.pageLimit;
        apiRequests += 1;
        pagesRequested += 1;
        executedQueries.add(query);

        try {
          const response = await searchPage(query, page, offset);
          const items = asArray(response.items);
          rawResults += items.length;

          for (const listing of items) {
            const listingId = getListingId(listing);
            if (seenListingIds.has(listingId)) {
              duplicateCount += 1;
              continue;
            }
            seenListingIds.add(listingId);

            increment(listingTypeBreakdown, getListingType(listing));

            const priorHistory = historyEngine?.getListing?.(listingId);
            const priorStoreListing = asObject(getStore().listings)?.[listingId];
            const observedAt = now();
            const marketplaceTimestamp = getMarketplaceStartTimestamp(listing);
            const ageMs = calculateAgeMsAtObservation(listing, observedAt);
            const triage = classifyListingForCheapTriage(listing, config);
            const observationStatus = priorHistory || priorStoreListing ? 'previously_observed' : 'new';
            if (observationStatus === 'previously_observed') rawPreviouslyObservedListings += 1;
            else rawNewListings += 1;

            recordTargetedDiscoveryObservation?.({
              runId,
              listing,
              listingId,
              laneId: config.laneId,
              laneName: config.laneName,
              query,
              page,
              offset,
              marketplaceStartTimestamp: marketplaceTimestamp,
              observedAt,
              firstObservedAt: priorHistory?.firstSeenAt || priorStoreListing?.firstSeenAt || observedAt,
              ageAtObservationMs: ageMs,
              ageAtFirstObservationMs: ageMs,
              duplicateClassification: 'unique_raw_result',
              observationStatus,
              candidatePreserved: !triage.rejected,
              triage,
              config
            });

            if (triage.rejected) {
              rejected.push({ listingId, reason: triage.reason });
              continue;
            }

            if (priorHistory || priorStoreListing) previouslyObservedListings += 1;
            else newListings += 1;

            if (ageMs !== null) freshnessAges.push(ageMs);

            const enrichedListing = {
              ...listing,
              parsedIdentity: listing.parsedIdentity ||
                listing.canonicalIdentity ||
                (shouldAttachLaneParsedIdentity(listing, config, triage)
                  ? buildTargetedDiscoveryParsedIdentity(config)
                  : undefined),
              targetedDiscovery: {
                laneId: config.laneId,
                laneName: config.laneName,
                query,
                page,
                offset,
                firstObservedAt: priorHistory?.firstSeenAt || priorStoreListing?.firstSeenAt || observedAt,
                observedAt,
                marketplaceStartTimestamp: marketplaceTimestamp,
                ageAtFirstObservationMs: ageMs,
                freshnessAvailable: ageMs !== null,
                identityMatch: evaluateLaneIdentityMatch(listing, config),
                triage
              }
            };

            const saved = saveScoutedListing(enrichedListing, query, config.laneId, {
              scanUniverseSnapshot: options.scanUniverseSnapshot
            });
            savedListings.push(saved);

            if (savedListings.length >= config.maxResults) {
              budgetReached = true;
              break;
            }
          }

          if (budgetReached || items.length < config.pageLimit) break;
        } catch (error) {
          const compactError = activeMarketplace.compactError ? activeMarketplace.compactError(error) : error.message || String(error);
          apiErrors.push({ query, page, offset, error: compactError });
          if (activeMarketplace.isRateLimitError?.(error)) {
            budgetReached = true;
            break;
          }
        }

        await sleep(activeMarketplace.config?.searchDelayMs || 0);
      }

      if (budgetReached) break;
    }

    const completedAt = now();
    const durationMs = Math.max(0, (parseTimestamp(completedAt) || Date.now()) - startedMs);
    const safeRequests = apiRequests || 1;
    const candidatePipeline = buildCandidatePipelineMetrics(savedListings);

    return {
      report: {
        schemaVersion: DEFAULT_SCHEMA_VERSION,
        runId,
        laneId: config.laneId,
        laneName: config.laneName,
        status: apiErrors.length ? 'completed_with_errors' : 'completed',
        startedAt,
        completedAt,
        durationMs,
        queries: queries.map((query) => ({ query })),
        queriesExecuted: executedQueries.size,
        apiRequests,
        pagesRequested,
        rawResults,
        uniqueListings: seenListingIds.size,
        rawNewListings,
        rawPreviouslyObservedListings,
        newListings,
        previouslyObservedListings,
        cheaplyRejectedListings: rejected.length,
        candidatesPreserved: savedListings.length,
        apiErrors,
        duplicateCount,
        observationsRecorded: seenListingIds.size,
        lanesExecuted: 1,
        laneReports: [],
        rejectedListings: rejected,
        candidatePipeline,
        listingTypeBreakdown,
        freshness: summarizeFreshness(freshnessAges),
        requestEfficiency: {
          apiRequestsConsumed: apiRequests,
          listingsReturnedPerRequest: Math.round((rawResults / safeRequests) * 100) / 100,
          uniqueListingsPerRequest: Math.round((seenListingIds.size / safeRequests) * 100) / 100,
          newListingsPerRequest: Math.round((newListings / safeRequests) * 100) / 100
        },
        budget: {
          pageLimit: config.pageLimit,
          maxPages: config.maxPages,
          maxRequests: config.maxRequests,
          effectiveMaxRequests,
          maxResults: config.maxResults,
          budgetReached
        },
        productionImpact: 'none',
        decisionImpact: 'none',
        executionAuthority: 'none'
      },
      savedListings
    };
  }

  return {
    config,
    isEnabled,
    run
  };
}

function createMultiTargetedDiscoveryLaneService(dependencies = {}) {
  const {
    config = {},
    env = process.env,
    lanes = createTargetedDiscoveryLaneConfigs(env, config),
    now = () => new Date().toISOString()
  } = dependencies;
  const activeLanes = asArray(lanes).filter((lane) => lane && lane.enabled === true);
  const maxActiveLanes = toPositiveInteger(
    config.maxActiveLanes ?? env.CARDHAWK_TARGETED_DISCOVERY_MAX_ACTIVE_LANES,
    DEFAULT_MAX_ACTIVE_TARGETED_LANES
  );
  const selectedLanes = activeLanes.slice(0, maxActiveLanes);
  const fallbackTotalRequests = selectedLanes.reduce(
    (sum, lane) => sum + toPositiveInteger(lane.maxRequests, 1),
    0
  );
  const maxTotalRequests = toPositiveInteger(
    config.maxTotalRequests ?? env.CARDHAWK_TARGETED_DISCOVERY_MAX_TOTAL_REQUESTS,
    fallbackTotalRequests || createTargetedDiscoveryLaneConfig(env, config).maxRequests
  );

  function isEnabled() {
    return selectedLanes.length > 0;
  }

  async function run(options = {}) {
    if (!isEnabled()) {
      return {
        report: createDisabledReport({ laneId: DEFAULT_MULTI_LANE_ID, laneName: 'Multi-Target Discovery' }, now),
        savedListings: []
      };
    }

    const startedAt = now();
    const startedMs = parseTimestamp(startedAt) || Date.now();
    const runId = options.scanId ? `${options.scanId}:${DEFAULT_MULTI_LANE_ID}` : `targeted-discovery-${startedMs}`;
    const savedListings = [];
    const laneReports = [];
    let usedRequests = 0;
    let budgetReached = false;

    for (const laneConfig of selectedLanes) {
      const remainingRequestBudget = Math.max(0, maxTotalRequests - usedRequests);
      if (remainingRequestBudget <= 0) {
        budgetReached = true;
        break;
      }

      const service = createTargetedDiscoveryLaneService({
        ...dependencies,
        config: laneConfig,
        now
      });
      const result = await service.run({
        ...options,
        scanId: runId,
        remainingRequestBudget
      });
      const report = result.report || {};
      usedRequests += Number(report.apiRequests || 0);
      savedListings.push(...asArray(result.savedListings));
      laneReports.push(report);

      if (usedRequests >= maxTotalRequests) {
        budgetReached = true;
        break;
      }
    }

    const completedAt = now();
    const durationMs = Math.max(0, (parseTimestamp(completedAt) || Date.now()) - startedMs);
    const sum = (key) => laneReports.reduce((total, report) => total + Number(report[key] || 0), 0);
    const listingTypeBreakdown = laneReports.reduce((summary, report) => {
      for (const [key, value] of Object.entries(report.listingTypeBreakdown || {})) {
        summary[key] = (summary[key] || 0) + Number(value || 0);
      }
      return summary;
    }, {});
    const candidatePipeline = laneReports.reduce((summary, report) => {
      const metrics = report.candidatePipeline || {};
      for (const key of Object.keys(summary)) {
        summary[key] += Number(metrics[key] || 0);
      }
      return summary;
    }, buildCandidatePipelineMetrics([]));

    return {
      report: {
        schemaVersion: DEFAULT_SCHEMA_VERSION,
        runId,
        laneId: DEFAULT_MULTI_LANE_ID,
        laneName: 'Multi-Target Discovery',
        status: laneReports.some((report) => report.status === 'completed_with_errors')
          ? 'completed_with_errors'
          : 'completed',
        startedAt,
        completedAt,
        durationMs,
        lanesExecuted: laneReports.length,
        laneReports,
        queriesExecuted: sum('queriesExecuted'),
        apiRequests: usedRequests,
        pagesRequested: sum('pagesRequested'),
        rawResults: sum('rawResults'),
        uniqueListings: sum('uniqueListings'),
        rawNewListings: sum('rawNewListings'),
        rawPreviouslyObservedListings: sum('rawPreviouslyObservedListings'),
        newListings: sum('newListings'),
        previouslyObservedListings: sum('previouslyObservedListings'),
        cheaplyRejectedListings: sum('cheaplyRejectedListings'),
        candidatesPreserved: savedListings.length,
        observationsRecorded: sum('observationsRecorded'),
        duplicateCount: sum('duplicateCount'),
        candidatePipeline,
        listingTypeBreakdown,
        requestEfficiency: {
          apiRequestsConsumed: usedRequests,
          listingsReturnedPerRequest: usedRequests ? Math.round((sum('rawResults') / usedRequests) * 100) / 100 : 0,
          uniqueListingsPerRequest: usedRequests ? Math.round((sum('uniqueListings') / usedRequests) * 100) / 100 : 0,
          newListingsPerRequest: usedRequests ? Math.round((sum('newListings') / usedRequests) * 100) / 100 : 0
        },
        budget: {
          maxActiveLanes,
          maxTotalRequests,
          budgetReached,
          lanesConfigured: activeLanes.length,
          lanesExecuted: laneReports.length
        },
        productionImpact: 'none',
        decisionImpact: 'none',
        executionAuthority: 'none'
      },
      savedListings
    };
  }

  return {
    config: {
      laneId: DEFAULT_MULTI_LANE_ID,
      maxActiveLanes,
      maxTotalRequests,
      lanes: selectedLanes
    },
    isEnabled,
    run
  };
}

module.exports = {
  DEFAULT_LANE_ID,
  DEFAULT_MAX_ACTIVE_TARGETED_LANES,
  DEFAULT_MULTI_LANE_ID,
  DEFAULT_SCHEMA_VERSION,
  buildCandidatePipelineMetrics,
  buildTargetedDiscoveryParsedIdentity,
  buildTargetedDiscoveryQueries,
  calculateAgeMsAtObservation,
  classifyListingForCheapTriage,
  createMultiTargetedDiscoveryLaneService,
  createTargetedDiscoveryLaneConfig,
  createTargetedDiscoveryLaneConfigs,
  createTargetedDiscoveryLaneService,
  evaluateLaneIdentityMatch,
  getMarketplaceStartTimestamp,
  shouldAttachLaneParsedIdentity,
  summarizeFreshness
};
