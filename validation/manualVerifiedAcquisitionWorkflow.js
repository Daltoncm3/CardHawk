'use strict';

const os = require('node:os');
const path = require('node:path');

const {
  createEmptySoldEvidenceStore
} = require('../utils/soldEvidenceStore');
const {
  createManualAcquisitionAdapter
} = require('../marketplaces/manualAcquisitionAdapter');
const {
  asArray,
  asObject,
  reasonToFailureStage,
  stableStringify,
  unique
} = require('./canonicalValidationCore');
const {
  resolveCertificationArtifact
} = require('./certificationArtifactRegistry');
const {
  runLiveIngestionSafetyGate,
  validateSourcePermission
} = require('./liveIngestionSafetyGate');
const {
  createIngestionRunRecord,
  OPERATOR_REVIEW_STATUS,
  FINAL_DISPOSITION
} = require('./ingestionRunRepository');
const {
  REPLAY_CLASSIFICATION,
  summarizeRunRecord
} = require('./ingestionRunReplaySummary');
const {
  runAcquisitionToStorePipelineConformance
} = require('./acquisitionToStorePipelineConformance');
const {
  buildBatchValidationReport,
  loadBatchFile,
  validateExactIdentity,
  validateRecordForPilot
} = require('./soldEvidenceDatasetPilot');
const {
  clone
} = require('./phase8GovernanceCore');
const {
  buildFingerprintFromProjection
} = require('./fingerprintProjection');

const SOURCE = 'manual_verified_acquisition_workflow_v2';
const WORKFLOW_VERSION = '2.0.0';

const WORKFLOW_STATE = Object.freeze({
  DRAFT: 'draft',
  VALIDATED: 'validated',
  DRY_RUN_COMPLETE: 'dry_run_complete',
  QUARANTINE_REVIEW_REQUIRED: 'quarantine_review_required',
  REPLAY_VERIFIED: 'replay_verified',
  AWAITING_OPERATOR_APPROVAL: 'awaiting_operator_approval',
  APPROVED_FOR_MANUAL_WRITE: 'approved_for_manual_write',
  REJECTED: 'rejected',
  INCOMPLETE: 'incomplete'
});

const WRITE_ELIGIBILITY = Object.freeze({
  ELIGIBLE: 'eligible_for_manual_write',
  BLOCKED: 'blocked',
  NOT_REQUESTED: 'not_requested'
});

const NEXT_ACTION = Object.freeze({
  DECLARE_SOURCE_PERMISSION: 'declare_source_permission',
  FIX_BATCH_RECORDS: 'fix_batch_records',
  RESOLVE_CERTIFICATION: 'resolve_certification',
  REVIEW_QUARANTINE: 'review_quarantine',
  REVIEW_REPLAY_DRIFT: 'review_replay_drift',
  OPERATOR_APPROVAL_REQUIRED: 'operator_approval_required',
  READY_FOR_MANUAL_WRITE: 'ready_for_manual_write',
  REJECTED: 'rejected',
  COMPLETE_DRAFT: 'complete_draft'
});

function normalizeBatches(batchInputs = []) {
  return asArray(batchInputs).map((batch) => (typeof batch === 'string' ? loadBatchFile(batch) : {
    filePath: batch.filePath || null,
    metadata: asObject(batch.metadata),
    batchId: batch.batchId || 'manual_batch',
    records: asArray(batch.records)
  }));
}

function buildBatchId(batches = [], options = {}) {
  if (options.batchId) return options.batchId;
  const ids = asArray(batches).map((batch) => batch.batchId || path.basename(batch.filePath || '')).filter(Boolean);
  if (ids.length === 1) return ids[0];
  if (ids.length > 1) return `manual_batch_group_${buildFingerprintFromProjection(ids).slice(0, 12)}`;
  return 'manual_batch';
}

function buildWorkflowId(input = {}) {
  if (input.workflowId) return input.workflowId;
  return `manual_ingestion_${buildFingerprintFromProjection({
    batchId: input.batchId || null,
    sourceId: input.sourceId || null,
    adapterName: input.adapterName || null,
    adapterVersion: input.adapterVersion || null,
    requestedAt: input.requestedAt || null
  }).slice(0, 16)}`;
}

function adapterMetadata(adapter = {}) {
  return {
    sourceId: adapter.sourceId || null,
    marketplace: adapter.marketplace || null,
    adapterName: adapter.adapterName || null,
    adapterVersion: adapter.adapterVersion || null,
    interfaceVersion: adapter.interfaceVersion || null
  };
}

function countRecordValidations(records = []) {
  const validations = asArray(records).map((record, index) => {
    const canonical = validateRecordForPilot(record);
    const identity = validateExactIdentity(record);
    return {
      index,
      id: record.id || record.marketplaceSaleId || record.url || null,
      valid: canonical.valid && identity.valid,
      canonical,
      identity,
      transactionEligible: canonical.valid && !canonical.reasons.includes('not_true_sold_evidence')
    };
  });

  return {
    validations,
    validRecordCount: validations.filter((entry) => entry.valid).length,
    invalidRecordCount: validations.filter((entry) => !entry.valid).length,
    transactionEligibleCount: validations.filter((entry) => entry.transactionEligible).length
  };
}

function certificationSummary(resolution = {}) {
  return {
    resolved: resolution.resolved === true,
    entryId: resolution.entry?.id || null,
    artifactFingerprint: resolution.entry?.artifactFingerprint || resolution.fingerprint || null,
    reasons: asArray(resolution.reasons)
  };
}

function pipelineSummary(report = {}) {
  return {
    passed: report.passed === true,
    failures: asArray(report.failures),
    emittedRecords: report.summary?.emittedRecords || 0,
    eligibleRecords: report.summary?.eligibleRecords || 0,
    rejectedRecords: report.summary?.rejectedRecords || 0,
    manualRejectedRecords: report.summary?.manualRejectedRecords || 0,
    duplicateRecords: report.summary?.duplicateRecords || 0,
    stageSummary: asObject(report.pipeline?.stageSummary)
  };
}

function collectBlockingReasons(context = {}) {
  const reasons = [];
  const permission = context.permission || {};
  const certification = context.certification || {};
  const batch = context.batch || {};
  const pipeline = context.pipeline || {};
  const safetyGate = context.safetyGate || {};
  const replay = context.replay || {};
  const operator = context.operator || {};

  if (!context.hasBatches) reasons.push('missing_manual_batch_records');
  if (permission.valid !== true) reasons.push(...asArray(permission.reasons).length ? permission.reasons : ['source_permission_not_approved']);
  if (certification.resolved !== true) reasons.push(...asArray(certification.reasons).length ? certification.reasons : ['certification_registry_entry_not_resolved']);
  if (batch.invalidRecordCount > 0) reasons.push('manual_batch_contains_invalid_records');
  if (pipeline.duplicateRecords > 0 || batch.duplicateCount > 0) reasons.push('manual_batch_contains_duplicate_records');
  if (pipeline.passed === false) reasons.push(...asArray(pipeline.failures).map((failure) => `pipeline_${failure}`));
  if (safetyGate.passed !== true) reasons.push('live_ingestion_safety_gate_not_passed');
  if (safetyGate.quarantinedCount > 0) reasons.push('unresolved_quarantine_records');
  if (replay.replayStatus && replay.replayStatus !== REPLAY_CLASSIFICATION.REPLAYED) reasons.push('ingestion_run_replay_not_verified');
  if (asArray(replay.detectedDrift).length) reasons.push('ingestion_run_replay_drift_detected');
  if (operator.approved !== true) reasons.push('operator_approval_missing');
  if (operator.rejected === true) reasons.push('operator_rejected_manual_workflow');

  return unique(reasons);
}

function deriveWorkflowState(context = {}) {
  const blocking = asArray(context.blockingReasons);
  const replay = context.replay || {};
  const safetyGate = context.safetyGate || {};
  const operator = context.operator || {};

  if (!context.hasBatches || !context.permissionDeclared) return WORKFLOW_STATE.INCOMPLETE;
  if (operator.rejected === true) return WORKFLOW_STATE.REJECTED;
  if (context.batch.invalidRecordCount > 0 || context.certification.resolved !== true || context.permission.valid !== true) {
    return WORKFLOW_STATE.VALIDATED;
  }
  if (safetyGate.completed !== true) return WORKFLOW_STATE.VALIDATED;
  if (safetyGate.quarantinedCount > 0) return WORKFLOW_STATE.QUARANTINE_REVIEW_REQUIRED;
  if (replay.replayStatus && replay.replayStatus !== REPLAY_CLASSIFICATION.REPLAYED) return WORKFLOW_STATE.DRY_RUN_COMPLETE;
  if (operator.approved !== true) return WORKFLOW_STATE.AWAITING_OPERATOR_APPROVAL;
  if (blocking.length === 0) return WORKFLOW_STATE.APPROVED_FOR_MANUAL_WRITE;
  return WORKFLOW_STATE.REPLAY_VERIFIED;
}

function deriveRecommendedAction(state, blockingReasons = []) {
  if (blockingReasons.some((reason) => String(reason).includes('source_permission'))) return NEXT_ACTION.DECLARE_SOURCE_PERMISSION;
  if (blockingReasons.includes('manual_batch_contains_invalid_records')) return NEXT_ACTION.FIX_BATCH_RECORDS;
  if (blockingReasons.some((reason) => String(reason).includes('certification'))) return NEXT_ACTION.RESOLVE_CERTIFICATION;
  if (blockingReasons.includes('unresolved_quarantine_records')) return NEXT_ACTION.REVIEW_QUARANTINE;
  if (blockingReasons.some((reason) => String(reason).includes('replay'))) return NEXT_ACTION.REVIEW_REPLAY_DRIFT;
  if (state === WORKFLOW_STATE.INCOMPLETE) return NEXT_ACTION.COMPLETE_DRAFT;
  if (state === WORKFLOW_STATE.REJECTED) return NEXT_ACTION.REJECTED;
  if (blockingReasons.includes('operator_approval_missing')) return NEXT_ACTION.OPERATOR_APPROVAL_REQUIRED;
  if (state === WORKFLOW_STATE.APPROVED_FOR_MANUAL_WRITE) return NEXT_ACTION.READY_FOR_MANUAL_WRITE;
  return NEXT_ACTION.COMPLETE_DRAFT;
}

function buildWorkflowFingerprint(result = {}) {
  return buildFingerprintFromProjection({
    workflowId: result.workflowId || null,
    batchId: result.batchId || null,
    sourceIdentity: result.sourceIdentity || {},
    adapter: result.adapter || {},
    acquisitionMethod: result.acquisitionMethod || {},
    certificationRegistryEntry: result.certificationRegistryEntry || {},
    permissionStatus: result.permissionStatus || null,
    inputRecordCount: result.inputRecordCount || 0,
    validRecordCount: result.validRecordCount || 0,
    invalidRecordCount: result.invalidRecordCount || 0,
    duplicateCount: result.duplicateCount || 0,
    admittedCount: result.admittedCount || 0,
    quarantinedCount: result.quarantinedCount || 0,
    workflowState: result.workflowState || null,
    operatorReviewStatus: result.operatorReviewStatus || null,
    writeEligibility: result.writeEligibility || null,
    blockingReasons: result.blockingReasons || [],
    recommendedNextAction: result.recommendedNextAction || null,
    ingestionRunId: result.ingestionRunRecord?.runId || null,
    replayStatus: result.replaySummary?.replayStatus || null
  });
}

async function runManualVerifiedAcquisitionWorkflow(options = {}) {
  const batches = normalizeBatches(asArray(options.batchFiles).concat(asArray(options.batches)));
  const batchId = buildBatchId(batches, options);
  const now = options.createdAt || options.now || new Date().toISOString();
  const adapter = options.adapter || createManualAcquisitionAdapter({
    batches,
    sourceId: options.sourceId,
    marketplace: options.marketplace,
    adapterName: options.adapterName,
    adapterVersion: options.adapterVersion
  });
  const adapterInfo = adapterMetadata(adapter);
  const workflowId = buildWorkflowId({
    workflowId: options.workflowId,
    batchId,
    requestedAt: now,
    ...adapterInfo
  });
  const request = options.request || {
    requestId: workflowId,
    query: options.query || 'manual verified acquisition workflow',
    identity: options.identity || {}
  };
  const acquisitionMethod = {
    name: options.acquisitionMethod?.name || 'manual_verified_acquisition_workflow_v2',
    version: options.acquisitionMethod?.version || WORKFLOW_VERSION,
    mode: options.acquisitionMethod?.mode || 'offline_operator_controlled'
  };
  const sourcePermission = asObject(options.sourcePermission);
  const permissionValidation = validateSourcePermission(sourcePermission);
  const batchValidation = buildBatchValidationReport(batches);
  const recordValidation = countRecordValidations(batches.flatMap((batch) => batch.records));
  const duplicateCount = asArray(batchValidation.duplicateSourceRecords).length + asArray(batchValidation.duplicateSales).length;
  const certificationResolution = resolveCertificationArtifact({
    registry: options.certificationRegistry,
    registryPath: options.certificationRegistryPath,
    adapterMetadata: adapterInfo
  }, {
    now
  });
  const acquisitionResult = await adapter.acquireSoldEvidence(request, {
    batches,
    batchFiles: options.batchFiles
  });
  const pipelineReport = await runAcquisitionToStorePipelineConformance(adapter, {
    request,
    acquireOptions: {
      batches,
      batchFiles: options.batchFiles
    },
    storeOptions: {
      store: options.store || createEmptySoldEvidenceStore()
    }
  });
  const outputDir = options.outputDir || path.join(os.tmpdir(), 'cardhawk-manual-verified-workflow');
  const gateReport = runLiveIngestionSafetyGate({
    adapter,
    certificationRegistry: options.certificationRegistry,
    certificationRegistryPath: options.certificationRegistryPath,
    acquisitionResult,
    sourcePermission,
    store: options.store || createEmptySoldEvidenceStore()
  }, {
    runId: options.runId || `${workflowId}_dry_run`,
    createdAt: now,
    dryRun: true,
    allowStoreWrite: false,
    outputDir,
    acquisitionMethod
  });
  const ingestionRunRecord = createIngestionRunRecord({
    gateReport,
    startedAt: now,
    completedAt: now
  }, {
    operatorReviewStatus: options.operatorApproval?.approved ? OPERATOR_REVIEW_STATUS.REVIEWED : OPERATOR_REVIEW_STATUS.UNREVIEWED,
    finalDisposition: options.operatorApproval?.approved ? FINAL_DISPOSITION.ACCEPTED : FINAL_DISPOSITION.PENDING,
    createdAt: now
  });
  const replaySummary = summarizeRunRecord(ingestionRunRecord);
  const operator = {
    approved: options.operatorApproval?.approved === true,
    rejected: options.operatorApproval?.rejected === true,
    reviewedBy: options.operatorApproval?.reviewedBy || null,
    reviewedAt: options.operatorApproval?.reviewedAt || null,
    notes: options.operatorApproval?.notes || ''
  };
  const context = {
    hasBatches: batches.length > 0 && batchValidation.receivedRecords > 0,
    permissionDeclared: Object.keys(sourcePermission).length > 0,
    permission: permissionValidation,
    certification: certificationSummary(certificationResolution),
    batch: {
      invalidRecordCount: batchValidation.invalidRecords,
      duplicateCount
    },
    pipeline: pipelineSummary(pipelineReport),
    safetyGate: {
      completed: true,
      passed: gateReport.passed === true,
      quarantinedCount: asArray(gateReport.quarantine?.rejectedRecords).length
    },
    replay: replaySummary,
    operator
  };
  const blockingReasons = collectBlockingReasons(context);
  const workflowState = deriveWorkflowState({ ...context, blockingReasons });
  const writeEligibility = workflowState === WORKFLOW_STATE.APPROVED_FOR_MANUAL_WRITE && blockingReasons.length === 0
    ? WRITE_ELIGIBILITY.ELIGIBLE
    : WRITE_ELIGIBILITY.BLOCKED;
  const result = {
    source: SOURCE,
    version: WORKFLOW_VERSION,
    workflowId,
    batchId,
    generatedAt: now,
    workflowState,
    sourceIdentity: {
      sourceId: adapterInfo.sourceId,
      marketplace: adapterInfo.marketplace,
      sourcePermission: {
        status: permissionValidation.status,
        valid: permissionValidation.valid,
        reasons: permissionValidation.reasons
      }
    },
    adapter: adapterInfo,
    acquisitionMethod,
    certificationRegistryEntry: certificationSummary(certificationResolution),
    permissionStatus: permissionValidation.status,
    inputRecordCount: batchValidation.receivedRecords,
    validRecordCount: batchValidation.validRecords,
    invalidRecordCount: batchValidation.invalidRecords,
    duplicateCount,
    admittedCount: asArray(gateReport.admittedRecords).length,
    quarantinedCount: asArray(gateReport.quarantine?.rejectedRecords).length,
    validationResults: {
      batch: batchValidation,
      records: recordValidation.validations,
      pipeline: pipelineSummary(pipelineReport)
    },
    safetyGateResult: {
      runId: gateReport.runId,
      passed: gateReport.passed === true,
      dryRun: gateReport.dryRun === true,
      storeWritesEnabled: gateReport.storeWritesEnabled === true,
      manifestReference: gateReport.artifacts?.manifestPath || null,
      quarantineReference: gateReport.artifacts?.quarantinePath || null,
      reasons: asArray(gateReport.manifest?.summary?.gateReasons)
    },
    ingestionRunRecord,
    replaySummary,
    operatorReviewStatus: operator.approved ? OPERATOR_REVIEW_STATUS.REVIEWED : OPERATOR_REVIEW_STATUS.UNREVIEWED,
    operatorApproval: operator,
    writeEligibility,
    writeEligible: writeEligibility === WRITE_ELIGIBILITY.ELIGIBLE,
    blockingReasons,
    blockingStages: unique(blockingReasons.map(reasonToFailureStage)),
    recommendedNextAction: deriveRecommendedAction(workflowState, blockingReasons),
    productionStoreWritePerformed: false
  };

  result.workflowFingerprint = buildWorkflowFingerprint(result);
  return result;
}

module.exports = {
  NEXT_ACTION,
  SOURCE,
  WORKFLOW_STATE,
  WORKFLOW_VERSION,
  WRITE_ELIGIBILITY,
  buildWorkflowFingerprint,
  runManualVerifiedAcquisitionWorkflow,
  stableStringify
};
