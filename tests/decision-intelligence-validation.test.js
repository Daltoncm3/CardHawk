'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const decisionIntelligenceEngine = require('../engines/decisionIntelligenceEngine');

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'decision-intelligence');
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

function getFixtureFiles() {
  return fs.readdirSync(FIXTURE_DIR)
    .filter((fileName) => fileName.endsWith('.json'))
    .sort()
    .map((fileName) => path.join(FIXTURE_DIR, fileName));
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

function collectSources(items) {
  return Array.from(new Set(items.map((item) => item.source))).sort();
}

function collectMessages(items) {
  return items.map((item) => item.message).join(' ');
}

function formatMismatch(fixture, field, expected, actual) {
  return [
    `Decision Intelligence validation mismatch for fixture "${fixture.id}" (${fixture.description})`,
    `field: ${field}`,
    `expected: ${JSON.stringify(expected)}`,
    `actual: ${JSON.stringify(actual)}`
  ].join('\n');
}

function assertPostures(fixture, actual) {
  for (const field of POSTURE_FIELDS) {
    assert.equal(
      actual[field],
      fixture.decisionIntelligence[field],
      formatMismatch(fixture, field, fixture.decisionIntelligence[field], actual[field])
    );
  }
}

function assertExpectedSources(fixture, field, actualItems, expectedSources = []) {
  assert.deepEqual(
    collectSources(actualItems),
    [...expectedSources].sort(),
    formatMismatch(fixture, field, expectedSources, actualItems)
  );
}

function assertExpectedMessages(fixture, field, actualItems, expectedSnippets = []) {
  const messages = collectMessages(actualItems);

  for (const snippet of expectedSnippets) {
    assert.match(
      messages,
      new RegExp(snippet, 'i'),
      formatMismatch(fixture, field, snippet, messages)
    );
  }
}

function validateDecisionIntelligenceFixture(fixture) {
  const actual = decisionIntelligenceEngine.evaluateDecisionIntelligence(getDecisionInput(fixture));
  const expected = fixture.expected || {};

  assertPostures(fixture, actual);
  assert.equal(
    actual.mode,
    'explanation_only',
    formatMismatch(fixture, 'mode', 'explanation_only', actual.mode)
  );
  assert.equal(
    actual.recommendationImpact,
    'none',
    formatMismatch(fixture, 'recommendationImpact', 'none', actual.recommendationImpact)
  );
  assert.ok(
    actual.supportingSignals.length >= (expected.minimumSupportingSignals || 0),
    formatMismatch(
      fixture,
      'supportingSignals.length',
      `>= ${expected.minimumSupportingSignals || 0}`,
      actual.supportingSignals.length
    )
  );
  assertExpectedSources(fixture, 'blockers', actual.blockers, expected.blockerSources || []);
  assertExpectedSources(fixture, 'conflicts', actual.conflicts, expected.conflictSources || []);
  assertExpectedMessages(fixture, 'blocker messages', actual.blockers, expected.blockerMessageIncludes || []);
  assert.ok(
    actual.summary,
    formatMismatch(fixture, 'summary', 'non-empty summary', actual.summary)
  );

  return actual;
}

test('decision intelligence validation fixtures are present', () => {
  const files = getFixtureFiles();

  assert.ok(files.length >= 1, 'Expected at least one Decision Intelligence validation fixture.');
});

for (const filePath of getFixtureFiles()) {
  const fixture = readFixture(filePath);

  test(`decision intelligence validation fixture: ${fixture.id}`, () => {
    validateDecisionIntelligenceFixture(fixture);
  });
}

test('decision intelligence validation fixtures do not mutate inputs', () => {
  for (const filePath of getFixtureFiles()) {
    const fixture = readFixture(filePath);
    const before = JSON.stringify(fixture);

    validateDecisionIntelligenceFixture(fixture);

    assert.equal(
      JSON.stringify(fixture),
      before,
      `Validation mutated fixture ${fixture.id}`
    );
  }
});
