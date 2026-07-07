'use strict';

const ebayMarketplace = require('./ebayMarketplace');
const mockMarketplace = require('./mockMarketplace');

const marketplaces = [ebayMarketplace, mockMarketplace];
const activeMarketplace = ebayMarketplace;

function getActiveMarketplace() {
  return activeMarketplace;
}

function getMarketplace(name = 'ebay') {
  const normalizedName = String(name || '').trim().toLowerCase();
  return marketplaces.find((marketplace) => marketplace.marketplace === normalizedName) || null;
}

function listMarketplaces() {
  return [...marketplaces];
}

module.exports = {
  getActiveMarketplace,
  getMarketplace,
  listMarketplaces
};
