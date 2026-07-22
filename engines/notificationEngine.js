// engines/notificationEngine.js
// CardHawk Notification Engine v2
// Sends deal alerts through Resend HTTP API instead of SMTP.

const path = require("path");
const stateStore = require("../utils/stateStore");
const serializationInstrumentation = require("../utils/serializationInstrumentation");

const NOTIFICATION_STATE_FILE = path.join(__dirname, "..", "data", "notificationState.json");
const MAX_SENT_ALERT_KEYS = 1000;

let sentAlertKeys = [];
let stateFilePath = NOTIFICATION_STATE_FILE;
let resendPoster = postToResend;

function nowIso() {
  return new Date().toISOString();
}

function createDefaultNotificationState() {
  return {
    version: 1,
    savedAt: null,
    sentAlertKeys: []
  };
}

function normalizeNotificationState(state = {}) {
  return {
    version: 1,
    savedAt: state.savedAt || null,
    sentAlertKeys: Array.isArray(state.sentAlertKeys)
      ? state.sentAlertKeys.filter(Boolean).slice(-MAX_SENT_ALERT_KEYS)
      : []
  };
}

function loadNotificationState(filePath = stateFilePath) {
  const loaded = serializationInstrumentation.withSerializationGroup("Notification", () =>
    stateStore.loadJsonState(filePath, createDefaultNotificationState())
  );
  const normalized = normalizeNotificationState(loaded);
  sentAlertKeys = normalized.sentAlertKeys;
  return normalized;
}

function saveNotificationState(filePath = stateFilePath) {
  const state = {
    version: 1,
    savedAt: nowIso(),
    sentAlertKeys: sentAlertKeys.slice(-MAX_SENT_ALERT_KEYS)
  };

  serializationInstrumentation.withSerializationGroup("Notification", () =>
    stateStore.saveJsonState(filePath, state)
  );
  return state;
}

function hasSentAlertKey(key) {
  return sentAlertKeys.includes(key);
}

function rememberSentAlertKey(key) {
  if (!key) return null;

  sentAlertKeys = sentAlertKeys.filter((existingKey) => existingKey !== key);
  sentAlertKeys.push(key);
  sentAlertKeys = sentAlertKeys.slice(-MAX_SENT_ALERT_KEYS);
  return saveNotificationState();
}

loadNotificationState();

function env(name, fallback = "") {
  return process.env[name] || fallback;
}

function isEnabled() {
  return String(env("CARDHAWK_ALERTS_ENABLED", "false")).toLowerCase() === "true";
}

function money(value) {
  return Number(value || 0).toFixed(2);
}

function percent(value) {
  return Math.round(Number(value || 0) * 100);
}

function timeoutMs() {
  return Number(env("RESEND_TIMEOUT_MS", "15000"));
}

function threshold(name, fallback) {
  const value = Number(env(name, String(fallback)));
  return Number.isFinite(value) ? value : fallback;
}

function getAlertThresholds() {
  return {
    minProfit: threshold("CARDHAWK_ALERT_MIN_PROFIT", 75),
    minRoi: threshold("CARDHAWK_ALERT_MIN_ROI", 0.35),
    minScore: threshold("CARDHAWK_ALERT_MIN_SCORE", 90),
    minConfidence: threshold("CARDHAWK_ALERT_MIN_CONFIDENCE", 70)
  };
}

function evaluateAlertRules(listing) {
  const rules = getAlertThresholds();
  const profit = Number(listing.estimatedProfit || 0);
  const roi = Number(listing.roi || 0);
  const score = Number(listing.score || 0);
  const confidence = Number(listing.marketConfidence || listing.compData?.confidence || 0);

  const failures = [];
  if (profit < rules.minProfit) failures.push(`profit ${money(profit)} below ${money(rules.minProfit)}`);
  if (roi < rules.minRoi) failures.push(`ROI ${percent(roi)}% below ${percent(rules.minRoi)}%`);
  if (score < rules.minScore) failures.push(`score ${Math.round(score)} below ${rules.minScore}`);
  if (confidence < rules.minConfidence) failures.push(`confidence ${Math.round(confidence)} below ${rules.minConfidence}`);

  return {
    passed: failures.length === 0,
    failures,
    rules,
    metrics: { profit, roi, score, confidence }
  };
}

function getResendApiKey() {
  return env("RESEND_API_KEY");
}

function getFromAddress() {
  return env("RESEND_FROM") || env("ALERT_FROM") || "CardHawk <onboarding@resend.dev>";
}

function getAlertTo() {
  return env("ALERT_TO");
}

function buildAlertKey(listing) {
  const id = listing.ebayItemId || listing.id || listing.url || listing.title;
  return `${id}:${listing.score || 0}:${money(listing.totalCost || listing.price)}`;
}

function buildSmsBody(listing) {
  const lane = listing.lane ? String(listing.lane).toUpperCase() : "CARD";
  const price = money(listing.totalCost || listing.price);
  const profit = money(listing.estimatedProfit);
  const roi = percent(listing.roi);
  const confidence = Math.round(Number(listing.marketConfidence || 0));
  const score = Math.round(Number(listing.score || 0));
  const title = String(listing.title || "CardHawk deal").slice(0, 95);
  const url = listing.url || "";

  return [
    `CardHawk ${lane}`,
    title,
    `$${price} | Profit $${profit} | ROI ${roi}%`,
    `Score ${score}/100 | Conf ${confidence}%`,
    url
  ].filter(Boolean).join("\n");
}

function buildEmailBody(listing) {
  const sms = buildSmsBody(listing);
  const compSource = listing.compSource || listing.compData?.source || "unknown";
  const compCount = listing.compCount ?? listing.compData?.compCount ?? 0;

  return `${sms}\n\nComp Source: ${compSource}\nComp Count: ${compCount}\nCondition: ${listing.condition || "Unknown"}\nSeller: ${listing.sellerUsername || "Unknown"}`;
}

async function postToResend(payload) {
  const apiKey = getResendApiKey();
  if (!apiKey) {
    throw new Error("Missing RESEND_API_KEY environment variable.");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs());

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: serializationInstrumentation.instrumentJsonStringify(payload, undefined, undefined, {
        sourceFile: "engines/notificationEngine.js",
        functionName: "postToResend",
        serializationType: "json_http_payload",
        group: "Notification"
      }),
      signal: controller.signal
    });

    const text = await response.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch (error) {
      data = { raw: text };
    }

    if (!response.ok) {
      const message = data?.message || data?.error || text || `Resend API error ${response.status}`;
      throw new Error(message);
    }

    return data;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`CardHawk Resend notification timed out after ${timeoutMs()}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function sendDealAlert(listing, options = {}) {
  if (!isEnabled() && !options.force) {
    return { sent: false, reason: "alerts disabled" };
  }

  const to = options.to || getAlertTo();
  const from = options.from || getFromAddress();

  if (!to) {
    return { sent: false, reason: "missing ALERT_TO" };
  }

  const ruleCheck = evaluateAlertRules(listing);
  if (!options.force && !ruleCheck.passed) {
    return {
      sent: false,
      reason: "alert thresholds not met",
      failures: ruleCheck.failures,
      rules: ruleCheck.rules,
      metrics: ruleCheck.metrics
    };
  }

  const key = buildAlertKey(listing);
  if (!options.force && hasSentAlertKey(key)) {
    return { sent: false, reason: "duplicate alert skipped", key };
  }

  const subject = options.subject || `CardHawk Deal: $${money(listing.totalCost || listing.price)}`;
  const text = options.smsOnly ? buildSmsBody(listing) : buildEmailBody(listing);

  const result = await resendPoster({
    from,
    to: to.split(",").map(item => item.trim()).filter(Boolean),
    subject,
    text
  });

  if (!options.force) {
    try {
      rememberSentAlertKey(key);
    } catch (error) {
      console.warn("Notification Engine failed to persist sent alert key:", error.message);
    }
  }

  return {
    sent: true,
    provider: "resend",
    id: result.id || null,
    to,
    key
  };
}

async function sendTestAlert(options = {}) {
  return sendDealAlert({
    ebayItemId: `cardhawk-test-alert-${Date.now()}`,
    lane: "test",
    title: "CardHawk test alert — notifications are working",
    price: 1,
    shipping: 0,
    totalCost: 1,
    estimatedProfit: 25,
    roi: 0.5,
    score: 99,
    marketConfidence: 90,
    compCount: 5,
    compSource: "test",
    condition: "Test",
    sellerUsername: "CardHawk",
    url: "https://cardhawk-production.up.railway.app"
  }, { ...options, force: true, subject: "CardHawk Test Alert", smsOnly: true });
}

function getStatus() {
  return {
    enabled: isEnabled(),
    provider: "resend",
    hasResendApiKey: Boolean(getResendApiKey()),
    hasAlertTo: Boolean(getAlertTo()),
    alertTo: getAlertTo() || null,
    from: getFromAddress(),
    timeoutMs: timeoutMs(),
    thresholds: getAlertThresholds()
  };
}

function __setNotificationStateFileForTests(filePath) {
  stateFilePath = filePath;
  return loadNotificationState(filePath);
}

function __setResendPosterForTests(poster) {
  resendPoster = poster || postToResend;
}

function __resetForTests() {
  sentAlertKeys = [];
  stateFilePath = NOTIFICATION_STATE_FILE;
  resendPoster = postToResend;
  loadNotificationState();
}

module.exports = {
  sendDealAlert,
  sendTestAlert,
  getStatus,
  buildSmsBody,
  buildEmailBody,
  evaluateAlertRules,
  getAlertThresholds,
  __setNotificationStateFileForTests,
  __setResendPosterForTests,
  __resetForTests
};
