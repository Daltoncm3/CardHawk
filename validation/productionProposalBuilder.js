'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
  asArray,
  asObject,
  unique
} = require('./canonicalValidationCore');
const {
  buildFingerprintFromProjection
} = require('./fingerprintProjection');
const {
  clone,
  firstDefined
} = require('./phase8GovernanceCore');
const productionProposalContract = require('./productionProposalContract');
const shadowExperimentContract = require('./shadowExperimentContract');
const shadowExperimentRunner = require('./shadowExperimentRunner');
const calibrationRecommendationContract = require('./calibrationRecommendationContract');
const calibrationExperimentContract = require('./calibrationExperimentContract');
const calibrationExperimentRunner = require('./calibrationExperimentRunner');

const PRODUCTION_PROPOSAL_BUILDER_SCHEMA_VERSION = '1.0.0';
const PRODUCTION_PROPOSAL_BUILDER_SOURCE = 'production_proposal_builder';
const UNKNOWN_VALUE = 'unknown';

const REQUIRED_BATCH_FIELDS = Object.freeze([
  'schemaVersion',
  'source',
  'proposalBatchId',
  'createdAt',
  'proposals',
  'proposalCount',
  'categorySummary',
  'affectedSubsystemSummary',
  'evidenceSummary',
  'riskSummary',
  'proposalStatusSummary',
  'productionImpact',
  'decisionImpact',
  'executionAuthority',
  'batchFingerprint'
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

function normalizeDate(value, fallback = UNKNOWN_VALUE) {
  if (!known(value)) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function normalizeString(value, fallback = UNKNOWN_VALUE) {
  if (!known(value)) return fallback;
  return String(value).trim() || fallback;
}

function normalizeStringArray(values = []) {
  return unique(asArray(values).map((value) => normalizeString(value, '')).filter(Boolean)).sort();
}

function validationError(code, message, field = '') {
  return { code, message, field };
}

function countBy(items = [], selector = (item) => item) {
  const summary = {};
  for (const item of asArray(items)) {
    const key = normalizeString(selector(item));
    summary[key] = (summary[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(summary).sort(([left], [right]) => left.localeCompare(right)));
}

function normalizeArtifactList(value) {
  return asArray(value).map((item) => item && item.result ? item.result : item).filter(Boolean);
}

function validateArtifactList(artifacts = [], validator, fingerprintBuilder, fingerprintField, prefix) {
  const errors = [];
  const warnings = [];
  const fingerprints = [];
  const ids = [];

  for (const [index, artifact] of normalizeArtifactList(artifacts).entries()) {
    const validation = validator(artifact);
    if (!validation.valid) {
      errors.push(validationError(`invalid_${prefix}`, `${prefix} at index ${index} failed validation.`, `${prefix}.${index}`));
      errors.push(...asArray(validation.errors).map((error) => ({
        ...error,
        field: `${prefix}.${index}.${error.field || ''}`.replace(/\.$/, '')
      })));
    }
    warnings.push(...asArray(validation.warnings).map((warning) => ({
      ...warning,
      field: `${prefix}.${index}.${warning.field || ''}`.replace(/\.$/, '')
    })));
    const actualFingerprint = artifact && artifact[fingerprintField];
    if (known(actualFingerprint)) fingerprints.push(String(actualFingerprint));
    if (known(actualFingerprint) && fingerprintBuilder(artifact) !== actualFingerprint) {
      errors.push(validationError(`${prefix}_fingerprint_mismatch`, `${prefix} fingerprint does not match contents.`, `${prefix}.${index}.${fingerprintField}`));
    }
    const id = firstDefined(
      artifact.recommendationId,
      artifact.experimentId,
      artifact.shadowExperimentId,
      artifact.shadowResultId,
      artifact.resultId
    );
    if (known(id)) ids.push(String(id));
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    ids: normalizeStringArray(ids),
    fingerprints: normalizeStringArray(fingerprints)
  };
}

function validateSourceEvidence(input = {}) {
  const recommendationArtifacts = normalizeArtifactList(firstDefined(input.recommendations, input.recommendation, []));
  const offlineExperimentArtifacts = normalizeArtifactList(firstDefined(input.offlineExperiments, input.offlineExperiment, []));
  const offlineResultArtifacts = normalizeArtifactList(firstDefined(input.offlineExperimentResults, input.offlineExperimentResult, []));
  const shadowExperimentArtifacts = normalizeArtifactList(firstDefined(input.shadowExperiments, input.shadowExperiment, []));
  const shadowResultArtifacts = normalizeArtifactList(firstDefined(input.shadowResults, input.shadowResult, []));

  const recommendationValidation = validateArtifactList(
    recommendationArtifacts,
    calibrationRecommendationContract.validateCalibrationRecommendation,
    calibrationRecommendationContract.buildCalibrationRecommendationFingerprint,
    'recommendationFingerprint',
    'recommendation'
  );
  const offlineExperimentValidation = validateArtifactList(
    offlineExperimentArtifacts,
    calibrationExperimentContract.validateCalibrationExperiment,
    calibrationExperimentContract.buildCalibrationExperimentFingerprint,
    'experimentFingerprint',
    'offlineExperiment'
  );
  const offlineResultValidation = validateArtifactList(
    offlineResultArtifacts,
    (result) => {
      const errors = [];
      const warnings = [];
      for (const field of calibrationExperimentRunner.REQUIRED_RESULT_FIELDS || []) {
        if (!known(result[field])) errors.push(validationError('missing_required_field', `${field} is required.`, field));
      }
      if (result.productionImpact !== 'none') errors.push(validationError('invalid_production_impact', 'Offline result must not affect production.', 'productionImpact'));
      if (result.decisionImpact !== 'none') errors.push(validationError('invalid_decision_impact', 'Offline result must not affect decisions.', 'decisionImpact'));
      if (result.resultFingerprint && calibrationExperimentRunner.buildExperimentResultFingerprint(result) !== result.resultFingerprint) {
        errors.push(validationError('result_fingerprint_mismatch', 'resultFingerprint does not match contents.', 'resultFingerprint'));
      }
      return { valid: errors.length === 0, errors, warnings };
    },
    calibrationExperimentRunner.buildExperimentResultFingerprint,
    'resultFingerprint',
    'offlineResult'
  );
  const shadowExperimentValidation = validateArtifactList(
    shadowExperimentArtifacts,
    shadowExperimentContract.validateShadowExperiment,
    shadowExperimentContract.buildShadowExperimentFingerprint,
    'shadowExperimentFingerprint',
    'shadowExperiment'
  );
  const shadowResultValidation = validateArtifactList(
    shadowResultArtifacts,
    (result) => {
      const errors = [];
      const warnings = [];
      for (const field of shadowExperimentRunner.REQUIRED_SHADOW_RESULT_FIELDS || []) {
        if (!known(result[field])) errors.push(validationError('missing_required_field', `${field} is required.`, field));
      }
      if (result.productionImpact !== 'none') errors.push(validationError('invalid_production_impact', 'Shadow result must not affect production.', 'productionImpact'));
      if (result.decisionImpact !== 'none') errors.push(validationError('invalid_decision_impact', 'Shadow result must not affect decisions.', 'decisionImpact'));
      if (result.shadowResultFingerprint && shadowExperimentRunner.buildShadowResultFingerprint(result) !== result.shadowResultFingerprint) {
        errors.push(validationError('shadow_result_fingerprint_mismatch', 'shadowResultFingerprint does not match contents.', 'shadowResultFingerprint'));
      }
      return { valid: errors.length === 0, errors, warnings };
    },
    shadowExperimentRunner.buildShadowResultFingerprint,
    'shadowResultFingerprint',
    'shadowResult'
  );

  const validations = [
    recommendationValidation,
    offlineExperimentValidation,
    offlineResultValidation,
    shadowExperimentValidation,
    shadowResultValidation
  ];
  const missingEvidenceErrors = [];
  if (recommendationValidation.fingerprints.length === 0) {
    missingEvidenceErrors.push(validationError(
      'missing_recommendation_evidence',
      'Production proposal builder requires at least one calibration recommendation fingerprint.',
      'recommendations'
    ));
  }
  if (shadowResultValidation.fingerprints.length === 0) {
    missingEvidenceErrors.push(validationError(
      'missing_shadow_result_evidence',
      'Production proposal builder requires at least one shadow result fingerprint.',
      'shadowResults'
    ));
  }

  return {
    valid: validations.every((validation) => validation.valid) && missingEvidenceErrors.length === 0,
    errors: [
      ...validations.flatMap((validation) => validation.errors),
      ...missingEvidenceErrors
    ],
    warnings: validations.flatMap((validation) => validation.warnings),
    recommendationArtifacts,
    offlineExperimentArtifacts,
    offlineResultArtifacts,
    shadowExperimentArtifacts,
    shadowResultArtifacts,
    recommendationIds: recommendationValidation.ids,
    recommendationFingerprints: recommendationValidation.fingerprints,
    offlineExperimentIds: normalizeStringArray([
      ...offlineExperimentValidation.ids,
      ...offlineResultArtifacts.map((artifact) => artifact.experimentId).filter(Boolean)
    ]),
    offlineExperimentFingerprints: normalizeStringArray([
      ...offlineExperimentValidation.fingerprints,
      ...offlineResultArtifacts.map((artifact) => artifact.resultFingerprint).filter(Boolean)
    ]),
    shadowExperimentIds: normalizeStringArray([
      ...shadowExperimentValidation.ids,
      ...shadowResultArtifacts.map((artifact) => artifact.shadowExperimentId).filter(Boolean)
    ]),
    shadowExperimentFingerprints: shadowExperimentValidation.fingerprints,
    shadowResultIds: shadowResultValidation.ids,
    shadowResultFingerprints: shadowResultValidation.fingerprints
  };
}

function classifyProposalCategory(input = {}) {
  const explicit = normalizeString(input.proposalCategory, '');
  if (productionProposalContract.PROPOSAL_CATEGORIES.includes(explicit)) return explicit;

  const recommendation = normalizeArtifactList(firstDefined(input.recommendations, input.recommendation, []))[0] || {};
  const category = recommendation.recommendationCategory;
  const mapping = {
    identity_parsing_improvement: 'identity_parser_change',
    canonical_identity_improvement: 'canonical_identity_change',
    evidence_sufficiency_adjustment: 'evidence_rule_change',
    valuation_methodology_adjustment: 'valuation_methodology_change',
    confidence_calibration_adjustment: 'confidence_calibration_change',
    risk_rule_adjustment: 'risk_rule_change',
    grading_or_quality_adjustment: 'grading_quality_change',
    deal_gate_rule_review: 'deal_gate_change',
    buy_now_threshold_review: 'buy_now_change',
    notification_threshold_review: 'notification_change',
    false_positive_reduction: 'risk_rule_change',
    missed_opportunity_reduction: 'risk_rule_change',
    diagnostic_improvement: 'diagnostic_change',
    no_change_recommendation: 'no_change',
    insufficient_data_finding: 'other'
  };
  if (mapping[category]) return mapping[category];

  const shadowResult = normalizeArtifactList(firstDefined(input.shadowResults, input.shadowResult, []))[0] || {};
  const recommendationText = normalizeString(shadowResult.recommendation, '');
  if (recommendationText.includes('no_change') || recommendationText.includes('continue')) return 'no_change';
  return 'other';
}

function determineAffectedSubsystem(input = {}) {
  const explicit = normalizeString(firstDefined(input.affectedSubsystem, input.targetSubsystem), '');
  if (explicit) return explicit;
  const recommendation = normalizeArtifactList(firstDefined(input.recommendations, input.recommendation, []))[0] || {};
  if (known(recommendation.affectedSubsystem)) return String(recommendation.affectedSubsystem);
  const shadowExperiment = normalizeArtifactList(firstDefined(input.shadowExperiments, input.shadowExperiment, []))[0] || {};
  if (known(shadowExperiment.targetSubsystem)) return String(shadowExperiment.targetSubsystem);
  return UNKNOWN_VALUE;
}

function buildSupportingEvidenceSummary(input = {}) {
  const evidence = validateSourceEvidence(input);
  const shadowResults = evidence.shadowResultArtifacts;
  const offlineResults = evidence.offlineResultArtifacts;
  const recommendations = evidence.recommendationArtifacts;
  const successStatuses = countBy(shadowResults, (result) => result.successEvaluation?.status || UNKNOWN_VALUE);
  const failureStatuses = countBy(shadowResults, (result) => result.failureEvaluation?.status || UNKNOWN_VALUE);
  const regressionStatuses = countBy(shadowResults, (result) => result.regressionEvaluation?.status || UNKNOWN_VALUE);
  const noBlockingShadowFailure = shadowResults.every((result) => (
    result.failureEvaluation?.status !== 'triggered' &&
    result.regressionEvaluation?.status !== 'failed'
  ));

  return deepFreeze({
    recommendationCount: recommendations.length,
    offlineExperimentResultCount: offlineResults.length,
    shadowExperimentCount: evidence.shadowExperimentArtifacts.length,
    shadowResultCount: shadowResults.length,
    sourceRecommendationFingerprints: evidence.recommendationFingerprints,
    sourceOfflineExperimentFingerprints: evidence.offlineExperimentFingerprints,
    sourceShadowExperimentFingerprints: evidence.shadowExperimentFingerprints,
    sourceShadowResultFingerprints: evidence.shadowResultFingerprints,
    successStatuses,
    failureStatuses,
    regressionStatuses,
    noBlockingShadowFailure,
    evidenceComplete: evidence.valid &&
      evidence.recommendationFingerprints.length > 0 &&
      evidence.shadowResultFingerprints.length > 0,
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  });
}

function buildProposalId(input = {}, evidence = {}) {
  return normalizeString(firstDefined(
    input.proposalId,
    `production-proposal-${determineAffectedSubsystem(input)}-${evidence.shadowResultIds[0] || evidence.recommendationIds[0] || 'draft'}`
  ));
}

function buildProductionProposal(input = {}, options = {}) {
  const evidence = validateSourceEvidence(input);
  const evidenceSummary = buildSupportingEvidenceSummary(input);
  const proposalCategory = classifyProposalCategory(input);
  const affectedSubsystem = determineAffectedSubsystem(input);
  const recommendation = evidence.recommendationArtifacts[0] || {};
  const shadowResult = evidence.shadowResultArtifacts[0] || {};
  const evidenceComplete = evidenceSummary.evidenceComplete;
  const proposalStatus = normalizeString(firstDefined(
    input.proposalStatus,
    evidenceComplete ? productionProposalContract.PRODUCTION_PROPOSAL_STATUSES.READY_FOR_REVIEW : productionProposalContract.PRODUCTION_PROPOSAL_STATUSES.EVIDENCE_INCOMPLETE
  ));

  const proposal = productionProposalContract.createProductionProposal({
    proposalId: buildProposalId(input, evidence),
    proposalBatchId: normalizeString(firstDefined(input.proposalBatchId, options.proposalBatchId, 'production-proposal-batch')),
    createdAt: normalizeDate(firstDefined(input.createdAt, options.createdAt, UNKNOWN_VALUE)),
    expiresAt: firstDefined(input.expiresAt, options.expiresAt, UNKNOWN_VALUE),
    sourceRecommendationIds: evidence.recommendationIds,
    sourceRecommendationFingerprints: evidence.recommendationFingerprints,
    sourceOfflineExperimentIds: evidence.offlineExperimentIds,
    sourceOfflineExperimentFingerprints: evidence.offlineExperimentFingerprints,
    sourceShadowExperimentIds: evidence.shadowExperimentIds,
    sourceShadowExperimentFingerprints: evidence.shadowExperimentFingerprints,
    sourceShadowResultIds: evidence.shadowResultIds,
    sourceShadowResultFingerprints: evidence.shadowResultFingerprints,
    affectedSubsystem,
    affectedRuleOrField: normalizeString(firstDefined(input.affectedRuleOrField, recommendation.affectedRuleOrField, shadowResult.observationSummary?.targetRuleOrField)),
    proposalCategory,
    currentBehavior: clone(asObject(firstDefined(input.currentBehavior, recommendation.currentBehavior, shadowResult.productionBaselineMetrics))),
    proposedBehavior: clone(asObject(firstDefined(input.proposedBehavior, recommendation.proposedBehavior, shadowResult.shadowMetrics))),
    proposedCodeOrConfigurationChange: clone(asObject(input.proposedCodeOrConfigurationChange)),
    expectedBenefit: clone(asObject(firstDefined(input.expectedBenefit, recommendation.expectedBenefit, { recommendation: shadowResult.recommendation }))),
    supportingEvidence: clone(firstDefined(input.supportingEvidence, evidenceSummary)),
    counterEvidence: asArray(firstDefined(input.counterEvidence, recommendation.counterEvidence, [])).map((item) => clone(item)),
    sampleSize: clone(asObject(firstDefined(input.sampleSize, recommendation.sampleSize, shadowResult.statisticalSummary))),
    coverage: clone(asObject(firstDefined(input.coverage, recommendation.coverage, shadowResult.observationSummary))),
    confidence: firstDefined(input.confidence, recommendation.confidence, UNKNOWN_VALUE),
    confidenceLevel: firstDefined(input.confidenceLevel, recommendation.confidenceLevel, UNKNOWN_VALUE),
    identifiedRisks: asArray(firstDefined(input.identifiedRisks, recommendation.identifiedRisks, [])).map((item) => clone(item)),
    knownLimitations: asArray(firstDefined(input.knownLimitations, shadowResult.limitations, [])).map((item) => clone(item)),
    regressionRisks: asArray(firstDefined(input.regressionRisks, shadowResult.regressions, [])).map((item) => clone(item)),
    deploymentPrerequisites: asArray(input.deploymentPrerequisites).map((item) => clone(item)),
    validationChecklist: asArray(firstDefined(input.validationChecklist, recommendation.validationPlan ? [recommendation.validationPlan] : [])).map((item) => clone(item)),
    requiredTestEvidence: asArray(input.requiredTestEvidence).map((item) => clone(item)),
    monitoringPlan: clone(asObject(input.monitoringPlan)),
    rollbackPlan: clone(asObject(firstDefined(input.rollbackPlan, recommendation.rollbackPlan))),
    approvalRequirements: asArray(firstDefined(input.approvalRequirements, [{ approver: 'Dalton', required: true }])).map((item) => clone(item)),
    productionApprovalArtifact: clone(asObject(input.productionApprovalArtifact)),
    deploymentValidationReference: clone(asObject(input.deploymentValidationReference)),
    supportingEvidenceReferences: [
      ...asArray(input.supportingEvidenceReferences).map((reference) => clone(reference)),
      ...evidence.recommendationFingerprints.map((fingerprint, index) => ({
        referenceId: `recommendation-${index + 1}`,
        referenceType: 'calibration_recommendation',
        sourceId: evidence.recommendationIds[index] || UNKNOWN_VALUE,
        sourceFingerprint: fingerprint,
        evidenceStatus: 'available'
      })),
      ...evidence.offlineExperimentFingerprints.map((fingerprint, index) => ({
        referenceId: `offline-experiment-result-${index + 1}`,
        referenceType: 'offline_experiment_result',
        sourceId: evidence.offlineExperimentIds[index] || UNKNOWN_VALUE,
        sourceFingerprint: fingerprint,
        evidenceStatus: 'available'
      })),
      ...evidence.shadowResultFingerprints.map((fingerprint, index) => ({
        referenceId: `shadow-result-${index + 1}`,
        referenceType: 'shadow_result_artifact',
        sourceId: evidence.shadowResultIds[index] || UNKNOWN_VALUE,
        sourceFingerprint: fingerprint,
        evidenceStatus: 'available'
      }))
    ],
    auditHistory: asArray(input.auditHistory).length
      ? input.auditHistory
      : [{
          eventId: `${buildProposalId(input, evidence)}-created`,
          eventType: 'proposal_built',
          actor: normalizeString(firstDefined(input.createdBy, options.createdBy, 'production_proposal_builder')),
          eventAt: normalizeDate(firstDefined(input.createdAt, options.createdAt, UNKNOWN_VALUE)),
          priorStatus: UNKNOWN_VALUE,
          nextStatus: proposalStatus,
          reason: evidenceComplete ? 'shadow_evidence_packaged' : 'evidence_incomplete'
        }],
    proposalStatus
  });

  return deepFreeze({
    proposal,
    validation: {
      sourceEvidence: {
        valid: evidence.valid,
        errors: evidence.errors,
        warnings: evidence.warnings
      },
      proposal: productionProposalContract.validateProductionProposal(proposal)
    },
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  });
}

function sortProductionProposals(proposals = []) {
  return asArray(proposals)
    .map((proposal) => clone(proposal && proposal.proposal ? proposal.proposal : proposal))
    .sort((left, right) => {
      const status = String(left.proposalStatus).localeCompare(String(right.proposalStatus));
      if (status !== 0) return status;
      const subsystem = String(left.affectedSubsystem).localeCompare(String(right.affectedSubsystem));
      if (subsystem !== 0) return subsystem;
      return String(left.proposalId).localeCompare(String(right.proposalId));
    });
}

function buildProductionProposalBatchFingerprint(batch = {}) {
  const projection = clone(batch);
  delete projection.batchFingerprint;
  delete projection.productionProposalBatchFingerprint;
  return buildFingerprintFromProjection(projection);
}

function summarizeProductionProposalBatch(batchOrProposals = {}) {
  const proposals = Array.isArray(batchOrProposals)
    ? sortProductionProposals(batchOrProposals)
    : sortProductionProposals(batchOrProposals.proposals);
  const proposalValidations = proposals.map((proposal) => productionProposalContract.validateProductionProposal(proposal));
  return deepFreeze({
    proposalCount: proposals.length,
    categorySummary: countBy(proposals, (proposal) => proposal.proposalCategory),
    affectedSubsystemSummary: countBy(proposals, (proposal) => proposal.affectedSubsystem),
    evidenceSummary: {
      proposalsWithRecommendationEvidence: proposals.filter((proposal) => proposal.sourceRecommendationFingerprints.length > 0).length,
      proposalsWithShadowResultEvidence: proposals.filter((proposal) => proposal.sourceShadowResultFingerprints.length > 0).length,
      proposalsWithMissingEvidence: proposalValidations.filter((validation) => validation.reasonCodes.includes('missing_shadow_result_evidence')).length,
      productionImpact: 'none',
      decisionImpact: 'none',
      executionAuthority: 'none'
    },
    riskSummary: {
      identifiedRiskCount: proposals.reduce((total, proposal) => total + proposal.identifiedRisks.length, 0),
      regressionRiskCount: proposals.reduce((total, proposal) => total + proposal.regressionRisks.length, 0),
      knownLimitationCount: proposals.reduce((total, proposal) => total + proposal.knownLimitations.length, 0)
    },
    proposalStatusSummary: countBy(proposals, (proposal) => proposal.proposalStatus),
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  });
}

function buildProductionProposalBatch(inputs = {}, options = {}) {
  const proposalInputs = Array.isArray(inputs) ? inputs : asArray(firstDefined(inputs.proposals, inputs.proposalInputs, inputs));
  const built = proposalInputs.map((input) => buildProductionProposal(input, options));
  const proposals = sortProductionProposals(built.map((item) => item.proposal));
  const summary = summarizeProductionProposalBatch(proposals);
  const core = {
    schemaVersion: PRODUCTION_PROPOSAL_BUILDER_SCHEMA_VERSION,
    source: PRODUCTION_PROPOSAL_BUILDER_SOURCE,
    proposalBatchId: normalizeString(firstDefined(options.proposalBatchId, inputs.proposalBatchId, proposals[0]?.proposalBatchId, 'production-proposal-batch')),
    createdAt: normalizeDate(firstDefined(options.createdAt, inputs.createdAt, UNKNOWN_VALUE)),
    proposals,
    proposalCount: proposals.length,
    categorySummary: summary.categorySummary,
    affectedSubsystemSummary: summary.affectedSubsystemSummary,
    evidenceSummary: summary.evidenceSummary,
    riskSummary: summary.riskSummary,
    proposalStatusSummary: summary.proposalStatusSummary,
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };

  return deepFreeze({
    ...core,
    batchFingerprint: buildProductionProposalBatchFingerprint(core)
  });
}

function validateProductionProposalBatch(batch = {}) {
  const errors = [];
  const warnings = [];
  const invalidProposalIndexes = [];
  const missingEvidence = [];
  const authorityBoundaryViolations = [];
  const fingerprintMismatches = [];
  const missingRequiredFields = REQUIRED_BATCH_FIELDS.filter((field) => !known(batch[field]));

  for (const field of missingRequiredFields) {
    errors.push(validationError('missing_required_field', `${field} is required.`, field));
  }
  if (batch.schemaVersion !== PRODUCTION_PROPOSAL_BUILDER_SCHEMA_VERSION) {
    errors.push(validationError('invalid_schema_version', 'schemaVersion must match Production Proposal Builder schema.', 'schemaVersion'));
  }
  if (batch.source !== PRODUCTION_PROPOSAL_BUILDER_SOURCE) {
    errors.push(validationError('invalid_source', 'source must be production_proposal_builder.', 'source'));
  }
  if (!Array.isArray(batch.proposals)) {
    errors.push(validationError('invalid_proposals', 'proposals must be an array.', 'proposals'));
  }
  if (batch.productionImpact !== 'none' || batch.decisionImpact !== 'none' || batch.executionAuthority !== 'none') {
    const error = validationError('invalid_batch_authority', 'Proposal batches must not carry production authority.', 'authority');
    errors.push(error);
    authorityBoundaryViolations.push(error);
  }

  for (const [index, proposal] of asArray(batch.proposals).entries()) {
    const validation = productionProposalContract.validateProductionProposal(proposal);
    if (!validation.valid) {
      invalidProposalIndexes.push(index);
      errors.push(validationError('invalid_proposal', `Proposal at index ${index} failed validation.`, `proposals.${index}`));
      errors.push(...validation.errors.map((error) => ({
        ...error,
        field: `proposals.${index}.${error.field || ''}`.replace(/\.$/, '')
      })));
    }
    warnings.push(...validation.warnings.map((warning) => ({
      ...warning,
      field: `proposals.${index}.${warning.field || ''}`.replace(/\.$/, '')
    })));
    missingEvidence.push(...validation.invalidSourceReferences.map((reference) => ({
      ...reference,
      field: `proposals.${index}.${reference.field || ''}`.replace(/\.$/, '')
    })));
    if (validation.invalidSourceReferences.length > 0) {
      errors.push(validationError('proposal_missing_required_evidence', `Proposal at index ${index} is missing required source evidence.`, `proposals.${index}`));
      invalidProposalIndexes.push(index);
    }
    authorityBoundaryViolations.push(...validation.authorityBoundaryViolations.map((error) => ({
      ...error,
      field: `proposals.${index}.${error.field || ''}`.replace(/\.$/, '')
    })));
    fingerprintMismatches.push(...validation.fingerprintMismatches.map((error) => ({
      ...error,
      field: `proposals.${index}.${error.field || ''}`.replace(/\.$/, '')
    })));
  }

  if (known(batch.batchFingerprint) && buildProductionProposalBatchFingerprint(batch) !== batch.batchFingerprint) {
    const error = validationError('batch_fingerprint_mismatch', 'batchFingerprint does not match batch contents.', 'batchFingerprint');
    errors.push(error);
    fingerprintMismatches.push(error);
  }

  const reasonCodes = unique([
    ...errors.map((error) => error.code),
    ...warnings.map((warning) => warning.code)
  ]);

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes,
    invalidProposalIndexes: [...new Set(invalidProposalIndexes)].sort((left, right) => left - right),
    missingEvidence,
    authorityBoundaryViolations,
    fingerprintMismatches
  };
}

function filterProductionProposals(proposals = [], criteria = {}) {
  const filters = asObject(criteria);
  return sortProductionProposals(proposals).filter((proposal) => {
    if (known(filters.proposalStatus) && proposal.proposalStatus !== filters.proposalStatus) return false;
    if (known(filters.proposalCategory) && proposal.proposalCategory !== filters.proposalCategory) return false;
    if (known(filters.affectedSubsystem) && proposal.affectedSubsystem !== filters.affectedSubsystem) return false;
    if (filters.requiresShadowEvidence === true && proposal.sourceShadowResultFingerprints.length === 0) return false;
    if (filters.requiresRecommendationEvidence === true && proposal.sourceRecommendationFingerprints.length === 0) return false;
    return true;
  });
}

function exportProductionProposalBatch(batch = {}, outputPath = null) {
  const serialized = `${JSON.stringify(batch, null, 2)}\n`;
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, serialized);
  }
  return serialized;
}

function importProductionProposalBatch(input) {
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) return {};
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) return JSON.parse(trimmed);
    return JSON.parse(fs.readFileSync(trimmed, 'utf8'));
  }
  return clone(input);
}

module.exports = {
  PRODUCTION_PROPOSAL_BUILDER_SCHEMA_VERSION,
  PRODUCTION_PROPOSAL_BUILDER_SOURCE,
  REQUIRED_BATCH_FIELDS,
  UNKNOWN_VALUE,
  buildProductionProposal,
  buildProductionProposalBatch,
  buildProductionProposalBatchFingerprint,
  buildSupportingEvidenceSummary,
  classifyProposalCategory,
  determineAffectedSubsystem,
  exportProductionProposalBatch,
  filterProductionProposals,
  importProductionProposalBatch,
  sortProductionProposals,
  summarizeProductionProposalBatch,
  validateProductionProposalBatch
};
