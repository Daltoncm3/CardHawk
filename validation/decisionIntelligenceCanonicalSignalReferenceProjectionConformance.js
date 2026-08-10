'use strict';

const {
  asArray,
  asObject,
  fingerprint,
  unique
} = require('./canonicalValidationCore');
const projection = require('./decisionIntelligenceCanonicalSignalReferenceProjection');

const SOURCE = 'decision_intelligence_canonical_signal_reference_projection_conformance';
const VERSION = '1.0.0';
const SCHEMA_VERSION = 'decision_intelligence_canonical_signal_reference_projection_conformance.v1';

const CONFORMANCE_STAGES = Object.freeze([
  'input_validation',
  'projection_execution',
  'identity_preservation',
  'provenance_preservation',
  'warning_preservation',
  'readiness_preservation',
  'confidence_preservation',
  'authority_preservation',
  'schema_preservation',
  'deterministic_replay',
  'immutable_output',
  'fingerprint_stability',
  'batch_consistency',
  'invalid_input_handling',
  'unsupported_projection_handling',
  'projection_validation',
  'final_classification'
]);

const CONFORMANCE_STATUSES = Object.freeze([
  'conformant',
  'conformant_with_warnings',
  'partially_conformant',
  'non_conformant',
  'invalid_input',
  'projection_failure',
  'unsupported_projection'
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

function sortedIssues(values = []) {
  return asArray(values)
    .map((issue) => (typeof issue === 'string' ? validationIssue(issue, issue) : clone(issue)))
    .sort((left, right) => `${normalizeString(left.code)}|${normalizeString(left.field)}|${normalizeString(left.message)}|${fingerprint(left)}`.localeCompare(`${normalizeString(right.code)}|${normalizeString(right.field)}|${normalizeString(right.message)}|${fingerprint(right)}`));
}

function validationIssue(code, message, field = '') {
  return { code, message, field };
}

function makeStage(stage, input = {}) {
  const warnings = sortedIssues(input.warnings);
  const errors = sortedIssues(input.errors);
  const blocking = input.blocking === undefined ? errors.length > 0 : Boolean(input.blocking);
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

function buildDecisionIntelligenceCanonicalSignalReferenceProjectionFingerprint(record = {}) {
  const candidate = clone(record);
  delete candidate.conformanceFingerprint;
  delete candidate.reportFingerprint;
  delete candidate.validation;
  return fingerprint(candidate);
}

function resolveCanonicalSignal(input = {}) {
  const source = asObject(input);
  if (source.canonicalSignal) return asObject(source.canonicalSignal);
  if (source.signal) return asObject(source.signal);
  if (source.sourceArtifact?.canonicalSignal) return asObject(source.sourceArtifact.canonicalSignal);
  if (source.signalId && source.signalFingerprint) return source;
  return {};
}

function sourceWarnings(source = {}, canonicalSignal = {}) {
  return [
    ...asArray(canonicalSignal.warnings),
    ...asArray(source.warnings),
    ...asArray(source.validation?.warnings),
    ...asArray(source.inputValidation?.warnings),
    ...asArray(source.warningPreservation?.warnings)
  ];
}

function containsSourceWarning(projectionResult = {}, warning) {
  const projected = asArray(projectionResult.warningPropagation?.warnings);
  return projected.some((candidate) => JSON.stringify(candidate) === JSON.stringify(warning));
}

function authorityFieldsAreNone(record = {}) {
  return AUTHORITY_FIELDS.every((field) => record[field] === 'none');
}

function compareCanonicalSignalProjection(sourceArtifact = {}, projectionResult = {}) {
  const source = asObject(sourceArtifact);
  const canonicalSignal = resolveCanonicalSignal(source);
  const signalRef = asArray(projectionResult.signalRefs)[0] || {};
  const sourceReference = asArray(projectionResult.sourceArtifactReferences)[0] || {};
  const warnings = sourceWarnings(source, canonicalSignal);
  const warningLoss = warnings.filter((warning) => !containsSourceWarning(projectionResult, warning));
  const readinessSource = source.readinessPreservation || source.readinessPropagation || {};
  const confidenceSource = source.confidencePreservation || {};
  const withheldWithSourceReference = projectionResult.projectionStatus === projection.PROJECTION_STATUSES.WITHHELD &&
    !signalRef.signalId &&
    sourceReference.signalFingerprint === canonicalSignal.signalFingerprint;
  const signalIdPreserved = signalRef.signalId === canonicalSignal.signalId || withheldWithSourceReference || !canonicalSignal.signalId;
  const signalFingerprintPreserved = signalRef.signalFingerprint === canonicalSignal.signalFingerprint ||
    sourceReference.signalFingerprint === canonicalSignal.signalFingerprint ||
    !canonicalSignal.signalFingerprint;
  const identityPreserved = projectionResult.provenance?.canonicalSignalFingerprint === canonicalSignal.signalFingerprint &&
    signalIdPreserved &&
    signalFingerprintPreserved &&
    sourceReference.signalFingerprint === canonicalSignal.signalFingerprint;
  const provenancePreserved = JSON.stringify(projectionResult.provenance?.sourceProvenance || {}) === JSON.stringify(source.provenance || {}) &&
    projectionResult.provenance?.sourceArtifactFingerprint === sourceReference.sourceFingerprint;
  const readinessPreserved = projectionResult.readinessPropagation?.sourceReadiness?.value === readinessSource.value ||
    projectionResult.readinessPropagation?.sourceReadiness?.status === readinessSource.status ||
    Object.keys(asObject(readinessSource)).length === 0;
  const confidencePreserved = projectionResult.confidencePropagation?.confidencePreserved === true &&
    projectionResult.confidencePropagation?.confidenceInvented === false &&
    projectionResult.confidencePropagation?.confidenceRecomputed === false &&
    (confidenceSource.value === undefined || projectionResult.confidencePropagation?.confidenceSources?.[0]?.sourceConfidencePreservation?.value === confidenceSource.value);
  const authorityPreserved = authorityFieldsAreNone(projectionResult) &&
    projectionResult.eligibilityPropagation?.dealGateEligible === false &&
    projectionResult.eligibilityPropagation?.buyNowEligible === false &&
    projectionResult.eligibilityPropagation?.notificationEligible === false &&
    projectionResult.authorityPreservation?.dealGateEligibilityCreated === false &&
    projectionResult.authorityPreservation?.buyNowEligibilityCreated === false;
  const schemaPreserved = sourceReference.schemaVersion === normalizeString(source.schemaVersion || canonicalSignal.schemaVersion);
  const fingerprintStable = projectionResult.projectionFingerprint === projection.buildCanonicalSignalReferenceProjectionFingerprint(projectionResult);
  const outputImmutable = Object.isFrozen(projectionResult) &&
    Object.isFrozen(projectionResult.signalRefs) &&
    Object.isFrozen(projectionResult.sourceArtifactReferences);

  const comparisons = [
    { field: 'signalId', sourceValue: canonicalSignal.signalId, projectedValue: signalRef.signalId || sourceReference.signalName, passed: signalIdPreserved, reasonCode: 'signal_id_preserved' },
    { field: 'signalFingerprint', sourceValue: canonicalSignal.signalFingerprint, projectedValue: signalRef.signalFingerprint || sourceReference.signalFingerprint, passed: signalRef.signalFingerprint === canonicalSignal.signalFingerprint || sourceReference.signalFingerprint === canonicalSignal.signalFingerprint, reasonCode: 'signal_fingerprint_preserved' },
    { field: 'sourceOutputFingerprint', sourceValue: source.sourceOutputFingerprint || canonicalSignal.sourceFingerprint, projectedValue: signalRef.sourceOutputFingerprint, passed: !signalRef.signalId || signalRef.sourceOutputFingerprint === normalizeString(source.sourceOutputFingerprint || canonicalSignal.sourceFingerprint), reasonCode: 'source_output_fingerprint_preserved' },
    { field: 'provenance', sourceValue: source.provenance, projectedValue: projectionResult.provenance?.sourceProvenance, passed: provenancePreserved, reasonCode: 'provenance_preserved' },
    { field: 'warnings', sourceValue: warnings, projectedValue: projectionResult.warningPropagation?.warnings, passed: warningLoss.length === 0, reasonCode: 'warnings_preserved' },
    { field: 'readiness', sourceValue: readinessSource, projectedValue: projectionResult.readinessPropagation?.sourceReadiness, passed: readinessPreserved, reasonCode: 'readiness_preserved' },
    { field: 'confidence', sourceValue: confidenceSource, projectedValue: projectionResult.confidencePropagation?.confidenceSources?.[0]?.sourceConfidencePreservation, passed: confidencePreserved, reasonCode: 'confidence_preserved' },
    { field: 'authority', sourceValue: 'none', projectedValue: projectionResult.authorityPreservation, passed: authorityPreserved, reasonCode: 'authority_preserved' },
    { field: 'schemaVersion', sourceValue: source.schemaVersion || canonicalSignal.schemaVersion, projectedValue: sourceReference.schemaVersion, passed: schemaPreserved, reasonCode: 'schema_version_preserved' },
    { field: 'projectionFingerprint', sourceValue: projectionResult.projectionFingerprint, projectedValue: projection.buildCanonicalSignalReferenceProjectionFingerprint(projectionResult), passed: fingerprintStable, reasonCode: 'projection_fingerprint_stable' },
    { field: 'immutability', sourceValue: 'frozen', projectedValue: outputImmutable ? 'frozen' : 'mutable', passed: outputImmutable, reasonCode: 'output_immutable' }
  ];
  const failed = comparisons.filter((item) => !item.passed);
  return deepFreeze({
    schemaVersion: SCHEMA_VERSION,
    source: SOURCE,
    comparedFields: comparisons.map((item) => item.field),
    comparisons,
    passed: failed.length === 0,
    failedComparisons: failed,
    warningLoss,
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none',
    comparisonFingerprint: fingerprint({ comparisons, projectionFingerprint: projectionResult.projectionFingerprint })
  });
}

function runSingleConformance(sourceArtifact = {}, options = {}) {
  const inputBefore = clone(sourceArtifact);
  let projectionResult;
  let replay;
  const stages = [];
  const canonicalSignal = resolveCanonicalSignal(sourceArtifact);
  const hasCanonicalSignal = Object.keys(canonicalSignal).length > 0;
  const sourceHasAuthority = AUTHORITY_FIELDS.some((field) => sourceArtifact[field] !== undefined && sourceArtifact[field] !== 'none');

  stages.push(makeStage('input_validation', {
    errors: hasCanonicalSignal ? [] : [validationIssue('missing_canonical_signal', 'Input does not contain a canonical Signal artifact.', 'canonicalSignal')],
    reasonCodes: hasCanonicalSignal ? ['input_contains_canonical_signal'] : ['missing_canonical_signal']
  }));

  try {
    projectionResult = projection.projectCanonicalSignalReference(sourceArtifact, options);
    stages.push(makeStage('projection_execution', {
      reasonCodes: ['projection_executed'],
      evidence: { projectionStatus: projectionResult.projectionStatus }
    }));
  } catch (error) {
    stages.push(makeStage('projection_execution', {
      errors: [validationIssue('projection_execution_failed', error.message, 'projection')],
      reasonCodes: ['projection_execution_failed']
    }));
    projectionResult = {};
  }

  const comparison = compareCanonicalSignalProjection(sourceArtifact, projectionResult);
  stages.push(makeStage('identity_preservation', {
    errors: comparison.comparisons.find((item) => item.field === 'signalId')?.passed && comparison.comparisons.find((item) => item.field === 'signalFingerprint')?.passed ? [] : ['identity_not_preserved'],
    reasonCodes: ['identity_preservation_checked']
  }));
  stages.push(makeStage('provenance_preservation', {
    errors: comparison.comparisons.find((item) => item.field === 'provenance')?.passed ? [] : ['provenance_not_preserved'],
    reasonCodes: ['provenance_preservation_checked']
  }));
  stages.push(makeStage('warning_preservation', {
    errors: comparison.warningLoss.length === 0 ? [] : ['warnings_not_preserved'],
    evidence: { sourceWarningCount: sourceWarnings(sourceArtifact, canonicalSignal).length, projectedWarningCount: asArray(projectionResult.warningPropagation?.warnings).length },
    reasonCodes: ['warning_preservation_checked']
  }));
  stages.push(makeStage('readiness_preservation', {
    errors: comparison.comparisons.find((item) => item.field === 'readiness')?.passed ? [] : ['readiness_not_preserved'],
    reasonCodes: ['readiness_preservation_checked']
  }));
  stages.push(makeStage('confidence_preservation', {
    errors: comparison.comparisons.find((item) => item.field === 'confidence')?.passed ? [] : ['confidence_not_preserved'],
    reasonCodes: ['confidence_preservation_checked']
  }));
  stages.push(makeStage('authority_preservation', {
    errors: comparison.comparisons.find((item) => item.field === 'authority')?.passed && !sourceHasAuthority ? [] : sourceHasAuthority ? ['source_authority_violation_detected'] : ['authority_not_preserved'],
    reasonCodes: sourceHasAuthority ? ['source_authority_violation_detected'] : ['authority_preservation_checked']
  }));
  stages.push(makeStage('schema_preservation', {
    errors: comparison.comparisons.find((item) => item.field === 'schemaVersion')?.passed ? [] : ['schema_version_not_preserved'],
    reasonCodes: ['schema_preservation_checked']
  }));

  try {
    replay = projection.projectCanonicalSignalReference(sourceArtifact, options);
  } catch (error) {
    replay = { replayError: error.message };
  }
  stages.push(makeStage('deterministic_replay', {
    errors: JSON.stringify(replay) === JSON.stringify(projectionResult) ? [] : ['deterministic_replay_failed'],
    reasonCodes: ['deterministic_replay_checked']
  }));
  stages.push(makeStage('immutable_output', {
    errors: comparison.comparisons.find((item) => item.field === 'immutability')?.passed ? [] : ['projection_output_mutable'],
    reasonCodes: ['immutability_checked']
  }));
  stages.push(makeStage('fingerprint_stability', {
    errors: comparison.comparisons.find((item) => item.field === 'projectionFingerprint')?.passed ? [] : ['projection_fingerprint_unstable'],
    reasonCodes: ['fingerprint_stability_checked']
  }));
  stages.push(makeStage('batch_consistency', {
    reasonCodes: ['batch_consistency_deferred_to_report'],
    evidence: { checkedAt: 'report' }
  }));
  stages.push(makeStage('invalid_input_handling', {
    errors: hasCanonicalSignal || projectionResult.projectionStatus === projection.PROJECTION_STATUSES.INVALID_INPUT ? [] : ['invalid_input_not_reported'],
    reasonCodes: hasCanonicalSignal ? ['valid_input_not_invalid'] : ['invalid_input_handling_checked']
  }));
  const unsupportedExpected = hasCanonicalSignal && !projection.PROJECTABLE_SIGNAL_TYPES.includes(normalizeString(canonicalSignal.signalType));
  stages.push(makeStage('unsupported_projection_handling', {
    errors: unsupportedExpected && projectionResult.projectionStatus !== projection.PROJECTION_STATUSES.WITHHELD ? ['unsupported_projection_not_withheld'] : [],
    reasonCodes: unsupportedExpected ? ['unsupported_projection_checked'] : ['projection_supported_or_invalid']
  }));
  stages.push(makeStage('projection_validation', {
    errors: projectionResult.validation?.valid === false && ![projection.PROJECTION_STATUSES.INVALID_INPUT].includes(projectionResult.projectionStatus) ? ['projection_validation_failed'] : [],
    warnings: asArray(projectionResult.validation?.warnings),
    reasonCodes: ['projection_validation_checked']
  }));

  const blockingStages = stages.filter((stage) => stage.blocking);
  let status = 'conformant';
  if (!hasCanonicalSignal) status = 'invalid_input';
  else if (sourceHasAuthority || blockingStages.length > 0) status = 'non_conformant';
  else if (projectionResult.projectionStatus === projection.PROJECTION_STATUSES.WITHHELD) status = 'unsupported_projection';
  else if (projectionResult.projectionStatus === projection.PROJECTION_STATUSES.PROJECTED_WITH_WARNINGS || asArray(projectionResult.warningPropagation?.warnings).length > 0) status = 'conformant_with_warnings';

  stages.push(makeStage('final_classification', {
    errors: status === 'non_conformant' ? ['non_conformant_projection'] : [],
    warnings: status === 'conformant_with_warnings' ? ['projection_conformant_with_warnings'] : [],
    reasonCodes: [status]
  }));

  const recordCore = {
    schemaVersion: SCHEMA_VERSION,
    source: SOURCE,
    version: VERSION,
    conformanceId: normalizeString(options.conformanceId || `${SOURCE}:${normalizeString(projectionResult.projectionId)}:${fingerprint(inputBefore)}`),
    createdAt: normalizeDate(options.createdAt || sourceArtifact.createdAt || 'unknown'),
    status,
    sourceArtifact: inputBefore,
    projectionResult: clone(projectionResult),
    comparison,
    stages,
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
  return deepFreeze({
    ...recordCore,
    conformanceFingerprint: buildDecisionIntelligenceCanonicalSignalReferenceProjectionFingerprint(recordCore)
  });
}

function summarizeDecisionIntelligenceCanonicalSignalReferenceProjectionConformance(report = {}) {
  const records = asArray(report.perRecordResults || report.records);
  const statusTotals = {};
  const stageResults = {};
  for (const status of CONFORMANCE_STATUSES) statusTotals[status] = 0;
  for (const stage of CONFORMANCE_STAGES) {
    stageResults[stage] = { passed: 0, failed: 0, warnings: 0, blocking: 0 };
  }
  for (const record of records) {
    statusTotals[record.status] = (statusTotals[record.status] || 0) + 1;
    for (const stage of asArray(record.stages)) {
      if (!stageResults[stage.stage]) stageResults[stage.stage] = { passed: 0, failed: 0, warnings: 0, blocking: 0 };
      if (stage.passed) stageResults[stage.stage].passed += 1;
      else stageResults[stage.stage].failed += 1;
      if (asArray(stage.warnings).length > 0) stageResults[stage.stage].warnings += 1;
      if (stage.blocking) stageResults[stage.stage].blocking += 1;
    }
  }
  const blockingCount = records.reduce((total, record) => total + asArray(record.stages).filter((stage) => stage.blocking).length, 0);
  const readiness = blockingCount === 0 && statusTotals.invalid_input === 0 && statusTotals.projection_failure === 0
    ? 'ready_for_decision_intelligence_projection_validation'
    : 'blocked_pending_projection_conformance_remediation';
  return deepFreeze({
    schemaVersion: SCHEMA_VERSION,
    source: SOURCE,
    totalRecords: records.length,
    statusTotals: Object.fromEntries(Object.entries(statusTotals).sort(([left], [right]) => left.localeCompare(right))),
    stageResults: Object.fromEntries(Object.entries(stageResults).sort(([left], [right]) => left.localeCompare(right))),
    blockingFindingCount: blockingCount,
    projectionValidationReadiness: readiness,
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  });
}

function buildDecisionIntelligenceCanonicalSignalReferenceProjectionReport(records = [], options = {}) {
  const inputs = asArray(records)
    .map((record) => clone(record))
    .sort((left, right) => {
      const leftSignal = resolveCanonicalSignal(left);
      const rightSignal = resolveCanonicalSignal(right);
      return `${normalizeString(leftSignal.signalName)}|${normalizeString(leftSignal.signalFingerprint)}|${fingerprint(left)}`.localeCompare(`${normalizeString(rightSignal.signalName)}|${normalizeString(rightSignal.signalFingerprint)}|${fingerprint(right)}`);
    });
  const perRecordResults = inputs.map((record, index) => runSingleConformance(record, {
    ...options,
    conformanceId: `${normalizeString(options.conformanceRunId || 'projection-conformance')}:record-${index + 1}`,
    projectionId: record.projectionId || `${normalizeString(options.conformanceRunId || 'projection-conformance')}:projection-${index + 1}`
  }));
  const batch = projection.projectCanonicalSignalReferenceBatch(inputs, {
    projectionBatchId: normalizeString(options.conformanceRunId || 'projection-conformance-batch'),
    createdAt: options.createdAt
  });
  const replayBatch = projection.projectCanonicalSignalReferenceBatch([...inputs].reverse(), {
    projectionBatchId: normalizeString(options.conformanceRunId || 'projection-conformance-batch'),
    createdAt: options.createdAt
  });
  const batchStage = makeStage('batch_consistency', {
    errors: JSON.stringify(batch) === JSON.stringify(replayBatch) ? [] : ['batch_consistency_failed'],
    reasonCodes: ['batch_consistency_checked'],
    evidence: {
      batchFingerprint: batch.batchFingerprint,
      replayBatchFingerprint: replayBatch.batchFingerprint
    }
  });
  const recordsWithBatch = perRecordResults.map((record) => {
    const nextRecord = {
      ...clone(record),
      stages: asArray(record.stages).map((stage) => stage.stage === 'batch_consistency' ? batchStage : stage)
    };
    delete nextRecord.conformanceFingerprint;
    return deepFreeze({
      ...nextRecord,
      conformanceFingerprint: buildDecisionIntelligenceCanonicalSignalReferenceProjectionFingerprint(nextRecord)
    });
  });
  const core = {
    schemaVersion: SCHEMA_VERSION,
    source: SOURCE,
    version: VERSION,
    conformanceRunId: normalizeString(options.conformanceRunId || 'decision-intelligence-canonical-signal-reference-projection-conformance'),
    createdAt: normalizeDate(options.createdAt || 'unknown'),
    perRecordResults: recordsWithBatch,
    batchConsistency: {
      passed: batchStage.passed,
      batchFingerprint: batch.batchFingerprint,
      replayBatchFingerprint: replayBatch.batchFingerprint,
      projectionCount: batch.projectionCount,
      productionImpact: 'none',
      decisionImpact: 'none',
      executionAuthority: 'none'
    },
    summary: {},
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
  const withSummary = {
    ...core,
    summary: summarizeDecisionIntelligenceCanonicalSignalReferenceProjectionConformance(core)
  };
  return deepFreeze({
    ...withSummary,
    reportFingerprint: buildDecisionIntelligenceCanonicalSignalReferenceProjectionFingerprint(withSummary)
  });
}

function validateDecisionIntelligenceCanonicalSignalReferenceProjectionConformance(report = {}) {
  const errors = [];
  const warnings = [];
  const invalidFields = [];
  const authorityViolations = [];
  const fingerprintViolations = [];
  const input = asObject(report);

  if (input.schemaVersion !== SCHEMA_VERSION) {
    errors.push(validationIssue('invalid_schema_version', 'Conformance report schemaVersion is invalid.', 'schemaVersion'));
    invalidFields.push('schemaVersion');
  }
  if (input.source !== SOURCE) {
    errors.push(validationIssue('invalid_source', 'Conformance report source is invalid.', 'source'));
    invalidFields.push('source');
  }
  for (const field of AUTHORITY_FIELDS) {
    if (input[field] !== 'none') {
      errors.push(validationIssue('authority_boundary_violation', `${field} must remain none.`, field));
      invalidFields.push(field);
      authorityViolations.push(field);
    }
  }
  for (const [index, record] of asArray(input.perRecordResults || input.records).entries()) {
    if (!CONFORMANCE_STATUSES.includes(record.status)) {
      errors.push(validationIssue('invalid_conformance_status', 'Record status is unsupported.', `perRecordResults.${index}.status`));
      invalidFields.push(`perRecordResults.${index}.status`);
    }
    const missingStages = CONFORMANCE_STAGES.filter((stage) => !asArray(record.stages).some((item) => item.stage === stage));
    if (missingStages.length > 0) {
      errors.push(validationIssue('missing_conformance_stage', 'Record is missing required conformance stages.', `perRecordResults.${index}.stages`));
      invalidFields.push(`perRecordResults.${index}.stages`);
    }
    for (const field of AUTHORITY_FIELDS) {
      if (record[field] !== 'none' || record.projectionResult?.[field] !== 'none') {
        errors.push(validationIssue('authority_boundary_violation', 'Record and projection must preserve none authority fields.', `perRecordResults.${index}.${field}`));
        authorityViolations.push(`perRecordResults.${index}.${field}`);
      }
    }
    if (record.projectionResult?.eligibilityPropagation?.buyNowEligible !== false) {
      errors.push(validationIssue('buy_now_eligibility_granted', 'Projection conformance must not grant BUY_NOW eligibility.', `perRecordResults.${index}.projectionResult.eligibilityPropagation.buyNowEligible`));
      authorityViolations.push(`perRecordResults.${index}.projectionResult.eligibilityPropagation.buyNowEligible`);
    }
    if (record.projectionResult?.eligibilityPropagation?.dealGateEligible !== false) {
      errors.push(validationIssue('deal_gate_eligibility_granted', 'Projection conformance must not grant Deal Gate eligibility.', `perRecordResults.${index}.projectionResult.eligibilityPropagation.dealGateEligible`));
      authorityViolations.push(`perRecordResults.${index}.projectionResult.eligibilityPropagation.dealGateEligible`);
    }
    if (record.conformanceFingerprint && buildDecisionIntelligenceCanonicalSignalReferenceProjectionFingerprint(record) !== record.conformanceFingerprint) {
      errors.push(validationIssue('record_fingerprint_mismatch', 'conformanceFingerprint does not match record contents.', `perRecordResults.${index}.conformanceFingerprint`));
      invalidFields.push(`perRecordResults.${index}.conformanceFingerprint`);
      fingerprintViolations.push(`perRecordResults.${index}.conformanceFingerprint`);
    }
  }
  if (input.reportFingerprint && buildDecisionIntelligenceCanonicalSignalReferenceProjectionFingerprint(input) !== input.reportFingerprint) {
    errors.push(validationIssue('report_fingerprint_mismatch', 'reportFingerprint does not match report contents.', 'reportFingerprint'));
    invalidFields.push('reportFingerprint');
    fingerprintViolations.push('reportFingerprint');
  }
  const reasonCodes = sortedStrings([
    ...errors.map((error) => error.code),
    ...warnings.map((warning) => warning.code)
  ]);
  return {
    valid: errors.length === 0,
    errors: sortedIssues(errors),
    warnings: sortedIssues(warnings),
    reasonCodes,
    invalidFields: sortedStrings(invalidFields),
    authorityViolations: sortedStrings(authorityViolations),
    fingerprintViolations: sortedStrings(fingerprintViolations)
  };
}

function runDecisionIntelligenceCanonicalSignalReferenceProjectionConformance(records = [], options = {}) {
  const report = buildDecisionIntelligenceCanonicalSignalReferenceProjectionReport(records, options);
  return deepFreeze({
    ...report,
    validation: validateDecisionIntelligenceCanonicalSignalReferenceProjectionConformance(report)
  });
}

module.exports = {
  SOURCE,
  VERSION,
  SCHEMA_VERSION,
  CONFORMANCE_STAGES,
  CONFORMANCE_STATUSES,
  runDecisionIntelligenceCanonicalSignalReferenceProjectionConformance,
  validateDecisionIntelligenceCanonicalSignalReferenceProjectionConformance,
  buildDecisionIntelligenceCanonicalSignalReferenceProjectionReport,
  compareCanonicalSignalProjection,
  summarizeDecisionIntelligenceCanonicalSignalReferenceProjectionConformance,
  buildDecisionIntelligenceCanonicalSignalReferenceProjectionFingerprint
};
