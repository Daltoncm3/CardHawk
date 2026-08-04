# Phase 18.2B - Decision Intelligence Canonical Signal Reference Projection Contract

## 1. Executive Summary

This document defines the authoritative Decision Intelligence Canonical Signal Reference Projection Contract for CardHawk.

Phase 18.2A determined that Decision Intelligence is structurally prepared to consume Signal evidence by reference, but it should not consume raw Runtime-to-Canonical Signal Compatibility Adapter output directly. Adapter and conformance artifacts are compatibility evidence. Decision Intelligence expects normalized `signalRefs`.

This contract defines the stable offline projection interface between validated Canonical Signal artifacts and the Decision Intelligence Evidence Bundle. The projection layer is a reference boundary only. It exposes immutable Canonical Signal, alignment, report, shadow comparison, adapter, and conformance artifact references to Decision Intelligence without changing either subsystem.

This is not an implementation. It does not create projection code, runtime wiring, Shadow Mode wiring, production persistence, scanner behavior, Deal Gate changes, BUY_NOW changes, notification changes, or Governance promotion.

Final architectural determination:

**A. The projection contract is sufficient for implementation.**

The recommended next phase is **Phase 18.2C - Decision Intelligence Canonical Signal Reference Projection Implementation**, an offline-only implementation of this contract.

## 2. Purpose

The purpose of the projection contract is to define how Canonical Signal artifacts become Decision Intelligence-compatible references.

The contract exists because the two subsystems intentionally use different native shapes:

- Canonical Signal Framework artifacts preserve rich offline signal evidence, alignment state, migration state, shadow comparison parity, conflict reports, warnings, fingerprints, registry context, and authority boundaries.
- Decision Intelligence consumes compact `signalRefs` inside `buildDecisionIntelligenceEvidenceBundle()` and `buildDecisionIntelligenceArtifact()`.

The projection layer bridges those shapes by reference only.

It answers:

```text
Which canonical/offline Signal artifact is being represented to Decision Intelligence,
what is its integrity and readiness state,
and which immutable source artifacts prove that representation?
```

It must not answer:

```text
Should CardHawk buy this card?
Should Deal Gate pass?
Should BUY_NOW become eligible?
Should production scoring change?
Should canonical output replace native runtime output?
```

Those questions remain outside this contract.

## 3. Scope

In scope:

- Offline projection from Canonical Signal artifacts to Decision Intelligence `signalRefs`.
- Offline projection from Runtime-to-Canonical adapter/conformance artifacts to Decision Intelligence-compatible Signal references.
- Reference identity, schema version, provenance, fingerprint, readiness, warning, confidence, eligibility, and authority metadata.
- Explicit failure and unsupported-projection representation.
- Compatibility with existing Decision Intelligence Evidence Bundle, Artifact Builder, Governance Binding, Review Workspace, Shadow Validation, and future Decision Intelligence stages.

Out of scope:

- Runtime integration.
- Shadow Mode runtime integration.
- Production scanner integration.
- Production scoring integration.
- Deal Gate integration.
- BUY_NOW integration.
- Notification or alert integration.
- Persistence integration.
- Canonical Signal schema changes.
- Decision Intelligence schema changes.
- Governance schema changes.
- Adapter implementation.
- Projection implementation.
- Automatic execution of signal producers, migrations, adapters, or validators.

## 4. Authoritative Sources

This contract is governed by:

- Approved Project State v9.0.
- `docs/phase-18.2A-decision-intelligence-shadow-integration-planning-audit.md`
- `docs/phase-18.1A-runtime-signal-canonical-boundary-audit.md`
- `docs/phase-18.1B-runtime-to-canonical-signal-compatibility-specification.md`
- `docs/phase-18.1C-runtime-to-canonical-signal-adapter-contract.md`
- `docs/runtime-canonical-signal-conformance-checklist.md`
- `validation/fixtures/runtimeCanonicalSignalCompatibilityFixtures.json`
- `validation/runtimeCanonicalSignalCompatibilityAdapter.js`
- `validation/runtimeCanonicalSignalCompatibilityConformance.js`
- `validation/canonicalIntelligenceSignalContract.js`
- `validation/intelligenceSignalRegistry.js`
- `validation/signalAlignmentContract.js`
- `validation/signalAlignmentBatch.js`
- `validation/signalAlignmentEngine.js`
- `validation/signalAlignmentReport.js`
- `validation/signalShadowComparisonCore.js`
- `validation/decisionIntelligenceEvidenceBundle.js`
- `validation/decisionIntelligenceArtifactBuilder.js`
- `validation/decisionIntelligencePipelineOrchestrator.js`
- `validation/decisionIntelligenceGovernanceBindingAdapter.js`
- `validation/governanceReviewWorkspaceOrchestrator.js`

If future implementation conflicts with this document, the implementation must stop and produce an audit or contract amendment before continuing.

## 5. Architectural Role

The projection layer sits between validated Signal artifacts and Decision Intelligence evidence construction.

Recommended placement:

```text
Canonical Signal / Alignment / Report / Shadow Comparison artifacts
and/or Runtime-to-Canonical Adapter + Conformance artifacts
        |
        v
Decision Intelligence Canonical Signal Reference Projection
        |
        v
Decision Intelligence Evidence Bundle signalRefs + governanceRefs
        |
        v
Decision Intelligence Artifact
        |
        v
Decision Intelligence Governance Binding
        |
        v
Governance Review Workspace
```

The layer's architectural role is reference projection, not signal transformation.

It should project:

- canonical signal identity
- canonical signal fingerprint
- alignment fingerprint
- migration fingerprint
- shadow comparison fingerprint
- alignment report fingerprint
- adapter compatibility fingerprint
- conformance fingerprint
- coverage state
- parity state
- readiness state
- authority state
- warning summary
- confidence provenance
- source artifact provenance

It should not project:

- new scores
- new valuations
- new recommendations
- new Deal Gate outcomes
- new BUY_NOW eligibility
- new production readiness
- rewritten canonical signal meaning

## 6. Ownership Boundaries

### Canonical Signal Framework Owns

- Canonical Signal artifact schema.
- Canonical Signal fingerprints.
- Signal registry definitions.
- Signal alignment artifacts.
- Signal alignment batches and runs.
- Signal conflict analysis.
- Signal alignment reports.
- Signal migration artifacts.
- Shadow comparison artifacts.
- Runtime-to-Canonical compatibility adapter outputs.
- Runtime-to-Canonical conformance outputs.

### Decision Intelligence Owns

- Evidence Bundle schema.
- `signalRefs` normalization.
- Expected signal list.
- Evidence gaps and missing references.
- Decision Intelligence artifacts.
- Decision Intelligence conformance.
- Decision Intelligence pipeline reports.
- Advisory recommendation summaries.

### Governance Owns

- Artifact registry.
- Lifecycle state.
- Review package bindings.
- Review sessions.
- Workspace summaries.
- Governance Binding artifacts.
- Readiness and certification presentation.

### Projection Layer Owns

- Deterministic projection identity.
- Source-artifact reference mapping.
- Projection validation.
- Projection fingerprint.
- Explicit unsupported-projection records.
- Boundary-preserving metadata between Canonical Signals and Decision Intelligence.

The projection layer does not own any upstream artifact semantics and does not own downstream Decision Intelligence decisions.

## 7. Projection Principles

The following architectural invariants are mandatory:

1. Projection is offline-only.
2. Projection is reference-only.
3. Projection is immutable.
4. Projection is deterministic.
5. Projection does not execute signal producers.
6. Projection does not execute production engines.
7. Projection does not execute the scanner.
8. Projection does not execute Deal Gate.
9. Projection does not execute BUY_NOW.
10. Projection does not send alerts or notifications.
11. Projection does not write production persistence.
12. Projection does not modify Canonical Signal artifacts.
13. Projection does not modify Decision Intelligence artifacts.
14. Projection does not modify Governance artifacts.
15. Projection does not reinterpret Canonical Signal meaning.
16. Projection does not recompute confidence.
17. Projection does not recompute valuation.
18. Projection does not recompute evidence sufficiency.
19. Projection does not repair missing evidence.
20. Projection does not suppress warnings.
21. Projection does not convert unknown values into positive evidence.
22. Projection does not convert null values into supported evidence.
23. Projection does not create Deal Gate eligibility.
24. Projection does not create BUY_NOW eligibility.
25. Projection does not create notification eligibility.
26. Projection does not create production authority.
27. Projection preserves source artifact fingerprints.
28. Projection preserves canonical signal fingerprints when supplied.
29. Projection keeps review readiness separate from certification readiness.
30. Projection fails closed when required source integrity cannot be verified.

## 8. Required Inputs

The future projection implementation should accept already-created offline artifacts only.

Required projection input envelope:

```js
{
  schemaVersion: "decision_intelligence_canonical_signal_projection_input.v1",
  projectionRunId: "projection-run-001",
  createdAt: "2026-08-04T00:00:00.000Z",
  sourceArtifacts: [],
  expectedSignalNames: [],
  listingRef: {},
  decisionIntelligenceContext: {},
  provenance: {},
  productionImpact: "none",
  decisionImpact: "none",
  executionAuthority: "none"
}
```

Supported source artifact types:

- `canonical_intelligence_signal`
- `signal_alignment`
- `signal_alignment_batch`
- `signal_alignment_run`
- `signal_alignment_report`
- `signal_migration_artifact`
- `signal_shadow_comparison`
- `runtime_canonical_signal_compatibility_adapter_output`
- `runtime_canonical_signal_compatibility_conformance_record`
- `runtime_canonical_signal_compatibility_conformance_report`

Each supplied source artifact reference must preserve:

- artifact ID
- artifact type
- source
- schema version
- created timestamp when available
- signal name when available
- signal version when available
- canonical Signal fingerprint when available
- source/native output fingerprint when available
- alignment fingerprint when available
- migration fingerprint when available
- shadow comparison fingerprint when available
- report fingerprint when available
- adapter compatibility fingerprint when available
- conformance fingerprint when available
- validation status when available
- warning and error summaries when available
- authority fields
- provenance

Input validation must reject or block:

- missing source artifact identity for required inputs
- missing fingerprint for required source artifacts
- authority fields other than `none`
- mutable source artifact references
- runtime-only objects passed as if they were validated offline artifacts
- unsupported source artifact types marked as required

## 9. Required Outputs

The future projection implementation should produce an immutable projection artifact with this top-level shape:

```js
{
  schemaVersion: "decision_intelligence_canonical_signal_reference_projection.v1",
  source: "decision_intelligence_canonical_signal_reference_projection",
  projectionId: "decision-intelligence-signal-projection:listing-001",
  projectionVersion: "1.0.0",
  createdAt: "2026-08-04T00:00:00.000Z",
  listingId: "listing-001",
  projectionStatus: "projected",

  signalRefs: [],
  governanceRefs: [],
  missingReferences: [],
  evidenceGaps: [],
  unknownValues: [],
  warningPropagation: {},
  readinessPropagation: {},
  confidencePropagation: {},
  eligibilityPropagation: {},
  authorityPreservation: {},
  unsupportedProjections: [],
  sourceArtifactReferences: [],
  validation: {},
  provenance: {},

  productionImpact: "none",
  decisionImpact: "none",
  executionAuthority: "none",
  projectionFingerprint: "sha256:..."
}
```

### `signalRefs` Output Shape

Projected `signalRefs` must match the existing Decision Intelligence reference vocabulary:

```js
{
  signalFamily: "evidence.readiness.diagnostics",
  signalName: "evidence.readiness.diagnostics",
  signalVersion: "1.0.0",
  signalId: "signal-id",
  signalFingerprint: "sha256:...",
  alignmentId: "alignment-id-or-unknown",
  alignmentFingerprint: "sha256:... or unknown",
  migrationFingerprint: "sha256:... or unknown",
  shadowComparisonFingerprint: "sha256:... or unknown",
  reportFingerprint: "sha256:... or unknown",
  coverageStatus: "available",
  parityStatus: "exact_match",
  authorityStatus: "none",
  sourceOutputFingerprint: "sha256:...",
  summary: "Projected from validated Canonical Signal artifact.",
  metadata: {
    projectionId: "projection-id",
    sourceArtifactType: "canonical_intelligence_signal",
    sourceArtifactId: "source-id",
    sourceArtifactFingerprint: "sha256:...",
    compatibilityFingerprint: "sha256:... or unknown",
    conformanceFingerprint: "sha256:... or unknown",
    warningCount: 0,
    errorCount: 0,
    readinessStatus: "review_ready",
    certificationStatus: "certification_ready"
  }
}
```

### `governanceRefs` Output Shape

Projection should preserve adapter, conformance, report, and validation artifacts as Governance-compatible references when they are relevant but not direct `signalRefs`.

Recommended reference shape:

```js
{
  referenceId: "artifact-id",
  referenceType: "runtime_canonical_signal_compatibility_conformance_report",
  source: "runtime_canonical_signal_compatibility_conformance",
  sourceArtifactId: "artifact-id",
  sourceFingerprint: "sha256:...",
  schemaVersion: "1.0.0",
  status: "valid",
  summary: "Conformance source for projected signal references.",
  metadata: {},
  productionImpact: "none",
  decisionImpact: "none",
  executionAuthority: "none"
}
```

## 10. Projection Identity

Projection artifacts must have stable identity.

Required identity fields:

- `schemaVersion`
- `source`
- `projectionId`
- `projectionVersion`
- `createdAt`
- `listingId`
- `projectionStatus`
- `projectionFingerprint`

Recommended `projectionId` format:

```text
decision-intelligence-signal-projection:<listing-id-or-review-package-id>:<projection-run-id>
```

If no listing ID is available, projection must use `unknown` explicitly and emit a validation warning or error depending on requiredness.

Projection identity must not reuse:

- canonical Signal IDs
- alignment IDs
- migration IDs
- adapter run IDs
- conformance report IDs
- Decision Intelligence bundle IDs
- Governance binding IDs

Projection identity is a new reference artifact identity.

## 11. Projection Lifecycle

Projection lifecycle:

```text
Source artifacts collected
-> source artifact references validated
-> canonical Signal identity resolved
-> Decision Intelligence signalRefs projected
-> unsupported projections recorded
-> warning/readiness/confidence/eligibility metadata propagated
-> authority boundaries validated
-> projection artifact fingerprinted
-> projection artifact supplied to Decision Intelligence Evidence Bundle
```

Supported lifecycle statuses:

- `initialized`
- `projected`
- `projected_with_warnings`
- `partially_projected`
- `unsupported`
- `blocked`
- `invalid`

Status rules:

- `projected`: all required source artifacts are valid and all expected signal references are projected.
- `projected_with_warnings`: all required references are projected, but non-blocking warnings remain.
- `partially_projected`: at least one optional or expected signal cannot be projected but required evidence remains usable.
- `unsupported`: source artifacts are valid but cannot be projected under this contract.
- `blocked`: required source artifact integrity, authority, or fingerprint validation failed.
- `invalid`: projection artifact schema or fingerprint validation failed.

Projection lifecycle status must not be interpreted as production readiness.

## 12. Warning Propagation

Warnings must remain visible and source-attributed.

Projection must preserve warnings from:

- Canonical Signal warnings.
- Signal alignment warnings.
- Signal alignment report warnings.
- Signal migration warnings.
- Shadow comparison warnings.
- Runtime-to-Canonical adapter warnings.
- Runtime-to-Canonical conformance warnings.
- Unknown warning codes.
- Warning severity when supplied.

Warning propagation summary should include:

```js
{
  warningCount: 0,
  blockingWarningCount: 0,
  sourceWarningCounts: {},
  warningsBySignalName: {},
  warningsByArtifactType: {},
  unknownWarningCodes: [],
  preservedSeverities: [],
  productionImpact: "none",
  decisionImpact: "none",
  executionAuthority: "none"
}
```

Rules:

- Warnings may be summarized, but source warning arrays must remain available by reference or metadata.
- Warnings must not be collapsed into a pass/fail boolean.
- Warnings must not be suppressed because a projection succeeded.
- Warnings must not be converted into Deal Gate reasons.
- Warnings must not create BUY_NOW eligibility.

## 13. Readiness Propagation

Readiness is advisory and review-scoped only.

Projection may propagate:

- adapter-validation readiness
- conformance readiness
- coverage readiness
- review readiness
- certification readiness
- shadow validation readiness
- missing-reference readiness

Projection must not propagate:

- production readiness
- Deal Gate readiness
- BUY_NOW readiness
- notification readiness
- deployment readiness

Recommended readiness shape:

```js
{
  projectionReadiness: "review_ready_with_warnings",
  reviewReadiness: "review_ready_with_warnings",
  certificationReadiness: "blocked_missing_required_signal",
  sourceReadiness: {},
  missingRequiredSignals: [],
  missingOptionalSignals: [],
  blockingReasons: [],
  nonBlockingWarnings: [],
  productionImpact: "none",
  decisionImpact: "none",
  executionAuthority: "none"
}
```

Readiness rules:

- Missing required projection inputs block projection readiness.
- Missing expected but optional signal families may allow review readiness but block certification readiness.
- Unsupported mappings remain visible and should generally block certification readiness.
- Incompatible or rejected authority-risk mappings must be represented as blocked or unsupported, not silently omitted.
- Readiness must never be upgraded from source artifacts.

## 14. Confidence Propagation

Projection may preserve confidence values and confidence metadata by reference.

Projection must not recompute confidence.

Allowed confidence metadata:

- source confidence value
- confidence level
- confidence basis
- uncertainty
- calibration status
- confidence source artifact ID
- confidence source fingerprint
- confidence warnings
- confidence unknowns

Recommended confidence propagation shape:

```js
{
  confidencePreserved: true,
  confidenceInvented: false,
  confidenceRecomputed: false,
  confidenceSources: [],
  missingConfidenceSignals: [],
  confidenceWarnings: [],
  confidenceUnknowns: [],
  productionImpact: "none",
  decisionImpact: "none",
  executionAuthority: "none"
}
```

Rules:

- Missing confidence remains `unknown`.
- `null` confidence remains explicitly null or unknown according to source contract.
- Runtime confidence must not become valuation confidence unless the source explicitly says so.
- Canonical confidence must not become Decision Intelligence purchase authority.
- Confidence values must be attached to provenance and fingerprints.

## 15. Authority Preservation

Projection must enforce authority preservation at every boundary.

Required authority fields:

```js
{
  productionImpact: "none",
  decisionImpact: "none",
  executionAuthority: "none"
}
```

Required authority metadata:

```js
{
  authorityStatus: "none",
  dealGateEligibilityCreated: false,
  buyNowEligibilityCreated: false,
  notificationEligibilityCreated: false,
  productionApprovedLabelCreated: false,
  authorityViolations: []
}
```

Prohibited authority changes:

- Creating Deal Gate pass state.
- Creating Deal Gate eligibility.
- Creating BUY_NOW eligibility.
- Creating notification eligibility.
- Creating alert eligibility.
- Creating production approval.
- Creating deployment readiness.
- Reclassifying an advisory signal as authoritative.
- Reclassifying a canonical Signal as a production decision.
- Treating conformance success as production integration approval.

If any source artifact contains authority fields other than `none`, projection must fail closed.

## 16. Deterministic Behavior

Projection must be deterministic for identical inputs.

Deterministic requirements:

- Stable source artifact ordering.
- Stable `signalRefs` ordering.
- Stable `governanceRefs` ordering.
- Stable missing reference ordering.
- Stable evidence gap ordering.
- Stable warning ordering unless source order is semantically preserved.
- Stable reason code ordering.
- Stable readiness state selection.
- Stable fingerprint projection.
- Stable validation output.

Recommended sort key for `signalRefs`:

```text
signalName|signalVersion|signalFingerprint|sourceOutputFingerprint
```

Recommended sort key for source artifact references:

```text
artifactType|source|sourceArtifactId|sourceFingerprint
```

Projection must not use wall-clock time unless caller supplies `createdAt`. Missing timestamps must remain `unknown`.

## 17. Versioning

Initial projection schema:

```text
decision_intelligence_canonical_signal_reference_projection.v1
```

Initial projection source:

```text
decision_intelligence_canonical_signal_reference_projection
```

Initial projection version:

```text
1.0.0
```

Versioning rules:

- Minor-compatible additions may add optional fields.
- Required-field changes require a new schema version.
- Meaning changes require a new schema version.
- Fingerprint projection changes require a new schema version or explicit fingerprint version field.
- Decision Intelligence Evidence Bundle schema changes are not allowed in this contract.
- Canonical Signal schema changes are not allowed in this contract.
- Governance Binding schema changes are not allowed in this contract.
- Older projections must remain reviewable as historical artifacts.

## 18. Failure Handling

Projection must fail closed.

Failure classes:

- `missing_required_source_artifact`
- `unsupported_source_artifact_type`
- `invalid_source_schema`
- `source_fingerprint_missing`
- `source_fingerprint_mismatch`
- `canonical_signal_missing`
- `canonical_signal_invalid`
- `alignment_invalid`
- `shadow_comparison_invalid`
- `adapter_conformance_invalid`
- `authority_boundary_violation`
- `warning_preservation_violation`
- `readiness_upgrade_detected`
- `confidence_recomputed`
- `unknown_value_not_preserved`
- `null_value_not_preserved`
- `projection_fingerprint_mismatch`

Failure behavior:

- Required failures block projection.
- Optional unsupported artifacts become `unsupportedProjections`.
- Expected-but-missing Signals become `missingReferences` and `evidenceGaps`.
- Incompatible mappings remain visible.
- Rejected authority-risk mappings remain visible as blocked evidence.
- Projection must not repair or replace failed source artifacts.

## 19. Validation Requirements

Projection validation must return structured output:

```js
{
  valid: true,
  errors: [],
  warnings: [],
  reasonCodes: [],
  missingRequiredFields: [],
  missingReferences: [],
  unsupportedProjections: [],
  fingerprintViolations: [],
  authorityViolations: [],
  warningViolations: [],
  readinessViolations: [],
  confidenceViolations: [],
  provenanceViolations: [],
  compatibilityViolations: []
}
```

Validation must verify:

1. Required top-level projection fields.
2. Supported schema version.
3. Supported source.
4. Source artifact identity.
5. Source artifact fingerprint presence.
6. Source artifact fingerprint consistency when source artifacts are supplied.
7. Canonical Signal fingerprint consistency when canonical signals are supplied.
8. Adapter compatibility fingerprint consistency when adapter artifacts are supplied.
9. Conformance fingerprint consistency when conformance artifacts are supplied.
10. `signalRefs` compatibility with Decision Intelligence normalization.
11. `governanceRefs` compatibility with Governance Binding reference shape.
12. Warning preservation.
13. Readiness preservation.
14. Confidence preservation.
15. Unknown-value preservation.
16. Null-value preservation.
17. Authority boundary preservation.
18. Projection fingerprint integrity.

Validation must never execute production runtime or recompute source evidence.

## 20. Compatibility Guarantees

The projection contract guarantees:

- Backward compatibility with existing Decision Intelligence Evidence Bundle `signalRefs`.
- Backward compatibility with existing Decision Intelligence Artifact Builder `signalRefs`.
- Compatibility with Decision Intelligence Governance Binding `governanceReferences`.
- Compatibility with Governance Artifact Registry registration by ID and fingerprint.
- Compatibility with Governance Lifecycle tracking as immutable artifacts.
- Compatibility with Governance Review Session package snapshots.
- Compatibility with Governance Review Workspace `signalGovernance` presentation.
- Compatibility with Phase 18.1 Runtime-to-Canonical adapter/conformance artifacts.
- Compatibility with existing Signal migration, alignment, report, and shadow comparison artifacts.

The projection contract does not guarantee:

- Production integration readiness.
- Runtime display replacement.
- Deal Gate eligibility.
- BUY_NOW eligibility.
- Notification eligibility.
- Canonical Signal authority.
- Complete Signal coverage when source artifacts are missing.

## 21. Interaction with Other Subsystems

This section defines 12 mandatory interaction rules.

### Rule 1 - Decision Intelligence Evidence Bundle

Projection output may be supplied to `buildDecisionIntelligenceEvidenceBundle()` as `signalRefs`, `governanceRefs`, `missingReferences`, `evidenceGaps`, `unknownValues`, and provenance metadata.

It must not require Evidence Bundle schema changes.

### Rule 2 - Decision Intelligence Artifact Builder

Projection output must reach the Artifact Builder only through the Evidence Bundle's existing `builderInput`.

It must not bypass the Evidence Bundle.

### Rule 3 - Decision Intelligence Pipeline Orchestrator

Projection may be used before `runDecisionIntelligencePipeline()` receives input.

The Pipeline Orchestrator must not execute projection unless a future phase explicitly adds an offline-only orchestration option.

### Rule 4 - Governance Binding

Projection artifacts may be bound through `governanceRefs` and Decision Intelligence Governance Binding references.

Governance Binding must not transform projection output into production authority.

### Rule 5 - Review Workspace

Review Workspace should consume projection state through bound Review Package or Governance references.

It must not compute projection output itself.

### Rule 6 - Shadow Validation

Projection may reference shadow comparison artifacts and parity status.

It must not execute shadow comparison modules.

### Rule 7 - Runtime-to-Canonical Adapter

Projection may consume adapter outputs only after they already exist.

It must not execute the adapter from production runtime.

### Rule 8 - Runtime-to-Canonical Conformance

Projection may consume conformance records or reports as validation evidence.

It must preserve conformance warnings and readiness state.

### Rule 9 - Canonical Signal Framework

Projection may reference Canonical Signal artifacts.

It must not modify canonical signal fields, fingerprints, warnings, blockers, raw outputs, normalized outputs, governance flags, or authority fields.

### Rule 10 - Runtime Production System

Projection must not import or modify `server.js`, scanner services, marketplace adapters, persistence modules, notification systems, Deal Gate runtime, BUY_NOW runtime, or runtime display utilities.

### Rule 11 - Future Decision Intelligence Stages

Future Decision Intelligence stages may consume projection artifacts as evidence references.

They must preserve non-authoritative status unless a future governed production proposal explicitly changes authority.

### Rule 12 - Historical Review

Older projections must remain reviewable, even when superseded by newer projection versions.

Supersession must be explicit and must not mutate historical artifacts.

## 22. Known Limitations

Known limitations:

1. This contract does not define implementation code.
2. This contract does not define tests.
3. This contract does not create a module path.
4. This contract does not define a complete JSON schema file.
5. This contract does not modify Decision Intelligence Evidence Bundle inputs.
6. This contract does not modify Canonical Signal artifacts.
7. This contract does not resolve all runtime-to-canonical vocabulary differences.
8. This contract does not determine which Signal families are required for certification in every future workflow.
9. This contract does not define a UI presentation.
10. This contract does not establish production integration readiness.

These limitations do not block offline implementation because Phase 18.2A already verified that the existing Decision Intelligence boundary is reference-based and compatible with an offline projection layer.

## 23. Future Implementation Requirements

The implementation phase must create an offline module only.

Required implementation properties:

- Public helpers for building, validating, summarizing, comparing, exporting, importing, and fingerprinting projection artifacts.
- Deterministic projection artifacts.
- Immutable returned objects.
- Structured validation.
- Fixture coverage for canonical Signal artifacts, adapter artifacts, conformance artifacts, unsupported artifacts, missing artifacts, invalid authority, warning propagation, readiness propagation, confidence propagation, and fingerprint drift.
- No production imports.
- No runtime integration.
- No Shadow Mode runtime integration.
- No scanner integration.
- No persistence writes.
- No server routes.
- No test weakening.

Recommended future public APIs:

- `buildDecisionIntelligenceSignalReferenceProjection`
- `validateDecisionIntelligenceSignalReferenceProjection`
- `projectCanonicalSignalToDecisionSignalRef`
- `projectRuntimeCanonicalCompatibilityToDecisionSignalRef`
- `summarizeDecisionIntelligenceSignalReferenceProjection`
- `compareDecisionIntelligenceSignalReferenceProjections`
- `buildDecisionIntelligenceSignalReferenceProjectionFingerprint`

Recommended future module:

```text
validation/decisionIntelligenceSignalReferenceProjection.js
```

Recommended future tests:

```text
tests/decision-intelligence-signal-reference-projection.test.js
```

Recommended future documentation:

```text
docs/architecture/decision-intelligence-signal-reference-projection.md
```

## 24. Final Architectural Determination

Selected determination:

**A. The projection contract is sufficient for implementation.**

Rationale:

The existing repository already has the necessary surrounding architecture:

- Canonical Signal artifacts are immutable and fingerprinted.
- Signal alignment, migration, report, and shadow comparison artifacts are already referenceable.
- Runtime-to-Canonical compatibility adapter and conformance artifacts are already offline and non-authoritative.
- Decision Intelligence Evidence Bundle already accepts normalized `signalRefs`.
- Decision Intelligence Artifact Builder already preserves Signal references and missing expected Signals.
- Decision Intelligence Pipeline Orchestrator is offline and does not import production runtime.
- Decision Intelligence Governance Binding can carry references without schema changes.
- Review Workspace orchestration can surface Signal-aware package state through existing `signalGovernance` references.

The missing work is implementation, not another architecture specification.

Recommended next phase:

**Phase 18.2C - Decision Intelligence Canonical Signal Reference Projection Implementation**

Production integration remains out of scope. Runtime integration remains out of scope. Shadow Mode runtime integration remains out of scope. Deal Gate and BUY_NOW remain unchanged.

