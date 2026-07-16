# Production Intelligence Trace Contract

Phase 10.1 adds a permanent, additive Production Intelligence Trace Contract for documenting how a production scouting decision was reached.

The trace is read-only governance infrastructure. It does not call `server.js`, rescore listings, execute Deal Gate, change `BUY_NOW`, send notifications, change scan timing, or write Canonical Sold Evidence.

## Purpose

The trace records the production decision context that already exists at evaluation time:

- scan metadata
- parser output summary
- canonical identity summary
- evidence summary
- valuation summary
- confidence summary
- grading summary
- risk summary
- intelligence engine summaries
- Deal Gate inputs
- Deal Gate outcome
- `BUY_NOW` eligibility as reported by Deal Gate
- explanation chain
- deterministic fingerprint

The contract exists to improve auditability, regression testing, calibration, and future shadow-to-production review without changing current production behavior.

## Contract

The module is `validation/productionIntelligenceTrace.js`.

Public API:

- `createProductionIntelligenceTrace(input)`
- `buildProductionIntelligenceTraceFingerprint(trace)`
- `cloneProductionIntelligenceTrace(trace)`
- `PRODUCTION_INTELLIGENCE_TRACE_SCHEMA_VERSION`
- `PRODUCTION_INTELLIGENCE_TRACE_SOURCE`
- `UNKNOWN_VALUE`

The trace uses schema version `1.0.0` and source `production_intelligence_trace`.

## Unknown Values

The trace never invents missing values. Missing scalar values are recorded as `unknown`. Missing arrays are recorded as empty arrays. Missing objects are recorded as empty objects where the field is structurally optional.

This distinction lets a future reviewer separate:

- evidence that was present and negative,
- evidence that was present and positive,
- evidence that was unavailable,
- evidence that was never supplied to the trace builder.

## Immutability

`createProductionIntelligenceTrace` returns a deeply frozen object. The trace fingerprint is generated from the trace projection with `stableFingerprint` removed before hashing.

The fingerprint proves deterministic equality of the recorded trace projection. It does not prove marketplace truth, source permission, valuation accuracy, or Deal Gate correctness.

## Deal Gate Boundary

The trace does not execute Deal Gate. It only records Deal Gate inputs and outcomes supplied by the production runtime or tests.

`BUY_NOW` eligibility is derived only from the provided Deal Gate outcome. Buy-like signals from grading, Market Intelligence, Decision Intelligence, or any shadow system are preserved as context but cannot create trace-level `BUY_NOW` eligibility when Deal Gate rejects or is unavailable.

## Production Boundary

This contract has no production authority.

It must not:

- alter production scoring,
- alter Deal Gate decisions,
- alter `BUY_NOW` behavior,
- alter notifications,
- alter marketplace requests,
- alter scan timing,
- write Canonical Sold Evidence,
- treat active listings as true sold evidence.

Any future runtime integration must remain additive unless a separate approved authority-migration phase explicitly changes production behavior.
