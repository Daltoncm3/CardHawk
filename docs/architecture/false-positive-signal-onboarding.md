# False-Positive Diagnostic Signal Onboarding

Phase 14.1 adds an offline, shadow-only Signal Framework wrapper for the existing False-Positive Diagnostics output.

## Purpose

False-Positive Diagnostics identify weak or unsafe positive opportunities by preserving contradictory diagnostic evidence around Deal Gate, BUY_NOW, identity, evidence, valuation, confidence, listing quality, suspicious price, ROI fragility, and risk summaries.

This onboarding makes that diagnostic output visible to the Phase 13 Signal Alignment Framework without granting it production authority.

## Scope

The onboarding consumes already-generated native False-Positive Diagnostics output. It does not import or execute `opportunityFalsePositiveDiagnostics`, ROI, risk, scoring, scanner, valuation, Deal Gate, BUY_NOW, marketplace, notification, persistence, or server runtime modules.

## Wrapper-First Flow

1. `createFalsePositiveAdapter()` defines declarative mappings from the native diagnostic shape into the canonical signal schema.
2. `migrateFalsePositiveSignal()` runs the shared Signal Migration Core lifecycle.
3. The migration preserves the native diagnostic output as `nativeOutput`, `canonicalSignal.rawOutput`, and `adaptedSignal.nativeOutput`.
4. The migration creates a canonical signal, alignment, alignment batch, alignment run, conflict analysis, alignment report, and core migration artifact.
5. `compareFalsePositiveNativeToShadow()` runs the shared Signal Shadow Comparison Core lifecycle to verify native-to-wrapper parity.

## Signal Identity

- Signal name: `opportunity.false_positive.diagnostics`
- Producer: `opportunityFalsePositiveDiagnostics`
- Producer category: `offline_validation`
- Signal type: `risk`
- Decision role: `diagnostic_only`
- Authority level: `shadow_observation`
- Evidence role: `diagnostic_context`

## False-Positive Semantics

The canonical signal treats `falsePositiveRiskLevel` as diagnostic risk strength, not production confidence. Risk levels map to a deterministic `0_100` diagnostic confidence value only for alignment and reporting:

- `critical`: 95
- `high`: 80
- `moderate`: 55
- `low`: 20
- missing or unknown: `unknown`

Risk status maps to uncertainty:

- `low_risk`: low
- `review`: moderate
- `elevated_risk` or `high_risk`: high
- `likely_false_positive`: extreme
- `unavailable` or missing: `unknown`

## Parity Verification

The shadow comparison verifies:

- every native field is preserved in `canonicalSignal.rawOutput`
- critical blockers and warning counts are preserved
- false-positive risk status and risk level are preserved
- BUY_NOW eligibility remains diagnostic context
- metadata source and version are preserved
- explicit unknown values remain explicit

Mismatches are reported without repair, preference selection, or production impact.

## Authority Boundaries

All artifacts preserve:

- `productionImpact: "none"`
- `decisionImpact: "none"`
- `executionAuthority: "none"`

Positive Deal Gate or BUY_NOW outcomes do not suppress contradictory diagnostic evidence. The migration and comparison artifacts are observation-only and cannot influence production decisions.

## Future Onboarding

Future diagnostic migrations should keep engine-specific code limited to signal identity, semantic mappings, parity rules, summaries, and reason codes. Shared lifecycle orchestration should remain in the Signal Migration Core and Signal Shadow Comparison Core.
