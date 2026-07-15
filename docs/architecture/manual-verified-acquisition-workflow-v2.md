# Manual Verified Acquisition Workflow v2

Phase 8.4 adds an offline, operator-driven workflow for controlled manually verified canonical sold-evidence ingestion.

The workflow is a governance and readiness layer. It never writes to the Canonical Sold Evidence Store and does not make production decisions. A positive write-eligibility result means the batch has passed the offline controls required for a later explicit manual-write process.

## Module

```text
validation/manualVerifiedAcquisitionWorkflow.js
```

The module coordinates existing contracts:

- `marketplaces/manualAcquisitionAdapter.js`
- `validation/soldEvidenceDatasetPilot.js`
- `validation/acquisitionToStorePipelineConformance.js`
- `validation/certificationArtifactRegistry.js`
- `validation/liveIngestionSafetyGate.js`
- `validation/ingestionRunRepository.js`
- `validation/ingestionRunReplaySummary.js`
- `validation/canonicalValidationCore.js`

It does not duplicate certification, validation, replay, fingerprint, or persistence logic.

## Workflow Stages

The workflow guides a manual batch through:

- source-permission declaration,
- batch identity and metadata creation,
- adapter and acquisition-method identification,
- certification registry resolution,
- canonical record validation,
- identity validation,
- transaction eligibility review,
- duplicate detection,
- dry-run safety-gate execution,
- quarantine review,
- ingestion-run record creation,
- replay verification,
- explicit operator approval state,
- final write-eligibility decision.

## Workflow States

- `draft`
- `validated`
- `dry_run_complete`
- `quarantine_review_required`
- `replay_verified`
- `awaiting_operator_approval`
- `approved_for_manual_write`
- `rejected`
- `incomplete`

## Write Eligibility

Write eligibility is blocked by:

- missing batch evidence,
- missing or invalid source permission,
- unresolved or invalid certification registry entry,
- invalid manual records,
- duplicate manual records,
- failed pipeline conformance,
- failed dry-run safety gate,
- unresolved quarantine records,
- missing replay evidence,
- replay drift,
- missing explicit operator approval,
- explicit operator rejection.

The workflow always reports `productionStoreWritePerformed: false`.

## Result Shape

Each result includes:

- workflow ID,
- batch ID,
- source identity,
- adapter and acquisition versions,
- certification registry entry,
- permission status,
- input, valid, invalid, duplicate, admitted, and quarantined counts,
- validation results,
- safety-gate result,
- ingestion-run record,
- replay summary,
- operator review status,
- write eligibility,
- blocking reasons,
- recommended next action,
- stable workflow fingerprint.

## Production Boundaries

Phase 8.4 makes no changes to:

- `server.js`,
- Deal Gate,
- production valuation,
- BUY_NOW behavior,
- notifications,
- marketplace requests,
- scan timing,
- production sold-evidence writes.
