const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "cardhawk-data.json");

const DEFAULT_SCOUT_QUERIES = [
  "PSA 10 baseball rookie auto",
  "Bowman Chrome baseball auto",
  "Topps Chrome baseball rookie auto",
  "SGC 10 baseball rookie card",
  "BGS 9.5 baseball auto",
  "2024 Bowman Chrome auto",
  "2023 Bowman Chrome auto",
  "2024 Topps Chrome rookie auto",
  "2023 Topps Chrome rookie auto"
];

const SCOUT_INTERVAL_MINUTES = Number(process.env.SCOUT_INTERVAL_MINUTES || 10);
const SCOUT_ENABLED = String(process.env.SCOUT_ENABLED || "true").toLowerCase() === "true";

let ebayTokenCache = { token: null, expiresAt: 0 };

let store = {
  listings: {},
  alerts: [],
  scans: [],
  settings: {
    scoutQueries: DEFAULT_SCOUT_QUERIES,
    minDealScore: 70
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
      settings: {
        scoutQueries: loaded.settings?.scoutQueries || DEFAULT_SCOUT_QUERIES,
        minDealScore: loaded.settings?.minDealScore || 70
      }
    };
  } catch (error) {
    console.error("Failed to load data file:", error.message);
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

  if (user === process.env.CARDHAWK_USER && pass === process.env.CARDHAWK_PASS) {
    return next();
  }

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

async function getEbayToken() {
  const now = Date.now();

  if (ebayTokenCache.token && ebayTokenCache.expiresAt > now + 60_000) {
    return ebayTokenCache.token;
  }

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

async function searchEbay(query, limit = 25) {
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

function parseCardTitle(title) {
  const lower = title.toLowerCase();

  const yearMatch = lower.match(/\b(19[5-9][0-9]|20[0-3][0-9])\b/);
  const gradeMatch = lower.match(/\b(psa|sgc|bgs|cgc)\s*(10|9\.5|9|8\.5|8)\b/i);
  const numberedMatch = lower.match(/\/\s*(\d{1,4})\b/);

  const flags = {
    autograph: /\b(auto|autograph|signed)\b/i.test(title),
    rookie: /\b(rookie|rc)\b/i.test(title),
    graded: /\b(psa|sgc|bgs|cgc)\b/i.test(title),
    numbered: Boolean(numberedMatch),
    chrome: /\bchrome\b/i.test(title),
    bowman: /\bbowman\b/i.test(title),
    topps: /\btopps\b/i.test(title),
    prizm: /\bprizm\b/i.test(title),
    refractor: /\brefractor\b/i.test(title),
    firstBowman: /\b1st bowman\b/i.test(title),
    lot: /\b(lot|collection|bulk|mystery|repack|break)\b/i.test(title),
    reprint: /\b(reprint|rp|facsimile)\b/i.test(title),
    digital: /\b(digital|nft)\b/i.test(title),
    custom: /\b(custom|art card)\b/i.test(title),
    sealed: /\b(box|pack|blaster|mega|hobby)\b/i.test(title)
  };

  let setName = "Unknown";

  if (flags.bowman && flags.chrome) setName = "Bowman Chrome";
  else if (flags.topps && flags.chrome) setName = "Topps Chrome";
  else if (flags.bowman) setName = "Bowman";
  else if (flags.topps) setName = "Topps";
  else if (flags.prizm) setName = "Prizm";

  let qualityTier = "unknown";

  if (flags.reprint || flags.digital || flags.custom) qualityTier = "avoid";
  else if (flags.lot || flags.sealed) qualityTier = "low-confidence";
  else if (flags.graded && flags.autograph && flags.rookie) qualityTier = "premium";
  else if (flags.autograph && flags.rookie) qualityTier = "strong";
  else if (flags.graded || flags.autograph || flags.rookie || flags.numbered) qualityTier = "watch";
  else qualityTier = "generic";

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
  let multiplier = 1.15;

  if (parsed.flags.graded) multiplier += 0.2;
  if (parsed.grade === 10) multiplier += 0.25;
  if (parsed.grade === 9.5) multiplier += 0.15;
  if (parsed.flags.autograph) multiplier += 0.25;
  if (parsed.flags.rookie) multiplier += 0.15;
  if (parsed.flags.firstBowman) multiplier += 0.2;
  if (parsed.flags.numbered) multiplier += 0.15;
  if (parsed.flags.refractor) multiplier += 0.1;
  if (parsed.setName === "Bowman Chrome") multiplier += 0.15;
  if (parsed.setName === "Topps Chrome") multiplier += 0.1;

  if (parsed.flags.lot) multiplier -= 0.45;
  if (parsed.flags.sealed) multiplier -= 0.25;
  if (parsed.flags.reprint) multiplier -= 0.9;
  if (parsed.flags.digital) multiplier -= 0.9;
  if (parsed.flags.custom) multiplier -= 0.7;

  return Math.max(0, listing.totalCost * multiplier);
}

function scoreListing(listing) {
  const parsed = listing.parsed || parseCardTitle(listing.title);
  const estimatedValue = estimateMarketValue(listing);
  const ebayFees = estimatedValue * 0.1325;
  const estimatedProfit = estimatedValue - listing.totalCost - ebayFees;
  const roi = listing.totalCost > 0 ? estimatedProfit / listing.totalCost : 0;

  let score = 0;

  if (parsed.qualityTier === "premium") score += 45;
  if (parsed.qualityTier === "strong") score += 35;
  if (parsed.qualityTier === "watch") score += 20;
  if (parsed.qualityTier === "generic") score += 5;
  if (parsed.qualityTier === "low-confidence") score -= 20;
  if (parsed.qualityTier === "avoid") score = 0;

  if (estimatedProfit > 10) score += 10;
  if (estimatedProfit > 25) score += 15;
  if (estimatedProfit > 50) score += 15;
  if (roi > 0.2) score += 10;
  if (roi > 0.35) score += 10;
  if (roi > 0.5) score += 10;

  if (parsed.flags.firstBowman) score += 8;
  if (parsed.flags.numbered) score += 6;
  if (parsed.grade === 10) score += 8;
  if (parsed.setName === "Bowman Chrome") score += 6;
  if (parsed.setName === "Topps Chrome") score += 4;

  if (parsed.flags.lot) score -= 35;
  if (parsed.flags.sealed) score -= 20;
  if (parsed.flags.reprint) score -= 80;
  if (parsed.flags.digital) score -= 80;
  if (parsed.flags.custom) score -= 60;

  if (listing.sellerFeedbackPercentage >= 99) score += 4;
  if (listing.sellerFeedbackScore >= 100) score += 4;

  if (listing.totalCost <= 0) score = 0;
  if (listing.totalCost > 500 && estimatedProfit < 100) score -= 15;

  score = Math.max(0, Math.min(100, Math.round(score)));

  return {
    score,
    estimatedValue,
    estimatedProfit,
    roi,
    ebayFees
  };
}

function saveScoutedListing(listing, query) {
  const scoring = scoreListing(listing);
  const now = new Date().toISOString();
  const existing = store.listings[listing.ebayItemId];

  const saved = {
    ...listing,
    query,
    score: scoring.score,
    estimatedValue: scoring.estimatedValue,
    estimatedProfit: scoring.estimatedProfit,
    roi: scoring.roi,
    ebayFees: scoring.ebayFees,
    firstSeenAt: existing?.firstSeenAt || now,
    lastSeenAt: now,
    seenCount: existing?.seenCount ? existing.seenCount + 1 : 1,
    alertCreated: existing?.alertCreated || false
  };

  store.listings[listing.ebayItemId] = saved;

  if (!saved.alertCreated && saved.score >= store.settings.minDealScore) {
    const alert = {
      id: `${listing.ebayItemId}-${Date.now()}`,
      ebayItemId: listing.ebayItemId,
      title: listing.title,
      price: listing.price,
      shipping: listing.shipping,
      totalCost: listing.totalCost,
      estimatedValue: saved.estimatedValue,
      estimatedProfit: saved.estimatedProfit,
      roi: saved.roi,
      score: saved.score,
      url: listing.url,
      image: listing.image,
      query,
      parsed: saved.parsed,
      createdAt: now,
      status: "new"
    };

    store.alerts.unshift(alert);
    store.listings[listing.ebayItemId].alertCreated = true;
  }

  return saved;
}

async function runScoutScan(source = "automatic") {
  const scan = {
    id: Date.now().toString(),
    source,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    queries: [],
    listingsFound: 0,
    newAlerts: 0,
    status: "running",
    error: null
  };

  const alertsBefore = store.alerts.length;

  try {
    for (const query of store.settings.scoutQueries) {
      const results = await searchEbay(query, 25);

      scan.queries.push({ query, count: results.length });
      scan.listingsFound += results.length;

      for (const listing of results) {
        saveScoutedListing(listing, query);
      }
    }

    scan.newAlerts = store.alerts.length - alertsBefore;
    scan.status = "completed";
  } catch (error) {
    scan.status = "failed";
    scan.error = error.message;
    console.error("Scout scan failed:", error.message);
  }

  scan.finishedAt = new Date().toISOString();
  store.scans.unshift(scan);
  store.scans = store.scans.slice(0, 100);
  store.alerts = store.alerts.slice(0, 200);

  saveStore();
  return scan;
}

function startScoutEngine() {
  if (!SCOUT_ENABLED) {
    console.log("Scout Engine disabled.");
    return;
  }

  console.log(`Scout Engine enabled. Running every ${SCOUT_INTERVAL_MINUTES} minutes.`);

  setTimeout(() => runScoutScan("startup"), 3000);
  setInterval(() => runScoutScan("automatic"), SCOUT_INTERVAL_MINUTES * 60 * 1000);
}

function layout(title, content) {
  return `
    <html>
      <head>
        <title>${escapeHtml(title)}</title>
        <style>
          body { margin: 0; font-family: Arial, sans-serif; background: #0f172a; color: white; }
          .container { max-width: 1250px; margin: auto; padding: 34px 20px; }
          h1 { font-size: 42px; margin-bottom: 8px; }
          .subtitle { color: #94a3b8; margin-bottom: 24px; }
          nav { display: flex; gap: 12px; margin-bottom: 24px; flex-wrap: wrap; }
          nav a, button { padding: 12px 16px; border: none; border-radius: 10px; background: #38bdf8; color: #0f172a; font-weight: bold; cursor: pointer; text-decoration: none; }
          form { display: flex; gap: 10px; margin-bottom: 26px; }
          input { flex: 1; padding: 14px; border-radius: 10px; border: none; font-size: 16px; }
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
          .tag { display: inline-block; padding: 5px 8px; border-radius: 999px; background: #334155; color: #e2e8f0; font-size: 12px; margin: 3px 3px 3px 0; }
          .avoid { background: #7f1d1d; }
          .premium { background: #14532d; }
          a { color: #38bdf8; font-weight: bold; }
          table { width: 100%; border-collapse: collapse; background: #1e293b; border-radius: 14px; overflow: hidden; }
          th, td { padding: 12px; border-bottom: 1px solid #334155; text-align: left; font-size: 14px; }
          th { color: #94a3b8; }
          pre { white-space: pre-wrap; background: #1e293b; padding: 18px; border-radius: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>🦅 CardHawk</h1>
          <div class="subtitle">Private eBay scouting engine. Built to find undervalued cards automatically.</div>
          <nav>
            <a href="/">Dashboard</a>
            <a href="/alerts">Deal Alerts</a>
            <a href="/scans">Scan History</a>
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

app.get("/", (req, res) => {
  const listings = Object.values(store.listings);
  const alerts = store.alerts;
  const scans = store.scans;

  const latestListings = listings
    .sort((a, b) => new Date(b.lastSeenAt) - new Date(a.lastSeenAt))
    .slice(0, 12);

  res.send(layout("CardHawk Dashboard", `
    <div class="stats">
      <div class="stat"><div class="number">${listings.length}</div><div>Total Listings Scouted</div></div>
      <div class="stat"><div class="number">${alerts.filter(a => a.status === "new").length}</div><div>New Deal Alerts</div></div>
      <div class="stat"><div class="number">${scans.length}</div><div>Total Scout Scans</div></div>
      <div class="stat"><div class="number">${SCOUT_ENABLED ? "ON" : "OFF"}</div><div>Scout Engine</div></div>
    </div>

    <h2>Latest Scouted Listings</h2>
    <div class="grid">${latestListings.map(item => listingCard(item)).join("")}</div>
  `));
});

app.get("/alerts", (req, res) => {
  res.send(layout("CardHawk Alerts", `
    <h2>Deal Alerts</h2>
    <div class="grid">${store.alerts.map(alert => listingCard(alert)).join("")}</div>
  `));
});

app.get("/scans", (req, res) => {
  res.send(layout("CardHawk Scan History", `
    <h2>Scan History</h2>
    <table>
      <tr>
        <th>Started</th>
        <th>Source</th>
        <th>Status</th>
        <th>Listings Found</th>
        <th>New Alerts</th>
        <th>Error</th>
      </tr>
      ${store.scans.map(scan => `
        <tr>
          <td>${escapeHtml(scan.startedAt)}</td>
          <td>${escapeHtml(scan.source)}</td>
          <td>${escapeHtml(scan.status)}</td>
          <td>${scan.listingsFound}</td>
          <td>${scan.newAlerts}</td>
          <td>${escapeHtml(scan.error || "")}</td>
        </tr>
      `).join("")}
    </table>
  `));
});

app.get("/search", async (req, res) => {
  try {
    const query = req.query.q || "";
    const results = query ? await searchEbay(query, 12) : [];

    res.send(layout("CardHawk Manual Search", `
      <form>
        <input name="q" value="${escapeHtml(query)}" placeholder="Search for a card..." />
        <button>Search</button>
      </form>

      <h2>Manual Results${query ? ` for: ${escapeHtml(query)}` : ""}</h2>
      <div class="grid">
        ${results.map(item => listingCard({ ...item, ...scoreListing(item) })).join("")}
      </div>
    `));
  } catch (error) {
    res.status(500).send(layout("Error", `<pre>${escapeHtml(error.message)}</pre>`));
  }
});

app.post("/scan-now", async (req, res) => {
  await runScoutScan("manual");
  res.redirect("/");
});

app.get("/api/status", (req, res) => {
  res.json({
    scoutEnabled: SCOUT_ENABLED,
    scoutIntervalMinutes: SCOUT_INTERVAL_MINUTES,
    totalListings: Object.keys(store.listings).length,
    totalAlerts: store.alerts.length,
    totalScans: store.scans.length,
    scoutQueries: store.settings.scoutQueries
  });
});

function parsedTags(parsed) {
  if (!parsed) return "";

  const tags = [];

  tags.push(parsed.qualityTier);
  if (parsed.year) tags.push(String(parsed.year));
  if (parsed.setName && parsed.setName !== "Unknown") tags.push(parsed.setName);
  if (parsed.gradeCompany) tags.push(`${parsed.gradeCompany} ${parsed.grade}`);
  if (parsed.flags.autograph) tags.push("Auto");
  if (parsed.flags.rookie) tags.push("Rookie");
  if (parsed.flags.numbered) tags.push(`/${parsed.numberedTo}`);
  if (parsed.flags.lot) tags.push("Lot");
  if (parsed.flags.reprint) tags.push("Reprint");
  if (parsed.flags.digital) tags.push("Digital");
  if (parsed.flags.custom) tags.push("Custom");

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
      <div>${parsedTags(item.parsed)}</div>
      <div class="score">Score: ${Math.round(item.score || 0)}/100</div>
      <div class="price">$${money(item.totalCost || item.price)}</div>
      <div class="meta">Price: $${money(item.price)}</div>
      <div class="meta">Shipping: $${money(item.shipping)}</div>
      <div class="meta">Estimated Value: $${money(item.estimatedValue)}</div>
      <div class="meta">Estimated Profit: $${money(item.estimatedProfit)}</div>
      <div class="meta">ROI: ${Math.round((item.roi || 0) * 100)}%</div>
      <div class="meta">Condition: ${escapeHtml(item.condition || "Unknown")}</div>
      <div class="meta">Seller: ${escapeHtml(item.sellerUsername || "Unknown")}</div>
      <a href="${escapeHtml(item.url)}" target="_blank">View on eBay</a>
    </div>
  `;
}

loadStore();

app.listen(PORT, () => {
  console.log(`CardHawk running on port ${PORT}`);
  startScoutEngine();
});
