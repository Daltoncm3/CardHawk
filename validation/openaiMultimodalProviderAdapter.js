'use strict';

const {
  API_KEY_ENV: CARD_API_KEY_ENV,
  CONTROL_IDENTITY,
  CONTROL_QUERY,
  LIVE_FLAG_ENV: CARD_API_LIVE_FLAG_ENV,
  executeCardApiSalesRequest
} = require('../marketplaces/cardApiAcquisitionAdapter');
const {
  EXECUTION_STATUS,
  EVIDENCE_TYPES,
  EXPLICIT_OR_INFERRED,
  buildMultimodalModelPromptContract,
  buildSanitizedMultimodalPilotReport,
  createMultimodalModelRequest,
  mapModelObservationToEvidenceObservation,
  validateMultimodalModelRequest,
  validateMultimodalModelResponse
} = require('./multimodalModelAdapterContract');
const {
  EVIDENCE_MODALITIES,
  resolveMultimodalSoldIdentityEvidence
} = require('./multimodalSoldIdentityEvidencePilot');
const {
  resolveCardApiTransactionIdentity
} = require('./cardApiIdentityResolutionPilot');
const {
  asArray,
  asObject,
  fingerprint,
  unique
} = require('./canonicalValidationCore');

const SOURCE = 'openai_multimodal_provider_adapter';
const VERSION = '0.1.0';
const SCHEMA_VERSION = '1.0.0';

const PROVIDER_ID = 'openai';
const ADAPTER_ID = 'openai_responses_multimodal_adapter';
const OPENAI_API_KEY_ENV = 'OPENAI_API_KEY';
const OPENAI_MODEL_ENV = 'CARDHAWK_OPENAI_MULTIMODAL_MODEL';
const OPENAI_LIVE_FLAG_ENV = 'CARDHAWK_OPENAI_MULTIMODAL_LIVE';
const DEFAULT_OPENAI_MODEL = 'gpt-5-mini';
const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const DEFAULT_TIMEOUT_MS = 60000;
const MAX_TIMEOUT_MS = 60000;
const DEFAULT_MAX_OUTPUT_TOKENS = 4000;
const MAX_OUTPUT_TOKENS = 4000;
const MAX_TRANSACTIONS = 1;
const MAX_IMAGES = 1;
const MAX_MODEL_REQUESTS = 1;
const MAX_OBSERVATIONS = 12;

const LIVE_STATUS = Object.freeze({
  DISABLED: 'LIVE_NOT_RUN_DISABLED',
  MISSING_CARD_API_CREDENTIAL: 'LIVE_NOT_RUN_MISSING_CARD_API_CREDENTIAL',
  MISSING_CARD_API_FLAG: 'LIVE_NOT_RUN_MISSING_CARD_API_FLAG',
  MISSING_OPENAI_CREDENTIAL: 'LIVE_NOT_RUN_MISSING_OPENAI_CREDENTIAL',
  MISSING_OPENAI_FLAG: 'LIVE_NOT_RUN_MISSING_OPENAI_FLAG',
  INVALID_LIMITS: 'LIVE_NOT_RUN_INVALID_LIMITS',
  FETCH_UNAVAILABLE: 'LIVE_NOT_RUN_FETCH_UNAVAILABLE',
  CARD_API_NO_TRANSACTION: 'LIVE_COMPLETED_NO_TRANSACTION',
  CARD_API_NO_IMAGE: 'LIVE_COMPLETED_NO_IMAGE',
  MODEL_INVALID_RESPONSE: 'LIVE_COMPLETED_MODEL_INVALID_RESPONSE',
  MODEL_REQUEST_FAILED: 'LIVE_COMPLETED_MODEL_REQUEST_FAILED',
  COMPLETED: 'LIVE_COMPLETED'
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function enabled(env = {}, key = '') {
  return String(env[key] || '').toLowerCase() === 'true';
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

function safeModelName(value) {
  return String(value || DEFAULT_OPENAI_MODEL)
    .replace(/[^A-Za-z0-9_.:-]+/g, '')
    .slice(0, 80) || DEFAULT_OPENAI_MODEL;
}

function requestedLimit(value, fallback = 1) {
  const number = Number(value ?? fallback);
  if (!Number.isFinite(number)) return fallback;
  return Math.floor(number);
}

function normalizeOpenAITimeoutMs(value = DEFAULT_TIMEOUT_MS) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.min(Math.floor(numeric), MAX_TIMEOUT_MS);
}

function normalizeOpenAIMaxOutputTokens(value = DEFAULT_MAX_OUTPUT_TOKENS) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return DEFAULT_MAX_OUTPUT_TOKENS;
  return Math.min(Math.floor(numeric), MAX_OUTPUT_TOKENS);
}

function buildOpenAIObservationJsonSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: [
      'requestId',
      'adapterId',
      'providerId',
      'modelId',
      'executionStatus',
      'observations',
      'warnings',
      'errors',
      'usage',
      'nonPersistent',
      'writesProductionStore',
      'productionImpact',
      'decisionImpact',
      'executionAuthority'
    ],
    properties: {
      requestId: { type: 'string' },
      adapterId: { type: 'string', enum: [ADAPTER_ID] },
      providerId: { type: 'string', enum: [PROVIDER_ID] },
      modelId: { type: 'string' },
      executionStatus: { type: 'string', enum: [EXECUTION_STATUS.SUCCESS] },
      observations: {
        type: 'array',
        maxItems: MAX_OBSERVATIONS,
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'field',
            'proposedValue',
            'confidence',
            'evidenceType',
            'modality',
            'explicitOrInferred',
            'deterministicVerificationPossible',
            'ambiguity',
            'warnings',
            'multipleCardsVisible'
          ],
          properties: {
            field: {
              type: 'string',
              enum: [
                'subjectName',
                'cardNumber',
                'year',
                'manufacturer',
                'product',
                'setName',
                'parallel',
                'rookieDesignation',
                'autographState',
                'memorabiliaState',
                'serialNumbered',
                'printRun',
                'rawOrGraded',
                'gradeCompany',
                'grade'
              ]
            },
            proposedValue: {
              anyOf: [
                { type: 'string' },
                { type: 'number' },
                { type: 'boolean' }
              ]
            },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
            evidenceType: {
              type: 'string',
              enum: [
                EVIDENCE_TYPES.EXPLICIT_VISUAL,
                EVIDENCE_TYPES.INFERRED_VISUAL,
                EVIDENCE_TYPES.UNKNOWN
              ]
            },
            modality: {
              type: 'string',
              enum: [
                EVIDENCE_MODALITIES.IMAGE,
                EVIDENCE_MODALITIES.IMAGE_OCR,
                EVIDENCE_MODALITIES.SLAB_LABEL
              ]
            },
            explicitOrInferred: {
              type: 'string',
              enum: [
                EXPLICIT_OR_INFERRED.EXPLICIT,
                EXPLICIT_OR_INFERRED.INFERRED,
                EXPLICIT_OR_INFERRED.UNKNOWN
              ]
            },
            deterministicVerificationPossible: { type: 'boolean' },
            ambiguity: {
              type: 'array',
              items: { type: 'string' },
              maxItems: 8
            },
            warnings: {
              type: 'array',
              items: { type: 'string' },
              maxItems: 8
            },
            multipleCardsVisible: { type: 'boolean' }
          }
        }
      },
      warnings: {
        type: 'array',
        items: { type: 'string' },
        maxItems: 12
      },
      errors: {
        type: 'array',
        items: { type: 'string' },
        maxItems: 12
      },
      usage: {
        type: 'object',
        additionalProperties: false,
        required: ['modelRequests', 'inputImages'],
        properties: {
          modelRequests: { type: 'number' },
          inputImages: { type: 'number' }
        }
      },
      nonPersistent: { type: 'boolean', enum: [true] },
      writesProductionStore: { type: 'boolean', enum: [false] },
      productionImpact: { type: 'string', enum: ['none'] },
      decisionImpact: { type: 'string', enum: ['none'] },
      executionAuthority: { type: 'string', enum: ['none'] }
    }
  };
}

function buildOpenAIResponsesRequestBody(requestInput = {}, options = {}) {
  const request = createMultimodalModelRequest(requestInput);
  const prompt = buildMultimodalModelPromptContract(request);
  const model = safeModelName(options.model || DEFAULT_OPENAI_MODEL);
  const instructionText = [
    ...prompt.instructions,
    'Return only a single JSON object matching the strict schema.',
    'Do not include prose, Markdown, explanations, or provider-specific metadata.',
    'If a field is not visibly explicit, return unknown_not_observable or proposedValue "unknown".',
    `Request ID: ${request.requestId}`,
    `Title context, untrusted and non-authoritative: ${request.titleContext || 'unknown'}`
  ].join('\n');

  return deepFreeze({
    model,
    input: [
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: instructionText
          },
          {
            type: 'input_image',
            image_url: request.imageReference,
            detail: 'low'
          }
        ]
      }
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'cardhawk_multimodal_observations',
        description: 'Strict CardHawk visual identity observations only.',
        strict: true,
        schema: buildOpenAIObservationJsonSchema()
      }
    },
    max_output_tokens: normalizeOpenAIMaxOutputTokens(options.maxOutputTokens),
    store: false
  });
}

function extractOpenAIOutputText(payload = {}) {
  if (typeof payload.output_text === 'string') return payload.output_text;
  const outputs = asArray(payload.output);
  for (const output of outputs) {
    const content = asArray(output.content);
    for (const item of content) {
      if (typeof item.text === 'string') return item.text;
      if (typeof item.output_text === 'string') return item.output_text;
    }
  }
  return '';
}

function sanitizeOpenAIUsage(payload = {}) {
  const usage = asObject(payload.usage);
  return {
    inputTokens: Number.isFinite(Number(usage.input_tokens)) ? Number(usage.input_tokens) : null,
    outputTokens: Number.isFinite(Number(usage.output_tokens)) ? Number(usage.output_tokens) : null,
    totalTokens: Number.isFinite(Number(usage.total_tokens)) ? Number(usage.total_tokens) : null
  };
}

function sanitizeOpenAIIncompleteReason(payload = {}) {
  const reason = sanitizeErrorCode(asObject(payload.incomplete_details).reason || '');
  const allowedReasons = new Set(['max_output_tokens', 'content_filter']);
  return allowedReasons.has(reason) ? reason : 'unknown_incomplete_reason';
}

async function buildOpenAIErrorDiagnostics(response = {}) {
  const diagnostics = {
    providerStatus: response?.status || null,
    openAiErrorType: null,
    openAiErrorCode: null,
    openAiErrorParam: null
  };

  try {
    const payload = typeof response.json === 'function' ? await response.json() : {};
    const error = asObject(payload.error);
    diagnostics.openAiErrorType = error.type ? sanitizeErrorCode(error.type) : null;
    diagnostics.openAiErrorCode = error.code ? sanitizeErrorCode(error.code) : null;
    diagnostics.openAiErrorParam = error.param ? sanitizeErrorCode(error.param) : null;
  } catch (_) {
    diagnostics.openAiErrorType = 'unavailable';
  }

  return diagnostics;
}

function normalizeOpenAIParsedResponse(parsed = {}, request = {}, model = DEFAULT_OPENAI_MODEL, usage = null) {
  const input = asObject(parsed);
  return {
    requestId: input.requestId || request.requestId,
    adapterId: ADAPTER_ID,
    providerId: PROVIDER_ID,
    modelId: safeModelName(input.modelId || model),
    executionStatus: input.executionStatus || EXECUTION_STATUS.SUCCESS,
    observations: asArray(input.observations).slice(0, MAX_OBSERVATIONS),
    warnings: asArray(input.warnings),
    errors: asArray(input.errors),
    usage: {
      modelRequests: 1,
      inputImages: 1,
      ...(usage || {})
    },
    nonPersistent: true,
    writesProductionStore: false,
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
}

function safeAdapterResponse(requestId, model, status, errors = [], warnings = [], usage = null) {
  return {
    requestId: requestId || null,
    adapterId: ADAPTER_ID,
    providerId: PROVIDER_ID,
    modelId: safeModelName(model),
    executionStatus: status,
    observations: [],
    warnings: asArray(warnings).map(sanitizeErrorCode).sort(),
    errors: asArray(errors).map(sanitizeErrorCode).sort(),
    usage,
    nonPersistent: true,
    writesProductionStore: false,
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
}

function createOpenAIMultimodalProviderAdapter(options = {}) {
  const env = options.env || process.env;
  const model = safeModelName(options.model || env[OPENAI_MODEL_ENV] || DEFAULT_OPENAI_MODEL);
  const apiUrl = options.apiUrl || OPENAI_RESPONSES_URL;
  const timeoutMs = normalizeOpenAITimeoutMs(options.timeoutMs);

  return deepFreeze({
    adapterId: ADAPTER_ID,
    providerId: PROVIDER_ID,
    modelId: model,
    networkEnabled: true,
    nonPersistent: true,
    writesProductionStore: false,

    async analyzeImage(requestInput = {}, runOptions = {}) {
      const validation = validateMultimodalModelRequest(requestInput);
      if (!validation.valid) {
        return safeAdapterResponse(requestInput.requestId, model, EXECUTION_STATUS.INVALID_REQUEST, validation.reasonCodes);
      }
      const request = validation.request;
      const key = String((runOptions.env || env)[OPENAI_API_KEY_ENV] || '').trim();
      if (!key) {
        return safeAdapterResponse(request.requestId, model, EXECUTION_STATUS.NOT_CONFIGURED, ['openai_api_key_missing']);
      }
      if (!enabled(runOptions.env || env, OPENAI_LIVE_FLAG_ENV)) {
        return safeAdapterResponse(request.requestId, model, EXECUTION_STATUS.NOT_CONFIGURED, ['openai_live_flag_missing']);
      }
      const fetchImpl = runOptions.fetchImpl || options.fetchImpl || globalThis.fetch;
      if (typeof fetchImpl !== 'function') {
        return safeAdapterResponse(request.requestId, model, EXECUTION_STATUS.NOT_CONFIGURED, ['fetch_unavailable']);
      }

      const body = buildOpenAIResponsesRequestBody(request, { model, maxOutputTokens: runOptions.maxOutputTokens || options.maxOutputTokens });
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

      try {
        const response = await fetchImpl(apiUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body),
          signal: controller?.signal
        });
        if (timer) clearTimeout(timer);

        if (!response || response.ok !== true) {
          const diagnostics = await buildOpenAIErrorDiagnostics(response);
          return safeAdapterResponse(request.requestId, model, EXECUTION_STATUS.ERROR, ['openai_request_failed'], [], {
            modelRequests: 1,
            inputImages: 1,
            ...diagnostics
          });
        }

        const payload = typeof response.json === 'function' ? await response.json() : {};
        if (payload.status && payload.status !== 'completed') {
          return safeAdapterResponse(request.requestId, model, EXECUTION_STATUS.INVALID_RESPONSE, [`openai_response_${payload.status}`], [], {
            modelRequests: 1,
            inputImages: 1,
            ...sanitizeOpenAIUsage(payload),
            openAiIncompleteReason: payload.status === 'incomplete'
              ? sanitizeOpenAIIncompleteReason(payload)
              : null
          });
        }

        const outputText = extractOpenAIOutputText(payload);
        let parsed;
        try {
          parsed = JSON.parse(outputText);
        } catch (_) {
          return safeAdapterResponse(request.requestId, model, EXECUTION_STATUS.INVALID_RESPONSE, ['openai_output_not_json'], [], {
            modelRequests: 1,
            inputImages: 1,
            ...sanitizeOpenAIUsage(payload)
          });
        }

        const normalized = normalizeOpenAIParsedResponse(parsed, request, model, sanitizeOpenAIUsage(payload));
        const normalizedValidation = validateMultimodalModelResponse(normalized, request);
        if (!normalizedValidation.valid) {
          return safeAdapterResponse(request.requestId, model, EXECUTION_STATUS.INVALID_RESPONSE, normalizedValidation.reasonCodes, [], {
            modelRequests: 1,
            inputImages: 1,
            ...sanitizeOpenAIUsage(payload)
          });
        }

        return normalized;
      } catch (error) {
        if (timer) clearTimeout(timer);
        return safeAdapterResponse(request.requestId, model, EXECUTION_STATUS.ERROR, [
          error?.name === 'AbortError' ? 'openai_request_timeout' : 'openai_request_exception'
        ], [], {
          modelRequests: 1,
          inputImages: 1
        });
      }
    }
  });
}

function validateOpenAILiveGates(input = {}) {
  const env = input.env || process.env;
  const transactionLimit = requestedLimit(input.transactionLimit ?? input.limit, 1);
  const imageLimit = requestedLimit(input.imageLimit, 1);
  const modelRequestLimit = requestedLimit(input.modelRequestLimit, 1);
  const errors = [];
  const reasonCodes = [];

  if (transactionLimit > MAX_TRANSACTIONS || imageLimit > MAX_IMAGES || modelRequestLimit > MAX_MODEL_REQUESTS) {
    errors.push('requested_limits_exceed_a5_7_bounds');
    reasonCodes.push('a5_7_limit_violation');
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

  return deepFreeze({
    valid: errors.length === 0,
    errors: errors.sort(),
    reasonCodes: unique(reasonCodes).sort(),
    limits: {
      transactionLimit: Math.min(transactionLimit, MAX_TRANSACTIONS),
      imageLimit: Math.min(imageLimit, MAX_IMAGES),
      modelRequestLimit: Math.min(modelRequestLimit, MAX_MODEL_REQUESTS)
    },
    gates: {
      cardApiCredentialPresent: Boolean(String(env[CARD_API_KEY_ENV] || '').trim()),
      cardApiLiveEnabled: enabled(env, CARD_API_LIVE_FLAG_ENV),
      openAiCredentialPresent: Boolean(String(env[OPENAI_API_KEY_ENV] || '').trim()),
      openAiLiveEnabled: enabled(env, OPENAI_LIVE_FLAG_ENV),
      modelConfigured: Boolean(String(env[OPENAI_MODEL_ENV] || DEFAULT_OPENAI_MODEL).trim())
    }
  });
}

function statusFromGateValidation(gates) {
  if (gates.reasonCodes.includes('a5_7_limit_violation')) return LIVE_STATUS.INVALID_LIMITS;
  if (gates.reasonCodes.includes('card_api_key_missing')) return LIVE_STATUS.MISSING_CARD_API_CREDENTIAL;
  if (gates.reasonCodes.includes('card_api_live_flag_missing')) return LIVE_STATUS.MISSING_CARD_API_FLAG;
  if (gates.reasonCodes.includes('openai_api_key_missing')) return LIVE_STATUS.MISSING_OPENAI_CREDENTIAL;
  if (gates.reasonCodes.includes('openai_live_flag_missing')) return LIVE_STATUS.MISSING_OPENAI_FLAG;
  return LIVE_STATUS.DISABLED;
}

function countReasons(entries = []) {
  return asArray(entries).reduce((summary, entry) => {
    const reason = entry.reason || entry.code || entry;
    summary[reason] = (summary[reason] || 0) + 1;
    return summary;
  }, {});
}

function buildSanitizedOpenAIPilotReport(input = {}) {
  const evidenceResult = input.evidenceResult || null;
  const baseReport = buildSanitizedMultimodalPilotReport({
    providerTransactionObtained: input.transactionsEvaluated > 0,
    imageAvailable: input.imagesEvaluated > 0,
    modelRequestExecuted: input.modelRequestsAttempted > 0,
    modelValidation: input.modelValidation,
    evidenceResult,
    cseStructurallyReadyBefore: input.preResolution?.canonicalSoldEvidenceStructurallyReady === true
  });
  const preMissing = asArray(evidenceResult?.preMultimodalMissingMaterialFields || input.preResolution?.missingMaterialFields);
  const postMissing = asArray(evidenceResult?.postMultimodalMissingMaterialFields);
  const report = {
    phase: 'A5.7',
    source: SOURCE,
    version: VERSION,
    schemaVersion: SCHEMA_VERSION,
    providerName: PROVIDER_ID,
    configuredModel: safeModelName(input.model),
    liveExecutionStatus: input.liveExecutionStatus || LIVE_STATUS.DISABLED,
    transactionsRequested: input.transactionsRequested || 0,
    transactionsEvaluated: input.transactionsEvaluated || 0,
    imagesEvaluated: input.imagesEvaluated || 0,
    modelRequestsAttempted: input.modelRequestsAttempted || 0,
    modelRequestsCompleted: input.modelRequestsCompleted || 0,
    preVisionClassification: input.preResolution?.classification || baseReport.preMultimodalClassification,
    postVisionClassification: evidenceResult?.postMultimodalClassification || baseReport.postMultimodalClassification,
    admittedObservationCount: baseReport.observationsAdmittedCount,
    rejectedObservationCount: baseReport.observationsRejectedCount,
    rejectionReasonCounts: countReasons(evidenceResult?.rejectedMultimodalFields),
    missingMaterialFieldCountBefore: preMissing.length,
    missingMaterialFieldCountAfter: postMissing.length,
    conflictCount: baseReport.conflictsCount,
    classificationImproved: Boolean(input.classificationImproved),
    exactReached: evidenceResult?.postMultimodalClassification === 'EXACT',
    canonicalSoldEvidenceStructurallyReady: evidenceResult?.canonicalSoldEvidenceStructurallyReady === true,
    boundedUsage: input.boundedUsage || null,
    sanitizedFailureCategory: input.sanitizedFailureCategory || null,
    nonPersistent: true,
    writesProductionStore: false,
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
  report.reportFingerprint = fingerprint(report);
  return deepFreeze(report);
}

function classificationImproved(pre, post) {
  const score = { UNRESOLVED: 0, AMBIGUOUS: 1, EXACT: 2 };
  return (score[post] || 0) > (score[pre] || 0);
}

async function runOpenAIMultimodalCompatibilityPilot(options = {}) {
  const env = options.env || process.env;
  const model = safeModelName(options.model || env[OPENAI_MODEL_ENV] || DEFAULT_OPENAI_MODEL);
  const gates = validateOpenAILiveGates({
    env,
    transactionLimit: options.transactionLimit ?? options.limit ?? 1,
    imageLimit: options.imageLimit ?? 1,
    modelRequestLimit: options.modelRequestLimit ?? 1
  });

  if (!gates.valid) {
    return {
      source: SOURCE,
      version: VERSION,
      schemaVersion: SCHEMA_VERSION,
      liveGateValidation: gates,
      report: buildSanitizedOpenAIPilotReport({
        model,
        liveExecutionStatus: statusFromGateValidation(gates),
        transactionsRequested: gates.limits.transactionLimit,
        sanitizedFailureCategory: gates.reasonCodes[0] || 'live_gate_blocked'
      }),
      productionImpact: 'none',
      decisionImpact: 'none',
      executionAuthority: 'none'
    };
  }

  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const cardFetchImpl = options.cardApiFetchImpl || fetchImpl;
  if (typeof fetchImpl !== 'function' || typeof cardFetchImpl !== 'function') {
    return {
      source: SOURCE,
      version: VERSION,
      schemaVersion: SCHEMA_VERSION,
      liveGateValidation: gates,
      report: buildSanitizedOpenAIPilotReport({
        model,
        liveExecutionStatus: LIVE_STATUS.FETCH_UNAVAILABLE,
        transactionsRequested: 1,
        sanitizedFailureCategory: 'fetch_unavailable'
      }),
      productionImpact: 'none',
      decisionImpact: 'none',
      executionAuthority: 'none'
    };
  }

  const acquisition = await executeCardApiSalesRequest({
    requestId: 'a5-7-openai-multimodal-card-api-transaction',
    query: options.query || CONTROL_QUERY,
    identity: options.identity || CONTROL_IDENTITY,
    limit: 1,
    filters: asObject(options.filters)
  }, {
    env,
    fetchImpl: cardFetchImpl,
    limit: 1,
    acquiredAt: options.acquiredAt
  });
  const transaction = asArray(acquisition.records)[0] || null;

  if (!transaction) {
    return {
      source: SOURCE,
      version: VERSION,
      schemaVersion: SCHEMA_VERSION,
      liveGateValidation: gates,
      report: buildSanitizedOpenAIPilotReport({
        model,
        liveExecutionStatus: LIVE_STATUS.CARD_API_NO_TRANSACTION,
        transactionsRequested: 1,
        transactionsEvaluated: 0,
        sanitizedFailureCategory: asArray(acquisition.errors)[0]?.code || 'card_api_no_transaction'
      }),
      productionImpact: 'none',
      decisionImpact: 'none',
      executionAuthority: 'none'
    };
  }

  const imageReference = transaction.image || null;
  const preResolution = resolveCardApiTransactionIdentity(transaction);
  if (!imageReference) {
    return {
      source: SOURCE,
      version: VERSION,
      schemaVersion: SCHEMA_VERSION,
      liveGateValidation: gates,
      report: buildSanitizedOpenAIPilotReport({
        model,
        liveExecutionStatus: LIVE_STATUS.CARD_API_NO_IMAGE,
        transactionsRequested: 1,
        transactionsEvaluated: 1,
        imagesEvaluated: 0,
        preResolution,
        sanitizedFailureCategory: 'image_not_available'
      }),
      productionImpact: 'none',
      decisionImpact: 'none',
      executionAuthority: 'none'
    };
  }

  const request = createMultimodalModelRequest({
    requestId: 'a5-7-openai-multimodal-request-1',
    titleContext: transaction.rawTitle || '',
    imageReference,
    modelConfig: {
      provider: PROVIDER_ID,
      model,
      maxRequests: 1,
      maxImages: 1,
      liveCompatibilityFlag: true
    }
  });
  const adapter = options.adapter || createOpenAIMultimodalProviderAdapter({
    env,
    model,
    fetchImpl,
    timeoutMs: options.timeoutMs
  });
  const modelResponse = await adapter.analyzeImage(request, { env, fetchImpl });
  const modelValidation = validateMultimodalModelResponse(modelResponse, request);

  if (!modelValidation.valid || modelValidation.response.executionStatus !== EXECUTION_STATUS.SUCCESS) {
    return {
      source: SOURCE,
      version: VERSION,
      schemaVersion: SCHEMA_VERSION,
      liveGateValidation: gates,
      report: buildSanitizedOpenAIPilotReport({
        model,
        liveExecutionStatus: modelResponse.executionStatus === EXECUTION_STATUS.ERROR
          ? LIVE_STATUS.MODEL_REQUEST_FAILED
          : LIVE_STATUS.MODEL_INVALID_RESPONSE,
        transactionsRequested: 1,
        transactionsEvaluated: 1,
        imagesEvaluated: 1,
        modelRequestsAttempted: 1,
        modelRequestsCompleted: modelResponse.executionStatus === EXECUTION_STATUS.SUCCESS ? 1 : 0,
        preResolution,
        modelValidation,
        boundedUsage: modelResponse.usage || null,
        sanitizedFailureCategory: modelValidation.reasonCodes[0] || asArray(modelResponse.errors)[0] || 'model_invalid_response'
      }),
      productionImpact: 'none',
      decisionImpact: 'none',
      executionAuthority: 'none'
    };
  }

  const observations = modelValidation.response.observations
    .map((observation) => mapModelObservationToEvidenceObservation(observation, modelValidation.response));
  const evidenceResult = resolveMultimodalSoldIdentityEvidence({
    transaction,
    titleResolution: preResolution,
    observations
  });
  const improved = classificationImproved(preResolution.classification, evidenceResult.postMultimodalClassification);
  const report = buildSanitizedOpenAIPilotReport({
    model,
    liveExecutionStatus: LIVE_STATUS.COMPLETED,
    transactionsRequested: 1,
    transactionsEvaluated: 1,
    imagesEvaluated: 1,
    modelRequestsAttempted: 1,
    modelRequestsCompleted: 1,
    preResolution,
    modelValidation,
    evidenceResult,
    classificationImproved: improved,
    boundedUsage: modelValidation.response.usage || null
  });

  return deepFreeze({
    source: SOURCE,
    version: VERSION,
    schemaVersion: SCHEMA_VERSION,
    liveGateValidation: gates,
    modelValidation,
    evidenceResult,
    report,
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  });
}

module.exports = {
  SOURCE,
  VERSION,
  SCHEMA_VERSION,
  PROVIDER_ID,
  ADAPTER_ID,
  OPENAI_API_KEY_ENV,
  OPENAI_MODEL_ENV,
  OPENAI_LIVE_FLAG_ENV,
  DEFAULT_OPENAI_MODEL,
  OPENAI_RESPONSES_URL,
  DEFAULT_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  DEFAULT_MAX_OUTPUT_TOKENS,
  MAX_OUTPUT_TOKENS,
  MAX_TRANSACTIONS,
  MAX_IMAGES,
  MAX_MODEL_REQUESTS,
  MAX_OBSERVATIONS,
  LIVE_STATUS,
  buildOpenAIObservationJsonSchema,
  buildOpenAIResponsesRequestBody,
  normalizeOpenAITimeoutMs,
  normalizeOpenAIMaxOutputTokens,
  createOpenAIMultimodalProviderAdapter,
  validateOpenAILiveGates,
  buildSanitizedOpenAIPilotReport,
  runOpenAIMultimodalCompatibilityPilot
};
