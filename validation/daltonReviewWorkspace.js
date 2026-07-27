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

const DALTON_REVIEW_WORKSPACE_SCHEMA_VERSION = '1.0.0';
const DALTON_REVIEW_WORKSPACE_SOURCE = 'dalton_review_workspace';
const COMPLETED_REVIEWED_BATCH_SOURCE = 'dalton_review_workspace_completed_batch';

const WORKSPACE_FILES = Object.freeze({
  WORKSPACE: 'workspace.json',
  BATCH: 'batch.json',
  README: 'README.md',
  BATCH_SUMMARY: 'batch-summary.md',
  PROGRESS: 'progress.json',
  PACKAGES_DIR: 'packages',
  REVIEWS_DIR: 'reviews',
  SUMMARIES_DIR: 'summaries',
  COMPLETED_DIR: 'completed',
  REVIEWED_BATCH: 'completed/reviewed-batch.json'
});

const REQUIRED_WORKSPACE_FIELDS = Object.freeze([
  'schemaVersion',
  'workspaceId',
  'batchId',
  'createdAt',
  'updatedAt',
  'source',
  'packageCount',
  'reviewedCount',
  'pendingCount',
  'completionRate',
  'reviewStatusSummary',
  'candidateCategorySummary',
  'productionImpact',
  'decisionImpact',
  'batchFingerprint',
  'fileManifest',
  'packageReferences',
  'reviewReferences',
  'workspaceFingerprint'
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

function percent(count, total) {
  if (!total) return 0;
  return Number(((count / total) * 100).toFixed(1));
}

function safeFileName(value) {
  return String(value || 'unknown')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'unknown';
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJsonFile(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeTextFile(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value);
}

function getPackagePath(packageId) {
  return `${WORKSPACE_FILES.PACKAGES_DIR}/${safeFileName(packageId)}.json`;
}

function getReviewPath(packageId) {
  return `${WORKSPACE_FILES.REVIEWS_DIR}/${safeFileName(packageId)}.review.json`;
}

function getSummaryPath(packageId) {
  return `${WORKSPACE_FILES.SUMMARIES_DIR}/${safeFileName(packageId)}.md`;
}

function countBy(values = []) {
  return asArray(values).reduce((summary, value) => {
    const key = value || 'unknown';
    summary[key] = (summary[key] || 0) + 1;
    return summary;
  }, {});
}

function buildWorkspaceFingerprint(workspace = {}) {
  const projection = clone(workspace);
  delete projection.workspaceFingerprint;
  return buildFingerprintFromProjection(projection);
}

function buildProgressFingerprint(progress = {}) {
  const projection = clone(progress);
  delete projection.progressFingerprint;
  return buildFingerprintFromProjection(projection);
}

function buildCompletedBatchFingerprint(completedBatch = {}) {
  const projection = clone(completedBatch);
  delete projection.completedBatchFingerprint;
  return buildFingerprintFromProjection(projection);
}

function getCategories(reviewPackage = {}) {
  return asArray(reviewPackage.validationCandidate?.candidateCategories || reviewPackage.disagreementSnapshot?.suggestedValidationFocus)
    .filter((category) => reviewBatchBuilder.BATCH_CANDIDATE_CATEGORIES.includes(category));
}

function getPackageReferences(packages = []) {
  return asArray(packages).map((reviewPackage) => ({
    packageId: reviewPackage.packageId,
    listingId: reviewPackage.listingId,
    reviewStatus: reviewPackage.reviewStatus,
    packagePath: getPackagePath(reviewPackage.packageId),
    summaryPath: getSummaryPath(reviewPackage.packageId),
    packageFingerprint: reviewPackage.packageFingerprint,
    snapshotFingerprint: reviewPackage.snapshotFingerprint,
    candidateCategories: getCategories(reviewPackage)
  })).sort((a, b) => a.packageId.localeCompare(b.packageId));
}

function getReviewReferences(packages = []) {
  return asArray(packages).map((reviewPackage) => ({
    packageId: reviewPackage.packageId,
    reviewPath: getReviewPath(reviewPackage.packageId),
    status: 'pending',
    reviewFingerprint: null
  })).sort((a, b) => a.packageId.localeCompare(b.packageId));
}

function getFileManifest(packages = []) {
  return {
    workspace: WORKSPACE_FILES.WORKSPACE,
    batch: WORKSPACE_FILES.BATCH,
    readme: WORKSPACE_FILES.README,
    batchSummary: WORKSPACE_FILES.BATCH_SUMMARY,
    progress: WORKSPACE_FILES.PROGRESS,
    packages: getPackageReferences(packages).map((reference) => ({
      packageId: reference.packageId,
      path: reference.packagePath,
      packageFingerprint: reference.packageFingerprint,
      snapshotFingerprint: reference.snapshotFingerprint
    })),
    reviews: getReviewReferences(packages),
    summaries: getPackageReferences(packages).map((reference) => ({
      packageId: reference.packageId,
      path: reference.summaryPath
    })),
    completed: WORKSPACE_FILES.REVIEWED_BATCH
  };
}

function summarizeCandidateCategories(packages = []) {
  const summary = {};
  for (const reviewPackage of packages) {
    for (const category of getCategories(reviewPackage)) {
      summary[category] = (summary[category] || 0) + 1;
    }
  }
  return summary;
}

function createWorkspaceCore(reviewBatch = {}, options = {}) {
  const batchValidation = reviewBatchBuilder.validateRealListingReviewBatch(reviewBatch);
  if (!batchValidation.valid && options.allowInvalidBatch !== true) {
    const error = new Error('Cannot build Dalton Review Workspace from an invalid review batch.');
    error.validation = batchValidation;
    throw error;
  }

  const packages = reviewBatchBuilder.sortReviewPackages(reviewBatch.packages);
  const createdAt = normalizeDate(options.createdAt || reviewBatch.createdAt);
  const updatedAt = normalizeDate(options.updatedAt || createdAt);
  const reviewStatusSummary = countBy(packages.map((reviewPackage) => reviewPackage.reviewStatus));
  const reviewedCount = reviewStatusSummary.reviewed || 0;
  const pendingCount = packages.length - reviewedCount;
  const workspaceCore = {
    schemaVersion: DALTON_REVIEW_WORKSPACE_SCHEMA_VERSION,
    workspaceId: options.workspaceId || `${reviewBatch.batchId}:dalton-review-workspace`,
    batchId: reviewBatch.batchId,
    createdAt,
    updatedAt,
    source: DALTON_REVIEW_WORKSPACE_SOURCE,
    packageCount: packages.length,
    reviewedCount,
    pendingCount,
    completionRate: percent(reviewedCount, packages.length),
    reviewStatusSummary,
    candidateCategorySummary: clone(reviewBatch.candidateCategorySummary || summarizeCandidateCategories(packages)),
    productionImpact: 'none',
    decisionImpact: 'none',
    batchFingerprint: reviewBatch.batchFingerprint,
    fileManifest: getFileManifest(packages),
    packageReferences: getPackageReferences(packages),
    reviewReferences: getReviewReferences(packages)
  };

  return {
    ...workspaceCore,
    workspaceFingerprint: buildWorkspaceFingerprint(workspaceCore)
  };
}

function buildDaltonReviewWorkspace(reviewBatch = {}, options = {}) {
  return deepFreeze(createWorkspaceCore(reviewBatch, options));
}

function formatValue(value) {
  if (value === undefined || value === null || value === '') return 'unknown';
  if (Array.isArray(value)) return value.length ? value.join(', ') : 'none';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function generateReviewForm(reviewPackage = {}) {
  const listing = asObject(reviewPackage.listingSnapshot);
  const identity = asObject(reviewPackage.identitySnapshot);
  const production = asObject(reviewPackage.productionSnapshot);
  const shadow = asObject(reviewPackage.shadowSnapshot);
  const disagreement = asObject(reviewPackage.disagreementSnapshot);
  const dealGate = asObject(production.dealGateOutcome);
  const buyNow = asObject(production.buyNowEligibility);
  const notification = asObject(production.notificationEligibility);

  return [
    `# Review Form: ${formatValue(listing.title)}`,
    '',
    '## Listing',
    `- Package ID: ${reviewPackage.packageId}`,
    `- Marketplace: ${reviewPackage.marketplace}`,
    `- Item ID: ${formatValue(listing.marketplaceItemId)}`,
    `- URL: ${formatValue(listing.url)}`,
    `- Asking price: ${formatValue(listing.askingPrice)}`,
    `- Shipping: ${formatValue(listing.shipping)}`,
    `- Total cost: ${formatValue(listing.totalCost)}`,
    '',
    '## Identity',
    `- Parsed identity: ${formatValue(identity.legacyParsedIdentity)}`,
    `- Canonical identity: ${formatValue(identity.canonicalIdentitySummary)}`,
    `- Diagnostic status: ${formatValue(identity.diagnosticStatus)}`,
    `- Ambiguity: ${formatValue(identity.ambiguity)}`,
    `- Warnings: ${formatValue(identity.warnings)}`,
    `- Conflicts: ${formatValue(identity.fieldsConflicting)}`,
    '',
    '## Production',
    `- Estimated value: ${formatValue(production.estimatedValue)}`,
    `- ROI: ${formatValue(production.roi)}`,
    `- Estimated profit: ${formatValue(production.estimatedProfit)}`,
    `- Confidence: ${formatValue(production.confidence)}`,
    `- Deal Gate: ${formatValue(dealGate.decision || dealGate.recommendation || dealGate.passed)}`,
    `- BUY_NOW eligibility: ${formatValue(buyNow.eligible)}`,
    `- Notification eligibility: ${formatValue(notification.eligible)}`,
    '',
    '## Shadow',
    `- Shadow valuation: ${formatValue(shadow.shadowValuation)}`,
    `- Shadow confidence: ${formatValue(shadow.shadowConfidence)}`,
    `- Evidence readiness: ${formatValue(shadow.evidenceReadiness)}`,
    `- False-positive signals: ${formatValue(disagreement.falsePositiveRiskSignals)}`,
    `- Suggested validation focus: ${formatValue(disagreement.suggestedValidationFocus)}`,
    '',
    '## Dalton Review Fields',
    '- identityCorrect:',
    '- evidenceSufficient:',
    '- valuationReasonable:',
    '- confidenceAppropriate:',
    '- wouldBuy:',
    '- wouldNotify:',
    '- productionCorrect:',
    '- shadowBetter:',
    '- buyNowQuality:',
    '- dealGateQuality:',
    '- reasonCategories:',
    '- disagreementCategories:',
    '- reviewConfidence:',
    '- notes:',
    '- reviewer: Dalton',
    '- reviewedAt:',
    ''
  ].join('\n');
}

function generateMarkdownSummary(workspace = {}, reviewBatch = {}) {
  return [
    `# Dalton Review Workspace: ${workspace.workspaceId}`,
    '',
    `- Batch ID: ${workspace.batchId}`,
    `- Packages: ${workspace.packageCount}`,
    `- Reviewed: ${workspace.reviewedCount}`,
    `- Pending: ${workspace.pendingCount}`,
    `- Completion: ${workspace.completionRate}%`,
    `- Production impact: ${workspace.productionImpact}`,
    `- Decision impact: ${workspace.decisionImpact}`,
    '',
    '## Candidate Categories',
    ...Object.entries(workspace.candidateCategorySummary || {}).sort().map(([category, count]) => `- ${category}: ${count}`),
    '',
    '## Packages',
    ...asArray(reviewBatch.packages).map((reviewPackage) => `- ${reviewPackage.packageId}: ${reviewPackage.listingSnapshot?.title || 'unknown'}`),
    ''
  ].join('\n');
}

function generateWorkspaceReadme(workspace = {}) {
  return [
    '# Dalton Review Workspace',
    '',
    'This folder is an offline CardHawk review workspace.',
    '',
    'Open files in `summaries/` to review listings. Enter completed structured review JSON files in `reviews/` using the Phase 12.0B human review contract.',
    '',
    'Package snapshots in `packages/` are immutable evidence packages and must not be edited.',
    '',
    `Workspace ID: ${workspace.workspaceId}`,
    `Batch ID: ${workspace.batchId}`,
    `Production impact: ${workspace.productionImpact}`,
    `Decision impact: ${workspace.decisionImpact}`,
    ''
  ].join('\n');
}

function ensureWorkspaceDirs(workspaceDir) {
  for (const dir of [
    WORKSPACE_FILES.PACKAGES_DIR,
    WORKSPACE_FILES.REVIEWS_DIR,
    WORKSPACE_FILES.SUMMARIES_DIR,
    WORKSPACE_FILES.COMPLETED_DIR
  ]) {
    fs.mkdirSync(path.join(workspaceDir, dir), { recursive: true });
  }
}

function writeDaltonReviewWorkspace(reviewBatch = {}, workspaceDir, options = {}) {
  if (!workspaceDir) throw new Error('workspaceDir is required.');
  const workspace = buildDaltonReviewWorkspace(reviewBatch, options);
  ensureWorkspaceDirs(workspaceDir);
  writeJsonFile(path.join(workspaceDir, WORKSPACE_FILES.BATCH), reviewBatch);
  for (const reviewPackage of reviewBatchBuilder.sortReviewPackages(reviewBatch.packages)) {
    writeJsonFile(path.join(workspaceDir, getPackagePath(reviewPackage.packageId)), reviewPackage);
    writeTextFile(path.join(workspaceDir, getSummaryPath(reviewPackage.packageId)), generateReviewForm(reviewPackage));
  }
  writeTextFile(path.join(workspaceDir, WORKSPACE_FILES.README), generateWorkspaceReadme(workspace));
  writeTextFile(path.join(workspaceDir, WORKSPACE_FILES.BATCH_SUMMARY), generateMarkdownSummary(workspace, reviewBatch));
  writeJsonFile(path.join(workspaceDir, WORKSPACE_FILES.PROGRESS), buildReviewProgress(workspace, reviewBatch.packages, [], options));
  writeJsonFile(path.join(workspaceDir, WORKSPACE_FILES.WORKSPACE), workspace);
  return workspace;
}

function listFilesRecursive(rootDir) {
  if (!fs.existsSync(rootDir)) return [];
  const results = [];
  function visit(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      const relative = path.relative(rootDir, fullPath);
      if (entry.isDirectory()) visit(fullPath);
      else results.push(relative);
    }
  }
  visit(rootDir);
  return results.sort();
}

function readExistingJson(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;
  return readJsonFile(filePath);
}

function readPackageFiles(workspaceDir, workspace = {}) {
  const references = asArray(workspace.fileManifest?.packages || workspace.packageReferences);
  return references.map((reference) => ({
    reference,
    filePath: path.join(workspaceDir, reference.path || reference.packagePath),
    package: readExistingJson(path.join(workspaceDir, reference.path || reference.packagePath), null)
  }));
}

function readReviewFiles(workspaceDir, workspace = {}) {
  const references = asArray(workspace.fileManifest?.reviews || workspace.reviewReferences);
  const entries = references.map((reference) => ({
    reference,
    filePath: path.join(workspaceDir, reference.reviewPath || reference.path),
    review: readExistingJson(path.join(workspaceDir, reference.reviewPath || reference.path), null)
  })).filter((entry) => entry.review);
  const seen = new Set(entries.map((entry) => path.resolve(entry.filePath)));
  const reviewsDir = path.join(workspaceDir, WORKSPACE_FILES.REVIEWS_DIR);
  if (fs.existsSync(reviewsDir)) {
    for (const name of fs.readdirSync(reviewsDir).sort()) {
      if (!name.endsWith('.json')) continue;
      const filePath = path.join(reviewsDir, name);
      if (seen.has(path.resolve(filePath))) continue;
      entries.push({
        reference: { reviewPath: path.relative(workspaceDir, filePath) },
        filePath,
        review: readExistingJson(filePath, null)
      });
    }
  }
  return entries;
}

function getCompletionSummary(packages = [], reviewEntries = []) {
  const validReviews = [];
  const invalidReviews = [];
  const reviewedPackageIds = new Set();
  const reviewsByPackageId = new Map();

  for (const entry of reviewEntries) {
    const packageId = entry.review?.packageId;
    const reviewRecord = entry.review?.reviewRecord || entry.review;
    const validation = reviewContract.validateHumanReviewRecord(reviewRecord);
    if (!packageId || !validation.valid) {
      invalidReviews.push({ packageId: packageId || 'unknown', validation });
      continue;
    }
    reviewedPackageIds.add(packageId);
    reviewsByPackageId.set(packageId, reviewRecord);
    validReviews.push({ packageId, reviewRecord });
  }

  const pendingPackageIds = packages
    .map((reviewPackage) => reviewPackage.packageId)
    .filter((packageId) => !reviewedPackageIds.has(packageId));

  return {
    totalPackages: packages.length,
    reviewedPackages: validReviews.length,
    pendingPackages: pendingPackageIds.length,
    invalidReviews: invalidReviews.length,
    completionRate: percent(validReviews.length, packages.length),
    pendingPackageIds,
    reviewedPackageIds: [...reviewedPackageIds].sort(),
    reviewsByPackageId,
    validReviews,
    invalidReviews
  };
}

function buildReviewProgress(workspace = {}, packages = [], reviewEntries = [], options = {}) {
  const completion = getCompletionSummary(packages, reviewEntries);
  const lastReviewedPackageId = options.lastReviewedPackageId || completion.reviewedPackageIds[completion.reviewedPackageIds.length - 1] || null;
  const progressCore = {
    schemaVersion: DALTON_REVIEW_WORKSPACE_SCHEMA_VERSION,
    source: `${DALTON_REVIEW_WORKSPACE_SOURCE}:progress`,
    workspaceId: workspace.workspaceId,
    batchId: workspace.batchId,
    totalPackages: completion.totalPackages,
    reviewedPackages: completion.reviewedPackages,
    pendingPackages: completion.pendingPackages,
    invalidReviews: completion.invalidReviews.length,
    completionRate: completion.completionRate,
    lastReviewedPackageId,
    lastUpdatedAt: normalizeDate(options.updatedAt || workspace.updatedAt || workspace.createdAt),
    status: completion.pendingPackages === 0 && completion.invalidReviews.length === 0 ? 'complete' : 'in_progress',
    workspaceFingerprint: workspace.workspaceFingerprint
  };
  return {
    ...progressCore,
    progressFingerprint: buildProgressFingerprint(progressCore)
  };
}

function validateDaltonReviewWorkspace(workspaceDirOrWorkspace, options = {}) {
  const errors = [];
  const warnings = [];
  const reasonCodes = [];
  const missingFiles = [];
  const unexpectedFiles = [];
  const invalidPackageFiles = [];
  const invalidReviewFiles = [];
  const fingerprintMismatches = [];
  const workspaceDir = typeof workspaceDirOrWorkspace === 'string' ? workspaceDirOrWorkspace : options.workspaceDir;
  const workspace = typeof workspaceDirOrWorkspace === 'string'
    ? readExistingJson(path.join(workspaceDirOrWorkspace, WORKSPACE_FILES.WORKSPACE), {})
    : asObject(workspaceDirOrWorkspace);

  for (const field of missingFields(workspace, REQUIRED_WORKSPACE_FIELDS)) {
    errors.push({ code: 'missing_required_field', message: `${field} is required.`, path: field });
    reasonCodes.push(`missing_${field}`);
  }
  if (workspace.schemaVersion !== DALTON_REVIEW_WORKSPACE_SCHEMA_VERSION) {
    errors.push({ code: 'invalid_schema_version', message: 'schemaVersion must match Dalton Review Workspace schema.', path: 'schemaVersion' });
    reasonCodes.push('invalid_schema_version');
  }
  if (workspace.source !== DALTON_REVIEW_WORKSPACE_SOURCE) {
    errors.push({ code: 'invalid_source', message: 'source must be dalton_review_workspace.', path: 'source' });
    reasonCodes.push('invalid_source');
  }
  if (workspace.productionImpact !== 'none') {
    errors.push({ code: 'invalid_production_impact', message: 'productionImpact must remain none.', path: 'productionImpact' });
    reasonCodes.push('invalid_production_impact');
  }
  if (workspace.decisionImpact !== 'none') {
    errors.push({ code: 'invalid_decision_impact', message: 'decisionImpact must remain none.', path: 'decisionImpact' });
    reasonCodes.push('invalid_decision_impact');
  }
  if (workspace.workspaceFingerprint && buildWorkspaceFingerprint(workspace) !== workspace.workspaceFingerprint) {
    errors.push({ code: 'workspace_fingerprint_mismatch', message: 'workspaceFingerprint does not match workspace manifest.', path: 'workspaceFingerprint' });
    reasonCodes.push('workspace_fingerprint_mismatch');
  }

  let packageEntries = [];
  let reviewEntries = [];
  if (workspaceDir) {
    const manifestFiles = [
      workspace.fileManifest?.workspace,
      workspace.fileManifest?.batch,
      workspace.fileManifest?.readme,
      workspace.fileManifest?.batchSummary,
      workspace.fileManifest?.progress,
      ...asArray(workspace.fileManifest?.packages).map((file) => file.path),
      ...asArray(workspace.fileManifest?.summaries).map((file) => file.path)
    ].filter(Boolean);
    for (const relative of manifestFiles) {
      if (!fs.existsSync(path.join(workspaceDir, relative))) missingFiles.push(relative);
    }
    const expected = new Set([
      ...manifestFiles,
      ...asArray(workspace.fileManifest?.reviews).map((file) => file.reviewPath || file.path),
      WORKSPACE_FILES.REVIEWED_BATCH
    ].filter(Boolean));
    for (const relative of listFilesRecursive(workspaceDir)) {
      if (!expected.has(relative) && !relative.startsWith(`${WORKSPACE_FILES.REVIEWS_DIR}/`)) unexpectedFiles.push(relative);
    }

    packageEntries = readPackageFiles(workspaceDir, workspace);
    reviewEntries = readReviewFiles(workspaceDir, workspace);
    for (const entry of packageEntries) {
      if (!entry.package) continue;
      const validation = reviewContract.validateRealListingDecisionReviewPackage(entry.package);
      if (!validation.valid) invalidPackageFiles.push(entry.reference.path || entry.reference.packagePath);
      if (validation.failures.some((failure) => ['package_fingerprint_mismatch', 'snapshot_fingerprint_mismatch'].includes(failure.code))) {
        fingerprintMismatches.push(entry.reference.path || entry.reference.packagePath);
      }
      if (entry.reference.packageFingerprint && entry.package.packageFingerprint !== entry.reference.packageFingerprint) {
        fingerprintMismatches.push(entry.reference.path || entry.reference.packagePath);
      }
      if (entry.reference.snapshotFingerprint && entry.package.snapshotFingerprint !== entry.reference.snapshotFingerprint) {
        fingerprintMismatches.push(entry.reference.path || entry.reference.packagePath);
      }
      if (entry.package.reviewBatchId !== workspace.batchId) {
        errors.push({ code: 'mismatched_batch_id', message: 'Package reviewBatchId does not match workspace batchId.', path: entry.reference.path || entry.reference.packagePath });
        reasonCodes.push('mismatched_batch_id');
      }
    }
    for (const entry of reviewEntries) {
      const reviewRecord = entry.review?.reviewRecord || entry.review;
      const validation = reviewContract.validateHumanReviewRecord(reviewRecord);
      if (!validation.valid) invalidReviewFiles.push(path.relative(workspaceDir, entry.filePath));
      if (entry.review?.reviewFingerprint && entry.review.reviewFingerprint !== reviewRecord.reviewFingerprint) {
        fingerprintMismatches.push(path.relative(workspaceDir, entry.filePath));
      }
    }
  }

  const packages = packageEntries.map((entry) => entry.package).filter(Boolean);
  const duplicatePackageIds = findDuplicates(packages.map((reviewPackage) => reviewPackage.packageId));
  const duplicateReviewPackageIds = findDuplicates(reviewEntries.map((entry) => entry.review?.packageId).filter(Boolean));
  const completionSummary = getCompletionSummary(packages, reviewEntries);

  if (duplicatePackageIds.length) reasonCodes.push('duplicate_package_ids');
  if (duplicateReviewPackageIds.length) reasonCodes.push('duplicate_review_package_ids');
  if (missingFiles.length) reasonCodes.push('missing_files');
  if (unexpectedFiles.length) reasonCodes.push('unexpected_files');
  if (invalidPackageFiles.length) reasonCodes.push('invalid_package_files');
  if (invalidReviewFiles.length) reasonCodes.push('invalid_review_files');
  if (fingerprintMismatches.length) reasonCodes.push('fingerprint_mismatches');

  return {
    valid: errors.length === 0 && missingFiles.length === 0 && invalidPackageFiles.length === 0 && invalidReviewFiles.length === 0 && fingerprintMismatches.length === 0 && duplicatePackageIds.length === 0 && duplicateReviewPackageIds.length === 0,
    errors,
    warnings,
    reasonCodes: unique(reasonCodes),
    missingFiles: unique(missingFiles),
    unexpectedFiles: unique(unexpectedFiles),
    invalidPackageFiles: unique(invalidPackageFiles),
    invalidReviewFiles: unique(invalidReviewFiles),
    fingerprintMismatches: unique(fingerprintMismatches),
    duplicatePackageIds,
    duplicateReviewPackageIds,
    completionSummary: {
      totalPackages: completionSummary.totalPackages,
      reviewedPackages: completionSummary.reviewedPackages,
      pendingPackages: completionSummary.pendingPackages,
      invalidReviews: completionSummary.invalidReviews.length,
      completionRate: completionSummary.completionRate
    }
  };
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

function loadDaltonReviewWorkspace(workspaceDir) {
  const workspace = readExistingJson(path.join(workspaceDir, WORKSPACE_FILES.WORKSPACE), {});
  const batch = readExistingJson(path.join(workspaceDir, WORKSPACE_FILES.BATCH), {});
  const packageEntries = readPackageFiles(workspaceDir, workspace);
  const reviewEntries = readReviewFiles(workspaceDir, workspace);
  const packages = packageEntries.map((entry) => entry.package).filter(Boolean);
  const progress = fs.existsSync(path.join(workspaceDir, WORKSPACE_FILES.PROGRESS))
    ? readJsonFile(path.join(workspaceDir, WORKSPACE_FILES.PROGRESS))
    : buildReviewProgress(workspace, packages, reviewEntries);
  const validation = validateDaltonReviewWorkspace(workspaceDir);
  return {
    workspace,
    batch,
    packages,
    reviews: reviewEntries.map((entry) => entry.review),
    progress,
    validation
  };
}

function resumeDaltonReviewWorkspace(workspaceDir) {
  const loaded = loadDaltonReviewWorkspace(workspaceDir);
  const completion = getCompletionSummary(loaded.packages, readReviewFiles(workspaceDir, loaded.workspace));
  return {
    ...loaded,
    reviewedPackageIds: completion.reviewedPackageIds,
    pendingPackageIds: completion.pendingPackageIds,
    nextRecommendedPackageId: completion.pendingPackageIds[0] || null,
    status: completion.pendingPackages === 0 && completion.invalidReviews.length === 0 ? 'complete' : 'in_progress'
  };
}

function attachCompletedHumanReviewRecord(workspaceDir, packageId, reviewRecord = {}, options = {}) {
  const loaded = loadDaltonReviewWorkspace(workspaceDir);
  const reviewPackage = loaded.packages.find((pkg) => pkg.packageId === packageId);
  if (!reviewPackage) throw new Error(`Unknown packageId: ${packageId}`);
  const reviewPath = path.join(workspaceDir, getReviewPath(packageId));
  const existing = readExistingJson(reviewPath, null);
  if (existing && options.allowReplace !== true && existing.reviewRecord?.reviewFingerprint !== reviewRecord.reviewFingerprint) {
    const error = new Error(`Conflicting review record already exists for ${packageId}.`);
    error.code = 'conflicting_review_record';
    throw error;
  }
  const validation = reviewContract.validateHumanReviewRecord(reviewRecord);
  if (!validation.valid) {
    const error = new Error('Invalid human review record.');
    error.validation = validation;
    throw error;
  }
  const reviewedPackage = reviewContract.attachHumanReviewRecord(reviewPackage, reviewRecord);
  writeJsonFile(reviewPath, {
    schemaVersion: DALTON_REVIEW_WORKSPACE_SCHEMA_VERSION,
    source: `${DALTON_REVIEW_WORKSPACE_SOURCE}:review_record`,
    workspaceId: loaded.workspace.workspaceId,
    batchId: loaded.workspace.batchId,
    packageId,
    packageFingerprint: reviewPackage.packageFingerprint,
    snapshotFingerprint: reviewPackage.snapshotFingerprint,
    reviewRecord,
    reviewFingerprint: reviewRecord.reviewFingerprint,
    productionImpact: 'none',
    decisionImpact: 'none'
  });
  rebuildWorkspaceSummaries(workspaceDir, { updatedAt: options.updatedAt || reviewRecord.reviewedAt });
  return {
    reviewPath,
    reviewRecord,
    reviewedPackage
  };
}

function rebuildWorkspaceSummaries(workspaceDir, options = {}) {
  const workspace = readJsonFile(path.join(workspaceDir, WORKSPACE_FILES.WORKSPACE));
  const batch = readJsonFile(path.join(workspaceDir, WORKSPACE_FILES.BATCH));
  const packageEntries = readPackageFiles(workspaceDir, workspace);
  const reviewEntries = readReviewFiles(workspaceDir, workspace);
  const packages = packageEntries.map((entry) => entry.package).filter(Boolean);
  for (const reviewPackage of packages) {
    const summaryPath = path.join(workspaceDir, getSummaryPath(reviewPackage.packageId));
    if (options.force === true || !fs.existsSync(summaryPath)) {
      writeTextFile(summaryPath, generateReviewForm(reviewPackage));
    }
  }
  const progress = buildReviewProgress(workspace, packages, reviewEntries, options);
  writeJsonFile(path.join(workspaceDir, WORKSPACE_FILES.PROGRESS), progress);
  writeTextFile(path.join(workspaceDir, WORKSPACE_FILES.BATCH_SUMMARY), generateMarkdownSummary({
    ...workspace,
    reviewedCount: progress.reviewedPackages,
    pendingCount: progress.pendingPackages,
    completionRate: progress.completionRate
  }, batch));
  return {
    workspace,
    progress
  };
}

function exportCompletedReviewedBatch(workspaceDir, options = {}) {
  const loaded = loadDaltonReviewWorkspace(workspaceDir);
  const reviewEntries = readReviewFiles(workspaceDir, loaded.workspace);
  const completion = getCompletionSummary(loaded.packages, reviewEntries);
  const reviewedPackages = loaded.packages.map((reviewPackage) => {
    const reviewRecord = completion.reviewsByPackageId.get(reviewPackage.packageId);
    return reviewRecord ? reviewContract.attachHumanReviewRecord(reviewPackage, reviewRecord) : reviewPackage;
  });
  const complete = completion.pendingPackages === 0 && completion.invalidReviews.length === 0;
  const completedCore = {
    schemaVersion: DALTON_REVIEW_WORKSPACE_SCHEMA_VERSION,
    source: COMPLETED_REVIEWED_BATCH_SOURCE,
    workspaceId: loaded.workspace.workspaceId,
    batchId: loaded.workspace.batchId,
    completedAt: normalizeDate(options.completedAt || 'not_provided'),
    productionImpact: 'none',
    decisionImpact: 'none',
    aggregateReviewStatus: complete ? 'complete' : 'incomplete',
    completionSummary: {
      totalPackages: completion.totalPackages,
      reviewedPackages: completion.reviewedPackages,
      pendingPackages: completion.pendingPackages,
      invalidReviews: completion.invalidReviews.length,
      completionRate: completion.completionRate
    },
    originalBatch: loaded.batch,
    reviewedPackages
  };
  const completedBatch = {
    ...completedCore,
    completedBatchFingerprint: buildCompletedBatchFingerprint(completedCore)
  };
  if (complete || options.writeIncomplete === true) {
    writeJsonFile(path.join(workspaceDir, WORKSPACE_FILES.REVIEWED_BATCH), completedBatch);
  }
  return deepFreeze(completedBatch);
}

module.exports = {
  COMPLETED_REVIEWED_BATCH_SOURCE,
  DALTON_REVIEW_WORKSPACE_SCHEMA_VERSION,
  DALTON_REVIEW_WORKSPACE_SOURCE,
  REQUIRED_WORKSPACE_FIELDS,
  WORKSPACE_FILES,
  attachCompletedHumanReviewRecord,
  buildCompletedBatchFingerprint,
  buildDaltonReviewWorkspace,
  buildProgressFingerprint,
  buildReviewProgress,
  buildWorkspaceFingerprint,
  exportCompletedReviewedBatch,
  generateMarkdownSummary,
  generateReviewForm,
  loadDaltonReviewWorkspace,
  rebuildWorkspaceSummaries,
  resumeDaltonReviewWorkspace,
  validateDaltonReviewWorkspace,
  writeDaltonReviewWorkspace
};
