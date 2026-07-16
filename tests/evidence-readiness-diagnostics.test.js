'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  READINESS_STATUS,
  REVIEW_ACTION,
  buildEvidenceReadinessFingerprint,
  evaluateEvidenceReadiness,
  summarizeEvidenceReadiness
} = require('../validation/evidenceReadinessDiagnostics');
const {
  createProductionIntelligenceTrace
} = require('../validation/productionIntelligenceTrace');

function soldRecord(id, overrides = {}) {
  return {
    id,
    evidenceType: 'true_sold',
    status: 'active_evidence',
    source: 'manual_verified',
    soldPrice: 100,
    soldAt: '2026-06-01T00:00:00.000Z',
    ageDays: 30,
    exactComparable: true,
    similarity: 95,
    qualityBand: 'excellent',
    ...overrides
  };
}

test('evidence readiness diagnostics classify strong true-sold exact evidence as ready', () => {
  const result = evaluateEvidenceReadiness({
    evidenceRecords: [
      soldRecord('sale-1'),
      soldRecord('sale-2', { soldPrice: 112, source: 'manual_verified_2' }),
      soldRecord('sale-3', { soldPrice: 108, source: 'manual_verified_3' })
    ],
    identityDiagnosticResult: {
      identityEligibility: {
        valuationEligible: true,
        exactCompEligible: true
      },
      diagnosticStatus: 'exact'
    }
  });

  assert.equal(result.readinessStatus, READINESS_STATUS.READY);
  assert.equal(result.readinessLevel, 'adequate');
  assert.equal(result.eligibleEvidenceSummary.trueSoldEvidenceCount, 3);
  assert.equal(result.excludedEvidenceSummary.activeListingCount, 0);
  assert.equal(result.valuationReadiness.diagnosticallyReady, true);
  assert.equal(result.confidenceCapRecommendation.recommendedCap, 100);
  assert.equal(result.recommendedReviewAction, REVIEW_ACTION.NONE);
  assert.equal(result.stableFingerprint, buildEvidenceReadinessFingerprint(result));
  assert.match(summarizeEvidenceReadiness(result), /ready/);
});

test('active and fallback evidence never satisfy true-sold minimums', () => {
  const result = evaluateEvidenceReadiness({
    evidenceRecords: [
      { id: 'active-1', evidenceType: 'active', source: 'active_market', price: 150, active: true, similarity: 95 },
      { id: 'fallback-1', evidenceType: 'fallback_unknown', source: 'heuristic_fallback', price: 140, similarity: 95 }
    ],
    identityDiagnosticResult: {
      identityEligibility: {
        valuationEligible: true,
        exactCompEligible: true
      }
    }
  });

  assert.equal(result.readinessStatus, READINESS_STATUS.BLOCKED);
  assert.equal(result.eligibleEvidenceSummary.trueSoldEvidenceCount, 0);
  assert.equal(result.excludedEvidenceSummary.activeListingCount, 1);
  assert.equal(result.excludedEvidenceSummary.fallbackEvidenceCount, 1);
  assert.equal(result.blockingReasons.includes('active_only_evidence_cannot_satisfy_true_sold_minimum'), true);
  assert.equal(result.blockingReasons.includes('fallback_evidence_cannot_satisfy_true_sold_minimum'), true);
  assert.equal(result.valuationReadiness.shouldWithholdValuationDiagnostically, true);
  assert.equal(result.confidenceCapRecommendation.recommendedCap, 18);
});

test('thin evidence remains below minimum readiness without inventing missing sales', () => {
  const result = evaluateEvidenceReadiness({
    evidenceRecords: [
      soldRecord('sale-1'),
      soldRecord('sale-2')
    ],
    identityDiagnosticResult: {
      identityEligibility: {
        valuationEligible: true,
        exactCompEligible: true
      }
    }
  });

  assert.equal(result.readinessStatus, READINESS_STATUS.THIN);
  assert.equal(result.readinessLevel, 'limited');
  assert.equal(result.eligibleEvidenceSummary.trueSoldEvidenceCount, 2);
  assert.equal(result.valuationReadiness.shouldWithholdValuationDiagnostically, true);
  assert.equal(result.confidenceCapRecommendation.recommendedCap, 44);
  assert.equal(result.recommendedReviewAction, REVIEW_ACTION.COLLECT_MORE_SOLD_EVIDENCE);
});

test('stale, contextual, rejected, duplicate, and ineligible evidence are excluded deterministically', () => {
  const result = evaluateEvidenceReadiness({
    evidenceRecords: [
      soldRecord('sale-1'),
      soldRecord('sale-2', { id: 'sale-1', marketplaceSaleId: 'dup-1' }),
      soldRecord('sale-3', { ageDays: 220 }),
      soldRecord('sale-4', { exactComparable: false, similarity: 60 }),
      soldRecord('sale-5', { rejectedByIdentityGate: true }),
      soldRecord('sale-6', { transactionEligible: false })
    ],
    identityDiagnosticResult: {
      identityEligibility: {
        valuationEligible: true,
        exactCompEligible: true
      }
    }
  });

  assert.equal(result.readinessStatus, READINESS_STATUS.BLOCKED);
  assert.equal(result.eligibleEvidenceSummary.trueSoldEvidenceCount, 1);
  assert.equal(result.excludedEvidenceSummary.duplicateEvidenceCount, 1);
  assert.equal(result.excludedEvidenceSummary.staleEvidenceCount, 1);
  assert.equal(result.excludedEvidenceSummary.contextualComparableCount, 1);
  assert.equal(result.excludedEvidenceSummary.rejectedComparableCount, 1);
  assert.equal(result.excludedEvidenceSummary.transactionIneligibleEvidenceCount, 1);
  assert.equal(result.blockingReasons.includes('transaction_ineligible_evidence_present'), true);
});

test('source concentration and excluded contextual evidence produce conditional readiness warnings', () => {
  const result = evaluateEvidenceReadiness({
    evidenceRecords: [
      soldRecord('sale-1', { source: 'single_source' }),
      soldRecord('sale-2', { source: 'single_source', soldPrice: 101 }),
      soldRecord('sale-3', { source: 'single_source', soldPrice: 102 }),
      soldRecord('context-1', { exactComparable: false, similarity: 70, source: 'single_source' })
    ],
    identityDiagnosticResult: {
      identityEligibility: {
        valuationEligible: true,
        exactCompEligible: true
      }
    }
  });

  assert.equal(result.readinessStatus, READINESS_STATUS.CONDITIONALLY_READY);
  assert.equal(result.warnings.includes('source_concentration_high'), true);
  assert.equal(result.warnings.includes('contextual_comparables_excluded'), true);
  assert.equal(result.confidenceCapRecommendation.recommendedCap, 75);
  assert.equal(result.recommendedReviewAction, REVIEW_ACTION.REVIEW_CONDITIONS);
});

test('missing evidence is unavailable and remains unknown rather than fabricated', () => {
  const result = evaluateEvidenceReadiness({});

  assert.equal(result.readinessStatus, READINESS_STATUS.UNAVAILABLE);
  assert.equal(result.readinessLevel, 'unavailable');
  assert.equal(result.eligibleEvidenceSummary.trueSoldEvidenceCount, 0);
  assert.deepEqual(result.evidenceUsed, []);
  assert.deepEqual(result.evidenceExcluded, []);
  assert.equal(result.valuationReadiness.shouldWithholdValuationDiagnostically, true);
  assert.equal(result.recommendedReviewAction, REVIEW_ACTION.PROVIDE_EVIDENCE);
});

test('evidence readiness diagnostics are deterministic and do not mutate inputs', () => {
  const input = {
    evidenceRecords: [soldRecord('sale-1'), soldRecord('sale-2'), soldRecord('sale-3')],
    identityDiagnosticResult: {
      identityEligibility: {
        valuationEligible: true,
        exactCompEligible: true
      }
    }
  };
  const before = JSON.parse(JSON.stringify(input));
  const first = evaluateEvidenceReadiness(input);
  const second = evaluateEvidenceReadiness(input);

  assert.deepEqual(input, before);
  assert.deepEqual(second, first);
  assert.equal(first.stableFingerprint, second.stableFingerprint);
});

test('production intelligence trace records supplied evidence readiness additively', () => {
  const diagnostic = evaluateEvidenceReadiness({
    evidenceRecords: [soldRecord('sale-1'), soldRecord('sale-2'), soldRecord('sale-3')],
    identityDiagnosticResult: {
      identityEligibility: {
        valuationEligible: true,
        exactCompEligible: true
      }
    }
  });
  const trace = createProductionIntelligenceTrace({
    traceId: 'trace-with-evidence-readiness',
    evidenceReadinessDiagnosticResult: diagnostic,
    dealGateOutcome: {
      passed: false,
      decision: 'REJECT',
      reasons: ['test rejection']
    }
  });

  assert.equal(trace.evidenceReadinessDiagnosticSummary.available, true);
  assert.equal(trace.evidenceReadinessDiagnosticSummary.readinessStatus, diagnostic.readinessStatus);
  assert.equal(trace.evidenceReadinessDiagnosticSummary.stableFingerprint, diagnostic.stableFingerprint);
  assert.equal(trace.evidenceReadinessDiagnosticSummary.changesProductionBehavior, false);
  assert.equal(trace.dealGateOutcome.decision, 'REJECT');
  assert.equal(trace.buyNowEligibility.eligible, false);
});
