'use strict';

const { normalizeSoldEvidenceRecord } = require('../utils/soldEvidenceStore');

const EVIDENCE_TYPES = {
  TRUE_SOLD: 'true_sold',
  AGGREGATE_MARKET_PRICE: 'aggregate_market_price',
  ACTIVE_CONTEXT: 'active_context'
};

const DEFAULT_CAPABILITIES = {
  transactionLevelSoldSupport: false,
  acceptedBestOfferSupport: false,
  shippingSupport: false,
  certificationSupport: false,
  aggregateMarketPriceSupport: false,
  activeContextSupport: false,
  accessMode: 'offline',
  sourceReliability: 'unknown'
};

function normalizeEvidenceType(value) {
  const normalized = String(value || '').toLowerCase().replace(/[\s-]+/g, '_');

  if (normalized === EVIDENCE_TYPES.TRUE_SOLD || normalized === 'sold' || normalized === 'completed_sale') {
    return EVIDENCE_TYPES.TRUE_SOLD;
  }
  if (normalized === EVIDENCE_TYPES.AGGREGATE_MARKET_PRICE || normalized === 'aggregate' || normalized === 'market_price') {
    return EVIDENCE_TYPES.AGGREGATE_MARKET_PRICE;
  }
  if (normalized === EVIDENCE_TYPES.ACTIVE_CONTEXT || normalized === 'active' || normalized === 'active_listing') {
    return EVIDENCE_TYPES.ACTIVE_CONTEXT;
  }

  return EVIDENCE_TYPES.ACTIVE_CONTEXT;
}

function normalizeCapabilities(capabilities = {}) {
  return {
    ...DEFAULT_CAPABILITIES,
    ...capabilities,
    transactionLevelSoldSupport: Boolean(capabilities.transactionLevelSoldSupport),
    acceptedBestOfferSupport: Boolean(capabilities.acceptedBestOfferSupport),
    shippingSupport: Boolean(capabilities.shippingSupport),
    certificationSupport: Boolean(capabilities.certificationSupport),
    aggregateMarketPriceSupport: Boolean(capabilities.aggregateMarketPriceSupport),
    activeContextSupport: Boolean(capabilities.activeContextSupport),
    accessMode: capabilities.accessMode || DEFAULT_CAPABILITIES.accessMode,
    sourceReliability: capabilities.sourceReliability || DEFAULT_CAPABILITIES.sourceReliability
  };
}

function createSourceMetadata(options = {}) {
  const capabilities = normalizeCapabilities(options.capabilities);

  return {
    marketplace: options.marketplace || 'unknown',
    marketplaceLabel: options.marketplaceLabel || options.marketplace || 'Unknown Source',
    sourceName: options.sourceName || options.marketplaceLabel || options.marketplace || 'unknown',
    adapterName: options.adapterName || 'sold_evidence_adapter',
    capabilities
  };
}

function coerceEvidenceTypeForCapabilities(evidenceType, capabilities) {
  if (evidenceType === EVIDENCE_TYPES.TRUE_SOLD && !capabilities.transactionLevelSoldSupport) {
    return capabilities.aggregateMarketPriceSupport
      ? EVIDENCE_TYPES.AGGREGATE_MARKET_PRICE
      : EVIDENCE_TYPES.ACTIVE_CONTEXT;
  }

  return evidenceType;
}

function normalizeAdapterRecord(rawRecord = {}, sourceMetadata = {}, options = {}) {
  const capabilities = normalizeCapabilities(sourceMetadata.capabilities);
  const requestedEvidenceType = normalizeEvidenceType(rawRecord.evidenceType || rawRecord.recordType || options.evidenceType);
  const evidenceType = coerceEvidenceTypeForCapabilities(requestedEvidenceType, capabilities);
  const normalized = normalizeSoldEvidenceRecord({
    ...rawRecord,
    marketplace: rawRecord.marketplace || sourceMetadata.marketplace,
    marketplaceLabel: rawRecord.marketplaceLabel || sourceMetadata.marketplaceLabel,
    source: {
      ...(rawRecord.source || {}),
      adapter: sourceMetadata.adapterName,
      retrievalMethod: rawRecord.source?.retrievalMethod || options.retrievalMethod || capabilities.accessMode,
      sourceReliability: rawRecord.source?.sourceReliability || capabilities.sourceReliability
    }
  }, {
    adapter: sourceMetadata.adapterName,
    retrievalMethod: options.retrievalMethod || capabilities.accessMode,
    sourceReliability: capabilities.sourceReliability,
    includeRawRecord: Boolean(options.includeRawRecord)
  });

  return {
    ...normalized,
    evidenceType,
    evidenceRole: evidenceType,
    status: evidenceType === EVIDENCE_TYPES.TRUE_SOLD ? 'active_evidence' : 'context_only',
    source: {
      ...normalized.source,
      marketplace: sourceMetadata.marketplace,
      sourceName: sourceMetadata.sourceName,
      capabilities: { ...capabilities }
    },
    warnings: [
      ...(normalized.warnings || []),
      ...(requestedEvidenceType === EVIDENCE_TYPES.TRUE_SOLD && evidenceType !== EVIDENCE_TYPES.TRUE_SOLD
        ? ['source_without_transaction_level_sold_support']
        : [])
    ],
    translationWarnings: Array.isArray(rawRecord.translationWarnings) ? [...rawRecord.translationWarnings] : []
  };
}

function createSoldEvidenceAdapter(options = {}) {
  const sourceMetadata = createSourceMetadata(options);

  return {
    ...sourceMetadata,

    async searchSoldEvidence() {
      return {
        source: sourceMetadata,
        records: [],
        summary: {
          returned: 0,
          trueSoldCount: 0,
          aggregateMarketPriceCount: 0,
          activeContextCount: 0
        }
      };
    },

    normalizeRecord(record, normalizeOptions = {}) {
      return normalizeAdapterRecord(record, sourceMetadata, normalizeOptions);
    }
  };
}

function summarizeEvidenceTypes(records = []) {
  return records.reduce((summary, record) => {
    if (record.evidenceType === EVIDENCE_TYPES.TRUE_SOLD) summary.trueSoldCount += 1;
    if (record.evidenceType === EVIDENCE_TYPES.AGGREGATE_MARKET_PRICE) summary.aggregateMarketPriceCount += 1;
    if (record.evidenceType === EVIDENCE_TYPES.ACTIVE_CONTEXT) summary.activeContextCount += 1;
    summary.returned += 1;
    return summary;
  }, {
    returned: 0,
    trueSoldCount: 0,
    aggregateMarketPriceCount: 0,
    activeContextCount: 0
  });
}

module.exports = {
  EVIDENCE_TYPES,
  DEFAULT_CAPABILITIES,
  createSoldEvidenceAdapter,
  createSourceMetadata,
  normalizeAdapterRecord,
  normalizeCapabilities,
  normalizeEvidenceType,
  summarizeEvidenceTypes
};
