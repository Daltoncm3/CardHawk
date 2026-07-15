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
  runLiveIngestionSafetyGate
} = require('../validation/liveIngestionSafetyGate');
const {
  FINAL_DISPOSITION,
  OPERATOR_REVIEW_STATUS,
  RUN_STATUS,
  addIngestionRunRecord,
  createEmptyIngestionRunRepository,
  createIngestionRunRecord,
  loadIngestionRunRepository,
  saveIngestionRunRepository
} = require('../validation/ingestionRunRepository');
const {
  FOLLOW_UP_ACTION,
  REPLAY_CLASSIFICATION,
  buildAggregateIngestionRunSummary,
  summarizeIngestionRunById,
  summarizePersistedIngestionRun,
  summarizeRunRecord
} = require('../validation/ingestionRunReplaySummary');
const {
  identity,
  productionCertification: buildProductionCertification,
  soldRecord: buildSoldRecord,
  sourcePermission
} = require('./helpers/phase8CanonicalFixtures');

const adapter = {
  sourceId: 'fixture_marketplace',
  marketplace: 'fixture_marketplace',
  adapterName: 'fixture_acquisition_adapter',
  adapterVersion: '1.2.3',
  interfaceVersion: '1.0.0'
};

function productionCertification() {
  return buildProductionCertification({
    adapter,
    summary: {
      level: 'Production Approved',
      approvedForProduction: true,
      passed: true
    }
  });
}

function soldRecord(overrides = {}) {
  return buildSoldRecord({
    marketplace: 'fixture_marketplace',
    marketplaceSaleId: 'sale-001',
    marketplaceListingId: 'listing-001',
    source: {
      adapter: adapter.adapterName,
      retrievalMethod: 'fixture_certified_feed',
      sourceReliability: 'licensed_feed',
      acquiredAt: '2026-07-11T00:00:00.000Z'
    },
    ...overrides
  });
}

function acquisitionResult(records = [soldRecord()], overrides = {}) {
  return {
    source: {
      ...adapter,
      capabilities: {
        sourceReliability: 'licensed_feed'
      }
    },
    request: {
      requestId: 'ingestion-run-replay-summary-test',
      query: 'anthony hernandez silver prizm',
      identity
    },
    records,
    errors: [],
    warnings: [],
    summary: {
      returned: records.length,
      trueSoldCount: records.length,
      errorCount: 0,
      warningCount: 0
    },
    ...overrides
  };
}

function gateOptions(outputDir, overrides = {}) {
  return {
    runId: 'ingest_replay_summary_001',
    createdAt: '2026-07-11T00:00:00.000Z',
    dryRun: true,
    outputDir,
    sourcePermission: sourcePermission(),
    acquisitionMethod: {
      name: 'fixture_certified_feed',
      version: '1.0.0',
      mode: 'offline_live_ready'
    },
    ...overrides
  };
}

function buildReplayFixture(records = [soldRecord()], overrides = {}) {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cardhawk-ingestion-replay-'));
  const report = runLiveIngestionSafetyGate({
    adapter,
    certificationArtifact: productionCertification(),
    acquisitionResult: acquisitionResult(records),
    store: createEmptySoldEvidenceStore()
  }, gateOptions(outputDir, overrides));
  const record = createIngestionRunRecord({
    gateReport: report,
    startedAt: '2026-07-11T00:00:00.000Z',
    completedAt: '2026-07-11T00:00:01.000Z'
  }, {
    operatorReviewStatus: overrides.operatorReviewStatus || OPERATOR_REVIEW_STATUS.UNREVIEWED,
    finalDisposition: overrides.finalDisposition || FINAL_DISPOSITION.PENDING
  });

  return {
    outputDir,
    report,
    record,
    manifestPath: report.artifacts.manifestPath,
    quarantinePath: report.artifacts.quarantinePath
  };
}

function addRecords(records = []) {
  return records.reduce((repository, record) => (
    addIngestionRunRecord(repository, record).repository
  ), createEmptyIngestionRunRepository());
}

test('summarizes a replayable persisted run without mutating repository state', () => {
  const fixture = buildReplayFixture();
  const repository = addRecords([fixture.record]);
  const before = JSON.stringify(repository);
  const summary = summarizeIngestionRunById(repository, fixture.record.runId);

  assert.equal(summary.replayStatus, REPLAY_CLASSIFICATION.REPLAYED);
  assert.equal(summary.replayable, true);
  assert.equal(summary.runId, fixture.record.runId);
  assert.equal(summary.sourceId, adapter.sourceId);
  assert.equal(summary.adapterName, adapter.adapterName);
  assert.equal(summary.permissionStatus, 'approved');
  assert.equal(summary.originalRunStatus, RUN_STATUS.COMPLETED);
  assert.equal(summary.counts.totalInputRecords, 1);
  assert.equal(summary.counts.admittedRecordCount, 1);
  assert.equal(summary.integrity.manifest.valid, true);
  assert.equal(summary.integrity.quarantine.valid, true);
  assert.equal(summary.fingerprintAgreement, true);
  assert.deepEqual(summary.detectedDrift, []);
  assert.equal(summary.recommendedFollowUpAction, FOLLOW_UP_ACTION.OPERATOR_REVIEW);
  assert.match(summary.text, /Run ingest_replay_summary_001/);
  assert.equal(JSON.stringify(repository), before);
});

test('detects artifact, count, disposition, and fingerprint drift deterministically', () => {
  const fixture = buildReplayFixture();
  const manifest = JSON.parse(fs.readFileSync(fixture.manifestPath, 'utf8'));
  manifest.summary.admittedRecords = 0;
  manifest.summary.rejectedRecords = 1;
  manifest.summary.gatePassed = false;
  fs.writeFileSync(fixture.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const summary = summarizeRunRecord(fixture.record);

  assert.equal(summary.replayStatus, REPLAY_CLASSIFICATION.REPLAYED_WITH_DRIFT);
  assert.equal(summary.integrity.manifest.valid, true);
  assert.equal(summary.detectedDrift.includes('result_count_drift'), true);
  assert.equal(summary.detectedDrift.includes('run_status_drift'), true);
  assert.equal(summary.fingerprintAgreement, true);
  assert.equal(summary.recommendedFollowUpAction, FOLLOW_UP_ACTION.REVIEW_DRIFT);
});

test('classifies missing run and missing replay evidence without inventing inputs', () => {
  const fixture = buildReplayFixture();
  const repository = createEmptyIngestionRunRepository();
  const missingRun = summarizeIngestionRunById(repository, 'missing_run_001');
  const missingManifestRef = summarizeRunRecord({
    ...fixture.record,
    manifestReference: null
  });
  const missingArtifact = summarizeRunRecord({
    ...fixture.record,
    manifestReference: path.join(fixture.outputDir, 'missing-manifest.json')
  });

  assert.equal(missingRun.replayStatus, REPLAY_CLASSIFICATION.NON_REPLAYABLE_MISSING_RUN);
  assert.equal(missingManifestRef.replayStatus, REPLAY_CLASSIFICATION.NON_REPLAYABLE_MISSING_MANIFEST_REFERENCE);
  assert.equal(missingArtifact.replayStatus, REPLAY_CLASSIFICATION.NON_REPLAYABLE_MISSING_ARTIFACT);
  assert.equal(missingRun.replayable, false);
  assert.equal(missingManifestRef.recommendedFollowUpAction, FOLLOW_UP_ACTION.LOCATE_REPLAY_EVIDENCE);
  assert.deepEqual(missingRun.counts, {
    totalInputRecords: 0,
    admittedRecordCount: 0,
    rejectedRecordCount: 0,
    quarantinedRecordCount: 0,
    duplicateCount: 0
  });
});

test('loads repository from disk and replays by exact run ID', () => {
  const fixture = buildReplayFixture();
  const repositoryPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cardhawk-replay-repo-')), 'runs.json');
  const repository = addRecords([fixture.record]);

  assert.equal(saveIngestionRunRepository(repositoryPath, repository).ok, true);

  const summary = summarizePersistedIngestionRun(repositoryPath, fixture.record.runId);
  const loaded = loadIngestionRunRepository(repositoryPath);

  assert.equal(summary.runId, fixture.record.runId);
  assert.equal(summary.replayStatus, REPLAY_CLASSIFICATION.REPLAYED);
  assert.equal(Object.keys(loaded.runs).length, 1);
});

test('aggregate summaries count replayability, review backlog, quarantines, sources, and reasons', () => {
  const completed = buildReplayFixture([soldRecord()], {
    runId: 'ingest_replay_completed',
    operatorReviewStatus: OPERATOR_REVIEW_STATUS.REVIEWED,
    finalDisposition: FINAL_DISPOSITION.ACCEPTED
  });
  const partial = buildReplayFixture([
    soldRecord(),
    soldRecord({ rawTitle: 'Duplicate Anthony Hernandez sale' })
  ], {
    runId: 'ingest_replay_partial'
  });
  const missingArtifact = {
    ...completed.record,
    runId: 'ingest_replay_missing',
    manifestReference: path.join(completed.outputDir, 'missing.json'),
    operatorReviewStatus: OPERATOR_REVIEW_STATUS.UNREVIEWED,
    finalDisposition: FINAL_DISPOSITION.PENDING,
    recordFingerprint: completed.record.recordFingerprint
  };
  missingArtifact.recordFingerprint = require('../validation/ingestionRunRepository')
    .buildIngestionRunRecordFingerprint(missingArtifact);
  const repository = addRecords([
    completed.record,
    partial.record,
    missingArtifact
  ]);

  const aggregate = buildAggregateIngestionRunSummary(repository, {
    generatedAt: '2026-07-15T00:00:00.000Z'
  });

  assert.equal(aggregate.totalRuns, 3);
  assert.equal(aggregate.completedCount, 2);
  assert.equal(aggregate.partialCount, 1);
  assert.equal(aggregate.replayableCount, 2);
  assert.equal(aggregate.nonReplayableCount, 1);
  assert.equal(aggregate.fingerprintAgreementRate, 1);
  assert.equal(aggregate.operatorReviewBacklog, 2);
  assert.equal(aggregate.unresolvedOrQuarantinedRunCount, 2);
  assert.equal(aggregate.recurringFailureStages.duplicate_handling, 1);
  assert.equal(aggregate.recurringReasonCodes.duplicate_sold_evidence_record, 1);
  assert.equal(aggregate.sourceSummaries[adapter.sourceId].totalRuns, 3);
  assert.equal(aggregate.adapterSummaries[`${adapter.sourceId}:${adapter.adapterName}:${adapter.adapterVersion}`].replayableRuns, 2);
});
