'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const evidenceSufficiencyEngine = require('../engines/evidenceSufficiencyEngine');

function buildInput(overrides = {}) {
  return {
    evidenceSummary: {
      evidenceCount: 0,
      trueSoldCount: 0,
      activeCount: 0,
      fallbackUnknownCount: 0,
      medianSold: 0,
      weightedSoldAverage: 0,
      activeMedianAsk: 0,
      priceSpread: 0,
      volatility: 0,
      evidenceQualityScore: 0,
      activeOnlyFlag: false,
      fallbackOnlyFlag: false,
      normalizedEvidence: [],
      ...(overrides.evidenceSummary || {})
    },
    comparableQuality: {
      source: 'comparable_quality_engine',
      comparableCount: 0,
      scoredComparableCount: 0,
      averageComparableQualityScore: 0,
      qualityDistribution: {
        excellent: 0,
        good: 0,
        usable: 0,
        weak: 0,
        reject: 0
      },
      scoredComps: [],
      warnings: [],
      ...(overrides.comparableQuality || {})
    }
  };
}

test('empty evidence returns safe unreliable output', () => {
  const result = evidenceSufficiencyEngine.evaluateEvidenceSufficiency(buildInput());

  assert.equal(result.source, 'evidence_sufficiency_engine');
  assert.equal(result.version, '1.1');
  assert.equal(result.sufficientForValuation, false);
  assert.equal(result.sufficiencyLevel, 'unreliable');
  assert.ok(result.evidenceSufficiencyScore <= 20);
  assert.match(result.blockingConcerns.join(' '), /No true sold evidence/);
  assert.ok(result.summary);
});

test('active-only evidence is not sufficient for valuation trust', () => {
  const result = evidenceSufficiencyEngine.evaluateEvidenceSufficiency(buildInput({
    evidenceSummary: {
      evidenceCount: 2,
      trueSoldCount: 0,
      activeCount: 2,
      activeMedianAsk: 110,
      activeOnlyFlag: true,
      normalizedEvidence: [
        { evidenceType: 'active', price: 100, ageDays: 2 },
        { evidenceType: 'active', price: 120, ageDays: 3 }
      ]
    },
    comparableQuality: {
      comparableCount: 2,
      scoredComparableCount: 2,
      averageComparableQualityScore: 62,
      qualityDistribution: { excellent: 0, good: 0, usable: 2, weak: 0, reject: 0 }
    }
  }));

  assert.equal(result.sufficientForValuation, false);
  assert.ok(result.evidenceSufficiencyScore <= 18);
  assert.equal(result.checks.soldEvidence.activeOnlyFlag, true);
  assert.equal(result.checks.fallbackRisk.activeOnlyFlag, true);
  assert.match(result.blockingConcerns.join(' '), /active-only/i);
  assert.match(result.warnings.join(' '), /Active-only evidence cannot establish/);
});

test('fallback-only evidence is clearly flagged as unreliable', () => {
  const result = evidenceSufficiencyEngine.evaluateEvidenceSufficiency(buildInput({
    evidenceSummary: {
      evidenceCount: 2,
      trueSoldCount: 0,
      fallbackUnknownCount: 2,
      fallbackOnlyFlag: true,
      normalizedEvidence: [
        { evidenceType: 'fallback_unknown', price: 90 },
        { evidenceType: 'fallback_unknown', price: 110 }
      ]
    },
    comparableQuality: {
      comparableCount: 2,
      scoredComparableCount: 2,
      averageComparableQualityScore: 42,
      qualityDistribution: { excellent: 0, good: 0, usable: 0, weak: 2, reject: 0 }
    }
  }));

  assert.equal(result.sufficientForValuation, false);
  assert.ok(result.evidenceSufficiencyScore <= 18);
  assert.equal(result.checks.soldEvidence.fallbackOnlyFlag, true);
  assert.equal(result.checks.fallbackRisk.fallbackOnlyFlag, true);
  assert.match(result.blockingConcerns.join(' '), /fallback-only/i);
});

test('low true-sold sample remains limited and below sufficiency', () => {
  const result = evidenceSufficiencyEngine.evaluateEvidenceSufficiency(buildInput({
    evidenceSummary: {
      evidenceCount: 2,
      trueSoldCount: 2,
      medianSold: 100,
      weightedSoldAverage: 101,
      priceSpread: 0.18,
      volatility: 0.09,
      normalizedEvidence: [
        { evidenceType: 'true_sold', price: 98, ageDays: 14 },
        { evidenceType: 'true_sold', price: 102, ageDays: 24 }
      ]
    },
    comparableQuality: {
      comparableCount: 2,
      scoredComparableCount: 2,
      averageComparableQualityScore: 82,
      qualityDistribution: { excellent: 1, good: 1, usable: 0, weak: 0, reject: 0 }
    }
  }));

  assert.equal(result.sufficientForValuation, false);
  assert.equal(result.sufficiencyLevel, 'insufficient');
  assert.ok(result.evidenceSufficiencyScore <= 44);
  assert.match(result.blockingConcerns.join(' '), /below the suggested minimum/);
});

test('strong evidence scenario returns adequate or strong sufficiency', () => {
  const result = evidenceSufficiencyEngine.evaluateEvidenceSufficiency(buildInput({
    evidenceSummary: {
      evidenceCount: 5,
      trueSoldCount: 5,
      activeCount: 1,
      medianSold: 100,
      weightedSoldAverage: 101,
      activeMedianAsk: 118,
      priceSpread: 0.22,
      volatility: 0.08,
      evidenceQualityScore: 88,
      normalizedEvidence: [
        { evidenceType: 'true_sold', price: 92, ageDays: 10 },
        { evidenceType: 'true_sold', price: 98, ageDays: 20 },
        { evidenceType: 'true_sold', price: 100, ageDays: 31 },
        { evidenceType: 'true_sold', price: 104, ageDays: 45 },
        { evidenceType: 'true_sold', price: 110, ageDays: 70 },
        { evidenceType: 'active', price: 118, ageDays: 2 }
      ]
    },
    comparableQuality: {
      comparableCount: 6,
      scoredComparableCount: 6,
      averageComparableQualityScore: 86,
      qualityDistribution: { excellent: 4, good: 2, usable: 0, weak: 0, reject: 0 }
    }
  }));

  assert.equal(result.sufficientForValuation, true);
  assert.ok(['adequate', 'strong'].includes(result.sufficiencyLevel));
  assert.ok(result.evidenceSufficiencyScore >= 68);
  assert.match(result.positives.join(' '), /True sold evidence meets/);
});

test('weak and rejected comparable quality lowers sufficiency', () => {
  const result = evidenceSufficiencyEngine.evaluateEvidenceSufficiency(buildInput({
    evidenceSummary: {
      evidenceCount: 4,
      trueSoldCount: 4,
      medianSold: 100,
      weightedSoldAverage: 100,
      priceSpread: 0.2,
      volatility: 0.08,
      normalizedEvidence: [
        { evidenceType: 'true_sold', price: 95, ageDays: 12 },
        { evidenceType: 'true_sold', price: 98, ageDays: 18 },
        { evidenceType: 'true_sold', price: 102, ageDays: 24 },
        { evidenceType: 'true_sold', price: 105, ageDays: 30 }
      ]
    },
    comparableQuality: {
      comparableCount: 4,
      scoredComparableCount: 4,
      averageComparableQualityScore: 51,
      qualityDistribution: { excellent: 0, good: 0, usable: 1, weak: 2, reject: 1 },
      warnings: ['Comparable was rejected by identity gates.']
    }
  }));

  assert.equal(result.sufficientForValuation, false);
  assert.ok(result.evidenceSufficiencyScore <= 64);
  assert.equal(result.checks.comparableQuality.rejectCount, 1);
  assert.match(result.blockingConcerns.join(' '), /rejected comps/);
});

test('high spread and volatility create price consistency warnings', () => {
  const result = evidenceSufficiencyEngine.evaluateEvidenceSufficiency(buildInput({
    evidenceSummary: {
      evidenceCount: 4,
      trueSoldCount: 4,
      medianSold: 100,
      weightedSoldAverage: 120,
      priceSpread: 1.35,
      volatility: 0.82,
      normalizedEvidence: [
        { evidenceType: 'true_sold', price: 40, ageDays: 10 },
        { evidenceType: 'true_sold', price: 80, ageDays: 20 },
        { evidenceType: 'true_sold', price: 140, ageDays: 30 },
        { evidenceType: 'true_sold', price: 180, ageDays: 40 }
      ]
    },
    comparableQuality: {
      comparableCount: 4,
      scoredComparableCount: 4,
      averageComparableQualityScore: 82,
      qualityDistribution: { excellent: 2, good: 2, usable: 0, weak: 0, reject: 0 }
    }
  }));

  assert.ok(['insufficient', 'unreliable'].includes(result.checks.priceConsistency.status));
  assert.match(result.warnings.join(' '), /spread is wide/);
  assert.match(result.warnings.join(' '), /volatility is high/);
});

test('stale comps create recency warnings', () => {
  const result = evidenceSufficiencyEngine.evaluateEvidenceSufficiency(buildInput({
    evidenceSummary: {
      evidenceCount: 3,
      trueSoldCount: 3,
      medianSold: 100,
      weightedSoldAverage: 100,
      priceSpread: 0.15,
      volatility: 0.05,
      normalizedEvidence: [
        { evidenceType: 'true_sold', price: 98, ageDays: 190 },
        { evidenceType: 'true_sold', price: 100, ageDays: 220 },
        { evidenceType: 'true_sold', price: 102, ageDays: 260 }
      ]
    },
    comparableQuality: {
      comparableCount: 3,
      scoredComparableCount: 3,
      averageComparableQualityScore: 78,
      qualityDistribution: { excellent: 0, good: 3, usable: 0, weak: 0, reject: 0 }
    }
  }));

  assert.equal(result.checks.recency.status, 'insufficient');
  assert.equal(result.checks.recency.freshSoldCount, 0);
  assert.equal(result.checks.recency.staleSoldCount, 3);
  assert.match(result.warnings.join(' '), /stale/);
});

test('engine does not mutate input objects', () => {
  const input = buildInput({
    evidenceSummary: {
      evidenceCount: 3,
      trueSoldCount: 3,
      normalizedEvidence: Object.freeze([
        Object.freeze({ evidenceType: 'true_sold', price: 100, ageDays: 20 }),
        Object.freeze({ evidenceType: 'true_sold', price: 102, ageDays: 22 }),
        Object.freeze({ evidenceType: 'true_sold', price: 98, ageDays: 24 })
      ])
    },
    comparableQuality: {
      comparableCount: 3,
      scoredComparableCount: 3,
      averageComparableQualityScore: 80,
      qualityDistribution: Object.freeze({ excellent: 1, good: 2, usable: 0, weak: 0, reject: 0 })
    }
  });
  Object.freeze(input.evidenceSummary);
  Object.freeze(input.comparableQuality);
  Object.freeze(input);
  const before = JSON.stringify(input);

  evidenceSufficiencyEngine.evaluateEvidenceSufficiency(input);

  assert.equal(JSON.stringify(input), before);
});

test('exports public evidence sufficiency functions', () => {
  assert.equal(typeof evidenceSufficiencyEngine.evaluateEvidenceSufficiency, 'function');
  assert.equal(typeof evidenceSufficiencyEngine.scoreEvidenceSufficiency, 'function');
  assert.equal(typeof evidenceSufficiencyEngine.summarizeEvidenceSufficiency, 'function');
});
