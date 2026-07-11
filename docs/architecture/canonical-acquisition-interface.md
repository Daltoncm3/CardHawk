# Canonical Acquisition Interface

Phase 4.5B defines the marketplace-agnostic interface every future sold-evidence source must implement.

This is an architecture foundation only. It does not change runtime behavior, valuation, ROI, Deal Gate, BUY_NOW, grading, scoring, confidence, recommendations, notifications, persistence, or scan timing.

## Objectives

- Give every sold-evidence source one common adapter contract.
- Keep marketplace access separate from valuation and decision logic.
- Preserve the evidence firewall between true sold evidence, aggregate market prices, and active context.
- Require capability reporting before an adapter can emit transaction-level sold records.
- Make provenance, identity, validation, status, and error handling consistent across sources.

## Required Adapter Contract

Every future adapter must expose:

- `sourceId`
- `marketplace`
- `marketplaceLabel`
- `sourceName`
- `adapterName`
- `adapterVersion`
- `capabilities`
- `getCapabilities()`
- `getStatus()`
- `normalizeRecord(record, options)`
- `acquireSoldEvidence(request, options)`

Adapters should be created through `createCanonicalAcquisitionAdapter()` and registered through `createAcquisitionRegistry()`.

## Acquisition Request Shape

```json
{
  "requestId": "optional-request-id",
  "query": "2023 Panini Prizm UFC Anthony Hernandez #181 Silver Prizm",
  "canonicalCardKey": "optional-canonical-card-key",
  "identity": {
    "category": "sports_card",
    "sport": "mma",
    "player": "Anthony Hernandez",
    "year": "2023",
    "brand": "Panini",
    "setName": "Prizm UFC",
    "cardNumber": "181",
    "parallel": "Silver Prizm",
    "rookie": true,
    "autograph": false,
    "memorabilia": false,
    "serialNumbered": false
  },
  "filters": {
    "marketplace": "ebay"
  },
  "window": {
    "dateFrom": "2026-01-01T00:00:00.000Z",
    "dateTo": "2026-07-10T00:00:00.000Z"
  },
  "limit": 100,
  "cursor": null,
  "requestedEvidenceTypes": ["true_sold"],
  "context": {}
}
```

At least one of `query`, `canonicalCardKey`, or `identity` must be present.

## Acquisition Output Shape

```json
{
  "source": {
    "sourceId": "card_ladder",
    "marketplace": "card_ladder",
    "sourceName": "Card Ladder",
    "adapterName": "card_ladder_acquisition_adapter",
    "adapterVersion": "0.0.1",
    "capabilities": {}
  },
  "request": {},
  "records": [],
  "validation": [],
  "errors": [],
  "warnings": [],
  "cursor": null,
  "acquiredAt": "2026-07-10T00:00:00.000Z",
  "summary": {
    "returned": 0,
    "trueSoldCount": 0,
    "aggregateMarketPriceCount": 0,
    "activeContextCount": 0,
    "validRecordCount": 0,
    "invalidRecordCount": 0,
    "errorCount": 0,
    "warningCount": 0
  }
}
```

## Evidence Types

- `true_sold`: transaction-level sold evidence with final sold price and sold date.
- `aggregate_market_price`: source-provided market price or summary value, not a transaction.
- `active_context`: active listing, ask price, or non-transactional context.

Sources without `transactionLevelSoldSupport: true` must never produce `true_sold`.

## Capability Reporting

Each adapter must declare:

- access mode: `manual_import`, `licensed_feed`, `partner_api`, `official_api`, `offline_fixture`, or `unknown`
- source reliability
- transaction-level sold support
- aggregate market price support
- active context support
- Best Offer support
- shipping support
- certification support
- identity fields supplied
- provenance fields supplied
- incremental sync support
- historical backfill support
- health check support
- commercial-use permissions and restrictions

## Provenance Requirements

Each record should preserve:

- marketplace
- adapter
- retrieval method
- source reliability
- acquired timestamp
- source URL or record URL
- source record ID when available
- license/commercial-use metadata when available

## Identity Requirements

Canonical records should include enough identity to distinguish exact cards:

- category
- sport/game
- player/subject/character
- year
- brand/product
- set name
- card number
- parallel or base designation
- rookie flag
- autograph flag
- memorabilia flag
- serial-numbered flag
- grade and certification data when present

The interface validates the core minimum identity fields and leaves deeper card-specific quality scoring to downstream evidence engines.

## Error Handling

Adapters should not throw into runtime callers. Acquisition failures should be represented as structured errors:

- `code`
- `message`
- `adapterName`
- `sourceId`
- `retryable`
- `occurredAt`

The base adapter catches thrown errors and returns an empty evidence result with structured error metadata.

## Adapter Registration

Future adapters plug in through:

```js
const registry = createAcquisitionRegistry();
registry.registerAdapter(adapter);
const result = await registry.acquire('source_id', request);
```

Registration validates the adapter contract before the adapter can be used.

## Health and Status

Each adapter must support `getStatus()`.

Allowed status values:

- `ready`
- `disabled`
- `unconfigured`
- `degraded`
- `error`

Health checks should never acquire marketplace records. They should only report readiness, configuration, and source availability.

## Safety Guardrails

- No live marketplace source is implemented in Phase 4.5B.
- No adapter is connected to runtime scanning.
- No acquired record affects valuation or recommendations.
- Aggregate and active evidence cannot satisfy true-sold support.
- Source capabilities control what evidence type can be emitted.
- Commercial-use metadata must be preserved for licensed providers.

## Future Adapter Order

Recommended adapter implementation order:

1. Manual verified batch adapter
2. Licensed aggregator adapter: Card Ladder or Market Movers
3. Fanatics Collect / PWCC partner adapter
4. eBay approved sold-evidence adapter, only with compliant access
5. TCGplayer partner adapter
6. Goldin / COMC / Alt partner adapters
7. Additional marketplaces
