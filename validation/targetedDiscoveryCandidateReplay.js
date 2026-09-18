'use strict';

const soldEvidenceService = require('../services/soldEvidenceService');
const {
  buildTargetedDiscoveryParsedIdentity,
  classifyListingForCheapTriage,
  createTargetedDiscoveryLaneConfig
} = require('../services/targetedDiscoveryLaneService');
const {
  addSoldEvidenceRecords,
  buildCanonicalCardKey,
  createEmptySoldEvidenceStore
} = require('../utils/soldEvidenceStore');

const SOURCE = 'targeted_discovery_candidate_replay';
const VERSION = '1.0.0';
const SCHEMA_VERSION = '1.0.0';
const DEFAULT_AS_OF = '2026-07-10T12:00:00.000Z';

const ANTHONY_HERNANDEZ_TARGET_IDENTITY = Object.freeze({
  category: 'sports_card',
  sport: 'ufc',
  player: 'Anthony Hernandez',
  year: 2023,
  brand: 'Panini',
  product: 'Prizm UFC',
  setName: 'Prizm',
  cardNumber: '181',
  parallel: 'Silver Prizm',
  rookie: true,
  autograph: false,
  memorabilia: false,
  serialNumbered: false
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadRuntime() {
  return require('../server');
}

function withFixedDate(isoDate, callback) {
  const RealDate = Date;
  const fixedTime = new RealDate(isoDate).getTime();

  global.Date = class FixedDate extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : [fixedTime]));
    }

    static now() {
      return fixedTime;
    }
  };

  try {
    return callback();
  } finally {
    global.Date = RealDate;
  }
}

function buildAnthonyHernandezTrueSoldRecords() {
  return [
    {
      evidenceType: 'true_sold',
      marketplace: 'eBay',
      marketplaceSaleId: 'a3-ah-181-silver-sold-001',
      marketplaceListingId: 'a3-ah-181-listing-001',
      rawTitle: '2023 Panini Prizm UFC Anthony Hernandez #181 Silver Prizm RC Rookie',
      soldPrice: 6.5,
      shipping: 1.25,
      soldAt: '2026-07-01T18:30:00.000Z',
      saleType: 'auction',
      url: 'https://example.test/sold/a3-anthony-hernandez-001',
      condition: 'Raw',
      gradeCompany: 'raw',
      grade: 'unknown',
      parsedIdentity: clone(ANTHONY_HERNANDEZ_TARGET_IDENTITY),
      evidenceQualityScore: 91,
      evidenceQualityLevel: 'strong',
      source: {
        adapter: 'manual_pilot_fixture',
        retrievalMethod: 'manual_import',
        sourceReliability: 'verified_manual'
      }
    },
    {
      evidenceType: 'true_sold',
      marketplace: 'eBay',
      marketplaceSaleId: 'a3-ah-181-silver-sold-002',
      marketplaceListingId: 'a3-ah-181-listing-002',
      rawTitle: 'Anthony Hernandez 2023 Panini Prizm UFC #181 Silver Prizm Rookie RC',
      soldPrice: 7,
      shipping: 0,
      soldAt: '2026-06-27T14:00:00.000Z',
      saleType: 'buy_it_now',
      url: 'https://example.test/sold/a3-anthony-hernandez-002',
      condition: 'Raw',
      gradeCompany: 'raw',
      grade: 'unknown',
      parsedIdentity: clone(ANTHONY_HERNANDEZ_TARGET_IDENTITY),
      evidenceQualityScore: 88,
      evidenceQualityLevel: 'strong',
      source: {
        adapter: 'manual_pilot_fixture',
        retrievalMethod: 'manual_import',
        sourceReliability: 'verified_manual'
      }
    },
    {
      evidenceType: 'true_sold',
      marketplace: 'eBay',
      marketplaceSaleId: 'a3-ah-181-silver-sold-003',
      marketplaceListingId: 'a3-ah-181-listing-003',
      rawTitle: '2023 Prizm UFC Anthony Hernandez Silver Prizm #181 RC Rookie Card',
      soldPrice: 8.25,
      shipping: 1,
      soldAt: '2026-06-15T20:15:00.000Z',
      saleType: 'best_offer',
      bestOfferAccepted: true,
      priceDisclosure: 'reported_price',
      url: 'https://example.test/sold/a3-anthony-hernandez-003',
      condition: 'Raw',
      gradeCompany: 'raw',
      grade: 'unknown',
      parsedIdentity: clone(ANTHONY_HERNANDEZ_TARGET_IDENTITY),
      evidenceQualityScore: 84,
      evidenceQualityLevel: 'good',
      source: {
        adapter: 'manual_pilot_fixture',
        retrievalMethod: 'manual_import',
        sourceReliability: 'verified_manual'
      }
    }
  ];
}

function buildAnthonyHernandezReplayStore(records = buildAnthonyHernandezTrueSoldRecords()) {
  return addSoldEvidenceRecords(createEmptySoldEvidenceStore({
    createdAt: DEFAULT_AS_OF,
    updatedAt: DEFAULT_AS_OF
  }), records, {
    adapter: 'phase_a3_offline_fixture',
    acquiredAt: DEFAULT_AS_OF,
    retrievalMethod: 'offline_replay_fixture',
    sourceReliability: 'verified_manual'
  }).store;
}

function getRepresentativeAnthonyHernandezCandidates() {
  return [
    {
      listingId: 'a3-ah-live-fixed-price',
      marketplace: 'ebay',
      marketplaceListingId: 'a3-ah-live-fixed-price',
      marketplaceLabel: 'eBay',
      ebayItemId: 'a3-ah-live-fixed-price',
      title: '2023 Panini Prizm UFC Anthony Hernandez #181 Silver Prizm RC Rookie',
      price: 4.49,
      shipping: 0,
      totalCost: 4.49,
      currency: 'USD',
      condition: 'Ungraded',
      url: 'https://example.test/live/a3-ah-live-fixed-price',
      image: '',
      sellerUsername: 'fixture-seller',
      sellerFeedbackPercentage: 99.8,
      sellerFeedbackScore: 840,
      buyingOptions: ['FIXED_PRICE'],
      itemCreationDate: '2026-07-10T11:00:00.000Z',
      parsed: {
        year: 2023,
        setName: 'Prizm',
        qualityTier: 'watch',
        flags: {
          rookie: true,
          prizm: true,
          refractor: true,
          graded: false,
          autograph: false,
          numbered: false,
          lot: false,
          sealed: false,
          reprint: false,
          digital: false,
          custom: false
        }
      }
    },
    {
      listingId: 'a3-ah-live-auction',
      marketplace: 'ebay',
      marketplaceListingId: 'a3-ah-live-auction',
      marketplaceLabel: 'eBay',
      ebayItemId: 'a3-ah-live-auction',
      title: 'Anthony Hernandez 2023 Prizm UFC Silver Prizm Rookie RC #181',
      price: 2.99,
      shipping: 1.5,
      totalCost: 4.49,
      currency: 'USD',
      condition: 'Ungraded',
      url: 'https://example.test/live/a3-ah-live-auction',
      image: '',
      sellerUsername: 'fixture-seller-2',
      sellerFeedbackPercentage: 99.2,
      sellerFeedbackScore: 420,
      buyingOptions: ['AUCTION'],
      itemCreationDate: '2026-07-10T10:45:00.000Z',
      parsed: {
        year: 2023,
        setName: 'Prizm',
        qualityTier: 'watch',
        flags: {
          rookie: true,
          prizm: true,
          refractor: true,
          graded: false,
          autograph: false,
          numbered: false,
          lot: false,
          sealed: false,
          reprint: false,
          digital: false,
          custom: false
        }
      }
    }
  ];
}

function classifyCandidateAgainstTarget(listing = {}, identity = ANTHONY_HERNANDEZ_TARGET_IDENTITY) {
  const title = String(listing.title || '').toLowerCase();
  const required = [
    identity.player,
    identity.year,
    identity.setName,
    identity.cardNumber,
    identity.parallel
  ].map((value) => String(value || '').toLowerCase()).filter(Boolean);
  const missing = required.filter((term) => !title.includes(term.replace(/^#/, '')));

  if (!title.includes('anthony') || !title.includes('hernandez')) return 'irrelevant';
  if (missing.length === 0) return 'exact targeted card';
  if (missing.length <= 2) return 'ambiguous';
  return 'related but different card';
}

function summarizeTrueSoldProvenance(records = []) {
  return records.map((record) => ({
    recordId: record.id,
    marketplace: record.marketplace,
    marketplaceSaleId: record.marketplaceSaleId,
    marketplaceListingId: record.marketplaceListingId,
    totalPaid: record.totalPaid,
    soldAt: record.soldAt,
    evidenceType: record.evidenceType,
    status: record.status,
    sourceAdapter: record.source?.adapter || 'unknown',
    retrievalMethod: record.source?.retrievalMethod || 'unknown',
    sourceReliability: record.source?.sourceReliability || 'unknown',
    evidenceQualityLevel: record.evidenceQualityLevel
  }));
}

function identifyFirstBlockingStage({ triage, canonicalEvidence, scoring, dealGate }) {
  if (triage.rejected) return 'cheap_triage';
  if (!canonicalEvidence || canonicalEvidence.trueSoldCount <= 0) return 'canonical_sold_evidence_lookup';
  if (scoring.marketData?.source === 'insufficient_evidence') return 'valuation';
  if (!dealGate?.passed) return 'deal_gate';
  return 'eligible_for_alert_path';
}

function replayCandidate(candidate, context) {
  const {
    asOf,
    laneConfig,
    runtime,
    scanUniverse,
    store
  } = context;
  const triage = classifyListingForCheapTriage(candidate, laneConfig);
  const laneIdentity = buildTargetedDiscoveryParsedIdentity(laneConfig);
  const enrichedCandidate = {
    ...clone(candidate),
    parsedIdentity: candidate.parsedIdentity || candidate.canonicalIdentity || laneIdentity,
    targetedDiscovery: {
      laneId: laneConfig.laneId,
      laneName: laneConfig.laneName,
      query: 'offline-anthony-hernandez-replay',
      page: 0,
      offset: 0,
      firstObservedAt: asOf,
      observedAt: asOf,
      marketplaceStartTimestamp: candidate.itemCreationDate || null,
      ageAtFirstObservationMs: null,
      freshnessAvailable: false,
      triage
    }
  };
  const canonicalCardKey = buildCanonicalCardKey(enrichedCandidate.parsedIdentity);
  const directQuery = soldEvidenceService.querySoldEvidence(store, enrichedCandidate.parsedIdentity, {
    trueSoldOnly: true
  }, { asOf });

  if (triage.rejected) {
    return {
      listingId: enrichedCandidate.ebayItemId,
      title: enrichedCandidate.title,
      descriptiveClassification: classifyCandidateAgainstTarget(enrichedCandidate),
      triage,
      normalizedListingIdentity: clone(enrichedCandidate.parsed || {}),
      canonicalIdentity: clone(enrichedCandidate.parsedIdentity),
      canonicalCardKey,
      directTrueSoldCount: directQuery.trueSoldCount,
      trueSoldProvenance: summarizeTrueSoldProvenance(directQuery.records),
      firstBlockingStage: 'cheap_triage',
      productionImpact: 'none',
      decisionImpact: 'none',
      executionAuthority: 'none'
    };
  }

  runtime.__setCanonicalSoldEvidenceStoreForTest(store);
  try {
    return withFixedDate(asOf, () => {
      const scoring = runtime.scoreListing(enrichedCandidate, scanUniverse || []);
      const canonicalEvidence = scoring.marketIntelligenceData?.canonicalSoldEvidence || {
        trueSoldCount: 0,
        records: []
      };
      const gate = runtime.dealGate({
        ...enrichedCandidate,
        ...scoring
      });

      return {
        listingId: enrichedCandidate.ebayItemId,
        title: enrichedCandidate.title,
        url: enrichedCandidate.url || '',
        totalCost: enrichedCandidate.totalCost || enrichedCandidate.price || 0,
        listingType: Array.isArray(enrichedCandidate.buyingOptions)
          ? enrichedCandidate.buyingOptions.join(',')
          : enrichedCandidate.listingType || 'unknown',
        descriptiveClassification: classifyCandidateAgainstTarget(enrichedCandidate),
        triage,
        normalizedListingIdentity: clone(enrichedCandidate.parsed || {}),
        canonicalIdentity: clone(enrichedCandidate.parsedIdentity),
        canonicalCardKey,
        directTrueSoldCount: directQuery.trueSoldCount,
        trueSoldProvenance: summarizeTrueSoldProvenance(directQuery.records),
        runtimeCanonicalEvidence: {
          canonicalCardKey: canonicalEvidence.canonicalCardKey,
          trueSoldCount: canonicalEvidence.trueSoldCount || 0,
          recordsBeforeTrueSoldFilter: canonicalEvidence.queryDiagnostics?.recordsBeforeTrueSoldFilter || 0,
          recordsAfterTrueSoldFilter: canonicalEvidence.queryDiagnostics?.recordsAfterTrueSoldFilter || 0,
          identityLookupSource: canonicalEvidence.queryDiagnostics?.identityLookupSource || 'unknown',
          identityLookupKey: canonicalEvidence.queryDiagnostics?.identityLookupKey || ''
        },
        valuation: {
          source: scoring.marketData?.source || 'unknown',
          method: scoring.marketData?.method || 'unknown',
          marketValue: scoring.marketData?.marketValue || 0,
          expectedValue: scoring.marketData?.expectedValue || 0,
          estimatedValue: scoring.estimatedValue || 0,
          estimatedProfit: scoring.estimatedProfit || 0,
          roi: scoring.roi || 0,
          confidence: scoring.marketData?.confidence || 0,
          soldCompCount: scoring.marketData?.soldCompCount || 0
        },
        dealGate: {
          passed: Boolean(gate.passed),
          decision: gate.decision,
          reasons: Array.isArray(gate.reasons) ? gate.reasons.slice() : [],
          soldCompCount: gate.gate?.soldCompCount || 0,
          confidenceScore: gate.gate?.confidenceScore || 0,
          marketIntelligenceScore: gate.gate?.marketIntelligenceScore || 0,
          failedRules: gate.dealGateBreakdown?.failedRules || []
        },
        alertEligibility: Boolean(gate.passed),
        firstBlockingStage: identifyFirstBlockingStage({
          triage,
          canonicalEvidence,
          scoring,
          dealGate: gate
        }),
        productionImpact: 'none',
        decisionImpact: 'none',
        executionAuthority: 'none'
      };
    });
  } finally {
    runtime.__setCanonicalSoldEvidenceStoreForTest(null);
  }
}

function replayTargetedDiscoveryCandidates(options = {}) {
  const asOf = options.asOf || DEFAULT_AS_OF;
  const laneConfig = createTargetedDiscoveryLaneConfig({}, {
    enabled: true,
    ...(options.laneConfig || {})
  });
  const store = options.soldEvidenceStore || buildAnthonyHernandezReplayStore();
  const runtime = options.runtime || loadRuntime();
  const candidates = Array.isArray(options.candidates)
    ? options.candidates
    : getRepresentativeAnthonyHernandezCandidates();
  const scanUniverse = Array.isArray(options.scanUniverse) ? options.scanUniverse : [];
  const canonicalTargetKey = buildCanonicalCardKey(ANTHONY_HERNANDEZ_TARGET_IDENTITY);
  const results = candidates.map((candidate) => replayCandidate(candidate, {
    asOf,
    laneConfig,
    runtime,
    scanUniverse,
    store
  }));

  return Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    source: SOURCE,
    version: VERSION,
    asOf,
    candidateCount: results.length,
    canonicalTargetIdentity: clone(ANTHONY_HERNANDEZ_TARGET_IDENTITY),
    canonicalTargetKey,
    results: Object.freeze(results.map(Object.freeze)),
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  });
}

function summarizeTargetedDiscoveryCandidateReplay(replay = {}) {
  const results = Array.isArray(replay.results) ? replay.results : [];
  const firstBlockingStages = results.reduce((summary, result) => {
    const key = result.firstBlockingStage || 'unknown';
    summary[key] = (summary[key] || 0) + 1;
    return summary;
  }, {});

  return Object.freeze({
    source: SOURCE,
    version: VERSION,
    candidateCount: results.length,
    exactTargetedCardCount: results.filter((result) => result.descriptiveClassification === 'exact targeted card').length,
    trueSoldCounts: results.map((result) => result.runtimeCanonicalEvidence?.trueSoldCount || result.directTrueSoldCount || 0),
    dealGatePassCount: results.filter((result) => result.dealGate?.passed).length,
    firstBlockingStages,
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  });
}

module.exports = {
  SOURCE,
  VERSION,
  SCHEMA_VERSION,
  ANTHONY_HERNANDEZ_TARGET_IDENTITY,
  buildAnthonyHernandezReplayStore,
  buildAnthonyHernandezTrueSoldRecords,
  classifyCandidateAgainstTarget,
  getRepresentativeAnthonyHernandezCandidates,
  replayTargetedDiscoveryCandidates,
  summarizeTargetedDiscoveryCandidateReplay
};
