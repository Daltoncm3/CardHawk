'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  STRESS_PROFILES,
  buildStressValidationReport,
  compareStressProfiles,
  runProductionMemoryStressValidation,
  summarizeStressValidation
} = require('../validation/productionMemoryStressValidation');
const {
  CANONICAL_LISTING_STORE_MODEL
} = require('../validation/listingStoreArchitecture');

test('small production workload validates bounded structural metrics', () => {
  const report = buildStressValidationReport({
    profile: STRESS_PROFILES.SMALL_PRODUCTION_WORKLOAD
  });

  assert.equal(report.pass, true);
  assert.equal(report.status, 'passed');
  assert.equal(report.metrics.retainedListingCount, 15);
  assert.equal(report.metrics.maximumRetainedListingCount, 15);
  assert.equal(report.metrics.predictionCount, 12);
  assert.equal(report.metrics.decisionCount, 12);
  assert.equal(report.metrics.learningRecordCount, 12);
  assert.equal(report.metrics.persistenceFlushCount, 3);
  assert.equal(report.metrics.dirtyUpdateCount, 18);
  assert.equal(report.metrics.compactionCount, 15);
  assert.equal(report.metrics.invalidCompactListingCount, 0);
  assert.equal(report.metrics.transientFieldLeakCount, 0);
  assert.equal(report.persistenceDiagnostics.active, false);
  assert.equal(report.persistenceDiagnostics.dirty, false);
  assert.equal(typeof report.stableFingerprint, 'string');
});

test('all canonical workload profiles pass deterministic stress validation', () => {
  const result = runProductionMemoryStressValidation();

  assert.equal(result.pass, true);
  assert.equal(result.status, 'passed');
  assert.equal(result.reports.length, 4);
  assert.deepEqual(result.summary.failedProfiles, []);

  for (const report of result.reports) {
    assert.equal(report.metrics.maximumRetainedListingCount <= report.limits.retainedListingLimit, true);
    assert.equal(report.metrics.maximumPredictionCount <= report.limits.maxTrackedPredictions, true);
    assert.equal(report.metrics.maximumDecisionCount <= report.limits.maxTrackedDecisions, true);
    assert.equal(report.metrics.maximumLearningRecordCount <= report.limits.maxTrackedLearningRecords, true);
    assert.equal(report.metrics.persistenceFlushCount, report.limits.expectedPersistenceFlushCount);
    assert.equal(report.metrics.averageRetainedListingSerializedBytes > 0, true);
  }
});

test('long-running workload remains bounded after repeated scan cycles', () => {
  const report = buildStressValidationReport({
    profile: STRESS_PROFILES.LONG_RUNNING_REPEATED_SCAN_WORKLOAD
  });

  assert.equal(report.pass, true);
  assert.equal(report.metrics.compactionCount, 480);
  assert.equal(report.metrics.maximumRetainedListingCount, 75);
  assert.equal(report.metrics.maximumPredictionCount, 50);
  assert.equal(report.metrics.maximumDecisionCount, 50);
  assert.equal(report.metrics.maximumLearningRecordCount, 50);
  assert.equal(report.metrics.persistenceFlushCount, 40);
  assert.equal(report.metrics.dirtyUpdateCount, 520);
  assert.equal(report.archiveEligibilityCounts.eligible > 0, true);
  assert.equal(report.archiveEligibilityCounts.required > 0, true);
});

test('tiny custom profile enforces retention limits under pressure', () => {
  const report = buildStressValidationReport({
    profile: {
      profileId: 'tiny_pressure_profile',
      profileName: 'Tiny Pressure Profile',
      scanCycles: 6,
      listingsPerScan: 6,
      retainedListingLimit: 5,
      maxTrackedPredictions: 4,
      maxTrackedDecisions: 3,
      maxTrackedLearningRecords: 2
    }
  });

  assert.equal(report.pass, true);
  assert.equal(report.metrics.retainedListingCount, 5);
  assert.equal(report.metrics.predictionCount, 4);
  assert.equal(report.metrics.decisionCount, 3);
  assert.equal(report.metrics.learningRecordCount, 2);
  assert.equal(report.metrics.persistenceFlushCount, 6);
  assert.equal(report.metrics.dirtyUpdateCount, 42);
});

test('reports are deterministic and preserve stable fingerprints', () => {
  const first = buildStressValidationReport({
    profile: STRESS_PROFILES.MEDIUM_PRODUCTION_WORKLOAD
  });
  const second = buildStressValidationReport({
    profile: STRESS_PROFILES.MEDIUM_PRODUCTION_WORKLOAD
  });

  assert.deepEqual(first, second);
  assert.equal(first.stableFingerprint, second.stableFingerprint);
});

test('summary and profile comparison are deterministic', () => {
  const reports = [
    buildStressValidationReport({ profile: STRESS_PROFILES.SMALL_PRODUCTION_WORKLOAD }),
    buildStressValidationReport({ profile: STRESS_PROFILES.MEDIUM_PRODUCTION_WORKLOAD })
  ];
  const summary = summarizeStressValidation(reports);
  const comparison = compareStressProfiles(reports);

  assert.equal(summary.totalProfiles, 2);
  assert.equal(summary.passedProfiles, 2);
  assert.deepEqual(summary.failedProfiles, []);
  assert.equal(summary.totalScanCycles, 11);
  assert.equal(summary.totalSyntheticListingsProcessed, 135);
  assert.equal(comparison.profileCount, 2);
  assert.deepEqual(
    comparison.profiles.map((profile) => profile.profileId),
    ['medium_production_workload', 'small_production_workload']
  );
  assert.equal(typeof summary.stableFingerprint, 'string');
  assert.equal(typeof comparison.stableFingerprint, 'string');
});

test('regression detection fails invalid listing-store architecture', () => {
  const invalidModel = {
    ...CANONICAL_LISTING_STORE_MODEL,
    source: 'invalid_source',
    stableFingerprint: 'stale'
  };
  const report = buildStressValidationReport({
    profile: STRESS_PROFILES.SMALL_PRODUCTION_WORKLOAD,
    listingStoreModel: invalidModel
  });

  assert.equal(report.pass, false);
  assert.equal(report.status, 'failed');
  assert.equal(report.violations.includes('listing_store_architecture_invalid'), true);
});

test('regression detection fails invalid memory contracts', () => {
  const report = buildStressValidationReport({
    profile: STRESS_PROFILES.SMALL_PRODUCTION_WORKLOAD,
    memoryContracts: [
      {
        componentId: 'broken_contract'
      }
    ]
  });

  assert.equal(report.pass, false);
  assert.equal(report.violations.includes('memory_contract_validation_failed'), true);
  assert.equal(report.memoryContractSummary.invalidContractCount, 1);
});
