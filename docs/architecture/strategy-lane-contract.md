# Strategy Lane Contract

Phase 7.0E defines the Strategy Lane Contract for future investment intelligence.

This document is architecture-only. It does not build the Investment Decision Engine, does not implement Capital Score, does not integrate runtime behavior, and does not change Deal Gate, BUY_NOW, valuation, ROI, scoring, grading, Market Intelligence, recommendations, notifications, persistence, or scan timing.

## Purpose

Strategy lanes describe how different investment strategies should behave.

They do not make production decisions. They provide context for a future Investment Decision Engine and future Capital Score.

## Initial Strategy Lanes

### QUICK_FLIP

Primary objective:

Recycle capital quickly through evidence-backed buys with realistic near-term resale exits.

Quick flips should prefer:

- strong true-sold evidence
- exact identity
- high liquidity
- short hold time
- high capital velocity
- strong exit confidence
- low downside tolerance
- low portfolio concentration

Quick flips are especially useful for small and medium bankrolls where slow capital can block future opportunities.

### MEDIUM_HOLD

Primary objective:

Balance meaningful profit with moderate hold time when evidence and market context support patience.

Medium holds should prefer:

- strong or good true-sold evidence
- exact identity
- moderate-to-high liquidity
- weeks-to-months hold time
- moderate-to-strong margin of safety
- credible exit confidence
- controlled concentration

Medium holds can tolerate more time than quick flips, but only when expected return and evidence quality justify the capital lockup.

### LONG_TERM_INVESTMENT

Primary objective:

Deploy capital selectively into durable thesis-driven opportunities with strong downside support.

Long-term investments should prefer:

- strong evidence
- exact identity
- durable demand
- conservative downside support
- strong margin of safety
- explicit exit thesis
- portfolio-fit discipline
- larger bankroll suitability

Long-term investing is not an excuse for weak evidence. A long hold still requires a factually supported thesis.

## Ownership Boundaries

The Strategy Lane Contract does not determine:

- valuation
- Deal Gate
- BUY_NOW
- Capital Score
- production decisions
- notifications
- persistence

Strategy lanes are context only.

## Interaction With Deal Gate

Deal Gate remains the authoritative production safety gate.

Strategy lanes can never override Deal Gate. If Deal Gate fails, a strategy lane may provide monitoring or research context, but it cannot make the listing buyable.

## Interaction With Capital Score

Capital Score will eventually decide priority for capital deployment.

Strategy lanes should inform Capital Score by describing which kinds of opportunities fit Dalton's selected strategy, but they must not replace Capital Score or secretly encode score weights.

## Future Strategy Profile Input

Future strategy profiles may include:

- preferred strategy lanes
- maximum capital allocation per position
- maximum portfolio concentration
- minimum target net profit
- minimum ROI
- preferred hold duration
- liquidity preference
- evidence strictness
- risk tolerance
- bankroll size
- reserve capital percentage

These preferences are not implemented in this phase.

## Future Strategy Lane Output

Future lane output should include:

- `strategyLane`
- `laneEligibility`
- `laneReadiness`
- `laneStrengths`
- `laneWeaknesses`
- `recommendedHoldingWindow`
- `preferredExitStyle`
- `explanation`
- `productionImpact: "none"`

## Hard Rules

- Strategy lanes never override Deal Gate.
- Strategy lanes never override Capital Score.
- Strategy lanes only provide context for investment decisions.
- Weak evidence cannot become acceptable simply because a strategy is aggressive.
- Long-term investing is not an excuse for weak evidence.
- Quick flips require strong exit confidence.
- All strategy recommendations must remain Constitution-compliant.

## Future Rollout Sequence

Recommended rollout:

1. Define this Strategy Lane Contract.
2. Define Capital Score category gates and caps.
3. Build a standalone Investment Decision prototype.
4. Add fixture tests for quick flip, medium hold, and long-term strategy fit.
5. Validate against real listing snapshots.
6. Add portfolio and bankroll context.
7. Consider shadow runtime visibility only after offline validation.

Production influence is explicitly out of scope for this phase.
