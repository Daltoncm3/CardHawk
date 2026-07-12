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
  FAILURE_CLASSIFICATIONS,
  classifyFailure,
  fingerprint,
  runLiveIngestionSafetyGate,
  stableStringify,
  validateCertificationArtifact,
  validateSourcePermission
} = require('../validation/liveIngestionSafetyGate');

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
      requestId: 'live-gate-test-request',
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
    runId: 'ingest_test_run_001',
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

test('Production Approved certification artifact validates exact adapter identity and version', () => {
  const valid = validateCertificationArtifact(productionCertification(), adapter);
  const mismatch = validateCertificationArtifact(productionCertification({
    adapter: {
      ...productionCertification().adapter,
      adapterVersion: '9.9.9'
    }
  }), adapter);

  assert.equal(valid.valid, true);
  assert.equal(valid.artifact.certificationLevel, CERTIFICATION_LEVELS.PRODUCTION_APPROVED);
  assert.equal(typeof valid.fingerprint, 'string');
  assert.equal(mismatch.valid, false);
  assert.equal(mismatch.reasons.includes('adapter_adapterVersion_mismatch'), true);
});

test('gate rejects store admission without Production Approved certification', () => {
  const report = runLiveIngestionSafetyGate({
    adapter,
    certificationArtifact: productionCertification({
      certificationLevel: CERTIFICATION_LEVELS.CERTIFIED,
      productionApproved: false
    }),
    acquisitionResult: acquisitionResult()
  }, gateOptions());

  assert.equal(report.passed, false);
  assert.equal(report.manifest.summary.certificationApproved, false);
  assert.equal(report.rejectedRecords.length, 1);
  assert.equal(report.rejectedRecords[0].reasons.includes('certification_gate_failed'), true);
  assert.equal(report.nextStore.stats.recordCount, 0);
});

test('gate enforces source permission and licensing metadata', () => {
  const invalid = validateSourcePermission(sourcePermission({
    status: 'pending',
    license: {
      id: 'license-001',
      commercialUsePermitted: false,
      evidenceUse: ''
    }
  }));

  assert.equal(invalid.valid, false);
  assert.equal(invalid.reasons.includes('source_permission_not_approved'), true);
  assert.equal(invalid.reasons.includes('commercial_use_not_permitted'), true);
  assert.equal(invalid.reasons.includes('missing_license_evidence_use'), true);
});

test('dry-run approved admission writes manifest and quarantine but does not mutate the store', () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cardhawk-live-gate-'));
  const store = createEmptySoldEvidenceStore();
  const report = runLiveIngestionSafetyGate({
    adapter,
    certificationArtifact: productionCertification(),
    acquisitionResult: acquisitionResult(),
    store
  }, gateOptions({ outputDir }));

  assert.equal(report.passed, true);
  assert.equal(report.dryRun, true);
  assert.equal(report.storeWritesEnabled, false);
  assert.equal(report.manifest.summary.admittedRecords, 1);
  assert.equal(report.manifest.summary.wroteToStore, false);
  assert.equal(report.nextStore.stats.recordCount, 0);
  assert.equal(report.dryRunStorePreview.stats.recordCount, 1);
  assert.equal(fs.existsSync(report.artifacts.manifestPath), true);
  assert.equal(fs.existsSync(report.artifacts.quarantinePath), true);

  const manifest = JSON.parse(fs.readFileSync(report.artifacts.manifestPath, 'utf8'));
  const quarantine = JSON.parse(fs.readFileSync(report.artifacts.quarantinePath, 'utf8'));

  assert.equal(manifest.runId, 'ingest_test_run_001');
  assert.equal(manifest.summary.productionStoreWrites, false);
  assert.equal(manifest.fingerprints.request.length, 64);
  assert.equal(quarantine.rejectedRecords.length, 0);
});

test('gate quarantines invalid schema, identity, evidence type, and transaction records', () => {
  const report = runLiveIngestionSafetyGate({
    adapter,
    certificationArtifact: productionCertification(),
    acquisitionResult: acquisitionResult({
      records: [
        soldRecord({
          evidenceType: 'active_context',
          status: 'context_only',
          soldPrice: 0,
          soldAt: null,
          url: '',
          parsedIdentity: {
            category: 'sports_card'
          }
        })
      ]
    })
  }, gateOptions());
  const rejected = report.rejectedRecords[0];

  assert.equal(report.passed, false);
  assert.equal(rejected.failureStages.includes('identity'), true);
  assert.equal(rejected.failureStages.includes('provenance'), true);
  assert.equal(rejected.failureStages.includes('evidence_type'), true);
  assert.equal(rejected.failureStages.includes('transaction'), true);
  assert.equal(report.manifest.summary.rejectedRecords, 1);
});

test('gate quarantines duplicate records and reports duplicate summaries', () => {
  const report = runLiveIngestionSafetyGate({
    adapter,
    certificationArtifact: productionCertification(),
    acquisitionResult: acquisitionResult({
      records: [
        soldRecord(),
        soldRecord({
          rawTitle: 'Duplicate Anthony Hernandez sale'
        })
      ]
    })
  }, gateOptions());

  assert.equal(report.passed, false);
  assert.equal(report.manifest.summary.admittedRecords, 1);
  assert.equal(report.manifest.summary.duplicateRecords, 1);
  assert.equal(report.rejectedRecords[0].reasons.includes('duplicate_sold_evidence_record'), true);
});

test('gate classifies retryable, terminal, partial, degraded, and rate-limited failures', () => {
  const result = acquisitionResult({
    errors: [
      { code: 'source_timeout', message: 'temporary timeout', retryable: true },
      { code: 'bad_request', message: 'terminal error' },
      { code: 'partial_page_failure', message: 'partial result' },
      { code: 'source_degraded', message: 'degraded mode' },
      { code: 'rate_limit', statusCode: 429, message: 'rate limit exceeded' }
    ]
  });
  const report = runLiveIngestionSafetyGate({
    adapter,
    certificationArtifact: productionCertification(),
    acquisitionResult: result
  }, gateOptions());

  assert.equal(classifyFailure(result.errors[0]), FAILURE_CLASSIFICATIONS.RETRYABLE);
  assert.equal(classifyFailure(result.errors[1]), FAILURE_CLASSIFICATIONS.TERMINAL);
  assert.equal(classifyFailure(result.errors[2]), FAILURE_CLASSIFICATIONS.PARTIAL);
  assert.equal(classifyFailure(result.errors[3]), FAILURE_CLASSIFICATIONS.DEGRADED);
  assert.equal(classifyFailure(result.errors[4]), FAILURE_CLASSIFICATIONS.RATE_LIMITED);
  assert.equal(report.manifest.batch.failureClassifications.retryable, 1);
  assert.equal(report.manifest.batch.failureClassifications.terminal, 1);
  assert.equal(report.manifest.batch.failureClassifications.partial, 1);
  assert.equal(report.manifest.batch.failureClassifications.degraded, 1);
  assert.equal(report.manifest.batch.failureClassifications.rate_limited, 1);
});

test('store writes require explicit non-dry-run and allowStoreWrite opt-in', () => {
  const blocked = runLiveIngestionSafetyGate({
    adapter,
    certificationArtifact: productionCertification(),
    acquisitionResult: acquisitionResult()
  }, gateOptions({ dryRun: false, allowStoreWrite: false }));
  const allowed = runLiveIngestionSafetyGate({
    adapter,
    certificationArtifact: productionCertification(),
    acquisitionResult: acquisitionResult()
  }, gateOptions({ dryRun: false, allowStoreWrite: true }));

  assert.equal(blocked.storeWritesEnabled, false);
  assert.equal(blocked.nextStore.stats.recordCount, 0);
  assert.equal(blocked.dryRunStorePreview.stats.recordCount, 1);
  assert.equal(allowed.storeWritesEnabled, true);
  assert.equal(allowed.nextStore.stats.recordCount, 1);
  assert.equal(allowed.manifest.summary.productionStoreWrites, false);
});

test('fingerprints are stable regardless of object key order', () => {
  const left = { b: 2, a: { y: 2, x: 1 } };
  const right = { a: { x: 1, y: 2 }, b: 2 };

  assert.equal(stableStringify(left), stableStringify(right));
  assert.equal(fingerprint(left), fingerprint(right));
});
