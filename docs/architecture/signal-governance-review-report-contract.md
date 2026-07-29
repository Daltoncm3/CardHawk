# Signal Governance Review Report Contract

Phase 15.0C defines the canonical architecture contract for Signal Governance Review Reports.

This phase is architecture-only and documentation-only. It does not implement runtime code, modify governance execution, modify Signal migrations, modify shadow comparisons, or integrate with production runtime.

## Executive Summary

A Signal Governance Review Report is the human-review presentation layer for a Signal Governance Evidence Bundle.

The Evidence Bundle answers:

> Which Signal evidence is available, valid, bound, reviewed, and safe to consume for governance?

The Governance Review Report answers:

> What should Dalton or a reviewer inspect, annotate, escalate, or preserve for downstream governance?

The report consumes Evidence Bundles by reference and fingerprint. It does not recompute native output, canonical Signal output, Signal alignment, parity, conflicts, validation, provenance, or fingerprints. It presents the bundle's evidence, classifies findings, preserves unresolved unknowns and conflicts, and captures reviewer observations.

The report may recommend follow-up, escalation, review readiness, dataset eligibility, or governance readiness. Those recommendations are non-authoritative. Approval authority remains outside the report and still requires the complete Phase 12 governance chain plus explicit Dalton approval.

## Report Schema

Recommended schema:

```js
{
  schemaVersion: "1.0.0",
  source: "signal_governance_review_report",
  reportId: "signal-governance-review-report:<bundle-id>",
  reportVersion: "1.0.0",
  createdAt: "2026-07-29T00:00:00.000Z",
  reviewedAt: "unknown",
  asOf: "2026-07-29T00:00:00.000Z",

  evidenceBundleReference: {
    bundleId: "signal-evidence-bundle:review-package-001",
    bundleVersion: "1.0.0",
    bundleFingerprint: "...",
    bundleValidationReadiness: "review_ready",
    bundleCertificationStatus: "review_ready"
  },

  listingReference: {
    listingId: "listing-001",
    marketplace: "ebay",
    marketplaceItemId: "1234567890",
    listingFingerprint: "..."
  },

  reviewReference: {
    reviewPackageId: "review-package-001",
    reviewPackageFingerprint: "...",
    reviewBatchId: "review-batch-001",
    reviewBatchFingerprint: "...",
    workspaceId: "workspace-001",
    workspaceFingerprint: "..."
  },

  reportStatus: "review_ready",
  reviewDisposition: "unreviewed",
  escalationStatus: "none",
  recommendationStatus: "no_authority",

  coverageSection: {
    expectedSignalCount: 13,
    coveredSignalCount: 13,
    missingSignalCount: 0,
    blockedSignalCount: 0,
    invalidSignalCount: 0,
    coverageRate: 1,
    missingSignalFamilies: [],
    blockedSignalFamilies: [],
    missionAreaCoverage: {}
  },

  signalReviewEntries: [],

  paritySection: {
    exactMatchCount: 0,
    semanticMatchCount: 0,
    mismatchCount: 0,
    incompleteCount: 0,
    invalidCount: 0,
    blockedCount: 0,
    parityFailures: []
  },

  conflictSection: {
    agreementCount: 0,
    contradictionCount: 0,
    supportingCount: 0,
    duplicateCount: 0,
    independentCount: 0,
    unknownRelationshipCount: 0,
    unresolvedConflicts: []
  },

  unknownValueSection: {
    unknownFieldCount: 0,
    unknownFieldsBySignalFamily: {},
    reviewImpact: "none",
    unresolvedUnknowns: []
  },

  evidenceGapSection: {
    missingEvidenceCount: 0,
    evidenceGaps: [],
    waivedEvidenceGaps: [],
    blockingEvidenceGaps: []
  },

  authoritySection: {
    authorityStatus: "safe",
    productionImpact: "none",
    decisionImpact: "none",
    executionAuthority: "none",
    authorityViolations: []
  },

  provenanceSection: {
    provenanceStatus: "valid",
    sourceArtifactFingerprints: [],
    invalidReferences: [],
    missingReferences: [],
    fingerprintViolations: []
  },

  validationSection: {
    valid: true,
    readiness: "review_ready",
    errors: [],
    warnings: [],
    reasonCodes: [],
    blockingFindingCount: 0,
    nonBlockingFindingCount: 0
  },

  findings: [],
  blockingFindings: [],
  nonBlockingFindings: [],

  reviewerObservations: {
    reviewer: "unknown",
    notes: "",
    reviewedSignalFamilies: [],
    flaggedSignalFamilies: [],
    reviewerConfidence: "unknown",
    dispositionReasonCodes: []
  },

  recommendations: [],

  amendmentHistory: [],
  supersessionReference: {
    supersedesReportId: "unknown",
    supersedesReportFingerprint: "unknown",
    supersededByReportId: "unknown",
    supersededByReportFingerprint: "unknown"
  },

  auditHistory: [
    {
      eventId: "report-created",
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
  reportFingerprint: "..."
}
```

## Required Fields

Every report should require:

- `schemaVersion`
- `source`
- `reportId`
- `reportVersion`
- `createdAt`
- `asOf`
- `evidenceBundleReference`
- `listingReference`
- `reviewReference`
- `reportStatus`
- `reviewDisposition`
- `escalationStatus`
- `recommendationStatus`
- `coverageSection`
- `signalReviewEntries`
- `paritySection`
- `conflictSection`
- `unknownValueSection`
- `evidenceGapSection`
- `authoritySection`
- `provenanceSection`
- `validationSection`
- `findings`
- `blockingFindings`
- `nonBlockingFindings`
- `reviewerObservations`
- `recommendations`
- `amendmentHistory`
- `supersessionReference`
- `auditHistory`
- `productionImpact`
- `decisionImpact`
- `executionAuthority`
- `reportFingerprint`

Authority fields must always remain:

- `productionImpact: "none"`
- `decisionImpact: "none"`
- `executionAuthority: "none"`

## Optional Fields

Optional fields should be additive:

- `reviewedAt`
- `operatorNotes`
- `reviewerAttachments`
- `workspaceSummaryReference`
- `datasetEligibility`
- `recommendationEligibility`
- `experimentEligibility`
- `proposalEligibility`
- `waiverReferences`
- `metadata`

Optional fields must not alter the Evidence Bundle, source Signal artifacts, or governance chain.

## Evidence Bundle Binding

Reports must consume Evidence Bundles by reference and fingerprint.

Minimum binding fields:

- `bundleId`
- `bundleVersion`
- `bundleFingerprint`
- `bundleValidationReadiness`
- `bundleCertificationStatus`

If the bundle is embedded for offline archival, validation must verify:

- embedded bundle ID matches `evidenceBundleReference.bundleId`
- embedded bundle fingerprint matches `evidenceBundleReference.bundleFingerprint`
- report summaries are deterministic projections of the embedded bundle

If only referenced, the report must preserve enough IDs and fingerprints for later integrity validation.

## Per-Signal Review Entry Structure

Each `signalReviewEntries` record should summarize one Signal family from the Evidence Bundle:

```js
{
  signalFamily: "decision.deal_gate.diagnostics",
  signalName: "decision.deal_gate.diagnostics",
  signalVersion: "1.0.0",
  producer: "dealGateDiagnostics",
  missionArea: "decision",
  coverageStatus: "covered",
  alignmentStatus: "aligned",
  parityStatus: "semantic_match",
  registryStatus: "matched",
  reviewStatus: "unreviewed",
  evidenceQuality: "adequate",
  confidenceLevel: "moderate",
  unknownValueCount: 0,
  conflictCount: 0,
  findingCount: 0,
  blockingFindingCount: 0,
  signalReference: {
    canonicalSignalId: "...",
    canonicalSignalFingerprint: "...",
    alignmentId: "...",
    alignmentFingerprint: "...",
    migrationId: "...",
    migrationFingerprint: "...",
    shadowComparisonId: "...",
    shadowComparisonFingerprint: "...",
    alignmentReportId: "...",
    alignmentReportFingerprint: "..."
  },
  findings: [],
  reviewerObservation: {
    disposition: "unreviewed",
    notes: "",
    reviewerConfidence: "unknown",
    reasonCodes: []
  },
  productionImpact: "none",
  decisionImpact: "none",
  executionAuthority: "none"
}
```

The per-Signal entry must not copy or rewrite native output. It may include deterministic summaries and artifact references only.

## Finding Classification

Findings should be classified consistently:

### Severity

- `info`
- `warning`
- `blocking`
- `invalid`

### Finding Type

- `missing_signal`
- `blocked_alignment`
- `definition_missing`
- `version_mismatch`
- `parity_failure`
- `evidence_gap`
- `unknown_value`
- `conflict`
- `authority_violation`
- `fingerprint_mismatch`
- `provenance_gap`
- `review_follow_up`
- `certification_gap`

### Blocking Rules

Blocking findings should include:

- authority violations
- fingerprint mismatches
- invalid provenance
- parity failures that change represented native values
- missing registry definitions for mandatory Signals
- version mismatches for mandatory Signals
- missing mandatory Signal families
- malformed Evidence Bundle references

Non-blocking findings may include:

- unknown values explicitly preserved
- informational conflicts that do not invalidate the wrapper
- optional Signal families missing
- review follow-up suggestions
- waived evidence gaps

## Review Dispositions

Supported report dispositions:

- `unreviewed`
- `accepted_for_review`
- `reviewed_no_issues`
- `reviewed_with_notes`
- `needs_follow_up`
- `escalated`
- `blocked`
- `invalid`
- `superseded`

Dispositions represent human or governance review state only. They do not approve production changes.

## Escalation Lifecycle

Supported escalation statuses:

- `none`
- `watch`
- `needs_follow_up`
- `investigation_required`
- `blocked_pending_fix`
- `waived_with_rationale`
- `resolved`
- `superseded`

Escalation flow:

```text
finding_detected
-> reviewer_triage
-> follow_up_or_investigation
-> resolved_or_waived
-> report_amended_or_superseded
```

Escalations must preserve:

- affected Signal family
- reason code
- source artifact fingerprint
- reviewer or owner
- timestamp
- resolution or waiver rationale
- authority fields set to `none`

## Recommendation Semantics

Report recommendations are observational only.

Allowed recommendation types:

- `continue_review`
- `request_more_evidence`
- `investigate_signal_mapping`
- `investigate_registry_definition`
- `investigate_native_output_change`
- `exclude_signal_from_current_review`
- `include_in_calibration_dataset`
- `do_not_include_in_calibration_dataset`
- `prepare_offline_experiment_candidate`
- `no_action`

Recommendation rules:

- recommendations must not modify source artifacts
- recommendations must not auto-complete review fields
- recommendations must not create production proposals directly
- recommendations must not approve changes
- recommendations must preserve counterevidence and limitations
- recommendations must state whether they are blocked by missing evidence

Approval authority always remains outside the report.

## Amendment And Supersession Model

Reports are immutable after creation.

Reviewer annotations, dispositions, escalation updates, or recommendation changes should create a new amended report with:

- new `reportId` or amended version marker
- new `reportFingerprint`
- `amendmentHistory` entry referencing the prior report
- `supersessionReference.supersedesReportId`
- `supersessionReference.supersedesReportFingerprint`

The original report remains retained for audit.

Amendments must not rewrite:

- Evidence Bundle references
- Signal artifact references
- native output summaries
- parity findings
- validation findings
- provenance bindings

If source evidence changes, create a new Evidence Bundle and then a new Review Report.

## Validation Requirements

A future report validator should return:

- `valid`
- `readiness`
- `errors`
- `warnings`
- `reasonCodes`
- `missingRequiredFields`
- `bundleReferenceViolations`
- `signalReferenceViolations`
- `coverageViolations`
- `parityViolations`
- `conflictViolations`
- `unknownValueViolations`
- `evidenceGapViolations`
- `authorityViolations`
- `provenanceViolations`
- `fingerprintViolations`
- `reviewDispositionViolations`
- `escalationViolations`
- `recommendationViolations`
- `amendmentViolations`

Validation must verify:

1. Required fields exist.
2. The Evidence Bundle reference has an ID and fingerprint.
3. Embedded bundle fingerprints match when embedded bundles are supplied.
4. Coverage summaries match bundle summaries.
5. Per-Signal entries match bundle Signal references.
6. Blocking and non-blocking findings are categorized consistently.
7. Missing definitions and version mismatches remain visible.
8. Parity failures remain visible.
9. Evidence gaps remain visible.
10. Unknown values and conflicts remain unresolved.
11. Authority fields remain `none`.
12. Provenance references are present and deterministic.
13. Reviewer observations do not rewrite evidence.
14. Recommendations are non-authoritative.
15. Amendment and supersession references do not self-reference.
16. Report fingerprint matches report contents.

Validation must not recompute native output, canonical Signal output, alignment, conflict analysis, parity, coverage, or bundle validation.

## Compatibility Guarantees

The report contract must preserve:

- Evidence Bundle immutability
- Signal artifact immutability
- source artifact fingerprints
- unknown values
- unresolved conflicts
- parity failures
- missing definitions
- version mismatches
- evidence gaps
- authority boundaries
- deterministic ordering
- deterministic fingerprints
- review package compatibility
- governance pipeline compatibility

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

## Illustrative Report Example

This example is illustrative only:

```json
{
  "schemaVersion": "1.0.0",
  "source": "signal_governance_review_report",
  "reportId": "signal-governance-review-report:bundle-001",
  "reportVersion": "1.0.0",
  "createdAt": "2026-07-29T14:30:00.000Z",
  "asOf": "2026-07-29T14:30:00.000Z",
  "evidenceBundleReference": {
    "bundleId": "signal-evidence-bundle:review-package-001",
    "bundleVersion": "1.0.0",
    "bundleFingerprint": "bundle-fingerprint",
    "bundleValidationReadiness": "review_ready",
    "bundleCertificationStatus": "review_ready"
  },
  "listingReference": {
    "listingId": "listing-001",
    "marketplace": "ebay",
    "marketplaceItemId": "1234567890",
    "listingFingerprint": "listing-fingerprint"
  },
  "reviewReference": {
    "reviewPackageId": "review-package-001",
    "reviewPackageFingerprint": "review-package-fingerprint"
  },
  "reportStatus": "review_ready",
  "reviewDisposition": "unreviewed",
  "escalationStatus": "none",
  "recommendationStatus": "no_authority",
  "coverageSection": {
    "expectedSignalCount": 13,
    "coveredSignalCount": 13,
    "missingSignalCount": 0,
    "blockedSignalCount": 0,
    "invalidSignalCount": 0,
    "coverageRate": 1
  },
  "signalReviewEntries": [
    {
      "signalFamily": "decision.deal_gate.diagnostics",
      "signalName": "decision.deal_gate.diagnostics",
      "signalVersion": "1.0.0",
      "producer": "dealGateDiagnostics",
      "missionArea": "decision",
      "coverageStatus": "covered",
      "alignmentStatus": "aligned",
      "parityStatus": "semantic_match",
      "registryStatus": "matched",
      "reviewStatus": "unreviewed",
      "findingCount": 0,
      "blockingFindingCount": 0,
      "signalReference": {
        "canonicalSignalFingerprint": "canonical-signal-fingerprint",
        "alignmentFingerprint": "alignment-fingerprint",
        "migrationFingerprint": "migration-fingerprint",
        "shadowComparisonFingerprint": "comparison-fingerprint",
        "alignmentReportFingerprint": "alignment-report-fingerprint"
      },
      "findings": [],
      "productionImpact": "none",
      "decisionImpact": "none",
      "executionAuthority": "none"
    }
  ],
  "findings": [],
  "blockingFindings": [],
  "nonBlockingFindings": [],
  "reviewerObservations": {
    "reviewer": "unknown",
    "notes": "",
    "reviewerConfidence": "unknown"
  },
  "recommendations": [
    {
      "recommendationType": "continue_review",
      "rationale": "Signal coverage is complete and no blocking findings are present.",
      "productionImpact": "none",
      "decisionImpact": "none",
      "executionAuthority": "none"
    }
  ],
  "productionImpact": "none",
  "decisionImpact": "none",
  "executionAuthority": "none",
  "reportFingerprint": "report-fingerprint"
}
```

## Future Implementation Roadmap

### Phase 15.0D - Signal Governance Review Report Module

Implement the immutable offline report contract under `validation/`.

Expected public APIs:

- `createSignalGovernanceReviewReport`
- `validateSignalGovernanceReviewReport`
- `cloneSignalGovernanceReviewReport`
- `summarizeSignalGovernanceReviewReport`
- `filterSignalGovernanceReviewReport`
- `sortSignalGovernanceReviewReport`
- `attachReviewerObservation`
- `amendSignalGovernanceReviewReport`
- `supersedeSignalGovernanceReviewReport`
- `buildSignalGovernanceReviewReportFingerprint`

### Phase 15.1A - Review Package Signal Evidence Binding

Define additive references from Real Listing Decision Review packages to Evidence Bundles and Governance Review Reports.

### Phase 15.1B - Dalton Workspace Signal Review Summary

Aggregate report findings, dispositions, coverage, and escalations across workspaces.

### Phase 15.2A - Governance Pipeline Signal Report Validation

Extend governance validation architecture so downstream recommendations, experiments, and proposals can require reviewed Signal report evidence.

### Phase 15.3A - Signal Review Dataset Projection

Define how reviewed report findings become dataset metadata without changing calibration behavior.

## Open Questions

1. Which report findings should block review package completion versus dataset eligibility?
2. Should report recommendations be limited to a fixed enum or allow namespaced future recommendation types?
3. Should reviewer observations live directly on reports or in separate amendment artifacts?
4. What minimum Signal coverage should be required before a report can support calibration dataset inclusion?
5. Should waived blocking findings require a separate approval artifact?
6. How should report expiration work when Evidence Bundles are superseded?
7. Should reports remain reference-only, or should archival exports embed the Evidence Bundle?

## Explicit Non-Goals

- No production runtime integration.
- No Signal migration execution.
- No shadow comparison execution.
- No production engine execution.
- No native or canonical output recomputation.
- No source artifact mutation.
- No conflict resolution.
- No automatic review completion.
- No production proposal generation.
- No production approval.
- No changes to scoring, valuation, Deal Gate, BUY_NOW, notifications, scanner, marketplace, persistence, configuration, or governance execution.
