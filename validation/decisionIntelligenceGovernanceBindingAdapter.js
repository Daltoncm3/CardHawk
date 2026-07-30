'use strict';

const { asArray, asObject, unique } = require('./canonicalValidationCore');
const { buildFingerprintFromProjection } = require('./fingerprintProjection');
const { clone, firstDefined } = require('./phase8GovernanceCore');
const {
  validateDecisionIntelligencePipeline,
  summarizeDecisionIntelligencePipeline
} = require('./decisionIntelligencePipelineOrchestrator');
const {
  validateDecisionIntelligencePipelineBaseline,
  summarizeDecisionIntelligencePipelineBaseline
} = require('./decisionIntelligencePipelineStabilityBaseline');

const DECISION_INTELLIGENCE_GOVERNANCE_BINDING_SCHEMA_VERSION = 'decision_intelligence_governance_binding.v1';
const DECISION_INTELLIGENCE_GOVERNANCE_BINDING_SOURCE = 'decision_intelligence_governance_binding_adapter';
const DECISION_INTELLIGENCE_GOVERNANCE_BINDING_TYPE = 'decision_intelligence_pipeline_binding';
const DECISION_INTELLIGENCE_GOVERNANCE_BINDING_VERSION = '1.0.0';
const UNKNOWN_VALUE = 'unknown';

const REQUIRED_BINDING_FIELDS = Object.freeze([
  'schemaVersion',
  'source',
  'bindingId',
  'bindingType',
  'bindingVersion',
  'createdAt',
  'asOf',
  'listingId',
  'reviewPackageId',
  'reviewPackageFingerprint',
  'decisionIntelligenceReferences',
  'governanceReferences',
  'validationStatus',
  'reviewReadiness',
  'certificationReadiness',
  'warningPropagation',
  'provenance',
  'compatibility',
  'auditHistory',
  'productionImpact',
  'decisionImpact',
  'executionAuthority',
  'bindingFingerprint'
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

function normalizeBoolean(value, fallback = false) {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeStringArray(values = []) {
  return unique(asArray(values).map((value) => normalizeString(value, '')).filter(Boolean)).sort();
}

function validationIssue(code, message, field = '') {
  return { code, message, field };
}

function collectReasonCodes(errors = [], warnings = []) {
  return unique([...asArray(errors), ...asArray(warnings)].map((issue) => issue.code)).sort();
}

function sourceId(source = {}, fallback = UNKNOWN_VALUE) {
  const input = asObject(source);
  return normalizeString(firstDefined(
    input.referenceId,
    input.sourceArtifactId,
    input.artifactId,
    input.bundleId,
    input.reportId,
    input.runId,
    input.baselineId,
    input.certificationId,
    input.bindingId,
    input.packageId,
    input.registryId,
    input.lifecycleId,
    input.sessionId,
    input.workspaceReviewId,
    input.validationId,
    input.id,
    fallback
  ));
}

function sourceFingerprint(source = {}, fallback = UNKNOWN_VALUE) {
  const input = asObject(source);
  return normalizeString(firstDefined(
    input.sourceFingerprint,
    input.fingerprint,
    input.artifactFingerprint,
    input.bundleFingerprint,
    input.reportFingerprint,
    input.pipelineFingerprint,
    input.conformanceFingerprint,
    input.baselineFingerprint,
    input.certificationFingerprint,
    input.bindingFingerprint,
    input.packageFingerprint,
    input.registryFingerprint,
    input.lifecycleFingerprint,
    input.sessionFingerprint,
    input.workspaceFingerprint,
    input.validationFingerprint,
    fallback
  ));
}

function normalizeReference(reference = {}, defaults = {}) {
  const input = asObject(reference);
  const id = sourceId(input, firstDefined(defaults.referenceId, defaults.sourceArtifactId));
  const fingerprint = sourceFingerprint(input, firstDefined(defaults.sourceFingerprint, defaults.fingerprint));
  return {
    referenceId: id,
    referenceType: normalizeString(firstDefined(input.referenceType, input.type, defaults.referenceType)),
    schemaVersion: normalizeString(firstDefined(input.schemaVersion, input.version, defaults.schemaVersion)),
    source: normalizeString(firstDefined(input.source, defaults.source)),
    sourceArtifactId: id,
    sourceFingerprint: fingerprint,
    status: normalizeString(firstDefined(input.status, input.validationStatus, defaults.status)),
    validationReadiness: normalizeString(firstDefined(input.validationReadiness, defaults.validationReadiness)),
    certificationReadiness: normalizeString(firstDefined(input.certificationReadiness, defaults.certificationReadiness)),
    summary: normalizeString(firstDefined(input.summary, defaults.summary)),
    metadata: clone(asObject(firstDefined(input.metadata, defaults.metadata, {}))),
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
}

function issueCodes(validation = {}) {
  return collectReasonCodes(asArray(validation.errors), asArray(validation.warnings));
}

function buildDecisionReferences(pipelineRun = {}, baseline = {}, certification = {}) {
  const run = asObject(pipelineRun);
  const bundle = asObject(run.evidenceBundle);
  const artifact = asObject(run.decisionArtifact);
  const conformance = asObject(run.artifactConformance);
  const report = asObject(run.pipelineReport);
  const pipelineSummary = summarizeDecisionIntelligencePipeline(run);
  const baselineSummary = Object.keys(asObject(baseline)).length
    ? summarizeDecisionIntelligencePipelineBaseline(baseline)
    : {};
  return {
    evidenceBundle: {
      ...normalizeReference(bundle, { referenceType: 'decision_intelligence_evidence_bundle' }),
      bundleId: normalizeString(bundle.bundleId),
      bundleFingerprint: normalizeString(bundle.bundleFingerprint),
      validationStatus: asObject(run.evidenceBundleValidation).valid === true ? 'valid' : 'invalid',
      missingReferenceCount: asArray(bundle.missingReferences).length,
      evidenceGapCount: asArray(bundle.evidenceGaps).length,
      unknownValueCount: asArray(bundle.unknownValues).length
    },
    artifact: {
      ...normalizeReference(artifact, { referenceType: 'decision_intelligence_artifact' }),
      artifactId: normalizeString(artifact.artifactId),
      artifactFingerprint: normalizeString(artifact.artifactFingerprint),
      advisoryRecommendationType: normalizeString(asObject(artifact.advisoryRecommendation).recommendationType),
      advisoryRecommendationPosture: normalizeString(asObject(artifact.advisoryRecommendation).recommendationPosture),
      evidenceGapCount: asArray(artifact.outstandingEvidenceGaps).length,
      unknownValueCount: asArray(artifact.unknownValues).length
    },
    conformanceReport: {
      ...normalizeReference(conformance, { referenceType: 'decision_intelligence_artifact_conformance' }),
      conformanceReportId: normalizeString(conformance.conformanceReportId),
      conformanceFingerprint: normalizeString(conformance.conformanceFingerprint),
      valid: conformance.valid === true,
      failedStageCount: Number(asObject(conformance.summary).failedStageCount || 0),
      warningStageCount: Number(asObject(conformance.summary).warningStageCount || 0),
      reasonCodes: normalizeStringArray(conformance.reasonCodes)
    },
    pipelineRun: {
      ...normalizeReference(run, { referenceType: 'decision_intelligence_pipeline_run' }),
      runId: normalizeString(run.runId),
      pipelineFingerprint: normalizeString(run.pipelineFingerprint),
      valid: pipelineSummary.valid === true,
      stageCount: Number(pipelineSummary.stageCount || 0),
      failedStageCount: Number(pipelineSummary.failedStageCount || 0),
      warningStageCount: Number(pipelineSummary.warningStageCount || 0)
    },
    pipelineReport: {
      ...normalizeReference(report, { referenceType: 'decision_intelligence_pipeline_report' }),
      reportId: normalizeString(report.reportId),
      reportFingerprint: normalizeString(report.reportFingerprint),
      pipelineDiagnostics: clone(asObject(report.pipelineDiagnostics)),
      reasonCodes: normalizeStringArray(report.reasonCodes),
      errors: clone(asArray(report.errors)),
      warnings: clone(asArray(report.warnings))
    },
    stabilityBaseline: {
      ...normalizeReference(baseline, { referenceType: 'decision_intelligence_pipeline_stability_baseline' }),
      baselineId: normalizeString(asObject(baseline).baselineId),
      baselineFingerprint: normalizeString(asObject(baseline).baselineFingerprint),
      crossComponentIntegrityStatus: normalizeString(asObject(baselineSummary).crossComponentIntegrityStatus),
      deterministicFingerprintStatus: normalizeString(asObject(baselineSummary).deterministicFingerprintStatus),
      advisoryOnlyBoundaryStatus: normalizeString(asObject(baselineSummary).advisoryOnlyBoundaryStatus),
      offlineBoundaryStatus: normalizeString(asObject(baselineSummary).offlineBoundaryStatus),
      certificationStatus: normalizeString(asObject(baselineSummary).certificationStatus)
    },
    stabilityCertification: {
      ...normalizeReference(certification, { referenceType: 'decision_intelligence_pipeline_stability_certification', status: Object.keys(asObject(certification)).length ? 'supplied' : 'not_supplied' }),
      certificationId: normalizeString(asObject(certification).certificationId),
      certificationFingerprint: normalizeString(asObject(certification).certificationFingerprint),
      certificationStatus: normalizeString(asObject(certification).certificationStatus),
      certified: normalizeBoolean(asObject(certification).certified),
      warnings: normalizeStringArray(asObject(certification).warnings),
      knownArchitecturalLimitations: normalizeStringArray(asObject(certification).knownArchitecturalLimitations)
    }
  };
}

function buildGovernanceReferences(input = {}) {
  const source = asObject(input);
  return {
    signalGovernanceEvidenceBundle: normalizeReference(source.signalGovernanceEvidenceBundle, { referenceType: 'signal_governance_evidence_bundle', status: 'not_supplied' }),
    signalGovernanceReviewReport: normalizeReference(source.signalGovernanceReviewReport, { referenceType: 'signal_governance_review_report', status: 'not_supplied' }),
    registry: normalizeReference(source.registry, { referenceType: 'governance_artifact_registry', status: 'not_supplied' }),
    lifecycle: normalizeReference(source.lifecycle, { referenceType: 'governance_artifact_lifecycle', status: 'not_supplied' }),
    reviewSession: normalizeReference(firstDefined(source.reviewSession, source.session), { referenceType: 'governance_review_session', status: 'not_supplied' }),
    workspaceReview: normalizeReference(firstDefined(source.workspaceReview, source.workspace), { referenceType: 'governance_review_workspace', status: 'not_supplied' }),
    governancePipelineValidation: normalizeReference(firstDefined(source.governancePipelineValidation, source.pipelineValidation), { referenceType: 'governance_pipeline_validation', status: 'not_supplied' })
  };
}

function collectWarnings(pipelineRun = {}, baseline = {}, certification = {}) {
  const run = asObject(pipelineRun);
  const warningsBySource = {
    evidenceBundle: asArray(asObject(run.evidenceBundleValidation).warnings).map((issue) => issue.code),
    artifactConformance: asArray(asObject(run.artifactConformance).warnings).map((issue) => issue.code),
    pipelineReport: asArray(asObject(run.pipelineReport).warnings).map((issue) => issue.code),
    stabilityBaseline: normalizeStringArray(asObject(baseline).warnings),
    signalGovernance: [],
    governanceValidation: []
  };
  const knownArchitecturalLimitations = normalizeStringArray([
    ...asArray(asObject(baseline).knownArchitecturalLimitations),
    ...asArray(asObject(certification).knownArchitecturalLimitations)
  ]);
  const nonBlockingWarnings = unique(Object.values(warningsBySource).flat()).sort();
  return {
    warningCount: nonBlockingWarnings.length,
    warningsBySource,
    blockingWarnings: [],
    nonBlockingWarnings,
    knownArchitecturalLimitations
  };
}

function determineReviewReadiness(pipelineValidation = {}, warningPropagation = {}) {
  if (asArray(pipelineValidation.authorityViolations).length) return 'blocked_authority_violation';
  if (asArray(pipelineValidation.fingerprintViolations).length) return 'blocked_fingerprint_violation';
  if (pipelineValidation.valid !== true) return 'blocked_invalid_pipeline';
  return Number(warningPropagation.warningCount || 0) > 0 ? 'review_ready_with_warnings' : 'review_ready';
}

function determineCertificationReadiness(decisionReferences = {}, baselineValidation = {}, warningPropagation = {}) {
  const refs = asObject(decisionReferences);
  if (!known(asObject(refs.conformanceReport).conformanceFingerprint) || asObject(refs.conformanceReport).conformanceFingerprint === UNKNOWN_VALUE) return 'blocked_missing_conformance';
  if (!known(asObject(refs.stabilityBaseline).baselineFingerprint) || asObject(refs.stabilityBaseline).baselineFingerprint === UNKNOWN_VALUE) return 'blocked_missing_stability_baseline';
  if (baselineValidation.valid !== true) return 'not_certified';
  if (asObject(refs.conformanceReport).valid !== true) return 'blocked_missing_conformance';
  return Number(warningPropagation.warningCount || 0) > 0 ? 'certification_ready_with_warnings' : 'certification_ready';
}

function buildValidationStatus(bindingDraft = {}, pipelineValidation = {}, baselineValidation = {}) {
  const errors = [];
  const warnings = [];
  const missingRequiredReferences = [];
  const fingerprintViolations = [];
  const authorityViolations = [];
  const provenanceViolations = [];
  const readinessViolations = [];
  const compatibilityViolations = [];
  const refs = asObject(bindingDraft.decisionIntelligenceReferences);
  const requiredRefs = [
    ['decisionIntelligenceReferences.evidenceBundle.bundleFingerprint', asObject(refs.evidenceBundle).bundleFingerprint],
    ['decisionIntelligenceReferences.artifact.artifactFingerprint', asObject(refs.artifact).artifactFingerprint],
    ['decisionIntelligenceReferences.pipelineRun.pipelineFingerprint', asObject(refs.pipelineRun).pipelineFingerprint],
    ['decisionIntelligenceReferences.pipelineReport.reportFingerprint', asObject(refs.pipelineReport).reportFingerprint]
  ];

  for (const [field, value] of requiredRefs) {
    if (!known(value) || value === UNKNOWN_VALUE) {
      errors.push(validationIssue('missing_required_reference', `${field} is required.`, field));
      missingRequiredReferences.push(field);
    }
  }
  if (pipelineValidation.valid !== true) {
    errors.push(validationIssue('pipeline_validation_failed', 'Decision Intelligence pipeline validation did not pass.', 'decisionIntelligenceReferences.pipelineRun'));
    readinessViolations.push('pipelineRun');
  }
  if (baselineValidation.valid === false) {
    errors.push(validationIssue('stability_baseline_invalid', 'Decision Intelligence stability baseline validation failed.', 'decisionIntelligenceReferences.stabilityBaseline'));
    readinessViolations.push('stabilityBaseline');
  }
  for (const violation of asArray(pipelineValidation.fingerprintViolations)) fingerprintViolations.push(violation);
  for (const violation of asArray(pipelineValidation.authorityViolations)) authorityViolations.push(violation);
  for (const issue of asArray(pipelineValidation.warnings)) warnings.push({ ...issue, source: 'pipelineValidation' });
  for (const issue of asArray(baselineValidation.warnings)) warnings.push({ ...issue, source: 'stabilityBaseline' });
  if (!asArray(asObject(bindingDraft.provenance).inputFingerprints).length) {
    warnings.push(validationIssue('provenance_input_fingerprints_missing', 'Binding provenance should include input fingerprints.', 'provenance.inputFingerprints'));
    provenanceViolations.push('provenance.inputFingerprints');
  }
  if (asObject(bindingDraft.compatibility).governanceSchemaChangesRequired !== false) {
    errors.push(validationIssue('governance_schema_change_required', 'Binding must not require Governance schema changes.', 'compatibility.governanceSchemaChangesRequired'));
    compatibilityViolations.push('compatibility.governanceSchemaChangesRequired');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes: collectReasonCodes(errors, warnings),
    missingRequiredReferences: unique(missingRequiredReferences).sort(),
    fingerprintViolations: unique(fingerprintViolations).sort(),
    authorityViolations: unique(authorityViolations).sort(),
    provenanceViolations: unique(provenanceViolations).sort(),
    readinessViolations: unique(readinessViolations).sort(),
    compatibilityViolations: unique(compatibilityViolations).sort()
  };
}

function buildDecisionIntelligenceGovernanceBindingFingerprint(binding = {}) {
  const projection = clone(binding);
  delete projection.bindingFingerprint;
  return buildFingerprintFromProjection(projection);
}

function buildDecisionIntelligenceGovernanceBinding(input = {}, options = {}) {
  const source = asObject(input);
  const pipelineRun = asObject(firstDefined(source.pipelineRun, source.run));
  const baseline = asObject(firstDefined(source.stabilityBaseline, source.baseline));
  const certification = asObject(firstDefined(source.stabilityCertification, source.certification));
  const reviewPackage = asObject(firstDefined(source.reviewPackage, source.package));
  const pipelineValidation = validateDecisionIntelligencePipeline(pipelineRun);
  const baselineValidation = Object.keys(baseline).length ? validateDecisionIntelligencePipelineBaseline(baseline) : { valid: false, errors: [], warnings: [], reasonCodes: ['stability_baseline_not_supplied'] };
  const decisionIntelligenceReferences = buildDecisionReferences(pipelineRun, baseline, certification);
  const governanceReferences = buildGovernanceReferences(source.governanceReferences || source);
  const warningPropagation = collectWarnings(pipelineRun, baseline, certification);
  const listingId = normalizeString(firstDefined(source.listingId, asObject(asObject(pipelineRun.evidenceBundle).listingRef).listingId, asObject(reviewPackage).listingId));
  const reviewPackageId = normalizeString(firstDefined(source.reviewPackageId, reviewPackage.packageId, reviewPackage.id));
  const reviewPackageFingerprint = normalizeString(firstDefined(source.reviewPackageFingerprint, reviewPackage.packageFingerprint, reviewPackage.fingerprint));
  const core = {
    schemaVersion: DECISION_INTELLIGENCE_GOVERNANCE_BINDING_SCHEMA_VERSION,
    source: DECISION_INTELLIGENCE_GOVERNANCE_BINDING_SOURCE,
    bindingId: normalizeString(firstDefined(source.bindingId, options.bindingId, `decision-intelligence-governance-binding:${reviewPackageId === UNKNOWN_VALUE ? listingId : reviewPackageId}:${normalizeString(pipelineRun.runId)}`)),
    bindingType: DECISION_INTELLIGENCE_GOVERNANCE_BINDING_TYPE,
    bindingVersion: DECISION_INTELLIGENCE_GOVERNANCE_BINDING_VERSION,
    createdAt: normalizeDate(firstDefined(source.createdAt, options.createdAt, pipelineRun.createdAt)),
    asOf: normalizeDate(firstDefined(source.asOf, options.asOf, source.createdAt, pipelineRun.createdAt)),
    listingId,
    reviewPackageId,
    reviewPackageFingerprint,
    decisionIntelligenceReferences,
    governanceReferences,
    validationStatus: {},
    reviewReadiness: {},
    certificationReadiness: {},
    warningPropagation,
    provenance: {
      sourceSystem: 'decision_intelligence_governance_binding',
      builderName: DECISION_INTELLIGENCE_GOVERNANCE_BINDING_SOURCE,
      builderVersion: DECISION_INTELLIGENCE_GOVERNANCE_BINDING_VERSION,
      createdAt: normalizeDate(firstDefined(source.createdAt, options.createdAt, pipelineRun.createdAt)),
      inputArtifactIds: normalizeStringArray([
        asObject(decisionIntelligenceReferences.evidenceBundle).bundleId,
        asObject(decisionIntelligenceReferences.artifact).artifactId,
        asObject(decisionIntelligenceReferences.conformanceReport).conformanceReportId,
        asObject(decisionIntelligenceReferences.pipelineRun).runId,
        asObject(decisionIntelligenceReferences.pipelineReport).reportId,
        asObject(decisionIntelligenceReferences.stabilityBaseline).baselineId,
        asObject(decisionIntelligenceReferences.stabilityCertification).certificationId
      ]),
      inputFingerprints: normalizeStringArray([
        asObject(decisionIntelligenceReferences.evidenceBundle).bundleFingerprint,
        asObject(decisionIntelligenceReferences.artifact).artifactFingerprint,
        asObject(decisionIntelligenceReferences.conformanceReport).conformanceFingerprint,
        asObject(decisionIntelligenceReferences.pipelineRun).pipelineFingerprint,
        asObject(decisionIntelligenceReferences.pipelineReport).reportFingerprint,
        asObject(decisionIntelligenceReferences.stabilityBaseline).baselineFingerprint,
        asObject(decisionIntelligenceReferences.stabilityCertification).certificationFingerprint
      ]),
      governanceArtifactIds: normalizeStringArray(Object.values(governanceReferences).map((reference) => reference.sourceArtifactId)),
      governanceFingerprints: normalizeStringArray(Object.values(governanceReferences).map((reference) => reference.sourceFingerprint)),
      reviewPackageId,
      reviewPackageFingerprint
    },
    compatibility: {
      adapterOnly: true,
      offlineOnly: true,
      governanceSchemaChangesRequired: false,
      decisionIntelligenceArtifactMutationRequired: false,
      registryCompatible: true,
      lifecycleCompatible: true,
      reviewSessionCompatible: true,
      workspaceCompatible: true
    },
    auditHistory: asArray(firstDefined(source.auditHistory, [{
      eventId: 'binding-created',
      eventType: 'created',
      occurredAt: normalizeDate(firstDefined(source.createdAt, options.createdAt, pipelineRun.createdAt)),
      actor: normalizeString(firstDefined(source.actor, options.actor, 'offline_governance_tool')),
      details: {},
      productionImpact: 'none',
      decisionImpact: 'none',
      executionAuthority: 'none'
    }])).map((event) => ({
      eventId: normalizeString(event.eventId),
      eventType: normalizeString(event.eventType),
      occurredAt: normalizeDate(event.occurredAt),
      actor: normalizeString(event.actor),
      details: clone(asObject(event.details)),
      productionImpact: 'none',
      decisionImpact: 'none',
      executionAuthority: 'none'
    })),
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
  const validationStatus = buildValidationStatus(core, pipelineValidation, baselineValidation);
  const reviewStatus = determineReviewReadiness(pipelineValidation, warningPropagation);
  const certificationStatus = determineCertificationReadiness(decisionIntelligenceReferences, baselineValidation, warningPropagation);
  const complete = {
    ...core,
    validationStatus,
    reviewReadiness: {
      status: reviewStatus,
      ready: reviewStatus === 'review_ready' || reviewStatus === 'review_ready_with_warnings',
      reasonCodes: clone(validationStatus.reasonCodes),
      warningsVisible: warningPropagation.warningCount > 0
    },
    certificationReadiness: {
      status: certificationStatus,
      ready: certificationStatus === 'certification_ready' || certificationStatus === 'certification_ready_with_warnings',
      reasonCodes: clone(validationStatus.reasonCodes),
      warningsVisible: warningPropagation.warningCount > 0
    }
  };
  return deepFreeze({
    ...complete,
    bindingFingerprint: buildDecisionIntelligenceGovernanceBindingFingerprint(complete)
  });
}

function validateDecisionIntelligenceGovernanceBinding(binding = {}) {
  const input = asObject(binding);
  const errors = [];
  const warnings = [];
  const missingRequiredFields = [];
  const fingerprintViolations = [];
  const authorityViolations = [];
  const readinessViolations = [];
  for (const field of REQUIRED_BINDING_FIELDS) {
    if (!known(input[field])) {
      errors.push(validationIssue('missing_required_field', `${field} is required.`, field));
      missingRequiredFields.push(field);
    }
  }
  if (input.schemaVersion !== DECISION_INTELLIGENCE_GOVERNANCE_BINDING_SCHEMA_VERSION) {
    errors.push(validationIssue('invalid_schema_version', 'Binding schemaVersion is unsupported.', 'schemaVersion'));
  }
  if (input.source !== DECISION_INTELLIGENCE_GOVERNANCE_BINDING_SOURCE) {
    errors.push(validationIssue('invalid_source', 'Binding source is unsupported.', 'source'));
  }
  if (input.bindingType !== DECISION_INTELLIGENCE_GOVERNANCE_BINDING_TYPE) {
    errors.push(validationIssue('invalid_binding_type', 'Binding type must be decision_intelligence_pipeline_binding.', 'bindingType'));
  }
  for (const field of ['productionImpact', 'decisionImpact', 'executionAuthority']) {
    if (input[field] !== 'none') {
      errors.push(validationIssue('authority_boundary_violation', `${field} must remain none.`, field));
      authorityViolations.push(field);
    }
  }
  const serialized = JSON.stringify(input);
  if (serialized.includes('"executionAuthority":"approved"') || serialized.includes('"purchaseAuthority":"approved"')) {
    errors.push(validationIssue('forbidden_authority_value', 'Binding must not contain approved authority values.', 'binding'));
    authorityViolations.push('binding');
  }
  if (known(input.bindingFingerprint) && buildDecisionIntelligenceGovernanceBindingFingerprint(input) !== input.bindingFingerprint) {
    errors.push(validationIssue('binding_fingerprint_mismatch', 'bindingFingerprint does not match binding contents.', 'bindingFingerprint'));
    fingerprintViolations.push('bindingFingerprint');
  }
  const refs = asObject(input.decisionIntelligenceReferences);
  for (const [key, fingerprintField] of [
    ['evidenceBundle', 'bundleFingerprint'],
    ['artifact', 'artifactFingerprint'],
    ['pipelineRun', 'pipelineFingerprint'],
    ['pipelineReport', 'reportFingerprint']
  ]) {
    const value = asObject(refs[key])[fingerprintField];
    if (!known(value) || value === UNKNOWN_VALUE) {
      errors.push(validationIssue('missing_required_reference', `${key}.${fingerprintField} is required.`, `decisionIntelligenceReferences.${key}.${fingerprintField}`));
      missingRequiredFields.push(`decisionIntelligenceReferences.${key}.${fingerprintField}`);
    }
  }
  if (!['review_ready', 'review_ready_with_warnings'].includes(asObject(input.reviewReadiness).status)) {
    warnings.push(validationIssue('binding_not_review_ready', 'Binding is not review-ready.', 'reviewReadiness.status'));
    readinessViolations.push('reviewReadiness.status');
  }
  if (asObject(input.validationStatus).valid === false) {
    errors.push(validationIssue('binding_validation_status_failed', 'Binding validationStatus is failed.', 'validationStatus.valid'));
    readinessViolations.push('validationStatus.valid');
  }
  asArray(input.auditHistory).forEach((event, index) => {
    for (const field of ['productionImpact', 'decisionImpact', 'executionAuthority']) {
      if (event[field] !== 'none') {
        errors.push(validationIssue('audit_history_authority_violation', `auditHistory.${index}.${field} must remain none.`, `auditHistory.${index}.${field}`));
        authorityViolations.push(`auditHistory.${index}.${field}`);
      }
    }
  });
  for (const warning of asArray(asObject(input.validationStatus).warnings)) warnings.push(warning);
  return deepFreeze({
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes: collectReasonCodes(errors, warnings),
    missingRequiredFields: unique(missingRequiredFields).sort(),
    fingerprintViolations: unique(fingerprintViolations).sort(),
    authorityViolations: unique(authorityViolations).sort(),
    readinessViolations: unique(readinessViolations).sort()
  });
}

function summarizeDecisionIntelligenceGovernanceBinding(binding = {}) {
  const input = asObject(binding);
  const validation = validateDecisionIntelligenceGovernanceBinding(input);
  return deepFreeze({
    bindingId: normalizeString(input.bindingId),
    bindingType: normalizeString(input.bindingType),
    listingId: normalizeString(input.listingId),
    reviewPackageId: normalizeString(input.reviewPackageId),
    reviewReadinessStatus: normalizeString(asObject(input.reviewReadiness).status),
    certificationReadinessStatus: normalizeString(asObject(input.certificationReadiness).status),
    warningCount: Number(asObject(input.warningPropagation).warningCount || 0),
    decisionIntelligenceReferenceCount: Object.keys(asObject(input.decisionIntelligenceReferences)).length,
    governanceReferenceCount: Object.keys(asObject(input.governanceReferences)).length,
    valid: validation.valid,
    registryCompatible: asObject(input.compatibility).registryCompatible === true,
    lifecycleCompatible: asObject(input.compatibility).lifecycleCompatible === true,
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  });
}

function compareDecisionIntelligenceGovernanceBindings(left = {}, right = {}) {
  const leftBinding = asObject(left);
  const rightBinding = asObject(right);
  const fields = unique([...Object.keys(leftBinding), ...Object.keys(rightBinding)])
    .filter((field) => field !== 'bindingFingerprint')
    .sort();
  const fieldComparisons = [];
  const mismatches = [];
  for (const field of fields) {
    const equal = JSON.stringify(leftBinding[field]) === JSON.stringify(rightBinding[field]);
    fieldComparisons.push({
      field,
      status: equal ? 'match' : 'mismatch',
      leftValue: clone(leftBinding[field]),
      rightValue: clone(rightBinding[field])
    });
    if (!equal) {
      mismatches.push({
        field,
        reasonCode: 'binding_field_mismatch',
        leftFingerprint: field === 'decisionIntelligenceReferences' ? normalizeString(asObject(asObject(leftBinding.decisionIntelligenceReferences).pipelineRun).pipelineFingerprint) : UNKNOWN_VALUE,
        rightFingerprint: field === 'decisionIntelligenceReferences' ? normalizeString(asObject(asObject(rightBinding.decisionIntelligenceReferences).pipelineRun).pipelineFingerprint) : UNKNOWN_VALUE
      });
    }
  }
  const core = {
    schemaVersion: DECISION_INTELLIGENCE_GOVERNANCE_BINDING_SCHEMA_VERSION,
    source: DECISION_INTELLIGENCE_GOVERNANCE_BINDING_SOURCE,
    comparedAt: normalizeDate(firstDefined(leftBinding.createdAt, rightBinding.createdAt)),
    leftBindingId: normalizeString(leftBinding.bindingId),
    rightBindingId: normalizeString(rightBinding.bindingId),
    leftBindingFingerprint: normalizeString(leftBinding.bindingFingerprint),
    rightBindingFingerprint: normalizeString(rightBinding.bindingFingerprint),
    parityStatus: mismatches.length ? 'mismatch' : 'exact_match',
    mismatchCount: mismatches.length,
    fieldComparisons,
    mismatches,
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
  return deepFreeze({
    ...core,
    comparisonFingerprint: buildFingerprintFromProjection(core)
  });
}

module.exports = {
  DECISION_INTELLIGENCE_GOVERNANCE_BINDING_SCHEMA_VERSION,
  DECISION_INTELLIGENCE_GOVERNANCE_BINDING_SOURCE,
  DECISION_INTELLIGENCE_GOVERNANCE_BINDING_TYPE,
  REQUIRED_BINDING_FIELDS,
  buildDecisionIntelligenceGovernanceBinding,
  validateDecisionIntelligenceGovernanceBinding,
  summarizeDecisionIntelligenceGovernanceBinding,
  buildDecisionIntelligenceGovernanceBindingFingerprint,
  compareDecisionIntelligenceGovernanceBindings
};
