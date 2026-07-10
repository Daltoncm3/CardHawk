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

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function extractRecords(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];

  for (const key of ['records', 'soldRecords', 'soldEvidence', 'verifiedSoldRecords']) {
    if (Array.isArray(payload[key])) return payload[key];
  }

  return [];
}

function isActiveListing(record = {}) {
  const evidenceType = String(record.evidenceType || record.type || '').toLowerCase();
  const status = String(record.status || record.listingStatus || record.itemStatus || '').toLowerCase();
  const sourceType = String(record.source?.type || record.sourceType || '').toLowerCase();

  if (record.sold === false || record.isSold === false) return true;
  if (evidenceType.includes('active')) return true;
  if (sourceType.includes('active')) return true;
  if (status.includes('active') || status.includes('available') || status.includes('listed')) return true;

  return false;
}

function soldPrice(record = {}) {
  const value = record.soldPrice ?? record.salePrice ?? record.price ?? record.amount ?? record.value;
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function soldDate(record = {}) {
  return record.soldAt || record.dateSold || record.soldDate || record.endedAt || record.saleDate || null;
}

function validateImportRecord(record = {}) {
  const reasons = [];

  if (isActiveListing(record)) {
    reasons.push('active_listing_not_true_sold');
  }

  if (soldPrice(record) <= 0) {
    reasons.push('missing_sold_price');
  }

  const date = new Date(soldDate(record) || '');
  if (!soldDate(record) || Number.isNaN(date.getTime())) {
    reasons.push('missing_sold_date');
  }

  return {
    valid: reasons.length === 0,
    reasons
  };
}

function createEmptySummary(received = 0) {
  return {
    received,
    imported: 0,
    duplicates: 0,
    rejected: 0,
    rejectionReasons: {},
    rejectedRecords: [],
    duplicateRecords: [],
    importedIds: []
  };
}

function addRejection(summary, index, reasons) {
  summary.rejected += 1;
  summary.rejectedRecords.push({ index, reasons: [...reasons] });

  for (const reason of reasons) {
    summary.rejectionReasons[reason] = (summary.rejectionReasons[reason] || 0) + 1;
  }
}

function loadInputRecords({ inputPath, input }) {
  if (input !== undefined) return extractRecords(input);
  if (!inputPath) return [];
  return extractRecords(readJsonFile(inputPath));
}

function importSoldEvidence(options = {}) {
  const records = loadInputRecords(options);
  const summary = createEmptySummary(records.length);
  const normalizeOptions = {
    adapter: options.adapter || 'manual_import',
    retrievalMethod: options.retrievalMethod || 'manual_import',
    sourceReliability: options.sourceReliability || 'verified_manual',
    includeRawRecord: Boolean(options.includeRawRecord)
  };
  let store = options.store
    || (options.storePath ? loadSoldEvidenceStore(options.storePath) : createEmptySoldEvidenceStore());

  records.forEach((record, index) => {
    const validation = validateImportRecord(record);

    if (!validation.valid) {
      addRejection(summary, index, validation.reasons);
      return;
    }

    const normalized = normalizeSoldEvidenceRecord(record, normalizeOptions);
    const result = addSoldEvidenceRecord(store, normalized, { mutate: true });
    store = result.store;

    if (result.duplicate) {
      summary.duplicates += 1;
      summary.duplicateRecords.push({
        index,
        id: normalized.id,
        duplicateOf: result.duplicateOf
      });
      return;
    }

    summary.imported += 1;
    summary.importedIds.push(result.record.id);
  });

  if (!options.dryRun && options.storePath) {
    saveSoldEvidenceStore(options.storePath, store);
  }

  return {
    dryRun: Boolean(options.dryRun),
    store,
    summary
  };
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    dryRun: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--input') {
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
  const result = importSoldEvidence(args);
  const output = {
    dryRun: result.dryRun,
    summary: result.summary
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
  extractRecords,
  importSoldEvidence,
  isActiveListing,
  parseArgs,
  runCli,
  validateImportRecord
};
