# Calibration Recommendation Contract

Phase 12.2B adds the immutable offline contract for Calibration Recommendations.

## Purpose

The contract records possible calibration improvements as evidence-only recommendation artifacts. It is the bridge between Phase 12.1C Calibration Datasets and future recommendation builders, reports, experiments, and production proposal governance.

The contract does not perform calibration. It does not change production behavior.

## Public API

The module is `validation/calibrationRecommendationContract.js`.

Primary helpers:

- `createCalibrationRecommendation(input, options)`
- `validateCalibrationRecommendation(recommendation)`
- `cloneCalibrationRecommendation(recommendation)`
- `attachApprovalMetadata(recommendation, approvalMetadata, options)`
- `attachExperimentReference(recommendation, experimentReference, options)`
- `determineRecommendationStatus(recommendation)`
- `buildCalibrationRecommendationFingerprint(recommendation)`
- `buildRecommendationBatchFingerprint(batch)`

The module also exports schema, source, enum, and required-field constants.

## Schema

A recommendation contains:

- schema and source metadata
- recommendation and batch identifiers
- creation timestamp
- source dataset IDs and fingerprints
- recommendation category
- affected subsystem and rule or field
- finding
- evidence summary
- sample size
- coverage
- current behavior
- proposed behavior
- expected benefit
- identified risks
- recommendation confidence
- confidence level
- evidence strength
- counterevidence
- prerequisites
- validation plan
- rollback plan
- recommendation status
- reviewer approval metadata
- optional experiment references
- offline authority flags
- `productionImpact: "none"`
- `decisionImpact: "none"`
- deterministic recommendation fingerprint

## Lifecycle

The contract supports the Phase 12.2A lifecycle statuses:

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

The contract records status. It does not advance production authority.

## Immutability

Created recommendations are deeply frozen. Approval metadata and experiment references are attached by returning new recommendation objects with new fingerprints. The original recommendation remains unchanged.

Use `cloneCalibrationRecommendation` when a caller needs a mutable copy for local inspection or test setup.

## Evidence-Only Boundary

Recommendations must keep:

- `productionImpact: "none"`
- `decisionImpact: "none"`

They must not:

- change `server.js`
- run scanner code
- change scoring
- change valuation
- change Deal Gate
- change BUY_NOW
- change notifications
- change persistence
- alter thresholds, weights, confidence, or recommendations
- grant authority to calibration datasets, recommendations, experiments, or shadow systems

Approval metadata is approval to proceed within a stated governance scope. It is not a production change.

## Validation

Validation returns:

- `valid`
- `errors`
- `warnings`
- `reasonCodes`
- `invalidFields`
- `missingRequiredFields`

Validation checks required fields, schema/source values, enums, confidence range, evidence-only authority boundaries, experiment-reference boundaries, and deterministic fingerprints.

## Future Builder Integration

Future Phase 12.2C builder work should consume validated Calibration Datasets and produce recommendations through this contract. Builder modules should not duplicate this schema and should not call production engines.

Future experiment and production proposal modules should reference recommendation fingerprints rather than mutating recommendations in place.
