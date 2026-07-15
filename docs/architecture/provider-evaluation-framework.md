# Canonical Provider Evaluation and Source Qualification Framework

Phase 8.6 adds offline provider evaluation tooling for researching and qualifying possible canonical sold-evidence providers before adapter development or offline testing.

The framework is documentation-driven and read-only. It does not contact marketplaces, create certification artifacts, register certification artifacts, authorize live ingestion, or write to the Canonical Sold Evidence Store.

## Module

```text
validation/providerEvaluation.js
```

The module reuses existing contracts:

- `marketplaces/canonicalAcquisitionInterface.js`
- `validation/canonicalValidationCore.js`
- `validation/certificationArtifactRegistry.js`

It does not define a parallel acquisition adapter contract and does not replace marketplace adapter certification.

## Governed Evaluation Criteria

Each candidate provider is evaluated against explicit criteria:

- commercial-use permission status,
- licensing and documentation status,
- transaction-level evidence quality,
- exact identity support,
- accepted-offer visibility,
- provenance quality,
- stable record identifiers,
- historical coverage,
- recency coverage,
- correction and cancellation behavior,
- rate-limit characteristics,
- acquisition reliability,
- schema stability,
- version tracking,
- long-term operational risk.

Criteria produce deterministic `pass`, `partial`, `fail`, or `unknown` statuses. Blocking criteria must pass before the provider can qualify for adapter development or offline testing.

## Qualification States

- `research`: early provider research with insufficient positive evidence.
- `candidate`: promising provider with non-blocking gaps still unresolved.
- `qualified_for_adapter_development`: provider has cleared blocking criteria and major evaluation gaps for adapter design work.
- `blocked`: provider cannot move forward until blocking issues are resolved.
- `rejected`: provider is explicitly rejected.
- `approved_for_offline_testing`: provider is cleared only for controlled offline testing after all blocking and major criteria pass and explicit offline-test approval is recorded.

No qualification state implies production approval.

## Provider Qualification Report

Reports include:

- provider identity,
- provider version,
- evaluation date,
- evaluator,
- permission status,
- licensing status,
- supported capabilities,
- unsupported capabilities,
- strengths,
- weaknesses,
- identified risks,
- blocking issues,
- qualification status,
- recommended next action,
- criteria results,
- projected adapter metadata,
- projected certification registry key,
- stable fingerprint.

The projected certification registry key is informational only. The provider evaluation framework does not create or modify registry entries.

## Production Boundaries

Provider evaluation always reports:

- `productionApproval: false`,
- `liveIngestionAuthority: false`,
- `marketplaceRequestAuthority: false`,
- `canonicalSoldEvidenceWriteAuthority: false`.

Phase 8.6 makes no changes to:

- `server.js`,
- Deal Gate,
- production valuation,
- BUY_NOW behavior,
- notifications,
- marketplace requests,
- scan timing,
- production sold-evidence writes.

## Relationship to Later Work

A qualified provider can become a candidate for adapter design, certification research, or controlled offline testing. Those later activities still require their own adapter implementation, certification artifact, certification registry entry, safety-gate execution, ingestion-run repository record, replay verification, manual operator approval, and dataset governance review.
