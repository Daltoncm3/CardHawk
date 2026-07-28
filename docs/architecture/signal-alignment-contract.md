# Signal Alignment Contract

## Purpose

The Signal Alignment Contract is the immutable offline artifact for Phase 13 signal alignment. It records the result of aligning a supplied native output with a canonical signal definition and canonical signal envelope.

The contract does not execute intelligence engines and does not perform production alignment. It stores evidence about an alignment result so later offline tools can validate, batch, report, and review aligned signals.

## Public API

`validation/signalAlignmentContract.js` exports:

- `createSignalAlignment`
- `validateSignalAlignment`
- `cloneSignalAlignment`
- `attachRegistryReference`
- `attachCanonicalSignal`
- `determineAlignmentStatus`
- `determineAuthorityAlignment`
- `buildSignalAlignmentFingerprint`
- `buildSignalAlignmentBatchFingerprint`

Attachment helpers always return new immutable objects.

## Schema

Each alignment artifact contains:

- `schemaVersion`
- `source`
- `alignmentId`
- `createdAt`
- `producer`
- `producerVersion`
- `sourceOutputFingerprint`
- `registryId`
- `registryFingerprint`
- `signalDefinition`
- `canonicalSignal`
- `alignmentStatus`
- `authorityAlignment`
- `confidenceAlignment`
- `evidenceAlignment`
- `relationshipSummary`
- `warnings`
- `errors`
- `missingMetadata`
- `productionImpact: "none"`
- `decisionImpact: "none"`
- `executionAuthority: "none"`
- `alignmentFingerprint`

Unknown values remain `unknown`. The contract never infers missing metadata or recomputes native intelligence.

## Status Model

Supported statuses:

- `aligned`
- `aligned_with_warnings`
- `incomplete`
- `definition_missing`
- `version_mismatch`
- `invalid`
- `blocked`

Status precedence is conservative. Authority violations resolve to `blocked`; invalid contracts resolve to `invalid`; missing definitions and metadata remain explicit.

## Authority Boundaries

Every alignment must preserve:

- `productionImpact: "none"`
- `decisionImpact: "none"`
- `executionAuthority: "none"`

The alignment artifact may describe a signal that originally came from production, but the artifact itself has no authority. It cannot change scoring, valuation, Deal Gate, BUY_NOW, notifications, persistence, scanner behavior, configuration, or marketplace behavior.

## Wrapper-First Philosophy

The alignment contract sits above:

- native engine output,
- Canonical Intelligence Signal Contract,
- Intelligence Signal Registry.

Native output remains preserved in the canonical signal's `rawOutput`. Registry definitions remain metadata. Alignment records the relationship between those artifacts without modifying either one.

## Compatibility Guarantees

- No production imports.
- No native engine execution.
- No mutation of canonical signals or registry definitions.
- Deterministic fingerprints exclude their own fingerprint fields.
- JSON export/import preserves validation compatibility.
- Attachment helpers preserve evidence-only boundaries.

## Future Signal Alignment Engine Integration

Future modules can use this contract as their durable artifact shape:

- `signalAlignmentEngine` can build alignment results.
- `signalProducerAdapter` can map native output families into canonical signal inputs.
- `signalAlignmentBatch` can group multiple results.
- `signalConflictAnalyzer` can analyze relationships across results.
- `signalAlignmentReport` can produce human-readable review reports.

Those future modules must remain offline or shadow-only until a separately approved governance path authorizes any production use.
