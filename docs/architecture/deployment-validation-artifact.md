# Deployment Validation Artifact

## Purpose

The Deployment Validation Artifact is an offline-only governance record for CardHawk production proposals that have already received an explicit production approval artifact. It records whether the implemented proposal has completed required validation evidence before a separate deployment workflow may be considered.

The artifact is evidence-only. It never performs validation, applies configuration, deploys code, changes thresholds, changes recommendations, or grants production authority.

## Public API

`validation/deploymentValidationArtifact.js` exports:

- `createDeploymentValidationArtifact`
- `validateDeploymentValidationArtifact`
- `cloneDeploymentValidationArtifact`
- `verifyProposalApprovalBinding`
- `determineDeploymentValidationStatus`
- `supersedeDeploymentValidationArtifact`
- `expireDeploymentValidationArtifact`
- `summarizeDeploymentValidationArtifact`
- `exportDeploymentValidationArtifact`
- `importDeploymentValidationArtifact`
- `buildDeploymentValidationFingerprint`
- `buildDeploymentValidationBatchFingerprint`

Each helper is offline-only and works with already-created governance artifacts. The module does not import production runtime code, deployment code, engines, scanner code, marketplace adapters, or server integration.

## Schema

Each artifact preserves:

- `schemaVersion`
- `validationArtifactId`
- `proposalId`
- `proposalFingerprint`
- `approvalId`
- `approvalFingerprint`
- `createdAt`
- `completedAt`
- `expiresAt`
- `validationStatus`
- `validationChecklistResults`
- `requiredTestResults`
- `regressionSummary`
- `monitoringReadiness`
- `rollbackReadiness`
- `deploymentPrerequisitesSatisfied`
- `outstandingIssues`
- `evidenceReferences`
- `validationNotes`
- `auditHistory`
- `productionImpact: "none"`
- `decisionImpact: "none"`
- `executionAuthority: "none"`
- `validationFingerprint`

Unknown or missing facts are preserved explicitly as `unknown` or empty evidence collections. The contract does not infer successful validation from missing records.

## Validation Lifecycle

Deployment validation artifacts use explicit statuses:

- `drafted`
- `in_progress`
- `passed`
- `failed`
- `blocked`
- `expired`
- `superseded`
- `archived`

The status records the evidence state only. A `passed` validation artifact means the offline validation evidence has been recorded and bound to the correct proposal and approval artifacts. It does not authorize deployment.

## Proposal And Approval Binding

`verifyProposalApprovalBinding` checks that:

- the artifact proposal ID matches the supplied proposal,
- the artifact proposal fingerprint matches the supplied proposal,
- the artifact approval ID matches the supplied approval,
- the artifact approval fingerprint matches the supplied approval,
- the approval is bound to the same proposal,
- the approval decision is `approved_for_implementation`,
- the proposal and approval have not expired, been superseded, revoked, or archived.

Binding failures are returned as structured validation errors. The module reuses the existing Production Proposal Contract and Production Approval Artifact validators rather than duplicating their authority rules.

## Authority Boundaries

Deployment validation artifacts preserve the CardHawk governance chain:

Production -> Offline Review -> Calibration Dataset -> Recommendation -> Offline Experiment -> Shadow Experiment -> Production Proposal -> Explicit Dalton Approval -> Code or Configuration Change -> Validation Evidence -> Deployment Consideration

The artifact does not skip any step. It always preserves:

- `productionImpact: "none"`
- `decisionImpact: "none"`
- `executionAuthority: "none"`

Evidence references must also remain evidence-only. Any drift from those boundaries is reported as an authority-boundary violation.

## Audit History

Audit events are normalized, sorted deterministically, and included in the artifact fingerprint. Events preserve actor, timestamp, prior status, next status, reason, and details while retaining the same evidence-only authority flags.

Lifecycle transitions are validated so that archived artifacts cannot return to active states and superseded or expired artifacts remain review records.

## Expiration And Supersession

Expiration is explicit. `expireDeploymentValidationArtifact` returns a new immutable artifact with updated status and audit history. Expiration timestamps cannot precede artifact creation or completion.

Supersession is also explicit. `supersedeDeploymentValidationArtifact` returns a new immutable artifact linked to the newer validation artifact. Self-supersession and invalid supersession chains are rejected.

## Future Integration

Future deployment workflow modules may consume these artifacts as evidence, but deployment remains a separate explicit step. This contract intentionally avoids runtime integration, deployment execution, production configuration changes, and automatic authority escalation.
