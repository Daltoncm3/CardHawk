// engines/notificationEngine.js
// CardHawk Notification Engine v2
// Sends deal alerts through Resend HTTP API instead of SMTP.

const sentAlertKeys = new Set();

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
      body: JSON.stringify(payload),
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

  const key = buildAlertKey(listing);
  if (!options.force && sentAlertKeys.has(key)) {
    return { sent: false, reason: "duplicate alert skipped", key };
  }

  const subject = options.subject || `CardHawk Deal: $${money(listing.totalCost || listing.price)}`;
  const text = options.smsOnly ? buildSmsBody(listing) : buildEmailBody(listing);

  const result = await postToResend({
    from,
    to: to.split(",").map(item => item.trim()).filter(Boolean),
    subject,
    text
  });

  sentAlertKeys.add(key);

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
    timeoutMs: timeoutMs()
  };
}

module.exports = {
  sendDealAlert,
  sendTestAlert,
  getStatus,
  buildSmsBody,
  buildEmailBody
};
