# Governance Artifact Registry Conformance

Phase 16.0B adds an offline conformance validator for the Governance Artifact Registry.

## Purpose

The conformance suite verifies that a Governance Artifact Registry instance follows the immutable, offline, non-authoritative contract established by Phase 15 governance architecture and Phase 16.0A registry implementation.

It validates existing registry artifacts only. It does not persist data, execute production engines, run Signal migrations, run shadow comparisons, alter governance execution, or integrate with runtime code.

## Public API

`validation/governanceArtifactRegistryConformance.js` exports:

- `validateRegistryConformance`
- `validateArtifactIntegrity`
- `validateFingerprintConsistency`
- `validateSupersessionChain`
- `validateSchemaCompatibility`
- `summarizeConformanceResults`

## Validation Stages

The complete conformance report evaluates:

- `artifact_integrity`
- `fingerprint_consistency`
- `supersession_chain`
- `schema_compatibility`
- `registry_consistency`
- `duplicate_rejection`
- `offline_boundary`
- `authority_boundary`

Each stage returns structured errors, warnings, reason codes, and stage status. The top-level report aggregates these into deterministic conformance results.

## Contract Checks

The validator checks that:

- registry objects and registration arrays are immutable
- registrations validate through the Phase 16.0A registry validator
- artifact IDs and fingerprints are unique
- lookup by artifact ID is stable
- lookup by fingerprint is stable
- registry and registration fingerprints are deterministic
- summaries and artifact listings are deterministic
- supersession references are explicit and resolvable
- registry and registration schema versions are compatible
- duplicate registrations are rejected through the public registry API
- authority fields remain `none`
- runtime-only modules are not required by the conformance layer

## Supersession Integrity

Supersession is validated as an artifact relationship, not as mutation. A newer registration may reference a prior artifact through `supersedesArtifactId` or `supersedesArtifactFingerprint`. The conformance layer verifies that those references point to existing registered artifacts.

The validator also rejects self-supersession and reports unresolved `supersededBy` references.

## Offline Boundary

The conformance suite imports only offline validation utilities and the Governance Artifact Registry. It must not import:

- `server.js`
- StateStore persistence
- scanner services
- production engine execution paths

This keeps Phase 16.0B validation separate from production behavior.

## Authority Boundary

Conformance reports and validated registries remain evidence-only:

- `productionImpact: "none"`
- `decisionImpact: "none"`
- `executionAuthority: "none"`

The validator cannot approve, reject, deploy, execute, or modify governance artifacts.

## Future Use

Future governance tooling can use this conformance validator before:

- importing a registry
- merging registry snapshots
- generating governance workspace summaries
- binding evidence bundles to review packages
- certifying a governance artifact chain

Those future tools should continue to consume the conformance result as evidence only.
