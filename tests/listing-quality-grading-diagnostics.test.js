'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  GRADING_DIAGNOSTIC_STATUS,
  LISTING_QUALITY_STATUS,
  buildListingQualityGradingFingerprint,
  evaluateListingQualityGrading,
  summarizeListingQualityGrading
} = require('../validation/listingQualityGradingDiagnostics');
const {
  createProductionIntelligenceTrace
} = require('../validation/productionIntelligenceTrace');

function strongListing(overrides = {}) {
  return {
    title: '2020 Panini Prizm Anthony Edwards Silver Rookie PSA 10 #258',
    price: 95,
    totalCost: 100,
    condition: 'PSA 10',
    image: 'https://example.test/image.jpg',
    images: ['https://example.test/front.jpg', 'https://example.test/back.jpg', 'https://example.test/cert.jpg'],
    sellerFeedbackPercentage: 99.8,
    sellerFeedbackScore: 1500,
    estimatedProfit: 80,
    roi: 0.45,
    marketConfidence: 86,
    compCount: 8,
    parsed: {
      qualityTier: 'premium',
      year: 2020,
      setName: 'Prizm',
      cardNumber: '258',
      gradeCompany: 'PSA',
      grade: 10,
      rawOrGraded: 'graded',
      flags: {
        graded: true,
        rookie: true,
        refractor: true
      }
    },
    ...overrides
  };
}

function gradePremium(overrides = {}) {
  return {
    source: 'grade_premium_engine',
    gradePremiumScore: 82,
    premiumJustification: 'justified',
    premiumRiskLevel: 'low',
    soldSupport: {
      sameGradeCount: 4,
      lowerGradeCount: 2,
      higherGradeCount: 1,
      rawCount: 1,
      activeContextCount: 0
    },
    warnings: [],
    ...overrides
  };
}

test('listing quality and grading diagnostics classify clean graded listings as strong and confirmed', () => {
  const result = evaluateListingQualityGrading({
    listing: strongListing(),
    marketData: {
      marketValue: 150,
      confidence: 86,
      source: 'sold_market',
      soldCompCount: 8
    },
    gradePremiumData: gradePremium(),
    identityDiagnosticResult: {
      diagnosticStatus: 'exact',
      ambiguityLevel: 'none',
      identityEligibility: {
        valuationEligible: true,
        exactCompEligible: true
      }
    }
  });

  assert.equal(result.listingQualityStatus, LISTING_QUALITY_STATUS.STRONG);
  assert.equal(result.gradingDiagnosticStatus, GRADING_DIAGNOSTIC_STATUS.CONFIRMED);
  assert.equal(result.riskLevel, 'low');
  assert.equal(result.confirmedAttributes.includes('multiple_images_present'), true);
  assert.equal(result.confirmedAttributes.includes('grading_company:psa'), true);
  assert.equal(result.gradingSupportSummary.premiumJustification, 'justified');
  assert.equal(result.recommendedReviewAction, 'none');
  assert.equal(result.stableFingerprint, buildListingQualityGradingFingerprint(result));
  assert.match(summarizeListingQualityGrading(result), /strong/);
});

test('reprint proxy custom and suspicious title language creates blocked diagnostic status', () => {
  const result = evaluateListingQualityGrading({
    listing: strongListing({
      title: 'Custom Reprint Proxy Facsimile Mystery Lot Raw Damaged Card',
      image: '',
      images: [],
      sellerFeedbackPercentage: 94,
      sellerFeedbackScore: 4,
      totalCost: 5,
      parsed: {
        qualityTier: 'avoid',
        rawOrGraded: 'raw',
        flags: {
          graded: false,
          reprint: true,
          custom: true,
          lot: true
        }
      }
    }),
    marketData: {
      marketValue: 150,
      confidence: 20,
      source: 'fallback'
    },
    gradePremiumData: gradePremium({
      gradePremiumScore: 10,
      premiumJustification: 'unknown',
      premiumRiskLevel: 'high',
      soldSupport: { sameGradeCount: 0, activeContextCount: 2 }
    })
  });

  assert.equal(result.listingQualityStatus, LISTING_QUALITY_STATUS.BLOCKED);
  assert.equal(result.riskLevel, 'critical');
  assert.equal(result.blockingIssues.includes('reprint_custom_proxy_replica_language_present'), true);
  assert.equal(result.blockingIssues.includes('lot_or_multi_card_risk_present'), true);
  assert.equal(result.blockingIssues.includes('image_evidence_missing'), true);
  assert.equal(result.warnings.includes('seller_feedback_or_history_risk'), true);
  assert.equal(result.recommendedReviewAction, 'manual_authenticity_and_listing_review_required');
});

test('raw versus graded and slab-certification conflicts are grading ambiguous', () => {
  const result = evaluateListingQualityGrading({
    listing: strongListing({
      title: '2020 Prizm Anthony Edwards PSA slab cert mislabeled raw card',
      parsed: {
        qualityTier: 'watch',
        rawOrGraded: 'raw',
        flags: {
          graded: false
        }
      }
    }),
    gradePremiumData: gradePremium({
      premiumJustification: 'unproven',
      premiumRiskLevel: 'moderate',
      soldSupport: { sameGradeCount: 0 }
    })
  });

  assert.equal(result.gradingDiagnosticStatus, GRADING_DIAGNOSTIC_STATUS.AMBIGUOUS);
  assert.equal(result.ambiguousAttributes.includes('raw_vs_graded_conflict'), true);
  assert.equal(result.ambiguousAttributes.includes('slab_or_crossover_language'), true);
  assert.equal(result.recommendedReviewAction, 'review_grading_evidence_before_reliance');
});

test('listing disappearance and price-drop history produce caution without production penalties', () => {
  const result = evaluateListingQualityGrading({
    listing: strongListing(),
    gradePremiumData: gradePremium(),
    listingHistoryContext: {
      status: 'disappeared',
      seenCount: 4,
      likelySoldOrEnded: true,
      disappearedAt: '2026-07-15T10:00:00.000Z',
      priceHistory: [
        { totalCost: 140 },
        { totalCost: 100 }
      ],
      priceDrops: [
        { fromPrice: 140, toPrice: 100, amountDropped: 40 }
      ]
    }
  });

  assert.equal(result.listingQualityStatus, LISTING_QUALITY_STATUS.CAUTION);
  assert.equal(result.listingHistoryContext.available, true);
  assert.equal(result.listingHistoryContext.priceDropCount, 1);
  assert.equal(result.warnings.includes('listing_history_price_change_or_disappearance_context'), true);
  assert.equal(result.productionImpact, 'none');
});

test('missing listing data remains unavailable and unknown rather than invented', () => {
  const result = evaluateListingQualityGrading({});

  assert.equal(result.listingQualityStatus, LISTING_QUALITY_STATUS.UNAVAILABLE);
  assert.equal(result.gradingDiagnosticStatus, GRADING_DIAGNOSTIC_STATUS.UNAVAILABLE);
  assert.equal(result.listingQualitySummary.title, 'unknown');
  assert.equal(result.unsupportedAttributes.includes('image_evidence_missing'), true);
});

test('listing quality and grading diagnostics are deterministic and do not mutate inputs', () => {
  const input = {
    listing: strongListing(),
    gradePremiumData: gradePremium()
  };
  const before = JSON.parse(JSON.stringify(input));
  const first = evaluateListingQualityGrading(input);
  const second = evaluateListingQualityGrading(input);

  assert.deepEqual(input, before);
  assert.deepEqual(second, first);
  assert.equal(first.stableFingerprint, second.stableFingerprint);
});

test('production intelligence trace records supplied listing quality grading diagnostics additively', () => {
  const diagnostic = evaluateListingQualityGrading({
    listing: strongListing(),
    gradePremiumData: gradePremium()
  });
  const trace = createProductionIntelligenceTrace({
    traceId: 'trace-with-listing-quality-grading',
    listingQualityGradingDiagnosticResult: diagnostic,
    dealGateOutcome: {
      passed: false,
      decision: 'REJECT',
      reasons: ['test rejection']
    }
  });

  assert.equal(trace.listingQualityGradingDiagnosticSummary.available, true);
  assert.equal(trace.listingQualityGradingDiagnosticSummary.listingQualityStatus, diagnostic.listingQualityStatus);
  assert.equal(trace.listingQualityGradingDiagnosticSummary.gradingDiagnosticStatus, diagnostic.gradingDiagnosticStatus);
  assert.equal(trace.listingQualityGradingDiagnosticSummary.stableFingerprint, diagnostic.stableFingerprint);
  assert.equal(trace.listingQualityGradingDiagnosticSummary.changesProductionBehavior, false);
  assert.equal(trace.dealGateOutcome.decision, 'REJECT');
  assert.equal(trace.buyNowEligibility.eligible, false);
});
