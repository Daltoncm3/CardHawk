'use strict';

const {
  trimArrayToMax,
  toPositiveInteger
} = require('../utils/boundedRetention');
const {
  compactRetainedListing,
  estimateListingFootprint,
  validateCompactListing
} = require('../utils/listingCompaction');
const {
  createPersistenceCoordinator
} = require('../utils/persistenceCoordinator');
const {
  ARCHIVE_ELIGIBILITY,
  CANONICAL_LISTING_STORE_MODEL,
  evaluateListingResidency,
  validateListingStoreModel
} = require('./listingStoreArchitecture');
const {
  CANONICAL_MEMORY_CONTRACTS,
  evaluateMemoryContractCompliance
} = require('./productionMemoryContracts');
const {
  buildFingerprintFromProjection
} = require('./fingerprintProjection');

const PRODUCTION_MEMORY_STRESS_VALIDATION_SOURCE = 'production_memory_stress_validation';
const PRODUCTION_MEMORY_STRESS_VALIDATION_SCHEMA_VERSION = '1.0.0';

const STRESS_PROFILES = Object.freeze({
  SMALL_PRODUCTION_WORKLOAD: Object.freeze({
    profileId: 'small_production_workload',
    profileName: 'Small Production Workload',
    scanCycles: 3,
    listingsPerScan: 5,
    retainedListingLimit: 20,
    maxTrackedPredictions: 12,
    maxTrackedDecisions: 12,
    maxTrackedLearningRecords: 12
  }),
  MEDIUM_PRODUCTION_WORKLOAD: Object.freeze({
    profileId: 'medium_production_workload',
    profileName: 'Medium Production Workload',
    scanCycles: 8,
    listingsPerScan: 15,
    retainedListingLimit: 60,
    maxTrackedPredictions: 40,
    maxTrackedDecisions: 40,
    maxTrackedLearningRecords: 40
  }),
  LARGE_PRODUCTION_WORKLOAD: Object.freeze({
    profileId: 'large_production_workload',
    profileName: 'Large Production Workload',
    scanCycles: 12,
    listingsPerScan: 30,
    retainedListingLimit: 120,
    maxTrackedPredictions: 90,
    maxTrackedDecisions: 90,
    maxTrackedLearningRecords: 90
  }),
  LONG_RUNNING_REPEATED_SCAN_WORKLOAD: Object.freeze({
    profileId: 'long_running_repeated_scan_workload',
    profileName: 'Long-Running Repeated Scan Workload',
    scanCycles: 40,
    listingsPerScan: 12,
    retainedListingLimit: 75,
    maxTrackedPredictions: 50,
    maxTrackedDecisions: 50,
    maxTrackedLearningRecords: 50
  })
});

function clone(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function average(values = []) {
  const numbers = values.map(Number).filter(Number.isFinite);
  if (!numbers.length) return 0;
  return Number((numbers.reduce((sum, value) => sum + value, 0) / numbers.length).toFixed(2));
}

function normalizeProfile(profile = STRESS_PROFILES.SMALL_PRODUCTION_WORKLOAD) {
  const fallback = STRESS_PROFILES.SMALL_PRODUCTION_WORKLOAD;
  return {
    profileId: String(profile.profileId || fallback.profileId),
    profileName: String(profile.profileName || profile.profileId || fallback.profileName),
    scanCycles: toPositiveInteger(profile.scanCycles, fallback.scanCycles),
    listingsPerScan: toPositiveInteger(profile.listingsPerScan, fallback.listingsPerScan),
    retainedListingLimit: toPositiveInteger(profile.retainedListingLimit, fallback.retainedListingLimit),
    maxTrackedPredictions: toPositiveInteger(profile.maxTrackedPredictions, fallback.maxTrackedPredictions),
    maxTrackedDecisions: toPositiveInteger(profile.maxTrackedDecisions, fallback.maxTrackedDecisions),
    maxTrackedLearningRecords: toPositiveInteger(profile.maxTrackedLearningRecords, fallback.maxTrackedLearningRecords)
  };
}

function stableTimestamp(cycle, index = 0) {
  const seconds = cycle * 100 + index;
  return new Date(Date.UTC(2026, 6, 17, 0, 0, seconds)).toISOString();
}

function lifecycleStateFor(cycle, index) {
  const state = (cycle + index) % 5;
  if (state === 0) return 'active';
  if (state === 1) return 'observed';
  if (state === 2) return 'stale';
  if (state === 3) return 'disappeared';
  return 'observed';
}

function buildSyntheticListing(profile, cycle, index) {
  const id = `${profile.profileId}-${String(cycle).padStart(3, '0')}-${String(index).padStart(3, '0')}`;
  const observedAt = stableTimestamp(cycle, index);
  const lifecycleState = lifecycleStateFor(cycle, index);
  const basePrice = 20 + ((cycle * 7 + index * 3) % 120);

  return {
    listingId: id,
    marketplace: 'ebay',
    marketplaceListingId: id,
    marketplaceLabel: 'eBay',
    ebayItemId: id,
    title: `2026 Memory Stress Player ${index} #${cycle} PSA 10`,
    price: basePrice,
    shipping: 5,
    totalCost: basePrice + 5,
    currency: 'USD',
    condition: 'PSA 10',
    url: `https://example.test/${id}`,
    image: `https://example.test/${id}.jpg`,
    sellerUsername: `seller-${index % 7}`,
    sellerFeedbackPercentage: 99.5,
    sellerFeedbackScore: 1000 + index,
    buyingOptions: ['FIXED_PRICE'],
    itemEndDate: stableTimestamp(cycle + 1, index),
    parsed: {
      player: `Memory Stress Player ${index}`,
      year: 2026,
      set: 'Stress Set',
      cardNumber: String(cycle),
      gradingCompany: 'PSA',
      grade: '10'
    },
    lifecycleState,
    firstSeenAt: stableTimestamp(Math.max(0, cycle - 1), index),
    lastSeenAt: observedAt,
    seenCount: cycle + 1,
    score: 75 + (index % 20),
    estimatedValue: basePrice + 40,
    estimatedProfit: 35,
    roi: 0.3,
    marketConfidence: 70,
    compCount: 3,
    alertCreated: false,
    raw: {
      itemId: id,
      title: `Raw ${id}`,
      itemWebUrl: `https://example.test/raw/${id}`,
      price: { value: String(basePrice), currency: 'USD' },
      image: { imageUrl: `https://example.test/raw/${id}.jpg` },
      seller: {
        username: `seller-${index % 7}`,
        feedbackPercentage: '99.5',
        feedbackScore: 1000 + index
      },
      buyingOptions: ['FIXED_PRICE'],
      payload: 'x'.repeat(1500)
    },
    request: {
      query: 'memory stress validation',
      headers: { authorization: 'Bearer test-only' }
    },
    response: {
      status: 200,
      body: { itemSummaries: [{ itemId: id }] }
    },
    retryState: {
      attempts: index % 3
    }
  };
}

function pruneRetainedListings(retainedListings, limit) {
  const entries = Object.entries(retainedListings);
  if (entries.length <= limit) return retainedListings;

  entries.sort((a, b) => {
    const aTime = new Date(a[1].lastSeenAt || a[1].firstSeenAt || 0).getTime();
    const bTime = new Date(b[1].lastSeenAt || b[1].firstSeenAt || 0).getTime();
    if (aTime !== bTime) return aTime - bTime;
    return String(a[0]).localeCompare(String(b[0]));
  });

  return Object.fromEntries(entries.slice(entries.length - limit));
}

function buildStressValidationFingerprint(report = {}) {
  const projection = clone(report);
  delete projection.stableFingerprint;
  return buildFingerprintFromProjection(projection);
}

function buildStressValidationReport(input = {}) {
  const profile = normalizeProfile(input.profile);
  const listingStoreModel = input.listingStoreModel || CANONICAL_LISTING_STORE_MODEL;
  const memoryContracts = input.memoryContracts || CANONICAL_MEMORY_CONTRACTS;
  const flushes = [];
  const coordinator = createPersistenceCoordinator({
    idPrefix: `${profile.profileId}-batch`,
    now: (() => {
      let tick = 0;
      return () => stableTimestamp(0, tick++);
    })(),
    persist: (metadata) => {
      flushes.push(clone(metadata));
      return {
        ok: true,
        flushIndex: flushes.length
      };
    }
  });

  let retainedListings = {};
  let predictions = [];
  let decisions = [];
  let learningRecords = [];
  const compactSerializedBytes = [];
  let compactionCount = 0;
  let dirtyUpdateCount = 0;
  let invalidCompactListingCount = 0;
  let transientFieldLeakCount = 0;
  let maximumRetainedListingCount = 0;
  let maximumPredictionCount = 0;
  let maximumDecisionCount = 0;
  let maximumLearningRecordCount = 0;

  for (let cycle = 0; cycle < profile.scanCycles; cycle += 1) {
    coordinator.beginPersistenceBatch(`scan_cycle_${cycle}_started`);

    for (let index = 0; index < profile.listingsPerScan; index += 1) {
      const listing = buildSyntheticListing(profile, cycle, index);
      const compact = compactRetainedListing(listing);
      const validation = validateCompactListing(compact);
      const footprint = estimateListingFootprint(listing);

      compactionCount += 1;
      compactSerializedBytes.push(footprint.compactSerializedBytes);
      if (!validation.valid) invalidCompactListingCount += 1;
      if (validation.transientFieldsPresent.length) transientFieldLeakCount += 1;

      retainedListings[compact.ebayItemId] = compact;
      retainedListings = pruneRetainedListings(retainedListings, profile.retainedListingLimit);

      const event = {
        id: compact.ebayItemId,
        createdAt: stableTimestamp(cycle, index),
        listingId: compact.ebayItemId
      };
      predictions = trimArrayToMax([...predictions, event], profile.maxTrackedPredictions);
      decisions = trimArrayToMax([...decisions, event], profile.maxTrackedDecisions);
      learningRecords = trimArrayToMax([...learningRecords, event], profile.maxTrackedLearningRecords);

      coordinator.markStateDirty('retained_listing_compacted');
      dirtyUpdateCount += 1;
    }

    coordinator.markStateDirty('scan_cycle_completed');
    dirtyUpdateCount += 1;
    coordinator.flushPersistenceBatch(`scan_cycle_${cycle}_finished`);

    maximumRetainedListingCount = Math.max(maximumRetainedListingCount, Object.keys(retainedListings).length);
    maximumPredictionCount = Math.max(maximumPredictionCount, predictions.length);
    maximumDecisionCount = Math.max(maximumDecisionCount, decisions.length);
    maximumLearningRecordCount = Math.max(maximumLearningRecordCount, learningRecords.length);
  }

  const retainedList = Object.values(retainedListings);
  const residencyEvaluations = retainedList.map((listing) => evaluateListingResidency(listing, listingStoreModel));
  const residencyEvaluationsAgain = retainedList.map((listing) => evaluateListingResidency(listing, listingStoreModel));
  const lifecycleCounts = {};
  const archiveEligibilityCounts = {};

  for (const evaluation of residencyEvaluations) {
    lifecycleCounts[evaluation.lifecycleState] = (lifecycleCounts[evaluation.lifecycleState] || 0) + 1;
    archiveEligibilityCounts[evaluation.archiveEligibility] = (archiveEligibilityCounts[evaluation.archiveEligibility] || 0) + 1;
  }

  const listingStoreValidation = validateListingStoreModel(listingStoreModel);
  const memoryContractCompliance = evaluateMemoryContractCompliance(memoryContracts);
  const persistenceDiagnostics = coordinator.getPersistenceDiagnostics();
  const violations = [];

  if (maximumRetainedListingCount > profile.retainedListingLimit) violations.push('retained_listing_limit_exceeded');
  if (maximumPredictionCount > profile.maxTrackedPredictions) violations.push('prediction_retention_limit_exceeded');
  if (maximumDecisionCount > profile.maxTrackedDecisions) violations.push('decision_retention_limit_exceeded');
  if (maximumLearningRecordCount > profile.maxTrackedLearningRecords) violations.push('learning_retention_limit_exceeded');
  if (invalidCompactListingCount > 0) violations.push('invalid_compact_listing_detected');
  if (transientFieldLeakCount > 0) violations.push('transient_listing_field_leak_detected');
  if (flushes.length !== profile.scanCycles) violations.push('unexpected_persistence_flush_count');
  if (persistenceDiagnostics.active) violations.push('persistence_batch_left_active');
  if (persistenceDiagnostics.dirty) violations.push('persistence_left_dirty_after_flush');
  if (Object.values(lifecycleCounts).reduce((sum, count) => sum + count, 0) !== retainedList.length) {
    violations.push('listing_lifecycle_count_mismatch');
  }
  if (JSON.stringify(residencyEvaluations) !== JSON.stringify(residencyEvaluationsAgain)) {
    violations.push('archive_eligibility_not_deterministic');
  }
  if (!listingStoreValidation.valid) violations.push('listing_store_architecture_invalid');
  if (asArray(memoryContractCompliance.invalidContracts).length > 0) violations.push('memory_contract_validation_failed');

  const report = {
    source: PRODUCTION_MEMORY_STRESS_VALIDATION_SOURCE,
    schemaVersion: PRODUCTION_MEMORY_STRESS_VALIDATION_SCHEMA_VERSION,
    profile,
    status: violations.length ? 'failed' : 'passed',
    pass: violations.length === 0,
    violations,
    metrics: {
      retainedListingCount: retainedList.length,
      maximumRetainedListingCount,
      predictionCount: predictions.length,
      maximumPredictionCount,
      decisionCount: decisions.length,
      maximumDecisionCount,
      learningRecordCount: learningRecords.length,
      maximumLearningRecordCount,
      persistenceFlushCount: flushes.length,
      dirtyUpdateCount,
      compactionCount,
      invalidCompactListingCount,
      transientFieldLeakCount,
      archiveEligibilityCount: residencyEvaluations.filter((evaluation) => evaluation.archiveEligible).length,
      archiveRequiredCount: residencyEvaluations.filter((evaluation) => evaluation.archiveEligibility === ARCHIVE_ELIGIBILITY.REQUIRED).length,
      averageRetainedListingSerializedBytes: average(compactSerializedBytes)
    },
    limits: {
      retainedListingLimit: profile.retainedListingLimit,
      maxTrackedPredictions: profile.maxTrackedPredictions,
      maxTrackedDecisions: profile.maxTrackedDecisions,
      maxTrackedLearningRecords: profile.maxTrackedLearningRecords,
      expectedPersistenceFlushCount: profile.scanCycles
    },
    lifecycleCounts,
    archiveEligibilityCounts,
    persistenceDiagnostics,
    listingStoreValidation,
    memoryContractSummary: {
      totalContracts: memoryContractCompliance.totalContracts,
      invalidContractCount: asArray(memoryContractCompliance.invalidContracts).length,
      byStatus: memoryContractCompliance.byStatus,
      boundedRequiredCount: asArray(memoryContractCompliance.boundedRequired).length,
      violationCount: asArray(memoryContractCompliance.violations).length
    },
    productionAuthority: 'offline_validation_only_no_runtime_authority',
    stableFingerprint: ''
  };

  report.stableFingerprint = buildStressValidationFingerprint(report);
  return Object.freeze(report);
}

function runProductionMemoryStressValidation(options = {}) {
  const profiles = asArray(options.profiles).length
    ? asArray(options.profiles)
    : Object.values(STRESS_PROFILES);

  const reports = profiles.map((profile) => buildStressValidationReport({
    profile,
    listingStoreModel: options.listingStoreModel,
    memoryContracts: options.memoryContracts
  }));
  const summary = summarizeStressValidation(reports);

  return Object.freeze({
    source: PRODUCTION_MEMORY_STRESS_VALIDATION_SOURCE,
    schemaVersion: PRODUCTION_MEMORY_STRESS_VALIDATION_SCHEMA_VERSION,
    status: summary.failedProfiles.length ? 'failed' : 'passed',
    pass: summary.failedProfiles.length === 0,
    reports,
    summary,
    stableFingerprint: buildFingerprintFromProjection({
      source: PRODUCTION_MEMORY_STRESS_VALIDATION_SOURCE,
      schemaVersion: PRODUCTION_MEMORY_STRESS_VALIDATION_SCHEMA_VERSION,
      reports
    })
  });
}

function summarizeStressValidation(reports = []) {
  const list = asArray(reports);
  const failedProfiles = list.filter((report) => report.pass !== true).map((report) => report.profile.profileId).sort();

  return Object.freeze({
    source: PRODUCTION_MEMORY_STRESS_VALIDATION_SOURCE,
    schemaVersion: PRODUCTION_MEMORY_STRESS_VALIDATION_SCHEMA_VERSION,
    totalProfiles: list.length,
    passedProfiles: list.length - failedProfiles.length,
    failedProfiles,
    totalScanCycles: list.reduce((sum, report) => sum + report.profile.scanCycles, 0),
    totalSyntheticListingsProcessed: list.reduce((sum, report) => sum + report.metrics.compactionCount, 0),
    totalPersistenceFlushes: list.reduce((sum, report) => sum + report.metrics.persistenceFlushCount, 0),
    totalDirtyUpdates: list.reduce((sum, report) => sum + report.metrics.dirtyUpdateCount, 0),
    maximumRetainedListingCount: Math.max(0, ...list.map((report) => report.metrics.maximumRetainedListingCount)),
    maximumPredictionCount: Math.max(0, ...list.map((report) => report.metrics.maximumPredictionCount)),
    maximumDecisionCount: Math.max(0, ...list.map((report) => report.metrics.maximumDecisionCount)),
    maximumLearningRecordCount: Math.max(0, ...list.map((report) => report.metrics.maximumLearningRecordCount)),
    averageRetainedListingSerializedBytes: average(list.map((report) => report.metrics.averageRetainedListingSerializedBytes)),
    stableFingerprint: buildFingerprintFromProjection({
      source: PRODUCTION_MEMORY_STRESS_VALIDATION_SOURCE,
      schemaVersion: PRODUCTION_MEMORY_STRESS_VALIDATION_SCHEMA_VERSION,
      reports: list.map((report) => ({
        profileId: report.profile.profileId,
        status: report.status,
        metrics: report.metrics,
        violations: report.violations
      }))
    })
  });
}

function compareStressProfiles(reports = []) {
  const list = asArray(reports).slice().sort((a, b) => a.profile.profileId.localeCompare(b.profile.profileId));

  return Object.freeze({
    source: PRODUCTION_MEMORY_STRESS_VALIDATION_SOURCE,
    schemaVersion: PRODUCTION_MEMORY_STRESS_VALIDATION_SCHEMA_VERSION,
    profileCount: list.length,
    profiles: list.map((report) => ({
      profileId: report.profile.profileId,
      status: report.status,
      scanCycles: report.profile.scanCycles,
      listingsPerScan: report.profile.listingsPerScan,
      retainedListingCount: report.metrics.retainedListingCount,
      maximumRetainedListingCount: report.metrics.maximumRetainedListingCount,
      persistenceFlushCount: report.metrics.persistenceFlushCount,
      dirtyUpdateCount: report.metrics.dirtyUpdateCount,
      averageRetainedListingSerializedBytes: report.metrics.averageRetainedListingSerializedBytes
    })),
    stableFingerprint: buildFingerprintFromProjection({
      source: PRODUCTION_MEMORY_STRESS_VALIDATION_SOURCE,
      schemaVersion: PRODUCTION_MEMORY_STRESS_VALIDATION_SCHEMA_VERSION,
      profiles: list.map((report) => ({
        profileId: report.profile.profileId,
        metrics: report.metrics,
        status: report.status
      }))
    })
  });
}

module.exports = {
  PRODUCTION_MEMORY_STRESS_VALIDATION_SCHEMA_VERSION,
  PRODUCTION_MEMORY_STRESS_VALIDATION_SOURCE,
  STRESS_PROFILES,
  buildStressValidationFingerprint,
  buildStressValidationReport,
  compareStressProfiles,
  runProductionMemoryStressValidation,
  summarizeStressValidation
};
