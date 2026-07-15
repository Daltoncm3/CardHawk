# Controlled Canonical Ingestion Pilot Framework

Phase 8.7 adds an offline-first framework for planning and validating tightly scoped canonical ingestion pilots.

The framework is operator-driven and read-only. It does not run marketplace requests, does not integrate into `server.js`, and does not automatically write to the Canonical Sold Evidence Store.

## Module

```text
validation/canonicalIngestionPilotFramework.js
```

The module reuses existing contracts:

- `validation/providerEvaluation.js`
- `validation/certificationArtifactRegistry.js`
- `validation/marketplaceAdapterCertification.js`
- `validation/liveIngestionSafetyGate.js`
- `validation/ingestionRunReplaySummary.js`
- `validation/canonicalValidationCore.js`

It does not define a parallel provider, certification, registry, safety-gate, ingestion-run, replay, or fingerprint contract.

## Pilot Plan

A pilot plan assembles:

- provider evaluation,
- source-permission status,
- adapter certification status,
- certification registry entry,
- acquisition method and version,
- safety-gate configuration,
- batch limits,
- dry-run requirements,
- quarantine-review requirements,
- replay requirements,
- backup requirements,
- operator-approval requirements,
- rollback requirements,
- dataset target scope.

Each plan includes:

- pilot ID,
- provider identity,
- source ID,
- adapter name and version,
- acquisition method and version,
- certification registry entry ID,
- permission status,
- pilot mode,
- batch size limit,
- identity scope,
- expected record scope,
- readiness status,
- blocking reasons,
- required approvals,
- recommended next action,
- stable fingerprint.

## Pilot States

- `draft`: pilot information is not yet complete.
- `blocked`: one or more required readiness elements are missing or invalid.
- `ready_for_dry_run`: all planning requirements are satisfied and the pilot can proceed to an offline dry run.
- `dry_run_complete`: dry run has completed but replay has not been verified.
- `quarantine_review_required`: dry run produced quarantine evidence that requires operator review.
- `replay_verified`: replay evidence agrees and the pilot remains read-only.
- `awaiting_operator_approval`: replay is verified but manual operator approval is not recorded.
- `approved_for_limited_write`: a future, manual, narrowly scoped write step may be considered.
- `rejected`: pilot was rejected.
- `completed`: pilot was completed and closed.
- `rolled_back`: pilot was rolled back and requires review.

`approved_for_limited_write` is not production approval and does not perform or authorize automatic writes.

## Readiness Rules

A pilot remains blocked when any required element is missing or invalid:

- commercial-use permission,
- qualified provider status,
- Production Approved adapter certification,
- valid certification registry entry,
- exact adapter/version match,
- safety-gate readiness,
- batch limit,
- dry-run requirement,
- quarantine-review requirement,
- backup plan,
- rollback plan,
- replay plan,
- operator-approval requirement,
- dataset target scope.

## Result Evaluation

Pilot result evaluation compares:

- planned versus actual input counts,
- admitted, rejected, quarantined, and duplicate counts,
- manifest integrity,
- quarantine integrity,
- replay agreement,
- fingerprint agreement,
- blocking failures,
- rollback requirement,
- final pilot disposition.

Result evaluation consumes existing ingestion-run records and replay summaries. It does not mutate historical run records.

## Production Boundaries

Pilot plans and results always report:

- `productionApproval: false`,
- `liveIngestionAuthority: false`,
- `marketplaceRequestAuthority: false`,
- `automaticStoreWriteAuthority: false`,
- `canonicalSoldEvidenceWriteAuthority: false`.

Phase 8.7 makes no changes to:

- `server.js`,
- Deal Gate,
- production valuation,
- BUY_NOW behavior,
- notifications,
- marketplace requests,
- scan timing,
- production sold-evidence writes.
