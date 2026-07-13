'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const SCHEMA_VERSION = '1.0.0';

const REVIEW_JUDGMENTS = Object.freeze(['buy', 'reject', 'uncertain', 'unreviewed']);
const OUTCOME_CATEGORIES = Object.freeze([
  'correct_buy',
  'false_positive',
  'correct_rejection',
  'missed_opportunity',
  'uncertain',
  'valuation_disagreement',
  'evidence_disagreement',
  'explanation_display_issue'
]);

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

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJsonFile(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function fingerprint(value) {
  return crypto.createHash('sha256').update(stableStringify(value)).digest('hex');
}

function percent(count, total) {
  if (!total) return 0;
  return Number(((count / total) * 100).toFixed(1));
}

function average(values = []) {
  const clean = values.map(Number).filter(Number.isFinite);
  if (!clean.length) return 0;
  return Number((clean.reduce((sum, value) => sum + value, 0) / clean.length).toFixed(2));
}

function getListingId(listing = {}, index = 0) {
  return listing.ebayItemId || listing.itemId || listing.listingId || listing.id || `listing-${index + 1}`;
}

function getDisplay(listing = {}) {
  return asObject(listing.display);
}

function getMarketIntelligence(listing = {}) {
  return asObject(listing.marketIntelligenceData || listing.marketIntelligence);
}

function getDealGate(listing = {}) {
  return asObject(listing.dealGate);
}

function getSoldEvidenceSupport(listing = {}, display = {}) {
  if (display.soldEvidenceSupport) return display.soldEvidenceSupport;
  return {
    label: display.soldEvidenceConfidenceLabel || 'Sold Evidence Support',
    rawValue: display.soldEvidenceCount ?? listing.compData?.trueSoldCompCount ?? listing.compData?.soldCompCount ?? 0,
    sourceDetails: {
      trueSoldCompCount: display.soldEvidenceCount ?? listing.compData?.trueSoldCompCount ?? listing.compData?.soldCompCount ?? 0,
      activeCompCount: listing.compData?.activeCompCount ?? 0
    }
  };
}

function getEvidenceReadiness(listing = {}, display = {}, marketIntelligence = {}) {
  return display.evidenceReadinessExplanation || {
    label: 'Evidence Readiness',
    authoritativeDecisionSource: 'deal_gate',
    productionImpact: 'none',
    evidenceReadiness: marketIntelligence.decisionIntelligence?.overallReadiness || 'unknown',
    evidencePosture: marketIntelligence.decisionIntelligence?.evidencePosture || 'unknown',
    compPosture: marketIntelligence.decisionIntelligence?.compPosture || 'unknown',
    valuationPosture: marketIntelligence.decisionIntelligence?.valuationPosture || 'unknown',
    resalePressurePosture: marketIntelligence.decisionIntelligence?.resalePressurePosture || 'unknown'
  };
}

function getProductionDecisionExplanation(listing = {}, display = {}) {
  return display.productionDecisionExplanation || listing.dealGate?.dealGateBreakdown || {};
}

function getRejectionReasons(listing = {}, display = {}) {
  return [
    ...asArray(display.rejectionReasons),
    ...asArray(listing.dealGate?.reasons),
    ...asArray(listing.dealGate?.rejectionReasons)
  ].filter(Boolean);
}

function createListingValidationRecord(listing = {}, options = {}) {
  const index = options.index || 0;
  const display = getDisplay(listing);
  const marketIntelligence = getMarketIntelligence(listing);
  const dealGate = getDealGate(listing);
  const buyNow = Boolean(dealGate.buyNowAllowed ?? dealGate.passed ?? listing.buyNowAllowed);
  const cardhawkSnapshot = {
    capturedAt: options.capturedAt || new Date().toISOString(),
    dealGateDecision: dealGate.decision || display.authoritativeDecision || (buyNow ? 'BUY_NOW' : 'REJECT'),
    buyNow,
    productionDecisionExplanation: getProductionDecisionExplanation(listing, display),
    estimatedValue: toNumber(listing.estimatedValue ?? listing.marketData?.marketValue, null),
    estimatedProfit: toNumber(listing.estimatedProfit, null),
    roi: toNumber(listing.roi, null),
    soldEvidenceSupport: getSoldEvidenceSupport(listing, display),
    valuationConfidence: display.valuationConfidence || { rawValue: listing.marketData?.confidence ?? null },
    marketContextConfidence: display.marketContextConfidence || { rawValue: listing.marketConfidence ?? null },
    evidenceReadiness: getEvidenceReadiness(listing, display, marketIntelligence),
    legacyContextScore: {
      label: display.legacyScoreLabel || 'Legacy Context Score',
      rawValue: toNumber(listing.score, null),
      scoreBreakdown: listing.scoreBreakdown || null
    },
    desirabilityContext: {
      label: display.qualityScoreLabel || 'Desirability Context',
      rawValue: toNumber(listing.investmentQuality ?? listing.qualityData?.investmentQuality, null),
      bucketLabel: display.qualityBucketLabel || listing.qualityBucket || listing.qualityData?.bucket || '',
      qualityBreakdown: listing.qualityBreakdown || null
    },
    legacyDealGrade: {
      label: display.dealGradeScoreLabel || 'Legacy Deal Grade',
      rawValue: listing.dealGrade || null,
      displayGrade: display.dealGradeLabel || listing.dealGrade?.grade || '',
      dealGradeBreakdown: listing.dealGradeBreakdown || null
    },
    rejectionReasons: getRejectionReasons(listing, display),
    unifiedDecisionPresentation: display.unifiedDecisionPresentation || null
  };

  return {
    schemaVersion: SCHEMA_VERSION,
    recordId: options.recordId || `real-listing-${index + 1}`,
    snapshotLockedAt: cardhawkSnapshot.capturedAt,
    listing: {
      identity: {
        title: listing.title || listing.name || '',
        parsed: listing.parsed || listing.card || listing.identity || {}
      },
      itemId: getListingId(listing, index),
      url: listing.url || listing.itemWebUrl || listing.listingUrl || '',
      marketplace: listing.marketplace || listing.platform || listing.source || 'ebay',
      askingPrice: toNumber(listing.price ?? listing.askingPrice ?? listing.currentPrice, null),
      totalCost: toNumber(listing.totalCost ?? listing.allInCost ?? listing.price, null)
    },
    cardhawkSnapshot,
    snapshotHash: fingerprint(cardhawkSnapshot),
    daltonReview: {
      judgment: 'unreviewed',
      expectedFairValue: null,
      judgmentConfidence: null,
      agreementDisagreementReason: '',
      notes: ''
    },
    validation: {
      outcomeCategory: 'uncertain',
      disagreementCategories: [],
      recurringFailurePattern: '',
      reviewedAt: null
    }
  };
}

function normalizeJudgment(value) {
  const normalized = String(value || 'unreviewed').trim().toLowerCase();
  return REVIEW_JUDGMENTS.includes(normalized) ? normalized : 'unreviewed';
}

function normalizeOutcome(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return OUTCOME_CATEGORIES.includes(normalized) ? normalized : '';
}

function getCardHawkDecision(record = {}) {
  return record.cardhawkSnapshot?.buyNow === true ? 'buy' : 'reject';
}

function deriveOutcome(record = {}) {
  const explicit = normalizeOutcome(record.validation?.outcomeCategory);
  if (explicit && explicit !== 'uncertain') return explicit;

  const judgment = normalizeJudgment(record.daltonReview?.judgment);
  if (judgment === 'uncertain' || judgment === 'unreviewed') return 'uncertain';

  const cardhawkDecision = getCardHawkDecision(record);
  if (cardhawkDecision === 'buy' && judgment === 'buy') return 'correct_buy';
  if (cardhawkDecision === 'buy' && judgment === 'reject') return 'false_positive';
  if (cardhawkDecision === 'reject' && judgment === 'reject') return 'correct_rejection';
  if (cardhawkDecision === 'reject' && judgment === 'buy') return 'missed_opportunity';
  return 'uncertain';
}

function getEvidenceLevel(record = {}) {
  const support = record.cardhawkSnapshot?.soldEvidenceSupport || {};
  const count = toNumber(
    support.rawValue ?? support.sourceDetails?.trueSoldCompCount,
    0
  );
  if (count >= 8) return 'strong_sold_support';
  if (count >= 3) return 'sufficient_sold_support';
  if (count >= 1) return 'thin_sold_support';
  return 'no_sold_support';
}

function getPriceRange(record = {}) {
  const price = toNumber(record.listing?.totalCost ?? record.listing?.askingPrice, 0);
  if (price < 25) return 'under_25';
  if (price < 100) return '25_to_99';
  if (price < 500) return '100_to_499';
  return '500_plus';
}

function validateValidationRecord(record = {}) {
  const errors = [];
  const snapshot = record.cardhawkSnapshot || {};
  const listing = record.listing || {};

  if (record.schemaVersion !== SCHEMA_VERSION) errors.push('schemaVersion must match real listing validation schema.');
  if (!record.recordId) errors.push('recordId is required.');
  if (!listing.itemId && !listing.url) errors.push('listing itemId or URL is required.');
  if (!listing.identity || !listing.identity.title) errors.push('listing identity title is required.');
  if (snapshot.buyNow === undefined) errors.push('CardHawk BUY_NOW result is required.');
  if (!snapshot.dealGateDecision) errors.push('CardHawk Deal Gate decision is required.');
  if (!snapshot.productionDecisionExplanation) errors.push('production decision explanation is required.');
  if (!snapshot.soldEvidenceSupport) errors.push('sold evidence support is required.');
  if (!snapshot.evidenceReadiness) errors.push('Evidence Readiness is required.');
  if (!snapshot.legacyContextScore) errors.push('Legacy Context Score is required.');
  if (!snapshot.desirabilityContext) errors.push('Desirability Context is required.');
  if (!snapshot.legacyDealGrade) errors.push('Legacy Deal Grade is required.');
  if (!record.snapshotHash) errors.push('snapshotHash is required for immutable snapshot tracking.');
  if (record.snapshotHash && fingerprint(snapshot) !== record.snapshotHash) {
    errors.push('snapshotHash does not match cardhawkSnapshot; historical output may have been modified.');
  }

  const judgment = normalizeJudgment(record.daltonReview?.judgment);
  if (!REVIEW_JUDGMENTS.includes(judgment)) errors.push('Dalton judgment must be buy, reject, uncertain, or unreviewed.');

  const confidence = record.daltonReview?.judgmentConfidence;
  if (confidence !== null && confidence !== undefined && confidence !== '') {
    const number = toNumber(confidence, NaN);
    if (!Number.isFinite(number) || number < 0 || number > 100) {
      errors.push('Dalton judgment confidence must be 0-100 when provided.');
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

function extractRecords(batchOrRecords = {}) {
  if (Array.isArray(batchOrRecords)) return batchOrRecords;
  return asArray(batchOrRecords.records || batchOrRecords.listings || batchOrRecords.results);
}

function loadValidationBatches(inputPaths = []) {
  return asArray(inputPaths).map((inputPath) => ({
    inputPath,
    data: readJsonFile(inputPath)
  }));
}

function buildValidationBatch(records = [], options = {}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    source: 'real_listing_accuracy_validation',
    mode: 'offline_manual_review',
    batchId: options.batchId || 'real-listing-batch',
    createdAt: options.createdAt || new Date().toISOString(),
    targetListingCount: options.targetListingCount || 25,
    reviewer: options.reviewer || 'Dalton',
    immutableSnapshots: true,
    records
  };
}

function increment(object, key, amount = 1) {
  const normalized = key || 'unknown';
  object[normalized] = (object[normalized] || 0) + amount;
}

function getValuationError(record = {}) {
  const expected = toNumber(record.daltonReview?.expectedFairValue, null);
  const actual = toNumber(record.cardhawkSnapshot?.estimatedValue, null);
  if (!expected || !actual) return null;
  const absoluteError = Math.abs(actual - expected);
  return {
    recordId: record.recordId,
    itemId: record.listing?.itemId || '',
    cardhawkEstimatedValue: actual,
    daltonExpectedFairValue: expected,
    absoluteError: Number(absoluteError.toFixed(2)),
    percentError: Number(((absoluteError / expected) * 100).toFixed(1))
  };
}

function buildAccuracyValidationReport(batchOrBatches = [], options = {}) {
  const batches = Array.isArray(batchOrBatches) ? batchOrBatches : [batchOrBatches];
  const records = batches.flatMap((batch) => extractRecords(batch.data || batch));
  const validations = records.map(validateValidationRecord);
  const reviewedRecords = records.filter((record) => normalizeJudgment(record.daltonReview?.judgment) !== 'unreviewed');
  const decisiveRecords = reviewedRecords.filter((record) => ['buy', 'reject'].includes(normalizeJudgment(record.daltonReview?.judgment)));
  const outcomes = records.map((record) => deriveOutcome(record));
  const outcomeCounts = {};
  const disagreementCategories = {};
  const recurringFailurePatterns = {};
  const byEvidenceLevel = {};
  const byPriceRange = {};
  const valuationErrors = records.map(getValuationError).filter(Boolean);

  records.forEach((record, index) => {
    const outcome = outcomes[index];
    increment(outcomeCounts, outcome);
    for (const category of asArray(record.validation?.disagreementCategories)) increment(disagreementCategories, category);
    if (record.validation?.recurringFailurePattern) increment(recurringFailurePatterns, record.validation.recurringFailurePattern);

    const evidenceLevel = getEvidenceLevel(record);
    const priceRange = getPriceRange(record);
    byEvidenceLevel[evidenceLevel] ||= { total: 0, outcomes: {} };
    byEvidenceLevel[evidenceLevel].total += 1;
    increment(byEvidenceLevel[evidenceLevel].outcomes, outcome);
    byPriceRange[priceRange] ||= { total: 0, outcomes: {} };
    byPriceRange[priceRange].total += 1;
    increment(byPriceRange[priceRange].outcomes, outcome);
  });

  const agreed = decisiveRecords.filter((record) => {
    const judgment = normalizeJudgment(record.daltonReview?.judgment);
    return getCardHawkDecision(record) === judgment;
  }).length;
  const falsePositiveCount = outcomeCounts.false_positive || 0;
  const missedOpportunityCount = outcomeCounts.missed_opportunity || 0;

  return {
    source: 'real_listing_accuracy_validation_report',
    mode: 'offline_manual_review',
    schemaVersion: SCHEMA_VERSION,
    generatedAt: options.generatedAt || new Date().toISOString(),
    pilotTarget: options.pilotTarget || 25,
    totalListings: records.length,
    totalListingsReviewed: reviewedRecords.length,
    decisiveReviewCount: decisiveRecords.length,
    cardhawkVsDaltonAgreementRate: percent(agreed, decisiveRecords.length),
    falsePositiveCount,
    falsePositiveRate: percent(falsePositiveCount, decisiveRecords.length),
    missedOpportunityCount,
    missedOpportunityRate: percent(missedOpportunityCount, decisiveRecords.length),
    outcomeCounts,
    valuationErrorSummary: {
      comparedCount: valuationErrors.length,
      averageAbsoluteError: average(valuationErrors.map((item) => item.absoluteError)),
      averagePercentError: average(valuationErrors.map((item) => item.percentError)),
      largestErrors: valuationErrors
        .slice()
        .sort((a, b) => b.absoluteError - a.absoluteError)
        .slice(0, 10)
    },
    disagreementCategories,
    recurringFailurePatterns,
    breakdownByEvidenceLevel: byEvidenceLevel,
    breakdownByPriceRange: byPriceRange,
    validationIntegrity: {
      invalidRecordCount: validations.filter((result) => !result.valid).length,
      invalidRecords: validations
        .map((result, index) => ({ recordId: records[index]?.recordId || `record-${index + 1}`, ...result }))
        .filter((result) => !result.valid)
    }
  };
}

function runAccuracyValidationReport(inputPaths = [], outputFile = null, options = {}) {
  const batches = loadValidationBatches(inputPaths);
  const report = buildAccuracyValidationReport(batches, {
    ...options,
    inputFiles: inputPaths.map((inputPath) => path.resolve(inputPath))
  });

  if (outputFile) writeJsonFile(outputFile, report);
  return report;
}

module.exports = {
  SCHEMA_VERSION,
  REVIEW_JUDGMENTS,
  OUTCOME_CATEGORIES,
  buildAccuracyValidationReport,
  buildValidationBatch,
  createListingValidationRecord,
  deriveOutcome,
  fingerprint,
  loadValidationBatches,
  normalizeJudgment,
  normalizeOutcome,
  runAccuracyValidationReport,
  validateValidationRecord,
  writeJsonFile
};
