# Decision Intelligence Artifact Conformance

Phase 17.2B implements the offline conformance framework for Decision Intelligence artifacts.

The conformance framework validates artifacts produced by `validation/decisionIntelligenceArtifactBuilder.js`. It does not execute production engines, recompute Signals, recompute valuation, modify Deal Gate, modify BUY_NOW, modify Governance, or integrate with runtime behavior.

## Purpose

Decision Intelligence artifacts are intended to become durable advisory evidence for future Governance binding. The conformance framework verifies that an artifact satisfies the contract before it is trusted by later offline review, registry, lifecycle, workspace, or certification tooling.

The validator answers:

- Is the artifact structurally valid?
- Is it immutable?
- Does its fingerprint match its contents?
- Does provenance preserve source IDs and fingerprints?
- Are advisory-only boundaries intact?
- Are listing, identity, decision, Deal Gate, valuation, and Signal references preserved?
- Can repeated construction produce the same artifact?
- Are unknown values and evidence gaps explicit?
- Is the explanation complete enough for review?
- Is the artifact compatible with future Governance binding?

It produces findings only. It never repairs artifacts.

## Public API

Module:

```text
validation/decisionIntelligenceArtifactConformance.js
```

Public helpers:

- `validateDecisionIntelligenceArtifactConformance(artifact, options)`
- `buildDecisionIntelligenceConformanceReport(artifact, options)`
- `summarizeDecisionIntelligenceConformance(report)`
- `compareDecisionIntelligenceArtifacts(left, right)`

Additional exported stage helpers support focused tests and future validation reuse:

- `validateSchemaAndRequiredFields`
- `validateImmutability`
- `validateFingerprintIntegrity`
- `validateProvenanceIntegrity`
- `validateAdvisoryOnlyBoundaries`
- `validateReferenceIntegrity`
- `validateDeterministicConstruction`
- `validateUnknownValuePreservation`
- `validateEvidenceGapPreservation`
- `validateExplanationCompleteness`
- `validateGovernanceBindingCompatibility`

## Conformance Stages

The framework runs deterministic stages in this order:

1. `schema_and_required_fields`
2. `immutability`
3. `fingerprint_integrity`
4. `provenance_integrity`
5. `advisory_boundary`
6. `reference_integrity`
7. `deterministic_construction`
8. `unknown_value_preservation`
9. `evidence_gap_preservation`
10. `explanation_completeness`
11. `governance_binding_compatibility`

Each stage returns:

- `stageName`
- `valid`
- `status`
- `errors`
- `warnings`
- `reasonCodes`
- stage-specific violation lists

The top-level report aggregates all stage results.

## Report Schema

Conformance reports include:

- `schemaVersion`
- `source`
- `conformanceReportId`
- `createdAt`
- `artifactId`
- `artifactFingerprint`
- `stageResults`
- `errors`
- `warnings`
- `reasonCodes`
- per-stage validation sections
- `summary`
- `productionImpact: "none"`
- `decisionImpact: "none"`
- `executionAuthority: "none"`
- `conformanceFingerprint`

The conformance fingerprint is deterministic and excludes itself from the fingerprint payload.

## Validation Rules

### Schema and Required Fields

The artifact must use the canonical Decision Intelligence artifact schema and required top-level fields.

### Immutability

The artifact and major nested sections must be frozen. The artifact must declare:

- `immutability.immutable: true`
- `immutability.mutationPolicy: "new_artifact_required"`

### Fingerprint Integrity

The artifact fingerprint must match the canonical fingerprint helper from the builder. Summaries must be deterministic.

### Provenance Integrity

The artifact must preserve builder identity, source system, builder version, timestamps, input artifact IDs, and input fingerprints where available.

### Advisory Boundary

The artifact and advisory recommendation must remain non-authoritative:

- `productionImpact: "none"`
- `decisionImpact: "none"`
- `executionAuthority: "none"`
- `advisoryRecommendation.productionAuthority: "none"`
- `advisoryRecommendation.purchaseAuthority: "none"`
- `advisoryRecommendation.recommendationImpact: "none"`
- `buyNowRef.purchaseAuthority: "none"`

### Reference Integrity

The validator checks references for:

- listing ID
- canonical identity ID
- decision engine fingerprint
- Deal Gate fingerprint
- Signal names
- Signal fingerprints
- expected Signal coverage

Missing expected Signals are warnings, not conformance failures, because minimum artifact creation remains allowed. They should still block later certification readiness.

### Deterministic Construction

When `sourceInput` is supplied, the validator rebuilds the artifact through the offline builder and compares the resulting artifact fingerprint. This proves the artifact can be reconstructed deterministically from the same evidence input.

When `sourceInput` is not supplied, the validator only proves deterministic summaries and emits a warning.

### Unknown Values and Evidence Gaps

Unknown values and evidence gaps must remain explicit. The validator checks that unknown values identify fields and that evidence gaps include descriptions.

### Explanation Completeness

The artifact should include explanation headline and reason data. It must include a decision trace with messages for review.

### Governance Binding Compatibility

The artifact must have ID, fingerprint, provenance, authority boundaries, and no runtime integration. The conformance result marks whether the artifact is ready for future Governance binding.

## Comparison Model

`compareDecisionIntelligenceArtifacts(left, right)` compares top-level artifact fields without mutating either artifact.

It returns:

- `parityStatus: "exact_match"` when all top-level fields match
- `parityStatus: "mismatch"` when any top-level field differs
- deterministic field comparisons
- mismatch details
- non-authoritative authority fields
- comparison fingerprint

The comparison is observational only. It never selects a preferred artifact and never repairs mismatches.

## Authority Boundaries

The conformance framework must never:

- recompute Signals
- recompute valuation
- execute the Decision Engine
- execute Decision Intelligence runtime logic
- import `server.js`
- modify Deal Gate
- modify BUY_NOW
- modify Governance
- mutate artifacts
- grant purchase authority
- grant production authority

## Future Governance Use

Future Governance tooling can use this conformance report before registering or binding Decision Intelligence artifacts.

Recommended future flow:

```text
Decision Intelligence artifact
-> conformance report
-> Governance Artifact Registry registration
-> Review Package binding
-> Workspace presentation
-> Pipeline validation
-> Dalton review
```

Conformance is not approval. It only proves the artifact is structurally safe enough for offline Governance workflows.

## Non-Goals

This phase does not:

- change production behavior
- change persisted data
- add runtime integration
- alter existing Decision Engine logic
- change Signal migrations
- change Governance managers
- approve any recommendation
- deploy any behavior
