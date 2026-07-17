'use strict';

const listingIdentity = require('./listingIdentity');

const LISTING_COMPACTION_SOURCE = 'listing_compaction';
const LISTING_COMPACTION_SCHEMA_VERSION = '1.0.0';

const TRANSIENT_RETAINED_KEYS = Object.freeze([
  'raw',
  'rawListing',
  'rawMarketplaceListing',
  'rawMarketplaceResponse',
  'rawResponse',
  'apiResponse',
  'httpResponse',
  'request',
  'requestOptions',
  'response',
  'responseBody',
  'retryState',
  'retryMetadata',
  'headers',
  'fetchOptions',
  'scanRequest',
  'scanResponse',
  'temporaryScanData'
]);

const REQUIRED_COMPACT_LISTING_FIELDS = Object.freeze([
  'listingId',
  'marketplace',
  'marketplaceListingId',
  'marketplaceLabel',
  'ebayItemId',
  'title',
  'price',
  'shipping',
  'totalCost',
  'currency',
  'condition',
  'url',
  'image',
  'sellerUsername',
  'sellerFeedbackPercentage',
  'sellerFeedbackScore',
  'buyingOptions',
  'itemEndDate',
  'parsed'
]);

function clone(value) {
  if (!value || typeof value !== 'object') return value;
  return JSON.parse(JSON.stringify(value));
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeText(value, fallback = '') {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value);
}

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(Object(value), key);
}

function firstPresent(sources = [], keys = [], fallback = undefined) {
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

function summarizeRawMarketplacePayload(raw) {
  if (!isObject(raw) || Object.keys(raw).length === 0) return null;

  return {
    source: LISTING_COMPACTION_SOURCE,
    marketplace: 'ebay',
    marketplaceListingId: raw.itemId || raw.legacyItemId || raw.itemGroupId || null,
    itemWebUrl: raw.itemWebUrl || null,
    title: raw.title || null,
    priceCurrency: raw.price?.currency || null,
    buyingOptions: Array.isArray(raw.buyingOptions) ? [...raw.buyingOptions] : [],
    sellerUsername: raw.seller?.username || null,
    imageAvailable: Boolean(raw.image?.imageUrl || raw.thumbnailImages?.length),
    rawPayloadRemoved: true
  };
}

function buildMarketplaceProvenance(listing = {}) {
  const rawSummary = summarizeRawMarketplacePayload(listing.raw || listing.rawListing || listing.rawMarketplaceResponse);
  const existing = isObject(listing.marketplaceProvenance) ? clone(listing.marketplaceProvenance) : {};

  return {
    source: LISTING_COMPACTION_SOURCE,
    marketplace: normalizeText(listing.marketplace || existing.marketplace || rawSummary?.marketplace, 'unknown'),
    marketplaceLabel: normalizeText(listing.marketplaceLabel || existing.marketplaceLabel, ''),
    marketplaceListingId: normalizeText(
      listing.marketplaceListingId || listing.ebayItemId || existing.marketplaceListingId || rawSummary?.marketplaceListingId,
      ''
    ),
    url: normalizeText(listing.url || existing.url || rawSummary?.itemWebUrl, ''),
    rawPayloadRemoved: true,
    rawPayloadSummary: rawSummary || existing.rawPayloadSummary || null
  };
}

function normalizeCoreListingFields(listing = {}) {
  const raw = isObject(listing.raw) ? listing.raw : {};
  const itemId = normalizeText(
    listingIdentity.getListingId(listing) || raw.itemId || raw.legacyItemId,
    ''
  );
  const price = hasOwn(listing, 'price') ? toNumber(listing.price, 0) : toNumber(raw.price?.value, 0);
  const shipping = hasOwn(listing, 'shipping')
    ? toNumber(listing.shipping, 0)
    : toNumber(raw.shippingOptions?.[0]?.shippingCost?.value, 0);
  const totalCost = hasOwn(listing, 'totalCost') ? toNumber(listing.totalCost, price + shipping) : price + shipping;

  return {
    listingId: normalizeText(listing.listingId || itemId, itemId),
    marketplace: normalizeText(listing.marketplace || 'ebay', 'ebay'),
    marketplaceListingId: normalizeText(listing.marketplaceListingId || itemId, itemId),
    marketplaceLabel: normalizeText(listing.marketplaceLabel || 'eBay', 'eBay'),
    ebayItemId: normalizeText(listing.ebayItemId || itemId, itemId),
    title: normalizeText(listing.title || raw.title, 'Untitled'),
    price,
    shipping,
    totalCost,
    currency: normalizeText(listing.currency || raw.price?.currency, 'USD'),
    condition: normalizeText(listing.condition || raw.condition, 'Unknown'),
    url: normalizeText(listing.url || raw.itemWebUrl, ''),
    image: normalizeText(listing.image || raw.image?.imageUrl, ''),
    sellerUsername: normalizeText(listing.sellerUsername || raw.seller?.username, 'Unknown'),
    sellerFeedbackPercentage: toNumber(listing.sellerFeedbackPercentage ?? raw.seller?.feedbackPercentage, 0),
    sellerFeedbackScore: toNumber(listing.sellerFeedbackScore ?? raw.seller?.feedbackScore, 0),
    buyingOptions: Array.isArray(listing.buyingOptions)
      ? [...listing.buyingOptions]
      : Array.isArray(raw.buyingOptions)
        ? [...raw.buyingOptions]
        : [],
    itemEndDate: listing.itemEndDate || raw.itemEndDate || null,
    parsed: clone(listing.parsed || {})
  };
}

function removeTransientRetainedFields(listing = {}) {
  const compact = clone(listing) || {};
  for (const key of TRANSIENT_RETAINED_KEYS) {
    delete compact[key];
  }
  return compact;
}

function compactMarketplaceListing(listing = {}) {
  const compact = {
    ...removeTransientRetainedFields(listing),
    ...normalizeCoreListingFields(listing),
    marketplaceProvenance: buildMarketplaceProvenance(listing),
    listingCompaction: {
      source: LISTING_COMPACTION_SOURCE,
      schemaVersion: LISTING_COMPACTION_SCHEMA_VERSION,
      compacted: true,
      rawPayloadRetained: false
    }
  };

  return compact;
}

function compactRetainedListing(listing = {}) {
  if (!listing || typeof listing !== 'object') return listing;

  const compact = {
    ...removeTransientRetainedFields(listing),
    ...normalizeCoreListingFields(listing),
    marketplaceProvenance: buildMarketplaceProvenance(listing),
    listingCompaction: {
      source: LISTING_COMPACTION_SOURCE,
      schemaVersion: LISTING_COMPACTION_SCHEMA_VERSION,
      compacted: true,
      rawPayloadRetained: false
    }
  };

  return compact;
}

function validateCompactListing(listing = {}) {
  const input = isObject(listing) ? listing : {};
  const missingFields = REQUIRED_COMPACT_LISTING_FIELDS.filter((field) => {
    const value = input[field];
    if (Array.isArray(value)) return false;
    if (value && typeof value === 'object') return false;
    return value === undefined || value === null || value === '';
  });
  const transientFieldsPresent = TRANSIENT_RETAINED_KEYS.filter((field) => hasOwn(input, field));
  const errors = [];
  const warnings = [];

  if (missingFields.length) errors.push(...missingFields.map((field) => `missing_${field}`));
  if (transientFieldsPresent.length) errors.push(...transientFieldsPresent.map((field) => `transient_field_present_${field}`));
  if (!isObject(input.marketplaceProvenance)) warnings.push('missing_marketplace_provenance');
  if (input.listingCompaction?.compacted !== true) warnings.push('missing_listing_compaction_marker');

  return {
    valid: errors.length === 0,
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)],
    missingFields,
    transientFieldsPresent
  };
}

function serializedBytes(value = {}) {
  return Buffer.byteLength(JSON.stringify(value || {}), 'utf8');
}

function estimateListingFootprint(listing = {}) {
  const compact = compactRetainedListing(listing);
  const originalBytes = serializedBytes(listing);
  const compactBytes = serializedBytes(compact);
  const removedBytes = Math.max(0, originalBytes - compactBytes);

  return {
    source: LISTING_COMPACTION_SOURCE,
    schemaVersion: LISTING_COMPACTION_SCHEMA_VERSION,
    originalSerializedBytes: originalBytes,
    compactSerializedBytes: compactBytes,
    removedSerializedBytes: removedBytes,
    reductionRatio: originalBytes > 0 ? Number((removedBytes / originalBytes).toFixed(4)) : 0
  };
}

function compactStoreListings(listings = {}) {
  if (!isObject(listings)) return {};
  return Object.fromEntries(
    Object.entries(listings).map(([key, listing]) => [key, compactRetainedListing(listing)])
  );
}

function buildListingCompactionSummary(before = {}, after = compactRetainedListing(before)) {
  const beforeKeys = Object.keys(isObject(before) ? before : {}).sort();
  const afterKeys = Object.keys(isObject(after) ? after : {}).sort();
  const footprint = estimateListingFootprint(before);

  return {
    source: LISTING_COMPACTION_SOURCE,
    schemaVersion: LISTING_COMPACTION_SCHEMA_VERSION,
    listingId: listingIdentity.getListingId(after) || null,
    removedFields: beforeKeys.filter((key) => !afterKeys.includes(key)),
    preservedFields: afterKeys,
    transientFieldsRemoved: TRANSIENT_RETAINED_KEYS.filter((key) => beforeKeys.includes(key) && !afterKeys.includes(key)),
    marketplaceProvenancePreserved: isObject(after.marketplaceProvenance),
    footprint
  };
}

module.exports = {
  LISTING_COMPACTION_SCHEMA_VERSION,
  LISTING_COMPACTION_SOURCE,
  REQUIRED_COMPACT_LISTING_FIELDS,
  TRANSIENT_RETAINED_KEYS,
  buildListingCompactionSummary,
  compactMarketplaceListing,
  compactRetainedListing,
  compactStoreListings,
  estimateListingFootprint,
  validateCompactListing
};
