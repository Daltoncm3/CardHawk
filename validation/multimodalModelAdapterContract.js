'use strict';

const {
  OBSERVATION_TYPES,
  EVIDENCE_MODALITIES,
  SUPPORTED_FIELDS,
  resolveMultimodalSoldIdentityEvidence
} = require('./multimodalSoldIdentityEvidencePilot');
const {
  asArray,
  asObject,
  fingerprint,
  unique
} = require('./canonicalValidationCore');

const SOURCE = 'multimodal_model_adapter_contract';
const VERSION = '0.1.0';
const SCHEMA_VERSION = '1.0.0';

const EXECUTION_STATUS = Object.freeze({
  SUCCESS: 'success',
  INVALID_REQUEST: 'invalid_request',
  INVALID_RESPONSE: 'invalid_response',
  NOT_CONFIGURED: 'not_configured',
  ERROR: 'error'
});

const EVIDENCE_TYPES = Object.freeze({
  EXPLICIT_VISUAL: 'explicit_visual_evidence',
  INFERRED_VISUAL: 'inferred_visual_evidence',
  UNKNOWN: 'unknown_not_observable'
});

const EXPLICIT_OR_INFERRED = Object.freeze({
  EXPLICIT: 'explicit',
  INFERRED: 'inferred',
  UNKNOWN: 'unknown'
});

const DEFAULT_REQUESTED_FIELDS = Object.freeze([
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
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function normalizeConfidence(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return numeric;
}

function normalizeRequestedFields(fields = DEFAULT_REQUESTED_FIELDS) {
  return unique(asArray(fields).length ? fields : DEFAULT_REQUESTED_FIELDS)
    .map(String)
    .sort();
}

function createMultimodalModelRequest(input = {}) {
  const request = asObject(input);
  const normalized = {
    schemaVersion: request.schemaVersion || SCHEMA_VERSION,
    requestId: request.requestId || `multimodal_model_request_${Date.now()}`,
    titleContext: request.titleContext || '',
    imageReference: request.imageReference || null,
    requestedFields: normalizeRequestedFields(request.requestedFields),
    modelConfig: {
      provider: request.modelConfig?.provider || 'fixture',
      model: request.modelConfig?.model || 'fixture_multimodal_model',
      temperature: request.modelConfig?.temperature ?? 0,
      maxRequests: request.modelConfig?.maxRequests ?? 1,
      maxImages: request.modelConfig?.maxImages ?? 1,
      liveCompatibilityFlag: Boolean(request.modelConfig?.liveCompatibilityFlag)
    },
    nonPersistence: {
      nonPersistent: request.nonPersistence?.nonPersistent !== false,
      writesProductionStore: false,
      persistImageUrl: false,
      persistImageBytes: false,
      persistRawModelResponse: false,
      persistPrompt: false,
      persistProviderRecord: false
    },
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };

  normalized.requestFingerprint = fingerprint(normalized);
  return deepFreeze(normalized);
}

function validateMultimodalModelRequest(input = {}) {
  const request = createMultimodalModelRequest(input);
  const errors = [];
  const warnings = [];
  const reasonCodes = [];

  if (request.schemaVersion !== SCHEMA_VERSION) {
    errors.push('unsupported_schema_version');
    reasonCodes.push('unsupported_schema_version');
  }
  if (!request.requestId) {
    errors.push('missing_request_id');
    reasonCodes.push('missing_request_id');
  }
  if (!request.imageReference) {
    errors.push('missing_image_reference');
    reasonCodes.push('missing_image_reference');
  }
  const unsupported = request.requestedFields.filter((field) => !DEFAULT_REQUESTED_FIELDS.includes(field));
  if (unsupported.length) {
    errors.push('unsupported_requested_fields');
    reasonCodes.push('unsupported_requested_fields');
  }
  if (request.modelConfig.maxRequests !== 1) {
    errors.push('max_requests_must_be_one');
    reasonCodes.push('request_bound_violation');
  }
  if (request.modelConfig.maxImages !== 1) {
    errors.push('max_images_must_be_one');
    reasonCodes.push('request_bound_violation');
  }
  for (const [field, expected] of [
    ['nonPersistent', true],
    ['writesProductionStore', false],
    ['persistImageUrl', false],
    ['persistImageBytes', false],
    ['persistRawModelResponse', false],
    ['persistPrompt', false],
    ['persistProviderRecord', false]
  ]) {
    if (request.nonPersistence[field] !== expected) {
      errors.push(`non_persistence_${field}_violation`);
      reasonCodes.push('non_persistence_violation');
    }
  }
  for (const field of ['productionImpact', 'decisionImpact', 'executionAuthority']) {
    if (request[field] !== 'none') {
      errors.push(`${field}_must_remain_none`);
      reasonCodes.push('authority_boundary_violation');
    }
  }
  if (String(request.imageReference || '').startsWith('data:')) {
    warnings.push('inline_image_reference_not_recommended');
    reasonCodes.push('inline_image_reference_not_recommended');
  }

  return deepFreeze({
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes: unique(reasonCodes).sort(),
    request
  });
}

function buildMultimodalModelPromptContract(input = {}) {
  const request = createMultimodalModelRequest(input);
  const prompt = {
    schemaVersion: SCHEMA_VERSION,
    promptType: 'multimodal_sold_card_identity_observation',
    requestId: request.requestId,
    instructions: [
      'Report only identity evidence visibly supported by the image.',
      'Separate title/context claims from image evidence.',
      'Return unknown_not_observable when uncertain or not visible.',
      'Never infer non-auto because an autograph is not visible.',
      'Never infer non-memorabilia because a patch, relic, or jersey is not visible.',
      'Never infer unnumbered because numbering is not visible.',
      'Never infer raw merely because a grading slab is not recognized.',
      'Identify multi-card or lot ambiguity explicitly.',
      'Use strict structured response fields only; do not emit free-text identity decisions.',
      'Do not decide EXACT identity, valuation eligibility, Deal Gate status, BUY_NOW, or purchase action.'
    ],
    requestedFields: request.requestedFields,
    responseSchema: {
      requestId: 'string',
      adapterId: 'string',
      providerId: 'string',
      modelId: 'string',
      executionStatus: Object.values(EXECUTION_STATUS),
      observations: [{
        field: DEFAULT_REQUESTED_FIELDS,
        proposedValue: 'string|number|boolean|unknown',
        confidence: 'number_0_to_1',
        evidenceType: Object.values(EVIDENCE_TYPES),
        modality: Object.values(EVIDENCE_MODALITIES),
        explicitOrInferred: Object.values(EXPLICIT_OR_INFERRED),
        deterministicVerificationPossible: 'boolean',
        ambiguity: 'string[]',
        warnings: 'string[]'
      }],
      warnings: 'string[]',
      errors: 'string[]',
      usage: 'object|null',
      nonPersistent: true,
      writesProductionStore: false,
      productionImpact: 'none',
      decisionImpact: 'none',
      executionAuthority: 'none'
    },
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
  prompt.promptFingerprint = fingerprint(prompt);
  return deepFreeze(prompt);
}

function normalizeModelObservation(input = {}, index = 0) {
  const observation = asObject(input);
  return {
    observationId: observation.observationId || `model_observation_${index + 1}`,
    field: observation.field || 'unknown',
    proposedValue: observation.proposedValue === undefined ? 'unknown' : observation.proposedValue,
    confidence: normalizeConfidence(observation.confidence),
    evidenceType: observation.evidenceType || EVIDENCE_TYPES.UNKNOWN,
    modality: observation.modality || EVIDENCE_MODALITIES.IMAGE,
    explicitOrInferred: observation.explicitOrInferred || EXPLICIT_OR_INFERRED.UNKNOWN,
    deterministicVerificationPossible: Boolean(observation.deterministicVerificationPossible),
    ambiguity: asArray(observation.ambiguity).map(String).sort(),
    warnings: asArray(observation.warnings).map(String).sort(),
    multipleCardsVisible: Boolean(observation.multipleCardsVisible)
  };
}

function validateModelObservation(input = {}, index = 0) {
  const observation = normalizeModelObservation(input, index);
  const errors = [];
  const warnings = [];
  const reasonCodes = [];

  if (!DEFAULT_REQUESTED_FIELDS.includes(observation.field)) {
    errors.push('unsupported_observation_field');
    reasonCodes.push('unsupported_observation_field');
  }
  if (observation.confidence === null || observation.confidence < 0 || observation.confidence > 1) {
    errors.push('invalid_observation_confidence');
    reasonCodes.push('invalid_observation_confidence');
  }
  if (!Object.values(EVIDENCE_TYPES).includes(observation.evidenceType)) {
    errors.push('invalid_observation_evidence_type');
    reasonCodes.push('invalid_observation_evidence_type');
  }
  if (!Object.values(EVIDENCE_MODALITIES).includes(observation.modality)) {
    errors.push('invalid_observation_modality');
    reasonCodes.push('invalid_observation_modality');
  }
  if (!Object.values(EXPLICIT_OR_INFERRED).includes(observation.explicitOrInferred)) {
    errors.push('invalid_explicit_or_inferred');
    reasonCodes.push('invalid_explicit_or_inferred');
  }
  if (observation.evidenceType === EVIDENCE_TYPES.UNKNOWN || observation.explicitOrInferred === EXPLICIT_OR_INFERRED.UNKNOWN) {
    warnings.push('unknown_observation_preserved');
    reasonCodes.push('unknown_observation_preserved');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes,
    observation
  };
}

function validateMultimodalModelResponse(response = {}, request = {}) {
  const input = asObject(response);
  const requestInput = asObject(request);
  const errors = [];
  const warnings = [];
  const reasonCodes = [];
  const observations = asArray(input.observations).map((observation, index) => validateModelObservation(observation, index));

  if (!input.requestId) {
    errors.push('missing_response_request_id');
    reasonCodes.push('missing_response_request_id');
  }
  if (requestInput.requestId && input.requestId && input.requestId !== requestInput.requestId) {
    errors.push('response_request_id_mismatch');
    reasonCodes.push('response_request_id_mismatch');
  }
  for (const field of ['adapterId', 'providerId', 'modelId', 'executionStatus']) {
    if (!input[field]) {
      errors.push(`missing_${field}`);
      reasonCodes.push(`missing_${field}`);
    }
  }
  if (input.executionStatus && !Object.values(EXECUTION_STATUS).includes(input.executionStatus)) {
    errors.push('invalid_execution_status');
    reasonCodes.push('invalid_execution_status');
  }
  if (!Array.isArray(input.observations)) {
    errors.push('observations_must_be_array');
    reasonCodes.push('observations_must_be_array');
  }
  for (const result of observations) {
    errors.push(...result.errors);
    warnings.push(...result.warnings);
    reasonCodes.push(...result.reasonCodes);
  }
  if (input.nonPersistent !== true) {
    errors.push('response_must_be_non_persistent');
    reasonCodes.push('non_persistence_violation');
  }
  if (input.writesProductionStore !== false) {
    errors.push('response_must_not_write_production_store');
    reasonCodes.push('production_write_violation');
  }
  for (const field of ['productionImpact', 'decisionImpact', 'executionAuthority']) {
    if (input[field] !== 'none') {
      errors.push(`${field}_must_remain_none`);
      reasonCodes.push('authority_boundary_violation');
    }
  }

  const normalized = {
    schemaVersion: input.schemaVersion || SCHEMA_VERSION,
    requestId: input.requestId || null,
    adapterId: input.adapterId || null,
    providerId: input.providerId || null,
    modelId: input.modelId || null,
    executionStatus: input.executionStatus || EXECUTION_STATUS.INVALID_RESPONSE,
    observations: observations.map((result) => result.observation),
    warnings: asArray(input.warnings).map(String).concat(warnings).sort(),
    errors: asArray(input.errors).map(String).concat(errors).sort(),
    usage: input.usage || null,
    nonPersistent: input.nonPersistent === true,
    writesProductionStore: input.writesProductionStore === true,
    productionImpact: input.productionImpact || 'unknown',
    decisionImpact: input.decisionImpact || 'unknown',
    executionAuthority: input.executionAuthority || 'unknown'
  };
  normalized.responseFingerprint = fingerprint(normalized);

  return deepFreeze({
    valid: errors.length === 0,
    errors: errors.sort(),
    warnings: warnings.sort(),
    reasonCodes: unique(reasonCodes).sort(),
    response: normalized
  });
}

function mapModelObservationToEvidenceObservation(observation = {}, modelResponse = {}) {
  const type = observation.evidenceType === EVIDENCE_TYPES.EXPLICIT_VISUAL && observation.explicitOrInferred === EXPLICIT_OR_INFERRED.EXPLICIT
    ? OBSERVATION_TYPES.EXPLICIT_VISUAL
    : observation.evidenceType === EVIDENCE_TYPES.INFERRED_VISUAL || observation.explicitOrInferred === EXPLICIT_OR_INFERRED.INFERRED
      ? OBSERVATION_TYPES.INFERRED_VISUAL
      : OBSERVATION_TYPES.UNKNOWN;

  return {
    observationId: observation.observationId,
    field: observation.field,
    proposedValue: observation.proposedValue,
    observationType: type,
    evidenceSource: modelResponse.providerId || 'unknown_model_provider',
    evidenceModality: observation.modality,
    confidence: observation.confidence,
    modelProvider: modelResponse.providerId || null,
    modelIdentifier: modelResponse.modelId || null,
    observedAt: null,
    deterministicVerification: observation.deterministicVerificationPossible,
    warnings: observation.warnings,
    ambiguity: observation.ambiguity,
    multipleCardsVisible: observation.multipleCardsVisible
  };
}

function createFixtureMultimodalModelAdapter(config = {}) {
  const responses = asObject(config.responses);
  const defaultResponse = config.defaultResponse || null;
  return deepFreeze({
    adapterId: 'fixture_multimodal_model_adapter',
    providerId: 'offline_fixture',
    modelId: config.modelId || 'fixture_multimodal_model_v1',
    networkEnabled: false,
    async analyzeImage(requestInput = {}) {
      const validation = validateMultimodalModelRequest(requestInput);
      if (!validation.valid) {
        return {
          requestId: requestInput.requestId || null,
          adapterId: 'fixture_multimodal_model_adapter',
          providerId: 'offline_fixture',
          modelId: config.modelId || 'fixture_multimodal_model_v1',
          executionStatus: EXECUTION_STATUS.INVALID_REQUEST,
          observations: [],
          warnings: [],
          errors: validation.errors,
          usage: null,
          nonPersistent: true,
          writesProductionStore: false,
          productionImpact: 'none',
          decisionImpact: 'none',
          executionAuthority: 'none'
        };
      }
      const request = validation.request;
      const fixture = responses[request.requestId] || defaultResponse || {
        observations: [],
        warnings: ['fixture_response_not_supplied'],
        errors: []
      };
      return {
        requestId: request.requestId,
        adapterId: 'fixture_multimodal_model_adapter',
        providerId: 'offline_fixture',
        modelId: config.modelId || 'fixture_multimodal_model_v1',
        executionStatus: EXECUTION_STATUS.SUCCESS,
        observations: asArray(fixture.observations),
        warnings: asArray(fixture.warnings),
        errors: asArray(fixture.errors),
        usage: fixture.usage || null,
        nonPersistent: true,
        writesProductionStore: false,
        productionImpact: 'none',
        decisionImpact: 'none',
        executionAuthority: 'none'
      };
    }
  });
}

function buildSanitizedMultimodalPilotReport(input = {}) {
  const modelValidation = input.modelValidation || { valid: false, response: null, reasonCodes: ['model_not_run'] };
  const evidenceResult = input.evidenceResult || null;
  const preMissing = asArray(evidenceResult?.preMultimodalMissingMaterialFields);
  const postMissing = asArray(evidenceResult?.postMultimodalMissingMaterialFields);
  const admitted = asArray(evidenceResult?.admittedMultimodalFields);
  const rejected = asArray(evidenceResult?.rejectedMultimodalFields);
  const conflicts = asArray(evidenceResult?.conflicts);
  const report = {
    source: SOURCE,
    version: VERSION,
    schemaVersion: SCHEMA_VERSION,
    providerTransactionObtained: Boolean(input.providerTransactionObtained),
    imageAvailable: Boolean(input.imageAvailable),
    modelRequestExecuted: Boolean(input.modelRequestExecuted),
    modelResponseValid: Boolean(modelValidation.valid),
    observationsReturnedCount: asArray(modelValidation.response?.observations).length,
    observationsAdmittedCount: admitted.length,
    observationsRejectedCount: rejected.length,
    fieldsObserved: unique(asArray(modelValidation.response?.observations).map((observation) => observation.field)).sort(),
    fieldsAdmitted: unique(admitted.map((entry) => entry.field)).sort(),
    fieldsRejected: unique(rejected.map((entry) => entry.field)).sort(),
    preMultimodalClassification: evidenceResult?.preMultimodalClassification || 'unknown',
    postMultimodalClassification: evidenceResult?.postMultimodalClassification || 'unknown',
    preMissingMaterialFieldCount: preMissing.length,
    postMissingMaterialFieldCount: postMissing.length,
    cseStructurallyReadyBefore: input.cseStructurallyReadyBefore === true,
    cseStructurallyReadyAfter: evidenceResult?.canonicalSoldEvidenceStructurallyReady === true,
    conflictsCount: conflicts.length,
    modelValidationReasonCodes: asArray(modelValidation.reasonCodes).sort(),
    nonPersistent: true,
    writesProductionStore: false,
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
  report.reportFingerprint = fingerprint(report);
  return deepFreeze(report);
}

async function runFixtureMultimodalImagePilot(input = {}) {
  const request = createMultimodalModelRequest(input.request);
  const adapter = input.adapter || createFixtureMultimodalModelAdapter(input.fixtureConfig);
  const modelResponse = await adapter.analyzeImage(request);
  const modelValidation = validateMultimodalModelResponse(modelResponse, request);
  const observations = modelValidation.valid
    ? modelValidation.response.observations.map((observation) => mapModelObservationToEvidenceObservation(observation, modelValidation.response))
    : [];
  const evidenceResult = resolveMultimodalSoldIdentityEvidence({
    transaction: input.transaction,
    titleResolution: input.titleResolution,
    observations
  });
  const report = buildSanitizedMultimodalPilotReport({
    providerTransactionObtained: Boolean(input.transaction),
    imageAvailable: Boolean(request.imageReference),
    modelRequestExecuted: true,
    modelValidation,
    evidenceResult,
    cseStructurallyReadyBefore: input.titleResolution?.canonicalSoldEvidenceStructurallyReady === true
  });
  return deepFreeze({
    source: SOURCE,
    version: VERSION,
    request,
    prompt: buildMultimodalModelPromptContract(request),
    modelValidation,
    evidenceResult,
    report,
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  });
}

function evaluateRealProviderFeasibility(env = process.env) {
  const configuredProviders = [];
  if (env.OPENAI_API_KEY) configuredProviders.push('openai');
  if (env.ANTHROPIC_API_KEY) configuredProviders.push('anthropic');
  if (env.GEMINI_API_KEY || env.GOOGLE_API_KEY) configuredProviders.push('gemini');
  return deepFreeze({
    source: SOURCE,
    version: VERSION,
    configuredProviders,
    providerSpecificAdapterAvailable: false,
    liveExecutionReady: false,
    missingConfiguration: configuredProviders.length
      ? ['provider_specific_multimodal_adapter']
      : ['multimodal_provider_api_key', 'provider_specific_multimodal_adapter', 'explicit_live_compatibility_flag'],
    costMetadataAvailable: false,
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  });
}

module.exports = {
  SOURCE,
  VERSION,
  SCHEMA_VERSION,
  EXECUTION_STATUS,
  EVIDENCE_TYPES,
  EXPLICIT_OR_INFERRED,
  DEFAULT_REQUESTED_FIELDS,
  createMultimodalModelRequest,
  validateMultimodalModelRequest,
  buildMultimodalModelPromptContract,
  validateMultimodalModelResponse,
  mapModelObservationToEvidenceObservation,
  createFixtureMultimodalModelAdapter,
  runFixtureMultimodalImagePilot,
  buildSanitizedMultimodalPilotReport,
  evaluateRealProviderFeasibility
};
