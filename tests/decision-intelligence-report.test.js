'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  calculateValidationMetrics,
  evaluateAllFixtures,
  formatValidationSummary
} = require('./helpers/decisionIntelligenceValidation');

test('decision intelligence validation report summarizes benchmark fixtures', () => {
  const results = evaluateAllFixtures();
  const metrics = calculateValidationMetrics(results);

  console.log(formatValidationSummary(metrics));

  assert.equal(metrics.totalFixtures, results.length);
  assert.ok(metrics.totalFixtures >= 27, 'Expected full Decision Intelligence validation fixture corpus.');
  assert.equal(metrics.failCount, 0);
  assert.equal(metrics.passCount, metrics.totalFixtures);
  assert.ok(metrics.averageExplanationScore > 0);
  assert.equal(metrics.falsePositiveCount, 0);
  assert.equal(metrics.falseNegativeCount, 0);
  assert.equal(metrics.blockerDetectionAccuracy, 100);
  assert.equal(metrics.cautionDetectionAccuracy, 100);
  assert.equal(metrics.supportingSignalAccuracy, 100);
  assert.ok(Object.keys(metrics.overallReadinessDistribution).length > 0);
  assert.ok(Object.keys(metrics.evidencePostureDistribution).length > 0);
  assert.ok(Object.keys(metrics.compPostureDistribution).length > 0);
  assert.ok(Object.keys(metrics.valuationPostureDistribution).length > 0);
  assert.ok(Object.keys(metrics.resalePressurePostureDistribution).length > 0);
});
