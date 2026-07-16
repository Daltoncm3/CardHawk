# Confidence Calibration Diagnostics

Phase 10.5 adds a standalone offline confidence-calibration diagnostic layer.

The diagnostic evaluates whether reported confidence is supported by evidence quality, valuation uncertainty, identity diagnostics, comparable quality, true-sold depth, source concentration, and reviewed outcome metrics.

It does not change `confidenceEngine`, production confidence values, production confidence thresholds, Deal Gate, `BUY_NOW`, production valuation, notifications, marketplace behavior, scan timing, or `server.js`.

## Module

`validation/confidenceCalibrationDiagnostics.js`

Public API:

- `evaluateConfidenceCalibrationDiagnostic(input)`
- `buildConfidenceCalibrationDiagnosticFingerprint(result)`
- `summarizeConfidenceCalibrationDiagnostic(result)`
- `CALIBRATION_STATUS`
- `CONFIDENCE_SUPPORT_LEVEL`
- `REVIEW_ACTION`
- `CONFIDENCE_CALIBRATION_DIAGNOSTIC_SCHEMA_VERSION`
- `CONFIDENCE_CALIBRATION_DIAGNOSTIC_SOURCE`
- `MINIMUM_CALIBRATION_SAMPLE_SIZE`
- `UNKNOWN_VALUE`

## Calibration Statuses

- `calibrated`: reported confidence is supported by evidence and reviewed outcomes.
- `provisionally_calibrated`: reviewed outcomes are directionally aligned, but continued monitoring is required.
- `under_review`: confidence exists, but reviewed outcomes or support evidence are not sufficient for calibration.
- `overconfident`: reported confidence is high relative to observed agreement, false-positive rate, or evidence support.
- `underconfident`: reported confidence is low relative to observed agreement or missed-opportunity evidence.
- `insufficient_sample`: reviewed outcomes exist, but the sample is below the documented minimum.
- `unavailable`: reported confidence or reviewed outcome evidence is missing.

## Support Levels

- `strong`
- `adequate`
- `limited`
- `weak`
- `unsupported`
- `unknown`

Support levels are diagnostic only. They do not create, modify, or cap production confidence.

## Core Rules

The diagnostic never invents dealer reviews, operator outcomes, sample sizes, confidence values, false-positive rates, or missed-opportunity rates.

Missing outcomes remain missing. A high production confidence value without reviewed outcomes is classified for offline review, not production action.

Active listings and fallback values cannot establish true-sold confidence support. The diagnostic relies on supplied evidence readiness and range-first valuation diagnostics when available.

Recommended confidence caps are advisory offline diagnostics only. They do not alter production confidence thresholds, Deal Gate, `BUY_NOW`, valuation, notifications, or scan timing.

## Trace Integration

`validation/productionIntelligenceTrace.js` can record a supplied confidence calibration diagnostic result in `confidenceCalibrationDiagnosticSummary`.

The trace does not compute calibration diagnostics. It only preserves an optional supplied summary with `changesProductionBehavior: false`.

## Fingerprint

The result includes a deterministic `stableFingerprint` generated from the diagnostic projection with the fingerprint field removed. Fingerprint equality proves deterministic equality of the diagnostic record; it does not prove confidence correctness, operator truth, or production approval.
