'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
  CERTIFICATION_ARTIFACT_SCHEMA,
  CERTIFICATION_ARTIFACT_SCHEMA_VERSION,
  INGESTION_MANIFEST_SCHEMA,
  INGESTION_MANIFEST_SCHEMA_VERSION,
  asArray,
  asObject,
  createValidationResult,
  fingerprint,
  unique
} = require('./canonicalValidationCore');
const {
  CERTIFICATION_STANDARD_VERSION,
  SOURCE: CERTIFICATION_SOURCE
} = require('./marketplaceAdapterCertification');
const {
  GATE_VERSION,
  SOURCE: INGESTION_SOURCE,
  validateCertificationArtifact
} = require('./liveIngestionSafetyGate');

const ARTIFACT_INTEGRITY_VERSION = '1.0.0';
const SOURCE = 'canonical_artifact_integrity';

function clone(value) {
  return JSON.parse(JSON.stringify(value || null));
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJsonFile(filePath, payload) {
  if (!filePath) {
    return {
      written: false,
      path: null
    };
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
  return {
    written: true,
    path: filePath
  };
}

function loadArtifact(input) {
  if (typeof input === 'string') return readJsonFile(input);
  return asObject(input);
}

function stripIntegrityEnvelope(artifact = {}) {
  const copy = clone(artifact);
  if (copy && typeof copy === 'object') delete copy.integrity;
  return copy;
}

function immutableFingerprint(artifact = {}) {
  return fingerprint(stripIntegrityEnvelope(artifact));
}

function compareExpectedFingerprint(artifact = {}, expectedFingerprint, reasonCode) {
  if (!expectedFingerprint) return [];
  return immutableFingerprint(artifact) === expectedFingerprint ? [] : [reasonCode];
}

function missingRequiredArtifactFields(artifact = {}, fields = []) {
  const input = asObject(artifact);
  return asArray(fields).filter((field) => (
    !Object.prototype.hasOwnProperty.call(input, field)
    || input[field] === undefined
    || input[field] === null
  ));
}

function compareIntegrityEnvelope(artifact = {}, reasonCode) {
  const expected = artifact?.integrity?.fingerprint;
  if (!expected) return [];
  return immutableFingerprint(artifact) === expected ? [] : [reasonCode];
}

function compareAdapterMetadata(artifactAdapter = {}, expectedAdapter = {}) {
  const reasons = [];
  const adapter = asObject(artifactAdapter);
  const expected = asObject(expectedAdapter);

  for (const field of ['sourceId', 'adapterName', 'adapterVersion']) {
    if (!expected[field]) continue;
    if (adapter[field] !== expected[field]) reasons.push(`adapter_${field}_mismatch`);
  }

  return reasons;
}

function validateFixtureVersion(container = {}, expectedFixtureVersion) {
  if (!expectedFixtureVersion) return [];
  const actual = container.fixtureVersion
    || container.standard?.fixtureVersion
    || container.batch?.fixtureVersion
    || container.integrity?.fixtureVersion
    || null;
  if (!actual) return ['missing_fixture_version'];
  return actual === expectedFixtureVersion ? [] : ['fixture_version_mismatch'];
}

function validateCertificationArtifactIntegrity(certificationArtifact = {}, options = {}) {
  const artifact = loadArtifact(certificationArtifact);
  const reasons = [];
  const warnings = [];
  const checks = {};
  const now = options.now ? new Date(options.now) : new Date();

  checks.requiredFields = missingRequiredArtifactFields(artifact, CERTIFICATION_ARTIFACT_SCHEMA.requiredFields)
    .map((field) => `missing_certification_${field}`);
  checks.requiredAdapterFields = missingRequiredArtifactFields(asObject(artifact.adapter), CERTIFICATION_ARTIFACT_SCHEMA.requiredAdapterFields)
    .map((field) => `missing_certification_adapter_${field}`);
  checks.fingerprint = [
    ...compareExpectedFingerprint(artifact, options.expectedFingerprint, 'certification_fingerprint_mismatch'),
    ...compareIntegrityEnvelope(artifact, 'certification_integrity_fingerprint_mismatch')
  ];
  checks.adapter = compareAdapterMetadata(artifact.adapter, options.adapterMetadata);
  checks.fixtureVersion = validateFixtureVersion(artifact, options.fixtureVersion);
  checks.lifecycle = [];
  checks.version = [];

  if (artifact.schemaVersion === undefined || artifact.schemaVersion === null) {
    warnings.push('missing_certification_schemaVersion_backwards_compatible');
  } else if (artifact.schemaVersion !== CERTIFICATION_ARTIFACT_SCHEMA_VERSION) {
    checks.version.push('certification_schema_version_mismatch');
  }
  if (artifact.source !== CERTIFICATION_SOURCE) checks.version.push('invalid_certification_source');
  if (artifact.version !== CERTIFICATION_STANDARD_VERSION) checks.version.push('certification_version_drift');
  if (artifact.standard?.version && artifact.standard.version !== CERTIFICATION_STANDARD_VERSION) {
    checks.version.push('certification_standard_version_drift');
  }
  if (artifact.expiresAt && new Date(artifact.expiresAt) < now) checks.lifecycle.push('certification_expired');
  if (artifact.revoked === true || artifact.revokedAt || artifact.status === 'revoked') checks.lifecycle.push('certification_revoked');

  if (options.adapterMetadata) {
    const gateValidation = validateCertificationArtifact(artifact, options.adapterMetadata);
    checks.liveGateCompatibility = gateValidation.reasons;
  } else {
    checks.liveGateCompatibility = [];
  }

  reasons.push(
    ...checks.requiredFields,
    ...checks.requiredAdapterFields,
    ...checks.fingerprint,
    ...checks.adapter,
    ...checks.fixtureVersion,
    ...checks.lifecycle,
    ...checks.version,
    ...checks.liveGateCompatibility
  );

  return {
    ...createValidationResult({
      valid: reasons.length === 0,
      reasons,
      checks,
      metadata: {
        artifactFingerprint: immutableFingerprint(artifact),
        schemaVersion: artifact.schemaVersion || null
      }
    }),
    source: SOURCE,
    version: ARTIFACT_INTEGRITY_VERSION,
    artifactType: 'certification',
    valid: reasons.length === 0,
    reasons: unique(reasons),
    warnings,
    fingerprint: immutableFingerprint(artifact),
    checks,
    summary: {
      productionApproved: artifact.productionApproved === true,
      certificationLevel: artifact.certificationLevel || null,
      adapterName: artifact.adapter?.adapterName || null,
      adapterVersion: artifact.adapter?.adapterVersion || null
    }
  };
}

function expectedRunFingerprint(manifest = {}) {
  return fingerprint({
    runId: manifest.runId,
    adapter: manifest.adapter,
    requestFingerprint: manifest.fingerprints?.request || null,
    responseFingerprint: manifest.fingerprints?.response || null,
    certificationFingerprint: manifest.fingerprints?.certificationArtifact || null
  });
}

function validateIngestionManifestIntegrity(manifestInput = {}, options = {}) {
  const manifest = loadArtifact(manifestInput);
  const reasons = [];
  const warnings = [];
  const checks = {};

  checks.requiredFields = missingRequiredArtifactFields(manifest, INGESTION_MANIFEST_SCHEMA.requiredFields)
    .map((field) => `missing_manifest_${field}`);
  checks.fingerprint = [
    ...compareExpectedFingerprint(manifest, options.expectedFingerprint, 'manifest_fingerprint_mismatch'),
    ...compareIntegrityEnvelope(manifest, 'manifest_integrity_fingerprint_mismatch')
  ];
  checks.fixtureVersion = validateFixtureVersion(manifest, options.fixtureVersion);
  checks.adapter = compareAdapterMetadata(manifest.adapter, options.adapterMetadata);
  checks.version = [];
  checks.runFingerprint = [];
  checks.certificationFingerprint = [];
  checks.safety = [];

  if (manifest.schemaVersion === undefined || manifest.schemaVersion === null) {
    warnings.push('missing_manifest_schemaVersion_backwards_compatible');
  } else if (manifest.schemaVersion !== INGESTION_MANIFEST_SCHEMA_VERSION) {
    checks.version.push('manifest_schema_version_mismatch');
  }
  if (manifest.source !== INGESTION_SOURCE) checks.version.push('invalid_manifest_source');
  if (manifest.version !== GATE_VERSION) checks.version.push('manifest_version_drift');

  if (manifest.fingerprints?.run) {
    const expected = expectedRunFingerprint(manifest);
    if (manifest.fingerprints.run !== expected) checks.runFingerprint.push('manifest_run_fingerprint_mismatch');
  } else {
    checks.runFingerprint.push('missing_manifest_run_fingerprint');
  }

  if (options.certificationArtifact) {
    const actualCertificationFingerprint = immutableFingerprint(loadArtifact(options.certificationArtifact));
    if (manifest.fingerprints?.certificationArtifact !== actualCertificationFingerprint) {
      checks.certificationFingerprint.push('manifest_certification_fingerprint_mismatch');
    }
  }

  if (manifest.summary?.productionStoreWrites !== false) {
    checks.safety.push('manifest_claims_production_store_writes');
  }
  if (manifest.storeWritesEnabled && manifest.dryRun) {
    checks.safety.push('manifest_dry_run_store_write_conflict');
  }

  reasons.push(
    ...checks.requiredFields,
    ...checks.fingerprint,
    ...checks.fixtureVersion,
    ...checks.adapter,
    ...checks.version,
    ...checks.runFingerprint,
    ...checks.certificationFingerprint,
    ...checks.safety
  );

  return {
    ...createValidationResult({
      valid: reasons.length === 0,
      reasons,
      checks,
      metadata: {
        artifactFingerprint: immutableFingerprint(manifest),
        expectedRunFingerprint: expectedRunFingerprint(manifest)
      }
    }),
    source: SOURCE,
    version: ARTIFACT_INTEGRITY_VERSION,
    artifactType: 'ingestion_manifest',
    valid: reasons.length === 0,
    reasons: unique(reasons),
    warnings,
    fingerprint: immutableFingerprint(manifest),
    checks,
    summary: {
      runId: manifest.runId || null,
      dryRun: manifest.dryRun !== false,
      storeWritesEnabled: manifest.storeWritesEnabled === true,
      rejectedRecords: manifest.summary?.rejectedRecords || 0,
      partialFailures: asArray(manifest.partialFailures).length
    }
  };
}

function summarizeQuarantineClassifications(rejectedRecords = []) {
  return asArray(rejectedRecords).reduce((counts, record) => {
    const classification = record.classification || 'unknown';
    counts[classification] = (counts[classification] || 0) + 1;
    return counts;
  }, {});
}

function validateQuarantineArtifactIntegrity(quarantineInput = {}, manifestInput = {}, options = {}) {
  const quarantine = loadArtifact(quarantineInput);
  const manifest = loadArtifact(manifestInput);
  const rejectedRecords = asArray(quarantine.rejectedRecords);
  const reasons = [];
  const warnings = [];
  const checks = {
    requiredFields: missingRequiredArtifactFields(quarantine, [
      'source',
      'version',
      'runId',
      'createdAt',
      'rejectedRecords',
      'summary'
    ]).map((field) => `missing_quarantine_${field}`),
    fingerprint: [
      ...compareExpectedFingerprint(quarantine, options.expectedFingerprint, 'quarantine_fingerprint_mismatch'),
      ...compareIntegrityEnvelope(quarantine, 'quarantine_integrity_fingerprint_mismatch')
    ],
    manifestLink: [],
    summary: [],
    recordFingerprints: [],
    recordStages: []
  };

  if (quarantine.runId !== manifest.runId) checks.manifestLink.push('quarantine_run_id_mismatch');
  if (quarantine.version !== GATE_VERSION) checks.manifestLink.push('quarantine_version_drift');
  if (quarantine.source !== `${INGESTION_SOURCE}_quarantine`) checks.manifestLink.push('invalid_quarantine_source');

  if (quarantine.summary?.rejectedRecords !== rejectedRecords.length) {
    checks.summary.push('quarantine_rejected_count_mismatch');
  }
  const duplicateCount = rejectedRecords.filter((record) => asArray(record.reasons).includes('duplicate_sold_evidence_record')).length;
  if ((quarantine.summary?.duplicateRecords || 0) !== duplicateCount) {
    checks.summary.push('quarantine_duplicate_count_mismatch');
  }

  const classifications = summarizeQuarantineClassifications(rejectedRecords);
  const declaredClassifications = asObject(quarantine.summary?.classifications);
  for (const [classification, count] of Object.entries(classifications)) {
    if (declaredClassifications[classification] !== count) {
      checks.summary.push(`quarantine_classification_count_mismatch:${classification}`);
    }
  }

  for (const [index, record] of rejectedRecords.entries()) {
    if (!asArray(record.failureStages).length) checks.recordStages.push(`missing_failure_stages:${index}`);
    if (record.requestFingerprint && manifest.fingerprints?.request && record.requestFingerprint !== manifest.fingerprints.request) {
      checks.recordFingerprints.push(`request_fingerprint_mismatch:${index}`);
    }
    if (record.responseFingerprint && manifest.fingerprints?.response && record.responseFingerprint !== manifest.fingerprints.response) {
      checks.recordFingerprints.push(`response_fingerprint_mismatch:${index}`);
    }
  }

  if (!quarantine.integrity?.fingerprint) warnings.push('missing_quarantine_integrity_fingerprint_backwards_compatible');

  reasons.push(
    ...checks.requiredFields,
    ...checks.fingerprint,
    ...checks.manifestLink,
    ...checks.summary,
    ...checks.recordFingerprints,
    ...checks.recordStages
  );

  return {
    ...createValidationResult({
      valid: reasons.length === 0,
      reasons,
      checks,
      metadata: {
        artifactFingerprint: immutableFingerprint(quarantine)
      }
    }),
    source: SOURCE,
    version: ARTIFACT_INTEGRITY_VERSION,
    artifactType: 'quarantine',
    valid: reasons.length === 0,
    reasons: unique(reasons),
    warnings,
    fingerprint: immutableFingerprint(quarantine),
    checks,
    summary: {
      runId: quarantine.runId || null,
      rejectedRecords: rejectedRecords.length,
      classifications
    }
  };
}

function buildReplayOutcomeFingerprint(report = {}) {
  return fingerprint({
    certification: {
      valid: report.certification?.valid ?? null,
      reasons: report.certification?.reasons || []
    },
    manifest: {
      valid: report.manifest?.valid ?? null,
      reasons: report.manifest?.reasons || [],
      fingerprint: report.manifest?.fingerprint || null
    },
    quarantine: {
      valid: report.quarantine?.valid ?? null,
      reasons: report.quarantine?.reasons || [],
      fingerprint: report.quarantine?.fingerprint || null
    },
    replay: {
      runId: report.runId || null,
      rejectedRecords: report.replay?.rejectedRecords || 0,
      partialFailures: report.replay?.partialFailures || 0,
      failureClassifications: report.replay?.failureClassifications || {}
    }
  });
}

function replayIngestionRunFromArtifacts(input = {}, options = {}) {
  const manifest = loadArtifact(input.manifest || input.manifestPath);
  const quarantine = loadArtifact(input.quarantine || input.quarantinePath);
  const certificationArtifact = input.certificationArtifact || input.certificationArtifactPath
    ? loadArtifact(input.certificationArtifact || input.certificationArtifactPath)
    : null;
  const certification = certificationArtifact
    ? validateCertificationArtifactIntegrity(certificationArtifact, {
      adapterMetadata: manifest.adapter,
      expectedFingerprint: manifest.fingerprints?.certificationArtifact,
      fixtureVersion: options.fixtureVersion,
      now: options.now
    })
    : null;
  const manifestValidation = validateIngestionManifestIntegrity(manifest, {
    adapterMetadata: options.adapterMetadata,
    certificationArtifact,
    expectedFingerprint: options.expectedManifestFingerprint,
    fixtureVersion: options.fixtureVersion
  });
  const quarantineValidation = validateQuarantineArtifactIntegrity(quarantine, manifest, {
    expectedFingerprint: options.expectedQuarantineFingerprint
  });
  const firstReplay = {
    runId: manifest.runId || null,
    rejectedRecords: asArray(quarantine.rejectedRecords).length,
    partialFailures: asArray(manifest.partialFailures).length,
    failureClassifications: asObject(manifest.batch?.failureClassifications),
    quarantinedRecordOutcomes: asArray(quarantine.rejectedRecords).map((record) => ({
      recordIndex: record.recordIndex ?? null,
      recordId: record.recordId || null,
      failureStages: asArray(record.failureStages),
      reasons: asArray(record.reasons),
      classification: record.classification || null
    }))
  };
  const report = {
    source: SOURCE,
    version: ARTIFACT_INTEGRITY_VERSION,
    replayMode: 'saved_manifest_and_quarantine',
    runId: manifest.runId || null,
    certification,
    manifest: manifestValidation,
    quarantine: quarantineValidation,
    replay: firstReplay,
    deterministic: false,
    passed: false,
    summary: null
  };
  const firstFingerprint = buildReplayOutcomeFingerprint(report);
  const secondReport = {
    ...report,
    certification: certificationArtifact
      ? validateCertificationArtifactIntegrity(certificationArtifact, {
        adapterMetadata: manifest.adapter,
        expectedFingerprint: manifest.fingerprints?.certificationArtifact,
        fixtureVersion: options.fixtureVersion,
        now: options.now
      })
      : null,
    manifest: validateIngestionManifestIntegrity(manifest, {
      adapterMetadata: options.adapterMetadata,
      certificationArtifact,
      expectedFingerprint: options.expectedManifestFingerprint,
      fixtureVersion: options.fixtureVersion
    }),
    quarantine: validateQuarantineArtifactIntegrity(quarantine, manifest, {
      expectedFingerprint: options.expectedQuarantineFingerprint
    })
  };
  const secondFingerprint = buildReplayOutcomeFingerprint(secondReport);

  report.replay.outcomeFingerprint = firstFingerprint;
  report.replay.secondOutcomeFingerprint = secondFingerprint;
  report.deterministic = firstFingerprint === secondFingerprint;
  report.passed = Boolean(
    report.deterministic
    && report.manifest.valid
    && report.quarantine.valid
    && (!report.certification || report.certification.valid)
  );
  report.summary = {
    passed: report.passed,
    deterministic: report.deterministic,
    runId: report.runId,
    rejectedRecords: report.replay.rejectedRecords,
    partialFailures: report.replay.partialFailures,
    certificationValid: report.certification ? report.certification.valid : null,
    manifestValid: report.manifest.valid,
    quarantineValid: report.quarantine.valid
  };

  if (options.outFile) writeJsonFile(options.outFile, report);
  return report;
}

module.exports = {
  ARTIFACT_INTEGRITY_VERSION,
  SOURCE,
  buildReplayOutcomeFingerprint,
  expectedRunFingerprint,
  immutableFingerprint,
  replayIngestionRunFromArtifacts,
  validateCertificationArtifactIntegrity,
  validateIngestionManifestIntegrity,
  validateQuarantineArtifactIntegrity,
  writeJsonFile
};
