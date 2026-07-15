'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  createEmptySoldEvidenceStore
} = require('../utils/soldEvidenceStore');
const {
  createEmptyCertificationArtifactRegistry
} = require('../validation/certificationArtifactRegistry');
const {
  REPLAY_CLASSIFICATION
} = require('../validation/ingestionRunReplaySummary');
const {
  NEXT_ACTION,
  WORKFLOW_STATE,
  WRITE_ELIGIBILITY,
  buildWorkflowFingerprint,
  runManualVerifiedAcquisitionWorkflow
} = require('../validation/manualVerifiedAcquisitionWorkflow');
const {
  createManualAcquisitionAdapter
} = require('../marketplaces/manualAcquisitionAdapter');
const {
  adapterMetadata,
  certificationRegistry,
  identity,
  soldRecord,
  sourcePermission
} = require('./helpers/phase8CanonicalFixtures');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cardhawk-manual-workflow-'));
}

function workflowOptions(overrides = {}) {
  const directory = tempDir();
  return {
    workflowId: 'manual_workflow_001',
    runId: 'manual_workflow_001_run',
    batchId: 'manual_batch_001',
    createdAt: '2026-07-15T00:00:00.000Z',
    outputDir: directory,
    batches: [
      {
        batchId: 'manual_batch_001',
        records: [soldRecord()]
      }
    ],
    request: {
      requestId: 'manual_workflow_001_request',
      query: 'anthony hernandez',
      identity
    },
    sourcePermission: sourcePermission(),
    certificationRegistry: certificationRegistry(),
    operatorApproval: {
      approved: true,
      reviewedBy: 'operator-a',
      reviewedAt: '2026-07-15T00:01:00.000Z'
    },
    store: createEmptySoldEvidenceStore(),
    ...overrides
  };
}

test('manual verified acquisition workflow approves a clean offline dry-run without writing store evidence', async () => {
  const store = createEmptySoldEvidenceStore();
  const result = await runManualVerifiedAcquisitionWorkflow(workflowOptions({ store }));

  assert.equal(result.workflowId, 'manual_workflow_001');
  assert.equal(result.batchId, 'manual_batch_001');
  assert.equal(result.workflowState, WORKFLOW_STATE.APPROVED_FOR_MANUAL_WRITE);
  assert.equal(result.writeEligibility, WRITE_ELIGIBILITY.ELIGIBLE);
  assert.equal(result.writeEligible, true);
  assert.equal(result.productionStoreWritePerformed, false);
  assert.equal(store.stats.recordCount, 0);
  assert.equal(result.inputRecordCount, 1);
  assert.equal(result.validRecordCount, 1);
  assert.equal(result.invalidRecordCount, 0);
  assert.equal(result.duplicateCount, 0);
  assert.equal(result.admittedCount, 1);
  assert.equal(result.quarantinedCount, 0);
  assert.equal(result.certificationRegistryEntry.resolved, true);
  assert.equal(result.permissionStatus, 'approved');
  assert.equal(result.safetyGateResult.passed, true);
  assert.equal(result.safetyGateResult.storeWritesEnabled, false);
  assert.equal(result.ingestionRunRecord.runId, 'manual_workflow_001_run');
  assert.equal(result.replaySummary.replayStatus, REPLAY_CLASSIFICATION.REPLAYED);
  assert.deepEqual(result.blockingReasons, []);
  assert.equal(result.recommendedNextAction, NEXT_ACTION.READY_FOR_MANUAL_WRITE);
  assert.equal(result.workflowFingerprint, buildWorkflowFingerprint(result));
  assert.equal(fs.existsSync(result.safetyGateResult.manifestReference), true);
  assert.equal(fs.existsSync(result.safetyGateResult.quarantineReference), true);
});

test('operator approval is explicit and blocks write eligibility until present', async () => {
  const result = await runManualVerifiedAcquisitionWorkflow(workflowOptions({
    workflowId: 'manual_workflow_no_approval',
    runId: 'manual_workflow_no_approval_run',
    operatorApproval: {
      approved: false
    }
  }));

  assert.equal(result.workflowState, WORKFLOW_STATE.AWAITING_OPERATOR_APPROVAL);
  assert.equal(result.writeEligibility, WRITE_ELIGIBILITY.BLOCKED);
  assert.equal(result.writeEligible, false);
  assert.equal(result.blockingReasons.includes('operator_approval_missing'), true);
  assert.equal(result.recommendedNextAction, NEXT_ACTION.OPERATOR_APPROVAL_REQUIRED);
});

test('invalid manual evidence and unresolved quarantine block write eligibility', async () => {
  const result = await runManualVerifiedAcquisitionWorkflow(workflowOptions({
    workflowId: 'manual_workflow_invalid',
    runId: 'manual_workflow_invalid_run',
    batches: [
      {
        batchId: 'manual_invalid_batch',
        records: [
          soldRecord(),
          soldRecord({
            marketplaceSaleId: 'manual-active-001',
            sourceRecordId: 'manual-active-row-001',
            evidenceType: 'active_context',
            status: 'context_only',
            review: {
              status: 'needs_second_review'
            }
          })
        ]
      }
    ]
  }));

  assert.equal(result.workflowState, WORKFLOW_STATE.VALIDATED);
  assert.equal(result.writeEligible, false);
  assert.equal(result.invalidRecordCount, 1);
  assert.equal(result.validationResults.batch.invalidRecords, 1);
  assert.equal(result.blockingReasons.includes('manual_batch_contains_invalid_records'), true);
  assert.equal(result.blockingReasons.includes('pipeline_manual_batch_rejections'), true);
  assert.equal(result.recommendedNextAction, NEXT_ACTION.FIX_BATCH_RECORDS);
});

test('missing permission and missing certification block before manual write approval', async () => {
  const result = await runManualVerifiedAcquisitionWorkflow(workflowOptions({
    workflowId: 'manual_workflow_missing_controls',
    runId: 'manual_workflow_missing_controls_run',
    sourcePermission: {},
    certificationRegistry: createEmptyCertificationArtifactRegistry()
  }));

  assert.equal(result.writeEligibility, WRITE_ELIGIBILITY.BLOCKED);
  assert.equal(result.writeEligible, false);
  assert.equal(result.certificationRegistryEntry.resolved, false);
  assert.equal(result.blockingReasons.includes('missing_source_permission_status'), true);
  assert.equal(result.blockingReasons.includes('certification_registry_entry_not_found'), true);
  assert.equal(result.recommendedNextAction, NEXT_ACTION.DECLARE_SOURCE_PERMISSION);
});

test('duplicate manual records are detected and block write eligibility', async () => {
  const result = await runManualVerifiedAcquisitionWorkflow(workflowOptions({
    workflowId: 'manual_workflow_duplicate',
    runId: 'manual_workflow_duplicate_run',
    batches: [
      {
        batchId: 'manual_duplicate_batch',
        records: [
          soldRecord(),
          soldRecord({
            rawTitle: 'Duplicate Anthony Hernandez manual row'
          })
        ]
      }
    ]
  }));

  assert.equal(result.writeEligibility, WRITE_ELIGIBILITY.BLOCKED);
  assert.equal(result.duplicateCount, 2);
  assert.equal(result.quarantinedCount, 1);
  assert.equal(result.workflowState, WORKFLOW_STATE.QUARANTINE_REVIEW_REQUIRED);
  assert.equal(result.blockingReasons.includes('manual_batch_contains_duplicate_records'), true);
  assert.equal(result.blockingReasons.includes('unresolved_quarantine_records'), true);
  assert.equal(result.recommendedNextAction, NEXT_ACTION.REVIEW_QUARANTINE);
});

test('workflow preserves manual adapter backwards compatibility', async () => {
  const adapter = createManualAcquisitionAdapter({
    batches: [
      {
        batchId: 'compat_batch',
        records: [soldRecord()]
      }
    ]
  });
  const before = await adapter.acquireSoldEvidence({
    requestId: 'compat_request',
    query: 'anthony hernandez',
    identity
  });

  await runManualVerifiedAcquisitionWorkflow(workflowOptions({
    workflowId: 'manual_workflow_compat',
    runId: 'manual_workflow_compat_run',
    adapter,
    batches: [
      {
        batchId: 'compat_batch',
        records: [soldRecord()]
      }
    ]
  }));

  const after = await adapter.acquireSoldEvidence({
    requestId: 'compat_request',
    query: 'anthony hernandez',
    identity
  });

  assert.deepEqual(after.records, before.records);
  assert.deepEqual(after.summary, before.summary);
});
