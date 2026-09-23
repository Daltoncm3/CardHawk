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
  DEFAULT_REQUESTED_FIELDS,
  buildMultimodalModelPromptContract,
  buildSanitizedMultimodalPilotReport,
  createMultimodalModelRequest,
  mapModelObservationToEvidenceObservation,
  validateMultimodalModelRequest,
  validateMultimodalModelResponse
} = require('./multimodalModelAdapterContract');
const {
  EVIDENCE_MODALITIES,
  SUPPORTED_FIELDS,
  resolveMultimodalSoldIdentityEvidence
} = require('./multimodalSoldIdentityEvidencePilot');
const {
  MATERIAL_FIELDS,
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
const OPENAI_REASONING_EFFORTS = Object.freeze(['minimal', 'low', 'medium', 'high', 'xhigh']);
const OPENAI_TEXT_VERBOSITY_LEVELS = Object.freeze(['low', 'medium', 'high']);
const MAX_TRANSACTIONS = 1;
const MAX_IMAGES = 1;
const MAX_MODEL_REQUESTS = 1;
const MAX_OBSERVATIONS = 12;
const MAX_DIAGNOSTIC_FIELDS = 16;

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

const FEASIBILITY_CLASSIFICATIONS = Object.freeze({
  EXPLICIT_VISUAL_EVIDENCE_POSSIBLE: 'EXPLICIT_VISUAL_EVIDENCE_POSSIBLE',
  ADDITIONAL_IMAGE_OR_VIEW_REQUIRED: 'ADDITIONAL_IMAGE_OR_VIEW_REQUIRED',
  EXPLICIT_TEXT_OR_PROVIDER_METADATA_REQUIRED: 'EXPLICIT_TEXT_OR_PROVIDER_METADATA_REQUIRED',
  ABSENCE_SENSITIVE_NOT_PROVABLE_FROM_NONAPPEARANCE: 'ABSENCE_SENSITIVE_NOT_PROVABLE_FROM_NONAPPEARANCE',
  CONFLICT_REQUIRES_RESOLUTION: 'CONFLICT_REQUIRES_RESOLUTION',
  MANUAL_VERIFICATION_REQUIRED: 'MANUAL_VERIFICATION_REQUIRED',
  CURRENT_EVIDENCE_SUFFICIENT: 'CURRENT_EVIDENCE_SUFFICIENT',
  UNKNOWN_RESOLUTION_PATH: 'UNKNOWN_RESOLUTION_PATH'
});

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

const CONFLICT_SOURCE_CATEGORIES = Object.freeze([
  'canonical_resolver',
  'explicit_title_evidence',
  'explicit_visual_evidence',
  'image_ocr',
  'provider_metadata',
  'slab_label',
  'title_parse',
  'unknown'
]);

const ABSENCE_SENSITIVE_FEASIBILITY_FIELDS = Object.freeze([
  'autographState',
  'memorabiliaState',
  'rawOrGraded',
  'serialNumbered'
]);

const FIELD_FEASIBILITY_CLASSIFICATIONS = Object.freeze({
  sport: FEASIBILITY_CLASSIFICATIONS.EXPLICIT_TEXT_OR_PROVIDER_METADATA_REQUIRED,
  subjectName: FEASIBILITY_CLASSIFICATIONS.EXPLICIT_VISUAL_EVIDENCE_POSSIBLE,
  year: FEASIBILITY_CLASSIFICATIONS.EXPLICIT_TEXT_OR_PROVIDER_METADATA_REQUIRED,
  manufacturer: FEASIBILITY_CLASSIFICATIONS.EXPLICIT_TEXT_OR_PROVIDER_METADATA_REQUIRED,
  setName: FEASIBILITY_CLASSIFICATIONS.EXPLICIT_TEXT_OR_PROVIDER_METADATA_REQUIRED,
  cardNumber: FEASIBILITY_CLASSIFICATIONS.EXPLICIT_VISUAL_EVIDENCE_POSSIBLE,
  parallel: FEASIBILITY_CLASSIFICATIONS.EXPLICIT_VISUAL_EVIDENCE_POSSIBLE,
  autographState: FEASIBILITY_CLASSIFICATIONS.ABSENCE_SENSITIVE_NOT_PROVABLE_FROM_NONAPPEARANCE,
  memorabiliaState: FEASIBILITY_CLASSIFICATIONS.ABSENCE_SENSITIVE_NOT_PROVABLE_FROM_NONAPPEARANCE,
  serialNumbered: FEASIBILITY_CLASSIFICATIONS.ABSENCE_SENSITIVE_NOT_PROVABLE_FROM_NONAPPEARANCE,
  rawOrGraded: FEASIBILITY_CLASSIFICATIONS.ABSENCE_SENSITIVE_NOT_PROVABLE_FROM_NONAPPEARANCE
});

const REQUIRED_EVIDENCE_CATEGORIES_BY_FIELD = Object.freeze({
  sport: Object.freeze(['explicit_title_evidence', 'provider_metadata', 'manual_verification']),
  subjectName: Object.freeze(['explicit_visual_evidence', 'explicit_title_evidence', 'provider_metadata', 'manual_verification']),
  year: Object.freeze(['explicit_title_evidence', 'provider_metadata', 'manual_verification']),
  manufacturer: Object.freeze(['explicit_title_evidence', 'provider_metadata', 'manual_verification']),
  setName: Object.freeze(['explicit_title_evidence', 'provider_metadata', 'manual_verification']),
  cardNumber: Object.freeze(['explicit_visual_evidence', 'image_ocr', 'explicit_title_evidence', 'provider_metadata', 'manual_verification']),
  parallel: Object.freeze(['explicit_visual_evidence', 'explicit_title_evidence', 'provider_metadata', 'manual_verification']),
  autographState: Object.freeze(['explicit_visual_evidence', 'explicit_title_evidence', 'provider_metadata', 'manual_verification']),
  memorabiliaState: Object.freeze(['explicit_visual_evidence', 'explicit_title_evidence', 'provider_metadata', 'manual_verification']),
  serialNumbered: Object.freeze(['explicit_visual_evidence', 'image_ocr', 'explicit_title_evidence', 'provider_metadata', 'manual_verification']),
  rawOrGraded: Object.freeze(['slab_label', 'explicit_title_evidence', 'provider_metadata', 'manual_verification'])
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

function normalizeOpenAIReasoningEffort(value = null) {
  const effort = String(value || '').trim();
  return OPENAI_REASONING_EFFORTS.includes(effort) ? effort : null;
}

function normalizeOpenAITextVerbosity(value = null) {
  const verbosity = String(value || '').trim();
  return OPENAI_TEXT_VERBOSITY_LEVELS.includes(verbosity) ? verbosity : null;
}

function normalizeOpenAIMaxObservations(value = MAX_OBSERVATIONS) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return MAX_OBSERVATIONS;
  return Math.min(Math.floor(numeric), MAX_OBSERVATIONS);
}

function normalizeSchemaRequestedFields(fields = DEFAULT_REQUESTED_FIELDS) {
  const allowed = new Set(DEFAULT_REQUESTED_FIELDS);
  const normalized = unique(asArray(fields).length ? fields : DEFAULT_REQUESTED_FIELDS)
    .map((field) => String(field || '').trim())
    .filter((field) => allowed.has(field))
    .sort();
  return normalized.length ? normalized : [...DEFAULT_REQUESTED_FIELDS];
}

function buildOpenAIObservationJsonSchema(options = {}) {
  const requestedFields = normalizeSchemaRequestedFields(options.requestedFields);
  const maxObservations = normalizeOpenAIMaxObservations(options.maxObservations);
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
        maxItems: maxObservations,
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
              enum: requestedFields
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
  const schemaRequestedFields = normalizeSchemaRequestedFields(request.requestedFields);
  const reasoningEffort = normalizeOpenAIReasoningEffort(options.reasoningEffort);
  const textVerbosity = normalizeOpenAITextVerbosity(options.textVerbosity);
  const instructionText = [
    ...prompt.instructions,
    'Return only a single JSON object matching the strict schema.',
    'Do not include prose, Markdown, explanations, or provider-specific metadata.',
    'If a field is not visibly explicit, return unknown_not_observable or proposedValue "unknown".',
    `Requested identity fields: ${schemaRequestedFields.join(', ')}`,
    `Request ID: ${request.requestId}`,
    `Title context, untrusted and non-authoritative: ${request.titleContext || 'unknown'}`
  ].join('\n');

  const body = {
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
      ...(textVerbosity ? { verbosity: textVerbosity } : {}),
      format: {
        type: 'json_schema',
        name: 'cardhawk_multimodal_observations',
        description: 'Strict CardHawk visual identity observations only.',
        strict: true,
        schema: buildOpenAIObservationJsonSchema({
          requestedFields: schemaRequestedFields,
          maxObservations: options.maxObservations
        })
      }
    },
    max_output_tokens: normalizeOpenAIMaxOutputTokens(options.maxOutputTokens),
    store: false
  };
  if (reasoningEffort) body.reasoning = { effort: reasoningEffort };
  return deepFreeze(body);
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
  const outputDetails = asObject(usage.output_tokens_details);
  return {
    inputTokens: Number.isFinite(Number(usage.input_tokens)) ? Number(usage.input_tokens) : null,
    outputTokens: Number.isFinite(Number(usage.output_tokens)) ? Number(usage.output_tokens) : null,
    totalTokens: Number.isFinite(Number(usage.total_tokens)) ? Number(usage.total_tokens) : null,
    reasoningTokens: Number.isFinite(Number(outputDetails.reasoning_tokens)) ? Number(outputDetails.reasoning_tokens) : null
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

      const body = buildOpenAIResponsesRequestBody(request, {
        model,
        maxOutputTokens: runOptions.maxOutputTokens || options.maxOutputTokens,
        maxObservations: runOptions.maxObservations || options.maxObservations,
        reasoningEffort: runOptions.reasoningEffort || options.reasoningEffort,
        textVerbosity: runOptions.textVerbosity || options.textVerbosity
      });
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

function sanitizeFieldArray(values = [], allowlist = SUPPORTED_FIELDS) {
  const allowed = new Set(allowlist);
  return unique(asArray(values)
    .map((value) => String(value || '').trim())
    .filter((value) => allowed.has(value)))
    .sort()
    .slice(0, MAX_DIAGNOSTIC_FIELDS);
}

function sanitizeObservationFields(entries = []) {
  return sanitizeFieldArray(asArray(entries).map((entry) => entry && entry.field), SUPPORTED_FIELDS);
}

function sanitizeRejectionReason(value) {
  const reason = String(value || '').trim();
  return REJECTION_REASON_CODES.includes(reason) ? reason : 'invalid_observation';
}

function buildRejectedObservationReasonsByField(entries = []) {
  const allowedFields = new Set(SUPPORTED_FIELDS);
  const grouped = {};
  for (const entry of asArray(entries)) {
    const field = String(entry?.field || '').trim();
    if (!allowedFields.has(field)) continue;
    const reason = sanitizeRejectionReason(entry?.reason);
    if (!grouped[field]) grouped[field] = {};
    grouped[field][reason] = (grouped[field][reason] || 0) + 1;
  }

  return Object.freeze(Object.fromEntries(Object.entries(grouped)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([field, reasons]) => [
      field,
      Object.freeze(Object.fromEntries(Object.entries(reasons)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([reason, count]) => [reason, Math.min(Number(count) || 0, MAX_OBSERVATIONS)])))
    ])));
}

function buildFieldRecoveryDiagnostics(evidenceResult = {}, preResolution = {}) {
  const preMissing = sanitizeFieldArray(
    asArray(evidenceResult?.preMultimodalMissingMaterialFields || preResolution?.missingMaterialFields),
    MATERIAL_FIELDS
  );
  const postMissing = sanitizeFieldArray(evidenceResult?.postMultimodalMissingMaterialFields, MATERIAL_FIELDS);
  const admittedFields = sanitizeObservationFields(evidenceResult?.admittedMultimodalFields);
  const rejectedFields = sanitizeObservationFields(evidenceResult?.rejectedMultimodalFields);
  const conflictFields = sanitizeObservationFields(evidenceResult?.conflicts);
  const admittedSet = new Set(admittedFields);
  const postMissingSet = new Set(postMissing);
  const conflictSet = new Set(conflictFields);
  const recovered = preMissing
    .filter((field) => !postMissingSet.has(field))
    .filter((field) => admittedSet.has(field))
    .filter((field) => !conflictSet.has(field))
    .sort()
    .slice(0, MAX_DIAGNOSTIC_FIELDS);
  const recoveryRate = preMissing.length
    ? Number((recovered.length / preMissing.length).toFixed(4))
    : 0;

  return deepFreeze({
    missingMaterialFieldsBefore: preMissing,
    missingMaterialFieldsAfter: postMissing,
    recoveredMaterialFields: recovered,
    admittedObservationFields: admittedFields,
    rejectedObservationFields: rejectedFields,
    rejectedObservationReasonsByField: buildRejectedObservationReasonsByField(evidenceResult?.rejectedMultimodalFields),
    conflictFields,
    materialFieldRecoveryCount: recovered.length,
    materialFieldRecoveryRate: recoveryRate
  });
}

function sanitizeCategoryArray(values = [], allowlist = EVIDENCE_CATEGORY_CODES) {
  const allowed = new Set(allowlist);
  return unique(asArray(values)
    .map((value) => String(value || '').trim())
    .filter((value) => allowed.has(value)))
    .sort()
    .slice(0, MAX_DIAGNOSTIC_FIELDS);
}

function categoriesForExistingSource(source = '') {
  const value = String(source || '').trim();
  if (value === 'provider_metadata' || value === 'explicit_provider_metadata') return ['provider_metadata'];
  if (value === 'title_parse' || value === 'deterministic_title_parse') return ['title_parse'];
  if (value === 'explicit_provider_metadata_and_title_confirmed') {
    return ['provider_metadata', 'explicit_title_evidence', 'title_parse'];
  }
  if (value === 'conflict_provider_preferred_for_review') return ['provider_metadata', 'title_parse'];
  if (value === 'admitted_multimodal_identity_evidence') return ['explicit_visual_evidence'];
  if (value === 'canonical_resolver') return ['canonical_resolver'];
  return [];
}

function categoriesForConflict(conflict = {}, fieldProvenance = {}) {
  const categories = [
    ...categoriesForExistingSource(conflict.existingSource),
    ...categoriesForExistingSource(asObject(fieldProvenance[conflict.field]).source)
  ];
  const reason = String(conflict.reason || '');
  if (reason.includes('provider_metadata')) categories.push('provider_metadata');
  if (reason.includes('title_parse')) categories.push('title_parse');
  if (reason.includes('multimodal')) categories.push('explicit_visual_evidence');
  return sanitizeCategoryArray(categories.length ? categories : ['unknown'], CONFLICT_SOURCE_CATEGORIES);
}

function requiredEvidenceForField(field) {
  return sanitizeCategoryArray(REQUIRED_EVIDENCE_CATEGORIES_BY_FIELD[field] || ['manual_verification', 'unknown']);
}

function classifyBlockerField(field, conflictSet) {
  if (conflictSet.has(field)) return FEASIBILITY_CLASSIFICATIONS.CONFLICT_REQUIRES_RESOLUTION;
  if (ABSENCE_SENSITIVE_FEASIBILITY_FIELDS.includes(field)) {
    return FEASIBILITY_CLASSIFICATIONS.ABSENCE_SENSITIVE_NOT_PROVABLE_FROM_NONAPPEARANCE;
  }
  return FIELD_FEASIBILITY_CLASSIFICATIONS[field] || FEASIBILITY_CLASSIFICATIONS.UNKNOWN_RESOLUTION_PATH;
}

function buildExactIdentityFeasibilityAudit(evidenceResult = null, fieldRecoveryDiagnostics = {}) {
  const missingFields = sanitizeFieldArray(fieldRecoveryDiagnostics.missingMaterialFieldsAfter, MATERIAL_FIELDS);
  const conflictFields = sanitizeFieldArray(fieldRecoveryDiagnostics.conflictFields, SUPPORTED_FIELDS);
  const blockerFields = sanitizeFieldArray([...missingFields, ...conflictFields], MATERIAL_FIELDS);
  const conflictSet = new Set(conflictFields);
  const blockerClassificationByField = {};
  const requiredEvidenceCategoriesByField = {};
  const conflictDiagnostics = {};

  for (const field of blockerFields) {
    blockerClassificationByField[field] = classifyBlockerField(field, conflictSet);
    requiredEvidenceCategoriesByField[field] = conflictSet.has(field)
      ? ['manual_verification']
      : requiredEvidenceForField(field);
  }

  for (const conflict of asArray(evidenceResult?.conflicts)) {
    const field = String(conflict?.field || '').trim();
    if (!SUPPORTED_FIELDS.includes(field)) continue;
    conflictDiagnostics[field] = deepFreeze({
      sourceCategories: categoriesForConflict(conflict, evidenceResult?.fieldProvenance),
      resolutionRequirement: FEASIBILITY_CLASSIFICATIONS.CONFLICT_REQUIRES_RESOLUTION
    });
  }

  const recommendedEvidenceCategories = sanitizeCategoryArray(
    Object.values(requiredEvidenceCategoriesByField).flat()
  );
  const exactIdentityFeasibleFromCurrentEvidence = Boolean(
    evidenceResult &&
    evidenceResult.postMultimodalClassification === 'EXACT' &&
    missingFields.length === 0 &&
    conflictFields.length === 0
  );
  const feasibilityReasonCodes = unique([
    ...(evidenceResult ? [] : ['identity_evidence_package_not_available']),
    ...(missingFields.length ? ['missing_material_identity_fields'] : []),
    ...(conflictFields.length ? ['unresolved_identity_conflicts'] : []),
    ...(blockerFields.some((field) => ABSENCE_SENSITIVE_FEASIBILITY_FIELDS.includes(field))
      ? ['absence_sensitive_fields_require_explicit_evidence']
      : []),
    ...(exactIdentityFeasibleFromCurrentEvidence
      ? ['exact_identity_feasible_from_current_evidence']
      : ['exact_identity_not_feasible_from_current_evidence'])
  ]).sort();

  return deepFreeze({
    exactIdentityFeasibleFromCurrentEvidence,
    exactIdentityBlockerFields: blockerFields,
    blockerClassificationByField: deepFreeze(Object.fromEntries(Object.entries(blockerClassificationByField)
      .sort(([left], [right]) => left.localeCompare(right)))),
    requiredEvidenceCategoriesByField: deepFreeze(Object.fromEntries(Object.entries(requiredEvidenceCategoriesByField)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([field, categories]) => [field, sanitizeCategoryArray(categories)]))),
    conflictDiagnostics: deepFreeze(Object.fromEntries(Object.entries(conflictDiagnostics)
      .sort(([left], [right]) => left.localeCompare(right)))),
    additionalEvidenceRequired: !exactIdentityFeasibleFromCurrentEvidence,
    recommendedEvidenceCategories,
    feasibilityReasonCodes
  });
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
  const fieldRecoveryDiagnostics = buildFieldRecoveryDiagnostics(evidenceResult, input.preResolution);
  const feasibilityAudit = buildExactIdentityFeasibilityAudit(evidenceResult, fieldRecoveryDiagnostics);
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
    ...fieldRecoveryDiagnostics,
    ...feasibilityAudit,
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

// Non-authoritative helper for bounded owner-operated pilots. It consumes one in-memory
// transaction and returns sanitized diagnostics only; it never persists raw provider data.
async function runOpenAIMultimodalTransactionAnalysis(input = {}) {
  const transaction = input.transaction || null;
  const env = input.env || process.env;
  const model = safeModelName(input.model || env[OPENAI_MODEL_ENV] || DEFAULT_OPENAI_MODEL);
  const fetchImpl = input.fetchImpl || globalThis.fetch;
  const adapter = input.adapter || createOpenAIMultimodalProviderAdapter({
    env,
    model,
    fetchImpl,
    timeoutMs: input.timeoutMs
  });
  const transactionsRequested = requestedLimit(input.transactionsRequested, 1);
  const transactionsEvaluated = transaction ? 1 : 0;

  if (!transaction) {
    return {
      report: buildSanitizedOpenAIPilotReport({
        model,
        liveExecutionStatus: input.liveExecutionStatus || LIVE_STATUS.CARD_API_NO_TRANSACTION,
        transactionsRequested,
        transactionsEvaluated: 0,
        sanitizedFailureCategory: 'card_api_no_transaction'
      }),
      modelValidation: null,
      evidenceResult: null
    };
  }

  const preResolution = input.preResolution || resolveCardApiTransactionIdentity(transaction);
  const imageReference = transaction.image || null;
  if (!imageReference) {
    return {
      preResolution,
      report: buildSanitizedOpenAIPilotReport({
        model,
        liveExecutionStatus: input.liveExecutionStatus || LIVE_STATUS.CARD_API_NO_IMAGE,
        transactionsRequested,
        transactionsEvaluated,
        imagesEvaluated: 0,
        preResolution,
        sanitizedFailureCategory: 'image_not_available'
      }),
      modelValidation: null,
      evidenceResult: null
    };
  }

  const request = createMultimodalModelRequest({
    requestId: input.requestId || 'a5-7-openai-multimodal-request-1',
    titleContext: transaction.rawTitle || '',
    imageReference,
    requestedFields: input.requestedFields,
    modelConfig: {
      provider: PROVIDER_ID,
      model,
      maxRequests: 1,
      maxImages: 1,
      liveCompatibilityFlag: true
    }
  });
  const modelResponse = await adapter.analyzeImage(request, {
    env,
    fetchImpl,
    maxOutputTokens: input.maxOutputTokens,
    maxObservations: input.maxObservations,
    reasoningEffort: input.reasoningEffort,
    textVerbosity: input.textVerbosity
  });
  const modelValidation = validateMultimodalModelResponse(modelResponse, request);

  if (!modelValidation.valid || modelValidation.response.executionStatus !== EXECUTION_STATUS.SUCCESS) {
    const sanitizedFailureCategory = modelValidation.reasonCodes[0] || asArray(modelResponse.errors)[0] || 'model_invalid_response';
    return {
      preResolution,
      modelValidation,
      report: buildSanitizedOpenAIPilotReport({
        model,
        liveExecutionStatus: modelResponse.executionStatus === EXECUTION_STATUS.ERROR
          ? LIVE_STATUS.MODEL_REQUEST_FAILED
          : LIVE_STATUS.MODEL_INVALID_RESPONSE,
        transactionsRequested,
        transactionsEvaluated,
        imagesEvaluated: 1,
        modelRequestsAttempted: 1,
        modelRequestsCompleted: modelResponse.executionStatus === EXECUTION_STATUS.SUCCESS ? 1 : 0,
        preResolution,
        modelValidation,
        boundedUsage: modelResponse.usage || null,
        sanitizedFailureCategory
      }),
      evidenceResult: null
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

  return {
    preResolution,
    modelValidation,
    evidenceResult,
    report: buildSanitizedOpenAIPilotReport({
      model,
      liveExecutionStatus: input.liveExecutionStatus || LIVE_STATUS.COMPLETED,
      transactionsRequested,
      transactionsEvaluated,
      imagesEvaluated: 1,
      modelRequestsAttempted: 1,
      modelRequestsCompleted: 1,
      preResolution,
      modelValidation,
      evidenceResult,
      classificationImproved: improved,
      boundedUsage: modelValidation.response.usage || null
    })
  };
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

  const adapter = options.adapter || createOpenAIMultimodalProviderAdapter({
    env,
    model,
    fetchImpl,
    timeoutMs: options.timeoutMs
  });
  const analysis = await runOpenAIMultimodalTransactionAnalysis({
    transaction,
    env,
    model,
    fetchImpl,
    adapter,
    timeoutMs: options.timeoutMs,
    requestId: 'a5-7-openai-multimodal-request-1',
    transactionsRequested: 1
  });

  const result = {
    source: SOURCE,
    version: VERSION,
    schemaVersion: SCHEMA_VERSION,
    liveGateValidation: gates,
    report: analysis.report,
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
  if (analysis.modelValidation) result.modelValidation = analysis.modelValidation;
  if (analysis.evidenceResult) result.evidenceResult = analysis.evidenceResult;
  return deepFreeze(result);
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
  OPENAI_REASONING_EFFORTS,
  OPENAI_TEXT_VERBOSITY_LEVELS,
  MAX_TRANSACTIONS,
  MAX_IMAGES,
  MAX_MODEL_REQUESTS,
  MAX_OBSERVATIONS,
  FEASIBILITY_CLASSIFICATIONS,
  LIVE_STATUS,
  buildOpenAIObservationJsonSchema,
  buildOpenAIResponsesRequestBody,
  normalizeOpenAITimeoutMs,
  normalizeOpenAIMaxOutputTokens,
  normalizeOpenAIReasoningEffort,
  normalizeOpenAITextVerbosity,
  normalizeOpenAIMaxObservations,
  createOpenAIMultimodalProviderAdapter,
  validateOpenAILiveGates,
  buildSanitizedOpenAIPilotReport,
  runOpenAIMultimodalTransactionAnalysis,
  runOpenAIMultimodalCompatibilityPilot
};
