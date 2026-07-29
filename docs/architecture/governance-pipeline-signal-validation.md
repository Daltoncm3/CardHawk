# Governance Pipeline Signal Validation

Phase 15.2A defines the architecture for validating CardHawk's complete Signal governance artifact chain before a Review Package is considered review-ready or certification-ready.

This phase is architecture-only and documentation-only. It does not implement runtime code, modify governance execution, modify Signal migrations, modify shadow comparisons, or integrate with production runtime.

## Executive Summary

Signal governance validation is an offline integrity layer over immutable artifacts.

It validates that:

- Review Packages bind the correct Evidence Bundles and Governance Review Reports
- Evidence Bundles preserve Signal references, coverage, validation, provenance, and certification metadata
- Governance Review Reports preserve findings, reviewer context, escalation status, and non-authoritative recommendations
- Workspace summaries accurately present package-level readiness
- every cross-artifact relationship is ID-bound and fingerprint-verifiable
- unknown values, conflicts, parity failures, missing definitions, version mismatches, evidence gaps, and authority violations remain visible

Validation never recomputes Signal output. It never repairs evidence. It never resolves conflicts. It never grants production authority. It produces findings only.

Production approval remains exclusively inside the Phase 12 governance chain and requires explicit Dalton approval.

## Validation Pipeline

The Signal validation pipeline should run before a package enters Dalton review or downstream governance:

```text
Review Package
-> Signal Governance Binding
-> Evidence Bundle
-> Signal References
-> Governance Review Report
-> Workspace Signal Summary
-> Signal Governance Validation Result
-> Phase 12 Governance Pipeline Validator
```

The Signal validation result becomes evidence for the broader governance validator. It does not replace the Phase 12 validator.

## Required Artifacts

### Required For Review Readiness

- Real Listing Decision Review Package
- Signal governance binding section or sidecar binding artifact
- Signal Governance Evidence Bundle
- artifact IDs and fingerprints
- package-to-bundle binding
- authority-safe validation result

### Required For Certification Readiness

All review-readiness artifacts plus:

- Signal Governance Review Report
- report-to-bundle binding
- per-Signal finding classifications
- parity, conflict, unknown-value, provenance, and evidence-gap sections
- escalation status
- no unresolved blocking findings

### Required For Workspace Readiness

All package-level artifacts plus:

- Offline Workspace Signal Evidence Summary
- package summary references
- aggregate coverage and finding counts
- navigation targets or artifact registry references

## Artifact Validation Order

Validation should be deterministic and fail closed:

1. **Artifact presence**

   Confirm required artifacts exist for the requested readiness level.

2. **Local artifact validation**

   Run artifact-local validators when implementation exists. For architecture-only or reference-only artifacts, validate required IDs, fingerprints, status fields, and authority fields.

3. **Version compatibility**

   Check schema versions, artifact versions, Signal versions, registry versions, bundle versions, and report versions.

4. **Fingerprint verification**

   Verify local fingerprints before checking cross-artifact relationships.

5. **Cross-artifact binding**

   Verify package, bundle, report, and workspace references point to the same package, listing, batch, and source artifacts.

6. **Signal coverage validation**

   Confirm mandatory Signal families are present, optional families are classified, and coverage counts match.

7. **Parity validation**

   Confirm parity statuses are preserved from shadow comparisons and that failures remain visible.

8. **Provenance validation**

   Confirm source artifact fingerprints, registry fingerprints, report fingerprints, migration fingerprints, and comparison fingerprints are present and consistent.

9. **Unknown-value and conflict validation**

   Confirm unknown values and conflicts are preserved as explicit review findings rather than converted into defaults.

10. **Supersession and expiration validation**

   Confirm artifacts are current or explicitly waived.

11. **Authority validation**

   Confirm every artifact preserves `productionImpact: "none"`, `decisionImpact: "none"`, and `executionAuthority: "none"`.

12. **Readiness determination**

   Determine review readiness and certification readiness separately.

13. **Validation report creation**

   Produce deterministic findings, reason codes, readiness states, and escalation recommendations.

## Fingerprint Verification Sequence

Fingerprint checks should run from local to global:

1. Review Package fingerprint.
2. Signal governance binding fingerprint.
3. Evidence Bundle fingerprint.
4. Governance Review Report fingerprint.
5. Workspace Signal Summary fingerprint.
6. Canonical Signal fingerprints referenced by the bundle.
7. Signal Alignment fingerprints referenced by the bundle.
8. Signal Migration fingerprints referenced by the bundle.
9. Shadow Comparison fingerprints referenced by the bundle.
10. Signal Alignment Report fingerprints referenced by bundle or report.
11. Registry fingerprints.
12. Cross-artifact reference fingerprints.
13. Final Signal validation result fingerprint.

If an artifact is reference-only and not available, validation should record `reference_unverified` rather than pretending the fingerprint was verified.

## Version Compatibility Checks

Validation should distinguish:

- `compatible`
- `compatible_with_warnings`
- `schema_version_unsupported`
- `artifact_version_unsupported`
- `signal_version_mismatch`
- `registry_version_mismatch`
- `unknown_version`
- `invalid`

Version mismatch does not rewrite evidence. It produces findings and may block readiness depending on whether the affected artifact is mandatory.

## Signal Coverage Validation

Coverage validation should use the expected Signal family list defined by the package, bundle, workspace policy, or certification profile.

Validation should compute or verify:

- expected Signal families
- present Signal families
- missing mandatory families
- missing optional families
- blocked families
- invalid families
- duplicate family references
- coverage rate
- mission-area coverage

Coverage failures block review readiness when a mandatory Evidence Bundle Signal is missing. Coverage failures block certification readiness when the missing or invalid Signal affects required certification evidence.

## Parity Validation

Parity validation consumes existing parity statuses only. It must not rerun shadow comparisons.

Parity statuses should be interpreted as:

- `exact_match`: no parity finding
- `semantic_match`: no parity finding, but preserve semantic-match note
- `mismatch`: blocking unless waived for review-only purposes
- `incomplete`: blocking when mandatory
- `invalid`: blocking
- `blocked`: blocking
- `unknown`: non-blocking only when Signal family is optional

Parity failures should preserve:

- affected Signal family
- reason code
- native artifact reference
- shadow artifact reference
- mismatch field
- blocking status
- waiver status if any

## Provenance Validation

Provenance validation should check:

- each source artifact has an ID and fingerprint
- bundle provenance includes migration, comparison, report, registry, and review references
- report provenance references the bundle
- workspace summary provenance references packages, bundles, and reports
- provenance does not imply production authority
- missing references remain visible

Invalid provenance should block certification readiness. It may block review readiness if the package cannot be trusted.

## Unknown-Value Handling

Unknown values are evidence, not errors by default.

Validation should:

- preserve unknown fields and counts
- classify unknowns by Signal family and mission area
- distinguish `unknown`, `missing`, `not_applicable`, and `unverified`
- flag unknowns that block a required review question
- avoid converting unknowns into defaults

Unknowns block readiness only when policy says the missing information is mandatory for the review or certification purpose.

## Conflict Handling

Conflicts should remain unresolved.

Validation should:

- preserve agreement, contradiction, supporting, duplicate, independent, and unknown relationship counts
- identify unresolved contradictions
- distinguish informational conflicts from blocking conflicts
- preserve conflict source fingerprints
- require human review for unresolved blocking conflicts

Validation must not choose a winning Signal or suppress conflicting evidence.

## Supersession And Expiration Validation

Validation should check whether:

- Evidence Bundle is superseded
- Governance Review Report is superseded
- Review Package binding is superseded
- Workspace summary is stale
- source Signal artifacts were replaced
- native engine version changed after capture
- registry version changed after capture
- review or certification window expired

Superseded or expired required artifacts should block certification readiness unless an explicit waiver or replacement reference exists.

## Readiness Rules

### Review Readiness

Review readiness answers:

> Can Dalton safely review this package with the available Signal evidence?

States:

- `legacy_ready`
- `review_ready`
- `review_ready_with_warnings`
- `blocked_missing_bundle`
- `blocked_invalid_bundle`
- `blocked_bundle_superseded`
- `blocked_authority_violation`
- `blocked_fingerprint_mismatch`
- `invalid`

Minimum `review_ready` requirements:

- base review package is valid
- package references a valid Evidence Bundle
- bundle references the same package and listing
- no authority violations exist
- no package or bundle fingerprint mismatch exists
- required Signal coverage is present or explicitly waived
- blocking bundle findings are absent

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
- `blocked_provenance_failure`
- `blocked_parity_failure`
- `blocked_version_mismatch`
- `invalid`

Minimum `certification_ready` requirements:

- review readiness is `review_ready` or `review_ready_with_warnings`
- valid Governance Review Report is bound
- report references the bound Evidence Bundle
- report has no unresolved blocking findings
- parity failures are absent or explicitly non-blocking
- provenance is valid
- no required artifact is superseded or expired
- all required fingerprints are verified or explicitly reference-only with certification policy allowing it

## Failure Taxonomy

### Invalid

Use when artifact trust is broken:

- malformed artifact
- fingerprint mismatch
- authority violation
- impossible binding
- invalid schema
- invalid provenance

### Blocked

Use when artifact trust may be intact but readiness cannot proceed:

- missing required artifact
- missing mandatory Signal family
- unresolved parity failure
- version mismatch
- superseded artifact
- expired artifact
- unresolved blocking conflict
- required unknown value

### Warning

Use when review may proceed with visibility:

- optional Signal missing
- non-blocking unknown value
- non-blocking conflict
- reference-only artifact not locally verified
- certification waiver present
- legacy package lacking Signal certification

### Informational

Use for context:

- semantic parity instead of exact parity
- duplicate Signal relationship
- reviewer focus suggestion
- report recommendation with no authority

## Escalation Model

Escalation statuses:

- `none`
- `watch`
- `needs_follow_up`
- `investigation_required`
- `blocked_pending_fix`
- `waived_with_rationale`
- `resolved`
- `superseded`

Escalation rules:

- parity failures escalate to `investigation_required`
- authority violations escalate to `blocked_pending_fix`
- fingerprint mismatches escalate to `blocked_pending_fix`
- missing mandatory Signals escalate to `needs_follow_up`
- superseded artifacts escalate to `superseded`
- expired artifacts escalate to `needs_follow_up`
- waived findings require rationale and reviewer identity

Escalations do not repair evidence or approve production behavior.

## Validation Reporting

A future validation report should include:

- `schemaVersion`
- `source`
- `validationId`
- `createdAt`
- `asOf`
- `reviewPackageId`
- `reviewPackageFingerprint`
- `bundleId`
- `bundleFingerprint`
- `reportId`
- `reportFingerprint`
- `workspaceId`
- `workspaceFingerprint`
- `reviewReadiness`
- `certificationReadiness`
- `valid`
- `errors`
- `warnings`
- `reasonCodes`
- `failureTaxonomy`
- `missingArtifacts`
- `versionViolations`
- `coverageViolations`
- `parityViolations`
- `provenanceViolations`
- `unknownValueFindings`
- `conflictFindings`
- `supersessionViolations`
- `expirationViolations`
- `authorityViolations`
- `fingerprintViolations`
- `escalations`
- `productionImpact: "none"`
- `decisionImpact: "none"`
- `executionAuthority: "none"`
- `validationFingerprint`

The report should be immutable and deterministic.

## Illustrative Validation Flow

```text
Input:
  review-package-001
  evidence-bundle-001
  governance-review-report-001
  workspace-signal-summary-001

Stage 1:
  package exists and base package validates

Stage 2:
  signalGovernance binding exists

Stage 3:
  bundle ID and fingerprint match package binding

Stage 4:
  report ID and fingerprint match package binding

Stage 5:
  report references bundle ID and fingerprint

Stage 6:
  expected Signal families are covered

Stage 7:
  no parity failures, authority violations, or fingerprint mismatches

Output:
  reviewReadiness = review_ready
  certificationReadiness = certification_ready
  valid = true
```

If the report contains a parity failure:

```text
reviewReadiness = review_ready_with_warnings
certificationReadiness = blocked_parity_failure
escalationStatus = investigation_required
```

If the Evidence Bundle is missing:

```text
reviewReadiness = blocked_missing_bundle
certificationReadiness = not_signal_certified
valid = false
```

## Compatibility Guarantees

Signal pipeline validation preserves:

- Review Package immutability
- Evidence Bundle immutability
- Governance Review Report immutability
- Workspace Summary immutability
- Signal artifact immutability
- source fingerprints
- explicit unknown values
- unresolved conflicts
- visible failures
- evidence-only authority boundaries
- Phase 12 governance compatibility

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

## Future Implementation Roadmap

### Phase 15.2B - Signal Governance Pipeline Validation Contract

Implement an offline immutable validation module under `validation/`.

Expected APIs:

- `validateSignalGovernancePipeline`
- `validateSignalArtifactPresence`
- `validateSignalArtifactVersions`
- `validateSignalFingerprintChain`
- `validateSignalCoverage`
- `validateSignalParity`
- `validateSignalProvenance`
- `validateSignalUnknownValues`
- `validateSignalConflicts`
- `validateSignalSupersessionAndExpiration`
- `determineSignalReviewReadiness`
- `determineSignalCertificationReadiness`
- `summarizeSignalGovernanceValidation`
- `buildSignalGovernanceValidationFingerprint`

### Phase 15.2C - Governance Pipeline Validator Integration Architecture

Define how the Signal validation result becomes an optional input to `governancePipelineValidator` without changing existing pipeline behavior.

### Phase 15.3A - Signal-Aware Calibration Dataset Projection

Define how reviewed and validated Signal evidence enters calibration datasets.

### Phase 15.4A - Signal Evidence Requirements For Production Proposals

Define minimum Signal validation evidence before a production proposal may cite Signal-derived findings.

## Open Questions

1. Which Signal families are mandatory for review readiness versus certification readiness?
2. Should reference-only artifacts be allowed for certification readiness?
3. Who can waive parity failures, version mismatches, or missing mandatory Signals?
4. What expiration policy should apply to Signal evidence after registry or native engine version changes?
5. Should validation produce one package-level artifact, one workspace-level artifact, or both?
6. Should legacy packages without Signal bindings remain dataset-eligible?
7. How should validation handle partially reviewed workspaces with mixed readiness states?

## Explicit Non-Goals

- No runtime integration.
- No production engine execution.
- No Signal migration execution.
- No shadow comparison execution.
- No evidence recomputation.
- No artifact repair.
- No conflict resolution.
- No approval authority.
- No production proposal generation.
- No changes to `server.js`, scanner, parser, identity, valuation, Deal Gate, BUY_NOW, notifications, marketplace, persistence, configuration, Signal migrations, shadow comparisons, or governance execution.
