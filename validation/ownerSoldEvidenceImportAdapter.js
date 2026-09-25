'use strict';

const {
  SOURCE_CLASSES,
  CONFIRMATION_STATUSES,
  LISTING_TYPES,
  PROVENANCE_CATEGORIES,
  RETENTION_STATUSES,
  validateCanonicalSoldEvidenceImportBatch
} = require('./canonicalSoldEvidenceImportContract');
const {
  asArray,
  asObject,
  fingerprint,
  unique
} = require('./canonicalValidationCore');

const SOURCE = 'owner_sold_evidence_import_adapter';
const VERSION = '0.1.0';
const SCHEMA_VERSION = '1.0.0';
const MAX_RECORDS = 100;
const MAX_CONTENT_BYTES = 256 * 1024;
const MAX_STRING_LENGTH = 160;

const SUPPORTED_FORMATS = Object.freeze(['csv', 'json']);

const PARSING_REASON_CODES = Object.freeze([
  'dangerous_content_rejected',
  'dangerous_object_key',
  'duplicate_header',
  'duplicate_row_detected',
  'empty_import',
  'file_path_rejected',
  'format_required',
  'invalid_json',
  'malformed_csv',
  'malformed_record',
  'max_records_exceeded',
  'oversized_import',
  'trusted_context_ignored',
  'unexpected_nesting',
  'unsupported_format'
]);

const FIELD_ALIASES = Object.freeze({
  sourceClass: ['source_class', 'sourceClass'],
  sourceProviderName: ['source_provider_name', 'sourceProviderName', 'provider_name', 'providerName', 'source_name', 'sourceName', 'marketplace'],
  externalTransactionId: ['transaction_id', 'transactionId', 'external_transaction_id', 'externalTransactionId', 'marketplace_sale_id', 'marketplaceSaleId', 'sale_id', 'saleId'],
  externalListingId: ['listing_id', 'listingId', 'external_listing_id', 'externalListingId', 'marketplace_listing_id', 'marketplaceListingId'],
  saleDate: ['sale_date', 'saleDate', 'sold_at', 'soldAt', 'sold_date', 'soldDate', 'date_sold', 'dateSold'],
  currency: ['currency'],
  finalSalePrice: ['final_sale_price', 'finalSalePrice', 'sold_price', 'soldPrice', 'sale_price', 'salePrice', 'price'],
  listingType: ['listing_type', 'listingType', 'sale_type', 'saleType'],
  confirmationStatus: ['confirmation_status', 'confirmationStatus', 'price_confirmation_status', 'priceConfirmationStatus'],
  provenanceCategories: ['provenance_categories', 'provenanceCategories', 'provenance', 'evidence_provenance', 'evidenceProvenance'],
  acquiredAt: ['acquired_at', 'acquiredAt', 'acquisition_timestamp', 'acquisitionTimestamp'],
  retentionStatus: ['retention_status', 'retentionStatus', 'permission_status', 'permissionStatus'],
  sourceTerms: ['source_terms', 'sourceTerms'],
  sourceApprovalStatus: ['source_approval_status', 'sourceApprovalStatus'],
  manualVerified: ['manual_verified', 'manualVerified', 'owner_verified', 'ownerVerified'],
  manualVerifier: ['manual_verifier', 'manualVerifier', 'verified_by', 'verifiedBy'],
  manualVerifiedAt: ['manual_verified_at', 'manualVerifiedAt', 'verified_at', 'verifiedAt'],
  exactIdentityVerified: ['exact_identity_verified', 'exactIdentityVerified'],
  identityStatus: ['identity_status', 'identityStatus'],
  identityVerificationStatus: ['identity_verification_status', 'identityVerificationStatus'],
  identityCategory: ['identity_category', 'identityCategory', 'category'],
  sport: ['sport'],
  subjectName: ['subject_name', 'subjectName', 'player', 'athlete'],
  year: ['year'],
  manufacturer: ['manufacturer', 'brand'],
  product: ['product'],
  setName: ['set_name', 'setName'],
  cardNumber: ['card_number', 'cardNumber'],
  parallel: ['parallel'],
  rookieDesignation: ['rookie_designation', 'rookieDesignation', 'rookie'],
  autographState: ['autograph_state', 'autographState', 'autograph'],
  memorabiliaState: ['memorabilia_state', 'memorabiliaState', 'memorabilia'],
  serialNumbered: ['serial_numbered', 'serialNumbered'],
  printRun: ['print_run', 'printRun'],
  rawOrGraded: ['raw_or_graded', 'rawOrGraded', 'condition'],
  gradeCompany: ['grade_company', 'gradeCompany', 'grader'],
  grade: ['grade']
});

const ALLOWED_INPUT_FIELDS = Object.freeze(unique(Object.values(FIELD_ALIASES).flat()).sort());
const IDENTITY_OUTPUT_FIELDS = Object.freeze([
  'category',
  'sport',
  'player',
  'year',
  'brand',
  'product',
  'setName',
  'cardNumber',
  'parallel',
  'rookie',
  'autograph',
  'memorabilia',
  'serialNumbered',
  'printRun',
  'condition',
  'gradeCompany',
  'grade'
]);

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function normalizeFieldName(value) {
  return String(value || '')
    .trim()
    .replace(/^\uFEFF/, '');
}

function normalizeDiagnosticFieldName(value) {
  return String(value || '')
    .trim()
    .replace(/^\uFEFF/, '')
    .replace(/[^A-Za-z0-9_.:-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}

function isDangerousObjectKey(value) {
  return ['__proto__', 'prototype', 'constructor'].includes(
    normalizeFieldName(value).toLowerCase()
  );
}

function normalizeText(value) {
  return String(value ?? '')
    .trim()
    .slice(0, MAX_STRING_LENGTH);
}

function normalizeEnumText(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function increment(map, key, amount = 1) {
  if (!key) return;
  map[key] = (map[key] || 0) + amount;
}

function sortedCountMap(map = {}) {
  return deepFreeze(Object.fromEntries(Object.entries(map)
    .filter(([, value]) => Number(value) > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => [key, Math.max(0, Math.floor(Number(value) || 0))])));
}

function parseBoolean(value) {
  if (typeof value === 'boolean') return value;
  const normalized = normalizeEnumText(value);
  if (['true', 'yes', 'y', '1'].includes(normalized)) return true;
  if (['false', 'no', 'n', '0'].includes(normalized)) return false;
  return undefined;
}

function parsePrice(value) {
  if (value === null || value === undefined || value === '') return undefined;
  const cleaned = String(value).replace(/[$,\s]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return undefined;
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : undefined;
}

function parseDate(value) {
  const text = normalizeText(value);
  if (!text) return undefined;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function splitList(value) {
  if (Array.isArray(value)) return value.map(normalizeText).filter(Boolean);
  return normalizeText(value)
    .split(/[;|]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function hasDangerousContent(value) {
  if (typeof value !== 'string') return false;
  const text = value.trim();
  if (!text) return false;
  if (/^[=+\-@]/.test(text)) return true;
  return /<\s*script\b|javascript:|data:text\/html|vbscript:|macro\b/i.test(text);
}

function containsUnexpectedNesting(value) {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) {
    return value.some((item) => item && typeof item === 'object');
  }
  return true;
}

function contentSize(input) {
  if (typeof input === 'string') return Buffer.byteLength(input, 'utf8');
  return Buffer.byteLength(JSON.stringify(input || {}), 'utf8');
}

function parseCsv(content) {
  const text = String(content || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (inQuotes) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }

  if (inQuotes) {
    return { valid: false, reasonCodes: ['malformed_csv'], rows: [] };
  }
  row.push(cell);
  rows.push(row);

  const meaningfulRows = rows.filter((entry) => entry.some((value) => String(value || '').trim() !== ''));
  if (!meaningfulRows.length) return { valid: false, reasonCodes: ['empty_import'], rows: [] };

  const headers = meaningfulRows[0].map(normalizeFieldName);
  if (headers.some(isDangerousObjectKey)) {
    return { valid: false, reasonCodes: ['dangerous_object_key'], rows: [] };
  }
  const normalizedHeaders = headers.map((header) => header.toLowerCase());
  if (new Set(normalizedHeaders).size !== normalizedHeaders.length) {
    return { valid: false, reasonCodes: ['duplicate_header'], rows: [] };
  }

  const dataRows = meaningfulRows.slice(1).map((values) => {
    const record = Object.create(null);
    headers.forEach((header, index) => {
      record[header] = values[index] === undefined ? '' : values[index];
    });
    return record;
  });

  return { valid: true, reasonCodes: [], rows: dataRows, headers };
}

function parseJson(content) {
  let parsed = content;
  if (typeof content === 'string') {
    try {
      parsed = JSON.parse(content);
    } catch (_) {
      return { valid: false, reasonCodes: ['invalid_json'], rows: [] };
    }
  }
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  if (!rows.length || !rows.every((row) => row && typeof row === 'object' && !Array.isArray(row))) {
    return { valid: false, reasonCodes: ['malformed_record'], rows: [] };
  }
  return { valid: true, reasonCodes: [], rows };
}

function detectFormat(input, options = {}) {
  const explicit = normalizeEnumText(options.format || asObject(input).format);
  if (SUPPORTED_FORMATS.includes(explicit)) return explicit;
  if (typeof input === 'string') return input.trim().startsWith('{') || input.trim().startsWith('[') ? 'json' : 'csv';
  if (Array.isArray(input) || (input && typeof input === 'object')) return 'json';
  return 'unknown';
}

function extractContent(input) {
  if (typeof input === 'string' || Array.isArray(input)) return input;
  const object = asObject(input);
  if (Object.hasOwn(object, 'content')) return object.content;
  if (Object.hasOwn(object, 'records')) return object.records;
  if (Object.hasOwn(object, 'rows')) return object.rows;
  return input;
}

function findValue(row = {}, canonicalField) {
  const aliases = FIELD_ALIASES[canonicalField] || [];
  for (const alias of aliases) {
    if (Object.hasOwn(row, alias)) return row[alias];
  }
  const lowerMap = Object.fromEntries(Object.keys(row).map((key) => [key.toLowerCase(), key]));
  for (const alias of aliases) {
    const key = lowerMap[alias.toLowerCase()];
    if (key) return row[key];
  }
  return undefined;
}

function mapEnum(value, allowlist, fallback = undefined) {
  const normalized = normalizeEnumText(value);
  return allowlist.includes(normalized) ? normalized : fallback;
}

function mapIdentity(row = {}) {
  const identity = {};
  const mappings = {
    identityCategory: 'category',
    sport: 'sport',
    subjectName: 'player',
    year: 'year',
    manufacturer: 'brand',
    product: 'product',
    setName: 'setName',
    cardNumber: 'cardNumber',
    parallel: 'parallel',
    printRun: 'printRun',
    rawOrGraded: 'condition',
    gradeCompany: 'gradeCompany',
    grade: 'grade'
  };

  for (const [source, target] of Object.entries(mappings)) {
    const value = normalizeText(findValue(row, source));
    if (value) identity[target] = value;
  }

  const booleanMappings = {
    rookieDesignation: 'rookie',
    autographState: 'autograph',
    memorabiliaState: 'memorabilia',
    serialNumbered: 'serialNumbered'
  };
  for (const [source, target] of Object.entries(booleanMappings)) {
    const parsed = parseBoolean(findValue(row, source));
    if (parsed !== undefined) identity[target] = parsed;
  }

  return Object.fromEntries(Object.entries(identity)
    .filter(([field]) => IDENTITY_OUTPUT_FIELDS.includes(field))
    .sort(([left], [right]) => left.localeCompare(right)));
}

function mappedFieldNames(row = {}) {
  const fields = [];
  const rowKeys = new Set(Object.keys(row).map((key) => key.toLowerCase()));
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    if (aliases.some((alias) => rowKeys.has(alias.toLowerCase()))) fields.push(field);
  }
  return fields.sort();
}

function ignoredFieldNames(row = {}) {
  const allowed = new Set(ALLOWED_INPUT_FIELDS.map((field) => field.toLowerCase()));
  return Object.keys(row)
    .filter((field) => !allowed.has(field.toLowerCase()))
    .map(normalizeDiagnosticFieldName)
    .filter(Boolean)
    .sort();
}

function mapRowToA5Candidate(row = {}) {
  const retentionStatus = mapEnum(findValue(row, 'retentionStatus'), RETENTION_STATUSES, undefined);
  const sourceApprovalStatus = normalizeText(findValue(row, 'sourceApprovalStatus'));
  const sourceTerms = normalizeText(findValue(row, 'sourceTerms'));
  const manualVerified = parseBoolean(findValue(row, 'manualVerified'));
  const candidate = {
    sourceClass: mapEnum(findValue(row, 'sourceClass'), SOURCE_CLASSES, undefined),
    sourceProviderName: normalizeText(findValue(row, 'sourceProviderName')),
    externalTransactionId: normalizeText(findValue(row, 'externalTransactionId')) || undefined,
    externalListingId: normalizeText(findValue(row, 'externalListingId')) || undefined,
    saleDate: parseDate(findValue(row, 'saleDate')),
    currency: normalizeText(findValue(row, 'currency')) || undefined,
    finalSalePrice: parsePrice(findValue(row, 'finalSalePrice')),
    listingType: mapEnum(findValue(row, 'listingType'), LISTING_TYPES, undefined),
    confirmationStatus: mapEnum(findValue(row, 'confirmationStatus'), CONFIRMATION_STATUSES, undefined),
    identity: mapIdentity(row),
    exactIdentityVerified: parseBoolean(findValue(row, 'exactIdentityVerified')) === true,
    identityStatus: normalizeText(findValue(row, 'identityStatus')) || undefined,
    identityVerificationStatus: normalizeText(findValue(row, 'identityVerificationStatus')) || undefined,
    provenanceCategories: splitList(findValue(row, 'provenanceCategories'))
      .map((item) => mapEnum(item, PROVENANCE_CATEGORIES, undefined))
      .filter(Boolean)
      .sort(),
    acquiredAt: parseDate(findValue(row, 'acquiredAt')),
    retentionStatus,
    permission: {
      status: retentionStatus,
      sourceTerms: sourceTerms || undefined,
      sourceApprovalStatus: sourceApprovalStatus || undefined
    },
    manualVerification: {
      verified: manualVerified === true,
      verifier: normalizeText(findValue(row, 'manualVerifier')) || undefined,
      verifiedAt: parseDate(findValue(row, 'manualVerifiedAt'))
    }
  };

  return Object.fromEntries(Object.entries(candidate)
    .filter(([, value]) => value !== undefined && value !== '')
    .sort(([left], [right]) => left.localeCompare(right)));
}

function publicRowDiagnostic(index, rowResult) {
  return deepFreeze({
    index,
    parsedUntrustedCandidate: rowResult.parsedUntrustedCandidate === true,
    duplicate: rowResult.duplicate === true,
    reasonCodes: unique(rowResult.reasonCodes).sort(),
    mappedFields: unique(rowResult.mappedFields).sort(),
    unknownFieldCount: rowResult.unknownFieldCount || 0
  });
}

function validateRow(row = {}) {
  const reasonCodes = [];
  if (Object.keys(row).some(isDangerousObjectKey)) reasonCodes.push('dangerous_object_key');
  for (const value of Object.values(row)) {
    if (hasDangerousContent(value)) reasonCodes.push('dangerous_content_rejected');
    if (containsUnexpectedNesting(value)) reasonCodes.push('unexpected_nesting');
  }
  return unique(reasonCodes).sort();
}

function buildEmptyResult(format, reasonCodes = []) {
  const publicDiagnostics = {
    source: SOURCE,
    version: VERSION,
    schemaVersion: SCHEMA_VERSION,
    format,
    totalRows: 0,
    parsedUntrustedCandidateCount: 0,
    rejectedParsingCount: reasonCodes.length ? 1 : 0,
    duplicateCount: 0,
    sourceClassCounts: {},
    mappedFieldNameCounts: {},
    unknownFieldCount: 0,
    rowsWithUnknownFields: 0,
    parsingReasonCodeCounts: sortedCountMap(Object.fromEntries(reasonCodes.map((reason) => [reason, 1]))),
    readinessCounts: { canonicalReady: 0, rejected: 0 },
    rowDiagnostics: reasonCodes.length ? [publicRowDiagnostic(0, {
      parsedUntrustedCandidate: false,
      duplicate: false,
      reasonCodes,
      mappedFields: [],
      unknownFieldCount: 0
    })] : [],
    nonPersistent: true,
    writesProductionStore: false,
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
  publicDiagnostics.reportFingerprint = fingerprint(publicDiagnostics);
  return deepFreeze({
    source: SOURCE,
    version: VERSION,
    schemaVersion: SCHEMA_VERSION,
    valid: false,
    format,
    candidates: [],
    validation: null,
    publicDiagnostics,
    internalDiagnostics: { duplicateFingerprints: [] },
    nonPersistent: true,
    writesProductionStore: false,
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  });
}

function importOwnerSoldEvidence(input, options = {}) {
  const original = clone(input);
  const format = detectFormat(input, options);
  const content = extractContent(input);
  const parsingReasonCodes = [];
  const inputObject = asObject(input);

  if (!SUPPORTED_FORMATS.includes(format)) parsingReasonCodes.push('unsupported_format');
  if (!format || format === 'unknown') parsingReasonCodes.push('format_required');
  if (contentSize(content) > MAX_CONTENT_BYTES) parsingReasonCodes.push('oversized_import');
  if (inputObject.path || inputObject.filePath || inputObject.contentPath) parsingReasonCodes.push('file_path_rejected');
  if (options.trustedContext || inputObject.trustedContext) parsingReasonCodes.push('trusted_context_ignored');
  if (parsingReasonCodes.some((reason) => ['unsupported_format', 'format_required', 'oversized_import', 'file_path_rejected'].includes(reason))) {
    return buildEmptyResult(format, parsingReasonCodes);
  }

  const parsed = format === 'csv' ? parseCsv(content) : parseJson(content);
  parsingReasonCodes.push(...asArray(parsed.reasonCodes));
  if (!parsed.valid) return buildEmptyResult(format, parsingReasonCodes);

  const rows = parsed.rows;
  if (rows.length > MAX_RECORDS) return buildEmptyResult(format, [...parsingReasonCodes, 'max_records_exceeded']);

  const candidates = [];
  const rowResults = [];
  const sourceClassCounts = {};
  const mappedFieldNameCounts = {};
  const ignoredFieldNamesSet = new Set();
  let unknownFieldCount = 0;
  let rowsWithUnknownFields = 0;
  const rowFingerprintCounts = {};

  rows.forEach((row, index) => {
    const rowReasonCodes = validateRow(row);
    const mappedFields = mappedFieldNames(row);
    const ignored = ignoredFieldNames(row);
    const fingerprintRow = Object.create(null);
    for (const [key, value] of Object.entries(row)
      .filter(([key]) => !isDangerousObjectKey(key))
      .map(([key, value]) => [normalizeDiagnosticFieldName(key), String(value ?? '').slice(0, MAX_STRING_LENGTH)])
      .sort(([left], [right]) => left.localeCompare(right))) {
      fingerprintRow[key] = value;
    }
    const rowFingerprint = fingerprint({ row: fingerprintRow });
    increment(rowFingerprintCounts, rowFingerprint);

    for (const field of mappedFields) increment(mappedFieldNameCounts, field);
    for (const field of ignored) ignoredFieldNamesSet.add(field);
    unknownFieldCount += ignored.length;
    if (ignored.length) rowsWithUnknownFields += 1;

    if (rowReasonCodes.length) {
      rowResults.push({
        index,
        parsedUntrustedCandidate: false,
        duplicate: false,
        reasonCodes: rowReasonCodes,
        mappedFields,
        unknownFieldCount: ignored.length,
        rowFingerprint
      });
      return;
    }

    const candidate = mapRowToA5Candidate(row);
    candidates.push(candidate);
    increment(sourceClassCounts, candidate.sourceClass || 'unknown');
    rowResults.push({
      index,
      parsedUntrustedCandidate: true,
      duplicate: false,
      reasonCodes: [],
      mappedFields,
      unknownFieldCount: ignored.length,
      rowFingerprint
    });
  });

  const duplicateFingerprints = Object.entries(rowFingerprintCounts)
    .filter(([, count]) => count > 1)
    .map(([key]) => key)
    .sort();
  const duplicateSet = new Set(duplicateFingerprints);
  for (const rowResult of rowResults) {
    if (duplicateSet.has(rowResult.rowFingerprint)) {
      rowResult.duplicate = true;
      rowResult.reasonCodes = unique([...rowResult.reasonCodes, 'duplicate_row_detected']).sort();
    }
  }
  if (duplicateFingerprints.length) parsingReasonCodes.push('duplicate_row_detected');

  const parsedUntrustedCandidates = rowResults.filter((row) => row.parsedUntrustedCandidate).length;
  const rejectedParsingCount = rowResults.length - parsedUntrustedCandidates;
  const validation = validateCanonicalSoldEvidenceImportBatch(candidates);
  const readinessCounts = {
    canonicalReady: validation.publicDiagnostics.canonicalReadyCount,
    rejected: validation.publicDiagnostics.rejectedCount
  };
  const parsingReasonCodeCounts = {};
  for (const reason of parsingReasonCodes) increment(parsingReasonCodeCounts, reason);
  for (const rowResult of rowResults) {
    for (const reason of rowResult.reasonCodes) {
      if (reason !== 'duplicate_row_detected') increment(parsingReasonCodeCounts, reason);
    }
  }

  const publicDiagnostics = {
    source: SOURCE,
    version: VERSION,
    schemaVersion: SCHEMA_VERSION,
    format,
    totalRows: rows.length,
    parsedUntrustedCandidateCount: parsedUntrustedCandidates,
    rejectedParsingCount,
    duplicateCount: duplicateFingerprints.length,
    sourceClassCounts: sortedCountMap(sourceClassCounts),
    mappedFieldNameCounts: sortedCountMap(mappedFieldNameCounts),
    unknownFieldCount,
    rowsWithUnknownFields,
    parsingReasonCodeCounts: sortedCountMap(parsingReasonCodeCounts),
    readinessCounts,
    rowDiagnostics: rowResults.map((rowResult) => publicRowDiagnostic(rowResult.index, rowResult)),
    nonPersistent: true,
    writesProductionStore: false,
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
  publicDiagnostics.reportFingerprint = fingerprint(publicDiagnostics);

  if (JSON.stringify(original) !== JSON.stringify(input || {})) {
    throw new Error('owner_sold_evidence_import_adapter_mutated_input');
  }

  return deepFreeze({
    source: SOURCE,
    version: VERSION,
    schemaVersion: SCHEMA_VERSION,
    valid: rejectedParsingCount === 0 && duplicateFingerprints.length === 0,
    format,
    candidates,
    validation,
    publicDiagnostics,
    internalDiagnostics: {
      duplicateFingerprints,
      ignoredFieldNames: [...ignoredFieldNamesSet].sort()
    },
    nonPersistent: true,
    writesProductionStore: false,
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  });
}

function summarizeOwnerSoldEvidenceImport(result = {}) {
  return deepFreeze(clone(asObject(result.publicDiagnostics || result)));
}

module.exports = {
  SOURCE,
  VERSION,
  SCHEMA_VERSION,
  MAX_RECORDS,
  MAX_CONTENT_BYTES,
  SUPPORTED_FORMATS,
  PARSING_REASON_CODES,
  FIELD_ALIASES,
  importOwnerSoldEvidence,
  summarizeOwnerSoldEvidenceImport,
  mapRowToA5Candidate
};
