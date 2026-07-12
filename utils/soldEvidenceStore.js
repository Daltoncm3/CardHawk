'use strict';

const stateStore = require('./stateStore');
const {
  CANONICAL_RECORD_SCHEMA_VERSION
} = require('../validation/canonicalValidationCore');

const STORE_VERSION = 1;
const SOURCE = 'sold_evidence_store';

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function roundMoney(value) {
  return Math.round(toNumber(value) * 100) / 100;
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s/.-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stableToken(value) {
  return normalizeText(value).replace(/\s+/g, '-');
}

function pickFirstValue(sources, keys, fallback = undefined) {
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;
    for (const key of keys) {
      if (source[key] !== undefined && source[key] !== null && source[key] !== '') {
        return source[key];
      }
    }
  }
  return fallback;
}

function pickFirstNumber(sources, keys, fallback = 0) {
  const value = pickFirstValue(sources, keys, undefined);
  return value === undefined ? fallback : toNumber(value, fallback);
}

function normalizeDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeMarketplace(value) {
  return stableToken(value || 'unknown') || 'unknown';
}

function normalizeSaleType(value) {
  const normalized = normalizeText(value);
  if (normalized.includes('auction')) return 'auction';
  if (normalized.includes('best') || normalized.includes('offer')) return 'best_offer';
  if (normalized.includes('bin') || normalized.includes('buy it now') || normalized.includes('fixed')) return 'buy_it_now';
  return normalized || 'unknown';
}

function normalizeCondition(value) {
  const normalized = normalizeText(value);
  if (!normalized) return 'unknown';
  if (normalized.includes('psa') || normalized.includes('bgs') || normalized.includes('sgc') || normalized.includes('cgc')) return 'graded';
  if (normalized.includes('raw') || normalized.includes('ungraded')) return 'raw';
  return normalized;
}

function normalizeGradeCompany(value) {
  const normalized = normalizeText(value);
  if (normalized.includes('psa')) return 'PSA';
  if (normalized.includes('bgs') || normalized.includes('beckett')) return 'BGS';
  if (normalized.includes('sgc')) return 'SGC';
  if (normalized.includes('cgc') || normalized.includes('csg')) return 'CGC';
  if (normalized.includes('raw')) return 'raw';
  return value ? String(value).trim() : 'unknown';
}

function normalizeParsedIdentity(identity = {}) {
  const cardNumber = pickFirstValue([identity], ['cardNumber', 'cardNo', 'number'], null);

  return {
    category: normalizeText(identity.category || identity.type) || 'unknown',
    sport: normalizeText(identity.sport || identity.league) || null,
    game: normalizeText(identity.game || identity.tcg) || null,
    player: normalizeText(identity.player || identity.subject || identity.character) || null,
    character: normalizeText(identity.character) || null,
    year: identity.year === undefined || identity.year === null || identity.year === '' ? null : String(identity.year).trim(),
    brand: normalizeText(identity.brand || identity.manufacturer) || null,
    product: normalizeText(identity.product || identity.productName) || null,
    setName: normalizeText(identity.setName || identity.set || identity.cardSet) || null,
    cardNumber: cardNumber === null ? null : normalizeText(cardNumber).replace(/^#/, ''),
    parallel: normalizeText(identity.parallel || identity.variation || identity.color) || null,
    variation: normalizeText(identity.variation) || null,
    rookie: Boolean(identity.rookie || identity.isRookie),
    autograph: Boolean(identity.autograph || identity.auto || identity.isAutograph),
    memorabilia: Boolean(identity.memorabilia || identity.relic || identity.patch),
    serialNumbered: Boolean(identity.serialNumbered || identity.numbered || identity.isNumbered),
    serialNumber: identity.serialNumber || null,
    printRun: toNumber(identity.printRun || identity.numberedTo || identity.serialPrintRun, 0) || null
  };
}

function buildCanonicalCardKey(identity = {}) {
  const normalized = normalizeParsedIdentity(identity);
  const parts = [
    normalized.category,
    normalized.sport || normalized.game || 'uncategorized',
    normalized.year || 'unknown-year',
    normalized.brand || normalized.product || 'unknown-brand',
    normalized.setName || 'unknown-set',
    normalized.player || normalized.character || 'unknown-subject',
    normalized.cardNumber || 'unknown-number',
    normalized.parallel || 'base',
    normalized.autograph ? 'auto' : 'non-auto',
    normalized.memorabilia ? 'memorabilia' : 'non-mem',
    normalized.serialNumbered ? `numbered-${normalized.printRun || 'unknown'}` : 'unnumbered'
  ];

  return parts.map((part) => stableToken(part || 'unknown')).join(':');
}

function inferEvidenceQuality(record = {}) {
  const explicitScore = toNumber(record.evidenceQualityScore ?? record.evidenceQuality?.score, NaN);
  if (Number.isFinite(explicitScore)) {
    return {
      score: Math.max(0, Math.min(100, Math.round(explicitScore))),
      level: record.evidenceQualityLevel || record.evidenceQuality?.level || qualityLevel(explicitScore),
      reasons: Array.isArray(record.evidenceQuality?.reasons) ? [...record.evidenceQuality.reasons] : []
    };
  }

  let score = 20;
  const reasons = [];

  if (pickFirstNumber([record], ['soldPrice', 'price', 'salePrice'], 0) > 0) {
    score += 20;
    reasons.push('sold price present');
  }
  if (normalizeDate(pickFirstValue([record], ['soldAt', 'dateSold', 'soldDate', 'endedAt'], null))) {
    score += 18;
    reasons.push('sold date present');
  }
  if (pickFirstValue([record], ['marketplaceSaleId', 'saleId', 'orderLineItemId'], '')) {
    score += 14;
    reasons.push('marketplace sale id present');
  }
  if (record.parsedIdentity || record.identity) {
    score += 16;
    reasons.push('parsed identity present');
  }
  if (record.image || record.imageUrl || (Array.isArray(record.images) && record.images.length)) {
    score += 6;
    reasons.push('image present');
  }
  if (record.url || record.itemWebUrl) {
    score += 6;
    reasons.push('source url present');
  }

  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  return {
    score: clamped,
    level: qualityLevel(clamped),
    reasons
  };
}

function qualityLevel(score) {
  const value = toNumber(score, 0);
  if (value >= 85) return 'strong';
  if (value >= 70) return 'good';
  if (value >= 50) return 'usable';
  if (value >= 30) return 'weak';
  return 'poor';
}

function buildEvidenceId(record = {}, canonicalCardKey = '') {
  const marketplace = normalizeMarketplace(record.marketplace || record.source?.marketplace);
  const saleId = pickFirstValue([record], ['marketplaceSaleId', 'saleId', 'orderLineItemId'], '');
  if (saleId) return `${marketplace}:sale:${stableToken(saleId)}`;

  const listingId = pickFirstValue([record], ['marketplaceListingId', 'listingId', 'ebayItemId', 'itemId'], '');
  const soldAt = normalizeDate(pickFirstValue([record], ['soldAt', 'dateSold', 'soldDate', 'endedAt'], null)) || 'unknown-date';
  if (listingId) return `${marketplace}:listing:${stableToken(listingId)}:${stableToken(soldAt)}`;

  const rawTitle = pickFirstValue([record], ['rawTitle', 'title', 'name'], 'untitled');
  const price = roundMoney(pickFirstNumber([record], ['soldPrice', 'salePrice', 'price', 'amount'], 0));
  return `${marketplace}:fingerprint:${stableToken(canonicalCardKey)}:${stableToken(rawTitle)}:${stableToken(soldAt)}:${price}`;
}

function buildDuplicateKeys(record = {}) {
  const keys = new Set();
  const marketplace = normalizeMarketplace(record.marketplace);

  if (record.marketplaceSaleId) keys.add(`sale:${marketplace}:${stableToken(record.marketplaceSaleId)}`);
  if (record.marketplaceListingId && record.soldAt) keys.add(`listing:${marketplace}:${stableToken(record.marketplaceListingId)}:${stableToken(record.soldAt)}`);
  if (record.url) keys.add(`url:${normalizeText(record.url)}`);

  keys.add([
    'fingerprint',
    marketplace,
    stableToken(record.rawTitle),
    roundMoney(record.totalPaid || record.soldPrice),
    stableToken(record.soldAt),
    stableToken(record.seller?.username || record.seller?.marketplaceSellerId || '')
  ].join(':'));

  return [...keys].filter(Boolean);
}

function normalizeSoldEvidenceRecord(input = {}, options = {}) {
  const rawIdentity = input.parsedIdentity || input.identity || input.parsed || {};
  const parsedIdentity = normalizeParsedIdentity(rawIdentity);
  const canonicalCardKey = input.canonicalCardKey || buildCanonicalCardKey(parsedIdentity);
  const marketplace = normalizeMarketplace(input.marketplace || input.source?.marketplace);
  const soldPrice = roundMoney(pickFirstNumber([input], ['soldPrice', 'salePrice', 'price', 'amount', 'value'], 0));
  const shipping = roundMoney(pickFirstNumber([input], ['shipping', 'shippingCost'], 0));
  const tax = input.tax === undefined || input.tax === null ? null : roundMoney(input.tax);
  const buyerPremium = input.buyerPremium === undefined || input.buyerPremium === null ? null : roundMoney(input.buyerPremium);
  const explicitTotalPaid = pickFirstValue([input], ['totalPaid', 'totalCost', 'totalPrice'], undefined);
  const totalPaid = explicitTotalPaid === undefined
    ? roundMoney(soldPrice + shipping + toNumber(tax, 0) + toNumber(buyerPremium, 0))
    : roundMoney(explicitTotalPaid);
  const rawTitle = String(pickFirstValue([input], ['rawTitle', 'title', 'name'], '') || '');
  const soldAt = normalizeDate(pickFirstValue([input], ['soldAt', 'dateSold', 'soldDate', 'endedAt', 'saleDate'], null));
  const quality = inferEvidenceQuality(input);

  const normalized = {
    schemaVersion: input.schemaVersion || CANONICAL_RECORD_SCHEMA_VERSION,
    id: input.id || buildEvidenceId({ ...input, marketplace }, canonicalCardKey),
    evidenceType: 'true_sold',
    marketplace,
    marketplaceLabel: input.marketplaceLabel || input.source?.marketplaceLabel || input.marketplace || marketplace,
    marketplaceSaleId: pickFirstValue([input], ['marketplaceSaleId', 'saleId', 'orderLineItemId'], null),
    marketplaceListingId: pickFirstValue([input], ['marketplaceListingId', 'listingId', 'ebayItemId', 'itemId'], null),
    rawTitle,
    normalizedTitle: normalizeText(rawTitle),
    soldPrice,
    shipping,
    tax,
    buyerPremium,
    totalPaid,
    currency: input.currency || input.priceCurrency || 'USD',
    soldAt,
    saleType: normalizeSaleType(input.saleType || input.format || input.listingType || input.purchaseType),
    bestOfferAccepted: Boolean(input.bestOfferAccepted || input.acceptedBestOffer),
    priceDisclosure: input.priceDisclosure || (input.bestOfferAccepted ? 'best_offer_reported_price' : 'reported_price'),
    url: input.url || input.itemWebUrl || '',
    image: input.image || input.imageUrl || '',
    images: Array.isArray(input.images) ? [...input.images] : [],
    condition: normalizeCondition(input.condition || input.rawCondition),
    gradeCompany: normalizeGradeCompany(input.gradeCompany || input.grader || input.gradingCompany),
    grade: input.grade === undefined || input.grade === null || input.grade === '' ? 'unknown' : String(input.grade),
    certificationNumber: input.certificationNumber || input.certNumber || input.cert || null,
    seller: {
      username: input.seller?.username || input.sellerUsername || 'unknown',
      feedbackScore: toNumber(input.seller?.feedbackScore ?? input.sellerFeedbackScore, 0),
      feedbackPercentage: toNumber(input.seller?.feedbackPercentage ?? input.sellerFeedbackPercentage, 0),
      marketplaceSellerId: input.seller?.marketplaceSellerId || input.sellerId || null
    },
    parsedIdentity,
    canonicalCardKey,
    identityConfidence: toNumber(input.identityConfidence, 0),
    priceConfidence: toNumber(input.priceConfidence, soldPrice > 0 ? 0.85 : 0),
    soldDateConfidence: toNumber(input.soldDateConfidence, soldAt ? 0.85 : 0),
    evidenceQualityScore: quality.score,
    evidenceQualityLevel: quality.level,
    evidenceQuality: quality,
    source: {
      adapter: input.source?.adapter || options.adapter || 'manual_import',
      acquiredAt: normalizeDate(input.source?.acquiredAt || options.acquiredAt) || new Date().toISOString(),
      query: input.source?.query || input.query || '',
      retrievalMethod: input.source?.retrievalMethod || options.retrievalMethod || 'manual_import',
      sourceReliability: input.source?.sourceReliability || options.sourceReliability || 'unknown'
    },
    duplicateGroupId: input.duplicateGroupId || null,
    status: input.status || 'active_evidence',
    rejectionReasons: Array.isArray(input.rejectionReasons) ? [...input.rejectionReasons] : [],
    warnings: Array.isArray(input.warnings) ? [...input.warnings] : [],
    rawRecord: input.rawRecord || (options.includeRawRecord ? { ...input } : undefined)
  };

  normalized.duplicateKeys = buildDuplicateKeys(normalized);
  return normalized;
}

function createEmptySoldEvidenceStore(overrides = {}) {
  const now = new Date().toISOString();
  return {
    source: SOURCE,
    version: STORE_VERSION,
    createdAt: overrides.createdAt || now,
    updatedAt: overrides.updatedAt || now,
    records: {},
    duplicateIndex: {},
    identityIndex: {},
    stats: {
      recordCount: 0,
      identityCount: 0,
      duplicateKeyCount: 0,
      duplicateInsertions: 0
    }
  };
}

function normalizeStore(store = {}) {
  const normalized = {
    ...createEmptySoldEvidenceStore(),
    ...store,
    source: store.source || SOURCE,
    version: toNumber(store.version, STORE_VERSION),
    records: store.records || {},
    duplicateIndex: store.duplicateIndex || {},
    identityIndex: store.identityIndex || {},
    stats: store.stats || {}
  };

  return refreshStats(normalized);
}

function refreshStats(store = createEmptySoldEvidenceStore()) {
  const recordIds = Object.keys(store.records || {});
  store.stats = {
    ...store.stats,
    recordCount: recordIds.length,
    identityCount: Object.keys(store.identityIndex || {}).length,
    duplicateKeyCount: Object.keys(store.duplicateIndex || {}).length,
    duplicateInsertions: toNumber(store.stats?.duplicateInsertions, 0)
  };
  return store;
}

function cloneStore(store) {
  return JSON.parse(JSON.stringify(store || createEmptySoldEvidenceStore()));
}

function indexRecord(store, record) {
  store.records[record.id] = record;

  if (!store.identityIndex[record.canonicalCardKey]) {
    store.identityIndex[record.canonicalCardKey] = [];
  }
  if (!store.identityIndex[record.canonicalCardKey].includes(record.id)) {
    store.identityIndex[record.canonicalCardKey].push(record.id);
  }

  for (const key of record.duplicateKeys || []) {
    store.duplicateIndex[key] = record.id;
  }
}

function findDuplicateRecord(store = {}, record = {}) {
  for (const key of record.duplicateKeys || []) {
    const existingId = store.duplicateIndex?.[key];
    if (existingId && store.records?.[existingId]) return store.records[existingId];
  }
  return null;
}

function addSoldEvidenceRecord(store = createEmptySoldEvidenceStore(), input = {}, options = {}) {
  const nextStore = options.mutate ? normalizeStore(store) : normalizeStore(cloneStore(store));
  const record = normalizeSoldEvidenceRecord(input, options);
  const duplicate = findDuplicateRecord(nextStore, record);

  if (duplicate) {
    nextStore.stats.duplicateInsertions = toNumber(nextStore.stats.duplicateInsertions, 0) + 1;
    nextStore.updatedAt = new Date().toISOString();
    refreshStats(nextStore);
    return {
      store: nextStore,
      record: duplicate,
      inserted: false,
      duplicate: true,
      duplicateOf: duplicate.id
    };
  }

  indexRecord(nextStore, record);
  nextStore.updatedAt = new Date().toISOString();
  refreshStats(nextStore);

  return {
    store: nextStore,
    record,
    inserted: true,
    duplicate: false,
    duplicateOf: null
  };
}

function addSoldEvidenceRecords(store = createEmptySoldEvidenceStore(), records = [], options = {}) {
  let current = options.mutate ? store : cloneStore(store);
  const results = [];

  for (const record of Array.isArray(records) ? records : []) {
    const result = addSoldEvidenceRecord(current, record, { ...options, mutate: true });
    current = result.store;
    results.push({
      id: result.record.id,
      inserted: result.inserted,
      duplicate: result.duplicate,
      duplicateOf: result.duplicateOf
    });
  }

  return {
    store: normalizeStore(current),
    results
  };
}

function findSoldEvidenceByIdentity(store = {}, identityOrKey = {}) {
  const normalizedStore = normalizeStore(store);
  const canonicalCardKey = typeof identityOrKey === 'string'
    ? identityOrKey
    : buildCanonicalCardKey(identityOrKey);
  const ids = normalizedStore.identityIndex[canonicalCardKey] || [];

  return ids
    .map((id) => normalizedStore.records[id])
    .filter(Boolean)
    .filter((record) => record.status === 'active_evidence')
    .sort((a, b) => new Date(b.soldAt || 0) - new Date(a.soldAt || 0));
}

function loadSoldEvidenceStore(filePath) {
  return normalizeStore(stateStore.loadJsonState(filePath, createEmptySoldEvidenceStore()));
}

function saveSoldEvidenceStore(filePath, store = createEmptySoldEvidenceStore()) {
  return stateStore.saveJsonState(filePath, normalizeStore(store));
}

module.exports = {
  STORE_VERSION,
  SOURCE,
  createEmptySoldEvidenceStore,
  normalizeSoldEvidenceRecord,
  createCanonicalSoldEvidenceRecord: normalizeSoldEvidenceRecord,
  addSoldEvidenceRecord,
  addSoldEvidenceRecords,
  findSoldEvidenceByIdentity,
  findDuplicateRecord,
  buildCanonicalCardKey,
  normalizeParsedIdentity,
  loadSoldEvidenceStore,
  saveSoldEvidenceStore
};
