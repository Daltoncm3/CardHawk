'use strict';

const { asArray, asObject, unique } = require('./canonicalValidationCore');
const { buildFingerprintFromProjection } = require('./fingerprintProjection');
const { clone, firstDefined } = require('./phase8GovernanceCore');
const {
  detectSupersession,
  getArtifact,
  getArtifactByFingerprint,
  listArtifacts,
  normalizeRegistry
} = require('./governanceArtifactRegistry');
const { validateRegistryConformance } = require('./governanceArtifactRegistryConformance');

const GOVERNANCE_ARTIFACT_LIFECYCLE_SCHEMA_VERSION = '1.0.0';
const GOVERNANCE_ARTIFACT_LIFECYCLE_SOURCE = 'governance_artifact_lifecycle_manager';
const UNKNOWN_VALUE = 'unknown';

const LIFECYCLE_STATES = Object.freeze({
  REGISTERED: 'registered',
  ACTIVE: 'active',
  SUPERSEDED: 'superseded',
  ARCHIVED: 'archived',
  UNKNOWN: UNKNOWN_VALUE
});

const LIFECYCLE_EVENT_TYPES = Object.freeze({
  REGISTERED: 'registered',
  ACTIVATED: 'activated',
  SUPERSEDED: 'superseded',
  ARCHIVED: 'archived'
});

const ALLOWED_TRANSITIONS = Object.freeze({
  [UNKNOWN_VALUE]: [LIFECYCLE_STATES.REGISTERED, LIFECYCLE_STATES.ACTIVE],
  [LIFECYCLE_STATES.REGISTERED]: [LIFECYCLE_STATES.ACTIVE, LIFECYCLE_STATES.SUPERSEDED, LIFECYCLE_STATES.ARCHIVED],
  [LIFECYCLE_STATES.ACTIVE]: [LIFECYCLE_STATES.SUPERSEDED, LIFECYCLE_STATES.ARCHIVED],
  [LIFECYCLE_STATES.SUPERSEDED]: [LIFECYCLE_STATES.ARCHIVED],
  [LIFECYCLE_STATES.ARCHIVED]: []
});

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

function normalizeState(value) {
  const state = normalizeString(value).toLowerCase();
  return Object.values(LIFECYCLE_STATES).includes(state) ? state : state;
}

function eventNextState(event = {}) {
  if (known(event.nextState)) return normalizeState(event.nextState);
  const eventType = normalizeString(event.eventType).toLowerCase();
  if (eventType === LIFECYCLE_EVENT_TYPES.REGISTERED) return LIFECYCLE_STATES.REGISTERED;
  if (eventType === LIFECYCLE_EVENT_TYPES.ACTIVATED) return LIFECYCLE_STATES.ACTIVE;
  if (eventType === LIFECYCLE_EVENT_TYPES.SUPERSEDED) return LIFECYCLE_STATES.SUPERSEDED;
  if (eventType === LIFECYCLE_EVENT_TYPES.ARCHIVED) return LIFECYCLE_STATES.ARCHIVED;
  return UNKNOWN_VALUE;
}

function artifactIdFrom(input = {}) {
  if (typeof input === 'string') return normalizeString(input);
  const object = asObject(input);
  return normalizeString(firstDefined(
    object.artifactId,
    object.bundleId,
    object.reportId,
    object.bindingId,
    object.packageId,
    object.id
  ));
}

function artifactFingerprintFrom(input = {}) {
  const object = asObject(input);
  return normalizeString(firstDefined(
    object.artifactFingerprint,
    object.bundleFingerprint,
    object.reportFingerprint,
    object.bindingFingerprint,
    object.packageFingerprint,
    object.fingerprint
  ));
}

function sortEvents(events = []) {
  return asArray(events)
    .map((event) => clone(event))
    .sort((left, right) => `${left.eventAt}|${left.artifactId}|${left.eventId}`.localeCompare(`${right.eventAt}|${right.artifactId}|${right.eventId}`));
}

function buildLifecycleEventFingerprint(event = {}) {
  const projection = clone(event);
  delete projection.eventFingerprint;
  return buildFingerprintFromProjection(projection);
}

function buildLifecycleFingerprint(lifecycle = {}) {
  const projection = clone(lifecycle);
  delete projection.lifecycleFingerprint;
  return buildFingerprintFromProjection(projection);
}

function createLifecycleEvent(event = {}, lifecycle = {}, options = {}) {
  const artifact = asObject(firstDefined(event.artifact, options.artifact, {}));
  const artifactId = artifactIdFrom(firstDefined(event.artifactId, artifact));
  const artifactFingerprint = normalizeString(firstDefined(event.artifactFingerprint, artifactFingerprintFrom(artifact)));
  const nextState = eventNextState(event);
  const priorState = normalizeState(firstDefined(
    event.priorState,
    getLifecycleState(lifecycle, artifactId).currentState,
    UNKNOWN_VALUE
  ));
  const eventAt = normalizeDate(firstDefined(event.eventAt, event.createdAt, options.eventAt, options.asOf, UNKNOWN_VALUE));
  const core = {
    schemaVersion: GOVERNANCE_ARTIFACT_LIFECYCLE_SCHEMA_VERSION,
    source: GOVERNANCE_ARTIFACT_LIFECYCLE_SOURCE,
    eventId: normalizeString(firstDefined(event.eventId, `governance-artifact-lifecycle:${artifactId}:${nextState}:${eventAt}`)),
    eventType: normalizeString(firstDefined(event.eventType, nextState)),
    artifactId,
    artifactFingerprint,
    priorState,
    nextState,
    eventAt,
    reason: normalizeString(firstDefined(event.reason, options.reason, UNKNOWN_VALUE)),
    registryId: normalizeString(firstDefined(event.registryId, options.registryId, lifecycle.registryId, UNKNOWN_VALUE)),
    registryFingerprint: normalizeString(firstDefined(event.registryFingerprint, options.registryFingerprint, lifecycle.registryFingerprint, UNKNOWN_VALUE)),
    metadata: clone(asObject(firstDefined(event.metadata, options.metadata, {}))),
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
  return deepFreeze({
    ...core,
    eventFingerprint: buildLifecycleEventFingerprint(core)
  });
}

function deriveStates(events = []) {
  const states = {};
  for (const event of sortEvents(events)) {
    const existing = states[event.artifactId] || {
      artifactId: event.artifactId,
      artifactFingerprint: event.artifactFingerprint,
      currentState: UNKNOWN_VALUE,
      registeredAt: UNKNOWN_VALUE,
      activatedAt: UNKNOWN_VALUE,
      supersededAt: UNKNOWN_VALUE,
      archivedAt: UNKNOWN_VALUE,
      history: []
    };
    const next = {
      ...existing,
      artifactFingerprint: event.artifactFingerprint,
      currentState: event.nextState,
      history: [...existing.history, event.eventId]
    };
    if (event.nextState === LIFECYCLE_STATES.REGISTERED && next.registeredAt === UNKNOWN_VALUE) next.registeredAt = event.eventAt;
    if (event.nextState === LIFECYCLE_STATES.ACTIVE) next.activatedAt = event.eventAt;
    if (event.nextState === LIFECYCLE_STATES.SUPERSEDED) next.supersededAt = event.eventAt;
    if (event.nextState === LIFECYCLE_STATES.ARCHIVED) next.archivedAt = event.eventAt;
    states[event.artifactId] = next;
  }
  return Object.fromEntries(Object.entries(states).sort(([left], [right]) => left.localeCompare(right)));
}

function summarizeStates(states = {}) {
  const stateSummary = {};
  for (const state of Object.values(asObject(states))) {
    stateSummary[state.currentState] = (stateSummary[state.currentState] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(stateSummary).sort(([left], [right]) => left.localeCompare(right)));
}

function createLifecycle(input = {}) {
  const events = sortEvents(input.events);
  const states = deriveStates(events);
  const summary = {
    artifactCount: Object.keys(states).length,
    eventCount: events.length,
    stateSummary: summarizeStates(states),
    activeCount: Object.values(states).filter((state) => state.currentState === LIFECYCLE_STATES.ACTIVE).length,
    supersededCount: Object.values(states).filter((state) => state.currentState === LIFECYCLE_STATES.SUPERSEDED).length,
    archivedCount: Object.values(states).filter((state) => state.currentState === LIFECYCLE_STATES.ARCHIVED).length
  };
  const core = {
    schemaVersion: GOVERNANCE_ARTIFACT_LIFECYCLE_SCHEMA_VERSION,
    source: GOVERNANCE_ARTIFACT_LIFECYCLE_SOURCE,
    lifecycleId: normalizeString(firstDefined(input.lifecycleId, 'governance-artifact-lifecycle')),
    registryId: normalizeString(firstDefined(input.registryId, UNKNOWN_VALUE)),
    registryFingerprint: normalizeString(firstDefined(input.registryFingerprint, UNKNOWN_VALUE)),
    createdAt: normalizeDate(firstDefined(input.createdAt, UNKNOWN_VALUE)),
    updatedAt: normalizeDate(firstDefined(input.updatedAt, input.createdAt, UNKNOWN_VALUE)),
    events,
    states,
    summary,
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
  return deepFreeze({
    ...core,
    lifecycleFingerprint: buildLifecycleFingerprint(core)
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

function validateLifecycleTransition(lifecycle = {}, event = {}, options = {}) {
  const normalized = normalizeLifecycle(lifecycle);
  const lifecycleEvent = createLifecycleEvent(event, normalized, options);
  const errors = [];
  const warnings = [];
  const lifecycleViolations = [];
  const authorityViolations = [];
  const registryViolations = [];
  const fingerprintViolations = [];

  if (!Object.values(LIFECYCLE_STATES).includes(lifecycleEvent.nextState)) {
    errors.push(validationIssue('invalid_lifecycle_state', 'Lifecycle event nextState is unsupported.', 'nextState'));
    lifecycleViolations.push('nextState');
  }
  if (!Object.values(LIFECYCLE_STATES).includes(lifecycleEvent.priorState)) {
    errors.push(validationIssue('invalid_lifecycle_state', 'Lifecycle event priorState is unsupported.', 'priorState'));
    lifecycleViolations.push('priorState');
  }
  if (lifecycleEvent.priorState !== lifecycleEvent.nextState && !asArray(ALLOWED_TRANSITIONS[lifecycleEvent.priorState]).includes(lifecycleEvent.nextState)) {
    errors.push(validationIssue('invalid_lifecycle_transition', `${lifecycleEvent.priorState} cannot transition to ${lifecycleEvent.nextState}.`, 'transition'));
    lifecycleViolations.push(`${lifecycleEvent.priorState}->${lifecycleEvent.nextState}`);
  }
  for (const field of ['productionImpact', 'decisionImpact', 'executionAuthority']) {
    if (lifecycleEvent[field] !== 'none') {
      errors.push(validationIssue('authority_boundary_violation', `${field} must remain none.`, field));
      authorityViolations.push(field);
    }
  }
  if (buildLifecycleEventFingerprint(lifecycleEvent) !== lifecycleEvent.eventFingerprint) {
    errors.push(validationIssue('event_fingerprint_mismatch', 'Lifecycle event fingerprint does not match event contents.', 'eventFingerprint'));
    fingerprintViolations.push('eventFingerprint');
  }

  if (options.registry) {
    const registry = normalizeRegistry(options.registry);
    const byId = getArtifact(registry, lifecycleEvent.artifactId);
    const byFingerprint = getArtifactByFingerprint(registry, lifecycleEvent.artifactFingerprint);
    if (!byId) {
      errors.push(validationIssue('artifact_not_registered', 'Lifecycle event artifactId is not present in the registry.', 'artifactId'));
      registryViolations.push('artifactId');
    }
    if (!byFingerprint) {
      errors.push(validationIssue('artifact_fingerprint_not_registered', 'Lifecycle event artifactFingerprint is not present in the registry.', 'artifactFingerprint'));
      registryViolations.push('artifactFingerprint');
    }
    if (byId && byId.artifactFingerprint !== lifecycleEvent.artifactFingerprint) {
      errors.push(validationIssue('artifact_fingerprint_mismatch', 'Lifecycle event fingerprint does not match registered artifact.', 'artifactFingerprint'));
      fingerprintViolations.push('artifactFingerprint');
    }
  }

  return deepFreeze({
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes: reasonCodes(errors, warnings),
    lifecycleViolations: unique(lifecycleViolations).sort(),
    authorityViolations: unique(authorityViolations).sort(),
    registryViolations: unique(registryViolations).sort(),
    fingerprintViolations: unique(fingerprintViolations).sort(),
    event: lifecycleEvent
  });
}

function registerLifecycleEvent(lifecycle = {}, event = {}, options = {}) {
  const normalized = normalizeLifecycle(lifecycle);
  const validation = validateLifecycleTransition(normalized, event, options);
  if (!validation.valid) {
    return deepFreeze({
      registered: false,
      lifecycle: normalized,
      event: validation.event,
      validation
    });
  }
  const nextLifecycle = createLifecycle({
    lifecycleId: normalized.lifecycleId,
    registryId: normalizeString(firstDefined(validation.event.registryId, normalized.registryId)),
    registryFingerprint: normalizeString(firstDefined(validation.event.registryFingerprint, normalized.registryFingerprint)),
    createdAt: normalized.createdAt,
    updatedAt: validation.event.eventAt,
    events: [...normalized.events, validation.event]
  });
  return deepFreeze({
    registered: true,
    lifecycle: nextLifecycle,
    event: validation.event,
    validation
  });
}

function getLifecycleState(lifecycle = {}, artifactOrId = {}) {
  const normalized = normalizeLifecycle(lifecycle);
  const id = artifactIdFrom(artifactOrId);
  const state = normalized.states[id];
  return state ? deepFreeze(clone(state)) : deepFreeze({
    artifactId: id,
    artifactFingerprint: artifactFingerprintFrom(artifactOrId),
    currentState: UNKNOWN_VALUE,
    registeredAt: UNKNOWN_VALUE,
    activatedAt: UNKNOWN_VALUE,
    supersededAt: UNKNOWN_VALUE,
    archivedAt: UNKNOWN_VALUE,
    history: []
  });
}

function detectSupersededArtifacts(lifecycle = {}, registry = {}) {
  const normalizedLifecycle = normalizeLifecycle(lifecycle);
  const normalizedRegistry = normalizeRegistry(registry);
  const superseded = [];
  for (const registration of listArtifacts(normalizedRegistry)) {
    const lifecycleState = getLifecycleState(normalizedLifecycle, registration.artifactId);
    const supersession = detectSupersession(normalizedRegistry, registration.artifactId);
    if (lifecycleState.currentState === LIFECYCLE_STATES.SUPERSEDED || supersession.superseded) {
      superseded.push({
        artifactId: registration.artifactId,
        artifactFingerprint: registration.artifactFingerprint,
        lifecycleState: lifecycleState.currentState,
        supersededBy: clone(supersession.supersededBy)
      });
    }
  }
  return deepFreeze(superseded.sort((left, right) => left.artifactId.localeCompare(right.artifactId)));
}

function summarizeLifecycle(lifecycle = {}) {
  const normalized = normalizeLifecycle(lifecycle);
  return deepFreeze({
    schemaVersion: GOVERNANCE_ARTIFACT_LIFECYCLE_SCHEMA_VERSION,
    source: GOVERNANCE_ARTIFACT_LIFECYCLE_SOURCE,
    lifecycleId: normalized.lifecycleId,
    registryId: normalized.registryId,
    registryFingerprint: normalized.registryFingerprint,
    artifactCount: normalized.summary.artifactCount,
    eventCount: normalized.summary.eventCount,
    stateSummary: clone(normalized.summary.stateSummary),
    activeCount: normalized.summary.activeCount,
    supersededCount: normalized.summary.supersededCount,
    archivedCount: normalized.summary.archivedCount,
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none',
    lifecycleFingerprint: normalized.lifecycleFingerprint
  });
}

function validateLifecycleIntegrity(lifecycle = {}, options = {}) {
  const input = asObject(lifecycle);
  const inputBefore = clone(lifecycle);
  const normalized = normalizeLifecycle(lifecycle);
  const errors = [];
  const warnings = [];
  const lifecycleViolations = [];
  const authorityViolations = [];
  const fingerprintViolations = [];
  const registryViolations = [];

  if (known(input.lifecycleFingerprint) && buildLifecycleFingerprint(input) !== input.lifecycleFingerprint) {
    errors.push(validationIssue('lifecycle_fingerprint_mismatch', 'Lifecycle fingerprint does not match supplied lifecycle contents.', 'lifecycleFingerprint'));
    fingerprintViolations.push('lifecycleFingerprint');
  }
  if (buildLifecycleFingerprint(normalized) !== normalized.lifecycleFingerprint) {
    errors.push(validationIssue('lifecycle_fingerprint_mismatch', 'Lifecycle fingerprint does not match normalized lifecycle contents.', 'lifecycleFingerprint'));
    fingerprintViolations.push('lifecycleFingerprint');
  }
  for (const field of ['productionImpact', 'decisionImpact', 'executionAuthority']) {
    if (known(input[field]) && input[field] !== 'none') {
      errors.push(validationIssue('authority_boundary_violation', `${field} must remain none.`, field));
      authorityViolations.push(field);
    }
    if (normalized[field] !== 'none') {
      errors.push(validationIssue('authority_boundary_violation', `${field} must remain none.`, field));
      authorityViolations.push(field);
    }
  }

  let replay = createLifecycle({
    lifecycleId: normalized.lifecycleId,
    registryId: normalized.registryId,
    registryFingerprint: normalized.registryFingerprint,
    createdAt: normalized.createdAt
  });
  for (const [index, rawEvent] of asArray(input.events).entries()) {
    if (known(rawEvent.eventFingerprint) && buildLifecycleEventFingerprint(rawEvent) !== rawEvent.eventFingerprint) {
      errors.push(validationIssue('event_fingerprint_mismatch', 'Lifecycle event fingerprint does not match supplied event contents.', `events.${index}.eventFingerprint`));
      fingerprintViolations.push(`events.${index}.eventFingerprint`);
    }
    for (const field of ['productionImpact', 'decisionImpact', 'executionAuthority']) {
      if (known(rawEvent[field]) && rawEvent[field] !== 'none') {
        errors.push(validationIssue('authority_boundary_violation', `${field} must remain none.`, `events.${index}.${field}`));
        authorityViolations.push(`events.${index}.${field}`);
      }
    }
  }

  for (const [index, event] of normalized.events.entries()) {
    if (buildLifecycleEventFingerprint(event) !== event.eventFingerprint) {
      errors.push(validationIssue('event_fingerprint_mismatch', 'Lifecycle event fingerprint does not match event contents.', `events.${index}.eventFingerprint`));
      fingerprintViolations.push(`events.${index}.eventFingerprint`);
    }
    const validation = validateLifecycleTransition(replay, event, options);
    if (!validation.valid) {
      errors.push(...validation.errors.map((error) => ({ ...error, field: `events.${index}.${error.field || ''}`.replace(/\.$/, '') })));
      lifecycleViolations.push(...validation.lifecycleViolations);
      authorityViolations.push(...validation.authorityViolations);
      fingerprintViolations.push(...validation.fingerprintViolations);
      registryViolations.push(...validation.registryViolations);
    } else {
      replay = registerLifecycleEvent(replay, event, options).lifecycle;
    }
  }

  if (options.registry) {
    const registryValidation = validateRegistryConformance(options.registry);
    if (!registryValidation.valid) {
      errors.push(validationIssue('registry_conformance_failed', 'Bound registry failed conformance validation.', 'registry'));
      registryViolations.push('registry');
    }
  }

  if (JSON.stringify(inputBefore) !== JSON.stringify(lifecycle)) {
    errors.push(validationIssue('lifecycle_input_mutated', 'Lifecycle validation mutated the input object.', 'lifecycle'));
    lifecycleViolations.push('lifecycle');
  }

  return deepFreeze({
    valid: errors.length === 0,
    errors,
    warnings,
    reasonCodes: reasonCodes(errors, warnings),
    lifecycleViolations: unique(lifecycleViolations).sort(),
    authorityViolations: unique(authorityViolations).sort(),
    fingerprintViolations: unique(fingerprintViolations).sort(),
    registryViolations: unique(registryViolations).sort()
  });
}

module.exports = {
  ALLOWED_TRANSITIONS,
  GOVERNANCE_ARTIFACT_LIFECYCLE_SCHEMA_VERSION,
  GOVERNANCE_ARTIFACT_LIFECYCLE_SOURCE,
  LIFECYCLE_EVENT_TYPES,
  LIFECYCLE_STATES,
  buildLifecycleEventFingerprint,
  buildLifecycleFingerprint,
  createLifecycle,
  registerLifecycleEvent,
  validateLifecycleTransition,
  getLifecycleState,
  detectSupersededArtifacts,
  summarizeLifecycle,
  validateLifecycleIntegrity
};
