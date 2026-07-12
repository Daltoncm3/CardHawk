'use strict';

const {
  EVIDENCE_TYPES,
  normalizeAdapterRecord,
  normalizeCapabilities: normalizeSoldEvidenceCapabilities,
  summarizeEvidenceTypes
} = require('./soldEvidenceAdapter');
const {
  REQUIRED_ACQUISITION_PROVENANCE_FIELDS,
  REQUIRED_IDENTITY_FIELDS,
  REASON_CODES,
  createValidationResult,
  getIdentityValue,
  hasIdentitySubject
} = require('../validation/canonicalValidationCore');

const INTERFACE_VERSION = '1.0.0';
const SOURCE = 'canonical_acquisition_interface';

const ACCESS_MODES = {
  MANUAL_IMPORT: 'manual_import',
  LICENSED_FEED: 'licensed_feed',
  PARTNER_API: 'partner_api',
  OFFICIAL_API: 'official_api',
  OFFLINE_FIXTURE: 'offline_fixture',
  UNKNOWN: 'unknown'
};

const ADAPTER_STATUS = {
  READY: 'ready',
  DISABLED: 'disabled',
  UNCONFIGURED: 'unconfigured',
  DEGRADED: 'degraded',
  ERROR: 'error'
};

const DEFAULT_CAPABILITIES = {
  acquisitionInterfaceVersion: INTERFACE_VERSION,
  accessMode: ACCESS_MODES.UNKNOWN,
  sourceReliability: 'unknown',
  transactionLevelSoldSupport: false,
  aggregateMarketPriceSupport: false,
  activeContextSupport: false,
  acceptedBestOfferSupport: false,
  shippingSupport: false,
  certificationSupport: false,
  identityFields: [],
  provenanceFields: [],
  supportsIncrementalSync: false,
  supportsHistoricalBackfill: false,
  supportsHealthCheck: true,
  maxBatchSize: null,
  rateLimit: null,
  commercialUse: {
    permitted: false,
    requiresLicense: true,
    redistributionAllowed: false,
    displayAllowed: false,
    notes: ''
  }
};

const REQUIRED_PROVENANCE_FIELDS = REQUIRED_ACQUISITION_PROVENANCE_FIELDS;

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s/.-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeToken(value, fallback = 'unknown') {
  return normalizeText(value).replace(/\s+/g, '_') || fallback;
}

function normalizeDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeCommercialUse(value = {}) {
  const input = asObject(value);
  return {
    permitted: Boolean(input.permitted),
    requiresLicense: input.requiresLicense !== false,
    redistributionAllowed: Boolean(input.redistributionAllowed),
    displayAllowed: Boolean(input.displayAllowed),
    notes: input.notes || ''
  };
}

function normalizeAcquisitionCapabilities(capabilities = {}) {
  const soldEvidenceCapabilities = normalizeSoldEvidenceCapabilities(capabilities);

  return {
    ...DEFAULT_CAPABILITIES,
    ...soldEvidenceCapabilities,
    ...capabilities,
    acquisitionInterfaceVersion: capabilities.acquisitionInterfaceVersion || INTERFACE_VERSION,
    accessMode: capabilities.accessMode || DEFAULT_CAPABILITIES.accessMode,
    sourceReliability: capabilities.sourceReliability || DEFAULT_CAPABILITIES.sourceReliability,
    transactionLevelSoldSupport: Boolean(capabilities.transactionLevelSoldSupport),
    aggregateMarketPriceSupport: Boolean(capabilities.aggregateMarketPriceSupport),
    activeContextSupport: Boolean(capabilities.activeContextSupport),
    acceptedBestOfferSupport: Boolean(capabilities.acceptedBestOfferSupport),
    shippingSupport: Boolean(capabilities.shippingSupport),
    certificationSupport: Boolean(capabilities.certificationSupport),
    identityFields: asArray(capabilities.identityFields).map((field) => String(field)),
    provenanceFields: asArray(capabilities.provenanceFields).map((field) => String(field)),
    supportsIncrementalSync: Boolean(capabilities.supportsIncrementalSync),
    supportsHistoricalBackfill: Boolean(capabilities.supportsHistoricalBackfill),
    supportsHealthCheck: capabilities.supportsHealthCheck !== false,
    maxBatchSize: capabilities.maxBatchSize ?? null,
    rateLimit: capabilities.rateLimit || null,
    commercialUse: normalizeCommercialUse(capabilities.commercialUse)
  };
}

function createSourceMetadata(options = {}) {
  const capabilities = normalizeAcquisitionCapabilities(options.capabilities || {});
  const adapterName = options.adapterName || 'canonical_acquisition_adapter';
  const marketplace = normalizeToken(options.marketplace || options.sourceId || 'unknown');

  return {
    source: SOURCE,
    interfaceVersion: INTERFACE_VERSION,
    sourceId: options.sourceId || marketplace,
    marketplace,
    marketplaceLabel: options.marketplaceLabel || options.sourceName || options.marketplace || 'Unknown Source',
    sourceName: options.sourceName || options.marketplaceLabel || options.marketplace || 'Unknown Source',
    adapterName,
    adapterVersion: options.adapterVersion || '0.0.0',
    evidenceRole: 'canonical_sold_evidence_acquisition',
    capabilities
  };
}

function createAcquisitionRequest(input = {}) {
  const identity = asObject(input.identity || input.parsedIdentity || input.canonicalIdentity);

  return {
    requestId: input.requestId || null,
    query: input.query || '',
    canonicalCardKey: input.canonicalCardKey || null,
    identity,
    filters: asObject(input.filters),
    window: {
      dateFrom: normalizeDate(input.dateFrom || input.window?.dateFrom),
      dateTo: normalizeDate(input.dateTo || input.window?.dateTo)
    },
    limit: input.limit === undefined ? null : Number(input.limit),
    cursor: input.cursor || null,
    requestedEvidenceTypes: asArray(input.requestedEvidenceTypes).length
      ? asArray(input.requestedEvidenceTypes)
      : [EVIDENCE_TYPES.TRUE_SOLD],
    context: asObject(input.context)
  };
}

function validateAcquisitionRequest(request = {}) {
  const normalized = createAcquisitionRequest(request);
  const reasons = [];

  if (!normalized.query && !normalized.canonicalCardKey && !Object.keys(normalized.identity).length) {
    reasons.push('missing_query_or_identity');
  }

  if (normalized.limit !== null && (!Number.isFinite(normalized.limit) || normalized.limit < 0)) {
    reasons.push('invalid_limit');
  }

  return {
    valid: reasons.length === 0,
    reasons,
    request: normalized
  };
}

function validateRecordIdentity(record = {}) {
  const reasons = [];
  const identity = asObject(record.parsedIdentity || record.identity || record.parsed);

  for (const field of REQUIRED_IDENTITY_FIELDS) {
    if (!getIdentityValue(identity, field)) reasons.push(`${REASON_CODES.MISSING_IDENTITY_PREFIX}${field}`);
  }

  if (!hasIdentitySubject(identity)) {
    reasons.push(REASON_CODES.MISSING_IDENTITY_SUBJECT);
  }

  return {
    ...createValidationResult({ reasons }),
    valid: reasons.length === 0,
    reasons
  };
}

function validateRecordProvenance(record = {}, sourceMetadata = {}) {
  const reasons = [];
  const sourceInfo = {
    marketplace: record.marketplace || record.source?.marketplace || sourceMetadata.marketplace,
    adapter: record.source?.adapter || sourceMetadata.adapterName,
    retrievalMethod: record.source?.retrievalMethod || sourceMetadata.capabilities?.accessMode,
    sourceReliability: record.source?.sourceReliability || sourceMetadata.capabilities?.sourceReliability,
    acquiredAt: record.source?.acquiredAt || record.acquiredAt,
    sourceUrl: record.url || record.itemWebUrl || record.sourceUrl
  };

  for (const field of REQUIRED_PROVENANCE_FIELDS) {
    if (!sourceInfo[field]) reasons.push(`${REASON_CODES.MISSING_PROVENANCE_PREFIX}${field}`);
  }

  if (!normalizeDate(sourceInfo.acquiredAt)) reasons.push(`${REASON_CODES.INVALID_PROVENANCE_PREFIX}acquiredAt`);
  if (!sourceInfo.sourceUrl) reasons.push(`${REASON_CODES.MISSING_PROVENANCE_PREFIX}sourceUrl`);

  return {
    ...createValidationResult({ reasons }),
    valid: reasons.length === 0,
    reasons,
    provenance: sourceInfo
  };
}

function validateRawEvidenceRecord(record = {}, sourceMetadata = {}) {
  const reasons = [];
  const identity = validateRecordIdentity(record);
  const provenance = validateRecordProvenance(record, sourceMetadata);

  reasons.push(...identity.reasons, ...provenance.reasons);

  if ((record.evidenceType || 'true_sold') === EVIDENCE_TYPES.TRUE_SOLD) {
    const price = Number(record.soldPrice ?? record.salePrice ?? record.price ?? record.amount);
    if (!Number.isFinite(price) || price <= 0) reasons.push(REASON_CODES.MISSING_SOLD_PRICE);
    if (!normalizeDate(record.soldAt || record.dateSold || record.soldDate || record.endedAt || record.saleDate)) {
      reasons.push(REASON_CODES.MISSING_SOLD_DATE);
    }
  }

  return {
    ...createValidationResult({ reasons }),
    valid: reasons.length === 0,
    reasons,
    identity,
    provenance
  };
}

function createAcquisitionError(error, context = {}) {
  if (error && typeof error === 'object' && !(error instanceof Error)) {
    return {
      code: context.code || error.code || 'acquisition_error',
      message: error.message || String(error.code || 'Unknown acquisition error'),
      adapterName: context.adapterName || error.adapterName || null,
      sourceId: context.sourceId || error.sourceId || null,
      retryable: Boolean(context.retryable || error.retryable),
      occurredAt: context.occurredAt || error.occurredAt || new Date().toISOString()
    };
  }

  const input = error instanceof Error ? error : new Error(String(error || 'Unknown acquisition error'));

  return {
    code: context.code || input.code || 'acquisition_error',
    message: input.message,
    adapterName: context.adapterName || null,
    sourceId: context.sourceId || null,
    retryable: Boolean(context.retryable),
    occurredAt: context.occurredAt || new Date().toISOString()
  };
}

function normalizeAcquisitionResult(result = {}, sourceMetadata = {}) {
  const rawRecords = asArray(result.records);
  const records = rawRecords.map((record) => normalizeAdapterRecord(record, {
    marketplace: sourceMetadata.marketplace,
    marketplaceLabel: sourceMetadata.marketplaceLabel,
    sourceName: sourceMetadata.sourceName,
    adapterName: sourceMetadata.adapterName,
    capabilities: sourceMetadata.capabilities
  }, {
    retrievalMethod: sourceMetadata.capabilities.accessMode,
    includeRawRecord: Boolean(result.includeRawRecord)
  }));
  const validation = records.map((record) => ({
    id: record.id,
    evidenceType: record.evidenceType,
    ...validateRawEvidenceRecord(record, sourceMetadata)
  }));

  return {
    source: { ...sourceMetadata },
    request: result.request ? createAcquisitionRequest(result.request) : null,
    records,
    validation,
    errors: asArray(result.errors).map((error) => createAcquisitionError(error, {
      adapterName: sourceMetadata.adapterName,
      sourceId: sourceMetadata.sourceId
    })),
    warnings: asArray(result.warnings),
    metadata: asObject(result.metadata),
    cursor: result.cursor || null,
    acquiredAt: normalizeDate(result.acquiredAt) || new Date().toISOString(),
    summary: {
      ...summarizeEvidenceTypes(records),
      validRecordCount: validation.filter((entry) => entry.valid).length,
      invalidRecordCount: validation.filter((entry) => !entry.valid).length,
      errorCount: asArray(result.errors).length,
      warningCount: asArray(result.warnings).length
    }
  };
}

function createEmptyAcquisitionResult(sourceMetadata, request = {}, extra = {}) {
  return normalizeAcquisitionResult({
    request,
    records: [],
    warnings: extra.warnings || [],
    errors: extra.errors || []
  }, sourceMetadata);
}

function createCanonicalAcquisitionAdapter(options = {}) {
  const sourceMetadata = createSourceMetadata(options);
  const acquire = typeof options.acquire === 'function' ? options.acquire : null;
  const healthCheck = typeof options.healthCheck === 'function' ? options.healthCheck : null;

  return {
    ...sourceMetadata,

    getCapabilities() {
      return {
        sourceId: sourceMetadata.sourceId,
        marketplace: sourceMetadata.marketplace,
        adapterName: sourceMetadata.adapterName,
        adapterVersion: sourceMetadata.adapterVersion,
        capabilities: { ...sourceMetadata.capabilities }
      };
    },

    async getStatus() {
      if (!healthCheck) {
        return {
          sourceId: sourceMetadata.sourceId,
          adapterName: sourceMetadata.adapterName,
          status: ADAPTER_STATUS.UNCONFIGURED,
          checkedAt: new Date().toISOString(),
          message: 'No health check configured for acquisition adapter.'
        };
      }

      try {
        return {
          sourceId: sourceMetadata.sourceId,
          adapterName: sourceMetadata.adapterName,
          status: ADAPTER_STATUS.READY,
          checkedAt: new Date().toISOString(),
          ...(await healthCheck())
        };
      } catch (error) {
        return {
          sourceId: sourceMetadata.sourceId,
          adapterName: sourceMetadata.adapterName,
          status: ADAPTER_STATUS.ERROR,
          checkedAt: new Date().toISOString(),
          error: createAcquisitionError(error, sourceMetadata)
        };
      }
    },

    normalizeRecord(record, normalizeOptions = {}) {
      return normalizeAdapterRecord(record, {
        marketplace: sourceMetadata.marketplace,
        marketplaceLabel: sourceMetadata.marketplaceLabel,
        sourceName: sourceMetadata.sourceName,
        adapterName: sourceMetadata.adapterName,
        capabilities: sourceMetadata.capabilities
      }, {
        retrievalMethod: normalizeOptions.retrievalMethod || sourceMetadata.capabilities.accessMode,
        includeRawRecord: Boolean(normalizeOptions.includeRawRecord)
      });
    },

    async acquireSoldEvidence(request = {}, options = {}) {
      const requestValidation = validateAcquisitionRequest(request);

      if (!requestValidation.valid) {
        return createEmptyAcquisitionResult(sourceMetadata, requestValidation.request, {
          errors: requestValidation.reasons.map((reason) => ({
            code: reason,
            message: reason
          }))
        });
      }

      if (!acquire) {
        return createEmptyAcquisitionResult(sourceMetadata, requestValidation.request, {
          warnings: ['adapter_has_no_acquisition_implementation']
        });
      }

      try {
        const result = await acquire(requestValidation.request, options);
        return normalizeAcquisitionResult({
          ...result,
          request: result?.request || requestValidation.request
        }, sourceMetadata);
      } catch (error) {
        return createEmptyAcquisitionResult(sourceMetadata, requestValidation.request, {
          errors: [createAcquisitionError(error, {
            adapterName: sourceMetadata.adapterName,
            sourceId: sourceMetadata.sourceId,
            retryable: true
          })]
        });
      }
    }
  };
}

function assertAdapterContract(adapter = {}) {
  const reasons = [];

  if (!adapter.sourceId) reasons.push('missing_sourceId');
  if (!adapter.adapterName) reasons.push('missing_adapterName');
  if (typeof adapter.getCapabilities !== 'function') reasons.push('missing_getCapabilities');
  if (typeof adapter.getStatus !== 'function') reasons.push('missing_getStatus');
  if (typeof adapter.acquireSoldEvidence !== 'function') reasons.push('missing_acquireSoldEvidence');
  if (typeof adapter.normalizeRecord !== 'function') reasons.push('missing_normalizeRecord');

  return {
    valid: reasons.length === 0,
    reasons
  };
}

function createAcquisitionRegistry() {
  const adapters = new Map();

  return {
    registerAdapter(adapter) {
      const contract = assertAdapterContract(adapter);
      if (!contract.valid) {
        return {
          registered: false,
          reasons: contract.reasons
        };
      }

      adapters.set(adapter.sourceId, adapter);
      return {
        registered: true,
        sourceId: adapter.sourceId,
        adapterName: adapter.adapterName
      };
    },

    unregisterAdapter(sourceId) {
      return adapters.delete(sourceId);
    },

    getAdapter(sourceId) {
      return adapters.get(sourceId) || null;
    },

    listAdapters() {
      return [...adapters.values()].map((adapter) => adapter.getCapabilities());
    },

    async getStatuses() {
      const statuses = [];
      for (const adapter of adapters.values()) {
        statuses.push(await adapter.getStatus());
      }
      return statuses;
    },

    async acquire(sourceId, request = {}, options = {}) {
      const adapter = adapters.get(sourceId);
      if (!adapter) {
        return {
          source: null,
          request: createAcquisitionRequest(request),
          records: [],
          validation: [],
          errors: [createAcquisitionError(`Unknown acquisition adapter: ${sourceId}`, {
            code: 'unknown_adapter',
            sourceId
          })],
          warnings: [],
          cursor: null,
          acquiredAt: new Date().toISOString(),
          summary: {
            returned: 0,
            trueSoldCount: 0,
            aggregateMarketPriceCount: 0,
            activeContextCount: 0,
            validRecordCount: 0,
            invalidRecordCount: 0,
            errorCount: 1,
            warningCount: 0
          }
        };
      }

      return adapter.acquireSoldEvidence(request, options);
    }
  };
}

module.exports = {
  ACCESS_MODES,
  ADAPTER_STATUS,
  DEFAULT_CAPABILITIES,
  EVIDENCE_TYPES,
  INTERFACE_VERSION,
  REQUIRED_IDENTITY_FIELDS,
  REQUIRED_PROVENANCE_FIELDS,
  SOURCE,
  assertAdapterContract,
  createAcquisitionError,
  createAcquisitionRegistry,
  createAcquisitionRequest,
  createCanonicalAcquisitionAdapter,
  createEmptyAcquisitionResult,
  createSourceMetadata,
  normalizeAcquisitionCapabilities,
  normalizeAcquisitionResult,
  validateAcquisitionRequest,
  validateRawEvidenceRecord,
  validateRecordIdentity,
  validateRecordProvenance
};
