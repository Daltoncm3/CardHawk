# Signal Migration Duplication and Conformance Audit

## Executive Summary

Phase 13.5A reviewed the completed Grade Premium and Population Intelligence migrations and shadow comparisons.

The two migrations have established a clean, repeatable lifecycle:

1. accept already-produced native engine output
2. preserve native output as immutable evidence
3. build a deterministic source-output fingerprint
4. resolve a signal definition through the Intelligence Signal Registry
5. wrap the native output in a Canonical Intelligence Signal
6. create a Signal Alignment artifact
7. assemble Alignment Batch, Alignment Run, Conflict Analysis, and Report artifacts
8. validate parity, fingerprints, source references, and authority boundaries
9. expose only offline, shadow-only public helpers

Meaningful duplication is present. The duplication is concentrated in generic orchestration, validation plumbing, source-reference checks, fingerprint checks, parity status handling, immutable artifact construction, and documentation/test patterns. The duplicated engine-specific mapping is appropriate and should remain engine-specific.

Consolidation is valuable before many more engine migrations are added, but it is not required before one additional migration. The safest next step is a small shared migration/comparison core that extracts only lifecycle primitives after a third migration confirms the pattern across a different engine family.

## Files Reviewed

Migration modules:

- `validation/gradePremiumSignalMigration.js`
- `validation/populationSignalMigration.js`

Shadow comparison modules:

- `validation/gradePremiumShadowComparison.js`
- `validation/populationShadowComparison.js`

Shared Signal Alignment modules:

- `validation/signalProducerAdapter.js`
- `validation/signalAlignmentContract.js`
- `validation/signalAlignmentBatch.js`
- `validation/signalAlignmentEngine.js`
- `validation/signalConflictAnalyzer.js`
- `validation/signalAlignmentReport.js`
- `validation/signalAlignmentValidationSuite.js`
- `validation/intelligenceSignalRegistry.js`

Related tests:

- `tests/grade-premium-signal-migration.test.js`
- `tests/grade-premium-shadow-comparison.test.js`
- `tests/population-signal-migration.test.js`
- `tests/population-shadow-comparison.test.js`
- `tests/signal-producer-adapter.test.js`
- `tests/signal-alignment-contract.test.js`
- `tests/signal-alignment-batch.test.js`
- `tests/signal-alignment-engine.test.js`
- `tests/signal-conflict-analyzer.test.js`
- `tests/signal-alignment-report.test.js`
- `tests/signal-alignment-validation-suite.test.js`
- `tests/intelligence-signal-registry.test.js`

Related architecture documents:

- `docs/architecture/grade-premium-signal-migration.md`
- `docs/architecture/grade-premium-shadow-comparison.md`
- `docs/architecture/population-signal-migration.md`
- `docs/architecture/population-shadow-comparison.md`
- `docs/architecture/canonical-intelligence-signal-contract.md`
- `docs/architecture/intelligence-signal-registry.md`
- `docs/architecture/signal-alignment-contract.md`
- `docs/architecture/signal-alignment-batch.md`
- `docs/architecture/signal-alignment-engine.md`
- `docs/architecture/signal-conflict-analyzer.md`
- `docs/architecture/signal-alignment-report.md`
- `docs/architecture/signal-alignment-validation-suite.md`

## Lifecycle Comparison

Grade Premium and Population follow the same high-level migration lifecycle.

Shared lifecycle behavior:

- both accept supplied native output and never execute native engines
- both defensively clone native output
- both preserve native output in `nativeOutput`, `canonicalSignal.rawOutput`, and `adaptedSignal.nativeOutput`
- both build source-output fingerprints from explicit fingerprints, existing native fingerprints, or deterministic projection fingerprints
- both resolve a signal definition by `signalName` and native/declared version
- both classify registry resolution as `matched`, `definition_missing`, `version_mismatch`, or `registry_missing`
- both create Canonical Intelligence Signals with `productionImpact: "none"`, `decisionImpact: "none"`, and `executionAuthority: "none"`
- both create Signal Alignment artifacts using the shared alignment contract
- both create Alignment Batch, Alignment Run, Conflict Analysis, and Alignment Report artifacts
- both validate registry, signal, alignment, batch, run, conflict analysis, report, parity, authority, and fingerprints
- both expose a summary helper and deterministic migration fingerprint helper

Shared shadow-comparison lifecycle behavior:

- both accept either a migration artifact or enough native output and registry input to build one offline
- both compare raw native fields against `canonicalSignal.rawOutput`
- both compare semantic evidence, confidence, status, metadata, and unknown-value projections
- both validate migration, canonical signal, alignment, alignment run, and alignment report artifacts
- both validate source-reference fingerprints
- both report deterministic mismatches without repair
- both use parity statuses: `exact_match`, `semantic_match`, `mismatch`, `incomplete`, `invalid`, and `blocked`
- both preserve offline authority boundaries

The lifecycle is consistent and suitable as the template for future migrations.

## Duplication Findings

### Duplicate migration orchestration

Meaningful duplication is present.

`gradePremiumSignalMigration.js` and `populationSignalMigration.js` duplicate the same orchestration sequence: source fingerprint, registry lookup, canonical signal construction, alignment construction, adapted signal construction, batch/run/conflict/report creation, parity validation, summary construction, and final fingerprinting.

This duplication is not harmful yet, but it will become a maintenance problem if each future engine migration copies an entire module.

### Duplicate shadow-comparison logic

Meaningful duplication is present.

`gradePremiumShadowComparison.js` and `populationShadowComparison.js` duplicate:

- required comparison schema fields
- parity status constants
- `deepFreeze`
- `known`
- `normalizeDate`
- `normalizeString`
- `stableEqual`
- native raw field comparison
- missing wrapper field detection
- unexpected wrapper field detection
- mismatch object construction
- unknown-value path discovery
- parity status determination
- summary construction
- comparison fingerprint construction
- source-artifact validation
- fingerprint reference validation
- authority boundary validation

Engine-specific evidence, confidence, status, and metadata comparisons should remain local.

### Duplicate parity validation

Both migration modules use exact JSON equality to confirm native output is preserved in wrapper artifacts. Both comparison modules independently derive mismatch counts and parity status.

The exact preservation rule should be shared. The semantic comparison rules should remain engine-specific.

### Duplicate authority enforcement

Authority boundary enforcement is repeated in each module and mostly delegates to existing contract validators. The repeated checks are correct, but the repeated code increases the chance a future engine migration forgets one layer.

### Duplicate fingerprint construction

Each module repeats the same projection pattern:

- clone artifact
- delete its own fingerprint field
- delete legacy or alias fingerprint fields
- call `buildFingerprintFromProjection`

This is consistent with existing Phase 13 helpers, but a future migration core could reduce drift by accepting the artifact and fingerprint-field names.

### Duplicate registry-resolution behavior

Both migration modules implement the same registry status logic with only `signalName` and `signalVersion` changing. This is a strong candidate for a shared helper.

### Duplicate immutable artifact construction

Both migration modules build adapted signal, alignment run, conflict analysis, and report artifacts in the same way. This is lifecycle plumbing and should not need to be copied for every engine.

### Duplicate report-building logic

The report itself is correctly built by `signalAlignmentReport`. The repeated code is the per-migration wrapper that calls it and passes the same IDs, timestamps, run, and conflict analysis.

### Duplicate tests

The Grade Premium and Population test suites intentionally mirror each other. This is useful while the pattern is being proven, but future engines would benefit from shared conformance fixtures that can verify:

- native-output preservation
- registry missing behavior
- authority blocking
- deterministic fingerprints
- no runtime imports
- comparison mismatch detection

## Conformance Findings

Both migrations conform to the Phase 13 wrapper-first architecture.

Confirmed conformance:

- no native engine execution
- no production runtime imports
- no native output mutation
- deterministic artifact construction
- registry resolution through `intelligenceSignalRegistry`
- canonical wrapping through `canonicalIntelligenceSignalContract`
- alignment through `signalAlignmentContract`
- batch/run/report reuse
- conflict analysis inclusion
- explicit authority boundary fields
- explicit missing registry definitions
- explicit unknown values
- deterministic fingerprints
- tests for no server/scanner/native-engine imports

Minor conformance drift:

- Grade Premium determines producer version from `nativeOutput.version`; Population determines it from `nativeOutput.populationVersion`, `nativeOutput.version`, or default `population_engine_v2`.
- Grade Premium maps uncertainty from `premiumRiskLevel`; Population maps uncertainty from numeric confidence.
- Grade Premium evidence can include true sold support counts from native `soldSupport`; Population evidence intentionally sets true sold and active listing counts to zero because population context is not sold evidence.
- Population shadow comparison fixed zero evidence counts as semantic values, while Grade Premium uses clone-based comparison for sold support counts. This difference is domain-correct.

No conformance issue blocks future work.

## Engine-Specific Differences

The following behavior should remain engine-specific:

- native output field names
- native version resolution
- native source name
- signal name
- producer identity
- producer category where it differs
- signal type
- evidence role interpretation
- confidence semantics
- uncertainty semantics
- normalized output projection
- evidence-basis projection
- evidence-quality projection
- semantic parity mapping
- status comparison mapping
- metadata comparison mapping where native version/source fields differ
- mismatch field names and human-readable messages where domain-specific

Grade Premium is a grading/evidence-support signal. Its native `soldSupport` can legitimately become true sold support counts in the canonical evidence basis.

Population is a scarcity/context signal. Its population counts must never imply transaction-level sold evidence, production valuation support, or active-listing support.

## Shared-Core Candidates

The strongest shared-core candidates are small lifecycle primitives, not a generic domain mapper.

Recommended future shared helpers:

- `buildSignalMigrationFingerprint(artifact, fingerprintFields)`
- `buildSourceOutputFingerprint(nativeOutput, explicitFingerprint)`
- `resolveSignalDefinition(registry, signalName, signalVersion)`
- `classifyRegistryResolution(registry, signalName, definition)`
- `buildWrapperOnlyProducerMetadata(source, executesNativeEngine = false)`
- `buildAdaptedSignalArtifact(config, canonicalSignal, alignment, definition, registryStatus)`
- `buildSingleSignalAlignmentRun(config, adaptedSignal, alignmentBatch, registry)`
- `buildSingleSignalConflictAnalysis(config, alignmentRun)`
- `buildSingleSignalAlignmentReport(config, alignmentRun, conflictAnalysis)`
- `verifyNativeOutputPreserved(nativeOutput, canonicalSignal, adaptedSignal)`
- `collectNestedValidationResults(validationResults)`
- `validateAuthorityBoundaryFields(artifact)`
- `validateSourceArtifactFingerprints(config, comparison)`
- `compareCanonicalRawNativeFields(nativeOutput, canonicalSignal)`
- `findUnknownPaths(value)`
- `determineShadowParityStatus(parts, validationState)`

Recommended shared configuration shape:

- schema version
- migration source
- comparison source
- signal name
- producer
- producer category
- default signal version
- native version resolver
- native output aliases
- signal type
- decision role
- authority level
- evidence role
- producer module path
- canonical mapping callbacks
- comparison callbacks

The mapping callbacks should remain engine-specific.

## Consolidation Risks

Risks of consolidating too early:

- A generic mapper could blur important domain boundaries, especially the difference between Grade Premium sold-support evidence and Population scarcity context.
- A premature abstraction could hide native-output parity differences that should remain explicit in engine-specific tests.
- A broad shared module could become a second contract layer that duplicates `canonicalIntelligenceSignalContract`, `signalAlignmentContract`, and `intelligenceSignalRegistry`.
- Refactoring now could churn stable fingerprints if not done carefully.
- Refactoring both completed migrations before a third engine validates the pattern may create the wrong abstraction.

## Continuation Risks

Risks of continuing with copy-based migrations:

- Future modules may forget one validation layer.
- Reason codes may drift.
- Registry lookup status handling may become inconsistent.
- Source-reference fingerprint validation may be omitted or implemented differently.
- The same no-runtime-import test pattern will be duplicated repeatedly.
- Bugs fixed in one comparison module may not be fixed in others.
- Adding a future migration certification report will need to know multiple slightly different artifact shapes.

Copy-based migration is acceptable for one more engine but should not become the permanent pattern for the next several migrations.

## Recommendation

Do not refactor the existing Grade Premium or Population modules immediately.

The current modules are correct, conformant, tested, and documentation-aligned. They should be preserved until a third production-engine migration proves whether the shared shape is stable across a broader signal family.

After the third migration, implement a behavior-preserving shared migration core that extracts only lifecycle and validation scaffolding. Keep all engine-specific mappings in narrow engine migration modules.

Recommended shared-core phase after one more migration:

- create `validation/signalMigrationCore.js`
- create `validation/signalShadowComparisonCore.js`
- migrate only generic lifecycle helpers
- preserve existing public APIs
- preserve every existing output shape
- preserve every existing fingerprint or explicitly document any fingerprint-preserving projection strategy before refactor
- add conformance tests proving Grade Premium, Population, and the third migration still match their pre-refactor artifacts

## Safest Third Migration Target

The safest third migration target is the existing Listing Quality and Grading Diagnostics family, specifically `validation/listingQualityGradingDiagnostics.js`.

Rationale:

- It is already a Phase 10 offline diagnostic layer.
- It is observation-only and explicitly non-authoritative.
- It has rich native output covering listing quality, grading status, risk level, warnings, blockers, confirmed attributes, ambiguous attributes, unsupported attributes, grading support, and listing-history context.
- It exercises a different signal family than both Grade Premium and Population: listing quality and grading risk rather than grade premium support or population scarcity context.
- It can reuse the established wrapper-first migration without executing production engines.
- It is close to false-positive reduction, one of CardHawk's core intelligence goals, while still respecting all production boundaries.

Do not choose a production-authoritative engine as the next migration target. The next migration should remain offline/shadow-only until the migration pattern and conformance core are stable.

## Exact Recommended Next Phase

Phase 13.5B - Listing Quality and Grading Diagnostics Signal Migration.

Objective:

Wrap already-produced `listingQualityGradingDiagnostics` output into the Phase 13 Signal Alignment framework using the existing copy-explicit pattern from Grade Premium and Population.

Constraints:

- offline-only
- shadow-only
- do not execute diagnostics
- do not modify native outputs
- do not integrate with production runtime
- do not grant production authority

Acceptance criteria:

- native diagnostic output is preserved exactly
- canonical signal is created
- registry definition resolves when supplied
- alignment, batch, run, conflict analysis, and report artifacts are created
- exact and semantic parity are documented
- no runtime imports are introduced
- deterministic tests cover registry resolution, parity, authority, fingerprints, unknown values, and report generation

Follow-up after Phase 13.5B:

Phase 13.5C - Signal Migration Core Consolidation Audit or behavior-preserving consolidation, depending on review approval.

## Explicit Non-Goals

This audit does not recommend:

- changing production scoring
- changing valuation
- changing Deal Gate
- changing BUY_NOW
- changing notifications
- changing scanner behavior
- changing persistence
- executing native engines
- granting authority to signal wrappers
- merging engine-specific evidence mappings into a generic mapper
- refactoring stable modules before approval
- changing existing public APIs
- changing existing fingerprints
