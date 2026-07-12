'use strict';

const {
  ACCESS_MODES,
  ADAPTER_STATUS,
  EVIDENCE_TYPES,
  createAcquisitionRequest,
  createCanonicalAcquisitionAdapter
} = require('./canonicalAcquisitionInterface');

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
    authStrategy: 'oauth_placeholder',
    pagination: normalizedConfig.pagination,
    rateLimit: normalizedConfig.rateLimit,
    retry: normalizedConfig.retry,
    notes: [
      'No eBay endpoint is selected in the skeleton.',
      'Completed/sold evidence source must be approved before implementation.',
      'This translator performs no network access.'
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

function buildEbayCapabilities(config = {}) {
  const normalizedConfig = mergeConfig(config);

  return {
    accessMode: ACCESS_MODES.OFFICIAL_API,
    sourceReliability: 'unimplemented_official_api_skeleton',
    transactionLevelSoldSupport: false,
    aggregateMarketPriceSupport: false,
    activeContextSupport: false,
    acceptedBestOfferSupport: false,
    shippingSupport: false,
    certificationSupport: false,
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
    supportsHistoricalBackfill: false,
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
        strategy: 'oauth_placeholder',
        placeholdersDeclared: hasAuthenticationPlaceholders(normalizedConfig),
        scopes: normalizedConfig.auth.scopes
      },
      requestTranslation: 'defined_placeholder',
      responseTranslation: 'defined_placeholder',
      retry: normalizedConfig.retry,
      pagination: normalizedConfig.pagination,
      validationHooks: ['validateEbayMarketplaceRecord'],
      implemented: false
    }
  };
}

function createEbayAcquisitionAdapter(options = {}) {
  const config = mergeConfig(options.config || {});

  const adapter = createCanonicalAcquisitionAdapter({
    sourceId: options.sourceId || DEFAULT_SOURCE_ID,
    marketplace: 'ebay',
    marketplaceLabel: 'eBay',
    sourceName: 'eBay Sold Evidence Acquisition Skeleton',
    adapterName: options.adapterName || DEFAULT_ADAPTER_NAME,
    adapterVersion: options.adapterVersion || ADAPTER_VERSION,
    capabilities: {
      ...buildEbayCapabilities(config),
      ...asObject(options.capabilities)
    },
    acquire: async (request) => createNotImplementedResult(request, config),
    healthCheck: async () => ({
      status: config.enabled ? ADAPTER_STATUS.UNCONFIGURED : ADAPTER_STATUS.DISABLED,
      message: config.enabled
        ? 'eBay adapter skeleton is enabled but acquisition is not implemented.'
        : 'eBay adapter skeleton is disabled by default.',
      implemented: false,
      networkAccess: false,
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
        implemented: false,
        acquisitionImplemented: false,
        networkAccess: false,
        supportedEvidenceTypes: [],
        plannedEvidenceTypes: [EVIDENCE_TYPES.TRUE_SOLD],
        blockers: [
          'approved_eBay_sold_evidence_endpoint_required',
          'commercial_usage_approval_required',
          'authentication_flow_not_implemented',
          'response_translation_not_implemented'
        ]
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
  createNotImplementedResult,
  mergeConfig,
  registerEbayAcquisitionAdapter,
  translateEbaySoldEvidenceRequest,
  translateEbaySoldEvidenceResponse,
  validateEbayMarketplaceRecord
};
