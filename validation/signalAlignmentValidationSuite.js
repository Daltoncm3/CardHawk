'use strict';

const { asArray, asObject, unique } = require('./canonicalValidationCore');
const { buildFingerprintFromProjection } = require('./fingerprintProjection');
const { clone, firstDefined } = require('./phase8GovernanceCore');
const { UNKNOWN_VALUE } = require('./canonicalIntelligenceSignalContract');
const {
  validateSignalRegistry,
  buildSignalRegistryFingerprint
} = require('./intelligenceSignalRegistry');
const {
  runSignalAlignmentBatch,
  validateSignalAlignmentRun,
  summarizeSignalAlignmentRun,
  buildSignalAlignmentRunFingerprint
} = require('./signalAlignmentEngine');
const {
  validateAlignmentBatch,
  summarizeAlignmentBatch,
  buildAlignmentBatchFingerprint
} = require('./signalAlignmentBatch');
const {
  analyzeSignalConflicts,
  validateConflictAnalysis,
  summarizeSignalConflicts,
  buildConflictAnalysisFingerprint
} = require('./signalConflictAnalyzer');
const {
  createSignalAlignmentReport,
  validateSignalAlignmentReport,
  summarizeSignalAlignmentReport,
  buildSignalAlignmentReportFingerprint
} = require('./signalAlignmentReport');

const SIGNAL_ALIGNMENT_VALIDATION_SUITE_SCHEMA_VERSION = '1.0.0';
const SIGNAL_ALIGNMENT_VALIDATION_SUITE_SOURCE = 'signal_alignment_validation_suite';

const VALIDATION_STAGE_NAMES = Object.freeze([
  'registry',
  'alignment_run',
  'alignment_batch',
  'conflict_analysis',
  'alignment_report',
  'authority_boundaries',
  'fingerprint_chain',
  'immutability',
  'unknown_value_preservation',
  'runtime_boundary'
]);

const REQUIRED_VALIDATION_SUITE_FIELDS = Object.freeze([
  'schemaVersion',
  'source',
  'suiteId',
  'createdAt',
  'scenarioCount',
  'stageResults',
  'pipelineSummary',
  'productionImpact',
  'decisionImpact',
  'executionAuthority',
  'suiteFingerprint'
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

function statusFromValidation(validation = {}) {
  return validation.valid ? 'passed' : 'failed';
}

function normalizeScenario(input = {}, index = 0, options = {}) {
  const scenario = asObject(input);
  return {
    scenarioId: normalizeString(firstDefined(scenario.scenarioId, scenario.id, `signal-alignment-validation-scenario-${index + 1}`)),
    description: normalizeString(firstDefined(scenario.description, 'deterministic signal alignment validation scenario')),
    registry: firstDefined(scenario.registry, options.registry),
    diagnostics: asArray(firstDefined(scenario.diagnostics, scenario.nativeOutputs, scenario.signals, [])),
    expected: asObject(scenario.expected),
    createdAt: normalizeDate(firstDefined(scenario.createdAt, options.createdAt, UNKNOWN_VALUE)),
    metadata: clone(asObject(scenario.metadata))
  };
}

function summarizeCounts(values = []) {
  const summary = {};
  for (const value of asArray(values)) {
    const key = normalizeString(value);
    summary[key] = (summary[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(summary).sort(([left], [right]) => left.localeCompare(right)));
}

function buildStageResult(stageName, validation = {}, extras = {}) {
  const errors = asArray(validation.errors);
  const warnings = asArray(validation.warnings);
  return deepFreeze({
    stageName,
    valid: errors.length === 0 && validation.valid !== false,
    status: errors.length === 0 && validation.valid !== false ? 'passed' : 'failed',
    errors: clone(errors),
    warnings: clone(warnings),
    reasonCodes: unique(asArray(validation.reasonCodes)).sort(),
    ...clone(extras)
  });
}

function buildAuthorityValidation(artifacts = {}) {
  const errors = [];
  const authorityViolations = [];
  for (const [artifactName, artifact] of Object.entries(artifacts)) {
    if (!artifact || artifact === UNKNOWN_VALUE) continue;
    for (const field of ['productionImpact', 'decisionImpact', 'executionAuthority']) {
      if (artifact[field] !== 'none') {
        const path = `${artifactName}.${field}`;
        errors.push(validationIssue('authority_boundary_violation', `${path} must remain none.`, path));
        authorityViolations.push(path);
      }
    }
  }
  return {
    valid: errors.length === 0,
    errors,
    warnings: [],
    reasonCodes: unique(errors.map((error) => error.code)).sort(),
    authorityViolations: unique(authorityViolations).sort()
  };
}

function buildFingerprintValidation(artifacts = {}) {
  const errors = [];
  const fingerprintViolations = [];

  if (artifacts.registry && artifacts.registry.registryFingerprint && buildSignalRegistryFingerprint(artifacts.registry) !== artifacts.registry.registryFingerprint) {
    errors.push(validationIssue('registry_fingerprint_mismatch', 'Registry fingerprint does not match registry contents.', 'registry.registryFingerprint'));
    fingerprintViolations.push('registry.registryFingerprint');
  }
  if (artifacts.alignmentRun && artifacts.alignmentRun.runFingerprint && buildSignalAlignmentRunFingerprint(artifacts.alignmentRun) !== artifacts.alignmentRun.runFingerprint) {
    errors.push(validationIssue('alignment_run_fingerprint_mismatch', 'Alignment run fingerprint does not match run contents.', 'alignmentRun.runFingerprint'));
    fingerprintViolations.push('alignmentRun.runFingerprint');
  }
  if (artifacts.alignmentBatch && artifacts.alignmentBatch.batchFingerprint && buildAlignmentBatchFingerprint(artifacts.alignmentBatch) !== artifacts.alignmentBatch.batchFingerprint) {
    errors.push(validationIssue('alignment_batch_fingerprint_mismatch', 'Alignment batch fingerprint does not match batch contents.', 'alignmentBatch.batchFingerprint'));
    fingerprintViolations.push('alignmentBatch.batchFingerprint');
  }
  if (artifacts.conflictAnalysis && artifacts.conflictAnalysis.analysisFingerprint && buildConflictAnalysisFingerprint(artifacts.conflictAnalysis) !== artifacts.conflictAnalysis.analysisFingerprint) {
    errors.push(validationIssue('conflict_analysis_fingerprint_mismatch', 'Conflict analysis fingerprint does not match analysis contents.', 'conflictAnalysis.analysisFingerprint'));
    fingerprintViolations.push('conflictAnalysis.analysisFingerprint');
  }
  if (artifacts.alignmentReport && artifacts.alignmentReport.reportFingerprint && buildSignalAlignmentReportFingerprint(artifacts.alignmentReport) !== artifacts.alignmentReport.reportFingerprint) {
    errors.push(validationIssue('alignment_report_fingerprint_mismatch', 'Alignment report fingerprint does not match report contents.', 'alignmentReport.reportFingerprint'));
    fingerprintViolations.push('alignmentReport.reportFingerprint');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings: [],
    reasonCodes: unique(errors.map((error) => error.code)).sort(),
    fingerprintViolations: unique(fingerprintViolations).sort()
  };
}

function containsUnknownValue(value) {
  if (value === UNKNOWN_VALUE) return true;
  if (!value || typeof value !== 'object') return false;
  return Object.values(value).some((nested) => containsUnknownValue(nested));
}

function buildUnknownValueValidation(scenario = {}, artifacts = {}) {
  const expectsUnknown = Boolean(scenario.expected && scenario.expected.preserveUnknownValues);
  const hasUnknown = containsUnknownValue(artifacts.alignmentRun)
    || containsUnknownValue(artifacts.conflictAnalysis)
    || containsUnknownValue(artifacts.alignmentReport);
  const errors = [];
  if (expectsUnknown && !hasUnknown) {
    errors.push(validationIssue('unknown_value_not_preserved', 'Expected unknown values were not preserved through the pipeline.', 'expected.preserveUnknownValues'));
  }
  return {
    valid: errors.length === 0,
    errors,
    warnings: [],
    reasonCodes: unique(errors.map((error) => error.code)).sort()
  };
}

function buildImmutabilityValidation(before = {}, after = {}, scenarioId = UNKNOWN_VALUE) {
  const errors = [];
  if (JSON.stringify(before.registry) !== JSON.stringify(after.registry)) {
    errors.push(validationIssue('registry_mutated', 'Scenario registry was mutated during validation.', `scenarios.${scenarioId}.registry`));
  }
  if (JSON.stringify(before.diagnostics) !== JSON.stringify(after.diagnostics)) {
    errors.push(validationIssue('diagnostics_mutated', 'Scenario diagnostics were mutated during validation.', `scenarios.${scenarioId}.diagnostics`));
  }
  return {
    valid: errors.length === 0,
    errors,
    warnings: [],
    reasonCodes: unique(errors.map((error) => error.code)).sort()
  };
}

function buildRuntimeBoundaryValidation() {
  return {
    valid: true,
    errors: [],
    warnings: [],
    reasonCodes: [],
    runtimeIntegration: false,
    executesIntelligenceEngines: false,
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
}

function runScenario(input = {}, index = 0, options = {}) {
  const scenario = normalizeScenario(input, index, options);
  const before = {
    registry: clone(scenario.registry || null),
    diagnostics: clone(scenario.diagnostics)
  };
  const alignmentRun = runSignalAlignmentBatch({
    alignmentRunId: normalizeString(firstDefined(scenario.alignmentRunId, `${scenario.scenarioId}:alignment-run`)),
    alignmentBatchId: normalizeString(firstDefined(scenario.alignmentBatchId, `${scenario.scenarioId}:alignment-batch`)),
    adaptationBatchId: normalizeString(firstDefined(scenario.adaptationBatchId, `${scenario.scenarioId}:adaptation-batch`)),
    createdAt: scenario.createdAt,
    registry: scenario.registry,
    diagnostics: scenario.diagnostics
  });
  const alignmentBatch = alignmentRun.alignmentBatch;
  const conflictAnalysis = analyzeSignalConflicts({
    analysisId: normalizeString(firstDefined(scenario.conflictAnalysisId, `${scenario.scenarioId}:conflict-analysis`)),
    createdAt: scenario.createdAt,
    alignmentRun
  });
  const alignmentReport = createSignalAlignmentReport({
    reportId: normalizeString(firstDefined(scenario.reportId, `${scenario.scenarioId}:alignment-report`)),
    createdAt: scenario.createdAt,
    alignmentRun,
    conflictAnalysis
  });
  const after = {
    registry: scenario.registry,
    diagnostics: scenario.diagnostics
  };

  const registryValidation = scenario.registry ? validateSignalRegistry(scenario.registry) : {
    valid: false,
    errors: [validationIssue('registry_missing', 'Registry is required for complete pipeline validation.', 'registry')],
    warnings: [],
    reasonCodes: ['registry_missing']
  };
  const runValidation = validateSignalAlignmentRun(alignmentRun);
  const batchValidation = validateAlignmentBatch(alignmentBatch);
  const conflictValidation = validateConflictAnalysis(conflictAnalysis);
  const reportValidation = validateSignalAlignmentReport(alignmentReport);
  const authorityValidation = buildAuthorityValidation({
    registry: scenario.registry,
    alignmentRun,
    alignmentBatch,
    conflictAnalysis,
    alignmentReport
  });
  const fingerprintValidation = buildFingerprintValidation({
    registry: scenario.registry,
    alignmentRun,
    alignmentBatch,
    conflictAnalysis,
    alignmentReport
  });
  const immutabilityValidation = buildImmutabilityValidation(before, after, scenario.scenarioId);
  const unknownValidation = buildUnknownValueValidation(scenario, {
    alignmentRun,
    conflictAnalysis,
    alignmentReport
  });
  const runtimeValidation = buildRuntimeBoundaryValidation();

  const stageResults = [
    buildStageResult('registry', registryValidation, {
      registryId: normalizeString(scenario.registry && scenario.registry.registryId),
      registryFingerprint: normalizeString(scenario.registry && scenario.registry.registryFingerprint)
    }),
    buildStageResult('alignment_run', runValidation, {
      alignmentRunId: alignmentRun.alignmentRunId,
      alignmentRunFingerprint: alignmentRun.runFingerprint,
      adaptedSignalCount: alignmentRun.adaptedSignalCount,
      alignedSignalCount: alignmentRun.alignedSignalCount,
      blockedSignalCount: alignmentRun.blockedSignalCount
    }),
    buildStageResult('alignment_batch', batchValidation, {
      alignmentBatchId: alignmentBatch.alignmentBatchId,
      alignmentBatchFingerprint: alignmentBatch.batchFingerprint,
      summary: summarizeAlignmentBatch(alignmentBatch)
    }),
    buildStageResult('conflict_analysis', conflictValidation, {
      conflictAnalysisId: conflictAnalysis.analysisId,
      conflictAnalysisFingerprint: conflictAnalysis.analysisFingerprint,
      summary: summarizeSignalConflicts(conflictAnalysis)
    }),
    buildStageResult('alignment_report', reportValidation, {
      reportId: alignmentReport.reportId,
      reportFingerprint: alignmentReport.reportFingerprint,
      summary: summarizeSignalAlignmentReport(alignmentReport)
    }),
    buildStageResult('authority_boundaries', authorityValidation),
    buildStageResult('fingerprint_chain', fingerprintValidation),
    buildStageResult('immutability', immutabilityValidation),
    buildStageResult('unknown_value_preservation', unknownValidation),
    buildStageResult('runtime_boundary', runtimeValidation)
  ];
  const errors = stageResults.flatMap((stage) => asArray(stage.errors).map((error) => ({ ...error, stageName: stage.stageName })));
  const warnings = stageResults.flatMap((stage) => asArray(stage.warnings).map((warning) => ({ ...warning, stageName: stage.stageName })));

  return deepFreeze({
    scenarioId: scenario.scenarioId,
    description: scenario.description,
    valid: errors.length === 0,
    status: errors.length === 0 ? 'passed' : 'failed',
    stageResults,
    artifacts: {
      alignmentRun,
      alignmentBatch,
      conflictAnalysis,
      alignmentReport
    },
    summaries: {
      alignmentRun: summarizeSignalAlignmentRun(alignmentRun),
      alignmentBatch: summarizeAlignmentBatch(alignmentBatch),
      conflictAnalysis: summarizeSignalConflicts(conflictAnalysis),
      alignmentReport: summarizeSignalAlignmentReport(alignmentReport)
    },
    errors,
    warnings,
    reasonCodes: unique([...errors.map((error) => error.code), ...warnings.map((warning) => warning.code)]).sort(),
    metadata: clone(scenario.metadata),
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  });
}

function buildPipelineSummary(scenarioResults = []) {
  const results = asArray(scenarioResults);
  const stageResults = results.flatMap((scenario) => asArray(scenario.stageResults));
  const alignmentReports = results.map((scenario) => scenario.artifacts && scenario.artifacts.alignmentReport).filter(Boolean);
  const conflictAnalyses = results.map((scenario) => scenario.artifacts && scenario.artifacts.conflictAnalysis).filter(Boolean);
  const alignmentRuns = results.map((scenario) => scenario.artifacts && scenario.artifacts.alignmentRun).filter(Boolean);
  return deepFreeze({
    schemaVersion: SIGNAL_ALIGNMENT_VALIDATION_SUITE_SCHEMA_VERSION,
    scenarioCount: results.length,
    validScenarioCount: results.filter((scenario) => scenario.valid).length,
    invalidScenarioCount: results.filter((scenario) => !scenario.valid).length,
    stageCount: stageResults.length,
    failedStageCount: stageResults.filter((stage) => !stage.valid).length,
    stageStatusSummary: summarizeCounts(stageResults.map((stage) => `${stage.stageName}:${stage.status}`)),
    adaptedSignalCount: alignmentRuns.reduce((sum, run) => sum + Number(run.adaptedSignalCount || 0), 0),
    alignedSignalCount: alignmentRuns.reduce((sum, run) => sum + Number(run.alignedSignalCount || 0), 0),
    blockedSignalCount: alignmentRuns.reduce((sum, run) => sum + Number(run.blockedSignalCount || 0), 0),
    reportCount: alignmentReports.length,
    conflictRelationshipCount: conflictAnalyses.reduce((sum, analysis) => sum + Number(analysis.relationshipCount || 0), 0),
    reviewStatusSummary: summarizeCounts(alignmentReports.map((report) => report.reviewStatus)),
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  });
}

function collectValidation(suite = {}) {
  const errors = [];
  const warnings = [];
  const authorityViolations = [];
  const fingerprintViolations = [];
  const missing = REQUIRED_VALIDATION_SUITE_FIELDS.filter((field) => {
    const value = suite[field];
    return value === undefined || value === null || value === '';
  });

  for (const field of missing) errors.push(validationIssue('missing_required_field', `${field} is required.`, field));
  if (suite.schemaVersion !== SIGNAL_ALIGNMENT_VALIDATION_SUITE_SCHEMA_VERSION) errors.push(validationIssue('invalid_schema_version', 'schemaVersion must match Signal Alignment Validation Suite schema.', 'schemaVersion'));
  if (suite.source !== SIGNAL_ALIGNMENT_VALIDATION_SUITE_SOURCE) errors.push(validationIssue('invalid_source', 'source must be signal_alignment_validation_suite.', 'source'));
  if (!Array.isArray(suite.scenarioResults)) errors.push(validationIssue('invalid_scenario_results', 'scenarioResults must be an array.', 'scenarioResults'));
  if (!Array.isArray(suite.stageResults)) errors.push(validationIssue('invalid_stage_results', 'stageResults must be an array.', 'stageResults'));
  if (suite.scenarioCount !== asArray(suite.scenarioResults).length) errors.push(validationIssue('scenario_count_mismatch', 'scenarioCount must match scenarioResults length.', 'scenarioCount'));

  for (const field of ['productionImpact', 'decisionImpact', 'executionAuthority']) {
    if (suite[field] !== 'none') {
      errors.push(validationIssue('authority_boundary_violation', `${field} must remain none.`, field));
      authorityViolations.push(field);
    }
  }

  asArray(suite.stageResults).forEach((stage, index) => {
    if (!VALIDATION_STAGE_NAMES.includes(stage.stageName)) {
      errors.push(validationIssue('unknown_validation_stage', `Unsupported validation stage ${stage.stageName}.`, `stageResults.${index}.stageName`));
    }
    if (!stage.valid) {
      errors.push(...asArray(stage.errors).map((error) => ({ ...error, field: `stageResults.${index}.${error.field || ''}` })));
    }
    authorityViolations.push(...asArray(stage.authorityViolations).map((field) => `stageResults.${index}.${field}`));
    fingerprintViolations.push(...asArray(stage.fingerprintViolations).map((field) => `stageResults.${index}.${field}`));
  });

  asArray(suite.scenarioResults).forEach((scenario, index) => {
    if (!scenario.valid) {
      errors.push(...asArray(scenario.errors).map((error) => ({ ...error, field: `scenarioResults.${index}.${error.field || ''}` })));
    }
  });

  if (suite.suiteFingerprint && buildValidationSuiteFingerprint(suite) !== suite.suiteFingerprint) {
    errors.push(validationIssue('suite_fingerprint_mismatch', 'suiteFingerprint does not match suite contents.', 'suiteFingerprint'));
    fingerprintViolations.push('suiteFingerprint');
  }

  const reasonCodes = unique([...errors.map((error) => error.code), ...warnings.map((warning) => warning.code)]);
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes,
    stageResults: clone(asArray(suite.stageResults)),
    pipelineSummary: clone(suite.pipelineSummary || {}),
    authorityViolations: unique(authorityViolations).sort(),
    fingerprintViolations: unique(fingerprintViolations).sort()
  };
}

function buildValidationSuiteFingerprint(suite = {}) {
  const projection = clone(suite);
  delete projection.suiteFingerprint;
  delete projection.signalAlignmentValidationSuiteFingerprint;
  return buildFingerprintFromProjection(projection);
}

function validateSignalAlignmentPipeline(input = {}, options = {}) {
  const scenarios = Array.isArray(input)
    ? input
    : asArray(firstDefined(input.scenarios, input.validationScenarios, []));
  const scenarioResults = scenarios.map((scenario, index) => runScenario(scenario, index, options));
  const stageResults = scenarioResults.flatMap((scenario) => asArray(scenario.stageResults).map((stage) => ({
    ...clone(stage),
    scenarioId: scenario.scenarioId
  })));
  const pipelineSummary = buildPipelineSummary(scenarioResults);
  const core = {
    schemaVersion: SIGNAL_ALIGNMENT_VALIDATION_SUITE_SCHEMA_VERSION,
    source: SIGNAL_ALIGNMENT_VALIDATION_SUITE_SOURCE,
    suiteId: normalizeString(firstDefined(input.suiteId, options.suiteId, 'signal-alignment-validation-suite')),
    createdAt: normalizeDate(firstDefined(input.createdAt, options.createdAt, UNKNOWN_VALUE)),
    scenarioCount: scenarioResults.length,
    scenarioResults,
    stageResults,
    pipelineSummary,
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none',
    metadata: clone(asObject(input.metadata))
  };
  const prevalidated = {
    ...core,
    suiteFingerprint: buildValidationSuiteFingerprint(core)
  };
  const withValidation = {
    ...core,
    validation: collectValidation(prevalidated)
  };
  return deepFreeze({
    ...withValidation,
    suiteFingerprint: buildValidationSuiteFingerprint(withValidation)
  });
}

function runSignalAlignmentValidationSuite(input = {}, options = {}) {
  return validateSignalAlignmentPipeline(input, options);
}

function summarizeValidationSuite(suite = {}) {
  const summary = buildPipelineSummary(asArray(suite.scenarioResults));
  return deepFreeze({
    ...summary,
    suiteId: normalizeString(suite.suiteId),
    valid: Boolean(suite.validation && suite.validation.valid),
    reasonCodes: unique(asArray(suite.validation && suite.validation.reasonCodes)).sort(),
    authorityViolationCount: asArray(suite.validation && suite.validation.authorityViolations).length,
    fingerprintViolationCount: asArray(suite.validation && suite.validation.fingerprintViolations).length
  });
}

module.exports = {
  REQUIRED_VALIDATION_SUITE_FIELDS,
  SIGNAL_ALIGNMENT_VALIDATION_SUITE_SCHEMA_VERSION,
  SIGNAL_ALIGNMENT_VALIDATION_SUITE_SOURCE,
  VALIDATION_STAGE_NAMES,
  buildValidationSuiteFingerprint,
  runSignalAlignmentValidationSuite,
  summarizeValidationSuite,
  validateSignalAlignmentPipeline
};
