'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const investmentDecisionEngine = require('../engines/investmentDecisionEngine');
const capitalScoreExplanationEngine = require('../engines/capitalScoreExplanationEngine');
const reviewWorkspace = require('../validation/reviewWorkspaceContract');
const selector = require('../validation/validationCandidateSelector');
const strategyContract = require('../validation/strategyLaneContract');

function exactMatches(count) {
  return Array.from({ length: count }, (_, index) => ({
    classification: 'exact_match',
    valuationEligible: true,
    recordId: `workspace-exact-${index + 1}`,
    evidenceType: 'true_sold',
    soldPrice: 100 + index,
    soldAt: `2026-07-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
    confidence: {
      identityConfidence: 0.97,
      evidenceQualityScore: 92
    }
  }));
}

function buildInvestmentInput(overrides = {}) {
  const exactMatchCount = overrides.exactMatchCount ?? 4;
  const totalCost = overrides.totalCost ?? 70;
  const maximumBuyPrice = overrides.maximumBuyPrice ?? 100;
  const expectedNetProfit = overrides.expectedNetProfit ?? 25;
  const roi = overrides.roi ?? 0.35;
  const matches = exactMatches(exactMatchCount);

  return {
    listingSnapshot: {
      itemId: overrides.itemId || 'review-workspace-fixture',
      title: '2020 Panini Prizm Joe Burrow RC #307 PSA 10',
      price: totalCost,
      totalCost
    },
    dealGate: overrides.dealGate || {
      passed: true,
      buyNowAllowed: true,
      decision: 'BUY_NOW',
      reasons: [],
      positives: ['Fixture Deal Gate pass.']
    },
    productionValuation: {
      estimatedValue: totalCost + expectedNetProfit,
      estimatedProfit: expectedNetProfit,
      roi
    },
    productionDecisionExplanation: {
      primaryExplanation: 'Fixture production explanation.'
    },
    canonicalIdentity: {
      canonicalIdentityKey: 'ci:v1:sports:football:2020:panini:prizm:joe-burrow:307:base:non-auto:non-mem:unnumbered:graded:psa-10',
      eligibility: {
        exactCompEligible: true,
        valuationEligible: true,
        manualReviewRequired: false,
        contextOnly: false
      },
      overallIdentityConfidence: 96
    },
    canonicalSoldEvidence: {
      trueSoldCount: exactMatchCount,
      recentSoldCount: exactMatchCount,
      records: matches
    },
    shadowSoldComparison: {
      acceptedExactMatches: matches,
      contextualMatches: [],
      rejectedMatches: [],
      staleMatches: [],
      insufficientIdentityMatches: [],
      processingSummary: { exactMatchCount }
    },
    shadowValuation: {
      insufficientEvidence: false,
      insufficientEvidenceReason: '',
      recommendedMarketValue: totalCost + expectedNetProfit,
      fairMarketRange: {
        floorValue: maximumBuyPrice,
        expectedValue: totalCost + expectedNetProfit,
        ceilingValue: totalCost + expectedNetProfit + 20
      },
      valuationConfidence: 78,
      evidenceSummary: { exactMatchCount }
    },
    marketIntelligence: {
      supplyPressure: { supplyPressureLevel: 'low' },
      marketRegime: { primaryRegime: 'stable' },
      liquidity: { liquidityLevel: 'high' }
    },
    confidenceBreakdown: {
      soldEvidenceSupport: { rawValue: exactMatchCount },
      valuationConfidence: { rawValue: 78 }
    },
    financialContext: {
      totalCost,
      maximumBuyPrice,
      suggestedOffer: Math.round(maximumBuyPrice * 0.9),
      expectedNetProfit,
      roi,
      liquidity: 'high',
      expectedHoldDays: 30,
      exitConfidence: 'high'
    },
    portfolioContext: {
      availableCapital: 5000,
      maximumCapitalAllocationPerPosition: 1000,
      currentConcentrationPercentage: 0
    },
    strategyProfile: {
      preferredStrategyLanes: [strategyContract.STRATEGY_LANES.QUICK_FLIP]
    },
    competingOpportunities: []
  };
}

function buildCompleteSnapshot(overrides = {}) {
  const input = buildInvestmentInput(overrides);
  const investmentDecision = investmentDecisionEngine.evaluateInvestmentDecision(input);
  const capitalScoreExplanation = capitalScoreExplanationEngine.explainCapitalScore({
    ...input,
    investmentDecision
  });
  const validationCandidate = selector.evaluateValidationCandidate({
    recordId: input.listingSnapshot.itemId,
    investmentDecisionInput: input,
    investmentDecision
  });

  return {
    recordId: input.listingSnapshot.itemId,
    capturedAt: '2026-07-14T15:00:00.000Z',
    investmentDecisionInput: input,
    investmentDecision,
    capitalScoreExplanation,
    validationCandidate,
    productionOutputs: {
      dealGate: input.dealGate,
      productionValuation: input.productionValuation,
      productionDecisionExplanation: input.productionDecisionExplanation
    },
    shadowOutputs: {
      canonicalIdentity: input.canonicalIdentity,
      shadowValuation: input.shadowValuation,
      shadowSoldComparison: input.shadowSoldComparison
    },
    daltonReview: {
      reviewer: 'Dalton',
      decision: 'UNREVIEWED',
      notes: ''
    },
    actualOutcome: {
      status: 'pending'
    }
  };
}

test('exports Review Workspace public API and component contract', () => {
  assert.equal(reviewWorkspace.SOURCE, 'review_workspace_contract');
  assert.equal(typeof reviewWorkspace.createReviewWorkspace, 'function');
  assert.equal(typeof reviewWorkspace.validateReviewWorkspace, 'function');
  assert.equal(typeof reviewWorkspace.buildReviewWorkspaceBatch, 'function');

  for (const component of [
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
  ]) {
    assert.ok(reviewWorkspace.REQUIRED_COMPONENTS.includes(component), `${component} missing`);
  }
});

test('aggregates complete listing review artifacts without creating new intelligence', () => {
  const snapshot = buildCompleteSnapshot();
  const workspace = reviewWorkspace.createReviewWorkspace(snapshot, {
    generatedAt: '2026-07-14T15:05:00.000Z'
  });

  assert.equal(workspace.schemaVersion, reviewWorkspace.SCHEMA_VERSION);
  assert.equal(workspace.source, reviewWorkspace.SOURCE);
  assert.equal(workspace.listingId, 'review-workspace-fixture');
  assert.deepEqual(workspace.listingSnapshot, snapshot.investmentDecisionInput.listingSnapshot);
  assert.deepEqual(workspace.productionOutputs.dealGate, snapshot.investmentDecisionInput.dealGate);
  assert.deepEqual(workspace.shadowOutputs.shadowValuation, snapshot.investmentDecisionInput.shadowValuation);
  assert.deepEqual(workspace.investmentDecision, snapshot.investmentDecision);
  assert.deepEqual(workspace.validationCandidate, snapshot.validationCandidate);
  assert.deepEqual(workspace.capitalScoreExplanation, snapshot.capitalScoreExplanation);
  assert.equal(workspace.strategyLane.selectedContextLane, snapshot.investmentDecision.strategyFit.selectedContextLane);
  assert.equal(workspace.auditMetadata.aggregationOnly, true);
  assert.equal(workspace.auditMetadata.createsNewIntelligence, false);
  assert.equal(workspace.productionImpact, 'none');
  assert.equal(workspace.decisionImpact, 'none');
  assert.equal(reviewWorkspace.validateReviewWorkspace(workspace).valid, true);
});

test('handles missing components with explicit availability and placeholders', () => {
  const workspace = reviewWorkspace.createReviewWorkspace({
    recordId: 'missing-components',
    listingSnapshot: {
      itemId: 'missing-components',
      title: 'Incomplete review fixture'
    }
  }, {
    generatedAt: '2026-07-14T15:10:00.000Z'
  });

  assert.equal(workspace.listingId, 'missing-components');
  assert.equal(workspace.investmentDecision, null);
  assert.equal(workspace.validationCandidate, null);
  assert.equal(workspace.daltonReview.reviewStatus, 'not_reviewed');
  assert.equal(workspace.actualOutcome.outcomeStatus, 'pending');
  assert.equal(workspace.auditMetadata.componentAvailability.investmentDecision, false);
  assert.equal(workspace.auditMetadata.componentAvailability.validationCandidate, false);
  assert.ok(workspace.auditMetadata.missingComponents.includes('investmentDecision'));
  assert.ok(workspace.auditMetadata.missingComponents.includes('validationCandidate'));
  assert.equal(reviewWorkspace.validateReviewWorkspace(workspace).valid, true);
});

test('review workspace output is deterministic for identical snapshots and options', () => {
  const snapshot = buildCompleteSnapshot();
  const first = reviewWorkspace.createReviewWorkspace(snapshot, {
    generatedAt: '2026-07-14T15:05:00.000Z'
  });
  const second = reviewWorkspace.createReviewWorkspace(snapshot, {
    generatedAt: '2026-07-14T15:05:00.000Z'
  });

  assert.deepEqual(second, first);
  assert.equal(first.workspaceHash, reviewWorkspace.fingerprint(
    Object.fromEntries(Object.entries(first).filter(([key]) => key !== 'workspaceHash'))
  ));
});

test('workspace validation detects tampering through workspaceHash', () => {
  const workspace = reviewWorkspace.createReviewWorkspace(buildCompleteSnapshot(), {
    generatedAt: '2026-07-14T15:05:00.000Z'
  });
  const tampered = structuredClone(workspace);

  tampered.productionOutputs.productionValuation.estimatedValue = 5;
  const validation = reviewWorkspace.validateReviewWorkspace(tampered);

  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => /workspaceHash/.test(error)));
});

test('buildReviewWorkspaceBatch aggregates multiple workspaces deterministically', () => {
  const snapshots = [
    buildCompleteSnapshot({ itemId: 'workspace-a' }),
    buildCompleteSnapshot({ itemId: 'workspace-b', totalCost: 120, maximumBuyPrice: 100 })
  ];
  const first = reviewWorkspace.buildReviewWorkspaceBatch(snapshots, {
    batchId: 'workspace-batch',
    generatedAt: '2026-07-14T15:20:00.000Z'
  });
  const second = reviewWorkspace.buildReviewWorkspaceBatch(snapshots, {
    batchId: 'workspace-batch',
    generatedAt: '2026-07-14T15:20:00.000Z'
  });

  assert.deepEqual(second, first);
  assert.equal(first.workspaces.length, 2);
  assert.equal(first.productionImpact, 'none');
  assert.equal(first.workspaces[0].listingId, 'workspace-a');
  assert.equal(first.workspaces[1].listingId, 'workspace-b');
});

test('review workspace does not mutate snapshots or recompute supplied artifacts', () => {
  const snapshot = buildCompleteSnapshot();
  const before = structuredClone(snapshot);
  const workspace = reviewWorkspace.createReviewWorkspace(snapshot, {
    generatedAt: '2026-07-14T15:05:00.000Z'
  });

  assert.deepEqual(snapshot, before);
  assert.deepEqual(workspace.investmentDecision, before.investmentDecision);
  assert.deepEqual(workspace.validationCandidate, before.validationCandidate);
  assert.equal(workspace.productionImpact, 'none');
});
