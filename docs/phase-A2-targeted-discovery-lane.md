# Phase A2 - Targeted Discovery Lane

## Purpose

Phase A2 adds one narrow, production-safe Targeted Discovery Lane for CardHawk. The lane improves active-listing discovery coverage for a specific sports-card segment without changing valuation, Deal Gate, BUY_NOW, notification authority, sold-evidence acquisition, or purchasing behavior.

The lane answers what CardHawk is monitoring, how it queries eBay Browse active inventory, how much inventory it sees, which listings are new, what was rejected cheaply, what survived for later analysis, and what freshness can be measured from marketplace timestamps.

## Current Discovery Findings

Repository inspection confirmed the current production discovery path:

- `server.js` defines broad sport/category query lanes.
- `services/scoutScannerService.js` runs each broad lane query against the active marketplace.
- `marketplaces/marketplaceRegistry.js` selects eBay as the live active marketplace.
- `marketplaces/ebayMarketplace.js` uses the eBay Browse `item_summary/search` endpoint for active inventory.
- The eBay Browse filter includes `FIXED_PRICE` and `AUCTION` buying options.
- `EBAY_SCAN_QUERY_LIMIT` defaults to `8`.
- `SCOUT_INTERVAL_MINUTES` defaults to `10`.
- The current broad scanner executes approximately 36 broad query templates per scan.
- Before A2, no scanner pagination loop, newly-listed sort, or offset handling was implemented.
- Listing history is owned by `engines/historyEngine.js`, which tracks first seen time, last seen time, lane, query, price, price drops, active/disappeared state, and scan records.

## Target Scope

The initial lane is deliberately narrow:

- Lane ID: `ufc_prizm_anthony_hernandez_silver_rookie`
- Segment: 2023 Panini Prizm UFC Anthony Hernandez #181 Silver Prizm Rookie
- Marketplace: eBay Browse active listing search
- Listing types: fixed price and auction
- Default max price: 25 USD
- Default sort: `newlyListed`

This segment was chosen because Phase A1 established a verified canonical sold-evidence pilot for the same exact card family.

## Configuration

The lane is disabled by default.

Environment variables:

- `CARDHAWK_TARGETED_DISCOVERY_ENABLED`: set to `true` to enable the lane.
- `CARDHAWK_TARGETED_DISCOVERY_LANE_ID`: lane identifier.
- `CARDHAWK_TARGETED_DISCOVERY_LANE_NAME`: display/report name.
- `CARDHAWK_TARGETED_DISCOVERY_SPORT`: sport/category text.
- `CARDHAWK_TARGETED_DISCOVERY_PLAYERS`: comma-separated player list.
- `CARDHAWK_TARGETED_DISCOVERY_YEAR`: target year.
- `CARDHAWK_TARGETED_DISCOVERY_PRODUCT`: product text.
- `CARDHAWK_TARGETED_DISCOVERY_SET`: set text.
- `CARDHAWK_TARGETED_DISCOVERY_CARD_NUMBER`: target card number.
- `CARDHAWK_TARGETED_DISCOVERY_KEYWORDS`: comma-separated query keywords.
- `CARDHAWK_TARGETED_DISCOVERY_GRADED_TERMS`: optional graded/raw terms.
- `CARDHAWK_TARGETED_DISCOVERY_PRICE_MIN`: optional minimum total cost.
- `CARDHAWK_TARGETED_DISCOVERY_PRICE_MAX`: optional maximum total cost.
- `CARDHAWK_TARGETED_DISCOVERY_LISTING_TYPES`: comma-separated `FIXED_PRICE` and/or `AUCTION`.
- `CARDHAWK_TARGETED_DISCOVERY_EXCLUDED_TERMS`: comma-separated cheap rejection terms.
- `CARDHAWK_TARGETED_DISCOVERY_SORT`: eBay Browse sort; default `newlyListed`.
- `CARDHAWK_TARGETED_DISCOVERY_PAGE_LIMIT`: result limit per page; defaults to `EBAY_SCAN_QUERY_LIMIT` or `8`.
- `CARDHAWK_TARGETED_DISCOVERY_MAX_PAGES`: max pages per query; default `2`.
- `CARDHAWK_TARGETED_DISCOVERY_MAX_REQUESTS`: total request budget; default `4`.
- `CARDHAWK_TARGETED_DISCOVERY_MAX_RESULTS`: total candidate budget; default `40`.

## Query Behavior

Query generation is deterministic. The initial lane emits two scoped query templates:

1. Year + product + player + card number + keywords.
2. Player + year + set + card number + keywords.

The eBay adapter remains backward-compatible:

- Existing `search(query, limit, options)` still returns a listing array.
- Existing `searchWithBackoff(query, limit, options)` still returns a listing array.
- A2 adds `searchPage(query, limit, options)` and `searchPageWithBackoff(query, limit, options)` for metadata-aware paging.

## Pagination And Result Budget

The lane uses eBay Browse `limit` and `offset` parameters through the approved Browse API path. It stops when any deterministic bound is reached:

- configured max pages
- configured max requests
- configured max results
- a page returns fewer results than the page limit
- rate limit or fatal API error

The lane never performs unbounded pagination.

## Freshness Semantics

The eBay adapter preserves marketplace timestamp fields when available:

- `itemCreationDate`
- `itemStartDate`
- `listingStartDate`
- `itemLastModifiedDate`
- `itemEndDate`

The targeted lane calculates listing age at CardHawk observation only when a trustworthy marketplace start/creation timestamp is present. If no timestamp is present, freshness is reported as unavailable with the limitation `marketplace_creation_timestamp_unavailable`.

Freshness is never fabricated.

## Deduplication And History

The lane deduplicates listings by marketplace listing ID before saving. Duplicates across pages and queries are counted once and do not create multiple discoveries.

New-vs-previously-observed classification uses existing history/store state:

- `historyEngine.getListing(listingId)`
- `store.listings[listingId]`

For preserved candidates, the lane records:

- marketplace listing ID
- lane ID/name
- query
- page and offset
- first observed timestamp
- current observed timestamp
- marketplace start timestamp if available
- age at first observation if measurable
- cheap triage result

The scanner continues to call `historyEngine.recordScan` after observed listings are saved, so existing history remains the durable owner of first/last observation state.

## Cheap Triage

The lane performs only inexpensive relevance checks:

- missing listing ID
- missing or invalid price
- price below/above configured lane bounds
- excluded non-card/noise terms
- clearly irrelevant lane terms
- duplicate listing ID

Ambiguous listings are preserved when the title still plausibly matches the target. The lane does not perform deep identity validation, image analysis, sold evidence acquisition, valuation changes, or AI triage.

## Discovery Report

Each run produces a structured report:

- `schemaVersion`
- `runId`
- `laneId`
- `laneName`
- `status`
- `startedAt`
- `completedAt`
- `durationMs`
- `queries`
- `queriesExecuted`
- `apiRequests`
- `pagesRequested`
- `rawResults`
- `uniqueListings`
- `newListings`
- `previouslyObservedListings`
- `cheaplyRejectedListings`
- `candidatesPreserved`
- `apiErrors`
- `duplicateCount`
- `rejectedListings`
- `listingTypeBreakdown`
- `freshness`
- `requestEfficiency`
- `budget`
- `productionImpact: "none"`
- `decisionImpact: "none"`
- `executionAuthority: "none"`

Request-efficiency metrics include:

- API requests consumed
- listings returned per request
- unique listings per request
- new listings per request

## Scanner Integration

The integration is additive:

- `services/targetedDiscoveryLaneService.js` owns the targeted lane.
- `marketplaces/ebayMarketplace.js` owns paged Browse search support.
- `services/scoutScannerService.js` calls the targeted lane only when enabled.
- `server.js` constructs the lane with environment configuration.

The broad scanner remains unchanged when `CARDHAWK_TARGETED_DISCOVERY_ENABLED` is not `true`.

## Production Authority

The lane may discover and forward active listings into existing processing when enabled. It does not:

- alter Deal Gate thresholds
- alter valuation safeguards
- create BUY_NOW authority
- send purchase/bid/offer requests
- treat active listings as sold evidence
- scrape marketplaces
- use private endpoints
- modify notification authority

Deal Gate remains authoritative where applicable. Human purchasing authority remains absolute.

## Limitations

- No live validation was executed in Codex because marketplace credentials/network execution were not used.
- The lane depends on eBay Browse result quality and available timestamp fields.
- Freshness cannot be measured for listings without reliable marketplace start/creation timestamps.
- The default target is one narrow UFC segment and is not a universal discovery framework.
- A2 does not solve valuation, true-sold acquisition, auction strategy, negotiation, image identity, or high-throughput triage.

## Enablement

To enable the lane in a controlled environment:

```bash
CARDHAWK_TARGETED_DISCOVERY_ENABLED=true
CARDHAWK_TARGETED_DISCOVERY_MAX_REQUESTS=4
CARDHAWK_TARGETED_DISCOVERY_MAX_PAGES=2
CARDHAWK_TARGETED_DISCOVERY_PAGE_LIMIT=8
```

Keep request budgets conservative until live discovery efficiency is measured.
