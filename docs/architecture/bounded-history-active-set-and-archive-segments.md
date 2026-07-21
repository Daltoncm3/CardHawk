# Bounded History Active Set and Archive Segments

Phase 11.8B addresses the production memory failure mode where `historyEngine` loaded, walked, and serialized the complete historical listing universe during normal scan completion.

## Previous Failure Mode

Before Phase 11.8B, `data/listingHistory.json` contained every tracked listing record. Each scan called `historyEngine.recordScan`, which loaded the full file, updated observed records, walked every historical listing to mark disappeared records, recomputed complete-history statistics, and rewrote the whole object with `JSON.stringify`.

After resident listing retention and scan-universe snapshots were introduced, Railway heap failures still appeared in `JsonStringifier::Stringify`. That pointed to full-history serialization rather than scan scoring.

## Active History Working Set

`data/listingHistory.json` remains the production history file, but it now represents a bounded active working set. It contains:

- currently active records,
- recently relevant inactive or disappeared records,
- recent scan records capped at 250,
- active-history statistics,
- lightweight archive metadata.

Normal scan processing loads and saves only this bounded active file.

## Archive Segments

Older inactive and disappeared records are moved to file-based archive segments under:

`data/history-archive/`

Each archive segment is minified JSON with this shape:

```json
{
  "source": "history_archive_segment",
  "schemaVersion": 1,
  "segmentId": "history-archive-<fingerprint>",
  "createdAt": "2026-07-21T00:00:00.000Z",
  "archiveReason": "record_scan_retention",
  "recordCount": 500,
  "firstListingId": "example-1",
  "lastListingId": "example-500",
  "fingerprint": "<sha256>",
  "records": {}
}
```

Segment names are deterministic from the archived record content. If a migration is interrupted after a segment is written but before the active file is replaced, the next run writes the same segment path rather than creating a duplicate segment.

## Retention Policy

Defaults:

- `CARDHAWK_MAX_ACTIVE_HISTORY_RECORDS`: `5000`
- `CARDHAWK_MAX_INACTIVE_HISTORY_AGE_DAYS`: `180`
- `CARDHAWK_MIN_PROTECTED_HISTORY_RECORDS`: `500`
- archive segment record limit: `500`

Retention order:

1. Protect the newest active-history records.
2. Archive inactive records older than the inactive-age limit.
3. If the active-history cap is still exceeded, archive older inactive or disappeared records first.
4. Archive active records only if the cap cannot otherwise be satisfied.
5. If protected records alone exceed the cap, retain them and report a cap warning.

## Migration

Legacy `data/listingHistory.json` files are supported. On first compatible load or save, the engine loads the legacy full-history file once, splits older eligible records into archive segments, writes the bounded active file, and stores archive counters in active metadata.

No manual production data editing is required.

## Crash Safety

Archive and active history writes use temp-file replacement. Archive segments are written before the active file is replaced. If the process stops between those steps, the next run sees the same legacy active file and the same deterministic archive segment names, then completes the active-file replacement.

## API Compatibility

Existing exported APIs remain available:

- `recordScan`
- `summarizeHistory`
- `getPriceDrops`
- `getDisappearedListings`
- `getActiveListings`
- `getListing`
- `loadHistory`
- `saveHistory`

Active-history APIs operate primarily from the bounded working set. Exact listing lookup checks the active set first and can search archive segments when needed. Summary output keeps the existing `stats`, `recentScans`, `recentPriceDrops`, and `recentDisappeared` shape while adding archive metadata.

## Expected Memory Behavior

Normal scan completion no longer serializes the complete historical universe. It serializes:

- the bounded active history file,
- any newly created bounded archive segment files.

Archive segments are not loaded during normal scan processing. Archive reads occur only for explicit lookup or bounded history views that need archived records.

## Remaining Future Work

Phase 11.8B is the smallest safe production fix. Future phases should add:

- paginated archive browsing,
- segmented analytics,
- richer archive indexes,
- archive compaction tooling,
- production health reporting for archive growth,
- optional streaming readers for large archive analysis.
