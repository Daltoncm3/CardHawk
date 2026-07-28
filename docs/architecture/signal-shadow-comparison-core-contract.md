# Signal Shadow Comparison Core Contract

Phase 13.6E adds the immutable offline-only contract for a future shared Signal Shadow Comparison Core.

The contract captures common comparison artifact fields and validation rules established by the Grade Premium and Population shadow-comparison modules. It does not execute comparisons, invoke migrations, repair mismatches, infer semantic equivalence, or modify existing comparison behavior.

## Purpose

The Signal Shadow Comparison Core Contract defines the shared record shape for comparing a preserved native output with its Phase 13 canonical and aligned shadow artifacts.

It records:

- source and migration fingerprints
- exact and semantic parity statuses
- evidence, confidence, status, and metadata parity
- authority status
- fingerprint status
- mismatch evidence
- warnings and errors
- deterministic comparison fingerprint

## Public API

- `createSignalShadowComparisonArtifact(input, options)`
- `validateSignalShadowComparisonArtifact(artifact)`
- `cloneSignalShadowComparisonArtifact(artifact)`
- `buildSignalShadowComparisonFingerprint(artifact)`
- `determineShadowComparisonStatus(artifact)`

All APIs are offline-only and deterministic.

## Comparison Lifecycle

Existing shadow-comparison modules perform engine-specific comparison work. A future shared core may use this contract after that work has already produced comparison facts:

1. Native output is preserved by a migration artifact.
2. Canonical signal, alignment, run, and report fingerprints are captured.
3. Engine-specific comparison code determines exact and semantic parity.
4. Mismatch evidence is recorded without repair.
5. Authority and fingerprint status are preserved.
6. The comparison artifact receives a deterministic fingerprint.
7. Validation reports structured violations.

The contract does not perform steps 1 through 4. It only records and validates their result.

## Contract Schema

Each artifact includes:

- `schemaVersion`
- `source`
- `comparisonId`
- `createdAt`
- `engineName`
- `engineVersion`
- `signalName`
- `signalVersion`
- `nativeOutputFingerprint`
- `migrationFingerprint`
- `canonicalSignalFingerprint`
- `alignmentFingerprint`
- `runFingerprint`
- `reportFingerprint`
- `exactParityStatus`
- `semanticParityStatus`
- `evidenceParityStatus`
- `confidenceParityStatus`
- `statusParityStatus`
- `metadataParityStatus`
- `authorityStatus`
- `fingerprintStatus`
- `comparisonStatus`
- `mismatchCount`
- `mismatchReasonCodes`
- `mismatches`
- `warnings`
- `errors`
- `productionImpact: "none"`
- `decisionImpact: "none"`
- `executionAuthority: "none"`
- `comparisonFingerprint`

Unknown facts remain `unknown`.

## Exact Versus Semantic Parity

Exact parity means the represented value is byte-stable or structurally equal according to the producing comparison module.

Semantic parity means the shadow representation is intentionally different in shape but equivalent in meaning according to explicit engine-specific comparison logic.

The contract never infers semantic parity. It only preserves the status supplied by the comparison module.

## Mismatch Representation

Mismatch evidence is structured and immutable:

- reason code
- affected field
- message
- native value
- shadow value

Reason codes are sorted deterministically. Mismatches are not repaired or normalized by the contract.

## Authority Boundaries

Every artifact must preserve:

- `productionImpact: "none"`
- `decisionImpact: "none"`
- `executionAuthority: "none"`

The contract cannot authorize production decisions, scoring, valuation, Deal Gate, BUY_NOW, notifications, persistence changes, marketplace behavior, or deployment.

## Relationship To Signal Migration Core

The Signal Migration Core produces immutable migration artifacts and wrapper outputs. Shadow comparison consumes those artifacts and checks whether the wrapper preserved native semantics.

This contract is the comparison-side companion to:

- `signalMigrationCoreContract`
- `signalMigrationAdapterContract`
- `signalMigrationCore`

It prepares future consolidation without changing the existing Grade Premium or Population comparison modules.

## Future Consolidation

A future behavior-preserving comparison core may extract shared comparison lifecycle behavior while leaving these engine-specific responsibilities in dedicated modules:

- native field comparison semantics
- evidence interpretation
- confidence interpretation
- status projection comparison
- metadata comparison
- unknown-value comparison
- engine-specific mismatch wording

The safe next step is to implement a shared comparison core only after at least one additional shadow comparison proves the common lifecycle remains stable.
