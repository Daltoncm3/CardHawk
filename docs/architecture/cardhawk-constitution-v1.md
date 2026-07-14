# CardHawk Constitution v1.0

Phase 5.9E establishes the permanent design reference for CardHawk's investment intelligence architecture.

This document is documentation only. It does not change runtime behavior, formulas, valuation, ROI, Deal Gate, BUY_NOW, grading, scoring, confidence, recommendations, notifications, persistence, or scan timing.

## Mission

CardHawk exists to help evaluate sports card and trading card purchases with disciplined, evidence-backed investment judgment.

The system's first responsibility is to protect capital. Growth comes second. CardHawk should prefer missing a questionable deal over recommending a purchase that cannot be factually supported.

## Vision

CardHawk should become an expert-level market analyzer that combines verified transaction evidence, exact card identity, market context, financial discipline, negotiation intelligence, and continuous post-trade learning.

The long-term system should be able to explain:

- what the card is
- what evidence supports the valuation
- what the market environment looks like
- what the buyer can safely pay
- what offer should be made
- why the expected profit is or is not supported
- how the opportunity fits within available capital and portfolio goals
- what happened after purchase or rejection

Recommendations must be explainable, reproducible, and grounded in verifiable evidence.

## Core Doctrines

1. Protect capital first; grow capital second.
2. Evidence over speculation.
3. Conservative by default.
4. Exact identity first.
5. Markets, not averages.
6. Net profit only.
7. Quality over quantity.
8. Create opportunities through intelligent negotiation.
9. Capital-first investment evaluation.
10. Continuous learning from completed trades.
11. Explainable, reproducible, evidence-backed recommendations.
12. Never recommend purchasing unless expected profitability can be factually supported.

## Investment Philosophy

CardHawk should evaluate purchases as capital allocation decisions, not as isolated price comparisons.

An attractive listing is not automatically a good investment. A card may be desirable, rare, popular, or visually appealing and still be a poor buy if the purchase price, resale friction, fees, liquidity, evidence quality, or market regime does not support profit.

Investment evaluation should eventually answer:

- Is this the exact card we think it is?
- Is the market evidence reliable?
- What is the conservative floor?
- What is the likely resale range?
- What is the maximum safe buy price?
- What offer should be made?
- What net profit remains after fees, shipping, taxes, and expected friction?
- How long might capital be tied up?
- Is this opportunity better than competing uses of capital?

Production decisions must remain conservative until every required evidence layer is validated.

## Evidence Philosophy

Evidence is the foundation of CardHawk.

The system must distinguish evidence types clearly:

- `true_sold`: verified transaction-level sold evidence with sold price and sold date.
- `active_context`: current asks, inventory depth, spread, and competitive supply.
- `aggregate_market_price`: external market-price summaries that are not individual transactions.
- `fallback_unknown`: incomplete or inferred evidence that cannot satisfy sold support.

Active listings can provide context, but they are not sold evidence. Aggregate market prices can inform research, but they are not transaction-level comps. Fallbacks may support investigation, but they must not justify purchase recommendations.

Every evidence record should preserve provenance:

- source
- marketplace
- source record ID
- sale ID when available
- URL
- image
- acquisition method
- adapter version
- review status
- licensing or permission status
- evidence quality
- identity confidence

Evidence should be replayable. A future reviewer should be able to reproduce why a record was accepted, rejected, deduplicated, quarantined, or used only as context.

## Identity Philosophy

Exact identity is non-negotiable.

Many cards look similar but trade in different markets. CardHawk must treat identity as a first-class requirement before valuation.

Identity should account for:

- sport or category
- player, subject, or character
- year
- manufacturer or brand
- product and set
- card number
- base versus parallel
- variation
- rookie designation
- autograph
- memorabilia or relic
- serial numbering and print run
- grading company
- grade
- certification number
- raw versus graded
- condition

Identity matching should be strict where errors are expensive. Relaxed matches may be useful for context, but they must be labeled as near, directional, or rejected. They must not silently become exact sold support.

Seller marketing terms such as "rare", "investment", "SSP", "mint", "case hit", or "refractor" should never override canonical identity without corroborating evidence.

## Valuation Philosophy

CardHawk should eventually move from a single headline value toward a disciplined valuation range.

Future valuation should include:

- conservative floor value
- expected value
- optimistic ceiling value
- fair market range
- maximum buy price
- time-weighted valuation
- market regime adjustment
- liquidity adjustment
- supply pressure adjustment
- evidence quality adjustment
- confidence interval

Valuation must be based primarily on verified sold evidence. Active listings may shape supply, ask spread, negotiation leverage, and resale pressure, but they must not create sold-like market value.

The system should prefer understating value when evidence is weak. When valuation cannot be factually supported, the correct output is insufficient evidence, not a speculative number.

## Negotiation Philosophy

CardHawk should not only identify deals; it should help create them.

The system should eventually calculate:

- maximum buy price
- suggested offer
- negotiation range
- walk-away price
- expected net profit at each offer level
- seller leverage
- buyer leverage
- undercut risk
- expected resale spread

Negotiation intelligence must remain grounded in evidence. A suggested offer should not be based on wishful upside. It should be based on net profit, market liquidity, active inventory pressure, fees, shipping, taxes, risk, and capital exposure.

## Portfolio Philosophy

CardHawk should evaluate opportunities within a portfolio context.

Future portfolio intelligence should consider:

- available capital
- capital already deployed
- exposure by sport, player, category, grade, set, and market regime
- concentration risk
- expected hold time
- liquidity tier
- realized versus expected profit
- sell recommendations
- opportunity cost
- reinvestment discipline

The best card in isolation may still be the wrong purchase if it overconcentrates capital or creates poor liquidity.

## Learning Philosophy

CardHawk should continuously learn from completed decisions.

Future learning loops should compare:

- original recommendation
- evidence at decision time
- purchase price
- accepted offer
- actual sale price
- time to sale
- fees and shipping
- realized net profit
- missed opportunities
- false positives
- false negatives
- dealer review notes

Learning must be auditable. Historical snapshots should remain immutable so formula changes cannot rewrite past evidence.

## Success Metrics

CardHawk should be judged by investment accuracy and capital protection, not by the number of buy recommendations.

Primary future metrics:

- false positive rate
- missed opportunity rate
- dealer agreement rate
- realized net profit
- return on deployed capital
- valuation error
- maximum buy price accuracy
- sell-through accuracy
- time-to-sale accuracy
- evidence sufficiency accuracy
- identity rejection accuracy
- confidence calibration

Secondary metrics:

- number of reviewed listings
- number of evidence records imported
- coverage by category and marketplace
- duplicate detection accuracy
- replay determinism
- provenance completeness

## Development Principles

Development must preserve production safety.

Principles:

- Add evidence visibility before decision influence.
- Prefer standalone engines before runtime integration.
- Prefer shadow mode before production use.
- Preserve backwards compatibility.
- Keep Deal Gate authoritative until explicitly replaced.
- Never let active evidence satisfy true sold requirements.
- Never lower identity safety to improve apparent coverage.
- Keep raw values available for debugging.
- Label context signals as context.
- Separate evidence, financial context, market context, legacy context, and production decisions.
- Add regression tests before changing formulas.
- Validate against real listings and dealer judgment before decision influence.

## Current Production Behavior

Current production behavior is governed by existing runtime engines and safeguards.

Important current facts:

- Deal Gate is the authoritative production decision.
- BUY_NOW remains controlled by existing production logic.
- Existing valuation, ROI, scoring, grading, confidence, recommendations, notifications, persistence, and scan timing remain unchanged by this document.
- Canonical sold evidence is runtime-visible but does not currently influence production valuation.
- Decision Intelligence and related evidence layers are explanation-oriented unless explicitly integrated in a future approved phase.
- Active listings are context and must not satisfy true sold support.

This Constitution does not alter any of those behaviors.

## Future Architectural Vision

The following concepts are future architecture goals. They are documentation-only in this Constitution and are not implemented by this phase.

### Fair Market Range

A valuation range describing conservative floor, expected value, and optimistic ceiling. It should reflect evidence quality, comp similarity, market regime, liquidity, and supply pressure.

### Maximum Buy Price

The highest price CardHawk believes can be paid while preserving required net profit and capital protection.

### Suggested Offer

A negotiation recommendation below or at maximum buy price, informed by seller leverage, active inventory, market liquidity, and expected margin.

### Investment Thesis

A concise explanation of why a purchase is or is not supported, including identity, evidence, valuation, market regime, demand, supply, risk, and expected exit.

### Evidence Readiness

A context signal describing whether evidence is strong enough to trust analysis. Evidence readiness is not itself a production buy recommendation.

### Portfolio Management

A future layer that evaluates purchases against capital, concentration, liquidity, opportunity cost, and realized performance.

### Sell Recommendations

Future sell-side intelligence should identify when a held card should be listed, held, repriced, or exited based on market regime, liquidity, demand, and portfolio goals.

### Multiple Investment Strategies

CardHawk may eventually support distinct strategies such as quick flip, long-term hold, graded arbitrage, prospect speculation, vintage stability, low-dollar volume, and TCG liquidity. Each strategy must define its own risk tolerance and evidence requirements.

### Continuous Accuracy Validation

Every decision-influencing layer should be validated against real listings, dealer judgment, realized outcomes, and immutable historical snapshots.

### Canonical Sold Evidence

The permanent transaction evidence foundation. It should store verified sold records with provenance, identity, deduplication, retention, quality metadata, and replay safety.

### Canonical Sold Comparison Service

A future service that compares canonical sold records to target listings using strict identity matching and explains accepted, near, rejected, stale, and insufficient comps.

### Market Regime Detection

Classification of the current market environment, such as stable, rising, falling, overheated, cooling, volatile, thin, hype-driven, stale, or unknown.

### Time-Weighted Valuation

Valuation that weights recent, reliable, exact sold comps more heavily while recognizing stale markets, volatility, and thin liquidity.

### Capital Allocation

Decision logic that evaluates whether the expected return justifies deploying available capital compared with other opportunities.

### Portfolio Performance Tracking

Tracking realized outcomes against CardHawk's original expectations to improve future evidence weighting, valuation confidence, and decision calibration.

## Future Architecture Roadmap

Future phases should proceed in this order unless later audits identify a safer path:

1. Expand canonical sold evidence coverage through compliant manual, licensed, partner, or approved marketplace sources.
2. Build a standalone canonical sold comparison service.
3. Run sold comparison in evidence-only mode.
4. Create shadow valuation using canonical sold evidence.
5. Compare shadow valuation against current production valuation.
6. Validate against real listings and dealer review.
7. Calibrate confidence and false-positive behavior.
8. Define maximum buy price and suggested offer in shadow mode.
9. Add portfolio-aware capital allocation in shadow mode.
10. Consider production influence only after validation thresholds are met.

## Production Influence Requirements

Before any future signal can influence BUY_NOW, Deal Gate, valuation, ROI, score, grade, recommendation, notification, or scan behavior, it must satisfy:

- clearly defined ownership
- explicit signal contract
- evidence source policy
- identity policy
- confidence semantics
- regression tests
- replay tests
- real-listing validation
- dealer agreement validation
- false-positive analysis
- rollback plan
- documented approval

No future signal should recommend purchasing unless expected profitability can be factually supported by verified evidence.

