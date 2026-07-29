# Comparable Quality Signal Onboarding

Phase 14.4 adds an offline, shadow-only Signal Framework wrapper for existing Comparable Quality output.

## Purpose

Comparable Quality evaluates the trustworthiness of comparable evidence using similarity, evidence type, recency, price reliability, source reliability, sale type, sample depth, source diversity, and condition coverage. This onboarding exposes already-generated Comparable Quality output to the shared Signal Alignment Framework without executing the engine or changing production behavior.

## Scope

The migration consumes supplied Comparable Quality output. It does not import or execute `comparableQualityEngine`, valuation engines, scanner code, parser code, identity code, Deal Gate, BUY_NOW, notification code, marketplace adapters, persistence, or `server.js`.

## Wrapper-First Flow

1. `createComparableQualityAdapter()` defines declarative mappings from native Comparable Quality output into the canonical signal schema.
2. `migrateComparableQualitySignal()` runs the shared Signal Migration Core lifecycle.
3. The native output is preserved exactly as `nativeOutput`, `canonicalSignal.rawOutput`, and `adaptedSignal.nativeOutput`.
4. The migration creates a canonical signal, alignment, alignment batch, alignment run, conflict analysis, alignment report, and Signal Migration Core artifact.
5. `compareComparableQualityNativeToShadow()` runs the shared Signal Shadow Comparison Core lifecycle to verify native-to-wrapper parity.

## Signal Identity

- Signal name: `comparable.quality.diagnostics`
- Producer: `comparableQualityEngine`
- Producer category: `production_engine`
- Signal type: `quality`
- Decision role: `diagnostic_only`
- Authority level: `shadow_observation`
- Evidence role: `diagnostic_context`

## Comparable Quality Semantics

The canonical wrapper treats comparable quality as diagnostic evidence context:

- `averageComparableQualityScore` becomes diagnostic confidence and quality context
- `sampleDepth.trueSoldCount` and `sampleDepth.activeCount` map to evidence-basis counts
- fallback comparables remain explicit as fallback context
- rejected comparable counts remain diagnostic warnings through the quality distribution
- `sourceDiversity`, condition coverage, average age, and scored comps are preserved as context

The migration does not score comparables, recalculate similarity, select comps, alter valuation, or change Deal Gate or BUY_NOW decisions.

## Parity Verification

The shadow comparison verifies:

- every native field is preserved in `canonicalSignal.rawOutput`
- comparable counts and sample-depth counts are preserved
- average quality score is preserved as diagnostic confidence
- quality distribution and summary semantics remain visible
- source and schema metadata are preserved
- explicit unknown values remain explicit

Mismatches are reported without repair, preference selection, or production impact.

## Authority Boundaries

All artifacts preserve:

- `productionImpact: "none"`
- `decisionImpact: "none"`
- `executionAuthority: "none"`

This migration does not grant Comparable Quality new runtime authority and does not change production scoring, valuation, Deal Gate, BUY_NOW, notifications, scanner behavior, marketplace behavior, persistence, or configuration.

## Future Onboarding

Future comparable-quality work should continue to separate supplied engine output from engine execution. Any production use of canonical comparable-quality signals must pass through the Phase 12 governance pipeline before authority changes.
