# Range-First Valuation Signal Onboarding

Phase 13.7A onboards the existing Range-First Valuation Diagnostics output into the shared Phase 13 signal framework.

This onboarding is offline-only and shadow-only. It consumes an already-produced diagnostic artifact, preserves it as native output, wraps it in a Canonical Intelligence Signal, aligns it through the Intelligence Signal Registry, and verifies parity through the Signal Shadow Comparison Core.

## Selected Engine

Phase 13.5A recommended Listing Quality and Grading Diagnostics as the safest third migration target. That migration already exists, so Phase 13.7A selects the next most appropriate offline diagnostic family already present in the repository:

- `validation/rangeFirstValuationDiagnostics.js`

The migration module does not import or execute that diagnostic engine. It accepts existing Range-First Valuation diagnostic output as input.

## Shared Framework Reuse

`validation/rangeFirstValuationSignalMigration.js` uses:

- `signalMigrationCore.js` for migration lifecycle orchestration
- `signalMigrationAdapterContract.js` for declarative engine-specific mappings
- `signalMigrationCoreContract.js` for lifecycle artifact projection
- Canonical signal, registry, alignment, batch, run, conflict, report, and fingerprint modules for artifact construction and validation

`validation/rangeFirstValuationShadowComparison.js` uses:

- `signalShadowComparisonCore.js` for comparison lifecycle orchestration
- the Range-First migration validation logic for source artifact validation

## Engine-Specific Scope

Only the following behavior remains Range-First specific:

- signal name and producer identity
- native-output aliases
- valuation status mapping
- uncertainty and confidence-cap interpretation
- evidence projection from supporting and excluded evidence summaries
- semantic parity rules
- mismatch messages and reason codes
- migration and comparison summaries

## Native Output Preservation

The native diagnostic output is preserved in:

- `migration.nativeOutput`
- `migration.canonicalSignal.rawOutput`
- `migration.adaptedSignal.nativeOutput`
- `comparison.sourceArtifacts.nativeOutput`

The migration verifies exact JSON parity across those preserved copies. The shadow comparison reports mismatches but never repairs them.

## Authority Boundary

Every generated artifact preserves:

- `productionImpact: "none"`
- `decisionImpact: "none"`
- `executionAuthority: "none"`

The onboarding does not alter production valuation, confidence, Deal Gate, BUY_NOW, scanner behavior, notification behavior, persistence, marketplace behavior, or configuration.

## Future Engine Onboarding

Future diagnostic migrations should follow this pattern:

1. Define a declarative adapter with native field mappings.
2. Use `executeSignalMigrationLifecycle`.
3. Keep semantic mapping and summaries engine-specific.
4. Use `executeSignalShadowComparisonLifecycle` when native-to-shadow parity needs to be verified.
5. Prove no native engine import or runtime integration exists.
