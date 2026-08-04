# Phase 18.2A - Decision Intelligence Shadow Integration Planning Audit

## 1. Executive Summary

Phase 18.2A audited the correct architectural insertion point for the Runtime-to-Canonical Signal Compatibility Adapter inside CardHawk's existing offline Decision Intelligence ecosystem.

Final determination:

**B. One additional offline integration layer is required before Decision Intelligence should consume canonical signals.**

The repository is already prepared for Decision Intelligence to consume signal evidence by reference. The Decision Intelligence Evidence Bundle and Artifact Builder both accept normalized `signalRefs`, preserve fingerprints, preserve missing signal references, and keep all output advisory-only. Governance Binding can also represent Decision Intelligence artifacts without schema changes. Review Workspace orchestration can already present Signal-aware package state through the namespaced `signalGovernance` package section.

However, the Runtime-to-Canonical Signal Compatibility Adapter does not produce Decision Intelligence `signalRefs` directly. It produces compatibility artifacts containing preserved runtime input, native-output preservation metadata, optional canonical candidates, mapping classifications, validation output, and compatibility fingerprints. Those artifacts are not the same contract as the `signalRefs` consumed by Decision Intelligence.

The correct insertion point is therefore an offline reference-projection layer placed immediately before `buildDecisionIntelligenceEvidenceBundle()`. That layer should consume validated Runtime-to-Canonical adapter and conformance artifacts, project them into Decision Intelligence-compatible Signal references, and preserve adapter/conformance artifacts as provenance or governance references. It must not run in production, must not run in Shadow Mode runtime, and must not alter Deal Gate, BUY_NOW, valuation, scoring, scanner behavior, persistence, alerts, or notifications.

No implementation is recommended in this audit. The next phase should specify the offline projection contract before any code is added.

## 2. Verified Files

This audit verified 45 repository files and artifacts relevant to the Decision Intelligence, Governance, Review Workspace, Shadow, Signal, and Runtime-to-Canonical compatibility boundaries.

### Phase 18 Runtime-to-Canonical Sources

1. `docs/phase-18.1A-runtime-signal-canonical-boundary-audit.md`
2. `docs/phase-18.1B-runtime-to-canonical-signal-compatibility-specification.md`
3. `docs/phase-18.1C-runtime-to-canonical-signal-adapter-contract.md`
4. `docs/runtime-canonical-signal-conformance-checklist.md`
5. `validation/fixtures/runtimeCanonicalSignalCompatibilityFixtures.json`
6. `validation/runtimeCanonicalSignalCompatibilityAdapter.js`
7. `validation/runtimeCanonicalSignalCompatibilityConformance.js`
8. `tests/runtimeCanonicalSignalCompatibilityAdapter.test.js`
9. `tests/runtimeCanonicalSignalCompatibilityConformance.test.js`

### Decision Intelligence Sources

10. `validation/decisionIntelligenceEvidenceBundle.js`
11. `validation/decisionIntelligenceArtifactBuilder.js`
12. `validation/decisionIntelligenceArtifactConformance.js`
13. `validation/decisionIntelligencePipelineOrchestrator.js`
14. `validation/decisionIntelligencePipelineStabilityBaseline.js`
15. `validation/decisionIntelligenceGovernanceBindingAdapter.js`
16. `validation/decisionIntelligenceGovernanceIntegrationValidation.js`
17. `docs/architecture/decision-intelligence-architecture-audit.md`
18. `docs/architecture/decision-intelligence-artifact-contract.md`
19. `docs/architecture/decision-intelligence-evidence-bundle.md`
20. `docs/architecture/decision-intelligence-artifact-builder.md`
21. `docs/architecture/decision-intelligence-artifact-conformance.md`
22. `docs/architecture/decision-intelligence-pipeline-orchestrator.md`
23. `docs/architecture/decision-intelligence-pipeline-stability-baseline.md`
24. `docs/architecture/decision-intelligence-governance-binding-readiness-audit.md`
25. `docs/architecture/decision-intelligence-governance-binding-contract.md`
26. `docs/architecture/decision-intelligence-governance-binding-adapter.md`
27. `docs/architecture/decision-intelligence-governance-integration-validation.md`

### Signal Framework And Shadow Sources

28. `validation/canonicalIntelligenceSignalContract.js`
29. `validation/intelligenceSignalRegistry.js`
30. `validation/signalProducerAdapter.js`
31. `validation/signalAlignmentContract.js`
32. `validation/signalAlignmentBatch.js`
33. `validation/signalAlignmentEngine.js`
34. `validation/signalConflictAnalyzer.js`
35. `validation/signalAlignmentReport.js`
36. `validation/signalAlignmentValidationSuite.js`
37. `validation/signalMigrationCore.js`
38. `validation/signalShadowComparisonCore.js`
39. `docs/architecture/signal-alignment-engine.md`
40. `docs/architecture/signal-alignment-report.md`
41. `docs/architecture/signal-governance-integration.md`

### Governance And Review Workspace Sources

42. `validation/governanceArtifactRegistry.js`
43. `validation/governanceArtifactLifecycleManager.js`
44. `validation/governanceReviewSessionManager.js`
45. `validation/governanceReviewWorkspaceOrchestrator.js`

Related Review Package and Workspace architecture consulted:

- `docs/architecture/review-package-signal-binding.md`
- `docs/architecture/offline-workspace-signal-evidence-summary.md`
- `docs/architecture/governance-pipeline-signal-validation.md`
- `docs/operations/review-workspace-export.md`

These related documents were used to verify review-readiness and certification-readiness semantics, but the verified file count above is limited to the primary files traced for producer-consumer behavior.

## 3. Current Decision Intelligence Runtime Map

Decision Intelligence is currently an offline subsystem. Its implemented pipeline is:

```text
caller-supplied evidence
-> buildDecisionIntelligenceEvidenceBundle()
-> validateDecisionIntelligenceEvidenceBundle()
-> buildDecisionIntelligenceArtifact()
-> validateDecisionIntelligenceArtifact()
-> validateDecisionIntelligenceArtifactConformance()
-> buildDecisionIntelligencePipelineReport()
-> validateDecisionIntelligencePipeline()
-> optional buildDecisionIntelligenceGovernanceBinding()
```

The key runtime map is:

```text
validation/decisionIntelligencePipelineOrchestrator.js
  imports decisionIntelligenceEvidenceBundle
  imports decisionIntelligenceArtifactBuilder
  imports decisionIntelligenceArtifactConformance
  does not import server.js
  does not import Deal Gate runtime
  does not import BUY_NOW runtime
  does not import runtimeCanonicalSignalCompatibilityAdapter
```

Decision Intelligence is currently fed by caller-supplied evidence. It does not execute production engines, signal migrations, shadow comparisons, or the Runtime-to-Canonical adapter.

### Evidence Bundle Consumer Shape

`validation/decisionIntelligenceEvidenceBundle.js` is the first implemented Decision Intelligence artifact in the pipeline. It accepts:

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

The bundle normalizes `signalRefs` through `normalizeSignalRef()`. That reference shape includes:

- `signalFamily`
- `signalName`
- `signalVersion`
- `signalId`
- `signalFingerprint`
- `alignmentId`
- `alignmentFingerprint`
- `migrationFingerprint`
- `shadowComparisonFingerprint`
- `reportFingerprint`
- `coverageStatus`
- `parityStatus`
- `authorityStatus`
- `sourceOutputFingerprint`
- `summary`
- `metadata`

This means Decision Intelligence currently expects Signal references, not full native outputs and not full canonical Signal artifacts.

### Artifact Builder Consumer Shape

`validation/decisionIntelligenceArtifactBuilder.js` receives the Evidence Bundle's `builderInput`. It again normalizes `signalRefs` and computes missing expected Signal gaps from `EXPECTED_SIGNAL_NAMES`.

The expected Signal names are:

```text
canonical.sold_evidence.diagnostics
comparable.quality.diagnostics
confidence.calibration.diagnostics
decision.context.diagnostics
decision.deal_gate.diagnostics
evidence.readiness.diagnostics
false_positive.risk.diagnostics
grade.premium.engine
identity.parser.diagnostics
listing.quality.grading.diagnostics
population.intelligence.engine
production.valuation.diagnostics
valuation.range_first.diagnostics
```

The builder does not require embedded canonical Signal objects. It requires stable names, fingerprints, coverage status, parity status, authority status, and provenance references.

### Pipeline Authority Boundary

The Decision Intelligence pipeline preserves:

```text
productionImpact: "none"
decisionImpact: "none"
executionAuthority: "none"
```

Decision Intelligence can produce advisory recommendations, but those recommendations do not authorize a purchase, do not modify Deal Gate, and do not modify BUY_NOW.

## 4. Canonical Signal Entry Candidates

Seven insertion candidates were evaluated.

### Candidate 1 - Direct Runtime Adapter Output Into Decision Intelligence Evidence Bundle

Description:

Pass `runtimeCanonicalSignalCompatibilityAdapter` outputs directly as `signalRefs`.

Finding:

Not selected.

Reason:

Adapter outputs are compatibility artifacts, not Decision Intelligence Signal references. They contain fields such as `adapterRunId`, `runtimeInput`, `nativeInputPreservation`, `canonicalSignal`, `mappingResult`, `warningPreservation`, and `compatibilityFingerprint`. The Evidence Bundle expects flattened reference fields such as `signalName`, `signalFingerprint`, `alignmentFingerprint`, `migrationFingerprint`, `shadowComparisonFingerprint`, and `reportFingerprint`.

Direct insertion would work only partially through permissive normalization and would lose explicit separation between compatibility-artifact fingerprint, canonical candidate fingerprint, and signal reference fingerprint.

Risk:

Medium. It could make Decision Intelligence appear to consume canonical signals while actually consuming adapter artifacts with mismatched semantics.

### Candidate 2 - Direct Canonical Candidate Into Decision Intelligence Artifact Builder

Description:

Bypass the Evidence Bundle and feed adapter-produced `canonicalSignal` values directly into `buildDecisionIntelligenceArtifact()`.

Finding:

Not selected.

Reason:

This would skip the Evidence Bundle's missing-reference, evidence-gap, unknown-value, and provenance handling. It would also bypass the bundle's purpose as the normalization boundary for Decision Intelligence.

Risk:

High. It would create a second Decision Intelligence ingestion path and weaken the existing bundle-first pipeline.

### Candidate 3 - Offline Reference Projection Before Decision Intelligence Evidence Bundle

Description:

Create a small offline layer that consumes validated Runtime-to-Canonical adapter/conformance outputs and projects them into Decision Intelligence-compatible `signalRefs`, with adapter and conformance artifacts preserved as metadata or `governanceRefs`.

Finding:

Selected.

Reason:

This uses the existing Decision Intelligence entry point without schema changes. It preserves the established pipeline:

```text
validated compatibility artifacts
-> Decision Intelligence-compatible Signal references
-> buildDecisionIntelligenceEvidenceBundle()
-> Decision Intelligence artifact
-> Decision Intelligence conformance
-> Governance Binding
```

This layer can preserve the adapter's `compatibilityFingerprint` separately from `canonicalSignal.signalFingerprint`, surface conformance readiness, preserve warnings and unknown values, and avoid runtime integration.

Risk:

Low if the layer is contract-first, offline-only, immutable, and non-authoritative.

### Candidate 4 - Insert Adapter Output Into Decision Intelligence Governance Binding

Description:

Attach Runtime-to-Canonical compatibility artifacts inside `buildDecisionIntelligenceGovernanceBinding()` as governance references.

Finding:

Not selected as the primary entry point.

Reason:

Governance Binding happens after the Decision Intelligence pipeline. It can reference compatibility artifacts, but it cannot help Decision Intelligence consume canonicalized Signal evidence before artifact construction.

Use:

Secondary. The selected reference-projection layer should preserve adapter and conformance artifacts as governance/provenance references so Governance Binding can carry them later.

### Candidate 5 - Insert Adapter Output Into Review Package `signalGovernance`

Description:

Bind compatibility artifacts directly into Review Packages under `signalGovernance`.

Finding:

Not selected as the primary entry point.

Reason:

Review Package `signalGovernance` is a review/certification presentation and binding section. It is not the Decision Intelligence evidence construction boundary.

Use:

Secondary. Once Decision Intelligence artifacts are built and bound, Review Packages may expose compatibility/conformance state through Signal governance evidence and review report references.

### Candidate 6 - Use Existing Signal Alignment Or Shadow Comparison Reports As The Entry Point

Description:

Treat `SignalAlignmentReport` or existing shadow comparison artifacts as the canonical entry into Decision Intelligence.

Finding:

Not selected as the only entry point.

Reason:

Signal Alignment and shadow comparison artifacts are useful source evidence and should be referenceable through `signalRefs`. They do not solve the specific Phase 18.1 adapter problem because Runtime-to-Canonical compatibility artifacts still need projection into Decision Intelligence's reference vocabulary.

Use:

Supported as source material for the selected reference-projection layer.

### Candidate 7 - Runtime Or Shadow Mode Runtime Integration

Description:

Wire the Runtime-to-Canonical adapter into production runtime or live Shadow Mode runtime.

Finding:

Rejected.

Reason:

All authoritative Phase 18.1 documents prohibit runtime integration. The adapter and conformance harness are offline-only. Decision Intelligence and Governance Binding are also offline and non-authoritative.

Risk:

High. Runtime integration would risk authority drift, scanner side effects, persistence changes, and confusion between Deal Gate authority and canonical advisory signals.

## 5. Governance Binding Compatibility Review

Governance Binding does not require schema changes for future compatibility integration.

`validation/decisionIntelligenceGovernanceBindingAdapter.js` binds Decision Intelligence evidence by reference and fingerprint. Its `decisionIntelligenceReferences` include:

- Evidence Bundle
- Decision Intelligence Artifact
- Artifact Conformance Report
- Pipeline Run
- Pipeline Report
- Stability Baseline
- Stability Certification

Its `governanceReferences` include:

- Signal Governance Evidence Bundle
- Signal Governance Review Report
- Governance Artifact Registry
- Lifecycle
- Review Session
- Workspace Review
- Governance Pipeline Validation

The binding already preserves:

- `validationStatus`
- `reviewReadiness`
- `certificationReadiness`
- `warningPropagation`
- provenance
- compatibility metadata
- audit history
- `productionImpact: "none"`
- `decisionImpact: "none"`
- `executionAuthority: "none"`

Compatibility conclusion:

Governance Binding can reference Runtime-to-Canonical adapter and conformance artifacts after Decision Intelligence evidence has been projected into the Evidence Bundle. It should not be the first ingestion point because it occurs after Decision Intelligence artifact construction.

No Governance Binding schema change is required.

## 6. Review Workspace Compatibility Review

Review Workspace orchestration is already signal-aware but intentionally reference-based.

`validation/governanceReviewWorkspaceOrchestrator.js` extracts `signalGovernance` from either:

```text
reference.packageSnapshot.signalGovernance
reference.signalGovernance
```

It then presents:

- package readiness
- certification readiness
- evidence bundle reference
- review report reference
- coverage summary
- conflicts
- unknown values
- provenance findings
- authority violations
- supersession state
- expiration state
- blocking and warning findings

Review Workspace does not recompute Signal evidence. It does not need native runtime signals and should not consume raw adapter output directly.

Compatibility conclusion:

Review Workspace should consume both native and canonical context only through bound immutable artifacts:

- native production/shadow snapshots remain in Review Package snapshots
- canonical Signal/compatibility evidence enters through Signal Governance or Decision Intelligence Governance Binding references

Review Workspace should not become the canonicalization layer.

## 7. Shadow Pipeline Compatibility Review

CardHawk has two relevant shadow concepts:

1. Existing offline Signal Alignment and shadow comparison artifacts.
2. Runtime Shadow Mode hooks for Decision Intelligence.

The Phase 13 and Phase 14 Signal framework already supports:

```text
native output
-> Signal migration
-> Canonical Signal
-> Signal Alignment
-> Alignment Batch
-> Alignment Run
-> Conflict Analysis
-> Signal Alignment Report
-> Shadow Comparison
```

`validation/signalAlignmentEngine.js` consumes native diagnostic outputs through `signalProducerAdapter`, creates alignment artifacts, and assembles batches/runs. `validation/signalAlignmentReport.js` summarizes alignment and conflict state for human review. Per-family shadow comparisons validate parity between native and canonical wrappers.

The Runtime-to-Canonical adapter is different. It bridges production runtime display signals and canonical Signal vocabulary. It is not an engine-family migration and should not bypass the existing Signal migration/shadow comparison framework.

Compatibility conclusion:

Shadow comparison artifacts are suitable source evidence for Decision Intelligence `signalRefs`, but they do not replace the need for a small reference-projection layer for Runtime-to-Canonical compatibility outputs.

The runtime Shadow Mode hook should remain out of scope. It must not execute the Runtime-to-Canonical adapter.

## 8. Runtime Dependency Diagram

### Current Offline Decision Intelligence Flow

```text
caller-supplied listing, identity, signal refs, valuation refs, observations
        |
        v
decisionIntelligenceEvidenceBundle
        |
        v
decisionIntelligenceArtifactBuilder
        |
        v
decisionIntelligenceArtifactConformance
        |
        v
decisionIntelligencePipelineOrchestrator
        |
        v
decisionIntelligencePipelineStabilityBaseline
        |
        v
decisionIntelligenceGovernanceBindingAdapter
        |
        v
Governance Registry / Lifecycle / Review Session / Workspace
```

### Current Runtime-to-Canonical Compatibility Flow

```text
already-produced runtime signal/display input
        |
        v
runtimeCanonicalSignalCompatibilityAdapter
        |
        v
runtimeCanonicalSignalCompatibilityConformance
        |
        v
offline conformance report
```

### Recommended Future Integration Flow

```text
already-produced runtime signal/display input
        |
        v
runtimeCanonicalSignalCompatibilityAdapter
        |
        v
runtimeCanonicalSignalCompatibilityConformance
        |
        v
Phase 18.2B/18.2C offline reference-projection layer
        |
        v
Decision Intelligence Evidence Bundle signalRefs + governanceRefs
        |
        v
Decision Intelligence pipeline
        |
        v
Decision Intelligence Governance Binding
        |
        v
Governance Review Session / Workspace
```

### Prohibited Flow

```text
server.js / scanner / production scoring
        |
        v
runtimeCanonicalSignalCompatibilityAdapter
        |
        v
canonical Signal authority or Decision Intelligence production authority
```

This flow remains prohibited.

## 9. Authority Boundary Verification

The audited files preserve the following authority boundaries:

1. Runtime-to-Canonical adapter output sets `productionImpact`, `decisionImpact`, and `executionAuthority` to `none`.
2. Runtime-to-Canonical conformance validates and blocks authority escalation, Deal Gate eligibility creation, BUY_NOW eligibility creation, notification eligibility creation, and production-approved labels.
3. Decision Intelligence Evidence Bundle validates Signal references as non-authoritative and rejects `authorityStatus` values other than `none` or `unknown`.
4. Decision Intelligence Artifact Builder sets `productionImpact`, `decisionImpact`, and `executionAuthority` to `none`.
5. Decision Intelligence Artifact Conformance validates advisory-only boundaries and runtime-integration violations.
6. Decision Intelligence Pipeline Orchestrator does not import runtime engines and keeps all pipeline outputs offline.
7. Decision Intelligence Governance Binding validates no Governance schema changes are required and preserves non-authoritative boundary fields.
8. Governance Review Session and Workspace managers expose review and certification readiness but do not approve production behavior.
9. Review Workspace presentation distinguishes review readiness from certification readiness.
10. No verified Phase 18.1 module imports `server.js`, scanner services, marketplace adapters, persistence modules, alert delivery, notification delivery, Deal Gate runtime, or BUY_NOW runtime.

No production authority violation was found.

## 10. Architectural Risks

### Risk 1 - Treating adapter output as a Signal reference

The adapter output is not a Decision Intelligence `signalRef`. Directly passing adapter output into the Evidence Bundle could lead to incomplete references, ambiguous fingerprints, or loss of distinction between `compatibilityFingerprint` and `signalFingerprint`.

Mitigation:

Add a dedicated offline projection contract that maps validated adapter/conformance artifacts into Decision Intelligence-compatible `signalRefs`.

### Risk 2 - Ambiguous canonical candidate status

Some Runtime-to-Canonical mappings are intentionally unmapped, one-way-only, incompatible, or rejected. These should not be represented as fully covered canonical Signals.

Mitigation:

The projection layer must map such cases to explicit coverage statuses, parity statuses, evidence gaps, missing references, or governance references rather than silently creating successful Signal coverage.

### Risk 3 - Warning propagation gaps

Runtime warnings, adapter warnings, conformance warnings, Signal warnings, Decision Intelligence warnings, and Governance Binding warnings live at different layers.

Mitigation:

The projection layer must preserve warning provenance and should not collapse warnings into a single string array without source fields.

### Risk 4 - Certification readiness confusion

Decision Intelligence can be review-ready with missing expected Signals. Certification readiness is stricter.

Mitigation:

Keep review readiness and certification readiness separate. Missing Runtime-to-Canonical compatibility outputs should block certification only when the future contract says the evidence is required.

### Risk 5 - Runtime Shadow Mode confusion

The term "shadow" appears in both offline shadow comparison and runtime Shadow Mode. The Runtime-to-Canonical adapter should use offline shadow validation only.

Mitigation:

Future phases must explicitly prohibit runtime Shadow Mode registration.

## 11. Recommended Integration Point

The recommended insertion point is:

```text
After Runtime-to-Canonical adapter conformance
Before buildDecisionIntelligenceEvidenceBundle()
```

The layer should be an offline Decision Intelligence Signal Reference Projection layer.

Responsibilities:

1. Accept validated Runtime-to-Canonical adapter outputs.
2. Accept Runtime-to-Canonical conformance records or reports.
3. Verify compatibility/conformance fingerprints.
4. Extract canonical Signal identity when a canonical candidate exists.
5. Preserve compatibility artifacts as source/provenance references.
6. Produce Decision Intelligence-compatible `signalRefs`.
7. Produce optional `governanceRefs` for adapter and conformance artifacts.
8. Preserve warnings, unknowns, unmapped fields, incompatible fields, and blocked mappings.
9. Set coverage and parity statuses deterministically.
10. Preserve `productionImpact: "none"`, `decisionImpact: "none"`, and `executionAuthority: "none"`.

Non-responsibilities:

1. Do not execute production engines.
2. Do not execute the Runtime-to-Canonical adapter automatically from runtime.
3. Do not recompute canonical Signals.
4. Do not repair incomplete mappings.
5. Do not promote canonical Signals into Deal Gate.
6. Do not alter BUY_NOW.
7. Do not modify Review Package schemas.
8. Do not change Governance Binding schemas.
9. Do not persist production data.

## 12. Alternative Integration Points Considered

### Alternative A - Existing Decision Intelligence architecture is already enough

Rejected as final determination.

The architecture is prepared for Signal references, but it is not prepared to consume raw adapter/conformance output without a projection step. The adapter output shape and the Decision Intelligence `signalRefs` shape are related but not identical.

### Alternative B - Insert canonical candidates directly into the Artifact Builder

Rejected.

This would bypass the Evidence Bundle and split the Decision Intelligence ingestion model.

### Alternative C - Extend Governance Binding to do the projection

Rejected as primary path.

Governance Binding is downstream from Decision Intelligence artifact construction. It can bind references but should not become the Signal ingestion layer.

### Alternative D - Extend Review Workspace to do the projection

Rejected.

Review Workspace is a presentation/orchestration layer. It should surface findings, not transform evidence.

### Alternative E - Use Signal Alignment Report as the only input

Rejected as complete solution.

Alignment reports are useful evidence, but Runtime-to-Canonical adapter/conformance artifacts still need translation into Decision Intelligence's reference shape.

### Alternative F - Runtime or live Shadow Mode integration

Rejected.

This violates Phase 18.1 authority boundaries and is not needed for offline Decision Intelligence review.

## 13. Required Future Phases

### Phase 18.2B - Decision Intelligence Canonical Signal Reference Projection Contract

Define the immutable offline contract for projecting validated Runtime-to-Canonical compatibility artifacts into Decision Intelligence-compatible `signalRefs` and `governanceRefs`.

The contract should define:

- accepted input artifact types
- required adapter/conformance validation state
- canonical candidate handling
- intentionally unmapped handling
- incompatible mapping handling
- rejected authority-escalation handling
- fingerprint binding
- warning propagation
- readiness propagation
- confidence provenance
- evidence gaps
- unknown values
- review readiness
- certification readiness
- authority boundaries

### Phase 18.2C - Decision Intelligence Canonical Signal Reference Projection Implementation

Implement the offline projection layer after the contract is approved.

The implementation should not modify:

- `server.js`
- scanner behavior
- runtime Shadow Mode
- production scoring
- valuation
- Deal Gate
- BUY_NOW
- notifications
- persistence
- existing Signal migrations
- existing Governance Binding schemas

### Phase 18.2D - Decision Intelligence Runtime-to-Canonical Governance Review Validation

Validate the end-to-end offline flow:

```text
Runtime-to-Canonical adapter output
-> conformance output
-> projected Decision Intelligence signalRefs
-> Evidence Bundle
-> Decision Intelligence artifact
-> Governance Binding
-> Review Workspace summary
```

This should remain offline and non-authoritative.

## 14. Final Determination

Selected determination:

**B. One additional offline integration layer is required before Decision Intelligence should consume canonical signals.**

Rationale:

The existing Decision Intelligence architecture is structurally ready to consume canonical Signal evidence by reference. It already preserves Signal names, fingerprints, alignment fingerprints, migration fingerprints, shadow comparison fingerprints, report fingerprints, coverage status, parity status, authority status, missing references, evidence gaps, unknown values, and provenance.

The existing Governance Binding architecture is also compatible. It can carry Decision Intelligence evidence and Governance references without schema changes.

The existing Review Workspace architecture is compatible. It can surface Signal governance state, readiness, warnings, unknowns, conflicts, supersession, expiration, and authority findings.

The missing piece is not a runtime integration and not a production architectural rewrite. The missing piece is a small, explicit, offline adapter-to-Decision-Intelligence reference projection layer. That layer should translate validated Runtime-to-Canonical compatibility artifacts into the reference shape that Decision Intelligence already expects.

No material architectural changes are required before integration planning continues. No runtime integration is recommended. No production integration is recommended.

Recommended next phase:

**Phase 18.2B - Decision Intelligence Canonical Signal Reference Projection Contract**

