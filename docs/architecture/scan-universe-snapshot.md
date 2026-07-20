# Scan Universe Snapshot

Phase 11.7C introduces a shared scan-level listing universe snapshot.

This phase is allocation-only. It does not change scoring algorithms, valuation formulas, comparison logic, Deal Gate rules, BUY_NOW behavior, notifications, marketplace behavior, persistence semantics, or scanner scheduling.

## Previous Allocation Behavior

Before this phase, production scan processing repeatedly materialized the resident listing universe:

1. `saveScoutedListing` called `Object.values(store.listings)` for every processed listing.
2. `scoreListing` called `Object.values(store.listings)` again for sold-sales summarization.
3. Downstream comparison engines then filtered, mapped, sorted, and enriched candidate arrays.

That made scan processing structurally expensive as resident listing count grew:

`processed scan listings x resident listings`

Phase 11.7B bounded resident listing count, but the scan hot path still recreated the same universe array repeatedly.

## New Architecture

`utils/scanUniverseSnapshot.js` provides:

- `createScanUniverseSnapshot`
- `validateScanUniverseSnapshot`
- `summarizeScanUniverseSnapshot`
- `getScanUniverseListings`
- `isScanUniverseSnapshot`

At the beginning of a scout scan, `services/scoutScannerService.js` creates one immutable snapshot from the current resident `store.listings` collection.

Each listing processed during that scan receives the same snapshot through `saveScoutedListing`.

`server.scoreListing` remains backward compatible. Existing direct callers can still pass an array. Snapshot-aware callers pass the scan snapshot so comp evaluation, sold-sales summarization, and confidence evaluation all use the same array.

## Immutability Boundary

The snapshot object and its `listings` and `listingIds` arrays are frozen.

The snapshot intentionally does not deep-clone every listing. Deep cloning the universe would reintroduce large allocation pressure and would not be necessary for this phase. The snapshot freezes the universe membership for the scan while preserving the existing listing object semantics.

## Expected Allocation Reduction

For a scan with `M` processed listings and `N` resident listings:

- previous scan universe materialization: approximately `M` full arrays in `saveScoutedListing`, plus `M` additional full arrays inside `scoreListing`
- Phase 11.7C scan universe materialization: one full array per scan

Downstream engines still create comparison candidate arrays. Phase 11.7C does not build comparison indexes or change comparison algorithms.

## Relationship To Phase 11.7B

Phase 11.7B bounded active resident listings.

Phase 11.7C reduces repeated allocation against that bounded resident set during scans.

Together, they address the two primary production listing memory incident causes:

- unbounded resident listing growth,
- repeated full-universe materialization during scan scoring.

## Remaining Object.values Sites

Some `Object.values(store.listings)` calls remain intentionally:

- UI/API list materialization,
- validation/reporting routes,
- backward-compatible `scoreListing` and `saveScoutedListing` fallback paths for callers that do not supply a snapshot.

Those are outside the automatic scan per-listing loop. Future phases may paginate, lazy-load, or index those routes.

## Future Comparison-Index Architecture

Phase 11.7C does not solve downstream candidate-array creation in `compEngine` or sold-sales normalization.

The next architecture step should introduce compact comparison indexes:

- same canonical identity,
- same player or subject,
- same card/set/year,
- sold-like evidence candidates,
- recent bounded comparable windows.

Those indexes should reduce comparison work before engines create scored candidate arrays.
