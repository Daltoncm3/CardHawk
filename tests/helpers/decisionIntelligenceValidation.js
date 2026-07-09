'use strict';

const fs = require('node:fs');
const path = require('node:path');

const decisionIntelligenceEngine = require('../../engines/decisionIntelligenceEngine');

const FIXTURE_DIR = path.join(__dirname, '..', 'fixtures', 'decision-intelligence');
const POSTURE_FIELDS = [
  'overallReadiness',
  'evidencePosture',
  'compPosture',
  'valuationPosture',
  'resalePressurePosture',
  'recommendationImpact'
];

function readFixture(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function walkJsonFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return walkJsonFiles(entryPath);
    if (entry.isFile() && entry.name.endsWith('.json')) return [entryPath];
    return [];
  });
}

function getFixtureFiles() {
  return walkJsonFiles(FIXTURE_DIR).sort();
}

function getDecisionInput(fixture) {
  return {
    evidenceSufficiency: fixture.evidenceSufficiency,
    listingSimilarity: fixture.listingSimilarity,
    comparableQuality: fixture.comparableQuality,
    valuationRange: fixture.valuationRange,
    supplyPressure: fixture.supplyPressure
  };
}

function collectSources(items = []) {
  return Array.from(new Set(items.map((item) => item.source))).sort();
}

function sameSources(actualItems, expectedSources = []) {
  return JSON.stringify(collectSources(actualItems)) === JSON.stringify([...expectedSources].sort());
}

function getDistribution(results, field) {
  return results.reduce((distribution, item) => {
    const value = item.actual[field] || 'unknown';
    distribution[value] = (distribution[value] || 0) + 1;
    return distribution;
  }, {});
}

function evaluateFixture(fixture, filePath = '') {
  const actual = decisionIntelligenceEngine.evaluateDecisionIntelligence(getDecisionInput(fixture));
  const expected = fixture.expected || {};
  const expectedDecision = fixture.decisionIntelligence || {};
  const postureMismatches = POSTURE_FIELDS
    .filter((field) => actual[field] !== expectedDecision[field])
    .map((field) => ({
      field,
      expected: expectedDecision[field],
      actual: actual[field]
    }));

  const blockerPass = sameSources(actual.blockers, expected.blockerSources || []);
  const cautionPass = expected.cautionSignalSources
    ? sameSources(actual.cautionSignals, expected.cautionSignalSources)
    : true;
  const supportPass = expected.supportingSignalSources
    ? sameSources(actual.supportingSignals, expected.supportingSignalSources)
    : actual.supportingSignals.length >= (expected.minimumSupportingSignals || 0);
  const conflictPass = sameSources(actual.conflicts, expected.conflictSources || []);
  const pass = postureMismatches.length === 0 &&
    blockerPass &&
    cautionPass &&
    supportPass &&
    conflictPass &&
    actual.mode === 'explanation_only' &&
    actual.recommendationImpact === 'none';

  return {
    filePath,
    fixture,
    actual,
    pass,
    postureMismatches,
    checks: {
      blockerPass,
      cautionPass,
      supportPass,
      conflictPass
    }
  };
}

function evaluateAllFixtures() {
  return getFixtureFiles().map((filePath) => evaluateFixture(readFixture(filePath), filePath));
}

function percent(count, total) {
  if (!total) return 0;
  return Number(((count / total) * 100).toFixed(1));
}

function calculateValidationMetrics(results = []) {
  const totalFixtures = results.length;
  const passCount = results.filter((result) => result.pass).length;
  const failCount = totalFixtures - passCount;
  const scoredFixtures = results
    .map((result) => result.fixture.explanationScore)
    .filter((score) => Number.isFinite(score));
  const averageExplanationScore = scoredFixtures.length
    ? Number((scoredFixtures.reduce((sum, score) => sum + score, 0) / scoredFixtures.length).toFixed(2))
    : 0;

  return {
    totalFixtures,
    passCount,
    failCount,
    averageExplanationScore,
    falsePositiveCount: results.filter((result) => result.fixture.falsePositive === true).length,
    falseNegativeCount: results.filter((result) => result.fixture.falseNegative === true).length,
    blockerDetectionAccuracy: percent(results.filter((result) => result.checks.blockerPass).length, totalFixtures),
    cautionDetectionAccuracy: percent(results.filter((result) => result.checks.cautionPass).length, totalFixtures),
    supportingSignalAccuracy: percent(results.filter((result) => result.checks.supportPass).length, totalFixtures),
    overallReadinessDistribution: getDistribution(results, 'overallReadiness'),
    evidencePostureDistribution: getDistribution(results, 'evidencePosture'),
    compPostureDistribution: getDistribution(results, 'compPosture'),
    valuationPostureDistribution: getDistribution(results, 'valuationPosture'),
    resalePressurePostureDistribution: getDistribution(results, 'resalePressurePosture')
  };
}

function formatValidationSummary(metrics = {}) {
  return [
    'Decision Intelligence validation summary',
    `fixtures=${metrics.totalFixtures}`,
    `pass=${metrics.passCount}`,
    `fail=${metrics.failCount}`,
    `avgExplanationScore=${metrics.averageExplanationScore}`,
    `falsePositives=${metrics.falsePositiveCount}`,
    `falseNegatives=${metrics.falseNegativeCount}`,
    `blockerAccuracy=${metrics.blockerDetectionAccuracy}%`,
    `cautionAccuracy=${metrics.cautionDetectionAccuracy}%`,
    `supportAccuracy=${metrics.supportingSignalAccuracy}%`,
    `readiness=${JSON.stringify(metrics.overallReadinessDistribution)}`,
    `evidence=${JSON.stringify(metrics.evidencePostureDistribution)}`,
    `comp=${JSON.stringify(metrics.compPostureDistribution)}`,
    `valuation=${JSON.stringify(metrics.valuationPostureDistribution)}`,
    `resalePressure=${JSON.stringify(metrics.resalePressurePostureDistribution)}`
  ].join('\n');
}

module.exports = {
  calculateValidationMetrics,
  collectSources,
  evaluateAllFixtures,
  evaluateFixture,
  formatValidationSummary,
  getDecisionInput,
  getFixtureFiles,
  readFixture
};
