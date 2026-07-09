'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const shadowModeLogger = require('../utils/shadowModeLogger');
const shadowReport = require('../validation/exportShadowModeReport');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cardhawk-shadow-report-'));
}

function buildRecord(overrides = {}) {
  return {
    id: 'record-1',
    createdAt: '2026-07-09T12:00:00.000Z',
    listingId: 'listing-1',
    decisionIntelligence: {
      overallReadiness: 'supported_context',
      recommendationImpact: 'none',
      supportingSignals: [{ source: 'evidence_sufficiency' }],
      cautionSignals: [{ source: 'supply_pressure' }],
      blockers: [],
      conflicts: [{ source: 'valuation_vs_supply' }]
    },
    comparison: {
      existingRecommendation: 'BUY_NOW',
      dealGatePassed: true,
      score: 92
    },
    ...overrides
  };
}

function writeShadowLog(records) {
  const tempDir = makeTempDir();
  const inputFile = path.join(tempDir, 'shadow-mode.json');
  const outputFile = path.join(tempDir, 'shadow-report.json');

  fs.writeFileSync(inputFile, `${JSON.stringify({
    version: 1,
    updatedAt: '2026-07-09T12:30:00.000Z',
    records
  }, null, 2)}\n`);

  return { inputFile, outputFile };
}

test('buildShadowModeReport summarizes shadow records', () => {
  const report = shadowReport.buildShadowModeReport({
    records: [
      buildRecord(),
      buildRecord({
        id: 'record-2',
        listingId: 'listing-2',
        decisionIntelligence: {
          overallReadiness: 'not_ready',
          recommendationImpact: 'none',
          supportingSignals: [],
          cautionSignals: [],
          blockers: [
            { source: 'evidence_sufficiency' },
            { source: 'listing_similarity' }
          ],
          conflicts: []
        },
        comparison: {
          existingRecommendation: 'PASS',
          dealGatePassed: false
        }
      }),
      buildRecord({
        id: 'record-3',
        listingId: 'listing-3',
        decisionIntelligence: {
          overallReadiness: 'limited_context',
          recommendationImpact: 'BUY_NOW',
          supportingSignals: [],
          cautionSignals: ['valuation_range'],
          blockers: ['evidence_sufficiency'],
          conflicts: ['similarity_vs_quality']
        },
        comparison: {}
      })
    ]
  }, {
    generatedAt: '2026-07-09T13:00:00.000Z',
    inputFile: '/tmp/shadow-mode.json'
  });

  assert.equal(report.source, 'shadow_mode_report_export');
  assert.equal(report.mode, 'offline_validation');
  assert.equal(report.generatedAt, '2026-07-09T13:00:00.000Z');
  assert.equal(report.totalRecords, 3);
  assert.deepEqual(report.overallReadinessDistribution, {
    supported_context: 1,
    not_ready: 1,
    limited_context: 1
  });
  assert.deepEqual(report.blockerCounts, {
    evidence_sufficiency: 2,
    listing_similarity: 1
  });
  assert.deepEqual(report.cautionSignalCounts, {
    supply_pressure: 1,
    valuation_range: 1
  });
  assert.deepEqual(report.conflictCounts, {
    valuation_vs_supply: 1,
    similarity_vs_quality: 1
  });
  assert.deepEqual(report.comparisonVsExistingRecommendation.existingRecommendationDistribution, {
    BUY_NOW: 1,
    PASS: 1,
    unknown: 1
  });
  assert.deepEqual(report.comparisonVsExistingRecommendation.recommendationByReadiness, {
    'BUY_NOW:supported_context': 1,
    'PASS:not_ready': 1,
    'unknown:limited_context': 1
  });
  assert.equal(report.comparisonVsExistingRecommendation.dealGatePassedCount, 1);
  assert.equal(report.comparisonVsExistingRecommendation.dealGateRejectedCount, 1);
  assert.equal(report.comparisonVsExistingRecommendation.dealGateUnknownCount, 1);
  assert.equal(report.recommendationImpact.expected, 'none');
  assert.equal(report.recommendationImpact.allNone, false);
  assert.equal(report.recommendationImpact.nonNoneCount, 1);
  assert.deepEqual(report.recommendationImpact.distribution, {
    none: 2,
    BUY_NOW: 1
  });
});

test('buildShadowModeReport handles empty shadow logs safely', () => {
  const report = shadowReport.buildShadowModeReport({ records: [] });

  assert.equal(report.totalRecords, 0);
  assert.deepEqual(report.overallReadinessDistribution, {});
  assert.deepEqual(report.blockerCounts, {});
  assert.deepEqual(report.cautionSignalCounts, {});
  assert.deepEqual(report.conflictCounts, {});
  assert.equal(report.recommendationImpact.allNone, true);
  assert.equal(report.recommendationImpact.nonNoneCount, 0);
});

test('exportShadowModeReport reads shadow log and writes JSON report', () => {
  const { inputFile, outputFile } = writeShadowLog([
    buildRecord({
      decisionIntelligence: {
        overallReadiness: 'supported_context',
        recommendationImpact: 'none',
        supportingSignals: [],
        cautionSignals: [],
        blockers: [],
        conflicts: []
      }
    })
  ]);

  const report = shadowReport.exportShadowModeReport(inputFile, {
    outputFile,
    generatedAt: '2026-07-09T13:00:00.000Z'
  });
  const saved = JSON.parse(fs.readFileSync(outputFile, 'utf8'));

  assert.equal(report.totalRecords, 1);
  assert.equal(saved.source, 'shadow_mode_report_export');
  assert.equal(saved.totalRecords, 1);
  assert.equal(saved.inputFile, path.resolve(inputFile));
});

test('main prints JSON report and supports --out', () => {
  const { inputFile, outputFile } = writeShadowLog([buildRecord()]);
  let output = '';

  const report = shadowReport.main([
    inputFile,
    '--out',
    outputFile
  ], {
    write(chunk) {
      output += chunk;
    }
  });
  const printed = JSON.parse(output);
  const saved = JSON.parse(fs.readFileSync(outputFile, 'utf8'));

  assert.equal(report.totalRecords, 1);
  assert.equal(printed.totalRecords, 1);
  assert.equal(saved.totalRecords, 1);
});

test('parseArgs defaults to dedicated shadow-mode log file', () => {
  assert.deepEqual(shadowReport.parseArgs([]), {
    inputFile: shadowModeLogger.DEFAULT_SHADOW_MODE_FILE,
    options: {}
  });

  assert.deepEqual(shadowReport.parseArgs(['custom-shadow.json', '--out', 'report.json']), {
    inputFile: 'custom-shadow.json',
    options: {
      outputFile: 'report.json'
    }
  });
});
