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
  getLifecycleState,
  validateLifecycleIntegrity
} = require('./governanceArtifactLifecycleManager');
const { validateRegistryConformance } = require('./governanceArtifactRegistryConformance');

const GOVERNANCE_REVIEW_SESSION_SCHEMA_VERSION = '1.0.0';
const GOVERNANCE_REVIEW_SESSION_SOURCE = 'governance_review_session_manager';
const UNKNOWN_VALUE = 'unknown';

const REVIEW_SESSION_STATUSES = Object.freeze([
  'empty',
  'review_ready',
  'review_ready_with_warnings',
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

function reviewPackageId(packageInput = {}, options = {}) {
  const input = asObject(packageInput);
  return normalizeString(firstDefined(
    options.packageId,
    options.artifactId,
    input.packageId,
    input.artifactId,
    input.bindingId,
    input.id
  ));
}

function reviewPackageFingerprint(packageInput = {}, options = {}) {
  const input = asObject(packageInput);
  const explicit = firstDefined(
    options.packageFingerprint,
    options.artifactFingerprint,
    input.packageFingerprint,
    input.bindingFingerprint,
    input.artifactFingerprint,
    input.fingerprint
  );
  return known(explicit) ? normalizeString(explicit) : buildFingerprintFromProjection(input);
}

function reviewPackageSchemaVersion(packageInput = {}, options = {}) {
  const input = asObject(packageInput);
  return normalizeString(firstDefined(options.packageSchemaVersion, input.schemaVersion, input.version));
}

function reviewPackageCreatedAt(packageInput = {}, options = {}) {
  const input = asObject(packageInput);
  return normalizeDate(firstDefined(options.createdAt, input.createdAt, input.capturedAt));
}

function sortReviewPackages(packages = []) {
  return asArray(packages)
    .map((reviewPackage) => clone(reviewPackage))
    .sort((left, right) => `${left.packageId}|${left.packageFingerprint}`.localeCompare(`${right.packageId}|${right.packageFingerprint}`));
}

function buildReviewPackageReference(packageInput = {}, options = {}) {
  const sourcePackage = clone(asObject(packageInput));
  const packageId = reviewPackageId(sourcePackage, options);
  const packageFingerprint = reviewPackageFingerprint(sourcePackage, options);
  const core = {
    schemaVersion: GOVERNANCE_REVIEW_SESSION_SCHEMA_VERSION,
    source: GOVERNANCE_REVIEW_SESSION_SOURCE,
    referenceId: normalizeString(firstDefined(options.referenceId, `governance-review-package-reference:${packageId}:${packageFingerprint}`)),
    packageId,
    packageFingerprint,
    packageSchemaVersion: reviewPackageSchemaVersion(sourcePackage, options),
    listingId: normalizeString(firstDefined(options.listingId, sourcePackage.listingId)),
    marketplace: normalizeString(firstDefined(options.marketplace, sourcePackage.marketplace)),
    packageCreatedAt: reviewPackageCreatedAt(sourcePackage, options),
    attachedAt: normalizeDate(firstDefined(options.attachedAt, options.asOf, UNKNOWN_VALUE)),
    registryId: normalizeString(firstDefined(options.registryId, UNKNOWN_VALUE)),
    registryFingerprint: normalizeString(firstDefined(options.registryFingerprint, UNKNOWN_VALUE)),
    lifecycleState: normalizeString(firstDefined(options.lifecycleState, UNKNOWN_VALUE)),
    reviewReadiness: normalizeString(firstDefined(options.reviewReadiness, UNKNOWN_VALUE)),
    packageSnapshot: options.storePackage === false ? null : sourcePackage,
    metadata: clone(asObject(options.metadata)),
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
  return deepFreeze({
    ...core,
    referenceFingerprint: buildReviewPackageReferenceFingerprint(core)
  });
}

function buildReviewPackageReferenceFingerprint(reference = {}) {
  const projection = clone(reference);
  delete projection.referenceFingerprint;
  return buildFingerprintFromProjection(projection);
}

function buildReviewSessionFingerprint(session = {}) {
  const projection = clone(session);
  delete projection.sessionFingerprint;
  return buildFingerprintFromProjection(projection);
}

function summarizePackages(packages = []) {
  const references = sortReviewPackages(packages);
  const lifecycleStateSummary = {};
  const readinessSummary = {};
  const marketplaceSummary = {};
  for (const reference of references) {
    lifecycleStateSummary[reference.lifecycleState] = (lifecycleStateSummary[reference.lifecycleState] || 0) + 1;
    readinessSummary[reference.reviewReadiness] = (readinessSummary[reference.reviewReadiness] || 0) + 1;
    marketplaceSummary[reference.marketplace] = (marketplaceSummary[reference.marketplace] || 0) + 1;
  }
  return {
    packageCount: references.length,
    lifecycleStateSummary: Object.fromEntries(Object.entries(lifecycleStateSummary).sort(([left], [right]) => left.localeCompare(right))),
    readinessSummary: Object.fromEntries(Object.entries(readinessSummary).sort(([left], [right]) => left.localeCompare(right))),
    marketplaceSummary: Object.fromEntries(Object.entries(marketplaceSummary).sort(([left], [right]) => left.localeCompare(right)))
  };
}

function createReviewSession(input = {}) {
  const reviewPackages = sortReviewPackages(firstDefined(input.reviewPackages, input.packages, []));
  const summary = summarizePackages(reviewPackages);
  const core = {
    schemaVersion: GOVERNANCE_REVIEW_SESSION_SCHEMA_VERSION,
    source: GOVERNANCE_REVIEW_SESSION_SOURCE,
    sessionId: normalizeString(firstDefined(input.sessionId, 'governance-review-session')),
    createdAt: normalizeDate(firstDefined(input.createdAt, UNKNOWN_VALUE)),
    updatedAt: normalizeDate(firstDefined(input.updatedAt, input.createdAt, UNKNOWN_VALUE)),
    reviewer: normalizeString(firstDefined(input.reviewer, UNKNOWN_VALUE)),
    sessionPurpose: normalizeString(firstDefined(input.sessionPurpose, 'offline_governance_review')),
    sessionStatus: normalizeString(firstDefined(input.sessionStatus, determineStatusFromSummary(summary))),
    reviewPackages,
    summary,
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
  return deepFreeze({
    ...core,
    sessionFingerprint: buildReviewSessionFingerprint(core)
  });
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

function determineStatusFromSummary(summary = {}) {
  const packageCount = Number(summary.packageCount || 0);
  const readiness = asObject(summary.readinessSummary);
  const states = asObject(summary.lifecycleStateSummary);
  if (packageCount === 0) return 'empty';
  if (readiness.invalid || states.archived || states.superseded) return 'blocked';
  if (readiness.blocked || readiness.missing_registry_reference) return 'blocked';
  if (readiness.review_ready_with_warnings || states.unknown) return 'review_ready_with_warnings';
  return 'review_ready';
}

function determineReferenceReadiness(reference = {}, registryEntry = null, lifecycleState = null) {
  if (!registryEntry) return 'missing_registry_reference';
  const state = lifecycleState?.currentState || UNKNOWN_VALUE;
  if (state === LIFECYCLE_STATES.ARCHIVED || state === LIFECYCLE_STATES.SUPERSEDED) return 'blocked';
  if (state === LIFECYCLE_STATES.UNKNOWN) return 'review_ready_with_warnings';
  return 'review_ready';
}

function validateReference(reference = {}, options = {}) {
  const input = asObject(reference);
  const errors = [];
  const warnings = [];
  const invalidFields = [];
  const authorityViolations = [];
  const registryViolations = [];
  const lifecycleViolations = [];
  const fingerprintViolations = [];

  for (const field of ['schemaVersion', 'source', 'referenceId', 'packageId', 'packageFingerprint', 'packageSchemaVersion', 'attachedAt', 'productionImpact', 'decisionImpact', 'executionAuthority', 'referenceFingerprint']) {
    if (!known(input[field])) {
      errors.push(validationIssue('missing_required_field', `${field} is required.`, field));
      invalidFields.push(field);
    }
  }
  if (input.schemaVersion !== GOVERNANCE_REVIEW_SESSION_SCHEMA_VERSION) {
    errors.push(validationIssue('invalid_schema_version', 'Review package reference schemaVersion is unsupported.', 'schemaVersion'));
    invalidFields.push('schemaVersion');
  }
  if (input.source !== GOVERNANCE_REVIEW_SESSION_SOURCE) {
    errors.push(validationIssue('invalid_source', 'Review package reference source is unsupported.', 'source'));
    invalidFields.push('source');
  }
  for (const field of ['productionImpact', 'decisionImpact', 'executionAuthority']) {
    if (input[field] !== 'none') {
      errors.push(validationIssue('authority_boundary_violation', `${field} must remain none.`, field));
      authorityViolations.push(field);
    }
  }
  if (input.referenceFingerprint && buildReviewPackageReferenceFingerprint(input) !== input.referenceFingerprint) {
    errors.push(validationIssue('reference_fingerprint_mismatch', 'Review package reference fingerprint does not match reference contents.', 'referenceFingerprint'));
    fingerprintViolations.push('referenceFingerprint');
  }
  if (input.packageSnapshot && typeof input.packageSnapshot === 'object') {
    const expected = reviewPackageFingerprint(input.packageSnapshot);
    if (input.packageFingerprint !== expected) {
      errors.push(validationIssue('package_fingerprint_mismatch', 'Package fingerprint does not match stored package snapshot.', 'packageFingerprint'));
      fingerprintViolations.push('packageFingerprint');
    }
  }

  if (options.registry) {
    const registry = normalizeRegistry(options.registry);
    const byId = getArtifact(registry, input.packageId);
    const byFingerprint = getArtifactByFingerprint(registry, input.packageFingerprint);
    if (!byId) {
      errors.push(validationIssue('package_not_registered', 'Review package is not present in the registry by ID.', 'packageId'));
      registryViolations.push('packageId');
    }
    if (!byFingerprint) {
      errors.push(validationIssue('package_fingerprint_not_registered', 'Review package is not present in the registry by fingerprint.', 'packageFingerprint'));
      registryViolations.push('packageFingerprint');
    }
    if (byId && byId.artifactFingerprint !== input.packageFingerprint) {
      errors.push(validationIssue('registry_package_fingerprint_mismatch', 'Registry package fingerprint differs from session reference.', 'packageFingerprint'));
      fingerprintViolations.push('packageFingerprint');
    }
  }

  if (options.lifecycle) {
    const state = getLifecycleState(options.lifecycle, input.packageId);
    if (input.lifecycleState !== UNKNOWN_VALUE && input.lifecycleState !== state.currentState) {
      errors.push(validationIssue('lifecycle_state_mismatch', 'Session reference lifecycle state differs from lifecycle manager state.', 'lifecycleState'));
      lifecycleViolations.push(input.packageId);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes: reasonCodes(errors, warnings),
    invalidFields: unique(invalidFields).sort(),
    authorityViolations: unique(authorityViolations).sort(),
    registryViolations: unique(registryViolations).sort(),
    lifecycleViolations: unique(lifecycleViolations).sort(),
    fingerprintViolations: unique(fingerprintViolations).sort()
  };
}

function attachReviewPackage(session = createReviewSession(), reviewPackage = {}, options = {}) {
  const normalized = normalizeSession(session);
  let registryEntry = null;
  let lifecycleState = null;
  const registryId = options.registry ? normalizeRegistry(options.registry).registryId : options.registryId;
  const registryFingerprint = options.registry ? normalizeRegistry(options.registry).registryFingerprint : options.registryFingerprint;

  const packageId = reviewPackageId(reviewPackage, options);
  const packageFingerprint = reviewPackageFingerprint(reviewPackage, options);
  if (options.registry) {
    const registry = normalizeRegistry(options.registry);
    registryEntry = getArtifact(registry, packageId);
    lifecycleState = options.lifecycle ? getLifecycleState(options.lifecycle, packageId) : null;
  }
  const reference = buildReviewPackageReference(reviewPackage, {
    ...options,
    packageId,
    packageFingerprint,
    registryId,
    registryFingerprint,
    lifecycleState: lifecycleState ? lifecycleState.currentState : UNKNOWN_VALUE,
    reviewReadiness: determineReferenceReadiness({}, registryEntry, lifecycleState)
  });
  const candidateSession = createReviewSession({
    sessionId: normalized.sessionId,
    createdAt: normalized.createdAt,
    updatedAt: reference.attachedAt,
    reviewer: normalized.reviewer,
    sessionPurpose: normalized.sessionPurpose,
    reviewPackages: [...normalized.reviewPackages, reference]
  });
  const validation = validateReviewSession(candidateSession, options);

  if (!validation.valid) {
    return deepFreeze({
      attached: false,
      session: normalized,
      reference,
      validation
    });
  }

  return deepFreeze({
    attached: true,
    session: candidateSession,
    reference,
    validation
  });
}

function validateReviewSession(session = {}, options = {}) {
  const input = asObject(session);
  const normalized = normalizeSession(session);
  const errors = [];
  const warnings = [];
  const invalidFields = [];
  const duplicatePackages = [];
  const authorityViolations = [];
  const registryViolations = [];
  const lifecycleViolations = [];
  const fingerprintViolations = [];
  const seenIds = {};
  const seenFingerprints = {};

  for (const field of ['schemaVersion', 'source', 'sessionId', 'createdAt', 'updatedAt', 'sessionStatus', 'reviewPackages', 'summary', 'productionImpact', 'decisionImpact', 'executionAuthority', 'sessionFingerprint']) {
    if (!known(input[field])) {
      errors.push(validationIssue('missing_required_field', `${field} is required.`, field));
      invalidFields.push(field);
    }
  }
  if (input.schemaVersion !== GOVERNANCE_REVIEW_SESSION_SCHEMA_VERSION) {
    errors.push(validationIssue('invalid_schema_version', 'Review session schemaVersion is unsupported.', 'schemaVersion'));
    invalidFields.push('schemaVersion');
  }
  if (input.source !== GOVERNANCE_REVIEW_SESSION_SOURCE) {
    errors.push(validationIssue('invalid_source', 'Review session source is unsupported.', 'source'));
    invalidFields.push('source');
  }
  if (!REVIEW_SESSION_STATUSES.includes(input.sessionStatus)) {
    errors.push(validationIssue('invalid_session_status', 'Review session status is unsupported.', 'sessionStatus'));
    invalidFields.push('sessionStatus');
  }
  if (!Array.isArray(input.reviewPackages)) {
    errors.push(validationIssue('invalid_review_packages', 'reviewPackages must be an array.', 'reviewPackages'));
    invalidFields.push('reviewPackages');
  }
  for (const field of ['productionImpact', 'decisionImpact', 'executionAuthority']) {
    if (input[field] !== 'none') {
      errors.push(validationIssue('authority_boundary_violation', `${field} must remain none.`, field));
      authorityViolations.push(field);
    }
  }
  if (input.sessionFingerprint && buildReviewSessionFingerprint(input) !== input.sessionFingerprint) {
    errors.push(validationIssue('session_fingerprint_mismatch', 'Review session fingerprint does not match supplied session contents.', 'sessionFingerprint'));
    fingerprintViolations.push('sessionFingerprint');
  }
  if (buildReviewSessionFingerprint(normalized) !== normalized.sessionFingerprint) {
    errors.push(validationIssue('session_fingerprint_mismatch', 'Review session fingerprint does not match normalized session contents.', 'sessionFingerprint'));
    fingerprintViolations.push('sessionFingerprint');
  }

  for (const [index, reference] of asArray(input.reviewPackages).entries()) {
    seenIds[reference.packageId] = (seenIds[reference.packageId] || 0) + 1;
    seenFingerprints[reference.packageFingerprint] = (seenFingerprints[reference.packageFingerprint] || 0) + 1;
    const validation = validateReference(reference, options);
    if (!validation.valid) {
      errors.push(...validation.errors.map((error) => ({ ...error, field: `reviewPackages.${index}.${error.field || ''}`.replace(/\.$/, '') })));
      invalidFields.push(...validation.invalidFields.map((field) => `reviewPackages.${index}.${field}`));
      authorityViolations.push(...validation.authorityViolations.map((field) => `reviewPackages.${index}.${field}`));
      registryViolations.push(...validation.registryViolations.map((field) => `reviewPackages.${index}.${field}`));
      lifecycleViolations.push(...validation.lifecycleViolations);
      fingerprintViolations.push(...validation.fingerprintViolations.map((field) => `reviewPackages.${index}.${field}`));
    }
    warnings.push(...validation.warnings.map((warning) => ({ ...warning, field: `reviewPackages.${index}.${warning.field || ''}`.replace(/\.$/, '') })));
  }
  for (const [id, count] of Object.entries(seenIds)) {
    if (id !== UNKNOWN_VALUE && count > 1) {
      errors.push(validationIssue('duplicate_review_package_id', 'Review package ID appears more than once in session.', 'reviewPackages'));
      duplicatePackages.push(id);
    }
  }
  for (const [fingerprint, count] of Object.entries(seenFingerprints)) {
    if (fingerprint !== UNKNOWN_VALUE && count > 1) {
      errors.push(validationIssue('duplicate_review_package_fingerprint', 'Review package fingerprint appears more than once in session.', 'reviewPackages'));
      duplicatePackages.push(fingerprint);
    }
  }

  if (JSON.stringify(normalized.summary) !== JSON.stringify(summarizePackages(input.reviewPackages))) {
    errors.push(validationIssue('session_summary_mismatch', 'Review session summary is not deterministic for package references.', 'summary'));
    invalidFields.push('summary');
  }

  return deepFreeze({
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes: reasonCodes(errors, warnings),
    invalidFields: unique(invalidFields).sort(),
    duplicatePackages: unique(duplicatePackages).sort(),
    authorityViolations: unique(authorityViolations).sort(),
    registryViolations: unique(registryViolations).sort(),
    lifecycleViolations: unique(lifecycleViolations).sort(),
    fingerprintViolations: unique(fingerprintViolations).sort()
  });
}

function getReviewSessionState(session = {}) {
  const normalized = normalizeSession(session);
  const validation = validateReviewSession(normalized);
  const state = {
    sessionId: normalized.sessionId,
    sessionStatus: validation.valid ? determineStatusFromSummary(normalized.summary) : 'invalid',
    packageCount: normalized.summary.packageCount,
    activePackages: normalized.summary.lifecycleStateSummary.active || 0,
    supersededPackages: normalized.summary.lifecycleStateSummary.superseded || 0,
    archivedPackages: normalized.summary.lifecycleStateSummary.archived || 0,
    readyPackages: normalized.summary.readinessSummary.review_ready || 0,
    warningPackages: normalized.summary.readinessSummary.review_ready_with_warnings || 0,
    blockedPackages: normalized.summary.readinessSummary.blocked || 0,
    invalidPackages: normalized.summary.readinessSummary.invalid || 0,
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
  return deepFreeze(state);
}

function summarizeReviewSession(session = {}) {
  const normalized = normalizeSession(session);
  return deepFreeze({
    schemaVersion: GOVERNANCE_REVIEW_SESSION_SCHEMA_VERSION,
    source: GOVERNANCE_REVIEW_SESSION_SOURCE,
    sessionId: normalized.sessionId,
    sessionStatus: determineStatusFromSummary(normalized.summary),
    packageCount: normalized.summary.packageCount,
    lifecycleStateSummary: clone(normalized.summary.lifecycleStateSummary),
    readinessSummary: clone(normalized.summary.readinessSummary),
    marketplaceSummary: clone(normalized.summary.marketplaceSummary),
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none',
    sessionFingerprint: normalized.sessionFingerprint
  });
}

function validateReviewSessionIntegrity(session = {}, options = {}) {
  const inputBefore = clone(session);
  const normalized = normalizeSession(session);
  const validation = validateReviewSession(session, options);
  const errors = [...validation.errors];
  const warnings = [...validation.warnings];
  const registryViolations = [...validation.registryViolations];
  const lifecycleViolations = [...validation.lifecycleViolations];
  const fingerprintViolations = [...validation.fingerprintViolations];

  if (options.registry) {
    const registryValidation = validateRegistryConformance(options.registry);
    if (!registryValidation.valid) {
      errors.push(validationIssue('registry_conformance_failed', 'Bound registry failed conformance validation.', 'registry'));
      registryViolations.push('registry');
    }
  }
  if (options.lifecycle) {
    const lifecycleValidation = validateLifecycleIntegrity(options.lifecycle, options.registry ? { registry: options.registry } : {});
    if (!lifecycleValidation.valid) {
      errors.push(validationIssue('lifecycle_integrity_failed', 'Bound lifecycle failed integrity validation.', 'lifecycle'));
      lifecycleViolations.push('lifecycle');
    }
  }

  const firstSummary = summarizeReviewSession(normalized);
  const secondSummary = summarizeReviewSession(normalized);
  if (JSON.stringify(firstSummary) !== JSON.stringify(secondSummary)) {
    errors.push(validationIssue('session_summary_not_deterministic', 'Review session summary changed across repeated calls.', 'summary'));
  }

  if (JSON.stringify(inputBefore) !== JSON.stringify(session)) {
    errors.push(validationIssue('session_input_mutated', 'Review session integrity validation mutated the input session.', 'session'));
  }

  return deepFreeze({
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes: reasonCodes(errors, warnings),
    invalidFields: validation.invalidFields,
    duplicatePackages: validation.duplicatePackages,
    authorityViolations: validation.authorityViolations,
    registryViolations: unique(registryViolations).sort(),
    lifecycleViolations: unique(lifecycleViolations).sort(),
    fingerprintViolations: unique(fingerprintViolations).sort()
  });
}

module.exports = {
  GOVERNANCE_REVIEW_SESSION_SCHEMA_VERSION,
  GOVERNANCE_REVIEW_SESSION_SOURCE,
  REVIEW_SESSION_STATUSES,
  attachReviewPackage,
  buildReviewPackageReference,
  buildReviewPackageReferenceFingerprint,
  buildReviewSessionFingerprint,
  createReviewSession,
  getReviewSessionState,
  summarizeReviewSession,
  validateReviewSession,
  validateReviewSessionIntegrity
};
