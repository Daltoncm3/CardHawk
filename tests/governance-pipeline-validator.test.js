'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const validator = require('../validation/governancePipelineValidator');
const reviewContract = require('../validation/realListingDecisionReviewContract');
const batchBuilder = require('../validation/realListingReviewBatchBuilder');
const workspaceBuilder = require('../validation/daltonReviewWorkspace');
const datasetBuilder = require('../validation/calibrationDatasetBuilder');
const recommendationContract = require('../validation/calibrationRecommendationContract');
const experimentContract = require('../validation/calibrationExperimentContract');
const experimentRunner = require('../validation/calibrationExperimentRunner');
const shadowContract = require('../validation/shadowExperimentContract');
const shadowRunner = require('../validation/shadowExperimentRunner');
const proposalContract = require('../validation/productionProposalContract');
const approvalArtifact = require('../validation/productionApprovalArtifact');
const deploymentValidation = require('../validation/deploymentValidationArtifact');

function listingRecord(overrides = {}) {
  return {
    packageId: 'review-package-001',
    reviewBatchId: 'review-batch-001',
    marketplace: 'ebay',
    createdAt: '2026-07-27T10:00:00.000Z',
    capturedAt: '2026-07-27T09:58:00.000Z',
    listingSnapshot: {
      ebayItemId: 'listing-001',
      title: 'Governance Pipeline Fixture PSA 10',
      url: 'https://example.test/listing-001',
      askingPrice: 100,
      shipping: 5,
      totalCost: 105,
      marketplace: 'ebay'
    },
    canonicalIdentity: {
      canonicalIdentityKey: 'ci:v1:governance:listing-001',
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
    productionConfidence: { confidence: 80 },
    evidenceSummary: { trueSoldCount: 5 },
    comparableSummary: { exactComparableCount: 5 },
    dealGateOutcome: { passed: true, buyNowAllowed: true, decision: 'BUY_NOW', reasons: [] },
    notificationEligibility: { eligible: true },
    shadowSoldComparison: { acceptedExactMatches: [{ recordId: 'sold-001' }] },
    shadowValuation: { recommendedMarketValue: 175 },
    evidenceReadinessDiagnostics: { readinessStatus: 'ready' },
    confidenceCalibrationDiagnostics: { calibrationStatus: 'calibrated' },
    opportunityFalsePositiveDiagnostics: { falsePositiveRiskStatus: 'low_risk' },
    shadowRecommendationPosture: 'BUY_NOW',
    ...overrides
  };
}

function humanReview(overrides = {}) {
  return reviewContract.createHumanReviewRecord({
    reviewer: 'Dalton',
    reviewedAt: '2026-07-27T11:00:00.000Z',
    identityCorrect: 'yes',
    evidenceSufficient: 'yes',
    valuationReasonable: 'yes',
    confidenceAppropriate: 'yes',
    wouldBuy: 'yes',
    wouldNotify: 'yes',
    productionCorrect: 'yes',
    shadowBetter: 'no',
    buyNowQuality: 'correct',
    dealGateQuality: 'correct',
    reasonCategories: ['weak_evidence'],
    disagreementCategories: ['valuation_disagreement'],
    reviewConfidence: 90,
    notes: 'Governance pipeline fixture review.',
    ...overrides
  });
}

function buildPipeline(overrides = {}) {
  const baseReviewBatch = batchBuilder.buildRealListingReviewBatch([listingRecord()], {
    batchId: 'review-batch-001',
    createdAt: '2026-07-27T11:05:00.000Z',
    requestedCandidateCount: 1
  });
  const reviewPackage = reviewContract.attachHumanReviewRecord(
    baseReviewBatch.packages[0],
    humanReview()
  );
  const reviewBatchCore = {
    ...baseReviewBatch,
    reviewStatusSummary: { reviewed: 1 },
    packages: [reviewPackage]
  };
  delete reviewBatchCore.batchFingerprint;
  const reviewBatch = {
    ...reviewBatchCore,
    batchFingerprint: batchBuilder.buildReviewBatchFingerprint(reviewBatchCore)
  };
  const reviewWorkspace = workspaceBuilder.buildDaltonReviewWorkspace(reviewBatch, {
    workspaceId: 'review-workspace-001',
    createdAt: '2026-07-27T11:10:00.000Z'
  });
  const calibrationDataset = datasetBuilder.buildCalibrationDataset({
    workspace: reviewWorkspace,
    batch: reviewBatch,
    packages: [reviewPackage]
  }, {
    datasetId: 'calibration-dataset-001',
    createdAt: '2026-07-27T12:00:00.000Z'
  });
  const calibrationRecommendation = recommendationContract.createCalibrationRecommendation({
    recommendationId: 'recommendation-001',
    recommendationBatchId: 'recommendation-batch-001',
    createdAt: '2026-07-27T12:30:00.000Z',
    sourceDatasetIds: [calibrationDataset.datasetId],
    sourceDatasetFingerprints: [calibrationDataset.datasetFingerprint],
    recommendationCategory: 'confidence_calibration_adjustment',
    affectedSubsystem: 'confidence',
    affectedRuleOrField: 'confidence_cap',
    finding: { reviewedEvidence: true },
    evidenceSummary: { reviewedRecords: 1 },
    sampleSize: { reviewedRecords: 1 },
    coverage: { marketplace: ['ebay'] },
    currentBehavior: { mode: 'production_current' },
    proposedBehavior: { mode: 'offline_candidate' },
    expectedBenefit: { falsePositiveReduction: 'possible' },
    identifiedRisks: ['missed_opportunity'],
    confidence: 70,
    confidenceLevel: 'moderate',
    evidenceStrength: 'limited',
    counterEvidence: [],
    prerequisites: [],
    validationPlan: { offlineReplay: true },
    rollbackPlan: { required: true },
    recommendationStatus: 'approved_for_offline_experiment'
  });
  const offlineExperiment = experimentContract.createCalibrationExperiment({
    experimentId: 'offline-experiment-001',
    experimentBatchId: 'offline-experiment-batch-001',
    createdAt: '2026-07-27T13:00:00.000Z',
    sourceRecommendationIds: [calibrationRecommendation.recommendationId],
    sourceRecommendationFingerprints: [calibrationRecommendation.recommendationFingerprint],
    experimentType: 'offline_replay',
    targetSubsystem: 'confidence',
    targetRule: 'confidence_cap',
    baselineBehavior: { mode: 'current' },
    proposedBehavior: { mode: 'offline_candidate' },
    replayDatasetIds: [calibrationDataset.datasetId],
    holdoutDatasetIds: [],
    comparisonMetrics: [{ metric: 'falsePositiveRate' }],
    successCriteria: { falsePositiveRate: { max: 0.1 } },
    failureCriteria: { falsePositiveRate: { min: 0.3 } },
    regressionCriteria: { 'productionCorrectRate.delta': { min: -0.05 } },
    statisticalRequirements: { minimumReviewedRecords: 1 },
    risks: ['offline_only'],
    assumptions: ['reviewed_dataset'],
    limitations: ['small_fixture'],
    rollbackPlan: { requiredBeforeProductionProposal: true },
    experimentStatus: 'approved_for_offline_run',
    approvalArtifact: {
      approved: true,
      approver: 'Dalton',
      approvedAt: '2026-07-27T13:10:00.000Z'
    }
  });
  const offlineExperimentResult = experimentRunner.buildExperimentResult({
    resultId: 'offline-result-001',
    experimentId: offlineExperiment.experimentId,
    createdAt: '2026-07-27T14:00:00.000Z',
    sourceDatasetIds: [calibrationDataset.datasetId],
    sourceDatasetFingerprints: [calibrationDataset.datasetFingerprint],
    sourceRecommendationIds: [calibrationRecommendation.recommendationId],
    sourceRecommendationFingerprints: [calibrationRecommendation.recommendationFingerprint],
    baselineMetrics: { falsePositiveRate: 0.08 },
    proposedMetrics: { falsePositiveRate: 0.04 },
    comparisonMetrics: { falsePositiveRate: { delta: -0.04 } },
    regressions: [],
    improvements: [{ metric: 'falsePositiveRate' }],
    statisticalSummary: { reviewCount: 1 },
    successEvaluation: { status: 'passed' },
    failureEvaluation: { status: 'not_triggered' },
    regressionEvaluation: { status: 'passed' },
    recommendation: 'candidate_for_shadow_observation',
    limitations: ['fixture_only']
  });
  const shadowExperiment = shadowContract.createShadowExperiment({
    shadowExperimentId: 'shadow-experiment-001',
    shadowExperimentBatchId: 'shadow-experiment-batch-001',
    createdAt: '2026-07-27T15:00:00.000Z',
    sourceExperimentIds: [offlineExperiment.experimentId],
    sourceExperimentFingerprints: [offlineExperiment.experimentFingerprint],
    targetSubsystem: 'confidence',
    observationScope: { mode: 'shadow_observation', minimumObservedListings: 1 },
    productionBaselineReference: { baselineId: 'production-baseline-001' },
    shadowConfigurationReference: { configurationId: 'shadow-config-001', productionAuthority: 'none' },
    observationMetrics: [{ metric: 'falsePositiveRate' }],
    comparisonMetrics: [{ metric: 'agreementRate' }],
    regressionCriteria: { falsePositiveRate: { max: 0.1 } },
    successCriteria: { agreementRate: { min: 0.9 } },
    statisticalRequirements: { minimumObservedListings: 1 },
    monitoringRequirements: { observeOnly: true },
    rollbackPlan: { disableShadowObservation: true },
    shadowExperimentStatus: 'analysis_complete',
    approvalArtifact: {
      approved: true,
      approver: 'Dalton',
      approvedAt: '2026-07-27T15:10:00.000Z'
    }
  });
  const shadowResult = shadowRunner.buildShadowResult({
    shadowResultId: 'shadow-result-001',
    shadowExperimentId: shadowExperiment.shadowExperimentId,
    createdAt: '2026-07-27T16:00:00.000Z',
    productionBaselineMetrics: { falsePositiveRate: 0.08 },
    shadowMetrics: { falsePositiveRate: 0.04, agreementRate: 0.95 },
    comparisonMetrics: { falsePositiveRate: { delta: -0.04 } },
    improvements: [{ metric: 'falsePositiveRate' }],
    regressions: [],
    statisticalSummary: { observedListings: 10 },
    successEvaluation: { status: 'passed' },
    failureEvaluation: { status: 'not_triggered' },
    regressionEvaluation: { status: 'passed' },
    recommendation: 'candidate_for_production_proposal',
    limitations: ['fixture_only'],
    observationSummary: { observedListings: 10 }
  });
  const productionProposal = proposalContract.createProductionProposal({
    proposalId: 'production-proposal-001',
    proposalBatchId: 'production-proposal-batch-001',
    createdAt: '2026-07-27T17:00:00.000Z',
    expiresAt: '2026-10-27T17:00:00.000Z',
    sourceRecommendationIds: [calibrationRecommendation.recommendationId],
    sourceRecommendationFingerprints: [calibrationRecommendation.recommendationFingerprint],
    sourceOfflineExperimentIds: [offlineExperiment.experimentId],
    sourceOfflineExperimentFingerprints: [offlineExperiment.experimentFingerprint],
    sourceShadowExperimentIds: [shadowExperiment.shadowExperimentId],
    sourceShadowExperimentFingerprints: [shadowExperiment.shadowExperimentFingerprint],
    sourceShadowResultIds: [shadowResult.shadowResultId],
    sourceShadowResultFingerprints: [shadowResult.shadowResultFingerprint],
    affectedSubsystem: 'confidence',
    affectedRuleOrField: 'confidence_cap',
    proposalCategory: 'confidence_calibration_change',
    currentBehavior: { mode: 'production_current' },
    proposedBehavior: { mode: 'candidate_change' },
    proposedCodeOrConfigurationChange: { changeType: 'configuration_candidate', productionAuthority: 'none' },
    expectedBenefit: { falsePositiveReduction: 'possible' },
    supportingEvidence: { shadowResult: shadowResult.shadowResultId },
    counterEvidence: [],
    sampleSize: { observedListings: 10 },
    coverage: { marketplace: ['ebay'] },
    confidence: 70,
    confidenceLevel: 'moderate',
    identifiedRisks: [{ risk: 'missed_opportunity' }],
    knownLimitations: [{ limitation: 'fixture_only' }],
    regressionRisks: [{ risk: 'precision_regression' }],
    deploymentPrerequisites: [{ prerequisite: 'explicit_validation' }],
    validationChecklist: [{ check: 'full_test_suite', required: true }],
    requiredTestEvidence: [{ test: 'focused_governance_tests', required: true }],
    monitoringPlan: { observe: true },
    rollbackPlan: { required: true },
    approvalRequirements: [{ approver: 'Dalton', required: true }],
    supportingEvidenceReferences: [{
      referenceId: 'shadow-result-reference-001',
      referenceType: 'shadow_result_artifact',
      sourceId: shadowResult.shadowResultId,
      sourceFingerprint: shadowResult.shadowResultFingerprint,
      evidenceStatus: 'available'
    }],
    proposalStatus: 'ready_for_review'
  });
  const productionApprovalArtifact = approvalArtifact.createProductionApprovalArtifact({
    approvalId: 'production-approval-001',
    proposal: productionProposal,
    createdAt: '2026-07-27T18:00:00.000Z',
    decidedAt: '2026-07-27T18:05:00.000Z',
    expiresAt: '2026-08-27T18:05:00.000Z',
    approvedBy: 'Dalton',
    approverRole: 'human_production_owner',
    approvalDecision: 'approved_for_implementation',
    approvalStatus: 'final',
    approvedScope: { affectedSubsystem: 'confidence' },
    excludedScope: { automaticDeployment: true },
    validationRequirements: [{ requirement: 'full_test_suite' }],
    testRequirements: [{ requirement: 'focused_governance_tests' }],
    deploymentPrerequisites: [{ requirement: 'deployment_validation_artifact' }],
    monitoringRequirements: [{ requirement: 'post_deployment_monitoring' }],
    rollbackRequirements: [{ requirement: 'rollback_plan' }],
    rationale: 'Approved for implementation validation evidence only.'
  });
  const deploymentValidationArtifact = deploymentValidation.createDeploymentValidationArtifact({
    validationArtifactId: 'deployment-validation-001',
    proposal: productionProposal,
    approvalArtifact: productionApprovalArtifact,
    createdAt: '2026-07-27T19:00:00.000Z',
    completedAt: '2026-07-27T19:30:00.000Z',
    expiresAt: '2026-08-27T19:30:00.000Z',
    validationStatus: 'passed',
    validationChecklistResults: [{ check: 'full_test_suite', status: 'passed' }],
    requiredTestResults: [{ test: 'focused_governance_tests', status: 'passed' }],
    regressionSummary: { regressionsDetected: 0 },
    monitoringReadiness: { ready: true },
    rollbackReadiness: { ready: true },
    deploymentPrerequisitesSatisfied: true,
    outstandingIssues: [],
    evidenceReferences: [{
      referenceId: 'test-result-001',
      referenceType: 'test_result',
      sourceId: 'full-suite',
      sourceFingerprint: 'test-result-fingerprint-001',
      evidenceStatus: 'passed'
    }],
    validationNotes: 'Validation evidence only.'
  });

  return {
    reviewPackage,
    reviewBatch,
    reviewWorkspace,
    calibrationDataset,
    calibrationRecommendation,
    offlineExperiment,
    offlineExperimentResult,
    shadowExperiment,
    shadowResult,
    productionProposal,
    productionApprovalArtifact,
    deploymentValidationArtifact,
    ...overrides
  };
}

test('exports Governance Pipeline Validator public API and constants', () => {
  assert.equal(validator.GOVERNANCE_PIPELINE_VALIDATOR_SOURCE, 'governance_pipeline_validator');
  assert.equal(validator.GOVERNANCE_PIPELINE_VALIDATOR_SCHEMA_VERSION, '1.0.0');
  assert.equal(typeof validator.validateGovernancePipeline, 'function');
  assert.equal(typeof validator.validateArtifactBindings, 'function');
  assert.equal(typeof validator.validateLifecycleStates, 'function');
  assert.equal(typeof validator.validateAuthorityBoundaries, 'function');
  assert.equal(typeof validator.validateFingerprintChain, 'function');
  assert.equal(typeof validator.validateAuditHistoryChain, 'function');
  assert.equal(typeof validator.validateExpirationChain, 'function');
  assert.equal(typeof validator.validateSupersessionChain, 'function');
  assert.equal(typeof validator.validateRequiredEvidence, 'function');
  assert.equal(typeof validator.determinePipelineReadiness, 'function');
  assert.equal(typeof validator.summarizeGovernancePipeline, 'function');
  assert.equal(typeof validator.buildGovernancePipelineFingerprint, 'function');
});

test('validates a complete governance pipeline end to end', () => {
  const pipeline = buildPipeline();
  const validation = validator.validateGovernancePipeline(pipeline, {
    validatedAt: '2026-07-27T20:00:00.000Z',
    asOf: '2026-07-28T00:00:00.000Z'
  });
  const summary = validator.summarizeGovernancePipeline(validation);

  assert.equal(validation.valid, true);
  assert.equal(validation.readiness, 'valid');
  assert.equal(validation.productionImpact, 'none');
  assert.equal(validation.decisionImpact, 'none');
  assert.equal(validation.executionAuthority, 'none');
  assert.equal(validation.pipelineFingerprint, validator.buildGovernancePipelineFingerprint({
    artifacts: Object.fromEntries(validator.PIPELINE_ARTIFACT_KEYS.map((key) => [key, pipeline[key]])),
    validation: {
      ...validation,
      pipelineFingerprint: undefined
    }
  }));
  assert.equal(summary.errorCount, 0);
  assert.equal(Object.isFrozen(validation), true);
});

test('missing artifacts make the pipeline incomplete with explicit reason codes', () => {
  const pipeline = buildPipeline();
  delete pipeline.shadowResult;
  const validation = validator.validateGovernancePipeline(pipeline);

  assert.equal(validation.valid, false);
  assert.equal(validation.readiness, 'incomplete');
  assert.equal(validation.missingArtifacts.includes('shadowResult'), true);
  assert.equal(validation.reasonCodes.includes('missing_shadowResult'), true);
});

test('broken ID bindings and fingerprint references are invalid', () => {
  const pipeline = buildPipeline({
    productionProposal: {
      ...buildPipeline().productionProposal,
      sourceShadowResultFingerprints: ['wrong-shadow-result-fingerprint']
    }
  });
  const binding = validator.validateArtifactBindings(pipeline);
  const validation = validator.validateGovernancePipeline(pipeline);

  assert.equal(binding.valid, false);
  assert.equal(binding.reasonCodes.includes('proposal_missing_shadow_result_fingerprint'), true);
  assert.equal(validation.readiness, 'invalid');
});

test('artifact fingerprint mismatches are detected without recomputing upstream state', () => {
  const pipeline = buildPipeline();
  pipeline.calibrationDataset = {
    ...pipeline.calibrationDataset,
    reviewCount: 999,
    datasetFingerprint: pipeline.calibrationDataset.datasetFingerprint
  };
  const validation = validator.validateGovernancePipeline(pipeline);

  assert.equal(validation.valid, false);
  assert.equal(validation.readiness, 'invalid');
  assert.equal(validation.fingerprintViolations.some((error) => error.artifact === 'calibrationDataset'), true);
});

test('blocked lifecycle states, expired artifacts, revoked approvals, and supersession block readiness', () => {
  const expiredProposal = proposalContract.expireProductionProposal(buildPipeline().productionProposal, {
    expiresAt: '2026-07-28T00:00:00.000Z'
  });
  const revokedApproval = approvalArtifact.revokeProductionApprovalArtifact(buildPipeline().productionApprovalArtifact, {
    revokedAt: '2026-07-28T00:00:00.000Z',
    revocationReason: 'regression_found'
  });
  const supersededValidation = deploymentValidation.supersedeDeploymentValidationArtifact(buildPipeline().deploymentValidationArtifact, {
    supersededByValidationArtifactId: 'deployment-validation-002',
    supersededAt: '2026-07-28T00:00:00.000Z'
  });
  const validation = validator.validateGovernancePipeline(buildPipeline({
    productionProposal: expiredProposal,
    productionApprovalArtifact: revokedApproval,
    deploymentValidationArtifact: supersededValidation
  }), {
    asOf: '2026-07-29T00:00:00.000Z'
  });

  assert.equal(validation.readiness, 'invalid');
  assert.equal(validation.lifecycleViolations.length > 0, true);
  assert.equal(validation.expirationViolations.length > 0, true);
  assert.equal(validation.supersessionViolations.length > 0, true);
  assert.equal(validation.reasonCodes.includes('artifact_expired_as_of'), true);
});

test('missing evidence is blocked and remains explicit', () => {
  const pipeline = buildPipeline();
  pipeline.deploymentValidationArtifact = deploymentValidation.createDeploymentValidationArtifact({
    ...pipeline.deploymentValidationArtifact,
    validationChecklistResults: [],
    requiredTestResults: [],
    validationStatus: 'passed'
  });
  const validation = validator.validateGovernancePipeline(pipeline);

  assert.equal(validation.valid, false);
  assert.equal(validation.evidenceViolations.some((error) => error.code === 'deployment_validation_missing_test_evidence'), true);
});

test('authority violations are detected recursively across the pipeline', () => {
  const pipeline = buildPipeline();
  pipeline.productionProposal = {
    ...pipeline.productionProposal,
    supportingEvidenceReferences: [{
      ...pipeline.productionProposal.supportingEvidenceReferences[0],
      executionAuthority: 'deploys_change'
    }]
  };
  const validation = validator.validateGovernancePipeline(pipeline);

  assert.equal(validation.valid, false);
  assert.equal(validation.readiness, 'invalid');
  assert.equal(validation.authorityViolations.some((error) => error.field.includes('executionAuthority')), true);
});

test('audit history violations are reported deterministically', () => {
  const pipeline = buildPipeline();
  pipeline.productionApprovalArtifact = {
    ...pipeline.productionApprovalArtifact,
    auditHistory: [{
      eventId: 'b',
      eventAt: '2026-07-27T18:10:00.000Z',
      productionImpact: 'none',
      decisionImpact: 'none',
      executionAuthority: 'none'
    }, {
      eventId: 'a',
      eventAt: '2026-07-27T18:00:00.000Z',
      productionImpact: 'none',
      decisionImpact: 'none',
      executionAuthority: 'none'
    }],
    approvalFingerprint: 'stale'
  };
  const validation = validator.validateGovernancePipeline(pipeline);

  assert.equal(validation.readiness, 'invalid');
  assert.equal(validation.auditHistoryViolations.some((error) => error.code === 'audit_history_not_deterministic'), true);
});

test('validation output and fingerprints are deterministic and inputs remain immutable', () => {
  const pipeline = buildPipeline();
  const before = JSON.stringify(pipeline);
  const first = validator.validateGovernancePipeline(pipeline, { validatedAt: '2026-07-27T20:00:00.000Z' });
  const second = validator.validateGovernancePipeline(pipeline, { validatedAt: '2026-07-27T20:00:00.000Z' });

  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(pipeline), before);
  assert.deepEqual(validator.summarizeGovernancePipeline(first), validator.summarizeGovernancePipeline(second));
});

test('module does not import production runtime, deployment execution, or engine modules', () => {
  const loaded = [];
  const originalLoad = Module._load;
  try {
    Module._load = function patchedLoad(request, parent, isMain) {
      loaded.push(request);
      return originalLoad.apply(this, arguments);
    };
    delete require.cache[require.resolve('../validation/governancePipelineValidator')];
    require('../validation/governancePipelineValidator');
  } finally {
    Module._load = originalLoad;
  }

  assert.equal(loaded.some((request) => request.includes('server')), false);
  assert.equal(loaded.some((request) => request.includes('engines/')), false);
  assert.equal(loaded.some((request) => request.includes('services/')), false);
  assert.equal(loaded.some((request) => request.includes('deployment/') || request.includes('deployments/')), false);
});
