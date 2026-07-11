# Manual Acquisition Adapter

Phase 4.5C adds the first reference adapter for the Canonical Acquisition Interface.

This adapter wraps the existing manual dataset workflow only. It does not scrape, call marketplace APIs, write to the production canonical sold evidence store, or affect runtime behavior.

## Purpose

The manual adapter demonstrates the pattern every future marketplace adapter should follow:

1. Load source-specific evidence input.
2. Validate source records before acquisition output.
3. Return only eligible records.
4. Pass records through the Canonical Acquisition Interface.
5. Preserve source diagnostics as metadata.
6. Let the interface normalize records, summarize evidence types, validate identity/provenance, and enforce true-sold capability rules.

## Source

The adapter consumes existing manual dataset batch files created for Phase 4.4C:

```json
{
  "batchId": "batch-001",
  "records": []
}
```

It also accepts in-memory batch objects for tests and future offline workflows.

## Usage

```js
const {
  createManualAcquisitionAdapter
} = require('./marketplaces/manualAcquisitionAdapter');

const adapter = createManualAcquisitionAdapter({
  batchFiles: [
    'validation/sold-evidence-dataset/batches/batch-001.json'
  ]
});

const result = await adapter.acquireSoldEvidence({
  query: 'Anthony Hernandez Silver Prizm'
});
```

The result is a canonical acquisition result with:

- `source`
- `request`
- `records`
- `validation`
- `errors`
- `warnings`
- `metadata`
- `summary`

## Metadata

Manual batch diagnostics are preserved under:

```json
{
  "metadata": {
    "manualDataset": {},
    "validationReport": {}
  }
}
```

This metadata is evidence governance context only. It must not be used for BUY_NOW, Deal Gate, scoring, recommendations, or valuation.

## Future Adapter Pattern

Future source adapters should follow the same structure:

```js
const adapter = createCanonicalAcquisitionAdapter({
  sourceId: 'future_source',
  marketplace: 'future_source',
  adapterName: 'future_source_acquisition_adapter',
  capabilities: {
    accessMode: 'licensed_feed',
    sourceReliability: 'licensed',
    transactionLevelSoldSupport: true
  },
  acquire: async (request, options) => ({
    request,
    records: [],
    metadata: {}
  }),
  healthCheck: async () => ({
    status: 'ready'
  })
});
```

Source-specific code should stay inside the adapter. Runtime valuation and decision code should not know how the source works.

## Safety Rules

- Do not write to `data/sold-evidence.json`.
- Do not import records into production storage.
- Do not call marketplace APIs.
- Do not alter runtime listings.
- Do not use acquisition output for marketValue, ROI, scoring, grading, confidence, recommendations, BUY_NOW, or Deal Gate until a later explicitly approved phase.

## Limitations

- Manual records are only as reliable as the reviewer workflow.
- Query filtering is intentionally conservative.
- Duplicate records are reported as warnings; this reference adapter does not deduplicate or write a store.
- Commercial/source-use compliance remains encoded as metadata and reviewer responsibility.
