'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
  addSoldEvidenceRecord,
  createEmptySoldEvidenceStore,
  loadSoldEvidenceStore,
  saveSoldEvidenceStore
} = require('../utils/soldEvidenceStore');
const {
  isTrueSoldRecord,
  querySoldEvidence
} = require('../services/soldEvidenceService');
const {
  fingerprint
} = require('./canonicalValidationCore');
const {
  extractManualSoldRecords,
  validateManualSoldRecord
} = require('./manualSoldEvidenceImportHelper');

const SOURCE = 'owner_sold_evidence_batch_intake';
const VERSION = '1.0.0';
const EXISTING_VALUATION_TRUE_SOLD_MINIMUM = 3;

const VERIFIED_STATUSES = new Set([
  'dealer_verified',
  'human_verified',
  'owner_verified',
  'source_verified',
  'verified',
  'verified_manual'
]);

const RETAINABLE_STATUSES = new Set([
  'permanent_allowed',
  'restricted'
]);

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function normalizeToken(value, fallback = '') {
  return String(value || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, '_')
    .replace(/^_+|_+$/g, '') || fallback;
}

function normalizeRetentionStatus(record = {}) {
  const retention = asObject(record.retention || record.retentionMetadata);
  return normalizeToken(
    record.retentionStatus
      || retention.status
      || record.retentionClassification
      || '',
    'unknown'
  );
}

function getVerificationStatus(record = {}) {
  return normalizeToken(
    record.verificationStatus
      || record.review?.status
      || record.validation?.verificationStatus
      || record.source?.verificationStatus
      || '',
    ''
  );
}

function getAcquisitionMethod(record = {}) {
  return normalizeToken(
    record.acquisitionMethod
      || record.source?.retrievalMethod
      || record.source?.acquisitionMethod
      || '',
    ''
  );
}

function textIncludesAny(value = '', needles = []) {
  const text = String(value || '').toLowerCase();
  return needles.some((needle) => text.includes(needle));
}

function hasFixtureOrTestProvenance(record = {}) {
  const source = asObject(record.source);
  const values = [
    record.marketplace,
    record.sourceType,
    source.adapter,
    source.retrievalMethod,
    source.sourceReliability,
    source.sourceName,
    getAcquisitionMethod(record)
  ];

  return values.some((value) => textIncludesAny(value, [
    'fixture',
    'test',
    'mock',
    'synthetic',
    'offline_fixture'
  ]));
}

function validateOwnerBatchRecord(record = {}, options = {}) {
  const manualValidation = validateManualSoldRecord(record, options);
  const reasons = [...asArray(manualValidation.reasons)];
  const retentionStatus = normalizeRetentionStatus(record);
  const verificationStatus = getVerificationStatus(record);

  if (!verificationStatus || !VERIFIED_STATUSES.has(verificationStatus)) {
    reasons.push('missing_or_unverified_owner_verification_status');
  }

  if (!RETAINABLE_STATUSES.has(retentionStatus)) {
    reasons.push(`retention_not_permitted:${retentionStatus || 'unknown'}`);
  }

  if (hasFixtureOrTestProvenance(record)) {
    reasons.push('fixture_or_test_evidence_not_production_evidence');
  }

  return {
    valid: reasons.length === 0,
    reasons: [...new Set(reasons)].sort(),
    normalizedRecord: reasons.length === 0 ? manualValidation.normalizedRecord : null,
    canonicalValidation: manualValidation.canonicalValidation || null,
    retentionStatus,
    verificationStatus
  };
}

function prepareRecordForCanonicalInsertion(record = {}) {
  const nextRecord = clone(record);
  const retention = asObject(nextRecord.retention);

  if (Array.isArray(retention.retentionNotes) && !Array.isArray(retention.notes)) {
    nextRecord.retention = {
      ...retention,
      notes: [...retention.retentionNotes]
    };
  }

  return nextRecord;
}

function loadOwnerBatchRecords(options = {}) {
  if (options.input !== undefined) {
    if (options.input && typeof options.input === 'object' && Array.isArray(options.input.ownerSoldRecords)) {
      return options.input.ownerSoldRecords;
    }
    return extractManualSoldRecords(options.input);
  }
  if (!options.inputPath) return [];
  const payload = readJsonFile(options.inputPath);
  if (payload && typeof payload === 'object' && Array.isArray(payload.ownerSoldRecords)) {
    return payload.ownerSoldRecords;
  }
  return extractManualSoldRecords(payload);
}

function increment(target = {}, key = 'unknown') {
  const normalized = String(key || 'unknown');
  target[normalized] = (target[normalized] || 0) + 1;
}

function uniqueSorted(values = []) {
  return [...new Set(values.filter(Boolean))].sort();
}

function createEmptyReport(totalRecords = 0) {
  return {
    source: SOURCE,
    version: VERSION,
    recordsSubmitted: totalRecords,
    accepted: 0,
    rejected: 0,
    quarantined: 0,
    duplicates: 0,
    trueSoldRecordsAdded: 0,
    canonicalIdentitiesCreatedOrMatched: [],
    importedRecordIds: [],
    duplicateRecords: [],
    quarantineRecords: [],
    rejectionReasons: {},
    retentionSummary: {},
    provenanceSummary: {},
    targetReadiness: null,
    ownerActionRequired: []
  };
}

function addQuarantine(report, index, record = {}, reasons = []) {
  report.rejected += 1;
  report.quarantined += 1;
  const normalizedReasons = uniqueSorted(reasons.map((reason) => normalizeToken(reason, 'unknown_validation_failure')));
  report.quarantineRecords.push({
    index,
    recordId: record.id || record.marketplaceSaleId || record.marketplaceListingId || null,
    reasons: normalizedReasons
  });

  for (const reason of normalizedReasons) {
    increment(report.rejectionReasons, reason);
  }
}

function summarizeAcceptedRecord(report, record = {}) {
  if (!report.canonicalIdentitiesCreatedOrMatched.includes(record.canonicalCardKey)) {
    report.canonicalIdentitiesCreatedOrMatched.push(record.canonicalCardKey);
  }
  if (!report.importedRecordIds.includes(record.id)) report.importedRecordIds.push(record.id);
  increment(report.retentionSummary, record.retention?.status || 'unknown');
  increment(report.provenanceSummary, record.source?.retrievalMethod || 'unknown');
}

function identityFromRecords(records = []) {
  const first = records.find((record) => record?.parsedIdentity) || {};
  return first.parsedIdentity || {};
}

function buildTargetReadinessEntry(store = {}, canonicalCardKey = '', options = {}) {
  const result = querySoldEvidence(store, canonicalCardKey, { trueSoldOnly: true }, options);
  const records = asArray(result.records).filter(isTrueSoldRecord);
  const trueSoldCount = records.length;
  const minimumTrueSoldComps = Number(options.minimumTrueSoldComps || EXISTING_VALUATION_TRUE_SOLD_MINIMUM);

  return {
    canonicalCardKey,
    identity: identityFromRecords(records),
    trueSoldCount,
    minimumTrueSoldComps,
    readyForTargetedDiscoveryLane: trueSoldCount >= minimumTrueSoldComps,
    discoveryLaneActivated: false,
    medianSold: result.medianSold,
    weightedSoldAverage: result.weightedSoldAverage,
    newestSoldDate: result.newestSoldDate,
    sourceMix: result.sourceMix || {},
    evidenceRecordIds: records.map((record) => record.id).sort()
  };
}

function buildTargetReadinessReport(store = {}, options = {}) {
  const identityKeys = Object.keys(asObject(store.identityIndex)).sort();
  const entries = identityKeys.map((key) => buildTargetReadinessEntry(store, key, options));

  return {
    source: SOURCE,
    version: VERSION,
    minimumTrueSoldComps: Number(options.minimumTrueSoldComps || EXISTING_VALUATION_TRUE_SOLD_MINIMUM),
    identityCount: entries.length,
    readyIdentityCount: entries.filter((entry) => entry.readyForTargetedDiscoveryLane).length,
    belowMinimumIdentityCount: entries.filter((entry) => !entry.readyForTargetedDiscoveryLane).length,
    readyIdentities: entries.filter((entry) => entry.readyForTargetedDiscoveryLane),
    belowMinimumIdentities: entries.filter((entry) => !entry.readyForTargetedDiscoveryLane),
    entries,
    laneActivationPerformed: false
  };
}

function loadStore(options = {}) {
  if (options.store) return clone(options.store);
  if (options.storePath) return loadSoldEvidenceStore(options.storePath);
  return createEmptySoldEvidenceStore();
}

function importOwnerSoldEvidenceBatch(options = {}) {
  const records = loadOwnerBatchRecords(options);
  const report = createEmptyReport(records.length);
  let store = loadStore(options);

  records.forEach((record, index) => {
    const validation = validateOwnerBatchRecord(record, options);

    if (!validation.valid) {
      addQuarantine(report, index, record, validation.reasons);
      return;
    }

    const insertion = addSoldEvidenceRecord(
      store,
      prepareRecordForCanonicalInsertion(validation.normalizedRecord),
      { mutate: true }
    );
    store = insertion.store;

    if (insertion.duplicate) {
      report.duplicates += 1;
      report.duplicateRecords.push({
        index,
        id: validation.normalizedRecord.id,
        duplicateOf: insertion.duplicateOf,
        canonicalCardKey: insertion.record.canonicalCardKey
      });
      increment(report.rejectionReasons, 'duplicate_record');
      return;
    }

    report.accepted += 1;
    report.trueSoldRecordsAdded += 1;
    summarizeAcceptedRecord(report, insertion.record);
  });

  report.canonicalIdentitiesCreatedOrMatched.sort();
  report.importedRecordIds.sort();
  report.targetReadiness = buildTargetReadinessReport(store, options);
  report.ownerActionRequired = report.quarantined || report.duplicates
    ? ['review_quarantine_or_duplicates_before_reimport']
    : [];

  if (!options.dryRun && options.storePath) {
    saveSoldEvidenceStore(options.storePath, store);
  }

  return {
    source: SOURCE,
    version: VERSION,
    dryRun: Boolean(options.dryRun),
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none',
    report,
    store,
    batchFingerprint: buildOwnerSoldEvidenceBatchFingerprint({ report })
  };
}

function buildOwnerSoldEvidenceBatchFingerprint(value = {}) {
  const input = clone(value);
  if (input.batchFingerprint) delete input.batchFingerprint;
  return fingerprint(input);
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
    } else if (arg === '--minimum-true-sold-comps') {
      args.minimumTrueSoldComps = Number(argv[index + 1]);
      index += 1;
    }
  }

  return args;
}

function runCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const result = importOwnerSoldEvidenceBatch(args);
  const output = {
    source: result.source,
    version: result.version,
    dryRun: result.dryRun,
    productionImpact: result.productionImpact,
    decisionImpact: result.decisionImpact,
    executionAuthority: result.executionAuthority,
    report: result.report,
    batchFingerprint: result.batchFingerprint
  };
  const serialized = `${JSON.stringify(output, null, 2)}\n`;

  if (args.outPath) {
    fs.mkdirSync(path.dirname(args.outPath), { recursive: true });
    fs.writeFileSync(args.outPath, serialized);
  }

  process.stdout.write(serialized);
  return output;
}

if (require.main === module) {
  runCli();
}

module.exports = {
  EXISTING_VALUATION_TRUE_SOLD_MINIMUM,
  SOURCE,
  VERSION,
  buildOwnerSoldEvidenceBatchFingerprint,
  buildTargetReadinessReport,
  importOwnerSoldEvidenceBatch,
  loadOwnerBatchRecords,
  parseArgs,
  prepareRecordForCanonicalInsertion,
  runCli,
  validateOwnerBatchRecord
};
