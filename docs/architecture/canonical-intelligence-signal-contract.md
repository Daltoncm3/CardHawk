# Canonical Intelligence Signal Contract

## Purpose

The Canonical Intelligence Signal Contract is the Phase 13 wrapper contract for CardHawk intelligence outputs. It gives production, shadow, offline, and governance signals a shared metadata envelope without replacing their native engine outputs.

The contract exists because CardHawk already produces many useful signals across parser, identity, evidence, valuation, confidence, risk, quality, grading, ROI, Deal Gate, review, calibration, experiment, and governance systems. Those outputs should remain unchanged, but future Phase 13 tooling needs one durable way to describe:

- who produced a signal,
- what kind of signal it is,
- what evidence it is based on,
- what confidence and uncertainty mean,
- whether it has production authority,
- what warnings or blockers exist,
- how it fingerprints for audit.

## Wrapper-First Philosophy

The contract wraps supplied output. It does not recompute it.

Existing engine outputs remain native and backward compatible. A future adapter may take an existing output such as `marketData`, `compData`, `identityDiagnostics`, or `dealGate` and place it in `rawOutput` while adding normalized metadata around it.

This wrapper-first strategy allows CardHawk to align signal meaning without changing:

- scoring,
- valuation,
- parser behavior,
- identity behavior,
- Deal Gate,
- BUY_NOW,
- notifications,
- scanner behavior,
- persistence,
- marketplace behavior,
- production configuration.

## Schema

Each canonical signal includes:

- `schemaVersion`
- `source`
- `signalId`
- `signalName`
- `producer`
- `producerVersion`
- `producerCategory`
- `createdAt`
- `signalType`
- `decisionRole`
- `authorityLevel`
- `productionImpact`
- `decisionImpact`
- `executionAuthority`
- `confidence`
- `confidenceLevel`
- `uncertainty`
- `evidenceBasis`
- `evidenceQuality`
- `evidenceReferences`
- `supportingSignals`
- `conflictingSignals`
- `warnings`
- `blockers`
- `rawOutput`
- `normalizedOutput`
- `governanceFlags`
- `sourceFingerprint`
- `signalFingerprint`

Unknown or missing facts remain explicit as `unknown`. The contract must not invent evidence, certainty, authority, or normalized conclusions.

## Public API

`validation/canonicalIntelligenceSignalContract.js` exports:

- `createCanonicalSignal`
- `validateCanonicalSignal`
- `cloneCanonicalSignal`
- `attachEvidenceReference`
- `attachProducerMetadata`
- `determineSignalStatus`
- `determineSignalAuthority`
- `determineSignalConfidence`
- `buildCanonicalSignalFingerprint`
- `buildCanonicalSignalBatchFingerprint`

The module also exports stable constants for schema version, source, signal types, decision roles, authority levels, confidence kinds, confidence levels, evidence quality levels, uncertainty levels, and signal statuses.

## Authority Boundaries

Every canonical signal must preserve:

- `productionImpact: "none"`
- `decisionImpact: "none"`
- `executionAuthority: "none"`

A signal may describe a production decision output, such as a Deal Gate result, but the wrapper itself cannot authorize a production action. The production component remains the authority. The canonical signal is evidence, metadata, and audit context.

Governance flags must not grant write, ingestion, marketplace request, or production approval authority.

## Evidence Model

The contract separates evidence references from evidence interpretation.

`evidenceReferences` point to supplied artifacts or source outputs. `evidenceBasis` summarizes counts and context such as true sold count, active listing count, fallback use, stale count, rejected count, transaction-ineligible count, source concentration, and `asOf`.

Active listings and fallback values remain explicit context and must not be treated as true sold evidence by the contract.

## Compatibility Guarantees

The contract preserves native outputs in `rawOutput`. It may also carry a supplied `normalizedOutput`, but the module does not derive normalized output by itself.

Creation and attachment helpers return frozen immutable artifacts. Attachment helpers return new objects and never mutate the original signal.

Fingerprints are deterministic and exclude the fingerprint field itself.

## Migration Strategy

Recommended migration order:

1. Use this contract in offline tests and fixtures.
2. Build small wrapper adapters for existing outputs without changing engine return shapes.
3. Expand the signal registry to map native outputs to canonical signal IDs.
4. Allow Production Intelligence Trace and Real Listing Review packages to accept optional canonical signal envelopes.
5. Build the Phase 13 Signal Alignment Layer on top of supplied canonical signals.
6. Route any production behavior changes through the existing Phase 12 governance pipeline.

## Future Signal Alignment Layer

The future Signal Alignment Layer should consume canonical signals and report:

- agreement,
- conflicts,
- missing evidence,
- decisive blockers,
- confidence disagreement,
- valuation support disagreement,
- identity and evidence gaps,
- review priority.

It should remain offline or shadow-only until a future production proposal is explicitly approved.

## Non-Goals

- No production integration.
- No engine recomputation.
- No production scoring changes.
- No valuation changes.
- No Deal Gate changes.
- No BUY_NOW changes.
- No notification changes.
- No parser or identity changes.
- No persistence changes.
- No marketplace behavior changes.
- No production authority.
