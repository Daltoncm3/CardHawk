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
  DEFAULT_REQUESTED_FIELDS
} = require('./multimodalModelAdapterContract');
const {
  asArray,
  asObject,
  fingerprint,
  unique
} = require('./canonicalValidationCore');
const {
  buildTitleProviderEvidenceCandidates
} = require('./titleProviderEvidenceCandidateLayer');
const {
  ELIGIBILITY_CLASSIFICATION_ORDER,
  ELIGIBILITY_REASON_CODES,
  reviewTitleProviderCandidateAdmissionEligibility
} = require('./titleProviderCandidateAdmissionEligibilityReview');

const SOURCE = 'multimodal_feasibility_sample';
const VERSION = '0.1.0';
const SCHEMA_VERSION = '1.0.0';

const FEASIBILITY_SAMPLE_LIVE_FLAG_ENV = 'CARDHAWK_MULTIMODAL_FEASIBILITY_SAMPLE_LIVE';
const MAX_FEASIBILITY_SAMPLE_TRANSACTIONS = 3;
const MAX_FEASIBILITY_SAMPLE_IMAGES = 3;
const MAX_FEASIBILITY_SAMPLE_MODEL_REQUESTS = 3;
const FEASIBILITY_SAMPLE_MAX_OUTPUT_TOKENS = MAX_OUTPUT_TOKENS;
const FEASIBILITY_SAMPLE_REASONING_EFFORT = 'low';
const FEASIBILITY_SAMPLE_TEXT_VERBOSITY = 'low';
const FEASIBILITY_SAMPLE_REQUESTED_FIELDS = Object.freeze(
  MATERIAL_FIELDS.filter((field) => DEFAULT_REQUESTED_FIELDS.includes(field)).sort()
);
const FEASIBILITY_SAMPLE_MAX_OBSERVATIONS = FEASIBILITY_SAMPLE_REQUESTED_FIELDS.length;
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

const EVIDENCE_ACQUISITION_SOURCES = Object.freeze([
  'provider_metadata',
  'explicit_title_evidence',
  'additional_image_or_view',
  'slab_label',
  'image_ocr',
  'manual_verification'
]);

const NON_VISUAL_MATERIAL_FIELDS = Object.freeze([
  'sport',
  'year',
  'manufacturer',
  'setName'
]);

const ABSENCE_SENSITIVE_MATERIAL_FIELDS = Object.freeze([
  'autographState',
  'memorabiliaState',
  'serialNumbered',
  'rawOrGraded'
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

function addBlockerClassificationCounts(target, source = {}) {
  const allowlist = Object.values(FEASIBILITY_CLASSIFICATIONS);
  const seen = new Set();
  for (const [field, classifications] of Object.entries(asObject(source))) {
    const safeField = String(field || '').trim();
    if (!safeField) continue;
    const values = Array.isArray(classifications) ? classifications : [classifications];
    for (const classification of unique(values.map((value) => String(value || '').trim())).sort()) {
      if (!allowlist.includes(classification)) continue;
      const dedupeKey = `${safeField}:${classification}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      incrementCount(target, classification, 1, allowlist);
    }
  }
}

function orderedUniqueAllowed(values = [], allowlist = []) {
  const allowed = new Set(allowlist);
  return unique(asArray(values)
    .map((value) => String(value || '').trim())
    .filter((value) => allowed.has(value)))
    .sort((left, right) => allowlist.indexOf(left) - allowlist.indexOf(right));
}

function sourcePlanFromRequiredCategories(field, categories = []) {
  const mapped = [];
  for (const category of asArray(categories)) {
    if (category === 'provider_metadata') mapped.push('provider_metadata');
    if (category === 'explicit_title_evidence') mapped.push('explicit_title_evidence');
    if (category === 'additional_image_or_view' || category === 'explicit_visual_evidence') mapped.push('additional_image_or_view');
    if (category === 'slab_label') mapped.push('slab_label');
    if (category === 'image_ocr') mapped.push('image_ocr');
    if (category === 'manual_verification') mapped.push('manual_verification');
  }

  if (NON_VISUAL_MATERIAL_FIELDS.includes(field)) {
    return orderedUniqueAllowed(
      mapped.filter((source) => source !== 'additional_image_or_view' && source !== 'slab_label' && source !== 'image_ocr')
        .concat(['provider_metadata', 'explicit_title_evidence', 'manual_verification']),
      EVIDENCE_ACQUISITION_SOURCES
    );
  }

  return orderedUniqueAllowed(mapped.length ? mapped : ['manual_verification'], EVIDENCE_ACQUISITION_SOURCES);
}

function reasonCodesForEvidencePlan(field, classification, sources = []) {
  const reasonCodes = [];
  if (classification === FEASIBILITY_CLASSIFICATIONS.CONFLICT_REQUIRES_RESOLUTION) {
    reasonCodes.push('conflict_requires_deterministic_resolution');
    reasonCodes.push('model_confidence_cannot_resolve_conflict');
  }
  if (ABSENCE_SENSITIVE_MATERIAL_FIELDS.includes(field)) {
    reasonCodes.push('absence_sensitive_requires_explicit_evidence');
    reasonCodes.push('nonappearance_is_not_resolution_evidence');
  }
  if (NON_VISUAL_MATERIAL_FIELDS.includes(field)) {
    reasonCodes.push('non_visual_field_not_routed_to_multimodal_vision');
  }
  if (sources.includes('manual_verification')) reasonCodes.push('manual_verification_available');
  if (!sources.some((source) => source !== 'manual_verification')) reasonCodes.push('no_automated_resolution_path');
  return unique(reasonCodes).sort();
}

function buildEvidenceAcquisitionPlanForReport(report = {}) {
  const missingFields = asArray(report.missingMaterialFieldsAfter);
  const conflictFields = asArray(report.conflictFields);
  const unresolvedFields = orderedUniqueAllowed([...missingFields, ...conflictFields], MATERIAL_FIELDS);
  const classifications = asObject(report.blockerClassificationByField);
  const requiredByField = asObject(report.requiredEvidenceCategoriesByField);
  const plan = {};

  for (const field of unresolvedFields) {
    const classification = String(classifications[field] || '').trim();
    const sources = classification === FEASIBILITY_CLASSIFICATIONS.CONFLICT_REQUIRES_RESOLUTION
      ? ['manual_verification']
      : sourcePlanFromRequiredCategories(field, requiredByField[field]);
    const safeSources = orderedUniqueAllowed(sources, EVIDENCE_ACQUISITION_SOURCES);
    plan[field] = deepFreeze({
      blockerClassification: Object.values(FEASIBILITY_CLASSIFICATIONS).includes(classification)
        ? classification
        : FEASIBILITY_CLASSIFICATIONS.UNKNOWN_RESOLUTION_PATH,
      nextEvidenceSources: safeSources,
      reasonCodes: reasonCodesForEvidencePlan(field, classification, safeSources)
    });
  }

  return deepFreeze(Object.fromEntries(Object.entries(plan).sort(([left], [right]) => left.localeCompare(right))));
}

function addEvidenceAcquisitionPlanCounts(totals, plan = {}) {
  const sourceSeenInTransaction = new Set();
  for (const [field, entry] of Object.entries(asObject(plan))) {
    const sources = orderedUniqueAllowed(entry.nextEvidenceSources, EVIDENCE_ACQUISITION_SOURCES);
    if (!totals.evidenceAcquisitionPlanByField[field]) totals.evidenceAcquisitionPlanByField[field] = new Set();
    for (const source of sources) {
      totals.evidenceAcquisitionPlanByField[field].add(source);
      if (!totals.fieldsRequiringEvidenceSource[source]) totals.fieldsRequiringEvidenceSource[source] = new Set();
      totals.fieldsRequiringEvidenceSource[source].add(field);
      sourceSeenInTransaction.add(source);
    }
    if (sources.includes('manual_verification')) totals.manualVerificationFrequency += 1;
    if (sources.includes('additional_image_or_view') || sources.includes('image_ocr') || sources.includes('slab_label')) {
      totals.anotherImageCouldMateriallyHelp = true;
    }
  }
  for (const source of sourceSeenInTransaction) {
    incrementCount(totals.transactionCountsRequiringEvidenceSource, source, 1, EVIDENCE_ACQUISITION_SOURCES);
  }
}

function sortedSourceFieldMap(map = {}) {
  return deepFreeze(Object.fromEntries(EVIDENCE_ACQUISITION_SOURCES
    .map((source) => [source, Array.from(map[source] || []).sort()])
    .filter(([, fields]) => fields.length)));
}

function sortedFieldSourcePlanMap(map = {}) {
  return deepFreeze(Object.fromEntries(Object.entries(asObject(map))
    .filter(([field]) => MATERIAL_FIELDS.includes(field))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([field, sources]) => [
      field,
      orderedUniqueAllowed(Array.from(sources || []), EVIDENCE_ACQUISITION_SOURCES)
    ])
    .filter(([, sources]) => sources.length)));
}

function fieldsWithNoAutomatedResolutionPathFromPlan(planByField = {}) {
  return deepFreeze(Object.entries(asObject(planByField))
    .filter(([, sources]) => {
      const safeSources = orderedUniqueAllowed(sources, EVIDENCE_ACQUISITION_SOURCES);
      return safeSources.includes('manual_verification') &&
        !safeSources.some((source) => source !== 'manual_verification');
    })
    .map(([field]) => field)
    .sort());
}

function sortedSourceCountMap(map = {}) {
  return deepFreeze(Object.fromEntries(EVIDENCE_ACQUISITION_SOURCES
    .map((source) => [source, Math.max(0, Math.floor(Number(asObject(map)[source]) || 0))])
    .filter(([, count]) => count > 0)));
}

function sortedFieldArrayMap(map = {}, fieldAllowlist = MATERIAL_FIELDS, valueAllowlist = null) {
  const allowedFields = new Set(fieldAllowlist);
  const allowedValues = valueAllowlist ? new Set(valueAllowlist) : null;
  return deepFreeze(Object.fromEntries(Object.entries(asObject(map))
    .filter(([field]) => allowedFields.has(field))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([field, values]) => [
      field,
      unique((values instanceof Set ? Array.from(values) : asArray(values))
        .map((value) => String(value || '').trim())
        .filter((value) => value && (!allowedValues || allowedValues.has(value))))
        .sort()
        .slice(0, MAX_DIAGNOSTIC_FIELDS)
    ])
    .filter(([, values]) => values.length)));
}

function addFieldArrayMapSets(target, source = {}, fieldAllowlist = MATERIAL_FIELDS, valueAllowlist = null) {
  const allowedFields = new Set(fieldAllowlist);
  const allowedValues = valueAllowlist ? new Set(valueAllowlist) : null;
  for (const [field, values] of Object.entries(asObject(source))) {
    if (!allowedFields.has(field)) continue;
    if (!target[field]) target[field] = new Set();
    for (const value of asArray(values)) {
      const safeValue = String(value || '').trim();
      if (safeValue && (!allowedValues || allowedValues.has(safeValue))) target[field].add(safeValue);
    }
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

function providerMetadataForCandidateLayer(transaction = {}) {
  const parsed = asObject(transaction.parsedIdentity);
  return {
    sport: parsed.sport || parsed.league,
    subjectName: parsed.player || parsed.subject,
    year: parsed.year,
    manufacturer: parsed.brand || parsed.manufacturer,
    product: parsed.product,
    setName: parsed.setName || parsed.product,
    cardNumber: parsed.cardNumber,
    parallel: parsed.parallel || parsed.variation,
    printRun: parsed.printRun,
    rawOrGraded: transaction.condition,
    gradeCompany: transaction.gradeCompany,
    grade: transaction.grade
  };
}

function sourceReadinessForCandidateAdmission(transaction = {}) {
  return {
    confirmedTrueSoldPriceReady: transaction.providerCompatibility?.canonicalReadySoldPrice === true ||
      (transaction.evidenceType === 'true_sold' && transaction.status === 'active_evidence'),
    canonicalReadySoldPrice: transaction.providerCompatibility?.canonicalReadySoldPrice === true,
    evidenceType: transaction.evidenceType || 'unknown',
    status: transaction.status || 'unknown'
  };
}

function buildCandidateDiagnosticsForTransaction(transaction = {}, report = {}) {
  const candidateArtifact = buildTitleProviderEvidenceCandidates({
    normalizedListingTitle: transaction.rawTitle || transaction.title || '',
    providerMetadata: providerMetadataForCandidateLayer(transaction),
    identityDiagnostics: report
  });
  const admissionEligibilityReview = reviewTitleProviderCandidateAdmissionEligibility({
    candidateArtifact,
    sourceReadiness: sourceReadinessForCandidateAdmission(transaction),
    identityDiagnostics: report
  });

  return {
    candidateDiagnostics: candidateArtifact.diagnostics,
    admissionEligibilityDiagnostics: admissionEligibilityReview.diagnostics
  };
}

function mergeCandidateDiagnosticsIntoReport(report = {}, transaction = {}) {
  const {
    candidateDiagnostics,
    admissionEligibilityDiagnostics
  } = buildCandidateDiagnosticsForTransaction(transaction, report);
  return deepFreeze({
    ...report,
    candidateFields: candidateDiagnostics.candidateFields,
    candidateCountByField: candidateDiagnostics.candidateCountByField,
    candidateProvenanceCategoriesByField: candidateDiagnostics.candidateProvenanceCategoriesByField,
    candidateReasonCodesByField: candidateDiagnostics.candidateReasonCodesByField,
    candidateConflictFields: candidateDiagnostics.candidateConflictFields,
    fieldsStillRequiringAdditionalEvidence: candidateDiagnostics.fieldsStillRequiringAdditionalEvidence,
    titleOrMetadataCouldMateriallyHelp: candidateDiagnostics.titleOrMetadataCouldMateriallyHelp,
    admissionEligibilityClassificationFrequency: admissionEligibilityDiagnostics.admissionEligibilityClassificationFrequency,
    eligibleCandidateFields: admissionEligibilityDiagnostics.eligibleCandidateFields,
    eligibleCandidateCountByField: admissionEligibilityDiagnostics.eligibleCandidateCountByField,
    ineligibleCandidateFields: admissionEligibilityDiagnostics.ineligibleCandidateFields,
    ineligibilityReasonCodesByField: admissionEligibilityDiagnostics.ineligibilityReasonCodesByField,
    unresolvedAdmissionConflictFields: admissionEligibilityDiagnostics.unresolvedAdmissionConflictFields,
    manualReviewCandidateFields: admissionEligibilityDiagnostics.manualReviewCandidateFields,
    transactionsWithFutureAdmissionEligibleCandidates: admissionEligibilityDiagnostics.transactionsWithFutureAdmissionEligibleCandidates,
    futureDeterministicAdmissionCouldMateriallyHelp: admissionEligibilityDiagnostics.futureDeterministicAdmissionCouldMateriallyHelp
  });
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
    candidateFields: [],
    candidateCountByField: {},
    candidateProvenanceCategoriesByField: {},
    candidateReasonCodesByField: {},
    candidateConflictFields: [],
    fieldsStillRequiringAdditionalEvidence: [],
    titleOrMetadataCouldMateriallyHelp: false,
    admissionEligibilityClassificationFrequency: {},
    eligibleCandidateFields: [],
    eligibleCandidateCountByField: {},
    ineligibleCandidateFields: [],
    ineligibilityReasonCodesByField: {},
    unresolvedAdmissionConflictFields: [],
    manualReviewCandidateFields: [],
    transactionsWithFutureAdmissionEligibleCandidates: 0,
    futureDeterministicAdmissionCouldMateriallyHelp: false,
    evidenceAcquisitionPlanByField: {},
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
    candidateCountByField: {},
    candidateProvenanceCategoriesByField: {},
    candidateReasonCodesByField: {},
    candidateConflictFields: {},
    fieldsStillRequiringAdditionalEvidence: {},
    admissionEligibilityClassificationFrequency: {},
    eligibleCandidateCountByField: {},
    ineligibleCandidateFields: {},
    ineligibilityReasonCodesByField: {},
    unresolvedAdmissionConflictFields: {},
    manualReviewCandidateFields: {},
    fieldsRequiringEvidenceSource: {},
    transactionCountsRequiringEvidenceSource: {},
    boundedTokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, modelRequests: 0, inputImages: 0 }
  };
  const evidencePlanTotals = {
    evidenceAcquisitionPlanByField: {},
    fieldsRequiringEvidenceSource: {},
    transactionCountsRequiringEvidenceSource: {},
    manualVerificationFrequency: 0,
    anotherImageCouldMateriallyHelp: false
  };
  let classificationImprovementCount = 0;
  let exactReachedCount = 0;
  let canonicalSoldEvidenceStructurallyReadyCount = 0;
  let admittedObservationCount = 0;
  let rejectedObservationCount = 0;
  let transactionsRequiringAdditionalEvidence = 0;
  let transactionsWithFutureAdmissionEligibleCandidates = 0;
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
    addBlockerClassificationCounts(totals.blockerClassificationFrequency, report.blockerClassificationByField);
    addMapCounts(totals.candidateCountByField, report.candidateCountByField, MATERIAL_FIELDS);
    for (const field of asArray(report.candidateConflictFields)) incrementCount(totals.candidateConflictFields, field, 1, MATERIAL_FIELDS);
    for (const field of asArray(report.fieldsStillRequiringAdditionalEvidence)) {
      incrementCount(totals.fieldsStillRequiringAdditionalEvidence, field, 1, MATERIAL_FIELDS);
    }
    for (const [field, categories] of Object.entries(asObject(report.candidateProvenanceCategoriesByField))) {
      if (!totals.candidateProvenanceCategoriesByField[field]) totals.candidateProvenanceCategoriesByField[field] = new Set();
      for (const category of asArray(categories)) totals.candidateProvenanceCategoriesByField[field].add(category);
    }
    addFieldArrayMapSets(totals.candidateReasonCodesByField, report.candidateReasonCodesByField, MATERIAL_FIELDS, [
      'candidate_only_not_admitted',
      'explicit_title_candidate',
      'provider_metadata_candidate',
      'title_provider_metadata_agreement',
      'title_provider_metadata_conflict'
    ]);
    addMapCounts(
      totals.admissionEligibilityClassificationFrequency,
      report.admissionEligibilityClassificationFrequency,
      ELIGIBILITY_CLASSIFICATION_ORDER
    );
    addMapCounts(totals.eligibleCandidateCountByField, report.eligibleCandidateCountByField, MATERIAL_FIELDS);
    for (const field of asArray(report.ineligibleCandidateFields)) incrementCount(totals.ineligibleCandidateFields, field, 1, MATERIAL_FIELDS);
    addFieldArrayMapSets(
      totals.ineligibilityReasonCodesByField,
      report.ineligibilityReasonCodesByField,
      MATERIAL_FIELDS,
      ELIGIBILITY_REASON_CODES
    );
    for (const field of asArray(report.unresolvedAdmissionConflictFields)) {
      incrementCount(totals.unresolvedAdmissionConflictFields, field, 1, MATERIAL_FIELDS);
    }
    for (const field of asArray(report.manualReviewCandidateFields)) incrementCount(totals.manualReviewCandidateFields, field, 1, MATERIAL_FIELDS);
    transactionsWithFutureAdmissionEligibleCandidates += Math.max(0, Number(report.transactionsWithFutureAdmissionEligibleCandidates) || 0);
    for (const categories of Object.values(asObject(report.requiredEvidenceCategoriesByField))) {
      for (const category of asArray(categories)) incrementCount(totals.requiredEvidenceCategoryFrequency, category, 1, EVIDENCE_CATEGORY_CODES);
    }
    addEvidenceAcquisitionPlanCounts(evidencePlanTotals, buildEvidenceAcquisitionPlanForReport(report));
    if (report.additionalEvidenceRequired) transactionsRequiringAdditionalEvidence += 1;
    recoveryRateSum += Math.max(0, Number(report.materialFieldRecoveryRate) || 0);
    sumBoundedUsage(totals.boundedTokenUsage, report.boundedUsage);
  }

  const evaluated = Math.max(0, Number(input.uniqueTransactionsEvaluated) || 0);
  const evidenceAcquisitionPlanByField = sortedFieldSourcePlanMap(evidencePlanTotals.evidenceAcquisitionPlanByField);
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
    candidateFields: Object.keys(sortedCountMap(totals.candidateCountByField, MATERIAL_FIELDS)),
    candidateCountByField: sortedCountMap(totals.candidateCountByField, MATERIAL_FIELDS),
    candidateProvenanceCategoriesByField: sortedFieldArrayMap(totals.candidateProvenanceCategoriesByField, MATERIAL_FIELDS, [
      'explicit_title_evidence',
      'provider_metadata'
    ]),
    candidateReasonCodesByField: sortedFieldArrayMap(totals.candidateReasonCodesByField, MATERIAL_FIELDS, [
      'candidate_only_not_admitted',
      'explicit_title_candidate',
      'provider_metadata_candidate',
      'title_provider_metadata_agreement',
      'title_provider_metadata_conflict'
    ]),
    candidateConflictFields: Object.keys(sortedCountMap(totals.candidateConflictFields, MATERIAL_FIELDS)),
    fieldsStillRequiringAdditionalEvidence: Object.keys(sortedCountMap(totals.fieldsStillRequiringAdditionalEvidence, MATERIAL_FIELDS)),
    titleOrMetadataCouldMateriallyHelp: reports.some((report) => report.titleOrMetadataCouldMateriallyHelp === true),
    admissionEligibilityClassificationFrequency: sortedCountMap(
      totals.admissionEligibilityClassificationFrequency,
      ELIGIBILITY_CLASSIFICATION_ORDER
    ),
    eligibleCandidateFields: Object.keys(sortedCountMap(totals.eligibleCandidateCountByField, MATERIAL_FIELDS)),
    eligibleCandidateCountByField: sortedCountMap(totals.eligibleCandidateCountByField, MATERIAL_FIELDS),
    ineligibleCandidateFields: Object.keys(sortedCountMap(totals.ineligibleCandidateFields, MATERIAL_FIELDS)),
    ineligibilityReasonCodesByField: sortedFieldArrayMap(
      totals.ineligibilityReasonCodesByField,
      MATERIAL_FIELDS,
      ELIGIBILITY_REASON_CODES
    ),
    unresolvedAdmissionConflictFields: Object.keys(sortedCountMap(totals.unresolvedAdmissionConflictFields, MATERIAL_FIELDS)),
    manualReviewCandidateFields: Object.keys(sortedCountMap(totals.manualReviewCandidateFields, MATERIAL_FIELDS)),
    transactionsWithFutureAdmissionEligibleCandidates,
    futureDeterministicAdmissionCouldMateriallyHelp: transactionsWithFutureAdmissionEligibleCandidates > 0,
    evidenceAcquisitionPlanByField,
    fieldsRequiringEvidenceSource: sortedSourceFieldMap(evidencePlanTotals.fieldsRequiringEvidenceSource),
    transactionCountsRequiringEvidenceSource: sortedSourceCountMap(evidencePlanTotals.transactionCountsRequiringEvidenceSource),
    fieldsWithNoAutomatedResolutionPath: fieldsWithNoAutomatedResolutionPathFromPlan(evidenceAcquisitionPlanByField),
    manualVerificationFrequency: evidencePlanTotals.manualVerificationFrequency,
    anotherImageCouldMateriallyHelp: evidencePlanTotals.anotherImageCouldMateriallyHelp,
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
      maxOutputTokens: FEASIBILITY_SAMPLE_MAX_OUTPUT_TOKENS,
      maxObservations: FEASIBILITY_SAMPLE_MAX_OBSERVATIONS,
      reasoningEffort: FEASIBILITY_SAMPLE_REASONING_EFFORT,
      textVerbosity: FEASIBILITY_SAMPLE_TEXT_VERBOSITY,
      requestedFields: FEASIBILITY_SAMPLE_REQUESTED_FIELDS,
      requestId: `a5-10-openai-multimodal-request-${modelRequestsAttempted}`,
      transactionsRequested: 1
    });
    reports.push(mergeCandidateDiagnosticsIntoReport(analysis.report, transaction));

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
  FEASIBILITY_SAMPLE_MAX_OUTPUT_TOKENS,
  FEASIBILITY_SAMPLE_REASONING_EFFORT,
  FEASIBILITY_SAMPLE_TEXT_VERBOSITY,
  FEASIBILITY_SAMPLE_MAX_OBSERVATIONS,
  FEASIBILITY_SAMPLE_REQUESTED_FIELDS,
  DEFAULT_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  DEFAULT_MAX_OUTPUT_TOKENS,
  MAX_OUTPUT_TOKENS,
  SAMPLE_EXECUTION_STATUS,
  EVIDENCE_ACQUISITION_SOURCES,
  validateOpenAIFeasibilitySampleGates,
  buildEvidenceAcquisitionPlanForReport,
  runOpenAIMultimodalFeasibilitySample
};
