# Production Proposal Architecture

Phase 12.5A defines CardHawk's permanent Production Proposal architecture.

## Purpose

Production Proposals convert successful Shadow Experiment evidence into explicit, reviewable change packages for Dalton. They document what could change, why it might be valuable, what evidence supports it, what risks remain, and how the change would be validated and rolled back.

Production Proposals never apply themselves. They do not modify code, configuration, thresholds, weights, scoring, valuation, Deal Gate, BUY_NOW, notifications, scanner behavior, marketplace behavior, persistence, or production authority.

The required governance sequence remains:

```text
Production
-> Offline Review
-> Calibration Dataset
-> Recommendation
-> Offline Experiment
-> Shadow Experiment
-> Production Proposal
-> Explicit Dalton Approval
-> Code or Configuration Change
-> Full Validation
-> Deployment
-> Post-Deployment Monitoring
```

No Production Proposal may skip this sequence.

## Scope

Production Proposals are offline governance artifacts. They may reference production observations, review packages, calibration datasets, recommendations, offline experiment results, shadow experiment specifications, shadow result artifacts, approval artifacts, validation plans, rollback plans, and deployment prerequisites.

They may not execute production changes. They may only package evidence for a future Dalton decision.

## Goals

- Preserve a complete evidence chain from live production observations through shadow results.
- Make proposed production changes explicit before code or configuration work begins.
- Identify affected subsystems, rules, thresholds, weights, fields, or behaviors.
- Require documented benefits, risks, regressions, validation evidence, and rollback readiness.
- Prevent shadow success from becoming implicit production authority.
- Give Dalton one auditable artifact to approve, reject, expire, supersede, or send back for more evidence.

## Non-Goals

- No automatic production promotion.
- No code generation or configuration mutation.
- No Deal Gate, BUY_NOW, valuation, confidence, notification, scanner, persistence, or marketplace behavior changes.
- No replacement for full regression testing.
- No replacement for post-deployment monitoring.
- No authority for shadow systems, calibration datasets, recommendations, experiments, or proposal artifacts.
- No marketplace expansion or provider licensing decision.

## Inputs

A Production Proposal should require immutable input references:

- Shadow Experiment Contract artifact.
- Shadow Experiment Runner result artifact.
- Shadow approval artifact.
- Source Calibration Experiment Contract artifact.
- Source Calibration Experiment Runner result artifact.
- Source Calibration Recommendation artifact.
- Source Calibration Dataset references and fingerprints.
- Real Listing Decision Review package references when available.
- Dalton Review Workspace or calibration dataset lineage when available.
- Current production behavior reference.
- Proposed production behavior description.
- Validation evidence summary.
- Regression and limitation evidence.
- Rollback plan.
- Deployment prerequisite checklist.

All source fingerprints must be preserved. Missing evidence remains missing. Unknown values remain `unknown`.

## Lifecycle

1. `draft`: Proposal shell exists, but required evidence or scope is incomplete.
2. `blocked`: Required shadow result, supporting evidence, risk review, rollback plan, or validation plan is missing.
3. `ready_for_review`: Proposal has sufficient evidence for Dalton review.
4. `changes_requested`: Dalton or reviewer requires additional evidence or scope changes.
5. `approved_for_implementation_planning`: Dalton approves planning a code or configuration change. Production authority has not changed.
6. `implementation_ready`: A separate implementation plan, validation plan, rollback plan, and deployment plan are complete.
7. `approved_for_code_or_configuration_change`: Dalton approves a separate implementation step. The proposal still does not apply itself.
8. `implemented_pending_validation`: Code or configuration changes exist separately and await full validation.
9. `validated_for_deployment_review`: Full validation evidence supports deployment review.
10. `approved_for_deployment`: Dalton approves deployment of the separately implemented change.
11. `deployed_under_monitoring`: Deployment occurred through the normal release path and monitoring evidence is being collected.
12. `closed`: Proposal is complete and retained for audit.
13. `rejected`: Proposal will not advance.
14. `expired`: Proposal aged beyond its evidence-validity window.
15. `superseded`: A newer proposal replaces it.

These are governance states only. They do not grant runtime authority by themselves.

## Data Flow

Production systems generate real listing decisions. Offline review captures those decisions in immutable review packages. Dalton review records become calibration datasets. Calibration recommendations identify potential changes. Offline experiments test those recommendations against reviewed data. Shadow experiments observe the candidate behavior beside production behavior. Production Proposals package successful shadow evidence for explicit review.

The proposal artifact stores references and summaries, not mutable live state. Downstream implementation work must refer back to the proposal by ID and fingerprint.

## Immutable Artifacts

Production Proposal governance should preserve immutable artifacts for:

- Proposal specification.
- Supporting evidence bundle.
- Risk assessment.
- Approval artifacts.
- Implementation plan references.
- Validation evidence.
- Deployment validation artifact.
- Rollback verification artifact.
- Post-deployment monitoring artifact.
- Supersession or expiration record.

Attachments must return new artifacts with new fingerprints rather than mutating original proposal snapshots.

## Proposal Schema

A proposal artifact should contain:

- `schemaVersion`
- `proposalId`
- `proposalBatchId`
- `createdAt`
- `createdBy`
- `proposalTitle`
- `proposalCategory`
- `affectedSubsystem`
- `affectedRuleOrBehavior`
- `currentProductionBehavior`
- `proposedProductionBehavior`
- `sourceShadowExperimentIds`
- `sourceShadowExperimentFingerprints`
- `sourceShadowResultIds`
- `sourceShadowResultFingerprints`
- `sourceOfflineExperimentIds`
- `sourceOfflineExperimentFingerprints`
- `sourceRecommendationIds`
- `sourceRecommendationFingerprints`
- `sourceDatasetIds`
- `sourceDatasetFingerprints`
- `supportingEvidenceSummary`
- `shadowEvidenceSummary`
- `reviewEvidenceSummary`
- `expectedBenefit`
- `riskAssessment`
- `knownLimitations`
- `counterEvidence`
- `conflictSummary`
- `requiredApprovals`
- `approvalArtifacts`
- `validationChecklist`
- `requiredTestEvidence`
- `deploymentPrerequisites`
- `rollbackPlan`
- `monitoringPlan`
- `expirationPolicy`
- `supersessionReference`
- `auditHistory`
- `proposalStatus`
- `productionImpact: "none"`
- `decisionImpact: "none"`
- `authorityStatement`
- `proposalFingerprint`

`productionImpact` and `decisionImpact` must remain `none` until a separate approved implementation and deployment path changes production behavior.

## Supporting Evidence

Minimum supporting evidence should include:

- Completed shadow experiment result.
- Passing or acceptable success criteria.
- No blocking regression criteria.
- Explicit unresolved limitation list.
- Evidence that sample size and observation window requirements were met or explicitly waived.
- Evidence that production and shadow comparisons are explainable.
- Evidence that false-positive and missed-opportunity risks were reviewed.
- Evidence that affected listing segments were represented or documented as gaps.
- Current production behavior reference.
- Proposed behavior reference detailed enough for implementation planning.

No proposal may be supported only by unit tests, fixtures, architecture completeness, or offline results without shadow observation.

## Approval Artifacts

Production approval artifacts should contain:

- `approvalArtifactId`
- `proposalId`
- `proposalFingerprint`
- `approvedBy`
- `approvedAt`
- `approvalScope`
- `approvedChangeBoundary`
- `approvedImplementationWindow`
- `approvedValidationPlan`
- `approvedRollbackPlan`
- `requiredPostDeploymentMonitoring`
- `authorityStatement`
- `limitations`
- `productionImpact: "none"`
- `decisionImpact: "none"`
- `approvalArtifactFingerprint`

Approval artifacts approve a review state or a later implementation step. They do not directly alter production behavior.

## Risk Assessment Model

Risk assessment should evaluate:

- False-positive risk.
- Missed-opportunity risk.
- Valuation drift risk.
- Confidence calibration risk.
- Identity mismatch risk.
- Evidence sufficiency risk.
- Segment bias risk.
- Deal Gate regression risk.
- BUY_NOW regression risk.
- Notification regression risk.
- Runtime reliability risk.
- Rollback difficulty.
- Monitoring gaps.
- Operator review gaps.
- Unknown or stale evidence.

Each risk should include severity, likelihood, supporting evidence, mitigation, owner, and whether it blocks advancement.

## Rollback Requirements

Every proposal must define rollback before implementation begins:

- Exact feature flag or configuration rollback path when applicable.
- Code rollback plan when configuration rollback is unavailable.
- Expected rollback time.
- Data compatibility considerations.
- Monitoring signals that trigger rollback.
- Manual verification steps after rollback.
- Owner and approval path.

If rollback cannot be performed cleanly, the proposal remains blocked.

## Deployment Prerequisites

Deployment review requires:

- Explicit Dalton approval.
- Completed implementation plan.
- Full regression test evidence.
- Focused tests for affected subsystem behavior.
- Smoke test evidence.
- Shadow or replay comparison evidence when applicable.
- Rollback plan verification.
- Feature flag readiness when applicable.
- Production-boundary review.
- Monitoring plan and alert thresholds.
- No unresolved blocking conflicts.

The proposal cannot bypass the normal deployment workflow.

## Validation Checklist

Validation evidence should include:

- Contract validation for proposal artifacts.
- Fingerprint verification for all source artifacts.
- Full test suite result.
- Focused tests for affected subsystem outputs.
- Fixture replay comparison.
- Real-listing or shadow observation comparison.
- Regression checks for false positives and missed opportunities.
- Deal Gate output comparison when affected.
- BUY_NOW output comparison when affected.
- Notification eligibility comparison when affected.
- Persistence and restart compatibility when affected.
- Monitoring readiness check.

## Required Test Evidence

Required test evidence should be attached as immutable references:

- Test command.
- Execution timestamp.
- result status.
- affected file or subsystem coverage.
- failure summary when applicable.
- artifact link or log reference when available.
- validation fingerprint.

Test success does not grant authority by itself. It only supports approval review.

## Audit History

Audit history should record:

- Proposal creation.
- Evidence attachments.
- Review comments.
- Approval attachments.
- Status transitions.
- Expiration updates.
- Supersession updates.
- Implementation references.
- Validation references.
- Deployment references.
- Rollback or monitoring events.

Each event should include actor, timestamp, action, prior status, next status, reason, and fingerprint.

## Fingerprinting And Provenance

Production Proposals must use deterministic fingerprints that exclude their own fingerprint fields. Fingerprints should include proposal identity, source artifact fingerprints, proposed behavior, evidence summaries, risks, approvals, validation references, and lifecycle status.

Provenance must preserve the full source chain:

```text
Review Package
-> Dalton Review Workspace
-> Calibration Dataset
-> Calibration Recommendation
-> Offline Experiment
-> Offline Experiment Result
-> Shadow Experiment
-> Shadow Result
-> Production Proposal
```

Broken or mismatched fingerprints block advancement.

## Conflict Handling

Conflicts should be explicit and block advancement when material:

- Source artifact fingerprint mismatch.
- Shadow result does not match proposal scope.
- Proposed behavior differs from tested behavior.
- Regression evidence conflicts with success evidence.
- Approval scope is narrower than the proposed change.
- Expired evidence.
- Superseded recommendation or experiment.
- Missing rollback readiness.
- Incomplete validation evidence.
- Production boundary review failure.

The proposal should recommend either more evidence, scope reduction, rejection, or supersession.

## Expiration And Supersession

Production Proposals should expire when source evidence becomes stale, production behavior changes materially, shadow observation windows are too old, or provider/data assumptions no longer hold.

Supersession should preserve both artifacts:

- The older proposal moves to `superseded`.
- The newer proposal references the older proposal ID and fingerprint.
- The audit trail records why supersession occurred.

Expired or superseded proposals cannot be used for deployment approval without renewed evidence.

## Approval Boundaries

Production Proposal approval is not production execution. Approval may authorize implementation planning, implementation work, deployment review, or deployment through separate governed steps. Each step must be explicit.

A proposal must never:

- Apply code.
- Apply configuration.
- Change thresholds.
- Change weights.
- Change rules.
- Change scanner behavior.
- Change Deal Gate or BUY_NOW authority.
- Send notifications.
- Modify persisted production data.
- Grant shadow systems production authority.

## Future Module Boundaries

Future modules should include:

- `productionProposalContract`: immutable proposal schema, validation, cloning, fingerprinting, and status rules.
- `productionProposalBuilder`: constructs proposals from shadow result artifacts and supporting governance evidence.
- `productionProposalValidator`: verifies artifact chains, approval readiness, risk gates, expiration, supersession, and production-boundary checks.
- `productionProposalReport`: creates human-readable proposal summaries, comparison views, risk tables, and audit reports.
- `productionApprovalArtifact`: records Dalton's explicit approval scope, limits, and authority boundary.
- `deploymentValidationArtifact`: records validation, deployment readiness, rollback readiness, and post-deployment monitoring requirements.

These modules should remain offline until a separate approved integration phase.

## Future Roadmap

1. Implement the immutable Production Proposal Contract.
2. Implement a proposal builder that consumes Shadow Experiment Runner result artifacts.
3. Implement a proposal validator for artifact-chain integrity, risk gates, approval readiness, expiration, and supersession.
4. Implement a proposal report for Dalton review.
5. Implement approval and deployment validation artifacts.
6. Only after explicit approval, plan a separate code or configuration change phase.
7. Validate with focused tests, smoke tests, full regression, replay or shadow comparisons, and rollback checks.
8. Deploy through normal release workflow with post-deployment monitoring.

## Implementation Order

Recommended order:

1. `productionProposalContract`
2. `productionApprovalArtifact`
3. `deploymentValidationArtifact`
4. `productionProposalBuilder`
5. `productionProposalValidator`
6. `productionProposalReport`

The contract should come first so every later module uses one canonical schema and fingerprint model.

## Recommended Next Implementation Phase

Phase 12.5B should implement `productionProposalContract` as an immutable offline-only contract. It should define proposal creation, validation, cloning, approval/reference attachment, lifecycle status determination, deterministic fingerprinting, and authority-boundary validation.

Phase 12.5B should not build proposals automatically, validate deployment readiness, or integrate with production runtime.
