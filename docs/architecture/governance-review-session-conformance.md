# Governance Review Session Conformance

Phase 16.2B adds an offline conformance validator for the Governance Review Session Manager.

## Purpose

The conformance suite verifies that review session artifacts follow the governance contracts established by Phases 15 through 16.2A.

It validates immutable sessions, package references, registry binding, lifecycle binding, deterministic summaries, and non-authoritative behavior. It does not execute production engines, run Signal migrations, run shadow comparisons, alter governance execution, persist data, or integrate with production runtime.

## Public API

`validation/governanceReviewSessionConformance.js` exports:

- `validateReviewSessionConformance`
- `validateSessionStateModel`
- `validatePackageBindings`
- `validateSessionDeterminism`
- `validateSessionIntegrity`
- `summarizeReviewSessionConformance`

## Conformance Stages

Complete conformance evaluates:

- `session_state_model`
- `package_bindings`
- `session_determinism`
- `session_integrity`
- `registry_integration`
- `lifecycle_integration`
- `offline_boundary`
- `authority_boundary`

Each stage returns structured errors, warnings, reason codes, and deterministic status.

## State Model Validation

The validator checks that sessions:

- use supported schema and source values
- preserve supported session statuses
- expose immutable session and package-reference objects
- derive stable state through `getReviewSessionState()`

Supported statuses remain:

- `empty`
- `review_ready`
- `review_ready_with_warnings`
- `blocked`
- `invalid`
- `unknown`

## Package Binding Validation

Package binding conformance verifies:

- valid Review Package attachments succeed through `attachReviewPackage()`
- duplicate package attachments are rejected
- package reference fingerprints are deterministic
- registered packages are located through registry public APIs
- lifecycle state is read through lifecycle public APIs

The validator never mutates review sessions, registry entries, lifecycle history, or package snapshots.

## Determinism

The validator confirms:

- session fingerprints are deterministic
- package reference fingerprints are deterministic
- session summaries are deterministic
- session state is deterministic
- repeated conformance runs produce stable summaries

## Registry and Lifecycle Integration

When supplied, the validator delegates registry checks to Governance Artifact Registry Conformance and lifecycle checks to Governance Artifact Lifecycle Conformance.

Integration uses public APIs only and does not change registry or lifecycle behavior.

## Offline Boundary

The conformance suite must not import:

- `server.js`
- StateStore persistence
- scanner services
- production engine execution paths

## Authority Boundary

Review session conformance reports remain evidence-only:

- `productionImpact: "none"`
- `decisionImpact: "none"`
- `executionAuthority: "none"`

The validator cannot approve, reject, deploy, execute, or modify production behavior.

## Future Use

Future offline governance tooling can use this conformance suite before:

- accepting a review session into an offline workspace
- certifying Review Package groups
- generating governance review reports
- validating registry/lifecycle/package readiness

All future use must keep session conformance non-authoritative.
