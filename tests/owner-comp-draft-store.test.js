'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const ownerCompDraftStore = require('../utils/ownerCompDraftStore');

function identitySnapshot(overrides = {}) {
  return ownerCompDraftStore.buildIdentitySnapshot('active-1', {
    subjectName: 'Shohei Ohtani',
    year: '2024',
    manufacturer: 'Topps',
    product: 'Topps Chrome',
    setName: 'Topps Chrome',
    cardNumber: '17',
    parallel: 'Refractor',
    rawOrGraded: 'graded',
    gradeCompany: 'PSA',
    grade: '10',
    missingMaterialFields: [],
    ...overrides
  }, { createdAt: '2026-09-25T12:00:00.000Z' });
}

function draftInput(overrides = {}) {
  return {
    sourceMarketplace: 'ebay',
    sourceSoldListingUrl: 'https://www.ebay.com/itm/123456789012',
    displayedSoldPrice: '125.50',
    shippingAmount: '5.25',
    currency: 'USD',
    saleDate: '2026-09-20',
    listingType: 'fixed_price',
    rawOrGraded: 'graded',
    gradeCompany: 'PSA',
    grade: '10',
    identityMatchDecision: 'exact_match',
    finalPriceCertainty: 'confirmed_final_price',
    ownerReasonCode: 'exact_visual_match',
    ownerNotesCategory: 'clean visual match',
    reviewStatus: 'needs_more_evidence',
    ...overrides
  };
}

test('owner comp drafts are bounded, server-bound, and never canonical sold evidence', () => {
  const snapshot = identitySnapshot();
  const result = ownerCompDraftStore.addDraft([], {
    listingId: 'active-1',
    identitySnapshot: snapshot,
    input: draftInput(),
    now: '2026-09-25T12:01:00.000Z'
  });

  assert.equal(result.ok, true);
  assert.equal(result.draft.listingId, 'active-1');
  assert.match(result.draft.draftId, /^owner-comp-[0-9a-f-]{36}$/i);
  assert.equal(result.draft.identityFingerprint, snapshot.fingerprint);
  assert.equal(result.draft.identitySnapshot.fields.subjectName, 'Shohei Ohtani');
  assert.equal(result.draft.priceEvidenceStatus, 'confirmed_final_price');
  assert.equal(result.draft.canonicalSoldEvidenceStatus, 'not_canonical_sold_evidence');
  assert.equal(result.draft.productionAuthority, 'none');

  const summary = ownerCompDraftStore.summarizeDrafts(result.store);
  assert.equal(summary.confirmedFinalPriceCount, 1);
  assert.equal(summary.canonicalSoldEvidenceCount, 0);
  assert.equal(summary.productionAuthority, 'none');
});

test('best offer and uncertain prices remain provisional owner review drafts', () => {
  const bestOffer = ownerCompDraftStore.addDraft([], {
    listingId: 'active-1',
    identitySnapshot: identitySnapshot(),
    input: draftInput({
      sourceSoldListingUrl: 'https://www.ebay.com/itm/223456789012',
      listingType: 'best_offer',
      finalPriceCertainty: 'displayed_price_may_not_equal_accepted_best_offer'
    }),
    now: '2026-09-25T12:02:00.000Z'
  });
  const estimated = ownerCompDraftStore.addDraft(bestOffer.store, {
    listingId: 'active-1',
    identitySnapshot: identitySnapshot(),
    input: draftInput({
      sourceSoldListingUrl: 'https://www.ebay.com/itm/323456789012',
      finalPriceCertainty: 'estimated_or_unknown'
    }),
    now: '2026-09-25T12:03:00.000Z'
  });

  assert.equal(bestOffer.draft.priceEvidenceStatus, 'provisional_best_offer_or_uncertain');
  assert.equal(estimated.draft.priceEvidenceStatus, 'provisional_estimated_or_unknown');
  assert.equal(ownerCompDraftStore.summarizeDrafts(estimated.store).provisionalPriceCount, 2);
});

test('best offer cannot be owner-marked as confirmed final price', () => {
  const result = ownerCompDraftStore.addDraft([], {
    listingId: 'active-1',
    identitySnapshot: identitySnapshot(),
    input: draftInput({
      sourceSoldListingUrl: 'https://www.ebay.com/itm/423456789012',
      listingType: 'best_offer',
      finalPriceCertainty: 'confirmed_final_price'
    })
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'invalid_draft_input');
  assert.ok(result.failures.includes('best_offer_final_price_unconfirmed'));
  assert.equal(result.store.length, 0);
});

test('draft validation rejects malformed prices, dates, URLs, nesting, and dangerous keys', () => {
  const invalidShipping = ownerCompDraftStore.normalizeDraftInput(draftInput({ shippingAmount: 'not-money' }));
  assert.equal(invalidShipping.valid, false);
  assert.ok(invalidShipping.failures.includes('invalid_shipping_amount'));

  const invalidPrice = ownerCompDraftStore.normalizeDraftInput(draftInput({ displayedSoldPrice: 'Infinity' }));
  assert.equal(invalidPrice.valid, false);
  assert.ok(invalidPrice.failures.includes('invalid_displayed_sold_price'));

  const invalidDate = ownerCompDraftStore.normalizeDraftInput(draftInput({ saleDate: '2040-01-01' }));
  assert.equal(invalidDate.valid, false);
  assert.ok(invalidDate.failures.includes('invalid_sale_date'));

  const invalidUrl = ownerCompDraftStore.normalizeDraftInput(draftInput({ sourceSoldListingUrl: 'javascript:alert(1)' }));
  assert.equal(invalidUrl.valid, false);
  assert.ok(invalidUrl.failures.includes('invalid_source_url'));

  const nested = ownerCompDraftStore.normalizeDraftInput(draftInput({ ownerNotesCategory: { raw: 'nope' } }));
  assert.equal(nested.valid, false);
  assert.equal(nested.reason, 'unexpected_nested_field');

  const dangerous = ownerCompDraftStore.normalizeDraftInput(JSON.parse(`{
    "__proto__": "polluted",
    "sourceSoldListingUrl": "https://www.ebay.com/itm/sold-comp-1"
  }`));
  assert.equal(dangerous.valid, false);
  assert.equal(dangerous.reason, 'dangerous_object_key');
  assert.equal({}.polluted, undefined);

  const invalidCurrency = ownerCompDraftStore.normalizeDraftInput(draftInput({ currency: 'JPY' }));
  assert.equal(invalidCurrency.valid, false);
  assert.ok(invalidCurrency.failures.includes('invalid_currency'));

  const unsupported = ownerCompDraftStore.normalizeDraftInput(draftInput({ trustedContext: 'fake' }));
  assert.equal(unsupported.valid, false);
  assert.equal(unsupported.reason, 'dangerous_object_key');
});

test('duplicate and cross-listing draft operations fail closed', () => {
  const added = ownerCompDraftStore.addDraft([], {
    listingId: 'active-1',
    identitySnapshot: identitySnapshot(),
    input: draftInput(),
    now: '2026-09-25T12:04:00.000Z'
  });
  const duplicate = ownerCompDraftStore.addDraft(added.store, {
    listingId: 'active-1',
    identitySnapshot: identitySnapshot(),
    input: draftInput(),
    now: '2026-09-25T12:05:00.000Z'
  });
  const crossListingUpdate = ownerCompDraftStore.updateDraft(added.store, 'active-2', added.draft.draftId, draftInput());
  const crossListingDelete = ownerCompDraftStore.deleteDraft(added.store, 'active-2', added.draft.draftId);

  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.reason, 'duplicate_comp_draft');
  assert.equal(crossListingUpdate.ok, false);
  assert.equal(crossListingUpdate.reason, 'draft_not_found');
  assert.equal(crossListingDelete.ok, false);
  assert.equal(crossListingDelete.reason, 'draft_not_found');
});

test('per-listing draft cap is enforced deterministically', () => {
  let drafts = [];
  for (let index = 0; index < ownerCompDraftStore.MAX_DRAFTS_PER_LISTING; index += 1) {
    const added = ownerCompDraftStore.addDraft(drafts, {
      listingId: 'active-1',
      identitySnapshot: identitySnapshot(),
      input: draftInput({
        sourceSoldListingUrl: `https://www.ebay.com/itm/${String(500000000000 + index)}`,
        saleDate: `2026-09-${String(1 + (index % 20)).padStart(2, '0')}`
      }),
      now: `2026-09-25T12:${String(index).padStart(2, '0')}:00.000Z`
    });
    assert.equal(added.ok, true);
    drafts = added.store;
  }

  const capped = ownerCompDraftStore.addDraft(drafts, {
    listingId: 'active-1',
    identitySnapshot: identitySnapshot(),
    input: draftInput({ sourceSoldListingUrl: 'https://www.ebay.com/itm/623456789012' })
  });

  assert.equal(capped.ok, false);
  assert.equal(capped.reason, 'listing_draft_limit_exceeded');
});

test('global draft cap rejects without evicting existing drafts', () => {
  const drafts = Array.from({ length: ownerCompDraftStore.MAX_DRAFTS }, (_, index) => {
    const added = ownerCompDraftStore.addDraft([], {
      listingId: `listing-${index}`,
      identitySnapshot: ownerCompDraftStore.buildIdentitySnapshot(`listing-${index}`, {
        subjectName: 'Shohei Ohtani'
      }, { createdAt: '2026-09-25T12:00:00.000Z' }),
      input: draftInput({
        sourceSoldListingUrl: `https://www.ebay.com/itm/${String(700000000000 + index)}`
      }),
      now: '2026-09-25T12:00:00.000Z'
    });
    assert.equal(added.ok, true);
    return added.draft;
  });

  const capped = ownerCompDraftStore.addDraft(drafts, {
    listingId: 'overflow-listing',
    identitySnapshot: identitySnapshot(),
    input: draftInput({ sourceSoldListingUrl: 'https://www.ebay.com/itm/823456789012' })
  });

  assert.equal(capped.ok, false);
  assert.equal(capped.reason, 'global_draft_limit_exceeded');
  assert.equal(capped.store.length, ownerCompDraftStore.MAX_DRAFTS);
  assert.deepEqual(capped.store.map((draft) => draft.draftId), drafts.map((draft) => draft.draftId));
});

test('strict eBay item URL canonicalization rejects unsafe hosts and dedupes variants', () => {
  const lookalike = ownerCompDraftStore.normalizeDraftInput(draftInput({ sourceSoldListingUrl: 'https://www.ebay.com.attacker.example/itm/123456789012' }));
  const subdomain = ownerCompDraftStore.normalizeDraftInput(draftInput({ sourceSoldListingUrl: 'https://signin.ebay.com/itm/123456789012' }));
  const credentials = ownerCompDraftStore.normalizeDraftInput(draftInput({ sourceSoldListingUrl: 'https://user:pass@www.ebay.com/itm/123456789012' }));
  const fragment = ownerCompDraftStore.normalizeDraftInput(draftInput({ sourceSoldListingUrl: 'https://www.ebay.com/itm/123456789012#payload' }));
  const malformed = ownerCompDraftStore.normalizeDraftInput(draftInput({ sourceSoldListingUrl: 'https://www.ebay.com/itm/not-an-id' }));
  const canonical = ownerCompDraftStore.normalizeDraftInput(draftInput({ sourceSoldListingUrl: 'https://ebay.com/itm/example-title/123456789012?hash=item&mkcid=1' }));

  for (const result of [lookalike, subdomain, credentials, fragment, malformed]) {
    assert.equal(result.valid, false);
    assert.ok(result.failures.includes('invalid_source_url'));
  }
  assert.equal(canonical.valid, true);
  assert.equal(canonical.normalized.sourceSoldListingUrl, 'https://www.ebay.com/itm/123456789012');
  assert.equal(canonical.normalized.sourceEbayItemId, '123456789012');

  const first = ownerCompDraftStore.addDraft([], {
    listingId: 'active-1',
    identitySnapshot: identitySnapshot(),
    input: draftInput({ sourceSoldListingUrl: 'https://www.ebay.com/itm/123456789012?mkcid=tracking' })
  });
  const second = ownerCompDraftStore.addDraft(first.store, {
    listingId: 'active-1',
    identitySnapshot: identitySnapshot(),
    input: draftInput({ sourceSoldListingUrl: 'https://ebay.com/itm/title/123456789012' })
  });
  assert.equal(second.ok, false);
  assert.equal(second.reason, 'duplicate_comp_draft');
  assert.equal(second.store.length, 1);
});

test('duplicate edit collision fails without mutating existing drafts', () => {
  const first = ownerCompDraftStore.addDraft([], {
    listingId: 'active-1',
    identitySnapshot: identitySnapshot(),
    input: draftInput({ sourceSoldListingUrl: 'https://www.ebay.com/itm/923456789012' }),
    now: '2026-09-25T12:01:00.000Z'
  });
  const second = ownerCompDraftStore.addDraft(first.store, {
    listingId: 'active-1',
    identitySnapshot: identitySnapshot(),
    input: draftInput({ sourceSoldListingUrl: 'https://www.ebay.com/itm/933456789012' }),
    now: '2026-09-25T12:02:00.000Z'
  });
  const before = JSON.stringify(second.store);
  const collision = ownerCompDraftStore.updateDraft(second.store, 'active-1', second.draft.draftId, draftInput({
    sourceSoldListingUrl: 'https://ebay.com/itm/title/923456789012'
  }));

  assert.equal(collision.ok, false);
  assert.equal(collision.reason, 'duplicate_comp_draft');
  assert.equal(JSON.stringify(collision.store), before);
});

test('stored draft normalization filters malformed persisted authority entries', () => {
  const valid = ownerCompDraftStore.addDraft([], {
    listingId: 'active-1',
    identitySnapshot: identitySnapshot(),
    input: draftInput()
  });
  const malformed = {
    ...valid.draft,
    draftId: 'owner-comp-not-a-uuid',
    canonicalReady: true,
    productionAuthority: 'trusted'
  };

  const normalized = ownerCompDraftStore.normalizeStore([malformed, valid.draft, null, { draftId: 'partial' }]);
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].draftId, valid.draft.draftId);
  assert.equal(normalized[0].productionAuthority, 'none');
});
