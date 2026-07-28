# Grade Premium Engine Signal Migration

## Purpose

Phase 13.3A is the first real Signal Alignment migration for CardHawk.

It wraps an already-produced Grade Premium Engine result in the Phase 13 canonical signal framework:

1. Canonical Intelligence Signal
2. Signal Alignment artifact
3. Signal Alignment Batch
4. Signal Alignment Run
5. Signal Conflict Analysis
6. Signal Alignment Report

The migration is offline-only and shadow-only. It does not execute the Grade Premium Engine and does not alter native Grade Premium output.

## Wrapper-First Philosophy

The native Grade Premium Engine remains unchanged. Its output is treated as immutable input evidence.

The migration creates wrapper artifacts around that native output so the signal can participate in alignment, reporting, validation, and future governance without replacing existing production consumers.

## Public API

`validation/gradePremiumSignalMigration.js` exposes:

- `migrateGradePremiumSignal(input, options)`
- `validateGradePremiumMigration(migration)`
- `summarizeGradePremiumMigration(migration)`
- `buildGradePremiumMigrationFingerprint(migration)`

## Migration Flow

`migrateGradePremiumSignal` accepts a supplied Grade Premium Engine output and an Intelligence Signal Registry.

The migration:

1. clones the native output defensively
2. builds a deterministic source-output fingerprint
3. resolves `grade.premium.engine` through the registry
4. creates a Canonical Intelligence Signal
5. creates a Signal Alignment artifact
6. creates a Signal Alignment Batch
7. creates a Signal Alignment Run
8. creates a Signal Conflict Analysis
9. creates a Signal Alignment Report
10. validates parity, fingerprints, and authority boundaries

## Signal Definition

The expected registry definition is:

- signal name: `grade.premium.engine`
- producer: `gradePremiumEngine`
- producer category: `production_engine`
- signal type: `grading`
- decision role: `diagnostic_only`
- authority level: `shadow_observation`
- evidence role: `diagnostic_context`

The signal definition must be present in the supplied registry for the alignment to resolve as `matched`.

## Parity Verification

The migration verifies that the native Grade Premium output is preserved exactly in:

- `nativeOutput`
- `canonicalSignal.rawOutput`
- `adaptedSignal.nativeOutput`

No Grade Premium values, confidence values, evidence values, metadata, warnings, positives, dimensions, or summaries may be changed by the wrapper.

## Authority Boundaries

All wrapper artifacts preserve:

- `productionImpact: "none"`
- `decisionImpact: "none"`
- `executionAuthority: "none"`

The migration must never:

- recompute Grade Premium values
- modify Grade Premium output
- alter scoring, valuation, Deal Gate, BUY_NOW, notifications, scanner, marketplace, persistence, or configuration behavior
- grant production authority
- convert shadow observations into production decisions

## Missing Definitions

If the registry lacks the Grade Premium signal definition, the migration preserves that fact explicitly through:

- `registryResolutionStatus: "definition_missing"`
- alignment status `definition_missing`
- report missing-definition summaries

The migration does not invent definitions or infer authority.

## Future Engine Migration Process

Future signal migrations should follow the same wrapper-first sequence:

1. accept already-produced native output
2. preserve native output exactly
3. define a registry signal definition
4. create canonical signal and alignment artifacts
5. package batch, run, conflict analysis, and report artifacts
6. validate parity and authority boundaries

Each engine family should receive its own narrow migration wrapper unless a shared adapter can be introduced without moving domain-specific logic into a generic module.
