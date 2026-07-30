'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const builder = require('../validation/decisionIntelligenceArtifactBuilder');

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

function completeSignalRefs() {
  return builder.EXPECTED_SIGNAL_NAMES.map(signalRef).reverse();
}

function baseInput(overrides = {}) {
  return {
    artifactId: 'decision-intelligence-artifact-001',
    createdAt: '2026-07-30T14:00:00.000Z',
    capturedAt: '2026-07-30T13:59:00.000Z',
    listingRef: {
      listingId: 'listing-001',
      marketplace: 'ebay',
      source: 'scout_scan',
      marketplaceItemId: 'item-001',
      title: '1999 Pokemon Charizard PSA 9',
      url: 'https://example.test/listing-001',
      askingPrice: 100,
      shipping: 5,
      totalCost: 105,
      sellerSummary: { feedbackScore: 500 },
      listingState: 'active',
      capturedAt: '2026-07-30T13:58:00.000Z',
      listingFingerprint: 'listing-fingerprint-001'
    },
    canonicalIdentityRef: {
      canonicalIdentityId: 'canonical-identity-001',
      canonicalIdentityFingerprint: 'identity-fingerprint-001',
      canonicalIdentitySummary: 'Charizard PSA 9',
      identityEligibility: 'eligible',
      diagnosticStatus: 'complete',
      confirmedFields: { subject: 'Charizard', grade: 'PSA 9' },
      missingFields: [],
      conflictingFields: [],
      warnings: [],
      blockingIssues: []
    },
    signalRefs: completeSignalRefs(),
    valuationRefs: {
      estimatedValue: 150,
      estimatedProfit: 45,
      roi: 42.86,
      floorValue: 125,
      expectedValue: 150,
      ceilingValue: 180,
      valuationConfidence: 72,
      valuationRangeQuality: 'usable',
      valuationSourceFingerprints: ['production-valuation-fingerprint', 'range-valuation-fingerprint'],
      productionValuation: {
        valuationId: 'production-valuation-001',
        valuationFingerprint: 'production-valuation-fingerprint',
        summary: 'Production valuation summary.'
      },
      rangeFirstValuation: {
        valuationId: 'range-valuation-001',
        valuationFingerprint: 'range-valuation-fingerprint',
        summary: 'Range valuation summary.'
      }
    },
    productionDecisionRef: {
      decisionEngineFingerprint: 'decision-engine-fingerprint',
      decision: 'STRONG_WATCH',
      recommendation: 'STRONG_WATCH',
      action: 'STRONG_WATCH',
      decisionScore: 74,
      evidenceScore: 70,
      opportunityScore: 80,
      decisionConfidence: 68,
      decisionMatrix: { evidenceStrength: 70, investmentQuality: 82 },
      positives: ['Expected profit is meaningful.'],
      warnings: ['Manual review still required.'],
      blockingFactors: [],
      summary: 'Strong watch from native decision engine.'
    },
    dealGateRef: {
      dealGateId: 'deal-gate-001',
      dealGateFingerprint: 'deal-gate-fingerprint',
      decision: 'REJECT',
      recommendation: 'reject',
      passed: false,
      approved: false,
      buyNowAllowed: false,
      reasons: ['Sold-comp history is too thin for BUY_NOW.'],
      rejectionReasons: ['Sold-comp history is too thin for BUY_NOW.'],
      positives: ['Profit is positive.'],
      ruleOutcomes: [{ ruleId: 'final_sold_comp_minimum', passed: false }]
    },
    confidenceInterpretation: {
      confidenceCalibrationStatus: 'limited_history',
      confidenceExplanation: 'Decision confidence is moderate and should be reviewed.'
    },
    evidenceQualityAssessment: {
      evidenceReadinessStatus: 'adequate',
      soldEvidenceSufficiency: 'limited',
      canonicalSoldEvidenceStatus: 'available',
      trueSoldCount: 3,
      evidenceQualityScore: 70,
      evidenceQualityLevel: 'adequate',
      summary: 'Evidence is usable but review-worthy.'
    },
    comparableQualityAssessment: {
      comparableQualityStatus: 'usable',
      averageComparableQualityScore: 76,
      scoredComparableCount: 3,
      acceptedComparableCount: 3,
      rejectedComparableCount: 0,
      summary: 'Comparable quality is usable.'
    },
    agreementAnalysis: {
      overallAgreementStatus: 'partial_agreement',
      conflicts: [{ reasonId: 'valuation-vs-gate', category: 'deal_gate', severity: 'caution', message: 'Valuation is usable, but Deal Gate rejects BUY_NOW.' }],
      reviewFocus: ['deal_gate', 'evidence']
    },
    riskAssessment: {
      overallRiskPosture: 'moderate',
      riskScore: 40,
      riskLevel: 'moderate',
      falsePositiveRisk: 'limited',
      summary: 'Risk is moderate.'
    },
    opportunityAssessment: {
      overallOpportunityPosture: 'promising',
      estimatedProfit: 45,
      roi: 42.86,
      investmentQuality: 82,
      opportunityDrivers: ['Profit is meaningful.'],
      opportunityLimits: ['Evidence still needs review.'],
      summary: 'Opportunity is promising but not automatically actionable.'
    },
    advisoryRecommendation: {
      recommendationType: 'advisory_watch',
      recommendationPosture: 'cautious',
      recommendationConfidence: 68,
      reviewPriority: 'normal',
      humanReviewRequired: true,
      summary: 'Review as a cautious opportunity.'
    },
    supportingReasons: [
      {
        reasonId: 'profit-support',
        category: 'opportunity',
        source: 'decision_engine',
        sourceFingerprint: 'decision-engine-fingerprint',
        severity: 'supporting',
        message: 'Expected profit is meaningful.'
      }
    ],
    opposingReasons: [
      {
        reasonId: 'gate-block',
        category: 'deal_gate',
        source: 'deal_gate',
        sourceFingerprint: 'deal-gate-fingerprint',
        severity: 'blocking',
        message: 'Deal Gate did not approve BUY_NOW.',
        ruleRefs: ['final_sold_comp_minimum']
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
        gapId: 'missing-return-policy',
        category: 'listing',
        description: 'Seller return policy was not supplied.',
        expectedEvidence: 'seller_policy',
        reviewImpact: 'review_only',
        blocking: false
      }
    ],
    provenance: {
      createdBy: 'test',
      reviewBatchId: 'review-batch-001'
    },
    ...overrides
  };
}

test('exports offline Decision Intelligence Artifact Builder public APIs', () => {
  assert.equal(typeof builder.buildDecisionIntelligenceArtifact, 'function');
  assert.equal(typeof builder.validateDecisionIntelligenceArtifact, 'function');
  assert.equal(typeof builder.deriveDecisionEvidence, 'function');
  assert.equal(typeof builder.deriveDecisionConfidence, 'function');
  assert.equal(typeof builder.deriveDecisionExplanation, 'function');
  assert.equal(typeof builder.summarizeDecisionArtifact, 'function');
});

test('builds a deterministic immutable advisory artifact from references', () => {
  const first = builder.buildDecisionIntelligenceArtifact(baseInput());
  const second = builder.buildDecisionIntelligenceArtifact(baseInput());

  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.signalRefs), true);
  assert.deepEqual(first, second);
  assert.equal(first.schemaVersion, builder.DECISION_INTELLIGENCE_ARTIFACT_SCHEMA_VERSION);
  assert.equal(first.productionImpact, 'none');
  assert.equal(first.decisionImpact, 'none');
  assert.equal(first.executionAuthority, 'none');
  assert.equal(first.advisoryRecommendation.productionAuthority, 'none');
  assert.equal(first.advisoryRecommendation.purchaseAuthority, 'none');
  assert.equal(first.buyNowRef.purchaseAuthority, 'none');
  assert.equal(first.artifactFingerprint, builder.buildDecisionIntelligenceArtifactFingerprint(first));
});

test('preserves source references and does not mutate supplied evidence', () => {
  const input = baseInput();
  const artifact = builder.buildDecisionIntelligenceArtifact(input);

  input.listingRef.title = 'mutated title';
  input.signalRefs[0].signalFingerprint = 'mutated-fingerprint';
  input.productionDecisionRef.decisionScore = 1;

  assert.equal(artifact.listingRef.title, '1999 Pokemon Charizard PSA 9');
  assert.equal(artifact.signalRefs.some((signal) => signal.signalFingerprint === 'mutated-fingerprint'), false);
  assert.equal(artifact.productionDecisionRef.decisionScore, 74);
});

test('sorts Signal references and preserves complete expected coverage', () => {
  const artifact = builder.buildDecisionIntelligenceArtifact(baseInput());

  assert.deepEqual(
    artifact.signalRefs.map((signal) => signal.signalName),
    [...builder.EXPECTED_SIGNAL_NAMES].sort()
  );
  assert.equal(artifact.outstandingEvidenceGaps.filter((gap) => gap.missingSignalName !== 'unknown').length, 0);
});

test('preserves unknown values and emits explicit missing Signal evidence gaps', () => {
  const artifact = builder.buildDecisionIntelligenceArtifact(baseInput({
    signalRefs: [signalRef('decision.context.diagnostics', 1)],
    expectedSignalNames: ['decision.context.diagnostics', 'production.valuation.diagnostics']
  }));

  assert.equal(artifact.unknownValues.length, 1);
  assert.equal(artifact.unknownValues[0].field, 'seller.returnPolicy');
  assert.equal(artifact.outstandingEvidenceGaps.some((gap) => gap.missingSignalName === 'production.valuation.diagnostics'), true);
  assert.equal(artifact.outstandingEvidenceGaps.some((gap) => gap.description.includes('Expected Signal reference is missing')), true);
});

test('derives confidence and explanation from supplied values only', () => {
  const input = baseInput();
  const evidence = builder.deriveDecisionEvidence(input);
  const confidence = builder.deriveDecisionConfidence(input, evidence);
  const explanation = builder.deriveDecisionExplanation(input, evidence, confidence);

  assert.equal(confidence.decisionConfidence, 68);
  assert.equal(confidence.overallConfidencePosture, 'moderate');
  assert.equal(explanation.decisionTrace.some((trace) => trace.message === 'Expected profit is meaningful.'), true);
  assert.equal(explanation.decisionTrace.some((trace) => trace.message === 'Deal Gate did not approve BUY_NOW.'), true);
});

test('validates artifacts, authority boundaries, fingerprints, and compatibility', () => {
  const artifact = builder.buildDecisionIntelligenceArtifact(baseInput());
  const valid = builder.validateDecisionIntelligenceArtifact(artifact);
  const authorityDrift = builder.validateDecisionIntelligenceArtifact({
    ...artifact,
    productionImpact: 'changes_runtime'
  });
  const fingerprintDrift = builder.validateDecisionIntelligenceArtifact({
    ...artifact,
    artifactId: 'changed'
  });
  const compatibilityDrift = builder.validateDecisionIntelligenceArtifact({
    ...artifact,
    compatibility: {
      ...artifact.compatibility,
      dealGateChanged: true
    }
  });

  assert.equal(valid.valid, true);
  assert.equal(authorityDrift.valid, false);
  assert.deepEqual(authorityDrift.authorityViolations, ['productionImpact']);
  assert.equal(fingerprintDrift.valid, false);
  assert.deepEqual(fingerprintDrift.fingerprintViolations, ['artifactFingerprint']);
  assert.equal(compatibilityDrift.valid, false);
  assert.deepEqual(compatibilityDrift.compatibilityViolations, ['compatibility.dealGateChanged']);
});

test('rejects unsupported advisory recommendation enums instead of converting them to BUY_NOW authority', () => {
  const artifact = builder.buildDecisionIntelligenceArtifact(baseInput({
    advisoryRecommendation: {
      recommendationType: 'BUY_NOW',
      recommendationPosture: 'supportive',
      purchaseAuthority: 'approved'
    }
  }));
  const validation = builder.validateDecisionIntelligenceArtifact(artifact);

  assert.equal(artifact.advisoryRecommendation.recommendationType, 'unknown');
  assert.equal(artifact.advisoryRecommendation.purchaseAuthority, 'none');
  assert.equal(validation.valid, true);
});

test('summarizes artifacts deterministically without granting authority', () => {
  const artifact = builder.buildDecisionIntelligenceArtifact(baseInput());
  const summary = builder.summarizeDecisionArtifact(artifact);

  assert.equal(Object.isFrozen(summary), true);
  assert.equal(summary.artifactId, 'decision-intelligence-artifact-001');
  assert.equal(summary.listingId, 'listing-001');
  assert.equal(summary.signalReferenceCount, builder.EXPECTED_SIGNAL_NAMES.length);
  assert.equal(summary.supportingReasonCount, 1);
  assert.equal(summary.opposingReasonCount, 1);
  assert.equal(summary.productionImpact, 'none');
  assert.equal(summary.decisionImpact, 'none');
  assert.equal(summary.executionAuthority, 'none');
});

test('module stays offline and does not import production engines or runtime systems', () => {
  const loaded = new Set();
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    loaded.add(request);
    return originalLoad.apply(this, arguments);
  };
  try {
    delete require.cache[require.resolve('../validation/decisionIntelligenceArtifactBuilder')];
    require('../validation/decisionIntelligenceArtifactBuilder');
  } finally {
    Module._load = originalLoad;
  }

  assert.equal([...loaded].some((item) => item.includes('server.js')), false);
  assert.equal([...loaded].some((item) => item.includes('decisionEngine')), false);
  assert.equal([...loaded].some((item) => item.includes('decisionIntelligenceEngine')), false);
  assert.equal([...loaded].some((item) => item.includes('valuationRangeEngine')), false);
  assert.equal([...loaded].some((item) => item.includes('signalMigration')), false);
  assert.equal([...loaded].some((item) => item.includes('governanceArtifactRegistry')), false);
});
