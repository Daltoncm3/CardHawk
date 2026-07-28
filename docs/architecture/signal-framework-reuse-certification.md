# Signal Framework Reuse Certification

## Executive Summary

Phase 13.7B certifies the shared Signal Migration and Signal Shadow Comparison framework after the Range-First Valuation Diagnostics onboarding.

The shared framework is reusable in practice. Range-First Valuation onboarding uses `signalMigrationCore.js` for migration lifecycle orchestration, `signalMigrationAdapterContract.js` for declarative engine mapping metadata, `signalMigrationCoreContract.js` for lifecycle artifact projection, and `signalShadowComparisonCore.js` for shadow-comparison orchestration. It does not copy the earlier Grade Premium, Population, or Listing Quality orchestration pattern.

The architecture goal has been achieved: future signal migrations can now be built by supplying native-output mappings, canonical signal projection rules, semantic comparison rules, summaries, and reason codes while reusing the shared lifecycle scaffolding.

Certification status: **Reuse Certified with Follow-Up Actions**.

## Certification Status

**Reuse Certified with Follow-Up Actions**

The framework is certified for continued offline engine onboarding. Follow-up actions are recommended before any runtime or shadow-production integration is considered.

The certification is not production authority. All migrated signals remain offline-only, shadow-only, advisory, and evidence-preserving.

## Files Reviewed

Shared migration framework:

- `validation/signalMigrationCore.js`
- `validation/signalMigrationCoreContract.js`
- `validation/signalMigrationAdapterContract.js`

Shared shadow comparison framework:

- `validation/signalShadowComparisonCore.js`
- `validation/signalShadowComparisonCoreContract.js`

Existing migration modules:

- `validation/gradePremiumSignalMigration.js`
- `validation/populationSignalMigration.js`
- `validation/listingQualitySignalMigration.js`
- `validation/rangeFirstValuationSignalMigration.js`

Existing shadow comparison modules:

- `validation/gradePremiumShadowComparison.js`
- `validation/populationShadowComparison.js`
- `validation/rangeFirstValuationShadowComparison.js`

Related tests:

- `tests/grade-premium-signal-migration.test.js`
- `tests/population-signal-migration.test.js`
- `tests/listing-quality-signal-migration.test.js`
- `tests/range-first-valuation-signal-onboarding.test.js`
- `tests/grade-premium-shadow-comparison.test.js`
- `tests/population-shadow-comparison.test.js`
- `tests/signal-migration-core.test.js`
- `tests/signal-migration-core-contract.test.js`
- `tests/signal-migration-adapter-contract.test.js`
- `tests/signal-shadow-comparison-core.test.js`
- `tests/signal-shadow-comparison-core-contract.test.js`
- Phase 13 signal alignment, registry, conflict, report, and validation-suite tests

Related architecture documents:

- `docs/architecture/signal-migration-conformance-audit.md`
- `docs/architecture/signal-migration-core-architecture.md`
- `docs/architecture/signal-migration-core-contract.md`
- `docs/architecture/signal-migration-adapter-contract.md`
- `docs/architecture/signal-migration-core.md`
- `docs/architecture/signal-shadow-comparison-core-contract.md`
- `docs/architecture/signal-shadow-comparison-core.md`
- `docs/architecture/range-first-valuation-signal-onboarding.md`
- Grade Premium, Population, and Listing Quality migration and comparison architecture notes

## Framework Lifecycle Assessment

The shared migration lifecycle is centralized.

`signalMigrationCore.js` owns the reusable sequence:

1. extract supplied native output
2. resolve registry definition
3. build canonical signal
4. build signal alignment
5. build adapted signal
6. assemble alignment batch
7. assemble alignment run
8. create conflict analysis
9. create alignment report
10. verify native-output parity
11. summarize, validate, fingerprint, and freeze the migration artifact

The core still delegates engine semantics to module-supplied callbacks. That boundary is correct. The core should not know whether a native signal represents grade-premium support, population context, listing quality, or valuation uncertainty.

The shared comparison lifecycle is also centralized.

`signalShadowComparisonCore.js` owns:

1. migration artifact resolution
2. native-output cloning
3. comparison hook orchestration
4. mismatch collection
5. deterministic mismatch ordering
6. nested artifact validation
7. warning and error aggregation
8. parity-status delegation
9. artifact assembly
10. summary, validation, fingerprint, and freeze flow

The comparison core correctly fails closed when required hooks are missing.

## Range-First Onboarding Assessment

Range-First Valuation Diagnostics validates the shared architecture because it differs meaningfully from the earlier migrated families:

- it is an offline diagnostic, not a production engine output
- it represents valuation support and uncertainty rather than grading, population, or listing-quality context
- it carries a confidence-cap recommendation instead of a production confidence score
- it preserves active listings and fallback values as excluded context, not as true sold evidence
- it needs semantic parity for status-to-evidence-quality and confidence-cap mapping

The onboarding reused the shared lifecycle rather than copying it:

- `migrateRangeFirstValuationSignal()` calls `executeSignalMigrationLifecycle()`
- `compareRangeFirstValuationNativeToShadow()` calls `executeSignalShadowComparisonLifecycle()`
- the migration creates a `SignalMigrationAdapter` through `createSignalMigrationAdapter()`
- the migration creates a lifecycle projection through `createSignalMigrationArtifact()`
- tests assert that the native diagnostic engine and production runtime are not imported

This is the first new onboarding built after both shared cores existed, and it confirms that additional migrations can be added with less engine-specific scaffolding.

## Duplication Assessment

Meaningful lifecycle duplication is now reduced.

The following behavior is no longer duplicated in Range-First:

- alignment batch construction
- conflict analysis construction
- alignment report construction
- migration lifecycle orchestration
- comparison lifecycle orchestration
- mismatch sorting
- fail-closed comparison behavior
- shared authority aggregation
- shared lifecycle validation aggregation

Some duplication remains intentionally:

- native field comparison helpers remain local to each comparison module
- engine-specific evidence, confidence, status, metadata, and unknown-value comparison functions remain local
- engine-specific required-field lists remain local
- engine-specific summary and reason-code wording remain local
- fingerprint helper names remain engine-specific for public API stability

This remaining duplication is acceptable. It is semantic, not lifecycle duplication.

No additional consolidation is required before the next offline engine migration.

## Contract Conformance Assessment

The contracts match actual implementation.

Migration contract conformance:

- migrations produce immutable artifacts
- migrated artifacts preserve `productionImpact: "none"`
- migrated artifacts preserve `decisionImpact: "none"`
- migrated artifacts preserve `executionAuthority: "none"`
- registry statuses remain explicit
- missing definitions remain `definition_missing`, `version_mismatch`, or `registry_missing`
- lifecycle artifacts are projected through the core contract where the new Range-First path demonstrates the intended model

Adapter contract conformance:

- Range-First uses declarative mapping objects for evidence, confidence, uncertainty, status, and metadata
- approved local-handler references are used only as references, not executed from serialized input
- required and optional native fields are explicit
- compatibility remains validation-only

Comparison contract conformance:

- comparison artifacts preserve parity statuses
- mismatches remain structured and ordered
- semantic parity is not inferred by the core
- invalid nested artifacts produce invalid comparison outcomes
- blocked lifecycle failures remain explicit and authority-free

The main conformance gap is historical: Grade Premium, Population, and Listing Quality predate the adapter/core-artifact pattern now demonstrated by Range-First. They already use shared migration lifecycle orchestration, and Grade Premium and Population use the shared comparison core, but they do not yet expose adapter/core-artifact fields like Range-First. This is not a blocker because their public shapes were intentionally preserved during behavior-preserving consolidation.

## Authority-Boundary Assessment

Authority boundaries remain fail-closed.

Every reviewed migration and comparison preserves:

- `productionImpact: "none"`
- `decisionImpact: "none"`
- `executionAuthority: "none"`

The shared contracts and validation helpers detect authority drift. Shadow comparisons do not repair mismatches, select winners, recompute engine results, change confidence, or create recommendations.

Runtime integration should remain prohibited. The signal framework is now suitable for offline onboarding and validation, not for production decision authority.

## Fingerprint and Parity Assessment

Fingerprint behavior remains deterministic.

The reviewed modules use the established projection pattern:

- clone artifact
- remove the artifact's own fingerprint field
- build a stable fingerprint from the remaining projection

Range-First tests prove deterministic migration fingerprints, deterministic comparison fingerprints, and stable behavior for identical inputs.

Native-output parity remains exact:

- native output is preserved in the migration
- native output is preserved in `canonicalSignal.rawOutput`
- native output is preserved in `adaptedSignal.nativeOutput`
- shadow comparisons detect changed wrapper data without repairing source artifacts

Semantic parity remains engine-specific. This is correct because each engine family maps evidence, status, confidence, and metadata differently.

## Unknown-Value Assessment

Explicit unknown values remain preserved.

Range-First tests cover unknown point-estimate support and unknown point-inside-range values. The migration keeps unknowns explicit in raw output and normalized output, and the comparison validates unknown-value parity without inventing missing evidence.

The shared framework should continue treating unknown values as data, not as defaults to be filled.

## Reason-Code Ownership

Reason-code ownership is clear enough for continued onboarding.

Shared cores own generic lifecycle failures, missing-hook failures, authority violations, and validation aggregation.

Engine-specific modules own domain mismatch codes and messages, including:

- changed native field
- changed evidence value
- changed confidence value
- changed status value
- changed metadata value
- missing wrapper field
- unexpected wrapper field
- domain-specific semantic mismatch wording

This split should remain. Moving domain reason codes into the core would blur semantic ownership and make future migrations harder to audit.

## Remaining Risks

1. Historical migration modules are not fully adapter-declarative.

   Grade Premium, Population, and Listing Quality use the shared migration lifecycle, but Range-First is the first onboarding that also exposes an explicit adapter and core artifact. Retrofitting old modules is optional and should only happen in a behavior-preserving phase with golden artifact parity tests.

2. Shadow comparison modules still contain similar native-field comparison helpers.

   This is acceptable for now because field-level parity is simple and engine-local. A future shared parity helper could reduce this duplication, but it should not be introduced until another one or two comparison modules confirm the need.

3. Semantic parity remains callback discipline.

   The shared comparison core deliberately does not infer semantic equivalence. This is safe, but future migrations must include strong tests for every semantic projection.

4. Registry definitions are still test-local for many migrations.

   This is fine for offline validation, but future registry packaging may need a canonical default registry artifact.

5. No runtime integration should be attempted yet.

   The framework is certified for offline reuse, not for production authority, shadow runtime execution, or scanner integration.

## Required Follow-Up Actions

Required before runtime consideration:

- complete more offline migrations using the shared framework
- keep no-runtime-import tests for every new migration and comparison
- preserve exact native-output parity tests for every migration
- preserve mismatch-detection tests for every comparison
- add golden fixture parity only if existing historical modules are refactored

Not required before the next offline migration:

- no further shared-core consolidation
- no production integration
- no server changes
- no registry packaging change
- no public API changes to existing migration modules

## Safest Next Engine Target

The safest next engine target is `validation/confidenceCalibrationDiagnostics.js`.

Reasons:

- it is offline diagnostic-only
- it is already part of the Phase 10 diagnostic family
- it has high value for confidence calibration and decision explainability
- it should consume supplied diagnostic output only
- it can reuse the Range-First pattern for confidence semantics
- it does not require marketplace requests, production scanner integration, or production confidence threshold changes

Alternate acceptable target: `validation/opportunityFalsePositiveDiagnostics.js`. It is valuable, but it combines several diagnostic inputs and is better migrated after Confidence Calibration so its confidence-risk signal can reference an aligned upstream family.

## Exact Recommended Next Phase

Recommended next phase:

**Phase 13.7C - Confidence Calibration Diagnostics Signal Migration (Offline Shadow)**

Objective:

Onboard `validation/confidenceCalibrationDiagnostics.js` using `signalMigrationCore.js`, `signalMigrationAdapterContract.js`, and `signalShadowComparisonCore.js`, preserving native diagnostic output exactly and keeping the module offline-only and shadow-only.

## Explicit Non-Goals

This certification does not:

- implement code
- modify existing migration or comparison modules
- execute intelligence engines
- integrate with production runtime
- change scanner behavior
- change parser behavior
- change identity behavior
- change valuation
- change Deal Gate
- change BUY_NOW
- change notifications
- change persistence
- change marketplace behavior
- change configuration
- grant production authority
- approve runtime migration of the signal framework
- recommend UI work
- recommend marketplace expansion
