'use strict';

const fs = require('node:fs');
const path = require('node:path');

const canonicalIdentityEngine = require('../engines/canonicalIdentityEngine');
const legacyIdentityAdapter = require('../engines/legacyIdentityAdapter');
const shadowValuationEngine = require('../engines/shadowValuationEngine');
const {
  evaluateCanonicalSoldComparisons
} = require('../services/canonicalSoldComparisonService');
const {
  querySoldEvidence
} = require('../services/soldEvidenceService');
const {
  createEmptySoldEvidenceStore,
  loadSoldEvidenceStore
} = require('../utils/soldEvidenceStore');

const REPORT_SCHEMA_VERSION = '1.0.0';
const SOURCE = 'real_listing_shadow_validation';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function clone(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function roundPercent(value) {
  return Math.round(toNumber(value, 0) * 100) / 100;
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function extractListings(payload = {}) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];

  for (const key of ['listings', 'records', 'snapshots', 'items']) {
    if (Array.isArray(payload[key])) return payload[key];
  }

  return [];
}

function loadListings(options = {}) {
  if (options.input !== undefined) return extractListings(options.input);
  if (options.inputPath) return extractListings(readJsonFile(options.inputPath));
  return [];
}

function loadStore(options = {}) {
  if (options.soldEvidenceStore) return options.soldEvidenceStore;
  if (options.store) return options.store;
  if (options.soldEvidenceStorePath) return loadSoldEvidenceStore(options.soldEvidenceStorePath);
  if (options.storePath) return loadSoldEvidenceStore(options.storePath);
  return createEmptySoldEvidenceStore();
}

function getClock(options = {}) {
  if (typeof options.now === 'function') return options.now;
  if (options.now) return () => options.now;
  return () => new Date().toISOString();
}

function getListingId(listing = {}, index = 0) {
  return String(
    listing.ebayItemId ||
    listing.marketplaceItemId ||
    listing.itemId ||
    listing.id ||
    `listing-${index + 1}`
  );
}

function getDealGateDecision(listing = {}) {
  const dealGate = asObject(listing.dealGate);
  const display = asObject(listing.display);

  return {
    passed: dealGate.passed === true,
    buyNowAllowed: dealGate.buyNowAllowed === true,
    decision: dealGate.decision || display.authoritativeDecision || display.primaryDecisionLabel || '',
    reasons: asArray(dealGate.reasons),
    positives: asArray(dealGate.positives),
    authoritativeDecision: display.authoritativeDecision || dealGate.decision || ''
  };
}

function getProductionValuation(listing = {}) {
  const marketData = asObject(listing.marketData);
  return {
    estimatedValue: listing.estimatedValue ?? listing.marketValue ?? marketData.marketValue ?? null,
    marketValue: listing.marketValue ?? marketData.marketValue ?? listing.estimatedValue ?? null,
    estimatedProfit: listing.estimatedProfit ?? null,
    roi: listing.roi ?? asObject(listing.roiData).roi ?? null,
    valuationConfidence: marketData.confidence ?? listing.valuationConfidence ?? null,
    marketContextConfidence: listing.marketConfidence ?? null
  };
}

function buildCanonicalIdentity(listing = {}) {
  if (listing.canonicalIdentity?.canonicalIdentityKey) {
    return clone(listing.canonicalIdentity);
  }

  const diagnostics = legacyIdentityAdapter.buildLegacyIdentityDiagnostics(listing);
  return diagnostics.canonicalIdentity;
}

function summarizeCanonicalIdentity(identity = {}) {
  return {
    canonicalIdentityKey: identity.canonicalIdentityKey || '',
    identityType: identity.identityType || 'unknown',
    exactCompEligible: identity.eligibility?.exactCompEligible === true,
    valuationEligible: identity.eligibility?.valuationEligible === true,
    manualReviewRequired: identity.eligibility?.manualReviewRequired !== false,
    contextOnly: identity.eligibility?.contextOnly !== false,
    overallIdentityConfidence: identity.overallIdentityConfidence || 0,
    unknownFields: asArray(identity.unknownFields),
    normalizationWarnings: asArray(identity.normalizationWarnings),
    summary: canonicalIdentityEngine.summarizeCanonicalIdentity(identity)
  };
}

function getSnapshotSoldEvidence(listing = {}) {
  const evidence = listing.canonicalSoldEvidence || listing.shadowCanonicalSoldEvidence || {};
  if (Array.isArray(evidence)) return evidence;
  return asArray(evidence.records || evidence.matchingRecords);
}

function loadMatchingSoldEvidence(listing = {}, canonicalIdentity = {}, store = {}, options = {}) {
  const snapshotRecords = getSnapshotSoldEvidence(listing);
  if (snapshotRecords.length) {
    return {
      source: 'listing_snapshot',
      canonicalCardKey: listing.canonicalSoldEvidence?.canonicalCardKey || canonicalIdentity.canonicalIdentityKey || '',
      records: snapshotRecords,
      querySummary: {
        storeLoaded: Boolean(store),
        storeRecordCount: Object.keys(asObject(store.records)).length,
        snapshotRecordCount: snapshotRecords.length,
        trueSoldCount: snapshotRecords.filter((record) => record.evidenceType === 'true_sold').length
      }
    };
  }

  const identityForStore = listing.parsed || listing.parsedIdentity || listing.identity || {};
  const query = querySoldEvidence(store, identityForStore, { trueSoldOnly: false }, {
    asOf: options.asOf || options.generatedAt || options.now
  });

  return {
    source: 'canonical_sold_evidence_store',
    canonicalCardKey: query.canonicalCardKey,
    records: asArray(query.records),
    querySummary: {
      storeLoaded: Boolean(store),
      storeRecordCount: Object.keys(asObject(store.records)).length,
      trueSoldCount: query.trueSoldCount || 0,
      recentSoldCount: query.recentSoldCount || 0,
      staleCount: query.staleCount || 0,
      freshCount: query.freshCount || 0,
      sourceMix: query.sourceMix || {}
    }
  };
}

function buildShadowSoldComparison(canonicalIdentity = {}, soldEvidence = {}, options = {}) {
  const result = evaluateCanonicalSoldComparisons(canonicalIdentity, asArray(soldEvidence.records), {
    asOf: options.asOf || options.generatedAt || options.now
  });

  return {
    comparisonPerformed: asArray(soldEvidence.records).length > 0,
    comparisonSource: result.source,
    canonicalIdentityKey: canonicalIdentity.canonicalIdentityKey || '',
    acceptedExactMatches: result.acceptedExactMatches,
    contextualMatches: result.contextualMatches,
    rejectedMatches: result.rejectedMatches,
    staleMatches: result.staleMatches,
    insufficientIdentityMatches: result.insufficientIdentityMatches,
    comparisonSummary: result.summary,
    confidenceSummary: result.confidenceSummary,
    mismatchSummary: result.identityMismatchStatistics,
    rejectionStatistics: result.rejectionStatistics,
    processingSummary: result.processingSummary,
    productionImpact: 'none',
    decisionImpact: 'none'
  };
}

function buildShadowValuation(canonicalIdentity = {}, comparison = {}, soldEvidence = {}, options = {}) {
  const result = shadowValuationEngine.evaluateShadowValuation({
    canonicalIdentity,
    canonicalSoldComparisonResults: comparison,
    canonicalSoldEvidenceRecords: asArray(soldEvidence.records),
    asOf: options.asOf || options.generatedAt || options.now
  });

  return {
    valuationPerformed: result.insufficientEvidence !== true,
    valuationSource: result.source,
    canonicalIdentityKey: result.canonicalIdentityKey || canonicalIdentity.canonicalIdentityKey || '',
    fairMarketRange: result.fairMarketRange,
    recommendedMarketValue: result.recommendedMarketValue,
    valuationConfidence: result.valuationConfidence,
    evidenceSummary: result.evidenceSummary,
    marketTrendSummary: result.marketTrendSummary,
    valuationDiagnostics: result.valuationDiagnostics,
    insufficientEvidence: result.insufficientEvidence === true,
    insufficientEvidenceReason: result.insufficientEvidenceReason || '',
    summary: result.summary,
    productionImpact: 'none',
    decisionImpact: 'none'
  };
}

function compareProductionToShadow(production = {}, shadowValuation = {}, dealGate = {}) {
  const productionValue = toNumber(production.estimatedValue ?? production.marketValue, NaN);
  const shadowValue = toNumber(shadowValuation.recommendedMarketValue, NaN);
  const shadowAvailable = Number.isFinite(shadowValue) && shadowValue > 0;
  const productionAvailable = Number.isFinite(productionValue) && productionValue > 0;
  const reasons = [];
  let valueDifference = null;
  let percentageDifference = null;
  let valuationAgreement = 'not_evaluated';

  if (productionAvailable && shadowAvailable) {
    valueDifference = Math.round((shadowValue - productionValue) * 100) / 100;
    percentageDifference = productionValue > 0 ? roundPercent((valueDifference / productionValue) * 100) : null;
    valuationAgreement = Math.abs(percentageDifference) <= 20 ? 'aligned' : 'disagree';
    if (valuationAgreement === 'disagree') reasons.push('valuation_difference_exceeds_20_percent');
  } else if (!shadowAvailable) {
    valuationAgreement = 'shadow_unavailable';
    reasons.push(shadowValuation.insufficientEvidenceReason || 'shadow_valuation_unavailable');
  } else if (!productionAvailable) {
    valuationAgreement = 'production_unavailable';
    reasons.push('production_valuation_unavailable');
  }

  const productionDecision = dealGate.passed ? 'buy_eligible' : 'rejected';
  const shadowEvidenceState = shadowValuation.insufficientEvidence ? 'insufficient_evidence' : 'sufficient_evidence';
  let overallAgreement = 'not_evaluated';

  if (dealGate.passed && shadowValuation.insufficientEvidence) {
    overallAgreement = 'disagree';
    reasons.push('production_passed_but_shadow_insufficient');
  } else if (!dealGate.passed && shadowValuation.insufficientEvidence) {
    overallAgreement = 'aligned';
  } else if (valuationAgreement === 'aligned' || valuationAgreement === 'not_evaluated') {
    overallAgreement = 'aligned';
  } else if (valuationAgreement === 'disagree') {
    overallAgreement = 'disagree';
  }

  return {
    overallAgreement,
    valuationAgreement,
    productionDecision,
    shadowEvidenceState,
    productionEstimatedValue: productionAvailable ? productionValue : null,
    shadowRecommendedValue: shadowAvailable ? shadowValue : null,
    absoluteValueDifference: valueDifference,
    percentageDifference,
    disagreementReasons: [...new Set(reasons)]
  };
}

function summarizeMissingEvidence(canonicalIdentity = {}, soldEvidence = {}, comparison = {}, shadowValuation = {}) {
  const reasons = [];
  const records = asArray(soldEvidence.records);

  if (!canonicalIdentity.canonicalIdentityKey || canonicalIdentity.identityType === 'unknown') reasons.push('canonical_identity_missing');
  if (canonicalIdentity.eligibility?.exactCompEligible !== true) reasons.push('identity_not_exact_comp_eligible');
  if (!records.length) reasons.push('no_canonical_sold_evidence_records');
  if (records.length && !asArray(comparison.acceptedExactMatches).length) reasons.push('no_exact_canonical_sold_matches');
  if (shadowValuation.insufficientEvidence) reasons.push(shadowValuation.insufficientEvidenceReason || 'shadow_valuation_insufficient');

  return {
    hasMissingEvidence: reasons.length > 0,
    reasons: [...new Set(reasons)],
    availableCanonicalRecords: records.length,
    exactMatchCount: asArray(comparison.acceptedExactMatches).length,
    contextualMatchCount: asArray(comparison.contextualMatches).length,
    rejectedMatchCount: asArray(comparison.rejectedMatches).length,
    staleMatchCount: asArray(comparison.staleMatches).length
  };
}

function recommendFollowUp({ missingEvidence = {}, agreement = {}, canonicalIdentitySummary = {} } = {}) {
  if (canonicalIdentitySummary.manualReviewRequired) return 'review_identity_before_valuation';
  if (missingEvidence.reasons?.includes('no_canonical_sold_evidence_records')) return 'import_verified_sold_evidence';
  if (missingEvidence.reasons?.includes('no_exact_canonical_sold_matches')) return 'review_canonical_sold_match_rejections';
  if (agreement.overallAgreement === 'disagree') return 'manual_review_production_shadow_disagreement';
  if (!missingEvidence.hasMissingEvidence) return 'ready_for_dalton_review';
  return 'manual_review_required';
}

function createDaltonReviewPlaceholder() {
  return {
    judgment: 'unreviewed',
    expectedFairValue: null,
    confidenceInJudgment: null,
    agreementDisagreementReason: '',
    notes: '',
    reviewedAt: null
  };
}

function buildListingValidationReport(listing = {}, context = {}) {
  const canonicalIdentity = buildCanonicalIdentity(listing);
  const canonicalIdentitySummary = summarizeCanonicalIdentity(canonicalIdentity);
  const soldEvidence = loadMatchingSoldEvidence(listing, canonicalIdentity, context.store, context);
  const shadowSoldComparison = buildShadowSoldComparison(canonicalIdentity, soldEvidence, context);
  const shadowValuation = buildShadowValuation(canonicalIdentity, shadowSoldComparison, soldEvidence, context);
  const productionValuation = getProductionValuation(listing);
  const dealGateDecision = getDealGateDecision(listing);
  const agreementSummary = compareProductionToShadow(productionValuation, shadowValuation, dealGateDecision);
  const missingEvidenceSummary = summarizeMissingEvidence(canonicalIdentity, soldEvidence, shadowSoldComparison, shadowValuation);

  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    source: SOURCE,
    listingId: getListingId(listing, context.index || 0),
    generatedAt: context.generatedAt,
    productionImpact: 'none',
    decisionImpact: 'none',
    listingIdentity: {
      title: listing.title || listing.rawTitle || '',
      url: listing.url || listing.itemWebUrl || '',
      marketplace: listing.marketplace || listing.sourceMarketplace || 'unknown',
      parsed: clone(listing.parsed || listing.parsedIdentity || listing.identity || {}),
      canonicalIdentityKey: canonicalIdentity.canonicalIdentityKey || ''
    },
    productionOutputs: clone(listing),
    productionValuation,
    shadowValuation,
    dealGateDecision,
    shadowSoldComparisonSummary: {
      comparisonPerformed: shadowSoldComparison.comparisonPerformed,
      comparisonSource: shadowSoldComparison.comparisonSource,
      acceptedExactMatchCount: asArray(shadowSoldComparison.acceptedExactMatches).length,
      contextualMatchCount: asArray(shadowSoldComparison.contextualMatches).length,
      rejectedMatchCount: asArray(shadowSoldComparison.rejectedMatches).length,
      staleMatchCount: asArray(shadowSoldComparison.staleMatches).length,
      insufficientIdentityMatchCount: asArray(shadowSoldComparison.insufficientIdentityMatches).length,
      comparisonSummary: shadowSoldComparison.comparisonSummary,
      confidenceSummary: shadowSoldComparison.confidenceSummary,
      mismatchSummary: shadowSoldComparison.mismatchSummary,
      rejectionStatistics: shadowSoldComparison.rejectionStatistics,
      processingSummary: shadowSoldComparison.processingSummary
    },
    canonicalIdentitySummary,
    daltonReview: createDaltonReviewPlaceholder(),
    agreementSummary,
    missingEvidenceSummary,
    recommendedFollowUpAction: recommendFollowUp({
      missingEvidence: missingEvidenceSummary,
      agreement: agreementSummary,
      canonicalIdentitySummary
    })
  };
}

function countBy(values = []) {
  return values.reduce((counts, value) => {
    const key = value || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function buildAggregateMetrics(listingReports = []) {
  const totalListings = listingReports.length;
  const sufficient = listingReports.filter((report) => report.shadowValuation.insufficientEvidence !== true).length;
  const insufficient = totalListings - sufficient;
  const agreementEligible = listingReports.filter((report) => report.agreementSummary.overallAgreement !== 'not_evaluated');
  const aligned = agreementEligible.filter((report) => report.agreementSummary.overallAgreement === 'aligned').length;
  const disagreementReasons = listingReports.flatMap((report) => asArray(report.agreementSummary.disagreementReasons));
  const missingReasons = listingReports.flatMap((report) => asArray(report.missingEvidenceSummary.reasons));
  const identityIssues = listingReports
    .filter((report) => report.canonicalIdentitySummary.manualReviewRequired)
    .map((report) => report.listingId);

  return {
    totalListings,
    listingsWithSufficientEvidence: sufficient,
    listingsWithInsufficientEvidence: insufficient,
    productionShadowAgreementRate: agreementEligible.length
      ? roundPercent((aligned / agreementEligible.length) * 100)
      : 0,
    commonDisagreementReasons: countBy(disagreementReasons),
    identityIssues: {
      count: identityIssues.length,
      listingIds: identityIssues
    },
    evidenceGaps: countBy(missingReasons),
    manualReviewRequiredCount: listingReports.filter((report) => (
      report.recommendedFollowUpAction !== 'ready_for_dalton_review'
    )).length
  };
}

function runRealListingShadowValidation(options = {}) {
  const now = getClock(options);
  const generatedAt = now();
  const listings = loadListings(options);
  const store = loadStore(options);
  const listingReports = listings.map((listing, index) => buildListingValidationReport(listing, {
    ...options,
    index,
    store,
    generatedAt,
    now: generatedAt
  }));
  const report = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    source: SOURCE,
    generatedAt,
    productionImpact: 'none',
    decisionImpact: 'none',
    aggregateMetrics: buildAggregateMetrics(listingReports),
    listingReports
  };

  if (options.outPath) {
    fs.mkdirSync(path.dirname(options.outPath), { recursive: true });
    fs.writeFileSync(options.outPath, `${JSON.stringify(report, null, 2)}\n`);
  }

  return report;
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--input') {
      args.inputPath = argv[index + 1];
      index += 1;
    } else if (arg === '--store') {
      args.storePath = argv[index + 1];
      index += 1;
    } else if (arg === '--out') {
      args.outPath = argv[index + 1];
      index += 1;
    } else if (arg === '--as-of') {
      args.asOf = argv[index + 1];
      index += 1;
    }
  }

  return args;
}

function runCli(argv = process.argv.slice(2)) {
  const report = runRealListingShadowValidation(parseArgs(argv));
  const summary = {
    source: report.source,
    generatedAt: report.generatedAt,
    aggregateMetrics: report.aggregateMetrics
  };
  console.log(JSON.stringify(summary, null, 2));
  return report;
}

if (require.main === module) {
  runCli();
}

module.exports = {
  REPORT_SCHEMA_VERSION,
  SOURCE,
  buildAggregateMetrics,
  buildListingValidationReport,
  buildShadowSoldComparison,
  buildShadowValuation,
  compareProductionToShadow,
  extractListings,
  loadMatchingSoldEvidence,
  parseArgs,
  recommendFollowUp,
  runCli,
  runRealListingShadowValidation,
  summarizeMissingEvidence
};
