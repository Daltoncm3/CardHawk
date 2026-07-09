'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const reportCli = require('../validation/runDealerAgreementReport');

function buildResult(overrides = {}) {
  return {
    listing: {
      id: 'listing-1',
      title: 'Dealer Report Test Listing'
    },
    overallReadiness: 'supported_context',
    evidencePosture: 'strong',
    compPosture: 'strong',
    valuationPosture: 'strong_range',
    resalePressurePosture: 'low',
    confidence: 90,
    supportingSignals: [
      { source: 'evidence_sufficiency' },
      { source: 'listing_similarity' },
      { source: 'comparable_quality' },
      { source: 'valuation_range' },
      { source: 'supply_pressure' }
    ],
    cautionSignals: [],
    blockers: [],
    conflicts: [],
    expected: {
      overallReadiness: 'supported_context',
      evidencePosture: 'strong',
      compPosture: 'strong',
      valuationPosture: 'strong_range',
      resalePressurePosture: 'low',
      supportingSignalSources: [
        'evidence_sufficiency',
        'listing_similarity',
        'comparable_quality',
        'valuation_range',
        'supply_pressure'
      ],
      cautionSignalSources: [],
      blockerSources: [],
      conflictSources: [],
      explanationScore: 5,
      falsePositive: false,
      falseNegative: false
    },
    ...overrides
  };
}

function writeReport(results) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cardhawk-dealer-report-cli-'));
  const inputFile = path.join(tempDir, 'decision-validation-report.json');
  const outputFile = path.join(tempDir, 'dealer-scorecard.json');

  fs.writeFileSync(inputFile, `${JSON.stringify({ results }, null, 2)}\n`);

  return { tempDir, inputFile, outputFile };
}

test('runDealerAgreementReport prints a concise scorecard summary', () => {
  const { inputFile } = writeReport([buildResult()]);
  const result = reportCli.runDealerAgreementReport(inputFile);

  assert.match(result.summary, /Dealer Agreement Scorecard/);
  assert.match(result.summary, /Overall dealer agreement: 100%/);
  assert.match(result.summary, /False positive rate: 0%/);
  assert.match(result.summary, /False negative rate: 0%/);
  assert.match(result.summary, /Average explanation score: 5/);
  assert.match(result.summary, /Blocker agreement: 100%/);
  assert.match(result.summary, /Caution agreement: 100%/);
  assert.match(result.summary, /Supporting signal agreement: 100%/);
  assert.match(result.summary, /Conflict agreement: 100%/);
  assert.match(result.summary, /Listings requiring manual review: 0/);
});

test('runDealerAgreementReport optionally writes scorecard JSON with --out target', () => {
  const { inputFile, outputFile } = writeReport([buildResult()]);
  const result = reportCli.runDealerAgreementReport(inputFile, { outputFile });
  const saved = JSON.parse(fs.readFileSync(outputFile, 'utf8'));

  assert.equal(saved.source, 'dealer_agreement_scorer');
  assert.equal(saved.overallScorecard.totalListings, 1);
  assert.equal(saved.overallScorecard.dealerAgreementPercent, 100);
  assert.equal(result.scorecard.overallScorecard.totalListings, 1);
});

test('main parses input and --out then writes summary to provided stream', () => {
  const { inputFile, outputFile } = writeReport([buildResult()]);
  let output = '';

  const result = reportCli.main([
    inputFile,
    '--out',
    outputFile
  ], {
    write(chunk) {
      output += chunk;
    }
  });

  assert.match(output, /Dealer Agreement Scorecard/);
  assert.equal(fs.existsSync(outputFile), true);
  assert.equal(result.scorecard.overallScorecard.dealerAgreementPercent, 100);
});

test('summary lists manual-review listings when dealer agreement differs', () => {
  const { inputFile } = writeReport([
    buildResult({
      listing: {
        id: 'review-me',
        title: 'Needs Dealer Review'
      },
      overallReadiness: 'limited_context',
      blockers: [{ source: 'evidence_sufficiency' }]
    })
  ]);
  const result = reportCli.runDealerAgreementReport(inputFile);

  assert.match(result.summary, /Overall dealer agreement: 0%/);
  assert.match(result.summary, /Blocker agreement: 0%/);
  assert.match(result.summary, /Listings requiring manual review: 1/);
  assert.match(result.summary, /review-me - Needs Dealer Review/);
  assert.match(result.summary, /posture disagreement, signal disagreement/);
});

test('parseArgs accepts positional input and optional out path', () => {
  assert.deepEqual(
    reportCli.parseArgs(['report.json', '--out', 'scorecard.json']),
    {
      inputFile: 'report.json',
      outputFile: 'scorecard.json'
    }
  );
});
