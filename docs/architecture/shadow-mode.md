# Shadow Mode Architecture

This document defines the proposed Shadow Mode architecture for Decision Intelligence. It is architecture and documentation only. It does not change runtime behavior.

## Objectives

Shadow Mode allows Decision Intelligence to observe live CardHawk scan evaluations without influencing production behavior.

The goals are:

- Capture Decision Intelligence explanations beside live scan context.
- Compare Decision Intelligence output against existing production outcomes.
- Validate agreement with expert dealer review before any runtime influence.
- Detect false positives, false negatives, overconfidence, underconfidence, and recurring disagreement patterns.
- Preserve all current production behavior while the intelligence layer learns from real scan context.

Shadow Mode is explanation-only. `recommendationImpact` must remain `"none"`.

## Runtime Data Flow

The intended future flow is:

1. Marketplace scanner finds listings.
2. Existing scoring pipeline evaluates each listing.
3. Existing Market Intelligence produces evidence-only fields.
4. Existing Deal Gate, recommendations, alerts, and persistence continue unchanged.
5. Shadow Mode receives a copy of the already-produced evidence context.
6. Decision Intelligence evaluates that copied evidence context.
7. Shadow Mode records an offline/passive observation for later validation.

Shadow Mode must observe outputs that already exist. It must not request marketplace data, re-run live scans, mutate listing records, or alter scoring inputs.

## Attachment Point

The safest future attachment point is after the existing scan evaluation has produced Market Intelligence evidence and before or alongside passive validation logging.

Decision Intelligence should consume only existing evidence-only outputs, including:

- `evidenceSufficiency`
- `listingSimilarity` when available
- `comparableQuality`
- `valuationRange`
- `supplyPressure`

The hook should not sit inside Deal Gate decision logic. It should not feed values into scoring, recommendation, alert, or notification paths.

## Required Inputs

Shadow Mode requires a copied, read-only input object:

- listing identity and title
- current listing price and marketplace metadata
- existing Market Intelligence evidence fields
- existing Deal Gate result for comparison only
- existing recommendation label for comparison only
- timestamp and scan context

Inputs that are missing should degrade safely to `unknown`, `not_ready`, or empty evidence according to existing Decision Intelligence behavior.

## Expected Outputs

Shadow Mode should produce an observation record containing:

- listing ID
- scan ID or timestamp when available
- `overallReadiness`
- `evidencePosture`
- `compPosture`
- `valuationPosture`
- `resalePressurePosture`
- `supportingSignals`
- `cautionSignals`
- `blockers`
- `conflicts`
- `summary`
- `recommendationImpact: "none"`
- optional comparison metadata against existing recommendation/gate output

It must never output or persist a production recommendation such as BUY_NOW or PASS as its own decision.

## Logging Strategy

Initial logging should be passive and append-only.

Recommended properties:

- Use a dedicated Shadow Mode log namespace or file.
- Keep records compact enough for repeated scans.
- Avoid secrets, credentials, auth headers, and notification payloads.
- Include enough listing metadata for review without requiring live API lookups.
- Record errors as Shadow Mode errors only.

Logs should support downstream offline tools:

- export workflow
- Decision Intelligence validation
- dealer agreement scoring
- confidence calibration

## Storage Strategy

No persistence changes are approved in Phase 3.1A.

Future storage, if approved, should be isolated from the main production store. Preferred direction:

- separate file under `data/` only after explicit approval
- append-only observations
- bounded retention or rotation
- no mutation of `store.listings`
- no storage-key migration

Until storage is explicitly approved, Shadow Mode architecture should be treated as design-only.

## Performance Considerations

Shadow Mode must be cheap enough to run during scans without affecting scan timing.

Constraints:

- no network calls
- no marketplace calls
- no expensive recomputation of comps
- no blocking writes on the critical scan path unless explicitly approved
- graceful timeout or failure isolation if a future logger is introduced

Decision Intelligence should consume already-computed evidence instead of duplicating valuation or comp calculations.

## Failure Handling

Shadow Mode failure must never fail a scan.

Required behavior:

- catch all Shadow Mode evaluation errors
- record local Shadow Mode warning/error if logging is approved
- return control to the existing scan pipeline
- do not alter listing save behavior
- do not alter Deal Gate outcome
- do not alter alerts or notifications

If required evidence is missing, the output should be safe and explicit rather than throwing.

## Safety Guarantees

Shadow Mode must guarantee:

- explanation-only output
- `recommendationImpact` remains `"none"`
- no BUY_NOW changes
- no Deal Gate changes
- no scoring changes
- no recommendation changes
- no notification changes
- no alert behavior changes
- no scan timing changes
- no persistence changes until explicitly approved
- no marketplace calls
- no mutation of production listing objects
- no storage-key changes

Any future change that violates these guarantees is outside Shadow Mode and requires separate approval.

## Phased Rollout Plan

### 3.1A Architecture

Create the Shadow Mode architecture specification.

Status: documentation only.

Allowed:

- architecture documentation
- safety requirements
- rollout plan

Forbidden:

- runtime hook
- persistence
- logging implementation
- behavior changes

### 3.1B Runtime Hook

Introduce a minimal hook point that can call Decision Intelligence with copied evidence.

Requirements:

- no behavior changes
- no Deal Gate integration
- no scoring integration
- no recommendation integration
- no notification integration
- no persistence unless separately approved
- failure-isolated

### 3.1C Passive Logging

Add passive Shadow Mode observation logging after explicit approval.

Requirements:

- separate storage or log destination
- append-only behavior
- bounded retention plan
- no mutation of production listing records
- no alert or notification behavior changes

### 3.1D Shadow Validation

Run offline validation against Shadow Mode observations.

Goals:

- compare Decision Intelligence explanations against dealer review
- measure dealer agreement
- measure confidence calibration
- identify recurring mismatch patterns

### 3.2 Long-Term Comparison

Track Decision Intelligence against production outcomes over time.

Examples:

- agreement with expert dealer labels
- disagreement with existing Deal Gate
- false positive / false negative patterns
- confidence calibration drift
- recurring evidence gaps

This remains reporting-only.

### 3.3 Decision Influence (Future)

Decision Intelligence may only influence decisions after separate approval.

Before any signal can affect BUY_NOW, Deal Gate, scoring, or recommendations:

- Shadow Mode evidence must show sustained dealer agreement.
- False positive and false negative rates must be reviewed.
- Confidence calibration must be acceptable.
- Failure handling must be proven safe.
- Runtime performance must be measured.
- The exact decision-eligible fields must be approved.
- Tests must prove existing thresholds and safety behavior are preserved.

This phase is explicitly future work and is not approved by this document.
