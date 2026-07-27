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
const productionProposalContract = require('./productionProposalContract');

const PRODUCTION_APPROVAL_SCHEMA_VERSION = '1.0.0';
const PRODUCTION_APPROVAL_SOURCE = 'production_approval_artifact';
const UNKNOWN_VALUE = 'unknown';

const APPROVAL_DECISIONS = Object.freeze([
  'approved_for_implementation',
  'rejected',
  'revision_required',
  'deferred',
  'cancelled'
]);

const APPROVAL_STATUSES = Object.freeze({
  DRAFTED: 'drafted',
  FINAL: 'final',
  EXPIRED: 'expired',
  SUPERSEDED: 'superseded',
  REVOKED: 'revoked',
  ARCHIVED: 'archived'
});

const ALLOWED_STATUS_TRANSITIONS = Object.freeze({
  drafted: ['final', 'expired', 'superseded', 'revoked', 'archived'],
  final: ['expired', 'superseded', 'revoked', 'archived'],
  expired: ['archived', 'superseded'],
  superseded: ['archived'],
  revoked: ['archived', 'superseded'],
  archived: []
});

const REQUIRED_APPROVAL_FIELDS = Object.freeze([
  'schemaVersion',
  'source',
  'approvalId',
  'proposalId',
  'proposalFingerprint',
  'proposalBatchId',
  'createdAt',
  'decidedAt',
  'expiresAt',
  'approvedBy',
  'approverRole',
  'approvalDecision',
  'approvalStatus',
  'approvedScope',
  'excludedScope',
  'conditions',
  'requiredChanges',
  'implementationConstraints',
  'validationRequirements',
  'testRequirements',
  'deploymentPrerequisites',
  'monitoringRequirements',
  'rollbackRequirements',
  'rationale',
  'revocationReason',
  'auditHistory',
  'productionImpact',
  'decisionImpact',
  'executionAuthority',
  'approvalFingerprint'
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

function normalizeNullableString(value) {
  return known(value) ? String(value).trim() : null;
}

function normalizeString(value, fallback = UNKNOWN_VALUE) {
  if (!known(value)) return fallback;
  return String(value).trim() || fallback;
}

function normalizeEnum(value, allowedValues, fallback) {
  const normalized = normalizeString(value, fallback).toLowerCase();
  return allowedValues.includes(normalized) ? normalized : normalized;
}

function normalizeAuditEvent(event = {}, options = {}) {
  const input = asObject(event);
  return {
    eventId: normalizeString(firstDefined(input.eventId, input.id, options.eventId, 'approval-audit-event')),
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

function sortAuditHistory(events = []) {
  return asArray(events).map((event) => normalizeAuditEvent(event)).sort((a, b) => {
    const time = String(a.eventAt).localeCompare(String(b.eventAt));
    if (time !== 0) return time;
    return String(a.eventId).localeCompare(String(b.eventId));
  });
}

function appendAuditEvent(artifact = {}, event = {}) {
  const history = sortAuditHistory(artifact.auditHistory);
  history.push(normalizeAuditEvent(event, {
    eventId: `${artifact.approvalId || 'approval'}-${history.length + 1}`,
    actor: UNKNOWN_VALUE,
    eventAt: UNKNOWN_VALUE
  }));
  return sortAuditHistory(history);
}

function validationError(code, message, field = '') {
  return { code, message, field };
}

function buildProductionApprovalFingerprint(approvalArtifact = {}) {
  const projection = clone(approvalArtifact);
  delete projection.approvalFingerprint;
  return buildFingerprintFromProjection(projection);
}

function buildProductionApprovalBatchFingerprint(batch = {}) {
  const projection = clone(batch);
  delete projection.approvalBatchFingerprint;
  delete projection.productionApprovalBatchFingerprint;
  return buildFingerprintFromProjection(projection);
}

function createProductionApprovalArtifact(input = {}, options = {}) {
  const proposal = asObject(firstDefined(input.proposal, options.proposal));
  const core = {
    schemaVersion: PRODUCTION_APPROVAL_SCHEMA_VERSION,
    source: PRODUCTION_APPROVAL_SOURCE,
    approvalId: normalizeString(firstDefined(input.approvalId, options.approvalId, 'production-approval')),
    proposalId: normalizeString(firstDefined(input.proposalId, proposal.proposalId)),
    proposalFingerprint: normalizeString(firstDefined(input.proposalFingerprint, proposal.proposalFingerprint)),
    proposalBatchId: normalizeString(firstDefined(input.proposalBatchId, proposal.proposalBatchId)),
    createdAt: normalizeDate(firstDefined(input.createdAt, options.createdAt, UNKNOWN_VALUE)),
    decidedAt: normalizeDate(firstDefined(input.decidedAt, options.decidedAt, UNKNOWN_VALUE)),
    expiresAt: known(firstDefined(input.expiresAt, options.expiresAt))
      ? normalizeDate(firstDefined(input.expiresAt, options.expiresAt))
      : UNKNOWN_VALUE,
    approvedBy: normalizeString(input.approvedBy),
    approverRole: normalizeString(input.approverRole),
    approvalDecision: normalizeEnum(input.approvalDecision, APPROVAL_DECISIONS, 'deferred'),
    approvalStatus: normalizeEnum(input.approvalStatus, Object.values(APPROVAL_STATUSES), APPROVAL_STATUSES.DRAFTED),
    approvedScope: clone(asObject(input.approvedScope)),
    excludedScope: clone(asObject(input.excludedScope)),
    conditions: asArray(input.conditions).map((item) => clone(item)),
    requiredChanges: asArray(input.requiredChanges).map((item) => clone(item)),
    implementationConstraints: asArray(input.implementationConstraints).map((item) => clone(item)),
    validationRequirements: asArray(input.validationRequirements).map((item) => clone(item)),
    testRequirements: asArray(input.testRequirements).map((item) => clone(item)),
    deploymentPrerequisites: asArray(input.deploymentPrerequisites).map((item) => clone(item)),
    monitoringRequirements: asArray(input.monitoringRequirements).map((item) => clone(item)),
    rollbackRequirements: asArray(input.rollbackRequirements).map((item) => clone(item)),
    rationale: normalizeString(input.rationale, UNKNOWN_VALUE),
    notes: known(input.notes) ? String(input.notes) : '',
    supersedesApprovalId: normalizeNullableString(input.supersedesApprovalId),
    supersededByApprovalId: normalizeNullableString(input.supersededByApprovalId),
    revokedAt: known(input.revokedAt) ? normalizeDate(input.revokedAt) : null,
    revocationReason: normalizeString(input.revocationReason, UNKNOWN_VALUE),
    auditHistory: sortAuditHistory(input.auditHistory),
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };

  return deepFreeze({
    ...core,
    approvalFingerprint: buildProductionApprovalFingerprint(core)
  });
}

function cloneProductionApprovalArtifact(approvalArtifact = {}) {
  return clone(approvalArtifact);
}

function rebuildApprovalWithFingerprint(approvalArtifact = {}) {
  const projection = clone(approvalArtifact);
  delete projection.approvalFingerprint;
  return deepFreeze({
    ...projection,
    approvalFingerprint: buildProductionApprovalFingerprint(projection)
  });
}

function determineProductionApprovalStatus(approvalArtifact = {}) {
  const object = asObject(approvalArtifact);
  if (Object.values(APPROVAL_STATUSES).includes(object.approvalStatus)) return object.approvalStatus;
  if (!Object.keys(object).length) return APPROVAL_STATUSES.DRAFTED;
  if (known(object.revokedAt)) return APPROVAL_STATUSES.REVOKED;
  if (known(object.supersededByApprovalId)) return APPROVAL_STATUSES.SUPERSEDED;
  if (APPROVAL_DECISIONS.includes(object.approvalDecision)) return APPROVAL_STATUSES.FINAL;
  return APPROVAL_STATUSES.DRAFTED;
}

function scopeExceedsProposal(approvedScope = {}, proposal = {}) {
  const scope = asObject(approvedScope);
  const violations = [];
  for (const [scopeField, proposalField] of [
    ['proposalCategory', 'proposalCategory'],
    ['affectedSubsystem', 'affectedSubsystem'],
    ['affectedRuleOrField', 'affectedRuleOrField']
  ]) {
    if (known(scope[scopeField]) && known(proposal[proposalField]) && scope[scopeField] !== proposal[proposalField]) {
      violations.push(validationError('approval_scope_exceeds_proposal', `${scopeField} does not match bound proposal.`, `approvedScope.${scopeField}`));
    }
  }
  return violations;
}

function verifyProductionProposalBinding(approvalArtifact = {}, proposal = {}, options = {}) {
  const errors = [];
  const warnings = [];
  const proposalObject = asObject(proposal);
  const proposalValidation = productionProposalContract.validateProductionProposal(proposalObject);

  if (!proposalValidation.valid) {
    errors.push(validationError('invalid_bound_proposal', 'Bound production proposal failed validation.', 'proposal'));
  }
  if (approvalArtifact.proposalId !== proposalObject.proposalId) {
    errors.push(validationError('proposal_id_mismatch', 'approval proposalId does not match bound proposal.', 'proposalId'));
  }
  if (approvalArtifact.proposalFingerprint !== proposalObject.proposalFingerprint) {
    errors.push(validationError('proposal_fingerprint_mismatch', 'approval proposalFingerprint does not match bound proposal.', 'proposalFingerprint'));
  }
  if (proposalObject.proposalFingerprint && productionProposalContract.buildProductionProposalFingerprint(proposalObject) !== proposalObject.proposalFingerprint) {
    errors.push(validationError('bound_proposal_fingerprint_mismatch', 'Bound proposal fingerprint does not match proposal contents.', 'proposal.proposalFingerprint'));
  }
  if ([
    productionProposalContract.PRODUCTION_PROPOSAL_STATUSES.EXPIRED,
    productionProposalContract.PRODUCTION_PROPOSAL_STATUSES.SUPERSEDED,
    productionProposalContract.PRODUCTION_PROPOSAL_STATUSES.ARCHIVED
  ].includes(proposalObject.proposalStatus)) {
    errors.push(validationError('bound_proposal_not_current', 'Expired, superseded, or archived proposals cannot be approved as current evidence.', 'proposal.proposalStatus'));
  }

  const asOf = firstDefined(options.asOf, approvalArtifact.decidedAt);
  if (known(asOf) && known(proposalObject.expiresAt) && proposalObject.expiresAt !== UNKNOWN_VALUE) {
    const asOfTime = Date.parse(asOf);
    const proposalExpiry = Date.parse(proposalObject.expiresAt);
    if (Number.isFinite(asOfTime) && Number.isFinite(proposalExpiry) && proposalExpiry < asOfTime) {
      errors.push(validationError('bound_proposal_expired_at_decision', 'Bound proposal expired before approval decision.', 'proposal.expiresAt'));
    }
  }

  errors.push(...scopeExceedsProposal(approvalArtifact.approvedScope, proposalObject));

  if (proposalValidation.authorityBoundaryViolations?.length) {
    errors.push(validationError('bound_proposal_authority_violation', 'Bound proposal authority boundaries are not intact.', 'proposal'));
  }
  if (proposalValidation.warnings?.length) {
    warnings.push(...proposalValidation.warnings.map((warning) => ({
      ...warning,
      field: `proposal.${warning.field || ''}`.replace(/\.$/, '')
    })));
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes: unique([
      ...errors.map((error) => error.code),
      ...warnings.map((warning) => warning.code)
    ]),
    proposalValidation
  };
}

function validateLifecycleTransitions(approvalArtifact = {}) {
  const invalid = [];
  for (const [index, event] of asArray(approvalArtifact.auditHistory).entries()) {
    const prior = event.priorStatus;
    const next = event.nextStatus;
    if (prior === UNKNOWN_VALUE || next === UNKNOWN_VALUE) continue;
    if (!Object.values(APPROVAL_STATUSES).includes(prior) || !Object.values(APPROVAL_STATUSES).includes(next)) {
      invalid.push(validationError('invalid_lifecycle_status', 'Audit history contains an unsupported approval status.', `auditHistory.${index}`));
      continue;
    }
    if (prior === next) continue;
    if (!asArray(ALLOWED_STATUS_TRANSITIONS[prior]).includes(next)) {
      invalid.push(validationError('invalid_lifecycle_transition', `${prior} cannot transition to ${next}.`, `auditHistory.${index}`));
    }
  }
  return invalid;
}

function missingRequiredFields(record = {}) {
  return REQUIRED_APPROVAL_FIELDS.filter((field) => {
    const value = record[field];
    return value === undefined || value === null || value === '';
  });
}

function validateProductionApprovalArtifact(approvalArtifact = {}, options = {}) {
  const errors = [];
  const warnings = [];
  const invalidFields = [];
  const proposalBindingViolations = [];
  const approvalBoundaryViolations = [];
  const authorityBoundaryViolations = [];
  const expirationViolations = [];
  const supersessionViolations = [];
  const revocationViolations = [];
  const fingerprintMismatches = [];
  const missing = missingRequiredFields(approvalArtifact);

  for (const field of missing) {
    errors.push(validationError('missing_required_field', `${field} is required.`, field));
    invalidFields.push(field);
  }

  if (approvalArtifact.schemaVersion !== PRODUCTION_APPROVAL_SCHEMA_VERSION) {
    errors.push(validationError('invalid_schema_version', 'schemaVersion must match Production Approval schema.', 'schemaVersion'));
    invalidFields.push('schemaVersion');
  }
  if (approvalArtifact.source !== PRODUCTION_APPROVAL_SOURCE) {
    errors.push(validationError('invalid_source', 'source must be production_approval_artifact.', 'source'));
    invalidFields.push('source');
  }
  if (!APPROVAL_DECISIONS.includes(approvalArtifact.approvalDecision)) {
    errors.push(validationError('invalid_approval_decision', `approvalDecision must be one of: ${APPROVAL_DECISIONS.join(', ')}`, 'approvalDecision'));
    invalidFields.push('approvalDecision');
  }
  if (!Object.values(APPROVAL_STATUSES).includes(approvalArtifact.approvalStatus)) {
    errors.push(validationError('invalid_approval_status', `approvalStatus must be one of: ${Object.values(APPROVAL_STATUSES).join(', ')}`, 'approvalStatus'));
    invalidFields.push('approvalStatus');
  }

  for (const field of [
    'conditions',
    'requiredChanges',
    'implementationConstraints',
    'validationRequirements',
    'testRequirements',
    'deploymentPrerequisites',
    'monitoringRequirements',
    'rollbackRequirements',
    'auditHistory'
  ]) {
    if (!Array.isArray(approvalArtifact[field])) {
      errors.push(validationError('invalid_array_field', `${field} must be an array.`, field));
      invalidFields.push(field);
    }
  }

  if (approvalArtifact.productionImpact !== 'none') {
    const error = validationError('invalid_production_impact', 'productionImpact must remain none.', 'productionImpact');
    errors.push(error);
    invalidFields.push('productionImpact');
    authorityBoundaryViolations.push(error);
  }
  if (approvalArtifact.decisionImpact !== 'none') {
    const error = validationError('invalid_decision_impact', 'decisionImpact must remain none.', 'decisionImpact');
    errors.push(error);
    invalidFields.push('decisionImpact');
    authorityBoundaryViolations.push(error);
  }
  if (approvalArtifact.executionAuthority !== 'none') {
    const error = validationError('invalid_execution_authority', 'executionAuthority must remain none.', 'executionAuthority');
    errors.push(error);
    invalidFields.push('executionAuthority');
    authorityBoundaryViolations.push(error);
  }

  if (approvalArtifact.approvalDecision === 'approved_for_implementation') {
    const explicitApprovalErrors = [];
    if (approvalArtifact.approvedBy !== 'Dalton') explicitApprovalErrors.push(validationError('dalton_approval_required', 'approvedBy must explicitly identify Dalton.', 'approvedBy'));
    if (!known(approvalArtifact.approverRole) || approvalArtifact.approverRole === UNKNOWN_VALUE) explicitApprovalErrors.push(validationError('approver_role_required', 'approverRole must identify the human production owner.', 'approverRole'));
    if (!known(approvalArtifact.decidedAt) || approvalArtifact.decidedAt === UNKNOWN_VALUE) explicitApprovalErrors.push(validationError('decided_at_required', 'decidedAt must be explicit for implementation approval.', 'decidedAt'));
    if (!known(approvalArtifact.proposalId) || approvalArtifact.proposalId === UNKNOWN_VALUE) explicitApprovalErrors.push(validationError('proposal_id_required', 'proposalId is required for implementation approval.', 'proposalId'));
    if (!known(approvalArtifact.proposalFingerprint) || approvalArtifact.proposalFingerprint === UNKNOWN_VALUE) explicitApprovalErrors.push(validationError('proposal_fingerprint_required', 'proposalFingerprint is required for implementation approval.', 'proposalFingerprint'));
    if (!Object.keys(asObject(approvalArtifact.approvedScope)).length) explicitApprovalErrors.push(validationError('approved_scope_required', 'approvedScope must be explicit for implementation approval.', 'approvedScope'));
    if (!Array.isArray(approvalArtifact.conditions)) explicitApprovalErrors.push(validationError('conditions_required', 'conditions must be an explicit array.', 'conditions'));
    if (!Array.isArray(approvalArtifact.validationRequirements) || approvalArtifact.validationRequirements.length === 0) explicitApprovalErrors.push(validationError('validation_requirements_required', 'validationRequirements must be explicit for implementation approval.', 'validationRequirements'));
    if (!Array.isArray(approvalArtifact.rollbackRequirements) || approvalArtifact.rollbackRequirements.length === 0) explicitApprovalErrors.push(validationError('rollback_requirements_required', 'rollbackRequirements must be explicit for implementation approval.', 'rollbackRequirements'));
    if (!Array.isArray(approvalArtifact.monitoringRequirements) || approvalArtifact.monitoringRequirements.length === 0) explicitApprovalErrors.push(validationError('monitoring_requirements_required', 'monitoringRequirements must be explicit for implementation approval.', 'monitoringRequirements'));
    errors.push(...explicitApprovalErrors);
    approvalBoundaryViolations.push(...explicitApprovalErrors);
    invalidFields.push(...explicitApprovalErrors.map((error) => error.field));
  }

  const created = Date.parse(approvalArtifact.createdAt);
  const decided = Date.parse(approvalArtifact.decidedAt);
  const expires = Date.parse(approvalArtifact.expiresAt);
  if (Number.isFinite(created) && Number.isFinite(expires) && expires < created) {
    const error = validationError('expiration_before_creation', 'expiresAt cannot be earlier than createdAt.', 'expiresAt');
    errors.push(error);
    expirationViolations.push(error);
    invalidFields.push('expiresAt');
  }
  if (Number.isFinite(decided) && Number.isFinite(expires) && expires < decided) {
    const error = validationError('expiration_before_decision', 'expiresAt cannot be earlier than decidedAt.', 'expiresAt');
    errors.push(error);
    expirationViolations.push(error);
    invalidFields.push('expiresAt');
  }
  if (approvalArtifact.approvalStatus === APPROVAL_STATUSES.EXPIRED && approvalArtifact.expiresAt === UNKNOWN_VALUE) {
    const error = validationError('expired_without_expiration_timestamp', 'Expired approvals must preserve expiresAt.', 'expiresAt');
    errors.push(error);
    expirationViolations.push(error);
    invalidFields.push('expiresAt');
  }

  if (known(approvalArtifact.supersedesApprovalId) && approvalArtifact.supersedesApprovalId === approvalArtifact.approvalId) {
    const error = validationError('self_supersession', 'An approval cannot supersede itself.', 'supersedesApprovalId');
    errors.push(error);
    supersessionViolations.push(error);
    invalidFields.push('supersedesApprovalId');
  }
  if (known(approvalArtifact.supersededByApprovalId) && approvalArtifact.supersededByApprovalId === approvalArtifact.approvalId) {
    const error = validationError('self_supersession', 'An approval cannot be superseded by itself.', 'supersededByApprovalId');
    errors.push(error);
    supersessionViolations.push(error);
    invalidFields.push('supersededByApprovalId');
  }
  if (known(approvalArtifact.supersedesApprovalId) && known(approvalArtifact.supersededByApprovalId) && approvalArtifact.supersedesApprovalId === approvalArtifact.supersededByApprovalId) {
    const error = validationError('invalid_supersession_chain', 'An approval cannot supersede and be superseded by the same approval.', 'supersession');
    errors.push(error);
    supersessionViolations.push(error);
    invalidFields.push('supersession');
  }
  if (approvalArtifact.approvalStatus === APPROVAL_STATUSES.SUPERSEDED && !known(approvalArtifact.supersededByApprovalId)) {
    const error = validationError('superseded_without_successor', 'Superseded approvals must preserve supersededByApprovalId.', 'supersededByApprovalId');
    errors.push(error);
    supersessionViolations.push(error);
    invalidFields.push('supersededByApprovalId');
  }

  if (approvalArtifact.approvalStatus === APPROVAL_STATUSES.REVOKED) {
    if (!known(approvalArtifact.revokedAt)) {
      const error = validationError('revoked_without_timestamp', 'Revoked approvals must preserve revokedAt.', 'revokedAt');
      errors.push(error);
      revocationViolations.push(error);
      invalidFields.push('revokedAt');
    }
    if (!known(approvalArtifact.revocationReason) || approvalArtifact.revocationReason === UNKNOWN_VALUE) {
      const error = validationError('revoked_without_reason', 'Revoked approvals must preserve revocationReason.', 'revocationReason');
      errors.push(error);
      revocationViolations.push(error);
      invalidFields.push('revocationReason');
    }
  }

  const transitionErrors = validateLifecycleTransitions(approvalArtifact);
  for (const error of transitionErrors) {
    errors.push(error);
    invalidFields.push(error.field);
  }

  if (options.proposal) {
    const binding = verifyProductionProposalBinding(approvalArtifact, options.proposal, options);
    if (!binding.valid) {
      proposalBindingViolations.push(...binding.errors);
      errors.push(...binding.errors);
      invalidFields.push(...binding.errors.map((error) => error.field));
    }
    warnings.push(...binding.warnings);
  }

  if (approvalArtifact.approvalFingerprint && buildProductionApprovalFingerprint(approvalArtifact) !== approvalArtifact.approvalFingerprint) {
    const error = validationError('approval_fingerprint_mismatch', 'approvalFingerprint does not match approval contents.', 'approvalFingerprint');
    errors.push(error);
    fingerprintMismatches.push(error);
    invalidFields.push('approvalFingerprint');
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
    proposalBindingViolations,
    approvalBoundaryViolations,
    authorityBoundaryViolations,
    expirationViolations,
    supersessionViolations,
    revocationViolations,
    fingerprintMismatches
  };
}

function supersedeProductionApprovalArtifact(approvalArtifact = {}, supersession = {}, options = {}) {
  const supersededByApprovalId = normalizeString(firstDefined(supersession.supersededByApprovalId, supersession.approvalId, options.supersededByApprovalId));
  const priorStatus = approvalArtifact.approvalStatus || APPROVAL_STATUSES.FINAL;
  const next = {
    ...clone(approvalArtifact),
    supersededByApprovalId,
    approvalStatus: APPROVAL_STATUSES.SUPERSEDED,
    auditHistory: appendAuditEvent(approvalArtifact, {
      eventType: 'production_approval_superseded',
      actor: firstDefined(options.actor, supersession.actor, UNKNOWN_VALUE),
      eventAt: firstDefined(options.supersededAt, supersession.supersededAt, UNKNOWN_VALUE),
      priorStatus,
      nextStatus: APPROVAL_STATUSES.SUPERSEDED,
      reason: firstDefined(supersession.reason, 'superseded_by_newer_approval'),
      details: { supersededByApprovalId }
    })
  };
  return rebuildApprovalWithFingerprint(next);
}

function revokeProductionApprovalArtifact(approvalArtifact = {}, revocation = {}, options = {}) {
  const revokedAt = normalizeDate(firstDefined(revocation.revokedAt, options.revokedAt, UNKNOWN_VALUE));
  const revocationReason = normalizeString(firstDefined(revocation.revocationReason, revocation.reason, options.revocationReason), UNKNOWN_VALUE);
  const priorStatus = approvalArtifact.approvalStatus || APPROVAL_STATUSES.FINAL;
  const next = {
    ...clone(approvalArtifact),
    revokedAt,
    revocationReason,
    approvalStatus: APPROVAL_STATUSES.REVOKED,
    auditHistory: appendAuditEvent(approvalArtifact, {
      eventType: 'production_approval_revoked',
      actor: firstDefined(options.actor, revocation.actor, UNKNOWN_VALUE),
      eventAt: revokedAt,
      priorStatus,
      nextStatus: APPROVAL_STATUSES.REVOKED,
      reason: revocationReason,
      details: { revokedAt }
    })
  };
  return rebuildApprovalWithFingerprint(next);
}

function summarizeProductionApprovalArtifact(approvalArtifact = {}, proposal = null) {
  const validation = validateProductionApprovalArtifact(approvalArtifact, proposal ? { proposal } : {});
  const currentEvidence = ![
    APPROVAL_STATUSES.EXPIRED,
    APPROVAL_STATUSES.SUPERSEDED,
    APPROVAL_STATUSES.REVOKED,
    APPROVAL_STATUSES.ARCHIVED
  ].includes(approvalArtifact.approvalStatus);

  return deepFreeze({
    approvalId: normalizeString(approvalArtifact.approvalId),
    proposalId: normalizeString(approvalArtifact.proposalId),
    proposalFingerprint: normalizeString(approvalArtifact.proposalFingerprint),
    approvalDecision: normalizeString(approvalArtifact.approvalDecision),
    approvalStatus: normalizeString(approvalArtifact.approvalStatus),
    approvedBy: normalizeString(approvalArtifact.approvedBy),
    approverRole: normalizeString(approvalArtifact.approverRole),
    decidedAt: normalizeString(approvalArtifact.decidedAt),
    expiresAt: normalizeString(approvalArtifact.expiresAt),
    currentApprovalEvidence: currentEvidence,
    valid: validation.valid,
    reasonCodes: validation.reasonCodes,
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none',
    approvalFingerprint: normalizeString(approvalArtifact.approvalFingerprint)
  });
}

function exportProductionApprovalArtifact(approvalArtifact = {}, outputPath = null) {
  const serialized = `${JSON.stringify(approvalArtifact, null, 2)}\n`;
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, serialized);
  }
  return serialized;
}

function importProductionApprovalArtifact(input) {
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) return {};
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) return JSON.parse(trimmed);
    return JSON.parse(fs.readFileSync(trimmed, 'utf8'));
  }
  return clone(input);
}

module.exports = {
  ALLOWED_STATUS_TRANSITIONS,
  APPROVAL_DECISIONS,
  APPROVAL_STATUSES,
  PRODUCTION_APPROVAL_SCHEMA_VERSION,
  PRODUCTION_APPROVAL_SOURCE,
  REQUIRED_APPROVAL_FIELDS,
  UNKNOWN_VALUE,
  buildProductionApprovalBatchFingerprint,
  buildProductionApprovalFingerprint,
  cloneProductionApprovalArtifact,
  createProductionApprovalArtifact,
  determineProductionApprovalStatus,
  exportProductionApprovalArtifact,
  importProductionApprovalArtifact,
  revokeProductionApprovalArtifact,
  summarizeProductionApprovalArtifact,
  supersedeProductionApprovalArtifact,
  validateProductionApprovalArtifact,
  verifyProductionProposalBinding
};
