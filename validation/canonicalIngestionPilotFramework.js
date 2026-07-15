'use strict';

const {
  asArray,
  asObject,
  stableStringify,
  unique
} = require('./canonicalValidationCore');
const {
  buildRegistryEntryId,
  resolveCertificationArtifact,
  validateRegistryEntry
} = require('./certificationArtifactRegistry');
const {
  CERTIFICATION_LEVELS
} = require('./marketplaceAdapterCertification');
const {
  QUALIFICATION_STATUS,
  evaluateProviderCandidate
} = require('./providerEvaluation');
const {
  validateSourcePermission
} = require('./liveIngestionSafetyGate');
const {
  REPLAY_CLASSIFICATION,
  summarizeRunRecord
} = require('./ingestionRunReplaySummary');
const {
  buildOfflineAuthorityFlags,
  clone,
  firstDefined,
  normalizeRequirement
} = require('./phase8GovernanceCore');
const {
  buildFingerprintFromProjection
} = require('./fingerprintProjection');

const SOURCE = 'controlled_canonical_ingestion_pilot_framework';
const PILOT_FRAMEWORK_VERSION = '1.0.0';

const PILOT_STATE = Object.freeze({
  DRAFT: 'draft',
  BLOCKED: 'blocked',
  READY_FOR_DRY_RUN: 'ready_for_dry_run',
  DRY_RUN_COMPLETE: 'dry_run_complete',
  QUARANTINE_REVIEW_REQUIRED: 'quarantine_review_required',
  REPLAY_VERIFIED: 'replay_verified',
  AWAITING_OPERATOR_APPROVAL: 'awaiting_operator_approval',
  APPROVED_FOR_LIMITED_WRITE: 'approved_for_limited_write',
  REJECTED: 'rejected',
  COMPLETED: 'completed',
  ROLLED_BACK: 'rolled_back'
});

const READINESS_STATUS = Object.freeze({
  BLOCKED: 'blocked',
  READY: 'ready',
  REJECTED: 'rejected',
  COMPLETE: 'complete',
  ROLLED_BACK: 'rolled_back'
});

const PILOT_MODE = Object.freeze({
  DRY_RUN_ONLY: 'dry_run_only',
  LIMITED_WRITE_CONSIDERATION: 'limited_write_consideration'
});

const RECOMMENDED_ACTION = Object.freeze({
  COMPLETE_DRAFT: 'complete_pilot_draft',
  RESOLVE_PROVIDER_QUALIFICATION: 'resolve_provider_qualification',
  RESOLVE_PERMISSION: 'resolve_source_permission',
  RESOLVE_CERTIFICATION: 'resolve_adapter_certification',
  RESOLVE_REGISTRY: 'resolve_certification_registry_entry',
  CONFIGURE_SAFETY_GATE: 'configure_safety_gate',
  SET_BATCH_LIMIT: 'set_batch_limit',
  COMPLETE_BACKUP_PLAN: 'complete_backup_plan',
  COMPLETE_ROLLBACK_PLAN: 'complete_rollback_plan',
  COMPLETE_REPLAY_PLAN: 'complete_replay_plan',
  OPERATOR_APPROVAL_REQUIRED: 'operator_approval_required',
  READY_FOR_DRY_RUN: 'ready_for_dry_run',
  REVIEW_QUARANTINE: 'review_quarantine',
  REVIEW_REPLAY: 'review_replay',
  READY_FOR_LIMITED_WRITE_REVIEW: 'ready_for_limited_write_review',
  REJECTED: 'rejected',
  CLOSE_COMPLETED_PILOT: 'close_completed_pilot',
  REVIEW_ROLLBACK: 'review_rollback'
});

const BLOCKING_REASON = Object.freeze({
  MISSING_PROVIDER_EVALUATION: 'missing_provider_evaluation',
  PROVIDER_NOT_QUALIFIED: 'provider_not_qualified_for_offline_testing',
  COMMERCIAL_USE_PERMISSION_MISSING: 'commercial_use_permission_missing',
  SOURCE_PERMISSION_NOT_APPROVED: 'source_permission_not_approved',
  ADAPTER_CERTIFICATION_NOT_PRODUCTION_APPROVED: 'adapter_certification_not_production_approved',
  CERTIFICATION_REGISTRY_ENTRY_MISSING: 'certification_registry_entry_missing',
  CERTIFICATION_REGISTRY_ENTRY_INVALID: 'certification_registry_entry_invalid',
  ADAPTER_VERSION_MISMATCH: 'adapter_version_mismatch',
  SAFETY_GATE_NOT_READY: 'safety_gate_not_ready',
  BATCH_LIMIT_MISSING: 'batch_limit_missing',
  DRY_RUN_REQUIREMENT_MISSING: 'dry_run_requirement_missing',
  QUARANTINE_REVIEW_REQUIREMENT_MISSING: 'quarantine_review_requirement_missing',
  REPLAY_PLAN_MISSING: 'replay_plan_missing',
  BACKUP_PLAN_MISSING: 'backup_plan_missing',
  ROLLBACK_PLAN_MISSING: 'rollback_plan_missing',
  OPERATOR_APPROVAL_REQUIREMENT_MISSING: 'operator_approval_requirement_missing',
  DATASET_SCOPE_MISSING: 'dataset_target_scope_missing',
  OPERATOR_APPROVAL_MISSING: 'operator_approval_missing',
  PILOT_REJECTED: 'pilot_rejected'
});

const RESULT_DISPOSITION = Object.freeze({
  PASSED: 'passed',
  PASSED_WITH_REVIEW: 'passed_with_review',
  BLOCKED: 'blocked',
  REJECTED: 'rejected',
  ROLLBACK_REQUIRED: 'rollback_required',
  COMPLETED: 'completed'
});

function adapterMetadataFromInput(input = {}) {
  const adapter = asObject(input.adapter || input.adapterMetadata || input.projectedAdapterMetadata);
  return {
    sourceId: firstDefined(input.sourceId, adapter.sourceId, null),
    marketplace: firstDefined(input.marketplace, adapter.marketplace, null),
    adapterName: firstDefined(input.adapterName, adapter.adapterName, null),
    adapterVersion: firstDefined(input.adapterVersion, adapter.adapterVersion, null),
    interfaceVersion: firstDefined(input.interfaceVersion, adapter.interfaceVersion, null)
  };
}

function normalizeProviderEvaluation(input = {}, options = {}) {
  const provided = asObject(input.providerEvaluation);
  if (provided.qualificationStatus) return clone(provided);
  if (input.provider) {
    return evaluateProviderCandidate(input.provider, {
      evaluationDate: options.evaluationDate,
      evaluator: options.evaluator
    });
  }
  return {};
}

function providerQualified(providerEvaluation = {}) {
  return [
    QUALIFICATION_STATUS.APPROVED_FOR_OFFLINE_TESTING,
    QUALIFICATION_STATUS.QUALIFIED_FOR_ADAPTER_DEVELOPMENT
  ].includes(providerEvaluation.qualificationStatus);
}

function commercialUsePermitted(sourcePermissionValidation = {}, providerEvaluation = {}) {
  return sourcePermissionValidation.license?.commercialUsePermitted === true
    || providerEvaluation.permissionStatus === 'approved'
    || providerEvaluation.supportedCapabilities?.includes('commercial_use_documented');
}

function backupSatisfied(requirement = {}) {
  const input = asObject(requirement.details);
  return requirement.required === true && (
    requirement.satisfied === true
    || Boolean(input.backupPath || input.snapshotPath || input.restorePoint || input.description)
  );
}

function rollbackSatisfied(requirement = {}) {
  const input = asObject(requirement.details);
  return requirement.required === true && (
    requirement.satisfied === true
    || asArray(input.steps).length > 0
    || Boolean(input.rollbackProcedure || input.description)
  );
}

function replaySatisfied(requirement = {}) {
  const input = asObject(requirement.details);
  return requirement.required === true && (
    requirement.satisfied === true
    || Boolean(input.replayRequired === true || input.description || input.runRepositoryPath)
  );
}

function operatorRequirementSatisfied(requirement = {}) {
  const input = asObject(requirement.details);
  return requirement.required === true && (
    requirement.satisfied === true
    || Boolean(input.approvalRequired === true || asArray(input.requiredApprovers || input.approvers).length > 0)
  );
}

function normalizeDatasetTargetScope(scope = {}) {
  const input = asObject(scope);
  const identityScope = asArray(input.identityScope || input.identities || input.canonicalIdentityKeys);
  return {
    identityScope,
    expectedRecordScope: {
      minRecords: Number(input.expectedRecordScope?.minRecords || input.minRecords || 0),
      maxRecords: Number(input.expectedRecordScope?.maxRecords || input.maxRecords || 0),
      targetRecords: Number(input.expectedRecordScope?.targetRecords || input.targetRecords || 0)
    },
    notes: input.notes || null
  };
}

function resolveCertification(input = {}, adapterMetadata = {}, options = {}) {
  if (input.certificationRegistryEntry) {
    const validation = validateRegistryEntry(input.certificationRegistryEntry, {
      adapterMetadata,
      now: options.now || input.evaluationDate
    });
    return {
      resolved: validation.valid,
      entry: validation.entry,
      artifact: validation.artifact,
      reasons: validation.reasons,
      validation
    };
  }

  if (input.certificationRegistry || input.certificationRegistryPath) {
    return resolveCertificationArtifact({
      registry: input.certificationRegistry,
      registryPath: input.certificationRegistryPath,
      adapterMetadata
    }, {
      now: options.now || input.evaluationDate
    });
  }

  return {
    resolved: false,
    entry: null,
    artifact: null,
    reasons: ['certification_registry_entry_not_found'],
    validation: null
  };
}

function certificationProductionApproved(resolution = {}) {
  const artifact = asObject(resolution.artifact);
  const entry = asObject(resolution.entry);
  return resolution.resolved === true
    && artifact.certificationLevel === CERTIFICATION_LEVELS.PRODUCTION_APPROVED
    && artifact.productionApproved === true
    && entry.approvalStatus === 'production_approved';
}

function adapterMatchesRegistry(adapter = {}, entry = {}) {
  if (!entry) return false;
  return ['sourceId', 'adapterName', 'adapterVersion'].every((field) => (
    adapter[field] && entry[field] === adapter[field]
  ));
}

function safetyGateReady(configuration = {}) {
  const input = asObject(configuration);
  return input.ready === true
    && input.dryRun !== false
    && input.allowStoreWrite !== true
    && input.storeWritesEnabled !== true;
}

function collectPlanBlockingReasons(context = {}) {
  const reasons = [];
  const {
    input,
    providerEvaluation,
    sourcePermission,
    certification,
    adapter,
    safetyGateConfiguration,
    batchSizeLimit,
    dryRunRequirement,
    quarantineReviewRequirement,
    replayRequirement,
    backupRequirement,
    rollbackRequirement,
    operatorApprovalRequirement,
    datasetTargetScope
  } = context;

  if (!Object.keys(providerEvaluation).length) reasons.push(BLOCKING_REASON.MISSING_PROVIDER_EVALUATION);
  if (Object.keys(providerEvaluation).length && !providerQualified(providerEvaluation)) reasons.push(BLOCKING_REASON.PROVIDER_NOT_QUALIFIED);
  if (!commercialUsePermitted(sourcePermission, providerEvaluation)) reasons.push(BLOCKING_REASON.COMMERCIAL_USE_PERMISSION_MISSING);
  if (sourcePermission.valid !== true) reasons.push(BLOCKING_REASON.SOURCE_PERMISSION_NOT_APPROVED);
  if (!certificationProductionApproved(certification)) reasons.push(BLOCKING_REASON.ADAPTER_CERTIFICATION_NOT_PRODUCTION_APPROVED);
  if (!certification.entry) reasons.push(BLOCKING_REASON.CERTIFICATION_REGISTRY_ENTRY_MISSING);
  if (certification.entry && certification.resolved !== true) reasons.push(BLOCKING_REASON.CERTIFICATION_REGISTRY_ENTRY_INVALID);
  if (certification.entry && !adapterMatchesRegistry(adapter, certification.entry)) reasons.push(BLOCKING_REASON.ADAPTER_VERSION_MISMATCH);
  if (!safetyGateReady(safetyGateConfiguration)) reasons.push(BLOCKING_REASON.SAFETY_GATE_NOT_READY);
  if (!Number.isFinite(Number(batchSizeLimit)) || Number(batchSizeLimit) <= 0) reasons.push(BLOCKING_REASON.BATCH_LIMIT_MISSING);
  if (dryRunRequirement.required !== true || dryRunRequirement.satisfied !== true) reasons.push(BLOCKING_REASON.DRY_RUN_REQUIREMENT_MISSING);
  if (quarantineReviewRequirement.required !== true || quarantineReviewRequirement.satisfied !== true) reasons.push(BLOCKING_REASON.QUARANTINE_REVIEW_REQUIREMENT_MISSING);
  if (!replaySatisfied(replayRequirement)) reasons.push(BLOCKING_REASON.REPLAY_PLAN_MISSING);
  if (!backupSatisfied(backupRequirement)) reasons.push(BLOCKING_REASON.BACKUP_PLAN_MISSING);
  if (!rollbackSatisfied(rollbackRequirement)) reasons.push(BLOCKING_REASON.ROLLBACK_PLAN_MISSING);
  if (!operatorRequirementSatisfied(operatorApprovalRequirement)) reasons.push(BLOCKING_REASON.OPERATOR_APPROVAL_REQUIREMENT_MISSING);
  if (!datasetTargetScope.identityScope.length && datasetTargetScope.expectedRecordScope.maxRecords <= 0) reasons.push(BLOCKING_REASON.DATASET_SCOPE_MISSING);
  if (input.rejected === true) reasons.push(BLOCKING_REASON.PILOT_REJECTED);

  return unique(reasons);
}

function derivePlanState(input = {}, blockingReasons = []) {
  if (input.rolledBack === true) return PILOT_STATE.ROLLED_BACK;
  if (input.completed === true) return PILOT_STATE.COMPLETED;
  if (input.rejected === true) return PILOT_STATE.REJECTED;
  if (blockingReasons.length > 0) return PILOT_STATE.BLOCKED;
  if (input.dryRunComplete !== true) return PILOT_STATE.READY_FOR_DRY_RUN;
  if (input.quarantineReviewRequired === true) return PILOT_STATE.QUARANTINE_REVIEW_REQUIRED;
  if (input.replayVerified !== true) return PILOT_STATE.DRY_RUN_COMPLETE;
  if (input.operatorApproval?.approved !== true) return PILOT_STATE.AWAITING_OPERATOR_APPROVAL;
  if (input.requestLimitedWriteApproval === true) return PILOT_STATE.APPROVED_FOR_LIMITED_WRITE;
  return PILOT_STATE.REPLAY_VERIFIED;
}

function readinessFromState(state) {
  if (state === PILOT_STATE.REJECTED) return READINESS_STATUS.REJECTED;
  if (state === PILOT_STATE.COMPLETED) return READINESS_STATUS.COMPLETE;
  if (state === PILOT_STATE.ROLLED_BACK) return READINESS_STATUS.ROLLED_BACK;
  if (state === PILOT_STATE.BLOCKED) return READINESS_STATUS.BLOCKED;
  return READINESS_STATUS.READY;
}

function recommendedAction(state, blockingReasons = []) {
  if (state === PILOT_STATE.REJECTED) return RECOMMENDED_ACTION.REJECTED;
  if (state === PILOT_STATE.COMPLETED) return RECOMMENDED_ACTION.CLOSE_COMPLETED_PILOT;
  if (state === PILOT_STATE.ROLLED_BACK) return RECOMMENDED_ACTION.REVIEW_ROLLBACK;
  if (blockingReasons.includes(BLOCKING_REASON.PROVIDER_NOT_QUALIFIED) || blockingReasons.includes(BLOCKING_REASON.MISSING_PROVIDER_EVALUATION)) return RECOMMENDED_ACTION.RESOLVE_PROVIDER_QUALIFICATION;
  if (blockingReasons.includes(BLOCKING_REASON.COMMERCIAL_USE_PERMISSION_MISSING) || blockingReasons.includes(BLOCKING_REASON.SOURCE_PERMISSION_NOT_APPROVED)) return RECOMMENDED_ACTION.RESOLVE_PERMISSION;
  if (blockingReasons.includes(BLOCKING_REASON.ADAPTER_CERTIFICATION_NOT_PRODUCTION_APPROVED)) return RECOMMENDED_ACTION.RESOLVE_CERTIFICATION;
  if (blockingReasons.includes(BLOCKING_REASON.CERTIFICATION_REGISTRY_ENTRY_MISSING) || blockingReasons.includes(BLOCKING_REASON.CERTIFICATION_REGISTRY_ENTRY_INVALID)) return RECOMMENDED_ACTION.RESOLVE_REGISTRY;
  if (blockingReasons.includes(BLOCKING_REASON.SAFETY_GATE_NOT_READY)) return RECOMMENDED_ACTION.CONFIGURE_SAFETY_GATE;
  if (blockingReasons.includes(BLOCKING_REASON.BATCH_LIMIT_MISSING)) return RECOMMENDED_ACTION.SET_BATCH_LIMIT;
  if (blockingReasons.includes(BLOCKING_REASON.BACKUP_PLAN_MISSING)) return RECOMMENDED_ACTION.COMPLETE_BACKUP_PLAN;
  if (blockingReasons.includes(BLOCKING_REASON.ROLLBACK_PLAN_MISSING)) return RECOMMENDED_ACTION.COMPLETE_ROLLBACK_PLAN;
  if (blockingReasons.includes(BLOCKING_REASON.REPLAY_PLAN_MISSING)) return RECOMMENDED_ACTION.COMPLETE_REPLAY_PLAN;
  if (blockingReasons.includes(BLOCKING_REASON.OPERATOR_APPROVAL_REQUIREMENT_MISSING) || state === PILOT_STATE.AWAITING_OPERATOR_APPROVAL) return RECOMMENDED_ACTION.OPERATOR_APPROVAL_REQUIRED;
  if (state === PILOT_STATE.QUARANTINE_REVIEW_REQUIRED) return RECOMMENDED_ACTION.REVIEW_QUARANTINE;
  if (state === PILOT_STATE.DRY_RUN_COMPLETE) return RECOMMENDED_ACTION.REVIEW_REPLAY;
  if (state === PILOT_STATE.APPROVED_FOR_LIMITED_WRITE) return RECOMMENDED_ACTION.READY_FOR_LIMITED_WRITE_REVIEW;
  if (state === PILOT_STATE.READY_FOR_DRY_RUN) return RECOMMENDED_ACTION.READY_FOR_DRY_RUN;
  return RECOMMENDED_ACTION.COMPLETE_DRAFT;
}

function buildRequiredApprovals(input = {}, operatorRequirement = {}) {
  const requirement = asObject(operatorRequirement.details);
  return {
    operatorApprovalRequired: operatorRequirement.required === true,
    requiredApprovers: asArray(requirement.requiredApprovers || requirement.approvers),
    approved: input.operatorApproval?.approved === true,
    approvedBy: input.operatorApproval?.approvedBy || input.operatorApproval?.reviewedBy || null,
    approvedAt: input.operatorApproval?.approvedAt || input.operatorApproval?.reviewedAt || null
  };
}

function buildCanonicalIngestionPilotFingerprint(plan = {}) {
  return buildFingerprintFromProjection({
    source: plan.source,
    version: plan.version,
    pilotId: plan.pilotId,
    providerIdentity: plan.providerIdentity,
    sourceId: plan.sourceId,
    adapterName: plan.adapterName,
    adapterVersion: plan.adapterVersion,
    acquisitionMethod: plan.acquisitionMethod,
    certificationRegistryEntryId: plan.certificationRegistryEntryId,
    permissionStatus: plan.permissionStatus,
    pilotMode: plan.pilotMode,
    batchSizeLimit: plan.batchSizeLimit,
    identityScope: plan.identityScope,
    expectedRecordScope: plan.expectedRecordScope,
    dryRunRequirement: plan.dryRunRequirement,
    quarantineReviewRequirement: plan.quarantineReviewRequirement,
    replayRequirement: plan.replayRequirement,
    backupRequirement: plan.backupRequirement,
    operatorApprovalRequirement: plan.operatorApprovalRequirement,
    rollbackPlan: plan.rollbackPlan,
    pilotState: plan.pilotState,
    readinessStatus: plan.readinessStatus,
    blockingReasons: plan.blockingReasons,
    requiredApprovals: plan.requiredApprovals,
    recommendedNextAction: plan.recommendedNextAction,
    productionApproval: plan.productionApproval,
    automaticStoreWriteAuthority: plan.automaticStoreWriteAuthority
  });
}

function createCanonicalIngestionPilotPlan(input = {}, options = {}) {
  const adapter = adapterMetadataFromInput(input);
  const providerEvaluation = normalizeProviderEvaluation(input, options);
  const sourcePermissionValidation = validateSourcePermission(input.sourcePermission);
  const certification = resolveCertification(input, adapter, options);
  const acquisitionMethodInput = asObject(input.acquisitionMethod);
  const dryRunRequirement = normalizeRequirement(input.dryRunRequirement ?? true);
  const quarantineReviewRequirement = normalizeRequirement(input.quarantineReviewRequirement ?? true);
  const replayRequirement = normalizeRequirement(input.replayRequirement ?? input.replayPlan);
  const backupRequirement = normalizeRequirement(input.backupRequirement ?? input.backupPlan);
  const rollbackRequirement = normalizeRequirement(input.rollbackRequirement ?? input.rollbackPlan);
  const operatorApprovalRequirement = normalizeRequirement(input.operatorApprovalRequirement ?? { required: true });
  const datasetTargetScope = normalizeDatasetTargetScope(input.datasetTargetScope);
  const batchSizeLimit = Number(input.batchSizeLimit || input.batchLimits?.batchSizeLimit || input.batchLimits?.maxRecords || 0);
  const safetyGateConfiguration = asObject(input.safetyGateConfiguration);
  const blockingReasons = collectPlanBlockingReasons({
    input,
    providerEvaluation,
    sourcePermission: sourcePermissionValidation,
    certification,
    adapter,
    safetyGateConfiguration,
    batchSizeLimit,
    dryRunRequirement,
    quarantineReviewRequirement,
    replayRequirement,
    backupRequirement,
    rollbackRequirement,
    operatorApprovalRequirement,
    datasetTargetScope
  });
  const pilotState = derivePlanState(input, blockingReasons);
  const readinessStatus = readinessFromState(pilotState);
  const registryEntryId = certification.entry?.id || input.certificationRegistryEntryId || buildRegistryEntryId(adapter);

  const plan = {
    source: SOURCE,
    version: PILOT_FRAMEWORK_VERSION,
    pilotId: input.pilotId || `pilot_${buildFingerprintFromProjection({
      sourceId: adapter.sourceId,
      adapterName: adapter.adapterName,
      adapterVersion: adapter.adapterVersion,
      acquisitionMethod: acquisitionMethodInput,
      requestedAt: input.requestedAt || options.requestedAt || null
    }).slice(0, 16)}`,
    providerIdentity: providerEvaluation.providerIdentity || asObject(input.providerIdentity),
    sourceId: adapter.sourceId,
    marketplace: adapter.marketplace,
    adapterName: adapter.adapterName,
    adapterVersion: adapter.adapterVersion,
    interfaceVersion: adapter.interfaceVersion,
    acquisitionMethod: {
      name: acquisitionMethodInput.name || null,
      version: acquisitionMethodInput.version || null,
      mode: acquisitionMethodInput.mode || null
    },
    certificationRegistryEntryId: registryEntryId,
    certificationArtifactFingerprint: certification.entry?.artifactFingerprint || null,
    permissionStatus: sourcePermissionValidation.status,
    pilotMode: input.pilotMode || PILOT_MODE.DRY_RUN_ONLY,
    batchSizeLimit,
    identityScope: datasetTargetScope.identityScope,
    expectedRecordScope: datasetTargetScope.expectedRecordScope,
    dryRunRequirement: {
      required: dryRunRequirement.required,
      satisfied: dryRunRequirement.satisfied
    },
    quarantineReviewRequirement: {
      required: quarantineReviewRequirement.required,
      satisfied: quarantineReviewRequirement.satisfied
    },
    replayRequirement: {
      required: replayRequirement.required,
      satisfied: replaySatisfied(replayRequirement),
      details: replayRequirement.details
    },
    backupRequirement: {
      required: backupRequirement.required,
      satisfied: backupSatisfied(backupRequirement),
      details: backupRequirement.details
    },
    operatorApprovalRequirement: {
      required: operatorApprovalRequirement.required,
      satisfied: operatorRequirementSatisfied(operatorApprovalRequirement),
      details: operatorApprovalRequirement.details
    },
    rollbackPlan: {
      required: rollbackRequirement.required,
      satisfied: rollbackSatisfied(rollbackRequirement),
      details: rollbackRequirement.details
    },
    safetyGateConfiguration: {
      ready: safetyGateReady(safetyGateConfiguration),
      dryRun: safetyGateConfiguration.dryRun !== false,
      allowStoreWrite: safetyGateConfiguration.allowStoreWrite === true || safetyGateConfiguration.storeWritesEnabled === true
    },
    providerQualificationStatus: providerEvaluation.qualificationStatus || null,
    certificationResolution: {
      resolved: certification.resolved === true,
      reasons: asArray(certification.reasons),
      registryEntryId: certification.entry?.id || null,
      artifactLevel: certification.artifact?.certificationLevel || null
    },
    pilotState,
    readinessStatus,
    blockingReasons,
    requiredApprovals: buildRequiredApprovals(input, operatorApprovalRequirement),
    recommendedNextAction: recommendedAction(pilotState, blockingReasons),
    ...buildOfflineAuthorityFlags()
  };

  plan.stableFingerprint = buildCanonicalIngestionPilotFingerprint(plan);
  return plan;
}

function getRunCounts(runRecord = {}) {
  const counts = asObject(runRecord.counts);
  return {
    totalInputRecords: Number(counts.totalInputRecords || 0),
    admittedRecordCount: Number(counts.admittedRecordCount || 0),
    rejectedRecordCount: Number(counts.rejectedRecordCount || 0),
    quarantinedRecordCount: Number(counts.quarantinedRecordCount || 0),
    duplicateCount: Number(counts.duplicateCount || 0)
  };
}

function comparePlannedActualCounts(plan = {}, runRecord = {}) {
  const actual = getRunCounts(runRecord);
  return {
    plannedMaxRecords: Number(plan.expectedRecordScope?.maxRecords || plan.batchSizeLimit || 0),
    plannedTargetRecords: Number(plan.expectedRecordScope?.targetRecords || 0),
    actualInputRecords: actual.totalInputRecords,
    withinBatchLimit: Number(plan.batchSizeLimit || 0) > 0 ? actual.totalInputRecords <= Number(plan.batchSizeLimit) : false,
    withinExpectedScope: Number(plan.expectedRecordScope?.maxRecords || 0) > 0
      ? actual.totalInputRecords <= Number(plan.expectedRecordScope.maxRecords)
      : true,
    actual
  };
}

function normalizeReplaySummary(runRecord = {}, replaySummary = {}, options = {}) {
  if (Object.keys(asObject(replaySummary)).length) return replaySummary;
  if (Object.keys(asObject(runRecord)).length) {
    return summarizeRunRecord(runRecord, options);
  }
  return {};
}

function collectResultBlockingFailures(plan = {}, resultContext = {}) {
  const failures = [];
  const counts = resultContext.countComparison || {};
  const replay = asObject(resultContext.replaySummary);
  const run = asObject(resultContext.ingestionRunRecord);

  if (plan.readinessStatus === READINESS_STATUS.BLOCKED) failures.push('pilot_plan_not_ready');
  if (counts.withinBatchLimit !== true) failures.push('actual_input_count_exceeds_batch_limit');
  if (counts.withinExpectedScope !== true) failures.push('actual_input_count_exceeds_expected_scope');
  if (run.dryRun !== true || run.storeWritesEnabled === true) failures.push('pilot_run_not_dry_run_only');
  if (replay.replayStatus && replay.replayStatus !== REPLAY_CLASSIFICATION.REPLAYED) failures.push('pilot_replay_not_verified');
  if (asArray(replay.detectedDrift).length) failures.push('pilot_replay_drift_detected');
  if (replay.manifestIntegrity?.valid === false || replay.integrity?.manifest?.valid === false) failures.push('pilot_manifest_integrity_failed');
  if (replay.quarantineIntegrity?.valid === false || replay.integrity?.quarantine?.valid === false) failures.push('pilot_quarantine_integrity_failed');
  if (Number(counts.actual?.quarantinedRecordCount || 0) > 0) failures.push('pilot_quarantine_review_required');
  if (asArray(run.canonicalReasonCodes).length) failures.push('pilot_canonical_reason_codes_present');

  return unique(failures);
}

function deriveResultDisposition(plan = {}, failures = [], rollbackRequired = false, rejected = false, completed = false) {
  if (rejected) return RESULT_DISPOSITION.REJECTED;
  if (rollbackRequired) return RESULT_DISPOSITION.ROLLBACK_REQUIRED;
  if (failures.length > 0) return RESULT_DISPOSITION.BLOCKED;
  if (completed) return RESULT_DISPOSITION.COMPLETED;
  if (plan.pilotState === PILOT_STATE.APPROVED_FOR_LIMITED_WRITE) return RESULT_DISPOSITION.PASSED_WITH_REVIEW;
  return RESULT_DISPOSITION.PASSED;
}

function buildPilotResultFingerprint(result = {}) {
  return buildFingerprintFromProjection({
    source: result.source,
    version: result.version,
    pilotId: result.pilotId,
    pilotPlanFingerprint: result.pilotPlanFingerprint,
    runId: result.runId,
    countComparison: result.countComparison,
    manifestIntegrity: result.manifestIntegrity,
    quarantineIntegrity: result.quarantineIntegrity,
    replayAgreement: result.replayAgreement,
    fingerprintAgreement: result.fingerprintAgreement,
    blockingFailures: result.blockingFailures,
    rollbackRequired: result.rollbackRequired,
    finalPilotDisposition: result.finalPilotDisposition,
    automaticStoreWriteAuthority: result.automaticStoreWriteAuthority
  });
}

function evaluateCanonicalIngestionPilotResult(planInput = {}, resultInput = {}, options = {}) {
  const plan = planInput.stableFingerprint ? planInput : createCanonicalIngestionPilotPlan(planInput, options);
  const ingestionRunRecord = asObject(resultInput.ingestionRunRecord || resultInput.runRecord);
  const replaySummary = normalizeReplaySummary(ingestionRunRecord, resultInput.replaySummary, options);
  const countComparison = comparePlannedActualCounts(plan, ingestionRunRecord);
  const manifestIntegrity = resultInput.manifestIntegrity || replaySummary.manifestIntegrity || replaySummary.integrity?.manifest || null;
  const quarantineIntegrity = resultInput.quarantineIntegrity || replaySummary.quarantineIntegrity || replaySummary.integrity?.quarantine || null;
  const replayAgreement = replaySummary.replayStatus === REPLAY_CLASSIFICATION.REPLAYED
    && asArray(replaySummary.detectedDrift).length === 0;
  const fingerprintAgreement = replaySummary.fingerprintAgreement === undefined
    ? replayAgreement
    : replaySummary.fingerprintAgreement === true;
  const rollbackRequired = resultInput.rollbackRequired === true
    || countComparison.withinBatchLimit !== true
    || replaySummary.replayStatus === REPLAY_CLASSIFICATION.REPLAYED_WITH_DRIFT
    || manifestIntegrity?.valid === false
    || quarantineIntegrity?.valid === false;
  const blockingFailures = collectResultBlockingFailures(plan, {
    countComparison,
    replaySummary,
    ingestionRunRecord
  });
  const finalPilotDisposition = deriveResultDisposition(
    plan,
    blockingFailures,
    rollbackRequired,
    resultInput.rejected === true,
    resultInput.completed === true
  );

  const result = {
    source: SOURCE,
    version: PILOT_FRAMEWORK_VERSION,
    pilotId: plan.pilotId,
    pilotPlanFingerprint: plan.stableFingerprint,
    runId: ingestionRunRecord.runId || replaySummary.runId || null,
    plannedVersusActualCounts: countComparison,
    countComparison,
    manifestIntegrity: manifestIntegrity ? clone(manifestIntegrity) : null,
    quarantineIntegrity: quarantineIntegrity ? clone(quarantineIntegrity) : null,
    replayAgreement,
    replayStatus: replaySummary.replayStatus || null,
    fingerprintAgreement,
    detectedDrift: asArray(replaySummary.detectedDrift),
    blockingFailures,
    rollbackRequired,
    finalPilotDisposition,
    ...buildOfflineAuthorityFlags()
  };

  result.stableFingerprint = buildPilotResultFingerprint(result);
  return result;
}

module.exports = {
  BLOCKING_REASON,
  PILOT_FRAMEWORK_VERSION,
  PILOT_MODE,
  PILOT_STATE,
  READINESS_STATUS,
  RECOMMENDED_ACTION,
  RESULT_DISPOSITION,
  SOURCE,
  buildCanonicalIngestionPilotFingerprint,
  buildPilotResultFingerprint,
  createCanonicalIngestionPilotPlan,
  evaluateCanonicalIngestionPilotResult,
  stableStringify
};
