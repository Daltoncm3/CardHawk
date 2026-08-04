'use strict';

const {
  asArray,
  asObject,
  fingerprint,
  unique
} = require('./canonicalValidationCore');
const {
  createCanonicalSignal,
  validateCanonicalSignal,
  UNKNOWN_VALUE
} = require('./canonicalIntelligenceSignalContract');

const SOURCE = 'runtime_canonical_signal_compatibility_adapter';
const VERSION = '1.0.0';
const SCHEMA_VERSION = '1.0.0';

const COMPATIBILITY_CLASSIFICATIONS = Object.freeze({
  DIRECT: 'DIRECT',
  DERIVED: 'DERIVED',
  CONDITIONAL: 'CONDITIONAL',
  ONE_WAY_ONLY: 'ONE_WAY_ONLY',
  INTENTIONALLY_UNMAPPED: 'INTENTIONALLY_UNMAPPED',
  INCOMPATIBLE: 'INCOMPATIBLE',
  LEGACY_ALIAS: 'LEGACY_ALIAS'
});

const TRANSFORMATION_OUTCOMES = Object.freeze([
  'adapted',
  'partially_adapted',
  'withheld',
  'rejected',
  'invalid_input'
]);

const RUNTIME_TO_CANONICAL_SIGNAL_TYPES = Object.freeze({
  evidence: 'evidence',
  context: 'context',
  financial: 'financial',
  legacy: 'context',
  production_decision: 'decision'
});

const RUNTIME_TO_DECISION_ROLES = Object.freeze({
  none: 'none',
  context_only: 'supporting_context',
  evidence_only: 'supporting_context',
  decision_support: 'supporting_context',
  production_decision: 'supporting_context'
});

const RUNTIME_WARNING_FIELDS = Object.freeze([
  'qualityWarnings',
  'confidenceReasons',
  'qualityReasons',
  'failedReasons',
  'rejectionReasons',
  'reasons',
  'blockers',
  'cautionSignals',
  'conflicts'
]);

const AUTHORITY_FIELDS = Object.freeze([
  'productionImpact',
  'decisionImpact',
  'executionAuthority'
]);

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function known(value) {
  return value !== undefined && value !== null && value !== '';
}

function normalizeString(value, fallback = UNKNOWN_VALUE) {
  if (!known(value)) return fallback;
  return String(value).trim() || fallback;
}

function normalizeDate(value, fallback = UNKNOWN_VALUE) {
  if (!known(value)) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function normalizeArray(value) {
  if (Array.isArray(value)) return value.map((item) => clone(item));
  if (!known(value)) return [];
  return [clone(value)];
}

function sortStrings(values = []) {
  return unique(asArray(values).map((value) => normalizeString(value, '')).filter(Boolean)).sort();
}

function buildRuntimeSignalCompatibilityFingerprint(record = {}) {
  const projection = clone(record);
  delete projection.compatibilityFingerprint;
  delete projection.batchFingerprint;
  delete projection.validation;
  return fingerprint(projection);
}

function validationIssue(code, message, field = '') {
  return { code, message, field };
}

function hasAuthorityEscalation(record = {}) {
  const input = asObject(record);
  return AUTHORITY_FIELDS.some((field) => (
    input[field] !== undefined &&
    input[field] !== null &&
    input[field] !== '' &&
    input[field] !== 'none'
  ));
}

function collectAuthorityViolations(...records) {
  const violations = [];
  for (const record of records.map(asObject)) {
    for (const field of AUTHORITY_FIELDS) {
      if (record[field] !== undefined && record[field] !== 'none') violations.push(field);
    }
  }
  return sortStrings(violations);
}

function inferClassification(input = {}) {
  const runtime = asObject(input.runtimeSignalContract);
  const signalId = normalizeString(input.runtimeSignalId || runtime.signalId, '');
  const raw = input.runtimeRawValue;
  const expected = normalizeString(input.expectedMappingClassification, '');
  if (Object.values(COMPATIBILITY_CLASSIFICATIONS).includes(expected)) return expected;
  if (hasAuthorityEscalation(input.attemptedTarget)) return COMPATIBILITY_CLASSIFICATIONS.INCOMPATIBLE;
  if (signalId === 'deal_gate') return COMPATIBILITY_CLASSIFICATIONS.ONE_WAY_ONLY;
  if (signalId === 'deal_grade' || runtime.signalType === 'legacy') return COMPATIBILITY_CLASSIFICATIONS.LEGACY_ALIAS;
  if (runtime.allowedDisplayLanguage && !known(raw)) return COMPATIBILITY_CLASSIFICATIONS.INTENTIONALLY_UNMAPPED;
  if (runtime.allowsFallbackEvidence === true && !raw?.fallbackUsed) return COMPATIBILITY_CLASSIFICATIONS.INCOMPATIBLE;
  if (runtime.requiresTrueSold === true) return COMPATIBILITY_CLASSIFICATIONS.CONDITIONAL;
  if (runtime.owner) return COMPATIBILITY_CLASSIFICATIONS.DERIVED;
  return COMPATIBILITY_CLASSIFICATIONS.DIRECT;
}

function determineOutcome(input = {}, inputValidation = {}) {
  const classification = inferClassification(input);
  if (hasAuthorityEscalation(input.attemptedTarget)) return 'rejected';
  if (!inputValidation.valid) return 'invalid_input';
  if (classification === COMPATIBILITY_CLASSIFICATIONS.INCOMPATIBLE) return 'withheld';
  if (classification === COMPATIBILITY_CLASSIFICATIONS.INTENTIONALLY_UNMAPPED) return 'withheld';
  if (classification === COMPATIBILITY_CLASSIFICATIONS.ONE_WAY_ONLY) return 'partially_adapted';
  return 'adapted';
}

function collectWarningsFromValue(rawValue = {}) {
  const raw = asObject(rawValue);
  const warnings = [];
  for (const field of RUNTIME_WARNING_FIELDS) {
    for (const item of normalizeArray(raw[field])) {
      warnings.push({
        sourceField: field,
        value: item,
        severity: normalizeString(asObject(item).severity, UNKNOWN_VALUE)
      });
    }
  }
  const ruleReasons = asArray(raw.dealGateBreakdown?.rules)
    .filter((rule) => known(rule.reason))
    .map((rule) => ({
      sourceField: 'dealGateBreakdown.rules.reason',
      value: rule.reason,
      ruleId: normalizeString(rule.ruleId, UNKNOWN_VALUE),
      severity: UNKNOWN_VALUE
    }));
  return [...warnings, ...ruleReasons];
}

function collectWarningStrings(rawValue = {}) {
  return collectWarningsFromValue(rawValue).map((warning) => {
    if (typeof warning.value === 'string') return warning.value;
    if (warning.value && typeof warning.value === 'object') {
      return normalizeString(warning.value.code || warning.value.message || warning.sourceField);
    }
    return normalizeString(warning.value);
  });
}

function detectReadiness(rawValue = {}) {
  const raw = asObject(rawValue);
  const value = raw.evidenceReadiness || raw.overallReadiness || raw.readinessStatus || raw.readinessLevel;
  return {
    sourceFields: ['evidenceReadiness', 'overallReadiness', 'readinessStatus', 'readinessLevel'].filter((field) => raw[field] !== undefined),
    value: known(value) ? clone(value) : UNKNOWN_VALUE,
    status: known(value) ? 'preserved' : 'missing',
    upgraded: false,
    dealGateApprovalCreated: false,
    purchaseAuthorityCreated: false
  };
}

function detectConfidence(input = {}) {
  const raw = input.runtimeRawValue;
  const rawObject = asObject(raw);
  const candidates = [
    rawObject.confidence,
    rawObject.confidenceScore,
    rawObject.marketConfidence,
    rawObject.valuationConfidence,
    typeof raw === 'number' ? raw : undefined
  ];
  const value = candidates.find(known);
  const contract = asObject(input.runtimeSignalContract);
  return {
    value: known(value) ? clone(value) : UNKNOWN_VALUE,
    status: known(value) ? 'preserved' : 'missing',
    meaning: normalizeString(contract.confidenceMeaning, UNKNOWN_VALUE),
    provenance: {
      runtimeSignalId: normalizeString(input.runtimeSignalId || contract.signalId),
      owner: normalizeString(contract.owner)
    },
    valuationConfidenceCreated: false,
    recommendationAuthorityCreated: false
  };
}

function collectUnmappedFields(input = {}) {
  const contract = asObject(input.runtimeSignalContract);
  const fields = [];
  if (contract.allowedDisplayLanguage) fields.push('runtimeSignalContract.allowedDisplayLanguage');
  if (contract.displayPriority !== undefined) fields.push('runtimeSignalContract.displayPriority');
  return sortStrings(fields);
}

function collectIncompatibleFields(input = {}) {
  const contract = asObject(input.runtimeSignalContract);
  const fields = [];
  if (contract.allowsFallbackEvidence === true && asObject(input.runtimeRawValue).fallbackUsed === undefined) {
    fields.push('runtimeSignalContract.allowsFallbackEvidence');
  }
  if (hasAuthorityEscalation(input.attemptedTarget)) {
    fields.push(...AUTHORITY_FIELDS.map((field) => `attemptedTarget.${field}`));
  }
  if (asObject(input.runtimeRawValue).overallReadiness !== undefined) {
    fields.push('runtimeRawValue.overallReadiness->canonical.status');
  }
  return sortStrings(fields);
}

function determineCanonicalSignalType(contract = {}) {
  const type = normalizeString(contract.signalType, UNKNOWN_VALUE);
  return RUNTIME_TO_CANONICAL_SIGNAL_TYPES[type] || UNKNOWN_VALUE;
}

function determineDecisionRole(contract = {}) {
  const role = normalizeString(contract.decisionEligibility, 'none');
  return RUNTIME_TO_DECISION_ROLES[role] || 'none';
}

function determineAuthorityLevel(classification, contract = {}) {
  if (classification === COMPATIBILITY_CLASSIFICATIONS.ONE_WAY_ONLY) return 'display_metadata';
  if (classification === COMPATIBILITY_CLASSIFICATIONS.LEGACY_ALIAS) return 'display_metadata';
  if (normalizeString(contract.signalType, '') === 'production_decision') return 'display_metadata';
  return 'advisory';
}

function buildEvidenceBasis(input = {}) {
  const raw = asObject(input.runtimeRawValue);
  const contract = asObject(input.runtimeSignalContract);
  const count = raw.trueSoldCompCount ?? raw.trueSoldEvidenceCount;
  const evidenceBasis = {};
  if (Number.isFinite(Number(count)) && contract.requiresTrueSold === true) {
    evidenceBasis.trueSoldCount = Number(count);
  }
  return evidenceBasis;
}

function buildNormalizedOutput(input = {}, preservation = {}) {
  const raw = input.runtimeRawValue;
  return {
    runtimeSignalId: normalizeString(input.runtimeSignalId || input.runtimeSignalContract?.signalId),
    runtimeSignalType: normalizeString(input.runtimeSignalContract?.signalType),
    runtimeDecisionEligibility: normalizeString(input.runtimeSignalContract?.decisionEligibility),
    rawValue: clone(raw),
    readiness: preservation.readiness.value,
    displayAnnotation: clone(input.runtimeAnnotation || UNKNOWN_VALUE),
    unmappedFields: preservation.unmappedFields,
    incompatibleFields: preservation.incompatibleFields
  };
}

function createCanonicalCandidate(input = {}, classification, preservation = {}) {
  if (classification === COMPATIBILITY_CLASSIFICATIONS.INCOMPATIBLE) return null;
  if (classification === COMPATIBILITY_CLASSIFICATIONS.INTENTIONALLY_UNMAPPED) return null;
  if (hasAuthorityEscalation(input.attemptedTarget)) return null;

  const contract = asObject(input.runtimeSignalContract);
  const signalId = normalizeString(input.runtimeSignalId || contract.signalId, 'runtime-signal');
  const confidence = preservation.confidence.value === UNKNOWN_VALUE
    ? UNKNOWN_VALUE
    : {
        kind: 'reported',
        value: preservation.confidence.value,
        scale: typeof preservation.confidence.value === 'number' ? '0_100' : UNKNOWN_VALUE,
        basis: preservation.confidence.meaning,
        calibrated: false
      };

  return createCanonicalSignal({
    signalId,
    signalName: normalizeString(input.canonicalSignalName || signalId.replace(/_/g, '.')),
    producer: {
      producerId: normalizeString(contract.owner, signalId),
      name: normalizeString(contract.owner, signalId),
      module: UNKNOWN_VALUE,
      functionName: UNKNOWN_VALUE,
      version: normalizeString(contract.schemaVersion, UNKNOWN_VALUE),
      category: 'utility',
      metadata: {
        runtimeSignalId: signalId,
        runtimeOwner: normalizeString(contract.owner),
        runtimeSchemaVersion: normalizeString(contract.schemaVersion)
      }
    },
    producerVersion: normalizeString(contract.schemaVersion, UNKNOWN_VALUE),
    producerCategory: 'utility',
    createdAt: normalizeDate(input.createdAt || input.provenance?.capturedAt || UNKNOWN_VALUE),
    signalType: determineCanonicalSignalType(contract),
    decisionRole: determineDecisionRole(contract),
    authorityLevel: determineAuthorityLevel(classification, contract),
    confidence,
    confidenceLevel: UNKNOWN_VALUE,
    evidenceBasis: buildEvidenceBasis(input),
    evidenceQuality: UNKNOWN_VALUE,
    warnings: collectWarningStrings(input.runtimeRawValue),
    blockers: normalizeArray(asObject(input.runtimeRawValue).blockers).map((value) => normalizeString(value)).filter(Boolean),
    rawOutput: clone(input.runtimeRawValue),
    normalizedOutput: buildNormalizedOutput(input, preservation),
    sourceFingerprint: fingerprint({
      runtimeSignalId: signalId,
      runtimeSignalContract: contract,
      runtimeRawValue: input.runtimeRawValue
    }),
    metadata: {
      source: SOURCE,
      compatibilityClassification: classification,
      runtimeInputPreserved: true,
      nativeOutputPreserved: true,
      provenance: clone(input.provenance || {})
    }
  });
}

function buildTransformationHistory(input = {}, classification, preservation = {}) {
  const contract = asObject(input.runtimeSignalContract);
  const history = [
    {
      sourceField: 'runtimeSignalId',
      resultingField: 'canonicalSignal.signalId',
      compatibilityClassification: classification === COMPATIBILITY_CLASSIFICATIONS.LEGACY_ALIAS ? COMPATIBILITY_CLASSIFICATIONS.LEGACY_ALIAS : COMPATIBILITY_CLASSIFICATIONS.DIRECT,
      transformationExplanation: 'Runtime signal identity is preserved as the canonical candidate signalId or raw provenance.',
      informationLoss: false,
      authorityImpact: 'none',
      warningImpact: 'none',
      readinessImpact: 'none'
    },
    {
      sourceField: 'runtimeRawValue',
      resultingField: 'canonicalSignal.rawOutput',
      compatibilityClassification: classification === COMPATIBILITY_CLASSIFICATIONS.INCOMPATIBLE ? COMPATIBILITY_CLASSIFICATIONS.INCOMPATIBLE : COMPATIBILITY_CLASSIFICATIONS.DIRECT,
      transformationExplanation: 'Runtime raw value is preserved without recomputation.',
      informationLoss: false,
      authorityImpact: 'none',
      warningImpact: preservation.warning.count > 0 ? 'warnings_preserved' : 'none',
      readinessImpact: preservation.readiness.status === 'preserved' ? 'readiness_preserved' : 'none'
    }
  ];

  if (contract.owner) {
    history.push({
      sourceField: 'runtimeSignalContract.owner',
      resultingField: 'canonicalSignal.producer.name',
      compatibilityClassification: COMPATIBILITY_CLASSIFICATIONS.DERIVED,
      transformationExplanation: 'Runtime owner is represented as producer identity metadata.',
      informationLoss: false,
      authorityImpact: 'none',
      warningImpact: 'none',
      readinessImpact: 'none'
    });
  }

  if (preservation.unmappedFields.length > 0) {
    history.push({
      sourceField: preservation.unmappedFields.join(','),
      resultingField: 'metadata.unmappedFields',
      compatibilityClassification: COMPATIBILITY_CLASSIFICATIONS.INTENTIONALLY_UNMAPPED,
      transformationExplanation: 'Runtime-only presentation metadata is preserved without canonical semantic equivalence.',
      informationLoss: false,
      authorityImpact: 'none',
      warningImpact: 'none',
      readinessImpact: 'none'
    });
  }

  if (preservation.incompatibleFields.length > 0) {
    history.push({
      sourceField: preservation.incompatibleFields.join(','),
      resultingField: 'metadata.incompatibleFields',
      compatibilityClassification: COMPATIBILITY_CLASSIFICATIONS.INCOMPATIBLE,
      transformationExplanation: 'Incompatible source fields are withheld from canonical semantic fields and preserved as raw evidence.',
      informationLoss: false,
      authorityImpact: 'blocked',
      warningImpact: 'none',
      readinessImpact: preservation.incompatibleFields.some((field) => field.includes('Readiness')) ? 'upgrade_prevented' : 'none'
    });
  }

  return history;
}

function validateRuntimeSignalCompatibilityInput(input = {}) {
  const errors = [];
  const warnings = [];
  const invalidFields = [];

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    errors.push(validationIssue('invalid_input_type', 'Input must be an object.', 'input'));
    invalidFields.push('input');
  }

  const record = asObject(input);
  const contract = asObject(record.runtimeSignalContract);
  const runtimeSignalId = record.runtimeSignalId || contract.signalId;

  if (!known(runtimeSignalId)) {
    errors.push(validationIssue('missing_runtime_signal_id', 'runtimeSignalId or runtimeSignalContract.signalId is required.', 'runtimeSignalId'));
    invalidFields.push('runtimeSignalId');
  }

  if (Object.keys(contract).length === 0) {
    errors.push(validationIssue('missing_runtime_signal_contract', 'runtimeSignalContract is required.', 'runtimeSignalContract'));
    invalidFields.push('runtimeSignalContract');
  }

  if (!('runtimeRawValue' in record)) {
    errors.push(validationIssue('missing_runtime_raw_value', 'runtimeRawValue is required and may be null only when explicitly supplied.', 'runtimeRawValue'));
    invalidFields.push('runtimeRawValue');
  }

  if (contract.schemaVersion === 'unknown') {
    warnings.push(validationIssue('unknown_source_version_preserved', 'Runtime source version is explicitly unknown.', 'runtimeSignalContract.schemaVersion'));
  } else if (known(contract.schemaVersion) && contract.schemaVersion !== '1.0.0') {
    warnings.push(validationIssue('unsupported_source_version', 'Runtime source version is not the audited 1.0.0 display contract version.', 'runtimeSignalContract.schemaVersion'));
  } else if (!known(contract.schemaVersion)) {
    warnings.push(validationIssue('missing_source_version', 'Runtime source version is missing.', 'runtimeSignalContract.schemaVersion'));
  }

  if (hasAuthorityEscalation(record.attemptedTarget)) {
    errors.push(validationIssue('prohibited_authority_mapping', 'Attempted target would grant authority.', 'attemptedTarget'));
    invalidFields.push('attemptedTarget');
  }

  const reasonCodes = sortStrings([...errors.map((error) => error.code), ...warnings.map((warning) => warning.code)]);
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes,
    invalidFields: sortStrings(invalidFields)
  };
}

function buildPreservation(input = {}) {
  const warnings = collectWarningsFromValue(input.runtimeRawValue);
  const readiness = detectReadiness(input.runtimeRawValue);
  const confidence = detectConfidence(input);
  const unmappedFields = collectUnmappedFields(input);
  const incompatibleFields = collectIncompatibleFields(input);

  return {
    warning: {
      status: 'preserved',
      count: warnings.length,
      warnings,
      unknownWarningCodes: warnings
        .filter((warning) => warning.value && typeof warning.value === 'object' && !warning.value.code)
        .map((warning) => warning.sourceField),
      ordering: 'source_order_preserved'
    },
    readiness,
    confidence,
    unmappedFields,
    incompatibleFields
  };
}

function buildSchemaVersionHandling(input = {}) {
  const contractVersion = normalizeString(input.runtimeSignalContract?.schemaVersion, UNKNOWN_VALUE);
  return {
    runtimeSchemaVersion: contractVersion,
    adapterSchemaVersion: SCHEMA_VERSION,
    canonicalSchemaVersion: '1.0.0',
    equivalentSchemas: false,
    status: contractVersion === '1.0.0' ? 'supported' : contractVersion === UNKNOWN_VALUE ? 'unknown' : 'unsupported'
  };
}

function buildUnknownFieldHandling(input = {}, preservation = {}) {
  const raw = input.runtimeRawValue;
  return {
    explicitUnknownPreserved: JSON.stringify(raw).includes('"unknown"') || raw === UNKNOWN_VALUE,
    missingValuesRemainUnknown: true,
    unknownWarningCodesPreserved: true,
    unmappedFields: preservation.unmappedFields
  };
}

function buildNullHandling(input = {}) {
  return {
    rawNullPreserved: input.runtimeRawValue === null,
    nullConvertedToPositiveEvidence: false,
    nullConvertedToZeroConfidence: false
  };
}

function buildFallbackHandling(input = {}) {
  return {
    fallbackUsedInAdapter: false,
    guardedFallbacksOnly: true,
    fallbackPermissionConvertedToUsage: false,
    unknownFallback: UNKNOWN_VALUE
  };
}

function summarizeRuntimeSignalCompatibility(output = {}) {
  const records = output.records || (output.record ? [output.record] : [output]);
  const actualRecords = asArray(records).filter((record) => record && record.schemaVersion === SCHEMA_VERSION);
  const classificationSummary = {};
  const outcomeSummary = {};
  let warningCount = 0;
  let readinessPreservedCount = 0;
  let authorityViolationCount = 0;

  for (const record of actualRecords) {
    const classification = normalizeString(record.mappingClassification, UNKNOWN_VALUE);
    const outcome = normalizeString(record.transformationOutcome, UNKNOWN_VALUE);
    classificationSummary[classification] = (classificationSummary[classification] || 0) + 1;
    outcomeSummary[outcome] = (outcomeSummary[outcome] || 0) + 1;
    warningCount += Number(record.warningPreservation?.count || 0);
    if (record.readinessPreservation?.status === 'preserved') readinessPreservedCount += 1;
    authorityViolationCount += asArray(record.validation?.authorityViolations).length;
  }

  return deepFreeze({
    schemaVersion: SCHEMA_VERSION,
    source: SOURCE,
    recordCount: actualRecords.length,
    validCount: actualRecords.filter((record) => record.validation?.valid === true).length,
    invalidCount: actualRecords.filter((record) => record.validation?.valid !== true).length,
    classificationSummary: Object.fromEntries(Object.entries(classificationSummary).sort(([left], [right]) => left.localeCompare(right))),
    outcomeSummary: Object.fromEntries(Object.entries(outcomeSummary).sort(([left], [right]) => left.localeCompare(right))),
    warningCount,
    readinessPreservedCount,
    authorityViolationCount,
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  });
}

function validateRuntimeSignalCompatibilityOutput(output = {}) {
  const errors = [];
  const warnings = [];
  const invalidFields = [];
  const authorityViolations = [];
  const fingerprintViolations = [];
  const record = asObject(output);

  if (record.schemaVersion !== SCHEMA_VERSION) {
    errors.push(validationIssue('invalid_schema_version', 'Output schemaVersion is invalid.', 'schemaVersion'));
    invalidFields.push('schemaVersion');
  }
  if (record.source !== SOURCE) {
    errors.push(validationIssue('invalid_source', 'Output source is invalid.', 'source'));
    invalidFields.push('source');
  }

  if (record.inputValidation && record.inputValidation.valid === false) {
    errors.push(...asArray(record.inputValidation.errors).map((error) => ({ ...error, field: `inputValidation.${error.field || ''}` })));
    invalidFields.push(...asArray(record.inputValidation.invalidFields).map((field) => `inputValidation.${field}`));
  }
  if (!TRANSFORMATION_OUTCOMES.includes(record.transformationOutcome)) {
    errors.push(validationIssue('invalid_transformation_outcome', 'transformationOutcome is not supported.', 'transformationOutcome'));
    invalidFields.push('transformationOutcome');
  }
  if (!Object.values(COMPATIBILITY_CLASSIFICATIONS).includes(record.mappingClassification)) {
    errors.push(validationIssue('invalid_mapping_classification', 'mappingClassification is not supported.', 'mappingClassification'));
    invalidFields.push('mappingClassification');
  }

  authorityViolations.push(...collectAuthorityViolations(record, record.authorityPreservation));
  for (const field of authorityViolations) {
    errors.push(validationIssue('authority_boundary_violation', `${field} must remain none.`, field));
    invalidFields.push(field);
  }

  if (record.nativeInputPreservation?.preserved !== true || record.nativeOutputPreserved !== true) {
    errors.push(validationIssue('native_output_not_preserved', 'Native runtime input/output must be preserved.', 'nativeInputPreservation'));
    invalidFields.push('nativeInputPreservation');
  }

  if (record.warningPreservation?.status !== 'preserved') {
    errors.push(validationIssue('warnings_not_preserved', 'Warnings must be preserved.', 'warningPreservation'));
    invalidFields.push('warningPreservation');
  }

  if (record.readinessPreservation?.upgraded === true) {
    errors.push(validationIssue('readiness_upgraded', 'Readiness must not be upgraded.', 'readinessPreservation'));
    invalidFields.push('readinessPreservation');
  }

  if (record.confidencePreservation?.recommendationAuthorityCreated === true) {
    errors.push(validationIssue('confidence_authority_created', 'Confidence must not create recommendation authority.', 'confidencePreservation'));
    invalidFields.push('confidencePreservation');
  }

  if (record.canonicalSignal) {
    const canonicalValidation = validateCanonicalSignal(record.canonicalSignal);
    if (!canonicalValidation.valid) {
      errors.push(...canonicalValidation.errors.map((error) => ({ ...error, field: `canonicalSignal.${error.field || ''}` })));
      invalidFields.push('canonicalSignal');
    }
    warnings.push(...canonicalValidation.warnings.map((warning) => ({ ...warning, field: `canonicalSignal.${warning.field || ''}` })));
  }

  if (record.compatibilityFingerprint && buildRuntimeSignalCompatibilityFingerprint(record) !== record.compatibilityFingerprint) {
    errors.push(validationIssue('compatibility_fingerprint_mismatch', 'compatibilityFingerprint does not match output contents.', 'compatibilityFingerprint'));
    fingerprintViolations.push('compatibilityFingerprint');
    invalidFields.push('compatibilityFingerprint');
  }

  const reasonCodes = sortStrings([
    ...asArray(record.inputValidation?.reasonCodes),
    ...errors.map((error) => error.code),
    ...warnings.map((warning) => warning.code),
    ...asArray(record.expectedReasonCodes)
  ]);

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes,
    invalidFields: sortStrings(invalidFields),
    authorityViolations: sortStrings(authorityViolations),
    fingerprintViolations: sortStrings(fingerprintViolations)
  };
}

function adaptRuntimeSignalToCanonical(input = {}, options = {}) {
  const sourceInput = clone(input);
  const inputValidation = validateRuntimeSignalCompatibilityInput(input);
  const classification = inferClassification(input);
  const outcome = determineOutcome(input, inputValidation);
  const preservation = buildPreservation(input);
  const canonicalSignal = inputValidation.valid ? createCanonicalCandidate(input, classification, preservation) : null;
  const sourceFingerprint = fingerprint({
    input: sourceInput,
    adapterVersion: VERSION,
    schemaVersion: SCHEMA_VERSION,
    options: clone(options)
  });
  const core = {
    schemaVersion: SCHEMA_VERSION,
    source: SOURCE,
    version: VERSION,
    adapterRunId: normalizeString(input.adapterRunId || options.adapterRunId || `${SOURCE}:${sourceFingerprint}`),
    createdAt: normalizeDate(input.createdAt || options.createdAt || UNKNOWN_VALUE),
    runtimeSignalId: normalizeString(input.runtimeSignalId || input.runtimeSignalContract?.signalId),
    mappingClassification: classification,
    transformationOutcome: outcome,
    runtimeInput: sourceInput,
    nativeInputPreservation: {
      preserved: JSON.stringify(sourceInput) === JSON.stringify(input),
      sourceFingerprint
    },
    nativeOutputPreserved: true,
    canonicalSignal,
    warningPreservation: preservation.warning,
    readinessPreservation: preservation.readiness,
    confidencePreservation: preservation.confidence,
    authorityPreservation: {
      status: preservation.incompatibleFields.some((field) => field.includes('attemptedTarget')) ? 'blocked' : 'preserved',
      offline: true,
      nonProduction: true,
      nonAuthoritative: true,
      notDealGateEligible: true,
      notBuyNowEligible: true,
      notNotificationEligible: true,
      productionImpact: 'none',
      decisionImpact: 'none',
      executionAuthority: 'none',
      authorityViolations: collectAuthorityViolations(input.attemptedTarget)
    },
    schemaVersionHandling: buildSchemaVersionHandling(input),
    unknownFieldHandling: buildUnknownFieldHandling(input, preservation),
    nullHandling: buildNullHandling(input),
    fallbackHandling: buildFallbackHandling(input),
    unmappedFields: preservation.unmappedFields,
    incompatibleFields: preservation.incompatibleFields,
    transformationHistory: buildTransformationHistory(input, classification, preservation),
    mappingResult: {
      canonicalOutputCreated: Boolean(canonicalSignal),
      supportedBySpecification: ![
        COMPATIBILITY_CLASSIFICATIONS.INCOMPATIBLE,
        COMPATIBILITY_CLASSIFICATIONS.INTENTIONALLY_UNMAPPED
      ].includes(classification) && !hasAuthorityEscalation(input.attemptedTarget),
      fixtureScenarioId: normalizeString(input.fixtureScenarioId, UNKNOWN_VALUE)
    },
    provenance: {
      source: SOURCE,
      authoritativeSources: [
        'Approved Project State v9.0',
        'docs/phase-18.1A-runtime-signal-canonical-boundary-audit.md',
        'docs/phase-18.1B-runtime-to-canonical-signal-compatibility-specification.md',
        'docs/phase-18.1C-runtime-to-canonical-signal-adapter-contract.md',
        'validation/fixtures/runtimeCanonicalSignalCompatibilityFixtures.json'
      ],
      runtimeSource: clone(input.runtimeSource || UNKNOWN_VALUE),
      callerProvenance: clone(input.provenance || {})
    },
    expectedReasonCodes: sortStrings(input.expectedReasonCodes || input.expectedCompatibility?.reasonCodes || []),
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
  const withSummary = {
    ...core,
    summary: summarizeRuntimeSignalCompatibility(core)
  };
  const prevalidated = {
    ...withSummary,
    compatibilityFingerprint: buildRuntimeSignalCompatibilityFingerprint(withSummary)
  };
  const withInputValidation = {
    ...prevalidated,
    inputValidation
  };
  const withValidation = {
    ...withInputValidation,
    validation: validateRuntimeSignalCompatibilityOutput(withInputValidation)
  };
  const finalRecord = {
    ...withValidation,
    compatibilityFingerprint: buildRuntimeSignalCompatibilityFingerprint(withValidation)
  };
  return deepFreeze({
    ...finalRecord,
    validation: validateRuntimeSignalCompatibilityOutput(finalRecord)
  });
}

function adaptRuntimeSignalsToCanonicalBatch(records = [], options = {}) {
  const preparedRecords = asArray(records)
    .map((record) => clone(record))
    .sort((left, right) => {
      const leftKey = `${normalizeString(left.runtimeSignalId || left.runtimeSignalContract?.signalId)}|${normalizeString(left.fixtureScenarioId)}|${fingerprint(left)}`;
      const rightKey = `${normalizeString(right.runtimeSignalId || right.runtimeSignalContract?.signalId)}|${normalizeString(right.fixtureScenarioId)}|${fingerprint(right)}`;
      return leftKey.localeCompare(rightKey);
    });
  const adapted = preparedRecords.map((record, index) => adaptRuntimeSignalToCanonical({
    ...asObject(record),
    adapterRunId: record.adapterRunId || `${normalizeString(options.adapterRunId, 'runtime-canonical-batch')}:record-${index + 1}`
  }, options));
  const sortedRecords = adapted
    .map((record) => clone(record))
    .sort((left, right) => `${left.runtimeSignalId}|${left.adapterRunId}`.localeCompare(`${right.runtimeSignalId}|${right.adapterRunId}`));
  const core = {
    schemaVersion: SCHEMA_VERSION,
    source: SOURCE,
    version: VERSION,
    adapterRunId: normalizeString(options.adapterRunId || 'runtime-canonical-batch'),
    createdAt: normalizeDate(options.createdAt || UNKNOWN_VALUE),
    records: sortedRecords,
    summary: summarizeRuntimeSignalCompatibility({ records: sortedRecords }),
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
  return deepFreeze({
    ...core,
    batchFingerprint: buildRuntimeSignalCompatibilityFingerprint(core)
  });
}

module.exports = {
  SOURCE,
  VERSION,
  SCHEMA_VERSION,
  COMPATIBILITY_CLASSIFICATIONS,
  adaptRuntimeSignalToCanonical,
  adaptRuntimeSignalsToCanonicalBatch,
  validateRuntimeSignalCompatibilityInput,
  validateRuntimeSignalCompatibilityOutput,
  summarizeRuntimeSignalCompatibility,
  buildRuntimeSignalCompatibilityFingerprint
};
