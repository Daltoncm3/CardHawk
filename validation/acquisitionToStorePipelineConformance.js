'use strict';

const {
  runAcquisitionAdapterConformance,
  validateAcquisitionResultShape
} = require('./acquisitionAdapterConformance');
const {
  runSoldEvidenceStoreConformance,
  summarizeStoreConformance
} = require('./soldEvidenceStoreConformance');

const HARNESS_VERSION = '1.0.0';
const SOURCE = 'acquisition_to_store_pipeline_conformance';

const DEFAULT_REQUEST = {
  requestId: 'pipeline-conformance-valid-request',
  query: 'anthony hernandez',
  identity: {
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
  },
  limit: 50
};

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function createCheck(name, pass, details = {}) {
  return {
    name,
    pass: Boolean(pass),
    details
  };
}

function findCheck(report = {}, name) {
  return asArray(report.checks).find((check) => check.name === name) || null;
}

async function safeAcquire(adapter = {}, request = {}, options = {}) {
  if (typeof adapter.acquireSoldEvidence !== 'function') {
    return {
      records: [],
      validation: [],
      errors: [
        {
          code: 'missing_acquireSoldEvidence',
          message: 'Adapter does not expose acquireSoldEvidence.'
        }
      ],
      warnings: [],
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

  try {
    return await adapter.acquireSoldEvidence(request, options);
  } catch (error) {
    return {
      records: [],
      validation: [],
      errors: [
        {
          code: error.code || 'acquisition_exception',
          message: error.message
        }
      ],
      warnings: [],
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
}

function stageFromReason(reason = '') {
  if (reason.startsWith('missing_identity_') || reason === 'canonical_card_key_mismatch') {
    return 'identity';
  }

  if (
    reason.startsWith('missing_provenance_')
    || reason.startsWith('invalid_provenance_')
    || reason.startsWith('missing_source_')
    || reason.startsWith('invalid_source_')
  ) {
    return 'provenance';
  }

  if (
    reason === 'not_true_sold_evidence'
    || reason === 'inactive_or_context_record'
    || reason === 'undisclosed_best_offer_price'
  ) {
    return 'evidence_classification';
  }

  return 'store_compatibility';
}

function stagesFromReasons(reasons = []) {
  return unique(asArray(reasons).map(stageFromReason));
}

function adapterContractFailures(adapterReport = {}) {
  return asArray(adapterReport.failures).filter((failure) => failure === 'interface_contract');
}

function capabilityMetadataFailures(adapterReport = {}) {
  const capabilityChecks = new Set([
    'capability_metadata_required_fields',
    'adapter_versioning',
    'identity_capability_metadata',
    'provenance_capability_metadata',
    'health_reporting',
    'no_transaction_support_cannot_emit_true_sold'
  ]);

  return asArray(adapterReport.failures).filter((failure) => capabilityChecks.has(failure));
}

function resultForIndex(storeReport = {}, index) {
  const duplicateCheck = findCheck(storeReport, 'duplicate_handling');
  return asArray(duplicateCheck?.details?.results)[index] || null;
}

function buildRecordOutcomes(acquisitionResult = {}, storeReport = {}) {
  const records = asArray(acquisitionResult.records);
  const validations = asArray(acquisitionResult.validation);
  const storeRecordReports = asArray(storeReport.recordReports);

  return records.map((record, index) => {
    const acquisitionValidation = validations[index] || {};
    const storeRecordReport = storeRecordReports[index] || {};
    const duplicateResult = resultForIndex(storeReport, index);
    const reasonGroups = {
      acquisition: asArray(acquisitionValidation.reasons),
      schema: asArray(storeRecordReport.validation?.checks?.schema),
      identity: asArray(storeRecordReport.validation?.checks?.identity),
      provenance: asArray(storeRecordReport.validation?.checks?.provenance),
      evidenceType: asArray(storeRecordReport.validation?.checks?.evidenceType),
      transactionEligibility: asArray(storeRecordReport.validation?.checks?.transactionEligibility),
      immutable: asArray(storeRecordReport.validation?.checks?.immutable)
    };
    const reasons = Object.values(reasonGroups).flat();
    const stages = stagesFromReasons(reasons);

    if (duplicateResult?.duplicate) stages.push('duplicate_handling');

    const failureStages = unique(stages);

    return {
      recordIndex: index,
      recordId: record.id || storeRecordReport.id || null,
      canonicalCardKey: record.canonicalCardKey || storeRecordReport.canonicalCardKey || null,
      evidenceType: record.evidenceType || null,
      status: failureStages.length ? 'rejected' : 'eligible',
      eligibleForStore: failureStages.length === 0,
      failureStages,
      reasons,
      duplicate: Boolean(duplicateResult?.duplicate),
      duplicateOf: duplicateResult?.duplicateOf || null,
      acquisitionValidation: {
        valid: acquisitionValidation.valid !== false,
        reasons: reasonGroups.acquisition
      },
      storeValidation: {
        valid: storeRecordReport.validation?.valid !== false,
        checks: storeRecordReport.validation?.checks || {}
      }
    };
  });
}

function buildManualBatchRejections(acquisitionResult = {}) {
  const validationReport = acquisitionResult.metadata?.validationReport;
  if (!validationReport) return [];

  return asArray(validationReport.recordResults)
    .filter((entry) => !entry.valid)
    .map((entry) => ({
      batchId: entry.batchId || null,
      batchIndex: entry.batchIndex ?? null,
      recordIndex: entry.recordIndex ?? null,
      recordId: entry.id || null,
      status: 'rejected_before_adapter_output',
      failureStages: stagesFromReasons(entry.reasons),
      reasons: asArray(entry.reasons)
    }));
}

function summarizeStages(recordOutcomes = [], manualBatchRejections = []) {
  const summary = {
    adapter_contract: 0,
    capability_metadata: 0,
    identity: 0,
    provenance: 0,
    evidence_classification: 0,
    duplicate_handling: 0,
    store_compatibility: 0
  };

  for (const outcome of [...recordOutcomes, ...manualBatchRejections]) {
    for (const stage of asArray(outcome.failureStages)) {
      if (summary[stage] !== undefined) summary[stage] += 1;
    }
  }

  return summary;
}

function summarizePartialFailures(acquisitionResult = {}) {
  return asArray(acquisitionResult.errors).map((error) => ({
    code: error.code || 'acquisition_error',
    message: error.message || '',
    retryable: Boolean(error.retryable),
    adapterName: error.adapterName || null,
    sourceId: error.sourceId || null
  }));
}

function manualDatasetDiagnostics(acquisitionResult = {}) {
  const report = acquisitionResult.metadata?.validationReport;
  if (!report) {
    return {
      present: false,
      invalidRecords: 0,
      duplicateSourceRecordGroups: 0,
      duplicateSaleGroups: 0,
      rejectedRecords: []
    };
  }

  return {
    present: true,
    receivedRecords: report.receivedRecords || 0,
    validRecords: report.validRecords || 0,
    invalidRecords: report.invalidRecords || 0,
    duplicateSourceRecordGroups: asArray(report.duplicateSourceRecords).length,
    duplicateSaleGroups: asArray(report.duplicateSales).length,
    rejectedRecords: buildManualBatchRejections(acquisitionResult),
    duplicateSourceRecords: asArray(report.duplicateSourceRecords),
    duplicateSales: asArray(report.duplicateSales)
  };
}

function summarizePipelineConformance(report = {}) {
  return {
    source: report.source || SOURCE,
    passed: Boolean(report.passed),
    dryRun: report.dryRun !== false,
    totalChecks: report.totalChecks || 0,
    passedChecks: report.passedChecks || 0,
    failedChecks: report.failedChecks || 0,
    failures: asArray(report.failures),
    emittedRecords: report.summary?.emittedRecords || 0,
    eligibleRecords: report.summary?.eligibleRecords || 0,
    rejectedRecords: report.summary?.rejectedRecords || 0,
    duplicateRecords: report.summary?.duplicateRecords || 0,
    partialFailures: report.summary?.partialFailures || 0
  };
}

async function runAcquisitionToStorePipelineConformance(adapter = {}, options = {}) {
  const request = options.request || DEFAULT_REQUEST;
  const acquireOptions = options.acquireOptions || {};
  const adapterConformanceOptions = {
    ...asObject(options.adapterConformanceOptions),
    acquireOptions: asObject(options.adapterConformanceOptions?.acquireOptions || acquireOptions)
  };
  const adapterReport = await runAcquisitionAdapterConformance(adapter, adapterConformanceOptions);
  const acquisitionResult = await safeAcquire(adapter, request, acquireOptions);
  const acquisitionShape = validateAcquisitionResultShape(acquisitionResult);
  const storeReport = runSoldEvidenceStoreConformance({
    records: asArray(acquisitionResult.records)
  }, options.storeOptions || {});
  const replayResult = await safeAcquire(adapter, request, acquireOptions);
  const deterministicReplay = JSON.stringify(asArray(acquisitionResult.records)) === JSON.stringify(asArray(replayResult.records));
  const recordOutcomes = buildRecordOutcomes(acquisitionResult, storeReport);
  const manualDiagnostics = manualDatasetDiagnostics(acquisitionResult);
  const manualRejectedRecords = asArray(manualDiagnostics.rejectedRecords);
  const rejectedOutcomes = recordOutcomes.filter((outcome) => !outcome.eligibleForStore);
  const partialFailures = summarizePartialFailures(acquisitionResult);
  const contractFailures = adapterContractFailures(adapterReport);
  const capabilityFailures = capabilityMetadataFailures(adapterReport);

  const checks = [
    createCheck('adapter_contract', contractFailures.length === 0, { failures: contractFailures }),
    createCheck('capability_metadata', capabilityFailures.length === 0, { failures: capabilityFailures }),
    createCheck('acquisition_result_shape', acquisitionShape.valid, { reasons: acquisitionShape.reasons }),
    createCheck('acquisition_record_validation', asArray(acquisitionResult.validation).every((entry) => entry.valid), {
      invalidRecords: asArray(acquisitionResult.validation)
        .filter((entry) => !entry.valid)
        .map((entry) => ({ id: entry.id, reasons: entry.reasons }))
    }),
    createCheck('manual_batch_rejections', manualRejectedRecords.length === 0, {
      rejectedRecords: manualRejectedRecords
    }),
    createCheck('store_conformance', storeReport.passed, summarizeStoreConformance(storeReport)),
    createCheck('pipeline_store_eligibility', rejectedOutcomes.length === 0, {
      rejectedRecords: rejectedOutcomes
    }),
    createCheck('deterministic_fixture_replay', deterministicReplay, {
      firstRecordCount: asArray(acquisitionResult.records).length,
      secondRecordCount: asArray(replayResult.records).length
    }),
    createCheck('dry_run_only', true, {
      writesProductionStore: false,
      storeRecordsCreatedInMemory: storeReport.summary?.storedRecords || 0
    })
  ];
  const failed = checks.filter((check) => !check.pass);
  const stageSummary = summarizeStages(recordOutcomes, manualRejectedRecords);

  if (contractFailures.length) stageSummary.adapter_contract = contractFailures.length;
  if (capabilityFailures.length) stageSummary.capability_metadata = capabilityFailures.length;

  return {
    source: SOURCE,
    version: HARNESS_VERSION,
    dryRun: true,
    passed: failed.length === 0,
    totalChecks: checks.length,
    passedChecks: checks.length - failed.length,
    failedChecks: failed.length,
    failures: failed.map((check) => check.name),
    checks,
    request,
    adapter: {
      sourceId: adapter.sourceId || null,
      adapterName: adapter.adapterName || null,
      adapterVersion: adapter.adapterVersion || null,
      interfaceVersion: adapter.interfaceVersion || null
    },
    acquisition: {
      summary: acquisitionResult.summary || {},
      warnings: asArray(acquisitionResult.warnings),
      partialFailures,
      conformance: adapterReport
    },
    store: {
      summary: storeReport.summary || {},
      conformance: storeReport
    },
    pipeline: {
      recordOutcomes,
      rejectedRecords: rejectedOutcomes,
      manualDataset: manualDiagnostics,
      stageSummary,
      deterministicReplay: {
        pass: deterministicReplay,
        firstRecordCount: asArray(acquisitionResult.records).length,
        secondRecordCount: asArray(replayResult.records).length
      }
    },
    summary: {
      emittedRecords: asArray(acquisitionResult.records).length,
      eligibleRecords: recordOutcomes.filter((outcome) => outcome.eligibleForStore).length,
      rejectedRecords: rejectedOutcomes.length + manualRejectedRecords.length,
      manualRejectedRecords: manualRejectedRecords.length,
      duplicateRecords: recordOutcomes.filter((outcome) => outcome.duplicate).length,
      partialFailures: partialFailures.length,
      adapterContractFailures: contractFailures.length,
      capabilityMetadataFailures: capabilityFailures.length
    }
  };
}

module.exports = {
  DEFAULT_REQUEST,
  HARNESS_VERSION,
  SOURCE,
  buildManualBatchRejections,
  buildRecordOutcomes,
  runAcquisitionToStorePipelineConformance,
  stageFromReason,
  stagesFromReasons,
  summarizePipelineConformance
};
