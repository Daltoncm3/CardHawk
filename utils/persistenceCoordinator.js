'use strict';

const serializationInstrumentation = require('./serializationInstrumentation');

function createDefaultStats() {
  return {
    batchesStarted: 0,
    batchesClosed: 0,
    batchesCancelled: 0,
    dirtyMarks: 0,
    flushAttempts: 0,
    flushesPerformed: 0,
    flushesSkipped: 0,
    emergencyFlushes: 0,
    duplicateFlushesAvoided: 0
  };
}

function normalizeReason(reason) {
  if (typeof reason === 'string' && reason.trim()) return reason.trim();
  return 'unspecified';
}

function clone(value) {
  return serializationInstrumentation.instrumentJsonClone(value, {
    sourceFile: 'utils/persistenceCoordinator.js',
    functionName: 'clone',
    serializationType: 'json_clone_stringify',
    group: 'PersistenceCoordinator'
  });
}

function createPersistenceCoordinator(options = {}) {
  const persist = typeof options.persist === 'function' ? options.persist : null;
  if (!persist) {
    throw new Error('Persistence coordinator requires a persist function.');
  }

  const now = typeof options.now === 'function' ? options.now : () => new Date().toISOString();
  const idPrefix = options.idPrefix || 'persistence-batch';

  let batchDepth = 0;
  let batchSequence = 0;
  let currentBatchId = null;
  let dirty = false;
  let flushing = false;
  let dirtyReasons = [];
  let flushHistory = [];
  let lastFlush = null;
  const stats = createDefaultStats();

  function snapshot() {
    return {
      active: batchDepth > 0,
      batchDepth,
      currentBatchId,
      dirty,
      dirtyReasons: [...dirtyReasons],
      flushing,
      lastFlush: lastFlush ? { ...lastFlush } : null,
      flushHistory: flushHistory.map((entry) => ({ ...entry })),
      stats: { ...stats }
    };
  }

  function rememberDirtyReason(reason) {
    const normalized = normalizeReason(reason);
    if (!dirtyReasons.includes(normalized)) dirtyReasons.push(normalized);
    dirtyReasons.sort();
    return normalized;
  }

  function beginPersistenceBatch(reason = 'batch_started') {
    if (batchDepth === 0) {
      batchSequence += 1;
      currentBatchId = `${idPrefix}-${batchSequence}`;
    }

    batchDepth += 1;
    stats.batchesStarted += 1;

    return {
      batchId: currentBatchId,
      batchDepth,
      reason: normalizeReason(reason),
      startedAt: now()
    };
  }

  function markStateDirty(reason = 'state_mutated') {
    dirty = true;
    stats.dirtyMarks += 1;
    return {
      dirty,
      reason: rememberDirtyReason(reason),
      batchDepth,
      currentBatchId
    };
  }

  function performFlush(reason, options = {}) {
    const normalizedReason = normalizeReason(reason || 'flush');
    const force = Boolean(options.force);
    const effectiveBatchId = Object.prototype.hasOwnProperty.call(options, 'batchId')
      ? options.batchId
      : currentBatchId;
    stats.flushAttempts += 1;

    if (flushing) {
      stats.duplicateFlushesAvoided += 1;
      return {
        flushed: false,
        skipped: true,
        reason: normalizedReason,
        skipReason: 'flush_already_in_progress',
        diagnostics: snapshot()
      };
    }

    if (!dirty && !force) {
      stats.flushesSkipped += 1;
      return {
        flushed: false,
        skipped: true,
        reason: normalizedReason,
        skipReason: 'state_not_dirty',
        diagnostics: snapshot()
      };
    }

    const flushedDirtyReasons = [...dirtyReasons];
    flushing = true;

    try {
      const result = persist({
        reason: normalizedReason,
        dirtyReasons: flushedDirtyReasons,
        forced: force,
        batchId: effectiveBatchId
      });
      const flushRecord = {
        flushedAt: now(),
        reason: normalizedReason,
        dirtyReasons: flushedDirtyReasons,
        forced: force,
        batchId: effectiveBatchId
      };

      dirty = false;
      dirtyReasons = [];
      lastFlush = flushRecord;
      flushHistory.push(flushRecord);
      flushHistory = flushHistory.slice(-25);
      stats.flushesPerformed += 1;

      return {
        flushed: true,
        skipped: false,
        reason: normalizedReason,
        result,
        diagnostics: snapshot()
      };
    } finally {
      flushing = false;
    }
  }

  function closeBatchLevel() {
    if (batchDepth > 0) {
      batchDepth -= 1;
      stats.batchesClosed += 1;
    }

    const closedBatchId = currentBatchId;
    if (batchDepth === 0) currentBatchId = null;

    return closedBatchId;
  }

  function flushPersistenceBatch(reason = 'batch_flush') {
    const batchId = closeBatchLevel();

    if (batchDepth > 0) {
      return {
        flushed: false,
        deferred: true,
        reason: normalizeReason(reason),
        batchId,
        diagnostics: snapshot()
      };
    }

    return performFlush(reason, { force: false, batchId });
  }

  function emergencyFlush(reason = 'emergency_flush') {
    stats.emergencyFlushes += 1;
    return performFlush(reason, { force: true });
  }

  function cancelPersistenceBatch(reason = 'batch_cancelled') {
    const cancelledBatchId = currentBatchId;
    batchDepth = 0;
    currentBatchId = null;
    dirty = false;
    dirtyReasons = [];
    stats.batchesCancelled += 1;

    return {
      cancelled: true,
      batchId: cancelledBatchId,
      reason: normalizeReason(reason),
      diagnostics: snapshot()
    };
  }

  function getPersistenceDiagnostics() {
    return clone(snapshot());
  }

  return {
    beginPersistenceBatch,
    markStateDirty,
    flushPersistenceBatch,
    cancelPersistenceBatch,
    emergencyFlush,
    getPersistenceDiagnostics
  };
}

module.exports = {
  createPersistenceCoordinator
};
