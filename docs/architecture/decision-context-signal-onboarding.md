# Decision Context Signal Onboarding

Phase 14.5 adds an offline-only, shadow-only wrapper for existing Decision Context output.

The migration consumes already-produced `decisionIntelligenceEngine` output and wraps it in the Phase 13 canonical Signal framework. It does not import or execute the engine, does not recompute readiness, and does not change production decision behavior.

## Purpose

Decision Context explains how evidence, comparable trust, valuation posture, resale pressure, blockers, cautions, and conflicts fit together around a production listing decision.

This signal family makes that context available to offline alignment reports while preserving the existing authority boundary:

- production systems remain authoritative
- Decision Context remains explanation-only
- the canonical signal is observational evidence
- shadow comparison detects wrapper mismatches only

## Public API

`validation/decisionContextSignalMigration.js` exposes:

- `createDecisionContextAdapter`
- `migrateDecisionContextSignal`
- `validateDecisionContextMigration`
- `summarizeDecisionContextMigration`
- `buildDecisionContextMigrationFingerprint`

`validation/decisionContextShadowComparison.js` exposes:

- `compareDecisionContextNativeToShadow`
- `validateDecisionContextShadowComparison`
- `summarizeDecisionContextShadowComparison`
- `buildDecisionContextShadowComparisonFingerprint`

## Migration Flow

1. Accept a supplied native Decision Context output.
2. Create a declarative adapter describing field mappings.
3. Resolve the signal definition from an offline registry.
4. Create a canonical intelligence signal.
5. Create an alignment artifact, batch, run, conflict analysis, and report.
6. Verify exact native-output parity.
7. Return immutable artifacts with deterministic fingerprints.

## Native Output Preservation

The native output is preserved in:

- `migration.nativeOutput`
- `canonicalSignal.rawOutput`
- `adaptedSignal.nativeOutput`

The migration treats missing or unknown values explicitly and never invents evidence.

## Decision Context Semantics

The wrapper maps:

- `overallReadiness` to normalized decision-context status
- `evidencePosture`, `compPosture`, `valuationPosture`, and `resalePressurePosture` to diagnostic context
- `supportingSignals`, `cautionSignals`, `blockers`, and `conflicts` to evidence-basis details
- optional confidence values to diagnostic confidence only

## Shadow Comparison

The shadow comparison verifies:

- native raw output parity
- evidence posture and counts
- optional confidence values
- readiness/status values
- source and version metadata
- explicit unknown-value preservation

It identifies mismatches without repairing, ranking, resolving, or preferring either representation.

## Authority Boundaries

Every artifact preserves:

- `productionImpact: "none"`
- `decisionImpact: "none"`
- `executionAuthority: "none"`

The migration cannot affect Deal Gate, BUY_NOW, valuation, notifications, scanner behavior, marketplace behavior, persistence, or runtime configuration.

## Future Use

Decision Context can now participate in offline Signal Alignment reports and future governance review packages. Any future production use must go through the Phase 12 governance chain before runtime authority changes.
