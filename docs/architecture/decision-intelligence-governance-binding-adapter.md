# Decision Intelligence Governance Binding Adapter

## Purpose

The Decision Intelligence Governance Binding Adapter implements the Phase 17.5A binding contract as an offline-only adapter artifact.

It binds completed Decision Intelligence pipeline outputs into Governance by reference and fingerprint. It does not mutate Decision Intelligence artifacts, alter Governance schemas, execute production engines, recompute evidence, or grant production authority.

## Public API

Module:

```text
validation/decisionIntelligenceGovernanceBindingAdapter.js
```

Exports:

- `buildDecisionIntelligenceGovernanceBinding`
- `validateDecisionIntelligenceGovernanceBinding`
- `summarizeDecisionIntelligenceGovernanceBinding`
- `buildDecisionIntelligenceGovernanceBindingFingerprint`
- `compareDecisionIntelligenceGovernanceBindings`

## Binding Flow

The adapter consumes:

- Decision Intelligence pipeline run
- Decision Intelligence stability baseline
- optional stability certification
- optional Review Package reference
- optional Governance Registry, Lifecycle, Review Session, Workspace, and Pipeline Validation references

It produces a frozen binding artifact:

```text
Decision Intelligence Pipeline Run
-> Decision Intelligence Governance Binding
-> Governance Artifact Registry compatible artifact
-> future Lifecycle / Session / Workspace participation
```

## Binding Artifact

The binding artifact includes:

- schema and source metadata
- deterministic binding identity
- listing and Review Package references
- Decision Intelligence references
- Governance references
- validation status
- review readiness
- certification readiness
- warning propagation
- provenance
- compatibility metadata
- audit history
- authority boundary fields
- deterministic binding fingerprint

## Decision Intelligence References

The adapter references:

- Evidence Bundle ID and fingerprint
- Decision Intelligence Artifact ID and fingerprint
- Artifact Conformance report ID and fingerprint
- Pipeline Run ID and fingerprint
- Pipeline Report ID and fingerprint
- Stability Baseline ID and fingerprint
- optional Stability Certification ID and fingerprint

All references are cloned into compact reference objects. The adapter does not embed or modify the authoritative Decision Intelligence source artifacts.

## Governance References

The adapter can carry optional references to:

- Signal Governance Evidence Bundle
- Signal Governance Review Report
- Governance Artifact Registry
- Governance Lifecycle
- Review Session
- Workspace Review
- Governance Pipeline Validation

Missing optional Governance references remain explicit with `not_supplied` status. Their absence does not block review readiness.

## Readiness Model

Review readiness and certification readiness are separate.

Review readiness is based on required Decision Intelligence pipeline artifacts:

- `review_ready`
- `review_ready_with_warnings`
- `blocked_invalid_pipeline`
- `blocked_authority_violation`
- `blocked_fingerprint_violation`

Certification readiness additionally requires conformance and stability baseline references:

- `certification_ready`
- `certification_ready_with_warnings`
- `blocked_missing_conformance`
- `blocked_missing_stability_baseline`
- `not_certified`

Warnings do not disappear. They are propagated into the binding and remain visible to future Governance review.

## Registry And Lifecycle Compatibility

The binding is suitable for Governance Artifact Registry registration using:

```js
{
  artifactType: "decision_intelligence_pipeline_binding",
  artifactId: binding.bindingId,
  artifactSchemaVersion: binding.schemaVersion,
  artifactFingerprint: binding.bindingFingerprint
}
```

Lifecycle participation should use the existing lifecycle states:

- registered
- active
- superseded
- archived

No Registry or Lifecycle schema changes are required.

## Validation

Validation checks:

- required fields
- schema and source
- binding type
- required Decision Intelligence references
- binding fingerprint
- authority boundaries
- audit-history authority boundaries
- readiness status
- stored validation status

Validation returns:

- `valid`
- `errors`
- `warnings`
- `reasonCodes`
- `missingRequiredFields`
- `fingerprintViolations`
- `authorityViolations`
- `readinessViolations`

## Warning Propagation

The binding preserves:

- Evidence Bundle warnings
- Artifact Conformance warnings
- Pipeline Report warnings
- Stability Baseline warnings
- known architectural limitations

The adapter does not suppress, waive, remap, or repair warnings.

## Authority Boundaries

Every binding artifact preserves:

- `productionImpact: "none"`
- `decisionImpact: "none"`
- `executionAuthority: "none"`

The adapter never:

- authorizes BUY_NOW
- approves purchases
- modifies Deal Gate
- modifies BUY_NOW
- modifies scoring
- modifies valuation
- modifies Signals
- modifies Governance implementations
- integrates with production runtime

## Future Work

Next phases can use the binding artifact to implement:

- Registry and Lifecycle integration
- Review Session attachment
- Workspace summary presentation
- end-to-end Governance binding validation
- binding stability baseline

Those phases should continue to use public Governance APIs only.
