'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  CANDIDATE_ADMISSION_STATUS,
  CANDIDATE_CONFLICT_STATUSES,
  PROVENANCE_CATEGORIES,
  SCHEMA_VERSION: CANDIDATE_SCHEMA_VERSION,
  buildTitleProviderEvidenceCandidates
} = require('../validation/titleProviderEvidenceCandidateLayer');
const {
  ELIGIBILITY_CLASSIFICATIONS,
  ELIGIBILITY_CLASSIFICATION_ORDER,
  MAX_REVIEW_CANDIDATES,
  reviewTitleProviderCandidateAdmissionEligibility
} = require('../validation/titleProviderCandidateAdmissionEligibilityReview');

function candidateArtifact(overrides = {}) {
  const candidates = overrides.candidates || [];
  return {
    source: 'title_provider_evidence_candidate_layer',
    version: '0.1.0',
    schemaVersion: CANDIDATE_SCHEMA_VERSION,
    candidateLayerFingerprint: 'candidate-layer-test-fingerprint',
    candidates
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

function sourceReadiness(overrides = {}) {
  return {
    confirmedTrueSoldPriceReady: true,
    canonicalReadySoldPrice: true,
    evidenceType: 'true_sold',
    status: 'active_evidence',
    ...overrides
  };
}

test('A5.14 marks explicit confirmed true-sold candidates eligible without admitting them', () => {
  const artifact = buildTitleProviderEvidenceCandidates({
    normalizedListingTitle: '2024 Topps Chrome Shohei Ohtani #17 Gold PSA 10',
    providerMetadata: {},
    identityDiagnostics: {
      missingMaterialFieldsAfter: ['cardNumber', 'parallel'],
      conflictFields: []
    }
  });
  const review = reviewTitleProviderCandidateAdmissionEligibility({
    candidateArtifact: artifact,
    sourceReadiness: sourceReadiness()
  });
  const serialized = JSON.stringify(review);

  assert.equal(review.reviews.some((entry) => entry.field === 'cardNumber'), true);
  assert.equal(review.diagnostics.eligibleCandidateFields.includes('cardNumber'), true);
  assert.equal(review.diagnostics.eligibleCandidateCountByField.cardNumber, 1);
  assert.equal(
    review.diagnostics.admissionEligibilityClassificationFrequency[
      ELIGIBILITY_CLASSIFICATIONS.ELIGIBLE_FOR_FUTURE_DETERMINISTIC_ADMISSION
    ] >= 1,
    true
  );
  assert.equal(review.reviews.every((entry) => entry.admissionStatus === CANDIDATE_ADMISSION_STATUS), true);
  assert.equal(review.reviews.every((entry) => entry.productionImpact === 'none'), true);
  assert.equal(review.productionImpact, 'none');
  assert.equal(review.decisionImpact, 'none');
  assert.equal(review.executionAuthority, 'none');
  assert.equal(serialized.includes('Shohei'), false);
  assert.equal(serialized.includes('Ohtani'), false);
  assert.equal(serialized.includes('Gold'), false);
});

test('A5.14 accepts allowlisted provider metadata as candidate-only eligibility evidence', () => {
  const artifact = buildTitleProviderEvidenceCandidates({
    normalizedListingTitle: '',
    providerMetadata: {
      card_number: '181',
      player: 'Anthony Hernandez',
      trackingId: 'provider-secret-id'
    },
    identityDiagnostics: {
      missingMaterialFieldsAfter: ['cardNumber', 'subjectName'],
      conflictFields: []
    }
  });
  const review = reviewTitleProviderCandidateAdmissionEligibility({
    candidateArtifact: artifact,
    sourceReadiness: sourceReadiness()
  });
  const serialized = JSON.stringify(review.diagnostics);

  assert.equal(review.diagnostics.eligibleCandidateFields.includes('cardNumber'), true);
  assert.equal(review.diagnostics.eligibleCandidateFields.includes('subjectName'), true);
  assert.equal(review.diagnostics.eligibleCandidateCountByField.cardNumber, 1);
  assert.equal(review.diagnostics.futureDeterministicAdmissionCouldMateriallyHelp, true);
  assert.equal(serialized.includes('Anthony'), false);
  assert.equal(serialized.includes('Hernandez'), false);
  assert.equal(serialized.includes('provider-secret-id'), false);
});

test('A5.14 fails closed for provisional sale prices even when candidates agree', () => {
  const artifact = buildTitleProviderEvidenceCandidates({
    normalizedListingTitle: '2024 Topps Chrome Shohei Ohtani #17',
    providerMetadata: {
      cardNumber: '17'
    },
    identityDiagnostics: {
      missingMaterialFieldsAfter: ['cardNumber'],
      conflictFields: []
    }
  });
  const review = reviewTitleProviderCandidateAdmissionEligibility({
    candidateArtifact: artifact,
    sourceReadiness: sourceReadiness({
      confirmedTrueSoldPriceReady: false,
      canonicalReadySoldPrice: false,
      evidenceType: 'active_context',
      status: 'provisional_price_context'
    })
  });

  assert.deepEqual(review.diagnostics.eligibleCandidateFields, []);
  assert.equal(
    review.diagnostics.admissionEligibilityClassificationFrequency[
      ELIGIBILITY_CLASSIFICATIONS.INELIGIBLE_PROVISIONAL_SALE
    ],
    artifact.candidates.length
  );
  assert.equal(review.diagnostics.ineligibleCandidateFields.includes('cardNumber'), true);
  assert.equal(
    review.diagnostics.ineligibilityReasonCodesByField.cardNumber.includes('provisional_sale_not_canonical_ready'),
    true
  );
  assert.equal(review.diagnostics.futureDeterministicAdmissionCouldMateriallyHelp, false);
});

test('A5.14 keeps conflicting title and metadata candidates unresolved', () => {
  const artifact = buildTitleProviderEvidenceCandidates({
    normalizedListingTitle: '2024 Topps Chrome Shohei Ohtani #17 Gold',
    providerMetadata: {
      cardNumber: '99',
      parallel: 'Blue'
    },
    identityDiagnostics: {
      missingMaterialFieldsAfter: ['cardNumber', 'parallel'],
      conflictFields: ['cardNumber', 'parallel']
    }
  });
  const review = reviewTitleProviderCandidateAdmissionEligibility({
    candidateArtifact: artifact,
    sourceReadiness: sourceReadiness()
  });

  assert.deepEqual(review.diagnostics.unresolvedAdmissionConflictFields, ['cardNumber', 'parallel']);
  assert.equal(review.diagnostics.eligibleCandidateFields.includes('cardNumber'), false);
  assert.equal(
    review.diagnostics.admissionEligibilityClassificationFrequency[
      ELIGIBILITY_CLASSIFICATIONS.INELIGIBLE_CONFLICT_UNRESOLVED
    ],
    4
  );
  assert.equal(review.diagnostics.ineligibilityReasonCodesByField.cardNumber.includes('unresolved_candidate_conflict'), true);
});

test('A5.14 refuses negative or absence-sensitive conclusions as deterministic admission candidates', () => {
  const review = reviewTitleProviderCandidateAdmissionEligibility({
    candidateArtifact: candidateArtifact({
      candidates: [
        candidate({
          field: 'autographState',
          normalizedCandidateValue: false,
          provenanceCategory: 'explicit_title_evidence',
          reasonCodes: ['candidate_only_not_admitted']
        }),
        candidate({
          field: 'serialNumbered',
          normalizedCandidateValue: true,
          provenanceCategory: 'provider_metadata',
          reasonCodes: ['candidate_only_not_admitted']
        })
      ]
    }),
    sourceReadiness: sourceReadiness()
  });

  assert.equal(
    review.diagnostics.admissionEligibilityClassificationFrequency[
      ELIGIBILITY_CLASSIFICATIONS.INELIGIBLE_ABSENCE_SENSITIVE
    ],
    1
  );
  assert.equal(
    review.diagnostics.admissionEligibilityClassificationFrequency[
      ELIGIBILITY_CLASSIFICATIONS.MANUAL_REVIEW_REQUIRED
    ],
    1
  );
  assert.deepEqual(review.diagnostics.eligibleCandidateFields, []);
  assert.deepEqual(review.diagnostics.manualReviewCandidateFields, ['serialNumbered']);
  assert.deepEqual(review.diagnostics.manualReviewCandidateCountByField, { serialNumbered: 1 });
  assert.equal(review.diagnostics.manualReviewReasonCodesByField.serialNumbered.includes('manual_review_required'), true);
  assert.equal(Object.hasOwn(review.diagnostics.ineligibilityReasonCodesByField, 'serialNumbered'), false);
  assert.equal(
    review.diagnostics.ineligibilityReasonCodesByField.autographState.includes(
      'absence_sensitive_candidate_requires_manual_admission_review'
    ),
    true
  );
});

test('A5.14 excludes unknown provenance, malformed values, and non-allowlisted fields', () => {
  const review = reviewTitleProviderCandidateAdmissionEligibility({
    candidateArtifact: candidateArtifact({
      candidates: [
        candidate({ field: 'notAllowed', normalizedCandidateValue: 'secret' }),
        candidate({ provenanceCategory: 'raw_provider_payload' }),
        candidate({ field: 'year', normalizedCandidateValue: { value: 2024 } })
      ]
    }),
    sourceReadiness: sourceReadiness()
  });
  const serialized = JSON.stringify(review);

  assert.equal(
    review.diagnostics.admissionEligibilityClassificationFrequency[
      ELIGIBILITY_CLASSIFICATIONS.INELIGIBLE_FIELD_NOT_ALLOWLISTED
    ],
    1
  );
  assert.equal(
    review.diagnostics.admissionEligibilityClassificationFrequency[
      ELIGIBILITY_CLASSIFICATIONS.INELIGIBLE_UNSUPPORTED_PROVENANCE
    ],
    1
  );
  assert.equal(
    review.diagnostics.admissionEligibilityClassificationFrequency[
      ELIGIBILITY_CLASSIFICATIONS.INELIGIBLE_MALFORMED_OR_UNVERIFIABLE
    ],
    1
  );
  assert.deepEqual(review.diagnostics.eligibleCandidateFields, []);
  assert.equal(serialized.includes('secret'), false);
  assert.equal(serialized.includes('[object Object]'), false);
});

test('A5.14 is deterministic, immutable, bounded, and preserves sorted allowlisted diagnostics', () => {
  const candidates = Array.from({ length: MAX_REVIEW_CANDIDATES + 4 }, (_, index) => candidate({
    field: index % 2 === 0 ? 'cardNumber' : 'parallel',
    normalizedCandidateValue: index % 2 === 0 ? String(index + 1) : `parallel-${index}`
  }));
  const input = {
    candidateArtifact: candidateArtifact({ candidates }),
    sourceReadiness: sourceReadiness()
  };
  const first = reviewTitleProviderCandidateAdmissionEligibility(input);
  const second = reviewTitleProviderCandidateAdmissionEligibility(input);

  assert.equal(first.admissionEligibilityReviewFingerprint, second.admissionEligibilityReviewFingerprint);
  assert.equal(first.reviews.length, MAX_REVIEW_CANDIDATES);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(first.diagnostics.eligibilityAggregateConsistencyStatus, 'consistent');
  assert.deepEqual(first.diagnostics.eligibilityAggregateConsistencyReasonCodes, ['aggregate_consistency_ok']);
  assert.deepEqual(Object.keys(first.diagnostics.admissionEligibilityClassificationFrequency), [
    ELIGIBILITY_CLASSIFICATIONS.ELIGIBLE_FOR_FUTURE_DETERMINISTIC_ADMISSION
  ]);
  assert.deepEqual(first.diagnostics.eligibleCandidateFields, ['cardNumber', 'parallel']);
  assert.deepEqual(ELIGIBILITY_CLASSIFICATION_ORDER, [...ELIGIBILITY_CLASSIFICATION_ORDER]);
});

test('A5.14 module imports no production runtime, persistence, notification, scanner, purchase, or server code', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'validation', 'titleProviderCandidateAdmissionEligibilityReview.js'),
    'utf8'
  );
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
    'offer',
    'fetch('
  ];

  for (const token of forbidden) {
    assert.equal(source.includes(token), false, `forbidden token present: ${token}`);
  }
});
