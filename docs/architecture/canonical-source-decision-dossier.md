# Canonical Source Decision Dossier

Phase 9.1 adds a permanent offline governance record for potential Canonical Sold Evidence providers.

The dossier answers an earlier question than provider evaluation:

> What do we currently know about this potential source, and what decision evidence is still missing before it can be evaluated or used?

It does not contact providers, run automatic provider evaluation, certify adapters, approve source permission, or write canonical sold evidence.

## Module

```text
validation/canonicalSourceDecisionDossier.js
```

The module reuses the Phase 8 governance conventions for:

- deterministic fingerprints through `validation/fingerprintProjection.js`,
- offline authority flags through `validation/phase8GovernanceCore.js`,
- JSON persistence through `utils/stateStore.js`,
- stable normalization helpers from `validation/canonicalValidationCore.js`.

## Persistence

The dossier store persists to:

```text
data/canonical-source-decision-dossiers.json
```

The store is additive governance state. It is not a production data source and is not queried by the runtime.

## Dossier Contents

Each dossier records:

- provider name,
- provider category,
- intended purpose,
- transaction-level sold evidence availability,
- accepted-offer visibility,
- API availability,
- licensing status,
- commercial-use status,
- internal-use status,
- attribution requirements,
- redistribution restrictions,
- technical readiness,
- provider maturity,
- pricing model,
- documentation links,
- evaluation date,
- evaluator,
- qualification status,
- blocking reasons,
- recommended next action,
- deterministic fingerprint.

## Public API

Primary exports:

- `createEmptyDecisionDossierStore`
- `createDecisionDossier`
- `addDecisionDossier`
- `updateDecisionDossier`
- `getDecisionDossier`
- `listDecisionDossiers`
- `buildDecisionDossierFingerprint`

Persistence helpers:

- `loadDecisionDossierStore`
- `saveDecisionDossierStore`

Constants:

- `DEFAULT_DOSSIER_STORE_PATH`
- `QUALIFICATION_STATUS`
- `RECOMMENDED_ACTION`

## Boundaries

A source decision dossier is not any of the following:

- commercial-use permission,
- provider qualification,
- adapter certification,
- certification registry approval,
- live-ingestion safety-gate approval,
- pilot approval,
- Canonical Sold Evidence Store write approval,
- production valuation input.

The module does not make marketplace requests and does not integrate with `server.js`.

## Relationship To Provider Evaluation

Provider evaluation remains owned by:

```text
validation/providerEvaluation.js
```

The dossier may record that a provider should be sent to evaluation, but it does not perform that evaluation automatically. This separation prevents a business or licensing decision record from being confused with technical qualification.

## Fingerprints

`buildDecisionDossierFingerprint` fingerprints only governed dossier facts and offline authority flags. Persistence timestamps are excluded so saving or updating store metadata does not change a dossier fingerprint.

Changing a governed source fact, blocking reason, qualification status, or recommended next action changes the fingerprint.

## Production Safety

Phase 9.1 makes no changes to:

- `server.js`,
- Deal Gate,
- production valuation,
- BUY_NOW behavior,
- notifications,
- marketplace behavior,
- marketplace request timing,
- scan timing,
- Canonical Sold Evidence Store write paths.
