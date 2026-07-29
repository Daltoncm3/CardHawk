# Production Valuation Signal Onboarding

Phase 14.3 adds an offline, shadow-only Signal Framework wrapper for existing Production Valuation output.

## Purpose

Production Valuation output is one of CardHawk's most important intelligence artifacts. This onboarding allows already-generated valuation results to be represented as Canonical Intelligence Signals for offline review and shadow comparison without executing valuation engines or changing production decisions.

## Scope

The migration consumes supplied native valuation output. It does not import or execute `marketValueEngine`, `valuationRangeEngine`, scanner code, parser code, identity code, Deal Gate, BUY_NOW, notification code, marketplace adapters, persistence, or `server.js`.

## Wrapper-First Flow

1. `createProductionValuationAdapter()` defines declarative mappings from the native valuation shape into the canonical signal schema.
2. `migrateProductionValuationSignal()` runs the shared Signal Migration Core lifecycle.
3. The native output is preserved exactly as `nativeOutput`, `canonicalSignal.rawOutput`, and `adaptedSignal.nativeOutput`.
4. The migration creates the canonical signal, alignment, alignment batch, alignment run, conflict analysis, alignment report, and Signal Migration Core artifact.
5. `compareProductionValuationNativeToShadow()` runs the shared Signal Shadow Comparison Core lifecycle to verify native-to-wrapper parity.

## Signal Identity

- Signal name: `production.valuation.market_value`
- Producer: `marketValueEngine`
- Producer category: `production_engine`
- Signal type: `valuation`
- Decision role: `diagnostic_only`
- Authority level: `shadow_observation`
- Evidence role: `diagnostic_context`

## Valuation Semantics

The canonical wrapper preserves supplied valuation fields and exposes them as diagnostic context:

- `marketValue`, `expectedValue`, `expectedValueLow`, and `expectedValueHigh` remain supplied valuation values
- `confidence` remains the native reported valuation confidence
- `source` and `method` remain the native valuation source and method
- sold and active comp counts remain evidence-basis metadata
- `priceRange`, `compEngine`, `activeMarketContext`, and adjustments remain preserved context

The migration does not recompute valuation, adjust confidence, alter ranges, filter evidence, or interpret Deal Gate or BUY_NOW eligibility.

## Parity Verification

The shadow comparison verifies:

- every native field is preserved in `canonicalSignal.rawOutput`
- valuation source and method are preserved
- market value and value range fields are preserved
- native confidence is preserved
- evidence counts remain diagnostic metadata
- source and schema metadata are preserved
- explicit unknown values remain explicit

Mismatches are reported without repair, preference selection, or production impact.

## Authority Boundaries

All artifacts preserve:

- `productionImpact: "none"`
- `decisionImpact: "none"`
- `executionAuthority: "none"`

This migration does not grant Production Valuation new authority, change valuation calculations, alter Deal Gate, alter BUY_NOW, or modify any production runtime behavior.

## Future Onboarding

Future valuation signal work should continue to separate supplied valuation payloads from engine execution. Any proposal to consume canonical valuation signals in production must pass through the Phase 12 governance pipeline before authority changes.
