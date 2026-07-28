# Signal Migration Core Architecture

## Executive Summary

Phase 13.6A designs a shared Signal Migration Core after three successful wrapper-first migrations:

- Grade Premium
- Population Intelligence
- Listing Quality and Grading Diagnostics

The three migrations prove that CardHawk now has a stable migration lifecycle. Each migration accepts already-produced native output, preserves it exactly, wraps it in a Canonical Intelligence Signal, resolves a registry definition, creates Signal Alignment artifacts, assembles batch/run/conflict/report artifacts, validates parity and authority, and remains offline-only.

The shared core should extract this lifecycle scaffolding without moving engine-specific semantics into generic code. Evidence mapping, confidence mapping, uncertainty mapping, normalized output projection, status interpretation, and semantic parity rules must remain local to each engine family.

The goal is not shorter code by itself. The goal is preventing future migration drift while preserving public APIs, output shapes, deterministic fingerprints, and production boundaries.

## Scope

This architecture covers future shared infrastructure for:

- `validation/gradePremiumSignalMigration.js`
- `validation/populationSignalMigration.js`
- `validation/listingQualitySignalMigration.js`
- existing and future shadow comparisons
- future production-engine and diagnostic-output migrations

It does not change production behavior and does not grant authority to migrated signals.

## Shared Migration Lifecycle

Every migrated signal should follow the same lifecycle:

1. Accept supplied native output.
2. Clone native output defensively.
3. Determine the native signal version.
4. Build or preserve the source-output fingerprint.
5. Resolve the registry definition by exact signal name and version.
6. Classify registry resolution.
7. Build a Canonical Intelligence Signal from supplied native output.
8. Build a Signal Alignment artifact.
9. Build an adapted signal artifact.
10. Build an Alignment Batch.
11. Build an Alignment Run.
12. Build a Conflict Analysis artifact.
13. Build a Signal Alignment Report.
14. Verify exact native-output parity.
15. Validate all nested artifacts.
16. Validate authority boundaries.
17. Validate deterministic fingerprints.
18. Build migration summary.
19. Build migration fingerprint.
20. Return an immutable migration artifact.

The shared core should own steps that are independent of engine semantics.

## Shared Artifact Construction

The shared core should construct these artifacts when supplied with a migration adapter:

- adapted signal artifact
- single-signal Alignment Batch
- single-signal Alignment Run
- single-signal Conflict Analysis
- single-signal Signal Alignment Report
- migration summary shell
- migration validation shell

The adapter should supply:

- migration source
- migration schema version
- signal name
- producer identity
- producer category
- default version
- artifact ID prefixes
- native output aliases
- canonical signal builder
- summary additions

The core must not directly decide whether a signal is grading, quality, context, evidence, risk, or valuation. Those are adapter responsibilities.

## Shared Registry Resolution

Registry resolution is currently repeated across Grade Premium, Population, and Listing Quality migrations.

The shared registry resolver should:

- accept `registry`, `signalName`, and `signalVersion`
- call `getSignalDefinition`
- return `definition`
- return one of:
  - `matched`
  - `definition_missing`
  - `version_mismatch`
  - `registry_missing`

The resolver must never invent missing definitions and must never infer authority from registry absence.

Exact signal-name and version matching remains required.

## Shared Parity Verification

The shared parity core should provide exact native-output preservation checks:

- compare supplied `nativeOutput` to `canonicalSignal.rawOutput`
- compare supplied `nativeOutput` to `adaptedSignal.nativeOutput`
- return `preserved` or `changed`
- return structured errors with deterministic reason codes

This is safe to share because exact native preservation is universal.

Semantic parity remains engine-specific. For example:

- Grade Premium maps `soldSupport` into true sold support counts.
- Population maps population counts into diagnostic context and keeps true sold counts at zero.
- Listing Quality maps listing quality, grading status, risk, and attribute summaries into diagnostic context.

The shared core must not decide those semantic meanings.

## Shared Fingerprint Generation

The core should provide a small fingerprint projection helper for migration artifacts:

- clone the artifact
- remove configured fingerprint fields
- build a deterministic projection fingerprint

Each migration can keep its public helper name, such as `buildGradePremiumMigrationFingerprint`, but delegate to the shared primitive.

Required compatibility:

- existing public helper names remain unchanged
- existing fingerprint inputs remain unchanged
- existing fingerprint outputs must remain byte-for-byte identical after any future behavior-preserving consolidation

Before refactoring current modules, tests must capture current migration artifacts as golden fixtures or pre/post parity checks.

## Shared Authority Enforcement

Authority boundary validation should be shared for migration artifacts.

Required fields:

- `productionImpact: "none"`
- `decisionImpact: "none"`
- `executionAuthority: "none"`

The shared validator should:

- validate these fields on the migration artifact
- collect nested authority violations from registry, signal, alignment, batch, run, conflict analysis, and report validations
- preserve exact reason codes used by existing modules

The shared core must never grant or infer authority.

## Shared Validation Pipeline

The shared validation pipeline should accept:

- migration artifact
- required field list
- schema version
- expected source
- artifact-specific fingerprint builder
- nested validators
- parity verifier

It should return:

- `valid`
- `errors`
- `warnings`
- `reasonCodes`
- `registryResolutionStatus`
- `alignmentStatus`
- `reportStatus`
- `parityStatus`
- `authorityViolations`
- `fingerprintViolations`

The current three migrations already return this shape. A shared validator should preserve that output.

Nested validators should remain the existing canonical modules:

- `validateSignalRegistry`
- `validateCanonicalSignal`
- `validateSignalAlignment`
- `validateAlignmentBatch`
- `validateSignalAlignmentRun`
- `validateConflictAnalysis`
- `validateSignalAlignmentReport`

## Engine-Specific Extension Points

Engine adapters must own these responsibilities:

- native output aliases
- native version resolver
- producer and module metadata
- signal name
- signal type
- decision role
- authority level
- producer category
- confidence object mapping
- confidence level mapping
- uncertainty mapping
- evidence basis mapping
- evidence quality mapping
- warning and blocker extraction
- normalized output projection
- metadata projection
- semantic parity rules
- domain-specific mismatch messages
- domain-specific documentation
- domain-specific test fixtures

The core should treat these as callbacks or configuration values, not as central domain rules.

## Adapter Configuration Model

A future migration adapter configuration should look conceptually like this:

```js
{
  schemaVersion,
  migrationSource,
  signalName,
  producer,
  producerCategory,
  defaultSignalVersion,
  producerModule,
  nativeOutputAliases,
  artifactIdPrefix,
  getSignalVersion(nativeOutput, input, definition),
  buildCanonicalSignal(input, definition, context),
  buildSummary(migration),
  compareSemanticParity?(nativeOutput, migration)
}
```

The configuration should be declarative where possible and callback-based only where engine semantics require logic.

The core should not execute native engines. It should accept already-produced native outputs only.

## Migration Hook Lifecycle

Recommended hook order:

1. `normalizeInput`
2. `cloneNativeOutput`
3. `resolveVersion`
4. `resolveRegistryDefinition`
5. `buildCanonicalSignal`
6. `buildAlignment`
7. `buildAdaptedSignal`
8. `buildBatch`
9. `buildRun`
10. `buildConflictAnalysis`
11. `buildReport`
12. `verifyExactParity`
13. `buildSummary`
14. `validateMigration`
15. `buildFingerprint`
16. `freezeArtifact`

Allowed adapter hooks:

- before canonical signal build
- canonical signal build
- summary enrichment
- optional semantic parity helper for future shadow comparison modules

Disallowed hooks:

- native engine execution
- production writes
- config mutation
- runtime integration
- Deal Gate or BUY_NOW evaluation
- native output mutation

## Future Engine Onboarding Process

Future migrations should follow this process:

1. Confirm the native output already exists and can be supplied without executing the engine.
2. Document native output fields and authority boundary.
3. Add or supply a registry signal definition fixture.
4. Create an adapter configuration.
5. Implement a narrow engine migration module that preserves the existing public API pattern.
6. Add deterministic tests for success, missing definition, parity, immutability, fingerprints, authority, report generation, validation-suite compatibility, and no runtime imports.
7. Add architecture documentation.
8. Run focused tests, Phase 13 signal tests, governance tests, smoke tests, full suite, and `git diff --check`.

No migration should become production-authoritative through this process.

## Backwards Compatibility Guarantees

Any future consolidation must preserve:

- public API names
- exported constants where already present
- artifact schema versions
- output shapes
- reason codes
- statuses
- deterministic ordering
- deterministic fingerprints
- validation return shapes
- native-output parity behavior
- no-runtime-import tests
- production boundaries

Existing modules can delegate to a core internally, but callers should not need to change.

## Code That Should Move Into `signalMigrationCore`

Recommended shared functions:

- `deepFreeze`
- `known`
- `normalizeDate`
- `normalizeString`
- `buildSourceOutputFingerprint`
- `resolveSignalDefinition`
- `getRegistryResolutionStatus`
- `buildAdaptedSignal`
- `buildSingleSignalAlignmentRun`
- `buildSingleSignalAlignmentBatch`
- `buildSingleSignalConflictAnalysis`
- `buildSingleSignalAlignmentReport`
- `verifyExactNativeOutputParity`
- `buildMigrationFingerprint`
- `collectMigrationValidationResults`
- `validateMigrationAuthorityBoundary`
- `validateMigrationFingerprintChain`
- `runSignalMigration`

`runSignalMigration` should orchestrate the lifecycle but require adapter-supplied canonical signal construction.

## Code That Must Remain Engine-Specific

Grade Premium should keep:

- risk-to-uncertainty mapping from `premiumRiskLevel`
- evidence basis from `soldSupport`
- evidence quality from `dimensions.sameGradeSupport`
- normalized output for grade premium score, premium metrics, and target grade
- confidence semantics that explicitly preserve unknown confidence

Population should keep:

- version resolution from `populationVersion`
- numeric confidence-to-confidence-level mapping
- inverse confidence-to-uncertainty mapping
- population evidence details
- true sold count and active listing count set to zero
- population evidence boundary documentation

Listing Quality should keep:

- quality status to evidence-quality mapping
- risk level to uncertainty mapping
- warning and blocking issue extraction
- listing quality summary projection
- grading support summary projection
- listing history context projection
- explicit no-confidence semantics

## Shadow Comparison Core Relationship

This phase primarily designs `signalMigrationCore`, but the same consolidation boundary applies to comparisons.

Shared comparison candidates:

- exact native raw field comparison
- mismatch object construction
- unknown path discovery
- parity status determination
- comparison fingerprint generation
- source-artifact fingerprint reference validation
- authority boundary validation

Engine-specific comparison responsibilities:

- evidence semantic comparison
- confidence semantic comparison
- status semantic comparison
- metadata semantic comparison where native version/source fields differ
- domain-specific mismatch messages

## Proposed Module Boundaries

### `validation/signalMigrationCore.js`

Owns migration lifecycle scaffolding.

Responsibilities:

- input normalization
- source-output fingerprinting
- registry resolution
- adapted signal construction
- batch/run/conflict/report construction
- exact parity verification
- nested validation aggregation
- authority boundary aggregation
- migration fingerprint projection
- immutable final artifact return

Non-responsibilities:

- native engine execution
- evidence semantics
- confidence semantics
- signal-specific normalized output
- production integration

### `validation/signalMigrationAdapter.js`

Defines and validates adapter configuration.

Responsibilities:

- validate required adapter fields
- validate hook presence
- normalize artifact ID prefixes
- provide reusable adapter test fixtures

Non-responsibilities:

- running migrations by itself
- mapping all engines into a single generic schema

### `validation/signalParityCore.js`

Owns shared exact parity and comparison primitives.

Responsibilities:

- exact native-output preservation
- raw field comparison
- missing wrapper field detection
- unexpected wrapper field detection
- unknown-value path tracking
- deterministic mismatch sorting

Non-responsibilities:

- deciding semantic equivalence for evidence, confidence, status, or metadata

### `validation/signalMigrationValidator.js`

Owns shared validation aggregation.

Responsibilities:

- required field validation
- schema/source validation
- nested validation aggregation
- authority aggregation
- fingerprint aggregation
- validation return-shape consistency

Non-responsibilities:

- engine-specific rule validation
- production authority changes

## Risks Of Over-Abstraction

Over-abstraction could:

- hide meaningful differences between sold-support evidence, population context, and listing-quality diagnostics
- accidentally treat diagnostic context as valuation evidence
- make future signal mappings harder to review
- create a generic contract layer that duplicates existing canonical contracts
- destabilize fingerprints through subtle projection changes
- weaken no-runtime-import boundaries by centralizing too much module knowledge

The core should be small, explicit, and lifecycle-focused.

## Risks Of Insufficient Abstraction

Continuing copy-based migrations could:

- create reason-code drift
- omit one nested validation layer in a future migration
- duplicate fingerprint bugs
- duplicate authority enforcement inconsistently
- make future migration certification harder
- increase maintenance cost for every new engine family
- force reviewers to re-read large repeated modules to verify the same lifecycle each time

After three migrations, the lifecycle is stable enough to design a core, but implementation should still be behavior-preserving and incremental.

## Recommended Implementation Order

1. Phase 13.6B - Signal Migration Core Contract
   - create `validation/signalMigrationCore.js`
   - add tests for source fingerprinting, registry resolution, exact parity, adapted signal construction, run/report construction, authority aggregation, and fingerprint projection
   - do not migrate existing engine modules yet

2. Phase 13.6C - Signal Migration Adapter Contract
   - create adapter configuration validation
   - add deterministic fixtures for Grade Premium, Population, and Listing Quality adapters
   - prove adapter configs can describe current migrations without changing artifacts

3. Phase 13.6D - Behavior-Preserving Migration Consolidation
   - refactor one migration at a time to delegate lifecycle scaffolding to the core
   - preserve public APIs and output shapes
   - prove pre/post artifacts are identical

4. Phase 13.6E - Shadow Comparison Core Architecture or Contract
   - design or implement shared comparison primitives only after migration core behavior is stable

5. Phase 13.7 - Next Engine Migration Using Core
   - migrate the next engine using the shared core from the start
   - verify the onboarding process is materially simpler and safer

## Explicit Non-Goals

This architecture does not propose:

- production runtime integration
- server changes
- scanner changes
- parser changes
- identity changes
- valuation changes
- Deal Gate changes
- BUY_NOW changes
- notification changes
- persistence changes
- configuration changes
- native engine execution
- native output mutation
- production authority for signal wrappers
- generic evidence semantics
- generic confidence scoring
- immediate refactoring of completed migrations without approval
