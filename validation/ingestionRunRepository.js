'use strict';

const path = require('node:path');
const fs = require('node:fs');

const stateStore = require('../utils/stateStore');
const {
  asArray,
  asObject,
  createValidationResult,
  fingerprint,
  normalizeDate,
  reasonToFailureStage,
  stableStringify,
  unique
} = require('./canonicalValidationCore');
const {
  replayIngestionRunFromArtifacts
} = require('./canonicalArtifactIntegrity');

const STORE_VERSION = 1;
const RUN_RECORD_SCHEMA_VERSION = '1.0.0';
const SOURCE = 'canonical_ingestion_run_repository';
const DEFAULT_REPOSITORY_PATH = path.join(__dirname, '..', 'data', 'canonical-ingestion-runs.json');

const RUN_STATUS = Object.freeze({
  STARTED: 'started',
  INCOMPLETE: 'incomplete',
  COMPLETED: 'completed',
  PARTIAL: 'partial',
  FAILED: 'failed'
});

const OPERATOR_REVIEW_STATUS = Object.freeze({
  UNREVIEWED: 'unreviewed',
  IN_REVIEW: 'in_review',
  REVIEWED: 'reviewed'
});

const FINAL_DISPOSITION = Object.freeze({
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  REJECTED: 'rejected',
  SUPERSEDED: 'superseded',
  INVALID: 'invalid'
});

function clone(value) {
  return JSON.parse(JSON.stringify(value || null));
}

function compactReference(value = {}) {
  const input = asObject(value);
  return {
    id: input.id || input.recordId || null,
    canonicalCardKey: input.canonicalCardKey || null,
    marketplace: input.marketplace || null,
    evidenceType: input.evidenceType || null,
    fingerprint: input.fingerprint || (input.id ? fingerprint({
      id: input.id,
      canonicalCardKey: input.canonicalCardKey || null,
      marketplace: input.marketplace || null,
      evidenceType: input.evidenceType || null
    }) : null)
  };
}

function createEmptyIngestionRunRepository(overrides = {}) {
  const now = new Date().toISOString();
  return {
    source: SOURCE,
    version: STORE_VERSION,
    schemaVersion: RUN_RECORD_SCHEMA_VERSION,
    createdAt: overrides.createdAt || now,
    updatedAt: overrides.updatedAt || now,
    runs: {},
    indexes: {
      bySource: {},
      byAdapter: {},
      byStatus: {}
    },
    stats: {
      runCount: 0,
      completedCount: 0,
      partialCount: 0,
      failedCount: 0,
      incompleteCount: 0
    }
  };
}

function addIndexValue(index, key, runId) {
  if (!key || !runId) return;
  if (!index[key]) index[key] = [];
  if (!index[key].includes(runId)) index[key].push(runId);
}

function refreshRepositoryIndexes(repository = createEmptyIngestionRunRepository()) {
  repository.indexes = {
    bySource: {},
    byAdapter: {},
    byStatus: {}
  };

  for (const run of Object.values(asObject(repository.runs))) {
    addIndexValue(repository.indexes.bySource, run.sourceId, run.runId);
    addIndexValue(repository.indexes.byAdapter, `${run.sourceId || 'unknown'}:${run.adapterName || 'unknown'}:${run.adapterVersion || 'unknown'}`, run.runId);
    addIndexValue(repository.indexes.byStatus, run.runStatus, run.runId);
  }

  return repository;
}

function refreshRepositoryStats(repository = createEmptyIngestionRunRepository()) {
  const runs = Object.values(asObject(repository.runs));
  repository.stats = {
    runCount: runs.length,
    completedCount: runs.filter((run) => run.runStatus === RUN_STATUS.COMPLETED).length,
    partialCount: runs.filter((run) => run.runStatus === RUN_STATUS.PARTIAL).length,
    failedCount: runs.filter((run) => run.runStatus === RUN_STATUS.FAILED).length,
    incompleteCount: runs.filter((run) => (
      run.runStatus === RUN_STATUS.INCOMPLETE || run.runStatus === RUN_STATUS.STARTED
    )).length
  };
  return repository;
}

function normalizeIngestionRunRepository(repository = {}) {
  const normalized = {
    ...createEmptyIngestionRunRepository(),
    ...asObject(repository),
    source: repository.source || SOURCE,
    version: Number(repository.version || STORE_VERSION),
    schemaVersion: repository.schemaVersion || RUN_RECORD_SCHEMA_VERSION,
    runs: asObject(repository.runs)
  };

  refreshRepositoryIndexes(normalized);
  refreshRepositoryStats(normalized);
  return normalized;
}

function loadIngestionRunRepository(filePath = DEFAULT_REPOSITORY_PATH) {
  return normalizeIngestionRunRepository(stateStore.loadJsonState(filePath, createEmptyIngestionRunRepository()));
}

function saveIngestionRunRepository(filePath = DEFAULT_REPOSITORY_PATH, repository = createEmptyIngestionRunRepository()) {
  return stateStore.saveJsonState(filePath, normalizeIngestionRunRepository(repository));
}

function deriveRunStatus(report = {}, manifest = {}, quarantine = {}) {
  if (!Object.keys(manifest).length) return RUN_STATUS.INCOMPLETE;
  const summary = asObject(manifest.summary);
  const rejected = Number(summary.rejectedRecords || asArray(quarantine.rejectedRecords).length || 0);
  const partialFailures = Number(summary.partialFailures || asArray(manifest.partialFailures).length || 0);
  const gateReasons = [
    ...asArray(summary.gateReasons),
    ...collectReasonCodes(manifest, quarantine)
  ];

  if (report.passed === true && rejected === 0 && partialFailures === 0) return RUN_STATUS.COMPLETED;
  if (
    gateReasons.includes('certification_gate_failed')
    || gateReasons.includes('source_permission_gate_failed')
  ) {
    return RUN_STATUS.FAILED;
  }
  if (partialFailures > 0 || rejected > 0) return RUN_STATUS.PARTIAL;
  if (summary.gatePassed === false || report.passed === false) return RUN_STATUS.FAILED;
  return RUN_STATUS.COMPLETED;
}

function buildReplayMetadata(replayReport = {}) {
  const replay = asObject(replayReport);
  if (!Object.keys(replay).length) {
    return {
      replayed: false,
      replayMode: null,
      deterministic: null,
      passed: null,
      outcomeFingerprint: null,
      replayedAt: null,
      reasons: []
    };
  }

  return {
    replayed: true,
    replayMode: replay.replayMode || null,
    deterministic: replay.deterministic === true,
    passed: replay.passed === true,
    outcomeFingerprint: replay.replay?.outcomeFingerprint || null,
    replayedAt: replay.replayedAt || replay.createdAt || null,
    reasons: unique([
      ...asArray(replay.certification?.reasons),
      ...asArray(replay.manifest?.reasons),
      ...asArray(replay.quarantine?.reasons)
    ])
  };
}

function collectFailureStages(manifest = {}, quarantine = {}) {
  const stageValues = [];
  for (const record of asArray(quarantine.rejectedRecords)) {
    stageValues.push(...asArray(record.failureStages));
    for (const reason of asArray(record.reasons)) {
      stageValues.push(reasonToFailureStage(reason));
    }
  }
  for (const reason of asArray(manifest.summary?.gateReasons)) {
    stageValues.push(reasonToFailureStage(reason));
  }
  return unique(stageValues);
}

function collectReasonCodes(manifest = {}, quarantine = {}) {
  const reasons = [];
  for (const record of asArray(quarantine.rejectedRecords)) {
    reasons.push(...asArray(record.reasons));
  }
  reasons.push(...asArray(manifest.summary?.gateReasons));
  return unique(reasons);
}

function buildIngestionRunRecordFingerprint(record = {}) {
  return fingerprint({
    schemaVersion: record.schemaVersion || null,
    runId: record.runId || null,
    sourceId: record.sourceId || null,
    adapterName: record.adapterName || null,
    adapterVersion: record.adapterVersion || null,
    acquisitionMethod: record.acquisitionMethod || {},
    certificationRegistryEntryId: record.certificationRegistryEntryId || null,
    certificationArtifactFingerprint: record.certificationArtifactFingerprint || null,
    permissionStatus: record.permissionStatus || null,
    dryRun: record.dryRun === true,
    storeWritesEnabled: record.storeWritesEnabled === true,
    startedAt: record.startedAt || null,
    completedAt: record.completedAt || null,
    runStatus: record.runStatus || null,
    counts: record.counts || {},
    admittedRecordReferences: record.admittedRecordReferences || [],
    quarantineArtifactReferences: record.quarantineArtifactReferences || [],
    manifestReference: record.manifestReference || null,
    fingerprints: record.fingerprints || {},
    replayMetadata: record.replayMetadata || {},
    failureStages: record.failureStages || [],
    canonicalReasonCodes: record.canonicalReasonCodes || [],
    operatorReviewStatus: record.operatorReviewStatus || null,
    finalDisposition: record.finalDisposition || null
  });
}

function createIngestionRunRecord(input = {}, options = {}) {
  const report = asObject(input.report || input.gateReport || input);
  const manifest = asObject(input.manifest || report.manifest);
  const quarantine = asObject(input.quarantine || report.quarantine);
  const adapter = asObject(manifest.adapter || input.adapter);
  const certification = asObject(manifest.certification);
  const summary = asObject(manifest.summary);
  const artifacts = asObject(manifest.artifacts || report.artifacts);
  const replayMetadata = buildReplayMetadata(input.replayReport || options.replayReport);
  const runStatus = options.runStatus || deriveRunStatus(report, manifest, quarantine);
  const startedAt = normalizeDate(options.startedAt || input.startedAt || manifest.createdAt || report.startedAt);
  const completedAt = normalizeDate(options.completedAt || input.completedAt || manifest.createdAt || report.completedAt);
  const record = {
    schemaVersion: RUN_RECORD_SCHEMA_VERSION,
    source: SOURCE,
    version: STORE_VERSION,
    immutable: true,
    runId: options.runId || input.runId || manifest.runId || report.runId || null,
    sourceId: adapter.sourceId || null,
    marketplace: adapter.marketplace || null,
    adapterName: adapter.adapterName || null,
    adapterVersion: adapter.adapterVersion || null,
    interfaceVersion: adapter.interfaceVersion || null,
    acquisitionMethod: {
      name: manifest.acquisitionMethod?.name || null,
      version: manifest.acquisitionMethod?.version || null,
      mode: manifest.acquisitionMethod?.mode || null
    },
    certificationRegistryEntryId: certification.registry?.entryId || input.certificationRegistryEntryId || null,
    certificationArtifactFingerprint: manifest.fingerprints?.certificationArtifact || certification.fingerprint || null,
    permissionStatus: manifest.sourcePermission?.status || 'unknown',
    dryRun: manifest.dryRun !== false,
    storeWritesEnabled: manifest.storeWritesEnabled === true,
    writeMode: manifest.storeWritesEnabled === true ? 'write_enabled' : 'dry_run_or_no_write',
    startedAt,
    completedAt,
    runStatus,
    counts: {
      totalInputRecords: Number(summary.receivedRecords || 0),
      admittedRecordCount: Number(summary.admittedRecords || 0),
      rejectedRecordCount: Number(summary.rejectedRecords || 0),
      quarantinedRecordCount: asArray(quarantine.rejectedRecords).length || Number(summary.rejectedRecords || 0),
      duplicateCount: Number(summary.duplicateRecords || quarantine.summary?.duplicateRecords || 0)
    },
    admittedRecordReferences: asArray(input.admittedRecords || report.admittedRecords).map(compactReference),
    quarantineArtifactReferences: [
      artifacts.quarantinePath || input.quarantinePath || null
    ].filter(Boolean).map((artifactPath) => ({
      path: artifactPath,
      runId: manifest.runId || null
    })),
    manifestReference: artifacts.manifestPath || input.manifestPath || null,
    fingerprints: {
      request: manifest.fingerprints?.request || null,
      response: manifest.fingerprints?.response || null,
      certificationArtifact: manifest.fingerprints?.certificationArtifact || null,
      run: manifest.fingerprints?.run || null
    },
    replayMetadata,
    failureStages: collectFailureStages(manifest, quarantine),
    canonicalReasonCodes: collectReasonCodes(manifest, quarantine),
    operatorReviewStatus: options.operatorReviewStatus || OPERATOR_REVIEW_STATUS.UNREVIEWED,
    finalDisposition: options.finalDisposition || FINAL_DISPOSITION.PENDING,
    createdAt: options.createdAt || new Date().toISOString()
  };

  record.recordFingerprint = buildIngestionRunRecordFingerprint(record);
  return record;
}

function validateIngestionRunRecord(record = {}) {
  const input = asObject(record);
  const reasons = [];
  for (const field of ['runId', 'sourceId', 'adapterName', 'adapterVersion', 'runStatus']) {
    if (!input[field]) reasons.push(`missing_ingestion_run_${field}`);
  }
  if (!input.recordFingerprint) reasons.push('missing_ingestion_run_record_fingerprint');
  if (input.recordFingerprint && input.recordFingerprint !== buildIngestionRunRecordFingerprint(input)) {
    reasons.push('ingestion_run_record_fingerprint_mismatch');
  }

  return {
    ...createValidationResult({
      valid: reasons.length === 0,
      reasons,
      metadata: {
        runId: input.runId || null,
        recordFingerprint: input.recordFingerprint || null
      }
    }),
    source: SOURCE,
    version: RUN_RECORD_SCHEMA_VERSION,
    valid: reasons.length === 0,
    reasons
  };
}

function addIngestionRunRecord(repository = createEmptyIngestionRunRepository(), record = {}, options = {}) {
  const normalized = normalizeIngestionRunRepository(clone(repository));
  const runId = String(record.runId || '');

  if (normalized.runs[runId] && options.allowReplace !== true) {
    return {
      added: false,
      reason: 'ingestion_run_record_already_exists',
      validation: validateIngestionRunRecord(normalized.runs[runId]),
      repository: normalized,
      record: normalized.runs[runId]
    };
  }

  const validation = validateIngestionRunRecord(record);
  if (!validation.valid) {
    return {
      added: false,
      reason: 'invalid_ingestion_run_record',
      validation,
      repository: normalized,
      record
    };
  }

  normalized.runs[record.runId] = clone(record);
  normalized.updatedAt = options.updatedAt || new Date().toISOString();
  refreshRepositoryIndexes(normalized);
  refreshRepositoryStats(normalized);

  return {
    added: true,
    reason: null,
    validation,
    repository: normalized,
    record: normalized.runs[record.runId]
  };
}

function getIngestionRunById(repository = {}, runId) {
  const normalized = normalizeIngestionRunRepository(repository);
  const run = normalized.runs[String(runId || '')];
  return run ? clone(run) : null;
}

function listIngestionRuns(repository = {}, filters = {}) {
  const normalized = normalizeIngestionRunRepository(repository);
  let runs = Object.values(normalized.runs);

  if (filters.sourceId) runs = runs.filter((run) => run.sourceId === filters.sourceId);
  if (filters.adapterName) runs = runs.filter((run) => run.adapterName === filters.adapterName);
  if (filters.adapterVersion) runs = runs.filter((run) => run.adapterVersion === filters.adapterVersion);
  if (filters.runStatus) runs = runs.filter((run) => run.runStatus === filters.runStatus);
  if (filters.operatorReviewStatus) runs = runs.filter((run) => run.operatorReviewStatus === filters.operatorReviewStatus);
  if (filters.finalDisposition) runs = runs.filter((run) => run.finalDisposition === filters.finalDisposition);
  if (filters.dryRun !== undefined) runs = runs.filter((run) => run.dryRun === Boolean(filters.dryRun));

  runs = runs.sort((left, right) => String(right.startedAt || '').localeCompare(String(left.startedAt || '')));

  if (Number.isFinite(Number(filters.limit)) && Number(filters.limit) >= 0) {
    runs = runs.slice(0, Number(filters.limit));
  }

  return runs.map(clone);
}

function recordIngestionGateRun(repository = createEmptyIngestionRunRepository(), gateReport = {}, options = {}) {
  const record = createIngestionRunRecord({ gateReport, ...options }, options);
  return addIngestionRunRecord(repository, record, options);
}

function loadArtifactJson(value) {
  if (!value || typeof value !== 'string') return value;
  return JSON.parse(fs.readFileSync(value, 'utf8'));
}

function replayAndBuildIngestionRunRecord(input = {}, options = {}) {
  const replayReport = replayIngestionRunFromArtifacts(input, options);
  return createIngestionRunRecord({
    manifest: input.manifest || loadArtifactJson(input.manifestPath),
    quarantine: input.quarantine || loadArtifactJson(input.quarantinePath),
    replayReport
  }, options);
}

module.exports = {
  DEFAULT_REPOSITORY_PATH,
  FINAL_DISPOSITION,
  OPERATOR_REVIEW_STATUS,
  RUN_RECORD_SCHEMA_VERSION,
  RUN_STATUS,
  SOURCE,
  STORE_VERSION,
  addIngestionRunRecord,
  buildIngestionRunRecordFingerprint,
  createEmptyIngestionRunRepository,
  createIngestionRunRecord,
  getIngestionRunById,
  listIngestionRuns,
  loadIngestionRunRepository,
  normalizeIngestionRunRepository,
  recordIngestionGateRun,
  replayAndBuildIngestionRunRecord,
  saveIngestionRunRepository,
  stableStringify,
  validateIngestionRunRecord
};
