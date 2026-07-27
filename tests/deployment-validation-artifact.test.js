'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const deployment = require('../validation/deploymentValidationArtifact');
const proposalContract = require('../validation/productionProposalContract');
const approvalArtifact = require('../validation/productionApprovalArtifact');

function proposal(overrides = {}) {
  return proposalContract.createProductionProposal({
    proposalId: 'production-proposal-confidence-001',
    proposalBatchId: 'production-proposal-batch-001',
    createdAt: '2026-07-27T20:00:00.000Z',
    expiresAt: '2026-10-27T20:00:00.000Z',
    sourceRecommendationIds: ['recommendation-confidence-001'],
    sourceRecommendationFingerprints: ['recommendation-fingerprint-001'],
    sourceOfflineExperimentIds: ['offline-experiment-confidence-001'],
    sourceOfflineExperimentFingerprints: ['offline-experiment-fingerprint-001'],
    sourceShadowExperimentIds: ['shadow-experiment-confidence-001'],
    sourceShadowExperimentFingerprints: ['shadow-experiment-fingerprint-001'],
    sourceShadowResultIds: ['shadow-result-confidence-001'],
    sourceShadowResultFingerprints: ['shadow-result-fingerprint-001'],
    affectedSubsystem: 'confidence',
    affectedRuleOrField: 'confidence_cap',
    proposalCategory: 'confidence_calibration_change',
    currentBehavior: { confidenceCap: 'production_current' },
    proposedBehavior: { confidenceCap: 'candidate_cap' },
    proposedCodeOrConfigurationChange: { changeType: 'configuration_candidate', productionAuthority: 'none' },
    expectedBenefit: { falsePositiveReduction: 'possible' },
    supportingEvidence: { shadowObservedListings: 150 },
    sampleSize: { observedListings: 150 },
    coverage: { marketplace: ['ebay'] },
    confidence: 74,
    confidenceLevel: 'moderate',
    identifiedRisks: [{ risk: 'missed_opportunity_rate_may_increase' }],
    knownLimitations: [{ limitation: 'limited_segment_coverage' }],
    regressionRisks: [{ risk: 'deal_gate_precision_regression' }],
    deploymentPrerequisites: [{ prerequisite: 'feature_flag_plan' }],
    validationChecklist: [{ check: 'full_test_suite' }],
    requiredTestEvidence: [{ test: 'focused_confidence_tests' }],
    monitoringPlan: { monitorFalsePositiveRate: true },
    rollbackPlan: { required: true },
    approvalRequirements: [{ approver: 'Dalton', required: true }],
    supportingEvidenceReferences: [{
      referenceId: 'shadow-result-001',
      referenceType: 'shadow_result_artifact',
      sourceId: 'shadow-result-confidence-001',
      sourceFingerprint: 'shadow-result-fingerprint-001'
    }],
    proposalStatus: 'ready_for_review',
    ...overrides
  });
}

function approval(boundProposal = proposal(), overrides = {}) {
  return approvalArtifact.createProductionApprovalArtifact({
    approvalId: 'production-approval-confidence-001',
    proposal: boundProposal,
    createdAt: '2026-07-27T21:00:00.000Z',
    decidedAt: '2026-07-27T21:05:00.000Z',
    expiresAt: '2026-08-27T21:05:00.000Z',
    approvedBy: 'Dalton',
    approverRole: 'human_production_owner',
    approvalDecision: 'approved_for_implementation',
    approvalStatus: 'final',
    approvedScope: {
      affectedSubsystem: 'confidence',
      affectedRuleOrField: 'confidence_cap',
      proposalCategory: 'confidence_calibration_change'
    },
    excludedScope: { automaticDeployment: true },
    conditions: [],
    validationRequirements: [{ requirement: 'full_test_suite' }],
    testRequirements: [{ requirement: 'focused_confidence_tests' }],
    deploymentPrerequisites: [{ requirement: 'explicit_deployment_review' }],
    monitoringRequirements: [{ requirement: 'post_deployment_monitoring' }],
    rollbackRequirements: [{ requirement: 'configuration_revert_plan' }],
    rationale: 'Approved for implementation planning only.',
    ...overrides
  });
}

function validationArtifact(boundProposal = proposal(), boundApproval = approval(boundProposal), overrides = {}) {
  return deployment.createDeploymentValidationArtifact({
    validationArtifactId: 'deployment-validation-confidence-001',
    proposal: boundProposal,
    approvalArtifact: boundApproval,
    createdAt: '2026-07-27T22:00:00.000Z',
    completedAt: '2026-07-27T22:30:00.000Z',
    expiresAt: '2026-08-27T22:30:00.000Z',
    validationStatus: 'passed',
    validationChecklistResults: [{ check: 'full_test_suite', status: 'passed' }],
    requiredTestResults: [{ test: 'focused_confidence_tests', status: 'passed' }],
    regressionSummary: { regressionsDetected: 0 },
    monitoringReadiness: { ready: true },
    rollbackReadiness: { ready: true },
    deploymentPrerequisitesSatisfied: true,
    outstandingIssues: [],
    evidenceReferences: [{
      referenceId: 'full-suite-001',
      referenceType: 'test_result',
      sourceId: 'full-suite',
      sourceFingerprint: 'test-result-fingerprint-001',
      evidenceStatus: 'passed'
    }],
    validationNotes: 'Validation evidence only; no deployment authority.',
    auditHistory: [{
      eventId: 'deployment-validation-created',
      eventType: 'deployment_validation_created',
      actor: 'Codex',
      eventAt: '2026-07-27T22:30:00.000Z',
      priorStatus: 'drafted',
      nextStatus: 'passed',
      reason: 'validation_artifact_recorded'
    }],
    ...overrides
  });
}

test('exports Deployment Validation Artifact public API and constants', () => {
  assert.equal(deployment.DEPLOYMENT_VALIDATION_SOURCE, 'deployment_validation_artifact');
  assert.equal(deployment.DEPLOYMENT_VALIDATION_SCHEMA_VERSION, '1.0.0');
  assert.equal(typeof deployment.createDeploymentValidationArtifact, 'function');
  assert.equal(typeof deployment.validateDeploymentValidationArtifact, 'function');
  assert.equal(typeof deployment.cloneDeploymentValidationArtifact, 'function');
  assert.equal(typeof deployment.verifyProposalApprovalBinding, 'function');
  assert.equal(typeof deployment.determineDeploymentValidationStatus, 'function');
  assert.equal(typeof deployment.supersedeDeploymentValidationArtifact, 'function');
  assert.equal(typeof deployment.expireDeploymentValidationArtifact, 'function');
  assert.equal(typeof deployment.summarizeDeploymentValidationArtifact, 'function');
  assert.equal(typeof deployment.exportDeploymentValidationArtifact, 'function');
  assert.equal(typeof deployment.importDeploymentValidationArtifact, 'function');
  assert.equal(typeof deployment.buildDeploymentValidationFingerprint, 'function');
  assert.equal(typeof deployment.buildDeploymentValidationBatchFingerprint, 'function');
});

test('creates a minimum valid artifact with explicit unknown values', () => {
  const artifact = deployment.createDeploymentValidationArtifact({
    validationArtifactId: 'deployment-validation-minimum',
    proposalId: 'proposal-001',
    proposalFingerprint: 'proposal-fingerprint-001',
    approvalId: 'approval-001',
    approvalFingerprint: 'approval-fingerprint-001',
    createdAt: '2026-07-27T22:00:00.000Z',
    completedAt: '2026-07-27T22:30:00.000Z'
  });
  const validation = deployment.validateDeploymentValidationArtifact(artifact);

  assert.equal(artifact.validationStatus, 'drafted');
  assert.equal(artifact.expiresAt, 'unknown');
  assert.equal(artifact.productionImpact, 'none');
  assert.equal(artifact.decisionImpact, 'none');
  assert.equal(artifact.executionAuthority, 'none');
  assert.equal(Object.isFrozen(artifact), true);
  assert.equal(validation.valid, true);
});

test('creates a complete artifact and validates proposal and approval binding', () => {
  const boundProposal = proposal();
  const boundApproval = approval(boundProposal);
  const artifact = validationArtifact(boundProposal, boundApproval);
  const validation = deployment.validateDeploymentValidationArtifact(artifact, {
    proposal: boundProposal,
    approvalArtifact: boundApproval
  });
  const binding = deployment.verifyProposalApprovalBinding(artifact, boundProposal, boundApproval);

  assert.equal(artifact.validationStatus, 'passed');
  assert.equal(artifact.validationFingerprint, deployment.buildDeploymentValidationFingerprint(artifact));
  assert.equal(binding.valid, true);
  assert.equal(validation.valid, true);
});

test('invalid proposal or approval bindings are structured', () => {
  const boundProposal = proposal();
  const boundApproval = approval(boundProposal);
  const artifact = validationArtifact(boundProposal, boundApproval);
  const wrongProposal = proposal({ proposalId: 'other-proposal' });
  const revokedApproval = approvalArtifact.revokeProductionApprovalArtifact(boundApproval, {
    revokedAt: '2026-08-01T00:00:00.000Z',
    revocationReason: 'new_regression'
  });
  const mismatch = deployment.verifyProposalApprovalBinding({
    ...artifact,
    approvalFingerprint: 'stale'
  }, boundProposal, boundApproval);
  const revoked = deployment.verifyProposalApprovalBinding({
    ...artifact,
    approvalFingerprint: revokedApproval.approvalFingerprint
  }, boundProposal, revokedApproval);

  assert.equal(deployment.verifyProposalApprovalBinding(artifact, wrongProposal, boundApproval).reasonCodes.includes('proposal_id_mismatch'), true);
  assert.equal(mismatch.reasonCodes.includes('approval_fingerprint_mismatch'), true);
  assert.equal(revoked.reasonCodes.includes('approval_not_current'), true);
});

test('deterministic fingerprints, batch fingerprints, and immutable cloning are stable', () => {
  const artifact = validationArtifact();
  const copy = deployment.cloneDeploymentValidationArtifact(artifact);
  const batch = {
    schemaVersion: deployment.DEPLOYMENT_VALIDATION_SCHEMA_VERSION,
    source: `${deployment.DEPLOYMENT_VALIDATION_SOURCE}:batch`,
    artifacts: [artifact]
  };

  copy.monitoringReadiness.ready = false;
  assert.equal(artifact.monitoringReadiness.ready, true);
  assert.equal(artifact.validationFingerprint, deployment.buildDeploymentValidationFingerprint(artifact));
  assert.equal(
    deployment.buildDeploymentValidationBatchFingerprint(batch),
    deployment.buildDeploymentValidationBatchFingerprint({
      ...batch,
      validationBatchFingerprint: 'ignored'
    })
  );
});

test('expiration rejects timestamps earlier than creation or completion', () => {
  const valid = deployment.expireDeploymentValidationArtifact(validationArtifact(), {
    expiresAt: '2026-08-01T00:00:00.000Z',
    expiredAt: '2026-08-01T00:00:00.000Z'
  });
  const invalid = deployment.createDeploymentValidationArtifact({
    validationArtifactId: 'deployment-validation-invalid-expiration',
    proposalId: 'proposal-001',
    proposalFingerprint: 'proposal-fingerprint-001',
    approvalId: 'approval-001',
    approvalFingerprint: 'approval-fingerprint-001',
    createdAt: '2026-07-27T22:00:00.000Z',
    completedAt: '2026-07-27T22:30:00.000Z',
    expiresAt: '2026-07-01T00:00:00.000Z',
    validationStatus: 'expired'
  });

  assert.equal(valid.validationStatus, 'expired');
  assert.equal(deployment.validateDeploymentValidationArtifact(valid).valid, true);
  assert.equal(deployment.validateDeploymentValidationArtifact(invalid).reasonCodes.includes('expiration_before_creation'), true);
  assert.equal(deployment.validateDeploymentValidationArtifact(invalid).reasonCodes.includes('expiration_before_completion'), true);
});

test('supersession returns a new artifact and rejects self or invalid chains', () => {
  const artifact = validationArtifact();
  const superseded = deployment.supersedeDeploymentValidationArtifact(artifact, {
    supersededByValidationArtifactId: 'deployment-validation-confidence-002',
    supersededAt: '2026-08-01T00:00:00.000Z'
  });
  const selfSuperseded = deployment.createDeploymentValidationArtifact({
    ...deployment.cloneDeploymentValidationArtifact(artifact),
    supersedesValidationArtifactId: artifact.validationArtifactId
  });
  const invalidChain = deployment.createDeploymentValidationArtifact({
    ...deployment.cloneDeploymentValidationArtifact(artifact),
    validationArtifactId: 'deployment-validation-chain',
    supersedesValidationArtifactId: 'deployment-validation-a',
    supersededByValidationArtifactId: 'deployment-validation-a'
  });

  assert.equal(superseded.validationStatus, 'superseded');
  assert.equal(superseded.supersededByValidationArtifactId, 'deployment-validation-confidence-002');
  assert.equal(deployment.validateDeploymentValidationArtifact(superseded).valid, true);
  assert.equal(deployment.validateDeploymentValidationArtifact(selfSuperseded).reasonCodes.includes('self_supersession'), true);
  assert.equal(deployment.validateDeploymentValidationArtifact(invalidChain).reasonCodes.includes('invalid_supersession_chain'), true);
});

test('unknown values remain explicit and status fallback is deterministic', () => {
  const artifact = deployment.createDeploymentValidationArtifact({
    validationArtifactId: 'deployment-validation-unknowns',
    proposalId: 'proposal-001',
    proposalFingerprint: 'proposal-fingerprint-001',
    approvalId: 'approval-001',
    approvalFingerprint: 'approval-fingerprint-001'
  });

  assert.equal(artifact.createdAt, 'unknown');
  assert.equal(artifact.completedAt, 'unknown');
  assert.equal(deployment.determineDeploymentValidationStatus({}), 'drafted');
  assert.equal(deployment.determineDeploymentValidationStatus({ outstandingIssues: [{}] }), 'blocked');
  assert.equal(deployment.determineDeploymentValidationStatus({ deploymentPrerequisitesSatisfied: true, outstandingIssues: [] }), 'passed');
});

test('export and import preserve validation artifact JSON shape', () => {
  const artifact = validationArtifact();
  const serialized = deployment.exportDeploymentValidationArtifact(artifact);
  const imported = deployment.importDeploymentValidationArtifact(serialized);

  assert.deepEqual(imported, artifact);
  assert.equal(deployment.validateDeploymentValidationArtifact(imported).valid, true);
});

test('summary preserves evidence-only authority boundary', () => {
  const artifact = validationArtifact();
  const summary = deployment.summarizeDeploymentValidationArtifact(artifact);

  assert.equal(summary.validationArtifactId, 'deployment-validation-confidence-001');
  assert.equal(summary.deploymentPrerequisitesSatisfied, true);
  assert.equal(summary.currentValidationEvidence, true);
  assert.equal(summary.productionImpact, 'none');
  assert.equal(summary.decisionImpact, 'none');
  assert.equal(summary.executionAuthority, 'none');
});

test('authority boundary validation rejects production, decision, execution, or evidence authority drift', () => {
  const artifact = {
    ...validationArtifact(),
    productionImpact: 'changes_production',
    decisionImpact: 'changes_decision',
    executionAuthority: 'deploys_change',
    evidenceReferences: [{
      referenceId: 'bad-reference',
      productionImpact: 'changes_production'
    }],
    validationFingerprint: 'stale'
  };
  const validation = deployment.validateDeploymentValidationArtifact(artifact);

  assert.equal(validation.valid, false);
  assert.equal(validation.reasonCodes.includes('invalid_production_impact'), true);
  assert.equal(validation.reasonCodes.includes('invalid_decision_impact'), true);
  assert.equal(validation.reasonCodes.includes('invalid_execution_authority'), true);
  assert.equal(validation.reasonCodes.includes('invalid_evidence_reference_authority'), true);
  assert.equal(validation.reasonCodes.includes('validation_fingerprint_mismatch'), true);
  assert.equal(validation.authorityBoundaryViolations.length, 4);
});

test('invalid statuses and lifecycle transitions are reported', () => {
  const artifact = {
    ...validationArtifact(),
    validationStatus: 'deployed',
    auditHistory: [{
      eventId: 'bad-transition',
      eventType: 'bad_transition',
      actor: 'Codex',
      eventAt: '2026-07-27T22:30:00.000Z',
      priorStatus: 'archived',
      nextStatus: 'passed',
      reason: 'invalid_transition'
    }],
    validationFingerprint: 'stale'
  };
  const validation = deployment.validateDeploymentValidationArtifact(artifact);

  assert.equal(validation.valid, false);
  assert.equal(validation.reasonCodes.includes('invalid_validation_status'), true);
  assert.equal(validation.reasonCodes.includes('invalid_lifecycle_transition'), true);
});

test('module does not import production runtime, deployment, or engine modules', () => {
  const loaded = [];
  const originalLoad = Module._load;
  try {
    Module._load = function patchedLoad(request, parent, isMain) {
      loaded.push(request);
      return originalLoad.apply(this, arguments);
    };
    delete require.cache[require.resolve('../validation/deploymentValidationArtifact')];
    require('../validation/deploymentValidationArtifact');
  } finally {
    Module._load = originalLoad;
  }

  assert.equal(loaded.some((request) => request.includes('server')), false);
  assert.equal(loaded.some((request) => request.includes('engines/')), false);
  assert.equal(loaded.some((request) => request.includes('services/')), false);
  assert.equal(loaded.some((request) => request.includes('deployment/') || request.includes('deployments/')), false);
});
