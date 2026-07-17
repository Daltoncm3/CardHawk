# Batched Persistence

Phase 11.5 introduces scan-aware persistence coordination for CardHawk's JSON-backed production store.

This is an incremental memory and I/O architecture change. It does not redesign persistence, introduce a database, change file formats, change scan cadence, or alter production decision behavior.

## Previous Behavior

CardHawk's production store is persisted as a whole JSON document through `utils/appStore.js` and `utils/stateStore.js`.

Before this phase, runtime code could call the store save helper directly from multiple mutation points. During a scout scan, listing records, rejections, alerts, and scan summaries all mutate the same in-memory store. Persisting the full JSON state repeatedly during that lifecycle creates unnecessary serialization pressure as the retained listing set grows.

## New Model

`utils/persistenceCoordinator.js` provides a small store-agnostic coordinator around the existing save operation.

The coordinator tracks:

- active persistence batch depth
- dirty-state markers
- deterministic dirty reasons
- flush attempts
- skipped duplicate or empty flushes
- emergency flushes
- recent flush diagnostics

The coordinator does not know the store shape and does not serialize data itself. The existing `appStore.saveStore` and `stateStore.saveJsonState` behavior remains the only persistence implementation for the production store.

## Dirty-State Lifecycle

During a scan:

1. The scanner begins a persistence batch.
2. Each retained listing mutation marks the state dirty.
3. Final scan bookkeeping marks the state dirty.
4. The scanner flushes once when the scan reaches its existing cleanup point.

Repeated dirty marks are deterministic and deduplicated by reason. They do not cause repeated full-state JSON writes.

## Flush Lifecycle

`flushPersistenceBatch` closes one active batch level. Nested batches defer persistence until the outer batch closes.

If no dirty state exists, a flush is skipped and recorded in diagnostics. If dirty state exists, the coordinator calls the existing persistence function exactly once for that synchronization point.

`emergencyFlush` supports explicit immediate durability. It is used for notification-result persistence where the existing runtime expects durable state as soon as the asynchronous notification outcome is known.

## Crash Considerations

Batched persistence intentionally defers routine scan writes until the existing scan cleanup point. This reduces repeated whole-state serialization while preserving the scan's final durable state.

Crash safety remains bounded by the existing JSON file model:

- writes still use the existing temp-file-and-rename behavior in `stateStore`
- file format is unchanged
- explicitly immediate saves can still force a flush
- cancelled batches discard pending dirty markers rather than allowing stale dirty state to flush later

This phase does not add write-ahead logging or a database.

## Compatibility Guarantees

This phase preserves:

- production store JSON format
- app store normalization
- listing compaction behavior
- scanner scheduling
- marketplace request behavior
- retry behavior
- valuation formulas
- confidence formulas
- Deal Gate decisions
- BUY_NOW criteria
- notification criteria
- learning semantics

When a scanner is constructed without a coordinator, it falls back to the original `saveStore` dependency.

## Expected Reduction

For scan-owned mutations, the expected persistence operation count becomes:

- previous architectural target: one whole-state save per mutation point
- Phase 11.5 behavior: many dirty marks, one final whole-state flush per completed scan

Emergency notification-result saves remain immediate by design.

## Relationship To Phase 11

Phase 11.1 established production memory contracts.

Phase 11.2 bounded long-lived learning stores.

Phase 11.3 defined the listing-store architecture.

Phase 11.4 compacted retained listings.

Phase 11.5 reduces repeated full-state JSON serialization during scans while preserving the existing JSON persistence system.
