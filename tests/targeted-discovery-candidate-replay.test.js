'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const {
  buildTargetedDiscoveryParsedIdentity,
  createTargetedDiscoveryLaneConfig,
  createTargetedDiscoveryLaneService
} = require('../services/targetedDiscoveryLaneService');
const {
  buildCanonicalCardKey,
  createEmptySoldEvidenceStore
} = require('../utils/soldEvidenceStore');
const {
  ANTHONY_HERNANDEZ_TARGET_IDENTITY,
  buildAnthonyHernandezReplayStore,
  buildAnthonyHernandezTrueSoldRecords,
  getRepresentativeAnthonyHernandezCandidates,
  replayTargetedDiscoveryCandidates,
  summarizeTargetedDiscoveryCandidateReplay
} = require('../validation/targetedDiscoveryCandidateReplay');

function withExpressStub(callback) {
  const originalLoad = Module._load;
  Module._load = function loadWithExpressStub(request, parent, isMain) {
    if (request === 'express') {
      const express = () => ({
        use() {},
        get() {},
        post() {},
        listen() {}
      });
      express.urlencoded = () => (_req, _res, next) => next && next();
      express.json = () => (_req, _res, next) => next && next();
      return express;
    }

    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    return callback();
  } finally {
    Module._load = originalLoad;
  }
}

function runReplay(options = {}) {
  return withExpressStub(() => replayTargetedDiscoveryCandidates(options));
}

function firstReplayResult(options = {}) {
  return runReplay(options).results[0];
}

test('A3 targeted lane identity aligns accepted candidates with Anthony canonical sold evidence', async () => {
  const targetKey = buildCanonicalCardKey(ANTHONY_HERNANDEZ_TARGET_IDENTITY);
  const laneIdentity = buildTargetedDiscoveryParsedIdentity(createTargetedDiscoveryLaneConfig({}, { enabled: true }));
  const laneKey = buildCanonicalCardKey(laneIdentity);
  const saved = [];
  const config = createTargetedDiscoveryLaneConfig({}, {
    enabled: true,
    maxRequests: 1,
    pageLimit: 1
  });
  const query = '2023 Panini Prizm UFC Anthony Hernandez #181 Silver Prizm rookie RC';
  const service = createTargetedDiscoveryLaneService({
    activeMarketplace: {
      config: { searchDelayMs: 0 },
      searchPageWithBackoff: async () => ({
        items: [getRepresentativeAnthonyHernandezCandidates()[0]]
      }),
      compactError: (error) => error.message,
      isRateLimitError: () => false
    },
    config,
    getStore: () => ({ listings: {} }),
    historyEngine: { getListing: () => null },
    parseCardTitle: () => ({}),
    recordTargetedDiscoveryObservation: () => {},
    saveScoutedListing: (listing) => {
      saved.push(listing);
      return listing;
    },
    sleep: async () => {},
    now: () => '2026-07-10T12:00:00.000Z'
  });

  const result = await service.run({ scanId: 'a3-identity' });

  assert.equal(laneKey, targetKey);
  assert.equal(result.report.candidatesPreserved, 1);
  assert.equal(saved.length, 1);
  assert.equal(buildCanonicalCardKey(saved[0].parsedIdentity), targetKey);
  assert.equal(saved[0].targetedDiscovery.query, query);
});

test('A3 replay counts qualifying true sold evidence through the production scoring path', () => {
  const replay = runReplay();
  const summary = summarizeTargetedDiscoveryCandidateReplay(replay);

  assert.equal(replay.candidateCount, 2);
  assert.deepEqual(summary.trueSoldCounts, [3, 3]);
  assert.equal(summary.exactTargetedCardCount, 2);

  for (const result of replay.results) {
    assert.equal(result.runtimeCanonicalEvidence.trueSoldCount, 3);
    assert.equal(result.directTrueSoldCount, 3);
    assert.equal(result.valuation.source, 'sold_market');
    assert.equal(result.valuation.soldCompCount, 3);
    assert.equal(result.trueSoldProvenance.every((record) => record.evidenceType === 'true_sold'), true);
  }
});

test('A3 active listings never count as sold evidence', () => {
  const activeUniverse = [
    {
      ebayItemId: 'active-context-1',
      title: '2023 Panini Prizm UFC Anthony Hernandez #181 Silver Prizm RC Rookie',
      price: 80,
      shipping: 0,
      totalCost: 80,
      status: 'active',
      parsed: {
        year: 2023,
        setName: 'Prizm',
        flags: { rookie: true, refractor: true }
      }
    }
  ];
  const result = firstReplayResult({
    soldEvidenceStore: createEmptySoldEvidenceStore(),
    scanUniverse: activeUniverse
  });

  assert.equal(result.runtimeCanonicalEvidence.trueSoldCount, 0);
  assert.equal(result.valuation.source, 'insufficient_evidence');
  assert.equal(result.valuation.soldCompCount, 0);
  assert.equal(result.dealGate.soldCompCount, 0);
  assert.equal(result.dealGate.reasons.includes('Zero sold comps available.'), true);
});

test('A3 insufficient sold evidence remains a Deal Gate rejection', () => {
  const store = buildAnthonyHernandezReplayStore(buildAnthonyHernandezTrueSoldRecords().slice(0, 2));
  const result = firstReplayResult({ soldEvidenceStore: store });

  assert.equal(result.runtimeCanonicalEvidence.trueSoldCount, 2);
  assert.equal(result.dealGate.passed, false);
  assert.equal(result.dealGate.decision, 'REJECT');
  assert.equal(result.dealGate.reasons.includes('Only 2 sold comps available; minimum is 3.'), true);
  assert.equal(result.firstBlockingStage, 'deal_gate');
});

test('A3 replay exposes Deal Gate rejection reasons without granting alert or purchase authority', () => {
  const result = firstReplayResult();

  assert.equal(result.dealGate.passed, false);
  assert.equal(result.alertEligibility, false);
  assert.equal(result.firstBlockingStage, 'deal_gate');
  assert.equal(result.productionImpact, 'none');
  assert.equal(result.decisionImpact, 'none');
  assert.equal(result.executionAuthority, 'none');
  assert.equal(Object.hasOwn(result, 'purchaseAutomation'), false);
  assert.equal(Object.hasOwn(result, 'bidAutomation'), false);
  assert.equal(Object.hasOwn(result, 'offerAutomation'), false);
  assert.equal(Object.hasOwn(result, 'notificationDispatch'), false);
});

test('A3 replay harness is offline and cannot trigger marketplace execution or notifications', () => {
  const runtime = {
    __setCanonicalSoldEvidenceStoreForTest: () => {},
    scoreListing: (listing) => ({
      score: 80,
      estimatedValue: 8,
      estimatedProfit: 1,
      roi: 0.1,
      marketData: {
        source: 'sold_market',
        method: 'fixture',
        marketValue: 8,
        expectedValue: 8,
        confidence: 70,
        soldCompCount: 3
      },
      marketIntelligenceData: {
        canonicalSoldEvidence: {
          canonicalCardKey: buildCanonicalCardKey(listing.parsedIdentity),
          trueSoldCount: 3,
          records: [],
          queryDiagnostics: {
            recordsBeforeTrueSoldFilter: 3,
            recordsAfterTrueSoldFilter: 3,
            identityLookupSource: 'listing.parsedIdentity',
            identityLookupKey: buildCanonicalCardKey(listing.parsedIdentity)
          }
        }
      }
    }),
    dealGate: () => ({
      passed: false,
      decision: 'REJECT',
      reasons: ['fixture rejection'],
      gate: {
        soldCompCount: 3,
        confidenceScore: 70,
        marketIntelligenceScore: 0
      },
      dealGateBreakdown: {
        failedRules: ['fixture_rule']
      }
    })
  };
  const replay = replayTargetedDiscoveryCandidates({ runtime });

  assert.equal(replay.productionImpact, 'none');
  assert.equal(replay.decisionImpact, 'none');
  assert.equal(replay.executionAuthority, 'none');
  assert.equal(Object.hasOwn(runtime, 'activeMarketplace'), false);
  assert.equal(Object.hasOwn(runtime, 'notificationEngine'), false);
});
