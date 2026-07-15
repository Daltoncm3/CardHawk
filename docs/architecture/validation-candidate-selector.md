# Validation Candidate Selector

## Purpose

The Validation Candidate Selector is an offline-only Phase 7.1D support tool.

It does not make buying decisions. It identifies which scanned listings would teach CardHawk the most if Dalton reviewed them. The selector ranks learning value, not investment value.

## Scope

The selector may consume:

- listing snapshots
- production outputs
- shadow outputs
- Investment Decision output
- Canonical Identity
- Shadow Sold Comparison
- Shadow Valuation
- validation history

It returns deterministic candidate objects for review prioritization.

## Candidate Categories

The selector supports these categories:

- `production_vs_shadow_disagreement`
- `high_uncertainty`
- `weak_evidence`
- `strong_evidence_rejected`
- `shadow_without_production_support`
- `production_without_shadow_support`
- `identity_conflict`
- `valuation_conflict`
- `edge_case`
- `learning_opportunity`

Categories describe why a listing is useful for validation review. They do not describe whether the listing should be bought.

## Candidate Output

Each candidate contains:

- `candidateId`
- `listingId`
- `learningPriority`
- `reviewPriority`
- `candidateCategory`
- `candidateCategories`
- `recommendedReviewReason`
- `evidenceSummary`
- `disagreementSummary`
- `uncertaintySummary`
- `suggestedValidationFocus`
- `productionImpact: "none"`

## Ranking Philosophy

Candidates are ranked by expected learning value:

1. Production-versus-shadow disagreement
2. Valuation conflict
3. Identity conflict
4. Strong evidence rejected by production
5. Production support without shadow support
6. Shadow support without production support
7. Weak evidence
8. High uncertainty
9. Edge cases
10. Baseline learning opportunities

The selector intentionally does not prioritize by ROI, expected profit, desirability, or buy-like labels. A rejected listing may rank above a profitable-looking listing if it reveals more about evidence quality, identity accuracy, valuation disagreement, or production-versus-shadow alignment.

## Review Workflow

1. Export or prepare scanned listing snapshots.
2. Run the selector offline.
3. Review the highest-priority candidates first.
4. Add Dalton review decisions through the Investment Decision Validation Harness.
5. Track recurring disagreement categories.
6. Use recurring patterns to choose future calibration work.

## Future Integration

The selector is intended to feed the Investment Decision Validation Harness by helping build more informative review batches.

Future validation workflows may:

- select the top candidates from recent scans
- balance candidates across categories
- avoid over-sampling one card type or price range
- include prior validation history
- track whether fixes reduce recurring disagreement categories

## Safety Guarantees

- Offline only.
- No runtime integration.
- No production behavior changes.
- No Deal Gate changes.
- No BUY_NOW changes.
- No valuation, ROI, scoring, grading, Market Intelligence, recommendation, notification, persistence, or scan timing changes.
