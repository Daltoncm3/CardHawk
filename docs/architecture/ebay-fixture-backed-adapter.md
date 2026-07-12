# eBay Fixture-Backed Acquisition Adapter

## Purpose

The fixture-backed eBay adapter mode routes offline eBay fixture records through the eBay Response Translator and returns Canonical Acquisition-compatible results.

This is not live eBay acquisition. It performs no network requests, no scraping, no API calls, and no production store writes. It does not affect runtime valuation, ROI, Deal Gate, BUY_NOW, grading, scoring, confidence, recommendations, notifications, persistence behavior, or scan timing.

## Default Behavior

The default eBay Acquisition Adapter remains a skeleton:

- acquisition returns `ebay_acquisition_not_implemented`
- no records are emitted
- transaction-level sold support is false
- certification remains Draft
- no network access is performed

Fixture-backed behavior is enabled only with:

```js
createEbayAcquisitionAdapter({
  config: {
    fixtureMode: {
      enabled: true
    }
  }
});
```

## Offline Fixture Flow

When fixture mode is enabled:

1. The adapter loads `tests/fixtures/ebay/sold-listing-scenarios.json`.
2. A deterministic fixture scenario is selected.
3. Fixtures are paginated by cursor and page size.
4. Each fixture is translated through `marketplaces/ebayResponseTranslator.js`.
5. The Canonical Acquisition Interface normalizes records.
6. Translation warnings and provenance are preserved.
7. The result is returned as an acquisition result with `fixtureOnly: true` and `networkAccess: false`.

## Supported Fixture Scenarios

The adapter supports deterministic fixture scenarios:

- `valid_subset`
- `valid_all`
- `all`
- `invalid`
- `duplicates`
- `malformed`
- `partial_failure`

The scenario can be supplied through fixture configuration or request context:

```js
adapter.acquireSoldEvidence({
  query: "fixture query",
  context: {
    fixtureScenario: "duplicates"
  }
});
```

## Pagination and Replay

Pagination is deterministic:

- cursor is a numeric offset encoded as a string
- page size comes from request `limit` or fixture config
- replaying the same request returns the same record IDs in the same order
- advancing with `cursor` returns the next deterministic batch

## Certification Status

The fixture-backed adapter can pass:

- Acquisition Adapter Conformance
- Acquisition-to-Store Pipeline Conformance
- Marketplace Adapter Certification

The justified certification level is `Certified` for fixture-only operation. It is not `Production Approved`.

Production approval remains blocked because:

- the source is offline fixtures only
- commercial usage and licensing are not approved for live eBay acquisition
- authentication is not implemented
- live request execution is not implemented
- live pagination and rate limiting are not implemented
- no compliant live sold-data endpoint has been connected

## Live Ingestion Safety Gate

The fixture-backed adapter can be run through the Live Ingestion Safety Gate in dry-run mode. Because the adapter is not Production Approved, the gate rejects store admission with `certification_gate_failed`.

This is expected and desirable. It proves the fixture-backed adapter can exercise the safety gate without allowing records into the canonical production store.

## Remaining Prerequisites Before Live Connection

Before any live eBay integration:

- approve a compliant sold-evidence source
- confirm commercial usage rights
- implement authentication
- implement live request execution
- implement live pagination, retries, and rate limits
- certify against deterministic fixtures
- pass live ingestion safety gate requirements
- explicitly approve any production-store admission path
