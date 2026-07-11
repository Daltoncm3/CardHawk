# Canonical Sold Evidence Store Conformance Harness

Phase 4.6A adds an offline conformance harness for the Canonical Sold Evidence Store.

This harness validates records and in-memory store results only. It does not modify runtime behavior, does not touch `server.js`, does not write to the production canonical sold evidence store, and does not affect valuation, ROI, Deal Gate, BUY_NOW, grading, scoring, confidence, recommendations, notifications, persistence, or scan timing.

## Purpose

Every record entering the canonical sold evidence store should satisfy the permanent evidence contract before any future valuation or intelligence layer consumes it.

The harness checks:

- Canonical record schema
- Required identity fields
- Required provenance fields
- Evidence type correctness
- Transaction-level sold eligibility
- Duplicate handling
- Immutable record requirements
- Store version compatibility
- Store index and stats consistency
- Import batch consistency
- Deterministic fixture replay

## Usage

```js
const {
  runSoldEvidenceStoreConformance
} = require('../validation/soldEvidenceStoreConformance');

const report = runSoldEvidenceStoreConformance({
  records: [
    {
      marketplace: 'eBay',
      marketplaceSaleId: 'sale-001',
      rawTitle: '2023 Panini Prizm UFC Anthony Hernandez #181 Silver Prizm RC',
      soldPrice: 7.5,
      soldAt: '2026-07-01T12:00:00.000Z',
      url: 'https://example.test/sold/001',
      parsedIdentity: {}
    }
  ]
});
```

The report includes:

- `passed`
- `totalChecks`
- `passedChecks`
- `failedChecks`
- `checks`
- `failures`
- `recordReports`
- `summary`
- in-memory `store`

## Evidence Rules

The canonical store is for transaction-level sold evidence only.

Records fail conformance when they are:

- `active_context`
- `aggregate_market_price`
- missing sold price
- missing sold date
- missing required identity
- missing provenance
- missing stable duplicate keys
- incompatible with the current store version

## Duplicate Handling

The harness inserts normalized fixture records into an in-memory store and verifies:

- duplicate insertions are detected
- duplicate records point to an existing record
- duplicate index entries match stored records
- store stats match actual indexes

## Deterministic Replay

The same fixture batch is inserted twice into fresh in-memory stores. Results must be deterministic. Fixture records should include stable provenance timestamps to avoid accidental time-dependent output.

## Future Use

Before any future acquisition source writes records to the canonical sold evidence store, its output should pass:

1. Acquisition Adapter Conformance
2. Canonical Sold Evidence Store Conformance
3. Source-specific fixture tests
4. Licensing/provenance review

## Limitations

- The harness validates structure and store behavior, not legal rights to use a source.
- It validates required identity fields, not full expert-level card matching.
- It does not write records to production storage.
- It does not replace human review for manually collected evidence.
