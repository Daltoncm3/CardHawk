'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const shadowModeLogger = require('../utils/shadowModeLogger');
const shadowCli = require('../validation/runShadowComparisonReport');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cardhawk-shadow-cli-'));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function buildShadowRecord(overrides = {}) {
  return {
    id: 'shadow-1',
    listingId: 'listing-1',
    listing: {
      title: 'Shadow CLI Listing'
    },
    decisionIntelligence: {
      overallReadiness: 'limited_context',
      recommendationImpact: 'none',
      supportingSignals: [{ source: 'evidence_sufficiency' }],
      cautionSignals: [{ source: 'supply_pressure' }],
      blockers: [],
      conflicts: [{ source: 'valuation_vs_supply' }]
    },
    comparison: {
      existingRecommendation: 'BUY_NOW',
      dealGatePassed: true,
      score: 91
    },
    ...overrides
  };
}

function writeInputs(shadowRecords, productionInput) {
  const tempDir = makeTempDir();
  const shadowFile = path.join(tempDir, 'shadow-mode.json');
  const productionFile = path.join(tempDir, 'production.json');
  const outputFile = path.join(tempDir, 'shadow-scorecard.json');

  writeJson(shadowFile, {
    version: 1,
    records: shadowRecords
  });
  writeJson(productionFile, productionInput);

  return { shadowFile, productionFile, outputFile };
}

test('runShadowComparisonReport prints concise comparison scorecard', () => {
  const { shadowFile, productionFile } = writeInputs([
    buildShadowRecord()
  ], {
    results: [
      {
        listing: {
          id: 'listing-1',
          title: 'Shadow CLI Listing'
        },
        overallReadiness: 'supported_context',
        supportingSignals: [{ source: 'evidence_sufficiency' }],
        cautionSignals: [],
        blockers: [],
        conflicts: []
      }
    ]
  });

  const result = shadowCli.runShadowComparisonReport({
    shadowLogFile: shadowFile,
    productionInputFile: productionFile,
    generatedAt: '2026-07-09T15:00:00.000Z'
  });

  assert.match(result.summary, /Shadow Comparison Scorecard/);
  assert.match(result.summary, /Total compared: 1/);
  assert.match(result.summary, /Disagreement count: 3/);
  assert.match(result.summary, /Added caution count: 1/);
  assert.match(result.summary, /Reduced confidence count: 1/);
  assert.match(result.summary, /Manual review count: 1/);
  assert.match(result.summary, /overall_readiness_mismatch: 1/);
  assert.equal(result.scorecard.source, 'shadow_comparison_report_cli');
  assert.equal(result.scorecard.totalCompared, 1);
  assert.equal(result.scorecard.comparisonReport.source, 'shadow_vs_production_comparator');
});

test('runShadowComparisonReport optionally writes JSON scorecard', () => {
  const { shadowFile, productionFile, outputFile } = writeInputs([
    buildShadowRecord({
      decisionIntelligence: {
        overallReadiness: 'supported_context',
        recommendationImpact: 'none',
        supportingSignals: [{ source: 'evidence_sufficiency' }],
        cautionSignals: [],
        blockers: [],
        conflicts: []
      }
    })
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

  const result = shadowCli.runShadowComparisonReport({
    shadowLogFile: shadowFile,
    productionInputFile: productionFile,
    outputFile,
    generatedAt: '2026-07-09T15:00:00.000Z'
  });
  const saved = JSON.parse(fs.readFileSync(outputFile, 'utf8'));

  assert.equal(result.scorecard.disagreementCount, 0);
  assert.equal(saved.source, 'shadow_comparison_report_cli');
  assert.equal(saved.totalCompared, 1);
  assert.equal(saved.disagreementCount, 0);
  assert.equal(saved.comparisonReport.summary.manualReviewCount, 0);
});

test('main parses files, writes --out JSON, and emits scorecard text', () => {
  const { shadowFile, productionFile, outputFile } = writeInputs([
    buildShadowRecord({
      decisionIntelligence: {
        overallReadiness: 'supported_context',
        recommendationImpact: 'none',
        supportingSignals: [{ source: 'evidence_sufficiency' }],
        cautionSignals: [],
        blockers: [],
        conflicts: []
      }
    })
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

  const result = shadowCli.main([
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

  assert.match(output, /Shadow Comparison Scorecard/);
  assert.match(output, /Total compared: 1/);
  assert.match(output, /Manual review count: 0/);
  assert.equal(result.scorecard.manualReviewCount, 0);
  assert.equal(fs.existsSync(outputFile), true);
});

test('wrapper supports shadow-only reports when production input is not provided', () => {
  const { shadowFile } = writeInputs([
    buildShadowRecord()
  ], {
    results: []
  });

  const result = shadowCli.runShadowComparisonReport({
    shadowLogFile: shadowFile,
    generatedAt: '2026-07-09T15:00:00.000Z'
  });

  assert.equal(result.scorecard.totalCompared, 1);
  assert.equal(result.scorecard.matchedListings, 0);
  assert.equal(result.scorecard.manualReviewCount, 1);
  assert.match(result.summary, /Manual review count: 1/);
});

test('getTopDisagreementCategories sorts by count then category', () => {
  assert.deepEqual(shadowCli.getTopDisagreementCategories({
    zeta: 1,
    alpha: 2,
    beta: 2
  }), [
    { category: 'alpha', count: 2 },
    { category: 'beta', count: 2 },
    { category: 'zeta', count: 1 }
  ]);
});

test('parseArgs supports named and positional forms', () => {
  assert.deepEqual(shadowCli.parseArgs([
    '--shadow',
    'shadow.json',
    '--production',
    'production.json',
    '--out',
    'scorecard.json'
  ]), {
    shadowLogFile: 'shadow.json',
    productionInputFile: 'production.json',
    outputFile: 'scorecard.json'
  });

  assert.deepEqual(shadowCli.parseArgs(['production.json']), {
    shadowLogFile: shadowModeLogger.DEFAULT_SHADOW_MODE_FILE,
    productionInputFile: 'production.json',
    outputFile: null
  });

  assert.deepEqual(shadowCli.parseArgs(['shadow.json', 'production.json']), {
    shadowLogFile: 'shadow.json',
    productionInputFile: 'production.json',
    outputFile: null
  });
});
