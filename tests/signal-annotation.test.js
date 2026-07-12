'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const registry = require('../utils/signalContractRegistry');
const signalAnnotation = require('../utils/signalAnnotation');
const { buildDisplayInterpretation } = require('../server');

const DISPLAYED_SIGNAL_IDS = [
  'legacy_score',
  'quality_score',
  'quality_bucket',
  'deal_grade',
  'market_confidence',
  'sold_evidence_confidence',
  'intelligence_score',
  'confidence_score',
  'trust_level',
  'roi_recommendation',
  'decision_intelligence',
  'deal_gate'
];

function baseListing(overrides = {}) {
  return {
    ebayItemId: 'signal-annotation-1',
    title: 'Signal Annotation Test Card',
    price: 20,
    totalCost: 22,
    estimatedValue: 60,
    estimatedProfit: 28,
    roi: 1.27,
    score: 88,
    marketConfidence: 73,
    investmentQuality: 91,
    qualityBucket: 'Strong Buy Candidate',
    qualityData: {
      investmentQuality: 91,
      bucket: 'Strong Buy Candidate'
    },
    dealGrade: {
      grade: 'B+',
      action: 'BUY_NOW',
      gradeScore: 86
    },
    roiData: {
      recommendation: 'Strong ROI context'
    },
    marketIntelligenceScore: 67,
    marketTrustLevel: 'moderate',
    marketIntelligenceData: {
      intelligenceScore: 67,
      confidenceScore: 58,
      trustLevel: 'moderate',
      recommendation: 'MONITOR',
      decisionIntelligence: {
        overallReadiness: 'review',
        recommendationImpact: 'none'
      }
    },
    compData: {
      trueSoldCompCount: 2,
      soldCompCount: 2,
      activeCompCount: 4
    },
    dealGate: {
      passed: false,
      reasons: ['Only 2 sold comps available; minimum is 3.'],
      gate: {
        soldCompCount: 2
      }
    },
    ...overrides
  };
}

test('annotateSignal combines a raw value with registered Signal Contract metadata', () => {
  const annotation = signalAnnotation.annotateSignal('market_confidence', 73);
  const contract = registry.getSignalContract('market_confidence');

  assert.deepEqual(annotation, {
    signalId: contract.signalId,
    owner: contract.owner,
    signalType: contract.signalType,
    decisionEligibility: contract.decisionEligibility,
    evidencePolicy: {
      requiresTrueSold: contract.requiresTrueSold,
      allowsActiveEvidence: contract.allowsActiveEvidence,
      allowsFallbackEvidence: contract.allowsFallbackEvidence
    },
    allowedDisplayLanguage: contract.allowedDisplayLanguage,
    confidenceMeaning: contract.confidenceMeaning,
    displayPriority: contract.displayPriority,
    rawValue: 73
  });
});

test('runtime display annotations cover every displayed signal without changing raw values', () => {
  const listing = baseListing();
  const before = JSON.parse(JSON.stringify(listing));
  const displayListing = buildDisplayInterpretation(listing);
  const annotations = displayListing.display.signalAnnotations;

  assert.deepEqual(listing, before);
  assert.equal(displayListing.score, before.score);
  assert.equal(displayListing.marketConfidence, before.marketConfidence);
  assert.equal(displayListing.investmentQuality, before.investmentQuality);
  assert.deepEqual(displayListing.dealGrade, before.dealGrade);
  assert.deepEqual(displayListing.roiData, before.roiData);
  assert.deepEqual(displayListing.marketIntelligenceData, before.marketIntelligenceData);
  assert.deepEqual(displayListing.dealGate, before.dealGate);

  for (const signalId of DISPLAYED_SIGNAL_IDS) {
    assert.ok(annotations[signalId], `${signalId} should be annotated`);
  }

  assert.equal(annotations.legacy_score.rawValue, before.score);
  assert.equal(annotations.quality_score.rawValue, before.investmentQuality);
  assert.equal(annotations.quality_bucket.rawValue, before.qualityBucket);
  assert.deepEqual(annotations.deal_grade.rawValue, before.dealGrade);
  assert.equal(annotations.market_confidence.rawValue, before.marketConfidence);
  assert.deepEqual(annotations.sold_evidence_confidence.rawValue, { trueSoldCompCount: 2 });
  assert.equal(annotations.intelligence_score.rawValue, before.marketIntelligenceScore);
  assert.equal(annotations.confidence_score.rawValue, before.marketIntelligenceData.confidenceScore);
  assert.equal(annotations.trust_level.rawValue, before.marketTrustLevel);
  assert.equal(annotations.roi_recommendation.rawValue, before.roiData.recommendation);
  assert.deepEqual(annotations.decision_intelligence.rawValue, before.marketIntelligenceData.decisionIntelligence);
  assert.deepEqual(annotations.deal_gate.rawValue, before.dealGate);
});

test('runtime annotation metadata matches the Signal Contract Registry', () => {
  const annotations = buildDisplayInterpretation(baseListing()).display.signalAnnotations;

  for (const signalId of DISPLAYED_SIGNAL_IDS) {
    const contract = registry.getSignalContract(signalId);
    const annotation = annotations[signalId];

    assert.equal(annotation.signalId, contract.signalId);
    assert.equal(annotation.owner, contract.owner);
    assert.equal(annotation.signalType, contract.signalType);
    assert.equal(annotation.decisionEligibility, contract.decisionEligibility);
    assert.deepEqual(annotation.evidencePolicy, {
      requiresTrueSold: contract.requiresTrueSold,
      allowsActiveEvidence: contract.allowsActiveEvidence,
      allowsFallbackEvidence: contract.allowsFallbackEvidence
    });
    assert.equal(annotation.allowedDisplayLanguage, contract.allowedDisplayLanguage);
    assert.equal(annotation.confidenceMeaning, contract.confidenceMeaning);
    assert.equal(annotation.displayPriority, contract.displayPriority);
  }
});

test('Deal Gate remains the only authoritative production-decision annotation', () => {
  const annotations = buildDisplayInterpretation(baseListing()).display.signalAnnotations;
  const productionAnnotations = signalAnnotation.getProductionDecisionAnnotations(annotations);

  assert.deepEqual(productionAnnotations.map((annotation) => annotation.signalId), ['deal_gate']);

  for (const annotation of Object.values(annotations)) {
    if (annotation.signalId === 'deal_gate') continue;

    assert.notEqual(annotation.signalType, registry.SIGNAL_TYPES.productionDecision);
    assert.notEqual(annotation.decisionEligibility, registry.DECISION_ELIGIBILITY.productionDecision);
  }
});

