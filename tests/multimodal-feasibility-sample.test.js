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
  EVIDENCE_ACQUISITION_SOURCES,
  buildEvidenceAcquisitionPlanForReport,
  runOpenAIMultimodalFeasibilitySample,
  validateOpenAIFeasibilitySampleGates
} = require('../validation/multimodalFeasibilitySample');
const {
  ELIGIBILITY_CLASSIFICATIONS
} = require('../validation/titleProviderCandidateAdmissionEligibilityReview');

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

async function withMockedAdmissionEligibilityReview(mockReview, fn) {
  const samplePath = require.resolve('../validation/multimodalFeasibilitySample');
  const reviewPath = require.resolve('../validation/titleProviderCandidateAdmissionEligibilityReview');
  const reviewModule = require(reviewPath);
  const original = reviewModule.reviewTitleProviderCandidateAdmissionEligibility;
  reviewModule.reviewTitleProviderCandidateAdmissionEligibility = mockReview;
  delete require.cache[samplePath];

  try {
    return await fn(require(samplePath));
  } finally {
    reviewModule.reviewTitleProviderCandidateAdmissionEligibility = original;
    delete require.cache[samplePath];
  }
}

async function withMockedShadowAdmissionSimulation(mockSimulation, fn) {
  const samplePath = require.resolve('../validation/multimodalFeasibilitySample');
  const shadowPath = require.resolve('../validation/titleProviderShadowAdmissionSimulation');
  const shadowModule = require(shadowPath);
  const original = shadowModule.simulateTitleProviderShadowAdmission;
  shadowModule.simulateTitleProviderShadowAdmission = mockSimulation;
  delete require.cache[samplePath];

  try {
    return await fn(require(samplePath));
  } finally {
    shadowModule.simulateTitleProviderShadowAdmission = original;
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
  assert.deepEqual(disabled.report.evidenceAcquisitionPlanByField, {});
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
  assert.equal(report.candidateFields.includes('cardNumber'), true);
  assert.equal(report.candidateFields.includes('parallel'), true);
  assert.equal(report.candidateCountByField.cardNumber, 3);
  assert.deepEqual(report.candidateProvenanceCategoriesByField.cardNumber, [
    'explicit_title_evidence'
  ]);
  assert.equal(report.candidateReasonCodesByField.cardNumber.includes('candidate_only_not_admitted'), true);
  assert.deepEqual(report.candidateConflictFields, []);
  assert.equal(report.titleOrMetadataCouldMateriallyHelp, true);
  assert.equal(report.futureDeterministicAdmissionCouldMateriallyHelp, true);
  assert.equal(report.transactionsWithFutureAdmissionEligibleCandidates, 3);
  assert.equal(report.eligibleCandidateFields.includes('cardNumber'), true);
  assert.equal(report.eligibleCandidateCountByField.cardNumber, 3);
  assert.equal(
    report.admissionEligibilityClassificationFrequency[
      ELIGIBILITY_CLASSIFICATIONS.ELIGIBLE_FOR_FUTURE_DETERMINISTIC_ADMISSION
    ] >= 3,
    true
  );
  assert.equal(report.eligibilityAggregateConsistencyStatus, 'consistent');
  assert.deepEqual(report.eligibilityAggregateConsistencyReasonCodes, ['aggregate_consistency_ok']);
  assert.equal(report.shadowSimulationTransactionCount, 3);
  assert.equal(report.shadowCandidatesConsidered >= 3, true);
  assert.equal(
    report.shadowCandidatesConsidered,
    report.shadowCandidatesApplied + report.shadowCandidatesExcluded
  );
  assert.equal(report.shadowSimulationConsistencyStatus, 'consistent');
  assert.deepEqual(report.shadowSimulationConsistencyReasonCodes, ['shadow_consistency_ok']);
  assert.equal(report.shadowOnly, true);
  assert.equal(report.admittedToProduction, false);
  assert.equal(Object.hasOwn(report, 'configuredModel'), false);
  assert.deepEqual(report.unresolvedAdmissionConflictFields, []);
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
  assert.equal(serialized.includes(DEFAULT_OPENAI_MODEL), false);
  assert.equal(serialized.includes('Sample Secret Player'), false);
  assert.equal(serialized.includes('sample-secret-id'), false);
  assert.equal(serialized.includes('https://'), false);
  assert.equal(serialized.includes('sk-test-secret-not-printed'), false);
  assert.equal(serialized.includes('tca_test_secret_not_printed'), false);
  assert.equal(serialized.includes('output_text'), false);
});

test('A5.14 aggregate eligibility diagnostics fail closed for provisional sale candidates', async () => {
  const reports = [
    aggregateOnlyReport(),
    aggregateOnlyReport()
  ];
  const result = await withMockedSampleAnalysis(reports, async (sample) => sample.runOpenAIMultimodalFeasibilitySample({
    env: sampleEnv(),
    fetchImpl: async (url) => {
      if (String(url).includes('thecardapi.com')) {
        return jsonResponse({
          sales: [
            sampleSale(1, { price_confirmed: false }),
            sampleSale(2, { price_confirmed: 'true' })
          ]
        });
      }
      throw new Error('unexpected_openai_request');
    }
  }));
  const report = result.report;
  const serialized = JSON.stringify(report);

  assert.deepEqual(report.eligibleCandidateFields, []);
  assert.deepEqual(report.eligibleCandidateCountByField, {});
  assert.equal(report.transactionsWithFutureAdmissionEligibleCandidates, 0);
  assert.equal(report.futureDeterministicAdmissionCouldMateriallyHelp, false);
  assert.equal(report.ineligibleCandidateFields.includes('cardNumber'), true);
  assert.equal(report.ineligibleCandidateFields.includes('parallel'), true);
  assert.equal(report.ineligibleCandidateCountByField.cardNumber > 0, true);
  assert.deepEqual(report.manualReviewReasonCodesByField, {});
  assert.equal(
    report.admissionEligibilityClassificationFrequency[
      ELIGIBILITY_CLASSIFICATIONS.INELIGIBLE_PROVISIONAL_SALE
    ] > 0,
    true
  );
  assert.equal(
    report.ineligibilityReasonCodesByField.cardNumber.includes('provisional_sale_not_canonical_ready'),
    true
  );
  assert.equal(report.canonicalSoldEvidenceStructurallyReadyCount, 0);
  assert.equal(report.shadowCanonicalSoldEvidenceWouldBeStructurallyReadyCount, 0);
  assert.equal(report.shadowCandidatesApplied, 0);
  assert.equal(report.shadowSimulationConsistencyStatus, 'consistent');
  assert.equal(report.eligibilityAggregateConsistencyStatus, 'consistent');
  assert.deepEqual(report.eligibilityAggregateConsistencyReasonCodes, ['aggregate_consistency_ok']);
  assert.equal(Object.hasOwn(report, 'configuredModel'), false);
  assert.equal(serialized.includes('Sample Secret Player'), false);
  assert.equal(serialized.includes('sample-secret-id'), false);
  assert.equal(serialized.includes('https://'), false);
  assert.equal(report.productionImpact, 'none');
  assert.equal(report.decisionImpact, 'none');
  assert.equal(report.executionAuthority, 'none');
});

test('A5.14 aggregate eligibility preserves unresolved conflicts and manual-review classifications', async () => {
  const reports = [
    aggregateOnlyReport(),
    aggregateOnlyReport()
  ];
  const result = await withMockedSampleAnalysis(reports, async (sample) => sample.runOpenAIMultimodalFeasibilitySample({
    env: sampleEnv(),
    fetchImpl: async (url) => {
      if (String(url).includes('thecardapi.com')) {
        return jsonResponse({
          sales: [
            sampleSale(1, {
              title: '2024 Topps Chrome Shohei Ohtani #17 Gold Auto /99 PSA 10',
              player: 'Shohei Ohtani',
              card_number: '99',
              parallel: 'Blue',
              print_run: 99
            }),
            sampleSale(2, {
              title: '2024 Topps Chrome Shohei Ohtani #22 Auto /99 PSA 10',
              player: 'Shohei Ohtani',
              card_number: '22',
              print_run: 99
            })
          ]
        });
      }
      throw new Error('unexpected_openai_request');
    }
  }));
  const report = result.report;
  const serialized = JSON.stringify(report);

  assert.equal(report.unresolvedAdmissionConflictFields.includes('cardNumber'), true);
  assert.equal(report.unresolvedAdmissionConflictFields.includes('parallel'), true);
  assert.equal(report.manualReviewCandidateFields.includes('rawOrGraded'), true);
  assert.equal(report.manualReviewReasonCodesByField.rawOrGraded.includes('manual_review_required'), true);
  assert.equal(Object.hasOwn(report.ineligibilityReasonCodesByField, 'rawOrGraded'), false);
  assert.equal(
    report.admissionEligibilityClassificationFrequency[
      ELIGIBILITY_CLASSIFICATIONS.INELIGIBLE_CONFLICT_UNRESOLVED
    ] > 0,
    true
  );
  assert.equal(
    report.admissionEligibilityClassificationFrequency[
      ELIGIBILITY_CLASSIFICATIONS.MANUAL_REVIEW_REQUIRED
    ] > 0,
    true
  );
  assert.equal(report.ineligibilityReasonCodesByField.cardNumber.includes('unresolved_candidate_conflict'), true);
  assert.equal(serialized.includes('Shohei'), false);
  assert.equal(serialized.includes('Ohtani'), false);
  assert.equal(serialized.includes('Gold'), false);
  assert.equal(serialized.includes('sample-secret-id'), false);
  assert.equal(serialized.includes('https://'), false);
  assert.equal(report.nonPersistent, true);
  assert.equal(report.writesProductionStore, false);
  assert.equal(report.productionImpact, 'none');
  assert.equal(report.decisionImpact, 'none');
  assert.equal(report.executionAuthority, 'none');
});

test('A5.14A aggregate eligibility counts reconcile for the observed 23-candidate scenario', async () => {
  const reports = [
    aggregateOnlyReport(),
    aggregateOnlyReport(),
    aggregateOnlyReport()
  ];
  const result = await withMockedSampleAnalysis(reports, async (sample) => sample.runOpenAIMultimodalFeasibilitySample({
    env: sampleEnv(),
    fetchImpl: async (url) => {
      if (String(url).includes('thecardapi.com')) {
        return jsonResponse({
          sales: [
            sampleSale(1, {
              title: '/99 PSA 10',
              print_run: 99,
              grader: 'PSA',
              grade: '10'
            }),
            sampleSale(2, {
              title: '#33 PSA 10',
              card_number: '33',
              grader: 'PSA',
              grade: '10'
            }),
            sampleSale(3, {
              title: 'Topps /99',
              print_run: 99
            })
          ]
        });
      }
      throw new Error('unexpected_openai_request');
    }
  }));
  const report = result.report;
  const candidateTotal = Object.values(report.candidateCountByField).reduce((sum, count) => sum + count, 0);
  const eligibleTotal = Object.values(report.eligibleCandidateCountByField).reduce((sum, count) => sum + count, 0);
  const manualTotal = Object.values(report.manualReviewCandidateCountByField).reduce((sum, count) => sum + count, 0);
  const ineligibleTotal = Object.values(report.ineligibleCandidateCountByField).reduce((sum, count) => sum + count, 0);
  const classificationTotal = Object.values(report.admissionEligibilityClassificationFrequency).reduce((sum, count) => sum + count, 0);
  const serialized = JSON.stringify(report);

  assert.equal(candidateTotal, 23);
  assert.equal(eligibleTotal, 17);
  assert.equal(manualTotal, 6);
  assert.equal(ineligibleTotal, 0);
  assert.equal(classificationTotal, 23);
  assert.deepEqual(report.admissionEligibilityClassificationFrequency, {
    [ELIGIBILITY_CLASSIFICATIONS.ELIGIBLE_FOR_FUTURE_DETERMINISTIC_ADMISSION]: 17,
    [ELIGIBILITY_CLASSIFICATIONS.MANUAL_REVIEW_REQUIRED]: 6
  });
  assert.deepEqual(report.manualReviewCandidateCountByField, {
    rawOrGraded: 4,
    serialNumbered: 2
  });
  assert.deepEqual(report.ineligibleCandidateFields, []);
  assert.deepEqual(report.ineligibleCandidateCountByField, {});
  assert.deepEqual(report.ineligibilityReasonCodesByField, {});
  assert.equal(report.manualReviewReasonCodesByField.rawOrGraded.includes('manual_review_required'), true);
  assert.equal(report.manualReviewReasonCodesByField.serialNumbered.includes('manual_review_required'), true);
  assert.equal(report.eligibilityReviewedCandidateCount, 23);
  assert.equal(report.eligibilityAggregateConsistencyStatus, 'consistent');
  assert.deepEqual(report.eligibilityAggregateConsistencyReasonCodes, ['aggregate_consistency_ok']);
  assert.equal(report.shadowSimulationTransactionCount, 3);
  assert.equal(report.shadowCandidatesConsidered, 23);
  assert.equal(report.shadowCandidatesApplied + report.shadowCandidatesExcluded, 23);
  assert.equal(report.shadowCandidatesApplied <= 17, true);
  assert.equal(report.shadowSimulationConsistencyStatus, 'consistent');
  assert.equal(Object.hasOwn(report, 'configuredModel'), false);
  assert.equal(serialized.includes(DEFAULT_OPENAI_MODEL), false);
  assert.equal(serialized.includes('sample-secret-id'), false);
  assert.equal(serialized.includes('https://'), false);
  assert.equal(report.nonPersistent, true);
  assert.equal(report.writesProductionStore, false);
  assert.equal(report.productionImpact, 'none');
  assert.equal(report.decisionImpact, 'none');
  assert.equal(report.executionAuthority, 'none');
});

test('A5.14A aggregate eligibility fails closed instead of publishing contradictory totals', async () => {
  const reports = [aggregateOnlyReport()];
  const result = await withMockedAdmissionEligibilityReview(() => ({
    diagnostics: {
      admissionEligibilityClassificationFrequency: {
        [ELIGIBILITY_CLASSIFICATIONS.ELIGIBLE_FOR_FUTURE_DETERMINISTIC_ADMISSION]: 30
      },
      eligibleCandidateFields: ['cardNumber'],
      eligibleCandidateCountByField: { cardNumber: 30 },
      ineligibleCandidateFields: [],
      ineligibleCandidateCountByField: {},
      ineligibilityReasonCodesByField: {},
      unresolvedAdmissionConflictFields: [],
      manualReviewCandidateFields: [],
      manualReviewCandidateCountByField: {},
      manualReviewReasonCodesByField: {},
      transactionsWithFutureAdmissionEligibleCandidates: 1,
      futureDeterministicAdmissionCouldMateriallyHelp: true
    }
  }), async (sample) => withMockedSampleAnalysis(reports, async () => sample.runOpenAIMultimodalFeasibilitySample({
    env: sampleEnv(),
    fetchImpl: async (url) => {
      if (String(url).includes('thecardapi.com')) {
        return jsonResponse({
          sales: [
            sampleSale(1, {
              title: '#33',
              card_number: '33'
            })
          ]
        });
      }
      throw new Error('unexpected_openai_request');
    }
  })));
  const report = result.report;
  const serialized = JSON.stringify(report);

  assert.equal(report.eligibilityAggregateConsistencyStatus, 'invalid');
  assert.equal(report.eligibilityAggregateConsistencyReasonCodes.includes('eligibility_classification_count_mismatch'), true);
  assert.equal(report.transactionsWithFutureAdmissionEligibleCandidates, 0);
  assert.equal(report.futureDeterministicAdmissionCouldMateriallyHelp, false);
  assert.equal(report.shadowCandidatesApplied, 0);
  assert.equal(report.shadowSimulationConsistencyStatus, 'invalid');
  assert.equal(Object.hasOwn(report, 'configuredModel'), false);
  assert.equal(serialized.includes(DEFAULT_OPENAI_MODEL), false);
  assert.equal(report.productionImpact, 'none');
  assert.equal(report.decisionImpact, 'none');
  assert.equal(report.executionAuthority, 'none');
});

test('A5.15 shadow admission simulates eligible candidate impact without changing actual counts', async () => {
  const reports = [
    aggregateOnlyReport({
      missingMaterialFieldsBefore: ['cardNumber'],
      missingMaterialFieldsAfter: ['cardNumber'],
      requiredEvidenceCategoriesByField: { cardNumber: ['explicit_title_evidence'] }
    })
  ];
  const rawSale = sampleSale(1, {
    title: '2024 Topps Chrome Shohei Ohtani Gold Auto Patch /99 PSA 10',
    card_number: '33',
    price_confirmed: true
  });
  const rawSaleBefore = JSON.stringify(rawSale);
  const result = await withMockedSampleAnalysis(reports, async (sample) => sample.runOpenAIMultimodalFeasibilitySample({
    env: sampleEnv(),
    fetchImpl: async (url) => {
      if (String(url).includes('thecardapi.com')) {
        return jsonResponse({
          sales: [rawSale]
        });
      }
      throw new Error('unexpected_openai_request');
    }
  }));
  const report = result.report;
  const serialized = JSON.stringify(report);

  assert.equal(report.exactReachedCount, 0);
  assert.equal(report.canonicalSoldEvidenceStructurallyReadyCount, 0);
  assert.equal(report.shadowSimulationTransactionCount, 1);
  assert.equal(report.shadowCandidatesConsidered >= 2, true);
  assert.equal(report.shadowCandidatesConsidered, report.shadowCandidatesApplied + report.shadowCandidatesExcluded);
  assert.equal(report.shadowCandidatesApplied, 0);
  assert.equal(report.shadowCandidatesExcluded >= 0, true);
  assert.equal(report.shadowAppliedFields.includes('cardNumber'), false);
  assert.deepEqual(report.shadowMissingFieldFrequencyBefore, {});
  assert.deepEqual(report.shadowMissingFieldFrequencyAfter, report.shadowMissingFieldFrequencyBefore);
  assert.deepEqual(report.shadowRecoveredFieldFrequency, {});
  assert.equal(report.shadowClassificationImprovementCount >= 0, true);
  assert.equal(report.shadowExactWouldBeReachedCount, 0);
  assert.equal(report.shadowCanonicalSoldEvidenceWouldBeStructurallyReadyCount, 0);
  assert.equal(report.shadowTransactionsStillRequiringAdditionalEvidence, 0);
  assert.equal(report.shadowSimulationConsistencyStatus, 'consistent');
  assert.deepEqual(report.shadowSimulationConsistencyReasonCodes, ['shadow_consistency_ok']);
  assert.equal(report.shadowOnly, true);
  assert.equal(report.admittedToProduction, false);
  assert.equal(serialized.includes('Shohei'), false);
  assert.equal(serialized.includes('Ohtani'), false);
  assert.equal(serialized.includes('sample-secret-id'), false);
  assert.equal(serialized.includes('https://'), false);
  assert.equal(report.productionImpact, 'none');
  assert.equal(report.decisionImpact, 'none');
  assert.equal(report.executionAuthority, 'none');
  assert.equal(JSON.stringify(rawSale), rawSaleBefore);
});

test('A5.15A aggregate report preserves zero-applied baseline parity for the live 36-candidate shape', async () => {
  const reports = [
    aggregateOnlyReport(),
    aggregateOnlyReport(),
    aggregateOnlyReport()
  ];
  const baselineFrequency = {
    manufacturer: 1,
    rawOrGraded: 2,
    serialNumbered: 2,
    subjectName: 3
  };
  const shadowDiagnostics = {
    shadowSimulationTransactionCount: 1,
    shadowCandidatesConsidered: 12,
    shadowCandidatesApplied: 0,
    shadowCandidatesExcluded: 12,
    shadowCandidateExclusionReasonCounts: { title_candidate_channel_unavailable: 12 },
    shadowAppliedFields: [],
    shadowConflictFields: [],
    shadowMissingFieldFrequencyBefore: baselineFrequency,
    shadowMissingFieldFrequencyAfter: baselineFrequency,
    shadowRecoveredFieldFrequency: {},
    shadowClassificationCountsBefore: { AMBIGUOUS: 1 },
    shadowClassificationCountsAfter: { AMBIGUOUS: 1 },
    shadowClassificationImprovementCount: 0,
    shadowExactWouldBeReachedCount: 0,
    shadowCanonicalSoldEvidenceWouldBeStructurallyReadyCount: 0,
    shadowTransactionsStillRequiringAdditionalEvidence: 1,
    shadowSimulationConsistencyStatus: 'consistent',
    shadowSimulationConsistencyReasonCodes: ['shadow_consistency_ok'],
    shadowOnly: true,
    admittedToProduction: false
  };
  const result = await withMockedShadowAdmissionSimulation(() => ({
    diagnostics: shadowDiagnostics
  }), async () => withMockedSampleAnalysis(reports, async (sample) => sample.runOpenAIMultimodalFeasibilitySample({
    env: sampleEnv(),
    fetchImpl: async (url) => {
      if (String(url).includes('thecardapi.com')) {
        return jsonResponse({
          sales: [
            sampleSale(1),
            sampleSale(2),
            sampleSale(3)
          ]
        });
      }
      throw new Error('unexpected_openai_request');
    }
  })));
  const report = result.report;

  assert.equal(report.shadowCandidatesConsidered, 36);
  assert.equal(report.shadowCandidatesApplied, 0);
  assert.equal(report.shadowCandidatesExcluded, 36);
  assert.deepEqual(report.shadowMissingFieldFrequencyBefore, {
    manufacturer: 3,
    rawOrGraded: 6,
    serialNumbered: 6,
    subjectName: 9
  });
  assert.deepEqual(report.shadowMissingFieldFrequencyAfter, report.shadowMissingFieldFrequencyBefore);
  assert.deepEqual(report.shadowClassificationCountsBefore, report.shadowClassificationCountsAfter);
  assert.deepEqual(report.shadowRecoveredFieldFrequency, {});
  assert.equal(report.shadowClassificationImprovementCount, 0);
  assert.equal(report.shadowExactWouldBeReachedCount, 0);
  assert.equal(report.shadowCanonicalSoldEvidenceWouldBeStructurallyReadyCount, 0);
  assert.deepEqual(report.shadowConflictFields, []);
  assert.equal(report.shadowSimulationConsistencyStatus, 'consistent');
  assert.deepEqual(report.shadowSimulationConsistencyReasonCodes, ['shadow_consistency_ok']);
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

test('A5.11 builds deterministic evidence acquisition plans from sanitized blocker diagnostics', () => {
  const plan = buildEvidenceAcquisitionPlanForReport(aggregateOnlyReport({
    missingMaterialFieldsAfter: ['sport', 'autographState', 'cardNumber'],
    conflictFields: ['setName'],
    blockerClassificationByField: {
      sport: FEASIBILITY_CLASSIFICATIONS.EXPLICIT_TEXT_OR_PROVIDER_METADATA_REQUIRED,
      autographState: FEASIBILITY_CLASSIFICATIONS.ABSENCE_SENSITIVE_NOT_PROVABLE_FROM_NONAPPEARANCE,
      cardNumber: FEASIBILITY_CLASSIFICATIONS.EXPLICIT_VISUAL_EVIDENCE_POSSIBLE,
      setName: FEASIBILITY_CLASSIFICATIONS.CONFLICT_REQUIRES_RESOLUTION
    },
    requiredEvidenceCategoriesByField: {
      sport: ['explicit_visual_evidence', 'provider_metadata', 'explicit_title_evidence', 'manual_verification'],
      autographState: ['explicit_visual_evidence', 'provider_metadata', 'manual_verification'],
      cardNumber: ['image_ocr', 'explicit_visual_evidence', 'manual_verification'],
      setName: ['manual_verification']
    }
  }));

  assert.deepEqual(Object.keys(plan), ['autographState', 'cardNumber', 'setName', 'sport']);
  assert.deepEqual(plan.sport.nextEvidenceSources, ['provider_metadata', 'explicit_title_evidence', 'manual_verification']);
  assert.equal(plan.sport.nextEvidenceSources.includes('additional_image_or_view'), false);
  assert.equal(plan.sport.reasonCodes.includes('non_visual_field_not_routed_to_multimodal_vision'), true);
  assert.deepEqual(plan.setName.nextEvidenceSources, ['manual_verification']);
  assert.equal(plan.setName.reasonCodes.includes('conflict_requires_deterministic_resolution'), true);
  assert.equal(plan.setName.reasonCodes.includes('model_confidence_cannot_resolve_conflict'), true);
  assert.equal(plan.setName.reasonCodes.includes('no_automated_resolution_path'), true);
  assert.equal(plan.autographState.reasonCodes.includes('absence_sensitive_requires_explicit_evidence'), true);
  assert.equal(plan.autographState.reasonCodes.includes('nonappearance_is_not_resolution_evidence'), true);
  assert.equal(plan.cardNumber.nextEvidenceSources.includes('additional_image_or_view'), true);
  assert.equal(plan.cardNumber.nextEvidenceSources.includes('image_ocr'), true);
  assert.equal(JSON.stringify(plan).includes('Sample Secret Player'), false);
  assert.equal(JSON.stringify(plan).includes('https://'), false);
});

test('A5.11 aggregate plan reports source frequencies, manual verification, no automated path, and image help', async () => {
  const reports = [
    aggregateOnlyReport({
      missingMaterialFieldsAfter: ['sport', 'autographState', 'cardNumber'],
      blockerClassificationByField: {
        sport: FEASIBILITY_CLASSIFICATIONS.EXPLICIT_TEXT_OR_PROVIDER_METADATA_REQUIRED,
        autographState: FEASIBILITY_CLASSIFICATIONS.ABSENCE_SENSITIVE_NOT_PROVABLE_FROM_NONAPPEARANCE,
        cardNumber: FEASIBILITY_CLASSIFICATIONS.EXPLICIT_VISUAL_EVIDENCE_POSSIBLE
      },
      requiredEvidenceCategoriesByField: {
        sport: ['provider_metadata', 'explicit_title_evidence', 'manual_verification', 'explicit_visual_evidence'],
        autographState: ['additional_image_or_view', 'manual_verification'],
        cardNumber: ['image_ocr', 'additional_image_or_view', 'manual_verification']
      }
    }),
    aggregateOnlyReport({
      missingMaterialFieldsAfter: [],
      conflictFields: ['setName'],
      blockerClassificationByField: {
        setName: FEASIBILITY_CLASSIFICATIONS.CONFLICT_REQUIRES_RESOLUTION
      },
      requiredEvidenceCategoriesByField: {
        setName: ['manual_verification']
      }
    }),
    aggregateOnlyReport({
      missingMaterialFieldsAfter: ['serialNumbered'],
      blockerClassificationByField: {
        serialNumbered: FEASIBILITY_CLASSIFICATIONS.ABSENCE_SENSITIVE_NOT_PROVABLE_FROM_NONAPPEARANCE,
        leakedField: 'MALFORMED_CLASSIFICATION'
      },
      requiredEvidenceCategoriesByField: {
        serialNumbered: ['image_ocr', 'provider_metadata', 'manual_verification', 'raw_provider_payload'],
        leakedField: ['raw_provider_payload']
      }
    })
  ];

  const result = await withMockedSampleAnalysis(reports, async (sample) => sample.runOpenAIMultimodalFeasibilitySample({
    env: sampleEnv(),
    fetchImpl: async (url) => {
      if (String(url).includes('thecardapi.com')) {
        return jsonResponse({ sales: [sampleSale(1), sampleSale(2), sampleSale(3)] });
      }
      throw new Error('unexpected_openai_request');
    }
  }));
  const report = result.report;
  const serialized = JSON.stringify(report);

  assert.deepEqual(Object.keys(report.fieldsRequiringEvidenceSource), [
    'provider_metadata',
    'explicit_title_evidence',
    'additional_image_or_view',
    'image_ocr',
    'manual_verification'
  ]);
  assert.deepEqual(report.fieldsRequiringEvidenceSource.provider_metadata, ['serialNumbered', 'sport']);
  assert.deepEqual(report.fieldsRequiringEvidenceSource.explicit_title_evidence, ['sport']);
  assert.deepEqual(report.fieldsRequiringEvidenceSource.additional_image_or_view, ['autographState', 'cardNumber']);
  assert.deepEqual(report.fieldsRequiringEvidenceSource.image_ocr, ['cardNumber', 'serialNumbered']);
  assert.deepEqual(report.fieldsRequiringEvidenceSource.manual_verification, ['autographState', 'cardNumber', 'serialNumbered', 'setName', 'sport']);
  assert.deepEqual(report.evidenceAcquisitionPlanByField, {
    autographState: ['additional_image_or_view', 'manual_verification'],
    cardNumber: ['additional_image_or_view', 'image_ocr', 'manual_verification'],
    serialNumbered: ['provider_metadata', 'image_ocr', 'manual_verification'],
    setName: ['manual_verification'],
    sport: ['provider_metadata', 'explicit_title_evidence', 'manual_verification']
  });
  assert.deepEqual(report.transactionCountsRequiringEvidenceSource, {
    provider_metadata: 2,
    explicit_title_evidence: 1,
    additional_image_or_view: 1,
    image_ocr: 2,
    manual_verification: 3
  });
  assert.deepEqual(report.fieldsWithNoAutomatedResolutionPath, ['setName']);
  assert.equal(report.manualVerificationFrequency, 5);
  assert.equal(report.anotherImageCouldMateriallyHelp, true);
  assert.equal(serialized.includes('raw_provider_payload'), false);
  assert.equal(serialized.includes('leakedField'), false);
  assert.equal(serialized.includes('sample-secret-id'), false);
  assert.equal(serialized.includes('https://'), false);
  assert.equal(report.productionImpact, 'none');
  assert.equal(report.decisionImpact, 'none');
  assert.equal(report.executionAuthority, 'none');
});

test('A5.11A no-automated-resolution fields are derived from the final merged acquisition plan', async () => {
  const reports = [
    aggregateOnlyReport({
      missingMaterialFieldsAfter: [],
      conflictFields: ['parallel', 'serialNumbered', 'subjectName', 'setName'],
      blockerClassificationByField: {
        parallel: FEASIBILITY_CLASSIFICATIONS.CONFLICT_REQUIRES_RESOLUTION,
        serialNumbered: FEASIBILITY_CLASSIFICATIONS.CONFLICT_REQUIRES_RESOLUTION,
        subjectName: FEASIBILITY_CLASSIFICATIONS.CONFLICT_REQUIRES_RESOLUTION,
        setName: FEASIBILITY_CLASSIFICATIONS.CONFLICT_REQUIRES_RESOLUTION
      },
      requiredEvidenceCategoriesByField: {
        parallel: ['manual_verification'],
        serialNumbered: ['manual_verification'],
        subjectName: ['manual_verification'],
        setName: ['manual_verification']
      }
    }),
    aggregateOnlyReport({
      missingMaterialFieldsAfter: ['parallel', 'serialNumbered', 'subjectName'],
      blockerClassificationByField: {
        parallel: FEASIBILITY_CLASSIFICATIONS.EXPLICIT_VISUAL_EVIDENCE_POSSIBLE,
        serialNumbered: FEASIBILITY_CLASSIFICATIONS.ABSENCE_SENSITIVE_NOT_PROVABLE_FROM_NONAPPEARANCE,
        subjectName: FEASIBILITY_CLASSIFICATIONS.EXPLICIT_TEXT_OR_PROVIDER_METADATA_REQUIRED
      },
      requiredEvidenceCategoriesByField: {
        parallel: ['additional_image_or_view', 'manual_verification'],
        serialNumbered: ['provider_metadata', 'image_ocr', 'manual_verification'],
        subjectName: ['provider_metadata', 'explicit_title_evidence', 'manual_verification']
      }
    })
  ];

  const result = await withMockedSampleAnalysis(reports, async (sample) => sample.runOpenAIMultimodalFeasibilitySample({
    env: sampleEnv(),
    fetchImpl: async (url) => {
      if (String(url).includes('thecardapi.com')) {
        return jsonResponse({ sales: [sampleSale(1), sampleSale(2)] });
      }
      throw new Error('unexpected_openai_request');
    }
  }));
  const report = result.report;
  const serialized = JSON.stringify(report);

  assert.deepEqual(report.evidenceAcquisitionPlanByField.parallel, ['additional_image_or_view', 'manual_verification']);
  assert.deepEqual(report.evidenceAcquisitionPlanByField.serialNumbered, ['provider_metadata', 'image_ocr', 'manual_verification']);
  assert.deepEqual(report.evidenceAcquisitionPlanByField.subjectName, ['provider_metadata', 'explicit_title_evidence', 'manual_verification']);
  assert.deepEqual(report.evidenceAcquisitionPlanByField.setName, ['manual_verification']);
  assert.deepEqual(report.fieldsWithNoAutomatedResolutionPath, ['setName']);
  assert.equal(report.fieldsWithNoAutomatedResolutionPath.includes('parallel'), false);
  assert.equal(report.fieldsWithNoAutomatedResolutionPath.includes('serialNumbered'), false);
  assert.equal(report.fieldsWithNoAutomatedResolutionPath.includes('subjectName'), false);
  assert.equal(serialized.includes('sample-secret-id'), false);
  assert.equal(serialized.includes('https://'), false);
  assert.equal(report.nonPersistent, true);
  assert.equal(report.productionImpact, 'none');
  assert.equal(report.decisionImpact, 'none');
  assert.equal(report.executionAuthority, 'none');
});

test('A5.11 planner handles empty and malformed inputs without inventing evidence paths', () => {
  assert.deepEqual(buildEvidenceAcquisitionPlanForReport({}), {});
  const plan = buildEvidenceAcquisitionPlanForReport({
    missingMaterialFieldsAfter: ['unknownField', 'sport'],
    conflictFields: ['badConflict'],
    blockerClassificationByField: {
      sport: 'MALFORMED_CLASSIFICATION'
    },
    requiredEvidenceCategoriesByField: {
      sport: ['raw_provider_payload']
    }
  });

  assert.deepEqual(Object.keys(plan), ['sport']);
  assert.deepEqual(plan.sport.nextEvidenceSources, ['provider_metadata', 'explicit_title_evidence', 'manual_verification']);
  assert.equal(plan.sport.blockerClassification, FEASIBILITY_CLASSIFICATIONS.UNKNOWN_RESOLUTION_PATH);
  assert.equal(plan.sport.reasonCodes.includes('non_visual_field_not_routed_to_multimodal_vision'), true);
  assert.deepEqual(EVIDENCE_ACQUISITION_SOURCES, [
    'provider_metadata',
    'explicit_title_evidence',
    'additional_image_or_view',
    'slab_label',
    'image_ocr',
    'manual_verification'
  ]);
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
