'use strict';

const config = {
  searchDelayMs: Number(process.env.EBAY_SEARCH_DELAY_MS || 2500),
  laneDelayMs: Number(process.env.EBAY_LANE_DELAY_MS || 6000),
  maxRetries: Number(process.env.EBAY_MAX_RETRIES || 2),
  backoffBaseMs: Number(process.env.EBAY_BACKOFF_BASE_MS || 15000),
  scanQueryLimit: Number(process.env.EBAY_SCAN_QUERY_LIMIT || 8)
};

let ebayTokenCache = { token: null, expiresAt: 0 };

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

function isRateLimitError(error) {
  const message = String(error?.message || error || "");
  if (/too many requests|request limit|rate limit|429/i.test(message)) return true;

  const payload = parseErrorPayload(message);
  const errors = payload?.errors || [];
  return errors.some(item =>
    Number(item.errorId) === 2001 ||
    /too many requests|request limit|rate limit/i.test(`${item.message || ""} ${item.longMessage || ""}`)
  );
}

function compactError(error) {
  const payload = parseErrorPayload(error?.message);
  const first = payload?.errors?.[0];
  if (first) {
    return `${first.message || "eBay error"}${first.longMessage ? ` — ${first.longMessage}` : ""}`;
  }
  return error?.message || String(error);
}

async function getToken() {
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

function normalizeItem(item, options = {}) {
  const parseCardTitle = options.parseCardTitle || (() => ({}));
  const price = Number(item.price?.value || 0);
  const shipping = Number(item.shippingOptions?.[0]?.shippingCost?.value || 0);
  const totalCost = price + shipping;
  const parsed = parseCardTitle(item.title || "");

  return {
    listingId: item.itemId,
    marketplace: "ebay",
    marketplaceListingId: item.itemId,
    marketplaceLabel: "eBay",
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

async function search(query, limit = 20, options = {}) {
  const token = await getToken();
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

  return (data.itemSummaries || []).map(item => normalizeItem(item, options));
}

async function searchWithBackoff(query, limit = config.scanQueryLimit, options = {}) {
  let lastError = null;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        const waitMs = config.backoffBaseMs * attempt;
        console.log(`eBay retry ${attempt}/${config.maxRetries} for "${query}" after ${waitMs}ms`);
        await sleep(waitMs);
      }

      return await search(query, limit, options);
    } catch (error) {
      lastError = error;
      if (!isRateLimitError(error) || attempt === config.maxRetries) break;
    }
  }

  throw lastError;
}

module.exports = {
  marketplace: "ebay",
  marketplaceLabel: "eBay",
  config,
  getToken,
  search,
  searchWithBackoff,
  normalizeItem,
  isRateLimitError,
  compactError
};
