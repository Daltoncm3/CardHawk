# Decision Intelligence Pipeline Orchestrator

## Purpose

The Decision Intelligence Pipeline Orchestrator is an offline-only coordinator for the Decision Intelligence evidence flow. It turns already-generated CardHawk evidence into an immutable Evidence Bundle, validates that bundle, builds the advisory Decision Intelligence Artifact, validates and conforms that artifact, and emits a deterministic pipeline report.

The orchestrator does not execute production engines, recompute Signals, recompute valuation, modify Deal Gate, modify BUY_NOW, approve purchases, send notifications, or change runtime state.

## Public API

- `runDecisionIntelligencePipeline(input, options)`
- `validateDecisionIntelligencePipeline(run)`
- `buildDecisionIntelligencePipelineReport(run)`
- `summarizeDecisionIntelligencePipeline(run)`
- `compareDecisionIntelligencePipelineRuns(left, right)`

## Pipeline Flow

1. Build a Decision Intelligence Evidence Bundle from supplied references.
2. Validate the Evidence Bundle.
3. Build the Decision Intelligence Artifact from `evidenceBundle.builderInput`.
4. Validate the Decision Intelligence Artifact.
5. Run Decision Intelligence Artifact conformance validation.
6. Build a deterministic pipeline report.
7. Return one immutable pipeline run containing all source artifacts, validations, summaries, diagnostics, and fingerprints.

## Pipeline Run Shape

Pipeline runs contain:

- `schemaVersion`
- `source`
- `runId`
- `createdAt`
- `evidenceBundle`
- `evidenceBundleValidation`
- `evidenceBundleSummary`
- `decisionArtifact`
- `artifactValidation`
- `artifactSummary`
- `artifactConformance`
- `conformanceSummary`
- `pipelineReport`
- `productionImpact: "none"`
- `decisionImpact: "none"`
- `executionAuthority: "none"`
- `pipelineFingerprint`

## Pipeline Report

The report records:

- Evidence Bundle identity and fingerprint.
- Decision Intelligence Artifact identity and fingerprint.
- Artifact conformance identity and fingerprint.
- Stage results for bundle building, bundle validation, artifact building, artifact validation, and artifact conformance.
- Pipeline diagnostics including stage counts, evidence gaps, unknown values, Signal reference count, and governance readiness flags.
- Aggregated errors, warnings, and reason codes.
- Non-authoritative boundary fields.
- A deterministic `reportFingerprint`.

## Determinism And Immutability

The orchestrator freezes returned pipeline runs, reports, validations, summaries, and nested artifacts. Repeated calls with identical inputs produce identical outputs and fingerprints. Comparison helpers preserve both sides unchanged and return deterministic mismatch evidence.

## Evidence Preservation

The orchestrator preserves:

- Evidence gaps.
- Unknown values.
- Bundle provenance.
- Signal references.
- Valuation references.
- Deal Gate observations.
- BUY_NOW observations.
- Governance references.
- Artifact fingerprints and conformance fingerprints.

Missing or invalid evidence remains visible in validation diagnostics. The orchestrator never repairs evidence, fills unknowns, or converts missing references into defaults.

## Authority Boundaries

All pipeline outputs preserve:

- `productionImpact: "none"`
- `decisionImpact: "none"`
- `executionAuthority: "none"`

Deal Gate and BUY_NOW data are observations only. The pipeline report may indicate review readiness or governance-binding readiness, but it never authorizes a purchase, notification, production change, deployment, or runtime behavior.

## Governance Compatibility

Pipeline reports are designed for future Governance review. They bind the Evidence Bundle, Decision Intelligence Artifact, and conformance report by ID and fingerprint so downstream Governance artifacts can consume them without recomputing underlying evidence.

## Non-Goals

- No production runtime integration.
- No scanner integration.
- No Signal execution.
- No valuation execution.
- No Deal Gate or BUY_NOW changes.
- No persistence changes.
- No recommendation authority.
- No production approval.
