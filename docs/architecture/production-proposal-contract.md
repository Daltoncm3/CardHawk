# Production Proposal Contract

Phase 12.5B adds the immutable offline-only Production Proposal Contract.

## Purpose

The contract records a proposed production change for Dalton's explicit review. It packages successful shadow evidence, supporting calibration evidence, risks, validation requirements, approval state, deployment prerequisites, rollback readiness, and audit history.

The contract does not execute, apply, deploy, activate, or authorize a production change.

## Public API

The module is `validation/productionProposalContract.js`.

Primary helpers:

- `createProductionProposal(input, options)`
- `validateProductionProposal(proposal)`
- `cloneProductionProposal(proposal)`
- `attachProductionApprovalArtifact(proposal, approvalArtifact, options)`
- `attachSupportingEvidenceReference(proposal, evidenceReference, options)`
- `attachDeploymentValidationReference(proposal, deploymentValidationReference, options)`
- `supersedeProductionProposal(proposal, supersession, options)`
- `expireProductionProposal(proposal, expiration, options)`
- `determineProductionProposalStatus(proposal)`
- `buildProductionProposalFingerprint(proposal)`
- `buildProductionProposalBatchFingerprint(batch)`

The module also exports schema, source, proposal category, lifecycle status, approval decision, confidence level, transition, unknown-value, and required-field constants.

## Proposal Schema

A production proposal contains:

- schema and source metadata
- proposal and batch identifiers
- creation and expiration timestamps
- supersession identifiers
- source recommendation IDs and fingerprints
- source offline experiment IDs and fingerprints
- source shadow experiment IDs and fingerprints
- source shadow result IDs and fingerprints
- affected subsystem and rule or field
- proposal category
- current and proposed behavior
- proposed code or configuration change description
- expected benefit
- supporting and counter evidence
- sample size and coverage
- confidence and confidence level
- identified risks, known limitations, and regression risks
- deployment prerequisites
- validation checklist
- required test evidence
- monitoring plan
- rollback plan
- approval requirements
- production approval artifact
- deployment validation reference
- supporting evidence references
- audit history
- proposal status
- authority flags
- `productionImpact: "none"`
- `decisionImpact: "none"`
- `executionAuthority: "none"`
- deterministic proposal fingerprint

Unknown values remain explicit. Missing values are not inferred from artifact existence.

## Proposal Categories

Supported categories:

- `identity_parser_change`
- `canonical_identity_change`
- `evidence_rule_change`
- `valuation_methodology_change`
- `confidence_calibration_change`
- `risk_rule_change`
- `grading_quality_change`
- `deal_gate_change`
- `buy_now_change`
- `notification_change`
- `diagnostic_change`
- `configuration_change`
- `code_change`
- `no_change`
- `other`

Unsupported categories fail validation.

## Lifecycle

Supported statuses:

- `drafted`
- `evidence_incomplete`
- `ready_for_review`
- `under_review`
- `rejected`
- `approved_for_implementation`
- `implementation_in_progress`
- `implemented_pending_validation`
- `validation_failed`
- `validated_for_deployment`
- `deployed_pending_monitoring`
- `monitoring_failed`
- `completed`
- `expired`
- `superseded`
- `archived`

Status values are governance states only. No status applies a change or grants production authority.

## Approval Boundary

Production implementation approval requires explicit metadata before a proposal may enter `approved_for_implementation` or a later implementation status.

Approval metadata contains:

- approval ID
- approved by
- approved timestamp
- approval decision
- approved proposal ID
- approved proposal fingerprint
- scope
- conditions
- notes
- approval fingerprint
- `productionImpact: "none"`
- `decisionImpact: "none"`
- `executionAuthority: "none"`

Dalton must be represented explicitly as the human approver for production implementation approval. Approval artifacts are never created automatically.

## Supporting Evidence Rules

Supporting evidence references may point to:

- calibration datasets
- calibration recommendations
- offline experiment specifications
- offline experiment results
- shadow experiment specifications
- shadow result artifacts
- review analytics
- regression reports
- validation artifacts

Referenced artifacts remain evidence only. Their existence does not imply successful validation, approval, implementation readiness, or production authority.

## Supersession And Expiration

Superseding or expiring a proposal returns a new immutable proposal object with an updated fingerprint and audit history. The original proposal remains unchanged.

Validation rejects:

- self-supersession
- invalid supersession chains
- superseded proposals without a successor ID
- expiration timestamps earlier than creation timestamps
- expired proposals without preserved expiration evidence

Superseded or expired proposals cannot become implementation-eligible without a new proposal.

## Audit History

Audit history records proposal creation, supporting evidence attachment, approval attachment, deployment validation attachment, expiration, supersession, and future governance events.

Each event preserves actor, timestamp, prior status, next status, reason, details, and no-authority boundary fields.

Audit-history ordering is deterministic.

## Immutability

Created proposals are deeply frozen. Attachment helpers return new immutable proposals with recomputed fingerprints. Source evidence, approval artifacts, references, and original proposals are not mutated.

Use `cloneProductionProposal` when a caller needs an independent mutable copy for inspection or test setup.

## Authority Boundaries

Every proposal preserves:

- `productionImpact: "none"`
- `decisionImpact: "none"`
- `executionAuthority: "none"`

The contract must not:

- write code
- write production configuration
- invoke deployment
- modify production state
- alter thresholds or weights
- modify Deal Gate or BUY_NOW
- send notifications
- mark deployment successful
- grant runtime authority
- auto-approve proposals

## Validation

Validation returns:

- `valid`
- `errors`
- `warnings`
- `reasonCodes`
- `invalidFields`
- `missingRequiredFields`
- `invalidSourceReferences`
- `invalidLifecycleTransitions`
- `approvalBoundaryViolations`
- `authorityBoundaryViolations`
- `expirationViolations`
- `supersessionViolations`
- `fingerprintMismatches`

## Future Proposal Builder Integration

Future proposal builders may consume Shadow Experiment Runner result artifacts, calibration evidence, and review analytics to draft proposal inputs. Builders must use this contract for final proposal creation and must not infer approval or deployment readiness.

## Future Deployment Validation Integration

Future deployment validation artifacts may be attached by reference after separate implementation and validation phases. Deployment validation references remain evidence-only until Dalton separately approves deployment through the governed release path.
