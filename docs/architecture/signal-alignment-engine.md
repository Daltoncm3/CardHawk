# Signal Alignment Engine

## Purpose

The Signal Alignment Engine is the offline orchestration layer for Phase 13 signal alignment. It consumes already-generated native diagnostic outputs, sends them through the Signal Producer Adapter, groups the resulting Signal Alignment artifacts with the Signal Alignment Batch Engine, and emits an immutable run artifact.

The engine is observation-only. It does not execute diagnostics, execute scans, recompute engine outputs, change parser behavior, influence valuation, change Deal Gate, change BUY_NOW, send notifications, modify persistence, or grant production authority.

## Public API

`validation/signalAlignmentEngine.js` exports:

- `runSignalAlignment`
- `runSignalAlignmentBatch`
- `validateSignalAlignmentRun`
- `summarizeSignalAlignmentRun`
- `buildSignalAlignmentRunFingerprint`

## Orchestration Flow

1. Receive one or more native diagnostic outputs that were produced elsewhere.
2. Invoke `adaptDiagnosticSignal` or `adaptSignalBatch`.
3. Preserve adapted canonical signals and their native raw outputs.
4. Extract Signal Alignment artifacts without modifying them.
5. Assemble a deterministic Signal Alignment Batch.
6. Build a deterministic run summary and validation report.
7. Freeze the run artifact and compute a stable fingerprint.

## Adapter Interaction

The engine delegates diagnostic wrapping to `signalProducerAdapter`. The adapter remains responsible for producer recognition, canonical signal wrapping, registry lookup, individual alignment creation, and adapted signal validation.

The engine does not duplicate those contracts.

## Batch Interaction

The engine delegates batch construction and batch validation to `signalAlignmentBatch`. The batch remains responsible for preserving immutable alignment artifacts, deterministic ordering, duplicate detection, and batch fingerprinting.

## Alignment Lifecycle

Native diagnostic output becomes:

1. adapted signal,
2. canonical signal,
3. signal alignment artifact,
4. alignment batch,
5. alignment run report.

Each stage is immutable and evidence-only.

## Validation Model

Run validation reports:

- `valid`
- `errors`
- `warnings`
- `reasonCodes`
- `adaptedSignalCount`
- `alignedSignalCount`
- `blockedSignalCount`
- `authorityViolations`
- `registryLookupFailures`

Registry lookup failures remain explicit. Missing definitions do not become inferred definitions.

## Fingerprint Model

Run fingerprints use the existing deterministic fingerprint projection helper and exclude only the run fingerprint field. Adapted signal fingerprints, alignment fingerprints, and batch fingerprints are preserved as source evidence.

## Authority Boundaries

Every run preserves:

- `productionImpact: "none"`
- `decisionImpact: "none"`
- `executionAuthority: "none"`

The engine cannot alter production scoring, valuation, Deal Gate, BUY_NOW, notifications, scanner behavior, persistence, or configuration.

## Migration Strategy

The first supported signal family remains the Phase 10 diagnostic family:

- `identityParserDiagnostics`
- `evidenceReadinessDiagnostics`

Future migrations should add producer adapter support one signal family at a time, then route the new adapted outputs through this orchestration layer without changing existing production consumers.
