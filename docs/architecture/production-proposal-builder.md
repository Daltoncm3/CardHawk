# Production Proposal Builder

Phase 12.5C adds the offline-only Production Proposal Builder.

## Purpose

The builder converts validated governance artifacts into immutable Production Proposal Contract objects for Dalton review. It packages recommendations, offline experiment evidence, shadow experiment evidence, supporting references, risks, limitations, validation requirements, monitoring requirements, and rollback requirements.

The builder prepares proposals only. It does not approve, implement, deploy, activate, or authorize production changes.

## Public API

The module is `validation/productionProposalBuilder.js`.

Primary helpers:

- `buildProductionProposal(input, options)`
- `buildProductionProposalBatch(inputs, options)`
- `validateProductionProposalBatch(batch)`
- `summarizeProductionProposalBatch(batchOrProposals)`
- `buildSupportingEvidenceSummary(input)`
- `classifyProposalCategory(input)`
- `determineAffectedSubsystem(input)`
- `filterProductionProposals(proposals, criteria)`
- `sortProductionProposals(proposals)`
- `exportProductionProposalBatch(batch, outputPath)`
- `importProductionProposalBatch(input)`
- `buildProductionProposalBatchFingerprint(batch)`

## Proposal Generation Flow

1. Accept immutable source artifacts.
2. Validate recommendations through `calibrationRecommendationContract`.
3. Validate offline experiment specifications through `calibrationExperimentContract`.
4. Validate offline experiment result artifacts through `calibrationExperimentRunner`.
5. Validate shadow experiment specifications through `shadowExperimentContract`.
6. Validate shadow result artifacts through `shadowExperimentRunner`.
7. Build a deterministic supporting evidence summary.
8. Classify proposal category from explicit input or source recommendation category.
9. Determine affected subsystem from explicit input, recommendation, or shadow experiment.
10. Create the final proposal through `productionProposalContract`.
11. Build deterministic proposal batches and batch fingerprints.

The builder does not recompute production or shadow outputs.

## Evidence Requirements

Generated proposals preserve source artifact IDs and fingerprints. The builder requires at least:

- one calibration recommendation fingerprint
- one shadow result fingerprint

Offline experiment specifications and results are preserved when supplied. Missing evidence remains explicit. Incomplete proposals are represented as `evidence_incomplete`, and batch validation rejects them as missing required builder evidence.

Artifact existence alone does not imply successful validation, approval, implementation readiness, or deployment readiness.

## Proposal Categories

The builder delegates final category validation to `productionProposalContract`.

When a category is not supplied explicitly, recommendation categories map to proposal categories:

- identity parsing recommendations become `identity_parser_change`
- canonical identity recommendations become `canonical_identity_change`
- evidence sufficiency recommendations become `evidence_rule_change`
- valuation methodology recommendations become `valuation_methodology_change`
- confidence calibration recommendations become `confidence_calibration_change`
- risk recommendations become `risk_rule_change`
- grading or quality recommendations become `grading_quality_change`
- Deal Gate recommendations become `deal_gate_change`
- BUY_NOW recommendations become `buy_now_change`
- notification recommendations become `notification_change`
- diagnostic recommendations become `diagnostic_change`
- no-change recommendations become `no_change`

Unknown or unsupported source categories map to `other`.

## No-Change Behavior

The builder can create explicit `no_change` proposals when reviewed and shadow evidence supports maintaining current behavior. A no-change proposal is still an evidence artifact; it does not close future review, modify production behavior, or grant authority.

## Proposal Batches

A proposal batch contains:

- schema and source metadata
- proposal batch ID
- creation timestamp
- immutable proposal array
- proposal count
- category summary
- affected subsystem summary
- evidence summary
- risk summary
- proposal status summary
- `productionImpact: "none"`
- `decisionImpact: "none"`
- `executionAuthority: "none"`
- deterministic batch fingerprint

Batch validation returns structured errors, warnings, missing evidence, authority boundary violations, invalid proposal indexes, and fingerprint mismatches.

## Authority Boundaries

The builder must not:

- modify `server.js`
- integrate with scanner runtime
- change scoring or valuation
- change Deal Gate or BUY_NOW
- send notifications
- change persistence
- change thresholds, weights, rules, confidence, recommendations, configuration, deployment behavior, or production authority
- approve proposals
- implement proposals
- deploy proposals
- activate production changes

All generated proposals and batches preserve:

- `productionImpact: "none"`
- `decisionImpact: "none"`
- `executionAuthority: "none"`

## Immutability And Determinism

The builder never mutates source artifacts or generated proposals. Generated proposals and batches are deeply frozen. Identical inputs with explicit timestamps produce identical ordering and fingerprints.

## Future Approval Workflow Integration

Future approval workflow modules may consume builder output by proposal ID and fingerprint. Approval must still be attached through the Production Proposal Contract and must explicitly name Dalton as the human approver for implementation approval.

## Future Deployment Validation Integration

Future deployment validation modules may attach validation references to proposals after separate implementation and full validation phases. The builder itself does not validate deployment readiness and does not mark deployment successful.
