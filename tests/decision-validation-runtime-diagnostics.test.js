'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createScoutScanner } = require('../services/scoutScannerService');
const serializationInstrumentation = require('../utils/serializationInstrumentation');
const stateStore = require('../utils/stateStore');

const DECISION_ENV_KEYS = [
  'CARDHAWK_DECISION_VALIDATION_STATE_FILE',
  'CARDHAWK_MAX_TRACKED_DECISIONS',
  'CARDHAWK_MAX_DECISION_HISTORY',
  'CARDHAWK_MAX_DECISION_OUTCOME_HISTORY',
  'CARDHAWK_MAX_SNAPSHOTS_PER_DECISION',
  'CARDHAWK_MAX_OUTCOMES_PER_DECISION'
];

function tempFile(name) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cardhawk-decision-validation-diagnostics-'));
  return path.join(directory, name);
}

function withDecisionEnv(overrides, callback) {
  const previous = {};
  for (const key of DECISION_ENV_KEYS) {
    previous[key] = process.env[key];
    if (overrides[key] === undefined) delete process.env[key];
    else process.env[key] = String(overrides[key]);
  }

  const restore = () => {
    for (const key of DECISION_ENV_KEYS) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    delete require.cache[require.resolve('../engines/decisionValidationEngine')];
  };

  try {
    const result = callback();
    if (result && typeof result.then === 'function') {
      return result.finally(restore);
    }
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
  }
}

function requireFreshDecisionValidationEngine() {
  delete require.cache[require.resolve('../engines/decisionValidationEngine')];
  return require('../engines/decisionValidationEngine');
}

test('DecisionValidation diagnostics count immediate persistence outside scanner batch', () => {
  const statePath = tempFile('decisionValidation-immediate.json');

  withDecisionEnv({
    CARDHAWK_DECISION_VALIDATION_STATE_FILE: statePath
  }, () => {
    const decisionValidationEngine = requireFreshDecisionValidationEngine();

    serializationInstrumentation.resetSerializationInstrumentation();
    serializationInstrumentation.beginSerializationScan({ scanId: 'decision-validation-immediate-diagnostics' });
    const result = decisionValidationEngine.recordDecision({
      listingId: 'diagnostic-immediate-1',
      title: 'Diagnostic Immediate',
      decision: 'PASS',
      timestamp: '2026-07-24T00:00:00.000Z'
    });
    const summary = serializationInstrumentation.endSerializationScan({ emit: false });
    const diagnostics = summary.diagnostics.DecisionValidationPersistence;

    assert.equal(result.ok, true);
    assert.equal(diagnostics.immediatePersistenceCount, 1);
    assert.equal(diagnostics.deferredPersistenceRequests || 0, 0);
    assert.equal(diagnostics.currentBatchDepth, 0);
    assert.equal(diagnostics.currentDirtyState, false);
    assert.equal(summary.groups.DecisionValidation.writes, 1);
    assert.equal(JSON.parse(fs.readFileSync(statePath, 'utf8')).records.length, 1);
  });
});

test('real scanner lifecycle batches real DecisionValidation recordDecision persistence', async () => {
  const statePath = tempFile('decisionValidation-scanner.json');
  const appStorePath = tempFile('cardhawk-data.json');

  await withDecisionEnv({
    CARDHAWK_DECISION_VALIDATION_STATE_FILE: statePath,
    CARDHAWK_MAX_TRACKED_DECISIONS: 20,
    CARDHAWK_MAX_DECISION_HISTORY: 20,
    CARDHAWK_MAX_DECISION_OUTCOME_HISTORY: 20
  }, async () => {
    const decisionValidationEngine = requireFreshDecisionValidationEngine();
    const store = {
      listings: {},
      alerts: [],
      scans: [],
      rejections: []
    };

    const scanner = createScoutScanner({
      activeMarketplace: {
        config: {
          scanQueryLimit: 10,
          searchDelayMs: 0,
          laneDelayMs: 0
        },
        searchWithBackoff: async () => [
          { ebayItemId: 'diagnostic-scan-1', title: 'Diagnostic Scan One', price: 10 },
          { ebayItemId: 'diagnostic-scan-2', title: 'Diagnostic Scan Two', price: 20 },
          { ebayItemId: 'diagnostic-scan-3', title: 'Diagnostic Scan Three', price: 30 }
        ],
        compactError: (error) => error.message || String(error),
        isRateLimitError: () => false
      },
      decisionValidationEngine,
      getStore: () => store,
      historyEngine: {
        recordScan: () => ({
          observedCount: 3,
          trackedCount: 3,
          activeCount: 3,
          newListings: [],
          priceDrops: [],
          disappeared: []
        })
      },
      lanes: {
        all: { queries: [] },
        cards: { queries: ['diagnostic cards'] }
      },
      learningEngine: {
        recordListingOutcome() {},
        recordScanOutcome: () => ({ stale: [] })
      },
      listingIdentity: {
        getListingId: (listing) => listing.ebayItemId || listing.listingId
      },
      parseCardTitle: () => ({}),
      persistenceCoordinator: null,
      predictionAccuracyEngine: {
        recordOutcome() {}
      },
      saveScoutedListing: (listing) => {
        const saved = {
          ...listing,
          totalCost: listing.price || 0,
          score: 50,
          estimatedValue: 100,
          estimatedProfit: 25,
          roi: 0.25
        };
        decisionValidationEngine.recordDecision({
          listingId: saved.ebayItemId,
          title: saved.title,
          decision: 'PASS',
          decisionScore: saved.score,
          expectedValue: saved.estimatedValue,
          listingCost: saved.totalCost,
          projectedROI: saved.roi,
          projectedProfit: saved.estimatedProfit,
          timestamp: '2026-07-24T00:00:00.000Z'
        });
        store.listings[saved.ebayItemId] = saved;
        return saved;
      },
      saveStore: () => stateStore.saveJsonState(appStorePath, store),
      serializationInstrumentation: {
        beginSerializationScan: serializationInstrumentation.beginSerializationScan,
        endSerializationScan: (options = {}) =>
          serializationInstrumentation.endSerializationScan({ ...options, emit: false })
      },
      sleep: async () => {},
      systemHealth: {
        finishScan() {},
        markScanSkipped() {},
        recordScanEngine() {},
        setEngine() {},
        startScan() {}
      }
    });

    serializationInstrumentation.resetSerializationInstrumentation();
    const scan = await scanner.runScoutScan('automatic');
    const summary = serializationInstrumentation.getCompletedSerializationSummaries().at(-1);
    const diagnostics = summary.diagnostics.DecisionValidationPersistence;
    const persisted = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    const runtimeDiagnostics = decisionValidationEngine.getPersistenceDiagnostics();

    assert.equal(scan.status, 'completed');
    assert.equal(diagnostics.beginPersistenceBatchCalls, 1);
    assert.equal(diagnostics.flushPersistenceBatchCalls, 1);
    assert.equal(diagnostics.cancelPersistenceBatchCalls || 0, 0);
    assert.equal(diagnostics.deferredPersistenceRequests, 3);
    assert.equal(diagnostics.immediatePersistenceCount || 0, 0);
    assert.equal(diagnostics.flushTriggeredPersistenceCount, 1);
    assert.equal(diagnostics.currentBatchDepth, 0);
    assert.equal(diagnostics.currentDirtyState, false);
    assert.equal(summary.groups.DecisionValidation.writes, 1);
    assert.equal(persisted.records.length, 3);
    assert.equal(runtimeDiagnostics.totalDeferredPersistenceRequests, 3);
    assert.equal(runtimeDiagnostics.totalFlushTriggeredPersistenceCount, 1);
  });
});
