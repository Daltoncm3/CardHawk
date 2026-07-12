# eBay Response Translator

## Purpose

The eBay Response Translator converts offline eBay-shaped fixture records into Canonical Acquisition records. It prepares CardHawk for a future compliant eBay sold-evidence adapter without connecting to eBay, scraping, calling APIs, or changing runtime behavior.

This phase is offline-only. The translator does not write to the production canonical sold evidence store and has no effect on valuation, ROI, Deal Gate, BUY_NOW, grading, scoring, confidence, recommendations, notifications, persistence behavior, or scan timing.

## Inputs

The translator consumes the existing fixture library:

`tests/fixtures/ebay/sold-listing-scenarios.json`

Each fixture contains:

- `ebayRecord`: an eBay-shaped record
- `expected`: expected normalized identity, sale type, evidence type, and validation posture
- fixture metadata and tags

The translator can also accept an individual eBay-shaped record without fixture expectations. In that case it performs conservative title-based inference and emits warnings when identity or transaction evidence is incomplete.

## Outputs

The translator emits Canonical Acquisition-compatible records containing:

- marketplace metadata
- item/listing identifiers
- title
- listing/sale type
- sold price
- shipping
- sold date
- currency
- seller metadata
- URL and image
- condition
- grading company
- grade
- certification number
- parsed identity
- provenance metadata
- structured translation warnings

The fixture-library translation returns a normalized acquisition result with:

- `source`
- `records`
- `validation`
- `warnings`
- `errors`
- `metadata`
- `summary`
- `translationSummary`

## Normalization Scope

The translator normalizes:

- title
- marketplace
- listing type
- sold price
- sold date
- currency
- seller metadata
- item ID
- grading company
- grade
- certification number
- player/character
- year
- manufacturer/brand
- set
- card number
- parallel
- autograph
- memorabilia
- serial numbering
- raw vs graded

## Evidence Safeguards

The translator preserves the separation between:

- `true_sold`
- `aggregate_market_price`
- `active_context`
- `fallback_unknown` before Canonical Acquisition normalization

Undisclosed Best Offer prices do not become true sold evidence. Multi-variation listings and multi-card lots remain context only unless a future certified adapter can identify the exact sold variation or single-card price.

## Structured Warnings

Each translated raw record may include `translationWarnings`, with:

- `code`
- `message`
- `severity`

Warnings are emitted for missing item IDs, missing titles, invalid URLs, missing prices, missing sold dates, undisclosed Best Offer prices, multi-variation ambiguity, multi-card lots, fixture edge cases, and title-only identity inference.

## Validation

The translator reuses:

- `validation/canonicalValidationCore.js`
- `marketplaces/canonicalAcquisitionInterface.js`
- `validation/ebayFixtureLibrary.js`
- Acquisition Adapter Conformance Harness
- Acquisition-to-Store Pipeline Harness
- Marketplace Adapter Certification Framework

Tests validate the translated output against conformance and certification tooling using a fixture-only adapter. This confirms shape and eligibility without enabling live acquisition.

## Relationship To The eBay Adapter Skeleton

The existing eBay Acquisition Adapter remains a skeleton and still returns not-implemented acquisition results. The translator is standalone and offline. A future phase may attach it behind a compliant, certified eBay acquisition source, but this phase intentionally does not do that.

## Remaining Work Before Live eBay Integration

Before any live eBay integration:

- identify and approve a compliant eBay sold-evidence source
- confirm commercial usage rights
- implement authentication
- implement request execution
- implement pagination and rate limits
- certify the adapter against deterministic fixtures
- pass the live ingestion safety gate
- preserve production decision isolation until explicitly approved
