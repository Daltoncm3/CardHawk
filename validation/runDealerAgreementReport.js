'use strict';

const fs = require('node:fs');
const path = require('node:path');

const dealerAgreementScorer = require('./dealerAgreementScorer');

function ensureDirectoryFor(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeJsonFile(filePath, data) {
  ensureDirectoryFor(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function formatPercent(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${number}%` : '0%';
}

function formatSignalAgreement(scorecard = {}, key) {
  const signal = scorecard.perCategoryScorecard?.signals?.[key] || {};
  return formatPercent(signal.agreementPercent || 0);
}

function formatManualReviewList(listings = []) {
  if (!listings.length) return ['Listings requiring manual review: 0'];

  return [
    `Listings requiring manual review: ${listings.length}`,
    ...listings.map((listing) => {
      const title = listing.title ? ` - ${listing.title}` : '';
      const reasons = Array.isArray(listing.reasons) && listing.reasons.length
        ? ` (${listing.reasons.join(', ')})`
        : '';
      return `- ${listing.listingId || 'unknown'}${title}${reasons}`;
    })
  ];
}

function formatDealerAgreementReport(scorecard = {}) {
  const overall = scorecard.overallScorecard || {};

  return [
    'Dealer Agreement Scorecard',
    `Overall dealer agreement: ${formatPercent(overall.dealerAgreementPercent || 0)}`,
    `False positive rate: ${formatPercent(overall.falsePositiveRate || 0)}`,
    `False negative rate: ${formatPercent(overall.falseNegativeRate || 0)}`,
    `Average explanation score: ${overall.explanationScoreAverage || 0}`,
    `Blocker agreement: ${formatSignalAgreement(scorecard, 'blockers')}`,
    `Caution agreement: ${formatSignalAgreement(scorecard, 'cautionSignals')}`,
    `Supporting signal agreement: ${formatSignalAgreement(scorecard, 'supportingSignals')}`,
    `Conflict agreement: ${formatSignalAgreement(scorecard, 'conflicts')}`,
    ...formatManualReviewList(scorecard.listingsRequiringManualReview || [])
  ].join('\n');
}

function parseArgs(argv = []) {
  const options = {};
  const positional = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--out') {
      options.outputFile = argv[index + 1];
      index += 1;
    } else {
      positional.push(arg);
    }
  }

  return {
    inputFile: positional[0],
    outputFile: options.outputFile || null
  };
}

function runDealerAgreementReport(inputFile, options = {}) {
  if (!inputFile) {
    throw new Error('Usage: node validation/runDealerAgreementReport.js <decision-validation-report.json> [--out scorecard.json]');
  }

  const scorecard = dealerAgreementScorer.runDealerAgreementScoring(inputFile);

  if (options.outputFile) {
    writeJsonFile(options.outputFile, scorecard);
  }

  return {
    scorecard,
    summary: formatDealerAgreementReport(scorecard)
  };
}

function main(argv = process.argv.slice(2), output = process.stdout) {
  const parsed = parseArgs(argv);
  const result = runDealerAgreementReport(parsed.inputFile, {
    outputFile: parsed.outputFile
  });

  output.write(`${result.summary}\n`);
  return result;
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
  formatDealerAgreementReport,
  main,
  parseArgs,
  runDealerAgreementReport
};
