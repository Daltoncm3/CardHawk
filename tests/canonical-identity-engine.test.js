'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const canonicalIdentityEngine = require('../engines/canonicalIdentityEngine');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'canonical-identity', 'identity-fixtures.json');

function loadFixtureLibrary() {
  return JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertSchemaShape(identity) {
  for (const field of [
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
  ]) {
    assert.equal(Object.prototype.hasOwnProperty.call(identity, field), true, `missing ${field}`);
  }

  assert.equal(typeof identity.eligibility.exactCompEligible, 'boolean');
  assert.equal(typeof identity.eligibility.valuationEligible, 'boolean');
  assert.equal(typeof identity.eligibility.manualReviewRequired, 'boolean');
  assert.equal(typeof identity.eligibility.contextOnly, 'boolean');
  assert.equal(Array.isArray(identity.unknownFields), true);
  assert.equal(Array.isArray(identity.normalizationWarnings), true);
}

test('exports standalone canonical identity public API', () => {
  assert.equal(typeof canonicalIdentityEngine.buildCanonicalIdentity, 'function');
  assert.equal(typeof canonicalIdentityEngine.normalizeCanonicalIdentity, 'function');
  assert.equal(typeof canonicalIdentityEngine.buildCanonicalIdentityKey, 'function');
  assert.equal(typeof canonicalIdentityEngine.summarizeCanonicalIdentity, 'function');
  assert.equal(canonicalIdentityEngine.SCHEMA_VERSION, '1.0.0');
});

test('canonical sold evidence identity fixtures normalize to deterministic canonical identity keys', () => {
  const { fixtures } = loadFixtureLibrary();

  for (const fixture of fixtures) {
    const result = canonicalIdentityEngine.buildCanonicalIdentity({
      canonicalSoldEvidenceIdentity: fixture.identity
    });

    assertSchemaShape(result);
    assert.equal(result.canonicalIdentityKey, fixture.identity.canonicalIdentityKey, `${fixture.id} key mismatch`);
    assert.equal(result.identityType, fixture.identity.identityType, `${fixture.id} identity type mismatch`);
    assert.equal(result.category, fixture.identity.category, `${fixture.id} category mismatch`);
    assert.equal(result.eligibility.exactCompEligible, fixture.identity.eligibility.exactCompEligible, `${fixture.id} exact eligibility mismatch`);
    assert.equal(result.eligibility.valuationEligible, fixture.identity.eligibility.valuationEligible, `${fixture.id} valuation eligibility mismatch`);
  }
});

test('sports identity fields normalize from legacy parsed output without runtime integration', () => {
  const result = canonicalIdentityEngine.buildCanonicalIdentity({
    legacyParsed: {
      sport: 'Football',
      player: 'Joe Burrow',
      year: 2020,
      brand: 'Panini',
      product: 'Prizm',
      setName: 'Prizm',
      cardNumber: '#307',
      parallel: 'Base',
      rookie: true,
      autograph: false,
      memorabilia: false,
      serialNumbered: false,
      rawOrGraded: 'graded',
      gradeCompany: 'PSA',
      grade: '10'
    },
    listing: {
      title: '2020 Panini Prizm Joe Burrow RC #307 PSA 10'
    },
    marketplace: {
      marketplace: 'ebay'
    }
  });

  assert.equal(result.identityType, 'sports_card');
  assert.equal(result.normalized.subject.name, 'joe burrow');
  assert.equal(result.normalized.cardNumber, '307');
  assert.equal(result.normalized.grading.company, 'psa');
  assert.equal(result.canonicalIdentityKey, 'ci:v1:sports:football:2020:panini:prizm:joe-burrow:307:base:non-auto:non-mem:unnumbered:graded:psa-10');
  assert.equal(result.eligibility.exactCompEligible, false);
  assert.equal(result.eligibility.valuationEligible, false);
  assert.equal(result.eligibility.manualReviewRequired, true);
});

test('TCG identity fields normalize from structured metadata', () => {
  const result = canonicalIdentityEngine.buildCanonicalIdentity({
    identity: {
      identityType: 'tcg_card',
      game: 'Pokemon',
      cardName: 'Charizard',
      character: 'Charizard',
      franchise: 'Pokemon',
      setName: 'Base Set',
      setCode: 'Base',
      collectorNumber: '4/102',
      rarity: 'Holo Rare',
      finishTreatment: 'Holo',
      foilState: 'Holo',
      alternateArt: false,
      firstEdition: false,
      language: 'English',
      printing: 'Unlimited',
      serialized: false,
      rawOrGraded: 'graded',
      gradeCompany: 'PSA',
      grade: '9'
    },
    listing: {
      title: 'Pokemon Base Set Charizard 4/102 Holo PSA 9 English'
    }
  });

  assert.equal(result.identityType, 'tcg_card');
  assert.equal(result.category, 'tcg_card');
  assert.equal(result.normalized.game, 'pokemon');
  assert.equal(result.normalized.cardName, 'charizard');
  assert.equal(result.normalized.collectorNumber, '4/102');
  assert.equal(result.canonicalIdentityKey, 'ci:v1:tcg:pokemon:base-set:charizard:4/102:holo:english:graded:psa-9');
  assert.equal(result.eligibility.manualReviewRequired, true);
});

test('unknown fields remain explicit and are never guessed from marketing language', () => {
  const result = canonicalIdentityEngine.buildCanonicalIdentity({
    legacyParsed: {
      sport: 'Football',
      player: 'Joe Burrow',
      brand: 'Panini',
      product: 'Prizm',
      setName: 'Prizm',
      cardNumber: '307',
      parallel: 'unknown',
      rookie: true,
      autograph: false,
      memorabilia: false,
      rawOrGraded: 'raw'
    },
    listing: {
      title: 'RARE SSP INVESTMENT MINT Joe Burrow Prizm RC #307'
    }
  });

  assert.equal(result.normalized.serialNumbered, 'unknown');
  assert.equal(result.normalized.parallel, 'unknown');
  assert.equal(result.unknownFields.includes('normalized.serialNumbered'), true);
  assert.equal(result.unknownFields.includes('normalized.parallel'), true);
  assert.equal(result.normalizationWarnings.includes('seller_marketing_language_ignored'), true);
  assert.equal(result.canonicalIdentityKey.includes('unknown-numbering'), true);
  assert.equal(result.eligibility.exactCompEligible, false);
});

test('malformed input returns safe schema-conformant context-only output', () => {
  const result = canonicalIdentityEngine.buildCanonicalIdentity({});

  assertSchemaShape(result);
  assert.equal(result.identityType, 'unknown');
  assert.equal(result.category, 'unknown');
  assert.equal(result.canonicalIdentityKey, 'ci:v1:unknown:unknown');
  assert.equal(result.overallIdentityConfidence, 0);
  assert.equal(result.eligibility.exactCompEligible, false);
  assert.equal(result.eligibility.valuationEligible, false);
  assert.equal(result.eligibility.manualReviewRequired, true);
  assert.equal(result.eligibility.contextOnly, true);
});

test('normalization is deterministic and does not mutate inputs', () => {
  const fixture = loadFixtureLibrary().fixtures.find((entry) => entry.id === 'sports-numbered-auto-relic');
  const input = {
    canonicalSoldEvidenceIdentity: clone(fixture.identity)
  };
  const before = clone(input);

  const first = canonicalIdentityEngine.buildCanonicalIdentity(input);
  const second = canonicalIdentityEngine.buildCanonicalIdentity(input);

  assert.deepEqual(input, before);
  assert.deepEqual(second, first);
  assert.equal(first.canonicalIdentityKey, fixture.identity.canonicalIdentityKey);
});

test('summary reflects canonical identity eligibility without recommendation language', () => {
  const fixture = loadFixtureLibrary().fixtures.find((entry) => entry.id === 'sports-psa10-rookie-base');
  const eligible = canonicalIdentityEngine.buildCanonicalIdentity({
    canonicalSoldEvidenceIdentity: fixture.identity
  });
  const malformed = canonicalIdentityEngine.buildCanonicalIdentity({});

  assert.match(canonicalIdentityEngine.summarizeCanonicalIdentity(eligible), /valuation eligible/);
  assert.match(canonicalIdentityEngine.summarizeCanonicalIdentity(malformed), /manual review|context only/);
  assert.doesNotMatch(canonicalIdentityEngine.summarizeCanonicalIdentity(eligible), /buy|pass|recommend/i);
});

