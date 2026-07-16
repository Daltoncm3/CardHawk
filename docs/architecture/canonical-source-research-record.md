# Canonical Source Research Record and Evidence Packet Framework

Phase 9.3 adds an offline framework for preserving the evidence used to populate Canonical Source Decision Dossiers.

This layer sits below:

- `validation/canonicalSourceDecisionDossier.js`
- `validation/canonicalProviderQualificationWorkflow.js`
- `validation/providerEvaluation.js`

It records research evidence and produces deterministic packet summaries. It does not approve providers, infer permission, contact providers, certify adapters, or write canonical sold evidence.

## Module

```text
validation/canonicalSourceResearchRecord.js
```

The module reuses:

- `validation/phase8GovernanceCore.js` for offline authority flags,
- `validation/fingerprintProjection.js` for deterministic fingerprints,
- `validation/canonicalValidationCore.js` for stable array/object normalization.

## Source Research Record

Each research record captures:

- provider/source identity,
- research date,
- researcher,
- intended use,
- official website,
- official terms or license references,
- privacy policy reference,
- API documentation reference,
- pricing reference,
- sales-data claims,
- transaction-level evidence claims,
- accepted-offer visibility claims,
- commercial-use claims,
- internal-use claims,
- attribution requirements,
- redistribution restrictions,
- contact email,
- outreach date,
- provider response status,
- provider response summary,
- unresolved questions,
- source citations or document references,
- research confidence,
- stable fingerprint.

Records preserve raw claims. They are not source permission, provider qualification, adapter certification, or ingestion authority.

## Evidence Classes

Supported evidence classes:

- `official_terms`
- `official_api_documentation`
- `official_pricing`
- `official_privacy_policy`
- `provider_correspondence`
- `marketing_claim`
- `operator_note`
- `third_party_reference`

Only `official_terms` and `provider_correspondence` can support permission or licensing conclusions. Marketing claims and third-party references are context only.

## Evidence Packet

An evidence packet groups multiple research records for one provider and preserves:

- normalized research records,
- raw claims,
- operator conclusions,
- contradictions,
- stale or undated evidence findings,
- unknown facts,
- a deterministic dossier-ready summary,
- stable packet fingerprint.

The packet keeps raw claims separate from operator conclusions so later reviewers can inspect where a dossier fact came from.

## Contradiction Rules

Contradictions are flagged when positive and negative claims exist for the same governed fact. For example, one official terms record may say commercial use is approved while provider correspondence says it is prohibited.

Contradictions block clean dossier promotion by adding `contradictory_source_evidence` to the dossier summary blocking reasons.

## Unknown-Fact Rules

Facts remain `unknown` when no authoritative evidence class supports them.

The packet tracks unknowns for:

- transaction-level sold-evidence availability,
- accepted-offer visibility,
- API availability,
- licensing status,
- commercial-use status,
- internal-use status.

Marketing pages, third-party references, provider popularity, consumer subscriptions, active listing access, and operator notes do not establish permission or licensing.

## Stale and Undated Evidence

Research records without a research date are flagged as `undated_evidence`.

Records older than the configured staleness window are flagged as `stale_evidence`.

Stale or undated evidence adds `stale_or_undated_source_evidence` to the dossier summary blocking reasons.

## Dossier Summary

`summarizeEvidencePacketForDossier` returns a deterministic object suitable for creating or updating a Canonical Source Decision Dossier.

The summary is not a dossier by itself. A later operator-driven step must still review the packet and decide whether to create or update a dossier.

## Production Safety

Phase 9.3 makes no changes to:

- `server.js`,
- Deal Gate,
- production valuation,
- BUY_NOW behavior,
- notifications,
- marketplace requests,
- scan timing,
- Canonical Sold Evidence Store write paths.

The framework performs no marketplace communication, no provider communication, no network access, no certification registry writes, and no Canonical Sold Evidence writes.
