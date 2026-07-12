'use strict';

const crypto = require('node:crypto');

const VALIDATION_RESULT_SCHEMA_VERSION = '1.0.0';
const CANONICAL_RECORD_SCHEMA_VERSION = 1;
const CERTIFICATION_ARTIFACT_SCHEMA_VERSION = '1.0.0';
const INGESTION_MANIFEST_SCHEMA_VERSION = '1.0.0';

const REQUIRED_CANONICAL_RECORD_FIELDS = [
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

const REQUIRED_ACQUISITION_PROVENANCE_FIELDS = [
  'marketplace',
  'adapter',
  'retrievalMethod',
  'sourceReliability',
  'acquiredAt'
];

const REQUIRED_STORE_SOURCE_FIELDS = [
  'adapter',
  'retrievalMethod',
  'sourceReliability',
  'acquiredAt'
];

const REQUIRED_IMMUTABLE_RECORD_FIELDS = [
  'id',
  'canonicalCardKey',
  'duplicateKeys'
];

const REASON_CODES = Object.freeze({
  MISSING_QUERY_OR_IDENTITY: 'missing_query_or_identity',
  INVALID_LIMIT: 'invalid_limit',
  MISSING_IDENTITY_PREFIX: 'missing_identity_',
  MISSING_IDENTITY_SUBJECT: 'missing_identity_subject',
  CANONICAL_CARD_KEY_MISMATCH: 'canonical_card_key_mismatch',
  MISSING_PROVENANCE_PREFIX: 'missing_provenance_',
  INVALID_PROVENANCE_PREFIX: 'invalid_provenance_',
  MISSING_SOURCE_PREFIX: 'missing_source_',
  INVALID_SOURCE_PREFIX: 'invalid_source_',
  MISSING_SOURCE_URL: 'missing_source_url',
  NOT_TRUE_SOLD_EVIDENCE: 'not_true_sold_evidence',
  INACTIVE_OR_CONTEXT_RECORD: 'inactive_or_context_record',
  MISSING_SOLD_PRICE: 'missing_sold_price',
  MISSING_SOLD_DATE: 'missing_sold_date',
  UNDISCLOSED_BEST_OFFER_PRICE: 'undisclosed_best_offer_price',
  MISSING_SCHEMA_PREFIX: 'missing_schema_',
  MISSING_IMMUTABLE_PREFIX: 'missing_immutable_',
  WEAK_DUPLICATE_IDENTITY: 'weak_duplicate_identity',
  DUPLICATE_SOLD_EVIDENCE_RECORD: 'duplicate_sold_evidence_record',
  CERTIFICATION_GATE_FAILED: 'certification_gate_failed',
  SOURCE_PERMISSION_GATE_FAILED: 'source_permission_gate_failed',
  ACQUISITION_METHOD_GATE_FAILED: 'acquisition_method_gate_failed'
});

const FAILURE_STAGES = Object.freeze({
  ADAPTER_CONTRACT: 'adapter_contract',
  CAPABILITY_METADATA: 'capability_metadata',
  SCHEMA: 'schema',
  IDENTITY: 'identity',
  PROVENANCE: 'provenance',
  EVIDENCE_TYPE: 'evidence_type',
  EVIDENCE_CLASSIFICATION: 'evidence_classification',
  TRANSACTION: 'transaction',
  DUPLICATE_HANDLING: 'duplicate_handling',
  STORE_COMPATIBILITY: 'store_compatibility',
  CERTIFICATION: 'certification',
  SOURCE_PERMISSION: 'source_permission',
  ACQUISITION_METHOD: 'acquisition_method'
});

const FAILURE_CLASSIFICATIONS = Object.freeze({
  RETRYABLE: 'retryable',
  TERMINAL: 'terminal',
  PARTIAL: 'partial',
  DEGRADED: 'degraded',
  RATE_LIMITED: 'rate_limited'
});

const CERTIFICATION_ARTIFACT_SCHEMA = Object.freeze({
  schemaVersion: CERTIFICATION_ARTIFACT_SCHEMA_VERSION,
  immutable: true,
  requiredFields: [
    'source',
    'version',
    'generatedAt',
    'certificationLevel',
    'productionApproved',
    'passed',
    'standard',
    'adapter',
    'requirements',
    'summary'
  ],
  requiredAdapterFields: [
    'sourceId',
    'adapterName',
    'adapterVersion'
  ]
});

const INGESTION_MANIFEST_SCHEMA = Object.freeze({
  schemaVersion: INGESTION_MANIFEST_SCHEMA_VERSION,
  immutable: true,
  requiredFields: [
    'source',
    'version',
    'runId',
    'createdAt',
    'dryRun',
    'storeWritesEnabled',
    'adapter',
    'certification',
    'sourcePermission',
    'acquisitionMethod',
    'fingerprints',
    'summary',
    'partialFailures',
    'batch',
    'artifacts'
  ]
});

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function unique(values = []) {
  return [...new Set(asArray(values).filter(Boolean))];
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

function missingFields(record = {}, fields = []) {
  const input = asObject(record);
  return asArray(fields).filter((field) => {
    const value = input[field];
    if (Array.isArray(value)) return value.length === 0;
    if (value && typeof value === 'object') return Object.keys(value).length === 0;
    return value === undefined || value === null || value === '';
  });
}

function getIdentityValue(identity = {}, field) {
  if (field === 'setName') return identity.setName || identity.set || identity.cardSet;
  return identity[field];
}

function hasIdentitySubject(identity = {}) {
  return Boolean(identity.player || identity.subject || identity.character);
}

function buildMissingReason(prefix, field) {
  return `${prefix}${field}`;
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function fingerprint(value = {}) {
  return crypto
    .createHash('sha256')
    .update(stableStringify(value))
    .digest('hex');
}

function reasonToFailureStage(reason = '', options = {}) {
  const input = String(reason || '');
  const evidenceStage = options.evidenceStage || FAILURE_STAGES.EVIDENCE_TYPE;
  const defaultStage = options.defaultStage || FAILURE_STAGES.STORE_COMPATIBILITY;

  if (
    input.startsWith(REASON_CODES.MISSING_IDENTITY_PREFIX)
    || input === REASON_CODES.CANONICAL_CARD_KEY_MISMATCH
  ) {
    return FAILURE_STAGES.IDENTITY;
  }

  if (
    input.startsWith(REASON_CODES.MISSING_PROVENANCE_PREFIX)
    || input.startsWith(REASON_CODES.INVALID_PROVENANCE_PREFIX)
    || input.startsWith(REASON_CODES.MISSING_SOURCE_PREFIX)
    || input.startsWith(REASON_CODES.INVALID_SOURCE_PREFIX)
  ) {
    return FAILURE_STAGES.PROVENANCE;
  }

  if (
    input === REASON_CODES.NOT_TRUE_SOLD_EVIDENCE
    || input === REASON_CODES.INACTIVE_OR_CONTEXT_RECORD
  ) {
    return evidenceStage;
  }

  if (
    input === REASON_CODES.MISSING_SOLD_PRICE
    || input === REASON_CODES.MISSING_SOLD_DATE
    || input === REASON_CODES.UNDISCLOSED_BEST_OFFER_PRICE
  ) {
    return options.transactionStage || FAILURE_STAGES.TRANSACTION;
  }

  if (input.startsWith(REASON_CODES.MISSING_SCHEMA_PREFIX)) return FAILURE_STAGES.SCHEMA;
  if (input === REASON_CODES.DUPLICATE_SOLD_EVIDENCE_RECORD) return FAILURE_STAGES.DUPLICATE_HANDLING;
  if (input === REASON_CODES.CERTIFICATION_GATE_FAILED) return FAILURE_STAGES.CERTIFICATION;
  if (input === REASON_CODES.SOURCE_PERMISSION_GATE_FAILED) return FAILURE_STAGES.SOURCE_PERMISSION;
  if (input === REASON_CODES.ACQUISITION_METHOD_GATE_FAILED) return FAILURE_STAGES.ACQUISITION_METHOD;

  return defaultStage;
}

function createValidationResult(input = {}) {
  const reasons = asArray(input.reasons);
  return {
    schemaVersion: VALIDATION_RESULT_SCHEMA_VERSION,
    valid: input.valid === undefined ? reasons.length === 0 : Boolean(input.valid),
    reasons,
    failureStages: unique(input.failureStages || reasons.map((reason) => reasonToFailureStage(reason, input.stageOptions))),
    checks: asObject(input.checks),
    recordId: input.recordId || null,
    canonicalCardKey: input.canonicalCardKey || null,
    metadata: asObject(input.metadata)
  };
}

function validateOptionalSchemaVersion(value, expected = CANONICAL_RECORD_SCHEMA_VERSION) {
  if (value === undefined || value === null || value === '') {
    return {
      valid: true,
      reasons: [],
      expected,
      actual: null,
      supported: false
    };
  }

  const actual = Number(value);
  const valid = Number.isFinite(actual) && actual === expected;
  return {
    valid,
    reasons: valid ? [] : ['schema_version_mismatch'],
    expected,
    actual: value,
    supported: true
  };
}

module.exports = {
  CANONICAL_RECORD_SCHEMA_VERSION,
  CERTIFICATION_ARTIFACT_SCHEMA,
  CERTIFICATION_ARTIFACT_SCHEMA_VERSION,
  FAILURE_CLASSIFICATIONS,
  FAILURE_STAGES,
  INGESTION_MANIFEST_SCHEMA,
  INGESTION_MANIFEST_SCHEMA_VERSION,
  REASON_CODES,
  REQUIRED_ACQUISITION_PROVENANCE_FIELDS,
  REQUIRED_CANONICAL_RECORD_FIELDS,
  REQUIRED_IDENTITY_FIELDS,
  REQUIRED_IMMUTABLE_RECORD_FIELDS,
  REQUIRED_STORE_SOURCE_FIELDS,
  VALIDATION_RESULT_SCHEMA_VERSION,
  asArray,
  asObject,
  buildMissingReason,
  createValidationResult,
  fingerprint,
  getIdentityValue,
  hasIdentitySubject,
  missingFields,
  normalizeDate,
  reasonToFailureStage,
  stableStringify,
  toNumber,
  unique,
  validateOptionalSchemaVersion
};
