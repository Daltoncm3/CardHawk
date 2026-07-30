# Decision Intelligence Artifact Builder

Phase 17.2A implements the offline builder for Decision Intelligence artifacts.

The builder is offline-only. It does not modify `server.js`, Deal Gate, BUY_NOW, scoring, Signals, Governance, valuation, scanner behavior, persistence, notification behavior, or production runtime behavior.

## Purpose

The builder constructs immutable Decision Intelligence artifacts from evidence that already exists. It is a packaging and interpretation layer, not a production decision engine.

It accepts supplied references and summaries for:

- listing identity
- canonical identity
- Signal artifacts
- valuation artifacts
- native decision engine output
- Deal Gate output
- BUY_NOW observation
- shadow artifacts
- governance artifacts
- confidence, evidence, comparable, risk, opportunity, agreement, and explanation sections

It produces one deterministic advisory artifact suitable for future Governance binding.

## Public API

The module is `validation/decisionIntelligenceArtifactBuilder.js`.

Public helpers:

- `buildDecisionIntelligenceArtifact(input)`
- `validateDecisionIntelligenceArtifact(artifact)`
- `deriveDecisionEvidence(input)`
- `deriveDecisionConfidence(input, evidence)`
- `deriveDecisionExplanation(input, evidence, confidence)`
- `summarizeDecisionArtifact(artifact)`
- `buildDecisionIntelligenceArtifactFingerprint(artifact)`

The fingerprint helper is exported so tests, future registry integration, and Governance binding can verify deterministic artifact integrity.

## Builder Flow

```text
Supplied source references
-> deriveDecisionEvidence
-> deriveDecisionConfidence
-> deriveDecisionExplanation
-> assemble immutable Decision Intelligence artifact
-> calculate deterministic artifact fingerprint
-> validate authority, references, unknowns, gaps, compatibility, and fingerprint
```

The builder never executes production engines and never asks Signals or valuation systems to recompute output.

## Reference-Only Evidence Model

The builder consumes evidence by reference where practical.

Each source reference should preserve:

- source artifact ID
- source artifact fingerprint
- schema version
- source name
- status
- deterministic summary
- metadata

Signal references preserve:

- Signal name and family
- Signal version
- Signal ID
- Signal fingerprint
- alignment fingerprint
- migration fingerprint
- shadow comparison fingerprint
- report fingerprint
- native source output fingerprint
- parity status
- authority status

The builder can carry compact summaries, but the authoritative evidence remains the referenced source artifact.

## Expected Signal Coverage

The builder knows the current expected Signal families from the Phase 14 coverage certification:

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

Missing expected Signals are preserved as explicit evidence gaps. Missing Signals do not prevent artifact construction, but they should prevent certification readiness in future Governance binding.

## Authority Boundaries

Every artifact produced by the builder preserves:

- `productionImpact: "none"`
- `decisionImpact: "none"`
- `executionAuthority: "none"`

The advisory recommendation also preserves:

- `productionAuthority: "none"`
- `purchaseAuthority: "none"`
- `recommendationImpact: "none"`

BUY_NOW may appear only as observed production or Deal Gate evidence. The builder never emits a self-authorizing BUY_NOW command.

## Determinism and Immutability

The builder:

- normalizes timestamps to ISO strings when possible
- sorts Signal references deterministically
- sorts reason, unknown-value, and evidence-gap collections deterministically
- deep-clones source projections before embedding
- deep-freezes returned artifacts
- excludes `artifactFingerprint` from its own fingerprint payload

Identical inputs produce identical artifacts and fingerprints.

## Validation Model

Validation returns:

- `valid`
- `errors`
- `warnings`
- `reasonCodes`
- `missingRequiredFields`
- `authorityViolations`
- `fingerprintViolations`
- `sourceReferenceViolations`
- `unknownValueViolations`
- `evidenceGapViolations`
- `compatibilityViolations`

Validation checks:

- required top-level fields
- schema version and source
- authority boundaries
- advisory recommendation boundaries
- BUY_NOW purchase authority
- Signal reference completeness
- explicit unknown-value fields
- explicit evidence-gap descriptions
- compatibility flags
- artifact fingerprint integrity

## Compatibility Guarantees

The builder is additive and wrapper-first.

It preserves:

- existing Deal Gate behavior
- existing BUY_NOW behavior
- existing scoring logic
- existing valuation calculations
- existing Signal outputs
- existing Governance behavior
- existing persisted formats
- existing runtime APIs

Future production use requires the Phase 12 Governance chain, explicit Dalton approval, implementation, validation, deployment, and monitoring.

## Future Integration

Expected future phases:

1. Bind artifacts into Signal Governance Evidence Bundles.
2. Register artifacts in the Governance Artifact Registry.
3. Surface summaries in the offline review workspace.
4. Build a Decision Explanation Graph from artifact traces.
5. Compare advisory artifacts against Dalton review outcomes.
6. Use reviewed evidence for offline recommendations and experiments.
7. Consider production proposals only after Governance evidence supports a specific change.

## Non-Goals

The builder does not:

- execute production engines
- execute Signal migrations
- execute Governance managers
- recompute valuation
- recompute confidence
- recompute Deal Gate
- modify BUY_NOW
- approve purchases
- send notifications
- persist production state
- integrate with scanner runtime
