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
const productionApprovalArtifact = require('./productionApprovalArtifact');

const DEPLOYMENT_VALIDATION_SCHEMA_VERSION = '1.0.0';
const DEPLOYMENT_VALIDATION_SOURCE = 'deployment_validation_artifact';
const UNKNOWN_VALUE = 'unknown';

const DEPLOYMENT_VALIDATION_STATUSES = Object.freeze({
  DRAFTED: 'drafted',
  IN_PROGRESS: 'in_progress',
  PASSED: 'passed',
  FAILED: 'failed',
  BLOCKED: 'blocked',
  EXPIRED: 'expired',
  SUPERSEDED: 'superseded',
  ARCHIVED: 'archived'
});

const ALLOWED_STATUS_TRANSITIONS = Object.freeze({
  drafted: ['in_progress', 'passed', 'failed', 'blocked', 'expired', 'superseded', 'archived'],
  in_progress: ['passed', 'failed', 'blocked', 'expired', 'superseded', 'archived'],
  passed: ['expired', 'superseded', 'archived'],
  failed: ['in_progress', 'blocked', 'expired', 'superseded', 'archived'],
  blocked: ['in_progress', 'failed', 'expired', 'superseded', 'archived'],
  expired: ['archived', 'superseded'],
  superseded: ['archived'],
  archived: []
});

const REQUIRED_VALIDATION_FIELDS = Object.freeze([
  'schemaVersion',
  'source',
  'validationArtifactId',
  'proposalId',
  'proposalFingerprint',
  'approvalId',
  'approvalFingerprint',
  'createdAt',
  'completedAt',
  'expiresAt',
  'validationStatus',
  'validationChecklistResults',
  'requiredTestResults',
  'regressionSummary',
  'monitoringReadiness',
  'rollbackReadiness',
  'deploymentPrerequisitesSatisfied',
  'outstandingIssues',
  'evidenceReferences',
  'auditHistory',
  'productionImpact',
  'decisionImpact',
  'executionAuthority',
  'validationFingerprint'
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

function normalizeNullableString(value) {
  return known(value) ? String(value).trim() : null;
}

function normalizeEnum(value, allowedValues, fallback) {
  const normalized = normalizeString(value, fallback).toLowerCase();
  return allowedValues.includes(normalized) ? normalized : normalized;
}

function validationError(code, message, field = '') {
  return { code, message, field };
}

function normalizeAuditEvent(event = {}, options = {}) {
  const input = asObject(event);
  return {
    eventId: normalizeString(firstDefined(input.eventId, input.id, options.eventId, 'deployment-validation-audit-event')),
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
    eventId: `${artifact.validationArtifactId || 'deployment-validation'}-${history.length + 1}`,
    actor: UNKNOWN_VALUE,
    eventAt: UNKNOWN_VALUE
  }));
  return sortAuditHistory(history);
}

function normalizeEvidenceReference(reference = {}, options = {}) {
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

function buildDeploymentValidationFingerprint(validationArtifact = {}) {
  const projection = clone(validationArtifact);
  delete projection.validationFingerprint;
  return buildFingerprintFromProjection(projection);
}

function buildDeploymentValidationBatchFingerprint(batch = {}) {
  const projection = clone(batch);
  delete projection.validationBatchFingerprint;
  delete projection.deploymentValidationBatchFingerprint;
  return buildFingerprintFromProjection(projection);
}

function createDeploymentValidationArtifact(input = {}, options = {}) {
  const proposal = asObject(firstDefined(input.proposal, options.proposal));
  const approval = asObject(firstDefined(input.approvalArtifact, input.approval, options.approvalArtifact, options.approval));
  const core = {
    schemaVersion: DEPLOYMENT_VALIDATION_SCHEMA_VERSION,
    source: DEPLOYMENT_VALIDATION_SOURCE,
    validationArtifactId: normalizeString(firstDefined(input.validationArtifactId, options.validationArtifactId, 'deployment-validation')),
    proposalId: normalizeString(firstDefined(input.proposalId, proposal.proposalId, approval.proposalId)),
    proposalFingerprint: normalizeString(firstDefined(input.proposalFingerprint, proposal.proposalFingerprint, approval.proposalFingerprint)),
    approvalId: normalizeString(firstDefined(input.approvalId, approval.approvalId)),
    approvalFingerprint: normalizeString(firstDefined(input.approvalFingerprint, approval.approvalFingerprint)),
    createdAt: normalizeDate(firstDefined(input.createdAt, options.createdAt, UNKNOWN_VALUE)),
    completedAt: normalizeDate(firstDefined(input.completedAt, options.completedAt, UNKNOWN_VALUE)),
    expiresAt: known(firstDefined(input.expiresAt, options.expiresAt))
      ? normalizeDate(firstDefined(input.expiresAt, options.expiresAt))
      : UNKNOWN_VALUE,
    validationStatus: normalizeEnum(input.validationStatus, Object.values(DEPLOYMENT_VALIDATION_STATUSES), DEPLOYMENT_VALIDATION_STATUSES.DRAFTED),
    validationChecklistResults: asArray(input.validationChecklistResults).map((item) => clone(item)),
    requiredTestResults: asArray(input.requiredTestResults).map((item) => clone(item)),
    regressionSummary: clone(asObject(input.regressionSummary)),
    monitoringReadiness: clone(asObject(input.monitoringReadiness)),
    rollbackReadiness: clone(asObject(input.rollbackReadiness)),
    deploymentPrerequisitesSatisfied: input.deploymentPrerequisitesSatisfied === true,
    outstandingIssues: asArray(input.outstandingIssues).map((item) => clone(item)),
    evidenceReferences: asArray(input.evidenceReferences).map((reference) => normalizeEvidenceReference(reference)),
    validationNotes: known(input.validationNotes) ? String(input.validationNotes) : '',
    supersedesValidationArtifactId: normalizeNullableString(input.supersedesValidationArtifactId),
    supersededByValidationArtifactId: normalizeNullableString(input.supersededByValidationArtifactId),
    auditHistory: sortAuditHistory(input.auditHistory),
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };

  return deepFreeze({
    ...core,
    validationFingerprint: buildDeploymentValidationFingerprint(core)
  });
}

function cloneDeploymentValidationArtifact(validationArtifact = {}) {
  return clone(validationArtifact);
}

function rebuildValidationArtifactWithFingerprint(validationArtifact = {}) {
  const projection = clone(validationArtifact);
  delete projection.validationFingerprint;
  return deepFreeze({
    ...projection,
    validationFingerprint: buildDeploymentValidationFingerprint(projection)
  });
}

function determineDeploymentValidationStatus(validationArtifact = {}) {
  const object = asObject(validationArtifact);
  if (Object.values(DEPLOYMENT_VALIDATION_STATUSES).includes(object.validationStatus)) return object.validationStatus;
  if (!Object.keys(object).length) return DEPLOYMENT_VALIDATION_STATUSES.DRAFTED;
  if (known(object.supersededByValidationArtifactId)) return DEPLOYMENT_VALIDATION_STATUSES.SUPERSEDED;
  if (object.deploymentPrerequisitesSatisfied === true && asArray(object.outstandingIssues).length === 0) return DEPLOYMENT_VALIDATION_STATUSES.PASSED;
  if (asArray(object.outstandingIssues).length > 0) return DEPLOYMENT_VALIDATION_STATUSES.BLOCKED;
  return DEPLOYMENT_VALIDATION_STATUSES.DRAFTED;
}

function verifyProposalApprovalBinding(validationArtifact = {}, proposal = {}, approvalArtifact = {}, options = {}) {
  const errors = [];
  const warnings = [];
  const proposalObject = asObject(proposal);
  const approvalObject = asObject(approvalArtifact);
  const proposalValidation = productionProposalContract.validateProductionProposal(proposalObject);
  const approvalValidation = productionApprovalArtifact.validateProductionApprovalArtifact(approvalObject, { proposal: proposalObject });

  if (!proposalValidation.valid) errors.push(validationError('invalid_bound_proposal', 'Bound production proposal failed validation.', 'proposal'));
  if (!approvalValidation.valid) errors.push(validationError('invalid_bound_approval', 'Bound production approval failed validation.', 'approvalArtifact'));
  if (validationArtifact.proposalId !== proposalObject.proposalId) errors.push(validationError('proposal_id_mismatch', 'validation proposalId does not match bound proposal.', 'proposalId'));
  if (validationArtifact.proposalFingerprint !== proposalObject.proposalFingerprint) errors.push(validationError('proposal_fingerprint_mismatch', 'validation proposalFingerprint does not match bound proposal.', 'proposalFingerprint'));
  if (validationArtifact.approvalId !== approvalObject.approvalId) errors.push(validationError('approval_id_mismatch', 'validation approvalId does not match bound approval.', 'approvalId'));
  if (validationArtifact.approvalFingerprint !== approvalObject.approvalFingerprint) errors.push(validationError('approval_fingerprint_mismatch', 'validation approvalFingerprint does not match bound approval.', 'approvalFingerprint'));

  if (approvalObject.proposalId !== proposalObject.proposalId) errors.push(validationError('approval_proposal_id_mismatch', 'Approval is not bound to the supplied proposal.', 'approvalArtifact.proposalId'));
  if (approvalObject.proposalFingerprint !== proposalObject.proposalFingerprint) errors.push(validationError('approval_proposal_fingerprint_mismatch', 'Approval proposal fingerprint does not match supplied proposal.', 'approvalArtifact.proposalFingerprint'));
  if (approvalObject.approvalDecision !== 'approved_for_implementation') errors.push(validationError('approval_not_for_implementation', 'Deployment validation requires an approval_for_implementation artifact.', 'approvalArtifact.approvalDecision'));
  if ([
    productionApprovalArtifact.APPROVAL_STATUSES.EXPIRED,
    productionApprovalArtifact.APPROVAL_STATUSES.SUPERSEDED,
    productionApprovalArtifact.APPROVAL_STATUSES.REVOKED,
    productionApprovalArtifact.APPROVAL_STATUSES.ARCHIVED
  ].includes(approvalObject.approvalStatus)) {
    errors.push(validationError('approval_not_current', 'Expired, superseded, revoked, or archived approvals cannot support deployment validation.', 'approvalArtifact.approvalStatus'));
  }
  if ([
    productionProposalContract.PRODUCTION_PROPOSAL_STATUSES.EXPIRED,
    productionProposalContract.PRODUCTION_PROPOSAL_STATUSES.SUPERSEDED,
    productionProposalContract.PRODUCTION_PROPOSAL_STATUSES.ARCHIVED
  ].includes(proposalObject.proposalStatus)) {
    errors.push(validationError('proposal_not_current', 'Expired, superseded, or archived proposals cannot support deployment validation.', 'proposal.proposalStatus'));
  }

  const asOf = firstDefined(options.asOf, validationArtifact.completedAt, validationArtifact.createdAt);
  if (known(asOf) && known(approvalObject.expiresAt) && approvalObject.expiresAt !== UNKNOWN_VALUE) {
    const asOfTime = Date.parse(asOf);
    const approvalExpiry = Date.parse(approvalObject.expiresAt);
    if (Number.isFinite(asOfTime) && Number.isFinite(approvalExpiry) && approvalExpiry < asOfTime) {
      errors.push(validationError('approval_expired_at_validation', 'Approval expired before deployment validation completed.', 'approvalArtifact.expiresAt'));
    }
  }

  warnings.push(...asArray(proposalValidation.warnings).map((warning) => ({
    ...warning,
    field: `proposal.${warning.field || ''}`.replace(/\.$/, '')
  })));
  warnings.push(...asArray(approvalValidation.warnings).map((warning) => ({
    ...warning,
    field: `approvalArtifact.${warning.field || ''}`.replace(/\.$/, '')
  })));

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes: unique([
      ...errors.map((error) => error.code),
      ...warnings.map((warning) => warning.code)
    ]),
    proposalValidation,
    approvalValidation
  };
}

function validateLifecycleTransitions(validationArtifact = {}) {
  const invalid = [];
  for (const [index, event] of asArray(validationArtifact.auditHistory).entries()) {
    const prior = event.priorStatus;
    const next = event.nextStatus;
    if (prior === UNKNOWN_VALUE || next === UNKNOWN_VALUE) continue;
    if (!Object.values(DEPLOYMENT_VALIDATION_STATUSES).includes(prior) || !Object.values(DEPLOYMENT_VALIDATION_STATUSES).includes(next)) {
      invalid.push(validationError('invalid_lifecycle_status', 'Audit history contains an unsupported deployment validation status.', `auditHistory.${index}`));
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
  return REQUIRED_VALIDATION_FIELDS.filter((field) => {
    const value = record[field];
    return value === undefined || value === null || value === '';
  });
}

function validateDeploymentValidationArtifact(validationArtifact = {}, options = {}) {
  const errors = [];
  const warnings = [];
  const bindingViolations = [];
  const authorityBoundaryViolations = [];
  const expirationViolations = [];
  const supersessionViolations = [];
  const fingerprintMismatches = [];
  const missing = missingRequiredFields(validationArtifact);

  for (const field of missing) {
    errors.push(validationError('missing_required_field', `${field} is required.`, field));
  }
  if (validationArtifact.schemaVersion !== DEPLOYMENT_VALIDATION_SCHEMA_VERSION) {
    errors.push(validationError('invalid_schema_version', 'schemaVersion must match Deployment Validation schema.', 'schemaVersion'));
  }
  if (validationArtifact.source !== DEPLOYMENT_VALIDATION_SOURCE) {
    errors.push(validationError('invalid_source', 'source must be deployment_validation_artifact.', 'source'));
  }
  if (!Object.values(DEPLOYMENT_VALIDATION_STATUSES).includes(validationArtifact.validationStatus)) {
    errors.push(validationError('invalid_validation_status', `validationStatus must be one of: ${Object.values(DEPLOYMENT_VALIDATION_STATUSES).join(', ')}`, 'validationStatus'));
  }

  for (const field of [
    'validationChecklistResults',
    'requiredTestResults',
    'outstandingIssues',
    'evidenceReferences',
    'auditHistory'
  ]) {
    if (!Array.isArray(validationArtifact[field])) errors.push(validationError('invalid_array_field', `${field} must be an array.`, field));
  }

  if (validationArtifact.productionImpact !== 'none') {
    const error = validationError('invalid_production_impact', 'productionImpact must remain none.', 'productionImpact');
    errors.push(error);
    authorityBoundaryViolations.push(error);
  }
  if (validationArtifact.decisionImpact !== 'none') {
    const error = validationError('invalid_decision_impact', 'decisionImpact must remain none.', 'decisionImpact');
    errors.push(error);
    authorityBoundaryViolations.push(error);
  }
  if (validationArtifact.executionAuthority !== 'none') {
    const error = validationError('invalid_execution_authority', 'executionAuthority must remain none.', 'executionAuthority');
    errors.push(error);
    authorityBoundaryViolations.push(error);
  }

  for (const [index, reference] of asArray(validationArtifact.evidenceReferences).entries()) {
    if (reference.productionImpact !== 'none' || reference.decisionImpact !== 'none' || reference.executionAuthority !== 'none') {
      const error = validationError('invalid_evidence_reference_authority', 'Evidence references must remain evidence-only.', `evidenceReferences.${index}`);
      errors.push(error);
      authorityBoundaryViolations.push(error);
    }
  }

  const created = Date.parse(validationArtifact.createdAt);
  const completed = Date.parse(validationArtifact.completedAt);
  const expires = Date.parse(validationArtifact.expiresAt);
  if (Number.isFinite(created) && Number.isFinite(expires) && expires < created) {
    const error = validationError('expiration_before_creation', 'expiresAt cannot be earlier than createdAt.', 'expiresAt');
    errors.push(error);
    expirationViolations.push(error);
  }
  if (Number.isFinite(completed) && Number.isFinite(expires) && expires < completed) {
    const error = validationError('expiration_before_completion', 'expiresAt cannot be earlier than completedAt.', 'expiresAt');
    errors.push(error);
    expirationViolations.push(error);
  }
  if (validationArtifact.validationStatus === DEPLOYMENT_VALIDATION_STATUSES.EXPIRED && validationArtifact.expiresAt === UNKNOWN_VALUE) {
    const error = validationError('expired_without_expiration_timestamp', 'Expired validation artifacts must preserve expiresAt.', 'expiresAt');
    errors.push(error);
    expirationViolations.push(error);
  }

  if (known(validationArtifact.supersedesValidationArtifactId) && validationArtifact.supersedesValidationArtifactId === validationArtifact.validationArtifactId) {
    const error = validationError('self_supersession', 'A deployment validation artifact cannot supersede itself.', 'supersedesValidationArtifactId');
    errors.push(error);
    supersessionViolations.push(error);
  }
  if (known(validationArtifact.supersededByValidationArtifactId) && validationArtifact.supersededByValidationArtifactId === validationArtifact.validationArtifactId) {
    const error = validationError('self_supersession', 'A deployment validation artifact cannot be superseded by itself.', 'supersededByValidationArtifactId');
    errors.push(error);
    supersessionViolations.push(error);
  }
  if (known(validationArtifact.supersedesValidationArtifactId) && known(validationArtifact.supersededByValidationArtifactId) &&
    validationArtifact.supersedesValidationArtifactId === validationArtifact.supersededByValidationArtifactId) {
    const error = validationError('invalid_supersession_chain', 'A deployment validation artifact cannot supersede and be superseded by the same artifact.', 'supersession');
    errors.push(error);
    supersessionViolations.push(error);
  }
  if (validationArtifact.validationStatus === DEPLOYMENT_VALIDATION_STATUSES.SUPERSEDED && !known(validationArtifact.supersededByValidationArtifactId)) {
    const error = validationError('superseded_without_successor', 'Superseded validation artifacts must preserve supersededByValidationArtifactId.', 'supersededByValidationArtifactId');
    errors.push(error);
    supersessionViolations.push(error);
  }

  for (const error of validateLifecycleTransitions(validationArtifact)) errors.push(error);

  if (options.proposal || options.approvalArtifact || options.approval) {
    const binding = verifyProposalApprovalBinding(
      validationArtifact,
      options.proposal,
      firstDefined(options.approvalArtifact, options.approval),
      options
    );
    if (!binding.valid) {
      errors.push(...binding.errors);
      bindingViolations.push(...binding.errors);
    }
    warnings.push(...binding.warnings);
  }

  if (validationArtifact.validationFingerprint && buildDeploymentValidationFingerprint(validationArtifact) !== validationArtifact.validationFingerprint) {
    const error = validationError('validation_fingerprint_mismatch', 'validationFingerprint does not match validation artifact contents.', 'validationFingerprint');
    errors.push(error);
    fingerprintMismatches.push(error);
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
    bindingViolations,
    authorityBoundaryViolations,
    expirationViolations,
    supersessionViolations,
    fingerprintMismatches
  };
}

function supersedeDeploymentValidationArtifact(validationArtifact = {}, supersession = {}, options = {}) {
  const supersededByValidationArtifactId = normalizeString(firstDefined(
    supersession.supersededByValidationArtifactId,
    supersession.validationArtifactId,
    options.supersededByValidationArtifactId
  ));
  const priorStatus = validationArtifact.validationStatus || DEPLOYMENT_VALIDATION_STATUSES.PASSED;
  const next = {
    ...clone(validationArtifact),
    supersededByValidationArtifactId,
    validationStatus: DEPLOYMENT_VALIDATION_STATUSES.SUPERSEDED,
    auditHistory: appendAuditEvent(validationArtifact, {
      eventType: 'deployment_validation_superseded',
      actor: firstDefined(options.actor, supersession.actor, UNKNOWN_VALUE),
      eventAt: firstDefined(options.supersededAt, supersession.supersededAt, UNKNOWN_VALUE),
      priorStatus,
      nextStatus: DEPLOYMENT_VALIDATION_STATUSES.SUPERSEDED,
      reason: firstDefined(supersession.reason, 'superseded_by_newer_validation_artifact'),
      details: { supersededByValidationArtifactId }
    })
  };
  return rebuildValidationArtifactWithFingerprint(next);
}

function expireDeploymentValidationArtifact(validationArtifact = {}, expiration = {}, options = {}) {
  const expiresAt = normalizeDate(firstDefined(expiration.expiresAt, options.expiresAt, validationArtifact.expiresAt, UNKNOWN_VALUE));
  const priorStatus = validationArtifact.validationStatus || DEPLOYMENT_VALIDATION_STATUSES.PASSED;
  const next = {
    ...clone(validationArtifact),
    expiresAt,
    validationStatus: DEPLOYMENT_VALIDATION_STATUSES.EXPIRED,
    auditHistory: appendAuditEvent(validationArtifact, {
      eventType: 'deployment_validation_expired',
      actor: firstDefined(options.actor, expiration.actor, UNKNOWN_VALUE),
      eventAt: firstDefined(options.expiredAt, expiration.expiredAt, expiresAt),
      priorStatus,
      nextStatus: DEPLOYMENT_VALIDATION_STATUSES.EXPIRED,
      reason: firstDefined(expiration.reason, 'validation_artifact_expired'),
      details: { expiresAt }
    })
  };
  return rebuildValidationArtifactWithFingerprint(next);
}

function summarizeDeploymentValidationArtifact(validationArtifact = {}, options = {}) {
  const validation = validateDeploymentValidationArtifact(validationArtifact, options);
  return deepFreeze({
    validationArtifactId: normalizeString(validationArtifact.validationArtifactId),
    proposalId: normalizeString(validationArtifact.proposalId),
    approvalId: normalizeString(validationArtifact.approvalId),
    validationStatus: normalizeString(validationArtifact.validationStatus),
    completedAt: normalizeString(validationArtifact.completedAt),
    deploymentPrerequisitesSatisfied: validationArtifact.deploymentPrerequisitesSatisfied === true,
    checklistResultCount: asArray(validationArtifact.validationChecklistResults).length,
    requiredTestResultCount: asArray(validationArtifact.requiredTestResults).length,
    outstandingIssueCount: asArray(validationArtifact.outstandingIssues).length,
    currentValidationEvidence: ![
      DEPLOYMENT_VALIDATION_STATUSES.EXPIRED,
      DEPLOYMENT_VALIDATION_STATUSES.SUPERSEDED,
      DEPLOYMENT_VALIDATION_STATUSES.ARCHIVED
    ].includes(validationArtifact.validationStatus),
    valid: validation.valid,
    reasonCodes: validation.reasonCodes,
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none',
    validationFingerprint: normalizeString(validationArtifact.validationFingerprint)
  });
}

function exportDeploymentValidationArtifact(validationArtifact = {}, outputPath = null) {
  const serialized = `${JSON.stringify(validationArtifact, null, 2)}\n`;
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, serialized);
  }
  return serialized;
}

function importDeploymentValidationArtifact(input) {
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
  DEPLOYMENT_VALIDATION_SCHEMA_VERSION,
  DEPLOYMENT_VALIDATION_SOURCE,
  DEPLOYMENT_VALIDATION_STATUSES,
  REQUIRED_VALIDATION_FIELDS,
  UNKNOWN_VALUE,
  buildDeploymentValidationBatchFingerprint,
  buildDeploymentValidationFingerprint,
  cloneDeploymentValidationArtifact,
  createDeploymentValidationArtifact,
  determineDeploymentValidationStatus,
  expireDeploymentValidationArtifact,
  exportDeploymentValidationArtifact,
  importDeploymentValidationArtifact,
  summarizeDeploymentValidationArtifact,
  supersedeDeploymentValidationArtifact,
  validateDeploymentValidationArtifact,
  verifyProposalApprovalBinding
};
