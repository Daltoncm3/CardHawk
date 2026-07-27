# Shadow Experiment Architecture

Phase 12.4A defines CardHawk's permanent shadow experiment architecture.

## Purpose

Shadow experiments validate successful offline Calibration Experiments against live production observations without changing production authority. They are the bridge between offline evidence and a future production proposal.

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
-> Code/Configuration Change
-> Deployment
```

No shadow experiment may skip this sequence.

## Scope

Shadow experiments may observe real production listings, production decisions, and shadow candidate outputs in parallel. They may compare what production did against what the proposed shadow behavior would have done.

Shadow experiments must remain evidence-only. They do not alter scanner behavior, scoring, valuation, Deal Gate, BUY_NOW, notifications, persistence, thresholds, weights, runtime configuration, or production recommendations.

## Goals

- Validate whether an offline experiment remains useful on live production traffic.
- Measure production versus shadow disagreement using real listings.
- Detect false positives, false negatives, missed opportunities, and regressions before production proposal.
- Preserve a complete audit trail from recommendation to offline experiment to shadow observation.
- Produce enough evidence for Dalton to decide whether a production proposal is worth drafting.

## Non-Goals

- No production scoring changes.
- No Deal Gate or BUY_NOW changes.
- No notification changes.
- No automatic threshold, weight, or configuration updates.
- No automatic promotion from shadow to production.
- No marketplace expansion.
- No replacement of offline calibration datasets.
- No hidden runtime authority for shadow systems.

## Inputs

A shadow experiment requires immutable inputs:

- Calibration Experiment Contract artifact.
- Calibration Experiment Runner result artifact.
- Source Calibration Recommendation artifact.
- Source Calibration Dataset references and fingerprints.
- Shadow experiment approval artifact.
- Proposed shadow behavior definition.
- Production comparison scope.
- Metric collection plan.
- Regression criteria.
- Rollback and disablement plan.

All inputs must preserve their original fingerprints. Missing evidence remains missing. Unknown values remain `unknown`.

## Lifecycle

1. `draft`: Shadow experiment shell exists but required evidence is incomplete.
2. `blocked`: Required input, approval, scope, rollback, or metric evidence is missing.
3. `approved_for_shadow_observation`: Dalton has approved observation-only execution.
4. `active_shadow_observation`: Shadow logic may observe and record evidence without authority.
5. `observation_complete`: Required observation window or sample size has completed.
6. `analysis_complete`: Metrics, regressions, conflicts, and limitations are summarized.
7. `ready_for_production_proposal_review`: Evidence may support drafting a proposal.
8. `rejected`: Shadow evidence does not support advancement.
9. `archived`: Experiment is closed and retained for audit.

These states are governance states only. They do not grant production authority.

## Replay Versus Live Shadow Boundaries

Offline replay operates on frozen calibration datasets and result artifacts. Live shadow execution observes current production traffic and compares shadow outputs beside production outcomes.

Replay may support initial confidence, but it is not enough for production proposal. Live shadow observation must collect fresh evidence because real production traffic can reveal parser drift, listing-quality edge cases, source behavior changes, and timing effects not present in reviewed datasets.

Live shadow execution must not write canonical sold evidence, mutate production decisions, or send notifications based on shadow outputs.

## Parallel Comparison Model

For each observed listing, the shadow experiment records:

- Production decision snapshot.
- Production valuation, confidence, Deal Gate, BUY_NOW, and notification eligibility.
- Shadow candidate output.
- Production versus shadow disagreement.
- Listing identity and diagnostic context.
- Evidence readiness and valuation diagnostic context when supplied.
- Any unsupported or missing input needed to interpret the shadow result.

Production remains authoritative. Shadow output is recorded only as comparison evidence.

## Metrics Collected

Minimum metrics should include:

- observed listing count
- reviewed listing count
- production decision distribution
- shadow decision distribution
- production/shadow agreement rate
- Deal Gate agreement
- BUY_NOW agreement
- notification agreement
- valuation disagreement
- confidence disagreement
- identity disagreement
- evidence sufficiency disagreement
- false-positive indicators
- false-negative or missed-opportunity indicators
- regression count
- unresolved conflict count
- blocked or unsupported listing count
- operator review backlog

Metrics must include denominator and missing-evidence counts so apparent improvements cannot hide missing data.

## Regression Detection

Regression detection must compare shadow outcomes against production and reviewed evidence. It should flag:

- higher false-positive risk
- higher missed-opportunity risk
- lower Deal Gate quality
- lower BUY_NOW quality
- degraded identity exactness
- weaker evidence readiness
- wider valuation uncertainty
- lower confidence calibration
- increased unsupported or unknown outputs
- unexpected behavior by listing category, grade, price range, or source

Regressions block promotion until explicitly reviewed.

## Success And Failure Thresholds

Success thresholds must be explicit before observation begins. They should define:

- minimum observation count
- minimum reviewed outcome count
- maximum false-positive rate
- maximum missed-opportunity rate
- minimum production/shadow explainability
- maximum unresolved disagreement rate
- required confidence calibration bounds
- required no-regression checks

Failure thresholds should trigger rejection or extended observation. Passing thresholds does not promote code; it only allows a future production proposal to be drafted.

## Statistical Confidence Requirements

Shadow experiments must define:

- minimum sample size
- minimum review coverage
- required segment coverage
- holdout expectations when applicable
- uncertainty reporting method
- required observation duration
- stale or incomplete evidence handling

Small samples may support continued observation, but they cannot support production proposal alone.

## Experiment Artifact Schema

A shadow experiment artifact should contain:

- `schemaVersion`
- `shadowExperimentId`
- `shadowExperimentBatchId`
- `createdAt`
- `createdBy`
- `sourceRecommendationIds`
- `sourceRecommendationFingerprints`
- `sourceOfflineExperimentIds`
- `sourceOfflineExperimentFingerprints`
- `sourceOfflineResultFingerprints`
- `targetSubsystem`
- `targetRuleOrBehavior`
- `currentProductionBehavior`
- `proposedShadowBehavior`
- `observationScope`
- `metricPlan`
- `successCriteria`
- `failureCriteria`
- `regressionCriteria`
- `statisticalRequirements`
- `approvalArtifact`
- `rollbackPlan`
- `experimentStatus`
- `productionImpact: "none"`
- `decisionImpact: "none"`
- `shadowExperimentFingerprint`

## Approval Artifact Schema

A shadow approval artifact should contain:

- `approvalArtifactId`
- `approvedBy`
- `approvedAt`
- `approvalScope`
- `approvedObservationWindow`
- `approvedMetricPlan`
- `approvedRollbackPlan`
- `authorityStatement`
- `limitations`
- `productionImpact: "none"`
- `decisionImpact: "none"`
- `approvalArtifactFingerprint`

Approval is limited to shadow observation. It is not approval for production behavior changes.

## Result Artifact Schema

A shadow result artifact should contain:

- `schemaVersion`
- `shadowResultId`
- `shadowExperimentId`
- `createdAt`
- `observationStartedAt`
- `observationCompletedAt`
- `observedListingCount`
- `reviewedListingCount`
- `productionMetrics`
- `shadowMetrics`
- `comparisonMetrics`
- `regressions`
- `improvements`
- `conflicts`
- `missingEvidence`
- `statisticalSummary`
- `successEvaluation`
- `failureEvaluation`
- `regressionEvaluation`
- `recommendedNextAction`
- `limitations`
- `productionImpact: "none"`
- `decisionImpact: "none"`
- `shadowResultFingerprint`

## Promotion Gates

A shadow experiment may advance to production proposal review only when:

- Required offline recommendation evidence exists.
- Offline experiment result evidence exists.
- Dalton approved the shadow observation scope.
- Live shadow metrics meet predeclared thresholds.
- No blocking regression remains unresolved.
- Rollback and feature-flag plans exist.
- Production-boundary review is complete.
- Audit fingerprints reconcile.

Advancement means proposal eligibility only. It does not change code or configuration.

## Rollback Requirements

Every shadow experiment must define:

- how shadow observation is disabled
- how partial observations are preserved
- how failed result artifacts are retained
- who can stop the experiment
- what conditions require immediate stop
- how production behavior is confirmed unchanged

Because shadow experiments have no production authority, rollback primarily means stopping observation and preserving evidence.

## Audit Trail

The audit chain should link:

- source review packages
- calibration datasets
- recommendation artifacts
- offline experiment artifacts
- offline result artifacts
- shadow approval artifacts
- shadow observation logs
- shadow result artifacts
- future production proposal artifacts

Every link should include IDs, fingerprints, timestamps, evaluator or approver identity, and evidence-only authority statements.

## Integrity And Fingerprinting

Every artifact must use deterministic fingerprint projections that exclude its own fingerprint field. Fingerprints must cover immutable evidence, scope, criteria, approvals, and result metrics.

The validator must reject:

- fingerprint drift
- production-impact drift
- decision-impact drift
- missing approval artifacts
- mismatched source recommendation IDs
- mismatched offline experiment IDs
- unknown schema versions
- mutation of immutable source artifacts

## Conflict Handling

Conflicts should remain explicit and block advancement until resolved. Examples:

- offline success but live shadow regression
- production safe but shadow aggressive
- shadow identifies more opportunities but increases false positives
- metrics improve overall but degrade in a key segment
- insufficient reviewed outcomes
- missing source artifact
- approval scope mismatch

Conflict resolution must be recorded as an artifact, not overwritten in place.

## Failure Recovery

If shadow observation fails, the framework should:

- preserve partial artifacts
- mark the run as incomplete or failed
- retain observed metrics and missing evidence
- record failure stage and reason code
- avoid inventing missing results
- require a new approval or resumed observation artifact before continuing

## Future Module Boundaries

Future implementation modules should include:

- `shadowExperimentContract`: immutable shadow experiment specification.
- `shadowApprovalArtifact`: approval artifact builder and validator.
- `shadowExperimentRunner`: live-shadow observation coordinator with no production authority.
- `shadowExperimentValidator`: integrity, scope, and result validation.
- `shadowExperimentReport`: operational and aggregate reporting.
- `productionProposalContract`: immutable proposal record created only after successful shadow review.

These modules should remain separate so contracts, execution, validation, reporting, and proposal governance do not blur authority boundaries.

## Data Flow

```text
Calibration Recommendation
  -> Offline Experiment Contract
  -> Offline Experiment Result
  -> Shadow Approval Artifact
  -> Shadow Experiment Contract
  -> Live Shadow Observation
  -> Shadow Result Artifact
  -> Shadow Experiment Report
  -> Production Proposal Contract
```

Production remains outside this flow except as a read-only source of decision snapshots.

## Future Roadmap

1. Implement `shadowExperimentContract`.
2. Implement `shadowApprovalArtifact`.
3. Implement `shadowExperimentValidator`.
4. Implement offline tests for artifact integrity, approval boundaries, and promotion blocking.
5. Implement `shadowExperimentRunner` as observation-only infrastructure.
6. Implement `shadowExperimentReport`.
7. Implement `productionProposalContract`.

## Recommended Next Implementation Phase

Phase 12.4B should implement `shadowExperimentContract` only.

It should create the immutable shadow experiment specification, validation rules, deterministic fingerprints, approval reference fields, and evidence-only authority boundaries. It should not run live shadow logic yet.
