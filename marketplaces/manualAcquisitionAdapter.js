'use strict';

const {
  ACCESS_MODES,
  ADAPTER_STATUS,
  createCanonicalAcquisitionAdapter
} = require('./canonicalAcquisitionInterface');
const {
  buildBatchValidationReport,
  loadBatchFile
} = require('../validation/soldEvidenceDatasetPilot');

const DEFAULT_SOURCE_ID = 'manual_dataset';
const DEFAULT_ADAPTER_NAME = 'manual_dataset_acquisition_adapter';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeBatchInput(input) {
  if (typeof input === 'string') return loadBatchFile(input);
  return {
    filePath: input.filePath || null,
    metadata: input.metadata || {},
    batchId: input.batchId || 'manual_batch',
    records: asArray(input.records)
  };
}

function loadManualBatches(batchInputs = []) {
  return asArray(batchInputs).map(normalizeBatchInput);
}

function recordMatchesRequest(record = {}, request = {}) {
  if (request.canonicalCardKey && record.canonicalCardKey && request.canonicalCardKey !== record.canonicalCardKey) {
    return false;
  }

  const query = String(request.query || '').toLowerCase().trim();
  const title = String(record.rawTitle || record.title || '').toLowerCase();
  const queryTokens = query.split(/\s+/).filter(Boolean);
  if (queryTokens.length && !queryTokens.every((token) => title.includes(token))) {
    return false;
  }

  return true;
}

function buildManualAcquisitionPayload(batchInputs = [], request = {}, options = {}) {
  const batches = loadManualBatches(batchInputs);
  const validationReport = buildBatchValidationReport(batches);
  const validRecords = [];
  const invalidRecordIds = new Set(
    validationReport.recordResults
      .filter((result) => !result.valid)
      .map((result) => `${result.batchId}:${result.recordIndex}`)
  );

  batches.forEach((batch) => {
    batch.records.forEach((record, recordIndex) => {
      const key = `${batch.batchId}:${recordIndex}`;
      if (!invalidRecordIds.has(key) && recordMatchesRequest(record, request)) {
        validRecords.push(record);
      }
    });
  });

  const limit = request.limit !== null && request.limit !== undefined && Number.isFinite(Number(request.limit)) && Number(request.limit) >= 0
    ? Number(request.limit)
    : validRecords.length;
  const records = validRecords.slice(0, limit);
  const warnings = [];

  if (validationReport.invalidRecords) {
    warnings.push('manual_batch_contains_invalid_records');
  }
  if (validationReport.duplicateSourceRecords.length) {
    warnings.push('manual_batch_contains_duplicate_source_records');
  }
  if (validationReport.duplicateSales.length) {
    warnings.push('manual_batch_contains_duplicate_sales');
  }
  if (options.includeRejectedRecords) {
    warnings.push('includeRejectedRecords_is_ignored_by_reference_adapter');
  }

  return {
    request,
    records,
    warnings,
    metadata: {
      validationReport,
      manualDataset: {
        source: 'manual_dataset_acquisition',
        batchCount: batches.length,
        receivedRecords: validationReport.receivedRecords,
        validRecords: validationReport.validRecords,
        invalidRecords: validationReport.invalidRecords,
        duplicateSourceRecordGroups: validationReport.duplicateSourceRecords.length,
        duplicateSaleGroups: validationReport.duplicateSales.length
      }
    }
  };
}

function createManualAcquisitionAdapter(options = {}) {
  const batchInputs = asArray(options.batchFiles).concat(asArray(options.batches));
  const adapter = createCanonicalAcquisitionAdapter({
    sourceId: options.sourceId || DEFAULT_SOURCE_ID,
    marketplace: options.marketplace || 'manual_dataset',
    marketplaceLabel: options.marketplaceLabel || 'Manual Dataset',
    sourceName: options.sourceName || 'Manual Canonical Sold Evidence Dataset',
    adapterName: options.adapterName || DEFAULT_ADAPTER_NAME,
    adapterVersion: options.adapterVersion || '1.0.0',
    capabilities: {
      accessMode: ACCESS_MODES.MANUAL_IMPORT,
      sourceReliability: 'verified_manual',
      transactionLevelSoldSupport: true,
      aggregateMarketPriceSupport: false,
      activeContextSupport: false,
      acceptedBestOfferSupport: true,
      shippingSupport: true,
      certificationSupport: true,
      identityFields: [
        'category',
        'sport',
        'game',
        'player',
        'character',
        'year',
        'brand',
        'product',
        'setName',
        'cardNumber',
        'parallel',
        'variation',
        'rookie',
        'autograph',
        'memorabilia',
        'serialNumbered'
      ],
      provenanceFields: [
        'marketplace',
        'adapter',
        'retrievalMethod',
        'sourceReliability',
        'acquiredAt',
        'sourceUrl',
        'reviewStatus',
        'reviewer',
        'reviewedAt'
      ],
      supportsIncrementalSync: true,
      supportsHistoricalBackfill: true,
      commercialUse: {
        permitted: true,
        requiresLicense: false,
        redistributionAllowed: false,
        displayAllowed: false,
        notes: 'Manual verified records are for internal CardHawk validation unless source terms say otherwise.'
      },
      ...options.capabilities
    },
    acquire: async (request, acquireOptions = {}) => buildManualAcquisitionPayload(
      acquireOptions.batchFiles || acquireOptions.batches || batchInputs,
      request,
      acquireOptions
    ),
    healthCheck: async () => {
      const batches = loadManualBatches(batchInputs);
      const validationReport = buildBatchValidationReport(batches);
      const status = batches.length ? ADAPTER_STATUS.READY : ADAPTER_STATUS.UNCONFIGURED;

      return {
        status,
        message: batches.length
          ? 'Manual dataset batches are configured.'
          : 'No manual dataset batches configured.',
        batchCount: batches.length,
        receivedRecords: validationReport.receivedRecords,
        validRecords: validationReport.validRecords,
        invalidRecords: validationReport.invalidRecords
      };
    }
  });

  return {
    ...adapter,

    loadBatches() {
      return loadManualBatches(batchInputs);
    },

    buildManualAcquisitionPayload(request = {}, acquireOptions = {}) {
      return buildManualAcquisitionPayload(
        acquireOptions.batchFiles || acquireOptions.batches || batchInputs,
        request,
        acquireOptions
      );
    }
  };
}

module.exports = {
  DEFAULT_ADAPTER_NAME,
  DEFAULT_SOURCE_ID,
  buildManualAcquisitionPayload,
  createManualAcquisitionAdapter,
  loadManualBatches,
  recordMatchesRequest
};
