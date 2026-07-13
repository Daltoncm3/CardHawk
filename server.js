const express = require("express");
const path = require("path");
const historyEngine = require("./engines/historyEngine");
const compEngine = require("./engines/compEngine");
const marketValueEngine = require("./engines/marketValueEngine");
const soldSalesEngine = require("./engines/soldSalesEngine");
const salesVelocityEngine = require("./engines/salesVelocityEngine");
const roiEngine = require("./engines/roiEngine");
const riskEngine = require("./engines/riskEngine");
const decisionEngine = require("./engines/decisionEngine");
const decisionValidationEngine = require("./engines/decisionValidationEngine");
const calibrationReportEngine = require("./engines/calibrationReportEngine");
const validationHarness = require("./engines/validationHarness");
const predictionAccuracyEngine = require("./engines/predictionAccuracyEngine");
const marketIntelligenceEngine = require("./engines/marketIntelligenceEngine");
const learningEngine = require("./engines/learningEngine");
const notificationEngine = require("./engines/notificationEngine");
const confidenceEngine = require("./engines/confidenceEngine");
const populationEngine = require("./engines/populationEngine");
const trendEngine = require("./engines/trendEngine");
const gradingEngine = require("./engines/gradingEngine");
const qualityEngine = require("./engines/qualityEngine");
const systemHealth = require("./engines/systemHealth");
const engineMetricsEngine = require("./engines/engineMetricsEngine");
const marketplaceRegistry = require("./marketplaces/marketplaceRegistry");
const listingIdentity = require("./utils/listingIdentity");
const appStore = require("./utils/appStore");
const configReadiness = require("./utils/configReadiness");
const operatorAuditLog = require("./utils/operatorAuditLog");
const shadowModeLogger = require("./utils/shadowModeLogger");
const signalAnnotation = require("./utils/signalAnnotation");
const signalSemantics = require("./utils/signalSemantics");
const soldEvidenceStore = require("./utils/soldEvidenceStore");
const { createScoutScanner } = require("./services/scoutScannerService");
const soldEvidenceService = require("./services/soldEvidenceService");
const activeMarketplace = marketplaceRegistry.getActiveMarketplace();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "cardhawk-data.json");
const SOLD_EVIDENCE_FILE = path.join(DATA_DIR, "sold-evidence.json");

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
const CONFIG_READINESS = configReadiness.evaluateConfigReadiness(process.env, {
  scoutEnabled: SCOUT_ENABLED,
  alertsEnabled: notificationEngine.getStatus()?.enabled
});

let store = appStore.createDefaultStore();
let canonicalSoldEvidenceStore = null;
let shadowModeDecisionIntelligenceEvaluator = null;
let shadowModeDecisionLogger = shadowModeLogger.logShadowModeDecision;

function isShadowModeEnabled(env = process.env) {
  return String(env.CARDHAWK_SHADOW_MODE_ENABLED || "false").toLowerCase() === "true";
}

function getShadowModeDecisionIntelligenceEvaluator() {
  if (!shadowModeDecisionIntelligenceEvaluator) {
    shadowModeDecisionIntelligenceEvaluator = require("./engines/decisionIntelligenceEngine").evaluateDecisionIntelligence;
  }

  return shadowModeDecisionIntelligenceEvaluator;
}

function runShadowModeDecisionIntelligence(marketIntelligenceData = {}, context = {}) {
  if (!isShadowModeEnabled()) return;

  try {
    const decisionIntelligence = getShadowModeDecisionIntelligenceEvaluator()({
      evidenceSufficiency: marketIntelligenceData.evidenceSufficiency,
      listingSimilarity: marketIntelligenceData.listingSimilarity,
      comparableQuality: marketIntelligenceData.comparableQuality,
      valuationRange: marketIntelligenceData.valuationRange,
      supplyPressure: marketIntelligenceData.supplyPressure
    });

    try {
      shadowModeDecisionLogger({
        listing: context.listing,
        scanContext: context.scanContext,
        decisionIntelligence
      });
    } catch (_) {
      // Passive Shadow Mode logging must never affect runtime behavior.
    }
  } catch (_) {
    // Shadow Mode is observation-only and must never affect runtime behavior.
  }
}

function __setShadowModeDecisionIntelligenceEvaluatorForTest(evaluator) {
  shadowModeDecisionIntelligenceEvaluator = evaluator;
}

function __setShadowModeDecisionLoggerForTest(logger) {
  shadowModeDecisionLogger = logger || shadowModeLogger.logShadowModeDecision;
}

function loadCanonicalSoldEvidenceStore() {
  if (!canonicalSoldEvidenceStore) {
    canonicalSoldEvidenceStore = soldEvidenceStore.loadSoldEvidenceStore(SOLD_EVIDENCE_FILE);
  }

  return canonicalSoldEvidenceStore;
}

function getListingCanonicalIdentity(listing = {}) {
  return listing.canonicalIdentity ||
    listing.parsedIdentity ||
    listing.identity ||
    listing.parsed ||
    listing;
}

function getCanonicalSoldEvidenceForListing(listing = {}) {
  try {
    return soldEvidenceService.querySoldEvidence(
      loadCanonicalSoldEvidenceStore(),
      getListingCanonicalIdentity(listing),
      { trueSoldOnly: true }
    );
  } catch (_) {
    return soldEvidenceService.querySoldEvidence(
      soldEvidenceStore.createEmptySoldEvidenceStore(),
      getListingCanonicalIdentity(listing),
      { trueSoldOnly: true }
    );
  }
}

function __setCanonicalSoldEvidenceStoreForTest(nextStore) {
  canonicalSoldEvidenceStore = nextStore || null;
}

function loadStore() {
  try {
    store = appStore.loadStore(DATA_FILE, store);

    rescoreExistingData();
    saveStore();
  } catch (error) {
    console.error("Failed to load data:", error.message);
    saveStore();
  }
}

function saveStore() {
  appStore.saveStore(DATA_FILE, store);
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

function getRequestAuditContext(req) {
  let actor = "unknown";

  try {
    const auth = req.headers.authorization || "";
    const encoded = auth.startsWith("Basic ") ? auth.split(" ")[1] : "";
    if (encoded) {
      actor = Buffer.from(encoded, "base64").toString().split(":")[0] || "unknown";
    }
  } catch (_) {
    actor = "unknown";
  }

  const forwardedFor = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();

  return {
    actor,
    sourceIp: forwardedFor || req.ip || req.socket?.remoteAddress || null,
    userAgent: req.headers["user-agent"] || null
  };
}

function recordOperatorAction(req, action, data = {}) {
  try {
    return operatorAuditLog.recordOperatorAction(action, {
      ...getRequestAuditContext(req),
      ...data
    });
  } catch (error) {
    console.warn(`Operator audit log failed for ${action}:`, error.message);
    return null;
  }
}

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

function getStoredListingById(id) {
  return appStore.getStoredListingById(store, id);
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

function createLegacyScoreBreakdown({ parsed = {}, trendData = {}, estimatedProfit = 0, roi = 0, combinedConfidence = 0, marketData = {}, compData = {}, listing = {} } = {}) {
  const flags = parsed.flags || {};
  const adders = [];
  const adjustments = [];
  let score = 0;

  const add = (category, id, label, value) => {
    if (!value) return;
    score += value;
    adders.push({ category, id, label, value });
  };

  const setScore = (category, id, label, value) => {
    const previousScore = score;
    score = value;
    adjustments.push({ category, id, label, previousScore, value });
  };

  const soldCompCount = Math.max(
    Number(marketData.soldCompCount || 0),
    Number(compData.trueSoldCompCount || 0),
    Number(compData.soldCompCount || 0)
  );
  const activeCompCount = Math.max(Number(marketData.activeCompCount || 0), Number(compData.activeCompCount || 0));
  const fallbackUnknownCompCount = Number(compData.fallbackUnknownCompCount || 0);
  const marketSource = String(marketData.source || compData.source || '').toLowerCase();
  const compSource = String(compData.source || compData.compSource || '').toLowerCase();
  const fallbackEvidence = marketSource.includes('fallback') || compSource.includes('fallback') || fallbackUnknownCompCount > 0;
  const activeOnlyEvidence = soldCompCount <= 0 && (activeCompCount > 0 || marketSource === 'active_market' || marketSource === 'insufficient_evidence');
  const fallbackOnlyEvidence = soldCompCount <= 0 && fallbackEvidence && activeCompCount <= 0;

  add('trend', 'trend_score_bonus', 'Trend score bonus', Math.max(-8, Math.min(8, trendData.scoreBonus || 0)));

  if (parsed.qualityTier === "premium") add('parsed_card_tier', 'premium', 'Premium card profile', 20);
  if (parsed.qualityTier === "strong") add('parsed_card_tier', 'strong', 'Strong card profile', 15);
  if (parsed.qualityTier === "watch") add('parsed_card_tier', 'watch', 'Watch card profile', 8);
  if (parsed.qualityTier === "generic") add('parsed_card_tier', 'generic', 'Generic card profile', 0);
  if (parsed.qualityTier === "low-confidence") add('parsed_card_tier', 'low_confidence', 'Low-confidence card profile', -20);
  if (parsed.qualityTier === "avoid") setScore('parsed_card_tier', 'avoid', 'Avoid-tier card profile resets legacy score', 0);

  if (soldCompCount >= 8) add('evidence', 'sold_comps_8', '8+ true sold comps', 28);
  else if (soldCompCount >= 5) add('evidence', 'sold_comps_5', '5+ true sold comps', 22);
  else if (soldCompCount >= 3) add('evidence', 'sold_comps_3', '3+ true sold comps', 16);
  else if (soldCompCount >= 1) add('evidence', 'sold_comps_thin', 'Thin true sold support', 6);
  else add('evidence', 'zero_true_sold_comps', 'No true sold comps', -28);

  if (activeOnlyEvidence) add('evidence', 'active_only_context', 'Active-only context', 4);
  if (fallbackOnlyEvidence) add('evidence', 'fallback_only_context', 'Fallback-only context', -18);
  else if (fallbackEvidence && soldCompCount <= 0) add('evidence', 'fallback_context', 'Fallback context without sold support', -12);

  if (estimatedProfit >= 150) add('profit', 'profit_150', 'Estimated profit >= $150', 18);
  else if (estimatedProfit >= 75) add('profit', 'profit_75', 'Estimated profit >= $75', 12);
  else if (estimatedProfit >= 30) add('profit', 'profit_30', 'Estimated profit >= $30', 8);
  else if (estimatedProfit >= 10) add('profit', 'profit_10', 'Estimated profit >= $10', 4);
  else if (estimatedProfit < -50) add('profit', 'profit_negative_50', 'Estimated profit worse than -$50', -28);
  else if (estimatedProfit < 0) add('profit', 'profit_negative', 'Negative expected profit', -20);

  if (roi >= 0.8) add('roi', 'roi_80', 'ROI >= 80%', 18);
  else if (roi >= 0.5) add('roi', 'roi_50', 'ROI >= 50%', 12);
  else if (roi >= 0.3) add('roi', 'roi_30', 'ROI >= 30%', 8);
  else if (roi >= 0.15) add('roi', 'roi_15', 'ROI >= 15%', 4);
  else if (roi <= -0.25) add('roi', 'roi_negative_25', 'ROI <= -25%', -24);
  else if (roi < 0) add('roi', 'roi_negative', 'Negative ROI', -18);

  const soldSupportedConfidence = soldCompCount > 0 && ['sold_market', 'blended_market'].includes(marketData.source);
  if (soldSupportedConfidence) {
    if (combinedConfidence >= 80) add('confidence', 'sold_confidence_80', 'Sold-supported confidence >= 80', 12);
    else if (combinedConfidence >= 65) add('confidence', 'sold_confidence_65', 'Sold-supported confidence >= 65', 8);
    else if (combinedConfidence >= 45) add('confidence', 'sold_confidence_45', 'Sold-supported confidence >= 45', 4);
    else if (combinedConfidence <= 15) add('confidence', 'confidence_15_or_lower', 'Combined confidence <= 15', -10);
  } else if (activeOnlyEvidence) {
    if (combinedConfidence >= 70) add('confidence', 'active_context_confidence', 'Active-context confidence', 4);
    else if (combinedConfidence >= 45) add('confidence', 'active_context_confidence_limited', 'Limited active-context confidence', 2);
    else if (combinedConfidence <= 15) add('confidence', 'confidence_15_or_lower', 'Combined confidence <= 15', -10);
  } else if (fallbackEvidence) {
    if (combinedConfidence <= 15) add('confidence', 'confidence_15_or_lower', 'Combined confidence <= 15', -10);
  } else if (combinedConfidence <= 15) {
    add('confidence', 'confidence_15_or_lower', 'Combined confidence <= 15', -10);
  }

  if (marketData.source === "sold_market") add('market_source', 'sold_market', 'Sold-market source', 10);
  if (marketData.source === "blended_market") add('market_source', 'blended_market', 'Blended-market source', 6);
  if (marketData.source === "active_market") add('market_source', 'active_market', 'Active-market source', 2);
  if (marketData.source === "insufficient_evidence") add('market_source', 'insufficient_evidence', 'Insufficient evidence source', -15);
  if (marketData.source === "fallback") add('market_source', 'fallback', 'Fallback market source', -18);

  if (flags.firstBowman) add('card_traits', 'first_bowman', '1st Bowman trait', 5);
  if (flags.numbered) add('card_traits', 'numbered', 'Numbered trait', 4);
  if (parsed.grade === 10) add('card_traits', 'grade_10', 'Grade 10 trait', 5);
  if (parsed.setName === "Bowman Chrome") add('card_traits', 'bowman_chrome', 'Bowman Chrome set', 4);
  if (parsed.setName === "Topps Chrome") add('card_traits', 'topps_chrome', 'Topps Chrome set', 3);
  if (parsed.setName === "Prizm") add('card_traits', 'prizm', 'Prizm set', 3);
  if (flags.pokemon && parsed.grade === 10) add('card_traits', 'pokemon_grade_10', 'Pokemon grade 10 trait', 4);

  if (flags.lot) add('risk_traits', 'lot', 'Lot risk trait', -45);
  if (flags.sealed) add('risk_traits', 'sealed', 'Sealed risk trait', -80);
  if (flags.reprint) add('risk_traits', 'reprint', 'Reprint risk trait', -100);
  if (flags.digital) add('risk_traits', 'digital', 'Digital risk trait', -100);
  if (flags.custom) add('risk_traits', 'custom', 'Custom risk trait', -90);

  if (listing.sellerFeedbackPercentage >= 99) add('seller', 'seller_feedback_percentage_99', 'Seller feedback percentage >= 99', 2);
  if (listing.sellerFeedbackScore >= 100) add('seller', 'seller_feedback_score_100', 'Seller feedback score >= 100', 2);

  if (listing.totalCost <= 0) setScore('safety_capital', 'non_positive_total_cost', 'Non-positive total cost resets legacy score', 0);
  if (listing.totalCost > 750 && estimatedProfit < 150) add('safety_capital', 'high_capital_limited_profit', 'High capital with limited profit', -20);

  const preClampTotal = score;
  let scoreCap = 100;
  let scoreCapReason = 'sufficient_sold_evidence';

  if (soldCompCount <= 0) {
    scoreCap = 45;
    scoreCapReason = 'zero_true_sold_comps';
  }

  if (fallbackOnlyEvidence) {
    scoreCap = Math.min(scoreCap, 35);
    scoreCapReason = 'fallback_only_evidence';
  } else if (activeOnlyEvidence) {
    scoreCap = Math.min(scoreCap, 45);
    scoreCapReason = 'active_only_evidence';
  }

  const uncappedScore = Math.max(0, Math.round(score));
  const finalScore = Math.max(0, Math.min(scoreCap, uncappedScore));

  const sumCategory = (category) => adders
    .filter((entry) => entry.category === category)
    .reduce((sum, entry) => sum + entry.value, 0);

  return {
    source: 'legacy_score_breakdown',
    trend: {
      scoreBonus: trendData.scoreBonus || 0,
      contribution: sumCategory('trend')
    },
    parsedCardTier: {
      tier: parsed.qualityTier || 'unknown',
      contribution: sumCategory('parsed_card_tier'),
      adjustments: adjustments.filter((entry) => entry.category === 'parsed_card_tier')
    },
    profit: {
      estimatedProfit,
      contribution: sumCategory('profit'),
      contributions: adders.filter((entry) => entry.category === 'profit')
    },
    roi: {
      roi,
      roiPercent: Math.round(Number(roi || 0) * 1000) / 10,
      contribution: sumCategory('roi'),
      contributions: adders.filter((entry) => entry.category === 'roi')
    },
    confidence: {
      combinedConfidence,
      contribution: sumCategory('confidence'),
      contributions: adders.filter((entry) => entry.category === 'confidence')
    },
    marketSource: {
      source: marketData.source || 'unknown',
      contribution: sumCategory('market_source'),
      contributions: adders.filter((entry) => entry.category === 'market_source')
    },
    evidence: {
      trueSoldCompCount: soldCompCount,
      activeCompCount,
      fallbackUnknownCompCount,
      activeOnlyEvidence,
      fallbackOnlyEvidence,
      contribution: sumCategory('evidence'),
      contributions: adders.filter((entry) => entry.category === 'evidence')
    },
    cardTraits: {
      contribution: sumCategory('card_traits'),
      contributions: adders.filter((entry) => entry.category === 'card_traits')
    },
    riskTraits: {
      contribution: sumCategory('risk_traits'),
      penalties: adders.filter((entry) => entry.category === 'risk_traits')
    },
    seller: {
      contribution: sumCategory('seller'),
      contributions: adders.filter((entry) => entry.category === 'seller')
    },
    safetyCapital: {
      contribution: sumCategory('safety_capital'),
      penalties: adders.filter((entry) => entry.category === 'safety_capital'),
      adjustments: adjustments.filter((entry) => entry.category === 'safety_capital')
    },
    contributions: adders,
    adjustments,
    preClampTotal,
    uncappedScore,
    scoreCap,
    scoreCapReason,
    finalScore
  };
}

function scoreListing(listing, compUniverse = []) {
  const parsed = listing.parsed || parseCardTitle(listing.title);

  const compData = compEngine.evaluateListing(listing, compUniverse, {
    fallbackEstimator: estimateMarketValue
  });

  const populationData = populationEngine.getPopulation(listing);
  const trendData = trendEngine.evaluateTrend(listing);

 const soldSalesSummary = soldSalesEngine.summarizeSoldSales(
    { ...listing, parsed },
    Object.values(store.listings)
);

const marketData = marketValueEngine.calculateMarketValue({
    listing: { ...listing, parsed },
    activeCompData: compData,
    soldComps: soldSalesSummary.sales,
    populationData,
    trendData,
    options: {
        fallbackEstimator: estimateMarketValue
    }
});

  let salesVelocityData = null;
let salesVelocity = "";

try {
  salesVelocityData = salesVelocityEngine.evaluateSalesVelocity({
    listing: { ...listing, parsed },
    parsed,
    soldSales: soldSalesSummary.sales,
    compData,
    marketData,
    activeCount: compData.activeCompCount || marketData.activeCompCount || marketData.activeCount,
    asOfDate: new Date().toISOString()
  });
  salesVelocity = salesVelocityEngine.summarizeSalesVelocity(salesVelocityData);
} catch (salesVelocityError) {
  console.warn("Sales Velocity Engine failed:", salesVelocityError.message);
  salesVelocityData = null;
  salesVelocity = "";
}

  const confidenceData = confidenceEngine.evaluateConfidence(listing, compData, compUniverse);

 const estimatedValue = marketData.source === "insufficient_evidence" ? 0 : (marketData.marketValue || compData.marketValue);

const roiData = roiEngine.evaluateROI({
  listing: { ...listing, parsed },
  marketData,
  marketConfidence: marketData.confidence,
  minimumProfitTarget: store.settings.minProfit,
  minimumRoiTarget: store.settings.minRoi
});

const ebayFees = roiData.costs?.fees?.totalSellerFees || estimatedValue * 0.1325;
const estimatedProfit = roiData.netProfit;
const roi = roiData.roi;

  const combinedConfidence = Math.max(confidenceData.confidence || 0, marketData.confidence || 0);
  const scoreBreakdown = createLegacyScoreBreakdown({
    parsed,
    trendData,
    estimatedProfit,
    roi,
    combinedConfidence,
    marketData,
    compData,
    listing
  });
  const finalScore = scoreBreakdown.finalScore;

  const qualityData = qualityEngine.evaluateQuality({
    ...listing,
    parsed,
    score: finalScore,
    estimatedValue,
    estimatedProfit,
    roi,
    ebayFees,
    compData,
    marketData,
    marketConfidence: combinedConfidence,
    confidenceReasons: confidenceData.reasons,
    confidenceCap: confidenceData.cap,
    compCount: compData.compCount,
    compSource: compData.source
  });

  const riskData = riskEngine.evaluateRisk({
    listing: { ...listing, parsed },
    marketData,
    soldSales: soldSalesSummary,
    roiData,
    compData,
    trendData,
    qualityData
});

  const marketIntelligenceData =
    marketIntelligenceEngine.evaluateMarketIntelligence({
        listing: { ...listing, parsed },
        marketData,
        soldSales: soldSalesSummary.sales,
        roiData,
        compData,
        canonicalSoldEvidence: getCanonicalSoldEvidenceForListing({ ...listing, parsed })
    });
  runShadowModeDecisionIntelligence(marketIntelligenceData, {
    listing: { ...listing, parsed }
  });
  
const decisionData = decisionEngine.makeDecision({
  listing: { ...listing, parsed },
  score: finalScore,
  roiData,
  riskData,
  marketData,
  confidenceData,
  qualityData,
  trendData,
  soldSales: soldSalesSummary,
  compData
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
    marketData,
    marketConfidence: combinedConfidence,
    confidenceReasons: confidenceData.reasons,
    confidenceCap: confidenceData.cap,
    compCount: compData.compCount,
    compSource: compData.source,
    qualityData,
    investmentQuality: qualityData.investmentQuality
  });

  return {
    score: finalScore,
    scoreBreakdown,
    estimatedValue,
    estimatedProfit,
    roi,
    ebayFees,
    compData,
    marketData,
    salesVelocityData,
    salesVelocity,
    soldSales: soldSalesSummary,
    roiData,
    confidenceData,
    marketConfidence: combinedConfidence,
    confidenceReasons: confidenceData.reasons,
    confidenceCap: confidenceData.cap,
    compCount: compData.compCount,
    compSource: compData.source,
    marketSource: marketData.source,
    marketMethod: marketData.method,
    qualityData,
    investmentQuality: qualityData.investmentQuality,
    qualityBucket: qualityData.bucket,
    liquidityScore: qualityData.liquidityScore,
    riskLevel: riskData.riskLevel,
riskData,
    marketIntelligenceData,
marketIntelligenceScore: marketIntelligenceData.intelligenceScore,
marketTrustLevel: marketIntelligenceData.trustLevel,
marketRecommendation: marketIntelligenceData.recommendation,
    decision: decisionData,
    qualityReasons: qualityData.positives,
    qualityWarnings: qualityData.warnings,
    population: populationEngine.summarizePopulation(populationData),
    trend: trendEngine.summarizeTrend(trendData),
    dealGrade
  };
}

function hasBuyLikeWording(value) {
  return signalSemantics.hasBuyLikeWording(value);
}

function getQualityBucketForDisplay(bucket, rejectedByDealGate) {
  const label = String(bucket || '').trim();
  if (!label) return '';
  return signalSemantics.getAllowedSignalLabel('quality_bucket', label);
}

function getSoldEvidenceCountForDisplay(item = {}, dealGateData = {}) {
  const candidates = [
    dealGateData.gate?.soldCompCount,
    item.compData?.trueSoldCompCount,
    item.marketData?.soldCompCount,
    item.marketIntelligenceData?.soldCompCount,
    item.soldSales?.saleCount,
    Array.isArray(item.soldSales?.sales) ? item.soldSales.sales.length : undefined,
    item.compData?.soldCompCount
  ];

  for (const value of candidates) {
    const number = Number(value);
    if (Number.isFinite(number)) return Math.max(0, Math.round(number));
  }

  return 0;
}

function getSignalRawValuesForDisplay(item = {}, display = {}) {
  const marketIntelligenceData = item.marketIntelligenceData || {};

  return {
    legacy_score: item.score ?? null,
    quality_score: item.investmentQuality ?? item.qualityData?.investmentQuality ?? null,
    quality_bucket: item.qualityBucket ?? item.qualityData?.bucket ?? null,
    deal_grade: item.dealGrade ?? null,
    market_confidence: item.marketConfidence ?? null,
    sold_evidence_confidence: {
      trueSoldCompCount: display.soldEvidenceCount ?? getSoldEvidenceCountForDisplay(item, item.dealGate || {})
    },
    intelligence_score: item.marketIntelligenceScore ?? marketIntelligenceData.intelligenceScore ?? null,
    confidence_score: marketIntelligenceData.confidenceScore ?? null,
    trust_level: item.marketTrustLevel ?? marketIntelligenceData.trustLevel ?? null,
    roi_recommendation: item.roiData?.recommendation ?? null,
    decision_intelligence: marketIntelligenceData.decisionIntelligence ?? null,
    deal_gate: item.dealGate ?? null
  };
}

function buildSignalAnnotationsForDisplay(item = {}, display = {}) {
  return signalAnnotation.annotateSignals(getSignalRawValuesForDisplay(item, display));
}

function buildDisplayInterpretation(item = {}) {
  const dealGateData = item.dealGate && typeof item.dealGate === 'object' ? item.dealGate : null;
  const rejectedByDealGate = dealGateData?.passed === false;
  const acceptedByDealGate = dealGateData?.passed === true;
  const rawQualityBucket = item.qualityBucket || item.qualityData?.bucket || '';
  const rawDealAction = item.dealGrade?.action || '';
  const rawRoiRecommendation = item.roiData?.recommendation || '';
  const soldEvidenceCount = getSoldEvidenceCountForDisplay(item, dealGateData || {});
  const legacyGradeActionLabel = rawDealAction ? signalSemantics.getAllowedSignalLabel('deal_grade', rawDealAction) : '';

  const display = {
    source: 'presentation_display_guard',
    authoritativeDecisionSource: dealGateData ? 'deal_gate' : 'unknown',
    authoritativeDecision: acceptedByDealGate ? 'BUY_NOW' : rejectedByDealGate ? 'REJECTED' : 'UNREVIEWED',
    primaryDecisionLabel: acceptedByDealGate ? 'BUY_NOW' : rejectedByDealGate ? 'Rejected by Deal Gate' : 'Pending Deal Gate',
    recommendationImpact: dealGateData ? (acceptedByDealGate ? 'approved_by_deal_gate' : 'blocked_by_deal_gate') : 'unknown',
    rejectionReasons: rejectedByDealGate ? [...(dealGateData.reasons || dealGateData.rejectionReasons || [])] : [],
    qualityBucketLabel: getQualityBucketForDisplay(rawQualityBucket, rejectedByDealGate),
    qualityContextLabel: rawQualityBucket ? 'Desirability context' : '',
    dealGradeLabel: item.dealGrade?.grade || '',
    legacyGradeActionLabel: rejectedByDealGate ? '' : legacyGradeActionLabel,
    hiddenLegacyGradeAction: rejectedByDealGate ? legacyGradeActionLabel : '',
    legacyGradeActionAuthority: signalSemantics.describeSignalAuthority('deal_grade'),
    roiRecommendationLabel: rawRoiRecommendation ? signalSemantics.getAllowedSignalLabel('roi_recommendation', rawRoiRecommendation) : '',
    roiRecommendationAuthority: signalSemantics.describeSignalAuthority('roi_recommendation'),
    marketConfidenceLabel: 'Market Context Confidence',
    marketConfidenceAuthority: signalSemantics.describeSignalAuthority('market_confidence'),
    soldEvidenceConfidenceLabel: 'Sold Evidence Support',
    soldEvidenceConfidenceAuthority: signalSemantics.describeSignalAuthority('sold_evidence_confidence'),
    legacyScoreLabel: 'Legacy Context Score',
    legacyScoreAuthority: signalSemantics.describeSignalAuthority('legacy_score'),
    soldEvidenceCount,
    suppressedBuyLikeLabels: false
  };

  display.suppressedBuyLikeLabels = rejectedByDealGate && (
    hasBuyLikeWording(rawQualityBucket) ||
    hasBuyLikeWording(rawDealAction) ||
    hasBuyLikeWording(display.qualityBucketLabel) ||
    hasBuyLikeWording(display.legacyGradeActionLabel)
  );

  display.signalAnnotations = buildSignalAnnotationsForDisplay(item, display);

  return {
    ...item,
    display
  };
}

function dealGate(listing = {}) {
  const reasons = [];
  const positives = [];

  const toNumber = (value, fallback = 0) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  };

  const normalize = (value) => String(value || '').trim().toLowerCase();

  const pickNumber = (sources, keys, fallback = 0) => {
    for (const source of sources) {
      if (!source || typeof source !== 'object') continue;

      for (const key of keys) {
        if (source[key] !== undefined && source[key] !== null && source[key] !== '') {
          const value = toNumber(source[key], NaN);
          if (Number.isFinite(value)) return value;
        }
      }
    }

    return fallback;
  };

  const pickString = (sources, keys, fallback = '') => {
    for (const source of sources) {
      if (!source || typeof source !== 'object') continue;

      for (const key of keys) {
        if (source[key] !== undefined && source[key] !== null && source[key] !== '') {
          return String(source[key]).trim();
        }
      }
    }

    return fallback;
  };

  const getRoiPercent = (sources) => {
    const explicitPercent = pickNumber(sources, [
      'roiPercent',
      'projectedRoiPercent',
      'projectedROIPercent'
    ], NaN);

    if (Number.isFinite(explicitPercent)) return explicitPercent;

    const decimalRoi = pickNumber(sources, ['roi', 'returnOnInvestment'], 0);
    return decimalRoi * 100;
  };

  const marketData = listing.marketData || {};
  const soldSales = Array.isArray(listing.soldSales)
    ? listing.soldSales
    : Array.isArray(listing.soldSales?.sales)
      ? listing.soldSales.sales
      : [];
  const marketIntelligenceData = listing.marketIntelligenceData || {};
  const riskData = listing.riskData || {};
  const compData = listing.compData || {};
  const qualityData = listing.qualityData || {};
  const parsed = listing.parsed || {};

  const score = toNumber(listing.score, 0);
  const estimatedProfit = toNumber(listing.estimatedProfit, 0);
  const roi = toNumber(listing.roi, 0);
  const roiPercent = getRoiPercent([listing.roiData, listing, marketData, compData]);

  const soldCompCount = Math.max(
    soldSales.length,
    pickNumber([marketData, compData, qualityData, marketIntelligenceData.compQuality], [
      'trueSoldCompCount',
      'soldCompCount',
      'soldCount',
      'recentSoldCount',
      'completedSales',
      'salesCount',
      'usableSoldCompCount'
    ], 0)
  );

  const marketIntelligenceScore = pickNumber([
    listing,
    marketIntelligenceData,
    marketIntelligenceData.confidence
  ], [
    'marketIntelligenceScore',
    'intelligenceScore',
    'confidenceScore'
  ], 0);

  const marketTrustLevel = normalize(
    listing.marketTrustLevel ||
    marketIntelligenceData.trustLevel ||
    marketIntelligenceData.confidence && marketIntelligenceData.confidence.trustLevel
  );

  const marketRecommendation = normalize(
    listing.marketRecommendation ||
    marketIntelligenceData.recommendation ||
    marketIntelligenceData.confidence && marketIntelligenceData.confidence.recommendation
  );

  const riskLevel = normalize(
    listing.riskLevel ||
    riskData.riskLevel ||
    riskData.level ||
    riskData.risk
  );

  const liquidityScore = pickNumber([
    marketIntelligenceData.liquidity,
    marketData
  ], [
    'score',
    'liquidityScore'
  ], 0);

  const liquidityLevel = normalize(pickString([
    marketIntelligenceData.liquidity,
    marketData
  ], [
    'level',
    'liquidityLevel'
  ], ''));

  const priceConsistencyScore = pickNumber([
    marketIntelligenceData.priceConsistency,
    marketIntelligenceData.pricing,
    compData
  ], [
    'score',
    'priceConsistencyScore',
    'pricingScore'
  ], 0);

  const pricingLevel = normalize(pickString([
    marketIntelligenceData.priceConsistency,
    marketIntelligenceData.pricing,
    compData
  ], [
    'level',
    'pricingLevel'
  ], ''));

  const confidenceScore = pickNumber([
    marketIntelligenceData.confidence,
    marketIntelligenceData,
    marketData,
    qualityData
  ], [
    'confidenceScore',
    'confidence',
    'marketConfidence',
    'marketConfidenceScore'
  ], 0);

  const condition = normalize(
    listing.condition ||
    parsed.condition ||
    parsed.grade ||
    qualityData.condition
  );

  const dealGrade = String(listing.dealGrade || '').trim().toUpperCase();

  const compSource = normalize(
    listing.compSource ||
    compData.compSource ||
    compData.source ||
    marketData.source ||
    marketData.valueSource ||
    marketData.valuationSource
  );

  const usesHeuristicFallback =
    compSource.includes('heuristic') ||
    compSource.includes('fallback') ||
    normalize(marketData.source).includes('heuristic') ||
    normalize(marketData.valueSource).includes('heuristic') ||
    normalize(marketData.valuationSource).includes('heuristic');

  const estimatedValue = pickNumber([
    listing,
    marketData,
    compData,
    marketIntelligenceData.pricing,
    marketIntelligenceData.priceConsistency
  ], [
    'estimatedValue',
    'estimatedSalePrice',
    'targetSalePrice',
    'projectedSalePrice',
    'marketValue'
  ], 0);

  const referenceMarketValue = pickNumber([
    marketData,
    compData,
    marketIntelligenceData.pricing,
    marketIntelligenceData.priceConsistency
  ], [
    'referencePrice',
    'medianPrice',
    'medianSoldPrice',
    'averagePrice',
    'avgPrice',
    'averageSoldPrice',
    'marketValue'
  ], 0);

  const conditionUnknown =
    !condition ||
    condition === 'unknown' ||
    condition === 'n/a' ||
    condition === 'na' ||
    condition === 'ungraded?';

  if (soldCompCount <= 0) {
    reasons.push('Zero sold comps available.');
  } else if (soldCompCount < 3) {
    reasons.push(`Only ${soldCompCount} sold comp${soldCompCount === 1 ? '' : 's'} available; minimum is 3.`);
  } else {
    positives.push(`Supported by ${soldCompCount} sold comps.`);
  }

  if (confidenceScore > 0 && confidenceScore < 60) {
    reasons.push(`Market confidence is too low (${confidenceScore}/100).`);
  }

  if (marketIntelligenceScore > 0 && marketIntelligenceScore < 60) {
    reasons.push(`Market Intelligence score is too low (${marketIntelligenceScore}/100).`);
  }

  if (liquidityScore > 0 && liquidityScore < 55) {
    reasons.push(`Liquidity score is weak (${liquidityScore}/100).`);
  }

  if (['weak', 'poor', 'thin', 'unreliable'].includes(liquidityLevel)) {
    reasons.push(`Liquidity level is ${liquidityLevel}.`);
  }

  if (priceConsistencyScore > 0 && priceConsistencyScore < 55) {
    reasons.push(`Pricing reliability is too low (${priceConsistencyScore}/100).`);
  }

  if (['weak', 'poor', 'unreliable'].includes(pricingLevel)) {
    reasons.push(`Pricing level is ${pricingLevel}.`);
  }

  if (['high', 'very_high', 'very high', 'severe', 'critical'].includes(riskLevel)) {
    reasons.push(`Risk level is ${riskLevel}.`);
  }

  if (['weak', 'unreliable'].includes(marketTrustLevel)) {
    reasons.push(`Market trust level is ${marketTrustLevel}.`);
  }

  if (marketRecommendation === 'do_not_trust') {
    reasons.push('Market Intelligence recommendation is do_not_trust.');
  }

  if (confidenceScore > 0 && confidenceScore < 60 && ['A', 'A+'].includes(dealGrade)) {
    reasons.push(`Impossible grade/confidence combination: ${dealGrade} with ${confidenceScore}/100 confidence.`);
  }

  if (usesHeuristicFallback && ['A', 'A+'].includes(dealGrade)) {
    reasons.push(`Heuristic fallback cannot support ${dealGrade} approval.`);
  }

  if (referenceMarketValue > 0 && estimatedValue > referenceMarketValue * 2.5) {
    reasons.push(
      `Estimated value (${estimatedValue}) is more than 2.5x market support (${referenceMarketValue}).`
    );
  }

  if (soldCompCount <= 0 && estimatedProfit > 50) {
    reasons.push('Projected profit is high despite no sold history.');
  }

  if (roiPercent > 150) {
    const roiHasStrongSupport =
      soldCompCount >= 8 &&
      confidenceScore >= 85 &&
      marketIntelligenceScore >= 85 &&
      liquidityScore >= 75 &&
      priceConsistencyScore >= 75 &&
      ['excellent', 'good', ''].includes(marketTrustLevel) &&
      !['high', 'very_high', 'very high', 'severe', 'critical'].includes(riskLevel) &&
      !usesHeuristicFallback;

    if (!roiHasStrongSupport) {
      reasons.push(`ROI is excessive (${roiPercent}%) without very strong independent support.`);
    }
  }

  if (usesHeuristicFallback) {
    const heuristicHasStrongSupport =
      soldCompCount >= 8 &&
      confidenceScore >= 88 &&
      marketIntelligenceScore >= 85 &&
      liquidityScore >= 80 &&
      priceConsistencyScore >= 80 &&
      ['excellent', 'good'].includes(marketTrustLevel) &&
      ['excellent', 'good', ''].includes(liquidityLevel) &&
      ['excellent', 'good', ''].includes(pricingLevel) &&
      !conditionUnknown &&
      !['high', 'very_high', 'very high', 'severe', 'critical'].includes(riskLevel) &&
      roiPercent <= 150;

    if (!heuristicHasStrongSupport) {
      reasons.push('Heuristic fallback valuation lacks enough independent support.');
    }
  }

  if (conditionUnknown) {
    const unknownConditionHasSupport =
      soldCompCount >= 5 &&
      confidenceScore >= 75 &&
      marketIntelligenceScore >= 75 &&
      liquidityScore >= 65 &&
      priceConsistencyScore >= 65 &&
      roiPercent <= 100 &&
      !usesHeuristicFallback &&
      !['high', 'very_high', 'very high', 'severe', 'critical'].includes(riskLevel);

    if (!unknownConditionHasSupport) {
      reasons.push('Unknown condition does not have enough support to approve.');
    }
  }

  if (score >= 80) positives.push(`Listing score is strong (${score}/100).`);
  if (confidenceScore >= 75) positives.push(`Market confidence is acceptable (${confidenceScore}/100).`);
  if (marketIntelligenceScore >= 75) positives.push(`Market Intelligence score is acceptable (${marketIntelligenceScore}/100).`);
  if (liquidityScore >= 70) positives.push(`Liquidity score is acceptable (${liquidityScore}/100).`);
  if (priceConsistencyScore >= 70) positives.push(`Pricing consistency is acceptable (${priceConsistencyScore}/100).`);

  const buyNowAllowed =
    reasons.length === 0 &&
    score >= 75 &&
    estimatedProfit > 0 &&
    soldCompCount >= 3 &&
    confidenceScore >= 75 &&
    marketIntelligenceScore >= 80 &&
    liquidityScore >= 65 &&
    priceConsistencyScore >= 65 &&
    !['weak', 'unreliable'].includes(marketTrustLevel) &&
    !['weak', 'poor', 'thin', 'unreliable'].includes(liquidityLevel) &&
    !['weak', 'poor', 'unreliable'].includes(pricingLevel) &&
    !['high', 'very_high', 'very high', 'severe', 'critical'].includes(riskLevel) &&
    marketRecommendation !== 'do_not_trust';

  const buildDealGateBreakdown = () => {
    const rules = [];

    const addRule = ({ ruleId, category, label, requiredValue, actualValue, passed, reason = '', applies = true, metadata = {} }) => {
      rules.push({
        ruleId,
        category,
        label,
        requiredValue,
        actualValue,
        passed: Boolean(passed),
        applies: Boolean(applies),
        reason,
        metadata
      });
    };

    const badRiskLevels = ['high', 'very_high', 'very high', 'severe', 'critical'];
    const badLiquidityLevels = ['weak', 'poor', 'thin', 'unreliable'];
    const badPricingLevels = ['weak', 'poor', 'unreliable'];
    const badTrustLevels = ['weak', 'unreliable'];
    const roiHasStrongSupport =
      soldCompCount >= 8 &&
      confidenceScore >= 85 &&
      marketIntelligenceScore >= 85 &&
      liquidityScore >= 75 &&
      priceConsistencyScore >= 75 &&
      ['excellent', 'good', ''].includes(marketTrustLevel) &&
      !badRiskLevels.includes(riskLevel) &&
      !usesHeuristicFallback;
    const heuristicHasStrongSupport =
      soldCompCount >= 8 &&
      confidenceScore >= 88 &&
      marketIntelligenceScore >= 85 &&
      liquidityScore >= 80 &&
      priceConsistencyScore >= 80 &&
      ['excellent', 'good'].includes(marketTrustLevel) &&
      ['excellent', 'good', ''].includes(liquidityLevel) &&
      ['excellent', 'good', ''].includes(pricingLevel) &&
      !conditionUnknown &&
      !badRiskLevels.includes(riskLevel) &&
      roiPercent <= 150;
    const unknownConditionHasSupport =
      soldCompCount >= 5 &&
      confidenceScore >= 75 &&
      marketIntelligenceScore >= 75 &&
      liquidityScore >= 65 &&
      priceConsistencyScore >= 65 &&
      roiPercent <= 100 &&
      !usesHeuristicFallback &&
      !badRiskLevels.includes(riskLevel);

    addRule({
      ruleId: 'sold_comp_minimum',
      category: 'evidence',
      label: 'At least 3 true sold comps are required.',
      requiredValue: '>= 3 true sold comps',
      actualValue: soldCompCount,
      passed: soldCompCount >= 3,
      reason: soldCompCount <= 0
        ? 'Zero sold comps available.'
        : soldCompCount < 3
          ? `Only ${soldCompCount} sold comp${soldCompCount === 1 ? '' : 's'} available; minimum is 3.`
          : `Supported by ${soldCompCount} sold comps.`
    });
    addRule({ ruleId: 'market_confidence_floor', category: 'confidence', label: 'Market confidence cannot be below 60 when present.', requiredValue: '0 or >= 60', actualValue: confidenceScore, passed: !(confidenceScore > 0 && confidenceScore < 60), reason: confidenceScore > 0 && confidenceScore < 60 ? `Market confidence is too low (${confidenceScore}/100).` : '' });
    addRule({ ruleId: 'market_intelligence_floor', category: 'market_intelligence', label: 'Market Intelligence score cannot be below 60 when present.', requiredValue: '0 or >= 60', actualValue: marketIntelligenceScore, passed: !(marketIntelligenceScore > 0 && marketIntelligenceScore < 60), reason: marketIntelligenceScore > 0 && marketIntelligenceScore < 60 ? `Market Intelligence score is too low (${marketIntelligenceScore}/100).` : '' });
    addRule({ ruleId: 'liquidity_score_floor', category: 'liquidity', label: 'Liquidity score cannot be below 55 when present.', requiredValue: '0 or >= 55', actualValue: liquidityScore, passed: !(liquidityScore > 0 && liquidityScore < 55), reason: liquidityScore > 0 && liquidityScore < 55 ? `Liquidity score is weak (${liquidityScore}/100).` : '' });
    addRule({ ruleId: 'liquidity_level_allowed', category: 'liquidity', label: 'Liquidity level cannot be weak, poor, thin, or unreliable.', requiredValue: 'not weak/poor/thin/unreliable', actualValue: liquidityLevel || '', passed: !badLiquidityLevels.includes(liquidityLevel), reason: badLiquidityLevels.includes(liquidityLevel) ? `Liquidity level is ${liquidityLevel}.` : '' });
    addRule({ ruleId: 'pricing_reliability_floor', category: 'pricing', label: 'Pricing reliability cannot be below 55 when present.', requiredValue: '0 or >= 55', actualValue: priceConsistencyScore, passed: !(priceConsistencyScore > 0 && priceConsistencyScore < 55), reason: priceConsistencyScore > 0 && priceConsistencyScore < 55 ? `Pricing reliability is too low (${priceConsistencyScore}/100).` : '' });
    addRule({ ruleId: 'pricing_level_allowed', category: 'pricing', label: 'Pricing level cannot be weak, poor, or unreliable.', requiredValue: 'not weak/poor/unreliable', actualValue: pricingLevel || '', passed: !badPricingLevels.includes(pricingLevel), reason: badPricingLevels.includes(pricingLevel) ? `Pricing level is ${pricingLevel}.` : '' });
    addRule({ ruleId: 'risk_level_allowed', category: 'risk', label: 'Risk level cannot be high, severe, or critical.', requiredValue: 'not high/severe/critical', actualValue: riskLevel || '', passed: !badRiskLevels.includes(riskLevel), reason: badRiskLevels.includes(riskLevel) ? `Risk level is ${riskLevel}.` : '' });
    addRule({ ruleId: 'market_trust_allowed', category: 'market_intelligence', label: 'Market trust level cannot be weak or unreliable.', requiredValue: 'not weak/unreliable', actualValue: marketTrustLevel || '', passed: !badTrustLevels.includes(marketTrustLevel), reason: badTrustLevels.includes(marketTrustLevel) ? `Market trust level is ${marketTrustLevel}.` : '' });
    addRule({ ruleId: 'market_recommendation_allowed', category: 'market_intelligence', label: 'Market Intelligence cannot recommend do_not_trust.', requiredValue: 'not do_not_trust', actualValue: marketRecommendation || '', passed: marketRecommendation !== 'do_not_trust', reason: marketRecommendation === 'do_not_trust' ? 'Market Intelligence recommendation is do_not_trust.' : '' });
    addRule({ ruleId: 'grade_confidence_consistency', category: 'consistency', label: 'A/A+ grade cannot coexist with low confidence.', requiredValue: 'not A/A+ with confidence < 60', actualValue: { dealGrade, confidenceScore }, passed: !(confidenceScore > 0 && confidenceScore < 60 && ['A', 'A+'].includes(dealGrade)), reason: confidenceScore > 0 && confidenceScore < 60 && ['A', 'A+'].includes(dealGrade) ? `Impossible grade/confidence combination: ${dealGrade} with ${confidenceScore}/100 confidence.` : '' });
    addRule({ ruleId: 'heuristic_grade_consistency', category: 'consistency', label: 'Heuristic fallback cannot support A/A+ approval.', requiredValue: 'not heuristic fallback with A/A+', actualValue: { usesHeuristicFallback, dealGrade }, passed: !(usesHeuristicFallback && ['A', 'A+'].includes(dealGrade)), reason: usesHeuristicFallback && ['A', 'A+'].includes(dealGrade) ? `Heuristic fallback cannot support ${dealGrade} approval.` : '' });
    addRule({ ruleId: 'estimated_value_market_support', category: 'valuation', label: 'Estimated value cannot exceed 2.5x reference market support.', requiredValue: '<= 2.5x reference market value', actualValue: { estimatedValue, referenceMarketValue }, passed: !(referenceMarketValue > 0 && estimatedValue > referenceMarketValue * 2.5), reason: referenceMarketValue > 0 && estimatedValue > referenceMarketValue * 2.5 ? `Estimated value (${estimatedValue}) is more than 2.5x market support (${referenceMarketValue}).` : '' });
    addRule({ ruleId: 'profit_requires_sold_history', category: 'evidence', label: 'High projected profit requires sold history.', requiredValue: 'sold comps > 0 or profit <= 50', actualValue: { soldCompCount, estimatedProfit }, passed: !(soldCompCount <= 0 && estimatedProfit > 50), reason: soldCompCount <= 0 && estimatedProfit > 50 ? 'Projected profit is high despite no sold history.' : '' });
    addRule({ ruleId: 'excessive_roi_support', category: 'roi', label: 'ROI above 150% requires very strong independent support.', requiredValue: 'ROI <= 150% or strong support', actualValue: { roiPercent, soldCompCount, confidenceScore, marketIntelligenceScore, liquidityScore, priceConsistencyScore }, passed: !(roiPercent > 150 && !roiHasStrongSupport), reason: roiPercent > 150 && !roiHasStrongSupport ? `ROI is excessive (${roiPercent}%) without very strong independent support.` : '', applies: roiPercent > 150 });
    addRule({ ruleId: 'heuristic_fallback_support', category: 'valuation', label: 'Heuristic fallback needs very strong independent support.', requiredValue: 'not heuristic fallback or strong support', actualValue: { usesHeuristicFallback, soldCompCount, confidenceScore, marketIntelligenceScore, liquidityScore, priceConsistencyScore, roiPercent }, passed: !usesHeuristicFallback || heuristicHasStrongSupport, reason: usesHeuristicFallback && !heuristicHasStrongSupport ? 'Heuristic fallback valuation lacks enough independent support.' : '', applies: usesHeuristicFallback });
    addRule({ ruleId: 'unknown_condition_support', category: 'condition', label: 'Unknown condition needs stronger support.', requiredValue: 'known condition or strong support', actualValue: { condition: condition || 'unknown', conditionUnknown, soldCompCount, confidenceScore, marketIntelligenceScore, liquidityScore, priceConsistencyScore, roiPercent }, passed: !conditionUnknown || unknownConditionHasSupport, reason: conditionUnknown && !unknownConditionHasSupport ? 'Unknown condition does not have enough support to approve.' : '', applies: conditionUnknown });

    addRule({ ruleId: 'final_no_rejection_reasons', category: 'final_approval', label: 'No rejection reasons may be present.', requiredValue: '0 rejection reasons', actualValue: reasons.length, passed: reasons.length === 0, reason: reasons.length ? `${reasons.length} rejection reason${reasons.length === 1 ? '' : 's'} present.` : '' });
    addRule({ ruleId: 'final_score_minimum', category: 'final_approval', label: 'Legacy Context Score must be at least 75.', requiredValue: '>= 75', actualValue: score, passed: score >= 75, reason: score >= 75 ? '' : `Legacy Context Score is below 75 (${score}/100).` });
    addRule({ ruleId: 'final_profit_positive', category: 'final_approval', label: 'Estimated profit must be positive.', requiredValue: '> 0', actualValue: estimatedProfit, passed: estimatedProfit > 0, reason: estimatedProfit > 0 ? '' : 'Estimated profit is not positive.' });
    addRule({ ruleId: 'final_sold_comp_minimum', category: 'final_approval', label: 'At least 3 sold comps are required for BUY_NOW.', requiredValue: '>= 3', actualValue: soldCompCount, passed: soldCompCount >= 3, reason: soldCompCount >= 3 ? '' : 'Fewer than 3 sold comps for final approval.' });
    addRule({ ruleId: 'final_confidence_minimum', category: 'final_approval', label: 'Confidence score must be at least 75.', requiredValue: '>= 75', actualValue: confidenceScore, passed: confidenceScore >= 75, reason: confidenceScore >= 75 ? '' : `Confidence score is below 75 (${confidenceScore}/100).` });
    addRule({ ruleId: 'final_market_intelligence_minimum', category: 'final_approval', label: 'Market Intelligence score must be at least 80.', requiredValue: '>= 80', actualValue: marketIntelligenceScore, passed: marketIntelligenceScore >= 80, reason: marketIntelligenceScore >= 80 ? '' : `Market Intelligence score is below 80 (${marketIntelligenceScore}/100).` });
    addRule({ ruleId: 'final_liquidity_minimum', category: 'final_approval', label: 'Liquidity score must be at least 65.', requiredValue: '>= 65', actualValue: liquidityScore, passed: liquidityScore >= 65, reason: liquidityScore >= 65 ? '' : `Liquidity score is below 65 (${liquidityScore}/100).` });
    addRule({ ruleId: 'final_pricing_minimum', category: 'final_approval', label: 'Pricing consistency score must be at least 65.', requiredValue: '>= 65', actualValue: priceConsistencyScore, passed: priceConsistencyScore >= 65, reason: priceConsistencyScore >= 65 ? '' : `Pricing consistency score is below 65 (${priceConsistencyScore}/100).` });
    addRule({ ruleId: 'final_market_trust_allowed', category: 'final_approval', label: 'Market trust level must be acceptable.', requiredValue: 'not weak/unreliable', actualValue: marketTrustLevel || '', passed: !badTrustLevels.includes(marketTrustLevel), reason: badTrustLevels.includes(marketTrustLevel) ? `Market trust level is ${marketTrustLevel}.` : '' });
    addRule({ ruleId: 'final_liquidity_level_allowed', category: 'final_approval', label: 'Liquidity level must be acceptable.', requiredValue: 'not weak/poor/thin/unreliable', actualValue: liquidityLevel || '', passed: !badLiquidityLevels.includes(liquidityLevel), reason: badLiquidityLevels.includes(liquidityLevel) ? `Liquidity level is ${liquidityLevel}.` : '' });
    addRule({ ruleId: 'final_pricing_level_allowed', category: 'final_approval', label: 'Pricing level must be acceptable.', requiredValue: 'not weak/poor/unreliable', actualValue: pricingLevel || '', passed: !badPricingLevels.includes(pricingLevel), reason: badPricingLevels.includes(pricingLevel) ? `Pricing level is ${pricingLevel}.` : '' });
    addRule({ ruleId: 'final_risk_level_allowed', category: 'final_approval', label: 'Risk level must be acceptable.', requiredValue: 'not high/severe/critical', actualValue: riskLevel || '', passed: !badRiskLevels.includes(riskLevel), reason: badRiskLevels.includes(riskLevel) ? `Risk level is ${riskLevel}.` : '' });
    addRule({ ruleId: 'final_market_recommendation_allowed', category: 'final_approval', label: 'Market recommendation must be acceptable.', requiredValue: 'not do_not_trust', actualValue: marketRecommendation || '', passed: marketRecommendation !== 'do_not_trust', reason: marketRecommendation === 'do_not_trust' ? 'Market Intelligence recommendation is do_not_trust.' : '' });

    const failedRules = rules.filter((rule) => !rule.passed);
    const passedRules = rules.filter((rule) => rule.passed);

    return {
      source: 'deal_gate_breakdown',
      version: '1.0.0',
      decisionImpact: 'none',
      passed: buyNowAllowed,
      buyNowAllowed,
      decision: buyNowAllowed ? 'BUY_NOW' : 'REJECT',
      rules,
      passedRules: passedRules.map((rule) => rule.ruleId),
      failedRules: failedRules.map((rule) => rule.ruleId),
      passedReasons: positives.slice(),
      failedReasons: reasons.slice(),
      diagnostic: {
        totalRules: rules.length,
        passedRuleCount: passedRules.length,
        failedRuleCount: failedRules.length,
        appliedRuleCount: rules.filter((rule) => rule.applies).length,
        skippedRuleCount: rules.filter((rule) => !rule.applies).length,
        authoritativeDecisionSource: 'deal_gate',
        productionBehaviorChanged: false
      }
    };
  };

  const dealGateBreakdown = buildDealGateBreakdown();

  return {
    passed: buyNowAllowed,
    approved: buyNowAllowed,
    pass: buyNowAllowed,
    shouldBuy: buyNowAllowed,
    buyNowAllowed,
    decision: buyNowAllowed ? 'BUY_NOW' : 'REJECT',
    recommendation: buyNowAllowed ? 'buy_now' : 'reject',
    reasons,
    rejectionReasons: reasons,
    positives,
    dealGateBreakdown,
    gate: {
      score,
      estimatedProfit,
      roi,
      roiPercent,
      soldCompCount,
      confidenceScore,
      marketIntelligenceScore,
      marketTrustLevel,
      marketRecommendation,
      liquidityScore,
      liquidityLevel,
      priceConsistencyScore,
      pricingLevel,
      riskLevel,
      dealGrade,
      condition: condition || 'unknown',
      conditionUnknown,
      compSource,
      usesHeuristicFallback,
      estimatedValue,
      referenceMarketValue
    }
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
    salesVelocityData: scoring.salesVelocityData,
    salesVelocity: scoring.salesVelocity,
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
  const listingId = listingIdentity.getListingId(saved);

  const gate = dealGate(saved);
  saved.dealGate = gate;
  try {
  predictionAccuracyEngine.recordPrediction({
    listingId,
    title: saved.title,
    recommendation: gate.passed ? "BUY_NOW" : "PASS",
    decisionScore: scoring.score,
    decisionConfidence: scoring.marketConfidence,
    projectedROI: scoring.roi,
    projectedProfit: scoring.estimatedProfit,
    expectedValue: scoring.estimatedValue,
    expectedValueLow: scoring.marketData?.expectedValueLow,
    expectedValueHigh: scoring.marketData?.expectedValueHigh,
    salesVelocityData: scoring.salesVelocityData,
    lane: detectedLane,
    gradingCompany: saved.parsed?.gradingCompany || saved.parsed?.grader || listing.parsed?.gradingCompany || listing.parsed?.grader
  });
} catch (predictionAccuracyError) {
  console.warn("Prediction Accuracy Engine failed:", predictionAccuracyError.message);
}
  try {
  decisionValidationEngine.recordDecision({
    listingId,
    title: saved.title,
    decision: gate.passed ? "BUY_NOW" : "PASS",
    decisionScore: scoring.decision?.decisionScore || scoring.decision?.score || scoring.score,
    decisionConfidence: scoring.decision?.decisionConfidence || scoring.decision?.confidence,
    evidenceScore:
      scoring.decision?.evidenceScore ||
      scoring.decision?.evidenceStrength ||
      scoring.decision?.matrix?.evidenceStrength?.score,
    opportunityScore:
      scoring.decision?.opportunityScore ||
      scoring.decision?.investmentQuality ||
      scoring.decision?.matrix?.investmentQuality?.score,
    expectedValue:
      scoring.marketData?.expectedValue ||
      scoring.marketData?.marketValue ||
      scoring.estimatedValue,
    expectedValueLow: scoring.marketData?.expectedValueLow,
    expectedValueHigh: scoring.marketData?.expectedValueHigh,
    listingCost: saved.totalCost || saved.price,
    projectedROI: scoring.roi,
    projectedProfit: scoring.estimatedProfit,
    timestamp: now
  });
} catch (decisionValidationError) {
  console.warn("Decision Validation Engine recordDecision failed:", decisionValidationError.message);
}
  
  try {
  learningEngine.recordPrediction({
    listing: saved,
    parsed: saved.parsed,
    scoring,
    decisionData: scoring.decision,
    decision: gate.decision || gate.recommendation || scoring.decision?.decision || scoring.decision?.recommendation || "",
    dealGate: gate,
    compData: scoring.compData,
    marketData: scoring.marketData,
    roiData: scoring.roiData,
    riskData: scoring.riskData,
    marketIntelligenceData: scoring.marketIntelligenceData,
    trendData: scoring.trendData,
    qualityData: scoring.qualityData,
    dealGrade: scoring.dealGrade?.grade || scoring.dealGrade?.label || scoring.dealGrade || "",
    observedAt: now
  });
} catch (learningError) {
  console.warn("Learning Engine recordPrediction failed:", learningError.message);
}

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

const scoutScanner = createScoutScanner({
  activeMarketplace,
  decisionValidationEngine,
  getStore: () => store,
  historyEngine,
  lanes: LANES,
  learningEngine,
  listingIdentity,
  parseCardTitle,
  predictionAccuracyEngine,
  saveScoutedListing,
  saveStore,
  sleep,
  systemHealth
});

function runScoutScan(source = "automatic") {
  return scoutScanner.runScoutScan(source);
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
  console.log(`eBay rate protection: query delay ${activeMarketplace.config.searchDelayMs}ms, lane delay ${activeMarketplace.config.laneDelayMs}ms, query limit ${activeMarketplace.config.scanQueryLimit}.`);

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
          .guardrail { margin: 0 0 22px 0; padding: 14px 16px; border-radius: 12px; background: #1e293b; border: 1px solid #334155; color: #cbd5e1; }
          .guardrail strong { color: #e2e8f0; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>🦅 CardHawk</h1>
          <div class="subtitle">Private scouting engine. Built to find cards that can actually make money.</div>
          <div class="guardrail">
            <strong>Mode: ${escapeHtml(CONFIG_READINESS.mode.toUpperCase())}</strong> — CardHawk provides scouting recommendations only. BUY_NOW means high-priority scouting candidate for human review, not an automated purchase.
          </div>

          <nav>
            <a href="/">Dashboard</a>
            <a href="/alerts">Deal Alerts</a>
            <a href="/rejections">Rejected</a>
            <a href="/history">History</a>
            <a href="/scans">Scan History</a>
            <a href="/health">Health</a>
            <a href="/metrics">Metrics</a>
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

app.get("/validation", (req, res) => {
  try {
    const listings = Object.values(store.listings || {});
    const historySummary = historyEngine.summarizeHistory?.() || {};
    const learningSummary = learningEngine.summarizeLearning?.() || {};
    const recentPredictions = learningEngine.getRecentPredictions?.(100) || [];
    const decisionSummary = decisionValidationEngine.summarizeDecisionValidation?.() || {};
    const recentDecisions = decisionValidationEngine.getRecentDecisions?.(100) || [];
    const validationReport = validationHarness.evaluateBatch(listings);
    const predictionAccuracyReport = predictionAccuracyEngine.summarizePredictionAccuracy?.() || {};
    const calibrationReport = calibrationReportEngine.generateCalibrationReport({
      decisionValidationSummary: decisionSummary,
      decisionRecords: recentDecisions,
      learningSummary,
      learningRecords: recentPredictions,
      historySummary
    });

    res.send(layout("CardHawk Validation", `
      <h2>Validation</h2>
      <pre>${escapeHtml(JSON.stringify({
        calibrationReport,
        validationReport,
        predictionAccuracyReport
      }, null, 2))}</pre>
    `));
  } catch (error) {
    res.status(500).send(layout("Validation Error", `<pre>${escapeHtml(error.message)}</pre>`));
  }
});

app.get("/search", async (req, res) => {
  try {
    const query = req.query.q || "";
    const selectedLane = req.query.lane || "baseball";
    const results = query ? await activeMarketplace.search(query, 12, { parseCardTitle }) : [];

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
  try {
    const scan = await runScoutScan("manual");
    recordOperatorAction(req, "manual_scan_requested", {
      status: scan?.status || "unknown",
      details: {
        scanId: scan?.id || null,
        source: scan?.source || "manual",
        listingsFound: scan?.listingsFound || 0,
        newAlerts: scan?.newAlerts || 0,
        rateLimited: Boolean(scan?.rateLimited),
        error: scan?.error || null
      }
    });
  } catch (error) {
    recordOperatorAction(req, "manual_scan_requested", {
      status: "failed",
      details: {
        error: error.message
      }
    });
    throw error;
  }
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
  const listing = getStoredListingById(req.params.itemId);
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
  const listing = getStoredListingById(req.params.itemId);
  if (!listing) return res.status(404).json({ error: "Listing not found" });

  const scoring = scoreListing(listing, Object.values(store.listings));
  const displayListing = { ...listing, ...scoring, dealGate: listing.dealGate || dealGate({ ...listing, ...scoring }) };
  res.json({
    listing: {
      ebayItemId: listing.ebayItemId,
      title: listing.title,
      lane: listing.lane,
      price: listing.totalCost || listing.price,
      url: listing.url
    },
    grade: scoring.dealGrade,
    quality: scoring.qualityData,
    scoreBreakdown: scoring.scoreBreakdown,
    display: buildDisplayInterpretation(displayListing).display
  });
});

app.get("/api/quality/listing/:itemId", (req, res) => {
  const listing = getStoredListingById(req.params.itemId);
  if (!listing) return res.status(404).json({ error: "Listing not found" });

  const scoring = scoreListing(listing, Object.values(store.listings));
  const displayListing = { ...listing, ...scoring, dealGate: listing.dealGate || dealGate({ ...listing, ...scoring }) };
  res.json({
    listing: {
      ebayItemId: listing.ebayItemId,
      title: listing.title,
      lane: listing.lane,
      price: listing.totalCost || listing.price,
      url: listing.url
    },
    quality: scoring.qualityData,
    grade: scoring.dealGrade,
    scoreBreakdown: scoring.scoreBreakdown,
    display: buildDisplayInterpretation(displayListing).display
  });
});

app.get("/api/alerts/debug", (req, res) => {
  const alerts = store.alerts || [];
  const analyzed = alerts.map(alert => {
    const ruleCheck = notificationEngine.evaluateAlertRules(alert);
    const display = buildDisplayInterpretation(alert).display;
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
      createdAt: alert.createdAt,
      display
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
      const display = buildDisplayInterpretation(alert).display;
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
        url: alert.url,
        display
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

app.get("/api/alerts/send-pending", (req, res) => {
  res.setHeader("Allow", "POST");
  res.status(405).json({ error: "Method Not Allowed", message: "Use POST /api/alerts/send-pending" });
});

app.post("/api/alerts/send-pending", async (req, res) => {
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
    recordOperatorAction(req, "send_pending_alerts", {
      status: "dry_run",
      details: {
        dryRun: true,
        limit,
        candidateCount: candidates.length
      }
    });

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
        url: item.alert.url,
        display: buildDisplayInterpretation(item.alert).display
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
  recordOperatorAction(req, "send_pending_alerts", {
    status: "completed",
    details: {
      dryRun: false,
      limit,
      candidateCount: candidates.length,
      attempted: candidates.length,
      sentCount: results.filter(result => result.sent).length,
      failedCount: results.filter(result => !result.sent).length
    }
  });
  res.json({ attempted: candidates.length, results });
});

app.get("/api/notifications/status", (req, res) => {
  res.json(notificationEngine.getStatus());
});

app.get("/api/operator-audit", (req, res) => {
  const limit = Math.min(Number(req.query.limit || 100), 1000);
  res.json({
    summary: operatorAuditLog.summarizeOperatorAuditLog(),
    auditLog: operatorAuditLog.getOperatorAuditLog(limit)
  });
});

app.post("/api/notifications/test", async (req, res) => {
  try {
    const result = await notificationEngine.sendTestAlert({ smsOnly: true });
    recordOperatorAction(req, "notification_test", {
      status: result?.sent ? "sent" : "not_sent",
      details: {
        sent: Boolean(result?.sent),
        provider: result?.provider || null,
        id: result?.id || null,
        reason: result?.reason || null
      }
    });
    res.json(result);
  } catch (error) {
    recordOperatorAction(req, "notification_test", {
      status: "failed",
      details: {
        error: error.message
      }
    });
    res.status(500).json({ sent: false, error: error.message });
  }
});

app.get("/api/notifications/test", (req, res) => {
  res.setHeader("Allow", "POST");
  res.status(405).json({ error: "Method Not Allowed", message: "Use POST /api/notifications/test" });
});


function healthClass(status) {
  if (status === "ok" || status === "ready" || status === "healthy" || status === "completed") return "health-ok";
  if (status === "running" || status === "scanning") return "health-running";
  if (status === "warning" || status === "rate_limited" || status === "skipped") return "health-warning";
  if (status === "failed" || status === "degraded") return "health-failed";
  return "small";
}

function metricValue(value, suffix = "") {
  if (value === null || value === undefined || value === "") return "n/a";
  return `${value}${suffix}`;
}

app.get("/health", (req, res) => {
  const health = systemHealth.summarizeRuntime(store, {
    scoutEnabled: SCOUT_ENABLED,
    rateLimitProtection: {
      ebaySearchDelayMs: activeMarketplace.config.searchDelayMs,
      ebayLaneDelayMs: activeMarketplace.config.laneDelayMs,
      ebayMaxRetries: activeMarketplace.config.maxRetries,
      ebayBackoffBaseMs: activeMarketplace.config.backoffBaseMs,
      ebayScanQueryLimit: activeMarketplace.config.scanQueryLimit
    }
  });

  const engines = Object.values(health.engines || {});
  const lastScan = health.lastScan || {};
  const readiness = CONFIG_READINESS;

  res.send(layout("CardHawk Health", `
    <h2>System Health</h2>
    <div class="stats">
      <div class="stat"><div class="number ${healthClass(health.status)}">${escapeHtml(health.status)}</div><div>Overall Status</div></div>
      <div class="stat"><div class="number">${health.data.totalListings}</div><div>Total Listings</div></div>
      <div class="stat"><div class="number">${health.data.totalAlerts}</div><div>Total Alerts</div></div>
      <div class="stat"><div class="number">${health.data.recentFailures}</div><div>Recent Failed/Rate-Limited Scans</div></div>
    </div>

    <h2 class="table-title">Config Readiness</h2>
    <div class="stats">
      <div class="stat"><div class="number">${escapeHtml(readiness.mode.toUpperCase())}</div><div>Operating Mode</div></div>
      <div class="stat"><div class="number ${healthClass(readiness.status)}">${escapeHtml(readiness.status)}</div><div>Readiness Status</div></div>
      <div class="stat"><div class="number">${readiness.criticalIssues.length}</div><div>Critical Issues</div></div>
      <div class="stat"><div class="number">${readiness.warnings.length}</div><div>Warnings</div></div>
    </div>
    <table>
      <tr><th>Check</th><th>Status</th></tr>
      ${Object.entries(readiness.checks || {}).map(([name, status]) => `
        <tr>
          <td>${escapeHtml(name)}</td>
          <td class="${healthClass(status === "ok" ? "ok" : status === "disabled" ? "warning" : "failed")}">${escapeHtml(status)}</td>
        </tr>
      `).join("")}
    </table>
    ${(readiness.criticalIssues.length || readiness.warnings.length) ? `
      <h2 class="table-title">Config Notes</h2>
      <table>
        <tr><th>Severity</th><th>Area</th><th>Variable</th><th>Message</th></tr>
        ${[...readiness.criticalIssues, ...readiness.warnings].map(issue => `
          <tr>
            <td class="${healthClass(issue.severity === "critical" ? "failed" : "warning")}">${escapeHtml(issue.severity)}</td>
            <td>${escapeHtml(issue.area)}</td>
            <td>${escapeHtml(issue.variable)}</td>
            <td>${escapeHtml(issue.message)}</td>
          </tr>
        `).join("")}
      </table>
    ` : ""}

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
      ebaySearchDelayMs: activeMarketplace.config.searchDelayMs,
      ebayLaneDelayMs: activeMarketplace.config.laneDelayMs,
      ebayMaxRetries: activeMarketplace.config.maxRetries,
      ebayBackoffBaseMs: activeMarketplace.config.backoffBaseMs,
      ebayScanQueryLimit: activeMarketplace.config.scanQueryLimit
    }
  }));
});

app.get("/api/metrics", (req, res) => {
  const health = systemHealth.summarizeRuntime(store, {
    scoutEnabled: SCOUT_ENABLED,
    rateLimitProtection: {
      ebaySearchDelayMs: activeMarketplace.config.searchDelayMs,
      ebayLaneDelayMs: activeMarketplace.config.laneDelayMs,
      ebayMaxRetries: activeMarketplace.config.maxRetries,
      ebayBackoffBaseMs: activeMarketplace.config.backoffBaseMs,
      ebayScanQueryLimit: activeMarketplace.config.scanQueryLimit
    }
  });

  res.json(engineMetricsEngine.summarizeEngineMetrics(store, health));
});

app.get("/metrics", (req, res) => {
  const health = systemHealth.summarizeRuntime(store, {
    scoutEnabled: SCOUT_ENABLED,
    rateLimitProtection: {
      ebaySearchDelayMs: activeMarketplace.config.searchDelayMs,
      ebayLaneDelayMs: activeMarketplace.config.laneDelayMs,
      ebayMaxRetries: activeMarketplace.config.maxRetries,
      ebayBackoffBaseMs: activeMarketplace.config.backoffBaseMs,
      ebayScanQueryLimit: activeMarketplace.config.scanQueryLimit
    }
  });
  const metrics = engineMetricsEngine.summarizeEngineMetrics(store, health);
  const engines = metrics.health.engines || [];

  res.send(layout("CardHawk Operational Metrics", `
    <h2>Operational Metrics</h2>
    <p class="small">Read-only operational view derived from existing scan, health, and store data. Raw JSON: <a href="/api/metrics">/api/metrics</a></p>

    <div class="stats">
      <div class="stat"><div class="number">${metrics.scans.totalScans}</div><div>Total Scans</div></div>
      <div class="stat"><div class="number">${metricValue(metrics.scans.successRatePercent, "%")}</div><div>Scan Success Rate</div></div>
      <div class="stat"><div class="number">${metricValue(metrics.scans.averageDurationSeconds, "s")}</div><div>Average Scan Duration</div></div>
      <div class="stat"><div class="number">${metricValue(metrics.scans.averageListingsFoundPerScan)}</div><div>Listings Per Scan</div></div>
      <div class="stat"><div class="number">${metrics.alerts.totalAlerts}</div><div>Total Alerts</div></div>
      <div class="stat"><div class="number">${metricValue(metrics.alerts.alertRatePercent, "%")}</div><div>Alert Rate</div></div>
    </div>

    <h2 class="table-title">Scan Metrics</h2>
    <table>
      <tr><th>Completed</th><th>Failed</th><th>Rate Limited</th><th>Skipped</th><th>Total Listings Found</th><th>Total New Alerts</th></tr>
      <tr>
        <td>${metrics.scans.completedScans}</td>
        <td>${metrics.scans.failedScans}</td>
        <td>${metrics.scans.rateLimitedScans}</td>
        <td>${metrics.scans.skippedScans}</td>
        <td>${metrics.scans.totalListingsFound}</td>
        <td>${metrics.scans.totalNewAlertsFromScans}</td>
      </tr>
    </table>

    <h2 class="table-title">Alert And Data Metrics</h2>
    <table>
      <tr><th>Alerts</th><th>Rejections</th><th>Alert Rate</th><th>Rejection Rate</th><th>Listings</th><th>Recent Failures</th></tr>
      <tr>
        <td>${metrics.alerts.totalAlerts}</td>
        <td>${metrics.alerts.totalRejections}</td>
        <td>${metricValue(metrics.alerts.alertRatePercent, "%")}</td>
        <td>${metricValue(metrics.alerts.rejectionRatePercent, "%")}</td>
        <td>${metrics.data.totalListings}</td>
        <td>${metrics.data.recentFailures}</td>
      </tr>
    </table>

    <h2 class="table-title">Engine Status</h2>
    <table>
      <tr><th>Engine</th><th>Status</th><th>Updated</th></tr>
      ${engines.map(engine => `
        <tr>
          <td>${escapeHtml(engine.name || "")}</td>
          <td class="${healthClass(engine.status)}">${escapeHtml(engine.status || "unknown")}</td>
          <td>${escapeHtml(shortDate(engine.updatedAt))}</td>
        </tr>
      `).join("")}
    </table>
  `));
});

app.get("/api/status", (req, res) => {
  const health = systemHealth.summarizeRuntime(store, {
    scoutEnabled: SCOUT_ENABLED,
    rateLimitProtection: {
      ebaySearchDelayMs: activeMarketplace.config.searchDelayMs,
      ebayLaneDelayMs: activeMarketplace.config.laneDelayMs,
      ebayMaxRetries: activeMarketplace.config.maxRetries,
      ebayBackoffBaseMs: activeMarketplace.config.backoffBaseMs,
      ebayScanQueryLimit: activeMarketplace.config.scanQueryLimit
    }
  });

  res.json({
    scoutEnabled: SCOUT_ENABLED,
    cardhawkMode: CONFIG_READINESS.mode,
    systemHealth: health.status,
    scoutIntervalMinutes: SCOUT_INTERVAL_MINUTES,
    totalListings: Object.keys(store.listings).length,
    totalAlerts: store.alerts.length,
    totalScans: store.scans.length,
    scanInProgress: scoutScanner.isScanInProgress(),
    configReadiness: CONFIG_READINESS,
    rateLimitProtection: {
      ebaySearchDelayMs: activeMarketplace.config.searchDelayMs,
      ebayLaneDelayMs: activeMarketplace.config.laneDelayMs,
      ebayMaxRetries: activeMarketplace.config.maxRetries,
      ebayBackoffBaseMs: activeMarketplace.config.backoffBaseMs,
      ebayScanQueryLimit: activeMarketplace.config.scanQueryLimit
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

function listingCard(rawItem) {
  const item = buildDisplayInterpretation(rawItem);
  const display = item.display || {};
  const rejectedByDealGate = display.authoritativeDecision === 'REJECTED';

  return `
    <div class="card">
      <img src="${escapeHtml(item.image || "")}" />
      <div class="title">${escapeHtml(item.title)}</div>
      <div>${parsedTags(item.parsed, item.lane)}</div>
      ${item.dealGate ? `<div class="deal-grade">Decision: ${escapeHtml(display.primaryDecisionLabel)}${display.rejectionReasons?.length ? ` — ${escapeHtml(display.rejectionReasons.slice(0, 1).join(" | "))}` : ""}</div>` : ""}
      ${item.dealGrade?.grade ? `<div class="deal-grade">Grade: ${escapeHtml(item.dealGrade.grade)}${display.legacyGradeActionLabel ? ` — ${escapeHtml(display.legacyGradeActionLabel)}` : rejectedByDealGate ? " — Legacy grade context" : ""}</div>` : ""}
      ${item.investmentQuality ? `<div class="quality-chip">Quality: ${Math.round(item.investmentQuality)}/100 — ${escapeHtml(display.qualityBucketLabel || item.qualityBucket || "")}</div>` : ""}
      <div class="score">${escapeHtml(display.legacyScoreLabel || "Legacy Context Score")}: ${Math.round(item.score || 0)}/100</div>
      ${item.qualityReasons?.length ? `<div class="meta">Quality Context: ${escapeHtml(item.qualityReasons.slice(0, 2).join(" | "))}</div>` : ""}
      ${item.qualityWarnings?.length ? `<div class="meta">Warnings: ${escapeHtml(item.qualityWarnings.slice(0, 2).join(" | "))}</div>` : ""}
      <div class="price">$${money(item.totalCost || item.price)}</div>
      <div class="meta">Price: $${money(item.price)}</div>
      <div class="meta">Shipping: $${money(item.shipping)}</div>
      <div class="meta">Estimated Value: $${money(item.estimatedValue)}</div>
      <div class="meta">${escapeHtml(display.marketConfidenceLabel || "Market Context Confidence")}: ${Math.round(item.marketConfidence || 0)}% (${item.compCount || 0} comps)</div>
      <div class="meta">${escapeHtml(display.soldEvidenceConfidenceLabel || "Sold Evidence Support")}: ${display.soldEvidenceCount || 0} true sold comps</div>
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

if (require.main === module) {
  loadStore();
  systemHealth.setEngine("scout", SCOUT_ENABLED ? "ok" : "disabled", { scoutIntervalMinutes: SCOUT_INTERVAL_MINUTES });
  systemHealth.setEngine("comps", "ok");
  systemHealth.setEngine("confidence", "ok");
  systemHealth.setEngine("grading", "ok");
  systemHealth.setEngine("quality", "ok");
  systemHealth.setEngine("notifications", notificationEngine.getStatus()?.enabled ? "ok" : "warning", notificationEngine.getStatus());
  systemHealth.setEngine("config", CONFIG_READINESS.status === "ready" ? "ok" : CONFIG_READINESS.status, CONFIG_READINESS);

  app.listen(PORT, () => {
    console.log(`CardHawk running on port ${PORT}`);
    startScoutEngine();
  });
}

module.exports = {
  app,
  dealGate,
  scoreListing,
  createLegacyScoreBreakdown,
  buildDisplayInterpretation,
  buildSignalAnnotationsForDisplay,
  isShadowModeEnabled,
  runShadowModeDecisionIntelligence,
  __setShadowModeDecisionIntelligenceEvaluatorForTest,
  __setShadowModeDecisionLoggerForTest,
  __setCanonicalSoldEvidenceStoreForTest,
  getCanonicalSoldEvidenceForListing
};
