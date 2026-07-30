'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const { EXPECTED_SIGNAL_NAMES } = require('../validation/decisionIntelligenceArtifactBuilder');
const { runDecisionIntelligencePipeline } = require('../validation/decisionIntelligencePipelineOrchestrator');
const {
  buildDecisionIntelligencePipelineBaseline,
  buildDecisionIntelligencePipelineCertification
} = require('../validation/decisionIntelligencePipelineStabilityBaseline');
const registry = require('../validation/governanceArtifactRegistry');
const bindingAdapter = require('../validation/decisionIntelligenceGovernanceBindingAdapter');

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

function pipelineInput(overrides = {}) {
  return {
    bundleId: 'decision-intelligence-evidence-bundle-binding-001',
    runId: 'decision-intelligence-pipeline-binding-run-001',
    createdAt: '2026-07-30T20:00:00.000Z',
    capturedAt: '2026-07-30T19:59:00.000Z',
    listingRef: {
      listingId: 'listing-binding-001',
      marketplace: 'ebay',
      source: 'offline_review',
      marketplaceItemId: 'item-binding-001',
      title: '1986 Fleer Michael Jordan PSA 8',
      url: 'https://example.test/listing-binding-001',
      askingPrice: 4000,
      shipping: 0,
      totalCost: 4000,
      listingState: 'active',
      capturedAt: '2026-07-30T19:58:00.000Z',
      listingFingerprint: 'listing-fingerprint-binding'
    },
    canonicalIdentityRef: {
      canonicalIdentityId: 'canonical-identity-binding',
      canonicalIdentityFingerprint: 'canonical-identity-fingerprint-binding',
      canonicalIdentitySummary: 'Michael Jordan 1986 Fleer PSA 8',
      identityEligibility: 'eligible',
      diagnosticStatus: 'complete',
      confirmedFields: { subject: 'Michael Jordan', year: '1986', setName: 'Fleer', grade: 'PSA 8' },
      missingFields: [],
      conflictingFields: []
    },
    signalRefs: EXPECTED_SIGNAL_NAMES.map(signalRef).reverse(),
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
        valuationId: 'production-valuation-binding',
        valuationFingerprint: 'production-valuation-fingerprint',
        summary: 'Production valuation reference.'
      },
      rangeFirstValuation: {
        valuationId: 'range-valuation-binding',
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
      observedAt: '2026-07-30T19:59:10.000Z',
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
      observedAt: '2026-07-30T19:59:20.000Z',
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
      createdBy: 'binding-test',
      reviewBatchId: 'review-batch-binding',
      workspaceId: 'workspace-binding'
    },
    ...overrides
  };
}

function reviewPackage() {
  return {
    schemaVersion: '1.0.0',
    source: 'real_listing_decision_review_contract',
    packageId: 'review-package-binding-001',
    listingId: 'listing-binding-001',
    marketplace: 'ebay',
    createdAt: '2026-07-30T20:01:00.000Z',
    productionImpact: 'none',
    decisionImpact: 'none',
    packageFingerprint: 'review-package-fingerprint-binding-001'
  };
}

function buildInputs(overrides = {}) {
  const pipelineRun = runDecisionIntelligencePipeline(pipelineInput(overrides.pipelineInput || {}));
  const stabilityBaseline = buildDecisionIntelligencePipelineBaseline({
    pipelineRun,
    baselineId: 'decision-intelligence-baseline-binding-001',
    createdAt: '2026-07-30T20:02:00.000Z'
  });
  const stabilityCertification = buildDecisionIntelligencePipelineCertification(stabilityBaseline, {
    certificationId: 'decision-intelligence-certification-binding-001',
    createdAt: '2026-07-30T20:03:00.000Z'
  });
  return {
    pipelineRun,
    stabilityBaseline,
    stabilityCertification,
    reviewPackage: reviewPackage(),
    createdAt: '2026-07-30T20:04:00.000Z',
    ...overrides
  };
}

test('exports Decision Intelligence Governance Binding Adapter public APIs', () => {
  assert.equal(typeof bindingAdapter.buildDecisionIntelligenceGovernanceBinding, 'function');
  assert.equal(typeof bindingAdapter.validateDecisionIntelligenceGovernanceBinding, 'function');
  assert.equal(typeof bindingAdapter.summarizeDecisionIntelligenceGovernanceBinding, 'function');
  assert.equal(typeof bindingAdapter.buildDecisionIntelligenceGovernanceBindingFingerprint, 'function');
  assert.equal(typeof bindingAdapter.compareDecisionIntelligenceGovernanceBindings, 'function');
});

test('builds deterministic immutable Governance Binding artifacts', () => {
  const first = bindingAdapter.buildDecisionIntelligenceGovernanceBinding(buildInputs());
  const second = bindingAdapter.buildDecisionIntelligenceGovernanceBinding(buildInputs());
  const validation = bindingAdapter.validateDecisionIntelligenceGovernanceBinding(first);

  assert.equal(Object.isFrozen(first), true);
  assert.deepEqual(first, second);
  assert.equal(validation.valid, true);
  assert.equal(first.schemaVersion, bindingAdapter.DECISION_INTELLIGENCE_GOVERNANCE_BINDING_SCHEMA_VERSION);
  assert.equal(first.bindingType, bindingAdapter.DECISION_INTELLIGENCE_GOVERNANCE_BINDING_TYPE);
  assert.equal(first.reviewReadiness.status, 'review_ready_with_warnings');
  assert.equal(first.certificationReadiness.status, 'certification_ready_with_warnings');
  assert.equal(first.bindingFingerprint, bindingAdapter.buildDecisionIntelligenceGovernanceBindingFingerprint(first));
});

test('binds Decision Intelligence artifacts by reference and fingerprint only', () => {
  const inputs = buildInputs();
  const built = bindingAdapter.buildDecisionIntelligenceGovernanceBinding(inputs);

  assert.throws(() => {
    inputs.pipelineRun.evidenceBundle.listingRef.title = 'mutated attempt';
  }, /read only property|Cannot assign/);

  assert.equal(built.decisionIntelligenceReferences.evidenceBundle.bundleId, 'decision-intelligence-evidence-bundle-binding-001');
  assert.equal(built.decisionIntelligenceReferences.artifact.artifactFingerprint, inputs.pipelineRun.decisionArtifact.artifactFingerprint);
  assert.equal(built.decisionIntelligenceReferences.pipelineRun.pipelineFingerprint, inputs.pipelineRun.pipelineFingerprint);
  assert.equal(built.decisionIntelligenceReferences.pipelineReport.reportFingerprint, inputs.pipelineRun.pipelineReport.reportFingerprint);
  assert.equal(built.decisionIntelligenceReferences.evidenceBundle.metadata.title, undefined);
});

test('preserves warning propagation without suppression', () => {
  const built = bindingAdapter.buildDecisionIntelligenceGovernanceBinding(buildInputs());

  assert.equal(built.warningPropagation.warningCount > 0, true);
  assert.equal(built.warningPropagation.nonBlockingWarnings.includes('visible_uncertainty_preserved'), true);
  assert.equal(built.warningPropagation.nonBlockingWarnings.includes('decision_reasons_missing'), true);
  assert.equal(built.reviewReadiness.warningsVisible, true);
  assert.equal(built.certificationReadiness.warningsVisible, true);
});

test('keeps review readiness separate from certification readiness when baseline is absent', () => {
  const inputs = buildInputs();
  const built = bindingAdapter.buildDecisionIntelligenceGovernanceBinding({
    pipelineRun: inputs.pipelineRun,
    reviewPackage: inputs.reviewPackage,
    createdAt: '2026-07-30T20:04:00.000Z'
  });
  const validation = bindingAdapter.validateDecisionIntelligenceGovernanceBinding(built);

  assert.equal(built.reviewReadiness.ready, true);
  assert.equal(built.reviewReadiness.status, 'review_ready_with_warnings');
  assert.equal(built.certificationReadiness.ready, false);
  assert.equal(built.certificationReadiness.status, 'blocked_missing_stability_baseline');
  assert.equal(validation.valid, false);
});

test('preserves authority boundaries and detects authority drift', () => {
  const built = bindingAdapter.buildDecisionIntelligenceGovernanceBinding(buildInputs());
  const drifted = bindingAdapter.validateDecisionIntelligenceGovernanceBinding({
    ...built,
    productionImpact: 'changes_runtime'
  });

  assert.equal(built.productionImpact, 'none');
  assert.equal(built.decisionImpact, 'none');
  assert.equal(built.executionAuthority, 'none');
  assert.equal(drifted.valid, false);
  assert.deepEqual(drifted.authorityViolations, ['productionImpact']);
});

test('is compatible with Governance Artifact Registry registration', () => {
  const built = bindingAdapter.buildDecisionIntelligenceGovernanceBinding(buildInputs());
  const empty = registry.createGovernanceArtifactRegistry({
    registryId: 'decision-intelligence-binding-registry',
    createdAt: '2026-07-30T20:05:00.000Z'
  });
  const registration = registry.registerArtifact(empty, built, {
    registeredAt: '2026-07-30T20:06:00.000Z',
    artifactType: 'decision_intelligence_pipeline_binding'
  });
  const fetched = registry.getArtifact(registration.registry, built.bindingId);

  assert.equal(registration.validation.valid, true);
  assert.equal(fetched.artifactId, built.bindingId);
  assert.equal(fetched.artifactFingerprint, built.bindingFingerprint);
  assert.equal(registration.registry.summary.typeSummary.decision_intelligence_pipeline_binding, 1);
});

test('compares Governance Binding artifacts deterministically', () => {
  const first = bindingAdapter.buildDecisionIntelligenceGovernanceBinding(buildInputs({
    bindingId: 'binding-one'
  }));
  const second = bindingAdapter.buildDecisionIntelligenceGovernanceBinding(buildInputs({
    bindingId: 'binding-one'
  }));
  const changed = bindingAdapter.buildDecisionIntelligenceGovernanceBinding(buildInputs({
    bindingId: 'binding-three',
    pipelineInput: {
      evidenceGaps: [
        {
          gapId: 'new-gap',
          category: 'evidence',
          description: 'Additional evidence needs review.',
          blocking: false
        }
      ]
    }
  }));

  const exact = bindingAdapter.compareDecisionIntelligenceGovernanceBindings(first, second);
  const mismatch = bindingAdapter.compareDecisionIntelligenceGovernanceBindings(first, changed);

  assert.equal(exact.parityStatus, 'exact_match');
  assert.equal(exact.mismatchCount, 0);
  assert.equal(mismatch.parityStatus, 'mismatch');
  assert.ok(mismatch.mismatchCount > 0);
  assert.equal(mismatch.executionAuthority, 'none');
});

test('summarizes binding readiness and compatibility', () => {
  const built = bindingAdapter.buildDecisionIntelligenceGovernanceBinding(buildInputs());
  const summary = bindingAdapter.summarizeDecisionIntelligenceGovernanceBinding(built);

  assert.equal(Object.isFrozen(summary), true);
  assert.equal(summary.bindingType, 'decision_intelligence_pipeline_binding');
  assert.equal(summary.listingId, 'listing-binding-001');
  assert.equal(summary.reviewPackageId, 'review-package-binding-001');
  assert.equal(summary.registryCompatible, true);
  assert.equal(summary.lifecycleCompatible, true);
  assert.equal(summary.productionImpact, 'none');
});

test('module stays offline and avoids production runtime imports', () => {
  const loaded = new Set();
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    loaded.add(request);
    return originalLoad.apply(this, arguments);
  };
  try {
    delete require.cache[require.resolve('../validation/decisionIntelligenceGovernanceBindingAdapter')];
    require('../validation/decisionIntelligenceGovernanceBindingAdapter');
  } finally {
    Module._load = originalLoad;
  }

  assert.equal([...loaded].some((item) => item.includes('server.js')), false);
  assert.equal([...loaded].some((item) => item.includes('decisionEngine')), false);
  assert.equal([...loaded].some((item) => item.includes('valuationRangeEngine')), false);
  assert.equal([...loaded].some((item) => item.includes('dealGate')), false);
  assert.equal([...loaded].some((item) => item.includes('stateStore')), false);
});
