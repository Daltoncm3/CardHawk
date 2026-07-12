'use strict';

const SCHEMA_VERSION = '1.0.0';

const SIGNAL_TYPES = Object.freeze({
  evidence: 'evidence',
  context: 'context',
  financial: 'financial',
  legacy: 'legacy',
  productionDecision: 'production_decision'
});

const DECISION_ELIGIBILITY = Object.freeze({
  none: 'none',
  contextOnly: 'context_only',
  evidenceOnly: 'evidence_only',
  decisionSupport: 'decision_support',
  productionDecision: 'production_decision'
});

const DISPLAY_LANGUAGE = Object.freeze({
  neutral: 'neutral',
  contextOnly: 'context_only',
  financialOnly: 'financial_only',
  evidenceOnly: 'evidence_only',
  productionDecision: 'production_decision',
  legacyContext: 'legacy_context'
});

const SIGNAL_CONTRACTS = Object.freeze([
  Object.freeze({
    signalId: 'legacy_score',
    owner: 'server.scoreListing',
    purpose: 'Legacy blended opportunity score combining listing traits, profit, ROI, confidence, market source, and seller signals.',
    signalType: SIGNAL_TYPES.legacy,
    decisionEligibility: DECISION_ELIGIBILITY.decisionSupport,
    requiresTrueSold: false,
    allowsActiveEvidence: true,
    allowsFallbackEvidence: true,
    allowedDisplayLanguage: DISPLAY_LANGUAGE.legacyContext,
    displayPriority: 60,
    confidenceMeaning: 'Not a confidence score; numeric priority score from multiple legacy factors.',
    schemaVersion: SCHEMA_VERSION
  }),
  Object.freeze({
    signalId: 'quality_score',
    owner: 'qualityEngine.evaluateQuality',
    purpose: 'Card desirability and resale context score based on traits, liquidity, risk, profit, ROI, confidence, comps, and seller signals.',
    signalType: SIGNAL_TYPES.context,
    decisionEligibility: DECISION_ELIGIBILITY.contextOnly,
    requiresTrueSold: false,
    allowsActiveEvidence: true,
    allowsFallbackEvidence: true,
    allowedDisplayLanguage: DISPLAY_LANGUAGE.contextOnly,
    displayPriority: 50,
    confidenceMeaning: 'Not a confidence score; desirability context and quality posture.',
    schemaVersion: SCHEMA_VERSION
  }),
  Object.freeze({
    signalId: 'quality_bucket',
    owner: 'qualityEngine.evaluateQuality',
    purpose: 'Human-readable desirability bucket derived from quality score.',
    signalType: SIGNAL_TYPES.context,
    decisionEligibility: DECISION_ELIGIBILITY.contextOnly,
    requiresTrueSold: false,
    allowsActiveEvidence: true,
    allowsFallbackEvidence: true,
    allowedDisplayLanguage: DISPLAY_LANGUAGE.contextOnly,
    displayPriority: 51,
    confidenceMeaning: 'Bucket label is not evidence confidence and must not be treated as a recommendation.',
    schemaVersion: SCHEMA_VERSION
  }),
  Object.freeze({
    signalId: 'deal_grade',
    owner: 'gradingEngine.gradeDeal',
    purpose: 'Legacy deal grade summarizing profit, ROI, confidence, score, comp count/source, card traits, and seller/listing quality.',
    signalType: SIGNAL_TYPES.legacy,
    decisionEligibility: DECISION_ELIGIBILITY.decisionSupport,
    requiresTrueSold: false,
    allowsActiveEvidence: true,
    allowsFallbackEvidence: true,
    allowedDisplayLanguage: DISPLAY_LANGUAGE.legacyContext,
    displayPriority: 55,
    confidenceMeaning: 'Grade is not confidence; it is a legacy blended grade and must defer to Deal Gate.',
    schemaVersion: SCHEMA_VERSION
  }),
  Object.freeze({
    signalId: 'market_confidence',
    owner: 'server.scoreListing',
    purpose: 'Market context confidence selected from confidenceEngine and marketValueEngine confidence outputs.',
    signalType: SIGNAL_TYPES.context,
    decisionEligibility: DECISION_ELIGIBILITY.decisionSupport,
    requiresTrueSold: false,
    allowsActiveEvidence: true,
    allowsFallbackEvidence: true,
    allowedDisplayLanguage: DISPLAY_LANGUAGE.contextOnly,
    displayPriority: 40,
    confidenceMeaning: 'Confidence in available market context, not proof of true sold evidence.',
    schemaVersion: SCHEMA_VERSION
  }),
  Object.freeze({
    signalId: 'sold_evidence_confidence',
    owner: 'canonicalSoldEvidence/evidenceSufficiency',
    purpose: 'Confidence posture for true sold evidence depth, freshness, and quality.',
    signalType: SIGNAL_TYPES.evidence,
    decisionEligibility: DECISION_ELIGIBILITY.evidenceOnly,
    requiresTrueSold: true,
    allowsActiveEvidence: false,
    allowsFallbackEvidence: false,
    allowedDisplayLanguage: DISPLAY_LANGUAGE.evidenceOnly,
    displayPriority: 35,
    confidenceMeaning: 'Strength of true sold evidence only; active and aggregate context cannot satisfy it.',
    schemaVersion: SCHEMA_VERSION
  }),
  Object.freeze({
    signalId: 'intelligence_score',
    owner: 'marketIntelligenceEngine.evaluateMarketIntelligence',
    purpose: 'Market reliability and investability score from liquidity, demand, velocity, trend, volatility, pricing reliability, comp strength, and depth.',
    signalType: SIGNAL_TYPES.context,
    decisionEligibility: DECISION_ELIGIBILITY.decisionSupport,
    requiresTrueSold: false,
    allowsActiveEvidence: true,
    allowsFallbackEvidence: true,
    allowedDisplayLanguage: DISPLAY_LANGUAGE.contextOnly,
    displayPriority: 45,
    confidenceMeaning: 'Composite market intelligence score; not the production decision.',
    schemaVersion: SCHEMA_VERSION
  }),
  Object.freeze({
    signalId: 'confidence_score',
    owner: 'marketIntelligenceEngine.evaluateMarketIntelligence',
    purpose: 'Market Intelligence confidence score combining raw confidence, comp strength, pricing reliability, and market depth.',
    signalType: SIGNAL_TYPES.context,
    decisionEligibility: DECISION_ELIGIBILITY.decisionSupport,
    requiresTrueSold: false,
    allowsActiveEvidence: true,
    allowsFallbackEvidence: true,
    allowedDisplayLanguage: DISPLAY_LANGUAGE.contextOnly,
    displayPriority: 42,
    confidenceMeaning: 'Confidence in Market Intelligence context, distinct from sold evidence confidence.',
    schemaVersion: SCHEMA_VERSION
  }),
  Object.freeze({
    signalId: 'trust_level',
    owner: 'marketIntelligenceEngine.evaluateMarketIntelligence',
    purpose: 'Human-readable trust tier derived from Market Intelligence score.',
    signalType: SIGNAL_TYPES.context,
    decisionEligibility: DECISION_ELIGIBILITY.contextOnly,
    requiresTrueSold: false,
    allowsActiveEvidence: true,
    allowsFallbackEvidence: true,
    allowedDisplayLanguage: DISPLAY_LANGUAGE.contextOnly,
    displayPriority: 43,
    confidenceMeaning: 'Trust tier summarizes Market Intelligence score; it is not a production recommendation.',
    schemaVersion: SCHEMA_VERSION
  }),
  Object.freeze({
    signalId: 'roi_recommendation',
    owner: 'roiEngine.evaluateROI',
    purpose: 'Financial posture derived from expected sale price, costs, fees, risk buffer, profit, ROI, margin of safety, and market confidence.',
    signalType: SIGNAL_TYPES.financial,
    decisionEligibility: DECISION_ELIGIBILITY.contextOnly,
    requiresTrueSold: false,
    allowsActiveEvidence: true,
    allowsFallbackEvidence: true,
    allowedDisplayLanguage: DISPLAY_LANGUAGE.financialOnly,
    displayPriority: 65,
    confidenceMeaning: 'ROI recommendation reflects financial math only and must not imply evidence-backed production approval.',
    schemaVersion: SCHEMA_VERSION
  }),
  Object.freeze({
    signalId: 'decision_intelligence',
    owner: 'decisionIntelligenceEngine.evaluateDecisionIntelligence',
    purpose: 'Explanation-only synthesis of evidence sufficiency, listing similarity, comparable quality, valuation range, and supply pressure.',
    signalType: SIGNAL_TYPES.evidence,
    decisionEligibility: DECISION_ELIGIBILITY.evidenceOnly,
    requiresTrueSold: false,
    allowsActiveEvidence: true,
    allowsFallbackEvidence: true,
    allowedDisplayLanguage: DISPLAY_LANGUAGE.evidenceOnly,
    displayPriority: 30,
    confidenceMeaning: 'Explanation confidence only; recommendationImpact must remain none until explicitly promoted.',
    schemaVersion: SCHEMA_VERSION
  }),
  Object.freeze({
    signalId: 'deal_gate',
    owner: 'server.dealGate',
    purpose: 'Authoritative production BUY_NOW/PASS gate using sold-comp support, confidence, Market Intelligence, liquidity, pricing reliability, risk, ROI sanity, condition, and fallback checks.',
    signalType: SIGNAL_TYPES.productionDecision,
    decisionEligibility: DECISION_ELIGIBILITY.productionDecision,
    requiresTrueSold: true,
    allowsActiveEvidence: true,
    allowsFallbackEvidence: false,
    allowedDisplayLanguage: DISPLAY_LANGUAGE.productionDecision,
    displayPriority: 10,
    confidenceMeaning: 'Binary production eligibility gate; not a confidence score.',
    schemaVersion: SCHEMA_VERSION
  })
]);

const CONTRACTS_BY_ID = Object.freeze(Object.fromEntries(
  SIGNAL_CONTRACTS.map((contract) => [contract.signalId, contract])
));

function listSignalContracts() {
  return SIGNAL_CONTRACTS.map((contract) => ({ ...contract }));
}

function getSignalContract(signalId) {
  const contract = CONTRACTS_BY_ID[String(signalId || '')];
  return contract ? { ...contract } : null;
}

function hasSignalContract(signalId) {
  return Boolean(CONTRACTS_BY_ID[String(signalId || '')]);
}

function getDecisionEligibleSignals() {
  return listSignalContracts().filter((contract) => (
    contract.decisionEligibility === DECISION_ELIGIBILITY.decisionSupport ||
    contract.decisionEligibility === DECISION_ELIGIBILITY.productionDecision
  ));
}

function getProductionDecisionSignals() {
  return listSignalContracts().filter((contract) => (
    contract.signalType === SIGNAL_TYPES.productionDecision ||
    contract.decisionEligibility === DECISION_ELIGIBILITY.productionDecision
  ));
}

module.exports = {
  SCHEMA_VERSION,
  SIGNAL_TYPES,
  DECISION_ELIGIBILITY,
  DISPLAY_LANGUAGE,
  listSignalContracts,
  getSignalContract,
  hasSignalContract,
  getDecisionEligibleSignals,
  getProductionDecisionSignals
};
