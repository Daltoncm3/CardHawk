'use strict';

const { asArray, asObject, unique } = require('./canonicalValidationCore');
const { buildFingerprintFromProjection } = require('./fingerprintProjection');
const { clone, firstDefined } = require('./phase8GovernanceCore');
const {
  buildDecisionIntelligenceEvidenceBundle,
  validateDecisionIntelligenceEvidenceBundle,
  summarizeDecisionIntelligenceEvidenceBundle,
  buildDecisionIntelligenceEvidenceBundleFingerprint
} = require('./decisionIntelligenceEvidenceBundle');
const {
  buildDecisionIntelligenceArtifact,
  validateDecisionIntelligenceArtifact,
  summarizeDecisionArtifact,
  buildDecisionIntelligenceArtifactFingerprint
} = require('./decisionIntelligenceArtifactBuilder');
const {
  validateDecisionIntelligenceArtifactConformance,
  summarizeDecisionIntelligenceConformance,
  compareDecisionIntelligenceArtifacts
} = require('./decisionIntelligenceArtifactConformance');

const DECISION_INTELLIGENCE_PIPELINE_SCHEMA_VERSION = 'decision_intelligence_pipeline.v1';
const DECISION_INTELLIGENCE_PIPELINE_SOURCE = 'decision_intelligence_pipeline_orchestrator';
const UNKNOWN_VALUE = 'unknown';

const PIPELINE_STAGES = Object.freeze([
  'evidence_bundle_build',
  'evidence_bundle_validation',
  'artifact_build',
  'artifact_validation',
  'artifact_conformance',
  'pipeline_report'
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

function validationIssue(code, message, field = '') {
  return { code, message, field };
}

function summarizeIssues(errors = [], warnings = []) {
  return unique([...asArray(errors), ...asArray(warnings)].map((issue) => issue.code)).sort();
}

function stableEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function buildDecisionIntelligencePipelineFingerprint(value = {}) {
  const projection = clone(value);
  delete projection.pipelineFingerprint;
  delete projection.reportFingerprint;
  return buildFingerprintFromProjection(projection);
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
    reasonCodes: summarizeIssues(errors, warnings),
    ...clone(asObject(extras))
  });
}

function buildDecisionIntelligencePipelineReport(run = {}) {
  const input = asObject(run);
  const evidenceBundle = asObject(input.evidenceBundle);
  const artifact = asObject(input.decisionArtifact);
  const bundleValidation = asObject(input.evidenceBundleValidation);
  const artifactValidation = asObject(input.artifactValidation);
  const conformanceReport = asObject(input.artifactConformance);
  const bundleSummary = input.evidenceBundleSummary || summarizeDecisionIntelligenceEvidenceBundle(evidenceBundle);
  const artifactSummary = input.artifactSummary || summarizeDecisionArtifact(artifact);
  const conformanceSummary = input.conformanceSummary || summarizeDecisionIntelligenceConformance(conformanceReport);

  const stageResults = [
    stageResult('evidence_bundle_build', { valid: known(evidenceBundle.bundleFingerprint), errors: [] }, {
      bundleId: normalizeString(evidenceBundle.bundleId),
      bundleFingerprint: normalizeString(evidenceBundle.bundleFingerprint)
    }),
    stageResult('evidence_bundle_validation', bundleValidation, {
      bundleId: normalizeString(evidenceBundle.bundleId),
      readyForArtifactBuilder: bundleSummary.readyForArtifactBuilder === true
    }),
    stageResult('artifact_build', { valid: known(artifact.artifactFingerprint), errors: [] }, {
      artifactId: normalizeString(artifact.artifactId),
      artifactFingerprint: normalizeString(artifact.artifactFingerprint)
    }),
    stageResult('artifact_validation', artifactValidation, {
      artifactId: normalizeString(artifact.artifactId)
    }),
    stageResult('artifact_conformance', conformanceReport, {
      conformanceReportId: normalizeString(conformanceReport.conformanceReportId),
      readyForGovernanceBinding: conformanceSummary.readyForGovernanceBinding === true
    })
  ];
  const failedStages = stageResults.filter((stage) => stage.valid === false);
  const warningStages = stageResults.filter((stage) => asArray(stage.warnings).length > 0);
  const errors = stageResults.flatMap((stage) => asArray(stage.errors).map((error) => ({ ...error, stageName: stage.stageName })));
  const warnings = stageResults.flatMap((stage) => asArray(stage.warnings).map((warning) => ({ ...warning, stageName: stage.stageName })));
  const core = {
    schemaVersion: DECISION_INTELLIGENCE_PIPELINE_SCHEMA_VERSION,
    source: DECISION_INTELLIGENCE_PIPELINE_SOURCE,
    reportId: normalizeString(firstDefined(input.reportId, `decision-intelligence-pipeline-report:${normalizeString(evidenceBundle.bundleId)}`)),
    runId: normalizeString(input.runId),
    createdAt: normalizeDate(firstDefined(input.createdAt, evidenceBundle.createdAt, artifact.createdAt)),
    evidenceBundleId: normalizeString(evidenceBundle.bundleId),
    evidenceBundleFingerprint: normalizeString(evidenceBundle.bundleFingerprint),
    artifactId: normalizeString(artifact.artifactId),
    artifactFingerprint: normalizeString(artifact.artifactFingerprint),
    conformanceReportId: normalizeString(conformanceReport.conformanceReportId),
    conformanceFingerprint: normalizeString(conformanceReport.conformanceFingerprint),
    stageResults,
    pipelineDiagnostics: {
      valid: failedStages.length === 0,
      stageCount: stageResults.length,
      passedStageCount: stageResults.length - failedStages.length,
      failedStageCount: failedStages.length,
      warningStageCount: warningStages.length,
      reasonCodes: unique(stageResults.flatMap((stage) => asArray(stage.reasonCodes))).sort(),
      evidenceGapCount: bundleSummary.evidenceGapCount,
      blockingEvidenceGapCount: bundleSummary.blockingEvidenceGapCount,
      unknownValueCount: bundleSummary.unknownValueCount,
      signalReferenceCount: bundleSummary.signalReferenceCount,
      readyForArtifactBuilder: bundleSummary.readyForArtifactBuilder === true,
      readyForGovernanceReview: failedStages.length === 0,
      readyForGovernanceBinding: conformanceSummary.readyForGovernanceBinding === true
    },
    bundleSummary: clone(bundleSummary),
    artifactSummary: clone(artifactSummary),
    conformanceSummary: clone(conformanceSummary),
    errors,
    warnings,
    reasonCodes: summarizeIssues(errors, warnings),
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };

  return deepFreeze({
    ...core,
    reportFingerprint: buildDecisionIntelligencePipelineFingerprint(core)
  });
}

function runDecisionIntelligencePipeline(input = {}, options = {}) {
  const evidenceBundle = buildDecisionIntelligenceEvidenceBundle(input);
  const evidenceBundleValidation = validateDecisionIntelligenceEvidenceBundle(evidenceBundle);
  const evidenceBundleSummary = summarizeDecisionIntelligenceEvidenceBundle(evidenceBundle);
  const decisionArtifact = buildDecisionIntelligenceArtifact(evidenceBundle.builderInput);
  const artifactValidation = validateDecisionIntelligenceArtifact(decisionArtifact);
  const artifactSummary = summarizeDecisionArtifact(decisionArtifact);
  const artifactConformance = validateDecisionIntelligenceArtifactConformance(decisionArtifact, {
    sourceInput: evidenceBundle.builderInput,
    conformanceReportId: firstDefined(options.conformanceReportId, `decision-intelligence-conformance:${decisionArtifact.artifactId}`),
    createdAt: firstDefined(options.createdAt, evidenceBundle.createdAt)
  });
  const conformanceSummary = summarizeDecisionIntelligenceConformance(artifactConformance);
  const baseRun = {
    schemaVersion: DECISION_INTELLIGENCE_PIPELINE_SCHEMA_VERSION,
    source: DECISION_INTELLIGENCE_PIPELINE_SOURCE,
    runId: normalizeString(firstDefined(options.runId, input.runId, `decision-intelligence-pipeline:${evidenceBundle.bundleId}`)),
    createdAt: normalizeDate(firstDefined(options.createdAt, input.createdAt, evidenceBundle.createdAt)),
    evidenceBundle,
    evidenceBundleValidation,
    evidenceBundleSummary,
    decisionArtifact,
    artifactValidation,
    artifactSummary,
    artifactConformance,
    conformanceSummary,
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
  const pipelineReport = buildDecisionIntelligencePipelineReport(baseRun);
  const run = {
    ...baseRun,
    pipelineReport
  };
  return deepFreeze({
    ...run,
    pipelineFingerprint: buildDecisionIntelligencePipelineFingerprint(run)
  });
}

function validateDecisionIntelligencePipeline(run = {}) {
  const input = asObject(run);
  const errors = [];
  const warnings = [];
  const authorityViolations = [];
  const fingerprintViolations = [];
  const stageViolations = [];
  const missingRequiredFields = [];
  const requiredFields = [
    'schemaVersion',
    'source',
    'runId',
    'createdAt',
    'evidenceBundle',
    'evidenceBundleValidation',
    'decisionArtifact',
    'artifactValidation',
    'artifactConformance',
    'pipelineReport',
    'pipelineFingerprint'
  ];

  for (const field of requiredFields) {
    if (!known(input[field])) {
      errors.push(validationIssue('missing_required_field', `${field} is required.`, field));
      missingRequiredFields.push(field);
    }
  }
  if (input.schemaVersion !== DECISION_INTELLIGENCE_PIPELINE_SCHEMA_VERSION) {
    errors.push(validationIssue('invalid_schema_version', 'schemaVersion must match the Decision Intelligence Pipeline contract.', 'schemaVersion'));
  }
  if (input.source !== DECISION_INTELLIGENCE_PIPELINE_SOURCE) {
    errors.push(validationIssue('invalid_source', 'source must be decision_intelligence_pipeline_orchestrator.', 'source'));
  }
  for (const field of ['productionImpact', 'decisionImpact', 'executionAuthority']) {
    if (input[field] !== 'none') {
      errors.push(validationIssue('authority_boundary_violation', `${field} must remain none.`, field));
      authorityViolations.push(field);
    }
  }

  const bundleValidation = validateDecisionIntelligenceEvidenceBundle(input.evidenceBundle);
  const artifactValidation = validateDecisionIntelligenceArtifact(input.decisionArtifact);
  const conformance = validateDecisionIntelligenceArtifactConformance(input.decisionArtifact, {
    sourceInput: asObject(input.evidenceBundle).builderInput,
    conformanceReportId: asObject(input.artifactConformance).conformanceReportId,
    createdAt: asObject(input.artifactConformance).createdAt
  });
  const report = buildDecisionIntelligencePipelineReport({
    ...input,
    evidenceBundleValidation: bundleValidation,
    evidenceBundleSummary: summarizeDecisionIntelligenceEvidenceBundle(input.evidenceBundle),
    artifactValidation,
    artifactSummary: summarizeDecisionArtifact(input.decisionArtifact),
    artifactConformance: conformance,
    conformanceSummary: summarizeDecisionIntelligenceConformance(conformance),
    reportId: asObject(input.pipelineReport).reportId
  });

  if (!bundleValidation.valid) stageViolations.push('evidence_bundle_validation');
  if (!artifactValidation.valid) stageViolations.push('artifact_validation');
  if (!conformance.valid) stageViolations.push('artifact_conformance');
  if (!stableEqual(asObject(input.evidenceBundleValidation), bundleValidation)) {
    errors.push(validationIssue('bundle_validation_mismatch', 'Stored bundle validation does not match current validation.', 'evidenceBundleValidation'));
    stageViolations.push('evidence_bundle_validation');
  }
  if (!stableEqual(asObject(input.artifactValidation), artifactValidation)) {
    errors.push(validationIssue('artifact_validation_mismatch', 'Stored artifact validation does not match current validation.', 'artifactValidation'));
    stageViolations.push('artifact_validation');
  }
  if (!stableEqual(asObject(input.artifactConformance), conformance)) {
    errors.push(validationIssue('artifact_conformance_mismatch', 'Stored conformance report does not match current conformance validation.', 'artifactConformance'));
    stageViolations.push('artifact_conformance');
  }
  if (!stableEqual(asObject(input.pipelineReport), report)) {
    errors.push(validationIssue('pipeline_report_mismatch', 'Pipeline report does not match current pipeline state.', 'pipelineReport'));
    fingerprintViolations.push('pipelineReport');
  }
  if (known(asObject(input.evidenceBundle).bundleFingerprint) && buildDecisionIntelligenceEvidenceBundleFingerprint(input.evidenceBundle) !== input.evidenceBundle.bundleFingerprint) {
    errors.push(validationIssue('bundle_fingerprint_mismatch', 'Evidence Bundle fingerprint does not match bundle contents.', 'evidenceBundle.bundleFingerprint'));
    fingerprintViolations.push('evidenceBundle.bundleFingerprint');
  }
  if (known(asObject(input.decisionArtifact).artifactFingerprint) && buildDecisionIntelligenceArtifactFingerprint(input.decisionArtifact) !== input.decisionArtifact.artifactFingerprint) {
    errors.push(validationIssue('artifact_fingerprint_mismatch', 'Decision Intelligence Artifact fingerprint does not match artifact contents.', 'decisionArtifact.artifactFingerprint'));
    fingerprintViolations.push('decisionArtifact.artifactFingerprint');
  }
  if (known(input.pipelineFingerprint) && buildDecisionIntelligencePipelineFingerprint({ ...input, pipelineReport: input.pipelineReport }) !== input.pipelineFingerprint) {
    errors.push(validationIssue('pipeline_fingerprint_mismatch', 'pipelineFingerprint does not match pipeline contents.', 'pipelineFingerprint'));
    fingerprintViolations.push('pipelineFingerprint');
  }
  if (asObject(input.evidenceBundle).productionImpact !== 'none' || asObject(input.decisionArtifact).productionImpact !== 'none') {
    errors.push(validationIssue('nested_authority_boundary_violation', 'Nested Decision Intelligence artifacts must remain non-authoritative.', 'authority'));
    authorityViolations.push('nestedArtifacts');
  }

  const allWarnings = [
    ...warnings,
    ...asArray(bundleValidation.warnings).map((warning) => ({ ...warning, stageName: 'evidence_bundle_validation' })),
    ...asArray(artifactValidation.warnings).map((warning) => ({ ...warning, stageName: 'artifact_validation' })),
    ...asArray(conformance.warnings).map((warning) => ({ ...warning, stageName: 'artifact_conformance' }))
  ];
  const allErrors = [
    ...errors,
    ...asArray(bundleValidation.errors).map((error) => ({ ...error, stageName: 'evidence_bundle_validation' })),
    ...asArray(artifactValidation.errors).map((error) => ({ ...error, stageName: 'artifact_validation' })),
    ...asArray(conformance.errors).map((error) => ({ ...error, stageName: 'artifact_conformance' }))
  ];

  return deepFreeze({
    valid: allErrors.length === 0,
    errors: allErrors,
    warnings: allWarnings,
    reasonCodes: summarizeIssues(allErrors, allWarnings),
    missingRequiredFields: unique(missingRequiredFields).sort(),
    authorityViolations: unique(authorityViolations).sort(),
    fingerprintViolations: unique(fingerprintViolations).sort(),
    stageViolations: unique(stageViolations).sort(),
    pipelineDiagnostics: clone(asObject(report.pipelineDiagnostics))
  });
}

function summarizeDecisionIntelligencePipeline(run = {}) {
  const input = asObject(run);
  const validation = validateDecisionIntelligencePipeline(input);
  const report = asObject(input.pipelineReport);
  const diagnostics = asObject(report.pipelineDiagnostics);
  return deepFreeze({
    runId: normalizeString(input.runId),
    evidenceBundleId: normalizeString(asObject(input.evidenceBundle).bundleId),
    decisionArtifactId: normalizeString(asObject(input.decisionArtifact).artifactId),
    reportId: normalizeString(report.reportId),
    valid: validation.valid,
    stageCount: diagnostics.stageCount || 0,
    failedStageCount: diagnostics.failedStageCount || validation.stageViolations.length,
    warningStageCount: diagnostics.warningStageCount || 0,
    evidenceGapCount: diagnostics.evidenceGapCount || 0,
    unknownValueCount: diagnostics.unknownValueCount || 0,
    readyForGovernanceReview: diagnostics.readyForGovernanceReview === true && validation.valid === true,
    readyForGovernanceBinding: diagnostics.readyForGovernanceBinding === true && validation.valid === true,
    reasonCodes: clone(validation.reasonCodes),
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  });
}

function compareDecisionIntelligencePipelineRuns(left = {}, right = {}) {
  const leftRun = asObject(left);
  const rightRun = asObject(right);
  const fields = unique([...Object.keys(leftRun), ...Object.keys(rightRun)])
    .filter((field) => field !== 'pipelineFingerprint')
    .sort();
  const fieldComparisons = [];
  const mismatches = [];
  for (const field of fields) {
    const equal = stableEqual(leftRun[field], rightRun[field]);
    fieldComparisons.push({
      field,
      status: equal ? 'match' : 'mismatch',
      leftValue: clone(leftRun[field]),
      rightValue: clone(rightRun[field])
    });
    if (!equal) {
      mismatches.push({
        field,
        reasonCode: 'pipeline_field_mismatch',
        leftFingerprint: field === 'decisionArtifact' ? normalizeString(asObject(leftRun.decisionArtifact).artifactFingerprint) : UNKNOWN_VALUE,
        rightFingerprint: field === 'decisionArtifact' ? normalizeString(asObject(rightRun.decisionArtifact).artifactFingerprint) : UNKNOWN_VALUE
      });
    }
  }
  const artifactComparison = compareDecisionIntelligenceArtifacts(leftRun.decisionArtifact, rightRun.decisionArtifact);
  const core = {
    schemaVersion: DECISION_INTELLIGENCE_PIPELINE_SCHEMA_VERSION,
    source: DECISION_INTELLIGENCE_PIPELINE_SOURCE,
    comparedAt: normalizeDate(firstDefined(leftRun.createdAt, rightRun.createdAt)),
    leftRunId: normalizeString(leftRun.runId),
    rightRunId: normalizeString(rightRun.runId),
    leftPipelineFingerprint: normalizeString(leftRun.pipelineFingerprint),
    rightPipelineFingerprint: normalizeString(rightRun.pipelineFingerprint),
    parityStatus: mismatches.length ? 'mismatch' : 'exact_match',
    mismatchCount: mismatches.length,
    fieldComparisons,
    mismatches,
    artifactComparison,
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
  DECISION_INTELLIGENCE_PIPELINE_SCHEMA_VERSION,
  DECISION_INTELLIGENCE_PIPELINE_SOURCE,
  PIPELINE_STAGES,
  runDecisionIntelligencePipeline,
  validateDecisionIntelligencePipeline,
  buildDecisionIntelligencePipelineReport,
  summarizeDecisionIntelligencePipeline,
  compareDecisionIntelligencePipelineRuns
};
