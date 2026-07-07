'use strict';

const ID_KEYS = ['listingId', 'marketplaceListingId', 'ebayItemId', 'itemId', 'id'];

function normalizeId(value) {
  return String(value ?? '').trim();
}

function getListingId(input = {}) {
  if (typeof input === 'string' || typeof input === 'number') {
    return normalizeId(input);
  }

  if (!input || typeof input !== 'object') return '';

  for (const key of ID_KEYS) {
    const value = normalizeId(input[key]);
    if (value) return value;
  }

  return '';
}

module.exports = {
  getListingId
};
