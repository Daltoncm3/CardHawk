'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const contract = require('../validation/productionProposalContract');

function fullInput(overrides = {}) {
  return {
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
    affectedRuleOrField: 'reported_confidence_cap',
    proposalCategory: 'confidence_calibration_change',
    currentBehavior: { confidenceCap: 'current production behavior remains authoritative' },
    proposedBehavior: { confidenceCap: 'candidate cap for a reviewed segment' },
    proposedCodeOrConfigurationChange: { changeType: 'configuration_candidate', productionAuthority: 'none' },
    expectedBenefit: { falsePositiveReduction: 'possible' },
    supportingEvidence: { shadowAgreement: 0.94, reviewedListings: 80 },
    counterEvidence: [{ category: 'segment_coverage_limited' }],
    sampleSize: { reviewedListings: 80, observedListings: 150 },
    coverage: { marketplace: ['ebay'], grade: ['PSA 10'] },
    confidence: 74,
    confidenceLevel: 'moderate',
    identifiedRisks: [{ risk: 'missed_opportunity_rate_may_increase', severity: 'moderate' }],
    knownLimitations: [{ limitation: 'limited_card_category_coverage' }],
    regressionRisks: [{ risk: 'deal_gate_precision_regression' }],
    deploymentPrerequisites: [{ prerequisite: 'feature_flag_plan', satisfied: false }],
    validationChecklist: [{ check: 'full_test_suite', required: true }],
    requiredTestEvidence: [{ test: 'focused_confidence_tests', required: true }],
    monitoringPlan: { memory: 'unchanged', rollbackMetric: 'false_positive_rate' },
    rollbackPlan: { required: true, method: 'configuration_revert' },
    approvalRequirements: [{ approver: 'Dalton', required: true }],
    productionApprovalArtifact: { approvalDecision: 'not_reviewed' },
    deploymentValidationReference: { available: false },
    supportingEvidenceReferences: [{
      referenceId: 'shadow-result-reference-001',
      referenceType: 'shadow_result_artifact',
      sourceId: 'shadow-result-confidence-001',
      sourceFingerprint: 'shadow-result-fingerprint-001',
      attachedAt: '2026-07-27T20:05:00.000Z',
      evidenceStatus: 'available'
    }],
    auditHistory: [{
      eventId: 'audit-001',
      eventType: 'proposal_created',
      actor: 'Codex',
      eventAt: '2026-07-27T20:00:00.000Z',
      priorStatus: 'unknown',
      nextStatus: 'drafted',
      reason: 'initial_contract_fixture'
    }],
    proposalStatus: 'ready_for_review',
    ...overrides
  };
}

test('exports Production Proposal Contract public API and constants', () => {
  assert.equal(contract.PRODUCTION_PROPOSAL_SOURCE, 'production_proposal_contract');
  assert.equal(contract.PRODUCTION_PROPOSAL_SCHEMA_VERSION, '1.0.0');
  assert.equal(typeof contract.createProductionProposal, 'function');
  assert.equal(typeof contract.validateProductionProposal, 'function');
  assert.equal(typeof contract.cloneProductionProposal, 'function');
  assert.equal(typeof contract.attachProductionApprovalArtifact, 'function');
  assert.equal(typeof contract.attachSupportingEvidenceReference, 'function');
  assert.equal(typeof contract.attachDeploymentValidationReference, 'function');
  assert.equal(typeof contract.supersedeProductionProposal, 'function');
  assert.equal(typeof contract.expireProductionProposal, 'function');
  assert.equal(typeof contract.determineProductionProposalStatus, 'function');
  assert.equal(typeof contract.buildProductionProposalFingerprint, 'function');
  assert.equal(typeof contract.buildProductionProposalBatchFingerprint, 'function');
});

test('creates and validates a minimum immutable production proposal with explicit unknown values', () => {
  const proposal = contract.createProductionProposal({}, {
    proposalId: 'minimum-proposal',
    proposalBatchId: 'minimum-proposal-batch',
    createdAt: '2026-07-27T20:00:00.000Z'
  });
  const validation = contract.validateProductionProposal(proposal);

  assert.equal(proposal.proposalId, 'minimum-proposal');
  assert.equal(proposal.affectedSubsystem, 'unknown');
  assert.equal(proposal.proposalCategory, 'other');
  assert.equal(proposal.productionImpact, 'none');
  assert.equal(proposal.decisionImpact, 'none');
  assert.equal(proposal.executionAuthority, 'none');
  assert.equal(Object.isFrozen(proposal), true);
  assert.equal(Object.isFrozen(proposal.productionApprovalArtifact), true);
  assert.equal(validation.valid, true);
  assert.equal(validation.reasonCodes.includes('missing_shadow_result_evidence'), true);
});

test('creates a full deterministic proposal without mutating input', () => {
  const input = fullInput();
  const before = JSON.parse(JSON.stringify(input));
  const first = contract.createProductionProposal(input);
  const second = contract.createProductionProposal(input);

  assert.deepEqual(input, before);
  assert.deepEqual(first, second);
  assert.equal(first.proposalFingerprint, contract.buildProductionProposalFingerprint(first));
  assert.equal(first.sourceShadowResultFingerprints.length, 1);
  assert.equal(contract.validateProductionProposal(first).valid, true);
});

test('rejects invalid proposal categories, statuses, confidence, and fingerprint drift', () => {
  const proposal = {
    ...contract.createProductionProposal(fullInput()),
    proposalCategory: 'auto_deploy_change',
    proposalStatus: 'production_applied',
    confidenceLevel: 'certain',
    confidence: 150,
    proposalFingerprint: 'stale'
  };
  const validation = contract.validateProductionProposal(proposal);

  assert.equal(validation.valid, false);
  assert.equal(validation.reasonCodes.includes('invalid_enum_value'), true);
  assert.equal(validation.reasonCodes.includes('invalid_confidence'), true);
  assert.equal(validation.reasonCodes.includes('proposal_fingerprint_mismatch'), true);
  assert.equal(validation.fingerprintMismatches.length, 1);
});

test('validation enforces production, decision, and execution authority boundaries', () => {
  const proposal = contract.createProductionProposal(fullInput());
  const invalid = {
    ...proposal,
    productionImpact: 'changes_production',
    decisionImpact: 'changes_decision',
    executionAuthority: 'deploys_change',
    productionApprovalArtifact: {
      ...proposal.productionApprovalArtifact,
      executionAuthority: 'deploys_change'
    },
    deploymentValidationReference: {
      ...proposal.deploymentValidationReference,
      productionImpact: 'changes_production'
    },
    supportingEvidenceReferences: [{
      ...proposal.supportingEvidenceReferences[0],
      decisionImpact: 'changes_decision'
    }]
  };
  const validation = contract.validateProductionProposal(invalid);

  assert.equal(validation.valid, false);
  assert.equal(validation.reasonCodes.includes('invalid_production_impact'), true);
  assert.equal(validation.reasonCodes.includes('invalid_decision_impact'), true);
  assert.equal(validation.reasonCodes.includes('invalid_execution_authority'), true);
  assert.equal(validation.authorityBoundaryViolations.length >= 4, true);
});

test('approval attachment returns a new immutable proposal without mutating original', () => {
  const proposal = contract.createProductionProposal(fullInput({ proposalStatus: 'under_review' }));
  const approved = contract.attachProductionApprovalArtifact(proposal, {
    approvalId: 'approval-001',
    approvedBy: 'Dalton',
    approvedAt: '2026-07-27T21:00:00.000Z',
    approvalDecision: 'approved',
    scope: { approvedFor: 'implementation_planning_only' },
    conditions: ['full_validation_required'],
    notes: 'Approved to implement the proposed change separately.'
  }, {
    proposalStatus: 'approved_for_implementation'
  });

  assert.notEqual(approved, proposal);
  assert.equal(proposal.productionApprovalArtifact.approvalDecision, 'not_reviewed');
  assert.equal(proposal.proposalStatus, 'under_review');
  assert.equal(approved.productionApprovalArtifact.approvalDecision, 'approved');
  assert.equal(approved.productionApprovalArtifact.approvedBy, 'Dalton');
  assert.equal(approved.proposalStatus, 'approved_for_implementation');
  assert.equal(approved.productionImpact, 'none');
  assert.equal(approved.decisionImpact, 'none');
  assert.equal(approved.executionAuthority, 'none');
  assert.equal(approved.auditHistory.at(-1).eventType, 'production_approval_attached');
  assert.equal(approved.proposalFingerprint, contract.buildProductionProposalFingerprint(approved));
  assert.equal(contract.validateProductionProposal(approved).valid, true);
});

test('approved_for_implementation requires explicit Dalton approval metadata and no auto approval exists', () => {
  const proposal = contract.createProductionProposal(fullInput({
    proposalStatus: 'approved_for_implementation',
    productionApprovalArtifact: { approvalDecision: 'not_reviewed' }
  }));
  const validation = contract.validateProductionProposal(proposal);

  assert.equal(proposal.productionApprovalArtifact.approvedBy, null);
  assert.equal(validation.valid, false);
  assert.equal(validation.reasonCodes.includes('approval_required_for_implementation'), true);
  assert.equal(validation.approvalBoundaryViolations.length, 1);
});

test('supporting evidence and deployment validation references attach without mutation', () => {
  const proposal = contract.createProductionProposal(fullInput({ supportingEvidenceReferences: [] }));
  const withEvidence = contract.attachSupportingEvidenceReference(proposal, {
    referenceId: 'review-analytics-001',
    referenceType: 'review_analytics',
    sourceId: 'analytics-001',
    sourceFingerprint: 'analytics-fingerprint',
    attachedAt: '2026-07-27T21:10:00.000Z',
    evidenceStatus: 'available'
  }, { actor: 'Codex' });
  const withDeployment = contract.attachDeploymentValidationReference(withEvidence, {
    validationArtifactId: 'deployment-validation-001',
    validationStatus: 'passed',
    validationFingerprint: 'deployment-validation-fingerprint',
    attachedAt: '2026-07-27T21:20:00.000Z'
  }, { proposalStatus: 'validated_for_deployment' });

  assert.equal(proposal.supportingEvidenceReferences.length, 0);
  assert.equal(withEvidence.supportingEvidenceReferences.length, 1);
  assert.equal(withDeployment.deploymentValidationReference.available, true);
  assert.equal(withDeployment.deploymentValidationReference.executionAuthority, 'none');
  assert.equal(withDeployment.proposalStatus, 'validated_for_deployment');
  assert.equal(withDeployment.proposalFingerprint, contract.buildProductionProposalFingerprint(withDeployment));
});

test('status transitions and invalid lifecycle transitions are deterministic', () => {
  const proposal = contract.createProductionProposal(fullInput({
    auditHistory: [{
      eventId: 'audit-invalid',
      eventType: 'bad_transition',
      actor: 'Codex',
      eventAt: '2026-07-27T20:30:00.000Z',
      priorStatus: 'completed',
      nextStatus: 'approved_for_implementation',
      reason: 'invalid_backwards_transition'
    }]
  }));
  const validation = contract.validateProductionProposal(proposal);

  assert.equal(validation.valid, false);
  assert.equal(validation.reasonCodes.includes('invalid_lifecycle_transition'), true);
  assert.equal(validation.invalidLifecycleTransitions.length, 1);
  assert.equal(contract.determineProductionProposalStatus({ proposalStatus: 'under_review' }), 'under_review');
  assert.equal(contract.determineProductionProposalStatus({ sourceShadowResultFingerprints: [] }), 'evidence_incomplete');
  assert.equal(contract.determineProductionProposalStatus({}), 'drafted');
});

test('expiration behavior rejects timestamps earlier than creation', () => {
  const proposal = contract.createProductionProposal(fullInput());
  const expired = contract.expireProductionProposal(proposal, {
    expiresAt: '2026-08-01T00:00:00.000Z',
    expiredAt: '2026-08-01T00:00:00.000Z',
    reason: 'evidence_window_closed'
  });
  const invalid = contract.createProductionProposal(fullInput({
    expiresAt: '2026-01-01T00:00:00.000Z'
  }));

  assert.equal(expired.proposalStatus, 'expired');
  assert.equal(expired.auditHistory.at(-1).eventType, 'production_proposal_expired');
  assert.equal(contract.validateProductionProposal(expired).valid, true);
  assert.equal(contract.validateProductionProposal(invalid).valid, false);
  assert.equal(contract.validateProductionProposal(invalid).reasonCodes.includes('expiration_before_creation'), true);
});

test('supersession preserves audit history and rejects self or invalid chains', () => {
  const proposal = contract.createProductionProposal(fullInput());
  const superseded = contract.supersedeProductionProposal(proposal, {
    supersededByProposalId: 'production-proposal-confidence-002',
    supersededAt: '2026-08-01T00:00:00.000Z',
    reason: 'new_shadow_result_available'
  });
  const selfSuperseded = contract.createProductionProposal(fullInput({
    supersedesProposalId: 'production-proposal-confidence-001'
  }));
  const invalidChain = contract.createProductionProposal(fullInput({
    proposalId: 'proposal-chain',
    supersedesProposalId: 'proposal-a',
    supersededByProposalId: 'proposal-a'
  }));

  assert.equal(superseded.proposalStatus, 'superseded');
  assert.equal(superseded.supersededByProposalId, 'production-proposal-confidence-002');
  assert.equal(superseded.auditHistory.at(-1).eventType, 'production_proposal_superseded');
  assert.equal(contract.validateProductionProposal(superseded).valid, true);
  assert.equal(contract.validateProductionProposal(selfSuperseded).reasonCodes.includes('self_supersession'), true);
  assert.equal(contract.validateProductionProposal(invalidChain).reasonCodes.includes('invalid_supersession_chain'), true);
});

test('missing source evidence and fingerprint mismatches are structured', () => {
  const proposal = {
    ...contract.createProductionProposal(fullInput({
      sourceRecommendationFingerprints: [],
      sourceShadowResultFingerprints: []
    })),
    proposalFingerprint: 'stale'
  };
  const validation = contract.validateProductionProposal(proposal);

  assert.equal(validation.valid, false);
  assert.equal(validation.reasonCodes.includes('missing_source_recommendation_evidence'), true);
  assert.equal(validation.reasonCodes.includes('missing_shadow_result_evidence'), true);
  assert.equal(validation.reasonCodes.includes('proposal_fingerprint_mismatch'), true);
  assert.equal(validation.invalidSourceReferences.length, 2);
  assert.equal(validation.fingerprintMismatches.length, 1);
});

test('clone returns an independent mutable copy of immutable proposal data', () => {
  const proposal = contract.createProductionProposal(fullInput());
  const copy = contract.cloneProductionProposal(proposal);

  copy.currentBehavior.confidenceCap = 'changed locally';
  assert.equal(proposal.currentBehavior.confidenceCap, 'current production behavior remains authoritative');
  assert.equal(copy.currentBehavior.confidenceCap, 'changed locally');
});

test('batch fingerprint is deterministic and excludes its own fingerprint field', () => {
  const proposal = contract.createProductionProposal(fullInput());
  const batch = {
    schemaVersion: contract.PRODUCTION_PROPOSAL_SCHEMA_VERSION,
    source: `${contract.PRODUCTION_PROPOSAL_SOURCE}:batch`,
    proposalBatchId: 'proposal-batch-001',
    proposals: [proposal]
  };
  const first = contract.buildProductionProposalBatchFingerprint(batch);
  const second = contract.buildProductionProposalBatchFingerprint({
    ...batch,
    productionProposalBatchFingerprint: first
  });

  assert.equal(first, second);
});

test('module does not import production runtime, deployment, or engine modules', () => {
  const loaded = [];
  const originalLoad = Module._load;
  try {
    Module._load = function patchedLoad(request, parent, isMain) {
      loaded.push(request);
      return originalLoad.apply(this, arguments);
    };
    delete require.cache[require.resolve('../validation/productionProposalContract')];
    require('../validation/productionProposalContract');
  } finally {
    Module._load = originalLoad;
  }

  assert.equal(loaded.some((request) => request.includes('server')), false);
  assert.equal(loaded.some((request) => request.includes('engines/')), false);
  assert.equal(loaded.some((request) => request.includes('services/')), false);
  assert.equal(loaded.some((request) => request.includes('deploy')), false);
});
