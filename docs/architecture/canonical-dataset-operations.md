# Canonical Dataset Operations and Coverage Reporting

Phase 8.5 adds offline dataset operations tooling for governed canonical sold-evidence growth, coverage measurement, and bias reporting.

The tooling is read-only. It does not write to the Canonical Sold Evidence Store and does not promote any dataset into production use.

## Module

```text
validation/canonicalDatasetOperations.js
```

The module reuses existing contracts:

- `utils/soldEvidenceStore.js`
- `services/soldEvidenceService.js`
- `validation/soldEvidenceDatasetBuilder.js`
- `validation/soldEvidenceDatasetPilot.js`
- `validation/soldEvidenceStoreConformance.js`
- `validation/canonicalValidationCore.js`

It does not define a parallel canonical sold-evidence record shape.

## Inputs

The module can load records from:

- arrays,
- wrapped dataset objects,
- store-shaped objects,
- dataset JSON files,
- canonical sold-evidence store JSON files.

## Evidence-Depth Classifications

These thresholds are governance/reporting thresholds only. They are isolated from production scoring, valuation, Deal Gate, and BUY_NOW behavior.

- `no_eligible_evidence`: 0 exact eligible verified sold records.
- `thin`: 1-2 exact eligible verified sold records.
- `developing`: 3-4 exact eligible verified sold records.
- `sufficient_for_shadow_review`: 5-9 exact eligible verified sold records.
- `deep`: 10 or more exact eligible verified sold records.

Shadow Valuation eligibility begins at 5 exact eligible verified sold records for an identity. This is a validation-readiness marker, not production readiness.

## Per-Identity Report

Each identity report includes:

- canonical identity key,
- normalized identity summary,
- total record count,
- exact eligible sold count,
- stale count,
- invalid or ineligible count,
- duplicate count,
- source distribution,
- adapter distribution,
- price range,
- recency range,
- review completeness,
- evidence-depth classification,
- Shadow Valuation eligibility,
- validation results,
- duplicate groups,
- blocking reasons,
- recommended next acquisition action,
- stable identity fingerprint.

## Aggregate Dataset Report

Aggregate reports include:

- total records,
- valid exact sold records,
- exact identity count,
- progress toward 100 exact canonical identities,
- progress toward 750 verified sold records,
- identities by evidence-depth classification,
- identities eligible for Shadow Valuation,
- source concentration,
- adapter distribution,
- category and grade balance,
- price-range distribution,
- currency distribution,
- recency distribution,
- review backlog,
- duplicate, invalid, stale, and ineligible counts,
- major coverage gaps,
- dataset bias warnings,
- recommended acquisition priorities,
- stable report fingerprint.

## Calibration Milestones

The strategic milestones are:

- 100 exact canonical identities,
- 750 verified sold records.

These are calibration milestones only. They do not imply production readiness, promotion, or authorization for production valuation.

## Production Boundaries

Phase 8.5 makes no changes to:

- `server.js`,
- Deal Gate,
- production valuation,
- BUY_NOW behavior,
- notifications,
- marketplace requests,
- scan timing,
- production sold-evidence writes.
