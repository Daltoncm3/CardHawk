'use strict';

const { asArray, asObject, unique } = require('./canonicalValidationCore');
const { buildFingerprintFromProjection } = require('./fingerprintProjection');
const { clone, firstDefined } = require('./phase8GovernanceCore');
const {
  runDecisionIntelligencePipeline,
  validateDecisionIntelligencePipeline,
  summarizeDecisionIntelligencePipeline
} = require('./decisionIntelligencePipelineOrchestrator');
const {
  validateDecisionIntelligenceEvidenceBundle,
  summarizeDecisionIntelligenceEvidenceBundle
} = require('./decisionIntelligenceEvidenceBundle');
const {
  validateDecisionIntelligenceArtifact,
  summarizeDecisionArtifact
} = require('./decisionIntelligenceArtifactBuilder');
const {
  validateDecisionIntelligenceArtifactConformance,
  summarizeDecisionIntelligenceConformance
} = require('./decisionIntelligenceArtifactConformance');
const {
  buildDecisionIntelligencePipelineBaseline,
  buildDecisionIntelligencePipelineCertification,
  validateDecisionIntelligencePipelineBaseline,
  summarizeDecisionIntelligencePipelineBaseline
} = require('./decisionIntelligencePipelineStabilityBaseline');
const {
  buildDecisionIntelligenceGovernanceBinding,
  validateDecisionIntelligenceGovernanceBinding,
  summarizeDecisionIntelligenceGovernanceBinding
} = require('./decisionIntelligenceGovernanceBindingAdapter');
const {
  createGovernanceArtifactRegistry,
  registerArtifact,
  getArtifact,
  summarizeRegistry
} = require('./governanceArtifactRegistry');
const {
  createLifecycle,
  registerLifecycleEvent,
  getLifecycleState,
  validateLifecycleIntegrity
} = require('./governanceArtifactLifecycleManager');

const DECISION_INTELLIGENCE_GOVERNANCE_VALIDATION_SCHEMA_VERSION = 'decision_intelligence_governance_integration_validation.v1';
const DECISION_INTELLIGENCE_GOVERNANCE_VALIDATION_SOURCE = 'decision_intelligence_governance_integration_validation';
const UNKNOWN_VALUE = 'unknown';

const VALIDATION_STAGES = Object.freeze([
  'evidence_bundle_integrity',
  'artifact_builder_integrity',
  'artifact_conformance_integrity',
  'pipeline_orchestrator_integrity',
  'stability_baseline_compatibility',
  'governance_binding_integrity',
  'registry_compatibility',
  'lifecycle_compatibility',
  'review_readiness_propagation',
  'certification_readiness_propagation',
  'warning_propagation',
  'provenance_continuity',
  'fingerprint_continuity',
  'authority_boundary_preservation'
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

function normalizeString(value, fallback = UNKNOWN_VALUE) {
  if (!known(value)) return fallback;
  return String(value).trim() || fallback;
}

function normalizeDate(value, fallback = UNKNOWN_VALUE) {
  if (!known(value)) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function addMilliseconds(value, amount) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Date(date.getTime() + amount).toISOString();
}

function validationIssue(code, message, field = '') {
  return { code, message, field };
}

function collectReasonCodes(errors = [], warnings = []) {
  return unique([...asArray(errors), ...asArray(warnings)].map((issue) => issue.code)).sort();
}

function stageResult(stageName, validation = {}, extras = {}) {
  const errors = asArray(validation.errors);
  const warnings = asArray(validation.warnings);
  const valid = validation.valid !== false && errors.length === 0;
  return deepFreeze({
    stageName,
    valid,
    status: valid ? 'passed' : 'failed',
    errors: clone(errors),
    warnings: clone(warnings),
    reasonCodes: collectReasonCodes(errors, warnings),
    ...clone(asObject(extras))
  });
}

function buildReportFingerprint(report = {}) {
  const projection = clone(report);
  delete projection.validationFingerprint;
  return buildFingerprintFromProjection(projection);
}

function normalizeInputs(input = {}, options = {}) {
  const source = asObject(input);
  const pipelineRun = source.pipelineRun || runDecisionIntelligencePipeline(firstDefined(source.pipelineInput, source), {
    runId: firstDefined(source.runId, options.runId),
    createdAt: firstDefined(source.createdAt, options.createdAt),
    conformanceReportId: firstDefined(source.conformanceReportId, options.conformanceReportId)
  });
  const stabilityBaseline = source.stabilityBaseline || buildDecisionIntelligencePipelineBaseline({
    pipelineRun,
    baselineId: firstDefined(source.baselineId, options.baselineId),
    createdAt: firstDefined(source.baselineCreatedAt, source.createdAt, options.createdAt)
  });
  const stabilityCertification = source.stabilityCertification || buildDecisionIntelligencePipelineCertification(stabilityBaseline, {
    certificationId: firstDefined(source.certificationId, options.certificationId),
    createdAt: firstDefined(source.certificationCreatedAt, source.createdAt, options.createdAt)
  });
  const binding = source.governanceBinding || buildDecisionIntelligenceGovernanceBinding({
    pipelineRun,
    stabilityBaseline,
    stabilityCertification,
    reviewPackage: source.reviewPackage,
    governanceReferences: source.governanceReferences,
    bindingId: firstDefined(source.bindingId, options.bindingId),
    createdAt: firstDefined(source.bindingCreatedAt, source.createdAt, options.createdAt)
  });
  return { pipelineRun, stabilityBaseline, stabilityCertification, binding };
}

function validateRegistryCompatibility(binding = {}, input = {}, options = {}) {
  const registryInput = asObject(firstDefined(input.registry, options.registry));
  const registry = Object.keys(registryInput).length ? registryInput : createGovernanceArtifactRegistry({
    registryId: firstDefined(input.registryId, options.registryId, 'decision-intelligence-governance-validation-registry'),
    createdAt: firstDefined(input.createdAt, options.createdAt)
  });
  const registrationResult = registerArtifact(registry, binding, {
    registeredAt: firstDefined(input.registeredAt, input.createdAt, options.registeredAt, options.createdAt),
    artifactType: 'decision_intelligence_pipeline_binding'
  });
  const registered = registrationResult.registered === true;
  const nextRegistry = registrationResult.registry;
  const fetched = getArtifact(nextRegistry, binding.bindingId);
  const errors = [];
  const warnings = [];
  const fingerprintViolations = [];
  if (!registrationResult.validation.valid) errors.push(...registrationResult.validation.errors);
  warnings.push(...registrationResult.validation.warnings);
  if (!registered) {
    errors.push(validationIssue('binding_registration_failed', 'Decision Intelligence Governance Binding was not registered.', 'registry'));
  }
  if (!fetched || fetched.artifactFingerprint !== binding.bindingFingerprint) {
    errors.push(validationIssue('registry_binding_fingerprint_mismatch', 'Registry does not preserve the binding fingerprint.', 'bindingFingerprint'));
    fingerprintViolations.push('bindingFingerprint');
  }
  return deepFreeze({
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes: collectReasonCodes(errors, warnings),
    registered,
    registry: nextRegistry,
    registration: registrationResult.registration,
    registrySummary: summarizeRegistry(nextRegistry),
    fingerprintViolations
  });
}

function validateLifecycleCompatibility(binding = {}, registryValidation = {}, input = {}, options = {}) {
  const registry = registryValidation.registry;
  const lifecycleInput = asObject(firstDefined(input.lifecycle, options.lifecycle));
  const lifecycle = Object.keys(lifecycleInput).length ? lifecycleInput : createLifecycle({
    lifecycleId: firstDefined(input.lifecycleId, options.lifecycleId, 'decision-intelligence-governance-validation-lifecycle'),
    registryId: asObject(registry).registryId,
    registryFingerprint: asObject(registry).registryFingerprint,
    createdAt: firstDefined(input.createdAt, options.createdAt)
  });
  const registeredEvent = registerLifecycleEvent(lifecycle, {
    eventType: 'registered',
    artifactId: binding.bindingId,
    artifactFingerprint: binding.bindingFingerprint,
    eventAt: firstDefined(input.lifecycleRegisteredAt, input.createdAt, options.createdAt)
  }, { registry });
  const registeredAt = asObject(registeredEvent.event).eventAt;
  const activeEvent = registeredEvent.registered ? registerLifecycleEvent(registeredEvent.lifecycle, {
    eventType: 'activated',
    artifactId: binding.bindingId,
    artifactFingerprint: binding.bindingFingerprint,
    eventAt: firstDefined(input.lifecycleActivatedAt, addMilliseconds(registeredAt, 1))
  }, { registry }) : null;
  const nextLifecycle = activeEvent && activeEvent.registered ? activeEvent.lifecycle : registeredEvent.lifecycle || lifecycle;
  const integrity = validateLifecycleIntegrity(nextLifecycle, { registry });
  const state = getLifecycleState(nextLifecycle, binding.bindingId);
  const errors = [];
  const warnings = [];
  const lifecycleViolations = [];
  if (!registeredEvent.validation.valid) errors.push(...registeredEvent.validation.errors);
  if (activeEvent && !activeEvent.validation.valid) errors.push(...activeEvent.validation.errors);
  warnings.push(...asArray(registeredEvent.validation.warnings), ...asArray(activeEvent?.validation?.warnings), ...asArray(integrity.warnings));
  if (!integrity.valid) errors.push(...integrity.errors);
  if (state.currentState !== 'active') {
    errors.push(validationIssue('binding_lifecycle_not_active', 'Binding lifecycle state should be active for integration validation.', 'lifecycle'));
    lifecycleViolations.push(binding.bindingId);
  }
  return deepFreeze({
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes: collectReasonCodes(errors, warnings),
    lifecycle: nextLifecycle,
    lifecycleState: state,
    lifecycleViolations: unique(lifecycleViolations).sort()
  });
}

function validateReadinessPropagation(binding = {}, pipelineRun = {}) {
  const errors = [];
  const warnings = [];
  const readinessViolations = [];
  const pipelineSummary = summarizeDecisionIntelligencePipeline(pipelineRun);
  if (pipelineSummary.readyForGovernanceReview === true && asObject(binding.reviewReadiness).ready !== true) {
    errors.push(validationIssue('review_readiness_not_propagated', 'Binding did not preserve pipeline review readiness.', 'reviewReadiness'));
    readinessViolations.push('reviewReadiness');
  }
  if (pipelineSummary.readyForGovernanceBinding === true && asObject(binding.certificationReadiness).ready !== true) {
    errors.push(validationIssue('certification_readiness_not_propagated', 'Binding did not preserve certification readiness.', 'certificationReadiness'));
    readinessViolations.push('certificationReadiness');
  }
  return deepFreeze({
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes: collectReasonCodes(errors, warnings),
    readinessViolations,
    reviewReadiness: clone(asObject(binding.reviewReadiness)),
    certificationReadiness: clone(asObject(binding.certificationReadiness))
  });
}

function validateWarningPropagation(binding = {}, pipelineRun = {}, baseline = {}) {
  const errors = [];
  const warnings = [];
  const warningViolations = [];
  const sourceWarnings = unique([
    ...asArray(asObject(pipelineRun.evidenceBundleValidation).warnings).map((issue) => issue.code),
    ...asArray(asObject(pipelineRun.artifactConformance).warnings).map((issue) => issue.code),
    ...asArray(asObject(pipelineRun.pipelineReport).warnings).map((issue) => issue.code),
    ...asArray(asObject(baseline).warnings)
  ]).sort();
  const propagated = asArray(asObject(binding.warningPropagation).nonBlockingWarnings);
  for (const code of sourceWarnings) {
    if (!propagated.includes(code)) {
      errors.push(validationIssue('warning_not_propagated', `Warning was not propagated: ${code}.`, 'warningPropagation'));
      warningViolations.push(code);
    }
  }
  return deepFreeze({
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes: collectReasonCodes(errors, warnings),
    sourceWarningCount: sourceWarnings.length,
    propagatedWarningCount: propagated.length,
    warningViolations: unique(warningViolations).sort()
  });
}

function validateProvenanceContinuity(binding = {}, pipelineRun = {}, baseline = {}) {
  const errors = [];
  const warnings = [];
  const provenanceViolations = [];
  const expectedFingerprints = unique([
    asObject(pipelineRun.evidenceBundle).bundleFingerprint,
    asObject(pipelineRun.decisionArtifact).artifactFingerprint,
    asObject(pipelineRun.artifactConformance).conformanceFingerprint,
    pipelineRun.pipelineFingerprint,
    asObject(pipelineRun.pipelineReport).reportFingerprint,
    asObject(baseline).baselineFingerprint
  ].filter((value) => known(value) && value !== UNKNOWN_VALUE)).sort();
  const actual = asArray(asObject(binding.provenance).inputFingerprints);
  for (const fingerprint of expectedFingerprints) {
    if (!actual.includes(fingerprint)) {
      errors.push(validationIssue('provenance_fingerprint_missing', 'Binding provenance is missing a source fingerprint.', 'provenance.inputFingerprints'));
      provenanceViolations.push(fingerprint);
    }
  }
  return deepFreeze({
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes: collectReasonCodes(errors, warnings),
    expectedFingerprintCount: expectedFingerprints.length,
    actualFingerprintCount: actual.length,
    provenanceViolations: unique(provenanceViolations).sort()
  });
}

function validateFingerprintContinuity(binding = {}, pipelineRun = {}, baseline = {}) {
  const errors = [];
  const warnings = [];
  const fingerprintViolations = [];
  const refs = asObject(binding.decisionIntelligenceReferences);
  const checks = [
    ['evidenceBundle', asObject(pipelineRun.evidenceBundle).bundleFingerprint, asObject(refs.evidenceBundle).bundleFingerprint],
    ['artifact', asObject(pipelineRun.decisionArtifact).artifactFingerprint, asObject(refs.artifact).artifactFingerprint],
    ['conformanceReport', asObject(pipelineRun.artifactConformance).conformanceFingerprint, asObject(refs.conformanceReport).conformanceFingerprint],
    ['pipelineRun', pipelineRun.pipelineFingerprint, asObject(refs.pipelineRun).pipelineFingerprint],
    ['pipelineReport', asObject(pipelineRun.pipelineReport).reportFingerprint, asObject(refs.pipelineReport).reportFingerprint],
    ['stabilityBaseline', asObject(baseline).baselineFingerprint, asObject(refs.stabilityBaseline).baselineFingerprint]
  ];
  for (const [name, expected, actual] of checks) {
    if (known(expected) && expected !== actual) {
      errors.push(validationIssue('fingerprint_continuity_mismatch', `${name} fingerprint was not preserved.`, name));
      fingerprintViolations.push(name);
    }
  }
  return deepFreeze({
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes: collectReasonCodes(errors, warnings),
    fingerprintViolations: unique(fingerprintViolations).sort(),
    checkCount: checks.length
  });
}

function validateAuthorityBoundary(binding = {}, pipelineRun = {}, baseline = {}, registryValidation = {}, lifecycleValidation = {}) {
  const errors = [];
  const warnings = [];
  const authorityViolations = [];
  const artifacts = [
    ['pipelineRun', pipelineRun],
    ['evidenceBundle', pipelineRun.evidenceBundle],
    ['decisionArtifact', pipelineRun.decisionArtifact],
    ['pipelineReport', pipelineRun.pipelineReport],
    ['stabilityBaseline', baseline],
    ['binding', binding],
    ['registry', registryValidation.registry],
    ['lifecycle', lifecycleValidation.lifecycle]
  ];
  for (const [name, artifact] of artifacts) {
    const item = asObject(artifact);
    for (const field of ['productionImpact', 'decisionImpact', 'executionAuthority']) {
      if (item[field] !== undefined && item[field] !== 'none') {
        errors.push(validationIssue('authority_boundary_violation', `${name}.${field} must remain none.`, `${name}.${field}`));
        authorityViolations.push(`${name}.${field}`);
      }
    }
  }
  return deepFreeze({
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes: collectReasonCodes(errors, warnings),
    authorityViolations: unique(authorityViolations).sort()
  });
}

function buildDecisionIntelligenceGovernanceValidationReport(input = {}, options = {}) {
  const normalized = normalizeInputs(input, options);
  const pipelineRun = normalized.pipelineRun;
  const baseline = normalized.stabilityBaseline;
  const binding = normalized.binding;
  const evidenceBundleValidation = validateDecisionIntelligenceEvidenceBundle(pipelineRun.evidenceBundle);
  const artifactValidation = validateDecisionIntelligenceArtifact(pipelineRun.decisionArtifact);
  const conformanceValidation = validateDecisionIntelligenceArtifactConformance(pipelineRun.decisionArtifact, {
    sourceInput: asObject(pipelineRun.evidenceBundle).builderInput,
    conformanceReportId: asObject(pipelineRun.artifactConformance).conformanceReportId,
    createdAt: asObject(pipelineRun.artifactConformance).createdAt
  });
  const pipelineValidation = validateDecisionIntelligencePipeline(pipelineRun);
  const baselineValidation = validateDecisionIntelligencePipelineBaseline(baseline);
  const bindingValidation = validateDecisionIntelligenceGovernanceBinding(binding);
  const registryValidation = validateRegistryCompatibility(binding, input, options);
  const lifecycleValidation = validateLifecycleCompatibility(binding, registryValidation, input, options);
  const readinessValidation = validateReadinessPropagation(binding, pipelineRun);
  const warningValidation = validateWarningPropagation(binding, pipelineRun, baseline);
  const provenanceValidation = validateProvenanceContinuity(binding, pipelineRun, baseline);
  const fingerprintValidation = validateFingerprintContinuity(binding, pipelineRun, baseline);
  const authorityValidation = validateAuthorityBoundary(binding, pipelineRun, baseline, registryValidation, lifecycleValidation);
  const stageResults = [
    stageResult('evidence_bundle_integrity', evidenceBundleValidation, summarizeDecisionIntelligenceEvidenceBundle(pipelineRun.evidenceBundle)),
    stageResult('artifact_builder_integrity', artifactValidation, summarizeDecisionArtifact(pipelineRun.decisionArtifact)),
    stageResult('artifact_conformance_integrity', conformanceValidation, summarizeDecisionIntelligenceConformance(conformanceValidation)),
    stageResult('pipeline_orchestrator_integrity', pipelineValidation, summarizeDecisionIntelligencePipeline(pipelineRun)),
    stageResult('stability_baseline_compatibility', baselineValidation, summarizeDecisionIntelligencePipelineBaseline(baseline)),
    stageResult('governance_binding_integrity', bindingValidation, summarizeDecisionIntelligenceGovernanceBinding(binding)),
    stageResult('registry_compatibility', registryValidation, registryValidation.registrySummary),
    stageResult('lifecycle_compatibility', lifecycleValidation, lifecycleValidation.lifecycleState),
    stageResult('review_readiness_propagation', readinessValidation, { readiness: readinessValidation.reviewReadiness }),
    stageResult('certification_readiness_propagation', readinessValidation, { readiness: readinessValidation.certificationReadiness }),
    stageResult('warning_propagation', warningValidation),
    stageResult('provenance_continuity', provenanceValidation),
    stageResult('fingerprint_continuity', fingerprintValidation),
    stageResult('authority_boundary_preservation', authorityValidation)
  ];
  const errors = stageResults.flatMap((stage) => asArray(stage.errors).map((error) => ({ ...error, stageName: stage.stageName })));
  const warnings = stageResults.flatMap((stage) => asArray(stage.warnings).map((warning) => ({ ...warning, stageName: stage.stageName })));
  const failedStages = stageResults.filter((stage) => stage.valid === false);
  const core = {
    schemaVersion: DECISION_INTELLIGENCE_GOVERNANCE_VALIDATION_SCHEMA_VERSION,
    source: DECISION_INTELLIGENCE_GOVERNANCE_VALIDATION_SOURCE,
    validationId: normalizeString(firstDefined(input.validationId, options.validationId, `decision-intelligence-governance-validation:${binding.bindingId}`)),
    createdAt: normalizeDate(firstDefined(input.createdAt, options.createdAt, binding.createdAt, pipelineRun.createdAt)),
    pipelineRunId: normalizeString(pipelineRun.runId),
    pipelineFingerprint: normalizeString(pipelineRun.pipelineFingerprint),
    bindingId: normalizeString(binding.bindingId),
    bindingFingerprint: normalizeString(binding.bindingFingerprint),
    registryId: normalizeString(asObject(registryValidation.registry).registryId),
    registryFingerprint: normalizeString(asObject(registryValidation.registry).registryFingerprint),
    lifecycleId: normalizeString(asObject(lifecycleValidation.lifecycle).lifecycleId),
    lifecycleFingerprint: normalizeString(asObject(lifecycleValidation.lifecycle).lifecycleFingerprint),
    stageResults,
    validationScope: VALIDATION_STAGES.slice(),
    errors,
    warnings,
    reasonCodes: collectReasonCodes(errors, warnings),
    integrationDiagnostics: {
      valid: failedStages.length === 0,
      stageCount: stageResults.length,
      passedStageCount: stageResults.length - failedStages.length,
      failedStageCount: failedStages.length,
      failedStages: failedStages.map((stage) => stage.stageName).sort(),
      reviewReadiness: clone(asObject(binding.reviewReadiness)),
      certificationReadiness: clone(asObject(binding.certificationReadiness)),
      warningCount: Number(asObject(binding.warningPropagation).warningCount || 0),
      registryRegistered: registryValidation.registered === true,
      lifecycleState: normalizeString(asObject(lifecycleValidation.lifecycleState).currentState),
      productionImpact: 'none',
      decisionImpact: 'none',
      executionAuthority: 'none'
    },
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
  return deepFreeze({
    ...core,
    validationFingerprint: buildReportFingerprint(core)
  });
}

function runDecisionIntelligenceGovernanceValidation(input = {}, options = {}) {
  return buildDecisionIntelligenceGovernanceValidationReport(input, options);
}

function validateDecisionIntelligenceGovernanceIntegration(report = {}) {
  const input = asObject(report);
  const errors = [];
  const warnings = [];
  const missingRequiredFields = [];
  const fingerprintViolations = [];
  const authorityViolations = [];
  for (const field of ['schemaVersion', 'source', 'validationId', 'createdAt', 'pipelineRunId', 'pipelineFingerprint', 'bindingId', 'bindingFingerprint', 'stageResults', 'integrationDiagnostics', 'productionImpact', 'decisionImpact', 'executionAuthority', 'validationFingerprint']) {
    if (!known(input[field])) {
      errors.push(validationIssue('missing_required_field', `${field} is required.`, field));
      missingRequiredFields.push(field);
    }
  }
  if (input.schemaVersion !== DECISION_INTELLIGENCE_GOVERNANCE_VALIDATION_SCHEMA_VERSION) errors.push(validationIssue('invalid_schema_version', 'Validation report schemaVersion is unsupported.', 'schemaVersion'));
  if (input.source !== DECISION_INTELLIGENCE_GOVERNANCE_VALIDATION_SOURCE) errors.push(validationIssue('invalid_source', 'Validation report source is unsupported.', 'source'));
  for (const field of ['productionImpact', 'decisionImpact', 'executionAuthority']) {
    if (input[field] !== 'none') {
      errors.push(validationIssue('authority_boundary_violation', `${field} must remain none.`, field));
      authorityViolations.push(field);
    }
  }
  if (known(input.validationFingerprint) && buildReportFingerprint(input) !== input.validationFingerprint) {
    errors.push(validationIssue('validation_fingerprint_mismatch', 'validationFingerprint does not match report contents.', 'validationFingerprint'));
    fingerprintViolations.push('validationFingerprint');
  }
  const failedStages = asArray(input.stageResults).filter((stage) => stage.valid === false);
  if (failedStages.length) errors.push(validationIssue('integration_stage_failed', 'One or more Decision Intelligence Governance validation stages failed.', 'stageResults'));
  for (const issue of asArray(input.warnings)) warnings.push(issue);
  return deepFreeze({
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes: collectReasonCodes(errors, warnings),
    missingRequiredFields: unique(missingRequiredFields).sort(),
    fingerprintViolations: unique(fingerprintViolations).sort(),
    authorityViolations: unique(authorityViolations).sort(),
    failedStages: failedStages.map((stage) => stage.stageName).sort()
  });
}

function summarizeDecisionIntelligenceGovernanceValidation(report = {}) {
  const input = asObject(report);
  const validation = validateDecisionIntelligenceGovernanceIntegration(input);
  const diagnostics = asObject(input.integrationDiagnostics);
  return deepFreeze({
    validationId: normalizeString(input.validationId),
    pipelineRunId: normalizeString(input.pipelineRunId),
    bindingId: normalizeString(input.bindingId),
    stageCount: Number(diagnostics.stageCount || asArray(input.stageResults).length),
    passedStageCount: Number(diagnostics.passedStageCount || 0),
    failedStageCount: Number(diagnostics.failedStageCount || validation.failedStages.length),
    failedStages: clone(asArray(diagnostics.failedStages || validation.failedStages)),
    reviewReadinessStatus: normalizeString(asObject(diagnostics.reviewReadiness).status),
    certificationReadinessStatus: normalizeString(asObject(diagnostics.certificationReadiness).status),
    warningCount: Number(diagnostics.warningCount || 0),
    registryRegistered: diagnostics.registryRegistered === true,
    lifecycleState: normalizeString(diagnostics.lifecycleState),
    valid: validation.valid,
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  });
}

module.exports = {
  DECISION_INTELLIGENCE_GOVERNANCE_VALIDATION_SCHEMA_VERSION,
  DECISION_INTELLIGENCE_GOVERNANCE_VALIDATION_SOURCE,
  VALIDATION_STAGES,
  runDecisionIntelligenceGovernanceValidation,
  validateDecisionIntelligenceGovernanceIntegration,
  buildDecisionIntelligenceGovernanceValidationReport,
  summarizeDecisionIntelligenceGovernanceValidation
};
