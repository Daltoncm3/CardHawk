# Offline Workspace Signal Evidence Summary

Phase 15.1B defines how CardHawk's offline review workspace should present Signal governance evidence for a Review Package.

This phase is architecture-only and documentation-only. It does not implement UI code, runtime code, governance execution, Signal migrations, shadow comparisons, or production integration.

## Executive Summary

The offline workspace should display Signal governance state as a reviewer-safe summary over immutable Review Package bindings.

The workspace consumes:

- Review Package identity
- Signal Governance Evidence Bundle references
- Signal Governance Review Report references
- binding readiness summaries
- validation, parity, conflict, unknown-value, provenance, supersession, and escalation metadata

The workspace must not recompute native output, canonical Signal output, parity, conflicts, validation, or fingerprints. It presents the current state of bound artifacts and makes blockers visible so Dalton can review with confidence.

Review readiness and certification readiness are separate. A package may be reviewable while not yet Signal-certified, but that distinction must be visible.

## Workspace Summary Schema

Recommended workspace-level summary:

```js
{
  schemaVersion: "1.0.0",
  source: "offline_workspace_signal_evidence_summary",
  workspaceSignalSummaryId: "workspace-signal-summary:<workspace-id>",
  workspaceId: "workspace-001",
  reviewBatchId: "review-batch-001",
  createdAt: "2026-07-29T00:00:00.000Z",
  asOf: "2026-07-29T00:00:00.000Z",

  packageSummaries: [],

  aggregateCoverage: {
    packageCount: 0,
    signalAwarePackageCount: 0,
    legacyPackageCount: 0,
    reviewReadyCount: 0,
    certificationReadyCount: 0,
    blockedPackageCount: 0,
    expectedSignalFamilies: [],
    coveredSignalFamilyCounts: {},
    missingSignalFamilyCounts: {},
    parityFailureCounts: {},
    conflictCounts: {},
    unknownValueCounts: {}
  },

  aggregateFindings: {
    blockingFindingCount: 0,
    nonBlockingFindingCount: 0,
    authorityViolationCount: 0,
    provenanceViolationCount: 0,
    supersessionWarningCount: 0,
    expirationWarningCount: 0,
    escalationCount: 0
  },

  reviewerNavigation: {
    nextReviewReadyPackageId: "unknown",
    blockedPackageIds: [],
    needsFollowUpPackageIds: [],
    certificationReadyPackageIds: []
  },

  productionImpact: "none",
  decisionImpact: "none",
  executionAuthority: "none",
  summaryFingerprint: "..."
}
```

Recommended package-level summary:

```js
{
  packageId: "review-package-001",
  listingId: "listing-001",
  marketplace: "ebay",
  reviewStatus: "unreviewed",
  packageFingerprint: "...",

  bindingStatus: "bound",
  reviewReadiness: "review_ready",
  certificationReadiness: "certification_ready",

  evidenceBundleStatus: {
    bundleId: "signal-evidence-bundle:review-package-001",
    bundleFingerprint: "...",
    validationReadiness: "review_ready",
    certificationStatus: "review_ready",
    fingerprintVerified: true,
    superseded: false,
    expired: false,
    missing: false,
    invalid: false
  },

  governanceReportStatus: {
    reportId: "signal-governance-review-report:bundle-001",
    reportFingerprint: "...",
    reportStatus: "review_ready",
    reviewDisposition: "unreviewed",
    escalationStatus: "none",
    fingerprintVerified: true,
    superseded: false,
    expired: false,
    missing: false,
    invalid: false
  },

  coverageSummary: {},
  signalStatuses: [],
  parityFailures: [],
  conflicts: [],
  unknownValues: [],
  evidenceGaps: [],
  provenanceFindings: [],
  validationFindings: [],
  escalationIndicators: [],
  navigationTargets: [],

  productionImpact: "none",
  decisionImpact: "none",
  executionAuthority: "none"
}
```

## Information Hierarchy

The workspace should present Signal evidence from broad to specific:

1. **Batch summary**

   Overall package counts, review readiness counts, certification readiness counts, missing Signal families, blocking findings, and escalation counts.

2. **Package queue**

   Per-package readiness labels, listing identity, review status, and next action.

3. **Package Signal summary**

   Bound bundle status, bound report status, coverage, blockers, warnings, and review focus.

4. **Mission-area summary**

   Identity, evidence, valuation, risk, confidence, Deal Gate, and decision context grouped for reviewer comprehension.

5. **Per-Signal details**

   Signal family status, parity, registry status, unknowns, conflicts, provenance, and artifact references.

6. **Artifact navigation**

   Safe links or file references to immutable package, bundle, report, migration, comparison, alignment report, and source snapshots.

The workspace should never bury blocking findings inside raw JSON. Blockers should be visible at batch, package, and Signal detail levels.

## Status And Finding Presentation

### Primary Status Groups

Workspace display should distinguish:

- `ready`: no blocking findings
- `ready_with_warnings`: review can proceed but warnings exist
- `blocked`: review or certification cannot proceed
- `legacy`: package has no Signal governance binding
- `invalid`: package or binding cannot be trusted
- `superseded`: bound artifacts were replaced
- `expired`: bound artifacts aged out

### Blocking Findings

Blocking findings must remain visible:

- missing Evidence Bundle
- invalid Evidence Bundle
- missing Governance Review Report
- invalid Governance Review Report
- parity failure
- fingerprint mismatch
- authority violation
- invalid provenance
- missing mandatory Signal family
- registry definition missing
- version mismatch
- superseded required artifact
- expired required artifact

### Non-Blocking Findings

Non-blocking findings should remain visible but should not prevent review by themselves:

- optional Signal missing
- unknown value preserved
- warning-only conflict
- waived evidence gap
- review follow-up note
- report recommendation with no authority

## Per-Signal Presentation Model

Each Signal should be presented as a compact status row with expandable detail.

Recommended row fields:

- Signal family
- mission area
- coverage status
- alignment status
- parity status
- registry status
- evidence quality
- confidence level
- unknown value count
- conflict count
- blocking finding count
- escalation status
- artifact navigation

Recommended detail fields:

- canonical Signal fingerprint
- alignment fingerprint
- migration fingerprint
- shadow comparison fingerprint
- alignment report fingerprint
- report findings
- parity mismatches
- unknown fields
- unresolved conflicts
- evidence gaps
- provenance references
- reviewer notes

The workspace should not display a Signal as "good" merely because it exists. It should show existence, validity, parity, and readiness separately.

## Readiness Presentation

Review readiness and certification readiness should be displayed separately.

### Review Readiness

Review readiness answers:

> Can Dalton review this package with the available evidence?

States:

- `legacy_ready`
- `review_ready`
- `review_ready_with_warnings`
- `blocked_missing_bundle`
- `blocked_invalid_bundle`
- `blocked_bundle_superseded`
- `blocked_authority_violation`
- `invalid`

### Certification Readiness

Certification readiness answers:

> Can this package's Signal evidence support downstream governance?

States:

- `not_signal_certified`
- `certification_ready`
- `certification_ready_with_warnings`
- `blocked_missing_report`
- `blocked_invalid_report`
- `blocked_report_findings`
- `blocked_report_superseded`
- `blocked_expired_artifact`
- `invalid`

The workspace should allow filtering by both states.

## Artifact Navigation And Integrity Verification

Workspace navigation should be reviewer-safe and reference-based.

Navigation targets should include:

- Review Package JSON
- Signal Governance Evidence Bundle
- Signal Governance Review Report
- Signal Alignment Reports
- Signal Shadow Comparisons
- Signal Migration Artifacts
- source review batch
- human review form

Each navigation target should show:

- artifact type
- artifact ID
- fingerprint
- verification status
- supersession state
- expiration state

Navigation must not provide actions that mutate source artifacts. If a reviewer needs to add notes, the workspace should create or reference a separate review or amendment artifact.

## Supersession And Expiration Handling

Superseded and expired artifacts must be clearly distinguished.

### Superseded

Use when a newer bundle, report, or binding replaces the referenced artifact.

Presentation:

- show `superseded`
- show replacement ID and fingerprint when available
- block readiness if replacement is required
- retain original artifact reference for audit

### Expired

Use when evidence aged out by policy, native engine version changed, registry changed, or review window elapsed.

Presentation:

- show `expired`
- show expiration reason
- show affected Signal families
- block certification readiness unless explicitly waived

### Missing

Use when the package references an artifact that is not available in the workspace.

Presentation:

- show `missing`
- preserve the expected ID and fingerprint
- block readiness according to binding rules

### Invalid

Use when the artifact is present but fails validation or fingerprint verification.

Presentation:

- show `invalid`
- show validation reason codes
- block readiness

## Accessibility And Reviewer Clarity Considerations

The workspace should prioritize clarity over density.

Guidelines:

- Use consistent labels for review readiness and certification readiness.
- Group findings by mission area before showing raw artifact details.
- Keep blocking findings visible without requiring expansion.
- Preserve exact reason codes for audit.
- Use plain language summaries next to technical reason codes.
- Do not use color as the only status indicator.
- Provide counts and labels for unknown values instead of silently substituting defaults.
- Distinguish "missing", "unknown", "not applicable", "waived", "superseded", and "expired".
- Keep reviewer notes separate from immutable evidence.
- Make artifact fingerprints copyable or inspectable.

## Authority Boundaries

Workspace summaries remain non-authoritative.

They must not:

- approve production behavior
- change Deal Gate
- change BUY_NOW
- change valuation
- change scoring
- change notification behavior
- change scanner behavior
- change marketplace behavior
- modify persistence
- run production engines
- execute Signal migrations
- execute shadow comparisons
- recompute fingerprints except for offline validation display
- repair parity failures
- resolve conflicts
- convert unknown values into defaults

Every summary must preserve:

- `productionImpact: "none"`
- `decisionImpact: "none"`
- `executionAuthority: "none"`

## Illustrative Workspace Example

This example is illustrative only:

```json
{
  "schemaVersion": "1.0.0",
  "source": "offline_workspace_signal_evidence_summary",
  "workspaceSignalSummaryId": "workspace-signal-summary:workspace-001",
  "workspaceId": "workspace-001",
  "reviewBatchId": "review-batch-001",
  "createdAt": "2026-07-29T15:00:00.000Z",
  "asOf": "2026-07-29T15:00:00.000Z",
  "aggregateCoverage": {
    "packageCount": 25,
    "signalAwarePackageCount": 25,
    "legacyPackageCount": 0,
    "reviewReadyCount": 24,
    "certificationReadyCount": 22,
    "blockedPackageCount": 1,
    "expectedSignalFamilies": [
      "identity.parser.diagnostics",
      "evidence.readiness.diagnostics",
      "production.valuation.diagnostics",
      "decision.deal_gate.diagnostics"
    ],
    "coveredSignalFamilyCounts": {
      "identity.parser.diagnostics": 25,
      "evidence.readiness.diagnostics": 25,
      "production.valuation.diagnostics": 25,
      "decision.deal_gate.diagnostics": 25
    },
    "missingSignalFamilyCounts": {},
    "parityFailureCounts": {
      "production.valuation.diagnostics": 1
    }
  },
  "packageSummaries": [
    {
      "packageId": "review-package-001",
      "listingId": "listing-001",
      "marketplace": "ebay",
      "reviewStatus": "unreviewed",
      "bindingStatus": "bound",
      "reviewReadiness": "review_ready_with_warnings",
      "certificationReadiness": "blocked_report_findings",
      "evidenceBundleStatus": {
        "bundleId": "signal-evidence-bundle:review-package-001",
        "bundleFingerprint": "bundle-fingerprint",
        "validationReadiness": "review_ready",
        "fingerprintVerified": true,
        "superseded": false,
        "expired": false,
        "missing": false,
        "invalid": false
      },
      "governanceReportStatus": {
        "reportId": "signal-governance-review-report:bundle-001",
        "reportFingerprint": "report-fingerprint",
        "reportStatus": "review_ready",
        "reviewDisposition": "unreviewed",
        "escalationStatus": "investigation_required",
        "fingerprintVerified": true,
        "superseded": false,
        "expired": false,
        "missing": false,
        "invalid": false
      },
      "signalStatuses": [
        {
          "signalFamily": "production.valuation.diagnostics",
          "missionArea": "valuation",
          "coverageStatus": "covered",
          "alignmentStatus": "aligned",
          "parityStatus": "mismatch",
          "registryStatus": "matched",
          "blockingFindingCount": 1,
          "escalationStatus": "investigation_required"
        }
      ],
      "parityFailures": [
        {
          "signalFamily": "production.valuation.diagnostics",
          "reasonCode": "changed_native_field",
          "blocking": true
        }
      ],
      "productionImpact": "none",
      "decisionImpact": "none",
      "executionAuthority": "none"
    }
  ],
  "productionImpact": "none",
  "decisionImpact": "none",
  "executionAuthority": "none",
  "summaryFingerprint": "summary-fingerprint"
}
```

## Future Implementation Roadmap

### Phase 15.1C - Workspace Signal Evidence Summary Contract

Implement an offline immutable contract under `validation/`.

Expected APIs:

- `createWorkspaceSignalEvidenceSummary`
- `validateWorkspaceSignalEvidenceSummary`
- `summarizeWorkspaceSignalEvidence`
- `filterWorkspaceSignalEvidenceSummary`
- `sortWorkspaceSignalEvidenceSummary`
- `buildWorkspaceSignalEvidenceSummaryFingerprint`

### Phase 15.1D - Workspace Markdown Summary Design

Define deterministic Markdown sections for batch-level and package-level Signal summaries.

### Phase 15.2A - Governance Pipeline Signal Validation

Extend governance validation architecture so workspace-level Signal readiness can be checked before dataset, recommendation, experiment, or proposal progression.

### Phase 15.3A - Signal-Aware Calibration Dataset Projection

Define how reviewed package Signal summaries become dataset metadata.

## Open Questions

1. Which Signal family statuses should be visible in the package queue versus only in expanded detail?
2. Should workspace summaries be generated as JSON only, Markdown only, or both?
3. Should blocked certification prevent Dalton from completing a human review?
4. What expiration policy should workspace summaries display by default?
5. Should waived findings be shown as separate status chips or retained inside finding detail?
6. How should mixed legacy and Signal-aware review packages be sorted?
7. Should artifact navigation use relative workspace paths, absolute paths, or artifact registry IDs?

## Explicit Non-Goals

- No UI implementation.
- No runtime implementation.
- No production integration.
- No production engine execution.
- No Signal migration execution.
- No shadow comparison execution.
- No evidence recomputation.
- No artifact repair.
- No production approval.
- No changes to `server.js`, scanner, parser, identity, valuation, Deal Gate, BUY_NOW, notifications, marketplace, persistence, configuration, Signal migrations, shadow comparisons, or governance execution.
