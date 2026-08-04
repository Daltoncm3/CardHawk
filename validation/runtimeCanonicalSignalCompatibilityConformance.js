'use strict';

const {
  asArray,
  asObject,
  fingerprint,
  unique
} = require('./canonicalValidationCore');
const adapter = require('./runtimeCanonicalSignalCompatibilityAdapter');
const approvedFixtures = require('./fixtures/runtimeCanonicalSignalCompatibilityFixtures.json');

const SOURCE = 'runtime_canonical_signal_compatibility_conformance';
const VERSION = '1.0.0';
const SCHEMA_VERSION = '1.0.0';

const CONFORMANCE_STAGES = Object.freeze([
  'input_validation',
  'adapter_execution',
  'native_input_preservation',
  'field_mapping',
  'vocabulary_mapping',
  'warning_preservation',
  'readiness_preservation',
  'confidence_preservation',
  'unknown_value_preservation',
  'null_preservation',
  'provenance_preservation',
  'schema_version_validation',
  'authority_preservation',
  'deterministic_replay',
  'fingerprint_integrity',
  'batch_consistency',
  'output_validation',
  'final_classification'
]);

const CONFORMANCE_STATUSES = Object.freeze([
  'conformant',
  'conformant_with_warnings',
  'partially_conformant',
  'non_conformant',
  'invalid_input',
  'adapter_failure',
  'insufficient_evidence'
]);

const COMPARED_FIELDS = Object.freeze([
  'source identity',
  'source version',
  'signal name',
  'signal type',
  'decision role',
  'polarity',
  'score',
  'confidence',
  'confidence level',
  'status',
  'severity',
  'explanation',
  'evidence basis',
  'evidence counts',
  'minimum-evidence state',
  'warnings',
  'warning codes',
  'readiness',
  'eligibility',
  'eligibility reason',
  'failure reason',
  'display label',
  'display annotation',
  'registry identity',
  'schema version',
  'migration metadata',
  'provenance',
  'authority metadata',
  'unmapped fields',
  'incompatible fields',
  'transformations applied'
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

function normalizeString(value, fallback = 'unknown') {
  if (!known(value)) return fallback;
  return String(value).trim() || fallback;
}

function normalizeDate(value, fallback = 'unknown') {
  if (!known(value)) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function sortedStrings(values = []) {
  return unique(asArray(values).map((value) => normalizeString(value, '')).filter(Boolean)).sort();
}

function validationIssue(code, message, field = '') {
  return { code, message, field };
}

function buildRuntimeCanonicalSignalCompatibilityConformanceFingerprint(record = {}) {
  const projection = clone(record);
  delete projection.conformanceFingerprint;
  delete projection.reportFingerprint;
  delete projection.validation;
  return fingerprint(projection);
}

function fixtureInput(scenario = {}) {
  return {
    ...clone(scenario.runtimeInput || {}),
    fixtureScenarioId: scenario.id,
    expectedMappingClassification: scenario.classification,
    expectedCompatibility: clone(scenario.expectedCompatibility || {}),
    expectedReasonCodes: clone(scenario.expectedCompatibility?.reasonCodes || []),
    createdAt: '2026-08-04T12:00:00.000Z',
    provenance: {
      fixtureId: scenario.id,
      fixtureSource: approvedFixtures.source
    }
  };
}

function defaultFixtureInputs() {
  return approvedFixtures.scenarios.map(fixtureInput);
}

function makeStage(stage, input = {}) {
  const warnings = asArray(input.warnings).map((warning) => (
    typeof warning === 'string' ? validationIssue(warning, warning, stage) : warning
  ));
  const errors = asArray(input.errors).map((error) => (
    typeof error === 'string' ? validationIssue(error, error, stage) : error
  ));
  const blocking = Boolean(input.blocking || errors.length > 0);
  const status = input.status || (blocking ? 'failed' : warnings.length ? 'warning' : 'passed');
  return {
    stage,
    status,
    passed: input.passed === undefined ? !blocking : Boolean(input.passed),
    reasonCodes: sortedStrings(input.reasonCodes || [
      ...warnings.map((warning) => warning.code),
      ...errors.map((error) => error.code)
    ]),
    warnings,
    errors,
    evidence: clone(input.evidence || {}),
    affectedFields: sortedStrings(input.affectedFields),
    severity: input.severity || (blocking ? 'blocking' : warnings.length ? 'warning' : 'info'),
    blocking
  };
}

function warningValues(record = {}) {
  return asArray(record.warningPreservation?.warnings).map((warning) => clone(warning.value));
}

function containsUnknown(value) {
  return value === 'unknown' || JSON.stringify(value).includes('"unknown"');
}

function compareValue(field, nativeValue, canonicalValue, options = {}) {
  const expected = options.expected !== false;
  const differenceType = JSON.stringify(nativeValue) === JSON.stringify(canonicalValue)
    ? 'same'
    : options.differenceType || 'represented';
  return {
    field,
    nativeValue: clone(nativeValue),
    canonicalValue: clone(canonicalValue),
    compatibilityClassification: normalizeString(options.compatibilityClassification),
    differenceType,
    expected,
    informationLoss: Boolean(options.informationLoss),
    warningImpact: options.warningImpact || 'none',
    readinessImpact: options.readinessImpact || 'none',
    confidenceImpact: options.confidenceImpact || 'none',
    authorityImpact: options.authorityImpact || 'none',
    blocking: Boolean(options.blocking),
    reasonCode: normalizeString(options.reasonCode || (differenceType === 'same' ? 'values_match' : 'expected_representation'))
  };
}

function compareRuntimeAndCanonicalSignal(nativeInput = {}, adaptedOutput = {}) {
  const input = asObject(nativeInput);
  const output = asObject(adaptedOutput);
  const contract = asObject(input.runtimeSignalContract);
  const raw = input.runtimeRawValue;
  const canonical = asObject(output.canonicalSignal);
  const normalized = asObject(canonical.normalizedOutput);
  const classification = normalizeString(output.mappingClassification);
  const nativeScore = typeof raw === 'number' ? raw : raw?.score;
  const canonicalConfidenceValue = canonical.confidence?.value;
  const differences = [];

  differences.push(compareValue('source identity', contract.owner, canonical.producer?.name || output.provenance?.runtimeSource, { compatibilityClassification: classification, reasonCode: 'source_identity_preserved' }));
  differences.push(compareValue('source version', contract.schemaVersion, output.schemaVersionHandling?.runtimeSchemaVersion, { compatibilityClassification: 'DERIVED', reasonCode: 'source_version_preserved' }));
  differences.push(compareValue('signal name', input.runtimeSignalId || contract.signalId, canonical.signalName || output.runtimeSignalId, { compatibilityClassification: classification, reasonCode: 'signal_identity_preserved' }));
  differences.push(compareValue('signal type', contract.signalType, canonical.signalType || normalized.runtimeSignalType, { compatibilityClassification: classification, differenceType: 'translated', reasonCode: 'signal_type_mapped' }));
  differences.push(compareValue('decision role', contract.decisionEligibility, canonical.decisionRole, { compatibilityClassification: classification, differenceType: 'translated', reasonCode: 'decision_role_non_authoritative' }));
  differences.push(compareValue('polarity', raw?.polarity, normalized.polarity || 'unknown', { compatibilityClassification: 'CONDITIONAL', reasonCode: 'polarity_preserved_or_unknown' }));
  differences.push(compareValue('score', nativeScore, canonicalConfidenceValue === nativeScore ? canonicalConfidenceValue : normalized.rawValue?.score, { compatibilityClassification: 'CONDITIONAL', reasonCode: 'score_preserved_when_present' }));
  differences.push(compareValue('confidence', raw?.confidence ?? raw?.confidenceScore ?? raw?.marketConfidence ?? (typeof raw === 'number' ? raw : undefined), output.confidencePreservation?.value, { compatibilityClassification: 'CONDITIONAL', reasonCode: 'confidence_preserved' }));
  differences.push(compareValue('confidence level', raw?.confidenceLevel, canonical.confidenceLevel || 'unknown', { compatibilityClassification: 'DERIVED', reasonCode: 'confidence_level_unknown_unless_derived' }));
  differences.push(compareValue('status', raw?.status || raw?.readinessStatus, normalized.nativeStatus || raw?.status || raw?.readinessStatus || 'unknown', { compatibilityClassification: 'CONDITIONAL', reasonCode: 'native_status_preserved' }));
  differences.push(compareValue('severity', raw?.severity, asArray(output.warningPreservation?.warnings)[0]?.severity || 'unknown', { compatibilityClassification: 'CONDITIONAL', reasonCode: 'severity_preserved_when_present' }));
  differences.push(compareValue('explanation', raw?.summary || raw?.explanation, normalized.summary || raw?.summary || raw?.explanation || 'unknown', { compatibilityClassification: 'CONDITIONAL', reasonCode: 'explanation_preserved_when_present' }));
  differences.push(compareValue('evidence basis', raw?.trueSoldCompCount ?? raw?.trueSoldEvidenceCount, canonical.evidenceBasis?.trueSoldCount || 'unknown', { compatibilityClassification: 'CONDITIONAL', reasonCode: 'evidence_basis_preserved_when_verified' }));
  differences.push(compareValue('evidence counts', raw?.trueSoldCompCount ?? raw?.trueSoldEvidenceCount ?? raw?.eligibleEvidenceSummary?.trueSoldEvidenceCount, canonical.evidenceBasis?.trueSoldCount || 'unknown', { compatibilityClassification: 'CONDITIONAL', reasonCode: 'evidence_count_preserved_when_verified' }));
  differences.push(compareValue('minimum-evidence state', raw?.minimumRequired ?? raw?.eligibleEvidenceSummary?.minimumTrueSoldRequired, normalized.minimumEvidenceState || 'unknown', { compatibilityClassification: 'CONDITIONAL', reasonCode: 'minimum_evidence_preserved_or_unknown' }));
  differences.push(compareValue('warnings', warningValues(output), canonical.warnings || [], { compatibilityClassification: 'DERIVED', reasonCode: 'warnings_preserved' }));
  differences.push(compareValue('warning codes', output.warningPreservation?.unknownWarningCodes || [], output.warningPreservation?.unknownWarningCodes || [], { compatibilityClassification: 'DERIVED', reasonCode: 'warning_codes_preserved' }));
  differences.push(compareValue('readiness', raw?.evidenceReadiness || raw?.overallReadiness || raw?.readinessStatus || raw?.readinessLevel, output.readinessPreservation?.value, { compatibilityClassification: 'ONE_WAY_ONLY', reasonCode: 'readiness_preserved_contextual_only' }));
  differences.push(compareValue('eligibility', contract.decisionEligibility, canonical.decisionRole || 'withheld', { compatibilityClassification: 'CONDITIONAL', differenceType: 'translated', reasonCode: 'eligibility_non_authoritative' }));
  differences.push(compareValue('eligibility reason', raw?.eligibilityReason, normalized.eligibilityReason || 'unknown', { compatibilityClassification: 'CONDITIONAL', reasonCode: 'eligibility_reason_preserved_or_unknown' }));
  differences.push(compareValue('failure reason', raw?.failureReason || raw?.reasons || raw?.rejectionReasons, normalized.failureReason || raw?.failureReason || raw?.reasons || raw?.rejectionReasons || 'unknown', { compatibilityClassification: 'CONDITIONAL', reasonCode: 'failure_reason_preserved_when_present' }));
  differences.push(compareValue('display label', input.runtimeDisplayFields?.label || contract.allowedDisplayLanguage, normalized.displayLabel || contract.allowedDisplayLanguage || 'unknown', { compatibilityClassification: 'INTENTIONALLY_UNMAPPED', reasonCode: 'display_label_metadata_only' }));
  differences.push(compareValue('display annotation', input.runtimeAnnotation, normalized.displayAnnotation || 'unknown', { compatibilityClassification: 'ONE_WAY_ONLY', reasonCode: 'display_annotation_preserved_when_supplied' }));
  differences.push(compareValue('registry identity', input.canonicalRegistryReference?.registryId, output.registryId || 'unknown', { compatibilityClassification: 'INTENTIONALLY_UNMAPPED', reasonCode: 'registry_identity_not_invented' }));
  differences.push(compareValue('schema version', contract.schemaVersion, output.schemaVersionHandling?.runtimeSchemaVersion, { compatibilityClassification: 'INCOMPATIBLE', reasonCode: 'schema_identity_preserved_distinct' }));
  differences.push(compareValue('migration metadata', input.migrationMetadata, output.mappingResult?.fixtureScenarioId || 'unknown', { compatibilityClassification: 'INTENTIONALLY_UNMAPPED', reasonCode: 'migration_metadata_not_invented' }));
  differences.push(compareValue('provenance', input.provenance, output.provenance?.callerProvenance, { compatibilityClassification: 'DERIVED', reasonCode: 'provenance_preserved' }));
  differences.push(compareValue('authority metadata', 'none', output.authorityPreservation?.productionImpact, { compatibilityClassification: 'DIRECT', reasonCode: 'authority_none_preserved', authorityImpact: 'none' }));
  differences.push(compareValue('unmapped fields', output.unmappedFields, output.unmappedFields, { compatibilityClassification: 'INTENTIONALLY_UNMAPPED', reasonCode: 'unmapped_fields_visible' }));
  differences.push(compareValue('incompatible fields', output.incompatibleFields, output.incompatibleFields, { compatibilityClassification: 'INCOMPATIBLE', reasonCode: 'incompatible_fields_visible' }));
  differences.push(compareValue('transformations applied', output.transformationHistory?.map((item) => item.sourceField), output.transformationHistory?.map((item) => item.resultingField), { compatibilityClassification: 'DERIVED', differenceType: 'documented_transformation', reasonCode: 'transformation_history_recorded' }));

  const materialDifferences = differences.filter((difference) => difference.differenceType !== 'same');
  const blockingDifferences = differences.filter((difference) => difference.blocking);
  return deepFreeze({
    schemaVersion: SCHEMA_VERSION,
    source: SOURCE,
    comparedFields: [...COMPARED_FIELDS],
    differences,
    differenceCount: materialDifferences.length,
    blockingDifferenceCount: blockingDifferences.length,
    materialDifferences,
    blockingDifferences,
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none',
    comparisonFingerprint: fingerprint({
      differences,
      runtimeSignalId: output.runtimeSignalId,
      compatibilityFingerprint: output.compatibilityFingerprint
    })
  });
}

function buildRecordStages(input = {}, output = {}, comparison = {}, replay = {}, adapterError = null) {
  const inputValidation = output.inputValidation || adapter.validateRuntimeSignalCompatibilityInput(input);
  const outputValidation = output.validation || adapter.validateRuntimeSignalCompatibilityOutput(output);
  const sourceInputPreserved = JSON.stringify(output.runtimeInput) === JSON.stringify(input);
  const warningDropped = output.warningPreservation?.status !== 'preserved';
  const readinessUpgraded = output.readinessPreservation?.upgraded === true ||
    output.readinessPreservation?.dealGateApprovalCreated === true ||
    output.readinessPreservation?.purchaseAuthorityCreated === true;
  const confidenceInvented = output.confidencePreservation?.status === 'missing' &&
    output.confidencePreservation?.value !== 'unknown';
  const authority = asObject(output.authorityPreservation);
  const authorityEscalated = output.productionImpact !== 'none' ||
    output.decisionImpact !== 'none' ||
    output.executionAuthority !== 'none' ||
    authority.productionImpact !== 'none' ||
    authority.decisionImpact !== 'none' ||
    authority.executionAuthority !== 'none' ||
    authority.notDealGateEligible !== true ||
    authority.notBuyNowEligible !== true ||
    authority.notNotificationEligible !== true;
  const deterministicReplayPassed = JSON.stringify(output) === JSON.stringify(replay);
  const fingerprintPassed = output.compatibilityFingerprint === adapter.buildRuntimeSignalCompatibilityFingerprint(output);

  return CONFORMANCE_STAGES.map((stage) => {
    switch (stage) {
      case 'input_validation':
        return makeStage(stage, {
          passed: inputValidation.valid,
          blocking: !inputValidation.valid && input.expectedCompatibility?.mustReject !== true,
          reasonCodes: inputValidation.reasonCodes,
          warnings: inputValidation.warnings,
          errors: inputValidation.valid || input.expectedCompatibility?.mustReject === true ? [] : inputValidation.errors,
          affectedFields: inputValidation.invalidFields,
          evidence: { valid: inputValidation.valid, expectedReject: input.expectedCompatibility?.mustReject === true }
        });
      case 'adapter_execution':
        return makeStage(stage, {
          passed: !adapterError,
          blocking: Boolean(adapterError),
          errors: adapterError ? [validationIssue('adapter_execution_failed', adapterError.message, 'adapter')] : [],
          evidence: { transformationOutcome: output.transformationOutcome }
        });
      case 'native_input_preservation':
        return makeStage(stage, {
          passed: sourceInputPreserved && output.nativeOutputPreserved === true,
          blocking: !(sourceInputPreserved && output.nativeOutputPreserved === true),
          reasonCodes: sourceInputPreserved ? ['native_input_preserved'] : ['native_input_mutated'],
          affectedFields: sourceInputPreserved ? [] : ['runtimeInput'],
          evidence: { sourceInputPreserved, nativeOutputPreserved: output.nativeOutputPreserved }
        });
      case 'field_mapping':
        return makeStage(stage, {
          passed: comparison.blockingDifferenceCount === 0,
          blocking: comparison.blockingDifferenceCount > 0,
          reasonCodes: comparison.materialDifferences.map((difference) => difference.reasonCode),
          affectedFields: comparison.materialDifferences.map((difference) => difference.field),
          evidence: { differenceCount: comparison.differenceCount }
        });
      case 'vocabulary_mapping':
        return makeStage(stage, {
          passed: output.mappingClassification !== 'unknown',
          reasonCodes: [`classification_${String(output.mappingClassification || 'unknown').toLowerCase()}`],
          evidence: { mappingClassification: output.mappingClassification, transformationOutcome: output.transformationOutcome }
        });
      case 'warning_preservation':
        return makeStage(stage, {
          passed: !warningDropped,
          blocking: warningDropped,
          reasonCodes: warningDropped ? ['warning_dropped'] : ['warnings_preserved'],
          affectedFields: warningDropped ? ['warningPreservation'] : [],
          evidence: output.warningPreservation
        });
      case 'readiness_preservation':
        return makeStage(stage, {
          passed: !readinessUpgraded,
          blocking: readinessUpgraded,
          reasonCodes: readinessUpgraded ? ['readiness_upgraded'] : ['readiness_not_upgraded'],
          affectedFields: readinessUpgraded ? ['readinessPreservation'] : [],
          evidence: output.readinessPreservation
        });
      case 'confidence_preservation':
        return makeStage(stage, {
          passed: !confidenceInvented && output.confidencePreservation?.recommendationAuthorityCreated !== true,
          blocking: confidenceInvented || output.confidencePreservation?.recommendationAuthorityCreated === true,
          reasonCodes: confidenceInvented ? ['confidence_invented'] : ['confidence_preserved_or_unknown'],
          affectedFields: confidenceInvented ? ['confidencePreservation'] : [],
          evidence: output.confidencePreservation
        });
      case 'unknown_value_preservation':
        return makeStage(stage, {
          passed: output.unknownFieldHandling?.missingValuesRemainUnknown === true,
          blocking: output.unknownFieldHandling?.missingValuesRemainUnknown !== true,
          reasonCodes: containsUnknown(input) || containsUnknown(output) ? ['unknown_values_preserved'] : ['no_unknown_values_present'],
          evidence: output.unknownFieldHandling
        });
      case 'null_preservation':
        return makeStage(stage, {
          passed: output.nullHandling?.nullConvertedToPositiveEvidence === false && output.nullHandling?.nullConvertedToZeroConfidence === false,
          blocking: output.nullHandling?.nullConvertedToPositiveEvidence === true || output.nullHandling?.nullConvertedToZeroConfidence === true,
          reasonCodes: output.nullHandling?.rawNullPreserved ? ['null_preserved'] : ['no_null_source_value'],
          evidence: output.nullHandling
        });
      case 'provenance_preservation':
        return makeStage(stage, {
          passed: output.provenance?.callerProvenance !== undefined,
          reasonCodes: ['provenance_preserved'],
          evidence: output.provenance
        });
      case 'schema_version_validation':
        return makeStage(stage, {
          passed: output.schemaVersionHandling?.equivalentSchemas === false,
          warnings: output.schemaVersionHandling?.status === 'supported' ? [] : [validationIssue(`${output.schemaVersionHandling?.status}_source_version`, 'Source version requires review.', 'schemaVersionHandling')],
          reasonCodes: ['schema_versions_distinct'],
          evidence: output.schemaVersionHandling
        });
      case 'authority_preservation':
        return makeStage(stage, {
          passed: !authorityEscalated,
          blocking: authorityEscalated,
          reasonCodes: authorityEscalated ? ['authority_escalation_detected'] : ['authority_preserved'],
          affectedFields: authorityEscalated ? ['authorityPreservation'] : [],
          evidence: output.authorityPreservation
        });
      case 'deterministic_replay':
        return makeStage(stage, {
          passed: deterministicReplayPassed,
          blocking: !deterministicReplayPassed,
          reasonCodes: deterministicReplayPassed ? ['deterministic_replay_passed'] : ['nondeterministic_output'],
          evidence: {
            initialFingerprint: output.compatibilityFingerprint,
            replayFingerprint: replay.compatibilityFingerprint
          }
        });
      case 'fingerprint_integrity':
        return makeStage(stage, {
          passed: fingerprintPassed,
          blocking: !fingerprintPassed,
          reasonCodes: fingerprintPassed ? ['fingerprint_integrity_passed'] : ['invalid_fingerprint'],
          evidence: { compatibilityFingerprint: output.compatibilityFingerprint }
        });
      case 'batch_consistency':
        return makeStage(stage, {
          passed: true,
          reasonCodes: ['record_is_batch_eligible'],
          evidence: { runtimeSignalId: output.runtimeSignalId }
        });
      case 'output_validation':
        return makeStage(stage, {
          passed: outputValidation.valid,
          blocking: !outputValidation.valid && input.expectedCompatibility?.mustReject !== true,
          warnings: outputValidation.warnings,
          errors: outputValidation.valid || input.expectedCompatibility?.mustReject === true ? [] : outputValidation.errors,
          reasonCodes: outputValidation.reasonCodes,
          affectedFields: outputValidation.invalidFields,
          evidence: { valid: outputValidation.valid, expectedReject: input.expectedCompatibility?.mustReject === true }
        });
      case 'final_classification':
      default:
        return makeStage(stage, {
          passed: true,
          warnings: ['final_status_computed'],
          reasonCodes: ['final_status_computed'],
          evidence: { mappingClassification: output.mappingClassification }
        });
    }
  });
}

function determineRecordStatus(input = {}, output = {}, stages = []) {
  if (input.insufficientSourceMaterial === true) return 'insufficient_evidence';
  if (output.adapterFailure) return 'adapter_failure';
  if (output.transformationOutcome === 'invalid_input') return 'invalid_input';
  if (stages.some((stage) => stage.blocking)) return 'non_conformant';
  if (output.transformationOutcome === 'withheld' || output.transformationOutcome === 'partially_adapted') return 'conformant_with_warnings';
  if (output.transformationOutcome === 'rejected' && input.expectedCompatibility?.mustReject === true) return 'conformant_with_warnings';
  if (output.transformationOutcome === 'rejected') return 'non_conformant';
  if (stages.some((stage) => asArray(stage.warnings).length > 0)) return 'conformant_with_warnings';
  return 'conformant';
}

function buildConformanceRecord(input = {}, options = {}) {
  if (input.insufficientSourceMaterial === true) {
    const output = {
      schemaVersion: adapter.SCHEMA_VERSION,
      source: adapter.SOURCE,
      runtimeSignalId: normalizeString(input.runtimeSignalId || input.signalFamily),
      transformationOutcome: 'withheld',
      mappingClassification: 'INTENTIONALLY_UNMAPPED',
      warningPreservation: { status: 'preserved', count: 0, warnings: [] },
      nativeInputPreservation: { preserved: true },
      nativeOutputPreserved: true,
      readinessPreservation: { status: 'missing', value: 'unknown', upgraded: false },
      confidencePreservation: { status: 'missing', value: 'unknown', recommendationAuthorityCreated: false },
      authorityPreservation: {
        productionImpact: 'none',
        decisionImpact: 'none',
        executionAuthority: 'none',
        notDealGateEligible: true,
        notBuyNowEligible: true,
        notNotificationEligible: true
      },
      productionImpact: 'none',
      decisionImpact: 'none',
      executionAuthority: 'none',
      compatibilityFingerprint: fingerprint(input)
    };
    const stages = CONFORMANCE_STAGES.map((stage) => makeStage(stage, {
      passed: stage !== 'final_classification',
      warnings: stage === 'input_validation' ? [validationIssue('insufficient_source_material', 'Representative source material was not available.', 'input')] : [],
      reasonCodes: ['insufficient_source_material'],
      evidence: { signalFamily: input.signalFamily || input.runtimeSignalId || 'unknown' }
    }));
    const core = {
      schemaVersion: SCHEMA_VERSION,
      source: SOURCE,
      version: VERSION,
      conformanceRecordId: normalizeString(input.conformanceRecordId || `conformance:${output.runtimeSignalId}`),
      runtimeSignalId: output.runtimeSignalId,
      status: 'insufficient_evidence',
      stages,
      adaptedOutput: output,
      comparison: compareRuntimeAndCanonicalSignal(input, output),
      productionImpact: 'none',
      decisionImpact: 'none',
      executionAuthority: 'none'
    };
    return deepFreeze({
      ...core,
      conformanceFingerprint: buildRuntimeCanonicalSignalCompatibilityConformanceFingerprint(core)
    });
  }

  const adapterModule = options.adapter || adapter;
  let adaptedOutput;
  let adapterError = null;
  try {
    adaptedOutput = adapterModule.adaptRuntimeSignalToCanonical(input, options.adapterOptions || {});
  } catch (error) {
    adapterError = error;
    adaptedOutput = {
      schemaVersion: adapter.SCHEMA_VERSION,
      source: adapter.SOURCE,
      runtimeSignalId: normalizeString(input.runtimeSignalId || input.runtimeSignalContract?.signalId),
      transformationOutcome: 'invalid_input',
      mappingClassification: 'INCOMPATIBLE',
      adapterFailure: true,
      error: error.message,
      warningPreservation: { status: 'preserved', count: 0, warnings: [] },
      readinessPreservation: { status: 'missing', value: 'unknown', upgraded: false },
      confidencePreservation: { status: 'missing', value: 'unknown', recommendationAuthorityCreated: false },
      authorityPreservation: {
        productionImpact: 'none',
        decisionImpact: 'none',
        executionAuthority: 'none',
        notDealGateEligible: true,
        notBuyNowEligible: true,
        notNotificationEligible: true
      },
      productionImpact: 'none',
      decisionImpact: 'none',
      executionAuthority: 'none',
      compatibilityFingerprint: fingerprint({ input, error: error.message })
    };
  }
  const replay = adapterError ? adaptedOutput : adapterModule.adaptRuntimeSignalToCanonical(input, options.adapterOptions || {});
  const comparison = compareRuntimeAndCanonicalSignal(input, adaptedOutput);
  const stages = buildRecordStages(input, adaptedOutput, comparison, replay, adapterError);
  const status = adapterError ? 'adapter_failure' : determineRecordStatus(input, adaptedOutput, stages);
  const core = {
    schemaVersion: SCHEMA_VERSION,
    source: SOURCE,
    version: VERSION,
    conformanceRecordId: normalizeString(input.conformanceRecordId || `${SOURCE}:${adaptedOutput.runtimeSignalId}:${adaptedOutput.compatibilityFingerprint}`),
    runtimeSignalId: adaptedOutput.runtimeSignalId,
    status,
    stages,
    adaptedOutput,
    comparison,
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
  return deepFreeze({
    ...core,
    conformanceFingerprint: buildRuntimeCanonicalSignalCompatibilityConformanceFingerprint(core)
  });
}

function buildRuntimeCanonicalSignalCompatibilityReport(records = [], options = {}) {
  const conformanceRecords = asArray(records).map((record) => (
    record && record.source === SOURCE && record.conformanceFingerprint ? clone(record) : buildConformanceRecord(record, options)
  )).sort((left, right) => `${left.runtimeSignalId}|${left.conformanceRecordId}`.localeCompare(`${right.runtimeSignalId}|${right.conformanceRecordId}`));
  const summary = summarizeRuntimeCanonicalSignalCompatibilityConformance({ records: conformanceRecords });
  const core = {
    schemaVersion: SCHEMA_VERSION,
    source: SOURCE,
    version: VERSION,
    adapterVersion: adapter.VERSION,
    reportId: normalizeString(options.reportId || 'runtime-canonical-signal-compatibility-conformance-report'),
    createdAt: normalizeDate(options.createdAt || 'unknown'),
    executionStatus: summary.nonConformantCount > 0 || summary.adapterFailureCount > 0 ? 'completed_with_failures' : 'completed',
    totalRecords: conformanceRecords.length,
    conformantCount: summary.conformantCount,
    conformantWithWarningsCount: summary.conformantWithWarningsCount,
    partiallyConformantCount: summary.partiallyConformantCount,
    nonConformantCount: summary.nonConformantCount,
    invalidInputCount: summary.invalidInputCount,
    adapterFailureCount: summary.adapterFailureCount,
    insufficientEvidenceCount: summary.insufficientEvidenceCount,
    stageResults: summary.stageResults,
    perRecordResults: conformanceRecords,
    fieldDifferenceTotals: summary.fieldDifferenceTotals,
    compatibilityClassificationTotals: summary.compatibilityClassificationTotals,
    warningPreservationTotals: summary.warningPreservationTotals,
    readinessFindings: summary.readinessFindings,
    confidenceFindings: summary.confidenceFindings,
    authorityFindings: summary.authorityFindings,
    unknownValueFindings: summary.unknownValueFindings,
    deterministicReplayFindings: summary.deterministicReplayFindings,
    blockingFindings: summary.blockingFindings,
    adapterValidationReadiness: summary.adapterValidationReadiness,
    recommendedFollowUp: summary.recommendedFollowUp,
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
  return deepFreeze({
    ...core,
    reportFingerprint: buildRuntimeCanonicalSignalCompatibilityConformanceFingerprint(core)
  });
}

function determineReadiness(totals = {}) {
  if (totals.adapter_failure > 0 || totals.invalid_input > 0 || totals.non_conformant > 0) return 'remediation_required';
  if (totals.insufficient_evidence > 0 || totals.partially_conformant > 0) return 'ready_for_additional_offline_validation';
  if (totals.conformant_with_warnings > 0) return 'ready_for_additional_offline_validation';
  if (totals.conformant > 0) return 'ready_for_shadow_integration_planning';
  return 'not_ready';
}

function summarizeRuntimeCanonicalSignalCompatibilityConformance(input = {}) {
  const records = asArray(input.records || input.perRecordResults);
  const statusTotals = Object.fromEntries(CONFORMANCE_STATUSES.map((status) => [status, 0]));
  const stageResults = {};
  const fieldDifferenceTotals = {};
  const compatibilityClassificationTotals = {};
  const warningPreservationTotals = { preserved: 0, warningCount: 0, unknownWarningCodeCount: 0 };
  const readinessFindings = { preserved: 0, missing: 0, upgraded: 0 };
  const confidenceFindings = { preserved: 0, missing: 0, invented: 0 };
  const authorityFindings = { preserved: 0, violations: 0 };
  const unknownValueFindings = { preserved: 0 };
  const deterministicReplayFindings = { passed: 0, failed: 0 };
  const blockingFindings = [];

  for (const record of records) {
    const status = normalizeString(record.status);
    if (statusTotals[status] !== undefined) statusTotals[status] += 1;
    for (const stage of asArray(record.stages)) {
      stageResults[stage.stage] = stageResults[stage.stage] || { passed: 0, failed: 0, warnings: 0, blocking: 0 };
      if (stage.passed) stageResults[stage.stage].passed += 1;
      else stageResults[stage.stage].failed += 1;
      if (asArray(stage.warnings).length > 0) stageResults[stage.stage].warnings += 1;
      if (stage.blocking) {
        stageResults[stage.stage].blocking += 1;
        blockingFindings.push({ runtimeSignalId: record.runtimeSignalId, stage: stage.stage, reasonCodes: stage.reasonCodes });
      }
    }
    for (const difference of asArray(record.comparison?.differences)) {
      fieldDifferenceTotals[difference.field] = (fieldDifferenceTotals[difference.field] || 0) + (difference.differenceType === 'same' ? 0 : 1);
    }
    const classification = normalizeString(record.adaptedOutput?.mappingClassification);
    compatibilityClassificationTotals[classification] = (compatibilityClassificationTotals[classification] || 0) + 1;
    const warningPreservation = asObject(record.adaptedOutput?.warningPreservation);
    if (warningPreservation.status === 'preserved') warningPreservationTotals.preserved += 1;
    warningPreservationTotals.warningCount += Number(warningPreservation.count || 0);
    warningPreservationTotals.unknownWarningCodeCount += asArray(warningPreservation.unknownWarningCodes).length;
    const readiness = asObject(record.adaptedOutput?.readinessPreservation);
    if (readiness.status === 'preserved') readinessFindings.preserved += 1;
    if (readiness.status === 'missing') readinessFindings.missing += 1;
    if (readiness.upgraded === true) readinessFindings.upgraded += 1;
    const confidence = asObject(record.adaptedOutput?.confidencePreservation);
    if (confidence.status === 'preserved') confidenceFindings.preserved += 1;
    if (confidence.status === 'missing') confidenceFindings.missing += 1;
    if (confidence.recommendationAuthorityCreated === true) confidenceFindings.invented += 1;
    const authority = asObject(record.adaptedOutput?.authorityPreservation);
    const authorityPreserved = record.adaptedOutput?.productionImpact === 'none' &&
      record.adaptedOutput?.decisionImpact === 'none' &&
      record.adaptedOutput?.executionAuthority === 'none' &&
      authority.notDealGateEligible === true &&
      authority.notBuyNowEligible === true &&
      authority.notNotificationEligible === true;
    if (authorityPreserved) authorityFindings.preserved += 1;
    authorityFindings.violations += asArray(authority.authorityViolations).length;
    if (record.adaptedOutput?.unknownFieldHandling?.missingValuesRemainUnknown === true) unknownValueFindings.preserved += 1;
    const replayStage = asArray(record.stages).find((stage) => stage.stage === 'deterministic_replay');
    if (replayStage?.passed) deterministicReplayFindings.passed += 1;
    else deterministicReplayFindings.failed += 1;
  }

  const readiness = determineReadiness(statusTotals);
  return deepFreeze({
    schemaVersion: SCHEMA_VERSION,
    source: SOURCE,
    totalRecords: records.length,
    conformantCount: statusTotals.conformant,
    conformantWithWarningsCount: statusTotals.conformant_with_warnings,
    partiallyConformantCount: statusTotals.partially_conformant,
    nonConformantCount: statusTotals.non_conformant,
    invalidInputCount: statusTotals.invalid_input,
    adapterFailureCount: statusTotals.adapter_failure,
    insufficientEvidenceCount: statusTotals.insufficient_evidence,
    statusTotals,
    stageResults: Object.fromEntries(Object.entries(stageResults).sort(([left], [right]) => left.localeCompare(right))),
    fieldDifferenceTotals: Object.fromEntries(Object.entries(fieldDifferenceTotals).sort(([left], [right]) => left.localeCompare(right))),
    compatibilityClassificationTotals: Object.fromEntries(Object.entries(compatibilityClassificationTotals).sort(([left], [right]) => left.localeCompare(right))),
    warningPreservationTotals,
    readinessFindings,
    confidenceFindings,
    authorityFindings,
    unknownValueFindings,
    deterministicReplayFindings,
    blockingFindings,
    adapterValidationReadiness: readiness,
    recommendedFollowUp: readiness === 'ready_for_shadow_integration_planning'
      ? 'Eligible for shadow integration planning only; production integration remains prohibited.'
      : 'Continue offline validation and remediate blocking findings before shadow planning.',
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  });
}

function validateRuntimeCanonicalSignalCompatibilityConformance(report = {}) {
  const errors = [];
  const warnings = [];
  const invalidFields = [];
  const authorityViolations = [];
  const fingerprintViolations = [];
  const input = asObject(report);

  if (input.schemaVersion !== SCHEMA_VERSION) {
    errors.push(validationIssue('invalid_schema_version', 'Conformance schemaVersion is invalid.', 'schemaVersion'));
    invalidFields.push('schemaVersion');
  }
  if (input.source !== SOURCE) {
    errors.push(validationIssue('invalid_source', 'Conformance source is invalid.', 'source'));
    invalidFields.push('source');
  }
  if (['production_ready', 'production_approved', 'BUY_NOW_ready', 'Deal_Gate_ready'].includes(input.adapterValidationReadiness)) {
    errors.push(validationIssue('prohibited_readiness_state', 'Conformance readiness must never imply production authority.', 'adapterValidationReadiness'));
    invalidFields.push('adapterValidationReadiness');
    authorityViolations.push('adapterValidationReadiness');
  }
  for (const field of ['productionImpact', 'decisionImpact', 'executionAuthority']) {
    if (input[field] !== 'none') {
      errors.push(validationIssue('authority_boundary_violation', `${field} must remain none.`, field));
      invalidFields.push(field);
      authorityViolations.push(field);
    }
  }
  for (const [index, record] of asArray(input.perRecordResults || input.records).entries()) {
    if (!CONFORMANCE_STATUSES.includes(record.status)) {
      errors.push(validationIssue('invalid_conformance_status', 'Record status is not supported.', `perRecordResults.${index}.status`));
      invalidFields.push(`perRecordResults.${index}.status`);
    }
    const missingStages = CONFORMANCE_STAGES.filter((stage) => !asArray(record.stages).some((item) => item.stage === stage));
    if (missingStages.length > 0) {
      errors.push(validationIssue('missing_conformance_stage', 'Record is missing conformance stages.', `perRecordResults.${index}.stages`));
      invalidFields.push(`perRecordResults.${index}.stages`);
    }
    if (record.adaptedOutput?.authorityPreservation?.notBuyNowEligible !== true) {
      errors.push(validationIssue('buy_now_eligibility_granted', 'Conformance output must not grant BUY_NOW eligibility.', `perRecordResults.${index}.authorityPreservation`));
      authorityViolations.push(`perRecordResults.${index}.authorityPreservation.notBuyNowEligible`);
    }
    if (record.adaptedOutput?.authorityPreservation?.notDealGateEligible !== true) {
      errors.push(validationIssue('deal_gate_eligibility_granted', 'Conformance output must not grant Deal Gate eligibility.', `perRecordResults.${index}.authorityPreservation`));
      authorityViolations.push(`perRecordResults.${index}.authorityPreservation.notDealGateEligible`);
    }
    if (record.adaptedOutput?.authorityPreservation?.notNotificationEligible !== true) {
      errors.push(validationIssue('notification_eligibility_granted', 'Conformance output must not grant notification eligibility.', `perRecordResults.${index}.authorityPreservation`));
      authorityViolations.push(`perRecordResults.${index}.authorityPreservation.notNotificationEligible`);
    }
    if (record.adaptedOutput?.productionImpact !== 'none' || record.adaptedOutput?.decisionImpact !== 'none' || record.adaptedOutput?.executionAuthority !== 'none') {
      errors.push(validationIssue('authority_boundary_violation', 'Record output must preserve non-authoritative boundary fields.', `perRecordResults.${index}.adaptedOutput`));
      authorityViolations.push(`perRecordResults.${index}.adaptedOutput`);
    }
    if (record.adaptedOutput?.canonicalSignal?.governanceFlags?.productionApproved === true || record.adaptedOutput?.summary?.productionApproved === true) {
      errors.push(validationIssue('production_approved_label_rejected', 'Conformance output must not label a signal as production approved.', `perRecordResults.${index}.adaptedOutput`));
      authorityViolations.push(`perRecordResults.${index}.adaptedOutput.productionApproved`);
    }
    for (const [differenceIndex, difference] of asArray(record.comparison?.differences).entries()) {
      if (difference.informationLoss === true && difference.expected !== true) {
        errors.push(validationIssue('unexpected_information_loss', 'Unexpected information loss must block conformance.', `perRecordResults.${index}.comparison.differences.${differenceIndex}`));
        invalidFields.push(`perRecordResults.${index}.comparison.differences.${differenceIndex}`);
      }
    }
    if (record.conformanceFingerprint && buildRuntimeCanonicalSignalCompatibilityConformanceFingerprint(record) !== record.conformanceFingerprint) {
      errors.push(validationIssue('record_fingerprint_mismatch', 'conformanceFingerprint does not match record contents.', `perRecordResults.${index}.conformanceFingerprint`));
      invalidFields.push(`perRecordResults.${index}.conformanceFingerprint`);
      fingerprintViolations.push(`perRecordResults.${index}.conformanceFingerprint`);
    }
  }
  if (input.reportFingerprint && buildRuntimeCanonicalSignalCompatibilityConformanceFingerprint(input) !== input.reportFingerprint) {
    errors.push(validationIssue('report_fingerprint_mismatch', 'reportFingerprint does not match report contents.', 'reportFingerprint'));
    invalidFields.push('reportFingerprint');
    fingerprintViolations.push('reportFingerprint');
  }
  const reasonCodes = sortedStrings([...errors.map((error) => error.code), ...warnings.map((warning) => warning.code)]);
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes,
    invalidFields: sortedStrings(invalidFields),
    authorityViolations: sortedStrings(authorityViolations),
    fingerprintViolations: sortedStrings(fingerprintViolations)
  };
}

function runRuntimeCanonicalSignalCompatibilityConformance(records = defaultFixtureInputs(), options = {}) {
  const report = buildRuntimeCanonicalSignalCompatibilityReport(records, options);
  return deepFreeze({
    ...report,
    validation: validateRuntimeCanonicalSignalCompatibilityConformance(report)
  });
}

module.exports = {
  SOURCE,
  VERSION,
  SCHEMA_VERSION,
  CONFORMANCE_STAGES,
  CONFORMANCE_STATUSES,
  runRuntimeCanonicalSignalCompatibilityConformance,
  validateRuntimeCanonicalSignalCompatibilityConformance,
  buildRuntimeCanonicalSignalCompatibilityReport,
  compareRuntimeAndCanonicalSignal,
  summarizeRuntimeCanonicalSignalCompatibilityConformance,
  buildRuntimeCanonicalSignalCompatibilityConformanceFingerprint
};
