# Investment Decision Engine Prototype

Phase 7.1A introduces the first standalone Investment Decision Engine prototype.

This prototype is offline, explanation-only, and non-production. It does not integrate with `server.js`, does not alter runtime behavior, and does not change Deal Gate, BUY_NOW, valuation, ROI, scoring, grading, Market Intelligence, recommendations, notifications, persistence, or scan timing.

## Purpose

The prototype answers:

> Is this opportunity worth capital allocation context after Deal Gate has evaluated it?

It does not answer:

> What is this card worth?

It consumes existing production and shadow intelligence and explains investment posture using the approved Investment Decision Contract.

## Authority

Deal Gate remains the authoritative production safety gate.

The prototype has:

- `productionImpact: "none"`
- non-production decision authority
- no runtime integration
- no Capital Score weights
- no production recommendation power

Failed Deal Gate can never produce `BUY` or `PRIORITY_BUY`.

## Staged Decision Flow

The prototype evaluates five readiness stages:

1. `eligibilityAndEvidence`
2. `downsideAndValuationSafety`
3. `financialAttractiveness`
4. `exitAndCapitalVelocity`
5. `marketAndPortfolioContext`

Each stage returns:

- `status`
- `readiness`
- `blockers`
- `cautions`
- `supportingReasons`
- `missingInputs`
- `explanation`

The stages are intentionally conservative. Blockers and cautions reduce aggressiveness. They do not increase upside.

## Posture Selection

Allowed postures:

- `IGNORE`
- `MONITOR`
- `NEGOTIATE`
- `BUY`
- `PRIORITY_BUY`

Current prototype behavior:

- Failed Deal Gate produces `IGNORE`.
- Weak exact identity, weak sold evidence, or unavailable Shadow Valuation produces `MONITOR`.
- Asking price above Maximum Buy Price produces `NEGOTIATE`.
- Portfolio concentration or position-size pressure reduces posture.
- Strong evidence, strong margin, strong exit confidence, and quick capital velocity can produce `BUY` or context-only `PRIORITY_BUY`.

All postures are explanation-only in this phase.

## Strategy Lane Evaluation

The prototype evaluates:

- `QUICK_FLIP`
- `MEDIUM_HOLD`
- `LONG_TERM_INVESTMENT`

Strategy lanes are context only.

Rules:

- Strategy lanes never override Deal Gate.
- Strategy lanes never override evidence blockers.
- Long-term investing cannot excuse weak evidence.
- Quick flips require strong exit confidence.

## Capital Score Limitation

Capital Score remains unimplemented.

The prototype returns:

- `capitalScoreStatus: "not_scored"`
- `score: null`
- `finalWeightsDefined: false`

This is deliberate. Phase 7.1A uses staged readiness only, so no final Capital Score weights are introduced before validation.

## Current Limitations

The prototype does not:

- calculate final Capital Score
- rank opportunities
- implement portfolio policy
- implement final Maximum Buy Price math
- implement final Suggested Offer math
- influence production recommendations
- trigger alerts
- write persistence
- change scan behavior

## Future Rollout

Recommended next phases:

1. Expand fixture coverage for investment posture validation.
2. Run offline real-listing validation using Phase 6.3A snapshots.
3. Add Dalton review agreement reporting.
4. Define Capital Score gates and category caps.
5. Add multi-opportunity ranking offline.
6. Consider shadow runtime visibility only after offline validation.

Production influence remains out of scope until separately approved.
