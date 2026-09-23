'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  RESOLUTION_CLASSIFICATIONS,
  parseTitleIdentity,
  resolveCardApiIdentityBatch,
  resolveCardApiTransactionIdentity,
  summarizeCardApiIdentityResolution
} = require('../validation/cardApiIdentityResolutionPilot');

function providerSale(overrides = {}) {
  return {
    id: 'ebay-test-1',
    platform: 'eBay',
    listing_type: 'auction',
    title: '2024 Topps Chrome Shohei Ohtani #17 Refractor Non Auto No Patch Unnumbered Raw',
    sold_at: '2026-09-17T00:00:00Z',
    sale_date: '2026-09-17',
    price: 12.5,
    currency: 'USD',
    price_confirmed: true,
    listing_url: 'https://www.ebay.com/itm/ebay-test-1',
    image_url: 'https://example.test/image.jpg',
    shipping_price: 0,
    category: 'sports',
    ...overrides
  };
}

test('deterministic exact resolution uses title parsing without provider metadata fabrication', () => {
  const result = resolveCardApiTransactionIdentity(providerSale());

  assert.equal(result.classification, RESOLUTION_CLASSIFICATIONS.EXACT);
  assert.equal(result.identityExact, true);
  assert.equal(result.canonicalIdentity.identityType, 'sports_card');
  assert.equal(result.canonicalIdentity.normalized.subject.name, 'shohei ohtani');
  assert.equal(result.canonicalIdentity.normalized.cardNumber, '17');
  assert.equal(result.canonicalIdentity.normalized.parallel, 'refractor');
  assert.equal(result.fieldProvenance.subjectName.source, 'deterministic_title_parse');
  assert.equal(result.fieldProvenance.cardNumber.source, 'deterministic_title_parse');
  assert.equal(result.canonicalSoldEvidenceStructurallyReady, true);
  assert.equal(result.retentionAuthority.persistenceAllowed, false);
});

test('unconfirmed Card API prices cannot become structurally ready through exact identity resolution', () => {
  const cases = [
    { label: 'false', price_confirmed: false },
    { label: 'missing', removePriceConfirmed: true },
    { label: 'malformed', price_confirmed: { confirmed: true } },
    { label: 'string', price_confirmed: 'true' }
  ];

  for (const input of cases) {
    const sale = providerSale({
      id: `ebay-unconfirmed-${input.label}`,
      price_confirmed: input.price_confirmed
    });
    if (input.removePriceConfirmed) delete sale.price_confirmed;

    const result = resolveCardApiTransactionIdentity(sale);

    assert.equal(result.classification, RESOLUTION_CLASSIFICATIONS.EXACT);
    assert.equal(result.identityExact, true);
    assert.equal(result.canonicalSoldEvidenceStructurallyReady, false);
    assert.equal(result.canonicalSoldEvidenceReadinessReasons.includes('confirmed_true_sold_price_required'), true);
  }
});

test('graded card handling preserves grade context without changing underlying card fields', () => {
  const result = resolveCardApiTransactionIdentity(providerSale({
    id: 'ebay-graded',
    title: '2024 Topps Chrome Shohei Ohtani #17 Refractor PSA 10 Non Auto No Patch Unnumbered'
  }));

  assert.equal(result.classification, RESOLUTION_CLASSIFICATIONS.EXACT);
  assert.equal(result.canonicalIdentity.normalized.subject.name, 'shohei ohtani');
  assert.equal(result.canonicalIdentity.normalized.cardNumber, '17');
  assert.equal(result.canonicalIdentity.normalized.rawOrGraded, 'graded');
  assert.equal(result.canonicalIdentity.normalized.grading.company, 'psa');
  assert.equal(result.canonicalIdentity.normalized.grading.grade, '10');
});

test('noisy listings with multiple player references become ambiguous rather than exact', () => {
  const result = resolveCardApiTransactionIdentity(providerSale({
    id: 'ebay-noisy',
    title: '2024 Topps Chrome Shohei Ohtani Mike Trout Lot #17 #27 Refractor Raw'
  }));

  assert.equal(result.classification, RESOLUTION_CLASSIFICATIONS.AMBIGUOUS);
  assert.equal(result.identityExact, false);
  assert.equal(result.missingMaterialFields.includes('subjectName'), true);
});

test('missing material identity fields remain unresolved and are never fabricated', () => {
  const result = resolveCardApiTransactionIdentity(providerSale({
    id: 'ebay-unresolved',
    title: 'Baseball card sale raw',
    year: null,
    card_number: null,
    player: null,
    card_set: null,
    manufacturer: null
  }));

  assert.equal(result.classification, RESOLUTION_CLASSIFICATIONS.UNRESOLVED);
  assert.equal(result.identityExact, false);
  assert.equal(result.canonicalIdentity.normalized.subject.name, 'unknown');
  assert.equal(result.fieldProvenance.subjectName.source, 'unresolved');
  assert.equal(result.canonicalSoldEvidenceStructurallyReady, false);
});

test('provider metadata and title-derived metadata conflicts are surfaced', () => {
  const result = resolveCardApiTransactionIdentity(providerSale({
    id: 'ebay-conflict',
    title: '2023 Topps Chrome Shohei Ohtani #17 Refractor Non Auto No Patch Unnumbered Raw',
    year: 2024,
    player: 'Shohei Ohtani',
    manufacturer: 'Topps',
    product: 'Topps Chrome',
    card_set: 'Topps Chrome',
    card_number: '17',
    parallel: 'Refractor'
  }));

  assert.equal(result.classification, RESOLUTION_CLASSIFICATIONS.AMBIGUOUS);
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].field, 'year');
  assert.equal(result.conflicts[0].providerValue, 2024);
  assert.equal(result.conflicts[0].titleValue, '2023');
  assert.equal(result.fieldProvenance.year.source, 'conflict_provider_preferred_for_review');
});

test('parallel, auto, and serial-number distinctions are resolved only when determinable', () => {
  const auto = resolveCardApiTransactionIdentity(providerSale({
    id: 'ebay-auto',
    title: '2024 Topps Chrome Shohei Ohtani #17 Blue Auto No Patch /150 Raw'
  }));
  const serial = resolveCardApiTransactionIdentity(providerSale({
    id: 'ebay-serial',
    title: '2024 Topps Chrome Shohei Ohtani #17 Gold Non Auto No Patch /50 Raw'
  }));

  assert.equal(auto.classification, RESOLUTION_CLASSIFICATIONS.EXACT);
  assert.equal(auto.canonicalIdentity.normalized.parallel, 'blue');
  assert.equal(auto.canonicalIdentity.normalized.autograph.state, true);
  assert.equal(auto.canonicalIdentity.normalized.serialNumbered, true);
  assert.equal(auto.canonicalIdentity.normalized.printRun, 150);

  assert.equal(serial.classification, RESOLUTION_CLASSIFICATIONS.EXACT);
  assert.equal(serial.canonicalIdentity.normalized.parallel, 'gold');
  assert.equal(serial.canonicalIdentity.normalized.autograph.state, false);
  assert.equal(serial.canonicalIdentity.normalized.serialNumbered, true);
  assert.equal(serial.canonicalIdentity.normalized.printRun, 50);
});

test('explicit provider metadata can be confirmed by deterministic title parsing', () => {
  const result = resolveCardApiTransactionIdentity(providerSale({
    id: 'ebay-explicit',
    title: '2024 Topps Chrome Shohei Ohtani #17 Refractor Non Auto No Patch Unnumbered Raw',
    year: 2024,
    player: 'Shohei Ohtani',
    manufacturer: 'Topps',
    product: 'Topps Chrome',
    card_set: 'Topps Chrome',
    card_number: '17',
    parallel: 'Refractor'
  }));

  assert.equal(result.classification, RESOLUTION_CLASSIFICATIONS.EXACT);
  assert.equal(result.fieldProvenance.year.source, 'explicit_provider_metadata_and_title_confirmed');
  assert.equal(result.fieldProvenance.subjectName.source, 'explicit_provider_metadata_and_title_confirmed');
  assert.equal(result.structuredProviderMetadataUsed, true);
});

test('batch summary is deterministic and reports exact, ambiguous, unresolved, and conflict counts', () => {
  const batch = resolveCardApiIdentityBatch([
    providerSale({ id: 'ebay-exact-1' }),
    providerSale({ id: 'ebay-ambiguous', title: '2024 Topps Chrome Shohei Ohtani Mike Trout Lot #17 #27 Refractor Raw' }),
    providerSale({ id: 'ebay-unresolved-2', title: 'Baseball card sale raw' }),
    providerSale({
      id: 'ebay-conflict-2',
      title: '2023 Topps Chrome Shohei Ohtani #17 Refractor Non Auto No Patch Unnumbered Raw',
      year: 2024,
      player: 'Shohei Ohtani',
      manufacturer: 'Topps',
      product: 'Topps Chrome',
      card_set: 'Topps Chrome',
      card_number: '17',
      parallel: 'Refractor'
    })
  ]);
  const repeated = resolveCardApiIdentityBatch([
    providerSale({ id: 'ebay-exact-1' }),
    providerSale({ id: 'ebay-ambiguous', title: '2024 Topps Chrome Shohei Ohtani Mike Trout Lot #17 #27 Refractor Raw' }),
    providerSale({ id: 'ebay-unresolved-2', title: 'Baseball card sale raw' }),
    providerSale({
      id: 'ebay-conflict-2',
      title: '2023 Topps Chrome Shohei Ohtani #17 Refractor Non Auto No Patch Unnumbered Raw',
      year: 2024,
      player: 'Shohei Ohtani',
      manufacturer: 'Topps',
      product: 'Topps Chrome',
      card_set: 'Topps Chrome',
      card_number: '17',
      parallel: 'Refractor'
    })
  ]);

  assert.equal(batch.summary.evaluated, 4);
  assert.equal(batch.summary.exact, 1);
  assert.equal(batch.summary.ambiguous, 2);
  assert.equal(batch.summary.unresolved, 1);
  assert.equal(batch.summary.conflicts, 1);
  assert.equal(batch.summary.retentionBlocked, 4);
  assert.equal(batch.batchFingerprint, repeated.batchFingerprint);
  assert.deepEqual(batch.summary, summarizeCardApiIdentityResolution(batch.resolutions));
});

test('parser exposes deterministic title facts without image/OCR or live requests', () => {
  const parsed = parseTitleIdentity('2024 Topps Chrome Shohei Ohtani #17 Refractor PSA 10 Non Auto No Patch Unnumbered');

  assert.equal(parsed.subjectName, 'Shohei Ohtani');
  assert.equal(parsed.year, '2024');
  assert.equal(parsed.manufacturer, 'Topps');
  assert.equal(parsed.parallel, 'Refractor');
  assert.equal(parsed.rawOrGraded, 'graded');
  assert.equal(parsed.gradeCompany, 'PSA');
  assert.equal(parsed.autographState, false);
  assert.equal(parsed.memorabiliaState, false);
  assert.equal(parsed.serialNumbered, false);
});

test('pilot module has no persistence, notification, scanner, or authority imports', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'validation', 'cardApiIdentityResolutionPilot.js'), 'utf8');

  for (const forbidden of [
    'addSoldEvidenceRecord',
    'saveSoldEvidenceStore',
    'saveScoutedListing',
    'appStore',
    'stateStore',
    'notification',
    'scoutScannerService',
    'targetedDiscoveryLaneService',
    'ebayMarketplace',
    'server.js',
    'BUY_NOW',
    'fetch('
  ]) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});
