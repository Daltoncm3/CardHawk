# Population Intelligence Signal Migration

## Purpose

Phase 13.4A is the second real Signal Alignment migration for CardHawk.

It wraps an already-produced Population Intelligence Engine result in the Phase 13 canonical signal framework:

1. Canonical Intelligence Signal
2. Signal Alignment artifact
3. Signal Alignment Batch
4. Signal Alignment Run
5. Signal Conflict Analysis
6. Signal Alignment Report

The migration is offline-only and shadow-only. It does not execute the Population Intelligence Engine and does not alter native Population output.

## Wrapper-First Philosophy

The native Population Intelligence Engine remains unchanged. Its output is treated as immutable input evidence.

The migration creates wrapper artifacts around that native output so population scarcity context can participate in alignment, reporting, validation, and future governance without replacing existing production consumers.

## Public API

`validation/populationSignalMigration.js` exposes:

- `migratePopulationSignal(input, options)`
- `validatePopulationMigration(migration)`
- `summarizePopulationMigration(migration)`
- `buildPopulationMigrationFingerprint(migration)`

## Migration Flow

`migratePopulationSignal` accepts a supplied Population Intelligence Engine output and an Intelligence Signal Registry.

The migration:

1. clones the native output defensively
2. builds a deterministic source-output fingerprint
3. resolves `population.intelligence.engine` through the registry
4. creates a Canonical Intelligence Signal
5. creates a Signal Alignment artifact
6. creates a Signal Alignment Batch
7. creates a Signal Alignment Run
8. creates a Signal Conflict Analysis
9. creates a Signal Alignment Report
10. validates parity, fingerprints, and authority boundaries

## Signal Definition

The expected registry definition is:

- signal name: `population.intelligence.engine`
- producer: `populationEngine`
- producer category: `production_engine`
- signal type: `context`
- decision role: `diagnostic_only`
- authority level: `shadow_observation`
- evidence role: `diagnostic_context`

The signal definition must be present in the supplied registry for the alignment to resolve as `matched`.

## Parity Verification

The migration verifies that the native Population output is preserved exactly in:

- `nativeOutput`
- `canonicalSignal.rawOutput`
- `adaptedSignal.nativeOutput`

No scarcity values, confidence values, population counts, evidence values, metadata, warnings, positives, reasons, component scores, or summaries may be changed by the wrapper.

## Population Evidence Boundary

Population context is not sold evidence.

The canonical wrapper preserves population counts, population source metadata, update timestamps, and evidence-quality declarations as diagnostic context only. It must not treat active listings, registry population, or grading-population counts as transaction-level sold evidence.

## Authority Boundaries

All wrapper artifacts preserve:

- `productionImpact: "none"`
- `decisionImpact: "none"`
- `executionAuthority: "none"`

The migration must never:

- recompute Population Intelligence values
- modify Population output
- alter scoring, valuation, Deal Gate, BUY_NOW, notifications, scanner, marketplace, persistence, or configuration behavior
- grant production authority
- convert shadow observations into production decisions

## Missing Definitions

If the registry lacks the Population signal definition, the migration preserves that fact explicitly through:

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
