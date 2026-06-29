// engines/notificationEngine.js
// CardHawk Notification Engine v1
// Sends deal alerts by email or carrier email-to-SMS gateway.

let nodemailer;
try {
  nodemailer = require("nodemailer");
} catch (error) {
  nodemailer = null;
}

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

function getTransporter() {
  if (!nodemailer) {
    throw new Error("nodemailer is not installed. Add it to package.json dependencies.");
  }

  const host = env("SMTP_HOST", "smtp.gmail.com");
  const port = Number(env("SMTP_PORT", "465"));
  const secure = String(env("SMTP_SECURE", "true")).toLowerCase() === "true";
  const user = env("SMTP_USER");
  const pass = env("SMTP_PASS");

  if (!user || !pass) {
    throw new Error("Missing SMTP_USER or SMTP_PASS environment variable.");
  }

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass }
  });
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

async function sendDealAlert(listing, options = {}) {
  if (!isEnabled() && !options.force) {
    return { sent: false, reason: "alerts disabled" };
  }

  const to = options.to || env("ALERT_TO");
  const from = options.from || env("ALERT_FROM") || env("SMTP_USER");

  if (!to) {
    return { sent: false, reason: "missing ALERT_TO" };
  }

  const key = buildAlertKey(listing);
  if (!options.force && sentAlertKeys.has(key)) {
    return { sent: false, reason: "duplicate alert skipped", key };
  }

  const transporter = getTransporter();
  const subject = options.subject || `CardHawk Deal: $${money(listing.totalCost || listing.price)}`;
  const text = options.smsOnly ? buildSmsBody(listing) : buildEmailBody(listing);

  const info = await transporter.sendMail({
    from,
    to,
    subject,
    text
  });

  sentAlertKeys.add(key);

  return {
    sent: true,
    messageId: info.messageId || null,
    to,
    key
  };
}

async function sendTestAlert(options = {}) {
  return sendDealAlert({
    ebayItemId: "cardhawk-test-alert",
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
    hasNodemailer: Boolean(nodemailer),
    hasSmtpUser: Boolean(env("SMTP_USER")),
    hasSmtpPass: Boolean(env("SMTP_PASS")),
    hasAlertTo: Boolean(env("ALERT_TO")),
    alertTo: env("ALERT_TO") || null
  };
}

module.exports = {
  sendDealAlert,
  sendTestAlert,
  getStatus,
  buildSmsBody,
  buildEmailBody
};
