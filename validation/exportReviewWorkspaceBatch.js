'use strict';

const fs = require('node:fs');
const path = require('node:path');

const capitalScoreExplanationEngine = require('../engines/capitalScoreExplanationEngine');
const investmentDecisionEngine = require('../engines/investmentDecisionEngine');
const legacyIdentityAdapter = require('../engines/legacyIdentityAdapter');
const reviewWorkspaceContract = require('./reviewWorkspaceContract');
const validationCandidateSelector = require('./validationCandidateSelector');
const {
  buildShadowSoldComparison,
  buildShadowValuation,
  extractListings: extractShadowListings
} = require('./runRealListingShadowValidation');

const SCHEMA_VERSION = '1.0.0';
const SOURCE = 'review_workspace_batch_exporter';
const EXPORT_MODES = Object.freeze({
  ALL_LISTINGS: 'all_listings',
  LEARNING_PRIORITY: 'learning_priority'
});
const DEFAULT_LEARNING_PRIORITY_COUNT = 25;

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

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJsonFile(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function extractListings(payload = {}) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  for (const key of ['listings', 'records', 'snapshots', 'items', 'results']) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  return extractShadowListings(payload);
}

function loadListings(options = {}) {
  if (options.input !== undefined) return extractListings(options.input);
  if (options.inputPath) return extractListings(readJsonFile(options.inputPath));
  return [];
}

function getListingId(listing = {}, index = 0) {
  const input = asObject(listing.investmentDecisionInput || listing.input);
  const snapshot = asObject(listing.listingSnapshot || listing.listing || input.listingSnapshot || listing);
  return String(
    snapshot.ebayItemId ||
    snapshot.marketplaceItemId ||
    snapshot.itemId ||
    snapshot.listingId ||
    snapshot.id ||
    listing.recordId ||
    `review-export-listing-${index + 1}`
  );
}

function dedupeListings(listings = []) {
  const seen = new Set();
  const uniqueListings = [];
  let duplicateListingsRemoved = 0;

  asArray(listings).forEach((listing, index) => {
    const listingId = getListingId(listing, index);
    if (seen.has(listingId)) {
      duplicateListingsRemoved += 1;
      return;
    }
    seen.add(listingId);
    uniqueListings.push(listing);
  });

  return {
    uniqueListings,
    duplicateListingsRemoved
  };
}

function getProductionValuation(listing = {}) {
  const marketData = asObject(listing.marketData);
  const roiData = asObject(listing.roiData);
  return {
    estimatedValue: listing.estimatedValue ?? listing.marketValue ?? marketData.marketValue ?? null,
    marketValue: listing.marketValue ?? marketData.marketValue ?? listing.estimatedValue ?? null,
    estimatedProfit: listing.estimatedProfit ?? null,
    roi: listing.roi ?? roiData.roi ?? null,
    valuationConfidence: marketData.confidence ?? listing.valuationConfidence ?? null,
    marketContextConfidence: listing.marketConfidence ?? null
  };
}

function getProductionDecisionExplanation(listing = {}) {
  const display = asObject(listing.display);
  return display.productionDecisionExplanation || listing.productionDecisionExplanation || listing.dealGate?.dealGateBreakdown || {};
}

function getFinancialContext(listing = {}, productionValuation = {}) {
  return {
    totalCost: listing.totalCost ?? listing.allInCost ?? listing.price ?? listing.askingPrice ?? null,
    askingPrice: listing.askingPrice ?? listing.price ?? null,
    maximumBuyPrice: listing.maximumBuyPrice ?? listing.financialContext?.maximumBuyPrice ?? null,
    suggestedOffer: listing.suggestedOffer ?? listing.financialContext?.suggestedOffer ?? null,
    expectedNetProfit: listing.expectedNetProfit ?? listing.estimatedProfit ?? productionValuation.estimatedProfit ?? null,
    roi: listing.roi ?? productionValuation.roi ?? null,
    liquidity: listing.financialContext?.liquidity ?? listing.marketIntelligence?.liquidity?.liquidityLevel ?? listing.marketIntelligenceData?.liquidity?.liquidityLevel ?? '',
    expectedHoldDays: listing.financialContext?.expectedHoldDays ?? null,
    exitConfidence: listing.financialContext?.exitConfidence ?? ''
  };
}

function getCanonicalIdentity(listing = {}, input = {}) {
  if (listing.canonicalIdentity?.canonicalIdentityKey) return clone(listing.canonicalIdentity);
  if (input.canonicalIdentity?.canonicalIdentityKey) return clone(input.canonicalIdentity);
  return legacyIdentityAdapter.buildLegacyIdentityDiagnostics(listing).canonicalIdentity;
}

function getCanonicalSoldEvidence(listing = {}, input = {}) {
  const evidence = listing.canonicalSoldEvidence || listing.shadowCanonicalSoldEvidence || input.canonicalSoldEvidence || {};
  if (Array.isArray(evidence)) {
    return {
      trueSoldCount: evidence.filter((record) => record.evidenceType === 'true_sold').length,
      recentSoldCount: 0,
      records: clone(evidence)
    };
  }
  return clone(evidence);
}

function getSoldEvidenceRecords(canonicalSoldEvidence = {}) {
  if (Array.isArray(canonicalSoldEvidence)) return canonicalSoldEvidence;
  return asArray(canonicalSoldEvidence.records || canonicalSoldEvidence.matchingRecords);
}

function getShadowSoldComparison(listing = {}, canonicalIdentity = {}, canonicalSoldEvidence = {}, input = {}, options = {}) {
  if (listing.shadowSoldComparison) return clone(listing.shadowSoldComparison);
  if (input.shadowSoldComparison) return clone(input.shadowSoldComparison);

  const records = getSoldEvidenceRecords(canonicalSoldEvidence);
  if (!canonicalIdentity?.canonicalIdentityKey || !records.length) return null;
  return buildShadowSoldComparison(canonicalIdentity, { records }, options);
}

function getShadowValuation(listing = {}, canonicalIdentity = {}, shadowSoldComparison = {}, canonicalSoldEvidence = {}, input = {}, options = {}) {
  if (listing.shadowValuation) return clone(listing.shadowValuation);
  if (input.shadowValuation) return clone(input.shadowValuation);

  const records = getSoldEvidenceRecords(canonicalSoldEvidence);
  if (!canonicalIdentity?.canonicalIdentityKey || !shadowSoldComparison || !records.length) return null;
  return buildShadowValuation(canonicalIdentity, shadowSoldComparison, { records }, options);
}

function buildInvestmentInput(listing = {}, options = {}) {
  const existingInput = asObject(listing.investmentDecisionInput || listing.input);
  const productionValuation = clone(existingInput.productionValuation || getProductionValuation(listing));
  const canonicalIdentity = getCanonicalIdentity(listing, existingInput);
  const canonicalSoldEvidence = getCanonicalSoldEvidence(listing, existingInput);
  const shadowSoldComparison = getShadowSoldComparison(listing, canonicalIdentity, canonicalSoldEvidence, existingInput, options);
  const shadowValuation = getShadowValuation(listing, canonicalIdentity, shadowSoldComparison, canonicalSoldEvidence, existingInput, options);
  const listingSnapshot = clone(existingInput.listingSnapshot || listing.listingSnapshot || listing.listing || listing);

  return {
    listingSnapshot,
    dealGate: clone(existingInput.dealGate || listing.dealGate || {}),
    productionValuation,
    productionDecisionExplanation: clone(existingInput.productionDecisionExplanation || getProductionDecisionExplanation(listing)),
    canonicalIdentity,
    canonicalSoldEvidence,
    shadowSoldComparison,
    shadowValuation,
    marketIntelligence: clone(existingInput.marketIntelligence || listing.marketIntelligence || listing.marketIntelligenceData || {}),
    confidenceBreakdown: clone(existingInput.confidenceBreakdown || listing.confidenceBreakdown || listing.display?.confidenceBreakdown || {}),
    financialContext: clone(existingInput.financialContext || getFinancialContext(listing, productionValuation)),
    portfolioContext: clone(existingInput.portfolioContext || listing.portfolioContext || {}),
    strategyProfile: clone(existingInput.strategyProfile || listing.strategyProfile || {}),
    competingOpportunities: clone(existingInput.competingOpportunities || listing.competingOpportunities || [])
  };
}

function getMissingDataDiagnostics(input = {}, artifacts = {}) {
  const missing = [];
  const warnings = [];

  for (const [field, value] of Object.entries({
    dealGate: input.dealGate,
    productionValuation: input.productionValuation,
    canonicalIdentity: input.canonicalIdentity,
    canonicalSoldEvidence: input.canonicalSoldEvidence,
    shadowSoldComparison: input.shadowSoldComparison,
    shadowValuation: input.shadowValuation,
    investmentDecision: artifacts.investmentDecision,
    validationCandidate: artifacts.validationCandidate,
    capitalScoreExplanation: artifacts.capitalScoreExplanation
  })) {
    if (value === null || value === undefined || (typeof value === 'object' && !Array.isArray(value) && !Object.keys(value).length)) {
      missing.push(field);
    }
  }

  if (!input.shadowSoldComparison) warnings.push('shadow_sold_comparison_unavailable');
  if (!input.shadowValuation) warnings.push('shadow_valuation_unavailable');
  if (!input.canonicalIdentity?.canonicalIdentityKey) warnings.push('canonical_identity_unavailable_or_incomplete');

  return {
    missing,
    warnings
  };
}

function enrichListingForReviewWorkspace(listing = {}, options = {}) {
  const input = buildInvestmentInput(listing, options);
  const investmentDecision = listing.investmentDecision || investmentDecisionEngine.evaluateInvestmentDecision(input);
  const capitalScore = capitalScoreExplanationEngine.explainCapitalScore({
    ...input,
    investmentDecision
  });
  const validationCandidate = listing.validationCandidate || validationCandidateSelector.evaluateValidationCandidate({
    recordId: getListingId(listing, options.index || 0),
    investmentDecisionInput: input,
    investmentDecision
  }, options);
  const missingDataDiagnostics = getMissingDataDiagnostics(input, {
    investmentDecision,
    validationCandidate,
    capitalScoreExplanation: capitalScore.capitalScoreExplanation
  });

  return {
    recordId: getListingId(listing, options.index || 0),
    capturedAt: listing.capturedAt || options.createdAt || 'not_provided',
    investmentDecisionInput: input,
    investmentDecision,
    capitalScoreExplanation: capitalScore,
    validationCandidate,
    productionOutputs: {
      dealGate: clone(input.dealGate),
      productionValuation: clone(input.productionValuation),
      productionDecisionExplanation: clone(input.productionDecisionExplanation),
      marketIntelligence: clone(input.marketIntelligence),
      confidenceBreakdown: clone(input.confidenceBreakdown),
      financialContext: clone(input.financialContext),
      rawProductionOutputs: clone(listing.productionOutputs || listing.cardhawkSnapshot || null)
    },
    shadowOutputs: {
      canonicalIdentity: clone(input.canonicalIdentity),
      canonicalSoldEvidence: clone(input.canonicalSoldEvidence),
      shadowSoldComparison: clone(input.shadowSoldComparison),
      shadowValuation: clone(input.shadowValuation),
      rawShadowOutputs: clone(listing.shadowOutputs || null)
    },
    canonicalIdentity: clone(input.canonicalIdentity),
    canonicalSoldEvidence: clone(input.canonicalSoldEvidence),
    shadowSoldComparison: clone(input.shadowSoldComparison),
    shadowValuation: clone(input.shadowValuation),
    daltonReview: clone(listing.daltonReview || {}),
    actualOutcome: clone(listing.actualOutcome || listing.outcome || {}),
    missingDataDiagnostics
  };
}

function addBaselineCandidates(selected = [], ranked = [], count = DEFAULT_LEARNING_PRIORITY_COUNT) {
  if (!ranked.length || selected.length >= ranked.length) return selected;
  const baseline = ranked.find((entry) => entry.candidate.candidateCategory === 'learning_opportunity');
  if (!baseline || selected.some((entry) => entry.listingId === baseline.listingId)) return selected;

  if (selected.length < count) {
    return [...selected, baseline];
  }
  return [...selected.slice(0, Math.max(0, count - 1)), baseline];
}

function selectListings(listings = [], options = {}) {
  const mode = options.selectionMode || options.mode || EXPORT_MODES.LEARNING_PRIORITY;
  const requestedCount = mode === EXPORT_MODES.LEARNING_PRIORITY
    ? toNumber(options.requestedCount ?? options.limit, DEFAULT_LEARNING_PRIORITY_COUNT)
    : listings.length;
  const enriched = asArray(listings).map((listing, index) => enrichListingForReviewWorkspace(listing, {
    ...options,
    index
  }));

  if (mode === EXPORT_MODES.ALL_LISTINGS) {
    return {
      mode,
      requestedCount: enriched.length,
      selected: enriched.map((snapshot) => ({
        listingId: snapshot.recordId,
        snapshot,
        candidate: snapshot.validationCandidate
      }))
    };
  }

  const ranked = enriched
    .map((snapshot) => ({
      listingId: snapshot.recordId,
      snapshot,
      candidate: snapshot.validationCandidate
    }))
    .sort((a, b) => (
      b.candidate.learningPriority - a.candidate.learningPriority ||
      a.candidate.candidateCategory.localeCompare(b.candidate.candidateCategory) ||
      a.listingId.localeCompare(b.listingId)
    ));
  const initial = ranked.slice(0, Math.max(0, requestedCount));
  const selected = addBaselineCandidates(initial, ranked, requestedCount);

  return {
    mode,
    requestedCount,
    selected
  };
}

function summarizeSelection(selected = [], uniqueListings = []) {
  const categoryBreakdown = {};
  const learningPriorityBreakdown = {
    urgent: 0,
    high: 0,
    medium: 0,
    low: 0
  };

  selected.forEach(({ candidate }) => {
    const category = candidate.candidateCategory || 'unknown';
    categoryBreakdown[category] = (categoryBreakdown[category] || 0) + 1;
    const priority = candidate.reviewPriority || 'low';
    learningPriorityBreakdown[priority] = (learningPriorityBreakdown[priority] || 0) + 1;
  });

  return {
    selectionSummary: {
      highestLearningPriority: selected[0]?.candidate.learningPriority ?? 0,
      lowestLearningPriority: selected[selected.length - 1]?.candidate.learningPriority ?? 0,
      baselineIncluded: selected.some(({ candidate }) => candidate.candidateCategory === 'learning_opportunity'),
      unselectedListingCount: Math.max(0, uniqueListings.length - selected.length)
    },
    categoryBreakdown,
    learningPriorityBreakdown
  };
}

function buildReviewWorkspaceBatchExport(options = {}) {
  const rawListings = loadListings(options);
  const { uniqueListings, duplicateListingsRemoved } = dedupeListings(rawListings);
  const selection = selectListings(uniqueListings, options);
  const reviewWorkspaces = selection.selected.map(({ snapshot }, index) => reviewWorkspaceContract.createReviewWorkspace(snapshot, {
    ...options,
    index,
    generatedAt: options.createdAt || options.generatedAt || 'not_provided'
  }));
  const summaries = summarizeSelection(selection.selected, uniqueListings);
  const batchCore = {
    schemaVersion: SCHEMA_VERSION,
    source: options.source || SOURCE,
    batchId: options.batchId || 'review-workspace-export',
    createdAt: options.createdAt || options.generatedAt || 'not_provided',
    includeReviewed: options.includeReviewed === true,
    selectionMode: selection.mode,
    requestedCount: selection.requestedCount,
    availableListingCount: rawListings.length,
    uniqueListingCount: uniqueListings.length,
    selectedListingCount: reviewWorkspaces.length,
    duplicateListingsRemoved,
    ...summaries,
    reviewWorkspaces,
    productionImpact: 'none',
    decisionImpact: 'none'
  };
  const batch = {
    ...batchCore,
    batchFingerprint: reviewWorkspaceContract.fingerprint(batchCore)
  };

  if (options.outPath || options.outputPath) {
    writeJsonFile(options.outPath || options.outputPath, batch);
  }

  return batch;
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--input') {
      args.inputPath = argv[index + 1];
      index += 1;
    } else if (arg === '--out') {
      args.outPath = argv[index + 1];
      index += 1;
    } else if (arg === '--mode') {
      args.selectionMode = argv[index + 1];
      index += 1;
    } else if (arg === '--count') {
      args.requestedCount = Number(argv[index + 1]);
      index += 1;
    } else if (arg === '--created-at') {
      args.createdAt = argv[index + 1];
      index += 1;
    } else if (arg === '--batch-id') {
      args.batchId = argv[index + 1];
      index += 1;
    }
  }
  return args;
}

function runCli(argv = process.argv.slice(2)) {
  const batch = buildReviewWorkspaceBatchExport(parseArgs(argv));
  console.log(JSON.stringify({
    source: batch.source,
    batchId: batch.batchId,
    selectionMode: batch.selectionMode,
    selectedListingCount: batch.selectedListingCount,
    duplicateListingsRemoved: batch.duplicateListingsRemoved,
    categoryBreakdown: batch.categoryBreakdown
  }, null, 2));
  return batch;
}

if (require.main === module) {
  runCli();
}

module.exports = {
  DEFAULT_LEARNING_PRIORITY_COUNT,
  EXPORT_MODES,
  SCHEMA_VERSION,
  SOURCE,
  buildReviewWorkspaceBatchExport,
  dedupeListings,
  enrichListingForReviewWorkspace,
  extractListings,
  loadListings,
  parseArgs,
  runCli,
  selectListings,
  writeJsonFile
};
