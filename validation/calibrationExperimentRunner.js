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
const experimentContract = require('./calibrationExperimentContract');
const recommendationContract = require('./calibrationRecommendationContract');
const datasetBuilder = require('./calibrationDatasetBuilder');

const CALIBRATION_EXPERIMENT_RESULT_SCHEMA_VERSION = '1.0.0';
const CALIBRATION_EXPERIMENT_RUNNER_SOURCE = 'calibration_experiment_runner';
const UNKNOWN_VALUE = 'unknown';

const REQUIRED_RESULT_FIELDS = Object.freeze([
  'schemaVersion',
  'source',
  'resultId',
  'experimentId',
  'createdAt',
  'sourceDatasetIds',
  'sourceDatasetFingerprints',
  'sourceRecommendationIds',
  'sourceRecommendationFingerprints',
  'baselineMetrics',
  'proposedMetrics',
  'comparisonMetrics',
  'regressions',
  'improvements',
  'statisticalSummary',
  'successEvaluation',
  'failureEvaluation',
  'regressionEvaluation',
  'recommendation',
  'limitations',
  'productionImpact',
  'decisionImpact',
  'resultFingerprint'
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

function stableSortByFingerprint(records = []) {
  return asArray(records).slice().sort((a, b) => (
    String(a.datasetId || '').localeCompare(String(b.datasetId || '')) ||
    String(a.recordId || '').localeCompare(String(b.recordId || '')) ||
    String(a.recordFingerprint || '').localeCompare(String(b.recordFingerprint || ''))
  ));
}

function validationFailure(code, message, field = '') {
  return { code, message, field };
}

function countBy(values = []) {
  return asArray(values).reduce((summary, value) => {
    const key = known(value) ? String(value) : UNKNOWN_VALUE;
    summary[key] = (summary[key] || 0) + 1;
    return summary;
  }, {});
}

function percent(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return UNKNOWN_VALUE;
  return Number((numerator / denominator).toFixed(6));
}

function readMetric(source = {}, pathValue = '') {
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

function compareMetricValues(baselineValue, proposedValue) {
  const baselineNumber = Number(baselineValue);
  const proposedNumber = Number(proposedValue);
  if (Number.isFinite(baselineNumber) && Number.isFinite(proposedNumber)) {
    return Number((proposedNumber - baselineNumber).toFixed(6));
  }
  if (baselineValue === proposedValue) return 0;
  return UNKNOWN_VALUE;
}

function buildMetricComparison(baselineMetrics = {}, proposedMetrics = {}) {
  const paths = unique([
    ...flattenMetricPaths(baselineMetrics),
    ...flattenMetricPaths(proposedMetrics)
  ]).sort();

  return paths.map((metric) => {
    const baselineValue = readMetric(baselineMetrics, metric);
    const proposedValue = readMetric(proposedMetrics, metric);
    return {
      metric,
      baselineValue: baselineValue === undefined ? UNKNOWN_VALUE : clone(baselineValue),
      proposedValue: proposedValue === undefined ? UNKNOWN_VALUE : clone(proposedValue),
      delta: baselineValue === undefined || proposedValue === undefined
        ? UNKNOWN_VALUE
        : compareMetricValues(baselineValue, proposedValue)
    };
  });
}

function collectDatasetRecords(datasets = []) {
  const records = [];
  for (const dataset of asArray(datasets)) {
    for (const record of asArray(dataset.records)) {
      records.push({
        ...clone(record),
        datasetId: dataset.datasetId,
        datasetFingerprint: dataset.datasetFingerprint
      });
    }
  }
  return stableSortByFingerprint(records);
}

function buildExperimentBaseline(datasets = [], options = {}) {
  const records = collectDatasetRecords(datasets);
  const reviews = records.map((record) => asObject(record.daltonReview));
  const productionCorrect = countBy(reviews.map((review) => review.productionCorrect));
  const shadowBetter = countBy(reviews.map((review) => review.shadowBetter));
  const wouldBuy = countBy(reviews.map((review) => review.wouldBuy));
  const wouldNotify = countBy(reviews.map((review) => review.wouldNotify));
  const dealGateQuality = countBy(reviews.map((review) => review.dealGateQuality));
  const buyNowQuality = countBy(reviews.map((review) => review.buyNowQuality));
  const reviewCount = records.length;

  return deepFreeze({
    metricSource: 'immutable_calibration_dataset',
    datasetCount: asArray(datasets).length,
    reviewCount,
    listingCount: unique(records.map((record) => record.listingId)).length,
    recordCount: records.length,
    productionCorrect,
    shadowBetter,
    wouldBuy,
    wouldNotify,
    dealGateQuality,
    buyNowQuality,
    productionCorrectRate: percent(productionCorrect.yes || 0, reviewCount),
    falsePositiveRate: percent(productionCorrect.no || 0, reviewCount),
    notificationPrecision: percent(wouldNotify.yes || 0, reviewCount),
    buyNowPrecision: percent(buyNowQuality.correct || 0, reviewCount),
    dealGatePrecision: percent(dealGateQuality.correct || 0, reviewCount),
    recordFingerprints: records.map((record) => record.recordFingerprint).filter(Boolean).sort(),
    notes: normalizeString(options.notes, 'baseline uses reviewed immutable evidence only')
  });
}

function buildExperimentComparison(baselineMetrics = {}, proposedMetrics = {}, options = {}) {
  const comparison = buildMetricComparison(baselineMetrics, proposedMetrics);
  return deepFreeze({
    comparisonSource: normalizeString(options.comparisonSource, 'explicit_or_unknown_proposed_metrics'),
    metrics: comparison,
    metricsWithUnknowns: comparison.filter((metric) => (
      metric.baselineValue === UNKNOWN_VALUE ||
      metric.proposedValue === UNKNOWN_VALUE ||
      metric.delta === UNKNOWN_VALUE
    )).map((metric) => metric.metric),
    productionImpact: 'none',
    decisionImpact: 'none'
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
    const failures = [];

    const actualUnknown = actual === undefined || actual === UNKNOWN_VALUE;
    if (actualUnknown) {
      failures.push('metric_unknown');
    }
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

function evaluateSuccessCriteria(criteria = {}, proposedMetrics = {}) {
  return evaluateCriterionSet(criteria, proposedMetrics, { evaluationType: 'success' });
}

function evaluateFailureCriteria(criteria = {}, proposedMetrics = {}) {
  const evaluation = evaluateCriterionSet(criteria, proposedMetrics, { evaluationType: 'failure' });
  const failureTriggered = evaluation.evaluations.some((item) => item.passed);
  return deepFreeze({
    ...clone(evaluation),
    status: evaluation.requiredCriteria === 0 ? UNKNOWN_VALUE : (failureTriggered ? 'triggered' : 'not_triggered')
  });
}

function evaluateRegressionCriteria(criteria = {}, comparisonMetrics = {}) {
  const metricMap = {};
  for (const comparison of asArray(comparisonMetrics.metrics)) {
    metricMap[`${comparison.metric}.delta`] = comparison.delta;
    metricMap[comparison.metric] = comparison.proposedValue;
  }
  return evaluateCriterionSet(criteria, metricMap, { evaluationType: 'regression' });
}

function summarizeComparisonChanges(comparisonMetrics = {}) {
  const improvements = [];
  const regressions = [];
  for (const metric of asArray(comparisonMetrics.metrics)) {
    if (!Number.isFinite(Number(metric.delta)) || Number(metric.delta) === 0) continue;
    const entry = {
      metric: metric.metric,
      baselineValue: clone(metric.baselineValue),
      proposedValue: clone(metric.proposedValue),
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

function buildExperimentResultFingerprint(result = {}) {
  const projection = clone(result);
  delete projection.resultFingerprint;
  return buildFingerprintFromProjection(projection);
}

function buildExperimentResult(input = {}) {
  const resultCore = {
    schemaVersion: CALIBRATION_EXPERIMENT_RESULT_SCHEMA_VERSION,
    source: CALIBRATION_EXPERIMENT_RUNNER_SOURCE,
    resultId: normalizeString(input.resultId, 'calibration-experiment-result'),
    experimentId: normalizeString(input.experimentId),
    createdAt: normalizeDate(input.createdAt),
    sourceDatasetIds: unique(asArray(input.sourceDatasetIds).map((value) => normalizeString(value, '')).filter(Boolean)).sort(),
    sourceDatasetFingerprints: unique(asArray(input.sourceDatasetFingerprints).map((value) => normalizeString(value, '')).filter(Boolean)).sort(),
    sourceRecommendationIds: unique(asArray(input.sourceRecommendationIds).map((value) => normalizeString(value, '')).filter(Boolean)).sort(),
    sourceRecommendationFingerprints: unique(asArray(input.sourceRecommendationFingerprints).map((value) => normalizeString(value, '')).filter(Boolean)).sort(),
    baselineMetrics: clone(asObject(input.baselineMetrics)),
    proposedMetrics: clone(asObject(input.proposedMetrics)),
    comparisonMetrics: clone(asObject(input.comparisonMetrics)),
    regressions: asArray(input.regressions).map((item) => clone(item)),
    improvements: asArray(input.improvements).map((item) => clone(item)),
    statisticalSummary: clone(asObject(input.statisticalSummary)),
    successEvaluation: clone(asObject(input.successEvaluation)),
    failureEvaluation: clone(asObject(input.failureEvaluation)),
    regressionEvaluation: clone(asObject(input.regressionEvaluation)),
    recommendation: normalizeString(input.recommendation, UNKNOWN_VALUE),
    limitations: unique(asArray(input.limitations).map((value) => normalizeString(value, '')).filter(Boolean)).sort(),
    productionImpact: 'none',
    decisionImpact: 'none'
  };

  return deepFreeze({
    ...resultCore,
    resultFingerprint: buildExperimentResultFingerprint(resultCore)
  });
}

function validateExperimentInputs(input = {}) {
  const errors = [];
  const warnings = [];
  const invalidExperimentReferences = [];
  const invalidDatasetReferences = [];
  const invalidRecommendationReferences = [];
  const experiment = asObject(input.experiment);
  const datasets = asArray(input.datasets);
  const recommendations = asArray(input.recommendations);

  const experimentValidation = experimentContract.validateCalibrationExperiment(experiment);
  if (!experimentValidation.valid) {
    invalidExperimentReferences.push({
      experimentId: experiment.experimentId || UNKNOWN_VALUE,
      errors: clone(experimentValidation.errors)
    });
    errors.push(validationFailure('invalid_experiment', 'Experiment contract validation failed.', 'experiment'));
  }
  if (experiment.productionImpact !== 'none' || experiment.decisionImpact !== 'none') {
    errors.push(validationFailure('invalid_experiment_authority', 'Experiment must remain evidence-only.', 'experiment'));
  }

  if (!datasets.length) {
    errors.push(validationFailure('missing_datasets', 'At least one calibration dataset is required.', 'datasets'));
  }
  for (const [index, dataset] of datasets.entries()) {
    const validation = datasetBuilder.validateCalibrationDataset(dataset);
    if (!validation.valid) {
      invalidDatasetReferences.push({
        index,
        datasetId: dataset?.datasetId || UNKNOWN_VALUE,
        errors: clone(validation.errors)
      });
      errors.push(validationFailure('invalid_dataset', 'Calibration dataset validation failed.', `datasets.${index}`));
    }
  }

  for (const [index, recommendation] of recommendations.entries()) {
    const validation = recommendationContract.validateCalibrationRecommendation(recommendation);
    if (!validation.valid) {
      invalidRecommendationReferences.push({
        index,
        recommendationId: recommendation?.recommendationId || UNKNOWN_VALUE,
        errors: clone(validation.errors)
      });
      errors.push(validationFailure('invalid_recommendation', 'Calibration recommendation validation failed.', `recommendations.${index}`));
    }
  }

  const datasetIds = new Set(datasets.map((dataset) => dataset.datasetId).filter(Boolean));
  for (const datasetId of asArray(experiment.replayDatasetIds)) {
    if (!datasetIds.has(datasetId)) warnings.push(validationFailure('experiment_replay_dataset_not_supplied', 'Experiment references a replay dataset not supplied to the runner.', 'experiment.replayDatasetIds'));
  }
  const recommendationIds = new Set(recommendations.map((recommendation) => recommendation.recommendationId).filter(Boolean));
  for (const recommendationId of asArray(experiment.sourceRecommendationIds)) {
    if (recommendations.length && !recommendationIds.has(recommendationId)) {
      warnings.push(validationFailure('experiment_recommendation_not_supplied', 'Experiment references a recommendation not supplied to the runner.', 'experiment.sourceRecommendationIds'));
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
    invalidDatasetReferences,
    invalidRecommendationReferences
  });
}

function buildStatisticalSummary(datasets = [], baselineMetrics = {}, proposedMetrics = {}) {
  return deepFreeze({
    datasetCount: asArray(datasets).length,
    reviewCount: baselineMetrics.reviewCount || 0,
    listingCount: baselineMetrics.listingCount || 0,
    outcomeAvailability: baselineMetrics.reviewCount > 0 ? 'reviewed_outcomes_available' : 'unavailable',
    proposedMetricAvailability: Object.keys(asObject(proposedMetrics)).length ? 'explicit_proposed_metrics_supplied' : 'unknown',
    productionImpact: 'none',
    decisionImpact: 'none'
  });
}

function chooseRecommendation(successEvaluation = {}, failureEvaluation = {}, regressionEvaluation = {}) {
  if (failureEvaluation.status === 'triggered') return 'do_not_advance_failure_criteria_triggered';
  if (regressionEvaluation.status === 'failed') return 'do_not_advance_regression_detected';
  if (successEvaluation.status === 'passed') return 'candidate_for_further_offline_review';
  if (successEvaluation.status === UNKNOWN_VALUE) return 'insufficient_explicit_success_criteria';
  return 'continue_offline_review';
}

function runCalibrationExperiment(input = {}, options = {}) {
  const experiment = input.experiment || input;
  const datasets = asArray(input.datasets || options.datasets);
  const recommendations = asArray(input.recommendations || options.recommendations);
  const validation = validateExperimentInputs({ experiment, datasets, recommendations });
  if (!validation.valid && options.throwOnInvalid) {
    const error = new Error('Cannot run calibration experiment with invalid immutable inputs.');
    error.validation = validation;
    throw error;
  }

  const baselineMetrics = buildExperimentBaseline(datasets);
  const proposedMetrics = clone(asObject(firstDefined(input.proposedMetrics, options.proposedMetrics, experiment.proposedBehavior?.metrics, {})));
  const comparisonMetrics = buildExperimentComparison(baselineMetrics, proposedMetrics);
  const successEvaluation = evaluateSuccessCriteria(experiment.successCriteria, proposedMetrics);
  const failureEvaluation = evaluateFailureCriteria(experiment.failureCriteria, proposedMetrics);
  const regressionEvaluation = evaluateRegressionCriteria(experiment.regressionCriteria, comparisonMetrics);
  const changes = summarizeComparisonChanges(comparisonMetrics);

  const result = buildExperimentResult({
    resultId: firstDefined(input.resultId, options.resultId, `${experiment.experimentId || 'experiment'}:result`),
    experimentId: experiment.experimentId,
    createdAt: firstDefined(input.createdAt, options.createdAt, UNKNOWN_VALUE),
    sourceDatasetIds: datasets.map((dataset) => dataset.datasetId).filter(Boolean),
    sourceDatasetFingerprints: datasets.map((dataset) => dataset.datasetFingerprint).filter(Boolean),
    sourceRecommendationIds: recommendations.map((recommendation) => recommendation.recommendationId).filter(Boolean),
    sourceRecommendationFingerprints: recommendations.map((recommendation) => recommendation.recommendationFingerprint).filter(Boolean),
    baselineMetrics,
    proposedMetrics,
    comparisonMetrics,
    regressions: changes.regressions,
    improvements: changes.improvements,
    statisticalSummary: buildStatisticalSummary(datasets, baselineMetrics, proposedMetrics),
    successEvaluation,
    failureEvaluation,
    regressionEvaluation,
    recommendation: chooseRecommendation(successEvaluation, failureEvaluation, regressionEvaluation),
    limitations: [
      ...asArray(experiment.limitations),
      ...asArray(validation.warnings).map((warning) => warning.code)
    ]
  });

  return deepFreeze({
    result,
    validation,
    productionImpact: 'none',
    decisionImpact: 'none'
  });
}

function summarizeExperimentResults(results = []) {
  const normalized = asArray(results).map((entry) => entry.result || entry);
  return deepFreeze({
    resultCount: normalized.length,
    experimentIds: unique(normalized.map((result) => result.experimentId).filter(Boolean)).sort(),
    recommendations: countBy(normalized.map((result) => result.recommendation)),
    successStatuses: countBy(normalized.map((result) => result.successEvaluation?.status)),
    failureStatuses: countBy(normalized.map((result) => result.failureEvaluation?.status)),
    regressionStatuses: countBy(normalized.map((result) => result.regressionEvaluation?.status)),
    resultFingerprints: normalized.map((result) => result.resultFingerprint).filter(Boolean).sort(),
    productionImpact: 'none',
    decisionImpact: 'none'
  });
}

function exportExperimentResults(results = {}, outputPath) {
  const payload = `${JSON.stringify(results, null, 2)}\n`;
  if (!outputPath) return payload;
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, payload);
  return results;
}

function importExperimentResults(input) {
  const parsed = typeof input === 'string'
    ? JSON.parse(fs.existsSync(input) ? fs.readFileSync(input, 'utf8') : input)
    : clone(input);
  return deepFreeze(parsed);
}

module.exports = {
  CALIBRATION_EXPERIMENT_RESULT_SCHEMA_VERSION,
  CALIBRATION_EXPERIMENT_RUNNER_SOURCE,
  REQUIRED_RESULT_FIELDS,
  UNKNOWN_VALUE,
  buildExperimentBaseline,
  buildExperimentComparison,
  buildExperimentResult,
  buildExperimentResultFingerprint,
  evaluateFailureCriteria,
  evaluateRegressionCriteria,
  evaluateSuccessCriteria,
  exportExperimentResults,
  importExperimentResults,
  runCalibrationExperiment,
  summarizeExperimentResults,
  validateExperimentInputs
};
