'use strict';

const {
  asArray,
  asObject,
  fingerprint,
  unique
} = require('./canonicalValidationCore');
const {
  MATERIAL_FIELDS
} = require('./cardApiIdentityResolutionPilot');
const {
  RESOLUTION_CLASSIFICATIONS,
  resolveCardApiTransactionIdentity
} = require('./cardApiIdentityResolutionPilot');
const {
  SUPPORTED_FIELDS
} = require('./multimodalSoldIdentityEvidencePilot');
const {
  CANDIDATE_ADMISSION_STATUS,
  CANDIDATE_CONFLICT_STATUSES,
  PROVENANCE_CATEGORIES
} = require('./titleProviderEvidenceCandidateLayer');
const {
  ELIGIBILITY_CLASSIFICATIONS,
  ELIGIBILITY_CLASSIFICATION_ORDER
} = require('./titleProviderCandidateAdmissionEligibilityReview');

const SOURCE = 'title_provider_shadow_admission_simulation';
const VERSION = '0.1.0';
const SCHEMA_VERSION = '1.0.0';
const MAX_SHADOW_CANDIDATES = 16;

const SHADOW_SIMULATION_CONSISTENCY_STATUSES = Object.freeze({
  CONSISTENT: 'consistent',
  INVALID: 'invalid'
});

const SHADOW_SIMULATION_CONSISTENCY_REASON_CODES = Object.freeze([
  'shadow_actual_artifact_mutation_detected',
  'shadow_actual_authority_changed',
  'shadow_applied_exceeds_eligible',
  'shadow_applied_source_violation',
  'shadow_consistency_ok',
  'shadow_considered_count_mismatch',
  'shadow_manual_or_ineligible_applied',
  'shadow_provisional_candidate_applied'
]);

const SHADOW_CANDIDATE_EXCLUSION_REASON_CODES = Object.freeze([
  'aggregate_consistency_invalid',
  'candidate_not_future_eligible',
  'duplicate_candidate',
  'existing_value_conflict',
  'field_value_disagreement',
  'ineligible_candidate_excluded',
  'malformed_candidate_excluded',
  'manual_review_candidate_excluded',
  'provider_candidate_already_represented',
  'provisional_price_not_shadow_ready',
  'title_candidate_already_represented',
  'title_candidate_channel_unavailable',
  'unsupported_provenance',
  'unknown_field_or_value',
  'unresolved_candidate_conflict'
]);

const MANUAL_REVIEW_ONLY_FIELDS = Object.freeze([
  'autographState',
  'memorabiliaState',
  'rookieDesignation',
  'serialNumbered',
  'rawOrGraded'
]);

const PROVIDER_METADATA_FIELD_ALIASES = Object.freeze({
  sport: 'sport',
  subjectName: 'player',
  year: 'year',
  manufacturer: 'brand',
  product: 'product',
  setName: 'setName',
  cardNumber: 'cardNumber',
  parallel: 'parallel',
  rookieDesignation: 'rookie',
  autographState: 'autograph',
  memorabiliaState: 'memorabilia',
  serialNumbered: 'serialNumbered',
  printRun: 'printRun',
  rawOrGraded: 'rawOrGraded',
  gradeCompany: 'gradeCompany',
  grade: 'grade'
});

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s/#.'-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeCandidateValue(field, value) {
  if (value === undefined || value === null || value === '' || value === 'unknown') return null;
  if (typeof value === 'boolean') return value === true ? 'true' : null;
  if (field === 'cardNumber') return normalizeText(value).replace(/^#/, '') || null;
  if (field === 'printRun') {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? String(Math.floor(numeric)) : null;
  }
  if (field === 'year') {
    const match = String(value).match(/^(19\d{2}|20\d{2}(?:-\d{2})?)$/);
    return match ? match[1] : null;
  }
  return normalizeText(value) || null;
}

function hasKnownValue(value) {
  return value !== undefined && value !== null && value !== '' && value !== 'unknown';
}

function confirmedTrueSoldPriceReady(sourceReadiness = {}) {
  return sourceReadiness.confirmedTrueSoldPriceReady === true ||
    sourceReadiness.canonicalReadySoldPrice === true ||
    (sourceReadiness.evidenceType === 'true_sold' && sourceReadiness.status === 'active_evidence');
}

function sortedCountMap(map = {}, allowlist = null) {
  const allowed = allowlist ? new Set(allowlist) : null;
  return deepFreeze(Object.fromEntries(Object.entries(asObject(map))
    .filter(([key, value]) => (!allowed || allowed.has(key)) && Number(value) > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => [key, Math.max(0, Math.floor(Number(value) || 0))])));
}

function increment(map, key, amount = 1, allowlist = null) {
  const safeKey = String(key || '').trim();
  if (!safeKey) return;
  if (allowlist && !allowlist.includes(safeKey)) return;
  map[safeKey] = (map[safeKey] || 0) + Math.max(0, Math.floor(Number(amount) || 0));
}

function sortedFieldArray(values = [], allowlist = SUPPORTED_FIELDS) {
  const allowed = new Set(allowlist);
  return deepFreeze(unique(asArray(values)
    .map((value) => String(value || '').trim())
    .filter((value) => allowed.has(value)))
    .sort());
}

function countFields(fields = [], allowlist = MATERIAL_FIELDS) {
  const counts = {};
  for (const field of asArray(fields)) increment(counts, field, 1, allowlist);
  return sortedCountMap(counts, allowlist);
}

function getBeforeMissingFields(identityDiagnostics = {}) {
  return sortedFieldArray([
    ...asArray(identityDiagnostics.missingMaterialFieldsAfter),
    ...asArray(identityDiagnostics.missingMaterialFields),
    ...asArray(identityDiagnostics.exactIdentityBlockerFields)
  ], MATERIAL_FIELDS);
}

function reviewForCandidate(reviews = [], index = 0, candidate = {}) {
  const review = asObject(reviews[index]);
  if (review.field === candidate.field) return review;
  return asObject(reviews.find((entry) => entry.field === candidate.field) || review);
}

function isEligibleReview(review = {}) {
  return review.eligibilityClassification === ELIGIBILITY_CLASSIFICATIONS.ELIGIBLE_FOR_FUTURE_DETERMINISTIC_ADMISSION;
}

function exclusionReasonForReview(review = {}) {
  if (review.eligibilityClassification === ELIGIBILITY_CLASSIFICATIONS.MANUAL_REVIEW_REQUIRED) {
    return 'manual_review_candidate_excluded';
  }
  if (ELIGIBILITY_CLASSIFICATION_ORDER.includes(review.eligibilityClassification)) {
    return 'ineligible_candidate_excluded';
  }
  return 'candidate_not_future_eligible';
}

function buildInitialSimulationState() {
  return {
    candidatesConsidered: 0,
    appliedCandidates: [],
    excludedCandidates: [],
    exclusionCounts: {},
    candidatesByField: {},
    eligibleCountByField: {}
  };
}

function normalizedExistingValue(field, value) {
  return normalizeCandidateValue(field, value);
}

function canonicalIdentityValueForField(identityResult = {}, field) {
  const normalized = asObject(identityResult.canonicalIdentity?.normalized);
  const fieldMap = {
    sport: normalized.sport,
    subjectName: normalized.subject?.name,
    year: normalized.year,
    manufacturer: normalized.manufacturer,
    product: normalized.product,
    setName: normalized.setName,
    cardNumber: normalized.cardNumber,
    parallel: normalized.parallel,
    rookieDesignation: normalized.rookieDesignation,
    autographState: normalized.autograph?.state,
    memorabiliaState: normalized.memorabilia?.state,
    serialNumbered: normalized.serialNumbered,
    printRun: normalized.printRun,
    rawOrGraded: normalized.rawOrGraded,
    gradeCompany: normalized.grading?.company,
    grade: normalized.grading?.grade
  };
  return fieldMap[field];
}

function titleAlreadyRepresentsCandidate(candidate = {}, existingIdentityResult = {}) {
  const field = String(candidate.field || '').trim();
  const candidateValue = normalizeCandidateValue(field, candidate.normalizedCandidateValue);
  const titleValue = asObject(existingIdentityResult.fieldProvenance)[field]?.titleValue;
  return candidateValue !== null && normalizedExistingValue(field, titleValue) === candidateValue;
}

function existingValuesForProviderCandidate(input = {}, candidate = {}) {
  const transaction = asObject(input.transaction);
  const existingIdentityResult = asObject(input.existingIdentityResult);
  const field = String(candidate.field || '').trim();
  const targetField = PROVIDER_METADATA_FIELD_ALIASES[field];
  const parsedIdentity = asObject(transaction.parsedIdentity);
  const provenance = asObject(existingIdentityResult.fieldProvenance)[field] || {};

  return {
    targetField,
    parsedIdentityValue: targetField ? parsedIdentity[targetField] : undefined,
    providerValue: provenance.providerValue,
    titleValue: provenance.titleValue,
    resolverValue: canonicalIdentityValueForField(existingIdentityResult, field)
  };
}

function evaluateProviderCandidateAgainstExisting(input = {}, candidate = {}) {
  const field = String(candidate.field || '').trim();
  const candidateValue = normalizeCandidateValue(field, candidate.normalizedCandidateValue);
  const existing = existingValuesForProviderCandidate(input, candidate);

  if (!existing.targetField) return { status: 'unknown_field_or_value' };

  const parsedValue = normalizedExistingValue(field, existing.parsedIdentityValue);
  const providerValue = normalizedExistingValue(field, existing.providerValue);
  const titleValue = normalizedExistingValue(field, existing.titleValue);
  const resolverValue = normalizedExistingValue(field, existing.resolverValue);
  const knownExistingValues = [parsedValue, providerValue, titleValue, resolverValue]
    .filter((value) => value !== null);

  if (knownExistingValues.some((value) => value !== candidateValue)) {
    return { status: 'existing_value_conflict', targetField: existing.targetField };
  }
  if (knownExistingValues.some((value) => value === candidateValue)) {
    return { status: 'provider_candidate_already_represented', targetField: existing.targetField };
  }
  if (hasKnownValue(existing.parsedIdentityValue)) {
    return { status: 'existing_value_conflict', targetField: existing.targetField };
  }

  return { status: 'insertable', targetField: existing.targetField };
}

function excludeCandidate(state, candidate = {}, reasonCode) {
  state.excludedCandidates.push({ candidate, reasonCode });
  increment(state.exclusionCounts, reasonCode, 1, SHADOW_CANDIDATE_EXCLUSION_REASON_CODES);
}

function considerCandidate(state, candidate = {}, review = {}, context = {}) {
  const field = String(candidate.field || '').trim();
  const normalizedValue = normalizeCandidateValue(field, candidate.normalizedCandidateValue);
  const sourceReady = context.sourceReady === true;
  const aggregateConsistent = context.aggregateConsistent === true;

  state.candidatesConsidered += 1;
  if (!isEligibleReview(review)) return excludeCandidate(state, candidate, exclusionReasonForReview(review));
  increment(state.eligibleCountByField, field, 1, SUPPORTED_FIELDS);

  if (!aggregateConsistent) return excludeCandidate(state, candidate, 'aggregate_consistency_invalid');
  if (!sourceReady) return excludeCandidate(state, candidate, 'provisional_price_not_shadow_ready');
  if (!SUPPORTED_FIELDS.includes(field) || normalizedValue === null || candidate.admissionStatus !== CANDIDATE_ADMISSION_STATUS) {
    return excludeCandidate(state, candidate, 'unknown_field_or_value');
  }
  if (!PROVENANCE_CATEGORIES.includes(candidate.provenanceCategory)) {
    return excludeCandidate(state, candidate, 'unsupported_provenance');
  }
  if (candidate.conflictStatus === CANDIDATE_CONFLICT_STATUSES.UNRESOLVED) {
    return excludeCandidate(state, candidate, 'unresolved_candidate_conflict');
  }
  if (MANUAL_REVIEW_ONLY_FIELDS.includes(field)) {
    return excludeCandidate(state, candidate, 'manual_review_candidate_excluded');
  }
  if (candidate.provenanceCategory === 'explicit_title_evidence') {
    const reason = titleAlreadyRepresentsCandidate(candidate, asObject(context.existingIdentityResult))
      ? 'title_candidate_already_represented'
      : 'title_candidate_channel_unavailable';
    return excludeCandidate(state, candidate, reason);
  }
  if (candidate.provenanceCategory !== 'provider_metadata') {
    return excludeCandidate(state, candidate, 'unsupported_provenance');
  }

  if (!state.candidatesByField[field]) state.candidatesByField[field] = [];
  state.candidatesByField[field].push({
    candidate,
    review,
    normalizedValue
  });
}

function finalizeCandidateApplications(state) {
  const appliedFields = [];
  const shadowConflictFields = [];

  for (const [field, entries] of Object.entries(state.candidatesByField).sort(([left], [right]) => left.localeCompare(right))) {
    const values = unique(entries.map((entry) => entry.normalizedValue)).sort();
    if (values.length !== 1) {
      shadowConflictFields.push(field);
      for (const entry of entries) excludeCandidate(state, entry.candidate, 'field_value_disagreement');
      continue;
    }
    const evaluations = entries.map((entry) => ({
      ...entry,
      evaluation: evaluateProviderCandidateAgainstExisting(state.inputContext, entry.candidate)
    }));
    const blockingEvaluation = evaluations.find((entry) => entry.evaluation.status === 'existing_value_conflict');
    if (blockingEvaluation) {
      shadowConflictFields.push(field);
      for (const entry of evaluations) excludeCandidate(state, entry.candidate, 'existing_value_conflict');
      continue;
    }
    const representedEvaluation = evaluations.find((entry) => entry.evaluation.status === 'provider_candidate_already_represented');
    if (representedEvaluation) {
      for (const entry of evaluations) excludeCandidate(state, entry.candidate, 'provider_candidate_already_represented');
      continue;
    }
    const unmappedEvaluation = evaluations.find((entry) => entry.evaluation.status !== 'insertable');
    if (unmappedEvaluation) {
      for (const entry of evaluations) excludeCandidate(state, entry.candidate, unmappedEvaluation.evaluation.status);
      continue;
    }
    const [first, ...duplicates] = evaluations;
    appliedFields.push(field);
    state.appliedCandidates.push({
      ...first,
      targetField: first.evaluation.targetField,
      insertedValue: first.normalizedValue
    });
    for (const entry of duplicates) excludeCandidate(state, entry.candidate, 'duplicate_candidate');
  }

  return {
    appliedFields: sortedFieldArray(appliedFields, SUPPORTED_FIELDS),
    shadowConflictFields: sortedFieldArray(shadowConflictFields, SUPPORTED_FIELDS)
  };
}

function buildShadowTransaction(input = {}, appliedCandidates = []) {
  const transaction = clone(input.transaction);
  const parsedIdentity = {
    ...asObject(transaction.parsedIdentity)
  };

  for (const entry of appliedCandidates) {
    const candidate = asObject(entry.candidate);
    if (candidate.provenanceCategory !== 'provider_metadata') continue;
    const targetField = entry.targetField || PROVIDER_METADATA_FIELD_ALIASES[candidate.field];
    if (!targetField) continue;
    parsedIdentity[targetField] = entry.insertedValue;
  }

  if (Object.keys(parsedIdentity).length) transaction.parsedIdentity = parsedIdentity;
  return transaction;
}

function resolveShadowIdentity(input = {}, appliedCandidates = []) {
  const shadowTransaction = buildShadowTransaction(input, appliedCandidates);
  return resolveCardApiTransactionIdentity(shadowTransaction, {
    shadowOnly: true,
    source: SOURCE
  });
}

function buildDiagnostics(input = {}, state = {}, finalized = {}, shadowIdentityResult = {}) {
  const identityDiagnostics = asObject(input.identityDiagnostics);
  const sourceReady = confirmedTrueSoldPriceReady(asObject(input.sourceReadiness));
  const aggregateConsistent = input.aggregateConsistent === true;
  const beforeMissing = getBeforeMissingFields(identityDiagnostics);
  const afterMissing = sortedFieldArray(shadowIdentityResult.missingMaterialFields, MATERIAL_FIELDS);
  const afterMissingSet = new Set(afterMissing);
  const appliedFieldSet = new Set(finalized.appliedFields);
  const recovered = beforeMissing.filter((field) => appliedFieldSet.has(field) && !afterMissingSet.has(field));
  const beforeClassification = String(input.existingIdentityResult?.classification || 'UNRESOLVED');
  const afterClassification = String(shadowIdentityResult.classification || beforeClassification);
  const insertedCandidateCount = asArray(state.appliedCandidates).length;
  const exactWouldBeReached = insertedCandidateCount > 0 && afterClassification === RESOLUTION_CLASSIFICATIONS.EXACT;
  const stillRequiresEvidence = afterMissing.length > 0 || finalized.shadowConflictFields.length > 0;

  return {
    shadowSimulationTransactionCount: 1,
    shadowCandidatesConsidered: state.candidatesConsidered,
    shadowCandidatesApplied: state.appliedCandidates.length,
    shadowCandidatesExcluded: state.excludedCandidates.length,
    shadowCandidateExclusionReasonCounts: sortedCountMap(state.exclusionCounts, SHADOW_CANDIDATE_EXCLUSION_REASON_CODES),
    shadowAppliedFields: finalized.appliedFields,
    shadowConflictFields: finalized.shadowConflictFields,
    shadowMissingFieldFrequencyBefore: countFields(beforeMissing, MATERIAL_FIELDS),
    shadowMissingFieldFrequencyAfter: countFields(afterMissing, MATERIAL_FIELDS),
    shadowRecoveredFieldFrequency: countFields(recovered, MATERIAL_FIELDS),
    shadowClassificationCountsBefore: sortedCountMap({ [beforeClassification]: 1 }),
    shadowClassificationCountsAfter: sortedCountMap({ [afterClassification]: 1 }),
    shadowClassificationImprovementCount: beforeClassification !== afterClassification ? 1 : 0,
    shadowExactWouldBeReachedCount: exactWouldBeReached ? 1 : 0,
    shadowCanonicalSoldEvidenceWouldBeStructurallyReadyCount: sourceReady &&
      aggregateConsistent &&
      exactWouldBeReached &&
      shadowIdentityResult.canonicalSoldEvidenceStructurallyReady === true
      ? 1
      : 0,
    shadowTransactionsStillRequiringAdditionalEvidence: stillRequiresEvidence ? 1 : 0,
    shadowOnly: true,
    admittedToProduction: false
  };
}

function validateInvariants(input = {}, state = {}, diagnostics = {}, fingerprintsBefore = {}) {
  const reasonCodes = [];
  const candidateArtifact = asObject(input.candidateArtifact);
  const eligibilityReview = asObject(input.eligibilityReview);
  const identityDiagnostics = asObject(input.identityDiagnostics);
  const transaction = asObject(input.transaction);
  const existingEvidenceResult = asObject(input.existingEvidenceResult);
  const existingIdentityResult = asObject(input.existingIdentityResult);
  const appliedByField = {};

  for (const entry of state.appliedCandidates) increment(appliedByField, entry.candidate.field, 1, SUPPORTED_FIELDS);

  if (state.candidatesConsidered !== (diagnostics.shadowCandidatesApplied + diagnostics.shadowCandidatesExcluded)) {
    reasonCodes.push('shadow_considered_count_mismatch');
  }
  if (state.appliedCandidates.some((entry) => {
    const review = asObject(entry.review);
    return !isEligibleReview(review);
  })) {
    reasonCodes.push('shadow_applied_source_violation');
  }
  if (state.appliedCandidates.some((entry) => MANUAL_REVIEW_ONLY_FIELDS.includes(entry.candidate.field))) {
    reasonCodes.push('shadow_manual_or_ineligible_applied');
  }
  if (!confirmedTrueSoldPriceReady(asObject(input.sourceReadiness)) && state.appliedCandidates.length > 0) {
    reasonCodes.push('shadow_provisional_candidate_applied');
  }
  for (const [field, count] of Object.entries(appliedByField)) {
    if (count > Math.max(0, Math.floor(Number(state.eligibleCountByField[field]) || 0))) {
      reasonCodes.push('shadow_applied_exceeds_eligible');
      break;
    }
  }
  if (
    fingerprint(candidateArtifact) !== fingerprintsBefore.candidateArtifact ||
    fingerprint(eligibilityReview) !== fingerprintsBefore.eligibilityReview ||
    fingerprint(identityDiagnostics) !== fingerprintsBefore.identityDiagnostics ||
    fingerprint(transaction) !== fingerprintsBefore.transaction ||
    fingerprint(existingEvidenceResult) !== fingerprintsBefore.existingEvidenceResult ||
    fingerprint(existingIdentityResult) !== fingerprintsBefore.existingIdentityResult
  ) {
    reasonCodes.push('shadow_actual_artifact_mutation_detected');
  }
  if (
    candidateArtifact.productionImpact !== 'none' ||
    candidateArtifact.decisionImpact !== 'none' ||
    candidateArtifact.executionAuthority !== 'none' ||
    eligibilityReview.productionImpact !== 'none' ||
    eligibilityReview.decisionImpact !== 'none' ||
    eligibilityReview.executionAuthority !== 'none'
  ) {
    reasonCodes.push('shadow_actual_authority_changed');
  }

  return unique(reasonCodes.length ? reasonCodes : ['shadow_consistency_ok'])
    .filter((reason) => SHADOW_SIMULATION_CONSISTENCY_REASON_CODES.includes(reason))
    .sort();
}

function failClosedDiagnostics(diagnostics = {}, reasonCodes = []) {
  return deepFreeze({
    ...diagnostics,
    shadowCandidatesApplied: 0,
    shadowAppliedFields: [],
    shadowRecoveredFieldFrequency: {},
    shadowClassificationCountsAfter: diagnostics.shadowClassificationCountsBefore,
    shadowClassificationImprovementCount: 0,
    shadowExactWouldBeReachedCount: 0,
    shadowCanonicalSoldEvidenceWouldBeStructurallyReadyCount: 0,
    shadowSimulationConsistencyStatus: SHADOW_SIMULATION_CONSISTENCY_STATUSES.INVALID,
    shadowSimulationConsistencyReasonCodes: reasonCodes,
    shadowOnly: true,
    admittedToProduction: false
  });
}

function simulateTitleProviderShadowAdmission(input = {}) {
  const candidateArtifact = asObject(input.candidateArtifact);
  const eligibilityReview = asObject(input.eligibilityReview);
  const identityDiagnostics = asObject(input.identityDiagnostics);
  const sourceReadiness = asObject(input.sourceReadiness);
  const transaction = asObject(input.transaction);
  const existingEvidenceResult = asObject(input.existingEvidenceResult);
  const existingIdentityResult = asObject(input.existingIdentityResult);
  const fingerprintsBefore = {
    transaction: fingerprint(transaction),
    candidateArtifact: fingerprint(candidateArtifact),
    eligibilityReview: fingerprint(eligibilityReview),
    existingEvidenceResult: fingerprint(existingEvidenceResult),
    existingIdentityResult: fingerprint(existingIdentityResult),
    identityDiagnostics: fingerprint(identityDiagnostics)
  };
  const state = buildInitialSimulationState();
  state.inputContext = {
    transaction,
    existingIdentityResult
  };
  const reviews = asArray(eligibilityReview.reviews);
  const aggregateConsistent = eligibilityReview.diagnostics?.eligibilityAggregateConsistencyStatus === 'consistent';

  const candidates = asArray(candidateArtifact.candidates);
  const candidateCount = Math.min(MAX_SHADOW_CANDIDATES, Math.max(candidates.length, reviews.length));
  Array.from({ length: candidateCount })
    .forEach((_, index) => {
      const candidate = asObject(candidates[index]);
      considerCandidate(state, candidate, reviewForCandidate(reviews, index, candidate), {
        sourceReady: confirmedTrueSoldPriceReady(sourceReadiness),
        aggregateConsistent,
        existingIdentityResult
      });
    });

  const finalized = finalizeCandidateApplications(state);
  const shadowIdentityResult = resolveShadowIdentity({
    transaction,
    existingIdentityResult
  }, state.appliedCandidates);
  let diagnostics = buildDiagnostics({
    identityDiagnostics,
    sourceReadiness,
    aggregateConsistent,
    existingIdentityResult
  }, state, finalized, shadowIdentityResult);
  const reasonCodes = validateInvariants({
    transaction,
    candidateArtifact,
    eligibilityReview,
    existingEvidenceResult,
    existingIdentityResult,
    identityDiagnostics,
    sourceReadiness
  }, state, diagnostics, fingerprintsBefore);
  const consistent = reasonCodes.length === 1 && reasonCodes[0] === 'shadow_consistency_ok';
  diagnostics = consistent
    ? deepFreeze({
      ...diagnostics,
      shadowSimulationConsistencyStatus: SHADOW_SIMULATION_CONSISTENCY_STATUSES.CONSISTENT,
      shadowSimulationConsistencyReasonCodes: reasonCodes
    })
    : failClosedDiagnostics(diagnostics, reasonCodes);

  const artifact = {
    source: SOURCE,
    version: VERSION,
    schemaVersion: SCHEMA_VERSION,
    candidateLayerFingerprint: candidateArtifact.candidateLayerFingerprint || null,
    admissionEligibilityReviewFingerprint: eligibilityReview.admissionEligibilityReviewFingerprint || null,
    existingEvidenceResultFingerprint: fingerprintsBefore.existingEvidenceResult,
    existingIdentityResultFingerprint: fingerprintsBefore.existingIdentityResult,
    identityDiagnosticsFingerprint: fingerprintsBefore.identityDiagnostics,
    shadowIdentityResultFingerprint: shadowIdentityResult.resolutionFingerprint || fingerprint(shadowIdentityResult),
    diagnostics,
    nonPersistent: true,
    writesProductionStore: false,
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none',
    shadowOnly: true,
    admittedToProduction: false
  };
  artifact.shadowAdmissionSimulationFingerprint = fingerprint(artifact);
  return deepFreeze(artifact);
}

module.exports = {
  SOURCE,
  VERSION,
  SCHEMA_VERSION,
  MAX_SHADOW_CANDIDATES,
  SHADOW_SIMULATION_CONSISTENCY_STATUSES,
  SHADOW_SIMULATION_CONSISTENCY_REASON_CODES,
  SHADOW_CANDIDATE_EXCLUSION_REASON_CODES,
  simulateTitleProviderShadowAdmission
};
