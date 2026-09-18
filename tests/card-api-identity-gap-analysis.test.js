'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  RESOLUTION_CLASSIFICATIONS,
  buildCardApiIdentityGapReport,
  parseTitleIdentity,
  resolveCardApiTransactionIdentity
} = require('../validation/cardApiIdentityResolutionPilot');

function sale(overrides = {}) {
  return {
    id: 'provider-id-that-must-not-appear',
    platform: 'eBay',
    listing_type: 'fixed_price',
    title: '2024 Topps Chrome Shohei Ohtani No. 17 Base Non Auto No Patch Unnumbered Raw',
    sold_at: '2026-09-17T00:00:00Z',
    sale_date: '2026-09-17',
    price: 10,
    currency: 'USD',
    price_confirmed: true,
    listing_url: 'https://www.ebay.com/itm/provider-id-that-must-not-appear',
    image_url: 'https://images.example.test/provider-id-that-must-not-appear.jpg',
    seller: 'seller-must-not-appear',
    buyer: 'buyer-must-not-appear',
    shipping_price: 0,
    category: 'sports',
    ...overrides
  };
}

test('card number formats without hash are parsed only when explicitly labeled', () => {
  const noFormat = resolveCardApiTransactionIdentity(sale({
    title: '2024 Topps Chrome Shohei Ohtani No. 17 Base Non Auto No Patch Unnumbered Raw'
  }));
  const cardFormat = resolveCardApiTransactionIdentity(sale({
    title: '2024 Topps Chrome Shohei Ohtani Card 17 Base Non Auto No Patch Unnumbered Raw'
  }));
  const unlabeledNumber = resolveCardApiTransactionIdentity(sale({
    title: '2024 Topps Chrome Shohei Ohtani 17 Base Non Auto No Patch Unnumbered Raw'
  }));

  assert.equal(noFormat.classification, RESOLUTION_CLASSIFICATIONS.EXACT);
  assert.equal(noFormat.canonicalIdentity.normalized.cardNumber, '17');
  assert.equal(cardFormat.classification, RESOLUTION_CLASSIFICATIONS.EXACT);
  assert.equal(cardFormat.canonicalIdentity.normalized.cardNumber, '17');
  assert.equal(unlabeledNumber.classification, RESOLUTION_CLASSIFICATIONS.AMBIGUOUS);
  assert.equal(unlabeledNumber.missingMaterialFields.includes('cardNumber'), true);
});

test('graded base cards parse grade context without inventing raw state', () => {
  const result = resolveCardApiTransactionIdentity(sale({
    title: '2024 Topps Chrome Shohei Ohtani No. 17 Base PSA GEM MT 10 Non Auto No Patch Unnumbered'
  }));

  assert.equal(result.classification, RESOLUTION_CLASSIFICATIONS.EXACT);
  assert.equal(result.canonicalIdentity.normalized.rawOrGraded, 'graded');
  assert.equal(result.canonicalIdentity.normalized.grading.company, 'psa');
  assert.equal(result.canonicalIdentity.normalized.grading.grade, '10');
});

test('parallel, rookie, autograph, memorabilia, and serial evidence are captured only when explicit', () => {
  const parallel = resolveCardApiTransactionIdentity(sale({
    title: '2024 Topps Chrome Shohei Ohtani #17 Atomic Refractor Non Auto No Patch /99 Raw'
  }));
  const rookie = resolveCardApiTransactionIdentity(sale({
    title: '2024 Topps Chrome Baseball Junior Caminero RC #25 Base Non Auto No Patch Unnumbered Raw'
  }));
  const autoMem = resolveCardApiTransactionIdentity(sale({
    title: '2024 Topps Chrome Shohei Ohtani #17 Blue Auto Patch /25 Raw'
  }));

  assert.equal(parallel.classification, RESOLUTION_CLASSIFICATIONS.EXACT);
  assert.equal(parallel.canonicalIdentity.normalized.parallel, 'atomic refractor');
  assert.equal(parallel.canonicalIdentity.normalized.serialNumbered, true);
  assert.equal(parallel.canonicalIdentity.normalized.printRun, 99);

  assert.equal(rookie.classification, RESOLUTION_CLASSIFICATIONS.EXACT);
  assert.equal(rookie.canonicalIdentity.normalized.rookieDesignation, true);

  assert.equal(autoMem.classification, RESOLUTION_CLASSIFICATIONS.EXACT);
  assert.equal(autoMem.canonicalIdentity.normalized.autograph.state, true);
  assert.equal(autoMem.canonicalIdentity.normalized.memorabilia.state, true);
});

test('unknown values remain unknown when absence cannot safely prove a negative', () => {
  const noAutoEvidence = resolveCardApiTransactionIdentity(sale({
    title: '2024 Topps Chrome Shohei Ohtani #17 Base Raw'
  }));
  const noParallelEvidence = resolveCardApiTransactionIdentity(sale({
    title: '2024 Topps Chrome Shohei Ohtani #17 Non Auto No Patch Unnumbered Raw'
  }));
  const noConditionEvidence = resolveCardApiTransactionIdentity(sale({
    title: '2024 Topps Chrome Shohei Ohtani #17 Base Non Auto No Patch Unnumbered'
  }));

  assert.equal(noAutoEvidence.classification, RESOLUTION_CLASSIFICATIONS.AMBIGUOUS);
  assert.equal(noAutoEvidence.canonicalIdentity.normalized.autograph.state, 'unknown');
  assert.equal(noAutoEvidence.canonicalIdentity.normalized.memorabilia.state, 'unknown');
  assert.equal(noParallelEvidence.classification, RESOLUTION_CLASSIFICATIONS.AMBIGUOUS);
  assert.equal(noParallelEvidence.missingMaterialFields.includes('parallel'), true);
  assert.equal(noConditionEvidence.classification, RESOLUTION_CLASSIFICATIONS.AMBIGUOUS);
  assert.equal(noConditionEvidence.missingMaterialFields.includes('rawOrGraded'), true);
});

test('noisy seller formatting is tolerated only when material evidence remains explicit', () => {
  const result = resolveCardApiTransactionIdentity(sale({
    title: 'WOW HOT INVEST READ 2024 Topps Chrome Shohei Ohtani No. 17 Base Non Auto No Patch Unnumbered Raw L@@K'
  }));

  assert.equal(result.classification, RESOLUTION_CLASSIFICATIONS.EXACT);
  assert.equal(result.canonicalIdentity.normalized.subject.name, 'shohei ohtani');
  assert.equal(result.canonicalIdentity.normalized.parallel, 'base');
});

test('conflicting provider metadata remains visible and prevents exact identity', () => {
  const result = resolveCardApiTransactionIdentity(sale({
    title: '2024 Topps Chrome Shohei Ohtani #17 Base Non Auto No Patch Unnumbered Raw',
    year: 2023,
    player: 'Shohei Ohtani',
    manufacturer: 'Topps',
    product: 'Topps Chrome',
    card_set: 'Topps Chrome',
    card_number: '17',
    parallel: 'Base'
  }));

  assert.equal(result.classification, RESOLUTION_CLASSIFICATIONS.AMBIGUOUS);
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].field, 'year');
  assert.equal(result.canonicalSoldEvidenceStructurallyReady, false);
});

test('sanitized aggregate gap report preserves blocker frequencies without provider identifiers', () => {
  const report = buildCardApiIdentityGapReport([
    sale(),
    sale({
      id: 'second-provider-id-that-must-not-appear',
      title: '2024 Topps Chrome Shohei Ohtani #17 Raw',
      listing_url: 'https://www.ebay.com/itm/second-provider-id-that-must-not-appear',
      image_url: 'https://images.example.test/second-provider-id-that-must-not-appear.jpg'
    }),
    sale({
      id: 'third-provider-id-that-must-not-appear',
      title: 'Baseball card sale raw'
    })
  ]);
  const serialized = JSON.stringify(report);

  assert.equal(report.evaluated, 3);
  assert.equal(report.classifications.exact, 1);
  assert.equal(report.classifications.ambiguous, 1);
  assert.equal(report.classifications.unresolved, 1);
  assert.equal(report.missingMaterialFieldFrequency.parallel >= 1, true);
  assert.equal(report.canonicalSoldEvidenceReadinessBlockerFrequency.identity_resolution_not_exact, 2);
  assert.equal(report.retentionAuthority.persistenceAllowed, false);
  assert.equal(report.productionImpact, 'none');
  assert.equal(report.decisionImpact, 'none');
  assert.equal(report.executionAuthority, 'none');
  assert.equal(Object.isFrozen(report), true);

  for (const forbidden of [
    'provider-id-that-must-not-appear',
    'second-provider-id-that-must-not-appear',
    'third-provider-id-that-must-not-appear',
    'https://www.ebay.com',
    'images.example.test',
    'seller-must-not-appear',
    'buyer-must-not-appear'
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test('gap report fingerprints are deterministic and change when aggregate evidence changes', () => {
  const first = buildCardApiIdentityGapReport([sale()]);
  const repeated = buildCardApiIdentityGapReport([sale()]);
  const changed = buildCardApiIdentityGapReport([sale({
    title: '2024 Topps Chrome Shohei Ohtani #17 Raw'
  })]);

  assert.equal(first.reportFingerprint, repeated.reportFingerprint);
  assert.notEqual(first.reportFingerprint, changed.reportFingerprint);
});

test('parser improvements do not add runtime, persistence, scanner, or authority imports', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'validation', 'cardApiIdentityResolutionPilot.js'), 'utf8');

  for (const forbidden of [
    'saveScoutedListing',
    'targetedDiscoveryLaneService',
    'scoutScannerService',
    'stateStore',
    'notification',
    'server.js',
    'BUY_NOW',
    'fetch('
  ]) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});

test('deterministic title parser facts expose unknowns rather than inferred negatives', () => {
  const parsed = parseTitleIdentity('2024 Topps Chrome Shohei Ohtani #17 Raw');

  assert.equal(parsed.parallel, null);
  assert.equal(parsed.autographState, 'unknown');
  assert.equal(parsed.memorabiliaState, 'unknown');
  assert.equal(parsed.serialNumbered, 'unknown');
  assert.equal(parsed.rawOrGraded, 'raw');
});
