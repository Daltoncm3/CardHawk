# Signal Governance Evidence Bundle Contract

Phase 15.0B defines the canonical architecture contract for Signal Governance Evidence Bundles.

This phase is architecture-only and documentation-only. It does not implement runtime code, modify governance execution, modify Signal migrations, modify shadow comparisons, or integrate with production runtime.

## Executive Summary

Signal Governance Evidence Bundles are the permanent bridge between CardHawk's completed Signal framework and the Phase 12 governance pipeline.

The bundle is an immutable offline artifact that answers one question:

> Which Signal evidence is available, valid, bound, reviewed, and safe to consume for governance?

The bundle does not run Signals, execute engines, recompute native outputs, resolve conflicts, approve recommendations, or change production behavior. It packages references and deterministic summaries from existing Signal artifacts so review, certification, calibration, experiment, proposal, approval, and deployment-validation workflows can consume the same evidence consistently.

The bundle should be implemented later as a validation module under `validation/`. This document defines the contract only.

## Contract Purpose

The bundle contract exists to:

- bind Signal artifacts to a review package, review batch, workspace, or governance chain
- preserve source artifact IDs and fingerprints
- summarize Signal coverage by family and mission area
- surface missing Signals, blocked alignments, parity failures, registry failures, conflicts, and unknown values
- enforce evidence-only authority boundaries
- provide deterministic inputs to manual review and downstream governance
- preserve forward compatibility as new Signal families are added

Signals remain advisory evidence. Governance may cite them, reject them, require follow-up, or use them to focus human review, but Signal evidence cannot authorize production behavior.

## Bundle Schema

Recommended schema:

```js
{
  schemaVersion: "1.0.0",
  source: "signal_governance_evidence_bundle",
  bundleId: "signal-evidence-bundle:<listing-or-review-id>",
  bundleVersion: "1.0.0",
  createdAt: "2026-07-29T00:00:00.000Z",
  capturedAt: "2026-07-29T00:00:00.000Z",
  asOf: "2026-07-29T00:00:00.000Z",

  listingReference: {
    listingId: "listing-123",
    marketplace: "ebay",
    marketplaceItemId: "1234567890",
    listingFingerprint: "..."
  },

  reviewReference: {
    reviewPackageId: "review-package-123",
    reviewPackageFingerprint: "...",
    reviewBatchId: "review-batch-123",
    reviewBatchFingerprint: "...",
    workspaceId: "workspace-123",
    workspaceFingerprint: "..."
  },

  expectedSignalFamilies: [
    "identity.parser.diagnostics",
    "evidence.readiness.diagnostics",
    "canonical.sold_evidence.diagnostics",
    "production.valuation.diagnostics",
    "decision.deal_gate.diagnostics"
  ],

  signalReferences: [
    {
      signalFamily: "identity.parser.diagnostics",
      signalName: "identity.parser.diagnostics",
      signalVersion: "1.0.0",
      producer: "identityParserDiagnostics",
      canonicalSignalId: "signal-123",
      canonicalSignalFingerprint: "...",
      alignmentId: "alignment-123",
      alignmentFingerprint: "...",
      migrationId: "migration-123",
      migrationFingerprint: "...",
      shadowComparisonId: "comparison-123",
      shadowComparisonFingerprint: "...",
      alignmentReportId: "report-123",
      alignmentReportFingerprint: "...",
      coverageStatus: "covered",
      parityStatus: "exact_match",
      alignmentStatus: "aligned",
      registryStatus: "matched",
      reviewStatus: "unreviewed",
      productionImpact: "none",
      decisionImpact: "none",
      executionAuthority: "none"
    }
  ],

  coverageSummary: {
    expectedSignalCount: 13,
    coveredSignalCount: 13,
    missingSignalCount: 0,
    blockedSignalCount: 0,
    invalidSignalCount: 0,
    coverageRate: 1,
    missionAreaCoverage: {
      identity: "covered",
      evidence: "covered",
      valuation: "covered",
      risk: "covered",
      confidence: "covered",
      decision: "covered"
    }
  },

  certificationSummary: {
    certificationStatus: "review_ready",
    certificationAt: "2026-07-29T00:00:00.000Z",
    certificationSource: "signal_coverage_certification",
    certificationFingerprint: "...",
    requiredFollowUps: [],
    waivedIssues: []
  },

  validationSummary: {
    valid: true,
    readiness: "review_ready",
    errors: [],
    warnings: [],
    reasonCodes: [],
    missingSignalFamilies: [],
    blockedSignalFamilies: [],
    parityFailures: [],
    registryFailures: [],
    authorityViolations: [],
    fingerprintViolations: [],
    sourceReferenceViolations: []
  },

  conflictSummary: {
    agreementCount: 0,
    contradictionCount: 0,
    supportingCount: 0,
    duplicateCount: 0,
    independentCount: 0,
    unknownRelationshipCount: 0,
    relationships: []
  },

  unknownValueSummary: {
    unknownFieldCount: 0,
    unknownFieldsBySignalFamily: {},
    reviewImpact: "none"
  },

  reviewFocus: {
    priority: "normal",
    focusAreas: [],
    suggestedQuestions: [],
    blockers: [],
    cautions: []
  },

  provenance: {
    generatedBy: "signal_governance_evidence_bundle_contract",
    sourceArtifactFingerprints: [],
    sourceReportFingerprints: [],
    sourceComparisonFingerprints: [],
    sourceMigrationFingerprints: [],
    sourceRegistryFingerprints: []
  },

  auditHistory: [
    {
      eventId: "bundle-created",
      eventType: "created",
      occurredAt: "2026-07-29T00:00:00.000Z",
      actor: "offline_governance_tool",
      details: {},
      productionImpact: "none",
      decisionImpact: "none",
      executionAuthority: "none"
    }
  ],

  productionImpact: "none",
  decisionImpact: "none",
  executionAuthority: "none",
  bundleFingerprint: "..."
}
```

## Required Fields

The following fields should be required for every bundle:

- `schemaVersion`
- `source`
- `bundleId`
- `bundleVersion`
- `createdAt`
- `capturedAt`
- `asOf`
- `listingReference`
- `reviewReference`
- `expectedSignalFamilies`
- `signalReferences`
- `coverageSummary`
- `certificationSummary`
- `validationSummary`
- `conflictSummary`
- `unknownValueSummary`
- `reviewFocus`
- `provenance`
- `auditHistory`
- `productionImpact`
- `decisionImpact`
- `executionAuthority`
- `bundleFingerprint`

Required authority fields must always be:

- `productionImpact: "none"`
- `decisionImpact: "none"`
- `executionAuthority: "none"`

## Optional Fields

Optional fields should be additive and namespaced when possible:

- `operatorNotes`
- `reviewerNotes`
- `workspaceReference`
- `datasetReferences`
- `recommendationReferences`
- `experimentReferences`
- `shadowExperimentReferences`
- `proposalReferences`
- `certificationWaivers`
- `implementationNotes`
- `metadata`

Optional fields must not alter source artifact meaning or grant authority.

## Signal Reference Requirements

Each `signalReferences` entry should include:

- signal family identity
- producer identity
- signal version
- canonical Signal ID and fingerprint
- alignment ID and fingerprint
- migration ID and fingerprint when available
- shadow comparison ID and fingerprint when available
- alignment report ID and fingerprint
- alignment status
- registry status
- parity status
- coverage status
- review status
- authority fields

Source artifacts may be referenced rather than embedded. Reference-only storage is preferred for large artifacts, as long as every reference includes deterministic IDs and fingerprints.

## Review Status Lifecycle

Supported bundle review statuses should be:

- `unreviewed`
- `review_ready`
- `reviewed`
- `needs_follow_up`
- `blocked_by_missing_signal`
- `blocked_by_parity_failure`
- `blocked_by_registry_failure`
- `blocked_by_authority_violation`
- `blocked_by_fingerprint_mismatch`
- `invalid`

Status rules:

- `review_ready` requires no blocking validation failures.
- `reviewed` requires a bound human review record or reviewed review package reference.
- `needs_follow_up` is used when non-blocking warnings require Dalton attention.
- blocked statuses describe why the bundle should not support downstream governance yet.
- `invalid` is reserved for malformed bundles, authority violations, impossible bindings, or fingerprint mismatch.

These statuses are governance readiness states only. They do not change production outcomes.

## Certification Metadata

`certificationSummary` should preserve:

- certification status
- certification timestamp
- certification source
- certification artifact or document reference
- certification fingerprint
- expected Signal family count
- covered Signal family count
- missing or blocked Signal families
- waived issues
- required follow-ups

Allowed certification statuses:

- `uncertified`
- `review_ready`
- `certified`
- `certified_with_follow_up`
- `blocked`
- `invalid`

Certification is evidence quality metadata. It is not production approval.

## Validation Requirements

A future validator should return structured validation:

- `valid`
- `readiness`
- `errors`
- `warnings`
- `reasonCodes`
- `missingRequiredFields`
- `missingSignalFamilies`
- `blockedSignalFamilies`
- `parityFailures`
- `registryFailures`
- `authorityViolations`
- `fingerprintViolations`
- `sourceReferenceViolations`
- `reviewStatusViolations`
- `certificationViolations`
- `compatibilityWarnings`

Validation should verify:

1. Required fields exist.
2. Authority fields remain `none`.
3. `expectedSignalFamilies` and `signalReferences` are deterministic and sorted.
4. Duplicate Signal family references are rejected unless explicitly versioned.
5. Every referenced artifact has an ID and fingerprint.
6. Fingerprint references match supplied source artifacts when source artifacts are embedded.
7. Coverage summary counts match `expectedSignalFamilies` and `signalReferences`.
8. Missing, blocked, invalid, and parity-failed Signals appear in validation summaries.
9. Registry failures are explicit.
10. Unknown values remain visible.
11. Audit history is deterministic and authority-neutral.
12. Review status is compatible with validation readiness.
13. Certification status is compatible with validation readiness.
14. Bundle fingerprint matches the bundle contents.

Validation must not run Signal migrations, run shadow comparisons, execute engines, recompute outputs, or mutate source artifacts.

## Versioning Strategy

Initial schema version: `1.0.0`.

Versioning rules:

- Patch versions may clarify validation details without changing serialized shape.
- Minor versions may add optional fields.
- Major versions are required for renamed required fields, changed status semantics, or incompatible fingerprint projections.
- Existing bundles must remain readable.
- Unknown future fields should be preserved under `metadata` or ignored by older validators if they do not affect authority or fingerprints.
- Deprecated fields should remain accepted until a formal migration contract exists.

Signal family versions are independent from bundle schema versions. A bundle may contain multiple Signal families with different native or Signal versions.

## Fingerprint Requirements

`bundleFingerprint` should be deterministic for identical inputs.

The fingerprint projection should:

- include all bundle fields except `bundleFingerprint`
- preserve sorted arrays for Signal references, reason codes, warnings, errors, and audit history
- preserve source artifact fingerprints exactly
- preserve explicit `unknown` values
- exclude no fields other than the fingerprint field itself

Changing any source artifact reference, validation result, coverage summary, certification state, review status, authority field, or audit event should change the bundle fingerprint.

## Provenance Requirements

The `provenance` section should identify:

- bundle generator name and version
- source Signal report fingerprints
- source shadow comparison fingerprints
- source migration fingerprints
- source registry fingerprints
- source review package or review batch fingerprints
- source certification references
- creation timestamp

Provenance must distinguish:

- generated Signal evidence
- human review evidence
- certification evidence
- governance progression evidence

No provenance field may imply runtime authority.

## Governance Lifecycle

The bundle lifecycle should be:

```text
Signal reports available
-> Evidence bundle created
-> Bundle validated
-> Bundle certified or blocked
-> Bundle attached to review-package reference
-> Dalton review consumes bundle
-> Reviewed bundle reference enters workspace summary
-> Calibration dataset preserves reviewed bundle reference
-> Recommendations and experiments cite reviewed bundle evidence
-> Production proposal cites bundle only through complete governance chain
```

The bundle may be regenerated from source artifacts, but existing reviewed bundles should remain immutable. Corrections should create a new bundle with a new fingerprint and audit-history link to the superseded bundle.

## Compatibility Guarantees

The bundle contract must preserve:

- native Signal output immutability
- source artifact fingerprint bindings
- existing review package behavior
- existing governance artifact behavior
- existing Signal report behavior
- existing shadow comparison behavior
- evidence-only authority boundaries
- explicit unknown values
- deterministic ordering and fingerprints

It must not require changes to:

- `server.js`
- scanner behavior
- parser behavior
- identity behavior
- valuation
- Deal Gate
- BUY_NOW
- notifications
- persistence
- marketplace behavior
- Signal migrations
- shadow comparisons
- governance execution

## Illustrative Example

This example is illustrative only:

```json
{
  "schemaVersion": "1.0.0",
  "source": "signal_governance_evidence_bundle",
  "bundleId": "signal-evidence-bundle:review-package-2026-07-29-001",
  "bundleVersion": "1.0.0",
  "createdAt": "2026-07-29T14:00:00.000Z",
  "capturedAt": "2026-07-29T13:55:00.000Z",
  "asOf": "2026-07-29T14:00:00.000Z",
  "listingReference": {
    "listingId": "listing-001",
    "marketplace": "ebay",
    "marketplaceItemId": "1234567890",
    "listingFingerprint": "listing-fingerprint"
  },
  "reviewReference": {
    "reviewPackageId": "review-package-001",
    "reviewPackageFingerprint": "review-package-fingerprint",
    "reviewBatchId": "review-batch-001",
    "reviewBatchFingerprint": "review-batch-fingerprint"
  },
  "expectedSignalFamilies": [
    "canonical.sold_evidence.diagnostics",
    "decision.context.diagnostics",
    "decision.deal_gate.diagnostics",
    "evidence.readiness.diagnostics",
    "identity.parser.diagnostics",
    "production.valuation.diagnostics"
  ],
  "signalReferences": [
    {
      "signalFamily": "decision.deal_gate.diagnostics",
      "signalName": "decision.deal_gate.diagnostics",
      "signalVersion": "1.0.0",
      "producer": "dealGateDiagnostics",
      "canonicalSignalId": "signal:deal-gate:listing-001",
      "canonicalSignalFingerprint": "canonical-signal-fingerprint",
      "alignmentId": "alignment:deal-gate:listing-001",
      "alignmentFingerprint": "alignment-fingerprint",
      "migrationId": "migration:deal-gate:listing-001",
      "migrationFingerprint": "migration-fingerprint",
      "shadowComparisonId": "comparison:deal-gate:listing-001",
      "shadowComparisonFingerprint": "comparison-fingerprint",
      "alignmentReportId": "report:deal-gate:listing-001",
      "alignmentReportFingerprint": "report-fingerprint",
      "coverageStatus": "covered",
      "parityStatus": "semantic_match",
      "alignmentStatus": "aligned",
      "registryStatus": "matched",
      "reviewStatus": "unreviewed",
      "productionImpact": "none",
      "decisionImpact": "none",
      "executionAuthority": "none"
    }
  ],
  "coverageSummary": {
    "expectedSignalCount": 6,
    "coveredSignalCount": 6,
    "missingSignalCount": 0,
    "blockedSignalCount": 0,
    "invalidSignalCount": 0,
    "coverageRate": 1
  },
  "certificationSummary": {
    "certificationStatus": "review_ready",
    "certificationSource": "signal_coverage_certification",
    "requiredFollowUps": [],
    "waivedIssues": []
  },
  "validationSummary": {
    "valid": true,
    "readiness": "review_ready",
    "errors": [],
    "warnings": [],
    "reasonCodes": []
  },
  "productionImpact": "none",
  "decisionImpact": "none",
  "executionAuthority": "none",
  "bundleFingerprint": "bundle-fingerprint"
}
```

## Future Implementation Roadmap

### Phase 15.0C - Signal Governance Evidence Bundle Module

Implement the offline immutable contract under `validation/`.

Expected public APIs:

- `createSignalGovernanceEvidenceBundle`
- `validateSignalGovernanceEvidenceBundle`
- `cloneSignalGovernanceEvidenceBundle`
- `summarizeSignalGovernanceEvidenceBundle`
- `attachSignalEvidenceReviewMetadata`
- `supersedeSignalGovernanceEvidenceBundle`
- `buildSignalGovernanceEvidenceBundleFingerprint`

### Phase 15.0D - Signal Governance Review Report

Create a deterministic human-readable report over one or more bundles.

### Phase 15.1A - Review Package Signal Evidence Binding

Define how review packages reference bundle IDs and fingerprints without mutating production or shadow snapshots.

### Phase 15.1B - Workspace Signal Evidence Summary

Summarize Signal evidence across Dalton Review Workspaces.

### Phase 15.2A - Governance Pipeline Signal Evidence Validation

Extend governance pipeline validation architecture to check bundle presence, binding, certification, and readiness.

## Open Questions

1. Which Signal families are mandatory for every review package?
2. Should mandatory families vary by listing type, marketplace, evidence availability, or review purpose?
3. Should bundles embed complete Signal artifacts for archival durability or reference them for compactness?
4. How long should a bundle remain current after native engine versions change?
5. What waiver process is acceptable for missing or blocked Signal families?
6. Should Listing Quality's migration-parity-only status block uniform certification in future implementations?
7. How should bundle supersession be represented across workspaces and datasets?

## Explicit Non-Goals

- No production runtime integration.
- No Signal migration execution.
- No production engine execution.
- No native output recomputation.
- No governance execution changes.
- No conflict resolution.
- No automatic review completion.
- No production proposal generation.
- No production authority.
