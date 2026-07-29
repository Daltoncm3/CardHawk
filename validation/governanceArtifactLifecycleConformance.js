'use strict';

const { asArray, asObject, unique } = require('./canonicalValidationCore');
const { buildFingerprintFromProjection } = require('./fingerprintProjection');
const { clone, firstDefined } = require('./phase8GovernanceCore');
const {
  ALLOWED_TRANSITIONS,
  GOVERNANCE_ARTIFACT_LIFECYCLE_SCHEMA_VERSION,
  GOVERNANCE_ARTIFACT_LIFECYCLE_SOURCE,
  LIFECYCLE_STATES,
  buildLifecycleEventFingerprint,
  buildLifecycleFingerprint,
  createLifecycle,
  detectSupersededArtifacts,
  getLifecycleState,
  registerLifecycleEvent,
  summarizeLifecycle,
  validateLifecycleIntegrity,
  validateLifecycleTransition
} = require('./governanceArtifactLifecycleManager');
const { validateRegistryConformance } = require('./governanceArtifactRegistryConformance');

const GOVERNANCE_ARTIFACT_LIFECYCLE_CONFORMANCE_SCHEMA_VERSION = '1.0.0';
const GOVERNANCE_ARTIFACT_LIFECYCLE_CONFORMANCE_SOURCE = 'governance_artifact_lifecycle_conformance';
const UNKNOWN_VALUE = 'unknown';

const CONFORMANCE_STAGES = Object.freeze([
  'lifecycle_state_model',
  'transition_integrity',
  'supersession_consistency',
  'lifecycle_determinism',
  'registry_integration',
  'offline_boundary',
  'authority_boundary'
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

function validationIssue(code, message, field = '') {
  return { code, message, field };
}

function collectReasonCodes(errors = [], warnings = []) {
  return unique([...asArray(errors), ...asArray(warnings)].map((issue) => issue.code)).sort();
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
    reasonCodes: collectReasonCodes(errors, warnings),
    ...clone(asObject(extras))
  });
}

function normalizeLifecycle(lifecycle = {}) {
  return createLifecycle({
    lifecycleId: lifecycle.lifecycleId,
    registryId: lifecycle.registryId,
    registryFingerprint: lifecycle.registryFingerprint,
    createdAt: lifecycle.createdAt,
    updatedAt: lifecycle.updatedAt,
    events: lifecycle.events
  });
}

function validateLifecycleStateModel(lifecycle = {}) {
  const input = asObject(lifecycle);
  const normalized = normalizeLifecycle(lifecycle);
  const errors = [];
  const warnings = [];
  const stateViolations = [];
  const immutableViolations = [];

  if (input.schemaVersion && input.schemaVersion !== GOVERNANCE_ARTIFACT_LIFECYCLE_SCHEMA_VERSION) {
    errors.push(validationIssue('invalid_lifecycle_schema_version', 'Lifecycle schemaVersion is unsupported.', 'schemaVersion'));
    stateViolations.push('schemaVersion');
  }
  if (input.source && input.source !== GOVERNANCE_ARTIFACT_LIFECYCLE_SOURCE) {
    errors.push(validationIssue('invalid_lifecycle_source', 'Lifecycle source is unsupported.', 'source'));
    stateViolations.push('source');
  }
  if (!Object.isFrozen(normalized)) {
    errors.push(validationIssue('lifecycle_not_immutable', 'Normalized lifecycle object must be immutable.', 'lifecycle'));
    immutableViolations.push('lifecycle');
  }
  if (!Object.isFrozen(normalized.events)) {
    errors.push(validationIssue('lifecycle_events_not_immutable', 'Lifecycle event history must be immutable.', 'events'));
    immutableViolations.push('events');
  }
  for (const [index, event] of normalized.events.entries()) {
    if (!Object.isFrozen(event)) {
      errors.push(validationIssue('lifecycle_event_not_immutable', 'Lifecycle event must be immutable.', `events.${index}`));
      immutableViolations.push(`events.${index}`);
    }
    if (!Object.values(LIFECYCLE_STATES).includes(event.priorState) || !Object.values(LIFECYCLE_STATES).includes(event.nextState)) {
      errors.push(validationIssue('invalid_lifecycle_state', 'Lifecycle event contains an unsupported state.', `events.${index}`));
      stateViolations.push(`events.${index}`);
    }
  }
  for (const [artifactId, state] of Object.entries(asObject(normalized.states))) {
    if (!Object.values(LIFECYCLE_STATES).includes(state.currentState)) {
      errors.push(validationIssue('invalid_derived_lifecycle_state', 'Derived lifecycle state is unsupported.', `states.${artifactId}.currentState`));
      stateViolations.push(artifactId);
    }
    const expected = getLifecycleState(normalized, artifactId);
    if (JSON.stringify(expected) !== JSON.stringify(state)) {
      errors.push(validationIssue('derived_state_mismatch', 'Derived lifecycle state is not stable through public lookup.', `states.${artifactId}`));
      stateViolations.push(artifactId);
    }
  }

  return deepFreeze({
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes: collectReasonCodes(errors, warnings),
    stateViolations: unique(stateViolations).sort(),
    immutableViolations: unique(immutableViolations).sort()
  });
}

function buildValidTransitionSequence(registry = null) {
  let lifecycle = createLifecycle({
    lifecycleId: 'lifecycle-conformance-transition-fixture',
    registryId: registry?.registryId,
    registryFingerprint: registry?.registryFingerprint,
    createdAt: '2026-07-29T15:00:00.000Z'
  });
  const options = registry ? { registry } : {};
  const fixtureEvents = [
    { eventType: 'registered', artifactId: 'bundle-001', artifactFingerprint: 'bundle-fingerprint-001', eventAt: '2026-07-29T15:01:00.000Z' },
    { eventType: 'activated', artifactId: 'bundle-001', artifactFingerprint: 'bundle-fingerprint-001', eventAt: '2026-07-29T15:02:00.000Z' },
    { eventType: 'superseded', artifactId: 'bundle-001', artifactFingerprint: 'bundle-fingerprint-001', eventAt: '2026-07-29T15:03:00.000Z' },
    { eventType: 'archived', artifactId: 'bundle-001', artifactFingerprint: 'bundle-fingerprint-001', eventAt: '2026-07-29T15:04:00.000Z' }
  ];
  const results = [];
  for (const event of fixtureEvents) {
    const result = registerLifecycleEvent(lifecycle, event, options);
    results.push(result);
    if (result.registered) lifecycle = result.lifecycle;
  }
  return { lifecycle, results };
}

function validateTransitionIntegrity(lifecycle = {}, options = {}) {
  const normalized = normalizeLifecycle(lifecycle);
  const errors = [];
  const warnings = [];
  const transitionViolations = [];
  const registry = options.registry || null;
  const publicOptions = registry ? { registry } : {};

  let replay = createLifecycle({
    lifecycleId: normalized.lifecycleId,
    registryId: normalized.registryId,
    registryFingerprint: normalized.registryFingerprint,
    createdAt: normalized.createdAt
  });
  for (const [index, event] of normalized.events.entries()) {
    const validation = validateLifecycleTransition(replay, event, publicOptions);
    if (!validation.valid) {
      errors.push(...validation.errors.map((error) => ({ ...error, field: `events.${index}.${error.field || ''}`.replace(/\.$/, '') })));
      transitionViolations.push(...asArray(validation.lifecycleViolations));
    } else {
      replay = registerLifecycleEvent(replay, event, publicOptions).lifecycle;
    }
  }

  const validFixture = buildValidTransitionSequence(registry);
  if (validFixture.results.some((result) => result.registered !== true)) {
    errors.push(validationIssue('valid_transition_sequence_rejected', 'Lifecycle manager rejected a valid transition sequence.', 'fixture.validTransitions'));
    transitionViolations.push('valid_transition_sequence');
  }
  const invalid = registerLifecycleEvent(validFixture.lifecycle, {
    eventType: 'activated',
    artifactId: 'bundle-001',
    artifactFingerprint: 'bundle-fingerprint-001',
    eventAt: '2026-07-29T15:05:00.000Z'
  }, publicOptions);
  if (invalid.registered !== false || !asArray(invalid.validation.reasonCodes).includes('invalid_lifecycle_transition')) {
    errors.push(validationIssue('invalid_transition_not_rejected', 'Lifecycle manager did not reject archived -> active transition.', 'fixture.invalidTransition'));
    transitionViolations.push('archived->active');
  }

  return deepFreeze({
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes: collectReasonCodes(errors, warnings),
    transitionViolations: unique(transitionViolations).sort()
  });
}

function validateSupersessionConsistency(lifecycle = {}, registry = {}) {
  const normalized = normalizeLifecycle(lifecycle);
  const errors = [];
  const warnings = [];
  const supersessionViolations = [];
  const superseded = detectSupersededArtifacts(normalized, registry);
  const repeated = detectSupersededArtifacts(normalized, registry);

  if (JSON.stringify(superseded) !== JSON.stringify(repeated)) {
    errors.push(validationIssue('supersession_detection_not_deterministic', 'Superseded artifact detection changed across repeated calls.', 'supersession'));
    supersessionViolations.push('supersession');
  }
  for (const item of superseded) {
    if (!known(item.artifactId) || !known(item.artifactFingerprint)) {
      errors.push(validationIssue('invalid_superseded_artifact_reference', 'Superseded artifact entry must preserve ID and fingerprint.', 'supersession'));
      supersessionViolations.push(item.artifactId || UNKNOWN_VALUE);
    }
    if (item.lifecycleState === LIFECYCLE_STATES.SUPERSEDED && asArray(item.supersededBy).length === 0) {
      warnings.push(validationIssue('lifecycle_superseded_without_registry_successor', 'Lifecycle marks artifact superseded without a registry successor.', item.artifactId));
      supersessionViolations.push(item.artifactId);
    }
  }

  return deepFreeze({
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes: collectReasonCodes(errors, warnings),
    supersessionViolations: unique(supersessionViolations).sort(),
    supersededArtifacts: clone(superseded)
  });
}

function validateLifecycleDeterminism(lifecycle = {}) {
  const input = asObject(lifecycle);
  const normalized = normalizeLifecycle(lifecycle);
  const errors = [];
  const warnings = [];
  const fingerprintViolations = [];
  const determinismViolations = [];

  if (known(input.lifecycleFingerprint) && buildLifecycleFingerprint(input) !== input.lifecycleFingerprint) {
    errors.push(validationIssue('lifecycle_fingerprint_mismatch', 'Supplied lifecycle fingerprint does not match supplied lifecycle contents.', 'lifecycleFingerprint'));
    fingerprintViolations.push('lifecycleFingerprint');
  }
  if (buildLifecycleFingerprint(normalized) !== normalized.lifecycleFingerprint) {
    errors.push(validationIssue('lifecycle_fingerprint_mismatch', 'Normalized lifecycle fingerprint does not match lifecycle contents.', 'lifecycleFingerprint'));
    fingerprintViolations.push('lifecycleFingerprint');
  }
  for (const [index, event] of asArray(input.events).entries()) {
    if (known(event.eventFingerprint) && buildLifecycleEventFingerprint(event) !== event.eventFingerprint) {
      errors.push(validationIssue('event_fingerprint_mismatch', 'Supplied event fingerprint does not match event contents.', `events.${index}.eventFingerprint`));
      fingerprintViolations.push(`events.${index}.eventFingerprint`);
    }
  }
  for (const [index, event] of normalized.events.entries()) {
    if (buildLifecycleEventFingerprint(event) !== event.eventFingerprint) {
      errors.push(validationIssue('event_fingerprint_mismatch', 'Normalized event fingerprint does not match event contents.', `events.${index}.eventFingerprint`));
      fingerprintViolations.push(`events.${index}.eventFingerprint`);
    }
  }

  const firstSummary = summarizeLifecycle(normalized);
  const secondSummary = summarizeLifecycle(normalized);
  if (JSON.stringify(firstSummary) !== JSON.stringify(secondSummary)) {
    errors.push(validationIssue('lifecycle_summary_not_deterministic', 'Lifecycle summary changed across repeated calls.', 'summary'));
    determinismViolations.push('summary');
  }
  const firstState = Object.keys(normalized.states).map((artifactId) => getLifecycleState(normalized, artifactId));
  const secondState = Object.keys(normalized.states).map((artifactId) => getLifecycleState(normalized, artifactId));
  if (JSON.stringify(firstState) !== JSON.stringify(secondState)) {
    errors.push(validationIssue('lifecycle_state_not_deterministic', 'Lifecycle state lookups changed across repeated calls.', 'states'));
    determinismViolations.push('states');
  }

  return deepFreeze({
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes: collectReasonCodes(errors, warnings),
    fingerprintViolations: unique(fingerprintViolations).sort(),
    determinismViolations: unique(determinismViolations).sort()
  });
}

function validateRegistryIntegration(lifecycle = {}, registry = null) {
  const errors = [];
  const warnings = [];
  const registryViolations = [];
  if (!registry) {
    warnings.push(validationIssue('registry_not_supplied', 'Registry integration conformance was not exercised.', 'registry'));
    return deepFreeze({
      valid: true,
      errors,
      warnings,
      reasonCodes: collectReasonCodes(errors, warnings),
      registryViolations
    });
  }
  const registryValidation = validateRegistryConformance(registry);
  if (!registryValidation.valid) {
    errors.push(validationIssue('registry_conformance_failed', 'Supplied registry failed conformance validation.', 'registry'));
    registryViolations.push('registry');
  }
  const lifecycleValidation = validateLifecycleIntegrity(lifecycle, { registry });
  if (!lifecycleValidation.valid) {
    errors.push(validationIssue('lifecycle_registry_binding_failed', 'Lifecycle failed integrity validation against registry public APIs.', 'registry'));
    registryViolations.push(...asArray(lifecycleValidation.registryViolations));
  }
  return deepFreeze({
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes: collectReasonCodes(errors, warnings),
    registryViolations: unique(registryViolations).sort()
  });
}

function validateOfflineBoundary(options = {}) {
  const errors = [];
  const warnings = [];
  const loadedModules = asArray(options.loadedModules);
  const prohibited = ['server.js', 'stateStore', 'scoutScannerService'];
  const violations = loadedModules.filter((moduleName) => prohibited.some((name) => String(moduleName).includes(name)));
  for (const moduleName of violations) {
    errors.push(validationIssue('runtime_import_detected', 'Lifecycle conformance must remain offline-only.', moduleName));
  }
  return deepFreeze({
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes: collectReasonCodes(errors, warnings),
    offlineViolations: unique(violations).sort()
  });
}

function validateAuthorityBoundary(lifecycle = {}) {
  const input = asObject(lifecycle);
  const normalized = normalizeLifecycle(lifecycle);
  const errors = [];
  const warnings = [];
  const authorityViolations = [];
  for (const [scope, artifact] of [['lifecycle', input], ['normalizedLifecycle', normalized]]) {
    for (const field of ['productionImpact', 'decisionImpact', 'executionAuthority']) {
      if (known(artifact[field]) && artifact[field] !== 'none') {
        errors.push(validationIssue('authority_boundary_violation', `${scope}.${field} must remain none.`, `${scope}.${field}`));
        authorityViolations.push(`${scope}.${field}`);
      }
    }
  }
  for (const [index, event] of asArray(input.events).entries()) {
    for (const field of ['productionImpact', 'decisionImpact', 'executionAuthority']) {
      if (known(event[field]) && event[field] !== 'none') {
        errors.push(validationIssue('authority_boundary_violation', `events.${index}.${field} must remain none.`, `events.${index}.${field}`));
        authorityViolations.push(`events.${index}.${field}`);
      }
    }
  }
  return deepFreeze({
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes: collectReasonCodes(errors, warnings),
    authorityViolations: unique(authorityViolations).sort()
  });
}

function validateLifecycleConformance(lifecycle = createLifecycle(), options = {}) {
  const inputBefore = clone(lifecycle);
  const normalized = normalizeLifecycle(lifecycle);
  const stageValidations = {
    lifecycle_state_model: validateLifecycleStateModel(normalized),
    transition_integrity: validateTransitionIntegrity(normalized, options),
    supersession_consistency: validateSupersessionConsistency(normalized, options.registry || {}),
    lifecycle_determinism: validateLifecycleDeterminism(lifecycle),
    registry_integration: validateRegistryIntegration(normalized, options.registry),
    offline_boundary: validateOfflineBoundary(options),
    authority_boundary: validateAuthorityBoundary(lifecycle)
  };
  const stageResults = CONFORMANCE_STAGES.map((stageName) => buildStageResult(stageName, stageValidations[stageName]));
  const errors = stageResults.flatMap((stage) => stage.errors.map((error) => ({ ...error, stageName: stage.stageName })));
  const warnings = stageResults.flatMap((stage) => stage.warnings.map((warning) => ({ ...warning, stageName: stage.stageName })));

  if (JSON.stringify(inputBefore) !== JSON.stringify(lifecycle)) {
    errors.push(validationIssue('lifecycle_input_mutated', 'Lifecycle conformance validation mutated the input lifecycle.', 'lifecycle'));
  }

  const core = {
    schemaVersion: GOVERNANCE_ARTIFACT_LIFECYCLE_CONFORMANCE_SCHEMA_VERSION,
    source: GOVERNANCE_ARTIFACT_LIFECYCLE_CONFORMANCE_SOURCE,
    conformanceId: normalizeString(firstDefined(options.conformanceId, `governance-artifact-lifecycle-conformance:${normalized.lifecycleId}`)),
    lifecycleId: normalized.lifecycleId,
    lifecycleFingerprint: normalized.lifecycleFingerprint,
    valid: errors.length === 0,
    stageResults,
    summary: summarizeLifecycleConformance({ stageResults, errors, warnings }),
    errors,
    warnings,
    reasonCodes: collectReasonCodes(errors, warnings),
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
  return deepFreeze({
    ...core,
    conformanceFingerprint: buildFingerprintFromProjection(core)
  });
}

function summarizeLifecycleConformance(result = {}) {
  const stageResults = asArray(result.stageResults);
  const summary = {
    stageCount: stageResults.length,
    passedStageCount: stageResults.filter((stage) => stage.valid).length,
    failedStageCount: stageResults.filter((stage) => !stage.valid).length,
    warningCount: asArray(result.warnings).length + stageResults.reduce((count, stage) => count + asArray(stage.warnings).length, 0),
    errorCount: asArray(result.errors).length + stageResults.reduce((count, stage) => count + asArray(stage.errors).length, 0),
    stageStatusSummary: {},
    reasonCodes: collectReasonCodes(result.errors, result.warnings),
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
  for (const stage of stageResults) {
    const key = `${stage.stageName}:${stage.status}`;
    summary.stageStatusSummary[key] = (summary.stageStatusSummary[key] || 0) + 1;
  }
  summary.stageStatusSummary = Object.fromEntries(Object.entries(summary.stageStatusSummary).sort(([left], [right]) => left.localeCompare(right)));
  return deepFreeze(summary);
}

module.exports = {
  CONFORMANCE_STAGES,
  GOVERNANCE_ARTIFACT_LIFECYCLE_CONFORMANCE_SCHEMA_VERSION,
  GOVERNANCE_ARTIFACT_LIFECYCLE_CONFORMANCE_SOURCE,
  summarizeLifecycleConformance,
  validateLifecycleConformance,
  validateLifecycleDeterminism,
  validateLifecycleStateModel,
  validateSupersessionConsistency,
  validateTransitionIntegrity
};
