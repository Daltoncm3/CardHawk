'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const investmentDecisionEngine = require('../engines/investmentDecisionEngine');
const capitalScoreExplanationEngine = require('../engines/capitalScoreExplanationEngine');
const exporter = require('../validation/exportReviewWorkspaceBatch');
const reviewWorkspaceContract = require('../validation/reviewWorkspaceContract');
const strategyContract = require('../validation/strategyLaneContract');

function exactMatches(count) {
  return Array.from({ length: count }, (_, index) => ({
    classification: 'exact_match',
    valuationEligible: true,
    recordId: `export-exact-${index + 1}`,
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
  const shadowInsufficient = overrides.shadowInsufficientEvidence === true;
  const matches = exactMatches(exactMatchCount);
  const productionValue = overrides.productionEstimatedValue ?? totalCost + expectedNetProfit;
  const shadowValue = overrides.shadowRecommendedMarketValue ?? totalCost + expectedNetProfit;
  const identityEligible = overrides.identityConflict === true ? false : true;

  return {
    listingSnapshot: {
      itemId: overrides.itemId || 'review-export-fixture',
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
      estimatedValue: productionValue,
      estimatedProfit: expectedNetProfit,
      roi
    },
    productionDecisionExplanation: {
      primaryExplanation: 'Fixture production explanation.'
    },
    canonicalIdentity: {
      canonicalIdentityKey: 'ci:v1:sports:football:2020:panini:prizm:joe-burrow:307:base:non-auto:non-mem:unnumbered:graded:psa-10',
      eligibility: {
        exactCompEligible: identityEligible,
        valuationEligible: identityEligible,
        manualReviewRequired: !identityEligible,
        contextOnly: !identityEligible
      },
      overallIdentityConfidence: identityEligible ? 96 : 52,
      unknownFields: identityEligible ? [] : ['parallel', 'variation', 'cardNumber'],
      normalizationWarnings: identityEligible ? [] : ['identity_requires_manual_review']
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
      insufficientIdentityMatches: identityEligible ? [] : [{ recordId: 'identity-conflict-record' }],
      processingSummary: { exactMatchCount }
    },
    shadowValuation: shadowInsufficient
      ? {
          insufficientEvidence: true,
          insufficientEvidenceReason: overrides.shadowInsufficientEvidenceReason || 'insufficient_exact_sold_evidence',
          recommendedMarketValue: null,
          fairMarketRange: null,
          evidenceSummary: { exactMatchCount }
        }
      : {
          insufficientEvidence: false,
          insufficientEvidenceReason: '',
          recommendedMarketValue: shadowValue,
          fairMarketRange: {
            floorValue: maximumBuyPrice,
            expectedValue: shadowValue,
            ceilingValue: shadowValue + 20
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

function buildSnapshot(overrides = {}) {
  const input = buildInvestmentInput(overrides);
  const investmentDecision = investmentDecisionEngine.evaluateInvestmentDecision(input);
  return {
    recordId: input.listingSnapshot.itemId,
    capturedAt: '2026-07-14T16:00:00.000Z',
    investmentDecisionInput: input,
    investmentDecision,
    productionOutputs: {
      dealGate: input.dealGate,
      productionValuation: input.productionValuation,
      productionDecisionExplanation: input.productionDecisionExplanation
    },
    shadowOutputs: {
      canonicalIdentity: input.canonicalIdentity,
      shadowSoldComparison: input.shadowSoldComparison,
      shadowValuation: input.shadowValuation
    }
  };
}

function buildManySnapshots(count) {
  return Array.from({ length: count }, (_, index) => {
    if (index === 0) {
      return buildSnapshot({
        itemId: 'top-missing-sold',
        exactMatchCount: 0,
        shadowInsufficientEvidence: true,
        shadowInsufficientEvidenceReason: 'no_exact_sold_matches'
      });
    }
    if (index === 1) {
      return buildSnapshot({
        itemId: 'valuation-conflict',
        productionEstimatedValue: 240,
        shadowRecommendedMarketValue: 100
      });
    }
    if (index === 2) {
      return buildSnapshot({
        itemId: 'identity-conflict',
        identityConflict: true
      });
    }
    return buildSnapshot({
      itemId: `baseline-${String(index).padStart(2, '0')}`,
      exactMatchCount: 5,
      totalCost: 70 + index,
      expectedNetProfit: 40
    });
  });
}

test('exports Review Workspace Batch public API and modes', () => {
  assert.equal(exporter.SOURCE, 'review_workspace_batch_exporter');
  assert.equal(typeof exporter.buildReviewWorkspaceBatchExport, 'function');
  assert.equal(typeof exporter.enrichListingForReviewWorkspace, 'function');
  assert.equal(typeof exporter.extractListings, 'function');
  assert.equal(exporter.EXPORT_MODES.ALL_LISTINGS, 'all_listings');
  assert.equal(exporter.EXPORT_MODES.LEARNING_PRIORITY, 'learning_priority');
});

test('all-listings export builds one workspace for every unique listing', () => {
  const listings = buildManySnapshots(3);
  const batch = exporter.buildReviewWorkspaceBatchExport({
    input: { listings },
    selectionMode: exporter.EXPORT_MODES.ALL_LISTINGS,
    batchId: 'all-listings',
    createdAt: '2026-07-14T16:30:00.000Z'
  });

  assert.equal(batch.selectionMode, 'all_listings');
  assert.equal(batch.availableListingCount, 3);
  assert.equal(batch.selectedListingCount, 3);
  assert.equal(batch.duplicateListingsRemoved, 0);
  assert.equal(batch.productionImpact, 'none');
  assert.equal(batch.reviewWorkspaces.length, 3);
  for (const workspace of batch.reviewWorkspaces) {
    assert.equal(reviewWorkspaceContract.validateReviewWorkspace(workspace).valid, true);
    assert.equal(workspace.capitalScoreExplanation.capitalScoreExplanation.score, null);
    assert.equal(workspace.capitalScoreExplanation.capitalScoreExplanation.capitalScoreStatus, 'not_scored');
  }
});

test('learning-priority export defaults to 25 and preserves a baseline obvious-agreement case', () => {
  const listings = buildManySnapshots(30);
  const batch = exporter.buildReviewWorkspaceBatchExport({
    input: { records: listings },
    selectionMode: exporter.EXPORT_MODES.LEARNING_PRIORITY,
    batchId: 'learning-priority',
    createdAt: '2026-07-14T16:35:00.000Z'
  });
  const selectedIds = batch.reviewWorkspaces.map((workspace) => workspace.listingId);

  assert.equal(batch.requestedCount, 25);
  assert.equal(batch.availableListingCount, 30);
  assert.equal(batch.selectedListingCount, 25);
  assert.equal(selectedIds[0], 'top-missing-sold');
  assert.ok(selectedIds.some((id) => /^baseline-/.test(id)), 'an obvious-agreement baseline should be preserved');
  assert.equal(batch.selectionSummary.baselineIncluded, true);
  assert.ok(batch.categoryBreakdown.production_vs_shadow_disagreement >= 1);
  assert.ok(batch.learningPriorityBreakdown.urgent >= 1);
});

test('learning-priority export handles fewer than 25 available listings', () => {
  const batch = exporter.buildReviewWorkspaceBatchExport({
    input: buildManySnapshots(4),
    selectionMode: exporter.EXPORT_MODES.LEARNING_PRIORITY,
    createdAt: '2026-07-14T16:40:00.000Z'
  });

  assert.equal(batch.requestedCount, 25);
  assert.equal(batch.availableListingCount, 4);
  assert.equal(batch.selectedListingCount, 4);
});

test('duplicate listing IDs are removed before workspace export', () => {
  const first = buildSnapshot({ itemId: 'duplicate-listing' });
  const duplicate = buildSnapshot({ itemId: 'duplicate-listing', totalCost: 90 });
  const unique = buildSnapshot({ itemId: 'unique-listing' });
  const batch = exporter.buildReviewWorkspaceBatchExport({
    input: { snapshots: [first, duplicate, unique] },
    selectionMode: exporter.EXPORT_MODES.ALL_LISTINGS,
    createdAt: '2026-07-14T16:45:00.000Z'
  });

  assert.equal(batch.availableListingCount, 3);
  assert.equal(batch.uniqueListingCount, 2);
  assert.equal(batch.duplicateListingsRemoved, 1);
  assert.deepEqual(batch.reviewWorkspaces.map((workspace) => workspace.listingId), ['duplicate-listing', 'unique-listing']);
});

test('malformed listings and missing shadow artifacts produce explicit diagnostics', () => {
  const malformed = { recordId: 'malformed-listing' };
  const missingShadow = {
    itemId: 'missing-shadow',
    title: '2023 Test Rookie Silver',
    price: 30,
    dealGate: { passed: false, buyNowAllowed: false, decision: 'REJECT', reasons: ['No evidence.'] },
    productionValuation: { estimatedValue: null, estimatedProfit: null, roi: null },
    parsed: { year: '2023', player: 'Test Rookie', cardNumber: '181' }
  };
  const batch = exporter.buildReviewWorkspaceBatchExport({
    input: [malformed, missingShadow],
    selectionMode: exporter.EXPORT_MODES.ALL_LISTINGS,
    createdAt: '2026-07-14T16:50:00.000Z'
  });

  assert.equal(batch.selectedListingCount, 2);
  const malformedWorkspace = batch.reviewWorkspaces.find((workspace) => workspace.listingId === 'malformed-listing');
  const missingShadowWorkspace = batch.reviewWorkspaces.find((workspace) => workspace.listingId === 'missing-shadow');

  assert.ok(malformedWorkspace.auditMetadata.missingComponents.includes('shadowValuation'));
  assert.ok(missingShadowWorkspace.auditMetadata.missingComponents.includes('shadowSoldComparison'));
  assert.ok(missingShadowWorkspace.auditMetadata.missingComponents.includes('shadowValuation'));
  assert.ok(missingShadowWorkspace.validationCandidate.candidateCategories.includes('edge_case'));
});

test('selection ordering and batch fingerprints are deterministic', () => {
  const input = { items: buildManySnapshots(8) };
  const first = exporter.buildReviewWorkspaceBatchExport({
    input,
    selectionMode: exporter.EXPORT_MODES.LEARNING_PRIORITY,
    requestedCount: 5,
    batchId: 'deterministic',
    createdAt: '2026-07-14T16:55:00.000Z'
  });
  const second = exporter.buildReviewWorkspaceBatchExport({
    input,
    selectionMode: exporter.EXPORT_MODES.LEARNING_PRIORITY,
    requestedCount: 5,
    batchId: 'deterministic',
    createdAt: '2026-07-14T16:55:00.000Z'
  });

  assert.deepEqual(second, first);
  assert.equal(first.batchFingerprint, reviewWorkspaceContract.fingerprint(
    Object.fromEntries(Object.entries(first).filter(([key]) => key !== 'batchFingerprint'))
  ));
});

test('exporter writes only when explicit offline output path is supplied', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cardhawk-review-export-'));
  const inputPath = path.join(tempDir, 'input.json');
  const outputPath = path.join(tempDir, 'review-batch.json');
  fs.writeFileSync(inputPath, `${JSON.stringify({ listings: buildManySnapshots(3) }, null, 2)}\n`);
  const before = fs.readFileSync(inputPath, 'utf8');

  const noWrite = exporter.buildReviewWorkspaceBatchExport({
    inputPath,
    selectionMode: exporter.EXPORT_MODES.LEARNING_PRIORITY,
    requestedCount: 2,
    createdAt: '2026-07-14T17:00:00.000Z'
  });
  assert.equal(fs.existsSync(outputPath), false);
  assert.equal(noWrite.selectedListingCount, 2);

  const written = exporter.buildReviewWorkspaceBatchExport({
    inputPath,
    outPath: outputPath,
    selectionMode: exporter.EXPORT_MODES.LEARNING_PRIORITY,
    requestedCount: 2,
    createdAt: '2026-07-14T17:00:00.000Z'
  });
  const output = JSON.parse(fs.readFileSync(outputPath, 'utf8'));

  assert.equal(fs.readFileSync(inputPath, 'utf8'), before);
  assert.equal(output.batchFingerprint, written.batchFingerprint);
});

test('exporter preserves raw production values and does not mutate input listings', () => {
  const listing = buildSnapshot({ itemId: 'production-isolation', productionEstimatedValue: 125 });
  const before = structuredClone(listing);
  const batch = exporter.buildReviewWorkspaceBatchExport({
    input: [listing],
    selectionMode: exporter.EXPORT_MODES.ALL_LISTINGS,
    createdAt: '2026-07-14T17:05:00.000Z'
  });
  const workspace = batch.reviewWorkspaces[0];

  assert.deepEqual(listing, before);
  assert.equal(workspace.productionOutputs.productionValuation.estimatedValue, 125);
  assert.deepEqual(workspace.investmentDecision, before.investmentDecision);
  assert.equal(workspace.productionImpact, 'none');
  assert.equal(workspace.capitalScoreExplanation.capitalScoreExplanation.score, null);
  assert.deepEqual(
    workspace.capitalScoreExplanation,
    capitalScoreExplanationEngine.explainCapitalScore({
      ...before.investmentDecisionInput,
      investmentDecision: before.investmentDecision
    })
  );
});
