'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  AUTHORITY_LEVEL,
  PROMOTION_READINESS_STATUS,
  RECOMMENDED_ACTION,
  SHADOW_PROMOTION_GOVERNANCE_SOURCE,
  assessShadowPromotionCandidate,
  buildShadowPromotionAssessmentFingerprint,
  summarizeShadowPromotionAssessment
} = require('../validation/shadowPromotionGovernance');

function baseCandidate(overrides = {}) {
  return {
    candidateId: 'range-first-valuation-diagnostics',
    candidateName: 'Range-First Valuation Diagnostics',
    candidateVersion: '1.0.0',
    componentType: 'shadow_diagnostic',
    currentAuthority: AUTHORITY_LEVEL.SHADOW,
    proposedAuthority: AUTHORITY_LEVEL.LIMITED_PRODUCTION_TRIAL,
    contractCompleteness: { satisfied: true },
    deterministicFixtureCoverage: { passed: true, fixtureCount: 12, stableFingerprint: 'fixture-fingerprint' },
    focusedTestCoverage: { passed: true, testCount: 9, stableFingerprint: 'focused-test-fingerprint' },
    fullRegressionStatus: { passed: true, testCount: 785, stableFingerprint: 'full-regression-fingerprint' },
    realListingValidationResults: {
      summary: {
        totalReviewed: 60,
        falsePositiveRate: 3.3,
        missedOpportunityRate: 5,
        outcomeAvailability: 'reviewed'
      },
      stableFingerprint: 'real-listing-fingerprint'
    },
    operatorDealerAgreement: {
      scorecard: {
        totalReviewed: 60,
        agreementPercent: 91.7,
        falsePositiveRate: 3.3,
        missedOpportunityRate: 5
      },
      stableFingerprint: 'dealer-agreement-fingerprint'
    },
    confidenceCalibration: {
      calibrationStatus: 'calibrated',
      confidenceSupportLevel: 'supported',
      sampleSize: 60,
      stableFingerprint: 'confidence-fingerprint'
    },
    shadowObservationPeriod: {
      startedAt: '2026-07-01T00:00:00.000Z',
      endedAt: '2026-07-15T00:00:00.000Z',
      durationDays: 14,
      observationCount: 120,
      complete: true
    },
    productionComparisonResults: {
      comparedCount: 120,
      disagreementCount: 6,
      materialDisagreements: 1,
      stableFingerprint: 'comparison-fingerprint'
    },
    documentedFailureModes: [
      'insufficient_true_sold_evidence',
      'identity_ambiguity',
      'operator_review_disagreement'
    ],
    rollbackReadiness: { satisfied: true, planId: 'rollback-plan-10.8' },
    featureFlagReadiness: { satisfied: true, flagName: 'CARDHAWK_SHADOW_PROMOTION_TRIAL' },
    releaseApproval: { satisfied: true, approvedBy: 'Dalton' },
    productionBoundaryReview: { satisfied: true, reviewedBy: 'Dalton' },
    ...overrides
  };
}

test('promotion assessment approves only a limited trial plan and does not change authority', () => {
  const assessment = assessShadowPromotionCandidate(baseCandidate());

  assert.equal(assessment.source, SHADOW_PROMOTION_GOVERNANCE_SOURCE);
  assert.equal(assessment.readinessStatus, PROMOTION_READINESS_STATUS.APPROVED_FOR_LIMITED_PRODUCTION_TRIAL);
  assert.equal(assessment.promotionHasOccurred, false);
  assert.equal(assessment.productionImpact, 'none');
  assert.equal(assessment.decisionImpact, 'none');
  assert.equal(assessment.authorityFlags.productionApproval, false);
  assert.equal(assessment.authorityFlags.productionPromotionAuthority, false);
  assert.equal(assessment.recommendedNextAction, RECOMMENDED_ACTION.PREPARE_OPERATOR_REVIEWED_TRIAL);
  assert.equal(assessment.approvalRequirements.releaseApproval.satisfied, true);
  assert.equal(assessment.rollbackRequirements.rollbackPlanReady, true);
  assert.match(assessment.productionAuthorityStatement, /Promotion has not occurred/);
});

test('candidate cannot pass based only on contracts, fixtures, and focused tests', () => {
  const assessment = assessShadowPromotionCandidate(baseCandidate({
    realListingValidationResults: undefined,
    operatorDealerAgreement: undefined,
    confidenceCalibration: undefined,
    shadowObservationPeriod: undefined,
    productionComparisonResults: undefined,
    releaseApproval: { satisfied: false }
  }));

  assert.equal(assessment.readinessStatus, PROMOTION_READINESS_STATUS.INSUFFICIENT_EVIDENCE);
  assert.ok(assessment.warnings.includes('validation_evidence_missing:missing_real_listing_validation_results'));
  assert.ok(assessment.warnings.includes('validation_evidence_missing:missing_operator_or_dealer_agreement'));
  assert.ok(assessment.warnings.includes('validation_evidence_missing:missing_shadow_observation_period'));
  assert.equal(assessment.recommendedNextAction, RECOMMENDED_ACTION.COLLECT_VALIDATION_EVIDENCE);
});

test('missing validation evidence routes to extended shadow instead of release review', () => {
  const assessment = assessShadowPromotionCandidate(baseCandidate({
    productionComparisonResults: undefined
  }));

  assert.equal(assessment.readinessStatus, PROMOTION_READINESS_STATUS.READY_FOR_EXTENDED_SHADOW);
  assert.ok(assessment.warnings.includes('validation_evidence_missing:missing_production_comparison_results'));
  assert.equal(assessment.recommendedNextAction, RECOMMENDED_ACTION.CONTINUE_EXTENDED_SHADOW);
});

test('release approval remains a separate gate after validation evidence is complete', () => {
  const assessment = assessShadowPromotionCandidate(baseCandidate({
    releaseApproval: { satisfied: false }
  }));

  assert.equal(assessment.readinessStatus, PROMOTION_READINESS_STATUS.READY_FOR_RELEASE_REVIEW);
  assert.ok(assessment.blockingReasons.includes('release_approval_missing'));
  assert.equal(assessment.approvalRequirements.releaseApproval.satisfied, false);
  assert.equal(assessment.promotionHasOccurred, false);
});

test('direct production authority is blocked by the governance framework', () => {
  const assessment = assessShadowPromotionCandidate(baseCandidate({
    proposedAuthority: AUTHORITY_LEVEL.PRODUCTION_AUTHORITY
  }));

  assert.equal(assessment.readinessStatus, PROMOTION_READINESS_STATUS.BLOCKED);
  assert.ok(assessment.blockingReasons.includes('direct_production_authority_promotion_not_allowed_by_this_framework'));
  assert.equal(assessment.recommendedNextAction, RECOMMENDED_ACTION.RESOLVE_BLOCKERS);
});

test('draft candidates preserve missing facts instead of inventing readiness', () => {
  const assessment = assessShadowPromotionCandidate({
    candidateName: 'Incomplete Shadow Component',
    currentAuthority: AUTHORITY_LEVEL.SHADOW
  });

  assert.equal(assessment.readinessStatus, PROMOTION_READINESS_STATUS.DRAFT);
  assert.equal(assessment.candidateId, 'unknown');
  assert.equal(assessment.candidateVersion, 'unknown');
  assert.ok(assessment.blockingReasons.includes('missing_candidate_id'));
  assert.ok(assessment.blockingReasons.includes('missing_candidate_version'));
});

test('promotion assessment fingerprints are deterministic and exclude the fingerprint field itself', () => {
  const first = assessShadowPromotionCandidate(baseCandidate());
  const second = assessShadowPromotionCandidate(baseCandidate());

  assert.equal(first.stableFingerprint, second.stableFingerprint);
  assert.equal(first.stableFingerprint, buildShadowPromotionAssessmentFingerprint(first));

  const withoutFingerprint = JSON.parse(JSON.stringify(first));
  withoutFingerprint.stableFingerprint = 'different';
  assert.equal(first.stableFingerprint, buildShadowPromotionAssessmentFingerprint(withoutFingerprint));
});

test('assessment output is immutable and summary is explicit about unchanged authority', () => {
  const assessment = assessShadowPromotionCandidate(baseCandidate());

  assert.throws(() => {
    assessment.readinessStatus = PROMOTION_READINESS_STATUS.REJECTED;
  }, TypeError);
  assert.match(summarizeShadowPromotionAssessment(assessment), /production authority has not changed/);
});
