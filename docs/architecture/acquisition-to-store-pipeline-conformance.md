# Canonical Acquisition-to-Store Pipeline Conformance

Phase 4.6B adds an offline conformance harness for the full path from a canonical acquisition adapter to Canonical Sold Evidence Store eligibility.

## Purpose

The harness answers one question:

> Can records emitted by an acquisition adapter safely enter the Canonical Sold Evidence Store?

It does not acquire live marketplace data, write to the production store, or influence valuation. It is a dry-run validation layer for future adapter certification and manually verified dataset governance.

## Pipeline

1. Run the adapter through `validation/acquisitionAdapterConformance.js`.
2. Acquire deterministic fixture records through the Canonical Acquisition Interface.
3. Validate the acquisition result shape and per-record acquisition validation.
4. Pass the emitted records into `validation/soldEvidenceStoreConformance.js`.
5. Build a combined report that identifies the exact failure stage for each rejected record.

The Manual Acquisition Adapter is the reference source for this harness.

## Failure Stages

Every rejected record is mapped into one or more canonical stages:

- `adapter_contract`
- `capability_metadata`
- `identity`
- `provenance`
- `evidence_classification`
- `duplicate_handling`
- `store_compatibility`

Manual dataset rows rejected before adapter output are reported separately under `pipeline.manualDataset.rejectedRecords`.

## Report Shape

`runAcquisitionToStorePipelineConformance(adapter, options)` returns:

- `passed`
- `checks`
- `failures`
- `acquisition.summary`
- `acquisition.partialFailures`
- `acquisition.conformance`
- `store.summary`
- `store.conformance`
- `pipeline.recordOutcomes`
- `pipeline.rejectedRecords`
- `pipeline.manualDataset`
- `pipeline.stageSummary`
- `summary`

The report is intentionally verbose because it is meant for debugging adapter readiness and dataset quality before any runtime integration.

## Safety Guarantees

- Offline only.
- Dry-run only.
- No writes to `data/sold-evidence.json`.
- No marketplace calls.
- No `server.js` integration.
- No production valuation impact.
- No ROI impact.
- No Deal Gate or `BUY_NOW` impact.
- No grading, scoring, confidence, recommendation, notification, persistence, or scan timing changes.

## Future Adapter Use

Every future marketplace adapter should pass this harness before being allowed to write canonical sold evidence. Adapters should supply deterministic fixture replay data that includes valid, invalid, duplicate, malformed, and partial-failure records.

Passing this harness means the adapter can produce store-eligible canonical evidence in dry-run validation. It does not approve runtime ingestion or production valuation use.
