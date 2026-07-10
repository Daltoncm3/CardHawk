'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  EVIDENCE_TYPES,
  normalizeAdapterRecord,
  normalizeCapabilities
} = require('../marketplaces/soldEvidenceAdapter');
const {
  addSoldEvidenceRecord,
  buildCanonicalCardKey,
  createEmptySoldEvidenceStore,
  findSoldEvidenceByIdentity
} = require('../utils/soldEvidenceStore');
const { validateImportRecord } = require('../validation/importSoldEvidence');

const fixturePath = path.join(__dirname, 'fixtures', 'sold-evidence', 'validation-cases.json');
const dataset = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

function capabilitiesFor(testCase) {
  return normalizeCapabilities({
    transactionLevelSoldSupport: true,
    acceptedBestOfferSupport: true,
    shippingSupport: true,
    certificationSupport: true,
    aggregateMarketPriceSupport: true,
    activeContextSupport: true,
    accessMode: 'fixture',
    sourceReliability: 'fixture',
    ...(testCase.sourceCapabilities || {})
  });
}

function normalizeFixture(testCase) {
  return normalizeAdapterRecord(testCase.record, {
    marketplace: testCase.record.marketplace || 'fixture_market',
    marketplaceLabel: testCase.record.marketplace || 'Fixture Market',
    sourceName: 'Sold Evidence Fixture Dataset',
    adapterName: 'sold_evidence_fixture_adapter',
    capabilities: capabilitiesFor(testCase)
  }, {
    retrievalMethod: 'fixture'
  });
}

function freshnessFor(record, asOf) {
  if (!record.soldAt) return 'unknown';

  const daysOld = Math.floor((new Date(asOf).getTime() - new Date(record.soldAt).getTime()) / 86400000);
  if (!Number.isFinite(daysOld) || daysOld < 0) return 'unknown';
  return daysOld > 180 ? 'stale' : 'fresh';
}

function importableAsTrueSold(testCase, record) {
  if (record.evidenceType !== EVIDENCE_TYPES.TRUE_SOLD) return false;
  return validateImportRecord(testCase.record).valid;
}

test('sold evidence fixture dataset includes every required validation scenario', () => {
  const ids = new Set(dataset.cases.map((testCase) => testCase.id));

  [
    'exact-true-sold-match',
    'duplicate-sold-record',
    'same-card-sold-twice-different-sale-ids',
    'active-listing-incorrectly-labeled-sold',
    'missing-sold-price',
    'missing-sold-date',
    'best-offer-undisclosed-final-price',
    'raw-vs-graded-mismatch',
    'base-vs-parallel-mismatch',
    'numbered-vs-unnumbered-mismatch',
    'cross-marketplace-same-card',
    'stale-sold-evidence',
    'strong-recent-sold-evidence',
    'aggregate-market-price-context'
  ].forEach((id) => assert.equal(ids.has(id), true, `${id} fixture missing`));
});

test('all sold evidence fixtures normalize through the canonical sold evidence path', () => {
  for (const testCase of dataset.cases) {
    const record = normalizeFixture(testCase);

    assert.equal(record.evidenceType, testCase.expected.evidenceType, testCase.id);
    assert.equal(record.source.adapter, 'sold_evidence_fixture_adapter', testCase.id);
    assert.equal(record.source.retrievalMethod, 'fixture', testCase.id);
    assert.ok(record.canonicalCardKey, testCase.id);
    assert.ok(Array.isArray(record.duplicateKeys), testCase.id);

    if (testCase.expected.condition) {
      assert.equal(record.condition, testCase.expected.condition, testCase.id);
    }
    if (testCase.expected.evidenceQualityLevel) {
      assert.equal(record.evidenceQualityLevel, testCase.expected.evidenceQualityLevel, testCase.id);
    }
  }
});

test('fixture importability validates deduplication and rejection expectations', () => {
  let store = createEmptySoldEvidenceStore();
  const results = [];

  for (const testCase of dataset.cases) {
    const record = normalizeFixture(testCase);
    const shouldImport = importableAsTrueSold(testCase, record);

    if (!shouldImport) {
      const validation = validateImportRecord(testCase.record);
      results.push({
        id: testCase.id,
        inserted: false,
        duplicate: false,
        rejected: record.evidenceType !== EVIDENCE_TYPES.TRUE_SOLD || !validation.valid,
        rejectionReasons: validation.reasons
      });
      continue;
    }

    const result = addSoldEvidenceRecord(store, record, { mutate: true });
    store = result.store;
    results.push({
      id: testCase.id,
      inserted: result.inserted,
      duplicate: result.duplicate,
      duplicateOf: result.duplicateOf
    });
  }

  const byId = Object.fromEntries(results.map((result) => [result.id, result]));

  assert.equal(byId['exact-true-sold-match'].inserted, true);
  assert.equal(byId['duplicate-sold-record'].duplicate, true);
  assert.equal(byId['same-card-sold-twice-different-sale-ids'].inserted, true);
  assert.equal(byId['active-listing-incorrectly-labeled-sold'].rejected, true);
  assert.equal(byId['missing-sold-price'].rejected, true);
  assert.ok(byId['missing-sold-price'].rejectionReasons.includes('missing_sold_price'));
  assert.equal(byId['missing-sold-date'].rejected, true);
  assert.ok(byId['missing-sold-date'].rejectionReasons.includes('missing_sold_date'));
  assert.equal(byId['best-offer-undisclosed-final-price'].rejected, true);
  assert.ok(byId['best-offer-undisclosed-final-price'].rejectionReasons.includes('missing_sold_price'));
  assert.equal(store.stats.recordCount, 8);
  assert.equal(store.stats.duplicateInsertions, 1);
});

test('identity lookup returns only true sold active evidence for the canonical target identity', () => {
  let store = createEmptySoldEvidenceStore();
  const targetKey = buildCanonicalCardKey(dataset.targetIdentity);

  for (const testCase of dataset.cases) {
    const record = normalizeFixture(testCase);
    if (importableAsTrueSold(testCase, record) || record.evidenceType !== EVIDENCE_TYPES.TRUE_SOLD) {
      store = addSoldEvidenceRecord(store, record, { mutate: true }).store;
    }
  }

  const matches = findSoldEvidenceByIdentity(store, dataset.targetIdentity);
  const matchIds = new Set(matches.map((record) => record.marketplaceSaleId));

  assert.equal(matches.every((record) => record.status === 'active_evidence'), true);
  assert.equal(matches.every((record) => record.evidenceType === EVIDENCE_TYPES.TRUE_SOLD), true);
  assert.equal(matches.every((record) => record.canonicalCardKey === targetKey), true);
  assert.equal(matchIds.has('ebay-sold-001'), true);
  assert.equal(matchIds.has('ebay-sold-002'), true);
  assert.equal(matchIds.has('comc-sold-001'), true);
  assert.equal(matchIds.has('base-001'), false);
  assert.equal(matchIds.has('numbered-001'), false);
  assert.equal(matchIds.has('aggregate-001'), false);
  assert.equal(matchIds.has('active-001'), false);
});

test('stale and fresh fixture classifications match expected outcomes', () => {
  for (const testCase of dataset.cases) {
    const record = normalizeFixture(testCase);
    assert.equal(freshnessFor(record, dataset.asOf), testCase.expected.freshness, testCase.id);
  }
});

test('active context and aggregate market price fixtures cannot satisfy true sold support', () => {
  const activeCase = dataset.cases.find((testCase) => testCase.id === 'active-listing-incorrectly-labeled-sold');
  const aggregateCase = dataset.cases.find((testCase) => testCase.id === 'aggregate-market-price-context');
  const activeRecord = normalizeFixture(activeCase);
  const aggregateRecord = normalizeFixture(aggregateCase);

  assert.equal(activeRecord.evidenceType, EVIDENCE_TYPES.ACTIVE_CONTEXT);
  assert.equal(activeRecord.status, 'context_only');
  assert.equal(aggregateRecord.evidenceType, EVIDENCE_TYPES.AGGREGATE_MARKET_PRICE);
  assert.equal(aggregateRecord.status, 'context_only');
  assert.equal(importableAsTrueSold(activeCase, activeRecord), false);
  assert.equal(importableAsTrueSold(aggregateCase, aggregateRecord), false);
});
