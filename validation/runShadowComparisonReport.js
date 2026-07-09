'use strict';

const fs = require('node:fs');
const path = require('node:path');

const comparator = require('./compareShadowVsProduction');
const shadowModeLogger = require('../utils/shadowModeLogger');

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

function getTopDisagreementCategories(disagreementCounts = {}, limit = 5) {
  return Object.entries(asObject(disagreementCounts))
    .sort((left, right) => {
      if (right[1] !== left[1]) return right[1] - left[1];
      return left[0].localeCompare(right[0]);
    })
    .slice(0, limit)
    .map(([category, count]) => ({ category, count }));
}

function formatTopDisagreementCategories(categories = []) {
  if (!categories.length) return ['Top disagreement categories: none'];

  return [
    'Top disagreement categories:',
    ...categories.map((item) => `- ${item.category}: ${item.count}`)
  ];
}

function buildScorecard(report = {}) {
  const summary = asObject(report.summary);
  const topDisagreementCategories = getTopDisagreementCategories(report.disagreementCounts);
  const disagreementCount = Object.values(asObject(report.disagreementCounts))
    .reduce((sum, value) => sum + Number(value || 0), 0);

  return {
    source: 'shadow_comparison_report_cli',
    mode: 'offline_validation',
    generatedAt: report.generatedAt || new Date().toISOString(),
    totalCompared: summary.totalShadowRecords || 0,
    matchedListings: summary.matchedListings || 0,
    disagreementCount,
    addedCautionCount: summary.additionalCautionCount || 0,
    reducedConfidenceCount: summary.reducedConfidenceCount || 0,
    manualReviewCount: summary.manualReviewCount || 0,
    topDisagreementCategories,
    comparisonReport: report
  };
}

function formatShadowComparisonScorecard(scorecard = {}) {
  return [
    'Shadow Comparison Scorecard',
    `Total compared: ${scorecard.totalCompared || 0}`,
    `Disagreement count: ${scorecard.disagreementCount || 0}`,
    `Added caution count: ${scorecard.addedCautionCount || 0}`,
    `Reduced confidence count: ${scorecard.reducedConfidenceCount || 0}`,
    `Manual review count: ${scorecard.manualReviewCount || 0}`,
    ...formatTopDisagreementCategories(scorecard.topDisagreementCategories || [])
  ].join('\n');
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

  return {
    shadowLogFile: options.shadowLogFile || (
      positional.length > 1 ? positional[0] : shadowModeLogger.DEFAULT_SHADOW_MODE_FILE
    ),
    productionInputFile: options.productionInputFile || (
      positional.length > 1 ? positional[1] : positional[0] || null
    ),
    outputFile: options.outputFile || null
  };
}

function runShadowComparisonReport(options = {}) {
  const shadowLogFile = options.shadowLogFile || shadowModeLogger.DEFAULT_SHADOW_MODE_FILE;
  const productionInputFile = options.productionInputFile || null;
  const report = productionInputFile
    ? comparator.compareShadowVsProduction(shadowLogFile, productionInputFile, {
      generatedAt: options.generatedAt
    })
    : comparator.buildShadowProductionComparison(
      readJsonFile(shadowLogFile),
      { results: [] },
      {
        generatedAt: options.generatedAt,
        shadowLogFile,
        productionInputFile: null
      }
    );
  const scorecard = buildScorecard(report);

  if (options.outputFile) {
    writeJsonFile(options.outputFile, scorecard);
  }

  return {
    scorecard,
    summary: formatShadowComparisonScorecard(scorecard)
  };
}

function main(argv = process.argv.slice(2), output = process.stdout) {
  const parsed = parseArgs(argv);
  const result = runShadowComparisonReport(parsed);

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
  buildScorecard,
  formatShadowComparisonScorecard,
  getTopDisagreementCategories,
  main,
  parseArgs,
  runShadowComparisonReport
};
