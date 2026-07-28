# Signal Migration Core Contract

## Purpose

Phase 13.6B introduces the immutable Signal Migration Core Contract.

The contract records the shared lifecycle state for future Signal Migration implementations. It does not perform migration, execute engines, build native outputs, wrap canonical signals, or modify existing migration modules.

It is offline-only and architecture-foundational.

## Public API

`validation/signalMigrationCoreContract.js` exposes:

- `createSignalMigrationArtifact(input, options)`
- `validateSignalMigrationArtifact(artifact)`
- `cloneSignalMigrationArtifact(artifact)`
- `buildSignalMigrationFingerprint(artifact)`
- `determineMigrationLifecycleStatus(input)`

## Schema

Each migration artifact contains:

- `schemaVersion`
- `source`
- `migrationId`
- `createdAt`
- `engineName`
- `engineVersion`
- `nativeOutputFingerprint`
- `canonicalSignalFingerprint`
- `alignmentFingerprint`
- `batchFingerprint`
- `runFingerprint`
- `reportFingerprint`
- `parityStatus`
- `registryStatus`
- `lifecycleStatus`
- `warnings`
- `errors`
- `productionImpact: "none"`
- `decisionImpact: "none"`
- `executionAuthority: "none"`
- `metadata`
- `migrationFingerprint`

Unknown values remain explicit as `unknown`.

## Lifecycle Statuses

Supported lifecycle statuses are:

- `initialized`
- `adapted`
- `aligned`
- `batched`
- `reported`
- `validated`
- `blocked`
- `invalid`

`determineMigrationLifecycleStatus` derives status from available artifact fingerprints, parity status, registry status, errors, and authority boundaries.

The contract is a record of lifecycle state. It does not advance lifecycle state by performing work.

## Authority Boundaries

Every artifact preserves:

- `productionImpact: "none"`
- `decisionImpact: "none"`
- `executionAuthority: "none"`

Validation rejects authority drift. The contract never grants production authority and never allows a migration artifact to affect scanner behavior, scoring, valuation, Deal Gate, BUY_NOW, notifications, persistence, marketplace behavior, or configuration.

## Fingerprint Model

`buildSignalMigrationFingerprint` uses the canonical fingerprint projection helper and excludes only migration-fingerprint fields.

Fingerprints are deterministic for identical inputs. Future migration modules may delegate to this helper only if existing output fingerprints are proven unchanged.

## Relationship To Existing Migrations

This contract does not modify:

- `gradePremiumSignalMigration`
- `populationSignalMigration`
- `listingQualitySignalMigration`

Those modules remain the source of current migration behavior. The core contract defines a common lifecycle artifact that future shared migration infrastructure can use.

## Future Signal Migration Core Integration

Future phases may use this contract to support:

- shared migration lifecycle reporting
- shared adapter validation
- migration conformance tests
- cross-engine migration summaries
- behavior-preserving consolidation of repeated scaffolding

Future integration must preserve existing public APIs, output shapes, fingerprints, and authority boundaries.

## Non-Goals

This contract does not:

- execute intelligence engines
- perform signal migration
- create canonical signals
- resolve registry definitions
- build alignment artifacts
- mutate native outputs
- alter production runtime
- grant production authority
