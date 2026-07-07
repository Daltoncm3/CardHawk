'use strict';

function hasValue(env, name) {
  return Boolean(String(env?.[name] || '').trim());
}

function isEnabled(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).trim().toLowerCase() === 'true';
}

function addIssue(result, severity, area, variable, message) {
  const issue = { severity, area, variable, message };
  if (severity === 'critical') result.criticalIssues.push(issue);
  else result.warnings.push(issue);
}

function normalizeMode(value) {
  const mode = String(value || 'paper').trim().toLowerCase();
  return ['paper', 'production'].includes(mode) ? mode : 'paper';
}

function evaluateConfigReadiness(env = process.env, options = {}) {
  const scoutEnabled = options.scoutEnabled ?? isEnabled(env.SCOUT_ENABLED, true);
  const alertsEnabled = options.alertsEnabled ?? isEnabled(env.CARDHAWK_ALERTS_ENABLED, false);
  const mode = normalizeMode(env.CARDHAWK_MODE);
  const rawMode = String(env.CARDHAWK_MODE || '').trim().toLowerCase();

  const result = {
    status: 'ready',
    mode,
    criticalIssues: [],
    warnings: [],
    checks: {
      auth: 'ok',
      ebay: scoutEnabled ? 'ok' : 'disabled',
      notifications: alertsEnabled ? 'ok' : 'disabled'
    },
    config: {
      mode,
      scoutEnabled: Boolean(scoutEnabled),
      alertsEnabled: Boolean(alertsEnabled),
      hasAuthUser: hasValue(env, 'CARDHAWK_USER'),
      hasAuthPassword: hasValue(env, 'CARDHAWK_PASS'),
      hasEbayAppId: hasValue(env, 'EBAY_APP_ID'),
      hasEbayCertId: hasValue(env, 'EBAY_CERT_ID'),
      hasResendApiKey: hasValue(env, 'RESEND_API_KEY'),
      hasAlertTo: hasValue(env, 'ALERT_TO')
    }
  };

  if (rawMode && rawMode !== mode) {
    addIssue(result, 'warning', 'mode', 'CARDHAWK_MODE', 'Invalid CardHawk mode configured; falling back to paper mode.');
  }

  if (!result.config.hasAuthUser) {
    result.checks.auth = 'missing';
    addIssue(result, 'critical', 'auth', 'CARDHAWK_USER', 'CardHawk login user is not configured.');
  }

  if (!result.config.hasAuthPassword) {
    result.checks.auth = 'missing';
    addIssue(result, 'critical', 'auth', 'CARDHAWK_PASS', 'CardHawk login password is not configured.');
  }

  if (scoutEnabled && (!result.config.hasEbayAppId || !result.config.hasEbayCertId)) {
    result.checks.ebay = 'missing';
    if (!result.config.hasEbayAppId) {
      addIssue(result, 'critical', 'ebay', 'EBAY_APP_ID', 'Scout Engine is enabled but eBay app ID is not configured.');
    }
    if (!result.config.hasEbayCertId) {
      addIssue(result, 'critical', 'ebay', 'EBAY_CERT_ID', 'Scout Engine is enabled but eBay cert ID is not configured.');
    }
  } else if (!scoutEnabled && (!result.config.hasEbayAppId || !result.config.hasEbayCertId)) {
    result.checks.ebay = 'disabled';
    addIssue(result, 'warning', 'ebay', 'EBAY_APP_ID/EBAY_CERT_ID', 'eBay credentials are not fully configured, but Scout Engine is disabled.');
  }

  if (alertsEnabled && (!result.config.hasResendApiKey || !result.config.hasAlertTo)) {
    result.checks.notifications = 'missing';
    if (!result.config.hasResendApiKey) {
      addIssue(result, 'warning', 'notifications', 'RESEND_API_KEY', 'Alerts are enabled but Resend API key is not configured.');
    }
    if (!result.config.hasAlertTo) {
      addIssue(result, 'warning', 'notifications', 'ALERT_TO', 'Alerts are enabled but alert recipient is not configured.');
    }
  } else if (!alertsEnabled && (!result.config.hasResendApiKey || !result.config.hasAlertTo)) {
    result.checks.notifications = 'disabled';
    addIssue(result, 'warning', 'notifications', 'RESEND_API_KEY/ALERT_TO', 'Notification delivery is not fully configured, but alerts are disabled.');
  }

  if (result.criticalIssues.length) result.status = 'failed';
  else if (result.warnings.length) result.status = 'warning';

  return result;
}

module.exports = {
  evaluateConfigReadiness
};
