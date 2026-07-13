'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { buildDisplayInterpretation } = require('../server');

function baseListing(overrides = {}) {
  return {
    ebayItemId: 'display-1',
    title: 'Display Guard Test Card',
    price: 10,
    totalCost: 10,
    estimatedValue: 100,
    estimatedProfit: 75,
    roi: 2.5,
    score: 98,
    marketConfidence: 86,
    compCount: 4,
    compData: {
      compCount: 4,
      trueSoldCompCount: 0,
      soldCompCount: 0,
      activeCompCount: 4
    },
    investmentQuality: 96,
    qualityBucket: 'Strong Buy Candidate',
    qualityData: {
      investmentQuality: 96,
      bucket: 'Strong Buy Candidate'
    },
    dealGrade: {
      grade: 'A+',
      action: 'BUY_NOW',
      gradeScore: 97
    },
    roiData: {
      recommendation: 'BUY_NOW'
    },
    dealGate: {
      passed: false,
      reasons: ['Zero sold comps available.'],
      gate: {
        soldCompCount: 0
      }
    },
    ...overrides
  };
}

test('rejected listings cannot expose buy-like primary display labels', () => {
  const displayListing = buildDisplayInterpretation(baseListing());

  assert.equal(displayListing.display.authoritativeDecisionSource, 'deal_gate');
  assert.equal(displayListing.display.authoritativeDecision, 'REJECTED');
  assert.equal(displayListing.display.primaryDecisionLabel, 'Rejected by Deal Gate');
  assert.equal(displayListing.display.legacyGradeActionLabel, '');
  assert.equal(displayListing.display.hiddenLegacyGradeAction, 'Legacy grade context');
  assert.equal(displayListing.display.qualityBucketLabel.includes('Buy'), false);
  assert.equal(displayListing.display.qualityBucketLabel.includes('Candidate'), false);
  assert.equal(displayListing.display.hiddenLegacyGradeAction.includes('BUY'), false);
  assert.equal(displayListing.display.suppressedBuyLikeLabels, true);
});

test('accepted listings keep Deal Gate decision while context labels remain neutral', () => {
  const displayListing = buildDisplayInterpretation(baseListing({
    dealGate: {
      passed: true,
      reasons: [],
      gate: {
        soldCompCount: 5
      }
    }
  }));

  assert.equal(displayListing.display.authoritativeDecision, 'BUY_NOW');
  assert.equal(displayListing.display.primaryDecisionLabel, 'BUY_NOW');
  assert.equal(displayListing.display.qualityBucketLabel, 'Strong desirability context');
  assert.equal(displayListing.display.legacyGradeActionLabel, 'Legacy grade context');
  assert.equal(displayListing.display.roiRecommendationLabel, 'Financial ROI context');
  assert.equal(displayListing.display.suppressedBuyLikeLabels, false);
  assert.equal(displayListing.display.soldEvidenceCount, 5);
});

test('presentation guard preserves underlying calculation values', () => {
  const listing = baseListing();
  const before = JSON.parse(JSON.stringify(listing));
  const displayListing = buildDisplayInterpretation(listing);

  assert.deepEqual(listing, before);
  assert.equal(displayListing.score, before.score);
  assert.equal(displayListing.estimatedValue, before.estimatedValue);
  assert.equal(displayListing.estimatedProfit, before.estimatedProfit);
  assert.equal(displayListing.roi, before.roi);
  assert.equal(displayListing.marketConfidence, before.marketConfidence);
  assert.deepEqual(displayListing.qualityData, before.qualityData);
  assert.deepEqual(displayListing.dealGrade, before.dealGrade);
  assert.deepEqual(displayListing.roiData, before.roiData);
  assert.deepEqual(displayListing.dealGate, before.dealGate);
});

test('display labels distinguish market context confidence from sold evidence support', () => {
  const displayListing = buildDisplayInterpretation(baseListing({
    marketConfidence: 73,
    compData: {
      trueSoldCompCount: 2,
      soldCompCount: 2,
      activeCompCount: 6
    },
    dealGate: {
      passed: false,
      reasons: ['Only 2 sold comps available; minimum is 3.'],
      gate: {
        soldCompCount: 2
      }
    }
  }));

  assert.equal(displayListing.display.marketConfidenceLabel, 'Market Context Confidence');
  assert.equal(displayListing.display.marketConfidenceAuthority, 'context_only_non_authoritative');
  assert.equal(displayListing.display.soldEvidenceConfidenceLabel, 'Sold Evidence Support');
  assert.equal(displayListing.display.soldEvidenceConfidenceAuthority, 'evidence_only_non_authoritative');
  assert.equal(displayListing.display.soldEvidenceCount, 2);
});


test('rejected elite quality is demoted to context wording', () => {
  const displayListing = buildDisplayInterpretation(baseListing({
    qualityBucket: 'Elite',
    qualityData: {
      investmentQuality: 99,
      bucket: 'Elite'
    }
  }));

  assert.equal(displayListing.display.authoritativeDecision, 'REJECTED');
  assert.equal(displayListing.display.qualityBucketLabel, 'Premium desirability context');
  assert.equal(displayListing.display.qualityBucketLabel.includes('Elite'), false);
  assert.equal(displayListing.display.suppressedBuyLikeLabels, true);
});

test('non-decision display labels do not emit buy-like wording', () => {
  const displayListing = buildDisplayInterpretation(baseListing({
    dealGate: {
      passed: true,
      reasons: [],
      gate: {
        soldCompCount: 5
      }
    }
  }));

  assert.equal(displayListing.display.primaryDecisionLabel, 'BUY_NOW');
  assert.equal(/buy|buy_now|elite/i.test(displayListing.display.qualityBucketLabel), false);
  assert.equal(/buy|buy_now|elite/i.test(displayListing.display.legacyGradeActionLabel), false);
  assert.equal(/buy|buy_now|elite/i.test(displayListing.display.roiRecommendationLabel), false);
  assert.equal(displayListing.display.legacyGradeActionAuthority, 'legacy_context_only');
  assert.equal(displayListing.display.roiRecommendationAuthority, 'financial_context_only');
});
