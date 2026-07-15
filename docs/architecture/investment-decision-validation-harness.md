# Investment Decision Validation Harness

## Purpose

The Investment Decision Validation Harness is an offline-only framework for Phase 7.1C.

It compares Investment Decision outputs against Dalton's manual review and, when available, later market outcomes. The harness is designed to support real CardHawk listing snapshots without changing runtime behavior or production decisions.

## Scope

The harness:

- Accepts batches of real CardHawk listing snapshots.
- Preserves production outputs.
- Preserves shadow outputs.
- Evaluates the standalone Investment Decision Engine.
- Records Dalton's investment decision review.
- Records actual outcome data when available.
- Produces per-listing validation records.
- Produces aggregate investment metrics.

The harness does not:

- Calculate Capital Score.
- Define Capital Score weights.
- Modify Deal Gate.
- Modify BUY_NOW.
- Modify valuation, ROI, scoring, grading, Market Intelligence, recommendations, notifications, persistence, or scan timing.
- Integrate with `server.js`.

## Per-Listing Validation Record

Each validation record contains:

- `schemaVersion`
- `source`
- `recordId`
- `listingId`
- `capturedAt`
- `immutableSnapshot`
- `snapshotHash`
- `inputSnapshot`
- `productionSnapshot`
- `shadowSnapshot`
- `investmentDecision`
- `daltonReview`
- `actualOutcome`
- `validation`

The immutable snapshot includes the Investment Decision input, production outputs, shadow outputs, and evaluated Investment Decision output. The `snapshotHash` protects historical validation records from accidental rewrite after future formula changes.

## Dalton Review Fields

Dalton review supports:

- `decision`: `IGNORE`, `MONITOR`, `NEGOTIATE`, `BUY`, `PRIORITY_BUY`, `UNCERTAIN`, or `UNREVIEWED`
- `strategyLane`
- `confidence`
- `agreementReason`
- `disagreementCategories`
- `recurringReasoningPattern`
- `notes`

## Actual Outcome Fields

Actual outcome supports:

- `status`
- `soldPrice`
- `netProfit`
- `roi`
- `daysToExit`
- `outcomeCategory`
- `notes`

Outcome fields may remain pending until enough resale or market data exists.

## Validation Outcomes

The harness classifies records into:

- `agreement`
- `false_positive`
- `missed_opportunity`
- `correct_restriction`
- `correct_buy`
- `uncertain`
- `outcome_pending`
- `market_outcome_disagreement`
- `reasoning_disagreement`
- `evidence_disagreement`

These are validation labels only. They do not affect production recommendations.

## Aggregate Metrics

Aggregate reports include:

- total listings
- reviewed listings
- agreement count and rate
- false-positive count and rate
- missed-opportunity count and rate
- outcome counts
- posture agreement summaries
- strategy lane summaries
- evidence quality summaries
- recurring disagreement categories
- recurring reasoning patterns
- recommendation improvement candidates
- actual outcome summary
- validation integrity

## Evidence Quality Summary

Evidence quality is summarized from shadow/canonical evidence fields:

- `strong_exact_sold_support`
- `sufficient_exact_sold_support`
- `thin_exact_sold_support`
- `no_exact_sold_support`
- `insufficient_shadow_valuation`

Contextual sold matches, active listings, and unavailable shadow valuation are never treated as exact valuation support.

## Workflow

1. Export or prepare a batch of real CardHawk listing snapshots.
2. Include each listing's production outputs and shadow outputs.
3. Run the harness offline against the batch.
4. Review each listing and fill in Dalton's review decision.
5. Re-run the aggregate report.
6. Add actual outcome fields later when market outcomes are known.
7. Use recurring disagreement categories and improvement candidates to guide future architecture work.

## Safety Guarantees

- Offline only.
- No runtime integration.
- No production behavior changes.
- No Capital Score calculation.
- No Deal Gate or BUY_NOW changes.
- No valuation, ROI, scoring, grading, Market Intelligence, recommendation, notification, persistence, or scan timing changes.
