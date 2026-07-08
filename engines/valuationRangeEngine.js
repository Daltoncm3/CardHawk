'use strict';

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function roundMoney(value) {
  return Math.round(toNumber(value, 0) * 100) / 100;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(toNumber(value, 0))));
}

function uniqueMessages(messages) {
  const seen = new Set();

  return asArray(messages)
    .filter(Boolean)
    .map((message) => String(message).trim())
    .filter((message) => {
      if (!message || seen.has(message)) return false;
      seen.add(message);
      return true;
    });
}

function getPrice(item = {}) {
  return toNumber(
    item.price ??
      item.soldPrice ??
      item.salePrice ??
      item.askingPrice ??
      item.amount ??
      item.totalPrice ??
      item.value,
    0
  );
}

function getMedian(values = []) {
  const clean = values
    .map((value) => toNumber(value, NaN))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);

  if (!clean.length) return 0;

  const middle = Math.floor(clean.length / 2);
  if (clean.length % 2) return clean[middle];
  return (clean[middle - 1] + clean[middle]) / 2;
}

function getPercentile(values = [], percentile = 50) {
  const clean = values
    .map((value) => toNumber(value, NaN))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);

  if (!clean.length) return 0;

  const index = clamp(Math.floor((percentile / 100) * clean.length), 0, clean.length - 1);
  return clean[index];
}

function pickFirstNumber(sources, keys, fallback = 0) {
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;

    for (const key of keys) {
      if (source[key] !== undefined && source[key] !== null) {
        const value = toNumber(source[key], NaN);
        if (Number.isFinite(value)) return value;
      }
    }
  }

  return fallback;
}

function getSoldEvidence(evidenceSummary = {}, soldSales = []) {
  const normalized = asArray(evidenceSummary.normalizedEvidence)
    .filter((item) => item && item.evidenceType === 'true_sold' && getPrice(item) > 0);

  if (normalized.length) return normalized;

  return asArray(soldSales)
    .map((item) => ({ ...item, price: getPrice(item), evidenceType: 'true_sold' }))
    .filter((item) => item.price > 0);
}

function getActiveEvidence(evidenceSummary = {}, activeComps = []) {
  const normalized = asArray(evidenceSummary.normalizedEvidence)
    .filter((item) => item && item.evidenceType === 'active' && getPrice(item) > 0);

  if (normalized.length) return normalized;

  return asArray(activeComps)
    .map((item) => ({ ...item, price: getPrice(item), evidenceType: 'active' }))
    .filter((item) => item.price > 0);
}

function getReferenceValue(input = {}, soldPrices = []) {
  const evidenceSummary = input.evidenceSummary || {};
  const marketData = input.marketData || {};
  const compData = input.compData || {};
  const medianSold = pickFirstNumber([evidenceSummary], ['medianSold'], 0);
  const weightedSoldAverage = pickFirstNumber([evidenceSummary], ['weightedSoldAverage'], 0);
  const marketValue = pickFirstNumber(
    [marketData, compData],
    ['marketValue', 'expectedValue', 'estimatedValue', 'referenceMarketValue'],
    0
  );

  if (medianSold > 0 && weightedSoldAverage > 0) {
    return roundMoney(medianSold * 0.55 + weightedSoldAverage * 0.45);
  }

  if (medianSold > 0) return roundMoney(medianSold);
  if (weightedSoldAverage > 0) return roundMoney(weightedSoldAverage);
  if (soldPrices.length) return roundMoney(getMedian(soldPrices));
  if (marketValue > 0) return roundMoney(marketValue);
  return 0;
}

function getQualitySignals(input = {}) {
  const evidenceSummary = input.evidenceSummary || {};
  const comparableQuality = input.comparableQuality || {};
  const evidenceSufficiency = input.evidenceSufficiency || {};
  const listingSimilarity = input.listingSimilarity || {};
  const outlierAnalysis = input.outlierAnalysis || input.outlier || {};
  const marketRegime = input.marketRegime || {};
  const liquidityEvidence = input.liquidityEvidence || input.liquidity || {};

  return {
    trueSoldCount: pickFirstNumber([evidenceSummary], ['trueSoldCount'], 0),
    activeCount: pickFirstNumber([evidenceSummary], ['activeCount'], 0),
    priceSpread: pickFirstNumber([evidenceSummary], ['priceSpread'], 0),
    volatility: pickFirstNumber([evidenceSummary], ['volatility'], 0),
    evidenceQualityScore: pickFirstNumber([evidenceSummary], ['evidenceQualityScore'], 0),
    comparableQualityScore: pickFirstNumber([comparableQuality], ['averageComparableQualityScore'], 0),
    evidenceSufficiencyScore: pickFirstNumber([evidenceSufficiency], ['evidenceSufficiencyScore'], 0),
    sufficiencyLevel: normalize(evidenceSufficiency.sufficiencyLevel),
    similarityScore: pickFirstNumber([listingSimilarity], ['averageSimilarityScore', 'similarityScore'], 0),
    outlierRate: pickFirstNumber([outlierAnalysis], ['outlierRate'], 0),
    extremeOutlierCount: pickFirstNumber([outlierAnalysis], ['extremeOutlierCount'], 0),
    marketRegime: normalize(marketRegime.primaryRegime),
    liquidityLevel: normalize(liquidityEvidence.liquidityLevel || liquidityEvidence.level || liquidityEvidence.liquidityRating),
    activeOnlyFlag: evidenceSummary.activeOnlyFlag === true,
    fallbackOnlyFlag: evidenceSummary.fallbackOnlyFlag === true
  };
}

function getRangeQuality(confidence, signals) {
  if (signals.activeOnlyFlag || signals.fallbackOnlyFlag || signals.trueSoldCount <= 0) return 'unreliable';
  if (signals.comparableQualityScore > 0 && signals.comparableQualityScore < 50) {
    return signals.trueSoldCount >= 3 ? 'usable' : 'thin';
  }
  if (confidence >= 80 && signals.trueSoldCount >= 5) return 'strong';
  if (confidence >= 60 && signals.trueSoldCount >= 3) return 'usable';
  if (signals.trueSoldCount > 0) return 'thin';
  return 'unreliable';
}

function getBaseSpread(signals) {
  let spread = 0.18;

  if (signals.trueSoldCount >= 8) spread -= 0.04;
  else if (signals.trueSoldCount >= 5) spread -= 0.02;
  else if (signals.trueSoldCount < 3) spread += 0.14;
  else if (signals.trueSoldCount <= 0) spread += 0.25;

  if (signals.priceSpread > 1) spread += 0.18;
  else if (signals.priceSpread > 0.65) spread += 0.12;
  else if (signals.priceSpread > 0.4) spread += 0.06;
  else if (signals.priceSpread > 0 && signals.priceSpread <= 0.25) spread -= 0.03;

  if (signals.volatility > 0.55) spread += 0.12;
  else if (signals.volatility > 0.35) spread += 0.07;
  else if (signals.volatility > 0 && signals.volatility <= 0.18) spread -= 0.02;

  if (signals.outlierRate > 0.3 || signals.extremeOutlierCount > 0) spread += 0.1;
  if (['overheated', 'hype_driven', 'volatile'].includes(signals.marketRegime)) spread += 0.08;
  if (['falling', 'cooling', 'stale'].includes(signals.marketRegime)) spread += 0.06;
  if (['thin', 'poor', 'illiquid'].includes(signals.liquidityLevel)) spread += 0.08;
  if (signals.activeOnlyFlag || signals.fallbackOnlyFlag) spread = Math.max(spread, 0.45);

  return clamp(spread, 0.08, 0.62);
}

function getConfidence(signals) {
  let confidence = 20;

  confidence += Math.min(28, signals.trueSoldCount * 5);
  confidence += Math.min(16, signals.evidenceSufficiencyScore * 0.16);
  confidence += Math.min(14, signals.comparableQualityScore * 0.14);
  confidence += Math.min(10, signals.evidenceQualityScore * 0.1);

  if (signals.similarityScore > 0) confidence += Math.min(10, signals.similarityScore * 0.1);
  if (signals.priceSpread > 0.65) confidence -= 12;
  if (signals.volatility > 0.45) confidence -= 10;
  if (signals.outlierRate > 0.3) confidence -= 12;
  if (signals.extremeOutlierCount > 0) confidence -= 12;
  if (['overheated', 'hype_driven', 'volatile', 'falling', 'cooling', 'stale'].includes(signals.marketRegime)) confidence -= 8;
  if (['thin', 'poor', 'illiquid'].includes(signals.liquidityLevel)) confidence -= 8;
  if (signals.trueSoldCount < 3) confidence = Math.min(confidence, signals.trueSoldCount <= 0 ? 20 : 44);
  if (signals.activeOnlyFlag || signals.fallbackOnlyFlag) confidence = Math.min(confidence, 18);

  return clampScore(confidence);
}

function getAdjustments(signals) {
  const adjustments = {
    outlierAdjustment: 0,
    liquidityAdjustment: 0,
    regimeAdjustment: 0,
    evidenceQualityAdjustment: 0,
    similarityAdjustment: 0
  };

  if (signals.outlierRate > 0.3 || signals.extremeOutlierCount > 0) adjustments.outlierAdjustment = -0.08;
  else if (signals.outlierRate > 0.15) adjustments.outlierAdjustment = -0.04;

  if (['thin', 'poor', 'illiquid'].includes(signals.liquidityLevel)) adjustments.liquidityAdjustment = -0.06;
  else if (['excellent', 'strong', 'good'].includes(signals.liquidityLevel)) adjustments.liquidityAdjustment = 0.03;

  if (['falling', 'cooling', 'stale'].includes(signals.marketRegime)) adjustments.regimeAdjustment = -0.07;
  else if (['overheated', 'hype_driven'].includes(signals.marketRegime)) adjustments.regimeAdjustment = -0.04;
  else if (signals.marketRegime === 'rising') adjustments.regimeAdjustment = 0.03;

  if (signals.evidenceSufficiencyScore >= 75 && signals.comparableQualityScore >= 75) adjustments.evidenceQualityAdjustment = 0.03;
  else if (signals.evidenceSufficiencyScore > 0 && signals.evidenceSufficiencyScore < 45) adjustments.evidenceQualityAdjustment = -0.07;

  if (signals.similarityScore >= 85) adjustments.similarityAdjustment = 0.02;
  else if (signals.similarityScore > 0 && signals.similarityScore < 65) adjustments.similarityAdjustment = -0.05;

  return adjustments;
}

function applyAdjustment(value, adjustment) {
  if (!value || value <= 0) return 0;
  return roundMoney(value * (1 + adjustment));
}

function calculateValuationRange(input = {}) {
  const evidenceSummary = input.evidenceSummary || {};
  const soldEvidence = getSoldEvidence(evidenceSummary, input.soldSales);
  const activeEvidence = getActiveEvidence(evidenceSummary, input.activeComps || input.activeListings);
  const soldPrices = soldEvidence.map((item) => getPrice(item)).filter((price) => price > 0);
  const activePrices = activeEvidence.map((item) => getPrice(item)).filter((price) => price > 0);
  const signals = getQualitySignals(input);
  const referenceValue = getReferenceValue(input, soldPrices);
  const confidence = getConfidence(signals);
  const spread = getBaseSpread(signals);
  const adjustments = getAdjustments(signals);
  const totalExpectedAdjustment = clamp(
    adjustments.outlierAdjustment +
      adjustments.liquidityAdjustment +
      adjustments.regimeAdjustment +
      adjustments.evidenceQualityAdjustment +
      adjustments.similarityAdjustment,
    -0.18,
    0.12
  );

  if (!referenceValue || referenceValue <= 0 || signals.trueSoldCount <= 0 || signals.activeOnlyFlag || signals.fallbackOnlyFlag) {
    return {
      floorValue: 0,
      expectedValue: 0,
      ceilingValue: 0,
      confidence,
      rangeQuality: getRangeQuality(confidence, signals),
      basis: {
        medianSold: roundMoney(pickFirstNumber([evidenceSummary], ['medianSold'], getMedian(soldPrices))),
        weightedSoldAverage: roundMoney(pickFirstNumber([evidenceSummary], ['weightedSoldAverage'], 0)),
        activeMedianAsk: roundMoney(pickFirstNumber([evidenceSummary], ['activeMedianAsk'], getMedian(activePrices))),
        trueSoldCount: signals.trueSoldCount,
        activeCount: signals.activeCount,
        priceSpread: signals.priceSpread,
        volatility: signals.volatility
      },
      adjustments,
      scenarios: {
        conservativeExit: {
          value: 0,
          explanation: 'No reliable true sold support was available, so a conservative exit value was not established.'
        },
        normalExit: {
          value: 0,
          explanation: 'Expected value was not established because valuation range requires true sold evidence.'
        },
        optimisticExit: {
          value: 0,
          explanation: 'Ceiling value was not established because active or fallback evidence cannot support upside by itself.'
        }
      }
    };
  }

  const adjustedExpected = applyAdjustment(referenceValue, totalExpectedAdjustment);
  const p20 = getPercentile(soldPrices, 20);
  const p80 = getPercentile(soldPrices, 80);
  const floorCandidate = Math.min(
    adjustedExpected * (1 - spread),
    p20 > 0 ? p20 : adjustedExpected
  );
  const ceilingCandidate = Math.max(
    adjustedExpected * (1 + spread * 0.82),
    p80 > 0 ? p80 : adjustedExpected
  );

  let floorValue = roundMoney(floorCandidate);
  let expectedValue = roundMoney(adjustedExpected);
  let ceilingValue = roundMoney(ceilingCandidate);

  if (['overheated', 'hype_driven'].includes(signals.marketRegime)) {
    ceilingValue = roundMoney(Math.min(ceilingValue, expectedValue * 1.18));
  }

  if (signals.outlierRate > 0.3 || signals.extremeOutlierCount > 0) {
    ceilingValue = roundMoney(Math.min(ceilingValue, expectedValue * 1.15));
  }

  if (floorValue > expectedValue) floorValue = roundMoney(expectedValue * (1 - spread));
  if (ceilingValue < expectedValue) ceilingValue = roundMoney(expectedValue * (1 + spread * 0.75));

  return {
    floorValue,
    expectedValue,
    ceilingValue,
    confidence,
    rangeQuality: getRangeQuality(confidence, signals),
    basis: {
      medianSold: roundMoney(pickFirstNumber([evidenceSummary], ['medianSold'], getMedian(soldPrices))),
      weightedSoldAverage: roundMoney(pickFirstNumber([evidenceSummary], ['weightedSoldAverage'], 0)),
      activeMedianAsk: roundMoney(pickFirstNumber([evidenceSummary], ['activeMedianAsk'], getMedian(activePrices))),
      trueSoldCount: signals.trueSoldCount,
      activeCount: signals.activeCount,
      priceSpread: signals.priceSpread,
      volatility: signals.volatility
    },
    adjustments,
    scenarios: {
      conservativeExit: {
        value: floorValue,
        explanation: 'Floor value reflects a conservative dealer exit using lower sold evidence and current range risk.'
      },
      normalExit: {
        value: expectedValue,
        explanation: 'Expected value reflects sold-market reference value adjusted by evidence quality, liquidity, regime, outlier, and similarity signals.'
      },
      optimisticExit: {
        value: ceilingValue,
        explanation: 'Ceiling value reflects optimistic but evidence-supported upside after limiting hype, volatility, and outlier pressure.'
      }
    }
  };
}

function summarizeValuationRange(data = {}) {
  const quality = data.rangeQuality || 'unreliable';

  if (quality === 'strong') {
    return `Valuation range is strong: floor $${roundMoney(data.floorValue)}, expected $${roundMoney(data.expectedValue)}, ceiling $${roundMoney(data.ceilingValue)}.`;
  }

  if (quality === 'usable') {
    return `Valuation range is usable but should be reviewed: floor $${roundMoney(data.floorValue)}, expected $${roundMoney(data.expectedValue)}, ceiling $${roundMoney(data.ceilingValue)}.`;
  }

  if (quality === 'thin') {
    return 'Valuation range is thin because sold evidence is limited; use the floor more than the ceiling.';
  }

  return 'Valuation range is unreliable because true sold support is missing or insufficient.';
}

function evaluateValuationRange(input = {}) {
  const range = calculateValuationRange(input);
  const warnings = [];
  const positives = [];

  if (range.basis.trueSoldCount <= 0) warnings.push('No true sold evidence supports a valuation range.');
  else if (range.basis.trueSoldCount < 3) warnings.push('Valuation range is based on fewer than 3 true sold comps.');
  else positives.push(`${range.basis.trueSoldCount} true sold comps support the valuation range.`);

  if (range.basis.priceSpread > 0.65) warnings.push('Wide sold-price spread increases range uncertainty.');
  if (range.basis.volatility > 0.45) warnings.push('High sold-price volatility increases range uncertainty.');
  if (range.confidence >= 70) positives.push(`Valuation range confidence is usable (${range.confidence}/100).`);
  if (range.rangeQuality === 'unreliable') warnings.push('Valuation range is unreliable and should remain evidence-only.');

  const result = {
    source: 'valuation_range_engine',
    version: '1.2',
    ...range,
    warnings: uniqueMessages(warnings),
    positives: uniqueMessages(positives),
    summary: ''
  };

  result.summary = summarizeValuationRange(result);
  return result;
}

module.exports = {
  evaluateValuationRange,
  calculateValuationRange,
  summarizeValuationRange
};
