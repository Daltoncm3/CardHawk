'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
  asArray,
  asObject,
  missingFields,
  unique
} = require('./canonicalValidationCore');
const {
  buildFingerprintFromProjection
} = require('./fingerprintProjection');
const {
  clone,
  firstDefined
} = require('./phase8GovernanceCore');
const reviewContract = require('./realListingDecisionReviewContract');
const reviewBatchBuilder = require('./realListingReviewBatchBuilder');
const daltonReviewWorkspace = require('./daltonReviewWorkspace');

const CALIBRATION_DATASET_SCHEMA_VERSION = '1.0.0';
const CALIBRATION_DATASET_SOURCE = 'calibration_dataset_builder';

const REQUIRED_DATASET_FIELDS = Object.freeze([
  'schemaVersion',
  'datasetId',
  'createdAt',
  'source',
  'sourceWorkspaces',
  'sourceBatchIds',
  'reviewCount',
  'listingCount',
  'categoryBreakdown',
  'confidenceBreakdown',
  'agreementMetrics',
  'disagreementMetrics',
  'calibrationCandidates',
  'records',
  'productionImpact',
  'decisionImpact',
  'datasetFingerprint'
]);

const REQUIRED_RECORD_FIELDS = Object.freeze([
  'recordId',
  'sourceWorkspaceId',
  'sourceBatchId',
  'packageId',
  'listingId',
  'marketplace',
  'packageFingerprint',
  'snapshotFingerprint',
  'reviewFingerprint',
  'listingIdentity',
  'productionOutputs',
  'shadowOutputs',
  'daltonReview',
  'disagreementSummary',
  'reviewMetadata',
  'productionImpact',
  'decisionImpact',
  'recordFingerprint'
]);

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}

function known(value) {
  return value !== undefined && value !== null && value !== '';
}

function normalizeDate(value, fallback = 'not_provided') {
  if (!known(value)) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function countBy(values = []) {
  return asArray(values).reduce((summary, value) => {
    const key = known(value) ? String(value) : 'unknown';
    summary[key] = (summary[key] || 0) + 1;
    return summary;
  }, {});
}

function findDuplicates(values = []) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of asArray(values)) {
    if (!known(value)) continue;
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].sort();
}

function numberBucket(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 'unknown';
  if (number < 40) return '0_39';
  if (number < 60) return '40_59';
  if (number < 75) return '60_74';
  if (number < 90) return '75_89';
  return '90_100';
}

function stableSortRecords(records = []) {
  return asArray(records).slice().sort((a, b) => (
    String(a.sourceWorkspaceId || '').localeCompare(String(b.sourceWorkspaceId || '')) ||
    String(a.sourceBatchId || '').localeCompare(String(b.sourceBatchId || '')) ||
    String(a.listingId || '').localeCompare(String(b.listingId || '')) ||
    String(a.packageId || '').localeCompare(String(b.packageId || '')) ||
    String(a.reviewFingerprint || '').localeCompare(String(b.reviewFingerprint || '')) ||
    String(a.recordFingerprint || '').localeCompare(String(b.recordFingerprint || ''))
  ));
}

function buildRecordFingerprint(record = {}) {
  const projection = clone(record);
  delete projection.recordFingerprint;
  return buildFingerprintFromProjection(projection);
}

function buildCalibrationDatasetFingerprint(dataset = {}) {
  const projection = clone(dataset);
  delete projection.datasetFingerprint;
  return buildFingerprintFromProjection(projection);
}

function buildSourceDescriptor(input = {}, options = {}) {
  const workspace = asObject(input.workspace);
  const batch = asObject(input.batch || input.originalBatch);
  return {
    workspaceId: firstDefined(input.workspaceId, workspace.workspaceId, options.workspaceId, 'unknown_workspace'),
    batchId: firstDefined(input.batchId, workspace.batchId, batch.batchId, options.batchId, 'unknown_batch'),
    workspaceFingerprint: firstDefined(input.workspaceFingerprint, workspace.workspaceFingerprint, options.workspaceFingerprint, null),
    batchFingerprint: firstDefined(input.batchFingerprint, workspace.batchFingerprint, batch.batchFingerprint, options.batchFingerprint, null),
    sourceType: firstDefined(input.sourceType, options.sourceType, 'dalton_review_workspace')
  };
}

function unwrapReviewRecord(reviewEntry = {}) {
  const entry = asObject(reviewEntry);
  return entry.reviewRecord || entry;
}

function getPackageReviews(reviews = []) {
  const byPackageId = new Map();
  for (const review of asArray(reviews)) {
    const packageId = review?.packageId;
    const reviewRecord = unwrapReviewRecord(review);
    if (packageId && reviewRecord) byPackageId.set(packageId, reviewRecord);
  }
  return byPackageId;
}

function normalizeWorkspaceInput(input, options = {}) {
  if (typeof input === 'string') {
    const loaded = daltonReviewWorkspace.loadDaltonReviewWorkspace(input);
    return {
      ...loaded,
      sourceType: 'dalton_review_workspace_folder',
      workspaceDir: input
    };
  }

  const object = asObject(input);
  if (object.source === daltonReviewWorkspace.COMPLETED_REVIEWED_BATCH_SOURCE || Array.isArray(object.reviewedPackages)) {
    return {
      workspace: {
        workspaceId: object.workspaceId,
        batchId: object.batchId,
        workspaceFingerprint: object.workspaceFingerprint || null,
        batchFingerprint: object.originalBatch?.batchFingerprint || null
      },
      batch: object.originalBatch || {},
      packages: asArray(object.reviewedPackages),
      reviews: asArray(object.reviewedPackages).map((reviewPackage) => ({
        packageId: reviewPackage.packageId,
        reviewRecord: reviewPackage.reviewRecord
      })).filter((entry) => entry.reviewRecord),
      sourceType: 'completed_reviewed_batch'
    };
  }

  return {
    workspace: asObject(object.workspace || object),
    batch: asObject(object.batch || object.originalBatch || {}),
    packages: asArray(object.packages || object.reviewedPackages || object.batch?.packages),
    reviews: asArray(object.reviews),
    sourceType: options.sourceType || 'dalton_review_workspace_payload'
  };
}

function buildCalibrationRecord(reviewPackage = {}, reviewRecord = {}, source = {}) {
  const reviewValidation = reviewContract.validateHumanReviewRecord(reviewRecord);
  const packageValidation = reviewContract.validateRealListingDecisionReviewPackage(reviewPackage);
  if (!reviewValidation.valid || !packageValidation.valid) {
    const error = new Error('Cannot build calibration record from invalid review evidence.');
    error.validation = { reviewValidation, packageValidation };
    throw error;
  }

  const sourceDescriptor = buildSourceDescriptor(source);
  const recordCore = {
    recordId: `${sourceDescriptor.workspaceId}:${reviewPackage.packageId}:${reviewRecord.reviewFingerprint}`,
    sourceWorkspaceId: sourceDescriptor.workspaceId,
    sourceBatchId: sourceDescriptor.batchId,
    packageId: reviewPackage.packageId,
    listingId: reviewPackage.listingId,
    marketplace: reviewPackage.marketplace,
    packageFingerprint: reviewPackage.packageFingerprint,
    snapshotFingerprint: reviewPackage.snapshotFingerprint,
    reviewFingerprint: reviewRecord.reviewFingerprint,
    listingIdentity: {
      listingId: reviewPackage.listingId,
      marketplace: reviewPackage.marketplace,
      listingSnapshot: clone(reviewPackage.listingSnapshot),
      identitySnapshot: clone(reviewPackage.identitySnapshot)
    },
    productionOutputs: clone(reviewPackage.productionSnapshot),
    shadowOutputs: clone(reviewPackage.shadowSnapshot),
    daltonReview: clone(reviewRecord),
    disagreementSummary: clone(reviewPackage.disagreementSnapshot),
    reviewMetadata: {
      reviewer: reviewRecord.reviewer,
      reviewedAt: reviewRecord.reviewedAt,
      reviewConfidence: reviewRecord.reviewConfidence,
      reasonCategories: clone(reviewRecord.reasonCategories),
      disagreementCategories: clone(reviewRecord.disagreementCategories),
      sourcePackageReviewStatus: reviewPackage.reviewStatus,
      sourcePackageFingerprint: reviewPackage.packageFingerprint,
      sourceSnapshotFingerprint: reviewPackage.snapshotFingerprint
    },
    productionImpact: 'none',
    decisionImpact: 'none'
  };

  return {
    ...recordCore,
    recordFingerprint: buildRecordFingerprint(recordCore)
  };
}

function collectRecordsFromWorkspace(input, options = {}) {
  const normalized = normalizeWorkspaceInput(input, options);
  const sourceDescriptor = buildSourceDescriptor(normalized, options);
  const reviewsByPackageId = getPackageReviews(normalized.reviews);
  const records = [];
  const missingReviewData = [];
  const invalidRecords = [];

  for (const reviewPackage of stableSortRecords(normalized.packages)) {
    const reviewRecord = reviewPackage.reviewRecord || reviewsByPackageId.get(reviewPackage.packageId);
    if (!reviewRecord) {
      missingReviewData.push(reviewPackage.packageId || 'unknown');
      continue;
    }
    try {
      const reviewedPackage = reviewPackage.reviewRecord
        ? reviewPackage
        : reviewContract.attachHumanReviewRecord(reviewPackage, reviewRecord);
      records.push(buildCalibrationRecord(reviewedPackage, reviewRecord, {
        ...normalized,
        ...sourceDescriptor
      }));
    } catch (error) {
      invalidRecords.push({
        packageId: reviewPackage.packageId || 'unknown',
        reason: error.message,
        validation: error.validation || null
      });
    }
  }

  return {
    sourceDescriptor,
    records,
    missingReviewData,
    invalidRecords
  };
}

function summarizeCalibrationRecords(records = []) {
  const sortedRecords = stableSortRecords(records);
  const reviewRecords = sortedRecords.map((record) => record.daltonReview || {});
  const productionCorrect = countBy(reviewRecords.map((review) => review.productionCorrect));
  const shadowBetter = countBy(reviewRecords.map((review) => review.shadowBetter));
  const wouldBuy = countBy(reviewRecords.map((review) => review.wouldBuy));
  const wouldNotify = countBy(reviewRecords.map((review) => review.wouldNotify));
  const buyNowQuality = countBy(reviewRecords.map((review) => review.buyNowQuality));
  const dealGateQuality = countBy(reviewRecords.map((review) => review.dealGateQuality));
  const reviewConfidenceBuckets = countBy(reviewRecords.map((review) => numberBucket(review.reviewConfidence)));
  const productionConfidenceBuckets = countBy(sortedRecords.map((record) => {
    const confidence = record.productionOutputs?.confidence;
    return numberBucket(confidence?.confidence ?? confidence?.score ?? confidence);
  }));
  const reasonCategories = {};
  const disagreementCategories = {};
  for (const review of reviewRecords) {
    for (const category of asArray(review.reasonCategories)) reasonCategories[category] = (reasonCategories[category] || 0) + 1;
    for (const category of asArray(review.disagreementCategories)) disagreementCategories[category] = (disagreementCategories[category] || 0) + 1;
  }

  return {
    categoryBreakdown: {
      reasonCategories,
      disagreementCategories
    },
    confidenceBreakdown: {
      reviewConfidence: reviewConfidenceBuckets,
      productionConfidence: productionConfidenceBuckets
    },
    agreementMetrics: {
      productionCorrect,
      shadowBetter,
      wouldBuy,
      wouldNotify,
      buyNowQuality,
      dealGateQuality
    },
    disagreementMetrics: {
      disagreementCategories,
      falsePositiveSignals: countBy(sortedRecords.flatMap((record) => asArray(record.disagreementSummary?.falsePositiveRiskSignals))),
      suggestedValidationFocus: countBy(sortedRecords.flatMap((record) => asArray(record.disagreementSummary?.suggestedValidationFocus)))
    },
    calibrationCandidates: sortedRecords.map((record) => ({
      recordId: record.recordId,
      packageId: record.packageId,
      listingId: record.listingId,
      reviewFingerprint: record.reviewFingerprint,
      snapshotFingerprint: record.snapshotFingerprint,
      reasonCategories: clone(record.daltonReview.reasonCategories),
      disagreementCategories: clone(record.daltonReview.disagreementCategories),
      reviewConfidence: record.daltonReview.reviewConfidence,
      productionCorrect: record.daltonReview.productionCorrect,
      shadowBetter: record.daltonReview.shadowBetter,
      candidateFocus: clone(asArray(record.disagreementSummary?.suggestedValidationFocus))
    }))
  };
}

function buildCalibrationDataset(workspaceInputs = [], options = {}) {
  const inputs = Array.isArray(workspaceInputs) ? workspaceInputs : [workspaceInputs];
  const sourceWorkspaces = [];
  const sourceBatchIds = [];
  const records = [];
  const missingReviewData = [];
  const invalidRecords = [];

  for (const input of inputs) {
    const collected = collectRecordsFromWorkspace(input, options);
    sourceWorkspaces.push(collected.sourceDescriptor);
    sourceBatchIds.push(collected.sourceDescriptor.batchId);
    records.push(...collected.records);
    missingReviewData.push(...collected.missingReviewData);
    invalidRecords.push(...collected.invalidRecords);
  }

  const sortedRecords = stableSortRecords(records);
  const summaries = summarizeCalibrationRecords(sortedRecords);
  const datasetCore = {
    schemaVersion: CALIBRATION_DATASET_SCHEMA_VERSION,
    datasetId: options.datasetId || 'calibration-dataset',
    createdAt: normalizeDate(options.createdAt || 'not_provided'),
    source: CALIBRATION_DATASET_SOURCE,
    sourceWorkspaces: sourceWorkspaces
      .map((source) => clone(source))
      .sort((a, b) => String(a.workspaceId).localeCompare(String(b.workspaceId)) || String(a.batchId).localeCompare(String(b.batchId))),
    sourceBatchIds: unique(sourceBatchIds).sort(),
    reviewCount: sortedRecords.length,
    listingCount: unique(sortedRecords.map((record) => record.listingId)).length,
    ...summaries,
    records: sortedRecords,
    validationMetadata: {
      missingReviewData: unique(missingReviewData),
      invalidRecords: clone(invalidRecords)
    },
    productionImpact: 'none',
    decisionImpact: 'none'
  };

  return deepFreeze({
    ...datasetCore,
    datasetFingerprint: buildCalibrationDatasetFingerprint(datasetCore)
  });
}

function buildValidationFailure(code, message, pathValue = '') {
  return { code, message, path: pathValue };
}

function validateCalibrationRecord(record = {}, index = 0) {
  const errors = [];
  for (const field of missingFields(record, REQUIRED_RECORD_FIELDS)) {
    errors.push(buildValidationFailure('missing_required_record_field', `${field} is required.`, `records.${index}.${field}`));
  }
  if (record.productionImpact !== 'none') {
    errors.push(buildValidationFailure('invalid_record_production_impact', 'Calibration records must not affect production.', `records.${index}.productionImpact`));
  }
  if (record.decisionImpact !== 'none') {
    errors.push(buildValidationFailure('invalid_record_decision_impact', 'Calibration records must not affect decisions.', `records.${index}.decisionImpact`));
  }
  if (record.daltonReview) {
    for (const failure of reviewContract.validateHumanReviewRecord(record.daltonReview).failures) {
      errors.push({ ...failure, path: `records.${index}.daltonReview.${failure.path}` });
    }
  }
  if (record.recordFingerprint && buildRecordFingerprint(record) !== record.recordFingerprint) {
    errors.push(buildValidationFailure('record_fingerprint_mismatch', 'recordFingerprint does not match calibration record.', `records.${index}.recordFingerprint`));
  }
  return errors;
}

function validateCalibrationDataset(dataset = {}) {
  const errors = [];
  const warnings = [];
  const records = asArray(dataset.records);
  const invalidRecords = [];
  const missingReviewData = [];

  for (const field of missingFields(dataset, REQUIRED_DATASET_FIELDS)) {
    errors.push(buildValidationFailure('missing_required_field', `${field} is required.`, field));
  }
  if (dataset.schemaVersion !== CALIBRATION_DATASET_SCHEMA_VERSION) {
    errors.push(buildValidationFailure('invalid_schema_version', 'schemaVersion must match Calibration Dataset schema.', 'schemaVersion'));
  }
  if (dataset.source !== CALIBRATION_DATASET_SOURCE) {
    errors.push(buildValidationFailure('invalid_source', 'source must be calibration_dataset_builder.', 'source'));
  }
  if (dataset.productionImpact !== 'none') {
    errors.push(buildValidationFailure('invalid_production_impact', 'productionImpact must remain none.', 'productionImpact'));
  }
  if (dataset.decisionImpact !== 'none') {
    errors.push(buildValidationFailure('invalid_decision_impact', 'decisionImpact must remain none.', 'decisionImpact'));
  }
  if (dataset.reviewCount !== records.length) {
    errors.push(buildValidationFailure('review_count_mismatch', 'reviewCount must match records length.', 'reviewCount'));
  }
  if (dataset.listingCount !== unique(records.map((record) => record.listingId)).length) {
    errors.push(buildValidationFailure('listing_count_mismatch', 'listingCount must match unique listing IDs.', 'listingCount'));
  }

  records.forEach((record, index) => {
    const recordErrors = validateCalibrationRecord(record, index);
    if (recordErrors.length) {
      invalidRecords.push({ index, recordId: record.recordId || 'unknown', errors: recordErrors });
      errors.push(...recordErrors);
    }
    if (!record.daltonReview) missingReviewData.push(record.packageId || record.recordId || `records.${index}`);
  });

  const duplicateListings = findDuplicates(records.map((record) => record.listingId));
  const duplicateReviews = findDuplicates(records.map((record) => record.reviewFingerprint));
  const duplicateFingerprints = findDuplicates(records.map((record) => record.recordFingerprint));
  if (duplicateListings.length) warnings.push(buildValidationFailure('duplicate_listings', 'Duplicate listing IDs detected.', 'records'));
  if (duplicateReviews.length) errors.push(buildValidationFailure('duplicate_reviews', 'Duplicate review fingerprints detected.', 'records'));
  if (duplicateFingerprints.length) errors.push(buildValidationFailure('duplicate_fingerprints', 'Duplicate record fingerprints detected.', 'records'));

  if (dataset.datasetFingerprint && buildCalibrationDatasetFingerprint(dataset) !== dataset.datasetFingerprint) {
    errors.push(buildValidationFailure('dataset_fingerprint_mismatch', 'datasetFingerprint does not match dataset contents.', 'datasetFingerprint'));
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    duplicateListings,
    duplicateReviews,
    duplicateFingerprints,
    invalidRecords,
    missingReviewData: unique([
      ...missingReviewData,
      ...asArray(dataset.validationMetadata?.missingReviewData)
    ])
  };
}

function mergeCalibrationDatasets(datasets = [], options = {}) {
  const inputs = asArray(datasets);
  const recordsByFingerprint = new Map();
  const sourceWorkspaces = [];
  const sourceBatchIds = [];

  for (const dataset of inputs) {
    for (const record of asArray(dataset.records)) {
      if (!recordsByFingerprint.has(record.recordFingerprint)) recordsByFingerprint.set(record.recordFingerprint, clone(record));
    }
    sourceWorkspaces.push(...asArray(dataset.sourceWorkspaces));
    sourceBatchIds.push(...asArray(dataset.sourceBatchIds));
  }

  const summaries = summarizeCalibrationRecords([...recordsByFingerprint.values()]);
  const datasetCore = {
    schemaVersion: CALIBRATION_DATASET_SCHEMA_VERSION,
    datasetId: options.datasetId || 'merged-calibration-dataset',
    createdAt: normalizeDate(options.createdAt || 'not_provided'),
    source: CALIBRATION_DATASET_SOURCE,
    sourceWorkspaces: unique(sourceWorkspaces.map((source) => JSON.stringify(source)))
      .map((source) => JSON.parse(source))
      .sort((a, b) => String(a.workspaceId).localeCompare(String(b.workspaceId)) || String(a.batchId).localeCompare(String(b.batchId))),
    sourceBatchIds: unique(sourceBatchIds).sort(),
    reviewCount: recordsByFingerprint.size,
    listingCount: unique([...recordsByFingerprint.values()].map((record) => record.listingId)).length,
    ...summaries,
    records: stableSortRecords([...recordsByFingerprint.values()]),
    validationMetadata: {
      mergedDatasetIds: inputs.map((dataset) => dataset.datasetId).filter(Boolean).sort()
    },
    productionImpact: 'none',
    decisionImpact: 'none'
  };

  return deepFreeze({
    ...datasetCore,
    datasetFingerprint: buildCalibrationDatasetFingerprint(datasetCore)
  });
}

function filterCalibrationDataset(dataset = {}, filters = {}, options = {}) {
  const records = stableSortRecords(dataset.records).filter((record) => {
    if (filters.listingId && record.listingId !== filters.listingId) return false;
    if (filters.marketplace && record.marketplace !== filters.marketplace) return false;
    if (filters.sourceBatchId && record.sourceBatchId !== filters.sourceBatchId) return false;
    if (filters.reasonCategory && !asArray(record.daltonReview?.reasonCategories).includes(filters.reasonCategory)) return false;
    if (filters.disagreementCategory && !asArray(record.daltonReview?.disagreementCategories).includes(filters.disagreementCategory)) return false;
    if (filters.productionCorrect && record.daltonReview?.productionCorrect !== filters.productionCorrect) return false;
    if (filters.shadowBetter && record.daltonReview?.shadowBetter !== filters.shadowBetter) return false;
    if (filters.wouldBuy && record.daltonReview?.wouldBuy !== filters.wouldBuy) return false;
    return true;
  });
  const summaries = summarizeCalibrationRecords(records);
  const datasetCore = {
    schemaVersion: CALIBRATION_DATASET_SCHEMA_VERSION,
    datasetId: options.datasetId || `${dataset.datasetId || 'calibration-dataset'}:filtered`,
    createdAt: normalizeDate(options.createdAt || dataset.createdAt || 'not_provided'),
    source: CALIBRATION_DATASET_SOURCE,
    sourceWorkspaces: clone(asArray(dataset.sourceWorkspaces)),
    sourceBatchIds: clone(asArray(dataset.sourceBatchIds)),
    reviewCount: records.length,
    listingCount: unique(records.map((record) => record.listingId)).length,
    ...summaries,
    records,
    validationMetadata: {
      filteredFromDatasetId: dataset.datasetId || null,
      filters: clone(filters)
    },
    productionImpact: 'none',
    decisionImpact: 'none'
  };
  return deepFreeze({
    ...datasetCore,
    datasetFingerprint: buildCalibrationDatasetFingerprint(datasetCore)
  });
}

function summarizeCalibrationDataset(dataset = {}) {
  return deepFreeze({
    datasetId: dataset.datasetId,
    reviewCount: dataset.reviewCount || 0,
    listingCount: dataset.listingCount || 0,
    sourceWorkspaceCount: asArray(dataset.sourceWorkspaces).length,
    sourceBatchCount: asArray(dataset.sourceBatchIds).length,
    categoryBreakdown: clone(dataset.categoryBreakdown || {}),
    confidenceBreakdown: clone(dataset.confidenceBreakdown || {}),
    agreementMetrics: clone(dataset.agreementMetrics || {}),
    disagreementMetrics: clone(dataset.disagreementMetrics || {}),
    calibrationCandidateCount: asArray(dataset.calibrationCandidates).length,
    productionImpact: dataset.productionImpact,
    decisionImpact: dataset.decisionImpact,
    datasetFingerprint: dataset.datasetFingerprint
  });
}

function exportCalibrationDataset(dataset = {}, outputPath) {
  const serialized = `${JSON.stringify(dataset, null, 2)}\n`;
  if (!outputPath) return serialized;
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, serialized);
  return dataset;
}

function importCalibrationDataset(input) {
  const parsed = typeof input === 'string'
    ? JSON.parse(fs.existsSync(input) ? fs.readFileSync(input, 'utf8') : input)
    : clone(input);
  return {
    dataset: parsed,
    validation: validateCalibrationDataset(parsed)
  };
}

module.exports = {
  CALIBRATION_DATASET_SCHEMA_VERSION,
  CALIBRATION_DATASET_SOURCE,
  REQUIRED_DATASET_FIELDS,
  REQUIRED_RECORD_FIELDS,
  buildCalibrationDataset,
  buildCalibrationDatasetFingerprint,
  exportCalibrationDataset,
  filterCalibrationDataset,
  importCalibrationDataset,
  mergeCalibrationDatasets,
  summarizeCalibrationDataset,
  validateCalibrationDataset
};
