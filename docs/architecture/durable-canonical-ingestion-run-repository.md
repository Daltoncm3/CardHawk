# Durable Canonical Ingestion Run Repository

Phase 8.2 adds an append-only JSON repository for canonical ingestion run records.

This repository is an offline governance and audit surface. It does not authorize canonical sold-evidence writes, does not change production valuation, and does not affect Deal Gate, BUY_NOW, notifications, marketplace requests, or scan timing.

## Persistence

The repository persists to:

```text
data/canonical-ingestion-runs.json
```

The store uses `utils/stateStore.js` for JSON load/save, fallback state, corrupt-file backup, and atomic replacement writes.

## Run Record

Each run record includes:

- run ID,
- source ID,
- adapter name and version,
- acquisition method and version,
- certification registry entry ID,
- certification artifact fingerprint,
- permission status,
- dry-run or write mode,
- start and completion timestamps,
- run status,
- total input records,
- admitted record count,
- rejected record count,
- quarantined record count,
- duplicate count,
- admitted-record references,
- quarantine artifact references,
- manifest reference,
- request and response fingerprints,
- replay metadata,
- failure stages,
- canonical reason codes,
- operator review status,
- final disposition,
- deterministic record fingerprint.

## Immutability

Run records are immutable once inserted. A second insert for the same run ID is rejected by default. Corrections should be represented by a separate review/disposition workflow or a future superseding record, not by silently editing historical run evidence.

## Status Model

Supported run statuses are:

- `started`
- `incomplete`
- `completed`
- `partial`
- `failed`

Rejected records, partial acquisition failures, duplicate quarantine, or failed gates are preserved explicitly rather than hidden behind a generic success state.

## Lookup and Listing

The module supports exact lookup by run ID and safe filtered listing by:

- source ID,
- adapter name,
- adapter version,
- run status,
- operator review status,
- final disposition,
- dry-run state.

Returned records are defensive copies.

## Integration Boundary

The repository can build records from existing Live Ingestion Safety Gate reports and artifact replay metadata. The safety gate does not auto-write this repository. A caller must explicitly create and save repository state.

## Safety Guarantees

- No `server.js` changes.
- No Deal Gate changes.
- No production valuation changes.
- No BUY_NOW changes.
- No notification changes.
- No marketplace request changes.
- No scan timing changes.
- No automatic canonical sold-evidence writes.
- No production authority is assigned to stored run records.
