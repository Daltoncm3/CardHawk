'use strict';

const {
  ADAPTER_STATUS,
  EVIDENCE_TYPES,
  INTERFACE_VERSION,
  REQUIRED_IDENTITY_FIELDS,
  REQUIRED_PROVENANCE_FIELDS,
  assertAdapterContract,
  validateRawEvidenceRecord
} = require('../marketplaces/canonicalAcquisitionInterface');

const REQUIRED_CAPABILITY_FIELDS = [
  'acquisitionInterfaceVersion',
  'accessMode',
  'sourceReliability',
  'transactionLevelSoldSupport',
  'aggregateMarketPriceSupport',
  'activeContextSupport',
  'identityFields',
  'provenanceFields',
  'supportsHealthCheck',
  'commercialUse'
];

const VALID_HEALTH_STATUSES = new Set(Object.values(ADAPTER_STATUS));

const DEFAULT_FIXTURES = {
  validRequest: {
    requestId: 'conformance-valid-request',
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
    limit: 25
  },
  invalidRequest: {},
  malformedRecord: {
    evidenceType: 'true_sold',
    marketplace: 'malformed_fixture',
    rawTitle: 'Malformed conformance fixture',
    soldPrice: 0,
    soldAt: null,
    url: '',
    parsedIdentity: {
      category: 'sports_card'
    },
    source: {
      adapter: '',
      retrievalMethod: '',
      sourceReliability: '',
      acquiredAt: 'not-a-date'
    }
  }
};

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function unique(values = []) {
  return [...new Set(values)];
}

function createCheck(name, pass, details = {}) {
  return {
    name,
    pass: Boolean(pass),
    details
  };
}

function missingCapabilityFields(capabilities = {}) {
  return REQUIRED_CAPABILITY_FIELDS.filter((field) => capabilities[field] === undefined || capabilities[field] === null);
}

function missingRequiredEntries(actual = [], required = []) {
  return required.filter((entry) => !actual.includes(entry));
}

async function safeCall(fn, fallback) {
  try {
    return await fn();
  } catch (error) {
    return {
      ...fallback,
      thrown: {
        message: error.message,
        name: error.name
      }
    };
  }
}

function validateAcquisitionResultShape(result = {}) {
  const reasons = [];
  const summary = asObject(result.summary);

  if (!result.source) reasons.push('missing_source');
  if (!Array.isArray(result.records)) reasons.push('missing_records_array');
  if (!Array.isArray(result.validation)) reasons.push('missing_validation_array');
  if (!Array.isArray(result.errors)) reasons.push('missing_errors_array');
  if (!Array.isArray(result.warnings)) reasons.push('missing_warnings_array');
  for (const field of ['returned', 'trueSoldCount', 'aggregateMarketPriceCount', 'activeContextCount', 'validRecordCount', 'invalidRecordCount', 'errorCount', 'warningCount']) {
    if (typeof summary[field] !== 'number') reasons.push(`missing_summary_${field}`);
  }

  return {
    valid: reasons.length === 0,
    reasons
  };
}

function validateRecords(records = [], source = {}) {
  return records.map((record) => ({
    id: record.id || null,
    evidenceType: record.evidenceType || null,
    validation: validateRawEvidenceRecord(record, source)
  }));
}

async function runAcquisitionAdapterConformance(adapter = {}, options = {}) {
  const fixtures = {
    ...DEFAULT_FIXTURES,
    ...asObject(options.fixtures)
  };
  const checks = [];
  const contract = assertAdapterContract(adapter);
  checks.push(createCheck('interface_contract', contract.valid, { reasons: contract.reasons }));

  const capabilitiesResult = contract.valid && typeof adapter.getCapabilities === 'function'
    ? await safeCall(() => adapter.getCapabilities(), {})
    : {};
  const capabilities = asObject(capabilitiesResult.capabilities);
  const missingCapabilities = missingCapabilityFields(capabilities);
  const missingIdentityFields = missingRequiredEntries(asArray(capabilities.identityFields), REQUIRED_IDENTITY_FIELDS);
  const missingProvenanceFields = missingRequiredEntries(asArray(capabilities.provenanceFields), REQUIRED_PROVENANCE_FIELDS);

  checks.push(createCheck('capability_metadata_required_fields', missingCapabilities.length === 0, {
    missing: missingCapabilities
  }));
  checks.push(createCheck('adapter_versioning', Boolean(adapter.interfaceVersion === INTERFACE_VERSION && adapter.adapterVersion), {
    interfaceVersion: adapter.interfaceVersion || null,
    expectedInterfaceVersion: INTERFACE_VERSION,
    adapterVersion: adapter.adapterVersion || null
  }));
  checks.push(createCheck('identity_capability_metadata', missingIdentityFields.length === 0, {
    missing: missingIdentityFields,
    identityFields: capabilities.identityFields || []
  }));
  checks.push(createCheck('provenance_capability_metadata', missingProvenanceFields.length === 0, {
    missing: missingProvenanceFields,
    provenanceFields: capabilities.provenanceFields || []
  }));

  const status = contract.valid && typeof adapter.getStatus === 'function'
    ? await safeCall(() => adapter.getStatus(), { status: ADAPTER_STATUS.ERROR })
    : { status: ADAPTER_STATUS.ERROR };
  checks.push(createCheck('health_reporting', VALID_HEALTH_STATUSES.has(status.status), {
    status
  }));

  const validResult = contract.valid && typeof adapter.acquireSoldEvidence === 'function'
    ? await safeCall(() => adapter.acquireSoldEvidence(fixtures.validRequest, options.acquireOptions || {}), { records: [], errors: [] })
    : { records: [], errors: [] };
  const validShape = validateAcquisitionResultShape(validResult);
  const recordValidations = validateRecords(asArray(validResult.records), validResult.source || {});
  const invalidRecords = recordValidations.filter((entry) => !entry.validation.valid);

  checks.push(createCheck('valid_acquisition_result_shape', validShape.valid, {
    reasons: validShape.reasons
  }));
  checks.push(createCheck('provenance_enforcement', invalidRecords.length === 0, {
    invalidRecords: invalidRecords.map((entry) => ({
      id: entry.id,
      reasons: entry.validation.reasons
    }))
  }));
  checks.push(createCheck('identity_requirements', invalidRecords.length === 0, {
    invalidRecords: invalidRecords.map((entry) => ({
      id: entry.id,
      reasons: entry.validation.reasons.filter((reason) => reason.startsWith('missing_identity_'))
    }))
  }));

  const deterministicReplay = contract.valid && typeof adapter.acquireSoldEvidence === 'function'
    ? await safeCall(() => adapter.acquireSoldEvidence(fixtures.validRequest, options.acquireOptions || {}), { records: [], errors: [] })
    : { records: [], errors: [] };
  checks.push(createCheck('deterministic_fixture_replay', JSON.stringify(validResult.records || []) === JSON.stringify(deterministicReplay.records || []), {
    firstRecordCount: asArray(validResult.records).length,
    secondRecordCount: asArray(deterministicReplay.records).length
  }));

  const invalidRequestResult = contract.valid && typeof adapter.acquireSoldEvidence === 'function'
    ? await safeCall(() => adapter.acquireSoldEvidence(fixtures.invalidRequest, options.acquireOptions || {}), { errors: [] })
    : { errors: [] };
  checks.push(createCheck('structured_errors_for_invalid_request', asArray(invalidRequestResult.errors).some((error) => error.code === 'missing_query_or_identity'), {
    errors: invalidRequestResult.errors || []
  }));

  const malformedValidation = validateRawEvidenceRecord(fixtures.malformedRecord, validResult.source || adapter);
  checks.push(createCheck('malformed_result_validation', !malformedValidation.valid, {
    reasons: malformedValidation.reasons
  }));

  const partialFailureAdapter = options.partialFailureAdapter;
  if (partialFailureAdapter) {
    const partialResult = await safeCall(
      () => partialFailureAdapter.acquireSoldEvidence(fixtures.validRequest, options.partialFailureOptions || {}),
      { records: [], errors: [] }
    );
    checks.push(createCheck('partial_failure_structured_errors', asArray(partialResult.errors).length > 0 && validateAcquisitionResultShape(partialResult).valid, {
      errors: partialResult.errors || []
    }));
  } else {
    checks.push(createCheck('partial_failure_structured_errors', true, {
      skipped: true,
      reason: 'No partialFailureAdapter fixture supplied.'
    }));
  }

  const noTransactionAdapter = options.noTransactionAdapter;
  if (noTransactionAdapter) {
    const noTransactionResult = await safeCall(
      () => noTransactionAdapter.acquireSoldEvidence(fixtures.validRequest, options.noTransactionOptions || {}),
      { records: [], errors: [] }
    );
    const emittedTrueSold = asArray(noTransactionResult.records).filter((record) => record.evidenceType === EVIDENCE_TYPES.TRUE_SOLD);
    checks.push(createCheck('no_transaction_support_cannot_emit_true_sold', emittedTrueSold.length === 0, {
      emittedTrueSoldCount: emittedTrueSold.length,
      summary: noTransactionResult.summary || {}
    }));
  } else if (capabilities.transactionLevelSoldSupport === false) {
    const emittedTrueSold = asArray(validResult.records).filter((record) => record.evidenceType === EVIDENCE_TYPES.TRUE_SOLD);
    checks.push(createCheck('no_transaction_support_cannot_emit_true_sold', emittedTrueSold.length === 0, {
      emittedTrueSoldCount: emittedTrueSold.length,
      summary: validResult.summary || {}
    }));
  } else {
    checks.push(createCheck('no_transaction_support_cannot_emit_true_sold', true, {
      skipped: true,
      reason: 'Adapter supports transaction-level sold evidence; no noTransactionAdapter fixture supplied.'
    }));
  }

  const failedChecks = checks.filter((check) => !check.pass);

  return {
    source: 'acquisition_adapter_conformance',
    version: '1.0.0',
    adapter: {
      sourceId: adapter.sourceId || null,
      adapterName: adapter.adapterName || null,
      adapterVersion: adapter.adapterVersion || null,
      interfaceVersion: adapter.interfaceVersion || null
    },
    passed: failedChecks.length === 0,
    totalChecks: checks.length,
    passedChecks: checks.length - failedChecks.length,
    failedChecks: failedChecks.length,
    checks,
    failures: failedChecks.map((check) => check.name),
    diagnostics: {
      capabilityFields: unique(Object.keys(capabilities)),
      healthStatus: status.status || null,
      validResultSummary: validResult.summary || null
    }
  };
}

function summarizeConformance(report = {}) {
  return {
    adapterName: report.adapter?.adapterName || null,
    sourceId: report.adapter?.sourceId || null,
    passed: Boolean(report.passed),
    totalChecks: report.totalChecks || 0,
    passedChecks: report.passedChecks || 0,
    failedChecks: report.failedChecks || 0,
    failures: asArray(report.failures)
  };
}

module.exports = {
  DEFAULT_FIXTURES,
  REQUIRED_CAPABILITY_FIELDS,
  runAcquisitionAdapterConformance,
  summarizeConformance,
  validateAcquisitionResultShape,
  validateRecords
};
