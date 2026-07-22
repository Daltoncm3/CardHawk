'use strict';

const path = require('path');
const listingIdentity = require('./listingIdentity');
const stateStore = require('./stateStore');
const serializationInstrumentation = require('./serializationInstrumentation');

const DEFAULT_SHADOW_MODE_FILE = path.join(__dirname, '..', 'data', 'shadow-mode.json');
const MAX_SHADOW_RECORDS = 1000;
const STATE_VERSION = 1;

function isShadowModeEnabled(env = process.env) {
  return String(env.CARDHAWK_SHADOW_MODE_ENABLED || 'false').toLowerCase() === 'true';
}

function nowIso() {
  return new Date().toISOString();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function toNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function compactSignal(signal = {}) {
  if (typeof signal === 'string') {
    return {
      source: signal,
      message: signal
    };
  }

  return {
    source: signal.source || signal.type || signal.key || '',
    message: signal.message || signal.summary || signal.explanation || signal.reason || ''
  };
}

function compactSignals(signals = []) {
  return asArray(signals).map(compactSignal);
}

function compactListing(listing = {}) {
  return {
    id: listingIdentity.getListingId(listing),
    title: listing.title || '',
    price: toNumber(listing.price ?? listing.currentPrice ?? listing.listPrice),
    totalCost: toNumber(listing.totalCost),
    marketplace: listing.marketplace || listing.platform || listing.source || 'ebay'
  };
}

function compactScanContext(scanContext = {}) {
  return {
    scanId: scanContext.scanId || scanContext.id || null,
    source: scanContext.source || null,
    lane: scanContext.lane || null,
    query: scanContext.query || null
  };
}

function compactDecisionIntelligence(decisionIntelligence = {}) {
  return {
    overallReadiness: decisionIntelligence.overallReadiness || 'unknown',
    evidencePosture: decisionIntelligence.evidencePosture || 'unknown',
    compPosture: decisionIntelligence.compPosture || 'unknown',
    valuationPosture: decisionIntelligence.valuationPosture || 'unknown',
    resalePressurePosture: decisionIntelligence.resalePressurePosture || 'unknown',
    recommendationImpact: 'none',
    supportingSignals: compactSignals(decisionIntelligence.supportingSignals),
    cautionSignals: compactSignals(decisionIntelligence.cautionSignals),
    blockers: compactSignals(decisionIntelligence.blockers),
    conflicts: compactSignals(decisionIntelligence.conflicts),
    summary: decisionIntelligence.summary || ''
  };
}

function createDefaultState() {
  return {
    version: STATE_VERSION,
    updatedAt: null,
    records: []
  };
}

function normalizeState(state = {}) {
  return {
    version: state.version || STATE_VERSION,
    updatedAt: state.updatedAt || null,
    records: asArray(state.records)
  };
}

function buildShadowModeRecord(input = {}) {
  const listing = asObject(input.listing);
  const createdAt = input.createdAt || nowIso();
  const listingId = listingIdentity.getListingId(listing) || input.listingId || null;

  return {
    id: input.id || `shadow-${listingId || 'unknown'}-${new Date(createdAt).getTime() || Date.now()}`,
    createdAt,
    listingId,
    scanContext: compactScanContext(input.scanContext),
    listing: compactListing(listing),
    decisionIntelligence: compactDecisionIntelligence(input.decisionIntelligence),
    comparison: {
      existingRecommendation: input.comparison?.existingRecommendation || null,
      dealGatePassed: input.comparison?.dealGatePassed ?? null,
      score: toNumber(input.comparison?.score)
    }
  };
}

function writeShadowModeRecord(input = {}, options = {}) {
  const filePath = options.filePath || DEFAULT_SHADOW_MODE_FILE;
  const state = serializationInstrumentation.withSerializationGroup('ShadowModeLogger', () =>
    normalizeState(stateStore.loadJsonState(filePath, createDefaultState()))
  );
  const record = buildShadowModeRecord(input);
  const records = [...state.records, record].slice(-MAX_SHADOW_RECORDS);
  const nextState = {
    version: STATE_VERSION,
    updatedAt: record.createdAt,
    records
  };

  serializationInstrumentation.withSerializationGroup('ShadowModeLogger', () =>
    stateStore.saveJsonState(filePath, nextState)
  );

  return {
    ok: true,
    filePath,
    recordCount: records.length,
    record
  };
}

function logShadowModeDecision(input = {}, options = {}) {
  const env = options.env || process.env;

  if (!isShadowModeEnabled(env)) {
    return {
      ok: false,
      skipped: true,
      reason: 'shadow_mode_disabled'
    };
  }

  return writeShadowModeRecord(input, options);
}

module.exports = {
  DEFAULT_SHADOW_MODE_FILE,
  MAX_SHADOW_RECORDS,
  buildShadowModeRecord,
  createDefaultState,
  isShadowModeEnabled,
  logShadowModeDecision,
  writeShadowModeRecord
};
