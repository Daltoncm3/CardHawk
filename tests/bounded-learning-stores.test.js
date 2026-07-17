'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const NODE_ENV_KEYS = [
  'CARDHAWK_PREDICTION_ACCURACY_STATE_FILE',
  'CARDHAWK_DECISION_VALIDATION_STATE_FILE',
  'CARDHAWK_MAX_TRACKED_PREDICTIONS',
  'CARDHAWK_MAX_PREDICTION_OUTCOME_HISTORY',
  'CARDHAWK_MAX_OUTCOMES_PER_PREDICTION',
  'CARDHAWK_MAX_TRACKED_DECISIONS',
  'CARDHAWK_MAX_DECISION_HISTORY',
  'CARDHAWK_MAX_DECISION_OUTCOME_HISTORY',
  'CARDHAWK_MAX_SNAPSHOTS_PER_DECISION',
  'CARDHAWK_MAX_OUTCOMES_PER_DECISION',
  'CARDHAWK_MAX_TRACKED_LEARNING_RECORDS',
  'CARDHAWK_MAX_LEARNING_HISTORY_LENGTH',
  'CARDHAWK_MAX_LEARNING_RECENT_EVENTS'
];

const ENGINE_MODULES = [
  '../engines/predictionAccuracyEngine',
  '../engines/decisionValidationEngine',
  '../engines/learningEngine'
];

function withEnv(overrides, callback) {
  const previous = {};
  for (const key of NODE_ENV_KEYS) {
    previous[key] = process.env[key];
    if (overrides[key] === undefined) delete process.env[key];
    else process.env[key] = String(overrides[key]);
  }

  try {
    return callback();
  } finally {
    for (const key of NODE_ENV_KEYS) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    for (const modulePath of ENGINE_MODULES) {
      delete require.cache[require.resolve(modulePath)];
    }
  }
}

function freshRequire(modulePath) {
  delete require.cache[require.resolve(modulePath)];
  return require(modulePath);
}

function tempFile(name) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cardhawk-bounded-learning-'));
  return path.join(directory, name);
}

function predictionInput(index) {
  return {
    predictionId: `prediction-${index}`,
    listingId: `listing-${index}`,
    title: `Prediction ${index}`,
    recommendation: index % 2 ? 'BUY_NOW' : 'PASS',
    decisionConfidence: 70 + index,
    projectedROI: index,
    projectedProfit: index * 2,
    expectedValue: 100 + index,
    listingCost: 50,
    createdAt: `2026-07-0${index}T00:00:00.000Z`
  };
}

function decisionInput(index, overrides = {}) {
  return {
    listingId: `decision-listing-${index}`,
    title: `Decision ${index}`,
    decision: index % 2 ? 'BUY_NOW' : 'PASS',
    decisionScore: 60 + index,
    decisionConfidence: 70 + index,
    expectedValue: 100 + index,
    listingCost: 50,
    projectedROI: index,
    projectedProfit: index * 3,
    timestamp: `2026-07-0${index}T00:00:00.000Z`,
    ...overrides
  };
}

function learningInput(index, overrides = {}) {
  return {
    listing: {
      ebayItemId: `learning-listing-${index}`,
      title: `Learning ${index}`,
      price: 20 + index
    },
    parsed: {
      player: 'Test Player',
      year: 2026
    },
    scoring: {
      decision: index % 2 ? 'buy' : 'pass',
      score: 50 + index,
      estimatedValue: 100 + index,
      estimatedProfit: index,
      roi: index,
      marketConfidence: 70 + index
    },
    observedAt: `2026-07-0${index}T00:00:00.000Z`,
    predictionId: `learning-prediction-${index}`,
    ...overrides
  };
}

test('prediction accuracy retention caps records, outcomes, and reloads bounded state', () => {
  const statePath = tempFile('predictionAccuracy.json');

  withEnv({
    CARDHAWK_PREDICTION_ACCURACY_STATE_FILE: statePath,
    CARDHAWK_MAX_TRACKED_PREDICTIONS: 3,
    CARDHAWK_MAX_PREDICTION_OUTCOME_HISTORY: 4,
    CARDHAWK_MAX_OUTCOMES_PER_PREDICTION: 2
  }, () => {
    const engine = freshRequire('../engines/predictionAccuracyEngine');

    for (let index = 1; index <= 5; index += 1) {
      assert.equal(engine.recordPrediction(predictionInput(index)).ok, true);
    }

    assert.equal(engine.getPrediction('prediction-1'), null);
    assert.equal(engine.getPrediction('prediction-2'), null);
    assert.equal(engine.getPrediction('prediction-3').predictionId, 'prediction-3');
    assert.deepEqual(
      engine.getRecentPredictions(10).map((record) => record.predictionId),
      ['prediction-5', 'prediction-4', 'prediction-3']
    );

    for (let index = 1; index <= 3; index += 1) {
      engine.recordOutcome('prediction-5', {
        outcomeType: 'sold',
        realizedSalePrice: 110 + index,
        outcomeAt: `2026-07-1${index}T00:00:00.000Z`
      });
    }

    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    const retained = state.predictionHistory.find((record) => record.predictionId === 'prediction-5');
    assert.equal(state.predictionHistory.length, 3);
    assert.equal(retained.outcomes.length, 2);
    assert.equal(retained.latestOutcome.realizedSalePrice, 113);
    assert.equal(state.retentionPolicy.maxTrackedPredictions, 3);

    const reloaded = freshRequire('../engines/predictionAccuracyEngine');
    assert.equal(reloaded.getPrediction('prediction-2'), null);
    assert.equal(reloaded.getPrediction('prediction-5').latestOutcome.realizedSalePrice, 113);
    assert.deepEqual(
      reloaded.getRecentPredictions(10).map((record) => record.predictionId),
      ['prediction-5', 'prediction-4', 'prediction-3']
    );
  });
});

test('decision validation retention caps records, histories, snapshots, and reloads bounded state', () => {
  const statePath = tempFile('decisionValidation.json');

  withEnv({
    CARDHAWK_DECISION_VALIDATION_STATE_FILE: statePath,
    CARDHAWK_MAX_TRACKED_DECISIONS: 2,
    CARDHAWK_MAX_DECISION_HISTORY: 3,
    CARDHAWK_MAX_DECISION_OUTCOME_HISTORY: 3,
    CARDHAWK_MAX_SNAPSHOTS_PER_DECISION: 2,
    CARDHAWK_MAX_OUTCOMES_PER_DECISION: 2
  }, () => {
    const engine = freshRequire('../engines/decisionValidationEngine');

    for (let index = 1; index <= 3; index += 1) {
      assert.equal(engine.recordDecision(decisionInput(index)).ok, true);
    }

    assert.equal(engine.getDecisionRecord('decision-listing-1'), null);
    assert.equal(engine.getDecisionRecord('decision-listing-2').listingId, 'decision-listing-2');

    engine.recordDecision(decisionInput(3, { timestamp: '2026-07-04T00:00:00.000Z', decisionScore: 91 }));
    engine.recordDecision(decisionInput(3, { timestamp: '2026-07-05T00:00:00.000Z', decisionScore: 92 }));

    for (let index = 1; index <= 3; index += 1) {
      engine.recordOutcome('decision-listing-3', {
        outcomeType: 'sold',
        realizedSalePrice: 120 + index,
        outcomeAt: `2026-07-1${index}T00:00:00.000Z`
      });
    }

    const record = engine.getDecisionRecord('decision-listing-3');
    assert.equal(record.decisionSnapshots.length, 2);
    assert.equal(record.outcomeHistory.length, 2);
    assert.equal(record.outcome.realizedSalePrice, 123);

    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    assert.equal(state.records.length, 2);
    assert.equal(state.decisionHistory.length, 3);
    assert.equal(state.outcomeHistory.length, 3);
    assert.equal(state.retentionPolicy.maxTrackedDecisions, 2);

    const reloaded = freshRequire('../engines/decisionValidationEngine');
    assert.equal(reloaded.getDecisionRecord('decision-listing-1'), null);
    assert.equal(reloaded.getDecisionRecord('decision-listing-3').outcome.realizedSalePrice, 123);
    assert.deepEqual(
      reloaded.getRecentDecisions(10).map((decision) => decision.listingId),
      ['decision-listing-3', 'decision-listing-3', 'decision-listing-3']
    );
  });
});

test('learning engine retention caps tracked records, per-record history, and recent events deterministically', () => {
  withEnv({
    CARDHAWK_MAX_TRACKED_LEARNING_RECORDS: 2,
    CARDHAWK_MAX_LEARNING_HISTORY_LENGTH: 2,
    CARDHAWK_MAX_LEARNING_RECENT_EVENTS: 3
  }, () => {
    const engine = freshRequire('../engines/learningEngine');

    for (let index = 1; index <= 4; index += 1) {
      assert.equal(engine.recordPrediction(learningInput(index)).ok, true);
    }

    assert.equal(engine.getLearningRecord('learning-listing-1'), null);
    assert.equal(engine.getLearningRecord('learning-listing-2'), null);
    assert.equal(engine.getLearningRecord('learning-listing-3').ebayItemId, 'learning-listing-3');
    assert.equal(engine.getLearningRecord('learning-listing-4').ebayItemId, 'learning-listing-4');
    assert.deepEqual(
      engine.getRecentPredictions(10).map((event) => event.ebayItemId),
      ['learning-listing-4', 'learning-listing-3', 'learning-listing-2']
    );

    engine.recordPrediction(learningInput(4, {
      observedAt: '2026-07-05T00:00:00.000Z',
      predictionId: 'learning-prediction-4b',
      listing: { ebayItemId: 'learning-listing-4', title: 'Learning 4', price: 40 }
    }));
    engine.recordPrediction(learningInput(4, {
      observedAt: '2026-07-06T00:00:00.000Z',
      predictionId: 'learning-prediction-4c',
      listing: { ebayItemId: 'learning-listing-4', title: 'Learning 4', price: 42 }
    }));

    const retained = engine.getLearningRecord('learning-listing-4');
    assert.equal(retained.predictionSnapshots.length, 2);
    assert.equal(retained.priceHistory.length, 2);
    assert.equal(retained.priceHistory[0].value, 40);
    assert.equal(retained.priceHistory[1].value, 42);

    const summary = engine.summarizeLearning();
    assert.equal(summary.totalTrackedPredictions, 2);
    assert.equal(summary.recentPredictionCount, 3);
  });
});

test('bounded retention helper keeps newest entries and prunes maps oldest-first with stable ties', () => {
  const {
    pruneMapByOldest,
    trimArrayToMax
  } = require('../utils/boundedRetention');

  assert.deepEqual(trimArrayToMax([1, 2, 3, 4], 2), [3, 4]);

  const records = new Map([
    ['b', { id: 'b', lastSeenAt: '2026-07-01T00:00:00.000Z' }],
    ['a', { id: 'a', lastSeenAt: '2026-07-01T00:00:00.000Z' }],
    ['c', { id: 'c', lastSeenAt: '2026-07-02T00:00:00.000Z' }]
  ]);
  const removed = pruneMapByOldest(records, 1, {
    timeKeys: ['lastSeenAt'],
    idKeys: ['id']
  });

  assert.deepEqual(removed.map((record) => record.id), ['a', 'b']);
  assert.deepEqual(Array.from(records.keys()), ['c']);
});
