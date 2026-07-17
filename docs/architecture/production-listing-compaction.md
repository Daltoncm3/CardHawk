# Production Listing Compaction

Phase 11.4 is the first runtime implementation step from the Phase 11.3 Production Listing Store Refactor. It reduces retained listing size by removing scan-only and marketplace-only payloads from long-lived production listings while preserving production behavior.

This phase does not change marketplace search behavior, scan cadence, eBay retry behavior, valuation formulas, confidence formulas, grading logic, Deal Gate decisions, BUY_NOW criteria, notification criteria, sold-evidence behavior, learning semantics, public API behavior, or database dependencies.

## Transient Versus Durable Listing Fields

CardHawk now distinguishes three listing field classes.

| Class | Examples | Owner | Retention Policy |
| --- | --- | --- | --- |
| Transient marketplace input | eBay raw item summary, raw response body, request headers, retry metadata | Marketplace adapter and scan working set | Available during scan/scoring only; removed from retained listings. |
| Transient scan/scoring working data | request/response objects, retry state, temporary scan metadata | Scan pipeline | Not persisted in `store.listings`. |
| Durable production listing data | identity, price, seller summary, scoring outputs, Deal Gate, display fields, timestamps | Active Listing Store | Preserved in compact retained listings. |

## Retained Canonical Shape

The compact retained listing preserves the fields required by current consumers:

- listing identity and deduplication: `listingId`, `marketplaceListingId`, `ebayItemId`, `title`, `url`;
- pricing and valuation: `price`, `shipping`, `totalCost`, `currency`, `condition`, `parsed`;
- seller, grading, and quality context: `sellerUsername`, `sellerFeedbackPercentage`, `sellerFeedbackScore`, `image`, `qualityData`, `investmentQuality`, `qualityBucket`;
- intelligence and scoring outputs: `score`, `estimatedValue`, `estimatedProfit`, `roi`, `ebayFees`, `compData`, `marketData`, `marketConfidence`, `confidenceReasons`, `confidenceCap`, `compCount`, `compSource`, `riskLevel`, `dealGrade`, `dealGate`;
- lifecycle and history fields: `lane`, `query`, `firstSeenAt`, `lastSeenAt`, `seenCount`, `alertCreated`;
- notification and API fields: `title`, `price`, `shipping`, `totalCost`, `url`, `image`, `sellerUsername`, `marketConfidence`, `compData`;
- canonical identity and evidence fields when present, because unknown future review/export flows may depend on them.

The compactor is conservative. It does not remove fields merely because a field is not currently referenced in one route.

## Raw Marketplace Payload Policy

The following retained-listing fields are treated as transient and removed:

- `raw`
- `rawListing`
- `rawMarketplaceListing`
- `rawMarketplaceResponse`
- `rawResponse`
- `apiResponse`
- `httpResponse`
- `request`
- `requestOptions`
- `response`
- `responseBody`
- `retryState`
- `retryMetadata`
- `headers`
- `fetchOptions`
- `scanRequest`
- `scanResponse`
- `temporaryScanData`

The compact replacement is `marketplaceProvenance`, which keeps a minimal source summary:

- marketplace,
- marketplace label,
- marketplace listing ID,
- URL,
- raw-payload removal marker,
- small raw-payload summary when the source object is available.

This preserves auditability without retaining the full eBay response, request headers, retry metadata, or duplicated marketplace object.

## Where Fields Originate And Who Consumes Them

| Field Group | Origin | Known Consumers | Compact Behavior |
| --- | --- | --- | --- |
| IDs and title | marketplace normalization | listing identity, history, UI/API, scoring, exports | preserved |
| price, shipping, totalCost | marketplace normalization | valuation, ROI, Deal Gate, BUY_NOW, notifications, history | preserved |
| seller summary | marketplace normalization | confidence, grading, quality, notifications | preserved |
| parsed identity | parser during marketplace normalization and rescoring | canonical identity, valuation, quality, grading, comp engines | preserved |
| scoring outputs | `scoreListing` | UI/API, notifications, review/export, validation | preserved |
| Deal Gate output | `dealGate` | UI/API, alerts, validation, review/export | preserved |
| scan timestamps/counts | `saveScoutedListing` and history tracking | history, confidence, UI/API, learning | preserved |
| raw marketplace payload | eBay/mock marketplace adapters | no durable production decision requirement once normalized | removed from retained listing |
| request/response/retry metadata | scan and marketplace working set | operational debugging only, not durable listing behavior | removed from retained listing |

## Legacy Migration Behavior

Legacy persisted listings may still contain raw payload fields. The app store now compacts listings when loading and saving state. This is deterministic and idempotent:

1. legacy listing is loaded,
2. durable production fields are preserved,
3. transient raw/request/response/retry fields are removed,
4. `marketplaceProvenance` and `listingCompaction` metadata are added,
5. future saves persist the compact retained shape.

No archive repository or lazy-loading path is created in this phase.

## Compatibility Guarantees

The focused Phase 11.4 tests verify that compact listings preserve:

- scoring compatibility,
- valuation compatibility,
- Deal Gate compatibility,
- BUY_NOW compatibility,
- notification rule and body compatibility,
- UI/API serialization fields,
- persistence and restart lookup behavior,
- legacy listing lookup by ID.

The compactor does not mutate the original marketplace input. Scan/scoring can continue using the full working object until the retained listing is written.

## Structural Footprint Measurement

Tests compare deterministic serialized JSON size before and after compaction. These are structural byte comparisons, not Node heap measurements. The representative fixture proves the compact listing is materially smaller than the legacy listing with raw marketplace payload and request/response metadata.

Exact heap savings in production will depend on live listing mix, V8 object representation, scan volume, and how quickly future phases bound active listing counts.

## Relationship To Phase 11

Phase 11.1 defined production memory contracts. Phase 11.4 implements part of the `store.listings` contract by reducing retained payload size.

Phase 11.2 bounded learning stores so learning memory cannot grow forever.

Phase 11.3 defined the listing-store architecture:

- Scan Working Set,
- Active Listing Store,
- Historical Listing Store,
- Archived Listing Store.

Phase 11.4 applies that architecture at the active retained listing boundary. It does not implement historical retention or archive storage.

## Remaining Work

Future phases should still address:

- active listing count retention,
- compact historical listing summaries,
- archive eligibility dry-run reports,
- archive storage,
- lazy-loaded historical listing retrieval,
- route compatibility tests for archived listings.

## Production Boundaries

Phase 11.4 does not change:

- marketplace requests,
- scanner cadence,
- eBay retry behavior,
- valuation formulas,
- confidence formulas,
- grading logic,
- Deal Gate criteria,
- BUY_NOW criteria,
- notification criteria,
- sold-evidence behavior,
- learning semantics,
- public API behavior.

The change is limited to retained listing compaction and app-store persistence normalization.
