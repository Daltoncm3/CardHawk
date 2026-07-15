'use strict';

const crypto = require('node:crypto');

const investmentDecisionEngine = require('../engines/investmentDecisionEngine');

const SCHEMA_VERSION = '1.0.0';
const SOURCE = 'validation_candidate_selector';

const CANDIDATE_CATEGORIES = Object.freeze([
  'production_vs_shadow_disagreement',
  'high_uncertainty',
  'weak_evidence',
  'strong_evidence_rejected',
  'shadow_without_production_support',
  'production_without_shadow_support',
  'identity_conflict',
  'valuation_conflict',
  'edge_case',
  'learning_opportunity'
]);

const CATEGORY_WEIGHTS = Object.freeze({
  production_vs_shadow_disagreement: 92,
  valuation_conflict: 88,
  identity_conflict: 84,
  strong_evidence_rejected: 80,
  production_without_shadow_support: 78,
  shadow_without_production_support: 76,
  weak_evidence: 70,
  high_uncertainty: 66,
  edge_case: 58,
  learning_opportunity: 35
});

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function clone(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function toNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function round(value, places = 2) {
  const number = toNumber(value, 0);
  const factor = 10 ** places;
  return Math.round(number * factor) / factor;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function fingerprint(value) {
  return crypto.createHash('sha256').update(stableStringify(value)).digest('hex');
}

function unique(values = []) {
  return [...new Set(asArray(values).filter(Boolean))];
}

function getListingId(snapshot = {}, index = 0) {
  const listing = asObject(snapshot.listingSnapshot || snapshot.listing || snapshot.investmentDecisionInput?.listingSnapshot || snapshot.input?.listingSnapshot);
  return String(
    listing.ebayItemId ||
    listing.marketplaceItemId ||
    listing.itemId ||
    listing.listingId ||
    listing.id ||
    snapshot.recordId ||
    `validation-candidate-${index + 1}`
  );
}

function getInvestmentInput(snapshot = {}) {
  const input = asObject(snapshot.investmentDecisionInput || snapshot.input);
  if (Object.keys(input).length) return clone(input);

  return {
    listingSnapshot: clone(snapshot.listingSnapshot || snapshot.listing || snapshot),
    dealGate: clone(snapshot.dealGate),
    productionValuation: clone(snapshot.productionValuation),
    productionDecisionExplanation: clone(snapshot.productionDecisionExplanation),
    canonicalIdentity: clone(snapshot.canonicalIdentity),
    canonicalSoldEvidence: clone(snapshot.canonicalSoldEvidence),
    shadowSoldComparison: clone(snapshot.shadowSoldComparison),
    shadowValuation: clone(snapshot.shadowValuation),
    marketIntelligence: clone(snapshot.marketIntelligence),
    confidenceBreakdown: clone(snapshot.confidenceBreakdown),
    financialContext: clone(snapshot.financialContext),
    portfolioContext: clone(snapshot.portfolioContext),
    strategyProfile: clone(snapshot.strategyProfile),
    competingOpportunities: clone(snapshot.competingOpportunities || [])
  };
}

function getInvestmentDecision(snapshot = {}, input = {}) {
  if (snapshot.investmentDecision) return clone(snapshot.investmentDecision);
  return investmentDecisionEngine.evaluateInvestmentDecision(input);
}

function getExactSoldCount(input = {}) {
  const comparison = asObject(input.shadowSoldComparison);
  const shadow = asObject(input.shadowValuation);
  const sold = asObject(input.canonicalSoldEvidence);
  return Math.max(
    asArray(comparison.acceptedExactMatches).length,
    toNumber(comparison.processingSummary?.exactMatchCount, 0),
    toNumber(shadow.evidenceSummary?.exactMatchCount, 0),
    toNumber(sold.trueSoldCount, 0)
  );
}

function getProductionDecision(input = {}) {
  const gate = asObject(input.dealGate);
  if (gate.passed === true || gate.buyNowAllowed === true) return 'production_supported';
  if (gate.passed === false || gate.buyNowAllowed === false) return 'production_rejected';
  return 'production_unknown';
}

function getShadowState(input = {}) {
  const shadow = asObject(input.shadowValuation);
  if (shadow.insufficientEvidence === true) return 'shadow_insufficient';
  if (toNumber(shadow.recommendedMarketValue, null) !== null) return 'shadow_supported';
  return 'shadow_unknown';
}

function getProductionValue(input = {}) {
  const production = asObject(input.productionValuation);
  return toNumber(production.estimatedValue ?? production.marketValue, null);
}

function getShadowValue(input = {}) {
  const shadow = asObject(input.shadowValuation);
  return toNumber(shadow.recommendedMarketValue ?? shadow.fairMarketRange?.expectedValue, null);
}

function getValueDifference(input = {}) {
  const productionValue = getProductionValue(input);
  const shadowValue = getShadowValue(input);
  if (productionValue === null || shadowValue === null || productionValue <= 0) {
    return {
      productionValue,
      shadowValue,
      absoluteDifference: null,
      percentageDifference: null
    };
  }

  const absoluteDifference = round(shadowValue - productionValue);
  return {
    productionValue,
    shadowValue,
    absoluteDifference,
    percentageDifference: round((absoluteDifference / productionValue) * 100, 1)
  };
}

function getEvidenceSummary(input = {}) {
  const identity = asObject(input.canonicalIdentity);
  const shadow = asObject(input.shadowValuation);
  const sold = asObject(input.canonicalSoldEvidence);
  const comparison = asObject(input.shadowSoldComparison);

  return {
    exactSoldCount: getExactSoldCount(input),
    recentSoldCount: toNumber(sold.recentSoldCount, 0),
    acceptedExactMatchCount: asArray(comparison.acceptedExactMatches).length,
    contextualMatchCount: asArray(comparison.contextualMatches).length,
    rejectedMatchCount: asArray(comparison.rejectedMatches).length,
    insufficientIdentityMatchCount: asArray(comparison.insufficientIdentityMatches).length,
    shadowValuationAvailable: shadow.insufficientEvidence !== true && getShadowValue(input) !== null,
    insufficientEvidence: shadow.insufficientEvidence === true,
    insufficientEvidenceReason: shadow.insufficientEvidenceReason || '',
    exactCompEligible: identity.eligibility?.exactCompEligible === true,
    valuationEligible: identity.eligibility?.valuationEligible === true,
    identityConfidence: toNumber(identity.overallIdentityConfidence, null),
    productionDealGatePassed: input.dealGate?.passed === true,
    activeListingsTreatedAsSold: false
  };
}

function getUncertaintySummary(input = {}, investmentDecision = {}) {
  const identity = asObject(input.canonicalIdentity);
  const blockers = asArray(investmentDecision.blockers);
  const cautions = asArray(investmentDecision.cautionReasons);
  const missingInputs = unique([
    ...asArray(investmentDecision.stageReadiness?.eligibilityAndEvidence?.missingInputs),
    ...asArray(investmentDecision.stageReadiness?.downsideAndValuationSafety?.missingInputs),
    ...asArray(investmentDecision.stageReadiness?.financialAttractiveness?.missingInputs),
    ...asArray(investmentDecision.stageReadiness?.exitAndCapitalVelocity?.missingInputs),
    ...asArray(investmentDecision.stageReadiness?.marketAndPortfolioContext?.missingInputs)
  ]);
  const identityConfidence = toNumber(identity.overallIdentityConfidence, null);
  const unknownFields = asArray(identity.unknownFields);
  const warnings = asArray(identity.normalizationWarnings);
  const level = blockers.length || identity.eligibility?.exactCompEligible === false
    ? 'high'
    : cautions.length >= 2 || missingInputs.length >= 2 || (identityConfidence !== null && identityConfidence < 75)
      ? 'medium'
      : 'low';

  return {
    uncertaintyLevel: level,
    blockers,
    cautions,
    missingInputs,
    identityUnknownFields: unknownFields,
    normalizationWarnings: warnings,
    identityConfidence
  };
}

function detectCategories(input = {}, investmentDecision = {}, evidenceSummary = {}, uncertaintySummary = {}) {
  const categories = new Set();
  const productionDecision = getProductionDecision(input);
  const shadowState = getShadowState(input);
  const valueDifference = getValueDifference(input);
  const dealGatePassed = productionDecision === 'production_supported';
  const shadowSupported = shadowState === 'shadow_supported';
  const shadowInsufficient = shadowState === 'shadow_insufficient';

  if (dealGatePassed && shadowInsufficient) {
    categories.add('production_vs_shadow_disagreement');
    categories.add('production_without_shadow_support');
  }
  if (!dealGatePassed && shadowSupported) {
    categories.add('production_vs_shadow_disagreement');
    categories.add('shadow_without_production_support');
  }
  if (!dealGatePassed && evidenceSummary.exactSoldCount >= 3 && shadowSupported) {
    categories.add('strong_evidence_rejected');
  }
  if (evidenceSummary.exactSoldCount < 3 || shadowInsufficient) categories.add('weak_evidence');
  if (
    evidenceSummary.exactCompEligible === false ||
    evidenceSummary.valuationEligible === false ||
    evidenceSummary.insufficientIdentityMatchCount > 0 ||
    uncertaintySummary.identityUnknownFields.length >= 3 ||
    uncertaintySummary.normalizationWarnings.length
  ) {
    categories.add('identity_conflict');
  }
  if (valueDifference.percentageDifference !== null && Math.abs(valueDifference.percentageDifference) >= 25) {
    categories.add('valuation_conflict');
  }
  if (uncertaintySummary.uncertaintyLevel === 'high') categories.add('high_uncertainty');
  if (!Object.keys(asObject(input.listingSnapshot)).length || asArray(investmentDecision.auditTrail).some((entry) => entry.valid === false)) {
    categories.add('edge_case');
  }
  if (!categories.size) categories.add('learning_opportunity');

  return [...categories].filter((category) => CANDIDATE_CATEGORIES.includes(category));
}

function getLearningPriority(categories = [], uncertaintySummary = {}, evidenceSummary = {}) {
  const base = Math.max(...categories.map((category) => CATEGORY_WEIGHTS[category] || 0), CATEGORY_WEIGHTS.learning_opportunity);
  const uncertaintyBonus = uncertaintySummary.uncertaintyLevel === 'high' ? 6 : uncertaintySummary.uncertaintyLevel === 'medium' ? 3 : 0;
  const evidenceBonus = evidenceSummary.exactSoldCount === 0 ? 4 : evidenceSummary.exactSoldCount < 3 ? 2 : 0;
  return Math.min(100, base + uncertaintyBonus + evidenceBonus);
}

function getReviewPriority(learningPriority) {
  if (learningPriority >= 90) return 'urgent';
  if (learningPriority >= 75) return 'high';
  if (learningPriority >= 55) return 'medium';
  return 'low';
}

function getSuggestedValidationFocus(categories = []) {
  const focus = [];
  if (categories.includes('production_vs_shadow_disagreement')) focus.push('Compare production decision against shadow evidence.');
  if (categories.includes('valuation_conflict')) focus.push('Review production valuation versus Shadow Valuation.');
  if (categories.includes('identity_conflict')) focus.push('Verify exact card identity and rejected identity reasons.');
  if (categories.includes('weak_evidence')) focus.push('Check whether missing sold evidence is expected or a retrieval gap.');
  if (categories.includes('strong_evidence_rejected')) focus.push('Determine why strong evidence still failed production gating.');
  if (categories.includes('production_without_shadow_support')) focus.push('Confirm production support is not relying on unsupported evidence.');
  if (categories.includes('shadow_without_production_support')) focus.push('Review whether shadow evidence reveals a missed opportunity.');
  if (categories.includes('high_uncertainty')) focus.push('Identify which missing inputs most affect investment posture.');
  if (categories.includes('edge_case')) focus.push('Inspect malformed or unusual input shape.');
  if (!focus.length) focus.push('Use as a baseline agreement case.');
  return focus;
}

function getRecommendedReviewReason(primaryCategory, categories = [], learningPriority = 0) {
  const readable = primaryCategory.replace(/_/g, ' ');
  return `Review this listing for ${readable}; expected learning value is ${learningPriority}/100 across ${categories.length} category signal(s).`;
}

function getPrimaryCategory(categories = []) {
  if (categories.includes('edge_case')) return 'edge_case';
  return categories
    .slice()
    .sort((a, b) => (CATEGORY_WEIGHTS[b] || 0) - (CATEGORY_WEIGHTS[a] || 0) || a.localeCompare(b))[0] || 'learning_opportunity';
}

function getDisagreementSummary(input = {}, investmentDecision = {}) {
  const valueDifference = getValueDifference(input);
  const productionDecision = getProductionDecision(input);
  const shadowState = getShadowState(input);
  const reasons = [];

  if (productionDecision === 'production_supported' && shadowState === 'shadow_insufficient') {
    reasons.push('production_supported_but_shadow_evidence_insufficient');
  }
  if (productionDecision === 'production_rejected' && shadowState === 'shadow_supported') {
    reasons.push('production_rejected_but_shadow_value_available');
  }
  if (valueDifference.percentageDifference !== null && Math.abs(valueDifference.percentageDifference) >= 25) {
    reasons.push('production_shadow_value_difference_exceeds_25_percent');
  }

  return {
    productionDecision,
    investmentPosture: investmentDecision.investmentPosture || 'unknown',
    shadowValuationState: shadowState,
    valueDifference,
    reasons
  };
}

function evaluateValidationCandidate(snapshot = {}, options = {}) {
  const index = options.index || 0;
  const input = getInvestmentInput(snapshot);
  const investmentDecision = getInvestmentDecision(snapshot, input);
  const evidenceSummary = getEvidenceSummary(input);
  const uncertaintySummary = getUncertaintySummary(input, investmentDecision);
  const categories = detectCategories(input, investmentDecision, evidenceSummary, uncertaintySummary);
  const primaryCategory = getPrimaryCategory(categories);
  const learningPriority = getLearningPriority(categories, uncertaintySummary, evidenceSummary);
  const candidateId = `${getListingId(snapshot.investmentDecisionInput || snapshot.input || snapshot, index)}:${fingerprint({
    categories,
    investmentPosture: investmentDecision.investmentPosture,
    evidenceSummary
  }).slice(0, 12)}`;

  return {
    schemaVersion: SCHEMA_VERSION,
    source: SOURCE,
    candidateId,
    listingId: getListingId(snapshot.investmentDecisionInput || snapshot.input || snapshot, index),
    learningPriority,
    reviewPriority: getReviewPriority(learningPriority),
    candidateCategory: primaryCategory,
    candidateCategories: categories,
    recommendedReviewReason: getRecommendedReviewReason(primaryCategory, categories, learningPriority),
    evidenceSummary,
    disagreementSummary: getDisagreementSummary(input, investmentDecision),
    uncertaintySummary,
    suggestedValidationFocus: getSuggestedValidationFocus(categories),
    productionImpact: 'none'
  };
}

function selectValidationCandidates(snapshots = [], options = {}) {
  const candidates = asArray(snapshots)
    .map((snapshot, index) => evaluateValidationCandidate(snapshot, { ...options, index }))
    .sort((a, b) => (
      b.learningPriority - a.learningPriority ||
      a.candidateCategory.localeCompare(b.candidateCategory) ||
      a.candidateId.localeCompare(b.candidateId)
    ));

  const limit = toNumber(options.limit, null);
  return limit === null ? candidates : candidates.slice(0, Math.max(0, limit));
}

module.exports = {
  CANDIDATE_CATEGORIES,
  CATEGORY_WEIGHTS,
  SCHEMA_VERSION,
  SOURCE,
  evaluateValidationCandidate,
  selectValidationCandidates
};
