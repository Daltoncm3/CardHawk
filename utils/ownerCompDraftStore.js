'use strict';

const crypto = require('crypto');

const STORE_VERSION = 'owner-comp-draft-store-v1';
const MAX_DRAFTS = 500;
const MAX_DRAFTS_PER_LISTING = 50;
const MAX_URL_LENGTH = 600;
const MAX_NOTE_LENGTH = 80;
const MAX_BODY_BYTES = 8192;
const MAX_FIELD_LENGTH = 600;
const EBAY_ITEM_ID_PATTERN = /^\d{6,18}$/;
const DANGEROUS_KEYS = new Set([
  '__proto__',
  'prototype',
  'constructor',
  'trustedcontext',
  'trustedidentityartifact',
  'trustedretentionpolicyartifact',
  'canonicalready',
  'exactidentityverified',
  'productionauthority',
  'priceconfirmed',
  'sourcepolicies',
  'identityartifacts',
  'internaltrustedoptions',
  'testonly'
]);
const DRAFT_INPUT_FIELDS = new Set([
  'sourceMarketplace',
  'sourceSoldListingUrl',
  'displayedSoldPrice',
  'shippingAmount',
  'currency',
  'saleDate',
  'listingType',
  'rawOrGraded',
  'gradeCompany',
  'grade',
  'identityMatchDecision',
  'finalPriceCertainty',
  'ownerReasonCode',
  'ownerNotesCategory',
  'reviewStatus'
]);

const SOURCE_MARKETPLACES = Object.freeze(['ebay']);
const LISTING_TYPES = Object.freeze(['auction', 'fixed_price', 'best_offer', 'unknown']);
const RAW_OR_GRADED = Object.freeze(['raw', 'graded', 'unknown']);
const IDENTITY_MATCH_DECISIONS = Object.freeze(['exact_match', 'not_exact', 'unsure']);
const CURRENCIES = Object.freeze(['USD', 'CAD', 'EUR', 'GBP', 'AUD']);
const FINAL_PRICE_CERTAINTIES = Object.freeze([
  'confirmed_final_price',
  'displayed_price_may_not_equal_accepted_best_offer',
  'estimated_or_unknown'
]);
const OWNER_REASON_CODES = Object.freeze([
  'exact_visual_match',
  'identity_mismatch',
  'grade_or_condition_mismatch',
  'parallel_or_numbering_mismatch',
  'best_offer_uncertain',
  'needs_more_evidence',
  'owner_reference'
]);
const REVIEW_STATUSES = Object.freeze(['needs_more_evidence', 'reviewed', 'not_relevant']);

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function fingerprint(value) {
  return crypto.createHash('sha256').update(stableStringify(value)).digest('hex');
}

function byteLength(value) {
  return Buffer.byteLength(String(value ?? ''), 'utf8');
}

function sanitizeToken(value, maxLength = 80) {
  return String(value ?? '')
    .replace(/[^\w .:/#-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function validateSafeInputShape(input = {}, path = 'body') {
  if (byteLength(JSON.stringify(input || {})) > MAX_BODY_BYTES) return { valid: false, reason: 'request_body_too_large' };
  if (!isObject(input)) return { valid: false, reason: 'invalid_request_body' };
  for (const [key, value] of Object.entries(input)) {
    const normalizedKey = String(key).trim().toLowerCase();
    if (DANGEROUS_KEYS.has(normalizedKey)) return { valid: false, reason: 'dangerous_object_key' };
    if (!DRAFT_INPUT_FIELDS.has(key)) return { valid: false, reason: 'unsupported_field' };
    if (Array.isArray(value)) return { valid: false, reason: 'unexpected_nested_field', path };
    if (isObject(value)) {
      const nested = validateSafeInputShape(value, `${path}.${key}`);
      if (!nested.valid && nested.reason === 'dangerous_object_key') return nested;
      return { valid: false, reason: 'unexpected_nested_field', path };
    }
    if (byteLength(value) > MAX_FIELD_LENGTH) return { valid: false, reason: 'field_too_large' };
  }
  return { valid: true };
}

function assertSafeFlatObject(input = {}, path = 'body') {
  return validateSafeInputShape(input, path);
}

function enumValue(value, allowed, fallback) {
  const normalized = String(value ?? '').trim().toLowerCase();
  return allowed.includes(normalized) ? normalized : fallback;
}

function parseMoney(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1_000_000) return null;
  return Math.round(number * 100) / 100;
}

function parseCurrency(value) {
  const normalized = String(value ?? '').trim().toUpperCase();
  return CURRENCIES.includes(normalized) ? normalized : null;
}

function parseSaleDate(value) {
  const raw = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const time = new Date(`${raw}T00:00:00.000Z`).getTime();
  const now = Date.now();
  const earliest = new Date('1990-01-01T00:00:00.000Z').getTime();
  if (!Number.isFinite(time) || time < earliest || time > now + 86_400_000) return null;
  return raw;
}

function extractEbayItemId(url) {
  const segments = url.pathname.split('/').filter(Boolean);
  if (segments[0] !== 'itm') return null;
  const candidate = segments.slice(1).reverse().find((segment) => EBAY_ITEM_ID_PATTERN.test(segment));
  if (candidate) return candidate;
  const queryItem = url.searchParams.get('item');
  return EBAY_ITEM_ID_PATTERN.test(queryItem || '') ? queryItem : null;
}

function parseEbayItemUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw || byteLength(raw) > MAX_URL_LENGTH || /["'<>\s]/.test(raw)) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    const host = url.hostname.toLowerCase();
    if (host !== 'ebay.com' && host !== 'www.ebay.com') return null;
    if (url.hash) return null;
    const ebayItemId = extractEbayItemId(url);
    if (!ebayItemId) return null;
    return {
      ebayItemId,
      canonicalUrl: `https://www.ebay.com/itm/${ebayItemId}`
    };
  } catch (_) {
    return null;
  }
}

function buildIdentitySnapshot(listingId, identity = {}, options = {}) {
  const snapshot = {
    source: 'legacyIdentityAdapter.buildLegacyIdentityDiagnostics',
    listingId: String(listingId || ''),
    createdAt: options.createdAt || new Date().toISOString(),
    fields: {
      subjectName: identity.subjectName || '',
      year: identity.year || '',
      manufacturer: identity.manufacturer || '',
      product: identity.product || '',
      setName: identity.setName || '',
      cardNumber: identity.cardNumber || '',
      parallel: identity.parallel || '',
      serialNumbered: identity.serialNumbered || '',
      printRun: identity.printRun || '',
      autographState: identity.autographState || '',
      memorabiliaState: identity.memorabiliaState || '',
      rawOrGraded: identity.rawOrGraded || '',
      gradeCompany: identity.gradeCompany || '',
      grade: identity.grade || ''
    },
    missingMaterialFields: Array.isArray(identity.missingMaterialFields)
      ? identity.missingMaterialFields.slice().sort()
      : []
  };
  return Object.freeze({
    ...snapshot,
    fingerprint: fingerprint(snapshot)
  });
}

function normalizeDraftInput(input = {}) {
  const safe = assertSafeFlatObject(input);
  if (!safe.valid) return { valid: false, reason: safe.reason };
  const shippingAmount = input.shippingAmount === undefined || input.shippingAmount === null || input.shippingAmount === ''
    ? 0
    : parseMoney(input.shippingAmount);
  const sourceMarketplace = enumValue(input.sourceMarketplace, SOURCE_MARKETPLACES, '');
  const parsedUrl = parseEbayItemUrl(input.sourceSoldListingUrl);
  const gradeCompany = sanitizeToken(input.gradeCompany, 24);
  const grade = sanitizeToken(input.grade, 12);
  const ownerNotesCategory = sanitizeToken(input.ownerNotesCategory, MAX_NOTE_LENGTH);

  const normalized = {
    sourceMarketplace,
    sourceSoldListingUrl: parsedUrl?.canonicalUrl || null,
    sourceEbayItemId: parsedUrl?.ebayItemId || null,
    displayedSoldPrice: parseMoney(input.displayedSoldPrice),
    shippingAmount,
    currency: parseCurrency(input.currency),
    saleDate: parseSaleDate(input.saleDate),
    listingType: enumValue(input.listingType, LISTING_TYPES, 'unknown'),
    rawOrGraded: enumValue(input.rawOrGraded, RAW_OR_GRADED, 'unknown'),
    gradeCompany,
    grade,
    identityMatchDecision: enumValue(input.identityMatchDecision, IDENTITY_MATCH_DECISIONS, 'unsure'),
    finalPriceCertainty: enumValue(input.finalPriceCertainty, FINAL_PRICE_CERTAINTIES, 'estimated_or_unknown'),
    ownerReasonCode: enumValue(input.ownerReasonCode, OWNER_REASON_CODES, 'needs_more_evidence'),
    ownerNotesCategory,
    reviewStatus: enumValue(input.reviewStatus, REVIEW_STATUSES, 'needs_more_evidence')
  };

  const failures = [];
  if (!normalized.sourceMarketplace) failures.push('invalid_source_marketplace');
  if (!normalized.sourceSoldListingUrl) failures.push('invalid_source_url');
  if (normalized.displayedSoldPrice === null) failures.push('invalid_displayed_sold_price');
  if (normalized.shippingAmount === null) failures.push('invalid_shipping_amount');
  if (!normalized.currency) failures.push('invalid_currency');
  if (!normalized.saleDate) failures.push('invalid_sale_date');
  if (!/^[A-Za-z0-9 .-]{0,24}$/.test(gradeCompany)) failures.push('invalid_grade_company');
  if (!/^[A-Za-z0-9.+/-]{0,12}$/.test(grade)) failures.push('invalid_grade');
  if (byteLength(String(input.ownerNotesCategory ?? '')) > MAX_NOTE_LENGTH) failures.push('field_too_large');
  if (normalized.rawOrGraded === 'graded' && (!normalized.gradeCompany || !normalized.grade)) {
    failures.push('missing_grading_details');
  }
  if (normalized.listingType === 'best_offer' && normalized.finalPriceCertainty === 'confirmed_final_price') {
    failures.push('best_offer_final_price_unconfirmed');
  }

  return {
    valid: failures.length === 0,
    failures,
    normalized
  };
}

function priceEvidenceStatus(input = {}) {
  if (input.listingType === 'best_offer') return 'provisional_best_offer_or_uncertain';
  if (input.finalPriceCertainty === 'confirmed_final_price') return 'confirmed_final_price';
  if (input.finalPriceCertainty === 'displayed_price_may_not_equal_accepted_best_offer' || input.listingType === 'best_offer') {
    return 'provisional_best_offer_or_uncertain';
  }
  return 'provisional_estimated_or_unknown';
}

function createDraftId() {
  return `owner-comp-${crypto.randomUUID()}`;
}

function duplicateKeyForDraft(draft = {}) {
  return stableStringify({
    listingId: String(draft.listingId || ''),
    sourceMarketplace: 'ebay',
    sourceEbayItemId: String(draft.sourceEbayItemId || ''),
    saleDate: String(draft.saleDate || ''),
    displayedSoldPrice: Number(draft.displayedSoldPrice),
    currency: String(draft.currency || '')
  });
}

function isPersistedDraftSafe(draft = {}) {
  if (!isObject(draft)) return false;
  if (String(draft.schemaVersion || '') !== STORE_VERSION) return false;
  if (!/^owner-comp-[0-9a-f-]{36}$/i.test(String(draft.draftId || ''))) return false;
  if (!draft.listingId || typeof draft.listingId !== 'string') return false;
  if (!isObject(draft.identitySnapshot) || typeof draft.identityFingerprint !== 'string') return false;
  if (draft.identityFingerprint !== draft.identitySnapshot.fingerprint) return false;
  if (draft.ownerIdentityReviewSnapshot !== undefined && draft.ownerIdentityReviewSnapshot !== null) {
    if (!isObject(draft.ownerIdentityReviewSnapshot) || typeof draft.ownerIdentityReviewFingerprint !== 'string') return false;
    if (draft.ownerIdentityReviewFingerprint !== draft.ownerIdentityReviewSnapshot.fingerprint) return false;
    if (draft.ownerIdentityReviewSnapshot.provenance !== 'owner_identity_review') return false;
    if (draft.ownerIdentityReviewSnapshot.authority !== 'non_authoritative_owner_assertion') return false;
    if (draft.ownerIdentityReviewSnapshot.canonicalIdentityStatus !== 'not_canonical_identity') return false;
    if (draft.ownerIdentityReviewSnapshot.productionAuthority !== 'none') return false;
  }
  if (draft.canonicalSoldEvidenceStatus !== 'not_canonical_sold_evidence') return false;
  if (draft.productionAuthority !== 'none') return false;
  if (draft.canonicalReady === true || draft.exactIdentityVerified === true || draft.trustedContext) return false;
  const normalized = normalizeDraftInput({
    sourceMarketplace: draft.sourceMarketplace,
    sourceSoldListingUrl: draft.sourceSoldListingUrl,
    displayedSoldPrice: draft.displayedSoldPrice,
    shippingAmount: draft.shippingAmount,
    currency: draft.currency,
    saleDate: draft.saleDate,
    listingType: draft.listingType,
    rawOrGraded: draft.rawOrGraded,
    gradeCompany: draft.gradeCompany,
    grade: draft.grade,
    identityMatchDecision: draft.identityMatchDecision,
    finalPriceCertainty: draft.finalPriceCertainty,
    ownerReasonCode: draft.ownerReasonCode,
    ownerNotesCategory: draft.ownerNotesCategory,
    reviewStatus: draft.reviewStatus
  });
  return normalized.valid === true;
}

function normalizeStore(drafts = []) {
  return (Array.isArray(drafts) ? drafts : [])
    .filter(isPersistedDraftSafe)
    .slice(-MAX_DRAFTS);
}

function listDrafts(store = [], filters = {}) {
  const listingId = filters.listingId ? String(filters.listingId) : null;
  return normalizeStore(store)
    .filter((draft) => !listingId || draft.listingId === listingId)
    .slice()
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')) || String(a.draftId).localeCompare(String(b.draftId)))
    .map(clone);
}

function getDraft(store = [], listingId, draftId) {
  return normalizeStore(store).find((draft) => draft.listingId === String(listingId) && draft.draftId === String(draftId)) || null;
}

function buildDraft({ store = [], listingId, identitySnapshot, ownerIdentityReviewSnapshot = null, input, now }) {
  const normalizedResult = normalizeDraftInput(input);
  if (!normalizedResult.valid) return { ok: false, reason: 'invalid_draft_input', failures: normalizedResult.failures || [normalizedResult.reason] };

  const normalizedStore = normalizeStore(store);
  if (normalizedStore.length >= MAX_DRAFTS) return { ok: false, reason: 'global_draft_limit_exceeded' };
  const scopedCount = normalizedStore.filter((draft) => draft.listingId === String(listingId)).length;
  if (scopedCount >= MAX_DRAFTS_PER_LISTING) return { ok: false, reason: 'listing_draft_limit_exceeded' };

  const createdAt = now || new Date().toISOString();
  const normalized = normalizedResult.normalized;
  const prospectiveDuplicateKey = duplicateKeyForDraft({ ...normalized, listingId });
  const duplicate = normalizedStore.find((draft) => duplicateKeyForDraft(draft) === prospectiveDuplicateKey);
  if (duplicate) return { ok: false, reason: 'duplicate_comp_draft', draft: clone(duplicate) };

  const identityFingerprint = identitySnapshot?.fingerprint || fingerprint(identitySnapshot || {});
  const ownerIdentityReviewFingerprint = ownerIdentityReviewSnapshot?.fingerprint || null;
  const draft = {
    schemaVersion: STORE_VERSION,
    draftId: createDraftId(),
    listingId: String(listingId),
    identitySnapshot: clone(identitySnapshot),
    identityFingerprint,
    ownerIdentityReviewSnapshot: ownerIdentityReviewSnapshot ? clone(ownerIdentityReviewSnapshot) : null,
    ownerIdentityReviewFingerprint,
    ...normalized,
    priceEvidenceStatus: priceEvidenceStatus(normalized),
    canonicalSoldEvidenceStatus: 'not_canonical_sold_evidence',
    productionAuthority: 'none',
    createdAt,
    updatedAt: createdAt
  };

  return { ok: true, draft: clone(draft) };
}

function addDraft(store = [], args = {}) {
  const built = buildDraft({ ...args, store });
  if (!built.ok) return { ...built, store: normalizeStore(store) };
  const next = [...normalizeStore(store), built.draft].slice(-MAX_DRAFTS);
  return { ok: true, draft: clone(built.draft), store: next };
}

function updateDraft(store = [], listingId, draftId, input = {}, options = {}) {
  const normalizedStore = normalizeStore(store);
  const index = normalizedStore.findIndex((draft) => draft.listingId === String(listingId) && draft.draftId === String(draftId));
  if (index < 0) return { ok: false, reason: 'draft_not_found', store: normalizedStore };
  const normalizedResult = normalizeDraftInput(input);
  if (!normalizedResult.valid) return { ok: false, reason: 'invalid_draft_input', failures: normalizedResult.failures || [normalizedResult.reason], store: normalizedStore };

  const current = normalizedStore[index];
  const prospectiveDuplicateKey = duplicateKeyForDraft({
    ...normalizedResult.normalized,
    listingId: String(listingId)
  });
  const duplicate = normalizedStore.find((draft) =>
    draft.draftId !== String(draftId) &&
    duplicateKeyForDraft(draft) === prospectiveDuplicateKey
  );
  if (duplicate) return { ok: false, reason: 'duplicate_comp_draft', draft: clone(duplicate), store: normalizedStore };

  const updated = {
    ...current,
    ...normalizedResult.normalized,
    draftId: current.draftId,
    listingId: current.listingId,
    identitySnapshot: current.identitySnapshot,
    identityFingerprint: current.identityFingerprint,
    ownerIdentityReviewSnapshot: current.ownerIdentityReviewSnapshot || null,
    ownerIdentityReviewFingerprint: current.ownerIdentityReviewFingerprint || null,
    createdAt: current.createdAt,
    updatedAt: options.now || new Date().toISOString(),
    priceEvidenceStatus: priceEvidenceStatus(normalizedResult.normalized),
    canonicalSoldEvidenceStatus: 'not_canonical_sold_evidence',
    productionAuthority: 'none'
  };
  const next = normalizedStore.slice();
  next[index] = updated;
  return { ok: true, draft: clone(updated), store: next };
}

function updateStatus(store = [], listingId, draftId, status, options = {}) {
  const normalizedStore = normalizeStore(store);
  const index = normalizedStore.findIndex((draft) => draft.listingId === String(listingId) && draft.draftId === String(draftId));
  if (index < 0) return { ok: false, reason: 'draft_not_found', store: normalizedStore };
  const reviewStatus = enumValue(status, REVIEW_STATUSES, '');
  if (!reviewStatus) return { ok: false, reason: 'invalid_review_status', store: normalizedStore };
  const next = normalizedStore.slice();
  next[index] = {
    ...next[index],
    reviewStatus,
    updatedAt: options.now || new Date().toISOString()
  };
  return { ok: true, draft: clone(next[index]), store: next };
}

function deleteDraft(store = [], listingId, draftId) {
  const normalizedStore = normalizeStore(store);
  const next = normalizedStore.filter((draft) => !(draft.listingId === String(listingId) && draft.draftId === String(draftId)));
  if (next.length === normalizedStore.length) return { ok: false, reason: 'draft_not_found', store: normalizedStore };
  return { ok: true, store: next };
}

function summarizeDrafts(store = []) {
  const drafts = normalizeStore(store);
  return {
    schemaVersion: STORE_VERSION,
    totalDrafts: drafts.length,
    confirmedFinalPriceCount: drafts.filter((draft) => draft.priceEvidenceStatus === 'confirmed_final_price').length,
    provisionalPriceCount: drafts.filter((draft) => draft.priceEvidenceStatus !== 'confirmed_final_price').length,
    canonicalSoldEvidenceCount: 0,
    productionAuthority: 'none'
  };
}

module.exports = {
  FINAL_PRICE_CERTAINTIES,
  IDENTITY_MATCH_DECISIONS,
  LISTING_TYPES,
  MAX_DRAFTS,
  MAX_DRAFTS_PER_LISTING,
  OWNER_REASON_CODES,
  RAW_OR_GRADED,
  REVIEW_STATUSES,
  SOURCE_MARKETPLACES,
  STORE_VERSION,
  addDraft,
  assertSafeFlatObject,
  buildIdentitySnapshot,
  deleteDraft,
  getDraft,
  listDrafts,
  normalizeDraftInput,
  normalizeStore,
  summarizeDrafts,
  updateDraft,
  updateStatus
};
