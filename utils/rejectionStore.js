'use strict';

const DEFAULT_REJECTION_LIMIT = 300;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeString(value) {
  return String(value ?? '').trim();
}

function normalizeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 10000) / 10000 : null;
}

function normalizeReasons(reasons = []) {
  return asArray(reasons)
    .map((reason) => normalizeString(reason))
    .filter(Boolean)
    .sort();
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stableStringify(value[key])}`
    ).join(',')}}`;
  }
  return JSON.stringify(value);
}

function buildRejectionMaterialKey(rejection = {}) {
  return stableStringify({
    ebayItemId: normalizeString(rejection.ebayItemId),
    lane: normalizeString(rejection.lane),
    title: normalizeString(rejection.title),
    score: normalizeNumber(rejection.score),
    estimatedProfit: normalizeNumber(rejection.estimatedProfit),
    roi: normalizeNumber(rejection.roi),
    marketConfidence: normalizeNumber(rejection.marketConfidence),
    confidenceCap: normalizeNumber(rejection.confidenceCap),
    compCount: normalizeNumber(rejection.compCount),
    compSource: normalizeString(rejection.compSource),
    investmentQuality: normalizeNumber(rejection.investmentQuality),
    qualityBucket: normalizeString(rejection.qualityBucket),
    liquidityScore: normalizeNumber(rejection.liquidityScore),
    riskLevel: normalizeString(rejection.riskLevel),
    dealGrade: stableStringify(rejection.dealGrade || null),
    reasons: normalizeReasons(rejection.reasons)
  });
}

function normalizeRejection(rejection = {}, observedAt = new Date().toISOString()) {
  const firstRejectedAt = rejection.firstRejectedAt || rejection.createdAt || observedAt;
  const latestRejectedAt = rejection.latestRejectedAt || rejection.lastRejectedAt || rejection.createdAt || observedAt;
  const rejectionCount = Math.max(1, Number(rejection.rejectionCount || rejection.occurrenceCount || 1) || 1);

  return {
    ...rejection,
    reasons: normalizeReasons(rejection.reasons),
    createdAt: rejection.createdAt || firstRejectedAt,
    firstRejectedAt,
    latestRejectedAt,
    lastRejectedAt: latestRejectedAt,
    rejectionCount,
    occurrenceCount: rejectionCount,
    materialKey: rejection.materialKey || buildRejectionMaterialKey(rejection)
  };
}

function addOrCoalesceRejection(rejections = [], rejection = {}, options = {}) {
  const limit = Math.max(1, Number(options.limit || DEFAULT_REJECTION_LIMIT) || DEFAULT_REJECTION_LIMIT);
  const observedAt = options.observedAt || rejection.createdAt || new Date().toISOString();
  const candidate = normalizeRejection({
    ...rejection,
    createdAt: rejection.createdAt || observedAt,
    latestRejectedAt: observedAt,
    lastRejectedAt: observedAt
  }, observedAt);
  const existingRecords = asArray(rejections).map((entry) => normalizeRejection(entry));
  const existingIndex = existingRecords.findIndex((entry) =>
    entry.ebayItemId === candidate.ebayItemId &&
    entry.materialKey === candidate.materialKey
  );

  if (existingIndex >= 0) {
    const existing = existingRecords[existingIndex];
    const updated = normalizeRejection({
      ...existing,
      ...candidate,
      createdAt: existing.createdAt || existing.firstRejectedAt || candidate.createdAt,
      firstRejectedAt: existing.firstRejectedAt || existing.createdAt || candidate.firstRejectedAt,
      latestRejectedAt: observedAt,
      lastRejectedAt: observedAt,
      rejectionCount: Math.max(1, Number(existing.rejectionCount || existing.occurrenceCount || 1) || 1) + 1,
      occurrenceCount: Math.max(1, Number(existing.occurrenceCount || existing.rejectionCount || 1) || 1) + 1,
      materialKey: existing.materialKey || candidate.materialKey
    }, observedAt);
    const next = existingRecords.filter((_, index) => index !== existingIndex);
    next.unshift(updated);
    return {
      rejections: next.slice(0, limit),
      coalesced: true,
      rejection: updated
    };
  }

  return {
    rejections: [candidate, ...existingRecords].slice(0, limit),
    coalesced: false,
    rejection: candidate
  };
}

module.exports = {
  DEFAULT_REJECTION_LIMIT,
  addOrCoalesceRejection,
  buildRejectionMaterialKey,
  normalizeRejection,
  normalizeReasons
};
