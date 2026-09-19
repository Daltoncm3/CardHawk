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
  DEFAULT_OPENAI_MODEL,
  LIVE_STATUS,
  OPENAI_API_KEY_ENV,
  OPENAI_LIVE_FLAG_ENV,
  OPENAI_MODEL_ENV,
  OPENAI_RESPONSES_URL,
  PROVIDER_ID,
  buildOpenAIResponsesRequestBody,
  createOpenAIMultimodalProviderAdapter,
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
