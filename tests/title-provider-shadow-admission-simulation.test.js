'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  fingerprint
} = require('../validation/canonicalValidationCore');
const {
  resolveCardApiTransactionIdentity
} = require('../validation/cardApiIdentityResolutionPilot');
const {
  CANDIDATE_ADMISSION_STATUS,
  CANDIDATE_CONFLICT_STATUSES,
  SCHEMA_VERSION: CANDIDATE_SCHEMA_VERSION,
  buildTitleProviderEvidenceCandidates
} = require('../validation/titleProviderEvidenceCandidateLayer');
const {
  ELIGIBILITY_CLASSIFICATIONS,
  reviewTitleProviderCandidateAdmissionEligibility
} = require('../validation/titleProviderCandidateAdmissionEligibilityReview');
const {
  SHADOW_CANDIDATE_EXCLUSION_REASON_CODES,
  SHADOW_SIMULATION_CONSISTENCY_STATUSES,
  simulateTitleProviderShadowAdmission
} = require('../validation/titleProviderShadowAdmissionSimulation');

function readiness(overrides = {}) {
  return {
    confirmedTrueSoldPriceReady: true,
    canonicalReadySoldPrice: true,
    evidenceType: 'true_sold',
    status: 'active_evidence',
    ...overrides
  };
}

function identityDiagnostics(overrides = {}) {
  return {
    preVisionClassification: 'AMBIGUOUS',
    postVisionClassification: 'AMBIGUOUS',
    missingMaterialFieldsAfter: ['cardNumber'],
    conflictFields: [],
    exactReached: false,
    canonicalSoldEvidenceStructurallyReady: false,
    ...overrides
  };
}

function transaction(overrides = {}) {
  return {
    id: 'shadow-test-sale-id',
    platform: 'eBay',
    title: '2024 Topps Chrome Shohei Ohtani Gold Auto Patch /99 PSA 10',
    price: 42,
    soldAt: '2026-09-17T00:00:00.000Z',
    sold_at: '2026-09-17T00:00:00.000Z',
    currency: 'USD',
    listing_type: 'fixed_price',
    marketplace: 'the_card_api',
    sourceUrl: 'https://www.ebay.com/itm/shadow-test-sale-id',
    listing_url: 'https://www.ebay.com/itm/shadow-test-sale-id',
    url: 'https://www.ebay.com/itm/shadow-test-sale-id',
    acquiredAt: '2026-09-18T00:00:00.000Z',
    source: {
      retrievalMethod: 'card_api_compatibility_pilot',
      sourceReliability: 'provider_reported_verified_market_sale',
      acquiredAt: '2026-09-18T00:00:00.000Z'
    },
    evidenceType: 'true_sold',
    status: 'active_evidence',
    providerCompatibility: {
      canonicalReadySoldPrice: true
    },
    price_confirmed: true,
    ...overrides
  };
}

function candidate(overrides = {}) {
  return {
    schemaVersion: CANDIDATE_SCHEMA_VERSION,
    field: 'cardNumber',
    normalizedCandidateValue: '17',
    provenanceCategory: 'explicit_title_evidence',
    reasonCodes: ['candidate_only_not_admitted', 'explicit_title_candidate'],
    conflictStatus: CANDIDATE_CONFLICT_STATUSES.NONE,
    admissionStatus: CANDIDATE_ADMISSION_STATUS,
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none',
    ...overrides
  };
}

function candidateArtifact(candidates = []) {
  return {
    source: 'title_provider_evidence_candidate_layer',
    version: '0.1.0',
    schemaVersion: CANDIDATE_SCHEMA_VERSION,
    candidateLayerFingerprint: 'candidate-layer-test-fingerprint',
    candidates,
    diagnostics: {},
    nonPersistent: true,
    writesProductionStore: false,
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
}

function eligibilityReview(candidates = [], classifications = []) {
  const reviews = candidates.map((entry, index) => ({
    reviewId: `test-review-${index + 1}`,
    field: entry.field,
    provenanceCategory: entry.provenanceCategory,
    eligibilityClassification: classifications[index] ||
      ELIGIBILITY_CLASSIFICATIONS.ELIGIBLE_FOR_FUTURE_DETERMINISTIC_ADMISSION,
    reasonCodes: ['candidate_only_not_admitted'],
    admissionStatus: CANDIDATE_ADMISSION_STATUS,
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  }));
  const frequency = {};
  const eligibleCountByField = {};
  const manualReviewCountByField = {};
  const ineligibleCountByField = {};
  for (const review of reviews) {
    frequency[review.eligibilityClassification] = (frequency[review.eligibilityClassification] || 0) + 1;
    if (review.eligibilityClassification === ELIGIBILITY_CLASSIFICATIONS.ELIGIBLE_FOR_FUTURE_DETERMINISTIC_ADMISSION) {
      eligibleCountByField[review.field] = (eligibleCountByField[review.field] || 0) + 1;
    } else if (review.eligibilityClassification === ELIGIBILITY_CLASSIFICATIONS.MANUAL_REVIEW_REQUIRED) {
      manualReviewCountByField[review.field] = (manualReviewCountByField[review.field] || 0) + 1;
    } else {
      ineligibleCountByField[review.field] = (ineligibleCountByField[review.field] || 0) + 1;
    }
  }
  return {
    source: 'title_provider_candidate_admission_eligibility_review',
    version: '0.1.0',
    schemaVersion: '1.0.0',
    admissionEligibilityReviewFingerprint: 'eligibility-review-test-fingerprint',
    reviews,
    diagnostics: {
      admissionEligibilityClassificationFrequency: frequency,
      eligibleCandidateFields: Object.keys(eligibleCountByField).sort(),
      eligibleCandidateCountByField: eligibleCountByField,
      ineligibleCandidateFields: Object.keys(ineligibleCountByField).sort(),
      ineligibleCandidateCountByField: ineligibleCountByField,
      ineligibilityReasonCodesByField: {},
      manualReviewCandidateFields: Object.keys(manualReviewCountByField).sort(),
      manualReviewCandidateCountByField: manualReviewCountByField,
      manualReviewReasonCodesByField: {},
      eligibilityAggregateConsistencyStatus: 'consistent',
      eligibilityAggregateConsistencyReasonCodes: ['aggregate_consistency_ok']
    },
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
}

test('A5.15 applies only genuinely inserted provider metadata and excludes title channel candidates', () => {
  const candidates = [
    candidate({ normalizedCandidateValue: '17' }),
    candidate({ normalizedCandidateValue: '#17', provenanceCategory: 'provider_metadata' })
  ];
  const artifact = candidateArtifact(candidates);
  const review = eligibilityReview(candidates);
  const inputTransaction = transaction();
  const existingIdentityResult = resolveCardApiTransactionIdentity(inputTransaction);
  const existingEvidenceResult = { source: 'existing_evidence_result', admittedMultimodalFields: [] };
  const beforeTransaction = fingerprint(inputTransaction);
  const beforeArtifact = fingerprint(artifact);
  const beforeReview = fingerprint(review);
  const beforeEvidence = fingerprint(existingEvidenceResult);
  const beforeIdentity = fingerprint(existingIdentityResult);
  const diagnostics = identityDiagnostics();
  const beforeDiagnostics = fingerprint(diagnostics);
  const result = simulateTitleProviderShadowAdmission({
    transaction: inputTransaction,
    candidateArtifact: artifact,
    eligibilityReview: review,
    existingEvidenceResult,
    existingIdentityResult,
    sourceReadiness: readiness(),
    identityDiagnostics: diagnostics
  });

  assert.equal(result.diagnostics.shadowCandidatesConsidered, 2);
  assert.equal(result.diagnostics.shadowCandidatesApplied, 1);
  assert.equal(result.diagnostics.shadowCandidatesExcluded, 1);
  assert.equal(result.diagnostics.shadowCandidateExclusionReasonCounts.title_candidate_channel_unavailable, 1);
  assert.deepEqual(result.diagnostics.shadowAppliedFields, ['cardNumber']);
  assert.deepEqual(result.diagnostics.shadowRecoveredFieldFrequency, { cardNumber: 1 });
  assert.equal(result.diagnostics.shadowExactWouldBeReachedCount, 1);
  assert.equal(result.diagnostics.shadowCanonicalSoldEvidenceWouldBeStructurallyReadyCount, 1);
  assert.equal(result.diagnostics.shadowSimulationConsistencyStatus, SHADOW_SIMULATION_CONSISTENCY_STATUSES.CONSISTENT);
  assert.deepEqual(result.diagnostics.shadowSimulationConsistencyReasonCodes, ['shadow_consistency_ok']);
  assert.equal(result.diagnostics.shadowOnly, true);
  assert.equal(result.diagnostics.admittedToProduction, false);
  assert.equal(fingerprint(inputTransaction), beforeTransaction);
  assert.equal(fingerprint(artifact), beforeArtifact);
  assert.equal(fingerprint(review), beforeReview);
  assert.equal(fingerprint(existingEvidenceResult), beforeEvidence);
  assert.equal(fingerprint(existingIdentityResult), beforeIdentity);
  assert.equal(fingerprint(diagnostics), beforeDiagnostics);
  assert.equal(Object.isFrozen(result), true);
});

test('A5.15 excludes manual-review, ineligible, absence-sensitive, and provisional candidates', () => {
  const candidates = [
    candidate({ field: 'serialNumbered', normalizedCandidateValue: true, provenanceCategory: 'provider_metadata' }),
    candidate({ field: 'rawOrGraded', normalizedCandidateValue: 'graded', provenanceCategory: 'provider_metadata' }),
    candidate({ field: 'cardNumber', normalizedCandidateValue: '17' })
  ];
  const result = simulateTitleProviderShadowAdmission({
    transaction: transaction(),
    candidateArtifact: candidateArtifact(candidates),
    eligibilityReview: eligibilityReview(candidates, [
      ELIGIBILITY_CLASSIFICATIONS.MANUAL_REVIEW_REQUIRED,
      ELIGIBILITY_CLASSIFICATIONS.MANUAL_REVIEW_REQUIRED,
      ELIGIBILITY_CLASSIFICATIONS.ELIGIBLE_FOR_FUTURE_DETERMINISTIC_ADMISSION
    ]),
    sourceReadiness: readiness({ confirmedTrueSoldPriceReady: false, canonicalReadySoldPrice: false, evidenceType: 'active_context' }),
    identityDiagnostics: identityDiagnostics({ missingMaterialFieldsAfter: ['cardNumber', 'serialNumbered', 'rawOrGraded'] })
  });

  assert.equal(result.diagnostics.shadowCandidatesConsidered, 3);
  assert.equal(result.diagnostics.shadowCandidatesApplied, 0);
  assert.equal(result.diagnostics.shadowCandidatesExcluded, 3);
  assert.equal(result.diagnostics.shadowCandidateExclusionReasonCounts.manual_review_candidate_excluded, 2);
  assert.equal(result.diagnostics.shadowCandidateExclusionReasonCounts.provisional_price_not_shadow_ready, 1);
  assert.deepEqual(result.diagnostics.shadowMissingFieldFrequencyBefore, result.diagnostics.shadowMissingFieldFrequencyAfter);
  assert.deepEqual(result.diagnostics.shadowRecoveredFieldFrequency, {});
  assert.equal(result.diagnostics.shadowClassificationImprovementCount, 0);
  assert.equal(result.diagnostics.shadowCanonicalSoldEvidenceWouldBeStructurallyReadyCount, 0);
  assert.deepEqual(result.diagnostics.shadowAppliedFields, []);
});

test('A5.15A preserves paired resolver parity when all candidates are excluded', () => {
  const candidates = Array.from({ length: 16 }, (_, index) => candidate({
    field: index % 2 === 0 ? 'cardNumber' : 'parallel',
    normalizedCandidateValue: index % 2 === 0 ? '17' : 'gold',
    provenanceCategory: 'explicit_title_evidence'
  }));
  const result = simulateTitleProviderShadowAdmission({
    transaction: transaction({
      title: '2024 Topps Chrome Shohei Ohtani Gold Auto Patch /99 PSA 10'
    }),
    candidateArtifact: candidateArtifact(candidates),
    eligibilityReview: eligibilityReview(candidates),
    sourceReadiness: readiness(),
    identityDiagnostics: identityDiagnostics({
      missingMaterialFieldsAfter: ['manufacturer', 'rawOrGraded', 'serialNumbered', 'subjectName']
    })
  });

  assert.equal(result.diagnostics.shadowCandidatesConsidered, 16);
  assert.equal(result.diagnostics.shadowCandidatesApplied, 0);
  assert.equal(result.diagnostics.shadowCandidatesExcluded, 16);
  assert.deepEqual(result.diagnostics.shadowMissingFieldFrequencyBefore, result.diagnostics.shadowMissingFieldFrequencyAfter);
  assert.deepEqual(result.diagnostics.shadowClassificationCountsBefore, result.diagnostics.shadowClassificationCountsAfter);
  assert.deepEqual(result.diagnostics.shadowRecoveredFieldFrequency, {});
  assert.equal(result.diagnostics.shadowClassificationImprovementCount, 0);
  assert.equal(result.diagnostics.shadowExactWouldBeReachedCount, 0);
  assert.equal(result.diagnostics.shadowCanonicalSoldEvidenceWouldBeStructurallyReadyCount, 0);
  assert.deepEqual(result.diagnostics.shadowConflictFields, []);
  assert.equal(result.diagnostics.shadowSimulationConsistencyStatus, SHADOW_SIMULATION_CONSISTENCY_STATUSES.CONSISTENT);
  assert.deepEqual(result.diagnostics.shadowSimulationConsistencyReasonCodes, ['shadow_consistency_ok']);
});

test('A5.15 treats multiple eligible values for the same field as a shadow conflict', () => {
  const candidates = [
    candidate({ normalizedCandidateValue: '17', provenanceCategory: 'provider_metadata' }),
    candidate({ normalizedCandidateValue: '99', provenanceCategory: 'provider_metadata' })
  ];
  const result = simulateTitleProviderShadowAdmission({
    transaction: transaction(),
    candidateArtifact: candidateArtifact(candidates),
    eligibilityReview: eligibilityReview(candidates),
    sourceReadiness: readiness(),
    identityDiagnostics: identityDiagnostics()
  });

  assert.equal(result.diagnostics.shadowCandidatesConsidered, 2);
  assert.equal(result.diagnostics.shadowCandidatesApplied, 0);
  assert.equal(result.diagnostics.shadowCandidatesExcluded, 2);
  assert.deepEqual(result.diagnostics.shadowConflictFields, ['cardNumber']);
  assert.equal(result.diagnostics.shadowCandidateExclusionReasonCounts.field_value_disagreement, 2);
  assert.equal(result.diagnostics.shadowExactWouldBeReachedCount, 0);
});

test('A5.15 excludes duplicate provider candidates without inflating applied counts', () => {
  const candidates = [
    candidate({ normalizedCandidateValue: '17', provenanceCategory: 'provider_metadata' }),
    candidate({ normalizedCandidateValue: '#17', provenanceCategory: 'provider_metadata' })
  ];
  const result = simulateTitleProviderShadowAdmission({
    transaction: transaction(),
    candidateArtifact: candidateArtifact(candidates),
    eligibilityReview: eligibilityReview(candidates),
    sourceReadiness: readiness(),
    identityDiagnostics: identityDiagnostics()
  });

  assert.equal(result.diagnostics.shadowCandidatesConsidered, 2);
  assert.equal(result.diagnostics.shadowCandidatesApplied, 1);
  assert.equal(result.diagnostics.shadowCandidatesExcluded, 1);
  assert.equal(result.diagnostics.shadowCandidateExclusionReasonCounts.duplicate_candidate, 1);
  assert.deepEqual(result.diagnostics.shadowAppliedFields, ['cardNumber']);
  assert.deepEqual(result.diagnostics.shadowRecoveredFieldFrequency, { cardNumber: 1 });
});

test('A5.15 blocks provider overwrite and existing-value disagreements before insertion', () => {
  const candidates = [
    candidate({ normalizedCandidateValue: '17', provenanceCategory: 'provider_metadata' })
  ];
  const result = simulateTitleProviderShadowAdmission({
    transaction: transaction({
      title: '2024 Topps Chrome Shohei Ohtani Gold Auto Patch /99',
      parsedIdentity: {
        cardNumber: '99'
      }
    }),
    candidateArtifact: candidateArtifact(candidates),
    eligibilityReview: eligibilityReview(candidates),
    sourceReadiness: readiness(),
    identityDiagnostics: identityDiagnostics()
  });

  assert.equal(result.diagnostics.shadowCandidatesConsidered, 1);
  assert.equal(result.diagnostics.shadowCandidatesApplied, 0);
  assert.equal(result.diagnostics.shadowCandidatesExcluded, 1);
  assert.equal(result.diagnostics.shadowCandidateExclusionReasonCounts.existing_value_conflict, 1);
  assert.deepEqual(result.diagnostics.shadowConflictFields, ['cardNumber']);
  assert.deepEqual(result.diagnostics.shadowRecoveredFieldFrequency, {});
  assert.equal(result.diagnostics.shadowExactWouldBeReachedCount, 0);
});

test('A5.15 excludes provider candidates already represented by baseline identity', () => {
  const candidates = [
    candidate({ normalizedCandidateValue: '17', provenanceCategory: 'provider_metadata' })
  ];
  const result = simulateTitleProviderShadowAdmission({
    transaction: transaction({
      parsedIdentity: {
        cardNumber: '17'
      }
    }),
    candidateArtifact: candidateArtifact(candidates),
    eligibilityReview: eligibilityReview(candidates),
    sourceReadiness: readiness(),
    identityDiagnostics: identityDiagnostics()
  });

  assert.equal(result.diagnostics.shadowCandidatesApplied, 0);
  assert.equal(result.diagnostics.shadowCandidatesExcluded, 1);
  assert.equal(result.diagnostics.shadowCandidateExclusionReasonCounts.provider_candidate_already_represented, 1);
  assert.deepEqual(result.diagnostics.shadowAppliedFields, []);
});

test('A5.15 excludes title candidates already represented by the unchanged original title', () => {
  const candidates = [
    candidate({
      normalizedCandidateValue: '17',
      provenanceCategory: 'explicit_title_evidence'
    })
  ];
  const result = simulateTitleProviderShadowAdmission({
    transaction: transaction({
      title: '2024 Topps Chrome Shohei Ohtani #17 Gold Auto Patch /99 PSA 10'
    }),
    candidateArtifact: candidateArtifact(candidates),
    eligibilityReview: eligibilityReview(candidates),
    sourceReadiness: readiness(),
    existingIdentityResult: resolveCardApiTransactionIdentity(transaction({
      title: '2024 Topps Chrome Shohei Ohtani #17 Gold Auto Patch /99 PSA 10'
    })),
    identityDiagnostics: identityDiagnostics()
  });

  assert.equal(result.diagnostics.shadowCandidatesApplied, 0);
  assert.equal(result.diagnostics.shadowCandidatesExcluded, 1);
  assert.equal(result.diagnostics.shadowCandidateExclusionReasonCounts.title_candidate_already_represented, 1);
  assert.deepEqual(result.diagnostics.shadowAppliedFields, []);
});

test('A5.15 fails closed when eligibility aggregate consistency is invalid', () => {
  const candidates = [candidate()];
  const review = eligibilityReview(candidates);
  review.diagnostics.eligibilityAggregateConsistencyStatus = 'invalid';
  review.diagnostics.eligibilityAggregateConsistencyReasonCodes = ['eligibility_classification_count_mismatch'];
  const result = simulateTitleProviderShadowAdmission({
    transaction: transaction(),
    candidateArtifact: candidateArtifact(candidates),
    eligibilityReview: review,
    sourceReadiness: readiness(),
    identityDiagnostics: identityDiagnostics()
  });

  assert.equal(result.diagnostics.shadowCandidatesApplied, 0);
  assert.equal(result.diagnostics.shadowCandidateExclusionReasonCounts.aggregate_consistency_invalid, 1);
  assert.equal(result.diagnostics.shadowExactWouldBeReachedCount, 0);
});

test('A5.15 public diagnostics are sanitized, deterministic, and non-authoritative', () => {
  const inputTransaction = transaction({
    title: '2024 Topps Chrome Shohei Ohtani #17 Gold'
  });
  const artifact = buildTitleProviderEvidenceCandidates({
    normalizedListingTitle: '2024 Topps Chrome Shohei Ohtani #17 Gold',
    providerMetadata: {
      player: 'Shohei Ohtani',
      trackingId: 'provider-secret',
      sourceUrl: 'https://example.test/secret'
    },
    identityDiagnostics: identityDiagnostics()
  });
  const review = reviewTitleProviderCandidateAdmissionEligibility({
    candidateArtifact: artifact,
    sourceReadiness: readiness(),
    identityDiagnostics: identityDiagnostics()
  });
  const first = simulateTitleProviderShadowAdmission({
    transaction: inputTransaction,
    candidateArtifact: artifact,
    eligibilityReview: review,
    existingIdentityResult: resolveCardApiTransactionIdentity(inputTransaction),
    sourceReadiness: readiness(),
    identityDiagnostics: identityDiagnostics()
  });
  const second = simulateTitleProviderShadowAdmission({
    transaction: inputTransaction,
    candidateArtifact: artifact,
    eligibilityReview: review,
    existingIdentityResult: resolveCardApiTransactionIdentity(inputTransaction),
    sourceReadiness: readiness(),
    identityDiagnostics: identityDiagnostics()
  });
  const serialized = JSON.stringify(first.diagnostics);

  assert.equal(first.shadowAdmissionSimulationFingerprint, second.shadowAdmissionSimulationFingerprint);
  assert.equal(first.productionImpact, 'none');
  assert.equal(first.decisionImpact, 'none');
  assert.equal(first.executionAuthority, 'none');
  assert.equal(first.nonPersistent, true);
  assert.equal(first.writesProductionStore, false);
  assert.equal(serialized.includes('Shohei'), false);
  assert.equal(serialized.includes('Ohtani'), false);
  assert.equal(serialized.includes('Gold'), false);
  assert.equal(serialized.includes('17'), false);
  assert.equal(serialized.includes('provider-secret'), false);
  assert.equal(serialized.includes('https://'), false);
});

test('A5.15 invokes the existing resolver with inserted provider metadata and proves resolver-caused improvement', () => {
  const shadowPath = require.resolve('../validation/titleProviderShadowAdmissionSimulation');
  const identityPath = require.resolve('../validation/cardApiIdentityResolutionPilot');
  delete require.cache[shadowPath];
  const identityModule = require(identityPath);
  const original = identityModule.resolveCardApiTransactionIdentity;
  const capturedInputs = [];
  identityModule.resolveCardApiTransactionIdentity = (input, options = {}) => {
    capturedInputs.push(input);
    assert.equal(options.shadowOnly, true);
    assert.equal(Object.hasOwn(input, 'observations'), false);
    return original(input, options);
  };
  let result;
  const inputTransaction = transaction();
  const baseline = original(inputTransaction);
  assert.notEqual(baseline.classification, 'EXACT');
  assert.equal(baseline.missingMaterialFields.includes('cardNumber'), true);
  try {
    const shadowModule = require(shadowPath);
    const candidates = [candidate({ normalizedCandidateValue: '17', provenanceCategory: 'provider_metadata' })];
    result = shadowModule.simulateTitleProviderShadowAdmission({
      transaction: inputTransaction,
      candidateArtifact: candidateArtifact(candidates),
      eligibilityReview: eligibilityReview(candidates),
      sourceReadiness: readiness(),
      existingIdentityResult: baseline,
      identityDiagnostics: identityDiagnostics()
    });
  } finally {
    identityModule.resolveCardApiTransactionIdentity = original;
    delete require.cache[shadowPath];
  }

  assert.equal(capturedInputs.length, 2);
  assert.equal(capturedInputs[0].parsedIdentity, undefined);
  assert.equal(capturedInputs[1].parsedIdentity.cardNumber, '17');
  assert.equal(
    Object.keys(capturedInputs[1].parsedIdentity).length - Object.keys(capturedInputs[0].parsedIdentity || {}).length,
    1
  );
  assert.equal(result.diagnostics.shadowCandidatesApplied, 1);
  assert.deepEqual(result.diagnostics.shadowRecoveredFieldFrequency, { cardNumber: 1 });
  assert.equal(result.diagnostics.shadowClassificationImprovementCount, 1);
  assert.equal(result.diagnostics.shadowExactWouldBeReachedCount, 1);
  assert.notEqual(resolveCardApiTransactionIdentity(inputTransaction).classification, 'EXACT');
});

test('A5.15 preserves title/provider provenance and refuses shadow exact when resolver cannot represent it', () => {
  const candidates = [
    candidate({
      field: 'cardNumber',
      normalizedCandidateValue: '17',
      provenanceCategory: 'explicit_title_evidence'
    })
  ];
  const artifact = candidateArtifact(candidates);
  const beforeCandidate = fingerprint(artifact);
  const result = simulateTitleProviderShadowAdmission({
    transaction: transaction({
      title: '2024 Topps Chrome Shohei Ohtani Gold Auto Patch /99 PSA 10'
    }),
    candidateArtifact: artifact,
    eligibilityReview: eligibilityReview(candidates),
    sourceReadiness: readiness(),
    identityDiagnostics: identityDiagnostics()
  });

  assert.equal(result.diagnostics.shadowCandidatesApplied, 0);
  assert.equal(result.diagnostics.shadowCandidatesExcluded, 1);
  assert.equal(result.diagnostics.shadowCandidateExclusionReasonCounts.title_candidate_channel_unavailable, 1);
  assert.equal(result.diagnostics.shadowExactWouldBeReachedCount, 0);
  assert.equal(result.diagnostics.shadowCanonicalSoldEvidenceWouldBeStructurallyReadyCount, 0);
  assert.equal(artifact.candidates[0].provenanceCategory, 'explicit_title_evidence');
  assert.equal(fingerprint(artifact), beforeCandidate);
});

test('A5.15 exports allowlisted statuses and imports no runtime or provider execution code', () => {
  for (const reason of [
    'field_value_disagreement',
    'title_candidate_already_represented',
    'title_candidate_channel_unavailable',
    'provider_candidate_already_represented',
    'existing_value_conflict',
    'duplicate_candidate'
  ]) {
    assert.equal(SHADOW_CANDIDATE_EXCLUSION_REASON_CODES.includes(reason), true, `${reason} must be allowlisted`);
  }
  const source = fs.readFileSync(path.join(__dirname, '..', 'validation', 'titleProviderShadowAdmissionSimulation.js'), 'utf8');
  assert.equal(source.includes('resolveCardApiTransactionIdentity'), true);
  assert.equal(source.includes('explicit_visual_evidence'), false);
  assert.equal(source.includes('offline_fixture'), false);
  assert.equal(source.includes('afterMissing.length === 0'), false);
  const forbidden = [
    'server.js',
    'openai',
    'fetch(',
    'executeCardApiSalesRequest',
    'stateStore',
    'notificationEngine',
    'BUY_NOW',
    'purchase',
    'bid',
    'offer'
  ];

  for (const token of forbidden) {
    assert.equal(source.includes(token), false, `forbidden token present: ${token}`);
  }
});
