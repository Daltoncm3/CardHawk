'use strict';

const { asArray, asObject, unique } = require('./canonicalValidationCore');
const { buildFingerprintFromProjection } = require('./fingerprintProjection');
const { clone, firstDefined } = require('./phase8GovernanceCore');
const {
  getArtifact,
  getArtifactByFingerprint,
  normalizeRegistry
} = require('./governanceArtifactRegistry');
const {
  LIFECYCLE_STATES,
  detectSupersededArtifacts,
  getLifecycleState,
  validateLifecycleIntegrity
} = require('./governanceArtifactLifecycleManager');
const {
  createReviewSession,
  getReviewSessionState,
  summarizeReviewSession,
  validateReviewSessionIntegrity
} = require('./governanceReviewSessionManager');
const { validateReviewSessionConformance } = require('./governanceReviewSessionConformance');
const { validateRegistryConformance } = require('./governanceArtifactRegistryConformance');

const GOVERNANCE_REVIEW_WORKSPACE_SCHEMA_VERSION = '1.0.0';
const GOVERNANCE_REVIEW_WORKSPACE_SOURCE = 'governance_review_workspace_orchestrator';
const UNKNOWN_VALUE = 'unknown';

const WORKSPACE_REVIEW_READINESS = Object.freeze([
  'empty',
  'review_ready',
  'review_ready_with_warnings',
  'blocked',
  'invalid',
  UNKNOWN_VALUE
]);

const CERTIFICATION_READINESS = Object.freeze([
  'not_signal_certified',
  'certification_ready',
  'certification_ready_with_warnings',
  'blocked',
  'invalid',
  UNKNOWN_VALUE
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

function reasonCodes(errors = [], warnings = []) {
  return unique([...asArray(errors), ...asArray(warnings)].map((issue) => issue.code)).sort();
}

function sortByPackageId(items = []) {
  return asArray(items)
    .map((item) => clone(item))
    .sort((left, right) => `${left.packageId}|${left.packageFingerprint}`.localeCompare(`${right.packageId}|${right.packageFingerprint}`));
}

function buildWorkspaceReviewFingerprint(workspaceReview = {}) {
  const projection = clone(workspaceReview);
  delete projection.workspaceFingerprint;
  return buildFingerprintFromProjection(projection);
}

function normalizeSession(session = {}) {
  return createReviewSession({
    sessionId: session.sessionId,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    reviewer: session.reviewer,
    sessionPurpose: session.sessionPurpose,
    sessionStatus: session.sessionStatus,
    reviewPackages: session.reviewPackages
  });
}

function normalizeFinding(input = {}, defaults = {}) {
  const finding = asObject(input);
  return {
    severity: normalizeString(firstDefined(finding.severity, defaults.severity, 'warning')),
    readinessScope: normalizeString(firstDefined(finding.readinessScope, defaults.readinessScope, 'review_and_certification')),
    category: normalizeString(firstDefined(finding.category, defaults.category, UNKNOWN_VALUE)),
    code: normalizeString(firstDefined(finding.code, finding.reasonCode, defaults.code, UNKNOWN_VALUE)),
    message: normalizeString(firstDefined(finding.message, finding.reason, defaults.message, UNKNOWN_VALUE)),
    packageId: normalizeString(firstDefined(finding.packageId, defaults.packageId, UNKNOWN_VALUE)),
    artifactId: normalizeString(firstDefined(finding.artifactId, defaults.artifactId, UNKNOWN_VALUE)),
    source: normalizeString(firstDefined(finding.source, defaults.source, GOVERNANCE_REVIEW_WORKSPACE_SOURCE))
  };
}

function extractSignalGovernance(reference = {}) {
  return asObject(reference.packageSnapshot?.signalGovernance || reference.signalGovernance);
}

function summaryArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'object') return Object.entries(value)
    .filter(([, count]) => Number(count) > 0 || count === true)
    .map(([key, count]) => ({ key, count }));
  return [value];
}

function countFindingSource(value) {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === 'object') return Object.values(value).reduce((total, item) => total + (Number(item) || (item === true ? 1 : 0)), 0);
  return value ? 1 : 0;
}

function deriveCertificationReadiness(reference = {}, findings = []) {
  const signalGovernance = extractSignalGovernance(reference);
  const readiness = asObject(signalGovernance.readinessSummary);
  const report = asObject(signalGovernance.reviewReportReference);
  if (findings.some((finding) => finding.severity === 'blocking')) return 'blocked';
  if (known(readiness.certificationReadiness)) return normalizeString(readiness.certificationReadiness);
  if (!Object.keys(signalGovernance).length || !known(report.reportId)) return 'not_signal_certified';
  if (asArray(findings).some((finding) => finding.severity === 'warning')) return 'certification_ready_with_warnings';
  return 'certification_ready';
}

function buildPackageFindings(reference = {}, options = {}) {
  const findings = [];
  const packageId = reference.packageId || UNKNOWN_VALUE;
  const signalGovernance = extractSignalGovernance(reference);
  const readiness = asObject(signalGovernance.readinessSummary);
  const bundle = asObject(signalGovernance.evidenceBundleReference);
  const report = asObject(signalGovernance.reviewReportReference);
  const integrity = asObject(signalGovernance.integritySummary);
  const supersession = asObject(signalGovernance.supersessionState);
  const snapshot = asObject(reference.packageSnapshot);

  if (reference.reviewReadiness === 'missing_registry_reference') {
    findings.push(normalizeFinding({ severity: 'blocking', category: 'validation', code: 'missing_registry_reference', message: 'Review Package is not registered.' }, { packageId }));
  }
  if (reference.reviewReadiness === 'blocked') {
    findings.push(normalizeFinding({ severity: 'blocking', category: 'readiness', code: 'package_blocked', message: 'Review Package is blocked for review.' }, { packageId }));
  }
  if (reference.lifecycleState === LIFECYCLE_STATES.SUPERSEDED) {
    findings.push(normalizeFinding({ severity: 'blocking', category: 'supersession', code: 'package_superseded', message: 'Review Package lifecycle state is superseded.' }, { packageId }));
  }
  if (reference.lifecycleState === LIFECYCLE_STATES.ARCHIVED) {
    findings.push(normalizeFinding({ severity: 'blocking', category: 'archive', code: 'package_archived', message: 'Review Package lifecycle state is archived.' }, { packageId }));
  }
  if (reference.lifecycleState === UNKNOWN_VALUE) {
    findings.push(normalizeFinding({ severity: 'warning', category: 'unknown', code: 'lifecycle_state_unknown', message: 'Review Package lifecycle state is unknown.' }, { packageId }));
  }

  if (bundle.missing === true || readiness.packageReadiness === 'blocked_missing_bundle') {
    findings.push(normalizeFinding({ severity: 'blocking', category: 'validation', code: 'missing_evidence_bundle', message: 'Signal Evidence Bundle is missing.' }, { packageId }));
  }
  if (bundle.invalid === true || readiness.packageReadiness === 'blocked_invalid_bundle') {
    findings.push(normalizeFinding({ severity: 'blocking', category: 'validation', code: 'invalid_evidence_bundle', message: 'Signal Evidence Bundle is invalid.' }, { packageId }));
  }
  if (report.missing === true || readiness.certificationReadiness === 'blocked_missing_report') {
    findings.push(normalizeFinding({ severity: 'blocking', readinessScope: 'certification', category: 'validation', code: 'missing_governance_report', message: 'Governance Review Report is missing.' }, { packageId }));
  }
  if (report.invalid === true || readiness.certificationReadiness === 'blocked_invalid_report') {
    findings.push(normalizeFinding({ severity: 'blocking', readinessScope: 'certification', category: 'validation', code: 'invalid_governance_report', message: 'Governance Review Report is invalid.' }, { packageId }));
  }
  if (supersession.bundleSuperseded === true || supersession.reportSuperseded === true) {
    findings.push(normalizeFinding({ severity: 'blocking', category: 'supersession', code: 'bound_artifact_superseded', message: 'A bound Signal governance artifact has been superseded.' }, { packageId }));
  }
  if (bundle.expired === true || report.expired === true || snapshot.expiresAt) {
    const expiresAt = firstDefined(bundle.expiresAt, report.expiresAt, snapshot.expiresAt);
    if (!known(expiresAt) || new Date(expiresAt) < new Date(firstDefined(options.asOf, options.createdAt, '9999-12-31T00:00:00.000Z'))) {
      findings.push(normalizeFinding({ severity: 'blocking', category: 'expiration', code: 'artifact_expired', message: 'A bound artifact is expired.' }, { packageId }));
    }
  }
  for (const violation of asArray(integrity.authorityViolations)) {
    findings.push(normalizeFinding({ severity: 'blocking', category: 'authority', code: 'authority_violation', message: String(violation) }, { packageId }));
  }
  for (const violation of asArray(integrity.sourceReferenceViolations)) {
    findings.push(normalizeFinding({ severity: 'blocking', category: 'provenance', code: 'source_reference_violation', message: String(violation) }, { packageId }));
  }
  for (const warning of asArray(readiness.nonBlockingWarnings)) {
    findings.push(normalizeFinding(warning, { severity: 'warning', category: 'validation', packageId }));
  }
  for (const followUp of asArray(readiness.requiredFollowUps)) {
    findings.push(normalizeFinding(followUp, { severity: 'warning', category: 'follow_up', packageId }));
  }

  for (const conflict of summaryArray(firstDefined(signalGovernance.conflicts, snapshot.conflicts))) {
    findings.push(normalizeFinding(conflict, { severity: 'warning', category: 'conflict', code: 'signal_conflict_visible', message: 'Signal conflict remains unresolved.', packageId }));
  }
  for (const unknown of summaryArray(firstDefined(signalGovernance.unknownValues, snapshot.unknownValues))) {
    findings.push(normalizeFinding(unknown, { severity: 'warning', category: 'unknown', code: 'unknown_value_visible', message: 'Unknown value remains explicit.', packageId }));
  }

  return findings.sort((left, right) => `${left.severity}|${left.category}|${left.code}|${left.packageId}`.localeCompare(`${right.severity}|${right.category}|${right.code}|${right.packageId}`));
}

function buildPackageSummary(reference = {}, options = {}) {
  const signalGovernance = extractSignalGovernance(reference);
  const readiness = asObject(signalGovernance.readinessSummary);
  const coverage = asObject(signalGovernance.coverageSummary);
  const findings = buildPackageFindings(reference, options);
  const blockingFindingCount = findings.filter((finding) => finding.severity === 'blocking').length;
  const reviewBlockingFindingCount = findings.filter((finding) => finding.severity === 'blocking' && finding.readinessScope !== 'certification').length;
  const certificationBlockingFindingCount = findings.filter((finding) => finding.severity === 'blocking').length;
  const warningFindingCount = findings.filter((finding) => finding.severity !== 'blocking').length;
  const reviewReadiness = reviewBlockingFindingCount > 0
    ? 'blocked'
    : normalizeString(firstDefined(readiness.packageReadiness, reference.reviewReadiness, 'review_ready_with_warnings'));
  const certificationReadiness = deriveCertificationReadiness(reference, findings);

  return {
    packageId: normalizeString(reference.packageId),
    listingId: normalizeString(reference.listingId),
    marketplace: normalizeString(reference.marketplace),
    packageFingerprint: normalizeString(reference.packageFingerprint),
    lifecycleState: normalizeString(reference.lifecycleState),
    reviewReadiness,
    certificationReadiness,
    bindingStatus: normalizeString(firstDefined(signalGovernance.bindingStatus, UNKNOWN_VALUE)),
    signalAware: Object.keys(signalGovernance).length > 0,
    coverageSummary: {
      expectedSignalCount: Number(coverage.expectedSignalCount || 0),
      coveredSignalCount: Number(coverage.coveredSignalCount || 0),
      missingSignalCount: Number(coverage.missingSignalCount || 0),
      blockedSignalCount: Number(coverage.blockedSignalCount || 0),
      invalidSignalCount: Number(coverage.invalidSignalCount || 0)
    },
    findingCounts: {
      blocking: blockingFindingCount,
      reviewBlocking: reviewBlockingFindingCount,
      certificationBlocking: certificationBlockingFindingCount,
      warning: warningFindingCount,
      conflicts: countFindingSource(firstDefined(signalGovernance.conflicts, reference.packageSnapshot?.conflicts)),
      unknowns: countFindingSource(firstDefined(signalGovernance.unknownValues, reference.packageSnapshot?.unknownValues)),
      provenance: findings.filter((finding) => finding.category === 'provenance').length,
      validation: findings.filter((finding) => finding.category === 'validation').length,
      authority: findings.filter((finding) => finding.category === 'authority').length,
      supersession: findings.filter((finding) => finding.category === 'supersession').length,
      expiration: findings.filter((finding) => finding.category === 'expiration').length
    },
    findings,
    artifactReferences: {
      packageReferenceId: normalizeString(reference.referenceId),
      packageFingerprint: normalizeString(reference.packageFingerprint),
      registryId: normalizeString(reference.registryId),
      registryFingerprint: normalizeString(reference.registryFingerprint),
      evidenceBundleId: normalizeString(signalGovernance.evidenceBundleReference?.bundleId),
      evidenceBundleFingerprint: normalizeString(signalGovernance.evidenceBundleReference?.bundleFingerprint),
      reviewReportId: normalizeString(signalGovernance.reviewReportReference?.reportId),
      reviewReportFingerprint: normalizeString(signalGovernance.reviewReportReference?.reportFingerprint)
    },
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
}

function assembleWorkspaceSummary(input = {}, options = {}) {
  const session = normalizeSession(firstDefined(input.reviewSession, input.session, {}));
  const packageSummaries = sortByPackageId(asArray(firstDefined(input.packageSummaries, session.reviewPackages.map((reference) => buildPackageSummary(reference, options)))));
  const aggregateCoverage = {
    packageCount: packageSummaries.length,
    signalAwarePackageCount: packageSummaries.filter((item) => item.signalAware).length,
    legacyPackageCount: packageSummaries.filter((item) => !item.signalAware).length,
    reviewReadyCount: packageSummaries.filter((item) => ['review_ready', 'review_ready_with_warnings'].includes(item.reviewReadiness)).length,
    certificationReadyCount: packageSummaries.filter((item) => ['certification_ready', 'certification_ready_with_warnings'].includes(item.certificationReadiness)).length,
    blockedPackageCount: packageSummaries.filter((item) => item.reviewReadiness === 'blocked' || item.certificationReadiness === 'blocked').length,
    blockedReviewPackageCount: packageSummaries.filter((item) => item.reviewReadiness === 'blocked').length,
    blockedCertificationPackageCount: packageSummaries.filter((item) => item.certificationReadiness === 'blocked').length,
    totalBlockingFindings: packageSummaries.reduce((total, item) => total + item.findingCounts.blocking, 0),
    totalReviewBlockingFindings: packageSummaries.reduce((total, item) => total + item.findingCounts.reviewBlocking, 0),
    totalCertificationBlockingFindings: packageSummaries.reduce((total, item) => total + item.findingCounts.certificationBlocking, 0),
    totalWarningFindings: packageSummaries.reduce((total, item) => total + item.findingCounts.warning, 0),
    totalUnknownValues: packageSummaries.reduce((total, item) => total + item.findingCounts.unknowns, 0),
    totalConflicts: packageSummaries.reduce((total, item) => total + item.findingCounts.conflicts, 0)
  };
  const aggregateFindings = {
    blockingFindingCount: aggregateCoverage.totalBlockingFindings,
    reviewBlockingFindingCount: aggregateCoverage.totalReviewBlockingFindings,
    certificationBlockingFindingCount: aggregateCoverage.totalCertificationBlockingFindings,
    nonBlockingFindingCount: aggregateCoverage.totalWarningFindings,
    authorityViolationCount: packageSummaries.reduce((total, item) => total + item.findingCounts.authority, 0),
    provenanceViolationCount: packageSummaries.reduce((total, item) => total + item.findingCounts.provenance, 0),
    supersessionWarningCount: packageSummaries.reduce((total, item) => total + item.findingCounts.supersession, 0),
    expirationWarningCount: packageSummaries.reduce((total, item) => total + item.findingCounts.expiration, 0),
    escalationCount: packageSummaries.reduce((total, item) => total + item.findings.filter((finding) => finding.category === 'escalation').length, 0)
  };
  const reviewerNavigation = {
    nextReviewReadyPackageId: normalizeString(packageSummaries.find((item) => item.reviewReadiness === 'review_ready')?.packageId),
    blockedPackageIds: packageSummaries.filter((item) => item.reviewReadiness === 'blocked' || item.certificationReadiness === 'blocked').map((item) => item.packageId),
    reviewBlockedPackageIds: packageSummaries.filter((item) => item.reviewReadiness === 'blocked').map((item) => item.packageId),
    certificationBlockedPackageIds: packageSummaries.filter((item) => item.certificationReadiness === 'blocked').map((item) => item.packageId),
    needsFollowUpPackageIds: packageSummaries.filter((item) => item.findings.some((finding) => finding.category === 'follow_up' || finding.severity === 'warning')).map((item) => item.packageId),
    certificationReadyPackageIds: packageSummaries.filter((item) => ['certification_ready', 'certification_ready_with_warnings'].includes(item.certificationReadiness)).map((item) => item.packageId)
  };

  return deepFreeze({
    packageSummaries,
    aggregateCoverage,
    aggregateFindings,
    reviewerNavigation,
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  });
}

function deriveWorkspaceReadiness(workspaceReview = {}) {
  const summary = asObject(workspaceReview.workspaceSummary || workspaceReview);
  const aggregateCoverage = asObject(summary.aggregateCoverage);
  const aggregateFindings = asObject(summary.aggregateFindings);
  if (Number(aggregateCoverage.packageCount || 0) === 0) {
    return deepFreeze({
      reviewReadiness: 'empty',
      certificationReadiness: 'not_signal_certified',
      blockingReasons: [],
      warnings: []
    });
  }
  const blockingReasons = [];
  const warnings = [];
  const certificationBlockingReasons = [];
  if (Number(aggregateFindings.reviewBlockingFindingCount || 0) > 0) blockingReasons.push('blocking_findings_present');
  if (Number(aggregateFindings.certificationBlockingFindingCount || 0) > 0) certificationBlockingReasons.push('blocking_findings_present');
  if (Number(aggregateFindings.authorityViolationCount || 0) > 0) {
    blockingReasons.push('authority_violations_present');
    certificationBlockingReasons.push('authority_violations_present');
  }
  if (Number(aggregateFindings.provenanceViolationCount || 0) > 0) {
    blockingReasons.push('provenance_violations_present');
    certificationBlockingReasons.push('provenance_violations_present');
  }
  if (Number(aggregateCoverage.blockedReviewPackageCount || 0) > 0) blockingReasons.push('blocked_packages_present');
  if (Number(aggregateCoverage.blockedCertificationPackageCount || 0) > 0) certificationBlockingReasons.push('blocked_packages_present');
  if (Number(aggregateFindings.nonBlockingFindingCount || 0) > 0) warnings.push('non_blocking_findings_present');
  if (Number(aggregateCoverage.legacyPackageCount || 0) > 0) warnings.push('legacy_packages_present');
  return deepFreeze({
    reviewReadiness: blockingReasons.length ? 'blocked' : (warnings.length ? 'review_ready_with_warnings' : 'review_ready'),
    certificationReadiness: certificationBlockingReasons.length ? 'blocked' : (Number(aggregateCoverage.certificationReadyCount || 0) === Number(aggregateCoverage.packageCount || 0) ? 'certification_ready' : 'certification_ready_with_warnings'),
    blockingReasons: unique(blockingReasons).sort(),
    certificationBlockingReasons: unique(certificationBlockingReasons).sort(),
    warnings: unique(warnings).sort()
  });
}

function createWorkspaceReview(input = {}, options = {}) {
  const session = normalizeSession(firstDefined(input.reviewSession, input.session, {}));
  const workspaceSummary = assembleWorkspaceSummary({ reviewSession: session }, options);
  const readiness = deriveWorkspaceReadiness(workspaceSummary);
  const core = {
    schemaVersion: GOVERNANCE_REVIEW_WORKSPACE_SCHEMA_VERSION,
    source: GOVERNANCE_REVIEW_WORKSPACE_SOURCE,
    workspaceReviewId: normalizeString(firstDefined(input.workspaceReviewId, `governance-workspace-review:${session.sessionId}`)),
    workspaceId: normalizeString(firstDefined(input.workspaceId, UNKNOWN_VALUE)),
    createdAt: normalizeDate(firstDefined(input.createdAt, options.createdAt, UNKNOWN_VALUE)),
    asOf: normalizeDate(firstDefined(input.asOf, options.asOf, input.createdAt, options.createdAt, UNKNOWN_VALUE)),
    reviewSessionReference: {
      sessionId: session.sessionId,
      sessionFingerprint: session.sessionFingerprint,
      sessionStatus: session.sessionStatus
    },
    workspaceSummary,
    readiness,
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
  return deepFreeze({
    ...core,
    workspaceFingerprint: buildWorkspaceReviewFingerprint(core)
  });
}

function listWorkspaceFindings(workspaceReview = {}, filters = {}) {
  const packages = asArray(workspaceReview.workspaceSummary?.packageSummaries || workspaceReview.packageSummaries);
  const findings = packages.flatMap((item) => asArray(item.findings).map((finding) => ({
    ...clone(finding),
    packageId: finding.packageId || item.packageId
  })));
  return findings
    .filter((finding) => !known(filters.severity) || finding.severity === normalizeString(filters.severity))
    .filter((finding) => !known(filters.category) || finding.category === normalizeString(filters.category))
    .sort((left, right) => `${left.severity}|${left.category}|${left.code}|${left.packageId}`.localeCompare(`${right.severity}|${right.category}|${right.code}|${right.packageId}`));
}

function validateWorkspaceReview(workspaceReview = {}, options = {}) {
  const input = asObject(workspaceReview);
  const errors = [];
  const warnings = [];
  const invalidFields = [];
  const authorityViolations = [];
  const fingerprintViolations = [];
  const sourceReferenceViolations = [];
  const readinessViolations = [];

  for (const field of ['schemaVersion', 'source', 'workspaceReviewId', 'workspaceId', 'createdAt', 'asOf', 'reviewSessionReference', 'workspaceSummary', 'readiness', 'productionImpact', 'decisionImpact', 'executionAuthority', 'workspaceFingerprint']) {
    if (!known(input[field])) {
      errors.push(validationIssue('missing_required_field', `${field} is required.`, field));
      invalidFields.push(field);
    }
  }
  if (input.schemaVersion !== GOVERNANCE_REVIEW_WORKSPACE_SCHEMA_VERSION) {
    errors.push(validationIssue('invalid_schema_version', 'Workspace review schemaVersion is unsupported.', 'schemaVersion'));
    invalidFields.push('schemaVersion');
  }
  if (input.source !== GOVERNANCE_REVIEW_WORKSPACE_SOURCE) {
    errors.push(validationIssue('invalid_source', 'Workspace review source is unsupported.', 'source'));
    invalidFields.push('source');
  }
  for (const field of ['productionImpact', 'decisionImpact', 'executionAuthority']) {
    if (input[field] !== 'none') {
      errors.push(validationIssue('authority_boundary_violation', `${field} must remain none.`, field));
      authorityViolations.push(field);
    }
  }
  if (input.workspaceFingerprint && buildWorkspaceReviewFingerprint(input) !== input.workspaceFingerprint) {
    errors.push(validationIssue('workspace_fingerprint_mismatch', 'Workspace fingerprint does not match workspace review contents.', 'workspaceFingerprint'));
    fingerprintViolations.push('workspaceFingerprint');
  }
  const expectedReadiness = deriveWorkspaceReadiness(input.workspaceSummary);
  if (JSON.stringify(expectedReadiness) !== JSON.stringify(input.readiness)) {
    errors.push(validationIssue('workspace_readiness_mismatch', 'Workspace readiness is not deterministic for workspace summary.', 'readiness'));
    readinessViolations.push('readiness');
  }
  const firstFindings = listWorkspaceFindings(input);
  const secondFindings = listWorkspaceFindings(input);
  if (JSON.stringify(firstFindings) !== JSON.stringify(secondFindings)) {
    errors.push(validationIssue('workspace_findings_not_deterministic', 'Workspace findings changed across repeated calls.', 'workspaceSummary.packageSummaries'));
    readinessViolations.push('findings');
  }

  if (options.reviewSession) {
    const session = normalizeSession(options.reviewSession);
    if (input.reviewSessionReference?.sessionId !== session.sessionId || input.reviewSessionReference?.sessionFingerprint !== session.sessionFingerprint) {
      errors.push(validationIssue('review_session_reference_mismatch', 'Workspace review session reference does not match supplied review session.', 'reviewSessionReference'));
      sourceReferenceViolations.push('reviewSessionReference');
    }
    const sessionValidation = validateReviewSessionIntegrity(session, {
      registry: options.registry,
      lifecycle: options.lifecycle
    });
    if (!sessionValidation.valid) {
      errors.push(validationIssue('review_session_integrity_failed', 'Supplied Review Session failed integrity validation.', 'reviewSession'));
      sourceReferenceViolations.push('reviewSession');
    }
    const sessionConformance = validateReviewSessionConformance(session, {
      registry: options.registry,
      lifecycle: options.lifecycle
    });
    if (!sessionConformance.valid) {
      errors.push(validationIssue('review_session_conformance_failed', 'Supplied Review Session failed conformance validation.', 'reviewSession'));
      sourceReferenceViolations.push('reviewSession');
    }
  }
  if (options.registry && !validateRegistryConformance(options.registry).valid) {
    errors.push(validationIssue('registry_conformance_failed', 'Supplied registry failed conformance validation.', 'registry'));
    sourceReferenceViolations.push('registry');
  }
  if (options.lifecycle && !validateLifecycleIntegrity(options.lifecycle, options.registry ? { registry: options.registry } : {}).valid) {
    errors.push(validationIssue('lifecycle_integrity_failed', 'Supplied lifecycle failed integrity validation.', 'lifecycle'));
    sourceReferenceViolations.push('lifecycle');
  }

  return deepFreeze({
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes: reasonCodes(errors, warnings),
    invalidFields: unique(invalidFields).sort(),
    authorityViolations: unique(authorityViolations).sort(),
    fingerprintViolations: unique(fingerprintViolations).sort(),
    sourceReferenceViolations: unique(sourceReferenceViolations).sort(),
    readinessViolations: unique(readinessViolations).sort()
  });
}

function summarizeWorkspaceReview(workspaceReview = {}) {
  const input = asObject(workspaceReview);
  const summary = asObject(input.workspaceSummary);
  return deepFreeze({
    schemaVersion: GOVERNANCE_REVIEW_WORKSPACE_SCHEMA_VERSION,
    source: GOVERNANCE_REVIEW_WORKSPACE_SOURCE,
    workspaceReviewId: normalizeString(input.workspaceReviewId),
    workspaceId: normalizeString(input.workspaceId),
    reviewReadiness: normalizeString(input.readiness?.reviewReadiness),
    certificationReadiness: normalizeString(input.readiness?.certificationReadiness),
    packageCount: Number(summary.aggregateCoverage?.packageCount || 0),
    blockingFindingCount: Number(summary.aggregateFindings?.blockingFindingCount || 0),
    nonBlockingFindingCount: Number(summary.aggregateFindings?.nonBlockingFindingCount || 0),
    nextReviewReadyPackageId: normalizeString(summary.reviewerNavigation?.nextReviewReadyPackageId),
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none',
    workspaceFingerprint: normalizeString(input.workspaceFingerprint)
  });
}

module.exports = {
  CERTIFICATION_READINESS,
  GOVERNANCE_REVIEW_WORKSPACE_SCHEMA_VERSION,
  GOVERNANCE_REVIEW_WORKSPACE_SOURCE,
  WORKSPACE_REVIEW_READINESS,
  assembleWorkspaceSummary,
  buildWorkspaceReviewFingerprint,
  createWorkspaceReview,
  deriveWorkspaceReadiness,
  listWorkspaceFindings,
  summarizeWorkspaceReview,
  validateWorkspaceReview
};
