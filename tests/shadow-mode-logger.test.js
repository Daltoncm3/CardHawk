'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const shadowModeLogger = require('../utils/shadowModeLogger');
const serializationInstrumentation = require('../utils/serializationInstrumentation');

function makeTempFile() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cardhawk-shadow-mode-'));
  return path.join(directory, 'shadow-mode.json');
}

function buildInput(overrides = {}) {
  return {
    createdAt: '2026-07-09T12:00:00.000Z',
    listing: {
      ebayItemId: 'shadow-1',
      title: '2024 Topps Chrome Shadow Test PSA 10',
      price: 50,
      totalCost: 55,
      marketplace: 'ebay',
      rawUnwantedField: 'should-not-be-logged'
    },
    scanContext: {
      scanId: 'scan-1',
      source: 'manual',
      lane: 'baseball',
      query: 'shadow query'
    },
    decisionIntelligence: {
      overallReadiness: 'supported_context',
      evidencePosture: 'strong',
      compPosture: 'strong',
      valuationPosture: 'strong_range',
      resalePressurePosture: 'low',
      recommendationImpact: 'BUY_NOW',
      supportingSignals: [{ source: 'evidence_sufficiency', message: 'Strong evidence.' }],
      cautionSignals: [],
      blockers: [],
      conflicts: [],
      summary: 'Shadow output should be logged compactly.'
    },
    ...overrides
  };
}

test('shadow logger defaults to disabled and does not create a file', () => {
  const filePath = makeTempFile();
  const result = shadowModeLogger.logShadowModeDecision(buildInput(), {
    filePath,
    env: {}
  });

  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'shadow_mode_disabled');
  assert.equal(fs.existsSync(filePath), false);
});

test('shadow logger writes compact record when enabled', () => {
  const filePath = makeTempFile();
  const result = shadowModeLogger.logShadowModeDecision(buildInput(), {
    filePath,
    env: { CARDHAWK_SHADOW_MODE_ENABLED: 'true' }
  });
  const saved = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  assert.equal(result.ok, true);
  assert.equal(saved.version, 1);
  assert.equal(saved.records.length, 1);
  assert.equal(saved.records[0].listingId, 'shadow-1');
  assert.deepEqual(saved.records[0].listing, {
    id: 'shadow-1',
    title: '2024 Topps Chrome Shadow Test PSA 10',
    price: 50,
    totalCost: 55,
    marketplace: 'ebay'
  });
  assert.equal(saved.records[0].decisionIntelligence.recommendationImpact, 'none');
  assert.equal(saved.records[0].decisionIntelligence.summary, 'Shadow output should be logged compactly.');
  assert.equal(saved.records[0].listing.rawUnwantedField, undefined);
});

test('shadow logger uses atomic state writes and preserves existing records', () => {
  const filePath = makeTempFile();

  shadowModeLogger.logShadowModeDecision(buildInput({ id: 'record-1' }), {
    filePath,
    env: { CARDHAWK_SHADOW_MODE_ENABLED: 'true' }
  });
  shadowModeLogger.logShadowModeDecision(buildInput({
    id: 'record-2',
    createdAt: '2026-07-09T12:01:00.000Z',
    listing: {
      ebayItemId: 'shadow-2',
      title: 'Second Shadow Listing',
      price: 60,
      totalCost: 66
    }
  }), {
    filePath,
    env: { CARDHAWK_SHADOW_MODE_ENABLED: 'true' }
  });

  const saved = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  assert.equal(saved.records.length, 2);
  assert.deepEqual(saved.records.map((record) => record.listingId), ['shadow-1', 'shadow-2']);
});

test('shadow logger trims oldest records beyond max cap', () => {
  const filePath = makeTempFile();
  const seed = {
    version: 1,
    updatedAt: '2026-07-09T00:00:00.000Z',
    records: Array.from({ length: shadowModeLogger.MAX_SHADOW_RECORDS }, (_, index) => ({
      id: `old-${index}`,
      createdAt: '2026-07-09T00:00:00.000Z',
      listingId: `old-${index}`
    }))
  };

  fs.writeFileSync(filePath, `${JSON.stringify(seed, null, 2)}\n`);

  shadowModeLogger.logShadowModeDecision(buildInput({
    id: 'new-record',
    listing: {
      ebayItemId: 'new-shadow',
      title: 'Newest Shadow',
      price: 100,
      totalCost: 110
    }
  }), {
    filePath,
    env: { CARDHAWK_SHADOW_MODE_ENABLED: 'true' }
  });

  const saved = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  assert.equal(saved.records.length, shadowModeLogger.MAX_SHADOW_RECORDS);
  assert.equal(saved.records[0].id, 'old-1');
  assert.equal(saved.records[saved.records.length - 1].listingId, 'new-shadow');
});

test('shadow logger does not mutate inputs', () => {
  const filePath = makeTempFile();
  const input = buildInput();
  const before = JSON.stringify(input);

  shadowModeLogger.logShadowModeDecision(input, {
    filePath,
    env: { CARDHAWK_SHADOW_MODE_ENABLED: 'true' }
  });

  assert.equal(JSON.stringify(input), before);
});

test('shadow record builder keeps recommendationImpact none even with unsafe input', () => {
  const record = shadowModeLogger.buildShadowModeRecord(buildInput({
    decisionIntelligence: {
      recommendationImpact: 'BUY_NOW',
      supportingSignals: ['support'],
      cautionSignals: ['caution'],
      blockers: ['blocker'],
      conflicts: ['conflict']
    }
  }));

  assert.equal(record.decisionIntelligence.recommendationImpact, 'none');
  assert.deepEqual(record.decisionIntelligence.supportingSignals, [{ source: 'support', message: 'support' }]);
});

test('shadow logger persists immediately outside batch mode', () => {
  const filePath = makeTempFile();

  serializationInstrumentation.resetSerializationInstrumentation();
  serializationInstrumentation.beginSerializationScan({ scanId: 'shadow-immediate' });
  shadowModeLogger.logShadowModeDecision(buildInput({ id: 'record-1' }), {
    filePath,
    env: { CARDHAWK_SHADOW_MODE_ENABLED: 'true' }
  });
  shadowModeLogger.logShadowModeDecision(buildInput({
    id: 'record-2',
    createdAt: '2026-07-09T12:01:00.000Z',
    listing: { ebayItemId: 'shadow-2', title: 'Second Shadow Listing' }
  }), {
    filePath,
    env: { CARDHAWK_SHADOW_MODE_ENABLED: 'true' }
  });
  const summary = serializationInstrumentation.endSerializationScan({ emit: false });

  assert.equal(summary.groups.ShadowMode.writes, 3);
  assert.equal(JSON.parse(fs.readFileSync(filePath, 'utf8')).records.length, 2);
});

test('shadow logger batches multiple records into one persistence flush', () => {
  const filePath = makeTempFile();

  serializationInstrumentation.resetSerializationInstrumentation();
  serializationInstrumentation.beginSerializationScan({ scanId: 'shadow-batched' });
  assert.equal(shadowModeLogger.beginPersistenceBatch().status, 'persistence_batch_started');
  shadowModeLogger.logShadowModeDecision(buildInput({ id: 'record-1' }), {
    filePath,
    env: { CARDHAWK_SHADOW_MODE_ENABLED: 'true' }
  });
  shadowModeLogger.logShadowModeDecision(buildInput({
    id: 'record-2',
    createdAt: '2026-07-09T12:01:00.000Z',
    listing: { ebayItemId: 'shadow-2', title: 'Second Shadow Listing' }
  }), {
    filePath,
    env: { CARDHAWK_SHADOW_MODE_ENABLED: 'true' }
  });
  const flush = shadowModeLogger.flushPersistenceBatch();
  const summary = serializationInstrumentation.endSerializationScan({ emit: false });

  assert.equal(flush.status, 'persistence_batch_flushed');
  assert.equal(flush.persisted, true);
  assert.equal(summary.groups.ShadowMode.writes, 2);
  assert.equal(JSON.parse(fs.readFileSync(filePath, 'utf8')).records.length, 2);
});

test('shadow logger clean batch flush performs no persistence', () => {
  const filePath = makeTempFile();

  serializationInstrumentation.resetSerializationInstrumentation();
  serializationInstrumentation.beginSerializationScan({ scanId: 'shadow-clean-batch' });
  shadowModeLogger.beginPersistenceBatch();
  const flush = shadowModeLogger.flushPersistenceBatch();
  const summary = serializationInstrumentation.endSerializationScan({ emit: false });

  assert.equal(flush.status, 'persistence_batch_clean');
  assert.equal(flush.persisted, false);
  assert.equal(summary.totalSerializations, 0);
  assert.equal(fs.existsSync(filePath), false);
});

test('shadow logger dirty state resets after flush', () => {
  const filePath = makeTempFile();

  serializationInstrumentation.resetSerializationInstrumentation();
  serializationInstrumentation.beginSerializationScan({ scanId: 'shadow-dirty-reset' });
  shadowModeLogger.beginPersistenceBatch();
  shadowModeLogger.logShadowModeDecision(buildInput({ id: 'record-1' }), {
    filePath,
    env: { CARDHAWK_SHADOW_MODE_ENABLED: 'true' }
  });
  assert.equal(shadowModeLogger.flushPersistenceBatch().persisted, true);
  assert.equal(shadowModeLogger.flushPersistenceBatch().persisted, false);
  const summary = serializationInstrumentation.endSerializationScan({ emit: false });

  assert.equal(summary.groups.ShadowMode.writes, 2);
  assert.equal(JSON.parse(fs.readFileSync(filePath, 'utf8')).records.length, 1);
});

test('shadow logger cancel flushes dirty batch for emergency durability', () => {
  const filePath = makeTempFile();

  serializationInstrumentation.resetSerializationInstrumentation();
  serializationInstrumentation.beginSerializationScan({ scanId: 'shadow-cancel-batch' });
  shadowModeLogger.beginPersistenceBatch();
  shadowModeLogger.logShadowModeDecision(buildInput({ id: 'record-1' }), {
    filePath,
    env: { CARDHAWK_SHADOW_MODE_ENABLED: 'true' }
  });
  const cancelled = shadowModeLogger.cancelPersistenceBatch();
  const summary = serializationInstrumentation.endSerializationScan({ emit: false });

  assert.equal(cancelled.status, 'persistence_batch_cancelled_flushed');
  assert.equal(cancelled.persisted, true);
  assert.equal(summary.groups.ShadowMode.writes, 2);
  assert.equal(JSON.parse(fs.readFileSync(filePath, 'utf8')).records.length, 1);
});

test('shadow logger batched final JSON matches immediate persistence format', () => {
  const immediatePath = makeTempFile();
  const batchedPath = makeTempFile();
  const records = [
    buildInput({ id: 'record-1' }),
    buildInput({
      id: 'record-2',
      createdAt: '2026-07-09T12:01:00.000Z',
      listing: { ebayItemId: 'shadow-2', title: 'Second Shadow Listing', price: 60, totalCost: 66 }
    })
  ];

  for (const input of records) {
    shadowModeLogger.logShadowModeDecision(input, {
      filePath: immediatePath,
      env: { CARDHAWK_SHADOW_MODE_ENABLED: 'true' }
    });
  }

  shadowModeLogger.beginPersistenceBatch();
  for (const input of records) {
    shadowModeLogger.logShadowModeDecision(input, {
      filePath: batchedPath,
      env: { CARDHAWK_SHADOW_MODE_ENABLED: 'true' }
    });
  }
  assert.equal(shadowModeLogger.flushPersistenceBatch().persisted, true);

  assert.equal(fs.readFileSync(batchedPath, 'utf8'), fs.readFileSync(immediatePath, 'utf8'));
});
