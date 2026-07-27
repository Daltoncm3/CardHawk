'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const test = require('node:test');

const {
  fingerprint
} = require('../validation/canonicalValidationCore');
const datasetBuilder = require('../validation/calibrationDatasetBuilder');
const builder = require('../validation/calibrationRecommendationBuilder');
const contract = require('../validation/calibrationRecommendationContract');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function tempDir(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
}

function recordFingerprint(record = {}) {
  const projection = clone(record);
  delete projection.recordFingerprint;
  return fingerprint(projection);
}

function calibrationRecord(id, overrides = {}) {
  const review = {
    reviewer: 'Dalton',
    reviewedAt: '2026-07-26T12:00:00.000Z',
    identityCorrect: 'yes',
    evidenceSufficient: 'yes',
    valuationReasonable: 'yes',
    confidenceAppropriate: 'yes',
    wouldBuy: 'yes',
    wouldNotify: 'yes',
    productionCorrect: 'yes',
    shadowBetter: 'no',
    buyNowQuality: 'correct',
    dealGateQuality: 'correct',
    reasonCategories: [],
    disagreementCategories: [],
    reviewConfidence: 88,
    notes: 'Builder fixture.',
    reviewFingerprint: `review-fingerprint-${id}`,
    ...overrides.review
  };
  const core = {
    recordId: `record-${id}`,
    sourceWorkspaceId: overrides.sourceWorkspaceId || 'workspace-a',
    sourceBatchId: overrides.sourceBatchId || 'batch-a',
    packageId: `pkg-${id}`,
    listingId: overrides.listingId || `listing-${id}`,
    marketplace: overrides.marketplace || 'ebay',
    packageFingerprint: `package-fingerprint-${id}`,
    snapshotFingerprint: `snapshot-fingerprint-${id}`,
    reviewFingerprint: review.reviewFingerprint,
    sourceDatasetId: overrides.sourceDatasetId || 'dataset-a',
    sourceDatasetFingerprint: overrides.sourceDatasetFingerprint || 'dataset-fingerprint-a',
    listingIdentity: {
      listingId: overrides.listingId || `listing-${id}`,
      marketplace: overrides.marketplace || 'ebay',
      listingSnapshot: {
        title: `Builder Fixture ${id}`,
        marketplaceItemId: id,
        marketplace: overrides.marketplace || 'ebay',
        parsed: {
          player: overrides.player || `Player ${id % 6}`,
          setName: overrides.product || `Product ${id % 4}`,
          sport: overrides.sport || 'basketball',
          gradeCompany: overrides.gradingCompany || 'PSA',
          grade: 10,
          flags: overrides.flags || { graded: true }
        }
      },
      identitySnapshot: {
        canonicalIdentitySummary: {
          canonicalIdentityKey: overrides.identityKey || `identity-${id % 12}`,
          category: overrides.sport || 'basketball',
          setName: overrides.product || `Product ${id % 4}`,
          gradeCompany: overrides.gradingCompany || 'PSA'
        },
        identityFingerprint: `identity-fingerprint-${id}`
      }
    },
    productionOutputs: {
      estimatedValue: 180,
      confidence: { confidence: overrides.productionConfidence ?? 82 },
      dealGateOutcome: {
        passed: overrides.productionPassed !== false,
        buyNowAllowed: overrides.productionPassed !== false,
        decision: overrides.productionPassed === false ? 'REJECT' : 'BUY_NOW'
      },
      notificationEligibility: { eligible: overrides.notificationEligible !== false }
    },
    shadowOutputs: {
      shadowValuation: { recommendedMarketValue: 175 },
      shadowRecommendationPosture: overrides.shadowPosture || 'BUY_NOW'
    },
    daltonReview: review,
    disagreementSummary: {
      suggestedValidationFocus: overrides.suggestedValidationFocus || [],
      falsePositiveRiskSignals: overrides.falsePositiveRiskSignals || []
    },
    reviewMetadata: {
      reviewer: review.reviewer,
      reviewedAt: review.reviewedAt,
      reviewConfidence: review.reviewConfidence,
      reasonCategories: clone(review.reasonCategories),
      disagreementCategories: clone(review.disagreementCategories),
      sourcePackageReviewStatus: 'reviewed',
      sourcePackageFingerprint: `package-fingerprint-${id}`,
      sourceSnapshotFingerprint: `snapshot-fingerprint-${id}`
    },
    productionImpact: 'none',
    decisionImpact: 'none'
  };
  return {
    ...core,
    recordFingerprint: recordFingerprint(core)
  };
}

function dataset(id, records, overrides = {}) {
  const summaries = {
    categoryBreakdown: {
      reasonCategories: {},
      disagreementCategories: {}
    },
    confidenceBreakdown: {
      reviewConfidence: {},
      productionConfidence: {}
    },
    agreementMetrics: {},
    disagreementMetrics: {},
    calibrationCandidates: records.map((record) => ({
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
      candidateFocus: clone(record.disagreementSummary.suggestedValidationFocus)
    }))
  };
  const core = {
    schemaVersion: datasetBuilder.CALIBRATION_DATASET_SCHEMA_VERSION,
    datasetId: id,
    createdAt: '2026-07-26T13:00:00.000Z',
    source: datasetBuilder.CALIBRATION_DATASET_SOURCE,
    sourceWorkspaces: [{ workspaceId: `${id}-workspace`, batchId: `${id}-batch`, sourceType: 'fixture' }],
    sourceBatchIds: [`${id}-batch`],
    reviewCount: records.length,
    listingCount: new Set(records.map((record) => record.listingId)).size,
    ...summaries,
    records,
    validationMetadata: {},
    productionImpact: 'none',
    decisionImpact: 'none',
    ...overrides
  };
  return {
    ...core,
    datasetFingerprint: datasetBuilder.buildCalibrationDatasetFingerprint(core)
  };
}

function repeatedRecords(count, factory) {
  return Array.from({ length: count }, (_, index) => factory(index + 1));
}

const relaxedGates = {
  minimumReviewedRecords: 3,
  minimumEligibleRecords: 2,
  minimumReviewConfidence: 60,
  maximumSingleIdentityShare: 0.95
};

test('exports Calibration Recommendation Builder public API and constants', () => {
  assert.equal(builder.CALIBRATION_RECOMMENDATION_BUILDER_SOURCE, 'calibration_recommendation_builder');
  assert.equal(builder.CALIBRATION_RECOMMENDATION_BUILDER_SCHEMA_VERSION, '1.0.0');
  assert.equal(typeof builder.buildCalibrationRecommendationBatch, 'function');
  assert.equal(typeof builder.buildRecommendationsFromDataset, 'function');
  assert.equal(typeof builder.buildCalibrationFindings, 'function');
  assert.equal(typeof builder.evaluateRecommendationEvidence, 'function');
  assert.equal(typeof builder.classifyRecommendationCategory, 'function');
  assert.equal(typeof builder.determineAffectedSubsystem, 'function');
  assert.equal(typeof builder.buildInsufficientEvidenceRecommendation, 'function');
  assert.equal(typeof builder.buildNoChangeRecommendation, 'function');
  assert.equal(typeof builder.validateCalibrationRecommendationBatch, 'function');
  assert.equal(typeof builder.summarizeCalibrationRecommendationBatch, 'function');
  assert.equal(typeof builder.filterCalibrationRecommendations, 'function');
  assert.equal(typeof builder.sortCalibrationRecommendations, 'function');
  assert.equal(typeof builder.exportCalibrationRecommendationBatch, 'function');
  assert.equal(typeof builder.importCalibrationRecommendationBatch, 'function');
  assert.equal(typeof builder.buildCalibrationRecommendationBatchFingerprint, 'function');
});

test('builds a minimum valid recommendation batch with explicit insufficient evidence', () => {
  const input = dataset('small', [calibrationRecord('small-1')]);
  const batch = builder.buildCalibrationRecommendationBatch(input, {
    recommendationBatchId: 'minimum-recommendation-batch',
    createdAt: '2026-07-26T14:00:00.000Z'
  });

  assert.equal(batch.recommendationBatchId, 'minimum-recommendation-batch');
  assert.equal(batch.datasetCount, 1);
  assert.equal(batch.productionImpact, 'none');
  assert.equal(batch.decisionImpact, 'none');
  assert.equal(batch.insufficientEvidenceCount >= 1, true);
  assert.equal(batch.recommendations.some((recommendation) => recommendation.recommendationCategory === 'insufficient_data_finding'), true);
  assert.equal(batch.recommendations.every((recommendation) => recommendation.reviewerApproval.approved === false), true);
  assert.equal(batch.recommendations.every((recommendation) => recommendation.experimentReferences.length === 0), true);
  assert.equal(batch.batchFingerprint, builder.buildCalibrationRecommendationBatchFingerprint(batch));
  assert.equal(builder.validateCalibrationRecommendationBatch(batch).valid, true);
});

test('builds deterministic findings, recommendations, ordering, and batch fingerprints', () => {
  const input = dataset('deterministic', repeatedRecords(4, (index) => calibrationRecord(`det-${index}`, {
    review: {
      confidenceAppropriate: index <= 2 ? 'overconfident' : 'yes',
      reasonCategories: index <= 2 ? ['confidence_too_high'] : []
    },
    suggestedValidationFocus: index <= 2 ? ['confidence_conflict'] : []
  })));
  const options = {
    recommendationBatchId: 'deterministic-batch',
    createdAt: '2026-07-26T14:00:00.000Z',
    evidenceGates: relaxedGates
  };
  const first = builder.buildCalibrationRecommendationBatch(input, options);
  const second = builder.buildCalibrationRecommendationBatch(input, options);

  assert.deepEqual(first, second);
  assert.deepEqual(first.findings.map((finding) => finding.findingCategory), ['confidence_calibration_adjustment']);
  assert.deepEqual(first.recommendations.map((recommendation) => recommendation.recommendationCategory), ['confidence_calibration_adjustment']);
  assert.equal(first.recommendations[0].recommendationFingerprint, contract.buildCalibrationRecommendationFingerprint(first.recommendations[0]));
});

test('supports multiple calibration datasets and stable source references', () => {
  const first = dataset('dataset-b', [calibrationRecord('b-1', {
    review: { identityCorrect: 'no', reasonCategories: ['identity_error'] }
  }), calibrationRecord('b-2', {
    review: { identityCorrect: 'partial', reasonCategories: ['identity_error'] }
  })]);
  const second = dataset('dataset-a', [calibrationRecord('a-1', {
    review: { evidenceSufficient: 'no', reasonCategories: ['weak_evidence'] }
  }), calibrationRecord('a-2', {
    review: { evidenceSufficient: 'partial', reasonCategories: ['active_only_evidence'] }
  })]);
  const batch = builder.buildCalibrationRecommendationBatch([first, second], {
    recommendationBatchId: 'multi-dataset-batch',
    createdAt: '2026-07-26T14:00:00.000Z',
    evidenceGates: relaxedGates
  });

  assert.deepEqual(batch.sourceDatasetIds, ['dataset-a', 'dataset-b']);
  assert.equal(batch.recommendationCategorySummary.identity_parsing_improvement, 1);
  assert.equal(batch.recommendationCategorySummary.evidence_sufficiency_adjustment, 1);
  assert.equal(builder.validateCalibrationRecommendationBatch(batch).valid, true);
});

test('classifies supported recommendation categories and affected subsystems', () => {
  const cases = [
    [calibrationRecord('identity', { review: { identityCorrect: 'no', reasonCategories: ['identity_error'] } }), 'identity_parsing_improvement', 'parser'],
    [calibrationRecord('evidence', { review: { evidenceSufficient: 'no', reasonCategories: ['weak_evidence'] } }), 'evidence_sufficiency_adjustment', 'evidence_readiness'],
    [calibrationRecord('valuation', { review: { valuationReasonable: 'no', reasonCategories: ['valuation_too_high'] } }), 'valuation_methodology_adjustment', 'valuation'],
    [calibrationRecord('confidence', { review: { confidenceAppropriate: 'underconfident', reasonCategories: ['confidence_too_low'] } }), 'confidence_calibration_adjustment', 'confidence'],
    [calibrationRecord('risk', { review: { reasonCategories: ['seller_or_listing_risk'] } }), 'risk_rule_adjustment', 'risk'],
    [calibrationRecord('grading', { review: { reasonCategories: ['grading_risk'] } }), 'grading_or_quality_adjustment', 'grading_quality'],
    [calibrationRecord('deal', { review: { dealGateQuality: 'too_strict', reasonCategories: ['deal_gate_too_strict'] } }), 'deal_gate_rule_review', 'deal_gate'],
    [calibrationRecord('buy', { review: { buyNowQuality: 'too_aggressive' } }), 'buy_now_threshold_review', 'buy_now'],
    [calibrationRecord('notify', { review: { reasonCategories: ['notification_should_have_sent'] } }), 'notification_threshold_review', 'notification'],
    [calibrationRecord('fp', { review: { buyNowQuality: 'false_positive' } }), 'buy_now_threshold_review', 'buy_now'],
    [calibrationRecord('miss', { review: { buyNowQuality: 'missed_opportunity', reasonCategories: ['missed_opportunity'] } }), 'buy_now_threshold_review', 'buy_now'],
    [calibrationRecord('diag', { review: { reasonCategories: ['explanation_issue'] } }), 'diagnostic_improvement', 'diagnostics']
  ];

  for (const [record, category, subsystem] of cases) {
    assert.equal(builder.classifyRecommendationCategory(record), category);
    assert.equal(builder.determineAffectedSubsystem(category), subsystem);
  }
  assert.equal(builder.determineAffectedSubsystem('grading_quality_adjustment'), 'grading_quality');
  assert.equal(builder.classifyRecommendationCategory({ findingCategory: 'no_change' }), 'no_change_recommendation');
});

test('generates false-positive and missed-opportunity recommendations with conflict counterevidence', () => {
  const input = dataset('conflict', [
    calibrationRecord('fp-1', { review: { wouldBuy: 'no', buyNowQuality: 'false_positive', reasonCategories: ['buy_now_false_positive'] } }),
    calibrationRecord('fp-2', { review: { wouldBuy: 'no', buyNowQuality: 'false_positive', reasonCategories: ['buy_now_false_positive'] } }),
    calibrationRecord('mo-1', { review: { buyNowQuality: 'missed_opportunity', reasonCategories: ['missed_opportunity'] } }),
    calibrationRecord('mo-2', { review: { buyNowQuality: 'missed_opportunity', reasonCategories: ['missed_opportunity'] } })
  ]);
  const batch = builder.buildCalibrationRecommendationBatch(input, {
    recommendationBatchId: 'conflict-batch',
    createdAt: '2026-07-26T14:00:00.000Z',
    evidenceGates: relaxedGates
  });
  const falsePositive = batch.recommendations.find((recommendation) => recommendation.recommendationCategory === 'false_positive_reduction');
  const missed = batch.recommendations.find((recommendation) => recommendation.recommendationCategory === 'missed_opportunity_reduction');

  assert.equal(Boolean(falsePositive), true);
  assert.equal(Boolean(missed), true);
  assert.equal(falsePositive.counterEvidence.some((entry) => entry.conflictType === 'false_positive_vs_missed_opportunity'), true);
  assert.equal(falsePositive.proposedBehavior.posture, 'manual_investigation_required');
});

test('generates Deal Gate and BUY_NOW findings without changing authority', () => {
  const input = dataset('gate-buy', [
    calibrationRecord('gate-1', { review: { dealGateQuality: 'too_strict', reasonCategories: ['deal_gate_too_strict'] } }),
    calibrationRecord('gate-2', { review: { dealGateQuality: 'too_strict', reasonCategories: ['deal_gate_too_strict'] } }),
    calibrationRecord('buy-1', { review: { buyNowQuality: 'too_aggressive' } }),
    calibrationRecord('buy-2', { review: { buyNowQuality: 'too_aggressive' } })
  ]);
  const batch = builder.buildCalibrationRecommendationBatch(input, {
    recommendationBatchId: 'gate-buy-batch',
    createdAt: '2026-07-26T14:00:00.000Z',
    evidenceGates: relaxedGates
  });

  assert.equal(batch.affectedSubsystemSummary.deal_gate, 1);
  assert.equal(batch.affectedSubsystemSummary.buy_now, 1);
  assert.equal(batch.recommendations.every((recommendation) => recommendation.productionImpact === 'none'), true);
  assert.equal(batch.recommendations.every((recommendation) => recommendation.decisionImpact === 'none'), true);
});

test('builds explicit continue-observation and manual-investigation recommendations', () => {
  const observation = dataset('observation', repeatedRecords(4, (index) => calibrationRecord(`obs-${index}`, {
    review: { valuationReasonable: index <= 2 ? 'no' : 'yes', reasonCategories: index <= 2 ? ['valuation_too_low'] : [] }
  })));
  const observeBatch = builder.buildCalibrationRecommendationBatch(observation, {
    recommendationBatchId: 'observation-batch',
    createdAt: '2026-07-26T14:00:00.000Z',
    evidenceGates: { ...relaxedGates, minimumEligibleRecords: 3 }
  });
  const valuation = observeBatch.recommendations.find((recommendation) => recommendation.recommendationCategory === 'valuation_methodology_adjustment');

  assert.equal(valuation.proposedBehavior.posture, 'continue_observation');

  const manual = dataset('manual', [
    calibrationRecord('dup-1', { listingId: 'same-listing', review: { evidenceSufficient: 'no', reasonCategories: ['weak_evidence'] } }),
    calibrationRecord('dup-2', { listingId: 'same-listing', review: { evidenceSufficient: 'no', reasonCategories: ['weak_evidence'] } }),
    calibrationRecord('dup-3', { review: { evidenceSufficient: 'no', reasonCategories: ['weak_evidence'] } })
  ]);
  const manualBatch = builder.buildCalibrationRecommendationBatch(manual, {
    recommendationBatchId: 'manual-batch',
    createdAt: '2026-07-26T14:00:00.000Z',
    evidenceGates: relaxedGates
  });
  const evidence = manualBatch.recommendations.find((recommendation) => recommendation.recommendationCategory === 'evidence_sufficiency_adjustment');
  assert.equal(evidence.proposedBehavior.posture, 'manual_investigation_required');
});

test('builds no-change recommendations when reviewed evidence supports current behavior', () => {
  const input = dataset('no-change', repeatedRecords(4, (index) => calibrationRecord(`nc-${index}`)));
  const recommendation = builder.buildNoChangeRecommendation(input, {
    recommendationBatchId: 'no-change-batch',
    createdAt: '2026-07-26T14:00:00.000Z',
    evidenceGates: relaxedGates
  });

  assert.equal(recommendation.recommendationCategory, 'no_change_recommendation');
  assert.equal(recommendation.proposedBehavior.posture, 'no_change_recommended');
  assert.equal(recommendation.expectedBenefit.expectedChange, 'none');
  assert.equal(contract.validateCalibrationRecommendation(recommendation).valid, true);
});

test('buildInsufficientEvidenceRecommendation preserves unknowns and source references', () => {
  const input = dataset('insufficient', []);
  const recommendation = builder.buildInsufficientEvidenceRecommendation(input, {
    recommendationBatchId: 'insufficient-batch',
    createdAt: '2026-07-26T14:00:00.000Z'
  });

  assert.equal(recommendation.recommendationCategory, 'insufficient_data_finding');
  assert.equal(recommendation.proposedBehavior.posture, 'insufficient_evidence');
  assert.deepEqual(recommendation.sourceDatasetIds, ['insufficient']);
  assert.equal(contract.validateCalibrationRecommendation(recommendation).valid, true);
});

test('detects repeated identities, class imbalance, incomplete confidence, duplicates, and unknown values in findings', () => {
  const input = dataset('coverage-risk', [
    calibrationRecord('risk-1', { identityKey: 'same', review: { confidenceAppropriate: 'overconfident', reasonCategories: ['confidence_too_high'], reviewConfidence: 'unknown' } }),
    calibrationRecord('risk-2', { identityKey: 'same', review: { confidenceAppropriate: 'overconfident', reasonCategories: ['confidence_too_high'], reviewConfidence: 'unknown' } }),
    calibrationRecord('risk-3', { identityKey: 'same', review: { confidenceAppropriate: 'overconfident', reasonCategories: ['confidence_too_high'], productionCorrect: 'no' } }),
    calibrationRecord('risk-4', { identityKey: 'other', review: { confidenceAppropriate: 'overconfident', reasonCategories: ['confidence_too_high'], productionCorrect: 'yes' } })
  ]);
  const findings = builder.buildCalibrationFindings(input, {
    evidenceGates: relaxedGates
  });
  const finding = findings.find((item) => item.findingCategory === 'confidence_calibration_adjustment');

  assert.equal(finding.correlatedRecordSummary.topIdentityKey, 'same');
  assert.equal(finding.limitations.includes('review_confidence_sparse'), true);
  assert.equal(finding.classBalance.productionCorrect.no, 1);
  assert.equal(finding.coverage.identities.same, 3);
});

test('filters and sorts recommendations deterministically', () => {
  const input = dataset('filter-recs', [
    calibrationRecord('f-1', { review: { identityCorrect: 'no', reasonCategories: ['identity_error'] } }),
    calibrationRecord('f-2', { review: { identityCorrect: 'no', reasonCategories: ['identity_error'] } }),
    calibrationRecord('f-3', { review: { evidenceSufficient: 'no', reasonCategories: ['weak_evidence'] } }),
    calibrationRecord('f-4', { review: { evidenceSufficient: 'no', reasonCategories: ['weak_evidence'] } })
  ]);
  const batch = builder.buildCalibrationRecommendationBatch(input, {
    recommendationBatchId: 'filter-recs-batch',
    createdAt: '2026-07-26T14:00:00.000Z',
    evidenceGates: relaxedGates
  });
  const filtered = builder.filterCalibrationRecommendations(batch, { affectedSubsystem: 'parser' });

  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].recommendationCategory, 'identity_parsing_improvement');
  assert.deepEqual(builder.sortCalibrationRecommendations([...batch.recommendations].reverse()), batch.recommendations);
});

test('exports and imports recommendation batches without changing JSON shape', () => {
  const input = dataset('export-recs', repeatedRecords(3, (index) => calibrationRecord(`exp-${index}`, {
    review: { evidenceSufficient: 'no', reasonCategories: ['weak_evidence'] }
  })));
  const batch = builder.buildCalibrationRecommendationBatch(input, {
    recommendationBatchId: 'export-recs-batch',
    createdAt: '2026-07-26T14:00:00.000Z',
    evidenceGates: relaxedGates
  });
  const serialized = builder.exportCalibrationRecommendationBatch(batch);
  const imported = builder.importCalibrationRecommendationBatch(serialized);
  const output = path.join(tempDir('recommendation-export'), 'batch.json');
  const written = builder.exportCalibrationRecommendationBatch(batch, output);

  assert.equal(serialized.endsWith('\n'), true);
  assert.deepEqual(imported.batch, batch);
  assert.equal(imported.validation.valid, true);
  assert.deepEqual(written, batch);
  assert.deepEqual(JSON.parse(fs.readFileSync(output, 'utf8')), batch);
});

test('validates invalid recommendation batches and boundary violations', () => {
  const input = dataset('invalid-boundary', repeatedRecords(3, (index) => calibrationRecord(`bad-${index}`, {
    review: { evidenceSufficient: 'no', reasonCategories: ['weak_evidence'] }
  })));
  const batch = builder.buildCalibrationRecommendationBatch(input, {
    recommendationBatchId: 'invalid-boundary-batch',
    createdAt: '2026-07-26T14:00:00.000Z',
    evidenceGates: relaxedGates
  });
  const invalid = {
    ...batch,
    productionImpact: 'changes_rules',
    decisionImpact: 'changes_decisions',
    recommendationCount: batch.recommendationCount + 2,
    recommendations: [{
      ...batch.recommendations[0],
      recommendationId: batch.recommendations[0].recommendationId,
      productionImpact: 'changes_rules',
      sourceDatasetIds: ['missing-dataset'],
      reviewerApproval: { approved: true },
      recommendationFingerprint: 'stale'
    }, batch.recommendations[0]],
    batchFingerprint: 'stale'
  };
  const validation = builder.validateCalibrationRecommendationBatch(invalid);

  assert.equal(validation.valid, false);
  assert.equal(validation.reasonCodes.includes('invalid_production_impact'), true);
  assert.equal(validation.reasonCodes.includes('recommendation_count_mismatch'), true);
  assert.equal(validation.invalidRecommendationIndexes.includes(0), true);
  assert.equal(validation.invalidSourceDatasetReferences.includes('recommendations.0.sourceDatasetIds'), true);
  assert.equal(validation.productionImpactViolations.length > 0, true);
  assert.equal(validation.decisionImpactViolations.includes('batch.decisionImpact'), true);
});

test('source datasets and records are not mutated and generated artifacts are immutable', () => {
  const input = dataset('immutable-builder', repeatedRecords(3, (index) => calibrationRecord(`imm-${index}`, {
    review: { identityCorrect: 'no', reasonCategories: ['identity_error'] }
  })));
  const before = clone(input);
  const batch = builder.buildCalibrationRecommendationBatch(input, {
    recommendationBatchId: 'immutable-builder-batch',
    createdAt: '2026-07-26T14:00:00.000Z',
    evidenceGates: relaxedGates
  });

  assert.deepEqual(input, before);
  assert.equal(Object.isFrozen(batch), true);
  assert.equal(Object.isFrozen(batch.findings[0]), true);
  assert.equal(Object.isFrozen(batch.recommendations[0]), true);
});

test('builder does not create automatic approvals, experiment references, or production proposals', () => {
  const input = dataset('no-authority', repeatedRecords(3, (index) => calibrationRecord(`auth-${index}`, {
    review: { buyNowQuality: 'false_positive', reasonCategories: ['buy_now_false_positive'] }
  })));
  const batch = builder.buildCalibrationRecommendationBatch(input, {
    recommendationBatchId: 'no-authority-batch',
    createdAt: '2026-07-26T14:00:00.000Z',
    evidenceGates: relaxedGates
  });

  for (const recommendation of batch.recommendations) {
    assert.equal(recommendation.reviewerApproval.approved, false);
    assert.equal(recommendation.experimentReferences.length, 0);
    assert.equal(recommendation.productionImpact, 'none');
    assert.equal(recommendation.decisionImpact, 'none');
    assert.equal(recommendation.proposedBehavior.productionProposal, undefined);
  }
});

test('module does not import production runtime or engine modules', () => {
  const originalLoad = Module._load;
  const loaded = [];
  Module._load = function patchedLoad(request, parent, isMain) {
    loaded.push(request);
    if (request.includes('server') || request.includes('scoutScanner') || request.includes('../engines/') || request.startsWith('../engines')) {
      throw new Error(`Unexpected production import: ${request}`);
    }
    return originalLoad.apply(this, arguments);
  };
  try {
    delete require.cache[require.resolve('../validation/calibrationRecommendationBuilder')];
    const fresh = require('../validation/calibrationRecommendationBuilder');
    assert.equal(typeof fresh.buildCalibrationRecommendationBatch, 'function');
  } finally {
    Module._load = originalLoad;
    delete require.cache[require.resolve('../validation/calibrationRecommendationBuilder')];
    require('../validation/calibrationRecommendationBuilder');
  }
  assert.equal(loaded.some((request) => request.includes('server')), false);
});
