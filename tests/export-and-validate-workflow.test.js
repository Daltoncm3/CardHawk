'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const workflow = require('../validation/exportAndValidate');

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
    title: `Workflow Test Listing ${id}`,
    url: `https://example.test/${id}`,
    marketplace: 'ebay',
    lane: 'baseball',
    query: 'workflow test',
    price: 80,
    shipping: 5,
    totalCost: 85,
    firstSeenAt: '2026-07-09T11:55:00.000Z',
    lastSeenAt: '2026-07-09T12:10:00.000Z',
    seenCount: 1,
    score: 90,
    estimatedValue: 120,
    estimatedProfit: 35,
    roi: 0.41,
    compData: { trueSoldCompCount: 3 },
    qualityData: { investmentQuality: 82 },
    dealGate: { passed: true },
    marketIntelligenceData: buildEvidence(),
    ...overrides
  };
}

function buildStore() {
  return {
    listings: {
      supported: buildListing('supported'),
      missingEvidence: buildListing('missing-evidence', {
        lastSeenAt: '2026-07-09T12:12:00.000Z',
        marketIntelligenceData: {
          evidenceSufficiency: buildEvidence().evidenceSufficiency
        }
      }),
      old: buildListing('old', {
        lastSeenAt: '2026-07-08T12:12:00.000Z'
      })
    },
    scans: [
      {
        id: 'scan-workflow',
        source: 'manual',
        status: 'completed',
        startedAt: '2026-07-09T12:00:00.000Z',
        finishedAt: '2026-07-09T12:30:00.000Z',
        listingsFound: 2,
        newAlerts: 0
      }
    ],
    alerts: [],
    rejections: [],
    settings: {}
  };
}

function writeTempStore(store = buildStore()) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cardhawk-export-validate-'));
  const inputFile = path.join(tempDir, 'cardhawk-data.json');
  const outputRoot = path.join(tempDir, 'validation-output');

  fs.writeFileSync(inputFile, `${JSON.stringify(store, null, 2)}\n`);

  return { tempDir, inputFile, outputRoot };
}

test('runExportAndValidate writes export and validation report under output root', () => {
  const { inputFile, outputRoot } = writeTempStore();
  const before = fs.readFileSync(inputFile, 'utf8');

  const result = workflow.runExportAndValidate(inputFile, {
    outputRoot,
    timestamp: '2026-07-09T13:00:00.000Z'
  });

  const after = fs.readFileSync(inputFile, 'utf8');
  const exportJson = JSON.parse(fs.readFileSync(result.exportFile, 'utf8'));
  const reportJson = JSON.parse(fs.readFileSync(result.reportFile, 'utf8'));

  assert.equal(after, before);
  assert.match(result.exportFile, /validation-output\/exports\/scan-export-/);
  assert.match(result.reportFile, /validation-output\/reports\/decision-validation-/);
  assert.equal(exportJson.source, 'cardhawk_scan_export');
  assert.equal(reportJson.source, 'decision_intelligence_live_validation_runner');
  assert.equal(exportJson.listingCount, 2);
  assert.equal(reportJson.listingCount, 2);
  assert.equal(result.summary.exportedListings, 2);
  assert.equal(result.summary.validatedListings, 2);
  assert.equal(result.summary.missingEvidenceCount, 1);
});

test('workflow supports explicit export and report paths', () => {
  const { tempDir, inputFile } = writeTempStore();
  const exportFile = path.join(tempDir, 'custom-export.json');
  const reportFile = path.join(tempDir, 'custom-report.json');

  const result = workflow.runExportAndValidate(inputFile, {
    exportFile,
    reportFile,
    timestamp: '2026-07-09T13:00:00.000Z'
  });

  assert.equal(result.exportFile, exportFile);
  assert.equal(result.reportFile, reportFile);
  assert.equal(fs.existsSync(exportFile), true);
  assert.equal(fs.existsSync(reportFile), true);
});

test('main prints a concise workflow summary', () => {
  const { inputFile, outputRoot } = writeTempStore();
  let output = '';

  const result = workflow.main([
    '--store',
    inputFile,
    '--output-root',
    outputRoot,
    '--limit',
    '10'
  ], {
    write(chunk) {
      output += chunk;
    }
  });

  assert.match(output, /Decision Intelligence offline validation complete/);
  assert.match(output, /Exported listings: 2/);
  assert.match(output, /Validated listings: 2/);
  assert.match(output, /Missing evidence: 1/);
  assert.equal(result.summary.exportedListings, 2);
});

test('workflow degrades safely when scan timestamps are unavailable', () => {
  const store = buildStore();
  store.scans = [{ id: 'bad-scan', status: 'completed' }];
  const { inputFile, outputRoot } = writeTempStore(store);

  const result = workflow.runExportAndValidate(inputFile, {
    outputRoot,
    limit: 2,
    timestamp: '2026-07-09T13:00:00.000Z'
  });

  assert.equal(result.exportReport.selection.strategy, 'newest_listings_fallback');
  assert.equal(result.exportReport.listingCount, 2);
  assert.equal(result.validationReport.listingCount, 2);
  assert.ok(result.exportReport.warnings.some((warning) => /scan window/i.test(warning)));
});

test('formatSummary returns stable concise text', () => {
  const summary = workflow.formatSummary({
    exportedListings: 2,
    validatedListings: 2,
    missingEvidenceCount: 1,
    blockers: 1,
    cautions: 2,
    conflicts: 0,
    exportFile: '/tmp/export.json',
    reportFile: '/tmp/report.json'
  });

  assert.match(summary, /Exported listings: 2/);
  assert.match(summary, /Validated listings: 2/);
  assert.match(summary, /Blockers: 1/);
  assert.match(summary, /Report file: \/tmp\/report\.json/);
});
