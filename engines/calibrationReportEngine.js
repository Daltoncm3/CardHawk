'use strict';

const SOURCE = 'calibration_report_engine';

const DECISIONS = ['BUY_NOW', 'STRONG_WATCH', 'WATCH', 'MONITOR', 'PASS'];

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function toNullableNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, toNumber(value, min)));
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeDecision(value) {
  const decision = String(value || '').trim().toUpperCase();
  if (decision === 'REJECT' || decision === 'AVOID' || decision === 'DO_NOT_BUY') return 'PASS';
  return DECISIONS.includes(decision) ? decision : 'MONITOR';
}

function percent(part, total) {
  if (!total) return null;
  return Math.round((part / total) * 10000) / 100;
}

function average(values) {
  const usable = asArray(values).map(toNullableNumber).filter((value) => value !== null);
  if (!usable.length) return null;
  return Math.round((usable.reduce((sum, value) => sum + value, 0) / usable.length) * 100) / 100;
}

function pickNumber(sources, keys, fallback = 0) {
  for (const source of asArray(sources)) {
    const object = asObject(source);
    for (const key of asArray(keys)) {
      if (object[key] !== undefined && object[key] !== null && object[key] !== '') {
        const value = toNullableNumber(object[key]);
        if (value !== null) return value;
      }
    }
  }

  return fallback;
}

function getDecisionRecords(data = {}) {
  return asArray(
    data.decisionRecords ||
      data.records ||
      data.decisions ||
      data.recentDecisions ||
      data.decisionValidationData?.records ||
      data.decisionValidationData?.recentDecisions
  );
}

function getLearningRecords(data = {}) {
  const learningData = asObject(data.learningData || data.learning || {});
  const records = data.learningRecords || learningData.records || learningData.recentPredictions;

  if (Array.isArray(records)) return records;

  if (records && typeof records === 'object') {
    return Object.values(records);
  }

  return [];
}

function getHistoryData(data = {}) {
  return asObject(data.historyData || data.history || {});
}

function getDecisionSummaryData(data = {}) {
  return asObject(
    data.decisionValidationSummary ||
      data.decisionSummary ||
      data.decisionValidationData ||
      {}
  );
}

function getLearningSummaryData(data = {}) {
  return asObject(
    data.learningSummary ||
      data.learningData?.summary ||
      data.learning ||
      {}
  );
}

function getHistorySummaryData(data = {}) {
  return asObject(
    data.historySummary ||
      data.historyData?.summary ||
      data.history ||
      {}
  );
}

function getRecordDecision(record = {}) {
  return normalizeDecision(
    record.decision ||
      record.recommendation ||
      record.finalRecommendation ||
      record.decisionData?.recommendation ||
      record.decisionData?.decision ||
      record.dealGate?.decision
  );
}

function hasOutcome(record = {}) {
  return Boolean(
    record.outcome ||
      record.outcomeType ||
      record.realizedROI !== undefined ||
      record.realizedProfit !== undefined ||
      record.realizedSalePrice !== undefined ||
      record.finalPrice !== undefined
  );
}

function isFallbackRecord(record = {}) {
  const sources = [
    record.compSource,
    record.marketSource,
    record.source,
    record.method,
    record.compData?.source,
    record.compData?.method,
    record.marketData?.source,
    record.marketData?.method,
    record.valueData?.source,
    record.valueData?.method
  ].map((value) => String(value || '').toLowerCase());

  return sources.some((value) => value.includes('fallback') || value.includes('heuristic'));
}

function isThinMarketRecord(record = {}) {
  const usableCompCount = pickNumber([
    record,
    record.compData,
    record.marketData,
    record.marketIntelligenceData,
    record.raw?.compData,
    record.raw?.marketData
  ], [
    'usableCompCount',
    'selectedCompCount',
    'strongCompCount',
    'compCount',
    'soldCompCount'
  ], 0);

  return usableCompCount > 0 && usableCompCount < 3;
}

function isHighSpreadRecord(record = {}) {
  const spread = pickNumber([
    record,
    record.compData,
    record.marketData,
    record.valueData,
    record.raw?.compData,
    record.raw?.marketData
  ], [
    'pricingSpread',
    'spread',
    'priceSpread'
  ], 0);

  if (spread > 1) return spread >= 35;
  return spread >= 0.35;
}

function isLowConfidenceBuy(record = {}) {
  const decision = getRecordDecision(record);
  if (decision !== 'BUY_NOW') return false;

  const confidence = pickNumber([
    record,
    record.decisionData,
    record.raw?.decisionData,
    record.marketData,
    record.compData
  ], [
    'decisionConfidence',
    'confidence',
    'marketConfidence',
    'pricingConfidence'
  ], 0);

  return confidence > 0 && confidence < 70;
}

function summarizeExecutive(input = {}) {
  const historySummary = getHistorySummaryData(input);
  const learningSummary = getLearningSummaryData(input);
  const decisionSummary = getDecisionSummaryData(input);
  const decisionRecords = getDecisionRecords(input);
  const learningRecords = getLearningRecords(input);

  const totalListingsTracked = pickNumber([
    historySummary,
    learningSummary,
    decisionSummary
  ], [
    'totalListingsTracked',
    'totalTracked',
    'trackedCount',
    'totalDecisionRecords',
    'totalRecords',
    'totalPredictions'
  ], decisionRecords.length || learningRecords.length);

  return {
    totalListingsTracked,
    activeListings: pickNumber([historySummary], ['activeListings', 'activeCount'], 0),
    disappearedListings: pickNumber([historySummary], ['disappearedListings', 'disappearedCount'], 0),
    staleListings: pickNumber([historySummary, learningSummary], ['staleListings', 'staleCount'], 0)
  };
}

function summarizeDecisions(input = {}) {
  const decisionSummary = getDecisionSummaryData(input);
  const records = getDecisionRecords(input);

  const summaryCounts = asObject(
    decisionSummary.recommendationCounts ||
      decisionSummary.decisionCounts ||
      decisionSummary.counts ||
      {}
  );

  const counts = {
    BUY_NOW: toNumber(summaryCounts.BUY_NOW, 0),
    STRONG_WATCH: toNumber(summaryCounts.STRONG_WATCH, 0),
    WATCH: toNumber(summaryCounts.WATCH, 0),
    MONITOR: toNumber(summaryCounts.MONITOR, 0),
    PASS: toNumber(summaryCounts.PASS, 0)
  };

  if (!Object.values(counts).some(Boolean) && records.length) {
    for (const record of records) {
      const decision = getRecordDecision(record);
      counts[decision] = toNumber(counts[decision], 0) + 1;
    }
  }

  return counts;
}

function summarizePerformance(input = {}) {
  const decisionSummary = getDecisionSummaryData(input);
  const learningSummary = getLearningSummaryData(input);
  const records = getDecisionRecords(input);

  return {
    buyNowAccuracy: firstPresent([
      decisionSummary.buyNowAccuracy,
      decisionSummary.BUY_NOWAccuracy,
      learningSummary.buyRecommendationSuccessRate,
      calculateBuyNowAccuracy(records)
    ]),
    watchConversionRate: firstPresent([
      decisionSummary.watchConversionRate,
      learningSummary.watchConversionRate,
      calculateWatchConversionRate(records)
    ]),
    passFalseNegativeRate: firstPresent([
      decisionSummary.passFalseNegativeRate,
      learningSummary.passFalseNegativeRate,
      calculatePassFalseNegativeRate(records)
    ]),
    averageProjectedROI: firstPresent([
      decisionSummary.averageProjectedROI,
      learningSummary.averageProjectedROI,
      average(records.map((record) => record.projectedROI ?? record.roi))
    ]),
    averageRealizedROI: firstPresent([
      decisionSummary.averageRealizedROI,
      learningSummary.averageRealizedROI,
      average(records.map((record) => record.outcome?.realizedROI ?? record.realizedROI))
    ]),
    averagePricingError: firstPresent([
      decisionSummary.averagePricingError,
      learningSummary.averagePricingError,
      average(records.map((record) => record.derived?.pricingErrorPercent ?? record.pricingErrorPercent))
    ])
  };
}

function firstPresent(values) {
  for (const value of asArray(values)) {
    if (value !== undefined && value !== null && value !== '') return value;
  }

  return null;
}

function calculateBuyNowAccuracy(records = []) {
  const buyRecords = asArray(records).filter((record) => getRecordDecision(record) === 'BUY_NOW');
  const known = buyRecords.filter((record) => record.derived?.decisionWasCorrect !== null && record.derived?.decisionWasCorrect !== undefined);
  const correct = known.filter((record) => record.derived?.decisionWasCorrect === true).length;
  return percent(correct, known.length);
}

function calculateWatchConversionRate(records = []) {
  const watchRecords = asArray(records).filter((record) => {
    const decision = getRecordDecision(record);
    return decision === 'STRONG_WATCH' || decision === 'WATCH' || decision === 'MONITOR';
  });

  const converted = watchRecords.filter((record) => {
    return Boolean(
      record.derived?.watchConverted ||
        record.outcome?.userBought ||
        record.userBought
    );
  }).length;

  return percent(converted, watchRecords.length);
}

function calculatePassFalseNegativeRate(records = []) {
  const passRecords = asArray(records).filter((record) => getRecordDecision(record) === 'PASS');
  const falseNegatives = passRecords.filter((record) => record.derived?.wasFalseNegative === true).length;
  return percent(falseNegatives, passRecords.length);
}

function buildCalibrationWarnings(input = {}) {
  const records = [
    ...getDecisionRecords(input),
    ...getLearningRecords(input)
  ];

  const uniqueRecords = dedupeRecords(records);
  const warnings = [];

  const total = uniqueRecords.length;
  const fallbackCount = uniqueRecords.filter(isFallbackRecord).length;
  const thinMarketCount = uniqueRecords.filter(isThinMarketRecord).length;
  const highSpreadCount = uniqueRecords.filter(isHighSpreadRecord).length;
  const lowConfidenceBuyNowCount = uniqueRecords.filter(isLowConfidenceBuy).length;
  const missingOutcomeCount = uniqueRecords.filter((record) => !hasOutcome(record)).length;

  const fallbackRate = percent(fallbackCount, total);
  const thinMarketRate = percent(thinMarketCount, total);
  const highSpreadRate = percent(highSpreadCount, total);

  if (fallbackRate !== null && fallbackRate >= 20) {
    warnings.push(`Fallback valuations are high (${fallbackRate}% of tracked records).`);
  }

  if (thinMarketRate !== null && thinMarketRate >= 25) {
    warnings.push(`Thin-market records are elevated (${thinMarketRate}% of tracked records).`);
  }

  if (highSpreadRate !== null && highSpreadRate >= 20) {
    warnings.push(`High pricing-spread records are elevated (${highSpreadRate}% of tracked records).`);
  }

  if (lowConfidenceBuyNowCount > 0) {
    warnings.push(`${lowConfidenceBuyNowCount} BUY_NOW recommendation${lowConfidenceBuyNowCount === 1 ? '' : 's'} had low confidence.`);
  }

  if (missingOutcomeCount > 0) {
    warnings.push(`${missingOutcomeCount} tracked recommendation${missingOutcomeCount === 1 ? '' : 's'} still need outcome validation.`);
  }

  return {
    warnings,
    metrics: {
      fallbackCount,
      fallbackRate,
      thinMarketCount,
      thinMarketRate,
      highSpreadCount,
      highSpreadRate,
      lowConfidenceBuyNowCount,
      missingOutcomeCount
    }
  };
}

function dedupeRecords(records = []) {
  const seen = new Set();
  const deduped = [];

  for (const record of asArray(records)) {
    const id = record.listingId || record.ebayItemId || record.id || record.itemId;
    const key = id ? String(id) : `record_${deduped.length}`;

    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(asObject(record));
  }

  return deduped;
}

function generateExecutiveSummary(input = {}) {
  return {
    source: SOURCE,
    generatedAt: new Date().toISOString(),
    executiveSummary: summarizeExecutive(input)
  };
}

function generateDecisionSummary(input = {}) {
  return {
    source: SOURCE,
    generatedAt: new Date().toISOString(),
    decisionSummary: summarizeDecisions(input)
  };
}

function generatePerformanceSummary(input = {}) {
  return {
    source: SOURCE,
    generatedAt: new Date().toISOString(),
    performanceSummary: summarizePerformance(input)
  };
}

function generateCalibrationWarnings(input = {}) {
  const result = buildCalibrationWarnings(input);

  return {
    source: SOURCE,
    generatedAt: new Date().toISOString(),
    warnings: result.warnings,
    warningMetrics: result.metrics
  };
}

function generateCalibrationReport(input = {}) {
  const executiveSummary = summarizeExecutive(input);
  const decisionSummary = summarizeDecisions(input);
  const performanceSummary = summarizePerformance(input);
  const calibrationWarnings = buildCalibrationWarnings(input);

  return {
    source: SOURCE,
    generatedAt: new Date().toISOString(),
    executiveSummary,
    decisionSummary,
    performanceSummary,
    calibrationWarnings: calibrationWarnings.warnings,
    warningMetrics: calibrationWarnings.metrics,
    summary: buildReportSummary(executiveSummary, decisionSummary, performanceSummary, calibrationWarnings.warnings)
  };
}

function buildReportSummary(executiveSummary = {}, decisionSummary = {}, performanceSummary = {}, warnings = []) {
  const total = toNumber(executiveSummary.totalListingsTracked, 0);
  const buyNow = toNumber(decisionSummary.BUY_NOW, 0);
  const buyAccuracy = performanceSummary.buyNowAccuracy;

  const parts = [
    `Calibration report covers ${total} tracked listing${total === 1 ? '' : 's'}.`,
    `${buyNow} final BUY_NOW recommendation${buyNow === 1 ? '' : 's'} recorded.`
  ];

  if (buyAccuracy !== null && buyAccuracy !== undefined) {
    parts.push(`BUY_NOW accuracy is currently ${buyAccuracy}%.`);
  } else {
    parts.push('BUY_NOW accuracy is not yet established because realized outcomes are incomplete.');
  }

  if (warnings.length) {
    parts.push(`${warnings.length} calibration warning${warnings.length === 1 ? '' : 's'} need review.`);
  } else {
    parts.push('No calibration warnings are currently elevated.');
  }

  return parts.join(' ');
}

function summarizeCalibration(input = {}) {
  return generateCalibrationReport(input);
}

module.exports = {
  generateCalibrationReport,
  generateExecutiveSummary,
  generateDecisionSummary,
  generatePerformanceSummary,
  generateCalibrationWarnings,
  summarizeCalibration,

  summarizeExecutive,
  summarizeDecisions,
  summarizePerformance,
  buildCalibrationWarnings
};
