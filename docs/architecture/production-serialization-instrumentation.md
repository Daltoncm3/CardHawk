# Production Serialization Instrumentation

Phase 11.9B adds temporary production instrumentation for JSON serialization hotspots. The goal is to identify which serialization path is responsible for production heap exhaustion where the native stack includes `Builtin_JsonStringify`.

This phase does not batch persistence, optimize serialization, change persisted data, or alter production decisions.

## Instrumented Paths

The shared collector lives in `utils/serializationInstrumentation.js`.

Instrumented production paths include:

- `utils/stateStore.js` full JSON state persistence and fallback cloning.
- `utils/appStore.js` app-store load and save grouping.
- `engines/historyEngine.js` active-history and archive-segment writes.
- `engines/predictionAccuracyEngine.js` prediction-state writes.
- `engines/decisionValidationEngine.js` decision-validation-state writes.
- `utils/listingCompaction.js` retained-listing JSON clone and structural size estimation.
- `utils/activeListingRetention.js` retention-policy JSON clone.
- `engines/learningEngine.js` learning snapshot JSON clone.
- `utils/persistenceCoordinator.js` diagnostics clone.
- `utils/soldEvidenceStore.js` sold-evidence clone/load/save grouping.
- `engines/notificationEngine.js` notification-state writes and Resend JSON request body.
- `utils/shadowModeLogger.js` shadow-mode state writes.
- `utils/operatorAuditLog.js` audit-log state writes.
- `marketplaces/ebayMarketplace.js` serialized eBay error payloads.
- Explicit server diagnostic-page JSON rendering.

Express `res.json` responses are not pre-stringified by this phase because doing so would duplicate every API serialization. Request-driven JSON responses remain observable through route-level behavior and can receive targeted instrumentation later if production evidence points at an API route.

## Scan Summary

Each scout scan opens a serialization aggregation window and emits one compact summary when the scan ends. The summary groups measurements by subsystem instead of logging once per listing.

Example:

```text
=== Serialization Summary ===

AppStore
writes: 1
bytes: 18.3 MB
largest: 18.3 MB
time: 52 ms

DecisionValidation
writes: 824
bytes: 411.0 MB
largest: 610.0 KB
time: 214 ms

Total serialization bytes: 429.3 MB
Total writes: 825
Largest serialization: AppStore 18.3 MB
Peak heap delta: DecisionValidation 3.1 MB
```

## Recorded Fields

For every measured serialization operation, the collector records:

- source file
- function name
- serialization type
- serialized byte count
- elapsed serialization time in milliseconds
- heap used before and after serialization
- RSS before and after serialization

Per scan, it records:

- number of serializations
- cumulative bytes serialized
- largest single serialization
- total serialization time
- largest heap delta
- grouped write counts and byte totals

## Production Boundaries

This instrumentation is observational only.

It does not change:

- scanner cadence
- eBay search or retry behavior
- listing scoring
- valuation
- confidence formulas
- Deal Gate
- BUY_NOW
- notifications
- persistence formats
- Canonical Sold Evidence behavior

The instrumentation is intentionally easy to remove after the serialization hotspot is identified.
