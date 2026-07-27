# Calibration Experiment Contract

Phase 12.3B adds the immutable offline-only Calibration Experiment Contract.

## Purpose

The contract records a proposed calibration experiment specification. It is evidence-only and planning-only. It does not execute an experiment, modify production behavior, or grant authority to recommendations, datasets, experiments, or shadow systems.

## Public API

The module is `validation/calibrationExperimentContract.js`.

Primary helpers:

- `createCalibrationExperiment(input, options)`
- `validateCalibrationExperiment(experiment)`
- `cloneCalibrationExperiment(experiment)`
- `attachApprovalArtifact(experiment, approvalArtifact, options)`
- `attachExperimentResults(experiment, resultArtifact, options)`
- `determineExperimentStatus(experiment)`
- `buildCalibrationExperimentFingerprint(experiment)`
- `buildExperimentBatchFingerprint(batch)`

The module also exports schema, source, enum, and required-field constants.

## Schema

An experiment contains:

- schema and source metadata
- experiment and batch identifiers
- creation timestamp
- source recommendation IDs and fingerprints
- experiment type
- target subsystem and target rule
- baseline behavior
- proposed behavior
- replay dataset IDs
- holdout dataset IDs
- comparison metrics
- success criteria
- failure criteria
- regression criteria
- statistical requirements
- risks
- assumptions
- limitations
- rollback plan
- experiment status
- approval artifact
- result artifact
- offline authority flags
- `productionImpact: "none"`
- `decisionImpact: "none"`
- deterministic experiment fingerprint

## Lifecycle

Supported statuses:

- `draft`
- `approval_required`
- `approved_for_offline_run`
- `ready_for_offline_run`
- `offline_run_complete`
- `results_attached`
- `rejected`
- `archived`

The contract records lifecycle state only. It does not run experiments and does not change runtime behavior.

## Immutability

Created experiments are deeply frozen. Approval artifacts and result artifacts are attached by returning new experiment objects with new fingerprints. The original experiment remains unchanged.

Use `cloneCalibrationExperiment` when a caller needs a mutable copy for inspection or test setup.

## Approval Artifact

The approval artifact records whether Dalton or another explicit approver has approved the experiment for the stated offline scope. Approval is not production approval. The artifact keeps:

- required flag
- approved flag
- approver
- approved timestamp
- approval scope
- approval artifact ID
- approval artifact fingerprint
- notes
- `productionImpact: "none"`
- `decisionImpact: "none"`

## Result Artifact

The result artifact records externally supplied experiment results. The contract does not compute those results. The artifact keeps:

- availability
- result artifact ID
- completion timestamp
- result status
- summary
- metrics
- regressions
- counterevidence
- result artifact fingerprint
- `productionImpact: "none"`
- `decisionImpact: "none"`

## Evidence-Only Boundary

The contract must not:

- modify `server.js`
- integrate with scanner runtime
- change scoring, valuation, Deal Gate, BUY_NOW, notifications, persistence, or configuration
- change thresholds, weights, rules, confidence, or recommendations
- run an experiment
- attach production authority
- grant authority to recommendations, datasets, experiments, or shadow systems

## Validation

Validation returns:

- `valid`
- `errors`
- `warnings`
- `reasonCodes`
- `invalidFields`
- `missingRequiredFields`

Validation checks required fields, schema/source values, enums, array fields, authority boundaries, approval/result artifact boundaries, and deterministic fingerprints.

## Future Experiment Runner Integration

Future offline experiment runners may consume approved experiment specifications by fingerprint. They must return separate result artifacts and must not mutate experiment specifications in place. Any shadow or production use requires later governance phases and explicit Dalton approval.
