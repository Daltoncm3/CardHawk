'use strict';

const {
  ACCESS_MODES,
  EVIDENCE_TYPES,
  createSourceMetadata,
  normalizeAcquisitionResult,
  validateRawEvidenceRecord
} = require('./canonicalAcquisitionInterface');
const {
  asArray,
  asObject,
  normalizeDate,
  toNumber,
  unique
} = require('../validation/canonicalValidationCore');
const {
  loadEbayFixtureLibrary,
  validateEbayFixtureLibrary
} = require('../validation/ebayFixtureLibrary');

const TRANSLATOR_VERSION = '0.1.0';
const SOURCE = 'ebay_response_translator';

function normalizeText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeToken(value, fallback = 'unknown') {
  return normalizeText(value).toLowerCase().replace(/[\s-]+/g, '_') || fallback;
}

function getImageUrl(record = {}) {
  if (typeof record.image === 'string') return record.image;
  if (record.image?.imageUrl) return record.image.imageUrl;
  if (Array.isArray(record.additionalImages) && record.additionalImages[0]?.imageUrl) {
    return record.additionalImages[0].imageUrl;
  }
  return '';
}

function getRecordPrice(record = {}) {
  return toNumber(record.price?.value ?? record.currentBidPrice?.value ?? record.convertedCurrentPrice?.value, 0);
}

function getRecordShipping(record = {}) {
  const shippingOption = asArray(record.shippingOptions)[0] || {};
  return toNumber(shippingOption.shippingCost?.value, 0);
}

function normalizeSaleType(record = {}, expected = {}) {
  const explicit = normalizeToken(expected.saleType || record.saleType || record.listingFormat, 'unknown');
  if (explicit.includes('auction')) return 'auction';
  if (explicit.includes('best_offer') || explicit.includes('best') || record.bestOfferAccepted) return 'best_offer';
  if (explicit.includes('fixed') || explicit.includes('buy_it_now') || explicit.includes('bin')) return 'buy_it_now';
  return explicit === 'unknown' ? 'unknown' : explicit;
}

function normalizeCondition(record = {}, expected = {}) {
  if (expected.condition) return expected.condition;
  const condition = normalizeText(record.condition).toLowerCase();
  const title = normalizeText(record.title).toLowerCase();
  if (condition.includes('graded') || /\b(psa|bgs|sgc|cgc)\s*\d/.test(title)) return 'graded';
  if (condition.includes('ungraded') || condition.includes('raw') || /\braw\b/.test(title)) return 'raw';
  return 'unknown';
}

function parseGrade(record = {}, expected = {}) {
  if (expected.gradeCompany || expected.grade) {
    return {
      gradeCompany: expected.gradeCompany || 'unknown',
      grade: expected.grade || 'unknown',
      certificationNumber: expected.certificationNumber || record.certificationNumber || record.certNumber || null
    };
  }

  const text = `${record.condition || ''} ${record.title || ''}`;
  const match = text.match(/\b(PSA|BGS|SGC|CGC)\s*([0-9](?:\.[0-9])?|10)\b/i);
  if (!match) {
    return {
      gradeCompany: normalizeCondition(record) === 'raw' ? 'raw' : 'unknown',
      grade: 'unknown',
      certificationNumber: record.certificationNumber || record.certNumber || null
    };
  }

  return {
    gradeCompany: match[1].toUpperCase(),
    grade: String(match[2]),
    certificationNumber: record.certificationNumber || record.certNumber || null
  };
}

function parseIdentityFromTitle(record = {}) {
  const title = normalizeText(record.title);
  const lower = title.toLowerCase();
  const yearMatch = title.match(/\b(19\d{2}|20\d{2}(?:-\d{2})?)\b/);
  const cardNumberMatch = title.match(/#\s*([A-Za-z0-9/-]+)/) || title.match(/\b([A-Z]{1,4}\d{1,4}|\d{1,4})\b(?!.*\b\d{4}\b)/);
  const serialMatch = title.match(/\/(\d{1,5})\b/);
  const brandMatch = title.match(/\b(Panini|Topps|Bowman|Fleer|Pokemon|Upper Deck)\b/i);

  return {
    category: lower.includes('pokemon') ? 'tcg_card' : 'sports_card',
    sport: lower.includes('ufc') ? 'mma' : null,
    game: lower.includes('pokemon') ? 'pokemon' : null,
    player: null,
    character: null,
    year: yearMatch ? yearMatch[1] : null,
    brand: brandMatch ? brandMatch[1] : null,
    setName: null,
    cardNumber: cardNumberMatch ? cardNumberMatch[1].replace(/^#/, '') : null,
    parallel: lower.includes('silver') ? 'Silver Prizm' : null,
    rookie: /\b(rc|rookie)\b/i.test(title),
    autograph: /\b(auto|autograph|rpa)\b/i.test(title),
    memorabilia: /\b(relic|patch|memorabilia|rpa)\b/i.test(title),
    serialNumbered: Boolean(serialMatch),
    printRun: serialMatch ? Number(serialMatch[1]) : null
  };
}

function normalizeIdentity(record = {}, expected = {}) {
  const expectedIdentity = asObject(expected.parsedIdentity);
  if (Object.keys(expectedIdentity).length) {
    return {
      ...expectedIdentity
    };
  }
  return parseIdentityFromTitle(record);
}

function inferEvidenceType(record = {}, expected = {}, warnings = []) {
  if (expected.evidenceType) return expected.evidenceType;
  if (record.priceDisclosure === 'undisclosed') return EVIDENCE_TYPES.AGGREGATE_MARKET_PRICE;
  if (record.hasVariations || record.lotSize > 1) return EVIDENCE_TYPES.ACTIVE_CONTEXT;
  if (getRecordPrice(record) > 0 && normalizeDate(record.itemEndDate || record.soldAt)) {
    return EVIDENCE_TYPES.TRUE_SOLD;
  }
  if (warnings.length) return 'fallback_unknown';
  return EVIDENCE_TYPES.ACTIVE_CONTEXT;
}

function buildTranslationWarnings(record = {}, expected = {}, fixture = {}) {
  const warnings = [];
  const title = normalizeText(record.title);
  const url = normalizeText(record.itemWebUrl);
  const soldAt = normalizeDate(record.itemEndDate || record.soldAt);
  const price = getRecordPrice(record);

  function push(code, message, severity = 'warning') {
    warnings.push({
      code,
      message,
      severity
    });
  }

  if (!record.itemId && !record.legacyItemId) push('missing_item_id', 'eBay record is missing an item identifier.');
  if (!title) push('missing_title', 'eBay record is missing a title.');
  if (!url) push('missing_source_url', 'eBay record is missing a source URL.');
  if (url && !/^https?:\/\//i.test(url)) push('invalid_source_url', 'eBay record source URL is not a valid HTTP URL.');
  if (price <= 0) push('missing_sold_price', 'eBay record is missing a positive sold price.');
  if (!soldAt) push('missing_sold_date', 'eBay record is missing a valid sold date.');
  if (record.bestOfferAccepted && record.priceDisclosure === 'undisclosed') {
    push('undisclosed_best_offer_price', 'Best Offer accepted price is not disclosed.', 'error');
  }
  if (record.hasVariations) push('multi_variation_identity_ambiguous', 'Multi-variation listing does not identify the exact sold variation.');
  if (toNumber(record.lotSize, 0) > 1) push('multi_card_lot_not_single_card_price', 'Multi-card lot cannot price a single card exactly.');

  for (const reason of asArray(expected.validation?.reasons)) {
    if (!warnings.some((warning) => warning.code === reason)) {
      push(reason, `Fixture expectation includes validation reason: ${reason}`);
    }
  }

  if (!Object.keys(asObject(expected.parsedIdentity)).length) {
    push('identity_from_title_only', 'Parsed identity was inferred from title only.');
  }
  if (fixture.category === 'edge_case') {
    push('edge_case_fixture', 'Fixture represents an eBay parsing edge case.', 'info');
  }

  return warnings;
}

function createEbayTranslatorSourceMetadata(options = {}) {
  return createSourceMetadata({
    sourceId: options.sourceId || 'ebay_fixture_response_translator',
    marketplace: 'ebay',
    marketplaceLabel: 'eBay',
    sourceName: 'eBay Offline Response Translator',
    adapterName: options.adapterName || SOURCE,
    adapterVersion: options.adapterVersion || TRANSLATOR_VERSION,
    capabilities: {
      acquisitionInterfaceVersion: '1.0.0',
      accessMode: ACCESS_MODES.OFFLINE_FIXTURE,
      sourceReliability: 'offline_fixture',
      transactionLevelSoldSupport: true,
      aggregateMarketPriceSupport: true,
      activeContextSupport: true,
      acceptedBestOfferSupport: true,
      shippingSupport: true,
      certificationSupport: true,
      identityFields: [
        'category',
        'sport',
        'game',
        'player',
        'character',
        'year',
        'brand',
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
      supportsIncrementalSync: false,
      supportsHistoricalBackfill: false,
      supportsHealthCheck: true,
      commercialUse: {
        permitted: false,
        requiresLicense: true,
        redistributionAllowed: false,
        displayAllowed: false,
        notes: 'Offline fixture translator only. Live eBay use requires approved source and commercial rights.'
      },
      translator: {
        source: SOURCE,
        version: TRANSLATOR_VERSION,
        networkAccess: false
      },
      ...asObject(options.capabilities)
    }
  });
}

function translateEbayRecordToRawCanonical(record = {}, context = {}) {
  const expected = asObject(context.expected);
  const fixture = asObject(context.fixture);
  const warnings = buildTranslationWarnings(record, expected, fixture);
  const evidenceType = inferEvidenceType(record, expected, warnings);
  const grade = parseGrade(record, expected);
  const sourceMetadata = createEbayTranslatorSourceMetadata(context.sourceMetadata || {});
  const soldAt = normalizeDate(record.itemEndDate || record.soldAt || expected.soldAt);
  const price = expected.soldPrice !== undefined ? toNumber(expected.soldPrice, 0) : getRecordPrice(record);
  const shipping = expected.shipping !== undefined ? toNumber(expected.shipping, 0) : getRecordShipping(record);
  const itemId = record.itemId || record.legacyItemId || record.id || null;

  return {
    evidenceType,
    marketplace: 'ebay',
    marketplaceLabel: 'eBay',
    marketplaceSaleId: record.orderLineItemId || record.transactionId || null,
    marketplaceListingId: itemId,
    ebayItemId: itemId,
    itemId,
    rawTitle: normalizeText(record.title),
    title: normalizeText(record.title),
    soldPrice: price,
    shipping,
    totalPaid: price + shipping,
    currency: record.price?.currency || record.currentBidPrice?.currency || expected.currency || 'USD',
    soldAt,
    saleType: normalizeSaleType(record, expected),
    bestOfferAccepted: Boolean(record.bestOfferAccepted),
    priceDisclosure: record.priceDisclosure || expected.priceDisclosure || (record.bestOfferAccepted ? 'reported_price' : 'reported_price'),
    url: record.itemWebUrl || '',
    image: getImageUrl(record),
    condition: normalizeCondition(record, expected),
    gradeCompany: grade.gradeCompany,
    grade: grade.grade,
    certificationNumber: grade.certificationNumber,
    seller: {
      username: record.seller?.username || 'unknown',
      feedbackScore: toNumber(record.seller?.feedbackScore, 0),
      feedbackPercentage: toNumber(record.seller?.feedbackPercentage, 0),
      marketplaceSellerId: record.seller?.sellerId || record.seller?.marketplaceSellerId || null
    },
    parsedIdentity: normalizeIdentity(record, expected),
    source: {
      marketplace: 'ebay',
      adapter: sourceMetadata.adapterName,
      retrievalMethod: context.retrievalMethod || 'offline_fixture_response_translation',
      sourceReliability: context.sourceReliability || 'offline_fixture',
      acquiredAt: normalizeDate(context.acquiredAt) || '2026-07-12T00:00:00.000Z',
      sourceUrl: record.itemWebUrl || '',
      fixtureId: fixture.id || null,
      fixtureCategory: fixture.category || null,
      translatorVersion: TRANSLATOR_VERSION
    },
    warnings: warnings.map((warning) => warning.code),
    translationWarnings: warnings,
    rawRecord: context.includeRawRecord ? { ...record } : undefined
  };
}

function translateEbayFixtureToRawCanonical(fixture = {}, options = {}) {
  return translateEbayRecordToRawCanonical(asObject(fixture.ebayRecord), {
    ...options,
    fixture,
    expected: fixture.expected || {},
    includeRawRecord: options.includeRawRecord
  });
}

function validateTranslatedEbayRecord(record = {}, sourceMetadata = createEbayTranslatorSourceMetadata()) {
  const validation = validateRawEvidenceRecord(record, sourceMetadata);
  const warningReasons = asArray(record.translationWarnings)
    .filter((warning) => warning.severity === 'error')
    .map((warning) => warning.code);
  const reasons = unique([
    ...validation.reasons,
    ...warningReasons
  ]);

  return {
    ...validation,
    valid: reasons.length === 0,
    reasons,
    translationWarnings: asArray(record.translationWarnings)
  };
}

function translateEbayFixtureLibrary(library = loadEbayFixtureLibrary(), options = {}) {
  const sourceMetadata = createEbayTranslatorSourceMetadata(options.sourceMetadata || {});
  const fixtureValidation = validateEbayFixtureLibrary(library);
  const fixtures = asArray(library.fixtures);
  const rawRecords = fixtures.map((fixture) => translateEbayFixtureToRawCanonical(fixture, {
    ...options,
    sourceMetadata
  }));
  const acquisitionResult = normalizeAcquisitionResult({
    request: options.request || {
      requestId: 'ebay-offline-fixture-translation',
      query: 'offline eBay fixture translation'
    },
    records: rawRecords,
    warnings: fixtureValidation.passed ? [] : ['ebay_fixture_library_validation_failed'],
    errors: [],
    metadata: {
      fixtureSet: library.metadata?.fixtureSet || null,
      fixtureVersion: library.metadata?.version || null,
      networkAccess: false,
      translator: {
        source: SOURCE,
        version: TRANSLATOR_VERSION
      },
      fixtureValidation
    }
  }, sourceMetadata);
  const records = acquisitionResult.records.map((record, index) => ({
    ...record,
    translationWarnings: asArray(rawRecords[index]?.translationWarnings)
  }));
  const translationValidation = records.map((record) => ({
    id: record.id,
    evidenceType: record.evidenceType,
    validation: validateTranslatedEbayRecord(record, sourceMetadata)
  }));

  return {
    ...acquisitionResult,
    records,
    rawRecords,
    source: {
      ...acquisitionResult.source,
      responseTranslator: {
        source: SOURCE,
        version: TRANSLATOR_VERSION,
        networkAccess: false
      }
    },
    validation: translationValidation.map((entry) => ({
      id: entry.id,
      evidenceType: entry.evidenceType,
      ...entry.validation
    })),
    translationSummary: {
      fixtureCount: fixtures.length,
      warningCount: rawRecords.reduce((sum, record) => sum + asArray(record.translationWarnings).length, 0),
      invalidTranslationCount: translationValidation.filter((entry) => !entry.validation.valid).length,
      expectedInvalidFixtureCount: fixtureValidation.summary?.expectedInvalidFixtures || 0,
      trueSoldCount: acquisitionResult.summary.trueSoldCount,
      aggregateMarketPriceCount: acquisitionResult.summary.aggregateMarketPriceCount,
      activeContextCount: acquisitionResult.summary.activeContextCount
    }
  };
}

module.exports = {
  SOURCE,
  TRANSLATOR_VERSION,
  createEbayTranslatorSourceMetadata,
  translateEbayFixtureLibrary,
  translateEbayFixtureToRawCanonical,
  translateEbayRecordToRawCanonical,
  validateTranslatedEbayRecord
};
