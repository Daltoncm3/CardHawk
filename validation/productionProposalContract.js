'use strict';

const {
  asArray,
  asObject,
  unique
} = require('./canonicalValidationCore');
const {
  buildFingerprintFromProjection
} = require('./fingerprintProjection');
const {
  buildOfflineAuthorityFlags,
  clone,
  firstDefined
} = require('./phase8GovernanceCore');

const PRODUCTION_PROPOSAL_SCHEMA_VERSION = '1.0.0';
const PRODUCTION_PROPOSAL_SOURCE = 'production_proposal_contract';
const UNKNOWN_VALUE = 'unknown';

const PROPOSAL_CATEGORIES = Object.freeze([
  'identity_parser_change',
  'canonical_identity_change',
  'evidence_rule_change',
  'valuation_methodology_change',
  'confidence_calibration_change',
  'risk_rule_change',
  'grading_quality_change',
  'deal_gate_change',
  'buy_now_change',
  'notification_change',
  'diagnostic_change',
  'configuration_change',
  'code_change',
  'no_change',
  'other'
]);

const PRODUCTION_PROPOSAL_STATUSES = Object.freeze({
  DRAFTED: 'drafted',
  EVIDENCE_INCOMPLETE: 'evidence_incomplete',
  READY_FOR_REVIEW: 'ready_for_review',
  UNDER_REVIEW: 'under_review',
  REJECTED: 'rejected',
  APPROVED_FOR_IMPLEMENTATION: 'approved_for_implementation',
  IMPLEMENTATION_IN_PROGRESS: 'implementation_in_progress',
  IMPLEMENTED_PENDING_VALIDATION: 'implemented_pending_validation',
  VALIDATION_FAILED: 'validation_failed',
  VALIDATED_FOR_DEPLOYMENT: 'validated_for_deployment',
  DEPLOYED_PENDING_MONITORING: 'deployed_pending_monitoring',
  MONITORING_FAILED: 'monitoring_failed',
  COMPLETED: 'completed',
  EXPIRED: 'expired',
  SUPERSEDED: 'superseded',
  ARCHIVED: 'archived'
});

const APPROVAL_DECISIONS = Object.freeze([
  'approved',
  'rejected',
  'changes_requested',
  'not_reviewed',
  UNKNOWN_VALUE
]);

const CONFIDENCE_LEVELS = Object.freeze([
  'high',
  'moderate',
  'low',
  'insufficient',
  UNKNOWN_VALUE
]);

const REQUIRED_PRODUCTION_PROPOSAL_FIELDS = Object.freeze([
  'schemaVersion',
  'source',
  'proposalId',
  'proposalBatchId',
  'createdAt',
  'expiresAt',
  'sourceRecommendationIds',
  'sourceRecommendationFingerprints',
  'sourceOfflineExperimentIds',
  'sourceOfflineExperimentFingerprints',
  'sourceShadowExperimentIds',
  'sourceShadowExperimentFingerprints',
  'sourceShadowResultIds',
  'sourceShadowResultFingerprints',
  'affectedSubsystem',
  'affectedRuleOrField',
  'proposalCategory',
  'currentBehavior',
  'proposedBehavior',
  'proposedCodeOrConfigurationChange',
  'expectedBenefit',
  'supportingEvidence',
  'counterEvidence',
  'sampleSize',
  'coverage',
  'confidence',
  'confidenceLevel',
  'identifiedRisks',
  'knownLimitations',
  'regressionRisks',
  'deploymentPrerequisites',
  'validationChecklist',
  'requiredTestEvidence',
  'monitoringPlan',
  'rollbackPlan',
  'approvalRequirements',
  'productionApprovalArtifact',
  'deploymentValidationReference',
  'supportingEvidenceReferences',
  'auditHistory',
  'proposalStatus',
  'productionImpact',
  'decisionImpact',
  'executionAuthority',
  'proposalFingerprint'
]);

const ALLOWED_STATUS_TRANSITIONS = Object.freeze({
  drafted: ['evidence_incomplete', 'ready_for_review', 'under_review', 'rejected', 'expired', 'superseded', 'archived'],
  evidence_incomplete: ['ready_for_review', 'under_review', 'rejected', 'expired', 'superseded', 'archived'],
  ready_for_review: ['under_review', 'approved_for_implementation', 'changes_requested', 'rejected', 'expired', 'superseded', 'archived'],
  under_review: ['ready_for_review', 'approved_for_implementation', 'rejected', 'expired', 'superseded', 'archived'],
  rejected: ['archived', 'superseded'],
  approved_for_implementation: ['implementation_in_progress', 'implemented_pending_validation', 'rejected', 'expired', 'superseded', 'archived'],
  implementation_in_progress: ['implemented_pending_validation', 'validation_failed', 'rejected', 'expired', 'superseded', 'archived'],
  implemented_pending_validation: ['validated_for_deployment', 'validation_failed', 'rejected', 'expired', 'superseded', 'archived'],
  validation_failed: ['implementation_in_progress', 'rejected', 'expired', 'superseded', 'archived'],
  validated_for_deployment: ['deployed_pending_monitoring', 'rejected', 'expired', 'superseded', 'archived'],
  deployed_pending_monitoring: ['completed', 'monitoring_failed', 'superseded', 'archived'],
  monitoring_failed: ['rejected', 'superseded', 'archived'],
  completed: ['archived', 'superseded'],
  expired: ['archived', 'superseded'],
  superseded: ['archived'],
  archived: []
});

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

function normalizeNullableString(value) {
  return known(value) ? String(value).trim() : null;
}

function normalizeString(value, fallback = UNKNOWN_VALUE) {
  if (!known(value)) return fallback;
  return String(value).trim() || fallback;
}

function normalizeEnum(value, allowedValues, fallback = UNKNOWN_VALUE) {
  const normalized = normalizeString(value, fallback).toLowerCase();
  return allowedValues.includes(normalized) ? normalized : normalized;
}

function normalizeStringArray(values = []) {
  return unique(asArray(values).map((value) => normalizeString(value, '')).filter(Boolean)).sort();
}

function normalizeConfidence(value) {
  if (!known(value) || value === UNKNOWN_VALUE) return UNKNOWN_VALUE;
  const number = Number(value);
  return Number.isFinite(number) ? number : value;
}

function missingRequiredFields(record = {}, fields = REQUIRED_PRODUCTION_PROPOSAL_FIELDS) {
  const input = asObject(record);
  return fields.filter((field) => {
    const value = input[field];
    return value === undefined || value === null || value === '';
  });
}

function validationError(code, message, field = '') {
  return { code, message, field };
}

function buildApprovalFingerprint(approval = {}) {
  const projection = clone(approval);
  delete projection.approvalFingerprint;
  return buildFingerprintFromProjection(projection);
}

function buildProductionApprovalArtifact(input = {}) {
  const approval = asObject(input);
  const core = {
    approvalId: normalizeNullableString(firstDefined(approval.approvalId, approval.id)),
    approvedBy: normalizeNullableString(firstDefined(approval.approvedBy, approval.approver)),
    approvedAt: known(approval.approvedAt) ? normalizeDate(approval.approvedAt) : null,
    approvalDecision: normalizeEnum(approval.approvalDecision, APPROVAL_DECISIONS, 'not_reviewed'),
    approvedProposalId: normalizeNullableString(approval.approvedProposalId),
    approvedProposalFingerprint: normalizeNullableString(approval.approvedProposalFingerprint),
    scope: clone(asObject(approval.scope)),
    conditions: asArray(approval.conditions).map((item) => clone(item)),
    notes: known(approval.notes) ? String(approval.notes) : '',
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };

  return {
    ...core,
    approvalFingerprint: known(approval.approvalFingerprint)
      ? String(approval.approvalFingerprint)
      : buildApprovalFingerprint(core)
  };
}

function buildDeploymentValidationReference(input = {}) {
  const reference = asObject(input);
  return {
    available: reference.available === true,
    validationArtifactId: normalizeNullableString(firstDefined(reference.validationArtifactId, reference.id)),
    validationStatus: normalizeString(firstDefined(reference.validationStatus, reference.status), UNKNOWN_VALUE),
    validationFingerprint: normalizeNullableString(firstDefined(reference.validationFingerprint, reference.fingerprint)),
    attachedAt: known(reference.attachedAt) ? normalizeDate(reference.attachedAt) : null,
    summary: clone(asObject(reference.summary)),
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
}

function normalizeSupportingEvidenceReference(reference = {}, options = {}) {
  const input = asObject(reference);
  return {
    referenceId: normalizeString(firstDefined(input.referenceId, input.id)),
    referenceType: normalizeString(firstDefined(input.referenceType, input.type)),
    sourceId: normalizeString(firstDefined(input.sourceId, input.artifactId)),
    sourceFingerprint: normalizeString(firstDefined(input.sourceFingerprint, input.fingerprint)),
    attachedAt: normalizeDate(firstDefined(input.attachedAt, options.attachedAt, UNKNOWN_VALUE)),
    evidenceStatus: normalizeString(firstDefined(input.evidenceStatus, input.status), UNKNOWN_VALUE),
    summary: clone(asObject(input.summary)),
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
}

function normalizeAuditEvent(event = {}, options = {}) {
  const input = asObject(event);
  return {
    eventId: normalizeString(firstDefined(input.eventId, input.id, options.eventId, 'audit-event')),
    eventType: normalizeString(firstDefined(input.eventType, input.type, options.eventType)),
    actor: normalizeString(firstDefined(input.actor, options.actor), UNKNOWN_VALUE),
    eventAt: normalizeDate(firstDefined(input.eventAt, input.createdAt, options.eventAt, UNKNOWN_VALUE)),
    priorStatus: normalizeString(firstDefined(input.priorStatus, input.from), UNKNOWN_VALUE),
    nextStatus: normalizeString(firstDefined(input.nextStatus, input.to), UNKNOWN_VALUE),
    reason: normalizeString(firstDefined(input.reason, options.reason), UNKNOWN_VALUE),
    details: clone(asObject(input.details)),
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
}

function buildProductionProposalFingerprint(proposal = {}) {
  const projection = clone(proposal);
  delete projection.proposalFingerprint;
  return buildFingerprintFromProjection(projection);
}

function buildProductionProposalBatchFingerprint(batch = {}) {
  const projection = clone(batch);
  delete projection.productionProposalBatchFingerprint;
  return buildFingerprintFromProjection(projection);
}

function createProductionProposal(input = {}, options = {}) {
  const proposalCore = {
    schemaVersion: PRODUCTION_PROPOSAL_SCHEMA_VERSION,
    source: PRODUCTION_PROPOSAL_SOURCE,
    proposalId: normalizeString(firstDefined(input.proposalId, options.proposalId, 'production-proposal')),
    proposalBatchId: normalizeString(firstDefined(input.proposalBatchId, options.proposalBatchId, 'production-proposal-batch')),
    createdAt: normalizeDate(firstDefined(input.createdAt, options.createdAt, UNKNOWN_VALUE)),
    expiresAt: known(firstDefined(input.expiresAt, options.expiresAt)) ? normalizeDate(firstDefined(input.expiresAt, options.expiresAt)) : UNKNOWN_VALUE,
    supersedesProposalId: normalizeNullableString(input.supersedesProposalId),
    supersededByProposalId: normalizeNullableString(input.supersededByProposalId),
    sourceRecommendationIds: normalizeStringArray(input.sourceRecommendationIds),
    sourceRecommendationFingerprints: normalizeStringArray(input.sourceRecommendationFingerprints),
    sourceOfflineExperimentIds: normalizeStringArray(input.sourceOfflineExperimentIds),
    sourceOfflineExperimentFingerprints: normalizeStringArray(input.sourceOfflineExperimentFingerprints),
    sourceShadowExperimentIds: normalizeStringArray(input.sourceShadowExperimentIds),
    sourceShadowExperimentFingerprints: normalizeStringArray(input.sourceShadowExperimentFingerprints),
    sourceShadowResultIds: normalizeStringArray(input.sourceShadowResultIds),
    sourceShadowResultFingerprints: normalizeStringArray(input.sourceShadowResultFingerprints),
    affectedSubsystem: normalizeString(input.affectedSubsystem),
    affectedRuleOrField: normalizeString(input.affectedRuleOrField),
    proposalCategory: normalizeEnum(input.proposalCategory, PROPOSAL_CATEGORIES, 'other'),
    currentBehavior: clone(asObject(input.currentBehavior)),
    proposedBehavior: clone(asObject(input.proposedBehavior)),
    proposedCodeOrConfigurationChange: clone(asObject(input.proposedCodeOrConfigurationChange)),
    expectedBenefit: clone(asObject(input.expectedBenefit)),
    supportingEvidence: clone(asObject(input.supportingEvidence)),
    counterEvidence: asArray(input.counterEvidence).map((item) => clone(item)),
    sampleSize: clone(asObject(input.sampleSize)),
    coverage: clone(asObject(input.coverage)),
    confidence: normalizeConfidence(input.confidence),
    confidenceLevel: normalizeEnum(input.confidenceLevel, CONFIDENCE_LEVELS, UNKNOWN_VALUE),
    identifiedRisks: asArray(input.identifiedRisks).map((item) => clone(item)),
    knownLimitations: asArray(input.knownLimitations).map((item) => clone(item)),
    regressionRisks: asArray(input.regressionRisks).map((item) => clone(item)),
    deploymentPrerequisites: asArray(input.deploymentPrerequisites).map((item) => clone(item)),
    validationChecklist: asArray(input.validationChecklist).map((item) => clone(item)),
    requiredTestEvidence: asArray(input.requiredTestEvidence).map((item) => clone(item)),
    monitoringPlan: clone(asObject(input.monitoringPlan)),
    rollbackPlan: clone(asObject(input.rollbackPlan)),
    approvalRequirements: asArray(input.approvalRequirements).map((item) => clone(item)),
    productionApprovalArtifact: buildProductionApprovalArtifact(input.productionApprovalArtifact),
    deploymentValidationReference: buildDeploymentValidationReference(input.deploymentValidationReference),
    supportingEvidenceReferences: asArray(input.supportingEvidenceReferences).map((reference) => normalizeSupportingEvidenceReference(reference)),
    auditHistory: asArray(input.auditHistory).map((event) => normalizeAuditEvent(event)),
    proposalStatus: normalizeEnum(input.proposalStatus, Object.values(PRODUCTION_PROPOSAL_STATUSES), PRODUCTION_PROPOSAL_STATUSES.DRAFTED),
    authorityFlags: buildOfflineAuthorityFlags(input.authorityFlags),
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };

  return deepFreeze({
    ...proposalCore,
    proposalFingerprint: buildProductionProposalFingerprint(proposalCore)
  });
}

function cloneProductionProposal(proposal = {}) {
  return clone(proposal);
}

function rebuildProductionProposalWithFingerprint(proposal = {}) {
  const projection = clone(proposal);
  delete projection.proposalFingerprint;
  return deepFreeze({
    ...projection,
    proposalFingerprint: buildProductionProposalFingerprint(projection)
  });
}

function appendAuditEvent(proposal = {}, event = {}) {
  const history = asArray(proposal.auditHistory).map((item) => clone(item));
  history.push(normalizeAuditEvent(event, {
    eventId: `${proposal.proposalId || 'proposal'}-${history.length + 1}`,
    actor: UNKNOWN_VALUE,
    eventAt: UNKNOWN_VALUE
  }));
  return history.sort((a, b) => {
    const time = String(a.eventAt).localeCompare(String(b.eventAt));
    if (time !== 0) return time;
    return String(a.eventId).localeCompare(String(b.eventId));
  });
}

function attachProductionApprovalArtifact(proposal = {}, approvalArtifact = {}, options = {}) {
  const priorStatus = proposal.proposalStatus || PRODUCTION_PROPOSAL_STATUSES.UNDER_REVIEW;
  const nextStatus = normalizeEnum(
    firstDefined(options.proposalStatus, approvalArtifact.proposalStatus, proposal.proposalStatus),
    Object.values(PRODUCTION_PROPOSAL_STATUSES),
    priorStatus
  );
  const approval = buildProductionApprovalArtifact({
    ...asObject(proposal.productionApprovalArtifact),
    ...asObject(approvalArtifact),
    approvalFingerprint: approvalArtifact.approvalFingerprint,
    approvedProposalId: firstDefined(approvalArtifact.approvedProposalId, proposal.proposalId),
    approvedProposalFingerprint: firstDefined(approvalArtifact.approvedProposalFingerprint, proposal.proposalFingerprint)
  });
  const nextProposal = {
    ...clone(proposal),
    productionApprovalArtifact: approval,
    proposalStatus: nextStatus,
    auditHistory: appendAuditEvent(proposal, {
      eventType: 'production_approval_attached',
      actor: approval.approvedBy || UNKNOWN_VALUE,
      eventAt: approval.approvedAt || UNKNOWN_VALUE,
      priorStatus,
      nextStatus,
      reason: approval.approvalDecision,
      details: { approvalId: approval.approvalId, approvalFingerprint: approval.approvalFingerprint }
    })
  };
  return rebuildProductionProposalWithFingerprint(nextProposal);
}

function attachSupportingEvidenceReference(proposal = {}, evidenceReference = {}, options = {}) {
  const reference = normalizeSupportingEvidenceReference(evidenceReference, options);
  const priorStatus = proposal.proposalStatus || PRODUCTION_PROPOSAL_STATUSES.DRAFTED;
  const nextStatus = normalizeEnum(
    firstDefined(options.proposalStatus, proposal.proposalStatus),
    Object.values(PRODUCTION_PROPOSAL_STATUSES),
    priorStatus
  );
  const nextProposal = {
    ...clone(proposal),
    supportingEvidenceReferences: [
      ...asArray(proposal.supportingEvidenceReferences).map((item) => clone(item)),
      reference
    ].sort((a, b) => String(a.referenceId).localeCompare(String(b.referenceId))),
    proposalStatus: nextStatus,
    auditHistory: appendAuditEvent(proposal, {
      eventType: 'supporting_evidence_attached',
      actor: firstDefined(options.actor, UNKNOWN_VALUE),
      eventAt: firstDefined(options.attachedAt, reference.attachedAt),
      priorStatus,
      nextStatus,
      reason: reference.referenceType,
      details: { referenceId: reference.referenceId, sourceFingerprint: reference.sourceFingerprint }
    })
  };
  return rebuildProductionProposalWithFingerprint(nextProposal);
}

function attachDeploymentValidationReference(proposal = {}, deploymentValidationReference = {}, options = {}) {
  const priorStatus = proposal.proposalStatus || PRODUCTION_PROPOSAL_STATUSES.IMPLEMENTED_PENDING_VALIDATION;
  const nextStatus = normalizeEnum(
    firstDefined(options.proposalStatus, deploymentValidationReference.proposalStatus, proposal.proposalStatus),
    Object.values(PRODUCTION_PROPOSAL_STATUSES),
    priorStatus
  );
  const reference = buildDeploymentValidationReference({
    ...asObject(proposal.deploymentValidationReference),
    ...asObject(deploymentValidationReference),
    available: true
  });
  const nextProposal = {
    ...clone(proposal),
    deploymentValidationReference: reference,
    proposalStatus: nextStatus,
    auditHistory: appendAuditEvent(proposal, {
      eventType: 'deployment_validation_reference_attached',
      actor: firstDefined(options.actor, UNKNOWN_VALUE),
      eventAt: firstDefined(options.attachedAt, reference.attachedAt, UNKNOWN_VALUE),
      priorStatus,
      nextStatus,
      reason: reference.validationStatus,
      details: { validationArtifactId: reference.validationArtifactId, validationFingerprint: reference.validationFingerprint }
    })
  };
  return rebuildProductionProposalWithFingerprint(nextProposal);
}

function supersedeProductionProposal(proposal = {}, supersession = {}, options = {}) {
  const supersededByProposalId = normalizeString(firstDefined(supersession.supersededByProposalId, supersession.proposalId, options.supersededByProposalId));
  const priorStatus = proposal.proposalStatus || PRODUCTION_PROPOSAL_STATUSES.DRAFTED;
  const nextProposal = {
    ...clone(proposal),
    supersededByProposalId,
    proposalStatus: PRODUCTION_PROPOSAL_STATUSES.SUPERSEDED,
    auditHistory: appendAuditEvent(proposal, {
      eventType: 'production_proposal_superseded',
      actor: firstDefined(options.actor, supersession.actor, UNKNOWN_VALUE),
      eventAt: firstDefined(options.supersededAt, supersession.supersededAt, UNKNOWN_VALUE),
      priorStatus,
      nextStatus: PRODUCTION_PROPOSAL_STATUSES.SUPERSEDED,
      reason: firstDefined(supersession.reason, 'superseded_by_newer_proposal'),
      details: { supersededByProposalId }
    })
  };
  return rebuildProductionProposalWithFingerprint(nextProposal);
}

function expireProductionProposal(proposal = {}, expiration = {}, options = {}) {
  const priorStatus = proposal.proposalStatus || PRODUCTION_PROPOSAL_STATUSES.DRAFTED;
  const expiresAt = normalizeDate(firstDefined(expiration.expiresAt, options.expiresAt, proposal.expiresAt, UNKNOWN_VALUE));
  const nextProposal = {
    ...clone(proposal),
    expiresAt,
    proposalStatus: PRODUCTION_PROPOSAL_STATUSES.EXPIRED,
    auditHistory: appendAuditEvent(proposal, {
      eventType: 'production_proposal_expired',
      actor: firstDefined(options.actor, expiration.actor, UNKNOWN_VALUE),
      eventAt: firstDefined(expiration.expiredAt, options.expiredAt, expiresAt),
      priorStatus,
      nextStatus: PRODUCTION_PROPOSAL_STATUSES.EXPIRED,
      reason: firstDefined(expiration.reason, 'proposal_expired'),
      details: { expiresAt }
    })
  };
  return rebuildProductionProposalWithFingerprint(nextProposal);
}

function determineProductionProposalStatus(proposal = {}) {
  const object = asObject(proposal);
  if (Object.values(PRODUCTION_PROPOSAL_STATUSES).includes(object.proposalStatus)) return object.proposalStatus;
  if (!Object.keys(object).length) return PRODUCTION_PROPOSAL_STATUSES.DRAFTED;
  if (known(object.supersededByProposalId)) return PRODUCTION_PROPOSAL_STATUSES.SUPERSEDED;
  if (object.productionApprovalArtifact?.approvalDecision === 'approved') return PRODUCTION_PROPOSAL_STATUSES.UNDER_REVIEW;
  if (asArray(object.sourceShadowResultFingerprints).length === 0) return PRODUCTION_PROPOSAL_STATUSES.EVIDENCE_INCOMPLETE;
  return PRODUCTION_PROPOSAL_STATUSES.READY_FOR_REVIEW;
}

function validateEnum(record, field, allowedValues, errors, invalidFields) {
  if (!allowedValues.includes(record[field])) {
    errors.push(validationError('invalid_enum_value', `${field} must be one of: ${allowedValues.join(', ')}`, field));
    invalidFields.push(field);
  }
}

function pushBucket(bucket, error) {
  bucket.push(error);
}

function isApprovedForImplementation(status) {
  return status === PRODUCTION_PROPOSAL_STATUSES.APPROVED_FOR_IMPLEMENTATION ||
    status === PRODUCTION_PROPOSAL_STATUSES.IMPLEMENTATION_IN_PROGRESS ||
    status === PRODUCTION_PROPOSAL_STATUSES.IMPLEMENTED_PENDING_VALIDATION ||
    status === PRODUCTION_PROPOSAL_STATUSES.VALIDATION_FAILED ||
    status === PRODUCTION_PROPOSAL_STATUSES.VALIDATED_FOR_DEPLOYMENT ||
    status === PRODUCTION_PROPOSAL_STATUSES.DEPLOYED_PENDING_MONITORING ||
    status === PRODUCTION_PROPOSAL_STATUSES.MONITORING_FAILED ||
    status === PRODUCTION_PROPOSAL_STATUSES.COMPLETED;
}

function validateLifecycleTransitions(proposal = {}) {
  const invalid = [];
  for (const [index, event] of asArray(proposal.auditHistory).entries()) {
    const prior = event.priorStatus;
    const next = event.nextStatus;
    if (prior === UNKNOWN_VALUE || next === UNKNOWN_VALUE) continue;
    if (!Object.values(PRODUCTION_PROPOSAL_STATUSES).includes(prior) || !Object.values(PRODUCTION_PROPOSAL_STATUSES).includes(next)) {
      invalid.push(validationError('invalid_lifecycle_status', 'Audit history contains an unsupported lifecycle status.', `auditHistory.${index}`));
      continue;
    }
    if (prior === next) continue;
    if (!asArray(ALLOWED_STATUS_TRANSITIONS[prior]).includes(next)) {
      invalid.push(validationError('invalid_lifecycle_transition', `${prior} cannot transition to ${next}.`, `auditHistory.${index}`));
    }
  }
  return invalid;
}

function validateProductionProposal(proposal = {}) {
  const errors = [];
  const warnings = [];
  const invalidFields = [];
  const invalidSourceReferences = [];
  const invalidLifecycleTransitions = [];
  const approvalBoundaryViolations = [];
  const authorityBoundaryViolations = [];
  const expirationViolations = [];
  const supersessionViolations = [];
  const fingerprintMismatches = [];
  const missing = missingRequiredFields(proposal);

  for (const field of missing) {
    errors.push(validationError('missing_required_field', `${field} is required.`, field));
    invalidFields.push(field);
  }

  if (proposal.schemaVersion !== PRODUCTION_PROPOSAL_SCHEMA_VERSION) {
    errors.push(validationError('invalid_schema_version', 'schemaVersion must match Production Proposal schema.', 'schemaVersion'));
    invalidFields.push('schemaVersion');
  }
  if (proposal.source !== PRODUCTION_PROPOSAL_SOURCE) {
    errors.push(validationError('invalid_source', 'source must be production_proposal_contract.', 'source'));
    invalidFields.push('source');
  }
  validateEnum(proposal, 'proposalCategory', PROPOSAL_CATEGORIES, errors, invalidFields);
  validateEnum(proposal, 'proposalStatus', Object.values(PRODUCTION_PROPOSAL_STATUSES), errors, invalidFields);
  validateEnum(proposal, 'confidenceLevel', CONFIDENCE_LEVELS, errors, invalidFields);

  if (proposal.confidence !== UNKNOWN_VALUE) {
    const confidence = Number(proposal.confidence);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 100) {
      errors.push(validationError('invalid_confidence', 'confidence must be 0-100 or unknown.', 'confidence'));
      invalidFields.push('confidence');
    }
  }

  for (const field of [
    'sourceRecommendationIds',
    'sourceRecommendationFingerprints',
    'sourceOfflineExperimentIds',
    'sourceOfflineExperimentFingerprints',
    'sourceShadowExperimentIds',
    'sourceShadowExperimentFingerprints',
    'sourceShadowResultIds',
    'sourceShadowResultFingerprints',
    'counterEvidence',
    'identifiedRisks',
    'knownLimitations',
    'regressionRisks',
    'deploymentPrerequisites',
    'validationChecklist',
    'requiredTestEvidence',
    'approvalRequirements',
    'supportingEvidenceReferences',
    'auditHistory'
  ]) {
    if (!Array.isArray(proposal[field])) {
      errors.push(validationError('invalid_array_field', `${field} must be an array.`, field));
      invalidFields.push(field);
    }
  }

  if (asArray(proposal.sourceRecommendationFingerprints).length === 0) {
    const warning = validationError('missing_source_recommendation_evidence', 'Production proposals should retain source recommendation fingerprints.', 'sourceRecommendationFingerprints');
    warnings.push(warning);
    invalidSourceReferences.push(warning);
  }
  if (asArray(proposal.sourceShadowResultFingerprints).length === 0) {
    const warning = validationError('missing_shadow_result_evidence', 'Production proposals require shadow result evidence before advancement.', 'sourceShadowResultFingerprints');
    warnings.push(warning);
    invalidSourceReferences.push(warning);
  }

  if (proposal.productionImpact !== 'none') {
    const error = validationError('invalid_production_impact', 'productionImpact must remain none.', 'productionImpact');
    errors.push(error);
    invalidFields.push('productionImpact');
    authorityBoundaryViolations.push(error);
  }
  if (proposal.decisionImpact !== 'none') {
    const error = validationError('invalid_decision_impact', 'decisionImpact must remain none.', 'decisionImpact');
    errors.push(error);
    invalidFields.push('decisionImpact');
    authorityBoundaryViolations.push(error);
  }
  if (proposal.executionAuthority !== 'none') {
    const error = validationError('invalid_execution_authority', 'executionAuthority must remain none.', 'executionAuthority');
    errors.push(error);
    invalidFields.push('executionAuthority');
    authorityBoundaryViolations.push(error);
  }

  const approval = asObject(proposal.productionApprovalArtifact);
  if (approval.productionImpact !== 'none' || approval.decisionImpact !== 'none' || approval.executionAuthority !== 'none') {
    const error = validationError('invalid_approval_authority', 'Production approval artifacts do not execute or authorize runtime changes.', 'productionApprovalArtifact');
    errors.push(error);
    invalidFields.push('productionApprovalArtifact');
    authorityBoundaryViolations.push(error);
  }
  if (!APPROVAL_DECISIONS.includes(approval.approvalDecision)) {
    errors.push(validationError('invalid_approval_decision', `approvalDecision must be one of: ${APPROVAL_DECISIONS.join(', ')}`, 'productionApprovalArtifact.approvalDecision'));
    invalidFields.push('productionApprovalArtifact.approvalDecision');
  }
  if (approval.approvalFingerprint && buildApprovalFingerprint(approval) !== approval.approvalFingerprint) {
    const error = validationError('approval_fingerprint_mismatch', 'approvalFingerprint does not match approval contents.', 'productionApprovalArtifact.approvalFingerprint');
    errors.push(error);
    fingerprintMismatches.push(error);
    invalidFields.push('productionApprovalArtifact.approvalFingerprint');
  }

  if (isApprovedForImplementation(proposal.proposalStatus)) {
    const hasApproval = approval.approvalDecision === 'approved' &&
      approval.approvedBy === 'Dalton' &&
      known(approval.approvedAt) &&
      approval.approvedProposalId === proposal.proposalId &&
      known(approval.approvedProposalFingerprint);
    if (!hasApproval) {
      const error = validationError(
        'approval_required_for_implementation',
        'Dalton approval metadata is required before approved_for_implementation or later statuses.',
        'productionApprovalArtifact'
      );
      errors.push(error);
      approvalBoundaryViolations.push(error);
      invalidFields.push('productionApprovalArtifact');
    }
  }

  const deployment = asObject(proposal.deploymentValidationReference);
  if (deployment.productionImpact !== 'none' || deployment.decisionImpact !== 'none' || deployment.executionAuthority !== 'none') {
    const error = validationError('invalid_deployment_validation_authority', 'Deployment validation references must not execute production changes.', 'deploymentValidationReference');
    errors.push(error);
    authorityBoundaryViolations.push(error);
    invalidFields.push('deploymentValidationReference');
  }

  for (const [index, reference] of asArray(proposal.supportingEvidenceReferences).entries()) {
    if (reference.productionImpact !== 'none' || reference.decisionImpact !== 'none' || reference.executionAuthority !== 'none') {
      const error = validationError('invalid_supporting_evidence_authority', 'Supporting evidence references must remain evidence-only.', `supportingEvidenceReferences.${index}`);
      errors.push(error);
      authorityBoundaryViolations.push(error);
      invalidFields.push(`supportingEvidenceReferences.${index}`);
    }
    if (!known(reference.sourceFingerprint) || reference.sourceFingerprint === UNKNOWN_VALUE) {
      const warning = validationError('supporting_evidence_fingerprint_missing', 'Supporting evidence references should preserve source fingerprints.', `supportingEvidenceReferences.${index}.sourceFingerprint`);
      warnings.push(warning);
      invalidSourceReferences.push(warning);
    }
  }

  const created = Date.parse(proposal.createdAt);
  const expires = Date.parse(proposal.expiresAt);
  if (Number.isFinite(created) && Number.isFinite(expires) && expires < created) {
    const error = validationError('expiration_before_creation', 'expiresAt cannot be earlier than createdAt.', 'expiresAt');
    errors.push(error);
    expirationViolations.push(error);
    invalidFields.push('expiresAt');
  }
  if (proposal.proposalStatus === PRODUCTION_PROPOSAL_STATUSES.EXPIRED && proposal.expiresAt === UNKNOWN_VALUE) {
    const error = validationError('expired_without_expiration_timestamp', 'Expired proposals must preserve expiresAt.', 'expiresAt');
    errors.push(error);
    expirationViolations.push(error);
    invalidFields.push('expiresAt');
  }

  if (known(proposal.supersedesProposalId) && proposal.supersedesProposalId === proposal.proposalId) {
    const error = validationError('self_supersession', 'A proposal cannot supersede itself.', 'supersedesProposalId');
    errors.push(error);
    supersessionViolations.push(error);
    invalidFields.push('supersedesProposalId');
  }
  if (known(proposal.supersededByProposalId) && proposal.supersededByProposalId === proposal.proposalId) {
    const error = validationError('self_supersession', 'A proposal cannot be superseded by itself.', 'supersededByProposalId');
    errors.push(error);
    supersessionViolations.push(error);
    invalidFields.push('supersededByProposalId');
  }
  if (known(proposal.supersedesProposalId) && known(proposal.supersededByProposalId) && proposal.supersedesProposalId === proposal.supersededByProposalId) {
    const error = validationError('invalid_supersession_chain', 'A proposal cannot both supersede and be superseded by the same proposal.', 'supersession');
    errors.push(error);
    supersessionViolations.push(error);
    invalidFields.push('supersession');
  }
  if (proposal.proposalStatus === PRODUCTION_PROPOSAL_STATUSES.SUPERSEDED && !known(proposal.supersededByProposalId)) {
    const error = validationError('superseded_without_successor', 'Superseded proposals must preserve supersededByProposalId.', 'supersededByProposalId');
    errors.push(error);
    supersessionViolations.push(error);
    invalidFields.push('supersededByProposalId');
  }

  const transitionErrors = validateLifecycleTransitions(proposal);
  for (const error of transitionErrors) {
    errors.push(error);
    invalidLifecycleTransitions.push(error);
    invalidFields.push(error.field);
  }

  if (proposal.proposalFingerprint && buildProductionProposalFingerprint(proposal) !== proposal.proposalFingerprint) {
    const error = validationError('proposal_fingerprint_mismatch', 'proposalFingerprint does not match proposal contents.', 'proposalFingerprint');
    errors.push(error);
    fingerprintMismatches.push(error);
    invalidFields.push('proposalFingerprint');
  }

  const reasonCodes = unique([
    ...errors.map((error) => error.code),
    ...warnings.map((warning) => warning.code)
  ]);

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes,
    invalidFields: unique(invalidFields),
    missingRequiredFields: unique(missing),
    invalidSourceReferences,
    invalidLifecycleTransitions,
    approvalBoundaryViolations,
    authorityBoundaryViolations,
    expirationViolations,
    supersessionViolations,
    fingerprintMismatches
  };
}

module.exports = {
  ALLOWED_STATUS_TRANSITIONS,
  APPROVAL_DECISIONS,
  CONFIDENCE_LEVELS,
  PRODUCTION_PROPOSAL_SCHEMA_VERSION,
  PRODUCTION_PROPOSAL_SOURCE,
  PRODUCTION_PROPOSAL_STATUSES,
  PROPOSAL_CATEGORIES,
  REQUIRED_PRODUCTION_PROPOSAL_FIELDS,
  UNKNOWN_VALUE,
  attachDeploymentValidationReference,
  attachProductionApprovalArtifact,
  attachSupportingEvidenceReference,
  buildProductionProposalBatchFingerprint,
  buildProductionProposalFingerprint,
  cloneProductionProposal,
  createProductionProposal,
  determineProductionProposalStatus,
  expireProductionProposal,
  supersedeProductionProposal,
  validateProductionProposal
};
