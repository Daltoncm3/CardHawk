'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const canonicalIdentityEngine = require('../engines/canonicalIdentityEngine');
const server = require('../server');
const { createEmptySoldEvidenceStore } = require('../utils/soldEvidenceStore');

const IDENTITY_FIXTURE_PATH = path.join(__dirname, 'fixtures', 'canonical-identity', 'identity-fixtures.json');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function targetIdentity() {
  const library = JSON.parse(fs.readFileSync(IDENTITY_FIXTURE_PATH, 'utf8'));
  return clone(library.fixtures.find((entry) => entry.id === 'sports-psa10-rookie-base').identity);
}

function buildListing(overrides = {}) {
  return {
    ebayItemId: 'shadow-sold-target',
    title: '2020 Panini Prizm Joe Burrow RC #307 PSA 10',
    price: 90,
    shipping: 5,
    totalCost: 95,
    sellerFeedbackPercentage: 99.7,
    sellerFeedbackScore: 800,
    parsed: {
      sport: 'Football',
      player: 'Joe Burrow',
      year: 2020,
      brand: 'Panini',
      product: 'Prizm',
      setName: 'Prizm',
      cardNumber: '307',
      parallel: 'Base',
      rookie: true,
      autograph: false,
      memorabilia: false,
      serialNumbered: false,
      rawOrGraded: 'graded',
      gradeCompany: 'PSA',
      grade: '10'
    },
    ...overrides
  };
}

function buildUniverse() {
  return [
    {
      ebayItemId: 'legacy-sold-1',
      title: '2020 Panini Prizm Joe Burrow RC #307 PSA 10',
      price: 140,
      sold: true,
      status: 'sold',
      soldAt: '2026-07-01T00:00:00.000Z'
    },
    {
      ebayItemId: 'legacy-active-1',
      title: '2020 Panini Prizm Joe Burrow RC #307 PSA 10',
      price: 150,
      status: 'active'
    }
  ];
}

function productionProjection(scoring = {}) {
  const dealGrade = scoring.dealGrade
    ? Object.fromEntries(Object.entries(scoring.dealGrade).filter(([key]) => key !== 'createdAt'))
    : scoring.dealGrade;

  return JSON.parse(JSON.stringify({
    score: scoring.score,
    estimatedValue: scoring.estimatedValue,
    estimatedProfit: scoring.estimatedProfit,
    roi: scoring.roi,
    ebayFees: scoring.ebayFees,
    compData: scoring.compData,
    marketData: scoring.marketData,
    roiData: scoring.roiData,
    confidenceData: scoring.confidenceData,
    marketConfidence: scoring.marketConfidence,
    confidenceCap: scoring.confidenceCap,
    compCount: scoring.compCount,
    compSource: scoring.compSource,
    qualityData: scoring.qualityData,
    investmentQuality: scoring.investmentQuality,
    qualityBucket: scoring.qualityBucket,
    riskLevel: scoring.riskLevel,
    decision: scoring.decision,
    dealGrade,
    marketIntelligenceScore: scoring.marketIntelligenceScore,
    marketTrustLevel: scoring.marketTrustLevel,
    marketRecommendation: scoring.marketRecommendation
  }));
}

function soldRecord(identity, overrides = {}) {
  return {
    id: overrides.id || 'canonical-sale-1',
    marketplace: 'ebay',
    marketplaceSaleId: overrides.marketplaceSaleId || overrides.id || 'canonical-sale-1',
    evidenceType: 'true_sold',
    status: 'active_evidence',
    rawTitle: identity.raw.title,
    soldPrice: 140,
    totalPaid: 145,
    soldAt: '2026-07-01T00:00:00.000Z',
    identityConfidence: 0.98,
    evidenceQualityScore: 92,
    priceConfidence: 0.95,
    soldDateConfidence: 0.95,
    canonicalIdentity: identity,
    ...overrides
  };
}

function shadowInput(overrides = {}) {
  const identity = overrides.identity || targetIdentity();
  return {
    listing: buildListing({ canonicalIdentity: identity, ...(overrides.listing || {}) }),
    compData: overrides.compData || { compCount: 0, trueSoldCompCount: 0, selectedComps: [] },
    canonicalSoldEvidence: {
      records: overrides.records || [],
      queryDiagnostics: {
        storeLoaded: true,
        storeRecordCount: overrides.storeRecordCount ?? (overrides.records || []).length,
        identityLookupKey: overrides.identityLookupKey ?? 'sports-card-key',
        identityLookupSource: overrides.identityLookupSource || 'listing.canonicalIdentity',
        legacySoldEvidenceKey: overrides.legacySoldEvidenceKey || 'legacy-card-key',
        recordsBeforeTrueSoldFilter: overrides.recordsBeforeTrueSoldFilter ?? (overrides.records || []).length,
        recordsAfterTrueSoldFilter: overrides.recordsAfterTrueSoldFilter ?? (overrides.records || []).length,
        sourceTraceSummaries: (overrides.records || []).map((record) => ({
          recordId: record.id,
          marketplace: record.marketplace,
          marketplaceSaleId: record.marketplaceSaleId,
          marketplaceListingId: record.marketplaceListingId || null,
          sourceAdapter: record.source?.adapter || 'fixture_adapter',
          sourceReliability: record.source?.sourceReliability || 'fixture',
          retrievalMethod: record.source?.retrievalMethod || 'fixture',
          sourceUrl: record.url || ''
        }))
      },
      ...(overrides.canonicalSoldEvidence || {})
    }
  };
}

test('scoreListing exposes shadowSoldComparison as an additive runtime object with missing evidence handled safely', () => {
  server.__setCanonicalSoldEvidenceStoreForTest(createEmptySoldEvidenceStore());
  try {
    const scoring = server.scoreListing(buildListing(), buildUniverse());

    assert.ok(scoring.shadowSoldComparison);
    assert.equal(scoring.shadowSoldComparison.comparisonPerformed, false);
    assert.equal(scoring.shadowSoldComparison.comparisonSource, 'canonical_sold_comparison_service_shadow');
    assert.equal(scoring.shadowSoldComparison.productionImpact, 'none');
    assert.equal(scoring.shadowSoldComparison.decisionImpact, 'none');
    assert.deepEqual(scoring.shadowSoldComparison.acceptedExactMatches, []);
    assert.deepEqual(scoring.shadowSoldComparison.contextualMatches, []);
    assert.deepEqual(scoring.shadowSoldComparison.rejectedMatches, []);
    assert.equal(scoring.shadowSoldComparison.processingSummary.processedRecords, 0);
  } finally {
    server.__setCanonicalSoldEvidenceStoreForTest(null);
  }
});

test('shadow diagnostics are additive only and do not change production output fields', () => {
  server.__setCanonicalSoldEvidenceStoreForTest(createEmptySoldEvidenceStore());
  try {
    const scoring = server.scoreListing(buildListing(), buildUniverse());
    const beforeProjection = productionProjection(scoring);
    const shadow = scoring.shadowSoldComparison;
    const afterProjection = productionProjection({ ...scoring, shadowSoldComparison: shadow });

    assert.deepEqual(afterProjection, beforeProjection);
    assert.equal(shadow.productionImpact, 'none');
    assert.equal(shadow.decisionImpact, 'none');
  } finally {
    server.__setCanonicalSoldEvidenceStoreForTest(null);
  }
});

test('shadow sold comparison performs deterministic canonical comparison and contrasts legacy vs canonical systems', () => {
  const identity = targetIdentity();
  const listing = buildListing({ canonicalIdentity: identity });
  const exactRecord = soldRecord(identity, { id: 'canonical-sale-exact' });
  const contextualIdentity = clone(identity);
  contextualIdentity.normalized.parallel = 'silver prizm';
  const rebuiltContextualIdentity = canonicalIdentityEngine.buildCanonicalIdentity({
    canonicalSoldEvidenceIdentity: contextualIdentity
  });
  const contextualRecord = soldRecord(rebuiltContextualIdentity, {
    id: 'canonical-sale-contextual',
    marketplaceSaleId: 'canonical-sale-contextual'
  });
  const compData = {
    compCount: 1,
    trueSoldCompCount: 1,
    soldCompCount: 1,
    activeCompCount: 0,
    selectedComps: [
      {
        id: 'canonical-sale-exact',
        marketplaceSaleId: 'canonical-sale-exact'
      }
    ]
  };
  const canonicalSoldEvidence = {
    records: [exactRecord, contextualRecord]
  };

  const first = server.buildShadowSoldComparison({ listing, compData, canonicalSoldEvidence });
  const second = server.buildShadowSoldComparison({ listing, compData, canonicalSoldEvidence });

  assert.deepEqual(second, first);
  assert.equal(first.comparisonPerformed, true);
  assert.equal(first.canonicalIdentityKey, identity.canonicalIdentityKey);
  assert.equal(first.acceptedExactMatches.length, 1);
  assert.equal(first.contextualMatches.length, 1);
  assert.equal(first.contextualMatches[0].valuationEligible, false);
  assert.equal(first.comparisonSummary.includes('exact canonical sold match'), true);
  assert.equal(first.legacyVsCanonicalComparison.legacyCompEngine.acceptedComparableCount, 1);
  assert.equal(first.legacyVsCanonicalComparison.canonicalSoldComparisonService.exactMatchesFound, 1);
  assert.deepEqual(first.legacyVsCanonicalComparison.recordsAgreedByBoth, ['canonical-sale-exact']);
  assert.deepEqual(first.legacyVsCanonicalComparison.recordsOnlyFoundByCanonical, ['canonical-sale-contextual']);
});

test('shadow comparison never affects runtime decisions', () => {
  server.__setCanonicalSoldEvidenceStoreForTest(createEmptySoldEvidenceStore());
  try {
    const first = server.scoreListing(buildListing(), buildUniverse());
    const second = server.scoreListing(buildListing(), buildUniverse());

    assert.deepEqual(productionProjection(second), productionProjection(first));
    assert.equal(first.shadowSoldComparison.productionImpact, 'none');
    assert.equal(second.shadowSoldComparison.decisionImpact, 'none');
    assert.deepEqual(first.decision, second.decision);
  } finally {
    server.__setCanonicalSoldEvidenceStoreForTest(null);
  }
});

test('empty-result causes are distinguishable with explicit reason codes', () => {
  const identity = targetIdentity();
  const exact = soldRecord(identity, {
    id: 'exact-diagnostic',
    marketplaceSaleId: 'exact-diagnostic',
    source: {
      adapter: 'manual_import',
      sourceReliability: 'verified',
      retrievalMethod: 'manual_review'
    },
    url: 'https://example.test/exact-diagnostic'
  });
  const stale = soldRecord(identity, {
    id: 'stale-diagnostic',
    marketplaceSaleId: 'stale-diagnostic',
    soldAt: '2025-01-01T00:00:00.000Z'
  });
  const rejectedIdentity = clone(identity);
  rejectedIdentity.normalized.subject.name = 'justin herbert';
  const rejected = soldRecord(canonicalIdentityEngine.buildCanonicalIdentity({
    canonicalSoldEvidenceIdentity: rejectedIdentity
  }), {
    id: 'rejected-diagnostic',
    marketplaceSaleId: 'rejected-diagnostic'
  });

  const noStore = server.buildShadowSoldComparison(shadowInput({
    records: [],
    storeRecordCount: 0,
    canonicalSoldEvidence: {
      queryDiagnostics: {
        storeLoaded: false,
        storeRecordCount: 0,
        identityLookupKey: '',
        identityLookupSource: 'listing.canonicalIdentity',
        legacySoldEvidenceKey: '',
        recordsBeforeTrueSoldFilter: 0,
        recordsAfterTrueSoldFilter: 0,
        sourceTraceSummaries: []
      }
    }
  }));
  const emptyStore = server.buildShadowSoldComparison(shadowInput({ records: [], storeRecordCount: 0 }));
  const noLookupKey = server.buildShadowSoldComparison(shadowInput({
    records: [],
    storeRecordCount: 2,
    identityLookupKey: ''
  }));
  const noRecordsForIdentity = server.buildShadowSoldComparison(shadowInput({
    records: [],
    storeRecordCount: 2,
    recordsBeforeTrueSoldFilter: 0,
    recordsAfterTrueSoldFilter: 0
  }));
  const filtered = server.buildShadowSoldComparison(shadowInput({
    records: [],
    storeRecordCount: 2,
    recordsBeforeTrueSoldFilter: 2,
    recordsAfterTrueSoldFilter: 0
  }));
  const staleOnly = server.buildShadowSoldComparison(shadowInput({
    records: [stale],
    storeRecordCount: 1,
    recordsBeforeTrueSoldFilter: 1,
    recordsAfterTrueSoldFilter: 1
  }));
  const allRejected = server.buildShadowSoldComparison(shadowInput({
    records: [rejected],
    storeRecordCount: 1,
    recordsBeforeTrueSoldFilter: 1,
    recordsAfterTrueSoldFilter: 1
  }));
  const exactFound = server.buildShadowSoldComparison(shadowInput({
    records: [exact],
    storeRecordCount: 1,
    recordsBeforeTrueSoldFilter: 1,
    recordsAfterTrueSoldFilter: 1
  }));
  const insufficientTarget = server.buildShadowSoldComparison(shadowInput({
    identity: canonicalIdentityEngine.buildCanonicalIdentity({}),
    listing: { parsed: {} },
    records: [exact],
    storeRecordCount: 1,
    recordsBeforeTrueSoldFilter: 1,
    recordsAfterTrueSoldFilter: 1
  }));

  assert.equal(noStore.emptyReasonCode, 'no_canonical_store');
  assert.equal(emptyStore.emptyReasonCode, 'empty_canonical_store');
  assert.equal(noLookupKey.emptyReasonCode, 'no_identity_lookup_key');
  assert.equal(noRecordsForIdentity.emptyReasonCode, 'no_records_for_identity');
  assert.equal(filtered.emptyReasonCode, 'records_filtered_not_true_sold');
  assert.equal(staleOnly.emptyReasonCode, 'stale_only_records');
  assert.equal(allRejected.emptyReasonCode, 'all_records_rejected');
  assert.equal(exactFound.emptyReasonCode, 'exact_matches_found');
  assert.equal(insufficientTarget.emptyReasonCode, 'insufficient_target_identity');
});

test('pre-filter and post-filter counts reconcile and target identity diagnostics are exposed', () => {
  const identity = targetIdentity();
  const result = server.buildShadowSoldComparison(shadowInput({
    identity,
    records: [],
    storeRecordCount: 4,
    recordsBeforeTrueSoldFilter: 4,
    recordsAfterTrueSoldFilter: 0
  }));

  assert.equal(result.label, 'shadow canonical evidence only');
  assert.equal(result.storeLoaded, true);
  assert.equal(result.storeRecordCount, 4);
  assert.equal(result.identityLookupKey, 'sports-card-key');
  assert.equal(result.identityLookupSource, 'listing.canonicalIdentity');
  assert.equal(result.legacySoldEvidenceKey, 'legacy-card-key');
  assert.equal(result.canonicalIdentityKey, identity.canonicalIdentityKey);
  assert.equal(result.recordsBeforeTrueSoldFilter, 4);
  assert.equal(result.recordsAfterTrueSoldFilter, 0);
  assert.equal(result.targetExactCompEligible, true);
  assert.equal(result.targetValuationEligible, true);
  assert.equal(Array.isArray(result.targetUnknownFields), true);
  assert.equal(Array.isArray(result.targetNormalizationWarnings), true);
  assert.equal(result.targetIdentityDiagnostics.canonicalIdentitySummary.includes('valuation eligible'), true);
});

test('provenance/source trace summaries are deterministic for compared records', () => {
  const identity = targetIdentity();
  const record = soldRecord(identity, {
    id: 'provenance-sale',
    marketplace: 'ebay',
    marketplaceSaleId: 'sale-provenance',
    marketplaceListingId: 'listing-provenance',
    url: 'https://example.test/provenance-sale',
    source: {
      adapter: 'manual_import_adapter',
      sourceReliability: 'verified_manual',
      retrievalMethod: 'reviewed_batch'
    }
  });
  const input = shadowInput({
    records: [record],
    recordsBeforeTrueSoldFilter: 1,
    recordsAfterTrueSoldFilter: 1
  });

  const first = server.buildShadowSoldComparison(input);
  const second = server.buildShadowSoldComparison(input);

  assert.deepEqual(second.sourceTraceSummaries, first.sourceTraceSummaries);
  assert.deepEqual(first.sourceTraceSummaries, [{
    recordId: 'provenance-sale',
    marketplace: 'ebay',
    marketplaceSaleId: 'sale-provenance',
    marketplaceListingId: 'listing-provenance',
    sourceAdapter: 'manual_import_adapter',
    sourceReliability: 'verified_manual',
    retrievalMethod: 'reviewed_batch',
    sourceUrl: 'https://example.test/provenance-sale'
  }]);
  assert.equal(first.productionImpact, 'none');
  assert.equal(first.decisionImpact, 'none');
});
