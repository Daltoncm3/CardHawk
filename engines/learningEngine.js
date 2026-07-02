'use strict';

const learningState = {
  recordsByEbayItemId: new Map(),
  predictionEvents: [],
  scanEvents: []
};

const MAX_HISTORY_LENGTH = 100;
const MAX_RECENT_EVENTS = 1000;
const DEFAULT_STALE_AFTER_MS = 1000 * 60 * 60 * 24 * 7;

function nowIso() {
  return new Date().toISOString();
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

function extractListing(input = {}) {
  return input.listing || input.item || input.rawListing || input;
}

function extractParsed(input = {}, listing = {}) {
  return input.parsed || input.parsedCard || input.card || listing.parsed || {};
}

function extractScoring(input = {}) {
  return input.scoring || input.scoreData || input.analysis || input.evaluation || {};
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
      [input, scoring],
      ['decision', 'recommendation', 'action', 'buyDecision'],
      ''
    )
  ).toLowerCase();
}

function classifyDecision(decision) {
  const value = normalizeString(decision).toLowerCase();

  if (!value) return 'unknown';
  if (value.includes('buy') || value.includes('trust') || value === 'strong_buy') return 'buy';
  if (value.includes('watch') || value.includes('review') || value.includes('hold')) return 'watch';
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

function getMarketConfidence(input = {}, scoring = {}) {
  return pickFirstNumber(
    [input, scoring, scoring.confidence, scoring.market],
    ['marketConfidence', 'confidenceScore', 'confidence', 'marketConfidenceScore'],
    0
  );
}

function getMarketIntelligenceScore(input = {}, scoring = {}) {
  return pickFirstNumber(
    [input, scoring, scoring.marketIntelligence, scoring.intelligence],
    ['marketIntelligenceScore', 'intelligenceScore', 'marketScore'],
    0
  );
}

function getSnapshot(input = {}) {
  const listing = extractListing(input);
  const parsed = extractParsed(input, listing);
  const scoring = extractScoring(input);
  const roiData = input.roiData || scoring.roiData || scoring.roi || {};

  const ebayItemId = getEbayItemId(input, listing);
  const decision = getDecision(input, scoring);

  return {
    ebayItemId,
    title: normalizeString(pickFirstValue([input, listing], ['title', 'name'], '')),
    player: normalizeString(pickFirstValue([parsed, input], ['player', 'playerName'], '')),
    year: normalizeString(pickFirstValue([parsed, input], ['year'], '')),
    set: normalizeString(pickFirstValue([parsed, input], ['set', 'cardSet', 'series'], '')),
    grade: normalizeString(pickFirstValue([parsed, input], ['grade', 'conditionGrade'], '')),
    price: pickFirstNumber([input, listing], ['price', 'currentPrice', 'askingPrice', 'listPrice'], 0),
    score: pickFirstNumber([input, scoring], ['score', 'dealScore', 'overallScore'], 0),
    estimatedValue: pickFirstNumber(
      [input, scoring, roiData],
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
    riskLevel: normalizeString(pickFirstValue([input, scoring], ['riskLevel', 'risk'], 'unknown')).toLowerCase(),
    decision,
    dealGrade: normalizeString(pickFirstValue([input, scoring], ['dealGrade', 'grade'], ''))
  };
}

function pushHistory(record, key, value, observedAt) {
  if (value === undefined || value === null || value === '') return;

  record[key].push({
    value,
    observedAt
  });

  if (record[key].length > MAX_HISTORY_LENGTH) {
    record[key] = record[key].slice(record[key].length - MAX_HISTORY_LENGTH);
  }
}

function getLastHistoryValue(record, key) {
  const history = asArray(record[key]);
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
}

function trimRecentEvents() {
  if (learningState.predictionEvents.length > MAX_RECENT_EVENTS) {
    learningState.predictionEvents = learningState.predictionEvents.slice(
      learningState.predictionEvents.length - MAX_RECENT_EVENTS
    );
  }

  if (learningState.scanEvents.length > MAX_RECENT_EVENTS) {
    learningState.scanEvents = learningState.scanEvents.slice(
      learningState.scanEvents.length - MAX_RECENT_EVENTS
    );
  }
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

  updateRecordMetadata(record, snapshot, observedAt);

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
    riskLevel: snapshot.riskLevel,
    decision: snapshot.decision,
    decisionType: classifyDecision(snapshot.decision),
    dealGrade: snapshot.dealGrade,
    priceDrop
  });

  trimRecentEvents();

  return {
    ok: true,
    record,
    priceDrop
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
  trimRecentEvents();

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

function getLatestNumericValues(records, key) {
  return records
    .map((record) => getLastHistoryValue(record, key))
    .map((value) => toNumber(value, NaN))
    .filter((value) => Number.isFinite(value));
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
    recentScanCount: learningState.scanEvents.length
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
  summarizeLearning,
  getLearningRecord,
  getRecentPredictions
};
