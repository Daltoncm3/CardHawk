# Governance Review Session Manager

Phase 16.2A adds an offline Governance Review Session Manager.

## Purpose

The session manager coordinates offline review sessions that consume immutable governance artifacts. It groups Review Package references for Dalton's governance review while preserving registry bindings, lifecycle state, deterministic fingerprints, and authority boundaries.

It is offline-only. It does not modify `server.js`, execute production engines, run Signal migrations, run shadow comparisons, alter governance execution, persist data, or integrate with production runtime.

## Public API

`validation/governanceReviewSessionManager.js` exports:

- `createReviewSession`
- `validateReviewSession`
- `attachReviewPackage`
- `getReviewSessionState`
- `summarizeReviewSession`
- `validateReviewSessionIntegrity`

It also exports deterministic fingerprint helpers for future offline tooling.

## Session Model

A review session contains:

- schema and source metadata
- session ID
- creation and update timestamps
- reviewer
- session purpose
- session status
- immutable Review Package references
- deterministic package summaries
- non-authoritative boundary fields
- session fingerprint

Review sessions hold references and optional snapshots. They never recompute Signal evidence, governance reports, production decisions, or review-package contents.

## Review Package References

Each attached package reference preserves:

- package ID
- package fingerprint
- package schema version
- listing ID
- marketplace
- package creation timestamp
- attachment timestamp
- registry ID and fingerprint
- lifecycle state
- review readiness
- optional cloned package snapshot
- deterministic reference fingerprint

Package references are immutable. `attachReviewPackage()` returns a new session object rather than mutating the previous session.

## Registry Integration

Registry integration uses documented public APIs only:

- `getArtifact`
- `getArtifactByFingerprint`
- `normalizeRegistry`
- registry conformance validation during integrity checks

The session manager never changes registry behavior or writes registry state.

## Lifecycle Integration

Lifecycle integration uses documented public APIs only:

- `getLifecycleState`
- `validateLifecycleIntegrity`

Lifecycle state is copied into session references for reviewer visibility. Integrity validation can compare the stored state against the lifecycle manager state and report mismatches.

## Session States

Supported session statuses are:

- `empty`
- `review_ready`
- `review_ready_with_warnings`
- `blocked`
- `invalid`
- `unknown`

Sessions are blocked when duplicate packages, invalid references, archived packages, superseded packages, or missing registry references are detected.

## Deterministic Summaries

Session summaries include:

- package count
- lifecycle state summary
- readiness summary
- marketplace summary
- authority boundary fields
- session fingerprint

Summaries are deterministic for identical inputs.

## Integrity Validation

`validateReviewSessionIntegrity()` checks:

- session schema and source
- required fields
- duplicate package IDs and fingerprints
- session fingerprint preservation
- reference fingerprint preservation
- registry lookup consistency
- lifecycle state consistency
- registry conformance when supplied
- lifecycle integrity when supplied
- non-authoritative boundary fields
- input immutability

Validation returns structured errors, warnings, reason codes, and categorized violations.

## Authority Boundary

Review sessions remain evidence-only:

- `productionImpact: "none"`
- `decisionImpact: "none"`
- `executionAuthority: "none"`

The manager cannot approve, reject, deploy, execute, or modify production behavior.

## Future Use

Future offline workspace tooling can use review sessions to:

- group Review Packages for Dalton review
- surface lifecycle and registry readiness
- detect stale or superseded artifacts
- summarize package readiness across a workspace
- prepare inputs for governance certification

All future use must keep sessions non-authoritative and offline-only.
