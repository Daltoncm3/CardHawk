'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
  buildCanonicalCardKey,
  normalizeSoldEvidenceRecord
} = require('../utils/soldEvidenceStore');

const DATASET_VERSION = 1;
const DEFAULT_TARGETS = {
  uniqueIdentities: 100,
  verifiedSoldRecords: 750,
  minimumSoldRecordsPerIdentity: 3
};
const DEFAULT_STALE_DAYS = 365;
const VERIFIED_REVIEW_STATUSES = new Set([
  'human_verified',
  'dealer_verified',
  'second_review_verified',
  'verified'
]);

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function round(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round(toNumber(value) * factor) / factor;
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s/.-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeKey(value, fallback = 'unknown') {
  return normalizeText(value) || fallback;
}

function normalizeEnum(value, fallback = 'unknown') {
  return normalizeText(value).replace(/\s+/g, '_') || fallback;
}

function normalizeDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function daysBetween(later, earlier) {
  const laterDate = new Date(later);
  const earlierDate = new Date(earlier);
  if (Number.isNaN(laterDate.getTime()) || Number.isNaN(earlierDate.getTime())) return null;
  return Math.floor((laterDate.getTime() - earlierDate.getTime()) / 86400000);
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJsonFile(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

function extractRecords(payload = {}) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  if (payload.records && !Array.isArray(payload.records)) return Object.values(payload.records);

  for (const key of ['records', 'soldRecords', 'soldEvidence', 'verifiedSoldRecords']) {
    if (Array.isArray(payload[key])) return payload[key];
  }

  return [];
}

function normalizeReview(record = {}) {
  const review = asObject(record.review);
  return {
    status: normalizeEnum(record.reviewStatus || review.status, 'unreviewed'),
    reviewer: record.reviewer || review.reviewer || review.reviewedBy || null,
    reviewedAt: normalizeDate(record.reviewedAt || review.reviewedAt),
    notes: record.reviewerNotes || review.notes || review.reviewerNotes || ''
  };
}

function normalizeProvenance(record = {}) {
  const source = asObject(record.source);
  const provenance = asObject(record.provenance);

  return {
    marketplace: normalizeKey(record.marketplace || source.marketplace, 'unknown'),
    adapter: source.adapter || provenance.adapter || null,
    retrievalMethod: source.retrievalMethod || provenance.retrievalMethod || null,
    sourceReliability: source.sourceReliability || provenance.sourceReliability || null,
    acquiredAt: normalizeDate(source.acquiredAt || provenance.acquiredAt),
    sourceUrl: record.url || provenance.sourceUrl || '',
    licenseType: provenance.licenseType || source.licenseType || null,
    allowedUses: asObject(provenance.allowedUses || source.allowedUses)
  };
}

function normalizeDatasetRecord(record = {}) {
  const normalized = normalizeSoldEvidenceRecord(record, {
    adapter: record.source?.adapter || 'dataset_builder',
    retrievalMethod: record.source?.retrievalMethod || 'dataset_governance',
    sourceReliability: record.source?.sourceReliability || 'unknown'
  });

  if (record.evidenceType) normalized.evidenceType = normalizeEnum(record.evidenceType);
  if (record.status) normalized.status = record.status;
  if (record.canonicalCardKey) normalized.canonicalCardKey = record.canonicalCardKey;
  normalized.review = normalizeReview(record);
  normalized.provenance = normalizeProvenance(normalized);
  normalized.datasetTags = Array.isArray(record.datasetTags) ? [...record.datasetTags] : [];

  return normalized;
}

function normalizeDatasetRecords(records = []) {
  return asArray(records).map(normalizeDatasetRecord);
}

function isTrueSoldCandidate(record = {}) {
  return record.evidenceType === 'true_sold'
    && record.status === 'active_evidence'
    && toNumber(record.soldPrice, 0) > 0
    && Boolean(normalizeDate(record.soldAt));
}

function isVerified(record = {}) {
  return VERIFIED_REVIEW_STATUSES.has(normalizeEnum(record.review?.status || record.reviewStatus, 'unreviewed'));
}

function getIdentity(record = {}) {
  return record.canonicalCardKey || buildCanonicalCardKey(record.parsedIdentity || {});
}

function countBy(records = [], selector) {
  return records.reduce((counts, record) => {
    const key = selector(record);
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function distribution(records = [], selector) {
  const counts = countBy(records, selector);
  const total = records.length || 0;
  return Object.fromEntries(Object.entries(counts).map(([key, count]) => [
    key,
    { count, share: total ? round(count / total, 4) : 0 }
  ]));
}

function average(values = []) {
  const numbers = values.map((value) => toNumber(value, NaN)).filter(Number.isFinite);
  if (!numbers.length) return null;
  return round(numbers.reduce((sum, value) => sum + value, 0) / numbers.length);
}

function median(values = []) {
  const numbers = values.map((value) => toNumber(value, NaN)).filter(Number.isFinite).sort((a, b) => a - b);
  if (!numbers.length) return null;
  const midpoint = Math.floor(numbers.length / 2);
  return numbers.length % 2 === 0 ? round((numbers[midpoint - 1] + numbers[midpoint]) / 2) : round(numbers[midpoint]);
}

function priceTier(record = {}) {
  const price = toNumber(record.totalPaid || record.soldPrice, 0);
  if (price >= 1000) return '1000_plus';
  if (price >= 250) return '250_to_999';
  if (price >= 100) return '100_to_249';
  if (price >= 25) return '25_to_99';
  return 'under_25';
}

function eraBucket(record = {}) {
  const year = toNumber(record.parsedIdentity?.year, 0);
  if (!year) return 'unknown';
  if (year < 1980) return 'pre_1980';
  if (year < 2000) return '1980_to_1999';
  if (year < 2018) return '2000_to_2017';
  return '2018_plus';
}

function freshnessBucket(record = {}, asOf, staleDays = DEFAULT_STALE_DAYS) {
  const ageDays = daysBetween(asOf, record.soldAt);
  if (ageDays === null) return 'unknown';
  if (ageDays <= 90) return 'fresh_0_to_90_days';
  if (ageDays <= staleDays) return 'usable_91_to_365_days';
  return 'stale_over_365_days';
}

function buildCoverageReport(records = [], options = {}) {
  const targets = { ...DEFAULT_TARGETS, ...asObject(options.targets) };
  const asOf = normalizeDate(options.asOf) || new Date().toISOString();
  const trueSoldRecords = records.filter(isTrueSoldCandidate);
  const verifiedSoldRecords = trueSoldRecords.filter(isVerified);
  const identityCounts = countBy(verifiedSoldRecords, getIdentity);
  const identityCountValues = Object.values(identityCounts);
  const identitiesBelowMinimum = Object.entries(identityCounts)
    .filter(([, count]) => count < targets.minimumSoldRecordsPerIdentity)
    .map(([canonicalCardKey, count]) => ({ canonicalCardKey, count }));

  return {
    targetProgress: {
      uniqueIdentities: {
        target: targets.uniqueIdentities,
        actual: Object.keys(identityCounts).length,
        percent: round((Object.keys(identityCounts).length / targets.uniqueIdentities) * 100)
      },
      verifiedSoldRecords: {
        target: targets.verifiedSoldRecords,
        actual: verifiedSoldRecords.length,
        percent: round((verifiedSoldRecords.length / targets.verifiedSoldRecords) * 100)
      },
      readyForCanonicalValuationShadow: Object.keys(identityCounts).length >= targets.uniqueIdentities
        && verifiedSoldRecords.length >= targets.verifiedSoldRecords
    },
    uniqueIdentityCount: Object.keys(identityCounts).length,
    trueSoldRecordCount: trueSoldRecords.length,
    verifiedSoldRecordCount: verifiedSoldRecords.length,
    totalRecordCount: records.length,
    recordsPerIdentity: {
      minimum: identityCountValues.length ? Math.min(...identityCountValues) : 0,
      maximum: identityCountValues.length ? Math.max(...identityCountValues) : 0,
      average: average(identityCountValues) || 0,
      identitiesBelowMinimum
    },
    marketplaceCoverage: distribution(verifiedSoldRecords, (record) => record.marketplace || 'unknown'),
    categoryCoverage: distribution(verifiedSoldRecords, (record) => record.parsedIdentity?.category || 'unknown'),
    sportCoverage: distribution(verifiedSoldRecords, (record) => record.parsedIdentity?.sport || record.parsedIdentity?.game || 'unknown'),
    eraCoverage: distribution(verifiedSoldRecords, eraBucket),
    priceTierCoverage: distribution(verifiedSoldRecords, priceTier),
    gradeCoverage: distribution(verifiedSoldRecords, (record) => `${record.gradeCompany || 'unknown'}:${record.grade || 'unknown'}`),
    conditionCoverage: distribution(verifiedSoldRecords, (record) => record.condition || 'unknown'),
    freshnessCoverage: distribution(verifiedSoldRecords, (record) => freshnessBucket(record, asOf, options.staleDays))
  };
}

function largestShare(distributionObject = {}) {
  return Object.entries(distributionObject)
    .map(([key, value]) => ({ key, count: value.count || 0, share: value.share || 0 }))
    .sort((a, b) => b.share - a.share)[0] || { key: null, count: 0, share: 0 };
}

function buildBiasReport(records = [], coverageReport = buildCoverageReport(records), options = {}) {
  const maxSourceShare = toNumber(options.maxSourceShare, 0.6);
  const maxCategoryShare = toNumber(options.maxCategoryShare, 0.7);
  const maxPriceTierShare = toNumber(options.maxPriceTierShare, 0.55);
  const thinIdentityShareLimit = toNumber(options.thinIdentityShareLimit, 0.35);
  const dominantMarketplace = largestShare(coverageReport.marketplaceCoverage);
  const dominantCategory = largestShare(coverageReport.categoryCoverage);
  const dominantPriceTier = largestShare(coverageReport.priceTierCoverage);
  const identityCount = coverageReport.uniqueIdentityCount || 0;
  const thinIdentityCount = coverageReport.recordsPerIdentity.identitiesBelowMinimum.length;
  const thinIdentityRate = identityCount ? round(thinIdentityCount / identityCount, 4) : 0;
  const warnings = [];

  if (dominantMarketplace.share > maxSourceShare) warnings.push('marketplace_concentration_high');
  if (dominantCategory.share > maxCategoryShare) warnings.push('category_concentration_high');
  if (dominantPriceTier.share > maxPriceTierShare) warnings.push('price_tier_concentration_high');
  if (thinIdentityRate > thinIdentityShareLimit) warnings.push('thin_identity_coverage_high');
  if (!coverageReport.targetProgress.readyForCanonicalValuationShadow) warnings.push('dataset_below_shadow_threshold');

  return {
    dominantMarketplace,
    dominantCategory,
    dominantPriceTier,
    thinIdentityRate,
    concentrationLimits: {
      maxSourceShare,
      maxCategoryShare,
      maxPriceTierShare,
      thinIdentityShareLimit
    },
    warnings,
    biasRiskLevel: warnings.length >= 3 ? 'high' : warnings.length ? 'medium' : 'low'
  };
}

function buildReviewStatusReport(records = []) {
  const counts = countBy(records, (record) => record.review?.status || 'unreviewed');
  const verifiedCount = records.filter(isVerified).length;
  const rejectedCount = Object.entries(counts)
    .filter(([status]) => status.startsWith('rejected'))
    .reduce((sum, [, count]) => sum + count, 0);

  return {
    counts,
    verifiedCount,
    rejectedCount,
    pendingReviewCount: records.length - verifiedCount - rejectedCount,
    reviewerNotes: records
      .filter((record) => record.review?.notes)
      .map((record) => ({
        id: record.id,
        canonicalCardKey: record.canonicalCardKey,
        reviewStatus: record.review.status,
        reviewer: record.review.reviewer,
        notes: record.review.notes
      }))
  };
}

function buildProvenanceValidation(records = []) {
  const invalidRecords = [];
  const missingFieldCounts = {};

  for (const record of records) {
    const missing = [];
    const provenance = record.provenance || {};

    if (!provenance.marketplace || provenance.marketplace === 'unknown') missing.push('marketplace');
    if (!provenance.adapter) missing.push('source.adapter');
    if (!provenance.retrievalMethod) missing.push('source.retrievalMethod');
    if (!provenance.sourceReliability) missing.push('source.sourceReliability');
    if (!provenance.acquiredAt) missing.push('source.acquiredAt');
    if (!provenance.sourceUrl) missing.push('sourceUrl');
    if (record.evidenceQualityScore === undefined || record.evidenceQualityScore === null) missing.push('evidenceQualityScore');
    if (!record.review?.status || record.review.status === 'unreviewed') missing.push('review.status');

    for (const field of missing) {
      missingFieldCounts[field] = (missingFieldCounts[field] || 0) + 1;
    }

    if (missing.length) {
      invalidRecords.push({
        id: record.id,
        canonicalCardKey: record.canonicalCardKey,
        missing
      });
    }
  }

  return {
    validCount: records.length - invalidRecords.length,
    invalidCount: invalidRecords.length,
    missingFieldCounts,
    invalidRecords
  };
}

function validateImportRecord(record = {}) {
  const reasons = [];

  if (record.evidenceType !== 'true_sold') reasons.push('not_true_sold_evidence');
  if (record.status !== 'active_evidence') reasons.push('inactive_or_context_record');
  if (toNumber(record.soldPrice, 0) <= 0) reasons.push('missing_sold_price');
  if (!normalizeDate(record.soldAt)) reasons.push('missing_sold_date');
  if (!record.canonicalCardKey) reasons.push('missing_canonical_identity');
  if (!isVerified(record)) reasons.push('not_human_verified');

  return {
    valid: reasons.length === 0,
    reasons
  };
}

function buildImportValidationReport(records = []) {
  const rejectionReasons = {};
  const rejectedRecords = [];
  const duplicateKeyIndex = {};

  for (const record of records) {
    const validation = validateImportRecord(record);
    if (!validation.valid) {
      rejectedRecords.push({ id: record.id, reasons: validation.reasons });
      for (const reason of validation.reasons) {
        rejectionReasons[reason] = (rejectionReasons[reason] || 0) + 1;
      }
    }

    for (const duplicateKey of record.duplicateKeys || []) {
      if (!duplicateKeyIndex[duplicateKey]) duplicateKeyIndex[duplicateKey] = [];
      duplicateKeyIndex[duplicateKey].push(record.id);
    }
  }

  const duplicateGroups = Object.entries(duplicateKeyIndex)
    .filter(([, ids]) => ids.length > 1)
    .map(([duplicateKey, ids]) => ({ duplicateKey, ids }));

  return {
    received: records.length,
    eligibleTrueSold: records.length - rejectedRecords.length,
    rejected: rejectedRecords.length,
    rejectionReasons,
    rejectedRecords,
    duplicateRiskCount: duplicateGroups.length,
    duplicateGroups
  };
}

function buildDatasetStatistics(records = [], options = {}) {
  const asOf = normalizeDate(options.asOf) || new Date().toISOString();
  const verifiedSoldRecords = records.filter((record) => isTrueSoldCandidate(record) && isVerified(record));
  const dates = verifiedSoldRecords.map((record) => normalizeDate(record.soldAt)).filter(Boolean).sort();
  const ageDays = verifiedSoldRecords
    .map((record) => daysBetween(asOf, record.soldAt))
    .filter((age) => age !== null);

  return {
    soldPrice: {
      minimum: verifiedSoldRecords.length ? Math.min(...verifiedSoldRecords.map((record) => record.soldPrice)) : null,
      median: median(verifiedSoldRecords.map((record) => record.soldPrice)),
      average: average(verifiedSoldRecords.map((record) => record.soldPrice)),
      maximum: verifiedSoldRecords.length ? Math.max(...verifiedSoldRecords.map((record) => record.soldPrice)) : null
    },
    totalSoldVolume: round(verifiedSoldRecords.reduce((sum, record) => sum + toNumber(record.totalPaid || record.soldPrice, 0), 0)),
    soldDateRange: {
      oldest: dates[0] || null,
      newest: dates[dates.length - 1] || null
    },
    averageAgeDays: average(ageDays),
    sourceMix: countBy(verifiedSoldRecords, (record) => record.marketplace || 'unknown'),
    evidenceQuality: {
      averageScore: average(verifiedSoldRecords.map((record) => record.evidenceQualityScore)),
      levelDistribution: distribution(verifiedSoldRecords, (record) => record.evidenceQualityLevel || 'unknown')
    }
  };
}

function seededRandom(seed = 'cardhawk') {
  let state = 0;
  const text = String(seed);
  for (let index = 0; index < text.length; index += 1) {
    state = (state * 31 + text.charCodeAt(index)) >>> 0;
  }

  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function buildRandomAuditSample(records = [], options = {}) {
  const sampleSize = Math.max(0, Math.min(toNumber(options.sampleSize, 25), records.length));
  const random = seededRandom(options.seed || 'cardhawk-sold-evidence-audit');

  return {
    seed: options.seed || 'cardhawk-sold-evidence-audit',
    sampleSize,
    records: records
      .map((record) => ({ record, sort: random() }))
      .sort((a, b) => a.sort - b.sort)
      .slice(0, sampleSize)
      .map(({ record }) => ({
        id: record.id,
        canonicalCardKey: record.canonicalCardKey,
        marketplace: record.marketplace,
        rawTitle: record.rawTitle,
        soldPrice: record.soldPrice,
        soldAt: record.soldAt,
        reviewStatus: record.review?.status || 'unreviewed',
        reviewerNotes: record.review?.notes || '',
        provenance: record.provenance
      }))
  };
}

function buildDatasetManifest(input = {}, options = {}) {
  const records = normalizeDatasetRecords(extractRecords(input));
  const targets = { ...DEFAULT_TARGETS, ...asObject(input.targets), ...asObject(options.targets) };
  const metadata = {
    datasetId: options.datasetId || input.datasetId || input.metadata?.datasetId || 'manual-canonical-sold-evidence',
    name: options.name || input.name || input.metadata?.name || 'Manual Canonical Sold Evidence Dataset',
    description: options.description || input.description || input.metadata?.description || '',
    createdAt: normalizeDate(options.createdAt || input.createdAt || input.metadata?.createdAt) || new Date().toISOString(),
    owner: options.owner || input.owner || input.metadata?.owner || null,
    reviewPolicy: options.reviewPolicy || input.reviewPolicy || input.metadata?.reviewPolicy || 'human_verified_exact_identity_required',
    targets
  };
  const coverageReport = buildCoverageReport(records, { ...options, targets });
  const biasReport = buildBiasReport(records, coverageReport, options);

  return {
    source: 'cardhawk_sold_evidence_dataset_builder',
    mode: 'offline_governance',
    version: DATASET_VERSION,
    generatedAt: options.generatedAt || new Date().toISOString(),
    metadata,
    dataset: {
      recordCount: records.length,
      canonicalIdentityCount: new Set(records.map(getIdentity)).size,
      targetUniqueIdentities: targets.uniqueIdentities,
      targetVerifiedSoldRecords: targets.verifiedSoldRecords
    },
    coverageReport,
    biasReport,
    reviewStatus: buildReviewStatusReport(records),
    provenanceValidation: buildProvenanceValidation(records),
    importValidationReport: buildImportValidationReport(records),
    datasetStatistics: buildDatasetStatistics(records, options),
    randomAuditSample: buildRandomAuditSample(records, options)
  };
}

function buildDatasetManifestFromFile(inputFile, options = {}) {
  return buildDatasetManifest(readJsonFile(inputFile), options);
}

function parseArgs(argv = []) {
  const args = { options: {} };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--input') {
      args.inputFile = argv[index + 1];
      index += 1;
    } else if (arg === '--out') {
      args.outFile = argv[index + 1];
      index += 1;
    } else if (arg === '--sample-size') {
      args.options.sampleSize = Number(argv[index + 1]);
      index += 1;
    } else if (arg === '--seed') {
      args.options.seed = argv[index + 1];
      index += 1;
    } else if (arg === '--dataset-id') {
      args.options.datasetId = argv[index + 1];
      index += 1;
    } else if (arg === '--name') {
      args.options.name = argv[index + 1];
      index += 1;
    } else if (arg === '--as-of') {
      args.options.asOf = argv[index + 1];
      index += 1;
    } else if (arg === '--target-identities') {
      args.options.targets = { ...args.options.targets, uniqueIdentities: Number(argv[index + 1]) };
      index += 1;
    } else if (arg === '--target-records') {
      args.options.targets = { ...args.options.targets, verifiedSoldRecords: Number(argv[index + 1]) };
      index += 1;
    }
  }

  return args;
}

function runCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args.inputFile) throw new Error('Missing required --input path');
  const manifest = buildDatasetManifestFromFile(args.inputFile, args.options);

  if (args.outFile) {
    writeJsonFile(args.outFile, manifest);
  }

  const summary = {
    datasetId: manifest.metadata.datasetId,
    recordCount: manifest.dataset.recordCount,
    uniqueIdentities: manifest.coverageReport.uniqueIdentityCount,
    verifiedSoldRecords: manifest.coverageReport.verifiedSoldRecordCount,
    biasRiskLevel: manifest.biasReport.biasRiskLevel,
    importRejected: manifest.importValidationReport.rejected,
    provenanceInvalid: manifest.provenanceValidation.invalidCount,
    readyForCanonicalValuationShadow: manifest.coverageReport.targetProgress.readyForCanonicalValuationShadow
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  return manifest;
}

if (require.main === module) {
  try {
    runCli();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  DATASET_VERSION,
  DEFAULT_TARGETS,
  buildBiasReport,
  buildCoverageReport,
  buildDatasetManifest,
  buildDatasetManifestFromFile,
  buildDatasetStatistics,
  buildImportValidationReport,
  buildProvenanceValidation,
  buildRandomAuditSample,
  buildReviewStatusReport,
  extractRecords,
  normalizeDatasetRecord,
  normalizeDatasetRecords,
  parseArgs,
  runCli,
  validateImportRecord
};
