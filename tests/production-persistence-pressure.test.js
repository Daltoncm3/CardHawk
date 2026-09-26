'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const appStore = require('../utils/appStore');
const {
  addOrCoalesceRejection
} = require('../utils/rejectionStore');

function makeTempFile(name = 'cardhawk-data.json') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cardhawk-a26-'));
  return path.join(directory, name);
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function runStartupPersistenceDecision(filePath, rescore = (store) => store, options = {}) {
  const plan = appStore.loadStoreWithPersistencePlan(filePath, appStore.createDefaultStore(), options);
  const beforeFingerprint = appStore.buildStoreFingerprint(plan.store, { alreadyNormalized: true });
  const rescored = rescore(plan.store);
  const normalizedAfterRescore = appStore.normalizeStore(rescored, options);
  const afterFingerprint = appStore.buildStoreFingerprint(normalizedAfterRescore, { alreadyNormalized: true });
  const shouldPersist = plan.persistenceRequired || beforeFingerprint !== afterFingerprint;

  if (shouldPersist) {
    appStore.saveStore(filePath, normalizedAfterRescore, {
      reason: 'test_startup_state_materially_changed'
    });
  } else {
    appStore.recordStoreSaveDiagnostic({
      filePath,
      reason: 'test_startup_state_unchanged',
      executed: false,
      skipped: true,
      skipReason: 'startup_state_materially_unchanged',
      store: normalizedAfterRescore
    });
  }

  return {
    plan,
    shouldPersist,
    beforeFingerprint,
    afterFingerprint,
    store: normalizedAfterRescore
  };
}

function createRejection(overrides = {}) {
  return {
    ebayItemId: 'reject-1',
    lane: 'ufc',
    title: 'Rejected Listing',
    score: 12,
    estimatedProfit: -5,
    roi: -0.1,
    marketConfidence: 20,
    confidenceReasons: ['thin evidence'],
    confidenceCap: 40,
    compCount: 0,
    compSource: 'none',
    qualityData: { level: 'weak' },
    investmentQuality: 12,
    qualityBucket: 'weak',
    liquidityScore: 10,
    riskLevel: 'high',
    qualityReasons: [],
    qualityWarnings: ['insufficient comps'],
    dealGrade: { grade: 'F' },
    reasons: ['Deal Gate failed'],
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  };
}

test('unchanged startup state does not trigger unnecessary whole-store persistence', () => {
  const filePath = makeTempFile();
  const store = appStore.createDefaultStore();
  store.listings['listing-1'] = {
    ebayItemId: 'listing-1',
    title: 'Already Normalized',
    lastSeenAt: '2026-01-01T00:00:00.000Z'
  };
  appStore.saveStore(filePath, store, { reason: 'seed' });
  appStore.resetStoreSaveDiagnostics();

  const result = runStartupPersistenceDecision(filePath);
  const diagnostics = appStore.getStoreSaveDiagnostics();

  assert.equal(result.shouldPersist, false);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].executed, false);
  assert.equal(diagnostics[0].skipped, true);
  assert.equal(diagnostics[0].skipReason, 'startup_state_materially_unchanged');
});

test('materially changed startup state still persists', () => {
  const filePath = makeTempFile();
  const store = appStore.createDefaultStore();
  appStore.saveStore(filePath, store, { reason: 'seed' });
  appStore.resetStoreSaveDiagnostics();

  const result = runStartupPersistenceDecision(filePath, (loaded) => ({
    ...loaded,
    settings: {
      ...loaded.settings,
      minProfit: loaded.settings.minProfit + 1
    }
  }));
  const diagnostics = appStore.getStoreSaveDiagnostics();

  assert.equal(result.shouldPersist, true);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].executed, true);
  assert.equal(diagnostics[0].reason, 'test_startup_state_materially_changed');
});

test('retention or migration-required startup changes still persist', () => {
  const filePath = makeTempFile();
  const rawStore = appStore.createDefaultStore();
  for (let index = 0; index < 4; index += 1) {
    rawStore.listings[`listing-${index}`] = {
      ebayItemId: `listing-${index}`,
      title: `Listing ${index}`,
      lastSeenAt: `2026-01-0${index + 1}T00:00:00.000Z`
    };
  }
  writeJson(filePath, rawStore);
  appStore.resetStoreSaveDiagnostics();

  const result = runStartupPersistenceDecision(filePath, (loaded) => loaded, {
    env: {
      CARDHAWK_MAX_RESIDENT_LISTINGS: '2',
      CARDHAWK_MIN_PROTECTED_NEWEST_LISTINGS: '1'
    }
  });

  assert.equal(result.shouldPersist, true);
  assert.equal(result.plan.persistenceRequired, true);
  assert.ok(result.plan.persistenceReasons.includes('store_normalized_or_retained'));
  assert.equal(Object.keys(result.store.listings).length, 2);
});

test('repeated materially identical rejection is safely coalesced with first/latest/count semantics', () => {
  const first = addOrCoalesceRejection([], createRejection(), {
    observedAt: '2026-01-01T00:00:00.000Z'
  });
  const second = addOrCoalesceRejection(first.rejections, createRejection({
    createdAt: '2026-01-01T00:05:00.000Z'
  }), {
    observedAt: '2026-01-01T00:05:00.000Z'
  });

  assert.equal(first.coalesced, false);
  assert.equal(second.coalesced, true);
  assert.equal(second.rejections.length, 1);
  assert.equal(second.rejections[0].firstRejectedAt, '2026-01-01T00:00:00.000Z');
  assert.equal(second.rejections[0].latestRejectedAt, '2026-01-01T00:05:00.000Z');
  assert.equal(second.rejections[0].rejectionCount, 2);
  assert.equal(second.rejections[0].occurrenceCount, 2);
  assert.deepEqual(second.rejections[0].reasons, ['Deal Gate failed']);
});

test('materially different rejection information remains preserved', () => {
  const first = addOrCoalesceRejection([], createRejection(), {
    observedAt: '2026-01-01T00:00:00.000Z'
  });
  const second = addOrCoalesceRejection(first.rejections, createRejection({
    reasons: ['Deal Gate failed', 'Insufficient sold comps'],
    createdAt: '2026-01-01T00:05:00.000Z'
  }), {
    observedAt: '2026-01-01T00:05:00.000Z'
  });

  assert.equal(second.coalesced, false);
  assert.equal(second.rejections.length, 2);
  assert.deepEqual(second.rejections[0].reasons, ['Deal Gate failed', 'Insufficient sold comps']);
  assert.deepEqual(second.rejections[1].reasons, ['Deal Gate failed']);
});

test('serialization diagnostics are bounded and executed save diagnostics contain required fields', () => {
  const filePath = makeTempFile();
  appStore.resetStoreSaveDiagnostics();

  for (let index = 0; index < 55; index += 1) {
    const store = appStore.createDefaultStore();
    store.listings[`listing-${index}`] = {
      ebayItemId: `listing-${index}`,
      title: `Listing ${index}`
    };
    appStore.saveStore(filePath, store, { reason: `save-${index}` });
  }

  const diagnostics = appStore.getStoreSaveDiagnostics();
  const latest = diagnostics[diagnostics.length - 1];

  assert.equal(diagnostics.length, 50);
  assert.equal(latest.executed, true);
  assert.equal(latest.skipped, false);
  assert.ok(latest.timestamp);
  assert.ok(latest.serializedByteSize > 0);
  assert.ok(latest.durationMs >= 0);
  assert.equal(latest.collectionCounts.listings, 1);
  assert.equal(latest.largestResidentCollectionCounts.listings, 1);
});

test('skipped-save diagnostics are distinguishable from executed saves', () => {
  appStore.resetStoreSaveDiagnostics();
  appStore.recordStoreSaveDiagnostic({
    filePath: '/tmp/cardhawk-data.json',
    reason: 'startup_state_unchanged',
    executed: false,
    skipped: true,
    skipReason: 'startup_state_materially_unchanged',
    store: appStore.createDefaultStore()
  });

  const [diagnostic] = appStore.getStoreSaveDiagnostics();
  assert.equal(diagnostic.executed, false);
  assert.equal(diagnostic.skipped, true);
  assert.equal(diagnostic.serializedByteSize, 0);
  assert.equal(diagnostic.skipReason, 'startup_state_materially_unchanged');
});

test('targeted-discovery observations remain unaffected by persistence-pressure changes', () => {
  const store = appStore.normalizeStore({
    ...appStore.createDefaultStore(),
    targetedDiscoveryObservations: [{
      observationId: 'lane:listing-1',
      listingId: 'listing-1',
      laneId: 'lane',
      title: 'Observation',
      firstObservedAt: '2026-01-01T00:00:00.000Z',
      lastObservedAt: '2026-01-01T00:05:00.000Z'
    }]
  });

  assert.equal(store.targetedDiscoveryObservations.length, 1);
  assert.equal(store.targetedDiscoveryObservations[0].observationId, 'lane:listing-1');
});

test('existing appStore persistence return shape remains backwards compatible', () => {
  const filePath = makeTempFile();
  const result = appStore.saveStore(filePath, appStore.createDefaultStore(), { reason: 'compatibility' });
  const loaded = appStore.loadStore(filePath, appStore.createDefaultStore());

  assert.equal(result.ok, true);
  assert.equal(result.filePath, filePath);
  assert.ok(result.diagnostics);
  assert.ok(result.diagnostics.serializedByteSize > 0);
  assert.deepEqual(Object.keys(loaded), ['listings', 'alerts', 'scans', 'rejections', 'targetedDiscoveryObservations', 'ownerIdentityReviews', 'ownerCompDrafts', 'settings']);
});
