'use strict';

const { asArray, asObject, unique } = require('./canonicalValidationCore');
const { buildFingerprintFromProjection } = require('./fingerprintProjection');
const { clone, firstDefined } = require('./phase8GovernanceCore');
const {
  DECISION_INTELLIGENCE_EVIDENCE_BUNDLE_SCHEMA_VERSION,
  DECISION_INTELLIGENCE_EVIDENCE_BUNDLE_SOURCE,
  buildDecisionIntelligenceEvidenceBundle,
  validateDecisionIntelligenceEvidenceBundle,
  summarizeDecisionIntelligenceEvidenceBundle,
  buildDecisionIntelligenceEvidenceBundleFingerprint
} = require('./decisionIntelligenceEvidenceBundle');
const {
  DECISION_INTELLIGENCE_ARTIFACT_SCHEMA_VERSION,
  DECISION_INTELLIGENCE_ARTIFACT_SOURCE,
  EXPECTED_SIGNAL_NAMES,
  buildDecisionIntelligenceArtifact,
  validateDecisionIntelligenceArtifact,
  summarizeDecisionArtifact,
  buildDecisionIntelligenceArtifactFingerprint
} = require('./decisionIntelligenceArtifactBuilder');
const {
  DECISION_INTELLIGENCE_CONFORMANCE_SCHEMA_VERSION,
  DECISION_INTELLIGENCE_CONFORMANCE_SOURCE,
  CONFORMANCE_STAGES,
  validateDecisionIntelligenceArtifactConformance,
  summarizeDecisionIntelligenceConformance
} = require('./decisionIntelligenceArtifactConformance');
const {
  DECISION_INTELLIGENCE_PIPELINE_SCHEMA_VERSION,
  DECISION_INTELLIGENCE_PIPELINE_SOURCE,
  PIPELINE_STAGES,
  runDecisionIntelligencePipeline,
  validateDecisionIntelligencePipeline,
  summarizeDecisionIntelligencePipeline
} = require('./decisionIntelligencePipelineOrchestrator');

const DECISION_INTELLIGENCE_PIPELINE_BASELINE_SCHEMA_VERSION = 'decision_intelligence_pipeline_stability_baseline.v1';
const DECISION_INTELLIGENCE_PIPELINE_BASELINE_SOURCE = 'decision_intelligence_pipeline_stability_baseline';
const DECISION_INTELLIGENCE_PIPELINE_CERTIFICATION_SOURCE = 'decision_intelligence_pipeline_stability_certification';
const UNKNOWN_VALUE = 'unknown';

const CERTIFICATION_STATUSES = Object.freeze([
  'certified_offline',
  'certified_with_warnings',
  'not_certified',
  'invalid',
  UNKNOWN_VALUE
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

function validationIssue(code, message, field = '') {
  return { code, message, field };
}

function collectReasonCodes(errors = [], warnings = []) {
  return unique([...asArray(errors), ...asArray(warnings)].map((issue) => issue.code)).sort();
}

function statusFromValidation(validation = {}) {
  const input = asObject(validation);
  if (!Object.keys(input).length) return 'missing';
  return input.valid === true ? 'passed' : 'failed';
}

function validationSummary(validation = {}) {
  const input = asObject(validation);
  return {
    valid: input.valid === true,
    status: statusFromValidation(input),
    reasonCodes: asArray(input.reasonCodes).slice().sort(),
    errorCount: asArray(input.errors).length,
    warningCount: asArray(input.warnings).length,
    fingerprintViolations: clone(asArray(input.fingerprintViolations)),
    authorityViolations: clone(asArray(input.authorityViolations)),
    stageViolations: clone(asArray(input.stageViolations))
  };
}

function buildComponentInventory() {
  return [
    {
      componentKey: 'evidenceBundle',
      componentName: 'Decision Intelligence Evidence Bundle',
      schemaVersion: DECISION_INTELLIGENCE_EVIDENCE_BUNDLE_SCHEMA_VERSION,
      source: DECISION_INTELLIGENCE_EVIDENCE_BUNDLE_SOURCE,
      publicApis: [
        'buildDecisionIntelligenceEvidenceBundle',
        'validateDecisionIntelligenceEvidenceBundle',
        'summarizeDecisionIntelligenceEvidenceBundle',
        'buildDecisionIntelligenceEvidenceBundleFingerprint',
        'compareDecisionIntelligenceEvidenceBundles'
      ]
    },
    {
      componentKey: 'artifactBuilder',
      componentName: 'Decision Intelligence Artifact Builder',
      schemaVersion: DECISION_INTELLIGENCE_ARTIFACT_SCHEMA_VERSION,
      source: DECISION_INTELLIGENCE_ARTIFACT_SOURCE,
      publicApis: [
        'buildDecisionIntelligenceArtifact',
        'validateDecisionIntelligenceArtifact',
        'deriveDecisionEvidence',
        'deriveDecisionConfidence',
        'deriveDecisionExplanation',
        'summarizeDecisionArtifact'
      ]
    },
    {
      componentKey: 'artifactConformance',
      componentName: 'Decision Intelligence Artifact Conformance',
      schemaVersion: DECISION_INTELLIGENCE_CONFORMANCE_SCHEMA_VERSION,
      source: DECISION_INTELLIGENCE_CONFORMANCE_SOURCE,
      publicApis: [
        'validateDecisionIntelligenceArtifactConformance',
        'buildDecisionIntelligenceConformanceReport',
        'summarizeDecisionIntelligenceConformance',
        'compareDecisionIntelligenceArtifacts'
      ]
    },
    {
      componentKey: 'pipelineOrchestrator',
      componentName: 'Decision Intelligence Pipeline Orchestrator',
      schemaVersion: DECISION_INTELLIGENCE_PIPELINE_SCHEMA_VERSION,
      source: DECISION_INTELLIGENCE_PIPELINE_SOURCE,
      publicApis: [
        'runDecisionIntelligencePipeline',
        'validateDecisionIntelligencePipeline',
        'buildDecisionIntelligencePipelineReport',
        'summarizeDecisionIntelligencePipeline',
        'compareDecisionIntelligencePipelineRuns'
      ]
    }
  ]
    .map((component) => ({
      ...component,
      publicApis: component.publicApis.slice().sort(),
      productionImpact: 'none',
      decisionImpact: 'none',
      executionAuthority: 'none'
    }))
    .sort((left, right) => left.componentKey.localeCompare(right.componentKey));
}

function buildApiInventory(componentInventory = []) {
  return asArray(componentInventory)
    .flatMap((component) => asArray(component.publicApis).map((apiName) => ({
      componentKey: component.componentKey,
      apiName,
      authority: 'offline_advisory_only'
    })))
    .sort((left, right) => `${left.componentKey}|${left.apiName}`.localeCompare(`${right.componentKey}|${right.apiName}`));
}

function buildStatusSummary(run = {}, validations = {}) {
  const summaries = {
    evidenceBundle: validationSummary(validations.evidenceBundleValidation),
    artifactBuilder: validationSummary(validations.artifactValidation),
    artifactConformance: validationSummary(validations.artifactConformance),
    pipelineOrchestrator: validationSummary(validations.pipelineValidation)
  };
  const failedComponents = Object.entries(summaries)
    .filter(([, summary]) => summary.status !== 'passed')
    .map(([componentKey]) => componentKey)
    .sort();
  const warningCount = Object.values(summaries).reduce((total, summary) => total + Number(summary.warningCount || 0), 0);
  const errorCount = Object.values(summaries).reduce((total, summary) => total + Number(summary.errorCount || 0), 0);
  const reasonCodes = unique(Object.values(summaries).flatMap((summary) => asArray(summary.reasonCodes))).sort();
  return {
    componentValidationSummary: summaries,
    componentCount: Object.keys(summaries).length,
    passedComponentCount: Object.keys(summaries).length - failedComponents.length,
    failedComponentCount: failedComponents.length,
    failedComponents,
    warningCount,
    errorCount,
    reasonCodes,
    allComponentsPassed: failedComponents.length === 0,
    pipelineRunId: normalizeString(run.runId),
    pipelineFingerprint: normalizeString(run.pipelineFingerprint),
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
}

function buildCrossComponentIntegrity(run = {}, validations = {}) {
  const evidenceBundle = asObject(run.evidenceBundle);
  const artifact = asObject(run.decisionArtifact);
  const conformance = asObject(run.artifactConformance);
  const report = asObject(run.pipelineReport);
  const errors = [];
  const warnings = [];
  const fingerprintChecks = [
    {
      name: 'evidence_bundle_fingerprint',
      expected: buildDecisionIntelligenceEvidenceBundleFingerprint(evidenceBundle),
      actual: evidenceBundle.bundleFingerprint
    },
    {
      name: 'artifact_fingerprint',
      expected: buildDecisionIntelligenceArtifactFingerprint(artifact),
      actual: artifact.artifactFingerprint
    },
    {
      name: 'report_evidence_bundle_binding',
      expected: evidenceBundle.bundleFingerprint,
      actual: report.evidenceBundleFingerprint
    },
    {
      name: 'report_artifact_binding',
      expected: artifact.artifactFingerprint,
      actual: report.artifactFingerprint
    },
    {
      name: 'report_conformance_binding',
      expected: conformance.conformanceFingerprint,
      actual: report.conformanceFingerprint
    }
  ].map((check) => ({
    ...check,
    status: known(check.actual) && check.actual === check.expected ? 'passed' : 'failed'
  }));
  const failedChecks = fingerprintChecks.filter((check) => check.status === 'failed');
  for (const check of failedChecks) {
    errors.push(validationIssue('cross_component_fingerprint_mismatch', `${check.name} did not match.`, check.name));
  }
  if (asObject(validations.pipelineValidation).valid !== true) {
    errors.push(validationIssue('pipeline_validation_failed', 'Pipeline validation did not pass.', 'pipelineValidation'));
  }
  if (asArray(evidenceBundle.unknownValues).length || asArray(evidenceBundle.evidenceGaps).length) {
    warnings.push(validationIssue('visible_uncertainty_preserved', 'Evidence gaps or unknown values remain visible in the baseline.', 'evidenceBundle'));
  }
  return deepFreeze({
    valid: errors.length === 0,
    status: errors.length === 0 ? 'passed' : 'failed',
    fingerprintChecks,
    errors,
    warnings,
    reasonCodes: collectReasonCodes(errors, warnings),
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  });
}

function buildBoundaryStatus(run = {}) {
  const serialized = JSON.stringify(run);
  const authorityViolations = [];
  if (asObject(run).productionImpact !== 'none') authorityViolations.push('run.productionImpact');
  if (asObject(run).decisionImpact !== 'none') authorityViolations.push('run.decisionImpact');
  if (asObject(run).executionAuthority !== 'none') authorityViolations.push('run.executionAuthority');
  if (asObject(run.evidenceBundle).productionImpact !== 'none') authorityViolations.push('evidenceBundle.productionImpact');
  if (asObject(run.decisionArtifact).productionImpact !== 'none') authorityViolations.push('decisionArtifact.productionImpact');
  if (serialized.includes('"purchaseAuthority":"approved"') || serialized.includes('"executionAuthority":"approved"')) {
    authorityViolations.push('forbidden_authority_value');
  }
  return {
    advisoryOnlyBoundaryStatus: authorityViolations.length ? 'failed' : 'passed',
    offlineBoundaryStatus: serialized.includes('"runtimeIntegration":"enabled"') ? 'failed' : 'passed',
    authorityViolations: unique(authorityViolations).sort(),
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
}

function normalizeStringList(values = []) {
  return unique(asArray(values).map((value) => normalizeString(value, '')).filter(Boolean)).sort();
}

function buildDecisionIntelligencePipelineBaseline(input = {}, options = {}) {
  const source = asObject(input);
  const run = source.pipelineRun || runDecisionIntelligencePipeline(firstDefined(source.pipelineInput, source), {
    runId: firstDefined(source.runId, options.runId),
    createdAt: firstDefined(source.createdAt, options.createdAt),
    conformanceReportId: firstDefined(source.conformanceReportId, options.conformanceReportId)
  });
  const validations = {
    evidenceBundleValidation: validateDecisionIntelligenceEvidenceBundle(run.evidenceBundle),
    artifactValidation: validateDecisionIntelligenceArtifact(run.decisionArtifact),
    artifactConformance: validateDecisionIntelligenceArtifactConformance(run.decisionArtifact, {
      sourceInput: asObject(run.evidenceBundle).builderInput,
      conformanceReportId: asObject(run.artifactConformance).conformanceReportId,
      createdAt: asObject(run.artifactConformance).createdAt
    }),
    pipelineValidation: validateDecisionIntelligencePipeline(run)
  };
  const componentInventory = buildComponentInventory();
  const apiInventory = buildApiInventory(componentInventory);
  const statusSummary = buildStatusSummary(run, validations);
  const crossComponentIntegrity = buildCrossComponentIntegrity(run, validations);
  const boundaryStatus = buildBoundaryStatus(run);
  const warnings = unique([
    ...normalizeStringList(firstDefined(source.warnings, options.warnings)),
    ...asArray(crossComponentIntegrity.warnings).map((warning) => warning.code),
    ...statusSummary.reasonCodes.filter((code) => code.includes('warning') || code.includes('missing'))
  ]).sort();
  const knownArchitecturalLimitations = normalizeStringList(firstDefined(source.knownArchitecturalLimitations, options.knownArchitecturalLimitations, [
    'Evidence is consumed by reference only.',
    'Decision Intelligence remains advisory and does not authorize BUY_NOW.',
    'Future production integration requires Governance review and explicit Dalton approval.'
  ]));
  const core = {
    schemaVersion: DECISION_INTELLIGENCE_PIPELINE_BASELINE_SCHEMA_VERSION,
    source: DECISION_INTELLIGENCE_PIPELINE_BASELINE_SOURCE,
    baselineId: normalizeString(firstDefined(source.baselineId, options.baselineId, `decision-intelligence-pipeline-baseline:${run.runId}`)),
    createdAt: normalizeDate(firstDefined(source.createdAt, options.createdAt, run.createdAt)),
    componentInventory,
    publicApiInventory: apiInventory,
    evidenceBundleStatus: validationSummary(validations.evidenceBundleValidation),
    artifactBuilderStatus: validationSummary(validations.artifactValidation),
    artifactConformanceStatus: validationSummary(validations.artifactConformance),
    pipelineOrchestratorStatus: validationSummary(validations.pipelineValidation),
    crossComponentIntegrity,
    deterministicFingerprintValidation: {
      status: crossComponentIntegrity.status,
      fingerprintChecks: clone(crossComponentIntegrity.fingerprintChecks),
      pipelineFingerprint: normalizeString(run.pipelineFingerprint),
      evidenceBundleFingerprint: normalizeString(asObject(run.evidenceBundle).bundleFingerprint),
      artifactFingerprint: normalizeString(asObject(run.decisionArtifact).artifactFingerprint),
      reportFingerprint: normalizeString(asObject(run.pipelineReport).reportFingerprint)
    },
    advisoryOnlyBoundaryVerification: {
      status: boundaryStatus.advisoryOnlyBoundaryStatus,
      authorityViolations: clone(boundaryStatus.authorityViolations),
      productionImpact: 'none',
      decisionImpact: 'none',
      executionAuthority: 'none'
    },
    offlineBoundaryVerification: {
      status: boundaryStatus.offlineBoundaryStatus,
      runtimeIntegration: 'none',
      productionRuntimeInvoked: false
    },
    pipelineRunSummary: summarizeDecisionIntelligencePipeline(run),
    evidenceBundleSummary: summarizeDecisionIntelligenceEvidenceBundle(run.evidenceBundle),
    decisionArtifactSummary: summarizeDecisionArtifact(run.decisionArtifact),
    conformanceSummary: summarizeDecisionIntelligenceConformance(run.artifactConformance),
    statusSummary,
    testMetadata: clone(asObject(firstDefined(source.testMetadata, options.testMetadata, {}))),
    warnings,
    knownArchitecturalLimitations,
    futureIntegrationReadiness: {
      suitableForGovernanceReview: statusSummary.allComponentsPassed === true,
      suitableForProductionAuthority: false,
      requiredNextGate: 'governance_review_and_explicit_dalton_approval',
      productionAuthorityStatement: 'Decision Intelligence certification is evidence-only and does not grant production authority.'
    },
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
  return deepFreeze({
    ...core,
    baselineFingerprint: buildDecisionIntelligencePipelineBaselineFingerprint(core)
  });
}

function buildDecisionIntelligencePipelineBaselineFingerprint(baseline = {}) {
  const projection = clone(baseline);
  delete projection.baselineFingerprint;
  return buildFingerprintFromProjection(projection);
}

function validateDecisionIntelligencePipelineBaseline(baseline = {}) {
  const input = asObject(baseline);
  const errors = [];
  const warnings = [];
  const missingRequiredFields = [];
  const fingerprintViolations = [];
  const authorityViolations = [];
  const statusViolations = [];
  const requiredFields = [
    'schemaVersion',
    'source',
    'baselineId',
    'createdAt',
    'componentInventory',
    'publicApiInventory',
    'evidenceBundleStatus',
    'artifactBuilderStatus',
    'artifactConformanceStatus',
    'pipelineOrchestratorStatus',
    'crossComponentIntegrity',
    'deterministicFingerprintValidation',
    'advisoryOnlyBoundaryVerification',
    'offlineBoundaryVerification',
    'statusSummary',
    'testMetadata',
    'warnings',
    'knownArchitecturalLimitations',
    'futureIntegrationReadiness',
    'productionImpact',
    'decisionImpact',
    'executionAuthority',
    'baselineFingerprint'
  ];

  for (const field of requiredFields) {
    if (!known(input[field])) {
      errors.push(validationIssue('missing_required_field', `${field} is required.`, field));
      missingRequiredFields.push(field);
    }
  }
  if (input.schemaVersion !== DECISION_INTELLIGENCE_PIPELINE_BASELINE_SCHEMA_VERSION) {
    errors.push(validationIssue('invalid_baseline_schema_version', 'Baseline schemaVersion is unsupported.', 'schemaVersion'));
  }
  if (input.source !== DECISION_INTELLIGENCE_PIPELINE_BASELINE_SOURCE) {
    errors.push(validationIssue('invalid_baseline_source', 'Baseline source is unsupported.', 'source'));
  }
  for (const field of ['productionImpact', 'decisionImpact', 'executionAuthority']) {
    if (input[field] !== 'none') {
      errors.push(validationIssue('authority_boundary_violation', `${field} must remain none.`, field));
      authorityViolations.push(field);
    }
  }
  if (asObject(input.advisoryOnlyBoundaryVerification).status !== 'passed') {
    errors.push(validationIssue('advisory_boundary_failed', 'Advisory-only boundary verification must pass.', 'advisoryOnlyBoundaryVerification.status'));
    statusViolations.push('advisoryOnlyBoundaryVerification');
  }
  if (asObject(input.offlineBoundaryVerification).status !== 'passed') {
    errors.push(validationIssue('offline_boundary_failed', 'Offline boundary verification must pass.', 'offlineBoundaryVerification.status'));
    statusViolations.push('offlineBoundaryVerification');
  }
  if (asObject(input.crossComponentIntegrity).status !== 'passed') {
    errors.push(validationIssue('cross_component_integrity_failed', 'Cross-component integrity must pass.', 'crossComponentIntegrity.status'));
    statusViolations.push('crossComponentIntegrity');
  }
  if (asObject(input.statusSummary).allComponentsPassed !== true) {
    errors.push(validationIssue('component_validation_failed', 'All Decision Intelligence components must pass baseline validation.', 'statusSummary'));
    statusViolations.push('statusSummary');
  }
  if (known(input.baselineFingerprint) && buildDecisionIntelligencePipelineBaselineFingerprint(input) !== input.baselineFingerprint) {
    errors.push(validationIssue('baseline_fingerprint_mismatch', 'Baseline fingerprint does not match baseline contents.', 'baselineFingerprint'));
    fingerprintViolations.push('baselineFingerprint');
  }
  if (asArray(input.warnings).length > 0 || asArray(input.knownArchitecturalLimitations).length > 0) {
    warnings.push(validationIssue('baseline_contains_visible_warnings', 'Baseline preserves warnings or known limitations.', 'warnings'));
  }

  return deepFreeze({
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes: collectReasonCodes(errors, warnings),
    missingRequiredFields: unique(missingRequiredFields).sort(),
    fingerprintViolations: unique(fingerprintViolations).sort(),
    authorityViolations: unique(authorityViolations).sort(),
    statusViolations: unique(statusViolations).sort()
  });
}

function compareDecisionIntelligencePipelineBaselines(left = {}, right = {}) {
  const leftBaseline = asObject(left);
  const rightBaseline = asObject(right);
  const fields = [
    'schemaVersion',
    'source',
    'componentInventory',
    'publicApiInventory',
    'evidenceBundleStatus',
    'artifactBuilderStatus',
    'artifactConformanceStatus',
    'pipelineOrchestratorStatus',
    'crossComponentIntegrity',
    'deterministicFingerprintValidation',
    'advisoryOnlyBoundaryVerification',
    'offlineBoundaryVerification',
    'statusSummary',
    'warnings',
    'knownArchitecturalLimitations',
    'futureIntegrationReadiness',
    'productionImpact',
    'decisionImpact',
    'executionAuthority'
  ];
  const differences = fields.filter((field) => JSON.stringify(leftBaseline[field]) !== JSON.stringify(rightBaseline[field])).sort();
  const core = {
    schemaVersion: DECISION_INTELLIGENCE_PIPELINE_BASELINE_SCHEMA_VERSION,
    source: DECISION_INTELLIGENCE_PIPELINE_BASELINE_SOURCE,
    comparedAt: normalizeDate(firstDefined(leftBaseline.createdAt, rightBaseline.createdAt)),
    leftBaselineId: normalizeString(leftBaseline.baselineId),
    rightBaselineId: normalizeString(rightBaseline.baselineId),
    leftBaselineFingerprint: normalizeString(leftBaseline.baselineFingerprint),
    rightBaselineFingerprint: normalizeString(rightBaseline.baselineFingerprint),
    parityStatus: differences.length ? 'mismatch' : 'exact_match',
    equal: differences.length === 0,
    differences,
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
  return deepFreeze({
    ...core,
    comparisonFingerprint: buildFingerprintFromProjection(core)
  });
}

function certificationStatusForBaseline(baseline = {}) {
  const validation = validateDecisionIntelligencePipelineBaseline(baseline);
  if (!validation.valid) return 'invalid';
  if (asObject(baseline.statusSummary).allComponentsPassed !== true) return 'not_certified';
  if (asArray(baseline.warnings).length > 0 || asArray(baseline.knownArchitecturalLimitations).length > 0) return 'certified_with_warnings';
  return 'certified_offline';
}

function buildDecisionIntelligencePipelineCertification(baseline = {}, options = {}) {
  const status = certificationStatusForBaseline(baseline);
  const baselineValidation = validateDecisionIntelligencePipelineBaseline(baseline);
  const core = {
    schemaVersion: DECISION_INTELLIGENCE_PIPELINE_BASELINE_SCHEMA_VERSION,
    source: DECISION_INTELLIGENCE_PIPELINE_CERTIFICATION_SOURCE,
    certificationId: normalizeString(firstDefined(options.certificationId, `decision-intelligence-pipeline-certification:${asObject(baseline).baselineId}`)),
    createdAt: normalizeDate(firstDefined(options.createdAt, asObject(baseline).createdAt)),
    baselineId: normalizeString(asObject(baseline).baselineId),
    baselineFingerprint: normalizeString(asObject(baseline).baselineFingerprint),
    certificationStatus: status,
    certified: status === 'certified_offline' || status === 'certified_with_warnings',
    baselineValidationStatus: baselineValidation.valid ? 'passed' : 'failed',
    componentStatusSummary: clone(asObject(baseline.statusSummary)),
    crossComponentIntegrityStatus: normalizeString(asObject(baseline.crossComponentIntegrity).status),
    deterministicFingerprintStatus: normalizeString(asObject(baseline.deterministicFingerprintValidation).status),
    advisoryOnlyBoundaryStatus: normalizeString(asObject(baseline.advisoryOnlyBoundaryVerification).status),
    offlineBoundaryStatus: normalizeString(asObject(baseline.offlineBoundaryVerification).status),
    warnings: clone(asArray(baseline.warnings)),
    knownArchitecturalLimitations: clone(asArray(baseline.knownArchitecturalLimitations)),
    futureIntegrationReadiness: clone(asObject(baseline.futureIntegrationReadiness)),
    certificationRules: {
      evidenceOnly: true,
      offlineOnly: true,
      nonAuthoritative: true,
      productionApprovalGranted: false,
      purchaseAuthorityGranted: false,
      warningsRemainVisible: true,
      failedValidationBlocksCertification: true,
      productionAuthorityStatement: 'Decision Intelligence certification does not grant production authority; production authority remains governed separately and requires explicit Dalton approval.'
    },
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
  return deepFreeze({
    ...core,
    certificationFingerprint: buildFingerprintFromProjection(core)
  });
}

function summarizeDecisionIntelligencePipelineBaseline(baseline = {}) {
  const input = asObject(baseline);
  return deepFreeze({
    schemaVersion: DECISION_INTELLIGENCE_PIPELINE_BASELINE_SCHEMA_VERSION,
    source: DECISION_INTELLIGENCE_PIPELINE_BASELINE_SOURCE,
    baselineId: normalizeString(input.baselineId),
    componentCount: asArray(input.componentInventory).length,
    publicApiCount: asArray(input.publicApiInventory).length,
    passedComponentCount: Number(asObject(input.statusSummary).passedComponentCount || 0),
    failedComponentCount: Number(asObject(input.statusSummary).failedComponentCount || 0),
    warningCount: Number(asObject(input.statusSummary).warningCount || 0) + asArray(input.warnings).length,
    crossComponentIntegrityStatus: normalizeString(asObject(input.crossComponentIntegrity).status),
    deterministicFingerprintStatus: normalizeString(asObject(input.deterministicFingerprintValidation).status),
    advisoryOnlyBoundaryStatus: normalizeString(asObject(input.advisoryOnlyBoundaryVerification).status),
    offlineBoundaryStatus: normalizeString(asObject(input.offlineBoundaryVerification).status),
    certificationStatus: certificationStatusForBaseline(input),
    suitableForGovernanceReview: asObject(input.futureIntegrationReadiness).suitableForGovernanceReview === true,
    suitableForProductionAuthority: false,
    baselineFingerprint: normalizeString(input.baselineFingerprint),
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  });
}

module.exports = {
  CERTIFICATION_STATUSES,
  DECISION_INTELLIGENCE_PIPELINE_BASELINE_SCHEMA_VERSION,
  DECISION_INTELLIGENCE_PIPELINE_BASELINE_SOURCE,
  DECISION_INTELLIGENCE_PIPELINE_CERTIFICATION_SOURCE,
  buildDecisionIntelligencePipelineBaseline,
  validateDecisionIntelligencePipelineBaseline,
  compareDecisionIntelligencePipelineBaselines,
  buildDecisionIntelligencePipelineCertification,
  summarizeDecisionIntelligencePipelineBaseline
};
