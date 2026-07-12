'use strict';

const {
  ACCESS_MODES,
  ADAPTER_STATUS,
  EVIDENCE_TYPES,
  createAcquisitionRequest,
  createCanonicalAcquisitionAdapter
} = require('./canonicalAcquisitionInterface');
const {
  createEbayTranslatorSourceMetadata,
  translateEbayFixtureToRawCanonical
} = require('./ebayResponseTranslator');
const {
  asArray,
  normalizeDate,
  toNumber
} = require('../validation/canonicalValidationCore');
const {
  DEFAULT_FIXTURE_PATH,
  loadEbayFixtureLibrary,
  validateEbayFixtureLibrary
} = require('../validation/ebayFixtureLibrary');

const DEFAULT_SOURCE_ID = 'ebay';
const DEFAULT_ADAPTER_NAME = 'ebay_acquisition_adapter';
const ADAPTER_VERSION = '0.1.0';

const DEFAULT_CONFIG = {
  enabled: false,
  marketplaceId: 'EBAY_US',
  environment: 'production',
  auth: {
    clientId: null,
    clientSecret: null,
    refreshToken: null,
    accessToken: null,
    tokenExpiresAt: null,
    scopes: []
  },
  rateLimit: {
    requestsPerDay: null,
    requestsPerSecond: null,
    burst: null,
    notes: 'Placeholder only. Real limits must be set from the approved eBay API product before live use.'
  },
  retry: {
    maxAttempts: 0,
    backoffMs: 0,
    retryableStatusCodes: []
  },
  pagination: {
    pageSize: 50,
    maxPages: 0,
    cursorStrategy: 'not_implemented'
  },
  fixtureMode: {
    enabled: false,
    fixturePath: DEFAULT_FIXTURE_PATH,
    scenario: 'valid_subset',
    pageSize: 25,
    acquiredAt: '2026-07-12T00:00:00.000Z',
    partialFailure: false
  }
};

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function mergeConfig(config = {}) {
  const input = asObject(config);

  return {
    ...DEFAULT_CONFIG,
    ...input,
    auth: {
      ...DEFAULT_CONFIG.auth,
      ...asObject(input.auth)
    },
    rateLimit: {
      ...DEFAULT_CONFIG.rateLimit,
      ...asObject(input.rateLimit)
    },
    retry: {
      ...DEFAULT_CONFIG.retry,
      ...asObject(input.retry)
    },
    pagination: {
      ...DEFAULT_CONFIG.pagination,
      ...asObject(input.pagination)
    },
    fixtureMode: {
      ...DEFAULT_CONFIG.fixtureMode,
      ...asObject(input.fixtureMode)
    }
  };
}

function hasAuthenticationPlaceholders(config = {}) {
  const auth = asObject(config.auth);
  return Boolean(
    Object.prototype.hasOwnProperty.call(auth, 'clientId')
    && Object.prototype.hasOwnProperty.call(auth, 'clientSecret')
    && Object.prototype.hasOwnProperty.call(auth, 'refreshToken')
    && Object.prototype.hasOwnProperty.call(auth, 'accessToken')
  );
}

function isFixtureModeEnabled(config = {}) {
  return mergeConfig(config).fixtureMode.enabled === true;
}

function fixtureScenarioFromRequest(request = {}, config = {}) {
  const normalizedConfig = mergeConfig(config);
  return request.context?.fixtureScenario
    || request.filters?.fixtureScenario
    || normalizedConfig.fixtureMode.scenario
    || 'valid_subset';
}

function loadFixtureLibrary(config = {}) {
  const normalizedConfig = mergeConfig(config);
  return loadEbayFixtureLibrary(normalizedConfig.fixtureMode.fixturePath || DEFAULT_FIXTURE_PATH);
}

function fixtureIsImportable(fixture = {}) {
  return fixture.expected?.validation?.shouldImportAsTrueSold === true;
}

function selectFixturesForScenario(library = {}, scenario = 'valid_subset') {
  const fixtures = asArray(library.fixtures);
  if (scenario === 'all') return fixtures;
  if (scenario === 'invalid') return fixtures.filter((fixture) => fixture.expected?.valid === false);
  if (scenario === 'duplicates') return fixtures.filter((fixture) => fixture.category === 'duplicate_listing');
  if (scenario === 'malformed') {
    return fixtures.filter((fixture) => ['missing_fields', 'malformed_listing'].includes(fixture.category));
  }
  if (scenario === 'partial_failure') return fixtures.filter(fixtureIsImportable).slice(0, 3);
  if (scenario === 'valid_all') return fixtures.filter(fixtureIsImportable);
  return fixtures
    .filter(fixtureIsImportable)
    .filter((fixture) => fixture.category !== 'duplicate_listing')
    .slice(0, 3);
}

function paginateFixtures(fixtures = [], request = {}, config = {}) {
  const normalizedConfig = mergeConfig(config);
  const cursor = request.cursor === undefined || request.cursor === null || request.cursor === ''
    ? 0
    : Math.max(0, toNumber(request.cursor, 0));
  const requestedLimit = request.limit === null || request.limit === undefined
    ? null
    : toNumber(request.limit, NaN);
  const pageSize = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? requestedLimit
    : toNumber(normalizedConfig.fixtureMode.pageSize, 25);
  const records = fixtures.slice(cursor, cursor + pageSize);
  const nextOffset = cursor + records.length;

  return {
    records,
    cursor,
    pageSize,
    nextCursor: nextOffset < fixtures.length ? String(nextOffset) : null,
    totalFixtures: fixtures.length
  };
}

function translateEbaySoldEvidenceRequest(request = {}, config = {}) {
  const normalizedRequest = createAcquisitionRequest(request);
  const normalizedConfig = mergeConfig(config);

  return {
    source: 'ebay_request_translation',
    implemented: false,
    marketplaceId: normalizedConfig.marketplaceId,
    environment: normalizedConfig.environment,
    query: normalizedRequest.query,
    canonicalCardKey: normalizedRequest.canonicalCardKey,
    identity: normalizedRequest.identity,
    filters: normalizedRequest.filters,
    dateRange: normalizedRequest.window,
    limit: normalizedRequest.limit,
    cursor: normalizedRequest.cursor,
    requestedEvidenceTypes: normalizedRequest.requestedEvidenceTypes,
    endpoint: null,
    method: 'GET',
    authStrategy: isFixtureModeEnabled(normalizedConfig) ? 'offline_fixture' : 'oauth_placeholder',
    pagination: normalizedConfig.pagination,
    rateLimit: normalizedConfig.rateLimit,
    retry: normalizedConfig.retry,
    fixtureMode: {
      enabled: normalizedConfig.fixtureMode.enabled === true,
      scenario: fixtureScenarioFromRequest(normalizedRequest, normalizedConfig),
      fixturePath: normalizedConfig.fixtureMode.fixturePath,
      pageSize: normalizedConfig.fixtureMode.pageSize
    },
    notes: [
      normalizedConfig.fixtureMode.enabled
        ? 'Offline fixture mode is enabled; no eBay endpoint is selected.'
        : 'No eBay endpoint is selected in the skeleton.',
      'Completed/sold evidence source must be approved before live implementation.',
      'This adapter performs no network access.'
    ]
  };
}

function translateEbaySoldEvidenceResponse(response = {}, context = {}) {
  return {
    source: 'ebay_response_translation',
    implemented: false,
    records: [],
    warnings: ['ebay_response_translation_not_implemented'],
    errors: [
      {
        code: 'ebay_response_translation_not_implemented',
        message: 'eBay response translation is a placeholder and does not produce evidence records.',
        retryable: false
      }
    ],
    rawResponseShape: {
      hasItems: Array.isArray(response.items),
      hasItemSummaries: Array.isArray(response.itemSummaries),
      keys: Object.keys(asObject(response))
    },
    context: asObject(context)
  };
}

function validateEbayMarketplaceRecord(record = {}) {
  return {
    valid: false,
    reasons: ['ebay_marketplace_record_validation_not_implemented'],
    recordId: record.itemId || record.legacyItemId || record.id || null
  };
}

function createNotImplementedResult(request = {}, config = {}) {
  const translatedRequest = translateEbaySoldEvidenceRequest(request, config);

  return {
    request,
    records: [],
    warnings: [
      'ebay_acquisition_not_implemented',
      'ebay_adapter_skeleton_only',
      'no_network_request_performed'
    ],
    errors: [
      {
        code: 'ebay_acquisition_not_implemented',
        message: 'The eBay Acquisition Adapter skeleton does not connect to eBay or acquire sold evidence yet.',
        retryable: false
      }
    ],
    metadata: {
      adapterState: 'skeleton',
      implemented: false,
      networkAccess: false,
      writesProductionStore: false,
      translatedRequest
    }
  };
}

function createFixtureBackedResult(request = {}, config = {}) {
  const normalizedConfig = mergeConfig(config);
  const translatedRequest = translateEbaySoldEvidenceRequest(request, normalizedConfig);
  const library = loadFixtureLibrary(normalizedConfig);
  const fixtureValidation = validateEbayFixtureLibrary(library);
  const scenario = fixtureScenarioFromRequest(createAcquisitionRequest(request), normalizedConfig);
  const selectedFixtures = selectFixturesForScenario(library, scenario);
  const page = paginateFixtures(selectedFixtures, createAcquisitionRequest(request), normalizedConfig);
  const sourceMetadata = createEbayTranslatorSourceMetadata({
    sourceId: DEFAULT_SOURCE_ID,
    adapterName: DEFAULT_ADAPTER_NAME,
    adapterVersion: ADAPTER_VERSION,
    capabilities: buildEbayCapabilities(normalizedConfig)
  });
  const records = page.records.map((fixture) => translateEbayFixtureToRawCanonical(fixture, {
    sourceMetadata,
    acquiredAt: normalizedConfig.fixtureMode.acquiredAt,
    retrievalMethod: 'offline_fixture_acquisition',
    sourceReliability: 'offline_fixture'
  }));
  const partialFailure = scenario === 'partial_failure' || normalizedConfig.fixtureMode.partialFailure === true;

  return {
    request,
    records,
    warnings: [
      'ebay_fixture_mode_enabled',
      'no_network_request_performed',
      ...(fixtureValidation.passed ? [] : ['ebay_fixture_library_validation_failed'])
    ],
    errors: partialFailure
      ? [
        {
          code: 'ebay_fixture_partial_failure',
          message: 'Offline fixture mode simulated a partial acquisition failure.',
          retryable: true
        }
      ]
      : [],
    cursor: page.nextCursor,
    acquiredAt: normalizeDate(normalizedConfig.fixtureMode.acquiredAt) || new Date().toISOString(),
    metadata: {
      adapterState: 'fixture_backed',
      implemented: true,
      fixtureOnly: true,
      networkAccess: false,
      writesProductionStore: false,
      translatedRequest,
      fixtureSet: library.metadata?.fixtureSet || null,
      fixtureVersion: library.metadata?.version || null,
      fixtureScenario: scenario,
      pagination: {
        cursor: page.cursor,
        nextCursor: page.nextCursor,
        pageSize: page.pageSize,
        returned: records.length,
        totalFixtures: page.totalFixtures
      },
      fixtureValidation
    }
  };
}

function buildEbayCapabilities(config = {}) {
  const normalizedConfig = mergeConfig(config);
  const fixtureMode = normalizedConfig.fixtureMode.enabled === true;

  return {
    accessMode: fixtureMode ? ACCESS_MODES.OFFLINE_FIXTURE : ACCESS_MODES.OFFICIAL_API,
    sourceReliability: fixtureMode ? 'offline_fixture' : 'unimplemented_official_api_skeleton',
    transactionLevelSoldSupport: fixtureMode,
    aggregateMarketPriceSupport: fixtureMode,
    activeContextSupport: fixtureMode,
    acceptedBestOfferSupport: fixtureMode,
    shippingSupport: fixtureMode,
    certificationSupport: fixtureMode,
    identityFields: [
      'category',
      'sport',
      'game',
      'player',
      'character',
      'year',
      'brand',
      'product',
      'setName',
      'cardNumber',
      'parallel',
      'variation',
      'rookie',
      'autograph',
      'memorabilia',
      'serialNumbered'
    ],
    provenanceFields: [
      'marketplace',
      'adapter',
      'retrievalMethod',
      'sourceReliability',
      'acquiredAt',
      'sourceUrl'
    ],
    supportsIncrementalSync: false,
    supportsHistoricalBackfill: fixtureMode,
    supportsHealthCheck: true,
    maxBatchSize: normalizedConfig.pagination.pageSize,
    rateLimit: normalizedConfig.rateLimit,
    commercialUse: {
      permitted: false,
      requiresLicense: true,
      redistributionAllowed: false,
      displayAllowed: false,
      notes: 'Commercial usage and endpoint eligibility must be approved before live eBay acquisition is implemented.'
    },
    ebay: {
      marketplaceId: normalizedConfig.marketplaceId,
      environment: normalizedConfig.environment,
      authentication: {
        strategy: fixtureMode ? 'offline_fixture' : 'oauth_placeholder',
        placeholdersDeclared: hasAuthenticationPlaceholders(normalizedConfig),
        scopes: normalizedConfig.auth.scopes
      },
      requestTranslation: 'defined_placeholder',
      responseTranslation: fixtureMode ? 'offline_fixture_translator' : 'defined_placeholder',
      retry: normalizedConfig.retry,
      pagination: normalizedConfig.pagination,
      validationHooks: ['validateEbayMarketplaceRecord'],
      fixtureMode: {
        enabled: fixtureMode,
        scenario: normalizedConfig.fixtureMode.scenario,
        fixturePath: normalizedConfig.fixtureMode.fixturePath,
        pageSize: normalizedConfig.fixtureMode.pageSize
      },
      implemented: fixtureMode ? 'fixture_only' : false
    }
  };
}

function createEbayAcquisitionAdapter(options = {}) {
  const config = mergeConfig(options.config || {});

  const adapter = createCanonicalAcquisitionAdapter({
    sourceId: options.sourceId || DEFAULT_SOURCE_ID,
    marketplace: 'ebay',
    marketplaceLabel: 'eBay',
    sourceName: config.fixtureMode.enabled
      ? 'eBay Fixture-Backed Sold Evidence Acquisition'
      : 'eBay Sold Evidence Acquisition Skeleton',
    adapterName: options.adapterName || DEFAULT_ADAPTER_NAME,
    adapterVersion: options.adapterVersion || ADAPTER_VERSION,
    capabilities: {
      ...buildEbayCapabilities(config),
      ...asObject(options.capabilities)
    },
    acquire: async (request) => (
      config.fixtureMode.enabled
        ? createFixtureBackedResult(request, config)
        : createNotImplementedResult(request, config)
    ),
    healthCheck: async () => ({
      status: config.fixtureMode.enabled
        ? ADAPTER_STATUS.READY
        : (config.enabled ? ADAPTER_STATUS.UNCONFIGURED : ADAPTER_STATUS.DISABLED),
      message: config.fixtureMode.enabled
        ? 'eBay adapter is running in offline fixture-backed mode. No network access is performed.'
        : (config.enabled
          ? 'eBay adapter skeleton is enabled but live acquisition is not implemented.'
          : 'eBay adapter skeleton is disabled by default.'),
      implemented: config.fixtureMode.enabled ? 'fixture_only' : false,
      networkAccess: false,
      fixtureOnly: config.fixtureMode.enabled,
      authenticationConfigured: false,
      authenticationPlaceholdersDeclared: hasAuthenticationPlaceholders(config),
      rateLimitConfigured: Boolean(config.rateLimit),
      retryConfigured: Boolean(config.retry),
      paginationConfigured: Boolean(config.pagination)
    })
  });

  return {
    ...adapter,
    config,

    translateRequest(request = {}) {
      return translateEbaySoldEvidenceRequest(request, config);
    },

    translateResponse(response = {}, context = {}) {
      return translateEbaySoldEvidenceResponse(response, context);
    },

    validateMarketplaceRecord(record = {}) {
      return validateEbayMarketplaceRecord(record);
    },

    getImplementationStatus() {
      return {
        implemented: config.fixtureMode.enabled ? 'fixture_only' : false,
        acquisitionImplemented: config.fixtureMode.enabled ? 'fixture_only' : false,
        networkAccess: false,
        supportedEvidenceTypes: config.fixtureMode.enabled
          ? [EVIDENCE_TYPES.TRUE_SOLD, EVIDENCE_TYPES.AGGREGATE_MARKET_PRICE, EVIDENCE_TYPES.ACTIVE_CONTEXT]
          : [],
        plannedEvidenceTypes: [EVIDENCE_TYPES.TRUE_SOLD],
        blockers: [
          'approved_eBay_sold_evidence_endpoint_required',
          'commercial_usage_approval_required',
          'authentication_flow_not_implemented',
          ...(config.fixtureMode.enabled ? [] : ['response_translation_not_implemented'])
        ],
        fixtureMode: {
          enabled: config.fixtureMode.enabled,
          scenario: config.fixtureMode.scenario,
          productionApproved: false
        }
      };
    }
  };
}

function registerEbayAcquisitionAdapter(registry, options = {}) {
  const adapter = createEbayAcquisitionAdapter(options);
  const result = registry.registerAdapter(adapter);

  return {
    adapter,
    result
  };
}

module.exports = {
  ADAPTER_VERSION,
  DEFAULT_ADAPTER_NAME,
  DEFAULT_CONFIG,
  DEFAULT_SOURCE_ID,
  buildEbayCapabilities,
  createEbayAcquisitionAdapter,
  createFixtureBackedResult,
  createNotImplementedResult,
  isFixtureModeEnabled,
  mergeConfig,
  registerEbayAcquisitionAdapter,
  translateEbaySoldEvidenceRequest,
  translateEbaySoldEvidenceResponse,
  validateEbayMarketplaceRecord
};
