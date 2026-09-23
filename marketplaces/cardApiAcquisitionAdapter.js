'use strict';

const {
  ACCESS_MODES,
  ADAPTER_STATUS,
  EVIDENCE_TYPES,
  createAcquisitionRequest,
  createCanonicalAcquisitionAdapter,
  validateRawEvidenceRecord
} = require('./canonicalAcquisitionInterface');

const SOURCE = 'card_api_compatibility_pilot';
const DEFAULT_SOURCE_ID = 'the_card_api';
const DEFAULT_ADAPTER_NAME = 'card_api_acquisition_adapter';
const ADAPTER_VERSION = '0.1.0';
const API_KEY_ENV = 'CARDHAWK_CARD_API_KEY';
const LIVE_FLAG_ENV = 'CARDHAWK_CARD_API_COMPATIBILITY_LIVE';
const BASE_URL = 'https://thecardapi.com/api/v1/market';
const SALES_PATH = '/sales';
const DEFAULT_LIMIT = 3;
const MAX_COMPATIBILITY_LIMIT = 5;
const OHTANI_CONTROL_QUERY = '2024 Topps Shohei Ohtani';

const CONTROL_IDENTITY = Object.freeze({
  category: 'sports_card',
  sport: 'ufc',
  player: 'Anthony Hernandez',
  year: '2023',
  brand: 'Panini',
  product: 'Prizm',
  setName: 'Prizm',
  cardNumber: '181',
  parallel: 'Silver Prizm',
  rookie: true,
  autograph: false,
  memorabilia: false,
  serialNumbered: false
});

const CONTROL_CANONICAL_CARD_KEY = 'sports-card:ufc:2023:panini:prizm:anthony-hernandez:181:silver-prizm:non-auto:non-mem:unnumbered';
const CONTROL_QUERY = 'Anthony Hernandez 2023 Panini Prizm UFC 181 Silver Prizm Rookie';

const REQUIRED_PROVIDER_FIELDS = Object.freeze([
  'id',
  'platform',
  'title',
  'price',
  'sold_at',
  'currency',
  'listing_type',
  'price_confirmed'
]);

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s/.-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stableToken(value, fallback = 'unknown') {
  return normalizeText(value).replace(/\s+/g, '-') || fallback;
}

function normalizeDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function boundedLimit(value = DEFAULT_LIMIT) {
  const limit = Math.floor(toNumber(value, DEFAULT_LIMIT));
  if (!Number.isFinite(limit) || limit <= 0) return DEFAULT_LIMIT;
  return Math.min(limit, MAX_COMPATIBILITY_LIMIT);
}

function getApiKey(env = process.env) {
  return String(env[API_KEY_ENV] || '').trim();
}

function liveCompatibilityEnabled(env = process.env) {
  return String(env[LIVE_FLAG_ENV] || '').toLowerCase() === 'true';
}

function providerError(code, message, details = {}) {
  return {
    code,
    message,
    retryable: Boolean(details.retryable),
    providerStatus: details.providerStatus || null
  };
}

function getResponseHeader(response = {}, name = '') {
  if (!response.headers || typeof response.headers.get !== 'function') return null;
  return response.headers.get(name) || response.headers.get(name.toLowerCase()) || null;
}

function sanitizeDiagnosticText(value, secrets = []) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  const redacted = secrets
    .filter(Boolean)
    .reduce((current, secret) => current.split(secret).join('[REDACTED_API_KEY]'), text)
    .replace(/tca_[A-Za-z0-9_-]+/g, '[REDACTED_API_KEY]');

  return redacted.length > 500 ? `${redacted.slice(0, 500)}…` : redacted;
}

function buildRequestDiagnostics(url, headers = {}) {
  const headerNames = Object.keys(headers).sort();

  return {
    method: 'GET',
    origin: url.origin,
    path: url.pathname,
    queryParameterNames: Array.from(url.searchParams.keys()).sort(),
    queryPresent: url.searchParams.has('q'),
    limit: Number(url.searchParams.get('limit')),
    headerNames,
    authHeaderPresent: headerNames.includes('x-market-api-key'),
    acceptsJson: headers.Accept === 'application/json',
    hasRequestBody: false,
    timeoutMs: null
  };
}

async function buildResponseDiagnostics(response = {}, secrets = []) {
  const diagnostics = {
    status: response.status || null,
    ok: Boolean(response.ok),
    contentType: getResponseHeader(response, 'content-type')
  };

  if (response.ok) return diagnostics;

  try {
    if (typeof response.text === 'function') {
      diagnostics.providerBodySnippet = sanitizeDiagnosticText(await response.text(), secrets);
    } else if (typeof response.json === 'function') {
      diagnostics.providerBodySnippet = sanitizeDiagnosticText(await response.json(), secrets);
    }
  } catch (_) {
    diagnostics.providerBodySnippet = null;
    diagnostics.providerBodyReadError = 'unavailable';
  }

  return diagnostics;
}

function buildExceptionDiagnostics(error = {}, secrets = []) {
  return {
    classification: error?.name === 'AbortError' ? 'abort_or_timeout' : 'request_exception',
    name: error?.name || 'Error',
    message: sanitizeDiagnosticText(error?.message || 'The Card API request threw before an HTTP response was available.', secrets)
  };
}

function credentialMissingResult(request = {}) {
  return {
    request,
    records: [],
    warnings: ['card_api_compatibility_not_executed'],
    errors: [
      providerError('card_api_key_missing', `${API_KEY_ENV} is required for live compatibility execution.`)
    ],
    metadata: {
      source: SOURCE,
      compatibilityPilot: true,
      liveExecution: false,
      networkAccess: false,
      nonPersistent: true,
      writesProductionStore: false,
      credentialPresent: false,
      liveFlagPresent: false
    }
  };
}

function liveFlagMissingResult(request = {}) {
  return {
    request,
    records: [],
    warnings: ['card_api_compatibility_not_executed'],
    errors: [
      providerError('card_api_live_flag_missing', `${LIVE_FLAG_ENV}=true is required for live compatibility execution.`)
    ],
    metadata: {
      source: SOURCE,
      compatibilityPilot: true,
      liveExecution: false,
      networkAccess: false,
      nonPersistent: true,
      writesProductionStore: false,
      credentialPresent: true,
      liveFlagPresent: false
    }
  };
}

function buildCardApiSalesUrl(request = {}, options = {}) {
  const baseUrl = String(options.baseUrl || BASE_URL).replace(/\/+$/, '');
  const url = new URL(`${baseUrl}${SALES_PATH}`);
  const normalizedRequest = createAcquisitionRequest(request);
  const query = normalizedRequest.query || CONTROL_QUERY;

  url.searchParams.set('q', query);
  url.searchParams.set('limit', String(boundedLimit(normalizedRequest.limit || options.limit)));

  if (normalizedRequest.filters.platform) url.searchParams.set('platform', normalizedRequest.filters.platform);
  if (normalizedRequest.filters.listing_type) url.searchParams.set('listing_type', normalizedRequest.filters.listing_type);
  if (normalizedRequest.filters.grader) url.searchParams.set('grader', normalizedRequest.filters.grader);
  if (normalizedRequest.filters.grade) url.searchParams.set('grade', normalizedRequest.filters.grade);
  if (normalizedRequest.window.dateFrom) url.searchParams.set('date_from', normalizedRequest.window.dateFrom.slice(0, 10));
  if (normalizedRequest.window.dateTo) url.searchParams.set('date_to', normalizedRequest.window.dateTo.slice(0, 10));

  return url;
}

function saleRecordsFromProviderResponse(response = {}) {
  if (Array.isArray(response)) return response;
  const input = asObject(response);
  for (const key of ['data', 'results', 'sales', 'records']) {
    if (Array.isArray(input[key])) return input[key];
  }
  return [];
}

function listingTypeToSaleType(value = '') {
  const normalized = normalizeText(value).replace(/\s+/g, '_');
  if (normalized.includes('best')) return 'best_offer';
  if (normalized.includes('fixed')) return 'buy_it_now';
  if (normalized.includes('auction')) return 'auction';
  return normalized || 'unknown';
}

function isCompletedSale(sale = {}) {
  const status = normalizeText(sale.status || sale.sale_status || sale.transaction_status || 'completed');
  const price = toNumber(sale.price, 0);
  const soldAt = normalizeDate(sale.sold_at || sale.sale_date);

  if (status && ['active', 'available', 'listed', 'open', 'cancelled', 'canceled'].includes(status)) return false;
  return Boolean(sale.id && sale.title && price > 0 && soldAt);
}

function isConfirmedSoldPrice(sale = {}) {
  return sale.price_confirmed === true;
}

function priceConfirmationReasonCode(sale = {}) {
  if (sale.price_confirmed === true) return null;
  if (sale.price_confirmed === false) return 'provider_price_unconfirmed';
  if (sale.price_confirmed === undefined || sale.price_confirmed === null || sale.price_confirmed === '') {
    return 'provider_price_confirmation_missing';
  }
  return 'provider_price_confirmation_malformed';
}

function firstPresent(source = {}, keys = []) {
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null && source[key] !== '') return source[key];
  }
  return null;
}

function parseFeatureFlags(sale = {}) {
  const features = asArray(sale.features).map(normalizeText);
  const title = normalizeText(sale.title);
  const haystack = `${title} ${features.join(' ')}`;

  return {
    rookie: /\brc\b|rookie/.test(haystack),
    autograph: /\bauto\b|autograph/.test(haystack),
    memorabilia: /patch|relic|memorabilia|jersey/.test(haystack),
    serialNumbered: Boolean(sale.print_run) || /\/\d+/.test(haystack)
  };
}

function buildParsedIdentityFromSale(sale = {}) {
  const flags = parseFeatureFlags(sale);
  const explicitPlayer = firstPresent(sale, ['player', 'subject', 'athlete', 'name']);
  const explicitBrand = firstPresent(sale, ['manufacturer', 'brand']);
  const explicitProduct = firstPresent(sale, ['product']);
  const explicitSet = firstPresent(sale, ['card_set', 'set', 'set_name']);
  const explicitParallel = firstPresent(sale, ['parallel', 'variation']);
  const category = sale.category ? `${sale.category}_card` : 'sports_card';

  return {
    category,
    sport: sale.sport || sale.league || null,
    player: explicitPlayer,
    year: sale.year || sale.season || null,
    brand: explicitBrand,
    product: explicitProduct || explicitSet,
    setName: explicitSet || explicitProduct,
    cardNumber: sale.card_number || null,
    parallel: explicitParallel,
    rookie: flags.rookie,
    autograph: flags.autograph,
    memorabilia: flags.memorabilia,
    serialNumbered: flags.serialNumbered,
    printRun: sale.print_run || null
  };
}

function buildLocalCanonicalCardKey(identity = {}) {
  const parts = [
    identity.category || 'unknown',
    identity.sport || identity.game || 'uncategorized',
    identity.year || 'unknown-year',
    identity.brand || identity.product || 'unknown-brand',
    identity.setName || 'unknown-set',
    identity.player || identity.character || 'unknown-subject',
    String(identity.cardNumber || 'unknown-number').replace(/^#/, ''),
    identity.parallel || 'base',
    identity.autograph ? 'auto' : 'non-auto',
    identity.memorabilia ? 'memorabilia' : 'non-mem',
    identity.serialNumbered ? `numbered-${identity.printRun || 'unknown'}` : 'unnumbered'
  ];

  return parts.map((part) => stableToken(part)).join(':');
}

function missingRequiredProviderFields(sale = {}) {
  return REQUIRED_PROVIDER_FIELDS.filter((field) => {
    if (field === 'price') return toNumber(sale.price, 0) <= 0;
    if (field === 'sold_at') return !normalizeDate(sale.sold_at || sale.sale_date);
    if (field === 'price_confirmed') return !isConfirmedSoldPrice(sale);
    return sale[field] === undefined || sale[field] === null || sale[field] === '';
  });
}

function translateCardApiSaleToRawCanonical(sale = {}, context = {}) {
  const missingProviderFields = missingRequiredProviderFields(sale);
  const parsedIdentity = buildParsedIdentityFromSale(sale);
  const saleType = listingTypeToSaleType(sale.listing_type);
  const completedSaleEvent = isCompletedSale(sale);
  const confirmedSoldPrice = isConfirmedSoldPrice(sale);
  const canonicalReadySoldPrice = completedSaleEvent && confirmedSoldPrice;
  const confirmationReasonCode = priceConfirmationReasonCode(sale);
  const shipping = sale.shipping_price === null || sale.shipping_price === undefined ? null : toNumber(sale.shipping_price, 0);
  const price = toNumber(sale.price, 0);
  const totalPaid = shipping === null ? price : Math.round((price + shipping) * 100) / 100;
  const warnings = [];

  if (missingProviderFields.length) warnings.push(`missing_provider_fields:${missingProviderFields.join(',')}`);
  if (confirmationReasonCode) warnings.push(confirmationReasonCode);
  if (!sale.listing_url) warnings.push('missing_source_url');

  return {
    marketplace: sale.platform || 'the_card_api',
    marketplaceLabel: sale.platform || 'The Card API',
    marketplaceSaleId: sale.id || null,
    marketplaceListingId: sale.listing_id || sale.item_id || null,
    rawTitle: sale.title || '',
    soldPrice: price,
    shipping,
    totalPaid,
    currency: sale.currency || 'USD',
    soldAt: normalizeDate(sale.sold_at || sale.sale_date),
    saleType,
    bestOfferAccepted: saleType === 'best_offer',
    priceDisclosure: saleType === 'best_offer' ? 'best_offer_reported_price' : 'reported_price',
    url: sale.listing_url || '',
    image: sale.image_url || sale.thumbnail_url || '',
    condition: sale.graded === true || sale.grader || sale.grade ? 'graded' : 'unknown',
    gradeCompany: sale.grader || 'unknown',
    grade: sale.grade || 'unknown',
    certificationNumber: sale.slab_serial || null,
    parsedIdentity,
    evidenceType: canonicalReadySoldPrice ? EVIDENCE_TYPES.TRUE_SOLD : EVIDENCE_TYPES.ACTIVE_CONTEXT,
    status: canonicalReadySoldPrice
      ? 'active_evidence'
      : (completedSaleEvent ? 'provisional_price_context' : 'context_only'),
    source: {
      adapter: DEFAULT_ADAPTER_NAME,
      marketplace: 'the_card_api',
      sourceName: 'The Card API',
      retrievalMethod: 'card_api_compatibility_pilot',
      sourceReliability: confirmedSoldPrice ? 'provider_reported_verified_market_sale' : 'provider_reported_unconfirmed_price',
      acquiredAt: normalizeDate(context.acquiredAt) || '2026-09-18T00:00:00.000Z',
      transformation: 'card_api_sale_to_canonical_compatibility_candidate'
    },
    retention: {
      status: 'prohibited',
      sourceTerms: 'free-tier compatibility pilot; provider responses are non-persistent',
      notes: ['Do not persist raw or normalized provider responses during A5.1.'],
      reviewedBy: null,
      reviewedAt: null,
      sourceApprovalStatus: 'free_tier_non_persistent'
    },
    warnings,
    providerCompatibility: {
      provider: 'The Card API',
      compatibilityPilot: true,
      nonPersistent: true,
      missingProviderFields,
      completedSaleEvent,
      canonicalReadySoldPrice,
      priceConfirmed: confirmedSoldPrice,
      priceConfirmationStatus: confirmedSoldPrice ? 'confirmed' : 'unconfirmed',
      priceConfirmationReasonCode: confirmationReasonCode,
      originalPriceAvailable: sale.original_price !== undefined && sale.original_price !== null,
      shippingAvailable: sale.shipping_price !== undefined && sale.shipping_price !== null,
      sourceUrlAvailable: Boolean(sale.listing_url),
      stableTransactionIdAvailable: Boolean(sale.id),
      identityMetadataFields: Object.keys(parsedIdentity).filter((key) => parsedIdentity[key] !== null && parsedIdentity[key] !== undefined && parsedIdentity[key] !== '')
    }
  };
}

function buildCardApiCapabilities() {
  return {
    accessMode: ACCESS_MODES.PARTNER_API,
    sourceReliability: 'provider_reported_market_sales',
    transactionLevelSoldSupport: true,
    aggregateMarketPriceSupport: false,
    activeContextSupport: false,
    acceptedBestOfferSupport: true,
    shippingSupport: true,
    certificationSupport: true,
    identityFields: [
      'category',
      'sport',
      'player',
      'year',
      'brand',
      'product',
      'setName',
      'cardNumber',
      'parallel',
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
    supportsIncrementalSync: true,
    supportsHistoricalBackfill: true,
    supportsHealthCheck: true,
    maxBatchSize: MAX_COMPATIBILITY_LIMIT,
    rateLimit: {
      salesRowsPerDay: 'plan_dependent',
      maxLimitPerRequest: 1000,
      compatibilityPilotLimit: MAX_COMPATIBILITY_LIMIT
    },
    commercialUse: {
      permitted: false,
      requiresLicense: true,
      redistributionAllowed: false,
      displayAllowed: false,
      notes: 'Free-tier A5.1 compatibility pilot is non-persistent. Paid/internal-use rights must be verified before ingestion.'
    },
    cardApi: {
      baseUrl: BASE_URL,
      salesPath: SALES_PATH,
      authenticationHeader: 'x-market-api-key',
      responsePersistenceAllowed: false,
      compatibilityPilot: true
    }
  };
}

async function executeCardApiSalesRequest(request = {}, options = {}) {
  const env = options.env || process.env;
  const apiKey = getApiKey(env);
  const normalizedRequest = createAcquisitionRequest(request);

  if (!apiKey) return credentialMissingResult(normalizedRequest);
  if (!liveCompatibilityEnabled(env)) return liveFlagMissingResult(normalizedRequest);

  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    return {
      request: normalizedRequest,
      records: [],
      warnings: ['card_api_compatibility_not_executed'],
      errors: [providerError('fetch_unavailable', 'fetch is unavailable for The Card API compatibility request.')],
      metadata: {
        source: SOURCE,
        compatibilityPilot: true,
        liveExecution: false,
        networkAccess: false,
        nonPersistent: true,
        writesProductionStore: false,
        credentialPresent: true,
        liveFlagPresent: true
      }
    };
  }

  const url = buildCardApiSalesUrl(normalizedRequest, options);
  const headers = {
    'x-market-api-key': apiKey,
    Accept: 'application/json'
  };
  const requestDiagnostics = buildRequestDiagnostics(url, headers);

  try {
    const response = await fetchImpl(url.toString(), {
      method: 'GET',
      headers
    });
    const responseDiagnostics = await buildResponseDiagnostics(response, [apiKey]);

    if (!response.ok) {
      return {
        request: normalizedRequest,
        records: [],
        warnings: ['card_api_provider_error'],
        errors: [providerError('card_api_request_failed', 'The Card API compatibility request failed.', {
          providerStatus: response.status,
          retryable: response.status >= 500 || response.status === 429
        })],
        metadata: {
          source: SOURCE,
          compatibilityPilot: true,
          liveExecution: true,
          networkAccess: true,
          nonPersistent: true,
          writesProductionStore: false,
          requestUrl: `${url.origin}${url.pathname}`,
          query: normalizedRequest.query,
          limit: boundedLimit(normalizedRequest.limit || options.limit),
          providerStatus: response.status,
          diagnostics: {
            request: requestDiagnostics,
            response: responseDiagnostics
          }
        }
      };
    }

    const payload = await response.json();
    const sales = saleRecordsFromProviderResponse(payload).slice(0, boundedLimit(normalizedRequest.limit || options.limit));
    const records = sales.map((sale) => translateCardApiSaleToRawCanonical(sale, {
      acquiredAt: options.acquiredAt
    }));

    return {
      request: normalizedRequest,
      records,
      warnings: [],
      errors: [],
      acquiredAt: normalizeDate(options.acquiredAt) || new Date().toISOString(),
      metadata: {
        source: SOURCE,
        compatibilityPilot: true,
        liveExecution: true,
        networkAccess: true,
        nonPersistent: true,
        writesProductionStore: false,
        requestUrl: `${url.origin}${url.pathname}`,
        query: normalizedRequest.query,
        limit: boundedLimit(normalizedRequest.limit || options.limit),
        providerRowsReturned: sales.length,
        approximateUsage: {
          requests: 1,
          resultRows: sales.length
        },
        diagnostics: {
          request: requestDiagnostics,
          response: responseDiagnostics
        }
      }
    };
  } catch (_) {
    return {
      request: normalizedRequest,
      records: [],
      warnings: ['card_api_request_exception'],
      errors: [providerError('card_api_request_exception', 'The Card API compatibility request failed safely.', { retryable: true })],
      metadata: {
        source: SOURCE,
        compatibilityPilot: true,
        liveExecution: true,
        networkAccess: true,
        nonPersistent: true,
        writesProductionStore: false,
        query: normalizedRequest.query,
        limit: boundedLimit(normalizedRequest.limit || options.limit),
        diagnostics: {
          request: requestDiagnostics,
          exception: buildExceptionDiagnostics(_, [apiKey])
        }
      }
    };
  }
}

function priceRange(records = []) {
  const prices = records.map((record) => toNumber(record.soldPrice, NaN)).filter(Number.isFinite);
  if (!prices.length) return { min: null, max: null };
  return { min: Math.min(...prices), max: Math.max(...prices) };
}

function dateRange(records = []) {
  const dates = records.map((record) => record.soldAt).filter(Boolean).sort();
  if (!dates.length) return { from: null, to: null };
  return { from: dates[0], to: dates[dates.length - 1] };
}

function countBy(records = [], getKey) {
  return records.reduce((summary, record) => {
    const key = getKey(record) || 'unknown';
    summary[key] = (summary[key] || 0) + 1;
    return summary;
  }, {});
}

function buildFieldAvailability(records = []) {
  return {
    bestOfferRecordsPresent: records.some((record) => record.saleType === 'best_offer'),
    acceptedPriceFieldAvailable: records.some((record) => record.bestOfferAccepted && record.soldPrice > 0 && record.evidenceType === EVIDENCE_TYPES.TRUE_SOLD),
    shippingAvailable: records.some((record) => record.shipping !== null && record.shipping !== undefined),
    totalPaidAvailable: records.some((record) => record.totalPaid !== null && record.totalPaid !== undefined),
    stableTransactionIdAvailable: records.some((record) => Boolean(record.marketplaceSaleId)),
    sourceUrlAvailable: records.some((record) => Boolean(record.url)),
    imageAvailable: records.some((record) => Boolean(record.image)),
    identityMetadataAvailable: records.some((record) => {
      const identity = asObject(record.parsedIdentity);
      return Boolean(identity.player || identity.year || identity.setName || identity.cardNumber || identity.parallel);
    })
  };
}

function missingProviderFieldsFromRecord(record = {}) {
  const direct = asArray(record.providerCompatibility?.missingProviderFields);
  const fromWarnings = asArray(record.warnings).flatMap((warning) => {
    const value = String(warning || '');
    if (!value.startsWith('missing_provider_fields:')) return [];
    return value
      .slice('missing_provider_fields:'.length)
      .split(',')
      .map((field) => field.trim())
      .filter(Boolean);
  });

  return [...new Set([...direct, ...fromWarnings])].sort();
}

function compatibilityClassification(report = {}) {
  if (!report.requestSucceeded) return 'NOT_TESTED';
  if (report.transactionsReturned <= 0) return 'NOT_TESTED';
  if (report.canonicalizableRecords > 0 && report.minimumFieldCompatibleRecords > 0) return 'COMPATIBLE';
  if (report.minimumFieldCompatibleRecords > 0 || report.trueSoldTransactions > 0) return 'PARTIALLY_COMPATIBLE';
  return 'NOT_COMPATIBLE';
}

function summarizeCardApiCompatibility(acquisitionResult = {}) {
  const records = asArray(acquisitionResult.records);
  const validations = records.map((record) => validateRawEvidenceRecord(record, {
    marketplace: 'the_card_api',
    adapterName: DEFAULT_ADAPTER_NAME,
    capabilities: buildCardApiCapabilities()
  }));
  const trueSoldRecords = records.filter((record) => record.evidenceType === EVIDENCE_TYPES.TRUE_SOLD && record.status === 'active_evidence');
  const minimumCompatible = records.filter((record) => {
    const missingProviderFields = missingProviderFieldsFromRecord(record);
    return !missingProviderFields.length
      && record.evidenceType === EVIDENCE_TYPES.TRUE_SOLD
      && record.status === 'active_evidence'
      && Boolean(record.marketplaceSaleId)
      && Boolean(record.rawTitle)
      && toNumber(record.soldPrice, 0) > 0
      && Boolean(record.soldAt)
      && Boolean(record.currency)
      && Boolean(record.saleType);
  });
  const canonicalizable = records.filter((record) => record.evidenceType === EVIDENCE_TYPES.TRUE_SOLD
    && record.status === 'active_evidence'
    && !validations[records.indexOf(record)]?.reasons?.length);
  const exactControlMatches = trueSoldRecords.filter((record) => buildLocalCanonicalCardKey(record.parsedIdentity || {}) === CONTROL_CANONICAL_CARD_KEY);
  const missingReasons = validations.flatMap((validation) => asArray(validation.reasons));
  const providerMissing = records.flatMap((record) => missingProviderFieldsFromRecord(record));

  const report = {
    source: SOURCE,
    version: ADAPTER_VERSION,
    requestSucceeded: asArray(acquisitionResult.errors).length === 0 && acquisitionResult.metadata?.liveExecution === true,
    executedLive: acquisitionResult.metadata?.liveExecution === true,
    nonPersistent: true,
    writesProductionStore: false,
    transactionsReturned: records.length,
    trueSoldTransactions: trueSoldRecords.length,
    minimumFieldCompatibleRecords: minimumCompatible.length,
    canonicalizableRecords: canonicalizable.length,
    anthonyHernandezControlMatches: exactControlMatches.length,
    soldPriceRange: priceRange(trueSoldRecords),
    soldDateRange: dateRange(trueSoldRecords),
    marketplaceSourceDistribution: countBy(records, (record) => record.marketplaceLabel || record.marketplace),
    listingTypeDistribution: countBy(records, (record) => record.saleType),
    fieldAvailability: buildFieldAvailability(records),
    missingCardHawkRequiredFields: [...new Set([...missingReasons, ...providerMissing])].sort(),
    compatibilityFailures: asArray(acquisitionResult.errors).map((error) => error.code).sort(),
    approximateProviderUsage: acquisitionResult.metadata?.approximateUsage || {
      requests: acquisitionResult.metadata?.networkAccess ? 1 : 0,
      resultRows: records.length
    },
    providerStatus: acquisitionResult.metadata?.providerStatus || null,
    technicalCompatibility: 'NOT_TESTED'
  };

  report.technicalCompatibility = compatibilityClassification(report);
  return report;
}

async function runCardApiCompatibilityPilot(options = {}) {
  const request = {
    requestId: 'card-api-anthony-hernandez-compatibility',
    query: options.query || CONTROL_QUERY,
    identity: CONTROL_IDENTITY,
    limit: boundedLimit(options.limit || DEFAULT_LIMIT),
    filters: asObject(options.filters)
  };
  const adapter = createCardApiAcquisitionAdapter(options);
  const acquisitionResult = await adapter.acquireSoldEvidence(request, options);
  const report = summarizeCardApiCompatibility(acquisitionResult);

  return {
    source: SOURCE,
    version: ADAPTER_VERSION,
    provider: 'The Card API',
    controlIdentity: CONTROL_IDENTITY,
    controlCanonicalCardKey: CONTROL_CANONICAL_CARD_KEY,
    report
  };
}

function createCardApiAcquisitionAdapter(options = {}) {
  const adapter = createCanonicalAcquisitionAdapter({
    sourceId: options.sourceId || DEFAULT_SOURCE_ID,
    marketplace: 'the_card_api',
    marketplaceLabel: 'The Card API',
    sourceName: 'The Card API Compatibility Pilot',
    adapterName: options.adapterName || DEFAULT_ADAPTER_NAME,
    adapterVersion: options.adapterVersion || ADAPTER_VERSION,
    capabilities: buildCardApiCapabilities(),
    acquire: async (request, acquireOptions = {}) => executeCardApiSalesRequest(request, {
      ...options,
      ...acquireOptions
    }),
    healthCheck: async () => ({
      status: getApiKey(options.env || process.env)
        ? (liveCompatibilityEnabled(options.env || process.env) ? ADAPTER_STATUS.READY : ADAPTER_STATUS.UNCONFIGURED)
        : ADAPTER_STATUS.UNCONFIGURED,
      message: 'The Card API compatibility pilot is non-production and non-persistent.',
      compatibilityPilot: true,
      nonPersistent: true,
      networkAccess: Boolean(getApiKey(options.env || process.env) && liveCompatibilityEnabled(options.env || process.env)),
      writesProductionStore: false
    })
  });

  return {
    ...adapter,

    translateSale(sale = {}, context = {}) {
      return translateCardApiSaleToRawCanonical(sale, context);
    },

    buildCompatibilityReport(acquisitionResult = {}) {
      return summarizeCardApiCompatibility(acquisitionResult);
    }
  };
}

module.exports = {
  ADAPTER_VERSION,
  API_KEY_ENV,
  BASE_URL,
  CONTROL_CANONICAL_CARD_KEY,
  CONTROL_IDENTITY,
  CONTROL_QUERY,
  DEFAULT_ADAPTER_NAME,
  DEFAULT_LIMIT,
  DEFAULT_SOURCE_ID,
  LIVE_FLAG_ENV,
  MAX_COMPATIBILITY_LIMIT,
  OHTANI_CONTROL_QUERY,
  REQUIRED_PROVIDER_FIELDS,
  SOURCE,
  boundedLimit,
  buildCardApiCapabilities,
  buildCardApiSalesUrl,
  buildLocalCanonicalCardKey,
  createCardApiAcquisitionAdapter,
  executeCardApiSalesRequest,
  getApiKey,
  isCompletedSale,
  liveCompatibilityEnabled,
  runCardApiCompatibilityPilot,
  saleRecordsFromProviderResponse,
  summarizeCardApiCompatibility,
  translateCardApiSaleToRawCanonical
};
