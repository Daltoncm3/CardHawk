'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const migration = require('../validation/listingQualitySignalMigration');
const registry = require('../validation/intelligenceSignalRegistry');
const signalContract = require('../validation/canonicalIntelligenceSignalContract');
const alignmentContract = require('../validation/signalAlignmentContract');
const batch = require('../validation/signalAlignmentBatch');
const engine = require('../validation/signalAlignmentEngine');
const report = require('../validation/signalAlignmentReport');
const validationSuite = require('../validation/signalAlignmentValidationSuite');

function listingQualityDefinition(overrides = {}) {
  return registry.createSignalDefinition({
    signalName: 'listing.quality.grading.diagnostics',
    signalVersion: '1.0.0',
    producer: 'listingQualityGradingDiagnostics',
    producerVersion: '1.0.0',
    producerCategory: 'offline_validation',
    signalType: 'quality',
    decisionRole: 'diagnostic_only',
    authorityLevel: 'shadow_observation',
    evidenceRole: 'diagnostic_context',
    expectedInputTypes: ['listingQualityGradingDiagnosticOutput'],
    expectedOutputFields: [
      'listingQualityStatus',
      'gradingDiagnosticStatus',
      'riskLevel',
      'blockingIssues',
      'warnings',
      'confirmedAttributes',
      'ambiguousAttributes',
      'unsupportedAttributes'
    ],
    confidenceSemantics: {
      kind: 'not_reported',
      basis: 'listing_quality_grading_diagnostics_do_not_report_confidence'
    },
    uncertaintySemantics: {
      sourceField: 'riskLevel'
    },
    evidenceRequirements: {
      listingQualityEvidenceTracked: true,
      gradingSupportTracked: true,
      diagnosticOnly: true
    },
    allowedStatuses: ['strong', 'acceptable', 'caution', 'high_risk', 'blocked', 'unavailable'],
    downstreamConsumers: ['signalAlignmentReport', 'signalAlignmentValidationSuite'],
    governanceRequirements: { authorityBoundary: 'shadow_observation_only' },
    compatibilityNotes: ['wrapper-only migration preserves native Listing Quality diagnostics output'],
    createdAt: '2026-07-28T18:00:00.000Z',
    ...overrides
  });
}

function signalRegistry(definitions = [listingQualityDefinition()]) {
  return registry.createSignalRegistry({
    registryId: 'phase-13-listing-quality-registry',
    registryVersion: '1.0.0',
    createdAt: '2026-07-28T18:00:00.000Z',
    definitions
  });
}

function nativeListingQualityOutput(overrides = {}) {
  return {
    source: 'listing_quality_grading_diagnostics',
    schemaVersion: '1.0.0',
    productionImpact: 'none',
    decisionImpact: 'none',
    listingQualityStatus: 'strong',
    gradingDiagnosticStatus: 'confirmed',
    riskLevel: 'low',
    blockingIssues: [],
    warnings: [],
    confirmedAttributes: ['image_present', 'multiple_images_present', 'grading_company:psa', 'grade:10', 'seller_history_present'],
    ambiguousAttributes: [],
    unsupportedAttributes: [],
    listingQualitySummary: {
      title: '2020 Topps Chrome Lewis Hamilton PSA 10 Refractor',
      imageCount: 4,
      imageQuality: 'strong',
      titleSignals: {
        vagueTitleRisk: false,
        lotRisk: false,
        reprintProxyRisk: false,
        conditionAmbiguity: false,
        damageRisk: false,
        alteredRisk: false,
        slabRisk: false,
        rawTerm: false,
        gradedTerm: true
      },
      sellerContext: {
        sellerUsername: 'trusted-seller',
        feedbackPercentage: 99.8,
        feedbackScore: 1240,
        lowFeedbackRisk: false
      },
      priceContext: {
        listingPrice: 120,
        marketValue: 180,
        priceToMarketRatio: 0.667,
        suspiciouslyLowPrice: false
      },
      qualityEngineSummary: 'Quality score is strong.',
      riskEngineSummary: 'Risk level is low.'
    },
    gradingSupportSummary: {
      gradeProfile: {
        rawOrGraded: 'graded',
        gradingCompany: 'psa',
        grade: '10',
        gradedFlag: true,
        rawFlag: false,
        rawGradedConflict: false,
        slabCertificationAmbiguity: false,
        highRiskLanguage: false,
        titleGradeCompany: 'psa',
        titleGrade: '10'
      },
      gradePremiumScore: 82,
      premiumJustification: 'justified',
      premiumRiskLevel: 'low',
      soldSupport: {
        sameGradeCount: 6,
        lowerGradeCount: 3,
        higherGradeCount: 1,
        rawCount: 3,
        activeContextCount: 0
      },
      gradingEngineSummary: {
        grade: 'A',
        gradeScore: 92,
        concerns: []
      },
      identityToGradeConsistency: {
        diagnosticStatus: 'exact',
        ambiguityLevel: 'low',
        valuationEligible: true,
        exactCompEligible: true,
        parsedRawOrGraded: 'graded',
        stableFingerprint: 'identity-fingerprint'
      }
    },
    listingHistoryContext: {
      available: true,
      status: 'active',
      seenCount: 3,
      disappearedAt: 'unknown',
      likelySoldOrEnded: false,
      priceHistoryCount: 2,
      priceDropCount: 0,
      lastPriceDrop: null,
      historyHelperAvailable: true,
      priceChangeRisk: false
    },
    recommendedReviewAction: 'none',
    stableFingerprint: 'listing-quality-native-fingerprint',
    ...overrides
  };
}

function migrate(overrides = {}) {
  const reg = overrides.registry || signalRegistry();
  return migration.migrateListingQualitySignal({
    migrationId: overrides.migrationId || 'listing-quality-migration',
    createdAt: overrides.createdAt || '2026-07-28T18:01:00.000Z',
    nativeOutput: overrides.nativeOutput || nativeListingQualityOutput(),
    registry: reg
  });
}

test('exports Listing Quality Signal Migration public API and constants', () => {
  assert.equal(migration.LISTING_QUALITY_MIGRATION_SOURCE, 'listing_quality_signal_migration');
  assert.equal(migration.LISTING_QUALITY_MIGRATION_SCHEMA_VERSION, '1.0.0');
  assert.equal(migration.LISTING_QUALITY_SIGNAL_NAME, 'listing.quality.grading.diagnostics');
  assert.equal(migration.LISTING_QUALITY_PRODUCER, 'listingQualityGradingDiagnostics');
  assert.equal(typeof migration.migrateListingQualitySignal, 'function');
  assert.equal(typeof migration.validateListingQualityMigration, 'function');
  assert.equal(typeof migration.summarizeListingQualityMigration, 'function');
  assert.equal(typeof migration.buildListingQualityMigrationFingerprint, 'function');
});

test('successful migration wraps native Listing Quality diagnostics through the full alignment pipeline', () => {
  const result = migrate();
  const validation = migration.validateListingQualityMigration(result);

  assert.equal(Object.isFrozen(result), true);
  assert.equal(validation.valid, true);
  assert.equal(result.registryResolutionStatus, 'matched');
  assert.equal(result.alignment.alignmentStatus, 'aligned');
  assert.equal(result.alignmentBatch.alignmentCount, 1);
  assert.equal(result.alignmentRun.adaptedSignalCount, 1);
  assert.equal(result.alignmentReport.alignments.length, 1);
  assert.equal(result.alignmentReport.reportValidation.valid, true);
  assert.equal(result.productionImpact, 'none');
  assert.equal(result.decisionImpact, 'none');
  assert.equal(result.executionAuthority, 'none');
});

test('registry resolution creates a matched definition-backed canonical signal', () => {
  const result = migrate();

  assert.equal(result.canonicalSignal.signalName, 'listing.quality.grading.diagnostics');
  assert.equal(result.canonicalSignal.producer.name, 'listingQualityGradingDiagnostics');
  assert.equal(result.canonicalSignal.signalType, 'quality');
  assert.equal(result.canonicalSignal.authorityLevel, 'shadow_observation');
  assert.equal(result.alignment.signalDefinition.definitionFingerprint, result.registry.definitions[0].definitionFingerprint);
  assert.equal(signalContract.validateCanonicalSignal(result.canonicalSignal).valid, true);
  assert.equal(alignmentContract.validateSignalAlignment(result.alignment).valid, true);
});

test('missing registry definition remains explicit without inventing signal authority', () => {
  const result = migrate({
    registry: signalRegistry([])
  });
  const validation = migration.validateListingQualityMigration(result);

  assert.equal(result.registryResolutionStatus, 'definition_missing');
  assert.equal(result.alignment.alignmentStatus, 'definition_missing');
  assert.equal(result.alignment.signalDefinition, 'unknown');
  assert.equal(result.alignmentRun.summary.registryLookupFailureCount, 1);
  assert.equal(validation.valid, true);
  assert.equal(validation.registryResolutionStatus, 'definition_missing');
  assert.deepEqual(validation.authorityViolations, []);
});

test('migration preserves native Listing Quality diagnostic output exactly and never mutates input', () => {
  const native = nativeListingQualityOutput();
  const before = JSON.parse(JSON.stringify(native));
  const result = migrate({ nativeOutput: native });

  assert.deepEqual(native, before);
  assert.deepEqual(result.nativeOutput, before);
  assert.deepEqual(result.canonicalSignal.rawOutput, before);
  assert.deepEqual(result.adaptedSignal.nativeOutput, before);
  assert.equal(result.parityStatus, 'preserved');
  assert.equal(result.validation.parityStatus, 'preserved');
});

test('deterministic fingerprints and ordering are stable for identical inputs', () => {
  const input = {
    migrationId: 'deterministic-listing-quality-migration',
    createdAt: '2026-07-28T18:02:00.000Z',
    nativeOutput: nativeListingQualityOutput(),
    registry: signalRegistry()
  };
  const first = migration.migrateListingQualitySignal(input);
  const second = migration.migrateListingQualitySignal(input);

  assert.deepEqual(first, second);
  assert.equal(first.migrationFingerprint, migration.buildListingQualityMigrationFingerprint(first));
  assert.equal(first.alignmentBatch.batchFingerprint, batch.buildAlignmentBatchFingerprint(first.alignmentBatch));
  assert.equal(first.alignmentRun.runFingerprint, engine.buildSignalAlignmentRunFingerprint(first.alignmentRun));
  assert.equal(first.alignmentReport.reportFingerprint, report.buildSignalAlignmentReportFingerprint(first.alignmentReport));
});

test('explicit unknown values are preserved in wrapper artifacts', () => {
  const result = migrate({
    nativeOutput: nativeListingQualityOutput({
      listingQualityStatus: undefined,
      gradingDiagnosticStatus: '',
      riskLevel: undefined,
      warnings: ['Listing quality status is unknown.']
    })
  });

  assert.equal(result.canonicalSignal.normalizedOutput.status, 'unknown');
  assert.equal(result.canonicalSignal.normalizedOutput.gradingStatus, 'unknown');
  assert.equal(result.canonicalSignal.uncertainty.level, 'unknown');
  assert.equal(result.canonicalSignal.evidenceQuality.level, 'unknown');
  assert.equal(result.validation.valid, true);
});

test('authority enforcement blocks unsafe registry definitions', () => {
  const result = migrate({
    registry: signalRegistry([listingQualityDefinition({
      governanceFlags: { productionAuthority: true }
    })])
  });
  const validation = migration.validateListingQualityMigration(result);

  assert.equal(result.alignment.alignmentStatus, 'blocked');
  assert.equal(validation.valid, false);
  assert.equal(validation.reasonCodes.includes('authority_boundary_violation'), true);
  assert.equal(validation.authorityViolations.some((field) => field.includes('productionAuthority')), true);
});

test('report generation remains compatible with Signal Alignment Report validation', () => {
  const result = migrate();
  const reportValidation = report.validateSignalAlignmentReport(result.alignmentReport);

  assert.equal(reportValidation.valid, true);
  assert.equal(result.alignmentReport.alignmentRunId, result.alignmentRun.alignmentRunId);
  assert.equal(result.alignmentReport.alignmentRunFingerprint, result.alignmentRun.runFingerprint);
  assert.equal(result.alignmentReport.relationships.length, 0);
});

test('migration output remains compatible with the Phase 13 validation-suite module boundary', () => {
  const result = migrate();
  const summary = validationSuite.summarizeValidationSuite({
    suiteId: 'empty-listing-quality-boundary-suite',
    scenarioResults: [],
    validation: { valid: true, reasonCodes: [], authorityViolations: [], fingerprintViolations: [] }
  });

  assert.equal(result.alignmentRun.source, 'signal_alignment_engine');
  assert.equal(result.alignmentReport.source, 'signal_alignment_report');
  assert.equal(summary.valid, true);
});

test('module does not import or execute Listing Quality diagnostics or production runtime', () => {
  const loaded = new Set();
  const originalLoad = Module._load;
  Module._load = function trackingLoad(request, parent, isMain) {
    loaded.add(request);
    return originalLoad.apply(this, arguments);
  };

  delete require.cache[require.resolve('../validation/listingQualitySignalMigration')];
  require('../validation/listingQualitySignalMigration');
  Module._load = originalLoad;

  assert.equal([...loaded].some((request) => request.includes('validation/listingQualityGradingDiagnostics')), false);
  assert.equal([...loaded].some((request) => request.includes('engines/qualityEngine')), false);
  assert.equal([...loaded].some((request) => request.includes('server')), false);
  assert.equal([...loaded].some((request) => request.includes('scoutScannerService')), false);
});
