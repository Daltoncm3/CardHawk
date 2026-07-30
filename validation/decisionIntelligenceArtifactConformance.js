'use strict';

const { asArray, asObject, unique } = require('./canonicalValidationCore');
const { buildFingerprintFromProjection } = require('./fingerprintProjection');
const { clone, firstDefined } = require('./phase8GovernanceCore');
const {
  DECISION_INTELLIGENCE_ARTIFACT_SCHEMA_VERSION,
  EXPECTED_SIGNAL_NAMES,
  buildDecisionIntelligenceArtifact,
  buildDecisionIntelligenceArtifactFingerprint,
  summarizeDecisionArtifact,
  validateDecisionIntelligenceArtifact
} = require('./decisionIntelligenceArtifactBuilder');

const DECISION_INTELLIGENCE_CONFORMANCE_SCHEMA_VERSION = '1.0.0';
const DECISION_INTELLIGENCE_CONFORMANCE_SOURCE = 'decision_intelligence_artifact_conformance';
const UNKNOWN_VALUE = 'unknown';

const CONFORMANCE_STAGES = Object.freeze([
  'schema_and_required_fields',
  'immutability',
  'fingerprint_integrity',
  'provenance_integrity',
  'advisory_boundary',
  'reference_integrity',
  'deterministic_construction',
  'unknown_value_preservation',
  'evidence_gap_preservation',
  'explanation_completeness',
  'governance_binding_compatibility'
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

function normalizeString(value, fallback = UNKNOWN_VALUE) {
  if (!known(value)) return fallback;
  return String(value).trim() || fallback;
}

function normalizeDate(value, fallback = UNKNOWN_VALUE) {
  if (!known(value)) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function validationIssue(code, message, field = '') {
  return { code, message, field };
}

function summarizeIssues(errors = [], warnings = []) {
  return unique([...asArray(errors), ...asArray(warnings)].map((issue) => issue.code)).sort();
}

function buildConformanceFingerprint(report = {}) {
  const projection = clone(report);
  delete projection.conformanceFingerprint;
  return buildFingerprintFromProjection(projection);
}

function buildStageResult(stageName, validation = {}, extras = {}) {
  const errors = asArray(validation.errors);
  const warnings = asArray(validation.warnings);
  return deepFreeze({
    stageName,
    valid: validation.valid !== false && errors.length === 0,
    status: validation.valid !== false && errors.length === 0 ? 'passed' : 'failed',
    errors: clone(errors),
    warnings: clone(warnings),
    reasonCodes: summarizeIssues(errors, warnings),
    ...clone(asObject(extras))
  });
}

function stableEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function pathIsFrozen(root, path) {
  const parts = path.split('.');
  let current = root;
  for (const part of parts) {
    if (!current || typeof current !== 'object') return false;
    current = current[part];
  }
  return Boolean(current && typeof current === 'object' && Object.isFrozen(current));
}

function validateSchemaAndRequiredFields(artifact = {}) {
  const validation = validateDecisionIntelligenceArtifact(artifact);
  const errors = [];
  const warnings = [];
  const schemaViolations = [];

  errors.push(...asArray(validation.errors).filter((issue) => [
    'missing_required_field',
    'invalid_schema_version',
    'invalid_source'
  ].includes(issue.code)));
  warnings.push(...asArray(validation.warnings).filter((issue) => issue.code === 'unknown_schema_version'));

  if (asObject(artifact).artifactType !== 'decision_intelligence_assessment') {
    errors.push(validationIssue('invalid_artifact_type', 'artifactType must be decision_intelligence_assessment.', 'artifactType'));
  }
  if (asObject(artifact).schemaVersion !== DECISION_INTELLIGENCE_ARTIFACT_SCHEMA_VERSION) {
    schemaViolations.push('schemaVersion');
  }
  if (asArray(validation.missingRequiredFields).length) {
    schemaViolations.push(...validation.missingRequiredFields);
  }

  return deepFreeze({
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes: summarizeIssues(errors, warnings),
    schemaViolations: unique(schemaViolations).sort(),
    missingRequiredFields: clone(asArray(validation.missingRequiredFields))
  });
}

function validateImmutability(artifact = {}) {
  const errors = [];
  const warnings = [];
  const immutableViolations = [];
  const requiredFrozenPaths = [
    '',
    'listingRef',
    'canonicalIdentityRef',
    'signalRefs',
    'valuationRefs',
    'productionDecisionRef',
    'dealGateRef',
    'buyNowRef',
    'confidenceInterpretation',
    'evidenceQualityAssessment',
    'comparableQualityAssessment',
    'agreementAnalysis',
    'riskAssessment',
    'opportunityAssessment',
    'explanationSummary',
    'advisoryRecommendation',
    'supportingReasons',
    'opposingReasons',
    'unknownValues',
    'outstandingEvidenceGaps',
    'provenance',
    'immutability',
    'compatibility'
  ];

  for (const path of requiredFrozenPaths) {
    const frozen = path ? pathIsFrozen(artifact, path) : Object.isFrozen(artifact);
    if (!frozen) {
      errors.push(validationIssue('artifact_not_immutable', `${path || 'artifact'} must be immutable.`, path || 'artifact'));
      immutableViolations.push(path || 'artifact');
    }
  }

  if (asObject(artifact.immutability).immutable !== true) {
    errors.push(validationIssue('immutability_flag_missing', 'immutability.immutable must be true.', 'immutability.immutable'));
    immutableViolations.push('immutability.immutable');
  }
  if (asObject(artifact.immutability).mutationPolicy !== 'new_artifact_required') {
    warnings.push(validationIssue('mutation_policy_not_canonical', 'immutability.mutationPolicy should be new_artifact_required.', 'immutability.mutationPolicy'));
  }

  return deepFreeze({
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes: summarizeIssues(errors, warnings),
    immutableViolations: unique(immutableViolations).sort()
  });
}

function validateFingerprintIntegrity(artifact = {}) {
  const validation = validateDecisionIntelligenceArtifact(artifact);
  const errors = [];
  const warnings = [];
  const fingerprintViolations = [];

  for (const error of asArray(validation.errors)) {
    if (error.code.includes('fingerprint')) errors.push(error);
  }
  for (const warning of asArray(validation.warnings)) {
    if (warning.code.includes('fingerprint')) warnings.push(warning);
  }
  fingerprintViolations.push(...asArray(validation.fingerprintViolations));

  if (!known(artifact.artifactFingerprint)) {
    errors.push(validationIssue('artifact_fingerprint_missing', 'artifactFingerprint is required.', 'artifactFingerprint'));
    fingerprintViolations.push('artifactFingerprint');
  } else if (buildDecisionIntelligenceArtifactFingerprint(artifact) !== artifact.artifactFingerprint) {
    errors.push(validationIssue('artifact_fingerprint_mismatch', 'artifactFingerprint does not match artifact contents.', 'artifactFingerprint'));
    fingerprintViolations.push('artifactFingerprint');
  }

  const summary = summarizeDecisionArtifact(artifact);
  const secondSummary = summarizeDecisionArtifact(artifact);
  if (!stableEqual(summary, secondSummary)) {
    errors.push(validationIssue('summary_not_deterministic', 'Artifact summary changed across repeated calls.', 'summary'));
    fingerprintViolations.push('summary');
  }

  return deepFreeze({
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes: summarizeIssues(errors, warnings),
    fingerprintViolations: unique(fingerprintViolations).sort()
  });
}

function validateProvenanceIntegrity(artifact = {}) {
  const input = asObject(artifact);
  const provenance = asObject(input.provenance);
  const errors = [];
  const warnings = [];
  const provenanceViolations = [];

  for (const field of ['sourceSystem', 'builderName', 'builderVersion', 'createdAt', 'capturedAt']) {
    if (!known(provenance[field]) || provenance[field] === UNKNOWN_VALUE) {
      errors.push(validationIssue('provenance_field_missing', `provenance.${field} is required for conformance.`, `provenance.${field}`));
      provenanceViolations.push(`provenance.${field}`);
    }
  }
  if (provenance.builderName !== 'decision_intelligence_artifact_builder') {
    errors.push(validationIssue('invalid_provenance_builder', 'provenance.builderName must identify the artifact builder.', 'provenance.builderName'));
    provenanceViolations.push('provenance.builderName');
  }
  if (!asArray(provenance.inputFingerprints).length) {
    warnings.push(validationIssue('provenance_input_fingerprints_missing', 'Provenance should preserve input fingerprints for Governance binding.', 'provenance.inputFingerprints'));
    provenanceViolations.push('provenance.inputFingerprints');
  }
  if (!asArray(provenance.inputArtifactIds).length) {
    warnings.push(validationIssue('provenance_input_artifact_ids_missing', 'Provenance should preserve input artifact IDs for Governance binding.', 'provenance.inputArtifactIds'));
    provenanceViolations.push('provenance.inputArtifactIds');
  }

  return deepFreeze({
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes: summarizeIssues(errors, warnings),
    provenanceViolations: unique(provenanceViolations).sort()
  });
}

function validateAdvisoryOnlyBoundaries(artifact = {}) {
  const validation = validateDecisionIntelligenceArtifact(artifact);
  const errors = [];
  const warnings = [];
  const authorityViolations = [];

  for (const error of asArray(validation.errors)) {
    if (error.code.includes('authority')) errors.push(error);
  }
  authorityViolations.push(...asArray(validation.authorityViolations));

  const text = JSON.stringify(artifact);
  if (text.includes('"purchaseAuthority":"approved"') || text.includes('"executionAuthority":"approved"')) {
    errors.push(validationIssue('forbidden_authority_value', 'Artifact contains forbidden approval authority values.', 'artifact'));
    authorityViolations.push('artifact');
  }
  if (asObject(artifact.advisoryRecommendation).recommendationType === 'BUY_NOW') {
    errors.push(validationIssue('buy_now_recommendation_authority', 'Artifact must not emit BUY_NOW as an advisory recommendation type.', 'advisoryRecommendation.recommendationType'));
    authorityViolations.push('advisoryRecommendation.recommendationType');
  }

  return deepFreeze({
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes: summarizeIssues(errors, warnings),
    authorityViolations: unique(authorityViolations).sort()
  });
}

function validateReferenceIntegrity(artifact = {}, options = {}) {
  const input = asObject(artifact);
  const errors = [];
  const warnings = [];
  const referenceViolations = [];
  const signalRefs = asArray(input.signalRefs);
  const expectedSignalNames = asArray(firstDefined(options.expectedSignalNames, EXPECTED_SIGNAL_NAMES));
  const presentSignals = new Set(signalRefs.map((signal) => signal.signalName));

  if (!known(asObject(input.listingRef).listingId)) {
    errors.push(validationIssue('listing_reference_missing', 'listingRef.listingId is required.', 'listingRef.listingId'));
    referenceViolations.push('listingRef.listingId');
  }
  if (!known(asObject(input.canonicalIdentityRef).canonicalIdentityId)) {
    warnings.push(validationIssue('canonical_identity_reference_missing', 'canonicalIdentityRef should preserve canonicalIdentityId.', 'canonicalIdentityRef.canonicalIdentityId'));
    referenceViolations.push('canonicalIdentityRef.canonicalIdentityId');
  }
  if (!known(asObject(input.productionDecisionRef).decisionEngineFingerprint)) {
    warnings.push(validationIssue('decision_reference_fingerprint_missing', 'productionDecisionRef should preserve decisionEngineFingerprint.', 'productionDecisionRef.decisionEngineFingerprint'));
    referenceViolations.push('productionDecisionRef.decisionEngineFingerprint');
  }
  if (!known(asObject(input.dealGateRef).dealGateFingerprint)) {
    warnings.push(validationIssue('deal_gate_reference_fingerprint_missing', 'dealGateRef should preserve dealGateFingerprint.', 'dealGateRef.dealGateFingerprint'));
    referenceViolations.push('dealGateRef.dealGateFingerprint');
  }

  signalRefs.forEach((signal, index) => {
    if (!known(signal.signalName)) {
      errors.push(validationIssue('signal_reference_name_missing', 'Signal reference must preserve signalName.', `signalRefs.${index}.signalName`));
      referenceViolations.push(`signalRefs.${index}.signalName`);
    }
    if (!known(signal.signalFingerprint)) {
      warnings.push(validationIssue('signal_reference_fingerprint_missing', 'Signal reference should preserve signalFingerprint.', `signalRefs.${index}.signalFingerprint`));
      referenceViolations.push(`signalRefs.${index}.signalFingerprint`);
    }
  });

  const missingSignals = expectedSignalNames.filter((signalName) => !presentSignals.has(signalName)).sort();
  if (missingSignals.length) {
    warnings.push(validationIssue('expected_signal_reference_missing', 'One or more expected Signal references are missing.', 'signalRefs'));
    referenceViolations.push(...missingSignals.map((signalName) => `signalRefs.${signalName}`));
  }

  return deepFreeze({
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes: summarizeIssues(errors, warnings),
    referenceViolations: unique(referenceViolations).sort(),
    missingSignals
  });
}

function validateDeterministicConstruction(artifact = {}, options = {}) {
  const errors = [];
  const warnings = [];
  const deterministicViolations = [];

  if (options.sourceInput) {
    const first = buildDecisionIntelligenceArtifact(options.sourceInput);
    const second = buildDecisionIntelligenceArtifact(options.sourceInput);
    if (!stableEqual(first, second)) {
      errors.push(validationIssue('builder_not_deterministic', 'Builder output changed across repeated construction.', 'sourceInput'));
      deterministicViolations.push('sourceInput');
    }
    if (known(artifact.artifactFingerprint) && first.artifactFingerprint !== artifact.artifactFingerprint) {
      errors.push(validationIssue('artifact_not_reproducible', 'Supplied sourceInput does not reproduce the artifact fingerprint.', 'artifactFingerprint'));
      deterministicViolations.push('artifactFingerprint');
    }
  } else {
    const firstSummary = summarizeDecisionArtifact(artifact);
    const secondSummary = summarizeDecisionArtifact(artifact);
    if (!stableEqual(firstSummary, secondSummary)) {
      errors.push(validationIssue('summary_not_deterministic', 'Summary changed across repeated calls.', 'summary'));
      deterministicViolations.push('summary');
    }
    warnings.push(validationIssue('source_input_not_supplied', 'sourceInput was not supplied; full reconstruction determinism could not be proven.', 'sourceInput'));
  }

  return deepFreeze({
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes: summarizeIssues(errors, warnings),
    deterministicViolations: unique(deterministicViolations).sort()
  });
}

function validateUnknownValuePreservation(artifact = {}) {
  const errors = [];
  const warnings = [];
  const unknownValueViolations = [];

  asArray(artifact.unknownValues).forEach((unknown, index) => {
    if (!known(unknown.field)) {
      errors.push(validationIssue('unknown_value_field_missing', 'Unknown value entries must identify the unknown field.', `unknownValues.${index}.field`));
      unknownValueViolations.push(`unknownValues.${index}.field`);
    }
    if (!known(unknown.reason)) {
      warnings.push(validationIssue('unknown_value_reason_missing', 'Unknown value entries should preserve a reason.', `unknownValues.${index}.reason`));
      unknownValueViolations.push(`unknownValues.${index}.reason`);
    }
  });

  const serialized = JSON.stringify(artifact);
  if (!asArray(artifact.unknownValues).length && serialized.includes(UNKNOWN_VALUE)) {
    warnings.push(validationIssue('implicit_unknown_values_present', 'Artifact contains unknown markers but no top-level unknownValues entries.', 'unknownValues'));
  }

  return deepFreeze({
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes: summarizeIssues(errors, warnings),
    unknownValueViolations: unique(unknownValueViolations).sort()
  });
}

function validateEvidenceGapPreservation(artifact = {}) {
  const errors = [];
  const warnings = [];
  const evidenceGapViolations = [];

  asArray(artifact.outstandingEvidenceGaps).forEach((gap, index) => {
    if (!known(gap.description)) {
      errors.push(validationIssue('evidence_gap_description_missing', 'Evidence gaps must include a description.', `outstandingEvidenceGaps.${index}.description`));
      evidenceGapViolations.push(`outstandingEvidenceGaps.${index}.description`);
    }
    if (!known(gap.reviewImpact)) {
      warnings.push(validationIssue('evidence_gap_review_impact_missing', 'Evidence gaps should describe review impact.', `outstandingEvidenceGaps.${index}.reviewImpact`));
      evidenceGapViolations.push(`outstandingEvidenceGaps.${index}.reviewImpact`);
    }
  });

  const missingSignalGaps = asArray(artifact.outstandingEvidenceGaps)
    .filter((gap) => known(gap.missingSignalName) && gap.missingSignalName !== UNKNOWN_VALUE)
    .map((gap) => gap.missingSignalName)
    .sort();

  return deepFreeze({
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes: summarizeIssues(errors, warnings),
    evidenceGapViolations: unique(evidenceGapViolations).sort(),
    missingSignalGaps
  });
}

function validateExplanationCompleteness(artifact = {}) {
  const explanation = asObject(artifact.explanationSummary);
  const errors = [];
  const warnings = [];
  const explanationViolations = [];

  if (!known(explanation.headline) || explanation.headline === UNKNOWN_VALUE) {
    warnings.push(validationIssue('explanation_headline_missing', 'Explanation should preserve a headline when available.', 'explanationSummary.headline'));
    explanationViolations.push('explanationSummary.headline');
  }
  if (!asArray(explanation.decisionTrace).length) {
    errors.push(validationIssue('decision_trace_missing', 'Explanation must include a decision trace.', 'explanationSummary.decisionTrace'));
    explanationViolations.push('explanationSummary.decisionTrace');
  }
  asArray(explanation.decisionTrace).forEach((trace, index) => {
    if (!known(trace.message)) {
      errors.push(validationIssue('decision_trace_message_missing', 'Decision trace entries must include a message.', `explanationSummary.decisionTrace.${index}.message`));
      explanationViolations.push(`explanationSummary.decisionTrace.${index}.message`);
    }
  });

  if (!asArray(artifact.supportingReasons).length && !asArray(artifact.opposingReasons).length) {
    warnings.push(validationIssue('decision_reasons_missing', 'Artifact should preserve supporting or opposing reasons.', 'supportingReasons'));
    explanationViolations.push('supportingReasons');
  }

  return deepFreeze({
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes: summarizeIssues(errors, warnings),
    explanationViolations: unique(explanationViolations).sort()
  });
}

function validateGovernanceBindingCompatibility(artifact = {}) {
  const input = asObject(artifact);
  const errors = [];
  const warnings = [];
  const governanceViolations = [];
  const summary = summarizeDecisionArtifact(input);

  if (!known(input.artifactId)) {
    errors.push(validationIssue('governance_artifact_id_missing', 'artifactId is required for Governance binding.', 'artifactId'));
    governanceViolations.push('artifactId');
  }
  if (!known(input.artifactFingerprint)) {
    errors.push(validationIssue('governance_artifact_fingerprint_missing', 'artifactFingerprint is required for Governance binding.', 'artifactFingerprint'));
    governanceViolations.push('artifactFingerprint');
  }
  if (input.productionImpact !== 'none' || input.decisionImpact !== 'none' || input.executionAuthority !== 'none') {
    errors.push(validationIssue('governance_authority_boundary_violation', 'Governance binding requires no production, decision, or execution authority.', 'authority'));
    governanceViolations.push('authority');
  }
  if (asObject(input.compatibility).runtimeIntegration !== 'none') {
    errors.push(validationIssue('runtime_integration_violation', 'Artifact must remain offline with no runtime integration.', 'compatibility.runtimeIntegration'));
    governanceViolations.push('compatibility.runtimeIntegration');
  }
  if (!asArray(asObject(input.provenance).inputFingerprints).length) {
    warnings.push(validationIssue('governance_provenance_fingerprints_missing', 'Governance binding should have input fingerprints.', 'provenance.inputFingerprints'));
    governanceViolations.push('provenance.inputFingerprints');
  }

  return deepFreeze({
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes: summarizeIssues(errors, warnings),
    governanceViolations: unique(governanceViolations).sort(),
    readyForGovernanceBinding: summary.readyForGovernanceBinding === true && errors.length === 0,
    summary
  });
}

function compareDecisionIntelligenceArtifacts(left = {}, right = {}) {
  const leftArtifact = asObject(left);
  const rightArtifact = asObject(right);
  const fieldComparisons = [];
  const mismatches = [];
  const fields = unique([...Object.keys(leftArtifact), ...Object.keys(rightArtifact)]).sort();

  for (const field of fields) {
    const leftValue = leftArtifact[field];
    const rightValue = rightArtifact[field];
    const equal = stableEqual(leftValue, rightValue);
    fieldComparisons.push({
      field,
      status: equal ? 'match' : 'mismatch',
      leftValue: clone(leftValue),
      rightValue: clone(rightValue)
    });
    if (!equal) {
      mismatches.push({
        field,
        reasonCode: 'artifact_field_mismatch',
        leftFingerprint: field === 'artifactFingerprint' ? normalizeString(leftValue) : UNKNOWN_VALUE,
        rightFingerprint: field === 'artifactFingerprint' ? normalizeString(rightValue) : UNKNOWN_VALUE
      });
    }
  }

  const core = {
    schemaVersion: DECISION_INTELLIGENCE_CONFORMANCE_SCHEMA_VERSION,
    source: DECISION_INTELLIGENCE_CONFORMANCE_SOURCE,
    comparedAt: normalizeDate(firstDefined(leftArtifact.createdAt, rightArtifact.createdAt)),
    leftArtifactId: normalizeString(leftArtifact.artifactId),
    rightArtifactId: normalizeString(rightArtifact.artifactId),
    leftArtifactFingerprint: normalizeString(leftArtifact.artifactFingerprint),
    rightArtifactFingerprint: normalizeString(rightArtifact.artifactFingerprint),
    parityStatus: mismatches.length ? 'mismatch' : 'exact_match',
    mismatchCount: mismatches.length,
    fieldComparisons,
    mismatches,
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };

  return deepFreeze({
    ...core,
    comparisonFingerprint: buildFingerprintFromProjection(core)
  });
}

function summarizeDecisionIntelligenceConformance(report = {}) {
  const stageResults = asArray(report.stageResults);
  const failedStages = stageResults.filter((stage) => stage.valid === false || stage.status === 'failed');
  const warningStages = stageResults.filter((stage) => asArray(stage.warnings).length > 0);
  return deepFreeze({
    conformanceReportId: normalizeString(report.conformanceReportId),
    artifactId: normalizeString(report.artifactId),
    stageCount: stageResults.length,
    passedStageCount: stageResults.length - failedStages.length,
    failedStageCount: failedStages.length,
    warningStageCount: warningStages.length,
    valid: failedStages.length === 0,
    readyForGovernanceBinding: asObject(report.governanceBindingCompatibility).readyForGovernanceBinding === true,
    reasonCodes: unique(stageResults.flatMap((stage) => asArray(stage.reasonCodes))).sort(),
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  });
}

function buildDecisionIntelligenceConformanceReport(artifact = {}, options = {}) {
  const stageValidations = {
    schema_and_required_fields: validateSchemaAndRequiredFields(artifact),
    immutability: validateImmutability(artifact),
    fingerprint_integrity: validateFingerprintIntegrity(artifact),
    provenance_integrity: validateProvenanceIntegrity(artifact),
    advisory_boundary: validateAdvisoryOnlyBoundaries(artifact),
    reference_integrity: validateReferenceIntegrity(artifact, options),
    deterministic_construction: validateDeterministicConstruction(artifact, options),
    unknown_value_preservation: validateUnknownValuePreservation(artifact),
    evidence_gap_preservation: validateEvidenceGapPreservation(artifact),
    explanation_completeness: validateExplanationCompleteness(artifact),
    governance_binding_compatibility: validateGovernanceBindingCompatibility(artifact)
  };
  const stageResults = CONFORMANCE_STAGES.map((stageName) => buildStageResult(stageName, stageValidations[stageName]));
  const errors = stageResults.flatMap((stage) => asArray(stage.errors).map((error) => ({ ...error, stageName: stage.stageName })));
  const warnings = stageResults.flatMap((stage) => asArray(stage.warnings).map((warning) => ({ ...warning, stageName: stage.stageName })));
  const core = {
    schemaVersion: DECISION_INTELLIGENCE_CONFORMANCE_SCHEMA_VERSION,
    source: DECISION_INTELLIGENCE_CONFORMANCE_SOURCE,
    conformanceReportId: normalizeString(firstDefined(options.conformanceReportId, `decision-intelligence-conformance:${normalizeString(artifact.artifactId)}`)),
    createdAt: normalizeDate(firstDefined(options.createdAt, asObject(artifact).createdAt)),
    artifactId: normalizeString(artifact.artifactId),
    artifactFingerprint: normalizeString(artifact.artifactFingerprint),
    stageResults,
    errors,
    warnings,
    reasonCodes: unique([...errors, ...warnings].map((issue) => issue.code)).sort(),
    schemaValidation: stageValidations.schema_and_required_fields,
    immutabilityValidation: stageValidations.immutability,
    fingerprintIntegrity: stageValidations.fingerprint_integrity,
    provenanceIntegrity: stageValidations.provenance_integrity,
    advisoryBoundary: stageValidations.advisory_boundary,
    referenceIntegrity: stageValidations.reference_integrity,
    deterministicConstruction: stageValidations.deterministic_construction,
    unknownValuePreservation: stageValidations.unknown_value_preservation,
    evidenceGapPreservation: stageValidations.evidence_gap_preservation,
    explanationCompleteness: stageValidations.explanation_completeness,
    governanceBindingCompatibility: stageValidations.governance_binding_compatibility,
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
  const report = {
    ...core,
    valid: errors.length === 0,
    summary: null
  };
  report.summary = summarizeDecisionIntelligenceConformance(report);
  return deepFreeze({
    ...report,
    conformanceFingerprint: buildConformanceFingerprint(report)
  });
}

function validateDecisionIntelligenceArtifactConformance(artifact = {}, options = {}) {
  return buildDecisionIntelligenceConformanceReport(artifact, options);
}

module.exports = {
  DECISION_INTELLIGENCE_CONFORMANCE_SCHEMA_VERSION,
  DECISION_INTELLIGENCE_CONFORMANCE_SOURCE,
  CONFORMANCE_STAGES,
  validateDecisionIntelligenceArtifactConformance,
  buildDecisionIntelligenceConformanceReport,
  summarizeDecisionIntelligenceConformance,
  compareDecisionIntelligenceArtifacts,
  buildConformanceFingerprint,
  validateSchemaAndRequiredFields,
  validateImmutability,
  validateFingerprintIntegrity,
  validateProvenanceIntegrity,
  validateAdvisoryOnlyBoundaries,
  validateReferenceIntegrity,
  validateDeterministicConstruction,
  validateUnknownValuePreservation,
  validateEvidenceGapPreservation,
  validateExplanationCompleteness,
  validateGovernanceBindingCompatibility
};
