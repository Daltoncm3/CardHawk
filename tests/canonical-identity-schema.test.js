'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'canonical-identity', 'identity-fixtures.json');

const REQUIRED_TOP_LEVEL_FIELDS = [
  'schemaVersion',
  'identityType',
  'category',
  'marketSegment',
  'canonicalIdentityKey',
  'raw',
  'normalizedTitle',
  'parserVersion',
  'normalized',
  'rawExtractedValues',
  'sourceFields',
  'fieldConfidence',
  'overallIdentityConfidence',
  'unknownFields',
  'normalizationWarnings',
  'eligibility'
];

const REQUIRED_SPORTS_FIELDS = [
  'sport',
  'league',
  'team',
  'subject',
  'year',
  'manufacturer',
  'brand',
  'product',
  'setName',
  'cardNumber',
  'parallel',
  'rookieDesignation',
  'autograph',
  'memorabilia',
  'serialNumbered',
  'rawOrGraded',
  'grading'
];

const REQUIRED_TCG_FIELDS = [
  'game',
  'cardName',
  'character',
  'franchise',
  'setName',
  'setCode',
  'collectorNumber',
  'rarity',
  'finishTreatment',
  'foilState',
  'alternateArt',
  'language',
  'printing',
  'serialized',
  'rawOrGraded',
  'condition',
  'grading'
];

const REQUIRED_TCG_GAMES = [
  'pokemon',
  'magic',
  'yu-gi-oh',
  'lorcana',
  'one-piece',
  'flesh-and-blood',
  'digimon',
  'weiss-schwarz',
  'union-arena'
];

function loadFixtureLibrary() {
  return JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function stableToken(value, fallback = 'unknown') {
  return String(value ?? fallback)
    .toLowerCase()
    .replace(/[^a-z0-9/.-]+/g, '-')
    .replace(/^-+|-+$/g, '') || fallback;
}

function identityToken(value, unknownLabel) {
  return value === 'unknown' || value === null || value === undefined || value === ''
    ? unknownLabel
    : value;
}

function getSportsKey(identity) {
  const normalized = identity.normalized;
  const subject = asObject(normalized.subject).name || 'unknown-subject';
  const autograph = asObject(normalized.autograph);
  const memorabilia = asObject(normalized.memorabilia);
  const grading = asObject(normalized.grading);
  const autographPart = autograph.state
    ? stableToken(autograph.type && autograph.type.includes('patch') ? 'patch-auto' : 'auto')
    : 'non-auto';
  const memorabiliaPart = memorabilia.state ? 'memorabilia' : 'non-mem';
  const serialPart = normalized.serialNumbered === true
    ? `numbered-${stableToken(normalized.printRun)}`
    : normalized.serialNumbered === false
      ? 'unnumbered'
      : 'unknown-numbering';

  return [
    'ci:v1:sports',
    normalized.sport,
    identityToken(normalized.year, 'unknown-year'),
    normalized.manufacturer,
    normalized.product || normalized.setName,
    subject,
    identityToken(normalized.cardNumber, 'unknown-number'),
    identityToken(normalized.imageVariation || normalized.variation || normalized.parallel || 'base', 'unknown-parallel'),
    autographPart,
    memorabiliaPart,
    serialPart,
    normalized.rawOrGraded,
    `${grading.company || 'unknown'}-${grading.grade || 'unknown'}`
  ].map((part, index) => index === 0 ? part : stableToken(part)).join(':');
}

function getTcgIdentityPart(normalized) {
  if (normalized.collectorNumber && normalized.collectorNumber !== 'unknown') return normalized.collectorNumber;
  if (normalized.serialized && normalized.serialNumber && normalized.printRun) return `${normalized.serialNumber}/${normalized.printRun}`;
  return 'unknown-number';
}

function getTcgFinishPart(normalized) {
  if (normalized.artVariant) return normalized.artVariant;
  return normalized.finishTreatment || normalized.rarity || 'unknown-finish';
}

function getTcgKey(identity) {
  const normalized = identity.normalized;
  const grading = asObject(normalized.grading);
  return [
    'ci:v1:tcg',
    normalized.game,
    normalized.setName,
    normalized.cardName,
    getTcgIdentityPart(normalized),
    getTcgFinishPart(normalized),
    normalized.language,
    normalized.rawOrGraded,
    `${grading.company || 'unknown'}-${grading.grade || 'unknown'}`
  ].map((part, index) => index === 0 ? part : stableToken(part)).join(':');
}

function expectedCanonicalKey(identity) {
  if (identity.identityType === 'sports_card') return getSportsKey(identity);
  if (identity.identityType === 'tcg_card') return getTcgKey(identity);
  return 'ci:v1:unknown:unknown';
}

function hasKnown(value) {
  return value !== undefined && value !== null && value !== '' && value !== 'unknown';
}

function hasBlockingWarning(identity) {
  return identity.normalizationWarnings.some((warning) =>
    /missing|malformed|ambiguous|unknown_but/.test(warning)
  );
}

function computeExactCompEligibility(identity) {
  if (identity.identityType === 'sports_card') {
    const normalized = identity.normalized;
    return Boolean(
      hasKnown(normalized.sport) &&
      hasKnown(asObject(normalized.subject).name) &&
      hasKnown(normalized.year) &&
      hasKnown(normalized.setName) &&
      hasKnown(normalized.cardNumber) &&
      hasKnown(normalized.parallel) &&
      normalized.autograph?.state !== undefined &&
      normalized.memorabilia?.state !== undefined &&
      normalized.serialNumbered !== undefined &&
      normalized.serialNumbered !== 'unknown' &&
      hasKnown(normalized.rawOrGraded) &&
      identity.overallIdentityConfidence >= 0.9 &&
      !hasBlockingWarning(identity)
    );
  }

  if (identity.identityType === 'tcg_card') {
    const normalized = identity.normalized;
    return Boolean(
      hasKnown(normalized.game) &&
      hasKnown(normalized.cardName) &&
      hasKnown(normalized.setName) &&
      hasKnown(normalized.collectorNumber) &&
      hasKnown(normalized.finishTreatment) &&
      hasKnown(normalized.language) &&
      hasKnown(normalized.rawOrGraded) &&
      identity.overallIdentityConfidence >= 0.9 &&
      !hasBlockingWarning(identity)
    );
  }

  return false;
}

function computeValuationEligibility(identity) {
  if (!computeExactCompEligibility(identity)) return false;
  const normalized = identity.normalized;

  if (identity.identityType === 'sports_card') {
    return Boolean(
      normalized.autograph?.state !== undefined &&
      normalized.memorabilia?.state !== undefined &&
      normalized.serialNumbered !== undefined &&
      hasKnown(normalized.rawOrGraded) &&
      hasKnown(normalized.parallel)
    );
  }

  if (identity.identityType === 'tcg_card') {
    return Boolean(
      hasKnown(normalized.game) &&
      hasKnown(normalized.rarity) &&
      hasKnown(normalized.finishTreatment) &&
      hasKnown(normalized.language) &&
      (hasKnown(normalized.condition) || hasKnown(normalized.grading?.company))
    );
  }

  return false;
}

test('canonical identity fixture library is versioned and offline', () => {
  const library = loadFixtureLibrary();

  assert.equal(library.metadata.fixtureSet, 'canonical_identity_v1');
  assert.equal(library.metadata.schemaVersion, '1.0.0');
  assert.equal(library.metadata.networkAccess, false);
  assert.equal(Array.isArray(library.fixtures), true);
  assert.equal(library.fixtures.length >= 18, true);
});

test('every fixture exposes required canonical identity structure', () => {
  const { fixtures } = loadFixtureLibrary();

  for (const fixture of fixtures) {
    const identity = fixture.identity;
    for (const field of REQUIRED_TOP_LEVEL_FIELDS) {
      assert.equal(Object.prototype.hasOwnProperty.call(identity, field), true, `${fixture.id} missing ${field}`);
    }

    assert.equal(typeof identity.raw.title, 'string', `${fixture.id} raw.title must be string`);
    assert.equal(typeof identity.raw.source, 'string', `${fixture.id} raw.source must be string`);
    assert.equal(Array.isArray(identity.unknownFields), true, `${fixture.id} unknownFields must be array`);
    assert.equal(Array.isArray(identity.normalizationWarnings), true, `${fixture.id} warnings must be array`);
    assert.equal(typeof identity.eligibility.exactCompEligible, 'boolean', `${fixture.id} exact eligibility must be boolean`);
    assert.equal(typeof identity.eligibility.valuationEligible, 'boolean', `${fixture.id} valuation eligibility must be boolean`);
    assert.equal(typeof identity.eligibility.manualReviewRequired, 'boolean', `${fixture.id} manual review flag must be boolean`);
  }
});

test('sports and TCG fixture coverage includes required categories and games', () => {
  const { fixtures } = loadFixtureLibrary();
  const tags = new Set(fixtures.flatMap((fixture) => fixture.tags));
  const games = new Set(fixtures
    .map((fixture) => fixture.identity.normalized.game)
    .filter(Boolean));

  for (const tag of ['psa', 'bgs', 'sgc', 'cgc', 'raw', 'base', 'parallel', 'numbered', 'autograph', 'relic', 'image_variation', 'first_bowman']) {
    assert.equal(tags.has(tag), true, `missing tag coverage: ${tag}`);
  }

  for (const game of REQUIRED_TCG_GAMES) {
    assert.equal(games.has(game), true, `missing TCG game coverage: ${game}`);
  }

  assert.equal(tags.has('seller_marketing'), true);
  assert.equal(tags.has('malformed'), true);
  assert.equal(tags.has('missing_fields'), true);
});

test('sports fixtures include required sports-card fields', () => {
  const sportsFixtures = loadFixtureLibrary().fixtures.filter((fixture) => fixture.identity.identityType === 'sports_card');

  for (const fixture of sportsFixtures) {
    for (const field of REQUIRED_SPORTS_FIELDS) {
      assert.equal(Object.prototype.hasOwnProperty.call(fixture.identity.normalized, field), true, `${fixture.id} missing sports field ${field}`);
    }
  }
});

test('TCG fixtures include required trading-card-game fields', () => {
  const tcgFixtures = loadFixtureLibrary().fixtures.filter((fixture) => fixture.identity.identityType === 'tcg_card');

  for (const fixture of tcgFixtures) {
    for (const field of REQUIRED_TCG_FIELDS) {
      assert.equal(Object.prototype.hasOwnProperty.call(fixture.identity.normalized, field), true, `${fixture.id} missing TCG field ${field}`);
    }
  }
});

test('canonical identity keys are deterministic and unique', () => {
  const { fixtures } = loadFixtureLibrary();
  const keys = fixtures.map((fixture) => fixture.identity.canonicalIdentityKey);

  assert.equal(new Set(keys).size, keys.length);

  for (const fixture of fixtures) {
    assert.equal(fixture.identity.canonicalIdentityKey, expectedCanonicalKey(fixture.identity), `${fixture.id} key mismatch`);
    assert.equal(/[A-Z\s]/.test(fixture.identity.canonicalIdentityKey), false, `${fixture.id} key must be normalized`);
  }
});

test('explicit unknown values are preserved and listed as unknown fields', () => {
  const { fixtures } = loadFixtureLibrary();
  const missingCardNumber = fixtures.find((fixture) => fixture.id === 'missing-card-number').identity;
  const marketing = fixtures.find((fixture) => fixture.id === 'ambiguous-title-marketing-language').identity;

  assert.equal(missingCardNumber.normalized.cardNumber, 'unknown');
  assert.equal(missingCardNumber.unknownFields.includes('normalized.cardNumber'), true);
  assert.equal(marketing.normalized.serialNumbered, 'unknown');
  assert.equal(marketing.unknownFields.includes('normalized.serialNumbered'), true);
  assert.equal(marketing.normalizationWarnings.includes('ssp_not_treated_as_serial_number_without_print_run'), true);
});

test('eligibility rules are represented without guessing missing values', () => {
  const { fixtures } = loadFixtureLibrary();

  for (const fixture of fixtures) {
    const identity = fixture.identity;
    assert.equal(identity.eligibility.exactCompEligible, computeExactCompEligibility(identity), `${fixture.id} exact eligibility mismatch`);
    assert.equal(identity.eligibility.valuationEligible, computeValuationEligibility(identity), `${fixture.id} valuation eligibility mismatch`);

    if (identity.eligibility.exactCompEligible === false) {
      assert.equal(identity.eligibility.manualReviewRequired, true, `${fixture.id} should require review when not exact eligible`);
    }
  }
});

test('confidence fields have valid shape and do not imply certainty for unknown fields', () => {
  const { fixtures } = loadFixtureLibrary();

  for (const fixture of fixtures) {
    const identity = fixture.identity;
    assert.equal(identity.overallIdentityConfidence >= 0 && identity.overallIdentityConfidence <= 1, true, `${fixture.id} overall confidence out of range`);

    for (const [field, confidence] of Object.entries(identity.fieldConfidence)) {
      assert.equal(confidence >= 0 && confidence <= 1, true, `${fixture.id} ${field} confidence out of range`);
    }

    for (const unknownField of identity.unknownFields) {
      if (identity.fieldConfidence[unknownField] !== undefined) {
        assert.equal(identity.fieldConfidence[unknownField], 0, `${fixture.id} unknown ${unknownField} must not imply certainty`);
      }
    }
  }
});

test('fixture replay is stable across repeated loads', () => {
  const first = loadFixtureLibrary();
  const second = loadFixtureLibrary();

  assert.deepEqual(
    second.fixtures.map((fixture) => fixture.identity.canonicalIdentityKey),
    first.fixtures.map((fixture) => fixture.identity.canonicalIdentityKey)
  );
  assert.deepEqual(second, first);
});
