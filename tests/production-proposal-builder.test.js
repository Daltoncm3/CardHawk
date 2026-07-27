'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const builder = require('../validation/productionProposalBuilder');
const proposalContract = require('../validation/productionProposalContract');
const recommendationContract = require('../validation/calibrationRecommendationContract');
const experimentContract = require('../validation/calibrationExperimentContract');
const experimentRunner = require('../validation/calibrationExperimentRunner');
const shadowContract = require('../validation/shadowExperimentContract');
const shadowRunner = require('../validation/shadowExperimentRunner');

function recommendation(overrides = {}) {
  return recommendationContract.createCalibrationRecommendation({
    recommendationId: 'recommendation-confidence-001',
    recommendationBatchId: 'recommendation-batch-001',
    createdAt: '2026-07-27T18:00:00.000Z',
    sourceDatasetIds: ['dataset-001'],
    sourceDatasetFingerprints: ['dataset-fingerprint-001'],
    recommendationCategory: 'confidence_calibration_adjustment',
    affectedSubsystem: 'confidence',
    affectedRuleOrField: 'confidence_cap',
    finding: { category: 'false_positive_cluster' },
    evidenceSummary: { reviewedListings: 80 },
    sampleSize: { reviewedListings: 80 },
    coverage: { marketplace: ['ebay'] },
    currentBehavior: { confidenceCap: 'production_current' },
    proposedBehavior: { confidenceCap: 'candidate_shadow_cap' },
    expectedBenefit: { falsePositiveReduction: 'possible' },
    identifiedRisks: ['missed_opportunity_rate_may_increase'],
    confidence: 74,
    confidenceLevel: 'moderate',
    evidenceStrength: 'adequate',
    counterEvidence: [{ category: 'limited_segment_coverage' }],
    validationPlan: { type: 'offline_and_shadow' },
    rollbackPlan: { required: true },
    recommendationStatus: 'eligible_for_production_proposal',
    ...overrides
  });
}

function offlineExperiment(sourceRecommendation = recommendation(), overrides = {}) {
  return experimentContract.createCalibrationExperiment({
    experimentId: 'offline-experiment-confidence-001',
    experimentBatchId: 'offline-experiment-batch-001',
    createdAt: '2026-07-27T18:30:00.000Z',
    sourceRecommendationIds: [sourceRecommendation.recommendationId],
    sourceRecommendationFingerprints: [sourceRecommendation.recommendationFingerprint],
    experimentType: 'offline_replay',
    targetSubsystem: 'confidence',
    targetRule: 'confidence_cap',
    baselineBehavior: { confidenceCap: 'production_current' },
    proposedBehavior: { confidenceCap: 'candidate_shadow_cap' },
    replayDatasetIds: ['dataset-001'],
    holdoutDatasetIds: [],
    comparisonMetrics: [{ metric: 'falsePositiveRate' }],
    successCriteria: { falsePositiveRate: { max: 0.05 } },
    failureCriteria: { falsePositiveRate: { min: 0.12 } },
    regressionCriteria: { 'falsePositiveRate.delta': { max: 0 } },
    statisticalRequirements: { minimumReviewedListings: 50 },
    rollbackPlan: { required: true },
    experimentStatus: 'results_attached',
    ...overrides
  });
}

function offlineResult(sourceRecommendation = recommendation(), experiment = offlineExperiment(sourceRecommendation), overrides = {}) {
  return experimentRunner.buildExperimentResult({
    resultId: 'offline-result-confidence-001',
    experimentId: experiment.experimentId,
    createdAt: '2026-07-27T19:00:00.000Z',
    sourceDatasetIds: ['dataset-001'],
    sourceDatasetFingerprints: ['dataset-fingerprint-001'],
    sourceRecommendationIds: [sourceRecommendation.recommendationId],
    sourceRecommendationFingerprints: [sourceRecommendation.recommendationFingerprint],
    baselineMetrics: { falsePositiveRate: 0.09, productionCorrectRate: 0.82 },
    proposedMetrics: { falsePositiveRate: 0.04, productionCorrectRate: 0.91 },
    statisticalSummary: { reviewCount: 80 },
    successEvaluation: { status: 'passed' },
    failureEvaluation: { status: 'not_triggered' },
    regressionEvaluation: { status: 'passed' },
    recommendation: 'candidate_for_shadow_observation',
    limitations: ['offline_only'],
    ...overrides
  });
}

function shadowExperiment(sourceOfflineResult = offlineResult(), overrides = {}) {
  return shadowContract.createShadowExperiment({
    shadowExperimentId: 'shadow-experiment-confidence-001',
    shadowExperimentBatchId: 'shadow-experiment-batch-001',
    createdAt: '2026-07-27T19:30:00.000Z',
    sourceExperimentIds: [sourceOfflineResult.experimentId],
    sourceExperimentFingerprints: [sourceOfflineResult.resultFingerprint],
    targetSubsystem: 'confidence',
    observationScope: { mode: 'live_shadow_observation', minimumObservedListings: 120 },
    productionBaselineReference: { baselineId: 'production-baseline-001' },
    shadowConfigurationReference: { configurationId: 'shadow-confidence-cap-001' },
    observationMetrics: [{ metric: 'falsePositiveRate' }],
    comparisonMetrics: [{ metric: 'falsePositiveRate' }],
    regressionCriteria: { 'falsePositiveRate.delta': { max: 0 } },
    successCriteria: { falsePositiveRate: { max: 0.05 } },
    statisticalRequirements: { minimumObservedListings: 120 },
    monitoringRequirements: { watchFalsePositiveRate: true },
    rollbackPlan: { disableShadowObservation: true },
    shadowExperimentStatus: 'analysis_complete',
    approvalArtifact: {
      approved: true,
      approver: 'Dalton',
      approvedAt: '2026-07-27T19:45:00.000Z'
    },
    ...overrides
  });
}

function shadowResult(sourceShadowExperiment, sourceOfflineResult, overrides = {}) {
  return shadowRunner.runShadowExperiment({
    shadowExperiment: sourceShadowExperiment,
    offlineExperimentResults: [sourceOfflineResult],
    productionReferenceData: {
      baselineId: 'production-baseline-001',
      productionBaselineMetrics: { falsePositiveRate: 0.09, productionCorrectRate: 0.82 }
    },
    shadowMetrics: { falsePositiveRate: 0.04, productionCorrectRate: 0.91 },
    createdAt: '2026-07-27T20:00:00.000Z',
    shadowResultId: 'shadow-result-confidence-001',
    ...overrides
  }).result;
}

function evidenceChain(overrides = {}) {
  const rec = recommendation(overrides.recommendation);
  const exp = offlineExperiment(rec, overrides.offlineExperiment);
  const result = offlineResult(rec, exp, overrides.offlineResult);
  const shadowExp = shadowExperiment(result, overrides.shadowExperiment);
  const shadow = shadowResult(shadowExp, result, overrides.shadowResult);
  return { rec, exp, result, shadowExp, shadow };
}

function proposalInput(overrides = {}) {
  const chain = overrides.chain || evidenceChain(overrides.chainOverrides || {});
  return {
    proposalId: overrides.proposalId || 'production-proposal-confidence-001',
    proposalBatchId: overrides.proposalBatchId || 'production-proposal-batch-001',
    createdAt: overrides.createdAt || '2026-07-27T20:30:00.000Z',
    expiresAt: overrides.expiresAt || '2026-10-27T20:30:00.000Z',
    recommendations: [chain.rec],
    offlineExperiments: [chain.exp],
    offlineExperimentResults: [chain.result],
    shadowExperiments: [chain.shadowExp],
    shadowResults: [chain.shadow],
    proposedCodeOrConfigurationChange: { changeType: 'configuration_candidate', productionAuthority: 'none' },
    deploymentPrerequisites: [{ prerequisite: 'feature_flag_plan', satisfied: false }],
    requiredTestEvidence: [{ test: 'focused_confidence_tests', required: true }],
    monitoringPlan: { monitorFalsePositiveRate: true },
    ...overrides
  };
}

test('exports Production Proposal Builder public API and constants', () => {
  assert.equal(builder.PRODUCTION_PROPOSAL_BUILDER_SOURCE, 'production_proposal_builder');
  assert.equal(builder.PRODUCTION_PROPOSAL_BUILDER_SCHEMA_VERSION, '1.0.0');
  assert.equal(typeof builder.buildProductionProposal, 'function');
  assert.equal(typeof builder.buildProductionProposalBatch, 'function');
  assert.equal(typeof builder.validateProductionProposalBatch, 'function');
  assert.equal(typeof builder.summarizeProductionProposalBatch, 'function');
  assert.equal(typeof builder.buildSupportingEvidenceSummary, 'function');
  assert.equal(typeof builder.classifyProposalCategory, 'function');
  assert.equal(typeof builder.determineAffectedSubsystem, 'function');
  assert.equal(typeof builder.filterProductionProposals, 'function');
  assert.equal(typeof builder.sortProductionProposals, 'function');
  assert.equal(typeof builder.exportProductionProposalBatch, 'function');
  assert.equal(typeof builder.importProductionProposalBatch, 'function');
  assert.equal(typeof builder.buildProductionProposalBatchFingerprint, 'function');
});

test('builds a minimum valid proposal batch from governed evidence', () => {
  const batch = builder.buildProductionProposalBatch({
    proposalBatchId: 'production-proposal-batch-001',
    createdAt: '2026-07-27T20:30:00.000Z',
    proposalInputs: [proposalInput()]
  });
  const validation = builder.validateProductionProposalBatch(batch);

  assert.equal(batch.proposalCount, 1);
  assert.equal(batch.proposals[0].proposalCategory, 'confidence_calibration_change');
  assert.equal(batch.proposals[0].affectedSubsystem, 'confidence');
  assert.equal(batch.proposals[0].proposalStatus, 'ready_for_review');
  assert.equal(batch.productionImpact, 'none');
  assert.equal(batch.decisionImpact, 'none');
  assert.equal(batch.executionAuthority, 'none');
  assert.equal(validation.valid, true);
  assert.equal(batch.batchFingerprint, builder.buildProductionProposalBatchFingerprint(batch));
  assert.equal(Object.isFrozen(batch), true);
});

test('multiple proposals sort deterministically and produce stable fingerprints', () => {
  const identityChain = evidenceChain({
    recommendation: {
      recommendationId: 'recommendation-identity-001',
      recommendationCategory: 'identity_parsing_improvement',
      affectedSubsystem: 'identity_parser',
      affectedRuleOrField: 'title_token_handling'
    },
    shadowResult: { shadowResultId: 'shadow-result-identity-001' }
  });
  const first = builder.buildProductionProposalBatch({
    proposalBatchId: 'batch-stable',
    createdAt: '2026-07-27T20:30:00.000Z',
    proposalInputs: [
      proposalInput({ proposalId: 'proposal-z', chain: identityChain }),
      proposalInput({ proposalId: 'proposal-a' })
    ]
  });
  const second = builder.buildProductionProposalBatch({
    proposalBatchId: 'batch-stable',
    createdAt: '2026-07-27T20:30:00.000Z',
    proposalInputs: [
      proposalInput({ proposalId: 'proposal-a' }),
      proposalInput({ proposalId: 'proposal-z', chain: identityChain })
    ]
  });

  assert.deepEqual(first, second);
  assert.deepEqual(first.proposals.map((proposal) => proposal.proposalId), ['proposal-a', 'proposal-z']);
  assert.equal(first.proposalCount, 2);
  assert.equal(first.categorySummary.confidence_calibration_change, 1);
  assert.equal(first.categorySummary.identity_parser_change, 1);
});

test('supporting evidence summary validates required source artifacts', () => {
  const input = proposalInput();
  const summary = builder.buildSupportingEvidenceSummary(input);
  const missing = builder.buildSupportingEvidenceSummary({
    recommendations: [],
    shadowResults: []
  });

  assert.equal(summary.evidenceComplete, true);
  assert.equal(summary.shadowResultCount, 1);
  assert.equal(summary.noBlockingShadowFailure, true);
  assert.equal(missing.evidenceComplete, false);
  assert.equal(missing.recommendationCount, 0);
});

test('classifies no-change proposals when evidence supports maintaining current behavior', () => {
  const chain = evidenceChain({
    recommendation: {
      recommendationId: 'recommendation-no-change-001',
      recommendationCategory: 'no_change_recommendation',
      affectedSubsystem: 'deal_gate'
    },
    shadowResult: { shadowResultId: 'shadow-result-no-change-001' }
  });
  const built = builder.buildProductionProposal(proposalInput({
    proposalId: 'proposal-no-change',
    chain
  }));

  assert.equal(built.proposal.proposalCategory, 'no_change');
  assert.equal(built.proposal.proposalStatus, 'ready_for_review');
  assert.equal(built.validation.proposal.valid, true);
});

test('missing evidence remains explicit and batch validation rejects incomplete proposals', () => {
  const built = builder.buildProductionProposal({
    proposalId: 'proposal-incomplete',
    proposalBatchId: 'batch-incomplete',
    createdAt: '2026-07-27T20:30:00.000Z',
    recommendations: [],
    shadowResults: []
  });
  const batch = builder.buildProductionProposalBatch({
    proposalBatchId: 'batch-incomplete',
    createdAt: '2026-07-27T20:30:00.000Z',
    proposalInputs: [{
      proposalId: 'proposal-incomplete',
      proposalBatchId: 'batch-incomplete',
      createdAt: '2026-07-27T20:30:00.000Z',
      recommendations: [],
      shadowResults: []
    }]
  });
  const validation = builder.validateProductionProposalBatch(batch);

  assert.equal(built.validation.sourceEvidence.valid, false);
  assert.equal(built.validation.sourceEvidence.errors.some((error) => error.code === 'missing_recommendation_evidence'), true);
  assert.equal(built.proposal.proposalStatus, 'evidence_incomplete');
  assert.equal(validation.valid, false);
  assert.equal(validation.reasonCodes.includes('proposal_missing_required_evidence'), true);
  assert.deepEqual(validation.invalidProposalIndexes, [0]);
});

test('builder never mutates source artifacts and returns immutable outputs', () => {
  const input = proposalInput();
  const before = JSON.stringify(input);
  const built = builder.buildProductionProposal(input);

  assert.equal(JSON.stringify(input), before);
  assert.equal(Object.isFrozen(built), true);
  assert.equal(Object.isFrozen(built.proposal), true);
  assert.equal(Object.isFrozen(built.proposal.supportingEvidence), true);
});

test('filtering and sorting use deterministic proposal fields', () => {
  const first = builder.buildProductionProposal(proposalInput({ proposalId: 'proposal-confidence' })).proposal;
  const secondChain = evidenceChain({
    recommendation: {
      recommendationId: 'recommendation-risk-001',
      recommendationCategory: 'risk_rule_adjustment',
      affectedSubsystem: 'risk'
    },
    shadowResult: { shadowResultId: 'shadow-result-risk-001' }
  });
  const second = builder.buildProductionProposal(proposalInput({
    proposalId: 'proposal-risk',
    chain: secondChain
  })).proposal;
  const sorted = builder.sortProductionProposals([second, first]);
  const filtered = builder.filterProductionProposals([second, first], {
    affectedSubsystem: 'confidence',
    requiresShadowEvidence: true
  });

  assert.deepEqual(sorted.map((proposal) => proposal.proposalId), ['proposal-confidence', 'proposal-risk']);
  assert.deepEqual(filtered.map((proposal) => proposal.proposalId), ['proposal-confidence']);
});

test('export and import preserve proposal batch JSON shape', () => {
  const batch = builder.buildProductionProposalBatch({
    proposalBatchId: 'batch-export',
    createdAt: '2026-07-27T20:30:00.000Z',
    proposalInputs: [proposalInput()]
  });
  const serialized = builder.exportProductionProposalBatch(batch);
  const imported = builder.importProductionProposalBatch(serialized);

  assert.deepEqual(imported, batch);
  assert.equal(builder.validateProductionProposalBatch(imported).valid, true);
});

test('invalid batches report authority violations and fingerprint mismatches', () => {
  const batch = builder.buildProductionProposalBatch({
    proposalBatchId: 'batch-invalid',
    createdAt: '2026-07-27T20:30:00.000Z',
    proposalInputs: [proposalInput()]
  });
  const invalid = {
    ...batch,
    productionImpact: 'changes_production',
    proposals: [{
      ...batch.proposals[0],
      executionAuthority: 'deploys_change',
      proposalFingerprint: 'stale'
    }],
    batchFingerprint: 'stale'
  };
  const validation = builder.validateProductionProposalBatch(invalid);

  assert.equal(validation.valid, false);
  assert.equal(validation.reasonCodes.includes('invalid_batch_authority'), true);
  assert.equal(validation.reasonCodes.includes('invalid_execution_authority'), true);
  assert.equal(validation.reasonCodes.includes('batch_fingerprint_mismatch'), true);
  assert.equal(validation.authorityBoundaryViolations.length >= 2, true);
  assert.equal(validation.fingerprintMismatches.length >= 2, true);
});

test('module does not import production runtime, deployment, or engine modules', () => {
  const loaded = [];
  const originalLoad = Module._load;
  try {
    Module._load = function patchedLoad(request, parent, isMain) {
      loaded.push(request);
      return originalLoad.apply(this, arguments);
    };
    delete require.cache[require.resolve('../validation/productionProposalBuilder')];
    require('../validation/productionProposalBuilder');
  } finally {
    Module._load = originalLoad;
  }

  assert.equal(loaded.some((request) => request.includes('server')), false);
  assert.equal(loaded.some((request) => request.includes('engines/')), false);
  assert.equal(loaded.some((request) => request.includes('services/')), false);
  assert.equal(loaded.some((request) => request.includes('deploy')), false);
});
