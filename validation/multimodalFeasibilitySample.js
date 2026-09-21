'use strict';

const {
  API_KEY_ENV: CARD_API_KEY_ENV,
  CONTROL_IDENTITY,
  CONTROL_QUERY,
  LIVE_FLAG_ENV: CARD_API_LIVE_FLAG_ENV,
  executeCardApiSalesRequest
} = require('../marketplaces/cardApiAcquisitionAdapter');
const {
  FEASIBILITY_CLASSIFICATIONS,
  OPENAI_API_KEY_ENV,
  OPENAI_LIVE_FLAG_ENV,
  OPENAI_MODEL_ENV,
  DEFAULT_OPENAI_MODEL,
  DEFAULT_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  DEFAULT_MAX_OUTPUT_TOKENS,
  MAX_OUTPUT_TOKENS,
  createOpenAIMultimodalProviderAdapter,
  runOpenAIMultimodalTransactionAnalysis
} = require('./openaiMultimodalProviderAdapter');
const { MATERIAL_FIELDS } = require('./cardApiIdentityResolutionPilot');
const { SUPPORTED_FIELDS } = require('./multimodalSoldIdentityEvidencePilot');
const {
  asArray,
  asObject,
  fingerprint,
  unique
} = require('./canonicalValidationCore');

const SOURCE = 'multimodal_feasibility_sample';
const VERSION = '0.1.0';
const SCHEMA_VERSION = '1.0.0';

const FEASIBILITY_SAMPLE_LIVE_FLAG_ENV = 'CARDHAWK_MULTIMODAL_FEASIBILITY_SAMPLE_LIVE';
const MAX_FEASIBILITY_SAMPLE_TRANSACTIONS = 3;
const MAX_FEASIBILITY_SAMPLE_IMAGES = 3;
const MAX_FEASIBILITY_SAMPLE_MODEL_REQUESTS = 3;
const MAX_DIAGNOSTIC_FIELDS = 16;

const SAMPLE_EXECUTION_STATUS = Object.freeze({
  DISABLED: 'SAMPLE_NOT_RUN_DISABLED',
  MISSING_CARD_API_CREDENTIAL: 'SAMPLE_NOT_RUN_MISSING_CARD_API_CREDENTIAL',
  MISSING_CARD_API_FLAG: 'SAMPLE_NOT_RUN_MISSING_CARD_API_FLAG',
  MISSING_OPENAI_CREDENTIAL: 'SAMPLE_NOT_RUN_MISSING_OPENAI_CREDENTIAL',
  MISSING_OPENAI_FLAG: 'SAMPLE_NOT_RUN_MISSING_OPENAI_FLAG',
  MISSING_SAMPLE_FLAG: 'SAMPLE_NOT_RUN_MISSING_SAMPLE_FLAG',
  INVALID_LIMITS: 'SAMPLE_NOT_RUN_INVALID_LIMITS',
  FETCH_UNAVAILABLE: 'SAMPLE_NOT_RUN_FETCH_UNAVAILABLE',
  NO_TRANSACTIONS: 'SAMPLE_COMPLETED_NO_TRANSACTIONS',
  NO_ELIGIBLE_IMAGES: 'SAMPLE_COMPLETED_NO_ELIGIBLE_IMAGES',
  PARTIALLY_COMPLETED: 'SAMPLE_PARTIALLY_COMPLETED',
  COMPLETED: 'SAMPLE_COMPLETED',
  SAFELY_FAILED: 'SAMPLE_SAFELY_FAILED'
});

const REJECTION_REASON_CODES = Object.freeze([
  'absence_is_not_negative_evidence',
  'ambiguous_or_warning_bearing_observation',
  'authority_boundary_violation',
  'confidence_below_admission_threshold',
  'deterministic_verification_required',
  'inferred_visual_evidence_requires_review',
  'invalid_confidence',
  'invalid_observation',
  'multiple_cards_visible',
  'unknown_not_observable',
  'unsupported_identity_field',
  'unsupported_observation_type',
  'unsupported_schema_version'
]);

const EVIDENCE_CATEGORY_CODES = Object.freeze([
  'additional_image_or_view',
  'canonical_resolver',
  'explicit_title_evidence',
  'explicit_visual_evidence',
  'image_ocr',
  'manual_verification',
  'provider_metadata',
  'slab_label',
  'unknown'
]);

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function enabled(env = {}, key = '') {
  return String(env[key] || '').toLowerCase() === 'true';
}

function safeModelName(value) {
  return String(value || DEFAULT_OPENAI_MODEL)
    .replace(/[^A-Za-z0-9_.:-]+/g, '')
    .slice(0, 80) || DEFAULT_OPENAI_MODEL;
}

function sanitizeErrorCode(value) {
  return String(value || 'unknown_error')
    .replace(/https?:\/\/\S+/gi, '[REDACTED_URL]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
    .replace(/sk-[A-Za-z0-9_-]+/gi, '[REDACTED_API_KEY]')
    .replace(/tca_[A-Za-z0-9_-]+/gi, '[REDACTED_API_KEY]')
    .replace(/[^A-Za-z0-9_.:-]+/g, '_')
    .slice(0, 80);
}

function requestedLimit(value, fallback) {
  const number = Number(value ?? fallback);
  if (!Number.isFinite(number)) return fallback;
  return Math.floor(number);
}

function incrementCount(map, key, amount = 1, allowlist = null) {
  const safeKey = String(key || '').trim();
  if (!safeKey) return;
  if (allowlist && !allowlist.includes(safeKey)) return;
  map[safeKey] = Math.max(0, (map[safeKey] || 0) + Math.max(0, Number(amount) || 0));
}

function addMapCounts(target, source = {}, allowlist = null) {
  for (const [key, value] of Object.entries(asObject(source))) {
    incrementCount(target, key, value, allowlist);
  }
}

function sortedCountMap(map = {}, allowlist = null) {
  const allowed = allowlist ? new Set(allowlist) : null;
  return deepFreeze(Object.fromEntries(Object.entries(asObject(map))
    .filter(([key, value]) => (!allowed || allowed.has(key)) && Number.isFinite(Number(value)) && Number(value) > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(0, MAX_DIAGNOSTIC_FIELDS)
    .map(([key, value]) => [key, Math.max(0, Math.floor(Number(value)))])));
}

function sumBoundedUsage(total = {}, usage = {}) {
  const input = asObject(usage);
  for (const field of ['inputTokens', 'outputTokens', 'totalTokens', 'modelRequests', 'inputImages']) {
    const value = Number(input[field]);
    if (Number.isFinite(value) && value > 0) total[field] = (total[field] || 0) + Math.floor(value);
  }
}

function duplicateKeyForTransaction(transaction = {}) {
  return transaction.marketplaceSaleId ||
    transaction.marketplaceListingId ||
    transaction.url ||
    fingerprint({
      marketplace: transaction.marketplace || null,
      soldAt: transaction.soldAt || null,
      soldPrice: transaction.soldPrice || null,
      imagePresent: Boolean(transaction.image)
    });
}

function sampleGateStatus(gates = {}) {
  if (gates.reasonCodes.includes('a5_10_limit_violation')) return SAMPLE_EXECUTION_STATUS.INVALID_LIMITS;
  if (gates.reasonCodes.includes('card_api_key_missing')) return SAMPLE_EXECUTION_STATUS.MISSING_CARD_API_CREDENTIAL;
  if (gates.reasonCodes.includes('card_api_live_flag_missing')) return SAMPLE_EXECUTION_STATUS.MISSING_CARD_API_FLAG;
  if (gates.reasonCodes.includes('openai_api_key_missing')) return SAMPLE_EXECUTION_STATUS.MISSING_OPENAI_CREDENTIAL;
  if (gates.reasonCodes.includes('openai_live_flag_missing')) return SAMPLE_EXECUTION_STATUS.MISSING_OPENAI_FLAG;
  if (gates.reasonCodes.includes('feasibility_sample_live_flag_missing')) return SAMPLE_EXECUTION_STATUS.MISSING_SAMPLE_FLAG;
  return SAMPLE_EXECUTION_STATUS.DISABLED;
}

function validateOpenAIFeasibilitySampleGates(input = {}) {
  const env = input.env || process.env;
  const transactionLimit = requestedLimit(input.transactionLimit ?? input.limit, MAX_FEASIBILITY_SAMPLE_TRANSACTIONS);
  const imageLimit = requestedLimit(input.imageLimit, MAX_FEASIBILITY_SAMPLE_IMAGES);
  const modelRequestLimit = requestedLimit(input.modelRequestLimit, MAX_FEASIBILITY_SAMPLE_MODEL_REQUESTS);
  const errors = [];
  const reasonCodes = [];

  if (
    transactionLimit > MAX_FEASIBILITY_SAMPLE_TRANSACTIONS ||
    imageLimit > MAX_FEASIBILITY_SAMPLE_IMAGES ||
    modelRequestLimit > MAX_FEASIBILITY_SAMPLE_MODEL_REQUESTS
  ) {
    errors.push('requested_limits_exceed_a5_10_bounds');
    reasonCodes.push('a5_10_limit_violation');
  }
  if (!String(env[CARD_API_KEY_ENV] || '').trim()) {
    errors.push('card_api_key_missing');
    reasonCodes.push('card_api_key_missing');
  }
  if (!enabled(env, CARD_API_LIVE_FLAG_ENV)) {
    errors.push('card_api_live_flag_missing');
    reasonCodes.push('card_api_live_flag_missing');
  }
  if (!String(env[OPENAI_API_KEY_ENV] || '').trim()) {
    errors.push('openai_api_key_missing');
    reasonCodes.push('openai_api_key_missing');
  }
  if (!enabled(env, OPENAI_LIVE_FLAG_ENV)) {
    errors.push('openai_live_flag_missing');
    reasonCodes.push('openai_live_flag_missing');
  }
  if (!enabled(env, FEASIBILITY_SAMPLE_LIVE_FLAG_ENV)) {
    errors.push('feasibility_sample_live_flag_missing');
    reasonCodes.push('feasibility_sample_live_flag_missing');
  }

  return deepFreeze({
    valid: errors.length === 0,
    errors: errors.sort(),
    reasonCodes: unique(reasonCodes).sort(),
    limits: {
      transactionLimit: Math.min(transactionLimit, MAX_FEASIBILITY_SAMPLE_TRANSACTIONS),
      imageLimit: Math.min(imageLimit, MAX_FEASIBILITY_SAMPLE_IMAGES),
      modelRequestLimit: Math.min(modelRequestLimit, MAX_FEASIBILITY_SAMPLE_MODEL_REQUESTS)
    },
    gates: {
      cardApiCredentialPresent: Boolean(String(env[CARD_API_KEY_ENV] || '').trim()),
      cardApiLiveEnabled: enabled(env, CARD_API_LIVE_FLAG_ENV),
      openAiCredentialPresent: Boolean(String(env[OPENAI_API_KEY_ENV] || '').trim()),
      openAiLiveEnabled: enabled(env, OPENAI_LIVE_FLAG_ENV),
      feasibilitySampleLiveEnabled: enabled(env, FEASIBILITY_SAMPLE_LIVE_FLAG_ENV),
      modelConfigured: Boolean(String(env[OPENAI_MODEL_ENV] || DEFAULT_OPENAI_MODEL).trim())
    }
  });
}

function buildEmptyFeasibilitySampleReport(input = {}) {
  const report = {
    phase: 'A5.10',
    source: SOURCE,
    version: VERSION,
    schemaVersion: SCHEMA_VERSION,
    sampleExecutionStatus: input.sampleExecutionStatus || SAMPLE_EXECUTION_STATUS.DISABLED,
    configuredModel: safeModelName(input.model),
    transactionsRequested: input.transactionsRequested || 0,
    transactionsReturned: input.transactionsReturned || 0,
    uniqueTransactionsEvaluated: 0,
    duplicateTransactionsSkipped: 0,
    transactionsWithoutImages: 0,
    imagesEvaluated: 0,
    modelRequestsAttempted: 0,
    modelRequestsCompleted: 0,
    modelRequestFailures: 0,
    preVisionClassificationCounts: {},
    postVisionClassificationCounts: {},
    classificationImprovementCount: 0,
    exactReachedCount: 0,
    exactReachedRate: 0,
    canonicalSoldEvidenceStructurallyReadyCount: 0,
    admittedObservationCount: 0,
    rejectedObservationCount: 0,
    rejectionReasonCounts: {},
    missingFieldFrequencyBefore: {},
    missingFieldFrequencyAfter: {},
    recoveredFieldFrequency: {},
    conflictFieldFrequency: {},
    blockerClassificationFrequency: {},
    requiredEvidenceCategoryFrequency: {},
    transactionsRequiringAdditionalEvidence: 0,
    averageMaterialFieldRecoveryRate: 0,
    boundedTokenUsage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      modelRequests: 0,
      inputImages: 0
    },
    sanitizedFailureCategories: asArray(input.sanitizedFailureCategories).map(sanitizeErrorCode).sort().slice(0, MAX_DIAGNOSTIC_FIELDS),
    nonPersistent: true,
    writesProductionStore: false,
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
  report.reportFingerprint = fingerprint(report);
  return deepFreeze(report);
}

function buildFeasibilitySampleReport(input = {}) {
  const reports = asArray(input.reports);
  const totals = {
    preVisionClassificationCounts: {},
    postVisionClassificationCounts: {},
    rejectionReasonCounts: {},
    missingFieldFrequencyBefore: {},
    missingFieldFrequencyAfter: {},
    recoveredFieldFrequency: {},
    conflictFieldFrequency: {},
    blockerClassificationFrequency: {},
    requiredEvidenceCategoryFrequency: {},
    boundedTokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, modelRequests: 0, inputImages: 0 }
  };
  let classificationImprovementCount = 0;
  let exactReachedCount = 0;
  let canonicalSoldEvidenceStructurallyReadyCount = 0;
  let admittedObservationCount = 0;
  let rejectedObservationCount = 0;
  let transactionsRequiringAdditionalEvidence = 0;
  let recoveryRateSum = 0;

  for (const report of reports) {
    incrementCount(totals.preVisionClassificationCounts, report.preVisionClassification);
    incrementCount(totals.postVisionClassificationCounts, report.postVisionClassification);
    if (report.classificationImproved) classificationImprovementCount += 1;
    if (report.exactReached) exactReachedCount += 1;
    if (report.canonicalSoldEvidenceStructurallyReady) canonicalSoldEvidenceStructurallyReadyCount += 1;
    admittedObservationCount += Math.max(0, Number(report.admittedObservationCount) || 0);
    rejectedObservationCount += Math.max(0, Number(report.rejectedObservationCount) || 0);
    addMapCounts(totals.rejectionReasonCounts, report.rejectionReasonCounts, REJECTION_REASON_CODES);
    for (const field of asArray(report.missingMaterialFieldsBefore)) incrementCount(totals.missingFieldFrequencyBefore, field, 1, MATERIAL_FIELDS);
    for (const field of asArray(report.missingMaterialFieldsAfter)) incrementCount(totals.missingFieldFrequencyAfter, field, 1, MATERIAL_FIELDS);
    for (const field of asArray(report.recoveredMaterialFields)) incrementCount(totals.recoveredFieldFrequency, field, 1, MATERIAL_FIELDS);
    for (const field of asArray(report.conflictFields)) incrementCount(totals.conflictFieldFrequency, field, 1, SUPPORTED_FIELDS);
    addMapCounts(totals.blockerClassificationFrequency, report.blockerClassificationByField);
    for (const categories of Object.values(asObject(report.requiredEvidenceCategoriesByField))) {
      for (const category of asArray(categories)) incrementCount(totals.requiredEvidenceCategoryFrequency, category, 1, EVIDENCE_CATEGORY_CODES);
    }
    if (report.additionalEvidenceRequired) transactionsRequiringAdditionalEvidence += 1;
    recoveryRateSum += Math.max(0, Number(report.materialFieldRecoveryRate) || 0);
    sumBoundedUsage(totals.boundedTokenUsage, report.boundedUsage);
  }

  const evaluated = Math.max(0, Number(input.uniqueTransactionsEvaluated) || 0);
  const report = {
    phase: 'A5.10',
    source: SOURCE,
    version: VERSION,
    schemaVersion: SCHEMA_VERSION,
    sampleExecutionStatus: input.sampleExecutionStatus || SAMPLE_EXECUTION_STATUS.COMPLETED,
    configuredModel: safeModelName(input.model),
    transactionsRequested: input.transactionsRequested || MAX_FEASIBILITY_SAMPLE_TRANSACTIONS,
    transactionsReturned: Math.max(0, Number(input.transactionsReturned) || 0),
    uniqueTransactionsEvaluated: evaluated,
    duplicateTransactionsSkipped: Math.max(0, Number(input.duplicateTransactionsSkipped) || 0),
    transactionsWithoutImages: Math.max(0, Number(input.transactionsWithoutImages) || 0),
    imagesEvaluated: Math.max(0, Number(input.imagesEvaluated) || 0),
    modelRequestsAttempted: Math.max(0, Number(input.modelRequestsAttempted) || 0),
    modelRequestsCompleted: Math.max(0, Number(input.modelRequestsCompleted) || 0),
    modelRequestFailures: Math.max(0, Number(input.modelRequestFailures) || 0),
    preVisionClassificationCounts: sortedCountMap(totals.preVisionClassificationCounts),
    postVisionClassificationCounts: sortedCountMap(totals.postVisionClassificationCounts),
    classificationImprovementCount,
    exactReachedCount,
    exactReachedRate: evaluated ? Number((exactReachedCount / evaluated).toFixed(4)) : 0,
    canonicalSoldEvidenceStructurallyReadyCount,
    admittedObservationCount,
    rejectedObservationCount,
    rejectionReasonCounts: sortedCountMap(totals.rejectionReasonCounts, REJECTION_REASON_CODES),
    missingFieldFrequencyBefore: sortedCountMap(totals.missingFieldFrequencyBefore, MATERIAL_FIELDS),
    missingFieldFrequencyAfter: sortedCountMap(totals.missingFieldFrequencyAfter, MATERIAL_FIELDS),
    recoveredFieldFrequency: sortedCountMap(totals.recoveredFieldFrequency, MATERIAL_FIELDS),
    conflictFieldFrequency: sortedCountMap(totals.conflictFieldFrequency, SUPPORTED_FIELDS),
    blockerClassificationFrequency: sortedCountMap(totals.blockerClassificationFrequency, Object.values(FEASIBILITY_CLASSIFICATIONS)),
    requiredEvidenceCategoryFrequency: sortedCountMap(totals.requiredEvidenceCategoryFrequency, EVIDENCE_CATEGORY_CODES),
    transactionsRequiringAdditionalEvidence,
    averageMaterialFieldRecoveryRate: evaluated ? Number((recoveryRateSum / evaluated).toFixed(4)) : 0,
    boundedTokenUsage: deepFreeze(totals.boundedTokenUsage),
    sanitizedFailureCategories: unique(asArray(input.sanitizedFailureCategories).map(sanitizeErrorCode)).sort().slice(0, MAX_DIAGNOSTIC_FIELDS),
    nonPersistent: true,
    writesProductionStore: false,
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
  report.reportFingerprint = fingerprint(report);
  return deepFreeze(report);
}

async function runOpenAIMultimodalFeasibilitySample(options = {}) {
  const env = options.env || process.env;
  const model = safeModelName(options.model || env[OPENAI_MODEL_ENV] || DEFAULT_OPENAI_MODEL);
  const gates = validateOpenAIFeasibilitySampleGates({
    env,
    transactionLimit: options.transactionLimit ?? options.limit ?? MAX_FEASIBILITY_SAMPLE_TRANSACTIONS,
    imageLimit: options.imageLimit ?? MAX_FEASIBILITY_SAMPLE_IMAGES,
    modelRequestLimit: options.modelRequestLimit ?? MAX_FEASIBILITY_SAMPLE_MODEL_REQUESTS
  });

  if (!gates.valid) {
    return deepFreeze({
      source: SOURCE,
      version: VERSION,
      schemaVersion: SCHEMA_VERSION,
      sampleGateValidation: gates,
      report: buildEmptyFeasibilitySampleReport({
        model,
        sampleExecutionStatus: sampleGateStatus(gates),
        transactionsRequested: gates.limits.transactionLimit,
        sanitizedFailureCategories: gates.reasonCodes
      }),
      productionImpact: 'none',
      decisionImpact: 'none',
      executionAuthority: 'none'
    });
  }

  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const cardFetchImpl = options.cardApiFetchImpl || fetchImpl;
  if (typeof fetchImpl !== 'function' || typeof cardFetchImpl !== 'function') {
    return deepFreeze({
      source: SOURCE,
      version: VERSION,
      schemaVersion: SCHEMA_VERSION,
      sampleGateValidation: gates,
      report: buildEmptyFeasibilitySampleReport({
        model,
        sampleExecutionStatus: SAMPLE_EXECUTION_STATUS.FETCH_UNAVAILABLE,
        transactionsRequested: gates.limits.transactionLimit,
        sanitizedFailureCategories: ['fetch_unavailable']
      }),
      productionImpact: 'none',
      decisionImpact: 'none',
      executionAuthority: 'none'
    });
  }

  const acquisition = await executeCardApiSalesRequest({
    requestId: 'a5-10-openai-multimodal-feasibility-sample',
    query: options.query || CONTROL_QUERY,
    identity: options.identity || CONTROL_IDENTITY,
    limit: MAX_FEASIBILITY_SAMPLE_TRANSACTIONS,
    filters: asObject(options.filters)
  }, {
    env,
    fetchImpl: cardFetchImpl,
    limit: MAX_FEASIBILITY_SAMPLE_TRANSACTIONS,
    acquiredAt: options.acquiredAt
  });
  const returnedRecords = asArray(acquisition.records).slice(0, MAX_FEASIBILITY_SAMPLE_TRANSACTIONS);
  if (!returnedRecords.length) {
    return deepFreeze({
      source: SOURCE,
      version: VERSION,
      schemaVersion: SCHEMA_VERSION,
      sampleGateValidation: gates,
      report: buildEmptyFeasibilitySampleReport({
        model,
        sampleExecutionStatus: SAMPLE_EXECUTION_STATUS.NO_TRANSACTIONS,
        transactionsRequested: MAX_FEASIBILITY_SAMPLE_TRANSACTIONS,
        transactionsReturned: 0,
        sanitizedFailureCategories: asArray(acquisition.errors).map((error) => error?.code || 'card_api_no_transactions')
      }),
      productionImpact: 'none',
      decisionImpact: 'none',
      executionAuthority: 'none'
    });
  }

  const adapter = options.adapter || createOpenAIMultimodalProviderAdapter({
    env,
    model,
    fetchImpl,
    timeoutMs: options.timeoutMs
  });
  const seen = new Set();
  const reports = [];
  const failureCategories = [];
  let duplicateTransactionsSkipped = 0;
  let transactionsWithoutImages = 0;
  let imagesEvaluated = 0;
  let modelRequestsAttempted = 0;
  let modelRequestsCompleted = 0;
  let modelRequestFailures = 0;

  for (const transaction of returnedRecords) {
    const duplicateKey = duplicateKeyForTransaction(transaction);
    if (seen.has(duplicateKey)) {
      duplicateTransactionsSkipped += 1;
      continue;
    }
    seen.add(duplicateKey);
    if (reports.length >= MAX_FEASIBILITY_SAMPLE_TRANSACTIONS) break;
    if (imagesEvaluated >= gates.limits.imageLimit || modelRequestsAttempted >= gates.limits.modelRequestLimit) break;

    if (!transaction.image) {
      transactionsWithoutImages += 1;
      failureCategories.push('image_not_available');
      continue;
    }

    imagesEvaluated += 1;
    modelRequestsAttempted += 1;
    const analysis = await runOpenAIMultimodalTransactionAnalysis({
      transaction,
      env,
      model,
      fetchImpl,
      adapter,
      timeoutMs: options.timeoutMs,
      requestId: `a5-10-openai-multimodal-request-${modelRequestsAttempted}`,
      transactionsRequested: 1
    });
    reports.push(analysis.report);

    if (analysis.report.modelRequestsCompleted === 1) {
      modelRequestsCompleted += 1;
    } else {
      modelRequestFailures += 1;
      failureCategories.push(analysis.report.sanitizedFailureCategory || 'model_invalid_response');
    }
  }

  const uniqueTransactionsEvaluated = reports.length;
  const status = uniqueTransactionsEvaluated === 0
    ? SAMPLE_EXECUTION_STATUS.NO_ELIGIBLE_IMAGES
    : modelRequestFailures > 0 || transactionsWithoutImages > 0
      ? SAMPLE_EXECUTION_STATUS.PARTIALLY_COMPLETED
      : SAMPLE_EXECUTION_STATUS.COMPLETED;

  return deepFreeze({
    source: SOURCE,
    version: VERSION,
    schemaVersion: SCHEMA_VERSION,
    sampleGateValidation: gates,
    report: buildFeasibilitySampleReport({
      model,
      sampleExecutionStatus: status,
      transactionsRequested: MAX_FEASIBILITY_SAMPLE_TRANSACTIONS,
      transactionsReturned: returnedRecords.length,
      uniqueTransactionsEvaluated,
      duplicateTransactionsSkipped,
      transactionsWithoutImages,
      imagesEvaluated,
      modelRequestsAttempted,
      modelRequestsCompleted,
      modelRequestFailures,
      reports,
      sanitizedFailureCategories: failureCategories
    }),
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  });
}

module.exports = {
  SOURCE,
  VERSION,
  SCHEMA_VERSION,
  FEASIBILITY_SAMPLE_LIVE_FLAG_ENV,
  MAX_FEASIBILITY_SAMPLE_TRANSACTIONS,
  MAX_FEASIBILITY_SAMPLE_IMAGES,
  MAX_FEASIBILITY_SAMPLE_MODEL_REQUESTS,
  DEFAULT_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  DEFAULT_MAX_OUTPUT_TOKENS,
  MAX_OUTPUT_TOKENS,
  SAMPLE_EXECUTION_STATUS,
  validateOpenAIFeasibilitySampleGates,
  runOpenAIMultimodalFeasibilitySample
};
