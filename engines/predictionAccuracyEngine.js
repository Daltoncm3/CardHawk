'use strict';

const path = require('path');
const stateStore = require('../utils/stateStore');

const SOURCE = 'prediction_accuracy_engine';
const STATE_VERSION = 1;
const STATE_FILE = path.join(__dirname, '..', 'data', 'predictionAccuracy.json');

const recordsByPredictionId = new Map();
const recordsByListingId = new Map();
const predictionHistory = [];
const outcomeHistory = [];

const RECOMMENDATIONS = ['BUY_NOW', 'STRONG_WATCH', 'WATCH', 'MONITOR', 'PASS'];

function nowIso() {
  return new Date().toISOString();
}

function createEmptyState() {
  return {
    version: STATE_VERSION,
    savedAt: null,
    predictionHistory: [],
    outcomeHistory: []
  };
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function toNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function round(value, digits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const factor = 10 ** digits;
  return Math.round(number * factor) / factor;
}

function percent(part, total) {
  if (!total) return null;
  return round((part / total) * 100, 2);
}

function average(values = []) {
  const usable = asArray(values).map((value) => toNumber(value, null)).filter((value) => value !== null);
  if (!usable.length) return null;
  return round(usable.reduce((sum, value) => sum + value, 0) / usable.length, 2);
}

function normalizeText(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  return String(value).trim();
}

function normalizeRecommendation(value) {
  const recommendation = normalizeText(value).toUpperCase();

  if (recommendation === 'REJECT' || recommendation === 'AVOID' || recommendation === 'DO_NOT_BUY') {
    return 'PASS';
  }

  if (recommendation === 'BUY' || recommendation === 'BUY_NOW_ALLOWED') {
    return 'BUY_NOW';
  }

  return RECOMMENDATIONS.includes(recommendation) ? recommendation : 'MONITOR';
}

function normalizeOutcomeType(value) {
  const outcomeType = normalizeText(value || 'unknown').toLowerCase();

  if (outcomeType === 'sold') return 'sold';
  if (outcomeType === 'disappeared') return 'disappeared';
  if (outcomeType === 'stale') return 'stale';
  if (outcomeType === 'price_dropped' || outcomeType === 'price_drop') return 'price_dropped';
  if (outcomeType === 'user_bought' || outcomeType === 'bought') return 'user_bought';
  if (outcomeType === 'user_passed' || outcomeType === 'passed') return 'user_passed';

  return 'unknown';
}

function getListingId(input = {}) {
  return (
    input.listingId ||
    input.ebayItemId ||
    input.itemId ||
    input.id ||
    input.listing?.listingId ||
    input.listing?.ebayItemId ||
    input.listing?.itemId ||
    input.listing?.id ||
    ''
  );
}

function getPredictionId(input = {}) {
  return (
    input.predictionId ||
    input.id ||
    input.prediction?.predictionId ||
    input.prediction?.id ||
    `${getListingId(input) || 'unknown'}-${input.createdAt || nowIso()}`
  );
}

function getLane(input = {}) {
  return normalizeText(
    input.lane ||
      input.sport ||
      input.category ||
      input.listing?.lane ||
      input.listing?.sport ||
      input.parsed?.sport ||
      input.parsed?.category ||
      input.decisionData?.lane,
    'unknown'
  ).toLowerCase() || 'unknown';
}

function getGradingCompany(input = {}) {
  return normalizeText(
    input.gradingCompany ||
      input.grader ||
      input.gradeCompany ||
      input.listing?.gradingCompany ||
      input.listing?.grader ||
      input.parsed?.gradingCompany ||
      input.parsed?.grader ||
      input.parsed?.grading?.company,
    'unknown'
  ).toUpperCase() || 'UNKNOWN';
}

function getPriceRange(value) {
  const price = toNumber(value, null);

  if (price === null || price < 0) return 'unknown';
  if (price < 25) return 'under_25';
  if (price < 50) return '25_49';
  if (price < 100) return '50_99';
  if (price < 250) return '100_249';
  if (price < 500) return '250_499';
  if (price < 1000) return '500_999';
  return '1000_plus';
}

function getConfidenceBucket(confidence) {
  const value = toNumber(confidence, null);

  if (value === null) return 'unknown';
  if (value < 40) return '0_39';
  if (value < 55) return '40_54';
  if (value < 70) return '55_69';
  if (value < 85) return '70_84';
  return '85_100';
}

function getExpectedValue(input = {}) {
  return toNumber(
    input.expectedValue ??
      input.marketValue ??
      input.estimatedValue ??
      input.valueData?.expectedValue ??
      input.marketData?.expectedValue ??
      input.marketData?.marketValue,
    null
  );
}

function getExpectedValueLow(input = {}) {
  return toNumber(
    input.expectedValueLow ??
      input.valueData?.expectedValueLow ??
      input.marketData?.expectedValueLow,
    null
  );
}

function getExpectedValueHigh(input = {}) {
  return toNumber(
    input.expectedValueHigh ??
      input.valueData?.expectedValueHigh ??
      input.marketData?.expectedValueHigh,
    null
  );
}

function getSalesVelocityScore(input = {}) {
  return toNumber(
    input.salesVelocityScore ??
      input.salesVelocityData?.salesVelocityScore ??
      input.scoring?.salesVelocityData?.salesVelocityScore,
    null
  );
}

function getLiquidityRating(input = {}) {
  return normalizeText(
    input.liquidityRating ||
      input.salesVelocityData?.liquidityRating ||
      input.scoring?.salesVelocityData?.liquidityRating,
    ''
  ).toLowerCase();
}

function buildPrediction(input = {}) {
  const listingId = getListingId(input);
  const createdAt = input.createdAt || input.timestamp || nowIso();
  const expectedValue = getExpectedValue(input);

  return {
    source: SOURCE,
    predictionId: getPredictionId({ ...input, createdAt }),
    listingId,
    title: normalizeText(input.title || input.listing?.title),
    recommendation: normalizeRecommendation(
      input.recommendation ||
        input.decision ||
        input.finalRecommendation ||
        input.decisionData?.recommendation ||
        input.decisionData?.decision
    ),
    decisionScore: toNumber(input.decisionScore ?? input.score ?? input.decisionData?.decisionScore ?? input.decisionData?.score, null),
    decisionConfidence: toNumber(input.decisionConfidence ?? input.confidence ?? input.decisionData?.decisionConfidence ?? input.decisionData?.confidence, null),
    projectedROI: toNumber(input.projectedROI ?? input.projectedRoi ?? input.roi ?? input.roiData?.roi, null),
    projectedProfit: toNumber(input.projectedProfit ?? input.estimatedProfit ?? input.profit ?? input.roiData?.estimatedProfit, null),
    expectedValue,
    expectedValueLow: getExpectedValueLow(input),
    expectedValueHigh: getExpectedValueHigh(input),
    salesVelocityScore: getSalesVelocityScore(input),
    liquidityRating: getLiquidityRating(input),
    lane: getLane(input),
    gradingCompany: getGradingCompany(input),
    priceRange: getPriceRange(input.listingCost ?? input.totalCost ?? input.price ?? input.listing?.totalCost ?? input.listing?.price ?? expectedValue),
    createdAt,
    outcomes: [],
    latestOutcome: null,
    derived: {
      confidenceBucket: getConfidenceBucket(input.decisionConfidence ?? input.confidence ?? input.decisionData?.confidence)
    }
  };
}

function buildOutcome(outcome = {}) {
  const outcomeType = normalizeOutcomeType(outcome.outcomeType || outcome.type);

  return {
    outcomeType,
    outcomeAt: outcome.outcomeAt || outcome.timestamp || nowIso(),
    finalPrice: toNumber(outcome.finalPrice ?? outcome.currentPrice ?? outcome.price, null),
    realizedSalePrice: toNumber(outcome.realizedSalePrice ?? outcome.salePrice, null),
    realizedProfit: toNumber(outcome.realizedProfit ?? outcome.profit, null),
    realizedROI: toNumber(outcome.realizedROI ?? outcome.realizedRoi, null),
    userBought: Boolean(outcome.userBought || outcome.bought || outcomeType === 'user_bought'),
    userPassed: Boolean(outcome.userPassed || outcome.passed || outcomeType === 'user_passed'),
    disappeared: Boolean(outcome.disappeared || outcomeType === 'disappeared'),
    stale: Boolean(outcome.stale || outcomeType === 'stale'),
    priceDropped: Boolean(outcome.priceDropped || outcome.price_dropped || outcomeType === 'price_dropped'),
    notes: normalizeText(outcome.notes)
  };
}

function pricingErrorPercent(record = {}) {
  const expectedValue = toNumber(record.expectedValue, null);
  const realizedSalePrice = toNumber(record.latestOutcome?.realizedSalePrice, null);

  if (!expectedValue || expectedValue <= 0 || realizedSalePrice === null) return null;

  return round(((realizedSalePrice - expectedValue) / expectedValue) * 100, 2);
}

function deriveRecord(record = {}) {
  const recommendation = normalizeRecommendation(record.recommendation);
  const outcome = asObject(record.latestOutcome);
  const realizedProfit = toNumber(outcome.realizedProfit, null);
  const realizedROI = toNumber(outcome.realizedROI, null);
  const realizedSalePrice = toNumber(outcome.realizedSalePrice, null);
  const expectedValueLow = toNumber(record.expectedValueLow, null);
  const expectedValue = toNumber(record.expectedValue, null);

  const wasBuyRecommendation = recommendation === 'BUY_NOW';
  const wasWatchRecommendation = recommendation === 'STRONG_WATCH' || recommendation === 'WATCH' || recommendation === 'MONITOR';
  const wasPassRecommendation = recommendation === 'PASS';

  const profitable =
    realizedProfit !== null
      ? realizedProfit > 0
      : realizedROI !== null
        ? realizedROI > 0
        : null;

  const priceMetExpectation =
    realizedSalePrice !== null && expectedValueLow !== null
      ? realizedSalePrice >= expectedValueLow
      : realizedSalePrice !== null && expectedValue !== null
        ? realizedSalePrice >= expectedValue * 0.9
        : null;

  const buySucceeded =
    wasBuyRecommendation &&
    (profitable === true || priceMetExpectation === true || outcome.userBought === true);

  const buyFailed =
    wasBuyRecommendation &&
    (profitable === false || priceMetExpectation === false);

  const watchConverted =
    wasWatchRecommendation &&
    (outcome.userBought === true || profitable === true || priceMetExpectation === true);

  const passFalseNegative =
    wasPassRecommendation &&
    (profitable === true || priceMetExpectation === true);

  let decisionWasCorrect = null;

  if (wasBuyRecommendation) {
    if (buySucceeded) decisionWasCorrect = true;
    if (buyFailed) decisionWasCorrect = false;
  } else if (wasWatchRecommendation) {
    if (watchConverted) decisionWasCorrect = true;
    if (outcome.userBought && profitable === false) decisionWasCorrect = false;
  } else if (wasPassRecommendation) {
    if (passFalseNegative) decisionWasCorrect = false;
    if (outcome.userPassed || outcome.disappeared || outcome.stale || profitable === false) decisionWasCorrect = true;
  }

  return {
    confidenceBucket: getConfidenceBucket(record.decisionConfidence),
    wasBuyRecommendation,
    wasWatchRecommendation,
    wasPassRecommendation,
    wasProfitable: profitable,
    wasFalsePositive: Boolean(buyFailed),
    wasFalseNegative: Boolean(passFalseNegative),
    watchConverted: Boolean(watchConverted),
    pricingErrorPercent: pricingErrorPercent(record),
    decisionWasCorrect,
    outcomeKnown: Boolean(record.latestOutcome)
  };
}

function attachDerived(record) {
  record.derived = deriveRecord(record);
  return record;
}

function indexPrediction(prediction) {
  if (!prediction || !prediction.predictionId) return;

  recordsByPredictionId.set(prediction.predictionId, prediction);

  if (!prediction.listingId) return;

  if (!recordsByListingId.has(prediction.listingId)) {
    recordsByListingId.set(prediction.listingId, []);
  }

  recordsByListingId.get(prediction.listingId).push(prediction.predictionId);
}

function restoreState(state = {}) {
  recordsByPredictionId.clear();
  recordsByListingId.clear();
  predictionHistory.length = 0;
  outcomeHistory.length = 0;

  for (const prediction of asArray(state.predictionHistory)) {
    if (!prediction || typeof prediction !== 'object') continue;

    prediction.outcomes = asArray(prediction.outcomes);
    prediction.latestOutcome = prediction.latestOutcome || null;
    attachDerived(prediction);
    predictionHistory.push(prediction);
    indexPrediction(prediction);
  }

  for (const outcome of asArray(state.outcomeHistory)) {
    if (outcome && typeof outcome === 'object') {
      outcomeHistory.push(outcome);
    }
  }
}

function getPersistableState() {
  return {
    version: STATE_VERSION,
    savedAt: nowIso(),
    predictionHistory,
    outcomeHistory
  };
}

function persistState() {
  try {
    stateStore.saveJsonState(STATE_FILE, getPersistableState());
  } catch (error) {
    console.warn('Prediction Accuracy Engine failed to persist state:', error.message);
  }
}

function loadPersistedState() {
  const state = stateStore.loadJsonState(STATE_FILE, createEmptyState());
  restoreState(state);
}

function recordPrediction(input = {}) {
  const prediction = buildPrediction(input);

  if (!prediction.listingId && !prediction.predictionId) {
    return {
      ok: false,
      source: SOURCE,
      status: 'missing_identifier'
    };
  }

  indexPrediction(prediction);
  predictionHistory.push(prediction);
  persistState();

  return {
    ok: true,
    source: SOURCE,
    status: 'prediction_recorded',
    predictionId: prediction.predictionId,
    listingId: prediction.listingId,
    record: prediction
  };
}

function findRecord(identifier) {
  if (!identifier) return null;

  const id = String(identifier);

  if (recordsByPredictionId.has(id)) {
    return recordsByPredictionId.get(id);
  }

  const listingPredictionIds = recordsByListingId.get(id);
  if (listingPredictionIds && listingPredictionIds.length) {
    const latestPredictionId = listingPredictionIds[listingPredictionIds.length - 1];
    return recordsByPredictionId.get(latestPredictionId) || null;
  }

  return null;
}

function recordOutcome(identifier, outcome = {}) {
  const record = findRecord(identifier || outcome.predictionId || outcome.listingId || outcome.ebayItemId);

  if (!record) {
    return {
      ok: false,
      source: SOURCE,
      status: 'prediction_not_found',
      identifier: identifier || outcome.predictionId || outcome.listingId || outcome.ebayItemId || null
    };
  }

  const normalizedOutcome = buildOutcome(outcome);

  record.outcomes.push(normalizedOutcome);
  record.latestOutcome = normalizedOutcome;
  attachDerived(record);

  outcomeHistory.push({
    predictionId: record.predictionId,
    listingId: record.listingId,
    ...normalizedOutcome
  });
  persistState();

  return {
    ok: true,
    source: SOURCE,
    status: 'outcome_recorded',
    predictionId: record.predictionId,
    listingId: record.listingId,
    record
  };
}

function getPrediction(identifier) {
  return findRecord(identifier);
}

function getRecentPredictions(limit = 50) {
  const safeLimit = Math.max(1, Math.min(500, toNumber(limit, 50)));
  return predictionHistory.slice(-safeLimit).reverse();
}

function getRecordsWithOutcomes() {
  return Array.from(recordsByPredictionId.values())
    .filter((record) => record.latestOutcome)
    .map(attachDerived);
}

function summarizeGroup(records = []) {
  const known = records.filter((record) => record.derived?.decisionWasCorrect !== null && record.derived?.decisionWasCorrect !== undefined);
  const correct = known.filter((record) => record.derived?.decisionWasCorrect === true).length;

  return {
    count: records.length,
    outcomeCount: known.length,
    accuracy: percent(correct, known.length),
    averageProjectedROI: average(records.map((record) => record.projectedROI)),
    averageRealizedROI: average(records.map((record) => record.latestOutcome?.realizedROI)),
    averageProjectedProfit: average(records.map((record) => record.projectedProfit)),
    averageRealizedProfit: average(records.map((record) => record.latestOutcome?.realizedProfit)),
    averagePricingError: average(records.map((record) => record.derived?.pricingErrorPercent))
  };
}

function groupBy(records = [], keyFn) {
  return records.reduce((groups, record) => {
    const key = normalizeText(keyFn(record), 'unknown') || 'unknown';
    if (!groups[key]) groups[key] = [];
    groups[key].push(record);
    return groups;
  }, {});
}

function summarizeGroups(records = [], keyFn) {
  const grouped = groupBy(records, keyFn);
  const output = {};

  Object.keys(grouped).sort().forEach((key) => {
    output[key] = summarizeGroup(grouped[key]);
  });

  return output;
}

function summarizeConfidenceCalibration(records = []) {
  const grouped = groupBy(records, (record) => record.derived?.confidenceBucket || getConfidenceBucket(record.decisionConfidence));
  const output = {};

  Object.keys(grouped).sort().forEach((bucket) => {
    const bucketRecords = grouped[bucket];
    const known = bucketRecords.filter((record) => record.derived?.decisionWasCorrect !== null && record.derived?.decisionWasCorrect !== undefined);
    const correct = known.filter((record) => record.derived?.decisionWasCorrect === true).length;

    output[bucket] = {
      count: bucketRecords.length,
      outcomeCount: known.length,
      accuracy: percent(correct, known.length),
      averageConfidence: average(bucketRecords.map((record) => record.decisionConfidence)),
      averagePricingError: average(bucketRecords.map((record) => record.derived?.pricingErrorPercent))
    };
  });

  return output;
}

function summarizePredictionAccuracy() {
  const allRecords = Array.from(recordsByPredictionId.values()).map(attachDerived);
  const outcomeRecords = getRecordsWithOutcomes();

  const buyRecords = outcomeRecords.filter((record) => record.derived.wasBuyRecommendation);
  const watchRecords = outcomeRecords.filter((record) => record.derived.wasWatchRecommendation);
  const passRecords = outcomeRecords.filter((record) => record.derived.wasPassRecommendation);

  const buyKnown = buyRecords.filter((record) => record.derived.decisionWasCorrect !== null);
  const buyCorrect = buyKnown.filter((record) => record.derived.decisionWasCorrect === true).length;
  const watchConverted = watchRecords.filter((record) => record.derived.watchConverted).length;
  const passFalseNegative = passRecords.filter((record) => record.derived.wasFalseNegative).length;

  return {
    source: SOURCE,
    generatedAt: nowIso(),
    totalPredictions: allRecords.length,
    totalOutcomes: outcomeHistory.length,
    predictionsAwaitingOutcome: allRecords.filter((record) => !record.latestOutcome).length,
    accuracyByRecommendationType: summarizeGroups(outcomeRecords, (record) => record.recommendation),
    buyNowSuccessRate: percent(buyCorrect, buyKnown.length),
    watchConversionRate: percent(watchConverted, watchRecords.length),
    passFalseNegativeRate: percent(passFalseNegative, passRecords.length),
    averageProjectedROI: average(allRecords.map((record) => record.projectedROI)),
    averageRealizedROI: average(outcomeRecords.map((record) => record.latestOutcome?.realizedROI)),
    averageProjectedProfit: average(allRecords.map((record) => record.projectedProfit)),
    averageRealizedProfit: average(outcomeRecords.map((record) => record.latestOutcome?.realizedProfit)),
    averagePricingError: average(outcomeRecords.map((record) => record.derived?.pricingErrorPercent)),
    confidenceCalibrationBuckets: summarizeConfidenceCalibration(outcomeRecords),
    performanceBySportLane: summarizeGroups(outcomeRecords, (record) => record.lane),
    performanceByGradingCompany: summarizeGroups(outcomeRecords, (record) => record.gradingCompany),
    performanceByPriceRange: summarizeGroups(outcomeRecords, (record) => record.priceRange),
    summary: buildSummary(allRecords, outcomeRecords)
  };
}

function buildSummary(allRecords = [], outcomeRecords = []) {
  if (!allRecords.length) {
    return 'Prediction Accuracy Engine has not recorded any predictions yet.';
  }

  if (!outcomeRecords.length) {
    return `Prediction Accuracy Engine is tracking ${allRecords.length} prediction${allRecords.length === 1 ? '' : 's'}, but no realized outcomes have been recorded yet.`;
  }

  const summary = summarizeGroup(outcomeRecords);
  const accuracyText = summary.accuracy === null ? 'unknown' : `${summary.accuracy}%`;

  return `Prediction Accuracy Engine has ${outcomeRecords.length} outcome-backed prediction${outcomeRecords.length === 1 ? '' : 's'} with ${accuracyText} known recommendation accuracy.`;
}

function resetPredictionAccuracy() {
  recordsByPredictionId.clear();
  recordsByListingId.clear();
  predictionHistory.length = 0;
  outcomeHistory.length = 0;
  persistState();

  return {
    ok: true,
    source: SOURCE,
    status: 'reset'
  };
}

module.exports = {
  recordPrediction,
  recordOutcome,
  getPrediction,
  getRecentPredictions,
  summarizePredictionAccuracy,
  resetPredictionAccuracy,

  summarizeGroup,
  summarizeGroups,
  normalizeRecommendation
};

loadPersistedState();
