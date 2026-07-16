# Shadow-to-Production Promotion Governance

## Status

Phase 10.8 adds a standalone offline governance framework for assessing whether a shadow diagnostic or intelligence component is mature enough to be considered for a future production promotion path.

The framework is documentation- and validation-driven. It does not promote anything by itself.

## Module

`validation/shadowPromotionGovernance.js`

Public helpers:

- `assessShadowPromotionCandidate`
- `buildShadowPromotionAssessmentFingerprint`
- `summarizeShadowPromotionAssessment`

Exported constants:

- `PROMOTION_READINESS_STATUS`
- `AUTHORITY_LEVEL`
- `RECOMMENDED_ACTION`
- `SHADOW_PROMOTION_GOVERNANCE_SCHEMA_VERSION`
- `SHADOW_PROMOTION_GOVERNANCE_SOURCE`
- `UNKNOWN_VALUE`

## Assessment Inputs

A promotion candidate is assessed from supplied governance evidence only:

- candidate identity and version
- current authority level
- proposed authority level
- contract completeness
- deterministic fixture coverage
- focused test coverage
- full regression status
- real-listing validation results
- operator or dealer agreement
- false-positive rate
- missed-opportunity rate
- confidence calibration
- shadow observation period
- production comparison results
- documented failure modes
- rollback readiness
- feature-flag readiness
- release approval
- production-boundary review

Missing facts remain missing. The framework does not infer validation success from module existence, test names, fixture presence, or architecture completeness.

## Readiness States

- `draft`: required candidate identity or authority facts are missing.
- `blocked`: a hard governance blocker exists.
- `insufficient_evidence`: the candidate has only contract, fixture, or unit-test style evidence and lacks real-world validation evidence.
- `ready_for_extended_shadow`: core evidence exists, but extended shadow, comparison, calibration, or review evidence is still missing.
- `ready_for_release_review`: validation evidence is complete enough to request release review, but release approval has not been granted.
- `approved_for_limited_production_trial`: required validation, rollback, feature-flag, release, and boundary-review evidence are supplied for a future operator-reviewed limited trial plan.
- `rejected`: the candidate is explicitly rejected.

## Non-Promotion Rule

`approved_for_limited_production_trial` is not production promotion.

It means only that the supplied governance package is sufficient to prepare a future operator-reviewed limited trial plan. A separate implementation and release decision would still be required before any production authority changes.

Every assessment includes:

- `promotionHasOccurred: false`
- `productionImpact: "none"`
- `decisionImpact: "none"`
- offline authority flags that deny production approval and promotion authority
- an explicit production authority statement

## Blocking Rules

The framework blocks or withholds readiness when:

- candidate identity or version is missing
- current or proposed authority is missing
- direct production-authority promotion is requested
- contract completeness is not satisfied
- full regression evidence is present but failing
- rollback readiness is not satisfied
- feature-flag readiness is not satisfied
- production-boundary review is not approved
- documented failure modes are missing
- release approval is missing after other evidence is complete

No candidate may pass based only on unit tests, deterministic fixtures, or architecture completeness.

## Evidence Rules

Real-world readiness requires supplied evidence from:

- real-listing validation
- operator or dealer agreement
- confidence calibration
- shadow observation
- production comparison

False-positive and missed-opportunity rates are summarized when supplied. They are not invented.

## Production Boundaries

This framework does not alter:

- `server.js`
- production scoring
- Deal Gate
- `BUY_NOW`
- valuation
- ROI
- confidence thresholds
- notifications
- marketplace behavior
- scan timing
- any shadow component's actual authority

It is offline and operator-driven.

## Repository Notes

The repository currently exposes dealer agreement scoring through `validation/dealerAgreementScorer.js`; the Phase 10.8 prompt referred to `validation/dealerAgreementScoring.js`. The promotion framework consumes supplied agreement summaries and does not require a direct import from either module.
