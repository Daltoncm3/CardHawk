'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  LIVE_FLAG_ENV: CARD_API_LIVE_FLAG_ENV
} = require('../marketplaces/cardApiAcquisitionAdapter');
const {
  EXECUTION_STATUS,
  validateMultimodalModelResponse
} = require('../validation/multimodalModelAdapterContract');
const {
  ADAPTER_ID,
  DEFAULT_MAX_OUTPUT_TOKENS,
  DEFAULT_OPENAI_MODEL,
  DEFAULT_TIMEOUT_MS,
  LIVE_STATUS,
  MAX_OUTPUT_TOKENS,
  MAX_TIMEOUT_MS,
  OPENAI_API_KEY_ENV,
  OPENAI_LIVE_FLAG_ENV,
  OPENAI_MODEL_ENV,
  OPENAI_RESPONSES_URL,
  PROVIDER_ID,
  buildOpenAIResponsesRequestBody,
  createOpenAIMultimodalProviderAdapter,
  normalizeOpenAIMaxOutputTokens,
  normalizeOpenAITimeoutMs,
  runOpenAIMultimodalCompatibilityPilot,
  validateOpenAILiveGates
} = require('../validation/openaiMultimodalProviderAdapter');

function env(overrides = {}) {
  return {
    CARDHAWK_CARD_API_KEY: 'tca_test_secret_not_printed',
    [CARD_API_LIVE_FLAG_ENV]: 'true',
    [OPENAI_API_KEY_ENV]: 'sk-test-secret-not-printed',
    [OPENAI_LIVE_FLAG_ENV]: 'true',
    [OPENAI_MODEL_ENV]: DEFAULT_OPENAI_MODEL,
    ...overrides
  };
}

function sale(overrides = {}) {
  return {
    id: 'sale-secret-id-001',
    platform: 'eBay',
    title: '2024 Topps Chrome Shohei Ohtani #17 Gold Auto Patch /99 PSA 10',
    price: 42,
    sold_at: '2026-09-17T00:00:00.000Z',
    currency: 'USD',
    listing_type: 'fixed_price',
    listing_url: 'https://www.ebay.com/itm/sale-secret-id-001',
    image_url: 'https://i.ebayimg.example/sale-secret-id-001/full-image.jpg',
    shipping_price: 0,
    price_confirmed: true,
    ...overrides
  };
}

function responsePayload(requestId = 'a5-7-openai-multimodal-request-1', observations = []) {
  return {
    status: 'completed',
    output_text: JSON.stringify({
      requestId,
      adapterId: ADAPTER_ID,
      providerId: PROVIDER_ID,
      modelId: DEFAULT_OPENAI_MODEL,
      executionStatus: EXECUTION_STATUS.SUCCESS,
      observations,
      warnings: [],
      errors: [],
      usage: { modelRequests: 1, inputImages: 1 },
      nonPersistent: true,
      writesProductionStore: false,
      productionImpact: 'none',
      decisionImpact: 'none',
      executionAuthority: 'none'
    }),
    usage: {
      input_tokens: 100,
      output_tokens: 20,
      total_tokens: 120
    }
  };
}

function obs(field, proposedValue, overrides = {}) {
  return {
    field,
    proposedValue,
    confidence: 0.96,
    evidenceType: 'explicit_visual_evidence',
    modality: 'image_ocr',
    explicitOrInferred: 'explicit',
    deterministicVerificationPossible: true,
    ambiguity: [],
    warnings: [],
    multipleCardsVisible: false,
    ...overrides
  };
}

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return name.toLowerCase() === 'content-type' ? 'application/json' : null;
      }
    },
    async json() {
      return payload;
    },
    async text() {
      return JSON.stringify(payload);
    }
  };
}

function combinedFetch(payload = responsePayload(), calls = []) {
  return async (url, options = {}) => {
    calls.push({ url, options });
    if (String(url).includes('thecardapi.com')) {
      return jsonResponse({ sales: [sale()] });
    }
    if (String(url) === OPENAI_RESPONSES_URL) {
      return jsonResponse(payload);
    }
    throw new Error(`unexpected url ${url}`);
  };
}

test('OpenAI adapter conforms to the A5.6 response contract', async () => {
  const request = {
    requestId: 'req-openai-1',
    imageReference: 'https://i.ebayimg.example/card.jpg',
    titleContext: '2024 Topps Chrome Shohei Ohtani #17'
  };
  const adapter = createOpenAIMultimodalProviderAdapter({
    env: env(),
    fetchImpl: async () => jsonResponse(responsePayload('req-openai-1', [obs('subjectName', 'Shohei Ohtani')]))
  });
  const response = await adapter.analyzeImage(request, { env: env() });
  const validation = validateMultimodalModelResponse(response, request);

  assert.equal(response.adapterId, ADAPTER_ID);
  assert.equal(response.providerId, PROVIDER_ID);
  assert.equal(validation.valid, true);
  assert.equal(response.nonPersistent, true);
  assert.equal(response.writesProductionStore, false);
});

test('OpenAI request shape uses Responses image input and strict structured output', () => {
  const body = buildOpenAIResponsesRequestBody({
    requestId: 'req-shape',
    imageReference: 'https://i.ebayimg.example/card.jpg',
    titleContext: 'untrusted title'
  });

  assert.equal(body.model, DEFAULT_OPENAI_MODEL);
  assert.equal(body.store, false);
  assert.equal(body.input[0].content[0].type, 'input_text');
  assert.equal(body.input[0].content[1].type, 'input_image');
  assert.equal(body.input[0].content[1].image_url, 'https://i.ebayimg.example/card.jpg');
  assert.equal(body.text.format.type, 'json_schema');
  assert.equal(body.text.format.strict, true);
  assert.equal(body.text.format.schema.additionalProperties, false);
  assert.equal(Object.hasOwn(body, 'temperature'), false);
  assert.equal(body.max_output_tokens, 4000);
});

test('OpenAI output budget defaults to 4000 tokens and cannot exceed 4000 tokens', () => {
  assert.equal(DEFAULT_MAX_OUTPUT_TOKENS, 4000);
  assert.equal(MAX_OUTPUT_TOKENS, 4000);
  assert.equal(normalizeOpenAIMaxOutputTokens(), 4000);
  assert.equal(normalizeOpenAIMaxOutputTokens(9000), 4000);
  assert.equal(normalizeOpenAIMaxOutputTokens(4001), 4000);
  assert.equal(normalizeOpenAIMaxOutputTokens(1600), 1600);
  assert.equal(normalizeOpenAIMaxOutputTokens(-1), 4000);
  assert.equal(buildOpenAIResponsesRequestBody({
    requestId: 'req-cap',
    imageReference: 'https://i.ebayimg.example/card.jpg'
  }, { maxOutputTokens: 12000 }).max_output_tokens, 4000);
});

test('OpenAI timeout defaults to 60 seconds and cannot exceed 60 seconds', () => {
  assert.equal(DEFAULT_TIMEOUT_MS, 60000);
  assert.equal(MAX_TIMEOUT_MS, 60000);
  assert.equal(normalizeOpenAITimeoutMs(), 60000);
  assert.equal(normalizeOpenAITimeoutMs(90000), 60000);
  assert.equal(normalizeOpenAITimeoutMs(60001), 60000);
  assert.equal(normalizeOpenAITimeoutMs(250), 250);
  assert.equal(normalizeOpenAITimeoutMs(-1), 60000);
});

test('live execution is disabled by default and missing OpenAI credential is sanitized', async () => {
  let calls = 0;
  const result = await runOpenAIMultimodalCompatibilityPilot({
    env: {},
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse({});
    }
  });
  const serialized = JSON.stringify(result);

  assert.equal(calls, 0);
  assert.equal(result.report.liveExecutionStatus, LIVE_STATUS.MISSING_CARD_API_CREDENTIAL);
  assert.equal(serialized.includes('sk-'), false);
  assert.equal(serialized.includes('tca_'), false);

  const missingOpenAI = await runOpenAIMultimodalCompatibilityPilot({
    env: env({ [OPENAI_API_KEY_ENV]: '' }),
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse({});
    }
  });

  assert.equal(calls, 0);
  assert.equal(missingOpenAI.report.liveExecutionStatus, LIVE_STATUS.MISSING_OPENAI_CREDENTIAL);
});

test('missing or invalid live flags block all network calls', async () => {
  let calls = 0;
  const result = await runOpenAIMultimodalCompatibilityPilot({
    env: env({ [OPENAI_LIVE_FLAG_ENV]: 'false' }),
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse({});
    }
  });

  assert.equal(calls, 0);
  assert.equal(result.report.liveExecutionStatus, LIVE_STATUS.MISSING_OPENAI_FLAG);

  const cardBlocked = await runOpenAIMultimodalCompatibilityPilot({
    env: env({ [CARD_API_LIVE_FLAG_ENV]: 'false' }),
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse({});
    }
  });

  assert.equal(calls, 0);
  assert.equal(cardBlocked.report.liveExecutionStatus, LIVE_STATUS.MISSING_CARD_API_FLAG);
});

test('hard bounds reject more than one transaction, image, or model request', () => {
  const validation = validateOpenAILiveGates({
    env: env(),
    transactionLimit: 2,
    imageLimit: 2,
    modelRequestLimit: 2
  });

  assert.equal(validation.valid, false);
  assert.equal(validation.reasonCodes.includes('a5_7_limit_violation'), true);
  assert.equal(validation.limits.transactionLimit, 1);
  assert.equal(validation.limits.imageLimit, 1);
  assert.equal(validation.limits.modelRequestLimit, 1);
});

test('one-shot live pilot attempts at most one Card API request, one image, and one OpenAI request', async () => {
  const calls = [];
  const result = await runOpenAIMultimodalCompatibilityPilot({
    env: env(),
    fetchImpl: combinedFetch(responsePayload(undefined, [
      obs('subjectName', 'Shohei Ohtani'),
      obs('cardNumber', '17')
    ]), calls)
  });

  assert.equal(calls.filter((call) => String(call.url).includes('thecardapi.com')).length, 1);
  assert.equal(calls.filter((call) => String(call.url) === OPENAI_RESPONSES_URL).length, 1);
  assert.equal(result.report.transactionsRequested, 1);
  assert.equal(result.report.transactionsEvaluated, 1);
  assert.equal(result.report.imagesEvaluated, 1);
  assert.equal(result.report.modelRequestsAttempted, 1);
  assert.equal(result.report.modelRequestsCompleted, 1);
});

test('no retries occur after timeout, HTTP failure, invalid JSON, or schema failure', async () => {
  const scenarios = [
    async () => jsonResponse({ error: 'nope' }, 500),
    async () => jsonResponse({ status: 'incomplete', output_text: '' }),
    async () => jsonResponse({ status: 'completed', output_text: 'plain prose' }),
    async () => jsonResponse(responsePayload('wrong-request-id', [obs('unsupportedField', 'x')]))
  ];

  for (const fetchImpl of scenarios) {
    let calls = 0;
    const adapter = createOpenAIMultimodalProviderAdapter({
      env: env(),
      fetchImpl: async (...args) => {
        calls += 1;
        return fetchImpl(...args);
      }
    });
    const response = await adapter.analyzeImage({
      requestId: 'req-one-shot',
      imageReference: 'https://i.ebayimg.example/card.jpg'
    }, { env: env() });

    assert.equal(calls, 1);
    assert.notEqual(response.executionStatus, EXECUTION_STATUS.SUCCESS);
  }
});

test('timeout aborts safely without retry and keeps output sanitized', async () => {
  let calls = 0;
  const adapter = createOpenAIMultimodalProviderAdapter({
    env: env(),
    timeoutMs: 1,
    fetchImpl: async (_url, options = {}) => {
      calls += 1;
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          const error = new Error('Timed out while reading https://i.ebayimg.example/sale-secret-id-001/full-image.jpg sk-test-secret-not-printed');
          error.name = 'AbortError';
          reject(error);
        });
      });
    }
  });
  const response = await adapter.analyzeImage({
    requestId: 'req-timeout',
    imageReference: 'https://i.ebayimg.example/card.jpg'
  }, { env: env() });
  const serialized = JSON.stringify(response);

  assert.equal(calls, 1);
  assert.equal(response.executionStatus, EXECUTION_STATUS.ERROR);
  assert.deepEqual(response.errors, ['openai_request_timeout']);
  assert.equal(response.usage.modelRequests, 1);
  assert.equal(response.usage.inputImages, 1);
  assert.equal(serialized.includes('https://i.ebayimg.example'), false);
  assert.equal(serialized.includes('sale-secret-id-001'), false);
  assert.equal(serialized.includes('sk-test-secret-not-printed'), false);
  assert.equal(response.productionImpact, 'none');
  assert.equal(response.decisionImpact, 'none');
  assert.equal(response.executionAuthority, 'none');
});

test('incomplete OpenAI responses fail safely with sanitized bounded reason and no retry', async () => {
  const calls = [];
  const payload = {
    status: 'incomplete',
    incomplete_details: {
      reason: 'max_output_tokens'
    },
    output_text: '{"raw":"do not retain this partial model output","url":"https://i.ebayimg.example/sale-secret-id-001/full-image.jpg"}',
    usage: {
      input_tokens: 2526,
      output_tokens: 4000,
      total_tokens: 6526
    }
  };
  const result = await runOpenAIMultimodalCompatibilityPilot({
    env: env(),
    fetchImpl: combinedFetch(payload, calls)
  });
  const serialized = JSON.stringify(result);

  assert.equal(calls.filter((call) => String(call.url) === OPENAI_RESPONSES_URL).length, 1);
  assert.equal(result.report.liveExecutionStatus, LIVE_STATUS.MODEL_INVALID_RESPONSE);
  assert.equal(result.report.modelRequestsAttempted, 1);
  assert.equal(result.report.modelRequestsCompleted, 0);
  assert.equal(result.report.sanitizedFailureCategory, 'openai_response_incomplete');
  assert.equal(result.report.boundedUsage.openAiIncompleteReason, 'max_output_tokens');
  assert.equal(result.report.boundedUsage.inputTokens, 2526);
  assert.equal(result.report.boundedUsage.outputTokens, 4000);
  assert.equal(serialized.includes('do not retain this partial model output'), false);
  assert.equal(serialized.includes('https://i.ebayimg.example'), false);
  assert.equal(serialized.includes('sale-secret-id-001'), false);
  assert.equal(result.report.productionImpact, 'none');
  assert.equal(result.report.decisionImpact, 'none');
  assert.equal(result.report.executionAuthority, 'none');
});

test('HTTP 400 diagnostics are safely reduced to approved OpenAI error fields', async () => {
  let calls = 0;
  const adapter = createOpenAIMultimodalProviderAdapter({
    env: env(),
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse({
        error: {
          message: 'Unsupported parameter temperature for https://i.ebayimg.example/sale-secret-id-001/full-image.jpg sk-test-secret-not-printed 2024 Topps Chrome Shohei Ohtani',
          type: 'invalid_request_error',
          code: 'unsupported_parameter',
          param: 'temperature'
        }
      }, 400);
    }
  });
  const response = await adapter.analyzeImage({
    requestId: 'req-http-400',
    imageReference: 'https://i.ebayimg.example/card.jpg'
  }, { env: env() });
  const serialized = JSON.stringify(response);

  assert.equal(calls, 1);
  assert.equal(response.executionStatus, EXECUTION_STATUS.ERROR);
  assert.equal(response.usage.providerStatus, 400);
  assert.equal(response.usage.openAiErrorType, 'invalid_request_error');
  assert.equal(response.usage.openAiErrorCode, 'unsupported_parameter');
  assert.equal(response.usage.openAiErrorParam, 'temperature');
  assert.equal(serialized.includes('Unsupported parameter'), false);
  assert.equal(serialized.includes('https://i.ebayimg.example'), false);
  assert.equal(serialized.includes('sale-secret-id-001'), false);
  assert.equal(serialized.includes('sk-test-secret-not-printed'), false);
  assert.equal(serialized.includes('2024 Topps Chrome'), false);
});

test('strict schema validation rejects arbitrary prose, malformed responses, unsupported and excessive observations', async () => {
  const adapter = createOpenAIMultimodalProviderAdapter({
    env: env(),
    fetchImpl: async () => jsonResponse({ status: 'completed', output_text: 'This card looks exact.' })
  });
  const prose = await adapter.analyzeImage({
    requestId: 'req-prose',
    imageReference: 'https://i.ebayimg.example/card.jpg'
  }, { env: env() });

  assert.equal(prose.executionStatus, EXECUTION_STATUS.INVALID_RESPONSE);

  const many = Array.from({ length: 13 }, (_, index) => obs('subjectName', `Name ${index}`));
  const request = { requestId: 'req-many', imageReference: 'https://i.ebayimg.example/card.jpg' };
  const response = await createOpenAIMultimodalProviderAdapter({
    env: env(),
    fetchImpl: async () => jsonResponse(responsePayload('req-many', many))
  }).analyzeImage(request, { env: env() });
  const validation = validateMultimodalModelResponse(response, request);

  assert.equal(validation.valid, true);
  assert.equal(validation.response.observations.length, 12);
});

test('absence, low confidence, inferred, ambiguous, unverifiable, and conflicting observations remain inadmissible', async () => {
  const calls = [];
  const result = await runOpenAIMultimodalCompatibilityPilot({
    env: env(),
    fetchImpl: combinedFetch(responsePayload(undefined, [
      obs('autographState', false),
      obs('subjectName', 'Shohei Ohtani', { confidence: 0.5 }),
      obs('parallel', 'Gold', { evidenceType: 'inferred_visual_evidence', explicitOrInferred: 'inferred' }),
      obs('grade', '10', { warnings: ['slab partially obscured'] }),
      obs('cardNumber', '17', { deterministicVerificationPossible: false }),
      obs('cardNumber', '99')
    ]), calls)
  });

  assert.equal(result.evidenceResult.admittedMultimodalFields.length, 0);
  assert.equal(result.evidenceResult.rejectedMultimodalFields.length >= 5, true);
  assert.equal(result.evidenceResult.conflicts.length, 1);
  assert.equal(result.report.exactReached, false);
});

test('model observations cannot directly set EXACT and canonical resolution remains deterministic authority', async () => {
  const calls = [];
  const result = await runOpenAIMultimodalCompatibilityPilot({
    env: env(),
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      if (String(url).includes('thecardapi.com')) {
        return jsonResponse({ sales: [sale({ title: '2024 Topps Chrome Baseball' })] });
      }
      return jsonResponse(responsePayload(undefined, [
        obs('subjectName', 'Shohei Ohtani'),
        obs('cardNumber', '17'),
        obs('parallel', 'Gold'),
        obs('autographState', true),
        obs('memorabiliaState', true),
        obs('printRun', 99),
        obs('gradeCompany', 'PSA'),
        obs('grade', '10')
      ]));
    }
  });

  assert.equal(result.modelValidation.response.postMultimodalClassification, undefined);
  assert.equal(result.evidenceResult.postMultimodalClassification, 'EXACT');
  assert.equal(result.report.exactReached, true);
  assert.equal(result.report.classificationImproved, true);
});

test('A5.8 report exposes sanitized recovered material field diagnostics only', async () => {
  const calls = [];
  const result = await runOpenAIMultimodalCompatibilityPilot({
    env: env(),
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      if (String(url).includes('thecardapi.com')) {
        return jsonResponse({ sales: [sale({ title: '2024 Topps Chrome Baseball' })] });
      }
      return jsonResponse(responsePayload(undefined, [
        obs('subjectName', 'Shohei Ohtani'),
        obs('cardNumber', '17'),
        obs('parallel', 'Gold'),
        obs('autographState', true),
        obs('memorabiliaState', true),
        obs('printRun', 99),
        obs('gradeCompany', 'PSA'),
        obs('grade', '10')
      ]));
    }
  });
  const report = result.report;

  assert.deepEqual(report.missingMaterialFieldsBefore, [
    'autographState',
    'cardNumber',
    'memorabiliaState',
    'parallel',
    'rawOrGraded',
    'serialNumbered',
    'subjectName'
  ]);
  assert.deepEqual(report.missingMaterialFieldsAfter, []);
  assert.deepEqual(report.recoveredMaterialFields, [
    'autographState',
    'cardNumber',
    'memorabiliaState',
    'parallel',
    'subjectName'
  ]);
  assert.deepEqual(report.admittedObservationFields, [
    'autographState',
    'cardNumber',
    'grade',
    'gradeCompany',
    'memorabiliaState',
    'parallel',
    'printRun',
    'subjectName'
  ]);
  assert.deepEqual(report.rejectedObservationFields, []);
  assert.deepEqual(report.rejectedObservationReasonsByField, {});
  assert.deepEqual(report.conflictFields, []);
  assert.equal(report.materialFieldRecoveryCount, 5);
  assert.equal(report.materialFieldRecoveryRate, 0.7143);
  assert.equal(report.missingMaterialFieldCountBefore, 7);
  assert.equal(report.missingMaterialFieldCountAfter, 0);
  assert.equal(report.modelRequestsAttempted, 1);
  assert.equal(report.modelRequestsCompleted, 1);
  assert.equal(report.productionImpact, 'none');
  assert.equal(report.decisionImpact, 'none');
  assert.equal(report.executionAuthority, 'none');
});

test('A5.8 recovered fields require admitted evidence and exclude rejected unknown and conflicting observations', async () => {
  const calls = [];
  const result = await runOpenAIMultimodalCompatibilityPilot({
    env: env(),
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      if (String(url).includes('thecardapi.com')) {
        return jsonResponse({ sales: [sale({ title: '2024 Topps Chrome Baseball' })] });
      }
      return jsonResponse(responsePayload(undefined, [
        obs('subjectName', 'Shohei Ohtani'),
        obs('parallel', 'Gold', { evidenceType: 'inferred_visual_evidence', explicitOrInferred: 'inferred' }),
        obs('cardNumber', 'unknown', {
          evidenceType: 'unknown_not_observable',
          explicitOrInferred: 'unknown',
          deterministicVerificationPossible: false
        }),
        obs('autographState', false),
        obs('year', 2023)
      ]));
    }
  });
  const report = result.report;
  const serialized = JSON.stringify(report);

  assert.deepEqual(report.recoveredMaterialFields, ['subjectName']);
  assert.equal(report.materialFieldRecoveryCount, 1);
  assert.equal(report.materialFieldRecoveryRate, 0.1429);
  assert.equal(report.missingMaterialFieldsAfter.includes('parallel'), true);
  assert.equal(report.missingMaterialFieldsAfter.includes('cardNumber'), true);
  assert.equal(report.missingMaterialFieldsAfter.includes('autographState'), true);
  assert.deepEqual(report.admittedObservationFields, ['subjectName']);
  assert.deepEqual(report.rejectedObservationFields, ['autographState', 'cardNumber', 'parallel']);
  assert.deepEqual(report.conflictFields, ['year']);
  assert.deepEqual(report.rejectedObservationReasonsByField, {
    autographState: { absence_is_not_negative_evidence: 1 },
    cardNumber: { unknown_not_observable: 1 },
    parallel: { inferred_visual_evidence_requires_review: 1 }
  });
  assert.deepEqual(report.missingMaterialFieldsBefore, [...report.missingMaterialFieldsBefore].sort());
  assert.deepEqual(report.admittedObservationFields, [...new Set(report.admittedObservationFields)].sort());
  assert.equal(report.missingMaterialFieldsBefore.length <= 16, true);
  assert.equal(report.admittedObservationFields.length <= 16, true);
  assert.equal(report.rejectedObservationFields.length <= 16, true);
  assert.equal(report.conflictFields.length <= 16, true);
  assert.equal(serialized.includes('Shohei Ohtani'), false);
  assert.equal(serialized.includes('Gold'), false);
  assert.equal(serialized.includes('2024 Topps Chrome'), false);
  assert.equal(serialized.includes('https://'), false);
  assert.equal(serialized.includes('sale-secret-id-001'), false);
  assert.equal(serialized.includes('sk-test-secret-not-printed'), false);
  assert.equal(serialized.includes('tca_test_secret_not_printed'), false);
  assert.equal(serialized.includes('output_text'), false);
  assert.equal(calls.filter((call) => String(call.url).includes('thecardapi.com')).length, 1);
  assert.equal(calls.filter((call) => String(call.url) === OPENAI_RESPONSES_URL).length, 1);
});

test('A5.8 resolver-derived fields do not count as recovered without same-field admitted evidence', async () => {
  const result = await runOpenAIMultimodalCompatibilityPilot({
    env: env(),
    fetchImpl: async (url) => {
      if (String(url).includes('thecardapi.com')) {
        return jsonResponse({ sales: [sale({ title: '2024 Topps Chrome Baseball' })] });
      }
      return jsonResponse(responsePayload(undefined, [
        obs('printRun', 99),
        obs('gradeCompany', 'PSA'),
        obs('grade', '10')
      ]));
    }
  });
  const report = result.report;

  assert.deepEqual(report.admittedObservationFields, ['grade', 'gradeCompany', 'printRun']);
  assert.equal(report.missingMaterialFieldsBefore.includes('rawOrGraded'), true);
  assert.equal(report.missingMaterialFieldsBefore.includes('serialNumbered'), true);
  assert.equal(report.missingMaterialFieldsAfter.includes('rawOrGraded'), false);
  assert.equal(report.missingMaterialFieldsAfter.includes('serialNumbered'), false);
  assert.equal(report.recoveredMaterialFields.includes('rawOrGraded'), false);
  assert.equal(report.recoveredMaterialFields.includes('serialNumbered'), false);
  assert.deepEqual(report.recoveredMaterialFields, []);
  assert.equal(report.materialFieldRecoveryCount, 0);
  assert.equal(report.materialFieldRecoveryRate, 0);
});

test('sanitized reports contain no credentials, raw provider payloads, raw model output, full image URLs, or identifiers', async () => {
  const result = await runOpenAIMultimodalCompatibilityPilot({
    env: env(),
    fetchImpl: combinedFetch(responsePayload(undefined, [obs('subjectName', 'Shohei Ohtani')]))
  });
  const serialized = JSON.stringify(result.report);

  assert.equal(serialized.includes('sk-test-secret-not-printed'), false);
  assert.equal(serialized.includes('tca_test_secret_not_printed'), false);
  assert.equal(serialized.includes('Authorization'), false);
  assert.equal(serialized.includes('https://i.ebayimg.example'), false);
  assert.equal(serialized.includes('sale-secret-id-001'), false);
  assert.equal(serialized.includes('2024 Topps Chrome Shohei'), false);
  assert.equal(serialized.includes('output_text'), false);
  assert.equal(result.report.writesProductionStore, false);
});

test('live data is not written to disk or application stores during pilot execution', async () => {
  const beforeData = fs.existsSync(path.join(__dirname, '..', 'data', 'cardhawk-data.json'))
    ? fs.statSync(path.join(__dirname, '..', 'data', 'cardhawk-data.json')).mtimeMs
    : null;
  const calls = [];
  const result = await runOpenAIMultimodalCompatibilityPilot({
    env: env(),
    fetchImpl: combinedFetch(responsePayload(undefined, [obs('subjectName', 'Shohei Ohtani')]), calls)
  });
  const afterData = fs.existsSync(path.join(__dirname, '..', 'data', 'cardhawk-data.json'))
    ? fs.statSync(path.join(__dirname, '..', 'data', 'cardhawk-data.json')).mtimeMs
    : null;

  assert.equal(result.report.nonPersistent, true);
  assert.equal(afterData, beforeData);
});

test('existing Card API retention restrictions remain enforced in translated transaction path', async () => {
  const calls = [];
  await runOpenAIMultimodalCompatibilityPilot({
    env: env(),
    fetchImpl: combinedFetch(responsePayload(undefined, [obs('subjectName', 'Shohei Ohtani')]), calls)
  });
  const cardRequest = calls.find((call) => String(call.url).includes('thecardapi.com'));

  assert.equal(cardRequest.options.method, 'GET');
  assert.equal(cardRequest.options.headers['x-market-api-key'], env().CARDHAWK_CARD_API_KEY);
});

test('module imports no runtime, persistence, notification, scanner, purchase, or server code', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'validation', 'openaiMultimodalProviderAdapter.js'), 'utf8');
  const forbidden = [
    'server.js',
    'appStore',
    'stateStore',
    'soldEvidenceStore',
    'notificationEngine',
    'scoutScannerService',
    'BUY_NOW',
    'purchase',
    'bid',
    'offer'
  ];

  for (const token of forbidden) {
    assert.equal(source.includes(token), false, `forbidden token present: ${token}`);
  }
});
