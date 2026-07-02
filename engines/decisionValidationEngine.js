'use strict';

const SOURCE = 'decision_validation_engine';

const recordsById = new Map();
const decisionHistory = [];
const outcomeHistory = [];

const BUY_RECOMMENDATIONS = new Set(['BUY_NOW']);
const WATCH_RECOMMENDATIONS = new Set(['STRONG_WATCH', 'WATCH', 'MONITOR']);
const PASS_RECOMMENDATIONS = new Set(['PASS']);

const VALID_DECISIONS = new Set([
  'BUY_NOW',
  'STRONG_WATCH',
  'WATCH',
  'MONITOR',
  'PASS'
]);

const VALID_OUTCOMES = new Set([
  'sold',
  'disappeared',
  'user_bought',
  'user_passed',
  'price_dropped',
  'stale',
  'unknown'
]);

function nowIso() {
  return new Date().toISOString();
}

function clamp(value, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) return min;
  return Math.max(min, Math.min(max, num));
}

function toNumber(value, fallback = null) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function toStringValue(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  return String(value);
}

function normalizeDecision(value) {
  const decision = toStringValue(value, '').trim().toUpperCase();
  return VALID_DECISIONS.has(decision) ? decision : 'MONITOR';
}

function normalizeOutcomeType(value) {
  const outcomeType = toStringValue(value, 'unknown').trim().toLowerCase();
  return VALID_OUTCOMES.has(outcomeType) ? outcomeType : 'unknown';
}

function getListingId(input = {}) {
  return (
    input.listingId ||
    input.ebayItemId ||
    input.itemId ||
    input.id ||
    input.listing?.ebayItemId ||
    input.listing?.itemId ||
    input.listing?.id ||
    input.decisionData?.ebayItemId ||
    input.decisionData?.listingId ||
    null
  );
}

function extractDecision(input = {}) {
  return (
    input.decision ||
    input.recommendation ||
    input.finalRecommendation ||
    input.decisionData?.recommendation ||
    input.decisionData?.decision ||
    input.scoring?.decision ||
    input.scoring?.decisionData?.recommendation ||
    null
  );
}

function extractExpectedValue(input = {}) {
  return toNumber(
    input.expectedValue ??
      input.marketValue ??
      input.estimatedValue ??
      input.valueData?.expectedValue ??
      input.valueData?.marketValue ??
      input.marketData?.expectedValue ??
      input.marketData?.marketValue ??
      input.decisionData?.expectedValue ??
      input.decisionData?.marketValue,
    null
  );
}

function extractExpectedValueLow(input = {}) {
  return toNumber(
    input.expectedValueLow ??
      input.valueData?.expectedValueLow ??
      input.marketData?.expectedValueLow ??
      input.decisionData?.expectedValueLow,
    null
  );
}

function extractExpectedValueHigh(input = {}) {
  return toNumber(
    input.expectedValueHigh ??
      input.valueData?.expectedValueHigh ??
      input.marketData?.expectedValueHigh ??
      input.decisionData?.expectedValueHigh,
    null
  );
}

function extractListingCost(input = {}) {
  return toNumber(
    input.listingCost ??
      input.cost ??
      input.price ??
      input.listingPrice ??
      input.listing?.price ??
      input.listing?.currentPrice ??
      input.roiData?.cost ??
      input.roiData?.listingCost,
    null
  );
}

function extractProjectedRoi(input = {}) {
  return toNumber(
    input.projectedROI ??
      input.projectedRoi ??
      input.roi ??
      input.roiData?.roi ??
      input.roiData?.projectedROI ??
      input.decisionData?.roi,
    null
  );
}

function extractProjectedProfit(input = {}) {
  return toNumber(
    input.projectedProfit ??
      input.estimatedProfit ??
      input.profit ??
      input.roiData?.estimatedProfit ??
      input.roiData?.projectedProfit ??
      input.decisionData?.estimatedProfit,
    null
  );
}

function buildPredictionSnapshot(input = {}) {
  const listingId = getListingId(input);
  const decision = normalizeDecision(extractDecision(input));

  return {
    source: SOURCE,
    listingId,
    title: input.title || input.listing?.title || '',
    decision,
    decisionScore: clamp(
      input.decisionScore ??
        input.score ??
        input.decisionData?.decisionScore ??
        input.decisionData?.score,
      0,
      100
    ),
    decisionConfidence: clamp(
      input.decisionConfidence ??
        input.confidence ??
        input.decisionData?.decisionConfidence ??
        input.decisionData?.confidence,
      0,
      100
    ),
    evidenceScore: clamp(
      input.evidenceScore ??
        input.evidenceStrength ??
        input.decisionData?.evidenceScore ??
        input.decisionData?.matrix?.evidenceStrength?.score,
      0,
      100
    ),
    opportunityScore: clamp(
      input.opportunityScore ??
        input.investmentQuality ??
        input.decisionData?.opportunityScore ??
        input.decisionData?.matrix?.investmentQuality?.score,
      0,
      100
    ),
    expectedValue: extractExpectedValue(input),
    expectedValueLow: extractExpectedValueLow(input),
    expectedValueHigh: extractExpectedValueHigh(input),
    listingCost: extractListingCost(input),
    projectedROI: extractProjectedRoi(input),
    projectedProfit: extractProjectedProfit(input),
    timestamp: input.timestamp || input.createdAt || nowIso(),
    raw: {
      decisionData: input.decisionData || null,
      compData: input.compData || null,
      marketData: input.marketData || null,
      roiData: input.roiData || null,
      riskData: input.riskData || null,
      marketIntelligenceData: input.marketIntelligenceData || null
    }
  };
}

function buildOutcomeSnapshot(outcome = {}) {
  return {
    outcomeType: normalizeOutcomeType(outcome.outcomeType || outcome.type),
    sold: Boolean(outcome.sold),
    disappeared: Boolean(outcome.disappeared),
    userBought: Boolean(outcome.userBought || outcome.bought),
    userPassed: Boolean(outcome.userPassed || outcome.passed),
    realizedSalePrice: toNumber(
      outcome.realizedSalePrice ?? outcome.salePrice ?? outcome.finalPrice,
      null
    ),
    realizedROI: toNumber(outcome.realizedROI ?? outcome.realizedRoi, null),
    realizedProfit: toNumber(outcome.realizedProfit ?? outcome.profit, null),
    outcomeAt: outcome.outcomeAt || outcome.timestamp || nowIso(),
    notes: outcome.notes || ''
  };
}

function isBuyDecision(decision) {
  return BUY_RECOMMENDATIONS.has(normalizeDecision(decision));
}

function isWatchDecision(decision) {
  return WATCH_RECOMMENDATIONS.has(normalizeDecision(decision));
}

function isPassDecision(decision) {
  return PASS_RECOMMENDATIONS.has(normalizeDecision(decision));
}

function hasRealizedFinancialOutcome(record = {}) {
  const outcome = record.outcome || {};
  return (
    Number.isFinite(outcome.realizedROI) ||
    Number.isFinite(outcome.realizedProfit) ||
    Number.isFinite(outcome.realizedSalePrice)
  );
}

function calculatePricingErrorPercent(record = {}) {
  const expectedValue = toNumber(record.expectedValue, null);
  const realizedSalePrice = toNumber(record.outcome?.realizedSalePrice, null);

  if (!expectedValue || expectedValue <= 0 || realizedSalePrice === null) {
    return null;
  }

  return Math.round(((realizedSalePrice - expectedValue) / expectedValue) * 10000) / 100;
}

function deriveDecisionAccuracy(record = {}) {
  const decision = normalizeDecision(record.decision);
  const outcome = record.outcome || {};
  const realizedProfit = toNumber(outcome.realizedProfit, null);
  const realizedROI = toNumber(outcome.realizedROI, null);
  const realizedSalePrice = toNumber(outcome.realizedSalePrice, null);
  const projectedProfit = toNumber(record.projectedProfit, null);
  const expectedValueLow = toNumber(record.expectedValueLow, null);
  const listingCost = toNumber(record.listingCost, null);

  const profitable =
    realizedProfit !== null
      ? realizedProfit > 0
      : realizedROI !== null
        ? realizedROI > 0
        : null;

  const soldAboveConservativeValue =
    realizedSalePrice !== null && expectedValueLow !== null
      ? realizedSalePrice >= expectedValueLow
      : null;

  const clearMissedOpportunity =
    isPassDecision(decision) &&
    (
      profitable === true ||
      soldAboveConservativeValue === true ||
      (
        realizedSalePrice !== null &&
        listingCost !== null &&
        realizedSalePrice > listingCost * 1.2
      )
    );

  const buySucceeded =
    isBuyDecision(decision) &&
    (
      profitable === true ||
      soldAboveConservativeValue === true
    );

  const buyFailed =
    isBuyDecision(decision) &&
    (
      profitable === false ||
      soldAboveConservativeValue === false
    );

  const watchConverted =
    isWatchDecision(decision) &&
    (
      outcome.userBought ||
      profitable === true ||
      soldAboveConservativeValue === true
    );

  let decisionWasCorrect = null;

  if (isBuyDecision(decision)) {
    if (buySucceeded) decisionWasCorrect = true;
    if (buyFailed) decisionWasCorrect = false;
  } else if (isWatchDecision(decision)) {
    if (watchConverted) decisionWasCorrect = true;
    if (profitable === false && outcome.userBought) decisionWasCorrect = false;
  } else if (isPassDecision(decision)) {
    if (clearMissedOpportunity) decisionWasCorrect = false;
    if (
      profitable === false ||
      outcome.userPassed ||
      outcome.disappeared ||
      outcome.outcomeType === 'disappeared'
    ) {
      decisionWasCorrect = true;
    }
  }

  return {
    wasBuyRecommendation: isBuyDecision(decision),
    wasWatchRecommendation: isWatchDecision(decision),
    wasPassRecommendation: isPassDecision(decision),
    wasProfitable: profitable,
    wasFalsePositive: buyFailed || false,
    wasFalseNegative: clearMissedOpportunity || false,
    watchConverted: watchConverted || false,
    pricingErrorPercent: calculatePricingErrorPercent(record),
    decisionWasCorrect,
    projectedProfitWasPositive:
      projectedProfit === null ? null : projectedProfit > 0,
    outcomeKnown: hasRealizedFinancialOutcome(record) || Boolean(outcome.outcomeType)
  };
}

function attachDerivedMetrics(record) {
  const derived = deriveDecisionAccuracy(record);
  record.derived = derived;
  return record;
}

function recordDecision(input = {}) {
  const snapshot = buildPredictionSnapshot(input);

  if (!snapshot.listingId) {
    return {
      ok: false,
      source: SOURCE,
      status: 'missing_listing_id',
      warning: 'Decision validation record was not saved because listing ID was missing.'
    };
  }

  const existing = recordsById.get(snapshot.listingId);

  const record = existing || {
    source: SOURCE,
    listingId: snapshot.listingId,
    firstRecordedAt: snapshot.timestamp,
    decisionSnapshots: [],
    outcomeHistory: []
  };

  Object.assign(record, snapshot, {
    lastRecordedAt: snapshot.timestamp
  });

  record.decisionSnapshots.push(snapshot);

  recordsById.set(snapshot.listingId, attachDerivedMetrics(record));
  decisionHistory.push(snapshot);

  return {
    ok: true,
    source: SOURCE,
    status: existing ? 'decision_updated' : 'decision_recorded',
    listingId: snapshot.listingId,
    record: recordsById.get(snapshot.listingId)
  };
}

function recordRecommendation(input = {}) {
  return recordDecision(input);
}

function recordFinalRecommendation(input = {}) {
  return recordDecision(input);
}

function recordOutcome(listingId, outcome = {}) {
  const id = getListingId({ listingId }) || getListingId(outcome);

  if (!id) {
    return {
      ok: false,
      source: SOURCE,
      status: 'missing_listing_id',
      warning: 'Outcome was not saved because listing ID was missing.'
    };
  }

  const record = recordsById.get(id);

  if (!record) {
    return {
      ok: false,
      source: SOURCE,
      status: 'decision_record_not_found',
      listingId: id,
      warning: 'Outcome was received before a decision validation record existed.'
    };
  }

  const outcomeSnapshot = buildOutcomeSnapshot(outcome);

  record.outcome = outcomeSnapshot;
  record.outcomeHistory.push(outcomeSnapshot);
  record.lastOutcomeAt = outcomeSnapshot.outcomeAt;

  outcomeHistory.push({
    listingId: id,
    ...outcomeSnapshot
  });

  recordsById.set(id, attachDerivedMetrics(record));

  return {
    ok: true,
    source: SOURCE,
    status: 'outcome_recorded',
    listingId: id,
    record: recordsById.get(id)
  };
}

function recordDecisionOutcome(listingId, outcome = {}) {
  return recordOutcome(listingId, outcome);
}

function getDecisionRecord(listingId) {
  if (!listingId) return null;
  return recordsById.get(String(listingId)) || recordsById.get(listingId) || null;
}

function getRecentDecisions(limit = 50) {
  const safeLimit = clamp(limit, 1, 500);
  return decisionHistory.slice(-safeLimit).reverse();
}

function average(values = []) {
  const usable = values.filter((value) => Number.isFinite(value));
  if (!usable.length) return null;
  return Math.round((usable.reduce((sum, value) => sum + value, 0) / usable.length) * 100) / 100;
}

function percent(part, total) {
  if (!total) return null;
  return Math.round((part / total) * 10000) / 100;
}

function groupByDecision(records = []) {
  return records.reduce((acc, record) => {
    const decision = normalizeDecision(record.decision);
    if (!acc[decision]) acc[decision] = [];
    acc[decision].push(record);
    return acc;
  }, {});
}

function summarizeGroup(records = []) {
  const knownAccuracy = records.filter((record) => record.derived?.decisionWasCorrect !== null);
  const correct = knownAccuracy.filter((record) => record.derived?.decisionWasCorrect === true).length;

  return {
    count: records.length,
    knownOutcomeCount: knownAccuracy.length,
    accuracy: percent(correct, knownAccuracy.length),
    averageProjectedROI: average(records.map((record) => toNumber(record.projectedROI, null))),
    averageRealizedROI: average(records.map((record) => toNumber(record.outcome?.realizedROI, null))),
    averageProjectedProfit: average(records.map((record) => toNumber(record.projectedProfit, null))),
    averageRealizedProfit: average(records.map((record) => toNumber(record.outcome?.realizedProfit, null))),
    averagePricingError: average(records.map((record) => record.derived?.pricingErrorPercent))
  };
}

function summarizeDecisionValidation() {
  const records = Array.from(recordsById.values()).map(attachDerivedMetrics);
  const byDecision = groupByDecision(records);

  const buyRecords = records.filter((record) => record.derived?.wasBuyRecommendation);
  const watchRecords = records.filter((record) => record.derived?.wasWatchRecommendation);
  const passRecords = records.filter((record) => record.derived?.wasPassRecommendation);

  const buyKnown = buyRecords.filter((record) => record.derived?.decisionWasCorrect !== null);
  const buyCorrect = buyKnown.filter((record) => record.derived?.decisionWasCorrect === true).length;

  const watchConverted = watchRecords.filter((record) => record.derived?.watchConverted).length;
  const passFalseNegatives = passRecords.filter((record) => record.derived?.wasFalseNegative).length;

  const decisionAccuracyByRecommendation = {};
  Object.keys(byDecision).forEach((decision) => {
    decisionAccuracyByRecommendation[decision] = summarizeGroup(byDecision[decision]);
  });

  return {
    source: SOURCE,
    totalDecisionRecords: records.length,
    totalOutcomeRecords: outcomeHistory.length,
    buyNowAccuracy: percent(buyCorrect, buyKnown.length),
    watchConversionRate: percent(watchConverted, watchRecords.length),
    passFalseNegativeRate: percent(passFalseNegatives, passRecords.length),
    averageProjectedROI: average(records.map((record) => toNumber(record.projectedROI, null))),
    averageRealizedROI: average(records.map((record) => toNumber(record.outcome?.realizedROI, null))),
    averageProjectedProfit: average(records.map((record) => toNumber(record.projectedProfit, null))),
    averageRealizedProfit: average(records.map((record) => toNumber(record.outcome?.realizedProfit, null))),
    averagePricingError: average(records.map((record) => record.derived?.pricingErrorPercent)),
    decisionAccuracyByRecommendation,
    recommendationCounts: {
      BUY_NOW: byDecision.BUY_NOW?.length || 0,
      STRONG_WATCH: byDecision.STRONG_WATCH?.length || 0,
      WATCH: byDecision.WATCH?.length || 0,
      MONITOR: byDecision.MONITOR?.length || 0,
      PASS: byDecision.PASS?.length || 0
    },
    summary: buildSummary(records, {
      buyNowAccuracy: percent(buyCorrect, buyKnown.length),
      watchConversionRate: percent(watchConverted, watchRecords.length),
      passFalseNegativeRate: percent(passFalseNegatives, passRecords.length)
    })
  };
}

function buildSummary(records = [], stats = {}) {
  if (!records.length) {
    return 'Decision validation has not recorded any recommendations yet.';
  }

  const parts = [`Tracked ${records.length} final recommendation${records.length === 1 ? '' : 's'}.`];

  if (stats.buyNowAccuracy !== null) {
    parts.push(`BUY_NOW accuracy is ${stats.buyNowAccuracy}%.`);
  } else {
    parts.push('BUY_NOW accuracy is not known yet because realized outcomes are still missing.');
  }

  if (stats.watchConversionRate !== null) {
    parts.push(`WATCH-family conversion rate is ${stats.watchConversionRate}%.`);
  }

  if (stats.passFalseNegativeRate !== null) {
    parts.push(`PASS false-negative rate is ${stats.passFalseNegativeRate}%.`);
  }

  return parts.join(' ');
}

function resetDecisionValidation() {
  recordsById.clear();
  decisionHistory.length = 0;
  outcomeHistory.length = 0;

  return {
    ok: true,
    source: SOURCE,
    status: 'reset'
  };
}

module.exports = {
  recordDecision,
  recordRecommendation,
  recordFinalRecommendation,
  recordOutcome,
  recordDecisionOutcome,
  summarizeDecisionValidation,
  getDecisionRecord,
  getRecentDecisions,
  resetDecisionValidation
};
