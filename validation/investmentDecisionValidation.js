'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const investmentDecisionEngine = require('../engines/investmentDecisionEngine');
const investmentContract = require('./investmentDecisionContract');

const SCHEMA_VERSION = '1.0.0';
const SOURCE = 'investment_decision_validation_harness';

const REVIEW_DECISIONS = Object.freeze([
  'IGNORE',
  'MONITOR',
  'NEGOTIATE',
  'BUY',
  'PRIORITY_BUY',
  'UNCERTAIN',
  'UNREVIEWED'
]);

const OUTCOME_CATEGORIES = Object.freeze([
  'agreement',
  'false_positive',
  'missed_opportunity',
  'correct_restriction',
  'correct_buy',
  'uncertain',
  'outcome_pending',
  'market_outcome_disagreement',
  'reasoning_disagreement',
  'evidence_disagreement'
]);

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function clone(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function toNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
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

function increment(target = {}, key = 'unknown', amount = 1) {
  const normalized = key || 'unknown';
  target[normalized] = (target[normalized] || 0) + amount;
}

function normalizeReviewDecision(value) {
  const normalized = String(value || 'UNREVIEWED').trim().toUpperCase();
  if (normalized === 'REJECT') return 'IGNORE';
  return REVIEW_DECISIONS.includes(normalized) ? normalized : 'UNREVIEWED';
}

function normalizeOutcomeCategory(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return OUTCOME_CATEGORIES.includes(normalized) ? normalized : '';
}

function getListingId(snapshot = {}, index = 0) {
  const listing = asObject(snapshot.listingSnapshot || snapshot.listing || snapshot);
  return String(
    listing.ebayItemId ||
    listing.marketplaceItemId ||
    listing.itemId ||
    listing.listingId ||
    listing.id ||
    `investment-listing-${index + 1}`
  );
}

function getInvestmentInput(snapshot = {}) {
  const input = asObject(snapshot.investmentDecisionInput || snapshot.input);
  if (Object.keys(input).length) return clone(input);

  return {
    listingSnapshot: clone(snapshot.listingSnapshot || snapshot.listing || snapshot),
    dealGate: clone(snapshot.dealGate),
    productionValuation: clone(snapshot.productionValuation),
    productionDecisionExplanation: clone(snapshot.productionDecisionExplanation),
    canonicalIdentity: clone(snapshot.canonicalIdentity),
    canonicalSoldEvidence: clone(snapshot.canonicalSoldEvidence),
    shadowSoldComparison: clone(snapshot.shadowSoldComparison),
    shadowValuation: clone(snapshot.shadowValuation),
    marketIntelligence: clone(snapshot.marketIntelligence),
    confidenceBreakdown: clone(snapshot.confidenceBreakdown),
    financialContext: clone(snapshot.financialContext),
    portfolioContext: clone(snapshot.portfolioContext),
    strategyProfile: clone(snapshot.strategyProfile),
    competingOpportunities: clone(snapshot.competingOpportunities || [])
  };
}

function getProductionSnapshot(input = {}, snapshot = {}) {
  return {
    listingSnapshot: clone(input.listingSnapshot),
    dealGate: clone(input.dealGate),
    productionValuation: clone(input.productionValuation),
    productionDecisionExplanation: clone(input.productionDecisionExplanation),
    marketIntelligence: clone(input.marketIntelligence),
    confidenceBreakdown: clone(input.confidenceBreakdown),
    financialContext: clone(input.financialContext),
    originalProductionOutputs: clone(snapshot.productionOutputs || snapshot.cardhawkSnapshot || null)
  };
}

function getShadowSnapshot(input = {}, snapshot = {}) {
  return {
    canonicalIdentity: clone(input.canonicalIdentity),
    canonicalSoldEvidence: clone(input.canonicalSoldEvidence),
    shadowSoldComparison: clone(input.shadowSoldComparison),
    shadowValuation: clone(input.shadowValuation),
    originalShadowOutputs: clone(snapshot.shadowOutputs || null)
  };
}

function getDefaultDaltonReview(snapshot = {}) {
  const review = asObject(snapshot.daltonReview);
  return {
    decision: normalizeReviewDecision(review.decision || review.investmentPosture || review.judgment),
    strategyLane: review.strategyLane || '',
    confidence: review.confidence ?? review.judgmentConfidence ?? null,
    agreementReason: review.agreementReason || review.agreementDisagreementReason || '',
    disagreementCategories: asArray(review.disagreementCategories),
    recurringReasoningPattern: review.recurringReasoningPattern || '',
    notes: review.notes || ''
  };
}

function getDefaultActualOutcome(snapshot = {}) {
  const outcome = asObject(snapshot.actualOutcome);
  return {
    status: outcome.status || 'pending',
    soldPrice: outcome.soldPrice ?? null,
    netProfit: outcome.netProfit ?? null,
    roi: outcome.roi ?? null,
    daysToExit: outcome.daysToExit ?? null,
    outcomeCategory: outcome.outcomeCategory || '',
    notes: outcome.notes || ''
  };
}

function isAggressivePosture(posture) {
  return [
    investmentContract.INVESTMENT_POSTURES.BUY,
    investmentContract.INVESTMENT_POSTURES.PRIORITY_BUY
  ].includes(posture);
}

function isRestrictivePosture(posture) {
  return [
    investmentContract.INVESTMENT_POSTURES.IGNORE,
    investmentContract.INVESTMENT_POSTURES.MONITOR
  ].includes(posture);
}

function deriveValidationOutcome(record = {}) {
  const explicit = normalizeOutcomeCategory(record.actualOutcome?.outcomeCategory || record.validation?.outcomeCategory);
  if (explicit && explicit !== 'uncertain') return explicit;

  const cardhawkPosture = record.investmentDecision?.investmentPosture;
  const daltonDecision = normalizeReviewDecision(record.daltonReview?.decision);
  if (daltonDecision === 'UNREVIEWED') return 'outcome_pending';
  if (daltonDecision === 'UNCERTAIN') return 'uncertain';
  if (cardhawkPosture === daltonDecision) return 'agreement';
  if (isAggressivePosture(cardhawkPosture) && isAggressivePosture(daltonDecision)) return 'agreement';
  if (isRestrictivePosture(cardhawkPosture) && isRestrictivePosture(daltonDecision)) return 'agreement';

  if (isAggressivePosture(cardhawkPosture) && ['IGNORE', 'MONITOR'].includes(daltonDecision)) {
    return 'false_positive';
  }
  if (isRestrictivePosture(cardhawkPosture) && ['BUY', 'PRIORITY_BUY'].includes(daltonDecision)) {
    return 'missed_opportunity';
  }
  if (cardhawkPosture === 'NEGOTIATE' && daltonDecision === 'BUY') return 'missed_opportunity';
  if (cardhawkPosture === 'BUY' && daltonDecision === 'NEGOTIATE') return 'false_positive';
  if (cardhawkPosture === 'PRIORITY_BUY' && ['BUY', 'NEGOTIATE'].includes(daltonDecision)) return 'false_positive';

  return 'reasoning_disagreement';
}

function getEvidenceQualityLevel(record = {}) {
  const input = asObject(record.inputSnapshot);
  const shadow = asObject(input.shadowValuation);
  const sold = asObject(input.canonicalSoldEvidence);
  const comparison = asObject(input.shadowSoldComparison);
  const exactCount = Math.max(
    asArray(comparison.acceptedExactMatches).length,
    toNumber(comparison.processingSummary?.exactMatchCount, 0),
    toNumber(shadow.evidenceSummary?.exactMatchCount, 0),
    toNumber(sold.trueSoldCount, 0)
  );

  if (shadow.insufficientEvidence === true) return 'insufficient_shadow_valuation';
  if (exactCount >= 8) return 'strong_exact_sold_support';
  if (exactCount >= 3) return 'sufficient_exact_sold_support';
  if (exactCount >= 1) return 'thin_exact_sold_support';
  return 'no_exact_sold_support';
}

function getSelectedStrategyLane(investmentDecision = {}) {
  return investmentDecision.strategyFit?.selectedContextLane || 'unknown';
}

function createInvestmentValidationRecord(snapshot = {}, options = {}) {
  const index = options.index || 0;
  const input = getInvestmentInput(snapshot);
  const investmentDecision = clone(snapshot.investmentDecision) || investmentDecisionEngine.evaluateInvestmentDecision(input);
  const productionSnapshot = getProductionSnapshot(input, snapshot);
  const shadowSnapshot = getShadowSnapshot(input, snapshot);
  const immutableSnapshot = {
    input,
    productionSnapshot,
    shadowSnapshot,
    investmentDecision
  };
  const record = {
    schemaVersion: SCHEMA_VERSION,
    source: SOURCE,
    recordId: options.recordId || snapshot.recordId || `investment-validation-${index + 1}`,
    listingId: getListingId(input, index),
    capturedAt: options.capturedAt || snapshot.capturedAt || new Date().toISOString(),
    immutableSnapshot,
    snapshotHash: fingerprint(immutableSnapshot),
    inputSnapshot: input,
    productionSnapshot,
    shadowSnapshot,
    investmentDecision,
    daltonReview: getDefaultDaltonReview(snapshot),
    actualOutcome: getDefaultActualOutcome(snapshot),
    validation: {
      outcomeCategory: '',
      agreement: 'not_reviewed',
      disagreementCategories: [],
      recurringReasoningPatterns: [],
      improvementCandidates: [],
      notes: ''
    }
  };

  const outcomeCategory = deriveValidationOutcome(record);
  record.validation.outcomeCategory = outcomeCategory;
  record.validation.agreement = outcomeCategory === 'agreement' ? 'agreed' : (
    ['outcome_pending', 'uncertain'].includes(outcomeCategory) ? 'not_evaluated' : 'disagreed'
  );
  record.validation.disagreementCategories = getDisagreementCategories(record);
  record.validation.recurringReasoningPatterns = getRecurringReasoningPatterns(record);
  record.validation.improvementCandidates = getImprovementCandidates(record);
  return record;
}

function getDisagreementCategories(record = {}) {
  const categories = new Set(asArray(record.daltonReview?.disagreementCategories));
  const outcome = deriveValidationOutcome(record);
  const blockers = asArray(record.investmentDecision?.blockers);
  const cautions = asArray(record.investmentDecision?.cautionReasons);

  if (['false_positive', 'missed_opportunity'].includes(outcome)) categories.add(outcome);
  if (blockers.some((reason) => /evidence|sold|identity|valuation|shadow/.test(reason))) categories.add('evidence_quality');
  if (cautions.some((reason) => /liquidity|exit|hold|pressure/.test(reason))) categories.add('exit_liquidity');
  if (cautions.some((reason) => /concentration|capital|allocation|bankroll/.test(reason)) || blockers.some((reason) => /capital|bankroll/.test(reason))) {
    categories.add('portfolio_capital');
  }
  if (record.investmentDecision?.investmentPosture !== normalizeReviewDecision(record.daltonReview?.decision) && record.daltonReview?.decision !== 'UNREVIEWED') {
    categories.add('posture_disagreement');
  }

  return [...categories].sort();
}

function getRecurringReasoningPatterns(record = {}) {
  const patterns = new Set();
  if (record.daltonReview?.recurringReasoningPattern) patterns.add(record.daltonReview.recurringReasoningPattern);
  for (const blocker of asArray(record.investmentDecision?.blockers)) patterns.add(`blocker:${blocker}`);
  for (const caution of asArray(record.investmentDecision?.cautionReasons)) patterns.add(`caution:${caution}`);
  return [...patterns].sort();
}

function getImprovementCandidates(record = {}) {
  const candidates = new Set();
  const outcome = deriveValidationOutcome(record);
  const evidenceLevel = getEvidenceQualityLevel(record);

  if (outcome === 'false_positive') candidates.add('reduce_aggressiveness_for_dealer_rejected_opportunities');
  if (outcome === 'missed_opportunity') candidates.add('review_restrictive_posture_for_dealer_buy_opportunities');
  if (evidenceLevel === 'insufficient_shadow_valuation' || evidenceLevel === 'no_exact_sold_support') {
    candidates.add('improve_exact_sold_evidence_coverage');
  }
  if (asArray(record.investmentDecision?.cautionReasons).some((reason) => /liquidity|exit|hold/.test(reason))) {
    candidates.add('improve_exit_confidence_inputs');
  }
  if (asArray(record.investmentDecision?.cautionReasons).some((reason) => /concentration|allocation/.test(reason))) {
    candidates.add('improve_portfolio_context_inputs');
  }
  return [...candidates].sort();
}

function validateInvestmentValidationRecord(record = {}) {
  const errors = [];

  if (record.schemaVersion !== SCHEMA_VERSION) errors.push('schemaVersion must match investment validation schema.');
  if (!record.recordId) errors.push('recordId is required.');
  if (!record.listingId) errors.push('listingId is required.');
  if (!record.immutableSnapshot) errors.push('immutableSnapshot is required.');
  if (!record.productionSnapshot) errors.push('productionSnapshot is required.');
  if (!record.shadowSnapshot) errors.push('shadowSnapshot is required.');
  if (!record.investmentDecision) errors.push('investmentDecision is required.');
  if (!record.snapshotHash) errors.push('snapshotHash is required.');
  if (record.snapshotHash && fingerprint(record.immutableSnapshot) !== record.snapshotHash) {
    errors.push('snapshotHash does not match immutableSnapshot; historical validation data may have been modified.');
  }

  const decisionValidation = investmentContract.validateInvestmentDecisionOutput(record.investmentDecision || {});
  if (!decisionValidation.valid) {
    for (const reason of decisionValidation.reasons) errors.push(`investmentDecision:${reason}`);
  }

  if (!REVIEW_DECISIONS.includes(normalizeReviewDecision(record.daltonReview?.decision))) {
    errors.push('Dalton review decision is invalid.');
  }

  const confidence = record.daltonReview?.confidence;
  if (confidence !== null && confidence !== undefined && confidence !== '') {
    const number = toNumber(confidence, NaN);
    if (!Number.isFinite(number) || number < 0 || number > 100) {
      errors.push('Dalton review confidence must be 0-100 when provided.');
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

function extractSnapshots(batchOrSnapshots = {}) {
  if (Array.isArray(batchOrSnapshots)) return batchOrSnapshots;
  return asArray(batchOrSnapshots.snapshots || batchOrSnapshots.records || batchOrSnapshots.listings || batchOrSnapshots.items);
}

function buildInvestmentValidationBatch(snapshots = [], options = {}) {
  const records = snapshots.map((snapshot, index) => createInvestmentValidationRecord(snapshot, {
    index,
    capturedAt: options.capturedAt,
    recordId: snapshot.recordId
  }));

  return {
    schemaVersion: SCHEMA_VERSION,
    source: SOURCE,
    mode: 'offline_investment_decision_validation',
    batchId: options.batchId || 'investment-validation-batch',
    createdAt: options.createdAt || new Date().toISOString(),
    immutableSnapshots: true,
    records
  };
}

function getReviewedRecords(records = []) {
  return records.filter((record) => !['UNREVIEWED', 'UNCERTAIN'].includes(normalizeReviewDecision(record.daltonReview?.decision)));
}

function buildPostureAgreementSummary(records = []) {
  const summary = {};
  for (const posture of Object.values(investmentContract.INVESTMENT_POSTURES)) {
    summary[posture] = { total: 0, agreed: 0, disagreed: 0, outcomes: {} };
  }

  for (const record of records) {
    const posture = record.investmentDecision?.investmentPosture || 'unknown';
    summary[posture] ||= { total: 0, agreed: 0, disagreed: 0, outcomes: {} };
    summary[posture].total += 1;
    if (record.validation?.agreement === 'agreed') summary[posture].agreed += 1;
    if (record.validation?.agreement === 'disagreed') summary[posture].disagreed += 1;
    increment(summary[posture].outcomes, record.validation?.outcomeCategory || 'unknown');
  }

  return summary;
}

function buildStrategyLaneSummary(records = []) {
  const summary = {};

  for (const record of records) {
    const decision = asObject(record.investmentDecision);
    const selectedLane = getSelectedStrategyLane(decision);
    summary[selectedLane] ||= { total: 0, readiness: {}, outcomes: {}, selectedCount: 0 };
    summary[selectedLane].total += 1;
    summary[selectedLane].selectedCount += 1;
    increment(summary[selectedLane].outcomes, record.validation?.outcomeCategory || 'unknown');

    for (const lane of asArray(decision.strategyFit?.laneEvaluations)) {
      const laneName = lane.strategyLane || 'unknown';
      summary[laneName] ||= { total: 0, readiness: {}, outcomes: {}, selectedCount: 0 };
      increment(summary[laneName].readiness, lane.laneReadiness || 'unknown');
    }
  }

  return summary;
}

function buildEvidenceQualitySummary(records = []) {
  const summary = {};
  for (const record of records) {
    const level = getEvidenceQualityLevel(record);
    summary[level] ||= { total: 0, outcomes: {}, postures: {} };
    summary[level].total += 1;
    increment(summary[level].outcomes, record.validation?.outcomeCategory || 'unknown');
    increment(summary[level].postures, record.investmentDecision?.investmentPosture || 'unknown');
  }
  return summary;
}

function buildAggregateInvestmentMetrics(batchOrBatches = [], options = {}) {
  const batches = Array.isArray(batchOrBatches) ? batchOrBatches : [batchOrBatches];
  const records = batches.flatMap((batch) => {
    const data = batch.data || batch;
    const existingRecords = asArray(data.records);
    if (existingRecords.some((record) => record.investmentDecision && record.immutableSnapshot)) {
      return existingRecords;
    }
    return buildInvestmentValidationBatch(extractSnapshots(data), options).records;
  });
  const validations = records.map(validateInvestmentValidationRecord);
  const reviewed = getReviewedRecords(records);
  const outcomeCounts = {};
  const disagreementCategories = {};
  const recurringReasoningPatterns = {};
  const recommendationImprovementCandidates = {};
  const actualProfits = [];

  for (const record of records) {
    increment(outcomeCounts, record.validation?.outcomeCategory || deriveValidationOutcome(record));
    for (const category of asArray(record.validation?.disagreementCategories)) increment(disagreementCategories, category);
    for (const pattern of asArray(record.validation?.recurringReasoningPatterns)) increment(recurringReasoningPatterns, pattern);
    for (const candidate of asArray(record.validation?.improvementCandidates)) increment(recommendationImprovementCandidates, candidate);
    const netProfit = toNumber(record.actualOutcome?.netProfit, null);
    if (netProfit !== null) actualProfits.push(netProfit);
  }

  const agreed = reviewed.filter((record) => record.validation?.agreement === 'agreed').length;
  const falsePositiveCount = outcomeCounts.false_positive || 0;
  const missedOpportunityCount = outcomeCounts.missed_opportunity || 0;

  return {
    source: `${SOURCE}_report`,
    schemaVersion: SCHEMA_VERSION,
    generatedAt: options.generatedAt || new Date().toISOString(),
    totalListings: records.length,
    reviewedListings: reviewed.length,
    agreementCount: agreed,
    agreementRate: percent(agreed, reviewed.length),
    falsePositiveCount,
    falsePositiveRate: percent(falsePositiveCount, reviewed.length),
    missedOpportunityCount,
    missedOpportunityRate: percent(missedOpportunityCount, reviewed.length),
    outcomeCounts,
    postureAgreementSummary: buildPostureAgreementSummary(records),
    strategyLaneSummary: buildStrategyLaneSummary(records),
    evidenceQualitySummary: buildEvidenceQualitySummary(records),
    recurringDisagreementCategories: disagreementCategories,
    recurringReasoningPatterns,
    recommendationImprovementCandidates,
    actualOutcomeSummary: {
      completedOutcomeCount: actualProfits.length,
      averageNetProfit: average(actualProfits)
    },
    validationIntegrity: {
      invalidRecordCount: validations.filter((result) => !result.valid).length,
      invalidRecords: validations
        .map((result, index) => ({ recordId: records[index]?.recordId || `record-${index + 1}`, ...result }))
        .filter((result) => !result.valid)
    }
  };
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJsonFile(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function runInvestmentDecisionValidation(inputPaths = [], outputFile = null, options = {}) {
  const batches = asArray(inputPaths).map((inputPath) => buildInvestmentValidationBatch(extractSnapshots(readJsonFile(inputPath)), {
    ...options,
    batchId: path.basename(inputPath, path.extname(inputPath))
  }));
  const report = {
    source: `${SOURCE}_run`,
    schemaVersion: SCHEMA_VERSION,
    generatedAt: options.generatedAt || new Date().toISOString(),
    inputFiles: asArray(inputPaths).map((inputPath) => path.resolve(inputPath)),
    batches,
    aggregateMetrics: buildAggregateInvestmentMetrics(batches, options)
  };

  if (outputFile) writeJsonFile(outputFile, report);
  return report;
}

module.exports = {
  OUTCOME_CATEGORIES,
  REVIEW_DECISIONS,
  SCHEMA_VERSION,
  SOURCE,
  buildAggregateInvestmentMetrics,
  buildInvestmentValidationBatch,
  createInvestmentValidationRecord,
  deriveValidationOutcome,
  fingerprint,
  normalizeOutcomeCategory,
  normalizeReviewDecision,
  runInvestmentDecisionValidation,
  validateInvestmentValidationRecord,
  writeJsonFile
};
