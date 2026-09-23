'use strict';

const {
  MATERIAL_FIELDS,
  parseTitleIdentity
} = require('./cardApiIdentityResolutionPilot');
const {
  SUPPORTED_FIELDS
} = require('./multimodalSoldIdentityEvidencePilot');
const {
  asArray,
  asObject,
  fingerprint,
  unique
} = require('./canonicalValidationCore');

const SOURCE = 'title_provider_evidence_candidate_layer';
const VERSION = '0.1.0';
const SCHEMA_VERSION = '1.0.0';
const MAX_CANDIDATES = 16;

const PROVENANCE_CATEGORIES = Object.freeze([
  'explicit_title_evidence',
  'provider_metadata'
]);

const CANDIDATE_REASON_CODES = Object.freeze([
  'candidate_only_not_admitted',
  'explicit_title_candidate',
  'provider_metadata_candidate',
  'title_provider_metadata_agreement',
  'title_provider_metadata_conflict'
]);

const CANDIDATE_CONFLICT_STATUSES = Object.freeze({
  NONE: 'none',
  UNRESOLVED: 'unresolved_conflict'
});

const CANDIDATE_ADMISSION_STATUS = 'candidate_only_not_admitted';

const ABSENCE_SENSITIVE_FIELDS = Object.freeze([
  'autographState',
  'memorabiliaState',
  'serialNumbered',
  'rawOrGraded'
]);

const PROVIDER_METADATA_ALIASES = Object.freeze({
  sport: ['sport', 'league'],
  subjectName: ['subjectName', 'player', 'subject', 'athlete'],
  year: ['year'],
  manufacturer: ['manufacturer', 'brand'],
  product: ['product'],
  setName: ['setName', 'set', 'card_set', 'product'],
  cardNumber: ['cardNumber', 'card_number'],
  parallel: ['parallel', 'variation'],
  rookieDesignation: ['rookieDesignation', 'rookie'],
  autographState: ['autographState', 'autograph'],
  memorabiliaState: ['memorabiliaState', 'memorabilia'],
  serialNumbered: ['serialNumbered'],
  printRun: ['printRun', 'print_run'],
  rawOrGraded: ['rawOrGraded'],
  gradeCompany: ['gradeCompany', 'grader'],
  grade: ['grade']
});

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

function normalizeComparable(value) {
  if (typeof value === 'boolean') return value;
  if (value === undefined || value === null || value === '' || value === 'unknown') return null;
  return normalizeText(value).replace(/^#/, '');
}

function hasKnown(value) {
  return value !== undefined && value !== null && value !== '' && value !== 'unknown';
}

function candidateValueForField(field, value) {
  if (!SUPPORTED_FIELDS.includes(field) || !hasKnown(value)) return null;
  if (ABSENCE_SENSITIVE_FIELDS.includes(field)) {
    if (value === false) return null;
    if (field === 'rawOrGraded' && normalizeComparable(value) === 'raw') return null;
  }
  if (field === 'printRun') {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
  }
  if (field === 'year') {
    const match = String(value).match(/^(19\d{2}|20\d{2}(?:-\d{2})?)$/);
    return match ? match[1] : null;
  }
  return value;
}

function titleCandidatesFromText(title = '') {
  const parsed = parseTitleIdentity(title);
  return Object.entries(parsed)
    .filter(([field]) => SUPPORTED_FIELDS.includes(field))
    .map(([field, value]) => [field, candidateValueForField(field, value)])
    .filter(([, value]) => value !== null)
    .map(([field, value]) => buildCandidate(field, value, 'explicit_title_evidence', [
      'candidate_only_not_admitted',
      'explicit_title_candidate'
    ]));
}

function firstProviderValue(providerMetadata = {}, aliases = []) {
  const metadata = asObject(providerMetadata);
  for (const alias of aliases) {
    if (hasKnown(metadata[alias])) return metadata[alias];
  }
  return null;
}

function providerCandidatesFromMetadata(providerMetadata = {}) {
  return Object.entries(PROVIDER_METADATA_ALIASES)
    .map(([field, aliases]) => [field, candidateValueForField(field, firstProviderValue(providerMetadata, aliases))])
    .filter(([, value]) => value !== null)
    .map(([field, value]) => buildCandidate(field, value, 'provider_metadata', [
      'candidate_only_not_admitted',
      'provider_metadata_candidate'
    ]));
}

function buildCandidate(field, value, provenanceCategory, reasonCodes = []) {
  const candidate = {
    schemaVersion: SCHEMA_VERSION,
    field,
    normalizedCandidateValue: value,
    provenanceCategory,
    reasonCodes: unique(reasonCodes).filter((reason) => CANDIDATE_REASON_CODES.includes(reason)).sort(),
    conflictStatus: CANDIDATE_CONFLICT_STATUSES.NONE,
    admissionStatus: CANDIDATE_ADMISSION_STATUS,
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
  candidate.candidateFingerprint = fingerprint(candidate);
  return candidate;
}

function applyConflictStatuses(candidates = []) {
  const byField = {};
  for (const candidate of candidates) {
    if (!byField[candidate.field]) byField[candidate.field] = [];
    byField[candidate.field].push(candidate);
  }

  return candidates.map((candidate) => {
    const comparables = unique(byField[candidate.field].map((entry) => normalizeComparable(entry.normalizedCandidateValue))
      .filter((value) => value !== null));
    const reasonCodes = [...candidate.reasonCodes];
    if (byField[candidate.field].length > 1 && comparables.length === 1) {
      reasonCodes.push('title_provider_metadata_agreement');
    }
    if (comparables.length > 1) {
      reasonCodes.push('title_provider_metadata_conflict');
    }
    const withConflict = {
      ...candidate,
      reasonCodes: unique(reasonCodes).filter((reason) => CANDIDATE_REASON_CODES.includes(reason)).sort(),
      conflictStatus: comparables.length > 1
        ? CANDIDATE_CONFLICT_STATUSES.UNRESOLVED
        : CANDIDATE_CONFLICT_STATUSES.NONE
    };
    withConflict.candidateFingerprint = fingerprint({
      ...withConflict,
      candidateFingerprint: undefined
    });
    return withConflict;
  });
}

function sanitizeFieldArray(values = [], allowlist = SUPPORTED_FIELDS) {
  const allowed = new Set(allowlist);
  return unique(asArray(values)
    .map((value) => String(value || '').trim())
    .filter((value) => allowed.has(value)))
    .sort()
    .slice(0, MAX_CANDIDATES);
}

function sortedCountMap(values = []) {
  const counts = {};
  const allowed = new Set(SUPPORTED_FIELDS);
  for (const rawValue of asArray(values)) {
    const value = String(rawValue || '').trim();
    if (!allowed.has(value)) continue;
    counts[value] = (counts[value] || 0) + 1;
  }
  return deepFreeze(Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right))));
}

function groupedArrayMap(candidates = [], getValues) {
  const grouped = {};
  for (const candidate of candidates) {
    if (!SUPPORTED_FIELDS.includes(candidate.field)) continue;
    if (!grouped[candidate.field]) grouped[candidate.field] = new Set();
    const values = getValues(candidate);
    const normalizedValues = Array.isArray(values) ? values : [values];
    for (const value of normalizedValues) {
      if (value) grouped[candidate.field].add(value);
    }
  }
  return deepFreeze(Object.fromEntries(Object.entries(grouped)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([field, values]) => [field, Array.from(values).sort()])));
}

function publicDiagnosticsFromCandidates(candidates = [], identityDiagnostics = {}) {
  const fields = sanitizeFieldArray(candidates.map((candidate) => candidate.field));
  const conflictFields = sanitizeFieldArray(candidates
    .filter((candidate) => candidate.conflictStatus === CANDIDATE_CONFLICT_STATUSES.UNRESOLVED)
    .map((candidate) => candidate.field));
  const existingMissing = sanitizeFieldArray([
    ...asArray(identityDiagnostics.missingMaterialFieldsAfter),
    ...asArray(identityDiagnostics.missingMaterialFields),
    ...asArray(identityDiagnostics.exactIdentityBlockerFields)
  ], MATERIAL_FIELDS);
  const candidateFieldSet = new Set(fields);
  const conflictFieldSet = new Set(conflictFields);
  const fieldsStillRequiringAdditionalEvidence = sanitizeFieldArray(existingMissing
    .filter((field) => !candidateFieldSet.has(field) || conflictFieldSet.has(field)), MATERIAL_FIELDS);
  const helpfulFields = existingMissing
    .filter((field) => candidateFieldSet.has(field) && !conflictFieldSet.has(field));

  return deepFreeze({
    candidateFields: fields,
    candidateCountByField: sortedCountMap(candidates.map((candidate) => candidate.field)),
    candidateProvenanceCategoriesByField: groupedArrayMap(candidates, (candidate) => candidate.provenanceCategory),
    candidateReasonCodesByField: groupedArrayMap(candidates, (candidate) => candidate.reasonCodes),
    candidateConflictFields: conflictFields,
    fieldsStillRequiringAdditionalEvidence,
    titleOrMetadataCouldMateriallyHelp: helpfulFields.length > 0,
    canonicalSoldEvidenceStructurallyReady: false
  });
}

function buildTitleProviderEvidenceCandidates(input = {}) {
  const title = String(input.normalizedListingTitle || input.listingTitle || '').trim();
  const providerMetadata = asObject(input.providerMetadata);
  const identityDiagnostics = asObject(input.identityDiagnostics);
  const rawCandidates = [
    ...titleCandidatesFromText(title),
    ...providerCandidatesFromMetadata(providerMetadata)
  ];
  const candidates = applyConflictStatuses(rawCandidates)
    .sort((left, right) => `${left.field}:${left.provenanceCategory}`.localeCompare(`${right.field}:${right.provenanceCategory}`))
    .slice(0, MAX_CANDIDATES);
  const diagnostics = publicDiagnosticsFromCandidates(candidates, identityDiagnostics);
  const artifact = {
    source: SOURCE,
    version: VERSION,
    schemaVersion: SCHEMA_VERSION,
    candidates,
    diagnostics,
    nonPersistent: true,
    writesProductionStore: false,
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
  artifact.candidateLayerFingerprint = fingerprint(artifact);
  return deepFreeze(artifact);
}

module.exports = {
  SOURCE,
  VERSION,
  SCHEMA_VERSION,
  MAX_CANDIDATES,
  PROVENANCE_CATEGORIES,
  CANDIDATE_REASON_CODES,
  CANDIDATE_CONFLICT_STATUSES,
  CANDIDATE_ADMISSION_STATUS,
  buildTitleProviderEvidenceCandidates
};
