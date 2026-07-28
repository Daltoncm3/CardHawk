# Signal Alignment Batch Engine

## Purpose

The Signal Alignment Batch Engine groups already-created Signal Alignment artifacts into immutable, deterministic batches. It is offline-only and observation-only.

The batch engine does not execute producers, execute diagnostics, wrap native outputs, change alignments, infer missing metadata, alter production behavior, or grant authority.

## Public API

`validation/signalAlignmentBatch.js` exports:

- `createAlignmentBatch`
- `validateAlignmentBatch`
- `addAlignmentToBatch`
- `removeAlignmentFromBatch`
- `summarizeAlignmentBatch`
- `filterAlignmentBatch`
- `sortAlignmentBatch`
- `buildAlignmentBatchFingerprint`

## Batch Lifecycle

1. Receive Signal Alignment artifacts directly or adapted signal objects containing an `alignment`.
2. Clone the supplied alignment artifacts.
3. Sort alignments deterministically by canonical signal name and alignment identity.
4. Build summary counts.
5. Preserve evidence-only authority boundaries.
6. Produce an immutable batch with a deterministic fingerprint.

Add and remove helpers return new immutable batch objects and never mutate the original batch.

## Validation Model

Validation checks:

- required batch fields,
- schema and source,
- alignment count consistency,
- duplicate alignment fingerprints,
- individual alignment validity through `validateSignalAlignment`,
- authority boundaries,
- batch fingerprint integrity.

Validation returns structured output with:

- `valid`
- `errors`
- `warnings`
- `reasonCodes`
- `duplicateAlignments`
- `authorityViolations`
- `fingerprintViolations`

## Fingerprint Model

Batch fingerprints use existing deterministic fingerprint helpers and exclude batch fingerprint fields. Individual alignment fingerprints are preserved as supplied; the batch engine does not rebuild or mutate individual alignment artifacts.

## Authority Boundaries

Every batch preserves:

- `productionImpact: "none"`
- `decisionImpact: "none"`
- `executionAuthority: "none"`

The batch engine may contain alignments derived from production-context outputs, but the batch itself is offline evidence only. It cannot affect scanner behavior, parser behavior, identity behavior, valuation, Deal Gate, BUY_NOW, notifications, persistence, configuration, marketplace behavior, or production authority.

## Future Integration

The full Signal Alignment Engine can use this batch layer after producer adapters create individual alignment artifacts. Future reports, review packages, and governance artifacts can consume these batches as deterministic evidence, but no production use is authorized without the existing governance pipeline.
