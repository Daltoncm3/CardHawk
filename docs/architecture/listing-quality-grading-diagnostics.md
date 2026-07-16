# Listing Quality and Grading Diagnostics

Phase 10.6 adds a standalone listing-quality and grading diagnostic layer.

The diagnostic identifies listing and grading uncertainty that can create false positives, including weak image evidence, vague titles, lot risk, reprint/custom/proxy language, condition ambiguity, seller-risk context, suspiciously low prices, listing-history changes, raw-versus-graded conflicts, slab ambiguity, altered/authentic-only/qualified/trimming language, grade-premium support, and identity-to-grade consistency.

It does not change `qualityEngine`, `riskEngine`, `gradingEngine`, `gradePremiumEngine`, production scoring, production valuation, Deal Gate, `BUY_NOW`, notifications, marketplace behavior, scan timing, or `server.js`.

## Module

`validation/listingQualityGradingDiagnostics.js`

Public API:

- `evaluateListingQualityGrading(input)`
- `buildListingQualityGradingFingerprint(result)`
- `summarizeListingQualityGrading(result)`
- `LISTING_QUALITY_STATUS`
- `GRADING_DIAGNOSTIC_STATUS`
- `RISK_LEVEL`
- `REVIEW_ACTION`
- `LISTING_QUALITY_GRADING_DIAGNOSTIC_SCHEMA_VERSION`
- `LISTING_QUALITY_GRADING_DIAGNOSTIC_SOURCE`
- `UNKNOWN_VALUE`

## Listing-Quality Statuses

- `strong`: listing evidence, seller context, title clarity, and engine context are strong.
- `acceptable`: no high-risk listing-quality issue was detected.
- `caution`: review is recommended for image, title, condition, or history uncertainty.
- `high_risk`: listing-quality issues could materially distort interpretation.
- `blocked`: authenticity, proxy, reprint, replica, altered, or severe listing-risk language is present.
- `unavailable`: listing evidence needed for the diagnostic was not supplied.

## Grading Statuses

- `confirmed`: grading company, grade number, and grade-premium support are aligned.
- `likely`: grading company and grade number are present, but premium support remains less complete.
- `ambiguous`: raw/graded state, slab/certification, crossover, or label language requires review.
- `unsupported`: grading is not supported, commonly because the item appears raw.
- `high_risk`: altered, authentic-only, qualified, trimming, or similar grade-risk language is present.
- `unavailable`: grading evidence is missing.

## Core Rules

The diagnostic preserves unknown values as `unknown` and does not infer grading certainty from marketing language alone.

Image availability, title quality, seller history, price context, and listing-history context are diagnostic only. They do not create production penalties or blockers.

Grade-premium support is read from supplied data or the existing grade-premium engine. Active context alone does not make grade premium support confirmed.

Recommended review actions are offline guidance only. They do not alter production scoring, valuation, Deal Gate, `BUY_NOW`, notifications, or scan timing.

## Trace Integration

`validation/productionIntelligenceTrace.js` can record a supplied listing-quality and grading diagnostic result in `listingQualityGradingDiagnosticSummary`.

The trace does not compute the diagnostic. It only preserves an optional supplied summary with `changesProductionBehavior: false`.

## Fingerprint

The result includes a deterministic `stableFingerprint` generated from the diagnostic projection with the fingerprint field removed. Fingerprint equality proves deterministic equality of the diagnostic record; it does not prove listing authenticity, grading accuracy, or production approval.
