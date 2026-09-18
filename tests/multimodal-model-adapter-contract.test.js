'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  DEFAULT_REQUESTED_FIELDS,
  EVIDENCE_TYPES,
  EXECUTION_STATUS,
  EXPLICIT_OR_INFERRED,
  buildMultimodalModelPromptContract,
  createFixtureMultimodalModelAdapter,
  createMultimodalModelRequest,
  evaluateRealProviderFeasibility,
  runFixtureMultimodalImagePilot,
  validateMultimodalModelRequest,
  validateMultimodalModelResponse
} = require('../validation/multimodalModelAdapterContract');

function transaction(overrides = {}) {
  return {
    id: 'provider-id-not-output',
    platform: 'eBay',
    listing_type: 'fixed_price',
    title: '2024 Topps Chrome',
    sold_at: '2026-09-17T00:00:00Z',
    sale_date: '2026-09-17',
    price: 10,
    currency: 'USD',
    price_confirmed: true,
    listing_url: 'https://www.ebay.com/itm/provider-id-not-output',
    image_url: 'https://images.example.test/provider-id-not-output.jpg',
    shipping_price: 0,
    category: 'sports',
    ...overrides
  };
}

function request(overrides = {}) {
  return createMultimodalModelRequest({
    requestId: 'req-1',
    titleContext: '2024 Topps Chrome',
    imageReference: 'in-memory-image-reference',
    requestedFields: DEFAULT_REQUESTED_FIELDS,
    modelConfig: { maxRequests: 1, maxImages: 1 },
    ...overrides
  });
}

function modelObservation(field, proposedValue, overrides = {}) {
  return {
    field,
    proposedValue,
    confidence: 0.96,
    evidenceType: EVIDENCE_TYPES.EXPLICIT_VISUAL,
    modality: 'image_ocr',
    explicitOrInferred: EXPLICIT_OR_INFERRED.EXPLICIT,
    deterministicVerificationPossible: true,
    ambiguity: [],
    warnings: [],
    ...overrides
  };
}

test('exports provider-neutral request contract with non-persistence and one-image bounds', () => {
  const built = request();
  const validation = validateMultimodalModelRequest(built);

  assert.equal(validation.valid, true);
  assert.equal(built.modelConfig.maxRequests, 1);
  assert.equal(built.modelConfig.maxImages, 1);
  assert.equal(built.nonPersistence.persistImageUrl, false);
  assert.equal(built.nonPersistence.persistRawModelResponse, false);
  assert.equal(built.productionImpact, 'none');
  assert.equal(typeof built.requestFingerprint, 'string');
});

test('request validation rejects missing image, unsupported fields, persistence, and bound drift', () => {
  const validation = validateMultimodalModelRequest({
    requestId: 'bad-request',
    requestedFields: ['subjectName', 'unsupportedField'],
    modelConfig: { maxRequests: 2, maxImages: 2 },
    nonPersistence: {
      nonPersistent: false,
      persistImageUrl: true
    }
  });

  assert.equal(validation.valid, false);
  assert.equal(validation.reasonCodes.includes('missing_image_reference'), true);
  assert.equal(validation.reasonCodes.includes('unsupported_requested_fields'), true);
  assert.equal(validation.reasonCodes.includes('request_bound_violation'), true);
  assert.equal(validation.reasonCodes.includes('non_persistence_violation'), true);
});

test('prompt contract instructs unknowns, visual-only evidence, and no absence inference', () => {
  const prompt = buildMultimodalModelPromptContract(request());
  const text = prompt.instructions.join(' ');

  assert.match(text, /Return unknown_not_observable/);
  assert.match(text, /Never infer non-auto/);
  assert.match(text, /Never infer non-memorabilia/);
  assert.match(text, /Never infer unnumbered/);
  assert.match(text, /Separate title\/context claims from image evidence/);
  assert.equal(prompt.productionImpact, 'none');
});

test('strict response schema accepts valid structured observations', () => {
  const req = request();
  const validation = validateMultimodalModelResponse({
    requestId: req.requestId,
    adapterId: 'fixture',
    providerId: 'fixture',
    modelId: 'fixture-model',
    executionStatus: EXECUTION_STATUS.SUCCESS,
    observations: [modelObservation('subjectName', 'Shohei Ohtani')],
    warnings: [],
    errors: [],
    usage: { inputImages: 1, modelRequests: 1 },
    nonPersistent: true,
    writesProductionStore: false,
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  }, req);

  assert.equal(validation.valid, true);
  assert.equal(validation.response.observations.length, 1);
  assert.equal(typeof validation.response.responseFingerprint, 'string');
});

test('strict response schema rejects malformed output and unsupported fields safely', () => {
  const req = request();
  const validation = validateMultimodalModelResponse({
    requestId: 'wrong-request',
    adapterId: 'fixture',
    providerId: 'fixture',
    modelId: 'fixture-model',
    executionStatus: 'made_exact',
    observations: [
      modelObservation('unsupportedField', 'value'),
      modelObservation('subjectName', 'Shohei Ohtani', { confidence: 101 })
    ],
    nonPersistent: false,
    writesProductionStore: true,
    productionImpact: 'runtime',
    decisionImpact: 'changed',
    executionAuthority: 'purchase'
  }, req);

  assert.equal(validation.valid, false);
  assert.equal(validation.reasonCodes.includes('response_request_id_mismatch'), true);
  assert.equal(validation.reasonCodes.includes('unsupported_observation_field'), true);
  assert.equal(validation.reasonCodes.includes('invalid_observation_confidence'), true);
  assert.equal(validation.reasonCodes.includes('authority_boundary_violation'), true);
});

test('fixture adapter valid output feeds A5.5 and can reach exact only through deterministic admission', async () => {
  const req = request();
  const adapter = createFixtureMultimodalModelAdapter({
    responses: {
      [req.requestId]: {
        observations: [
          modelObservation('subjectName', 'Shohei Ohtani'),
          modelObservation('cardNumber', '17'),
          modelObservation('parallel', 'Gold'),
          modelObservation('autographState', true),
          modelObservation('memorabiliaState', true),
          modelObservation('printRun', 99),
          modelObservation('gradeCompany', 'PSA', { modality: 'slab_label' }),
          modelObservation('grade', '10', { modality: 'slab_label' })
        ],
        usage: { modelRequests: 1, inputImages: 1 }
      }
    }
  });

  const result = await runFixtureMultimodalImagePilot({
    request: req,
    adapter,
    transaction: transaction({ title: '2024 Topps Chrome Baseball' })
  });

  assert.equal(result.modelValidation.valid, true);
  assert.equal(result.evidenceResult.postMultimodalClassification, 'EXACT');
  assert.equal(result.evidenceResult.canonicalSoldEvidenceStructurallyReady, true);
  assert.equal(result.report.postMultimodalClassification, 'EXACT');
  assert.equal(result.report.writesProductionStore, false);
});

test('low-confidence observations are preserved by model schema and rejected by A5.5 admission', async () => {
  const req = request();
  const adapter = createFixtureMultimodalModelAdapter({
    responses: {
      [req.requestId]: { observations: [modelObservation('subjectName', 'Shohei Ohtani', { confidence: 0.4 })] }
    }
  });
  const result = await runFixtureMultimodalImagePilot({ request: req, adapter, transaction: transaction() });

  assert.equal(result.modelValidation.valid, true);
  assert.equal(result.evidenceResult.rejectedMultimodalFields[0].reason, 'confidence_below_admission_threshold');
  assert.equal(result.report.observationsRejectedCount, 1);
});

test('inferred observations remain preserved but not admitted', async () => {
  const req = request();
  const adapter = createFixtureMultimodalModelAdapter({
    responses: {
      [req.requestId]: {
        observations: [modelObservation('parallel', 'Gold', {
          evidenceType: EVIDENCE_TYPES.INFERRED_VISUAL,
          explicitOrInferred: EXPLICIT_OR_INFERRED.INFERRED,
          deterministicVerificationPossible: false
        })]
      }
    }
  });
  const result = await runFixtureMultimodalImagePilot({ request: req, adapter, transaction: transaction() });

  assert.equal(result.evidenceResult.rejectedMultimodalFields[0].reason, 'inferred_visual_evidence_requires_review');
});

test('unknown observations remain unknown and rejected without fabrication', async () => {
  const req = request();
  const adapter = createFixtureMultimodalModelAdapter({
    responses: {
      [req.requestId]: {
        observations: [modelObservation('parallel', 'unknown', {
          evidenceType: EVIDENCE_TYPES.UNKNOWN,
          explicitOrInferred: EXPLICIT_OR_INFERRED.UNKNOWN
        })]
      }
    }
  });
  const result = await runFixtureMultimodalImagePilot({ request: req, adapter, transaction: transaction() });

  assert.equal(result.modelValidation.valid, true);
  assert.equal(result.evidenceResult.rejectedMultimodalFields[0].reason, 'unknown_not_observable');
});

test('conflicts remain conflicts and block exact', async () => {
  const req = request();
  const adapter = createFixtureMultimodalModelAdapter({
    responses: {
      [req.requestId]: { observations: [modelObservation('cardNumber', '99')] }
    }
  });
  const result = await runFixtureMultimodalImagePilot({
    request: req,
    adapter,
    transaction: transaction({ title: '2024 Topps Chrome Shohei Ohtani #17 Base' })
  });

  assert.equal(result.evidenceResult.conflicts.length, 1);
  assert.equal(result.evidenceResult.postMultimodalClassification, 'AMBIGUOUS');
  assert.equal(result.report.conflictsCount, 1);
});

test('multi-card ambiguity blocks admission', async () => {
  const req = request();
  const adapter = createFixtureMultimodalModelAdapter({
    responses: {
      [req.requestId]: {
        observations: [modelObservation('subjectName', 'Shohei Ohtani', {
          multipleCardsVisible: true
        })]
      }
    }
  });
  const result = await runFixtureMultimodalImagePilot({ request: req, adapter, transaction: transaction() });

  assert.equal(result.evidenceResult.rejectedMultimodalFields[0].reason, 'multiple_cards_visible');
});

test('absence-as-negative cannot become admissible', async () => {
  const req = request();
  const adapter = createFixtureMultimodalModelAdapter({
    responses: {
      [req.requestId]: { observations: [modelObservation('autographState', false)] }
    }
  });
  const result = await runFixtureMultimodalImagePilot({ request: req, adapter, transaction: transaction() });

  assert.equal(result.evidenceResult.rejectedMultimodalFields[0].reason, 'absence_is_not_negative_evidence');
});

test('provider/model output cannot directly mark a transaction exact', async () => {
  const req = request();
  const adapter = createFixtureMultimodalModelAdapter({
    responses: {
      [req.requestId]: {
        classification: 'EXACT',
        observations: [modelObservation('subjectName', 'Shohei Ohtani')]
      }
    }
  });
  const result = await runFixtureMultimodalImagePilot({ request: req, adapter, transaction: transaction() });

  assert.equal(result.evidenceResult.postMultimodalClassification, 'AMBIGUOUS');
  assert.equal(result.report.postMultimodalClassification, 'AMBIGUOUS');
});

test('sanitized pilot report excludes raw title, image URL, transaction ID, and raw response', async () => {
  const req = request({ titleContext: 'SECRET RAW TITLE SHOULD NOT APPEAR', imageReference: 'https://images.example.test/provider-id-not-output.jpg' });
  const adapter = createFixtureMultimodalModelAdapter({
    responses: {
      [req.requestId]: { observations: [modelObservation('subjectName', 'Shohei Ohtani')] }
    }
  });
  const result = await runFixtureMultimodalImagePilot({ request: req, adapter, transaction: transaction() });
  const serializedReport = JSON.stringify(result.report);

  assert.equal(serializedReport.includes('SECRET RAW TITLE'), false);
  assert.equal(serializedReport.includes('https://images.example.test'), false);
  assert.equal(serializedReport.includes('provider-id-not-output'), false);
  assert.equal(result.report.nonPersistent, true);
  assert.equal(result.report.writesProductionStore, false);
});

test('real provider feasibility reports missing adapter and credentials without inventing pricing', () => {
  const feasibility = evaluateRealProviderFeasibility({});

  assert.equal(feasibility.liveExecutionReady, false);
  assert.equal(feasibility.providerSpecificAdapterAvailable, false);
  assert.equal(feasibility.missingConfiguration.includes('multimodal_provider_api_key'), true);
  assert.equal(feasibility.missingConfiguration.includes('provider_specific_multimodal_adapter'), true);
  assert.equal(feasibility.costMetadataAvailable, false);
});

test('module imports no live provider, networking, persistence, notification, server, or purchase code', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'validation', 'multimodalModelAdapterContract.js'), 'utf8');

  for (const forbidden of [
    'fetch(',
    'require(\'openai\')',
    'require("openai")',
    'require(\'anthropic\')',
    'require("anthropic")',
    'require(\'@google',
    'require("@google',
    'stateStore',
    'appStore',
    'notification',
    'server.js',
    'saveScoutedListing'
  ]) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});
