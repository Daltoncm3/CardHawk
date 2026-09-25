'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const appStore = require('../utils/appStore');
const historyEngine = require('../engines/historyEngine');
const research = require('../services/researchOpportunityService');
const server = require('../server');

const NOW = '2026-09-25T16:00:00.000Z';

function authHeader(user = 'research-user', pass = 'research-pass') {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
}

function request(pathname, headers = {}, method = 'GET') {
  return new Promise((resolve, reject) => {
    const listener = server.app.listen(0, '127.0.0.1', () => {
      const { port } = listener.address();
      const req = http.request({
        hostname: '127.0.0.1',
        port,
        path: pathname,
        method,
        headers
      }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          listener.close(() => {
            let json = null;
            try {
              json = body ? JSON.parse(body) : null;
            } catch (_) {
              json = null;
            }
            resolve({ statusCode: res.statusCode, body, json });
          });
        });
      });

      req.on('error', (error) => {
        listener.close(() => reject(error));
      });
      req.end();
    });
  });
}

function tempHistory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cardhawk-research-opportunities-'));
  historyEngine.__setHistoryStorageForTests({
    historyFile: path.join(directory, 'listingHistory.json'),
    archiveDir: path.join(directory, 'history-archive')
  });
}

function parsed(overrides = {}) {
  const defaultFlags = {
    graded: true,
    autograph: false,
    numbered: false,
    refractor: true
  };
  const overrideFlags = overrides.flags || {};
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
    gradeCompany: 'PSA',
    grade: '10',
    rawOrGraded: 'graded',
    autograph: false,
    memorabilia: false,
    serialNumbered: false,
    ...overrides,
    flags: {
      ...defaultFlags,
      ...overrideFlags
    }
  };
}

function listing(id, overrides = {}) {
  const price = overrides.price ?? 80;
  const shipping = overrides.shipping ?? 5;
  return {
    ebayItemId: id,
    listingId: id,
    marketplace: 'ebay',
    lane: 'baseball',
    title: overrides.title || `2024 Topps Chrome Shohei Ohtani #17 Refractor PSA 10 ${id}`,
    price,
    shipping,
    totalCost: overrides.totalCost ?? Number(price) + Number(shipping),
    currency: 'USD',
    buyingOptions: overrides.buyingOptions || ['FIXED_PRICE'],
    itemCreationDate: overrides.itemCreationDate || '2026-09-24T16:00:00.000Z',
    itemEndDate: overrides.itemEndDate || null,
    url: overrides.url || `https://www.ebay.com/itm/${id}`,
    sellerUsername: overrides.sellerUsername || 'ResearchSeller',
    sellerFeedbackScore: 1200,
    sellerFeedbackPercentage: 99.5,
    parsed: overrides.parsed || parsed(),
    ...overrides
  };
}

function opportunityFor(listings, options = {}) {
  return research.buildResearchOpportunities(listings, {
    now: NOW,
    generatedAt: NOW,
    ...options
  });
}

test.beforeEach(() => {
  process.env.CARDHAWK_USER = 'research-user';
  process.env.CARDHAWK_PASS = 'research-pass';
  tempHistory();
  server.__setStoreForTest(appStore.createDefaultStore());
});

test.after(() => {
  historyEngine.__resetHistoryStorageForTests();
  server.__setStoreForTest(appStore.createDefaultStore());
});

test('undervalued-looking active listing is surfaced only as a research opportunity', () => {
  const report = opportunityFor([
    listing('target-low', { price: 65, shipping: 5, totalCost: 70 }),
    listing('peer-1', { price: 120, shipping: 5, totalCost: 125 }),
    listing('peer-2', { price: 130, shipping: 5, totalCost: 135 })
  ]);

  assert.equal(report.opportunityCount, 1);
  assert.equal(report.opportunities[0].listingId, 'target-low');
  assert.equal(report.opportunities[0].reasonCodes.includes('fixed_price_below_active_fixed_price_peers'), true);
  assert.equal(report.opportunities[0].activeMarketContext.activeAskingPriceOnly, true);
  assert.equal(report.opportunities[0].activeMarketContext.soldCompVerificationRequired, true);
  assert.equal(report.opportunities[0].status, 'research_opportunity');
  assert.equal(report.opportunities[0].authority.canonicalSoldEvidenceAuthority, 'none');
  assert.equal(report.opportunities[0].authority.valuationAuthority, 'none');
  assert.equal(report.opportunities[0].authority.dealGateAuthority, 'none');
  assert.equal(report.opportunities[0].authority.buyNowAuthority, 'none');
  assert.equal(report.diagnostics.soldPageVisited, false);
  assert.equal(report.diagnostics.canonicalSoldEvidenceMutated, false);
});

test('ending-soon auction and visible bid activity receive research-only explanations', () => {
  const report = opportunityFor([
    listing('auction-ending', {
      buyingOptions: ['AUCTION'],
      itemEndDate: '2026-09-25T18:00:00.000Z',
      bidCount: 4,
      raw: { bidCount: 4 }
    })
  ]);

  const opportunity = report.opportunities[0];
  assert.equal(opportunity.reasonCodes.includes('ending_soon_auction_research'), true);
  assert.equal(opportunity.reasonCodes.includes('auction_bid_activity_context'), true);
  assert.match(opportunity.explanations.map((item) => item.message).join(' '), /owner research/i);
  assert.doesNotMatch(JSON.stringify(opportunity), /BUY_NOW|approved deal|market value/i);
});

test('tracked price-drop opportunity uses stored history context', () => {
  const report = opportunityFor([
    listing('price-drop', { priceDrops: [{ amountDropped: 22, detectedAt: NOW }] })
  ]);

  assert.equal(report.opportunities[0].reasonCodes.includes('recent_price_reduction'), true);
});

test('ambiguous identity is downgraded and cannot claim an exact sold-items search', () => {
  const report = opportunityFor([
    listing('ambiguous', {
      title: 'Topps Chrome Refractor PSA 10',
      buyingOptions: ['AUCTION'],
      itemEndDate: '2026-09-25T18:00:00.000Z',
      bidCount: 3,
      raw: { bidCount: 3 },
      parsed: parsed({ subjectName: '', player: '', cardNumber: '', parallel: 'Refractor' })
    })
  ]);

  assert.equal(report.opportunities[0].identitySearchConfidence, 'insufficient_identity');
  assert.equal(report.opportunities[0].reasonCodes.includes('ambiguous_identity_review_required'), true);
  assert.equal(report.opportunities[0].missingMaterialFields.includes('subjectName'), true);
});

test('Chrome versus Platinum variants are not grouped as exact active peers', () => {
  const report = opportunityFor([
    listing('chrome-low', { price: 40, totalCost: 45, priceDrops: [{ amountDropped: 5, detectedAt: NOW }] }),
    listing('platinum-1', { price: 120, totalCost: 125, parsed: parsed({ product: 'Topps Platinum', setName: 'Topps Platinum' }) }),
    listing('platinum-2', { price: 130, totalCost: 135, parsed: parsed({ product: 'Topps Platinum', setName: 'Topps Platinum' }) })
  ]);

  const target = report.opportunities.find((item) => item.listingId === 'chrome-low');
  assert.equal(target.reasonCodes.includes('fixed_price_below_active_fixed_price_peers'), false);
  assert.equal(target.activeMarketContext.peerCount, 0);
});

test('parallel, serial-number, and raw-versus-graded mismatches are not exact active peers', () => {
  const report = opportunityFor([
    listing('silver-low', { price: 40, totalCost: 45, priceDrops: [{ amountDropped: 5, detectedAt: NOW }] }),
    listing('gold-peer', { price: 120, totalCost: 125, parsed: parsed({ parallel: 'Gold' }) }),
    listing('serial-peer', { price: 130, totalCost: 135, parsed: parsed({ parallel: 'Refractor', numberedTo: 25, serialNumbered: true, flags: { graded: true, numbered: true, autograph: false } }) }),
    listing('raw-peer', {
      title: '2024 Topps Chrome Shohei Ohtani #17 Refractor Raw',
      price: 140,
      totalCost: 145,
      parsed: parsed({ gradeCompany: '', grade: '', flags: {}, raw: true })
    })
  ]);

  const target = report.opportunities.find((item) => item.listingId === 'silver-low');
  assert.equal(target.reasonCodes.includes('fixed_price_below_active_fixed_price_peers'), false);
  assert.equal(target.activeMarketContext.peerCount, 0);
});

test('year, card number, autograph, memorabilia, grader, and grade mismatches are not exact active peers', () => {
  const report = opportunityFor([
    listing('identity-low', { price: 40, totalCost: 45, priceDrops: [{ amountDropped: 5, detectedAt: NOW }] }),
    listing('year-peer', { price: 120, totalCost: 125, parsed: parsed({ year: 2023 }) }),
    listing('number-peer', { price: 130, totalCost: 135, parsed: parsed({ cardNumber: '18' }) }),
    listing('auto-peer', { price: 140, totalCost: 145, parsed: parsed({ autograph: true, flags: { autograph: true } }) }),
    listing('memo-peer', { price: 150, totalCost: 155, parsed: parsed({ memorabilia: true }) }),
    listing('grader-peer', { price: 160, totalCost: 165, parsed: parsed({ gradeCompany: 'SGC' }) }),
    listing('grade-peer', { price: 170, totalCost: 175, parsed: parsed({ grade: '9' }) })
  ]);

  const target = report.opportunities.find((item) => item.listingId === 'identity-low');
  assert.equal(target.reasonCodes.includes('fixed_price_below_active_fixed_price_peers'), false);
  assert.equal(target.activeMarketContext.peerCount, 0);
});

test('active peer anomaly requires two distinct fixed-price peers with matching currency', () => {
  const onePeer = opportunityFor([
    listing('one-peer-target', { price: 40, totalCost: 45, priceDrops: [{ amountDropped: 5, detectedAt: NOW }] }),
    listing('one-peer-peer', { price: 120, totalCost: 125 })
  ]).opportunities.find((item) => item.listingId === 'one-peer-target');

  assert.equal(onePeer.reasonCodes.includes('fixed_price_below_active_fixed_price_peers'), false);
  assert.equal(onePeer.activeMarketContext.peerCount, 1);

  const duplicatePeers = opportunityFor([
    listing('duplicate-target', { price: 40, totalCost: 45, priceDrops: [{ amountDropped: 5, detectedAt: NOW }] }),
    listing('same-peer', { price: 120, totalCost: 125 }),
    listing('same-peer', { price: 130, totalCost: 135 })
  ]).opportunities.find((item) => item.listingId === 'duplicate-target');

  assert.equal(duplicatePeers.reasonCodes.includes('fixed_price_below_active_fixed_price_peers'), false);
  assert.equal(duplicatePeers.activeMarketContext.peerCount, 1);

  const currencyMismatch = opportunityFor([
    listing('currency-target', { price: 40, totalCost: 45, currency: 'USD', priceDrops: [{ amountDropped: 5, detectedAt: NOW }] }),
    listing('currency-peer-1', { price: 120, totalCost: 125, currency: 'CAD' }),
    listing('currency-peer-2', { price: 130, totalCost: 135, currency: 'CAD' })
  ]).opportunities.find((item) => item.listingId === 'currency-target');

  assert.equal(currencyMismatch.reasonCodes.includes('fixed_price_below_active_fixed_price_peers'), false);
  assert.equal(currencyMismatch.activeMarketContext.peerCount, 0);
});

test('auction current bids are separated from fixed-price peer anomalies', () => {
  const report = opportunityFor([
    listing('auction-low', {
      buyingOptions: ['AUCTION'],
      price: 5,
      shipping: 0,
      totalCost: 5,
      itemEndDate: '2026-09-25T18:00:00.000Z',
      bidCount: 2
    }),
    listing('auction-fixed-peer-1', { price: 120, totalCost: 125 }),
    listing('auction-fixed-peer-2', { price: 130, totalCost: 135 })
  ]);

  const target = report.opportunities.find((item) => item.listingId === 'auction-low');
  assert.equal(target.reasonCodes.includes('fixed_price_below_active_fixed_price_peers'), false);
  assert.equal(target.reasonCodes.includes('ending_soon_auction_research'), true);
  assert.equal(target.reasonCodes.includes('auction_bid_activity_context'), true);
  assert.equal(target.listingType, 'auction_current_non_final');
  assert.equal(target.timingContext.auctionBidFinal, false);
});

test('expired listings are excluded and malformed timestamps do not create time signals', () => {
  const expired = opportunityFor([
    listing('expired', {
      buyingOptions: ['AUCTION'],
      itemEndDate: '2026-09-25T15:00:00.000Z',
      bidCount: 6
    })
  ]);

  assert.equal(expired.opportunityCount, 0);

  const malformed = opportunityFor([
    listing('malformed-time', {
      buyingOptions: ['AUCTION'],
      itemEndDate: 'not-a-date',
      bidCount: 6,
      priceDrops: [{ amountDropped: 5, detectedAt: NOW }]
    })
  ]);

  const target = malformed.opportunities[0];
  assert.equal(target.reasonCodes.includes('ending_soon_auction_research'), false);
  assert.equal(target.reasonCodes.includes('auction_bid_activity_context'), true);
  assert.equal(target.timingContext.endingSoonHours, null);
});

test('malformed or zero prices fail closed without creating research opportunities', () => {
  const report = opportunityFor([
    listing('bad-price', { price: 'free', shipping: 0, totalCost: 0 }),
    listing('zero-price', { price: 0, shipping: 0, totalCost: 0 })
  ]);

  assert.equal(report.opportunityCount, 0);
});

test('weak title, newness, and seller context alone do not create high-priority opportunities', () => {
  const report = opportunityFor([
    listing('weak-only', {
      title: 'Ohtani',
      itemCreationDate: '2026-09-25T15:00:00.000Z',
      sellerUsername: 'VisibleSeller',
      parsed: parsed({ subjectName: '', player: '', cardNumber: '' })
    })
  ]);

  assert.equal(report.opportunityCount, 0);
});

test('bounded deterministic input selection and 25-result output cap are enforced', () => {
  const listings = [];
  for (let index = 0; index < research.MAX_INPUT_LISTINGS + 10; index += 1) {
    listings.push(listing(`bounded-${String(index).padStart(3, '0')}`, {
      price: 50 + index,
      totalCost: 55 + index,
      itemCreationDate: `2026-09-24T${String(index % 24).padStart(2, '0')}:00:00.000Z`,
      priceDrops: [{ amountDropped: 5, detectedAt: NOW }]
    }));
  }

  const first = opportunityFor(listings, { limit: 50 });
  const second = opportunityFor(listings, { limit: 50 });

  assert.equal(first.diagnostics.processedListingCount, research.MAX_INPUT_LISTINGS);
  assert.equal(first.diagnostics.inputTruncated, true);
  assert.equal(first.diagnostics.droppedListingCount, 10);
  assert.equal(first.opportunities.length, research.MAX_OPPORTUNITIES);
  assert.deepEqual(first.opportunities.map((item) => item.listingId), second.opportunities.map((item) => item.listingId));
  assert.equal(first.opportunities.every((item) => item.researchScore >= 0 && item.researchScore <= 100), true);
});

test('sold-items URL is exact, encoded, and never fetched', () => {
  const originalFetch = global.fetch;
  let fetchCount = 0;
  global.fetch = async () => {
    fetchCount += 1;
    throw new Error('sold-page request should not occur');
  };

  try {
    const url = research.buildSoldItemsResearchUrl(listing('url-test', {
      parsed: parsed({
        subjectName: 'Victor Wembanyama',
        player: 'Victor Wembanyama',
        product: 'Prizm Draft Picks',
        setName: 'Prizm Draft Picks',
        cardNumber: 'SS-1',
        parallel: 'Blue Ice',
        autograph: true,
        flags: { graded: true, autograph: true, rookie: true, numbered: true },
        numberedTo: 25
      })
    }));

    assert.match(url, /^https:\/\/www\.ebay\.com\/sch\/i\.html\?/);
    assert.match(url, /LH_Sold=1/);
    assert.match(url, /LH_Complete=1/);
    assert.match(url, /%23ss-1/i);
    assert.match(decodeURIComponent(url).replace(/\+/g, ' '), /2024 topps prizm draft picks victor wembanyama #ss-1 blue ice \/25 autograph rookie psa 10/i);
    assert.equal(fetchCount, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

test('hostile titles and URLs are sanitized in service output and escaped in dashboard HTML', async () => {
  const nextStore = appStore.createDefaultStore();
  nextStore.listings['hostile'] = listing('hostile', {
    title: '<script>alert("x")</script> " onclick="alert(1)',
    url: 'javascript:alert(1)',
    priceDrops: [{ amountDropped: 20, detectedAt: NOW }]
  });
  nextStore.listings['hostile-peer-1'] = listing('hostile-peer-1', { price: 120, totalCost: 125 });
  nextStore.listings['hostile-peer-2'] = listing('hostile-peer-2', { price: 130, totalCost: 135 });
  server.__setStoreForTest(nextStore);

  const api = await request('/api/research-opportunities?lane=baseball', { Authorization: authHeader() });
  const hostile = api.json.opportunities.find((item) => item.listingId === 'hostile');
  assert.equal(hostile.listingUrl, '');
  assert.equal(hostile.title.includes('<script>'), true);

  const page = await request('/research?lane=baseball', { Authorization: authHeader() });
  assert.equal(page.statusCode, 200);
  assert.doesNotMatch(page.body, /<script>alert/);
  assert.match(page.body, /&lt;script&gt;alert/);
  assert.doesNotMatch(page.body, /javascript:alert/);
  assert.match(page.body, /rel="noopener noreferrer"/);
});

test('javascript, data, malformed, and quote-breaking listing URLs are rejected', () => {
  for (const [id, url] of [
    ['js-url', 'javascript:alert(1)'],
    ['data-url', 'data:text/html,<script>alert(1)</script>'],
    ['broken-url', 'https://www.ebay.com.evil.test/itm/1'],
    ['quote-url', 'https://www.ebay.com/itm/1" onclick="alert(1)']
  ]) {
    const report = opportunityFor([
      listing(id, { url, priceDrops: [{ amountDropped: 10, detectedAt: NOW }] })
    ]);
    assert.equal(report.opportunities[0].listingUrl, '');
  }
});

test('Sold Items URL destination and flags cannot be overridden by stored input', () => {
  const url = research.buildSoldItemsResearchUrl({
    ...listing('override-url'),
    subjectName: 'https://evil.example/?LH_Sold=0',
    product: 'Chrome',
    year: '2024'
  });
  const parsedUrl = new URL(url);

  assert.equal(parsedUrl.protocol, 'https:');
  assert.equal(parsedUrl.hostname, 'www.ebay.com');
  assert.equal(parsedUrl.pathname, '/sch/i.html');
  assert.equal(parsedUrl.searchParams.get('LH_Sold'), '1');
  assert.equal(parsedUrl.searchParams.get('LH_Complete'), '1');
});

test('research service is deterministic and does not mutate canonical or Deal Gate state', () => {
  const listings = [
    listing('stable-low', { price: 65, totalCost: 70 }),
    listing('stable-peer-1', { price: 120, totalCost: 125 }),
    listing('stable-peer-2', { price: 130, totalCost: 135 })
  ];
  const protectedState = {
    canonicalSoldEvidence: [{ id: 'sold-1', price: 120 }],
    dealGate: { passed: false, buyNowAllowed: false },
    alerts: []
  };
  const before = JSON.stringify({ listings, protectedState });

  const first = opportunityFor(listings);
  const second = opportunityFor(listings);
  const after = JSON.stringify({ listings, protectedState });

  assert.equal(after, before);
  assert.deepEqual(first.opportunities, second.opportunities);
  assert.equal(first.authority.alertAuthority, 'none');
  assert.equal(first.authority.marketplaceExecutionAuthority, 'none');
});

test('dashboard and API expose Research Opportunities behind existing route authorization', async () => {
  const nextStore = appStore.createDefaultStore();
  [
    listing('route-low', { price: 65, totalCost: 70 }),
    listing('route-peer-1', { price: 120, totalCost: 125 }),
    listing('route-peer-2', { price: 130, totalCost: 135 })
  ].forEach((item) => {
    nextStore.listings[item.ebayItemId] = item;
  });
  server.__setStoreForTest(nextStore);

  const unauthorized = await request('/research');
  assert.equal(unauthorized.statusCode, 401);
  assert.match(unauthorized.body, /Login required/);

  const unauthorizedApi = await request('/api/research-opportunities?lane=baseball');
  assert.equal(unauthorizedApi.statusCode, 401);

  const page = await request('/research', { Authorization: authHeader() });
  assert.equal(page.statusCode, 200);
  assert.match(page.body, /Research Opportunities/);
  assert.match(page.body, /sold-comp verification required/i);
  assert.doesNotMatch(page.body, /approved deal/i);

  const api = await request('/api/research-opportunities?lane=baseball', { Authorization: authHeader() });
  assert.equal(api.statusCode, 200);
  assert.equal(api.json.source, research.SOURCE);
  assert.equal(api.json.opportunities[0].listingId, 'route-low');
  assert.equal(api.json.diagnostics.soldPageVisited, false);
  assert.equal(api.json.diagnostics.alertsCreated, false);
  assert.equal(Object.hasOwn(api.json, 'fingerprint'), false);
  assert.equal(Object.hasOwn(api.json.opportunities[0], 'fingerprint'), false);
});

test('unsupported HTTP methods do not invoke research routes', async () => {
  const nextStore = appStore.createDefaultStore();
  nextStore.listings['method-low'] = listing('method-low', { priceDrops: [{ amountDropped: 20, detectedAt: NOW }] });
  server.__setStoreForTest(nextStore);
  const before = JSON.stringify(server.__getStoreForTest());

  const response = await request('/api/research-opportunities?lane=baseball', { Authorization: authHeader() }, 'POST');
  const after = JSON.stringify(server.__getStoreForTest());

  assert.equal(response.statusCode, 404);
  assert.equal(after, before);
});

test('existing scanner behavior remains free of research opportunity wiring', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'services', 'scoutScannerService.js'), 'utf8');

  assert.equal(source.includes('researchOpportunity'), false);
  assert.equal(source.includes('Research Opportunities'), false);
});
