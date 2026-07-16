'use strict';

const {
  asArray,
  asObject
} = require('./canonicalValidationCore');
const {
  buildFingerprintFromProjection
} = require('./fingerprintProjection');
const {
  buildOfflineAuthorityFlags,
  clone,
  firstDefined
} = require('./phase8GovernanceCore');

const PRODUCTION_INTELLIGENCE_TRACE_SCHEMA_VERSION = '1.0.0';
const PRODUCTION_INTELLIGENCE_TRACE_SOURCE = 'production_intelligence_trace';
const UNKNOWN_VALUE = 'unknown';

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }
  return value;
}

function known(value) {
  return value !== undefined && value !== null && value !== '';
}

function preserve(value, fallback = UNKNOWN_VALUE) {
  return known(value) ? clone(value) : fallback;
}

function preserveArray(value) {
  return asArray(value).map((item) => clone(item));
}

function pick(sources = [], keys = [], fallback = UNKNOWN_VALUE) {
  for (const source of sources) {
    const object = asObject(source);
    for (const key of keys) {
      if (known(object[key])) return clone(object[key]);
    }
  }
  return fallback;
}

function getListing(input = {}) {
  return asObject(firstDefined(input.listing, input.productionListing, input.item, input.record, {}));
}

function getParsed(input = {}, listing = {}) {
  return asObject(firstDefined(input.parserOutput, input.parsed, listing.parsed, {}));
}

function summarizeScanMetadata(input = {}) {
  const scan = asObject(firstDefined(input.scanMetadata, input.scan, {}));
  return {
    scanId: pick([scan], ['scanId', 'id']),
    source: pick([scan], ['source']),
    lane: pick([scan], ['lane', 'laneKey']),
    query: pick([scan], ['query', 'searchQuery']),
    startedAt: pick([scan], ['startedAt']),
    finishedAt: pick([scan], ['finishedAt']),
    status: pick([scan], ['status']),
    rateLimited: pick([scan], ['rateLimited']),
    listingsFound: pick([scan], ['listingsFound']),
    newAlerts: pick([scan], ['newAlerts'])
  };
}

function summarizeParserOutput(input = {}, listing = getListing(input)) {
  const parsed = getParsed(input, listing);
  const flags = asObject(parsed.flags);
  return {
    title: pick([parsed, listing], ['title', 'rawTitle', 'listingTitle']),
    player: pick([parsed, listing], ['player', 'subject', 'name']),
    year: pick([parsed, listing], ['year']),
    brand: pick([parsed, listing], ['brand', 'manufacturer']),
    setName: pick([parsed, listing], ['setName', 'set', 'product']),
    cardNumber: pick([parsed, listing], ['cardNumber', 'cardNo', 'number']),
    qualityTier: pick([parsed], ['qualityTier']),
    gradeCompany: pick([parsed, listing], ['gradeCompany', 'grader', 'gradingCompany']),
    grade: pick([parsed, listing], ['grade']),
    flags: {
      rookie: pick([flags], ['rookie']),
      autograph: pick([flags], ['autograph']),
      graded: pick([flags], ['graded']),
      numbered: pick([flags], ['numbered']),
      sealed: pick([flags], ['sealed']),
      lot: pick([flags], ['lot']),
      reprint: pick([flags], ['reprint']),
      digital: pick([flags], ['digital']),
      custom: pick([flags], ['custom'])
    },
    warnings: preserveArray(firstDefined(parsed.warnings, parsed.normalizationWarnings))
  };
}

function summarizeCanonicalIdentity(input = {}, listing = getListing(input)) {
  const identity = asObject(firstDefined(input.canonicalIdentity, listing.canonicalIdentity, {}));
  const normalized = asObject(identity.normalized);
  const metadata = asObject(identity.metadata);
  return {
    identityKey: pick([identity], ['identityKey', 'canonicalIdentityKey', 'canonicalCardKey']),
    canonicalCardKey: pick([identity, listing], ['canonicalCardKey']),
    identityType: pick([identity, normalized], ['identityType']),
    category: pick([normalized, identity], ['category']),
    subject: pick([normalized.subject, normalized, identity], ['name', 'subject', 'player', 'cardName']),
    rawOrGraded: pick([normalized, identity], ['rawOrGraded']),
    confidence: pick([identity, metadata], ['confidence', 'identityConfidence']),
    unknownFields: preserveArray(metadata.unknownFields),
    warnings: preserveArray(firstDefined(metadata.normalizationWarnings, identity.warnings))
  };
}

function summarizeIdentityDiagnostics(input = {}) {
  const diagnostic = asObject(firstDefined(input.identityDiagnosticResult, input.identityDiagnostics, input.identityParserDiagnostics, {}));
  return {
    available: Object.keys(diagnostic).length > 0,
    diagnosticStatus: pick([diagnostic], ['diagnosticStatus']),
    ambiguityLevel: pick([diagnostic], ['ambiguityLevel']),
    identityEligibility: clone(asObject(diagnostic.identityEligibility)),
    blockingIssues: preserveArray(diagnostic.blockingIssues),
    warnings: preserveArray(diagnostic.warnings),
    fieldsConfirmedCount: asArray(diagnostic.fieldsConfirmed).length,
    fieldsMissing: preserveArray(diagnostic.fieldsMissing),
    fieldsConflicting: preserveArray(diagnostic.fieldsConflicting),
    recommendedReviewAction: pick([diagnostic], ['recommendedReviewAction']),
    stableFingerprint: pick([diagnostic], ['stableFingerprint']),
    changesProductionBehavior: false
  };
}

function summarizeEvidence(input = {}) {
  const evidence = asObject(firstDefined(input.evidenceSummary, input.evidence, {}));
  const compData = asObject(firstDefined(input.compData, input.comparableEvidence, {}));
  const sufficiency = asObject(firstDefined(input.evidenceSufficiency, evidence.evidenceSufficiency, {}));
  const quality = asObject(firstDefined(input.comparableQuality, evidence.comparableQuality, {}));
  return {
    source: pick([evidence, compData], ['source']),
    compSource: pick([compData, evidence], ['source', 'compSource']),
    compCount: pick([evidence, compData], ['compCount', 'totalCount']),
    trueSoldCount: pick([evidence, compData], ['trueSoldCount', 'soldCompCount', 'soldCount']),
    activeCount: pick([evidence, compData], ['activeCount', 'activeCompCount']),
    activeOnlyFlag: pick([evidence], ['activeOnlyFlag']),
    fallbackOnlyFlag: pick([evidence], ['fallbackOnlyFlag']),
    sufficiencyLevel: pick([sufficiency], ['sufficiencyLevel']),
    evidenceSufficiencyScore: pick([sufficiency], ['evidenceSufficiencyScore', 'score']),
    comparableQualityScore: pick([quality], ['averageComparableQualityScore', 'comparableQualityScore', 'score']),
    blockingConcerns: preserveArray(sufficiency.blockingConcerns),
    warnings: preserveArray(firstDefined(evidence.warnings, sufficiency.warnings, quality.warnings))
  };
}

function summarizeEvidenceReadinessDiagnostics(input = {}) {
  const diagnostic = asObject(firstDefined(input.evidenceReadinessDiagnosticResult, input.evidenceReadinessDiagnostics, {}));
  return {
    available: Object.keys(diagnostic).length > 0,
    readinessStatus: pick([diagnostic], ['readinessStatus']),
    readinessLevel: pick([diagnostic], ['readinessLevel']),
    eligibleEvidenceSummary: clone(asObject(diagnostic.eligibleEvidenceSummary)),
    excludedEvidenceSummary: clone(asObject(diagnostic.excludedEvidenceSummary)),
    blockingReasons: preserveArray(diagnostic.blockingReasons),
    warnings: preserveArray(diagnostic.warnings),
    valuationReadiness: clone(asObject(diagnostic.valuationReadiness)),
    confidenceCapRecommendation: clone(asObject(diagnostic.confidenceCapRecommendation)),
    recommendedReviewAction: pick([diagnostic], ['recommendedReviewAction']),
    stableFingerprint: pick([diagnostic], ['stableFingerprint']),
    changesProductionBehavior: false
  };
}

function summarizeRangeFirstValuationDiagnostics(input = {}) {
  const diagnostic = asObject(firstDefined(
    input.rangeFirstValuationDiagnosticResult,
    input.rangeFirstValuationDiagnostics,
    input.valuationDiagnosticResult,
    input.valuationDiagnostics,
    {}
  ));
  return {
    available: Object.keys(diagnostic).length > 0,
    valuationDiagnosticStatus: pick([diagnostic], ['valuationDiagnosticStatus']),
    uncertaintyLevel: pick([diagnostic], ['uncertaintyLevel']),
    pointEstimateAssessment: clone(asObject(diagnostic.pointEstimateAssessment)),
    rangeAssessment: clone(asObject(diagnostic.rangeAssessment)),
    supportingEvidenceSummary: clone(asObject(diagnostic.supportingEvidenceSummary)),
    excludedEvidenceSummary: clone(asObject(diagnostic.excludedEvidenceSummary)),
    blockingReasons: preserveArray(diagnostic.blockingReasons),
    warnings: preserveArray(diagnostic.warnings),
    valuationWithheldRecommendation: clone(asObject(diagnostic.valuationWithheldRecommendation)),
    confidenceCapRecommendation: clone(asObject(diagnostic.confidenceCapRecommendation)),
    recommendedReviewAction: pick([diagnostic], ['recommendedReviewAction']),
    stableFingerprint: pick([diagnostic], ['stableFingerprint']),
    changesProductionBehavior: false
  };
}

function summarizeConfidenceCalibrationDiagnostics(input = {}) {
  const diagnostic = asObject(firstDefined(
    input.confidenceCalibrationDiagnosticResult,
    input.confidenceCalibrationDiagnostics,
    {}
  ));
  return {
    available: Object.keys(diagnostic).length > 0,
    calibrationStatus: pick([diagnostic], ['calibrationStatus']),
    confidenceSupportLevel: pick([diagnostic], ['confidenceSupportLevel']),
    reportedConfidence: clone(asObject(diagnostic.reportedConfidence)),
    observedAgreementMetrics: clone(asObject(diagnostic.observedAgreementMetrics)),
    availableOutcomeMetrics: clone(asObject(diagnostic.availableOutcomeMetrics)),
    calibrationGap: clone(asObject(diagnostic.calibrationGap)),
    overconfidenceIndicatorCount: asArray(diagnostic.overconfidenceIndicators).length,
    underconfidenceIndicatorCount: asArray(diagnostic.underconfidenceIndicators).length,
    blockingReasons: preserveArray(diagnostic.blockingReasons),
    warnings: preserveArray(diagnostic.warnings),
    recommendedConfidenceCap: clone(asObject(diagnostic.recommendedConfidenceCap)),
    recommendedReviewAction: pick([diagnostic], ['recommendedReviewAction']),
    stableFingerprint: pick([diagnostic], ['stableFingerprint']),
    changesProductionBehavior: false
  };
}

function summarizeListingQualityGradingDiagnostics(input = {}) {
  const diagnostic = asObject(firstDefined(
    input.listingQualityGradingDiagnosticResult,
    input.listingQualityGradingDiagnostics,
    input.qualityGradingDiagnosticResult,
    input.qualityGradingDiagnostics,
    {}
  ));
  return {
    available: Object.keys(diagnostic).length > 0,
    listingQualityStatus: pick([diagnostic], ['listingQualityStatus']),
    gradingDiagnosticStatus: pick([diagnostic], ['gradingDiagnosticStatus']),
    riskLevel: pick([diagnostic], ['riskLevel']),
    blockingIssues: preserveArray(diagnostic.blockingIssues),
    warnings: preserveArray(diagnostic.warnings),
    confirmedAttributes: preserveArray(diagnostic.confirmedAttributes),
    ambiguousAttributes: preserveArray(diagnostic.ambiguousAttributes),
    unsupportedAttributes: preserveArray(diagnostic.unsupportedAttributes),
    gradingSupportSummary: clone(asObject(diagnostic.gradingSupportSummary)),
    listingHistoryContext: clone(asObject(diagnostic.listingHistoryContext)),
    recommendedReviewAction: pick([diagnostic], ['recommendedReviewAction']),
    stableFingerprint: pick([diagnostic], ['stableFingerprint']),
    changesProductionBehavior: false
  };
}

function summarizeValuation(input = {}) {
  const marketData = asObject(firstDefined(input.valuationSummary, input.marketData, input.valuation, {}));
  const range = asObject(firstDefined(input.valuationRange, marketData.valuationRange, {}));
  return {
    estimatedValue: pick([marketData], ['estimatedValue', 'marketValue', 'expectedValue']),
    marketValue: pick([marketData], ['marketValue']),
    source: pick([marketData], ['source', 'valuationSource']),
    confidence: pick([marketData], ['confidence', 'marketConfidence']),
    valueRange: {
      low: pick([range, marketData], ['low', 'expectedValueLow']),
      expected: pick([range, marketData], ['expectedValue', 'marketValue']),
      high: pick([range, marketData], ['high', 'expectedValueHigh'])
    },
    rangeQuality: pick([range], ['rangeQuality']),
    insufficientEvidence: pick([marketData, range], ['insufficientEvidence']),
    warnings: preserveArray(firstDefined(marketData.warnings, range.warnings))
  };
}

function summarizeConfidence(input = {}) {
  const confidence = asObject(firstDefined(input.confidenceSummary, input.confidenceData, {}));
  return {
    confidence: pick([confidence], ['confidence']),
    source: pick([confidence], ['source']),
    cap: pick([confidence], ['cap', 'confidenceCap']),
    avgSimilarity: pick([confidence], ['avgSimilarity', 'averageSimilarity']),
    compCount: pick([confidence], ['compCount']),
    reasons: preserveArray(confidence.reasons),
    dimensions: clone(asObject(confidence.dimensions))
  };
}

function summarizeGrading(input = {}) {
  const grade = asObject(firstDefined(input.gradingSummary, input.dealGrade, input.gradeData, {}));
  return {
    grade: pick([grade], ['grade', 'label']),
    action: pick([grade], ['action', 'recommendedAction']),
    gradeScore: pick([grade], ['score', 'gradeScore']),
    reasons: preserveArray(grade.reasons),
    concerns: preserveArray(grade.concerns),
    contributions: preserveArray(grade.contributions)
  };
}

function summarizeRisk(input = {}) {
  const risk = asObject(firstDefined(input.riskSummary, input.riskData, {}));
  return {
    riskLevel: pick([risk], ['riskLevel', 'level', 'risk']),
    riskScore: pick([risk], ['riskScore', 'score']),
    reasons: preserveArray(firstDefined(risk.reasons, risk.risks)),
    warnings: preserveArray(firstDefined(risk.warnings, risk.concerns))
  };
}

function summarizeIntelligenceEngines(input = {}) {
  const marketIntelligence = asObject(firstDefined(input.marketIntelligenceData, input.marketIntelligence, {}));
  const decisionIntelligence = asObject(firstDefined(input.decisionIntelligence, marketIntelligence.decisionIntelligence, {}));
  return {
    marketIntelligence: {
      intelligenceScore: pick([marketIntelligence], ['intelligenceScore', 'score']),
      confidenceScore: pick([marketIntelligence], ['confidenceScore']),
      recommendation: pick([marketIntelligence], ['recommendation']),
      warnings: preserveArray(marketIntelligence.warnings)
    },
    decisionIntelligence: {
      overallReadiness: pick([decisionIntelligence], ['overallReadiness']),
      recommendationImpact: pick([decisionIntelligence], ['recommendationImpact']),
      blockers: preserveArray(decisionIntelligence.blockers),
      cautionSignals: preserveArray(decisionIntelligence.cautionSignals),
      supportingSignals: preserveArray(decisionIntelligence.supportingSignals),
      conflicts: preserveArray(decisionIntelligence.conflicts)
    },
    additionalEngines: clone(asObject(input.intelligenceEngineSummaries))
  };
}

function summarizeDealGate(input = {}, listing = getListing(input)) {
  const dealGate = asObject(firstDefined(input.dealGateOutcome, input.dealGate, listing.dealGate, {}));
  const inputs = asObject(firstDefined(input.dealGateInputs, dealGate.inputs, {}));
  const outcomeAvailable = Object.keys(dealGate).length > 0;
  const passed = outcomeAvailable && known(dealGate.passed) ? dealGate.passed === true : UNKNOWN_VALUE;
  const decision = pick([dealGate], ['decision', 'recommendation']);
  const eligible = outcomeAvailable && decision === 'BUY_NOW'
    ? true
    : outcomeAvailable && passed === true && decision === UNKNOWN_VALUE
      ? true
      : outcomeAvailable
        ? false
        : UNKNOWN_VALUE;

  return {
    inputs: clone(inputs),
    outcome: {
      available: outcomeAvailable,
      passed,
      decision,
      recommendation: pick([dealGate], ['recommendation', 'decision']),
      reasons: preserveArray(dealGate.reasons),
      positives: preserveArray(dealGate.positives),
      breakdown: clone(asObject(dealGate.breakdown)),
      ruleResults: preserveArray(firstDefined(dealGate.ruleResults, dealGate.rules))
    },
    buyNowEligibility: {
      eligible,
      authority: 'deal_gate',
      source: outcomeAvailable ? 'provided_deal_gate_outcome' : UNKNOWN_VALUE,
      changesProductionBehavior: false
    }
  };
}

function buildExplanationChain(input = {}, summaries = {}) {
  if (Array.isArray(input.explanationChain)) return preserveArray(input.explanationChain);

  return [
    {
      stage: 'scan',
      summary: summaries.scanMetadata.status
    },
    {
      stage: 'parser',
      summary: summaries.parserOutputSummary.qualityTier
    },
    {
      stage: 'canonical_identity',
      summary: summaries.canonicalIdentitySummary.identityKey
    },
    {
      stage: 'evidence',
      summary: summaries.evidenceSummary.sufficiencyLevel
    },
    {
      stage: 'valuation',
      summary: summaries.valuationSummary.source
    },
    {
      stage: 'confidence',
      summary: summaries.confidenceSummary.confidence
    },
    {
      stage: 'grading',
      summary: summaries.gradingSummary.grade
    },
    {
      stage: 'risk',
      summary: summaries.riskSummary.riskLevel
    },
    {
      stage: 'deal_gate',
      summary: summaries.dealGateOutcome.decision
    }
  ];
}

function buildProductionIntelligenceTraceFingerprint(trace = {}) {
  const projection = clone(trace);
  delete projection.stableFingerprint;
  return buildFingerprintFromProjection(projection);
}

function createProductionIntelligenceTrace(input = {}) {
  const listing = getListing(input);
  const scanMetadata = summarizeScanMetadata(input);
  const parserOutputSummary = summarizeParserOutput(input, listing);
  const canonicalIdentitySummary = summarizeCanonicalIdentity(input, listing);
  const identityDiagnosticSummary = summarizeIdentityDiagnostics(input);
  const evidenceSummary = summarizeEvidence(input);
  const evidenceReadinessDiagnosticSummary = summarizeEvidenceReadinessDiagnostics(input);
  const rangeFirstValuationDiagnosticSummary = summarizeRangeFirstValuationDiagnostics(input);
  const valuationSummary = summarizeValuation(input);
  const confidenceSummary = summarizeConfidence(input);
  const confidenceCalibrationDiagnosticSummary = summarizeConfidenceCalibrationDiagnostics(input);
  const listingQualityGradingDiagnosticSummary = summarizeListingQualityGradingDiagnostics(input);
  const gradingSummary = summarizeGrading(input);
  const riskSummary = summarizeRisk(input);
  const intelligenceEngineSummaries = summarizeIntelligenceEngines(input);
  const dealGate = summarizeDealGate(input, listing);
  const summaries = {
    scanMetadata,
    parserOutputSummary,
    canonicalIdentitySummary,
    identityDiagnosticSummary,
    evidenceSummary,
    evidenceReadinessDiagnosticSummary,
    rangeFirstValuationDiagnosticSummary,
    valuationSummary,
    confidenceSummary,
    confidenceCalibrationDiagnosticSummary,
    listingQualityGradingDiagnosticSummary,
    gradingSummary,
    riskSummary,
    intelligenceEngineSummaries,
    dealGateOutcome: dealGate.outcome
  };

  const trace = {
    source: PRODUCTION_INTELLIGENCE_TRACE_SOURCE,
    schemaVersion: PRODUCTION_INTELLIGENCE_TRACE_SCHEMA_VERSION,
    immutable: true,
    traceId: preserve(firstDefined(input.traceId, listing.traceId, listing.ebayItemId, listing.itemId, listing.id)),
    createdAt: preserve(input.createdAt),
    productionBehavior: {
      readOnly: true,
      changesDealGateDecision: false,
      changesProductionScoring: false,
      changesBuyNowBehavior: false,
      changesNotifications: false,
      authorityFlags: buildOfflineAuthorityFlags()
    },
    scanMetadata,
    parserOutputSummary,
    canonicalIdentitySummary,
    identityDiagnosticSummary,
    evidenceSummary,
    evidenceReadinessDiagnosticSummary,
    rangeFirstValuationDiagnosticSummary,
    valuationSummary,
    confidenceSummary,
    confidenceCalibrationDiagnosticSummary,
    listingQualityGradingDiagnosticSummary,
    gradingSummary,
    riskSummary,
    intelligenceEngineSummaries,
    dealGateInputs: dealGate.inputs,
    dealGateOutcome: dealGate.outcome,
    buyNowEligibility: dealGate.buyNowEligibility,
    explanationChain: [],
    metadata: clone(asObject(input.metadata))
  };

  trace.explanationChain = buildExplanationChain(input, {
    ...summaries,
    dealGateOutcome: trace.dealGateOutcome
  });
  trace.stableFingerprint = buildProductionIntelligenceTraceFingerprint(trace);

  return deepFreeze(trace);
}

function cloneProductionIntelligenceTrace(trace = {}) {
  return clone(trace);
}

module.exports = {
  PRODUCTION_INTELLIGENCE_TRACE_SCHEMA_VERSION,
  PRODUCTION_INTELLIGENCE_TRACE_SOURCE,
  UNKNOWN_VALUE,
  buildProductionIntelligenceTraceFingerprint,
  cloneProductionIntelligenceTrace,
  createProductionIntelligenceTrace
};
