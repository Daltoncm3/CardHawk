'use strict';

const {
  SOURCE,
  STORE_VERSION,
  addSoldEvidenceRecords,
  buildCanonicalCardKey,
  createEmptySoldEvidenceStore,
  normalizeSoldEvidenceRecord
} = require('../utils/soldEvidenceStore');

const HARNESS_VERSION = '1.0.0';

const REQUIRED_RECORD_FIELDS = [
  'id',
  'evidenceType',
  'marketplace',
  'rawTitle',
  'normalizedTitle',
  'soldPrice',
  'totalPaid',
  'soldAt',
  'url',
  'parsedIdentity',
  'canonicalCardKey',
  'source',
  'status',
  'duplicateKeys'
];

const REQUIRED_IDENTITY_FIELDS = [
  'category',
  'year',
  'setName',
  'cardNumber'
];

const REQUIRED_SOURCE_FIELDS = [
  'adapter',
  'retrievalMethod',
  'sourceReliability',
  'acquiredAt'
];

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function createCheck(name, pass, details = {}) {
  return {
    name,
    pass: Boolean(pass),
    details
  };
}

function extractRecords(input = {}) {
  if (Array.isArray(input)) return input;
  if (!input || typeof input !== 'object') return [];
  if (input.records && !Array.isArray(input.records)) return Object.values(input.records);

  for (const key of ['records', 'soldRecords', 'soldEvidence', 'verifiedSoldRecords']) {
    if (Array.isArray(input[key])) return input[key];
  }

  return [];
}

function missingFields(record = {}, fields = []) {
  return fields.filter((field) => {
    const value = record[field];
    if (Array.isArray(value)) return value.length === 0;
    if (value && typeof value === 'object') return Object.keys(value).length === 0;
    return value === undefined || value === null || value === '';
  });
}

function hasSubject(identity = {}) {
  return Boolean(identity.player || identity.subject || identity.character);
}

function validateIdentity(record = {}) {
  const identity = asObject(record.parsedIdentity);
  const reasons = missingFields(identity, REQUIRED_IDENTITY_FIELDS).map((field) => `missing_identity_${field}`);

  if (!hasSubject(identity)) reasons.push('missing_identity_subject');
  if (record.canonicalCardKey !== buildCanonicalCardKey(identity)) {
    reasons.push('canonical_card_key_mismatch');
  }

  return {
    valid: reasons.length === 0,
    reasons
  };
}

function validateProvenance(record = {}) {
  const source = asObject(record.source);
  const reasons = missingFields(source, REQUIRED_SOURCE_FIELDS).map((field) => `missing_source_${field}`);

  if (!normalizeDate(source.acquiredAt)) reasons.push('invalid_source_acquiredAt');
  if (!record.url && !record.itemWebUrl) reasons.push('missing_source_url');

  return {
    valid: reasons.length === 0,
    reasons
  };
}

function validateEvidenceType(record = {}) {
  const reasons = [];

  if (record.evidenceType !== 'true_sold') reasons.push('not_true_sold_evidence');
  if (record.status !== 'active_evidence') reasons.push('inactive_or_context_record');

  return {
    valid: reasons.length === 0,
    reasons
  };
}

function validateTransactionEligibility(record = {}) {
  const reasons = [];

  if (toNumber(record.soldPrice, 0) <= 0) reasons.push('missing_sold_price');
  if (!normalizeDate(record.soldAt)) reasons.push('missing_sold_date');
  if (record.bestOfferAccepted && record.priceDisclosure === 'undisclosed') {
    reasons.push('undisclosed_best_offer_price');
  }

  return {
    valid: reasons.length === 0,
    reasons
  };
}

function validateImmutableRequirements(record = {}) {
  const reasons = [];
  const immutableFields = ['id', 'canonicalCardKey', 'duplicateKeys'];

  reasons.push(...missingFields(record, immutableFields).map((field) => `missing_immutable_${field}`));
  if (Array.isArray(record.duplicateKeys) && !record.duplicateKeys.includes(`url:${String(record.url || '').toLowerCase()}`) && !record.marketplaceSaleId && !record.marketplaceListingId) {
    reasons.push('weak_duplicate_identity');
  }

  return {
    valid: reasons.length === 0,
    reasons
  };
}

function validateCanonicalRecord(record = {}) {
  const schemaReasons = missingFields(record, REQUIRED_RECORD_FIELDS).map((field) => `missing_schema_${field}`);
  const identity = validateIdentity(record);
  const provenance = validateProvenance(record);
  const evidenceType = validateEvidenceType(record);
  const transactionEligibility = validateTransactionEligibility(record);
  const immutable = validateImmutableRequirements(record);
  const reasons = [
    ...schemaReasons,
    ...identity.reasons,
    ...provenance.reasons,
    ...evidenceType.reasons,
    ...transactionEligibility.reasons,
    ...immutable.reasons
  ];

  return {
    valid: reasons.length === 0,
    reasons,
    checks: {
      schema: schemaReasons,
      identity: identity.reasons,
      provenance: provenance.reasons,
      evidenceType: evidenceType.reasons,
      transactionEligibility: transactionEligibility.reasons,
      immutable: immutable.reasons
    }
  };
}

function validateVersionCompatibility(store = {}) {
  const reasons = [];

  if (store.source !== SOURCE) reasons.push('store_source_mismatch');
  if (store.version !== STORE_VERSION) reasons.push('store_version_mismatch');

  return {
    valid: reasons.length === 0,
    reasons,
    expected: {
      source: SOURCE,
      version: STORE_VERSION
    },
    actual: {
      source: store.source,
      version: store.version
    }
  };
}

function validateStoreIndexes(store = {}) {
  const reasons = [];
  const records = asObject(store.records);
  const duplicateIndex = asObject(store.duplicateIndex);
  const identityIndex = asObject(store.identityIndex);

  for (const [id, record] of Object.entries(records)) {
    if (record.id !== id) reasons.push(`record_id_key_mismatch:${id}`);
    if (!asArray(identityIndex[record.canonicalCardKey]).includes(id)) {
      reasons.push(`identity_index_missing:${id}`);
    }
    for (const duplicateKey of asArray(record.duplicateKeys)) {
      if (duplicateIndex[duplicateKey] !== id) reasons.push(`duplicate_index_mismatch:${id}`);
    }
  }

  const stats = asObject(store.stats);
  if (stats.recordCount !== Object.keys(records).length) reasons.push('stats_record_count_mismatch');
  if (stats.identityCount !== Object.keys(identityIndex).length) reasons.push('stats_identity_count_mismatch');
  if (stats.duplicateKeyCount !== Object.keys(duplicateIndex).length) reasons.push('stats_duplicate_key_count_mismatch');

  return {
    valid: reasons.length === 0,
    reasons
  };
}

function normalizeCandidates(records = [], options = {}) {
  return asArray(records).map((record) => {
    const normalized = normalizeSoldEvidenceRecord(record, {
      adapter: options.adapter || record.source?.adapter || 'store_conformance_fixture',
      retrievalMethod: options.retrievalMethod || record.source?.retrievalMethod || 'offline_conformance',
      sourceReliability: options.sourceReliability || record.source?.sourceReliability || 'fixture',
      acquiredAt: options.acquiredAt || record.source?.acquiredAt || '2026-07-10T00:00:00.000Z'
    });

    if (record.evidenceType) normalized.evidenceType = String(record.evidenceType).toLowerCase().replace(/[\s-]+/g, '_');
    if (record.status) normalized.status = record.status;
    if (record.source && Object.prototype.hasOwnProperty.call(record.source, 'adapter')) normalized.source.adapter = record.source.adapter;
    if (record.source && Object.prototype.hasOwnProperty.call(record.source, 'retrievalMethod')) normalized.source.retrievalMethod = record.source.retrievalMethod;
    if (record.source && Object.prototype.hasOwnProperty.call(record.source, 'sourceReliability')) normalized.source.sourceReliability = record.source.sourceReliability;
    if (record.source && Object.prototype.hasOwnProperty.call(record.source, 'acquiredAt')) normalized.source.acquiredAt = record.source.acquiredAt;
    return normalized;
  });
}

function buildStoreFromRecords(records = [], options = {}) {
  const initialStore = options.initialStore || createEmptySoldEvidenceStore({
    createdAt: '2026-07-10T00:00:00.000Z',
    updatedAt: '2026-07-10T00:00:00.000Z'
  });

  return addSoldEvidenceRecords(initialStore, records, {
    mutate: false,
    adapter: options.adapter || 'store_conformance_fixture',
    retrievalMethod: options.retrievalMethod || 'offline_conformance',
    sourceReliability: options.sourceReliability || 'fixture',
    acquiredAt: options.acquiredAt || '2026-07-10T00:00:00.000Z'
  });
}

function validateImportBatchConsistency(records = [], insertionResults = []) {
  const reasons = [];

  if (records.length !== insertionResults.length) reasons.push('batch_result_count_mismatch');
  insertionResults.forEach((result) => {
    if (!result.inserted && !result.duplicate) reasons.push(`batch_unknown_result:${result.id}`);
    if (result.duplicate && !result.duplicateOf) reasons.push(`batch_duplicate_missing_target:${result.id}`);
  });

  return {
    valid: reasons.length === 0,
    reasons
  };
}

function runSoldEvidenceStoreConformance(input = {}, options = {}) {
  const rawRecords = extractRecords(input);
  const normalizedRecords = normalizeCandidates(rawRecords, options);
  const firstBuild = buildStoreFromRecords(normalizedRecords, options);
  const secondBuild = buildStoreFromRecords(normalizedRecords, options);
  const store = firstBuild.store;
  const recordReports = normalizedRecords.map((record) => ({
    id: record.id,
    canonicalCardKey: record.canonicalCardKey,
    validation: validateCanonicalRecord(record)
  }));
  const invalidRecords = recordReports.filter((report) => !report.validation.valid);
  const version = validateVersionCompatibility(store);
  const indexes = validateStoreIndexes(store);
  const batch = validateImportBatchConsistency(normalizedRecords, firstBuild.results);
  const duplicateCount = firstBuild.results.filter((result) => result.duplicate).length;
  const deterministic = JSON.stringify(firstBuild.results) === JSON.stringify(secondBuild.results)
    && JSON.stringify(Object.keys(firstBuild.store.records).sort()) === JSON.stringify(Object.keys(secondBuild.store.records).sort());
  const sourceStore = input && !Array.isArray(input) && input.records && !Array.isArray(input.records)
    ? input
    : store;
  const inputVersion = validateVersionCompatibility(sourceStore);
  const checks = [
    createCheck('record_schema', invalidRecords.length === 0, { invalidRecords }),
    createCheck('identity_requirements', invalidRecords.every((report) => !report.validation.checks.identity.length), {
      invalidRecords: invalidRecords.map((report) => ({ id: report.id, reasons: report.validation.checks.identity }))
    }),
    createCheck('provenance_requirements', invalidRecords.every((report) => !report.validation.checks.provenance.length), {
      invalidRecords: invalidRecords.map((report) => ({ id: report.id, reasons: report.validation.checks.provenance }))
    }),
    createCheck('evidence_type_correctness', invalidRecords.every((report) => !report.validation.checks.evidenceType.length), {
      invalidRecords: invalidRecords.map((report) => ({ id: report.id, reasons: report.validation.checks.evidenceType }))
    }),
    createCheck('transaction_level_sold_eligibility', invalidRecords.every((report) => !report.validation.checks.transactionEligibility.length), {
      invalidRecords: invalidRecords.map((report) => ({ id: report.id, reasons: report.validation.checks.transactionEligibility }))
    }),
    createCheck('immutable_record_requirements', invalidRecords.every((report) => !report.validation.checks.immutable.length), {
      invalidRecords: invalidRecords.map((report) => ({ id: report.id, reasons: report.validation.checks.immutable }))
    }),
    createCheck('duplicate_handling', duplicateCount === Math.max(0, normalizedRecords.length - Object.keys(store.records).length), {
      duplicateCount,
      recordCount: normalizedRecords.length,
      storedRecordCount: Object.keys(store.records).length,
      results: firstBuild.results
    }),
    createCheck('version_compatibility', version.valid && inputVersion.valid, {
      builtStore: version,
      inputStore: inputVersion
    }),
    createCheck('store_indexes_and_stats', indexes.valid, indexes),
    createCheck('import_batch_consistency', batch.valid, batch),
    createCheck('deterministic_fixture_replay', deterministic, {
      firstResultCount: firstBuild.results.length,
      secondResultCount: secondBuild.results.length
    })
  ];
  const failed = checks.filter((check) => !check.pass);

  return {
    source: 'sold_evidence_store_conformance',
    version: HARNESS_VERSION,
    passed: failed.length === 0,
    totalChecks: checks.length,
    passedChecks: checks.length - failed.length,
    failedChecks: failed.length,
    checks,
    failures: failed.map((check) => check.name),
    recordReports,
    summary: {
      inputRecords: rawRecords.length,
      normalizedRecords: normalizedRecords.length,
      insertedRecords: firstBuild.results.filter((result) => result.inserted).length,
      duplicateRecords: duplicateCount,
      storedRecords: Object.keys(store.records).length,
      invalidRecords: invalidRecords.length
    },
    store
  };
}

function summarizeStoreConformance(report = {}) {
  return {
    passed: Boolean(report.passed),
    totalChecks: report.totalChecks || 0,
    passedChecks: report.passedChecks || 0,
    failedChecks: report.failedChecks || 0,
    failures: asArray(report.failures),
    summary: asObject(report.summary)
  };
}

module.exports = {
  HARNESS_VERSION,
  REQUIRED_IDENTITY_FIELDS,
  REQUIRED_RECORD_FIELDS,
  REQUIRED_SOURCE_FIELDS,
  extractRecords,
  normalizeCandidates,
  runSoldEvidenceStoreConformance,
  summarizeStoreConformance,
  validateCanonicalRecord,
  validateEvidenceType,
  validateIdentity,
  validateImmutableRequirements,
  validateImportBatchConsistency,
  validateProvenance,
  validateStoreIndexes,
  validateTransactionEligibility,
  validateVersionCompatibility
};
