# Canonical Artifact Integrity and Replay Validation

## Purpose

The Canonical Artifact Integrity layer validates immutable certification artifacts and live-ingestion run artifacts before any future marketplace source can be trusted for store admission analysis.

This layer is offline-only. It does not connect to live sources, does not call marketplace adapters, does not write to the production canonical sold evidence store, and has no influence on valuation, ROI, Deal Gate, BUY_NOW, grading, scoring, confidence, recommendations, notifications, persistence behavior, or scan timing.

## Artifacts

The layer validates three artifact types:

- Certification artifacts produced by the Marketplace Adapter Certification framework.
- Ingestion manifests produced by the Canonical Live Ingestion Safety Gate.
- Quarantine artifacts produced beside each ingestion manifest.

The validation contract reuses `validation/canonicalValidationCore.js` for:

- schema versions
- immutable schema descriptors
- reason code conventions
- validation result shape
- fingerprinting
- shared object and array normalization helpers

## Certification Integrity

Certification artifact validation checks:

- required immutable certification fields
- required adapter identity fields
- certification schema version
- certification standard version
- adapter version and identity consistency
- expected fingerprint match
- embedded integrity fingerprint match, when present
- fixture version compatibility, when supplied
- expired certification status
- revoked certification status
- compatibility with the existing live ingestion gate certification validator

Missing `schemaVersion` is treated as a backwards-compatible warning for older artifacts. A present but incompatible schema version is a validation failure.

## Manifest Integrity

Ingestion manifest validation checks:

- required immutable manifest fields
- manifest schema version
- live ingestion gate version
- adapter identity consistency
- expected manifest fingerprint match, when supplied
- embedded integrity fingerprint match, when present
- certification artifact fingerprint linkage, when supplied
- deterministic run fingerprint reconstruction
- fixture version compatibility, when supplied
- safety claims, including dry-run/store-write conflicts

The run fingerprint is reconstructed from:

- `runId`
- adapter metadata
- request fingerprint
- response fingerprint
- certification artifact fingerprint

## Quarantine Integrity

Quarantine validation checks:

- required quarantine fields
- run ID linkage to the manifest
- quarantine source and version
- rejected-record count consistency
- duplicate-record count consistency
- failure classification count consistency
- rejected-record request/response fingerprint linkage
- presence of failure stages on quarantined records

Missing embedded quarantine integrity fingerprints are backwards-compatible warnings because older artifacts were persisted before this layer existed.

## Replay Semantics

Replay is deterministic artifact replay, not marketplace replay.

The saved manifest and quarantine do not contain raw marketplace responses or original source records. Therefore this layer replays:

- artifact validation
- fingerprint reconstruction
- quarantine outcome validation
- partial-failure classification summaries
- quarantined-record outcomes

It does not reacquire data and does not write to the canonical store.

Replay produces an outcome fingerprint from:

- certification validity and reasons
- manifest validity and reasons
- quarantine validity and reasons
- rejected-record outcomes
- partial-failure counts
- failure-classification counts

Running replay twice against the same saved artifacts must produce the same outcome fingerprint.

## Persistence

The integrity layer writes only when an explicit offline output path is supplied. It has no default output path and no production persistence side effects.

## Failure Classes Covered

The tests cover:

- valid certification artifacts
- expired certifications
- revoked certifications
- malformed certifications
- incompatible certification versions
- adapter-version mismatch
- fixture-version mismatch
- manifest fingerprint tampering
- manifest run fingerprint mismatch
- manifest version drift
- quarantine summary tampering
- quarantine record fingerprint mismatch
- partial-failure replay
- quarantined-record replay
- large-batch deterministic replay
- backwards-compatible artifacts without schemaVersion

## Limitations

This layer cannot prove that marketplace data was originally acquired correctly. It can only validate the immutable artifacts produced after acquisition and gate evaluation.

Because persisted manifests intentionally do not include full raw source records, replay cannot rebuild store admission from raw acquisition data. That remains the job of the Acquisition-to-Store Pipeline Harness before an ingestion run is created.
