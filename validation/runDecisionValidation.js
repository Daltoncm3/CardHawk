'use strict';

const fs = require('node:fs');
const path = require('node:path');

const decisionIntelligenceEngine = require('../engines/decisionIntelligenceEngine');

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJsonFile(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function objectValues(value) {
  const object = asObject(value);
  return Object.keys(object).length ? Object.values(object) : [];
}

function extractListings(data) {
  if (Array.isArray(data)) return data;

  const root = asObject(data);
  const candidates = [
    root.listings,
    root.records,
    root.items,
    root.results,
    root.scanResults,
    root.data && root.data.listings,
    root.data && root.data.records,
    root.data && root.data.items,
    root.store && root.store.listings
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
    const values = objectValues(candidate);
    if (values.length) return values;
  }

  return [];
}

function getMarketIntelligenceSources(listing = {}) {
  return [
    listing,
    listing.marketIntelligenceData,
    listing.marketIntelligence,
    listing.intelligence,
    listing.scoring && listing.scoring.marketIntelligenceData,
    listing.scoring && listing.scoring.marketIntelligence,
    listing.scoring && listing.scoring.intelligence
  ].map(asObject);
}

function pickEvidence(listing = {}, field) {
  for (const source of getMarketIntelligenceSources(listing)) {
    if (source[field] && typeof source[field] === 'object') return source[field];
  }

  return {};
}

function getDecisionInput(listing = {}) {
  return {
    evidenceSufficiency: pickEvidence(listing, 'evidenceSufficiency'),
    listingSimilarity: pickEvidence(listing, 'listingSimilarity'),
    comparableQuality: pickEvidence(listing, 'comparableQuality'),
    valuationRange: pickEvidence(listing, 'valuationRange'),
    supplyPressure: pickEvidence(listing, 'supplyPressure')
  };
}

function getListingMetadata(listing = {}, index = 0) {
  return {
    index,
    id: listing.ebayItemId || listing.itemId || listing.listingId || listing.id || null,
    title: listing.title || listing.name || '',
    price: listing.price ?? listing.currentPrice ?? listing.listPrice ?? null,
    url: listing.url || listing.itemWebUrl || listing.listingUrl || '',
    marketplace: listing.marketplace || listing.platform || listing.source || ''
  };
}

function evaluateListing(listing = {}, index = 0) {
  const decisionInput = getDecisionInput(listing);
  const decisionIntelligence = decisionIntelligenceEngine.evaluateDecisionIntelligence(decisionInput);

  return {
    listing: getListingMetadata(listing, index),
    overallReadiness: decisionIntelligence.overallReadiness,
    evidencePosture: decisionIntelligence.evidencePosture,
    compPosture: decisionIntelligence.compPosture,
    valuationPosture: decisionIntelligence.valuationPosture,
    resalePressurePosture: decisionIntelligence.resalePressurePosture,
    recommendationImpact: decisionIntelligence.recommendationImpact,
    supportingSignals: decisionIntelligence.supportingSignals,
    cautionSignals: decisionIntelligence.cautionSignals,
    blockers: decisionIntelligence.blockers,
    conflicts: decisionIntelligence.conflicts,
    summary: decisionIntelligence.summary
  };
}

function buildValidationReport(scanData, options = {}) {
  const listings = extractListings(scanData);

  return {
    source: 'decision_intelligence_live_validation_runner',
    mode: 'offline_validation',
    generatedAt: options.generatedAt || new Date().toISOString(),
    inputFile: options.inputFile ? path.resolve(options.inputFile) : null,
    listingCount: listings.length,
    results: listings.map((listing, index) => evaluateListing(listing, index))
  };
}

function runDecisionValidation(inputFile, outputFile, options = {}) {
  if (!inputFile) {
    throw new Error('Usage: node validation/runDecisionValidation.js <scan-results.json> [output-report.json]');
  }

  const scanData = readJsonFile(inputFile);
  const report = buildValidationReport(scanData, {
    ...options,
    inputFile
  });

  if (outputFile) {
    writeJsonFile(outputFile, report);
  }

  return report;
}

function main(argv = process.argv.slice(2)) {
  const [inputFile, outputFile] = argv;
  const report = runDecisionValidation(inputFile, outputFile);

  if (!outputFile) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  }
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
  buildValidationReport,
  evaluateListing,
  extractListings,
  getDecisionInput,
  runDecisionValidation
};
