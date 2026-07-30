'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const { EXPECTED_SIGNAL_NAMES } = require('../validation/decisionIntelligenceArtifactBuilder');
const {
  buildDecisionIntelligencePipelineBaseline,
  validateDecisionIntelligencePipelineBaseline,
  compareDecisionIntelligencePipelineBaselines,
  buildDecisionIntelligencePipelineCertification,
  summarizeDecisionIntelligencePipelineBaseline
} = require('../validation/decisionIntelligencePipelineStabilityBaseline');

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
    bundleId: 'decision-intelligence-evidence-bundle-baseline-001',
    runId: 'decision-intelligence-pipeline-baseline-run-001',
    createdAt: '2026-07-30T19:00:00.000Z',
    capturedAt: '2026-07-30T18:59:00.000Z',
    listingRef: {
      listingId: 'listing-baseline-001',
      marketplace: 'ebay',
      source: 'offline_review',
      marketplaceItemId: 'item-baseline-001',
      title: '1986 Fleer Michael Jordan PSA 8',
      url: 'https://example.test/listing-baseline-001',
      askingPrice: 4000,
      shipping: 0,
      totalCost: 4000,
      listingState: 'active',
      capturedAt: '2026-07-30T18:58:00.000Z',
      listingFingerprint: 'listing-fingerprint-baseline'
    },
    canonicalIdentityRef: {
      canonicalIdentityId: 'canonical-identity-baseline',
      canonicalIdentityFingerprint: 'canonical-identity-fingerprint-baseline',
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
        valuationId: 'production-valuation-baseline',
        valuationFingerprint: 'production-valuation-fingerprint',
        summary: 'Production valuation reference.'
      },
      rangeFirstValuation: {
        valuationId: 'range-valuation-baseline',
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
      observedAt: '2026-07-30T18:59:10.000Z',
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
      observedAt: '2026-07-30T18:59:20.000Z',
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
      createdBy: 'baseline-test',
      reviewBatchId: 'review-batch-baseline',
      workspaceId: 'workspace-baseline'
    },
    ...overrides
  };
}

test('exports Decision Intelligence Pipeline Stability Baseline public APIs', () => {
  assert.equal(typeof buildDecisionIntelligencePipelineBaseline, 'function');
  assert.equal(typeof validateDecisionIntelligencePipelineBaseline, 'function');
  assert.equal(typeof compareDecisionIntelligencePipelineBaselines, 'function');
  assert.equal(typeof buildDecisionIntelligencePipelineCertification, 'function');
  assert.equal(typeof summarizeDecisionIntelligencePipelineBaseline, 'function');
});

test('builds deterministic immutable stability baselines with component and API inventories', () => {
  const first = buildDecisionIntelligencePipelineBaseline(completeInput(), {
    baselineId: 'decision-intelligence-baseline-001',
    testMetadata: { focusedTests: 'passed', fullSuite: 'passed' }
  });
  const second = buildDecisionIntelligencePipelineBaseline(completeInput(), {
    baselineId: 'decision-intelligence-baseline-001',
    testMetadata: { focusedTests: 'passed', fullSuite: 'passed' }
  });
  const validation = validateDecisionIntelligencePipelineBaseline(first);

  assert.equal(Object.isFrozen(first), true);
  assert.deepEqual(first, second);
  assert.equal(validation.valid, true);
  assert.equal(first.componentInventory.length, 4);
  assert.equal(first.publicApiInventory.some((api) => api.apiName === 'runDecisionIntelligencePipeline'), true);
  assert.equal(first.statusSummary.allComponentsPassed, true);
  assert.equal(first.crossComponentIntegrity.status, 'passed');
  assert.equal(first.deterministicFingerprintValidation.status, 'passed');
});

test('captures advisory-only and offline boundary verification', () => {
  const built = buildDecisionIntelligencePipelineBaseline(completeInput());

  assert.equal(built.advisoryOnlyBoundaryVerification.status, 'passed');
  assert.equal(built.offlineBoundaryVerification.status, 'passed');
  assert.equal(built.futureIntegrationReadiness.suitableForProductionAuthority, false);
  assert.equal(built.productionImpact, 'none');
  assert.equal(built.decisionImpact, 'none');
  assert.equal(built.executionAuthority, 'none');
});

test('builds evidence-only certifications and preserves visible limitations', () => {
  const built = buildDecisionIntelligencePipelineBaseline(completeInput(), {
    knownArchitecturalLimitations: ['human_review_required_before_promotion'],
    warnings: ['manual_review_sample_size_small']
  });
  const certification = buildDecisionIntelligencePipelineCertification(built, {
    certificationId: 'decision-intelligence-certification-001',
    createdAt: '2026-07-30T19:10:00.000Z'
  });

  assert.equal(Object.isFrozen(certification), true);
  assert.equal(certification.certificationStatus, 'certified_with_warnings');
  assert.equal(certification.certified, true);
  assert.equal(certification.certificationRules.productionApprovalGranted, false);
  assert.equal(certification.certificationRules.purchaseAuthorityGranted, false);
  assert.deepEqual(certification.warnings, [
    'decision_reasons_missing',
    'explanation_headline_missing',
    'manual_review_sample_size_small',
    'visible_uncertainty_preserved'
  ]);
  assert.equal(certification.executionAuthority, 'none');
});

test('failed component validation prevents passing certification', () => {
  const built = buildDecisionIntelligencePipelineBaseline(completeInput({
    listingRef: {
      listingFingerprint: 'listing-without-id'
    },
    productionScoringObservation: {
      values: {
        decision: 'PASS'
      }
    }
  }));
  const validation = validateDecisionIntelligencePipelineBaseline(built);
  const certification = buildDecisionIntelligencePipelineCertification(built);

  assert.equal(validation.valid, false);
  assert.equal(built.statusSummary.failedComponents.includes('evidenceBundle'), true);
  assert.equal(certification.certificationStatus, 'invalid');
  assert.equal(certification.certified, false);
});

test('detects baseline fingerprint drift and authority violations', () => {
  const built = buildDecisionIntelligencePipelineBaseline(completeInput());
  const validation = validateDecisionIntelligencePipelineBaseline({
    ...built,
    executionAuthority: 'approve_purchase'
  });

  assert.equal(validation.valid, false);
  assert.equal(validation.reasonCodes.includes('authority_boundary_violation'), true);
  assert.equal(validation.reasonCodes.includes('baseline_fingerprint_mismatch'), true);
  assert.deepEqual(validation.authorityViolations, ['executionAuthority']);
});

test('compares baselines deterministically without treating identity-only changes as semantic drift', () => {
  const first = buildDecisionIntelligencePipelineBaseline(completeInput(), {
    baselineId: 'decision-intelligence-baseline-001'
  });
  const second = buildDecisionIntelligencePipelineBaseline(completeInput(), {
    baselineId: 'decision-intelligence-baseline-002'
  });
  const changed = buildDecisionIntelligencePipelineBaseline(completeInput(), {
    baselineId: 'decision-intelligence-baseline-003',
    warnings: ['new_visible_warning']
  });

  const exact = compareDecisionIntelligencePipelineBaselines(first, second);
  const mismatch = compareDecisionIntelligencePipelineBaselines(first, changed);

  assert.equal(exact.parityStatus, 'exact_match');
  assert.equal(exact.equal, true);
  assert.equal(mismatch.parityStatus, 'mismatch');
  assert.deepEqual(mismatch.differences, ['warnings']);
  assert.equal(mismatch.productionImpact, 'none');
});

test('summarizes baseline readiness deterministically', () => {
  const built = buildDecisionIntelligencePipelineBaseline(completeInput());
  const summary = summarizeDecisionIntelligencePipelineBaseline(built);

  assert.equal(Object.isFrozen(summary), true);
  assert.equal(summary.componentCount, 4);
  assert.equal(summary.publicApiCount > 0, true);
  assert.equal(summary.failedComponentCount, 0);
  assert.equal(summary.crossComponentIntegrityStatus, 'passed');
  assert.equal(summary.certificationStatus, 'certified_with_warnings');
  assert.equal(summary.suitableForProductionAuthority, false);
});

test('module stays offline and avoids production runtime imports', () => {
  const loaded = new Set();
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    loaded.add(request);
    return originalLoad.apply(this, arguments);
  };
  try {
    delete require.cache[require.resolve('../validation/decisionIntelligencePipelineStabilityBaseline')];
    require('../validation/decisionIntelligencePipelineStabilityBaseline');
  } finally {
    Module._load = originalLoad;
  }

  assert.equal([...loaded].some((item) => item.includes('server.js')), false);
  assert.equal([...loaded].some((item) => item.includes('decisionEngine')), false);
  assert.equal([...loaded].some((item) => item.includes('valuationRangeEngine')), false);
  assert.equal([...loaded].some((item) => item.includes('dealGate')), false);
  assert.equal([...loaded].some((item) => item.includes('stateStore')), false);
});
