# Governance Artifact Lifecycle Conformance

Phase 16.1B adds an offline conformance validator for the Governance Artifact Lifecycle Manager.

## Purpose

The conformance suite verifies that lifecycle manager artifacts comply with the governance contracts established by Phases 15, 16.0A, 16.0B, and 16.1A.

It validates immutable lifecycle history and registry relationships only. It does not execute production engines, run Signal migrations, run shadow comparisons, alter governance execution, persist state, or integrate with production runtime.

## Public API

`validation/governanceArtifactLifecycleConformance.js` exports:

- `validateLifecycleConformance`
- `validateLifecycleStateModel`
- `validateTransitionIntegrity`
- `validateSupersessionConsistency`
- `validateLifecycleDeterminism`
- `summarizeLifecycleConformance`

## Conformance Stages

Complete conformance evaluates:

- `lifecycle_state_model`
- `transition_integrity`
- `supersession_consistency`
- `lifecycle_determinism`
- `registry_integration`
- `offline_boundary`
- `authority_boundary`

Each stage returns structured errors, warnings, reason codes, and deterministic status.

## State Model Validation

The validator checks that lifecycle artifacts:

- use supported schema and source values
- preserve immutable lifecycle and event objects
- contain only supported lifecycle states
- derive stable state through `getLifecycleState()`
- preserve immutable transition history

Supported states remain:

- `registered`
- `active`
- `superseded`
- `archived`
- `unknown`

## Transition Integrity

The validator replays lifecycle history through the public lifecycle APIs. It confirms valid transitions are accepted and invalid transitions are rejected, including the terminal nature of archived artifacts.

Allowed transitions remain those defined by the lifecycle manager:

- `unknown -> registered`
- `unknown -> active`
- `registered -> active`
- `registered -> superseded`
- `registered -> archived`
- `active -> superseded`
- `active -> archived`
- `superseded -> archived`

## Supersession Consistency

Supersession validation uses lifecycle manager and registry public APIs to verify that superseded artifacts are detected deterministically and retain artifact IDs, fingerprints, lifecycle state, and successor references when available.

The conformance layer does not repair supersession chains or mutate registry registrations.

## Determinism

The validator confirms:

- lifecycle fingerprints are deterministic
- event fingerprints are deterministic
- lifecycle summaries are deterministic
- lifecycle state lookups are deterministic
- repeated conformance runs produce stable summaries

## Registry Integration

When a registry is supplied, conformance validates the registry through the Governance Artifact Registry Conformance suite and validates lifecycle integrity against the registry through public APIs only.

The lifecycle conformance layer does not modify registry behavior.

## Offline Boundary

The conformance suite is offline-only. It must not import:

- `server.js`
- StateStore persistence
- scanner services
- production engine execution paths

## Authority Boundary

Lifecycle conformance reports remain evidence-only:

- `productionImpact: "none"`
- `decisionImpact: "none"`
- `executionAuthority: "none"`

The validator cannot approve, reject, deploy, execute, or modify production behavior.

## Future Use

Future governance tooling can use lifecycle conformance before:

- accepting lifecycle artifacts into a workspace
- certifying a review package as ready
- generating lifecycle reports
- validating superseded or archived artifact handling

All future use must keep lifecycle conformance non-authoritative.
