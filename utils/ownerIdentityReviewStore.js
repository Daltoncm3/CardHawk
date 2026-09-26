'use strict';

const crypto = require('crypto');

const STORE_VERSION = 'owner-identity-review-store-v1';
const MAX_REVIEWS = 500;
const MAX_REVIEWS_PER_LISTING = 1;
const MAX_BODY_BYTES = 8192;
const MAX_TEXT_LENGTH = 80;

const OWNER_REVIEW_STATUSES = Object.freeze(['owner_reviewed', 'needs_revision']);
const SERIAL_NUMBERED_STATES = Object.freeze(['serial_numbered', 'not_serial_numbered', 'unknown']);
const AUTOGRAPH_STATES = Object.freeze(['autograph', 'not_autograph', 'unknown']);
const MEMORABILIA_STATES = Object.freeze(['memorabilia', 'not_memorabilia', 'unknown']);
const RAW_OR_GRADED_STATES = Object.freeze(['raw', 'graded', 'unknown']);

const PLACEHOLDER_VALUES = new Set([
  'unknown',
  'missing',
  'ambiguous',
  'not specified',
  'unspecified',
  'n/a',
  'na',
  'none',
  'null',
  'undefined',
  '-'
]);

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
  'testonly',
  'canonicalidentitystatus',
  'authority',
  'provenance',
  'fingerprint',
  'reviewfingerprint'
]);

const REVIEW_INPUT_FIELDS = new Set([
  'subjectName',
  'year',
  'manufacturer',
  'product',
  'setName',
  'cardNumber',
  'parallel',
  'serialNumbered',
  'printRun',
  'autographState',
  'memorabiliaState',
  'rawOrGraded',
  'gradeCompany',
  'grade',
  'ownerReviewStatus'
]);

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

function normalizeWhitespace(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function meaningfulIdentityValue(value) {
  const normalized = normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized || PLACEHOLDER_VALUES.has(normalized)) return '';
  return normalized;
}

function sanitizeText(value, maxLength = MAX_TEXT_LENGTH) {
  const text = normalizeWhitespace(value);
  if (!text) return '';
  if (byteLength(text) > maxLength) return null;
  if (!/^[A-Za-z0-9 .,#:/+'()-]+$/.test(text)) return null;
  return text;
}

function enumValue(value, allowed, fallback = 'unknown') {
  const normalized = normalizeWhitespace(value).toLowerCase();
  if (!normalized) return fallback;
  return allowed.includes(normalized) ? normalized : null;
}

function normalizeYear(value) {
  const raw = normalizeWhitespace(value);
  if (!raw) return '';
  if (!/^\d{4}$/.test(raw)) return null;
  const year = Number(raw);
  const currentYear = new Date().getUTCFullYear() + 1;
  if (year < 1880 || year > currentYear) return null;
  return raw;
}

function normalizePrintRun(value) {
  const raw = normalizeWhitespace(value).replace(/^#/, '');
  if (!raw) return '';
  if (!/^\d{1,6}$/.test(raw)) return null;
  const number = Number(raw);
  if (!Number.isInteger(number) || number <= 0 || number > 999999) return null;
  return String(number);
}

function normalizeGrade(value) {
  const raw = normalizeWhitespace(value);
  if (!raw) return '';
  if (byteLength(raw) > 12) return null;
  if (!/^[A-Za-z0-9.+/-]+$/.test(raw)) return null;
  return raw;
}

function validateSafeInputShape(input = {}, path = 'body') {
  if (!isObject(input)) return { valid: false, reason: 'invalid_request_body' };
  if (byteLength(JSON.stringify(input || {})) > MAX_BODY_BYTES) return { valid: false, reason: 'request_body_too_large' };
  for (const [key, value] of Object.entries(input)) {
    const normalizedKey = String(key).trim().toLowerCase();
    if (DANGEROUS_KEYS.has(normalizedKey)) return { valid: false, reason: 'dangerous_object_key', path };
    if (!REVIEW_INPUT_FIELDS.has(key)) return { valid: false, reason: 'unsupported_field', path };
    if (Array.isArray(value) || isObject(value)) return { valid: false, reason: 'unexpected_nested_field', path };
    if (byteLength(value) > MAX_TEXT_LENGTH) return { valid: false, reason: 'field_too_large', path };
  }
  return { valid: true };
}

function normalizeReviewInput(input = {}) {
  const safe = validateSafeInputShape(input);
  if (!safe.valid) return { valid: false, reason: safe.reason };

  const normalized = {
    subjectName: sanitizeText(input.subjectName),
    year: normalizeYear(input.year),
    manufacturer: sanitizeText(input.manufacturer),
    product: sanitizeText(input.product),
    setName: sanitizeText(input.setName),
    cardNumber: sanitizeText(input.cardNumber, 40),
    parallel: sanitizeText(input.parallel),
    serialNumbered: enumValue(input.serialNumbered, SERIAL_NUMBERED_STATES),
    printRun: normalizePrintRun(input.printRun),
    autographState: enumValue(input.autographState, AUTOGRAPH_STATES),
    memorabiliaState: enumValue(input.memorabiliaState, MEMORABILIA_STATES),
    rawOrGraded: enumValue(input.rawOrGraded, RAW_OR_GRADED_STATES),
    gradeCompany: sanitizeText(input.gradeCompany, 24),
    grade: normalizeGrade(input.grade),
    ownerReviewStatus: enumValue(input.ownerReviewStatus, OWNER_REVIEW_STATUSES, 'owner_reviewed')
  };

  const failures = [];
  for (const [field, value] of Object.entries(normalized)) {
    if (value === null) failures.push(`invalid_${field}`);
  }

  if (!hasUsableOwnerIdentityReview({ fields: normalized })) {
    failures.push('owner_comp_identity_snapshot_unusable');
  }

  return {
    valid: failures.length === 0,
    failures,
    normalized
  };
}

function hasUsableOwnerIdentityReview(reviewOrSnapshot = {}) {
  const fields = reviewOrSnapshot.fields || reviewOrSnapshot;
  const subjectName = meaningfulIdentityValue(fields.subjectName);
  if (!subjectName) return false;

  const discriminators = new Set();
  const add = (value) => {
    const meaningful = meaningfulIdentityValue(value);
    if (meaningful) discriminators.add(meaningful);
  };

  add(fields.year);
  add(fields.product || fields.setName);
  add(fields.cardNumber);
  add(fields.parallel);
  add(fields.printRun);

  const gradeCompany = meaningfulIdentityValue(fields.gradeCompany);
  const grade = meaningfulIdentityValue(fields.grade);
  if (gradeCompany && grade) discriminators.add(`${gradeCompany}:${grade}`);

  return discriminators.size >= 1;
}

function createReviewId() {
  return `owner-identity-review-${crypto.randomUUID()}`;
}

function buildReviewSnapshot(review = {}) {
  if (!isObject(review)) return null;
  const snapshot = {
    source: 'owner_identity_review',
    schemaVersion: STORE_VERSION,
    listingId: String(review.listingId || ''),
    reviewId: String(review.reviewId || ''),
    provenance: 'owner_identity_review',
    authority: 'non_authoritative_owner_assertion',
    canonicalIdentityStatus: 'not_canonical_identity',
    productionAuthority: 'none',
    ownerReviewStatus: OWNER_REVIEW_STATUSES.includes(review.ownerReviewStatus) ? review.ownerReviewStatus : 'owner_reviewed',
    createdAt: review.createdAt || '',
    updatedAt: review.updatedAt || '',
    fields: {
      subjectName: review.subjectName || '',
      year: review.year || '',
      manufacturer: review.manufacturer || '',
      product: review.product || '',
      setName: review.setName || '',
      cardNumber: review.cardNumber || '',
      parallel: review.parallel || '',
      serialNumbered: review.serialNumbered || '',
      printRun: review.printRun || '',
      autographState: review.autographState || '',
      memorabiliaState: review.memorabiliaState || '',
      rawOrGraded: review.rawOrGraded || '',
      gradeCompany: review.gradeCompany || '',
      grade: review.grade || ''
    }
  };
  return Object.freeze({
    ...snapshot,
    fingerprint: fingerprint(snapshot)
  });
}

function isPersistedReviewSafe(review = {}) {
  if (!isObject(review)) return false;
  if (String(review.schemaVersion || '') !== STORE_VERSION) return false;
  if (!/^owner-identity-review-[0-9a-f-]{36}$/i.test(String(review.reviewId || ''))) return false;
  if (!review.listingId || typeof review.listingId !== 'string') return false;
  if (review.provenance !== 'owner_identity_review') return false;
  if (review.authority !== 'non_authoritative_owner_assertion') return false;
  if (review.canonicalIdentityStatus !== 'not_canonical_identity') return false;
  if (review.productionAuthority !== 'none') return false;
  if (review.canonicalReady === true || review.exactIdentityVerified === true || review.trustedContext) return false;
  if (typeof review.fingerprint !== 'string' || review.fingerprint !== buildReviewSnapshot(review)?.fingerprint) return false;
  const normalized = normalizeReviewInput({
    subjectName: review.subjectName,
    year: review.year,
    manufacturer: review.manufacturer,
    product: review.product,
    setName: review.setName,
    cardNumber: review.cardNumber,
    parallel: review.parallel,
    serialNumbered: review.serialNumbered,
    printRun: review.printRun,
    autographState: review.autographState,
    memorabiliaState: review.memorabiliaState,
    rawOrGraded: review.rawOrGraded,
    gradeCompany: review.gradeCompany,
    grade: review.grade,
    ownerReviewStatus: review.ownerReviewStatus
  });
  return normalized.valid === true;
}

function normalizeStore(reviews = []) {
  const normalized = (Array.isArray(reviews) ? reviews : [])
    .filter(isPersistedReviewSafe)
    .slice()
    .sort((a, b) => String(a.updatedAt || '').localeCompare(String(b.updatedAt || '')) || String(a.reviewId).localeCompare(String(b.reviewId)));
  const latestByListing = new Map();
  for (const review of normalized) latestByListing.set(review.listingId, review);
  return Array.from(latestByListing.values()).slice(-MAX_REVIEWS).map(clone);
}

function getReview(store = [], listingId) {
  return normalizeStore(store).find((review) => review.listingId === String(listingId)) || null;
}

function listReviews(store = [], filters = {}) {
  const listingId = filters.listingId ? String(filters.listingId) : null;
  return normalizeStore(store)
    .filter((review) => !listingId || review.listingId === listingId)
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')) || String(a.reviewId).localeCompare(String(b.reviewId)))
    .map(clone);
}

function upsertReview(store = [], args = {}) {
  const listingId = String(args.listingId || '');
  if (!listingId) return { ok: false, reason: 'missing_listing_id', store: normalizeStore(store) };
  const normalizedResult = normalizeReviewInput(args.input);
  if (!normalizedResult.valid) {
    return { ok: false, reason: 'invalid_owner_identity_review', failures: normalizedResult.failures || [normalizedResult.reason], store: normalizeStore(store) };
  }

  const normalizedStore = normalizeStore(store);
  const existing = normalizedStore.find((review) => review.listingId === listingId) || null;
  if (!existing && normalizedStore.length >= MAX_REVIEWS) return { ok: false, reason: 'global_owner_identity_review_limit_exceeded', store: normalizedStore };
  const scopedCount = normalizedStore.filter((review) => review.listingId === listingId).length;
  if (!existing && scopedCount >= MAX_REVIEWS_PER_LISTING) return { ok: false, reason: 'listing_owner_identity_review_limit_exceeded', store: normalizedStore };

  const now = args.now || new Date().toISOString();
  const base = {
    schemaVersion: STORE_VERSION,
    reviewId: existing?.reviewId || createReviewId(),
    listingId,
    provenance: 'owner_identity_review',
    authority: 'non_authoritative_owner_assertion',
    canonicalIdentityStatus: 'not_canonical_identity',
    productionAuthority: 'none',
    ...normalizedResult.normalized,
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };
  const snapshot = buildReviewSnapshot(base);
  const review = {
    ...base,
    fingerprint: snapshot.fingerprint
  };

  const next = existing
    ? normalizedStore.map((entry) => entry.listingId === listingId ? review : entry)
    : [...normalizedStore, review];

  return { ok: true, review: clone(review), snapshot: clone(snapshot), store: next };
}

function summarizeReviews(store = []) {
  const reviews = normalizeStore(store);
  return {
    schemaVersion: STORE_VERSION,
    totalReviews: reviews.length,
    usableOwnerIdentityReviewCount: reviews.filter((review) => hasUsableOwnerIdentityReview(review)).length,
    canonicalIdentityCount: 0,
    productionAuthority: 'none'
  };
}

module.exports = {
  AUTOGRAPH_STATES,
  MEMORABILIA_STATES,
  MAX_REVIEWS,
  MAX_REVIEWS_PER_LISTING,
  OWNER_REVIEW_STATUSES,
  RAW_OR_GRADED_STATES,
  SERIAL_NUMBERED_STATES,
  STORE_VERSION,
  buildReviewSnapshot,
  getReview,
  hasUsableOwnerIdentityReview,
  listReviews,
  normalizeReviewInput,
  normalizeStore,
  summarizeReviews,
  upsertReview
};
