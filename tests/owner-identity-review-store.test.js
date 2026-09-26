'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const appStore = require('../utils/appStore');
const ownerIdentityReviewStore = require('../utils/ownerIdentityReviewStore');

function reviewInput(overrides = {}) {
  return {
    subjectName: 'Warming Bernabel',
    year: '2026',
    manufacturer: 'Topps',
    product: 'Topps Chrome',
    setName: 'Topps Chrome',
    cardNumber: 'RA-WBE',
    parallel: 'Orange Raywave',
    serialNumbered: 'serial_numbered',
    printRun: '25',
    autographState: 'autograph',
    memorabiliaState: 'unknown',
    rawOrGraded: 'raw',
    gradeCompany: '',
    grade: '',
    ownerReviewStatus: 'owner_reviewed',
    ...overrides
  };
}

test('owner identity review is bounded, server-bound, and non-authoritative', () => {
  const result = ownerIdentityReviewStore.upsertReview([], {
    listingId: 'active-bernabel',
    input: reviewInput(),
    now: '2026-09-26T12:00:00.000Z'
  });

  assert.equal(result.ok, true);
  assert.match(result.review.reviewId, /^owner-identity-review-[0-9a-f-]{36}$/i);
  assert.equal(result.review.listingId, 'active-bernabel');
  assert.equal(result.review.provenance, 'owner_identity_review');
  assert.equal(result.review.authority, 'non_authoritative_owner_assertion');
  assert.equal(result.review.canonicalIdentityStatus, 'not_canonical_identity');
  assert.equal(result.review.productionAuthority, 'none');
  assert.equal(result.review.canonicalReady, undefined);
  assert.equal(result.snapshot.fingerprint, result.review.fingerprint);
  assert.equal(result.snapshot.fields.subjectName, 'Warming Bernabel');

  const summary = ownerIdentityReviewStore.summarizeReviews(result.store);
  assert.equal(summary.totalReviews, 1);
  assert.equal(summary.usableOwnerIdentityReviewCount, 1);
  assert.equal(summary.canonicalIdentityCount, 0);
  assert.equal(summary.productionAuthority, 'none');
});

test('owner identity review requires subject plus a meaningful discriminator', () => {
  const broad = ownerIdentityReviewStore.normalizeReviewInput(reviewInput({
    subjectName: '',
    year: '2026',
    product: 'Topps Chrome'
  }));
  const subjectOnly = ownerIdentityReviewStore.normalizeReviewInput(reviewInput({
    subjectName: 'Warming Bernabel',
    year: '',
    product: '',
    setName: '',
    cardNumber: '',
    parallel: '',
    printRun: '',
    gradeCompany: '',
    grade: '',
    serialNumbered: 'serial_numbered',
    autographState: 'not_autograph',
    rawOrGraded: 'raw'
  }));
  const placeholder = ownerIdentityReviewStore.normalizeReviewInput(reviewInput({
    subjectName: 'unknown',
    year: 'not specified',
    product: 'N/A'
  }));
  const subjectYear = ownerIdentityReviewStore.normalizeReviewInput(reviewInput({
    subjectName: 'Warming Bernabel',
    year: '2026',
    product: '',
    setName: '',
    cardNumber: ''
  }));
  const subjectGrade = ownerIdentityReviewStore.normalizeReviewInput(reviewInput({
    subjectName: 'Warming Bernabel',
    year: '',
    product: '',
    setName: '',
    cardNumber: '',
    gradeCompany: 'PSA',
    grade: '10'
  }));

  assert.equal(broad.valid, false);
  assert.ok(broad.failures.includes('owner_comp_identity_snapshot_unusable'));
  assert.equal(subjectOnly.valid, false);
  assert.ok(subjectOnly.failures.includes('owner_comp_identity_snapshot_unusable'));
  assert.equal(placeholder.valid, false);
  assert.ok(placeholder.failures.includes('owner_comp_identity_snapshot_unusable'));
  assert.equal(subjectYear.valid, true);
  assert.equal(subjectGrade.valid, true);
});

test('owner identity review rejects malformed fields, nesting, unsupported fields, and trust injection', () => {
  const malformedYear = ownerIdentityReviewStore.normalizeReviewInput(reviewInput({ year: '26' }));
  const malformedPrintRun = ownerIdentityReviewStore.normalizeReviewInput(reviewInput({ printRun: '0' }));
  const malformedGrade = ownerIdentityReviewStore.normalizeReviewInput(reviewInput({ grade: '<script>' }));
  const nested = ownerIdentityReviewStore.normalizeReviewInput(reviewInput({ parallel: { raw: 'Orange' } }));
  const unsupported = ownerIdentityReviewStore.normalizeReviewInput(reviewInput({ listingId: 'fake' }));
  const dangerous = ownerIdentityReviewStore.normalizeReviewInput(reviewInput({ trustedContext: 'fake' }));

  assert.equal(malformedYear.valid, false);
  assert.ok(malformedYear.failures.includes('invalid_year'));
  assert.equal(malformedPrintRun.valid, false);
  assert.ok(malformedPrintRun.failures.includes('invalid_printRun'));
  assert.equal(malformedGrade.valid, false);
  assert.ok(malformedGrade.failures.includes('invalid_grade'));
  assert.equal(nested.valid, false);
  assert.equal(nested.reason, 'unexpected_nested_field');
  assert.equal(unsupported.valid, false);
  assert.equal(unsupported.reason, 'unsupported_field');
  assert.equal(dangerous.valid, false);
  assert.equal(dangerous.reason, 'dangerous_object_key');
  assert.equal({}.trustedContext, undefined);
});

test('owner identity review update preserves listing binding and replaces only current review', () => {
  const first = ownerIdentityReviewStore.upsertReview([], {
    listingId: 'active-1',
    input: reviewInput({ subjectName: 'Warming Bernabel', year: '2026' }),
    now: '2026-09-26T12:00:00.000Z'
  });
  const second = ownerIdentityReviewStore.upsertReview(first.store, {
    listingId: 'active-1',
    input: reviewInput({ subjectName: 'Warming Bernabel', cardNumber: 'RA-WBE', year: '' }),
    now: '2026-09-26T12:05:00.000Z'
  });

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(second.store.length, 1);
  assert.equal(second.review.reviewId, first.review.reviewId);
  assert.equal(second.review.createdAt, first.review.createdAt);
  assert.equal(second.review.updatedAt, '2026-09-26T12:05:00.000Z');
  assert.equal(second.review.year, '');
  assert.equal(second.review.cardNumber, 'RA-WBE');
});

test('app store normalizes owner identity reviews backwards compatibly', () => {
  const result = ownerIdentityReviewStore.upsertReview([], {
    listingId: 'active-1',
    input: reviewInput(),
    now: '2026-09-26T12:00:00.000Z'
  });
  const normalized = appStore.normalizeStore({
    ...appStore.createDefaultStore(),
    ownerIdentityReviews: [
      { reviewId: 'bad', productionAuthority: 'trusted' },
      result.review
    ]
  });

  assert.equal(appStore.createDefaultStore().ownerIdentityReviews.length, 0);
  assert.equal(normalized.ownerIdentityReviews.length, 1);
  assert.equal(normalized.ownerIdentityReviews[0].reviewId, result.review.reviewId);
  assert.equal(normalized.ownerIdentityReviews[0].productionAuthority, 'none');
});
