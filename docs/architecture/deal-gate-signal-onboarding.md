# Deal Gate Diagnostics Signal Onboarding

Phase 13.7D onboards existing Deal Gate diagnostic output into the shared Phase 13 Signal framework.

This onboarding is offline-only and shadow-only. It consumes an already-produced Deal Gate output artifact, preserves it as native output, wraps it in a Canonical Intelligence Signal, aligns it through the Intelligence Signal Registry, and verifies wrapper parity through the Signal Shadow Comparison Core.

## Selected Signal Family

The selected signal family is existing Deal Gate output, including:

- pass or rejection status
- BUY_NOW eligibility as supplied by the native output
- decision or recommendation label
- reasons and positives
- gate threshold context
- sold comp and confidence context
- rule breakdown context when supplied

The migration does not import `server.js`, does not call `dealGate()`, and does not recompute Deal Gate decisions.

## Shared Framework Reuse

`validation/dealGateSignalMigration.js` uses:

- `signalMigrationCore.js` for lifecycle orchestration
- `signalMigrationAdapterContract.js` for declarative mapping metadata
- `signalMigrationCoreContract.js` for lifecycle artifact projection
- Canonical signal, registry, alignment, batch, run, conflict, report, validation, and fingerprint helpers

`validation/dealGateShadowComparison.js` uses:

- `signalShadowComparisonCore.js` for comparison orchestration
- Deal Gate migration validation for source artifact validation

## Deal Gate-Specific Scope

Deal Gate-specific code is limited to:

- signal identity
- supplied gate-decision semantics
- threshold and rule-breakdown mappings
- sold-comp and confidence evidence interpretation
- semantic parity rules
- mismatch reason codes
- migration and comparison summaries

## Native Output Preservation

The supplied native Deal Gate output is preserved in:

- `migration.nativeOutput`
- `migration.canonicalSignal.rawOutput`
- `migration.adaptedSignal.nativeOutput`
- `comparison.sourceArtifacts.nativeOutput`

The migration verifies exact JSON parity across preserved copies. The shadow comparison reports mismatches without repairing source artifacts.

## Authority Boundary

Native Deal Gate output may contain production decision language such as `BUY_NOW` or `REJECTED`. The Phase 13 signal wrapper is still observation-only.

All generated artifacts preserve:

- `productionImpact: "none"`
- `decisionImpact: "none"`
- `executionAuthority: "none"`

The canonical signal uses:

- `decisionRole: "diagnostic_only"`
- `authorityLevel: "shadow_observation"`

This onboarding does not change Deal Gate runtime behavior, BUY_NOW, scanner behavior, scoring, valuation, notifications, persistence, marketplace behavior, configuration, or production authority.

## Future Usage

Future decision-adjacent signal migrations should follow this boundary:

1. Accept supplied native output only.
2. Preserve native output exactly.
3. Wrap production decision language as diagnostic context.
4. Never infer or grant production authority from the wrapper.
5. Use shared migration and comparison cores.
6. Keep no-runtime-import tests in place.
