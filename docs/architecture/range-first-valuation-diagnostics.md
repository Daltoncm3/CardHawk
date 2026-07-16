# Range-First Valuation Diagnostics

Phase 10.4 adds a standalone range-first valuation diagnostic layer.

The diagnostic evaluates whether a supplied production point estimate is supported by a supplied or locally evaluated valuation range, evidence readiness, comparable quality, true-sold depth, recency, source concentration, identity exactness, and outlier sensitivity.

It does not change `valuationRangeEngine`, `marketValueEngine`, production estimated value, ROI, Deal Gate, `BUY_NOW`, confidence thresholds, notifications, marketplace behavior, scan timing, or `server.js`.

## Module

`validation/rangeFirstValuationDiagnostics.js`

Public API:

- `evaluateRangeFirstValuation(input)`
- `buildRangeFirstValuationFingerprint(result)`
- `summarizeRangeFirstValuation(result)`
- `VALUATION_DIAGNOSTIC_STATUS`
- `UNCERTAINTY_LEVEL`
- `REVIEW_ACTION`
- `RANGE_FIRST_VALUATION_DIAGNOSTIC_SCHEMA_VERSION`
- `RANGE_FIRST_VALUATION_DIAGNOSTIC_SOURCE`
- `UNKNOWN_VALUE`

## Diagnostic Statuses

- `supported`: the point estimate is inside the supported range, evidence readiness is satisfied, and uncertainty is not high.
- `supported_with_wide_range`: the point estimate is inside the supported range, but range spread creates high uncertainty.
- `conditionally_supported`: minimum support exists, but review is required because of conditional evidence readiness or point/range disagreement.
- `weakly_supported`: point and range evidence exist, but true-sold support or uncertainty is too weak for confident interpretation.
- `withheld`: diagnostic blockers require withholding confident point-valuation interpretation.
- `unavailable`: point or range evidence needed for the diagnostic was not supplied or supportable.

## Uncertainty Levels

- `low`: supported range spread is at or below 20%.
- `moderate`: supported range spread is above 20% and at or below 45%.
- `high`: supported range spread is above 45% and at or below 80%, or support is thin.
- `extreme`: supported range spread is above 80%.
- `unknown`: range bounds are unavailable or insufficient to measure spread.

## Core Rules

The diagnostic never invents point estimates or range bounds. Missing values remain `unknown`.

Active listings and fallback values never satisfy true-sold support. They may be retained as excluded context through evidence readiness, but they cannot make a point valuation diagnostically supported.

The diagnostic may recommend withholding valuation interpretation or applying a confidence cap. Those recommendations are advisory only and do not alter production valuation, Deal Gate, `BUY_NOW`, ROI, or notifications.

## Trace Integration

`validation/productionIntelligenceTrace.js` can record a supplied range-first valuation diagnostic result in `rangeFirstValuationDiagnosticSummary`.

The trace does not compute the diagnostic. It only preserves an optional supplied summary with `changesProductionBehavior: false`.

## Fingerprint

The result includes a deterministic `stableFingerprint` generated from the diagnostic projection with the fingerprint field removed. Fingerprint equality proves deterministic equality of the diagnostic record; it does not prove valuation accuracy, source truth, or production approval.
