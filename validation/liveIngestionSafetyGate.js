'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const {
  addSoldEvidenceRecord,
  createEmptySoldEvidenceStore,
  normalizeSoldEvidenceRecord
} = require('../utils/soldEvidenceStore');
const {
  CERTIFICATION_LEVELS,
  CERTIFICATION_STANDARD_VERSION,
  SOURCE: CERTIFICATION_SOURCE
} = require('./marketplaceAdapterCertification');
const {
  validateCanonicalRecord
} = require('./soldEvidenceStoreConformance');

const GATE_VERSION = '1.0.0';
const SOURCE = 'canonical_live_ingestion_safety_gate';

const FAILURE_CLASSIFICATIONS = {
  RETRYABLE: 'retryable',
  TERMINAL: 'terminal',
  PARTIAL: 'partial',
  DEGRADED: 'degraded',
  RATE_LIMITED: 'rate_limited'
};

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function fingerprint(value = {}) {
  return crypto
    .createHash('sha256')
    .update(stableStringify(value))
    .digest('hex');
}

function createIngestionRunId(input = {}) {
  if (input.runId) return input.runId;
  const seed = {
    adapterName: input.adapterName || null,
    adapterVersion: input.adapterVersion || null,
    sourceId: input.sourceId || null,
    requestedAt: input.requestedAt || new Date().toISOString(),
    requestFingerprint: input.requestFingerprint || null,
    responseFingerprint: input.responseFingerprint || null
  };

  return `ingest_${seed.requestedAt.replace(/[^0-9]/g, '').slice(0, 14)}_${fingerprint(seed).slice(0, 12)}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value || null));
}

function getAdapterMetadata(adapter = {}, acquisitionResult = {}) {
  const source = asObject(acquisitionResult.source);
  return {
    sourceId: adapter.sourceId || source.sourceId || null,
    marketplace: adapter.marketplace || source.marketplace || null,
    adapterName: adapter.adapterName || source.adapterName || null,
    adapterVersion: adapter.adapterVersion || source.adapterVersion || null,
    interfaceVersion: adapter.interfaceVersion || source.interfaceVersion || null
  };
}

function classifyFailure(error = {}) {
  const code = String(error.code || error.statusCode || error.status || '').toLowerCase();
  const message = String(error.message || '').toLowerCase();
  const status = Number(error.statusCode || error.status || 0);

  if (status === 429 || code.includes('rate') || message.includes('rate limit')) {
    return FAILURE_CLASSIFICATIONS.RATE_LIMITED;
  }
  if (code.includes('partial') || message.includes('partial')) {
    return FAILURE_CLASSIFICATIONS.PARTIAL;
  }
  if (code.includes('degraded') || message.includes('degraded')) {
    return FAILURE_CLASSIFICATIONS.DEGRADED;
  }
  if (error.retryable === true || code.includes('timeout') || code.includes('temporar') || status >= 500) {
    return FAILURE_CLASSIFICATIONS.RETRYABLE;
  }
  return FAILURE_CLASSIFICATIONS.TERMINAL;
}

function summarizeFailures(errors = []) {
  const classifications = {
    retryable: 0,
    terminal: 0,
    partial: 0,
    degraded: 0,
    rate_limited: 0
  };
  const failures = asArray(errors).map((error) => {
    const classification = classifyFailure(error);
    classifications[classification] += 1;
    return {
      code: error.code || 'acquisition_error',
      message: error.message || '',
      retryable: Boolean(error.retryable),
      statusCode: error.statusCode || error.status || null,
      classification
    };
  });

  return {
    failures,
    classifications
  };
}

function validateCertificationArtifact(certificationArtifact = {}, adapterMetadata = {}) {
  const reasons = [];
  const artifact = asObject(certificationArtifact);
  const artifactAdapter = asObject(artifact.adapter);
  const standard = asObject(artifact.standard);
  const requirements = asArray(artifact.requirements);
  const productionRequirement = requirements.find((requirement) => requirement.name === 'production_approval_recorded');

  if (!Object.keys(artifact).length) reasons.push('missing_certification_artifact');
  if (artifact.source !== CERTIFICATION_SOURCE) reasons.push('invalid_certification_source');
  if (artifact.version !== CERTIFICATION_STANDARD_VERSION) reasons.push('certification_standard_version_mismatch');
  if (artifact.certificationLevel !== CERTIFICATION_LEVELS.PRODUCTION_APPROVED) reasons.push('certification_not_production_approved');
  if (artifact.productionApproved !== true) reasons.push('production_approval_flag_missing');
  if (artifact.passed !== true) reasons.push('certification_not_passed');
  if (!standard.version) reasons.push('missing_certification_standard');
  if (!artifact.generatedAt) reasons.push('missing_certification_generatedAt');
  if (productionRequirement && productionRequirement.pass !== true) reasons.push('production_approval_requirement_not_passed');
  if (!productionRequirement) reasons.push('missing_production_approval_requirement');

  for (const field of ['sourceId', 'adapterName', 'adapterVersion']) {
    if (!adapterMetadata[field]) reasons.push(`missing_adapter_${field}`);
    if (artifactAdapter[field] !== adapterMetadata[field]) {
      reasons.push(`adapter_${field}_mismatch`);
    }
  }

  return {
    valid: reasons.length === 0,
    reasons,
    fingerprint: fingerprint(artifact),
    artifact: {
      source: artifact.source || null,
      version: artifact.version || null,
      certificationLevel: artifact.certificationLevel || null,
      productionApproved: artifact.productionApproved === true,
      generatedAt: artifact.generatedAt || null,
      adapter: artifactAdapter
    }
  };
}

function validateSourcePermission(sourcePermission = {}) {
  const input = asObject(sourcePermission);
  const license = asObject(input.license);
  const reasons = [];

  if (!input.status) reasons.push('missing_source_permission_status');
  if (input.status !== 'approved') reasons.push('source_permission_not_approved');
  if (!input.approvedBy) reasons.push('missing_source_permission_approvedBy');
  if (!input.approvedAt) reasons.push('missing_source_permission_approvedAt');
  if (!license.id) reasons.push('missing_license_id');
  if (license.commercialUsePermitted !== true) reasons.push('commercial_use_not_permitted');
  if (!license.evidenceUse) reasons.push('missing_license_evidence_use');

  return {
    valid: reasons.length === 0,
    reasons,
    status: input.status || 'unknown',
    license: {
      id: license.id || null,
      commercialUsePermitted: license.commercialUsePermitted === true,
      evidenceUse: license.evidenceUse || null,
      displayAllowed: license.displayAllowed === true,
      redistributionAllowed: license.redistributionAllowed === true,
      notes: license.notes || ''
    }
  };
}

function buildAcquisitionMethodMetadata(options = {}) {
  const method = asObject(options.acquisitionMethod);
  const reasons = [];

  if (!method.name) reasons.push('missing_acquisition_method_name');
  if (!method.version) reasons.push('missing_acquisition_method_version');

  return {
    valid: reasons.length === 0,
    reasons,
    name: method.name || 'unknown',
    version: method.version || null,
    mode: method.mode || 'offline_live_ready',
    notes: method.notes || ''
  };
}

function reasonStage(reason = '') {
  if (reason.startsWith('missing_identity_') || reason === 'canonical_card_key_mismatch') return 'identity';
  if (reason.startsWith('missing_source_') || reason.startsWith('invalid_source_')) return 'provenance';
  if (reason === 'not_true_sold_evidence' || reason === 'inactive_or_context_record') return 'evidence_type';
  if (reason === 'missing_sold_price' || reason === 'missing_sold_date' || reason === 'undisclosed_best_offer_price') return 'transaction';
  if (reason.startsWith('missing_schema_')) return 'schema';
  return 'store_compatibility';
}

function buildRejectedRecord(record = {}, details = {}) {
  const reasons = asArray(details.reasons);
  return {
    runId: details.runId || null,
    recordIndex: details.recordIndex ?? null,
    recordId: record.id || record.marketplaceSaleId || record.marketplaceListingId || record.url || null,
    canonicalCardKey: record.canonicalCardKey || null,
    marketplace: record.marketplace || null,
    evidenceType: record.evidenceType || null,
    classification: details.classification || FAILURE_CLASSIFICATIONS.TERMINAL,
    failureStages: [...new Set(reasons.map(reasonStage))],
    reasons,
    duplicateOf: details.duplicateOf || null,
    requestFingerprint: details.requestFingerprint || null,
    responseFingerprint: details.responseFingerprint || null
  };
}

function validateRecordForAdmission(record = {}, context = {}) {
  const normalized = normalizeSoldEvidenceRecord(record, {
    adapter: context.adapterName,
    retrievalMethod: context.acquisitionMethod?.name,
    sourceReliability: context.sourceReliability,
    acquiredAt: context.acquiredAt
  });
  const canonical = validateCanonicalRecord(normalized);
  const reasons = [...canonical.reasons];

  if (!context.certificationValid) reasons.push('certification_gate_failed');
  if (!context.sourcePermissionValid) reasons.push('source_permission_gate_failed');
  if (!context.acquisitionMethodValid) reasons.push('acquisition_method_gate_failed');

  return {
    valid: reasons.length === 0,
    reasons,
    normalized,
    canonicalValidation: canonical
  };
}

function writeJsonFile(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

function persistRunArtifacts(outputDir, manifest, quarantine) {
  if (!outputDir) {
    return {
      persisted: false,
      manifestPath: null,
      quarantinePath: null
    };
  }

  const runDir = path.join(outputDir, manifest.runId);
  const manifestPath = path.join(runDir, 'manifest.json');
  const quarantinePath = path.join(runDir, 'quarantine.json');

  writeJsonFile(manifestPath, manifest);
  writeJsonFile(quarantinePath, quarantine);

  return {
    persisted: true,
    manifestPath,
    quarantinePath
  };
}

function buildManifestSkeleton(input = {}) {
  return {
    source: SOURCE,
    version: GATE_VERSION,
    runId: input.runId,
    createdAt: input.createdAt,
    dryRun: input.dryRun,
    storeWritesEnabled: input.storeWritesEnabled,
    adapter: input.adapter,
    certification: input.certification,
    sourcePermission: input.sourcePermission,
    acquisitionMethod: input.acquisitionMethod,
    fingerprints: input.fingerprints,
    summary: input.summary,
    partialFailures: input.partialFailures,
    batch: input.batch,
    artifacts: {
      manifestPath: null,
      quarantinePath: null
    }
  };
}

function runLiveIngestionSafetyGate(input = {}, options = {}) {
  const adapter = asObject(input.adapter || options.adapter);
  const acquisitionResult = asObject(input.acquisitionResult || options.acquisitionResult);
  const records = asArray(acquisitionResult.records);
  const adapterMetadata = getAdapterMetadata(adapter, acquisitionResult);
  const createdAt = options.createdAt || new Date().toISOString();
  const requestFingerprint = fingerprint(acquisitionResult.request || {});
  const responseFingerprint = fingerprint({
    records: acquisitionResult.records || [],
    errors: acquisitionResult.errors || [],
    warnings: acquisitionResult.warnings || [],
    summary: acquisitionResult.summary || {}
  });
  const runId = createIngestionRunId({
    runId: options.runId,
    requestedAt: createdAt,
    ...adapterMetadata,
    requestFingerprint,
    responseFingerprint
  });
  const dryRun = options.dryRun !== false;
  const allowStoreWrite = options.allowStoreWrite === true;
  const storeWritesEnabled = !dryRun && allowStoreWrite;
  const certification = validateCertificationArtifact(input.certificationArtifact || options.certificationArtifact, adapterMetadata);
  const sourcePermission = validateSourcePermission(input.sourcePermission || options.sourcePermission);
  const acquisitionMethod = buildAcquisitionMethodMetadata(options);
  const failureSummary = summarizeFailures(acquisitionResult.errors || []);
  const startingStore = input.store || options.store || createEmptySoldEvidenceStore();
  let workingStore = clone(startingStore);
  const admittedRecords = [];
  const rejectedRecords = [];
  const insertionResults = [];
  const context = {
    adapterName: adapterMetadata.adapterName,
    sourceReliability: acquisitionResult.source?.capabilities?.sourceReliability || 'live_ingestion_gate',
    acquiredAt: createdAt,
    acquisitionMethod,
    certificationValid: certification.valid,
    sourcePermissionValid: sourcePermission.valid,
    acquisitionMethodValid: acquisitionMethod.valid
  };

  records.forEach((record, recordIndex) => {
    const admission = validateRecordForAdmission(record, context);

    if (!admission.valid) {
      rejectedRecords.push(buildRejectedRecord(admission.normalized, {
        runId,
        recordIndex,
        reasons: admission.reasons,
        requestFingerprint,
        responseFingerprint
      }));
      insertionResults.push({
        recordIndex,
        inserted: false,
        duplicate: false,
        rejected: true,
        reasons: admission.reasons
      });
      return;
    }

    const insertion = addSoldEvidenceRecord(workingStore, admission.normalized, {
      mutate: false,
      adapter: adapterMetadata.adapterName,
      retrievalMethod: acquisitionMethod.name,
      sourceReliability: context.sourceReliability,
      acquiredAt: createdAt
    });

    if (insertion.duplicate) {
      rejectedRecords.push(buildRejectedRecord(admission.normalized, {
        runId,
        recordIndex,
        reasons: ['duplicate_sold_evidence_record'],
        duplicateOf: insertion.duplicateOf,
        requestFingerprint,
        responseFingerprint
      }));
      insertionResults.push({
        recordIndex,
        inserted: false,
        duplicate: true,
        duplicateOf: insertion.duplicateOf,
        rejected: true,
        reasons: ['duplicate_sold_evidence_record']
      });
      return;
    }

    workingStore = insertion.store;
    admittedRecords.push(admission.normalized);
    insertionResults.push({
      recordIndex,
      id: insertion.record.id,
      inserted: storeWritesEnabled,
      wouldInsert: !storeWritesEnabled,
      duplicate: false,
      rejected: false,
      reasons: []
    });
  });

  const gateReasons = [
    ...certification.reasons,
    ...sourcePermission.reasons,
    ...acquisitionMethod.reasons
  ];
  const summary = {
    receivedRecords: records.length,
    admittedRecords: admittedRecords.length,
    rejectedRecords: rejectedRecords.length,
    duplicateRecords: rejectedRecords.filter((record) => record.reasons.includes('duplicate_sold_evidence_record')).length,
    partialFailures: failureSummary.failures.length,
    dryRun,
    storeWritesEnabled,
    wroteToStore: storeWritesEnabled && admittedRecords.length > 0,
    productionStoreWrites: false,
    certificationApproved: certification.valid,
    sourcePermissionApproved: sourcePermission.valid,
    acquisitionMethodValid: acquisitionMethod.valid,
    gatePassed: gateReasons.length === 0,
    gateReasons
  };
  const fingerprints = {
    request: requestFingerprint,
    response: responseFingerprint,
    certificationArtifact: certification.fingerprint,
    run: fingerprint({
      runId,
      adapter: adapterMetadata,
      requestFingerprint,
      responseFingerprint,
      certificationFingerprint: certification.fingerprint
    })
  };
  const batch = {
    insertionResults,
    warnings: asArray(acquisitionResult.warnings),
    errorCount: asArray(acquisitionResult.errors).length,
    warningCount: asArray(acquisitionResult.warnings).length,
    failureClassifications: failureSummary.classifications
  };
  const manifest = buildManifestSkeleton({
    runId,
    createdAt,
    dryRun,
    storeWritesEnabled,
    adapter: adapterMetadata,
    certification,
    sourcePermission,
    acquisitionMethod,
    fingerprints,
    summary,
    partialFailures: failureSummary.failures,
    batch
  });
  const quarantine = {
    source: `${SOURCE}_quarantine`,
    version: GATE_VERSION,
    runId,
    createdAt,
    rejectedRecords,
    summary: {
      rejectedRecords: rejectedRecords.length,
      duplicateRecords: summary.duplicateRecords,
      classifications: rejectedRecords.reduce((counts, record) => {
        counts[record.classification] = (counts[record.classification] || 0) + 1;
        return counts;
      }, {})
    }
  };
  const artifacts = persistRunArtifacts(options.outputDir, manifest, quarantine);
  manifest.artifacts = {
    manifestPath: artifacts.manifestPath,
    quarantinePath: artifacts.quarantinePath
  };

  if (artifacts.persisted) {
    writeJsonFile(artifacts.manifestPath, manifest);
  }

  return {
    source: SOURCE,
    version: GATE_VERSION,
    runId,
    dryRun,
    storeWritesEnabled,
    passed: summary.gatePassed && rejectedRecords.length === 0,
    manifest,
    quarantine,
    admittedRecords,
    rejectedRecords,
    nextStore: storeWritesEnabled ? workingStore : clone(startingStore),
    dryRunStorePreview: workingStore,
    artifacts
  };
}

module.exports = {
  FAILURE_CLASSIFICATIONS,
  GATE_VERSION,
  SOURCE,
  buildRejectedRecord,
  classifyFailure,
  createIngestionRunId,
  fingerprint,
  runLiveIngestionSafetyGate,
  stableStringify,
  summarizeFailures,
  validateCertificationArtifact,
  validateRecordForAdmission,
  validateSourcePermission
};
