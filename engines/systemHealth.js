// engines/systemHealth.js
// CardHawk System Health Engine v1
// Tracks scan health, engine status, timing, warnings, and reliability notes.

const state = {
  startedAt: new Date().toISOString(),
  lastUpdatedAt: new Date().toISOString(),
  currentScan: null,
  lastScan: null,
  engines: {},
  events: [],
  counters: {
    scansStarted: 0,
    scansCompleted: 0,
    scansFailed: 0,
    scansSkipped: 0,
    rateLimitedScans: 0
  }
};

function nowIso() {
  return new Date().toISOString();
}

function durationMs(startedAt) {
  if (!startedAt) return 0;
  return Math.max(0, Date.now() - new Date(startedAt).getTime());
}

function roundMs(value) {
  return Math.round(Number(value || 0));
}

function rememberEvent(type, message, details = {}) {
  const event = {
    type,
    message,
    details,
    createdAt: nowIso()
  };

  state.events.unshift(event);
  state.events = state.events.slice(0, 100);
  state.lastUpdatedAt = event.createdAt;
  return event;
}

function setEngine(name, status = "ok", details = {}) {
  state.engines[name] = {
    name,
    status,
    details,
    updatedAt: nowIso()
  };
  state.lastUpdatedAt = state.engines[name].updatedAt;
  return state.engines[name];
}

function startScan(scan = {}) {
  const startedAt = scan.startedAt || nowIso();

  state.counters.scansStarted += 1;
  state.currentScan = {
    id: scan.id || String(Date.now()),
    source: scan.source || "unknown",
    status: "running",
    startedAt,
    finishedAt: null,
    durationMs: 0,
    listingsFound: 0,
    newAlerts: 0,
    lanes: [],
    rateLimited: false,
    error: null,
    engines: {}
  };

  rememberEvent("scan_started", `Scout scan started (${state.currentScan.source}).`, {
    scanId: state.currentScan.id
  });

  return state.currentScan;
}

function markScanSkipped(scan = {}, reason = "Another scout scan is already running.") {
  state.counters.scansSkipped += 1;

  const skipped = {
    id: scan.id || String(Date.now()),
    source: scan.source || "unknown",
    status: "skipped",
    startedAt: scan.startedAt || nowIso(),
    finishedAt: scan.finishedAt || nowIso(),
    durationMs: 0,
    listingsFound: 0,
    newAlerts: 0,
    lanes: [],
    rateLimited: false,
    error: reason,
    engines: {}
  };

  state.lastScan = skipped;
  rememberEvent("scan_skipped", reason, { scanId: skipped.id });
  return skipped;
}

function recordScanEngine(engineName, status = "ok", details = {}) {
  setEngine(engineName, status, details);

  if (state.currentScan) {
    state.currentScan.engines[engineName] = {
      status,
      details,
      updatedAt: nowIso()
    };
  }
}

function finishScan(scan = {}) {
  const finishedAt = scan.finishedAt || nowIso();
  const startedAt = scan.startedAt || state.currentScan?.startedAt || finishedAt;
  const status = scan.status || "completed";

  if (status === "completed") state.counters.scansCompleted += 1;
  else if (status === "failed") state.counters.scansFailed += 1;
  else if (status === "rate_limited") state.counters.rateLimitedScans += 1;

  const finished = {
    id: scan.id || state.currentScan?.id || String(Date.now()),
    source: scan.source || state.currentScan?.source || "unknown",
    status,
    startedAt,
    finishedAt,
    durationMs: roundMs(durationMs(startedAt)),
    listingsFound: Number(scan.listingsFound || 0),
    newAlerts: Number(scan.newAlerts || 0),
    lanes: scan.lanes || [],
    rateLimited: Boolean(scan.rateLimited),
    error: scan.error || null,
    history: scan.history || null,
    historyError: scan.historyError || null,
    engines: state.currentScan?.engines || {}
  };

  state.lastScan = finished;
  state.currentScan = null;

  rememberEvent(
    status === "completed" ? "scan_completed" : status,
    `Scout scan ${status}.`,
    {
      scanId: finished.id,
      listingsFound: finished.listingsFound,
      newAlerts: finished.newAlerts,
      durationMs: finished.durationMs
    }
  );

  return finished;
}

function getOverallStatus() {
  const engineStatuses = Object.values(state.engines).map(engine => engine.status);
  const hasFailedEngine = engineStatuses.includes("failed");
  const hasWarningEngine = engineStatuses.includes("warning");

  if (state.currentScan) return "scanning";
  if (hasFailedEngine) return "degraded";
  if (hasWarningEngine) return "warning";
  return "healthy";
}

function summarizeRuntime(store = {}, options = {}) {
  const scans = store.scans || [];
  const latestScan = scans[0] || null;
  const recentFailures = scans.slice(0, 10).filter(scan => ["failed", "rate_limited"].includes(scan.status)).length;

  return {
    status: getOverallStatus(),
    startedAt: state.startedAt,
    lastUpdatedAt: state.lastUpdatedAt,
    currentScan: state.currentScan,
    lastScan: state.lastScan || latestScan,
    counters: state.counters,
    data: {
      totalListings: Object.keys(store.listings || {}).length,
      totalAlerts: (store.alerts || []).length,
      totalRejections: (store.rejections || []).length,
      totalScans: scans.length,
      recentFailures
    },
    engines: {
      scout: state.engines.scout || { name: "scout", status: options.scoutEnabled ? "ok" : "disabled", updatedAt: nowIso() },
      ebay: state.engines.ebay || { name: "ebay", status: "unknown", updatedAt: nowIso() },
      history: state.engines.history || { name: "history", status: "unknown", updatedAt: nowIso() },
      comps: state.engines.comps || { name: "comps", status: "ok", updatedAt: nowIso() },
      confidence: state.engines.confidence || { name: "confidence", status: "ok", updatedAt: nowIso() },
      grading: state.engines.grading || { name: "grading", status: "ok", updatedAt: nowIso() },
      quality: state.engines.quality || { name: "quality", status: "ok", updatedAt: nowIso() },
      notifications: state.engines.notifications || { name: "notifications", status: "unknown", updatedAt: nowIso() },
      config: state.engines.config || { name: "config", status: "unknown", updatedAt: nowIso() }
    },
    rateLimitProtection: options.rateLimitProtection || {},
    recentEvents: state.events.slice(0, 25)
  };
}

function resetTransientState() {
  state.currentScan = null;
  rememberEvent("system_reset", "Transient health state reset.");
}

module.exports = {
  startScan,
  markScanSkipped,
  recordScanEngine,
  finishScan,
  setEngine,
  rememberEvent,
  summarizeRuntime,
  resetTransientState
};
