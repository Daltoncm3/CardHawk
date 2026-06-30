const express = require("express");
const fs = require("fs");
const path = require("path");
const historyEngine = require("./engines/historyEngine");
const compEngine = require("./engines/compEngine");
const notificationEngine = require("./engines/notificationEngine");
const confidenceEngine = require("./engines/confidenceEngine");
const populationEngine = require("./engines/populationEngine");
const gradingEngine = require("./engines/gradingEngine");
const qualityEngine = require("./engines/qualityEngine");
const systemHealth = require("./engines/systemHealth");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "cardhawk-data.json");

const LANES = {
  all: { label: "All", queries: [] },
  baseball: {
    label: "Baseball",
    queries: [
      "PSA 10 baseball rookie auto",
      "Bowman Chrome baseball auto",
      "1st Bowman auto baseball",
      "Topps Chrome baseball rookie auto",
      "baseball rookie autograph numbered"
    ]
  },
  football: {
    label: "Football",
    queries: [
      "PSA 10 football rookie auto",
      "Prizm football rookie silver",
      "Optic football rookie auto",
      "football rookie autograph numbered",
      "Downtown football rookie card"
    ]
  },
  basketball: {
    label: "Basketball",
    queries: [
      "PSA 10 basketball rookie auto",
      "Prizm basketball rookie silver",
      "Optic basketball rookie auto",
      "basketball rookie autograph numbered",
      "National Treasures basketball RPA"
    ]
  },
  hockey: {
    label: "Hockey",
    queries: [
      "PSA 10 hockey rookie auto",
      "Young Guns PSA 10 hockey",
      "hockey rookie autograph numbered",
      "Upper Deck hockey rookie PSA 10"
    ]
  },
  soccer: {
    label: "Soccer",
    queries: [
      "PSA 10 soccer rookie auto",
      "Prizm soccer rookie silver",
      "soccer rookie autograph numbered",
      "Topps Chrome soccer rookie auto"
    ]
  },
  pokemon: {
    label: "Pokémon",
    queries: [
      "Pokemon PSA 10 Charizard",
      "Pokemon alt art PSA 10",
      "Pokemon SAR PSA 10",
      "Pokemon Japanese PSA 10",
      "Pokemon rookie card PSA 10"
    ]
  },
  racing: {
    label: "Racing",
    queries: [
      "F1 Chrome PSA 10 rookie",
      "Formula 1 Topps Chrome auto",
      "F1 Sapphire PSA 10",
      "NASCAR rookie auto PSA 10"
    ]
  },
  ufc: {
    label: "UFC",
    queries: [
      "UFC Prizm rookie auto",
      "UFC PSA 10 rookie",
      "UFC numbered autograph card",
      "UFC rookie silver Prizm"
    ]
  }
};

const SCOUT_INTERVAL_MINUTES = Number(process.env.SCOUT_INTERVAL_MINUTES || 10);
const SCOUT_ENABLED = String(process.env.SCOUT_ENABLED || "true").toLowerCase() === "true";

// Phase 1: eBay rate-limit protection.
// These defaults intentionally slow CardHawk down so it behaves like a steady scout, not a request spammer.
const EBAY_SEARCH_DELAY_MS = Number(process.env.EBAY_SEARCH_DELAY_MS || 2500);
const EBAY_LANE_DELAY_MS = Number(process.env.EBAY_LANE_DELAY_MS || 6000);
const EBAY_MAX_RETRIES = Number(process.env.EBAY_MAX_RETRIES || 2);
const EBAY_BACKOFF_BASE_MS = Number(process.env.EBAY_BACKOFF_BASE_MS || 15000);
const EBAY_SCAN_QUERY_LIMIT = Number(process.env.EBAY_SCAN_QUERY_LIMIT || 8);

let ebayTokenCache = { token: null, expiresAt: 0 };
let scanInProgress = false;

let store = {
  listings: {},
  alerts: [],
  scans: [],
  rejections: [],
  settings: {
    minDealScore: 85,
    minProfit: 20,
    minRoi: 0.25
  }
};

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
}

function loadStore() {
  try {
    ensureDataFile();
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const loaded = JSON.parse(raw);

    store = {
      listings: loaded.listings || {},
      alerts: loaded.alerts || [],
      scans: loaded.scans || [],
      rejections: loaded.rejections || [],
      settings: {
        minDealScore: loaded.settings?.minDealScore || 85,
        minProfit: loaded.settings?.minProfit || 20,
        minRoi: loaded.settings?.minRoi || 0.25
      }
    };

    rescoreExistingData();
    saveStore();
  } catch (error) {
    console.error("Failed to load data:", error.message);
    saveStore();
  }
}

function saveStore() {
  ensureDataFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
}

function requireLogin(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth) {
    res.setHeader("WWW-Authenticate", 'Basic realm="CardHawk"');
    return res.status(401).send("Login required");
  }

  const encoded = auth.split(" ")[1];
  const decoded = Buffer.from(encoded, "base64").toString();
  const [user, pass] = decoded.split(":");

  if (user === process.env.CARDHAWK_USER && pass === process.env.CARDHAWK_PASS) return next();

  res.setHeader("WWW-Authenticate", 'Basic realm="CardHawk"');
  return res.status(401).send("Invalid login");
}

app.use(requireLogin);

function money(value) {
  return Number(value || 0).toFixed(2);
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseErrorPayload(message) {
  try {
    return JSON.parse(message);
  } catch (_) {
    return null;
  }
}

function isEbayRateLimitError(error) {
  const message = String(error?.message || error || "");
  if (/too many requests|request limit|rate limit|429/i.test(message)) return true;

  const payload = parseErrorPayload(message);
  const errors = payload?.errors || [];
  return errors.some(item =>
    Number(item.errorId) === 2001 ||
    /too many requests|request limit|rate limit/i.test(`${item.message || ""} ${item.longMessage || ""}`)
  );
}

function compactEbayError(error) {
  const payload = parseErrorPayload(error?.message);
  const first = payload?.errors?.[0];
  if (first) {
    return `${first.message || "eBay error"}${first.longMessage ? ` — ${first.longMessage}` : ""}`;
  }
  return error?.message || String(error);
}

async function getEbayToken() {
  const now = Date.now();
  if (ebayTokenCache.token && ebayTokenCache.expiresAt > now + 60_000) return ebayTokenCache.token;

  const credentials = Buffer.from(
    `${process.env.EBAY_APP_ID.trim()}:${process.env.EBAY_CERT_ID.trim()}`
  ).toString("base64");

  const response = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope"
  });

  const data = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(data));

  ebayTokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + Number(data.expires_in || 7200) * 1000
  };

  return ebayTokenCache.token;
}

async function searchEbay(query, limit = 20) {
  const token = await getEbayToken();
  const url = new URL("https://api.ebay.com/buy/browse/v1/item_summary/search");

  url.searchParams.set("q", query);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("filter", "buyingOptions:{FIXED_PRICE|AUCTION}");

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": "EBAY_US"
    }
  });

  const data = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(data));

  return (data.itemSummaries || []).map(normalizeEbayItem);
}

async function searchEbayWithBackoff(query, limit = EBAY_SCAN_QUERY_LIMIT) {
  let lastError = null;

  for (let attempt = 0; attempt <= EBAY_MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        const waitMs = EBAY_BACKOFF_BASE_MS * attempt;
        console.log(`eBay retry ${attempt}/${EBAY_MAX_RETRIES} for "${query}" after ${waitMs}ms`);
        await sleep(waitMs);
      }

      return await searchEbay(query, limit);
    } catch (error) {
      lastError = error;
      if (!isEbayRateLimitError(error) || attempt === EBAY_MAX_RETRIES) break;
    }
  }

  throw lastError;
}

function normalizeEbayItem(item) {
  const price = Number(item.price?.value || 0);
  const shipping = Number(item.shippingOptions?.[0]?.shippingCost?.value || 0);
  const totalCost = price + shipping;
  const parsed = parseCardTitle(item.title || "");

  return {
    ebayItemId: item.itemId,
    title: item.title || "Untitled",
    price,
    shipping,
    totalCost,
    currency: item.price?.currency || "USD",
    condition: item.condition || "Unknown",
    url: item.itemWebUrl,
    image: item.image?.imageUrl || "",
    sellerUsername: item.seller?.username || "Unknown",
    sellerFeedbackPercentage: Number(item.seller?.feedbackPercentage || 0),
    sellerFeedbackScore: Number(item.seller?.feedbackScore || 0),
    buyingOptions: item.buyingOptions || [],
    itemEndDate: item.itemEndDate || null,
    parsed,
    raw: item
  };
}

function detectLane(title, fallbackLane = "all") {
  const lower = title.toLowerCase();

  if (/\b(pokemon|charizard|pikachu|mewtwo|umbreon|eevee|sylveon|lugia|rayquaza|sar|alt art)\b/i.test(lower)) return "pokemon";
  if (/\b(baseball|bowman|topps chrome|mlb|prospects)\b/i.test(lower)) return "baseball";
  if (/\b(football|nfl|prizm football|optic football|downtown)\b/i.test(lower)) return "football";
  if (/\b(basketball|nba|prizm basketball|optic basketball|national treasures)\b/i.test(lower)) return "basketball";
  if (/\b(hockey|nhl|young guns|upper deck)\b/i.test(lower)) return "hockey";
  if (/\b(soccer|futbol|prizm soccer|topps chrome soccer)\b/i.test(lower)) return "soccer";
  if (/\b(f1|formula 1|racing|nascar|sapphire)\b/i.test(lower)) return "racing";
  if (/\b(ufc|mma|octagon)\b/i.test(lower)) return "ufc";

  return fallbackLane;
}

function parseCardTitle(title) {
  const lower = title.toLowerCase();

  const yearMatch = lower.match(/\b(19[5-9][0-9]|20[0-3][0-9])\b/);
  const gradeMatch = lower.match(/\b(psa|sgc|bgs|cgc)\s*(10|9\.5|9|8\.5|8)\b/i);
  const numberedMatch = lower.match(/\/\s*(\d{1,4})\b/);

  const isClearlySealedWax =
    /\b(sealed|unopened|factory sealed|hobby box|blaster box|mega box sealed|sealed box|pack lot|wax box)\b/i.test(title);

  const flags = {
    autograph: /\b(auto|autograph|signed|signature)\b/i.test(title),
    rookie: /\b(rookie|rc|1st bowman)\b/i.test(title),
    graded: /\b(psa|sgc|bgs|cgc)\b/i.test(title),
    numbered: Boolean(numberedMatch),
    chrome: /\bchrome\b/i.test(title),
    bowman: /\bbowman\b/i.test(title),
    topps: /\btopps\b/i.test(title),
    prizm: /\bprizm\b/i.test(title),
    optic: /\boptic\b/i.test(title),
    refractor: /\b(refractor|silver|mojo|wave|sapphire|cracked ice)\b/i.test(title),
    firstBowman: /\b1st bowman\b/i.test(title),
    lot: /\b(lot|collection|bulk|mystery|repack|break)\b/i.test(title),
    reprint: /\b(reprint|rp|facsimile)\b/i.test(title),
    digital: /\b(digital|nft)\b/i.test(title),
    custom: /\b(custom|art card)\b/i.test(title),
    sealed: isClearlySealedWax,
    pokemon: /\b(pokemon|charizard|pikachu|umbreon|mewtwo|sar|alt art)\b/i.test(title)
  };

  let setName = "Unknown";
  if (flags.bowman && flags.chrome) setName = "Bowman Chrome";
  else if (flags.topps && flags.chrome) setName = "Topps Chrome";
  else if (flags.prizm) setName = "Prizm";
  else if (flags.optic) setName = "Optic";
  else if (flags.bowman) setName = "Bowman";
  else if (flags.topps) setName = "Topps";
  else if (flags.pokemon) setName = "Pokémon";

  let qualityTier = "generic";
  if (flags.reprint || flags.digital || flags.custom || flags.sealed) qualityTier = "avoid";
  else if (flags.lot) qualityTier = "low-confidence";
  else if (flags.graded && flags.autograph && flags.rookie) qualityTier = "premium";
  else if (flags.graded && flags.pokemon) qualityTier = "premium";
  else if (flags.autograph && flags.rookie) qualityTier = "strong";
  else if (flags.graded || flags.autograph || flags.rookie || flags.numbered) qualityTier = "watch";

  return {
    year: yearMatch ? Number(yearMatch[1]) : null,
    gradeCompany: gradeMatch ? gradeMatch[1].toUpperCase() : null,
    grade: gradeMatch ? Number(gradeMatch[2]) : null,
    numberedTo: numberedMatch ? Number(numberedMatch[1]) : null,
    setName,
    qualityTier,
    flags
  };
}

function estimateMarketValue(listing) {
  const parsed = listing.parsed || parseCardTitle(listing.title);
  let multiplier = 1.05;

  if (parsed.flags.graded) multiplier += 0.25;
  if (parsed.grade === 10) multiplier += 0.35;
  if (parsed.grade === 9.5) multiplier += 0.18;
  if (parsed.flags.autograph) multiplier += 0.25;
  if (parsed.flags.rookie) multiplier += 0.18;
  if (parsed.flags.firstBowman) multiplier += 0.22;
  if (parsed.flags.numbered) multiplier += 0.18;
  if (parsed.flags.refractor) multiplier += 0.12;
  if (parsed.setName === "Bowman Chrome") multiplier += 0.14;
  if (parsed.setName === "Topps Chrome") multiplier += 0.1;
  if (parsed.setName === "Prizm") multiplier += 0.12;
  if (parsed.setName === "Optic") multiplier += 0.08;
  if (parsed.flags.pokemon) multiplier += 0.15;

  if (parsed.flags.lot) multiplier -= 0.55;
  if (parsed.flags.sealed) multiplier -= 0.75;
  if (parsed.flags.reprint) multiplier -= 0.95;
  if (parsed.flags.digital) multiplier -= 0.95;
  if (parsed.flags.custom) multiplier -= 0.85;

  return Math.max(0, listing.totalCost * multiplier);
}

function scoreListing(listing, compUniverse = []) {
  const parsed = listing.parsed || parseCardTitle(listing.title);
  const compData = compEngine.evaluateListing(listing, compUniverse, {
    fallbackEstimator: estimateMarketValue
  });
  const confidenceData = confidenceEngine.evaluateConfidence(listing, compData, compUniverse);
  const populationData = populationEngine.getPopulation(listing);
  const estimatedValue = compData.marketValue;
  const ebayFees = estimatedValue * 0.1325;
  const estimatedProfit = estimatedValue - listing.totalCost - ebayFees;
  const roi = listing.totalCost > 0 ? estimatedProfit / listing.totalCost : 0;

  let score = 0;

  if (parsed.qualityTier === "premium") score += 45;
  if (parsed.qualityTier === "strong") score += 35;
  if (parsed.qualityTier === "watch") score += 20;
  if (parsed.qualityTier === "generic") score += 3;
  if (parsed.qualityTier === "low-confidence") score -= 30;
  if (parsed.qualityTier === "avoid") score = 0;

  if (estimatedProfit >= 20) score += 15;
  if (estimatedProfit >= 40) score += 15;
  if (estimatedProfit >= 75) score += 10;
  if (roi >= 0.25) score += 12;
  if (roi >= 0.4) score += 10;
  if (roi >= 0.6) score += 8;

  if (confidenceData.confidence >= 75) score += 14;
  else if (confidenceData.confidence >= 60) score += 10;
  else if (confidenceData.confidence >= 40) score += 5;
  else if (confidenceData.confidence <= 15) score -= 10;

  if (compData.source === "active_market") score += 3;
  if (compData.source === "heuristic_fallback") score -= 6;

  if (parsed.flags.firstBowman) score += 8;
  if (parsed.flags.numbered) score += 7;
  if (parsed.grade === 10) score += 8;
  if (parsed.setName === "Bowman Chrome") score += 6;
  if (parsed.setName === "Topps Chrome") score += 5;
  if (parsed.setName === "Prizm") score += 5;
  if (parsed.flags.pokemon && parsed.grade === 10) score += 8;

  if (parsed.flags.lot) score -= 45;
  if (parsed.flags.sealed) score -= 80;
  if (parsed.flags.reprint) score -= 100;
  if (parsed.flags.digital) score -= 100;
  if (parsed.flags.custom) score -= 90;

  if (listing.sellerFeedbackPercentage >= 99) score += 3;
  if (listing.sellerFeedbackScore >= 100) score += 3;

  if (listing.totalCost <= 0) score = 0;
  if (listing.totalCost > 750 && estimatedProfit < 150) score -= 20;

  const finalScore = Math.max(0, Math.min(100, Math.round(score)));
  const qualityData = qualityEngine.evaluateQuality({
    ...listing,
    parsed,
    score: finalScore,
    estimatedValue,
    estimatedProfit,
    roi,
    ebayFees,
    compData,
    marketConfidence: confidenceData.confidence,
    confidenceReasons: confidenceData.reasons,
    confidenceCap: confidenceData.cap,
    compCount: compData.compCount,
    compSource: compData.source
  });
  const dealGrade = gradingEngine.gradeDeal({
    ...listing,
    parsed,
    score: finalScore,
    estimatedValue,
    estimatedProfit,
    roi,
    ebayFees,
    compData,
    marketConfidence: confidenceData.confidence,
    confidenceReasons: confidenceData.reasons,
    confidenceCap: confidenceData.cap,
    compCount: compData.compCount,
    compSource: compData.source,
    qualityData,
    investmentQuality: qualityData.investmentQuality
  });

  return {
    score: finalScore,
    estimatedValue,
    estimatedProfit,
    roi,
    ebayFees,
    compData,
    confidenceData,
    marketConfidence: confidenceData.confidence,
    confidenceReasons: confidenceData.reasons,
    confidenceCap: confidenceData.cap,
    compCount: compData.compCount,
    compSource: compData.source,
    qualityData,
    investmentQuality: qualityData.investmentQuality,
    qualityBucket: qualityData.bucket,
    liquidityScore: qualityData.liquidityScore,
    riskLevel: qualityData.riskLevel,
    qualityReasons: qualityData.positives,
    qualityWarnings: qualityData.warnings,
    dealGrade
  };
}

function dealGate(listing) {
  const parsed = listing.parsed || parseCardTitle(listing.title);
  const reasons = [];

  if (parsed.flags.reprint) reasons.push("reprint");
  if (parsed.flags.digital) reasons.push("digital");
  if (parsed.flags.custom) reasons.push("custom");
  if (parsed.flags.sealed) reasons.push("sealed wax");
  if (parsed.flags.lot) reasons.push("lot/collection/repack");
  if (listing.totalCost <= 0) reasons.push("invalid price");

  const hasStrongTrait =
    parsed.flags.graded ||
    parsed.flags.autograph ||
    parsed.flags.rookie ||
    parsed.flags.numbered ||
    parsed.flags.firstBowman ||
    parsed.flags.pokemon;

  if (!hasStrongTrait) reasons.push("not enough collector traits");
  if (listing.score < store.settings.minDealScore) reasons.push("score too low");
  if (listing.estimatedProfit < store.settings.minProfit) reasons.push("profit too low");
  if (listing.roi < store.settings.minRoi) reasons.push("ROI too low");

  return {
    passed: reasons.length === 0,
    reasons
  };
}

function saveScoutedListing(listing, query, lane) {
  const scoring = scoreListing(listing, Object.values(store.listings));
  const detectedLane = detectLane(listing.title, lane);
  const now = new Date().toISOString();
  const existing = store.listings[listing.ebayItemId];

  const saved = {
    ...listing,
    lane: detectedLane,
    query,
    score: scoring.score,
    estimatedValue: scoring.estimatedValue,
    estimatedProfit: scoring.estimatedProfit,
    roi: scoring.roi,
    ebayFees: scoring.ebayFees,
    compData: scoring.compData,
    marketConfidence: scoring.marketConfidence,
    confidenceReasons: scoring.confidenceReasons,
    confidenceCap: scoring.confidenceCap,
    compCount: scoring.compCount,
    compSource: scoring.compSource,
    qualityData: scoring.qualityData,
    investmentQuality: scoring.investmentQuality,
    qualityBucket: scoring.qualityBucket,
    liquidityScore: scoring.liquidityScore,
    riskLevel: scoring.riskLevel,
    qualityReasons: scoring.qualityReasons,
    qualityWarnings: scoring.qualityWarnings,
    dealGrade: scoring.dealGrade,
    firstSeenAt: existing?.firstSeenAt || now,
    lastSeenAt: now,
    seenCount: existing?.seenCount ? existing.seenCount + 1 : 1,
    alertCreated: existing?.alertCreated || false
  };

  const gate = dealGate(saved);
  saved.dealGate = gate;

  store.listings[listing.ebayItemId] = saved;

  if (!saved.alertCreated && gate.passed) {
    const newAlert = {
      id: `${listing.ebayItemId}-${Date.now()}`,
      ebayItemId: listing.ebayItemId,
      lane: detectedLane,
      title: listing.title,
      price: listing.price,
      shipping: listing.shipping,
      totalCost: listing.totalCost,
      estimatedValue: saved.estimatedValue,
      estimatedProfit: saved.estimatedProfit,
      roi: saved.roi,
      score: saved.score,
      marketConfidence: saved.marketConfidence,
      confidenceReasons: saved.confidenceReasons,
      confidenceCap: saved.confidenceCap,
      compCount: saved.compCount,
      compSource: saved.compSource,
      compData: saved.compData,
      qualityData: saved.qualityData,
      investmentQuality: saved.investmentQuality,
      qualityBucket: saved.qualityBucket,
      liquidityScore: saved.liquidityScore,
      riskLevel: saved.riskLevel,
      qualityReasons: saved.qualityReasons,
      qualityWarnings: saved.qualityWarnings,
      dealGrade: saved.dealGrade,
      url: listing.url,
      image: listing.image,
      query,
      parsed: saved.parsed,
      createdAt: now,
      status: "new",
      notifiedAt: null,
      notificationResult: null,
      notificationError: null
    };

    store.alerts.unshift(newAlert);
    store.listings[listing.ebayItemId].alertCreated = true;

    notificationEngine.sendDealAlert(newAlert)
      .then(result => {
        if (result?.sent) {
          newAlert.status = "notified";
          newAlert.notifiedAt = new Date().toISOString();
          newAlert.notificationResult = result;
          saveStore();
        }
      })
      .catch(error => {
        newAlert.notificationError = error.message;
        saveStore();
        console.error("Notification alert failed:", error.message);
      });
  } else if (!gate.passed) {
    store.rejections.unshift({
      ebayItemId: listing.ebayItemId,
      lane: detectedLane,
      title: listing.title,
      score: saved.score,
      estimatedProfit: saved.estimatedProfit,
      roi: saved.roi,
      marketConfidence: saved.marketConfidence,
      confidenceReasons: saved.confidenceReasons,
      confidenceCap: saved.confidenceCap,
      compCount: saved.compCount,
      compSource: saved.compSource,
      qualityData: saved.qualityData,
      investmentQuality: saved.investmentQuality,
      qualityBucket: saved.qualityBucket,
      liquidityScore: saved.liquidityScore,
      riskLevel: saved.riskLevel,
      qualityReasons: saved.qualityReasons,
      qualityWarnings: saved.qualityWarnings,
      dealGrade: saved.dealGrade,
      reasons: gate.reasons,
      createdAt: now
    });
  }

  store.rejections = store.rejections.slice(0, 300);
  return saved;
}

async function runScoutScan(source = "automatic") {
  if (scanInProgress) {
    const skippedScan = {
      id: Date.now().toString(),
      source,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      lanes: [],
      listingsFound: 0,
      newAlerts: 0,
      status: "skipped",
      error: "Another scout scan is already running."
    };

    systemHealth.markScanSkipped(skippedScan, skippedScan.error);
    store.scans.unshift(skippedScan);
    store.scans = store.scans.slice(0, 100);
    saveStore();
    return skippedScan;
  }

  scanInProgress = true;

  const scan = {
    id: Date.now().toString(),
    source,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    lanes: [],
    listingsFound: 0,
    newAlerts: 0,
    status: "running",
    error: null,
    rateLimited: false,
    queryDelayMs: EBAY_SEARCH_DELAY_MS,
    laneDelayMs: EBAY_LANE_DELAY_MS
  };

  systemHealth.startScan(scan);
  systemHealth.setEngine("scout", "running", { source, scanId: scan.id });

  const alertsBefore = store.alerts.length;
  const observedListings = [];
  const scanStartedMs = Date.now();

  try {
    for (const [laneKey, lane] of Object.entries(LANES)) {
      if (laneKey === "all") continue;

      const laneStartedMs = Date.now();
      let laneCount = 0;
      const laneErrors = [];

      for (const query of lane.queries) {
        try {
          const results = await searchEbayWithBackoff(query, EBAY_SCAN_QUERY_LIMIT);
          laneCount += results.length;
          scan.listingsFound += results.length;

          for (const listing of results) {
            const savedListing = saveScoutedListing(listing, query, laneKey);
            observedListings.push(savedListing);
          }

          systemHealth.recordScanEngine("ebay", "ok", {
            lastQuery: query,
            lane: laneKey,
            results: results.length
          });
        } catch (error) {
          const compactError = compactEbayError(error);
          laneErrors.push({ query, error: compactError });

          if (isEbayRateLimitError(error)) {
            scan.rateLimited = true;
            scan.error = compactError;
            systemHealth.recordScanEngine("ebay", "warning", {
              lane: laneKey,
              query,
              error: compactError
            });
            console.warn(`eBay rate limit reached on query "${query}". Ending this scan cleanly.`);
            break;
          }

          systemHealth.recordScanEngine("ebay", "warning", {
            lane: laneKey,
            query,
            error: compactError
          });
          console.error(`eBay query failed for "${query}":`, compactError);
        }

        await sleep(EBAY_SEARCH_DELAY_MS);
      }

      scan.lanes.push({
        lane: laneKey,
        count: laneCount,
        errors: laneErrors,
        durationMs: Date.now() - laneStartedMs
      });

      if (scan.rateLimited) break;
      await sleep(EBAY_LANE_DELAY_MS);
    }

    scan.newAlerts = store.alerts.length - alertsBefore;
    scan.status = scan.rateLimited ? "rate_limited" : "completed";
    systemHealth.setEngine("scout", scan.status === "completed" ? "ok" : "warning", {
      listingsFound: scan.listingsFound,
      newAlerts: scan.newAlerts,
      durationMs: Date.now() - scanStartedMs
    });
  } catch (error) {
    scan.status = "failed";
    scan.error = compactEbayError(error);
    systemHealth.setEngine("scout", "failed", { error: scan.error });
    console.error("Scout scan failed:", scan.error);
  }

  try {
    const historyResult = historyEngine.recordScan(observedListings, {
      scanId: scan.id,
      source
    });

    scan.history = {
      observedCount: historyResult.observedCount,
      trackedCount: historyResult.trackedCount,
      activeCount: historyResult.activeCount,
      newCount: historyResult.newListings.length,
      priceDropCount: historyResult.priceDrops.length,
      disappearedCount: historyResult.disappeared.length
    };

    systemHealth.recordScanEngine("history", "ok", scan.history);
  } catch (historyError) {
    scan.historyError = historyError.message;
    systemHealth.recordScanEngine("history", "warning", { error: historyError.message });
    console.error("History Engine failed:", historyError.message);
  } finally {
    scan.finishedAt = new Date().toISOString();
    scan.durationMs = Date.now() - scanStartedMs;
    store.scans.unshift(scan);
    store.scans = store.scans.slice(0, 100);
    store.alerts = store.alerts.slice(0, 200);

    systemHealth.finishScan(scan);
    saveStore();
    scanInProgress = false;
  }

  return scan;
}

function rescoreExistingData() {
  const universe = Object.values(store.listings);
  for (const item of universe) {
    item.parsed = parseCardTitle(item.title);
    item.lane = item.lane || detectLane(item.title);
    const scoring = scoreListing(item, universe);
    item.score = scoring.score;
    item.estimatedValue = scoring.estimatedValue;
    item.estimatedProfit = scoring.estimatedProfit;
    item.roi = scoring.roi;
    item.ebayFees = scoring.ebayFees;
    item.compData = scoring.compData;
    item.marketConfidence = scoring.marketConfidence;
    item.confidenceReasons = scoring.confidenceReasons;
    item.confidenceCap = scoring.confidenceCap;
    item.compCount = scoring.compCount;
    item.compSource = scoring.compSource;
    item.qualityData = scoring.qualityData;
    item.investmentQuality = scoring.investmentQuality;
    item.qualityBucket = scoring.qualityBucket;
    item.liquidityScore = scoring.liquidityScore;
    item.riskLevel = scoring.riskLevel;
    item.qualityReasons = scoring.qualityReasons;
    item.qualityWarnings = scoring.qualityWarnings;
    item.dealGrade = scoring.dealGrade;
    item.dealGate = dealGate(item);
  }

  store.alerts = store.alerts.filter(alert => {
    const item = store.listings[alert.ebayItemId];
    if (!item) return false;
    const gate = dealGate(item);
    return gate.passed;
  });
}

function startScoutEngine() {
  if (!SCOUT_ENABLED) {
    console.log("Scout Engine disabled.");
    return;
  }

  console.log(`Scout Engine enabled. Running every ${SCOUT_INTERVAL_MINUTES} minutes.`);
  console.log(`eBay rate protection: query delay ${EBAY_SEARCH_DELAY_MS}ms, lane delay ${EBAY_LANE_DELAY_MS}ms, query limit ${EBAY_SCAN_QUERY_LIMIT}.`);

  // Wait one minute after deploy before the first startup scan so Railway restarts do not hammer eBay.
  setTimeout(() => runScoutScan("startup"), 60_000);
  setInterval(() => runScoutScan("automatic"), SCOUT_INTERVAL_MINUTES * 60 * 1000);
}

function laneTabs(activeLane, page) {
  return `
    <div class="tabs">
      ${Object.entries(LANES).map(([key, lane]) => `
        <a class="${activeLane === key ? "active" : ""}" href="/${page}?lane=${key}">
          ${escapeHtml(lane.label)}
        </a>
      `).join("")}
    </div>
  `;
}

function layout(title, content) {
  return `
    <html>
      <head>
        <title>${escapeHtml(title)}</title>
        <style>
          body { margin: 0; font-family: Arial, sans-serif; background: #0f172a; color: white; }
          .container { max-width: 1300px; margin: auto; padding: 34px 20px; }
          h1 { font-size: 42px; margin-bottom: 8px; }
          .subtitle { color: #94a3b8; margin-bottom: 24px; }
          nav, .tabs { display: flex; gap: 12px; margin-bottom: 22px; flex-wrap: wrap; }
          nav a, button, .tabs a { padding: 12px 16px; border: none; border-radius: 10px; background: #38bdf8; color: #0f172a; font-weight: bold; cursor: pointer; text-decoration: none; }
          .tabs a { background: #1e293b; color: #e2e8f0; border: 1px solid #334155; }
          .tabs a.active { background: #22c55e; color: #052e16; }
          form { display: flex; gap: 10px; margin-bottom: 26px; }
          input, select { flex: 1; padding: 14px; border-radius: 10px; border: none; font-size: 16px; }
          .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 14px; margin-bottom: 24px; }
          .stat { background: #1e293b; border: 1px solid #334155; border-radius: 16px; padding: 18px; }
          .number { font-size: 30px; font-weight: bold; color: #22c55e; }
          .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(285px, 1fr)); gap: 18px; }
          .card { background: #1e293b; border: 1px solid #334155; border-radius: 16px; padding: 16px; }
          .card img { width: 100%; height: 220px; object-fit: contain; background: white; border-radius: 12px; margin-bottom: 12px; }
          .title { font-size: 16px; font-weight: bold; min-height: 58px; }
          .price { color: #22c55e; font-size: 22px; font-weight: bold; margin-top: 10px; }
          .meta { color: #cbd5e1; font-size: 14px; margin: 6px 0; }
          .score { display: inline-block; padding: 7px 10px; border-radius: 999px; background: #facc15; color: #0f172a; font-weight: bold; margin: 8px 0; }
          .deal-grade, .quality-chip { display: inline-block; padding: 7px 10px; border-radius: 999px; background: #22c55e; color: #052e16; font-weight: bold; margin: 8px 6px 8px 0; }
          .quality-chip { background: #38bdf8; color: #082f49; }
          .tag { display: inline-block; padding: 5px 8px; border-radius: 999px; background: #334155; color: #e2e8f0; font-size: 12px; margin: 3px 3px 3px 0; }
          .premium { background: #14532d; }
          .avoid { background: #7f1d1d; }
          a { color: #38bdf8; font-weight: bold; }
          table { width: 100%; border-collapse: collapse; background: #1e293b; border-radius: 14px; overflow: hidden; }
          th, td { padding: 12px; border-bottom: 1px solid #334155; text-align: left; font-size: 14px; }
          th { color: #94a3b8; }
          .empty { background: #1e293b; padding: 28px; border-radius: 16px; color: #cbd5e1; }
          .subnav { display: flex; gap: 10px; flex-wrap: wrap; margin: 0 0 22px 0; }
          .subnav a { padding: 10px 13px; border-radius: 10px; background: #1e293b; border: 1px solid #334155; color: #e2e8f0; text-decoration: none; }
          .subnav a.active { background: #22c55e; color: #052e16; }
          .small { color: #94a3b8; font-size: 13px; }
          .good { color: #22c55e; font-weight: bold; }
          .bad { color: #f87171; font-weight: bold; }
          .health-ok { color: #22c55e; font-weight: bold; }
          .health-warning { color: #facc15; font-weight: bold; }
          .health-failed { color: #f87171; font-weight: bold; }
          .health-running { color: #38bdf8; font-weight: bold; }
          .table-title { margin-top: 28px; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>🦅 CardHawk</h1>
          <div class="subtitle">Private scouting engine. Built to find cards that can actually make money.</div>

          <nav>
            <a href="/">Dashboard</a>
            <a href="/alerts">Deal Alerts</a>
            <a href="/rejections">Rejected</a>
            <a href="/history">History</a>
            <a href="/scans">Scan History</a>
            <a href="/health">Health</a>
            <a href="/search">Manual Search</a>
            <form method="POST" action="/scan-now" style="margin:0;">
              <button type="submit">Run Scout Now</button>
            </form>
          </nav>

          ${content}
        </div>
      </body>
    </html>
  `;
}

function getLane(req) {
  const lane = req.query.lane || "all";
  return LANES[lane] ? lane : "all";
}

function filterByLane(items, lane) {
  if (lane === "all") return items;
  return items.filter(item => item.lane === lane);
}


function historyTabs(activePage) {
  const tabs = [
    ["/history", "Summary"],
    ["/history/price-drops", "Price Drops"],
    ["/history/disappeared", "Disappeared"],
    ["/history/active", "Active"]
  ];

  return `
    <div class="subnav">
      ${tabs.map(([href, label]) => `
        <a class="${activePage === href ? "active" : ""}" href="${href}">${label}</a>
      `).join("")}
    </div>
  `;
}

function shortDate(value) {
  if (!value) return "";
  try {
    return new Date(value).toLocaleString();
  } catch (_) {
    return String(value);
  }
}

function historyListingRow(item) {
  return `
    <tr>
      <td>${escapeHtml(LANES[item.lane]?.label || item.lane || "Unknown")}</td>
      <td>${escapeHtml(item.title || "")}</td>
      <td>$${money(item.currentPrice || item.totalCost || item.price)}</td>
      <td>${item.seenCount || 0}</td>
      <td>${escapeHtml(item.status || "")}</td>
      <td>${escapeHtml(shortDate(item.firstSeenAt))}</td>
      <td>${escapeHtml(shortDate(item.lastSeenAt))}</td>
      <td><a href="${escapeHtml(item.url || "#")}" target="_blank">eBay</a></td>
    </tr>
  `;
}

function priceDropRow(drop) {
  return `
    <tr>
      <td>${escapeHtml(LANES[drop.lane]?.label || drop.lane || "Unknown")}</td>
      <td>${escapeHtml(drop.title || "")}</td>
      <td>$${money(drop.fromPrice)}</td>
      <td>$${money(drop.toPrice)}</td>
      <td class="good">$${money(drop.amountDropped)}</td>
      <td class="good">${Math.round(Number(drop.percentDropped || 0))}%</td>
      <td>${escapeHtml(shortDate(drop.detectedAt))}</td>
      <td><a href="${escapeHtml(drop.url || "#")}" target="_blank">eBay</a></td>
    </tr>
  `;
}

app.get("/", (req, res) => {
  const lane = getLane(req);
  const listings = filterByLane(Object.values(store.listings), lane);
  const alerts = filterByLane(store.alerts, lane);
  const latestListings = listings.sort((a, b) => new Date(b.lastSeenAt) - new Date(a.lastSeenAt)).slice(0, 12);
  const historySummary = historyEngine.summarizeHistory();

  res.send(layout("CardHawk Dashboard", `
    ${laneTabs(lane, "")}

    <div class="stats">
      <div class="stat"><div class="number">${listings.length}</div><div>Total Listings Scouted</div></div>
      <div class="stat"><div class="number">${alerts.length}</div><div>Real Deal Alerts</div></div>
      <div class="stat"><div class="number">${store.scans.length}</div><div>Total Scout Scans</div></div>
      <div class="stat"><div class="number">${SCOUT_ENABLED ? "ON" : "OFF"}</div><div>Scout Engine</div></div>
      <div class="stat"><div class="number">${historySummary.stats.totalPriceDrops || 0}</div><div>Tracked Price Drops</div></div>
      <div class="stat"><div class="number">${historySummary.stats.disappearedListings || 0}</div><div>Disappeared Listings</div></div>
    </div>

    <h2>Latest Scouted Listings</h2>
    ${latestListings.length ? `<div class="grid">${latestListings.map(listingCard).join("")}</div>` : `<div class="empty">No listings scouted in this lane yet.</div>`}
  `));
});

app.get("/alerts", (req, res) => {
  const lane = getLane(req);
  const alerts = filterByLane(store.alerts, lane);

  res.send(layout("CardHawk Alerts", `
    ${laneTabs(lane, "alerts")}
    <h2>Deal Alerts</h2>
    ${alerts.length ? `<div class="grid">${alerts.map(listingCard).join("")}</div>` : `<div class="empty">No real deals right now. That is good — CardHawk is filtering out noise.</div>`}
  `));
});

app.get("/rejections", (req, res) => {
  const lane = getLane(req);
  const rejections = filterByLane(store.rejections, lane).slice(0, 80);

  res.send(layout("Rejected Listings", `
    ${laneTabs(lane, "rejections")}
    <h2>Rejected Listings</h2>
    <table>
      <tr><th>Lane</th><th>Title</th><th>Score</th><th>Profit</th><th>ROI</th><th>Reasons</th></tr>
      ${rejections.map(r => `
        <tr>
          <td>${escapeHtml(LANES[r.lane]?.label || r.lane)}</td>
          <td>${escapeHtml(r.title)}</td>
          <td>${r.score}</td>
          <td>$${money(r.estimatedProfit)}</td>
          <td>${Math.round((r.roi || 0) * 100)}%</td>
          <td>${escapeHtml((r.reasons || []).join(", "))}</td>
        </tr>
      `).join("")}
    </table>
  `));
});


app.get("/history", (req, res) => {
  const summary = historyEngine.summarizeHistory();
  const stats = summary.stats || {};

  res.send(layout("CardHawk History", `
    ${historyTabs("/history")}

    <div class="stats">
      <div class="stat"><div class="number">${stats.totalListingsTracked || 0}</div><div>Total Tracked</div></div>
      <div class="stat"><div class="number">${stats.activeListings || 0}</div><div>Still Active</div></div>
      <div class="stat"><div class="number">${stats.disappearedListings || 0}</div><div>Disappeared</div></div>
      <div class="stat"><div class="number">${stats.totalPriceDrops || 0}</div><div>Price Drops</div></div>
    </div>

    <h2>Recent Price Drops</h2>
    ${summary.recentPriceDrops.length ? `
      <table>
        <tr><th>Lane</th><th>Title</th><th>From</th><th>To</th><th>Dropped</th><th>%</th><th>Detected</th><th>Link</th></tr>
        ${summary.recentPriceDrops.map(priceDropRow).join("")}
      </table>
    ` : `<div class="empty">No price drops found yet.</div>`}

    <h2 class="table-title">Recently Disappeared</h2>
    ${summary.recentDisappeared.length ? `
      <table>
        <tr><th>Lane</th><th>Title</th><th>Current</th><th>Scans</th><th>Status</th><th>First Seen</th><th>Last Seen</th><th>Link</th></tr>
        ${summary.recentDisappeared.map(historyListingRow).join("")}
      </table>
    ` : `<div class="empty">No disappeared listings yet.</div>`}
  `));
});

app.get("/history/price-drops", (req, res) => {
  const lane = getLane(req);
  const drops = historyEngine.getPriceDrops({ lane: lane === "all" ? null : lane }, 100);

  res.send(layout("CardHawk Price Drops", `
    ${historyTabs("/history/price-drops")}
    ${laneTabs(lane, "history/price-drops")}
    <h2>Price Drops</h2>
    ${drops.length ? `
      <table>
        <tr><th>Lane</th><th>Title</th><th>From</th><th>To</th><th>Dropped</th><th>%</th><th>Detected</th><th>Link</th></tr>
        ${drops.map(priceDropRow).join("")}
      </table>
    ` : `<div class="empty">No price drops in this lane yet.</div>`}
  `));
});

app.get("/history/disappeared", (req, res) => {
  const lane = getLane(req);
  const disappeared = filterByLane(historyEngine.getDisappearedListings(200), lane);

  res.send(layout("CardHawk Disappeared", `
    ${historyTabs("/history/disappeared")}
    ${laneTabs(lane, "history/disappeared")}
    <h2>Disappeared Listings</h2>
    <div class="small">These are likely sold or ended listings. This becomes useful once we compare disappearance timing with price and score.</div><br>
    ${disappeared.length ? `
      <table>
        <tr><th>Lane</th><th>Title</th><th>Current</th><th>Scans</th><th>Status</th><th>First Seen</th><th>Last Seen</th><th>Link</th></tr>
        ${disappeared.map(historyListingRow).join("")}
      </table>
    ` : `<div class="empty">No disappeared listings in this lane yet.</div>`}
  `));
});

app.get("/history/active", (req, res) => {
  const lane = getLane(req);
  const active = filterByLane(historyEngine.getActiveListings(200), lane);

  res.send(layout("CardHawk Active History", `
    ${historyTabs("/history/active")}
    ${laneTabs(lane, "history/active")}
    <h2>Active Tracked Listings</h2>
    ${active.length ? `
      <table>
        <tr><th>Lane</th><th>Title</th><th>Current</th><th>Scans</th><th>Status</th><th>First Seen</th><th>Last Seen</th><th>Link</th></tr>
        ${active.map(historyListingRow).join("")}
      </table>
    ` : `<div class="empty">No active tracked listings in this lane yet.</div>`}
  `));
});

app.get("/scans", (req, res) => {
  res.send(layout("Scan History", `
    <h2>Scan History</h2>
    <table>
      <tr><th>Started</th><th>Source</th><th>Status</th><th>Listings</th><th>New Alerts</th><th>History</th><th>Lanes</th><th>Error</th></tr>
      ${store.scans.map(scan => `
        <tr>
          <td>${escapeHtml(scan.startedAt)}</td>
          <td>${escapeHtml(scan.source)}</td>
          <td>${escapeHtml(scan.status)}</td>
          <td>${scan.listingsFound}</td>
          <td>${scan.newAlerts}</td>
          <td>${scan.history ? escapeHtml(`new: ${scan.history.newCount}, drops: ${scan.history.priceDropCount}, gone: ${scan.history.disappearedCount}`) : ""}</td>
          <td>${escapeHtml((scan.lanes || []).map(l => `${l.lane}: ${l.count}`).join(" | "))}</td>
          <td>${escapeHtml(scan.error || "")}</td>
        </tr>
      `).join("")}
    </table>
  `));
});

app.get("/search", async (req, res) => {
  try {
    const query = req.query.q || "";
    const selectedLane = req.query.lane || "baseball";
    const results = query ? await searchEbay(query, 12) : [];

    const scored = results.map(item => {
      const scoring = scoreListing(item, Object.values(store.listings));
      const lane = detectLane(item.title, selectedLane);
      const full = { ...item, ...scoring, lane };
      full.dealGate = dealGate(full);
      return full;
    });

    res.send(layout("Manual Search", `
      <form>
        <input name="q" value="${escapeHtml(query)}" placeholder="Search for a card..." />
        <select name="lane">
          ${Object.entries(LANES).filter(([k]) => k !== "all").map(([key, lane]) => `
            <option value="${key}" ${selectedLane === key ? "selected" : ""}>${escapeHtml(lane.label)}</option>
          `).join("")}
        </select>
        <button>Search</button>
      </form>

      <h2>Manual Results</h2>
      <div class="grid">${scored.map(listingCard).join("")}</div>
    `));
  } catch (error) {
    res.status(500).send(layout("Error", `<pre>${escapeHtml(error.message)}</pre>`));
  }
});

app.post("/scan-now", async (req, res) => {
  await runScoutScan("manual");
  res.redirect("/");
});

app.get("/api/history/summary", (req, res) => {
  res.json(historyEngine.summarizeHistory());
});

app.get("/api/history/price-drops", (req, res) => {
  const lane = req.query.lane || null;
  const limit = Number(req.query.limit || 50);
  res.json(historyEngine.getPriceDrops({ lane }, limit));
});

app.get("/api/history/disappeared", (req, res) => {
  const limit = Number(req.query.limit || 50);
  res.json(historyEngine.getDisappearedListings(limit));
});

app.get("/api/history/listing/:itemId", (req, res) => {
  const listing = historyEngine.getListing(req.params.itemId);
  if (!listing) return res.status(404).json({ error: "Listing not found" });
  res.json(listing);
});


app.get("/api/comps/listing/:itemId", (req, res) => {
  const listing = store.listings[req.params.itemId];
  if (!listing) return res.status(404).json({ error: "Listing not found" });

  const compData = compEngine.evaluateListing(listing, Object.values(store.listings), {
    fallbackEstimator: estimateMarketValue
  });

  const confidenceData = confidenceEngine.evaluateConfidence(listing, compData, Object.values(store.listings));
  const qualityData = qualityEngine.evaluateQuality({ ...listing, compData, marketConfidence: confidenceData.confidence, confidenceReasons: confidenceData.reasons, compCount: compData.compCount, compSource: compData.source });
  const dealGrade = gradingEngine.gradeDeal({ ...listing, compData, marketConfidence: confidenceData.confidence, confidenceReasons: confidenceData.reasons, compCount: compData.compCount, compSource: compData.source, qualityData, investmentQuality: qualityData.investmentQuality });

  res.json({
    listing: {
      ebayItemId: listing.ebayItemId,
      title: listing.title,
      lane: listing.lane,
      price: listing.price,
      shipping: listing.shipping,
      totalCost: listing.totalCost,
      url: listing.url
    },
    compData,
    confidenceData,
    qualityData,
    dealGrade
  });
});


app.get("/api/grades/listing/:itemId", (req, res) => {
  const listing = store.listings[req.params.itemId];
  if (!listing) return res.status(404).json({ error: "Listing not found" });

  const scoring = scoreListing(listing, Object.values(store.listings));
  res.json({
    listing: {
      ebayItemId: listing.ebayItemId,
      title: listing.title,
      lane: listing.lane,
      price: listing.totalCost || listing.price,
      url: listing.url
    },
    grade: scoring.dealGrade,
    quality: scoring.qualityData
  });
});

app.get("/api/quality/listing/:itemId", (req, res) => {
  const listing = store.listings[req.params.itemId];
  if (!listing) return res.status(404).json({ error: "Listing not found" });

  const scoring = scoreListing(listing, Object.values(store.listings));
  res.json({
    listing: {
      ebayItemId: listing.ebayItemId,
      title: listing.title,
      lane: listing.lane,
      price: listing.totalCost || listing.price,
      url: listing.url
    },
    quality: scoring.qualityData,
    grade: scoring.dealGrade
  });
});

app.get("/api/alerts/debug", (req, res) => {
  const alerts = store.alerts || [];
  const analyzed = alerts.map(alert => {
    const ruleCheck = notificationEngine.evaluateAlertRules(alert);
    return {
      ebayItemId: alert.ebayItemId,
      lane: alert.lane,
      title: alert.title,
      price: alert.totalCost || alert.price,
      estimatedProfit: alert.estimatedProfit,
      roi: alert.roi,
      score: alert.score,
      marketConfidence: alert.marketConfidence,
      confidenceReasons: alert.confidenceReasons || [],
      confidenceCap: alert.confidenceCap,
      compCount: alert.compCount,
      compSource: alert.compSource,
      investmentQuality: alert.investmentQuality || alert.qualityData?.investmentQuality || null,
      qualityBucket: alert.qualityBucket || alert.qualityData?.bucket || null,
      liquidityScore: alert.liquidityScore || alert.qualityData?.liquidityScore || null,
      riskLevel: alert.riskLevel || alert.qualityData?.riskLevel || null,
      qualityReasons: alert.qualityReasons || alert.qualityData?.positives || [],
      qualityWarnings: alert.qualityWarnings || alert.qualityData?.warnings || [],
      dealGrade: alert.dealGrade || null,
      url: alert.url,
      wouldNotify: ruleCheck.passed,
      status: alert.status || "new",
      notifiedAt: alert.notifiedAt || null,
      notificationFailures: ruleCheck.failures,
      notificationError: alert.notificationError || null,
      createdAt: alert.createdAt
    };
  });

  const wouldNotify = analyzed.filter(item => item.wouldNotify);
  const blocked = analyzed.filter(item => !item.wouldNotify);

  res.json({
    thresholds: notificationEngine.getAlertThresholds(),
    totalDealAlerts: alerts.length,
    wouldNotifyCount: wouldNotify.length,
    blockedCount: blocked.length,
    topNotifyCandidates: wouldNotify
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, 25),
    topBlockedCandidates: blocked
      .sort((a, b) => (b.estimatedProfit || 0) - (a.estimatedProfit || 0))
      .slice(0, 25)
  });
});

app.get("/api/alerts/preview", (req, res) => {
  const limit = Math.min(Number(req.query.limit || 25), 100);
  const alerts = (store.alerts || [])
    .map(alert => {
      const ruleCheck = notificationEngine.evaluateAlertRules(alert);
      return {
        title: alert.title,
        lane: alert.lane,
        price: alert.totalCost || alert.price,
        estimatedProfit: alert.estimatedProfit,
        roiPercent: Math.round(Number(alert.roi || 0) * 100),
        score: alert.score,
        confidence: alert.marketConfidence,
        investmentQuality: alert.investmentQuality || alert.qualityData?.investmentQuality || null,
        qualityBucket: alert.qualityBucket || alert.qualityData?.bucket || null,
        riskLevel: alert.riskLevel || alert.qualityData?.riskLevel || null,
        dealGrade: alert.dealGrade || null,
        confidenceReasons: alert.confidenceReasons || [],
        compCount: alert.compCount,
        wouldNotify: ruleCheck.passed,
        reason: ruleCheck.passed ? "passes notification rules" : ruleCheck.failures.join("; "),
        url: alert.url
      };
    })
    .sort((a, b) => Number(b.wouldNotify) - Number(a.wouldNotify) || (b.score || 0) - (a.score || 0))
    .slice(0, limit);

  res.json({
    thresholds: notificationEngine.getAlertThresholds(),
    count: alerts.length,
    alerts
  });
});

app.get("/api/alerts/send-pending", async (req, res) => {
  const limit = Math.min(Number(req.query.limit || 5), 25);
  const dryRun = String(req.query.dryRun || "false").toLowerCase() === "true";
  const alerts = store.alerts || [];

  const candidates = alerts
    .filter(alert => alert.status !== "notified")
    .map(alert => ({ alert, ruleCheck: notificationEngine.evaluateAlertRules(alert) }))
    .filter(item => item.ruleCheck.passed)
    .sort((a, b) => (b.alert.score || 0) - (a.alert.score || 0) || (b.alert.estimatedProfit || 0) - (a.alert.estimatedProfit || 0))
    .slice(0, limit);

  if (dryRun) {
    return res.json({
      dryRun: true,
      count: candidates.length,
      candidates: candidates.map(item => ({
        ebayItemId: item.alert.ebayItemId,
        title: item.alert.title,
        lane: item.alert.lane,
        price: item.alert.totalCost || item.alert.price,
        estimatedProfit: item.alert.estimatedProfit,
        roi: item.alert.roi,
        score: item.alert.score,
        marketConfidence: item.alert.marketConfidence,
        investmentQuality: item.alert.investmentQuality || item.alert.qualityData?.investmentQuality || null,
        qualityBucket: item.alert.qualityBucket || item.alert.qualityData?.bucket || null,
        dealGrade: item.alert.dealGrade || null,
        url: item.alert.url
      }))
    });
  }

  const results = [];
  for (const item of candidates) {
    try {
      const result = await notificationEngine.sendDealAlert(item.alert);
      if (result?.sent) {
        item.alert.status = "notified";
        item.alert.notifiedAt = new Date().toISOString();
        item.alert.notificationResult = result;
        item.alert.notificationError = null;
      }
      results.push({
        ebayItemId: item.alert.ebayItemId,
        title: item.alert.title,
        sent: Boolean(result?.sent),
        result
      });
    } catch (error) {
      item.alert.notificationError = error.message;
      results.push({
        ebayItemId: item.alert.ebayItemId,
        title: item.alert.title,
        sent: false,
        error: error.message
      });
    }
  }

  saveStore();
  res.json({ attempted: candidates.length, results });
});

app.get("/api/notifications/status", (req, res) => {
  res.json(notificationEngine.getStatus());
});

app.post("/api/notifications/test", async (req, res) => {
  try {
    const result = await notificationEngine.sendTestAlert({ smsOnly: true });
    res.json(result);
  } catch (error) {
    res.status(500).json({ sent: false, error: error.message });
  }
});

app.get("/api/notifications/test", async (req, res) => {
  try {
    const result = await notificationEngine.sendTestAlert({ smsOnly: true });
    res.json(result);
  } catch (error) {
    res.status(500).json({ sent: false, error: error.message });
  }
});


function healthClass(status) {
  if (status === "ok" || status === "healthy" || status === "completed") return "health-ok";
  if (status === "running" || status === "scanning") return "health-running";
  if (status === "warning" || status === "rate_limited" || status === "skipped") return "health-warning";
  if (status === "failed" || status === "degraded") return "health-failed";
  return "small";
}

app.get("/health", (req, res) => {
  const health = systemHealth.summarizeRuntime(store, {
    scoutEnabled: SCOUT_ENABLED,
    rateLimitProtection: {
      ebaySearchDelayMs: EBAY_SEARCH_DELAY_MS,
      ebayLaneDelayMs: EBAY_LANE_DELAY_MS,
      ebayMaxRetries: EBAY_MAX_RETRIES,
      ebayBackoffBaseMs: EBAY_BACKOFF_BASE_MS,
      ebayScanQueryLimit: EBAY_SCAN_QUERY_LIMIT
    }
  });

  const engines = Object.values(health.engines || {});
  const lastScan = health.lastScan || {};

  res.send(layout("CardHawk Health", `
    <h2>System Health</h2>
    <div class="stats">
      <div class="stat"><div class="number ${healthClass(health.status)}">${escapeHtml(health.status)}</div><div>Overall Status</div></div>
      <div class="stat"><div class="number">${health.data.totalListings}</div><div>Total Listings</div></div>
      <div class="stat"><div class="number">${health.data.totalAlerts}</div><div>Total Alerts</div></div>
      <div class="stat"><div class="number">${health.data.recentFailures}</div><div>Recent Failed/Rate-Limited Scans</div></div>
    </div>

    <h2>Engines</h2>
    <table>
      <tr><th>Engine</th><th>Status</th><th>Updated</th><th>Details</th></tr>
      ${engines.map(engine => `
        <tr>
          <td>${escapeHtml(engine.name)}</td>
          <td class="${healthClass(engine.status)}">${escapeHtml(engine.status)}</td>
          <td>${escapeHtml(shortDate(engine.updatedAt))}</td>
          <td><pre style="white-space:pre-wrap;margin:0;color:#cbd5e1;">${escapeHtml(JSON.stringify(engine.details || {}, null, 2))}</pre></td>
        </tr>
      `).join("")}
    </table>

    <h2 class="table-title">Last Scan</h2>
    <table>
      <tr><th>Status</th><th>Source</th><th>Listings</th><th>New Alerts</th><th>Duration</th><th>Error</th></tr>
      <tr>
        <td class="${healthClass(lastScan.status)}">${escapeHtml(lastScan.status || "none")}</td>
        <td>${escapeHtml(lastScan.source || "")}</td>
        <td>${lastScan.listingsFound || 0}</td>
        <td>${lastScan.newAlerts || 0}</td>
        <td>${Math.round(Number(lastScan.durationMs || 0) / 1000)}s</td>
        <td>${escapeHtml(lastScan.error || "")}</td>
      </tr>
    </table>

    <h2 class="table-title">Recent Events</h2>
    <table>
      <tr><th>Time</th><th>Type</th><th>Message</th></tr>
      ${(health.recentEvents || []).map(event => `
        <tr>
          <td>${escapeHtml(shortDate(event.createdAt))}</td>
          <td>${escapeHtml(event.type)}</td>
          <td>${escapeHtml(event.message)}</td>
        </tr>
      `).join("")}
    </table>
  `));
});

app.get("/api/health", (req, res) => {
  res.json(systemHealth.summarizeRuntime(store, {
    scoutEnabled: SCOUT_ENABLED,
    rateLimitProtection: {
      ebaySearchDelayMs: EBAY_SEARCH_DELAY_MS,
      ebayLaneDelayMs: EBAY_LANE_DELAY_MS,
      ebayMaxRetries: EBAY_MAX_RETRIES,
      ebayBackoffBaseMs: EBAY_BACKOFF_BASE_MS,
      ebayScanQueryLimit: EBAY_SCAN_QUERY_LIMIT
    }
  }));
});

app.get("/api/status", (req, res) => {
  const health = systemHealth.summarizeRuntime(store, {
    scoutEnabled: SCOUT_ENABLED,
    rateLimitProtection: {
      ebaySearchDelayMs: EBAY_SEARCH_DELAY_MS,
      ebayLaneDelayMs: EBAY_LANE_DELAY_MS,
      ebayMaxRetries: EBAY_MAX_RETRIES,
      ebayBackoffBaseMs: EBAY_BACKOFF_BASE_MS,
      ebayScanQueryLimit: EBAY_SCAN_QUERY_LIMIT
    }
  });

  res.json({
    scoutEnabled: SCOUT_ENABLED,
    systemHealth: health.status,
    scoutIntervalMinutes: SCOUT_INTERVAL_MINUTES,
    totalListings: Object.keys(store.listings).length,
    totalAlerts: store.alerts.length,
    totalScans: store.scans.length,
    scanInProgress,
    rateLimitProtection: {
      ebaySearchDelayMs: EBAY_SEARCH_DELAY_MS,
      ebayLaneDelayMs: EBAY_LANE_DELAY_MS,
      ebayMaxRetries: EBAY_MAX_RETRIES,
      ebayBackoffBaseMs: EBAY_BACKOFF_BASE_MS,
      ebayScanQueryLimit: EBAY_SCAN_QUERY_LIMIT
    },
    lanes: Object.keys(LANES)
  });
});

function parsedTags(parsed, lane) {
  if (!parsed) return "";

  const tags = [];
  if (lane && LANES[lane]) tags.push(LANES[lane].label);
  tags.push(parsed.qualityTier);
  if (parsed.year) tags.push(String(parsed.year));
  if (parsed.setName && parsed.setName !== "Unknown") tags.push(parsed.setName);
  if (parsed.gradeCompany) tags.push(`${parsed.gradeCompany} ${parsed.grade}`);
  if (parsed.flags.autograph) tags.push("Auto");
  if (parsed.flags.rookie) tags.push("Rookie");
  if (parsed.flags.numbered) tags.push(`/${parsed.numberedTo}`);
  if (parsed.flags.refractor) tags.push("Refractor");
  if (parsed.flags.lot) tags.push("Lot");
  if (parsed.flags.sealed) tags.push("Wax");
  if (parsed.flags.reprint) tags.push("Reprint");

  return tags.map(tag => {
    const cls = parsed.qualityTier === "avoid" ? "tag avoid" : parsed.qualityTier === "premium" ? "tag premium" : "tag";
    return `<span class="${cls}">${escapeHtml(tag)}</span>`;
  }).join("");
}

function listingCard(item) {
  return `
    <div class="card">
      <img src="${escapeHtml(item.image || "")}" />
      <div class="title">${escapeHtml(item.title)}</div>
      <div>${parsedTags(item.parsed, item.lane)}</div>
      ${item.dealGrade?.grade ? `<div class="deal-grade">Grade: ${escapeHtml(item.dealGrade.grade)} — ${escapeHtml(item.dealGrade.action || "")}</div>` : ""}
      ${item.investmentQuality ? `<div class="quality-chip">Quality: ${Math.round(item.investmentQuality)}/100 — ${escapeHtml(item.qualityBucket || "")}</div>` : ""}
      <div class="score">Score: ${Math.round(item.score || 0)}/100</div>
      ${item.qualityReasons?.length ? `<div class="meta">Quality: ${escapeHtml(item.qualityReasons.slice(0, 2).join(" | "))}</div>` : ""}
      ${item.qualityWarnings?.length ? `<div class="meta">Warnings: ${escapeHtml(item.qualityWarnings.slice(0, 2).join(" | "))}</div>` : ""}
      <div class="price">$${money(item.totalCost || item.price)}</div>
      <div class="meta">Price: $${money(item.price)}</div>
      <div class="meta">Shipping: $${money(item.shipping)}</div>
      <div class="meta">Estimated Value: $${money(item.estimatedValue)}</div>
      <div class="meta">Market Confidence: ${Math.round(item.marketConfidence || 0)}% (${item.compCount || 0} comps)</div>
      ${item.confidenceReasons?.length ? `<div class="meta">Confidence: ${escapeHtml(item.confidenceReasons.slice(0, 2).join(" | "))}</div>` : ""}
      <div class="meta">Comp Source: ${escapeHtml(item.compSource || "fallback")}</div>
      <div class="meta">Estimated Profit: $${money(item.estimatedProfit)}</div>
      <div class="meta">ROI: ${Math.round((item.roi || 0) * 100)}%</div>
      <div class="meta">Condition: ${escapeHtml(item.condition || "Unknown")}</div>
      <div class="meta">Seller: ${escapeHtml(item.sellerUsername || "Unknown")}</div>
      ${item.dealGate && !item.dealGate.passed ? `<div class="meta">Rejected: ${escapeHtml(item.dealGate.reasons.join(", "))}</div>` : ""}
      <a href="${escapeHtml(item.url)}" target="_blank">View on eBay</a>
      ${item.ebayItemId ? ` &nbsp; <a href="/api/history/listing/${escapeHtml(item.ebayItemId)}" target="_blank">History</a>` : ""}
      ${item.ebayItemId ? ` &nbsp; <a href="/api/comps/listing/${escapeHtml(item.ebayItemId)}" target="_blank">Comps</a>` : ""}
      ${item.ebayItemId ? ` &nbsp; <a href="/api/grades/listing/${escapeHtml(item.ebayItemId)}" target="_blank">Grade</a>` : ""}
      ${item.ebayItemId ? ` &nbsp; <a href="/api/quality/listing/${escapeHtml(item.ebayItemId)}" target="_blank">Quality</a>` : ""}
    </div>
  `;
}

loadStore();
systemHealth.setEngine("scout", SCOUT_ENABLED ? "ok" : "disabled", { scoutIntervalMinutes: SCOUT_INTERVAL_MINUTES });
systemHealth.setEngine("comps", "ok");
systemHealth.setEngine("confidence", "ok");
systemHealth.setEngine("grading", "ok");
systemHealth.setEngine("quality", "ok");
systemHealth.setEngine("notifications", notificationEngine.getStatus()?.enabled ? "ok" : "warning", notificationEngine.getStatus());

app.listen(PORT, () => {
  console.log(`CardHawk running on port ${PORT}`);
  startScoutEngine();
});
