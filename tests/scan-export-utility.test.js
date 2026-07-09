'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const scanExporter = require('../validation/exportScanResults');
const decisionRunner = require('../validation/runDecisionValidation');

function buildEvidence(overrides = {}) {
  return {
    evidenceSufficiency: {
      sufficientForValuation: true,
      sufficiencyLevel: 'adequate',
      evidenceSufficiencyScore: 76,
      blockingConcerns: [],
      summary: 'Evidence sufficiency is adequate.',
      ...(overrides.evidenceSufficiency || {})
    },
    listingSimilarity: {
      similarityBand: 'strong',
      averageSimilarityScore: 91,
      similarityDistribution: { exact: 1, strong: 2, usable: 0, weak: 0, reject: 0 },
      fatalMismatches: [],
      summary: 'Comparable listings show strong similarity to the target listing.',
      ...(overrides.listingSimilarity || {})
    },
    comparableQuality: {
      scoredComparableCount: 3,
      averageComparableQualityScore: 80,
      qualityDistribution: { excellent: 1, good: 2, usable: 0, weak: 0, reject: 0 },
      summary: 'Comparable quality is strong across the available evidence.',
      ...(overrides.comparableQuality || {})
    },
    valuationRange: {
      floorValue: 90,
      expectedValue: 120,
      ceilingValue: 150,
      rangeQuality: 'usable',
      confidence: 72,
      summary: 'Valuation range is usable for explanation.',
      ...(overrides.valuationRange || {})
    },
    supplyPressure: {
      pressureLevel: 'low',
      undercutRiskLevel: 'low',
      resaleBlockerRisk: 'low',
      summary: 'Supply pressure appears low from the available active-market evidence.',
      ...(overrides.supplyPressure || {})
    }
  };
}

function buildListing(id, overrides = {}) {
  return {
    ebayItemId: id,
    title: `Test Listing ${id}`,
    url: `https://example.test/${id}`,
    image: `https://example.test/${id}.jpg`,
    marketplace: 'ebay',
    lane: 'baseball',
    query: 'test query',
    price: 75,
    shipping: 5,
    totalCost: 80,
    firstSeenAt: '2026-07-09T11:50:00.000Z',
    lastSeenAt: '2026-07-09T12:10:00.000Z',
    seenCount: 1,
    score: 91,
    estimatedValue: 120,
    estimatedProfit: 40,
    roi: 0.5,
    compCount: 3,
    compSource: 'true_sold',
    compData: { trueSoldCompCount: 3 },
    qualityData: { investmentQuality: 82 },
    dealGate: { passed: true },
    parsed: { player: 'Test Player', year: '2024' },
    marketIntelligenceData: buildEvidence(),
    ...overrides
  };
}

function buildStore(overrides = {}) {
  return {
    listings: {
      inWindow: buildListing('in-window'),
      outsideWindow: buildListing('outside-window', {
        lastSeenAt: '2026-07-08T12:10:00.000Z'
      })
    },
    scans: [
      {
        id: 'scan-1',
        source: 'manual',
        status: 'completed',
        startedAt: '2026-07-09T12:00:00.000Z',
        finishedAt: '2026-07-09T12:30:00.000Z',
        listingsFound: 1,
        newAlerts: 0
      }
    ],
    alerts: [],
    rejections: [],
    settings: {},
    ...overrides
  };
}

function writeTempStore(store) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cardhawk-scan-export-'));
  const inputFile = path.join(tempDir, 'cardhawk-data.json');
  const outputFile = path.join(tempDir, 'scan-export.json');

  fs.writeFileSync(inputFile, `${JSON.stringify(store, null, 2)}\n`);

  return { tempDir, inputFile, outputFile };
}

test('exports listings from the latest scan timestamp window', () => {
  const store = buildStore();
  const report = scanExporter.buildScanExport(store, {
    exportedAt: '2026-07-09T13:00:00.000Z',
    inputStore: '/tmp/cardhawk-data.json'
  });

  assert.equal(report.source, 'cardhawk_scan_export');
  assert.equal(report.mode, 'offline_validation_input');
  assert.equal(report.exportedAt, '2026-07-09T13:00:00.000Z');
  assert.equal(report.selection.strategy, 'latest_scan_window');
  assert.equal(report.selection.scanId, 'scan-1');
  assert.equal(report.listingCount, 1);
  assert.equal(report.listings[0].ebayItemId, 'in-window');
  assert.equal(report.listings[0].evidenceAvailability.complete, true);
});

test('falls back to newest listings when scan window timestamps are missing', () => {
  const store = buildStore({
    scans: [
      {
        id: 'bad-scan',
        status: 'completed',
        startedAt: null,
        finishedAt: null
      }
    ]
  });

  const report = scanExporter.buildScanExport(store, { limit: 1 });

  assert.equal(report.selection.strategy, 'newest_listings_fallback');
  assert.equal(report.listingCount, 1);
  assert.equal(report.listings[0].ebayItemId, 'in-window');
  assert.match(report.warnings.join(' '), /scan window/i);
});

test('evidenceAvailability identifies missing Decision Intelligence inputs', () => {
  const listing = buildListing('partial', {
    marketIntelligenceData: {
      evidenceSufficiency: buildEvidence().evidenceSufficiency,
      valuationRange: buildEvidence().valuationRange
    }
  });

  const availability = scanExporter.buildEvidenceAvailability(listing);

  assert.equal(availability.evidenceSufficiency, true);
  assert.equal(availability.valuationRange, true);
  assert.equal(availability.listingSimilarity, false);
  assert.equal(availability.comparableQuality, false);
  assert.equal(availability.supplyPressure, false);
  assert.equal(availability.complete, false);
  assert.deepEqual(availability.missing, ['listingSimilarity', 'comparableQuality', 'supplyPressure']);
});

test('exportScanResults reads fixture store JSON and writes validation input JSON', () => {
  const store = buildStore();
  const { inputFile, outputFile } = writeTempStore(store);
  const before = fs.readFileSync(inputFile, 'utf8');

  const report = scanExporter.exportScanResults(inputFile, outputFile, {
    exportedAt: '2026-07-09T13:00:00.000Z'
  });
  const saved = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
  const after = fs.readFileSync(inputFile, 'utf8');

  assert.equal(report.listingCount, 1);
  assert.equal(saved.listingCount, 1);
  assert.equal(saved.listings[0].ebayItemId, 'in-window');
  assert.equal(after, before);
});

test('export output can be consumed by the Decision Intelligence validation runner', () => {
  const report = scanExporter.buildScanExport(buildStore(), {
    exportedAt: '2026-07-09T13:00:00.000Z'
  });

  const validation = decisionRunner.buildValidationReport(report, {
    generatedAt: '2026-07-09T13:05:00.000Z'
  });

  assert.equal(validation.listingCount, 1);
  assert.equal(validation.results[0].listing.id, 'in-window');
  assert.equal(validation.results[0].overallReadiness, 'supported_context');
  assert.equal(validation.results[0].recommendationImpact, 'none');
});

test('compactListing does not mutate input listing', () => {
  const listing = buildListing('immutable');
  const before = JSON.stringify(listing);

  scanExporter.compactListing(listing);

  assert.equal(JSON.stringify(listing), before);
});
