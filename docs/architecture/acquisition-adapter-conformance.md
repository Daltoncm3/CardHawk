# Acquisition Adapter Conformance Harness

Phase 4.5D adds an offline conformance harness for Canonical Acquisition Interface adapters.

This harness is a validation gate only. It does not run in production, does not call live marketplaces, does not write to the canonical sold evidence store, and does not affect valuation, ROI, Deal Gate, BUY_NOW, grading, scoring, confidence, recommendations, notifications, persistence, or scan timing.

## Purpose

Every future acquisition adapter should pass this harness before it is considered valid for broader testing.

The harness checks:

- Canonical Acquisition Interface compliance
- Required capability metadata
- Interface and adapter versioning
- Provenance enforcement
- Identity requirements
- Health/status reporting
- Structured errors for invalid requests
- Malformed record validation
- Partial failure behavior
- Deterministic fixture replay
- Evidence firewall behavior for sources without transaction-level sold support

## Usage

```js
const {
  runAcquisitionAdapterConformance
} = require('../validation/acquisitionAdapterConformance');
const {
  createManualAcquisitionAdapter
} = require('../marketplaces/manualAcquisitionAdapter');

const adapter = createManualAcquisitionAdapter({
  batches: [
    {
      batchId: 'batch-001',
      records: []
    }
  ]
});

const report = await runAcquisitionAdapterConformance(adapter);
```

The report includes:

- `passed`
- `totalChecks`
- `passedChecks`
- `failedChecks`
- `checks`
- `failures`
- `diagnostics`

## Fixture Replay

The harness runs the same valid request twice and compares canonical records. This catches adapters that produce nondeterministic output from the same fixture input.

Future live adapters should use offline fixtures or mocked transport responses for conformance. They must not call live APIs during conformance tests.

## Partial Failure Fixture

Adapters that support partial failure behavior can be tested by passing `partialFailureAdapter`:

```js
await runAcquisitionAdapterConformance(adapter, {
  partialFailureAdapter
});
```

The partial failure adapter should return a valid acquisition result shape with structured errors.

## No-Transaction Fixture

Adapters or source modes without transaction-level sold support can be tested with `noTransactionAdapter`:

```js
await runAcquisitionAdapterConformance(adapter, {
  noTransactionAdapter
});
```

The harness confirms those sources cannot emit `true_sold` evidence.

## Future Adapter Requirement

Before any adapter is used beyond offline validation, it should:

1. Implement the Canonical Acquisition Interface.
2. Declare complete capabilities.
3. Preserve provenance.
4. Return canonical acquisition results.
5. Pass this conformance harness.
6. Have source-specific unit tests.
7. Have licensing/commercial-use metadata reviewed.

## Limitations

- The harness validates interface behavior, not marketplace legal permission.
- The harness does not prove identity parsing quality beyond required fields.
- The harness does not deduplicate or write evidence to storage.
- Live API behavior must be tested separately with approved mocked fixtures or sanctioned sandbox environments.
