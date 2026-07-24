# DecisionValidation Runtime Diagnostics

Phase 11.13B adds observability for DecisionValidation persistence batching. It does not change persistence timing, persistence format, scanner behavior, Deal Gate, BUY_NOW, valuation, marketplace behavior, notifications, History, PredictionAccuracy, or AppStore behavior.

## Purpose

Production serialization instrumentation showed DecisionValidation still writing approximately once per processed listing after Phase 11.12B. These diagnostics prove whether the runtime process is actually executing the scanner-scoped batching path.

## Summary Fields

During an active scout scan, the existing serialization summary may include:

```text
DecisionValidationPersistence Diagnostics
beginPersistenceBatchCalls: 1
flushPersistenceBatchCalls: 1
cancelPersistenceBatchCalls: 0
deferredPersistenceRequests: many
immediatePersistenceCount: 0
flushTriggeredPersistenceCount: 1
currentBatchDepth: 0
currentDirtyState: false
```

The counters are passive. They do not control persistence and do not change any JSON state.

## Expected Production Reading

For a normal scout scan with successful listing decisions:

- `beginPersistenceBatchCalls` should be `1`.
- `flushPersistenceBatchCalls` should be `1`.
- `cancelPersistenceBatchCalls` should be `0`.
- `deferredPersistenceRequests` should roughly match successful DecisionValidation mutations.
- `immediatePersistenceCount` should be `0` during the scan.
- `flushTriggeredPersistenceCount` should be `1` when at least one mutation occurred.
- the `DecisionValidation` serialization group should show one write.

If `immediatePersistenceCount` is close to the processed listing count, the production runtime is not executing the active batch path for `recordDecision(...)` or `recordOutcome(...)`.

If `beginPersistenceBatchCalls` is missing or `0`, the deployed scanner is not opening the DecisionValidation batch.

If `flushPersistenceBatchCalls` is missing or `0`, scan cleanup is not reaching the DecisionValidation flush path.

## Runtime Helper

`decisionValidationEngine.getPersistenceDiagnostics()` returns process-lifetime counters plus current batch depth and dirty state. It is read-only and does not inspect or modify persisted JSON.

## Deployment Verification

After deploying, inspect the next complete scout scan serialization summary in Railway logs.

Expected activation signal:

- `DecisionValidationPersistence Diagnostics` appears.
- `beginPersistenceBatchCalls: 1`.
- `flushPersistenceBatchCalls: 1`.
- `deferredPersistenceRequests` is greater than `0` when listings were processed.
- `immediatePersistenceCount` is absent or `0`.
- `flushTriggeredPersistenceCount: 1`.
- `DecisionValidation` writes are approximately `1`.

Failure signal:

- `DecisionValidation` writes remain near listing count.
- `immediatePersistenceCount` is near listing count.
- or the diagnostics block is absent from a scan that has serialization output.

Those failure signals indicate that production is not running the expected Phase 11.12B scanner-to-engine path.
