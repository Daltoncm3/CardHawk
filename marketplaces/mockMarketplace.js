'use strict';

const config = {
  searchDelayMs: 0,
  laneDelayMs: 0,
  maxRetries: 0,
  backoffBaseMs: 0,
  scanQueryLimit: 3
};

function compactError(error) {
  return error?.message || String(error);
}

function isRateLimitError() {
  return false;
}

function normalizeItem(item, options = {}) {
  const parseCardTitle = options.parseCardTitle || (() => ({}));
  const listingId = String(item.itemId || item.listingId || item.id || '').trim();
  const price = Number(item.price?.value ?? item.price ?? 0);
  const shipping = Number(item.shippingOptions?.[0]?.shippingCost?.value ?? item.shipping ?? 0);
  const totalCost = Number(item.totalCost ?? price + shipping);
  const title = item.title || 'Mock CardHawk Listing';

  return {
    listingId,
    marketplace: 'mock',
    marketplaceListingId: listingId,
    marketplaceLabel: 'Mock Marketplace',
    ebayItemId: listingId,
    title,
    price,
    shipping,
    totalCost,
    currency: item.price?.currency || item.currency || 'USD',
    condition: item.condition || 'Unknown',
    url: item.url || item.itemWebUrl || `https://example.invalid/cardhawk/mock/${encodeURIComponent(listingId)}`,
    image: item.image?.imageUrl || item.image || '',
    sellerUsername: item.seller?.username || item.sellerUsername || 'MockSeller',
    sellerFeedbackPercentage: Number(item.seller?.feedbackPercentage ?? item.sellerFeedbackPercentage ?? 100),
    sellerFeedbackScore: Number(item.seller?.feedbackScore ?? item.sellerFeedbackScore ?? 0),
    buyingOptions: item.buyingOptions || ['FIXED_PRICE'],
    itemEndDate: item.itemEndDate || null,
    parsed: parseCardTitle(title),
    raw: item
  };
}

async function search(query, limit = config.scanQueryLimit, options = {}) {
  const count = Math.max(0, Math.min(Number(limit) || config.scanQueryLimit, config.scanQueryLimit));
  const safeQuery = String(query || 'card').trim() || 'card';

  return Array.from({ length: count }, (_, index) => normalizeItem({
    itemId: `mock-${index + 1}-${safeQuery.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'card'}`,
    title: `${safeQuery} Mock Listing ${index + 1}`,
    price: 10 + index * 5,
    shipping: index === 0 ? 0 : 4.99,
    condition: 'Mock',
    sellerUsername: 'MockSeller',
    sellerFeedbackPercentage: 100,
    sellerFeedbackScore: 999,
    buyingOptions: ['FIXED_PRICE']
  }, options));
}

async function searchWithBackoff(query, limit = config.scanQueryLimit, options = {}) {
  return search(query, limit, options);
}

module.exports = {
  marketplace: 'mock',
  marketplaceLabel: 'Mock Marketplace',
  config,
  search,
  searchWithBackoff,
  normalizeItem,
  isRateLimitError,
  compactError
};
