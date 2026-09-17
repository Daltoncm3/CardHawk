'use strict';

const DEFAULT_TARGETED_DISCOVERY_OBSERVATION_LIMIT = 500;
const SCHEMA_VERSION = '1.0.0';
const ARTIFACT_TYPE = 'targeted_discovery_observation';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function toPositiveInteger(value, fallback) {
  const number = Number(value);
  const fallbackNumber = Number(fallback);
  const safeFallback = Number.isFinite(fallbackNumber) && fallbackNumber > 0 ? Math.floor(fallbackNumber) : 1;
  if (!Number.isFinite(number) || number <= 0) return safeFallback;
  return Math.floor(number);
}

function getListingId(listing = {}) {
  return String(listing.marketplaceListingId || listing.ebayItemId || listing.listingId || listing.itemId || '').trim();
}

function getListingType(listing = {}) {
  const buyingOptions = asArray(listing.buyingOptions).map((option) => String(option || '').toUpperCase());
  if (buyingOptions.includes('AUCTION')) return 'AUCTION';
  if (buyingOptions.includes('FIXED_PRICE')) return 'FIXED_PRICE';
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

function normalizeObservationCollection(value) {
  if (Array.isArray(value)) return value.map((entry) => ({ ...entry }));
  if (Array.isArray(value?.records)) return value.records.map((entry) => ({ ...entry }));
  return [];
}

function normalizeRetentionLimit(options = {}) {
  return toPositiveInteger(
    options.limit ?? options.env?.CARDHAWK_TARGETED_DISCOVERY_OBSERVATION_LIMIT,
    DEFAULT_TARGETED_DISCOVERY_OBSERVATION_LIMIT
  );
}

function buildObservationId(laneId, listingId) {
  return `${String(laneId || 'targeted_discovery').trim()}:${String(listingId || 'unknown').trim()}`;
}

function sortObservations(records = []) {
  return [...records].sort((a, b) => {
    const lastCompare = String(b.lastObservedAt || '').localeCompare(String(a.lastObservedAt || ''));
    if (lastCompare) return lastCompare;
    return String(a.observationId || '').localeCompare(String(b.observationId || ''));
  });
}

function normalizeTargetedDiscoveryObservations(value, options = {}) {
  return sortObservations(normalizeObservationCollection(value))
    .slice(0, normalizeRetentionLimit(options));
}

function buildObservationArtifact(input = {}, existing = null) {
  const listing = asObject(input.listing);
  const triage = asObject(input.triage);
  const laneId = input.laneId || input.config?.laneId || 'targeted_discovery';
  const listingId = input.listingId || getListingId(listing);
  const observedAt = input.observedAt || new Date().toISOString();
  const firstObservedAt = existing?.firstObservedAt || input.firstObservedAt || observedAt;
  const observationId = buildObservationId(laneId, listingId);
  const marketplaceStartTimestamp = input.marketplaceStartTimestamp ?? getMarketplaceStartTimestamp(listing);

  return {
    schemaVersion: SCHEMA_VERSION,
    artifactType: ARTIFACT_TYPE,
    observationId,
    marketplace: listing.marketplace || 'ebay',
    listingId,
    ebayItemId: listing.ebayItemId || listingId,
    marketplaceListingId: listing.marketplaceListingId || listingId,
    title: listing.title || 'Untitled',
    price: Number.isFinite(Number(listing.price)) ? Number(listing.price) : null,
    totalCost: Number.isFinite(Number(listing.totalCost)) ? Number(listing.totalCost) : null,
    currency: listing.currency || 'USD',
    url: listing.url || listing.itemWebUrl || null,
    listingType: input.listingType || getListingType(listing),
    buyingOptions: asArray(listing.buyingOptions).map((option) => String(option)),
    laneId,
    laneName: input.laneName || input.config?.laneName || 'Targeted Discovery Lane',
    query: input.query || null,
    page: Number.isFinite(Number(input.page)) ? Number(input.page) : null,
    offset: Number.isFinite(Number(input.offset)) ? Number(input.offset) : null,
    marketplaceStartTimestamp,
    observedAt,
    firstObservedAt,
    lastObservedAt: observedAt,
    freshnessAvailable: input.ageAtObservationMs !== null && input.ageAtObservationMs !== undefined,
    ageAtObservationMs: input.ageAtObservationMs ?? null,
    ageAtFirstObservationMs: input.ageAtFirstObservationMs ?? input.ageAtObservationMs ?? null,
    duplicateClassification: input.duplicateClassification || 'unique_raw_result',
    observationStatus: input.observationStatus || 'unknown',
    candidatePreserved: Boolean(input.candidatePreserved),
    cheapTriage: {
      rejected: Boolean(triage.rejected),
      reason: triage.reason || (triage.rejected ? 'unknown_rejection' : 'candidate_preserved'),
      ambiguous: Boolean(triage.ambiguous),
      missingTerms: asArray(triage.missingTerms).map((term) => String(term))
    },
    observationCount: Number(existing?.observationCount || 0) + 1,
    lastRunId: input.runId || null,
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none',
    soldEvidenceImpact: 'none',
    valuationImpact: 'none',
    dealGateImpact: 'none',
    buyNowImpact: 'none',
    alertImpact: 'none',
    purchaseAuthority: 'none',
    bidAuthority: 'none',
    offerAuthority: 'none',
    canonicalSoldEvidenceEligible: false,
    valuationComparableEligible: false,
    notificationEligible: false,
    buyNowEligible: false
  };
}

function recordTargetedDiscoveryObservation(store = {}, input = {}, options = {}) {
  const listing = asObject(input.listing);
  const listingId = input.listingId || getListingId(listing);
  if (!listingId) {
    return {
      recorded: false,
      reason: 'missing_listing_id',
      observation: null,
      observations: normalizeTargetedDiscoveryObservations(store.targetedDiscoveryObservations, options)
    };
  }

  const laneId = input.laneId || input.config?.laneId || 'targeted_discovery';
  const observationId = buildObservationId(laneId, listingId);
  const existingRecords = normalizeObservationCollection(store.targetedDiscoveryObservations);
  const existing = existingRecords.find((record) => record.observationId === observationId) || null;
  const updated = buildObservationArtifact(input, existing);
  const nextRecords = existingRecords.filter((record) => record.observationId !== observationId);
  nextRecords.push(updated);

  store.targetedDiscoveryObservations = normalizeTargetedDiscoveryObservations(nextRecords, options);

  return {
    recorded: true,
    reason: existing ? 'updated_existing_observation' : 'created_observation',
    observation: updated,
    observations: store.targetedDiscoveryObservations
  };
}

function listTargetedDiscoveryObservations(store = {}, filters = {}) {
  const laneId = filters.laneId ? String(filters.laneId) : null;
  const listingId = filters.listingId ? String(filters.listingId) : null;
  const limit = filters.limit ? toPositiveInteger(filters.limit, DEFAULT_TARGETED_DISCOVERY_OBSERVATION_LIMIT) : null;
  const records = normalizeTargetedDiscoveryObservations(store.targetedDiscoveryObservations)
    .filter((record) => !laneId || record.laneId === laneId)
    .filter((record) => !listingId || record.listingId === listingId || record.ebayItemId === listingId || record.marketplaceListingId === listingId);

  return (limit ? records.slice(0, limit) : records).map((record) => ({ ...record }));
}

function getTargetedDiscoveryObservation(store = {}, filters = {}) {
  return listTargetedDiscoveryObservations(store, { ...filters, limit: 1 })[0] || null;
}

module.exports = {
  ARTIFACT_TYPE,
  DEFAULT_TARGETED_DISCOVERY_OBSERVATION_LIMIT,
  SCHEMA_VERSION,
  buildObservationArtifact,
  getTargetedDiscoveryObservation,
  listTargetedDiscoveryObservations,
  normalizeTargetedDiscoveryObservations,
  recordTargetedDiscoveryObservation
};
