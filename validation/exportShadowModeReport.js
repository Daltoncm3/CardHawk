'use strict';

const fs = require('node:fs');
const path = require('node:path');

const shadowModeLogger = require('../utils/shadowModeLogger');

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

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

function increment(distribution, key) {
  const normalized = key || 'unknown';
  distribution[normalized] = (distribution[normalized] || 0) + 1;
}

function incrementSignals(distribution, signals = []) {
  for (const signal of asArray(signals)) {
    const source = typeof signal === 'string'
      ? signal
      : signal && typeof signal === 'object'
        ? signal.source || signal.type || signal.key || 'unknown'
        : 'unknown';
    increment(distribution, source || 'unknown');
  }
}

function summarizeComparison(records = []) {
  return records.reduce((summary, record) => {
    const comparison = asObject(record.comparison);
    const recommendation = comparison.existingRecommendation || 'unknown';

    increment(summary.existingRecommendationDistribution, recommendation);

    const readiness = record.decisionIntelligence?.overallReadiness || 'unknown';
    const key = `${recommendation}:${readiness}`;
    increment(summary.recommendationByReadiness, key);

    if (comparison.dealGatePassed === true) summary.dealGatePassedCount += 1;
    else if (comparison.dealGatePassed === false) summary.dealGateRejectedCount += 1;
    else summary.dealGateUnknownCount += 1;

    return summary;
  }, {
    existingRecommendationDistribution: {},
    recommendationByReadiness: {},
    dealGatePassedCount: 0,
    dealGateRejectedCount: 0,
    dealGateUnknownCount: 0
  });
}

function buildShadowModeReport(logState = {}, options = {}) {
  const records = asArray(logState.records);
  const overallReadinessDistribution = {};
  const blockerCounts = {};
  const cautionSignalCounts = {};
  const conflictCounts = {};
  const recommendationImpactDistribution = {};
  const nonNoneRecommendationImpactCount = records.filter((record) =>
    record.decisionIntelligence?.recommendationImpact !== 'none'
  ).length;

  for (const record of records) {
    const decision = asObject(record.decisionIntelligence);

    increment(overallReadinessDistribution, decision.overallReadiness || 'unknown');
    incrementSignals(blockerCounts, decision.blockers);
    incrementSignals(cautionSignalCounts, decision.cautionSignals);
    incrementSignals(conflictCounts, decision.conflicts);
    increment(recommendationImpactDistribution, decision.recommendationImpact || 'unknown');
  }

  return {
    source: 'shadow_mode_report_export',
    mode: 'offline_validation',
    generatedAt: options.generatedAt || new Date().toISOString(),
    inputFile: options.inputFile ? path.resolve(options.inputFile) : null,
    totalRecords: records.length,
    overallReadinessDistribution,
    blockerCounts,
    cautionSignalCounts,
    conflictCounts,
    comparisonVsExistingRecommendation: summarizeComparison(records),
    recommendationImpact: {
      expected: 'none',
      distribution: recommendationImpactDistribution,
      allNone: nonNoneRecommendationImpactCount === 0,
      nonNoneCount: nonNoneRecommendationImpactCount
    }
  };
}

function exportShadowModeReport(inputFile = shadowModeLogger.DEFAULT_SHADOW_MODE_FILE, options = {}) {
  const logState = readJsonFile(inputFile);
  const report = buildShadowModeReport(logState, {
    ...options,
    inputFile
  });

  if (options.outputFile) {
    writeJsonFile(options.outputFile, report);
  }

  return report;
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
    inputFile: positional[0] || shadowModeLogger.DEFAULT_SHADOW_MODE_FILE,
    options
  };
}

function main(argv = process.argv.slice(2), output = process.stdout) {
  const parsed = parseArgs(argv);
  const report = exportShadowModeReport(parsed.inputFile, parsed.options);

  output.write(`${JSON.stringify(report, null, 2)}\n`);
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
  buildShadowModeReport,
  exportShadowModeReport,
  main,
  parseArgs
};
