'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const runner = require('../validation/calibrationExperimentRunner');
const experimentContract = require('../validation/calibrationExperimentContract');
const recommendationContract = require('../validation/calibrationRecommendationContract');
const datasetBuilder = require('../validation/calibrationDatasetBuilder');
const batchBuilder = require('../validation/realListingReviewBatchBuilder');
const reviewContract = require('../validation/realListingDecisionReviewContract');

function listingRecord(id, overrides = {}) {
  const supported = overrides.supported !== false;
  return {
    packageId: `package-${id}`,
    marketplace: 'ebay',
    createdAt: '2026-07-27T10:00:00.000Z',
    capturedAt: '2026-07-27T09:50:00.000Z',
    listingSnapshot: {
      ebayItemId: id,
      title: `Experiment Fixture ${id} PSA 10`,
      url: `https://example.test/experiment/${id}`,
      askingPrice: 100,
      shipping: 5,
      totalCost: 105,
      marketplace: 'ebay',
      parsed: {
        player: `Fixture ${id}`,
        year: '2020',
        setName: 'Prizm',
        cardNumber: id,
        gradeCompany: 'PSA',
        grade: 10
      }
    },
    canonicalIdentity: {
      canonicalIdentityKey: `ci:v1:experiment:${id}`,
      eligibility: { exactCompEligible: true, valuationEligible: true }
    },
    identityDiagnostics: {
      diagnosticStatus: 'exact',
      ambiguityLevel: 'none',
      fieldsConfirmed: ['subject', 'year', 'set'],
      fieldsMissing: [],
      fieldsConflicting: [],
      warnings: [],
      blockingIssues: []
    },
    productionValuation: { estimatedValue: 180, marketValue: 180, estimatedProfit: 30 },
    roiData: { roi: 0.25, roiPercent: 25 },
    productionConfidence: { confidence: overrides.confidence ?? 80 },
    dealGate: {
      passed: supported,
      buyNowAllowed: supported,
      decision: supported ? 'BUY_NOW' : 'REJECT',
      reasons: supported ? [] : ['fixture_rejection']
    },
    shadowSoldComparison: { acceptedExactMatches: [{ recordId: `${id}-sold-1` }] },
    shadowValuation: { insufficientEvidence: false, recommendedMarketValue: 175 },
    evidenceReadinessDiagnostics: { readinessStatus: 'ready' },
    notificationEligibility: { eligible: supported },
    shadowRecommendationPosture: supported ? 'BUY_NOW' : 'REJECT',
    reviewOverrides: overrides.reviewOverrides || {}
  };
}

function humanReview(overrides = {}) {
  return reviewContract.createHumanReviewRecord({
    reviewer: 'Dalton',
    reviewedAt: '2026-07-27T12:00:00.000Z',
    identityCorrect: 'yes',
    evidenceSufficient: 'yes',
    valuationReasonable: 'yes',
    confidenceAppropriate: 'yes',
    wouldBuy: overrides.wouldBuy || 'yes',
    wouldNotify: overrides.wouldNotify || 'yes',
    productionCorrect: overrides.productionCorrect || 'yes',
    shadowBetter: overrides.shadowBetter || 'no',
    buyNowQuality: overrides.buyNowQuality || 'correct',
    dealGateQuality: overrides.dealGateQuality || 'correct',
    reasonCategories: ['weak_evidence'],
    disagreementCategories: ['valuation_disagreement'],
    reviewConfidence: 90,
    notes: 'Offline calibration fixture.',
    ...overrides
  });
}

function dataset(datasetId, records) {
  const batchId = `${datasetId}-review-batch`;
  const batch = batchBuilder.buildRealListingReviewBatch(records, {
    batchId,
    createdAt: '2026-07-27T10:05:00.000Z',
    requestedCandidateCount: records.length
  });
  const reviewedPackages = batch.packages.map((reviewPackage, index) => (
    reviewContract.attachHumanReviewRecord(reviewPackage, humanReview(records[index].reviewOverrides || {}))
  ));
  return datasetBuilder.buildCalibrationDataset({
    workspace: {
      workspaceId: `${datasetId}-workspace`,
      batchId,
      workspaceFingerprint: `${datasetId}-workspace-fingerprint`
    },
    batch,
    packages: reviewedPackages
  }, {
    datasetId,
    createdAt: '2026-07-27T13:00:00.000Z'
  });
}

function experiment(overrides = {}) {
  return experimentContract.createCalibrationExperiment({
    experimentId: 'experiment-a',
    experimentBatchId: 'experiment-batch-a',
    createdAt: '2026-07-27T14:00:00.000Z',
    sourceRecommendationIds: ['recommendation-a'],
    sourceRecommendationFingerprints: ['recommendation-fingerprint-a'],
    experimentType: 'offline_replay',
    targetSubsystem: 'confidence',
    targetRule: 'confidence_cap',
    baselineBehavior: { mode: 'current' },
    proposedBehavior: {
      mode: 'offline_candidate',
      metrics: {
        productionCorrectRate: 1,
        falsePositiveRate: 0,
        buyNowPrecision: 1
      }
    },
    replayDatasetIds: ['dataset-a'],
    holdoutDatasetIds: [],
    comparisonMetrics: [{ metric: 'falsePositiveRate' }],
    successCriteria: { falsePositiveRate: { max: 0.05 }, buyNowPrecision: { min: 0.9 } },
    failureCriteria: { falsePositiveRate: { min: 0.25 } },
    regressionCriteria: { 'productionCorrectRate.delta': { min: -0.05 } },
    statisticalRequirements: { minimumReviewedRecords: 1 },
    risks: ['offline_only'],
    assumptions: ['reviewed_dataset'],
    limitations: ['fixture_only'],
    rollbackPlan: { requiredBeforeProductionProposal: true },
    experimentStatus: 'approved_for_offline_run',
    ...overrides
  });
}

function recommendation(overrides = {}) {
  return recommendationContract.createCalibrationRecommendation({
    recommendationId: 'recommendation-a',
    recommendationBatchId: 'recommendation-batch-a',
    createdAt: '2026-07-27T13:30:00.000Z',
    sourceDatasetIds: ['dataset-a'],
    sourceDatasetFingerprints: ['dataset-fingerprint-a'],
    recommendationCategory: 'confidence_calibration_adjustment',
    affectedSubsystem: 'confidence',
    affectedRuleOrField: 'confidence_cap',
    finding: { summary: 'Offline fixture recommendation.' },
    evidenceSummary: { reviewedRecords: 2 },
    sampleSize: { reviewedRecords: 2 },
    coverage: { identities: 2 },
    currentBehavior: { mode: 'current' },
    proposedBehavior: { mode: 'offline_candidate' },
    expectedBenefit: { falsePositiveReduction: true },
    identifiedRisks: ['missed_opportunity'],
    confidence: 70,
    confidenceLevel: 'moderate',
    evidenceStrength: 'limited',
    counterEvidence: [],
    prerequisites: [],
    validationPlan: { offlineReplay: true },
    rollbackPlan: { required: true },
    recommendationStatus: 'approved_for_offline_experiment',
    ...overrides
  });
}

test('exports Calibration Experiment Runner public API and constants', () => {
  assert.equal(runner.CALIBRATION_EXPERIMENT_RUNNER_SOURCE, 'calibration_experiment_runner');
  assert.equal(runner.CALIBRATION_EXPERIMENT_RESULT_SCHEMA_VERSION, '1.0.0');
  assert.equal(typeof runner.runCalibrationExperiment, 'function');
  assert.equal(typeof runner.validateExperimentInputs, 'function');
  assert.equal(typeof runner.buildExperimentBaseline, 'function');
  assert.equal(typeof runner.buildExperimentComparison, 'function');
  assert.equal(typeof runner.evaluateSuccessCriteria, 'function');
  assert.equal(typeof runner.evaluateFailureCriteria, 'function');
  assert.equal(typeof runner.evaluateRegressionCriteria, 'function');
  assert.equal(typeof runner.buildExperimentResult, 'function');
  assert.equal(typeof runner.summarizeExperimentResults, 'function');
  assert.equal(typeof runner.exportExperimentResults, 'function');
  assert.equal(typeof runner.importExperimentResults, 'function');
  assert.equal(typeof runner.buildExperimentResultFingerprint, 'function');
});

test('runs a minimum offline experiment against immutable calibration data', () => {
  const inputDataset = dataset('dataset-a', [listingRecord('1')]);
  const inputExperiment = experiment();
  const result = runner.runCalibrationExperiment({
    experiment: inputExperiment,
    datasets: [inputDataset],
    recommendations: [recommendation()],
    createdAt: '2026-07-27T15:00:00.000Z',
    resultId: 'result-a'
  });

  assert.equal(result.validation.valid, true, JSON.stringify(result.validation, null, 2));
  assert.equal(result.result.resultId, 'result-a');
  assert.equal(result.result.experimentId, 'experiment-a');
  assert.equal(result.result.baselineMetrics.reviewCount, 1);
  assert.equal(result.result.successEvaluation.status, 'passed');
  assert.equal(result.result.failureEvaluation.status, 'not_triggered');
  assert.equal(result.result.productionImpact, 'none');
  assert.equal(result.result.decisionImpact, 'none');
  assert.equal(Object.isFrozen(result.result), true);
});

test('supports multiple datasets with deterministic ordering and fingerprints', () => {
  const first = dataset('dataset-b', [listingRecord('2', {
    reviewOverrides: { productionCorrect: 'no', buyNowQuality: 'false_positive' }
  })]);
  const second = dataset('dataset-a', [listingRecord('1')]);
  const inputExperiment = experiment({
    replayDatasetIds: ['dataset-a', 'dataset-b'],
    proposedBehavior: { metrics: { productionCorrectRate: 0.5, falsePositiveRate: 0.5 } },
    successCriteria: { productionCorrectRate: { min: 0.5 } },
    failureCriteria: { falsePositiveRate: { min: 0.75 } },
    regressionCriteria: { 'productionCorrectRate.delta': { min: -0.5 } }
  });
  const firstRun = runner.runCalibrationExperiment({
    experiment: inputExperiment,
    datasets: [first, second],
    createdAt: '2026-07-27T15:00:00.000Z'
  });
  const secondRun = runner.runCalibrationExperiment({
    experiment: inputExperiment,
    datasets: [second, first],
    createdAt: '2026-07-27T15:00:00.000Z'
  });

  assert.deepEqual(firstRun.result, secondRun.result);
  assert.equal(firstRun.result.baselineMetrics.reviewCount, 2);
  assert.equal(firstRun.result.baselineMetrics.productionCorrect.no, 1);
  assert.equal(firstRun.result.resultFingerprint, runner.buildExperimentResultFingerprint(firstRun.result));
});

test('explicit timestamps keep result fingerprints stable', () => {
  const inputDataset = dataset('dataset-a', [listingRecord('1')]);
  const inputExperiment = experiment();
  const first = runner.runCalibrationExperiment({ experiment: inputExperiment, datasets: [inputDataset], createdAt: '2026-07-27T15:00:00.000Z' });
  const second = runner.runCalibrationExperiment({ experiment: inputExperiment, datasets: [inputDataset], createdAt: '2026-07-27T15:00:00.000Z' });

  assert.deepEqual(first.result, second.result);
  assert.equal(first.result.resultFingerprint, second.result.resultFingerprint);
});

test('failure criteria and regression criteria are detected without changing authority', () => {
  const inputDataset = dataset('dataset-a', [listingRecord('1')]);
  const inputExperiment = experiment({
    proposedBehavior: { metrics: { productionCorrectRate: 0.5, falsePositiveRate: 0.5 } },
    successCriteria: { productionCorrectRate: { min: 0.9 } },
    failureCriteria: { falsePositiveRate: { min: 0.25 } },
    regressionCriteria: { 'productionCorrectRate.delta': { min: -0.1 } }
  });
  const result = runner.runCalibrationExperiment({
    experiment: inputExperiment,
    datasets: [inputDataset],
    createdAt: '2026-07-27T15:00:00.000Z'
  }).result;

  assert.equal(result.successEvaluation.status, 'failed');
  assert.equal(result.failureEvaluation.status, 'triggered');
  assert.equal(result.regressionEvaluation.status, 'failed');
  assert.equal(result.recommendation, 'do_not_advance_failure_criteria_triggered');
  assert.equal(result.productionImpact, 'none');
  assert.equal(result.decisionImpact, 'none');
});

test('unknown proposed metrics remain unknown and never inferred', () => {
  const inputDataset = dataset('dataset-a', [listingRecord('1')]);
  const inputExperiment = experiment({
    proposedBehavior: {},
    successCriteria: { falsePositiveRate: { max: 0.1 } },
    failureCriteria: {},
    regressionCriteria: {}
  });
  const result = runner.runCalibrationExperiment({
    experiment: inputExperiment,
    datasets: [inputDataset],
    createdAt: '2026-07-27T15:00:00.000Z'
  }).result;

  assert.deepEqual(result.proposedMetrics, {});
  assert.equal(result.successEvaluation.status, 'failed');
  assert.deepEqual(result.successEvaluation.evaluations[0].failures, ['metric_unknown']);
  assert.equal(result.statisticalSummary.proposedMetricAvailability, 'unknown');
});

test('runner never mutates immutable experiments, datasets, or recommendations', () => {
  const inputDataset = dataset('dataset-a', [listingRecord('1')]);
  const inputExperiment = experiment();
  const inputRecommendation = recommendation();
  const before = JSON.stringify({ inputDataset, inputExperiment, inputRecommendation });

  const result = runner.runCalibrationExperiment({
    experiment: inputExperiment,
    datasets: [inputDataset],
    recommendations: [inputRecommendation],
    createdAt: '2026-07-27T15:00:00.000Z'
  });

  assert.equal(JSON.stringify({ inputDataset, inputExperiment, inputRecommendation }), before);
  assert.equal(Object.isFrozen(result.result), true);
  assert.equal(Object.isFrozen(result.result.baselineMetrics), true);
});

test('invalid inputs return structured validation references', () => {
  const invalidExperiment = {
    ...experiment(),
    productionImpact: 'changes_runtime',
    experimentFingerprint: 'stale'
  };
  const invalidDataset = {
    ...dataset('dataset-a', [listingRecord('1')]),
    datasetFingerprint: 'stale'
  };
  const invalidRecommendation = {
    ...recommendation(),
    decisionImpact: 'changes_decision',
    recommendationFingerprint: 'stale'
  };
  const validation = runner.validateExperimentInputs({
    experiment: invalidExperiment,
    datasets: [invalidDataset],
    recommendations: [invalidRecommendation]
  });

  assert.equal(validation.valid, false);
  assert.equal(validation.reasonCodes.includes('invalid_experiment'), true);
  assert.equal(validation.reasonCodes.includes('invalid_dataset'), true);
  assert.equal(validation.reasonCodes.includes('invalid_recommendation'), true);
  assert.equal(validation.invalidExperimentReferences.length, 1);
  assert.equal(validation.invalidDatasetReferences.length, 1);
  assert.equal(validation.invalidRecommendationReferences.length, 1);
});

test('export and import preserve experiment result JSON shape', () => {
  const result = runner.runCalibrationExperiment({
    experiment: experiment(),
    datasets: [dataset('dataset-a', [listingRecord('1')])],
    createdAt: '2026-07-27T15:00:00.000Z'
  }).result;
  const serialized = runner.exportExperimentResults(result);
  const imported = runner.importExperimentResults(serialized);

  assert.deepEqual(imported, result);
  assert.equal(imported.resultFingerprint, runner.buildExperimentResultFingerprint(imported));
});

test('summary aggregates immutable result artifacts deterministically', () => {
  const first = runner.runCalibrationExperiment({
    experiment: experiment({ experimentId: 'experiment-a' }),
    datasets: [dataset('dataset-a', [listingRecord('1')])],
    createdAt: '2026-07-27T15:00:00.000Z'
  }).result;
  const second = runner.runCalibrationExperiment({
    experiment: experiment({ experimentId: 'experiment-b' }),
    datasets: [dataset('dataset-b', [listingRecord('2')])],
    createdAt: '2026-07-27T15:00:00.000Z'
  }).result;
  const summary = runner.summarizeExperimentResults([second, first]);

  assert.equal(summary.resultCount, 2);
  assert.deepEqual(summary.experimentIds, ['experiment-a', 'experiment-b']);
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
    delete require.cache[require.resolve('../validation/calibrationExperimentRunner')];
    const fresh = require('../validation/calibrationExperimentRunner');
    assert.equal(typeof fresh.runCalibrationExperiment, 'function');
  } finally {
    Module._load = originalLoad;
    delete require.cache[require.resolve('../validation/calibrationExperimentRunner')];
    require('../validation/calibrationExperimentRunner');
  }
  assert.equal(loaded.some((request) => request.includes('server')), false);
});
