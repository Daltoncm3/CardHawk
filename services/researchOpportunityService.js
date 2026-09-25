'use strict';

const legacyIdentityAdapter = require('../engines/legacyIdentityAdapter');

const VERSION = '1.0.0';
const SOURCE = 'cardhawk_research_opportunity_service';
const MAX_OPPORTUNITIES = 25;
const MAX_INPUT_LISTINGS = 250;
const MAX_PUBLIC_TITLE_LENGTH = 180;
const MAX_PUBLIC_URL_LENGTH = 600;
const ACTIVE_PEER_DISCOUNT_THRESHOLD = 0.82;
const MIN_ACTIVE_PEERS = 2;
const ENDING_SOON_HOURS = 24;
const RECENT_LISTING_HOURS = 72;

const REASON_MESSAGES = Object.freeze({
  fixed_price_below_active_fixed_price_peers: 'Fixed-price asking price is below closely matched active fixed-price listings. Sold-comp verification required.',
  recent_price_reduction: 'Listing has a recent tracked price reduction.',
  ending_soon_auction_research: 'Auction is ending soon and may deserve timely owner research.',
  auction_bid_activity_context: 'Auction has visible current bidding activity. Current bids are non-final.',
  newly_listed_candidate: 'Listing is newly observed and may be worth owner research when paired with another material signal.',
  weak_title_visibility: 'Title appears incomplete or weak, which may reduce seller visibility.',
  missing_identity_details: 'Material identity details are missing, so exact sold-comp research is required before action.',
  ambiguous_identity_review_required: 'Identity is incomplete or ambiguous; this is a research candidate only.',
  relist_or_disappearance_history: 'Stored history shows relist or disappearance context for similar listings.'
});

const AUTHORITY_BOUNDARIES = Object.freeze({
  canonicalSoldEvidenceAuthority: 'none',
  valuationAuthority: 'none',
  dealGateAuthority: 'none',
  alertAuthority: 'none',
  buyNowAuthority: 'none',
  marketplaceExecutionAuthority: 'none',
  productionImpact: 'none',
  nonPersistent: true
});

const MATERIAL_RESEARCH_REASONS = Object.freeze(new Set([
  'fixed_price_below_active_fixed_price_peers',
  'recent_price_reduction',
  'ending_soon_auction_research',
  'relist_or_disappearance_history',
  'weak_title_visibility'
]));

function normalizeText(value) {
  const normalized = String(value ?? '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[#/,()[\]{}:;|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized === 'unknown' ? '' : normalized;
}

function publicText(value, maxLength = MAX_PUBLIC_TITLE_LENGTH) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}...`;
}

function publicUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw || /["'<>\s]/.test(raw)) return '';
  try {
    const parsed = new URL(raw);
    const hostname = parsed.hostname.toLowerCase();
    if (parsed.protocol !== 'https:' || (hostname !== 'www.ebay.com' && hostname !== 'ebay.com')) return '';
    const safe = parsed.toString();
    return safe.length <= MAX_PUBLIC_URL_LENGTH ? safe : '';
  } catch (_) {
    return '';
  }
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function roundMoney(value) {
  return Math.round(toNumber(value) * 100) / 100;
}

function getTotalCost(listing = {}) {
  if (Number.isFinite(Number(listing.totalCost)) && Number(listing.totalCost) > 0) {
    return roundMoney(listing.totalCost);
  }
  const total = toNumber(listing.price) + toNumber(listing.shipping);
  return Number.isFinite(total) && total > 0 ? roundMoney(total) : 0;
}

function getParsed(listing = {}) {
  return listing.parsed && typeof listing.parsed === 'object' ? listing.parsed : {};
}

function extractIdentity(listing = {}) {
  const diagnostics = legacyIdentityAdapter.buildLegacyIdentityDiagnostics(listing);
  const canonical = diagnostics.canonicalIdentity || {};
  const normalized = canonical.normalized || {};
  const subject = normalized.subject && typeof normalized.subject === 'object' ? normalized.subject.name : normalized.subjectName;
  const grading = normalized.grading || {};
  const autograph = normalized.autograph || {};
  const memorabilia = normalized.memorabilia || {};
  const parsed = getParsed(listing);
  const qualityTier = String(parsed.qualityTier || '').toLowerCase();

  return {
    source: 'legacyIdentityAdapter.buildLegacyIdentityDiagnostics',
    canonicalIdentityKey: canonical.canonicalIdentityKey || '',
    exactCompEligible: diagnostics.exactCompEligible === true,
    manualReviewRequired: diagnostics.manualReviewRequired !== false,
    overallIdentityConfidence: Number(diagnostics.overallIdentityConfidence || 0),
    sport: normalizeText(normalized.sport || canonical.category || listing.lane),
    subjectName: normalizeText(subject),
    year: normalizeText(normalized.year),
    manufacturer: normalizeText(normalized.manufacturer || normalized.brand),
    product: normalizeText(normalized.product || normalized.setName),
    setName: normalizeText(normalized.setName || normalized.product),
    cardNumber: normalizeText(normalized.cardNumber).replace(/^#/, ''),
    parallel: normalizeText(normalized.parallel),
    serialNumbered: normalized.serialNumbered === true ? 'serial_numbered' : normalized.serialNumbered === false ? 'not_serial_numbered' : '',
    printRun: normalized.printRun === undefined || normalized.printRun === null || normalized.printRun === 'unknown' ? '' : String(normalized.printRun).trim(),
    autographState: autograph.state === true ? 'autograph' : autograph.state === false ? 'not_autograph' : '',
    memorabiliaState: memorabilia.state === true ? 'memorabilia' : memorabilia.state === false ? 'not_memorabilia' : '',
    rookieDesignation: normalized.rookieDesignation === true ? 'rookie' : normalized.rookieDesignation === false ? 'not_rookie' : '',
    rawOrGraded: normalizeText(normalized.rawOrGraded),
    gradeCompany: normalizeText(grading.company),
    grade: normalizeText(grading.grade),
    blockedTraits: {
      reprint: qualityTier === 'avoid',
      lot: qualityTier === 'low-confidence',
      sealed: qualityTier === 'avoid'
    },
    sourceQualityTier: parsed.qualityTier || '',
    unknownFields: Array.isArray(diagnostics.unknownFields) ? diagnostics.unknownFields.slice().sort() : [],
    normalizationWarnings: Array.isArray(diagnostics.normalizationWarnings) ? diagnostics.normalizationWarnings.slice().sort() : []
  };
}

function buildStrictIdentityKey(identity = {}) {
  return [
    identity.sport,
    identity.subjectName,
    identity.year,
    identity.manufacturer,
    identity.product || identity.setName,
    identity.cardNumber,
    identity.parallel,
    identity.serialNumbered,
    identity.printRun,
    identity.autographState,
    identity.memorabiliaState,
    identity.rookieDesignation,
    identity.rawOrGraded,
    identity.gradeCompany,
    identity.grade
  ].join('|');
}

function getMissingMaterialFields(identity = {}) {
  const missing = [];
  if (!identity.subjectName) missing.push('subjectName');
  if (!identity.year) missing.push('year');
  if (!identity.product && !identity.setName) missing.push('product_or_setName');
  if (!identity.cardNumber) missing.push('cardNumber');
  if (!identity.autographState) missing.push('autographState');
  if (!identity.memorabiliaState) missing.push('memorabiliaState');
  if (!identity.serialNumbered) missing.push('serialNumbered');
  if (!identity.rawOrGraded) missing.push('rawOrGraded');
  if (identity.rawOrGraded === 'graded' && (!identity.gradeCompany || !identity.grade)) missing.push('gradeCompany_or_grade');
  return missing;
}

function getSearchConfidence(identity = {}) {
  const missing = getMissingMaterialFields(identity);
  if (missing.includes('subjectName') || missing.includes('year') || missing.includes('product_or_setName') || missing.includes('cardNumber')) {
    return 'insufficient_identity';
  }
  if (missing.length || identity.manualReviewRequired) return 'narrow_research';
  return 'exact_research_candidate';
}

function buildSoldItemsResearchUrl(input = {}) {
  const identity = input.subjectName || input.year || input.product ? input : extractIdentity(input);
  const tokens = [];

  [
    identity.year,
    identity.manufacturer,
    identity.product || identity.setName,
    identity.subjectName,
    identity.cardNumber ? `#${identity.cardNumber}` : '',
    identity.parallel,
    identity.printRun ? `/${identity.printRun}` : '',
    identity.autographState === 'autograph' ? 'autograph' : '',
    identity.memorabiliaState === 'memorabilia' ? 'relic' : '',
    identity.rookieDesignation === 'rookie' ? 'rookie' : '',
    identity.rawOrGraded === 'raw' ? 'raw' : '',
    identity.gradeCompany,
    identity.grade
  ].forEach((value) => {
    const text = String(value || '').trim();
    if (text) tokens.push(text);
  });

  const uniqueTokens = [];
  const seen = new Set();
  for (const token of tokens) {
    const key = normalizeText(token);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    uniqueTokens.push(token);
  }

  const encodedQuery = encodeURIComponent(uniqueTokens.join(' ')).replace(/%20/g, '+');
  return `https://www.ebay.com/sch/i.html?_nkw=${encodedQuery}&LH_Sold=1&LH_Complete=1`;
}

function isAuction(listing = {}) {
  const options = Array.isArray(listing.buyingOptions) ? listing.buyingOptions : [];
  return options.some((option) => String(option).toUpperCase() === 'AUCTION') || String(listing.listingType || '').toUpperCase() === 'AUCTION';
}

function isFixedPrice(listing = {}) {
  const options = Array.isArray(listing.buyingOptions) ? listing.buyingOptions : [];
  if (options.some((option) => String(option).toUpperCase() === 'AUCTION')) return false;
  return options.some((option) => String(option).toUpperCase() === 'FIXED_PRICE') || !isAuction(listing);
}

function parseTimestamp(value) {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) && time > 0 ? time : null;
}

function getEndTime(listing = {}) {
  return parseTimestamp(listing.itemEndDate || listing.marketplaceTimestamps?.itemEndDate);
}

function isExpiredListing(listing = {}, nowMs) {
  const endTime = getEndTime(listing);
  return endTime !== null && endTime < nowMs;
}

function hoursUntil(value, nowMs) {
  const time = parseTimestamp(value);
  if (time === null) return null;
  return (time - nowMs) / 3_600_000;
}

function hoursSince(value, nowMs) {
  const time = parseTimestamp(value);
  if (time === null || nowMs < time) return null;
  return (nowMs - time) / 3_600_000;
}

function buildActivePeerContext(target, listings = [], identityFor = extractIdentity) {
  const identity = identityFor(target);
  const key = buildStrictIdentityKey(identity);
  if (!isFixedPrice(target) || getMissingMaterialFields(identity).length || !key.replace(/\|/g, '')) {
    return { peerCount: 0, peerMedian: 0, peerPrices: [] };
  }

  const targetId = String(target.ebayItemId || target.listingId || target.marketplaceListingId || '');
  const targetCurrency = String(target.currency || 'USD').toUpperCase();
  const peerMap = new Map();

  for (const listing of listings) {
    const peerId = String(listing.ebayItemId || listing.listingId || listing.marketplaceListingId || '');
    if (!peerId || peerId === targetId || peerMap.has(peerId)) continue;
    if (!isFixedPrice(listing)) continue;
    if (String(listing.currency || 'USD').toUpperCase() !== targetCurrency) continue;
    if (getTotalCost(listing) <= 0) continue;
    if (buildStrictIdentityKey(identityFor(listing)) !== key) continue;
    peerMap.set(peerId, listing);
  }

  const peerPrices = Array.from(peerMap.values())
    .map(getTotalCost)
    .sort((a, b) => a - b);

  if (!peerPrices.length) return { peerCount: 0, peerMedian: 0, peerPrices: [] };
  const middle = Math.floor(peerPrices.length / 2);
  const peerMedian = peerPrices.length % 2 ? peerPrices[middle] : (peerPrices[middle - 1] + peerPrices[middle]) / 2;
  return { peerCount: peerPrices.length, peerMedian: roundMoney(peerMedian), peerPrices };
}

function hasRecentPriceDrop(listing = {}, priceDropsById = new Map()) {
  const id = String(listing.ebayItemId || listing.listingId || listing.marketplaceListingId || '');
  if (priceDropsById.has(id)) return priceDropsById.get(id);
  const drops = Array.isArray(listing.priceDrops) ? listing.priceDrops : [];
  return drops[0] || null;
}

function buildPriceDropMap(priceDrops = []) {
  const map = new Map();
  for (const drop of Array.isArray(priceDrops) ? priceDrops : []) {
    const id = String(drop.ebayItemId || drop.listingId || drop.marketplaceListingId || '');
    if (!id || map.has(id)) continue;
    map.set(id, drop);
  }
  return map;
}

function addReason(state, code, points) {
  if (!REASON_MESSAGES[code] || state.reasonCodes.includes(code)) return;
  state.reasonCodes.push(code);
  state.explanations.push({ code, message: REASON_MESSAGES[code] });
  state.score += points;
}

function clampScore(value) {
  return Math.max(0, Math.min(100, roundMoney(value)));
}

function hasMaterialResearchReason(reasonCodes = []) {
  if (reasonCodes.includes('auction_bid_activity_context') && reasonCodes.includes('ending_soon_auction_research')) return true;
  return reasonCodes.some((code) => MATERIAL_RESEARCH_REASONS.has(code));
}

function buildOpportunity(listing, context = {}) {
  const nowMs = parseTimestamp(context.now) || Date.now();
  const allListings = Array.isArray(context.listings) ? context.listings : [];
  const priceDropsById = context.priceDropsById || buildPriceDropMap(context.priceDrops);
  const totalCost = getTotalCost(listing);

  if (!Number.isFinite(totalCost) || totalCost <= 0) return null;
  if (isExpiredListing(listing, nowMs)) return null;

  const identityFor = context.identityFor || extractIdentity;
  const identity = identityFor(listing);
  const missingMaterialFields = getMissingMaterialFields(identity);
  const state = { score: 0, reasonCodes: [], explanations: [] };
  const peerContext = buildActivePeerContext(listing, allListings, identityFor);

  if (peerContext.peerCount >= MIN_ACTIVE_PEERS && peerContext.peerMedian > 0 && totalCost <= peerContext.peerMedian * ACTIVE_PEER_DISCOUNT_THRESHOLD) {
    addReason(state, 'fixed_price_below_active_fixed_price_peers', 36);
  }

  const priceDrop = hasRecentPriceDrop(listing, priceDropsById);
  if (priceDrop && toNumber(priceDrop.amountDropped) > 0) addReason(state, 'recent_price_reduction', 24);

  const remainingHours = hoursUntil(listing.itemEndDate || listing.marketplaceTimestamps?.itemEndDate, nowMs);
  if (isAuction(listing) && remainingHours !== null && remainingHours >= 0 && remainingHours <= ENDING_SOON_HOURS) {
    addReason(state, 'ending_soon_auction_research', 28);
  }

  const bidCount = toNumber(listing.bidCount ?? listing.raw?.bidCount, 0);
  if (isAuction(listing) && bidCount > 0) addReason(state, 'auction_bid_activity_context', Math.min(12, 4 + bidCount));

  const listingAgeHours = hoursSince(listing.itemCreationDate || listing.firstSeenAt || listing.marketplaceTimestamps?.itemCreationDate, nowMs);
  if (listingAgeHours !== null && listingAgeHours <= RECENT_LISTING_HOURS) addReason(state, 'newly_listed_candidate', 8);

  if (String(listing.title || '').length < 45 || missingMaterialFields.length) addReason(state, 'weak_title_visibility', 10);
  if (missingMaterialFields.length) addReason(state, 'missing_identity_details', -16);
  if (getSearchConfidence(identity) === 'insufficient_identity' || missingMaterialFields.length >= 2 || identity.blockedTraits.reprint || identity.blockedTraits.lot || identity.blockedTraits.sealed) {
    addReason(state, 'ambiguous_identity_review_required', -24);
  }

  if ((Array.isArray(listing.priceDrops) && listing.priceDrops.length > 0) || (toNumber(listing.seenCount) > 1 && listing.status === 'active')) {
    addReason(state, 'relist_or_disappearance_history', 6);
  }

  if (!hasMaterialResearchReason(state.reasonCodes) || !state.reasonCodes.length || state.score < 10) return null;

  const listingId = String(listing.ebayItemId || listing.marketplaceListingId || listing.listingId || listing.itemId || '');
  const searchConfidence = getSearchConfidence(identity);

  return Object.freeze({
    listingId,
    marketplace: listing.marketplace || 'ebay',
    lane: listing.lane || 'all',
    title: publicText(listing.title),
    price: roundMoney(listing.price),
    shipping: roundMoney(listing.shipping),
    totalCost,
    currency: listing.currency || 'USD',
    listingType: isAuction(listing) ? 'auction_current_non_final' : 'fixed_price_or_unknown',
    identitySearchConfidence: searchConfidence,
    missingMaterialFields: missingMaterialFields.slice().sort(),
    researchScore: clampScore(state.score),
    reasonCodes: state.reasonCodes.slice().sort(),
    explanations: state.explanations.slice().sort((a, b) => a.code.localeCompare(b.code)),
    activeMarketContext: Object.freeze({
      peerCount: peerContext.peerCount,
      peerMedian: peerContext.peerMedian,
      fixedPriceOnly: true,
      matchingCurrencyOnly: true,
      activeAskingPriceOnly: true,
      soldCompVerificationRequired: true
    }),
    timingContext: Object.freeze({
      listingAgeHours: listingAgeHours === null ? null : Math.round(listingAgeHours * 10) / 10,
      endingSoonHours: remainingHours === null ? null : Math.round(remainingHours * 10) / 10,
      currentBidCount: bidCount,
      auctionBidFinal: false
    }),
    soldItemsResearchUrl: buildSoldItemsResearchUrl(identity),
    listingUrl: publicUrl(listing.url),
    status: 'research_opportunity',
    authority: AUTHORITY_BOUNDARIES
  });
}

function sortListingsForBoundedInput(a = {}, b = {}) {
  const aTime = parseTimestamp(a.lastSeenAt || a.itemCreationDate || a.marketplaceTimestamps?.itemCreationDate) || 0;
  const bTime = parseTimestamp(b.lastSeenAt || b.itemCreationDate || b.marketplaceTimestamps?.itemCreationDate) || 0;
  if (bTime !== aTime) return bTime - aTime;
  const aId = String(a.ebayItemId || a.listingId || a.marketplaceListingId || '');
  const bId = String(b.ebayItemId || b.listingId || b.marketplaceListingId || '');
  return aId.localeCompare(bId);
}

function buildResearchOpportunities(inputListings = [], options = {}) {
  const rawListings = Array.isArray(inputListings) ? inputListings.slice() : [];
  const evaluatedNow = options.now || new Date().toISOString();
  const inputLimit = Math.min(MAX_INPUT_LISTINGS, Math.max(1, Number(options.inputLimit || MAX_INPUT_LISTINGS)));
  const listings = rawListings
    .slice()
    .sort(sortListingsForBoundedInput)
    .slice(0, inputLimit);
  const lane = options.lane && options.lane !== 'all' ? String(options.lane) : null;
  const scopedListings = lane ? listings.filter((listing) => listing.lane === lane) : listings;
  const priceDrops = Array.isArray(options.priceDrops) ? options.priceDrops : [];
  const priceDropsById = buildPriceDropMap(priceDrops);
  const identityCache = new Map();
  const identityFor = (listing) => {
    const id = String(listing.ebayItemId || listing.listingId || listing.marketplaceListingId || '');
    const key = id || `object-${identityCache.size}`;
    if (!identityCache.has(key)) identityCache.set(key, extractIdentity(listing));
    return identityCache.get(key);
  };

  const opportunities = scopedListings
    .map((listing) => buildOpportunity(listing, {
      listings: scopedListings,
      priceDrops,
      priceDropsById,
      now: evaluatedNow,
      identityFor
    }))
    .filter(Boolean)
    .sort((a, b) => {
      if (b.researchScore !== a.researchScore) return b.researchScore - a.researchScore;
      if (a.totalCost !== b.totalCost) return a.totalCost - b.totalCost;
      return a.listingId.localeCompare(b.listingId);
    })
    .slice(0, Math.min(MAX_OPPORTUNITIES, Math.max(1, Number(options.limit || MAX_OPPORTUNITIES))));

  return Object.freeze({
    source: SOURCE,
    version: VERSION,
    generatedAt: options.generatedAt || new Date(parseTimestamp(evaluatedNow) || Date.now()).toISOString(),
    opportunityCount: opportunities.length,
    opportunities: opportunities.map((opportunity, index) => Object.freeze({ ...opportunity, rank: index + 1 })),
    diagnostics: Object.freeze({
      inputListingCount: rawListings.length,
      processedListingCount: listings.length,
      inputTruncated: rawListings.length > listings.length,
      droppedListingCount: Math.max(0, rawListings.length - listings.length),
      scopedListingCount: scopedListings.length,
      activeMarketOnly: true,
      soldPageVisited: false,
      canonicalSoldEvidenceMutated: false,
      dealGateMutated: false,
      alertsCreated: false
    }),
    authority: AUTHORITY_BOUNDARIES
  });
}

module.exports = {
  ACTIVE_PEER_DISCOUNT_THRESHOLD,
  AUTHORITY_BOUNDARIES,
  MAX_INPUT_LISTINGS,
  MAX_OPPORTUNITIES,
  REASON_MESSAGES,
  SOURCE,
  VERSION,
  buildResearchIdentity: extractIdentity,
  buildResearchOpportunities,
  buildSoldItemsResearchUrl,
  buildStrictIdentityKey,
  getMissingMaterialFields
};
