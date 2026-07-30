'use strict';

const { asArray, asObject, unique } = require('./canonicalValidationCore');
const { buildFingerprintFromProjection } = require('./fingerprintProjection');
const { clone, firstDefined } = require('./phase8GovernanceCore');

const DECISION_INTELLIGENCE_ARTIFACT_SCHEMA_VERSION = 'decision_intelligence_artifact.v1';
const DECISION_INTELLIGENCE_ARTIFACT_SOURCE = 'decision_intelligence_artifact_builder';
const UNKNOWN_VALUE = 'unknown';

const EXPECTED_SIGNAL_NAMES = Object.freeze([
  'canonical.sold_evidence.diagnostics',
  'comparable.quality.diagnostics',
  'confidence.calibration.diagnostics',
  'decision.context.diagnostics',
  'decision.deal_gate.diagnostics',
  'evidence.readiness.diagnostics',
  'false_positive.risk.diagnostics',
  'grade.premium.engine',
  'identity.parser.diagnostics',
  'listing.quality.grading.diagnostics',
  'population.intelligence.engine',
  'production.valuation.diagnostics',
  'valuation.range_first.diagnostics'
]);

const RECOMMENDATION_TYPES = Object.freeze([
  'advisory_buy_candidate',
  'advisory_watch',
  'advisory_monitor',
  'advisory_pass',
  'advisory_review_required',
  UNKNOWN_VALUE
]);

const RECOMMENDATION_POSTURES = Object.freeze([
  'supportive',
  'cautious',
  'blocked',
  'conflicted',
  'insufficient_evidence',
  UNKNOWN_VALUE
]);

const CONFIDENCE_POSTURES = Object.freeze([
  'high',
  'moderate',
  'limited',
  'low',
  'conflicted',
  UNKNOWN_VALUE
]);

const RISK_POSTURES = Object.freeze([
  'low',
  'moderate',
  'elevated',
  'high',
  'critical',
  UNKNOWN_VALUE
]);

const OPPORTUNITY_POSTURES = Object.freeze([
  'strong',
  'promising',
  'watch',
  'limited',
  'not_supported',
  UNKNOWN_VALUE
]);

const AGREEMENT_STATUSES = Object.freeze([
  'agreement',
  'partial_agreement',
  'disagreement',
  'conflicted',
  'insufficient_evidence',
  UNKNOWN_VALUE
]);

const REQUIRED_ARTIFACT_FIELDS = Object.freeze([
  'schemaVersion',
  'source',
  'artifactId',
  'artifactType',
  'createdAt',
  'capturedAt',
  'listingRef',
  'canonicalIdentityRef',
  'signalRefs',
  'valuationRefs',
  'productionDecisionRef',
  'dealGateRef',
  'buyNowRef',
  'shadowRefs',
  'governanceRefs',
  'confidenceInterpretation',
  'evidenceQualityAssessment',
  'comparableQualityAssessment',
  'agreementAnalysis',
  'riskAssessment',
  'opportunityAssessment',
  'explanationSummary',
  'advisoryRecommendation',
  'supportingReasons',
  'opposingReasons',
  'unknownValues',
  'outstandingEvidenceGaps',
  'provenance',
  'immutability',
  'compatibility',
  'productionImpact',
  'decisionImpact',
  'executionAuthority',
  'artifactFingerprint'
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

function normalizeEnum(value, allowedValues, fallback = UNKNOWN_VALUE) {
  const normalized = normalizeString(value, fallback).toLowerCase();
  return allowedValues.includes(normalized) ? normalized : fallback;
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

function buildDecisionIntelligenceArtifactFingerprint(artifact = {}) {
  const projection = clone(artifact);
  delete projection.artifactFingerprint;
  return buildFingerprintFromProjection(projection);
}

function sourceFingerprint(source = {}, fallback = UNKNOWN_VALUE) {
  const input = asObject(source);
  return normalizeString(firstDefined(
    input.sourceFingerprint,
    input.fingerprint,
    input.artifactFingerprint,
    input.signalFingerprint,
    input.alignmentFingerprint,
    input.migrationFingerprint,
    input.shadowComparisonFingerprint,
    input.reportFingerprint,
    input.valuationFingerprint,
    input.decisionFingerprint,
    input.dealGateFingerprint,
    input.identityFingerprint,
    input.listingFingerprint,
    fallback
  ));
}

function sourceId(source = {}, fallback = UNKNOWN_VALUE) {
  const input = asObject(source);
  return normalizeString(firstDefined(
    input.sourceArtifactId,
    input.artifactId,
    input.signalId,
    input.alignmentId,
    input.reportId,
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

function normalizeReference(reference = {}, defaults = {}) {
  const input = asObject(reference);
  const id = sourceId(input, firstDefined(defaults.id, defaults.sourceArtifactId, UNKNOWN_VALUE));
  const fingerprint = sourceFingerprint(input, firstDefined(defaults.fingerprint, defaults.sourceFingerprint, UNKNOWN_VALUE));
  return {
    referenceId: id,
    referenceType: normalizeString(firstDefined(input.referenceType, input.type, defaults.referenceType)),
    source: normalizeString(firstDefined(input.source, defaults.source)),
    sourceArtifactId: id,
    sourceFingerprint: fingerprint,
    schemaVersion: normalizeString(firstDefined(input.schemaVersion, input.version, defaults.schemaVersion)),
    status: normalizeString(firstDefined(input.status, input.reviewStatus, defaults.status, UNKNOWN_VALUE)),
    summary: normalizeString(firstDefined(input.summary, defaults.summary, UNKNOWN_VALUE)),
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

function normalizeProductionDecisionRef(input = {}) {
  const decision = asObject(input);
  return {
    decisionEngineRef: normalizeReference(decision.decisionEngineRef || decision, { referenceType: 'decision_engine' }),
    decisionEngineFingerprint: normalizeString(firstDefined(decision.decisionEngineFingerprint, decision.decisionFingerprint, decision.fingerprint)),
    decision: normalizeString(decision.decision),
    recommendation: normalizeString(decision.recommendation),
    action: normalizeString(decision.action),
    decisionScore: normalizeNumber(firstDefined(decision.decisionScore, decision.score, decision.finalScore)),
    evidenceScore: normalizeNumber(decision.evidenceScore),
    opportunityScore: normalizeNumber(decision.opportunityScore),
    decisionConfidence: normalizeNumber(firstDefined(decision.decisionConfidence, decision.confidence)),
    decisionMatrix: clone(asObject(decision.decisionMatrix || decision.componentScores)),
    componentScores: clone(asObject(decision.componentScores || decision.decisionMatrix)),
    positives: normalizeStringArray(decision.positives),
    warnings: normalizeStringArray(decision.warnings),
    blockingFactors: normalizeStringArray(decision.blockingFactors),
    summary: normalizeString(decision.summary)
  };
}

function normalizeDealGateRef(input = {}) {
  const gate = asObject(input);
  return {
    dealGateId: normalizeString(firstDefined(gate.dealGateId, gate.id)),
    dealGateFingerprint: normalizeString(firstDefined(gate.dealGateFingerprint, gate.fingerprint)),
    decision: normalizeString(gate.decision),
    recommendation: normalizeString(gate.recommendation),
    passed: normalizeBoolean(gate.passed),
    approved: normalizeBoolean(gate.approved),
    buyNowAllowed: normalizeBoolean(gate.buyNowAllowed),
    reasons: normalizeStringArray(gate.reasons),
    rejectionReasons: normalizeStringArray(gate.rejectionReasons),
    positives: normalizeStringArray(gate.positives),
    dealGateBreakdown: clone(asObject(gate.dealGateBreakdown)),
    ruleOutcomes: asArray(gate.ruleOutcomes).map((item) => clone(item)),
    hardBlockers: normalizeStringArray(firstDefined(gate.hardBlockers, gate.blockers)),
    finalApprovalChecks: asArray(gate.finalApprovalChecks).map((item) => clone(item))
  };
}

function normalizeBuyNowRef(input = {}, dealGateRef = {}) {
  const buyNow = asObject(input);
  return {
    buyNowEligible: normalizeBoolean(firstDefined(buyNow.buyNowEligible, buyNow.buyNowAllowed, dealGateRef.buyNowAllowed)),
    buyNowSource: normalizeString(firstDefined(buyNow.buyNowSource, buyNow.source, 'observed_production_output')),
    buyNowExplanation: normalizeString(firstDefined(buyNow.buyNowExplanation, buyNow.summary)),
    notificationEligible: normalizeBoolean(buyNow.notificationEligible),
    humanReviewRequired: firstDefined(buyNow.humanReviewRequired, true) !== false,
    purchaseAuthority: 'none'
  };
}

function normalizeReason(reason = {}, fallbackCategory = UNKNOWN_VALUE) {
  if (typeof reason === 'string') {
    return {
      reasonId: `reason:${normalizeString(reason).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || UNKNOWN_VALUE}`,
      category: fallbackCategory,
      source: UNKNOWN_VALUE,
      sourceArtifactId: UNKNOWN_VALUE,
      sourceFingerprint: UNKNOWN_VALUE,
      severity: UNKNOWN_VALUE,
      message: normalizeString(reason),
      evidenceRefs: [],
      signalRefs: [],
      ruleRefs: []
    };
  }
  const input = asObject(reason);
  return {
    reasonId: normalizeString(firstDefined(input.reasonId, input.id)),
    category: normalizeString(firstDefined(input.category, fallbackCategory)),
    source: normalizeString(input.source),
    sourceArtifactId: sourceId(input),
    sourceFingerprint: sourceFingerprint(input),
    severity: normalizeString(input.severity),
    message: normalizeString(input.message),
    evidenceRefs: asArray(input.evidenceRefs).map((item) => normalizeReference(item, { referenceType: 'evidence' })),
    signalRefs: asArray(input.signalRefs).map(normalizeSignalRef),
    ruleRefs: normalizeStringArray(input.ruleRefs)
  };
}

function sortReasons(reasons = []) {
  return asArray(reasons)
    .map((reason) => normalizeReason(reason))
    .sort((left, right) => `${left.category}|${left.severity}|${left.message}|${left.reasonId}`.localeCompare(`${right.category}|${right.severity}|${right.message}|${right.reasonId}`));
}

function normalizeUnknownValue(value = {}) {
  if (typeof value === 'string') {
    return {
      field: normalizeString(value),
      category: UNKNOWN_VALUE,
      reason: 'missing_or_unknown',
      source: UNKNOWN_VALUE,
      expectedSource: UNKNOWN_VALUE,
      impact: UNKNOWN_VALUE,
      blocking: false
    };
  }
  const input = asObject(value);
  return {
    field: normalizeString(input.field),
    category: normalizeString(input.category),
    reason: normalizeString(input.reason),
    source: normalizeString(input.source),
    expectedSource: normalizeString(input.expectedSource),
    impact: normalizeString(input.impact),
    blocking: normalizeBoolean(input.blocking)
  };
}

function normalizeEvidenceGap(gap = {}) {
  if (typeof gap === 'string') {
    return {
      gapId: `gap:${normalizeString(gap).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || UNKNOWN_VALUE}`,
      category: UNKNOWN_VALUE,
      description: normalizeString(gap),
      expectedEvidence: UNKNOWN_VALUE,
      missingArtifactType: UNKNOWN_VALUE,
      missingSignalName: UNKNOWN_VALUE,
      reviewImpact: 'review_only',
      certificationImpact: 'blocks_certification',
      blocking: false
    };
  }
  const input = asObject(gap);
  return {
    gapId: normalizeString(firstDefined(input.gapId, input.id)),
    category: normalizeString(input.category),
    description: normalizeString(input.description),
    expectedEvidence: normalizeString(input.expectedEvidence),
    missingArtifactType: normalizeString(input.missingArtifactType),
    missingSignalName: normalizeString(input.missingSignalName),
    reviewImpact: normalizeString(firstDefined(input.reviewImpact, 'review_only')),
    certificationImpact: normalizeString(firstDefined(input.certificationImpact, UNKNOWN_VALUE)),
    blocking: normalizeBoolean(input.blocking)
  };
}

function sortUnknownValues(values = []) {
  return asArray(values)
    .map(normalizeUnknownValue)
    .sort((left, right) => `${left.category}|${left.field}|${left.reason}`.localeCompare(`${right.category}|${right.field}|${right.reason}`));
}

function sortEvidenceGaps(gaps = []) {
  return asArray(gaps)
    .map(normalizeEvidenceGap)
    .sort((left, right) => `${left.category}|${left.missingSignalName}|${left.description}|${left.gapId}`.localeCompare(`${right.category}|${right.missingSignalName}|${right.description}|${right.gapId}`));
}

function buildMissingSignalGaps(signalRefs = [], expectedSignalNames = EXPECTED_SIGNAL_NAMES) {
  const present = new Set(asArray(signalRefs).map((signal) => signal.signalName));
  return asArray(expectedSignalNames)
    .filter((signalName) => !present.has(signalName))
    .sort()
    .map((signalName) => normalizeEvidenceGap({
      gapId: `missing-signal:${signalName}`,
      category: 'signal',
      description: `Expected Signal reference is missing: ${signalName}.`,
      expectedEvidence: 'canonical_signal_reference',
      missingArtifactType: 'canonical_intelligence_signal',
      missingSignalName: signalName,
      reviewImpact: 'review_only',
      certificationImpact: 'blocks_certification',
      blocking: false
    }));
}

function deriveDecisionEvidence(input = {}) {
  const artifactInput = asObject(input);
  const signalRefs = sortSignalRefs(artifactInput.signalRefs || artifactInput.signals);
  const expectedSignalNames = asArray(firstDefined(artifactInput.expectedSignalNames, EXPECTED_SIGNAL_NAMES));
  const suppliedGaps = sortEvidenceGaps(artifactInput.outstandingEvidenceGaps || artifactInput.evidenceGaps);
  const missingSignalGaps = buildMissingSignalGaps(signalRefs, expectedSignalNames);
  const outstandingEvidenceGaps = sortEvidenceGaps([...suppliedGaps, ...missingSignalGaps]);

  return deepFreeze({
    listingRef: normalizeListingRef(artifactInput.listingRef || artifactInput.listing),
    canonicalIdentityRef: normalizeCanonicalIdentityRef(artifactInput.canonicalIdentityRef || artifactInput.canonicalIdentity),
    signalRefs,
    valuationRefs: normalizeValuationRefs(artifactInput.valuationRefs || artifactInput.valuation),
    productionDecisionRef: normalizeProductionDecisionRef(artifactInput.productionDecisionRef || artifactInput.productionDecision),
    dealGateRef: normalizeDealGateRef(artifactInput.dealGateRef || artifactInput.dealGate),
    shadowRefs: clone(asObject(artifactInput.shadowRefs || artifactInput.shadow)),
    governanceRefs: clone(asObject(artifactInput.governanceRefs || artifactInput.governance)),
    unknownValues: sortUnknownValues(artifactInput.unknownValues),
    outstandingEvidenceGaps
  });
}

function confidencePostureFromValue(value) {
  const number = normalizeNumber(value, NaN);
  if (!Number.isFinite(number)) return UNKNOWN_VALUE;
  if (number >= 80) return 'high';
  if (number >= 60) return 'moderate';
  if (number >= 40) return 'limited';
  return 'low';
}

function deriveDecisionConfidence(input = {}, evidence = null) {
  const source = asObject(input);
  const decisionEvidence = evidence || deriveDecisionEvidence(source);
  const explicit = asObject(source.confidenceInterpretation);
  const decisionConfidence = normalizeNumber(firstDefined(
    explicit.decisionConfidence,
    decisionEvidence.productionDecisionRef.decisionConfidence
  ));
  const valuationConfidence = normalizeNumber(firstDefined(
    explicit.valuationConfidence,
    decisionEvidence.valuationRefs.valuationConfidence
  ));
  const identityConfidence = normalizeNumber(explicit.identityConfidence);
  const evidenceConfidence = normalizeNumber(explicit.evidenceConfidence);
  const comparableConfidence = normalizeNumber(explicit.comparableConfidence);
  const conflicts = sortReasons(firstDefined(explicit.confidenceConflicts, []));
  const posture = normalizeEnum(
    firstDefined(explicit.overallConfidencePosture, conflicts.length ? 'conflicted' : confidencePostureFromValue(decisionConfidence)),
    CONFIDENCE_POSTURES
  );

  return deepFreeze({
    overallConfidencePosture: posture,
    decisionConfidence,
    valuationConfidence,
    identityConfidence,
    evidenceConfidence,
    comparableConfidence,
    confidenceCalibrationStatus: normalizeString(explicit.confidenceCalibrationStatus),
    overconfidenceRisks: normalizeStringArray(explicit.overconfidenceRisks),
    underconfidenceRisks: normalizeStringArray(explicit.underconfidenceRisks),
    confidenceConflicts: conflicts,
    confidenceUnknowns: sortUnknownValues(explicit.confidenceUnknowns),
    confidenceExplanation: normalizeString(explicit.confidenceExplanation)
  });
}

function deriveEvidenceQuality(input = {}, evidence = null) {
  const source = asObject(input);
  const decisionEvidence = evidence || deriveDecisionEvidence(source);
  const explicit = asObject(source.evidenceQualityAssessment);
  const trueSoldCount = normalizeNumber(explicit.trueSoldCount);
  return {
    evidenceReadinessStatus: normalizeString(explicit.evidenceReadinessStatus),
    soldEvidenceSufficiency: normalizeString(explicit.soldEvidenceSufficiency),
    canonicalSoldEvidenceStatus: normalizeString(explicit.canonicalSoldEvidenceStatus),
    trueSoldCount,
    activeContextCount: normalizeNumber(explicit.activeContextCount),
    staleEvidenceCount: normalizeNumber(explicit.staleEvidenceCount),
    excludedEvidenceCount: normalizeNumber(explicit.excludedEvidenceCount),
    evidenceQualityScore: normalizeNumber(explicit.evidenceQualityScore),
    evidenceQualityLevel: normalizeString(explicit.evidenceQualityLevel),
    provenanceQuality: normalizeString(explicit.provenanceQuality),
    fallbackEvidenceUsed: normalizeBoolean(explicit.fallbackEvidenceUsed),
    activeOnlyEvidence: normalizeBoolean(explicit.activeOnlyEvidence),
    warnings: normalizeStringArray(explicit.warnings),
    blockers: normalizeStringArray(explicit.blockers),
    summary: normalizeString(firstDefined(
      explicit.summary,
      decisionEvidence.outstandingEvidenceGaps.length ? 'Evidence gaps remain and should be reviewed.' : UNKNOWN_VALUE
    ))
  };
}

function deriveComparableQuality(input = {}) {
  const explicit = asObject(input.comparableQualityAssessment);
  return {
    comparableQualityStatus: normalizeString(explicit.comparableQualityStatus),
    averageComparableQualityScore: normalizeNumber(explicit.averageComparableQualityScore),
    qualityDistribution: clone(asObject(explicit.qualityDistribution)),
    scoredComparableCount: normalizeNumber(explicit.scoredComparableCount),
    acceptedComparableCount: normalizeNumber(explicit.acceptedComparableCount),
    rejectedComparableCount: normalizeNumber(explicit.rejectedComparableCount),
    identityMismatchCount: normalizeNumber(explicit.identityMismatchCount),
    similaritySummary: normalizeString(explicit.similaritySummary),
    priceReliabilitySummary: normalizeString(explicit.priceReliabilitySummary),
    conditionMatchSummary: normalizeString(explicit.conditionMatchSummary),
    warnings: normalizeStringArray(explicit.warnings),
    blockers: normalizeStringArray(explicit.blockers),
    summary: normalizeString(explicit.summary)
  };
}

function deriveAgreementAnalysis(input = {}) {
  const explicit = asObject(input.agreementAnalysis);
  return {
    overallAgreementStatus: normalizeEnum(explicit.overallAgreementStatus, AGREEMENT_STATUSES),
    productionVsShadowDecision: clone(asObject(explicit.productionVsShadowDecision)),
    productionVsShadowValuation: clone(asObject(explicit.productionVsShadowValuation)),
    productionVsSignals: clone(asObject(explicit.productionVsSignals)),
    dealGateVsDecisionEngine: clone(asObject(explicit.dealGateVsDecisionEngine)),
    valuationVsEvidence: clone(asObject(explicit.valuationVsEvidence)),
    valuationVsComparableQuality: clone(asObject(explicit.valuationVsComparableQuality)),
    confidenceVsCalibration: clone(asObject(explicit.confidenceVsCalibration)),
    identityVsEvidence: clone(asObject(explicit.identityVsEvidence)),
    riskVsOpportunity: clone(asObject(explicit.riskVsOpportunity)),
    conflicts: sortReasons(explicit.conflicts),
    unresolvedDisagreements: sortReasons(explicit.unresolvedDisagreements),
    reviewFocus: normalizeStringArray(explicit.reviewFocus)
  };
}

function deriveRiskAssessment(input = {}) {
  const explicit = asObject(input.riskAssessment);
  return {
    overallRiskPosture: normalizeEnum(explicit.overallRiskPosture, RISK_POSTURES),
    riskEngineRef: normalizeReference(explicit.riskEngineRef, { referenceType: 'risk_engine' }),
    riskScore: normalizeNumber(explicit.riskScore),
    riskLevel: normalizeString(explicit.riskLevel),
    falsePositiveRisk: normalizeString(explicit.falsePositiveRisk),
    marketRisk: normalizeString(explicit.marketRisk),
    liquidityRisk: normalizeString(explicit.liquidityRisk),
    pricingRisk: normalizeString(explicit.pricingRisk),
    identityRisk: normalizeString(explicit.identityRisk),
    evidenceRisk: normalizeString(explicit.evidenceRisk),
    conditionRisk: normalizeString(explicit.conditionRisk),
    supplyPressureRisk: normalizeString(explicit.supplyPressureRisk),
    resaleRisk: normalizeString(explicit.resaleRisk),
    riskWarnings: normalizeStringArray(explicit.riskWarnings),
    riskBlockers: normalizeStringArray(explicit.riskBlockers),
    summary: normalizeString(explicit.summary)
  };
}

function deriveOpportunityAssessment(input = {}) {
  const explicit = asObject(input.opportunityAssessment);
  return {
    overallOpportunityPosture: normalizeEnum(explicit.overallOpportunityPosture, OPPORTUNITY_POSTURES),
    estimatedProfit: normalizeNumber(explicit.estimatedProfit),
    roi: normalizeNumber(explicit.roi),
    floorProfit: normalizeNumber(explicit.floorProfit),
    expectedProfit: normalizeNumber(explicit.expectedProfit),
    ceilingProfit: normalizeNumber(explicit.ceilingProfit),
    investmentQuality: normalizeNumber(explicit.investmentQuality),
    marketQuality: normalizeNumber(explicit.marketQuality),
    liquidity: normalizeNumber(explicit.liquidity),
    trend: normalizeNumber(explicit.trend),
    populationScarcity: normalizeNumber(explicit.populationScarcity),
    gradePremiumSupport: normalizeString(explicit.gradePremiumSupport),
    opportunityDrivers: normalizeStringArray(explicit.opportunityDrivers),
    opportunityLimits: normalizeStringArray(explicit.opportunityLimits),
    summary: normalizeString(explicit.summary)
  };
}

function normalizeAdvisoryRecommendation(input = {}, evidence = null) {
  const source = asObject(input.advisoryRecommendation);
  const decisionEvidence = evidence || deriveDecisionEvidence(input);
  const hasBlockingGaps = decisionEvidence.outstandingEvidenceGaps.some((gap) => gap.blocking === true);
  const recommendationType = normalizeEnum(
    firstDefined(source.recommendationType, hasBlockingGaps ? 'advisory_review_required' : UNKNOWN_VALUE),
    RECOMMENDATION_TYPES
  );
  return {
    recommendationType,
    recommendationPosture: normalizeEnum(firstDefined(source.recommendationPosture, hasBlockingGaps ? 'insufficient_evidence' : UNKNOWN_VALUE), RECOMMENDATION_POSTURES),
    recommendationConfidence: normalizeNumber(source.recommendationConfidence),
    reviewPriority: normalizeString(source.reviewPriority),
    humanReviewRequired: firstDefined(source.humanReviewRequired, true) !== false,
    productionAuthority: 'none',
    purchaseAuthority: 'none',
    recommendationImpact: 'none',
    summary: normalizeString(source.summary)
  };
}

function deriveDecisionExplanation(input = {}, evidence = null, confidence = null) {
  const source = asObject(input);
  const decisionEvidence = evidence || deriveDecisionEvidence(source);
  const confidenceData = confidence || deriveDecisionConfidence(source, decisionEvidence);
  const explicit = asObject(source.explanationSummary);
  const supportingReasons = sortReasons(source.supportingReasons);
  const opposingReasons = sortReasons(source.opposingReasons);
  const traces = [
    ...supportingReasons.map((reason) => ({
      traceId: `supporting:${reason.reasonId}`,
      source: reason.source,
      sourceArtifactId: reason.sourceArtifactId,
      sourceFingerprint: reason.sourceFingerprint,
      category: reason.category,
      severity: 'supporting',
      message: reason.message,
      relatedSignalNames: reason.signalRefs.map((signal) => signal.signalName).filter((value) => value !== UNKNOWN_VALUE),
      relatedRuleIds: reason.ruleRefs
    })),
    ...opposingReasons.map((reason) => ({
      traceId: `opposing:${reason.reasonId}`,
      source: reason.source,
      sourceArtifactId: reason.sourceArtifactId,
      sourceFingerprint: reason.sourceFingerprint,
      category: reason.category,
      severity: reason.severity === UNKNOWN_VALUE ? 'caution' : reason.severity,
      message: reason.message,
      relatedSignalNames: reason.signalRefs.map((signal) => signal.signalName).filter((value) => value !== UNKNOWN_VALUE),
      relatedRuleIds: reason.ruleRefs
    })),
    ...decisionEvidence.outstandingEvidenceGaps.map((gap) => ({
      traceId: `gap:${gap.gapId}`,
      source: 'decision_intelligence_artifact_builder',
      sourceArtifactId: UNKNOWN_VALUE,
      sourceFingerprint: UNKNOWN_VALUE,
      category: gap.category,
      severity: gap.blocking ? 'blocking' : 'unknown',
      message: gap.description,
      relatedSignalNames: gap.missingSignalName === UNKNOWN_VALUE ? [] : [gap.missingSignalName],
      relatedRuleIds: []
    }))
  ].sort((left, right) => `${left.category}|${left.severity}|${left.traceId}`.localeCompare(`${right.category}|${right.severity}|${right.traceId}`));

  return deepFreeze({
    headline: normalizeString(explicit.headline),
    plainLanguageSummary: normalizeString(firstDefined(explicit.plainLanguageSummary, explicit.summary)),
    decisionTrace: asArray(firstDefined(explicit.decisionTrace, traces)).map((item) => clone(item)),
    supportingEvidenceTrace: asArray(explicit.supportingEvidenceTrace).map((item) => clone(item)),
    opposingEvidenceTrace: asArray(explicit.opposingEvidenceTrace).map((item) => clone(item)),
    dealGateTrace: asArray(explicit.dealGateTrace).map((item) => clone(item)),
    signalTrace: asArray(explicit.signalTrace).map((item) => clone(item)),
    confidenceTrace: asArray(explicit.confidenceTrace).map((item) => clone(item)),
    missingEvidenceTrace: asArray(explicit.missingEvidenceTrace).map((item) => clone(item)),
    reviewFocus: normalizeStringArray(firstDefined(explicit.reviewFocus, [
      ...decisionEvidence.outstandingEvidenceGaps.map((gap) => gap.category),
      confidenceData.overallConfidencePosture === 'conflicted' ? 'confidence' : ''
    ]))
  });
}

function summarizeDecisionArtifact(artifact = {}) {
  const input = asObject(artifact);
  const signalRefs = asArray(input.signalRefs);
  const gaps = asArray(input.outstandingEvidenceGaps);
  const opposingReasons = asArray(input.opposingReasons);
  const supportingReasons = asArray(input.supportingReasons);
  const recommendation = asObject(input.advisoryRecommendation);
  return deepFreeze({
    artifactId: normalizeString(input.artifactId),
    listingId: normalizeString(asObject(input.listingRef).listingId),
    advisoryRecommendationType: normalizeString(recommendation.recommendationType),
    advisoryRecommendationPosture: normalizeString(recommendation.recommendationPosture),
    signalReferenceCount: signalRefs.length,
    evidenceGapCount: gaps.length,
    unknownValueCount: asArray(input.unknownValues).length,
    supportingReasonCount: supportingReasons.length,
    opposingReasonCount: opposingReasons.length,
    readyForGovernanceBinding: input.productionImpact === 'none' &&
      input.decisionImpact === 'none' &&
      input.executionAuthority === 'none' &&
      gaps.every((gap) => gap.blocking !== true),
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  });
}

function buildProvenance(input = {}, evidence = null) {
  const source = asObject(input.provenance);
  const decisionEvidence = evidence || deriveDecisionEvidence(input);
  const sourceRefs = [
    decisionEvidence.listingRef,
    decisionEvidence.canonicalIdentityRef,
    decisionEvidence.productionDecisionRef,
    decisionEvidence.dealGateRef,
    ...decisionEvidence.signalRefs,
    ...Object.values(decisionEvidence.valuationRefs).filter((value) => value && typeof value === 'object')
  ];
  return {
    sourceSystem: normalizeString(firstDefined(source.sourceSystem, 'cardhawk_offline_validation')),
    builderName: DECISION_INTELLIGENCE_ARTIFACT_SOURCE,
    builderVersion: '1.0.0',
    inputArtifactIds: normalizeStringArray(firstDefined(
      source.inputArtifactIds,
      sourceRefs.map(sourceId)
    )),
    inputFingerprints: normalizeStringArray(firstDefined(
      source.inputFingerprints,
      sourceRefs.map(sourceFingerprint)
    )),
    sourceFileReferences: normalizeStringArray(source.sourceFileReferences),
    createdBy: normalizeString(source.createdBy),
    createdAt: normalizeDate(firstDefined(source.createdAt, input.createdAt)),
    capturedAt: normalizeDate(firstDefined(source.capturedAt, input.capturedAt)),
    reviewBatchId: normalizeString(source.reviewBatchId),
    workspaceId: normalizeString(source.workspaceId),
    governancePipelineId: normalizeString(source.governancePipelineId)
  };
}

function buildDecisionIntelligenceArtifact(input = {}) {
  const source = asObject(input);
  const evidence = deriveDecisionEvidence(source);
  const dealGateRef = normalizeDealGateRef(source.dealGateRef || source.dealGate);
  const confidence = deriveDecisionConfidence(source, evidence);
  const supportingReasons = sortReasons(source.supportingReasons);
  const opposingReasons = sortReasons(source.opposingReasons);
  const recommendation = normalizeAdvisoryRecommendation(source, evidence);
  const core = {
    schemaVersion: DECISION_INTELLIGENCE_ARTIFACT_SCHEMA_VERSION,
    source: DECISION_INTELLIGENCE_ARTIFACT_SOURCE,
    artifactId: normalizeString(firstDefined(source.artifactId, source.id, `decision-intelligence:${evidence.listingRef.listingId}`)),
    artifactType: 'decision_intelligence_assessment',
    createdAt: normalizeDate(source.createdAt),
    capturedAt: normalizeDate(firstDefined(source.capturedAt, evidence.listingRef.capturedAt)),
    listingRef: evidence.listingRef,
    canonicalIdentityRef: evidence.canonicalIdentityRef,
    signalRefs: evidence.signalRefs,
    valuationRefs: evidence.valuationRefs,
    productionDecisionRef: evidence.productionDecisionRef,
    dealGateRef,
    buyNowRef: normalizeBuyNowRef(source.buyNowRef || source.buyNow, dealGateRef),
    shadowRefs: evidence.shadowRefs,
    governanceRefs: evidence.governanceRefs,
    confidenceInterpretation: confidence,
    evidenceQualityAssessment: deriveEvidenceQuality(source, evidence),
    comparableQualityAssessment: deriveComparableQuality(source),
    agreementAnalysis: deriveAgreementAnalysis(source),
    riskAssessment: deriveRiskAssessment(source),
    opportunityAssessment: deriveOpportunityAssessment(source),
    explanationSummary: deriveDecisionExplanation(source, evidence, confidence),
    advisoryRecommendation: recommendation,
    supportingReasons,
    opposingReasons,
    unknownValues: evidence.unknownValues,
    outstandingEvidenceGaps: evidence.outstandingEvidenceGaps,
    provenance: buildProvenance(source, evidence),
    immutability: {
      immutable: true,
      mutationPolicy: 'new_artifact_required',
      sourceMutationPolicy: 'source_artifacts_referenced_only'
    },
    compatibility: {
      backwardCompatible: true,
      runtimeIntegration: 'none',
      productionBehaviorChanged: false,
      persistedFormatChanged: false,
      dealGateChanged: false,
      buyNowChanged: false,
      scoringChanged: false,
      signalsChanged: false,
      governanceChanged: false
    },
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
  return deepFreeze({
    ...core,
    artifactFingerprint: buildDecisionIntelligenceArtifactFingerprint(core)
  });
}

function missingRequiredFields(record = {}) {
  const input = asObject(record);
  return REQUIRED_ARTIFACT_FIELDS.filter((field) => {
    const value = input[field];
    return value === undefined || value === null || value === '';
  });
}

function validateDecisionIntelligenceArtifact(artifact = {}) {
  const input = asObject(artifact);
  const errors = [];
  const warnings = [];
  const reasonCodes = [];
  const missing = missingRequiredFields(input);
  const authorityViolations = [];
  const fingerprintViolations = [];
  const sourceReferenceViolations = [];
  const unknownValueViolations = [];
  const evidenceGapViolations = [];
  const compatibilityViolations = [];

  for (const field of missing) {
    errors.push(validationIssue('missing_required_field', `${field} is required.`, field));
  }

  if (input.schemaVersion !== DECISION_INTELLIGENCE_ARTIFACT_SCHEMA_VERSION) {
    errors.push(validationIssue('invalid_schema_version', 'schemaVersion must match the Decision Intelligence artifact contract.', 'schemaVersion'));
  }
  if (input.source !== DECISION_INTELLIGENCE_ARTIFACT_SOURCE) {
    errors.push(validationIssue('invalid_source', 'source must be decision_intelligence_artifact_builder.', 'source'));
  }

  for (const field of ['productionImpact', 'decisionImpact', 'executionAuthority']) {
    if (input[field] !== 'none') {
      errors.push(validationIssue('authority_boundary_violation', `${field} must remain none.`, field));
      authorityViolations.push(field);
    }
  }

  const recommendation = asObject(input.advisoryRecommendation);
  for (const field of ['productionAuthority', 'purchaseAuthority', 'recommendationImpact']) {
    if (recommendation[field] !== 'none') {
      errors.push(validationIssue('advisory_authority_violation', `advisoryRecommendation.${field} must remain none.`, `advisoryRecommendation.${field}`));
      authorityViolations.push(`advisoryRecommendation.${field}`);
    }
  }
  if (!RECOMMENDATION_TYPES.includes(recommendation.recommendationType)) {
    errors.push(validationIssue('invalid_recommendation_type', 'advisoryRecommendation.recommendationType is not supported.', 'advisoryRecommendation.recommendationType'));
  }
  if (!RECOMMENDATION_POSTURES.includes(recommendation.recommendationPosture)) {
    errors.push(validationIssue('invalid_recommendation_posture', 'advisoryRecommendation.recommendationPosture is not supported.', 'advisoryRecommendation.recommendationPosture'));
  }

  if (asObject(input.buyNowRef).purchaseAuthority !== 'none') {
    errors.push(validationIssue('buy_now_authority_violation', 'buyNowRef.purchaseAuthority must remain none.', 'buyNowRef.purchaseAuthority'));
    authorityViolations.push('buyNowRef.purchaseAuthority');
  }

  const signalRefs = asArray(input.signalRefs);
  signalRefs.forEach((signal, index) => {
    if (!known(signal.signalName)) {
      warnings.push(validationIssue('signal_name_missing', 'Signal reference should preserve signalName.', `signalRefs.${index}.signalName`));
      sourceReferenceViolations.push(`signalRefs.${index}.signalName`);
    }
    if (!known(signal.signalFingerprint)) {
      warnings.push(validationIssue('signal_fingerprint_missing', 'Signal reference should preserve signalFingerprint.', `signalRefs.${index}.signalFingerprint`));
      sourceReferenceViolations.push(`signalRefs.${index}.signalFingerprint`);
    }
    if (signal.authorityStatus && signal.authorityStatus !== 'none' && signal.authorityStatus !== UNKNOWN_VALUE) {
      errors.push(validationIssue('signal_authority_violation', 'Signal references must remain non-authoritative.', `signalRefs.${index}.authorityStatus`));
      authorityViolations.push(`signalRefs.${index}.authorityStatus`);
    }
  });

  asArray(input.unknownValues).forEach((unknown, index) => {
    if (!known(unknown.field)) {
      errors.push(validationIssue('unknown_value_field_missing', 'Unknown value entries must identify the field.', `unknownValues.${index}.field`));
      unknownValueViolations.push(`unknownValues.${index}.field`);
    }
  });

  asArray(input.outstandingEvidenceGaps).forEach((gap, index) => {
    if (!known(gap.description)) {
      errors.push(validationIssue('evidence_gap_description_missing', 'Evidence gap entries must describe the missing evidence.', `outstandingEvidenceGaps.${index}.description`));
      evidenceGapViolations.push(`outstandingEvidenceGaps.${index}.description`);
    }
  });

  const compatibility = asObject(input.compatibility);
  for (const field of ['productionBehaviorChanged', 'persistedFormatChanged', 'dealGateChanged', 'buyNowChanged', 'scoringChanged', 'signalsChanged', 'governanceChanged']) {
    if (compatibility[field] === true) {
      errors.push(validationIssue('compatibility_violation', `compatibility.${field} must remain false.`, `compatibility.${field}`));
      compatibilityViolations.push(`compatibility.${field}`);
    }
  }

  if (known(input.artifactFingerprint) && buildDecisionIntelligenceArtifactFingerprint(input) !== input.artifactFingerprint) {
    errors.push(validationIssue('artifact_fingerprint_mismatch', 'artifactFingerprint does not match artifact contents.', 'artifactFingerprint'));
    fingerprintViolations.push('artifactFingerprint');
  }

  const allIssues = [...errors, ...warnings];
  reasonCodes.push(...unique(allIssues.map((issue) => issue.code)).sort());

  return deepFreeze({
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes,
    missingRequiredFields: missing,
    authorityViolations,
    fingerprintViolations,
    sourceReferenceViolations,
    unknownValueViolations,
    evidenceGapViolations,
    compatibilityViolations
  });
}

module.exports = {
  DECISION_INTELLIGENCE_ARTIFACT_SCHEMA_VERSION,
  EXPECTED_SIGNAL_NAMES,
  buildDecisionIntelligenceArtifact,
  validateDecisionIntelligenceArtifact,
  deriveDecisionEvidence,
  deriveDecisionConfidence,
  deriveDecisionExplanation,
  summarizeDecisionArtifact,
  buildDecisionIntelligenceArtifactFingerprint
};
