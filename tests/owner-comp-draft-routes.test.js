'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const appStore = require('../utils/appStore');
const server = require('../server');

const originalSaveStore = appStore.saveStore;
const originalFetch = global.fetch;

function authHeader(user = 'comp-user', pass = 'comp-pass') {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
}

function request(pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const listener = server.app.listen(0, '127.0.0.1', () => {
      const { port } = listener.address();
      const body = options.body ? new URLSearchParams(options.body).toString() : '';
      const headers = {
        ...(options.headers || {})
      };
      if (body) {
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
        headers['Content-Length'] = Buffer.byteLength(body);
      }
      const req = http.request({
        hostname: '127.0.0.1',
        port,
        path: pathname,
        method: options.method || 'GET',
        headers
      }, (res) => {
        let responseBody = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          responseBody += chunk;
        });
        res.on('end', () => {
          listener.close(() => {
            resolve({
              statusCode: res.statusCode,
              headers: res.headers,
              body: responseBody
            });
          });
        });
      });
      req.on('error', (error) => {
        listener.close(() => reject(error));
      });
      req.end(body);
    });
  });
}

function parsedIdentity(overrides = {}) {
  return {
    sport: 'baseball',
    subjectName: 'Shohei Ohtani',
    player: 'Shohei Ohtani',
    year: 2024,
    manufacturer: 'Topps',
    product: 'Topps Chrome',
    setName: 'Topps Chrome',
    cardNumber: '17',
    parallel: 'Refractor',
    rawOrGraded: 'graded',
    gradeCompany: 'PSA',
    grade: '10',
    autograph: false,
    memorabilia: false,
    serialNumbered: false,
    flags: {
      graded: true,
      autograph: false,
      numbered: false,
      refractor: true
    },
    ...overrides
  };
}

function listing(id, overrides = {}) {
  return {
    ebayItemId: id,
    listingId: id,
    marketplace: 'ebay',
    lane: 'baseball',
    title: `2024 Topps Chrome Shohei Ohtani #17 Refractor PSA 10 ${id}`,
    price: 80,
    shipping: 5,
    totalCost: 85,
    currency: 'USD',
    buyingOptions: ['FIXED_PRICE'],
    itemCreationDate: '2026-09-24T16:00:00.000Z',
    itemEndDate: null,
    url: `https://www.ebay.com/itm/${id}`,
    sellerUsername: 'CompSeller',
    parsed: parsedIdentity(),
    ...overrides
  };
}

function setStoreWithListings(listings = []) {
  const nextStore = appStore.createDefaultStore();
  listings.forEach((item) => {
    nextStore.listings[item.ebayItemId] = item;
  });
  server.__setStoreForTest(nextStore);
  return nextStore;
}

function validDraft(overrides = {}) {
  return {
    sourceMarketplace: 'ebay',
    sourceSoldListingUrl: 'https://www.ebay.com/itm/123456789012',
    displayedSoldPrice: '125.50',
    shippingAmount: '4.99',
    currency: 'USD',
    saleDate: '2026-09-20',
    listingType: 'fixed_price',
    rawOrGraded: 'graded',
    gradeCompany: 'PSA',
    grade: '10',
    identityMatchDecision: 'exact_match',
    finalPriceCertainty: 'confirmed_final_price',
    ownerReasonCode: 'exact_visual_match',
    ownerNotesCategory: 'owner confirmed visual match',
    reviewStatus: 'needs_more_evidence',
    ...overrides
  };
}

function extractCsrf(body) {
  const match = String(body || '').match(/name="csrfToken" value="([a-f0-9]{64})"/i);
  assert.ok(match, 'expected CSRF token in authenticated owner comp page');
  return match[1];
}

async function csrfFor(listingId) {
  const page = await request(`/research/${encodeURIComponent(listingId)}/comp-drafts`, {
    headers: { Authorization: authHeader() }
  });
  assert.equal(page.statusCode, 200);
  return extractCsrf(page.body);
}

test.beforeEach(() => {
  process.env.CARDHAWK_USER = 'comp-user';
  process.env.CARDHAWK_PASS = 'comp-pass';
  server.__setStoreForTest(appStore.createDefaultStore());
  appStore.saveStore = () => ({ ok: true, skipped: true });
  global.fetch = async () => {
    throw new Error('network calls are not allowed in owner comp draft tests');
  };
});

test.afterEach(() => {
  appStore.saveStore = originalSaveStore;
  global.fetch = originalFetch;
  server.__setStoreForTest(appStore.createDefaultStore());
});

test('owner comp draft routes require existing owner authentication and reject unsafe methods', async () => {
  setStoreWithListings([listing('active-auth')]);

  const unauthenticated = await request('/research/active-auth/comp-drafts');
  const authenticated = await request('/research/active-auth/comp-drafts', {
    headers: { Authorization: authHeader() }
  });
  const unsafeGet = await request('/research/active-auth/comp-drafts/draft-1/delete', {
    headers: { Authorization: authHeader() }
  });
  const missingCsrf = await request('/research/active-auth/comp-drafts', {
    method: 'POST',
    headers: { Authorization: authHeader() },
    body: validDraft()
  });
  const invalidCsrf = await request('/research/active-auth/comp-drafts', {
    method: 'POST',
    headers: { Authorization: authHeader() },
    body: validDraft({ csrfToken: '0'.repeat(64) })
  });

  assert.equal(unauthenticated.statusCode, 401);
  assert.match(unauthenticated.body, /Login required/);
  assert.equal(authenticated.statusCode, 200);
  assert.match(authenticated.body, /Owner-reviewed comp drafts/);
  assert.equal(unsafeGet.statusCode, 405);
  assert.equal(unsafeGet.headers.allow, 'POST');
  assert.equal(missingCsrf.statusCode, 403);
  assert.match(missingCsrf.body, /invalid_csrf_token/);
  assert.equal(invalidCsrf.statusCode, 403);
});

test('owner can add, edit, status-update, and delete a comp draft without creating canonical evidence', async () => {
  setStoreWithListings([listing('active-flow')]);
  const csrfToken = await csrfFor('active-flow');

  const add = await request('/research/active-flow/comp-drafts', {
    method: 'POST',
    headers: { Authorization: authHeader() },
    body: validDraft({ csrfToken })
  });
  assert.equal(add.statusCode, 302);

  let currentStore = server.__getStoreForTest();
  assert.equal(currentStore.ownerCompDrafts.length, 1);
  assert.equal(currentStore.ownerCompDrafts[0].canonicalSoldEvidenceStatus, 'not_canonical_sold_evidence');
  assert.equal(currentStore.ownerCompDrafts[0].productionAuthority, 'none');
  assert.equal(currentStore.alerts.length, 0);
  assert.equal(currentStore.scans.length, 0);
  const draftId = currentStore.ownerCompDrafts[0].draftId;

  const edit = await request(`/research/active-flow/comp-drafts/${draftId}`, {
    method: 'POST',
    headers: { Authorization: authHeader() },
    body: validDraft({
      csrfToken,
      displayedSoldPrice: '130.00',
      ownerNotesCategory: 'updated category'
    })
  });
  assert.equal(edit.statusCode, 302);
  currentStore = server.__getStoreForTest();
  assert.equal(currentStore.ownerCompDrafts[0].displayedSoldPrice, 130);
  assert.equal(currentStore.ownerCompDrafts[0].ownerNotesCategory, 'updated category');

  const status = await request(`/research/active-flow/comp-drafts/${draftId}/status`, {
    method: 'POST',
    headers: { Authorization: authHeader() },
    body: { csrfToken, reviewStatus: 'reviewed' }
  });
  assert.equal(status.statusCode, 302);
  currentStore = server.__getStoreForTest();
  assert.equal(currentStore.ownerCompDrafts[0].reviewStatus, 'reviewed');

  const remove = await request(`/research/active-flow/comp-drafts/${draftId}/delete`, {
    method: 'POST',
    headers: { Authorization: authHeader() },
    body: { csrfToken }
  });
  assert.equal(remove.statusCode, 302);
  assert.equal(server.__getStoreForTest().ownerCompDrafts.length, 0);
});

test('browser-submitted binding and identity fields are ignored in favor of server-derived listing identity', async () => {
  setStoreWithListings([listing('active-binding')]);
  const csrfToken = await csrfFor('active-binding');

  const response = await request('/research/active-binding/comp-drafts', {
    method: 'POST',
    headers: { Authorization: authHeader() },
    body: validDraft({
      csrfToken,
      listingId: 'malicious-listing',
      draftId: 'malicious-draft',
      identityFingerprint: 'malicious-fingerprint',
      identitySnapshot: '{"subjectName":"Wrong Player"}',
      canonicalSoldEvidenceStatus: 'canonical_ready',
      productionAuthority: 'trusted',
      priceConfirmed: 'true',
      sourceSoldListingUrl: 'https://www.ebay.com/itm/223456789012'
    })
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.body, /dangerous_object_key|unsupported_field/);
  const safe = await request('/research/active-binding/comp-drafts', {
    method: 'POST',
    headers: { Authorization: authHeader() },
    body: validDraft({
      csrfToken,
      sourceSoldListingUrl: 'https://www.ebay.com/itm/223456789012'
    })
  });
  assert.equal(safe.statusCode, 302);
  const [draft] = server.__getStoreForTest().ownerCompDrafts;
  assert.equal(draft.listingId, 'active-binding');
  assert.notEqual(draft.draftId, 'malicious-draft');
  assert.notEqual(draft.identityFingerprint, 'malicious-fingerprint');
  assert.equal(draft.identitySnapshot.fields.subjectName, 'shohei ohtani');
  assert.equal(draft.identitySnapshot.fields.cardNumber, '17');
});

test('drafts cannot be modified through another listing route', async () => {
  setStoreWithListings([listing('active-a'), listing('active-b')]);
  const csrfToken = await csrfFor('active-a');

  const add = await request('/research/active-a/comp-drafts', {
    method: 'POST',
    headers: { Authorization: authHeader() },
    body: validDraft({ csrfToken })
  });
  assert.equal(add.statusCode, 302);
  const draftId = server.__getStoreForTest().ownerCompDrafts[0].draftId;

  const crossListingEdit = await request(`/research/active-b/comp-drafts/${draftId}`, {
    method: 'POST',
    headers: { Authorization: authHeader() },
    body: validDraft({ csrfToken, sourceSoldListingUrl: 'https://www.ebay.com/itm/323456789012' })
  });
  const crossListingDelete = await request(`/research/active-b/comp-drafts/${draftId}/delete`, {
    method: 'POST',
    headers: { Authorization: authHeader() },
    body: { csrfToken }
  });

  assert.equal(crossListingEdit.statusCode, 404);
  assert.equal(crossListingDelete.statusCode, 404);
  assert.equal(server.__getStoreForTest().ownerCompDrafts.length, 1);
});

test('hostile form input is rejected or escaped and never triggers sold-page access', async () => {
  setStoreWithListings([
    listing('active-xss', {
      title: `2024 Topps Chrome <script>alert("x")</script> Shohei`
    })
  ]);

  const page = await request('/research/active-xss/comp-drafts', {
    headers: { Authorization: authHeader() }
  });
  const csrfToken = extractCsrf(page.body);
  assert.equal(page.statusCode, 200);
  assert.match(page.body, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
  assert.doesNotMatch(page.body, /<script>alert/);

  const maliciousUrl = await request('/research/active-xss/comp-drafts', {
    method: 'POST',
    headers: { Authorization: authHeader() },
    body: validDraft({
      csrfToken,
      sourceSoldListingUrl: 'data:text/html,<script>alert(1)</script>'
    })
  });
  assert.equal(maliciousUrl.statusCode, 400);
  assert.match(maliciousUrl.body, /invalid_source_url/);

  const dangerousKey = await request('/research/active-xss/comp-drafts', {
    method: 'POST',
    headers: { Authorization: authHeader() },
    body: {
      ...validDraft({ csrfToken, sourceSoldListingUrl: 'https://www.ebay.com/itm/423456789012' }),
      constructor: 'pollute'
    }
  });
  assert.equal(dangerousKey.statusCode, 400);
  assert.match(dangerousKey.body, /dangerous_object_key/);
  assert.equal({}.pollute, undefined);
});

test('Best Offer and uncertain owner comps remain separate provisional drafts', async () => {
  setStoreWithListings([listing('active-best-offer')]);
  const csrfToken = await csrfFor('active-best-offer');

  const bestOffer = await request('/research/active-best-offer/comp-drafts', {
    method: 'POST',
    headers: { Authorization: authHeader() },
    body: validDraft({
      csrfToken,
      sourceSoldListingUrl: 'https://www.ebay.com/itm/523456789012',
      listingType: 'best_offer',
      finalPriceCertainty: 'displayed_price_may_not_equal_accepted_best_offer'
    })
  });
  const estimated = await request('/research/active-best-offer/comp-drafts', {
    method: 'POST',
    headers: { Authorization: authHeader() },
    body: validDraft({
      csrfToken,
      sourceSoldListingUrl: 'https://www.ebay.com/itm/623456789012',
      finalPriceCertainty: 'estimated_or_unknown'
    })
  });

  assert.equal(bestOffer.statusCode, 302);
  assert.equal(estimated.statusCode, 302);
  const statuses = server.__getStoreForTest().ownerCompDrafts.map((draft) => draft.priceEvidenceStatus).sort();
  assert.deepEqual(statuses, [
    'provisional_best_offer_or_uncertain',
    'provisional_estimated_or_unknown'
  ]);

  const conflictingBestOffer = await request('/research/active-best-offer/comp-drafts', {
    method: 'POST',
    headers: { Authorization: authHeader() },
    body: validDraft({
      csrfToken,
      sourceSoldListingUrl: 'https://www.ebay.com/itm/723456789012',
      listingType: 'best_offer',
      finalPriceCertainty: 'confirmed_final_price'
    })
  });
  assert.equal(conflictingBestOffer.statusCode, 400);
  assert.match(conflictingBestOffer.body, /best_offer_final_price_unconfirmed/);
});

test('duplicate comp drafts fail closed without mutating other stores or making provider requests', async () => {
  let fetchCount = 0;
  global.fetch = async () => {
    fetchCount += 1;
    throw new Error('unexpected fetch');
  };
  setStoreWithListings([listing('active-duplicate')]);
  const csrfToken = await csrfFor('active-duplicate');

  const first = await request('/research/active-duplicate/comp-drafts', {
    method: 'POST',
    headers: { Authorization: authHeader() },
    body: validDraft({ csrfToken, sourceSoldListingUrl: 'https://www.ebay.com/itm/823456789012?mkcid=tracking' })
  });
  const duplicate = await request('/research/active-duplicate/comp-drafts', {
    method: 'POST',
    headers: { Authorization: authHeader() },
    body: validDraft({ csrfToken, sourceSoldListingUrl: 'https://ebay.com/itm/title/823456789012' })
  });

  const currentStore = server.__getStoreForTest();
  assert.equal(first.statusCode, 302);
  assert.equal(duplicate.statusCode, 400);
  assert.match(duplicate.body, /duplicate_comp_draft/);
  assert.equal(currentStore.ownerCompDrafts.length, 1);
  assert.equal(currentStore.alerts.length, 0);
  assert.equal(currentStore.rejections.length, 0);
  assert.equal(currentStore.scans.length, 0);
  assert.equal(fetchCount, 0);
});

test('persistence failure leaves in-memory owner comp drafts unchanged with sanitized error', async () => {
  setStoreWithListings([listing('active-persist')]);
  const csrfToken = await csrfFor('active-persist');
  appStore.saveStore = () => {
    throw new Error('/private/path/cardhawk-data.json exploded with raw input');
  };

  const response = await request('/research/active-persist/comp-drafts', {
    method: 'POST',
    headers: { Authorization: authHeader() },
    body: validDraft({ csrfToken, sourceSoldListingUrl: 'https://www.ebay.com/itm/923456789012' })
  });

  assert.equal(response.statusCode, 500);
  assert.match(response.body, /owner_comp_draft_persistence_failed/);
  assert.doesNotMatch(response.body, /private\/path|raw input|cardhawk-data/);
  assert.equal(server.__getStoreForTest().ownerCompDrafts.length, 0);
});

test('serialized concurrent owner comp writes preserve both successful drafts', async () => {
  setStoreWithListings([listing('active-concurrent')]);
  const csrfToken = await csrfFor('active-concurrent');
  const responses = await Promise.all([
    request('/research/active-concurrent/comp-drafts', {
      method: 'POST',
      headers: { Authorization: authHeader() },
      body: validDraft({ csrfToken, sourceSoldListingUrl: 'https://www.ebay.com/itm/133456789012' })
    }),
    request('/research/active-concurrent/comp-drafts', {
      method: 'POST',
      headers: { Authorization: authHeader() },
      body: validDraft({ csrfToken, sourceSoldListingUrl: 'https://www.ebay.com/itm/143456789012' })
    })
  ]);

  assert.deepEqual(responses.map((response) => response.statusCode).sort(), [302, 302]);
  assert.equal(server.__getStoreForTest().ownerCompDrafts.length, 2);
});

test('stale listing drafts remain manageable while new stale-listing drafts are blocked', async () => {
  setStoreWithListings([listing('active-stale')]);
  const csrfToken = await csrfFor('active-stale');
  const add = await request('/research/active-stale/comp-drafts', {
    method: 'POST',
    headers: { Authorization: authHeader() },
    body: validDraft({ csrfToken, sourceSoldListingUrl: 'https://www.ebay.com/itm/153456789012' })
  });
  assert.equal(add.statusCode, 302);
  const draft = server.__getStoreForTest().ownerCompDrafts[0];
  server.__setStoreForTest({
    ...appStore.createDefaultStore(),
    ownerCompDrafts: [draft]
  });

  const stalePage = await request('/research/active-stale/comp-drafts', {
    headers: { Authorization: authHeader() }
  });
  assert.equal(stalePage.statusCode, 200);
  assert.match(stalePage.body, /Stored listing unavailable/);
  assert.match(stalePage.body, /new drafts cannot be added/);

  const staleCsrf = extractCsrf(stalePage.body);
  const staleEdit = await request(`/research/active-stale/comp-drafts/${draft.draftId}`, {
    method: 'POST',
    headers: { Authorization: authHeader() },
    body: validDraft({ csrfToken: staleCsrf, sourceSoldListingUrl: 'https://www.ebay.com/itm/163456789012' })
  });
  assert.equal(staleEdit.statusCode, 302);

  const guessed = await request('/research/guessed-listing/comp-drafts', {
    method: 'POST',
    headers: { Authorization: authHeader() },
    body: validDraft({ csrfToken: staleCsrf, sourceSoldListingUrl: 'https://www.ebay.com/itm/173456789012' })
  });
  assert.equal(guessed.statusCode, 404);
});

test('expired stored listing cannot create a new owner comp draft', async () => {
  setStoreWithListings([listing('active-expired', {
    itemEndDate: '2020-01-01T00:00:00.000Z'
  })]);
  const page = await request('/research/active-expired/comp-drafts', {
    headers: { Authorization: authHeader() }
  });
  assert.equal(page.statusCode, 200);
  const response = await request('/research/active-expired/comp-drafts', {
    method: 'POST',
    headers: { Authorization: authHeader() },
    body: validDraft({ sourceSoldListingUrl: 'https://www.ebay.com/itm/183456789012' })
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.body, /listing_not_eligible_for_new_comp_draft/);
});
