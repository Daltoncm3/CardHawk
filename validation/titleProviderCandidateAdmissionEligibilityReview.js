'use strict';

const {
  asArray,
  asObject,
  fingerprint,
  unique
} = require('./canonicalValidationCore');
const {
  CANDIDATE_ADMISSION_STATUS,
  CANDIDATE_CONFLICT_STATUSES,
  PROVENANCE_CATEGORIES,
  SCHEMA_VERSION: CANDIDATE_SCHEMA_VERSION
} = require('./titleProviderEvidenceCandidateLayer');
const {
  SUPPORTED_FIELDS
} = require('./multimodalSoldIdentityEvidencePilot');

const SOURCE = 'title_provider_candidate_admission_eligibility_review';
const VERSION = '0.1.0';
const SCHEMA_VERSION = '1.0.0';
const MAX_REVIEW_CANDIDATES = 16;

const ELIGIBILITY_CLASSIFICATIONS = Object.freeze({
  ELIGIBLE_FOR_FUTURE_DETERMINISTIC_ADMISSION: 'ELIGIBLE_FOR_FUTURE_DETERMINISTIC_ADMISSION',
  INELIGIBLE_CONFLICT_UNRESOLVED: 'INELIGIBLE_CONFLICT_UNRESOLVED',
  INELIGIBLE_ABSENCE_SENSITIVE: 'INELIGIBLE_ABSENCE_SENSITIVE',
  INELIGIBLE_UNSUPPORTED_PROVENANCE: 'INELIGIBLE_UNSUPPORTED_PROVENANCE',
  INELIGIBLE_MALFORMED_OR_UNVERIFIABLE: 'INELIGIBLE_MALFORMED_OR_UNVERIFIABLE',
  INELIGIBLE_FIELD_NOT_ALLOWLISTED: 'INELIGIBLE_FIELD_NOT_ALLOWLISTED',
  INELIGIBLE_PROVISIONAL_SALE: 'INELIGIBLE_PROVISIONAL_SALE',
  MANUAL_REVIEW_REQUIRED: 'MANUAL_REVIEW_REQUIRED'
});

const ELIGIBILITY_CLASSIFICATION_ORDER = Object.freeze(Object.values(ELIGIBILITY_CLASSIFICATIONS));

const ELIGIBILITY_REASON_CODES = Object.freeze([
  'aggregate_consistency_ok',
  'absence_sensitive_candidate_requires_manual_admission_review',
  'candidate_agreement_is_not_admission',
  'candidate_only_not_admitted',
  'eligibility_classification_count_mismatch',
  'eligibility_disposition_count_mismatch',
  'field_allowlisted',
  'future_deterministic_admission_candidate',
  'malformed_candidate_artifact',
  'manual_review_required',
  'provenance_allowlisted',
  'provisional_sale_not_canonical_ready',
  'source_confirmed_true_sold_price_ready',
  'unsupported_identity_field',
  'unsupported_provenance_category',
  'unresolved_candidate_conflict',
  'value_malformed_or_unverifiable'
]);

const ABSENCE_SENSITIVE_FIELDS = Object.freeze([
  'autographState',
  'memorabiliaState',
  'serialNumbered',
  'rawOrGraded',
  'rookieDesignation'
]);

const FIELD_PROVENANCE_ALLOWLIST = Object.freeze(Object.fromEntries(SUPPORTED_FIELDS.map((field) => [
  field,
  PROVENANCE_CATEGORIES
])));

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s/#.'-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasKnown(value) {
  return value !== undefined && value !== null && value !== '' && value !== 'unknown';
}

function arrayFrom(value) {
  return Array.isArray(value) ? value : [];
}

function candidateValueWellFormed(field, value) {
  if (!SUPPORTED_FIELDS.includes(field) || !hasKnown(value)) return false;
  if (field === 'year') return /^(19\d{2}|20\d{2}(?:-\d{2})?)$/.test(String(value));
  if (field === 'printRun') return Number.isFinite(Number(value)) && Number(value) > 0;
  if (['autographState', 'memorabiliaState', 'serialNumbered', 'rookieDesignation'].includes(field)) {
    return value === true;
  }
  if (field === 'rawOrGraded') return normalizeText(value) === 'graded';
  if (['grade'].includes(field)) return /^[0-9](?:\.[0-9])?$|^10$|^auth$/i.test(String(value));
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function isAbsenceSensitiveNegative(field, value) {
  if (!ABSENCE_SENSITIVE_FIELDS.includes(field)) return false;
  if (value === false) return true;
  if (field === 'rawOrGraded' && normalizeText(value) === 'raw') return true;
  return false;
}

function confirmedTrueSoldPriceReady(sourceReadiness = {}) {
  return sourceReadiness.confirmedTrueSoldPriceReady === true ||
    sourceReadiness.canonicalReadySoldPrice === true ||
    (sourceReadiness.evidenceType === 'true_sold' && sourceReadiness.status === 'active_evidence');
}

function classificationForCandidate(candidate = {}, context = {}) {
  const field = String(candidate.field || '').trim();
  const provenanceCategory = String(candidate.provenanceCategory || '').trim();
  const value = candidate.normalizedCandidateValue;
  const sourceReady = confirmedTrueSoldPriceReady(context.sourceReadiness);

  if (!sourceReady) return ELIGIBILITY_CLASSIFICATIONS.INELIGIBLE_PROVISIONAL_SALE;
  if (!SUPPORTED_FIELDS.includes(field)) return ELIGIBILITY_CLASSIFICATIONS.INELIGIBLE_FIELD_NOT_ALLOWLISTED;
  if (!FIELD_PROVENANCE_ALLOWLIST[field]?.includes(provenanceCategory)) {
    return ELIGIBILITY_CLASSIFICATIONS.INELIGIBLE_UNSUPPORTED_PROVENANCE;
  }
  if (
    candidate.schemaVersion !== CANDIDATE_SCHEMA_VERSION ||
    candidate.admissionStatus !== CANDIDATE_ADMISSION_STATUS
  ) {
    return ELIGIBILITY_CLASSIFICATIONS.INELIGIBLE_MALFORMED_OR_UNVERIFIABLE;
  }
  if (isAbsenceSensitiveNegative(field, value)) {
    return ELIGIBILITY_CLASSIFICATIONS.INELIGIBLE_ABSENCE_SENSITIVE;
  }
  if (!candidateValueWellFormed(field, value)) {
    return ELIGIBILITY_CLASSIFICATIONS.INELIGIBLE_MALFORMED_OR_UNVERIFIABLE;
  }
  if (candidate.conflictStatus === CANDIDATE_CONFLICT_STATUSES.UNRESOLVED) {
    return ELIGIBILITY_CLASSIFICATIONS.INELIGIBLE_CONFLICT_UNRESOLVED;
  }
  if (ABSENCE_SENSITIVE_FIELDS.includes(field)) {
    return ELIGIBILITY_CLASSIFICATIONS.MANUAL_REVIEW_REQUIRED;
  }
  return ELIGIBILITY_CLASSIFICATIONS.ELIGIBLE_FOR_FUTURE_DETERMINISTIC_ADMISSION;
}

function reasonCodesForCandidate(candidate = {}, classification, context = {}) {
  const reasonCodes = ['candidate_only_not_admitted'];
  if (!confirmedTrueSoldPriceReady(context.sourceReadiness)) reasonCodes.push('provisional_sale_not_canonical_ready');
  if (SUPPORTED_FIELDS.includes(candidate.field)) reasonCodes.push('field_allowlisted');
  if (FIELD_PROVENANCE_ALLOWLIST[candidate.field]?.includes(candidate.provenanceCategory)) reasonCodes.push('provenance_allowlisted');
  if (arrayFrom(candidate.reasonCodes).includes('title_provider_metadata_agreement')) {
    reasonCodes.push('candidate_agreement_is_not_admission');
  }
  if (classification === ELIGIBILITY_CLASSIFICATIONS.ELIGIBLE_FOR_FUTURE_DETERMINISTIC_ADMISSION) {
    reasonCodes.push('source_confirmed_true_sold_price_ready');
    reasonCodes.push('future_deterministic_admission_candidate');
  }
  if (classification === ELIGIBILITY_CLASSIFICATIONS.INELIGIBLE_FIELD_NOT_ALLOWLISTED) reasonCodes.push('unsupported_identity_field');
  if (classification === ELIGIBILITY_CLASSIFICATIONS.INELIGIBLE_UNSUPPORTED_PROVENANCE) reasonCodes.push('unsupported_provenance_category');
  if (classification === ELIGIBILITY_CLASSIFICATIONS.INELIGIBLE_MALFORMED_OR_UNVERIFIABLE) reasonCodes.push('value_malformed_or_unverifiable');
  if (classification === ELIGIBILITY_CLASSIFICATIONS.INELIGIBLE_CONFLICT_UNRESOLVED) reasonCodes.push('unresolved_candidate_conflict');
  if (classification === ELIGIBILITY_CLASSIFICATIONS.INELIGIBLE_ABSENCE_SENSITIVE) {
    reasonCodes.push('absence_sensitive_candidate_requires_manual_admission_review');
  }
  if (classification === ELIGIBILITY_CLASSIFICATIONS.MANUAL_REVIEW_REQUIRED) reasonCodes.push('manual_review_required');
  return unique(reasonCodes)
    .filter((reason) => ELIGIBILITY_REASON_CODES.includes(reason))
    .sort();
}

function buildCandidateReview(candidate = {}, context = {}, index = 0) {
  const classification = classificationForCandidate(candidate, context);
  const review = {
    reviewId: `a5_14_candidate_review_${index + 1}`,
    field: SUPPORTED_FIELDS.includes(candidate.field) ? candidate.field : 'unknown',
    provenanceCategory: PROVENANCE_CATEGORIES.includes(candidate.provenanceCategory) ? candidate.provenanceCategory : 'unknown',
    eligibilityClassification: classification,
    reasonCodes: reasonCodesForCandidate(candidate, classification, context),
    admissionStatus: CANDIDATE_ADMISSION_STATUS,
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
  review.reviewFingerprint = fingerprint(review);
  return deepFreeze(review);
}

function increment(map, key, allowlist = null) {
  if (!key) return;
  if (allowlist && !allowlist.includes(key)) return;
  map[key] = (map[key] || 0) + 1;
}

function sortedCountMap(map = {}, allowlist = null) {
  const allowed = allowlist ? new Set(allowlist) : null;
  return deepFreeze(Object.fromEntries(Object.entries(asObject(map))
    .filter(([key, value]) => (!allowed || allowed.has(key)) && Number(value) > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => [key, Math.max(0, Math.floor(Number(value) || 0))])));
}

function groupedReasonCodes(reviews = []) {
  const grouped = {};
  for (const review of reviews) {
    if (!SUPPORTED_FIELDS.includes(review.field)) continue;
    if (!grouped[review.field]) grouped[review.field] = new Set();
    for (const reason of arrayFrom(review.reasonCodes)) {
      if (ELIGIBILITY_REASON_CODES.includes(reason)) grouped[review.field].add(reason);
    }
  }
  return deepFreeze(Object.fromEntries(Object.entries(grouped)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([field, reasons]) => [field, Array.from(reasons).sort()])));
}

function countByField(reviews = []) {
  const counts = {};
  for (const review of reviews) {
    if (SUPPORTED_FIELDS.includes(review.field)) increment(counts, review.field, SUPPORTED_FIELDS);
  }
  return sortedCountMap(counts, SUPPORTED_FIELDS);
}

function sumCounts(map = {}) {
  return Object.values(asObject(map))
    .reduce((sum, value) => sum + Math.max(0, Math.floor(Number(value) || 0)), 0);
}

function buildAggregateConsistency(diagnostics = {}, candidateCountReviewed = 0) {
  const classificationTotal = sumCounts(diagnostics.admissionEligibilityClassificationFrequency);
  const eligibleTotal = sumCounts(diagnostics.eligibleCandidateCountByField);
  const manualReviewTotal = sumCounts(diagnostics.manualReviewCandidateCountByField);
  const ineligibleTotal = sumCounts(diagnostics.ineligibleCandidateCountByField);
  const reviewedTotal = Math.max(0, Math.floor(Number(candidateCountReviewed) || 0));
  const reasonCodes = [];

  if (classificationTotal !== reviewedTotal) reasonCodes.push('eligibility_classification_count_mismatch');
  if ((eligibleTotal + manualReviewTotal + ineligibleTotal) !== reviewedTotal) {
    reasonCodes.push('eligibility_disposition_count_mismatch');
  }
  if (!reasonCodes.length) reasonCodes.push('aggregate_consistency_ok');

  return deepFreeze({
    eligibilityAggregateConsistencyStatus: reasonCodes.length === 1 && reasonCodes[0] === 'aggregate_consistency_ok'
      ? 'consistent'
      : 'invalid',
    eligibilityAggregateConsistencyReasonCodes: reasonCodes
  });
}

function fieldsForClassifications(reviews = [], classifications = []) {
  const allowed = new Set(classifications);
  return unique(reviews
    .filter((review) => allowed.has(review.eligibilityClassification))
    .map((review) => review.field)
    .filter((field) => SUPPORTED_FIELDS.includes(field)))
    .sort();
}

function buildDiagnostics(reviews = []) {
  const frequency = {};
  const eligibleCounts = {};
  const manualReviewReviews = reviews.filter((review) => (
    review.eligibilityClassification === ELIGIBILITY_CLASSIFICATIONS.MANUAL_REVIEW_REQUIRED
  ));
  const ineligibleReviews = reviews.filter((review) => [
    ELIGIBILITY_CLASSIFICATIONS.INELIGIBLE_CONFLICT_UNRESOLVED,
    ELIGIBILITY_CLASSIFICATIONS.INELIGIBLE_ABSENCE_SENSITIVE,
    ELIGIBILITY_CLASSIFICATIONS.INELIGIBLE_UNSUPPORTED_PROVENANCE,
    ELIGIBILITY_CLASSIFICATIONS.INELIGIBLE_MALFORMED_OR_UNVERIFIABLE,
    ELIGIBILITY_CLASSIFICATIONS.INELIGIBLE_FIELD_NOT_ALLOWLISTED,
    ELIGIBILITY_CLASSIFICATIONS.INELIGIBLE_PROVISIONAL_SALE
  ].includes(review.eligibilityClassification));
  const eligible = fieldsForClassifications(reviews, [
    ELIGIBILITY_CLASSIFICATIONS.ELIGIBLE_FOR_FUTURE_DETERMINISTIC_ADMISSION
  ]);
  const ineligible = fieldsForClassifications(reviews, [
    ELIGIBILITY_CLASSIFICATIONS.INELIGIBLE_CONFLICT_UNRESOLVED,
    ELIGIBILITY_CLASSIFICATIONS.INELIGIBLE_ABSENCE_SENSITIVE,
    ELIGIBILITY_CLASSIFICATIONS.INELIGIBLE_UNSUPPORTED_PROVENANCE,
    ELIGIBILITY_CLASSIFICATIONS.INELIGIBLE_MALFORMED_OR_UNVERIFIABLE,
    ELIGIBILITY_CLASSIFICATIONS.INELIGIBLE_FIELD_NOT_ALLOWLISTED,
    ELIGIBILITY_CLASSIFICATIONS.INELIGIBLE_PROVISIONAL_SALE
  ]);
  const manualReview = fieldsForClassifications(reviews, [
    ELIGIBILITY_CLASSIFICATIONS.MANUAL_REVIEW_REQUIRED
  ]);

  for (const review of reviews) {
    increment(frequency, review.eligibilityClassification, ELIGIBILITY_CLASSIFICATION_ORDER);
    if (review.eligibilityClassification === ELIGIBILITY_CLASSIFICATIONS.ELIGIBLE_FOR_FUTURE_DETERMINISTIC_ADMISSION) {
      increment(eligibleCounts, review.field, SUPPORTED_FIELDS);
    }
  }

  const diagnostics = {
    admissionEligibilityClassificationFrequency: sortedCountMap(frequency, ELIGIBILITY_CLASSIFICATION_ORDER),
    eligibleCandidateFields: eligible,
    eligibleCandidateCountByField: sortedCountMap(eligibleCounts, SUPPORTED_FIELDS),
    ineligibleCandidateFields: ineligible,
    ineligibleCandidateCountByField: countByField(ineligibleReviews),
    ineligibilityReasonCodesByField: groupedReasonCodes(ineligibleReviews),
    unresolvedAdmissionConflictFields: fieldsForClassifications(reviews, [
      ELIGIBILITY_CLASSIFICATIONS.INELIGIBLE_CONFLICT_UNRESOLVED
    ]),
    manualReviewCandidateFields: manualReview,
    manualReviewCandidateCountByField: countByField(manualReviewReviews),
    manualReviewReasonCodesByField: groupedReasonCodes(manualReviewReviews),
    transactionsWithFutureAdmissionEligibleCandidates: eligible.length ? 1 : 0,
    futureDeterministicAdmissionCouldMateriallyHelp: eligible.length > 0
  };
  return deepFreeze({
    ...diagnostics,
    ...buildAggregateConsistency(diagnostics, reviews.length)
  });
}

function reviewTitleProviderCandidateAdmissionEligibility(input = {}) {
  const candidateArtifact = asObject(input.candidateArtifact);
  const context = {
    sourceReadiness: asObject(input.sourceReadiness),
    identityDiagnostics: asObject(input.identityDiagnostics)
  };
  const candidates = asArray(candidateArtifact.candidates).slice(0, MAX_REVIEW_CANDIDATES);
  const reviews = candidates.map((candidate, index) => buildCandidateReview(asObject(candidate), context, index));
  const artifact = {
    source: SOURCE,
    version: VERSION,
    schemaVersion: SCHEMA_VERSION,
    candidateLayerFingerprint: candidateArtifact.candidateLayerFingerprint || null,
    candidateCountReviewed: reviews.length,
    reviews,
    diagnostics: buildDiagnostics(reviews),
    nonPersistent: true,
    writesProductionStore: false,
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
  artifact.admissionEligibilityReviewFingerprint = fingerprint(artifact);
  return deepFreeze(artifact);
}

module.exports = {
  SOURCE,
  VERSION,
  SCHEMA_VERSION,
  MAX_REVIEW_CANDIDATES,
  ELIGIBILITY_CLASSIFICATIONS,
  ELIGIBILITY_CLASSIFICATION_ORDER,
  ELIGIBILITY_REASON_CODES,
  FIELD_PROVENANCE_ALLOWLIST,
  reviewTitleProviderCandidateAdmissionEligibility
};
