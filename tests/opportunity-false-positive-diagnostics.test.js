'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  FALSE_POSITIVE_RISK_LEVEL,
  FALSE_POSITIVE_RISK_STATUS,
  buildOpportunityFalsePositiveFingerprint,
  evaluateOpportunityFalsePositiveRisk,
  summarizeOpportunityFalsePositiveRisk
} = require('../validation/opportunityFalsePositiveDiagnostics');
const {
  createProductionIntelligenceTrace
} = require('../validation/productionIntelligenceTrace');

function healthyInput(overrides = {}) {
  return {
    identityDiagnosticResult: {
      diagnosticStatus: 'exact',
      ambiguityLevel: 'none',
      blockingIssues: []
    },
    evidenceReadinessDiagnosticResult: {
      readinessStatus: 'ready',
      readinessLevel: 'adequate',
      blockingReasons: [],
      valuationReadiness: {
        shouldWithholdValuationDiagnostically: false
      }
    },
    rangeFirstValuationDiagnosticResult: {
      valuationDiagnosticStatus: 'supported',
      uncertaintyLevel: 'low',
      pointEstimateAssessment: {
        pointInsideSupportedRange: true
      },
      blockingReasons: []
    },
    confidenceCalibrationDiagnosticResult: {
      calibrationStatus: 'calibrated',
      confidenceSupportLevel: 'strong',
      blockingReasons: []
    },
    listingQualityGradingDiagnosticResult: {
      listingQualityStatus: 'strong',
      gradingDiagnosticStatus: 'confirmed',
      blockingIssues: []
    },
    roiData: {
      source: 'roi_engine',
      expectedSalePrice: 150,
      listingCost: 100,
      netProfit: 25,
      roi: 0.25,
      roiPercent: 25,
      riskAdjustedProfit: 18,
      marginOfSafetyPercent: 18,
      roiTier: 'good',
      recommendation: 'buy',
      confidence: 86
    },
    riskSummary: {
      riskLevel: 'low',
      riskScore: 18,
      warnings: []
    },
    dealGateOutcome: {
      passed: true,
      buyNowAllowed: true,
      decision: 'BUY_NOW',
      recommendation: 'BUY_NOW',
      reasons: [],
      positives: ['strong support']
    },
    listing: {
      totalCost: 100
    },
    marketData: {
      marketValue: 150
    },
    ...overrides
  };
}

test('false-positive diagnostics classify fully supported opportunities as low risk', () => {
  const result = evaluateOpportunityFalsePositiveRisk(healthyInput());

  assert.equal(result.falsePositiveRiskStatus, FALSE_POSITIVE_RISK_STATUS.LOW_RISK);
  assert.equal(result.falsePositiveRiskLevel, FALSE_POSITIVE_RISK_LEVEL.LOW);
  assert.equal(result.dealGateOutcome.decision, 'BUY_NOW');
  assert.equal(result.buyNowEligibility.eligible, true);
  assert.deepEqual(result.criticalBlockers, []);
  assert.deepEqual(result.materialWarnings, []);
  assert.equal(result.supportingFactors.includes('evidence_ready'), true);
  assert.equal(result.supportingFactors.includes('valuation_supported'), true);
  assert.equal(result.recommendedReviewAction, 'none');
  assert.equal(result.stableFingerprint, buildOpportunityFalsePositiveFingerprint(result));
  assert.match(summarizeOpportunityFalsePositiveRisk(result), /low_risk/);
});

test('positive Deal Gate and BUY_NOW do not suppress contradictory diagnostic blockers', () => {
  const result = evaluateOpportunityFalsePositiveRisk(healthyInput({
    evidenceReadinessDiagnosticResult: {
      readinessStatus: 'blocked',
      readinessLevel: 'blocked',
      blockingReasons: [
        'active_only_evidence_cannot_satisfy_true_sold_minimum',
        'fallback_evidence_cannot_satisfy_true_sold_minimum'
      ],
      valuationReadiness: {
        shouldWithholdValuationDiagnostically: true
      }
    },
    rangeFirstValuationDiagnosticResult: {
      valuationDiagnosticStatus: 'withheld',
      uncertaintyLevel: 'extreme',
      pointEstimateAssessment: {
        pointInsideSupportedRange: false
      },
      blockingReasons: ['point_estimate_outside_supported_range']
    },
    confidenceCalibrationDiagnosticResult: {
      calibrationStatus: 'overconfident',
      confidenceSupportLevel: 'unsupported',
      blockingReasons: ['confidence_not_supported_by_true_sold_evidence']
    },
    listingQualityGradingDiagnosticResult: {
      listingQualityStatus: 'blocked',
      gradingDiagnosticStatus: 'high_risk',
      blockingIssues: ['reprint_custom_proxy_replica_language_present']
    },
    roiData: {
      roiTier: 'excellent',
      roiPercent: 260,
      riskAdjustedProfit: 80,
      marginOfSafetyPercent: 60
    },
    listing: {
      totalCost: 10
    },
    marketData: {
      marketValue: 200
    }
  }));

  assert.equal(result.falsePositiveRiskStatus, FALSE_POSITIVE_RISK_STATUS.LIKELY_FALSE_POSITIVE);
  assert.equal(result.falsePositiveRiskLevel, FALSE_POSITIVE_RISK_LEVEL.CRITICAL);
  assert.equal(result.dealGateOutcome.decision, 'BUY_NOW');
  assert.equal(result.buyNowEligibility.eligible, true);
  assert.equal(result.criticalBlockers.includes('active_only_evidence_cannot_satisfy_true_sold_minimum'), true);
  assert.equal(result.criticalBlockers.includes('reprint_custom_proxy_replica_language_present'), true);
  assert.equal(result.suspiciousPriceIndicators.includes('acquisition_price_below_20_percent_of_estimate'), true);
  assert.equal(result.conflictingSignals.includes('positive_deal_gate_or_buy_now_with_critical_diagnostic_blockers'), true);
  assert.equal(result.recommendedReviewAction, 'resolve_critical_blockers_before_reliance');
});

test('missing diagnostic inputs remain missing and reduce certainty', () => {
  const result = evaluateOpportunityFalsePositiveRisk({
    dealGateOutcome: {
      passed: true,
      decision: 'BUY_NOW'
    }
  });

  assert.equal(result.falsePositiveRiskStatus, FALSE_POSITIVE_RISK_STATUS.REVIEW);
  assert.equal(result.falsePositiveRiskLevel, FALSE_POSITIVE_RISK_LEVEL.MODERATE);
  assert.equal(result.missingDiagnostics.length, 5);
  assert.equal(result.materialWarnings.includes('missing_identity_diagnostics'), true);
  assert.equal(result.recommendedReviewAction, 'review_conflicting_signals_before_reliance');
});

test('empty input is unavailable without invented Deal Gate or diagnostics', () => {
  const result = evaluateOpportunityFalsePositiveRisk({});

  assert.equal(result.falsePositiveRiskStatus, FALSE_POSITIVE_RISK_STATUS.UNAVAILABLE);
  assert.equal(result.falsePositiveRiskLevel, FALSE_POSITIVE_RISK_LEVEL.UNKNOWN);
  assert.equal(result.dealGateOutcome.available, false);
  assert.equal(result.buyNowEligibility.eligible, 'unknown');
  assert.equal(result.missingDiagnostics.length, 5);
});

test('false-positive diagnostics are deterministic and do not mutate inputs', () => {
  const input = healthyInput();
  const before = JSON.parse(JSON.stringify(input));
  const first = evaluateOpportunityFalsePositiveRisk(input);
  const second = evaluateOpportunityFalsePositiveRisk(input);

  assert.deepEqual(input, before);
  assert.deepEqual(second, first);
  assert.equal(first.stableFingerprint, second.stableFingerprint);
});

test('production intelligence trace records supplied false-positive diagnostics additively', () => {
  const diagnostic = evaluateOpportunityFalsePositiveRisk(healthyInput());
  const trace = createProductionIntelligenceTrace({
    traceId: 'trace-with-false-positive-diagnostic',
    opportunityFalsePositiveDiagnosticResult: diagnostic,
    dealGateOutcome: {
      passed: false,
      decision: 'REJECT',
      reasons: ['test rejection']
    }
  });

  assert.equal(trace.opportunityFalsePositiveDiagnosticSummary.available, true);
  assert.equal(trace.opportunityFalsePositiveDiagnosticSummary.falsePositiveRiskStatus, diagnostic.falsePositiveRiskStatus);
  assert.equal(trace.opportunityFalsePositiveDiagnosticSummary.falsePositiveRiskLevel, diagnostic.falsePositiveRiskLevel);
  assert.equal(trace.opportunityFalsePositiveDiagnosticSummary.stableFingerprint, diagnostic.stableFingerprint);
  assert.equal(trace.opportunityFalsePositiveDiagnosticSummary.changesProductionBehavior, false);
  assert.equal(trace.dealGateOutcome.decision, 'REJECT');
  assert.equal(trace.buyNowEligibility.eligible, false);
});
