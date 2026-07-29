# Evidence Readiness Signal Onboarding

Phase 14.0B onboards existing Evidence Readiness Diagnostics output into the shared Phase 13 Signal framework.

This onboarding is offline-only and shadow-only. It consumes an already-produced diagnostic artifact, preserves it as native output, wraps it in a Canonical Intelligence Signal, aligns it through the Intelligence Signal Registry, and verifies native-to-wrapper parity through the Signal Shadow Comparison Core.

## Selected Signal Family

The selected signal family is:

- `validation/evidenceReadinessDiagnostics.js`

The migration does not import or execute that diagnostic module. It accepts supplied Evidence Readiness diagnostic output only.

## Shared Framework Reuse

`validation/evidenceReadinessSignalMigration.js` uses:

- `signalMigrationCore.js` for lifecycle orchestration
- `signalMigrationAdapterContract.js` for declarative mapping metadata
- `signalMigrationCoreContract.js` for lifecycle artifact projection
- Canonical signal, registry, alignment, batch, run, conflict, report, validation, and fingerprint helpers

`validation/evidenceReadinessShadowComparison.js` uses:

- `signalShadowComparisonCore.js` for comparison orchestration
- Evidence Readiness migration validation for source artifact validation

## Signal Identity

Canonical signal identity:

- signal name: `evidence.readiness.diagnostics`
- producer: `evidenceReadinessDiagnostics`
- producer category: `offline_validation`
- signal type: `evidence`
- decision role: `diagnostic_only`
- authority level: `shadow_observation`
- evidence role: `diagnostic_context`

## Engine-Specific Scope

Only the following behavior is Evidence Readiness specific:

- signal name and producer identity
- native-output aliases
- readiness status and level mapping
- eligible and excluded evidence summary projection
- true-sold, active, fallback, stale, rejected, duplicate, and transaction-ineligible evidence interpretation
- confidence-cap interpretation
- valuation-withheld diagnostic flag preservation
- semantic parity rules
- mismatch messages and reason codes
- migration and comparison summaries

## Native Output Preservation

The supplied native diagnostic output is preserved in:

- `migration.nativeOutput`
- `migration.canonicalSignal.rawOutput`
- `migration.adaptedSignal.nativeOutput`
- `comparison.sourceArtifacts.nativeOutput`

The migration verifies exact JSON parity across preserved copies. The shadow comparison reports mismatches without repairing source artifacts.

## Evidence Semantics

Evidence Readiness contributes diagnostic evidence context only.

The wrapper preserves:

- true sold evidence count
- active listing count
- fallback evidence count
- exact comparable count
- contextual comparable count
- rejected comparable count
- stale evidence count
- duplicate evidence count
- transaction-ineligible evidence count
- comparable quality
- identity exactness
- evidence readiness and valuation readiness

Active listings and fallback values remain excluded context. They do not satisfy true-sold support and do not gain production authority through the wrapper.

## Confidence Semantics

Evidence Readiness does not change production confidence.

The canonical signal preserves the supplied diagnostic `confidenceCapRecommendation` as advisory confidence context:

- `canonicalSignal.confidence.value`
- `canonicalSignal.confidenceLevel`
- `canonicalSignal.normalizedOutput.recommendedConfidenceCap`

The cap is evidence-only and cannot change production thresholds.

## Authority Boundary

All generated artifacts preserve:

- `productionImpact: "none"`
- `decisionImpact: "none"`
- `executionAuthority: "none"`

The onboarding does not change scoring, valuation, Deal Gate, BUY_NOW, notifications, scanner behavior, parser behavior, identity behavior, persistence, marketplace behavior, configuration, or production authority.

## Shadow Comparison

The shadow comparison verifies:

- exact raw native output preservation
- readiness status and readiness level mapping
- true sold count mapping
- active listing context mapping
- fallback evidence context mapping
- evidence-quality semantics
- diagnostic confidence-cap preservation
- metadata preservation
- explicit unknown-value preservation

The comparison never repairs mismatches, selects a preferred output, recomputes diagnostics, or grants authority.

## Future Usage

Future evidence-oriented signal migrations should follow this pattern:

1. Accept supplied native output only.
2. Define declarative adapter mappings.
3. Use `executeSignalMigrationLifecycle`.
4. Use `executeSignalShadowComparisonLifecycle` for native-to-wrapper parity checks.
5. Keep evidence semantics and reason codes local to the signal family.
6. Preserve no-runtime-import tests.
7. Preserve active/fallback evidence safeguards.
