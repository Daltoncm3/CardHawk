# Governance Artifact Registry

Phase 16.0A adds the offline Governance Artifact Registry.

## Purpose

The registry tracks immutable governance artifacts created by the Phase 15 Signal governance architecture:

- Signal Governance Evidence Bundles
- Signal Governance Review Reports
- Review Package Signal Bindings
- future workspace summaries and Signal validation results

It records artifact IDs, fingerprints, schema versions, creation timestamps, registration timestamps, artifact types, and supersession relationships.

The registry is offline-only. It does not persist by itself, execute engines, run Signal migrations, run shadow comparisons, alter governance execution, or integrate with production runtime.

## Public API

`validation/governanceArtifactRegistry.js` exports:

- `registerArtifact`
- `getArtifact`
- `getArtifactByFingerprint`
- `listArtifacts`
- `validateArtifactRegistration`
- `detectSupersession`
- `summarizeRegistry`

It also exports construction and fingerprint helpers for tests and future offline tooling:

- `createGovernanceArtifactRegistry`
- `createArtifactRegistration`
- `normalizeRegistry`
- `buildRegistrationFingerprint`
- `buildGovernanceArtifactRegistryFingerprint`

## Registration Shape

Each registration includes:

- `schemaVersion`
- `source`
- `registrationId`
- `artifactId`
- `artifactType`
- `artifactSchemaVersion`
- `artifactFingerprint`
- `createdAt`
- `registeredAt`
- `registeredBy`
- optional cloned artifact snapshot
- `supersedesArtifactId`
- `supersedesArtifactFingerprint`
- `supersededByArtifactId`
- `supersededByArtifactFingerprint`
- `metadata`
- `productionImpact: "none"`
- `decisionImpact: "none"`
- `executionAuthority: "none"`
- `registrationFingerprint`

## Registry Shape

The registry stores:

- schema and source metadata
- registry ID and version
- creation and update timestamps
- deterministic registrations
- lookup indexes by artifact ID and fingerprint
- summary counts
- authority boundary fields
- deterministic registry fingerprint

Registration helpers return new immutable registry objects rather than mutating the previous registry.

## Duplicate Handling

The registry detects:

- same artifact ID and same fingerprint: duplicate existing registration
- same artifact ID and different fingerprint: duplicate ID conflict
- different artifact ID and same fingerprint: duplicate fingerprint conflict

Conflicts are returned in structured validation and are not silently overwritten.

## Supersession

Supersession is explicit. A newer artifact may declare:

- `supersedesArtifactId`
- `supersedesArtifactFingerprint`

The registry can detect whether an artifact has been superseded and list the replacing registrations. The prior registration is not mutated.

## Compatibility Guarantees

The registry preserves:

- immutable artifact snapshots when stored
- deterministic fingerprints
- stable ID and fingerprint lookup
- schema-version tracking
- explicit supersession relationships
- offline-only authority boundaries

It does not change production behavior, persistence format, Signal migrations, shadow comparisons, governance execution, scanner behavior, marketplace behavior, valuation, Deal Gate, BUY_NOW, notifications, or runtime configuration.

## Future Work

Future phases may add:

- persistence/import/export around the registry
- workspace registry manifests
- Signal governance validation integration
- registry report generation
- artifact expiration policy
- cross-registry merge validation
