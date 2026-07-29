# Identity Parser Diagnostics Signal Onboarding

Phase 14.0C onboards existing Identity Parser Diagnostics output into the shared Phase 13 Signal framework.

This onboarding is offline-only and shadow-only. It consumes an already-produced diagnostic artifact, preserves it as native output, wraps it in a Canonical Intelligence Signal, aligns it through the Intelligence Signal Registry, and verifies native-to-wrapper parity through the Signal Shadow Comparison Core.

## Selected Signal Family

The selected signal family is:

- `validation/identityParserDiagnostics.js`

The migration does not import or execute that diagnostic module. It accepts supplied Identity Parser diagnostic output only.

## Shared Framework Reuse

`validation/identityParserSignalMigration.js` uses:

- `signalMigrationCore.js` for lifecycle orchestration
- `signalMigrationAdapterContract.js` for declarative mapping metadata
- `signalMigrationCoreContract.js` for lifecycle artifact projection
- Canonical signal, registry, alignment, batch, run, conflict, report, validation, and fingerprint helpers

`validation/identityParserShadowComparison.js` uses:

- `signalShadowComparisonCore.js` for comparison orchestration
- Identity Parser migration validation for source artifact validation

## Signal Identity

Canonical signal identity:

- signal name: `identity.parser.diagnostics`
- producer: `identityParserDiagnostics`
- producer category: `offline_validation`
- signal type: `identity`
- decision role: `diagnostic_only`
- authority level: `shadow_observation`
- evidence role: `diagnostic_context`

## Engine-Specific Scope

Only the following behavior is Identity Parser specific:

- signal name and producer identity
- native-output aliases
- identity eligibility projection
- diagnostic status interpretation
- ambiguity and completeness interpretation
- parser/canonical field-count projection
- diagnostic confidence semantics
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

## Identity Semantics

Identity Parser Diagnostics contributes diagnostic identity context only.

The wrapper preserves:

- exact-comparable eligibility
- valuation eligibility
- manual-review requirement
- context-only status
- diagnostic status
- ambiguity level
- blocking issues
- warnings
- parser/canonical comparison
- confirmed, missing, conflicting, inferred, and unsupported fields
- recommended review action

The wrapper does not change parser output, canonical identity output, runtime identity behavior, valuation eligibility, Deal Gate, or BUY_NOW.

## Confidence Semantics

Identity Parser Diagnostics does not change production confidence.

The canonical signal derives diagnostic confidence from supplied identity status, ambiguity level, and eligibility:

- exact valuation-eligible diagnostics map to high diagnostic confidence
- strong candidates map to high diagnostic confidence with review context
- partial and ambiguous diagnostics map to lower confidence
- unsupported and blocked diagnostics map to insufficient or low confidence

This diagnostic confidence is advisory only and cannot change production thresholds.

## Shadow Comparison

The shadow comparison verifies:

- exact raw native output preservation
- diagnostic status mapping
- ambiguity-level mapping
- identity eligibility mapping
- confirmed, missing, conflicting, inferred, and unsupported field counts
- diagnostic confidence projection
- metadata preservation
- explicit unknown-value preservation

The comparison never repairs mismatches, selects a preferred output, recomputes diagnostics, or grants authority.

## Authority Boundary

All generated artifacts preserve:

- `productionImpact: "none"`
- `decisionImpact: "none"`
- `executionAuthority: "none"`

The onboarding does not change scanner behavior, parser behavior, identity runtime behavior, valuation, Deal Gate, BUY_NOW, notifications, persistence, marketplace behavior, configuration, or production authority.

## Future Usage

Future identity-oriented signal migrations should follow this pattern:

1. Accept supplied native output only.
2. Define declarative adapter mappings.
3. Use `executeSignalMigrationLifecycle`.
4. Use `executeSignalShadowComparisonLifecycle` for native-to-wrapper parity checks.
5. Keep identity semantics and reason codes local to the signal family.
6. Preserve no-runtime-import tests.
7. Preserve exact native diagnostic output.
