'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const comparator = require('../validation/compareShadowVsProduction');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cardhawk-shadow-production-'));
}

function buildShadowRecord(overrides = {}) {
  return {
    id: 'shadow-1',
    listingId: 'listing-1',
    listing: {
      title: 'Shadow Comparison Listing'
    },
    decisionIntelligence: {
      overallReadiness: 'supported_context',
      recommendationImpact: 'none',
      supportingSignals: [{ source: 'evidence_sufficiency' }],
      cautionSignals: [],
      blockers: [],
      conflicts: [],
      summary: 'Shadow evidence is aligned.'
    },
    comparison: {
      existingRecommendation: 'BUY_NOW',
      dealGatePassed: true,
      score: 92
    },
    ...overrides
  };
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function writeInputs(shadowRecords, productionInput) {
  const tempDir = makeTempDir();
  const shadowFile = path.join(tempDir, 'shadow-mode.json');
  const productionFile = path.join(tempDir, 'production.json');
  const outputFile = path.join(tempDir, 'comparison-report.json');

  writeJson(shadowFile, {
    version: 1,
    records: shadowRecords
  });
  writeJson(productionFile, productionInput);

  return { shadowFile, productionFile, outputFile };
}

test('buildShadowProductionComparison summarizes agreement and disagreements', () => {
  const report = comparator.buildShadowProductionComparison({
    records: [
      buildShadowRecord(),
      buildShadowRecord({
        id: 'shadow-2',
        listingId: 'listing-2',
        listing: { title: 'Needs Caution' },
        decisionIntelligence: {
          overallReadiness: 'limited_context',
          recommendationImpact: 'none',
          supportingSignals: [{ source: 'evidence_sufficiency' }],
          cautionSignals: [{ source: 'supply_pressure' }],
          blockers: [{ source: 'evidence_sufficiency' }],
          conflicts: [{ source: 'valuation_vs_supply' }]
        },
        comparison: {
          existingRecommendation: 'BUY_NOW'
        }
      }),
      buildShadowRecord({
        id: 'shadow-3',
        listingId: 'missing-production',
        decisionIntelligence: {
          overallReadiness: 'not_ready',
          recommendationImpact: 'none',
          supportingSignals: [],
          cautionSignals: ['listing_similarity'],
          blockers: ['listing_similarity'],
          conflicts: []
        },
        comparison: {
          existingRecommendation: 'WATCH'
        }
      })
    ]
  }, {
    results: [
      {
        listing: {
          id: 'listing-1',
          title: 'Shadow Comparison Listing'
        },
        overallReadiness: 'supported_context',
        supportingSignals: [{ source: 'evidence_sufficiency' }],
        cautionSignals: [],
        blockers: [],
        conflicts: []
      },
      {
        listing: {
          id: 'listing-2',
          title: 'Needs Caution'
        },
        overallReadiness: 'supported_context',
        supportingSignals: [{ source: 'evidence_sufficiency' }],
        cautionSignals: [],
        blockers: [],
        conflicts: []
      }
    ]
  }, {
    generatedAt: '2026-07-09T14:00:00.000Z'
  });

  assert.equal(report.source, 'shadow_vs_production_comparator');
  assert.equal(report.mode, 'offline_validation');
  assert.equal(report.generatedAt, '2026-07-09T14:00:00.000Z');
  assert.equal(report.summary.totalShadowRecords, 3);
  assert.equal(report.summary.productionRecords, 2);
  assert.equal(report.summary.matchedListings, 2);
  assert.equal(report.summary.unmatchedShadowRecords, 1);
  assert.equal(report.summary.additionalCautionCount, 2);
  assert.equal(report.summary.reducedConfidenceCount, 2);
  assert.equal(report.summary.manualReviewCount, 2);
  assert.deepEqual(report.overallReadinessVsExistingRecommendation, {
    'BUY_NOW:supported_context': 1,
    'BUY_NOW:limited_context': 1,
    'WATCH:not_ready': 1
  });
  assert.equal(report.signalAgreement.blockers.total, 3);
  assert.equal(report.signalAgreement.blockers.agreed, 1);
  assert.equal(report.signalAgreement.cautionSignals.agreed, 1);
  assert.equal(report.signalAgreement.supportingSignals.agreed, 3);
  assert.equal(report.signalAgreement.conflicts.agreed, 2);
  assert.equal(report.disagreementCounts.overall_readiness_mismatch, 1);
  assert.equal(report.disagreementCounts.blockers_mismatch, 1);
  assert.equal(report.disagreementCounts.cautionSignals_mismatch, 1);
  assert.equal(report.disagreementCounts.conflicts_mismatch, 1);
  assert.equal(report.disagreementCounts.missing_production_match, 1);
  assert.equal(report.listingsWithAdditionalCaution.length, 2);
  assert.equal(report.listingsWithReducedConfidence.length, 2);
  assert.equal(report.manualReviewList.length, 2);
});

test('compareShadowVsProduction reads files and writes JSON report with --out target', () => {
  const { shadowFile, productionFile, outputFile } = writeInputs([
    buildShadowRecord()
  ], {
    results: [
      {
        listing: {
          id: 'listing-1',
          title: 'Shadow Comparison Listing'
        },
        overallReadiness: 'supported_context',
        supportingSignals: [{ source: 'evidence_sufficiency' }],
        cautionSignals: [],
        blockers: [],
        conflicts: []
      }
    ]
  });

  const report = comparator.compareShadowVsProduction(shadowFile, productionFile, {
    outputFile,
    generatedAt: '2026-07-09T14:00:00.000Z'
  });
  const saved = JSON.parse(fs.readFileSync(outputFile, 'utf8'));

  assert.equal(report.summary.totalShadowRecords, 1);
  assert.equal(report.summary.manualReviewCount, 0);
  assert.equal(saved.source, 'shadow_vs_production_comparator');
  assert.equal(saved.summary.matchedListings, 1);
  assert.equal(saved.shadowLogFile, path.resolve(shadowFile));
  assert.equal(saved.productionInputFile, path.resolve(productionFile));
});

test('comparator accepts exported scan listing input and reports missing production signal context', () => {
  const report = comparator.buildShadowProductionComparison({
    records: [
      buildShadowRecord({
        decisionIntelligence: {
          overallReadiness: 'cautious_context',
          recommendationImpact: 'none',
          supportingSignals: [],
          cautionSignals: ['supply_pressure'],
          blockers: [],
          conflicts: []
        }
      })
    ]
  }, {
    source: 'cardhawk_scan_export',
    listings: [
      {
        ebayItemId: 'listing-1',
        title: 'Shadow Comparison Listing',
        recommendation: 'BUY_NOW',
        price: 100
      }
    ]
  });

  assert.equal(report.summary.matchedListings, 1);
  assert.equal(report.summary.manualReviewCount, 1);
  assert.equal(report.disagreementCounts.missing_production_signal_context, 1);
  assert.equal(report.listingsWithAdditionalCaution.length, 1);
  assert.equal(report.listingsWithReducedConfidence.length, 1);
});

test('main prints concise summary and supports --shadow, --production, and --out', () => {
  const { shadowFile, productionFile, outputFile } = writeInputs([
    buildShadowRecord()
  ], {
    results: [
      {
        listing: { id: 'listing-1' },
        overallReadiness: 'supported_context',
        supportingSignals: [{ source: 'evidence_sufficiency' }],
        cautionSignals: [],
        blockers: [],
        conflicts: []
      }
    ]
  });
  let output = '';

  const report = comparator.main([
    '--shadow',
    shadowFile,
    '--production',
    productionFile,
    '--out',
    outputFile
  ], {
    write(chunk) {
      output += chunk;
    }
  });

  assert.match(output, /Shadow vs Production comparison complete/);
  assert.match(output, /Shadow records: 1/);
  assert.match(output, /Manual review: 0/);
  assert.equal(report.summary.manualReviewCount, 0);
  assert.equal(fs.existsSync(outputFile), true);
});

test('parseArgs supports default shadow log and positional files', () => {
  assert.deepEqual(comparator.parseArgs(['production.json']), {
    shadowLogFile: path.join(__dirname, '..', 'data', 'shadow-mode.json'),
    productionInputFile: 'production.json',
    options: {}
  });

  assert.deepEqual(comparator.parseArgs(['shadow.json', 'production.json', '--out', 'report.json']), {
    shadowLogFile: 'shadow.json',
    productionInputFile: 'production.json',
    options: {
      outputFile: 'report.json'
    }
  });
});

test('compareListing does not mutate normalized inputs', () => {
  const shadow = comparator.normalizeShadowRecord(buildShadowRecord({
    decisionIntelligence: {
      overallReadiness: 'limited_context',
      recommendationImpact: 'none',
      supportingSignals: [],
      cautionSignals: ['supply_pressure'],
      blockers: [],
      conflicts: []
    }
  }));
  const production = comparator.normalizeProductionEntry({
    listing: { id: 'listing-1' },
    overallReadiness: 'supported_context',
    supportingSignals: [],
    cautionSignals: [],
    blockers: [],
    conflicts: []
  });
  const before = JSON.stringify({ shadow, production });

  comparator.compareListing(shadow, production);

  assert.equal(JSON.stringify({ shadow, production }), before);
});
