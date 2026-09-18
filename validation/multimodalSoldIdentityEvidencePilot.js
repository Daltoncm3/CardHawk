'use strict';

const canonicalIdentityEngine = require('../engines/canonicalIdentityEngine');
const {
  EVIDENCE_TYPES,
  validateRawEvidenceRecord
} = require('../marketplaces/canonicalAcquisitionInterface');
const {
  translateCardApiSaleToRawCanonical
} = require('../marketplaces/cardApiAcquisitionAdapter');
const {
  RESOLUTION_CLASSIFICATIONS,
  MATERIAL_FIELDS,
  resolveCardApiTransactionIdentity
} = require('./cardApiIdentityResolutionPilot');
const {
  asArray,
  asObject,
  fingerprint,
  unique
} = require('./canonicalValidationCore');

const SOURCE = 'multimodal_sold_identity_evidence_pilot';
const VERSION = '0.1.0';
const SCHEMA_VERSION = '1.0.0';

const OBSERVATION_TYPES = Object.freeze({
  EXPLICIT_VISUAL: 'explicit_visual_evidence',
  INFERRED_VISUAL: 'inferred_visual_evidence',
  UNKNOWN: 'unknown_not_observable'
});

const EVIDENCE_MODALITIES = Object.freeze({
  IMAGE: 'image',
  IMAGE_OCR: 'image_ocr',
  SLAB_LABEL: 'slab_label',
  FIXTURE: 'offline_fixture'
});

const ADMISSION_STATUSES = Object.freeze({
  ADMITTED: 'admitted',
  REJECTED: 'rejected',
  CONFLICT: 'conflict'
});

const DEFAULT_MIN_CONFIDENCE = 0.85;

const SUPPORTED_FIELDS = Object.freeze([
  'sport',
  'subjectName',
  'year',
  'manufacturer',
  'product',
  'setName',
  'cardNumber',
  'parallel',
  'rookieDesignation',
  'autographState',
  'memorabiliaState',
  'serialNumbered',
  'printRun',
  'rawOrGraded',
  'gradeCompany',
  'grade'
]);

const ABSENCE_SENSITIVE_FIELDS = Object.freeze([
  'autographState',
  'memorabiliaState',
  'serialNumbered'
]);

const VISUAL_SOLVABILITY = Object.freeze({
  subjectName: 'commonly_visually_observable',
  cardNumber: 'commonly_visually_observable',
  parallel: 'sometimes_visually_observable',
  rawOrGraded: 'commonly_visually_observable',
  serialNumbered: 'sometimes_visually_observable',
  autographState: 'sometimes_visually_observable_positive_only',
  memorabiliaState: 'sometimes_visually_observable_positive_only'
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function hasKnown(value) {
  return value !== undefined && value !== null && value !== '' && value !== 'unknown';
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

function normalizeConfidence(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  if (numeric > 1 && numeric <= 100) return numeric / 100;
  return numeric;
}

function normalizeTransaction(record = {}) {
  if (record.source?.adapter === 'card_api_acquisition_adapter' || record.parsedIdentity || record.rawTitle) {
    return clone(record);
  }
  if (record.id && record.title && (record.sold_at || record.sale_date || record.listing_type)) {
    return translateCardApiSaleToRawCanonical(record);
  }
  return clone(record);
}

function normalizeObservation(input = {}, index = 0) {
  const observation = asObject(input);
  const normalized = {
    schemaVersion: observation.schemaVersion || SCHEMA_VERSION,
    observationId: observation.observationId || `multimodal_observation_${index + 1}`,
    field: observation.field || 'unknown',
    proposedValue: observation.proposedValue === undefined ? 'unknown' : observation.proposedValue,
    evidenceSource: observation.evidenceSource || 'offline_fixture',
    evidenceModality: observation.evidenceModality || EVIDENCE_MODALITIES.FIXTURE,
    observationType: observation.observationType || observation.evidenceType || OBSERVATION_TYPES.UNKNOWN,
    confidence: normalizeConfidence(observation.confidence),
    modelProvider: observation.modelProvider || null,
    modelIdentifier: observation.modelIdentifier || null,
    observedAt: observation.observedAt || null,
    explicit: observation.explicit === undefined ? observation.observationType === OBSERVATION_TYPES.EXPLICIT_VISUAL : Boolean(observation.explicit),
    deterministicVerification: Boolean(observation.deterministicVerification),
    warnings: asArray(observation.warnings).map(String).sort(),
    ambiguity: asArray(observation.ambiguity || observation.ambiguities).map(String).sort(),
    multipleCardsVisible: Boolean(observation.multipleCardsVisible),
    notes: observation.notes || null,
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };

  normalized.observationFingerprint = fingerprint({
    ...normalized,
    observationFingerprint: undefined
  });
  return deepFreeze(normalized);
}

function validateMultimodalIdentityObservation(input = {}) {
  const observation = normalizeObservation(input);
  const errors = [];
  const warnings = [];
  const reasonCodes = [];

  if (observation.schemaVersion !== SCHEMA_VERSION) {
    errors.push('unsupported_schema_version');
    reasonCodes.push('unsupported_schema_version');
  }
  if (!SUPPORTED_FIELDS.includes(observation.field)) {
    errors.push('unsupported_identity_field');
    reasonCodes.push('unsupported_identity_field');
  }
  if (!Object.values(OBSERVATION_TYPES).includes(observation.observationType)) {
    errors.push('unsupported_observation_type');
    reasonCodes.push('unsupported_observation_type');
  }
  if (observation.confidence === null || observation.confidence < 0 || observation.confidence > 1) {
    errors.push('invalid_confidence');
    reasonCodes.push('invalid_confidence');
  }
  if (!hasKnown(observation.proposedValue)) {
    warnings.push('unknown_proposed_value');
    reasonCodes.push('unknown_proposed_value');
  }
  for (const field of ['productionImpact', 'decisionImpact', 'executionAuthority']) {
    if (observation[field] !== 'none') {
      errors.push(`${field}_must_remain_none`);
      reasonCodes.push('authority_boundary_violation');
    }
  }

  return deepFreeze({
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes: unique(reasonCodes).sort(),
    observation
  });
}

function extractResolvedFields(resolution = {}) {
  const normalized = asObject(resolution.canonicalIdentity?.normalized);
  return {
    sport: normalized.sport || 'unknown',
    subjectName: normalized.subject?.name || 'unknown',
    year: normalized.year || 'unknown',
    manufacturer: normalized.manufacturer || 'unknown',
    product: normalized.product || 'unknown',
    setName: normalized.setName || 'unknown',
    cardNumber: normalized.cardNumber || 'unknown',
    parallel: normalized.parallel || 'unknown',
    rookieDesignation: normalized.rookieDesignation ?? 'unknown',
    autographState: normalized.autograph?.state ?? 'unknown',
    memorabiliaState: normalized.memorabilia?.state ?? 'unknown',
    serialNumbered: normalized.serialNumbered ?? 'unknown',
    printRun: normalized.printRun || null,
    rawOrGraded: normalized.rawOrGraded || 'unknown',
    gradeCompany: normalized.grading?.company || 'unknown',
    grade: normalized.grading?.grade || 'unknown'
  };
}

function buildCanonicalCandidateIdentity(resolved = {}, title = '') {
  return {
    identityType: 'sports_card',
    category: 'sports_card',
    marketSegment: 'sports',
    raw: {
      title,
      source: SOURCE
    },
    normalized: {
      sport: resolved.sport,
      league: 'unknown',
      team: 'unknown',
      subject: {
        name: resolved.subjectName,
        aliases: []
      },
      year: resolved.year,
      manufacturer: resolved.manufacturer,
      brand: resolved.manufacturer,
      product: resolved.product,
      setName: resolved.setName,
      subset: null,
      insertSet: null,
      cardNumber: resolved.cardNumber,
      parallel: resolved.parallel,
      variation: null,
      imageVariation: null,
      rookieDesignation: resolved.rookieDesignation,
      autograph: {
        state: resolved.autographState,
        type: resolved.autographState === true ? 'auto' : null
      },
      memorabilia: {
        state: resolved.memorabiliaState,
        type: resolved.memorabiliaState === true ? 'memorabilia' : null
      },
      serialNumbered: resolved.serialNumbered,
      serialNumber: null,
      printRun: resolved.printRun,
      rawOrGraded: resolved.rawOrGraded,
      rawCondition: null,
      grading: {
        company: resolved.gradeCompany,
        grade: resolved.grade,
        certificationNumber: null
      }
    }
  };
}

function legacyParsedIdentityFromCanonical(identity = {}) {
  const normalized = asObject(identity.normalized);
  return {
    category: 'sports_card',
    sport: normalized.sport,
    player: normalized.subject?.name,
    year: normalized.year,
    brand: normalized.manufacturer,
    product: normalized.product,
    setName: normalized.setName,
    cardNumber: normalized.cardNumber,
    parallel: normalized.parallel,
    rookie: normalized.rookieDesignation,
    autograph: normalized.autograph?.state,
    memorabilia: normalized.memorabilia?.state,
    serialNumbered: normalized.serialNumbered,
    printRun: normalized.printRun,
    rawOrGraded: normalized.rawOrGraded,
    gradeCompany: normalized.grading?.company,
    grade: normalized.grading?.grade
  };
}

function missingMaterialFields(resolved = {}) {
  return MATERIAL_FIELDS.filter((field) => !hasKnown(resolved[field]) || resolved[field] === 'unknown');
}

function classifyResolution(canonicalIdentity = {}, conflicts = [], missingFields = []) {
  if (conflicts.length) return RESOLUTION_CLASSIFICATIONS.AMBIGUOUS;
  if (canonicalIdentity.eligibility?.exactCompEligible === true && missingFields.length === 0) {
    return RESOLUTION_CLASSIFICATIONS.EXACT;
  }
  const normalized = asObject(canonicalIdentity.normalized);
  const plausible = canonicalIdentity.identityType === 'sports_card' && (
    hasKnown(normalized.subject?.name) ||
    hasKnown(normalized.cardNumber) ||
    hasKnown(normalized.setName) ||
    hasKnown(normalized.year)
  );
  return plausible ? RESOLUTION_CLASSIFICATIONS.AMBIGUOUS : RESOLUTION_CLASSIFICATIONS.UNRESOLVED;
}

function evaluateCanonicalSoldEvidenceReadiness(record = {}, canonicalIdentity = {}) {
  const candidate = {
    ...record,
    parsedIdentity: legacyParsedIdentityFromCanonical(canonicalIdentity),
    evidenceType: record.evidenceType || EVIDENCE_TYPES.TRUE_SOLD,
    status: record.status || 'active_evidence'
  };
  const validation = validateRawEvidenceRecord(candidate, {
    marketplace: 'the_card_api',
    adapterName: 'card_api_acquisition_adapter',
    capabilities: {
      transactionLevelSoldSupport: true,
      aggregateMarketPriceSupport: false,
      activeContextSupport: false
    }
  });

  return {
    ready: validation.valid,
    reasons: asArray(validation.reasons).sort()
  };
}

function fieldProvenanceValue(provenance = {}, field) {
  const entry = asObject(provenance[field]);
  if (hasKnown(entry.providerValue)) return { value: entry.providerValue, source: 'provider_metadata' };
  if (hasKnown(entry.titleValue)) return { value: entry.titleValue, source: 'title_parse' };
  return { value: null, source: null };
}

function buildRejection(observation, reason) {
  return deepFreeze({
    status: ADMISSION_STATUSES.REJECTED,
    field: observation.field,
    proposedValue: observation.proposedValue,
    observationId: observation.observationId,
    reason,
    observationFingerprint: observation.observationFingerprint
  });
}

function evaluateObservationAdmission(observation, preResolution, minConfidence) {
  const validation = validateMultimodalIdentityObservation(observation);
  if (!validation.valid) return buildRejection(validation.observation, validation.reasonCodes[0] || 'invalid_observation');

  const normalized = validation.observation;
  if (normalized.observationType === OBSERVATION_TYPES.UNKNOWN) return buildRejection(normalized, 'unknown_not_observable');
  if (normalized.observationType !== OBSERVATION_TYPES.EXPLICIT_VISUAL) return buildRejection(normalized, 'inferred_visual_evidence_requires_review');
  if (normalized.confidence < minConfidence) return buildRejection(normalized, 'confidence_below_admission_threshold');
  if (normalized.deterministicVerification !== true) return buildRejection(normalized, 'deterministic_verification_required');
  if (normalized.multipleCardsVisible) return buildRejection(normalized, 'multiple_cards_visible');
  if (normalized.warnings.length || normalized.ambiguity.length) return buildRejection(normalized, 'ambiguous_or_warning_bearing_observation');
  if (ABSENCE_SENSITIVE_FIELDS.includes(normalized.field) && normalized.proposedValue === false) {
    return buildRejection(normalized, 'absence_is_not_negative_evidence');
  }

  const existing = fieldProvenanceValue(preResolution.fieldProvenance, normalized.field);
  const existingComparable = normalizeComparable(existing.value);
  const proposedComparable = normalizeComparable(normalized.proposedValue);
  if (existingComparable !== null && proposedComparable !== null && existingComparable !== proposedComparable) {
    return deepFreeze({
      status: ADMISSION_STATUSES.CONFLICT,
      field: normalized.field,
      proposedValue: normalized.proposedValue,
      existingValue: existing.value,
      existingSource: existing.source,
      observationId: normalized.observationId,
      reason: `${existing.source}_multimodal_conflict`,
      observationFingerprint: normalized.observationFingerprint
    });
  }

  return deepFreeze({
    status: ADMISSION_STATUSES.ADMITTED,
    field: normalized.field,
    value: normalized.proposedValue,
    observationId: normalized.observationId,
    confidence: normalized.confidence,
    evidenceModality: normalized.evidenceModality,
    evidenceSource: normalized.evidenceSource,
    provenance: {
      source: 'admitted_multimodal_identity_evidence',
      observationId: normalized.observationId,
      observationFingerprint: normalized.observationFingerprint,
      evidenceModality: normalized.evidenceModality,
      confidence: normalized.confidence,
      deterministicVerification: true
    }
  });
}

function applyAdmittedEvidence(preResolution = {}, admitted = []) {
  const resolved = extractResolvedFields(preResolution);
  const provenance = clone(preResolution.fieldProvenance || {});

  for (const entry of admitted) {
    resolved[entry.field] = entry.value;
    provenance[entry.field] = entry.provenance;
    if (entry.field === 'gradeCompany') resolved.rawOrGraded = 'graded';
    if (entry.field === 'grade') resolved.rawOrGraded = 'graded';
    if (entry.field === 'printRun' && hasKnown(entry.value)) resolved.serialNumbered = true;
  }

  if (resolved.product === 'unknown' && hasKnown(resolved.setName)) resolved.product = resolved.setName;
  if (resolved.setName === 'unknown' && hasKnown(resolved.product)) resolved.setName = resolved.product;
  return { resolved, provenance };
}

function resolveMultimodalSoldIdentityEvidence(input = {}) {
  const transaction = normalizeTransaction(input.transaction || input.record || {});
  const preResolution = input.titleResolution || resolveCardApiTransactionIdentity(transaction);
  const observations = asArray(input.observations).map((observation, index) => normalizeObservation(observation, index));
  const minConfidence = normalizeConfidence(input.minConfidence) || DEFAULT_MIN_CONFIDENCE;
  const admissionResults = observations
    .map((observation) => evaluateObservationAdmission(observation, preResolution, minConfidence))
    .sort((a, b) => `${a.field}:${a.observationId}`.localeCompare(`${b.field}:${b.observationId}`));
  const admitted = admissionResults.filter((entry) => entry.status === ADMISSION_STATUSES.ADMITTED);
  const rejected = admissionResults.filter((entry) => entry.status === ADMISSION_STATUSES.REJECTED);
  const conflicts = admissionResults.filter((entry) => entry.status === ADMISSION_STATUSES.CONFLICT);
  const { resolved, provenance } = applyAdmittedEvidence(preResolution, admitted);
  const title = transaction.rawTitle || transaction.title || '';
  const canonicalCandidate = buildCanonicalCandidateIdentity(resolved, title);
  const canonicalIdentity = canonicalIdentityEngine.buildCanonicalIdentity({
    canonicalSoldEvidenceIdentity: canonicalCandidate,
    listing: { title },
    marketplace: { marketplace: transaction.marketplace || transaction.marketplaceLabel || 'the_card_api' },
    parserVersion: `${SOURCE}:${VERSION}`
  });
  const missingFields = missingMaterialFields(resolved).sort();
  const canonicalReadiness = evaluateCanonicalSoldEvidenceReadiness(transaction, canonicalIdentity);
  const postClassification = classifyResolution(canonicalIdentity, conflicts, missingFields);
  const readinessReasons = unique([
    ...canonicalReadiness.reasons,
    ...missingFields.map((field) => `missing_material_identity_${field}`),
    ...(postClassification === RESOLUTION_CLASSIFICATIONS.EXACT ? [] : ['identity_resolution_not_exact']),
    ...conflicts.map((conflict) => conflict.reason)
  ]).sort();
  const structurallyReady = canonicalReadiness.ready &&
    postClassification === RESOLUTION_CLASSIFICATIONS.EXACT &&
    missingFields.length === 0 &&
    conflicts.length === 0;

  const result = {
    source: SOURCE,
    version: VERSION,
    schemaVersion: SCHEMA_VERSION,
    preMultimodalClassification: preResolution.classification,
    postMultimodalClassification: postClassification,
    preMultimodalMissingMaterialFields: asArray(preResolution.missingMaterialFields).sort(),
    postMultimodalMissingMaterialFields: missingFields,
    admittedMultimodalFields: admitted,
    rejectedMultimodalFields: rejected,
    conflicts,
    postMultimodalCandidateIdentity: canonicalIdentity,
    canonicalSoldEvidenceStructurallyReady: structurallyReady,
    canonicalSoldEvidenceReadinessReasons: readinessReasons,
    fieldProvenance: provenance,
    imageEvidenceAvailable: Boolean(transaction.image),
    observationCount: observations.length,
    authorityImpact: {
      productionImpact: 'none',
      decisionImpact: 'none',
      executionAuthority: 'none',
      persistenceAllowed: false,
      imagePersistenceAllowed: false,
      providerRecordPersistenceAllowed: false
    },
    retentionAuthority: {
      persistenceAllowed: false,
      writesProductionStore: false,
      imagePersistenceAllowed: false,
      blocker: 'offline_shadow_multimodal_identity_evidence_only'
    },
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
  result.pilotFingerprint = fingerprint({
    source: result.source,
    version: result.version,
    preResolutionFingerprint: preResolution.resolutionFingerprint,
    observationFingerprints: observations.map((observation) => observation.observationFingerprint).sort(),
    admitted: admitted.map((entry) => ({ field: entry.field, value: entry.value, observationFingerprint: entry.observationFingerprint })),
    rejected: rejected.map((entry) => ({ field: entry.field, reason: entry.reason, observationFingerprint: entry.observationFingerprint })),
    conflicts: conflicts.map((entry) => ({ field: entry.field, reason: entry.reason, observationFingerprint: entry.observationFingerprint })),
    postClassification,
    missingFields
  });

  return deepFreeze(result);
}

function summarizeMultimodalSoldIdentityEvidence(results = []) {
  const entries = asArray(results);
  const summary = {
    evaluated: entries.length,
    exact: entries.filter((entry) => entry.postMultimodalClassification === RESOLUTION_CLASSIFICATIONS.EXACT).length,
    ambiguous: entries.filter((entry) => entry.postMultimodalClassification === RESOLUTION_CLASSIFICATIONS.AMBIGUOUS).length,
    unresolved: entries.filter((entry) => entry.postMultimodalClassification === RESOLUTION_CLASSIFICATIONS.UNRESOLVED).length,
    structurallyReady: entries.filter((entry) => entry.canonicalSoldEvidenceStructurallyReady === true).length,
    admittedFieldCount: entries.reduce((sum, entry) => sum + asArray(entry.admittedMultimodalFields).length, 0),
    rejectedFieldCount: entries.reduce((sum, entry) => sum + asArray(entry.rejectedMultimodalFields).length, 0),
    conflictCount: entries.reduce((sum, entry) => sum + asArray(entry.conflicts).length, 0),
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
  summary.summaryFingerprint = fingerprint(summary);
  return deepFreeze(summary);
}

function buildMultimodalSoldIdentityEvidenceFingerprint(value = {}) {
  return fingerprint(value);
}

module.exports = {
  SOURCE,
  VERSION,
  SCHEMA_VERSION,
  OBSERVATION_TYPES,
  EVIDENCE_MODALITIES,
  ADMISSION_STATUSES,
  SUPPORTED_FIELDS,
  VISUAL_SOLVABILITY,
  createMultimodalIdentityObservation: normalizeObservation,
  validateMultimodalIdentityObservation,
  resolveMultimodalSoldIdentityEvidence,
  summarizeMultimodalSoldIdentityEvidence,
  buildMultimodalSoldIdentityEvidenceFingerprint
};
