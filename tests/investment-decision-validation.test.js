'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const investmentDecisionEngine = require('../engines/investmentDecisionEngine');
const investmentValidation = require('../validation/investmentDecisionValidation');
const strategyContract = require('../validation/strategyLaneContract');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'investment-decision', 'phase-7-1c-validation-fixtures.json');
const fixtureLibrary = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));

function exactMatches(count) {
  return Array.from({ length: count }, (_, index) => ({
    classification: 'exact_match',
    valuationEligible: true,
    recordId: `validation-exact-${index + 1}`,
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
  const recentSoldCount = overrides.recentSoldCount ?? exactMatchCount;
  const totalCost = overrides.totalCost ?? 70;
  const maximumBuyPrice = overrides.maximumBuyPrice ?? 100;
  const expectedNetProfit = overrides.expectedNetProfit ?? 25;
  const roi = overrides.roi ?? 0.35;
  const shadowInsufficient = overrides.shadowInsufficientEvidence === true;
  const matches = exactMatches(exactMatchCount);

  return {
    listingSnapshot: {
      itemId: overrides.itemId || 'investment-validation-fixture',
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
      recentSoldCount,
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
      supplyPressure: { supplyPressureLevel: overrides.supplyPressure || 'low' },
      marketRegime: { primaryRegime: overrides.marketRegime || 'stable' },
      liquidity: { liquidityLevel: overrides.liquidity || 'high' }
    },
    confidenceBreakdown: {
      soldEvidenceSupport: { rawValue: exactMatchCount },
      valuationConfidence: { rawValue: 78 }
    },
    financialContext: {
      totalCost,
      maximumBuyPrice,
      suggestedOffer: overrides.suggestedOffer ?? Math.round(maximumBuyPrice * 0.9),
      expectedNetProfit,
      roi,
      liquidity: overrides.liquidity || 'high',
      expectedHoldDays: overrides.expectedHoldDays === undefined ? 30 : overrides.expectedHoldDays,
      exitConfidence: overrides.exitConfidence || 'high',
      investmentThesis: overrides.investmentThesis || ''
    },
    portfolioContext: {
      availableCapital: overrides.availableCapital ?? 5000,
      maximumCapitalAllocationPerPosition: overrides.maximumCapitalAllocationPerPosition ?? 1000,
      currentConcentrationPercentage: overrides.currentConcentrationPercentage ?? 0
    },
    strategyProfile: {
      preferredStrategyLanes: overrides.preferredStrategyLanes || [strategyContract.STRATEGY_LANES.QUICK_FLIP]
    },
    competingOpportunities: overrides.competingOpportunities || []
  };
}

function buildSnapshotFromFixture(fixture) {
  const input = buildInvestmentInput({
    ...(fixture.overrides || {}),
    itemId: fixture.id
  });

  return {
    recordId: fixture.id,
    capturedAt: '2026-07-14T12:00:00.000Z',
    investmentDecisionInput: input,
    productionOutputs: {
      dealGate: input.dealGate,
      productionValuation: input.productionValuation
    },
    shadowOutputs: {
      shadowSoldComparison: input.shadowSoldComparison,
      shadowValuation: input.shadowValuation
    },
    daltonReview: {
      decision: fixture.daltonDecision,
      confidence: 85,
      disagreementCategories: fixture.disagreementCategories || [],
      notes: fixture.description
    },
    actualOutcome: {
      status: fixture.actualOutcomeStatus || 'pending',
      netProfit: fixture.actualNetProfit ?? null
    }
  };
}

function buildFixtureRecords() {
  const batch = investmentValidation.buildInvestmentValidationBatch(
    fixtureLibrary.fixtures.map(buildSnapshotFromFixture),
    {
      batchId: 'phase-7-1c-test-batch',
      createdAt: '2026-07-14T12:30:00.000Z',
      capturedAt: '2026-07-14T12:00:00.000Z'
    }
  );
  return batch.records;
}

test('exports Investment Decision validation public API and constants', () => {
  assert.equal(investmentValidation.SOURCE, 'investment_decision_validation_harness');
  assert.equal(typeof investmentValidation.createInvestmentValidationRecord, 'function');
  assert.equal(typeof investmentValidation.buildInvestmentValidationBatch, 'function');
  assert.equal(typeof investmentValidation.buildAggregateInvestmentMetrics, 'function');
  assert.equal(typeof investmentValidation.runInvestmentDecisionValidation, 'function');
  assert.ok(investmentValidation.REVIEW_DECISIONS.includes('PRIORITY_BUY'));
  assert.ok(investmentValidation.OUTCOME_CATEGORIES.includes('missed_opportunity'));
});

test('fixture library covers agreement, false positive, missed opportunity, negotiation, and pending review', () => {
  const ids = fixtureLibrary.fixtures.map((fixture) => fixture.id);

  for (const id of [
    'dalton-agrees-buy',
    'false-positive-buy',
    'missed-opportunity-monitor',
    'negotiate-agreement',
    'unreviewed-pending'
  ]) {
    assert.ok(ids.includes(id), `${id} fixture missing`);
  }
});

test('creates per-listing validation records while preserving production and shadow outputs', () => {
  const snapshot = buildSnapshotFromFixture(fixtureLibrary.fixtures[0]);
  const originalInput = structuredClone(snapshot.investmentDecisionInput);
  const record = investmentValidation.createInvestmentValidationRecord(snapshot, {
    capturedAt: '2026-07-14T12:00:00.000Z'
  });

  assert.equal(record.schemaVersion, investmentValidation.SCHEMA_VERSION);
  assert.equal(record.source, investmentValidation.SOURCE);
  assert.equal(record.listingId, 'dalton-agrees-buy');
  assert.deepEqual(record.inputSnapshot, originalInput);
  assert.deepEqual(record.productionSnapshot.dealGate, originalInput.dealGate);
  assert.deepEqual(record.shadowSnapshot.shadowValuation, originalInput.shadowValuation);
  assert.equal(record.investmentDecision.productionImpact, 'none');
  assert.equal(record.investmentDecision.investmentPosture, investmentDecisionEngine.evaluateInvestmentDecision(originalInput).investmentPosture);
  assert.equal(record.snapshotHash, investmentValidation.fingerprint(record.immutableSnapshot));
  assert.equal(investmentValidation.validateInvestmentValidationRecord(record).valid, true);
});

test('validation records detect immutable snapshot tampering', () => {
  const record = investmentValidation.createInvestmentValidationRecord(buildSnapshotFromFixture(fixtureLibrary.fixtures[0]), {
    capturedAt: '2026-07-14T12:00:00.000Z'
  });
  const tampered = structuredClone(record);

  tampered.immutableSnapshot.investmentDecision.investmentPosture = 'IGNORE';
  const validation = investmentValidation.validateInvestmentValidationRecord(tampered);

  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => /snapshotHash/.test(error)));
});

test('derives agreement, false positives, missed opportunities, and pending outcomes', () => {
  const records = buildFixtureRecords();
  const expected = new Map(fixtureLibrary.fixtures.map((fixture) => [fixture.id, fixture.expectedOutcome]));

  for (const record of records) {
    assert.equal(record.validation.outcomeCategory, expected.get(record.recordId), `${record.recordId} outcome mismatch`);
  }
});

test('builds aggregate investment metrics with posture, lane, evidence, and reasoning summaries', () => {
  const records = buildFixtureRecords();
  const batch = investmentValidation.buildInvestmentValidationBatch([], {
    batchId: 'already-built-records'
  });
  batch.records = records;

  const report = investmentValidation.buildAggregateInvestmentMetrics(batch, {
    generatedAt: '2026-07-14T13:00:00.000Z'
  });

  assert.equal(report.totalListings, 5);
  assert.equal(report.reviewedListings, 4);
  assert.equal(report.agreementCount, 2);
  assert.equal(report.agreementRate, 50);
  assert.equal(report.falsePositiveCount, 1);
  assert.equal(report.falsePositiveRate, 25);
  assert.equal(report.missedOpportunityCount, 1);
  assert.equal(report.missedOpportunityRate, 25);
  assert.equal(report.outcomeCounts.agreement, 2);
  assert.equal(report.outcomeCounts.false_positive, 1);
  assert.equal(report.outcomeCounts.missed_opportunity, 1);
  assert.equal(report.outcomeCounts.outcome_pending, 1);
  assert.ok(report.postureAgreementSummary.BUY.total >= 1);
  assert.ok(report.strategyLaneSummary.QUICK_FLIP.total >= 1);
  assert.ok(report.evidenceQualitySummary.sufficient_exact_sold_support.total >= 1);
  assert.ok(report.evidenceQualitySummary.insufficient_shadow_valuation.total >= 1);
  assert.ok(report.recurringDisagreementCategories.false_positive >= 1);
  assert.ok(report.recommendationImprovementCandidates.improve_exact_sold_evidence_coverage >= 1);
  assert.equal(report.validationIntegrity.invalidRecordCount, 0);
});

test('runInvestmentDecisionValidation reads batch files and writes offline report only', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cardhawk-investment-validation-'));
  const inputPath = path.join(tempDir, 'batch.json');
  const outputPath = path.join(tempDir, 'report.json');
  const snapshots = fixtureLibrary.fixtures.map(buildSnapshotFromFixture);

  fs.writeFileSync(inputPath, `${JSON.stringify({ snapshots }, null, 2)}\n`);
  const before = fs.readFileSync(inputPath, 'utf8');
  const report = investmentValidation.runInvestmentDecisionValidation([inputPath], outputPath, {
    generatedAt: '2026-07-14T14:00:00.000Z'
  });
  const written = JSON.parse(fs.readFileSync(outputPath, 'utf8'));

  assert.equal(fs.readFileSync(inputPath, 'utf8'), before);
  assert.equal(report.aggregateMetrics.totalListings, 5);
  assert.equal(written.aggregateMetrics.totalListings, 5);
  assert.deepEqual(written.aggregateMetrics.outcomeCounts, report.aggregateMetrics.outcomeCounts);
});

test('harness does not mutate input snapshots or alter Investment Decision output', () => {
  const snapshot = buildSnapshotFromFixture(fixtureLibrary.fixtures[0]);
  const before = structuredClone(snapshot);
  const expectedDecision = investmentDecisionEngine.evaluateInvestmentDecision(snapshot.investmentDecisionInput);
  const record = investmentValidation.createInvestmentValidationRecord(snapshot, {
    capturedAt: '2026-07-14T12:00:00.000Z'
  });

  assert.deepEqual(snapshot, before);
  assert.deepEqual(record.investmentDecision, expectedDecision);
  assert.equal(record.investmentDecision.productionImpact, 'none');
});
