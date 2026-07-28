'use strict';

const { asArray, asObject, unique } = require('./canonicalValidationCore');
const { buildFingerprintFromProjection } = require('./fingerprintProjection');
const { clone, firstDefined } = require('./phase8GovernanceCore');
const {
  AUTHORITY_LEVELS,
  DECISION_ROLES,
  PRODUCER_CATEGORIES,
  SIGNAL_TYPES,
  UNKNOWN_VALUE
} = require('./canonicalIntelligenceSignalContract');
const {
  DEPRECATION_STATUSES,
  EVIDENCE_ROLES
} = require('./intelligenceSignalRegistry');

const SIGNAL_MIGRATION_ADAPTER_SCHEMA_VERSION = '1.0.0';
const SIGNAL_MIGRATION_ADAPTER_SOURCE = 'signal_migration_adapter_contract';

const COMPATIBILITY_STATUSES = Object.freeze([
  'compatible',
  'compatible_with_warnings',
  'engine_version_unsupported',
  'signal_version_unsupported',
  'incomplete',
  'blocked',
  'invalid'
]);

const MAPPING_KINDS = Object.freeze([
  'declarative',
  'approved_handler',
  'not_applicable',
  UNKNOWN_VALUE
]);

const REQUIRED_SIGNAL_MIGRATION_ADAPTER_FIELDS = Object.freeze([
  'schemaVersion',
  'source',
  'adapterId',
  'adapterVersion',
  'engineName',
  'supportedEngineVersions',
  'signalName',
  'signalVersion',
  'producer',
  'producerVersion',
  'nativeOutputAliases',
  'nativeVersionAliases',
  'requiredNativeFields',
  'optionalNativeFields',
  'evidenceMapping',
  'confidenceMapping',
  'uncertaintyMapping',
  'statusMapping',
  'metadataMapping',
  'normalizedOutputMapping',
  'semanticParityRules',
  'mismatchReasonCodes',
  'compatibilityNotes',
  'deprecationStatus',
  'supersedesAdapterId',
  'supersededByAdapterId',
  'productionImpact',
  'decisionImpact',
  'executionAuthority',
  'adapterFingerprint'
]);

const MAPPING_FIELDS = Object.freeze([
  'evidenceMapping',
  'confidenceMapping',
  'uncertaintyMapping',
  'statusMapping',
  'metadataMapping',
  'normalizedOutputMapping'
]);

const APPROVED_HANDLER_REF_PATTERN = /^validation\/[A-Za-z0-9_.-]+#[A-Za-z0-9_.-]+$/;

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}

function known(value) {
  return value !== undefined && value !== null && value !== '';
}

function normalizeDate(value, fallback = UNKNOWN_VALUE) {
  if (!known(value)) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function normalizeString(value, fallback = UNKNOWN_VALUE) {
  if (!known(value)) return fallback;
  return String(value).trim() || fallback;
}

function normalizeEnum(value, allowedValues, fallback = UNKNOWN_VALUE) {
  const normalized = normalizeString(value, fallback).toLowerCase();
  return allowedValues.includes(normalized) ? normalized : normalized;
}

function normalizeStringArray(values = []) {
  return unique(asArray(values).map((value) => normalizeString(value, '')).filter(Boolean)).sort();
}

function validationIssue(code, message, field = '') {
  return { code, message, field };
}

function containsExecutableValue(value) {
  if (typeof value === 'function') return true;
  if (!value || typeof value !== 'object') return false;
  return Object.values(value).some(containsExecutableValue);
}

function unknownMapping(mappingName) {
  return {
    mappingName,
    kind: UNKNOWN_VALUE,
    sourceFields: [],
    targetFields: [],
    handlerRef: UNKNOWN_VALUE,
    semantics: UNKNOWN_VALUE,
    notes: [],
    details: {}
  };
}

function normalizeMapping(value, mappingName) {
  if (!known(value) || value === UNKNOWN_VALUE) return unknownMapping(mappingName);
  const input = asObject(value);
  return {
    mappingName,
    kind: normalizeEnum(firstDefined(input.kind, input.mappingType), MAPPING_KINDS, UNKNOWN_VALUE),
    sourceFields: normalizeStringArray(firstDefined(input.sourceFields, input.nativeFields, input.from)),
    targetFields: normalizeStringArray(firstDefined(input.targetFields, input.targetField, input.to)),
    handlerRef: normalizeString(firstDefined(input.handlerRef, input.approvedHandlerRef)),
    semantics: normalizeString(firstDefined(input.semantics, input.semantic, input.description)),
    notes: normalizeStringArray(input.notes),
    details: clone(asObject(input.details))
  };
}

function normalizeParityRule(value = {}) {
  if (typeof value === 'string') {
    return {
      ruleId: normalizeString(value),
      kind: 'declarative',
      nativeFields: [],
      shadowFields: [],
      comparison: normalizeString(value),
      notes: []
    };
  }
  const input = asObject(value);
  return {
    ruleId: normalizeString(firstDefined(input.ruleId, input.id, input.name)),
    kind: normalizeEnum(firstDefined(input.kind, input.mappingType), MAPPING_KINDS, 'declarative'),
    nativeFields: normalizeStringArray(firstDefined(input.nativeFields, input.sourceFields)),
    shadowFields: normalizeStringArray(firstDefined(input.shadowFields, input.targetFields)),
    comparison: normalizeString(firstDefined(input.comparison, input.semantics)),
    handlerRef: normalizeString(firstDefined(input.handlerRef, input.approvedHandlerRef)),
    notes: normalizeStringArray(input.notes)
  };
}

function normalizeSemanticParityRules(values = []) {
  return asArray(values)
    .map(normalizeParityRule)
    .sort((left, right) => left.ruleId.localeCompare(right.ruleId));
}

function buildSignalMigrationAdapterFingerprint(adapter = {}) {
  const projection = clone(adapter);
  delete projection.adapterFingerprint;
  delete projection.signalMigrationAdapterFingerprint;
  return buildFingerprintFromProjection(projection);
}

function createSignalMigrationAdapter(input = {}, options = {}) {
  const adapter = {
    schemaVersion: SIGNAL_MIGRATION_ADAPTER_SCHEMA_VERSION,
    source: SIGNAL_MIGRATION_ADAPTER_SOURCE,
    adapterId: normalizeString(firstDefined(input.adapterId, input.id, options.adapterId, 'signal-migration-adapter')),
    adapterVersion: normalizeString(firstDefined(input.adapterVersion, options.adapterVersion, '1.0.0')),
    engineName: normalizeString(firstDefined(input.engineName, input.nativeEngineName)),
    supportedEngineVersions: normalizeStringArray(input.supportedEngineVersions),
    signalName: normalizeString(firstDefined(input.signalName, options.signalName)),
    signalVersion: normalizeString(firstDefined(input.signalVersion, options.signalVersion, '1.0.0')),
    producer: normalizeString(firstDefined(input.producer, input.producerName, input.engineName)),
    producerVersion: normalizeString(firstDefined(input.producerVersion, input.signalVersion, '1.0.0')),
    producerCategory: normalizeEnum(input.producerCategory, PRODUCER_CATEGORIES, 'offline_validation'),
    signalType: normalizeEnum(input.signalType, SIGNAL_TYPES, UNKNOWN_VALUE),
    decisionRole: normalizeEnum(input.decisionRole, DECISION_ROLES, 'diagnostic_only'),
    authorityLevel: normalizeEnum(input.authorityLevel, AUTHORITY_LEVELS, 'offline_validation'),
    evidenceRole: normalizeEnum(input.evidenceRole, EVIDENCE_ROLES, UNKNOWN_VALUE),
    nativeOutputAliases: normalizeStringArray(input.nativeOutputAliases),
    nativeVersionAliases: normalizeStringArray(input.nativeVersionAliases),
    requiredNativeFields: normalizeStringArray(input.requiredNativeFields),
    optionalNativeFields: normalizeStringArray(input.optionalNativeFields),
    evidenceMapping: normalizeMapping(input.evidenceMapping, 'evidenceMapping'),
    confidenceMapping: normalizeMapping(input.confidenceMapping, 'confidenceMapping'),
    uncertaintyMapping: normalizeMapping(input.uncertaintyMapping, 'uncertaintyMapping'),
    statusMapping: normalizeMapping(input.statusMapping, 'statusMapping'),
    metadataMapping: normalizeMapping(input.metadataMapping, 'metadataMapping'),
    normalizedOutputMapping: normalizeMapping(input.normalizedOutputMapping, 'normalizedOutputMapping'),
    semanticParityRules: normalizeSemanticParityRules(input.semanticParityRules),
    mismatchReasonCodes: normalizeStringArray(input.mismatchReasonCodes),
    compatibilityNotes: normalizeStringArray(input.compatibilityNotes),
    deprecationStatus: normalizeEnum(input.deprecationStatus, DEPRECATION_STATUSES, 'active'),
    supersedesAdapterId: normalizeString(input.supersedesAdapterId),
    supersededByAdapterId: normalizeString(input.supersededByAdapterId),
    createdAt: normalizeDate(firstDefined(input.createdAt, options.createdAt, UNKNOWN_VALUE)),
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none',
    metadata: clone(asObject(input.metadata))
  };

  return deepFreeze({
    ...adapter,
    adapterFingerprint: buildSignalMigrationAdapterFingerprint(adapter)
  });
}

function cloneSignalMigrationAdapter(adapter = {}) {
  return clone(adapter);
}

function missingRequiredFields(record = {}, fields = []) {
  const input = asObject(record);
  return fields.filter((field) => {
    const value = input[field];
    return value === undefined || value === null || value === '';
  });
}

function validateAuthority(adapter, errors, authorityViolations) {
  for (const field of ['productionImpact', 'decisionImpact', 'executionAuthority']) {
    if (adapter[field] !== 'none') {
      errors.push(validationIssue('authority_boundary_violation', `${field} must remain none.`, field));
      authorityViolations.push(field);
    }
  }
}

function validateMapping(mapping = {}, field, mappingViolations, errors, warnings) {
  if (containsExecutableValue(mapping)) {
    errors.push(validationIssue('executable_mapping_not_allowed', 'Mapping definitions must not contain executable values.', field));
    mappingViolations.push(field);
    return;
  }

  if (!MAPPING_KINDS.includes(mapping.kind)) {
    errors.push(validationIssue('invalid_mapping_kind', `${field}.kind must be one of: ${MAPPING_KINDS.join(', ')}`, `${field}.kind`));
    mappingViolations.push(`${field}.kind`);
  }

  if (mapping.kind === UNKNOWN_VALUE) {
    warnings.push(validationIssue('missing_semantic_mapping', `${field} remains unknown.`, field));
    mappingViolations.push(field);
  }

  if (mapping.kind === 'declarative' && (mapping.sourceFields.length === 0 || mapping.targetFields.length === 0 || mapping.semantics === UNKNOWN_VALUE)) {
    warnings.push(validationIssue('incomplete_declarative_mapping', `${field} is declarative but incomplete.`, field));
    mappingViolations.push(field);
  }

  if (mapping.kind === 'approved_handler' && !APPROVED_HANDLER_REF_PATTERN.test(mapping.handlerRef)) {
    errors.push(validationIssue('invalid_handler_reference', `${field} must reference an approved local handler.`, `${field}.handlerRef`));
    mappingViolations.push(`${field}.handlerRef`);
  }
}

function validateParityRule(rule = {}, index, mappingViolations, errors, warnings) {
  const field = `semanticParityRules.${index}`;
  if (containsExecutableValue(rule)) {
    errors.push(validationIssue('executable_mapping_not_allowed', 'Parity rules must not contain executable values.', field));
    mappingViolations.push(field);
  }
  if (!MAPPING_KINDS.includes(rule.kind)) {
    errors.push(validationIssue('invalid_mapping_kind', `${field}.kind must be one of: ${MAPPING_KINDS.join(', ')}`, `${field}.kind`));
    mappingViolations.push(`${field}.kind`);
  }
  if (rule.kind === 'approved_handler' && !APPROVED_HANDLER_REF_PATTERN.test(rule.handlerRef)) {
    errors.push(validationIssue('invalid_handler_reference', `${field} must reference an approved local handler.`, `${field}.handlerRef`));
    mappingViolations.push(`${field}.handlerRef`);
  }
  if (rule.kind === 'declarative' && rule.comparison === UNKNOWN_VALUE) {
    warnings.push(validationIssue('incomplete_semantic_parity_rule', `${field} has no comparison semantics.`, field));
    mappingViolations.push(field);
  }
}

function validateSupersession(adapter = {}, supersessionViolations = [], errors = []) {
  if (adapter.supersedesAdapterId !== UNKNOWN_VALUE && adapter.supersedesAdapterId === adapter.adapterId) {
    errors.push(validationIssue('self_supersession', 'An adapter cannot supersede itself.', 'supersedesAdapterId'));
    supersessionViolations.push('supersedesAdapterId');
  }
  if (adapter.supersededByAdapterId !== UNKNOWN_VALUE && adapter.supersededByAdapterId === adapter.adapterId) {
    errors.push(validationIssue('self_supersession', 'An adapter cannot be superseded by itself.', 'supersededByAdapterId'));
    supersessionViolations.push('supersededByAdapterId');
  }
  if (
    adapter.supersedesAdapterId !== UNKNOWN_VALUE &&
    adapter.supersededByAdapterId !== UNKNOWN_VALUE &&
    adapter.supersedesAdapterId === adapter.supersededByAdapterId
  ) {
    errors.push(validationIssue('circular_supersession', 'Adapter supersession references must not form a direct cycle.', 'supersession'));
    supersessionViolations.push('supersession');
  }
}

function validateSignalMigrationAdapter(adapter = {}) {
  const errors = [];
  const warnings = [];
  const missingRequiredFieldsList = missingRequiredFields(adapter, REQUIRED_SIGNAL_MIGRATION_ADAPTER_FIELDS);
  const authorityViolations = [];
  const fingerprintViolations = [];
  const mappingViolations = [];
  const compatibilityViolations = [];
  const supersessionViolations = [];

  for (const field of missingRequiredFieldsList) {
    errors.push(validationIssue('missing_required_field', `${field} is required.`, field));
  }
  if (adapter.schemaVersion !== SIGNAL_MIGRATION_ADAPTER_SCHEMA_VERSION) errors.push(validationIssue('invalid_schema_version', 'schemaVersion must match Signal Migration Adapter Contract schema.', 'schemaVersion'));
  if (adapter.source !== SIGNAL_MIGRATION_ADAPTER_SOURCE) errors.push(validationIssue('invalid_source', 'source must be signal_migration_adapter_contract.', 'source'));
  if (!DEPRECATION_STATUSES.includes(adapter.deprecationStatus)) errors.push(validationIssue('invalid_deprecation_status', `deprecationStatus must be one of: ${DEPRECATION_STATUSES.join(', ')}`, 'deprecationStatus'));
  if (!PRODUCER_CATEGORIES.includes(adapter.producerCategory)) errors.push(validationIssue('invalid_producer_category', `producerCategory must be one of: ${PRODUCER_CATEGORIES.join(', ')}`, 'producerCategory'));
  if (!SIGNAL_TYPES.includes(adapter.signalType)) errors.push(validationIssue('invalid_signal_type', `signalType must be one of: ${SIGNAL_TYPES.join(', ')}`, 'signalType'));
  if (!DECISION_ROLES.includes(adapter.decisionRole)) errors.push(validationIssue('invalid_decision_role', `decisionRole must be one of: ${DECISION_ROLES.join(', ')}`, 'decisionRole'));
  if (!AUTHORITY_LEVELS.includes(adapter.authorityLevel)) errors.push(validationIssue('invalid_authority_level', `authorityLevel must be one of: ${AUTHORITY_LEVELS.join(', ')}`, 'authorityLevel'));
  if (!EVIDENCE_ROLES.includes(adapter.evidenceRole)) errors.push(validationIssue('invalid_evidence_role', `evidenceRole must be one of: ${EVIDENCE_ROLES.join(', ')}`, 'evidenceRole'));

  validateAuthority(adapter, errors, authorityViolations);
  for (const field of MAPPING_FIELDS) validateMapping(asObject(adapter[field]), field, mappingViolations, errors, warnings);
  asArray(adapter.semanticParityRules).forEach((rule, index) => validateParityRule(rule, index, mappingViolations, errors, warnings));
  if (asArray(adapter.semanticParityRules).length === 0) {
    warnings.push(validationIssue('missing_semantic_parity_rules', 'semanticParityRules remain unspecified.', 'semanticParityRules'));
    mappingViolations.push('semanticParityRules');
  }
  if (asArray(adapter.mismatchReasonCodes).length === 0) {
    warnings.push(validationIssue('missing_mismatch_reason_codes', 'mismatchReasonCodes remain unspecified.', 'mismatchReasonCodes'));
    mappingViolations.push('mismatchReasonCodes');
  }
  if (asArray(adapter.supportedEngineVersions).length === 0) {
    warnings.push(validationIssue('missing_supported_engine_versions', 'supportedEngineVersions remain unspecified.', 'supportedEngineVersions'));
    compatibilityViolations.push('supportedEngineVersions');
  }

  validateSupersession(adapter, supersessionViolations, errors);

  if (adapter.adapterFingerprint && buildSignalMigrationAdapterFingerprint(adapter) !== adapter.adapterFingerprint) {
    errors.push(validationIssue('adapter_fingerprint_mismatch', 'adapterFingerprint does not match adapter contents.', 'adapterFingerprint'));
    fingerprintViolations.push('adapterFingerprint');
  }

  const reasonCodes = unique([
    ...errors.map((error) => error.code),
    ...warnings.map((warning) => warning.code)
  ]).sort();

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes,
    missingRequiredFields: unique(missingRequiredFieldsList).sort(),
    authorityViolations: unique(authorityViolations).sort(),
    fingerprintViolations: unique(fingerprintViolations).sort(),
    mappingViolations: unique(mappingViolations).sort(),
    compatibilityViolations: unique(compatibilityViolations).sort(),
    supersessionViolations: unique(supersessionViolations).sort()
  };
}

function determineAdapterCompatibility(adapter = {}, context = {}) {
  const validation = validateSignalMigrationAdapter(adapter);
  const requestedEngineVersion = normalizeString(firstDefined(context.engineVersion, context.nativeEngineVersion, UNKNOWN_VALUE));
  const requestedSignalVersion = normalizeString(firstDefined(context.signalVersion, UNKNOWN_VALUE));
  const compatibilityViolations = [];

  if (validation.authorityViolations.length > 0) {
    return {
      status: 'blocked',
      reasonCodes: unique([...validation.reasonCodes, 'authority_boundary_violation']).sort(),
      compatibilityViolations: validation.compatibilityViolations
    };
  }
  if (validation.errors.length > 0) {
    return {
      status: 'invalid',
      reasonCodes: validation.reasonCodes,
      compatibilityViolations: validation.compatibilityViolations
    };
  }
  if (
    requestedEngineVersion !== UNKNOWN_VALUE &&
    asArray(adapter.supportedEngineVersions).length > 0 &&
    !asArray(adapter.supportedEngineVersions).includes(requestedEngineVersion)
  ) {
    compatibilityViolations.push('engineVersion');
    return {
      status: 'engine_version_unsupported',
      reasonCodes: unique([...validation.reasonCodes, 'engine_version_unsupported']).sort(),
      compatibilityViolations
    };
  }
  if (requestedSignalVersion !== UNKNOWN_VALUE && adapter.signalVersion !== requestedSignalVersion) {
    compatibilityViolations.push('signalVersion');
    return {
      status: 'signal_version_unsupported',
      reasonCodes: unique([...validation.reasonCodes, 'signal_version_unsupported']).sort(),
      compatibilityViolations
    };
  }
  if (
    validation.mappingViolations.length > 0 ||
    validation.compatibilityViolations.length > 0 ||
    adapter.engineName === UNKNOWN_VALUE ||
    adapter.signalName === UNKNOWN_VALUE
  ) {
    return {
      status: 'incomplete',
      reasonCodes: unique(validation.reasonCodes).sort(),
      compatibilityViolations: validation.compatibilityViolations
    };
  }
  if (validation.warnings.length > 0 || adapter.deprecationStatus !== 'active') {
    return {
      status: 'compatible_with_warnings',
      reasonCodes: validation.reasonCodes,
      compatibilityViolations: validation.compatibilityViolations
    };
  }
  return {
    status: 'compatible',
    reasonCodes: [],
    compatibilityViolations: []
  };
}

module.exports = {
  APPROVED_HANDLER_REF_PATTERN,
  COMPATIBILITY_STATUSES,
  MAPPING_FIELDS,
  MAPPING_KINDS,
  REQUIRED_SIGNAL_MIGRATION_ADAPTER_FIELDS,
  SIGNAL_MIGRATION_ADAPTER_SCHEMA_VERSION,
  SIGNAL_MIGRATION_ADAPTER_SOURCE,
  buildSignalMigrationAdapterFingerprint,
  cloneSignalMigrationAdapter,
  createSignalMigrationAdapter,
  determineAdapterCompatibility,
  validateSignalMigrationAdapter
};
