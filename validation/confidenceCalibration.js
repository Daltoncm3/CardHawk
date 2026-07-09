'use strict';

const fs = require('node:fs');

const dealerAgreementScorer = require('./dealerAgreementScorer');

const CONFIDENCE_BUCKETS = [
  { key: '0-24', min: 0, max: 24, midpoint: 12 },
  { key: '25-49', min: 25, max: 49, midpoint: 37 },
  { key: '50-74', min: 50, max: 74, midpoint: 62 },
  { key: '75-100', min: 75, max: 100, midpoint: 87.5 },
  { key: 'unknown', min: null, max: null, midpoint: null }
];

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function percent(count, total) {
  if (!total) return 0;
  return Number(((count / total) * 100).toFixed(1));
}

function average(values = []) {
  const finite = values.filter((value) => Number.isFinite(Number(value)));
  if (!finite.length) return 0;
  return Number((finite.reduce((sum, value) => sum + Number(value), 0) / finite.length).toFixed(2));
}

function getBucketForConfidence(value) {
  if (value === undefined || value === null || value === '') return 'unknown';
  const confidence = Number(value);
  if (!Number.isFinite(confidence)) return 'unknown';

  const clamped = Math.max(0, Math.min(100, confidence));
  const bucket = CONFIDENCE_BUCKETS.find((item) =>
    item.key !== 'unknown' && clamped >= item.min && clamped <= item.max
  );

  return bucket ? bucket.key : 'unknown';
}

function createBucketStats(bucket) {
  return {
    bucket: bucket.key,
    range: bucket.key,
    midpoint: bucket.midpoint,
    total: 0,
    agreed: 0,
    disagreed: 0,
    falsePositiveCount: 0,
    falseNegativeCount: 0,
    agreementRate: 0,
    falsePositiveRate: 0,
    falseNegativeRate: 0
  };
}

function getResults(input = {}) {
  if (Array.isArray(input)) return input;
  return asArray(input.results || input.listings || input.records);
}

function getListingScores(input = {}) {
  const root = asObject(input);

  if (Array.isArray(root.listingAgreementDetails)) return root.listingAgreementDetails;
  if (Array.isArray(root.listingScores)) return root.listingScores;
  if (Array.isArray(root.listingsRequiringManualReview) && root.overallScorecard) return [];

  const results = getResults(input);
  return results.map((result, index) => dealerAgreementScorer.scoreListingAgreement(result, index));
}

function getWarnings(input = {}, listingScores = []) {
  const warnings = [];
  const root = asObject(input);

  if (root.source === 'dealer_agreement_scorer' && !listingScores.length && root.overallScorecard) {
    warnings.push('Dealer agreement scorecard does not include listing-level confidence detail; per-bucket calibration cannot be calculated.');
  }

  return warnings;
}

function isOverconfident(score = {}) {
  if (score.confidence === undefined || score.confidence === null || score.confidence === '') return false;
  const confidence = Number(score.confidence);
  if (!Number.isFinite(confidence)) return false;
  return confidence >= 75 && (!score.agreed || score.falsePositive);
}

function isUnderconfident(score = {}) {
  if (score.confidence === undefined || score.confidence === null || score.confidence === '') return false;
  const confidence = Number(score.confidence);
  if (!Number.isFinite(confidence)) return false;
  return confidence < 50 && score.agreed && !score.falsePositive && !score.falseNegative;
}

function reviewReasonsFor(score = {}) {
  const reasons = [];

  if (score.confidence === undefined || score.confidence === null || score.confidence === '' || !Number.isFinite(Number(score.confidence))) {
    reasons.push('missing confidence');
  }
  if (isOverconfident(score)) reasons.push('possible overconfidence');
  if (isUnderconfident(score)) reasons.push('possible underconfidence');

  return reasons;
}

function calculateCalibrationScore(bucketStats = {}) {
  const scoredBuckets = CONFIDENCE_BUCKETS
    .filter((bucket) => bucket.key !== 'unknown')
    .map((bucket) => bucketStats[bucket.key])
    .filter((bucket) => bucket && bucket.total > 0);

  if (!scoredBuckets.length) return 0;

  const weightedError = scoredBuckets.reduce((sum, bucket) => {
    const expectedAgreement = bucket.midpoint;
    return sum + (Math.abs(bucket.agreementRate - expectedAgreement) * bucket.total);
  }, 0);
  const total = scoredBuckets.reduce((sum, bucket) => sum + bucket.total, 0);

  return Math.max(0, Number((100 - (weightedError / total)).toFixed(1)));
}

function getCalibrationRecommendations(summary = {}, bucketStats = {}, warnings = []) {
  const recommendations = [];

  if (warnings.length) {
    recommendations.push('Include listing-level confidence and dealer agreement details for calibration analysis.');
  }

  if (summary.overconfidenceCount > 0) {
    recommendations.push('Review high-confidence disagreements before any confidence signal becomes decision-eligible.');
  }

  if (summary.underconfidenceCount > 0) {
    recommendations.push('Review low-confidence agreements for evidence patterns that may deserve stronger explanations.');
  }

  for (const bucket of Object.values(bucketStats)) {
    if (bucket.bucket === 'unknown') continue;
    if (bucket.total >= 1 && bucket.falsePositiveRate >= 25) {
      recommendations.push(`Review false positives in confidence bucket ${bucket.bucket}.`);
    }
    if (bucket.total >= 1 && bucket.falseNegativeRate >= 25) {
      recommendations.push(`Review false negatives in confidence bucket ${bucket.bucket}.`);
    }
  }

  if (!recommendations.length) {
    recommendations.push('No calibration adjustment suggested from the available offline evidence.');
  }

  return Array.from(new Set(recommendations));
}

function evaluateConfidenceCalibration(input = {}) {
  const listingScores = getListingScores(input);
  const warnings = getWarnings(input, listingScores);
  const perBucketStatistics = Object.fromEntries(CONFIDENCE_BUCKETS.map((bucket) => [
    bucket.key,
    createBucketStats(bucket)
  ]));

  for (const score of listingScores) {
    const bucketKey = getBucketForConfidence(score.confidence);
    const bucket = perBucketStatistics[bucketKey] || perBucketStatistics.unknown;

    bucket.total += 1;
    if (score.agreed) bucket.agreed += 1;
    else bucket.disagreed += 1;
    if (score.falsePositive) bucket.falsePositiveCount += 1;
    if (score.falseNegative) bucket.falseNegativeCount += 1;
  }

  for (const bucket of Object.values(perBucketStatistics)) {
    bucket.agreementRate = percent(bucket.agreed, bucket.total);
    bucket.falsePositiveRate = percent(bucket.falsePositiveCount, bucket.total);
    bucket.falseNegativeRate = percent(bucket.falseNegativeCount, bucket.total);
  }

  const overconfidenceIndicators = listingScores.filter(isOverconfident).map((score) => ({
    listingId: score.listingId,
    title: score.title,
    confidence: score.confidence,
    reasons: ['high confidence with dealer disagreement or false positive']
  }));
  const underconfidenceIndicators = listingScores.filter(isUnderconfident).map((score) => ({
    listingId: score.listingId,
    title: score.title,
    confidence: score.confidence,
    reasons: ['low confidence with dealer agreement']
  }));
  const listingsRequiringConfidenceReview = listingScores
    .map((score) => ({
      listingId: score.listingId,
      title: score.title,
      confidence: Number.isFinite(Number(score.confidence)) ? Number(score.confidence) : null,
      bucket: getBucketForConfidence(score.confidence),
      reasons: reviewReasonsFor(score)
    }))
    .filter((item) => item.reasons.length > 0);
  const totalListings = listingScores.length;
  const withConfidenceCount = listingScores.filter((score) =>
    score.confidence !== undefined &&
    score.confidence !== null &&
    score.confidence !== '' &&
    Number.isFinite(Number(score.confidence))
  ).length;
  const agreedCount = listingScores.filter((score) => score.agreed).length;
  const falsePositiveCount = listingScores.filter((score) => score.falsePositive).length;
  const falseNegativeCount = listingScores.filter((score) => score.falseNegative).length;
  const calibrationScore = calculateCalibrationScore(perBucketStatistics);
  const summary = {
    totalListings,
    withConfidenceCount,
    missingConfidenceCount: totalListings - withConfidenceCount,
    overallAgreementRate: percent(agreedCount, totalListings),
    falsePositiveRate: percent(falsePositiveCount, totalListings),
    falseNegativeRate: percent(falseNegativeCount, totalListings),
    averageConfidence: average(listingScores.map((score) => score.confidence)),
    overconfidenceCount: overconfidenceIndicators.length,
    underconfidenceCount: underconfidenceIndicators.length
  };

  return {
    source: 'confidence_calibration',
    mode: 'offline_validation',
    overallCalibrationSummary: summary,
    perBucketStatistics,
    confidenceBucketDistribution: Object.fromEntries(Object.entries(perBucketStatistics).map(([key, bucket]) => [key, bucket.total])),
    calibrationScore,
    overconfidenceIndicators,
    underconfidenceIndicators,
    suggestedCalibrationAdjustments: getCalibrationRecommendations(summary, perBucketStatistics, warnings),
    recommendations: getCalibrationRecommendations(summary, perBucketStatistics, warnings),
    listingsRequiringConfidenceReview,
    warnings
  };
}

function runConfidenceCalibration(inputFile) {
  if (!inputFile) {
    throw new Error('Usage: node validation/confidenceCalibration.js <dealer-scorecard-or-validation-report.json>');
  }

  return evaluateConfidenceCalibration(readJsonFile(inputFile));
}

function main(argv = process.argv.slice(2)) {
  const [inputFile] = argv;
  const report = runConfidenceCalibration(inputFile);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  evaluateConfidenceCalibration,
  getBucketForConfidence,
  runConfidenceCalibration
};
