'use strict';

const accuracyValidation = require('./realListingAccuracyValidation');

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    inputs: [],
    out: null
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--out') {
      args.out = argv[index + 1] || null;
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else {
      args.inputs.push(arg);
    }
  }

  return args;
}

function getUsage() {
  return [
    'Usage: node validation/runRealListingAccuracyReport.js <batch.json> [more-batches.json] [--out report.json]',
    '',
    'Offline only. Reads real-listing accuracy validation batches and produces an agreement report.'
  ].join('\n');
}

function printSummary(report = {}) {
  return [
    `Real listing accuracy report: ${report.totalListingsReviewed}/${report.totalListings} reviewed`,
    `Agreement: ${report.cardhawkVsDaltonAgreementRate}%`,
    `False positives: ${report.falsePositiveCount} (${report.falsePositiveRate}%)`,
    `Missed opportunities: ${report.missedOpportunityCount} (${report.missedOpportunityRate}%)`,
    `Valuation comparisons: ${report.valuationErrorSummary.comparedCount}`
  ].join('\n');
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);

  if (args.help || !args.inputs.length) {
    process.stdout.write(`${getUsage()}\n`);
    return null;
  }

  const report = accuracyValidation.runAccuracyValidationReport(args.inputs, args.out);

  if (args.out) {
    process.stdout.write(`${printSummary(report)}\nReport written to ${args.out}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  }

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
  getUsage,
  main,
  parseArgs,
  printSummary
};
