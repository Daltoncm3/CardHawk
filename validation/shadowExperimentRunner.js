'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
  asArray,
  asObject,
  unique
} = require('./canonicalValidationCore');
const {
  buildFingerprintFromProjection
} = require('./fingerprintProjection');
const {
  clone,
  firstDefined
} = require('./phase8GovernanceCore');
const shadowExperimentContract = require('./shadowExperimentContract');
const calibrationExperimentContract = require('./calibrationExperimentContract');
const calibrationExperimentRunner = require('./calibrationExperimentRunner');

const SHADOW_RESULT_SCHEMA_VERSION = '1.0.0';
const SHADOW_EXPERIMENT_RUNNER_SOURCE = 'shadow_experiment_runner';
const UNKNOWN_VALUE = 'unknown';

const REQUIRED_SHADOW_RESULT_FIELDS = Object.freeze([
  'schemaVersion',
  'source',
  'shadowResultId',
  'shadowExperimentId',
  'createdAt',
  'sourceExperimentIds',
  'sourceExperimentFingerprints',
  'sourceOfflineResultFingerprints',
  'productionBaselineMetrics',
  'shadowMetrics',
  'comparisonMetrics',
  'improvements',
  'regressions',
  'statisticalSummary',
  'successEvaluation',
  'failureEvaluation',
  'regressionEvaluation',
  'recommendation',
  'limitations',
  'observationSummary',
  'productionImpact',
  'decisionImpact',
  'shadowResultFingerprint'
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

function normalizeStringArray(values = []) {
  return unique(asArray(values).map((value) => normalizeString(value, '')).filter(Boolean)).sort();
}

function validationFailure(code, message, field = '') {
  return { code, message, field };
}

function readMetric(source = {}, pathValue = '') {
  if (source && typeof source === 'object' && Object.prototype.hasOwnProperty.call(source, pathValue)) {
    return source[pathValue];
  }
  const parts = String(pathValue || '').split('.').filter(Boolean);
  let current = source;
  for (const part of parts) {
    if (!current || typeof current !== 'object' || !(part in current)) return undefined;
    current = current[part];
  }
  return current;
}

function flattenMetricPaths(object = {}, prefix = '') {
  const paths = [];
  for (const [key, value] of Object.entries(asObject(object))) {
    const pathValue = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      paths.push(...flattenMetricPaths(value, pathValue));
    } else {
      paths.push(pathValue);
    }
  }
  return paths.sort();
}

function compareMetricValues(baselineValue, shadowValue) {
  const baselineNumber = Number(baselineValue);
  const shadowNumber = Number(shadowValue);
  if (Number.isFinite(baselineNumber) && Number.isFinite(shadowNumber)) {
    return Number((shadowNumber - baselineNumber).toFixed(6));
  }
  if (baselineValue === shadowValue) return 0;
  return UNKNOWN_VALUE;
}

function buildMetricComparison(productionBaselineMetrics = {}, shadowMetrics = {}) {
  const paths = unique([
    ...flattenMetricPaths(productionBaselineMetrics),
    ...flattenMetricPaths(shadowMetrics)
  ]).sort();

  return paths.map((metric) => {
    const productionBaselineValue = readMetric(productionBaselineMetrics, metric);
    const shadowValue = readMetric(shadowMetrics, metric);
    return {
      metric,
      productionBaselineValue: productionBaselineValue === undefined ? UNKNOWN_VALUE : clone(productionBaselineValue),
      shadowValue: shadowValue === undefined ? UNKNOWN_VALUE : clone(shadowValue),
      delta: productionBaselineValue === undefined || shadowValue === undefined
        ? UNKNOWN_VALUE
        : compareMetricValues(productionBaselineValue, shadowValue)
    };
  });
}

function normalizeCriterionRule(rule) {
  if (rule && typeof rule === 'object' && !Array.isArray(rule)) return rule;
  return { equals: rule };
}

function evaluateCriterionSet(criteria = {}, metrics = {}, options = {}) {
  const evaluations = [];
  for (const metric of Object.keys(asObject(criteria)).sort()) {
    const rule = normalizeCriterionRule(criteria[metric]);
    const actual = readMetric(metrics, metric);
    const actualNumber = Number(actual);
    const actualUnknown = actual === undefined || actual === UNKNOWN_VALUE;
    const failures = [];

    if (actualUnknown) failures.push('metric_unknown');
    if (!actualUnknown && 'min' in rule && (!Number.isFinite(actualNumber) || actualNumber < Number(rule.min))) failures.push('below_minimum');
    if (!actualUnknown && 'max' in rule && (!Number.isFinite(actualNumber) || actualNumber > Number(rule.max))) failures.push('above_maximum');
    if (!actualUnknown && 'equals' in rule && actual !== rule.equals) failures.push('not_equal');
    if (!actualUnknown && 'notEquals' in rule && actual === rule.notEquals) failures.push('equals_disallowed_value');

    evaluations.push({
      metric,
      rule: clone(rule),
      actual: actual === undefined ? UNKNOWN_VALUE : clone(actual),
      passed: failures.length === 0,
      failures
    });
  }

  const required = Object.keys(asObject(criteria)).length;
  return deepFreeze({
    evaluationType: normalizeString(options.evaluationType, 'criteria'),
    requiredCriteria: required,
    passedCriteria: evaluations.filter((evaluation) => evaluation.passed).length,
    failedCriteria: evaluations.filter((evaluation) => !evaluation.passed).length,
    status: required === 0 ? UNKNOWN_VALUE : (evaluations.every((evaluation) => evaluation.passed) ? 'passed' : 'failed'),
    evaluations
  });
}

function buildProductionBaselineComparison(productionReferenceData = {}, options = {}) {
  const reference = asObject(productionReferenceData);
  const metrics = clone(asObject(firstDefined(
    reference.productionBaselineMetrics,
    reference.metrics,
    reference,
    {}
  )));

  return deepFreeze({
    baselineSource: normalizeString(firstDefined(reference.baselineSource, options.baselineSource), 'explicit_production_reference_data'),
    baselineId: normalizeString(firstDefined(reference.baselineId, options.baselineId), UNKNOWN_VALUE),
    metrics,
    productionImpact: 'none',
    decisionImpact: 'none'
  });
}

function deriveShadowMetrics(offlineExperimentResults = [], explicitShadowMetrics = undefined) {
  if (explicitShadowMetrics !== undefined) return clone(asObject(explicitShadowMetrics));
  const results = asArray(offlineExperimentResults).map((entry) => entry.result || entry);
  if (!results.length) return {};
  if (results.length === 1) return clone(asObject(results[0].proposedMetrics));
  return {
    resultCount: results.length,
    sourceResultFingerprints: results.map((result) => result.resultFingerprint).filter(Boolean).sort(),
    metricsAvailability: 'multiple_results_supplied_explicit_shadow_metrics_required'
  };
}

function buildShadowComparison(productionBaselineMetrics = {}, shadowMetrics = {}, options = {}) {
  const comparison = buildMetricComparison(productionBaselineMetrics, shadowMetrics);
  return deepFreeze({
    comparisonSource: normalizeString(options.comparisonSource, 'production_baseline_vs_shadow_metrics'),
    metrics: comparison,
    metricsWithUnknowns: comparison.filter((metric) => (
      metric.productionBaselineValue === UNKNOWN_VALUE ||
      metric.shadowValue === UNKNOWN_VALUE ||
      metric.delta === UNKNOWN_VALUE
    )).map((metric) => metric.metric),
    productionImpact: 'none',
    decisionImpact: 'none'
  });
}

function evaluateShadowSuccess(criteria = {}, shadowMetrics = {}) {
  return evaluateCriterionSet(criteria, shadowMetrics, { evaluationType: 'shadow_success' });
}

function evaluateShadowFailure(criteria = {}, shadowMetrics = {}) {
  const evaluation = evaluateCriterionSet(criteria, shadowMetrics, { evaluationType: 'shadow_failure' });
  const failureTriggered = evaluation.evaluations.some((item) => item.passed);
  return deepFreeze({
    ...clone(evaluation),
    status: evaluation.requiredCriteria === 0 ? UNKNOWN_VALUE : (failureTriggered ? 'triggered' : 'not_triggered')
  });
}

function evaluateShadowRegression(criteria = {}, comparisonMetrics = {}) {
  const metricMap = {};
  for (const comparison of asArray(comparisonMetrics.metrics)) {
    metricMap[`${comparison.metric}.delta`] = comparison.delta;
    metricMap[comparison.metric] = comparison.shadowValue;
  }
  return evaluateCriterionSet(criteria, metricMap, { evaluationType: 'shadow_regression' });
}

function summarizeComparisonChanges(comparisonMetrics = {}) {
  const improvements = [];
  const regressions = [];
  for (const metric of asArray(comparisonMetrics.metrics)) {
    if (!Number.isFinite(Number(metric.delta)) || Number(metric.delta) === 0) continue;
    const entry = {
      metric: metric.metric,
      productionBaselineValue: clone(metric.productionBaselineValue),
      shadowValue: clone(metric.shadowValue),
      delta: metric.delta
    };
    if (Number(metric.delta) > 0) improvements.push(entry);
    if (Number(metric.delta) < 0) regressions.push(entry);
  }
  return {
    improvements: improvements.sort((a, b) => a.metric.localeCompare(b.metric)),
    regressions: regressions.sort((a, b) => a.metric.localeCompare(b.metric))
  };
}

function buildShadowResultFingerprint(result = {}) {
  const projection = clone(result);
  delete projection.shadowResultFingerprint;
  return buildFingerprintFromProjection(projection);
}

function buildShadowResult(input = {}) {
  const resultCore = {
    schemaVersion: SHADOW_RESULT_SCHEMA_VERSION,
    source: SHADOW_EXPERIMENT_RUNNER_SOURCE,
    shadowResultId: normalizeString(input.shadowResultId, 'shadow-result'),
    shadowExperimentId: normalizeString(input.shadowExperimentId),
    createdAt: normalizeDate(input.createdAt),
    sourceExperimentIds: normalizeStringArray(input.sourceExperimentIds),
    sourceExperimentFingerprints: normalizeStringArray(input.sourceExperimentFingerprints),
    sourceOfflineResultFingerprints: normalizeStringArray(input.sourceOfflineResultFingerprints),
    productionBaselineMetrics: clone(asObject(input.productionBaselineMetrics)),
    shadowMetrics: clone(asObject(input.shadowMetrics)),
    comparisonMetrics: clone(asObject(input.comparisonMetrics)),
    improvements: asArray(input.improvements).map((item) => clone(item)),
    regressions: asArray(input.regressions).map((item) => clone(item)),
    statisticalSummary: clone(asObject(input.statisticalSummary)),
    successEvaluation: clone(asObject(input.successEvaluation)),
    failureEvaluation: clone(asObject(input.failureEvaluation)),
    regressionEvaluation: clone(asObject(input.regressionEvaluation)),
    recommendation: normalizeString(input.recommendation, UNKNOWN_VALUE),
    limitations: normalizeStringArray(input.limitations),
    observationSummary: clone(asObject(input.observationSummary)),
    productionImpact: 'none',
    decisionImpact: 'none'
  };

  return deepFreeze({
    ...resultCore,
    shadowResultFingerprint: buildShadowResultFingerprint(resultCore)
  });
}

function validateOfflineExperimentResult(result = {}, index = 0) {
  const errors = [];
  const object = asObject(result.result || result);
  for (const field of calibrationExperimentRunner.REQUIRED_RESULT_FIELDS || []) {
    const value = object[field];
    if (value === undefined || value === null || value === '') {
      errors.push(validationFailure('missing_required_result_field', `${field} is required.`, `offlineExperimentResults.${index}.${field}`));
    }
  }
  if (object.productionImpact !== 'none') {
    errors.push(validationFailure('invalid_result_production_impact', 'Offline experiment results must not affect production.', `offlineExperimentResults.${index}.productionImpact`));
  }
  if (object.decisionImpact !== 'none') {
    errors.push(validationFailure('invalid_result_decision_impact', 'Offline experiment results must not affect decisions.', `offlineExperimentResults.${index}.decisionImpact`));
  }
  if (object.resultFingerprint && calibrationExperimentRunner.buildExperimentResultFingerprint(object) !== object.resultFingerprint) {
    errors.push(validationFailure('offline_result_fingerprint_mismatch', 'Offline experiment result fingerprint does not match result contents.', `offlineExperimentResults.${index}.resultFingerprint`));
  }
  return errors;
}

function validateShadowExperimentInputs(input = {}) {
  const errors = [];
  const warnings = [];
  const invalidExperimentReferences = [];
  const invalidBaselineReferences = [];
  const invalidResultReferences = [];
  const shadowExperiment = asObject(input.shadowExperiment || input.experiment);
  const sourceExperiments = asArray(input.sourceExperiments);
  const offlineExperimentResults = asArray(input.offlineExperimentResults || input.offlineResults);
  const productionReferenceData = asObject(input.productionReferenceData || input.productionBaselineReference || input.productionBaseline);

  const shadowValidation = shadowExperimentContract.validateShadowExperiment(shadowExperiment);
  if (!shadowValidation.valid) {
    invalidExperimentReferences.push({
      shadowExperimentId: shadowExperiment.shadowExperimentId || UNKNOWN_VALUE,
      errors: clone(shadowValidation.errors)
    });
    errors.push(validationFailure('invalid_shadow_experiment', 'Shadow experiment contract validation failed.', 'shadowExperiment'));
  }

  for (const [index, sourceExperiment] of sourceExperiments.entries()) {
    const validation = calibrationExperimentContract.validateCalibrationExperiment(sourceExperiment);
    if (!validation.valid) {
      invalidExperimentReferences.push({
        index,
        experimentId: sourceExperiment?.experimentId || UNKNOWN_VALUE,
        errors: clone(validation.errors)
      });
      errors.push(validationFailure('invalid_source_experiment', 'Source calibration experiment validation failed.', `sourceExperiments.${index}`));
    }
  }

  if (!offlineExperimentResults.length) {
    errors.push(validationFailure('missing_offline_experiment_results', 'At least one offline experiment result is required.', 'offlineExperimentResults'));
  }
  for (const [index, result] of offlineExperimentResults.entries()) {
    const resultErrors = validateOfflineExperimentResult(result, index);
    if (resultErrors.length) {
      invalidResultReferences.push({
        index,
        resultId: (result.result || result)?.resultId || UNKNOWN_VALUE,
        errors: resultErrors
      });
      errors.push(validationFailure('invalid_offline_experiment_result', 'Offline experiment result validation failed.', `offlineExperimentResults.${index}`));
    }
  }

  const baselineMetrics = firstDefined(productionReferenceData.productionBaselineMetrics, productionReferenceData.metrics);
  if (!baselineMetrics || typeof baselineMetrics !== 'object' || Array.isArray(baselineMetrics)) {
    invalidBaselineReferences.push({
      baselineId: productionReferenceData.baselineId || UNKNOWN_VALUE,
      errors: [validationFailure('missing_production_baseline_metrics', 'productionReferenceData must include productionBaselineMetrics or metrics.', 'productionReferenceData')]
    });
    errors.push(validationFailure('invalid_production_baseline', 'Production baseline metrics are required.', 'productionReferenceData'));
  }
  if (productionReferenceData.productionImpact && productionReferenceData.productionImpact !== 'none') {
    errors.push(validationFailure('invalid_baseline_production_impact', 'Production reference data must not affect production.', 'productionReferenceData.productionImpact'));
  }
  if (productionReferenceData.decisionImpact && productionReferenceData.decisionImpact !== 'none') {
    errors.push(validationFailure('invalid_baseline_decision_impact', 'Production reference data must not affect decisions.', 'productionReferenceData.decisionImpact'));
  }

  const offlineResultFingerprints = new Set(offlineExperimentResults.map((result) => (result.result || result).resultFingerprint).filter(Boolean));
  for (const fingerprint of asArray(shadowExperiment.sourceExperimentFingerprints)) {
    if (!offlineResultFingerprints.has(fingerprint)) {
      warnings.push(validationFailure('shadow_source_fingerprint_not_supplied_as_offline_result', 'Shadow experiment source fingerprint was not supplied as an offline result fingerprint.', 'shadowExperiment.sourceExperimentFingerprints'));
    }
  }

  const reasonCodes = unique([
    ...errors.map((error) => error.code),
    ...warnings.map((warning) => warning.code)
  ]);

  return deepFreeze({
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes,
    invalidExperimentReferences,
    invalidBaselineReferences,
    invalidResultReferences
  });
}

function buildStatisticalSummary(productionBaselineMetrics = {}, shadowMetrics = {}, offlineExperimentResults = []) {
  return deepFreeze({
    offlineResultCount: asArray(offlineExperimentResults).length,
    productionMetricCount: flattenMetricPaths(productionBaselineMetrics).length,
    shadowMetricCount: flattenMetricPaths(shadowMetrics).length,
    outcomeAvailability: flattenMetricPaths(shadowMetrics).length ? 'shadow_metrics_supplied' : UNKNOWN_VALUE,
    productionImpact: 'none',
    decisionImpact: 'none'
  });
}

function buildObservationSummary(shadowExperiment = {}, productionBaseline = {}, validation = {}) {
  return deepFreeze({
    observationScope: clone(asObject(shadowExperiment.observationScope)),
    baselineId: productionBaseline.baselineId || UNKNOWN_VALUE,
    validationStatus: validation.valid ? 'valid' : 'invalid',
    warningCount: asArray(validation.warnings).length,
    productionImpact: 'none',
    decisionImpact: 'none'
  });
}

function chooseRecommendation(successEvaluation = {}, failureEvaluation = {}, regressionEvaluation = {}) {
  if (failureEvaluation.status === 'triggered') return 'do_not_advance_failure_criteria_triggered';
  if (regressionEvaluation.status === 'failed') return 'do_not_advance_regression_detected';
  if (successEvaluation.status === 'passed') return 'candidate_for_production_proposal_review';
  if (successEvaluation.status === UNKNOWN_VALUE) return 'insufficient_explicit_success_criteria';
  return 'continue_shadow_observation';
}

function runShadowExperiment(input = {}, options = {}) {
  const shadowExperiment = input.shadowExperiment || input.experiment || input;
  const offlineExperimentResults = asArray(input.offlineExperimentResults || input.offlineResults || options.offlineExperimentResults);
  const productionReferenceData = asObject(input.productionReferenceData || input.productionBaseline || options.productionReferenceData);
  const validation = validateShadowExperimentInputs({
    shadowExperiment,
    sourceExperiments: input.sourceExperiments || options.sourceExperiments,
    offlineExperimentResults,
    productionReferenceData
  });
  if (!validation.valid && options.throwOnInvalid) {
    const error = new Error('Cannot run shadow experiment with invalid immutable inputs.');
    error.validation = validation;
    throw error;
  }

  const productionBaseline = buildProductionBaselineComparison(productionReferenceData);
  const productionBaselineMetrics = clone(asObject(productionBaseline.metrics));
  const shadowMetrics = deriveShadowMetrics(offlineExperimentResults, firstDefined(input.shadowMetrics, options.shadowMetrics));
  const comparisonMetrics = buildShadowComparison(productionBaselineMetrics, shadowMetrics);
  const successEvaluation = evaluateShadowSuccess(shadowExperiment.successCriteria, shadowMetrics);
  const failureEvaluation = evaluateShadowFailure(firstDefined(shadowExperiment.failureCriteria, input.failureCriteria, options.failureCriteria, {}), shadowMetrics);
  const regressionEvaluation = evaluateShadowRegression(shadowExperiment.regressionCriteria, comparisonMetrics);
  const changes = summarizeComparisonChanges(comparisonMetrics);
  const sourceResults = offlineExperimentResults.map((result) => result.result || result);

  const result = buildShadowResult({
    shadowResultId: firstDefined(input.shadowResultId, options.shadowResultId, `${shadowExperiment.shadowExperimentId || 'shadow-experiment'}:result`),
    shadowExperimentId: shadowExperiment.shadowExperimentId,
    createdAt: firstDefined(input.createdAt, options.createdAt, UNKNOWN_VALUE),
    sourceExperimentIds: shadowExperiment.sourceExperimentIds,
    sourceExperimentFingerprints: shadowExperiment.sourceExperimentFingerprints,
    sourceOfflineResultFingerprints: sourceResults.map((sourceResult) => sourceResult.resultFingerprint).filter(Boolean),
    productionBaselineMetrics,
    shadowMetrics,
    comparisonMetrics,
    improvements: changes.improvements,
    regressions: changes.regressions,
    statisticalSummary: buildStatisticalSummary(productionBaselineMetrics, shadowMetrics, sourceResults),
    successEvaluation,
    failureEvaluation,
    regressionEvaluation,
    recommendation: chooseRecommendation(successEvaluation, failureEvaluation, regressionEvaluation),
    limitations: [
      ...asArray(shadowExperiment.approvalArtifact?.limitations),
      ...asArray(validation.warnings).map((warning) => warning.code)
    ],
    observationSummary: buildObservationSummary(shadowExperiment, productionBaseline, validation)
  });

  return deepFreeze({
    result,
    validation,
    productionImpact: 'none',
    decisionImpact: 'none'
  });
}

function summarizeShadowResults(results = []) {
  const normalized = asArray(results).map((entry) => entry.result || entry);
  return deepFreeze({
    resultCount: normalized.length,
    shadowExperimentIds: unique(normalized.map((result) => result.shadowExperimentId).filter(Boolean)).sort(),
    recommendations: normalized.reduce((summary, result) => {
      const key = result.recommendation || UNKNOWN_VALUE;
      summary[key] = (summary[key] || 0) + 1;
      return summary;
    }, {}),
    successStatuses: normalized.reduce((summary, result) => {
      const key = result.successEvaluation?.status || UNKNOWN_VALUE;
      summary[key] = (summary[key] || 0) + 1;
      return summary;
    }, {}),
    failureStatuses: normalized.reduce((summary, result) => {
      const key = result.failureEvaluation?.status || UNKNOWN_VALUE;
      summary[key] = (summary[key] || 0) + 1;
      return summary;
    }, {}),
    regressionStatuses: normalized.reduce((summary, result) => {
      const key = result.regressionEvaluation?.status || UNKNOWN_VALUE;
      summary[key] = (summary[key] || 0) + 1;
      return summary;
    }, {}),
    shadowResultFingerprints: normalized.map((result) => result.shadowResultFingerprint).filter(Boolean).sort(),
    productionImpact: 'none',
    decisionImpact: 'none'
  });
}

function exportShadowResults(results = {}, outputPath) {
  const payload = `${JSON.stringify(results, null, 2)}\n`;
  if (!outputPath) return payload;
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, payload);
  return results;
}

function importShadowResults(input) {
  const parsed = typeof input === 'string'
    ? JSON.parse(fs.existsSync(input) ? fs.readFileSync(input, 'utf8') : input)
    : clone(input);
  return deepFreeze(parsed);
}

module.exports = {
  REQUIRED_SHADOW_RESULT_FIELDS,
  SHADOW_EXPERIMENT_RUNNER_SOURCE,
  SHADOW_RESULT_SCHEMA_VERSION,
  UNKNOWN_VALUE,
  buildProductionBaselineComparison,
  buildShadowComparison,
  buildShadowResult,
  buildShadowResultFingerprint,
  evaluateShadowFailure,
  evaluateShadowRegression,
  evaluateShadowSuccess,
  exportShadowResults,
  importShadowResults,
  runShadowExperiment,
  summarizeShadowResults,
  validateShadowExperimentInputs
};
