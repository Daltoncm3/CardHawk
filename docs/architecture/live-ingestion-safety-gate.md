# Canonical Live Ingestion Safety Gate

Phase 4.8B adds the admission layer between certified acquisition adapters and the Canonical Sold Evidence Store.

This layer is offline/live-ready only. It does not connect to any source, modify runtime behavior, or allow production valuation influence.

## Purpose

The safety gate answers:

> May this adapter output be admitted into the canonical sold evidence store?

Admission is separate from acquisition. An adapter can acquire or emit records, but the gate decides whether those records are eligible for store insertion.

## Mandatory Admission Requirements

The gate requires:

- A Marketplace Adapter Certification artifact.
- `Production Approved` certification level.
- Exact adapter `sourceId`, `adapterName`, and `adapterVersion` match.
- Certification standard version match.
- Source permission status of `approved`.
- Licensing metadata proving commercial evidence use is permitted.
- Acquisition method name and version.
- Valid canonical schema.
- Valid identity.
- Valid provenance.
- `true_sold` evidence type.
- Transaction-level sold eligibility.
- Duplicate detection.

If any requirement fails, the record is quarantined.

## Dry-Run Default

The gate defaults to dry-run mode.

Store writes require both:

- `dryRun: false`
- `allowStoreWrite: true`

Even then, this module only returns an updated store object. It does not write to the production canonical sold evidence file.

## Run Manifests

Every run produces a manifest containing:

- Unique ingestion run ID
- Adapter metadata
- Certification metadata
- Source permission metadata
- Acquisition method metadata
- Request fingerprint
- Response fingerprint
- Certification artifact fingerprint
- Batch summary
- Partial-failure summary
- Failure classifications
- Artifact paths when persisted

When an `outputDir` is provided, the manifest is written to:

`<outputDir>/<runId>/manifest.json`

## Quarantine

Rejected records are written to:

`<outputDir>/<runId>/quarantine.json`

Quarantine records include:

- Run ID
- Record index
- Record ID
- Canonical card key
- Evidence type
- Failure classification
- Failure stages
- Reasons
- Duplicate target when applicable
- Request and response fingerprints

## Failure Classifications

The gate classifies acquisition failures as:

- `retryable`
- `terminal`
- `partial`
- `degraded`
- `rate_limited`

These classifications are reporting-only in this phase.

## Safety Guarantees

- No live source connection.
- No API calls.
- No scraping.
- No runtime integration.
- No `server.js` changes.
- No production store file writes.
- No valuation impact.
- No ROI impact.
- No Deal Gate or `BUY_NOW` impact.
- No grading, scoring, confidence, recommendation, notification, persistence, or scan timing changes.

## Future Use

Before any live adapter can write canonical sold evidence:

1. Adapter must be Production Approved.
2. Source permission and licensing must be approved.
3. Acquisition output must pass this gate.
4. A run manifest and quarantine report must be persisted.
5. A separate phase must explicitly approve store writes.

This gate is the final admission checkpoint before canonical storage. It is not a runtime valuation signal.
