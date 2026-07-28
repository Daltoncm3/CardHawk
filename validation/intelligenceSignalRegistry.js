'use strict';

const {
  asArray,
  asObject,
  unique
} = require('./canonicalValidationCore');
const {
  buildFingerprintFromProjection
} = require('./fingerprintProjection');
const {
  buildOfflineAuthorityFlags,
  clone,
  firstDefined
} = require('./phase8GovernanceCore');
const {
  AUTHORITY_LEVELS,
  DECISION_ROLES,
  PRODUCER_CATEGORIES,
  SIGNAL_TYPES,
  UNKNOWN_VALUE,
  validateCanonicalSignal
} = require('./canonicalIntelligenceSignalContract');

const INTELLIGENCE_SIGNAL_REGISTRY_SCHEMA_VERSION = '1.0.0';
const INTELLIGENCE_SIGNAL_REGISTRY_SOURCE = 'intelligence_signal_registry';

const EVIDENCE_ROLES = Object.freeze([
  'primary_evidence',
  'supporting_evidence',
  'conflicting_evidence',
  'diagnostic_context',
  'governance_context',
  'not_applicable',
  UNKNOWN_VALUE
]);

const DEPRECATION_STATUSES = Object.freeze([
  'active',
  'deprecated',
  'superseded',
  'retired',
  UNKNOWN_VALUE
]);

const REQUIRED_SIGNAL_DEFINITION_FIELDS = Object.freeze([
  'schemaVersion',
  'source',
  'signalName',
  'signalVersion',
  'producer',
  'producerVersion',
  'producerCategory',
  'signalType',
  'decisionRole',
  'authorityLevel',
  'evidenceRole',
  'expectedInputTypes',
  'expectedOutputFields',
  'confidenceSemantics',
  'uncertaintySemantics',
  'evidenceRequirements',
  'allowedStatuses',
  'downstreamConsumers',
  'governanceRequirements',
  'compatibilityNotes',
  'deprecationStatus',
  'supersedesSignalName',
  'supersededBySignalName',
  'createdAt',
  'productionImpact',
  'decisionImpact',
  'executionAuthority',
  'definitionFingerprint'
]);

const REQUIRED_SIGNAL_REGISTRY_FIELDS = Object.freeze([
  'schemaVersion',
  'source',
  'registryId',
  'registryVersion',
  'createdAt',
  'signalCount',
  'definitions',
  'producerSummary',
  'categorySummary',
  'decisionRoleSummary',
  'authoritySummary',
  'deprecationSummary',
  'productionImpact',
  'decisionImpact',
  'executionAuthority',
  'registryFingerprint'
]);

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

function normalizeObject(value = {}, fallback = {}) {
  if (value === UNKNOWN_VALUE) return UNKNOWN_VALUE;
  return clone(asObject(value === undefined ? fallback : value));
}

function missingRequiredFields(record = {}, fields = []) {
  const input = asObject(record);
  return fields.filter((field) => {
    const value = input[field];
    return value === undefined || value === null || value === '';
  });
}

function signalDefinitionKey(definition = {}) {
  return `${normalizeString(definition.signalName)}@${normalizeString(definition.signalVersion)}`;
}

function sortSignalDefinitions(definitions = []) {
  return asArray(definitions)
    .map((definition) => clone(definition))
    .sort((left, right) => signalDefinitionKey(left).localeCompare(signalDefinitionKey(right)));
}

function buildCountSummary(values = []) {
  const summary = {};
  for (const value of asArray(values)) {
    const key = normalizeString(value);
    summary[key] = (summary[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(summary).sort(([left], [right]) => left.localeCompare(right)));
}

function buildSignalDefinitionFingerprint(definition = {}) {
  const projection = clone(definition);
  delete projection.definitionFingerprint;
  return buildFingerprintFromProjection(projection);
}

function buildSignalRegistryFingerprint(registry = {}) {
  const projection = clone(registry);
  delete projection.registryFingerprint;
  return buildFingerprintFromProjection(projection);
}

function createSignalDefinition(input = {}, options = {}) {
  const governanceFlags = {
    ...buildOfflineAuthorityFlags(input.governanceFlags),
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
  const core = {
    schemaVersion: INTELLIGENCE_SIGNAL_REGISTRY_SCHEMA_VERSION,
    source: INTELLIGENCE_SIGNAL_REGISTRY_SOURCE,
    signalName: normalizeString(firstDefined(input.signalName, options.signalName, 'canonical_signal')),
    signalVersion: normalizeString(firstDefined(input.signalVersion, options.signalVersion, input.producerVersion, '1.0.0')),
    producer: normalizeString(firstDefined(input.producer, input.producerName)),
    producerVersion: normalizeString(firstDefined(input.producerVersion, input.signalVersion)),
    producerCategory: normalizeEnum(input.producerCategory, PRODUCER_CATEGORIES, UNKNOWN_VALUE),
    signalType: normalizeEnum(input.signalType, SIGNAL_TYPES, UNKNOWN_VALUE),
    decisionRole: normalizeEnum(input.decisionRole, DECISION_ROLES, 'none'),
    authorityLevel: normalizeEnum(input.authorityLevel, AUTHORITY_LEVELS, 'advisory'),
    evidenceRole: normalizeEnum(input.evidenceRole, EVIDENCE_ROLES, UNKNOWN_VALUE),
    expectedInputTypes: normalizeStringArray(input.expectedInputTypes),
    expectedOutputFields: normalizeStringArray(input.expectedOutputFields),
    confidenceSemantics: normalizeObject(firstDefined(input.confidenceSemantics, UNKNOWN_VALUE)),
    uncertaintySemantics: normalizeObject(firstDefined(input.uncertaintySemantics, UNKNOWN_VALUE)),
    evidenceRequirements: normalizeObject(firstDefined(input.evidenceRequirements, UNKNOWN_VALUE)),
    allowedStatuses: normalizeStringArray(input.allowedStatuses),
    downstreamConsumers: normalizeStringArray(input.downstreamConsumers),
    governanceRequirements: normalizeObject(firstDefined(input.governanceRequirements, { authorityBoundary: 'advisory_only' })),
    compatibilityNotes: normalizeStringArray(input.compatibilityNotes),
    deprecationStatus: normalizeEnum(input.deprecationStatus, DEPRECATION_STATUSES, 'active'),
    supersedesSignalName: normalizeString(input.supersedesSignalName),
    supersededBySignalName: normalizeString(input.supersededBySignalName),
    createdAt: normalizeDate(firstDefined(input.createdAt, options.createdAt, UNKNOWN_VALUE)),
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none',
    governanceFlags,
    metadata: clone(asObject(input.metadata))
  };

  return deepFreeze({
    ...core,
    definitionFingerprint: buildSignalDefinitionFingerprint(core)
  });
}

function validateAuthority(record, errors, invalidFields, authorityViolations, prefix = '') {
  for (const field of ['productionImpact', 'decisionImpact', 'executionAuthority']) {
    if (record[field] !== 'none') {
      const code = `invalid_${field.replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`)}`;
      errors.push(validationError(code, `${prefix}${field} must remain none.`, `${prefix}${field}`));
      invalidFields.push(`${prefix}${field}`);
      authorityViolations.push(`${prefix}${field}`);
    }
  }

  const flags = asObject(record.governanceFlags);
  for (const [field, value] of Object.entries(flags)) {
    if (field.endsWith('Authority') && value === true) {
      errors.push(validationError('invalid_governance_authority_flag', 'governanceFlags must not grant authority.', `${prefix}governanceFlags.${field}`));
      invalidFields.push(`${prefix}governanceFlags.${field}`);
      authorityViolations.push(`${prefix}governanceFlags.${field}`);
    }
  }
}

function validationError(code, message, field = '') {
  return { code, message, field };
}

function validateEnum(record, field, allowedValues, errors, invalidFields) {
  if (!allowedValues.includes(record[field])) {
    errors.push(validationError('invalid_enum_value', `${field} must be one of: ${allowedValues.join(', ')}`, field));
    invalidFields.push(field);
  }
}

function validateSignalDefinition(definition = {}) {
  const errors = [];
  const warnings = [];
  const invalidFields = [];
  const authorityViolations = [];
  const supersessionViolations = [];
  const fingerprintViolations = [];
  const missing = missingRequiredFields(definition, REQUIRED_SIGNAL_DEFINITION_FIELDS);

  for (const field of missing) {
    errors.push(validationError('missing_required_field', `${field} is required.`, field));
    invalidFields.push(field);
  }

  if (definition.schemaVersion !== INTELLIGENCE_SIGNAL_REGISTRY_SCHEMA_VERSION) {
    errors.push(validationError('invalid_schema_version', 'schemaVersion must match Intelligence Signal Registry schema.', 'schemaVersion'));
    invalidFields.push('schemaVersion');
  }
  if (definition.source !== INTELLIGENCE_SIGNAL_REGISTRY_SOURCE) {
    errors.push(validationError('invalid_source', 'source must be intelligence_signal_registry.', 'source'));
    invalidFields.push('source');
  }

  validateEnum(definition, 'producerCategory', PRODUCER_CATEGORIES, errors, invalidFields);
  validateEnum(definition, 'signalType', SIGNAL_TYPES, errors, invalidFields);
  validateEnum(definition, 'decisionRole', DECISION_ROLES, errors, invalidFields);
  validateEnum(definition, 'authorityLevel', AUTHORITY_LEVELS, errors, invalidFields);
  validateEnum(definition, 'evidenceRole', EVIDENCE_ROLES, errors, invalidFields);
  validateEnum(definition, 'deprecationStatus', DEPRECATION_STATUSES, errors, invalidFields);

  for (const field of ['expectedInputTypes', 'expectedOutputFields', 'allowedStatuses', 'downstreamConsumers', 'compatibilityNotes']) {
    if (!Array.isArray(definition[field])) {
      errors.push(validationError('invalid_array_field', `${field} must be an array.`, field));
      invalidFields.push(field);
    }
  }

  validateAuthority(definition, errors, invalidFields, authorityViolations);

  if (definition.supersedesSignalName !== UNKNOWN_VALUE && definition.supersedesSignalName === definition.signalName) {
    errors.push(validationError('self_supersession', 'A signal definition cannot supersede itself.', 'supersedesSignalName'));
    invalidFields.push('supersedesSignalName');
    supersessionViolations.push('supersedesSignalName');
  }
  if (definition.supersededBySignalName !== UNKNOWN_VALUE && definition.supersededBySignalName === definition.signalName) {
    errors.push(validationError('self_supersession', 'A signal definition cannot be superseded by itself.', 'supersededBySignalName'));
    invalidFields.push('supersededBySignalName');
    supersessionViolations.push('supersededBySignalName');
  }

  if (definition.definitionFingerprint && buildSignalDefinitionFingerprint(definition) !== definition.definitionFingerprint) {
    errors.push(validationError('definition_fingerprint_mismatch', 'definitionFingerprint does not match definition contents.', 'definitionFingerprint'));
    invalidFields.push('definitionFingerprint');
    fingerprintViolations.push('definitionFingerprint');
  }

  if (definition.deprecationStatus !== 'active') {
    warnings.push(validationError('definition_not_active', 'Signal definition is not active.', 'deprecationStatus'));
  }
  if (definition.producer === UNKNOWN_VALUE) {
    warnings.push(validationError('producer_unknown', 'Producer is explicitly unknown.', 'producer'));
  }

  const reasonCodes = unique([...errors.map((error) => error.code), ...warnings.map((warning) => warning.code)]);

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes,
    invalidFields: unique(invalidFields),
    duplicateDefinitions: [],
    missingRequiredFields: unique(missing),
    authorityViolations: unique(authorityViolations),
    supersessionViolations: unique(supersessionViolations),
    fingerprintViolations: unique(fingerprintViolations)
  };
}

function createSignalRegistry(input = {}, options = {}) {
  const definitions = sortSignalDefinitions(asArray(input.definitions).map((definition) => (
    definition && definition.definitionFingerprint ? clone(definition) : createSignalDefinition(definition, options)
  )));
  const core = {
    schemaVersion: INTELLIGENCE_SIGNAL_REGISTRY_SCHEMA_VERSION,
    source: INTELLIGENCE_SIGNAL_REGISTRY_SOURCE,
    registryId: normalizeString(firstDefined(input.registryId, options.registryId, 'intelligence-signal-registry')),
    registryVersion: normalizeString(firstDefined(input.registryVersion, options.registryVersion, '1.0.0')),
    createdAt: normalizeDate(firstDefined(input.createdAt, options.createdAt, UNKNOWN_VALUE)),
    signalCount: definitions.length,
    definitions,
    producerSummary: buildCountSummary(definitions.map((definition) => definition.producer)),
    categorySummary: buildCountSummary(definitions.map((definition) => definition.signalType)),
    decisionRoleSummary: buildCountSummary(definitions.map((definition) => definition.decisionRole)),
    authoritySummary: buildCountSummary(definitions.map((definition) => definition.authorityLevel)),
    deprecationSummary: buildCountSummary(definitions.map((definition) => definition.deprecationStatus)),
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none',
    governanceFlags: {
      ...buildOfflineAuthorityFlags(input.governanceFlags),
      productionImpact: 'none',
      decisionImpact: 'none',
      executionAuthority: 'none'
    },
    metadata: clone(asObject(input.metadata))
  };

  return deepFreeze({
    ...core,
    registryFingerprint: buildSignalRegistryFingerprint(core)
  });
}

function findDuplicateDefinitions(definitions = []) {
  const seen = new Map();
  const duplicates = [];
  for (const definition of asArray(definitions)) {
    const key = signalDefinitionKey(definition);
    if (seen.has(key)) duplicates.push(key);
    seen.set(key, definition);
  }
  return unique(duplicates).sort();
}

function validateSupersessionGraph(definitions = []) {
  const violations = [];
  const byName = new Map();
  for (const definition of asArray(definitions)) {
    if (!byName.has(definition.signalName)) byName.set(definition.signalName, []);
    byName.get(definition.signalName).push(definition);
  }

  for (const definition of asArray(definitions)) {
    if (definition.supersedesSignalName !== UNKNOWN_VALUE && !byName.has(definition.supersedesSignalName)) {
      violations.push(`${definition.signalName}.supersedes_missing`);
    }
    if (definition.supersededBySignalName !== UNKNOWN_VALUE && !byName.has(definition.supersededBySignalName)) {
      violations.push(`${definition.signalName}.superseded_by_missing`);
    }
  }

  const edges = new Map();
  for (const definition of asArray(definitions)) {
    if (definition.supersededBySignalName !== UNKNOWN_VALUE) {
      edges.set(definition.signalName, definition.supersededBySignalName);
    }
  }

  for (const definition of asArray(definitions)) {
    const visited = new Set();
    let current = definition.signalName;
    while (edges.has(current)) {
      if (visited.has(current)) {
        violations.push(`${definition.signalName}.circular_supersession`);
        break;
      }
      visited.add(current);
      current = edges.get(current);
    }
  }

  return unique(violations).sort();
}

function validateSignalRegistry(registry = {}) {
  const errors = [];
  const warnings = [];
  const invalidFields = [];
  const authorityViolations = [];
  const supersessionViolations = [];
  const fingerprintViolations = [];
  const missing = missingRequiredFields(registry, REQUIRED_SIGNAL_REGISTRY_FIELDS);
  const definitions = asArray(registry.definitions);

  for (const field of missing) {
    errors.push(validationError('missing_required_field', `${field} is required.`, field));
    invalidFields.push(field);
  }

  if (registry.schemaVersion !== INTELLIGENCE_SIGNAL_REGISTRY_SCHEMA_VERSION) {
    errors.push(validationError('invalid_schema_version', 'schemaVersion must match Intelligence Signal Registry schema.', 'schemaVersion'));
    invalidFields.push('schemaVersion');
  }
  if (registry.source !== INTELLIGENCE_SIGNAL_REGISTRY_SOURCE) {
    errors.push(validationError('invalid_source', 'source must be intelligence_signal_registry.', 'source'));
    invalidFields.push('source');
  }
  if (!Array.isArray(registry.definitions)) {
    errors.push(validationError('invalid_definitions', 'definitions must be an array.', 'definitions'));
    invalidFields.push('definitions');
  }
  if (registry.signalCount !== definitions.length) {
    errors.push(validationError('signal_count_mismatch', 'signalCount must match definitions length.', 'signalCount'));
    invalidFields.push('signalCount');
  }

  validateAuthority(registry, errors, invalidFields, authorityViolations);

  const duplicateDefinitions = findDuplicateDefinitions(definitions);
  for (const duplicate of duplicateDefinitions) {
    errors.push(validationError('duplicate_signal_definition', `Duplicate signal definition: ${duplicate}`, 'definitions'));
  }

  for (const [index, definition] of definitions.entries()) {
    const validation = validateSignalDefinition(definition);
    if (!validation.valid) {
      errors.push(...validation.errors.map((error) => ({
        ...error,
        field: `definitions.${index}.${error.field}`
      })));
      invalidFields.push(...validation.invalidFields.map((field) => `definitions.${index}.${field}`));
    }
    warnings.push(...validation.warnings.map((warning) => ({
      ...warning,
      field: `definitions.${index}.${warning.field}`
    })));
    authorityViolations.push(...validation.authorityViolations.map((field) => `definitions.${index}.${field}`));
    supersessionViolations.push(...validation.supersessionViolations.map((field) => `definitions.${index}.${field}`));
    fingerprintViolations.push(...validation.fingerprintViolations.map((field) => `definitions.${index}.${field}`));
  }

  const graphViolations = validateSupersessionGraph(definitions);
  for (const violation of graphViolations) {
    errors.push(validationError(
      violation.includes('circular') ? 'circular_supersession' : 'invalid_supersession_reference',
      `Invalid supersession relationship: ${violation}`,
      'definitions'
    ));
    supersessionViolations.push(violation);
  }

  if (registry.registryFingerprint && buildSignalRegistryFingerprint(registry) !== registry.registryFingerprint) {
    errors.push(validationError('registry_fingerprint_mismatch', 'registryFingerprint does not match registry contents.', 'registryFingerprint'));
    invalidFields.push('registryFingerprint');
    fingerprintViolations.push('registryFingerprint');
  }

  const reasonCodes = unique([...errors.map((error) => error.code), ...warnings.map((warning) => warning.code)]);

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes,
    invalidFields: unique(invalidFields),
    duplicateDefinitions,
    missingRequiredFields: unique(missing),
    authorityViolations: unique(authorityViolations),
    supersessionViolations: unique(supersessionViolations),
    fingerprintViolations: unique(fingerprintViolations)
  };
}

function registerSignalDefinition(registry = {}, definition = {}) {
  const current = createSignalRegistry(registry);
  const nextDefinition = definition && definition.definitionFingerprint ? clone(definition) : createSignalDefinition(definition);
  return createSignalRegistry({
    ...current,
    definitions: [...current.definitions, nextDefinition]
  });
}

function unregisterSignalDefinition(registry = {}, signalName, signalVersion) {
  const current = createSignalRegistry(registry);
  const targetName = normalizeString(signalName);
  const targetVersion = normalizeString(signalVersion);
  return createSignalRegistry({
    ...current,
    definitions: current.definitions.filter((definition) => !(
      definition.signalName === targetName && definition.signalVersion === targetVersion
    ))
  });
}

function getSignalDefinition(registry = {}, signalName, signalVersion) {
  const targetName = normalizeString(signalName);
  const targetVersion = normalizeString(signalVersion);
  const match = asArray(registry.definitions).find((definition) => (
    definition.signalName === targetName && definition.signalVersion === targetVersion
  ));
  return match ? clone(match) : null;
}

function listSignalDefinitions(registry = {}) {
  return sortSignalDefinitions(registry.definitions);
}

function filterSignalDefinitions(registry = {}, filters = {}) {
  const input = asObject(filters);
  return listSignalDefinitions(registry).filter((definition) => {
    if (known(input.producer) && definition.producer !== input.producer) return false;
    if (known(input.producerCategory) && definition.producerCategory !== input.producerCategory) return false;
    if (known(input.signalType) && definition.signalType !== input.signalType) return false;
    if (known(input.decisionRole) && definition.decisionRole !== input.decisionRole) return false;
    if (known(input.authorityLevel) && definition.authorityLevel !== input.authorityLevel) return false;
    if (known(input.deprecationStatus) && definition.deprecationStatus !== input.deprecationStatus) return false;
    if (known(input.downstreamConsumer) && !asArray(definition.downstreamConsumers).includes(input.downstreamConsumer)) return false;
    return true;
  });
}

function sortSignalDefinitionsPublic(definitions = [], sortBy = 'signalName') {
  const sorted = asArray(definitions).map((definition) => clone(definition));
  return sorted.sort((left, right) => {
    const leftValue = normalizeString(firstDefined(left[sortBy], left.signalName));
    const rightValue = normalizeString(firstDefined(right[sortBy], right.signalName));
    const primary = leftValue.localeCompare(rightValue);
    return primary || signalDefinitionKey(left).localeCompare(signalDefinitionKey(right));
  });
}

function summarizeSignalRegistry(registry = {}) {
  const definitions = asArray(registry.definitions);
  return deepFreeze({
    schemaVersion: INTELLIGENCE_SIGNAL_REGISTRY_SCHEMA_VERSION,
    registryId: normalizeString(registry.registryId),
    registryVersion: normalizeString(registry.registryVersion),
    signalCount: definitions.length,
    producerSummary: buildCountSummary(definitions.map((definition) => definition.producer)),
    categorySummary: buildCountSummary(definitions.map((definition) => definition.signalType)),
    decisionRoleSummary: buildCountSummary(definitions.map((definition) => definition.decisionRole)),
    authoritySummary: buildCountSummary(definitions.map((definition) => definition.authorityLevel)),
    deprecationSummary: buildCountSummary(definitions.map((definition) => definition.deprecationStatus)),
    activeSignals: definitions.filter((definition) => definition.deprecationStatus === 'active').length,
    deprecatedSignals: definitions.filter((definition) => definition.deprecationStatus !== 'active').length,
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  });
}

function exportSignalRegistry(registry = {}) {
  return JSON.stringify(registry, null, 2);
}

function importSignalRegistry(serialized) {
  const parsed = typeof serialized === 'string' ? JSON.parse(serialized) : serialized;
  return createSignalRegistry(parsed);
}

module.exports = {
  DEPRECATION_STATUSES,
  EVIDENCE_ROLES,
  INTELLIGENCE_SIGNAL_REGISTRY_SCHEMA_VERSION,
  INTELLIGENCE_SIGNAL_REGISTRY_SOURCE,
  REQUIRED_SIGNAL_DEFINITION_FIELDS,
  REQUIRED_SIGNAL_REGISTRY_FIELDS,
  buildSignalDefinitionFingerprint,
  buildSignalRegistryFingerprint,
  createSignalDefinition,
  createSignalRegistry,
  exportSignalRegistry,
  filterSignalDefinitions,
  getSignalDefinition,
  importSignalRegistry,
  listSignalDefinitions,
  registerSignalDefinition,
  sortSignalDefinitions: sortSignalDefinitionsPublic,
  summarizeSignalRegistry,
  unregisterSignalDefinition,
  validateCanonicalSignal,
  validateSignalDefinition,
  validateSignalRegistry
};
