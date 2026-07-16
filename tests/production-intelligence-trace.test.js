'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  PRODUCTION_INTELLIGENCE_TRACE_SCHEMA_VERSION,
  PRODUCTION_INTELLIGENCE_TRACE_SOURCE,
  UNKNOWN_VALUE,
  buildProductionIntelligenceTraceFingerprint,
  cloneProductionIntelligenceTrace,
  createProductionIntelligenceTrace
} = require('../validation/productionIntelligenceTrace');

function productionDecisionInput(overrides = {}) {
  return {
    traceId: 'trace-ebay-1001',
    createdAt: '2026-07-16T10:00:00.000Z',
    scanMetadata: {
      id: 'scan-42',
      source: 'manual',
      lane: 'basketball',
      query: '2020 prizm anthony edwards psa 10',
      startedAt: '2026-07-16T09:59:00.000Z',
      finishedAt: '2026-07-16T10:00:00.000Z',
      status: 'completed',
      listingsFound: 12,
      newAlerts: 1
    },
    listing: {
      ebayItemId: '1001',
      title: '2020 Panini Prizm Anthony Edwards Rookie PSA 10 Silver #258',
      parsed: {
        player: 'Anthony Edwards',
        year: '2020',
        brand: 'Panini',
        setName: 'Prizm',
        cardNumber: '258',
        qualityTier: 'premium',
        gradeCompany: 'PSA',
        grade: 10,
        flags: {
          rookie: true,
          autograph: false,
          graded: true,
          numbered: false,
          lot: false
        }
      }
    },
    canonicalIdentity: {
      identityKey: 'ci:v1:sports:basketball:2020:panini:prizm:anthony-edwards:258:silver:non-auto:non-mem:unnumbered:graded:psa-10',
      canonicalCardKey: 'anthony-edwards-2020-prizm-258-silver-psa-10',
      identityType: 'sports_card',
      normalized: {
        category: 'sports_card',
        subject: { name: 'anthony edwards' },
        rawOrGraded: 'graded'
      },
      metadata: {
        unknownFields: [],
        normalizationWarnings: []
      }
    },
    evidenceSummary: {
      source: 'sold_market',
      compCount: 8,
      trueSoldCount: 5,
      activeCount: 3,
      activeOnlyFlag: false,
      fallbackOnlyFlag: false
    },
    evidenceSufficiency: {
      sufficiencyLevel: 'strong',
      evidenceSufficiencyScore: 88,
      blockingConcerns: [],
      warnings: []
    },
    comparableQuality: {
      averageComparableQualityScore: 84
    },
    marketData: {
      marketValue: 220,
      source: 'sold_market',
      confidence: 82
    },
    valuationRange: {
      expectedValueLow: 205,
      expectedValue: 220,
      expectedValueHigh: 245,
      rangeQuality: 'usable'
    },
    confidenceData: {
      confidence: 81,
      source: 'sold_market',
      cap: 100,
      avgSimilarity: 87,
      compCount: 8,
      reasons: ['sold-supported confidence >= 80']
    },
    dealGrade: {
      grade: 'A',
      action: 'STRONG_REVIEW',
      score: 89,
      reasons: ['strong market confidence'],
      concerns: []
    },
    riskData: {
      riskLevel: 'low',
      riskScore: 12,
      reasons: ['low listing risk']
    },
    marketIntelligenceData: {
      intelligenceScore: 86,
      confidenceScore: 80,
      recommendation: 'review'
    },
    decisionIntelligence: {
      overallReadiness: 'ready',
      recommendationImpact: 'supporting_context',
      blockers: [],
      cautionSignals: [],
      supportingSignals: [{ source: 'evidence_sufficiency', message: 'Evidence is strong.' }],
      conflicts: []
    },
    dealGateInputs: {
      score: 82,
      confidenceScore: 81,
      soldCompCount: 5,
      riskLevel: 'low'
    },
    dealGateOutcome: {
      passed: true,
      decision: 'BUY_NOW',
      recommendation: 'BUY_NOW',
      reasons: [],
      positives: ['Listing score is strong (82/100).'],
      breakdown: {
        buyNowAllowed: true
      }
    },
    ...overrides
  };
}

test('production intelligence trace captures production decision context without authority drift', () => {
  const trace = createProductionIntelligenceTrace(productionDecisionInput());

  assert.equal(trace.source, PRODUCTION_INTELLIGENCE_TRACE_SOURCE);
  assert.equal(trace.schemaVersion, PRODUCTION_INTELLIGENCE_TRACE_SCHEMA_VERSION);
  assert.equal(trace.immutable, true);
  assert.equal(trace.productionBehavior.readOnly, true);
  assert.equal(trace.productionBehavior.changesDealGateDecision, false);
  assert.equal(trace.productionBehavior.changesProductionScoring, false);
  assert.equal(trace.productionBehavior.changesBuyNowBehavior, false);
  assert.equal(trace.productionBehavior.changesNotifications, false);
  assert.equal(trace.productionBehavior.authorityFlags.productionApproval, false);
  assert.equal(trace.scanMetadata.scanId, 'scan-42');
  assert.equal(trace.parserOutputSummary.player, 'Anthony Edwards');
  assert.equal(trace.canonicalIdentitySummary.identityKey.startsWith('ci:v1:sports'), true);
  assert.equal(trace.evidenceSummary.trueSoldCount, 5);
  assert.equal(trace.valuationSummary.marketValue, 220);
  assert.equal(trace.confidenceSummary.confidence, 81);
  assert.equal(trace.gradingSummary.grade, 'A');
  assert.equal(trace.riskSummary.riskLevel, 'low');
  assert.equal(trace.intelligenceEngineSummaries.marketIntelligence.intelligenceScore, 86);
  assert.equal(trace.dealGateInputs.score, 82);
  assert.equal(trace.dealGateOutcome.decision, 'BUY_NOW');
  assert.equal(trace.buyNowEligibility.eligible, true);
  assert.equal(trace.buyNowEligibility.authority, 'deal_gate');
  assert.equal(trace.stableFingerprint, buildProductionIntelligenceTraceFingerprint(trace));
});

test('production intelligence trace is deterministic and immutable', () => {
  const input = productionDecisionInput();
  const first = createProductionIntelligenceTrace(input);
  const second = createProductionIntelligenceTrace(productionDecisionInput());

  assert.equal(first.stableFingerprint, second.stableFingerprint);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.scanMetadata), true);
  assert.throws(() => {
    first.scanMetadata.status = 'mutated';
  }, TypeError);

  const copy = cloneProductionIntelligenceTrace(first);
  copy.scanMetadata.status = 'mutated';
  assert.equal(first.scanMetadata.status, 'completed');
});

test('production intelligence trace preserves unknowns instead of inventing missing values', () => {
  const trace = createProductionIntelligenceTrace({});

  assert.equal(trace.traceId, UNKNOWN_VALUE);
  assert.equal(trace.scanMetadata.scanId, UNKNOWN_VALUE);
  assert.equal(trace.parserOutputSummary.player, UNKNOWN_VALUE);
  assert.equal(trace.canonicalIdentitySummary.identityKey, UNKNOWN_VALUE);
  assert.equal(trace.evidenceSummary.trueSoldCount, UNKNOWN_VALUE);
  assert.equal(trace.valuationSummary.marketValue, UNKNOWN_VALUE);
  assert.equal(trace.confidenceSummary.confidence, UNKNOWN_VALUE);
  assert.equal(trace.gradingSummary.grade, UNKNOWN_VALUE);
  assert.equal(trace.riskSummary.riskLevel, UNKNOWN_VALUE);
  assert.equal(trace.dealGateOutcome.available, false);
  assert.equal(trace.dealGateOutcome.passed, UNKNOWN_VALUE);
  assert.equal(trace.buyNowEligibility.eligible, UNKNOWN_VALUE);
  assert.equal(trace.stableFingerprint, buildProductionIntelligenceTraceFingerprint(trace));
});

test('production intelligence trace does not convert non-Deal Gate buy-like signals into BUY_NOW eligibility', () => {
  const trace = createProductionIntelligenceTrace(productionDecisionInput({
    dealGrade: {
      grade: 'A+',
      action: 'BUY_NOW',
      score: 98
    },
    marketIntelligenceData: {
      intelligenceScore: 91,
      confidenceScore: 90,
      recommendation: 'BUY_NOW'
    },
    dealGateOutcome: {
      passed: false,
      decision: 'REJECT',
      recommendation: 'REJECT',
      reasons: ['Fewer than 3 sold comps for final approval.']
    }
  }));

  assert.equal(trace.gradingSummary.action, 'BUY_NOW');
  assert.equal(trace.intelligenceEngineSummaries.marketIntelligence.recommendation, 'BUY_NOW');
  assert.equal(trace.dealGateOutcome.decision, 'REJECT');
  assert.equal(trace.buyNowEligibility.eligible, false);
});

test('production intelligence trace fingerprint changes only when trace projection changes', () => {
  const first = createProductionIntelligenceTrace(productionDecisionInput());
  const changed = createProductionIntelligenceTrace(productionDecisionInput({
    evidenceSummary: {
      source: 'sold_market',
      compCount: 4,
      trueSoldCount: 3,
      activeCount: 1,
      activeOnlyFlag: false,
      fallbackOnlyFlag: false
    }
  }));

  assert.notEqual(first.stableFingerprint, changed.stableFingerprint);
});
