'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const builder = require('../validation/decisionIntelligenceArtifactBuilder');
const conformance = require('../validation/decisionIntelligenceArtifactConformance');

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

function input(overrides = {}) {
  return {
    artifactId: 'decision-intelligence-artifact-conformance-001',
    createdAt: '2026-07-30T15:00:00.000Z',
    capturedAt: '2026-07-30T14:59:00.000Z',
    listingRef: {
      listingId: 'listing-conformance-001',
      marketplace: 'ebay',
      source: 'offline_review',
      marketplaceItemId: 'item-conformance-001',
      title: '2003 Topps Chrome LeBron James PSA 9',
      url: 'https://example.test/listing-conformance-001',
      askingPrice: 800,
      shipping: 0,
      totalCost: 800,
      capturedAt: '2026-07-30T14:58:00.000Z',
      listingFingerprint: 'listing-fingerprint-conformance'
    },
    canonicalIdentityRef: {
      canonicalIdentityId: 'canonical-identity-conformance',
      canonicalIdentityFingerprint: 'canonical-identity-fingerprint',
      canonicalIdentitySummary: 'LeBron James rookie PSA 9',
      identityEligibility: 'eligible',
      diagnosticStatus: 'complete',
      confirmedFields: { subject: 'LeBron James', grade: 'PSA 9' },
      missingFields: [],
      conflictingFields: []
    },
    signalRefs: builder.EXPECTED_SIGNAL_NAMES.map(signalRef),
    valuationRefs: {
      estimatedValue: 1000,
      estimatedProfit: 200,
      roi: 25,
      floorValue: 900,
      expectedValue: 1000,
      ceilingValue: 1150,
      valuationConfidence: 82,
      valuationRangeQuality: 'strong',
      productionValuation: {
        valuationId: 'production-valuation-conformance',
        valuationFingerprint: 'production-valuation-fingerprint',
        summary: 'Production valuation is supported.'
      }
    },
    productionDecisionRef: {
      decisionEngineFingerprint: 'decision-engine-fingerprint',
      decision: 'STRONG_WATCH',
      recommendation: 'STRONG_WATCH',
      action: 'STRONG_WATCH',
      decisionScore: 78,
      evidenceScore: 82,
      opportunityScore: 74,
      decisionConfidence: 81,
      decisionMatrix: { evidenceStrength: 84, pricingConfidence: 80, investmentQuality: 74 },
      positives: ['Evidence strength is strong.'],
      warnings: ['Manual review remains required.'],
      blockingFactors: [],
      summary: 'Native decision engine context is strong watch.'
    },
    dealGateRef: {
      dealGateId: 'deal-gate-conformance',
      dealGateFingerprint: 'deal-gate-fingerprint',
      decision: 'REJECT',
      recommendation: 'reject',
      passed: false,
      approved: false,
      buyNowAllowed: false,
      reasons: ['Deal Gate did not approve BUY_NOW.'],
      rejectionReasons: ['Deal Gate did not approve BUY_NOW.'],
      ruleOutcomes: [{ ruleId: 'final_no_rejection_reasons', passed: false }]
    },
    confidenceInterpretation: {
      confidenceCalibrationStatus: 'calibration_available',
      confidenceExplanation: 'Confidence is high but still advisory.'
    },
    evidenceQualityAssessment: {
      evidenceReadinessStatus: 'strong',
      soldEvidenceSufficiency: 'strong',
      canonicalSoldEvidenceStatus: 'available',
      trueSoldCount: 8,
      evidenceQualityScore: 86,
      evidenceQualityLevel: 'strong',
      summary: 'Evidence quality is strong.'
    },
    comparableQualityAssessment: {
      comparableQualityStatus: 'trusted',
      averageComparableQualityScore: 85,
      scoredComparableCount: 8,
      acceptedComparableCount: 8,
      rejectedComparableCount: 0,
      summary: 'Comparable quality is trusted.'
    },
    agreementAnalysis: {
      overallAgreementStatus: 'partial_agreement',
      conflicts: [{ reasonId: 'decision-gate-gap', category: 'deal_gate', severity: 'caution', message: 'Decision engine is positive but Deal Gate is still final.' }],
      reviewFocus: ['deal_gate']
    },
    riskAssessment: {
      overallRiskPosture: 'moderate',
      riskScore: 35,
      riskLevel: 'moderate',
      summary: 'Risk is moderate.'
    },
    opportunityAssessment: {
      overallOpportunityPosture: 'promising',
      estimatedProfit: 200,
      roi: 25,
      investmentQuality: 74,
      opportunityDrivers: ['Value spread is positive.'],
      opportunityLimits: ['Final approval remains with Deal Gate.'],
      summary: 'Opportunity is promising.'
    },
    advisoryRecommendation: {
      recommendationType: 'advisory_watch',
      recommendationPosture: 'cautious',
      recommendationConfidence: 81,
      reviewPriority: 'high',
      summary: 'Review as a high-priority advisory candidate.'
    },
    supportingReasons: [
      {
        reasonId: 'strong-evidence',
        category: 'evidence',
        source: 'signal',
        sourceFingerprint: 'signal-fingerprint-0',
        severity: 'supporting',
        message: 'Evidence quality is strong.'
      }
    ],
    opposingReasons: [
      {
        reasonId: 'deal-gate-final',
        category: 'deal_gate',
        source: 'deal_gate',
        sourceFingerprint: 'deal-gate-fingerprint',
        severity: 'blocking',
        message: 'Deal Gate remains the final BUY_NOW boundary.'
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
    outstandingEvidenceGaps: [
      {
        gapId: 'manual-review-required',
        category: 'governance',
        description: 'Dalton review has not been attached yet.',
        expectedEvidence: 'human_review',
        reviewImpact: 'review_only',
        certificationImpact: 'blocks_certification',
        blocking: false
      }
    ],
    provenance: {
      sourceSystem: 'cardhawk_offline_validation',
      createdBy: 'conformance-test',
      reviewBatchId: 'review-batch-conformance'
    },
    ...overrides
  };
}

function artifact(overrides = {}) {
  return builder.buildDecisionIntelligenceArtifact(input(overrides));
}

test('exports Decision Intelligence Artifact Conformance public APIs', () => {
  assert.equal(typeof conformance.validateDecisionIntelligenceArtifactConformance, 'function');
  assert.equal(typeof conformance.buildDecisionIntelligenceConformanceReport, 'function');
  assert.equal(typeof conformance.summarizeDecisionIntelligenceConformance, 'function');
  assert.equal(typeof conformance.compareDecisionIntelligenceArtifacts, 'function');
});

test('valid immutable artifact passes conformance with deterministic report', () => {
  const sourceInput = input();
  const built = builder.buildDecisionIntelligenceArtifact(sourceInput);
  const first = conformance.validateDecisionIntelligenceArtifactConformance(built, {
    sourceInput,
    createdAt: '2026-07-30T15:01:00.000Z'
  });
  const second = conformance.validateDecisionIntelligenceArtifactConformance(built, {
    sourceInput,
    createdAt: '2026-07-30T15:01:00.000Z'
  });

  assert.equal(first.valid, true);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(first.stageResults.length, conformance.CONFORMANCE_STAGES.length);
  assert.equal(first.summary.failedStageCount, 0);
  assert.deepEqual(first, second);
  assert.equal(first.conformanceFingerprint, conformance.buildConformanceFingerprint(first));
  assert.equal(first.productionImpact, 'none');
  assert.equal(first.decisionImpact, 'none');
  assert.equal(first.executionAuthority, 'none');
});

test('detects schema, required field, and fingerprint violations', () => {
  const built = artifact();
  const malformed = {
    ...built,
    schemaVersion: 'bad-version',
    artifactType: 'bad_type',
    artifactFingerprint: 'stale'
  };
  delete malformed.listingRef;

  const report = conformance.validateDecisionIntelligenceArtifactConformance(malformed);

  assert.equal(report.valid, false);
  assert.equal(report.reasonCodes.includes('invalid_schema_version'), true);
  assert.equal(report.reasonCodes.includes('invalid_artifact_type'), true);
  assert.equal(report.reasonCodes.includes('missing_required_field'), true);
  assert.equal(report.reasonCodes.includes('artifact_fingerprint_mismatch'), true);
});

test('detects immutability violations on mutable artifact snapshots', () => {
  const mutable = JSON.parse(JSON.stringify(artifact()));
  const report = conformance.validateDecisionIntelligenceArtifactConformance(mutable);

  assert.equal(report.valid, false);
  assert.equal(report.reasonCodes.includes('artifact_not_immutable'), true);
  assert.equal(report.immutabilityValidation.immutableViolations.includes('artifact'), true);
  assert.equal(report.immutabilityValidation.immutableViolations.includes('signalRefs'), true);
});

test('detects provenance integrity warnings and errors', () => {
  const built = artifact();
  const malformed = Object.freeze({
    ...built,
    provenance: Object.freeze({
      ...built.provenance,
      builderName: 'other_builder',
      inputFingerprints: []
    })
  });

  const report = conformance.validateDecisionIntelligenceArtifactConformance(malformed);

  assert.equal(report.valid, false);
  assert.equal(report.reasonCodes.includes('invalid_provenance_builder'), true);
  assert.equal(report.reasonCodes.includes('provenance_input_fingerprints_missing'), true);
});

test('detects advisory-only boundary violations', () => {
  const built = artifact();
  const unsafe = Object.freeze({
    ...built,
    productionImpact: 'changes_runtime',
    advisoryRecommendation: Object.freeze({
      ...built.advisoryRecommendation,
      purchaseAuthority: 'approved'
    }),
    buyNowRef: Object.freeze({
      ...built.buyNowRef,
      purchaseAuthority: 'approved'
    })
  });

  const report = conformance.validateDecisionIntelligenceArtifactConformance(unsafe);

  assert.equal(report.valid, false);
  assert.equal(report.reasonCodes.includes('authority_boundary_violation'), true);
  assert.equal(report.reasonCodes.includes('advisory_authority_violation'), true);
  assert.equal(report.reasonCodes.includes('buy_now_authority_violation'), true);
});

test('detects reference integrity gaps without recomputing Signals', () => {
  const built = artifact({
    signalRefs: [signalRef('decision.context.diagnostics', 1)],
    expectedSignalNames: ['decision.context.diagnostics', 'production.valuation.diagnostics']
  });
  const report = conformance.validateDecisionIntelligenceArtifactConformance(built, {
    expectedSignalNames: ['decision.context.diagnostics', 'production.valuation.diagnostics']
  });

  assert.equal(report.valid, true);
  assert.equal(report.reasonCodes.includes('expected_signal_reference_missing'), true);
  assert.deepEqual(report.referenceIntegrity.missingSignals, ['production.valuation.diagnostics']);
  assert.deepEqual(report.evidenceGapPreservation.missingSignalGaps, ['production.valuation.diagnostics']);
});

test('detects deterministic construction mismatches when source input does not reproduce artifact', () => {
  const built = artifact();
  const report = conformance.validateDecisionIntelligenceArtifactConformance(built, {
    sourceInput: input({
      artifactId: 'different-artifact-id'
    })
  });

  assert.equal(report.valid, false);
  assert.equal(report.reasonCodes.includes('artifact_not_reproducible'), true);
});

test('detects unknown value and evidence gap preservation violations', () => {
  const built = artifact();
  const malformed = Object.freeze({
    ...built,
    unknownValues: Object.freeze([
      Object.freeze({
        ...built.unknownValues[0],
        field: ''
      })
    ]),
    outstandingEvidenceGaps: Object.freeze([
      Object.freeze({
        ...built.outstandingEvidenceGaps[0],
        description: ''
      })
    ])
  });

  const report = conformance.validateDecisionIntelligenceArtifactConformance(malformed);

  assert.equal(report.valid, false);
  assert.equal(report.reasonCodes.includes('unknown_value_field_missing'), true);
  assert.equal(report.reasonCodes.includes('evidence_gap_description_missing'), true);
});

test('detects explanation completeness failures', () => {
  const built = artifact();
  const malformed = Object.freeze({
    ...built,
    explanationSummary: Object.freeze({
      ...built.explanationSummary,
      decisionTrace: []
    })
  });

  const report = conformance.validateDecisionIntelligenceArtifactConformance(malformed);

  assert.equal(report.valid, false);
  assert.equal(report.reasonCodes.includes('decision_trace_missing'), true);
});

test('validates Governance binding compatibility boundaries', () => {
  const built = artifact();
  const malformed = Object.freeze({
    ...built,
    compatibility: Object.freeze({
      ...built.compatibility,
      runtimeIntegration: 'production'
    })
  });

  const report = conformance.validateDecisionIntelligenceArtifactConformance(malformed);

  assert.equal(report.valid, false);
  assert.equal(report.reasonCodes.includes('runtime_integration_violation'), true);
  assert.equal(report.governanceBindingCompatibility.readyForGovernanceBinding, false);
});

test('compares artifacts deterministically and reports exact matches or mismatches', () => {
  const first = artifact();
  const second = artifact();
  const changed = artifact({
    artifactId: 'decision-intelligence-artifact-conformance-002',
    advisoryRecommendation: {
      recommendationType: 'advisory_monitor',
      recommendationPosture: 'cautious',
      recommendationConfidence: 55,
      reviewPriority: 'normal',
      summary: 'Monitor as an advisory candidate.'
    }
  });

  const exact = conformance.compareDecisionIntelligenceArtifacts(first, second);
  const mismatch = conformance.compareDecisionIntelligenceArtifacts(first, changed);

  assert.equal(exact.parityStatus, 'exact_match');
  assert.equal(exact.mismatchCount, 0);
  assert.equal(mismatch.parityStatus, 'mismatch');
  assert.ok(mismatch.mismatchCount > 0);
  assert.equal(mismatch.productionImpact, 'none');
});

test('conformance module stays offline and avoids production runtime imports', () => {
  const loaded = new Set();
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    loaded.add(request);
    return originalLoad.apply(this, arguments);
  };
  try {
    delete require.cache[require.resolve('../validation/decisionIntelligenceArtifactConformance')];
    require('../validation/decisionIntelligenceArtifactConformance');
  } finally {
    Module._load = originalLoad;
  }

  assert.equal([...loaded].some((item) => item.includes('server.js')), false);
  assert.equal([...loaded].some((item) => item.includes('decisionEngine')), false);
  assert.equal([...loaded].some((item) => item.includes('decisionIntelligenceEngine')), false);
  assert.equal([...loaded].some((item) => item.includes('valuationRangeEngine')), false);
  assert.equal([...loaded].some((item) => item.includes('dealGate')), false);
  assert.equal([...loaded].some((item) => item.includes('stateStore')), false);
});
