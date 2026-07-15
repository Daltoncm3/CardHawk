'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
  asArray,
  asObject,
  reasonToFailureStage,
  stableStringify,
  unique
} = require('./canonicalValidationCore');
const {
  FINAL_DISPOSITION,
  OPERATOR_REVIEW_STATUS,
  RUN_STATUS,
  getIngestionRunById,
  listIngestionRuns,
  loadIngestionRunRepository
} = require('./ingestionRunRepository');
const {
  immutableFingerprint,
  replayIngestionRunFromArtifacts,
  validateIngestionManifestIntegrity,
  validateQuarantineArtifactIntegrity
} = require('./canonicalArtifactIntegrity');
const {
  clone
} = require('./phase8GovernanceCore');
const {
  buildFingerprintFromProjection
} = require('./fingerprintProjection');

const SOURCE = 'canonical_ingestion_run_replay_summary';
const REPLAY_SUMMARY_VERSION = '1.0.0';

const REPLAY_CLASSIFICATION = Object.freeze({
  REPLAYED: 'replayed',
  REPLAYED_WITH_DRIFT: 'replayed_with_drift',
  REPLAYED_WITH_INTEGRITY_FAILURE: 'replayed_with_integrity_failure',
  NON_REPLAYABLE_MISSING_RUN: 'non_replayable_missing_run',
  NON_REPLAYABLE_MISSING_MANIFEST_REFERENCE: 'non_replayable_missing_manifest_reference',
  NON_REPLAYABLE_MISSING_QUARANTINE_REFERENCE: 'non_replayable_missing_quarantine_reference',
  NON_REPLAYABLE_MISSING_ARTIFACT: 'non_replayable_missing_artifact',
  NON_REPLAYABLE_INVALID_ARTIFACT_JSON: 'non_replayable_invalid_artifact_json'
});

const FOLLOW_UP_ACTION = Object.freeze({
  NONE: 'none',
  REVIEW_DRIFT: 'review_detected_drift',
  REVIEW_INTEGRITY: 'review_artifact_integrity',
  LOCATE_REPLAY_EVIDENCE: 'locate_missing_replay_evidence',
  OPERATOR_REVIEW: 'operator_review_required',
  RESOLVE_QUARANTINE: 'resolve_quarantined_records'
});

function countValues(values = []) {
  return asArray(values).reduce((counts, value) => {
    if (!value) return counts;
    counts[value] = (counts[value] || 0) + 1;
    return counts;
  }, {});
}

function resolveArtifactPath(reference, options = {}) {
  if (!reference) return null;
  const value = typeof reference === 'string' ? reference : reference.path;
  if (!value) return null;
  if (path.isAbsolute(value)) return value;
  return path.resolve(options.artifactBaseDir || options.repositoryDir || process.cwd(), value);
}

function readArtifactJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function getQuarantineReference(record = {}) {
  const references = asArray(record.quarantineArtifactReferences);
  return references[0] || null;
}

function expectedCountsFromArtifacts(manifest = {}, quarantine = {}) {
  const summary = asObject(manifest.summary);
  const rejectedRecords = asArray(quarantine.rejectedRecords);
  return {
    totalInputRecords: Number(summary.receivedRecords || 0),
    admittedRecordCount: Number(summary.admittedRecords || 0),
    rejectedRecordCount: Number(summary.rejectedRecords || rejectedRecords.length || 0),
    quarantinedRecordCount: rejectedRecords.length || Number(summary.rejectedRecords || 0),
    duplicateCount: Number(summary.duplicateRecords || quarantine.summary?.duplicateRecords || 0)
  };
}

function deriveDispositionFromArtifacts(manifest = {}, quarantine = {}) {
  if (!Object.keys(asObject(manifest)).length) return RUN_STATUS.INCOMPLETE;
  const summary = asObject(manifest.summary);
  const reasons = [
    ...asArray(summary.gateReasons),
    ...asArray(quarantine.rejectedRecords).flatMap((record) => asArray(record.reasons))
  ];
  const rejectedCount = Number(summary.rejectedRecords || asArray(quarantine.rejectedRecords).length || 0);
  const partialFailures = Number(summary.partialFailures || asArray(manifest.partialFailures).length || 0);

  if (reasons.includes('certification_gate_failed') || reasons.includes('source_permission_gate_failed')) {
    return RUN_STATUS.FAILED;
  }
  if (summary.gatePassed === false && rejectedCount === 0 && partialFailures === 0) return RUN_STATUS.FAILED;
  if (rejectedCount > 0 || partialFailures > 0) return RUN_STATUS.PARTIAL;
  return RUN_STATUS.COMPLETED;
}

function compareCounts(original = {}, replayed = {}) {
  const fields = [
    'totalInputRecords',
    'admittedRecordCount',
    'rejectedRecordCount',
    'quarantinedRecordCount',
    'duplicateCount'
  ];
  return fields.reduce((result, field) => {
    const originalValue = Number(original[field] || 0);
    const replayedValue = Number(replayed[field] || 0);
    result[field] = {
      original: originalValue,
      replayed: replayedValue,
      matches: originalValue === replayedValue
    };
    return result;
  }, {});
}

function countAgreement(countComparison = {}) {
  return Object.values(countComparison).every((entry) => entry.matches === true);
}

function buildFingerprintComparison(record = {}, manifest = {}, replayReport = null) {
  const manifestFingerprint = Object.keys(asObject(manifest)).length ? immutableFingerprint(manifest) : null;
  const originalReplayFingerprint = record.replayMetadata?.outcomeFingerprint || null;
  const replayOutcomeFingerprint = replayReport?.replay?.outcomeFingerprint || null;

  return {
    request: {
      original: record.fingerprints?.request || null,
      replayed: manifest.fingerprints?.request || null,
      matches: Boolean(record.fingerprints?.request && record.fingerprints.request === manifest.fingerprints?.request)
    },
    response: {
      original: record.fingerprints?.response || null,
      replayed: manifest.fingerprints?.response || null,
      matches: Boolean(record.fingerprints?.response && record.fingerprints.response === manifest.fingerprints?.response)
    },
    run: {
      original: record.fingerprints?.run || null,
      replayed: manifest.fingerprints?.run || null,
      matches: Boolean(record.fingerprints?.run && record.fingerprints.run === manifest.fingerprints?.run)
    },
    manifestArtifact: {
      original: record.manifestReference ? manifestFingerprint : null,
      replayed: manifestFingerprint,
      matches: Boolean(manifestFingerprint)
    },
    replayOutcome: {
      original: originalReplayFingerprint,
      replayed: replayOutcomeFingerprint,
      matches: originalReplayFingerprint
        ? originalReplayFingerprint === replayOutcomeFingerprint
        : replayOutcomeFingerprint !== null
    }
  };
}

function fingerprintAgreement(fingerprintComparison = {}) {
  return Object.values(fingerprintComparison).every((entry) => entry.matches === true);
}

function collectDrift(record = {}, manifest = {}, quarantine = {}, replayReport = null, integrity = {}) {
  const drift = [];
  const replayCounts = expectedCountsFromArtifacts(manifest, quarantine);
  const counts = compareCounts(record.counts, replayCounts);
  const fingerprints = buildFingerprintComparison(record, manifest, replayReport);
  const replayDisposition = deriveDispositionFromArtifacts(manifest, quarantine);

  if (!countAgreement(counts)) drift.push('result_count_drift');
  if (record.runStatus !== replayDisposition) drift.push('run_status_drift');
  if (!fingerprintAgreement(fingerprints)) drift.push('fingerprint_drift');
  if (integrity.manifest && integrity.manifest.valid === false) drift.push('manifest_integrity_drift');
  if (integrity.quarantine && integrity.quarantine.valid === false) drift.push('quarantine_integrity_drift');
  if (replayReport && replayReport.deterministic !== true) drift.push('replay_determinism_drift');

  return unique(drift);
}

function collectFailureStages(record = {}, manifest = {}, quarantine = {}) {
  const stages = [
    ...asArray(record.failureStages),
    ...asArray(quarantine.rejectedRecords).flatMap((rejected) => asArray(rejected.failureStages)),
    ...asArray(record.canonicalReasonCodes).map(reasonToFailureStage),
    ...asArray(manifest.summary?.gateReasons).map(reasonToFailureStage)
  ];
  return unique(stages);
}

function collectReasonCodes(record = {}, manifest = {}, quarantine = {}) {
  return unique([
    ...asArray(record.canonicalReasonCodes),
    ...asArray(manifest.summary?.gateReasons),
    ...asArray(quarantine.rejectedRecords).flatMap((rejected) => asArray(rejected.reasons))
  ]);
}

function classifyReplay(replayable, drift = [], integrity = {}) {
  if (replayable !== true) return replayable;
  if (integrity.manifest?.valid === false || integrity.quarantine?.valid === false) {
    return REPLAY_CLASSIFICATION.REPLAYED_WITH_INTEGRITY_FAILURE;
  }
  return drift.length ? REPLAY_CLASSIFICATION.REPLAYED_WITH_DRIFT : REPLAY_CLASSIFICATION.REPLAYED;
}

function recommendedFollowUp(summary = {}) {
  if (summary.replayStatus !== REPLAY_CLASSIFICATION.REPLAYED) {
    if (String(summary.replayStatus).startsWith('non_replayable')) return FOLLOW_UP_ACTION.LOCATE_REPLAY_EVIDENCE;
    if (summary.detectedDrift.length) return FOLLOW_UP_ACTION.REVIEW_DRIFT;
    return FOLLOW_UP_ACTION.REVIEW_INTEGRITY;
  }
  if (summary.operatorReviewStatus !== OPERATOR_REVIEW_STATUS.REVIEWED) return FOLLOW_UP_ACTION.OPERATOR_REVIEW;
  if (summary.counts.quarantinedRecordCount > 0 || summary.finalDisposition === FINAL_DISPOSITION.PENDING) {
    return FOLLOW_UP_ACTION.RESOLVE_QUARANTINE;
  }
  return FOLLOW_UP_ACTION.NONE;
}

function buildOperationalText(summary = {}) {
  const counts = summary.counts || {};
  return [
    `Run ${summary.runId || 'unknown'} (${summary.originalRunStatus || 'unknown'} -> ${summary.replayStatus || 'unknown'})`,
    `Source ${summary.sourceId || 'unknown'} via ${summary.adapterName || 'unknown'}@${summary.adapterVersion || 'unknown'}`,
    `Certification ${summary.certificationRegistryEntryId || 'none'} fingerprint ${summary.certificationArtifactFingerprint || 'none'}`,
    `Permission ${summary.permissionStatus || 'unknown'}; disposition ${summary.finalDisposition || 'unknown'}; review ${summary.operatorReviewStatus || 'unknown'}`,
    `Counts input=${counts.totalInputRecords || 0} admitted=${counts.admittedRecordCount || 0} rejected=${counts.rejectedRecordCount || 0} quarantined=${counts.quarantinedRecordCount || 0} duplicate=${counts.duplicateCount || 0}`,
    `Integrity manifest=${summary.integrity.manifest.valid} quarantine=${summary.integrity.quarantine.valid}; fingerprints=${summary.fingerprintAgreement ? 'agree' : 'drift'}`,
    `Drift ${summary.detectedDrift.length ? summary.detectedDrift.join(', ') : 'none'}`,
    `Failure stages ${summary.failureStages.length ? summary.failureStages.join(', ') : 'none'}`,
    `Reason codes ${summary.canonicalReasonCodes.length ? summary.canonicalReasonCodes.join(', ') : 'none'}`,
    `Recommended action ${summary.recommendedFollowUpAction || FOLLOW_UP_ACTION.NONE}`
  ].join('\n');
}

function missingEvidenceSummary(runId, classification, details = {}) {
  const summary = {
    source: SOURCE,
    version: REPLAY_SUMMARY_VERSION,
    runId: runId || null,
    replayStatus: classification,
    replayable: false,
    reasons: unique(details.reasons || [classification]),
    runIdentity: details.runIdentity || null,
    sourceId: details.sourceId || null,
    adapterName: details.adapterName || null,
    adapterVersion: details.adapterVersion || null,
    certificationRegistryEntryId: details.certificationRegistryEntryId || null,
    certificationArtifactFingerprint: details.certificationArtifactFingerprint || null,
    permissionStatus: details.permissionStatus || null,
    originalRunStatus: details.originalRunStatus || null,
    counts: details.counts || {
      totalInputRecords: 0,
      admittedRecordCount: 0,
      rejectedRecordCount: 0,
      quarantinedRecordCount: 0,
      duplicateCount: 0
    },
    integrity: {
      manifest: { valid: false, reasons: details.manifestReasons || [] },
      quarantine: { valid: false, reasons: details.quarantineReasons || [] }
    },
    fingerprintAgreement: false,
    fingerprintComparison: {},
    countComparison: {},
    dispositionComparison: {
      original: details.originalRunStatus || null,
      replayed: null,
      matches: false
    },
    detectedDrift: [],
    failureStages: details.failureStages || [],
    canonicalReasonCodes: details.canonicalReasonCodes || [],
    operatorReviewStatus: details.operatorReviewStatus || null,
    finalDisposition: details.finalDisposition || null,
    recommendedFollowUpAction: FOLLOW_UP_ACTION.LOCATE_REPLAY_EVIDENCE
  };
  summary.text = buildOperationalText(summary);
  return summary;
}

function summarizeRunRecord(record = {}, options = {}) {
  const manifestPath = resolveArtifactPath(record.manifestReference, options);
  const quarantinePath = resolveArtifactPath(getQuarantineReference(record), options);

  if (!manifestPath) {
    return missingEvidenceSummary(record.runId, REPLAY_CLASSIFICATION.NON_REPLAYABLE_MISSING_MANIFEST_REFERENCE, record);
  }
  if (!quarantinePath) {
    return missingEvidenceSummary(record.runId, REPLAY_CLASSIFICATION.NON_REPLAYABLE_MISSING_QUARANTINE_REFERENCE, record);
  }
  if (!fs.existsSync(manifestPath) || !fs.existsSync(quarantinePath)) {
    return missingEvidenceSummary(record.runId, REPLAY_CLASSIFICATION.NON_REPLAYABLE_MISSING_ARTIFACT, {
      ...record,
      reasons: [
        !fs.existsSync(manifestPath) ? 'manifest_artifact_missing' : null,
        !fs.existsSync(quarantinePath) ? 'quarantine_artifact_missing' : null
      ].filter(Boolean)
    });
  }

  let manifest;
  let quarantine;
  try {
    manifest = readArtifactJson(manifestPath);
    quarantine = readArtifactJson(quarantinePath);
  } catch (error) {
    return missingEvidenceSummary(record.runId, REPLAY_CLASSIFICATION.NON_REPLAYABLE_INVALID_ARTIFACT_JSON, {
      ...record,
      reasons: ['invalid_replay_artifact_json', error.message]
    });
  }

  const integrity = {
    manifest: validateIngestionManifestIntegrity(manifest, {
      adapterMetadata: {
        sourceId: record.sourceId,
        adapterName: record.adapterName,
        adapterVersion: record.adapterVersion
      }
    }),
    quarantine: validateQuarantineArtifactIntegrity(quarantine, manifest)
  };
  const replayReport = replayIngestionRunFromArtifacts({
    manifest,
    quarantine
  }, {
    adapterMetadata: {
      sourceId: record.sourceId,
      adapterName: record.adapterName,
      adapterVersion: record.adapterVersion
    }
  });
  const replayedCounts = expectedCountsFromArtifacts(manifest, quarantine);
  const countComparison = compareCounts(record.counts, replayedCounts);
  const replayDisposition = deriveDispositionFromArtifacts(manifest, quarantine);
  const dispositionComparison = {
    original: record.runStatus || null,
    replayed: replayDisposition,
    matches: record.runStatus === replayDisposition
  };
  const fingerprintComparison = buildFingerprintComparison(record, manifest, replayReport);
  const drift = collectDrift(record, manifest, quarantine, replayReport, integrity);
  const replayStatus = classifyReplay(true, drift, integrity);
  const failureStages = collectFailureStages(record, manifest, quarantine);
  const canonicalReasonCodes = collectReasonCodes(record, manifest, quarantine);
  const summary = {
    source: SOURCE,
    version: REPLAY_SUMMARY_VERSION,
    runId: record.runId || null,
    replayStatus,
    replayable: true,
    runIdentity: {
      runId: record.runId || null,
      startedAt: record.startedAt || null,
      completedAt: record.completedAt || null
    },
    sourceId: record.sourceId || null,
    marketplace: record.marketplace || null,
    adapterName: record.adapterName || null,
    adapterVersion: record.adapterVersion || null,
    acquisitionMethod: clone(record.acquisitionMethod),
    certificationRegistryEntryId: record.certificationRegistryEntryId || null,
    certificationArtifactFingerprint: record.certificationArtifactFingerprint || null,
    permissionStatus: record.permissionStatus || null,
    originalRunStatus: record.runStatus || null,
    counts: replayedCounts,
    originalCounts: clone(record.counts),
    countComparison,
    manifestReference: manifestPath,
    quarantineReference: quarantinePath,
    integrity: {
      manifest: {
        valid: integrity.manifest.valid,
        reasons: integrity.manifest.reasons,
        warnings: integrity.manifest.warnings,
        fingerprint: integrity.manifest.fingerprint
      },
      quarantine: {
        valid: integrity.quarantine.valid,
        reasons: integrity.quarantine.reasons,
        warnings: integrity.quarantine.warnings,
        fingerprint: integrity.quarantine.fingerprint
      }
    },
    fingerprintComparison,
    fingerprintAgreement: fingerprintAgreement(fingerprintComparison),
    dispositionComparison,
    detectedDrift: drift,
    replayMetadata: {
      deterministic: replayReport.deterministic === true,
      passed: replayReport.passed === true,
      outcomeFingerprint: replayReport.replay?.outcomeFingerprint || null,
      mode: replayReport.replayMode || null
    },
    failureStages,
    canonicalReasonCodes,
    operatorReviewStatus: record.operatorReviewStatus || OPERATOR_REVIEW_STATUS.UNREVIEWED,
    finalDisposition: record.finalDisposition || FINAL_DISPOSITION.PENDING
  };
  summary.recommendedFollowUpAction = recommendedFollowUp(summary);
  summary.summaryFingerprint = buildFingerprintFromProjection({
    runId: summary.runId,
    replayStatus: summary.replayStatus,
    fingerprintComparison: summary.fingerprintComparison,
    countComparison: summary.countComparison,
    dispositionComparison: summary.dispositionComparison,
    detectedDrift: summary.detectedDrift,
    recommendedFollowUpAction: summary.recommendedFollowUpAction
  });
  summary.text = buildOperationalText(summary);
  return summary;
}

function summarizeIngestionRunById(input = {}, runId, options = {}) {
  const repository = input.runs ? input : loadIngestionRunRepository(input.repositoryPath || options.repositoryPath);
  const record = getIngestionRunById(repository, runId);
  if (!record) return missingEvidenceSummary(runId, REPLAY_CLASSIFICATION.NON_REPLAYABLE_MISSING_RUN);
  return summarizeRunRecord(record, {
    repositoryDir: input.repositoryPath ? path.dirname(input.repositoryPath) : options.repositoryDir,
    artifactBaseDir: options.artifactBaseDir
  });
}

function summarizePersistedIngestionRun(repositoryPath, runId, options = {}) {
  return summarizeIngestionRunById({ repositoryPath }, runId, options);
}

function buildAggregateIngestionRunSummary(input = {}, options = {}) {
  const repository = input.runs ? input : loadIngestionRunRepository(input.repositoryPath || options.repositoryPath);
  const runs = listIngestionRuns(repository, options.filters || {});
  const summaries = runs.map((run) => summarizeRunRecord(run, {
    repositoryDir: input.repositoryPath ? path.dirname(input.repositoryPath) : options.repositoryDir,
    artifactBaseDir: options.artifactBaseDir
  }));
  const replayed = summaries.filter((summary) => summary.replayable);
  const fingerprintAgreements = replayed.filter((summary) => summary.fingerprintAgreement).length;
  const statusCounts = countValues(runs.map((run) => run.runStatus));
  const recurringFailureStages = countValues(summaries.flatMap((summary) => summary.failureStages));
  const recurringReasonCodes = countValues(summaries.flatMap((summary) => summary.canonicalReasonCodes));
  const sourceSummaries = {};
  const adapterSummaries = {};

  for (const summary of summaries) {
    const sourceKey = summary.sourceId || 'unknown';
    const adapterKey = `${summary.sourceId || 'unknown'}:${summary.adapterName || 'unknown'}:${summary.adapterVersion || 'unknown'}`;
    sourceSummaries[sourceKey] = sourceSummaries[sourceKey] || {
      sourceId: sourceKey,
      totalRuns: 0,
      replayableRuns: 0,
      quarantinedRuns: 0,
      driftedRuns: 0
    };
    adapterSummaries[adapterKey] = adapterSummaries[adapterKey] || {
      adapterKey,
      sourceId: summary.sourceId || null,
      adapterName: summary.adapterName || null,
      adapterVersion: summary.adapterVersion || null,
      totalRuns: 0,
      replayableRuns: 0,
      driftedRuns: 0
    };
    sourceSummaries[sourceKey].totalRuns += 1;
    adapterSummaries[adapterKey].totalRuns += 1;
    if (summary.replayable) {
      sourceSummaries[sourceKey].replayableRuns += 1;
      adapterSummaries[adapterKey].replayableRuns += 1;
    }
    if (summary.counts?.quarantinedRecordCount > 0) sourceSummaries[sourceKey].quarantinedRuns += 1;
    if (summary.detectedDrift.length > 0) {
      sourceSummaries[sourceKey].driftedRuns += 1;
      adapterSummaries[adapterKey].driftedRuns += 1;
    }
  }

  return {
    source: SOURCE,
    version: REPLAY_SUMMARY_VERSION,
    totalRuns: summaries.length,
    completedCount: statusCounts[RUN_STATUS.COMPLETED] || 0,
    partialCount: statusCounts[RUN_STATUS.PARTIAL] || 0,
    failedCount: statusCounts[RUN_STATUS.FAILED] || 0,
    incompleteCount: (statusCounts[RUN_STATUS.INCOMPLETE] || 0) + (statusCounts[RUN_STATUS.STARTED] || 0),
    replayableCount: replayed.length,
    nonReplayableCount: summaries.length - replayed.length,
    fingerprintAgreementRate: replayed.length ? fingerprintAgreements / replayed.length : 0,
    recurringFailureStages,
    recurringReasonCodes,
    sourceSummaries,
    adapterSummaries,
    operatorReviewBacklog: summaries.filter((summary) => summary.operatorReviewStatus !== OPERATOR_REVIEW_STATUS.REVIEWED).length,
    unresolvedOrQuarantinedRunCount: summaries.filter((summary) => (
      summary.finalDisposition === FINAL_DISPOSITION.PENDING
      || Number(summary.counts?.quarantinedRecordCount || 0) > 0
    )).length,
    replayStatusCounts: countValues(summaries.map((summary) => summary.replayStatus)),
    generatedAt: options.generatedAt || new Date().toISOString(),
    runSummaries: options.includeRuns === false ? [] : summaries.map((summary) => ({
      runId: summary.runId,
      replayStatus: summary.replayStatus,
      detectedDrift: summary.detectedDrift,
      recommendedFollowUpAction: summary.recommendedFollowUpAction
    }))
  };
}

module.exports = {
  FOLLOW_UP_ACTION,
  REPLAY_CLASSIFICATION,
  REPLAY_SUMMARY_VERSION,
  SOURCE,
  buildAggregateIngestionRunSummary,
  buildOperationalText,
  compareCounts,
  deriveDispositionFromArtifacts,
  summarizeIngestionRunById,
  summarizePersistedIngestionRun,
  summarizeRunRecord,
  stableStringify
};
