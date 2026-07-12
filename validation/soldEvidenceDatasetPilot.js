'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
  buildDatasetManifest,
  extractRecords,
  normalizeDatasetRecords
} = require('./soldEvidenceDatasetBuilder');
const {
  REQUIRED_IDENTITY_FIELDS,
  REQUIRED_STORE_SOURCE_FIELDS,
  REASON_CODES,
  asArray,
  asObject,
  buildMissingReason,
  getIdentityValue,
  hasIdentitySubject,
  normalizeDate,
  toNumber
} = require('./canonicalValidationCore');

const REQUIRED_SOURCE_FIELDS = REQUIRED_STORE_SOURCE_FIELDS;
const VERIFIED_REVIEW_STATUSES = new Set([
  'human_verified',
  'dealer_verified',
  'second_review_verified',
  'verified'
]);

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s/.-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeEnum(value, fallback = 'unknown') {
  return normalizeText(value).replace(/\s+/g, '_') || fallback;
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJsonFile(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

function hasProductIdentity(identity = {}) {
  return Boolean(identity.brand || identity.product || identity.manufacturer);
}

function hasParallelIdentity(identity = {}) {
  return Boolean(identity.parallel || identity.variation || identity.color);
}

function validateExactIdentity(record = {}) {
  const reasons = [];
  const identity = asObject(record.parsedIdentity || record.identity || record.parsed);

  for (const field of REQUIRED_IDENTITY_FIELDS) {
    if (!getIdentityValue(identity, field)) {
      reasons.push(buildMissingReason(REASON_CODES.MISSING_IDENTITY_PREFIX, field));
    }
  }
  if (!hasIdentitySubject(identity)) reasons.push(REASON_CODES.MISSING_IDENTITY_SUBJECT);
  if (!hasProductIdentity(identity)) reasons.push('missing_identity_brand_or_product');
  if (!hasParallelIdentity(identity)) reasons.push('missing_identity_parallel_or_base');
  if (identity.rookie === undefined && identity.isRookie === undefined) reasons.push('missing_identity_rookie_flag');
  if (identity.autograph === undefined && identity.auto === undefined && identity.isAutograph === undefined) reasons.push('missing_identity_autograph_flag');
  if (identity.memorabilia === undefined && identity.relic === undefined && identity.patch === undefined) reasons.push('missing_identity_memorabilia_flag');
  if (identity.serialNumbered === undefined && identity.numbered === undefined && identity.isNumbered === undefined) reasons.push('missing_identity_serial_numbered_flag');

  return {
    valid: reasons.length === 0,
    reasons
  };
}

function validateRecordForPilot(record = {}) {
  const reasons = [];
  const source = asObject(record.source);
  const review = asObject(record.review);
  const evidenceType = normalizeEnum(record.evidenceType || 'true_sold');
  const status = normalizeEnum(record.status || 'active_evidence');
  const soldPrice = toNumber(record.soldPrice ?? record.salePrice ?? record.price ?? record.amount, 0);
  const soldAt = normalizeDate(record.soldAt || record.dateSold || record.soldDate || record.endedAt || record.saleDate);
  const reviewStatus = normalizeEnum(record.reviewStatus || review.status, 'unreviewed');
  const identityValidation = validateExactIdentity(record);

  if (evidenceType !== 'true_sold') reasons.push(REASON_CODES.NOT_TRUE_SOLD_EVIDENCE);
  if (status !== 'active_evidence') reasons.push(REASON_CODES.INACTIVE_OR_CONTEXT_RECORD);
  if (soldPrice <= 0) reasons.push(REASON_CODES.MISSING_SOLD_PRICE);
  if (!soldAt) reasons.push(REASON_CODES.MISSING_SOLD_DATE);
  if (!record.url && !record.itemWebUrl) reasons.push(REASON_CODES.MISSING_SOURCE_URL);
  if (!VERIFIED_REVIEW_STATUSES.has(reviewStatus)) reasons.push('not_human_verified');
  if (!review.reviewer && !record.reviewer) reasons.push('missing_reviewer');
  if (!review.reviewedAt && !record.reviewedAt) reasons.push('missing_reviewed_at');

  for (const field of REQUIRED_SOURCE_FIELDS) {
    if (!source[field]) reasons.push(buildMissingReason(REASON_CODES.MISSING_SOURCE_PREFIX, field));
  }
  reasons.push(...identityValidation.reasons);

  return {
    valid: reasons.length === 0,
    reasons
  };
}

function sourceRecordKey(record = {}) {
  const source = asObject(record.source);
  const marketplace = normalizeText(record.marketplace || source.marketplace || 'unknown');
  const sourceRecordId = normalizeText(source.sourceRecordId || record.sourceRecordId || '');
  if (sourceRecordId) return `${marketplace}:source:${sourceRecordId}`;
  const url = normalizeText(record.url || record.itemWebUrl || '');
  return url ? `${marketplace}:url:${url}` : '';
}

function saleKey(record = {}) {
  const marketplace = normalizeText(record.marketplace || record.source?.marketplace || 'unknown');
  const saleId = normalizeText(record.marketplaceSaleId || record.saleId || record.orderLineItemId || '');
  if (saleId) return `${marketplace}:sale:${saleId}`;

  const soldAt = normalizeDate(record.soldAt || record.dateSold || record.soldDate || record.endedAt || record.saleDate) || 'unknown-date';
  const listingId = normalizeText(record.marketplaceListingId || record.listingId || record.ebayItemId || record.itemId || '');
  if (listingId) return `${marketplace}:listing:${listingId}:${normalizeText(soldAt)}`;
  const url = normalizeText(record.url || record.itemWebUrl || '');
  return url ? `${marketplace}:url:${url}:${normalizeText(soldAt)}` : '';
}

function duplicateGroups(records = [], keyBuilder) {
  const index = {};
  records.forEach((record, position) => {
    const key = keyBuilder(record);
    if (!key || key.replace(/:/g, '') === '') return;
    if (!index[key]) index[key] = [];
    index[key].push({ position, id: record.id || record.marketplaceSaleId || record.url || null });
  });

  return Object.entries(index)
    .filter(([, entries]) => entries.length > 1)
    .map(([key, entries]) => ({ key, entries }));
}

function loadBatchFile(filePath) {
  const payload = readJsonFile(filePath);
  const records = extractRecords(payload);

  return {
    filePath,
    metadata: asObject(payload.metadata),
    batchId: payload.batchId || payload.metadata?.batchId || path.basename(filePath, path.extname(filePath)),
    records
  };
}

function buildBatchValidationReport(batches = []) {
  const allRecords = batches.flatMap((batch) => batch.records);
  const recordResults = [];
  const reasonCounts = {};

  batches.forEach((batch, batchIndex) => {
    batch.records.forEach((record, recordIndex) => {
      const validation = validateRecordForPilot(record);
      if (!validation.valid) {
        for (const reason of validation.reasons) {
          reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
        }
      }
      recordResults.push({
        batchId: batch.batchId,
        batchIndex,
        recordIndex,
        id: record.id || record.marketplaceSaleId || record.url || null,
        valid: validation.valid,
        reasons: validation.reasons
      });
    });
  });

  const duplicateSourceRecords = duplicateGroups(allRecords, sourceRecordKey);
  const duplicateSales = duplicateGroups(allRecords, saleKey);

  return {
    batchCount: batches.length,
    receivedRecords: allRecords.length,
    validRecords: recordResults.filter((result) => result.valid).length,
    invalidRecords: recordResults.filter((result) => !result.valid).length,
    reasonCounts,
    recordResults,
    duplicateSourceRecords,
    duplicateSales
  };
}

function buildDatasetPopulationPilot(batchInputs = [], options = {}) {
  const batches = batchInputs.map((input) => typeof input === 'string' ? loadBatchFile(input) : input);
  const records = batches.flatMap((batch) => asArray(batch.records));
  const normalizedRecords = normalizeDatasetRecords(records);
  const validationReport = buildBatchValidationReport(batches);
  const manifest = buildDatasetManifest({
    metadata: {
      datasetId: options.datasetId || 'manual-canonical-sold-evidence-pilot',
      name: options.name || 'Manual Canonical Sold Evidence Population Pilot',
      description: 'Offline manually verified canonical sold evidence dataset pilot.'
    },
    targets: options.targets,
    records: normalizedRecords
  }, options);

  return {
    source: 'cardhawk_sold_evidence_dataset_population_pilot',
    mode: 'offline_manual_dataset_population',
    generatedAt: options.generatedAt || new Date().toISOString(),
    batchSummary: {
      batchCount: batches.length,
      batches: batches.map((batch) => ({
        batchId: batch.batchId,
        filePath: batch.filePath || null,
        recordCount: batch.records.length
      }))
    },
    validationReport,
    manifest
  };
}

function parseArgs(argv = []) {
  const args = {
    batchFiles: [],
    options: {}
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--batch') {
      args.batchFiles.push(argv[index + 1]);
      index += 1;
    } else if (arg === '--out') {
      args.outFile = argv[index + 1];
      index += 1;
    } else if (arg === '--dataset-id') {
      args.options.datasetId = argv[index + 1];
      index += 1;
    } else if (arg === '--name') {
      args.options.name = argv[index + 1];
      index += 1;
    } else if (arg === '--sample-size') {
      args.options.sampleSize = Number(argv[index + 1]);
      index += 1;
    } else if (arg === '--seed') {
      args.options.seed = argv[index + 1];
      index += 1;
    } else if (arg === '--target-identities') {
      args.options.targets = { ...args.options.targets, uniqueIdentities: Number(argv[index + 1]) };
      index += 1;
    } else if (arg === '--target-records') {
      args.options.targets = { ...args.options.targets, verifiedSoldRecords: Number(argv[index + 1]) };
      index += 1;
    } else {
      args.batchFiles.push(arg);
    }
  }

  return args;
}

function runCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args.batchFiles.length) throw new Error('At least one --batch file is required');
  const report = buildDatasetPopulationPilot(args.batchFiles, args.options);

  if (args.outFile) {
    writeJsonFile(args.outFile, report);
  }

  const summary = {
    datasetId: report.manifest.metadata.datasetId,
    batches: report.batchSummary.batchCount,
    receivedRecords: report.validationReport.receivedRecords,
    validRecords: report.validationReport.validRecords,
    invalidRecords: report.validationReport.invalidRecords,
    duplicateSourceRecordGroups: report.validationReport.duplicateSourceRecords.length,
    duplicateSaleGroups: report.validationReport.duplicateSales.length,
    verifiedSoldRecords: report.manifest.coverageReport.verifiedSoldRecordCount,
    uniqueIdentities: report.manifest.coverageReport.uniqueIdentityCount,
    readyForCanonicalValuationShadow: report.manifest.coverageReport.targetProgress.readyForCanonicalValuationShadow
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  return report;
}

if (require.main === module) {
  try {
    runCli();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  buildBatchValidationReport,
  buildDatasetPopulationPilot,
  duplicateGroups,
  loadBatchFile,
  parseArgs,
  runCli,
  saleKey,
  sourceRecordKey,
  validateExactIdentity,
  validateRecordForPilot
};
