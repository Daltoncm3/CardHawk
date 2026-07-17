# Production Memory Contracts

## Status

Phase 11.1 establishes CardHawk's canonical memory-governance layer.

This phase is offline and contract-only. It does not inspect live memory, import `server.js`, modify runtime components, change persistence, alter scanner behavior, change Deal Gate, change `BUY_NOW`, change valuation, change marketplace behavior, change scan scheduling, or change notifications.

## Module

`validation/productionMemoryContracts.js`

Public helpers:

- `createMemoryContract`
- `validateMemoryContract`
- `evaluateMemoryContractCompliance`
- `summarizeMemoryContracts`
- `buildMemoryContractFingerprint`

Primary exported data:

- `CANONICAL_MEMORY_CONTRACTS`

Supporting exported constants:

- `COMPLIANCE_STATUS`
- `EXPECTED_GROWTH`
- `MEMORY_CATEGORY`
- `MEMORY_LIFETIME`
- `PERSISTENCE_MODEL`
- `PRODUCTION_AUTHORITY`
- `REQUIRED_MEMORY_CONTRACT_FIELDS`
- `PRODUCTION_MEMORY_CONTRACT_SCHEMA_VERSION`
- `PRODUCTION_MEMORY_CONTRACT_SOURCE`
- `UNKNOWN_VALUE`

## Why Memory Contracts Exist

CardHawk's production runtime has grown from a small scout into a layered decision-intelligence system. Several objects now live across scans, restarts, or module lifetime:

- production listings,
- scan summaries,
- alert and rejection windows,
- prediction accuracy state,
- decision validation state,
- learning state,
- listing history,
- marketplace adapter outputs,
- scoring and diagnostic objects,
- canonical sold-evidence stores,
- caches and lookup maps.

Without explicit memory contracts, a production object can quietly become unbounded. The result is long-term heap growth, larger JSON files, slower scan completion, repeated full-file serialization, and eventually Node.js heap exhaustion.

The contract layer makes memory ownership reviewable before cleanup or optimization begins.

## Contract Shape

Each memory contract records:

- `componentId`
- `componentName`
- `owner`
- `category`
- `lifetime`
- `persistenceModel`
- `expectedGrowth`
- `maximumRetentionPolicy`
- `archivePolicy`
- `inMemoryPolicy`
- `lazyLoadEligible`
- `streamEligible`
- `compactEligible`
- `boundedRequired`
- `currentCompliance`
- `futurePhase`
- `productionAuthority`
- `notes`
- `stableFingerprint`

The fingerprint is deterministic and excludes the fingerprint field itself.

## Bounded vs. Unbounded Memory

Bounded memory has a clear maximum size, such as:

- 100 scan summaries,
- 200 alerts,
- 300 rejections,
- 1000 notification idempotency keys,
- one cached eBay token.

Unbounded memory grows with production activity without an enforced maximum, such as:

- all marketplace listings ever seen,
- all prediction accuracy records,
- all decision validation histories,
- all learning records by listing ID,
- all listing history records across time.

Partially bounded memory has some caps but still contains at least one unbounded dimension. For example, `historyEngine` caps price points per listing but does not cap total listing records.

## Retention Policies

A valid long-term production memory object must eventually declare:

- what stays in RAM,
- what gets compacted,
- what gets archived,
- what can be loaded lazily,
- what can be streamed,
- what the maximum active retention window is,
- and which phase owns the migration.

Contracts do not perform retention. They make retention requirements explicit and testable.

## Persistence Philosophy

`utils/stateStore.js` remains appropriate for small bounded JSON files.

It is not the long-term persistence model for high-volume production records because it reads, parses, stringifies, and writes whole files. High-volume stores should move toward:

- bounded active state,
- archive segments,
- scan-batched writes,
- append-oriented or repository-specific persistence,
- lazy loading for historical detail,
- and streamable report/export paths.

## Canonical Contract Coverage

The canonical contract set covers the long-lived objects identified in Phase 11.0A:

- `store`
- `store.listings`
- `store.alerts`
- `store.rejections`
- `store.scans`
- `predictionAccuracyEngine`
- `decisionValidationEngine`
- `learningEngine`
- `historyEngine`
- `stateStore`
- `ebayTokenCache`
- `trendEngine.cache`
- `moduleLookupMaps`
- `ebayRetryState`
- `scannerLifecycle`
- `marketplaceAdapterOutput`
- `parserOutput`
- `scoringObjects`
- `valuationObjects`
- `confidenceObjects`
- `notificationState`
- `systemHealthState`
- `shadowModeState`
- `canonicalSoldEvidenceStore`

## Compliance Meaning

`compliant` means the object currently has an acceptable bound or constant-size behavior for its role.

`partial` means some memory dimensions are bounded, but at least one important dimension still needs a contract or implementation work.

`non_compliant` means the object has known unbounded growth or stores too much data for its long-term production role.

`needs_contract` means Phase 11.0A identified ownership, but a precise cap or behavior still needs verification.

Compliance status does not grant or remove production authority. It is memory governance only.

## Future Implementation Phases

### 11.2 Bounded Learning Stores

Apply contracts to:

- `predictionAccuracyEngine`
- `decisionValidationEngine`
- `learningEngine`
- long-lived module lookup maps

Expected direction:

- bounded recent records,
- archive policy,
- batched persistence,
- compatibility-preserving summaries.

### 11.3 Listing Store Refactor

Apply contracts to:

- `store`
- `store.listings`
- parser output,
- marketplace adapter output,
- scoring objects,
- valuation objects,
- confidence objects,
- listing history.

Expected direction:

- compact active listing summaries,
- archived listing details,
- raw payload isolation,
- display compatibility.

### 11.4 Batched Persistence

Apply contracts to:

- `stateStore`
- high-volume JSON persistence paths,
- scan write flows.

Expected direction:

- keep whole-file JSON for bounded state,
- remove per-listing whole-file writes,
- introduce scan-batched or segmented persistence for large records.

### 11.5 Scan Lifecycle Scheduler

Apply contracts to:

- scanner lifecycle state,
- retry state,
- scan-local observations.

Expected direction:

- completion-based scheduling,
- explicit cooldowns,
- compact scan observations,
- no overlapping scans.

### 11.6 Memory Stress Validation

Apply contracts through deterministic stress tests:

- repeated scans,
- large fixture stores,
- bounded object counts,
- persistence flush counts,
- and stable production behavior.

## Production Boundaries

Memory contracts do not change:

- `server.js`
- production scoring
- Deal Gate
- `BUY_NOW`
- valuation
- ROI
- confidence thresholds
- notifications
- marketplace behavior
- scan timing
- persistence behavior
- canonical sold-evidence writes

They are the governance model that future implementation phases must follow.
