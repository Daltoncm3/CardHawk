# Dalton Review Workspace

Phase 12.1A adds an offline Dalton Review Workspace for Real Listing Decision Review.

## Purpose

The workspace converts a Phase 12.0C Real Listing Review Batch into a deterministic folder Dalton can open, pause, resume, and complete. It is a human-review workspace only. It does not recompute production decisions and does not grant runtime authority to shadow systems.

## Public API

The module is `validation/daltonReviewWorkspace.js`.

Primary helpers:

- `buildDaltonReviewWorkspace(reviewBatch, options)`
- `validateDaltonReviewWorkspace(workspaceDirOrWorkspace, options)`
- `writeDaltonReviewWorkspace(reviewBatch, workspaceDir, options)`
- `loadDaltonReviewWorkspace(workspaceDir)`
- `generateMarkdownSummary(workspace, reviewBatch)`
- `generateReviewForm(reviewPackage)`
- `buildReviewProgress(workspace, packages, reviewEntries, options)`
- `resumeDaltonReviewWorkspace(workspaceDir)`
- `attachCompletedHumanReviewRecord(workspaceDir, packageId, reviewRecord, options)`
- `rebuildWorkspaceSummaries(workspaceDir, options)`
- `exportCompletedReviewedBatch(workspaceDir, options)`
- fingerprint helpers for workspace, progress, and completed batches

## Workspace Layout

The deterministic folder layout is:

```text
review-workspace/
  workspace.json
  batch.json
  README.md
  batch-summary.md
  progress.json
  packages/
    <packageId>.json
  reviews/
    <packageId>.review.json
  summaries/
    <packageId>.md
  completed/
    reviewed-batch.json
```

Package files are immutable review evidence. Review files are stored separately and reference the package they review.

## Review Workflow

1. Build a Real Listing Review Batch with Phase 12.0C.
2. Generate the Dalton Review Workspace.
3. Dalton reviews Markdown forms under `summaries/`.
4. Completed human review records are written under `reviews/`.
5. Progress is reconstructed from package and review files.
6. When all valid packages have reviews, the workspace can export `completed/reviewed-batch.json`.

## Resume Behavior

`resumeDaltonReviewWorkspace` loads an incomplete workspace and reports:

- reviewed package IDs
- pending package IDs
- next recommended package ID
- current status
- validation and integrity result

Valid completed reviews are preserved. Conflicting review records are not silently overwritten.

## Integrity Rules

Validation detects:

- missing manifest files
- unexpected files
- invalid package files
- invalid review files
- package fingerprint mismatches
- snapshot fingerprint mismatches
- mismatched batch IDs
- duplicate package IDs
- duplicate review package IDs

Derived Markdown and progress files can be rebuilt without changing immutable package fingerprints.

## Completed Export

`exportCompletedReviewedBatch` builds a deterministic completed batch containing:

- original immutable batch
- reviewed packages with attached Phase 12.0B human review records
- completion summary
- aggregate review status
- completed timestamp
- `productionImpact: "none"`
- `decisionImpact: "none"`
- completed-batch fingerprint

Incomplete workspaces return an explicit incomplete completed-batch object and do not write `completed/reviewed-batch.json` unless explicitly requested.

## Evidence-Only Boundary

The workspace must not:

- modify `server.js`
- integrate with scanner runtime
- change scoring, valuation, Deal Gate, BUY_NOW, or notifications
- write Canonical Sold Evidence
- modify production persistence
- promote shadow diagnostics

Review outcomes are evidence for future governance only.

## Operator Instructions

Dalton should review the Markdown form for each package, then create a matching structured review JSON using the Phase 12.0B human review contract fields. The original package JSON should not be edited. If a session is interrupted, rerun the resume workflow to identify the next pending package.
