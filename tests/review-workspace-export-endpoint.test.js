'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const appStore = require('../utils/appStore');
const server = require('../server');
const exporter = require('../validation/exportReviewWorkspaceBatch');

function authHeader(user = 'endpoint-user', pass = 'endpoint-pass') {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
}

function request(path, headers = {}) {
  return new Promise((resolve, reject) => {
    const listener = server.app.listen(0, '127.0.0.1', () => {
      const { port } = listener.address();
      const req = http.request({
        hostname: '127.0.0.1',
        port,
        path,
        method: 'GET',
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
            resolve({
              statusCode: res.statusCode,
              headers: res.headers,
              body,
              json
            });
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

function buildListing(id, overrides = {}) {
  const price = overrides.price ?? 75;
  const estimatedValue = overrides.estimatedValue ?? 115;
  const estimatedProfit = estimatedValue - price;

  return {
    ebayItemId: id,
    itemId: id,
    title: overrides.title || `2020 Panini Prizm Joe Burrow RC #307 PSA 10 ${id}`,
    price,
    shipping: overrides.shipping ?? 0,
    totalCost: price,
    estimatedValue,
    marketValue: estimatedValue,
    estimatedProfit,
    roi: estimatedProfit / price,
    score: overrides.score ?? 72,
    investmentQuality: overrides.investmentQuality ?? 76,
    qualityBucket: overrides.qualityBucket || 'Good Flip Candidate',
    dealGate: overrides.dealGate || {
      passed: overrides.dealGatePassed ?? true,
      buyNowAllowed: overrides.buyNowAllowed ?? false,
      decision: overrides.decision || 'REVIEW',
      reasons: overrides.reasons || [],
      positives: overrides.positives || ['Fixture context only.']
    },
    productionDecisionExplanation: {
      primaryExplanation: 'Fixture production explanation.'
    },
    marketData: {
      marketValue: estimatedValue,
      confidence: overrides.valuationConfidence ?? 70
    },
    canonicalIdentity: {
      canonicalIdentityKey: `ci:v1:test:${id}`,
      eligibility: {
        exactCompEligible: true,
        valuationEligible: true,
        manualReviewRequired: false,
        contextOnly: false
      },
      overallIdentityConfidence: 94,
      unknownFields: [],
      normalizationWarnings: []
    },
    canonicalSoldEvidence: {
      trueSoldCount: overrides.trueSoldCount ?? 4,
      recentSoldCount: overrides.trueSoldCount ?? 4,
      records: []
    },
    shadowSoldComparison: {
      acceptedExactMatches: [],
      contextualMatches: [],
      rejectedMatches: [],
      staleMatches: [],
      insufficientIdentityMatches: [],
      processingSummary: { exactMatchCount: overrides.trueSoldCount ?? 4 }
    },
    shadowValuation: {
      insufficientEvidence: false,
      recommendedMarketValue: estimatedValue,
      fairMarketRange: {
        floorValue: estimatedValue - 10,
        expectedValue: estimatedValue,
        ceilingValue: estimatedValue + 10
      },
      valuationConfidence: 75,
      evidenceSummary: { exactMatchCount: overrides.trueSoldCount ?? 4 }
    },
    daltonReview: overrides.daltonReview || undefined
  };
}

function setStoreWithListings(listings = []) {
  const nextStore = appStore.createDefaultStore();
  listings.forEach((listing, index) => {
    nextStore.listings[listing.storeKey || listing.ebayItemId || listing.itemId || `listing-${index}`] = listing;
  });
  server.__setStoreForTest(nextStore);
  return nextStore;
}

test.beforeEach(() => {
  process.env.CARDHAWK_USER = 'endpoint-user';
  process.env.CARDHAWK_PASS = 'endpoint-pass';
  server.__setStoreForTest(appStore.createDefaultStore());
});

test('admin Review Workspace export requires existing authentication', async () => {
  setStoreWithListings([buildListing('auth-required')]);

  const response = await request('/api/admin/review-workspaces/export');

  assert.equal(response.statusCode, 401);
  assert.match(response.body, /Login required/);
});

test('default request exports the top 25 learning-priority stored listings', async () => {
  const listings = Array.from({ length: 30 }, (_, index) => buildListing(`default-${String(index).padStart(2, '0')}`, {
    estimatedValue: 90 + index
  }));
  setStoreWithListings(listings);

  const response = await request('/api/admin/review-workspaces/export', {
    Authorization: authHeader()
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json.source, 'runtime_listing_store');
  assert.equal(response.json.selectionMode, exporter.EXPORT_MODES.LEARNING_PRIORITY);
  assert.equal(response.json.requestedCount, 25);
  assert.equal(response.json.availableListingCount, 30);
  assert.equal(response.json.uniqueListingCount, 30);
  assert.equal(response.json.selectedListingCount, 25);
  assert.equal(response.json.reviewWorkspaces.length, 25);
  assert.equal(response.json.productionImpact, 'none');
});

test('custom count and includeReviewed query parameters are honored safely', async () => {
  setStoreWithListings([
    buildListing('custom-01'),
    buildListing('custom-02'),
    buildListing('custom-03'),
    buildListing('already-reviewed', {
      daltonReview: {
        reviewStatus: 'reviewed',
        decision: 'reject'
      }
    })
  ]);

  const defaultResponse = await request('/api/admin/review-workspaces/export?count=2', {
    Authorization: authHeader()
  });
  const includeReviewedResponse = await request('/api/admin/review-workspaces/export?count=4&includeReviewed=true', {
    Authorization: authHeader()
  });

  assert.equal(defaultResponse.statusCode, 200);
  assert.equal(defaultResponse.json.requestedCount, 2);
  assert.equal(defaultResponse.json.availableListingCount, 3);
  assert.equal(defaultResponse.json.selectedListingCount, 2);
  assert.equal(defaultResponse.json.includeReviewed, false);

  assert.equal(includeReviewedResponse.statusCode, 200);
  assert.equal(includeReviewedResponse.json.availableListingCount, 4);
  assert.equal(includeReviewedResponse.json.includeReviewed, true);
});

test('all-listings mode exports every unique stored listing', async () => {
  setStoreWithListings([
    buildListing('all-01'),
    buildListing('all-02'),
    buildListing('all-03')
  ]);

  const response = await request('/api/admin/review-workspaces/export?mode=all_listings&count=1', {
    Authorization: authHeader()
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json.selectionMode, exporter.EXPORT_MODES.ALL_LISTINGS);
  assert.equal(response.json.requestedCount, 3);
  assert.equal(response.json.selectedListingCount, 3);
  assert.deepEqual(response.json.reviewWorkspaces.map((workspace) => workspace.listingId), ['all-01', 'all-02', 'all-03']);
});

test('duplicate listing IDs are removed before endpoint export', async () => {
  const first = buildListing('duplicate-runtime');
  const duplicate = {
    ...buildListing('duplicate-runtime', { price: 95 }),
    storeKey: 'duplicate-runtime-copy'
  };
  const unique = buildListing('unique-runtime');
  setStoreWithListings([first, duplicate, unique]);

  const response = await request('/api/admin/review-workspaces/export?mode=all_listings', {
    Authorization: authHeader()
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json.availableListingCount, 3);
  assert.equal(response.json.uniqueListingCount, 2);
  assert.equal(response.json.duplicateListingsRemoved, 1);
  assert.deepEqual(response.json.reviewWorkspaces.map((workspace) => workspace.listingId), ['duplicate-runtime', 'unique-runtime']);
});

test('empty store and malformed query parameters return a valid empty deterministic batch', async () => {
  setStoreWithListings([]);

  const response = await request('/api/admin/review-workspaces/export?mode=unsupported&count=-10&includeReviewed=maybe', {
    Authorization: authHeader()
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json.selectionMode, exporter.EXPORT_MODES.LEARNING_PRIORITY);
  assert.equal(response.json.requestedCount, 25);
  assert.equal(response.json.availableListingCount, 0);
  assert.equal(response.json.selectedListingCount, 0);
  assert.equal(response.json.reviewWorkspaces.length, 0);
  assert.equal(response.json.duplicateListingsRemoved, 0);
  assert.equal(response.json.includeReviewed, false);
  assert.equal(response.json.productionImpact, 'none');
});

test('endpoint is read-only and preserves stored listings and production values', async () => {
  const listing = buildListing('read-only-production', {
    dealGatePassed: false,
    buyNowAllowed: false,
    decision: 'REJECT',
    reasons: ['Fixture rejection.'],
    estimatedValue: 101,
    price: 120
  });
  setStoreWithListings([listing]);
  const before = JSON.stringify(server.__getStoreForTest());

  const response = await request('/api/admin/review-workspaces/export?mode=all_listings', {
    Authorization: authHeader()
  });
  const after = JSON.stringify(server.__getStoreForTest());
  const workspace = response.json.reviewWorkspaces[0];

  assert.equal(response.statusCode, 200);
  assert.equal(after, before);
  assert.equal(workspace.productionOutputs.dealGate.passed, false);
  assert.equal(workspace.productionOutputs.dealGate.buyNowAllowed, false);
  assert.equal(workspace.productionOutputs.productionValuation.estimatedValue, 101);
  assert.equal(workspace.productionImpact, 'none');
});
