'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  CERTIFICATION_ARTIFACT_SCHEMA_VERSION,
  INGESTION_MANIFEST_SCHEMA_VERSION
} = require('../validation/canonicalValidationCore');
const {
  CERTIFICATION_LEVELS,
  CERTIFICATION_STANDARD_VERSION,
  SOURCE: CERTIFICATION_SOURCE
} = require('../validation/marketplaceAdapterCertification');
const {
  runLiveIngestionSafetyGate
} = require('../validation/liveIngestionSafetyGate');
const {
  expectedRunFingerprint,
  immutableFingerprint,
  replayIngestionRunFromArtifacts,
  validateCertificationArtifactIntegrity,
  validateIngestionManifestIntegrity,
  validateQuarantineArtifactIntegrity,
  writeJsonFile
} = require('../validation/canonicalArtifactIntegrity');

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

function acquisitionResult(overrides = {}) {
  return {
    source: {
      sourceId: adapter.sourceId,
      marketplace: adapter.marketplace,
      adapterName: adapter.adapterName,
      adapterVersion: adapter.adapterVersion,
      interfaceVersion: adapter.interfaceVersion,
      capabilities: {
        sourceReliability: 'licensed_feed'
      }
    },
    request: {
      requestId: 'artifact-integrity-request',
      query: 'anthony hernandez silver prizm',
      identity
    },
    records: [soldRecord()],
    errors: [],
    warnings: [],
    summary: {
      returned: 1,
      trueSoldCount: 1,
      errorCount: 0,
      warningCount: 0
    },
    ...overrides
  };
}

function productionCertification(overrides = {}) {
  return {
    schemaVersion: CERTIFICATION_ARTIFACT_SCHEMA_VERSION,
    source: CERTIFICATION_SOURCE,
    version: CERTIFICATION_STANDARD_VERSION,
    generatedAt: '2026-07-11T00:00:00.000Z',
    certificationLevel: CERTIFICATION_LEVELS.PRODUCTION_APPROVED,
    productionApproved: true,
    passed: true,
    standard: {
      version: CERTIFICATION_STANDARD_VERSION,
      fixtureVersion: 'fixture-v1'
    },
    adapter: {
      sourceId: adapter.sourceId,
      marketplace: adapter.marketplace,
      adapterName: adapter.adapterName,
      adapterVersion: adapter.adapterVersion,
      interfaceVersion: adapter.interfaceVersion
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
      passed: true
    },
    ...overrides
  };
}

function sourcePermission(overrides = {}) {
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
    },
    ...overrides
  };
}

function gateOptions(overrides = {}) {
  return {
    runId: 'ingest_artifact_integrity_001',
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

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildGateReport(input = {}, options = {}) {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cardhawk-artifact-integrity-'));
  const certificationArtifact = input.certificationArtifact || productionCertification();
  const report = runLiveIngestionSafetyGate({
    adapter,
    certificationArtifact,
    acquisitionResult: input.acquisitionResult || acquisitionResult()
  }, gateOptions({ outputDir, ...options }));
  const manifest = JSON.parse(fs.readFileSync(report.artifacts.manifestPath, 'utf8'));
  const quarantine = JSON.parse(fs.readFileSync(report.artifacts.quarantinePath, 'utf8'));

  return {
    certificationArtifact,
    manifest,
    quarantine,
    manifestPath: report.artifacts.manifestPath,
    quarantinePath: report.artifacts.quarantinePath,
    outputDir
  };
}

test('certification artifact integrity validates immutable schema, fingerprint, adapter, and fixture version', () => {
  const certificationArtifact = productionCertification();
  const validation = validateCertificationArtifactIntegrity(certificationArtifact, {
    adapterMetadata: adapter,
    expectedFingerprint: immutableFingerprint(certificationArtifact),
    fixtureVersion: 'fixture-v1',
    now: '2026-07-12T00:00:00.000Z'
  });

  assert.equal(validation.valid, true);
  assert.equal(validation.artifactType, 'certification');
  assert.equal(validation.fingerprint.length, 64);
  assert.equal(validation.summary.productionApproved, true);
});

test('certification integrity detects expired, revoked, malformed, incompatible, and mismatched artifacts', () => {
  const expired = validateCertificationArtifactIntegrity(productionCertification({
    expiresAt: '2026-01-01T00:00:00.000Z'
  }), { adapterMetadata: adapter, now: '2026-07-12T00:00:00.000Z' });
  const revoked = validateCertificationArtifactIntegrity(productionCertification({
    revoked: true,
    revokedAt: '2026-07-12T00:00:00.000Z'
  }), { adapterMetadata: adapter });
  const malformed = validateCertificationArtifactIntegrity({}, { adapterMetadata: adapter });
  const incompatible = validateCertificationArtifactIntegrity(productionCertification({
    schemaVersion: '9.9.9',
    version: '9.9.9',
    standard: { version: '9.9.9' }
  }), { adapterMetadata: adapter });
  const mismatched = validateCertificationArtifactIntegrity(productionCertification(), {
    adapterMetadata: {
      ...adapter,
      adapterVersion: '9.9.9'
    },
    fixtureVersion: 'fixture-v2'
  });

  assert.equal(expired.reasons.includes('certification_expired'), true);
  assert.equal(revoked.reasons.includes('certification_revoked'), true);
  assert.equal(malformed.reasons.includes('missing_certification_source'), true);
  assert.equal(incompatible.reasons.includes('certification_schema_version_mismatch'), true);
  assert.equal(incompatible.reasons.includes('certification_version_drift'), true);
  assert.equal(mismatched.reasons.includes('adapter_adapterVersion_mismatch'), true);
  assert.equal(mismatched.reasons.includes('fixture_version_mismatch'), true);
});

test('ingestion manifest integrity validates run fingerprint, certification link, and safety fields', () => {
  const { certificationArtifact, manifest } = buildGateReport();
  const validation = validateIngestionManifestIntegrity(manifest, {
    certificationArtifact,
    adapterMetadata: adapter
  });

  assert.equal(validation.valid, true);
  assert.equal(manifest.schemaVersion, INGESTION_MANIFEST_SCHEMA_VERSION);
  assert.equal(validation.summary.runId, 'ingest_artifact_integrity_001');
  assert.equal(manifest.fingerprints.run, expectedRunFingerprint(manifest));
});

test('manifest integrity detects tampering, version drift, adapter mismatch, and fixture mismatch', () => {
  const { certificationArtifact, manifest } = buildGateReport();
  const expectedFingerprint = immutableFingerprint(manifest);
  const tamperedSummary = clone(manifest);
  tamperedSummary.summary.rejectedRecords = 999;
  const tamperedRun = clone(manifest);
  tamperedRun.adapter.adapterVersion = '9.9.9';
  const drifted = clone(manifest);
  drifted.schemaVersion = '9.9.9';
  drifted.version = '9.9.9';
  drifted.batch.fixtureVersion = 'fixture-v1';

  const tamperValidation = validateIngestionManifestIntegrity(tamperedSummary, {
    expectedFingerprint
  });
  const runValidation = validateIngestionManifestIntegrity(tamperedRun, {
    certificationArtifact
  });
  const driftValidation = validateIngestionManifestIntegrity(drifted, {
    fixtureVersion: 'fixture-v2',
    adapterMetadata: adapter
  });

  assert.equal(tamperValidation.reasons.includes('manifest_fingerprint_mismatch'), true);
  assert.equal(runValidation.reasons.includes('manifest_run_fingerprint_mismatch'), true);
  assert.equal(driftValidation.reasons.includes('manifest_schema_version_mismatch'), true);
  assert.equal(driftValidation.reasons.includes('manifest_version_drift'), true);
  assert.equal(driftValidation.reasons.includes('fixture_version_mismatch'), true);
  assert.equal(driftValidation.reasons.includes('adapter_adapterVersion_mismatch'), false);
});

test('quarantine integrity validates summary counts and record fingerprints', () => {
  const { manifest, quarantine } = buildGateReport({
    acquisitionResult: acquisitionResult({
      records: [
        soldRecord({
          evidenceType: 'active_context',
          status: 'context_only',
          soldPrice: 0,
          soldAt: null,
          url: '',
          parsedIdentity: { category: 'sports_card' }
        })
      ]
    })
  });
  const valid = validateQuarantineArtifactIntegrity(quarantine, manifest);
  const tampered = clone(quarantine);
  tampered.summary.rejectedRecords = 0;
  tampered.rejectedRecords[0].requestFingerprint = 'bad-fingerprint';
  const invalid = validateQuarantineArtifactIntegrity(tampered, manifest);

  assert.equal(valid.valid, true);
  assert.equal(valid.summary.rejectedRecords, 1);
  assert.equal(invalid.reasons.includes('quarantine_rejected_count_mismatch'), true);
  assert.equal(invalid.reasons.includes('request_fingerprint_mismatch:0'), true);
});

test('replay from saved manifest and quarantine is deterministic for partial failures and quarantined records', () => {
  const { certificationArtifact, manifestPath, quarantinePath } = buildGateReport({
    acquisitionResult: acquisitionResult({
      records: [
        soldRecord({
          evidenceType: 'aggregate_market_price',
          status: 'context_only'
        })
      ],
      errors: [
        { code: 'partial_page_failure', message: 'partial fixture failure' },
        { code: 'rate_limit', statusCode: 429, message: 'rate limited' }
      ]
    })
  });
  const outFile = path.join(os.tmpdir(), `cardhawk-artifact-replay-${Date.now()}.json`);
  const replay = replayIngestionRunFromArtifacts({
    manifestPath,
    quarantinePath,
    certificationArtifact
  }, { outFile });

  assert.equal(replay.deterministic, true);
  assert.equal(replay.passed, true);
  assert.equal(replay.replay.rejectedRecords, 1);
  assert.equal(replay.replay.partialFailures, 2);
  assert.equal(replay.replay.failureClassifications.partial, 1);
  assert.equal(replay.replay.failureClassifications.rate_limited, 1);
  assert.equal(fs.existsSync(outFile), true);
});

test('large-batch quarantine replay remains deterministic', () => {
  const records = Array.from({ length: 250 }, (_, index) => soldRecord({
    marketplaceSaleId: `invalid-sale-${index}`,
    marketplaceListingId: `invalid-listing-${index}`,
    evidenceType: 'active_context',
    status: 'context_only',
    soldPrice: 0,
    soldAt: null,
    url: `https://example.test/active/${index}`,
    parsedIdentity: {
      category: 'sports_card',
      year: '2023',
      setName: 'Prizm UFC',
      cardNumber: '181'
    }
  }));
  const { certificationArtifact, manifest, quarantine } = buildGateReport({
    acquisitionResult: acquisitionResult({
      records,
      summary: {
        returned: records.length,
        trueSoldCount: 0,
        errorCount: 0,
        warningCount: 0
      }
    })
  }, {
    runId: 'ingest_large_batch_replay_001'
  });
  const replay = replayIngestionRunFromArtifacts({
    manifest,
    quarantine,
    certificationArtifact
  });

  assert.equal(replay.deterministic, true);
  assert.equal(replay.passed, true);
  assert.equal(replay.replay.rejectedRecords, 250);
  assert.equal(replay.quarantine.summary.rejectedRecords, 250);
});

test('older artifacts without schemaVersion remain backwards compatible with warnings', () => {
  const { certificationArtifact, manifest } = buildGateReport();
  const oldCertification = clone(certificationArtifact);
  const oldManifest = clone(manifest);
  delete oldCertification.schemaVersion;
  delete oldManifest.schemaVersion;
  oldManifest.fingerprints.certificationArtifact = immutableFingerprint(oldCertification);
  oldManifest.fingerprints.run = expectedRunFingerprint(oldManifest);

  const certificationValidation = validateCertificationArtifactIntegrity(oldCertification, {
    adapterMetadata: adapter
  });
  const manifestValidation = validateIngestionManifestIntegrity(oldManifest, {
    certificationArtifact: oldCertification
  });

  assert.equal(certificationValidation.valid, true);
  assert.equal(certificationValidation.warnings.includes('missing_certification_schemaVersion_backwards_compatible'), true);
  assert.equal(manifestValidation.valid, true);
  assert.equal(manifestValidation.warnings.includes('missing_manifest_schemaVersion_backwards_compatible'), true);
});

test('artifact integrity reports only persist to explicit offline output paths', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cardhawk-artifact-report-'));
  const outPath = path.join(directory, 'report.json');
  const skipped = writeJsonFile('', { skipped: true });
  const written = writeJsonFile(outPath, { ok: true });

  assert.equal(skipped.written, false);
  assert.equal(skipped.path, null);
  assert.equal(written.written, true);
  assert.equal(fs.existsSync(outPath), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(outPath, 'utf8')), { ok: true });
});
