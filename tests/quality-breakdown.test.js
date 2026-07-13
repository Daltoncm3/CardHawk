'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const qualityEngine = require('../engines/qualityEngine');
const { buildDisplayInterpretation, dealGate } = require('../server');

function premiumQualityListing(overrides = {}) {
  return {
    title: '2024 Bowman Chrome 1st Bowman Rookie Auto Gold Refractor /50 PSA 10',
    totalCost: 100,
    price: 100,
    estimatedProfit: 320,
    roi: 1.1,
    marketConfidence: 88,
    compCount: 11,
    sellerFeedbackPercentage: 99.8,
    sellerFeedbackScore: 1200,
    parsed: {
      qualityTier: 'premium',
      grade: 10,
      numberedTo: 50,
      setName: 'Bowman Chrome',
      flags: {
        graded: true,
        autograph: true,
        rookie: true,
        firstBowman: true,
        refractor: true,
        numbered: true
      }
    },
    ...overrides
  };
}

function strongGateInput(overrides = {}) {
  return {
    score: 92,
    estimatedProfit: 45,
    roi: 0.35,
    roiData: { roi: 0.35, roiPercent: 35 },
    condition: 'PSA 10',
    compData: { trueSoldCompCount: 8, soldCompCount: 8, source: 'sold_market' },
    marketData: { confidence: 90, soldCompCount: 8, marketValue: 145, referencePrice: 140, source: 'sold_market' },
    marketIntelligenceScore: 90,
    marketTrustLevel: 'good',
    marketRecommendation: 'trust',
    marketIntelligenceData: {
      intelligenceScore: 90,
      confidenceScore: 90,
      trustLevel: 'good',
      recommendation: 'trust',
      liquidity: { score: 80, level: 'good' },
      priceConsistency: { score: 80, level: 'good' }
    },
    riskLevel: 'low',
    ...overrides
  };
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

test('qualityBreakdown reconciles exactly to the existing Quality score', () => {
  const qualityData = qualityEngine.evaluateQuality(premiumQualityListing());
  const breakdown = qualityData.qualityBreakdown;
  const contributionTotal = sum(breakdown.contributions.map((entry) => entry.value));

  assert.equal(qualityData.investmentQuality, 100);
  assert.equal(qualityData.bucket, 'Elite');
  assert.equal(breakdown.baseScore, 45);
  assert.equal(breakdown.preClampTotal, breakdown.baseScore + contributionTotal);
  assert.equal(breakdown.finalQualityScore, qualityData.investmentQuality);
  assert.equal(breakdown.rawBucket, qualityData.bucket);
  assert.equal(breakdown.parsedTier.contribution, 14);
  assert.equal(breakdown.gradeProfile.contribution, 19);
  assert.ok(breakdown.cardTraits.contribution > 0);
  assert.equal(breakdown.profit.contribution, 13);
  assert.equal(breakdown.roi.contribution, 12);
  assert.equal(breakdown.confidence.contribution, 12);
  assert.equal(breakdown.compCount.contribution, 8);
  assert.equal(breakdown.seller.contribution, 6);
  assert.equal(typeof breakdown.liquidityAdjustment.contribution, 'number');
  assert.equal(typeof breakdown.riskAdjustment.contribution, 'number');
});

test('qualityBreakdown exposes penalties without changing raw low-quality output', () => {
  const qualityData = qualityEngine.evaluateQuality(premiumQualityListing({
    title: 'Custom Reprint Digital Mystery Lot Raw Damaged Card',
    estimatedProfit: -25,
    roi: -0.3,
    marketConfidence: 20,
    compCount: 0,
    sellerFeedbackPercentage: 95,
    sellerFeedbackScore: 10,
    parsed: {
      qualityTier: 'avoid',
      grade: null,
      numberedTo: null,
      flags: {
        graded: false,
        reprint: true,
        custom: true,
        digital: true,
        lot: true
      }
    }
  }));
  const breakdown = qualityData.qualityBreakdown;

  assert.equal(qualityData.bucket, 'Avoid');
  assert.equal(breakdown.parsedTier.contribution, -50);
  assert.equal(breakdown.gradeProfile.contribution, -5);
  assert.ok(breakdown.riskTitlePenalties.contribution < 0);
  assert.equal(breakdown.profit.contribution, -20);
  assert.equal(breakdown.roi.contribution, -15);
  assert.equal(breakdown.confidence.contribution, -12);
  assert.equal(breakdown.compCount.contribution, -10);
  assert.equal(breakdown.seller.contribution, -8);
  assert.equal(breakdown.finalQualityScore, qualityData.investmentQuality);
});

test('display reclassifies Quality as non-authoritative desirability context', () => {
  const qualityData = qualityEngine.evaluateQuality(premiumQualityListing());
  const listing = {
    score: 95,
    estimatedValue: 150,
    estimatedProfit: 50,
    roi: 0.5,
    marketConfidence: 90,
    investmentQuality: qualityData.investmentQuality,
    qualityBucket: qualityData.bucket,
    qualityData,
    dealGrade: { grade: 'A', action: 'BUY_NOW' },
    roiData: { recommendation: 'BUY_NOW' },
    dealGate: dealGate(strongGateInput())
  };
  const before = JSON.parse(JSON.stringify(listing));
  const displayListing = buildDisplayInterpretation(listing);

  assert.deepEqual(listing, before);
  assert.equal(displayListing.investmentQuality, before.investmentQuality);
  assert.equal(displayListing.qualityBucket, 'Elite');
  assert.equal(displayListing.display.qualityScoreLabel, 'Desirability Context');
  assert.equal(displayListing.display.qualityBucketLabel, 'Premium desirability context');
  assert.equal(displayListing.display.qualityContextLabel, 'Desirability context');
  assert.equal(displayListing.display.signalAnnotations.quality_score.signalType, 'context');
  assert.equal(displayListing.display.signalAnnotations.quality_score.decisionEligibility, 'context_only');
  assert.equal(displayListing.display.signalAnnotations.quality_bucket.rawValue, 'Elite');
  assert.equal(/buy|buy_now|elite/i.test(displayListing.display.qualityBucketLabel), false);
});

test('all legacy Quality buckets receive neutral display wording while raw buckets remain unchanged', () => {
  const cases = [
    ['Elite', 'Premium desirability context'],
    ['Strong Buy Candidate', 'Strong desirability context'],
    ['Good Flip Candidate', 'Good desirability context'],
    ['Review Carefully', 'Mixed desirability context'],
    ['Low Priority', 'Low desirability context'],
    ['Avoid', 'Poor desirability context']
  ];

  for (const [rawBucket, displayBucket] of cases) {
    const displayListing = buildDisplayInterpretation({
      investmentQuality: 80,
      qualityBucket: rawBucket,
      qualityData: { investmentQuality: 80, bucket: rawBucket },
      dealGate: { passed: false, reasons: ['Rejected for test.'] }
    });

    assert.equal(displayListing.qualityBucket, rawBucket);
    assert.equal(displayListing.display.qualityBucketLabel, displayBucket);
    assert.equal(/buy|buy_now|elite|candidate|flip/i.test(displayListing.display.qualityBucketLabel), false);
  }
});

test('qualityBreakdown does not change Deal Gate or BUY_NOW behavior', () => {
  const qualityData = qualityEngine.evaluateQuality(premiumQualityListing());
  const gateInput = strongGateInput({ qualityData });
  const gateWithBreakdown = dealGate(gateInput);
  const gateWithoutBreakdown = dealGate({
    ...gateInput,
    qualityData: {
      ...qualityData,
      qualityBreakdown: undefined
    }
  });

  assert.equal(gateWithBreakdown.passed, gateWithoutBreakdown.passed);
  assert.equal(gateWithBreakdown.buyNowAllowed, gateWithoutBreakdown.buyNowAllowed);
  assert.equal(gateWithBreakdown.decision, gateWithoutBreakdown.decision);
  assert.deepEqual(gateWithBreakdown.reasons, gateWithoutBreakdown.reasons);
  assert.deepEqual(gateWithBreakdown.positives, gateWithoutBreakdown.positives);
});
