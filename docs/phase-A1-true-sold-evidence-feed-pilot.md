# Phase A1 - True Sold Evidence Feed Pilot

## Purpose

Phase A1 establishes the smallest legitimate path for true sold transaction evidence to enter CardHawk, become canonical sold evidence, and become visible to the existing production-readable valuation and Deal Gate evidence path.

This phase does not authorize scraping, private endpoints, automated purchasing, bidding, offer submission, Deal Gate threshold changes, or active-listing substitution.

## Source Decision

The selected pilot source is the existing manual verified evidence path:

- `validation/manualSoldEvidenceImportHelper.js`
- `marketplaces/manualAcquisitionAdapter.js`
- `utils/soldEvidenceStore.js`
- `services/soldEvidenceService.js`

Classification: `MANUAL + APPROVED`.

Reason: no approved live transaction-level source exists in the repository. The eBay sold acquisition adapter is currently skeleton or fixture-backed only, and source research packages preserve unresolved approval, licensing, accepted-offer visibility, and retention questions. Owner-supplied verified transaction evidence is the safest legitimate pilot path.

## Source Classification Summary

| Source path | Classification | Pilot use |
|---|---|---|
| Manual verified import | `MANUAL + APPROVED` | Selected |
| Manual acquisition adapter | `MANUAL + APPROVED` | Compatible |
| eBay sold acquisition adapter | `FIXTURE ONLY` | Not live approved |
| Mock sold evidence adapter | `FIXTURE ONLY` | Tests only |
| eBay Browse active search | `UNAVAILABLE` for true sold | Active listings only |
| Third-party historical sources | `UNKNOWN` | Permission unresolved |

## Pilot Scope

The pilot is deliberately narrow. The focused test scope is:

- Category: sports card
- Sport: UFC
- Player: Anthony Hernandez
- Year: 2023
- Product/set: Panini Prizm UFC / Prizm
- Card number: 181
- Parallel: Silver Prizm
- Raw vs. graded: raw
- Rookie: true
- Autograph: false
- Memorabilia: false
- Serial numbered: false

Future pilots should remain equally narrow until exact identity matching and source approval are proven for broader scopes.

## Evidence Requirements

Every imported pilot transaction must preserve or explicitly mark:

- transaction sale price
- transaction sale date
- marketplace/source
- source URL
- source adapter
- retrieval method
- source reliability
- acquisition timestamp
- identity fields
- raw/graded state
- grading company and grade where applicable
- parallel/variation where applicable
- retention status
- source approval status

Missing values must remain explicit. Active listings, aggregate context, missing sale prices, missing sale dates, and missing provenance fail safely.

## Retention Semantics

Canonical sold evidence records now preserve additive retention metadata:

- `retention.status`
- `retention.sourceTerms`
- `retention.retentionNotes`
- `retention.reviewedBy`
- `retention.reviewedAt`
- `retention.sourceApprovalStatus`

Supported statuses include:

- `permanent_allowed`
- `restricted`
- `prohibited`
- `unknown`

Unknown retention remains acceptable for a pilot only when explicitly visible. Unknown or restricted retention should block any future assumption that data can be redistributed, broadly retained, or used outside internal validation.

## Ingestion Flow

The Phase A1 flow is:

```text
owner-supplied verified transaction records
-> manual verified import
-> prevalidation
-> canonical sold evidence normalization
-> canonical record validation
-> duplicate detection
-> canonical sold evidence store
-> sold evidence query by canonical card key
-> runtime sold-sales evidence shape
-> existing valuation and Deal Gate evidence count
```

## Production-Readable Integration

The runtime scoring path now converts active canonical true-sold records into the existing sold-sales evidence shape before Market Value Engine execution.

Important boundaries:

- active/context records are filtered out by the canonical sold evidence query and by evidence-type/status checks
- active-only valuation guard remains unchanged
- Deal Gate sold-comp threshold remains unchanged
- BUY_NOW authority remains unchanged
- shadow/prototype systems remain non-authoritative
- no purchase, bid, or offer behavior is introduced

## Invalid Records

Invalid records are rejected before canonical insertion when they are:

- active/context records
- missing transaction price
- missing transaction date
- missing source URL
- missing source adapter
- missing retrieval method
- missing source reliability
- missing source acquisition timestamp
- missing identity

Duplicate transaction records are deterministic: the first canonical record is retained and later duplicates are reported without overwriting the existing record.

## Market History Compatibility

The canonical sold evidence store is the correct seed for future CardHawk Market History. Already suitable fields include:

- canonical card key
- marketplace and marketplace identifiers
- sale price, shipping, total paid, currency
- sale date
- sale type
- source URL and image URL
- identity fields
- evidence quality
- source metadata
- duplicate keys
- retention metadata

Useful future additions may include richer source license references, source terms artifact fingerprints, verification artifact IDs, price-disclosure confidence, and record-level amendment history.

A future persistence layer may eventually be required for scale, but Phase A1 should reuse Canonical Sold Evidence rather than creating a parallel transaction schema.

## Limitations

Phase A1 does not provide scalable automatic sold evidence acquisition. It proves the safe path from verified records into production-readable evidence. Remaining blockers include:

- no approved live eBay Product Research sold-data feed
- unresolved accepted-offer visibility
- unresolved third-party provider licensing
- no autonomous historical backfill
- no broad Market History system
- no Fresh Listing Hunter, Auction Hunter, or Negotiation Hunter

## Validation Expectations

Focused A1 validation must prove:

- valid true sold record ingestion
- active listing rejection
- missing price rejection
- provenance enforcement
- duplicate handling
- exact identity matching
- identity mismatch exclusion
- retention preservation
- production evidence lookup
- valuation receipt of true sold evidence
- Deal Gate sold-comp count receipt
- active-only valuation guard preservation
- no purchase/bid/offer behavior
