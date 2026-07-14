# Investment Decision Contract

Phase 7.0B defines the architecture contract for a future Investment Decision Engine.

This document is architecture-only. It does not implement the Investment Decision Engine, does not integrate runtime behavior, and does not change Deal Gate, BUY_NOW, valuation, ROI, scoring, grading, Market Intelligence, recommendations, notifications, persistence, or scan timing.

## Purpose

The future Investment Decision Engine sits above Deal Gate.

Deal Gate answers:

> Is this listing allowed to be bought under production safety rules?

The Investment Decision Engine answers:

> Is this the best use of available capital right now?

The engine is not a valuation engine. It is a capital allocation and opportunity prioritization layer.

## Execution Hierarchy

The intended hierarchy is:

1. Existing production analysis.
2. Deal Gate production safety decision.
3. Canonical Identity diagnostics.
4. Canonical Sold Evidence and Shadow Sold Comparison.
5. Shadow Valuation and market/evidence context.
6. Future Investment Decision Engine.
7. Future portfolio-aware ranking across simultaneous opportunities.

Deal Gate remains the authoritative production safety gate. The Investment Decision Engine can never override a failed Deal Gate.

## Owned Responsibilities

The future engine owns:

- capital allocation
- opportunity ranking
- maximum buy price interpretation
- suggested offer interpretation
- liquidity-adjusted aggressiveness
- evidence-adjusted aggressiveness
- hold strategy
- exit strategy
- portfolio fit
- opportunity cost
- explanation of why an eligible listing is or is not worth capital

## Out-of-Scope Responsibilities

The future engine does not own:

- raw valuation
- sold comp matching
- identity matching
- Deal Gate pass/fail
- BUY_NOW thresholds
- production scanning
- notifications
- persistence

## Investment Postures

Allowed investment postures:

- `IGNORE`: not worth additional attention or capital.
- `MONITOR`: could become investable if price, evidence, or market conditions improve.
- `NEGOTIATE`: not investable at asking price, but could become investable through an evidence-supported offer.
- `BUY`: worth purchasing now at or below the Maximum Buy Price.
- `PRIORITY_BUY`: one of the strongest available uses of capital relative to competing opportunities.

`BUY` and `PRIORITY_BUY` are never valid when Deal Gate fails.

## Capital Score Contract

Capital Score answers:

> If capital is limited, how much priority should this opportunity receive compared with other opportunities?

Capital Score is distinct from:

- ROI
- expected profit
- Legacy Context Score
- Desirability Context
- Legacy Deal Grade
- confidence
- Deal Gate

Future Capital Score inputs include:

- Deal Gate status
- evidence quality
- exact identity confidence
- Shadow Valuation support
- expected net profit
- ROI
- margin of safety
- liquidity
- expected hold time
- supply pressure
- market regime
- capital required
- downside risk
- opportunity cost
- portfolio concentration
- strategy fit

No final Capital Score weights are defined in this phase.

## Input Contract

The future engine input must include:

- `listingSnapshot`
- `dealGate`
- `productionValuation`
- `productionDecisionExplanation`
- `canonicalIdentity`
- `canonicalSoldEvidence`
- `shadowSoldComparison`
- `shadowValuation`
- `marketIntelligence`
- `confidenceBreakdown`
- `financialContext`
- `portfolioContext`
- `strategyProfile`
- `competingOpportunities`

## Output Contract

The future engine output must include:

- `source`
- `version`
- `productionImpact`
- `decisionAuthority`
- `dealGateStatus`
- `investmentPosture`
- `capitalAction`
- `capitalScore`
- `strategyFit`
- `maximumBuyPrice`
- `suggestedOffer`
- `marginOfSafety`
- `expectedNetProfitRange`
- `expectedHoldTime`
- `exitStrategy`
- `opportunityRank`
- `opportunityCostAssessment`
- `portfolioFit`
- `aggressivenessLevel`
- `uncertaintyAdjustment`
- `supportingReasons`
- `cautionReasons`
- `blockers`
- `conflicts`
- `explanation`
- `auditTrail`

`productionImpact` defaults to `none` and must remain `none` until a separate validation and approval phase explicitly changes production influence.

## Architectural Rules

Hard rules:

- The Investment Decision Engine can never override a failed Deal Gate.
- It may only restrict, rank, prioritize, monitor, or recommend negotiation after Deal Gate evaluation.
- Uncertainty must always reduce aggressiveness.
- Weak evidence must never increase expected upside.
- Suggested Offer must never exceed Maximum Buy Price.
- Contextual sold matches must never be treated as exact valuation evidence.
- Production influence must remain disabled until separately validated and approved.
- Every output must be explainable and Constitution-compliant.

## Future Rollout Sequence

Recommended rollout:

1. Define this contract.
2. Build a standalone explanation-only prototype.
3. Add deterministic fixture tests for obvious capital-allocation cases.
4. Run offline validation against real listing snapshots.
5. Add Dalton review and agreement scoring.
6. Add shadow runtime visibility only after offline validation.
7. Add portfolio context and opportunity ranking.
8. Validate suggested offer and Maximum Buy Price.
9. Consider production display only after separate approval.

Production influence is explicitly out of scope for this phase.
