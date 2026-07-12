# eBay Acquisition Adapter Skeleton

Phase 4.7B adds the first marketplace-ready adapter skeleton for eBay.

This is not a live integration. It makes no network requests, calls no eBay APIs, performs no scraping, and writes no production canonical sold evidence.

## Purpose

The adapter establishes the permanent shape future eBay sold-evidence acquisition should follow:

- Canonical Acquisition Interface implementation
- Configuration placeholders
- Capability declarations
- Versioning
- Health reporting
- Adapter registration
- Request translation interface
- Response translation interface
- Authentication placeholders
- Rate-limit placeholders
- Retry placeholders
- Pagination placeholders
- Marketplace-specific validation hook

## Current Status

The adapter is a skeleton.

Acquisition returns a structured `ebay_acquisition_not_implemented` error with zero records. This is intentional. Until an approved sold-evidence source and commercial usage path are selected, eBay must not emit `true_sold` evidence.

## Declared Capabilities

Current capability values are conservative:

- `accessMode`: `official_api`
- `transactionLevelSoldSupport`: `false`
- `aggregateMarketPriceSupport`: `false`
- `activeContextSupport`: `false`
- `acceptedBestOfferSupport`: `false`
- `shippingSupport`: `false`
- `certificationSupport`: `false`
- `supportsIncrementalSync`: `false`
- `supportsHistoricalBackfill`: `false`
- `supportsHealthCheck`: `true`

Commercial use is marked as requiring approval.

## Certification Status

The skeleton can pass interface and dry-run conformance checks where applicable because it returns well-formed placeholder results.

It remains `Draft` in Marketplace Adapter Certification because:

- It emits no store-eligible records.
- It does not support transaction-level true sold evidence yet.
- It has no approved live acquisition source.
- It has no production approval metadata.

## Safety Guarantees

- No eBay API calls.
- No scraping.
- No network access.
- No production sold evidence store writes.
- No `server.js` changes.
- No runtime behavior changes.
- No valuation impact.
- No ROI impact.
- No Deal Gate or `BUY_NOW` impact.
- No grading, scoring, confidence, recommendation, notification, persistence, or scan timing changes.

## Required Work Before Live Integration

Before this adapter can move beyond skeleton status:

1. Select and approve the exact eBay sold-evidence source.
2. Confirm licensing and commercial usage permissions.
3. Implement authentication.
4. Implement request translation against the approved endpoint.
5. Implement response translation into canonical evidence records.
6. Implement pagination, retry, and rate-limit handling.
7. Add deterministic live-shaped fixture replay.
8. Pass Marketplace Adapter Certification with store-eligible true sold records.
9. Complete a separate runtime ingestion approval phase.

Certification alone must not enable production ingestion.
