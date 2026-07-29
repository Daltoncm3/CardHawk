# Review Package Signal Binding

Phase 15.1A defines how Real Listing Decision Review Packages bind immutable Signal Governance Evidence Bundles and Signal Governance Review Reports into one governed review artifact.

This phase is architecture-only and documentation-only. It does not implement runtime code, modify governance execution, modify Signal migrations, modify shadow comparisons, or integrate with production runtime.

## Executive Summary

Review Packages are CardHawk's canonical artifact for Dalton's manual evaluation of real production listings. Phase 12 established the package as a frozen snapshot of production and shadow outputs. Phase 15 adds Signal evidence as a governed reference layer.

The permanent binding model is:

```text
Review Package
  -> immutable production and shadow snapshots
  -> Signal Governance Evidence Bundle reference
  -> Signal Governance Review Report reference
  -> human review record
  -> downstream workspace, dataset, recommendation, experiment, and proposal artifacts
```

The Review Package must never recompute Signal evidence. It references immutable Evidence Bundles and Review Reports by ID and fingerprint. Missing or invalid Evidence Bundles block review readiness. Missing or invalid Review Reports block certification readiness. All relationships must be fingerprint-verifiable.

Signals remain evidence. Review Packages remain non-authoritative.

## Design Goals

- Bind Signal evidence to real listing review snapshots without mutating those snapshots.
- Make Signal coverage, parity, conflicts, unknown values, and escalation status visible during review.
- Preserve deterministic artifact identity and fingerprints.
- Keep human review independent from Signal-generated recommendations.
- Allow downstream governance artifacts to cite reviewed Signal evidence.
- Maintain backward compatibility with existing review packages.

## Review Package Schema

Future Signal-aware Review Packages should preserve the existing Phase 12 package fields and add a namespaced `signalGovernance` section.

Recommended additive schema:

```js
{
  schemaVersion: "1.0.0",
  packageId: "review-package-001",
  reviewBatchId: "review-batch-001",
  listingId: "listing-001",
  marketplace: "ebay",
  source: "real_listing_decision_review_contract",
  createdAt: "2026-07-29T00:00:00.000Z",
  capturedAt: "2026-07-29T00:00:00.000Z",
  reviewStatus: "unreviewed",

  listingSnapshot: {},
  identitySnapshot: {},
  productionSnapshot: {},
  shadowSnapshot: {},
  disagreementSnapshot: {},
  reviewMetadata: {},
  humanReviewRecord: null,

  signalGovernance: {
    bindingSchemaVersion: "1.0.0",
    bindingStatus: "bound",
    bindingCreatedAt: "2026-07-29T00:00:00.000Z",
    evidenceBundleReference: {
      bundleId: "signal-evidence-bundle:review-package-001",
      bundleVersion: "1.0.0",
      bundleFingerprint: "...",
      validationReadiness: "review_ready",
      certificationStatus: "review_ready"
    },
    reviewReportReference: {
      reportId: "signal-governance-review-report:bundle-001",
      reportVersion: "1.0.0",
      reportFingerprint: "...",
      reportStatus: "review_ready",
      reviewDisposition: "unreviewed",
      escalationStatus: "none"
    },
    coverageSummary: {
      expectedSignalCount: 13,
      coveredSignalCount: 13,
      missingSignalCount: 0,
      blockedSignalCount: 0,
      invalidSignalCount: 0,
      coverageRate: 1
    },
    readinessSummary: {
      packageReadiness: "review_ready",
      certificationReadiness: "certification_ready",
      blockingReasons: [],
      nonBlockingWarnings: [],
      requiredFollowUps: []
    },
    integritySummary: {
      bundleFingerprintVerified: true,
      reportFingerprintVerified: true,
      packageBindingFingerprintVerified: true,
      sourceReferenceViolations: [],
      authorityViolations: []
    },
    supersessionState: {
      bundleSuperseded: false,
      reportSuperseded: false,
      replacementBundleId: "unknown",
      replacementReportId: "unknown"
    },
    productionImpact: "none",
    decisionImpact: "none",
    executionAuthority: "none",
    bindingFingerprint: "..."
  },

  productionImpact: "none",
  decisionImpact: "none",
  packageFingerprint: "..."
}
```

The `signalGovernance` section should be additive. Existing review packages without it remain valid legacy packages but cannot be considered Signal-certified.

## Artifact Binding Model

### Evidence Bundle Binding

Evidence Bundle binding is required for Signal-aware review readiness.

Minimum fields:

- `bundleId`
- `bundleVersion`
- `bundleFingerprint`
- `validationReadiness`
- `certificationStatus`

Rules:

- the bundle must reference the same review package ID and package fingerprint
- the bundle must reference the same listing ID
- the bundle fingerprint must match the bundle contents when the bundle is supplied
- missing bundles block review readiness
- invalid bundles block review readiness
- superseded bundles block readiness unless a replacement is explicitly bound

### Governance Review Report Binding

Governance Review Report binding is required for Signal certification readiness.

Minimum fields:

- `reportId`
- `reportVersion`
- `reportFingerprint`
- `reportStatus`
- `reviewDisposition`
- `escalationStatus`

Rules:

- the report must reference the bound Evidence Bundle ID and fingerprint
- the report must reference the same review package ID and listing ID
- the report fingerprint must match the report contents when the report is supplied
- missing reports do not invalidate the base review package, but they block Signal certification readiness
- invalid reports block Signal certification readiness
- reports with unresolved blocking findings block certification readiness
- superseded reports block certification readiness unless a replacement is explicitly bound

### Human Review Binding

Human review remains owned by the Real Listing Decision Review contract.

Signal evidence may guide review focus, but it must not autofill human review fields. The final human review record should preserve whether Dalton considered Signal evidence through review notes, reason categories, or future namespaced metadata.

## Integrity Verification

Integrity verification should check:

1. Review Package fingerprint.
2. Evidence Bundle fingerprint.
3. Governance Review Report fingerprint.
4. Evidence Bundle reference to package ID and package fingerprint.
5. Governance Review Report reference to Evidence Bundle ID and fingerprint.
6. Governance Review Report reference to package ID and listing ID.
7. Signal governance binding fingerprint.
8. Authority fields across all bound artifacts.
9. Supersession references.
10. Audit-history authority boundaries.

Verification should never recompute evidence or alter artifacts.

When source artifacts are embedded for archival export, validation may recompute their fingerprints through existing validators. When source artifacts are reference-only, validation should verify the presence and format of IDs and fingerprints and defer full source validation until artifacts are available.

## Lifecycle

```text
Review Package created
-> Signal Evidence Bundle created for package
-> Bundle validates review-ready
-> Signal Governance Review Report created from bundle
-> Report validates certification-ready
-> Review Package binds bundle and report references
-> Dalton completes human review
-> Reviewed package enters workspace
-> Workspace feeds calibration dataset
-> Dataset feeds recommendation and experiment workflow
```

If evidence changes:

```text
New Signal artifacts
-> new Evidence Bundle
-> new Governance Review Report
-> new Review Package binding version or amended package artifact
-> original package remains retained for audit
```

## Eligibility States

### Package Readiness

- `legacy_ready`: package is valid without Signal governance bindings.
- `review_ready`: package, Evidence Bundle, and required references are valid enough for Dalton review.
- `review_ready_with_warnings`: package can be reviewed, but non-blocking Signal warnings should be visible.
- `blocked_missing_bundle`: no Evidence Bundle is bound.
- `blocked_invalid_bundle`: bound Evidence Bundle is invalid.
- `blocked_bundle_superseded`: bound Evidence Bundle has been superseded.
- `blocked_authority_violation`: any bound artifact violates authority boundaries.
- `invalid`: package or binding is structurally invalid.

### Certification Readiness

- `not_signal_certified`: no report is bound.
- `certification_ready`: bound report is valid and has no blocking findings.
- `certification_ready_with_warnings`: bound report is valid with non-blocking findings.
- `blocked_missing_report`: no Governance Review Report is bound.
- `blocked_invalid_report`: bound report is invalid.
- `blocked_report_findings`: report contains unresolved blocking findings.
- `blocked_report_superseded`: bound report has been superseded.
- `invalid`: binding cannot be fingerprint-verified.

### Downstream Eligibility

- `workspace_eligible`: package is reviewed and binding is valid or explicitly legacy.
- `dataset_eligible`: package has completed human review and required Signal evidence is valid or waived.
- `recommendation_eligible`: dataset evidence includes reviewed package and Signal binding references.
- `proposal_ineligible`: Signal binding alone is insufficient for production proposals.

## Package Completeness Requirements

A Signal-aware review package is complete for Dalton review when:

- base review package validates
- listing, production, shadow, and disagreement snapshots remain immutable
- Evidence Bundle is bound by ID and fingerprint
- Evidence Bundle references the same package and listing
- Evidence Bundle readiness is `review_ready` or explicitly warning-only
- authority fields remain `none`
- missing required Signal families are absent or explicitly waived for review only
- all blocking bundle validation failures are resolved

A package is complete for Signal certification when:

- review package is complete for Dalton review
- Governance Review Report is bound by ID and fingerprint
- Review Report references the bound Evidence Bundle
- Review Report has no unresolved blocking findings
- Review Report has no authority violations
- Review Report is not superseded
- all fingerprints are verifiable

## Validation Rules

A future validator should return:

- `valid`
- `packageReadiness`
- `certificationReadiness`
- `errors`
- `warnings`
- `reasonCodes`
- `missingRequiredFields`
- `packageFingerprintViolations`
- `bundleReferenceViolations`
- `reportReferenceViolations`
- `bindingViolations`
- `authorityViolations`
- `supersessionViolations`
- `readinessViolations`
- `compatibilityWarnings`

Validation should verify:

1. Existing review package fields remain valid.
2. `signalGovernance` is optional for legacy compatibility.
3. If `signalGovernance` exists, required binding fields exist.
4. Evidence Bundle reference has ID, version, fingerprint, and readiness.
5. Review Report reference has ID, version, fingerprint, status, disposition, and escalation status.
6. Bundle and report references point to the same package and listing when source artifacts are available.
7. Bundle fingerprint matches embedded bundle when embedded.
8. Report fingerprint matches embedded report when embedded.
9. Report references the bound bundle.
10. Binding summary counts match the bound bundle and report summaries.
11. Superseded bundles or reports block readiness unless explicitly replaced.
12. Authority fields remain `none`.
13. Binding fingerprint matches the `signalGovernance` section.

Validation must not execute Signal migrations, shadow comparisons, governance reports, production engines, or runtime systems.

## Superseded Bundles And Reports

Supersession should be explicit.

If an Evidence Bundle is superseded:

- package readiness becomes `blocked_bundle_superseded`
- the package should bind a replacement bundle before review continues
- prior references remain retained in audit history

If a Governance Review Report is superseded:

- certification readiness becomes `blocked_report_superseded`
- the package should bind a replacement report before certification continues
- human review may continue only if the supersession does not affect required review evidence

Replacing a bundle or report should create a new immutable package binding artifact or amended package version. It should not mutate the original binding in place.

## Compatibility Guarantees

The binding design preserves:

- existing Real Listing Decision Review package fields
- existing package fingerprints for packages without Signal bindings
- Signal artifact immutability
- Evidence Bundle immutability
- Governance Review Report immutability
- deterministic references and fingerprints
- explicit unknown values
- unresolved conflicts and findings
- authority boundaries
- downstream Phase 12 governance compatibility

It does not require changes to:

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

## Illustrative Package Example

This example is illustrative only:

```json
{
  "schemaVersion": "1.0.0",
  "packageId": "review-package-001",
  "reviewBatchId": "review-batch-001",
  "listingId": "listing-001",
  "marketplace": "ebay",
  "source": "real_listing_decision_review_contract",
  "createdAt": "2026-07-29T14:00:00.000Z",
  "capturedAt": "2026-07-29T13:55:00.000Z",
  "reviewStatus": "unreviewed",
  "signalGovernance": {
    "bindingSchemaVersion": "1.0.0",
    "bindingStatus": "bound",
    "bindingCreatedAt": "2026-07-29T14:05:00.000Z",
    "evidenceBundleReference": {
      "bundleId": "signal-evidence-bundle:review-package-001",
      "bundleVersion": "1.0.0",
      "bundleFingerprint": "bundle-fingerprint",
      "validationReadiness": "review_ready",
      "certificationStatus": "review_ready"
    },
    "reviewReportReference": {
      "reportId": "signal-governance-review-report:bundle-001",
      "reportVersion": "1.0.0",
      "reportFingerprint": "report-fingerprint",
      "reportStatus": "review_ready",
      "reviewDisposition": "unreviewed",
      "escalationStatus": "none"
    },
    "coverageSummary": {
      "expectedSignalCount": 13,
      "coveredSignalCount": 13,
      "missingSignalCount": 0,
      "blockedSignalCount": 0,
      "invalidSignalCount": 0,
      "coverageRate": 1
    },
    "readinessSummary": {
      "packageReadiness": "review_ready",
      "certificationReadiness": "certification_ready",
      "blockingReasons": [],
      "nonBlockingWarnings": [],
      "requiredFollowUps": []
    },
    "integritySummary": {
      "bundleFingerprintVerified": true,
      "reportFingerprintVerified": true,
      "packageBindingFingerprintVerified": true,
      "sourceReferenceViolations": [],
      "authorityViolations": []
    },
    "productionImpact": "none",
    "decisionImpact": "none",
    "executionAuthority": "none",
    "bindingFingerprint": "binding-fingerprint"
  },
  "productionImpact": "none",
  "decisionImpact": "none",
  "packageFingerprint": "package-fingerprint"
}
```

## Future Implementation Roadmap

### Phase 15.1B - Review Package Signal Binding Contract

Implement the offline immutable binding helper under `validation/`.

Expected public APIs:

- `attachSignalGovernanceBinding`
- `validateReviewPackageSignalBinding`
- `summarizeReviewPackageSignalBinding`
- `determineReviewPackageSignalReadiness`
- `supersedeReviewPackageSignalBinding`
- `buildReviewPackageSignalBindingFingerprint`

### Phase 15.1C - Dalton Workspace Signal Summary Architecture

Design workspace-level summaries of package readiness, certification readiness, missing bundles, missing reports, and unresolved findings.

### Phase 15.2A - Governance Pipeline Signal Binding Validation

Extend governance pipeline validation architecture so downstream artifacts can require reviewed package bindings before recommendations or proposals cite Signal evidence.

### Phase 15.3A - Signal-Aware Calibration Dataset Projection

Define how reviewed package bindings enter calibration datasets as immutable evidence references.

## Open Questions

1. Should Signal Governance bindings live inside the review package or as a sidecar artifact referenced by the package?
2. Which Signal families must be present before `review_ready` is allowed?
3. Can Dalton complete review when certification readiness is blocked but package readiness is available?
4. Which bundle or report warnings should block dataset eligibility?
5. Should replacement bundle/report bindings amend the package or create a separate binding revision artifact?
6. How should legacy packages without Signal bindings be included in mixed workspaces?
7. Should review-package fingerprints include the Signal binding section or should bindings have separate fingerprints only?

## Explicit Non-Goals

- No runtime integration.
- No production engine execution.
- No Signal migration execution.
- No shadow comparison execution.
- No evidence recomputation.
- No mutation of production or shadow snapshots.
- No automatic human review fields.
- No production proposal creation.
- No production authority.
- No changes to scoring, valuation, Deal Gate, BUY_NOW, notifications, scanner, marketplace, persistence, configuration, Signal migrations, shadow comparisons, or governance execution.
