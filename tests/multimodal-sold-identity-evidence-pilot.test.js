'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  ADMISSION_STATUSES,
  OBSERVATION_TYPES,
  VISUAL_SOLVABILITY,
  createMultimodalIdentityObservation,
  resolveMultimodalSoldIdentityEvidence,
  summarizeMultimodalSoldIdentityEvidence,
  validateMultimodalIdentityObservation
} = require('../validation/multimodalSoldIdentityEvidencePilot');

function soldTransaction(overrides = {}) {
  return {
    id: 'provider-id-not-output',
    platform: 'eBay',
    listing_type: 'fixed_price',
    title: '2024 Topps Chrome Shohei Ohtani #17 Base',
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

function obs(field, proposedValue, overrides = {}) {
  return {
    observationId: `obs-${field}-${String(proposedValue).replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`,
    field,
    proposedValue,
    observationType: OBSERVATION_TYPES.EXPLICIT_VISUAL,
    evidenceSource: 'offline_fixture',
    evidenceModality: 'image_ocr',
    confidence: 0.96,
    modelProvider: 'fixture_provider',
    modelIdentifier: 'fixture_model_v1',
    observedAt: '2026-09-18T00:00:00.000Z',
    deterministicVerification: true,
    ...overrides
  };
}

function minimalAmbiguousTransaction(overrides = {}) {
  return soldTransaction({
    title: '2024 Topps Chrome',
    ...overrides
  });
}

test('observation contract validates provider-neutral visual evidence shape', () => {
  const observation = createMultimodalIdentityObservation(obs('cardNumber', '17'));
  const validation = validateMultimodalIdentityObservation(observation);

  assert.equal(validation.valid, true);
  assert.equal(observation.productionImpact, 'none');
  assert.equal(observation.decisionImpact, 'none');
  assert.equal(observation.executionAuthority, 'none');
  assert.equal(typeof observation.observationFingerprint, 'string');
  assert.equal(Object.isFrozen(observation), true);
});

test('image explicitly confirms subject without persisting image URL or provider identifiers', () => {
  const result = resolveMultimodalSoldIdentityEvidence({
    transaction: minimalAmbiguousTransaction(),
    observations: [obs('subjectName', 'Shohei Ohtani')]
  });
  const serialized = JSON.stringify(result);

  assert.equal(result.admittedMultimodalFields[0].field, 'subjectName');
  assert.equal(result.fieldProvenance.subjectName.source, 'admitted_multimodal_identity_evidence');
  assert.equal(serialized.includes('https://images.example.test'), false);
  assert.equal(serialized.includes('provider-id-not-output'), false);
});

test('image explicitly confirms card number and preserves provenance', () => {
  const result = resolveMultimodalSoldIdentityEvidence({
    transaction: minimalAmbiguousTransaction(),
    observations: [obs('cardNumber', '17')]
  });

  assert.equal(result.admittedMultimodalFields[0].field, 'cardNumber');
  assert.equal(result.fieldProvenance.cardNumber.observationId, 'obs-cardNumber-17');
  assert.equal(result.postMultimodalMissingMaterialFields.includes('cardNumber'), false);
});

test('slab label confirms grader and grade without changing authority', () => {
  const result = resolveMultimodalSoldIdentityEvidence({
    transaction: minimalAmbiguousTransaction(),
    observations: [
      obs('gradeCompany', 'PSA', { evidenceModality: 'slab_label' }),
      obs('grade', '10', { evidenceModality: 'slab_label' })
    ]
  });

  assert.equal(result.admittedMultimodalFields.length, 2);
  assert.equal(result.postMultimodalCandidateIdentity.normalized.rawOrGraded, 'graded');
  assert.equal(result.postMultimodalCandidateIdentity.normalized.grading.company, 'psa');
  assert.equal(result.productionImpact, 'none');
});

test('image explicitly confirms serial numbering and print run', () => {
  const result = resolveMultimodalSoldIdentityEvidence({
    transaction: minimalAmbiguousTransaction(),
    observations: [obs('printRun', 99)]
  });

  assert.equal(result.postMultimodalCandidateIdentity.normalized.serialNumbered, true);
  assert.equal(result.postMultimodalCandidateIdentity.normalized.printRun, 99);
  assert.equal(result.postMultimodalMissingMaterialFields.includes('serialNumbered'), false);
});

test('strong parallel color evidence without deterministic proof is rejected', () => {
  const result = resolveMultimodalSoldIdentityEvidence({
    transaction: minimalAmbiguousTransaction(),
    observations: [
      obs('parallel', 'Gold', {
        observationType: OBSERVATION_TYPES.INFERRED_VISUAL,
        deterministicVerification: false
      })
    ]
  });

  assert.equal(result.rejectedMultimodalFields[0].reason, 'inferred_visual_evidence_requires_review');
  assert.equal(result.postMultimodalMissingMaterialFields.includes('parallel'), true);
});

test('image absence does not infer non-autograph', () => {
  const result = resolveMultimodalSoldIdentityEvidence({
    transaction: minimalAmbiguousTransaction(),
    observations: [obs('autographState', false)]
  });

  assert.equal(result.rejectedMultimodalFields[0].reason, 'absence_is_not_negative_evidence');
  assert.equal(result.postMultimodalMissingMaterialFields.includes('autographState'), true);
});

test('image absence does not infer non-memorabilia', () => {
  const result = resolveMultimodalSoldIdentityEvidence({
    transaction: minimalAmbiguousTransaction(),
    observations: [obs('memorabiliaState', false)]
  });

  assert.equal(result.rejectedMultimodalFields[0].reason, 'absence_is_not_negative_evidence');
  assert.equal(result.postMultimodalMissingMaterialFields.includes('memorabiliaState'), true);
});

test('title and image agreement can admit supplemental evidence', () => {
  const result = resolveMultimodalSoldIdentityEvidence({
    transaction: soldTransaction({ title: '2024 Topps Chrome Shohei Ohtani #17 Base' }),
    observations: [obs('cardNumber', '17')]
  });

  assert.equal(result.conflicts.length, 0);
  assert.equal(result.admittedMultimodalFields[0].field, 'cardNumber');
});

test('title and image conflict prevents automatic exact promotion', () => {
  const result = resolveMultimodalSoldIdentityEvidence({
    transaction: soldTransaction({ title: '2024 Topps Chrome Shohei Ohtani #17 Base' }),
    observations: [obs('cardNumber', '99')]
  });

  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].reason, 'title_parse_multimodal_conflict');
  assert.equal(result.postMultimodalClassification, 'AMBIGUOUS');
  assert.equal(result.canonicalSoldEvidenceStructurallyReady, false);
});

test('provider metadata and image conflict prevents exact promotion', () => {
  const result = resolveMultimodalSoldIdentityEvidence({
    transaction: soldTransaction({
      title: '2024 Topps Chrome Shohei Ohtani Base',
      card_number: '17'
    }),
    observations: [obs('cardNumber', '99')]
  });

  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].reason, 'provider_metadata_multimodal_conflict');
  assert.equal(result.postMultimodalClassification, 'AMBIGUOUS');
});

test('low-confidence image observation is rejected', () => {
  const result = resolveMultimodalSoldIdentityEvidence({
    transaction: minimalAmbiguousTransaction(),
    observations: [obs('subjectName', 'Shohei Ohtani', { confidence: 0.6 })]
  });

  assert.equal(result.rejectedMultimodalFields[0].reason, 'confidence_below_admission_threshold');
  assert.equal(result.postMultimodalMissingMaterialFields.includes('subjectName'), true);
});

test('multiple cards visible blocks observation admission', () => {
  const result = resolveMultimodalSoldIdentityEvidence({
    transaction: minimalAmbiguousTransaction(),
    observations: [obs('subjectName', 'Shohei Ohtani', { multipleCardsVisible: true })]
  });

  assert.equal(result.rejectedMultimodalFields[0].reason, 'multiple_cards_visible');
});

test('unknown or unusable image evidence remains rejected and explicit', () => {
  const result = resolveMultimodalSoldIdentityEvidence({
    transaction: minimalAmbiguousTransaction(),
    observations: [
      obs('parallel', 'unknown', {
        observationType: OBSERVATION_TYPES.UNKNOWN,
        deterministicVerification: false,
        confidence: 0.9
      })
    ]
  });

  assert.equal(result.rejectedMultimodalFields[0].reason, 'unknown_not_observable');
  assert.equal(result.postMultimodalMissingMaterialFields.includes('parallel'), true);
});

test('sufficient combined title and admitted image evidence can legitimately reach exact', () => {
  const result = resolveMultimodalSoldIdentityEvidence({
    transaction: minimalAmbiguousTransaction(),
    observations: [
      obs('sport', 'baseball'),
      obs('subjectName', 'Shohei Ohtani'),
      obs('cardNumber', '17'),
      obs('parallel', 'Gold'),
      obs('autographState', true),
      obs('memorabiliaState', true),
      obs('printRun', 99),
      obs('gradeCompany', 'PSA', { evidenceModality: 'slab_label' }),
      obs('grade', '10', { evidenceModality: 'slab_label' })
    ]
  });

  assert.equal(result.preMultimodalClassification, 'AMBIGUOUS');
  assert.equal(result.postMultimodalClassification, 'EXACT');
  assert.equal(result.canonicalSoldEvidenceStructurallyReady, true);
  assert.equal(result.postMultimodalMissingMaterialFields.length, 0);
});

test('insufficient combined evidence remains ambiguous', () => {
  const result = resolveMultimodalSoldIdentityEvidence({
    transaction: minimalAmbiguousTransaction(),
    observations: [
      obs('subjectName', 'Shohei Ohtani'),
      obs('cardNumber', '17')
    ]
  });

  assert.equal(result.postMultimodalClassification, 'AMBIGUOUS');
  assert.equal(result.canonicalSoldEvidenceStructurallyReady, false);
  assert.equal(result.postMultimodalMissingMaterialFields.includes('parallel'), true);
});

test('summary is deterministic and non-authoritative', () => {
  const exact = resolveMultimodalSoldIdentityEvidence({
    transaction: minimalAmbiguousTransaction(),
    observations: [
      obs('sport', 'baseball'),
      obs('subjectName', 'Shohei Ohtani'),
      obs('cardNumber', '17'),
      obs('parallel', 'Gold'),
      obs('autographState', true),
      obs('memorabiliaState', true),
      obs('printRun', 99),
      obs('gradeCompany', 'PSA', { evidenceModality: 'slab_label' }),
      obs('grade', '10', { evidenceModality: 'slab_label' })
    ]
  });
  const ambiguous = resolveMultimodalSoldIdentityEvidence({
    transaction: minimalAmbiguousTransaction(),
    observations: [obs('subjectName', 'Shohei Ohtani')]
  });
  const summary = summarizeMultimodalSoldIdentityEvidence([exact, ambiguous]);
  const repeated = summarizeMultimodalSoldIdentityEvidence([exact, ambiguous]);

  assert.equal(summary.evaluated, 2);
  assert.equal(summary.exact, 1);
  assert.equal(summary.ambiguous, 1);
  assert.equal(summary.productionImpact, 'none');
  assert.equal(summary.summaryFingerprint, repeated.summaryFingerprint);
});

test('A5.4 live blockers are classified by visual solvability without claiming absence proof', () => {
  assert.equal(VISUAL_SOLVABILITY.subjectName, 'commonly_visually_observable');
  assert.equal(VISUAL_SOLVABILITY.cardNumber, 'commonly_visually_observable');
  assert.equal(VISUAL_SOLVABILITY.parallel, 'sometimes_visually_observable');
  assert.equal(VISUAL_SOLVABILITY.rawOrGraded, 'commonly_visually_observable');
  assert.equal(VISUAL_SOLVABILITY.serialNumbered, 'sometimes_visually_observable');
  assert.equal(VISUAL_SOLVABILITY.autographState, 'sometimes_visually_observable_positive_only');
  assert.equal(VISUAL_SOLVABILITY.memorabiliaState, 'sometimes_visually_observable_positive_only');
});

test('pilot module has no runtime, persistence, network, notification, or purchase imports', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'validation', 'multimodalSoldIdentityEvidencePilot.js'), 'utf8');

  for (const forbidden of [
    'fetch(',
    'require(\'openai\')',
    'require("openai")',
    'require(\'tesseract',
    'require("tesseract',
    'saveScoutedListing',
    'stateStore',
    'appStore',
    'notification',
    'server.js',
    'BUY_NOW'
  ]) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});
