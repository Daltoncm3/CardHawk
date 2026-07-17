# Production Listing Store Refactor

Phase 11.3 introduces an offline architecture model for separating production listing memory into active, historical, and archived responsibilities. It does not change the current runtime store, persistence format, scanner behavior, valuation, Deal Gate, BUY_NOW, marketplace behavior, or scheduling.

## Why Listing Data Must Be Separated

The Phase 11.0A memory audit identified production listing retention as one of the largest long-term memory risks. A production scanner can observe many listings over time. If active listings, stale listings, disappeared listings, raw scan payloads, historical summaries, and archive records all live in the same permanent in-memory collection, memory growth becomes tied to total lifetime observations instead of the current operating window.

The long-term architecture separates listing data into four concepts:

| Concept | Purpose | Memory Intent |
| --- | --- | --- |
| Scan Working Set | Per-scan candidate data while one scan is running. | Scan-local only. |
| Active Listing Store | Listings still active and needed by production reads. | In memory, bounded by active policy in a future phase. |
| Historical Listing Store | Compact recent history for stale, observed, or disappeared listings. | Compact in memory or lazy-loaded later. |
| Archived Listing Store | Durable older records that should not stay permanently resident. | Archive or lazy-load on demand. |

This phase defines the concepts and validation contract only. It does not move current listings between stores.

## Lifecycle States

The architecture model defines these lifecycle states:

- `scan_working_set`
- `active`
- `observed`
- `stale`
- `disappeared`
- `archived`

The intended lifecycle direction is:

1. A listing enters the scan working set during one scan.
2. If retained as current production state, it becomes active.
3. If no longer needed as a full active object but still useful for recent context, it becomes observed or historical.
4. If stale or disappeared beyond the recent operating window, it becomes archive-eligible or archive-required.
5. Once archived, it should be retrieved through archive or lazy-loading mechanisms instead of permanent RAM residency.

## Promotion And Demotion Rules

The model includes promotion and demotion rules such as:

- `scan_to_active`
- `active_to_historical`
- `historical_to_archive`
- `stale_or_disappeared_to_archive`

Every rule is marked as architecture-only and must not change production behavior in this phase. Future runtime implementation should apply these rules gradually and behind explicit approval.

## Archive Eligibility

Archive eligibility is explicit:

- Scan working set listings are not archive candidates because they are call-local.
- Active listings are not archive candidates because production still needs them.
- Observed historical listings are archive-eligible once they exceed a future retention window.
- Stale or disappeared listings are archive-required once they are no longer part of the active operating window.
- Archived listings are already archive-resident and should not be treated as active memory.

Archived listings should remain durable for audit and history, but they should not require full listing objects to remain in RAM forever.

## Memory Residency Policies

The canonical residency policies are:

- `scan_local_only`
- `active_in_memory`
- `compact_in_memory`
- `archive_only`
- `lazy_load_on_demand`
- `not_resident`

The model maps each lifecycle state to a memory residency policy, persistence responsibility, and retrieval responsibility. This makes future implementation auditable before any runtime storage changes occur.

## Persistence And Retrieval Responsibilities

The architecture separates persistence from retrieval:

- Scan working set data has no persistence responsibility.
- Active listings belong to active production state.
- Historical listings belong to compact historical state.
- Stale, disappeared, and archived listings belong to archive state.
- Future archive reads should use archive or lazy-load lookup rather than keeping all historical listings resident.

Phase 11.3 does not implement new persistence. It defines how future phases should avoid conflating active memory with durable history.

## Future Lazy-Loading Support

Lazy loading should eventually allow CardHawk to retrieve older listing records only when a route, report, audit, or operator workflow explicitly asks for them. The active production process should not need to hold every historical listing in memory to score current listings.

Future lazy loading should preserve:

- current production read compatibility,
- deterministic listing identity,
- stable historical summaries,
- archive integrity,
- safe fallbacks when archived records are unavailable.

## Relationship To Phase 11 Memory Contracts

Phase 11.1 defined the memory contract for `store.listings` and related production memory objects. Phase 11.3 creates the listing-store architecture contract that future runtime work can implement incrementally.

This phase supports the memory-contract direction:

- active data should be bounded,
- old listing history should be compacted or archived,
- archive data should be lazy-load eligible,
- scan data should be released after each scan.

## Relationship To Phase 11.2 Bounded Learning Stores

Phase 11.2 bounded the long-lived learning stores. Phase 11.3 applies the same architectural principle to listing state: active production memory should be a bounded working set, while long-term history belongs in compact or archived storage.

The difference is that Phase 11.2 made bounded runtime changes to learning engines, while Phase 11.3 is architecture-only. Listing-store runtime changes are intentionally deferred because `store.listings` is closer to production route compatibility and scanner behavior.

## Future Implementation Roadmap

Recommended follow-up sequence:

1. Define active listing projection and compatibility read helpers.
2. Add compact historical listing summaries without changing existing route outputs.
3. Add archive eligibility metrics and dry-run reports.
4. Add archive write path behind explicit approval.
5. Add lazy-load retrieval helpers for archived listing details.
6. Gradually reduce active in-memory listing payload size once compatibility tests prove no production behavior changes.

Each future step should include regression tests for route compatibility, scan lifecycle behavior, persistence safety, and production decision invariance.

## Production Boundaries

Phase 11.3 does not change:

- `server.js`,
- runtime listing storage,
- scanner behavior,
- scan timing,
- Deal Gate,
- BUY_NOW,
- valuation,
- marketplace behavior,
- persistence,
- sold evidence,
- notifications.

The module is offline governance infrastructure only. It does not inspect live production data and does not import `server.js`.
