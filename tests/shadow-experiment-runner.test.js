'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const runner = require('../validation/shadowExperimentRunner');
const shadowContract = require('../validation/shadowExperimentContract');
const calibrationRunner = require('../validation/calibrationExperimentRunner');

function offlineResult(overrides = {}) {
  return calibrationRunner.buildExperimentResult({
    resultId: 'offline-result-001',
    experimentId: 'offline-experiment-001',
    createdAt: '2026-07-27T15:00:00.000Z',
    sourceDatasetIds: ['dataset-a'],
    sourceDatasetFingerprints: ['dataset-fingerprint-a'],
    sourceRecommendationIds: ['recommendation-a'],
    sourceRecommendationFingerprints: ['recommendation-fingerprint-a'],
    baselineMetrics: { productionShadowAgreementRate: 0.8, falsePositiveRate: 0.08 },
    proposedMetrics: { productionShadowAgreementRate: 0.94, falsePositiveRate: 0.04 },
    comparisonMetrics: { metrics: [] },
    regressions: [],
    improvements: [],
    statisticalSummary: { reviewCount: 50 },
    successEvaluation: { status: 'passed' },
    failureEvaluation: { status: 'not_triggered' },
    regressionEvaluation: { status: 'passed' },
    recommendation: 'candidate_for_further_offline_review',
    limitations: ['offline_only'],
    ...overrides
  });
}

function shadowExperiment(overrides = {}) {
  const result = overrides.sourceResult || offlineResult();
  return shadowContract.createShadowExperiment({
    shadowExperimentId: 'shadow-experiment-001',
    shadowExperimentBatchId: 'shadow-batch-001',
    createdAt: '2026-07-27T16:00:00.000Z',
    sourceExperimentIds: ['offline-experiment-001'],
    sourceExperimentFingerprints: [result.resultFingerprint],
    targetSubsystem: 'confidence',
    observationScope: { mode: 'offline_shadow_observation', minimumObservedListings: 50 },
    productionBaselineReference: { baselineId: 'production-baseline-001' },
    shadowConfigurationReference: { configurationId: 'shadow-config-001', productionAuthority: 'none' },
    observationMetrics: [{ metric: 'productionShadowAgreementRate' }],
    comparisonMetrics: [{ metric: 'falsePositiveRate' }],
    regressionCriteria: { 'falsePositiveRate.delta': { max: 0 } },
    successCriteria: { productionShadowAgreementRate: { min: 0.9 } },
    statisticalRequirements: { minimumObservedListings: 50 },
    monitoringRequirements: { stopOnRegression: true },
    rollbackPlan: { disableShadowObservation: true },
    shadowExperimentStatus: 'approved_for_shadow_observation',
    approvalArtifact: {
      approved: true,
      approver: 'Dalton',
      approvedAt: '2026-07-27T16:30:00.000Z',
      limitations: ['shadow_observation_only']
    },
    ...overrides
  });
}

function productionBaseline(overrides = {}) {
  return {
    baselineId: 'production-baseline-001',
    productionBaselineMetrics: {
      productionShadowAgreementRate: 0.8,
      falsePositiveRate: 0.08,
      buyNowPrecision: 0.9,
      ...overrides.metrics
    },
    productionImpact: 'none',
    decisionImpact: 'none',
    ...overrides
  };
}

test('exports Shadow Experiment Runner public API and constants', () => {
  assert.equal(runner.SHADOW_EXPERIMENT_RUNNER_SOURCE, 'shadow_experiment_runner');
  assert.equal(runner.SHADOW_RESULT_SCHEMA_VERSION, '1.0.0');
  assert.equal(typeof runner.runShadowExperiment, 'function');
  assert.equal(typeof runner.validateShadowExperimentInputs, 'function');
  assert.equal(typeof runner.buildProductionBaselineComparison, 'function');
  assert.equal(typeof runner.buildShadowComparison, 'function');
  assert.equal(typeof runner.evaluateShadowSuccess, 'function');
  assert.equal(typeof runner.evaluateShadowFailure, 'function');
  assert.equal(typeof runner.evaluateShadowRegression, 'function');
  assert.equal(typeof runner.buildShadowResult, 'function');
  assert.equal(typeof runner.summarizeShadowResults, 'function');
  assert.equal(typeof runner.exportShadowResults, 'function');
  assert.equal(typeof runner.importShadowResults, 'function');
  assert.equal(typeof runner.buildShadowResultFingerprint, 'function');
});

test('runs a minimum observation-only shadow experiment', () => {
  const sourceResult = offlineResult();
  const experiment = shadowExperiment({ sourceResult });
  const output = runner.runShadowExperiment({
    shadowExperiment: experiment,
    offlineExperimentResults: [sourceResult],
    productionReferenceData: productionBaseline(),
    createdAt: '2026-07-27T17:00:00.000Z',
    shadowResultId: 'shadow-result-001'
  });

  assert.equal(output.validation.valid, true);
  assert.equal(output.result.shadowResultId, 'shadow-result-001');
  assert.equal(output.result.shadowExperimentId, 'shadow-experiment-001');
  assert.equal(output.result.successEvaluation.status, 'passed');
  assert.equal(output.result.failureEvaluation.status, 'unknown');
  assert.equal(output.result.regressionEvaluation.status, 'passed');
  assert.equal(output.result.productionImpact, 'none');
  assert.equal(output.result.decisionImpact, 'none');
  assert.equal(Object.isFrozen(output.result), true);
});

test('supports multiple offline result inputs with explicit shadow metrics', () => {
  const first = offlineResult({ resultId: 'offline-result-a' });
  const second = offlineResult({
    resultId: 'offline-result-b',
    proposedMetrics: { productionShadowAgreementRate: 0.91, falsePositiveRate: 0.05 }
  });
  const experiment = shadowExperiment({
    sourceResult: first,
    sourceExperimentIds: ['offline-experiment-001', 'offline-experiment-002'],
    sourceExperimentFingerprints: [first.resultFingerprint, second.resultFingerprint],
    successCriteria: { productionShadowAgreementRate: { min: 0.9 } }
  });
  const output = runner.runShadowExperiment({
    shadowExperiment: experiment,
    offlineExperimentResults: [second, first],
    productionReferenceData: productionBaseline(),
    shadowMetrics: { productionShadowAgreementRate: 0.92, falsePositiveRate: 0.03 },
    createdAt: '2026-07-27T17:00:00.000Z'
  });

  assert.equal(output.validation.valid, true);
  assert.deepEqual(output.result.sourceOfflineResultFingerprints, [first.resultFingerprint, second.resultFingerprint].sort());
  assert.equal(output.result.statisticalSummary.offlineResultCount, 2);
  assert.equal(output.result.successEvaluation.status, 'passed');
});

test('explicit timestamps keep shadow result fingerprints deterministic', () => {
  const sourceResult = offlineResult();
  const experiment = shadowExperiment({ sourceResult });
  const first = runner.runShadowExperiment({
    shadowExperiment: experiment,
    offlineExperimentResults: [sourceResult],
    productionReferenceData: productionBaseline(),
    createdAt: '2026-07-27T17:00:00.000Z'
  });
  const second = runner.runShadowExperiment({
    shadowExperiment: experiment,
    offlineExperimentResults: [sourceResult],
    productionReferenceData: productionBaseline(),
    createdAt: '2026-07-27T17:00:00.000Z'
  });

  assert.deepEqual(first.result, second.result);
  assert.equal(first.result.shadowResultFingerprint, runner.buildShadowResultFingerprint(first.result));
});

test('failure cases and regression detection are explicit', () => {
  const sourceResult = offlineResult({
    proposedMetrics: { productionShadowAgreementRate: 0.7, falsePositiveRate: 0.2 }
  });
  const experiment = shadowExperiment({
    sourceResult,
    successCriteria: { productionShadowAgreementRate: { min: 0.9 } },
    regressionCriteria: { 'falsePositiveRate.delta': { max: 0 } }
  });
  const output = runner.runShadowExperiment({
    shadowExperiment: experiment,
    offlineExperimentResults: [sourceResult],
    productionReferenceData: productionBaseline(),
    failureCriteria: { falsePositiveRate: { min: 0.15 } },
    createdAt: '2026-07-27T17:00:00.000Z'
  });

  assert.equal(output.result.successEvaluation.status, 'failed');
  assert.equal(output.result.failureEvaluation.status, 'triggered');
  assert.equal(output.result.regressionEvaluation.status, 'failed');
  assert.equal(output.result.recommendation, 'do_not_advance_failure_criteria_triggered');
});

test('unknown shadow metrics remain unknown and are never inferred', () => {
  const sourceResult = offlineResult({ proposedMetrics: {} });
  const experiment = shadowExperiment({
    sourceResult,
    successCriteria: { productionShadowAgreementRate: { min: 0.9 } },
    regressionCriteria: {}
  });
  const output = runner.runShadowExperiment({
    shadowExperiment: experiment,
    offlineExperimentResults: [sourceResult],
    productionReferenceData: productionBaseline(),
    createdAt: '2026-07-27T17:00:00.000Z'
  });

  assert.deepEqual(output.result.shadowMetrics, {});
  assert.equal(output.result.successEvaluation.status, 'failed');
  assert.deepEqual(output.result.successEvaluation.evaluations[0].failures, ['metric_unknown']);
  assert.equal(output.result.statisticalSummary.outcomeAvailability, 'unknown');
});

test('runner never mutates shadow experiments, baselines, or offline results', () => {
  const sourceResult = offlineResult();
  const experiment = shadowExperiment({ sourceResult });
  const baseline = productionBaseline();
  const before = JSON.stringify({ sourceResult, experiment, baseline });
  const output = runner.runShadowExperiment({
    shadowExperiment: experiment,
    offlineExperimentResults: [sourceResult],
    productionReferenceData: baseline,
    createdAt: '2026-07-27T17:00:00.000Z'
  });

  assert.equal(JSON.stringify({ sourceResult, experiment, baseline }), before);
  assert.equal(Object.isFrozen(output.result), true);
  assert.equal(Object.isFrozen(output.result.productionBaselineMetrics), true);
});

test('invalid inputs return structured validation references', () => {
  const sourceResult = {
    ...offlineResult(),
    productionImpact: 'changes_production',
    resultFingerprint: 'stale'
  };
  const experiment = {
    ...shadowExperiment({ sourceResult: offlineResult() }),
    decisionImpact: 'changes_decision',
    shadowExperimentFingerprint: 'stale'
  };
  const validation = runner.validateShadowExperimentInputs({
    shadowExperiment: experiment,
    offlineExperimentResults: [sourceResult],
    productionReferenceData: { productionImpact: 'changes_production' }
  });

  assert.equal(validation.valid, false);
  assert.equal(validation.reasonCodes.includes('invalid_shadow_experiment'), true);
  assert.equal(validation.reasonCodes.includes('invalid_offline_experiment_result'), true);
  assert.equal(validation.reasonCodes.includes('invalid_production_baseline'), true);
  assert.equal(validation.invalidExperimentReferences.length, 1);
  assert.equal(validation.invalidResultReferences.length, 1);
  assert.equal(validation.invalidBaselineReferences.length, 1);
});

test('export and import preserve shadow result JSON shape', () => {
  const sourceResult = offlineResult();
  const result = runner.runShadowExperiment({
    shadowExperiment: shadowExperiment({ sourceResult }),
    offlineExperimentResults: [sourceResult],
    productionReferenceData: productionBaseline(),
    createdAt: '2026-07-27T17:00:00.000Z'
  }).result;
  const serialized = runner.exportShadowResults(result);
  const imported = runner.importShadowResults(serialized);

  assert.deepEqual(imported, result);
  assert.equal(imported.shadowResultFingerprint, runner.buildShadowResultFingerprint(imported));
});

test('summary aggregates immutable shadow result artifacts deterministically', () => {
  const firstSource = offlineResult({ resultId: 'offline-result-a' });
  const secondSource = offlineResult({ resultId: 'offline-result-b' });
  const first = runner.runShadowExperiment({
    shadowExperiment: shadowExperiment({ sourceResult: firstSource, shadowExperimentId: 'shadow-a' }),
    offlineExperimentResults: [firstSource],
    productionReferenceData: productionBaseline(),
    createdAt: '2026-07-27T17:00:00.000Z'
  }).result;
  const second = runner.runShadowExperiment({
    shadowExperiment: shadowExperiment({ sourceResult: secondSource, shadowExperimentId: 'shadow-b' }),
    offlineExperimentResults: [secondSource],
    productionReferenceData: productionBaseline(),
    createdAt: '2026-07-27T17:00:00.000Z'
  }).result;
  const summary = runner.summarizeShadowResults([second, first]);

  assert.equal(summary.resultCount, 2);
  assert.deepEqual(summary.shadowExperimentIds, ['shadow-a', 'shadow-b']);
  assert.equal(summary.productionImpact, 'none');
  assert.equal(summary.decisionImpact, 'none');
});

test('module does not import production runtime or engine modules', () => {
  const originalLoad = Module._load;
  const loaded = [];
  Module._load = function patchedLoad(request, parent, isMain) {
    loaded.push(request);
    if (request.includes('server') || request.includes('scoutScanner') || request.includes('../engines/') || request.startsWith('../engines')) {
      throw new Error(`Unexpected production import: ${request}`);
    }
    return originalLoad.apply(this, arguments);
  };
  try {
    delete require.cache[require.resolve('../validation/shadowExperimentRunner')];
    const fresh = require('../validation/shadowExperimentRunner');
    assert.equal(typeof fresh.runShadowExperiment, 'function');
  } finally {
    Module._load = originalLoad;
    delete require.cache[require.resolve('../validation/shadowExperimentRunner')];
    require('../validation/shadowExperimentRunner');
  }
  assert.equal(loaded.some((request) => request.includes('server')), false);
});
