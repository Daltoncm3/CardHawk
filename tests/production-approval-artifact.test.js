'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const approval = require('../validation/productionApprovalArtifact');
const proposalContract = require('../validation/productionProposalContract');

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

function approvedArtifact(boundProposal = proposal(), overrides = {}) {
  return approval.createProductionApprovalArtifact({
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
    requiredChanges: [{ requirement: 'implement_separate_change_phase' }],
    implementationConstraints: [{ constraint: 'no_runtime_authority_from_artifact' }],
    validationRequirements: [{ requirement: 'full_test_suite' }],
    testRequirements: [{ requirement: 'focused_confidence_tests' }],
    deploymentPrerequisites: [{ requirement: 'explicit_deployment_review' }],
    monitoringRequirements: [{ requirement: 'post_deployment_false_positive_monitoring' }],
    rollbackRequirements: [{ requirement: 'configuration_revert_plan' }],
    rationale: 'Shadow evidence supports implementation planning.',
    notes: 'Approval artifact only.',
    auditHistory: [{
      eventId: 'approval-created',
      eventType: 'approval_created',
      actor: 'Dalton',
      eventAt: '2026-07-27T21:05:00.000Z',
      priorStatus: 'drafted',
      nextStatus: 'final',
      reason: 'explicit_human_decision'
    }],
    ...overrides
  });
}

test('exports Production Approval Artifact public API and constants', () => {
  assert.equal(approval.PRODUCTION_APPROVAL_SOURCE, 'production_approval_artifact');
  assert.equal(approval.PRODUCTION_APPROVAL_SCHEMA_VERSION, '1.0.0');
  assert.equal(typeof approval.createProductionApprovalArtifact, 'function');
  assert.equal(typeof approval.validateProductionApprovalArtifact, 'function');
  assert.equal(typeof approval.cloneProductionApprovalArtifact, 'function');
  assert.equal(typeof approval.verifyProductionProposalBinding, 'function');
  assert.equal(typeof approval.determineProductionApprovalStatus, 'function');
  assert.equal(typeof approval.supersedeProductionApprovalArtifact, 'function');
  assert.equal(typeof approval.revokeProductionApprovalArtifact, 'function');
  assert.equal(typeof approval.summarizeProductionApprovalArtifact, 'function');
  assert.equal(typeof approval.exportProductionApprovalArtifact, 'function');
  assert.equal(typeof approval.importProductionApprovalArtifact, 'function');
  assert.equal(typeof approval.buildProductionApprovalFingerprint, 'function');
  assert.equal(typeof approval.buildProductionApprovalBatchFingerprint, 'function');
});

test('creates a minimum valid non-approval decision without granting authority', () => {
  const artifact = approval.createProductionApprovalArtifact({
    approvalId: 'approval-rejected-001',
    proposalId: 'proposal-001',
    proposalFingerprint: 'proposal-fingerprint-001',
    proposalBatchId: 'proposal-batch-001',
    createdAt: '2026-07-27T21:00:00.000Z',
    decidedAt: '2026-07-27T21:05:00.000Z',
    approvalDecision: 'rejected',
    approvalStatus: 'final',
    rationale: 'Evidence does not support implementation.'
  });
  const validation = approval.validateProductionApprovalArtifact(artifact);

  assert.equal(artifact.approvalDecision, 'rejected');
  assert.equal(artifact.productionImpact, 'none');
  assert.equal(artifact.decisionImpact, 'none');
  assert.equal(artifact.executionAuthority, 'none');
  assert.equal(Object.isFrozen(artifact), true);
  assert.equal(validation.valid, true);
});

test('creates and validates a full explicit Dalton approval bound to a proposal', () => {
  const boundProposal = proposal();
  const artifact = approvedArtifact(boundProposal);
  const validation = approval.validateProductionApprovalArtifact(artifact, { proposal: boundProposal });
  const binding = approval.verifyProductionProposalBinding(artifact, boundProposal);

  assert.equal(artifact.approvedBy, 'Dalton');
  assert.equal(artifact.approvalDecision, 'approved_for_implementation');
  assert.equal(artifact.approvalStatus, 'final');
  assert.equal(artifact.proposalFingerprint, boundProposal.proposalFingerprint);
  assert.equal(artifact.approvalFingerprint, approval.buildProductionApprovalFingerprint(artifact));
  assert.equal(binding.valid, true);
  assert.equal(validation.valid, true);
});

test('supports rejection, revision required, deferred, and cancelled decisions explicitly', () => {
  for (const decision of ['rejected', 'revision_required', 'deferred', 'cancelled']) {
    const artifact = approval.createProductionApprovalArtifact({
      approvalId: `approval-${decision}`,
      proposalId: 'proposal-001',
      proposalFingerprint: 'proposal-fingerprint-001',
      proposalBatchId: 'proposal-batch-001',
      createdAt: '2026-07-27T21:00:00.000Z',
      decidedAt: '2026-07-27T21:05:00.000Z',
      approvalDecision: decision,
      approvalStatus: 'final',
      rationale: decision
    });
    assert.equal(approval.validateProductionApprovalArtifact(artifact).valid, true);
  }
});

test('rejects unsupported decisions, invalid statuses, and fingerprint drift', () => {
  const artifact = {
    ...approvedArtifact(),
    approvalDecision: 'auto_deploy',
    approvalStatus: 'production_changed',
    approvalFingerprint: 'stale'
  };
  const validation = approval.validateProductionApprovalArtifact(artifact);

  assert.equal(validation.valid, false);
  assert.equal(validation.reasonCodes.includes('invalid_approval_decision'), true);
  assert.equal(validation.reasonCodes.includes('invalid_approval_status'), true);
  assert.equal(validation.reasonCodes.includes('approval_fingerprint_mismatch'), true);
  assert.equal(validation.fingerprintMismatches.length, 1);
});

test('proposal binding detects ID mismatch, fingerprint mismatch, expired and superseded proposals', () => {
  const boundProposal = proposal();
  const artifact = approvedArtifact(boundProposal);
  const mismatchedId = approval.verifyProductionProposalBinding({ ...artifact, proposalId: 'other-proposal' }, boundProposal);
  const mismatchedFingerprint = approval.verifyProductionProposalBinding({ ...artifact, proposalFingerprint: 'stale' }, boundProposal);
  const expiredProposal = proposalContract.expireProductionProposal(boundProposal, {
    expiresAt: '2026-08-01T00:00:00.000Z',
    expiredAt: '2026-08-01T00:00:00.000Z'
  });
  const supersededProposal = proposalContract.supersedeProductionProposal(boundProposal, {
    supersededByProposalId: 'proposal-002',
    supersededAt: '2026-08-01T00:00:00.000Z'
  });

  assert.equal(mismatchedId.reasonCodes.includes('proposal_id_mismatch'), true);
  assert.equal(mismatchedFingerprint.reasonCodes.includes('proposal_fingerprint_mismatch'), true);
  assert.equal(approval.verifyProductionProposalBinding(artifact, expiredProposal).reasonCodes.includes('proposal_fingerprint_mismatch'), true);
  assert.equal(approval.verifyProductionProposalBinding({ ...artifact, proposalFingerprint: expiredProposal.proposalFingerprint }, expiredProposal).reasonCodes.includes('bound_proposal_not_current'), true);
  assert.equal(approval.verifyProductionProposalBinding({ ...artifact, proposalFingerprint: supersededProposal.proposalFingerprint }, supersededProposal).reasonCodes.includes('bound_proposal_not_current'), true);
});

test('proposal binding rejects approval scope that exceeds proposal scope', () => {
  const boundProposal = proposal();
  const artifact = approvedArtifact(boundProposal, {
    approvedScope: { affectedSubsystem: 'risk', proposalCategory: 'confidence_calibration_change' }
  });
  const binding = approval.verifyProductionProposalBinding(artifact, boundProposal);

  assert.equal(binding.valid, false);
  assert.equal(binding.reasonCodes.includes('approval_scope_exceeds_proposal'), true);
});

test('approved_for_implementation requires explicit Dalton human approval metadata and never auto-approves', () => {
  const artifact = approval.createProductionApprovalArtifact({
    approvalId: 'approval-missing-dalton',
    proposal: proposal(),
    createdAt: '2026-07-27T21:00:00.000Z',
    decidedAt: '2026-07-27T21:05:00.000Z',
    approvedBy: 'Codex',
    approverRole: 'automation',
    approvalDecision: 'approved_for_implementation',
    approvalStatus: 'final',
    approvedScope: {},
    conditions: [],
    rationale: 'Invalid approval.'
  });
  const validation = approval.validateProductionApprovalArtifact(artifact);

  assert.equal(validation.valid, false);
  assert.equal(validation.reasonCodes.includes('dalton_approval_required'), true);
  assert.equal(validation.reasonCodes.includes('approved_scope_required'), true);
  assert.equal(validation.reasonCodes.includes('validation_requirements_required'), true);
  assert.equal(validation.approvalBoundaryViolations.length >= 4, true);
});

test('expiration behavior rejects timestamps before creation or decision', () => {
  const validExpiredEvidence = approval.createProductionApprovalArtifact({
    approvalId: 'approval-expired',
    proposalId: 'proposal-001',
    proposalFingerprint: 'proposal-fingerprint-001',
    proposalBatchId: 'proposal-batch-001',
    createdAt: '2026-07-27T21:00:00.000Z',
    decidedAt: '2026-07-27T21:05:00.000Z',
    expiresAt: '2026-08-27T21:05:00.000Z',
    approvalDecision: 'deferred',
    approvalStatus: 'expired',
    rationale: 'Historical evidence.'
  });
  const invalid = approval.createProductionApprovalArtifact({
    approvalId: 'approval-expiration-invalid',
    proposalId: 'proposal-001',
    proposalFingerprint: 'proposal-fingerprint-001',
    proposalBatchId: 'proposal-batch-001',
    createdAt: '2026-07-27T21:00:00.000Z',
    decidedAt: '2026-07-27T21:05:00.000Z',
    expiresAt: '2026-07-01T00:00:00.000Z',
    approvalDecision: 'deferred',
    approvalStatus: 'expired',
    rationale: 'Invalid evidence.'
  });

  assert.equal(approval.validateProductionApprovalArtifact(validExpiredEvidence).valid, true);
  assert.equal(approval.validateProductionApprovalArtifact(invalid).reasonCodes.includes('expiration_before_creation'), true);
  assert.equal(approval.validateProductionApprovalArtifact(invalid).reasonCodes.includes('expiration_before_decision'), true);
});

test('revocation returns a new immutable artifact and preserves audit history', () => {
  const artifact = approvedArtifact();
  const revoked = approval.revokeProductionApprovalArtifact(artifact, {
    revokedAt: '2026-08-01T00:00:00.000Z',
    revocationReason: 'new_regression_evidence'
  }, { actor: 'Dalton' });

  assert.notEqual(revoked, artifact);
  assert.equal(artifact.approvalStatus, 'final');
  assert.equal(revoked.approvalStatus, 'revoked');
  assert.equal(revoked.revocationReason, 'new_regression_evidence');
  assert.equal(revoked.auditHistory.at(-1).eventType, 'production_approval_revoked');
  assert.equal(approval.validateProductionApprovalArtifact(revoked).valid, true);
});

test('supersession returns a new artifact and rejects self or invalid chains', () => {
  const artifact = approvedArtifact();
  const superseded = approval.supersedeProductionApprovalArtifact(artifact, {
    supersededByApprovalId: 'production-approval-confidence-002',
    supersededAt: '2026-08-01T00:00:00.000Z'
  });
  const selfSuperseded = approval.createProductionApprovalArtifact({
    ...approval.cloneProductionApprovalArtifact(artifact),
    supersedesApprovalId: artifact.approvalId
  });
  const invalidChain = approval.createProductionApprovalArtifact({
    ...approval.cloneProductionApprovalArtifact(artifact),
    approvalId: 'approval-chain',
    supersedesApprovalId: 'approval-a',
    supersededByApprovalId: 'approval-a'
  });

  assert.equal(superseded.approvalStatus, 'superseded');
  assert.equal(superseded.supersededByApprovalId, 'production-approval-confidence-002');
  assert.equal(approval.validateProductionApprovalArtifact(superseded).valid, true);
  assert.equal(approval.validateProductionApprovalArtifact(selfSuperseded).reasonCodes.includes('self_supersession'), true);
  assert.equal(approval.validateProductionApprovalArtifact(invalidChain).reasonCodes.includes('invalid_supersession_chain'), true);
});

test('invalid lifecycle transitions are reported deterministically', () => {
  const artifact = approval.createProductionApprovalArtifact({
    approvalId: 'approval-bad-transition',
    proposalId: 'proposal-001',
    proposalFingerprint: 'proposal-fingerprint-001',
    proposalBatchId: 'proposal-batch-001',
    createdAt: '2026-07-27T21:00:00.000Z',
    decidedAt: '2026-07-27T21:05:00.000Z',
    approvalDecision: 'deferred',
    approvalStatus: 'final',
    rationale: 'Transition test.',
    auditHistory: [{
      eventId: 'bad-transition',
      eventType: 'bad_transition',
      actor: 'Dalton',
      eventAt: '2026-07-27T21:05:00.000Z',
      priorStatus: 'revoked',
      nextStatus: 'final',
      reason: 'invalid_transition'
    }]
  });
  const validation = approval.validateProductionApprovalArtifact(artifact);

  assert.equal(validation.valid, false);
  assert.equal(validation.reasonCodes.includes('invalid_lifecycle_transition'), true);
});

test('clone, deterministic fingerprints, and batch fingerprints are stable', () => {
  const artifact = approvedArtifact();
  const copy = approval.cloneProductionApprovalArtifact(artifact);
  const batch = {
    schemaVersion: approval.PRODUCTION_APPROVAL_SCHEMA_VERSION,
    source: `${approval.PRODUCTION_APPROVAL_SOURCE}:batch`,
    approvals: [artifact]
  };

  copy.approvedScope.affectedSubsystem = 'changed-locally';
  assert.equal(artifact.approvedScope.affectedSubsystem, 'confidence');
  assert.equal(artifact.approvalFingerprint, approval.buildProductionApprovalFingerprint(artifact));
  assert.equal(
    approval.buildProductionApprovalBatchFingerprint(batch),
    approval.buildProductionApprovalBatchFingerprint({
      ...batch,
      approvalBatchFingerprint: 'ignored'
    })
  );
});

test('summary and export/import preserve evidence-only shape', () => {
  const artifact = approvedArtifact();
  const summary = approval.summarizeProductionApprovalArtifact(artifact, proposal());
  const serialized = approval.exportProductionApprovalArtifact(artifact);
  const imported = approval.importProductionApprovalArtifact(serialized);

  assert.equal(summary.currentApprovalEvidence, true);
  assert.equal(summary.productionImpact, 'none');
  assert.equal(summary.executionAuthority, 'none');
  assert.deepEqual(imported, artifact);
});

test('authority boundary validation rejects production, decision, or execution impact', () => {
  const artifact = {
    ...approvedArtifact(),
    productionImpact: 'changes_production',
    decisionImpact: 'changes_decision',
    executionAuthority: 'deploys_change',
    approvalFingerprint: 'stale'
  };
  const validation = approval.validateProductionApprovalArtifact(artifact);

  assert.equal(validation.valid, false);
  assert.equal(validation.reasonCodes.includes('invalid_production_impact'), true);
  assert.equal(validation.reasonCodes.includes('invalid_decision_impact'), true);
  assert.equal(validation.reasonCodes.includes('invalid_execution_authority'), true);
  assert.equal(validation.authorityBoundaryViolations.length, 3);
});

test('module does not import production runtime, deployment, or engine modules', () => {
  const loaded = [];
  const originalLoad = Module._load;
  try {
    Module._load = function patchedLoad(request, parent, isMain) {
      loaded.push(request);
      return originalLoad.apply(this, arguments);
    };
    delete require.cache[require.resolve('../validation/productionApprovalArtifact')];
    require('../validation/productionApprovalArtifact');
  } finally {
    Module._load = originalLoad;
  }

  assert.equal(loaded.some((request) => request.includes('server')), false);
  assert.equal(loaded.some((request) => request.includes('engines/')), false);
  assert.equal(loaded.some((request) => request.includes('services/')), false);
  assert.equal(loaded.some((request) => request.includes('deploy')), false);
});
