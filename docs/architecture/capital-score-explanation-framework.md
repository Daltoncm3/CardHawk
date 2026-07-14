# Capital Score Explanation Framework

## Purpose

The Capital Score Explanation Framework is an offline-only explanation layer for Phase 7.1B.

It does not calculate Capital Score, define final scoring weights, rank opportunities, or influence runtime behavior. Its purpose is to explain why Capital Score is currently withheld and what information must eventually be available before CardHawk can safely prioritize one opportunity over another.

## Status

- Source: `capital_score_explanation_engine`
- Version: `capital-score-explanation-engine-v0.1`
- Production impact: `none`
- Decision impact: `none`
- Capital Score status: `not_scored`
- Final weights defined: `false`
- Score: `null`

No score may be fabricated, estimated, inferred, backfilled, or displayed until a future validated Capital Score implementation is explicitly approved.

## Inputs

The framework accepts the future Investment Decision context:

- Investment Decision output
- Deal Gate
- Shadow Valuation
- Shadow Sold Comparison
- Canonical Identity
- Financial Context
- Portfolio Context
- Strategy Profile
- Competing Opportunities

All inputs are treated as context only. The framework is read-only and must not mutate input objects.

## Readiness Categories

The framework evaluates readiness across eight categories:

1. Evidence Readiness
2. Downside Protection Readiness
3. Financial Readiness
4. Exit Confidence Readiness
5. Portfolio Readiness
6. Opportunity Cost Readiness
7. Strategy Readiness
8. Bankroll Readiness

Each category returns:

- `status`
- `readiness`
- `supportingFactors`
- `missingFactors`
- `blockers`
- `explanation`

Readiness is explanatory only. A ready category does not create a score, and a blocked category does not change production behavior.

## Future Capital Score Inputs

The framework reports the availability of every approved future Capital Score input from the Investment Decision Contract:

- Deal Gate status
- Evidence quality
- Exact identity confidence
- Shadow Valuation support
- Expected net profit
- ROI
- Margin of safety
- Liquidity
- Expected hold time
- Supply pressure
- Market regime
- Capital required
- Downside risk
- Opportunity cost
- Portfolio concentration
- Strategy fit

Each input is classified as:

- `available`
- `unavailable`
- `insufficient`
- `pending future implementation`

These statuses explain readiness only. They are not weights and must not be interpreted as a score.

## Why Capital Score Is Withheld

Capital Score remains disabled because:

- Final scoring weights have not been validated.
- Opportunity ranking has not been validated against real dealer outcomes.
- Weak evidence must never be offset by ROI, profit, desirability, hype, or legacy context.
- Uncertainty must reduce aggressiveness rather than increase it.
- Deal Gate remains the authoritative production safety gate.

The framework explicitly returns `score: null` and `capitalScoreStatus: "not_scored"` in every scenario.

## Constitution Compliance

The framework follows the CardHawk Constitution principles:

- Protect capital first; grow capital second.
- Evidence over speculation.
- Exact identity first.
- Never recommend purchasing unless expected profitability can be factually supported.
- Explainable, reproducible, evidence-backed recommendations.

Because this phase is explanation-only, the framework never produces `BUY`, `PRIORITY_BUY`, or any production recommendation.

## Future Implementation Sequence

Before Capital Score can be calculated:

1. Validate Shadow Valuation against real listing outcomes.
2. Validate exact sold comparison quality.
3. Validate dealer agreement on Investment Decision postures.
4. Define and review preliminary Capital Score categories.
5. Backtest category behavior against reviewed listing batches.
6. Define candidate weights only after validation evidence exists.
7. Keep Capital Score non-production until separately approved.

## Safety Guarantees

- No server integration.
- No runtime behavior changes.
- No production valuation changes.
- No ROI changes.
- No Deal Gate changes.
- No BUY_NOW changes.
- No scoring, grading, recommendation, notification, persistence, or scan timing changes.
