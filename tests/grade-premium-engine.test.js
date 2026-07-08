'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const gradePremiumEngine = require('../engines/gradePremiumEngine');

function sold(price, overrides = {}) {
  return {
    evidenceType: 'true_sold',
    price,
    soldAt: '2026-06-20',
    source: 'ebay',
    gradingCompany: 'PSA',
    grade: '10',
    ...overrides
  };
}

function active(price, overrides = {}) {
  return {
    evidenceType: 'active',
    price,
    source: 'ebay',
    gradingCompany: 'PSA',
    grade: '10',
    ...overrides
  };
}

function buildInput(overrides = {}) {
  return {
    listing: {
      title: '2024 Topps Chrome John Doe Rookie PSA 10',
      parsed: {
        gradingCompany: 'PSA',
        grade: '10'
      },
      ...(overrides.listing || {})
    },
    listingSimilarity: {
      similarityScore: 94,
      dimensions: {
        grade: { matchStatus: 'match', score: 100 },
        gradingCompany: { matchStatus: 'match', score: 100 },
        rawVsGraded: { matchStatus: 'match', score: 100 },
        condition: { matchStatus: 'match', score: 100 },
        ...(overrides.listingSimilarity?.dimensions || {})
      },
      ...(overrides.listingSimilarity || {})
    },
    comparableQuality: {
      averageComparableQualityScore: 84,
      ...(overrides.comparableQuality || {})
    },
    populationEvidence: {
      gradingCompany: 'PSA',
      grade: '10',
      populationCount: 42,
      higherGradeCount: 0,
      totalGradedCount: 700,
      gemRate: 0.06,
      isGemGrade: true,
      evidenceQuality: 'good',
      ...(overrides.populationEvidence || {})
    },
    valuationRange: {
      expectedValue: 150,
      rangeQuality: 'usable',
      confidence: 76,
      basis: {
        priceSpread: 0.22,
        volatility: 0.12
      },
      ...(overrides.valuationRange || {})
    },
    evidenceSummary: {
      trueSoldCount: 5,
      priceSpread: 0.22,
      volatility: 0.12,
      normalizedEvidence: [],
      ...(overrides.evidenceSummary || {})
    },
    sameGradeComps: [
      sold(145),
      sold(148),
      sold(150),
      sold(152),
      sold(155),
      sold(158)
    ],
    lowerGradeComps: [
      sold(85, { grade: '9' }),
      sold(90, { grade: '9' }),
      sold(95, { grade: '9' })
    ],
    rawComps: [
      sold(45, { gradingCompany: 'raw', grade: 'raw' }),
      sold(50, { gradingCompany: 'raw', grade: 'raw' }),
      sold(55, { gradingCompany: 'raw', grade: 'raw' })
    ],
    higherGradeComps: [
      sold(230, { grade: 'black_label', gradingCompany: 'BGS' })
    ],
    ...(overrides.root || {})
  };
}

test('exports grade premium public API', () => {
  assert.equal(typeof gradePremiumEngine.evaluateGradePremium, 'function');
  assert.equal(typeof gradePremiumEngine.scoreGradePremium, 'function');
  assert.equal(typeof gradePremiumEngine.summarizeGradePremium, 'function');
});

test('empty input returns safe unknown or unproven output', () => {
  const result = gradePremiumEngine.evaluateGradePremium();

  assert.equal(result.source, 'grade_premium_engine');
  assert.equal(result.premiumJustification, 'unproven');
  assert.equal(result.premiumRiskLevel, 'high');
  assert.equal(result.soldSupport.sameGradeCount, 0);
  assert.ok(result.gradePremiumScore <= 30);
  assert.equal(result.dimensions.sameGradeSupport.status, 'missing');
});

test('PSA 10 with strong same-grade sold support returns justified premium', () => {
  const result = gradePremiumEngine.evaluateGradePremium(buildInput());

  assert.equal(result.premiumJustification, 'justified');
  assert.equal(result.premiumRiskLevel, 'low');
  assert.equal(result.dimensions.sameGradeSupport.status, 'strong');
  assert.equal(result.dimensions.populationSupport.status, 'scarcity_supported');
  assert.ok(result.premiumMetrics.sameGradeMedian > result.premiumMetrics.lowerGradeMedian);
});

test('PSA 10 with only PSA 9 and raw comps is unproven', () => {
  const result = gradePremiumEngine.evaluateGradePremium(buildInput({
    root: {
      sameGradeComps: []
    }
  }));

  assert.equal(result.soldSupport.sameGradeCount, 0);
  assert.equal(result.premiumJustification, 'unproven');
  assert.equal(result.dimensions.populationSupport.status, 'context_only_no_sold');
  assert.ok(result.gradePremiumScore <= 30);
});

test('raw card with unclear condition returns high premium risk', () => {
  const result = gradePremiumEngine.evaluateGradePremium(buildInput({
    listing: {
      title: '2024 Topps Chrome John Doe Rookie Raw',
      parsed: {
        gradingCompany: 'raw',
        grade: 'raw'
      }
    },
    populationEvidence: {},
    root: {
      sameGradeComps: [
        sold(70, { gradingCompany: 'raw', grade: 'raw' }),
        sold(72, { gradingCompany: 'raw', grade: 'raw' }),
        sold(75, { gradingCompany: 'raw', grade: 'raw' })
      ],
      rawComps: []
    },
    listingSimilarity: {
      dimensions: {
        rawVsGraded: { matchStatus: 'match', score: 100 },
        condition: { matchStatus: 'missing', score: 50 }
      }
    }
  }));

  assert.equal(result.targetGrade.rawGradedState, 'raw');
  assert.equal(result.dimensions.conditionClarity.status, 'unclear');
  assert.equal(result.premiumRiskLevel, 'high');
});

test('slab premium over raw is supported when graded sold comps outperform raw', () => {
  const result = gradePremiumEngine.evaluateGradePremium(buildInput());

  assert.equal(result.dimensions.rawToGradedPremium.status, 'supported');
  assert.ok(result.premiumMetrics.rawToGradedPremiumPercent > 0);
});

test('excessive slab premium over raw is overextended', () => {
  const result = gradePremiumEngine.evaluateGradePremium(buildInput({
    root: {
      sameGradeComps: [
        sold(495),
        sold(500),
        sold(505)
      ],
      rawComps: [
        sold(45, { gradingCompany: 'raw', grade: 'raw' }),
        sold(50, { gradingCompany: 'raw', grade: 'raw' }),
        sold(55, { gradingCompany: 'raw', grade: 'raw' })
      ]
    }
  }));

  assert.equal(result.dimensions.rawToGradedPremium.status, 'overextended');
  assert.equal(result.premiumJustification, 'overextended');
  assert.equal(result.premiumRiskLevel, 'high');
});

test('population scarcity improves justification when true sold support exists', () => {
  const scarce = gradePremiumEngine.evaluateGradePremium(buildInput());
  const common = gradePremiumEngine.evaluateGradePremium(buildInput({
    populationEvidence: {
      populationCount: 1200,
      higherGradeCount: 200,
      gemRate: 0.7,
      evidenceQuality: 'good'
    }
  }));

  assert.ok(scarce.gradePremiumScore > common.gradePremiumScore);
  assert.equal(common.dimensions.populationSupport.status, 'common_grade');
});

test('population scarcity alone never justifies premium without sold evidence', () => {
  const result = gradePremiumEngine.evaluateGradePremium(buildInput({
    root: {
      sameGradeComps: [],
      lowerGradeComps: [],
      rawComps: []
    },
    populationEvidence: {
      populationCount: 5,
      higherGradeCount: 0,
      totalGradedCount: 900,
      gemRate: 0.005,
      isGemGrade: true,
      evidenceQuality: 'excellent'
    }
  }));

  assert.equal(result.dimensions.populationSupport.status, 'context_only_no_sold');
  assert.equal(result.premiumJustification, 'unproven');
  assert.ok(result.gradePremiumScore <= 30);
});

test('higher-grade sales close to target grade cap premium support', () => {
  const result = gradePremiumEngine.evaluateGradePremium(buildInput({
    root: {
      higherGradeComps: [
        sold(160, { grade: 'black_label', gradingCompany: 'BGS' }),
        sold(162, { grade: 'black_label', gradingCompany: 'BGS' })
      ]
    }
  }));

  assert.equal(result.dimensions.higherGradeRisk.status, 'high');
  assert.equal(result.premiumRiskLevel, 'moderate');
});

test('active comps never count as sold premium support', () => {
  const result = gradePremiumEngine.evaluateGradePremium(buildInput({
    root: {
      sameGradeComps: [
        active(250),
        active(260)
      ],
      lowerGradeComps: [],
      rawComps: []
    },
    evidenceSummary: {
      trueSoldCount: 0,
      normalizedEvidence: [
        active(250),
        active(260)
      ]
    }
  }));

  assert.equal(result.soldSupport.sameGradeCount, 0);
  assert.equal(result.soldSupport.activeContextCount, 2);
  assert.equal(result.premiumJustification, 'unproven');
});

test('high premium volatility creates local warning', () => {
  const result = gradePremiumEngine.evaluateGradePremium(buildInput({
    evidenceSummary: {
      priceSpread: 1.2,
      volatility: 0.72
    },
    valuationRange: {
      confidence: 42,
      basis: {
        priceSpread: 1.2,
        volatility: 0.72
      }
    }
  }));

  assert.equal(result.dimensions.premiumVolatility.status, 'high');
  assert.match(result.warnings.join(' '), /volatility|spread/);
});

test('evaluateGradePremium does not mutate inputs', () => {
  const input = buildInput();
  const before = JSON.stringify(input);

  gradePremiumEngine.evaluateGradePremium(input);

  assert.equal(JSON.stringify(input), before);
});
