'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  LIVE_FLAG_ENV: CARD_API_LIVE_FLAG_ENV
} = require('../marketplaces/cardApiAcquisitionAdapter');
const {
  EXECUTION_STATUS
} = require('../validation/multimodalModelAdapterContract');
const {
  ADAPTER_ID,
  DEFAULT_OPENAI_MODEL,
  FEASIBILITY_CLASSIFICATIONS,
  OPENAI_API_KEY_ENV,
  OPENAI_LIVE_FLAG_ENV,
  OPENAI_MODEL_ENV,
  OPENAI_RESPONSES_URL,
  PROVIDER_ID
} = require('../validation/openaiMultimodalProviderAdapter');
const {
  FEASIBILITY_SAMPLE_LIVE_FLAG_ENV,
  FEASIBILITY_SAMPLE_MAX_OBSERVATIONS,
  FEASIBILITY_SAMPLE_MAX_OUTPUT_TOKENS,
  FEASIBILITY_SAMPLE_REASONING_EFFORT,
  FEASIBILITY_SAMPLE_REQUESTED_FIELDS,
  FEASIBILITY_SAMPLE_TEXT_VERBOSITY,
  MAX_FEASIBILITY_SAMPLE_IMAGES,
  MAX_FEASIBILITY_SAMPLE_MODEL_REQUESTS,
  MAX_FEASIBILITY_SAMPLE_TRANSACTIONS,
  SAMPLE_EXECUTION_STATUS,
  runOpenAIMultimodalFeasibilitySample,
  validateOpenAIFeasibilitySampleGates
} = require('../validation/multimodalFeasibilitySample');

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

function sampleEnv(overrides = {}) {
  return env({
    [FEASIBILITY_SAMPLE_LIVE_FLAG_ENV]: 'true',
    ...overrides
  });
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

function sampleSale(index, overrides = {}) {
  return sale({
    id: `sample-secret-id-${index}`,
    title: `2024 Topps Chrome Sample Secret Player ${index} #${index} Gold Auto Patch /99 PSA 10`,
    listing_url: `https://www.ebay.com/itm/sample-secret-id-${index}`,
    image_url: `https://i.ebayimg.example/sample-secret-id-${index}/full-image.jpg`,
    ...overrides
  });
}

function responsePayload(requestId = 'a5-10-openai-multimodal-request-1', observations = []) {
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
    evidenceModality: 'image',
    explicitOrInferred: 'explicit',
    deterministicVerificationPossible: true,
    warnings: [],
    ...overrides
  };
}

async function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    json: async () => payload,
    text: async () => JSON.stringify(payload)
  };
}

function aggregateOnlyReport(overrides = {}) {
  return {
    preVisionClassification: 'AMBIGUOUS',
    postVisionClassification: 'AMBIGUOUS',
    classificationImproved: false,
    exactReached: false,
    canonicalSoldEvidenceStructurallyReady: false,
    admittedObservationCount: 0,
    rejectedObservationCount: 0,
    modelRequestsCompleted: 1,
    rejectionReasonCounts: {},
    missingMaterialFieldsBefore: ['sport'],
    missingMaterialFieldsAfter: ['sport'],
    recoveredMaterialFields: [],
    conflictFields: [],
    blockerClassificationByField: {},
    requiredEvidenceCategoriesByField: {},
    additionalEvidenceRequired: true,
    materialFieldRecoveryRate: 0,
    boundedUsage: {
      inputTokens: 10,
      outputTokens: 2,
      totalTokens: 12,
      modelRequests: 1,
      inputImages: 1
    },
    sanitizedFailureCategory: null,
    ...overrides
  };
}

async function withMockedSampleAnalysis(reports, fn) {
  const samplePath = require.resolve('../validation/multimodalFeasibilitySample');
  const providerPath = require.resolve('../validation/openaiMultimodalProviderAdapter');
  const provider = require(providerPath);
  const original = provider.runOpenAIMultimodalTransactionAnalysis;
  const queue = [...reports];
  provider.runOpenAIMultimodalTransactionAnalysis = async () => ({
    report: queue.shift()
  });
  delete require.cache[samplePath];

  try {
    return await fn(require(samplePath));
  } finally {
    provider.runOpenAIMultimodalTransactionAnalysis = original;
    delete require.cache[samplePath];
  }
}

test('A5.10 feasibility sample is disabled by default and requires every live gate', async () => {
  let calls = 0;
  const disabled = await runOpenAIMultimodalFeasibilitySample({
    env: env({ [FEASIBILITY_SAMPLE_LIVE_FLAG_ENV]: '' }),
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse({});
    }
  });
  const missingOpenAI = await runOpenAIMultimodalFeasibilitySample({
    env: sampleEnv({ [OPENAI_API_KEY_ENV]: '' }),
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse({});
    }
  });
  const missingCardApi = await runOpenAIMultimodalFeasibilitySample({
    env: sampleEnv({ CARDHAWK_CARD_API_KEY: '' }),
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse({});
    }
  });
  const invalidLimits = validateOpenAIFeasibilitySampleGates({
    env: sampleEnv(),
    transactionLimit: 4,
    imageLimit: 4,
    modelRequestLimit: 4
  });

  assert.equal(calls, 0);
  assert.equal(disabled.report.sampleExecutionStatus, SAMPLE_EXECUTION_STATUS.MISSING_SAMPLE_FLAG);
  assert.equal(disabled.report.sanitizedFailureCategories.includes('feasibility_sample_live_flag_missing'), true);
  assert.equal(missingOpenAI.report.sampleExecutionStatus, SAMPLE_EXECUTION_STATUS.MISSING_OPENAI_CREDENTIAL);
  assert.equal(missingCardApi.report.sampleExecutionStatus, SAMPLE_EXECUTION_STATUS.MISSING_CARD_API_CREDENTIAL);
  assert.equal(invalidLimits.valid, false);
  assert.equal(invalidLimits.reasonCodes.includes('a5_10_limit_violation'), true);
  assert.equal(invalidLimits.limits.transactionLimit, MAX_FEASIBILITY_SAMPLE_TRANSACTIONS);
  assert.equal(invalidLimits.limits.imageLimit, MAX_FEASIBILITY_SAMPLE_IMAGES);
  assert.equal(invalidLimits.limits.modelRequestLimit, MAX_FEASIBILITY_SAMPLE_MODEL_REQUESTS);
});

test('A5.10 feasibility sample completes three unique transactions sequentially with aggregate-only output', async () => {
  const calls = [];
  let activeOpenAI = 0;
  let maxActiveOpenAI = 0;
  const result = await runOpenAIMultimodalFeasibilitySample({
    env: sampleEnv(),
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      if (String(url).includes('thecardapi.com')) {
        return jsonResponse({ sales: [sampleSale(1), sampleSale(2), sampleSale(3), sampleSale(4)] });
      }
      activeOpenAI += 1;
      maxActiveOpenAI = Math.max(maxActiveOpenAI, activeOpenAI);
      const callNumber = calls.filter((call) => String(call.url) === OPENAI_RESPONSES_URL).length;
      const payload = responsePayload(`a5-10-openai-multimodal-request-${callNumber}`, [
        obs('subjectName', `CARDHAWK_SAMPLE_LEAK_${callNumber}`),
        obs('cardNumber', String(callNumber)),
        obs('parallel', 'Gold')
      ]);
      activeOpenAI -= 1;
      return jsonResponse(payload);
    }
  });
  const report = result.report;
  const serialized = JSON.stringify(report);

  assert.equal(report.sampleExecutionStatus, SAMPLE_EXECUTION_STATUS.COMPLETED);
  assert.equal(calls.filter((call) => String(call.url).includes('thecardapi.com')).length, 1);
  assert.equal(calls.filter((call) => String(call.url) === OPENAI_RESPONSES_URL).length, 3);
  assert.equal(maxActiveOpenAI, 1);
  for (const call of calls.filter((call) => String(call.url) === OPENAI_RESPONSES_URL)) {
    const body = JSON.parse(call.options.body);
    assert.equal(body.max_output_tokens, FEASIBILITY_SAMPLE_MAX_OUTPUT_TOKENS);
    assert.deepEqual(body.reasoning, { effort: FEASIBILITY_SAMPLE_REASONING_EFFORT });
    assert.equal(body.text.verbosity, FEASIBILITY_SAMPLE_TEXT_VERBOSITY);
    assert.equal(body.text.format.strict, true);
    assert.equal(body.store, false);
    assert.equal(body.text.format.schema.properties.observations.maxItems, FEASIBILITY_SAMPLE_MAX_OBSERVATIONS);
    assert.deepEqual(
      body.text.format.schema.properties.observations.items.properties.field.enum,
      FEASIBILITY_SAMPLE_REQUESTED_FIELDS
    );
    assert.equal(body.input[0].content[0].text.includes(`Requested identity fields: ${FEASIBILITY_SAMPLE_REQUESTED_FIELDS.join(', ')}`), true);
    assert.equal(Object.hasOwn(body, 'temperature'), false);
  }
  assert.equal(report.transactionsRequested, 3);
  assert.equal(report.transactionsReturned, 3);
  assert.equal(report.uniqueTransactionsEvaluated, 3);
  assert.equal(report.imagesEvaluated, 3);
  assert.equal(report.modelRequestsAttempted, 3);
  assert.equal(report.modelRequestsCompleted, 3);
  assert.equal(report.modelRequestFailures, 0);
  assert.equal(report.preVisionClassificationCounts.AMBIGUOUS, 3);
  assert.equal(report.postVisionClassificationCounts.AMBIGUOUS, 3);
  assert.equal(report.admittedObservationCount, 6);
  assert.equal(report.missingFieldFrequencyBefore.sport, 3);
  assert.equal(report.missingFieldFrequencyAfter.sport, 3);
  assert.equal(report.conflictFieldFrequency.subjectName, 3);
  assert.equal(report.requiredEvidenceCategoryFrequency.manual_verification >= 3, true);
  assert.equal(report.transactionsRequiringAdditionalEvidence, 3);
  assert.equal(report.exactReachedCount, 0);
  assert.equal(report.exactReachedRate, 0);
  assert.equal(report.averageMaterialFieldRecoveryRate, 0);
  assert.deepEqual(report.boundedTokenUsage, {
    inputTokens: 300,
    outputTokens: 60,
    totalTokens: 360,
    modelRequests: 3,
    inputImages: 3
  });
  assert.equal(report.nonPersistent, true);
  assert.equal(report.writesProductionStore, false);
  assert.equal(report.productionImpact, 'none');
  assert.equal(report.decisionImpact, 'none');
  assert.equal(report.executionAuthority, 'none');
  assert.equal(serialized.includes('CARDHAWK_SAMPLE_LEAK'), false);
  assert.equal(serialized.includes('Sample Secret Player'), false);
  assert.equal(serialized.includes('sample-secret-id'), false);
  assert.equal(serialized.includes('https://'), false);
  assert.equal(serialized.includes('sk-test-secret-not-printed'), false);
  assert.equal(serialized.includes('tca_test_secret_not_printed'), false);
  assert.equal(serialized.includes('output_text'), false);
});

test('A5.10 feasibility sample deduplicates and never retries failed model requests', async () => {
  const calls = [];
  const result = await runOpenAIMultimodalFeasibilitySample({
    env: sampleEnv(),
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      if (String(url).includes('thecardapi.com')) {
        return jsonResponse({
          sales: [
            sampleSale(1),
            sampleSale(1),
            sampleSale(2)
          ]
        });
      }
      return jsonResponse({
        error: {
          type: 'invalid_request_error',
          code: 'bad_request',
          param: 'input'
        }
      }, 400);
    }
  });
  const report = result.report;
  const serialized = JSON.stringify(report);

  assert.equal(report.sampleExecutionStatus, SAMPLE_EXECUTION_STATUS.PARTIALLY_COMPLETED);
  assert.equal(calls.filter((call) => String(call.url).includes('thecardapi.com')).length, 1);
  assert.equal(calls.filter((call) => String(call.url) === OPENAI_RESPONSES_URL).length, 2);
  assert.equal(report.transactionsReturned, 3);
  assert.equal(report.duplicateTransactionsSkipped, 1);
  assert.equal(report.transactionsWithoutImages, 0);
  assert.equal(report.imagesEvaluated, 2);
  assert.equal(report.modelRequestsAttempted, 2);
  assert.equal(report.modelRequestsCompleted, 0);
  assert.equal(report.modelRequestFailures, 2);
  assert.equal(report.uniqueTransactionsEvaluated, 2);
  assert.equal(report.sanitizedFailureCategories.includes('openai_request_failed'), true);
  assert.equal(report.sanitizedFailureCategories.includes('image_not_available'), false);
  assert.equal(report.boundedTokenUsage.modelRequests, 2);
  assert.equal(report.boundedTokenUsage.inputImages, 2);
  assert.equal(serialized.includes('sample-secret-id'), false);
  assert.equal(serialized.includes('invalid_request_error'), false);
  assert.equal(serialized.includes('bad_request'), false);
  assert.equal(serialized.includes('https://'), false);
});

test('A5.10B feasibility sample preserves 60-second cap and does not retry after provider timeouts', async () => {
  const calls = [];
  const result = await runOpenAIMultimodalFeasibilitySample({
    env: sampleEnv(),
    timeoutMs: 1,
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      if (String(url).includes('thecardapi.com')) {
        return jsonResponse({ sales: [sampleSale(1), sampleSale(2), sampleSale(3)] });
      }
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          const error = new Error('Timed out while reading https://i.ebayimg.example/sample-secret-id-1/full-image.jpg sk-test-secret-not-printed');
          error.name = 'AbortError';
          reject(error);
        });
      });
    }
  });
  const report = result.report;
  const serialized = JSON.stringify(report);
  const openAiCalls = calls.filter((call) => String(call.url) === OPENAI_RESPONSES_URL);

  assert.equal(openAiCalls.length, 3);
  for (const call of openAiCalls) {
    const body = JSON.parse(call.options.body);
    assert.equal(body.max_output_tokens, FEASIBILITY_SAMPLE_MAX_OUTPUT_TOKENS);
    assert.deepEqual(body.reasoning, { effort: FEASIBILITY_SAMPLE_REASONING_EFFORT });
    assert.equal(body.text.verbosity, FEASIBILITY_SAMPLE_TEXT_VERBOSITY);
    assert.equal(body.text.format.schema.properties.observations.maxItems, FEASIBILITY_SAMPLE_MAX_OBSERVATIONS);
    assert.deepEqual(
      body.text.format.schema.properties.observations.items.properties.field.enum,
      FEASIBILITY_SAMPLE_REQUESTED_FIELDS
    );
  }
  assert.equal(report.sampleExecutionStatus, SAMPLE_EXECUTION_STATUS.PARTIALLY_COMPLETED);
  assert.equal(report.modelRequestsAttempted, 3);
  assert.equal(report.modelRequestsCompleted, 0);
  assert.equal(report.modelRequestFailures, 3);
  assert.deepEqual(report.sanitizedFailureCategories, ['openai_request_timeout']);
  assert.deepEqual(report.boundedTokenUsage, {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    modelRequests: 3,
    inputImages: 3
  });
  assert.equal(serialized.includes('https://'), false);
  assert.equal(serialized.includes('sample-secret-id'), false);
  assert.equal(serialized.includes('sk-test-secret-not-printed'), false);
  assert.equal(report.nonPersistent, true);
  assert.equal(report.writesProductionStore, false);
  assert.equal(report.productionImpact, 'none');
  assert.equal(report.decisionImpact, 'none');
  assert.equal(report.executionAuthority, 'none');
});

test('A5.10C incomplete responses preserve sanitized max-output diagnostics without raw output', async () => {
  const calls = [];
  const result = await runOpenAIMultimodalFeasibilitySample({
    env: sampleEnv(),
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      if (String(url).includes('thecardapi.com')) {
        return jsonResponse({ sales: [sampleSale(1), sampleSale(2), sampleSale(3)] });
      }
      return jsonResponse({
        status: 'incomplete',
        incomplete_details: { reason: 'max_output_tokens' },
        output_text: '{"raw":"do not retain sample-secret-id-1 https://i.ebayimg.example/full-image.jpg"}',
        usage: {
          input_tokens: 800,
          output_tokens: FEASIBILITY_SAMPLE_MAX_OUTPUT_TOKENS,
          total_tokens: 4800,
          output_tokens_details: {
            reasoning_tokens: 3100
          }
        }
      });
    }
  });
  const report = result.report;
  const serialized = JSON.stringify(report);
  const openAiCalls = calls.filter((call) => String(call.url) === OPENAI_RESPONSES_URL);

  assert.equal(openAiCalls.length, 3);
  for (const call of openAiCalls) {
    const body = JSON.parse(call.options.body);
    assert.equal(body.max_output_tokens, FEASIBILITY_SAMPLE_MAX_OUTPUT_TOKENS);
    assert.deepEqual(body.reasoning, { effort: FEASIBILITY_SAMPLE_REASONING_EFFORT });
    assert.equal(body.text.verbosity, FEASIBILITY_SAMPLE_TEXT_VERBOSITY);
    assert.equal(body.store, false);
    assert.equal(body.text.format.strict, true);
  }
  assert.equal(report.sampleExecutionStatus, SAMPLE_EXECUTION_STATUS.PARTIALLY_COMPLETED);
  assert.equal(report.modelRequestsAttempted, 3);
  assert.equal(report.modelRequestsCompleted, 0);
  assert.equal(report.modelRequestFailures, 3);
  assert.deepEqual(report.sanitizedFailureCategories, ['openai_response_incomplete']);
  assert.equal(report.boundedTokenUsage.inputTokens, 2400);
  assert.equal(report.boundedTokenUsage.outputTokens, FEASIBILITY_SAMPLE_MAX_OUTPUT_TOKENS * 3);
  assert.equal(report.boundedTokenUsage.totalTokens, 14400);
  assert.equal(serialized.includes('do not retain'), false);
  assert.equal(serialized.includes('sample-secret-id'), false);
  assert.equal(serialized.includes('https://'), false);
  assert.equal(report.nonPersistent, true);
  assert.equal(report.writesProductionStore, false);
  assert.equal(report.productionImpact, 'none');
  assert.equal(report.decisionImpact, 'none');
  assert.equal(report.executionAuthority, 'none');
});

test('A5.10 feasibility sample skips transactions without images before model execution', async () => {
  const calls = [];
  const result = await runOpenAIMultimodalFeasibilitySample({
    env: sampleEnv(),
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      if (String(url).includes('thecardapi.com')) {
        return jsonResponse({
          sales: [
            sampleSale(1, { image_url: '' }),
            sampleSale(2, { image_url: '' }),
            sampleSale(3)
          ]
        });
      }
      return jsonResponse(responsePayload('a5-10-openai-multimodal-request-1', [
        obs('cardNumber', '3')
      ]));
    }
  });
  const report = result.report;

  assert.equal(report.sampleExecutionStatus, SAMPLE_EXECUTION_STATUS.PARTIALLY_COMPLETED);
  assert.equal(calls.filter((call) => String(call.url).includes('thecardapi.com')).length, 1);
  assert.equal(calls.filter((call) => String(call.url) === OPENAI_RESPONSES_URL).length, 1);
  assert.equal(report.transactionsReturned, 3);
  assert.equal(report.transactionsWithoutImages, 2);
  assert.equal(report.imagesEvaluated, 1);
  assert.equal(report.modelRequestsAttempted, 1);
  assert.equal(report.modelRequestsCompleted, 1);
  assert.equal(report.modelRequestFailures, 0);
  assert.equal(report.uniqueTransactionsEvaluated, 1);
  assert.deepEqual(report.sanitizedFailureCategories, ['image_not_available']);
});

test('A5.10A aggregates blocker classification values without field-name keys or malformed inflation', async () => {
  const calls = [];
  const reports = [
    aggregateOnlyReport({
      conflictFields: ['subjectName'],
      blockerClassificationByField: {
        autographState: FEASIBILITY_CLASSIFICATIONS.ABSENCE_SENSITIVE_NOT_PROVABLE_FROM_NONAPPEARANCE,
        subjectName: FEASIBILITY_CLASSIFICATIONS.CONFLICT_REQUIRES_RESOLUTION
      },
      requiredEvidenceCategoriesByField: {
        autographState: ['manual_verification'],
        subjectName: ['manual_verification']
      }
    }),
    aggregateOnlyReport({
      conflictFields: ['cardNumber'],
      blockerClassificationByField: {
        autographState: FEASIBILITY_CLASSIFICATIONS.ABSENCE_SENSITIVE_NOT_PROVABLE_FROM_NONAPPEARANCE,
        memorabiliaState: FEASIBILITY_CLASSIFICATIONS.ABSENCE_SENSITIVE_NOT_PROVABLE_FROM_NONAPPEARANCE,
        cardNumber: FEASIBILITY_CLASSIFICATIONS.CONFLICT_REQUIRES_RESOLUTION
      },
      requiredEvidenceCategoriesByField: {
        autographState: ['manual_verification'],
        memorabiliaState: ['manual_verification'],
        cardNumber: ['manual_verification']
      }
    }),
    aggregateOnlyReport({
      blockerClassificationByField: {
        parallel: [
          FEASIBILITY_CLASSIFICATIONS.EXPLICIT_VISUAL_EVIDENCE_POSSIBLE,
          FEASIBILITY_CLASSIFICATIONS.EXPLICIT_VISUAL_EVIDENCE_POSSIBLE,
          'MALFORMED_CLASSIFICATION'
        ],
        sport: 'MALFORMED_CLASSIFICATION',
        setName: null
      },
      requiredEvidenceCategoriesByField: {
        parallel: ['explicit_visual_evidence', 'manual_verification'],
        sport: ['provider_metadata']
      }
    })
  ];

  const result = await withMockedSampleAnalysis(reports, async (sample) => sample.runOpenAIMultimodalFeasibilitySample({
    env: sampleEnv(),
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      if (String(url).includes('thecardapi.com')) {
        return jsonResponse({ sales: [sampleSale(1), sampleSale(2), sampleSale(3)] });
      }
      throw new Error('unexpected_openai_request');
    }
  }));
  const report = result.report;
  const blockerKeys = Object.keys(report.blockerClassificationFrequency);
  const allowed = new Set(Object.values(FEASIBILITY_CLASSIFICATIONS));
  const serialized = JSON.stringify(report);

  assert.deepEqual(report.blockerClassificationFrequency, {
    [FEASIBILITY_CLASSIFICATIONS.ABSENCE_SENSITIVE_NOT_PROVABLE_FROM_NONAPPEARANCE]: 3,
    [FEASIBILITY_CLASSIFICATIONS.CONFLICT_REQUIRES_RESOLUTION]: 2,
    [FEASIBILITY_CLASSIFICATIONS.EXPLICIT_VISUAL_EVIDENCE_POSSIBLE]: 1
  });
  assert.deepEqual(blockerKeys, [...blockerKeys].sort());
  assert.equal(blockerKeys.every((key) => allowed.has(key)), true);
  assert.equal(Object.hasOwn(report.blockerClassificationFrequency, 'autographState'), false);
  assert.equal(Object.hasOwn(report.blockerClassificationFrequency, 'subjectName'), false);
  assert.equal(Object.hasOwn(report.blockerClassificationFrequency, 'MALFORMED_CLASSIFICATION'), false);
  assert.equal(calls.filter((call) => String(call.url).includes('thecardapi.com')).length, 1);
  assert.equal(calls.filter((call) => String(call.url) === OPENAI_RESPONSES_URL).length, 0);
  assert.equal(report.transactionsRequested, 3);
  assert.equal(report.transactionsReturned, 3);
  assert.equal(report.uniqueTransactionsEvaluated, 3);
  assert.equal(report.imagesEvaluated, 3);
  assert.equal(report.modelRequestsAttempted, 3);
  assert.equal(report.modelRequestsCompleted, 3);
  assert.equal(report.modelRequestFailures, 0);
  assert.deepEqual(report.requiredEvidenceCategoryFrequency, {
    explicit_visual_evidence: 1,
    manual_verification: 6,
    provider_metadata: 1
  });
  assert.deepEqual(report.boundedTokenUsage, {
    inputTokens: 30,
    outputTokens: 6,
    totalTokens: 36,
    modelRequests: 3,
    inputImages: 3
  });
  assert.equal(report.nonPersistent, true);
  assert.equal(report.writesProductionStore, false);
  assert.equal(report.productionImpact, 'none');
  assert.equal(report.decisionImpact, 'none');
  assert.equal(report.executionAuthority, 'none');
  assert.equal(serialized.includes('sample-secret-id'), false);
  assert.equal(serialized.includes('https://'), false);
  assert.equal(serialized.includes('sk-test-secret-not-printed'), false);
  assert.equal(serialized.includes('tca_test_secret_not_printed'), false);
});

test('sample module imports no runtime, persistence, notification, scanner, purchase, or server code', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'validation', 'multimodalFeasibilitySample.js'), 'utf8');
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
