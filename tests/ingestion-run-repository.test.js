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
  CERTIFICATION_LEVELS,
  CERTIFICATION_STANDARD_VERSION,
  SOURCE: CERTIFICATION_SOURCE
} = require('../validation/marketplaceAdapterCertification');
const {
  registerCertificationArtifact,
  createEmptyCertificationArtifactRegistry
} = require('../validation/certificationArtifactRegistry');
const {
  runLiveIngestionSafetyGate
} = require('../validation/liveIngestionSafetyGate');
const {
  DEFAULT_REPOSITORY_PATH,
  FINAL_DISPOSITION,
  OPERATOR_REVIEW_STATUS,
  RUN_STATUS,
  addIngestionRunRecord,
  buildIngestionRunRecordFingerprint,
  createEmptyIngestionRunRepository,
  createIngestionRunRecord,
  getIngestionRunById,
  listIngestionRuns,
  loadIngestionRunRepository,
  recordIngestionGateRun,
  saveIngestionRunRepository,
  validateIngestionRunRecord
} = require('../validation/ingestionRunRepository');

const adapter = {
  sourceId: 'fixture_marketplace',
  marketplace: 'fixture_marketplace',
  adapterName: 'fixture_acquisition_adapter',
  adapterVersion: '1.2.3',
  interfaceVersion: '1.0.0'
};

const identity = {
  category: 'sports_card',
  sport: 'mma',
  player: 'Anthony Hernandez',
  year: '2023',
  brand: 'Panini',
  setName: 'Prizm UFC',
  cardNumber: '181',
  parallel: 'Silver Prizm',
  rookie: true,
  autograph: false,
  memorabilia: false,
  serialNumbered: false
};

function productionCertification(overrides = {}) {
  return {
    source: CERTIFICATION_SOURCE,
    version: CERTIFICATION_STANDARD_VERSION,
    generatedAt: '2026-07-11T00:00:00.000Z',
    certificationLevel: CERTIFICATION_LEVELS.PRODUCTION_APPROVED,
    productionApproved: true,
    passed: true,
    standard: {
      version: CERTIFICATION_STANDARD_VERSION
    },
    adapter: {
      ...adapter
    },
    requirements: [
      {
        name: 'production_approval_recorded',
        pass: true,
        severity: 'production'
      }
    ],
    summary: {
      source: 'marketplace_adapter_certification',
      adapterName: adapter.adapterName,
      sourceId: adapter.sourceId,
      marketplace: adapter.marketplace,
      level: CERTIFICATION_LEVELS.PRODUCTION_APPROVED,
      approvedForProduction: true,
      passed: true,
      identityPassRate: 1,
      provenancePassRate: 1,
      eligibleRecords: 1,
      rejectedRecords: 0,
      failedRequirements: [],
      unsupportedBehaviors: [],
      limitations: []
    },
    ...overrides
  };
}

function sourcePermission() {
  return {
    status: 'approved',
    approvedBy: 'CardHawk Legal',
    approvedAt: '2026-07-11T00:00:00.000Z',
    license: {
      id: 'license-001',
      commercialUsePermitted: true,
      evidenceUse: 'internal_canonical_sold_evidence',
      displayAllowed: false,
      redistributionAllowed: false
    }
  };
}

function soldRecord(overrides = {}) {
  return {
    marketplace: 'fixture_marketplace',
    marketplaceSaleId: 'sale-001',
    marketplaceListingId: 'listing-001',
    evidenceType: 'true_sold',
    status: 'active_evidence',
    rawTitle: '2023 Panini Prizm UFC Anthony Hernandez #181 Silver Prizm RC',
    soldPrice: 8.5,
    shipping: 1.5,
    soldAt: '2026-07-01T12:00:00.000Z',
    url: 'https://example.test/sold/sale-001',
    parsedIdentity: identity,
    source: {
      adapter: adapter.adapterName,
      retrievalMethod: 'fixture_certified_feed',
      sourceReliability: 'licensed_feed',
      acquiredAt: '2026-07-11T00:00:00.000Z'
    },
    ...overrides
  };
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
      requestId: 'ingestion-run-repository-test',
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

function gateOptions(overrides = {}) {
  return {
    runId: 'ingest_run_repo_001',
    createdAt: '2026-07-11T00:00:00.000Z',
    dryRun: true,
    sourcePermission: sourcePermission(),
    acquisitionMethod: {
      name: 'fixture_certified_feed',
      version: '1.0.0',
      mode: 'offline_live_ready'
    },
    ...overrides
  };
}

function certificationRegistry() {
  return registerCertificationArtifact(
    createEmptyCertificationArtifactRegistry(),
    productionCertification(),
    { registeredAt: '2026-07-12T00:00:00.000Z' }
  ).registry;
}

function gateReport(records = [soldRecord()], overrides = {}) {
  return runLiveIngestionSafetyGate({
    adapter,
    certificationRegistry: certificationRegistry(),
    acquisitionResult: acquisitionResult(records),
    store: createEmptySoldEvidenceStore()
  }, gateOptions(overrides));
}

test('empty ingestion run repository has durable indexed JSON shape', () => {
  const repository = createEmptyIngestionRunRepository({
    createdAt: '2026-07-15T00:00:00.000Z',
    updatedAt: '2026-07-15T00:00:00.000Z'
  });

  assert.equal(repository.source, 'canonical_ingestion_run_repository');
  assert.equal(repository.version, 1);
  assert.equal(repository.schemaVersion, '1.0.0');
  assert.deepEqual(repository.runs, {});
  assert.deepEqual(repository.indexes.bySource, {});
  assert.equal(repository.stats.runCount, 0);
  assert.equal(DEFAULT_REPOSITORY_PATH.endsWith(path.join('data', 'canonical-ingestion-runs.json')), true);
});

test('creates immutable run record from live ingestion safety gate report', () => {
  const report = gateReport();
  const record = createIngestionRunRecord({
    gateReport: report,
    startedAt: '2026-07-11T00:00:00.000Z',
    completedAt: '2026-07-11T00:00:01.000Z'
  });

  assert.equal(record.runId, 'ingest_run_repo_001');
  assert.equal(record.sourceId, adapter.sourceId);
  assert.equal(record.adapterName, adapter.adapterName);
  assert.equal(record.acquisitionMethod.name, 'fixture_certified_feed');
  assert.equal(record.certificationRegistryEntryId, `${adapter.sourceId}:${adapter.adapterName}:${adapter.adapterVersion}`);
  assert.equal(record.permissionStatus, 'approved');
  assert.equal(record.dryRun, true);
  assert.equal(record.storeWritesEnabled, false);
  assert.equal(record.runStatus, RUN_STATUS.COMPLETED);
  assert.equal(record.counts.totalInputRecords, 1);
  assert.equal(record.counts.admittedRecordCount, 1);
  assert.equal(record.counts.rejectedRecordCount, 0);
  assert.equal(record.admittedRecordReferences.length, 1);
  assert.equal(record.fingerprints.request.length, 64);
  assert.equal(record.recordFingerprint, buildIngestionRunRecordFingerprint(record));
});

test('partial, failed, and incomplete runs are represented explicitly', () => {
  const partialRecord = createIngestionRunRecord({
    gateReport: gateReport([
      soldRecord(),
      soldRecord({
        rawTitle: 'Duplicate Anthony Hernandez sale'
      })
    ])
  });
  const failedRecord = createIngestionRunRecord({
    gateReport: runLiveIngestionSafetyGate({
      adapter,
      certificationRegistry: createEmptyCertificationArtifactRegistry(),
      acquisitionResult: acquisitionResult([soldRecord()])
    }, gateOptions({ runId: 'ingest_run_repo_failed' }))
  });
  const incompleteRecord = createIngestionRunRecord({
    manifest: {}
  }, {
    runId: 'ingest_run_repo_incomplete',
    runStatus: RUN_STATUS.INCOMPLETE
  });

  assert.equal(partialRecord.runStatus, RUN_STATUS.PARTIAL);
  assert.equal(partialRecord.counts.duplicateCount, 1);
  assert.equal(partialRecord.failureStages.includes('duplicate_handling'), true);
  assert.equal(partialRecord.canonicalReasonCodes.includes('duplicate_sold_evidence_record'), true);
  assert.equal(failedRecord.runStatus, RUN_STATUS.FAILED);
  assert.equal(failedRecord.canonicalReasonCodes.includes('certification_gate_failed'), true);
  assert.equal(incompleteRecord.runStatus, RUN_STATUS.INCOMPLETE);
});

test('repository preserves immutable run records and rejects duplicate run IDs', () => {
  const record = createIngestionRunRecord({ gateReport: gateReport() });
  const first = addIngestionRunRecord(createEmptyIngestionRunRepository(), record, {
    updatedAt: '2026-07-12T00:00:00.000Z'
  });
  const duplicate = addIngestionRunRecord(first.repository, {
    ...record,
    counts: {
      ...record.counts,
      admittedRecordCount: 99
    }
  });

  assert.equal(first.added, true);
  assert.equal(first.repository.stats.runCount, 1);
  assert.equal(duplicate.added, false);
  assert.equal(duplicate.reason, 'ingestion_run_record_already_exists');
  assert.equal(duplicate.repository.runs[record.runId].counts.admittedRecordCount, 1);
});

test('exact lookup and filtered listing return defensive copies', () => {
  const completed = createIngestionRunRecord({ gateReport: gateReport() });
  const partial = createIngestionRunRecord({
    gateReport: gateReport([
      soldRecord(),
      soldRecord({ rawTitle: 'Duplicate Anthony Hernandez sale' })
    ], { runId: 'ingest_run_repo_partial' })
  });
  let result = addIngestionRunRecord(createEmptyIngestionRunRepository(), completed);
  result = addIngestionRunRecord(result.repository, partial);

  const found = getIngestionRunById(result.repository, completed.runId);
  const partialRuns = listIngestionRuns(result.repository, { runStatus: RUN_STATUS.PARTIAL });
  found.counts.admittedRecordCount = 999;

  assert.equal(getIngestionRunById(result.repository, completed.runId).counts.admittedRecordCount, 1);
  assert.equal(partialRuns.length, 1);
  assert.equal(partialRuns[0].runId, 'ingest_run_repo_partial');
  assert.equal(listIngestionRuns(result.repository, { sourceId: adapter.sourceId }).length, 2);
  assert.equal(listIngestionRuns(result.repository, { dryRun: true, limit: 1 }).length, 1);
});

test('repository persists through stateStore without writing sold evidence', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cardhawk-ingestion-run-repo-'));
  const repositoryPath = path.join(tempDir, 'canonical-ingestion-runs.json');
  const record = createIngestionRunRecord({ gateReport: gateReport() }, {
    operatorReviewStatus: OPERATOR_REVIEW_STATUS.UNREVIEWED,
    finalDisposition: FINAL_DISPOSITION.PENDING
  });
  const result = addIngestionRunRecord(createEmptyIngestionRunRepository(), record);
  const saveResult = saveIngestionRunRepository(repositoryPath, result.repository);
  const loaded = loadIngestionRunRepository(repositoryPath);

  assert.equal(saveResult.ok, true);
  assert.equal(fs.existsSync(repositoryPath), true);
  assert.equal(loaded.stats.runCount, 1);
  assert.equal(getIngestionRunById(loaded, record.runId).finalDisposition, FINAL_DISPOSITION.PENDING);
});

test('record validation detects missing fields and fingerprint drift', () => {
  const record = createIngestionRunRecord({ gateReport: gateReport() });
  const valid = validateIngestionRunRecord(record);
  const drifted = {
    ...record,
    adapterVersion: '9.9.9'
  };
  const invalid = validateIngestionRunRecord({
    runId: ''
  });

  assert.equal(valid.valid, true);
  assert.equal(validateIngestionRunRecord(drifted).reasons.includes('ingestion_run_record_fingerprint_mismatch'), true);
  assert.equal(invalid.reasons.includes('missing_ingestion_run_runId'), true);
  assert.equal(invalid.reasons.includes('missing_ingestion_run_record_fingerprint'), true);
});

test('recordIngestionGateRun is an explicit repository operation, not automatic gate persistence', () => {
  const report = gateReport();
  const repository = createEmptyIngestionRunRepository();
  const result = recordIngestionGateRun(repository, report);

  assert.equal(repository.stats.runCount, 0);
  assert.equal(result.added, true);
  assert.equal(result.repository.stats.runCount, 1);
  assert.equal(report.nextStore.stats.recordCount, 0);
  assert.equal(report.dryRunStorePreview.stats.recordCount, 1);
});
