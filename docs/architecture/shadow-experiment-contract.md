# Shadow Experiment Contract

Phase 12.4B adds the immutable offline-only Shadow Experiment Contract.

## Purpose

The contract records a proposed shadow experiment specification. It is observation-only and evidence-only. It does not execute shadow logic, modify production behavior, or grant authority to shadow experiments.

## Public API

The module is `validation/shadowExperimentContract.js`.

Primary helpers:

- `createShadowExperiment(input, options)`
- `validateShadowExperiment(shadowExperiment)`
- `cloneShadowExperiment(shadowExperiment)`
- `attachApprovalArtifact(shadowExperiment, approvalArtifact, options)`
- `attachShadowResultsReference(shadowExperiment, shadowResultReference, options)`
- `determineShadowExperimentStatus(shadowExperiment)`
- `buildShadowExperimentFingerprint(shadowExperiment)`
- `buildShadowExperimentBatchFingerprint(batch)`

The module also exports schema, source, status, unknown-value, and required-field constants.

## Schema

A shadow experiment contains:

- schema and source metadata
- shadow experiment and batch identifiers
- creation timestamp
- source offline experiment IDs and fingerprints
- target subsystem
- observation scope
- production baseline reference
- shadow configuration reference
- observation metrics
- comparison metrics
- regression criteria
- success criteria
- statistical requirements
- monitoring requirements
- rollback plan
- shadow experiment status
- approval artifact
- shadow result reference
- offline authority flags
- `productionImpact: "none"`
- `decisionImpact: "none"`
- deterministic shadow experiment fingerprint

## Lifecycle

Supported statuses:

- `draft`
- `blocked`
- `approval_required`
- `approved_for_shadow_observation`
- `active_shadow_observation`
- `observation_complete`
- `analysis_complete`
- `ready_for_production_proposal_review`
- `rejected`
- `archived`

These are governance states only. They do not change runtime authority.

## Immutability

Created shadow experiments are deeply frozen. Approval artifacts and shadow result references are attached by returning new shadow experiment objects with new fingerprints. The original shadow experiment remains unchanged.

Use `cloneShadowExperiment` when a caller needs a mutable copy for inspection or test setup.

## Approval Artifact

The approval artifact records whether Dalton or another explicit approver has approved shadow observation for the stated scope. Approval is not production approval. The artifact keeps:

- required flag
- approved flag
- approver
- approved timestamp
- approval scope
- approved observation window
- approved metric plan
- approved rollback plan
- authority statement
- approval artifact ID
- approval artifact fingerprint
- limitations
- notes
- `productionImpact: "none"`
- `decisionImpact: "none"`

## Shadow Result Reference

The shadow result reference links a completed or partial result artifact to the immutable experiment specification. The contract does not compute results and does not run observation. The reference keeps:

- availability
- shadow result ID
- shadow experiment ID
- attachment timestamp
- result status
- result fingerprint
- summary
- `productionImpact: "none"`
- `decisionImpact: "none"`

## Observation-Only Boundary

The contract must not:

- modify `server.js`
- integrate with scanner runtime
- change scoring, valuation, Deal Gate, BUY_NOW, notifications, persistence, thresholds, weights, confidence, recommendations, or configuration
- execute a shadow experiment
- grant production authority
- grant authority to shadow experiments or result references

Shadow experiments are evidence only until future governance explicitly approves a separate production proposal.

## Validation

Validation returns:

- `valid`
- `errors`
- `warnings`
- `reasonCodes`
- `invalidFields`
- `missingRequiredFields`

Validation checks required fields, schema/source values, status enums, array fields, authority boundaries, approval/result boundaries, and deterministic fingerprints.

## Future Shadow Runner Integration

Future shadow runners may consume approved shadow experiment specifications by fingerprint. They must return separate immutable shadow result artifacts and must not mutate experiment specifications in place. Any production use requires later production proposal governance and explicit Dalton approval.
