'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  CERTIFICATION_LEVELS,
  CERTIFICATION_STANDARD_VERSION,
  SOURCE: CERTIFICATION_SOURCE
} = require('../validation/marketplaceAdapterCertification');
const {
  registerCertificationArtifact,
  createEmptyCertificationArtifactRegistry
} = require('../validation/certificationArtifactRegistry');
const {
  QUALIFICATION_STATUS
} = require('../validation/providerEvaluation');
const {
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
  evaluateCanonicalIngestionPilotResult
} = require('../validation/canonicalIngestionPilotFramework');
const {
  REPLAY_CLASSIFICATION
} = require('../validation/ingestionRunReplaySummary');

const adapterMetadata = {
  sourceId: 'provider_alpha',
  marketplace: 'provider_alpha_market',
  adapterName: 'provider_alpha_partner_adapter',
  adapterVersion: '0.1.0',
  interfaceVersion: '1.0.0'
};

function productionCertification(overrides = {}) {
  return {
    source: CERTIFICATION_SOURCE,
    version: CERTIFICATION_STANDARD_VERSION,
    generatedAt: '2026-07-15T00:00:00.000Z',
    certificationLevel: CERTIFICATION_LEVELS.PRODUCTION_APPROVED,
    productionApproved: true,
    passed: true,
    dryRun: true,
    standard: {
      version: CERTIFICATION_STANDARD_VERSION
    },
    adapter: {
      ...adapterMetadata
    },
    requirements: [
      {
        name: 'production_approval_recorded',
        pass: true,
        severity: 'production'
      }
    ],
    summary: {
      level: CERTIFICATION_LEVELS.PRODUCTION_APPROVED,
      approvedForProduction: true,
      passed: true,
      failedRequirements: []
    },
    ...overrides
  };
}

function certificationRegistry() {
  return registerCertificationArtifact(
    createEmptyCertificationArtifactRegistry({ createdAt: '2026-07-15T00:00:00.000Z' }),
    productionCertification(),
    {
      registeredAt: '2026-07-15T00:01:00.000Z',
      updatedAt: '2026-07-15T00:01:00.000Z',
      now: '2026-07-15T00:02:00.000Z'
    }
  ).registry;
}

function providerEvaluation(overrides = {}) {
  return {
    source: 'canonical_provider_evaluation',
    version: '1.0.0',
    providerIdentity: {
      providerId: 'provider_alpha',
      providerName: 'Provider Alpha',
      marketplace: 'provider_alpha_market',
      sourceType: 'partner_feed',
      accessMode: 'partner_api'
    },
    providerVersion: '2026.07',
    permissionStatus: 'approved',
    licensingStatus: 'documented',
    supportedCapabilities: ['commercial_use_documented', 'transaction_level_true_sold_evidence'],
    unsupportedCapabilities: [],
    blockingIssues: [],
    qualificationStatus: QUALIFICATION_STATUS.APPROVED_FOR_OFFLINE_TESTING,
    recommendedNextAction: 'prepare_offline_test_plan',
    productionApproval: false,
    liveIngestionAuthority: false,
    marketplaceRequestAuthority: false,
    canonicalSoldEvidenceWriteAuthority: false,
    ...overrides
  };
}

function sourcePermission(overrides = {}) {
  return {
    status: 'approved',
    approvedBy: 'CardHawk Legal',
    approvedAt: '2026-07-15T00:00:00.000Z',
    license: {
      id: 'provider-alpha-license',
      commercialUsePermitted: true,
      evidenceUse: 'controlled_canonical_ingestion_pilot',
      displayAllowed: false,
      redistributionAllowed: false
    },
    ...overrides
  };
}

function readyPlanInput(overrides = {}) {
  return {
    pilotId: 'pilot_provider_alpha_001',
    providerEvaluation: providerEvaluation(),
    sourcePermission: sourcePermission(),
    certificationRegistry: certificationRegistry(),
    ...adapterMetadata,
    acquisitionMethod: {
      name: 'partner_feed_export',
      version: '2026.07',
      mode: 'offline_batch'
    },
    pilotMode: PILOT_MODE.DRY_RUN_ONLY,
    batchSizeLimit: 25,
    safetyGateConfiguration: {
      ready: true,
      dryRun: true,
      allowStoreWrite: false
    },
    dryRunRequirement: {
      required: true,
      satisfied: true
    },
    quarantineReviewRequirement: {
      required: true,
      satisfied: true
    },
    replayRequirement: {
      required: true,
      description: 'Replay must be verified from persisted run artifacts before any manual write review.'
    },
    backupRequirement: {
      required: true,
      backupPath: '/offline/backups/provider-alpha-pilot.json'
    },
    rollbackPlan: {
      required: true,
      steps: ['stop pilot', 'preserve artifacts', 'restore pre-pilot dataset snapshot']
    },
    operatorApprovalRequirement: {
      required: true,
      approvalRequired: true,
      requiredApprovers: ['canonical-ops']
    },
    datasetTargetScope: {
      identityScope: ['sports_card:anthony_hernandez:2023:panini:prizm_ufc:181:silver_prizm'],
      expectedRecordScope: {
        minRecords: 1,
        targetRecords: 10,
        maxRecords: 25
      }
    },
    ...overrides
  };
}

function runRecord(overrides = {}) {
  return {
    runId: 'pilot_provider_alpha_001_run',
    sourceId: adapterMetadata.sourceId,
    adapterName: adapterMetadata.adapterName,
    adapterVersion: adapterMetadata.adapterVersion,
    dryRun: true,
    storeWritesEnabled: false,
    counts: {
      totalInputRecords: 10,
      admittedRecordCount: 8,
      rejectedRecordCount: 2,
      quarantinedRecordCount: 0,
      duplicateCount: 0
    },
    canonicalReasonCodes: [],
    ...overrides
  };
}

function replaySummary(overrides = {}) {
  return {
    runId: 'pilot_provider_alpha_001_run',
    replayStatus: REPLAY_CLASSIFICATION.REPLAYED,
    replayable: true,
    detectedDrift: [],
    fingerprintAgreement: true,
    manifestIntegrity: {
      valid: true,
      reasons: []
    },
    quarantineIntegrity: {
      valid: true,
      reasons: []
    },
    ...overrides
  };
}

test('pilot plan assembles governed readiness from provider, permission, registry, safety, replay, backup, and rollback inputs', () => {
  const plan = createCanonicalIngestionPilotPlan(readyPlanInput(), {
    now: '2026-07-15T00:02:00.000Z'
  });

  assert.equal(plan.source, SOURCE);
  assert.equal(plan.version, PILOT_FRAMEWORK_VERSION);
  assert.equal(plan.pilotId, 'pilot_provider_alpha_001');
  assert.equal(plan.providerIdentity.providerId, 'provider_alpha');
  assert.equal(plan.sourceId, adapterMetadata.sourceId);
  assert.equal(plan.adapterName, adapterMetadata.adapterName);
  assert.equal(plan.adapterVersion, adapterMetadata.adapterVersion);
  assert.equal(plan.acquisitionMethod.name, 'partner_feed_export');
  assert.equal(plan.certificationRegistryEntryId, 'provider_alpha:provider_alpha_partner_adapter:0.1.0');
  assert.equal(plan.permissionStatus, 'approved');
  assert.equal(plan.pilotMode, PILOT_MODE.DRY_RUN_ONLY);
  assert.equal(plan.batchSizeLimit, 25);
  assert.equal(plan.identityScope.length, 1);
  assert.equal(plan.expectedRecordScope.maxRecords, 25);
  assert.equal(plan.dryRunRequirement.satisfied, true);
  assert.equal(plan.quarantineReviewRequirement.satisfied, true);
  assert.equal(plan.replayRequirement.satisfied, true);
  assert.equal(plan.backupRequirement.satisfied, true);
  assert.equal(plan.operatorApprovalRequirement.satisfied, true);
  assert.equal(plan.rollbackPlan.satisfied, true);
  assert.equal(plan.readinessStatus, READINESS_STATUS.READY);
  assert.equal(plan.pilotState, PILOT_STATE.READY_FOR_DRY_RUN);
  assert.deepEqual(plan.blockingReasons, []);
  assert.equal(plan.recommendedNextAction, RECOMMENDED_ACTION.READY_FOR_DRY_RUN);
  assert.equal(plan.productionApproval, false);
  assert.equal(plan.automaticStoreWriteAuthority, false);
  assert.equal(plan.canonicalSoldEvidenceWriteAuthority, false);
  assert.equal(plan.stableFingerprint, buildCanonicalIngestionPilotFingerprint(plan));
});

test('pilot plan remains blocked when required readiness evidence is missing', () => {
  const plan = createCanonicalIngestionPilotPlan(readyPlanInput({
    providerEvaluation: providerEvaluation({
      qualificationStatus: QUALIFICATION_STATUS.CANDIDATE,
      permissionStatus: 'pending',
      supportedCapabilities: []
    }),
    sourcePermission: sourcePermission({
      status: 'pending',
      license: {
        id: '',
        commercialUsePermitted: false
      }
    }),
    certificationRegistry: createEmptyCertificationArtifactRegistry(),
    batchSizeLimit: 0,
    safetyGateConfiguration: {
      ready: false,
      dryRun: true
    },
    replayRequirement: {
      required: true
    },
    backupRequirement: {
      required: true
    },
    rollbackPlan: {
      required: true
    },
    operatorApprovalRequirement: {
      required: true
    },
    datasetTargetScope: {}
  }));

  assert.equal(plan.pilotState, PILOT_STATE.BLOCKED);
  assert.equal(plan.readinessStatus, READINESS_STATUS.BLOCKED);
  assert.equal(plan.blockingReasons.includes(BLOCKING_REASON.PROVIDER_NOT_QUALIFIED), true);
  assert.equal(plan.blockingReasons.includes(BLOCKING_REASON.COMMERCIAL_USE_PERMISSION_MISSING), true);
  assert.equal(plan.blockingReasons.includes(BLOCKING_REASON.SOURCE_PERMISSION_NOT_APPROVED), true);
  assert.equal(plan.blockingReasons.includes(BLOCKING_REASON.ADAPTER_CERTIFICATION_NOT_PRODUCTION_APPROVED), true);
  assert.equal(plan.blockingReasons.includes(BLOCKING_REASON.CERTIFICATION_REGISTRY_ENTRY_MISSING), true);
  assert.equal(plan.blockingReasons.includes(BLOCKING_REASON.SAFETY_GATE_NOT_READY), true);
  assert.equal(plan.blockingReasons.includes(BLOCKING_REASON.BATCH_LIMIT_MISSING), true);
  assert.equal(plan.blockingReasons.includes(BLOCKING_REASON.REPLAY_PLAN_MISSING), true);
  assert.equal(plan.blockingReasons.includes(BLOCKING_REASON.BACKUP_PLAN_MISSING), true);
  assert.equal(plan.blockingReasons.includes(BLOCKING_REASON.ROLLBACK_PLAN_MISSING), true);
  assert.equal(plan.blockingReasons.includes(BLOCKING_REASON.OPERATOR_APPROVAL_REQUIREMENT_MISSING), true);
  assert.equal(plan.blockingReasons.includes(BLOCKING_REASON.DATASET_SCOPE_MISSING), true);
});

test('approved_for_limited_write is manual review only and never grants automatic write authority', () => {
  const plan = createCanonicalIngestionPilotPlan(readyPlanInput({
    pilotMode: PILOT_MODE.LIMITED_WRITE_CONSIDERATION,
    dryRunComplete: true,
    replayVerified: true,
    requestLimitedWriteApproval: true,
    operatorApproval: {
      approved: true,
      approvedBy: 'canonical-ops',
      approvedAt: '2026-07-15T01:00:00.000Z'
    }
  }));

  assert.equal(plan.pilotState, PILOT_STATE.APPROVED_FOR_LIMITED_WRITE);
  assert.equal(plan.recommendedNextAction, RECOMMENDED_ACTION.READY_FOR_LIMITED_WRITE_REVIEW);
  assert.equal(plan.requiredApprovals.approved, true);
  assert.equal(plan.productionApproval, false);
  assert.equal(plan.liveIngestionAuthority, false);
  assert.equal(plan.marketplaceRequestAuthority, false);
  assert.equal(plan.automaticStoreWriteAuthority, false);
  assert.equal(plan.canonicalSoldEvidenceWriteAuthority, false);
});

test('pilot result compares planned and actual run evidence and preserves read-only boundaries', () => {
  const plan = createCanonicalIngestionPilotPlan(readyPlanInput());
  const result = evaluateCanonicalIngestionPilotResult(plan, {
    ingestionRunRecord: runRecord(),
    replaySummary: replaySummary()
  });

  assert.equal(result.pilotId, plan.pilotId);
  assert.equal(result.pilotPlanFingerprint, plan.stableFingerprint);
  assert.equal(result.runId, 'pilot_provider_alpha_001_run');
  assert.equal(result.countComparison.actualInputRecords, 10);
  assert.equal(result.countComparison.withinBatchLimit, true);
  assert.equal(result.countComparison.actual.admittedRecordCount, 8);
  assert.equal(result.manifestIntegrity.valid, true);
  assert.equal(result.quarantineIntegrity.valid, true);
  assert.equal(result.replayAgreement, true);
  assert.equal(result.fingerprintAgreement, true);
  assert.deepEqual(result.blockingFailures, []);
  assert.equal(result.rollbackRequired, false);
  assert.equal(result.finalPilotDisposition, RESULT_DISPOSITION.PASSED);
  assert.equal(result.automaticStoreWriteAuthority, false);
  assert.equal(result.canonicalSoldEvidenceWriteAuthority, false);
  assert.equal(result.stableFingerprint, buildPilotResultFingerprint(result));
});

test('pilot result detects count overflow, quarantine, replay drift, integrity failure, and rollback need', () => {
  const plan = createCanonicalIngestionPilotPlan(readyPlanInput());
  const result = evaluateCanonicalIngestionPilotResult(plan, {
    ingestionRunRecord: runRecord({
      counts: {
        totalInputRecords: 30,
        admittedRecordCount: 20,
        rejectedRecordCount: 5,
        quarantinedRecordCount: 5,
        duplicateCount: 2
      },
      canonicalReasonCodes: ['duplicate_sold_evidence_record']
    }),
    replaySummary: replaySummary({
      replayStatus: REPLAY_CLASSIFICATION.REPLAYED_WITH_DRIFT,
      detectedDrift: ['result_count_drift'],
      fingerprintAgreement: false,
      manifestIntegrity: {
        valid: false,
        reasons: ['manifest_fingerprint_mismatch']
      }
    })
  });

  assert.equal(result.countComparison.withinBatchLimit, false);
  assert.equal(result.replayAgreement, false);
  assert.equal(result.fingerprintAgreement, false);
  assert.equal(result.rollbackRequired, true);
  assert.equal(result.finalPilotDisposition, RESULT_DISPOSITION.ROLLBACK_REQUIRED);
  assert.equal(result.blockingFailures.includes('actual_input_count_exceeds_batch_limit'), true);
  assert.equal(result.blockingFailures.includes('pilot_replay_not_verified'), true);
  assert.equal(result.blockingFailures.includes('pilot_replay_drift_detected'), true);
  assert.equal(result.blockingFailures.includes('pilot_manifest_integrity_failed'), true);
  assert.equal(result.blockingFailures.includes('pilot_quarantine_review_required'), true);
  assert.equal(result.blockingFailures.includes('pilot_canonical_reason_codes_present'), true);
});

test('pilot planning is deterministic for unchanged governed inputs', () => {
  const first = createCanonicalIngestionPilotPlan(readyPlanInput());
  const second = createCanonicalIngestionPilotPlan(readyPlanInput());

  assert.equal(first.stableFingerprint, second.stableFingerprint);
  assert.deepEqual(first.blockingReasons, second.blockingReasons);
});
