# Governance Artifact Lifecycle Manager

Phase 16.1A adds an offline lifecycle manager for Governance Artifact Registry entries.

## Purpose

The lifecycle manager coordinates immutable governance artifact state transitions after artifacts have been registered. It is an offline governance utility only. It does not persist artifacts, execute production engines, run Signal migrations, run shadow comparisons, alter governance execution, or integrate with production runtime.

## Public API

`validation/governanceArtifactLifecycleManager.js` exports:

- `registerLifecycleEvent`
- `validateLifecycleTransition`
- `getLifecycleState`
- `detectSupersededArtifacts`
- `summarizeLifecycle`
- `validateLifecycleIntegrity`

It also exports schema constants and fingerprint helpers for deterministic offline validation.

## Lifecycle States

Supported artifact states are:

- `registered`
- `active`
- `superseded`
- `archived`
- `unknown`

Allowed transitions are:

- `unknown -> registered`
- `unknown -> active`
- `registered -> active`
- `registered -> superseded`
- `registered -> archived`
- `active -> superseded`
- `active -> archived`
- `superseded -> archived`

Archived artifacts are terminal.

## Lifecycle Events

Lifecycle changes are represented as immutable events. Each event records:

- schema and source
- event ID and event type
- artifact ID
- artifact fingerprint
- prior state
- next state
- event timestamp
- registry ID
- registry fingerprint
- reason and metadata
- non-authoritative boundary fields
- deterministic event fingerprint

`registerLifecycleEvent()` returns a new lifecycle object. It never mutates the previous lifecycle.

## Registry Integration

Registry integration happens only through documented registry APIs:

- `getArtifact`
- `getArtifactByFingerprint`
- `detectSupersession`
- `listArtifacts`
- `normalizeRegistry`

The lifecycle manager does not change registry behavior and does not write registry data.

## Supersession

Supersession remains explicit. The lifecycle manager can mark an artifact as `superseded` through lifecycle events and can also detect superseded artifacts from registry supersession relationships.

This allows governance tooling to distinguish:

- artifacts whose lifecycle state is explicitly superseded
- artifacts superseded by a newer registry entry
- artifacts that are archived for historical audit

## Integrity Validation

`validateLifecycleIntegrity()` verifies:

- lifecycle fingerprint determinism
- event fingerprint determinism
- valid lifecycle transitions
- registry conformance when a registry is supplied
- registry binding by artifact ID and fingerprint
- non-authoritative boundary fields
- input immutability

Validation produces structured errors, warnings, reason codes, and categorized violations.

## Authority Boundaries

Lifecycle artifacts are evidence-only:

- `productionImpact: "none"`
- `decisionImpact: "none"`
- `executionAuthority: "none"`

The lifecycle manager cannot approve, reject, deploy, execute, or modify production behavior.

## Future Use

Future offline governance tools can use the lifecycle manager to:

- track Evidence Bundle review status
- track Governance Review Report supersession
- track Review Package binding archival
- build registry lifecycle reports
- block certification when required artifacts are superseded or archived

Those future tools must continue to treat lifecycle state as governance evidence only.
