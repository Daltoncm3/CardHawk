# Production Approval Artifact

Phase 12.5D adds the immutable offline-only Production Approval Artifact.

## Purpose

The artifact records Dalton's explicit human decision regarding an immutable Production Proposal. It may document approval for implementation planning, rejection, requested revision, deferral, or cancellation.

The artifact does not execute, apply, activate, deploy, authorize, or implement a production change at runtime.

## Public API

The module is `validation/productionApprovalArtifact.js`.

Primary helpers:

- `createProductionApprovalArtifact(input, options)`
- `validateProductionApprovalArtifact(approvalArtifact, options)`
- `cloneProductionApprovalArtifact(approvalArtifact)`
- `verifyProductionProposalBinding(approvalArtifact, proposal, options)`
- `determineProductionApprovalStatus(approvalArtifact)`
- `supersedeProductionApprovalArtifact(approvalArtifact, supersession, options)`
- `revokeProductionApprovalArtifact(approvalArtifact, revocation, options)`
- `summarizeProductionApprovalArtifact(approvalArtifact, proposal)`
- `exportProductionApprovalArtifact(approvalArtifact, outputPath)`
- `importProductionApprovalArtifact(input)`
- `buildProductionApprovalFingerprint(approvalArtifact)`
- `buildProductionApprovalBatchFingerprint(batch)`

The module also exports schema, source, decision, status, transition, unknown-value, and required-field constants.

## Schema

A production approval artifact contains:

- schema and source metadata
- approval ID
- bound proposal ID, fingerprint, and batch ID
- creation, decision, and expiration timestamps
- approved-by identity and approver role
- approval decision
- approval status
- approved and excluded scope
- conditions
- required changes
- implementation constraints
- validation requirements
- test requirements
- deployment prerequisites
- monitoring requirements
- rollback requirements
- rationale and notes
- supersession identifiers
- revocation timestamp and reason
- audit history
- `productionImpact: "none"`
- `decisionImpact: "none"`
- `executionAuthority: "none"`
- deterministic approval fingerprint

Unknown values remain explicit. Missing metadata is not inferred from proposal status, evidence quality, fingerprints, or artifact existence.

## Approval Decisions

Supported decisions:

- `approved_for_implementation`
- `rejected`
- `revision_required`
- `deferred`
- `cancelled`

Unsupported decisions fail validation.

## Approval Statuses

Supported statuses:

- `drafted`
- `final`
- `expired`
- `superseded`
- `revoked`
- `archived`

Statuses are governance states only. They do not grant runtime authority.

## Explicit Dalton Approval Boundary

For `approved_for_implementation`, validation requires:

- `approvedBy: "Dalton"`
- explicit human production-owner role
- explicit `decidedAt`
- proposal ID
- proposal fingerprint
- explicit approved scope
- explicit conditions array, including an empty array when no conditions exist
- explicit validation requirements
- explicit rollback requirements
- explicit monitoring requirements

The artifact does not generate approval automatically. Approval cannot be inferred from proposal status, test results, evidence quality, or artifact fingerprints.

## Proposal Binding

`verifyProductionProposalBinding` checks:

- approval proposal ID matches the proposal ID
- approval proposal fingerprint matches the proposal fingerprint
- proposal validates through `productionProposalContract`
- proposal fingerprint matches proposal contents
- proposal is not expired, superseded, or archived
- proposal authority boundaries remain intact
- approved scope does not exceed proposal scope

Binding returns structured results and does not mutate either artifact.

## Scope Handling

Approved scope may constrain the proposal category, affected subsystem, and affected rule or field. Scope that conflicts with the bound proposal fails validation.

Excluded scope records what the approval does not cover. It is evidence only and does not alter proposal contents.

## Conditions And Implementation Constraints

Conditions, required changes, implementation constraints, validation requirements, test requirements, deployment prerequisites, monitoring requirements, and rollback requirements remain explicit arrays.

An approval may allow separate implementation planning, but it does not implement or deploy any change.

## Expiration

Expiration timestamps cannot be earlier than creation or decision timestamps. Expired approvals remain historical evidence only and cannot be used as current approval evidence.

Expiration does not alter the underlying Production Proposal.

## Revocation

Revocation returns a new immutable artifact with:

- `approvalStatus: "revoked"`
- `revokedAt`
- `revocationReason`
- an appended audit event
- a new approval fingerprint

A revoked approval cannot be used as current approval evidence.

## Supersession

Supersession returns a new immutable artifact with:

- `approvalStatus: "superseded"`
- `supersededByApprovalId`
- an appended audit event
- a new approval fingerprint

Validation rejects self-supersession and invalid supersession chains. A replacement approval requires a new explicit human decision.

## Audit History

Audit history records approval creation, supersession, revocation, expiration, and future governance events. Each event preserves actor, timestamp, prior status, next status, reason, details, and no-authority boundary fields.

Audit-history ordering is deterministic.

## Immutability

Created approval artifacts are deeply frozen. Revocation and supersession helpers return new immutable artifacts. Source proposals, approval inputs, existing approval artifacts, and audit history inputs are not mutated.

Use `cloneProductionApprovalArtifact` when callers need an independent mutable copy for inspection or test setup.

## Authority Boundaries

Every approval artifact preserves:

- `productionImpact: "none"`
- `decisionImpact: "none"`
- `executionAuthority: "none"`

The artifact must not:

- write code
- modify configuration
- update production state
- invoke deployment
- alter proposal contents
- alter thresholds or weights
- modify Deal Gate or BUY_NOW
- send notifications
- mark implementation complete
- mark deployment successful
- grant runtime authority

## Validation

Validation returns:

- `valid`
- `errors`
- `warnings`
- `reasonCodes`
- `invalidFields`
- `missingRequiredFields`
- `proposalBindingViolations`
- `approvalBoundaryViolations`
- `authorityBoundaryViolations`
- `expirationViolations`
- `supersessionViolations`
- `revocationViolations`
- `fingerprintMismatches`

## Future Deployment-Validation Integration

Future deployment-validation artifacts may reference production approval artifacts by ID and fingerprint. Those future artifacts must still preserve the governed chain:

```text
Production Proposal
-> Production Approval Artifact
-> Separate Code or Configuration Change
-> Full Validation
-> Deployment Review
-> Deployment
-> Post-Deployment Monitoring
```

An approval artifact is evidence of Dalton's decision only; it is never a deployment mechanism.
