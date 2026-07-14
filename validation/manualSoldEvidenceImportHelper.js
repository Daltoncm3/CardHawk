'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
  addSoldEvidenceRecord,
  createEmptySoldEvidenceStore,
  loadSoldEvidenceStore,
  normalizeSoldEvidenceRecord,
  saveSoldEvidenceStore
} = require('../utils/soldEvidenceStore');
const {
  validateCanonicalRecord
} = require('./soldEvidenceStoreConformance');

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function extractManualSoldRecords(payload = {}) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];

  for (const key of ['records', 'soldRecords', 'soldEvidence', 'verifiedSoldRecords', 'manualSoldRecords']) {
    if (Array.isArray(payload[key])) return payload[key];
  }

  return [];
}

function normalizeReason(reason = '') {
  return String(reason || 'unknown_validation_failure')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'unknown_validation_failure';
}

function getSoldPrice(record = {}) {
  const number = Number(record.soldPrice ?? record.salePrice ?? record.price ?? record.amount ?? record.value);
  return Number.isFinite(number) ? number : 0;
}

function getSoldDate(record = {}) {
  return record.soldAt || record.dateSold || record.soldDate || record.endedAt || record.saleDate || null;
}

function isValidDate(value) {
  const date = new Date(value || '');
  return Boolean(value) && !Number.isNaN(date.getTime());
}

function isActiveOrContextRecord(record = {}) {
  const evidenceType = String(record.evidenceType || record.type || '').toLowerCase();
  const status = String(record.status || record.listingStatus || record.itemStatus || '').toLowerCase();
  const sourceType = String(record.source?.type || record.sourceType || '').toLowerCase();

  if (record.sold === false || record.isSold === false) return true;
  if (evidenceType.includes('active') || evidenceType.includes('aggregate')) return true;
  if (sourceType.includes('active') || sourceType.includes('aggregate')) return true;
  if (status.includes('active') || status.includes('available') || status.includes('listed') || status.includes('context')) return true;
  return false;
}

function prevalidateManualRecord(record = {}) {
  const reasons = [];
  const source = asObject(record.source);
  const identity = asObject(record.parsedIdentity || record.identity || record.parsed);

  if (isActiveOrContextRecord(record)) reasons.push('not_true_sold_evidence');
  if (getSoldPrice(record) <= 0) reasons.push('missing_sold_price');
  if (!isValidDate(getSoldDate(record))) reasons.push('missing_sold_date');
  if (!Object.keys(identity).length) reasons.push('missing_identity');
  if (!record.url && !record.itemWebUrl) reasons.push('missing_source_url');
  if (!source.adapter) reasons.push('missing_source_adapter');
  if (!source.retrievalMethod) reasons.push('missing_source_retrieval_method');
  if (!source.sourceReliability) reasons.push('missing_source_reliability');
  if (!isValidDate(source.acquiredAt)) reasons.push('missing_source_acquired_at');

  return {
    valid: reasons.length === 0,
    reasons
  };
}

function validateManualSoldRecord(record = {}, options = {}) {
  const prevalidation = prevalidateManualRecord(record);
  if (!prevalidation.valid) {
    return {
      valid: false,
      reasons: prevalidation.reasons.map(normalizeReason),
      normalizedRecord: null,
      canonicalValidation: null
    };
  }

  const normalized = normalizeSoldEvidenceRecord(record, {
    adapter: record.source?.adapter || options.adapter || 'manual_verified_import',
    retrievalMethod: record.source?.retrievalMethod || options.retrievalMethod || 'manual_verified_import',
    sourceReliability: record.source?.sourceReliability || options.sourceReliability || 'verified_manual',
    acquiredAt: record.source?.acquiredAt || options.acquiredAt,
    includeRawRecord: Boolean(options.includeRawRecord)
  });
  const canonicalValidation = validateCanonicalRecord(normalized);

  return {
    valid: canonicalValidation.valid,
    reasons: asArray(canonicalValidation.reasons).map(normalizeReason),
    normalizedRecord: normalized,
    canonicalValidation
  };
}

function createEmptyReport(totalRecords = 0, startedAt = '') {
  return {
    totalRecords,
    importedRecords: 0,
    rejectedRecords: 0,
    duplicateRecords: 0,
    validationFailures: [],
    importedIdentityKeys: [],
    importedSaleIds: [],
    rejectionReasons: {},
    processingTime: {
      startedAt,
      finishedAt: '',
      durationMs: 0
    },
    sourceSummary: {
      marketplaces: {},
      adapters: {},
      sourceReliability: {},
      retrievalMethods: {}
    }
  };
}

function increment(target = {}, key = 'unknown') {
  const normalized = String(key || 'unknown');
  target[normalized] = (target[normalized] || 0) + 1;
}

function addRejection(report, index, reasons = [], recordId = null) {
  report.rejectedRecords += 1;
  const normalizedReasons = reasons.map(normalizeReason);
  report.validationFailures.push({ index, recordId, reasons: normalizedReasons });

  for (const reason of normalizedReasons) {
    report.rejectionReasons[reason] = (report.rejectionReasons[reason] || 0) + 1;
  }
}

function addSourceSummary(report, record = {}) {
  increment(report.sourceSummary.marketplaces, record.marketplace || record.marketplaceLabel || 'unknown');
  increment(report.sourceSummary.adapters, record.source?.adapter || 'unknown');
  increment(report.sourceSummary.sourceReliability, record.source?.sourceReliability || 'unknown');
  increment(report.sourceSummary.retrievalMethods, record.source?.retrievalMethod || 'unknown');
}

function loadRecords(options = {}) {
  if (options.input !== undefined) return extractManualSoldRecords(options.input);
  if (!options.inputPath) return [];
  return extractManualSoldRecords(readJsonFile(options.inputPath));
}

function getClock(options = {}) {
  if (typeof options.now === 'function') return options.now;
  if (options.now) return () => options.now;
  return () => new Date().toISOString();
}

function elapsedMs(startedAt, finishedAt) {
  const start = new Date(startedAt || '').getTime();
  const finish = new Date(finishedAt || '').getTime();
  if (!Number.isFinite(start) || !Number.isFinite(finish)) return 0;
  return Math.max(0, finish - start);
}

function importManualSoldEvidence(options = {}) {
  const now = getClock(options);
  const startedAt = now();
  const records = loadRecords(options);
  const report = createEmptyReport(records.length, startedAt);
  let store = options.store
    || (options.storePath ? loadSoldEvidenceStore(options.storePath) : createEmptySoldEvidenceStore());

  records.forEach((record, index) => {
    const validation = validateManualSoldRecord(record, options);

    if (!validation.valid) {
      addRejection(report, index, validation.reasons, record.id || record.marketplaceSaleId || null);
      return;
    }

    const insertion = addSoldEvidenceRecord(store, validation.normalizedRecord, { mutate: true });
    store = insertion.store;

    if (insertion.duplicate) {
      report.duplicateRecords += 1;
      report.validationFailures.push({
        index,
        recordId: validation.normalizedRecord.id,
        duplicateOf: insertion.duplicateOf,
        reasons: ['duplicate_record']
      });
      report.rejectionReasons.duplicate_record = (report.rejectionReasons.duplicate_record || 0) + 1;
      return;
    }

    report.importedRecords += 1;
    if (!report.importedIdentityKeys.includes(insertion.record.canonicalCardKey)) {
      report.importedIdentityKeys.push(insertion.record.canonicalCardKey);
    }
    if (insertion.record.marketplaceSaleId && !report.importedSaleIds.includes(insertion.record.marketplaceSaleId)) {
      report.importedSaleIds.push(insertion.record.marketplaceSaleId);
    }
    addSourceSummary(report, insertion.record);
  });

  report.importedIdentityKeys.sort();
  report.importedSaleIds.sort();
  report.processingTime.finishedAt = now();
  report.processingTime.durationMs = elapsedMs(report.processingTime.startedAt, report.processingTime.finishedAt);

  if (!options.dryRun && options.storePath) {
    saveSoldEvidenceStore(options.storePath, store);
  }

  return {
    source: 'manual_sold_evidence_import_helper',
    version: '1.0.0',
    dryRun: Boolean(options.dryRun),
    report,
    store
  };
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = { dryRun: false };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--input') {
      args.inputPath = argv[index + 1];
      index += 1;
    } else if (arg === '--store') {
      args.storePath = argv[index + 1];
      index += 1;
    } else if (arg === '--out') {
      args.outPath = argv[index + 1];
      index += 1;
    }
  }

  return args;
}

function runCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const result = importManualSoldEvidence(args);
  const output = {
    source: result.source,
    version: result.version,
    dryRun: result.dryRun,
    report: result.report
  };
  const serialized = JSON.stringify(output, null, 2);

  if (args.outPath) {
    fs.mkdirSync(path.dirname(args.outPath), { recursive: true });
    fs.writeFileSync(args.outPath, `${serialized}\n`);
  }

  console.log(serialized);
  return output;
}

if (require.main === module) {
  runCli();
}

module.exports = {
  extractManualSoldRecords,
  importManualSoldEvidence,
  parseArgs,
  prevalidateManualRecord,
  readJsonFile,
  runCli,
  validateManualSoldRecord
};
