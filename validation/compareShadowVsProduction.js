'use strict';

const fs = require('node:fs');
const path = require('node:path');

const shadowModeLogger = require('../utils/shadowModeLogger');

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function ensureDirectoryFor(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeJsonFile(filePath, data) {
  ensureDirectoryFor(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function increment(distribution, key) {
  const normalized = key || 'unknown';
  distribution[normalized] = (distribution[normalized] || 0) + 1;
}

function normalizeSource(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function collectSources(items = []) {
  return Array.from(new Set(asArray(items)
    .map((item) => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object') return item.source || item.type || item.key || item.id;
      return '';
    })
    .map(normalizeSource)
    .filter(Boolean)))
    .sort();
}

function sourceDiff(left = [], right = []) {
  const rightSet = new Set(right);
  return left.filter((source) => !rightSet.has(source));
}

function sameSources(left = [], right = []) {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

function objectValues(value) {
  const object = asObject(value);
  return Object.keys(object).length ? Object.values(object) : [];
}

function extractProductionEntries(data) {
  if (Array.isArray(data)) return data;

  const root = asObject(data);
  const candidates = [
    root.results,
    root.listings,
    root.records,
    root.items,
    root.scanResults,
    root.data && root.data.results,
    root.data && root.data.listings,
    root.data && root.data.records,
    root.store && root.store.listings
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
    const values = objectValues(candidate);
    if (values.length) return values;
  }

  return [];
}

function getListingId(entry = {}, index = 0) {
  const listing = asObject(entry.listing);
  return (
    entry.listingId ||
    listing.id ||
    listing.ebayItemId ||
    listing.itemId ||
    entry.ebayItemId ||
    entry.itemId ||
    entry.id ||
    `listing-${index + 1}`
  );
}

function getListingTitle(entry = {}) {
  const listing = asObject(entry.listing);
  return listing.title || entry.title || entry.name || '';
}

function getProductionRecommendation(entry = {}) {
  const listing = asObject(entry.listing);
  const dealGate = asObject(entry.dealGate || listing.dealGate);

  return (
    entry.existingRecommendation ||
    entry.recommendation ||
    entry.decision ||
    entry.action ||
    listing.existingRecommendation ||
    listing.recommendation ||
    listing.decision ||
    listing.action ||
    dealGate.recommendation ||
    dealGate.decision ||
    'unknown'
  );
}

function hasDecisionShape(value = {}) {
  const object = asObject(value);

  return Boolean(
    object.overallReadiness ||
    Array.isArray(object.blockers) ||
    Array.isArray(object.cautionSignals) ||
    Array.isArray(object.supportingSignals) ||
    Array.isArray(object.conflicts)
  );
}

function getProductionDecision(entry = {}) {
  const marketIntelligence = asObject(entry.marketIntelligenceData || entry.marketIntelligence || entry.intelligence);
  const listing = asObject(entry.listing);
  const listingMarketIntelligence = asObject(
    listing.marketIntelligenceData ||
    listing.marketIntelligence ||
    listing.intelligence
  );

  const candidates = [
    entry.actual,
    entry.decisionIntelligence,
    marketIntelligence.decisionIntelligence,
    listingMarketIntelligence.decisionIntelligence,
    entry
  ];

  return asObject(candidates.find(hasDecisionShape));
}

function normalizeProductionEntry(entry = {}, index = 0) {
  const decision = getProductionDecision(entry);

  return {
    id: getListingId(entry, index),
    title: getListingTitle(entry),
    existingRecommendation: getProductionRecommendation(entry),
    overallReadiness: decision.overallReadiness || 'unknown',
    blockers: collectSources(decision.blockers),
    cautionSignals: collectSources(decision.cautionSignals),
    supportingSignals: collectSources(decision.supportingSignals),
    conflicts: collectSources(decision.conflicts),
    hasSignalContext: Boolean(
      decision.overallReadiness ||
      Array.isArray(decision.blockers) ||
      Array.isArray(decision.cautionSignals) ||
      Array.isArray(decision.supportingSignals) ||
      Array.isArray(decision.conflicts)
    )
  };
}

function normalizeShadowRecord(record = {}, index = 0) {
  const decision = asObject(record.decisionIntelligence);
  const comparison = asObject(record.comparison);

  return {
    id: record.listingId || getListingId(record, index),
    title: asObject(record.listing).title || record.title || '',
    existingRecommendation: comparison.existingRecommendation || 'unknown',
    overallReadiness: decision.overallReadiness || 'unknown',
    blockers: collectSources(decision.blockers),
    cautionSignals: collectSources(decision.cautionSignals),
    supportingSignals: collectSources(decision.supportingSignals),
    conflicts: collectSources(decision.conflicts),
    recommendationImpact: decision.recommendationImpact || 'unknown'
  };
}

function buildProductionIndex(entries = []) {
  return new Map(entries.map((entry, index) => {
    const normalized = normalizeProductionEntry(entry, index);
    return [normalized.id, normalized];
  }));
}

function isBuyLikeRecommendation(value) {
  return /buy|watch|candidate|alert/i.test(String(value || ''));
}

function hasAdditionalCaution(shadow = {}, production = {}) {
  return (
    sourceDiff(shadow.cautionSignals, production.cautionSignals).length > 0 ||
    sourceDiff(shadow.blockers, production.blockers).length > 0 ||
    sourceDiff(shadow.conflicts, production.conflicts).length > 0
  );
}

function wouldReduceConfidence(shadow = {}, production = {}) {
  const recommendation = shadow.existingRecommendation !== 'unknown'
    ? shadow.existingRecommendation
    : production.existingRecommendation;
  const cautiousReadiness = ['not_ready', 'limited_context', 'cautious_context'].includes(shadow.overallReadiness);

  return Boolean(
    isBuyLikeRecommendation(recommendation) &&
    (cautiousReadiness || shadow.blockers.length || shadow.cautionSignals.length || shadow.conflicts.length)
  );
}

function compareSignalGroup(shadowSources = [], productionSources = []) {
  return {
    shadow: shadowSources,
    production: productionSources,
    agreed: sameSources(shadowSources, productionSources),
    missingFromProduction: sourceDiff(shadowSources, productionSources),
    extraInProduction: sourceDiff(productionSources, shadowSources)
  };
}

function compareListing(shadow = {}, production = null) {
  if (!production) {
    return {
      listingId: shadow.id,
      title: shadow.title,
      matched: false,
      existingRecommendation: shadow.existingRecommendation,
      overallReadiness: shadow.overallReadiness,
      disagreementCategories: ['missing_production_match'],
      additionalCaution: Boolean(shadow.blockers.length || shadow.cautionSignals.length || shadow.conflicts.length),
      reducedConfidence: wouldReduceConfidence(shadow, {}),
      requiresManualReview: true,
      manualReviewReasons: ['missing production match'],
      signalAgreement: {
        blockers: compareSignalGroup(shadow.blockers, []),
        cautionSignals: compareSignalGroup(shadow.cautionSignals, []),
        supportingSignals: compareSignalGroup(shadow.supportingSignals, []),
        conflicts: compareSignalGroup(shadow.conflicts, [])
      }
    };
  }

  const signalAgreement = {
    blockers: compareSignalGroup(shadow.blockers, production.blockers),
    cautionSignals: compareSignalGroup(shadow.cautionSignals, production.cautionSignals),
    supportingSignals: compareSignalGroup(shadow.supportingSignals, production.supportingSignals),
    conflicts: compareSignalGroup(shadow.conflicts, production.conflicts)
  };
  const disagreementCategories = [];

  if (shadow.overallReadiness !== production.overallReadiness) {
    disagreementCategories.push('overall_readiness_mismatch');
  }

  for (const [group, comparison] of Object.entries(signalAgreement)) {
    if (!comparison.agreed) disagreementCategories.push(`${group}_mismatch`);
  }

  if (!production.hasSignalContext) disagreementCategories.push('missing_production_signal_context');

  const additionalCaution = hasAdditionalCaution(shadow, production);
  const reducedConfidence = wouldReduceConfidence(shadow, production);
  const manualReviewReasons = [];

  if (disagreementCategories.length) manualReviewReasons.push('shadow and production disagreement');
  if (additionalCaution) manualReviewReasons.push('shadow raised additional caution');
  if (reducedConfidence) manualReviewReasons.push('shadow would reduce confidence');

  return {
    listingId: shadow.id,
    title: shadow.title || production.title,
    matched: true,
    existingRecommendation: shadow.existingRecommendation !== 'unknown'
      ? shadow.existingRecommendation
      : production.existingRecommendation,
    productionRecommendation: production.existingRecommendation,
    overallReadiness: {
      shadow: shadow.overallReadiness,
      production: production.overallReadiness,
      agreed: shadow.overallReadiness === production.overallReadiness
    },
    signalAgreement,
    disagreementCategories,
    additionalCaution,
    reducedConfidence,
    requiresManualReview: Boolean(manualReviewReasons.length),
    manualReviewReasons
  };
}

function createSignalScorecard() {
  return {
    total: 0,
    agreed: 0,
    disagreed: 0,
    agreementPercent: 0
  };
}

function finalizeSignalScorecard(scorecard) {
  return {
    ...scorecard,
    disagreed: Math.max(0, scorecard.total - scorecard.agreed),
    agreementPercent: scorecard.total
      ? Number(((scorecard.agreed / scorecard.total) * 100).toFixed(1))
      : 0
  };
}

function buildShadowProductionComparison(shadowLog = {}, productionInput = {}, options = {}) {
  const shadows = asArray(shadowLog.records).map(normalizeShadowRecord);
  const productionEntries = extractProductionEntries(productionInput);
  const productionIndex = buildProductionIndex(productionEntries);
  const comparisons = shadows.map((shadow) => compareListing(shadow, productionIndex.get(shadow.id)));
  const readinessVsRecommendation = {};
  const disagreementCategories = {};
  const signalAgreement = {
    blockers: createSignalScorecard(),
    cautionSignals: createSignalScorecard(),
    supportingSignals: createSignalScorecard(),
    conflicts: createSignalScorecard()
  };

  for (const comparison of comparisons) {
    const recommendation = comparison.existingRecommendation || 'unknown';
    const readiness = typeof comparison.overallReadiness === 'string'
      ? comparison.overallReadiness
      : comparison.overallReadiness.shadow;
    increment(readinessVsRecommendation, `${recommendation}:${readiness || 'unknown'}`);

    for (const category of comparison.disagreementCategories) {
      increment(disagreementCategories, category);
    }

    for (const [group, scorecard] of Object.entries(signalAgreement)) {
      scorecard.total += 1;
      if (comparison.signalAgreement[group].agreed) scorecard.agreed += 1;
    }
  }

  return {
    source: 'shadow_vs_production_comparator',
    mode: 'offline_validation',
    generatedAt: options.generatedAt || new Date().toISOString(),
    shadowLogFile: options.shadowLogFile ? path.resolve(options.shadowLogFile) : null,
    productionInputFile: options.productionInputFile ? path.resolve(options.productionInputFile) : null,
    summary: {
      totalShadowRecords: shadows.length,
      productionRecords: productionEntries.length,
      matchedListings: comparisons.filter((comparison) => comparison.matched).length,
      unmatchedShadowRecords: comparisons.filter((comparison) => !comparison.matched).length,
      additionalCautionCount: comparisons.filter((comparison) => comparison.additionalCaution).length,
      reducedConfidenceCount: comparisons.filter((comparison) => comparison.reducedConfidence).length,
      manualReviewCount: comparisons.filter((comparison) => comparison.requiresManualReview).length
    },
    overallReadinessVsExistingRecommendation: readinessVsRecommendation,
    signalAgreement: Object.fromEntries(Object.entries(signalAgreement)
      .map(([group, scorecard]) => [group, finalizeSignalScorecard(scorecard)])),
    disagreementCounts: disagreementCategories,
    disagreementCategories: Object.keys(disagreementCategories).sort(),
    listingsWithAdditionalCaution: comparisons
      .filter((comparison) => comparison.additionalCaution)
      .map((comparison) => ({
        listingId: comparison.listingId,
        title: comparison.title,
        reasons: comparison.manualReviewReasons
      })),
    listingsWithReducedConfidence: comparisons
      .filter((comparison) => comparison.reducedConfidence)
      .map((comparison) => ({
        listingId: comparison.listingId,
        title: comparison.title,
        existingRecommendation: comparison.existingRecommendation,
        reasons: comparison.manualReviewReasons
      })),
    manualReviewList: comparisons
      .filter((comparison) => comparison.requiresManualReview)
      .map((comparison) => ({
        listingId: comparison.listingId,
        title: comparison.title,
        reasons: comparison.manualReviewReasons,
        disagreementCategories: comparison.disagreementCategories
      })),
    comparisons
  };
}

function compareShadowVsProduction(shadowLogFile, productionInputFile, options = {}) {
  if (!productionInputFile) {
    throw new Error('Usage: node validation/compareShadowVsProduction.js [shadow-mode.json] <production-input.json> [--out report.json]');
  }

  const shadowLog = readJsonFile(shadowLogFile || shadowModeLogger.DEFAULT_SHADOW_MODE_FILE);
  const productionInput = readJsonFile(productionInputFile);
  const report = buildShadowProductionComparison(shadowLog, productionInput, {
    ...options,
    shadowLogFile: shadowLogFile || shadowModeLogger.DEFAULT_SHADOW_MODE_FILE,
    productionInputFile
  });

  if (options.outputFile) {
    writeJsonFile(options.outputFile, report);
  }

  return report;
}

function parseArgs(argv = []) {
  const options = {};
  const positional = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--shadow') {
      options.shadowLogFile = argv[index + 1];
      index += 1;
    } else if (arg === '--production') {
      options.productionInputFile = argv[index + 1];
      index += 1;
    } else if (arg === '--out') {
      options.outputFile = argv[index + 1];
      index += 1;
    } else {
      positional.push(arg);
    }
  }

  const shadowLogFile = options.shadowLogFile || (
    positional.length > 1 ? positional[0] : shadowModeLogger.DEFAULT_SHADOW_MODE_FILE
  );
  const productionInputFile = options.productionInputFile || (
    positional.length > 1 ? positional[1] : positional[0]
  );

  return {
    shadowLogFile,
    productionInputFile,
    options
  };
}

function formatSummary(report = {}) {
  const summary = asObject(report.summary);

  return [
    'Shadow vs Production comparison complete',
    `Shadow records: ${summary.totalShadowRecords || 0}`,
    `Matched listings: ${summary.matchedListings || 0}`,
    `Additional caution: ${summary.additionalCautionCount || 0}`,
    `Reduced confidence: ${summary.reducedConfidenceCount || 0}`,
    `Manual review: ${summary.manualReviewCount || 0}`
  ].join('\n');
}

function main(argv = process.argv.slice(2), output = process.stdout) {
  const parsed = parseArgs(argv);
  const report = compareShadowVsProduction(
    parsed.shadowLogFile,
    parsed.productionInputFile,
    parsed.options
  );

  output.write(`${formatSummary(report)}\n`);
  return report;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  buildShadowProductionComparison,
  collectSources,
  compareListing,
  compareShadowVsProduction,
  extractProductionEntries,
  formatSummary,
  main,
  normalizeProductionEntry,
  normalizeShadowRecord,
  parseArgs
};
