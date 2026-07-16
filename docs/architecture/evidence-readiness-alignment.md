# Evidence Readiness Alignment

Phase 10.3 adds a standalone evidence readiness diagnostic layer.

The diagnostic gives CardHawk one consistent read-only interpretation of supplied evidence readiness across true sold evidence, active listing context, fallback values, comparable quality, identity exactness, recency, duplicates, transaction eligibility, and source concentration.

It does not change production valuation, Deal Gate, `BUY_NOW`, confidence thresholds, parser behavior, notifications, marketplace behavior, scan timing, or `server.js`.

## Module

`validation/evidenceReadinessDiagnostics.js`

Public API:

- `evaluateEvidenceReadiness(input)`
- `buildEvidenceReadinessFingerprint(result)`
- `summarizeEvidenceReadiness(result)`
- `READINESS_STATUS`
- `READINESS_LEVEL`
- `REVIEW_ACTION`
- `EVIDENCE_READINESS_DIAGNOSTIC_SCHEMA_VERSION`
- `EVIDENCE_READINESS_DIAGNOSTIC_SOURCE`
- `MIN_TRUE_SOLD_FOR_READY`
- `DEFAULT_STALE_DAYS`
- `UNKNOWN_VALUE`

## Readiness Statuses

- `ready`: minimum exact true-sold evidence is satisfied with no diagnostic warnings.
- `conditionally_ready`: minimum exact true-sold evidence is satisfied, but warnings require review.
- `thin`: one or two exact true-sold records are present, below the minimum.
- `insufficient`: no exact true-sold evidence is available.
- `blocked`: evidence contains blocker-level issues such as active-only, fallback-only, identity inexactness, rejected comparable reliance, duplicate reliance, or transaction-ineligible evidence.
- `unavailable`: no evidence was supplied.

## Core Rules

Active listings and fallback values never satisfy true-sold minimums.

Only non-stale, transaction-eligible, non-duplicate, exact `true_sold` evidence enters `evidenceUsed`.

Excluded evidence is preserved in `evidenceExcluded` with reason codes such as:

- `active_listing_context_only`
- `fallback_or_unknown_evidence`
- `contextual_comparable_only`
- `rejected_comparable`
- `stale_evidence`
- `duplicate_evidence`
- `transaction_ineligible`

## Diagnostic Valuation Readiness

The diagnostic may recommend that valuation should be withheld diagnostically. This is not a production valuation change. It does not alter `marketValueEngine`, production estimated value, ROI, Deal Gate, `BUY_NOW`, notifications, or scan timing.

## Trace Integration

`validation/productionIntelligenceTrace.js` can record a supplied evidence readiness diagnostic result in `evidenceReadinessDiagnosticSummary`.

The trace does not compute evidence readiness diagnostics itself. No production runtime file imports this module.

## Fingerprint

The result includes a deterministic `stableFingerprint` generated from the diagnostic projection with the fingerprint field removed. Fingerprint equality proves deterministic equality of the diagnostic record; it does not prove source truth, legal permission, or valuation accuracy.
