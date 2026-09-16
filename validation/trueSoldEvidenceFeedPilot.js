'use strict';

const soldEvidenceService = require('../services/soldEvidenceService');
const marketValueEngine = require('../engines/marketValueEngine');
const soldSalesEngine = require('../engines/soldSalesEngine');
const {
  buildCanonicalCardKey,
  createEmptySoldEvidenceStore
} = require('../utils/soldEvidenceStore');
const {
  importManualSoldEvidence
} = require('./manualSoldEvidenceImportHelper');

const SOURCE = 'true_sold_evidence_feed_pilot';
const VERSION = '1.0.0';

const SOURCE_CLASSIFICATION = Object.freeze({
  LIVE_APPROVED: 'LIVE + APPROVED',
  LIVE_NOT_APPROVED: 'LIVE BUT NOT APPROVED',
  MANUAL_APPROVED: 'MANUAL + APPROVED',
  FIXTURE_ONLY: 'FIXTURE ONLY',
  UNAVAILABLE: 'UNAVAILABLE',
  UNKNOWN: 'UNKNOWN'
});

const PILOT_STATUS = Object.freeze({
  READY: 'ready',
  READY_WITH_WARNINGS: 'ready_with_warnings',
  BLOCKED: 'blocked',
  INVALID: 'invalid'
});

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function buildSoldEvidenceSourceInventory() {
  return [
    {
      sourceId: 'manual_verified_import',
      classification: SOURCE_CLASSIFICATION.MANUAL_APPROVED,
      implementation: 'validation/manualSoldEvidenceImportHelper.js',
      approvalStatus: 'approved_for_owner_supplied_verified_transaction_records',
      reason: 'Uses manually supplied records with explicit provenance, review, sold price, sold date, identity, and canonical validation.',
      canProvideTrueSoldEvidence: true,
      networkAccess: false,
      productionAuthority: 'none'
    },
    {
      sourceId: 'manual_acquisition_adapter',
      classification: SOURCE_CLASSIFICATION.MANUAL_APPROVED,
      implementation: 'marketplaces/manualAcquisitionAdapter.js',
      approvalStatus: 'approved_for_manual_dataset_acquisition',
      reason: 'Canonical acquisition adapter for verified manual datasets; no live marketplace access.',
      canProvideTrueSoldEvidence: true,
      networkAccess: false,
      productionAuthority: 'none'
    },
    {
      sourceId: 'ebay_sold_acquisition_adapter',
      classification: SOURCE_CLASSIFICATION.FIXTURE_ONLY,
      implementation: 'marketplaces/ebayAcquisitionAdapter.js',
      approvalStatus: 'not_live_approved',
      reason: 'The adapter is an official skeleton or offline fixture-backed translator only; live sold acquisition is not implemented or approved.',
      canProvideTrueSoldEvidence: false,
      networkAccess: false,
      productionAuthority: 'none'
    },
    {
      sourceId: 'mock_sold_evidence_adapter',
      classification: SOURCE_CLASSIFICATION.FIXTURE_ONLY,
      implementation: 'marketplaces/mockSoldEvidenceAdapter.js',
      approvalStatus: 'fixture_only',
      reason: 'Test fixture adapter only; not real transaction evidence.',
      canProvideTrueSoldEvidence: false,
      networkAccess: false,
      productionAuthority: 'none'
    },
    {
      sourceId: 'ebay_browse_active_search',
      classification: SOURCE_CLASSIFICATION.UNAVAILABLE,
      implementation: 'marketplaces/ebayMarketplace.js',
      approvalStatus: 'active_listing_search_only',
      reason: 'Production eBay Browse search discovers active listings; active listings are prohibited from true-sold evidence.',
      canProvideTrueSoldEvidence: false,
      networkAccess: true,
      productionAuthority: 'none'
    },
    {
      sourceId: 'third_party_historical_market_sources',
      classification: SOURCE_CLASSIFICATION.UNKNOWN,
      implementation: 'data/canonical-source-evidence/*.json',
      approvalStatus: 'source_permission_unresolved',
      reason: 'Repository source packages document unresolved API/licensing/retention questions for external historical sales providers.',
      canProvideTrueSoldEvidence: false,
      networkAccess: false,
      productionAuthority: 'none'
    }
  ];
}

function getPreferredPilotSource() {
  return buildSoldEvidenceSourceInventory().find((source) => (
    source.classification === SOURCE_CLASSIFICATION.MANUAL_APPROVED &&
    source.canProvideTrueSoldEvidence === true
  ));
}

function getIdentityInput(listing = {}) {
  return listing.canonicalIdentity || listing.parsedIdentity || listing.identity || listing.parsed || listing;
}

function buildPilotIdentityScope(listing = {}) {
  const identity = getIdentityInput(listing);
  const canonicalCardKey = buildCanonicalCardKey(identity);

  return {
    canonicalCardKey,
    category: identity.category || identity.type || 'unknown',
    sport: identity.sport || identity.league || null,
    game: identity.game || identity.tcg || null,
    player: identity.player || identity.subject || identity.character || null,
    year: identity.year === undefined ? null : identity.year,
    brand: identity.brand || identity.manufacturer || null,
    product: identity.product || identity.productName || null,
    setName: identity.setName || identity.set || identity.cardSet || null,
    cardNumber: identity.cardNumber || identity.cardNo || identity.number || null,
    parallel: identity.parallel || identity.variation || identity.color || null,
    rawOrGraded: identity.gradeCompany || identity.grader || identity.condition || 'unknown',
    gradeCompany: identity.gradeCompany || identity.grader || identity.gradingCompany || null,
    grade: identity.grade || null,
    rookie: identity.rookie ?? identity.isRookie ?? null,
    autograph: identity.autograph ?? identity.auto ?? identity.isAutograph ?? null,
    memorabilia: identity.memorabilia ?? identity.relic ?? identity.patch ?? null,
    serialNumbered: identity.serialNumbered ?? identity.numbered ?? identity.isNumbered ?? null
  };
}

function normalizeRuntimeParsedText(value) {
  if (value === undefined || value === null) return value;
  return String(value).toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function buildRuntimeParsedIdentity(identity = {}, fallback = {}) {
  const parsed = {
    ...(fallback && typeof fallback === 'object' ? fallback : {}),
    ...(identity && typeof identity === 'object' ? identity : {})
  };
  const gradeCompany = parsed.gradeCompany || parsed.grader || fallback.gradeCompany || fallback.grader || null;
  const grade = parsed.grade || fallback.grade || null;

  return {
    ...parsed,
    category: normalizeRuntimeParsedText(parsed.category),
    sport: normalizeRuntimeParsedText(parsed.sport || parsed.league),
    game: normalizeRuntimeParsedText(parsed.game || parsed.tcg),
    player: normalizeRuntimeParsedText(parsed.player || parsed.subject || parsed.character),
    character: normalizeRuntimeParsedText(parsed.character),
    year: parsed.year === undefined || parsed.year === null ? parsed.year : String(parsed.year),
    brand: normalizeRuntimeParsedText(parsed.brand || parsed.manufacturer),
    product: normalizeRuntimeParsedText(parsed.product || parsed.productName),
    setName: normalizeRuntimeParsedText(parsed.setName || parsed.set || parsed.cardSet),
    cardNumber: parsed.cardNumber || parsed.cardNo || parsed.number,
    parallel: normalizeRuntimeParsedText(parsed.parallel || parsed.variation || parsed.color),
    variation: normalizeRuntimeParsedText(parsed.variation),
    gradeCompany,
    grade,
    flags: {
      ...(parsed.flags && typeof parsed.flags === 'object' ? parsed.flags : {}),
      rookie: Boolean(parsed.rookie ?? parsed.isRookie),
      autograph: Boolean(parsed.autograph ?? parsed.auto ?? parsed.isAutograph),
      graded: Boolean(gradeCompany && String(gradeCompany).toLowerCase() !== 'raw'),
      numbered: Boolean(parsed.serialNumbered ?? parsed.numbered ?? parsed.isNumbered ?? parsed.numberedTo),
      firstBowman: Boolean(parsed.firstBowman),
      refractor: Boolean(parsed.refractor ?? parsed.parallel ?? parsed.variation),
      pokemon: Boolean(parsed.pokemon ?? (parsed.game === 'pokemon') ?? (parsed.category === 'tcg_card'))
    }
  };
}

function canonicalRecordToSoldComp(record = {}) {
  const price = toNumber(record.totalPaid ?? record.soldPrice ?? record.price, 0);

  return {
    ebayItemId: record.marketplaceListingId || record.marketplaceSaleId || record.id || null,
    id: record.id || record.marketplaceSaleId || record.marketplaceListingId || null,
    title: record.rawTitle || record.title || record.normalizedTitle || 'Untitled canonical sold evidence',
    price,
    soldPrice: price,
    shipping: toNumber(record.shipping, 0),
    url: record.url || record.itemWebUrl || '',
    image: record.image || '',
    soldAt: record.soldAt || record.dateSold || record.soldDate || null,
    dateSold: record.soldAt || record.dateSold || record.soldDate || null,
    source: 'canonical_sold_evidence',
    type: 'sold',
    status: 'sold',
    evidenceType: 'true_sold',
    sold: true,
    isSold: true,
    saleType: record.saleType || 'unknown',
    marketplace: record.marketplace || record.marketplaceLabel || 'unknown',
    canonicalCardKey: record.canonicalCardKey || '',
    evidenceQualityScore: record.evidenceQualityScore,
    evidenceQualityLevel: record.evidenceQualityLevel,
    parsed: buildRuntimeParsedIdentity(
      record.parsedIdentity || record.identity || record.parsed || {},
      {
        gradeCompany: record.gradeCompany,
        grade: record.grade,
        condition: record.condition
      }
    )
  };
}

function buildValuationResult(listing = {}, queryResult = {}, options = {}) {
  const soldComps = asArray(queryResult.records).map(canonicalRecordToSoldComp);
  const runtimeListing = {
    ...listing,
    parsed: buildRuntimeParsedIdentity(listing.parsedIdentity || listing.identity || listing.parsed || {})
  };
  const soldSalesSummary = soldSalesEngine.summarizeSoldSales(
    runtimeListing,
    soldComps,
    { now: options.asOf || options.now }
  );
  const marketData = marketValueEngine.calculateMarketValue({
    listing: runtimeListing,
    activeCompData: options.activeCompData || {},
    soldComps: soldSalesSummary.sales,
    populationData: options.populationData || {},
    trendData: options.trendData || {},
    options: options.marketValueOptions || {}
  });

  return {
    soldSalesSummary,
    marketData
  };
}

function collectRetentionStatuses(records = []) {
  return records.reduce((summary, record) => {
    const status = record.retention?.status || 'unknown';
    summary[status] = (summary[status] || 0) + 1;
    return summary;
  }, {});
}

function validateTrueSoldEvidenceFeedPilotInput(options = {}) {
  const errors = [];
  const warnings = [];

  if (!asObject(options.listing) || !Object.keys(asObject(options.listing)).length) {
    errors.push('missing_pilot_listing');
  }
  if (!asArray(options.records).length && !options.inputPath) {
    errors.push('missing_pilot_records');
  }
  if (!getPreferredPilotSource()) {
    errors.push('manual_approved_source_unavailable');
  }
  if (!options.asOf && !options.now) {
    warnings.push('pilot_as_of_timestamp_not_supplied');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

function determinePilotStatus(validation, importReport, queryResult) {
  if (!validation.valid) return PILOT_STATUS.INVALID;
  if (!importReport || importReport.importedRecords <= 0) return PILOT_STATUS.BLOCKED;
  if (!queryResult || queryResult.trueSoldCount <= 0) return PILOT_STATUS.BLOCKED;
  if (importReport.rejectedRecords > 0 || importReport.duplicateRecords > 0) {
    return PILOT_STATUS.READY_WITH_WARNINGS;
  }
  return PILOT_STATUS.READY;
}

function runTrueSoldEvidenceFeedPilot(options = {}) {
  const validation = validateTrueSoldEvidenceFeedPilotInput(options);
  const sourceDecision = getPreferredPilotSource();
  const sourceInventory = buildSoldEvidenceSourceInventory();
  const listing = asObject(options.listing);
  const identityScope = validation.valid ? buildPilotIdentityScope(listing) : {};
  const emptyStore = options.store || createEmptySoldEvidenceStore();

  if (!validation.valid) {
    return {
      source: SOURCE,
      version: VERSION,
      status: PILOT_STATUS.INVALID,
      valid: false,
      errors: validation.errors,
      warnings: validation.warnings,
      sourceDecision,
      sourceInventory,
      identityScope,
      productionImpact: 'none',
      decisionImpact: 'none',
      executionAuthority: 'none'
    };
  }

  const importResult = importManualSoldEvidence({
    input: options.records ? { verifiedSoldRecords: options.records } : undefined,
    inputPath: options.inputPath,
    store: emptyStore,
    storePath: options.storePath,
    dryRun: Boolean(options.dryRun),
    includeRawRecord: Boolean(options.includeRawRecord),
    now: options.now || options.asOf
  });
  const queryResult = soldEvidenceService.querySoldEvidence(
    importResult.store,
    getIdentityInput(listing),
    { trueSoldOnly: true },
    { asOf: options.asOf || options.now }
  );
  const valuation = buildValuationResult(listing, queryResult, options);
  const status = determinePilotStatus(validation, importResult.report, queryResult);

  return {
    source: SOURCE,
    version: VERSION,
    status,
    valid: status === PILOT_STATUS.READY || status === PILOT_STATUS.READY_WITH_WARNINGS,
    errors: [],
    warnings: [
      ...validation.warnings,
      ...Object.keys(importResult.report.rejectionReasons || {})
    ],
    sourceDecision,
    sourceInventory,
    identityScope,
    importReport: importResult.report,
    store: importResult.store,
    queryResult,
    valuation,
    pilotSummary: {
      canonicalCardKey: identityScope.canonicalCardKey,
      importedRecords: importResult.report.importedRecords,
      rejectedRecords: importResult.report.rejectedRecords,
      duplicateRecords: importResult.report.duplicateRecords,
      trueSoldCount: queryResult.trueSoldCount,
      recentSoldCount: queryResult.recentSoldCount,
      valuationSource: valuation.marketData.source,
      marketValue: valuation.marketData.marketValue,
      soldCompCount: valuation.marketData.soldCompCount,
      retentionStatusSummary: collectRetentionStatuses(queryResult.records)
    },
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
}

function summarizeTrueSoldEvidenceFeedPilot(result = {}) {
  return {
    source: result.source || SOURCE,
    version: result.version || VERSION,
    status: result.status || PILOT_STATUS.INVALID,
    sourceClassification: result.sourceDecision?.classification || SOURCE_CLASSIFICATION.UNKNOWN,
    canonicalCardKey: result.identityScope?.canonicalCardKey || '',
    importedRecords: result.importReport?.importedRecords || 0,
    rejectedRecords: result.importReport?.rejectedRecords || 0,
    duplicateRecords: result.importReport?.duplicateRecords || 0,
    trueSoldCount: result.queryResult?.trueSoldCount || 0,
    valuationSource: result.valuation?.marketData?.source || 'unknown',
    soldCompCount: result.valuation?.marketData?.soldCompCount || 0,
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
}

module.exports = {
  SOURCE,
  VERSION,
  SOURCE_CLASSIFICATION,
  PILOT_STATUS,
  buildPilotIdentityScope,
  buildSoldEvidenceSourceInventory,
  buildValuationResult,
  canonicalRecordToSoldComp,
  getPreferredPilotSource,
  runTrueSoldEvidenceFeedPilot,
  summarizeTrueSoldEvidenceFeedPilot,
  validateTrueSoldEvidenceFeedPilotInput
};
