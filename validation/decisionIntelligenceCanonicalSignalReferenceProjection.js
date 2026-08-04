'use strict';

const {
  asArray,
  asObject,
  fingerprint,
  unique
} = require('./canonicalValidationCore');
const {
  CANONICAL_INTELLIGENCE_SIGNAL_SOURCE,
  UNKNOWN_VALUE,
  buildCanonicalSignalFingerprint,
  validateCanonicalSignal
} = require('./canonicalIntelligenceSignalContract');

const SOURCE = 'decision_intelligence_canonical_signal_reference_projection';
const VERSION = '1.0.0';
const SCHEMA_VERSION = 'decision_intelligence_canonical_signal_reference_projection.v1';

const PROJECTION_STATUSES = Object.freeze({
  PROJECTED: 'projected',
  PROJECTED_WITH_WARNINGS: 'projected_with_warnings',
  PARTIALLY_PROJECTED: 'partially_projected',
  WITHHELD: 'withheld',
  INVALID_INPUT: 'invalid_input'
});

const PROJECTABLE_SIGNAL_TYPES = Object.freeze([
  'identity',
  'parser',
  'evidence',
  'valuation',
  'range',
  'confidence',
  'risk',
  'quality',
  'grading',
  'financial',
  'decision',
  'diagnostic',
  'context',
  'review',
  'governance',
  UNKNOWN_VALUE
]);

const AUTHORITY_FIELDS = Object.freeze([
  'productionImpact',
  'decisionImpact',
  'executionAuthority'
]);

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function known(value) {
  return value !== undefined && value !== null && value !== '';
}

function normalizeString(value, fallback = UNKNOWN_VALUE) {
  if (!known(value)) return fallback;
  return String(value).trim() || fallback;
}

function normalizeDate(value, fallback = UNKNOWN_VALUE) {
  if (!known(value)) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function normalizeStringArray(values = []) {
  return unique(asArray(values).map((value) => normalizeString(value, '')).filter(Boolean)).sort();
}

function sortByStableFingerprint(values = [], keyBuilder = fingerprint) {
  return asArray(values)
    .map((value) => clone(value))
    .sort((left, right) => keyBuilder(left).localeCompare(keyBuilder(right)));
}

function validationIssue(code, message, field = '') {
  return { code, message, field };
}

function buildCanonicalSignalReferenceProjectionFingerprint(projection = {}) {
  const candidate = clone(projection);
  delete candidate.projectionFingerprint;
  delete candidate.batchFingerprint;
  delete candidate.validation;
  return fingerprint(candidate);
}

function resolveCanonicalSignal(input = {}) {
  const source = asObject(input);
  if (source.source === CANONICAL_INTELLIGENCE_SIGNAL_SOURCE && source.signalId) return source;
  if (source.canonicalSignal) return asObject(source.canonicalSignal);
  if (source.signal) return asObject(source.signal);
  if (source.sourceArtifact?.canonicalSignal) return asObject(source.sourceArtifact.canonicalSignal);
  return {};
}

function inferSourceArtifactType(input = {}, canonicalSignal = {}) {
  const source = asObject(input);
  if (source.sourceArtifactType) return normalizeString(source.sourceArtifactType);
  if (source.referenceType) return normalizeString(source.referenceType);
  if (source.source === CANONICAL_INTELLIGENCE_SIGNAL_SOURCE || canonicalSignal.signalId) return 'canonical_intelligence_signal';
  if (source.source) return normalizeString(source.source);
  return UNKNOWN_VALUE;
}

function getSourceArtifactId(input = {}, canonicalSignal = {}) {
  const source = asObject(input);
  return normalizeString(
    source.sourceArtifactId ||
    source.artifactId ||
    source.adapterRunId ||
    source.alignmentId ||
    source.migrationId ||
    source.comparisonId ||
    source.reportId ||
    source.runId ||
    source.signalId ||
    canonicalSignal.signalId
  );
}

function getSourceArtifactFingerprint(input = {}, canonicalSignal = {}) {
  const source = asObject(input);
  return normalizeString(
    source.sourceArtifactFingerprint ||
    source.artifactFingerprint ||
    source.compatibilityFingerprint ||
    source.alignmentFingerprint ||
    source.migrationFingerprint ||
    source.shadowComparisonFingerprint ||
    source.comparisonFingerprint ||
    source.reportFingerprint ||
    source.runFingerprint ||
    source.signalFingerprint ||
    canonicalSignal.signalFingerprint
  );
}

function collectAuthorityViolations(...records) {
  const violations = [];
  for (const record of records.map(asObject)) {
    for (const field of AUTHORITY_FIELDS) {
      if (record[field] !== undefined && record[field] !== 'none') violations.push(field);
    }
    const flags = asObject(record.authorityPreservation);
    for (const field of AUTHORITY_FIELDS) {
      if (flags[field] !== undefined && flags[field] !== 'none') violations.push(`authorityPreservation.${field}`);
    }
  }
  return normalizeStringArray(violations);
}

function collectWarnings(source = {}, canonicalSignal = {}) {
  const warnings = [
    ...asArray(canonicalSignal.warnings),
    ...asArray(source.warnings),
    ...asArray(source.validation?.warnings),
    ...asArray(source.inputValidation?.warnings),
    ...asArray(source.warningPreservation?.warnings)
  ];
  return sortByStableFingerprint(warnings, (warning) => {
    if (typeof warning === 'string') return warning;
    return `${normalizeString(warning.code)}|${normalizeString(warning.message)}|${fingerprint(warning)}`;
  });
}

function collectErrors(source = {}, canonicalSignalValidation = {}) {
  return sortByStableFingerprint([
    ...asArray(source.errors),
    ...asArray(source.validation?.errors),
    ...asArray(source.inputValidation?.errors),
    ...asArray(canonicalSignalValidation.errors)
  ], (error) => `${normalizeString(error.code)}|${normalizeString(error.message)}|${fingerprint(error)}`);
}

function collectUnknownValues(source = {}, canonicalSignal = {}) {
  const unknowns = [];
  const paths = [
    ['signalName', canonicalSignal.signalName],
    ['signalVersion', canonicalSignal.signalVersion],
    ['confidence.value', canonicalSignal.confidence?.value],
    ['confidenceLevel', canonicalSignal.confidenceLevel],
    ['rawOutput', canonicalSignal.rawOutput],
    ['normalizedOutput', canonicalSignal.normalizedOutput],
    ['readinessPreservation.value', source.readinessPreservation?.value],
    ['confidencePreservation.value', source.confidencePreservation?.value]
  ];
  for (const [field, value] of paths) {
    if (value === UNKNOWN_VALUE) unknowns.push(field);
  }
  return normalizeStringArray([
    ...unknowns,
    ...asArray(source.unknownValues)
  ]);
}

function sourceArtifactReference(input = {}, canonicalSignal = {}) {
  return {
    artifactId: getSourceArtifactId(input, canonicalSignal),
    artifactType: inferSourceArtifactType(input, canonicalSignal),
    source: normalizeString(input.source || canonicalSignal.source),
    schemaVersion: normalizeString(input.schemaVersion || canonicalSignal.schemaVersion),
    createdAt: normalizeDate(input.createdAt || canonicalSignal.createdAt),
    signalName: normalizeString(canonicalSignal.signalName),
    signalVersion: normalizeString(canonicalSignal.signalVersion || input.signalVersion),
    signalFingerprint: normalizeString(canonicalSignal.signalFingerprint),
    sourceOutputFingerprint: normalizeString(input.sourceOutputFingerprint || input.sourceFingerprint || canonicalSignal.sourceFingerprint),
    sourceFingerprint: getSourceArtifactFingerprint(input, canonicalSignal),
    alignmentFingerprint: normalizeString(input.alignmentFingerprint),
    migrationFingerprint: normalizeString(input.migrationFingerprint),
    shadowComparisonFingerprint: normalizeString(input.shadowComparisonFingerprint || input.comparisonFingerprint),
    reportFingerprint: normalizeString(input.reportFingerprint),
    compatibilityFingerprint: normalizeString(input.compatibilityFingerprint),
    conformanceFingerprint: normalizeString(input.conformanceFingerprint),
    validationStatus: input.validation?.valid === false ? 'invalid' : normalizeString(input.validation?.status || input.validationStatus || 'unknown'),
    warnings: clone(asArray(input.warnings || input.validation?.warnings)),
    errors: clone(asArray(input.errors || input.validation?.errors)),
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none',
    provenance: clone(asObject(input.provenance))
  };
}

function projectSignalRef(input = {}, canonicalSignal = {}) {
  const signalName = normalizeString(canonicalSignal.signalName);
  const coverageStatus = input.coverageStatus
    ? input.coverageStatus
    : input.mappingResult?.canonicalOutputCreated === false ? 'unavailable' : 'available';
  return {
    signalFamily: normalizeString(canonicalSignal.signalFamily || signalName),
    signalName,
    signalVersion: normalizeString(canonicalSignal.signalVersion || input.signalVersion),
    signalId: normalizeString(canonicalSignal.signalId),
    signalFingerprint: normalizeString(canonicalSignal.signalFingerprint),
    alignmentId: normalizeString(input.alignmentId),
    alignmentFingerprint: normalizeString(input.alignmentFingerprint),
    migrationFingerprint: normalizeString(input.migrationFingerprint),
    shadowComparisonFingerprint: normalizeString(input.shadowComparisonFingerprint || input.comparisonFingerprint),
    reportFingerprint: normalizeString(input.reportFingerprint),
    coverageStatus: normalizeString(coverageStatus),
    parityStatus: normalizeString(input.parityStatus || input.exactParityStatus || input.semanticParityStatus),
    authorityStatus: 'none',
    sourceOutputFingerprint: normalizeString(input.sourceOutputFingerprint || input.sourceFingerprint || canonicalSignal.sourceFingerprint),
    summary: normalizeString(input.summary?.message || input.summary || `Projected reference for ${signalName}.`),
    metadata: {
      projectionSource: SOURCE,
      sourceArtifactType: inferSourceArtifactType(input, canonicalSignal),
      sourceArtifactId: getSourceArtifactId(input, canonicalSignal),
      sourceArtifactFingerprint: getSourceArtifactFingerprint(input, canonicalSignal),
      compatibilityFingerprint: normalizeString(input.compatibilityFingerprint),
      conformanceFingerprint: normalizeString(input.conformanceFingerprint),
      warningCount: asArray(canonicalSignal.warnings).length + asArray(input.warnings).length + asArray(input.validation?.warnings).length,
      errorCount: asArray(input.errors).length + asArray(input.validation?.errors).length,
      readinessStatus: normalizeString(input.readinessStatus || input.readinessPreservation?.status),
      certificationStatus: normalizeString(input.certificationStatus || input.conformanceStatus),
      signalType: normalizeString(canonicalSignal.signalType),
      producer: clone(canonicalSignal.producer),
      producerVersion: normalizeString(canonicalSignal.producerVersion)
    }
  };
}

function buildWarningPropagation(warnings = [], canonicalSignal = {}, source = {}) {
  const warningsBySource = {};
  for (const warning of asArray(warnings)) {
    const key = typeof warning === 'string'
      ? 'canonicalSignal.warnings'
      : normalizeString(warning.sourceField || warning.field || warning.source || 'unknown');
    warningsBySource[key] = (warningsBySource[key] || 0) + 1;
  }
  return {
    warningCount: asArray(warnings).length,
    blockingWarningCount: asArray(canonicalSignal.blockers).length,
    sourceWarningCounts: warningsBySource,
    warningsBySignalName: {
      [normalizeString(canonicalSignal.signalName)]: asArray(warnings).length
    },
    warningsByArtifactType: {
      [inferSourceArtifactType(source, canonicalSignal)]: asArray(warnings).length
    },
    unknownWarningCodes: normalizeStringArray(asArray(warnings)
      .filter((warning) => typeof warning !== 'string')
      .map((warning) => warning.code || warning.sourceField || UNKNOWN_VALUE)),
    preservedSeverities: normalizeStringArray(asArray(warnings)
      .map((warning) => (typeof warning === 'string' ? UNKNOWN_VALUE : warning.severity))),
    warnings: clone(warnings),
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
}

function buildReadinessPropagation(source = {}, canonicalSignal = {}, status = PROJECTION_STATUSES.PROJECTED) {
  const sourceReadiness = source.readinessPropagation || source.readinessPreservation || {};
  const blocked = status === PROJECTION_STATUSES.WITHHELD || status === PROJECTION_STATUSES.INVALID_INPUT;
  return {
    projectionReadiness: blocked ? 'blocked' : normalizeString(sourceReadiness.projectionReadiness || sourceReadiness.status || 'review_ready'),
    reviewReadiness: blocked ? 'blocked' : normalizeString(sourceReadiness.reviewReadiness || 'review_ready'),
    certificationReadiness: normalizeString(sourceReadiness.certificationReadiness || source.certificationStatus || (blocked ? 'blocked' : 'unknown')),
    sourceReadiness: clone(sourceReadiness),
    missingRequiredSignals: normalizeStringArray(source.missingRequiredSignals),
    missingOptionalSignals: normalizeStringArray(source.missingOptionalSignals),
    blockingReasons: blocked ? normalizeStringArray(['projection_not_available', ...asArray(source.blockingReasons)]) : normalizeStringArray(source.blockingReasons),
    nonBlockingWarnings: normalizeStringArray([
      ...asArray(canonicalSignal.warnings),
      ...asArray(source.nonBlockingWarnings)
    ]),
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
}

function buildConfidencePropagation(source = {}, canonicalSignal = {}) {
  return {
    confidencePreserved: true,
    confidenceInvented: false,
    confidenceRecomputed: false,
    confidenceSources: [{
      signalId: normalizeString(canonicalSignal.signalId),
      signalFingerprint: normalizeString(canonicalSignal.signalFingerprint),
      confidence: clone(canonicalSignal.confidence),
      confidenceLevel: normalizeString(canonicalSignal.confidenceLevel),
      sourceConfidencePreservation: clone(asObject(source.confidencePreservation))
    }],
    missingConfidenceSignals: canonicalSignal.confidence?.value === UNKNOWN_VALUE ? [normalizeString(canonicalSignal.signalName)] : [],
    confidenceWarnings: normalizeStringArray(source.confidencePreservation?.warnings),
    confidenceUnknowns: canonicalSignal.confidence?.value === UNKNOWN_VALUE ? ['confidence.value'] : [],
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
}

function buildEligibilityPropagation(source = {}) {
  const authority = asObject(source.authorityPreservation);
  return {
    dealGateEligible: false,
    buyNowEligible: false,
    notificationEligible: false,
    eligibilityCreated: false,
    sourceEligibility: clone(asObject(source.eligibilityPropagation || source.eligibilityMetadata)),
    notDealGateEligible: authority.notDealGateEligible !== false,
    notBuyNowEligible: authority.notBuyNowEligible !== false,
    notNotificationEligible: authority.notNotificationEligible !== false,
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
}

function buildAuthorityPreservation(authorityViolations = []) {
  return {
    authorityStatus: authorityViolations.length > 0 ? 'blocked' : 'none',
    dealGateEligibilityCreated: false,
    buyNowEligibilityCreated: false,
    notificationEligibilityCreated: false,
    productionApprovedLabelCreated: false,
    authorityViolations: normalizeStringArray(authorityViolations),
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
}

function determineProjectionStatus(context = {}) {
  const {
    hasCanonicalSignal,
    canonicalValidation,
    authorityViolations,
    unsupportedSignalType,
    warnings
  } = context;
  if (!hasCanonicalSignal || !canonicalValidation.valid) return PROJECTION_STATUSES.INVALID_INPUT;
  if (authorityViolations.length > 0) return PROJECTION_STATUSES.INVALID_INPUT;
  if (unsupportedSignalType) return PROJECTION_STATUSES.WITHHELD;
  if (asArray(warnings).length > 0 || asArray(canonicalValidation.warnings).length > 0) return PROJECTION_STATUSES.PROJECTED_WITH_WARNINGS;
  return PROJECTION_STATUSES.PROJECTED;
}

function buildValidationForProjection(projection = {}) {
  const errors = sortByStableFingerprint(asArray(projection.errors), (issue) => `${normalizeString(issue.code)}|${normalizeString(issue.field)}|${normalizeString(issue.message)}|${fingerprint(issue)}`);
  const warnings = sortByStableFingerprint(asArray(projection.warnings), (issue) => `${normalizeString(issue.code)}|${normalizeString(issue.field)}|${normalizeString(issue.message)}|${fingerprint(issue)}`);
  const missingRequiredFields = [];
  const fingerprintViolations = [];
  const authorityViolations = normalizeStringArray(projection.authorityPreservation?.authorityViolations);
  const unsupportedProjections = [];

  for (const field of ['schemaVersion', 'source', 'projectionId', 'projectionVersion', 'createdAt', 'projectionStatus', 'productionImpact', 'decisionImpact', 'executionAuthority', 'projectionFingerprint']) {
    if (!known(projection[field])) {
      missingRequiredFields.push(field);
      errors.push(validationIssue('missing_required_field', `${field} is required.`, field));
    }
  }

  if (projection.schemaVersion !== SCHEMA_VERSION) errors.push(validationIssue('invalid_schema_version', 'Projection schemaVersion is unsupported.', 'schemaVersion'));
  if (projection.source !== SOURCE) errors.push(validationIssue('invalid_source', `Projection source must be ${SOURCE}.`, 'source'));
  for (const violation of authorityViolations) {
    errors.push(validationIssue('authority_boundary_violation', `${violation} must remain none.`, violation));
  }
  for (const field of AUTHORITY_FIELDS) {
    if (projection[field] !== 'none') {
      authorityViolations.push(field);
      errors.push(validationIssue('authority_boundary_violation', `${field} must remain none.`, field));
    }
  }

  const sourceAuthorityViolations = collectAuthorityViolations(
    projection.authorityPreservation,
    ...asArray(projection.signalRefs),
    ...asArray(projection.governanceRefs),
    ...asArray(projection.sourceArtifactReferences)
  );
  for (const violation of sourceAuthorityViolations) {
    authorityViolations.push(violation);
    errors.push(validationIssue('authority_boundary_violation', `${violation} must remain none.`, violation));
  }

  for (const ref of asArray(projection.signalRefs)) {
    if (!known(ref.signalId)) errors.push(validationIssue('missing_signal_reference_identity', 'signalId is required.', 'signalRefs.signalId'));
    if (!known(ref.signalFingerprint)) errors.push(validationIssue('missing_signal_reference_fingerprint', 'signalFingerprint is required.', 'signalRefs.signalFingerprint'));
    if (ref.authorityStatus !== 'none') {
      authorityViolations.push('signalRefs.authorityStatus');
      errors.push(validationIssue('authority_boundary_violation', 'signalRefs authorityStatus must remain none.', 'signalRefs.authorityStatus'));
    }
  }

  for (const unsupported of asArray(projection.unsupportedProjections)) {
    unsupportedProjections.push(unsupported.signalName || unsupported.reasonCode || UNKNOWN_VALUE);
  }

  if (projection.projectionFingerprint && buildCanonicalSignalReferenceProjectionFingerprint(projection) !== projection.projectionFingerprint) {
    fingerprintViolations.push('projectionFingerprint');
    errors.push(validationIssue('projection_fingerprint_mismatch', 'projectionFingerprint does not match projection contents.', 'projectionFingerprint'));
  }

  if (projection.projectionStatus === PROJECTION_STATUSES.WITHHELD && asArray(projection.unsupportedProjections).length === 0) {
    warnings.push(validationIssue('withheld_without_unsupported_projection', 'Withheld projections should preserve unsupported projection details.', 'unsupportedProjections'));
  }

  const reasonCodes = unique([
    ...errors.map((error) => error.code),
    ...warnings.map((warning) => warning.code)
  ]).sort();

  return {
    valid: errors.length === 0,
    errors: sortByStableFingerprint(errors, (issue) => `${issue.code}|${issue.field}|${issue.message}`),
    warnings: sortByStableFingerprint(warnings, (issue) => `${issue.code}|${issue.field}|${issue.message}`),
    reasonCodes,
    missingRequiredFields: normalizeStringArray(missingRequiredFields),
    missingReferences: normalizeStringArray(asArray(projection.missingReferences).map((ref) => ref.signalName || ref.referenceId || ref)),
    unsupportedProjections: normalizeStringArray(unsupportedProjections),
    fingerprintViolations: normalizeStringArray(fingerprintViolations),
    authorityViolations: normalizeStringArray(authorityViolations),
    warningViolations: [],
    readinessViolations: [],
    confidenceViolations: [],
    provenanceViolations: [],
    compatibilityViolations: []
  };
}

function validateCanonicalSignalReferenceProjection(projection = {}) {
  return buildValidationForProjection(projection);
}

function summarizeCanonicalSignalReferenceProjection(projection = {}) {
  const input = asObject(projection);
  const signalRefs = asArray(input.signalRefs);
  return {
    schemaVersion: SCHEMA_VERSION,
    source: SOURCE,
    projectionId: normalizeString(input.projectionId),
    projectionStatus: normalizeString(input.projectionStatus),
    signalRefCount: signalRefs.length,
    governanceRefCount: asArray(input.governanceRefs).length,
    missingReferenceCount: asArray(input.missingReferences).length,
    unsupportedProjectionCount: asArray(input.unsupportedProjections).length,
    warningCount: input.warningPropagation?.warningCount || 0,
    authorityStatus: normalizeString(input.authorityPreservation?.authorityStatus, 'none'),
    projectedSignalNames: normalizeStringArray(signalRefs.map((signal) => signal.signalName)),
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
}

function projectCanonicalSignalReference(input = {}, options = {}) {
  const sourceInput = clone(input);
  const canonicalSignal = resolveCanonicalSignal(sourceInput);
  const hasCanonicalSignal = Object.keys(canonicalSignal).length > 0;
  const canonicalValidation = hasCanonicalSignal
    ? validateCanonicalSignal(canonicalSignal)
    : { valid: false, errors: [validationIssue('missing_canonical_signal', 'A canonicalSignal artifact is required.', 'canonicalSignal')], warnings: [] };
  const authorityViolations = collectAuthorityViolations(sourceInput, canonicalSignal);
  const unsupportedSignalType = hasCanonicalSignal && !PROJECTABLE_SIGNAL_TYPES.includes(normalizeString(canonicalSignal.signalType));
  const warnings = collectWarnings(sourceInput, canonicalSignal);
  const status = determineProjectionStatus({
    hasCanonicalSignal,
    canonicalValidation,
    authorityViolations,
    unsupportedSignalType,
    warnings
  });
  const artifactReference = sourceArtifactReference(sourceInput, canonicalSignal);
  const signalRefs = status === PROJECTION_STATUSES.WITHHELD || status === PROJECTION_STATUSES.INVALID_INPUT
    ? []
    : [projectSignalRef(sourceInput, canonicalSignal)];
  const unsupportedProjections = unsupportedSignalType
    ? [{
      signalName: normalizeString(canonicalSignal.signalName),
      signalType: normalizeString(canonicalSignal.signalType),
      reasonCode: 'unsupported_signal_type',
      productionImpact: 'none',
      decisionImpact: 'none',
      executionAuthority: 'none'
    }]
    : [];
  const errors = collectErrors(sourceInput, canonicalValidation);
  const projectionId = normalizeString(options.projectionId || sourceInput.projectionId || `decision-intelligence-signal-projection:${normalizeString(options.listingId || sourceInput.listingId)}:${normalizeString(options.projectionRunId || sourceInput.projectionRunId || getSourceArtifactId(sourceInput, canonicalSignal))}`);
  const createdAt = normalizeDate(options.createdAt || sourceInput.createdAt || canonicalSignal.createdAt || UNKNOWN_VALUE);
  const core = {
    schemaVersion: SCHEMA_VERSION,
    source: SOURCE,
    projectionId,
    projectionVersion: VERSION,
    createdAt,
    listingId: normalizeString(options.listingId || sourceInput.listingId || sourceInput.listingRef?.listingId),
    projectionStatus: status,
    signalRefs,
    governanceRefs: [],
    missingReferences: hasCanonicalSignal ? [] : [{
      referenceType: 'canonical_intelligence_signal',
      reasonCode: 'missing_canonical_signal',
      productionImpact: 'none',
      decisionImpact: 'none',
      executionAuthority: 'none'
    }],
    evidenceGaps: hasCanonicalSignal ? [] : ['canonical_signal_reference'],
    unknownValues: collectUnknownValues(sourceInput, canonicalSignal),
    warningPropagation: buildWarningPropagation(warnings, canonicalSignal, sourceInput),
    readinessPropagation: buildReadinessPropagation(sourceInput, canonicalSignal, status),
    confidencePropagation: buildConfidencePropagation(sourceInput, canonicalSignal),
    eligibilityPropagation: buildEligibilityPropagation(sourceInput),
    authorityPreservation: buildAuthorityPreservation(authorityViolations),
    unsupportedProjections,
    sourceArtifactReferences: [artifactReference],
    validation: {},
    provenance: {
      source: SOURCE,
      authoritativeSources: [
        'Approved Project State v9.0',
        'docs/phase-18.2B-decision-intelligence-canonical-signal-reference-projection-contract.md'
      ],
      sourceProvenance: clone(asObject(sourceInput.provenance)),
      canonicalSignalProvenance: clone(asObject(canonicalSignal.provenance)),
      sourceArtifactFingerprint: artifactReference.sourceFingerprint,
      canonicalSignalFingerprint: normalizeString(canonicalSignal.signalFingerprint)
    },
    preservedSourceArtifact: sourceInput,
    preservedCanonicalSignal: clone(canonicalSignal),
    errors,
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
  const withSummary = {
    ...core,
    summary: summarizeCanonicalSignalReferenceProjection(core)
  };
  const withFingerprint = {
    ...withSummary,
    projectionFingerprint: buildCanonicalSignalReferenceProjectionFingerprint(withSummary)
  };
  return deepFreeze({
    ...withFingerprint,
    validation: validateCanonicalSignalReferenceProjection(withFingerprint)
  });
}

function projectCanonicalSignalReferenceBatch(inputs = [], options = {}) {
  const sortedInputs = sortByStableFingerprint(inputs, (record) => {
    const signal = resolveCanonicalSignal(record);
    return `${normalizeString(signal.signalName)}|${normalizeString(signal.signalFingerprint)}|${fingerprint(record)}`;
  });
  const projections = sortedInputs.map((record, index) => projectCanonicalSignalReference(record, {
    ...options,
    projectionId: record.projectionId || `${normalizeString(options.projectionBatchId || options.projectionRunId || 'decision-intelligence-signal-projection-batch')}:projection-${index + 1}`
  }));
  const sortedProjections = projections
    .map((projection) => clone(projection))
    .sort((left, right) => `${left.signalRefs[0]?.signalName || UNKNOWN_VALUE}|${left.projectionId}|${left.projectionFingerprint}`.localeCompare(`${right.signalRefs[0]?.signalName || UNKNOWN_VALUE}|${right.projectionId}|${right.projectionFingerprint}`));
  const statuses = sortedProjections.reduce((summary, projection) => {
    summary[projection.projectionStatus] = (summary[projection.projectionStatus] || 0) + 1;
    return summary;
  }, {});
  const warningCount = sortedProjections.reduce((total, projection) => total + (projection.warningPropagation?.warningCount || 0), 0);
  const core = {
    schemaVersion: SCHEMA_VERSION,
    source: SOURCE,
    projectionVersion: VERSION,
    projectionBatchId: normalizeString(options.projectionBatchId || options.projectionRunId || 'decision-intelligence-signal-projection-batch'),
    createdAt: normalizeDate(options.createdAt || UNKNOWN_VALUE),
    projectionCount: sortedProjections.length,
    projections: sortedProjections,
    summary: {
      projectionCount: sortedProjections.length,
      projectedCount: (statuses[PROJECTION_STATUSES.PROJECTED] || 0) + (statuses[PROJECTION_STATUSES.PROJECTED_WITH_WARNINGS] || 0),
      withheldCount: statuses[PROJECTION_STATUSES.WITHHELD] || 0,
      invalidInputCount: statuses[PROJECTION_STATUSES.INVALID_INPUT] || 0,
      warningCount,
      statuses,
      projectedSignalNames: normalizeStringArray(sortedProjections.flatMap((projection) => projection.signalRefs.map((ref) => ref.signalName))),
      productionImpact: 'none',
      decisionImpact: 'none',
      executionAuthority: 'none'
    },
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
  return deepFreeze({
    ...core,
    batchFingerprint: buildCanonicalSignalReferenceProjectionFingerprint(core)
  });
}

module.exports = {
  SOURCE,
  VERSION,
  SCHEMA_VERSION,
  PROJECTION_STATUSES,
  PROJECTABLE_SIGNAL_TYPES,
  projectCanonicalSignalReference,
  projectCanonicalSignalReferenceBatch,
  validateCanonicalSignalReferenceProjection,
  summarizeCanonicalSignalReferenceProjection,
  buildCanonicalSignalReferenceProjectionFingerprint
};
