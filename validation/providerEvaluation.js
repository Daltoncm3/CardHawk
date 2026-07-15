'use strict';

const {
  ACCESS_MODES,
  normalizeAcquisitionCapabilities
} = require('../marketplaces/canonicalAcquisitionInterface');
const {
  asArray,
  asObject,
  stableStringify,
  unique
} = require('./canonicalValidationCore');
const {
  buildRegistryEntryId
} = require('./certificationArtifactRegistry');
const {
  buildOfflineAuthorityFlags,
  firstDefined
} = require('./phase8GovernanceCore');
const {
  buildFingerprintFromProjection
} = require('./fingerprintProjection');

const SOURCE = 'canonical_provider_evaluation';
const PROVIDER_EVALUATION_VERSION = '1.0.0';

const QUALIFICATION_STATUS = Object.freeze({
  RESEARCH: 'research',
  CANDIDATE: 'candidate',
  QUALIFIED_FOR_ADAPTER_DEVELOPMENT: 'qualified_for_adapter_development',
  BLOCKED: 'blocked',
  REJECTED: 'rejected',
  APPROVED_FOR_OFFLINE_TESTING: 'approved_for_offline_testing'
});

const RECOMMENDED_ACTION = Object.freeze({
  CONTINUE_RESEARCH: 'continue_provider_research',
  REQUEST_PERMISSION_DOCUMENTATION: 'request_permission_documentation',
  RESOLVE_BLOCKING_ISSUES: 'resolve_blocking_issues',
  DESIGN_ADAPTER_SPIKE: 'design_adapter_development_spike',
  PREPARE_OFFLINE_TEST_PLAN: 'prepare_offline_test_plan',
  REJECT_PROVIDER: 'reject_provider',
  REEVALUATE_PROVIDER: 'reevaluate_provider'
});

const CRITERION_STATUS = Object.freeze({
  PASS: 'pass',
  PARTIAL: 'partial',
  FAIL: 'fail',
  UNKNOWN: 'unknown'
});

const CRITERION_SEVERITY = Object.freeze({
  BLOCKING: 'blocking',
  MAJOR: 'major',
  MINOR: 'minor',
  INFORMATIONAL: 'informational'
});

const EVALUATION_CRITERIA = Object.freeze({
  COMMERCIAL_USE_PERMISSION: 'commercial_use_permission',
  LICENSING_DOCUMENTATION: 'licensing_documentation',
  TRANSACTION_LEVEL_EVIDENCE: 'transaction_level_evidence_quality',
  EXACT_IDENTITY_SUPPORT: 'exact_identity_support',
  ACCEPTED_OFFER_VISIBILITY: 'accepted_offer_visibility',
  PROVENANCE_QUALITY: 'provenance_quality',
  STABLE_RECORD_IDENTIFIERS: 'stable_record_identifiers',
  HISTORICAL_COVERAGE: 'historical_coverage',
  RECENCY_COVERAGE: 'recency_coverage',
  CORRECTION_CANCELLATION_BEHAVIOR: 'correction_cancellation_behavior',
  RATE_LIMIT_CHARACTERISTICS: 'rate_limit_characteristics',
  ACQUISITION_RELIABILITY: 'acquisition_reliability',
  SCHEMA_STABILITY: 'schema_stability',
  VERSION_TRACKING: 'version_tracking',
  LONG_TERM_OPERATIONAL_RISK: 'long_term_operational_risk'
});

const CAPABILITY_LABELS = Object.freeze({
  TRANSACTION_LEVEL_EVIDENCE: 'transaction_level_true_sold_evidence',
  EXACT_IDENTITY: 'exact_identity_fields',
  ACCEPTED_OFFER_VISIBILITY: 'accepted_offer_visibility',
  PROVENANCE: 'source_provenance',
  STABLE_RECORD_IDS: 'stable_record_identifiers',
  HISTORICAL_COVERAGE: 'historical_coverage',
  RECENCY_COVERAGE: 'recency_coverage',
  CORRECTIONS: 'correction_cancellation_behavior',
  RATE_LIMITS: 'documented_rate_limits',
  ACQUISITION_RELIABILITY: 'reliable_acquisition',
  SCHEMA_STABILITY: 'stable_schema',
  VERSION_TRACKING: 'version_tracking',
  COMMERCIAL_USE: 'commercial_use_documented'
});

const BLOCKING_REASON = Object.freeze({
  COMMERCIAL_USE_NOT_APPROVED: 'commercial_use_not_approved',
  LICENSING_DOCUMENTATION_MISSING: 'licensing_documentation_missing',
  TRANSACTION_LEVEL_EVIDENCE_NOT_SUPPORTED: 'transaction_level_evidence_not_supported',
  EXACT_IDENTITY_SUPPORT_INSUFFICIENT: 'exact_identity_support_insufficient',
  PROVENANCE_QUALITY_INSUFFICIENT: 'provenance_quality_insufficient',
  STABLE_RECORD_IDENTIFIERS_MISSING: 'stable_record_identifiers_missing',
  SCHEMA_STABILITY_INSUFFICIENT: 'schema_stability_insufficient',
  VERSION_TRACKING_MISSING: 'version_tracking_missing',
  LONG_TERM_OPERATIONAL_RISK_HIGH: 'long_term_operational_risk_high',
  PROVIDER_REJECTED: 'provider_rejected'
});

function lower(value) {
  return String(value || '').trim().toLowerCase();
}

function booleanish(value) {
  if (value === true || value === 'true' || value === 'yes' || value === 'supported' || value === 'full') return true;
  if (value === false || value === 'false' || value === 'no' || value === 'unsupported' || value === 'none') return false;
  return null;
}

function statusFromBooleanOrLevel(value, passLevels = [], partialLevels = [], failLevels = []) {
  const bool = booleanish(value);
  if (bool === true) return CRITERION_STATUS.PASS;
  if (bool === false) return CRITERION_STATUS.FAIL;

  const normalized = lower(value);
  if (passLevels.includes(normalized)) return CRITERION_STATUS.PASS;
  if (partialLevels.includes(normalized)) return CRITERION_STATUS.PARTIAL;
  if (failLevels.includes(normalized)) return CRITERION_STATUS.FAIL;
  return CRITERION_STATUS.UNKNOWN;
}

function criterion(name, status, severity, details = {}, reason = null) {
  const normalizedStatus = Object.values(CRITERION_STATUS).includes(status) ? status : CRITERION_STATUS.UNKNOWN;
  return {
    name,
    status: normalizedStatus,
    pass: normalizedStatus === CRITERION_STATUS.PASS,
    severity,
    blocking: severity === CRITERION_SEVERITY.BLOCKING && normalizedStatus !== CRITERION_STATUS.PASS,
    reason: normalizedStatus === CRITERION_STATUS.PASS ? null : reason,
    details: asObject(details)
  };
}

function normalizeProviderIdentity(provider = {}) {
  const identity = asObject(provider.providerIdentity || provider.identity);
  return {
    providerId: firstDefined(provider.providerId, identity.providerId, provider.sourceId, identity.sourceId, 'unknown_provider'),
    providerName: firstDefined(provider.providerName, identity.providerName, provider.name, 'Unknown provider'),
    marketplace: firstDefined(provider.marketplace, identity.marketplace, null),
    sourceType: firstDefined(provider.sourceType, identity.sourceType, null),
    accessMode: firstDefined(provider.accessMode, identity.accessMode, ACCESS_MODES.UNKNOWN)
  };
}

function normalizeDocumentation(provider = {}) {
  const documentation = asObject(provider.documentation);
  return {
    documentationProvided: Boolean(firstDefined(provider.documentationProvided, documentation.documentationProvided, documentation.apiDocsUrl, documentation.termsUrl, documentation.licenseUrl)),
    licenseUrl: documentation.licenseUrl || null,
    termsUrl: documentation.termsUrl || null,
    apiDocsUrl: documentation.apiDocsUrl || null,
    sampleDataReviewed: Boolean(documentation.sampleDataReviewed),
    notes: documentation.notes || null
  };
}

function normalizeEvaluationInput(provider = {}) {
  const evaluation = asObject(provider.evaluation);
  const capabilities = normalizeAcquisitionCapabilities(asObject(provider.capabilities));
  const documentation = normalizeDocumentation(provider);
  const commercialUse = asObject(capabilities.commercialUse);

  return {
    evaluation,
    capabilities,
    documentation,
    permissionStatus: lower(firstDefined(provider.permissionStatus, evaluation.permissionStatus, commercialUse.permitted === true ? 'approved' : 'unknown')),
    licensingStatus: lower(firstDefined(provider.licensingStatus, evaluation.licensingStatus, documentation.documentationProvided ? 'documented' : 'unknown')),
    commercialUsePermitted: firstDefined(provider.commercialUsePermitted, evaluation.commercialUsePermitted, commercialUse.permitted),
    transactionLevelEvidence: firstDefined(evaluation.transactionLevelEvidence, evaluation.transactionLevelEvidenceQuality, capabilities.transactionLevelSoldSupport),
    exactIdentitySupport: firstDefined(evaluation.exactIdentitySupport, capabilities.identityFields.length > 0),
    acceptedOfferVisibility: firstDefined(evaluation.acceptedOfferVisibility, capabilities.acceptedBestOfferSupport),
    provenanceQuality: firstDefined(evaluation.provenanceQuality, capabilities.provenanceFields.length > 0 ? 'usable' : 'unknown'),
    stableRecordIdentifiers: firstDefined(evaluation.stableRecordIdentifiers, evaluation.stableRecordIds, null),
    historicalCoverage: firstDefined(evaluation.historicalCoverage, capabilities.supportsHistoricalBackfill),
    recencyCoverage: firstDefined(evaluation.recencyCoverage, null),
    correctionCancellationBehavior: firstDefined(evaluation.correctionCancellationBehavior, evaluation.corrections, null),
    rateLimitCharacteristics: firstDefined(evaluation.rateLimitCharacteristics, evaluation.rateLimit, capabilities.rateLimit),
    acquisitionReliability: firstDefined(evaluation.acquisitionReliability, null),
    schemaStability: firstDefined(evaluation.schemaStability, null),
    versionTracking: firstDefined(evaluation.versionTracking, provider.versionTracking, null),
    longTermOperationalRisk: lower(firstDefined(evaluation.longTermOperationalRisk, evaluation.operationalRisk, provider.operationalRisk, 'unknown'))
  };
}

function evaluateCommercialUse(input) {
  const permissionStatus = input.permissionStatus;
  const permitted = booleanish(input.commercialUsePermitted);
  const approved = ['approved', 'documented', 'licensed'].includes(permissionStatus) && permitted === true;
  const failed = permitted === false || ['prohibited', 'rejected', 'restricted'].includes(permissionStatus);
  const status = approved ? CRITERION_STATUS.PASS : failed ? CRITERION_STATUS.FAIL : CRITERION_STATUS.UNKNOWN;
  return criterion(
    EVALUATION_CRITERIA.COMMERCIAL_USE_PERMISSION,
    status,
    CRITERION_SEVERITY.BLOCKING,
    { permissionStatus, commercialUsePermitted: input.commercialUsePermitted },
    BLOCKING_REASON.COMMERCIAL_USE_NOT_APPROVED
  );
}

function evaluateLicensing(input) {
  const licensingStatus = input.licensingStatus;
  const documented = input.documentation.documentationProvided;
  const pass = ['approved', 'documented', 'licensed'].includes(licensingStatus) && documented;
  const fail = ['missing', 'rejected', 'prohibited'].includes(licensingStatus);
  const status = pass ? CRITERION_STATUS.PASS : fail ? CRITERION_STATUS.FAIL : CRITERION_STATUS.UNKNOWN;
  return criterion(
    EVALUATION_CRITERIA.LICENSING_DOCUMENTATION,
    status,
    CRITERION_SEVERITY.BLOCKING,
    { licensingStatus, documentation: input.documentation },
    BLOCKING_REASON.LICENSING_DOCUMENTATION_MISSING
  );
}

function evaluateTransactionEvidence(input) {
  const status = statusFromBooleanOrLevel(
    input.transactionLevelEvidence,
    ['strong', 'verified', 'transaction_level', 'full'],
    ['partial', 'sample_only', 'limited'],
    ['aggregate_only', 'none', 'weak']
  );
  return criterion(
    EVALUATION_CRITERIA.TRANSACTION_LEVEL_EVIDENCE,
    status,
    CRITERION_SEVERITY.BLOCKING,
    { transactionLevelEvidence: input.transactionLevelEvidence },
    BLOCKING_REASON.TRANSACTION_LEVEL_EVIDENCE_NOT_SUPPORTED
  );
}

function evaluateExactIdentity(input) {
  const status = statusFromBooleanOrLevel(
    input.exactIdentitySupport,
    ['strong', 'verified', 'complete', 'full'],
    ['partial', 'limited', 'manual_review_required'],
    ['weak', 'none']
  );
  return criterion(
    EVALUATION_CRITERIA.EXACT_IDENTITY_SUPPORT,
    status,
    CRITERION_SEVERITY.BLOCKING,
    { exactIdentitySupport: input.exactIdentitySupport, identityFields: input.capabilities.identityFields },
    BLOCKING_REASON.EXACT_IDENTITY_SUPPORT_INSUFFICIENT
  );
}

function evaluateAcceptedOffer(input) {
  const status = statusFromBooleanOrLevel(
    input.acceptedOfferVisibility,
    ['visible', 'full', 'documented'],
    ['partial', 'some', 'inferred'],
    ['hidden', 'none']
  );
  return criterion(
    EVALUATION_CRITERIA.ACCEPTED_OFFER_VISIBILITY,
    status,
    CRITERION_SEVERITY.MAJOR,
    { acceptedOfferVisibility: input.acceptedOfferVisibility },
    'accepted_offer_visibility_incomplete'
  );
}

function evaluateProvenance(input) {
  const status = statusFromBooleanOrLevel(
    input.provenanceQuality,
    ['strong', 'verified', 'complete', 'usable'],
    ['partial', 'limited'],
    ['weak', 'none']
  );
  return criterion(
    EVALUATION_CRITERIA.PROVENANCE_QUALITY,
    status,
    CRITERION_SEVERITY.BLOCKING,
    { provenanceQuality: input.provenanceQuality, provenanceFields: input.capabilities.provenanceFields },
    BLOCKING_REASON.PROVENANCE_QUALITY_INSUFFICIENT
  );
}

function evaluateStableIds(input) {
  const status = statusFromBooleanOrLevel(
    input.stableRecordIdentifiers,
    ['stable', 'documented', 'persistent'],
    ['partial', 'derived'],
    ['unstable', 'missing']
  );
  return criterion(
    EVALUATION_CRITERIA.STABLE_RECORD_IDENTIFIERS,
    status,
    CRITERION_SEVERITY.BLOCKING,
    { stableRecordIdentifiers: input.stableRecordIdentifiers },
    BLOCKING_REASON.STABLE_RECORD_IDENTIFIERS_MISSING
  );
}

function evaluateHistoricalCoverage(input) {
  const status = statusFromBooleanOrLevel(
    input.historicalCoverage,
    ['deep', 'multi_year', 'complete', 'documented'],
    ['moderate', 'limited', 'recent_only'],
    ['none']
  );
  return criterion(
    EVALUATION_CRITERIA.HISTORICAL_COVERAGE,
    status,
    CRITERION_SEVERITY.MAJOR,
    { historicalCoverage: input.historicalCoverage },
    'historical_coverage_limited'
  );
}

function evaluateRecencyCoverage(input) {
  const status = statusFromBooleanOrLevel(
    input.recencyCoverage,
    ['current', 'near_real_time', 'daily', 'documented'],
    ['lagged', 'weekly', 'limited'],
    ['stale', 'none']
  );
  return criterion(
    EVALUATION_CRITERIA.RECENCY_COVERAGE,
    status,
    CRITERION_SEVERITY.MAJOR,
    { recencyCoverage: input.recencyCoverage },
    'recency_coverage_limited'
  );
}

function evaluateCorrections(input) {
  const status = statusFromBooleanOrLevel(
    input.correctionCancellationBehavior,
    ['documented', 'supported', 'versioned'],
    ['manual', 'partial'],
    ['unsupported', 'none']
  );
  return criterion(
    EVALUATION_CRITERIA.CORRECTION_CANCELLATION_BEHAVIOR,
    status,
    CRITERION_SEVERITY.MAJOR,
    { correctionCancellationBehavior: input.correctionCancellationBehavior },
    'correction_cancellation_behavior_incomplete'
  );
}

function evaluateRateLimits(input) {
  const value = input.rateLimitCharacteristics;
  const object = asObject(value);
  const documented = object.documented === true || Boolean(object.requestsPerMinute || object.requestsPerHour || object.requestsPerDay);
  const sustainable = object.sustainable !== false;
  const status = documented && sustainable
    ? CRITERION_STATUS.PASS
    : documented
      ? CRITERION_STATUS.PARTIAL
      : CRITERION_STATUS.UNKNOWN;
  return criterion(
    EVALUATION_CRITERIA.RATE_LIMIT_CHARACTERISTICS,
    status,
    CRITERION_SEVERITY.MINOR,
    { rateLimitCharacteristics: value },
    'rate_limit_characteristics_unknown'
  );
}

function evaluateReliability(input) {
  const status = statusFromBooleanOrLevel(
    input.acquisitionReliability,
    ['strong', 'reliable', 'documented'],
    ['usable', 'partial', 'manual_retry_required'],
    ['weak', 'unreliable']
  );
  return criterion(
    EVALUATION_CRITERIA.ACQUISITION_RELIABILITY,
    status,
    CRITERION_SEVERITY.MAJOR,
    { acquisitionReliability: input.acquisitionReliability },
    'acquisition_reliability_unproven'
  );
}

function evaluateSchemaStability(input) {
  const status = statusFromBooleanOrLevel(
    input.schemaStability,
    ['stable', 'versioned', 'contracted'],
    ['mostly_stable', 'manual_notice'],
    ['volatile', 'unknown_unversioned']
  );
  return criterion(
    EVALUATION_CRITERIA.SCHEMA_STABILITY,
    status,
    CRITERION_SEVERITY.BLOCKING,
    { schemaStability: input.schemaStability },
    BLOCKING_REASON.SCHEMA_STABILITY_INSUFFICIENT
  );
}

function evaluateVersionTracking(input) {
  const status = statusFromBooleanOrLevel(
    input.versionTracking,
    ['versioned', 'documented'],
    ['manual'],
    ['missing', 'none']
  );
  return criterion(
    EVALUATION_CRITERIA.VERSION_TRACKING,
    status,
    CRITERION_SEVERITY.BLOCKING,
    { versionTracking: input.versionTracking },
    BLOCKING_REASON.VERSION_TRACKING_MISSING
  );
}

function evaluateOperationalRisk(input) {
  const risk = input.longTermOperationalRisk;
  const status = ['low', 'medium'].includes(risk)
    ? CRITERION_STATUS.PASS
    : risk === 'high'
      ? CRITERION_STATUS.FAIL
      : CRITERION_STATUS.UNKNOWN;
  return criterion(
    EVALUATION_CRITERIA.LONG_TERM_OPERATIONAL_RISK,
    status,
    CRITERION_SEVERITY.BLOCKING,
    { longTermOperationalRisk: risk },
    BLOCKING_REASON.LONG_TERM_OPERATIONAL_RISK_HIGH
  );
}

function buildCriteria(input) {
  return [
    evaluateCommercialUse(input),
    evaluateLicensing(input),
    evaluateTransactionEvidence(input),
    evaluateExactIdentity(input),
    evaluateAcceptedOffer(input),
    evaluateProvenance(input),
    evaluateStableIds(input),
    evaluateHistoricalCoverage(input),
    evaluateRecencyCoverage(input),
    evaluateCorrections(input),
    evaluateRateLimits(input),
    evaluateReliability(input),
    evaluateSchemaStability(input),
    evaluateVersionTracking(input),
    evaluateOperationalRisk(input)
  ];
}

function hasStatus(criteria, name, status) {
  const entry = criteria.find((item) => item.name === name);
  return entry ? entry.status === status : false;
}

function capabilityFromCriterion(criteria, name, label, supported, unsupported) {
  if (hasStatus(criteria, name, CRITERION_STATUS.PASS)) supported.push(label);
  else unsupported.push(label);
}

function buildCapabilities(criteria) {
  const supported = [];
  const unsupported = [];
  capabilityFromCriterion(criteria, EVALUATION_CRITERIA.TRANSACTION_LEVEL_EVIDENCE, CAPABILITY_LABELS.TRANSACTION_LEVEL_EVIDENCE, supported, unsupported);
  capabilityFromCriterion(criteria, EVALUATION_CRITERIA.EXACT_IDENTITY_SUPPORT, CAPABILITY_LABELS.EXACT_IDENTITY, supported, unsupported);
  capabilityFromCriterion(criteria, EVALUATION_CRITERIA.ACCEPTED_OFFER_VISIBILITY, CAPABILITY_LABELS.ACCEPTED_OFFER_VISIBILITY, supported, unsupported);
  capabilityFromCriterion(criteria, EVALUATION_CRITERIA.PROVENANCE_QUALITY, CAPABILITY_LABELS.PROVENANCE, supported, unsupported);
  capabilityFromCriterion(criteria, EVALUATION_CRITERIA.STABLE_RECORD_IDENTIFIERS, CAPABILITY_LABELS.STABLE_RECORD_IDS, supported, unsupported);
  capabilityFromCriterion(criteria, EVALUATION_CRITERIA.HISTORICAL_COVERAGE, CAPABILITY_LABELS.HISTORICAL_COVERAGE, supported, unsupported);
  capabilityFromCriterion(criteria, EVALUATION_CRITERIA.RECENCY_COVERAGE, CAPABILITY_LABELS.RECENCY_COVERAGE, supported, unsupported);
  capabilityFromCriterion(criteria, EVALUATION_CRITERIA.CORRECTION_CANCELLATION_BEHAVIOR, CAPABILITY_LABELS.CORRECTIONS, supported, unsupported);
  capabilityFromCriterion(criteria, EVALUATION_CRITERIA.RATE_LIMIT_CHARACTERISTICS, CAPABILITY_LABELS.RATE_LIMITS, supported, unsupported);
  capabilityFromCriterion(criteria, EVALUATION_CRITERIA.ACQUISITION_RELIABILITY, CAPABILITY_LABELS.ACQUISITION_RELIABILITY, supported, unsupported);
  capabilityFromCriterion(criteria, EVALUATION_CRITERIA.SCHEMA_STABILITY, CAPABILITY_LABELS.SCHEMA_STABILITY, supported, unsupported);
  capabilityFromCriterion(criteria, EVALUATION_CRITERIA.VERSION_TRACKING, CAPABILITY_LABELS.VERSION_TRACKING, supported, unsupported);
  capabilityFromCriterion(criteria, EVALUATION_CRITERIA.COMMERCIAL_USE_PERMISSION, CAPABILITY_LABELS.COMMERCIAL_USE, supported, unsupported);
  return {
    supportedCapabilities: unique(supported).sort(),
    unsupportedCapabilities: unique(unsupported).sort()
  };
}

function buildBlockingIssues(provider, criteria) {
  const issues = criteria
    .filter((entry) => entry.blocking)
    .map((entry) => ({
      code: entry.reason,
      criterion: entry.name,
      status: entry.status,
      details: entry.details
    }));

  if (provider.rejected === true || lower(provider.disposition) === 'rejected') {
    issues.push({
      code: BLOCKING_REASON.PROVIDER_REJECTED,
      criterion: 'provider_disposition',
      status: CRITERION_STATUS.FAIL,
      details: { rejected: true }
    });
  }

  return issues;
}

function countCriteria(criteria, statuses) {
  return criteria.filter((entry) => statuses.includes(entry.status)).length;
}

function determineQualificationStatus(provider, criteria, blockingIssues) {
  if (provider.rejected === true || lower(provider.disposition) === 'rejected') {
    return QUALIFICATION_STATUS.REJECTED;
  }

  if (blockingIssues.length > 0) {
    return QUALIFICATION_STATUS.BLOCKED;
  }

  const passCount = countCriteria(criteria, [CRITERION_STATUS.PASS]);
  const majorFailures = criteria.filter((entry) => (
    entry.severity === CRITERION_SEVERITY.MAJOR
    && [CRITERION_STATUS.FAIL, CRITERION_STATUS.UNKNOWN].includes(entry.status)
  ));

  if ((provider.approvedForOfflineTesting === true || asObject(provider.operatorApproval).approvedForOfflineTesting === true) && majorFailures.length === 0) {
    return QUALIFICATION_STATUS.APPROVED_FOR_OFFLINE_TESTING;
  }

  if (majorFailures.length === 0 && passCount >= 11) {
    return QUALIFICATION_STATUS.QUALIFIED_FOR_ADAPTER_DEVELOPMENT;
  }

  if (passCount >= 7) {
    return QUALIFICATION_STATUS.CANDIDATE;
  }

  return QUALIFICATION_STATUS.RESEARCH;
}

function determineRecommendedAction(status, blockingIssues) {
  if (status === QUALIFICATION_STATUS.REJECTED) return RECOMMENDED_ACTION.REJECT_PROVIDER;
  if (status === QUALIFICATION_STATUS.BLOCKED) {
    const hasPermissionBlock = blockingIssues.some((issue) => (
      issue.code === BLOCKING_REASON.COMMERCIAL_USE_NOT_APPROVED
      || issue.code === BLOCKING_REASON.LICENSING_DOCUMENTATION_MISSING
    ));
    return hasPermissionBlock
      ? RECOMMENDED_ACTION.REQUEST_PERMISSION_DOCUMENTATION
      : RECOMMENDED_ACTION.RESOLVE_BLOCKING_ISSUES;
  }
  if (status === QUALIFICATION_STATUS.APPROVED_FOR_OFFLINE_TESTING) return RECOMMENDED_ACTION.PREPARE_OFFLINE_TEST_PLAN;
  if (status === QUALIFICATION_STATUS.QUALIFIED_FOR_ADAPTER_DEVELOPMENT) return RECOMMENDED_ACTION.DESIGN_ADAPTER_SPIKE;
  if (status === QUALIFICATION_STATUS.CANDIDATE) return RECOMMENDED_ACTION.REEVALUATE_PROVIDER;
  return RECOMMENDED_ACTION.CONTINUE_RESEARCH;
}

function buildProjectedCertificationRegistryKey(adapterMetadata = {}) {
  const metadata = asObject(adapterMetadata);
  if (!metadata.sourceId && !metadata.adapterName && !metadata.adapterVersion) return null;
  return buildRegistryEntryId(metadata);
}

function buildProviderEvaluationFingerprint(report = {}) {
  return buildFingerprintFromProjection({
    source: report.source,
    version: report.version,
    providerIdentity: report.providerIdentity,
    providerVersion: report.providerVersion,
    evaluationDate: report.evaluationDate,
    evaluator: report.evaluator,
    permissionStatus: report.permissionStatus,
    licensingStatus: report.licensingStatus,
    supportedCapabilities: report.supportedCapabilities,
    unsupportedCapabilities: report.unsupportedCapabilities,
    strengths: report.strengths,
    weaknesses: report.weaknesses,
    identifiedRisks: report.identifiedRisks,
    blockingIssues: report.blockingIssues,
    qualificationStatus: report.qualificationStatus,
    recommendedNextAction: report.recommendedNextAction,
    criteria: report.criteria,
    projectedCertificationRegistryKey: report.projectedCertificationRegistryKey,
    productionApproval: report.productionApproval,
    liveIngestionAuthority: report.liveIngestionAuthority
  });
}

function evaluateProviderCandidate(provider = {}, options = {}) {
  const normalizedProvider = asObject(provider);
  const input = normalizeEvaluationInput(normalizedProvider);
  const criteria = buildCriteria(input);
  const blockingIssues = buildBlockingIssues(normalizedProvider, criteria);
  const qualificationStatus = determineQualificationStatus(normalizedProvider, criteria, blockingIssues);
  const recommendedNextAction = determineRecommendedAction(qualificationStatus, blockingIssues);
  const capabilityReport = buildCapabilities(criteria);
  const providerIdentity = normalizeProviderIdentity(normalizedProvider);
  const adapterMetadata = asObject(normalizedProvider.adapterMetadata || normalizedProvider.projectedAdapterMetadata);

  const report = {
    source: SOURCE,
    version: PROVIDER_EVALUATION_VERSION,
    providerIdentity,
    providerVersion: firstDefined(normalizedProvider.providerVersion, normalizedProvider.version, 'unknown'),
    evaluationDate: firstDefined(options.evaluationDate, normalizedProvider.evaluationDate, new Date().toISOString()),
    evaluator: firstDefined(options.evaluator, normalizedProvider.evaluator, 'unknown'),
    permissionStatus: input.permissionStatus,
    licensingStatus: input.licensingStatus,
    supportedCapabilities: unique(asArray(normalizedProvider.supportedCapabilities).concat(capabilityReport.supportedCapabilities)).sort(),
    unsupportedCapabilities: unique(asArray(normalizedProvider.unsupportedCapabilities).concat(capabilityReport.unsupportedCapabilities)).sort(),
    strengths: unique(asArray(normalizedProvider.strengths)).sort(),
    weaknesses: unique(asArray(normalizedProvider.weaknesses)).sort(),
    identifiedRisks: unique(asArray(normalizedProvider.identifiedRisks || normalizedProvider.risks)).sort(),
    blockingIssues,
    qualificationStatus,
    recommendedNextAction,
    criteria,
    projectedAdapterMetadata: adapterMetadata,
    projectedCertificationRegistryKey: buildProjectedCertificationRegistryKey(adapterMetadata),
    documentation: input.documentation,
    evidenceSummary: asObject(normalizedProvider.evidence),
    notes: normalizedProvider.notes || null,
    ...buildOfflineAuthorityFlags({
      automaticStoreWriteAuthority: undefined
    })
  };
  delete report.automaticStoreWriteAuthority;

  report.stableFingerprint = buildProviderEvaluationFingerprint(report);
  return report;
}

module.exports = {
  BLOCKING_REASON,
  CRITERION_SEVERITY,
  CRITERION_STATUS,
  EVALUATION_CRITERIA,
  PROVIDER_EVALUATION_VERSION,
  QUALIFICATION_STATUS,
  RECOMMENDED_ACTION,
  SOURCE,
  buildProviderEvaluationFingerprint,
  evaluateProviderCandidate,
  stableStringify
};
