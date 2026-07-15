'use strict';

const {
  asArray,
  asObject,
  unique
} = require('./canonicalValidationCore');

function clone(value) {
  return JSON.parse(JSON.stringify(value || null));
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function collectBlockingReasons(rules = []) {
  const reasons = [];
  for (const rule of asArray(rules)) {
    if (!rule || rule.when !== true) continue;
    const value = typeof rule.reason === 'function' ? rule.reason() : rule.reason;
    reasons.push(...(Array.isArray(value) ? value : [value]).filter(Boolean));
  }
  return unique(reasons);
}

function normalizeRequirement(value = {}, defaultRequired = true) {
  const input = typeof value === 'boolean' ? { required: value } : asObject(value);
  return {
    required: input.required === undefined ? defaultRequired : input.required === true,
    satisfied: input.satisfied === true || input.configured === true || input.exists === true || input.approved === true,
    details: input
  };
}

function buildOfflineAuthorityFlags(overrides = {}) {
  return {
    productionApproval: false,
    liveIngestionAuthority: false,
    marketplaceRequestAuthority: false,
    automaticStoreWriteAuthority: false,
    canonicalSoldEvidenceWriteAuthority: false,
    ...asObject(overrides)
  };
}

function chooseRecommendedAction(rules = [], fallback = null) {
  const match = asArray(rules).find((rule) => rule && rule.when === true);
  return match ? match.action : fallback;
}

module.exports = {
  buildOfflineAuthorityFlags,
  chooseRecommendedAction,
  clone,
  collectBlockingReasons,
  firstDefined,
  normalizeRequirement
};
