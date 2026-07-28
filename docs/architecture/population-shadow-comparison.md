# Population Shadow Comparison

## Purpose

Phase 13.4B adds an offline-only, shadow-only comparison layer for the Population Intelligence signal migration.

The comparison verifies that a preserved native Population Intelligence Engine output remains semantically consistent with the Phase 13 wrapper artifacts created by `populationSignalMigration`.

It is observational only. It does not repair mismatches, select a preferred output, recompute Population values, or influence production decisions.

## Comparison Flow

`comparePopulationNativeToShadow` accepts either:

- an existing Population migration artifact, or
- a supplied native Population output plus registry input that can be migrated offline.

The comparison evaluates:

1. native fields preserved in `canonicalSignal.rawOutput`
2. population evidence projections in `canonicalSignal.evidenceBasis`
3. confidence representation in `canonicalSignal.confidence` and `alignment.confidenceAlignment`
4. scarcity and availability status projections in `canonicalSignal.normalizedOutput`
5. metadata projections in canonical signal and migration metadata
6. explicit unknown-value preservation
7. fingerprint and source-reference consistency
8. authority boundaries

## Exact Versus Semantic Parity

Exact parity means the native value and wrapper value are byte-for-byte equivalent after deterministic JSON comparison.

Semantic parity means the wrapper represents the same meaning in a canonical structure. Examples:

- native `scarcityLevel` maps to `canonicalSignal.normalizedOutput.status`
- native `confidence` maps to canonical confidence value and confidence level
- native population counts map into evidence-basis detail fields
- population context maps to `trueSoldCount: 0` because population counts are not transaction-level sold evidence

The Population migration normally produces `semantic_match`, because canonical wrappers intentionally map native fields into richer canonical structures.

## Mismatch Classification

The comparison identifies:

- changed native fields
- missing wrapper fields
- unexpected wrapper fields
- changed population evidence values
- changed confidence values
- changed status values
- changed metadata values
- source reference mismatches
- fingerprint mismatches
- authority boundary violations

Mismatches are reported deterministically and are never resolved automatically.

## Fingerprint Model

The comparison reuses existing fingerprint helpers for:

- migration artifacts
- canonical signals
- signal alignments
- alignment runs
- alignment reports

The comparison fingerprint excludes only its own fingerprint field and is deterministic for identical inputs.

## Authority Boundaries

Every comparison artifact preserves:

- `productionImpact: "none"`
- `decisionImpact: "none"`
- `executionAuthority: "none"`

The comparison must never:

- execute the Population Intelligence Engine
- modify native Population output
- recompute scarcity, confidence, population, or evidence values
- alter scoring, valuation, Deal Gate, BUY_NOW, notifications, scanner, marketplace, persistence, or configuration behavior
- grant runtime authority

## Role In Future Certification

This comparison layer can become part of future engine migration certification. A migrated engine family should prove that its wrapper artifacts preserve native output and map semantic projections consistently before any future governance step considers live shadow observation or production proposals.
