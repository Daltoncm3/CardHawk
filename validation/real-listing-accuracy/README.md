# CardHawk Real Listing Accuracy Validation

This folder stores offline validation batches for the Phase 5.9 accuracy milestone.

The workflow is review-only. It does not run scans, call marketplaces, modify persistence, send notifications, recalibrate formulas, or affect Deal Gate, BUY_NOW, valuation, ROI, scoring, grading, recommendations, or scan timing.

## Pilot Target

Start with 25 real CardHawk listings.

After the first 25 are reviewed and failure patterns are understood, expand toward 100 listings.

## Batch Format

Each batch file contains:

- `schemaVersion`
- `source`
- `mode`
- `batchId`
- `createdAt`
- `targetListingCount`
- `reviewer`
- `immutableSnapshots`
- `records`

Each record contains:

- `listing`: identity, item ID or URL, marketplace, asking price, and total cost.
- `cardhawkSnapshot`: immutable copy of CardHawk's original output.
- `snapshotHash`: hash of the original CardHawk snapshot.
- `daltonReview`: manual judgment fields.
- `validation`: outcome categories and failure-pattern labels.

Do not edit `cardhawkSnapshot` after capture. If CardHawk changes later, create a new batch instead of rewriting old outputs.

## Dalton Review Fields

For each listing, fill:

- `judgment`: `buy`, `reject`, or `uncertain`.
- `expectedFairValue`: Dalton's fair-value estimate, or `null` when unknown.
- `judgmentConfidence`: 0-100 confidence in the manual judgment.
- `agreementDisagreementReason`: short reason why Dalton agrees or disagrees.
- `notes`: free-form review notes.

## Outcome Categories

Use one primary `validation.outcomeCategory`:

- `correct_buy`
- `false_positive`
- `correct_rejection`
- `missed_opportunity`
- `uncertain`
- `valuation_disagreement`
- `evidence_disagreement`
- `explanation_display_issue`

Use `validation.disagreementCategories` for secondary labels such as:

- `identity`
- `sold_evidence`
- `valuation`
- `roi`
- `display`
- `supply_pressure`
- `confidence`
- `legacy_context`

Use `validation.recurringFailurePattern` when the same failure appears across multiple listings.

## First 25 Workflow

1. Export or copy 25 real CardHawk listing outputs after the unified presentation layer is present.
2. For each listing, create one validation record using the schema in `real-listing-validation-template.json`.
3. Preserve the original CardHawk fields in `cardhawkSnapshot`.
4. Do not revise `cardhawkSnapshot` after Dalton reviews the listing.
5. Fill Dalton's manual judgment fields.
6. Assign one outcome category.
7. Add disagreement categories and recurring failure patterns where useful.
8. Generate the offline report with `validation/realListingAccuracyValidation.js` from tests or a small local script.
9. Review false positives, missed opportunities, valuation errors, and evidence disagreements.
10. Do not recalibrate anything until the 25-listing pilot has been reviewed.

## Report Metrics

The report calculates:

- total listings reviewed
- CardHawk versus Dalton agreement rate
- false-positive count and rate
- missed-opportunity count and rate
- valuation-error summary
- disagreement categories
- recurring failure patterns
- breakdown by evidence level
- breakdown by price range
- immutable snapshot validation errors

## Safety Rules

- Offline only.
- No live marketplace calls.
- No automatic recalibration.
- No production behavior changes.
- Deal Gate remains the production decision source.
- Evidence Readiness and legacy/context signals remain non-authoritative.
