# Calibration Recommendation Architecture

Phase 12.2A defines the future architecture for converting reviewed Calibration Datasets into auditable recommendation-only calibration proposals. This is an architecture specification only. It does not create a calibration engine, does not modify runtime behavior, and does not grant production authority to reviews, datasets, analytics, or shadow systems.

## Purpose

CardHawk now has an offline review chain:

1. Real Listing Decision Review packages freeze production and shadow outputs.
2. Dalton Review Workspaces let Dalton complete structured reviews.
3. Calibration Datasets preserve completed reviews as immutable evidence.

The next architectural need is a governed recommendation layer that can identify possible improvements without applying them. The Calibration Recommendation system must keep a hard boundary between observed review evidence, measured findings, proposed changes, approved experiments, shadow validation, and explicit production promotion.

## Scope

The system may consume immutable Phase 12.1C Calibration Datasets and produce recommendation artifacts. It may summarize evidence, classify findings, draft proposals, and define validation plans.

The system must not:

- change `server.js`,
- run scanner code,
- change scoring,
- change valuation,
- change Deal Gate,
- change BUY_NOW,
- change notifications,
- change persistence,
- change thresholds, weights, rules, confidence, or recommendations,
- recompute production outputs,
- infer missing source facts,
- grant authority to human reviews, datasets, analytics, or shadow systems,
- write production configuration,
- automatically promote shadow behavior.

## Existing-System Context

The following existing modules define the input and authority boundaries:

- `validation/realListingDecisionReviewContract.js` freezes production and shadow outputs into immutable review packages. It defines `productionImpact: "none"` and `decisionImpact: "none"` as contract rules.
- `validation/realListingReviewBatchBuilder.js` selects real-listing review candidates from supplied snapshots and preserves candidate categories such as identity conflict, valuation conflict, possible false positive, possible missed opportunity, Deal Gate and BUY_NOW candidates, and learning opportunities.
- `validation/daltonReviewWorkspace.js` creates offline review workspaces, stores human review records separately from immutable snapshots, and exports completed reviewed batches.
- `validation/calibrationDatasetBuilder.js` converts completed workspaces into deterministic calibration datasets. It preserves production outputs, shadow outputs, Dalton reviews, disagreement summaries, and review metadata without recomputing fields.
- `validation/confidenceCalibration.js`, `validation/confidenceCalibrationDiagnostics.js`, `validation/realListingAccuracyValidation.js`, `validation/dealerAgreementScorer.js`, and `validation/investmentDecisionValidation.js` provide existing offline measurement patterns.
- `validation/productionIntelligenceTrace.js` documents how a production decision was reached and explicitly keeps diagnostics additive.
- `engines/decisionValidationEngine.js`, `engines/predictionAccuracyEngine.js`, and `utils/shadowModeLogger.js` preserve production and shadow observation data, but do not authorize automatic rule changes.
- `validation/shadowPromotionGovernance.js` already establishes that shadow-to-production promotion requires separate evidence, rollback readiness, release review, and production-boundary approval.
- Production Deal Gate and BUY_NOW ownership currently remain in `server.js`. Any future production change must go through explicit code or configuration change after approval.

## Terminology

- Calibration Dataset: Immutable reviewed evidence produced by Phase 12.1C.
- Calibration Finding: A measured pattern from reviewed evidence, such as overconfidence in a category or repeated identity disagreement. A finding is descriptive only.
- Recommendation: A versioned proposal that a subsystem, rule, threshold, explanation, diagnostic, or data requirement should be reviewed or experimented with.
- Experiment Specification: An immutable plan for testing current behavior against proposed behavior offline or in shadow mode.
- Approval Artifact: A signed or otherwise explicit operator record allowing a recommendation to move to the next lifecycle stage.
- Production Proposal: A separate artifact describing an explicit code or configuration change. A recommendation is not a production proposal by itself.

## Data Flow

```text
Calibration Dataset
  -> Calibration Finding
  -> Recommendation
  -> Dalton Review
  -> Offline Experiment
  -> Offline Validation
  -> Shadow Experiment
  -> Shadow Validation
  -> Production Change Proposal
  -> Dalton Approval
  -> Explicit Code or Configuration Change
  -> Full Test Suite
  -> Deployment
  -> Post-Deployment Validation
  -> Rollback Availability
```

No step may be skipped. No lifecycle state may change production behavior by itself.

## Recommendation Inputs

The recommendation system may consume only immutable dataset fields and previously generated offline metrics:

- `datasetId`, `datasetFingerprint`, `sourceWorkspaces`, and `sourceBatchIds`.
- `reviewCount`, `listingCount`, category breakdowns, confidence breakdowns, agreement metrics, disagreement metrics, and calibration candidates.
- Per-record listing identity, immutable production outputs, immutable shadow outputs, Dalton review, disagreement summary, review metadata, package fingerprint, snapshot fingerprint, review fingerprint, and record fingerprint.
- Existing offline metrics derived from these records, including confidence calibration metrics, identity accuracy metrics, evidence sufficiency findings, false-positive findings, missed-opportunity findings, Deal Gate review outcomes, BUY_NOW review outcomes, candidate categories, sample size, and coverage.

The system must never silently infer or recompute:

- production valuation,
- ROI,
- confidence,
- Deal Gate output,
- BUY_NOW eligibility,
- notification eligibility,
- shadow valuation,
- identity diagnostics,
- evidence readiness,
- listing quality or grading diagnostics,
- missing review outcomes,
- missing source facts,
- unreviewed Dalton judgments.

Unknown values must remain unknown. Missing data may create an `insufficient_evidence`, `continue_observation`, or `manual_investigation_required` finding.

## Recommendation Categories

Supported categories should be explicit and versioned:

- `identity_parsing_improvement`
- `canonical_identity_improvement`
- `evidence_sufficiency_adjustment`
- `valuation_methodology_adjustment`
- `confidence_calibration_adjustment`
- `risk_rule_adjustment`
- `grading_or_quality_adjustment`
- `deal_gate_rule_review`
- `buy_now_threshold_review`
- `notification_threshold_review`
- `false_positive_reduction`
- `missed_opportunity_reduction`
- `diagnostic_improvement`
- `insufficient_data_finding`
- `no_change_recommendation`

Each category describes possible work. It must not apply the work.

## Recommendation Schema

A permanent recommendation contract should be immutable, versioned, and fingerprinted:

```json
{
  "schemaVersion": "1.0.0",
  "source": "calibration_recommendation_contract",
  "recommendationId": "recommendation-id",
  "recommendationBatchId": "recommendation-batch-id",
  "createdAt": "2026-07-26T00:00:00.000Z",
  "sourceDatasetIds": [],
  "sourceDatasetFingerprints": [],
  "recommendationCategory": "confidence_calibration_adjustment",
  "affectedSubsystem": "confidence",
  "affectedRuleOrField": "market_confidence_interpretation",
  "finding": {},
  "evidenceSummary": {},
  "sampleSize": {},
  "coverage": {},
  "currentBehavior": {},
  "proposedBehavior": {},
  "expectedBenefit": {},
  "identifiedRisks": [],
  "confidence": 0,
  "confidenceLevel": "insufficient",
  "evidenceStrength": "insufficient",
  "counterEvidence": [],
  "prerequisites": [],
  "validationPlan": {},
  "rollbackPlan": {},
  "recommendationStatus": "drafted",
  "reviewerApproval": {
    "required": true,
    "approved": false,
    "reviewer": null,
    "approvedAt": null,
    "approvalArtifactFingerprint": null
  },
  "productionImpact": "none",
  "decisionImpact": "none",
  "recommendationFingerprint": "sha256"
}
```

Important schema rules:

- `productionImpact` must be `none`.
- `decisionImpact` must be `none`.
- `currentBehavior` must describe observed behavior from immutable inputs or documented production ownership, not recomputed output.
- `proposedBehavior` must be descriptive until an experiment or production proposal is separately approved.
- `confidence` is confidence in the recommendation, not production listing confidence.
- `evidenceStrength` must account for sample size, coverage, review consistency, and counterevidence.
- `recommendationFingerprint` must exclude itself from the projection.

## Evidence Rules

Recommendations should require conservative evidence gates.

Baseline dataset gates:

- Minimum total reviewed listings: 30 before any category-level proposal can become `candidate`.
- Minimum category-specific sample size: 10 reviewed records in the affected category.
- Minimum production-impacting category sample size: 25 reviewed records before any recommendation may become eligible for a production proposal.
- Minimum review confidence: median Dalton review confidence should be at least 70 for the affected slice, or the finding remains `continue_observation`.
- Duplicate listing and duplicate review fingerprints must be resolved before proposal-level recommendations.
- Sparse, incomplete, or tampered datasets must produce `insufficient_evidence`.

Coverage gates should track:

- player or subject coverage,
- product or set coverage,
- sport or category coverage,
- marketplace coverage,
- grading company coverage,
- raw versus graded coverage,
- card type and special attributes such as autograph, relic, parallel, numbered, lot, reprint, or proxy risk,
- price range coverage,
- recency coverage,
- exact identity repetition and correlated records.

Class imbalance rules:

- If one source, identity, player, product, or category dominates the sample, recommendations must include source-concentration warnings.
- A repeated identity may support an identity-specific recommendation, but not a global threshold recommendation.
- A category with fewer than the minimum records can only produce `insufficient_data_finding`, `continue_observation`, `no_change_recommended`, or `manual_investigation_required`.

Valid evidence-limited results:

- `insufficient_evidence`
- `continue_observation`
- `no_change_recommended`
- `manual_investigation_required`

## Recommendation Lifecycle

Supported statuses:

- `observed`
- `drafted`
- `evidence_insufficient`
- `candidate`
- `reviewed`
- `rejected`
- `approved_for_offline_experiment`
- `approved_for_shadow_experiment`
- `shadow_validated`
- `rejected_after_validation`
- `eligible_for_production_proposal`
- `production_proposal_approved`
- `archived`

Allowed transition model:

- `observed` -> `drafted`
- `drafted` -> `evidence_insufficient`
- `drafted` -> `candidate`
- `drafted` -> `rejected`
- `evidence_insufficient` -> `observed` after more reviewed evidence
- `candidate` -> `reviewed`
- `reviewed` -> `rejected`
- `reviewed` -> `approved_for_offline_experiment`
- `approved_for_offline_experiment` -> `approved_for_shadow_experiment` only after successful offline validation and Dalton approval
- `approved_for_shadow_experiment` -> `shadow_validated` only after a documented shadow observation period
- `shadow_validated` -> `eligible_for_production_proposal` only after production-boundary review, rollback readiness, and explicit Dalton approval
- `eligible_for_production_proposal` -> `production_proposal_approved` only through a separate production proposal process
- Any non-terminal status may move to `archived` with a reason
- Any experiment status may move to `rejected_after_validation` with failure evidence

No status changes production behavior.

## Approval Boundaries

Approvals required:

- Generating a recommendation: no Dalton approval required if the artifact is offline and evidence-only.
- Approving an offline experiment: Dalton approval required.
- Approving a shadow experiment: Dalton approval required, plus experiment specification, holdout plan, failure criteria, and rollback statement.
- Declaring shadow validation successful: Dalton approval required, plus shadow results, production comparison results, false-positive/missed-opportunity review, and documented counterevidence.
- Creating a production change proposal: Dalton approval required, plus production-boundary review and rollback readiness.
- Implementing a production change: explicit code or configuration change required, separate from recommendation artifacts.
- Activating a production change: Dalton approval required after full tests, deployment plan, monitoring plan, and rollback plan.

The architecture prohibits:

- silent threshold changes,
- automatic weight tuning,
- self-modifying scoring,
- automatic promotion from reviews,
- automatic promotion from shadow results,
- direct dataset-to-production configuration writes,
- direct recommendation-to-production configuration writes.

## Experiment Architecture

Future recommendations may be converted into isolated experiment specifications.

Common experiment fields:

- `schemaVersion`
- `experimentId`
- `recommendationId`
- `createdAt`
- `experimentType`
- `targetSubsystem`
- `baselineBehavior`
- `proposedBehavior`
- `testDataset`
- `holdoutDataset`
- `comparisonMetrics`
- `successCriteria`
- `failureCriteria`
- `regressionCriteria`
- `rollbackBehavior`
- `approvalArtifact`
- `experimentFingerprint`

Experiment types:

- Offline replay experiment: runs only against immutable datasets or exported review packages. It may compare existing outputs with simulated proposed outputs, but it cannot write production configuration.
- Shadow runtime experiment: observes the proposed behavior alongside production after separate approval. It cannot affect Deal Gate, BUY_NOW, notifications, valuation, or production confidence.
- Production proposal: a separate governed artifact describing an explicit code or configuration change. It is not an experiment and must be approved independently.

Experiment result artifacts should include:

- baseline metrics,
- proposed metrics,
- holdout metrics,
- regressions,
- unresolved counterevidence,
- false-positive impact,
- missed-opportunity impact,
- confidence calibration impact,
- affected subsystem summary,
- approval status,
- result fingerprint.

## Conflict and Safety Handling

Conflicts must be surfaced instead of silently resolved.

Examples:

- Reducing false positives increases missed opportunities.
- Confidence adjustment helps one category but harms another.
- Deal Gate agreement improves while BUY_NOW quality declines.
- Overall results differ from sport-specific results.
- Production agrees with Dalton while shadow disagrees.
- Shadow agrees with Dalton while evidence remains insufficient.
- A valuation proposal improves average agreement but worsens high-value listing outcomes.
- A notification threshold proposal improves precision but reduces recall.

Conflict handling requirements:

- Every conflicting signal must be listed as counterevidence.
- Tradeoffs must be explicit in `identifiedRisks`.
- Recommendations must define which metric is primary and which metrics are guardrails.
- A recommendation with unresolved material conflict cannot advance beyond `candidate` without Dalton review.
- A recommendation that worsens Deal Gate or BUY_NOW quality cannot advance to production proposal without explicit risk acceptance.

## Reporting Requirements

A human-readable Calibration Recommendation Report should include:

- executive summary,
- dataset coverage,
- dataset fingerprints and source workspace references,
- strongest findings,
- insufficient-evidence findings,
- no-change findings,
- proposed recommendations,
- recommendation categories and affected systems,
- sample sizes and coverage warnings,
- counterevidence,
- risks,
- approval requirements,
- validation requirements,
- rollback requirements,
- recommended next action,
- explicit statement that production behavior remains unchanged.

Reports should be deterministic for identical recommendation batches.

## Integrity Requirements

The architecture requires:

- deterministic fingerprints for recommendations, recommendation batches, experiment specifications, experiment results, approval artifacts, production proposals, and rejection records,
- immutable source dataset references,
- source dataset fingerprint validation,
- record-level provenance,
- schema versioning,
- recommendation batch fingerprints,
- approval artifact fingerprints,
- experiment artifact fingerprints,
- promotion artifact fingerprints,
- rejection reasons,
- audit history,
- duplicate dataset detection,
- duplicate recommendation detection,
- duplicate source-record detection,
- tamper detection for dataset, recommendation, approval, and experiment artifacts.

Fingerprint projections should reuse `validation/fingerprintProjection.js` and the stable canonical validation utilities. Recommendation contracts should follow the existing Phase 8 and Phase 12 pattern of cloning projections, removing the fingerprint field, and then building a deterministic fingerprint.

## Future Module Boundaries

Recommended future modules:

- `validation/calibrationRecommendationContract.js`: immutable recommendation and recommendation-batch schemas, enums, fingerprint helpers, and validation.
- `validation/calibrationRecommendationBuilder.js`: converts validated Calibration Datasets into findings and draft recommendations. It must not run production engines.
- `validation/calibrationRecommendationValidator.js`: validates evidence gates, lifecycle transitions, approvals, conflicts, and production-boundary fields.
- `validation/calibrationRecommendationReport.js`: creates deterministic human-readable reports from recommendation batches.
- `validation/calibrationExperimentContract.js`: defines immutable offline and shadow experiment specifications.
- `validation/calibrationOfflineExperimentRunner.js`: runs approved offline experiments against immutable datasets only.
- `validation/calibrationShadowExperimentAdapter.js`: future approved shadow-only adapter for runtime observation. It must not change production authority.
- `validation/calibrationApprovalArtifact.js`: captures Dalton approvals, reviewer metadata, approval scope, expiration, and fingerprints.
- `validation/calibrationProductionProposalBuilder.js`: creates production change proposals after successful validation. It must not implement or activate changes.

These modules should remain separate. The recommendation contract should not import production engines, and the builder should not own experiment execution.

## Production Promotion Boundary

The complete future path is:

1. Calibration Dataset
2. Calibration Finding
3. Recommendation
4. Dalton Review
5. Offline Experiment
6. Offline Validation
7. Shadow Experiment
8. Shadow Validation
9. Production Change Proposal
10. Dalton Approval
11. Explicit Code or Configuration Change
12. Full Test Suite
13. Deployment
14. Post-Deployment Validation
15. Rollback Availability

No recommendation or experiment artifact is production-authoritative. Production only changes through an explicit code or configuration change that is separately reviewed, tested, deployed, monitored, and rollback-ready.

## Implementation Roadmap

Recommended subphases:

1. Phase 12.2B - Calibration Recommendation Contract
   - Create immutable recommendation and recommendation-batch contracts.
   - Add lifecycle enums, category enums, approval placeholders, and fingerprint helpers.
   - Offline-only, no builder logic.

2. Phase 12.2C - Calibration Finding and Recommendation Builder
   - Consume validated Calibration Datasets.
   - Produce findings, insufficient-evidence outputs, and draft recommendations.
   - Enforce sample-size gates and unknown preservation.

3. Phase 12.2D - Calibration Recommendation Report
   - Generate deterministic human-readable reports.
   - Highlight evidence, counterevidence, risks, and next actions.

4. Phase 12.3A - Offline Experiment Specification
   - Define experiment contracts and approval artifacts.
   - Do not implement shadow runtime behavior.

5. Phase 12.3B - Offline Experiment Runner
   - Run isolated offline simulations against immutable datasets only.
   - Compare baseline and proposed behavior without changing production.

6. Future phase - Shadow Experiment Adapter
   - Only after Dalton approval and successful offline validation.
   - Shadow-only, no production authority.

7. Future phase - Production Proposal Builder
   - Only after shadow validation and separate production-boundary review.

## Explicit Non-Goals

Phase 12.2A does not:

- implement recommendation code,
- implement a calibration engine,
- run experiments,
- create production proposals,
- modify production thresholds,
- tune weights,
- change Deal Gate,
- change BUY_NOW,
- change notifications,
- change valuation,
- change scoring,
- change persistence,
- grant shadow authority,
- produce automated purchase decisions.

## Unresolved Architectural Questions

- What minimum sample size should Dalton require before a category-specific proposal can become production-proposal eligible? This document proposes conservative defaults, but Dalton may choose stricter thresholds.
- Should recommendations be grouped by global subsystem, by sport/category, by player/product, or by identity slice first? The architecture supports all, but early implementation should prefer conservative scoped recommendations.
- Should production configuration changes ever be represented as data artifacts, or should they remain code-only until a dedicated configuration governance phase?
- What is the required shadow observation period for each recommendation category?
- What review cadence should be used for archived or rejected recommendations when more evidence arrives?

## Final Recommendation

The next implementation phase should be Phase 12.2B - Calibration Recommendation Contract.

Start with the immutable contract rather than a builder. The contract is the safest next step because it establishes schema, statuses, evidence boundaries, approval fields, fingerprints, and production-impact protections before any code attempts to generate recommendations from datasets.
