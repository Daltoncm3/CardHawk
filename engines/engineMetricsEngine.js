'use strict';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function round(value, digits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const factor = 10 ** digits;
  return Math.round(number * factor) / factor;
}

function percent(part, total) {
  if (!total) return null;
  return round((part / total) * 100, 2);
}

function countBy(scans, predicate) {
  return scans.filter(predicate).length;
}

function average(values) {
  const usable = asArray(values).map((value) => toNumber(value, NaN)).filter(Number.isFinite);
  if (!usable.length) return null;
  return round(usable.reduce((sum, value) => sum + value, 0) / usable.length, 2);
}

function summarizeScans(scans = [], health = {}) {
  const recentScans = asArray(scans);
  const totalScans = recentScans.length;
  const completedScans = countBy(recentScans, (scan) => scan.status === 'completed');
  const failedScans = countBy(recentScans, (scan) => scan.status === 'failed');
  const rateLimitedScans = countBy(recentScans, (scan) => scan.status === 'rate_limited' || scan.rateLimited);
  const skippedScans = countBy(recentScans, (scan) => scan.status === 'skipped');
  const scansWithDuration = recentScans.filter((scan) => Number.isFinite(Number(scan.durationMs)));
  const listingsFound = recentScans.map((scan) => toNumber(scan.listingsFound, 0));
  const alertsFound = recentScans.map((scan) => toNumber(scan.newAlerts, 0));

  return {
    totalScans,
    completedScans,
    failedScans,
    rateLimitedScans,
    skippedScans,
    successRatePercent: percent(completedScans, totalScans),
    failureRatePercent: percent(failedScans, totalScans),
    rateLimitRatePercent: percent(rateLimitedScans, totalScans),
    averageDurationMs: average(scansWithDuration.map((scan) => scan.durationMs)),
    averageDurationSeconds: average(scansWithDuration.map((scan) => toNumber(scan.durationMs, 0) / 1000)),
    averageListingsFoundPerScan: average(listingsFound),
    averageNewAlertsPerScan: average(alertsFound),
    totalListingsFound: listingsFound.reduce((sum, value) => sum + value, 0),
    totalNewAlertsFromScans: alertsFound.reduce((sum, value) => sum + value, 0),
    counters: asObject(health.counters)
  };
}

function summarizeAlerts(store = {}) {
  const totalAlerts = asArray(store.alerts).length;
  const totalRejections = asArray(store.rejections).length;
  const totalDecisions = totalAlerts + totalRejections;

  return {
    totalAlerts,
    totalRejections,
    totalDecisions,
    alertRatePercent: percent(totalAlerts, totalDecisions),
    rejectionRatePercent: percent(totalRejections, totalDecisions),
    alertToRejectionRatio: totalRejections ? round(totalAlerts / totalRejections, 4) : null
  };
}

function summarizeEngines(health = {}) {
  const engines = Object.values(asObject(health.engines));
  const counts = engines.reduce((result, engine) => {
    const status = engine.status || 'unknown';
    result[status] = (result[status] || 0) + 1;
    return result;
  }, {});

  return {
    overallStatus: health.status || 'unknown',
    totalEngines: engines.length,
    statusCounts: counts,
    engines: engines.map((engine) => ({
      name: engine.name,
      status: engine.status || 'unknown',
      updatedAt: engine.updatedAt || null
    }))
  };
}

function summarizeData(store = {}, health = {}) {
  const listings = asObject(store.listings);
  const scans = asArray(store.scans);
  const alerts = asArray(store.alerts);
  const rejections = asArray(store.rejections);
  const healthData = asObject(health.data);

  return {
    totalListings: Object.keys(listings).length,
    totalAlerts: alerts.length,
    totalRejections: rejections.length,
    totalScans: scans.length,
    recentFailures: toNumber(healthData.recentFailures, 0),
    healthData
  };
}

function summarizeEngineMetrics(store = {}, health = {}) {
  const scans = asArray(store.scans);

  return {
    generatedAt: new Date().toISOString(),
    source: 'engine_metrics_engine',
    scans: summarizeScans(scans, health),
    alerts: summarizeAlerts(store),
    health: summarizeEngines(health),
    data: summarizeData(store, health)
  };
}

module.exports = {
  summarizeEngineMetrics
};
