'use strict';

const { asArray, asObject, unique } = require('./canonicalValidationCore');
const { buildFingerprintFromProjection } = require('./fingerprintProjection');
const { clone, firstDefined } = require('./phase8GovernanceCore');
const {
  EXPECTED_SIGNAL_NAMES,
  buildDecisionIntelligenceArtifact,
  validateDecisionIntelligenceArtifact
} = require('./decisionIntelligenceArtifactBuilder');

const DECISION_INTELLIGENCE_EVIDENCE_BUNDLE_SCHEMA_VERSION = 'decision_intelligence_evidence_bundle.v1';
const DECISION_INTELLIGENCE_EVIDENCE_BUNDLE_SOURCE = 'decision_intelligence_evidence_bundle';
const UNKNOWN_VALUE = 'unknown';

const REQUIRED_BUNDLE_FIELDS = Object.freeze([
  'schemaVersion',
  'source',
  'bundleId',
  'bundleType',
  'createdAt',
  'capturedAt',
  'listingRef',
  'canonicalIdentityRef',
  'signalRefs',
  'valuationRefs',
  'comparableQualityRefs',
  'evidenceReadinessRefs',
  'productionScoringObservation',
  'dealGateObservation',
  'buyNowObservation',
  'governanceRefs',
  'missingReferences',
  'evidenceGaps',
  'unknownValues',
  'provenance',
  'builderInput',
  'productionImpact',
  'decisionImpact',
  'executionAuthority',
  'bundleFingerprint'
]);

const REQUIRED_REFERENCE_FIELDS = Object.freeze([
  'listingRef.listingId',
  'canonicalIdentityRef.canonicalIdentityId',
  'productionScoringObservation.sourceFingerprint',
  'dealGateObservation.sourceFingerprint'
]);

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}

function known(value) {
  return value !== undefined && value !== null && value !== '';
}

function normalizeDate(value, fallback = UNKNOWN_VALUE) {
  if (!known(value)) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function normalizeString(value, fallback = UNKNOWN_VALUE) {
  if (!known(value)) return fallback;
  return String(value).trim() || fallback;
}

function normalizeNumber(value, fallback = UNKNOWN_VALUE) {
  if (!known(value) || value === UNKNOWN_VALUE) return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeBoolean(value, fallback = false) {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeStringArray(values = []) {
  return unique(asArray(values).map((value) => normalizeString(value, '')).filter(Boolean)).sort();
}

function validationIssue(code, message, field = '') {
  return { code, message, field };
}

function summarizeIssues(errors = [], warnings = []) {
  return unique([...asArray(errors), ...asArray(warnings)].map((issue) => issue.code)).sort();
}

function sourceId(source = {}, fallback = UNKNOWN_VALUE) {
  const input = asObject(source);
  return normalizeString(firstDefined(
    input.sourceArtifactId,
    input.artifactId,
    input.bundleId,
    input.reportId,
    input.signalId,
    input.alignmentId,
    input.migrationId,
    input.comparisonId,
    input.valuationId,
    input.decisionId,
    input.dealGateId,
    input.identityId,
    input.listingId,
    input.id,
    fallback
  ));
}

function sourceFingerprint(source = {}, fallback = UNKNOWN_VALUE) {
  const input = asObject(source);
  return normalizeString(firstDefined(
    input.sourceFingerprint,
    input.fingerprint,
    input.artifactFingerprint,
    input.bundleFingerprint,
    input.reportFingerprint,
    input.signalFingerprint,
    input.alignmentFingerprint,
    input.migrationFingerprint,
    input.shadowComparisonFingerprint,
    input.valuationFingerprint,
    input.decisionFingerprint,
    input.dealGateFingerprint,
    input.identityFingerprint,
    input.listingFingerprint,
    fallback
  ));
}

function normalizeReference(reference = {}, defaults = {}) {
  const input = asObject(reference);
  const id = sourceId(input, firstDefined(defaults.id, defaults.sourceArtifactId));
  const fingerprint = sourceFingerprint(input, firstDefined(defaults.fingerprint, defaults.sourceFingerprint));
  return {
    referenceId: id,
    referenceType: normalizeString(firstDefined(input.referenceType, input.type, defaults.referenceType)),
    source: normalizeString(firstDefined(input.source, defaults.source)),
    sourceArtifactId: id,
    sourceFingerprint: fingerprint,
    schemaVersion: normalizeString(firstDefined(input.schemaVersion, input.version, defaults.schemaVersion)),
    status: normalizeString(firstDefined(input.status, input.reviewStatus, defaults.status)),
    summary: normalizeString(firstDefined(input.summary, defaults.summary)),
    metadata: clone(asObject(firstDefined(input.metadata, defaults.metadata, {})))
  };
}

function normalizeListingRef(input = {}) {
  const listing = asObject(input);
  return {
    listingId: normalizeString(firstDefined(listing.listingId, listing.id)),
    marketplace: normalizeString(listing.marketplace),
    source: normalizeString(listing.source),
    marketplaceItemId: normalizeString(firstDefined(listing.marketplaceItemId, listing.itemId)),
    title: normalizeString(listing.title),
    url: normalizeString(firstDefined(listing.url, listing.URL)),
    askingPrice: normalizeNumber(firstDefined(listing.askingPrice, listing.price)),
    shipping: normalizeNumber(listing.shipping),
    totalCost: normalizeNumber(firstDefined(listing.totalCost, listing.totalPrice)),
    sellerSummary: clone(asObject(listing.sellerSummary)),
    listingState: normalizeString(firstDefined(listing.listingState, listing.state)),
    capturedAt: normalizeDate(firstDefined(listing.capturedAt, listing.createdAt)),
    listingFingerprint: sourceFingerprint(listing),
    sourceArtifactId: sourceId(listing),
    sourceArtifactFingerprint: sourceFingerprint(listing)
  };
}

function normalizeCanonicalIdentityRef(input = {}) {
  const identity = asObject(input);
  return {
    canonicalIdentityId: normalizeString(firstDefined(identity.canonicalIdentityId, identity.identityId, identity.id)),
    canonicalIdentityFingerprint: normalizeString(firstDefined(identity.canonicalIdentityFingerprint, identity.identityFingerprint, identity.fingerprint)),
    canonicalIdentitySummary: normalizeString(firstDefined(identity.canonicalIdentitySummary, identity.summary)),
    legacyParsedIdentityFingerprint: normalizeString(identity.legacyParsedIdentityFingerprint),
    identityEligibility: normalizeString(identity.identityEligibility),
    diagnosticStatus: normalizeString(identity.diagnosticStatus),
    ambiguity: clone(asObject(identity.ambiguity)),
    confirmedFields: clone(asObject(identity.confirmedFields)),
    missingFields: normalizeStringArray(identity.missingFields),
    conflictingFields: normalizeStringArray(identity.conflictingFields),
    inferredFields: clone(asObject(identity.inferredFields)),
    warnings: normalizeStringArray(identity.warnings),
    blockingIssues: normalizeStringArray(firstDefined(identity.blockingIssues, identity.blockers))
  };
}

function normalizeSignalRef(signal = {}) {
  const input = asObject(signal);
  const signalName = normalizeString(firstDefined(input.signalName, input.signalFamily, input.name));
  return {
    signalFamily: normalizeString(firstDefined(input.signalFamily, signalName)),
    signalName,
    signalVersion: normalizeString(firstDefined(input.signalVersion, input.version)),
    signalId: normalizeString(firstDefined(input.signalId, input.id)),
    signalFingerprint: normalizeString(firstDefined(input.signalFingerprint, input.fingerprint)),
    alignmentId: normalizeString(input.alignmentId),
    alignmentFingerprint: normalizeString(input.alignmentFingerprint),
    migrationFingerprint: normalizeString(input.migrationFingerprint),
    shadowComparisonFingerprint: normalizeString(input.shadowComparisonFingerprint),
    reportFingerprint: normalizeString(input.reportFingerprint),
    coverageStatus: normalizeString(firstDefined(input.coverageStatus, input.status, 'available')),
    parityStatus: normalizeString(input.parityStatus),
    authorityStatus: normalizeString(firstDefined(input.authorityStatus, 'none')),
    sourceOutputFingerprint: normalizeString(firstDefined(input.sourceOutputFingerprint, input.sourceFingerprint)),
    summary: normalizeString(input.summary),
    metadata: clone(asObject(input.metadata))
  };
}

function sortSignalRefs(signalRefs = []) {
  return asArray(signalRefs)
    .map(normalizeSignalRef)
    .sort((left, right) => `${left.signalName}|${left.signalVersion}|${left.signalFingerprint}`.localeCompare(`${right.signalName}|${right.signalVersion}|${right.signalFingerprint}`));
}

function normalizeValuationRefs(input = {}) {
  const values = asObject(input);
  return {
    productionValuation: normalizeReference(values.productionValuation, { referenceType: 'production_valuation' }),
    rangeFirstValuation: normalizeReference(values.rangeFirstValuation, { referenceType: 'range_first_valuation' }),
    shadowValuation: normalizeReference(values.shadowValuation, { referenceType: 'shadow_valuation' }),
    marketValueReference: normalizeReference(values.marketValueReference, { referenceType: 'market_value_reference' }),
    estimatedValue: normalizeNumber(values.estimatedValue),
    estimatedProfit: normalizeNumber(values.estimatedProfit),
    roi: normalizeNumber(values.roi),
    floorValue: normalizeNumber(values.floorValue),
    expectedValue: normalizeNumber(values.expectedValue),
    ceilingValue: normalizeNumber(values.ceilingValue),
    valuationConfidence: normalizeNumber(values.valuationConfidence),
    valuationRangeQuality: normalizeString(values.valuationRangeQuality),
    valuationSourceFingerprints: normalizeStringArray(values.valuationSourceFingerprints),
    valuationWarnings: normalizeStringArray(values.valuationWarnings),
    valuationBlockers: normalizeStringArray(values.valuationBlockers)
  };
}

function normalizeObservation(input = {}, defaults = {}) {
  const source = asObject(input);
  return {
    observationId: sourceId(source, firstDefined(defaults.id, defaults.observationId)),
    observationType: normalizeString(firstDefined(source.observationType, source.type, defaults.observationType)),
    source: normalizeString(firstDefined(source.source, defaults.source)),
    sourceArtifactId: sourceId(source),
    sourceFingerprint: sourceFingerprint(source),
    schemaVersion: normalizeString(firstDefined(source.schemaVersion, source.version)),
    status: normalizeString(firstDefined(source.status, source.decision, source.recommendation)),
    observedAt: normalizeDate(firstDefined(source.observedAt, source.createdAt, defaults.observedAt)),
    summary: normalizeString(source.summary),
    values: clone(asObject(firstDefined(source.values, source.details, source))),
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
}

function normalizeMissingReference(input = {}) {
  if (typeof input === 'string') {
    return {
      referenceName: normalizeString(input),
      referenceType: UNKNOWN_VALUE,
      required: false,
      reason: 'not_supplied',
      impact: 'review_only',
      blocking: false
    };
  }
  const ref = asObject(input);
  return {
    referenceName: normalizeString(firstDefined(ref.referenceName, ref.name, ref.field)),
    referenceType: normalizeString(firstDefined(ref.referenceType, ref.type)),
    required: normalizeBoolean(ref.required),
    reason: normalizeString(ref.reason),
    impact: normalizeString(firstDefined(ref.impact, 'review_only')),
    blocking: normalizeBoolean(ref.blocking)
  };
}

function normalizeEvidenceGap(input = {}) {
  if (typeof input === 'string') {
    return {
      gapId: `gap:${normalizeString(input).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || UNKNOWN_VALUE}`,
      category: UNKNOWN_VALUE,
      description: normalizeString(input),
      expectedEvidence: UNKNOWN_VALUE,
      missingArtifactType: UNKNOWN_VALUE,
      missingSignalName: UNKNOWN_VALUE,
      reviewImpact: 'review_only',
      certificationImpact: UNKNOWN_VALUE,
      blocking: false
    };
  }
  const gap = asObject(input);
  return {
    gapId: normalizeString(firstDefined(gap.gapId, gap.id)),
    category: normalizeString(gap.category),
    description: normalizeString(gap.description),
    expectedEvidence: normalizeString(gap.expectedEvidence),
    missingArtifactType: normalizeString(gap.missingArtifactType),
    missingSignalName: normalizeString(gap.missingSignalName),
    reviewImpact: normalizeString(firstDefined(gap.reviewImpact, 'review_only')),
    certificationImpact: normalizeString(gap.certificationImpact),
    blocking: normalizeBoolean(gap.blocking)
  };
}

function normalizeUnknownValue(input = {}) {
  if (typeof input === 'string') {
    return {
      field: normalizeString(input),
      category: UNKNOWN_VALUE,
      reason: 'missing_or_unknown',
      source: UNKNOWN_VALUE,
      expectedSource: UNKNOWN_VALUE,
      impact: UNKNOWN_VALUE,
      blocking: false
    };
  }
  const unknown = asObject(input);
  return {
    field: normalizeString(unknown.field),
    category: normalizeString(unknown.category),
    reason: normalizeString(unknown.reason),
    source: normalizeString(unknown.source),
    expectedSource: normalizeString(unknown.expectedSource),
    impact: normalizeString(unknown.impact),
    blocking: normalizeBoolean(unknown.blocking)
  };
}

function sortMissingReferences(values = []) {
  return asArray(values)
    .map(normalizeMissingReference)
    .sort((left, right) => `${left.required ? 0 : 1}|${left.referenceType}|${left.referenceName}`.localeCompare(`${right.required ? 0 : 1}|${right.referenceType}|${right.referenceName}`));
}

function sortEvidenceGaps(values = []) {
  return asArray(values)
    .map(normalizeEvidenceGap)
    .sort((left, right) => `${left.blocking ? 0 : 1}|${left.category}|${left.missingSignalName}|${left.description}|${left.gapId}`.localeCompare(`${right.blocking ? 0 : 1}|${right.category}|${right.missingSignalName}|${right.description}|${right.gapId}`));
}

function sortUnknownValues(values = []) {
  return asArray(values)
    .map(normalizeUnknownValue)
    .sort((left, right) => `${left.blocking ? 0 : 1}|${left.category}|${left.field}|${left.reason}`.localeCompare(`${right.blocking ? 0 : 1}|${right.category}|${right.field}|${right.reason}`));
}

function buildMissingSignalReferences(signalRefs = [], expectedSignalNames = EXPECTED_SIGNAL_NAMES) {
  const present = new Set(asArray(signalRefs).map((signal) => signal.signalName));
  return asArray(expectedSignalNames)
    .filter((signalName) => !present.has(signalName))
    .sort()
    .map((signalName) => normalizeMissingReference({
      referenceName: signalName,
      referenceType: 'canonical_intelligence_signal',
      required: false,
      reason: 'expected_signal_not_supplied',
      impact: 'blocks_certification',
      blocking: false
    }));
}

function buildRequiredReferenceFindings(bundle = {}) {
  const findings = [];
  const input = asObject(bundle);
  const checks = [
    ['listingRef.listingId', asObject(input.listingRef).listingId],
    ['canonicalIdentityRef.canonicalIdentityId', asObject(input.canonicalIdentityRef).canonicalIdentityId],
    ['productionScoringObservation.sourceFingerprint', asObject(input.productionScoringObservation).sourceFingerprint],
    ['dealGateObservation.sourceFingerprint', asObject(input.dealGateObservation).sourceFingerprint]
  ];

  for (const [field, value] of checks) {
    if (!known(value) || value === UNKNOWN_VALUE) {
      findings.push(normalizeMissingReference({
        referenceName: field,
        referenceType: 'required_reference',
        required: true,
        reason: 'required_reference_missing',
        impact: 'blocks_artifact_building',
        blocking: true
      }));
    }
  }
  return findings;
}

function buildEvidenceGapFromMissingReference(reference = {}) {
  return normalizeEvidenceGap({
    gapId: `missing-reference:${reference.referenceName}`,
    category: 'reference',
    description: `Missing evidence reference: ${reference.referenceName}.`,
    expectedEvidence: reference.referenceName,
    missingArtifactType: reference.referenceType,
    reviewImpact: reference.impact,
    certificationImpact: reference.required ? 'blocks_artifact_building' : 'blocks_certification',
    blocking: reference.blocking
  });
}

function buildBuilderInput(bundle = {}) {
  const input = asObject(bundle);
  return {
    artifactId: normalizeString(firstDefined(input.artifactId, `decision-intelligence-artifact:${asObject(input.listingRef).listingId}`)),
    createdAt: input.createdAt,
    capturedAt: input.capturedAt,
    listingRef: clone(input.listingRef),
    canonicalIdentityRef: clone(input.canonicalIdentityRef),
    signalRefs: asArray(input.signalRefs).map((signal) => clone(signal)),
    valuationRefs: clone(input.valuationRefs),
    productionDecisionRef: clone(asObject(input.productionScoringObservation).values),
    dealGateRef: clone(asObject(input.dealGateObservation).values),
    buyNowRef: clone(asObject(input.buyNowObservation).values),
    shadowRefs: clone(asObject(firstDefined(input.shadowRefs, {}))),
    governanceRefs: clone(input.governanceRefs),
    evidenceQualityAssessment: clone(asObject(input.evidenceReadinessRefs)),
    comparableQualityAssessment: clone(asObject(input.comparableQualityRefs)),
    unknownValues: asArray(input.unknownValues).map((item) => clone(item)),
    outstandingEvidenceGaps: asArray(input.evidenceGaps).map((item) => clone(item)),
    provenance: {
      sourceSystem: 'decision_intelligence_evidence_bundle',
      createdBy: normalizeString(asObject(input.provenance).createdBy),
      reviewBatchId: normalizeString(asObject(input.provenance).reviewBatchId),
      inputArtifactIds: normalizeStringArray([
        input.bundleId,
        ...asArray(input.signalRefs).map((signal) => signal.signalId),
        asObject(input.listingRef).sourceArtifactId,
        asObject(input.canonicalIdentityRef).canonicalIdentityId,
        asObject(input.productionScoringObservation).sourceArtifactId,
        asObject(input.dealGateObservation).sourceArtifactId
      ]),
      inputFingerprints: normalizeStringArray([
        input.bundleFingerprint,
        ...asArray(input.signalRefs).map((signal) => signal.signalFingerprint),
        asObject(input.listingRef).sourceArtifactFingerprint,
        asObject(input.canonicalIdentityRef).canonicalIdentityFingerprint,
        asObject(input.productionScoringObservation).sourceFingerprint,
        asObject(input.dealGateObservation).sourceFingerprint
      ])
    }
  };
}

function buildDecisionIntelligenceEvidenceBundleFingerprint(bundle = {}) {
  const projection = clone(bundle);
  delete projection.bundleFingerprint;
  if (projection.builderInput) delete projection.builderInput.provenance.inputFingerprints;
  return buildFingerprintFromProjection(projection);
}

function buildDecisionIntelligenceEvidenceBundle(input = {}) {
  const source = asObject(input);
  const signalRefs = sortSignalRefs(firstDefined(source.signalRefs, source.signals));
  const expectedSignalNames = asArray(firstDefined(source.expectedSignalNames, EXPECTED_SIGNAL_NAMES));
  const listingRef = normalizeListingRef(firstDefined(source.listingRef, source.listing));
  const canonicalIdentityRef = normalizeCanonicalIdentityRef(firstDefined(source.canonicalIdentityRef, source.canonicalIdentity));
  const valuationRefs = normalizeValuationRefs(firstDefined(source.valuationRefs, source.valuation));
  const comparableQualityRefs = clone(asObject(firstDefined(source.comparableQualityRefs, source.comparableQuality)));
  const evidenceReadinessRefs = clone(asObject(firstDefined(source.evidenceReadinessRefs, source.evidenceReadiness)));
  const productionScoringObservation = normalizeObservation(firstDefined(source.productionScoringObservation, source.productionDecisionRef, source.productionDecision), {
    observationType: 'production_scoring'
  });
  const dealGateObservation = normalizeObservation(firstDefined(source.dealGateObservation, source.dealGateRef, source.dealGate), {
    observationType: 'deal_gate'
  });
  const buyNowObservation = normalizeObservation(firstDefined(source.buyNowObservation, source.buyNowRef, source.buyNow), {
    observationType: 'buy_now'
  });
  const governanceRefs = asArray(firstDefined(source.governanceRefs, source.governanceReferences)).map((reference) => normalizeReference(reference, { referenceType: 'governance_artifact' }));
  const suppliedMissingRefs = sortMissingReferences(source.missingReferences);
  const missingReferences = sortMissingReferences([
    ...suppliedMissingRefs,
    ...buildMissingSignalReferences(signalRefs, expectedSignalNames)
  ]);
  const requiredFindings = buildRequiredReferenceFindings({
    listingRef,
    canonicalIdentityRef,
    productionScoringObservation,
    dealGateObservation
  });
  const evidenceGaps = sortEvidenceGaps([
    ...asArray(source.evidenceGaps).map(normalizeEvidenceGap),
    ...missingReferences.map(buildEvidenceGapFromMissingReference),
    ...requiredFindings.map(buildEvidenceGapFromMissingReference)
  ]);
  const core = {
    schemaVersion: DECISION_INTELLIGENCE_EVIDENCE_BUNDLE_SCHEMA_VERSION,
    source: DECISION_INTELLIGENCE_EVIDENCE_BUNDLE_SOURCE,
    bundleId: normalizeString(firstDefined(source.bundleId, source.id, `decision-intelligence-evidence-bundle:${listingRef.listingId}`)),
    bundleType: 'decision_intelligence_evidence_bundle',
    createdAt: normalizeDate(source.createdAt),
    capturedAt: normalizeDate(firstDefined(source.capturedAt, listingRef.capturedAt)),
    listingRef,
    canonicalIdentityRef,
    signalRefs,
    valuationRefs,
    comparableQualityRefs,
    evidenceReadinessRefs,
    productionScoringObservation,
    dealGateObservation,
    buyNowObservation,
    governanceRefs,
    missingReferences: sortMissingReferences([...missingReferences, ...requiredFindings]),
    evidenceGaps,
    unknownValues: sortUnknownValues(source.unknownValues),
    provenance: {
      sourceSystem: normalizeString(firstDefined(asObject(source.provenance).sourceSystem, 'cardhawk_offline_validation')),
      builderName: DECISION_INTELLIGENCE_EVIDENCE_BUNDLE_SOURCE,
      builderVersion: '1.0.0',
      createdBy: normalizeString(asObject(source.provenance).createdBy),
      createdAt: normalizeDate(firstDefined(asObject(source.provenance).createdAt, source.createdAt)),
      capturedAt: normalizeDate(firstDefined(asObject(source.provenance).capturedAt, source.capturedAt, listingRef.capturedAt)),
      inputArtifactIds: normalizeStringArray(firstDefined(asObject(source.provenance).inputArtifactIds, [
        listingRef.sourceArtifactId,
        canonicalIdentityRef.canonicalIdentityId,
        productionScoringObservation.sourceArtifactId,
        dealGateObservation.sourceArtifactId,
        buyNowObservation.sourceArtifactId,
        ...signalRefs.map((signal) => signal.signalId),
        ...governanceRefs.map((reference) => reference.sourceArtifactId)
      ])),
      inputFingerprints: normalizeStringArray(firstDefined(asObject(source.provenance).inputFingerprints, [
        listingRef.sourceArtifactFingerprint,
        canonicalIdentityRef.canonicalIdentityFingerprint,
        productionScoringObservation.sourceFingerprint,
        dealGateObservation.sourceFingerprint,
        buyNowObservation.sourceFingerprint,
        ...signalRefs.map((signal) => signal.signalFingerprint),
        ...governanceRefs.map((reference) => reference.sourceFingerprint)
      ])),
      reviewBatchId: normalizeString(asObject(source.provenance).reviewBatchId),
      workspaceId: normalizeString(asObject(source.provenance).workspaceId)
    },
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
  const bundleWithoutBuilderInput = {
    ...core,
    bundleFingerprint: buildDecisionIntelligenceEvidenceBundleFingerprint(core)
  };
  const bundle = {
    ...bundleWithoutBuilderInput,
    builderInput: buildBuilderInput(bundleWithoutBuilderInput)
  };
  return deepFreeze({
    ...bundle,
    bundleFingerprint: buildDecisionIntelligenceEvidenceBundleFingerprint(bundle)
  });
}

function missingRequiredFields(bundle = {}) {
  const input = asObject(bundle);
  return REQUIRED_BUNDLE_FIELDS.filter((field) => {
    const value = input[field];
    return value === undefined || value === null || value === '';
  });
}

function getPathValue(root = {}, path = '') {
  return path.split('.').reduce((value, part) => (value && typeof value === 'object' ? value[part] : undefined), root);
}

function validateDecisionIntelligenceEvidenceBundle(bundle = {}) {
  const input = asObject(bundle);
  const errors = [];
  const warnings = [];
  const missingReferences = [];
  const fingerprintViolations = [];
  const authorityViolations = [];
  const referenceViolations = [];
  const evidenceGapViolations = [];
  const unknownValueViolations = [];
  const missingFields = missingRequiredFields(input);

  for (const field of missingFields) {
    errors.push(validationIssue('missing_required_field', `${field} is required.`, field));
  }
  if (input.schemaVersion !== DECISION_INTELLIGENCE_EVIDENCE_BUNDLE_SCHEMA_VERSION) {
    errors.push(validationIssue('invalid_schema_version', 'schemaVersion must match the Decision Intelligence Evidence Bundle contract.', 'schemaVersion'));
  }
  if (input.source !== DECISION_INTELLIGENCE_EVIDENCE_BUNDLE_SOURCE) {
    errors.push(validationIssue('invalid_source', 'source must be decision_intelligence_evidence_bundle.', 'source'));
  }
  for (const field of ['productionImpact', 'decisionImpact', 'executionAuthority']) {
    if (input[field] !== 'none') {
      errors.push(validationIssue('authority_boundary_violation', `${field} must remain none.`, field));
      authorityViolations.push(field);
    }
  }
  for (const field of REQUIRED_REFERENCE_FIELDS) {
    const value = getPathValue(input, field);
    if (!known(value) || value === UNKNOWN_VALUE) {
      errors.push(validationIssue('required_reference_missing', `${field} is required.`, field));
      missingReferences.push(field);
      referenceViolations.push(field);
    }
  }
  asArray(input.signalRefs).forEach((signal, index) => {
    if (!known(signal.signalName) || signal.signalName === UNKNOWN_VALUE) {
      errors.push(validationIssue('signal_reference_name_missing', 'Signal references must include signalName.', `signalRefs.${index}.signalName`));
      referenceViolations.push(`signalRefs.${index}.signalName`);
    }
    if (!known(signal.signalFingerprint) || signal.signalFingerprint === UNKNOWN_VALUE) {
      warnings.push(validationIssue('signal_reference_fingerprint_missing', 'Signal references should include signalFingerprint.', `signalRefs.${index}.signalFingerprint`));
      referenceViolations.push(`signalRefs.${index}.signalFingerprint`);
    }
    if (signal.authorityStatus && signal.authorityStatus !== 'none' && signal.authorityStatus !== UNKNOWN_VALUE) {
      errors.push(validationIssue('signal_authority_violation', 'Signal references must remain non-authoritative.', `signalRefs.${index}.authorityStatus`));
      authorityViolations.push(`signalRefs.${index}.authorityStatus`);
    }
  });
  asArray(input.missingReferences).forEach((reference, index) => {
    if (reference.required === true) {
      warnings.push(validationIssue('required_reference_reported_missing', 'A required evidence reference is explicitly missing.', `missingReferences.${index}.referenceName`));
      missingReferences.push(reference.referenceName);
    }
  });
  asArray(input.evidenceGaps).forEach((gap, index) => {
    if (!known(gap.description) || gap.description === UNKNOWN_VALUE) {
      errors.push(validationIssue('evidence_gap_description_missing', 'Evidence gaps must include descriptions.', `evidenceGaps.${index}.description`));
      evidenceGapViolations.push(`evidenceGaps.${index}.description`);
    }
  });
  asArray(input.unknownValues).forEach((unknown, index) => {
    if (!known(unknown.field) || unknown.field === UNKNOWN_VALUE) {
      errors.push(validationIssue('unknown_value_field_missing', 'Unknown value entries must identify the field.', `unknownValues.${index}.field`));
      unknownValueViolations.push(`unknownValues.${index}.field`);
    }
  });
  if (known(input.bundleFingerprint) && buildDecisionIntelligenceEvidenceBundleFingerprint(input) !== input.bundleFingerprint) {
    errors.push(validationIssue('bundle_fingerprint_mismatch', 'bundleFingerprint does not match bundle contents.', 'bundleFingerprint'));
    fingerprintViolations.push('bundleFingerprint');
  }
  if (!input.builderInput || typeof input.builderInput !== 'object') {
    errors.push(validationIssue('builder_input_missing', 'builderInput is required for direct artifact-builder consumption.', 'builderInput'));
  } else {
    const artifact = buildDecisionIntelligenceArtifact(input.builderInput);
    const artifactValidation = validateDecisionIntelligenceArtifact(artifact);
    if (!artifactValidation.valid) {
      errors.push(validationIssue('builder_input_invalid', 'builderInput did not produce a valid Decision Intelligence artifact.', 'builderInput'));
    }
  }

  const allIssues = [...errors, ...warnings];
  return deepFreeze({
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes: summarizeIssues(errors, warnings),
    missingRequiredFields: missingFields,
    missingReferences: unique(missingReferences).sort(),
    fingerprintViolations: unique(fingerprintViolations).sort(),
    authorityViolations: unique(authorityViolations).sort(),
    referenceViolations: unique(referenceViolations).sort(),
    evidenceGapViolations: unique(evidenceGapViolations).sort(),
    unknownValueViolations: unique(unknownValueViolations).sort()
  });
}

function summarizeDecisionIntelligenceEvidenceBundle(bundle = {}) {
  const input = asObject(bundle);
  const validation = validateDecisionIntelligenceEvidenceBundle(input);
  const signalRefs = asArray(input.signalRefs);
  const missing = asArray(input.missingReferences);
  const gaps = asArray(input.evidenceGaps);
  return deepFreeze({
    bundleId: normalizeString(input.bundleId),
    listingId: normalizeString(asObject(input.listingRef).listingId),
    signalReferenceCount: signalRefs.length,
    missingReferenceCount: missing.length,
    requiredMissingReferenceCount: missing.filter((reference) => reference.required === true).length,
    evidenceGapCount: gaps.length,
    blockingEvidenceGapCount: gaps.filter((gap) => gap.blocking === true).length,
    unknownValueCount: asArray(input.unknownValues).length,
    governanceReferenceCount: asArray(input.governanceRefs).length,
    valid: validation.valid,
    readyForArtifactBuilder: validation.valid === true,
    readyForGovernanceBinding: validation.valid === true && gaps.every((gap) => gap.blocking !== true),
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  });
}

function compareDecisionIntelligenceEvidenceBundles(left = {}, right = {}) {
  const leftBundle = asObject(left);
  const rightBundle = asObject(right);
  const fields = unique([...Object.keys(leftBundle), ...Object.keys(rightBundle)]).sort();
  const fieldComparisons = [];
  const mismatches = [];
  for (const field of fields) {
    const leftValue = leftBundle[field];
    const rightValue = rightBundle[field];
    const equal = JSON.stringify(leftValue) === JSON.stringify(rightValue);
    fieldComparisons.push({
      field,
      status: equal ? 'match' : 'mismatch',
      leftValue: clone(leftValue),
      rightValue: clone(rightValue)
    });
    if (!equal) {
      mismatches.push({
        field,
        reasonCode: 'bundle_field_mismatch',
        leftFingerprint: field === 'bundleFingerprint' ? normalizeString(leftValue) : UNKNOWN_VALUE,
        rightFingerprint: field === 'bundleFingerprint' ? normalizeString(rightValue) : UNKNOWN_VALUE
      });
    }
  }
  const core = {
    schemaVersion: DECISION_INTELLIGENCE_EVIDENCE_BUNDLE_SCHEMA_VERSION,
    source: DECISION_INTELLIGENCE_EVIDENCE_BUNDLE_SOURCE,
    comparedAt: normalizeDate(firstDefined(leftBundle.createdAt, rightBundle.createdAt)),
    leftBundleId: normalizeString(leftBundle.bundleId),
    rightBundleId: normalizeString(rightBundle.bundleId),
    leftBundleFingerprint: normalizeString(leftBundle.bundleFingerprint),
    rightBundleFingerprint: normalizeString(rightBundle.bundleFingerprint),
    parityStatus: mismatches.length ? 'mismatch' : 'exact_match',
    mismatchCount: mismatches.length,
    fieldComparisons,
    mismatches,
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
  return deepFreeze({
    ...core,
    comparisonFingerprint: buildFingerprintFromProjection(core)
  });
}

module.exports = {
  DECISION_INTELLIGENCE_EVIDENCE_BUNDLE_SCHEMA_VERSION,
  DECISION_INTELLIGENCE_EVIDENCE_BUNDLE_SOURCE,
  REQUIRED_BUNDLE_FIELDS,
  buildDecisionIntelligenceEvidenceBundle,
  validateDecisionIntelligenceEvidenceBundle,
  summarizeDecisionIntelligenceEvidenceBundle,
  buildDecisionIntelligenceEvidenceBundleFingerprint,
  compareDecisionIntelligenceEvidenceBundles
};
