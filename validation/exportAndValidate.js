'use strict';

const fs = require('node:fs');
const path = require('node:path');

const scanExporter = require('./exportScanResults');
const decisionRunner = require('./runDecisionValidation');

const DEFAULT_STORE_FILE = path.join(__dirname, '..', 'data', 'cardhawk-data.json');
const DEFAULT_OUTPUT_ROOT = __dirname;

function safeTimestamp(value = new Date().toISOString()) {
  return String(value).replace(/[:.]/g, '-');
}

function ensureDirectoryFor(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function buildOutputPaths(options = {}) {
  const outputRoot = options.outputRoot || DEFAULT_OUTPUT_ROOT;
  const timestamp = safeTimestamp(options.timestamp || options.exportedAt || new Date().toISOString());

  return {
    exportFile: options.exportFile || path.join(outputRoot, 'exports', `scan-export-${timestamp}.json`),
    reportFile: options.reportFile || path.join(outputRoot, 'reports', `decision-validation-${timestamp}.json`)
  };
}

function summarizeReadiness(results = []) {
  return results.reduce((summary, result) => {
    const key = result.overallReadiness || 'unknown';
    summary[key] = (summary[key] || 0) + 1;
    return summary;
  }, {});
}

function buildWorkflowSummary(exportReport = {}, validationReport = {}, paths = {}) {
  const results = Array.isArray(validationReport.results) ? validationReport.results : [];

  return {
    source: 'cardhawk_export_and_validate_workflow',
    mode: 'offline_validation_workflow',
    exportFile: paths.exportFile ? path.resolve(paths.exportFile) : null,
    reportFile: paths.reportFile ? path.resolve(paths.reportFile) : null,
    exportedListings: Number(exportReport.listingCount || 0),
    validatedListings: Number(validationReport.listingCount || 0),
    missingEvidenceCount: Number(exportReport.missingEvidenceCount || 0),
    blockers: results.reduce((total, result) => total + (Array.isArray(result.blockers) ? result.blockers.length : 0), 0),
    cautions: results.reduce((total, result) => total + (Array.isArray(result.cautionSignals) ? result.cautionSignals.length : 0), 0),
    conflicts: results.reduce((total, result) => total + (Array.isArray(result.conflicts) ? result.conflicts.length : 0), 0),
    readiness: summarizeReadiness(results)
  };
}

function formatSummary(summary = {}) {
  return [
    'Decision Intelligence offline validation complete.',
    `Exported listings: ${summary.exportedListings || 0}`,
    `Validated listings: ${summary.validatedListings || 0}`,
    `Missing evidence: ${summary.missingEvidenceCount || 0}`,
    `Blockers: ${summary.blockers || 0}`,
    `Cautions: ${summary.cautions || 0}`,
    `Conflicts: ${summary.conflicts || 0}`,
    `Export file: ${summary.exportFile || ''}`,
    `Report file: ${summary.reportFile || ''}`
  ].join('\n');
}

function runExportAndValidate(inputFile = DEFAULT_STORE_FILE, options = {}) {
  const paths = buildOutputPaths(options);

  ensureDirectoryFor(paths.exportFile);
  ensureDirectoryFor(paths.reportFile);

  const exportReport = scanExporter.exportScanResults(inputFile, paths.exportFile, {
    all: options.all,
    limit: options.limit,
    since: options.since,
    exportedAt: options.exportedAt || options.timestamp
  });
  const validationReport = decisionRunner.runDecisionValidation(paths.exportFile, paths.reportFile, {
    generatedAt: options.generatedAt || options.timestamp
  });
  const summary = buildWorkflowSummary(exportReport, validationReport, paths);

  return {
    exportReport,
    validationReport,
    summary,
    exportFile: paths.exportFile,
    reportFile: paths.reportFile
  };
}

function parseArgs(argv = []) {
  const options = {};
  const positional = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--all') {
      options.all = true;
    } else if (arg === '--limit') {
      options.limit = Number(argv[index + 1]);
      index += 1;
    } else if (arg === '--since') {
      options.since = argv[index + 1];
      index += 1;
    } else if (arg === '--store') {
      options.inputFile = argv[index + 1];
      index += 1;
    } else if (arg === '--output-root') {
      options.outputRoot = argv[index + 1];
      index += 1;
    } else if (arg === '--export') {
      options.exportFile = argv[index + 1];
      index += 1;
    } else if (arg === '--report') {
      options.reportFile = argv[index + 1];
      index += 1;
    } else {
      positional.push(arg);
    }
  }

  return {
    inputFile: options.inputFile || positional[0] || DEFAULT_STORE_FILE,
    options
  };
}

function main(argv = process.argv.slice(2), output = process.stdout) {
  const parsed = parseArgs(argv);
  const result = runExportAndValidate(parsed.inputFile, parsed.options);

  output.write(`${formatSummary(result.summary)}\n`);
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
  buildOutputPaths,
  buildWorkflowSummary,
  formatSummary,
  runExportAndValidate,
  main
};
