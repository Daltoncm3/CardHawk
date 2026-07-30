# Decision Intelligence Governance Binding Contract

## Executive Summary

The Decision Intelligence Governance Binding is the canonical offline adapter artifact that connects completed Decision Intelligence pipeline outputs to CardHawk's existing Governance ecosystem.

The binding does not alter Decision Intelligence artifacts, Governance schemas, Review Packages, Registry behavior, Lifecycle behavior, Review Sessions, Workspace summaries, Deal Gate, BUY_NOW, Signals, valuation, scoring, notifications, persistence, or production runtime.

It exists to answer one question:

```text
Which immutable Decision Intelligence evidence is bound to this Governance review context, and is it review-ready or certification-ready?
```

The binding is immutable, deterministic, reference-based, fingerprint-verifiable, warning-preserving, and non-authoritative.

## Scope

The binding participates in offline Governance by referencing:

- Decision Intelligence Evidence Bundle
- Decision Intelligence Artifact
- Decision Intelligence Artifact Conformance report
- Decision Intelligence Pipeline Run
- Decision Intelligence Pipeline Report
- Decision Intelligence Pipeline Stability Baseline
- optional Decision Intelligence Pipeline Certification
- optional Review Package
- optional Governance Artifact Registry
- optional Lifecycle state
- optional Review Session
- optional Workspace Review

The binding is adapter-only. It allows existing Governance modules to register, track, attach, and summarize Decision Intelligence evidence without changing Governance schemas.

## Binding Artifact Identity

Required identity fields:

- `schemaVersion`
- `source`
- `bindingId`
- `bindingType`
- `bindingVersion`
- `createdAt`
- `asOf`
- `listingId`
- `reviewPackageId`
- `bindingFingerprint`

Recommended values:

```js
{
  schemaVersion: "decision_intelligence_governance_binding.v1",
  source: "decision_intelligence_governance_binding_contract",
  bindingType: "decision_intelligence_pipeline_binding",
  bindingVersion: "1.0.0"
}
```

`bindingId` should be deterministic when deterministic timestamps are supplied. Recommended pattern:

```text
decision-intelligence-governance-binding:<review-package-id-or-listing-id>:<pipeline-run-id>
```

## Binding Schema

Recommended top-level shape:

```js
{
  schemaVersion: "decision_intelligence_governance_binding.v1",
  source: "decision_intelligence_governance_binding_contract",
  bindingId: "decision-intelligence-governance-binding:review-package-001:pipeline-run-001",
  bindingType: "decision_intelligence_pipeline_binding",
  bindingVersion: "1.0.0",
  createdAt: "2026-07-30T00:00:00.000Z",
  asOf: "2026-07-30T00:00:00.000Z",

  listingId: "listing-001",
  reviewPackageId: "review-package-001",
  reviewPackageFingerprint: "sha256:...",

  decisionIntelligenceReferences: {
    evidenceBundle: {},
    artifact: {},
    conformanceReport: {},
    pipelineRun: {},
    pipelineReport: {},
    stabilityBaseline: {},
    stabilityCertification: {}
  },

  governanceReferences: {
    signalGovernanceEvidenceBundle: {},
    signalGovernanceReviewReport: {},
    registry: {},
    lifecycle: {},
    reviewSession: {},
    workspaceReview: {},
    governancePipelineValidation: {}
  },

  validationStatus: {},
  reviewReadiness: {},
  certificationReadiness: {},
  warningPropagation: {},
  provenance: {},
  compatibility: {},
  auditHistory: [],

  productionImpact: "none",
  decisionImpact: "none",
  executionAuthority: "none",
  bindingFingerprint: "sha256:..."
}
```

## Reference Shape

Every artifact reference should use a shared reference shape:

```js
{
  referenceId: "artifact-id",
  referenceType: "decision_intelligence_artifact",
  schemaVersion: "decision_intelligence_artifact.v1",
  source: "decision_intelligence_artifact_builder",
  sourceArtifactId: "artifact-id",
  sourceFingerprint: "sha256:...",
  status: "valid",
  validationReadiness: "review_ready",
  certificationReadiness: "certification_ready_with_warnings",
  summary: "Human-readable summary",
  metadata: {},
  productionImpact: "none",
  decisionImpact: "none",
  executionAuthority: "none"
}
```

Unknown or unavailable references must remain explicit:

```js
{
  referenceId: "unknown",
  referenceType: "decision_intelligence_pipeline_certification",
  sourceFingerprint: "unknown",
  status: "not_supplied",
  validationReadiness: "not_available",
  certificationReadiness: "blocked_missing_reference"
}
```

## Decision Intelligence Artifact References

The binding must support:

### Evidence Bundle Reference

Required for review readiness.

Fields:

- `bundleId`
- `bundleFingerprint`
- `schemaVersion`
- `source`
- `validationStatus`
- `missingReferenceCount`
- `evidenceGapCount`
- `unknownValueCount`

### Decision Intelligence Artifact Reference

Required for review readiness.

Fields:

- `artifactId`
- `artifactFingerprint`
- `schemaVersion`
- `source`
- `advisoryRecommendationType`
- `advisoryRecommendationPosture`
- `evidenceGapCount`
- `unknownValueCount`

### Conformance Report Reference

Required for certification readiness.

Fields:

- `conformanceReportId`
- `conformanceFingerprint`
- `schemaVersion`
- `source`
- `valid`
- `failedStageCount`
- `warningStageCount`
- `reasonCodes`

### Pipeline Run Reference

Required for review readiness.

Fields:

- `runId`
- `pipelineFingerprint`
- `schemaVersion`
- `source`
- `valid`
- `stageCount`
- `failedStageCount`
- `warningStageCount`

### Pipeline Report Reference

Required for review readiness.

Fields:

- `reportId`
- `reportFingerprint`
- `pipelineDiagnostics`
- `reasonCodes`
- `errors`
- `warnings`

### Stability Baseline Reference

Required for certification readiness.

Fields:

- `baselineId`
- `baselineFingerprint`
- `schemaVersion`
- `source`
- `crossComponentIntegrityStatus`
- `deterministicFingerprintStatus`
- `advisoryOnlyBoundaryStatus`
- `offlineBoundaryStatus`
- `certificationStatus`

### Stability Certification Reference

Optional for review readiness; required only when a Governance policy asks for certified Decision Intelligence evidence.

Fields:

- `certificationId`
- `certificationFingerprint`
- `certificationStatus`
- `certified`
- `warnings`
- `knownArchitecturalLimitations`

## Governance Evidence References

The binding may reference existing Governance artifacts without changing their schemas:

### Signal Governance Evidence Bundle

Optional but recommended.

This reference connects Decision Intelligence's Signal references to the broader Signal Governance evidence chain.

### Signal Governance Review Report

Optional for review readiness; recommended for certification readiness.

This reference makes Signal parity, conflicts, unknown values, and report findings visible beside Decision Intelligence conclusions.

### Registry Reference

Optional at construction; required after registry participation.

Fields:

- `registryId`
- `registryFingerprint`
- `registrationId`
- `registrationFingerprint`
- `artifactType: "decision_intelligence_pipeline_binding"`

### Lifecycle Reference

Optional at construction; required after lifecycle participation.

Fields:

- `lifecycleId`
- `lifecycleFingerprint`
- `lifecycleState`
- `latestEventId`
- `latestEventFingerprint`

### Review Session Reference

Optional until the binding is attached to a review workflow.

Fields:

- `sessionId`
- `sessionFingerprint`
- `sessionStatus`
- `attachedPackageIds`

### Workspace Reference

Optional until the binding is surfaced in a workspace.

Fields:

- `workspaceReviewId`
- `workspaceFingerprint`
- `reviewReadiness`
- `certificationReadiness`

### Governance Pipeline Validation Reference

Optional until end-to-end validation runs.

Fields:

- `validationId`
- `validationFingerprint`
- `readiness`
- `reasonCodes`

## Validation Status

The binding validation status should include:

```js
{
  valid: true,
  errors: [],
  warnings: [],
  reasonCodes: [],
  missingRequiredReferences: [],
  fingerprintViolations: [],
  authorityViolations: [],
  provenanceViolations: [],
  readinessViolations: [],
  compatibilityViolations: []
}
```

Validation must check:

- required fields
- schema version
- source
- Decision Intelligence reference presence
- Review Package reference consistency when supplied
- local fingerprint bindings
- cross-artifact fingerprint bindings
- authority fields across every referenced artifact
- warning propagation
- review readiness state
- certification readiness state
- compatibility with Registry and Lifecycle registration

Validation must not recompute Signals, valuation, Deal Gate, BUY_NOW, production scoring, or production runtime behavior.

## Review Readiness Status

Review readiness answers whether the binding is suitable for Dalton review.

Supported statuses:

- `review_ready`
- `review_ready_with_warnings`
- `blocked_missing_evidence_bundle`
- `blocked_missing_decision_artifact`
- `blocked_invalid_pipeline`
- `blocked_authority_violation`
- `blocked_fingerprint_violation`
- `invalid`
- `unknown`

Review readiness should pass with warnings when optional Signals or optional Governance references are missing but required Decision Intelligence pipeline artifacts are valid.

## Certification Readiness Status

Certification readiness answers whether the binding is complete enough for future Governance certification.

Supported statuses:

- `certification_ready`
- `certification_ready_with_warnings`
- `blocked_missing_conformance`
- `blocked_missing_stability_baseline`
- `blocked_missing_required_signal`
- `blocked_pipeline_warnings`
- `blocked_invalid_provenance`
- `blocked_authority_violation`
- `blocked_fingerprint_violation`
- `not_certified`
- `invalid`
- `unknown`

Missing expected Signals should not block review readiness by default, but should block certification readiness when the certification profile marks them required.

## Warning Propagation

The binding must never suppress warnings.

It should preserve warning sources:

```js
{
  warningCount: 0,
  warningsBySource: {
    evidenceBundle: [],
    artifactConformance: [],
    pipelineReport: [],
    stabilityBaseline: [],
    signalGovernance: [],
    governanceValidation: []
  },
  blockingWarnings: [],
  nonBlockingWarnings: [],
  knownArchitecturalLimitations: []
}
```

Warning propagation rules:

- conformance warnings remain visible
- missing expected Signals remain visible
- unknown values remain visible
- evidence gaps remain visible
- stability baseline warnings remain visible
- Governance warnings remain visible
- no warning may be waived by the binding contract

Future waiver semantics, if ever introduced, must live in a separate explicit Governance approval artifact.

## Provenance

Provenance must include:

- binding builder name and version
- binding creation timestamp
- source Decision Intelligence artifact IDs
- source Decision Intelligence fingerprints
- source Governance artifact IDs
- source Governance fingerprints
- Review Package ID and fingerprint when supplied
- actor/tool metadata when available
- no production authority

Recommended shape:

```js
{
  sourceSystem: "decision_intelligence_governance_binding",
  builderName: "decision_intelligence_governance_binding_contract",
  builderVersion: "1.0.0",
  createdAt: "2026-07-30T00:00:00.000Z",
  inputArtifactIds: [],
  inputFingerprints: [],
  governanceArtifactIds: [],
  governanceFingerprints: [],
  reviewPackageId: "review-package-001",
  reviewPackageFingerprint: "sha256:..."
}
```

## Deterministic Fingerprint

`bindingFingerprint` must be computed from a stable projection of the full binding with `bindingFingerprint` removed.

The projection should include:

- identity fields
- all Decision Intelligence references
- all Governance references
- validation status
- readiness statuses
- propagated warnings
- provenance
- compatibility metadata
- authority fields
- audit history

The fingerprint must not include non-deterministic runtime data.

## Audit History

The binding may include deterministic audit history entries:

```js
{
  eventId: "binding-created",
  eventType: "created",
  occurredAt: "2026-07-30T00:00:00.000Z",
  actor: "offline_governance_tool",
  details: {},
  productionImpact: "none",
  decisionImpact: "none",
  executionAuthority: "none"
}
```

Audit entries are append-only through future immutable replacement artifacts. Existing binding artifacts must not be mutated.

## Registry Participation

The binding is suitable for Governance Artifact Registry participation.

Recommended registry registration:

```js
{
  artifactType: "decision_intelligence_pipeline_binding",
  artifactId: binding.bindingId,
  artifactSchemaVersion: binding.schemaVersion,
  artifactFingerprint: binding.bindingFingerprint,
  artifact: binding
}
```

The registry should treat duplicate IDs, duplicate fingerprints, and supersession exactly as it does for existing Governance artifacts. The binding contract does not require Registry schema changes.

## Lifecycle Participation

The binding is suitable for Governance Artifact Lifecycle Manager participation.

Supported lifecycle states should map to existing lifecycle events:

- registered
- active
- superseded
- archived

Supersession must be explicit:

- `supersedesBindingId`
- `supersedesBindingFingerprint`
- `supersededByBindingId`
- `supersededByBindingFingerprint`

Self-supersession and circular supersession must be invalid in future implementation.

## Review Session And Workspace Participation

The binding may be attached to a Review Session as a reviewer-safe reference. Workspace summaries should display:

- binding ID and fingerprint
- listing ID
- Review Package ID
- review readiness
- certification readiness
- Decision Intelligence artifact status
- conformance warnings
- missing Signals
- unknown values
- evidence gaps
- authority violations
- supersession state

Workspace presentation must not recompute Decision Intelligence evidence or grant authority.

## Compatibility Guarantees

The binding contract guarantees:

- no Governance schema changes
- no Decision Intelligence artifact changes
- no production runtime imports
- no engine execution
- no evidence recomputation
- deterministic ordering
- deterministic fingerprints
- immutable artifacts
- explicit unknowns
- explicit missing references
- visible warnings
- registry compatibility
- lifecycle compatibility
- review session compatibility
- workspace compatibility
- non-authoritative behavior

## Future Extension Rules

Future fields must be additive and namespaced.

Allowed future extensions:

- `policyProfile`
- `certificationProfile`
- `reviewerDisposition`
- `bindingSupersession`
- `workspacePresentation`
- `governancePipelineValidationReference`
- `deploymentEligibilityReference`

Future extensions must not:

- alter existing fingerprint semantics without a schema version change
- mutate bound Decision Intelligence artifacts
- mutate bound Governance artifacts
- suppress warnings
- infer missing evidence
- grant production authority
- grant purchase authority

## Authority Boundaries

Every binding artifact must preserve:

- `productionImpact: "none"`
- `decisionImpact: "none"`
- `executionAuthority: "none"`

The binding must never:

- approve a purchase
- authorize BUY_NOW
- override Deal Gate
- modify scoring
- modify valuation
- modify Signals
- modify Governance behavior
- send notifications
- write production persistence
- deploy code or configuration
- grant production authority

Production integration remains out of scope. Any future production use requires the full Governance chain and explicit Dalton approval.

## Recommended Next Implementation Phase

Phase 17.5B should implement the offline Decision Intelligence Governance Binding Builder.

That phase should create:

- `validation/decisionIntelligenceGovernanceBinding.js`
- `tests/decision-intelligence-governance-binding.test.js`
- implementation documentation

The builder should create, validate, summarize, compare, and fingerprint immutable binding artifacts while preserving all authority boundaries.
