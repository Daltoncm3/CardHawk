# Decision Intelligence Evidence Bundle

Phase 17.3A implements the offline Decision Intelligence Evidence Bundle.

The bundle collects references to existing CardHawk evidence for one listing and prepares a deterministic input projection for the Decision Intelligence Artifact Builder. It does not recompute evidence, execute engines, modify production behavior, or grant authority.

## Purpose

The Evidence Bundle exists between raw source artifacts and the Decision Intelligence Artifact Builder.

It organizes:

- listing reference
- canonical identity reference
- Signal references
- valuation references
- comparable-quality references
- evidence-readiness references
- production scoring observation
- Deal Gate observation
- BUY_NOW observation
- Governance references
- missing references
- evidence gaps
- unknown values
- provenance

The bundle is a packaging layer. It preserves what already exists and makes missing evidence visible.

## Public API

Module:

```text
validation/decisionIntelligenceEvidenceBundle.js
```

Public helpers:

- `buildDecisionIntelligenceEvidenceBundle(input)`
- `validateDecisionIntelligenceEvidenceBundle(bundle)`
- `summarizeDecisionIntelligenceEvidenceBundle(bundle)`
- `buildDecisionIntelligenceEvidenceBundleFingerprint(bundle)`
- `compareDecisionIntelligenceEvidenceBundles(left, right)`

## Bundle Schema

Required top-level fields:

- `schemaVersion`
- `source`
- `bundleId`
- `bundleType`
- `createdAt`
- `capturedAt`
- `listingRef`
- `canonicalIdentityRef`
- `signalRefs`
- `valuationRefs`
- `comparableQualityRefs`
- `evidenceReadinessRefs`
- `productionScoringObservation`
- `dealGateObservation`
- `buyNowObservation`
- `governanceRefs`
- `missingReferences`
- `evidenceGaps`
- `unknownValues`
- `provenance`
- `builderInput`
- `productionImpact: "none"`
- `decisionImpact: "none"`
- `executionAuthority: "none"`
- `bundleFingerprint`

## Required References

The bundle treats these references as required for a complete build-ready package:

- `listingRef.listingId`
- `canonicalIdentityRef.canonicalIdentityId`
- `productionScoringObservation.sourceFingerprint`
- `dealGateObservation.sourceFingerprint`

Missing required references are deterministic validation errors and are also represented as missing-reference entries and evidence gaps.

## Expected Signal References

The current expected Signal set follows Phase 14 coverage:

- `canonical.sold_evidence.diagnostics`
- `comparable.quality.diagnostics`
- `confidence.calibration.diagnostics`
- `decision.context.diagnostics`
- `decision.deal_gate.diagnostics`
- `evidence.readiness.diagnostics`
- `false_positive.risk.diagnostics`
- `grade.premium.engine`
- `identity.parser.diagnostics`
- `listing.quality.grading.diagnostics`
- `population.intelligence.engine`
- `production.valuation.diagnostics`
- `valuation.range_first.diagnostics`

Missing expected Signals are represented explicitly as missing optional references and evidence gaps. They do not block bundle construction, but they should block later certification readiness.

## Builder Compatibility

Each bundle includes `builderInput`, a deterministic projection that can be consumed by:

```text
validation/decisionIntelligenceArtifactBuilder.js
```

The projection includes normalized:

- `listingRef`
- `canonicalIdentityRef`
- `signalRefs`
- `valuationRefs`
- `productionDecisionRef`
- `dealGateRef`
- `buyNowRef`
- `governanceRefs`
- `evidenceQualityAssessment`
- `comparableQualityAssessment`
- `unknownValues`
- `outstandingEvidenceGaps`
- `provenance`

The bundle still remains the source of the packaging state; the builder produces a separate immutable Decision Intelligence artifact.

## Determinism

The bundle builder:

- normalizes timestamps
- sorts Signal references
- sorts missing references
- sorts evidence gaps
- sorts unknown values
- deep-clones embedded projections
- deep-freezes returned bundles
- computes deterministic fingerprints

Identical input produces identical output and bundle fingerprints.

## Validation

Validation returns:

- `valid`
- `errors`
- `warnings`
- `reasonCodes`
- `missingRequiredFields`
- `missingReferences`
- `fingerprintViolations`
- `authorityViolations`
- `referenceViolations`
- `evidenceGapViolations`
- `unknownValueViolations`

Validation checks:

- schema version
- source
- required top-level fields
- authority boundaries
- required evidence references
- Signal reference names and fingerprints
- explicit missing references
- evidence gap descriptions
- unknown value fields
- bundle fingerprint integrity
- builderInput compatibility with the Decision Intelligence Artifact Builder

## Comparison

`compareDecisionIntelligenceEvidenceBundles(left, right)` returns deterministic field-level parity information.

It reports:

- `exact_match`
- `mismatch`
- mismatch count
- field comparisons
- mismatch metadata
- non-authoritative boundary fields
- comparison fingerprint

The comparison is observational only. It does not choose a preferred bundle or repair mismatches.

## Authority Boundaries

The bundle is always:

- offline-only
- advisory-only
- evidence-only
- non-authoritative

It must never:

- authorize a purchase
- modify Deal Gate
- modify BUY_NOW
- modify Decision Engine logic
- modify Signals
- modify Governance
- recompute valuation
- execute production engines
- import production runtime code
- write production persistence

## Future Governance Binding

The bundle is designed to feed future Governance workflows:

```text
Evidence Bundle
-> Decision Intelligence Artifact
-> Artifact Conformance Report
-> Governance Artifact Registry
-> Review Package binding
-> Workspace review
-> Pipeline validation
```

Governance binding should use bundle IDs and fingerprints. Governance should not recompute the referenced evidence.

## Non-Goals

This phase does not:

- change production behavior
- add runtime integration
- execute Signal migrations
- execute valuation engines
- execute Deal Gate
- alter BUY_NOW
- create recommendations
- approve decisions
- deploy changes
