'use strict';

const {
  buildCanonicalCardKey
} = require('../utils/soldEvidenceStore');

const TRUE_SOLD = 'true_sold';
const DEFAULT_RECENT_DAYS = 90;
const DEFAULT_STALE_DAYS = 180;

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeText(value) {
  return String(value || '').toLowerCase().trim();
}

function normalizeDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function daysBetween(later, earlier) {
  const laterDate = normalizeDate(later);
  const earlierDate = normalizeDate(earlier);
  if (!laterDate || !earlierDate) return null;
  return Math.floor((laterDate.getTime() - earlierDate.getTime()) / 86400000);
}

function getIdentityRecords(store = {}, identityOrKey = {}) {
  const canonicalCardKey = typeof identityOrKey === 'string'
    ? identityOrKey
    : buildCanonicalCardKey(identityOrKey);
  const ids = store.identityIndex?.[canonicalCardKey] || [];

  return {
    canonicalCardKey,
    records: ids.map((id) => store.records?.[id]).filter(Boolean)
  };
}

function isTrueSoldRecord(record = {}) {
  return record.evidenceType === TRUE_SOLD && record.status === 'active_evidence';
}

function passesMarketplace(record, marketplace) {
  if (!marketplace) return true;
  const allowed = Array.isArray(marketplace) ? marketplace : [marketplace];
  const normalizedAllowed = allowed.map(normalizeText);
  return normalizedAllowed.includes(normalizeText(record.marketplace))
    || normalizedAllowed.includes(normalizeText(record.marketplaceLabel));
}

function passesDateRange(record, filters = {}) {
  const soldAt = normalizeDate(record.soldAt);
  if (!soldAt) return false;

  const from = normalizeDate(filters.dateFrom || filters.soldAfter || filters.from);
  const to = normalizeDate(filters.dateTo || filters.soldBefore || filters.to);

  if (from && soldAt < from) return false;
  if (to && soldAt > to) return false;
  return true;
}

function passesEvidenceQuality(record, filters = {}) {
  const minScore = filters.minEvidenceQualityScore ?? filters.evidenceQualityScoreMin;
  if (minScore !== undefined && toNumber(record.evidenceQualityScore, 0) < toNumber(minScore, 0)) {
    return false;
  }

  if (!filters.evidenceQualityLevel) return true;
  const allowed = Array.isArray(filters.evidenceQualityLevel)
    ? filters.evidenceQualityLevel
    : [filters.evidenceQualityLevel];
  return allowed.map(normalizeText).includes(normalizeText(record.evidenceQualityLevel));
}

function passesGradeCondition(record, filters = {}) {
  if (filters.grade !== undefined && normalizeText(record.grade) !== normalizeText(filters.grade)) {
    return false;
  }
  if (filters.gradeCompany !== undefined && normalizeText(record.gradeCompany) !== normalizeText(filters.gradeCompany)) {
    return false;
  }
  if (filters.condition !== undefined && normalizeText(record.condition) !== normalizeText(filters.condition)) {
    return false;
  }
  return true;
}

function filterRecords(records = [], filters = {}) {
  return records
    .filter((record) => (filters.trueSoldOnly ? isTrueSoldRecord(record) : true))
    .filter((record) => passesMarketplace(record, filters.marketplace))
    .filter((record) => passesDateRange(record, filters))
    .filter((record) => passesEvidenceQuality(record, filters))
    .filter((record) => passesGradeCondition(record, filters))
    .sort((a, b) => new Date(b.soldAt || 0) - new Date(a.soldAt || 0));
}

function median(values = []) {
  const sorted = values
    .map((value) => toNumber(value, NaN))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[middle];
  return Math.round(((sorted[middle - 1] + sorted[middle]) / 2) * 100) / 100;
}

function recencyWeight(record, asOf) {
  const ageDays = daysBetween(asOf, record.soldAt);
  if (ageDays === null || ageDays < 0) return 0.25;
  if (ageDays <= 30) return 1;
  if (ageDays <= 90) return 0.75;
  if (ageDays <= 180) return 0.5;
  return 0.25;
}

function weightedSoldAverage(records = [], options = {}) {
  const asOf = options.asOf || new Date().toISOString();
  let weightedTotal = 0;
  let totalWeight = 0;

  for (const record of records) {
    const price = toNumber(record.totalPaid || record.soldPrice, 0);
    if (price <= 0) continue;

    const qualityWeight = Math.max(0.1, Math.min(1, toNumber(record.evidenceQualityScore, 50) / 100));
    const weight = qualityWeight * recencyWeight(record, asOf);
    weightedTotal += price * weight;
    totalWeight += weight;
  }

  if (!totalWeight) return null;
  return Math.round((weightedTotal / totalWeight) * 100) / 100;
}

function summarizeSoldEvidence(records = [], options = {}) {
  const asOf = options.asOf || new Date().toISOString();
  const recentDays = toNumber(options.recentDays, DEFAULT_RECENT_DAYS);
  const staleDays = toNumber(options.staleDays, DEFAULT_STALE_DAYS);
  const trueSoldRecords = records.filter(isTrueSoldRecord);
  const soldPrices = trueSoldRecords
    .map((record) => toNumber(record.totalPaid || record.soldPrice, 0))
    .filter((price) => price > 0);
  const newestSoldDate = trueSoldRecords
    .map((record) => record.soldAt)
    .filter(Boolean)
    .sort((a, b) => new Date(b) - new Date(a))[0] || null;

  const sourceMix = trueSoldRecords.reduce((mix, record) => {
    const marketplace = record.marketplace || 'unknown';
    mix[marketplace] = (mix[marketplace] || 0) + 1;
    return mix;
  }, {});

  const freshness = trueSoldRecords.reduce((counts, record) => {
    const ageDays = daysBetween(asOf, record.soldAt);
    if (ageDays === null || ageDays < 0) return counts;
    if (ageDays <= recentDays) counts.recentSoldCount += 1;
    if (ageDays > staleDays) counts.staleCount += 1;
    else counts.freshCount += 1;
    return counts;
  }, {
    recentSoldCount: 0,
    staleCount: 0,
    freshCount: 0
  });

  return {
    trueSoldCount: trueSoldRecords.length,
    recentSoldCount: freshness.recentSoldCount,
    medianSold: median(soldPrices),
    weightedSoldAverage: weightedSoldAverage(trueSoldRecords, { asOf }),
    newestSoldDate,
    staleCount: freshness.staleCount,
    freshCount: freshness.freshCount,
    sourceMix
  };
}

function querySoldEvidence(store = {}, identityOrKey = {}, filters = {}, options = {}) {
  const queryFilters = {
    trueSoldOnly: filters.trueSoldOnly !== false,
    ...filters
  };
  const { canonicalCardKey, records } = getIdentityRecords(store, identityOrKey);
  const matchingRecords = filterRecords(records, queryFilters);
  const summary = summarizeSoldEvidence(matchingRecords, options);

  return {
    canonicalCardKey,
    filters: queryFilters,
    matchingRecords,
    records: matchingRecords,
    ...summary
  };
}

module.exports = {
  DEFAULT_RECENT_DAYS,
  DEFAULT_STALE_DAYS,
  filterRecords,
  getIdentityRecords,
  isTrueSoldRecord,
  querySoldEvidence,
  summarizeSoldEvidence,
  weightedSoldAverage
};
