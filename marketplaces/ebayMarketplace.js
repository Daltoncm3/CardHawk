'use strict';

const serializationInstrumentation = require("../utils/serializationInstrumentation");

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
  if (!response.ok) throw new Error(serializationInstrumentation.instrumentJsonStringify(data, undefined, undefined, {
    sourceFile: "marketplaces/ebayMarketplace.js",
    functionName: "getToken",
    serializationType: "json_error_payload",
    group: "EbayMarketplace"
  }));

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
    itemCreationDate: item.itemCreationDate || item.itemStartDate || item.listingStartDate || null,
    itemLastModifiedDate: item.itemLastModifiedDate || item.lastModifiedDate || null,
    itemEndDate: item.itemEndDate || null,
    marketplaceTimestamps: {
      itemCreationDate: item.itemCreationDate || null,
      itemStartDate: item.itemStartDate || item.listingStartDate || null,
      itemLastModifiedDate: item.itemLastModifiedDate || item.lastModifiedDate || null,
      itemEndDate: item.itemEndDate || null
    },
    parsed,
    raw: item
  };
}

function buildBuyingOptionsFilter(listingTypes = ["FIXED_PRICE", "AUCTION"]) {
  const safeTypes = (Array.isArray(listingTypes) ? listingTypes : [])
    .map((type) => String(type || "").trim().toUpperCase())
    .filter((type) => type === "FIXED_PRICE" || type === "AUCTION");
  return `buyingOptions:{${(safeTypes.length ? safeTypes : ["FIXED_PRICE", "AUCTION"]).join("|")}}`;
}

function buildPriceFilter(options = {}) {
  const filters = [buildBuyingOptionsFilter(options.listingTypes)];
  const hasMin = Number.isFinite(Number(options.priceMin));
  const hasMax = Number.isFinite(Number(options.priceMax));

  if (hasMin || hasMax) {
    const min = hasMin ? Number(options.priceMin) : "";
    const max = hasMax ? Number(options.priceMax) : "";
    filters.push(`price:[${min}..${max}]`);
    filters.push("priceCurrency:USD");
  }

  return filters.join(",");
}

async function searchPage(query, limit = 20, options = {}) {
  const token = await getToken();
  const url = new URL("https://api.ebay.com/buy/browse/v1/item_summary/search");
  const offset = Number(options.offset || 0);

  url.searchParams.set("q", query);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(Number.isFinite(offset) && offset >= 0 ? offset : 0));
  url.searchParams.set("filter", buildPriceFilter(options));
  if (options.sort) url.searchParams.set("sort", String(options.sort));

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": "EBAY_US"
    }
  });

  const data = await response.json();
  if (!response.ok) throw new Error(serializationInstrumentation.instrumentJsonStringify(data, undefined, undefined, {
    sourceFile: "marketplaces/ebayMarketplace.js",
    functionName: "search",
    serializationType: "json_error_payload",
    group: "EbayMarketplace"
  }));

  const items = (data.itemSummaries || []).map(item => normalizeItem(item, options));

  return {
    query,
    limit: Number(limit),
    offset: Number.isFinite(offset) && offset >= 0 ? offset : 0,
    sort: options.sort || null,
    total: Number.isFinite(Number(data.total)) ? Number(data.total) : null,
    href: data.href || url.toString(),
    next: data.next || null,
    itemCount: items.length,
    items
  };
}

async function search(query, limit = 20, options = {}) {
  const page = await searchPage(query, limit, options);
  return page.items;
}

async function searchWithBackoff(query, limit = config.scanQueryLimit, options = {}) {
  const page = await searchPageWithBackoff(query, limit, options);
  return page.items;
}

async function searchPageWithBackoff(query, limit = config.scanQueryLimit, options = {}) {
  let lastError = null;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        const waitMs = config.backoffBaseMs * attempt;
        console.log(`eBay retry ${attempt}/${config.maxRetries} for "${query}" after ${waitMs}ms`);
        await sleep(waitMs);
      }

      return await searchPage(query, limit, options);
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
  searchPage,
  searchWithBackoff,
  searchPageWithBackoff,
  normalizeItem,
  isRateLimitError,
  compactError
};
