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
  APPROVAL_STATUS,
  DEFAULT_REGISTRY_PATH,
  buildRegistryEntryId,
  createCertificationArtifactRegistryEntry,
  createEmptyCertificationArtifactRegistry,
  loadCertificationArtifactRegistry,
  registerCertificationArtifact,
  resolveCertificationArtifactFromRegistry,
  saveCertificationArtifactRegistry,
  validateRegistryEntry
} = require('../validation/certificationArtifactRegistry');
const {
  immutableFingerprint
} = require('../validation/canonicalArtifactIntegrity');
const {
  runLiveIngestionSafetyGate
} = require('../validation/liveIngestionSafetyGate');
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

function productionCertification(overrides = {}) {
  return buildProductionCertification({
    adapter,
    summary: {
      source: 'marketplace_adapter_certification',
      adapterName: adapter.adapterName,
      sourceId: adapter.sourceId,
      marketplace: adapter.marketplace,
      level: 'Production Approved',
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
      requestId: 'registry-gate-test-request',
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

function gateOptions(overrides = {}) {
  return {
    runId: 'ingest_registry_test_run_001',
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

test('empty certification artifact registry has the expected persistent shape', () => {
  const registry = createEmptyCertificationArtifactRegistry({
    createdAt: '2026-07-11T00:00:00.000Z',
    updatedAt: '2026-07-11T00:00:00.000Z'
  });

  assert.equal(registry.source, 'certification_artifact_registry');
  assert.equal(registry.version, '1.0.0');
  assert.deepEqual(registry.entries, {});
  assert.deepEqual(registry.indexes.byAdapter, {});
  assert.equal(registry.stats.entryCount, 0);
  assert.equal(DEFAULT_REGISTRY_PATH.endsWith(path.join('data', 'certification-artifact-registry.json')), true);
});

test('registry entry preserves a cloned immutable artifact snapshot and derived fingerprint', () => {
  const artifact = productionCertification();
  const entry = createCertificationArtifactRegistryEntry(artifact, {
    registeredAt: '2026-07-12T00:00:00.000Z',
    registeredBy: 'CardHawk Release Owner'
  });

  artifact.adapter.adapterVersion = 'mutated-after-registration';

  assert.equal(entry.id, buildRegistryEntryId(adapter));
  assert.equal(entry.approvalStatus, APPROVAL_STATUS.PRODUCTION_APPROVED);
  assert.equal(entry.artifact.adapter.adapterVersion, adapter.adapterVersion);
  assert.equal(entry.artifactFingerprint, immutableFingerprint(entry.artifact));
  assert.equal(entry.integrity.fingerprint.length, 64);
});

test('registry resolves only exact source, adapter name, and adapter version matches', () => {
  const registration = registerCertificationArtifact(
    createEmptyCertificationArtifactRegistry(),
    productionCertification(),
    { registeredAt: '2026-07-12T00:00:00.000Z' }
  );
  const resolved = resolveCertificationArtifactFromRegistry(registration.registry, adapter, {
    now: '2026-07-12T00:00:00.000Z'
  });
  const mismatched = resolveCertificationArtifactFromRegistry(registration.registry, {
    ...adapter,
    adapterVersion: '9.9.9'
  }, {
    now: '2026-07-12T00:00:00.000Z'
  });

  assert.equal(registration.registered, true);
  assert.equal(resolved.resolved, true);
  assert.equal(resolved.artifact.adapter.adapterVersion, adapter.adapterVersion);
  assert.equal(mismatched.resolved, false);
  assert.equal(mismatched.reasons.includes('certification_registry_entry_not_found'), true);
});

test('registry rejects revoked, expired, malformed, and fingerprint-drift entries', () => {
  const revoked = validateRegistryEntry(createCertificationArtifactRegistryEntry(productionCertification(), {
    revoked: true,
    revokedAt: '2026-07-12T00:00:00.000Z'
  }), { adapterMetadata: adapter, now: '2026-07-12T00:00:00.000Z' });
  const expired = validateRegistryEntry(createCertificationArtifactRegistryEntry(productionCertification(), {
    validUntil: '2026-01-01T00:00:00.000Z'
  }), { adapterMetadata: adapter, now: '2026-07-12T00:00:00.000Z' });
  const malformed = validateRegistryEntry({
    id: 'malformed'
  }, { adapterMetadata: adapter });
  const drifted = createCertificationArtifactRegistryEntry(productionCertification());
  drifted.artifact.adapter.adapterVersion = '9.9.9';
  const driftValidation = validateRegistryEntry(drifted, { adapterMetadata: adapter });

  assert.equal(revoked.valid, false);
  assert.equal(revoked.reasons.includes('registry_entry_revoked'), true);
  assert.equal(expired.reasons.includes('registry_entry_expired'), true);
  assert.equal(malformed.reasons.includes('missing_registry_sourceId'), true);
  assert.equal(malformed.reasons.includes('missing_registry_certification_artifact'), true);
  assert.equal(driftValidation.reasons.includes('registry_artifact_fingerprint_mismatch'), true);
});

test('registry persists through the shared state store without touching production data', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cardhawk-cert-registry-'));
  const registryPath = path.join(tempDir, 'certification-artifact-registry.json');
  const registration = registerCertificationArtifact(
    createEmptyCertificationArtifactRegistry(),
    productionCertification(),
    { registeredAt: '2026-07-12T00:00:00.000Z' }
  );
  const saveResult = saveCertificationArtifactRegistry(registryPath, registration.registry);
  const loaded = loadCertificationArtifactRegistry(registryPath);
  const resolved = resolveCertificationArtifactFromRegistry(loaded, adapter, {
    now: '2026-07-12T00:00:00.000Z'
  });

  assert.equal(saveResult.ok, true);
  assert.equal(fs.existsSync(registryPath), true);
  assert.equal(loaded.stats.entryCount, 1);
  assert.equal(resolved.resolved, true);
});

test('live ingestion safety gate can resolve certification through registry while preserving dry-run behavior', () => {
  const registration = registerCertificationArtifact(
    createEmptyCertificationArtifactRegistry(),
    productionCertification(),
    { registeredAt: '2026-07-12T00:00:00.000Z' }
  );
  const report = runLiveIngestionSafetyGate({
    adapter,
    certificationRegistry: registration.registry,
    acquisitionResult: acquisitionResult(),
    store: createEmptySoldEvidenceStore()
  }, gateOptions());

  assert.equal(report.passed, true);
  assert.equal(report.manifest.certification.valid, true);
  assert.equal(report.manifest.certification.registry.resolvedViaRegistry, true);
  assert.equal(report.manifest.certification.registry.entryId, buildRegistryEntryId(adapter));
  assert.equal(report.nextStore.stats.recordCount, 0);
  assert.equal(report.dryRunStorePreview.stats.recordCount, 1);
});

test('live ingestion safety gate direct certification artifact path remains unchanged', () => {
  const report = runLiveIngestionSafetyGate({
    adapter,
    certificationArtifact: productionCertification(),
    acquisitionResult: acquisitionResult(),
    store: createEmptySoldEvidenceStore()
  }, gateOptions());

  assert.equal(report.passed, true);
  assert.equal(report.manifest.certification.valid, true);
  assert.equal(report.manifest.certification.registry.resolvedViaRegistry, false);
  assert.equal(report.manifest.certification.fingerprint, immutableFingerprint(productionCertification()));
});

test('registry lookup failure blocks admission through the certification gate', () => {
  const report = runLiveIngestionSafetyGate({
    adapter,
    certificationRegistry: createEmptyCertificationArtifactRegistry(),
    acquisitionResult: acquisitionResult()
  }, gateOptions());

  assert.equal(report.passed, false);
  assert.equal(report.manifest.summary.certificationApproved, false);
  assert.equal(report.manifest.certification.reasons.includes('certification_registry_entry_not_found'), true);
  assert.equal(report.rejectedRecords[0].reasons.includes('certification_gate_failed'), true);
});
