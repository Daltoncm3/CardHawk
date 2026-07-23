'use strict';

const path = require('node:path');

const stateStore = require('../utils/stateStore');
const serializationInstrumentation = require('../utils/serializationInstrumentation');
const {
  asArray,
  asObject,
  createValidationResult,
  normalizeDate,
  stableStringify,
  unique
} = require('./canonicalValidationCore');
const {
  clone
} = require('./phase8GovernanceCore');
const {
  buildFingerprintFromProjection
} = require('./fingerprintProjection');

const REGISTRY_VERSION = '1.0.0';
const SOURCE = 'certification_artifact_registry';
const DEFAULT_REGISTRY_PATH = path.join(__dirname, '..', 'data', 'certification-artifact-registry.json');

const APPROVAL_STATUS = Object.freeze({
  DRAFT: 'draft',
  CANDIDATE: 'candidate',
  CERTIFIED: 'certified',
  PRODUCTION_APPROVED: 'production_approved',
  REVOKED: 'revoked'
});

function loadIntegrityHelpers() {
  return require('./canonicalArtifactIntegrity');
}

function normalizeToken(value, fallback = 'unknown') {
  return String(value || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '') || fallback;
}

function normalizeApprovalStatus(value, artifact = {}) {
  const normalized = normalizeToken(value || '');
  if (normalized) {
    if (normalized === 'production_approved' || normalized === 'production-approved') {
      return APPROVAL_STATUS.PRODUCTION_APPROVED;
    }
    if (Object.values(APPROVAL_STATUS).includes(normalized)) return normalized;
  }

  if (artifact.productionApproved === true || artifact.certificationLevel === 'Production Approved') {
    return APPROVAL_STATUS.PRODUCTION_APPROVED;
  }
  if (artifact.certificationLevel === 'Certified') return APPROVAL_STATUS.CERTIFIED;
  if (artifact.certificationLevel === 'Candidate') return APPROVAL_STATUS.CANDIDATE;
  return APPROVAL_STATUS.DRAFT;
}

function getArtifactAdapter(artifact = {}) {
  return asObject(artifact.adapter);
}

function createEmptyCertificationArtifactRegistry(overrides = {}) {
  const now = new Date().toISOString();
  return {
    source: SOURCE,
    version: REGISTRY_VERSION,
    createdAt: overrides.createdAt || now,
    updatedAt: overrides.updatedAt || now,
    entries: {},
    indexes: {
      byAdapter: {}
    },
    stats: {
      entryCount: 0,
      productionApprovedCount: 0,
      revokedCount: 0
    }
  };
}

function buildRegistryEntryId(input = {}) {
  const adapter = asObject(input.adapter || input);
  return [
    normalizeToken(adapter.sourceId),
    normalizeToken(adapter.adapterName),
    normalizeToken(adapter.adapterVersion)
  ].join(':');
}

function buildRegistryEntryFingerprint(entry = {}) {
  return buildFingerprintFromProjection({
    id: entry.id || null,
    sourceId: entry.sourceId || null,
    adapterName: entry.adapterName || null,
    adapterVersion: entry.adapterVersion || null,
    artifactFingerprint: entry.artifactFingerprint || null,
    artifactPath: entry.artifactPath || null,
    approvalStatus: entry.approvalStatus || null,
    validFrom: entry.validFrom || null,
    validUntil: entry.validUntil || null,
    revoked: entry.revoked === true,
    revokedAt: entry.revokedAt || null
  });
}

function refreshRegistryStats(registry = createEmptyCertificationArtifactRegistry()) {
  const entries = Object.values(asObject(registry.entries));
  registry.stats = {
    entryCount: entries.length,
    productionApprovedCount: entries.filter((entry) => entry.approvalStatus === APPROVAL_STATUS.PRODUCTION_APPROVED).length,
    revokedCount: entries.filter((entry) => entry.revoked === true || entry.approvalStatus === APPROVAL_STATUS.REVOKED).length
  };
  return registry;
}

function normalizeRegistry(registry = {}) {
  const normalized = {
    ...createEmptyCertificationArtifactRegistry(),
    ...asObject(registry),
    source: registry.source || SOURCE,
    version: registry.version || REGISTRY_VERSION,
    entries: asObject(registry.entries),
    indexes: {
      byAdapter: asObject(registry.indexes?.byAdapter)
    }
  };

  normalized.indexes.byAdapter = {};
  for (const entry of Object.values(normalized.entries)) {
    if (!entry || typeof entry !== 'object') continue;
    normalized.indexes.byAdapter[buildRegistryEntryId(entry)] = entry.id;
  }

  return refreshRegistryStats(normalized);
}

function loadCertificationArtifactRegistry(filePath = DEFAULT_REGISTRY_PATH) {
  return serializationInstrumentation.withSerializationGroup('CertificationRegistry', () =>
    normalizeRegistry(stateStore.loadJsonState(filePath, createEmptyCertificationArtifactRegistry()))
  );
}

function saveCertificationArtifactRegistry(filePath = DEFAULT_REGISTRY_PATH, registry = createEmptyCertificationArtifactRegistry()) {
  return serializationInstrumentation.withSerializationGroup('CertificationRegistry', () =>
    stateStore.saveJsonState(filePath, normalizeRegistry(registry))
  );
}

function loadArtifactFromEntry(entry = {}) {
  if (entry.artifact && typeof entry.artifact === 'object') return clone(entry.artifact);
  if (entry.artifactPath) {
    return loadIntegrityHelpers().validateCertificationArtifactIntegrity
      ? require('node:fs').existsSync(entry.artifactPath)
        ? JSON.parse(require('node:fs').readFileSync(entry.artifactPath, 'utf8'))
        : {}
      : {};
  }
  return {};
}

function createCertificationArtifactRegistryEntry(certificationArtifact = {}, options = {}) {
  const artifact = clone(certificationArtifact);
  const artifactAdapter = getArtifactAdapter(artifact);
  const adapter = {
    sourceId: options.sourceId || artifactAdapter.sourceId || null,
    marketplace: options.marketplace || artifactAdapter.marketplace || null,
    adapterName: options.adapterName || artifactAdapter.adapterName || null,
    adapterVersion: options.adapterVersion || artifactAdapter.adapterVersion || null,
    interfaceVersion: options.interfaceVersion || artifactAdapter.interfaceVersion || null
  };
  const { immutableFingerprint } = loadIntegrityHelpers();
  const artifactFingerprint = options.artifactFingerprint || immutableFingerprint(artifact);
  const now = options.registeredAt || new Date().toISOString();
  const entry = {
    schemaVersion: REGISTRY_VERSION,
    source: SOURCE,
    version: REGISTRY_VERSION,
    id: options.id || buildRegistryEntryId(adapter),
    sourceId: adapter.sourceId,
    marketplace: adapter.marketplace,
    adapterName: adapter.adapterName,
    adapterVersion: adapter.adapterVersion,
    interfaceVersion: adapter.interfaceVersion,
    artifactFingerprint,
    artifactPath: options.artifactPath || null,
    artifact: options.storeArtifact === false ? null : artifact,
    approvalStatus: normalizeApprovalStatus(options.approvalStatus, artifact),
    registeredAt: now,
    registeredBy: options.registeredBy || null,
    validFrom: normalizeDate(options.validFrom || artifact.generatedAt) || null,
    validUntil: normalizeDate(options.validUntil || artifact.expiresAt) || null,
    revoked: options.revoked === true || artifact.revoked === true || artifact.status === 'revoked',
    revokedAt: normalizeDate(options.revokedAt || artifact.revokedAt) || null,
    revocationReason: options.revocationReason || artifact.revocationReason || '',
    notes: options.notes || '',
    metadata: asObject(options.metadata)
  };

  entry.integrity = {
    fingerprint: buildRegistryEntryFingerprint(entry),
    artifactFingerprint,
    generatedAt: now
  };

  return entry;
}

function validateRegistryEntry(entry = {}, options = {}) {
  const input = asObject(entry);
  const reasons = [];
  const warnings = [];
  const checks = {
    requiredFields: [],
    adapter: [],
    artifact: [],
    lifecycle: [],
    integrity: []
  };
  const now = options.now ? new Date(options.now) : new Date();
  const adapterMetadata = asObject(options.adapterMetadata);

  for (const field of ['id', 'sourceId', 'adapterName', 'adapterVersion', 'artifactFingerprint', 'approvalStatus']) {
    if (!input[field]) checks.requiredFields.push(`missing_registry_${field}`);
  }

  if (Object.keys(adapterMetadata).length) {
    for (const field of ['sourceId', 'adapterName', 'adapterVersion']) {
      if (adapterMetadata[field] && input[field] !== adapterMetadata[field]) {
        checks.adapter.push(`registry_${field}_mismatch`);
      }
    }
  }

  if (input.approvalStatus !== APPROVAL_STATUS.PRODUCTION_APPROVED) {
    checks.lifecycle.push('registry_not_production_approved');
  }
  if (input.revoked === true || input.revokedAt || input.approvalStatus === APPROVAL_STATUS.REVOKED) {
    checks.lifecycle.push('registry_entry_revoked');
  }
  if (input.validFrom && new Date(input.validFrom) > now) {
    checks.lifecycle.push('registry_entry_not_yet_valid');
  }
  if (input.validUntil && new Date(input.validUntil) < now) {
    checks.lifecycle.push('registry_entry_expired');
  }

  if (input.integrity?.fingerprint) {
    const expected = buildRegistryEntryFingerprint(input);
    if (input.integrity.fingerprint !== expected) checks.integrity.push('registry_entry_fingerprint_mismatch');
  } else {
    warnings.push('missing_registry_entry_integrity_fingerprint_backwards_compatible');
  }

  const artifact = loadArtifactFromEntry(input);
  if (!Object.keys(artifact).length) {
    checks.artifact.push('missing_registry_certification_artifact');
  } else {
    const { immutableFingerprint, validateCertificationArtifactIntegrity } = loadIntegrityHelpers();
    const artifactFingerprint = immutableFingerprint(artifact);
    if (input.artifactFingerprint !== artifactFingerprint) {
      checks.artifact.push('registry_artifact_fingerprint_mismatch');
    }

    const artifactIntegrity = validateCertificationArtifactIntegrity(artifact, {
      adapterMetadata: Object.keys(adapterMetadata).length ? adapterMetadata : {
        sourceId: input.sourceId,
        adapterName: input.adapterName,
        adapterVersion: input.adapterVersion
      },
      expectedFingerprint: input.artifactFingerprint,
      now: options.now
    });
    checks.artifact.push(...artifactIntegrity.reasons.map((reason) => `artifact_${reason}`));
  }

  reasons.push(
    ...checks.requiredFields,
    ...checks.adapter,
    ...checks.artifact,
    ...checks.lifecycle,
    ...checks.integrity
  );

  return {
    ...createValidationResult({
      valid: reasons.length === 0,
      reasons,
      checks,
      metadata: {
        registryEntryId: input.id || null,
        artifactFingerprint: input.artifactFingerprint || null
      }
    }),
    source: SOURCE,
    version: REGISTRY_VERSION,
    artifactType: 'certification_registry_entry',
    valid: reasons.length === 0,
    reasons: unique(reasons),
    warnings,
    checks,
    entry: input,
    artifact,
    fingerprint: buildRegistryEntryFingerprint(input)
  };
}

function registerCertificationArtifact(registry = createEmptyCertificationArtifactRegistry(), certificationArtifact = {}, options = {}) {
  const nextRegistry = normalizeRegistry(clone(registry));
  const entry = createCertificationArtifactRegistryEntry(certificationArtifact, options);
  const validation = validateRegistryEntry(entry, {
    adapterMetadata: {
      sourceId: entry.sourceId,
      adapterName: entry.adapterName,
      adapterVersion: entry.adapterVersion
    },
    now: options.now
  });

  if (!validation.valid) {
    return {
      registered: false,
      registry: nextRegistry,
      entry,
      validation
    };
  }

  nextRegistry.entries[entry.id] = entry;
  nextRegistry.indexes.byAdapter[buildRegistryEntryId(entry)] = entry.id;
  nextRegistry.updatedAt = options.updatedAt || new Date().toISOString();
  refreshRegistryStats(nextRegistry);

  return {
    registered: true,
    registry: nextRegistry,
    entry,
    validation
  };
}

function resolveCertificationArtifactFromRegistry(registry = createEmptyCertificationArtifactRegistry(), adapterMetadata = {}, options = {}) {
  const normalized = normalizeRegistry(registry);
  const key = buildRegistryEntryId(adapterMetadata);
  const entryId = normalized.indexes.byAdapter[key] || key;
  const entry = normalized.entries[entryId] || null;

  if (!entry) {
    return {
      resolved: false,
      artifact: null,
      entry: null,
      reasons: ['certification_registry_entry_not_found'],
      validation: createValidationResult({
        valid: false,
        reasons: ['certification_registry_entry_not_found'],
        metadata: { registryKey: key }
      })
    };
  }

  const validation = validateRegistryEntry(entry, {
    adapterMetadata,
    now: options.now
  });

  return {
    resolved: validation.valid,
    artifact: validation.valid ? validation.artifact : null,
    entry,
    reasons: validation.reasons,
    validation
  };
}

function resolveCertificationArtifact(input = {}, options = {}) {
  const adapterMetadata = asObject(input.adapterMetadata || options.adapterMetadata);
  const registry = input.registry
    || options.registry
    || (input.registryPath || options.registryPath
      ? loadCertificationArtifactRegistry(input.registryPath || options.registryPath)
      : null);

  if (!registry) {
    return {
      resolved: false,
      artifact: null,
      entry: null,
      reasons: ['certification_registry_not_configured'],
      validation: createValidationResult({
        valid: false,
        reasons: ['certification_registry_not_configured']
      })
    };
  }

  return resolveCertificationArtifactFromRegistry(registry, adapterMetadata, options);
}

module.exports = {
  APPROVAL_STATUS,
  DEFAULT_REGISTRY_PATH,
  REGISTRY_VERSION,
  SOURCE,
  buildRegistryEntryFingerprint,
  buildRegistryEntryId,
  createCertificationArtifactRegistryEntry,
  createEmptyCertificationArtifactRegistry,
  loadCertificationArtifactRegistry,
  normalizeRegistry,
  registerCertificationArtifact,
  resolveCertificationArtifact,
  resolveCertificationArtifactFromRegistry,
  saveCertificationArtifactRegistry,
  stableStringify,
  validateRegistryEntry
};
