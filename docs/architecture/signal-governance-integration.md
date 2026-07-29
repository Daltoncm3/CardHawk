# Signal Governance Integration

Phase 15.0A defines how CardHawk's completed Signal artifacts should feed governance, certification, manual review, and future production-readiness workflows.

This phase is architecture-only and documentation-only. It does not integrate Signals with production runtime, alter governance logic, modify existing migrations, or grant production authority.

## Executive Summary

The Phase 13 and Phase 14 Signal initiative is coverage-complete for the current architecture. Signal artifacts now explain identity, evidence, valuation, confidence, risk, Deal Gate, comparable quality, and decision context through immutable offline and shadow-only wrappers.

The next architectural need is not more Signal framework work. It is a governed integration path that lets Dalton review Signal evidence beside production and shadow outputs, then move reviewed evidence through the existing Phase 12 governance chain.

The permanent integration model should be:

```text
Production native outputs
-> Signal migrations and shadow comparisons
-> Signal Alignment Reports
-> Real Listing Decision Review packages
-> Dalton Review Workspaces
-> Calibration Datasets
-> Recommendations
-> Offline Experiments
-> Shadow Experiments
-> Production Proposals
-> Explicit Dalton Approval
-> Code or Configuration Change
-> Deployment Validation
```

Signals remain evidence. Governance decides whether evidence is complete enough to advance. Production runtime remains unchanged until a separate approved implementation and deployment path changes code or configuration.

## Governance Architecture

Signal-to-governance integration should introduce an offline evidence-binding layer between Signal reports and Phase 12 governance artifacts.

### Source Artifacts

The integration layer should accept immutable Signal artifacts only:

- Canonical Intelligence Signals
- Signal Alignments
- Signal Alignment Batches
- Signal Alignment Runs
- Signal Conflict Analyses
- Signal Alignment Reports
- Signal Migration Artifacts
- Signal Shadow Comparison Artifacts
- Signal Coverage Certification references

It should also accept the existing governance artifacts:

- Real Listing Decision Review packages
- Real Listing Review batches
- Dalton Review Workspaces
- Calibration Datasets
- Calibration Recommendations
- Offline Experiment specs and results
- Shadow Experiment specs and results
- Production Proposals
- Production Approval Artifacts
- Deployment Validation Artifacts
- Governance Pipeline Validator results

### Integration Responsibility

The integration layer should:

- bind Signal artifacts to review packages by ID and fingerprint
- summarize Signal coverage for a listing or review batch
- surface parity failures, missing definitions, blocked alignments, conflicts, and unknown values
- preserve all source artifacts without mutation
- provide structured governance inputs for review, calibration, recommendation, experiment, and proposal workflows
- enforce `productionImpact: "none"`, `decisionImpact: "none"`, and `executionAuthority: "none"` for Signal-derived evidence

The integration layer should not:

- execute Signal migrations
- execute production engines
- recompute valuation, confidence, identity, Deal Gate, BUY_NOW, or notification behavior
- resolve Signal conflicts
- rank or select winning Signals
- approve recommendations
- apply production changes
- modify scanner, persistence, marketplace, or runtime behavior

## Standard Governance Inputs From Signals

Every Signal evidence bundle should expose a deterministic input shape for governance consumers.

Recommended fields:

- `schemaVersion`
- `signalEvidenceBundleId`
- `createdAt`
- `listingId`
- `reviewPackageId`
- `reviewPackageFingerprint`
- `alignmentReportIds`
- `alignmentReportFingerprints`
- `migrationFingerprints`
- `shadowComparisonFingerprints`
- `coveredSignalFamilies`
- `missingSignalFamilies`
- `blockedSignalFamilies`
- `parityFailures`
- `registryFailures`
- `authorityViolations`
- `conflictSummary`
- `unknownValueSummary`
- `coverageSummary`
- `reviewFocus`
- `productionImpact: "none"`
- `decisionImpact: "none"`
- `executionAuthority: "none"`
- `signalEvidenceBundleFingerprint`

The bundle should reference source artifacts rather than copy large artifacts where practical. Any embedded summaries must be deterministic projections of immutable source artifacts.

## Signal Review Lifecycle

The review lifecycle should be deterministic and explicitly separated from runtime decisions:

```text
Signal artifacts available
-> Signal evidence bundle built
-> Bundle validated against expected coverage
-> Bundle attached to review package reference
-> Dalton reviews production, shadow, and Signal evidence
-> Human review record captures judgments
-> Workspace aggregates reviewed packages
-> Calibration dataset preserves reviewed Signal evidence references
-> Recommendations and experiments may cite Signal evidence
-> Production proposal may reference Signal evidence only after shadow validation
```

### Review Statuses

Signal evidence review should support statuses such as:

- `unreviewed`
- `review_ready`
- `reviewed`
- `needs_follow_up`
- `blocked_by_missing_signal`
- `blocked_by_parity_failure`
- `blocked_by_authority_violation`
- `invalid`

These statuses describe review readiness only. They do not alter production outcomes.

## Manual Review Workflow

Dalton's review workspace should present Signal evidence as structured context grouped by decision mission:

1. **Identity**

   Identity Parser and Listing Quality Signals should show parser confidence, ambiguity, missing fields, grade/slab risks, and identity blockers.

2. **Evidence**

   Evidence Readiness and Canonical Sold Evidence Signals should show sold evidence sufficiency, exact/contextual match quality, provenance, exclusions, stale evidence, and missing evidence.

3. **Valuation**

   Production Valuation, Range-First Valuation, Comparable Quality, Grade Premium, and Population Signals should show value support, uncertainty, comparable trust, grade premium support, and scarcity context.

4. **Risk and Confidence**

   False-Positive and Confidence Calibration Signals should show risk classifications, calibration gaps, overconfidence or underconfidence warnings, and unknown values.

5. **Decision**

   Deal Gate and Decision Context Signals should show production decision inputs, blockers, caution signals, conflicts, and explanation-only context.

The review UI or offline report should never hide parity failures. A mismatched wrapper should be visible before Dalton records a review decision.

### Human Review Fields Influenced By Signals

Signals should inform, but never autofill, fields such as:

- identity correct
- evidence sufficient
- valuation reasonable
- confidence appropriate
- would buy
- would notify
- production correct
- shadow better
- Deal Gate quality
- BUY_NOW quality
- reason categories
- disagreement categories
- review confidence
- notes

Future tooling may suggest review focus from Signal conflicts, but Dalton's review record remains human-entered evidence.

## Certification Workflow

Signal governance certification should operate at three levels.

### Listing-Level Certification

For one listing or review package:

- expected Signal families are present
- source fingerprints are bound
- reports validate
- shadow comparisons validate
- parity failures are absent or explicitly acknowledged
- authority boundaries remain intact
- unknown values are visible

### Batch-Level Certification

For a review batch or workspace:

- coverage rate by Signal family is reported
- missing Signal families are counted
- parity failures are grouped by family and reason code
- blocked alignments are grouped by registry or metadata cause
- conflict patterns are summarized
- review-readiness is determined for each listing

### Governance-Chain Certification

For recommendations, experiments, proposals, approvals, and deployment validation:

- Signal evidence references bind to reviewed packages or datasets
- recommendations cite reviewed evidence rather than raw unreviewed Signal output alone
- offline experiments use reviewed datasets
- shadow experiments preserve production-vs-shadow comparisons
- production proposals cite successful shadow results and supporting Signal evidence
- approvals and deployment validation remain separate authority gates

## Escalation Process

Signal issues should be routed by severity and scope.

### Parity Failure

Trigger:

- native output differs from canonical `rawOutput`
- shadow comparison detects changed evidence, confidence, status, metadata, or unknown values

Action:

- block review readiness for the affected Signal family
- preserve the mismatched artifacts
- open an offline investigation
- do not repair artifacts in place
- do not use the affected Signal as supporting evidence until resolved

### Missing Registry Definition

Trigger:

- Signal migration returns `definition_missing`
- alignment status is `definition_missing`

Action:

- classify as integration metadata gap
- block certification for that Signal family
- add or correct registry definition in a future offline phase
- preserve native output and migration artifact

### Version Mismatch

Trigger:

- native output version does not match the registered Signal definition

Action:

- block certification unless explicitly waived in a review artifact
- require adapter or registry update
- preserve both observed version and expected version

### Authority Violation

Trigger:

- any Signal-derived artifact exposes production impact, decision impact, or execution authority other than `none`

Action:

- mark artifact invalid
- block governance progression
- require contract or artifact fix before further review

### Evidence Gap

Trigger:

- expected Signal family missing for a review package
- unknown values block a required review question

Action:

- mark review focus as `needs_follow_up`
- allow Dalton review only with explicit missing-evidence acknowledgement
- prevent downstream production proposal support unless gap is resolved or explicitly accepted through governance

## Standard Review Report Format

A future `signalGovernanceReviewReport` should summarize Signal evidence for humans without changing source artifacts.

Recommended sections:

1. **Listing and Review References**

   IDs and fingerprints for listing, review package, review batch, workspace, and Signal reports.

2. **Coverage Summary**

   Expected, present, missing, blocked, and invalid Signal families.

3. **Parity Summary**

   Exact matches, semantic matches, mismatches, blocked comparisons, and reason-code counts.

4. **Conflict Summary**

   Agreement, contradiction, support, duplicate, independent, and unknown relationships.

5. **Mission-Area Evidence**

   Identity, evidence, valuation, risk, confidence, Deal Gate, BUY_NOW, notification, and decision context.

6. **Review Focus**

   Suggested areas Dalton should inspect based on missing evidence, conflicts, blockers, mismatches, or unknown values.

7. **Governance Readiness**

   Whether the package is ready for human review, dataset inclusion, recommendation analysis, offline experimentation, shadow experimentation, or proposal consideration.

8. **Authority Statement**

   A clear statement that the report is evidence-only and cannot change production behavior.

## Interfaces Between Signal Outputs And Governance Components

### Real Listing Decision Review Package

Additive future integration should attach Signal references under a namespaced section such as `signalEvidence`.

The review package should retain:

- production snapshot
- shadow snapshot
- disagreement snapshot
- Signal report references
- Signal coverage summary
- Signal review focus

It should not recompute production or shadow results.

### Dalton Review Workspace

The workspace should aggregate:

- Signal family coverage by package
- parity failures by family
- common conflict patterns
- review completion status
- unresolved Signal follow-ups

It should remain offline and review-focused.

### Calibration Dataset

Calibration datasets should preserve reviewed Signal evidence references for each record.

The dataset should not calibrate from raw Signal output alone. It should use Dalton-reviewed records and preserve source fingerprints.

### Calibration Recommendation

Recommendations may cite Signal-derived evidence only when it is bound to reviewed datasets.

Recommendations should preserve counterevidence, missing Signal families, and unresolved parity issues.

### Offline Experiment

Offline experiments may use reviewed Signal evidence to define comparison metrics or segment analyses.

They must not treat Signal confidence as production confidence unless explicitly modeled as an offline hypothesis.

### Shadow Experiment

Shadow experiments may observe proposed behavior against Signal-informed metrics.

They must not promote Signal outputs to production authority.

### Production Proposal

Production proposals may cite Signal evidence only as part of a complete governance chain:

- reviewed package
- calibration dataset
- recommendation
- offline experiment
- shadow experiment
- shadow result

Signal evidence alone is insufficient for a production proposal.

### Governance Pipeline Validator

Future validator integration should check:

- Signal evidence bundle presence
- Signal artifact fingerprints
- Signal report validity
- parity failure status
- authority boundaries
- missing expected Signal families
- whether Signal evidence is reviewed before downstream use

## Production Approval Gates

Signal evidence can support production approval only after passing through these gates:

1. Signal artifacts are valid and immutable.
2. Signal reports are bound to review packages.
3. Dalton review records are complete.
4. Calibration datasets preserve reviewed evidence.
5. Recommendations are generated offline and evidence-only.
6. Offline experiments validate proposed hypotheses.
7. Shadow experiments validate behavior beside production.
8. Production proposals package the change and evidence.
9. Dalton explicitly approves a code or configuration change.
10. Deployment validation confirms tests, rollback, monitoring, and prerequisites.

No Signal artifact can skip any gate.

## Runtime Boundary Definitions

The Signal-governance integration boundary is strict:

- no `server.js` integration
- no scanner integration
- no runtime Signal generation
- no production engine execution
- no valuation recomputation
- no Deal Gate or BUY_NOW changes
- no notification changes
- no persistence changes
- no marketplace changes
- no configuration changes
- no production authority

Future production integration, if approved, should be code or configuration work outside the Signal artifacts themselves.

## Future Implementation Roadmap

### Phase 15.0B - Signal Governance Evidence Bundle Contract

Create an immutable offline contract that binds Signal reports and shadow comparisons to review-package references.

Expected module:

- `validation/signalGovernanceEvidenceBundle.js`

### Phase 15.0C - Signal Governance Review Report

Create a deterministic human-review report that summarizes Signal evidence by mission area, parity status, conflicts, missing evidence, and review focus.

Expected module:

- `validation/signalGovernanceReviewReport.js`

### Phase 15.1A - Review Package Signal Evidence Binding

Design how Real Listing Decision Review packages can reference Signal evidence bundles without mutating existing snapshots or recomputing engine outputs.

### Phase 15.1B - Offline Workspace Signal Evidence Summary

Allow Dalton Review Workspaces to summarize Signal coverage, parity failures, and review focus across batches.

### Phase 15.2A - Governance Pipeline Signal Validation

Extend governance validation architecture so Signal evidence readiness becomes a checked prerequisite for downstream recommendations and proposals.

### Phase 15.3A - Signal-Informed Calibration Dataset Architecture

Define how reviewed Signal evidence references become calibration dataset metadata without performing calibration.

### Phase 15.4A - Production Proposal Signal Evidence Requirements

Define the minimum Signal evidence needed before a production proposal may cite identity, evidence, valuation, confidence, risk, or Deal Gate improvements.

## Remaining Open Questions

1. Which Signal families are mandatory for a review package versus optional context?
2. Should missing Listing Quality dedicated shadow comparison remain acceptable, or should uniform comparison coverage be required before proposal support?
3. What minimum review sample size should be required before Signal evidence can support calibration recommendations?
4. Should Signal evidence bundles embed complete Signal artifacts or store references plus deterministic summaries?
5. Which review questions should allow Signal-suggested focus without autofilling human judgments?
6. How should stale Signal artifacts expire when native engine versions change?
7. What Signal coverage threshold should block production proposal readiness?

## Explicit Non-Goals

- No production runtime integration.
- No execution of production engines.
- No recomputation of native outputs.
- No mutation of Signal artifacts or governance artifacts.
- No automatic conflict resolution.
- No production recommendations generated directly from Signals.
- No changes to scoring, valuation, Deal Gate, BUY_NOW, notifications, scanner, marketplace, persistence, or configuration.
- No deployment authority.
