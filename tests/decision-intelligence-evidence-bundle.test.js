'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const artifactBuilder = require('../validation/decisionIntelligenceArtifactBuilder');
const bundle = require('../validation/decisionIntelligenceEvidenceBundle');

function signalRef(signalName, index) {
  return {
    signalFamily: signalName,
    signalName,
    signalVersion: '1.0.0',
    signalId: `signal-${index}`,
    signalFingerprint: `signal-fingerprint-${index}`,
    alignmentId: `alignment-${index}`,
    alignmentFingerprint: `alignment-fingerprint-${index}`,
    migrationFingerprint: `migration-fingerprint-${index}`,
    shadowComparisonFingerprint: `shadow-comparison-fingerprint-${index}`,
    reportFingerprint: `report-fingerprint-${index}`,
    coverageStatus: 'available',
    parityStatus: 'exact_match',
    authorityStatus: 'none',
    sourceOutputFingerprint: `native-output-fingerprint-${index}`,
    summary: `${signalName} summary`
  };
}

function completeInput(overrides = {}) {
  return {
    bundleId: 'decision-intelligence-evidence-bundle-001',
    createdAt: '2026-07-30T16:00:00.000Z',
    capturedAt: '2026-07-30T15:59:00.000Z',
    artifactId: 'decision-intelligence-artifact-from-bundle-001',
    listingRef: {
      listingId: 'listing-bundle-001',
      marketplace: 'ebay',
      source: 'offline_review',
      marketplaceItemId: 'item-bundle-001',
      title: '1986 Fleer Michael Jordan PSA 8',
      url: 'https://example.test/listing-bundle-001',
      askingPrice: 4000,
      shipping: 0,
      totalCost: 4000,
      listingState: 'active',
      capturedAt: '2026-07-30T15:58:00.000Z',
      listingFingerprint: 'listing-fingerprint-bundle'
    },
    canonicalIdentityRef: {
      canonicalIdentityId: 'canonical-identity-bundle',
      canonicalIdentityFingerprint: 'canonical-identity-fingerprint-bundle',
      canonicalIdentitySummary: 'Michael Jordan 1986 Fleer PSA 8',
      identityEligibility: 'eligible',
      diagnosticStatus: 'complete',
      confirmedFields: { subject: 'Michael Jordan', year: '1986', setName: 'Fleer', grade: 'PSA 8' },
      missingFields: [],
      conflictingFields: []
    },
    signalRefs: artifactBuilder.EXPECTED_SIGNAL_NAMES.map(signalRef).reverse(),
    valuationRefs: {
      estimatedValue: 5200,
      estimatedProfit: 1200,
      roi: 30,
      floorValue: 4700,
      expectedValue: 5200,
      ceilingValue: 5900,
      valuationConfidence: 84,
      valuationRangeQuality: 'strong',
      valuationSourceFingerprints: ['production-valuation-fingerprint', 'range-valuation-fingerprint'],
      productionValuation: {
        valuationId: 'production-valuation-bundle',
        valuationFingerprint: 'production-valuation-fingerprint',
        summary: 'Production valuation reference.'
      },
      rangeFirstValuation: {
        valuationId: 'range-valuation-bundle',
        valuationFingerprint: 'range-valuation-fingerprint',
        summary: 'Range valuation reference.'
      }
    },
    comparableQualityRefs: {
      comparableQualityStatus: 'trusted',
      averageComparableQualityScore: 88,
      scoredComparableCount: 7,
      acceptedComparableCount: 7,
      rejectedComparableCount: 0,
      summary: 'Comparable quality is trusted.'
    },
    evidenceReadinessRefs: {
      evidenceReadinessStatus: 'strong',
      soldEvidenceSufficiency: 'strong',
      canonicalSoldEvidenceStatus: 'available',
      trueSoldCount: 7,
      evidenceQualityScore: 86,
      evidenceQualityLevel: 'strong',
      summary: 'Evidence readiness is strong.'
    },
    productionScoringObservation: {
      observationId: 'production-score-observation',
      observationType: 'production_scoring',
      source: 'decision_engine',
      sourceArtifactId: 'decision-engine-output-001',
      sourceFingerprint: 'decision-engine-fingerprint',
      observedAt: '2026-07-30T15:59:10.000Z',
      summary: 'Native decision engine output was preserved.',
      values: {
        decisionEngineFingerprint: 'decision-engine-fingerprint',
        decision: 'STRONG_WATCH',
        recommendation: 'STRONG_WATCH',
        action: 'STRONG_WATCH',
        decisionScore: 78,
        evidenceScore: 84,
        opportunityScore: 72,
        decisionConfidence: 82,
        decisionMatrix: { evidenceStrength: 85, investmentQuality: 73 },
        positives: ['Evidence strength is strong.'],
        warnings: ['Human review remains required.'],
        blockingFactors: [],
        summary: 'Strong watch from existing scoring.'
      }
    },
    dealGateObservation: {
      observationId: 'deal-gate-observation',
      observationType: 'deal_gate',
      source: 'deal_gate',
      sourceArtifactId: 'deal-gate-output-001',
      sourceFingerprint: 'deal-gate-fingerprint',
      observedAt: '2026-07-30T15:59:20.000Z',
      summary: 'Deal Gate observation was preserved.',
      values: {
        dealGateId: 'deal-gate-output-001',
        dealGateFingerprint: 'deal-gate-fingerprint',
        decision: 'REJECT',
        recommendation: 'reject',
        passed: false,
        approved: false,
        buyNowAllowed: false,
        reasons: ['Deal Gate did not approve BUY_NOW.'],
        rejectionReasons: ['Deal Gate did not approve BUY_NOW.'],
        ruleOutcomes: [{ ruleId: 'final_no_rejection_reasons', passed: false }]
      }
    },
    buyNowObservation: {
      observationId: 'buy-now-observation',
      observationType: 'buy_now',
      source: 'deal_gate',
      sourceArtifactId: 'deal-gate-output-001',
      sourceFingerprint: 'deal-gate-fingerprint',
      values: {
        buyNowEligible: false,
        buyNowSource: 'observed_production_output',
        buyNowExplanation: 'BUY_NOW was not approved by Deal Gate.',
        notificationEligible: false,
        humanReviewRequired: true,
        purchaseAuthority: 'none'
      }
    },
    governanceRefs: [
      {
        referenceId: 'governance-review-report-001',
        referenceType: 'signal_governance_review_report',
        source: 'governance_review_report',
        sourceArtifactId: 'governance-review-report-001',
        sourceFingerprint: 'governance-review-report-fingerprint',
        summary: 'Governance review report reference.'
      }
    ],
    missingReferences: [
      {
        referenceName: 'resaleOutcome',
        referenceType: 'outcome',
        required: false,
        reason: 'future_outcome_not_available',
        impact: 'review_only'
      }
    ],
    evidenceGaps: [
      {
        gapId: 'human-review-not-attached',
        category: 'governance',
        description: 'Human review has not been attached yet.',
        expectedEvidence: 'dalton_review',
        reviewImpact: 'review_only',
        certificationImpact: 'blocks_certification',
        blocking: false
      }
    ],
    unknownValues: [
      {
        field: 'seller.returnPolicy',
        category: 'listing',
        reason: 'not_supplied',
        impact: 'review_only'
      }
    ],
    provenance: {
      createdBy: 'bundle-test',
      reviewBatchId: 'review-batch-bundle',
      workspaceId: 'workspace-bundle'
    },
    ...overrides
  };
}

test('exports Decision Intelligence Evidence Bundle public APIs', () => {
  assert.equal(typeof bundle.buildDecisionIntelligenceEvidenceBundle, 'function');
  assert.equal(typeof bundle.validateDecisionIntelligenceEvidenceBundle, 'function');
  assert.equal(typeof bundle.summarizeDecisionIntelligenceEvidenceBundle, 'function');
  assert.equal(typeof bundle.buildDecisionIntelligenceEvidenceBundleFingerprint, 'function');
  assert.equal(typeof bundle.compareDecisionIntelligenceEvidenceBundles, 'function');
});

test('builds deterministic immutable evidence bundles with every required section', () => {
  const first = bundle.buildDecisionIntelligenceEvidenceBundle(completeInput());
  const second = bundle.buildDecisionIntelligenceEvidenceBundle(completeInput());

  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.signalRefs), true);
  assert.deepEqual(first, second);
  assert.equal(first.schemaVersion, bundle.DECISION_INTELLIGENCE_EVIDENCE_BUNDLE_SCHEMA_VERSION);
  assert.equal(first.bundleType, 'decision_intelligence_evidence_bundle');
  assert.equal(first.productionImpact, 'none');
  assert.equal(first.decisionImpact, 'none');
  assert.equal(first.executionAuthority, 'none');
  assert.equal(first.bundleFingerprint, bundle.buildDecisionIntelligenceEvidenceBundleFingerprint(first));
  for (const field of bundle.REQUIRED_BUNDLE_FIELDS) {
    assert.ok(Object.prototype.hasOwnProperty.call(first, field), `${field} exists`);
  }
});

test('preserves references and does not mutate source evidence', () => {
  const source = completeInput();
  const built = bundle.buildDecisionIntelligenceEvidenceBundle(source);

  source.listingRef.title = 'mutated';
  source.signalRefs[0].signalFingerprint = 'mutated';
  source.productionScoringObservation.values.decisionScore = 1;

  assert.equal(built.listingRef.title, '1986 Fleer Michael Jordan PSA 8');
  assert.equal(built.signalRefs.some((signal) => signal.signalFingerprint === 'mutated'), false);
  assert.equal(built.productionScoringObservation.values.decisionScore, 78);
});

test('normalizes Signal ordering and missing optional Signal references explicitly', () => {
  const built = bundle.buildDecisionIntelligenceEvidenceBundle(completeInput({
    signalRefs: [signalRef('decision.context.diagnostics', 1)],
    expectedSignalNames: ['decision.context.diagnostics', 'production.valuation.diagnostics']
  }));

  assert.deepEqual(built.signalRefs.map((signal) => signal.signalName), ['decision.context.diagnostics']);
  assert.equal(built.missingReferences.some((reference) => reference.referenceName === 'production.valuation.diagnostics'), true);
  assert.equal(built.evidenceGaps.some((gap) => gap.missingArtifactType === 'canonical_intelligence_signal'), true);
});

test('reports missing required evidence references deterministically', () => {
  const built = bundle.buildDecisionIntelligenceEvidenceBundle(completeInput({
    listingRef: {
      listingFingerprint: 'listing-fingerprint-without-id'
    },
    productionScoringObservation: {
      values: {
        decision: 'PASS'
      }
    }
  }));
  const validation = bundle.validateDecisionIntelligenceEvidenceBundle(built);

  assert.equal(validation.valid, false);
  assert.equal(validation.reasonCodes.includes('required_reference_missing'), true);
  assert.equal(validation.missingReferences.includes('listingRef.listingId'), true);
  assert.equal(validation.missingReferences.includes('productionScoringObservation.sourceFingerprint'), true);
});

test('bundle builderInput is directly consumable by the Decision Intelligence Artifact Builder', () => {
  const built = bundle.buildDecisionIntelligenceEvidenceBundle(completeInput());
  const artifact = artifactBuilder.buildDecisionIntelligenceArtifact(built.builderInput);
  const validation = artifactBuilder.validateDecisionIntelligenceArtifact(artifact);

  assert.equal(validation.valid, true);
  assert.equal(artifact.listingRef.listingId, 'listing-bundle-001');
  assert.equal(artifact.productionDecisionRef.decisionScore, 78);
  assert.equal(artifact.dealGateRef.buyNowAllowed, false);
  assert.equal(artifact.buyNowRef.purchaseAuthority, 'none');
});

test('validates authority boundaries and fingerprint integrity', () => {
  const built = bundle.buildDecisionIntelligenceEvidenceBundle(completeInput());
  const valid = bundle.validateDecisionIntelligenceEvidenceBundle(built);
  const authorityDrift = bundle.validateDecisionIntelligenceEvidenceBundle({
    ...built,
    productionImpact: 'changes_runtime'
  });
  const fingerprintDrift = bundle.validateDecisionIntelligenceEvidenceBundle({
    ...built,
    bundleId: 'changed-id'
  });

  assert.equal(valid.valid, true);
  assert.equal(authorityDrift.valid, false);
  assert.deepEqual(authorityDrift.authorityViolations, ['productionImpact']);
  assert.equal(fingerprintDrift.valid, false);
  assert.deepEqual(fingerprintDrift.fingerprintViolations, ['bundleFingerprint']);
});

test('summarizes bundle readiness without granting authority', () => {
  const built = bundle.buildDecisionIntelligenceEvidenceBundle(completeInput());
  const summary = bundle.summarizeDecisionIntelligenceEvidenceBundle(built);

  assert.equal(Object.isFrozen(summary), true);
  assert.equal(summary.bundleId, 'decision-intelligence-evidence-bundle-001');
  assert.equal(summary.listingId, 'listing-bundle-001');
  assert.equal(summary.signalReferenceCount, artifactBuilder.EXPECTED_SIGNAL_NAMES.length);
  assert.equal(summary.governanceReferenceCount, 1);
  assert.equal(summary.valid, true);
  assert.equal(summary.readyForArtifactBuilder, true);
  assert.equal(summary.productionImpact, 'none');
  assert.equal(summary.decisionImpact, 'none');
  assert.equal(summary.executionAuthority, 'none');
});

test('compares evidence bundles deterministically', () => {
  const first = bundle.buildDecisionIntelligenceEvidenceBundle(completeInput());
  const second = bundle.buildDecisionIntelligenceEvidenceBundle(completeInput());
  const changed = bundle.buildDecisionIntelligenceEvidenceBundle(completeInput({
    bundleId: 'decision-intelligence-evidence-bundle-002',
    evidenceGaps: [
      {
        gapId: 'new-gap',
        category: 'evidence',
        description: 'Additional manual evidence is needed.',
        expectedEvidence: 'manual_note',
        blocking: false
      }
    ]
  }));

  const exact = bundle.compareDecisionIntelligenceEvidenceBundles(first, second);
  const mismatch = bundle.compareDecisionIntelligenceEvidenceBundles(first, changed);

  assert.equal(exact.parityStatus, 'exact_match');
  assert.equal(exact.mismatchCount, 0);
  assert.equal(mismatch.parityStatus, 'mismatch');
  assert.ok(mismatch.mismatchCount > 0);
  assert.equal(mismatch.productionImpact, 'none');
});

test('module stays offline and avoids production runtime imports', () => {
  const loaded = new Set();
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    loaded.add(request);
    return originalLoad.apply(this, arguments);
  };
  try {
    delete require.cache[require.resolve('../validation/decisionIntelligenceEvidenceBundle')];
    require('../validation/decisionIntelligenceEvidenceBundle');
  } finally {
    Module._load = originalLoad;
  }

  assert.equal([...loaded].some((item) => item.includes('server.js')), false);
  assert.equal([...loaded].some((item) => item.includes('decisionEngine')), false);
  assert.equal([...loaded].some((item) => item.includes('valuationRangeEngine')), false);
  assert.equal([...loaded].some((item) => item.includes('dealGate')), false);
  assert.equal([...loaded].some((item) => item.includes('stateStore')), false);
});
