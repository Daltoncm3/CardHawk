# Opportunity False-Positive Diagnostics

Phase 10.7 adds a standalone false-positive reduction diagnostic layer.

The diagnostic combines supplied identity, evidence readiness, range-first valuation, confidence calibration, listing-quality/grading, ROI, risk, Deal Gate, `BUY_NOW`, and price-context outputs to identify weak or unsafe opportunities that may look attractive in production.

It does not change production scoring, Deal Gate rules, `BUY_NOW`, valuation, ROI calculations, confidence thresholds, notifications, marketplace behavior, scan timing, or `server.js`.

## Module

`validation/opportunityFalsePositiveDiagnostics.js`

Public API:

- `evaluateOpportunityFalsePositiveRisk(input)`
- `buildOpportunityFalsePositiveFingerprint(result)`
- `summarizeOpportunityFalsePositiveRisk(result)`
- `FALSE_POSITIVE_RISK_STATUS`
- `FALSE_POSITIVE_RISK_LEVEL`
- `REVIEW_ACTION`
- `OPPORTUNITY_FALSE_POSITIVE_DIAGNOSTIC_SCHEMA_VERSION`
- `OPPORTUNITY_FALSE_POSITIVE_DIAGNOSTIC_SOURCE`
- `UNKNOWN_VALUE`

## Risk Statuses

- `low_risk`: supplied diagnostics support the opportunity and no material contradictions were found.
- `review`: missing or cautionary diagnostics require human review.
- `elevated_risk`: one critical blocker or multiple material concerns require review.
- `high_risk`: multiple critical blockers indicate an unsafe opportunity interpretation.
- `likely_false_positive`: Deal Gate or `BUY_NOW` is positive while critical diagnostic blockers remain unresolved.
- `unavailable`: core production and diagnostic inputs are missing.

## Risk Levels

- `low`
- `moderate`
- `high`
- `critical`
- `unknown`

## Core Rules

A positive Deal Gate or `BUY_NOW` result never suppresses contradictory diagnostic evidence.

The module does not recompute Deal Gate, `BUY_NOW`, ROI, valuation, or confidence. It reads supplied outputs and preserves missing diagnostics as missing.

Critical blockers may come from:

- blocked or insufficient evidence readiness,
- identity ambiguity or unsupported identity,
- withheld or extreme-uncertainty valuation diagnostics,
- overconfidence or unsupported confidence calibration,
- blocked listing-quality or high-risk grading diagnostics,
- fragile ROI or suspicious acquisition-price context.

The diagnostic produces a production-authority statement in every result: Deal Gate remains the authoritative production `BUY_NOW` boundary.

## Trace Integration

`validation/productionIntelligenceTrace.js` can record a supplied false-positive diagnostic result in `opportunityFalsePositiveDiagnosticSummary`.

The trace does not compute false-positive diagnostics. It only preserves an optional supplied summary with `changesProductionBehavior: false`.

## Fingerprint

The result includes a deterministic `stableFingerprint` generated from the diagnostic projection with the fingerprint field removed. Fingerprint equality proves deterministic equality of the diagnostic record; it does not prove opportunity quality or production approval.
