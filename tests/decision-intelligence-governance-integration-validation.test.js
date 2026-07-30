'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const { EXPECTED_SIGNAL_NAMES } = require('../validation/decisionIntelligenceArtifactBuilder');
const {
  runDecisionIntelligenceGovernanceValidation,
  validateDecisionIntelligenceGovernanceIntegration,
  buildDecisionIntelligenceGovernanceValidationReport,
  summarizeDecisionIntelligenceGovernanceValidation,
  VALIDATION_STAGES
} = require('../validation/decisionIntelligenceGovernanceIntegrationValidation');

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
    bundleId: 'decision-intelligence-evidence-bundle-integration-001',
    artifactId: 'decision-intelligence-artifact-integration-001',
    runId: 'decision-intelligence-pipeline-integration-run-001',
    createdAt: '2026-07-30T21:00:00.000Z',
    capturedAt: '2026-07-30T20:59:00.000Z',
    listingRef: {
      listingId: 'listing-integration-001',
      marketplace: 'ebay',
      source: 'offline_review',
      marketplaceItemId: 'item-integration-001',
      title: '1986 Fleer Michael Jordan PSA 8',
      url: 'https://example.test/listing-integration-001',
      askingPrice: 4000,
      shipping: 0,
      totalCost: 4000,
      listingState: 'active',
      capturedAt: '2026-07-30T20:58:00.000Z',
      listingFingerprint: 'listing-fingerprint-integration'
    },
    canonicalIdentityRef: {
      canonicalIdentityId: 'canonical-identity-integration',
      canonicalIdentityFingerprint: 'canonical-identity-fingerprint-integration',
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
        valuationId: 'production-valuation-integration',
        valuationFingerprint: 'production-valuation-fingerprint',
        summary: 'Production valuation reference.'
      },
      rangeFirstValuation: {
        valuationId: 'range-valuation-integration',
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
      observedAt: '2026-07-30T20:59:10.000Z',
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
      observedAt: '2026-07-30T20:59:20.000Z',
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
      createdBy: 'integration-validation-test',
      reviewBatchId: 'review-batch-integration',
      workspaceId: 'workspace-integration'
    },
    ...overrides
  };
}

test('exports Decision Intelligence Governance integration validation public APIs', () => {
  assert.equal(typeof runDecisionIntelligenceGovernanceValidation, 'function');
  assert.equal(typeof validateDecisionIntelligenceGovernanceIntegration, 'function');
  assert.equal(typeof buildDecisionIntelligenceGovernanceValidationReport, 'function');
  assert.equal(typeof summarizeDecisionIntelligenceGovernanceValidation, 'function');
});

test('runs a deterministic immutable end-to-end Governance integration validation', () => {
  const first = runDecisionIntelligenceGovernanceValidation(pipelineInput());
  const second = runDecisionIntelligenceGovernanceValidation(pipelineInput());
  const validation = validateDecisionIntelligenceGovernanceIntegration(first);

  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.stageResults), true);
  assert.deepEqual(first, second);
  assert.equal(validation.valid, true);
  assert.equal(first.integrationDiagnostics.stageCount, VALIDATION_STAGES.length);
  assert.equal(first.integrationDiagnostics.failedStageCount, 0);
  assert.deepEqual(first.stageResults.map((stage) => stage.stageName), VALIDATION_STAGES);
});

test('validates Registry and Lifecycle compatibility through public APIs', () => {
  const report = runDecisionIntelligenceGovernanceValidation(pipelineInput());
  const registryStage = report.stageResults.find((stage) => stage.stageName === 'registry_compatibility');
  const lifecycleStage = report.stageResults.find((stage) => stage.stageName === 'lifecycle_compatibility');

  assert.equal(registryStage.valid, true);
  assert.equal(registryStage.artifactCount, 1);
  assert.equal(lifecycleStage.valid, true);
  assert.equal(lifecycleStage.currentState, 'active');
  assert.equal(report.integrationDiagnostics.registryRegistered, true);
  assert.equal(report.integrationDiagnostics.lifecycleState, 'active');
});

test('preserves readiness, warning, provenance, and fingerprint continuity', () => {
  const report = runDecisionIntelligenceGovernanceValidation(pipelineInput());
  const summary = summarizeDecisionIntelligenceGovernanceValidation(report);

  assert.equal(summary.reviewReadinessStatus, 'review_ready_with_warnings');
  assert.equal(summary.certificationReadinessStatus, 'certification_ready_with_warnings');
  assert.equal(summary.warningCount > 0, true);
  assert.equal(report.stageResults.find((stage) => stage.stageName === 'review_readiness_propagation').valid, true);
  assert.equal(report.stageResults.find((stage) => stage.stageName === 'certification_readiness_propagation').valid, true);
  assert.equal(report.stageResults.find((stage) => stage.stageName === 'warning_propagation').valid, true);
  assert.equal(report.stageResults.find((stage) => stage.stageName === 'provenance_continuity').valid, true);
  assert.equal(report.stageResults.find((stage) => stage.stageName === 'fingerprint_continuity').valid, true);
});

test('detects authority-boundary violations without repairing artifacts', () => {
  const clean = runDecisionIntelligenceGovernanceValidation(pipelineInput());
  const drifted = {
    ...clean,
    productionImpact: 'changes_runtime'
  };
  const validation = validateDecisionIntelligenceGovernanceIntegration(drifted);

  assert.equal(clean.productionImpact, 'none');
  assert.equal(clean.decisionImpact, 'none');
  assert.equal(clean.executionAuthority, 'none');
  assert.equal(validation.valid, false);
  assert.deepEqual(validation.authorityViolations, ['productionImpact']);
});

test('detects fingerprint drift deterministically', () => {
  const clean = runDecisionIntelligenceGovernanceValidation(pipelineInput());
  const drifted = {
    ...clean,
    bindingFingerprint: 'tampered-binding-fingerprint'
  };
  const validation = validateDecisionIntelligenceGovernanceIntegration(drifted);

  assert.equal(validation.valid, false);
  assert.deepEqual(validation.fingerprintViolations, ['validationFingerprint']);
});

test('module stays offline and avoids production runtime imports', () => {
  const loaded = new Set();
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    loaded.add(request);
    return originalLoad.apply(this, arguments);
  };
  try {
    delete require.cache[require.resolve('../validation/decisionIntelligenceGovernanceIntegrationValidation')];
    require('../validation/decisionIntelligenceGovernanceIntegrationValidation');
  } finally {
    Module._load = originalLoad;
  }

  assert.equal([...loaded].some((item) => item.includes('server.js')), false);
  assert.equal([...loaded].some((item) => item.includes('dealGate')), false);
  assert.equal([...loaded].some((item) => item.includes('buyNow')), false);
  assert.equal([...loaded].some((item) => item.includes('decisionEngine')), false);
  assert.equal([...loaded].some((item) => item.includes('stateStore')), false);
});
