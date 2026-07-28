# Listing Quality and Grading Diagnostics Signal Migration

## Purpose

Phase 13.5B is the third real Signal Alignment migration for CardHawk.

It wraps an already-produced Listing Quality and Grading Diagnostics result in the Phase 13 canonical signal framework:

1. Canonical Intelligence Signal
2. Signal Alignment artifact
3. Signal Alignment Batch
4. Signal Alignment Run
5. Signal Conflict Analysis
6. Signal Alignment Report

The migration is offline-only and shadow-only. It does not execute `listingQualityGradingDiagnostics` and does not alter native diagnostic output.

## Wrapper-First Philosophy

The native diagnostic output remains unchanged. It is treated as immutable input evidence.

The migration creates wrapper artifacts around that native output so listing quality, grading uncertainty, and false-positive risk context can participate in alignment, reporting, validation, and future governance without replacing existing consumers.

## Public API

`validation/listingQualitySignalMigration.js` exposes:

- `migrateListingQualitySignal(input, options)`
- `validateListingQualityMigration(migration)`
- `summarizeListingQualityMigration(migration)`
- `buildListingQualityMigrationFingerprint(migration)`

## Migration Flow

`migrateListingQualitySignal` accepts a supplied Listing Quality and Grading Diagnostics output and an Intelligence Signal Registry.

The migration:

1. clones the native diagnostic output defensively
2. builds a deterministic source-output fingerprint
3. resolves `listing.quality.grading.diagnostics` through the registry
4. creates a Canonical Intelligence Signal
5. creates a Signal Alignment artifact
6. creates a Signal Alignment Batch
7. creates a Signal Alignment Run
8. creates a Signal Conflict Analysis
9. creates a Signal Alignment Report
10. validates parity, fingerprints, and authority boundaries

## Signal Definition

The expected registry definition is:

- signal name: `listing.quality.grading.diagnostics`
- producer: `listingQualityGradingDiagnostics`
- producer category: `offline_validation`
- signal type: `quality`
- decision role: `diagnostic_only`
- authority level: `shadow_observation`
- evidence role: `diagnostic_context`

The signal definition must be present in the supplied registry for the alignment to resolve as `matched`.

## Parity Verification

The migration verifies that the native diagnostic output is preserved exactly in:

- `nativeOutput`
- `canonicalSignal.rawOutput`
- `adaptedSignal.nativeOutput`

No listing-quality status, grading status, risk level, warnings, blocking issues, attributes, evidence summaries, confidence values, metadata, history context, or recommended review actions may be changed by the wrapper.

## Diagnostic Evidence Boundary

Listing Quality and Grading Diagnostics are review and false-positive context. They do not grant production authority and do not create new production evidence.

The canonical wrapper preserves supplied diagnostic evidence, including listing-quality summary, grading-support summary, sold-support context, and listing-history context. The wrapper does not recompute these values.

## Authority Boundaries

All wrapper artifacts preserve:

- `productionImpact: "none"`
- `decisionImpact: "none"`
- `executionAuthority: "none"`

The migration must never:

- execute Listing Quality and Grading Diagnostics
- modify native diagnostic output
- alter scoring, valuation, Deal Gate, BUY_NOW, notifications, scanner, marketplace, persistence, or configuration behavior
- grant production authority
- convert shadow observations into production decisions

## Missing Definitions

If the registry lacks the Listing Quality signal definition, the migration preserves that fact explicitly through:

- `registryResolutionStatus: "definition_missing"`
- alignment status `definition_missing`
- report missing-definition summaries

The migration does not invent definitions or infer authority.

## Future Engine Migration Process

Future signal migrations should continue to follow the wrapper-first sequence:

1. accept already-produced native output
2. preserve native output exactly
3. define a registry signal definition
4. create canonical signal and alignment artifacts
5. package batch, run, conflict analysis, and report artifacts
6. validate parity and authority boundaries

With Grade Premium, Population, and Listing Quality migrations complete, a future consolidation phase can consider extracting shared lifecycle scaffolding while keeping engine-specific evidence, confidence, status, and metadata mappings local.
