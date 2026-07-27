# Governance Pipeline Validator

## Purpose

The Governance Pipeline Validator is an offline-only integrity checker for CardHawk's Phase 12 governance chain. It validates that existing artifacts are complete, bound to each other by exact IDs and fingerprints, current, evidence-backed, and authority-safe.

The validator does not create, modify, approve, reject, implement, deploy, execute, or configure anything. It only reports whether an already-existing chain is internally consistent enough to progress to the next governance review step.

## Supported Artifacts

The validator accepts:

- Real Listing Decision Review package
- Real Listing Review batch
- Dalton Review Workspace
- Calibration Dataset
- Calibration Recommendation
- Offline Calibration Experiment
- Offline Experiment Result
- Shadow Experiment
- Shadow Result
- Production Proposal
- Production Approval Artifact
- Deployment Validation Artifact

Each artifact remains owned by its original contract. The validator delegates artifact-level validation and fingerprint checks to the existing modules wherever they are available.

## Validation Flow

Validation runs in deterministic phases:

1. Check required artifacts exist.
2. Run each artifact's own validator.
3. Validate cross-artifact ID and fingerprint bindings.
4. Validate lifecycle states.
5. Validate authority boundaries.
6. Validate fingerprint chain.
7. Validate audit-history ordering and authority flags.
8. Validate expiration.
9. Validate supersession.
10. Validate required evidence.
11. Determine pipeline readiness.

No phase mutates artifacts or recomputes production decisions.

## Readiness States

The validator returns one of four readiness states:

- `valid`: all required artifacts exist and no blocking violations were found.
- `incomplete`: one or more required artifacts are missing.
- `blocked`: artifacts exist, but lifecycle, expiration, supersession, or evidence gaps prevent progression.
- `invalid`: binding, authority, fingerprint, audit-history, or local validation failures make the chain internally inconsistent.

Readiness is descriptive only. A `valid` pipeline does not authorize deployment.

## Validation Categories

The structured result includes:

- `missingArtifacts`
- `bindingViolations`
- `lifecycleViolations`
- `authorityViolations`
- `expirationViolations`
- `supersessionViolations`
- `fingerprintViolations`
- `auditHistoryViolations`
- `evidenceViolations`

Every failure includes a reason code, artifact name, field path, and message.

## Authority Boundaries

All governance artifacts must remain evidence-only. The validator recursively checks that any present authority fields preserve:

- `productionImpact: "none"`
- `decisionImpact: "none"`
- `executionAuthority: "none"`

The validator never changes scanner behavior, scoring, valuation, Deal Gate, BUY_NOW, notifications, persistence, thresholds, weights, rules, confidence, recommendations, configuration, deployment behavior, or production authority.

## Fingerprint And Provenance Chain

The validator checks local fingerprint fields and cross-artifact references:

- review batch entries reference review package fingerprints,
- workspaces reference review batch fingerprints,
- datasets reference workspace and batch IDs,
- recommendations reference dataset IDs and fingerprints,
- offline experiments reference recommendation IDs and fingerprints,
- offline results reference experiment, dataset, and recommendation evidence,
- shadow experiments reference offline experiment evidence,
- shadow results reference shadow experiment IDs,
- production proposals reference recommendation, offline experiment, shadow experiment, and shadow result evidence,
- approvals bind to production proposals,
- deployment validation artifacts bind to proposals and approvals.

Missing or mismatched fingerprints are treated as invalid chain evidence.

## Audit History

Audit histories remain artifact-local, but the validator checks deterministic ordering and authority fields for any artifact that exposes `auditHistory`.

Future lifecycle reporting may produce a single chronological chain across all artifacts. That report should consume this validator rather than duplicating integrity logic.

## Expiration And Supersession

Expiration checks ensure current proposal, approval, and deployment validation evidence has not aged out relative to the supplied `asOf` timestamp.

Supersession checks block pipelines that include superseded, superseding, or manually linked replacement artifacts until the operator explicitly validates the replacement chain.

## Public API

`validation/governancePipelineValidator.js` exports:

- `validateGovernancePipeline`
- `validateArtifactBindings`
- `validateLifecycleStates`
- `validateAuthorityBoundaries`
- `validateFingerprintChain`
- `validateAuditHistoryChain`
- `validateExpirationChain`
- `validateSupersessionChain`
- `validateRequiredEvidence`
- `determinePipelineReadiness`
- `summarizeGovernancePipeline`
- `buildGovernancePipelineFingerprint`

## Future Report Integration

Future modules should build on this validator:

- `governancePipelineReport`
- `governanceIntegrityAudit`
- `governanceArtifactRegistry`
- `governanceLifecycleReport`

Those modules may format, store, or compare validation results, but they should not reimplement binding or authority checks.
