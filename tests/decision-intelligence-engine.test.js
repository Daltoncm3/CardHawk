'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const decisionIntelligenceEngine = require('../engines/decisionIntelligenceEngine');

function buildInput(overrides = {}) {
  return {
    evidenceSufficiency: {
      source: 'evidence_sufficiency_engine',
      sufficientForValuation: true,
      sufficiencyLevel: 'adequate',
      evidenceSufficiencyScore: 76,
      blockingConcerns: [],
      warnings: [],
      positives: ['True sold evidence meets the suggested minimum.'],
      summary: 'Evidence sufficiency is adequate, with enough support to trust the valuation context cautiously.',
      ...(overrides.evidenceSufficiency || {})
    },
    listingSimilarity: {
      source: 'listing_similarity_engine',
      averageSimilarityScore: 91,
      similarityBand: 'strong',
      similarityDistribution: { exact: 1, strong: 2, usable: 0, weak: 0, reject: 0 },
      fatalMismatches: [],
      warnings: [],
      summary: 'Comparable listings show strong similarity to the target listing.',
      ...(overrides.listingSimilarity || {})
    },
    comparableQuality: {
      source: 'comparable_quality_engine',
      scoredComparableCount: 3,
      averageComparableQualityScore: 82,
      qualityDistribution: { excellent: 1, good: 2, usable: 0, weak: 0, reject: 0 },
      warnings: [],
      summary: 'Comparable quality is strong across the available evidence.',
      ...(overrides.comparableQuality || {})
    },
    valuationRange: {
      source: 'valuation_range_engine',
      floorValue: 90,
      expectedValue: 120,
      ceilingValue: 145,
      rangeQuality: 'usable',
      confidence: 72,
      summary: 'Valuation range is usable but should be reviewed: floor $90, expected $120, ceiling $145.',
      ...(overrides.valuationRange || {})
    },
    supplyPressure: {
      source: 'supply_pressure_engine',
      pressureLevel: 'low',
      undercutRiskLevel: 'low',
      resaleBlockerRisk: 'low',
      supplyPressureScore: 22,
      undercutRiskScore: 18,
      warnings: [],
      summary: 'Supply pressure appears low from the available active-market evidence.',
      ...(overrides.supplyPressure || {})
    },
    ...(overrides.root || {})
  };
}

function serialized(result) {
  return JSON.stringify(result);
}

test('exports decision intelligence public API', () => {
  assert.equal(typeof decisionIntelligenceEngine.evaluateDecisionIntelligence, 'function');
  assert.equal(typeof decisionIntelligenceEngine.summarizeDecisionIntelligence, 'function');
});

test('supported five-signal context returns explanation-only output with no recommendation impact', () => {
  const result = decisionIntelligenceEngine.evaluateDecisionIntelligence(buildInput());

  assert.equal(result.source, 'decision_intelligence_engine');
  assert.equal(result.mode, 'explanation_only');
  assert.equal(result.recommendationImpact, 'none');
  assert.equal(result.overallReadiness, 'supported_context');
  assert.equal(result.evidencePosture, 'adequate');
  assert.equal(result.compPosture, 'strong');
  assert.equal(result.valuationPosture, 'usable_range');
  assert.equal(result.resalePressurePosture, 'low');
  assert.ok(result.supportingSignals.length >= 4);
  assert.equal(result.blockers.length, 0);
  assert.equal(result.conflicts.length, 0);
});

test('active-only or missing true sold evidence creates evidence blocker', () => {
  const result = decisionIntelligenceEngine.evaluateDecisionIntelligence(buildInput({
    evidenceSufficiency: {
      sufficientForValuation: false,
      sufficiencyLevel: 'unreliable',
      evidenceSufficiencyScore: 12,
      blockingConcerns: [
        'No true sold evidence is available.',
        'Evidence is active-only.'
      ],
      summary: 'Evidence sufficiency is unreliable from the available evidence.'
    }
  }));

  assert.equal(result.overallReadiness, 'not_ready');
  assert.equal(result.evidencePosture, 'unreliable');
  assert.match(result.blockers.map((item) => item.message).join(' '), /No true sold evidence|active-only/);
});

test('fatal listing similarity mismatch creates comp blocker', () => {
  const result = decisionIntelligenceEngine.evaluateDecisionIntelligence(buildInput({
    listingSimilarity: {
      averageSimilarityScore: 32,
      similarityBand: 'reject',
      similarityDistribution: { exact: 0, strong: 0, usable: 0, weak: 0, reject: 1 },
      fatalMismatches: ['raw/graded mismatch'],
      summary: 'Listing similarity is rejected or too weak because high-impact dimensions do not match.'
    }
  }));

  assert.equal(result.overallReadiness, 'not_ready');
  assert.equal(result.compPosture, 'rejected');
  assert.match(result.blockers.map((item) => item.message).join(' '), /raw\/graded mismatch|similarity/i);
});

test('rejected comparable quality creates comp blocker even when similarity is strong', () => {
  const result = decisionIntelligenceEngine.evaluateDecisionIntelligence(buildInput({
    comparableQuality: {
      scoredComparableCount: 3,
      averageComparableQualityScore: 46,
      qualityDistribution: { excellent: 0, good: 0, usable: 1, weak: 1, reject: 1 },
      summary: 'Comparable quality includes rejected or identity-failed comps and should be reviewed.'
    }
  }));

  assert.equal(result.overallReadiness, 'not_ready');
  assert.equal(result.compPosture, 'rejected');
  assert.ok(result.blockers.some((item) => item.source === 'comparable_quality'));
  assert.ok(result.conflicts.some((item) => item.source === 'similarity_vs_quality'));
});

test('usable valuation with high supply pressure creates caution conflict only', () => {
  const result = decisionIntelligenceEngine.evaluateDecisionIntelligence(buildInput({
    supplyPressure: {
      pressureLevel: 'high',
      undercutRiskLevel: 'high',
      resaleBlockerRisk: 'high',
      summary: 'Supply pressure appears high and may require aggressive resale pricing.'
    }
  }));

  assert.equal(result.overallReadiness, 'cautious_context');
  assert.equal(result.resalePressurePosture, 'high');
  assert.equal(result.blockers.length, 0);
  assert.ok(result.cautionSignals.some((item) => item.source === 'supply_pressure'));
  assert.ok(result.conflicts.some((item) => item.source === 'valuation_vs_supply'));
});

test('unreliable valuation range creates blocker even when supply pressure is low', () => {
  const result = decisionIntelligenceEngine.evaluateDecisionIntelligence(buildInput({
    valuationRange: {
      floorValue: 0,
      expectedValue: 0,
      ceilingValue: 0,
      rangeQuality: 'unreliable',
      summary: 'Valuation range is unreliable because true sold support is missing or insufficient.'
    }
  }));

  assert.equal(result.overallReadiness, 'not_ready');
  assert.equal(result.valuationPosture, 'unreliable_range');
  assert.ok(result.blockers.some((item) => item.source === 'valuation_range'));
  assert.ok(result.conflicts.some((item) => item.source === 'supply_vs_valuation'));
});

test('thin evidence and thin valuation return limited context without changing recommendations', () => {
  const result = decisionIntelligenceEngine.evaluateDecisionIntelligence(buildInput({
    evidenceSufficiency: {
      sufficientForValuation: true,
      sufficiencyLevel: 'limited',
      evidenceSufficiencyScore: 52,
      summary: 'Evidence sufficiency is limited and should remain informational.'
    },
    valuationRange: {
      rangeQuality: 'thin',
      expectedValue: 105,
      summary: 'Valuation range is thin because sold evidence is limited; use the floor more than the ceiling.'
    }
  }));

  assert.equal(result.overallReadiness, 'limited_context');
  assert.equal(result.evidencePosture, 'thin');
  assert.equal(result.valuationPosture, 'thin_range');
  assert.equal(result.recommendationImpact, 'none');
});

test('empty input returns safe not-ready explanation-only output', () => {
  const result = decisionIntelligenceEngine.evaluateDecisionIntelligence();

  assert.equal(result.recommendationImpact, 'none');
  assert.equal(result.overallReadiness, 'not_ready');
  assert.equal(result.evidencePosture, 'unknown');
  assert.equal(result.compPosture, 'unknown');
  assert.equal(result.valuationPosture, 'unreliable_range');
  assert.ok(result.blockers.some((item) => item.source === 'valuation_range'));
});

test('decision intelligence never emits forbidden recommendation labels', () => {
  const result = decisionIntelligenceEngine.evaluateDecisionIntelligence(buildInput({
    supplyPressure: {
      pressureLevel: 'severe',
      undercutRiskLevel: 'severe',
      resaleBlockerRisk: 'high',
      summary: 'Supply pressure appears severe, with active inventory likely to block resale.'
    }
  }));
  const text = serialized(result);

  assert.equal(text.includes('BUY_NOW'), false);
  assert.equal(text.includes('PASS'), false);
});

test('evaluateDecisionIntelligence does not mutate inputs', () => {
  const input = buildInput();
  const before = JSON.stringify(input);

  decisionIntelligenceEngine.evaluateDecisionIntelligence(input);

  assert.equal(JSON.stringify(input), before);
});
