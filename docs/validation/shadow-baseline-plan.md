# Shadow Mode Baseline Collection Plan

This plan defines how CardHawk should collect and review Shadow Mode evidence before any Decision Intelligence signal is considered for decision influence.

Shadow Mode remains observational only. It has no BUY_NOW influence, no Deal Gate influence, and no recommendation influence.

## Objectives

- Establish a reliable baseline for Decision Intelligence behavior on real scan observations.
- Measure whether Shadow Mode explanations agree with expert dealer judgment.
- Identify repeated false positives, false negatives, confidence errors, and disagreement categories.
- Compare Shadow Mode observations against existing production outcomes without changing production behavior.
- Decide whether Phase 3.4 planning is justified or whether recalibration is required first.

## Success Criteria

Success means Shadow Mode produces explanations that are consistently useful, conservative, and aligned with expert dealer review.

Baseline success requires:

- High dealer agreement across the reviewed sample.
- Low false positive rate.
- Low false negative rate.
- Confidence levels that match observed dealer agreement.
- Stable or explainable disagreement patterns against production outputs.
- No evidence that Shadow Mode would encourage unsafe buying behavior if it were ever made decision-eligible.
- No runtime behavior changes during baseline collection.

## Recommended Sample Sizes

### 100 Listings

Use the first 100 listings as the initial smell test.

Purpose:

- Catch obvious posture or signal classification errors.
- Verify that Shadow Mode logging and offline comparison reports work end to end.
- Confirm that reviewers understand the scoring and review workflow.

Expected output:

- Initial dealer agreement estimate.
- First false positive and false negative review.
- Top disagreement categories.
- Notes on confusing explanations or missing evidence.

Do not draw final decision-readiness conclusions from 100 listings.

### 500 Listings

Use 500 listings as the first meaningful calibration sample.

Purpose:

- Measure recurring disagreement patterns.
- Separate one-off edge cases from systematic issues.
- Check confidence calibration across low, medium, and high confidence buckets.
- Compare Shadow Mode behavior across strong, thin, active-only, volatile, stale, and high-supply contexts.

Expected output:

- Dealer agreement trend.
- False positive and false negative rates by category.
- Confidence calibration summary.
- Shadow vs Production disagreement rate.
- List of common disagreement causes that require tuning or better evidence.

Phase 3.4 should not proceed before the 500-listing review is complete.

### 1,000 Listings

Use 1,000 listings as the minimum production-grade baseline before any decision-influence proposal.

Purpose:

- Validate stability across a broad range of listings and market states.
- Confirm that early calibration improvements did not overfit the smaller sample.
- Measure whether dealer agreement and confidence calibration remain stable over time.
- Build a defensible evidence record before discussing decision eligibility.

Expected output:

- Final baseline scorecard.
- Dealer agreement by posture and signal type.
- False positive and false negative rate by listing category.
- Confidence calibration by bucket.
- Most common unresolved disagreement categories.
- Recommendation on whether to proceed to Phase 3.4 design, continue observation, or recalibrate.

## Metrics To Track

Track these metrics for each sample milestone:

- Dealer agreement.
- False positive rate.
- False negative rate.
- Confidence calibration.
- Shadow vs Production disagreement rate.
- Most common disagreement categories.

Also retain supporting context:

- total listings reviewed
- listing category or market context when available
- overallReadiness distribution
- blocker distribution
- caution signal distribution
- conflict distribution
- manual review count
- notes from dealer review

## Exit Criteria Before Phase 3.4

Phase 3.4 planning may begin only after the 1,000-listing baseline is reviewed and all of the following are true:

- Dealer agreement is consistently strong enough to justify deeper design review.
- False positives are low and manually reviewed.
- False negatives are low and manually reviewed.
- Confidence calibration is acceptable across confidence buckets.
- Top disagreement categories are understood and either resolved or explicitly accepted.
- Shadow Mode output remains explanation-only with `recommendationImpact: "none"`.
- No evidence shows Shadow Mode changing BUY_NOW, Deal Gate, scoring, recommendations, notifications, persistence behavior, or scan timing.
- A human reviewer signs off that the baseline is sufficient for architecture planning only.

Passing these criteria does not approve decision influence. It only allows Phase 3.4 design discussion.

## Failure Criteria Requiring Recalibration

Recalibration is required before Phase 3.4 if any of the following occur:

- Dealer agreement is weak or unstable across the sample.
- False positives cluster around BUY_NOW-like production outcomes.
- False negatives hide important blockers or identity mismatches.
- Confidence is repeatedly high on dealer-disagreed listings.
- Shadow Mode frequently misses supply pressure, valuation, or evidence sufficiency concerns.
- A small number of disagreement categories dominate the error profile.
- Reviewers cannot understand or trust the explanation text.
- Missing evidence is treated as stronger evidence than it should be.
- Any observation suggests Shadow Mode could influence production behavior.

If recalibration is required, continue Shadow Mode observation only after the issue is documented and a new validation sample is planned.

## Recommended Review Cadence

Review cadence should be steady enough to detect drift without overwhelming human reviewers.

Recommended cadence:

- Daily quick check while Shadow Mode is newly enabled.
- Weekly dealer review until the 500-listing milestone is complete.
- Biweekly review between 500 and 1,000 listings if metrics are stable.
- Immediate review after any major intelligence-engine change.
- Final milestone review at 100, 500, and 1,000 listings.

Each review should record:

- number of listings reviewed
- report files used
- reviewer
- notable false positives
- notable false negatives
- disagreement categories
- calibration concerns
- decision on continue, recalibrate, or pause

## Human Review Workflow

1. Enable Shadow Mode in the target environment.
2. Allow scans to collect observations in `data/shadow-mode.json`.
3. Export recent scan results using the offline export utility.
4. Generate the Shadow Mode summary report.
5. Generate the Shadow vs Production comparison report.
6. Select listings requiring manual review.
7. Have an expert dealer classify each selected listing.
8. Record agreement, false positives, false negatives, explanation quality, and notes.
9. Update the baseline scorecard.
10. Decide whether to continue collecting, recalibrate, or pause.

Reviewers should focus on whether Shadow Mode explains the listing like a careful dealer would. They should not treat Shadow Mode as a recommendation engine.

## Safety Requirements

Shadow Mode baseline collection must preserve these safety requirements:

- No BUY_NOW influence.
- No Deal Gate influence.
- No recommendation influence.
- No scoring changes.
- No notification changes.
- No persistence behavior changes outside the dedicated Shadow Mode log.
- No scan timing changes.
- No marketplace calls from validation tools.
- No mutation of production listing records.
- `recommendationImpact` remains `"none"`.

Shadow Mode remains observational only throughout baseline collection.

Any proposal to make a signal decision-eligible requires a separate architecture review after the baseline is complete.
