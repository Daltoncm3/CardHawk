'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const migration = require('../validation/falsePositiveSignalMigration');
const comparison = require('../validation/falsePositiveShadowComparison');
const registry = require('../validation/intelligenceSignalRegistry');
const signalContract = require('../validation/canonicalIntelligenceSignalContract');
const core = require('../validation/signalMigrationCore');
const comparisonCore = require('../validation/signalShadowComparisonCore');

function falsePositiveDefinition(overrides = {}) {
  return registry.createSignalDefinition({
    signalName: 'opportunity.false_positive.diagnostics',
    signalVersion: '1.0.0',
    producer: 'opportunityFalsePositiveDiagnostics',
    producerVersion: '1.0.0',
    producerCategory: 'offline_validation',
    signalType: 'risk',
    decisionRole: 'diagnostic_only',
    authorityLevel: 'shadow_observation',
    evidenceRole: 'diagnostic_context',
    expectedInputTypes: ['opportunityFalsePositiveDiagnosticOutput'],
    expectedOutputFields: [
      'falsePositiveRiskStatus',
      'falsePositiveRiskLevel',
      'dealGateOutcome',
      'buyNowEligibility',
      'criticalBlockers',
      'materialWarnings',
      'conflictingSignals'
    ],
    confidenceSemantics: {
      kind: 'derived',
      scale: '0_100',
      basis: 'false_positive_diagnostic_risk_level'
    },
    uncertaintySemantics: {
      sourceField: 'falsePositiveRiskStatus'
    },
    evidenceRequirements: {
      criticalBlockersTracked: true,
      contradictoryPositiveDecisionsPreserved: true,
      diagnosticOnly: true
    },
    allowedStatuses: ['low_risk', 'review', 'elevated_risk', 'high_risk', 'likely_false_positive', 'unavailable'],
    downstreamConsumers: ['signalAlignmentReport', 'signalAlignmentValidationSuite'],
    governanceRequirements: { authorityBoundary: 'shadow_observation_only' },
    compatibilityNotes: ['wrapper-only migration preserves native False-Positive Diagnostics output'],
    createdAt: '2026-07-28T23:00:00.000Z',
    ...overrides
  });
}

function signalRegistry(definitions = [falsePositiveDefinition()]) {
  return registry.createSignalRegistry({
    registryId: 'phase-14-false-positive-registry',
    registryVersion: '1.0.0',
    createdAt: '2026-07-28T23:00:00.000Z',
    definitions
  });
}

function nativeFalsePositiveOutput(overrides = {}) {
  return {
    source: 'opportunity_false_positive_diagnostics',
    schemaVersion: '1.0.0',
    productionImpact: 'none',
    decisionImpact: 'none',
    falsePositiveRiskStatus: 'elevated_risk',
    falsePositiveRiskLevel: 'high',
    dealGateOutcome: {
      available: true,
      passed: true,
      decision: 'BUY_NOW',
      recommendation: 'BUY_NOW',
      buyNowAllowed: true,
      reasons: [],
      positives: ['deal_gate_passed'],
      failedRules: []
    },
    buyNowEligibility: {
      eligible: true,
      source: 'deal_gate',
      changesProductionBehavior: false
    },
    criticalBlockers: ['identity_ambiguity_high'],
    materialWarnings: [
      'positive_deal_gate_or_buy_now_with_material_diagnostic_warnings',
      'valuation_uncertainty_high'
    ],
    supportingFactors: ['roi_good'],
    conflictingSignals: ['positive_deal_gate_or_buy_now_with_critical_diagnostic_blockers'],
    weakEvidenceIndicators: ['evidence_readiness_thin'],
    identityRiskIndicators: ['identity_ambiguity_high'],
    valuationRiskIndicators: ['valuation_uncertainty_high'],
    confidenceRiskIndicators: ['confidence_under_review'],
    listingQualityAndGradingRiskIndicators: ['grading_ambiguous'],
    roiFragilityIndicators: ['roi_above_150_percent_requires_strong_support'],
    suspiciousPriceIndicators: ['acquisition_price_below_20_percent_of_estimate'],
    roiSummary: {
      available: true,
      roiTier: 'good',
      roiPercent: 180,
      riskAdjustedProfit: 42,
      marginOfSafetyPercent: 12
    },
    riskSummary: {
      riskLevel: 'medium'
    },
    productionEstimateAndAcquisitionPriceContext: {
      acquisitionPrice: 25,
      productionEstimate: 150,
      acquisitionToEstimateRatio: 0.167,
      suspiciouslyLowPrice: true
    },
    missingDiagnostics: [],
    recommendedReviewAction: 'review_conflicting_signals_before_reliance',
    productionAuthorityStatement: 'Diagnostic only. Deal Gate remains the authoritative production BUY_NOW boundary.',
    stableFingerprint: 'false-positive-native-fingerprint',
    ...overrides
  };
}

function migrate(overrides = {}) {
  return migration.migrateFalsePositiveSignal({
    migrationId: overrides.migrationId || 'false-positive-migration',
    createdAt: overrides.createdAt || '2026-07-28T23:01:00.000Z',
    nativeOutput: overrides.nativeOutput || nativeFalsePositiveOutput(),
    registry: overrides.registry || signalRegistry()
  });
}

function compare(overrides = {}) {
  return comparison.compareFalsePositiveNativeToShadow({
    comparisonId: overrides.comparisonId || 'false-positive-shadow-comparison',
    createdAt: overrides.createdAt || '2026-07-28T23:02:00.000Z',
    migration: overrides.migration || migrate(overrides)
  });
}

test('exports False-Positive onboarding public APIs and constants', () => {
  assert.equal(migration.FALSE_POSITIVE_MIGRATION_SOURCE, 'false_positive_signal_migration');
  assert.equal(migration.FALSE_POSITIVE_SIGNAL_NAME, 'opportunity.false_positive.diagnostics');
  assert.equal(typeof migration.createFalsePositiveAdapter, 'function');
  assert.equal(typeof migration.migrateFalsePositiveSignal, 'function');
  assert.equal(typeof migration.validateFalsePositiveMigration, 'function');
  assert.equal(typeof migration.summarizeFalsePositiveMigration, 'function');
  assert.equal(typeof migration.buildFalsePositiveMigrationFingerprint, 'function');
  assert.equal(comparison.FALSE_POSITIVE_SHADOW_COMPARISON_SOURCE, 'false_positive_shadow_comparison');
  assert.equal(typeof comparison.compareFalsePositiveNativeToShadow, 'function');
  assert.equal(typeof comparison.validateFalsePositiveShadowComparison, 'function');
});

test('migration uses shared Signal Migration Core and declarative adapter contract', () => {
  const result = migrate();
  const validation = migration.validateFalsePositiveMigration(result);

  assert.equal(Object.isFrozen(result), true);
  assert.equal(validation.valid, true);
  assert.equal(result.registryResolutionStatus, 'matched');
  assert.equal(result.alignment.alignmentStatus, 'aligned');
  assert.equal(result.alignmentBatch.alignmentCount, 1);
  assert.equal(result.alignmentRun.adaptedSignalCount, 1);
  assert.equal(result.alignmentReport.alignments.length, 1);
  assert.equal(result.adapter.signalName, 'opportunity.false_positive.diagnostics');
  assert.equal(result.coreArtifact.lifecycleStatus, 'validated');
  assert.equal(core.validateSignalMigrationLifecycle(result, { adapter: result.adapter, coreArtifact: result.coreArtifact }).valid, true);
});

test('migration preserves native False-Positive output exactly and does not mutate input', () => {
  const native = nativeFalsePositiveOutput();
  const before = JSON.parse(JSON.stringify(native));
  const result = migrate({ nativeOutput: native });

  assert.deepEqual(native, before);
  assert.deepEqual(result.nativeOutput, before);
  assert.deepEqual(result.canonicalSignal.rawOutput, before);
  assert.deepEqual(result.adaptedSignal.nativeOutput, before);
  assert.equal(result.parityStatus, 'preserved');
  assert.equal(result.validation.parityStatus, 'preserved');
  assert.equal(signalContract.validateCanonicalSignal(result.canonicalSignal).valid, true);
});

test('positive Deal Gate and BUY_NOW results remain diagnostic context rather than production authority', () => {
  const result = migrate();

  assert.equal(result.canonicalSignal.normalizedOutput.dealGatePassed, true);
  assert.equal(result.canonicalSignal.normalizedOutput.buyNowEligible, true);
  assert.equal(result.canonicalSignal.evidenceBasis.details.criticalBlockerCount, 1);
  assert.equal(result.canonicalSignal.productionImpact, 'none');
  assert.equal(result.canonicalSignal.decisionImpact, 'none');
  assert.equal(result.canonicalSignal.executionAuthority, 'none');
  assert.equal(result.canonicalSignal.decisionRole, 'diagnostic_only');
});

test('missing registry definition remains explicit without production authority', () => {
  const result = migrate({ registry: signalRegistry([]) });
  const validation = migration.validateFalsePositiveMigration(result);

  assert.equal(result.registryResolutionStatus, 'definition_missing');
  assert.equal(result.alignment.alignmentStatus, 'definition_missing');
  assert.equal(result.alignment.signalDefinition, 'unknown');
  assert.equal(validation.valid, true);
  assert.deepEqual(validation.authorityViolations, []);
  assert.equal(result.productionImpact, 'none');
  assert.equal(result.decisionImpact, 'none');
  assert.equal(result.executionAuthority, 'none');
});

test('deterministic migration fingerprints and ordering are stable', () => {
  const input = {
    migrationId: 'deterministic-false-positive-migration',
    createdAt: '2026-07-28T23:03:00.000Z',
    nativeOutput: nativeFalsePositiveOutput(),
    registry: signalRegistry()
  };
  const first = migration.migrateFalsePositiveSignal(input);
  const second = migration.migrateFalsePositiveSignal(input);

  assert.deepEqual(first, second);
  assert.equal(first.migrationFingerprint, migration.buildFalsePositiveMigrationFingerprint(first));
});

test('shadow comparison uses shared Signal Shadow Comparison Core with supplied migration', () => {
  const migrated = migrate();
  const result = compare({ migration: migrated });
  const validation = comparison.validateFalsePositiveShadowComparison(result);

  assert.equal(Object.isFrozen(result), true);
  assert.equal(validation.valid, true);
  assert.equal(result.parityStatus, 'semantic_match');
  assert.equal(result.mismatchCount, 0);
  assert.equal(result.sourceArtifacts.migration.migrationFingerprint, migrated.migrationFingerprint);
  assert.equal(comparisonCore.validateSignalShadowComparisonLifecycle(result).valid, true);
});

test('shadow comparison detects changed wrapper data without repairing artifacts', () => {
  const migrated = migrate();
  const tampered = {
    ...migrated,
    canonicalSignal: {
      ...migrated.canonicalSignal,
      rawOutput: {
        ...migrated.canonicalSignal.rawOutput,
        falsePositiveRiskStatus: 'low_risk'
      },
      normalizedOutput: {
        ...migrated.canonicalSignal.normalizedOutput,
        status: 'low_risk'
      }
    }
  };
  const result = compare({ migration: tampered });

  assert.equal(result.mismatchCount > 0, true);
  assert.equal(result.mismatches.some((item) => item.code === 'changed_native_field'), true);
  assert.equal(migrated.canonicalSignal.rawOutput.falsePositiveRiskStatus, 'elevated_risk');
});

test('explicit unknown values remain explicit in migration and comparison', () => {
  const native = nativeFalsePositiveOutput({
    buyNowEligibility: {
      eligible: 'unknown',
      source: 'deal_gate',
      changesProductionBehavior: false
    }
  });
  const result = migrate({ nativeOutput: native });
  const compared = compare({ migration: result });

  assert.equal(result.canonicalSignal.normalizedOutput.buyNowEligible, 'unknown');
  assert.equal(compared.unknownValueComparison.status, 'exact_match');
  assert.equal(compared.validation.valid, true);
});

test('onboarding modules do not import production runtime or native diagnostic engine', () => {
  const loaded = new Set();
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    loaded.add(request);
    return originalLoad.apply(this, arguments);
  };
  try {
    delete require.cache[require.resolve('../validation/falsePositiveSignalMigration')];
    delete require.cache[require.resolve('../validation/falsePositiveShadowComparison')];
    require('../validation/falsePositiveSignalMigration');
    require('../validation/falsePositiveShadowComparison');
  } finally {
    Module._load = originalLoad;
  }

  assert.equal([...loaded].some((item) => item.includes('server.js')), false);
  assert.equal([...loaded].some((item) => item.includes('scoutScannerService')), false);
  assert.equal([...loaded].some((item) => item.includes('opportunityFalsePositiveDiagnostics')), false);
  assert.equal([...loaded].some((item) => item.includes('roiEngine')), false);
  assert.equal([...loaded].some((item) => item.includes('riskEngine')), false);
});
