# Signal Migration Core

Phase 13.6D introduces the shared Signal Migration Core for behavior-preserving signal migration consolidation.

The core extracts lifecycle plumbing that was repeated across Grade Premium, Population Intelligence, and Listing Quality & Grading Diagnostics migrations. It does not replace engine-specific semantics, execute native engines, alter native outputs, or grant production authority.

## Shared Lifecycle

The shared core coordinates the same wrapper-first lifecycle used by the existing migrations:

1. Defensively clone supplied native output.
2. Resolve the optional signal registry and definition.
3. Preserve registry resolution status.
4. Invoke the engine-specific canonical signal builder.
5. Invoke the engine-specific alignment builder.
6. Invoke the engine-specific adapted-signal builder.
7. Build a single-signal alignment batch.
8. Build the engine-specific alignment run.
9. Build conflict analysis.
10. Build the alignment report.
11. Verify exact native-output parity.
12. Preserve authority boundaries.
13. Attach engine-specific summary, validation, and migration fingerprint when supplied by the migration module.

The core owns only orchestration. It does not interpret native engine fields.

## Module Boundaries

`validation/signalMigrationCore.js` provides:

- `executeSignalMigrationLifecycle`
- `validateSignalMigrationLifecycle`
- `summarizeSignalMigrationLifecycle`
- `buildSignalMigrationLifecycleFingerprint`

It may use shared Phase 13 infrastructure:

- Canonical signal contract
- Signal registry
- Signal alignment contract
- Signal alignment batch
- Signal alignment engine run shape
- Signal conflict analyzer
- Signal alignment report
- Signal migration core contract
- Signal migration adapter contract

It must not import production runtime modules, scanner modules, native intelligence engines, or engine-specific migration modules.

## Adapter Responsibilities

The core can validate adapter contracts and determine adapter compatibility, but adapters remain declarative.

Adapters describe:

- supported engine versions
- target signal versions
- required and optional native fields
- evidence, confidence, uncertainty, status, metadata, and normalized-output mappings
- semantic parity rules
- mismatch reason codes

The core does not execute adapter mapping functions from serialized data. Approved local handler references remain references until a future implementation explicitly wires them.

## Engine-Specific Responsibilities

The existing migration modules retain:

- native output aliases
- native version resolution
- canonical signal construction
- alignment metadata
- adapted-signal shape
- evidence mapping
- confidence mapping
- uncertainty mapping
- status mapping
- metadata mapping
- normalized output projection
- parity mismatch wording
- engine-specific validation messages and reason codes
- engine-specific summary shape
- migration fingerprint helper
- public exports and return shapes

This preserves the observable behavior of:

- Grade Premium migration
- Population Intelligence migration
- Listing Quality & Grading Diagnostics migration

## Behavior-Preservation Guarantees

The consolidation is intended to produce no external behavior changes.

The migration modules continue to return the same artifacts:

- `nativeOutput`
- `canonicalSignal`
- `adaptedSignal`
- `alignment`
- `alignmentBatch`
- `alignmentRun`
- `conflictAnalysis`
- `alignmentReport`
- `summary`
- `validation`
- `migrationFingerprint`

Existing public APIs remain unchanged.

## Authority Boundaries

The core preserves:

- `productionImpact: "none"`
- `decisionImpact: "none"`
- `executionAuthority: "none"`

It must never influence scoring, valuation, Deal Gate, BUY_NOW, notifications, persistence, marketplace behavior, configuration, or deployment.

## Failure Behavior

The shared core fails closed:

- native output is not repaired
- missing registry definitions remain explicit
- blocked registry resolution remains observable
- parity mismatches become structured validation errors
- authority violations are aggregated
- unknown values remain `unknown`
- no partial artifact becomes authoritative

## Onboarding The Next Migration

Future migrations should provide a small configuration to the core:

- schema version and migration source
- native output aliases
- default artifact IDs
- registry definition resolver
- registry resolution status resolver
- canonical signal builder
- alignment builder
- adapted-signal builder
- alignment-run builder
- parity verifier
- summary builder
- validation helper
- migration fingerprint helper

This lets the shared core own lifecycle construction while the migration module keeps domain semantics.

## Remaining Engine-Specific Logic

The next consolidation phase should not move semantic mapping logic into the core unless at least one more migration proves the abstraction is stable. The safest boundary is:

- shared lifecycle in the core
- declarative adapter contract for future configuration
- engine-specific semantic builders in each migration
- parity comparison wording in each migration

That boundary avoids over-abstraction while reducing copy-based orchestration.
