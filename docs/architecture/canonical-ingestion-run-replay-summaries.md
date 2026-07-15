# Canonical Ingestion Run Replay and Operational Summaries

Phase 8.3 adds read-only offline tooling for replaying and summarizing persisted canonical ingestion runs.

The replay summary layer consumes the durable run records introduced in Phase 8.2 and the immutable manifest and quarantine artifacts emitted by the Live Ingestion Safety Gate. It does not alter historical run records and does not write canonical sold evidence.

## Module

```text
validation/ingestionRunReplaySummary.js
```

The module can:

- load a persisted ingestion run by exact run ID,
- resolve manifest and quarantine artifact references,
- validate manifest and quarantine integrity through `canonicalArtifactIntegrity`,
- replay saved artifact inputs through the existing replay helper,
- compare original and replayed fingerprints,
- compare original and replayed counts and disposition,
- classify missing replay evidence without inventing inputs,
- produce per-run operational summaries,
- produce aggregate operational summaries across persisted runs.

## Replay Classifications

- `replayed`
- `replayed_with_drift`
- `replayed_with_integrity_failure`
- `non_replayable_missing_run`
- `non_replayable_missing_manifest_reference`
- `non_replayable_missing_quarantine_reference`
- `non_replayable_missing_artifact`
- `non_replayable_invalid_artifact_json`

Non-replayable runs remain explicit. The system does not synthesize manifests, quarantine records, or replay outcomes.

## Operational Summary

Each run summary includes:

- run identity,
- source and adapter identity,
- certification registry entry and artifact fingerprint,
- permission status,
- original run status,
- replay status,
- input, admitted, rejected, quarantined, and duplicate counts,
- manifest and quarantine integrity,
- fingerprint comparison,
- detected drift,
- failure stages,
- canonical reason codes,
- operator review status,
- final disposition,
- recommended follow-up action,
- deterministic summary fingerprint,
- human-readable text.

## Aggregate Summary

Aggregate summaries include:

- total runs,
- completed, partial, failed, and incomplete counts,
- replayable and non-replayable counts,
- fingerprint agreement rate,
- recurring failure stages,
- recurring reason codes,
- source summaries,
- adapter summaries,
- operator-review backlog,
- unresolved or quarantined run count.

## Read-Only Boundary

Replay and summary operations are read-only. They do not:

- modify repository records,
- modify manifest or quarantine artifacts,
- write canonical sold evidence,
- authorize production ingestion,
- change runtime decisions.

## Production Boundaries

Phase 8.3 makes no changes to:

- `server.js`,
- Deal Gate,
- production valuation,
- BUY_NOW behavior,
- notification behavior,
- marketplace requests,
- scan timing,
- production sold-evidence writes.
