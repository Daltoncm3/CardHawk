'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  DEFAULT_FIXTURE_PATH,
  REQUIRED_CATEGORIES,
  findDuplicateFixtureGroups,
  getFixtureDuplicateKeys,
  loadAndValidateEbayFixtureLibrary,
  loadEbayFixtureLibrary,
  summarizeFixtureCategories,
  validateEbayFixture,
  validateEbayFixtureLibrary
} = require('../validation/ebayFixtureLibrary');

test('eBay fixture library loads offline fixture metadata and records', () => {
  const library = loadEbayFixtureLibrary(DEFAULT_FIXTURE_PATH);

  assert.equal(library.metadata.fixtureSet, 'ebay_sold_listing_scenarios');
  assert.equal(library.metadata.networkAccess, false);
  assert.equal(Array.isArray(library.fixtures), true);
  assert.equal(library.fixtures.length >= 20, true);
});

test('eBay fixture library covers every required marketplace scenario category', () => {
  const library = loadEbayFixtureLibrary();
  const categories = summarizeFixtureCategories(library.fixtures);

  assert.deepEqual(categories.missing, []);
  for (const category of REQUIRED_CATEGORIES) {
    assert.equal(categories.covered.includes(category), true);
  }
});

test('eBay fixture validation accepts standard true sold fixtures', () => {
  const library = loadEbayFixtureLibrary();
  const fixture = library.fixtures.find((entry) => entry.id === 'ebay-standard-sold-psa10-rookie');
  const result = validateEbayFixture(fixture);

  assert.equal(result.valid, true);
  assert.equal(result.expectedEvidenceType, 'true_sold');
  assert.equal(result.shouldImportAsTrueSold, true);
  assert.equal(result.duplicateKeys.some((key) => key.startsWith('item:')), true);
});

test('eBay fixture validation preserves expected invalid listing scenarios', () => {
  const library = loadEbayFixtureLibrary();
  const fixture = library.fixtures.find((entry) => entry.id === 'ebay-best-offer-undisclosed');
  const result = validateEbayFixture(fixture);

  assert.equal(result.valid, true);
  assert.equal(result.expectedValid, false);
  assert.equal(result.shouldImportAsTrueSold, false);
  assert.equal(fixture.expected.validation.reasons.includes('undisclosed_best_offer_price'), true);
});

test('eBay fixture library validation reports category coverage, negative cases, and true sold cases', () => {
  const report = loadAndValidateEbayFixtureLibrary();

  assert.equal(report.passed, true);
  assert.equal(report.failures.length, 0);
  assert.equal(report.summary.categoriesMissing, 0);
  assert.equal(report.summary.expectedInvalidFixtures >= 4, true);
  assert.equal(report.summary.trueSoldFixtureCount >= 8, true);
});

test('eBay fixture library detects duplicate source records deterministically', () => {
  const library = loadEbayFixtureLibrary();
  const duplicateGroups = findDuplicateFixtureGroups(library.fixtures);
  const duplicateByItem = duplicateGroups.find((group) => group.key === 'item:duplicate-001');

  assert.equal(duplicateGroups.length > 0, true);
  assert.deepEqual(duplicateByItem.ids.sort(), ['ebay-duplicate-listing-a', 'ebay-duplicate-listing-b']);
});

test('duplicate keys include item, URL, fingerprint, and declared duplicate groups when available', () => {
  const library = loadEbayFixtureLibrary();
  const fixture = library.fixtures.find((entry) => entry.id === 'ebay-duplicate-listing-a');
  const keys = getFixtureDuplicateKeys(fixture);

  assert.equal(keys.includes('item:duplicate-001'), true);
  assert.equal(keys.some((key) => key.startsWith('url:https://example.test/ebay/sold/duplicate-001')), true);
  assert.equal(keys.some((key) => key.startsWith('fingerprint:')), true);
  assert.equal(keys.includes('group:duplicate-001'), true);
});

test('fixture validator flags malformed fixture definitions when expectations are inconsistent', () => {
  const result = validateEbayFixture({
    id: 'bad-fixture',
    category: 'standard_sold',
    description: 'Bad fixture for validator test.',
    tags: [],
    ebayRecord: {
      itemId: 'bad-1',
      title: 'Bad Fixture',
      itemWebUrl: 'https://example.test/bad',
      price: { value: '10.00', currency: 'USD' },
      itemEndDate: '2026-07-01T00:00:00.000Z'
    },
    expected: {
      valid: true,
      evidenceType: 'active_context',
      saleType: 'buy_it_now',
      soldPrice: 10,
      soldAt: '2026-07-01T00:00:00.000Z',
      parsedIdentity: {
        category: 'sports_card',
        year: '2026',
        setName: 'Example',
        cardNumber: '1',
        player: 'Example Player'
      },
      validation: {
        shouldImportAsTrueSold: true,
        reasons: []
      }
    }
  });

  assert.equal(result.valid, false);
  assert.equal(result.reasons.includes('non_true_sold_fixture_marked_importable'), true);
});

test('library validation fails clearly when required categories are absent', () => {
  const library = {
    metadata: {
      fixtureSet: 'tiny',
      version: '1.0.0',
      networkAccess: false
    },
    fixtures: [
      loadEbayFixtureLibrary().fixtures[0]
    ]
  };
  const report = validateEbayFixtureLibrary(library);

  assert.equal(report.passed, false);
  assert.equal(report.failures.includes('required_categories_covered'), true);
  assert.equal(report.categories.missing.includes('auction_sale'), true);
});

test('fixture library validation does not call network or production store code', () => {
  const report = loadAndValidateEbayFixtureLibrary();
  const offlineCheck = report.checks.find((check) => check.name === 'offline_only');

  assert.equal(offlineCheck.pass, true);
  assert.equal(offlineCheck.details.networkAccess, false);
});
