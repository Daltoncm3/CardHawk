# Bounded Learning Stores

Phase 11.2 applies the Phase 11 memory contracts to CardHawk's long-lived learning stores. The goal is not to change production decisions, valuation, Deal Gate behavior, BUY_NOW behavior, scanner timing, marketplace behavior, or notifications. The goal is to prevent memory and persisted JSON state from growing forever.

## Why Bounded Retention Exists

Prediction accuracy, decision validation, and learning records survive longer than one scan. Before this phase, these stores could accumulate records, histories, and lookup indexes without a maximum active size. That violates the Phase 11 memory contract because a production process that scans forever should not require memory forever.

Bounded retention gives each store a clear active working set:

- recent prediction accuracy records,
- recent decision validation records,
- recent learning records by listing,
- bounded per-record histories,
- bounded recent event arrays.

Historical learning that needs permanent audit value should move to an archive or compacted repository in a later phase. It should not remain indefinitely in active RAM.

## Default Retention Policies

The defaults are intentionally conservative so existing production behavior is preserved for normal operating windows:

| Store | Default Active Cap |
| --- | --- |
| Prediction Accuracy tracked predictions | 5,000 |
| Prediction Accuracy outcome history | 10,000 |
| Prediction Accuracy outcomes per prediction | 100 |
| Decision Validation tracked decisions | 5,000 |
| Decision Validation decision history | 10,000 |
| Decision Validation outcome history | 10,000 |
| Decision Validation snapshots per decision | 100 |
| Decision Validation outcomes per decision | 100 |
| Learning Engine tracked listing records | 5,000 |
| Learning Engine per-record history length | 100 |
| Learning Engine recent events | 1,000 |

The caps can be configured with environment variables:

- `CARDHAWK_MAX_TRACKED_PREDICTIONS`
- `CARDHAWK_MAX_PREDICTION_OUTCOME_HISTORY`
- `CARDHAWK_MAX_OUTCOMES_PER_PREDICTION`
- `CARDHAWK_MAX_TRACKED_DECISIONS`
- `CARDHAWK_MAX_DECISION_HISTORY`
- `CARDHAWK_MAX_DECISION_OUTCOME_HISTORY`
- `CARDHAWK_MAX_SNAPSHOTS_PER_DECISION`
- `CARDHAWK_MAX_OUTCOMES_PER_DECISION`
- `CARDHAWK_MAX_TRACKED_LEARNING_RECORDS`
- `CARDHAWK_MAX_LEARNING_HISTORY_LENGTH`
- `CARDHAWK_MAX_LEARNING_RECENT_EVENTS`

The persisted Prediction Accuracy and Decision Validation state files can also be redirected for tests or controlled operations with:

- `CARDHAWK_PREDICTION_ACCURACY_STATE_FILE`
- `CARDHAWK_DECISION_VALIDATION_STATE_FILE`

## Eviction Policy

The canonical policy is oldest-first eviction.

For append-only histories, the oldest entries are at the beginning of the array and the newest entries are retained. For map-backed active records, pruning sorts by the store's canonical age field and then by stable ID as a deterministic tie-breaker.

Current age fields:

- Prediction Accuracy: prediction insertion order in `predictionHistory`.
- Decision Validation: `lastRecordedAt`, then `firstRecordedAt`, then `timestamp`, with `listingId` as tie-breaker.
- Learning Engine: `lastSeenAt`, then `firstSeenAt`, with `ebayItemId` as tie-breaker.

Retained records keep their existing shape. Their public getters, summaries, derived fields, and outcome logic remain compatible.

## Active Memory vs Archived History

Active memory is the recent working set needed by production-supporting learning and validation summaries.

Archived history is older evidence that may still matter for long-term analysis, calibration, audit, or reporting. Phase 11.2 does not introduce an archive repository. It makes the active stores bounded so future archival work has a clean contract:

- active stores stay small enough for production memory,
- archived stores can be compact, lazy-loaded, or streamed,
- summaries continue to operate over the active retained window.

## Restart Behavior

Prediction Accuracy and Decision Validation load persisted JSON state on module startup. During load, existing state is normalized and bounded with the current retention policy. That means old unbounded state can be read safely and then saved back in bounded form on the next persistence write.

The Learning Engine remains in-memory only, so restart behavior is unchanged: records do not survive process restarts.

## Relationship To Phase 11 Memory Contracts

Phase 11.1 defined memory contracts for long-lived production objects. Phase 11.2 is the first implementation step for the learning-store contracts:

- `predictionAccuracyEngine`
- `decisionValidationEngine`
- `learningEngine`

This phase reduces unbounded active memory growth but does not complete the archival story. Later phases may add compact archives, batched persistence, and streamable long-term reporting.

## Production Boundaries

Phase 11.2 does not change:

- `server.js`,
- Deal Gate,
- BUY_NOW,
- production valuation,
- scanner behavior,
- scan timing,
- marketplace adapters,
- sold evidence,
- notifications.

The bounded stores remain production-supporting memory infrastructure only. They do not authorize new production decisions.
