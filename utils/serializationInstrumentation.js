'use strict';

const DEFAULT_GROUP = 'Other';
const MAX_RECENT_OPERATIONS = 50;
const BYTES_PER_MEGABYTE = 1024 * 1024;

let activeScan = null;
let completedSummaries = [];
let groupStack = [];

function nowIso() {
  return new Date().toISOString();
}

function memorySnapshot() {
  const usage = process.memoryUsage();
  return {
    heapUsed: usage.heapUsed,
    rss: usage.rss
  };
}

function elapsedMs(startedAt) {
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000;
}

function roundMs(value) {
  return Math.round(Number(value || 0) * 1000) / 1000;
}

function formatBytes(bytes = 0) {
  const value = Number(bytes) || 0;
  if (value >= BYTES_PER_MEGABYTE) {
    return `${(value / BYTES_PER_MEGABYTE).toFixed(1)} MB`;
  }
  if (value >= 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${value} B`;
}

function normalizeMetadata(metadata = {}) {
  return {
    sourceFile: metadata.sourceFile || 'unknown',
    functionName: metadata.functionName || 'unknown',
    serializationType: metadata.serializationType || 'json_stringify',
    group: metadata.group || groupStack[groupStack.length - 1] || DEFAULT_GROUP
  };
}

function createEmptySummary(input = {}) {
  return {
    source: 'serialization_instrumentation',
    schemaVersion: '1.0.0',
    scanId: input.scanId || null,
    scanSource: input.source || null,
    startedAt: input.startedAt || nowIso(),
    finishedAt: null,
    status: input.status || 'running',
    totalSerializations: 0,
    totalBytes: 0,
    totalTimeMs: 0,
    largestSerialization: null,
    largestHeapDelta: null,
    groups: {},
    recentOperations: []
  };
}

function getOrCreateGroup(summary, groupName) {
  const group = groupName || DEFAULT_GROUP;
  if (!summary.groups[group]) {
    summary.groups[group] = {
      writes: 0,
      bytes: 0,
      largestBytes: 0,
      timeMs: 0,
      largestHeapDelta: 0
    };
  }
  return summary.groups[group];
}

function recordOperation(operation) {
  if (!activeScan) return;

  const metadata = normalizeMetadata(operation);
  const heapDelta = operation.heapUsedAfter - operation.heapUsedBefore;
  const rssDelta = operation.rssAfter - operation.rssBefore;
  const positiveHeapDelta = Math.max(0, heapDelta);
  const record = {
    ...metadata,
    byteCount: operation.byteCount,
    elapsedMs: roundMs(operation.elapsedMs),
    heapUsedBefore: operation.heapUsedBefore,
    heapUsedAfter: operation.heapUsedAfter,
    heapDelta,
    rssBefore: operation.rssBefore,
    rssAfter: operation.rssAfter,
    rssDelta
  };

  const group = getOrCreateGroup(activeScan, metadata.group);
  group.writes += 1;
  group.bytes += record.byteCount;
  group.largestBytes = Math.max(group.largestBytes, record.byteCount);
  group.timeMs = roundMs(group.timeMs + record.elapsedMs);
  group.largestHeapDelta = Math.max(group.largestHeapDelta, positiveHeapDelta);

  activeScan.totalSerializations += 1;
  activeScan.totalBytes += record.byteCount;
  activeScan.totalTimeMs = roundMs(activeScan.totalTimeMs + record.elapsedMs);

  if (!activeScan.largestSerialization || record.byteCount > activeScan.largestSerialization.byteCount) {
    activeScan.largestSerialization = record;
  }
  if (!activeScan.largestHeapDelta || positiveHeapDelta > Math.max(0, activeScan.largestHeapDelta.heapDelta)) {
    activeScan.largestHeapDelta = record;
  }

  activeScan.recentOperations.push(record);
  activeScan.recentOperations = activeScan.recentOperations.slice(-MAX_RECENT_OPERATIONS);
}

function instrumentJsonStringify(value, replacer, space, metadata = {}) {
  const before = memorySnapshot();
  const startedAt = process.hrtime.bigint();
  const serialized = JSON.stringify(value, replacer, space);
  const elapsed = elapsedMs(startedAt);
  const after = memorySnapshot();

  recordOperation({
    ...metadata,
    serializationType: metadata.serializationType || 'json_stringify',
    byteCount: Buffer.byteLength(serialized || '', 'utf8'),
    elapsedMs: elapsed,
    heapUsedBefore: before.heapUsed,
    heapUsedAfter: after.heapUsed,
    rssBefore: before.rss,
    rssAfter: after.rss
  });

  return serialized;
}

function instrumentJsonClone(value, metadata = {}) {
  if (!value || typeof value !== 'object') return value;

  const serialized = instrumentJsonStringify(value, undefined, undefined, {
    ...metadata,
    serializationType: metadata.serializationType || 'json_clone_stringify'
  });
  return JSON.parse(serialized);
}

function beginSerializationScan(input = {}) {
  activeScan = createEmptySummary(input);
  return getActiveSerializationSummary();
}

function getActiveSerializationSummary() {
  if (!activeScan) return null;
  return {
    ...activeScan,
    groups: Object.fromEntries(
      Object.entries(activeScan.groups).map(([key, value]) => [key, { ...value }])
    ),
    largestSerialization: activeScan.largestSerialization ? { ...activeScan.largestSerialization } : null,
    largestHeapDelta: activeScan.largestHeapDelta ? { ...activeScan.largestHeapDelta } : null,
    recentOperations: activeScan.recentOperations.map((operation) => ({ ...operation }))
  };
}

function formatSerializationSummary(summary = {}) {
  const lines = ['=== Serialization Summary ==='];
  const groupNames = Object.keys(summary.groups || {}).sort();

  for (const groupName of groupNames) {
    const group = summary.groups[groupName];
    lines.push('');
    lines.push(groupName);
    lines.push(`writes: ${group.writes}`);
    lines.push(`bytes: ${formatBytes(group.bytes)}`);
    lines.push(`largest: ${formatBytes(group.largestBytes)}`);
    lines.push(`time: ${roundMs(group.timeMs)} ms`);
  }

  lines.push('');
  lines.push(`Total serialization bytes: ${formatBytes(summary.totalBytes)}`);
  lines.push(`Total writes: ${summary.totalSerializations || 0}`);
  lines.push(`Largest serialization: ${summary.largestSerialization ? `${summary.largestSerialization.group} ${formatBytes(summary.largestSerialization.byteCount)}` : 'none'}`);
  lines.push(`Peak heap delta: ${summary.largestHeapDelta ? `${summary.largestHeapDelta.group} ${formatBytes(summary.largestHeapDelta.heapDelta)}` : 'none'}`);

  return lines.join('\n');
}

function endSerializationScan(options = {}) {
  if (!activeScan) return null;

  const summary = getActiveSerializationSummary();
  summary.finishedAt = options.finishedAt || nowIso();
  summary.status = options.status || summary.status || 'completed';
  completedSummaries.push(summary);
  completedSummaries = completedSummaries.slice(-25);
  activeScan = null;

  if (options.emit !== false && summary.totalSerializations > 0) {
    const logger = typeof options.logger === 'function' ? options.logger : console.info;
    logger(formatSerializationSummary(summary));
  }

  return summary;
}

function getCompletedSerializationSummaries() {
  return completedSummaries.map((summary) => ({
    ...summary,
    groups: Object.fromEntries(
      Object.entries(summary.groups || {}).map(([key, value]) => [key, { ...value }])
    ),
    largestSerialization: summary.largestSerialization ? { ...summary.largestSerialization } : null,
    largestHeapDelta: summary.largestHeapDelta ? { ...summary.largestHeapDelta } : null,
    recentOperations: (summary.recentOperations || []).map((operation) => ({ ...operation }))
  }));
}

function resetSerializationInstrumentation() {
  activeScan = null;
  completedSummaries = [];
  groupStack = [];
}

function withSerializationGroup(group, callback) {
  groupStack.push(group || DEFAULT_GROUP);
  try {
    return callback();
  } finally {
    groupStack.pop();
  }
}

module.exports = {
  beginSerializationScan,
  endSerializationScan,
  formatSerializationSummary,
  getActiveSerializationSummary,
  getCompletedSerializationSummaries,
  instrumentJsonClone,
  instrumentJsonStringify,
  resetSerializationInstrumentation,
  withSerializationGroup
};
