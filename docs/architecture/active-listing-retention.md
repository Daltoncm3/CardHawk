# Active Listing Retention

Phase 11.7B introduces bounded active resident listing retention for `store.listings`.

This phase addresses the highest-priority remaining production memory issue from the Phase 11.7A incident audit: `store.listings` could continue to grow indefinitely even after individual listing compaction, bounded learning stores, and batched persistence.

## Scope

This phase is intentionally limited to resident listing retention.

It does not change:

- scoring algorithms,
- valuation formulas,
- comparison logic,
- Deal Gate rules,
- BUY_NOW criteria,
- notification rules,
- marketplace behavior,
- scanner scheduling,
- persistence file format.

## Active Versus Archived Listings

CardHawk now treats `store.listings` as the active resident listing collection. It should contain the bounded set of listings needed for current production operation and compatibility reads.

Historical listing continuity is preserved through the existing history infrastructure. Listings removed from `store.listings` are treated as archive-eligible historical residents, not as valuation evidence and not as deleted business history. Phase 11.7B does not add a new archive repository or lazy-loading system; those remain future work.

## Retention Policy

`utils/activeListingRetention.js` defines the canonical resident listing retention policy.

Default policy:

- `maxResidentListings`: `1000`
- `maxResidentAgeDays`: disabled unless configured
- `minProtectedNewestListings`: `100`
- preserve alerted listings
- preserve pinned or explicitly required listings
- evict stale listings when eligible
- evict disappeared listings when eligible

The resident cap can be configured with:

- `CARDHAWK_MAX_RESIDENT_LISTINGS`
- `CARDHAWK_MAX_RESIDENT_LISTING_AGE_DAYS`
- `CARDHAWK_MIN_PROTECTED_NEWEST_LISTINGS`

## Eviction Rules

Retention is deterministic:

1. Listings are compacted into the Phase 11.4 retained listing shape.
2. Required listings are protected.
3. The newest resident window is protected.
4. Stale, disappeared, age-expired, or cap-excess listings become eligible.
5. Eligible listings are evicted oldest-first with stable listing ID tie-breaking.

If required and protected listings exceed the configured cap, CardHawk keeps them and reports a cap warning rather than evicting required active context.

## Compatibility Guarantees

The top-level app store shape is unchanged:

- `listings`
- `alerts`
- `scans`
- `rejections`
- `settings`

The JSON persistence format is unchanged. Existing legacy listing records are still accepted and compacted during load/save.

The retained listing shape continues to preserve identity, price, seller, URL, image, parsed identity, scoring fields, alert state, and route compatibility fields already protected by Phase 11.4.

## Why This Reduces Memory

Phase 11.4 reduced per-listing payload size, but a compact object still consumes memory when the resident set grows without bound.

Phase 11.7B bounds the number of resident listing objects loaded into production memory. This reduces:

- steady resident listing memory,
- full-store JSON serialization size,
- route-level listing materialization,
- the upper bound for current full-universe scoring until Phase 11.7C replaces that pattern.

## Relationship To Phase 11.4

Phase 11.4 removed raw marketplace payloads and scan-only data from retained listing records.

Phase 11.7B builds on that by limiting how many compact retained listings remain resident.

## Relationship To Phase 11.5

Phase 11.5 reduced repeated whole-state persistence during scans.

Phase 11.7B reduces the size of the resident listing state that is persisted at scan synchronization points.

## Relationship To Phase 11.7C

Phase 11.7B does not optimize scoring. `scoreListing` can still use a resident universe array.

Phase 11.7C should address repeated full-universe scoring allocations by introducing bounded scan-level snapshots, comparable indexes, same-identity candidate selection, and sold-like evidence indexes.
