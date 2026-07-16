# Canonical Provider Qualification Workflow

Phase 9.2 adds an offline workflow that converts an approved Canonical Source Decision Dossier into a governed provider qualification package.

The workflow is a bridge between:

- `validation/canonicalSourceDecisionDossier.js`
- `validation/providerEvaluation.js`

It does not replace either contract. The dossier remains the source-decision evidence ledger, and provider evaluation remains the source-qualification evaluator.

## Module

```text
validation/canonicalProviderQualificationWorkflow.js
```

The workflow reuses:

- `validation/canonicalSourceDecisionDossier.js` for dossier normalization, lookup, and dossier fingerprints,
- `validation/providerEvaluation.js` for the actual provider evaluation report,
- `validation/phase8GovernanceCore.js` for offline authority flags and deterministic blocking-reason helpers,
- `validation/fingerprintProjection.js` for stable package fingerprints.

## Workflow Purpose

The workflow answers:

> Can this source decision dossier safely be converted into a provider evaluation package, and what still blocks the provider from adapter planning?

It can load or accept a dossier, validate required facts, map dossier facts into the existing provider evaluation input shape, run provider evaluation when safe, and produce a deterministic qualification package.

## Workflow States

- `incomplete`
- `blocked`
- `ready_for_evaluation`
- `evaluated`
- `awaiting_business_decision`
- `qualified_for_adapter_planning`
- `rejected`

`qualified_for_adapter_planning` is not production approval. It means the provider evaluation result supports future adapter-planning work under separate governance.

## Required Dossier Facts

The workflow blocks qualification when required facts are missing, unknown, or undocumented:

- provider name,
- intended purpose,
- transaction-level sold-evidence availability,
- accepted-offer visibility,
- API availability,
- licensing status,
- commercial-use status,
- internal-use status,
- valid dossier fingerprint.

Unknown facts remain unknown. The workflow does not infer permission from:

- consumer subscriptions,
- privacy policies,
- marketing pages,
- provider popularity,
- fixture availability,
- active listing access.

## Qualification Package

Each package contains:

- workflow ID,
- dossier ID,
- dossier fingerprint,
- provider identity,
- intended use,
- permission status,
- licensing status,
- API status,
- transaction-level sold-evidence status,
- accepted-offer visibility,
- provider evaluation result,
- provider evaluation fingerprint,
- qualification status,
- blocking reasons,
- unresolved questions,
- required Dalton decisions,
- recommended next action,
- offline authority flags,
- stable fingerprint.

## Provider Evaluation Relationship

When required dossier facts are complete, the workflow maps dossier facts into the existing `evaluateProviderCandidate` input contract and runs that evaluator.

The workflow records the provider evaluation result and fingerprint. It does not modify the evaluation result and does not duplicate the provider evaluation criteria.

## Blocking Rules

Qualification is blocked when:

- no dossier is available,
- the dossier fingerprint is missing or mismatched,
- provider identity or intended use is missing,
- transaction-level sold evidence is unknown or undocumented,
- accepted-offer visibility is unknown,
- API availability is unknown,
- licensing status is unknown or undocumented,
- commercial-use status is unknown or undocumented,
- internal-use status is unknown,
- required Dalton business decisions remain unresolved,
- provider evaluation returns blocking issues.

## Production Safety

Phase 9.2 makes no changes to:

- `server.js`,
- Deal Gate,
- production valuation,
- BUY_NOW behavior,
- notifications,
- marketplace requests,
- scan timing,
- Canonical Sold Evidence Store write paths.

The workflow performs no marketplace communication, no provider communication, no certification registry writes, no safety-gate execution, and no Canonical Sold Evidence writes.
