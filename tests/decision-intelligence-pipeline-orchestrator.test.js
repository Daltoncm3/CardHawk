'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const { EXPECTED_SIGNAL_NAMES } = require('../validation/decisionIntelligenceArtifactBuilder');
const {
  runDecisionIntelligencePipeline,
  validateDecisionIntelligencePipeline,
  buildDecisionIntelligencePipelineReport,
  summarizeDecisionIntelligencePipeline,
  compareDecisionIntelligencePipelineRuns,
  PIPELINE_STAGES
} = require('../validation/decisionIntelligencePipelineOrchestrator');

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
    bundleId: 'decision-intelligence-evidence-bundle-pipeline-001',
    artifactId: 'decision-intelligence-artifact-pipeline-001',
    runId: 'decision-intelligence-pipeline-run-001',
    createdAt: '2026-07-30T18:00:00.000Z',
    capturedAt: '2026-07-30T17:59:00.000Z',
    listingRef: {
      listingId: 'listing-pipeline-001',
      marketplace: 'ebay',
      source: 'offline_review',
      marketplaceItemId: 'item-pipeline-001',
      title: '1986 Fleer Michael Jordan PSA 8',
      url: 'https://example.test/listing-pipeline-001',
      askingPrice: 4000,
      shipping: 0,
      totalCost: 4000,
      listingState: 'active',
      capturedAt: '2026-07-30T17:58:00.000Z',
      listingFingerprint: 'listing-fingerprint-pipeline'
    },
    canonicalIdentityRef: {
      canonicalIdentityId: 'canonical-identity-pipeline',
      canonicalIdentityFingerprint: 'canonical-identity-fingerprint-pipeline',
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
        valuationId: 'production-valuation-pipeline',
        valuationFingerprint: 'production-valuation-fingerprint',
        summary: 'Production valuation reference.'
      },
      rangeFirstValuation: {
        valuationId: 'range-valuation-pipeline',
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
      observedAt: '2026-07-30T17:59:10.000Z',
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
      observedAt: '2026-07-30T17:59:20.000Z',
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
      createdBy: 'pipeline-test',
      reviewBatchId: 'review-batch-pipeline',
      workspaceId: 'workspace-pipeline'
    },
    ...overrides
  };
}

test('exports Decision Intelligence Pipeline Orchestrator public APIs', () => {
  assert.equal(typeof runDecisionIntelligencePipeline, 'function');
  assert.equal(typeof validateDecisionIntelligencePipeline, 'function');
  assert.equal(typeof buildDecisionIntelligencePipelineReport, 'function');
  assert.equal(typeof summarizeDecisionIntelligencePipeline, 'function');
  assert.equal(typeof compareDecisionIntelligencePipelineRuns, 'function');
});

test('runs the complete offline pipeline deterministically and immutably', () => {
  const first = runDecisionIntelligencePipeline(completeInput());
  const second = runDecisionIntelligencePipeline(completeInput());

  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.pipelineReport), true);
  assert.deepEqual(first, second);
  assert.equal(first.productionImpact, 'none');
  assert.equal(first.decisionImpact, 'none');
  assert.equal(first.executionAuthority, 'none');
  assert.equal(first.evidenceBundleValidation.valid, true);
  assert.equal(first.artifactValidation.valid, true);
  assert.equal(first.artifactConformance.valid, true);
  assert.equal(first.pipelineReport.pipelineDiagnostics.valid, true);
  assert.deepEqual(first.pipelineReport.stageResults.map((stage) => stage.stageName), PIPELINE_STAGES.filter((stage) => stage !== 'pipeline_report'));
});

test('validates pipeline fingerprints, stages, and advisory boundaries', () => {
  const run = runDecisionIntelligencePipeline(completeInput());
  const valid = validateDecisionIntelligencePipeline(run);
  const authorityDrift = validateDecisionIntelligencePipeline({
    ...run,
    productionImpact: 'changes_runtime'
  });
  const fingerprintDrift = validateDecisionIntelligencePipeline({
    ...run,
    runId: 'changed-run-id'
  });

  assert.equal(valid.valid, true);
  assert.deepEqual(valid.stageViolations, []);
  assert.equal(authorityDrift.valid, false);
  assert.deepEqual(authorityDrift.authorityViolations, ['productionImpact']);
  assert.equal(fingerprintDrift.valid, false);
  assert.deepEqual(fingerprintDrift.fingerprintViolations, ['pipelineFingerprint', 'pipelineReport']);
});

test('preserves evidence gaps and unknown values through the bundle, artifact, and report', () => {
  const run = runDecisionIntelligencePipeline(completeInput({
    signalRefs: [signalRef('decision.context.diagnostics', 1)],
    expectedSignalNames: ['decision.context.diagnostics', 'production.valuation.diagnostics']
  }));
  const summary = summarizeDecisionIntelligencePipeline(run);

  assert.equal(run.evidenceBundle.missingReferences.some((reference) => reference.referenceName === 'production.valuation.diagnostics'), true);
  assert.equal(run.decisionArtifact.outstandingEvidenceGaps.some((gap) => gap.missingSignalName === 'production.valuation.diagnostics'), true);
  assert.equal(run.decisionArtifact.unknownValues.some((unknown) => unknown.field === 'seller.returnPolicy'), true);
  assert.equal(run.pipelineReport.pipelineDiagnostics.evidenceGapCount, run.evidenceBundleSummary.evidenceGapCount);
  assert.equal(summary.unknownValueCount, 1);
});

test('reports invalid pipeline diagnostics for missing required evidence without repairing it', () => {
  const run = runDecisionIntelligencePipeline(completeInput({
    listingRef: { listingFingerprint: 'listing-without-id' },
    productionScoringObservation: {
      values: {
        decision: 'PASS'
      }
    }
  }));
  const validation = validateDecisionIntelligencePipeline(run);

  assert.equal(run.evidenceBundleValidation.valid, false);
  assert.equal(validation.valid, false);
  assert.equal(validation.reasonCodes.includes('required_reference_missing'), true);
  assert.equal(validation.stageViolations.includes('evidence_bundle_validation'), true);
  assert.equal(run.decisionArtifact.listingRef.listingId, 'unknown');
  assert.equal(run.productionImpact, 'none');
});

test('builds deterministic pipeline reports from existing pipeline artifacts', () => {
  const run = runDecisionIntelligencePipeline(completeInput());
  const firstReport = buildDecisionIntelligencePipelineReport(run);
  const secondReport = buildDecisionIntelligencePipelineReport(run);

  assert.deepEqual(firstReport, secondReport);
  assert.equal(firstReport.evidenceBundleFingerprint, run.evidenceBundle.bundleFingerprint);
  assert.equal(firstReport.artifactFingerprint, run.decisionArtifact.artifactFingerprint);
  assert.equal(firstReport.conformanceFingerprint, run.artifactConformance.conformanceFingerprint);
  assert.equal(firstReport.productionImpact, 'none');
});

test('summarizes pipeline readiness without granting authority', () => {
  const run = runDecisionIntelligencePipeline(completeInput());
  const summary = summarizeDecisionIntelligencePipeline(run);

  assert.equal(Object.isFrozen(summary), true);
  assert.equal(summary.runId, 'decision-intelligence-pipeline-run-001');
  assert.equal(summary.decisionArtifactId, 'decision-intelligence-artifact:listing-pipeline-001');
  assert.equal(summary.valid, true);
  assert.equal(summary.readyForGovernanceReview, true);
  assert.equal(summary.productionImpact, 'none');
  assert.equal(summary.decisionImpact, 'none');
  assert.equal(summary.executionAuthority, 'none');
});

test('compares pipeline runs deterministically', () => {
  const first = runDecisionIntelligencePipeline(completeInput());
  const second = runDecisionIntelligencePipeline(completeInput());
  const changed = runDecisionIntelligencePipeline(completeInput({
    bundleId: 'decision-intelligence-evidence-bundle-pipeline-002',
    evidenceGaps: [
      {
        gapId: 'new-gap',
        category: 'evidence',
        description: 'Additional evidence needs review.',
        expectedEvidence: 'manual_note',
        blocking: false
      }
    ]
  }));

  const exact = compareDecisionIntelligencePipelineRuns(first, second);
  const mismatch = compareDecisionIntelligencePipelineRuns(first, changed);

  assert.equal(exact.parityStatus, 'exact_match');
  assert.equal(exact.mismatchCount, 0);
  assert.equal(mismatch.parityStatus, 'mismatch');
  assert.ok(mismatch.mismatchCount > 0);
  assert.equal(mismatch.artifactComparison.parityStatus, 'mismatch');
  assert.equal(mismatch.executionAuthority, 'none');
});

test('module stays offline and avoids production runtime imports', () => {
  const loaded = new Set();
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    loaded.add(request);
    return originalLoad.apply(this, arguments);
  };
  try {
    delete require.cache[require.resolve('../validation/decisionIntelligencePipelineOrchestrator')];
    require('../validation/decisionIntelligencePipelineOrchestrator');
  } finally {
    Module._load = originalLoad;
  }

  assert.equal([...loaded].some((item) => item.includes('server.js')), false);
  assert.equal([...loaded].some((item) => item.includes('decisionEngine')), false);
  assert.equal([...loaded].some((item) => item.includes('valuationRangeEngine')), false);
  assert.equal([...loaded].some((item) => item.includes('dealGate')), false);
  assert.equal([...loaded].some((item) => item.includes('stateStore')), false);
});
