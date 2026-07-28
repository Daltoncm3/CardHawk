# Confidence Calibration Signal Onboarding

Phase 13.7C onboards existing Confidence Calibration Diagnostics output into the shared Phase 13 Signal framework.

This onboarding is offline-only and shadow-only. It consumes an already-produced diagnostic artifact, preserves it as native output, wraps it in a Canonical Intelligence Signal, aligns it through the Intelligence Signal Registry, and verifies wrapper parity through the Signal Shadow Comparison Core.

## Selected Engine

The selected signal family is:

- `validation/confidenceCalibrationDiagnostics.js`

The migration does not import or execute that diagnostic module. It accepts supplied Confidence Calibration diagnostic output only.

## Shared Framework Reuse

`validation/confidenceCalibrationSignalMigration.js` uses:

- `signalMigrationCore.js` for lifecycle orchestration
- `signalMigrationAdapterContract.js` for declarative mapping metadata
- `signalMigrationCoreContract.js` for lifecycle artifact projection
- Canonical signal, registry, alignment, batch, run, conflict, report, validation, and fingerprint helpers

`validation/confidenceCalibrationShadowComparison.js` uses:

- `signalShadowComparisonCore.js` for comparison orchestration
- Confidence Calibration migration validation for source artifact validation

## Engine-Specific Scope

Only the following behavior is Confidence Calibration specific:

- signal name and producer identity
- native-output aliases
- calibration status mapping
- confidence support semantics
- reported confidence and diagnostic cap interpretation
- reviewed-outcome and evidence-support projection
- calibration-gap uncertainty interpretation
- semantic parity rules
- mismatch messages and reason codes
- migration and comparison summaries

## Native Output Preservation

The supplied native diagnostic output is preserved in:

- `migration.nativeOutput`
- `migration.canonicalSignal.rawOutput`
- `migration.adaptedSignal.nativeOutput`
- `comparison.sourceArtifacts.nativeOutput`

The migration verifies exact JSON parity across the preserved copies. The shadow comparison reports mismatches without repairing source artifacts.

## Authority Boundary

All generated artifacts preserve:

- `productionImpact: "none"`
- `decisionImpact: "none"`
- `executionAuthority: "none"`

The onboarding does not change production confidence values, production confidence thresholds, scoring, valuation, Deal Gate, BUY_NOW, notifications, scanner behavior, persistence, marketplace behavior, or configuration.

## Future Usage

Future offline migrations should follow this pattern:

1. Accept supplied native output only.
2. Define declarative adapter mappings.
3. Use `executeSignalMigrationLifecycle`.
4. Use `executeSignalShadowComparisonLifecycle` for wrapper parity checks.
5. Keep semantic interpretation and reason codes engine-specific.
6. Preserve no-runtime-import tests.
