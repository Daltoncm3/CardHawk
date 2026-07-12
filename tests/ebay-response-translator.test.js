'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createCanonicalAcquisitionAdapter
} = require('../marketplaces/canonicalAcquisitionInterface');
const {
  TRANSLATOR_VERSION,
  createEbayTranslatorSourceMetadata,
  translateEbayFixtureLibrary,
  translateEbayFixtureToRawCanonical,
  translateEbayRecordToRawCanonical,
  validateTranslatedEbayRecord
} = require('../marketplaces/ebayResponseTranslator');
const {
  runAcquisitionAdapterConformance
} = require('../validation/acquisitionAdapterConformance');
const {
  runAcquisitionToStorePipelineConformance
} = require('../validation/acquisitionToStorePipelineConformance');
const {
  CERTIFICATION_LEVELS,
  runMarketplaceAdapterCertification
} = require('../validation/marketplaceAdapterCertification');
const {
  loadEbayFixtureLibrary
} = require('../validation/ebayFixtureLibrary');

function getFixture(id) {
  return loadEbayFixtureLibrary().fixtures.find((fixture) => fixture.id === id);
}

function buildTranslatorAdapter(fixtures) {
  const source = createEbayTranslatorSourceMetadata({
    sourceId: 'ebay_fixture_response_translator_test',
    adapterName: 'ebay_response_translator_test',
    adapterVersion: TRANSLATOR_VERSION
  });

  return createCanonicalAcquisitionAdapter({
    sourceId: source.sourceId,
    marketplace: 'ebay',
    marketplaceLabel: 'eBay',
    sourceName: source.sourceName,
    adapterName: source.adapterName,
    adapterVersion: source.adapterVersion,
    capabilities: source.capabilities,
    acquire: async (request) => ({
      request,
      records: fixtures.map((fixture) => translateEbayFixtureToRawCanonical(fixture, {
        sourceMetadata: source,
        acquiredAt: '2026-07-12T00:00:00.000Z'
      })),
      metadata: {
        fixtureOnly: true,
        networkAccess: false,
        translatorVersion: TRANSLATOR_VERSION
      }
    }),
    healthCheck: async () => ({
      status: 'ready',
      networkAccess: false,
      fixtureOnly: true
    })
  });
}

test('standard eBay fixture translates to canonical acquisition sold record fields', () => {
  const fixture = getFixture('ebay-standard-sold-psa10-rookie');
  const record = translateEbayFixtureToRawCanonical(fixture, {
    acquiredAt: '2026-07-12T00:00:00.000Z'
  });
  const validation = validateTranslatedEbayRecord(record);

  assert.equal(record.marketplace, 'ebay');
  assert.equal(record.marketplaceListingId, 'std-psa10-001');
  assert.equal(record.ebayItemId, 'std-psa10-001');
  assert.equal(record.rawTitle, '2023 Panini Prizm UFC Anthony Hernandez #181 Silver Prizm RC PSA 10');
  assert.equal(record.evidenceType, 'true_sold');
  assert.equal(record.saleType, 'buy_it_now');
  assert.equal(record.soldPrice, 42.5);
  assert.equal(record.shipping, 4.99);
  assert.equal(record.currency, 'USD');
  assert.equal(record.soldAt, '2026-07-01T15:30:00.000Z');
  assert.equal(record.condition, 'graded');
  assert.equal(record.gradeCompany, 'PSA');
  assert.equal(record.grade, '10');
  assert.equal(record.seller.username, 'trusted-cards');
  assert.equal(record.seller.feedbackScore, 12000);
  assert.equal(record.parsedIdentity.player, 'Anthony Hernandez');
  assert.equal(record.parsedIdentity.setName, 'Prizm UFC');
  assert.equal(record.parsedIdentity.cardNumber, '181');
  assert.equal(record.parsedIdentity.parallel, 'Silver Prizm');
  assert.equal(record.parsedIdentity.rookie, true);
  assert.equal(record.source.adapter, 'ebay_response_translator');
  assert.equal(record.source.retrievalMethod, 'offline_fixture_response_translation');
  assert.equal(record.source.sourceReliability, 'offline_fixture');
  assert.equal(validation.valid, true);
});

test('translator normalizes listing type, Best Offer disclosure, and non-sold evidence safeguards', () => {
  const disclosed = translateEbayFixtureToRawCanonical(getFixture('ebay-best-offer-accepted-disclosed'));
  const undisclosed = translateEbayFixtureToRawCanonical(getFixture('ebay-best-offer-undisclosed'));

  assert.equal(disclosed.saleType, 'best_offer');
  assert.equal(disclosed.bestOfferAccepted, true);
  assert.equal(disclosed.evidenceType, 'true_sold');
  assert.equal(disclosed.soldPrice, 525);

  assert.equal(undisclosed.saleType, 'best_offer');
  assert.equal(undisclosed.bestOfferAccepted, true);
  assert.equal(undisclosed.priceDisclosure, 'undisclosed');
  assert.equal(undisclosed.evidenceType, 'aggregate_market_price');
  assert.equal(undisclosed.translationWarnings.some((warning) => warning.code === 'undisclosed_best_offer_price'), true);
  assert.equal(validateTranslatedEbayRecord(undisclosed).valid, false);
});

test('translator preserves ambiguity warnings for variation and lot fixtures', () => {
  const variation = translateEbayFixtureToRawCanonical(getFixture('ebay-multi-variation-listing'));
  const lot = translateEbayFixtureToRawCanonical(getFixture('ebay-multi-card-lot'));

  assert.equal(variation.evidenceType, 'active_context');
  assert.equal(variation.translationWarnings.some((warning) => warning.code === 'multi_variation_identity_ambiguous'), true);
  assert.equal(lot.evidenceType, 'active_context');
  assert.equal(lot.translationWarnings.some((warning) => warning.code === 'multi_card_lot_not_single_card_price'), true);
});

test('translator normalizes graded, raw, auto, relic, serial, and TCG identity dimensions', () => {
  const raw = translateEbayFixtureToRawCanonical(getFixture('ebay-raw-card-condition-sensitive'));
  const auto = translateEbayFixtureToRawCanonical(getFixture('ebay-autograph-card'));
  const relic = translateEbayFixtureToRawCanonical(getFixture('ebay-relic-card'));
  const serial = translateEbayFixtureToRawCanonical(getFixture('ebay-serial-numbered-card'));
  const tcg = translateEbayFixtureToRawCanonical(getFixture('ebay-cgc-graded-card'));

  assert.equal(raw.condition, 'raw');
  assert.equal(raw.gradeCompany, 'raw');
  assert.equal(auto.parsedIdentity.autograph, true);
  assert.equal(auto.parsedIdentity.memorabilia, true);
  assert.equal(relic.parsedIdentity.memorabilia, true);
  assert.equal(relic.parsedIdentity.serialNumbered, true);
  assert.equal(serial.parsedIdentity.serialNumbered, true);
  assert.equal(serial.parsedIdentity.printRun, 25);
  assert.equal(tcg.parsedIdentity.category, 'tcg_card');
  assert.equal(tcg.parsedIdentity.game, 'pokemon');
  assert.equal(tcg.gradeCompany, 'CGC');
});

test('raw eBay records without fixture expectations degrade with structured warnings', () => {
  const record = translateEbayRecordToRawCanonical({
    itemId: '',
    title: '',
    itemWebUrl: 'not-a-url',
    price: { value: 'not-a-number', currency: 'USD' },
    itemEndDate: 'not-a-date'
  });
  const warningCodes = record.translationWarnings.map((warning) => warning.code);

  assert.equal(record.evidenceType, 'fallback_unknown');
  assert.equal(warningCodes.includes('missing_item_id'), true);
  assert.equal(warningCodes.includes('missing_title'), true);
  assert.equal(warningCodes.includes('invalid_source_url'), true);
  assert.equal(warningCodes.includes('missing_sold_price'), true);
  assert.equal(warningCodes.includes('missing_sold_date'), true);
});

test('fixture library translation returns canonical acquisition-compatible output', () => {
  const library = loadEbayFixtureLibrary();
  const result = translateEbayFixtureLibrary(library);

  assert.equal(result.source.marketplace, 'ebay');
  assert.equal(result.source.responseTranslator.networkAccess, false);
  assert.equal(result.records.length, library.fixtures.length);
  assert.equal(result.summary.trueSoldCount >= 8, true);
  assert.equal(result.translationSummary.fixtureCount, library.fixtures.length);
  assert.equal(result.translationSummary.warningCount > 0, true);
  assert.equal(result.metadata.networkAccess, false);
  assert.equal(result.records.some((record) => record.evidenceType === 'aggregate_market_price'), true);
  assert.equal(result.records.some((record) => record.evidenceType === 'active_context'), true);
});

test('translated duplicate fixtures preserve source identifiers for later deduplication', () => {
  const first = translateEbayFixtureToRawCanonical(getFixture('ebay-duplicate-listing-a'));
  const second = translateEbayFixtureToRawCanonical(getFixture('ebay-duplicate-listing-b'));

  assert.equal(first.marketplaceListingId, 'duplicate-001');
  assert.equal(second.marketplaceListingId, 'duplicate-001');
  assert.equal(first.url, second.url);
  assert.equal(first.soldAt, second.soldAt);
});

test('fixture-backed translator adapter passes acquisition conformance without live network access', async () => {
  const fixtures = [
    getFixture('ebay-standard-sold-psa10-rookie'),
    getFixture('ebay-auction-sale-raw'),
    getFixture('ebay-buy-it-now-sale')
  ];
  const adapter = buildTranslatorAdapter(fixtures);
  const report = await runAcquisitionAdapterConformance(adapter);

  assert.equal(report.passed, true);
  assert.equal(report.diagnostics.validResultSummary.trueSoldCount, 3);
  assert.equal(report.adapter.adapterName, 'ebay_response_translator_test');
});

test('translated valid subset passes acquisition-to-store pipeline conformance', async () => {
  const fixtures = [
    getFixture('ebay-standard-sold-psa10-rookie'),
    getFixture('ebay-auction-sale-raw'),
    getFixture('ebay-buy-it-now-sale')
  ];
  const adapter = buildTranslatorAdapter(fixtures);
  const report = await runAcquisitionToStorePipelineConformance(adapter);

  assert.equal(report.passed, true);
  assert.equal(report.summary.eligibleRecords, 3);
  assert.equal(report.summary.rejectedRecords, 0);
});

test('translated valid subset can be certified as fixture-only but not Production Approved', async () => {
  const fixtures = [
    getFixture('ebay-standard-sold-psa10-rookie'),
    getFixture('ebay-auction-sale-raw'),
    getFixture('ebay-buy-it-now-sale')
  ];
  const adapter = buildTranslatorAdapter(fixtures);
  const report = await runMarketplaceAdapterCertification(adapter);

  assert.equal(report.certificationLevel, CERTIFICATION_LEVELS.CERTIFIED);
  assert.equal(report.productionApproved, false);
  assert.equal(report.adapter.adapterName, 'ebay_response_translator_test');
  assert.equal(report.capabilities.transactionLevelSoldSupport, true);
});
