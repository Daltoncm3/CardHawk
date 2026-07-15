'use strict';

const crypto = require('node:crypto');

const SCHEMA_VERSION = '1.0.0';
const VERSION = 'review-workspace-contract-v0.1';
const SOURCE = 'review_workspace_contract';

const REQUIRED_COMPONENTS = Object.freeze([
  'listingSnapshot',
  'productionOutputs',
  'shadowOutputs',
  'investmentDecision',
  'strategyLane',
  'canonicalIdentity',
  'shadowValuation',
  'shadowSoldComparison',
  'validationCandidate',
  'capitalScoreExplanation',
  'daltonReview',
  'actualOutcome',
  'auditMetadata'
]);

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function clone(value) {
  return JSON.parse(JSON.stringify(value ?? null));
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

function hasValue(value) {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return value !== '';
}

function getListingId(snapshot = {}, index = 0) {
  const input = asObject(snapshot.investmentDecisionInput || snapshot.input);
  const listing = asObject(snapshot.listingSnapshot || snapshot.listing || input.listingSnapshot || snapshot);
  return String(
    listing.ebayItemId ||
    listing.marketplaceItemId ||
    listing.itemId ||
    listing.listingId ||
    listing.id ||
    snapshot.recordId ||
    `review-workspace-${index + 1}`
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

function getProductionOutputs(snapshot = {}, input = {}) {
  return {
    dealGate: clone(snapshot.dealGate || input.dealGate),
    productionValuation: clone(snapshot.productionValuation || input.productionValuation),
    productionDecisionExplanation: clone(snapshot.productionDecisionExplanation || input.productionDecisionExplanation),
    marketIntelligence: clone(snapshot.marketIntelligence || input.marketIntelligence),
    confidenceBreakdown: clone(snapshot.confidenceBreakdown || input.confidenceBreakdown),
    financialContext: clone(snapshot.financialContext || input.financialContext),
    rawProductionOutputs: clone(snapshot.productionOutputs || snapshot.cardhawkSnapshot || null)
  };
}

function getShadowOutputs(snapshot = {}, input = {}) {
  return {
    canonicalIdentity: clone(snapshot.canonicalIdentity || input.canonicalIdentity),
    canonicalSoldEvidence: clone(snapshot.canonicalSoldEvidence || input.canonicalSoldEvidence),
    shadowSoldComparison: clone(snapshot.shadowSoldComparison || input.shadowSoldComparison),
    shadowValuation: clone(snapshot.shadowValuation || input.shadowValuation),
    rawShadowOutputs: clone(snapshot.shadowOutputs || null)
  };
}

function getStrategyLane(investmentDecision = {}, snapshot = {}) {
  const explicit = asObject(snapshot.strategyLane);
  if (Object.keys(explicit).length) return clone(explicit);

  const fit = asObject(investmentDecision.strategyFit);
  return {
    selectedContextLane: fit.selectedContextLane || 'unknown',
    preferredStrategyLanes: asArray(fit.preferredStrategyLanes),
    laneEvaluations: clone(fit.laneEvaluations || []),
    productionImpact: fit.productionImpact || 'none',
    explanation: fit.explanation || 'Strategy lane context was not available.'
  };
}

function getDaltonReviewPlaceholder(snapshot = {}) {
  const review = asObject(snapshot.daltonReview);
  return {
    reviewer: review.reviewer || 'Dalton',
    reviewStatus: review.reviewStatus || (review.decision || review.judgment ? 'reviewed' : 'not_reviewed'),
    decision: review.decision || review.investmentPosture || review.judgment || 'UNREVIEWED',
    strategyLane: review.strategyLane || '',
    confidence: review.confidence ?? review.judgmentConfidence ?? null,
    agreementReason: review.agreementReason || review.agreementDisagreementReason || '',
    disagreementCategories: asArray(review.disagreementCategories),
    notes: review.notes || ''
  };
}

function getOutcomePlaceholder(snapshot = {}) {
  const outcome = asObject(snapshot.actualOutcome || snapshot.outcome);
  return {
    outcomeStatus: outcome.outcomeStatus || outcome.status || 'pending',
    soldPrice: outcome.soldPrice ?? null,
    netProfit: outcome.netProfit ?? null,
    roi: outcome.roi ?? null,
    daysToExit: outcome.daysToExit ?? null,
    outcomeCategory: outcome.outcomeCategory || '',
    notes: outcome.notes || ''
  };
}

function getComponentAvailability(workspace = {}) {
  return REQUIRED_COMPONENTS.reduce((availability, component) => {
    availability[component] = hasValue(workspace[component]);
    return availability;
  }, {});
}

function getMissingComponents(availability = {}) {
  return Object.entries(availability)
    .filter(([, available]) => available !== true)
    .map(([component]) => component);
}

function createReviewWorkspace(snapshot = {}, options = {}) {
  const index = options.index || 0;
  const input = getInvestmentInput(snapshot);
  const listingSnapshot = clone(snapshot.listingSnapshot || snapshot.listing || input.listingSnapshot || {});
  const investmentDecision = clone(snapshot.investmentDecision || null);
  const productionOutputs = getProductionOutputs(snapshot, input);
  const shadowOutputs = getShadowOutputs(snapshot, input);
  const workspaceCore = {
    schemaVersion: SCHEMA_VERSION,
    source: SOURCE,
    version: VERSION,
    workspaceId: options.workspaceId || snapshot.workspaceId || `${getListingId(snapshot, index)}:review-workspace`,
    listingId: getListingId(snapshot, index),
    reviewMode: 'offline_single_listing_review',
    productionImpact: 'none',
    decisionImpact: 'none',
    listingSnapshot,
    productionOutputs,
    shadowOutputs,
    investmentDecision,
    strategyLane: getStrategyLane(investmentDecision || {}, snapshot),
    canonicalIdentity: clone(shadowOutputs.canonicalIdentity),
    shadowValuation: clone(shadowOutputs.shadowValuation),
    shadowSoldComparison: clone(shadowOutputs.shadowSoldComparison),
    validationCandidate: clone(snapshot.validationCandidate || null),
    capitalScoreExplanation: clone(snapshot.capitalScoreExplanation || null),
    daltonReview: getDaltonReviewPlaceholder(snapshot),
    actualOutcome: getOutcomePlaceholder(snapshot)
  };

  const componentAvailability = getComponentAvailability({
    ...workspaceCore,
    auditMetadata: { placeholder: true }
  });
  const missingComponents = getMissingComponents(componentAvailability);
  const auditMetadata = {
    generatedAt: options.generatedAt || snapshot.capturedAt || 'not_provided',
    generatedBy: SOURCE,
    aggregationOnly: true,
    createsNewIntelligence: false,
    componentAvailability,
    missingComponents,
    inputFingerprint: fingerprint({ input, listingSnapshot }),
    productionFingerprint: fingerprint(productionOutputs),
    shadowFingerprint: fingerprint(shadowOutputs),
    investmentDecisionFingerprint: investmentDecision ? fingerprint(investmentDecision) : null,
    validationCandidateFingerprint: workspaceCore.validationCandidate ? fingerprint(workspaceCore.validationCandidate) : null
  };
  const workspace = {
    ...workspaceCore,
    auditMetadata
  };

  return {
    ...workspace,
    workspaceHash: fingerprint(workspace)
  };
}

function validateReviewWorkspace(workspace = {}) {
  const errors = [];

  if (workspace.schemaVersion !== SCHEMA_VERSION) errors.push('schemaVersion must match Review Workspace schema.');
  if (workspace.source !== SOURCE) errors.push('source must be review_workspace_contract.');
  if (!workspace.workspaceId) errors.push('workspaceId is required.');
  if (!workspace.listingId) errors.push('listingId is required.');
  if (workspace.productionImpact !== 'none') errors.push('productionImpact must remain none.');
  if (workspace.decisionImpact !== 'none') errors.push('decisionImpact must remain none.');
  for (const component of REQUIRED_COMPONENTS) {
    if (!Object.prototype.hasOwnProperty.call(workspace, component)) {
      errors.push(`missing_component_${component}`);
    }
  }
  if (!workspace.auditMetadata?.aggregationOnly) errors.push('auditMetadata.aggregationOnly must be true.');
  if (workspace.auditMetadata?.createsNewIntelligence !== false) errors.push('Review Workspace must not create new intelligence.');

  const expectedHash = workspace.workspaceHash
    ? fingerprint(Object.fromEntries(Object.entries(workspace).filter(([key]) => key !== 'workspaceHash')))
    : null;
  if (!workspace.workspaceHash) errors.push('workspaceHash is required.');
  if (workspace.workspaceHash && workspace.workspaceHash !== expectedHash) {
    errors.push('workspaceHash does not match workspace contents.');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

function buildReviewWorkspaceBatch(snapshots = [], options = {}) {
  const workspaces = asArray(snapshots).map((snapshot, index) => createReviewWorkspace(snapshot, {
    ...options,
    index,
    workspaceId: snapshot.workspaceId
  }));

  return {
    schemaVersion: SCHEMA_VERSION,
    source: `${SOURCE}_batch`,
    version: VERSION,
    mode: 'offline_review_workspace_batch',
    batchId: options.batchId || 'review-workspace-batch',
    generatedAt: options.generatedAt || 'not_provided',
    productionImpact: 'none',
    workspaces
  };
}

module.exports = {
  REQUIRED_COMPONENTS,
  SCHEMA_VERSION,
  SOURCE,
  VERSION,
  buildReviewWorkspaceBatch,
  createReviewWorkspace,
  fingerprint,
  validateReviewWorkspace
};
