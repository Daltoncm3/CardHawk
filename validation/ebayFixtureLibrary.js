'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_FIXTURE_PATH = path.join(__dirname, '..', 'tests', 'fixtures', 'ebay', 'sold-listing-scenarios.json');

const REQUIRED_CATEGORIES = [
  'standard_sold',
  'auction_sale',
  'buy_it_now_sale',
  'best_offer_accepted',
  'multi_variation',
  'multi_card_lot',
  'graded_card',
  'raw_card',
  'autograph',
  'relic',
  'serial_numbered',
  'parallel',
  'missing_fields',
  'malformed_listing',
  'duplicate_listing',
  'edge_case'
];

const VALID_EVIDENCE_TYPES = new Set([
  'true_sold',
  'active_context',
  'aggregate_market_price',
  'fallback_unknown'
]);

const VALID_SALE_TYPES = new Set([
  'auction',
  'buy_it_now',
  'best_offer',
  'unknown'
]);

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s/.-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeUrl(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  try {
    return new URL(text).toString().toLowerCase();
  } catch {
    return text.toLowerCase();
  }
}

function normalizeDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function loadEbayFixtureLibrary(filePath = DEFAULT_FIXTURE_PATH) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function getRecordPrice(record = {}) {
  return toNumber(record.price?.value ?? record.currentBidPrice?.value ?? record.convertedCurrentPrice?.value, 0);
}

function getRecordShipping(record = {}) {
  const shippingOption = asArray(record.shippingOptions)[0] || {};
  return toNumber(shippingOption.shippingCost?.value, 0);
}

function getFixtureDuplicateKeys(fixture = {}) {
  const record = asObject(fixture.ebayRecord);
  const keys = [];
  const itemId = normalizeText(record.itemId || record.legacyItemId);
  const url = normalizeUrl(record.itemWebUrl);
  const title = normalizeText(record.title);
  const price = getRecordPrice(record);
  const soldAt = normalizeDate(record.itemEndDate || record.soldAt);

  if (itemId) keys.push(`item:${itemId}`);
  if (url) keys.push(`url:${url}`);
  if (title && soldAt && price > 0) keys.push(`fingerprint:${title}:${soldAt}:${price}`);
  if (fixture.expected?.duplicateGroup) keys.push(`group:${normalizeText(fixture.expected.duplicateGroup)}`);

  return keys;
}

function hasSubject(identity = {}) {
  return Boolean(identity.player || identity.subject || identity.character);
}

function validateExpectedIdentity(expected = {}) {
  const identity = asObject(expected.parsedIdentity);
  const reasons = [];

  for (const field of ['category', 'year', 'setName', 'cardNumber']) {
    if (!identity[field]) reasons.push(`missing_expected_identity_${field}`);
  }
  if (!hasSubject(identity)) reasons.push('missing_expected_identity_subject');

  return reasons;
}

function validateEbayFixture(fixture = {}) {
  const reasons = [];
  const record = asObject(fixture.ebayRecord);
  const expected = asObject(fixture.expected);
  const expectedValidation = asObject(expected.validation);
  const recordPrice = getRecordPrice(record);
  const recordShipping = getRecordShipping(record);
  const recordSoldAt = normalizeDate(record.itemEndDate || record.soldAt);

  if (!fixture.id) reasons.push('missing_fixture_id');
  if (!fixture.category) reasons.push('missing_fixture_category');
  if (!fixture.description) reasons.push('missing_fixture_description');
  if (!Object.keys(record).length) reasons.push('missing_ebay_record');
  if (!Object.keys(expected).length) reasons.push('missing_expected_outcome');
  if (expected.valid === undefined) reasons.push('missing_expected_valid_flag');
  if (!VALID_EVIDENCE_TYPES.has(expected.evidenceType)) reasons.push('invalid_expected_evidence_type');
  if (!VALID_SALE_TYPES.has(expected.saleType || 'unknown')) reasons.push('invalid_expected_sale_type');
  if (!Array.isArray(fixture.tags)) reasons.push('missing_fixture_tags');
  if (expectedValidation.shouldImportAsTrueSold === undefined) reasons.push('missing_shouldImportAsTrueSold');
  if (!Array.isArray(expectedValidation.reasons)) reasons.push('missing_expected_validation_reasons');
  if (expected.evidenceType === 'true_sold' && expectedValidation.shouldImportAsTrueSold !== true) {
    reasons.push('true_sold_fixture_not_marked_importable');
  }
  if (expected.evidenceType !== 'true_sold' && expectedValidation.shouldImportAsTrueSold === true) {
    reasons.push('non_true_sold_fixture_marked_importable');
  }
  if (expected.valid === true && expectedValidation.reasons.length) {
    reasons.push('valid_fixture_has_rejection_reasons');
  }
  if (expected.valid === false && !expectedValidation.reasons.length) {
    reasons.push('invalid_fixture_missing_rejection_reasons');
  }

  reasons.push(...validateExpectedIdentity(expected));

  if (expected.valid === true) {
    if (!record.itemId && !record.legacyItemId) reasons.push('valid_fixture_missing_item_id');
    if (!record.title) reasons.push('valid_fixture_missing_title');
    if (!record.itemWebUrl) reasons.push('valid_fixture_missing_url');
    if (recordPrice <= 0) reasons.push('valid_fixture_missing_price');
    if (!recordSoldAt) reasons.push('valid_fixture_missing_sold_date');
    if (expected.soldPrice !== undefined && toNumber(expected.soldPrice, -1) !== recordPrice) {
      reasons.push('expected_sold_price_mismatch');
    }
    if (expected.shipping !== undefined && toNumber(expected.shipping, -1) !== recordShipping) {
      reasons.push('expected_shipping_mismatch');
    }
    if (expected.soldAt && normalizeDate(expected.soldAt) !== recordSoldAt) {
      reasons.push('expected_sold_date_mismatch');
    }
  }

  if (expected.priceDisclosure === 'undisclosed' && expectedValidation.shouldImportAsTrueSold) {
    reasons.push('undisclosed_price_marked_importable');
  }

  return {
    id: fixture.id || null,
    category: fixture.category || null,
    valid: reasons.length === 0,
    reasons,
    expectedValid: expected.valid === true,
    expectedEvidenceType: expected.evidenceType || null,
    shouldImportAsTrueSold: expectedValidation.shouldImportAsTrueSold === true,
    duplicateKeys: getFixtureDuplicateKeys(fixture)
  };
}

function findDuplicateFixtureGroups(fixtures = []) {
  const index = {};

  for (const fixture of asArray(fixtures)) {
    for (const key of getFixtureDuplicateKeys(fixture)) {
      if (!index[key]) index[key] = [];
      index[key].push(fixture.id || null);
    }
  }

  return Object.entries(index)
    .filter(([, ids]) => ids.length > 1)
    .map(([key, ids]) => ({
      key,
      ids
    }));
}

function summarizeFixtureCategories(fixtures = []) {
  const counts = {};

  for (const fixture of asArray(fixtures)) {
    const category = fixture.category || 'unknown';
    counts[category] = (counts[category] || 0) + 1;
  }

  return {
    counts,
    covered: REQUIRED_CATEGORIES.filter((category) => counts[category] > 0),
    missing: REQUIRED_CATEGORIES.filter((category) => !counts[category])
  };
}

function validateEbayFixtureLibrary(library = {}) {
  const fixtures = asArray(library.fixtures);
  const fixtureResults = fixtures.map(validateEbayFixture);
  const invalidFixtures = fixtureResults.filter((result) => !result.valid);
  const categories = summarizeFixtureCategories(fixtures);
  const duplicateGroups = findDuplicateFixtureGroups(fixtures);
  const expectedInvalidFixtures = fixtureResults.filter((result) => result.expectedValid === false);
  const importableTrueSoldFixtures = fixtureResults.filter((result) => result.shouldImportAsTrueSold);
  const checks = [
    {
      name: 'metadata_present',
      pass: Boolean(library.metadata?.fixtureSet && library.metadata?.version),
      details: {
        fixtureSet: library.metadata?.fixtureSet || null,
        version: library.metadata?.version || null
      }
    },
    {
      name: 'offline_only',
      pass: library.metadata?.networkAccess === false,
      details: {
        networkAccess: library.metadata?.networkAccess
      }
    },
    {
      name: 'fixtures_present',
      pass: fixtures.length > 0,
      details: {
        fixtureCount: fixtures.length
      }
    },
    {
      name: 'required_categories_covered',
      pass: categories.missing.length === 0,
      details: categories
    },
    {
      name: 'fixture_schema_and_expectations',
      pass: invalidFixtures.length === 0,
      details: {
        invalidFixtures
      }
    },
    {
      name: 'negative_cases_present',
      pass: expectedInvalidFixtures.length >= 4,
      details: {
        expectedInvalidFixtureCount: expectedInvalidFixtures.length
      }
    },
    {
      name: 'duplicates_present',
      pass: duplicateGroups.length > 0,
      details: {
        duplicateGroups
      }
    },
    {
      name: 'true_sold_cases_present',
      pass: importableTrueSoldFixtures.length >= 8,
      details: {
        trueSoldFixtureCount: importableTrueSoldFixtures.length
      }
    }
  ];
  const failedChecks = checks.filter((check) => !check.pass);

  return {
    source: 'ebay_fixture_library_validation',
    version: '1.0.0',
    passed: failedChecks.length === 0,
    totalChecks: checks.length,
    passedChecks: checks.length - failedChecks.length,
    failedChecks: failedChecks.length,
    checks,
    failures: failedChecks.map((check) => check.name),
    summary: {
      fixtureCount: fixtures.length,
      validFixtureDefinitions: fixtureResults.filter((result) => result.valid).length,
      invalidFixtureDefinitions: invalidFixtures.length,
      expectedInvalidFixtures: expectedInvalidFixtures.length,
      trueSoldFixtureCount: importableTrueSoldFixtures.length,
      duplicateGroupCount: duplicateGroups.length,
      categoriesCovered: categories.covered.length,
      categoriesMissing: categories.missing.length
    },
    categories,
    duplicateGroups,
    fixtureResults
  };
}

function loadAndValidateEbayFixtureLibrary(filePath = DEFAULT_FIXTURE_PATH) {
  const library = loadEbayFixtureLibrary(filePath);
  return validateEbayFixtureLibrary(library);
}

module.exports = {
  DEFAULT_FIXTURE_PATH,
  REQUIRED_CATEGORIES,
  findDuplicateFixtureGroups,
  getFixtureDuplicateKeys,
  loadAndValidateEbayFixtureLibrary,
  loadEbayFixtureLibrary,
  summarizeFixtureCategories,
  validateEbayFixture,
  validateEbayFixtureLibrary
};
