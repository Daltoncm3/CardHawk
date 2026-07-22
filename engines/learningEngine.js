'use strict';

const {
  pruneMapByOldest,
  toPositiveInteger,
  trimArrayToMax
} = require('../utils/boundedRetention');
const serializationInstrumentation = require('../utils/serializationInstrumentation');

const learningState = {
  recordsByEbayItemId: new Map(),
  predictionEvents: [],
  scanEvents: []
};

const DEFAULT_MAX_HISTORY_LENGTH = 100;
const DEFAULT_MAX_RECENT_EVENTS = 1000;
const DEFAULT_MAX_TRACKED_LEARNING_RECORDS = 5000;
const DEFAULT_STALE_AFTER_MS = 1000 * 60 * 60 * 24 * 7;

function nowIso() {
  return new Date().toISOString();
}

function getRetentionPolicy() {
  return {
    maxTrackedLearningRecords: toPositiveInteger(
      process.env.CARDHAWK_MAX_TRACKED_LEARNING_RECORDS,
      DEFAULT_MAX_TRACKED_LEARNING_RECORDS
    ),
    maxHistoryLength: toPositiveInteger(
      process.env.CARDHAWK_MAX_LEARNING_HISTORY_LENGTH,
      DEFAULT_MAX_HISTORY_LENGTH
    ),
    maxRecentEvents: toPositiveInteger(
      process.env.CARDHAWK_MAX_LEARNING_RECENT_EVENTS,
      DEFAULT_MAX_RECENT_EVENTS
    )
  };
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeString(value, fallback = '') {
  if (value === undefined || value === null) return fallback;
  return String(value).trim();
}

function normalizeId(value) {
  return normalizeString(value);
}

function pickFirstValue(sources, keys, fallback = undefined) {
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;

    for (const key of keys) {
      if (source[key] !== undefined && source[key] !== null && source[key] !== '') {
        return source[key];
      }
    }
  }

  return fallback;
}

function pickFirstNumber(sources, keys, fallback = 0) {
  const value = pickFirstValue(sources, keys, undefined);
  return value === undefined ? fallback : toNumber(value, fallback);
}

function clonePlain(value) {
  if (!value || typeof value !== 'object') return value;

  try {
    return serializationInstrumentation.instrumentJsonClone(value, {
      sourceFile: 'engines/learningEngine.js',
      functionName: 'clonePlain',
      serializationType: 'json_clone_stringify',
      group: 'Learning'
    });
  } catch (error) {
    return {};
  }
}

function createPredictionId(ebayItemId, observedAt) {
  return `${normalizeId(ebayItemId) || 'unknown'}:${new Date(observedAt).getTime() || Date.now()}:${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function extractListing(input = {}) {
  return input.listing || input.item || input.rawListing || input;
}

function extractParsed(input = {}, listing = {}) {
  return input.parsed || input.parsedCard || input.card || listing.parsed || {};
}

function extractScoring(input = {}) {
  return input.scoring || input.scoreData || input.analysis || input.evaluation || input.decisionData || {};
}

function getEbayItemId(input = {}, listing = {}) {
  return normalizeId(
    pickFirstValue(
      [input, listing],
      ['ebayItemId', 'itemId', 'listingId', 'id', 'ebayId'],
      ''
    )
  );
}

function getDecision(input = {}, scoring = {}) {
  return normalizeString(
    pickFirstValue(
      [input, scoring, input.decisionData],
      ['decision', 'recommendation', 'action', 'buyDecision'],
      ''
    )
  ).toLowerCase();
}

function classifyDecision(decision) {
  const value = normalizeString(decision).toLowerCase();

  if (!value) return 'unknown';
  if (value.includes('buy') || value.includes('buy_now') || value === 'strong_buy') return 'buy';
  if (value.includes('watch') || value.includes('review') || value.includes('hold') || value.includes('monitor')) return 'watch';
  if (
    value.includes('pass') ||
    value.includes('avoid') ||
    value.includes('do_not') ||
    value.includes('do not') ||
    value.includes('reject')
  ) {
    return 'pass';
  }

  return 'unknown';
}

function getConfidenceBucket(confidence) {
  const value = toNumber(confidence, NaN);

  if (!Number.isFinite(value) || value <= 0) return 'unknown';
  if (value < 50) return '0-49';
  if (value < 60) return '50-59';
  if (value < 70) return '60-69';
  if (value < 80) return '70-79';
  if (value < 90) return '80-89';
  return '90-100';
}

function getMarketConfidence(input = {}, scoring = {}) {
  return pickFirstNumber(
    [input, scoring, scoring.confidence, scoring.market, input.confidenceData],
    ['marketConfidence', 'confidenceScore', 'confidence', 'marketConfidenceScore'],
    0
  );
}

function getMarketIntelligenceScore(input = {}, scoring = {}) {
  return pickFirstNumber(
    [input, scoring, scoring.marketIntelligence, scoring.intelligence, input.marketIntelligenceData],
    ['marketIntelligenceScore', 'intelligenceScore', 'marketScore'],
    0
  );
}

function getDecisionConfidence(input = {}, scoring = {}) {
  return pickFirstNumber(
    [input, scoring, input.decisionData],
    ['decisionConfidence', 'confidence', 'confidenceScore'],
    0
  );
}

function getSnapshot(input = {}) {
  const listing = extractListing(input);
  const parsed = extractParsed(input, listing);
  const scoring = extractScoring(input);
  const roiData = input.roiData || scoring.roiData || scoring.roi || {};
  const decision = getDecision(input, scoring);

  return {
    ebayItemId: getEbayItemId(input, listing),
    title: normalizeString(pickFirstValue([input, listing], ['title', 'name'], '')),
    player: normalizeString(pickFirstValue([parsed, input], ['player', 'playerName'], '')),
    year: normalizeString(pickFirstValue([parsed, input], ['year'], '')),
    set: normalizeString(pickFirstValue([parsed, input], ['set', 'cardSet', 'series'], '')),
    grade: normalizeString(pickFirstValue([parsed, input], ['grade', 'conditionGrade'], '')),
    price: pickFirstNumber([input, listing], ['price', 'currentPrice', 'askingPrice', 'listPrice'], 0),
    score: pickFirstNumber([input, scoring], ['score', 'dealScore', 'overallScore'], 0),
    estimatedValue: pickFirstNumber(
      [input, scoring, roiData, input.marketData, input.compData],
      ['estimatedValue', 'marketValue', 'estimatedSalePrice', 'targetSalePrice'],
      0
    ),
    estimatedProfit: pickFirstNumber(
      [input, scoring, roiData],
      ['estimatedProfit', 'profit', 'netProfit', 'projectedProfit'],
      0
    ),
    roi: pickFirstNumber([input, scoring, roiData], ['roi', 'roiPercent', 'returnOnInvestment'], 0),
    marketConfidence: getMarketConfidence(input, scoring),
    marketIntelligenceScore: getMarketIntelligenceScore(input, scoring),
    decisionConfidence: getDecisionConfidence(input, scoring),
    riskLevel: normalizeString(pickFirstValue([input, scoring, input.riskData], ['riskLevel', 'risk'], 'unknown')).toLowerCase(),
    decision,
    dealGrade: normalizeString(pickFirstValue([input, scoring], ['dealGrade', 'grade'], ''))
  };
}

function buildPredictionSnapshot(input = {}, snapshot = {}, observedAt = nowIso()) {
  const predictionId = normalizeString(input.predictionId, createPredictionId(snapshot.ebayItemId, observedAt));

  return {
    predictionId,
    createdAt: observedAt,
    ebayItemId: snapshot.ebayItemId,
    title: snapshot.title,
    originalRecommendation: snapshot.decision,
    decisionConfidence: snapshot.decisionConfidence,
    score: snapshot.score,
    estimatedValue: snapshot.estimatedValue,
    estimatedProfit: snapshot.estimatedProfit,
    roi: snapshot.roi,
    marketConfidence: snapshot.marketConfidence,
    riskLevel: snapshot.riskLevel,
    dealGrade: snapshot.dealGrade,
    decisionData: clonePlain(input.decisionData || input.decision || {}),
    compData: clonePlain(input.compData || {}),
    marketData: clonePlain(input.marketData || {}),
    roiData: clonePlain(input.roiData || {}),
    riskData: clonePlain(input.riskData || {}),
    marketIntelligenceData: clonePlain(input.marketIntelligenceData || input.marketIntelligence || {}),
    populationData: clonePlain(input.populationData || {}),
    trendData: clonePlain(input.trendData || {}),
    qualityData: clonePlain(input.qualityData || {})
  };
}

function pushHistory(record, key, value, observedAt) {
  if (value === undefined || value === null || value === '') return;
  const { maxHistoryLength } = getRetentionPolicy();

  record[key].push({
    value,
    observedAt
  });

  if (record[key].length > maxHistoryLength) {
    record[key] = record[key].slice(record[key].length - maxHistoryLength);
  }
}

function getLastHistoryValue(record, key) {
  const history = asArray(record && record[key]);
  if (!history.length) return undefined;
  return history[history.length - 1].value;
}

function detectPriceDrop(record, newPrice, observedAt) {
  const previousPrice = toNumber(getLastHistoryValue(record, 'priceHistory'), 0);

  if (!previousPrice || !newPrice || newPrice >= previousPrice) {
    return null;
  }

  const dropAmount = previousPrice - newPrice;
  const dropPercent = previousPrice > 0 ? dropAmount / previousPrice : 0;

  return {
    ebayItemId: record.ebayItemId,
    previousPrice,
    currentPrice: newPrice,
    dropAmount: Number(dropAmount.toFixed(2)),
    dropPercent: Number(dropPercent.toFixed(4)),
    detectedAt: observedAt
  };
}

function createRecord(snapshot, observedAt) {
  return {
    ebayItemId: snapshot.ebayItemId,
    title: snapshot.title,
    player: snapshot.player,
    year: snapshot.year,
    set: snapshot.set,
    grade: snapshot.grade,
    firstSeenAt: observedAt,
    lastSeenAt: observedAt,
    seenCount: 0,
    status: 'active',
    disappearedAt: null,
    staleAt: null,
    priceDrops: [],
    predictionSnapshots: [],
    outcomes: [],
    accuracyLabels: null,
    priceHistory: [],
    scoreHistory: [],
    estimatedValueHistory: [],
    estimatedProfitHistory: [],
    roiHistory: [],
    marketConfidenceHistory: [],
    marketIntelligenceScoreHistory: [],
    riskLevelHistory: [],
    decisionHistory: [],
    dealGradeHistory: []
  };
}

function updateRecordMetadata(record, snapshot, observedAt) {
  record.title = snapshot.title || record.title;
  record.player = snapshot.player || record.player;
  record.year = snapshot.year || record.year;
  record.set = snapshot.set || record.set;
  record.grade = snapshot.grade || record.grade;
  record.lastSeenAt = observedAt;
  record.seenCount += 1;
  record.status = 'active';
  record.disappearedAt = null;

  if (!Array.isArray(record.predictionSnapshots)) record.predictionSnapshots = [];
  if (!Array.isArray(record.outcomes)) record.outcomes = [];
}

function trimRecentEvents() {
  const { maxRecentEvents } = getRetentionPolicy();
  learningState.predictionEvents = trimArrayToMax(learningState.predictionEvents, maxRecentEvents);
  learningState.scanEvents = trimArrayToMax(learningState.scanEvents, maxRecentEvents);
}

function enforceRetentionPolicy() {
  const policy = getRetentionPolicy();

  for (const record of learningState.recordsByEbayItemId.values()) {
    record.predictionSnapshots = trimArrayToMax(record.predictionSnapshots, policy.maxHistoryLength);
    record.outcomes = trimArrayToMax(record.outcomes, policy.maxHistoryLength);
    record.priceDrops = trimArrayToMax(record.priceDrops, policy.maxHistoryLength);

    for (const key of [
      'priceHistory',
      'scoreHistory',
      'estimatedValueHistory',
      'estimatedProfitHistory',
      'roiHistory',
      'marketConfidenceHistory',
      'marketIntelligenceScoreHistory',
      'riskLevelHistory',
      'decisionHistory',
      'dealGradeHistory'
    ]) {
      record[key] = trimArrayToMax(record[key], policy.maxHistoryLength);
    }
  }

  pruneMapByOldest(learningState.recordsByEbayItemId, policy.maxTrackedLearningRecords, {
    timeKeys: ['lastSeenAt', 'firstSeenAt'],
    idKeys: ['ebayItemId']
  });
  trimRecentEvents();
  return policy;
}

function recordPrediction(input = {}) {
  const observedAt = normalizeString(input.observedAt || input.seenAt || input.timestamp, nowIso());
  const snapshot = getSnapshot(input);

  if (!snapshot.ebayItemId) {
    return {
      ok: false,
      error: 'missing_ebay_item_id'
    };
  }

  const existingRecord = learningState.recordsByEbayItemId.get(snapshot.ebayItemId);
  const record = existingRecord || createRecord(snapshot, observedAt);
  const priceDrop = detectPriceDrop(record, snapshot.price, observedAt);
  const predictionSnapshot = buildPredictionSnapshot(input, snapshot, observedAt);

  updateRecordMetadata(record, snapshot, observedAt);

  record.predictionSnapshots.push(predictionSnapshot);
  record.predictionSnapshots = trimArrayToMax(record.predictionSnapshots, getRetentionPolicy().maxHistoryLength);

  pushHistory(record, 'priceHistory', snapshot.price, observedAt);
  pushHistory(record, 'scoreHistory', snapshot.score, observedAt);
  pushHistory(record, 'estimatedValueHistory', snapshot.estimatedValue, observedAt);
  pushHistory(record, 'estimatedProfitHistory', snapshot.estimatedProfit, observedAt);
  pushHistory(record, 'roiHistory', snapshot.roi, observedAt);
  pushHistory(record, 'marketConfidenceHistory', snapshot.marketConfidence, observedAt);
  pushHistory(record, 'marketIntelligenceScoreHistory', snapshot.marketIntelligenceScore, observedAt);
  pushHistory(record, 'riskLevelHistory', snapshot.riskLevel, observedAt);
  pushHistory(record, 'decisionHistory', snapshot.decision, observedAt);
  pushHistory(record, 'dealGradeHistory', snapshot.dealGrade, observedAt);

  if (priceDrop) {
    record.priceDrops.push(priceDrop);
  }

  learningState.recordsByEbayItemId.set(snapshot.ebayItemId, record);

  learningState.predictionEvents.push({
    predictionId: predictionSnapshot.predictionId,
    ebayItemId: snapshot.ebayItemId,
    title: record.title,
    observedAt,
    price: snapshot.price,
    score: snapshot.score,
    estimatedValue: snapshot.estimatedValue,
    estimatedProfit: snapshot.estimatedProfit,
    roi: snapshot.roi,
    marketConfidence: snapshot.marketConfidence,
    marketIntelligenceScore: snapshot.marketIntelligenceScore,
    decisionConfidence: snapshot.decisionConfidence,
    riskLevel: snapshot.riskLevel,
    decision: snapshot.decision,
    decisionType: classifyDecision(snapshot.decision),
    dealGrade: snapshot.dealGrade,
    priceDrop
  });

  trimRecentEvents();
  enforceRetentionPolicy();

  return {
    ok: true,
    record,
    predictionSnapshot,
    priceDrop
  };
}

function normalizeOutcome(outcome = {}) {
  const outcomeAt = normalizeString(outcome.outcomeAt || outcome.timestamp || outcome.date, nowIso());
  const actualPurchasePrice = pickFirstNumber([outcome], ['actualPurchasePrice', 'purchasePrice', 'costBasis', 'cost'], 0);
  const actualSalePrice = pickFirstNumber([outcome], ['actualSalePrice', 'salePrice', 'soldPrice'], 0);
  const fees = pickFirstNumber([outcome], ['fees', 'platformFees'], 0);
  const shipping = pickFirstNumber([outcome], ['shipping', 'shippingCost'], 0);
  const tax = pickFirstNumber([outcome], ['tax', 'salesTax'], 0);
  const gradingCost = pickFirstNumber([outcome], ['gradingCost', 'gradingFees'], 0);
  const providedProfit = pickFirstValue([outcome], ['realizedProfit', 'actualProfit', 'profit'], undefined);
  const providedROI = pickFirstValue([outcome], ['realizedROI', 'actualROI', 'roi'], undefined);

  const canCalculateProfit = actualPurchasePrice > 0 && actualSalePrice > 0;
  const calculatedProfit = canCalculateProfit
    ? actualSalePrice - actualPurchasePrice - fees - shipping - tax - gradingCost
    : 0;

  const realizedProfit = providedProfit !== undefined
    ? toNumber(providedProfit, 0)
    : canCalculateProfit
      ? Number(calculatedProfit.toFixed(2))
      : null;

  const realizedROI = providedROI !== undefined
    ? toNumber(providedROI, 0)
    : canCalculateProfit && actualPurchasePrice > 0
      ? Number(((calculatedProfit / actualPurchasePrice) * 100).toFixed(2))
      : null;

  return {
    outcomeType: normalizeString(outcome.outcomeType || outcome.type || 'unknown').toLowerCase(),
    finalPrice: pickFirstNumber([outcome], ['finalPrice', 'endingPrice', 'closedPrice'], 0),
    actualPurchasePrice,
    actualSalePrice,
    fees,
    shipping,
    tax,
    gradingCost,
    realizedProfit,
    realizedROI,
    outcomeAt,
    notes: normalizeString(outcome.notes || outcome.note, '')
  };
}

function getLatestPredictionSnapshot(record = {}) {
  const snapshots = asArray(record.predictionSnapshots);
  if (snapshots.length) return snapshots[snapshots.length - 1];

  return {
    originalRecommendation: getLastHistoryValue(record, 'decisionHistory'),
    decisionConfidence: getLastHistoryValue(record, 'marketConfidenceHistory'),
    estimatedValue: getLastHistoryValue(record, 'estimatedValueHistory'),
    estimatedProfit: getLastHistoryValue(record, 'estimatedProfitHistory'),
    roi: getLastHistoryValue(record, 'roiHistory'),
    score: getLastHistoryValue(record, 'scoreHistory')
  };
}

function deriveAccuracyLabels(record = {}, outcome = {}) {
  const prediction = getLatestPredictionSnapshot(record);
  const decisionType = classifyDecision(prediction.originalRecommendation);
  const realizedProfit = outcome.realizedProfit;
  const realizedROI = outcome.realizedROI;
  const finalComparablePrice = outcome.actualSalePrice || outcome.finalPrice;
  const estimatedValue = toNumber(prediction.estimatedValue, 0);
  const hasOutcomeValue = finalComparablePrice > 0;
  const hasRealizedProfit = realizedProfit !== null && realizedProfit !== undefined && Number.isFinite(Number(realizedProfit));

  const wasProfitable = hasRealizedProfit ? realizedProfit > 0 : null;
  const pricingErrorPercent = hasOutcomeValue && estimatedValue > 0
    ? Number((((estimatedValue - finalComparablePrice) / finalComparablePrice) * 100).toFixed(2))
    : null;

  const wasBuyRecommendation = decisionType === 'buy';
  const wasWatchRecommendation = decisionType === 'watch';
  const wasPassRecommendation = decisionType === 'pass';

  const positiveOutcome = wasProfitable === true || ['sold_profit', 'profitable', 'good_buy'].includes(outcome.outcomeType);
  const negativeOutcome = wasProfitable === false || ['bad_buy', 'loss', 'overpriced'].includes(outcome.outcomeType);
  const missedPositiveOutcome = ['missed_deal', 'sold_profit', 'profitable'].includes(outcome.outcomeType) || positiveOutcome;

  const wasFalsePositive = wasBuyRecommendation && negativeOutcome ? true : wasBuyRecommendation && positiveOutcome ? false : null;
  const wasFalseNegative = wasPassRecommendation && missedPositiveOutcome ? true : wasPassRecommendation && negativeOutcome ? false : null;

  let decisionWasCorrect = null;
  if (wasBuyRecommendation && positiveOutcome) decisionWasCorrect = true;
  else if (wasBuyRecommendation && negativeOutcome) decisionWasCorrect = false;
  else if (wasPassRecommendation && negativeOutcome) decisionWasCorrect = true;
  else if (wasPassRecommendation && missedPositiveOutcome) decisionWasCorrect = false;
  else if (wasWatchRecommendation && hasOutcomeValue) decisionWasCorrect = true;

  return {
    wasBuyRecommendation,
    wasWatchRecommendation,
    wasPassRecommendation,
    wasProfitable,
    wasFalsePositive,
    wasFalseNegative,
    pricingErrorPercent,
    confidenceBucket: getConfidenceBucket(prediction.decisionConfidence || prediction.marketConfidence),
    decisionWasCorrect
  };
}

function recordListingOutcome(ebayItemId, outcome = {}) {
  const id = normalizeId(ebayItemId);
  if (!id) {
    return {
      ok: false,
      error: 'missing_ebay_item_id'
    };
  }

  const record = learningState.recordsByEbayItemId.get(id);
  if (!record) {
    return {
      ok: false,
      error: 'learning_record_not_found'
    };
  }

  const normalizedOutcome = normalizeOutcome(outcome);
  const accuracyLabels = deriveAccuracyLabels(record, normalizedOutcome);

  if (!Array.isArray(record.outcomes)) record.outcomes = [];
  record.outcomes.push({
    ...normalizedOutcome,
    accuracyLabels
  });

  record.outcomes = trimArrayToMax(record.outcomes, getRetentionPolicy().maxHistoryLength);

  record.accuracyLabels = accuracyLabels;
  record.lastOutcomeAt = normalizedOutcome.outcomeAt;
  enforceRetentionPolicy();

  return {
    ok: true,
    record,
    outcome: normalizedOutcome,
    accuracyLabels
  };
}

function getObservedId(item) {
  if (typeof item === 'string' || typeof item === 'number') {
    return normalizeId(item);
  }

  if (!item || typeof item !== 'object') return '';

  return getEbayItemId(item, item);
}

function recordScanOutcome(observedListings = [], options = {}) {
  const observedAt = normalizeString(options.observedAt || options.timestamp, nowIso());
  const staleAfterMs = toNumber(options.staleAfterMs, DEFAULT_STALE_AFTER_MS);

  const observedIds = new Set(
    asArray(observedListings)
      .map(getObservedId)
      .filter(Boolean)
  );

  const disappeared = [];
  const stale = [];

  for (const record of learningState.recordsByEbayItemId.values()) {
    if (observedIds.has(record.ebayItemId)) {
      record.status = 'active';
      record.lastSeenAt = observedAt;
      record.disappearedAt = null;
      continue;
    }

    if (record.status === 'active') {
      record.status = 'disappeared';
      record.disappearedAt = observedAt;
      disappeared.push(record.ebayItemId);
    }

    const lastSeenMs = new Date(record.lastSeenAt).getTime();
    const observedMs = new Date(observedAt).getTime();

    if (
      Number.isFinite(lastSeenMs) &&
      Number.isFinite(observedMs) &&
      observedMs - lastSeenMs >= staleAfterMs
    ) {
      record.status = 'stale';
      record.staleAt = observedAt;
      stale.push(record.ebayItemId);
    }
  }

  const scanEvent = {
    observedAt,
    observedCount: observedIds.size,
    disappeared,
    stale
  };

  learningState.scanEvents.push(scanEvent);
  enforceRetentionPolicy();

  return {
    ok: true,
    ...scanEvent
  };
}

function average(values) {
  const cleanValues = values
    .map((value) => toNumber(value, NaN))
    .filter((value) => Number.isFinite(value));

  if (!cleanValues.length) return 0;

  return cleanValues.reduce((sum, value) => sum + value, 0) / cleanValues.length;
}

function percent(numerator, denominator) {
  if (!denominator) return 0;
  return Number(((numerator / denominator) * 100).toFixed(2));
}

function getLatestNumericValues(records, key) {
  return records
    .map((record) => getLastHistoryValue(record, key))
    .map((value) => toNumber(value, NaN))
    .filter((value) => Number.isFinite(value));
}

function getLatestOutcome(record = {}) {
  const outcomes = asArray(record.outcomes);
  return outcomes.length ? outcomes[outcomes.length - 1] : null;
}

function getRecordsWithOutcomes() {
  return Array.from(learningState.recordsByEbayItemId.values())
    .filter((record) => getLatestOutcome(record));
}

function summarizeAccuracy() {
  const records = getRecordsWithOutcomes();
  const labeled = records
    .map((record) => {
      const outcome = getLatestOutcome(record);
      return outcome && outcome.accuracyLabels ? outcome.accuracyLabels : record.accuracyLabels;
    })
    .filter(Boolean);

  const correctLabels = labeled.filter((label) => label.decisionWasCorrect === true);
  const knownDecisionLabels = labeled.filter((label) => label.decisionWasCorrect !== null && label.decisionWasCorrect !== undefined);

  const buyLabels = labeled.filter((label) => label.wasBuyRecommendation);
  const successfulBuys = buyLabels.filter((label) => label.wasProfitable === true || label.decisionWasCorrect === true);

  const watchLabels = labeled.filter((label) => label.wasWatchRecommendation);
  const watchConverted = watchLabels.filter((label) => label.wasProfitable === true);

  const passLabels = labeled.filter((label) => label.wasPassRecommendation);
  const passFalseNegatives = passLabels.filter((label) => label.wasFalseNegative === true);

  const realizedProfits = records
    .map((record) => getLatestOutcome(record))
    .map((outcome) => outcome && outcome.realizedProfit)
    .filter((value) => value !== null && value !== undefined)
    .map((value) => toNumber(value, NaN))
    .filter((value) => Number.isFinite(value));

  const realizedROIs = records
    .map((record) => getLatestOutcome(record))
    .map((outcome) => outcome && outcome.realizedROI)
    .filter((value) => value !== null && value !== undefined)
    .map((value) => toNumber(value, NaN))
    .filter((value) => Number.isFinite(value));

  const pricingErrors = labeled
    .map((label) => label.pricingErrorPercent)
    .filter((value) => value !== null && value !== undefined)
    .map((value) => Math.abs(toNumber(value, NaN)))
    .filter((value) => Number.isFinite(value));

  return {
    outcomeCount: records.length,
    recommendationAccuracy: percent(correctLabels.length, knownDecisionLabels.length),
    buyRecommendationSuccessRate: percent(successfulBuys.length, buyLabels.length),
    watchConversionRate: percent(watchConverted.length, watchLabels.length),
    passFalseNegativeRate: percent(passFalseNegatives.length, passLabels.length),
    averageRealizedProfit: Number(average(realizedProfits).toFixed(2)),
    averageRealizedROI: Number(average(realizedROIs).toFixed(2)),
    averagePricingError: Number(average(pricingErrors).toFixed(2)),
    confidenceCalibrationByBucket: summarizeConfidenceCalibration(labeled),
    decisionAccuracyByRecommendationType: summarizeDecisionAccuracyByType(labeled)
  };
}

function summarizeConfidenceCalibration(labels) {
  const buckets = {};

  for (const label of labels) {
    const bucket = label.confidenceBucket || 'unknown';
    if (!buckets[bucket]) {
      buckets[bucket] = {
        total: 0,
        correct: 0,
        incorrect: 0,
        unknown: 0,
        accuracy: 0
      };
    }

    buckets[bucket].total += 1;

    if (label.decisionWasCorrect === true) buckets[bucket].correct += 1;
    else if (label.decisionWasCorrect === false) buckets[bucket].incorrect += 1;
    else buckets[bucket].unknown += 1;
  }

  for (const bucket of Object.keys(buckets)) {
    const known = buckets[bucket].correct + buckets[bucket].incorrect;
    buckets[bucket].accuracy = percent(buckets[bucket].correct, known);
  }

  return buckets;
}

function summarizeDecisionAccuracyByType(labels) {
  const types = {
    buy: { total: 0, correct: 0, incorrect: 0, unknown: 0, accuracy: 0 },
    watch: { total: 0, correct: 0, incorrect: 0, unknown: 0, accuracy: 0 },
    pass: { total: 0, correct: 0, incorrect: 0, unknown: 0, accuracy: 0 },
    unknown: { total: 0, correct: 0, incorrect: 0, unknown: 0, accuracy: 0 }
  };

  for (const label of labels) {
    const type = label.wasBuyRecommendation
      ? 'buy'
      : label.wasWatchRecommendation
        ? 'watch'
        : label.wasPassRecommendation
          ? 'pass'
          : 'unknown';

    types[type].total += 1;

    if (label.decisionWasCorrect === true) types[type].correct += 1;
    else if (label.decisionWasCorrect === false) types[type].incorrect += 1;
    else types[type].unknown += 1;
  }

  for (const type of Object.keys(types)) {
    const known = types[type].correct + types[type].incorrect;
    types[type].accuracy = percent(types[type].correct, known);
  }

  return types;
}

function summarizeLearning() {
  const records = Array.from(learningState.recordsByEbayItemId.values());
  const latestDecisions = records.map((record) => classifyDecision(getLastHistoryValue(record, 'decisionHistory')));

  const buyRecommendations = latestDecisions.filter((decision) => decision === 'buy').length;
  const watchRecommendations = latestDecisions.filter((decision) => decision === 'watch').length;
  const passAvoidRecommendations = latestDecisions.filter((decision) => decision === 'pass').length;

  const priceDropCount = records.reduce((count, record) => {
    return count + asArray(record.priceDrops).length;
  }, 0);

  return {
    totalTrackedPredictions: records.length,
    buyRecommendations,
    watchRecommendations,
    passAvoidRecommendations,
    averageROI: Number(average(getLatestNumericValues(records, 'roiHistory')).toFixed(2)),
    averageMarketConfidence: Number(average(getLatestNumericValues(records, 'marketConfidenceHistory')).toFixed(2)),
    averageMarketIntelligenceScore: Number(
      average(getLatestNumericValues(records, 'marketIntelligenceScoreHistory')).toFixed(2)
    ),
    priceDropCount,
    activeCount: records.filter((record) => record.status === 'active').length,
    disappearedCount: records.filter((record) => record.status === 'disappeared').length,
    staleCount: records.filter((record) => record.status === 'stale').length,
    recentPredictionCount: learningState.predictionEvents.length,
    recentScanCount: learningState.scanEvents.length,
    ...summarizeAccuracy()
  };
}

function getLearningRecord(ebayItemId) {
  const id = normalizeId(ebayItemId);
  return id ? learningState.recordsByEbayItemId.get(id) || null : null;
}

function getRecentPredictions(limit = 50) {
  const safeLimit = Math.max(1, Math.min(500, Math.round(toNumber(limit, 50))));

  return learningState.predictionEvents
    .slice(-safeLimit)
    .reverse();
}

module.exports = {
  recordPrediction,
  recordScanOutcome,
  recordListingOutcome,
  summarizeLearning,
  summarizeAccuracy,
  getLearningRecord,
  getRecentPredictions,
  getRetentionPolicy
};
