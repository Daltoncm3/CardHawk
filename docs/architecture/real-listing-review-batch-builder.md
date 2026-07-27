# Real Listing Review Package Batch Builder

Phase 12.0C adds an offline batch-generation layer for Real Listing Decision Review packages.

## Purpose

The batch builder converts supplied real-listing production outputs, shadow outputs, diagnostics, and review-candidate metadata into deterministic batches of Phase 12.0B review packages.

It prepares portable review material for Dalton without integrating into production runtime behavior.

## Public API

The module is `validation/realListingReviewBatchBuilder.js`.

Primary helpers:

- `selectReviewCandidates(records, options)`
- `buildReviewPackageForCandidate(entry, options)`
- `buildRealListingReviewBatch(recordsOrPackages, options)`
- `validateRealListingReviewBatch(batch)`
- `summarizeBatchComposition(batchOrPackages)`
- `exportRealListingReviewBatch(batch)`
- `importRealListingReviewBatch(input)`
- `filterReviewPackages(batchOrPackages, filters)`
- `sortReviewPackages(packages)`
- `buildReviewBatchFingerprint(batch)`
- `writeRealListingReviewBatch(batch, outputPath)`

## Batch Schema

Each batch contains:

- `schemaVersion`
- `batchId`
- `createdAt`
- `source`
- `selectionPolicy`
- `requestedCandidateCount`
- `selectedCandidateCount`
- `packageCount`
- `reviewStatusSummary`
- `candidateCategorySummary`
- `productionImpact: "none"`
- `decisionImpact: "none"`
- `packages`
- `batchFingerprint`

The batch fingerprint excludes the fingerprint field itself.

## Candidate Selection

Candidate selection ranks learning value, not investment value. The builder uses supplied review-candidate metadata and supplied diagnostic outputs. It does not infer unsupported facts and does not treat missing diagnostics as negative evidence.

Supported batch categories include:

- `production_shadow_disagreement`
- `identity_conflict`
- `valuation_conflict`
- `evidence_sufficiency_conflict`
- `confidence_conflict`
- `strong_evidence_rejected`
- `production_only_support`
- `shadow_only_support`
- `possible_false_positive`
- `possible_missed_opportunity`
- `buy_now_candidate`
- `notification_candidate`
- `learning_opportunity`
- `edge_case`
- `random_baseline`

Unsupported categories are ignored. If no supported category can be detected and baseline inclusion is enabled, the listing can be included as `learning_opportunity`.

The existing Validation Candidate Selector can be used through an explicit compatibility option, but the default batch path does not load engine-backed selectors or recompute production decisions.

## Export and Import

`exportRealListingReviewBatch` returns stable pretty-printed JSON with a trailing newline. `importRealListingReviewBatch` accepts either a JSON string, a file path, or an object and returns both the parsed batch and validation result.

Export and import preserve package structure and fingerprints.

## Evidence-Only Boundary

The batch builder must not:

- modify `server.js`
- call production scoring engines
- recompute production decisions
- alter Deal Gate or BUY_NOW outcomes
- send notifications
- write Canonical Sold Evidence
- modify production state
- promote shadow diagnostics

Every batch and package preserves `productionImpact: "none"` and `decisionImpact: "none"`.

## Future Extension

Future review UIs, marketplace adapters, canonical sold-evidence references, provider-backed evidence, and purchase/resale outcomes should be added through additive package or batch metadata. Existing package and batch fingerprints should continue to protect the exact material Dalton reviewed.
