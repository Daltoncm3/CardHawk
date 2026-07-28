# Signal Producer Adapter

## Purpose

The Signal Producer Adapter is the first Phase 13 migration step for aligning existing native diagnostic outputs with the Canonical Intelligence Signal Contract and Signal Alignment Contract.

This adapter is offline-only and observation-only. It does not execute diagnostics, engines, scans, parser logic, valuation logic, Deal Gate, BUY_NOW, notifications, persistence, or marketplace behavior. It accepts already-produced native outputs and wraps them.

## Supported Diagnostic Producers

Phase 13.1A supports:

- `identityParserDiagnostics`
- `evidenceReadinessDiagnostics`

These were selected because they are Phase 10 diagnostic outputs, already deterministic, shadow/offline, fingerprinted, and non-authoritative.

## Public API

`validation/signalProducerAdapter.js` exports:

- `adaptDiagnosticSignal`
- `adaptSignalBatch`
- `validateAdaptedSignal`
- `summarizeAdaptedSignals`
- `buildAdaptationFingerprint`

## Adaptation Flow

1. Accept supplied native diagnostic output.
2. Identify the supported diagnostic producer from explicit input or native `source`.
3. Preserve the native output unchanged.
4. Use native `stableFingerprint` when available, otherwise build a deterministic source-output fingerprint.
5. Resolve the signal definition from the Intelligence Signal Registry.
6. Wrap native output in a Canonical Intelligence Signal.
7. Create an immutable Signal Alignment artifact.
8. Return structured validation and deterministic fingerprints.

The adapter never infers missing evidence or recomputes diagnostic status.

## Registry Interaction

Registry lookup is exact by signal name and version:

- `identity.parser.diagnostics@1.0.0`
- `evidence.readiness.diagnostics@1.0.0`

Missing definitions remain explicit as `definition_missing`. Version mismatches remain explicit as `version_mismatch`. The adapter does not create registry definitions.

## Canonical Wrapping

Native output is preserved in `canonicalSignal.rawOutput`.

The adapter adds only wrapper metadata:

- signal name and version,
- producer identity,
- signal type,
- decision role,
- authority level,
- confidence and evidence semantics supplied by the adapter mapping,
- native warnings and blockers,
- source output fingerprint.

## Authority Boundaries

Every adapted signal, canonical signal, and alignment preserves:

- `productionImpact: "none"`
- `decisionImpact: "none"`
- `executionAuthority: "none"`

The adapter cannot grant authority even when native output contains unsafe authority-like fields. Unsafe native fields remain preserved inside `rawOutput` as evidence, not authority.

## Determinism

Batch adaptation sorts adapted signals by signal name, version, producer, and source-output fingerprint. Adaptation fingerprints exclude their own fingerprint fields.

## Migration Strategy

Additional signal families should be migrated only after they have:

- stable native outputs,
- clear producer ownership,
- registry definitions,
- deterministic tests,
- explicit authority boundaries.

The next safe expansion after Phase 10 diagnostics is more offline diagnostic output. Production-context signals such as valuation, confidence, Deal Gate, and BUY_NOW should wait until the adapter model is proven through review and governance evidence.
