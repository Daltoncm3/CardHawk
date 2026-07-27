# Calibration Recommendation Builder

Phase 12.2C adds the offline-only Calibration Recommendation Builder.

## Purpose

The builder converts one or more Phase 12.1C Calibration Datasets into deterministic Phase 12.2B Calibration Recommendation objects. It analyzes reviewed evidence, builds immutable findings, applies explicit evidence gates, and produces recommendation-only artifacts.

The builder does not calibrate CardHawk and does not change production behavior.

## Public API

The module is `validation/calibrationRecommendationBuilder.js`.

Primary helpers:

- `buildCalibrationRecommendationBatch(datasetInputs, options)`
- `buildRecommendationsFromDataset(dataset, options)`
- `buildCalibrationFindings(datasetInputs, options)`
- `evaluateRecommendationEvidence(finding, datasets, options)`
- `classifyRecommendationCategory(recordOrFinding)`
- `determineAffectedSubsystem(category)`
- `buildInsufficientEvidenceRecommendation(dataset, options)`
- `buildNoChangeRecommendation(dataset, options)`
- `validateCalibrationRecommendationBatch(batch)`
- `summarizeCalibrationRecommendationBatch(batch)`
- `filterCalibrationRecommendations(recommendationsOrBatch, filters)`
- `sortCalibrationRecommendations(recommendations)`
- `exportCalibrationRecommendationBatch(batch, outputPath)`
- `importCalibrationRecommendationBatch(input)`
- `buildCalibrationRecommendationBatchFingerprint(batch)`

## Finding Lifecycle

Findings are immutable intermediate artifacts. They preserve:

- finding identity
- finding category
- source dataset IDs
- source record fingerprints
- affected subsystem and rule or field
- observed behavior
- review outcome
- production and shadow agreement summaries
- sample size
- eligible sample size
- coverage
- class balance
- duplicate and correlated-record summaries
- review-confidence summary
- counterevidence
- limitations
- evidence strength
- evidence status
- finding fingerprint

Findings never recompute production outputs or shadow outputs.

## Recommendation Generation Rules

Every generated recommendation is created through `createCalibrationRecommendation` from `validation/calibrationRecommendationContract.js`.

The builder can generate recommendations for:

- identity parsing improvement
- canonical identity improvement
- evidence sufficiency adjustment
- valuation methodology adjustment
- confidence calibration adjustment
- risk rule adjustment
- grading or quality adjustment
- Deal Gate rule review
- BUY_NOW threshold review
- notification threshold review
- false-positive reduction
- missed-opportunity reduction
- diagnostic improvement
- insufficient-data finding
- no-change recommendation

Request aliases such as `grading_quality_adjustment`, `insufficient_data`, and `no_change` map to the canonical Phase 12.2B contract categories.

## Evidence Gates

The default gates are intentionally conservative:

- minimum reviewed records: 30
- minimum eligible records in the finding category: 10
- minimum average review confidence: 70
- maximum single-identity share: 60%
- maximum unknown-review-confidence share: 35%

Callers may provide explicit test or research gates through `options.evidenceGates`.

Evidence gates evaluate:

- total reviewed records
- eligible category records
- coverage across marketplaces, products, categories, grading companies, card types, and identities
- duplicate listings
- duplicate reviews
- repeated identities
- correlated records
- class balance
- review confidence
- incomplete evidence
- counterevidence
- conflicting subgroup results

## Insufficient-Evidence Behavior

When evidence is not adequate, the builder must not hide that fact. It emits recommendations whose `proposedBehavior.posture` is one of:

- `insufficient_evidence`
- `continue_observation`
- `manual_investigation_required`

These recommendations use `recommendationStatus: "evidence_insufficient"` and preserve the evidence limitations in risks and counterevidence.

## No-Change Behavior

If reviewed evidence supports current behavior and no meaningful disagreement category appears, the builder emits `no_change_recommendation`. This is still evidence-only and does not promote production behavior.

## Conflict Handling

The builder preserves conflicts instead of selecting a winner. Examples include:

- false-positive reduction versus missed-opportunity risk
- production agreement versus shadow agreement
- Deal Gate quality diverging from BUY_NOW quality
- strong aggregate signal with weak coverage
- repeated identities dominating the sample

Conflicts appear in finding limitations, recommendation risks, and counterevidence.

## Batch Schema

A recommendation batch contains:

- schema and source metadata
- recommendation batch ID
- creation timestamp
- source dataset IDs and fingerprints
- dataset count
- finding count
- recommendation count
- status, category, subsystem, and evidence-strength summaries
- insufficient-evidence count
- no-change count
- `productionImpact: "none"`
- `decisionImpact: "none"`
- findings
- recommendations
- deterministic batch fingerprint

## Evidence-Only Boundary

The builder must not:

- modify `server.js`
- integrate with scanner runtime
- change scoring, valuation, Deal Gate, BUY_NOW, notifications, or persistence
- change thresholds, weights, rules, confidence, or recommendations
- attach approvals automatically
- attach experiment references automatically
- create production proposals
- grant authority to datasets, recommendations, experiments, or shadow systems

## Future Integration

Future offline experiment phases may consume approved recommendations by fingerprint. Future shadow or production proposal phases must use separate approval and promotion contracts. Builder output alone never changes CardHawk behavior.
