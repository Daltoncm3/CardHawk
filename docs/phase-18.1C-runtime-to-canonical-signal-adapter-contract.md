# Phase 18.1C - Runtime-to-Canonical Signal Adapter Contract

## 1. Executive Summary

This document defines the contract that every future Runtime-to-Canonical Signal Compatibility Adapter must satisfy before implementation or approval.

The adapter described here is future work only. This phase does not implement the adapter, does not create runtime wiring, and does not alter existing production or offline behavior. The contract exists to remove ambiguity before implementation begins.

The adapter's sole allowed purpose is to consume already-produced runtime signal/display evidence and produce offline, immutable, non-authoritative compatibility artifacts that preserve native output, warnings, readiness, confidence semantics, provenance, fingerprints, and authority boundaries.

The adapter must never:

- Execute production engines.
- Modify runtime output.
- Modify canonical Signal output.
- Change Deal Gate.
- Change BUY_NOW.
- Change alerts or notifications.
- Grant production authority.
- Treat compatibility as migration completion.

## 2. Purpose

The purpose of the future adapter is to bridge vocabulary and schema differences between:

1. Runtime display signal contracts and annotations.
2. Offline Canonical Intelligence Signal artifacts and registry definitions.

The adapter must make that bridge explicit, deterministic, testable, and fail-closed. It must never hide semantic mismatch behind similar field names.

## 3. Scope

In scope:

- Offline-only compatibility artifact construction.
- Runtime source field preservation.
- Canonical candidate field representation.
- Mapping classification reporting.
- Warning preservation reporting.
- Readiness preservation reporting.
- Confidence preservation reporting.
- Authority boundary validation.
- Deterministic fingerprints.
- Fixture-driven conformance validation.

Out of scope:

- Production runtime integration.
- `server.js` imports or edits.
- Scanner flow changes.
- Runtime persistence changes.
- Deal Gate changes.
- BUY_NOW changes.
- Alert or notification changes.
- Canonical Signal schema changes.
- Runtime signal registry changes.
- Governance promotion.
- Shadow promotion.

## 4. Authoritative Sources

The adapter contract is governed by:

- Approved Project State v9.0, supplied in the CardHawk Codex conversation.
- `docs/phase-18.1A-runtime-signal-canonical-boundary-audit.md`
- `docs/phase-18.1B-runtime-to-canonical-signal-compatibility-specification.md`

Implementation source files that define current runtime and canonical behavior:

- `utils/signalContractRegistry.js`
- `utils/signalAnnotation.js`
- `utils/signalSemantics.js`
- `server.js`
- `validation/canonicalIntelligenceSignalContract.js`
- `validation/intelligenceSignalRegistry.js`
- `validation/signalAlignmentContract.js`
- `validation/signalAlignmentBatch.js`
- `validation/signalAlignmentEngine.js`
- `validation/signalMigrationCore.js`
- `validation/signalMigrationCoreContract.js`
- `validation/signalMigrationAdapterContract.js`
- `validation/signalShadowComparisonCore.js`
- `validation/signalShadowComparisonCoreContract.js`

## 5. Adapter Responsibilities

A future adapter must:

1. Accept already-produced runtime signal/display input.
2. Preserve every native runtime input field.
3. Preserve runtime signal identity and display contract metadata.
4. Preserve runtime warnings, caution signals, blockers, conflicts, failed reasons, and validation warnings.
5. Preserve runtime readiness values without upgrading them.
6. Preserve confidence values with their original meaning.
7. Preserve Deal Gate output as raw evidence only.
8. Preserve BUY_NOW as a Deal Gate runtime fact only.
9. Produce deterministic offline compatibility artifacts.
10. Produce structured validation results.
11. Produce deterministic fingerprints.
12. Classify every attempted mapping with the Phase 18.1B compatibility classifications.
13. Fail closed on missing, unknown, incompatible, or authority-risky data.
14. Return immutable results.

## 6. Adapter Non-Responsibilities

A future adapter must not:

1. Execute runtime engines.
2. Execute scanner flows.
3. Execute Deal Gate.
4. Recompute valuation.
5. Recompute confidence.
6. Recompute evidence sufficiency.
7. Recompute canonical Signals.
8. Repair invalid evidence.
9. Choose winning signals.
10. Resolve conflicts.
11. Create alerts.
12. Send notifications.
13. Persist production state.
14. Modify runtime display output.
15. Modify canonical artifacts supplied as input.
16. Approve production behavior.

## 7. Required Inputs

The future adapter input contract must support:

- `schemaVersion`: adapter input schema version.
- `adapterRunId`: deterministic or caller-supplied offline run identifier.
- `createdAt`: explicit caller-supplied timestamp.
- `runtimeSignalId`: runtime display signal ID.
- `runtimeSignalContract`: runtime signal contract snapshot.
- `runtimeAnnotation`: optional runtime signal annotation snapshot.
- `runtimeRawValue`: original runtime value.
- `runtimeDisplayFields`: optional runtime display fields.
- `runtimeSource`: source module/function/field metadata.
- `listingReference`: optional listing/item reference.
- `dealGateReference`: optional Deal Gate raw output reference.
- `canonicalRegistryReference`: optional offline canonical registry reference.
- `expectedMappingClassification`: expected Phase 18.1B mapping classification.
- `provenance`: source and capture metadata.

Required behavior:

- Missing optional inputs remain explicit.
- Missing required inputs produce validation errors.
- Unknown values remain `unknown`.
- Runtime raw values are preserved before any normalization.

## 8. Required Outputs

The future adapter output contract must produce an immutable artifact containing:

- `schemaVersion`
- `adapterRunId`
- `createdAt`
- `runtimeSignalId`
- `mappingClassification`
- `sourceFingerprint`
- `runtimeInputFingerprint`
- `canonicalCandidateFingerprint`
- `compatibilityFingerprint`
- `runtimeInputPreserved`
- `nativeOutputPreserved`
- `warningPreservation`
- `readinessPreservation`
- `confidencePreservation`
- `authorityPreservation`
- `schemaVersionHandling`
- `unknownFieldHandling`
- `nullHandling`
- `fallbackHandling`
- `mappingResult`
- `validation`
- `warnings`
- `errors`
- `provenance`
- `productionImpact: none`
- `decisionImpact: none`
- `executionAuthority: none`

The adapter may produce canonical Signal candidates only in a future implementation phase and only as offline, non-authoritative artifacts.

## 9. Deterministic Behavior

For identical inputs, the adapter must produce identical:

- Output field ordering where ordering is controlled.
- Mapping classifications.
- Warning ordering.
- Error ordering.
- Reason code ordering.
- Summaries.
- Fingerprints.
- Validation results.

The adapter must sort collections deterministically unless source order is semantically required. If source order is preserved, that requirement must be recorded in provenance.

## 10. Idempotence

Running the adapter repeatedly over the same immutable input must:

- Preserve the same raw output.
- Preserve the same warnings.
- Preserve the same readiness.
- Preserve the same confidence.
- Preserve the same mapping result.
- Produce the same fingerprints.
- Avoid duplicate warnings or duplicated provenance entries.

Adapter output must not become a new source of runtime truth.

## 11. Provenance Preservation

The adapter must preserve:

- Runtime signal ID.
- Runtime owner.
- Runtime schema version.
- Runtime source module/function/field when known.
- Capture timestamp.
- Listing reference when supplied.
- Deal Gate reference when supplied.
- Original raw value.
- Transformation category.
- Transformation reason code.
- Canonical registry reference when supplied.

The adapter may not invent provenance. Missing provenance must be represented as `unknown` and reported as a warning or error depending on requiredness.

## 12. Warning Preservation

The adapter must preserve every warning-like value from runtime and offline source material, including:

- `qualityWarnings`
- `confidenceReasons`
- `qualityReasons`
- `failedReasons`
- `rejectionReasons`
- `reasons`
- `blockers`
- `cautionSignals`
- `conflicts`
- Rule-level reasons.
- Validation warning codes, messages, and fields.

The adapter must distinguish:

- Warnings.
- Cautions.
- Blockers.
- Conflicts.
- Failed reasons.
- Unknown warning codes.

Unknown warning codes may be wrapped but not discarded.

## 13. Readiness Preservation

The adapter must preserve runtime readiness values as contextual readiness only.

Runtime readiness values such as `supported_context`, `limited_context`, `cautious_context`, `not_ready`, and `unknown` may be represented in normalized output or metadata. They must not become:

- Deal Gate approval.
- BUY_NOW.
- Canonical production authority.
- Evidence sufficiency without supporting evidence.
- Certification readiness without governance validation.

Missing readiness must remain explicit.

## 14. Confidence Preservation

The adapter must preserve the source-specific meaning of confidence.

Runtime confidence may represent market context, sold evidence support, Market Intelligence confidence, valuation confidence, or explanation confidence. The adapter must not collapse those into a universal confidence meaning.

Rules:

- Numeric confidence may be copied only with source and scale metadata.
- Confidence level may be derived only with explicit approved thresholds.
- Missing confidence remains `unknown`.
- Confidence may not become valuation confidence unless the source is valuation-specific.
- Confidence may not become Deal Gate authority.
- High confidence may not create BUY_NOW.

## 15. Native Output Preservation

The adapter must preserve runtime/native output exactly.

Required guarantees:

- The original runtime input is deep-cloned or otherwise immutably preserved.
- The original raw value is available in the output.
- Normalized values never replace raw values.
- Source fingerprints are calculated from preserved source material.
- Parity checks compare source material to preserved raw output.
- Any mismatch is a validation error.

## 16. Schema Version Handling

Runtime schema version, canonical schema version, adapter schema version, registry schema version, and artifact schema version are distinct.

The adapter must:

- Preserve runtime schema version as runtime metadata.
- Preserve canonical schema version as canonical metadata when canonical candidates exist.
- Use its own adapter schema version.
- Report unknown source versions.
- Report version mismatches.
- Never treat matching version strings as schema equivalence unless source systems are identical.

## 17. Unknown-Field Handling

Unknown fields must be preserved unless explicitly prohibited by the future adapter contract.

Rules:

- Unknown runtime fields remain in raw input.
- Unknown canonical-required fields become explicit `unknown`.
- Unknown values must not become zero, false, available, sufficient, approved, passed, or BUY_NOW.
- Unknown warning codes remain visible.
- Unknown source versions remain visible.

## 18. Null Handling

Null handling must distinguish between:

- Explicit source `null`.
- Missing field.
- Empty string.
- Numeric zero.
- Boolean false.

Rules:

- Explicit `null` must remain visible in raw output.
- Missing required target fields may become `unknown`.
- Numeric zero and boolean false must be preserved as meaningful values when source semantics allow them.
- Null must not become positive evidence.
- Null must not become low confidence unless the source says low confidence.

## 19. Fallback Handling

Fallbacks must be guarded.

Allowed fallbacks:

- `unknown` for missing unknown values.
- Empty array only when the source explicitly provides an empty array.
- `none` for authority boundary fields.
- Metadata omission for intentionally unmapped optional fields.

Prohibited fallbacks:

- Missing evidence to zero sold comps unless zero is verified.
- Missing confidence to zero.
- Missing status to available.
- Missing readiness to supported.
- Missing authority to production.
- Missing Deal Gate output to pass.

## 20. Failure Behavior

The adapter must fail closed.

Failure output must:

- Preserve source input when possible.
- Return structured errors.
- Return reason codes.
- Return authority violations when present.
- Return warning preservation state.
- Return readiness preservation state.
- Return `productionImpact: none`.
- Return `decisionImpact: none`.
- Return `executionAuthority: none`.

The adapter must not repair failures.

## 21. Backward Compatibility

The adapter must not change:

- Runtime display output.
- Runtime signal contract output.
- Existing annotations.
- Existing labels.
- Existing `server.js` output.
- Existing persistence shape.
- Existing alert behavior.
- Existing notification behavior.
- Existing canonical Signal framework behavior.
- Existing Governance or Decision Intelligence behavior.

Compatibility output must be additive, offline, and isolated.

## 22. Prohibited Transformations

The adapter must reject transformations that:

- Map `BUY_NOW` to canonical `productionImpact`.
- Map `BUY_NOW` to canonical `decisionImpact`.
- Map `BUY_NOW` to canonical `executionAuthority`.
- Map runtime `recommendationImpact` to canonical `decisionImpact`.
- Map runtime display language to canonical execution authority.
- Map runtime readiness to Deal Gate approval.
- Map canonical signal status to Deal Gate pass.
- Map canonical alignment status to production readiness.
- Map active or aggregate comps to true sold evidence without source proof.
- Map fallback permission to fallback use.
- Convert unknown values into positive evidence.
- Suppress warnings.
- Upgrade readiness.
- Treat high confidence as approval.

## 23. Prohibited Authority Changes

The adapter must preserve:

- `productionImpact: none`
- `decisionImpact: none`
- `executionAuthority: none`

Any other value is invalid.

The adapter must not:

- Grant production authority.
- Grant execution authority.
- Grant notification authority.
- Grant BUY_NOW authority.
- Grant Deal Gate authority.
- Convert advisory evidence into runtime decisions.

## 24. Deal Gate Preservation

Deal Gate output may be consumed by the future adapter only as preserved raw evidence.

Rules:

- Deal Gate pass/fail remains runtime authoritative only inside the existing production runtime.
- Adapter output may record that Deal Gate passed or rejected.
- Adapter output may not create a new pass/fail result.
- Adapter output may not override Deal Gate.
- Adapter output may not suppress Deal Gate failed reasons.
- Adapter output may not reinterpret non-Deal Gate signals as Deal Gate.

## 25. BUY_NOW Preservation

BUY_NOW is preserved only as a runtime Deal Gate fact when present in source output.

Rules:

- BUY_NOW may be stored in raw output.
- BUY_NOW may appear in provenance if sourced from Deal Gate.
- BUY_NOW may not appear as adapter authority.
- BUY_NOW may not be derived from confidence, readiness, status, score, or evidence quality.
- BUY_NOW may not be produced when source Deal Gate is absent.

## 26. Migration Constraints

Before implementation, a future adapter phase must:

- Use this contract.
- Use the Phase 18.1B mapping specification.
- Use the fixture suite created in Phase 18.1C.
- Add conformance tests.
- Add unknown-value tests.
- Add warning-preservation tests.
- Add readiness-preservation tests.
- Add authority-preservation tests.
- Add deterministic fingerprint tests.
- Prove no production imports.

## 27. Promotion Gates

Offline adapter implementation may begin only after this contract is approved.

Shadow integration may begin only after:

- Offline adapter tests pass.
- Conformance fixtures pass.
- Native output preservation is proven.
- Authority preservation is proven.
- A separate shadow architecture phase is approved.

Production integration may begin only after:

- Shadow validation succeeds.
- Governance review succeeds.
- Production Proposal exists.
- Explicit Dalton approval exists.
- Full validation succeeds.
- Deployment validation exists.
- Rollback and monitoring plans exist.

No promotion is automatic.

## 28. Final Contract Determination

The Runtime-to-Canonical Signal Compatibility Adapter Contract is sufficiently defined for a future offline adapter implementation and conformance phase.

This document does not authorize implementation, runtime integration, shadow integration, or production promotion. It authorizes only future work that remains offline, deterministic, fixture-tested, warning-preserving, readiness-preserving, native-output-preserving, and non-authoritative.
