# Decision Intelligence Architecture Consolidation Audit

Phase 17.6A reviews the completed offline Decision Intelligence subsystem for consistency, duplication, dependency direction, and maintainability.

This audit is documentation-only. It does not change `server.js`, Deal Gate, BUY_NOW, Decision Engine logic, Signals, Governance implementations, persistence, configuration, or runtime behavior.

## Executive Summary

The Decision Intelligence subsystem is architecturally coherent and ready to remain as a stable offline advisory pipeline. It has a clear evidence flow:

```text
Decision Intelligence Evidence Bundle
-> Decision Intelligence Artifact Builder
-> Decision Intelligence Artifact Conformance
-> Decision Intelligence Pipeline Orchestrator
-> Decision Intelligence Pipeline Stability Baseline
-> Decision Intelligence Governance Binding Adapter
-> Decision Intelligence Governance Integration Validation
```

The strongest design choice is the separation between evidence organization, artifact construction, conformance validation, orchestration, certification, and Governance binding. No component grants authority to Decision Intelligence. Deal Gate and BUY_NOW remain untouched production boundaries, while Decision Intelligence produces immutable advisory evidence for review.

The subsystem does contain some repeated local helper logic across modules, especially normalization, issue construction, stage result construction, fingerprint projection, and authority-boundary checks. That duplication is real, but it is mostly low-risk and intentionally local. A broad refactor is not justified now because the contracts are young and every layer has slightly different schema and validation semantics.

The recommended Phase 18 roadmap should focus on Governance consumption and reviewer workflows, not runtime integration. The first implementation should be an offline Governance Review Package or Workspace adapter that displays Decision Intelligence binding and integration validation status without changing production behavior.

## Files Reviewed

### Architecture Documents

- `docs/architecture/decision-intelligence-architecture-audit.md`
- `docs/architecture/decision-intelligence-artifact-contract.md`
- `docs/architecture/decision-intelligence-artifact-builder.md`
- `docs/architecture/decision-intelligence-artifact-conformance.md`
- `docs/architecture/decision-intelligence-evidence-bundle.md`
- `docs/architecture/decision-intelligence-pipeline-orchestrator.md`
- `docs/architecture/decision-intelligence-pipeline-stability-baseline.md`
- `docs/architecture/decision-intelligence-governance-binding-readiness-audit.md`
- `docs/architecture/decision-intelligence-governance-binding-contract.md`
- `docs/architecture/decision-intelligence-governance-binding-adapter.md`
- `docs/architecture/decision-intelligence-governance-integration-validation.md`

### Validation Modules

- `validation/decisionIntelligenceEvidenceBundle.js`
- `validation/decisionIntelligenceArtifactBuilder.js`
- `validation/decisionIntelligenceArtifactConformance.js`
- `validation/decisionIntelligencePipelineOrchestrator.js`
- `validation/decisionIntelligencePipelineStabilityBaseline.js`
- `validation/decisionIntelligenceGovernanceBindingAdapter.js`
- `validation/decisionIntelligenceGovernanceIntegrationValidation.js`
- Supporting Governance modules used through public APIs:
  - `validation/governanceArtifactRegistry.js`
  - `validation/governanceArtifactLifecycleManager.js`
  - `validation/governanceReviewSessionManager.js`
  - `validation/governanceReviewWorkspaceOrchestrator.js`
  - `validation/governancePipelineEndToEndValidation.js`

### Tests

- `tests/decision-intelligence-evidence-bundle.test.js`
- `tests/decision-intelligence-artifact-builder.test.js`
- `tests/decision-intelligence-artifact-conformance.test.js`
- `tests/decision-intelligence-pipeline-orchestrator.test.js`
- `tests/decision-intelligence-pipeline-stability-baseline.test.js`
- `tests/decision-intelligence-governance-binding-adapter.test.js`
- `tests/decision-intelligence-governance-integration-validation.test.js`
- Existing Decision Intelligence benchmark tests:
  - `tests/decision-intelligence-engine.test.js`
  - `tests/decision-intelligence-validation.test.js`
  - `tests/decision-intelligence-report.test.js`

## Architecture Strengths

### Clear Authority Boundary

Every offline artifact preserves:

- `productionImpact: "none"`
- `decisionImpact: "none"`
- `executionAuthority: "none"`

This boundary is repeated at each layer and tested in builders, conformance, orchestration, baseline, binding, and integration validation. Decision Intelligence remains advisory. It does not alter production scoring, Deal Gate, BUY_NOW, Signals, Governance execution, scanner behavior, notification behavior, or persistence.

### Good Layer Separation

The component boundaries are clean:

| Layer | Responsibility | What it does not do |
| --- | --- | --- |
| Evidence Bundle | Collects and normalizes references to existing evidence. | Does not recompute evidence or recommend action. |
| Artifact Builder | Builds a single advisory Decision Intelligence artifact. | Does not grant purchase or production authority. |
| Artifact Conformance | Validates artifact schema, immutability, fingerprints, references, unknowns, gaps, explanations, and advisory-only behavior. | Does not repair artifacts. |
| Pipeline Orchestrator | Coordinates bundle, artifact, conformance, and report creation. | Does not modify evidence or runtime systems. |
| Stability Baseline | Certifies the offline pipeline state and known warnings. | Does not imply production approval. |
| Governance Binding Adapter | Binds Decision Intelligence outputs to Governance references and fingerprints. | Does not mutate Governance schemas or implementations. |
| Governance Integration Validation | Validates end-to-end offline compatibility with Registry and Lifecycle APIs. | Does not approve, deploy, or change production. |

### Dependency Direction Is Healthy

The dependency graph moves from lower-level contracts to higher-level orchestration:

```text
canonicalValidationCore / fingerprintProjection / phase8GovernanceCore
  -> decisionIntelligenceEvidenceBundle
  -> decisionIntelligenceArtifactBuilder
  -> decisionIntelligenceArtifactConformance
  -> decisionIntelligencePipelineOrchestrator
  -> decisionIntelligencePipelineStabilityBaseline
  -> decisionIntelligenceGovernanceBindingAdapter
  -> decisionIntelligenceGovernanceIntegrationValidation
```

The Governance integration layer depends on Governance public APIs rather than modifying Registry, Lifecycle, Session, or Workspace internals.

### Evidence Flow Is Explicit

The Evidence Bundle preserves listing, Canonical Identity, Signal, valuation, comparable-quality, evidence-readiness, production scoring, Deal Gate, BUY_NOW, Governance, missing-reference, evidence-gap, unknown-value, and provenance sections.

The Artifact Builder consumes the bundle's builder-ready projection, and the conformance layer can rebuild and compare artifacts deterministically when source input is supplied.

### Warnings Remain Visible

Warnings are intentionally propagated instead of suppressed. Current examples include explanation completeness warnings and baseline warnings. The Stability Baseline can certify with warnings, and the Governance Binding Adapter preserves separate review and certification readiness.

This is the correct behavior for an evidence-only subsystem. Warnings are review inputs, not failures to hide.

### Readiness Is Separated

Review readiness and certification readiness are not collapsed. A Decision Intelligence artifact can be suitable for manual review while certification remains blocked by missing baseline or validation evidence.

This separation protects the future workflow from converting partial review readiness into production approval readiness.

### Fingerprints and Provenance Are Strong

The modules consistently use deterministic fingerprint projections that exclude only the artifact's own fingerprint field. Major handoffs preserve:

- Evidence Bundle fingerprint
- Decision Intelligence Artifact fingerprint
- Artifact Conformance fingerprint
- Pipeline run fingerprint
- Pipeline report fingerprint
- Stability Baseline fingerprint
- Certification fingerprint
- Governance Binding fingerprint
- Governance Integration Validation fingerprint

Provenance also carries input fingerprints forward through binding and integration validation.

## Identified Duplication

### Local Utility Duplication

Most Decision Intelligence modules repeat small helpers:

- `deepFreeze`
- `known`
- `normalizeString`
- `normalizeDate`
- `normalizeBoolean`
- `normalizeStringArray`
- `validationIssue`
- reason-code collection
- fingerprint projection wrappers

This is meaningful duplication, but it is not currently dangerous. The helpers are simple and local, and each module has slightly different fallback semantics.

### Stage Result Construction

`decisionIntelligenceArtifactConformance.js`, `decisionIntelligencePipelineOrchestrator.js`, and `decisionIntelligenceGovernanceIntegrationValidation.js` each build stage-result objects with similar fields:

- stage name
- valid status
- errors
- warnings
- reason codes
- summary extras

This pattern is duplicated and could become noisy if Phase 18 adds many validators.

### Reference Normalization

`decisionIntelligenceEvidenceBundle.js`, `decisionIntelligenceArtifactBuilder.js`, and `decisionIntelligenceGovernanceBindingAdapter.js` each normalize source IDs and fingerprints in similar ways.

The duplication is understandable because each layer emits a different schema. It becomes a consolidation candidate only if additional Decision Intelligence adapters are introduced.

### Authority Enforcement

Authority-boundary checks are repeated across conformance, pipeline validation, baseline, binding, and integration validation.

This repetition is intentional defensive design. It should not be prematurely removed. If it is consolidated later, the shared helper must be fail-closed and must not weaken layer-local validation.

### Test Fixture Duplication

The Decision Intelligence tests repeat large representative pipeline inputs. This makes each test file self-contained, but it increases maintenance cost when the fixture shape evolves.

This is the highest-value consolidation candidate because it affects tests only and does not change runtime or artifact behavior.

## Dependency Analysis

### Healthy Dependencies

- Evidence Bundle depends on Artifact Builder only for expected Signal names and builder projection compatibility.
- Artifact Conformance depends on Artifact Builder for deterministic reconstruction and fingerprint checks.
- Pipeline Orchestrator depends on Bundle, Builder, and Conformance.
- Stability Baseline depends on the full offline pipeline and public validations.
- Governance Binding Adapter depends on Pipeline Orchestrator and Stability Baseline, not on Governance internals.
- Governance Integration Validation depends on public Registry and Lifecycle APIs.

### Watch Points

#### Evidence Bundle to Artifact Builder Dependency

`decisionIntelligenceEvidenceBundle.js` imports `EXPECTED_SIGNAL_NAMES` from the Artifact Builder. This is acceptable today because the bundle is designed to be builder-consumable. Long term, expected Signal coverage may deserve a tiny shared Decision Intelligence constants module if additional builders consume the same signal list.

#### Integration Validator Builds Missing Artifacts

The integration validator can build missing pipeline, baseline, certification, and binding artifacts. That is useful for tests and offline validation, but it should remain explicit that it builds offline artifacts only and never recomputes production evidence.

#### Governance Binding Adapter Does Not Register Directly

The binding adapter does not itself register artifacts. That is correct: registration belongs to Registry/Lifecycle consumers and integration validation. This keeps the adapter pure and immutable.

## Consolidation Opportunities

### 1. Shared Decision Intelligence Test Fixture Factory

Priority: medium.

Risk: low.

A test-only fixture helper could centralize the representative complete input used across:

- Evidence Bundle tests
- Artifact Builder tests
- Artifact Conformance tests
- Pipeline Orchestrator tests
- Stability Baseline tests
- Governance Binding Adapter tests
- Governance Integration Validation tests

Expected benefit:

- Less fixture drift.
- Easier future schema changes.
- Stronger cross-layer parity tests.

This is the safest consolidation candidate because it avoids runtime code and public API changes.

### 2. Shared Stage Result Helper

Priority: low.

Risk: medium.

A small validation helper could standardize stage result construction across conformance, pipeline, and integration validation. This should wait until Phase 18 needs another pipeline-style validator.

Expected benefit:

- Fewer shape inconsistencies.
- Easier report rendering.

Risk:

- Stage semantics differ subtly by layer.
- A shared helper could blur layer-specific warnings and reason codes.

### 3. Shared Reference/Fingerprint Extractor

Priority: low.

Risk: medium.

Several modules extract IDs and fingerprints from bundle, artifact, report, binding, and package-like objects. A shared extractor could reduce duplication after more Governance-bound Decision Intelligence artifacts exist.

Expected benefit:

- More consistent reference binding.
- Lower chance of forgetting a supported fingerprint field.

Risk:

- Over-generalization could silently accept ambiguous fields.
- Explicit layer-local reference semantics are currently easier to audit.

### 4. Shared Authority Boundary Validator

Priority: low.

Risk: medium.

A common `validateNoAuthority` helper could reduce repeated checks for `productionImpact`, `decisionImpact`, and `executionAuthority`.

Expected benefit:

- Consistent reason codes.
- Less repeated code.

Risk:

- Repetition currently acts as independent defense.
- Consolidation could weaken fail-closed behavior if the helper is used incorrectly.

## Recommended Refactors

No production or runtime refactor is recommended now.

The only near-term refactor worth considering is a **test-only Decision Intelligence fixture factory** in Phase 18 if fixture duplication begins slowing follow-up work. That refactor should not change artifact schemas, module public APIs, fingerprints, validation structures, or runtime behavior.

Do not consolidate production-facing or governance-facing validators yet. The subsystem is young, the contracts are still easy to read, and the current duplication is mostly a cost of explicitness.

## Risks

### Future Production Integration Risk

Decision Intelligence artifacts contain advisory recommendation language. If a future integration consumes that language directly, it could blur the line between advisory assessment and production authority.

Mitigation:

- Keep `productionImpact`, `decisionImpact`, and `executionAuthority` checks mandatory.
- Require Governance approval before any runtime consumer is added.
- Preserve Deal Gate as the production authority until explicitly replaced through Governance.

### Warning Fatigue

Warnings are correctly preserved, but repeated warnings such as explanation completeness issues can appear across conformance, pipeline, baseline, binding, and integration reports.

Mitigation:

- Future review UI should group duplicate warning reason codes by source and severity.
- Do not suppress warnings in the artifacts themselves.

### Artifact Layer Proliferation

The pipeline now has many artifacts. The layering is justified, but reviewers may need a summary view to avoid swimming through fingerprints.

Mitigation:

- Phase 18 should focus on review presentation and navigation.
- Workspace summaries should link artifacts by ID and fingerprint rather than embedding everything repeatedly.

### Fixture Drift

Large hand-built test inputs are repeated across test files. This can cause tests to diverge from one another as schemas evolve.

Mitigation:

- Add a test-only fixture builder when the next Decision Intelligence implementation phase touches tests.

### Registry Type Vocabulary

The Governance Registry can register the Decision Intelligence binding type, but it may classify it with a warning if the type is not part of the canonical registry vocabulary.

Mitigation:

- Preserve the warning until Governance chooses to extend the canonical type list.
- Do not suppress or remap the warning in Decision Intelligence integration validation.

## Components That Should Remain Unchanged

- `server.js` Deal Gate and BUY_NOW behavior.
- `engines/decisionEngine.js` production scoring and recommendation logic.
- Signal migration and shadow-comparison modules.
- Governance Registry, Lifecycle, Review Session, Workspace, and Pipeline implementations.
- Decision Intelligence artifact schemas and fingerprints.
- Governance Binding Adapter public API.
- Integration Validation public API.
- Existing warning propagation behavior.
- Separate review readiness and certification readiness fields.

## Missing Architectural Safeguards

The current subsystem has the necessary offline and advisory boundaries. Remaining safeguards are mostly workflow-level rather than module-level:

- A reviewer-facing summary should distinguish advisory recommendation from production approval.
- Governance artifacts should continue displaying warnings and unknown values without defaults.
- Any future runtime integration proposal should require a Production Proposal artifact, explicit Dalton approval, full validation, and post-deployment monitoring.
- Any future use of Decision Intelligence as a scoring input should begin in shadow mode and compare against current production decisions before any production proposal.

## Phase 18 Recommended Roadmap

### Phase 18.0A - Decision Intelligence Governance Workspace Architecture

Type: architecture-only and documentation-only.

Objective:

Design how Decision Intelligence Governance Binding and Integration Validation reports appear inside the offline Governance Review Workspace.

Why first:

- The subsystem is ready for Governance consumption.
- Reviewers need a clear summary before any production consideration.
- This preserves the non-authoritative boundary.

### Phase 18.0B - Decision Intelligence Governance Workspace Summary Adapter

Type: offline-only implementation.

Objective:

Create an adapter that converts Decision Intelligence Governance Binding and Integration Validation artifacts into workspace-ready summary sections.

Constraints:

- No runtime integration.
- No schema mutation of existing Governance implementations.
- No production authority.
- No recomputation of Signals, valuation, Deal Gate, or BUY_NOW.

### Phase 18.1A - Decision Intelligence Review Report Architecture

Type: architecture-only.

Objective:

Define a reviewer-facing report that groups:

- evidence coverage
- advisory recommendation
- confidence interpretation
- Deal Gate observation
- BUY_NOW observation
- warnings
- evidence gaps
- unknown values
- Governance binding status
- integration validation status

### Phase 18.1B - Decision Intelligence Review Report Builder

Type: offline-only implementation.

Objective:

Build immutable reviewer-facing reports from existing artifacts by reference and fingerprint.

### Phase 18.2A - Decision Intelligence Production Integration Readiness Audit

Type: audit-only.

Objective:

After enough reviewed artifacts exist, evaluate whether any future shadow or production integration is justified. This should not be implemented until the Governance review workflow is in place and real reviewed examples exist.

## Final Recommendation

Do not refactor the core Decision Intelligence runtime or Governance modules now.

Proceed to Phase 18 with offline Governance workspace consumption of Decision Intelligence artifacts. Keep Decision Intelligence advisory-only and continue requiring explicit Governance approval for any future production integration.
