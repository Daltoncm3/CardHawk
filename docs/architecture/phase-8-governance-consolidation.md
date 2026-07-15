# Phase 8 Governance Consolidation

Phase 8.B adds small shared helpers for behavior-preserving governance plumbing across the Phase 8 offline canonical-ingestion modules.

The consolidation does not add runtime functionality, does not change public APIs, and does not alter production behavior.

## Shared Helpers

```text
validation/phase8GovernanceCore.js
validation/fingerprintProjection.js
tests/helpers/phase8CanonicalFixtures.js
```

`phase8GovernanceCore.js` contains only small reusable primitives:

- clone helper,
- first-defined value selection,
- deterministic blocking-reason collection,
- requirement normalization,
- offline authority flag generation,
- first-matching recommended-action selection.

It does not contain domain-specific states, statuses, enums, certification rules, replay rules, dataset rules, provider rules, or pilot business logic.

`fingerprintProjection.js` standardizes the act of fingerprinting explicit projection objects. Each caller still owns its domain-specific projection fields, preserving existing fingerprint values.

`tests/helpers/phase8CanonicalFixtures.js` centralizes common deterministic fixtures used by Phase 8 tests.

## Fingerprint Preservation

Existing public fingerprint builders remain in their original modules. The helper wraps the existing canonical fingerprint function and receives the same projection objects used before consolidation.

The following public APIs remain intact:

- `buildRegistryEntryFingerprint`
- `buildIngestionRunRecordFingerprint`
- `buildWorkflowFingerprint`
- `buildProviderEvaluationFingerprint`
- `buildCanonicalIngestionPilotFingerprint`
- `buildPilotResultFingerprint`

## Production Boundaries

Phase 8.B makes no changes to:

- `server.js`,
- Deal Gate,
- production valuation,
- BUY_NOW behavior,
- notifications,
- marketplace behavior,
- scan timing,
- canonical sold-evidence writes.

All Phase 8 governance layers remain offline, deterministic, and operator-driven.
