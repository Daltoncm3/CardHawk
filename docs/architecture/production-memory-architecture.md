# Production Memory Architecture

## Status

Phase 11.0A defines CardHawk's production memory architecture and long-term runtime scalability direction.

This document is architecture and analysis only. It does not change runtime behavior, `server.js`, Deal Gate, `BUY_NOW`, valuation, marketplace behavior, scan timing, or notifications.

## Objectives

Phase 11 must permanently solve production memory growth without weakening production decision boundaries. The production runtime needs explicit ownership, lifetime, retention, compaction, persistence, and streaming rules for every long-lived object.

This document establishes:

- the current production memory inventory,
- long-lived object ownership and growth behavior,
- architectural scalability violations,
- target memory principles,
- and the prioritized Phase 11 roadmap.

## Current Production Scan Lifecycle

1. `server.js` initializes the app store from `data/cardhawk-data.json`.
2. `server.js` creates one `scoutScanner` through `services/scoutScannerService.js`.
3. `startScoutEngine` schedules one startup scan with `setTimeout` and recurring automatic scans with `setInterval`.
4. `runScoutScan` enters `services/scoutScannerService.js`.
5. The scanner checks `scanInProgress`.
6. If a scan is already running, a skipped scan record is added to `store.scans`.
7. If no scan is running, the scanner creates a scan object and begins lane/query iteration.
8. Each query calls `activeMarketplace.searchWithBackoff`.
9. eBay search returns normalized listing objects.
10. Each listing is scored and saved through `saveScoutedListing`.
11. Each saved listing is appended to scan-local `observedListings`.
12. At scan end, `historyEngine.recordScan` records history from `observedListings`.
13. Learning, decision validation, and prediction accuracy outcome hooks receive price-drop, disappeared, and stale outcomes.
14. The scanner writes scan summary data into `store.scans`, trims scans and alerts, finishes system health, saves the app store, and clears `scanInProgress`.

The lifecycle has a concurrency guard, but the scheduler is still interval-based. Later interval ticks are skipped when a previous scan is still running; they are not queued.

## Memory Ownership Principles

Phase 11 should enforce these principles:

- Every long-lived object must have a named owner.
- Every production collection must have an explicit maximum size or archiving policy.
- Production RAM should hold active working sets, not indefinite historical records.
- Scan-local data must die at scan completion.
- Persisted JSON files must not require full-file read/write for every listing operation once they reach production scale.
- Raw marketplace responses must not be retained in production listing state unless explicitly compacted or archived.
- Diagnostic-rich scoring objects must not be retained in full when only display summaries are needed.
- Learning and validation state must be bounded, archived, or moved offline.
- Shadow and diagnostic outputs must not become hidden production memory growth vectors.

## Memory Object Catalog

### `store`

Owner: `server.js` and `utils/appStore.js`

Creation point: initialized as `appStore.createDefaultStore()` and replaced by `appStore.loadStore(DATA_FILE, store)` during startup.

Lifetime: process lifetime.

Expected maximum size: currently undefined.

Current growth behavior: `store.alerts`, `store.scans`, and `store.rejections` are bounded in runtime paths; `store.listings` is not.

Bounded: partially.

Survives scans: yes.

Survives restarts: yes, through `data/cardhawk-data.json`.

Should be archived: yes, for old or inactive listings.

Belongs in RAM: only active/recent listings and current operational state belong in RAM.

Should be lazily loaded: yes, for old listings, historical details, and deep diagnostics.

Should become compacted: yes.

Should become streamable: eventually yes for list/export operations.

Target architecture: split the production store into active listing index, compact listing summaries, bounded alert/rejection/scan state, and archived listing details.

### `store.listings`

Owner: `server.js`

Creation point: loaded from app store and written in `saveScoutedListing`.

Lifetime: process lifetime and persisted across restarts.

Expected maximum size: currently undefined; should become explicitly bounded by active/recent listing retention plus archive policy.

Current growth behavior: unbounded by listing ID. Every new marketplace listing can remain indefinitely.

Bounded: no.

Survives scans: yes.

Survives restarts: yes.

Should be archived: yes.

Belongs in RAM: only active, recently seen, alerted, or operationally relevant listings should remain in RAM.

Should be lazily loaded: yes.

Should become compacted: yes.

Should become streamable: yes for history/review exports.

Scalability issue: each saved listing currently retains source listing fields, parsed identity, scoring summaries, comp data, market data, quality data, deal grade, and Deal Gate result. eBay normalized listings also include `raw`.

Target architecture: production listing records should be compact by default. Full source payloads, rich diagnostics, and historical scoring snapshots should move to bounded archives or explicit review artifacts.

### `store.alerts`

Owner: `server.js`

Creation point: `saveScoutedListing` when Deal Gate passes and alert rules allow alert creation.

Lifetime: process lifetime and persisted across restarts.

Expected maximum size: 200 in current scanner finalization.

Current growth behavior: trimmed to 200 after scans.

Bounded: yes.

Survives scans: yes.

Survives restarts: yes.

Should be archived: optional; only if operator wants alert history beyond current window.

Belongs in RAM: yes, at bounded size.

Should be lazily loaded: no for the current window.

Should become compacted: already mostly compact, but `compData` and `qualityData` should be reviewed.

Should become streamable: no immediate need.

Target architecture: retain only alert-critical display and audit fields.

### `store.rejections`

Owner: `server.js`

Creation point: `saveScoutedListing` when Deal Gate fails.

Lifetime: process lifetime and persisted across restarts.

Expected maximum size: 300.

Current growth behavior: trimmed to 300.

Bounded: yes.

Survives scans: yes.

Survives restarts: yes.

Should be archived: optional.

Belongs in RAM: yes, at bounded size.

Should be lazily loaded: no for current window.

Should become compacted: yes, to remove fields not needed for rejection display.

Should become streamable: no immediate need.

### `store.scans`

Owner: `services/scoutScannerService.js`

Creation point: scanner skip path and scanner finalization.

Lifetime: process lifetime and persisted across restarts.

Expected maximum size: 100.

Current growth behavior: trimmed to 100.

Bounded: yes.

Survives scans: yes.

Survives restarts: yes.

Should be archived: optional for operational analytics.

Belongs in RAM: yes, at bounded size.

Should be lazily loaded: no.

Should become compacted: already summary-level.

Should become streamable: no immediate need.

### `predictionAccuracyEngine`

Owner: `engines/predictionAccuracyEngine.js`

Creation point: module import; persisted state is loaded at module load.

Long-lived objects:

- `recordsByPredictionId`
- `recordsByListingId`
- `predictionHistory`
- `outcomeHistory`

Lifetime: process lifetime.

Expected maximum size: currently undefined.

Current growth behavior: unbounded. Every recorded prediction appends to `predictionHistory`; indexes also grow.

Bounded: no.

Survives scans: yes.

Survives restarts: yes, through `data/predictionAccuracy.json`.

Should be archived: yes.

Belongs in RAM: only a bounded recent working set belongs in RAM.

Should be lazily loaded: yes.

Should become compacted: yes.

Should become streamable: yes for analytics and calibration reports.

Scalability issue: state is persisted through whole-file JSON after prediction and outcome writes. In production scans, this can occur per listing.

Target architecture: bounded recent in-memory index, append-only or batched persistence, archive segments by time/listing, and offline analytics loading.

### `decisionValidationEngine`

Owner: `engines/decisionValidationEngine.js`

Creation point: module import; persisted state is loaded at module load.

Long-lived objects:

- `recordsById`
- `decisionHistory`
- `outcomeHistory`

Lifetime: process lifetime.

Expected maximum size: currently undefined.

Current growth behavior: unbounded. Each decision snapshot appends to `decisionHistory`, and per-listing records keep decision snapshots.

Bounded: no.

Survives scans: yes.

Survives restarts: yes, through `data/decisionValidation.json`.

Should be archived: yes.

Belongs in RAM: only bounded recent records and active outcome candidates should be resident.

Should be lazily loaded: yes.

Should become compacted: yes.

Should become streamable: yes.

Scalability issue: whole-file JSON persistence after each decision/outcome write.

Target architecture: bounded decision-validation repository with recent index, append/batch writes, and archive/query helpers.

### `learningEngine`

Owner: `engines/learningEngine.js`

Creation point: module import.

Long-lived objects:

- `learningState.recordsByEbayItemId`
- `learningState.predictionEvents`
- `learningState.scanEvents`

Lifetime: process lifetime.

Expected maximum size: recent events are capped at 1000; records by listing are not capped.

Current growth behavior: per-record history arrays are capped, but the listing-key map is unbounded.

Bounded: partially.

Survives scans: yes.

Survives restarts: no direct persistence in this module, but it is rebuilt during runtime as scans occur.

Should be archived: yes if long-term learning records are needed.

Belongs in RAM: only a bounded recent working set.

Should be lazily loaded: yes for old learning records.

Should become compacted: yes.

Should become streamable: yes for aggregate learning reports.

Scalability issue: every new listing ID can create a permanent in-process learning record until restart.

Target architecture: bounded learning state with retention by recency, active status, and outcome relevance.

### `historyEngine`

Owner: `engines/historyEngine.js`

Creation point: per call, `loadHistory` loads `data/listingHistory.json`.

Long-lived objects:

- persisted `history.listings`
- persisted `history.scans`
- per-listing `priceHistory`
- per-listing `priceDrops`

Lifetime: persisted across scans and restarts; loaded into RAM during history operations.

Expected maximum size: scans capped at 250; per-listing price points capped at 100; per-listing price drops capped at 50; total listings uncapped.

Current growth behavior: unbounded total listing records.

Bounded: partially.

Survives scans: yes.

Survives restarts: yes.

Should be archived: yes.

Belongs in RAM: not all history belongs in RAM; only current scan comparison set and recent history summaries should be loaded.

Should be lazily loaded: yes.

Should become compacted: yes.

Should become streamable: yes.

Scalability issue: `recordScan` loads the full history file, mutates it, and writes the full file each scan.

Target architecture: active listing history index plus archive segments and bounded scan summaries.

### Persistent Stores

Owner: `utils/stateStore.js` and per-module callers.

Current files include:

- `data/cardhawk-data.json`
- `data/listingHistory.json`
- `data/decisionValidation.json`
- `data/predictionAccuracy.json`
- `data/notificationState.json`
- `data/shadow-mode.json`
- `data/sold-evidence.json`

Creation point: module load or first write, depending on file.

Lifetime: across restarts.

Expected maximum size: undefined for core production state, history, decision validation, and prediction accuracy.

Current growth behavior: mixed; notification and shadow state are bounded, production listing and validation files are not.

Bounded: partially.

Survives scans: yes.

Survives restarts: yes.

Should be archived: yes for production listing history, prediction history, decision validation, and historical scans.

Belongs in RAM: only active working set.

Should be lazily loaded: yes.

Should become compacted: yes.

Should become streamable: yes.

Scalability issue: `stateStore` uses full `readFileSync`, `JSON.parse`, `JSON.stringify`, and atomic full-file replacement. This is acceptable for small state files but unsafe for indefinite growth.

Target architecture: keep `stateStore` for bounded config-like state; introduce purpose-built bounded repositories for high-volume production state.

### Caches

#### eBay token cache

Owner: `marketplaces/ebayMarketplace.js`

Creation point: module-level `ebayTokenCache`.

Lifetime: process lifetime.

Expected maximum size: one token.

Current growth behavior: constant.

Bounded: yes.

Survives scans: yes.

Survives restarts: no.

Should be archived: no.

Belongs in RAM: yes.

Should be lazily loaded: already lazy.

Should become compacted: no.

Should become streamable: no.

#### Trend cache

Owner: `engines/trendEngine.js`

Creation point: module-level cache.

Lifetime: process lifetime.

Expected maximum size: not established by Phase 11.0A.

Current growth behavior: requires Phase 11.1 contract verification.

Bounded: not confirmed in this phase.

Survives scans: yes.

Survives restarts: no.

Should be archived: no.

Belongs in RAM: only if bounded.

Should be lazily loaded: no.

Should become compacted: yes if unbounded.

Should become streamable: no.

### Lookup Maps

Lookup maps in production-critical paths include:

- `learningState.recordsByEbayItemId`
- `predictionAccuracyEngine.recordsByPredictionId`
- `predictionAccuracyEngine.recordsByListingId`
- `decisionValidationEngine.recordsById`
- transient Sets inside comp, risk, evidence, and comparison engines

Persistent module-level maps must have explicit caps. Transient per-call Sets are acceptable if they do not escape the call.

Target architecture: every module-level Map must declare owner, key type, value shape, maximum size, eviction/archive policy, and reset behavior.

### Retry State

Owner: `marketplaces/ebayMarketplace.js`

Creation point: local variables in `searchWithBackoff`.

Lifetime: one query attempt sequence.

Expected maximum size: one `lastError` plus one awaited timer.

Current growth behavior: bounded by `maxRetries`.

Bounded: yes.

Survives scans: no, unless a query is currently awaiting backoff.

Survives restarts: no.

Should be archived: no.

Belongs in RAM: yes, during query execution.

Should be lazily loaded: not applicable.

Should become compacted: no.

Should become streamable: no.

Target architecture: keep retry state local, add explicit cancellation/timeout controls, and record only compact retry summaries in scan records.

### Scanner Lifecycle Objects

Owner: `services/scoutScannerService.js`

Long-lived object:

- `scanInProgress`

Scan-local objects:

- `scan`
- `observedListings`
- `laneErrors`
- `results`
- per-query errors

Lifetime: scan-local until finalization; `scanInProgress` process lifetime.

Expected maximum size: `observedListings` should be bounded by lane count times query count times query limit, but currently inherits the configured query set and `EBAY_SCAN_QUERY_LIMIT`.

Current growth behavior: bounded per scan by query limits, but contains full saved listings, which can be large.

Bounded: partially.

Survives scans: scan summary survives; full `observedListings` should not.

Survives restarts: scan summaries survive through app store.

Should be archived: only summaries.

Belongs in RAM: yes during scan, but should be compact.

Should be lazily loaded: no.

Should become compacted: yes, especially `observedListings`.

Should become streamable: eventually yes for scan processing.

Target architecture: scan context should retain compact listing references, not full saved listing objects. The scheduler should self-schedule after completion rather than firing fixed intervals independent of scan duration.

### Marketplace Adapter Output

Owner: `marketplaces/ebayMarketplace.js`

Creation point: `search` maps `data.itemSummaries` through `normalizeItem`.

Lifetime: query-local, then scan-local, then persisted if saved.

Expected maximum size: bounded by query limit per query, but persisted listing count is unbounded.

Current growth behavior: each normalized listing includes `raw: item`, preserving the full eBay item summary in production state.

Bounded: query-local output is bounded; persistence is not.

Survives scans: yes if saved into `store.listings`.

Survives restarts: yes if saved.

Should be archived: raw source payloads should be archived only if explicitly required.

Belongs in RAM: compact normalized listing belongs in RAM; raw API payload does not.

Should be lazily loaded: raw payloads should be lazy or offline-only.

Should become compacted: yes.

Should become streamable: no immediate need.

Target architecture: separate marketplace raw payload from production listing summary.

### Parser Output

Owner: `parseCardTitle` in `server.js` and downstream identity/scoring modules.

Creation point: during marketplace normalization and rescoring.

Lifetime: attached to listing records and scoring inputs.

Expected maximum size: compact per listing.

Current growth behavior: bounded by listing count; becomes unbounded through `store.listings`.

Bounded: per object yes, aggregate no.

Survives scans: yes when persisted in listing.

Survives restarts: yes.

Should be archived: with listing archive.

Belongs in RAM: yes for active/recent listings.

Should be lazily loaded: yes for archived listings.

Should become compacted: yes if parser output grows.

Should become streamable: no.

Target architecture: parser output should remain compact and should not duplicate canonical identity objects unnecessarily.

### Scoring Objects

Owner: `scoreListing` in `server.js` and engines it invokes.

Creation point: each call to `scoreListing`.

Includes:

- `scoreBreakdown`
- `compData`
- `marketData`
- `soldSales`
- `roiData`
- `confidenceData`
- `qualityData`
- `riskData`
- `marketIntelligenceData`
- `shadowSoldComparison`
- `shadowValuation`
- `decision`
- `dealGrade`

Lifetime: should be call-local, but large subsets are copied into saved listings, alerts, rejections, learning, prediction accuracy, and decision validation.

Expected maximum size: currently undefined.

Current growth behavior: per-call objects are bounded by candidate limits, but aggregate retention grows with `store.listings` and learning/validation histories.

Bounded: per call mostly; persistence no.

Survives scans: yes when saved into stores.

Survives restarts: yes when saved into JSON stores.

Should be archived: rich diagnostics should be archived or generated on demand.

Belongs in RAM: only current scoring and compact display summaries belong in RAM.

Should be lazily loaded: yes.

Should become compacted: yes.

Should become streamable: no for a single listing; yes for batch scans.

Target architecture: define a production listing summary projection and a separate diagnostic artifact projection.

### Valuation Objects

Owner: `marketValueEngine`, `valuationRangeEngine`, `shadowValuationEngine`, and `scoreListing`.

Creation point: per score evaluation.

Lifetime: should be call-local; retained through `marketData`, `marketIntelligenceData.valuationRange`, and `shadowValuation`.

Expected maximum size: compact summary plus bounded evidence references.

Current growth behavior: retained in saved listings and validation histories.

Bounded: per object mostly; aggregate no.

Survives scans: yes when saved.

Survives restarts: yes when saved.

Should be archived: detailed valuation diagnostics should be archived or recomputed on demand.

Belongs in RAM: compact current valuation summary only.

Should be lazily loaded: yes for historical details.

Should become compacted: yes.

Should become streamable: no immediate need.

Target architecture: keep production estimate, confidence, evidence counts, and Deal Gate inputs; move detailed valuation diagnostics into bounded review artifacts.

### Confidence Objects

Owner: `confidenceEngine`, `marketIntelligenceEngine`, and display interpretation.

Creation point: per scoring call.

Lifetime: should be call-local; retained through saved listing confidence fields and display summaries.

Expected maximum size: compact per listing.

Current growth behavior: retained in unbounded listing and learning/validation stores.

Bounded: per object yes, aggregate no.

Survives scans: yes when saved.

Survives restarts: yes when saved.

Should be archived: with historical listing snapshots.

Belongs in RAM: compact active/recent summary only.

Should be lazily loaded: yes for historical detail.

Should become compacted: yes.

Should become streamable: no.

Target architecture: confidence values and reason summaries stay compact; calibration histories move to bounded/offline stores.

### Notification State

Owner: `engines/notificationEngine.js`

Creation point: module import.

Lifetime: process lifetime and persisted.

Expected maximum size: 1000 sent alert keys.

Current growth behavior: bounded.

Bounded: yes.

Survives scans: yes.

Survives restarts: yes.

Should be archived: no.

Belongs in RAM: yes.

Should be lazily loaded: no.

Should become compacted: already bounded.

Should become streamable: no.

Note: notification promises are not awaited by the scan path, but Resend calls use an AbortController timeout and clear their timer. This is a secondary memory risk, not a primary growth cause.

### System Health State

Owner: `engines/systemHealth.js`

Creation point: module import.

Lifetime: process lifetime.

Expected maximum size: bounded events plus current and last scan.

Current growth behavior: `events` capped at 100.

Bounded: yes.

Survives scans: yes.

Survives restarts: no.

Should be archived: optional operational logs only.

Belongs in RAM: yes.

Should be lazily loaded: no.

Should become compacted: already compact.

Should become streamable: no.

### Shadow Mode State

Owner: `utils/shadowModeLogger.js`

Creation point: only when shadow mode logging is enabled.

Lifetime: process and persisted file state.

Expected maximum size: bounded by `MAX_SHADOW_RECORDS`.

Current growth behavior: bounded.

Bounded: yes.

Survives scans: yes when enabled.

Survives restarts: yes.

Should be archived: optional.

Belongs in RAM: bounded loaded state is acceptable.

Should be lazily loaded: optional.

Should become compacted: already compact relative to scan state.

Should become streamable: no immediate need.

### Canonical Sold Evidence Store

Owner: `utils/soldEvidenceStore.js`, `services/soldEvidenceService.js`, and `server.js` lazy loader.

Creation point: lazy loaded into `canonicalSoldEvidenceStore`.

Lifetime: process lifetime after first load.

Expected maximum size: currently calibration-scale; long-term canonical datasets may become large.

Current growth behavior: not automatically written by production scans, but can grow through offline imports.

Bounded: not inherently.

Survives scans: yes once loaded.

Survives restarts: yes through `data/sold-evidence.json`.

Should be archived: eventually yes by identity/source/date.

Belongs in RAM: current small dataset yes; long-term no.

Should be lazily loaded: already lazy, but should become identity-query lazy.

Should become compacted: yes.

Should become streamable: yes for large datasets.

Target architecture: identity-indexed query repository rather than full in-memory store.

## Architectural Scalability Violations

### Violation 1: Unbounded Production Listing Store

`store.listings` has no maximum size, no archive policy, and no active/recent partition. This is the central production memory risk.

Severity: Critical.

Required direction: introduce bounded active listing memory and durable archived listing records.

### Violation 2: Raw Marketplace Payload Retention

Normalized eBay listings retain `raw: item`, and saved production listings spread the normalized listing into persistent state.

Severity: High.

Required direction: remove raw payloads from production listing memory and store only compact source metadata unless an explicit raw archive is approved.

### Violation 3: Rich Diagnostics Stored as Production Listing State

Production listings retain nested scoring, comp, market, quality, and sometimes shadow diagnostic objects. These are useful for review but unsafe as indefinite production state.

Severity: High.

Required direction: define compact production listing projection and separate bounded diagnostic artifact projection.

### Violation 4: Unbounded Learning and Validation Engines

Prediction Accuracy, Decision Validation, and Learning retain unbounded listing or prediction records.

Severity: Critical.

Required direction: bounded stores, retention windows, archive files, and batch writes.

### Violation 5: Whole-File JSON Persistence for High-Volume State

`stateStore` is a whole-file JSON utility. It is safe for small bounded state, but unsafe for indefinite high-volume production records.

Severity: Critical.

Required direction: reserve `stateStore` for bounded files and introduce append/batch/segmented persistence for large stores.

### Violation 6: Per-Listing Persistence During Scans

Prediction Accuracy and Decision Validation persist whole state for each recorded listing. A scan with many results can repeatedly stringify large state.

Severity: Critical.

Required direction: collect scan writes and flush once per scan or to append-only segment files.

### Violation 7: Repeated Full-Universe Array Creation

`saveScoutedListing` and `scoreListing` repeatedly call `Object.values(store.listings)`. As the listing store grows, each listing scoring pass creates large transient arrays.

Severity: High.

Required direction: provide a bounded comp universe provider or indexed lookup service.

### Violation 8: Fixed-Interval Scheduler Without Completion-Based Cadence

`setInterval` fires regardless of scan duration. The scan guard prevents overlap, but repeated skipped scans can still add state and obscure operational health.

Severity: Medium.

Required direction: move to completion-based scheduling with explicit next-run planning.

### Violation 9: Scan-Local `observedListings` Retains Full Saved Listings

The scanner stores full saved listing objects in `observedListings`, then passes them to history and learning scan outcome handling.

Severity: Medium.

Required direction: store compact listing references or compact scan observations.

### Violation 10: No Production Memory Budget Contract

There is no explicit object count or heap budget contract for scans, stores, histories, or learning records.

Severity: High.

Required direction: Phase 11.1 must define enforceable memory contracts and testable budgets.

## Target Architecture

### Production RAM Layers

Phase 11 should separate production memory into:

1. Active runtime state:
   - current scanner state,
   - active/recent listings,
   - bounded alerts,
   - bounded scan summaries,
   - bounded health state.

2. Compact production summaries:
   - display-ready listing summaries,
   - Deal Gate outcome,
   - compact valuation/confidence/evidence summaries,
   - compact source metadata.

3. Archived historical state:
   - old listings,
   - raw marketplace payloads if retained,
   - rich diagnostics,
   - learning histories,
   - validation histories,
   - prediction histories.

4. Offline analytics state:
   - calibration,
   - prediction accuracy,
   - decision validation,
   - dealer agreement,
   - shadow comparisons.

### Persistence Layers

Recommended persistence model:

- Keep `stateStore` for small bounded state.
- Add bounded repositories for active production objects.
- Add archive repositories for historical listing and learning records.
- Add scan-batched persistence for scan writes.
- Add explicit compaction commands for existing JSON state.
- Add read-only migration/inspection tools before any destructive cleanup.

### Listing State Projections

Phase 11 should define at least three projections:

1. Active listing summary:
   - listing ID,
   - marketplace,
   - title,
   - price,
   - url/image,
   - lane/query,
   - parsed identity summary,
   - Deal Gate outcome,
   - display valuation/confidence/evidence summaries,
   - timestamps and counters.

2. Diagnostic snapshot:
   - comp data,
   - market data,
   - risk/quality/grading detail,
   - shadow diagnostics,
   - explanation artifacts.

3. Raw source archive:
   - provider response fragments,
   - raw marketplace payloads,
   - request metadata,
   - only if approved and bounded.

### Scheduler Model

Target scheduler:

- no overlapping scans,
- no fixed interval pileup,
- explicit next-run timestamp,
- completion-based scheduling,
- bounded skip records,
- scan timeout/cancellation policy,
- rate-limit cooldown policy,
- compact scheduler health summary.

### Learning and Validation Model

Target learning architecture:

- bounded in-memory recent records,
- durable append/batch write log,
- archive by date or scan ID,
- explicit summarization windows,
- no whole-file rewrite per listing,
- offline analytics loads archives on demand.

## Phase 11 Roadmap

### Phase 11.1 - Production Memory Contracts

Objective: define enforceable memory contracts before changing behavior.

Deliverables:

- Production memory budget constants.
- Listing projection contracts.
- Learning/validation retention contracts.
- Scan-local object contracts.
- Persistence contract distinguishing bounded state from archive state.
- Test plan for memory stress validation.

Files likely involved:

- new architecture docs,
- new validation contracts under `validation/`,
- focused tests for contracts only.

Acceptance criteria:

- every long-lived object has a maximum size or archive policy,
- every high-volume store has a persistence strategy,
- no production behavior changes.

Priority: first.

### Phase 11.2 - Bounded Learning Stores

Objective: stop unbounded growth in prediction accuracy, decision validation, and learning state.

Deliverables:

- bounded recent-state helpers,
- archive/compaction policy,
- scan-batched persistence plan,
- migration-safe loading of existing state,
- tests for size caps and archive preservation.

Files likely involved:

- `engines/predictionAccuracyEngine.js`,
- `engines/decisionValidationEngine.js`,
- `engines/learningEngine.js`,
- possibly new repository/helper modules.

Acceptance criteria:

- no unbounded module-level learning/validation maps or arrays,
- existing summaries continue to work,
- existing public APIs remain compatible,
- production scoring unchanged.

Priority: second, because this is the highest-confidence heap growth source.

### Phase 11.3 - Listing Store Refactor

Objective: split active production listing memory from archived history and raw/diagnostic payloads.

Deliverables:

- compact production listing projection,
- active/recent listing retention policy,
- listing archive plan,
- raw payload removal or isolation,
- compatibility helpers for existing UI/API reads.

Files likely involved:

- `utils/appStore.js`,
- `server.js` integration in a later approved phase,
- possible new listing repository/helper modules,
- migration/compaction tooling.

Acceptance criteria:

- `store.listings` has bounded active memory,
- archived listings remain retrievable for review,
- Deal Gate and display behavior remain compatible,
- raw eBay payloads no longer live indefinitely in production RAM.

Priority: third.

### Phase 11.4 - Batched Persistence

Objective: remove whole-file JSON writes from per-listing scan paths.

Deliverables:

- scan write buffer,
- flush-on-scan-completion behavior,
- bounded state-store usage,
- segmented or append-only persistence for high-volume histories,
- failure handling and rollback semantics.

Files likely involved:

- `utils/stateStore.js` only if extended safely,
- new persistence helpers,
- learning/validation/history modules,
- scanner integration in later approved phase.

Acceptance criteria:

- high-volume scan writes are batched,
- bounded small files can still use `stateStore`,
- corrupt-file backup behavior remains available,
- production state durability remains safe.

Priority: fourth.

### Phase 11.5 - Scan Lifecycle Scheduler

Objective: replace fixed interval pileup with completion-based scheduling and explicit cooldowns.

Deliverables:

- scheduler contract,
- next-run metadata,
- rate-limit cooldown policy,
- scan timeout/cancellation design,
- bounded skipped-scan records.

Files likely involved:

- `services/scoutScannerService.js`,
- `server.js` only in an approved behavior-change phase,
- tests for scheduler behavior.

Acceptance criteria:

- scans cannot overlap,
- interval attempts do not pile up,
- rate limits lead to explicit cooldown state,
- scan timing change is reviewed and approved separately.

Priority: fifth, because overlap is currently guarded but scheduler semantics should mature.

### Phase 11.6 - Memory Stress Validation

Objective: prove memory growth is bounded.

Deliverables:

- deterministic large-store fixtures,
- repeated-scan stress harness,
- heap and object-count assertions,
- no-network marketplace stubs,
- regression tests for caps and persistence flush count.

Files likely involved:

- new tests,
- test fixtures,
- possibly validation/stress utilities.

Acceptance criteria:

- repeated scans do not increase retained records beyond contract caps,
- scan-local objects are released after completion,
- persistence calls are bounded,
- no production decision output changes.

Priority: sixth, then ongoing gate for future phases.

## Immediate Operational Guidance

Until Phase 11 implementation is approved:

- Disabling automatic Scout scanning is the safest mitigation for heap exhaustion.
- Increasing `NODE_OPTIONS=--max-old-space-size=...` can reduce crash frequency but does not fix growth.
- Reducing eBay query limits, retries, or scan frequency can reduce pressure but does not solve unbounded retention.
- Production data file sizes should be inspected before re-enabling aggressive scan cadence.

## Non-Negotiable Boundaries

Phase 11 memory work must not incidentally change:

- Deal Gate logic,
- `BUY_NOW`,
- valuation formulas,
- ROI calculations,
- confidence thresholds,
- notification behavior,
- marketplace request behavior,
- scan timing without explicit approval,
- canonical sold-evidence writes,
- production scoring semantics.

Memory architecture changes must be treated as infrastructure and persistence changes, not intelligence changes.

## Approval Gate

Phase 11.0A is complete when this architecture is reviewed and the owner approves the first implementation subphase.

No Phase 11.1 code should begin until the memory contracts are explicitly approved.
