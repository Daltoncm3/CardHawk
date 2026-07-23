'use strict';

const path = require('path');
const stateStore = require('./stateStore');
const serializationInstrumentation = require('./serializationInstrumentation');

const AUDIT_LOG_FILE = path.join(__dirname, '..', 'data', 'operatorAuditLog.json');
const MAX_AUDIT_EVENTS = 1000;
const SENSITIVE_KEY_PATTERN = /password|secret|token|authorization|authheader|apikey|api_key/i;

function nowIso() {
  return new Date().toISOString();
}

function createEmptyAuditLog() {
  const now = nowIso();
  return {
    version: 1,
    createdAt: now,
    updatedAt: now,
    events: []
  };
}

function sanitizeValue(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 100).map(sanitizeValue);

  if (typeof value === 'object') {
    return Object.entries(value).reduce((result, [key, nestedValue]) => {
      if (SENSITIVE_KEY_PATTERN.test(key)) return result;
      result[key] = sanitizeValue(nestedValue);
      return result;
    }, {});
  }

  return String(value);
}

function normalizeAuditLog(log = {}) {
  const fallback = createEmptyAuditLog();
  return {
    version: 1,
    createdAt: log.createdAt || fallback.createdAt,
    updatedAt: log.updatedAt || log.createdAt || fallback.updatedAt,
    events: Array.isArray(log.events) ? log.events.slice(0, MAX_AUDIT_EVENTS) : []
  };
}

function loadAuditLog(filePath = AUDIT_LOG_FILE) {
  return serializationInstrumentation.withSerializationGroup('OperatorAudit', () =>
    normalizeAuditLog(stateStore.loadJsonState(filePath, createEmptyAuditLog()))
  );
}

function saveAuditLog(log, filePath = AUDIT_LOG_FILE) {
  const normalized = normalizeAuditLog(log);
  normalized.updatedAt = nowIso();
  normalized.events = normalized.events.slice(0, MAX_AUDIT_EVENTS);
  serializationInstrumentation.withSerializationGroup('OperatorAudit', () =>
    stateStore.saveJsonState(filePath, normalized)
  );
  return normalized;
}

function recordOperatorAction(action, data = {}, options = {}) {
  const filePath = options.filePath || AUDIT_LOG_FILE;
  const log = loadAuditLog(filePath);
  const event = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    action: String(action || 'unknown'),
    status: data.status || 'unknown',
    createdAt: nowIso(),
    actor: data.actor || 'unknown',
    sourceIp: data.sourceIp || null,
    userAgent: data.userAgent || null,
    details: sanitizeValue(data.details || {})
  };

  log.events.unshift(event);
  log.events = log.events.slice(0, MAX_AUDIT_EVENTS);
  saveAuditLog(log, filePath);
  return event;
}

function getOperatorAuditLog(limit = 100, options = {}) {
  const filePath = options.filePath || AUDIT_LOG_FILE;
  const safeLimit = Math.max(0, Math.min(Number(limit) || 100, MAX_AUDIT_EVENTS));
  const log = loadAuditLog(filePath);
  return {
    ...log,
    events: log.events.slice(0, safeLimit)
  };
}

function summarizeOperatorAuditLog(options = {}) {
  const filePath = options.filePath || AUDIT_LOG_FILE;
  const log = loadAuditLog(filePath);
  const actionCounts = log.events.reduce((counts, event) => {
    counts[event.action] = (counts[event.action] || 0) + 1;
    return counts;
  }, {});

  return {
    version: log.version,
    updatedAt: log.updatedAt,
    totalEvents: log.events.length,
    latestEventAt: log.events[0]?.createdAt || null,
    actionCounts
  };
}

module.exports = {
  recordOperatorAction,
  getOperatorAuditLog,
  summarizeOperatorAuditLog,
  createEmptyAuditLog
};
