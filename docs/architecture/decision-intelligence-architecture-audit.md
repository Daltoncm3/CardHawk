# Decision Intelligence Architecture Audit

Phase 17.1A audits CardHawk's current decision-making pipeline and defines the architecture for a future Decision Intelligence subsystem.

This audit is documentation-only. It does not change `server.js`, Signals, Governance, Deal Gate, BUY_NOW, scoring, valuation, persistence, or runtime behavior.

## Executive Summary

CardHawk's current decision-making pipeline is reliable but fragmented. Production decisions are made through a combination of native valuation and scoring outputs, `engines/decisionEngine.js`, and the production Deal Gate implemented in `server.js`. The final production BUY_NOW boundary is still the Deal Gate. Signals, shadow valuation, Decision Intelligence, and Governance artifacts are currently evidence-only, offline-only, shadow-only, or explanation-only depending on their subsystem.

The Signal framework is now coverage-complete for the current architecture. It can explain identity, evidence, valuation, comparable quality, confidence, false-positive risk, Deal Gate diagnostics, and decision context without changing production behavior. Governance can bind, review, validate, and certify those artifacts offline, but it does not grant runtime authority.

The dominant architectural issue is not missing evidence. It is decision ownership. BUY_NOW-like language, confidence interpretation, evidence sufficiency checks, valuation trust checks, and explanation text appear in multiple layers:

- `engines/decisionEngine.js` produces a recommendation, decision score, confidence, warnings, blockers, and BUY_NOW-compatible aliases.
- `server.js` Deal Gate applies production hard rules and final BUY_NOW eligibility.
- `server.js` display helpers build production and evidence-readiness explanations.
- `engines/decisionIntelligenceEngine.js` produces explanation-only readiness and posture summaries.
- Signal migrations and Governance artifacts preserve offline evidence for review.

The future Decision Intelligence subsystem should centralize advisory decision synthesis, confidence interpretation, disagreement analysis, and explanation structure. It should not replace Deal Gate, weaken BUY_NOW safeguards, or consume authority from Signals. The safest next step is an offline immutable Decision Intelligence Contract, followed by a shadow-only builder that wraps existing native outputs without recomputation.

## Current Decision Flow

### Production Scout Flow

The current production path can be summarized as:

1. Scout scanner obtains a listing from the marketplace.
2. Parser and identity logic derive listing identity, grade, condition, and card attributes.
3. Native valuation, evidence, comparable, risk, population, and market intelligence components produce listing context.
4. `engines/decisionEngine.js` evaluates a weighted decision matrix and returns:
   - recommendation such as `BUY_NOW`, `STRONG_WATCH`, `WATCH`, `MONITOR`, or `PASS`
   - final score
   - evidence score
   - opportunity score
   - decision confidence
   - positives
   - warnings
   - blocking factors
   - BUY_NOW-compatible aliases
5. `server.js` applies the production Deal Gate through `dealGate(saved)`.
6. Deal Gate returns the production authoritative gate result:
   - `BUY_NOW` or `REJECT`
   - pass/approved aliases
   - BUY_NOW eligibility
   - rejection reasons
   - positives
   - structured rule breakdown
7. The saved listing receives Deal Gate and recommendation fields.
8. DecisionValidation records the production decision and outcome tracking metadata.
9. Notifications, dashboard views, and review tooling consume the saved production result.

The production BUY_NOW path is therefore final-gated in `server.js`, not in the Signal framework or Governance pipeline.

### Production Deal Gate Flow

The Deal Gate in `server.js` is a rule-based production authority layer. It checks:

- minimum sold-comparable count
- market confidence floor
- market intelligence score floor
- liquidity floor
- pricing reliability floor
- pricing reliability level
- risk level
- market trust
- market recommendation
- grade confidence consistency
- heuristic grade consistency
- estimated value support
- excessive ROI support
- fallback valuation support
- unknown condition support
- final score, profit, confidence, liquidity, pricing, trust, and risk thresholds

The Deal Gate returns both a human-readable decision and structured rule outcomes. It is intentionally defensive. BUY_NOW is treated as a high-priority scouting candidate for human review, not as an automated purchase command.

### Native Decision Engine Flow

`engines/decisionEngine.js` builds a decision matrix from:

- evidence strength
- pricing confidence
- investment quality
- risk
- market quality
- trend
- liquidity
- population scarcity
- expected profit
- ROI

It computes evidence, opportunity, and final scores, then assigns a recommendation. It also calculates decision confidence using component average, component spread, recommendation type, and blocking factors.

This engine is production-relevant, but it is not the final safety boundary. Its BUY_NOW-compatible aliases are later constrained by Deal Gate.

### Shadow Decision Intelligence Flow

`engines/decisionIntelligenceEngine.js` already resembles the future subsystem, but it is currently explanation-only. It consumes:

- evidence sufficiency
- listing similarity
- comparable quality
- valuation range
- supply pressure

It produces:

- evidence posture
- similarity posture
- quality posture
- comparable posture
- valuation posture
- resale pressure posture
- supporting signals
- caution signals
- blockers
- conflicts
- overall readiness
- summary

It explicitly marks recommendation impact as `none`. It does not change production decisions.

### Signal and Governance Flow

The Signal framework now covers the core decision-evidence families:

- Grade Premium
- Population Intelligence
- Listing Quality and Grading Diagnostics
- Range-First Valuation Diagnostics
- Confidence Calibration Diagnostics
- Deal Gate Diagnostics
- Evidence Readiness
- Identity Parser Diagnostics
- False-Positive Diagnostics
- Canonical Sold Evidence
- Production Valuation
- Comparable Quality
- Decision Context

All Signal artifacts are offline-only, shadow-only, immutable, deterministic, and non-authoritative. Governance artifacts register, validate, review, and certify these outputs offline. They do not recompute evidence, repair mismatches, approve production behavior, or change Deal Gate.

## Decision Ownership Map

| Decision or interpretation | Current owner | Runtime authority | Architectural assessment |
| --- | --- | --- | --- |
| Final production BUY_NOW eligibility | `server.js` Deal Gate | Production-authoritative | Must remain in Deal Gate until explicitly changed through Governance. |
| BUY_NOW as scanner recommendation label | `server.js` saved listing fields and display paths | Production-facing, human-action cue | Preserve as candidate/review signal, not automated purchase authority. |
| Weighted opportunity recommendation | `engines/decisionEngine.js` | Production input, not final authority | Candidate for future Decision Intelligence advisory synthesis. |
| Evidence strength scoring | `engines/decisionEngine.js`, evidence sufficiency, Signal artifacts | Mixed production input and offline evidence | Normalize into Decision Intelligence context without changing current users. |
| Pricing confidence and valuation trust | `engines/decisionEngine.js`, Deal Gate, valuation engines, Production Valuation Signal | Mixed production and offline evidence | Needs a single explanation model; authority stays with current production gates. |
| Sold evidence sufficiency | Deal Gate, evidence sufficiency, valuation range, canonical sold evidence | Production safety plus offline evidence | Minimum sold evidence rules should remain hard Deal Gate blockers. |
| Comparable quality | comparable quality engine and Signal | Evidence-only or production context input | Should become advisory/scoring input after governed validation, not hard authority by itself. |
| Identity eligibility and parser confidence | parser, canonical identity, identity Signals | Eligibility evidence | Should gate evidence trust; should not become a positive scoring boost without Governance. |
| False-positive risk | false-positive diagnostics Signal | Offline/shadow evidence | Advisory risk input; may inform future confidence and review prioritization. |
| Confidence calibration | confidence calibration Signal and outcome systems | Offline/shadow evidence | Should inform future Decision Intelligence confidence but not current BUY_NOW. |
| Decision explanation text | `server.js`, `decisionEngine`, `decisionIntelligenceEngine`, docs/reports | Presentation and review evidence | Should migrate to a structured explanation graph. |
| Governance readiness and certification | Phase 12-16 Governance modules | Offline non-authoritative | Remains separate from runtime decision-making. |

## Duplicated Decisions

### BUY_NOW-like Recommendation Surfaces

`engines/decisionEngine.js` can return `BUY_NOW`, `shouldBuy`, `buyNowAllowed`, `passed`, `approved`, and `pass`. `server.js` Deal Gate also returns these concepts. Display and review paths then present the resulting recommendation to Dalton.

This duplication is manageable because Deal Gate is the final authority, but it creates ambiguity about which layer owns the decision. Future Decision Intelligence should distinguish:

- advisory recommendation
- production gate outcome
- review recommendation
- notification eligibility
- purchase authority

### Evidence Sufficiency Thresholds

Minimum sold comp counts, usable comp counts, fallback pricing penalties, confidence floors, and pricing-spread limits appear in more than one place. `decisionEngine` uses them to score and block recommendations; Deal Gate uses them as hard safety rules; Evidence Readiness and Canonical Sold Evidence Signals preserve related offline context.

The thresholds should not be deduplicated into one runtime component yet. Instead, Decision Intelligence should make the overlap explicit through rule-to-signal tracing.

### Confidence Interpretation

Confidence is currently computed or interpreted by multiple systems:

- decision confidence in `decisionEngine`
- market confidence and pricing confidence in production inputs
- valuation range confidence
- shadow valuation confidence
- population confidence
- confidence calibration diagnostics
- Deal Gate confidence thresholds

Future Decision Intelligence needs a confidence layer that records what confidence means, what evidence it depends on, where it conflicts, and whether it is calibrated.

### Explanation Generation

Explanation logic exists in `decisionEngine` summaries, Deal Gate breakdowns, server display helpers, Signal reports, and Governance reports. These explanations are useful, but they are not yet organized as a single traceable explanation graph.

Decision Intelligence should produce a presentation-neutral explanation artifact that downstream review and UI systems can render without rebuilding reasoning.

## Heuristic Decisions

The following current decisions are heuristic:

- weighted decision matrix in `decisionEngine`
- final score cutoffs for `BUY_NOW`, `STRONG_WATCH`, `WATCH`, and `MONITOR`
- confidence calculation based on average component strength, component spread, recommendation type, and blocker count
- Deal Gate thresholds for confidence, market intelligence, liquidity, pricing, risk, and market trust
- valuation fallback and heuristic fallback support checks
- estimated-value-to-market-support checks
- excessive ROI support checks
- shadow Decision Intelligence posture thresholds

These heuristics are not inherently wrong. They are guardrails around imperfect evidence. The architecture issue is that heuristic ownership and explanation should be explicit, testable, and reviewable before any future change is promoted.

## Recommended Architecture

### Purpose

The Decision Intelligence subsystem should become CardHawk's advisory decision synthesis layer. It should explain why a listing looks attractive, risky, under-supported, overconfident, or blocked, while preserving the existing production authority boundary.

Decision Intelligence should answer:

- Is the identity trustworthy enough for valuation?
- Is the sold evidence sufficient?
- Are the comparables high quality?
- Is the valuation range reliable?
- Is the projected profit supported?
- Is confidence calibrated?
- Are false-positive risks present?
- Why did Deal Gate pass or reject?
- Where do production and shadow systems disagree?
- What evidence would change the decision?

It should not answer by changing production behavior. It should answer by producing immutable advisory artifacts.

### Layered Model

1. **Native Output Capture**

   Consume already-produced parser, identity, valuation, comparable quality, risk, Deal Gate, decision, and Signal outputs. Do not execute production engines from the offline contract.

2. **Decision Context Normalization**

   Normalize existing outputs into a canonical decision context:

   - listing identity
   - asking price and total cost
   - production valuation
   - valuation range
   - evidence sufficiency
   - comparable quality
   - identity confidence
   - false-positive risk
   - confidence calibration
   - production Deal Gate outcome
   - native decision engine output
   - shadow valuation and shadow decision context

3. **Advisory Decision Intelligence**

   Produce evidence-only synthesis:

   - advisory posture
   - evidence readiness
   - opportunity support
   - blocker summary
   - caution summary
   - confidence interpretation
   - disagreement summary
   - missing evidence summary
   - review focus

4. **Explanation Graph**

   Represent reasoning as traceable nodes:

   - evidence node
   - identity node
   - comparable node
   - valuation node
   - confidence node
   - Deal Gate rule node
   - blocker node
   - conflict node
   - recommendation node

   Each node should cite source artifact IDs and fingerprints.

5. **Governance Binding**

   Bind Decision Intelligence artifacts into Signal Governance Evidence Bundles, Governance Review Reports, Review Packages, Review Sessions, and Workspace summaries. Governance remains evidence-only until an explicit Production Proposal, Dalton approval, implementation, validation, and deployment path is completed.

### Authority Boundary

Decision Intelligence must start with:

- `productionImpact: "none"`
- `decisionImpact: "none"`
- `executionAuthority: "none"`

All current Signal authority boundaries should apply. The subsystem may observe and explain Deal Gate. It must not override Deal Gate, weaken Deal Gate, or grant BUY_NOW authority.

## What Should Migrate Into Decision Intelligence

The following should migrate, wrapper-first and offline/shadow first:

- `decisionEngine` scoring matrix as an advisory scoring lens.
- `decisionEngine` blockers, positives, warnings, and summaries as explanation nodes.
- Shadow `decisionIntelligenceEngine` posture logic as the seed for a formal Decision Intelligence context.
- Server-side explanation helpers as presentation-neutral explanation artifacts.
- Decision Context Signal outputs as primary evidence references.
- Deal Gate diagnostics as observed production decision evidence.
- Confidence Calibration, False-Positive, Evidence Readiness, Comparable Quality, Production Valuation, Canonical Sold Evidence, and Identity Parser Signals as advisory context.

Migration should preserve existing outputs and APIs. Existing consumers should continue using native outputs until a governed production change explicitly replaces them.

## What Should Remain Inside Deal Gate

The Deal Gate should retain:

- final production BUY_NOW eligibility
- minimum sold evidence requirements
- hard blockers for active-only or fallback-only evidence
- confidence floors
- liquidity and pricing safety floors
- risk-level blockers
- market trust and market recommendation blockers
- grade/condition consistency safeguards
- excessive ROI support safeguards
- final production rule breakdown

These rules are safety boundaries, not merely explanatory features. They should not migrate out of Deal Gate until there is offline review evidence, calibration evidence, successful offline experiments, successful shadow experiments, a Production Proposal, explicit Dalton approval, implementation, validation, deployment, and monitoring.

## What Should Remain Evidence-Only

The following should remain evidence-only:

- all canonical Signal artifacts
- all Signal shadow comparisons
- all Governance Evidence Bundles
- all Governance Review Reports
- all Review Package bindings
- all Governance Registry, Lifecycle, Session, Workspace, and Pipeline artifacts
- shadow valuation
- shadow Decision Intelligence
- calibration datasets and recommendations
- offline and shadow experiment artifacts

These systems may inform future proposals. They must not directly alter production decisions.

## Signal Role Recommendations

### Advisory Now

All current Signal families should remain advisory now:

- Grade Premium
- Population Intelligence
- Listing Quality and Grading Diagnostics
- Range-First Valuation Diagnostics
- Confidence Calibration Diagnostics
- Deal Gate Diagnostics
- Evidence Readiness
- Identity Parser Diagnostics
- False-Positive Diagnostics
- Canonical Sold Evidence
- Production Valuation
- Comparable Quality
- Decision Context

### Candidate Future Scoring Inputs

The strongest candidates for future Decision Intelligence scoring inputs are:

- Evidence Readiness
- Canonical Sold Evidence
- Comparable Quality
- Production Valuation
- Range-First Valuation
- Confidence Calibration
- False-Positive Diagnostics
- Decision Context

These should become scoring inputs only inside the advisory Decision Intelligence layer first. Any production use requires Governance promotion.

### Candidate Eligibility Inputs

The strongest candidate eligibility inputs are:

- Identity Parser Diagnostics
- Listing Quality and Grading Diagnostics
- Canonical Sold Evidence
- Evidence Readiness

These should primarily influence evidence trust and blocker explanation. They should not create upside by themselves.

### Signals That Should Not Become Direct Scoring Inputs

Deal Gate Diagnostics should not feed back into Deal Gate as a scoring input. It should remain an audit and parity signal for explaining what production did.

Governance artifacts should not become scoring inputs. They validate evidence and approval chains.

## Missing Intelligence Layers

### Canonical Decision Context Contract

CardHawk needs an immutable contract that binds native decision outputs, Deal Gate outcomes, Signal artifacts, shadow outputs, and review metadata into one decision context without recomputing them.

### Decision Explanation Graph

The system needs a structured explanation graph that connects evidence to conclusions. This would make it clear which evidence supports valuation, which evidence blocks BUY_NOW, and which conflicts require Dalton review.

### Confidence Interpretation Layer

Confidence should be decomposed into:

- identity confidence
- evidence confidence
- valuation confidence
- comparable confidence
- confidence calibration
- decision confidence
- confidence contradiction or overconfidence risk

### Decision Disagreement Layer

CardHawk needs a standard artifact for production versus shadow disagreements:

- Deal Gate versus Decision Intelligence posture
- production valuation versus range-first valuation
- production confidence versus calibration diagnostics
- comparable quality versus sold evidence sufficiency
- BUY_NOW outcome versus false-positive risk

### Review Feedback Loop

Dalton review outcomes, DecisionValidation, PredictionAccuracy, resale outcomes, and calibration datasets should eventually feed offline Decision Intelligence evaluation. This should remain governed and non-authoritative until explicitly promoted.

### Rule-to-Signal Trace

Deal Gate rules should be traceable to the evidence and Signal artifacts that support or challenge them. This trace should explain, not replace, Deal Gate.

## Migration Strategy

### Phase 17.1B - Decision Intelligence Contract

Create an immutable offline-only contract for Decision Intelligence artifacts. The contract should define:

- schema version
- decision intelligence ID
- source listing reference
- native decision reference
- Deal Gate reference
- Signal evidence references
- valuation references
- shadow references
- advisory posture
- blockers
- cautions
- supporting evidence
- conflicts
- missing evidence
- confidence interpretation
- explanation references
- fingerprints
- `productionImpact: "none"`
- `decisionImpact: "none"`
- `executionAuthority: "none"`

No runtime integration should occur in this phase.

### Phase 17.1C - Offline Decision Context Builder

Build an offline builder that accepts already-produced native outputs and Signal artifacts, validates bindings, and creates immutable Decision Intelligence context artifacts. It should not execute production engines.

### Phase 17.2A - Decision Explanation Graph

Create the explanation graph contract and builder. This should turn existing reasons, warnings, blockers, Deal Gate rules, and Signal evidence into traceable review nodes.

### Phase 17.2B - Decision Confidence Calibration Report

Create an offline report that compares decision confidence against review outcomes, PredictionAccuracy, DecisionValidation, and Confidence Calibration Signals.

### Phase 17.3A - Shadow Decision Intelligence Runner

Run Decision Intelligence beside production using captured outputs only. It should report disagreement and evidence gaps, not modify production behavior.

### Phase 17.4A - Governance Binding

Bind Decision Intelligence artifacts into the Phase 15 and Phase 16 Governance pipeline as evidence inputs for review readiness and certification readiness.

### Phase 17.5A - Production Proposal Candidate

Only after sufficient reviewed evidence and successful shadow evaluation, create a Production Proposal candidate. This phase should still not implement production changes.

## Risks

1. **Authority leakage**

   Signal or shadow outputs could be mistaken for production decisions. All new artifacts must fail closed with no production, decision, or execution authority.

2. **Deal Gate weakening**

   Moving logic into Decision Intelligence too early could weaken hard safety rules. Deal Gate should remain authoritative.

3. **Recommendation ambiguity**

   Multiple layers may emit BUY_NOW-like language. Future contracts should distinguish advisory posture, production gate outcome, notification eligibility, review recommendation, and purchase authority.

4. **Overfitting to reviewed examples**

   Review outcomes are valuable but limited. Calibration should remain offline until enough evidence supports a governed change.

5. **Evidence contamination**

   Active listings must not become sold evidence. Decision Intelligence should preserve the current separation between active market context and sold-evidence authority.

6. **Large `server.js` rewrite**

   The future subsystem should be additive and modular. Avoid a broad `server.js` rewrite.

7. **Explanation drift**

   If explanation logic is copied into another module without source references, it may drift from Deal Gate. Explanation graph nodes should cite source artifacts and fingerprints.

## Compatibility Guarantees

Future Decision Intelligence work should guarantee:

- no changes to production Deal Gate behavior
- no changes to BUY_NOW behavior
- no changes to scanner flow
- no changes to parser, identity, valuation, notification, marketplace, persistence, or configuration behavior
- no changes to existing Signal outputs
- no changes to existing Governance authority boundaries
- no changes to persisted production formats
- no replacement of native outputs
- wrapper-first migration only
- deterministic fingerprints for all new artifacts
- explicit unknown values
- immutable offline artifacts
- full Phase 12 Governance chain before any production authority change

## Recommended Implementation Phases

1. **Phase 17.1B - Decision Intelligence Contract**

   Implement the immutable offline-only contract for Decision Intelligence artifacts.

2. **Phase 17.1C - Decision Context Builder**

   Build offline Decision Intelligence context from existing outputs and Signal references.

3. **Phase 17.2A - Decision Explanation Graph**

   Define and build traceable explanation nodes from existing production and Signal evidence.

4. **Phase 17.2B - Decision Confidence Calibration Report**

   Compare confidence claims against reviewed outcomes and calibration evidence.

5. **Phase 17.3A - Shadow Decision Intelligence Evaluation**

   Evaluate advisory Decision Intelligence beside production without changing production behavior.

6. **Phase 17.4A - Governance Integration**

   Bind Decision Intelligence artifacts into review packages, evidence bundles, reports, sessions, workspaces, and pipeline validation.

7. **Phase 17.5A - Production Proposal Preparation**

   Create proposal artifacts only if offline and shadow evidence support a concrete change.

## Final Recommendation

Proceed with **Phase 17.1B - Decision Intelligence Contract**.

The phase should be offline-only and immutable. It should define the artifact that future builders and review systems will use, but it should not execute engines, recompute scores, alter Deal Gate, change BUY_NOW, change valuation, or integrate with production runtime.

The architectural goal is to make CardHawk's decision reasoning explainable, governed, and reviewable before any production decision behavior changes.

## Final Confirmation

- No runtime code should be changed by this audit.
- `server.js` should remain unchanged.
- Signal migrations and shadow comparisons should remain unchanged.
- Governance logic should remain unchanged.
- Deal Gate should remain unchanged.
- BUY_NOW should remain unchanged.
- No production behavior should change.
- No commit should be created.
