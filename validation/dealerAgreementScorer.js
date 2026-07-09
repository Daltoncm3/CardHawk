'use strict';

const fs = require('node:fs');

const POSTURE_FIELDS = [
  'overallReadiness',
  'evidencePosture',
  'compPosture',
  'valuationPosture',
  'resalePressurePosture'
];

const SIGNAL_GROUPS = [
  {
    key: 'blockers',
    expectedKeys: ['blockerSources', 'expectedBlockerSources'],
    actualKeys: ['blockers'],
    label: 'blocker agreement'
  },
  {
    key: 'cautionSignals',
    expectedKeys: ['cautionSignalSources', 'expectedCautionSignalSources'],
    actualKeys: ['cautionSignals'],
    label: 'caution agreement'
  },
  {
    key: 'supportingSignals',
    expectedKeys: ['supportingSignalSources', 'expectedSupportingSignalSources'],
    actualKeys: ['supportingSignals'],
    label: 'supporting signal agreement'
  },
  {
    key: 'conflicts',
    expectedKeys: ['conflictSources', 'expectedConflictSources'],
    actualKeys: ['conflicts'],
    label: 'conflict agreement'
  }
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

function getResults(reportOrResults = {}) {
  if (Array.isArray(reportOrResults)) return reportOrResults;
  return asArray(reportOrResults.results || reportOrResults.listings || reportOrResults.records);
}

function getListingId(result = {}, index = 0) {
  const listing = asObject(result.listing);
  return listing.id || listing.ebayItemId || result.ebayItemId || result.id || `listing-${index + 1}`;
}

function getListingTitle(result = {}) {
  const listing = asObject(result.listing);
  return listing.title || result.title || '';
}

function getActual(result = {}) {
  return asObject(result.actual || result.decisionIntelligence || result);
}

function getExpected(result = {}) {
  return asObject(
    result.dealerEvaluation ||
    result.dealerExpected ||
    result.expectedDecisionIntelligence ||
    result.expectedDecision ||
    result.decisionIntelligenceExpected ||
    result.expected ||
    {}
  );
}

function getExpectedPosture(expected = {}, field) {
  if (expected[field] !== undefined) return expected[field];
  if (expected.decisionIntelligence && expected.decisionIntelligence[field] !== undefined) {
    return expected.decisionIntelligence[field];
  }
  if (expected.postures && expected.postures[field] !== undefined) return expected.postures[field];
  return undefined;
}

function normalizeSource(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function collectSources(items = []) {
  return Array.from(new Set(asArray(items)
    .map((item) => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object') return item.source || item.type || item.key || item.id;
      return '';
    })
    .map(normalizeSource)
    .filter(Boolean)))
    .sort();
}

function getFirstArray(source = {}, keys = []) {
  for (const key of keys) {
    if (Array.isArray(source[key])) return source[key];
  }

  return null;
}

function getExpectedSources(result = {}, expected = {}, keys = []) {
  const candidates = [
    expected,
    expected.expected,
    expected.signals,
    result.expected,
    result.dealerEvaluation,
    result.dealerExpected
  ].map(asObject);

  for (const candidate of candidates) {
    const values = getFirstArray(candidate, keys);
    if (values) return collectSources(values);
  }

  return null;
}

function getActualSources(result = {}, actual = {}, keys = []) {
  for (const source of [actual, result].map(asObject)) {
    const values = getFirstArray(source, keys);
    if (values) return collectSources(values);
  }

  return [];
}

function sameSources(actualSources = [], expectedSources = []) {
  return JSON.stringify([...actualSources].sort()) === JSON.stringify([...expectedSources].sort());
}

function createEmptyCategoryScorecard(name) {
  return {
    name,
    total: 0,
    agreed: 0,
    disagreed: 0,
    missingExpected: 0,
    agreementPercent: 0
  };
}

function finalizeCategory(scorecard) {
  return {
    ...scorecard,
    disagreed: Math.max(0, scorecard.total - scorecard.agreed),
    agreementPercent: percent(scorecard.agreed, scorecard.total)
  };
}

function getExplanationScore(result = {}, expected = {}) {
  const value =
    result.explanationScore ??
    result.dealerExplanationScore ??
    expected.explanationScore ??
    expected.expectedExplanationScore;

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function getBooleanFlag(result = {}, expected = {}, key) {
  return Boolean(result[key] ?? expected[key] ?? expected.expected?.[key]);
}

function getConfidenceValue(result = {}, actual = {}) {
  const value =
    actual.confidence ??
    actual.confidenceScore ??
    actual.decisionConfidence ??
    actual.evidenceConfidence ??
    result.confidence ??
    result.confidenceScore;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function confidenceBucket(value) {
  if (value === undefined || value === null || value === '') return 'unknown';
  if (!Number.isFinite(Number(value))) return 'unknown';
  if (value < 40) return 'low';
  if (value < 70) return 'medium';
  if (value < 85) return 'high';
  return 'very_high';
}

function getManualReviewReason(resultScore = {}) {
  const reasons = [];

  if (resultScore.missingExpected.length) reasons.push('missing dealer expectation');
  if (resultScore.postureMismatches.length) reasons.push('posture disagreement');
  if (resultScore.signalMismatches.length) reasons.push('signal disagreement');
  if (resultScore.falsePositive) reasons.push('false positive');
  if (resultScore.falseNegative) reasons.push('false negative');

  return reasons;
}

function recommendationFor(resultScore = {}) {
  if (resultScore.missingExpected.length) {
    return 'Add dealer expectation labels before using this listing in agreement scoring.';
  }

  if (resultScore.postureMismatches.some((mismatch) => mismatch.field === 'overallReadiness')) {
    return 'Review readiness thresholds and the explanation that maps evidence to review posture.';
  }

  if (resultScore.signalMismatches.some((mismatch) => mismatch.group === 'blockers')) {
    return 'Review blocker detection so fatal evidence gaps align with dealer judgment.';
  }

  if (resultScore.signalMismatches.some((mismatch) => mismatch.group === 'cautionSignals')) {
    return 'Review caution signal wording and source classification for dealer-facing explanations.';
  }

  if (resultScore.falsePositive || resultScore.falseNegative) {
    return 'Review the listing manually and update Decision Intelligence validation expectations if dealer judgment changed.';
  }

  return null;
}

function scoreListingAgreement(result = {}, index = 0) {
  const actual = getActual(result);
  const expected = getExpected(result);
  const missingExpected = [];
  const postureMismatches = [];
  const signalMismatches = [];

  for (const field of POSTURE_FIELDS) {
    const expectedValue = getExpectedPosture(expected, field);
    if (expectedValue === undefined) {
      missingExpected.push(field);
      continue;
    }

    if (actual[field] !== expectedValue) {
      postureMismatches.push({
        field,
        expected: expectedValue,
        actual: actual[field]
      });
    }
  }

  for (const group of SIGNAL_GROUPS) {
    const expectedSources = getExpectedSources(result, expected, group.expectedKeys);
    if (!expectedSources) {
      missingExpected.push(group.key);
      continue;
    }

    const actualSources = getActualSources(result, actual, group.actualKeys);
    if (!sameSources(actualSources, expectedSources)) {
      signalMismatches.push({
        group: group.key,
        expected: expectedSources,
        actual: actualSources
      });
    }
  }

  const falsePositive = getBooleanFlag(result, expected, 'falsePositive');
  const falseNegative = getBooleanFlag(result, expected, 'falseNegative');
  const reviewReasons = getManualReviewReason({
    missingExpected,
    postureMismatches,
    signalMismatches,
    falsePositive,
    falseNegative
  });
  const recommendation = recommendationFor({
    missingExpected,
    postureMismatches,
    signalMismatches,
    falsePositive,
    falseNegative
  });

  return {
    listingId: getListingId(result, index),
    title: getListingTitle(result),
    agreed: reviewReasons.length === 0,
    missingExpected,
    postureMismatches,
    signalMismatches,
    explanationScore: getExplanationScore(result, expected),
    falsePositive,
    falseNegative,
    confidence: getConfidenceValue(result, actual),
    confidenceBucket: confidenceBucket(getConfidenceValue(result, actual)),
    manualReviewRequired: reviewReasons.length > 0,
    reviewReasons,
    recommendation
  };
}

function scoreDealerAgreement(reportOrResults = {}) {
  const results = getResults(reportOrResults);
  const listingScores = results.map(scoreListingAgreement);
  const totalListings = listingScores.length;
  const agreedListings = listingScores.filter((score) => score.agreed).length;
  const falsePositiveCount = listingScores.filter((score) => score.falsePositive).length;
  const falseNegativeCount = listingScores.filter((score) => score.falseNegative).length;

  const postureScorecards = POSTURE_FIELDS.reduce((scorecards, field) => {
    scorecards[field] = createEmptyCategoryScorecard(field);
    return scorecards;
  }, {});
  const signalScorecards = SIGNAL_GROUPS.reduce((scorecards, group) => {
    scorecards[group.key] = createEmptyCategoryScorecard(group.label);
    return scorecards;
  }, {});

  for (const result of results) {
    const actual = getActual(result);
    const expected = getExpected(result);

    for (const field of POSTURE_FIELDS) {
      const scorecard = postureScorecards[field];
      const expectedValue = getExpectedPosture(expected, field);
      if (expectedValue === undefined) {
        scorecard.missingExpected += 1;
        continue;
      }

      scorecard.total += 1;
      if (actual[field] === expectedValue) scorecard.agreed += 1;
    }

    for (const group of SIGNAL_GROUPS) {
      const scorecard = signalScorecards[group.key];
      const expectedSources = getExpectedSources(result, expected, group.expectedKeys);
      if (!expectedSources) {
        scorecard.missingExpected += 1;
        continue;
      }

      scorecard.total += 1;
      if (sameSources(getActualSources(result, actual, group.actualKeys), expectedSources)) {
        scorecard.agreed += 1;
      }
    }
  }

  const confidenceDistribution = listingScores.reduce((distribution, score) => {
    distribution[score.confidenceBucket] = (distribution[score.confidenceBucket] || 0) + 1;
    return distribution;
  }, {});
  const listingsRequiringManualReview = listingScores
    .filter((score) => score.manualReviewRequired)
    .map((score) => ({
      listingId: score.listingId,
      title: score.title,
      reasons: score.reviewReasons,
      postureMismatches: score.postureMismatches,
      signalMismatches: score.signalMismatches,
      recommendation: score.recommendation
    }));
  const disagreementSummary = listingScores
    .filter((score) => !score.agreed)
    .map((score) => ({
      listingId: score.listingId,
      title: score.title,
      missingExpected: score.missingExpected,
      postureMismatches: score.postureMismatches,
      signalMismatches: score.signalMismatches
    }));
  const recommendations = Array.from(new Set(listingScores
    .map((score) => score.recommendation)
    .filter(Boolean)));

  return {
    source: 'dealer_agreement_scorer',
    mode: 'offline_validation',
    overallScorecard: {
      totalListings,
      agreedListings,
      disagreedListings: totalListings - agreedListings,
      dealerAgreementPercent: percent(agreedListings, totalListings),
      explanationScoreAverage: average(listingScores.map((score) => score.explanationScore)),
      falsePositiveCount,
      falseNegativeCount,
      falsePositiveRate: percent(falsePositiveCount, totalListings),
      falseNegativeRate: percent(falseNegativeCount, totalListings)
    },
    perCategoryScorecard: {
      posture: Object.fromEntries(Object.entries(postureScorecards).map(([key, value]) => [key, finalizeCategory(value)])),
      signals: Object.fromEntries(Object.entries(signalScorecards).map(([key, value]) => [key, finalizeCategory(value)]))
    },
    confidenceDistribution,
    disagreementSummary,
    listingsRequiringManualReview,
    recommendationsForImprovingDecisionIntelligence: recommendations
  };
}

function runDealerAgreementScoring(inputFile) {
  if (!inputFile) {
    throw new Error('Usage: node validation/dealerAgreementScorer.js <decision-validation-report.json>');
  }

  return scoreDealerAgreement(readJsonFile(inputFile));
}

function main(argv = process.argv.slice(2)) {
  const [inputFile] = argv;
  const scorecard = runDealerAgreementScoring(inputFile);
  process.stdout.write(`${JSON.stringify(scorecard, null, 2)}\n`);
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
  collectSources,
  scoreDealerAgreement,
  scoreListingAgreement,
  runDealerAgreementScoring
};
